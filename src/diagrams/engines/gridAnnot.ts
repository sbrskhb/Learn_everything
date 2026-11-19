import type { GridAnnotSpec } from '../schema';
import {
  buildArrowMarkerDefs,
  buildEmbeddedDiagramStyle,
  DiagramTone,
  escapeXml,
  estimateSvgLabelWidth,
  getStrokeDashArray,
  getToneColors,
  hashSpecKey,
  renderMathTextSvg,
} from '../theme';

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function renderGridAnnotSvg(spec: GridAnnotSpec): string {
  const numRows = spec.cells.length;
  const numCols = Math.max(1, ...spec.cells.map((r) => r.length));

  // Estimate cell dimensions from cell content + highlight labels
  let maxCellTextW = 32;
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < spec.cells[r].length; c++) {
      const w = estimateSvgLabelWidth(spec.cells[r][c] || '', 14);
      if (w > maxCellTextW) maxCellTextW = w;
    }
  }
  const cellW = Math.max(spec.cellWidth ?? 0, Math.min(180, Math.ceil(maxCellTextW + 30)), 64);
  const cellH = Math.max(spec.cellHeight ?? 0, 48);

  const hasRowHeaders = Array.isArray(spec.rowHeaders) && spec.rowHeaders.length > 0;
  const hasColHeaders = Array.isArray(spec.colHeaders) && spec.colHeaders.length > 0;

  let rowHeaderW = 0;
  if (hasRowHeaders) {
    for (const h of spec.rowHeaders!) {
      rowHeaderW = Math.max(rowHeaderW, estimateSvgLabelWidth(String(h), 12) + 20);
    }
    rowHeaderW = Math.max(46, Math.ceil(rowHeaderW));
  }

  const colHeaderH = hasColHeaders ? 34 : 0;
  const titleH = spec.title ? 34 : 0;
  const bracketPad = spec.brackets && spec.brackets !== 'none' ? 16 : 6;

  // Estimate extra room needed for diagonal labels or curved arrows above/below/right
  let extraRightLabelW = 0;
  let extraTopArcH = 0;
  let extraBottomArcH = 0;

  for (const diag of spec.diagonals || []) {
    if (diag.label) {
      extraRightLabelW = Math.max(extraRightLabelW, estimateSvgLabelWidth(diag.label, 12) + 28);
    }
    const lastCell = diag.cells[diag.cells.length - 1];
    const firstCell = diag.cells[0];
    if (lastCell && firstCell) {
      if (lastCell[0] >= firstCell[0]) extraBottomArcH = Math.max(extraBottomArcH, 34);
      else extraTopArcH = Math.max(extraTopArcH, 30);
    }
  }

  for (const arr of spec.arrows || []) {
    if (arr.curve && arr.curve !== 0) {
      if (arr.curve < 0) extraTopArcH = Math.max(extraTopArcH, Math.abs(arr.curve) + 24);
      else extraBottomArcH = Math.max(extraBottomArcH, Math.abs(arr.curve) + 24);
    }
    if (arr.from[0] === 0 && arr.to[0] === 0 && arr.label) {
      extraTopArcH = Math.max(extraTopArcH, 28);
    }
  }

  const padLeft = 24;
  const padRight = Math.max(24, extraRightLabelW + 16);
  const padTop = 20 + titleH + extraTopArcH;
  const gridX = padLeft + rowHeaderW + bracketPad;
  const gridY = padTop + colHeaderH;
  const gridW = numCols * cellW;
  const gridH = numRows * cellH;

  const notes = spec.notes || [];
  const notesH = notes.length > 0 ? notes.length * 22 + 16 : 0;
  const padBottom = Math.max(24, extraBottomArcH + 16) + notesH;

  let totalW = Math.max(280, gridX + gridW + bracketPad + padRight);
  for (const note of notes) {
    totalW = Math.max(totalW, Math.ceil(estimateSvgLabelWidth(note, 12) + 56));
  }
  if (spec.title) {
    totalW = Math.max(totalW, Math.ceil(estimateSvgLabelWidth(spec.title, 15) + 56));
  }
  const totalH = gridY + gridH + padBottom;

  const specHash = hashSpecKey(JSON.stringify(spec));
  const markerPrefix = `ga-${specHash}`;

  const usedTones: DiagramTone[] = ['default', 'accent', 'positive', 'negative', 'warn', 'purple', 'muted'];
  const markerDefs = buildArrowMarkerDefs(markerPrefix, usedTones);

  const cellCenter = (row: number, col: number) => {
    const r = clampInt(row, 0, numRows - 1);
    const c = clampInt(col, 0, numCols - 1);
    return {
      x: gridX + (c + 0.5) * cellW,
      y: gridY + (r + 0.5) * cellH,
      r,
      c,
    };
  };

  const parts: string[] = [];
  parts.push(
    `<rect x="0" y="0" width="${totalW}" height="${totalH}" rx="10" fill="var(--diag-bg, #09090b)" stroke="var(--diag-border, #2e3440)" stroke-width="1"/>`
  );

  // Title
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

  // Column & Row headers
  if (hasColHeaders) {
    for (let c = 0; c < numCols; c++) {
      const label = spec.colHeaders?.[c];
      if (label === undefined) continue;
      parts.push(
        renderMathTextSvg({
          x: gridX + (c + 0.5) * cellW,
          y: gridY - 16,
          text: String(label),
          fontSize: 12,
          fontWeight: 600,
          fill: 'var(--diag-muted, #a1a1aa)',
        })
      );
    }
  }
  if (hasRowHeaders) {
    for (let r = 0; r < numRows; r++) {
      const label = spec.rowHeaders?.[r];
      if (label === undefined) continue;
      parts.push(
        renderMathTextSvg({
          x: gridX - bracketPad - 10,
          y: gridY + (r + 0.5) * cellH,
          text: String(label),
          fontSize: 12,
          fontWeight: 600,
          fill: 'var(--diag-muted, #a1a1aa)',
          anchor: 'end',
        })
      );
    }
  }

  // Subtle base grid cells (shown cleanly for table/none/box modes, lighter for det/matrix)
  const showInnerGrid = !spec.brackets || spec.brackets === 'none' || spec.brackets === 'box';
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const cx = gridX + c * cellW;
      const cy = gridY + r * cellH;
      if (showInnerGrid) {
        parts.push(
          `<rect x="${cx}" y="${cy}" width="${cellW}" height="${cellH}" fill="var(--diag-surface, #111318)" stroke="var(--diag-border, #2e3440)" stroke-width="1"/>`
        );
      } else {
        parts.push(
          `<rect x="${cx + 2}" y="${cy + 2}" width="${cellW - 4}" height="${cellH - 4}" rx="4" fill="var(--diag-surface, #111318)" fill-opacity="0.45" stroke="var(--diag-grid, rgba(255,255,255,0.08))" stroke-width="0.75"/>`
        );
      }
    }
  }

  // Highlights
  for (const hl of spec.highlights || []) {
    const r = clampInt(hl.row, 0, numRows - 1);
    const c = clampInt(hl.col, 0, numCols - 1);
    const palette = getToneColors(hl.tone || 'accent');
    const hx = gridX + c * cellW + 3;
    const hy = gridY + r * cellH + 3;
    const hw = cellW - 6;
    const hh = cellH - 6;
    parts.push(
      `<rect x="${hx}" y="${hy}" width="${hw}" height="${hh}" rx="6" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="1.6"/>`
    );
    if (hl.label) {
      parts.push(
        renderMathTextSvg({
          x: hx + hw - 5,
          y: hy + 9,
          text: hl.label,
          fontSize: 10,
          fontWeight: 600,
          fill: palette.text,
          anchor: 'end',
        })
      );
    }
  }

  // Cross-cell boxes (e.g. Karnaugh map groups / sub-matrix blocks)
  for (const box of spec.boxes || []) {
    const r1 = clampInt(Math.min(box.from[0], box.to[0]), 0, numRows - 1);
    const r2 = clampInt(Math.max(box.from[0], box.to[0]), 0, numRows - 1);
    const c1 = clampInt(Math.min(box.from[1], box.to[1]), 0, numCols - 1);
    const c2 = clampInt(Math.max(box.from[1], box.to[1]), 0, numCols - 1);
    const palette = getToneColors(box.tone || 'accent');
    const bx = gridX + c1 * cellW + 4;
    const by = gridY + r1 * cellH + 4;
    const bw = (c2 - c1 + 1) * cellW - 8;
    const bh = (r2 - r1 + 1) * cellH - 8;
    const dashAttr = box.dashed ? ' stroke-dasharray="6,4"' : '';
    parts.push(
      `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="10" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="2"${dashAttr}/>`
    );
    if (box.label) {
      const labelW = Math.max(26, estimateSvgLabelWidth(box.label, 11) + 12);
      const lx = Math.min(gridX + gridW - labelW / 2 + 4, bx + bw - labelW / 2 - 4);
      const ly = by - 2;
      parts.push(
        `<rect x="${(lx - labelW / 2).toFixed(1)}" y="${(ly - 9).toFixed(1)}" width="${labelW.toFixed(1)}" height="18" rx="9" fill="${palette.badgeBg}" stroke="${palette.badgeBorder}" stroke-width="1"/>`
      );
      parts.push(
        renderMathTextSvg({
          x: lx,
          y: ly,
          text: box.label,
          fontSize: 11,
          fontWeight: 600,
          fill: palette.text,
        })
      );
    }
  }

  // Brackets for matrix / det / box
  const bColor = 'var(--diag-fg, #f4f4f5)';
  if (spec.brackets === 'det') {
    const lx = gridX - 6;
    const rx = gridX + gridW + 6;
    const ty = gridY + 2;
    const by = gridY + gridH - 2;
    parts.push(
      `<line x1="${lx}" y1="${ty}" x2="${lx}" y2="${by}" stroke="${bColor}" stroke-width="2.2" stroke-linecap="round"/>`
    );
    parts.push(
      `<line x1="${rx}" y1="${ty}" x2="${rx}" y2="${by}" stroke="${bColor}" stroke-width="2.2" stroke-linecap="round"/>`
    );
  } else if (spec.brackets === 'matrix') {
    const lx = gridX - 6;
    const rx = gridX + gridW + 6;
    const ty = gridY + 2;
    const by = gridY + gridH - 2;
    const arm = 8;
    parts.push(
      `<path d="M ${lx + arm} ${ty} L ${lx} ${ty} L ${lx} ${by} L ${lx + arm} ${by}" fill="none" stroke="${bColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
    );
    parts.push(
      `<path d="M ${rx - arm} ${ty} L ${rx} ${ty} L ${rx} ${by} L ${rx - arm} ${by}" fill="none" stroke="${bColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
    );
  } else if (spec.brackets === 'box') {
    parts.push(
      `<rect x="${gridX}" y="${gridY}" width="${gridW}" height="${gridH}" rx="4" fill="none" stroke="${bColor}" stroke-width="1.8"/>`
    );
  }

  // Diagonals (e.g. 3x3 determinant Sarrus rule) drawn behind cell text with translucent strokes
  for (const diag of spec.diagonals || []) {
    const pts = diag.cells.map(([r, c]) => cellCenter(r, c));
    if (pts.length < 2) continue;
    const tone: DiagramTone = diag.tone || 'accent';
    const palette = getToneColors(tone);
    const dash = getStrokeDashArray(diag.style, diag.dashed);
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';

    // Extend start/end slightly past first and last centers so arrows emerge cleanly
    const p0 = pts[0];
    const p1 = pts[1];
    const pPrev = pts[pts.length - 2];
    const pLast = pts[pts.length - 1];
    const startDx = p1.x - p0.x;
    const startDy = p1.y - p0.y;
    const startLen = Math.hypot(startDx, startDy) || 1;
    const extStart = {
      x: p0.x - (startDx / startLen) * 14,
      y: p0.y - (startDy / startLen) * 14,
    };

    const endDx = pLast.x - pPrev.x;
    const endDy = pLast.y - pPrev.y;
    const endLen = Math.hypot(endDx, endDy) || 1;
    const extEnd = {
      x: pLast.x + (endDx / endLen) * 20,
      y: pLast.y + (endDy / endLen) * 20,
    };

    const pathPts = [extStart, ...pts.slice(1, -1), extEnd];
    const dAttr = pathPts
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(' ');

    parts.push(
      `<path d="${dAttr}" fill="none" stroke="${palette.stroke}" stroke-opacity="0.72" stroke-width="2.2"${dashAttr} stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${markerPrefix}-arrow-${tone})"/>`
    );

    if (diag.label) {
      const labelW = Math.max(24, estimateSvgLabelWidth(diag.label, 11) + 12);
      const rawLx = extEnd.x + (endDx / endLen) * (labelW / 2 + 6);
      const rawLy = extEnd.y + (endDy / endLen) * 12;
      const lx = Math.max(labelW / 2 + 8, Math.min(totalW - labelW / 2 - 8, rawLx));
      const ly = Math.max(14, Math.min(totalH - notesH - 12, rawLy));
      parts.push(
        `<rect x="${(lx - labelW / 2).toFixed(1)}" y="${(ly - 9).toFixed(1)}" width="${labelW.toFixed(1)}" height="18" rx="9" fill="${palette.badgeBg}" stroke="${palette.badgeBorder}" stroke-width="1"/>`
      );
      parts.push(
        renderMathTextSvg({
          x: lx,
          y: ly,
          text: diag.label,
          fontSize: 11,
          fontWeight: 600,
          fill: palette.text,
        })
      );
    }
  }

  // Cell text (rendered above diagonal lines so numbers remain 100% legible)
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const val = spec.cells[r]?.[c];
      if (val === undefined || val === '') continue;
      const center = cellCenter(r, c);
      parts.push(
        renderMathTextSvg({
          x: center.x,
          y: center.y,
          text: String(val),
          fontSize: 14,
          fontWeight: 500,
          fill: 'var(--diag-fg, #f4f4f5)',
        })
      );
    }
  }

  // Point-to-point arrows (rendered after cell text with edge trimming & optional Bezier curve)
  for (const arr of spec.arrows || []) {
    const fromPt = cellCenter(arr.from[0], arr.from[1]);
    const toPt = cellCenter(arr.to[0], arr.to[1]);
    const tone: DiagramTone = arr.tone || 'accent';
    const palette = getToneColors(tone);
    const dash = getStrokeDashArray(arr.style, arr.dashed);
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';

    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const dist = Math.hypot(dx, dy);

    let pathD = '';
    let labelPos = { x: (fromPt.x + toPt.x) / 2, y: (fromPt.y + toPt.y) / 2 };

    if (dist < 1) {
      // Self-loop above cell
      const sx = fromPt.x - 10;
      const ex = fromPt.x + 10;
      const sy = fromPt.y - cellH * 0.34;
      const cy = sy - 26;
      pathD = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${(sx - 10).toFixed(1)} ${cy.toFixed(1)}, ${(ex + 10).toFixed(1)} ${cy.toFixed(1)}, ${ex.toFixed(1)} ${sy.toFixed(1)}`;
      labelPos = { x: fromPt.x, y: cy + 2 };
    } else {
      const ux = dx / dist;
      const uy = dy / dist;
      const trimStart = Math.min(dist * 0.25, Math.max(14, Math.min(cellW, cellH) * 0.32));
      const trimEnd = Math.min(dist * 0.25, Math.max(16, Math.min(cellW, cellH) * 0.34));
      const sx = fromPt.x + ux * trimStart;
      const sy = fromPt.y + uy * trimStart;
      const ex = toPt.x - ux * trimEnd;
      const ey = toPt.y - uy * trimEnd;

      const curveOffset = arr.curve ?? (Math.abs(arr.from[0] - arr.to[0]) === 0 && Math.abs(arr.from[1] - arr.to[1]) > 1 ? -28 : 0);
      if (curveOffset !== 0) {
        const nx = -uy;
        const ny = ux;
        const cx = (sx + ex) / 2 + nx * curveOffset;
        const cy = (sy + ey) / 2 + ny * curveOffset;
        pathD = `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
        labelPos = {
          x: 0.25 * sx + 0.5 * cx + 0.25 * ex,
          y: 0.25 * sy + 0.5 * cy + 0.25 * ey,
        };
      } else {
        pathD = `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)}`;
        labelPos = { x: (sx + ex) / 2, y: (sy + ey) / 2 };
      }
    }

    parts.push(
      `<path d="${pathD}" fill="none" stroke="${palette.stroke}" stroke-width="2"${dashAttr} stroke-linecap="round" marker-end="url(#${markerPrefix}-arrow-${tone})"/>`
    );

    if (arr.label) {
      const labelW = Math.max(24, estimateSvgLabelWidth(arr.label, 11) + 12);
      const lx = Math.max(labelW / 2 + 8, Math.min(totalW - labelW / 2 - 8, labelPos.x));
      const ly = Math.max(14, Math.min(totalH - notesH - 12, labelPos.y));
      parts.push(
        `<rect x="${(lx - labelW / 2).toFixed(1)}" y="${(ly - 9).toFixed(1)}" width="${labelW.toFixed(1)}" height="18" rx="9" fill="${palette.badgeBg}" stroke="${palette.badgeBorder}" stroke-width="1"/>`
      );
      parts.push(
        renderMathTextSvg({
          x: lx,
          y: ly,
          text: arr.label,
          fontSize: 11,
          fontWeight: 600,
          fill: palette.text,
        })
      );
    }
  }

  // Footer notes
  if (notes.length > 0) {
    const noteStartY = gridY + gridH + Math.max(24, extraBottomArcH + 10);
    notes.forEach((note, idx) => {
      parts.push(
        renderMathTextSvg({
          x: totalW / 2,
          y: noteStartY + idx * 20,
          text: note,
          fontSize: 12,
          fill: 'var(--diag-muted, #a1a1aa)',
        })
      );
    });
  }

  return `<svg data-diagram-engine="grid-annot" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="100%" style="max-width: 100%; height: auto;">${buildEmbeddedDiagramStyle()}<defs>${markerDefs}</defs>${parts.join('')}</svg>`;
}
