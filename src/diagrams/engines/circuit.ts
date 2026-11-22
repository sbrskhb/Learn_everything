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
  const endpointCounts = new Map<string, { pt: Point2D; n: number }>();
  const explicitNodeKeys = new Set<string>();
  const anchorWireDir = new Map<string, 'right' | 'down' | 'left' | 'up'>();
  let bjtCount = 0;
  let mosCount = 0;

  const pointKey = (pt: Point2D): string => `${Math.round(pt.x)},${Math.round(pt.y)}`;

  const countEndpoint = (pt: Point2D) => {
    const key = pointKey(pt);
    const cur = endpointCounts.get(key);
    if (cur) {
      cur.n += 1;
    } else {
      endpointCounts.set(key, { pt: { x: pt.x, y: pt.y }, n: 1 });
    }
  };

  const registerAnchorName = (name: string | undefined, pt: Point2D) => {
    if (!name) return;
    const key = name.trim();
    if (key) {
      anchors.set(key, { x: pt.x, y: pt.y });
    }
  };

  const recordWireDir = (
    name: string | undefined,
    wireDir: 'right' | 'down' | 'left' | 'up'
  ) => {
    if (!name) return;
    const key = name.trim();
    if (key) {
      anchorWireDir.set(key, wireDir);
    }
  };

  const resolveStartPoint = (el: CircuitElementSpec): Point2D => {
    if (el.fromAnchor && anchors.has(el.fromAnchor.trim())) {
      return { ...anchors.get(el.fromAnchor.trim())! };
    }
    return { x: cx, y: cy };
  };

  const drawTwoTerminal = (el: CircuitElementSpec, a: Point2D, b: Point2D) => {
    const tone: DiagramTone = el.tone || 'default';
    const palette = getToneColors(tone);
    const strokeColor =
      tone === 'default' ? 'var(--diag-fg, #f4f4f5)' : palette.stroke;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);

    includePoint(a.x, a.y, 12, 12);
    includePoint(b.x, b.y, 12, 12);

    if (dist <= 0.5) return;

    const ux = dx / dist;
    const uy = dy / dist;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const mid = dist / 2;
    const midWorld = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const isHoriz = Math.abs(dx) >= Math.abs(dy);
    const segDir: 'right' | 'down' | 'left' | 'up' = isHoriz
      ? dx > 0
        ? 'right'
        : 'left'
      : dy < 0
        ? 'up'
        : 'down';

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
      `<g transform="translate(${a.x.toFixed(1)}, ${a.y.toFixed(1)}) rotate(${deg.toFixed(2)})">${localCmds.join('')}</g>`
    );

    // Upright world-space glyphs inside circular sources
    if (el.kind === 'voltage_dc') {
      const effPol = el.polarity || (segDir === 'up' ? '-+' : '+-');
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

    // Optional branch reference current arrow + label near start lead
    if (el.currentLabel && dist >= 48) {
      const arrowT = el.kind === 'wire' ? 0.5 : 0.16;
      const ax1 = a.x + dx * Math.max(0.06, arrowT - 0.05);
      const ay1 = a.y + dy * Math.max(0.06, arrowT - 0.05);
      const ax2 = a.x + dx * Math.min(0.94, arrowT + 0.07);
      const ay2 = a.y + dy * Math.min(0.94, arrowT + 0.07);
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
      const sideOffset = isHoriz
        ? { x: 0, y: -normalOffset }
        : { x: segDir === 'up' ? -normalOffset - 4 : normalOffset + 4, y: 0 };
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
  };

  for (let idx = 0; idx < spec.elements.length; idx++) {
    const el = spec.elements[idx];
    const nextEl = spec.elements[idx + 1];
    const dir = el.dir || 'right';
    const vec = DIR_VECTORS[dir] || DIR_VECTORS.right;
    const tone: DiagramTone = el.tone || 'default';
    const palette = getToneColors(tone);
    const strokeColor =
      tone === 'default' ? 'var(--diag-fg, #f4f4f5)' : palette.stroke;
    let p1 = resolveStartPoint(el);

    if ((el.kind === 'node' || el.kind === 'ground') && !el.fromAnchor) {
      if (el.anchor && anchors.has(el.anchor.trim())) {
        p1 = { ...anchors.get(el.anchor.trim())! };
      } else if (el.kind === 'node') {
        const nodeName = (el.anchor || el.id || '').trim();
        if (
          nodeName &&
          !anchors.has(nodeName) &&
          nextEl &&
          nextEl.fromAnchor?.trim() === nodeName &&
          nextEl.toAnchor &&
          anchors.has(nextEl.toAnchor.trim())
        ) {
          const tPt = anchors.get(nextEl.toAnchor.trim())!;
          const nDir = nextEl.dir || 'right';
          const nVec = DIR_VECTORS[nDir] || DIR_VECTORS.right;
          const nLen = BASE_STEP * (nextEl.length || 1);
          p1 = { x: tPt.x - nVec.x * nLen, y: tPt.y - nVec.y * nLen };
        }
      }
    }

    if (el.kind === 'node') {
      explicitNodeKeys.add(pointKey(p1));
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
      countEndpoint(p1);
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

      const topIsPlus = el.polarity === '+-';
      const topLocal: Point2D = { x: 0, y: 0 };
      const botLocal: Point2D = { x: 0, y: pinOffset * 2 };
      const outLocal: Point2D = { x: sign * totalSpan, y: pinOffset };
      const inMinusLocal = topIsPlus ? botLocal : topLocal;
      const inPlusLocal = topIsPlus ? topLocal : botLocal;

      let opStart: Point2D = { x: p1.x, y: p1.y };
      let reqPin = (el.pin || '').trim().toLowerCase();
      const opBaseName = (el.anchor || el.id || '').trim();
      if (
        !el.fromAnchor &&
        !reqPin &&
        opBaseName &&
        nextEl &&
        nextEl.fromAnchor &&
        anchors.has(nextEl.fromAnchor.trim())
      ) {
        const nextTo = nextEl.toAnchor?.trim();
        if (nextTo === `${opBaseName}.in-` || nextTo === `${opBaseName}.in+`) {
          const sPt = anchors.get(nextEl.fromAnchor.trim())!;
          const nDir = nextEl.dir || 'right';
          const nVec = DIR_VECTORS[nDir] || DIR_VECTORS.right;
          const nLen = BASE_STEP * (nextEl.length || 1);
          opStart = { x: sPt.x + nVec.x * nLen, y: sPt.y + nVec.y * nLen };
          reqPin = nextTo === `${opBaseName}.in-` ? 'in-' : 'in+';
        }
      }

      let origin: Point2D = { x: opStart.x, y: opStart.y };
      if (reqPin === 'in-') {
        origin = { x: opStart.x - inMinusLocal.x, y: opStart.y - inMinusLocal.y };
      } else if (reqPin === 'in+') {
        origin = { x: opStart.x - inPlusLocal.x, y: opStart.y - inPlusLocal.y };
      } else if (reqPin === 'out') {
        origin = { x: opStart.x - outLocal.x, y: opStart.y - outLocal.y };
      }

      // Top input aligns directly with origin so incoming inverting/non-inverting lines attach seamlessly
      const topPin: Point2D = { x: origin.x, y: origin.y };
      const botPin: Point2D = { x: origin.x, y: origin.y + pinOffset * 2 };
      const midY = origin.y + pinOffset;
      const bodyStartX = origin.x + sign * leadIn;
      const apexX = bodyStartX + sign * bodyLen;
      const outPin: Point2D = { x: origin.x + sign * totalSpan, y: midY };

      const inMinusPt = topIsPlus ? botPin : topPin;
      const inPlusPt = topIsPlus ? topPin : botPin;

      includePoint(origin.x, midY - halfH, 8, 8);
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

      countEndpoint(inMinusPt);
      countEndpoint(inPlusPt);
      countEndpoint(outPin);

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

    if (
      el.kind === 'npn' ||
      el.kind === 'pnp' ||
      el.kind === 'nmos' ||
      el.kind === 'pmos'
    ) {
      const isBjt = el.kind === 'npn' || el.kind === 'pnp';
      if (isBjt) bjtCount += 1;
      else mosCount += 1;

      const s = dir === 'left' ? -1 : 1;
      const defaultV = el.kind === 'npn' || el.kind === 'nmos' ? 1 : -1;
      const v = el.flip ? -defaultV : defaultV;
      const reqPin = (el.pin || '').trim().toLowerCase();

      const pinLocalMap: Record<string, Point2D> = isBjt
        ? {
            b: { x: 0, y: 0 },
            base: { x: 0, y: 0 },
            c: { x: s * 62, y: -56 * v },
            collector: { x: s * 62, y: -56 * v },
            e: { x: s * 62, y: 56 * v },
            emitter: { x: s * 62, y: 56 * v },
          }
        : {
            g: { x: 0, y: 0 },
            gate: { x: 0, y: 0 },
            d: { x: s * 64, y: -56 * v },
            drain: { x: s * 64, y: -56 * v },
            s: { x: s * 64, y: 56 * v },
            source: { x: s * 64, y: 56 * v },
          };

      const matchedLocal = pinLocalMap[reqPin];
      const origin: Point2D = matchedLocal
        ? { x: p1.x - matchedLocal.x, y: p1.y - matchedLocal.y }
        : { x: p1.x, y: p1.y };

      const wx = (lx: number) => (origin.x + lx).toFixed(1);
      const wy = (ly: number) => (origin.y + ly).toFixed(1);

      const cmds: string[] = [];
      if (isBjt) {
        // Base lead
        cmds.push(
          `<line x1="${wx(0)}" y1="${wy(0)}" x2="${wx(s * 40)}" y2="${wy(0)}" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round"/>`
        );
        // Base vertical bar
        cmds.push(
          `<line x1="${wx(s * 40)}" y1="${wy(-18)}" x2="${wx(s * 40)}" y2="${wy(18)}" stroke="${strokeColor}" stroke-width="3" stroke-linecap="round"/>`
        );
        // Collector side
        cmds.push(
          `<path d="M ${wx(s * 40)} ${wy(-8 * v)} L ${wx(s * 62)} ${wy(-26 * v)} L ${wx(s * 62)} ${wy(-56 * v)}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
        );
        // Emitter side
        cmds.push(
          `<path d="M ${wx(s * 40)} ${wy(8 * v)} L ${wx(s * 62)} ${wy(26 * v)} L ${wx(s * 62)} ${wy(56 * v)}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
        );
        // Emitter arrow
        const ax = s * 40;
        const ay = 8 * v;
        const bx = s * 62;
        const by = 26 * v;
        const vx = bx - ax;
        const vy = by - ay;
        const vlen = Math.hypot(vx, vy);
        const ux = vx / vlen;
        const uy = vy / vlen;
        const isNpn = el.kind === 'npn';
        const t = isNpn ? 0.9 : 0.3;
        const tipX = ax + t * vx;
        const tipY = ay + t * vy;
        const adx = isNpn ? ux : -ux;
        const ady = isNpn ? uy : -uy;
        const nx = -ady;
        const ny = adx;
        const b1x = tipX - adx * 9 + nx * 4.5;
        const b1y = tipY - ady * 9 + ny * 4.5;
        const b2x = tipX - adx * 9 - nx * 4.5;
        const b2y = tipY - ady * 9 - ny * 4.5;
        cmds.push(
          `<path d="M ${wx(tipX)} ${wy(tipY)} L ${wx(b1x)} ${wy(b1y)} L ${wx(b2x)} ${wy(b2y)} Z" fill="${strokeColor}"/>`
        );
      } else {
        // Gate lead
        cmds.push(
          `<line x1="${wx(0)}" y1="${wy(0)}" x2="${wx(s * 34)}" y2="${wy(0)}" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round"/>`
        );
        // Gate plate
        cmds.push(
          `<line x1="${wx(s * 34)}" y1="${wy(-20)}" x2="${wx(s * 34)}" y2="${wy(20)}" stroke="${strokeColor}" stroke-width="2.4" stroke-linecap="round"/>`
        );
        // Channel
        if (el.depletion) {
          cmds.push(
            `<line x1="${wx(s * 42)}" y1="${wy(-24)}" x2="${wx(s * 42)}" y2="${wy(24)}" stroke="${strokeColor}" stroke-width="3" stroke-linecap="round"/>`
          );
        } else {
          for (const [y0, y1] of [
            [-24, -12],
            [-6, 6],
            [12, 24],
          ] as const) {
            cmds.push(
              `<line x1="${wx(s * 42)}" y1="${wy(y0)}" x2="${wx(s * 42)}" y2="${wy(y1)}" stroke="${strokeColor}" stroke-width="3" stroke-linecap="round"/>`
            );
          }
        }
        // Drain
        cmds.push(
          `<path d="M ${wx(s * 42)} ${wy(-18 * v)} L ${wx(s * 64)} ${wy(-18 * v)} L ${wx(s * 64)} ${wy(-56 * v)}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
        );
        // Source
        cmds.push(
          `<path d="M ${wx(s * 42)} ${wy(18 * v)} L ${wx(s * 64)} ${wy(18 * v)} L ${wx(s * 64)} ${wy(56 * v)}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
        );
        // Body / substrate tie
        cmds.push(
          `<path d="M ${wx(s * 42)} ${wy(0)} L ${wx(s * 64)} ${wy(0)} L ${wx(s * 64)} ${wy(18 * v)}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
        );
        // Substrate arrow (length 8, half-width 4)
        const isNmos = el.kind === 'nmos';
        const tipX = isNmos ? s * 45 : s * 61;
        const adx = isNmos ? -s : s;
        const baseX = tipX - adx * 8;
        cmds.push(
          `<path d="M ${wx(tipX)} ${wy(0)} L ${wx(baseX)} ${wy(-4)} L ${wx(baseX)} ${wy(4)} Z" fill="${strokeColor}"/>`
        );
      }

      shapeParts.push(`<g data-ckt-kind="${el.kind}">${cmds.join('')}</g>`);

      // Bounding box
      includePoint(origin.x, origin.y - 56, 8, 8);
      includePoint(origin.x, origin.y + 56, 8, 8);
      includePoint(origin.x + s * 64, origin.y - 56, 8, 8);
      includePoint(origin.x + s * 64, origin.y + 56, 8, 8);

      // Label and value
      const lx = origin.x + s * 76;
      const anchorAttr: 'start' | 'end' = s > 0 ? 'start' : 'end';
      const addTxLabel = (text: string, ly: number, fs: number, weight: number, fill: string) => {
        const tw = estimateSvgLabelWidth(text, fs);
        const centerX = anchorAttr === 'start' ? lx + tw / 2 : lx - tw / 2;
        includePoint(centerX, ly, tw / 2 + 6, 10);
        labelParts.push(
          renderMathTextSvg({
            x: lx,
            y: ly,
            text,
            fontSize: fs,
            fontWeight: weight,
            fill,
            anchor: anchorAttr,
          })
        );
      };
      if (el.label && el.value) {
        addTxLabel(el.label, origin.y - 8, 12.5, 600, 'var(--diag-fg, #f4f4f5)');
        addTxLabel(el.value, origin.y + 9, 11, 400, 'var(--diag-muted, #a1a1aa)');
      } else if (el.label) {
        addTxLabel(el.label, origin.y, 12.5, 600, 'var(--diag-fg, #f4f4f5)');
      } else if (el.value) {
        addTxLabel(el.value, origin.y, 11, 400, 'var(--diag-muted, #a1a1aa)');
      }

      // Register anchors, count endpoints, and advance cursor to c/d
      const baseName =
        (el.anchor || el.id || '').trim() || (isBjt ? `Q${bjtCount}` : `M${mosCount}`);

      if (isBjt) {
        const bWorld: Point2D = { x: origin.x, y: origin.y };
        const cWorld: Point2D = { x: origin.x + s * 62, y: origin.y - 56 * v };
        const eWorld: Point2D = { x: origin.x + s * 62, y: origin.y + 56 * v };
        countEndpoint(bWorld);
        countEndpoint(cWorld);
        countEndpoint(eWorld);
        anchors.set(baseName, cWorld);
        anchors.set(`${baseName}.b`, bWorld);
        anchors.set(`${baseName}.base`, bWorld);
        anchors.set(`${baseName}.c`, cWorld);
        anchors.set(`${baseName}.collector`, cWorld);
        anchors.set(`${baseName}.e`, eWorld);
        anchors.set(`${baseName}.emitter`, eWorld);
        cx = cWorld.x;
        cy = cWorld.y;
      } else {
        const gWorld: Point2D = { x: origin.x, y: origin.y };
        const dWorld: Point2D = { x: origin.x + s * 64, y: origin.y - 56 * v };
        const sWorld: Point2D = { x: origin.x + s * 64, y: origin.y + 56 * v };
        countEndpoint(gWorld);
        countEndpoint(dWorld);
        countEndpoint(sWorld);
        anchors.set(baseName, dWorld);
        anchors.set(`${baseName}.g`, gWorld);
        anchors.set(`${baseName}.gate`, gWorld);
        anchors.set(`${baseName}.d`, dWorld);
        anchors.set(`${baseName}.drain`, dWorld);
        anchors.set(`${baseName}.s`, sWorld);
        anchors.set(`${baseName}.source`, sWorld);
        cx = dWorld.x;
        cy = dWorld.y;
      }
      continue;
    }

    // 2-terminal element (wire, resistor, capacitor, inductor, diode, voltage_dc, voltage_ac, current_source; multi-terminal node, ground, opamp, npn, pnp, nmos, pmos handled above)
    const stepLen = BASE_STEP * (el.length || 1);
    const toAnchorKey = el.toAnchor?.trim();
    const hasExistingToAnchor = Boolean(toAnchorKey && anchors.has(toAnchorKey));
    let p2: Point2D;
    if (hasExistingToAnchor) {
      p2 = { ...anchors.get(toAnchorKey!)! };
    } else {
      p2 = {
        x: p1.x + vec.x * stepLen,
        y: p1.y + vec.y * stepLen,
      };
      if (
        nextEl &&
        nextEl.kind === 'wire' &&
        nextEl.toAnchor &&
        anchors.has(nextEl.toAnchor.trim())
      ) {
        const candAnchor = (el.anchor || el.toAnchor || el.id || '').trim();
        const nextStartsHere =
          !nextEl.fromAnchor ||
          (Boolean(candAnchor) && nextEl.fromAnchor.trim() === candAnchor);
        const usedLater =
          Boolean(candAnchor) &&
          spec.elements.slice(idx + 2).some(
            (later) =>
              later.fromAnchor?.trim() === candAnchor ||
              later.toAnchor?.trim() === candAnchor ||
              later.anchor?.trim() === candAnchor
          );
        if (nextStartsHere && !usedLater) {
          const targetPt = anchors.get(nextEl.toAnchor.trim())!;
          if (dir === 'right' && targetPt.x - p1.x >= 48) {
            p2 = { x: targetPt.x, y: p1.y };
          } else if (dir === 'left' && p1.x - targetPt.x >= 48) {
            p2 = { x: targetPt.x, y: p1.y };
          } else if (dir === 'down' && targetPt.y - p1.y >= 48) {
            p2 = { x: p1.x, y: targetPt.y };
          } else if (dir === 'up' && p1.y - targetPt.y >= 48) {
            p2 = { x: p1.x, y: targetPt.y };
          }
        }
      }
    }

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    countEndpoint(p1);
    countEndpoint(p2);

    if (Math.abs(dx) <= 0.5 || Math.abs(dy) <= 0.5) {
      drawTwoTerminal(el, p1, p2);
    } else {
      const dirH = dir === 'left' || dir === 'right';
      let route: 'hv' | 'vh';
      if (el.route === 'hv' || el.route === 'vh') {
        route = el.route;
      } else {
        const p2WireDir = toAnchorKey ? anchorWireDir.get(toAnchorKey) : undefined;
        if (dirH && p2WireDir === 'up') {
          route = p1.y <= p2.y ? 'hv' : 'vh';
        } else if (dirH && p2WireDir === 'down') {
          route = p1.y >= p2.y ? 'hv' : 'vh';
        } else if (!dirH && p2WireDir === 'left') {
          route = p1.x <= p2.x ? 'vh' : 'hv';
        } else if (!dirH && p2WireDir === 'right') {
          route = p1.x >= p2.x ? 'vh' : 'hv';
        } else {
          route = dirH ? 'hv' : 'vh';
          const oppositeFirst = dirH ? dx * vec.x < 0 : dy * vec.y < 0;
          if (oppositeFirst) {
            route = route === 'hv' ? 'vh' : 'hv';
          }
        }
      }

      const corner: Point2D =
        route === 'hv' ? { x: p2.x, y: p1.y } : { x: p1.x, y: p2.y };
      const leg1: [Point2D, Point2D] = [p1, corner];
      const leg2: [Point2D, Point2D] = [corner, p2];
      const wireCopy: CircuitElementSpec = {
        ...el,
        kind: 'wire',
        label: undefined,
        value: undefined,
        currentLabel: undefined,
      };

      if (el.kind === 'wire') {
        drawTwoTerminal(el, leg1[0], leg1[1]);
        drawTwoTerminal(wireCopy, leg2[0], leg2[1]);
      } else {
        let useLeg1ForComp = (route === 'hv') === dirH;
        const len1 = Math.hypot(leg1[1].x - leg1[0].x, leg1[1].y - leg1[0].y);
        const len2 = Math.hypot(leg2[1].x - leg2[0].x, leg2[1].y - leg2[0].y);
        if (useLeg1ForComp && len1 < 40 && len2 >= 40) {
          useLeg1ForComp = false;
        } else if (!useLeg1ForComp && len2 < 40 && len1 >= 40) {
          useLeg1ForComp = true;
        }
        if (useLeg1ForComp) {
          drawTwoTerminal(el, leg1[0], leg1[1]);
          drawTwoTerminal(wireCopy, leg2[0], leg2[1]);
        } else {
          drawTwoTerminal(wireCopy, leg1[0], leg1[1]);
          drawTwoTerminal(el, leg2[0], leg2[1]);
        }
      }
    }

    if (el.anchor) registerAnchorName(el.anchor, p2);
    if (toAnchorKey && !hasExistingToAnchor) registerAnchorName(toAnchorKey, p2);
    if (el.id) {
      registerAnchorName(el.id, p2);
      registerAnchorName(`${el.id}.start`, p1);
      registerAnchorName(`${el.id}.end`, p2);
    }
    if (el.kind === 'wire') {
      recordWireDir(el.anchor, dir);
      recordWireDir(el.id, dir);
      if (toAnchorKey && !hasExistingToAnchor) recordWireDir(toAnchorKey, dir);
    }

    cx = p2.x;
    cy = p2.y;
  }

  for (const [key, entry] of endpointCounts) {
    if (entry.n >= 3 && !explicitNodeKeys.has(key)) {
      includePoint(entry.pt.x, entry.pt.y, 8, 8);
      shapeParts.push(
        `<circle data-ckt-junction="1" cx="${entry.pt.x.toFixed(1)}" cy="${entry.pt.y.toFixed(1)}" r="3.6" fill="var(--diag-fg, #f4f4f5)" stroke="var(--diag-bg, #09090b)" stroke-width="1"/>`
      );
    }
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
