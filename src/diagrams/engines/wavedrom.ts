import type { WaveDromSpec } from '../schema';
import {
  buildEmbeddedDiagramStyle,
  estimateSvgLabelWidth,
  hashSpecKey,
  renderMathTextSvg,
} from '../theme';

let waveDepsPromise: Promise<{ wavedrom: any; onml: any }> | null = null;

async function getWaveDeps(): Promise<{ wavedrom: any; onml: any }> {
  if (!waveDepsPromise) {
    waveDepsPromise = Promise.all([import('wavedrom'), import('onml')]).then(([wMod, oMod]) => {
      const wAny: any = wMod;
      const oAny: any = oMod;
      const wavedrom = wAny?.default?.renderAny ? wAny.default : wAny;
      const onml = oAny?.default?.stringify ? oAny.default : oAny;
      return { wavedrom, onml };
    });
  }
  return waveDepsPromise;
}

function scopeSvgIds(svgContent: string, suffix: string): string {
  const idSet = new Set<string>();
  svgContent.replace(/\bid="([^"]+)"/g, (_m, id: string) => {
    idSet.add(id);
    return _m;
  });
  if (idSet.size === 0) return svgContent;

  const mapId = (id: string) => (idSet.has(id) ? `${id}_${suffix}` : id);

  return svgContent
    .replace(/\bid="([^"]+)"/g, (_m, id: string) => `id="${mapId(id)}"`)
    .replace(/\b((?:xlink:)?href)="#([^"]+)"/g, (_m, attr: string, id: string) => `${attr}="#${mapId(id)}"`)
    .replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${mapId(id)})`);
}

const WAVEDROM_THEME_CSS = `
svg[data-diagram-engine="wavedrom"] text {
  fill: var(--diag-fg, #f4f4f5);
}
svg[data-diagram-engine="wavedrom"] .muted {
  fill: var(--diag-muted, #a1a1aa);
}
svg[data-diagram-engine="wavedrom"] .info {
  fill: var(--diag-accent-text, #7dd3fc);
}
svg[data-diagram-engine="wavedrom"] .warning {
  fill: var(--diag-warn-text, #fde68a);
}
svg[data-diagram-engine="wavedrom"] .error {
  fill: var(--diag-negative-text, #fda4af);
}
svg[data-diagram-engine="wavedrom"] .success {
  fill: var(--diag-positive-text, #6ee7b7);
}
svg[data-diagram-engine="wavedrom"] .s1,
svg[data-diagram-engine="wavedrom"] .s2,
svg[data-diagram-engine="wavedrom"] .s3,
svg[data-diagram-engine="wavedrom"] .s4 {
  stroke: var(--diag-default-stroke, #e4e4e7) !important;
}
svg[data-diagram-engine="wavedrom"] .s5,
svg[data-diagram-engine="wavedrom"] .s7 {
  fill: var(--diag-bg, #09090b) !important;
}
svg[data-diagram-engine="wavedrom"] .s6 {
  fill: var(--diag-default-stroke, #e4e4e7) !important;
}
svg[data-diagram-engine="wavedrom"] .s8 { fill: rgba(250, 204, 21, 0.24) !important; }
svg[data-diagram-engine="wavedrom"] .s9 { fill: rgba(251, 146, 60, 0.26) !important; }
svg[data-diagram-engine="wavedrom"] .s10 { fill: rgba(56, 189, 248, 0.24) !important; }
svg[data-diagram-engine="wavedrom"] .s11 { fill: rgba(34, 211, 238, 0.22) !important; }
svg[data-diagram-engine="wavedrom"] .s12 { fill: rgba(52, 211, 153, 0.24) !important; }
svg[data-diagram-engine="wavedrom"] .s13 { fill: rgba(192, 132, 252, 0.24) !important; }
svg[data-diagram-engine="wavedrom"] .s14 { fill: rgba(251, 113, 133, 0.26) !important; }
svg[data-diagram-engine="wavedrom"] .s15 {
  fill: var(--diag-accent, #38bdf8) !important;
}
svg[data-diagram-engine="wavedrom"] .s16 {
  stroke: var(--diag-accent, #38bdf8) !important;
}
svg[data-diagram-engine="wavedrom"] marker,
svg[data-diagram-engine="wavedrom"] marker path {
  fill: var(--diag-accent, #38bdf8) !important;
}
svg[data-diagram-engine="wavedrom"] g[stroke="black"] {
  stroke: var(--diag-default-stroke, #e4e4e7) !important;
}
svg[data-diagram-engine="wavedrom"] line[stroke="black"] {
  stroke: var(--diag-default-stroke, #e4e4e7) !important;
}
@media print {
  svg[data-diagram-engine="wavedrom"] .s8 { fill: #fef08a !important; }
  svg[data-diagram-engine="wavedrom"] .s9 { fill: #fed7aa !important; }
  svg[data-diagram-engine="wavedrom"] .s10 { fill: #bae6fd !important; }
  svg[data-diagram-engine="wavedrom"] .s11 { fill: #a5f3fc !important; }
  svg[data-diagram-engine="wavedrom"] .s12 { fill: #bbf7d0 !important; }
  svg[data-diagram-engine="wavedrom"] .s13 { fill: #e9d5ff !important; }
  svg[data-diagram-engine="wavedrom"] .s14 { fill: #fecdd3 !important; }
}
`;

export async function renderWaveDromSvg(spec: WaveDromSpec): Promise<string> {
  const { wavedrom, onml } = await getWaveDeps();

  const waveSource: Record<string, any> = {};
  if (Array.isArray(spec.signal) && spec.signal.length > 0) {
    waveSource.signal = spec.signal;
    if (spec.head) waveSource.head = spec.head;
    if (spec.foot) waveSource.foot = spec.foot;
    if (spec.edge) waveSource.edge = spec.edge;
    if (spec.config) waveSource.config = spec.config;
  } else if (Array.isArray(spec.reg) && spec.reg.length > 0) {
    waveSource.reg = spec.reg;
    if (spec.config) waveSource.config = spec.config;
  }

  const ml = wavedrom.renderAny(0, waveSource, wavedrom.waveSkin);
  const rawSvg: string = onml.stringify(ml);

  // Extract dimensions from WaveDrom's root <svg>
  const vbMatch = rawSvg.match(/viewBox="([^"]+)"/i);
  const vbNums = (vbMatch?.[1] || '').trim().split(/[\s,]+/).map(Number);
  const wAttrMatch = rawSvg.match(/\bwidth="([0-9.]+)"/i);
  const hAttrMatch = rawSvg.match(/\bheight="([0-9.]+)"/i);

  const innerW =
    vbNums.length === 4 && Number.isFinite(vbNums[2]) && vbNums[2] > 0
      ? vbNums[2]
      : wAttrMatch
        ? Math.max(120, Number(wAttrMatch[1]) || 480)
        : 480;
  const innerH =
    vbNums.length === 4 && Number.isFinite(vbNums[3]) && vbNums[3] > 0
      ? vbNums[3]
      : hAttrMatch
        ? Math.max(40, Number(hAttrMatch[1]) || 120)
        : 120;

  // Strip outer <svg ...>...</svg> wrapper and remove hardcoded white canvas rect
  let innerBody = rawSvg
    .replace(/^<svg\b[^>]*>/i, '')
    .replace(/<\/svg>\s*$/i, '')
    .replace(/<rect\b[^>]*style="stroke:none;fill:white"[^>]*\/?>/gi, '');

  const specHash = hashSpecKey(JSON.stringify(spec));
  innerBody = scopeSvgIds(innerBody, `wd_${specHash}`);

  // Replace hardcoded #0041c4 stroke on marker tee if present
  innerBody = innerBody.replace(/#0041c4/gi, 'var(--diag-accent, #38bdf8)');
  innerBody = innerBody.replace(/stroke="#888"/gi, 'stroke="var(--diag-grid, rgba(255,255,255,0.22))"');
  innerBody = innerBody.replace(/stroke:#888/gi, 'stroke:var(--diag-grid, rgba(255,255,255,0.22))');

  const padX = 16;
  const titleH = spec.title ? 32 : 0;
  const padTop = 12 + titleH;
  const padBottom = 14;
  const titleW = spec.title ? Math.ceil(estimateSvgLabelWidth(spec.title, 15) + 48) : 0;
  const totalW = Math.max(Math.ceil(innerW + padX * 2), titleW, 240);
  const totalH = Math.ceil(innerH + padTop + padBottom);
  const contentOffsetX = Math.max(padX, (totalW - innerW) / 2);

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

  return `<svg data-diagram-engine="wavedrom" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${totalW} ${totalH}" width="100%" style="max-width: 100%; height: auto;">${buildEmbeddedDiagramStyle(WAVEDROM_THEME_CSS)}<rect x="0" y="0" width="${totalW}" height="${totalH}" rx="10" fill="var(--diag-bg, #09090b)" stroke="var(--diag-border, #2e3440)" stroke-width="1"/>${titleSvg}<g transform="translate(${contentOffsetX.toFixed(1)}, ${padTop})">${innerBody}</g></svg>`;
}
