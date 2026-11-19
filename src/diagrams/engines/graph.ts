import type { GraphSpec } from '../schema';
import {
  buildArrowMarkerDefs,
  buildEmbeddedDiagramStyle,
  DiagramTone,
  estimateSvgLabelWidth,
  getStrokeDashArray,
  getToneColors,
  hashSpecKey,
  renderMathTextSvg,
} from '../theme';

interface Point2D {
  x: number;
  y: number;
}

let cachedElkInstance: any | null = null;

async function getElkInstance(): Promise<any> {
  if (cachedElkInstance) return cachedElkInstance;
  const mod: any = await import('elkjs/lib/elk.bundled.js');
  const ElkCtor = mod?.default?.default || mod?.default || mod;
  cachedElkInstance = new ElkCtor();
  return cachedElkInstance;
}

function buildRoundedOrthogonalPath(pts: Point2D[], radius = 8): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  if (pts.length === 2) {
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
  }

  const cmds: string[] = [`M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];

    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const len1 = Math.hypot(v1x, v1y);

    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const len2 = Math.hypot(v2x, v2y);

    if (len1 < 1 || len2 < 1) {
      cmds.push(`L ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`);
      continue;
    }

    const r = Math.min(radius, len1 * 0.4, len2 * 0.4);
    const pIn = {
      x: curr.x - (v1x / len1) * r,
      y: curr.y - (v1y / len1) * r,
    };
    const pOut = {
      x: curr.x + (v2x / len2) * r,
      y: curr.y + (v2y / len2) * r,
    };

    cmds.push(`L ${pIn.x.toFixed(1)} ${pIn.y.toFixed(1)}`);
    cmds.push(`Q ${curr.x.toFixed(1)} ${curr.y.toFixed(1)} ${pOut.x.toFixed(1)} ${pOut.y.toFixed(1)}`);
  }

  const last = pts[pts.length - 1];
  cmds.push(`L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`);
  return cmds.join(' ');
}

function findLongestSegmentMidpoint(pts: Point2D[]): Point2D {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0];
  let bestLen = -1;
  let bestMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (len > bestLen) {
      bestLen = len;
      bestMid = {
        x: (pts[i].x + pts[i + 1].x) / 2,
        y: (pts[i].y + pts[i + 1].y) / 2,
      };
    }
  }
  return bestMid;
}

function computeNodeSize(node: GraphSpec['nodes'][number]): { width: number; height: number } {
  const mainText = node.label || node.id;
  const subText = node.subLabel || '';
  const maxTextW = Math.max(
    estimateSvgLabelWidth(mainText, 13),
    subText ? estimateSvgLabelWidth(subText, 11) : 0
  );

  switch (node.shape) {
    case 'sum':
      return { width: 44, height: 44 };
    case 'circle': {
      const d = Math.max(48, Math.min(130, Math.ceil(maxTextW + 24)));
      return { width: d, height: d };
    }
    case 'diamond':
      return {
        width: Math.max(96, Math.ceil(maxTextW + 48)),
        height: subText ? 68 : 56,
      };
    case 'pill':
      return {
        width: Math.max(92, Math.ceil(maxTextW + 38)),
        height: subText ? 54 : 40,
      };
    case 'rect':
    case 'round':
    default:
      return {
        width: Math.max(88, Math.ceil(maxTextW + 32)),
        height: subText ? 56 : 42,
      };
  }
}

export async function renderGraphSvg(spec: GraphSpec): Promise<string> {
  const elk = await getElkInstance();

  const directionMap: Record<string, string> = {
    LR: 'RIGHT',
    TB: 'DOWN',
    RL: 'LEFT',
    BT: 'UP',
  };

  const nodeMap = new Map(spec.nodes.map((n) => [n.id, n]));
  const validEdges = (spec.edges || []).filter(
    (e) => nodeMap.has(e.from) && nodeMap.has(e.to)
  );

  const elkChildren = spec.nodes.map((n) => {
    const size = computeNodeSize(n);
    return {
      id: n.id,
      width: size.width,
      height: size.height,
    };
  });

  const elkEdges = validEdges.map((e, idx) => ({
    id: `e_${idx}`,
    sources: [e.from],
    targets: [e.to],
  }));

  const layoutResult = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': directionMap[spec.direction || 'LR'] || 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '56',
      'elk.layered.spacing.edgeNodeBetweenLayers': '26',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.padding': '[top=26,left=26,bottom=26,right=26]',
    },
    children: elkChildren,
    edges: elkEdges,
  });

  const rawW = Math.max(240, Math.ceil(Number(layoutResult.width) || 360));
  const rawH = Math.max(120, Math.ceil(Number(layoutResult.height) || 180));
  const titleH = spec.title ? 34 : 0;
  const titleW = spec.title ? Math.ceil(estimateSvgLabelWidth(spec.title, 15) + 56) : 0;
  const totalW = Math.max(rawW, titleW);
  const totalH = rawH + titleH;
  const offsetX = Math.max(0, (totalW - rawW) / 2);
  const offsetY = titleH;

  const specHash = hashSpecKey(JSON.stringify(spec));
  const markerPrefix = `gr-${specHash}`;
  const markerDefs = buildArrowMarkerDefs(markerPrefix, [
    'default',
    'accent',
    'positive',
    'negative',
    'warn',
    'purple',
    'muted',
  ]);

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

  // Render edges first (below nodes)
  const laidOutEdges: any[] = Array.isArray(layoutResult.edges) ? layoutResult.edges : [];
  for (let idx = 0; idx < laidOutEdges.length; idx++) {
    const elkEdge = laidOutEdges[idx];
    const edgeSpec = validEdges[idx];
    if (!edgeSpec) continue;
    const tone: DiagramTone = edgeSpec.tone || 'default';
    const palette = getToneColors(tone);
    const dash = getStrokeDashArray(edgeSpec.style);
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';

    const sections: any[] = Array.isArray(elkEdge.sections) ? elkEdge.sections : [];
    const pts: Point2D[] = [];
    for (const sec of sections) {
      if (sec.startPoint) {
        pts.push({ x: sec.startPoint.x + offsetX, y: sec.startPoint.y + offsetY });
      }
      if (Array.isArray(sec.bendPoints)) {
        for (const bp of sec.bendPoints) {
          pts.push({ x: bp.x + offsetX, y: bp.y + offsetY });
        }
      }
      if (sec.endPoint) {
        pts.push({ x: sec.endPoint.x + offsetX, y: sec.endPoint.y + offsetY });
      }
    }
    if (pts.length < 2) continue;

    const pathD = buildRoundedOrthogonalPath(pts, 8);
    const markerEndAttr = ` marker-end="url(#${markerPrefix}-arrow-${tone})"`;
    const markerStartAttr = edgeSpec.bidirectional
      ? ` marker-start="url(#${markerPrefix}-arrow-${tone})"`
      : '';

    parts.push(
      `<path d="${pathD}" fill="none" stroke="${palette.stroke}" stroke-width="1.8"${dashAttr}${markerStartAttr}${markerEndAttr}/>`
    );

    if (edgeSpec.label) {
      const mid = findLongestSegmentMidpoint(pts);
      const lw = Math.max(24, estimateSvgLabelWidth(edgeSpec.label, 11) + 12);
      const lx = Math.max(lw / 2 + 6, Math.min(totalW - lw / 2 - 6, mid.x));
      const ly = Math.max(titleH + 12, Math.min(totalH - 12, mid.y));
      parts.push(
        `<rect x="${(lx - lw / 2).toFixed(1)}" y="${(ly - 9.5).toFixed(1)}" width="${lw.toFixed(1)}" height="19" rx="9.5" fill="${palette.badgeBg}" stroke="${palette.badgeBorder}" stroke-width="1"/>`
      );
      parts.push(
        renderMathTextSvg({
          x: lx,
          y: ly,
          text: edgeSpec.label,
          fontSize: 11,
          fontWeight: 500,
          fill: palette.text,
        })
      );
    }
  }

  // Render nodes
  const laidOutNodes: any[] = Array.isArray(layoutResult.children) ? layoutResult.children : [];
  for (const ln of laidOutNodes) {
    const nodeSpec = nodeMap.get(ln.id);
    if (!nodeSpec) continue;
    const x = (Number(ln.x) || 0) + offsetX;
    const y = (Number(ln.y) || 0) + offsetY;
    const w = Number(ln.width) || 88;
    const h = Number(ln.height) || 42;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const palette = getToneColors(nodeSpec.tone || 'default');
    const shape = nodeSpec.shape || 'round';

    if (shape === 'sum') {
      const r = Math.min(w, h) / 2;
      parts.push(
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${palette.solidFill}" stroke="${palette.stroke}" stroke-width="1.8"/>`
      );
      const crossR = r * 0.45;
      if (!nodeSpec.label || nodeSpec.label === '+' || nodeSpec.label === 'Σ') {
        if (nodeSpec.label === 'Σ') {
          parts.push(
            renderMathTextSvg({
              x: cx,
              y: cy,
              text: 'Σ',
              fontSize: 16,
              fontWeight: 600,
              fill: palette.text,
            })
          );
        } else {
          parts.push(
            `<line x1="${(cx - crossR).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(cx + crossR).toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${palette.stroke}" stroke-width="1.8"/>`
          );
          parts.push(
            `<line x1="${cx.toFixed(1)}" y1="${(cy - crossR).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(cy + crossR).toFixed(1)}" stroke="${palette.stroke}" stroke-width="1.8"/>`
          );
        }
      } else {
        parts.push(
          renderMathTextSvg({
            x: cx,
            y: cy,
            text: nodeSpec.label,
            fontSize: 13,
            fontWeight: 600,
            fill: palette.text,
          })
        );
      }
      continue;
    }

    if (shape === 'circle') {
      const r = Math.min(w, h) / 2;
      parts.push(
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="1.8"/>`
      );
    } else if (shape === 'diamond') {
      const d = `M ${cx.toFixed(1)} ${y.toFixed(1)} L ${(x + w).toFixed(1)} ${cy.toFixed(1)} L ${cx.toFixed(1)} ${(y + h).toFixed(1)} L ${x.toFixed(1)} ${cy.toFixed(1)} Z`;
      parts.push(
        `<path d="${d}" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="1.8" stroke-linejoin="round"/>`
      );
    } else if (shape === 'pill') {
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(h / 2).toFixed(1)}" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="1.8"/>`
      );
    } else {
      const rx = shape === 'rect' ? 3 : 8;
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="1.8"/>`
      );
    }

    const mainLabel = nodeSpec.label || nodeSpec.id;
    if (nodeSpec.subLabel) {
      parts.push(
        renderMathTextSvg({
          x: cx,
          y: cy - 8,
          text: mainLabel,
          fontSize: 13,
          fontWeight: 600,
          fill: 'var(--diag-fg, #f4f4f5)',
        })
      );
      parts.push(
        renderMathTextSvg({
          x: cx,
          y: cy + 10,
          text: nodeSpec.subLabel,
          fontSize: 11,
          fill: palette.text,
        })
      );
    } else {
      parts.push(
        renderMathTextSvg({
          x: cx,
          y: cy,
          text: mainLabel,
          fontSize: 13,
          fontWeight: 600,
          fill: 'var(--diag-fg, #f4f4f5)',
        })
      );
    }
  }

  return `<svg data-diagram-engine="graph" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="100%" style="max-width: 100%; height: auto;">${buildEmbeddedDiagramStyle()}<defs>${markerDefs}</defs>${parts.join('')}</svg>`;
}
