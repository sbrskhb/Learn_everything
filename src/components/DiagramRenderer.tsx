import React, { useEffect, useMemo, useState } from 'react';
import type { DailyLessonContent, DiagramSpec } from '../types';
import {
  compileDiagramSpec,
  compileDiagramSpecSync,
} from '../diagrams/compileDiagram';
import { enhanceDiagramSvg } from '../utils/svgMath';

export interface DiagramRendererProps {
  spec?: DiagramSpec;
  svgCode?: string;
  className?: string;
  testId?: string;
}

export const DiagramRenderer: React.FC<DiagramRendererProps> = ({
  spec,
  svgCode,
  className = '',
  testId,
}) => {
  const specKey = useMemo(() => (spec ? JSON.stringify(spec) : ''), [spec]);

  const syncSvg = useMemo(() => {
    if (spec) {
      return compileDiagramSpecSync(spec);
    }
    if (svgCode) {
      return enhanceDiagramSvg(svgCode);
    }
    return '';
  }, [spec, specKey, svgCode]);

  const [asyncResult, setAsyncResult] = useState<{ key: string; svg: string } | null>(null);

  useEffect(() => {
    if (!spec || syncSvg !== null) {
      return;
    }
    let cancelled = false;
    compileDiagramSpec(spec).then((svg) => {
      if (!cancelled) {
        setAsyncResult({ key: specKey, svg });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [spec, specKey, syncSvg]);

  const resolvedSvg =
    syncSvg !== null
      ? syncSvg
      : asyncResult && asyncResult.key === specKey
        ? asyncResult.svg
        : null;

  if (resolvedSvg === null) {
    return (
      <span
        data-testid={testId}
        className={`block w-full rounded border border-neutral-800/80 bg-neutral-950/60 px-4 py-8 text-center text-xs font-mono text-neutral-400 animate-pulse ${className}`}
      >
        正在渲染结构化矢量图（{spec?.type}）...
      </span>
    );
  }

  return (
    <span
      data-testid={testId}
      className={`block w-full ${className}`}
      dangerouslySetInnerHTML={{ __html: resolvedSvg }}
    />
  );
};

/**
 * Compile all `diagramSpec` entries across a lesson (`diagrams[]` & `exercises[]`)
 * into a map of diagram ID -> SVG string, supporting both instant sync engines and async layout engines.
 */
export function useCompiledLessonDiagrams(
  lesson: DailyLessonContent | null | undefined
): Record<string, string> {
  const specsList = useMemo(() => {
    if (!lesson) return [] as Array<{ key: string; spec: DiagramSpec }>;
    const items: Array<{ key: string; spec: DiagramSpec }> = [];
    const seen = new Set<string>();

    (lesson.diagrams || []).forEach((d, idx) => {
      if (!d?.diagramSpec) return;
      const key = (d.id || `diag-${idx + 1}`).trim();
      const norm = key.toLowerCase();
      if (!seen.has(norm)) {
        seen.add(norm);
        items.push({ key, spec: d.diagramSpec });
      }
    });

    (lesson.exercises || []).forEach((ex, idx) => {
      if (!ex?.diagramSpec) return;
      const key = (ex.diagramId || `diag-${ex.id || `ex-${idx + 1}`}`).trim();
      const norm = key.toLowerCase();
      if (!seen.has(norm)) {
        seen.add(norm);
        items.push({ key, spec: ex.diagramSpec });
      }
    });

    return items;
  }, [lesson]);

  const syncMap = useMemo(() => {
    const out: Record<string, string> = {};
    for (const item of specsList) {
      const svg = compileDiagramSpecSync(item.spec);
      if (svg) {
        out[item.key] = svg;
        out[item.key.toLowerCase()] = svg;
      }
    }
    return out;
  }, [specsList]);

  const [asyncMap, setAsyncMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const pending = specsList.filter((item) => !syncMap[item.key]);
    if (pending.length === 0) return;

    let cancelled = false;
    Promise.all(
      pending.map(async (item) => {
        const svg = await compileDiagramSpec(item.spec);
        return { key: item.key, svg };
      })
    ).then((results) => {
      if (cancelled) return;
      setAsyncMap((prev) => {
        const next = { ...prev };
        for (const r of results) {
          next[r.key] = r.svg;
          next[r.key.toLowerCase()] = r.svg;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [specsList, syncMap]);

  return useMemo(() => ({ ...asyncMap, ...syncMap }), [asyncMap, syncMap]);
}

/**
 * Hydrate any async fenced diagram placeholders (`data-diagram-async-spec`) rendered inside
 * Markdown HTML containers (Direct Edit preview or lesson body) once mounted.
 */
export function hydrateAsyncMarkdownDiagrams(container: HTMLElement | null): void {
  if (!container) return;
  const targets = container.querySelectorAll<HTMLElement>('[data-diagram-async-spec]');
  targets.forEach((el) => {
    const rawJson = el.getAttribute('data-diagram-async-spec');
    if (!rawJson) return;
    if (el.getAttribute('data-diagram-hydrating') === '1') return;
    el.setAttribute('data-diagram-hydrating', '1');
    try {
      const parsed = JSON.parse(rawJson);
      compileDiagramSpec(parsed).then((svg) => {
        if (!el.isConnected) return;
        el.innerHTML = svg;
        el.removeAttribute('data-diagram-async-spec');
        el.removeAttribute('data-diagram-hydrating');
        el.setAttribute('data-diagram-hydrated', '1');
      });
    } catch {
      el.removeAttribute('data-diagram-hydrating');
    }
  });
}
