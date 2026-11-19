import { Parser } from 'expr-eval';
import type { Plot2dSpec } from '../schema';
import {
  buildArrowMarkerDefs,
  buildEmbeddedDiagramStyle,
  DiagramTone,
  estimateSvgLabelWidth,
  getStrokeDashArray,
  getToneColors,
  hashSpecKey,
  PLOT_CURVE_TONES,
  renderMathTextSvg,
} from '../theme';

function createMathParser(): Parser {
  const parser = new Parser({
    operators: {
      add: true,
      subtract: true,
      multiply: true,
      divide: true,
      power: true,
      remainder: true,
      factorial: false,
      logical: false,
      comparison: false,
      concatenate: false,
      conditional: true,
      assignment: false,
      fndef: false,
    },
  });

  parser.consts.PI = Math.PI;
  parser.consts.pi = Math.PI;
  parser.consts.E = Math.E;
  parser.consts.e = Math.E;

  parser.functions.ln = Math.log;
  parser.functions.log10 = (v: number) => Math.log10(v);
  parser.functions.log2 = (v: number) => Math.log2(v);
  parser.functions.sec = (v: number) => 1 / Math.cos(v);
  parser.functions.csc = (v: number) => 1 / Math.sin(v);
  parser.functions.cot = (v: number) => 1 / Math.tan(v);
  parser.functions.sgn = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  parser.functions.step = (v: number) => (v >= 0 ? 1 : 0);
  parser.functions.heaviside = (v: number) => (v >= 0 ? 1 : 0);
  parser.functions.sinc = (v: number) => (Math.abs(v) < 1e-9 ? 1 : Math.sin(v) / v);

  return parser;
}

const SHARED_PARSER = createMathParser();

export function preprocessMathExpr(raw: string): string {
  let out = String(raw ?? '').trim();
  // Strip wrapping $...$ if any
  out = out.replace(/^\$+|\$+$/g, '').trim();
  // Strip leading "y =" or "f(x) =" if LLM wrote an equation
  out = out.replace(/^(?:y|f\s*\(\s*x\s*\)|g\s*\(\s*x\s*\)|h\s*\(\s*x\s*\))\s*=\s*/i, '');

  out = out
    .replace(/\\pi\b|π/g, 'PI')
    .replace(/\\cdot|·|×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\\left|\\right/g, '');

  // Convert \frac{a}{b} -> ((a)/(b))
  for (let pass = 0; pass < 3; pass++) {
    out = out.replace(/\\[dtc]?frac\{([^{}]+)\}\{([^{}]+)\}/g, '(($1)/($2))');
  }

  // Strip leading backslash on math functions: \sin -> sin, \ln -> ln, \sqrt -> sqrt
  out = out.replace(
    /\\(sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|sqrt|cbrt|exp|ln|log10|log2|log|abs|floor|ceil|round|max|min|sec|csc|cot|sgn|sinc)\b/g,
    '$1'
  );

  // Convert |...| into abs(...)
  out = out.replace(/\|([^|]+)\|/g, 'abs($1)');

  // Convert Unicode superscripts if any
  out = out
    .replace(/²/g, '^2')
    .replace(/³/g, '^3');

  // Insert explicit multiplication for common math shorthands without breaking scientific notation (1e-3)
  out = out.replace(/(\d+(?:\.\d+)?)\s*(?=(?:PI|pi|E|x)\b|\(|(?:sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|sqrt|cbrt|exp|ln|log10|log2|log|abs|sec|csc|cot|sgn|sinc)\s*\()/g, '$1*');
  out = out.replace(/(\d+(?:\.\d+)?)e(?![+\-]?\d)/g, '$1*e');
  out = out.replace(/\)\s*(?=\(|[A-Za-z0-9])/g, ')*');
  out = out.replace(/\b(x|PI|pi|E|e)\s*(?=\()/g, '$1*');

  return out;
}

export function compileMathExpression(rawExpr: string): (x: number) => number {
  const normalized = preprocessMathExpr(rawExpr);
  const compiled = SHARED_PARSER.parse(normalized);
  return (x: number): number => {
    try {
      const val = Number(compiled.evaluate({ x }));
      return Number.isFinite(val) ? val : Number.NaN;
    } catch {
      return Number.NaN;
    }
  };
}

function computeNiceTicks(min: number, max: number, targetCount = 6): number[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [0];
  const rawStep = span / Math.max(2, targetCount);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceNorm = norm <= 1.2 ? 1 : norm <= 2.4 ? 2 : norm <= 5.5 ? 5 : 10;
  const step = niceNorm * mag;

  const first = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + step * 1e-6; v += step) {
    const rounded = Math.abs(v) < step * 1e-7 ? 0 : Number(v.toPrecision(6));
    ticks.push(rounded);
    if (ticks.length > 32) break;
  }
  return ticks;
}

function formatTickNumber(n: number): string {
  if (Math.abs(n) < 1e-9) return '0';
  if (Number.isInteger(n)) return String(n);
  if (Math.abs(n) >= 1000 || Math.abs(n) < 0.01) return n.toExponential(1);
  return String(Number(n.toPrecision(4)));
}

interface PlacedBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function boxesOverlap(a: PlacedBox, b: PlacedBox): boolean {
  return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
}

function chooseNonOverlappingPos(params: {
  anchorX: number;
  anchorY: number;
  width: number;
  height: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  placed: PlacedBox[];
}): { cx: number; cy: number } {
  const { anchorX, anchorY, width, height, bounds, placed } = params;
  const candidates: Array<[number, number]> = [
    [anchorX + width / 2 + 10, anchorY - height / 2 - 8],
    [anchorX + width / 2 + 10, anchorY + height / 2 + 8],
    [anchorX - width / 2 - 10, anchorY - height / 2 - 8],
    [anchorX - width / 2 - 10, anchorY + height / 2 + 8],
    [anchorX, anchorY - height - 10],
    [anchorX, anchorY + height + 10],
    [anchorX + width / 2 + 14, anchorY - height - 18],
    [anchorX - width / 2 - 14, anchorY + height + 18],
  ];

  for (const [rawCx, rawCy] of candidates) {
    const cx = Math.max(bounds.minX + width / 2, Math.min(bounds.maxX - width / 2, rawCx));
    const cy = Math.max(bounds.minY + height / 2, Math.min(bounds.maxY - height / 2, rawCy));
    const box: PlacedBox = {
      x1: cx - width / 2 - 2,
      y1: cy - height / 2 - 2,
      x2: cx + width / 2 + 2,
      y2: cy + height / 2 + 2,
    };
    if (!placed.some((p) => boxesOverlap(box, p))) {
      placed.push(box);
      return { cx, cy };
    }
  }

  const fallbackCx = Math.max(bounds.minX + width / 2, Math.min(bounds.maxX - width / 2, anchorX));
  const fallbackCy = Math.max(bounds.minY + height / 2, Math.min(bounds.maxY - height / 2, anchorY - 16));
  placed.push({
    x1: fallbackCx - width / 2,
    y1: fallbackCy - height / 2,
    x2: fallbackCx + width / 2,
    y2: fallbackCy + height / 2,
  });
  return { cx: fallbackCx, cy: fallbackCy };
}

export function renderPlot2dSvg(spec: Plot2dSpec): string {
  const [xMin, xMax] = spec.xRange;
  const xSpan = xMax - xMin;

  const compiledFunctions = (spec.functions || []).map((fn, idx) => ({
    ...fn,
    evalFn: compileMathExpression(fn.expr),
    tone: (fn.tone || PLOT_CURVE_TONES[idx % PLOT_CURVE_TONES.length]) as DiagramTone,
  }));

  const compiledShades = (spec.shadedRegions || []).map((sh) => ({
    ...sh,
    eval1: compileMathExpression(sh.expr),
    eval2: sh.expr2 ? compileMathExpression(sh.expr2) : () => 0,
    tone: (sh.tone || 'accent') as DiagramTone,
  }));

  // Determine yRange if not explicitly specified
  let yMin: number;
  let yMax: number;
  if (spec.yRange) {
    [yMin, yMax] = spec.yRange;
  } else {
    const samples: number[] = [];
    const probeN = 200;
    for (const fn of compiledFunctions) {
      const dMin = fn.domain ? Math.max(xMin, fn.domain[0]) : xMin;
      const dMax = fn.domain ? Math.min(xMax, fn.domain[1]) : xMax;
      if (dMax <= dMin) continue;
      for (let i = 0; i <= probeN; i++) {
        const x = dMin + ((dMax - dMin) * i) / probeN;
        const y = fn.evalFn(x);
        if (Number.isFinite(y) && Math.abs(y) < 1e6) {
          samples.push(y);
        }
      }
    }
    for (const pt of spec.points || []) {
      if (Number.isFinite(pt.y)) samples.push(pt.y);
    }
    for (const hl of spec.hlines || []) {
      if (Number.isFinite(hl.y)) samples.push(hl.y);
    }
    if (samples.length === 0) {
      yMin = -5;
      yMax = 5;
    } else {
      samples.sort((a, b) => a - b);
      // Trim top/bottom 2% when extreme poles exist
      const trim = samples.length >= 40 ? Math.floor(samples.length * 0.025) : 0;
      const lo = samples[trim];
      const hi = samples[samples.length - 1 - trim];
      const rawSpan = Math.max(1e-3, hi - lo);
      const pad = Math.max(0.5, rawSpan * 0.16);
      yMin = Number((lo - pad).toPrecision(4));
      yMax = Number((hi + pad).toPrecision(4));
      if (yMax <= yMin) {
        yMin -= 1;
        yMax += 1;
      }
    }
  }
  const ySpan = yMax - yMin;

  const totalW = 680;
  const titleH = spec.title ? 30 : 0;
  const plotX = 58;
  const plotY = 24 + titleH;
  const plotW = totalW - plotX - 44;
  const plotH = 310;
  const totalH = plotY + plotH + 44;

  const toSvgX = (x: number) => plotX + ((x - xMin) / xSpan) * plotW;
  const toSvgY = (y: number) => plotY + ((yMax - y) / ySpan) * plotH;

  const specHash = hashSpecKey(JSON.stringify(spec));
  const clipId = `p2d-clip-${specHash}`;
  const markerPrefix = `p2d-${specHash}`;
  const markerDefs = buildArrowMarkerDefs(markerPrefix, ['default', 'muted', 'accent']);

  const parts: string[] = [];
  parts.push(
    `<rect x="0" y="0" width="${totalW}" height="${totalH}" rx="10" fill="var(--diag-bg, #09090b)" stroke="var(--diag-border, #2e3440)" stroke-width="1"/>`
  );

  if (spec.title) {
    parts.push(
      renderMathTextSvg({
        x: totalW / 2,
        y: 22,
        text: spec.title,
        fontSize: 15,
        fontWeight: 600,
        fill: 'var(--diag-fg, #f4f4f5)',
      })
    );
  }

  // Plot frame background
  parts.push(
    `<rect x="${plotX}" y="${plotY}" width="${plotW}" height="${plotH}" fill="var(--diag-surface, #111318)" stroke="var(--diag-border, #2e3440)" stroke-width="1"/>`
  );

  const xTicks = computeNiceTicks(xMin, xMax, 7);
  const yTicks = computeNiceTicks(yMin, yMax, 6);

  // Grid lines
  if (spec.grid !== false) {
    for (const xt of xTicks) {
      const sx = toSvgX(xt);
      parts.push(
        `<line x1="${sx.toFixed(1)}" y1="${plotY}" x2="${sx.toFixed(1)}" y2="${plotY + plotH}" stroke="var(--diag-grid, rgba(255,255,255,0.08))" stroke-width="1"/>`
      );
    }
    for (const yt of yTicks) {
      const sy = toSvgY(yt);
      parts.push(
        `<line x1="${plotX}" y1="${sy.toFixed(1)}" x2="${plotX + plotW}" y2="${sy.toFixed(1)}" stroke="var(--diag-grid, rgba(255,255,255,0.08))" stroke-width="1"/>`
      );
    }
  }

  // Clipped group for shaded regions & function curves
  const clippedParts: string[] = [];
  const placedLabels: PlacedBox[] = [];
  const labelBounds = {
    minX: plotX + 6,
    minY: plotY + 6,
    maxX: plotX + plotW - 6,
    maxY: plotY + plotH - 6,
  };

  // Shaded regions (integrals / areas between curves)
  for (const sh of compiledShades) {
    const rStart = Math.max(xMin, Math.min(sh.from, sh.to));
    const rEnd = Math.min(xMax, Math.max(sh.from, sh.to));
    if (rEnd <= rStart) continue;

    const steps = 120;
    const upperPts: Array<{ sx: number; sy: number; x: number; y: number }> = [];
    const lowerPts: Array<{ sx: number; sy: number; x: number; y: number }> = [];

    for (let i = 0; i <= steps; i++) {
      const x = rStart + ((rEnd - rStart) * i) / steps;
      const y1 = sh.eval1(x);
      const y2 = sh.eval2(x);
      if (!Number.isFinite(y1) || !Number.isFinite(y2)) continue;
      const clampedY1 = Math.max(yMin - ySpan, Math.min(yMax + ySpan, y1));
      const clampedY2 = Math.max(yMin - ySpan, Math.min(yMax + ySpan, y2));
      upperPts.push({ sx: toSvgX(x), sy: toSvgY(clampedY1), x, y: clampedY1 });
      lowerPts.push({ sx: toSvgX(x), sy: toSvgY(clampedY2), x, y: clampedY2 });
    }

    if (upperPts.length >= 2) {
      const palette = getToneColors(sh.tone);
      const pathCmds = [
        ...upperPts.map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.sx.toFixed(1)} ${pt.sy.toFixed(1)}`),
        ...lowerPts
          .slice()
          .reverse()
          .map((pt) => `L ${pt.sx.toFixed(1)} ${pt.sy.toFixed(1)}`),
        'Z',
      ].join(' ');

      clippedParts.push(
        `<path d="${pathCmds}" fill="${palette.fill}" stroke="${palette.stroke}" stroke-opacity="0.45" stroke-width="1.2"/>`
      );

      if (sh.label) {
        const midIdx = Math.floor(upperPts.length / 2);
        const mx = upperPts[midIdx].sx;
        const my = (upperPts[midIdx].sy + lowerPts[midIdx].sy) / 2;
        const lw = Math.max(28, estimateSvgLabelWidth(sh.label, 11) + 12);
        const pos = chooseNonOverlappingPos({
          anchorX: mx,
          anchorY: my,
          width: lw,
          height: 18,
          bounds: labelBounds,
          placed: placedLabels,
        });
        clippedParts.push(
          `<rect x="${(pos.cx - lw / 2).toFixed(1)}" y="${(pos.cy - 9).toFixed(1)}" width="${lw.toFixed(1)}" height="18" rx="9" fill="${palette.badgeBg}" stroke="${palette.badgeBorder}" stroke-width="1"/>`
        );
        clippedParts.push(
          renderMathTextSvg({
            x: pos.cx,
            y: pos.cy,
            text: sh.label,
            fontSize: 11,
            fontWeight: 600,
            fill: palette.text,
          })
        );
      }
    }
  }

  // Reference vlines and hlines
  for (const vl of spec.vlines || []) {
    if (vl.x < xMin || vl.x > xMax) continue;
    const sx = toSvgX(vl.x);
    const palette = getToneColors(vl.tone || 'muted');
    const dash = getStrokeDashArray(vl.style || 'dashed', true);
    clippedParts.push(
      `<line x1="${sx.toFixed(1)}" y1="${plotY}" x2="${sx.toFixed(1)}" y2="${plotY + plotH}" stroke="${palette.stroke}" stroke-width="1.4" stroke-dasharray="${dash}"/>`
    );
    if (vl.label) {
      const lw = Math.max(24, estimateSvgLabelWidth(vl.label, 11) + 10);
      const lx = Math.max(plotX + lw / 2 + 4, Math.min(plotX + plotW - lw / 2 - 4, sx));
      clippedParts.push(
        `<rect x="${(lx - lw / 2).toFixed(1)}" y="${plotY + 6}" width="${lw.toFixed(1)}" height="17" rx="4" fill="${palette.badgeBg}" stroke="${palette.badgeBorder}" stroke-width="0.9"/>`
      );
      clippedParts.push(
        renderMathTextSvg({
          x: lx,
          y: plotY + 14.5,
          text: vl.label,
          fontSize: 11,
          fill: palette.text,
        })
      );
    }
  }

  for (const hl of spec.hlines || []) {
    if (hl.y < yMin || hl.y > yMax) continue;
    const sy = toSvgY(hl.y);
    const palette = getToneColors(hl.tone || 'muted');
    const dash = getStrokeDashArray(hl.style || 'dashed', true);
    clippedParts.push(
      `<line x1="${plotX}" y1="${sy.toFixed(1)}" x2="${plotX + plotW}" y2="${sy.toFixed(1)}" stroke="${palette.stroke}" stroke-width="1.4" stroke-dasharray="${dash}"/>`
    );
    if (hl.label) {
      const lw = Math.max(24, estimateSvgLabelWidth(hl.label, 11) + 10);
      const ly = Math.max(plotY + 12, Math.min(plotY + plotH - 12, sy));
      clippedParts.push(
        `<rect x="${plotX + plotW - lw - 6}" y="${(ly - 9).toFixed(1)}" width="${lw.toFixed(1)}" height="17" rx="4" fill="${palette.badgeBg}" stroke="${palette.badgeBorder}" stroke-width="0.9"/>`
      );
      clippedParts.push(
        renderMathTextSvg({
          x: plotX + plotW - lw / 2 - 6,
          y: ly - 0.5,
          text: hl.label,
          fontSize: 11,
          fill: palette.text,
        })
      );
    }
  }

  // Function curves with discontinuity & asymptote break detection
  const sampleCount = 360;
  for (const fn of compiledFunctions) {
    const palette = getToneColors(fn.tone);
    const strokeColor = fn.color || palette.stroke;
    const textColor = fn.color || palette.text;
    const dash = getStrokeDashArray(fn.style);
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';

    const dMin = fn.domain ? Math.max(xMin, fn.domain[0]) : xMin;
    const dMax = fn.domain ? Math.min(xMax, fn.domain[1]) : xMax;
    if (dMax <= dMin) continue;

    const segments: Array<Array<{ sx: number; sy: number; y: number }>> = [];
    let currentSeg: Array<{ sx: number; sy: number; y: number }> = [];
    let prevY: number | null = null;

    for (let i = 0; i <= sampleCount; i++) {
      const x = dMin + ((dMax - dMin) * i) / sampleCount;
      const y = fn.evalFn(x);

      if (!Number.isFinite(y) || Number.isNaN(y) || Math.abs(y - (yMin + yMax) / 2) > ySpan * 6) {
        if (currentSeg.length >= 2) segments.push(currentSeg);
        currentSeg = [];
        prevY = null;
        continue;
      }

      // Asymptote / jump discontinuity detection (e.g. 1/x or tan(x) flipping across pole)
      if (prevY !== null) {
        const jump = Math.abs(y - prevY);
        const oppositeExtremeSign = prevY * y < 0 && jump > ySpan * 0.9;
        if (oppositeExtremeSign || jump > ySpan * 1.8) {
          if (currentSeg.length >= 2) segments.push(currentSeg);
          currentSeg = [];
        }
      }

      currentSeg.push({
        sx: toSvgX(x),
        sy: toSvgY(y),
        y,
      });
      prevY = y;
    }
    if (currentSeg.length >= 2) {
      segments.push(currentSeg);
    }

    const pathD = segments
      .map((seg) =>
        seg
          .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.sx.toFixed(2)} ${pt.sy.toFixed(2)}`)
          .join(' ')
      )
      .join(' ');

    if (pathD) {
      clippedParts.push(
        `<path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2.4"${dashAttr} stroke-linecap="round" stroke-linejoin="round"/>`
      );
    }

    if (fn.label) {
      const allPts = segments.flat().filter((pt) => pt.sy >= plotY + 12 && pt.sy <= plotY + plotH - 12);
      const anchorPt =
        allPts.length > 0
          ? allPts[Math.min(allPts.length - 1, Math.floor(allPts.length * 0.78))]
          : { sx: plotX + plotW * 0.72, sy: plotY + 24 };
      const lw = Math.max(30, estimateSvgLabelWidth(fn.label, 12) + 14);
      const pos = chooseNonOverlappingPos({
        anchorX: anchorPt.sx,
        anchorY: anchorPt.sy,
        width: lw,
        height: 20,
        bounds: labelBounds,
        placed: placedLabels,
      });
      clippedParts.push(
        `<rect x="${(pos.cx - lw / 2).toFixed(1)}" y="${(pos.cy - 10).toFixed(1)}" width="${lw.toFixed(1)}" height="20" rx="10" fill="var(--diag-bg, #09090b)" fill-opacity="0.9" stroke="${strokeColor}" stroke-width="1"/>`
      );
      clippedParts.push(
        renderMathTextSvg({
          x: pos.cx,
          y: pos.cy,
          text: fn.label,
          fontSize: 12,
          fontWeight: 600,
          fill: textColor,
        })
      );
    }
  }

  parts.push(`<defs><clipPath id="${clipId}"><rect x="${plotX}" y="${plotY}" width="${plotW}" height="${plotH}"/></clipPath>${markerDefs}</defs>`);
  parts.push(`<g clip-path="url(#${clipId})">${clippedParts.join('')}</g>`);

  // Axes (at x=0 / y=0 when inside range, else along plot border)
  const hasZeroX = xMin <= 0 && xMax >= 0;
  const hasZeroY = yMin <= 0 && yMax >= 0;
  const yAxisX = hasZeroX ? toSvgX(0) : plotX;
  const xAxisY = hasZeroY ? toSvgY(0) : plotY + plotH;

  parts.push(
    `<line x1="${plotX}" y1="${xAxisY.toFixed(1)}" x2="${plotX + plotW + 10}" y2="${xAxisY.toFixed(1)}" stroke="var(--diag-axis, #94a3b8)" stroke-width="1.5" marker-end="url(#${markerPrefix}-arrow-muted)"/>`
  );
  parts.push(
    `<line x1="${yAxisX.toFixed(1)}" y1="${plotY + plotH}" x2="${yAxisX.toFixed(1)}" y2="${plotY - 10}" stroke="var(--diag-axis, #94a3b8)" stroke-width="1.5" marker-end="url(#${markerPrefix}-arrow-muted)"/>`
  );

  // Axis labels
  if (spec.xLabel) {
    parts.push(
      renderMathTextSvg({
        x: plotX + plotW + 18,
        y: xAxisY,
        text: spec.xLabel,
        fontSize: 13,
        fontWeight: 600,
        fill: 'var(--diag-fg, #f4f4f5)',
        anchor: 'start',
      })
    );
  }
  if (spec.yLabel) {
    parts.push(
      renderMathTextSvg({
        x: yAxisX,
        y: plotY - 18,
        text: spec.yLabel,
        fontSize: 13,
        fontWeight: 600,
        fill: 'var(--diag-fg, #f4f4f5)',
      })
    );
  }

  // Tick marks and labels along bottom / left of plot frame for zero overlap with curves
  for (const xt of xTicks) {
    const sx = toSvgX(xt);
    parts.push(
      `<line x1="${sx.toFixed(1)}" y1="${plotY + plotH}" x2="${sx.toFixed(1)}" y2="${plotY + plotH + 5}" stroke="var(--diag-axis, #94a3b8)" stroke-width="1"/>`
    );
    parts.push(
      renderMathTextSvg({
        x: sx,
        y: plotY + plotH + 17,
        text: formatTickNumber(xt),
        fontSize: 11,
        fill: 'var(--diag-muted, #a1a1aa)',
      })
    );
  }
  for (const yt of yTicks) {
    const sy = toSvgY(yt);
    parts.push(
      `<line x1="${plotX - 5}" y1="${sy.toFixed(1)}" x2="${plotX}" y2="${sy.toFixed(1)}" stroke="var(--diag-axis, #94a3b8)" stroke-width="1"/>`
    );
    parts.push(
      renderMathTextSvg({
        x: plotX - 9,
        y: sy,
        text: formatTickNumber(yt),
        fontSize: 11,
        fill: 'var(--diag-muted, #a1a1aa)',
        anchor: 'end',
      })
    );
  }

  // Feature points & optional orthogonal projections (rendered above axes for clarity)
  for (const pt of spec.points || []) {
    if (pt.x < xMin || pt.x > xMax || pt.y < yMin || pt.y > yMax) continue;
    const sx = toSvgX(pt.x);
    const sy = toSvgY(pt.y);
    const palette = getToneColors(pt.tone || 'warn');

    if (pt.showProjections) {
      parts.push(
        `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${sx.toFixed(1)}" y2="${xAxisY.toFixed(1)}" stroke="${palette.stroke}" stroke-opacity="0.65" stroke-width="1.2" stroke-dasharray="4,3"/>`
      );
      parts.push(
        `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${yAxisX.toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${palette.stroke}" stroke-opacity="0.65" stroke-width="1.2" stroke-dasharray="4,3"/>`
      );
    }

    parts.push(
      `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="4.5" fill="${palette.stroke}" stroke="var(--diag-bg, #09090b)" stroke-width="1.5"/>`
    );

    if (pt.label) {
      const lw = Math.max(24, estimateSvgLabelWidth(pt.label, 11) + 12);
      const pos = chooseNonOverlappingPos({
        anchorX: sx,
        anchorY: sy,
        width: lw,
        height: 18,
        bounds: { minX: plotX + 4, minY: plotY + 4, maxX: totalW - 8, maxY: plotY + plotH - 4 },
        placed: placedLabels,
      });
      parts.push(
        `<rect x="${(pos.cx - lw / 2).toFixed(1)}" y="${(pos.cy - 9).toFixed(1)}" width="${lw.toFixed(1)}" height="18" rx="9" fill="${palette.badgeBg}" stroke="${palette.badgeBorder}" stroke-width="1"/>`
      );
      parts.push(
        renderMathTextSvg({
          x: pos.cx,
          y: pos.cy,
          text: pt.label,
          fontSize: 11,
          fontWeight: 600,
          fill: palette.text,
        })
      );
    }
  }

  return `<svg data-diagram-engine="plot2d" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="100%" style="max-width: 100%; height: auto;">${buildEmbeddedDiagramStyle()}${parts.join('')}</svg>`;
}
