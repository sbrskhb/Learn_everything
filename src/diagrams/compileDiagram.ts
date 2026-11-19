import {
  type DiagramSpec,
  validateDiagramSpec,
} from './schema';
import { renderCircuitSvg } from './engines/circuit';
import { renderGridAnnotSvg } from './engines/gridAnnot';
import { renderGraphSvg } from './engines/graph';
import { renderPlot2dSvg } from './engines/plot2d';
import { renderWaveDromSvg } from './engines/wavedrom';
import { buildEmbeddedDiagramStyle, escapeXml } from './theme';

const MAX_CACHE_ENTRIES = 500;
const compiledSvgCache = new Map<string, string>();
const inFlightPromises = new Map<string, Promise<string>>();

function setCacheEntry(key: string, svg: string): void {
  if (compiledSvgCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = compiledSvgCache.keys().next().value;
    if (firstKey !== undefined) compiledSvgCache.delete(firstKey);
  }
  compiledSvgCache.set(key, svg);
}

export function buildDiagramErrorSvg(errorMessage: string, title = '结构化图表编译提示'): string {
  const safeMsg = escapeXml(errorMessage).slice(0, 140);
  const safeTitle = escapeXml(title);
  return `<svg data-diagram-engine="error" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 110" width="100%" style="max-width: 100%; height: auto;">${buildEmbeddedDiagramStyle()}<rect x="1" y="1" width="638" height="108" rx="8" fill="var(--diag-bg, #09090b)" stroke="var(--diag-negative, #fb7185)" stroke-width="1.4" stroke-dasharray="5,3"/><text x="20" y="34" font-size="13" font-weight="600" fill="var(--diag-negative-text, #fda4af)">${safeTitle}</text><text x="20" y="64" font-size="12" fill="var(--diag-fg, #f4f4f5)">${safeMsg}</text></svg>`;
}

export function isSyncDiagramType(type: DiagramSpec['type']): boolean {
  return type === 'grid-annot' || type === 'plot2d' || type === 'circuit';
}

export function getCachedCompiledDiagramSvg(
  rawSpec: unknown,
  fallbackType?: string
): string | null {
  const validation = validateDiagramSpec(rawSpec, fallbackType);
  if (!validation.success) return null;
  const key = JSON.stringify(validation.data);
  return compiledSvgCache.get(key) ?? null;
}

/**
 * Synchronously compile deterministic diagrams (`grid-annot`, `plot2d`, `circuit`)
 * or return cached SVG for async engines (`graph`, `wavedrom`).
 * Returns `null` when an uncached async engine needs `compileDiagramSpec(...)`.
 */
export function compileDiagramSpecSync(
  rawSpec: unknown,
  fallbackType?: string
): string | null {
  const validation = validateDiagramSpec(rawSpec, fallbackType);
  if (!validation.success) {
    return buildDiagramErrorSvg(validation.error);
  }

  const spec = validation.data;
  const key = JSON.stringify(spec);
  const cached = compiledSvgCache.get(key);
  if (cached) return cached;

  try {
    let svg: string | null = null;
    if (spec.type === 'grid-annot') {
      svg = renderGridAnnotSvg(spec);
    } else if (spec.type === 'plot2d') {
      svg = renderPlot2dSvg(spec);
    } else if (spec.type === 'circuit') {
      svg = renderCircuitSvg(spec);
    }
    if (svg) {
      setCacheEntry(key, svg);
    }
    return svg;
  } catch (err: any) {
    return buildDiagramErrorSvg(err?.message || '同步图表渲染失败');
  }
}

/**
 * Compile any of the 5 structured DiagramSpec types (`grid-annot`, `plot2d`, `graph`, `wavedrom`, `circuit`)
 * into a deterministic, responsive SVG string with dark-screen & print dual-theme support.
 */
export async function compileDiagramSpec(
  rawSpec: unknown,
  fallbackType?: string
): Promise<string> {
  const validation = validateDiagramSpec(rawSpec, fallbackType);
  if (!validation.success) {
    return buildDiagramErrorSvg(validation.error);
  }

  const spec = validation.data;
  const key = JSON.stringify(spec);
  const cached = compiledSvgCache.get(key);
  if (cached) return cached;

  const syncResult = compileDiagramSpecSync(spec);
  if (syncResult) return syncResult;

  const pending = inFlightPromises.get(key);
  if (pending) return pending;

  const task = (async () => {
    try {
      let svg: string;
      if (spec.type === 'graph') {
        svg = await renderGraphSvg(spec);
      } else if (spec.type === 'wavedrom') {
        svg = await renderWaveDromSvg(spec);
      } else {
        svg = compileDiagramSpecSync(spec) || buildDiagramErrorSvg('未支持的图表类型');
      }
      setCacheEntry(key, svg);
      return svg;
    } catch (err: any) {
      return buildDiagramErrorSvg(err?.message || '异步图表编译失败');
    } finally {
      inFlightPromises.delete(key);
    }
  })();

  inFlightPromises.set(key, task);
  return task;
}
