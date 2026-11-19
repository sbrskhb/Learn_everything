import type { CircuitElementSpec, CircuitSpec } from '../schema';
import {
  buildArrowMarkerDefs,
  buildEmbeddedDiagramStyle,
  DiagramTone,
  estimateSvgLabelWidth,
  getToneColors,
  hashSpecKey,
  renderMathTextSvg,
} from '../theme';

interface Point2D {
  x: number;
  y: number;
}

const BASE_STEP = 116;

const DIR_VECTORS: Record<'right' | 'down' | 'left' | 'up', Point2D> = {
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
};

export function renderCircuitSvg(spec: CircuitSpec): string {
  const anchors = new Map<string, Point2D>();
  let cx = 0;
  let cy = 0;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const includePoint = (x: number, y: number, padX = 0, padY = 0) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x - padX);
    maxX = Math.max(maxX, x + padX);
    minY = Math.min(minY, y - padY);
    maxY = Math.max(maxY, y + padY);
  };

  const specHash = hashSpecKey(JSON.stringify(spec));
  const markerPrefix = `ckt-${specHash}`;
  const markerDefs = buildArrowMarkerDefs(markerPrefix, [
    'default',
    'accent',
    'positive',
    'negative',
    'warn',
    'purple',
    'muted',
  ]);

  const shapeParts: string[] = [];
  const labelParts: string[] = [];

  const registerAnchorName = (name: string | undefined, pt: Point2D) => {
    if (!name) return;
    const key = name.trim();
    if (key) {
      anchors.set(key, { x: pt.x, y: pt.y });
    }
  };

  const resolveStartPoint = (el: CircuitElementSpec): Point2D => {
    if (el.fromAnchor && anchors.has(el.fromAnchor.trim())) {
      return { ...anchors.get(el.fromAnchor.trim())! };
    }
    return { x: cx, y: cy };
  };

  for (const el of spec.elements) {
    const dir = el.dir || 'right';
    const vec = DIR_VECTORS[dir] || DIR_VECTORS.right;
    const tone: DiagramTone = el.tone || 'default';
    const palette = getToneColors(tone);
    const strokeColor =
      tone === 'default' ? 'var(--diag-fg, #f4f4f5)' : palette.stroke;
    const p1 = resolveStartPoint(el);

    if (el.kind === 'node') {
      includePoint(p1.x, p1.y, 12, 12);
      shapeParts.push(
        `<circle cx="${p1.x.toFixed(1)}" cy="${p1.y.toFixed(1)}" r="4.2" fill="${strokeColor}" stroke="var(--diag-bg, #09090b)" stroke-width="1.2"/>`
      );
      registerAnchorName(el.anchor, p1);
      registerAnchorName(el.id, p1);
      const nodeText = [el.label, el.value].filter(Boolean).join(' ');
      if (nodeText) {
        const tw = estimateSvgLabelWidth(nodeText, 12);
        const lx = p1.x + (dir === 'left' ? -10 : dir === 'right' ? 10 : 0);
        const ly = p1.y + (dir === 'down' ? 16 : -14);
        const anchorAttr = dir === 'left' ? 'end' : dir === 'right' ? 'start' : 'middle';
        includePoint(
          anchorAttr === 'start' ? lx + tw / 2 : anchorAttr === 'end' ? lx - tw / 2 : lx,
          ly,
          tw / 2 + 4,
          10
        );
        labelParts.push(
          renderMathTextSvg({
            x: lx,
            y: ly,
            text: nodeText,
            fontSize: 12,
            fontWeight: 600,
            fill: palette.text,
            anchor: anchorAttr,
          })
        );
      }
      cx = p1.x;
      cy = p1.y;
      continue;
    }

    if (el.kind === 'ground') {
      const drop = 16;
      const gy = p1.y + drop;
      includePoint(p1.x, p1.y, 16, 4);
      includePoint(p1.x, gy + 12, 16, 4);
      shapeParts.push(
        `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round"/>`
      );
      shapeParts.push(
        `<line x1="${(p1.x - 13).toFixed(1)}" y1="${gy.toFixed(1)}" x2="${(p1.x + 13).toFixed(1)}" y2="${gy.toFixed(1)}" stroke="${strokeColor}" stroke-width="2.2" stroke-linecap="round"/>`
      );
      shapeParts.push(
        `<line x1="${(p1.x - 8).toFixed(1)}" y1="${(gy + 5).toFixed(1)}" x2="${(p1.x + 8).toFixed(1)}" y2="${(gy + 5).toFixed(1)}" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round"/>`
      );
      shapeParts.push(
        `<line x1="${(p1.x - 3.5).toFixed(1)}" y1="${(gy + 10).toFixed(1)}" x2="${(p1.x + 3.5).toFixed(1)}" y2="${(gy + 10).toFixed(1)}" stroke="${strokeColor}" stroke-width="1.8" stroke-linecap="round"/>`
      );
      if (el.label) {
        const tw = estimateSvgLabelWidth(el.label, 11);
        includePoint(p1.x, gy + 24, tw / 2 + 4, 8);
        labelParts.push(
          renderMathTextSvg({
            x: p1.x,
            y: gy + 23,
            text: el.label,
            fontSize: 11,
            fill: 'var(--diag-muted, #a1a1aa)',
          })
        );
      }
      registerAnchorName(el.anchor, p1);
      registerAnchorName(el.id, p1);
      cx = p1.x;
      cy = p1.y;
      continue;
    }

    if (el.kind === 'opamp') {
      const sign = dir === 'left' ? -1 : 1;
      const bodyLen = 68;
      const leadIn = 18;
      const leadOut = 24;
      const totalSpan = leadIn + bodyLen + leadOut; // 110
      const halfH = 38;
      const pinOffset = 18;

      // Top input aligns directly with p1 so incoming inverting/non-inverting lines attach seamlessly
      const topPin: Point2D = { x: p1.x, y: p1.y };
      const botPin: Point2D = { x: p1.x, y: p1.y + pinOffset * 2 };
      const midY = p1.y + pinOffset;
      const bodyStartX = p1.x + sign * leadIn;
      const apexX = bodyStartX + sign * bodyLen;
      const outPin: Point2D = { x: p1.x + sign * totalSpan, y: midY };

      const topIsPlus = el.polarity === '+-';
      const inMinusPt = topIsPlus ? botPin : topPin;
      const inPlusPt = topIsPlus ? topPin : botPin;

      includePoint(p1.x, midY - halfH, 8, 8);
      includePoint(outPin.x, midY + halfH, 8, 8);

      // Triangle body
      const triPath = `M ${bodyStartX.toFixed(1)} ${(midY - halfH).toFixed(1)} L ${apexX.toFixed(1)} ${midY.toFixed(1)} L ${bodyStartX.toFixed(1)} ${(midY + halfH).toFixed(1)} Z`;
      shapeParts.push(
        `<path d="${triPath}" fill="var(--diag-surface, #111318)" stroke="${strokeColor}" stroke-width="2" stroke-linejoin="round"/>`
      );
      // Input & output leads
      shapeParts.push(
        `<line x1="${topPin.x.toFixed(1)}" y1="${topPin.y.toFixed(1)}" x2="${bodyStartX.toFixed(1)}" y2="${topPin.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="2"/>`
      );
      shapeParts.push(
        `<line x1="${botPin.x.toFixed(1)}" y1="${botPin.y.toFixed(1)}" x2="${bodyStartX.toFixed(1)}" y2="${botPin.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="2"/>`
      );
      shapeParts.push(
        `<line x1="${apexX.toFixed(1)}" y1="${midY.toFixed(1)}" x2="${outPin.x.toFixed(1)}" y2="${outPin.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="2"/>`
      );

      // + / - markings inside triangle
      const markX = bodyStartX + sign * 12;
      labelParts.push(
        renderMathTextSvg({
          x: markX,
          y: inMinusPt.y,
          text: '−',
          fontSize: 15,
          fontWeight: 700,
          fill: 'var(--diag-negative-text, #fda4af)',
        })
      );
      labelParts.push(
        renderMathTextSvg({
          x: markX,
          y: inPlusPt.y,
          text: '+',
          fontSize: 14,
          fontWeight: 700,
          fill: 'var(--diag-positive-text, #6ee7b7)',
        })
      );

      if (el.label || el.value) {
        const txt = [el.label, el.value].filter(Boolean).join(' ');
        labelParts.push(
          renderMathTextSvg({
            x: bodyStartX + sign * (bodyLen * 0.45),
            y: midY,
            text: txt,
            fontSize: 12,
            fontWeight: 600,
            fill: 'var(--diag-muted, #a1a1aa)',
          })
        );
      }

      anchors.set('in-', inMinusPt);
      anchors.set('in+', inPlusPt);
      anchors.set('out', outPin);
      const baseName = (el.anchor || el.id || '').trim();
      if (baseName) {
        anchors.set(baseName, outPin);
        anchors.set(`${baseName}.in-`, inMinusPt);
        anchors.set(`${baseName}.in+`, inPlusPt);
        anchors.set(`${baseName}.out`, outPin);
      }

      cx = outPin.x;
      cy = outPin.y;
      continue;
    }

    // 2-terminal element (wire, resistor, capacitor, inductor, diode, voltage_dc, voltage_ac, current_source)
    const stepLen = BASE_STEP * (el.length || 1);
    const p2: Point2D =
      el.toAnchor && anchors.has(el.toAnchor.trim())
        ? { ...anchors.get(el.toAnchor.trim())! }
        : {
            x: p1.x + vec.x * stepLen,
            y: p1.y + vec.y * stepLen,
          };

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy);

    includePoint(p1.x, p1.y, 12, 12);
    includePoint(p2.x, p2.y, 12, 12);

    if (dist > 0.5) {
      const ux = dx / dist;
      const uy = dy / dist;
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const mid = dist / 2;
      const midWorld = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      const localCmds: string[] = [];
      let normalOffset = 22;

      switch (el.kind) {
        case 'wire': {
          normalOffset = 14;
          localCmds.push(
            `<line x1="0" y1="0" x2="${dist.toFixed(1)}" y2="0" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round"/>`
          );
          break;
        }
        case 'resistor': {
          normalOffset = 22;
          const halfBody = Math.min(22, dist * 0.35);
          const s = mid - halfBody;
          const e = mid + halfBody;
          const step = (e - s) / 7;
          const pts = [
            `M 0 0 L ${s.toFixed(1)} 0`,
            `L ${(s + step * 0.5).toFixed(1)} -7.5`,
            `L ${(s + step * 1.5).toFixed(1)} 7.5`,
            `L ${(s + step * 2.5).toFixed(1)} -7.5`,
            `L ${(s + step * 3.5).toFixed(1)} 7.5`,
            `L ${(s + step * 4.5).toFixed(1)} -7.5`,
            `L ${(s + step * 5.5).toFixed(1)} 7.5`,
            `L ${(s + step * 6.5).toFixed(1)} -7.5`,
            `L ${e.toFixed(1)} 0 L ${dist.toFixed(1)} 0`,
          ].join(' ');
          includePoint(midWorld.x, midWorld.y, 14, 14);
          localCmds.push(
            `<path d="${pts}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
          );
          break;
        }
        case 'capacitor': {
          normalOffset = 24;
          const gap = 5.5;
          includePoint(midWorld.x, midWorld.y, 18, 18);
          localCmds.push(
            `<line x1="0" y1="0" x2="${(mid - gap).toFixed(1)}" y2="0" stroke="${strokeColor}" stroke-width="2"/>`
          );
          localCmds.push(
            `<line x1="${(mid + gap).toFixed(1)}" y1="0" x2="${dist.toFixed(1)}" y2="0" stroke="${strokeColor}" stroke-width="2"/>`
          );
          localCmds.push(
            `<line x1="${(mid - gap).toFixed(1)}" y1="-14" x2="${(mid - gap).toFixed(1)}" y2="14" stroke="${strokeColor}" stroke-width="2.4" stroke-linecap="round"/>`
          );
          localCmds.push(
            `<line x1="${(mid + gap).toFixed(1)}" y1="-14" x2="${(mid + gap).toFixed(1)}" y2="14" stroke="${strokeColor}" stroke-width="2.4" stroke-linecap="round"/>`
          );
          break;
        }
        case 'inductor': {
          normalOffset = 22;
          const halfBody = 24;
          const s = mid - halfBody;
          const e = mid + halfBody;
          includePoint(midWorld.x, midWorld.y, 14, 14);
          localCmds.push(
            `<line x1="0" y1="0" x2="${s.toFixed(1)}" y2="0" stroke="${strokeColor}" stroke-width="2"/>`
          );
          localCmds.push(
            `<path d="M ${s.toFixed(1)} 0 A 6 7.5 0 0 1 ${(s + 12).toFixed(1)} 0 A 6 7.5 0 0 1 ${(s + 24).toFixed(1)} 0 A 6 7.5 0 0 1 ${(s + 36).toFixed(1)} 0 A 6 7.5 0 0 1 ${e.toFixed(1)} 0" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round"/>`
          );
          localCmds.push(
            `<line x1="${e.toFixed(1)}" y1="0" x2="${dist.toFixed(1)}" y2="0" stroke="${strokeColor}" stroke-width="2"/>`
          );
          break;
        }
        case 'diode': {
          normalOffset = 22;
          const halfBody = 11;
          includePoint(midWorld.x, midWorld.y, 16, 16);
          localCmds.push(
            `<line x1="0" y1="0" x2="${(mid - halfBody).toFixed(1)}" y2="0" stroke="${strokeColor}" stroke-width="2"/>`
          );
          localCmds.push(
            `<path d="M ${(mid - halfBody).toFixed(1)} -11 L ${(mid + halfBody).toFixed(1)} 0 L ${(mid - halfBody).toFixed(1)} 11 Z" fill="${palette.fill}" stroke="${strokeColor}" stroke-width="2" stroke-linejoin="round"/>`
          );
          localCmds.push(
            `<line x1="${(mid + halfBody).toFixed(1)}" y1="-12" x2="${(mid + halfBody).toFixed(1)}" y2="12" stroke="${strokeColor}" stroke-width="2.4" stroke-linecap="round"/>`
          );
          localCmds.push(
            `<line x1="${(mid + halfBody).toFixed(1)}" y1="0" x2="${dist.toFixed(1)}" y2="0" stroke="${strokeColor}" stroke-width="2"/>`
          );
          break;
        }
        case 'voltage_dc':
        case 'voltage_ac':
        case 'current_source': {
          normalOffset = 28;
          const r = 18;
          includePoint(midWorld.x, midWorld.y, r + 6, r + 6);
          localCmds.push(
            `<line x1="0" y1="0" x2="${(mid - r).toFixed(1)}" y2="0" stroke="${strokeColor}" stroke-width="2"/>`
          );
          localCmds.push(
            `<circle cx="${mid.toFixed(1)}" cy="0" r="${r}" fill="var(--diag-surface, #111318)" stroke="${strokeColor}" stroke-width="2"/>`
          );
          localCmds.push(
            `<line x1="${(mid + r).toFixed(1)}" y1="0" x2="${dist.toFixed(1)}" y2="0" stroke="${strokeColor}" stroke-width="2"/>`
          );
          if (el.kind === 'current_source') {
            localCmds.push(
              `<line x1="${(mid - 10).toFixed(1)}" y1="0" x2="${(mid + 9).toFixed(1)}" y2="0" stroke="${strokeColor}" stroke-width="2" marker-end="url(#${markerPrefix}-arrow-${tone})"/>`
            );
          }
          break;
        }
      }

      shapeParts.push(
        `<g transform="translate(${p1.x.toFixed(1)}, ${p1.y.toFixed(1)}) rotate(${deg.toFixed(2)})">${localCmds.join('')}</g>`
      );

      // Upright world-space glyphs inside circular sources
      if (el.kind === 'voltage_dc') {
        const effPol = el.polarity || (dir === 'up' ? '-+' : '+-');
        if (effPol !== 'none') {
          const plusSign = effPol === '+-' ? -1 : 1;
          const minusSign = -plusSign;
          const plusPos = { x: midWorld.x + ux * 8 * plusSign, y: midWorld.y + uy * 8 * plusSign };
          const minusPos = { x: midWorld.x + ux * 8 * minusSign, y: midWorld.y + uy * 8 * minusSign };
          labelParts.push(
            renderMathTextSvg({
              x: plusPos.x,
              y: plusPos.y,
              text: '+',
              fontSize: 13,
              fontWeight: 700,
              fill: 'var(--diag-positive-text, #6ee7b7)',
            })
          );
          labelParts.push(
            renderMathTextSvg({
              x: minusPos.x,
              y: minusPos.y,
              text: '−',
              fontSize: 13,
              fontWeight: 700,
              fill: 'var(--diag-negative-text, #fda4af)',
            })
          );
        }
      } else if (el.kind === 'voltage_ac') {
        const sx = midWorld.x;
        const sy = midWorld.y;
        shapeParts.push(
          `<path d="M ${(sx - 9).toFixed(1)} ${sy.toFixed(1)} Q ${(sx - 4.5).toFixed(1)} ${(sy - 8).toFixed(1)} ${sx.toFixed(1)} ${sy.toFixed(1)} T ${(sx + 9).toFixed(1)} ${sy.toFixed(1)}" fill="none" stroke="${strokeColor}" stroke-width="1.8" stroke-linecap="round"/>`
        );
      }

      // Optional branch reference current arrow + label near p1 lead
      if (el.currentLabel && dist >= 48) {
        const arrowT = el.kind === 'wire' ? 0.5 : 0.16;
        const ax1 = p1.x + dx * Math.max(0.06, arrowT - 0.05);
        const ay1 = p1.y + dy * Math.max(0.06, arrowT - 0.05);
        const ax2 = p1.x + dx * Math.min(0.94, arrowT + 0.07);
        const ay2 = p1.y + dy * Math.min(0.94, arrowT + 0.07);
        const curTone: DiagramTone = tone === 'default' ? 'accent' : tone;
        const curPalette = getToneColors(curTone);
        shapeParts.push(
          `<line x1="${ax1.toFixed(1)}" y1="${ay1.toFixed(1)}" x2="${ax2.toFixed(1)}" y2="${ay2.toFixed(1)}" stroke="${curPalette.stroke}" stroke-width="2" marker-end="url(#${markerPrefix}-arrow-${curTone})"/>`
        );
        const isVert = Math.abs(dy) > Math.abs(dx);
        const clx = (ax1 + ax2) / 2 + (isVert ? -14 : 0);
        const cly = (ay1 + ay2) / 2 + (isVert ? 0 : -15);
        const cw = estimateSvgLabelWidth(el.currentLabel, 12);
        includePoint(clx, cly, cw / 2 + 4, 10);
        labelParts.push(
          renderMathTextSvg({
            x: clx,
            y: cly,
            text: el.currentLabel,
            fontSize: 12,
            fontWeight: 600,
            fill: curPalette.text,
            anchor: isVert ? 'end' : 'middle',
          })
        );
      }

      // Component label and value placed cleanly outside symbol
      const labelLines = [el.label, el.value].filter(Boolean) as string[];
      if (labelLines.length > 0) {
        const isHoriz = Math.abs(dx) >= Math.abs(dy);
        const sideOffset = isHoriz ? { x: 0, y: -normalOffset } : { x: dir === 'up' ? -normalOffset - 4 : normalOffset + 4, y: 0 };
        const anchorAttr: 'start' | 'middle' | 'end' = isHoriz
          ? 'middle'
          : sideOffset.x < 0
            ? 'end'
            : 'start';
        const baseX = midWorld.x + sideOffset.x;
        const baseY = midWorld.y + sideOffset.y;

        labelLines.forEach((line, lIdx) => {
          const ly =
            labelLines.length === 1
              ? baseY
              : isHoriz
                ? baseY - (labelLines.length - 1 - lIdx) * 15
                : baseY + (lIdx - 0.5) * 15;
          const fs = lIdx === 0 ? 12.5 : 11;
          const tw = estimateSvgLabelWidth(line, fs);
          const centerX =
            anchorAttr === 'start' ? baseX + tw / 2 : anchorAttr === 'end' ? baseX - tw / 2 : baseX;
          includePoint(centerX, ly, tw / 2 + 6, 10);
          labelParts.push(
            renderMathTextSvg({
              x: baseX,
              y: ly,
              text: line,
              fontSize: fs,
              fontWeight: lIdx === 0 ? 600 : 400,
              fill: lIdx === 0 ? 'var(--diag-fg, #f4f4f5)' : 'var(--diag-muted, #a1a1aa)',
              anchor: anchorAttr,
            })
          );
        });
      }
    }

    if (el.anchor) registerAnchorName(el.anchor, p2);
    if (el.id) {
      registerAnchorName(el.id, p2);
      registerAnchorName(`${el.id}.start`, p1);
      registerAnchorName(`${el.id}.end`, p2);
    }

    cx = p2.x;
    cy = p2.y;
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 240;
    maxY = 120;
  }

  const pad = 34;
  const titleH = spec.title ? 32 : 0;
  const titleW = spec.title ? Math.ceil(estimateSvgLabelWidth(spec.title, 15) + 56) : 0;
  const rawW = Math.max(240, Math.ceil(maxX - minX + pad * 2));
  const totalW = Math.max(rawW, titleW);
  const totalH = Math.max(120, Math.ceil(maxY - minY + pad * 2 + titleH));
  const shiftX = (totalW - (maxX - minX)) / 2 - minX;
  const shiftY = pad + titleH - minY;

  const titleSvg = spec.title
    ? renderMathTextSvg({
        x: totalW / 2,
        y: 22,
        text: spec.title,
        fontSize: 15,
        fontWeight: 600,
        fill: 'var(--diag-fg, #f4f4f5)',
      })
    : '';

  return `<svg data-diagram-engine="circuit" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="100%" style="max-width: 100%; height: auto;">${buildEmbeddedDiagramStyle()}<defs>${markerDefs}</defs><rect x="0" y="0" width="${totalW}" height="${totalH}" rx="10" fill="var(--diag-bg, #09090b)" stroke="var(--diag-border, #2e3440)" stroke-width="1"/>${titleSvg}<g transform="translate(${shiftX.toFixed(1)}, ${shiftY.toFixed(1)})">${shapeParts.join('')}${labelParts.join('')}</g></svg>`;
}
