import { formatSvgTextContentToTspans, normalizeSvgLatexCommands } from '../utils/svgMath';

export type DiagramTone =
  | 'default'
  | 'accent'
  | 'positive'
  | 'negative'
  | 'warn'
  | 'purple'
  | 'muted';

export interface TonePalette {
  stroke: string;
  fill: string;
  solidFill: string;
  text: string;
  badgeBg: string;
  badgeBorder: string;
}

const TONE_PALETTES: Record<DiagramTone, TonePalette> = {
  default: {
    stroke: 'var(--diag-default-stroke, #e4e4e7)',
    fill: 'var(--diag-default-fill, rgba(255, 255, 255, 0.06))',
    solidFill: 'var(--diag-surface, #111318)',
    text: 'var(--diag-default-text, #f4f4f5)',
    badgeBg: 'var(--diag-surface-alt, #171a21)',
    badgeBorder: 'var(--diag-border, #2e3440)',
  },
  accent: {
    stroke: 'var(--diag-accent, #38bdf8)',
    fill: 'var(--diag-accent-fill, rgba(56, 189, 248, 0.16))',
    solidFill: 'var(--diag-surface, #0c1926)',
    text: 'var(--diag-accent-text, #7dd3fc)',
    badgeBg: 'var(--diag-bg, #09090b)',
    badgeBorder: 'var(--diag-accent, #38bdf8)',
  },
  positive: {
    stroke: 'var(--diag-positive, #34d399)',
    fill: 'var(--diag-positive-fill, rgba(52, 211, 153, 0.16))',
    solidFill: 'var(--diag-surface, #0b1f19)',
    text: 'var(--diag-positive-text, #6ee7b7)',
    badgeBg: 'var(--diag-bg, #09090b)',
    badgeBorder: 'var(--diag-positive, #34d399)',
  },
  negative: {
    stroke: 'var(--diag-negative, #fb7185)',
    fill: 'var(--diag-negative-fill, rgba(251, 113, 133, 0.16))',
    solidFill: 'var(--diag-surface, #241016)',
    text: 'var(--diag-negative-text, #fda4af)',
    badgeBg: 'var(--diag-bg, #09090b)',
    badgeBorder: 'var(--diag-negative, #fb7185)',
  },
  warn: {
    stroke: 'var(--diag-warn, #fbbf24)',
    fill: 'var(--diag-warn-fill, rgba(251, 191, 36, 0.16))',
    solidFill: 'var(--diag-surface, #221a09)',
    text: 'var(--diag-warn-text, #fde68a)',
    badgeBg: 'var(--diag-bg, #09090b)',
    badgeBorder: 'var(--diag-warn, #fbbf24)',
  },
  purple: {
    stroke: 'var(--diag-purple, #c084fc)',
    fill: 'var(--diag-purple-fill, rgba(192, 132, 252, 0.16))',
    solidFill: 'var(--diag-surface, #1d1229)',
    text: 'var(--diag-purple-text, #e9d5ff)',
    badgeBg: 'var(--diag-bg, #09090b)',
    badgeBorder: 'var(--diag-purple, #c084fc)',
  },
  muted: {
    stroke: 'var(--diag-muted-stroke, #71717a)',
    fill: 'var(--diag-muted-fill, rgba(113, 113, 122, 0.12))',
    solidFill: 'var(--diag-surface, #111318)',
    text: 'var(--diag-muted-text, #a1a1aa)',
    badgeBg: 'var(--diag-bg, #09090b)',
    badgeBorder: 'var(--diag-muted-stroke, #71717a)',
  },
};

export function getToneColors(tone?: DiagramTone | string): TonePalette {
  if (tone && tone in TONE_PALETTES) {
    return TONE_PALETTES[tone as DiagramTone];
  }
  return TONE_PALETTES.default;
}

export const PLOT_CURVE_TONES: DiagramTone[] = [
  'accent',
  'positive',
  'warn',
  'purple',
  'negative',
];

export function escapeXml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDiagramTextTspans(raw: string): string {
  return formatSvgTextContentToTspans(String(raw ?? ''));
}

export function estimateSvgLabelWidth(rawText: string, fontSize = 13): number {
  const clean = normalizeSvgLatexCommands(String(rawText ?? ''))
    .replace(/[_^{}]/g, '')
    .trim();
  if (!clean) return 0;
  let units = 0;
  for (const ch of clean) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) {
      units += 1.02;
    } else if (/[A-ZMW]/.test(ch)) {
      units += 0.68;
    } else if (/[ijlI1.,:;!|'\s]/.test(ch)) {
      units += 0.34;
    } else {
      units += 0.56;
    }
  }
  return units * fontSize;
}

export function renderMathTextSvg(params: {
  x: number;
  y: number;
  text: string;
  fontSize?: number;
  fontWeight?: string | number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  dominantBaseline?: 'auto' | 'middle' | 'central' | 'hanging';
  className?: string;
}): string {
  const {
    x,
    y,
    text,
    fontSize = 13,
    fontWeight,
    fill = 'var(--diag-fg, #f4f4f5)',
    anchor = 'middle',
    dominantBaseline = 'central',
    className,
  } = params;
  const attrs = [
    `x="${Number(x.toFixed(2))}"`,
    `y="${Number(y.toFixed(2))}"`,
    `font-size="${fontSize}"`,
    fontWeight ? `font-weight="${fontWeight}"` : '',
    `fill="${fill}"`,
    `text-anchor="${anchor}"`,
    `dominant-baseline="${dominantBaseline}"`,
    className ? `class="${escapeXml(className)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<text ${attrs}>${formatDiagramTextTspans(text)}</text>`;
}

export function hashSpecKey(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function getStrokeDashArray(style?: 'solid' | 'dashed' | 'dotted', dashed?: boolean): string {
  if (style === 'dotted') return '2.5,4';
  if (style === 'dashed' || dashed) return '6,4';
  return '';
}

export function buildEmbeddedDiagramStyle(extraCss = ''): string {
  return `<style>
svg[data-diagram-engine] {
  --diag-bg: #09090b;
  --diag-surface: #111318;
  --diag-surface-alt: #171a21;
  --diag-border: #2e3440;
  --diag-grid: rgba(255, 255, 255, 0.08);
  --diag-axis: #94a3b8;
  --diag-fg: #f4f4f5;
  --diag-muted: #a1a1aa;
  --diag-default-stroke: #e4e4e7;
  --diag-default-fill: rgba(255, 255, 255, 0.06);
  --diag-default-text: #f4f4f5;
  --diag-muted-stroke: #71717a;
  --diag-muted-fill: rgba(113, 113, 122, 0.12);
  --diag-muted-text: #a1a1aa;
  --diag-accent: #38bdf8;
  --diag-accent-fill: rgba(56, 189, 248, 0.16);
  --diag-accent-text: #7dd3fc;
  --diag-positive: #34d399;
  --diag-positive-fill: rgba(52, 211, 153, 0.16);
  --diag-positive-text: #6ee7b7;
  --diag-negative: #fb7185;
  --diag-negative-fill: rgba(251, 113, 133, 0.16);
  --diag-negative-text: #fda4af;
  --diag-warn: #fbbf24;
  --diag-warn-fill: rgba(251, 191, 36, 0.16);
  --diag-warn-text: #fde68a;
  --diag-purple: #c084fc;
  --diag-purple-fill: rgba(192, 132, 252, 0.16);
  --diag-purple-text: #e9d5ff;
  font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
}
@media print {
  svg[data-diagram-engine] {
    --diag-bg: #ffffff;
    --diag-surface: #f8fafc;
    --diag-surface-alt: #f1f5f9;
    --diag-border: #94a3b8;
    --diag-grid: rgba(15, 23, 42, 0.10);
    --diag-axis: #334155;
    --diag-fg: #0f172a;
    --diag-muted: #475569;
    --diag-default-stroke: #1e293b;
    --diag-default-fill: rgba(15, 23, 42, 0.04);
    --diag-default-text: #0f172a;
    --diag-muted-stroke: #64748b;
    --diag-muted-fill: rgba(100, 116, 139, 0.10);
    --diag-muted-text: #475569;
    --diag-accent: #0284c7;
    --diag-accent-fill: rgba(2, 132, 199, 0.12);
    --diag-accent-text: #0369a1;
    --diag-positive: #059669;
    --diag-positive-fill: rgba(5, 150, 105, 0.12);
    --diag-positive-text: #047857;
    --diag-negative: #dc2626;
    --diag-negative-fill: rgba(220, 38, 38, 0.12);
    --diag-negative-text: #b91c1c;
    --diag-warn: #d97706;
    --diag-warn-fill: rgba(217, 119, 6, 0.12);
    --diag-warn-text: #b45309;
    --diag-purple: #7c3aed;
    --diag-purple-fill: rgba(124, 58, 237, 0.12);
    --diag-purple-text: #6d28d9;
  }
}
${extraCss}
</style>`;
}

export function buildArrowMarkerDefs(prefix: string, tones: DiagramTone[]): string {
  const uniqueTones = Array.from(new Set<DiagramTone>(tones));
  return uniqueTones
    .map((tone) => {
      const palette = getToneColors(tone);
      const id = `${prefix}-arrow-${tone}`;
      return `<marker id="${id}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1.5 L 9 5 L 1 8.5 z" fill="${palette.stroke}"/></marker>`;
    })
    .join('');
}
