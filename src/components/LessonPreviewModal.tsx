import React, { useMemo } from 'react';
import { Check, Eye, X, AlertTriangle } from 'lucide-react';
import type {
  DailyLessonContent,
  ExerciseQuestion,
  HeuristicQuestionItem,
  LessonDiagram,
} from '../types';
import {
  renderInlineMathWithLatex,
  renderMarkdownWithLatex,
  type VisualAssetRef,
} from '../utils/markdownMath';

interface LessonPreviewModalProps {
  isOpen: boolean;
  lesson: DailyLessonContent | null;
  sectionId?: string;
  dayIndex?: number;
  customAssets?: Record<string, string>;
  hasAuditIssues?: boolean;
  auditSummaryText?: string;
  isSaving?: boolean;
  onClose: () => void;
  onConfirmSave?: () => void;
}

type PreviewBlock =
  | { kind: 'markdown'; html: string }
  | { kind: 'diagram'; diagram: LessonDiagram }
  | { kind: 'heuristic'; heuristic: HeuristicQuestionItem }
  | { kind: 'exercise'; exercise: ExerciseQuestion };

export const LessonPreviewModal: React.FC<LessonPreviewModalProps> = ({
  isOpen,
  lesson,
  sectionId,
  dayIndex,
  customAssets = {},
  hasAuditIssues = false,
  auditSummaryText,
  isSaving = false,
  onClose,
  onConfirmSave,
}) => {
  const visualAssets = useMemo<VisualAssetRef[]>(() => {
    const list: VisualAssetRef[] = [];
    (lesson?.diagrams || []).forEach((d, idx) => {
      list.push({
        id: d.id || `diag-${idx + 1}`,
        title: d.title || d.id || `图 ${idx + 1}`,
        stageLabel: d.stageLabel,
        caption: d.caption,
        kind: d.svgCode ? 'svg' : 'image',
        svgCode: d.svgCode,
        imageUrl: (d as any).imageUrl || (d as any).imageDataUrl,
        index: idx + 1,
      });
    });
    Object.entries(customAssets).forEach(([id, imageUrl], idx) => {
      if (!list.some((item) => item.id === id)) {
        list.push({
          id,
          title: id,
          kind: 'image',
          imageUrl,
          index: list.length + idx + 1,
        });
      }
    });
    return list;
  }, [lesson, customAssets]);

  const { blocks, leftoverDiagrams, leftoverHeuristics, leftoverExercises } = useMemo(() => {
    if (!lesson) {
      return {
        blocks: [] as PreviewBlock[],
        leftoverDiagrams: [] as LessonDiagram[],
        leftoverHeuristics: [] as HeuristicQuestionItem[],
        leftoverExercises: [] as ExerciseQuestion[],
      };
    }

    const diagrams = lesson.diagrams || [];
    const heuristics = lesson.heuristicQuestions || [];
    const exercises = lesson.exercises || [];

    const usedDiag = new Set<number>();
    const usedHq = new Set<number>();
    const usedEx = new Set<number>();

    const findDiag = (ref: string) =>
      diagrams.findIndex(
        (d, idx) =>
          (d.id || `diag-${idx + 1}`).trim().toLowerCase() === ref.trim().toLowerCase()
      );
    const findHq = (ref: string) =>
      heuristics.findIndex(
        (h, idx) =>
          (h.id || `hq-${idx + 1}`).trim().toLowerCase() === ref.trim().toLowerCase()
      );
    const findEx = (ref: string) =>
      exercises.findIndex(
        (e, idx) =>
          (e.id || `ex-${idx + 1}`).trim().toLowerCase() === ref.trim().toLowerCase()
      );

    const rawMd = lesson.markdownBody || '';
    const tokenRegex =
      /`?\s*(?:\{\{|\[{2})\s*(heuristic|diagram|diag|exercise)\s*:\s*([^}\]]+?)\s*(?:\}\}|\]{2})\s*`?/gi;

    const parsedBlocks: PreviewBlock[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(rawMd)) !== null) {
      const before = rawMd.slice(lastIdx, match.index).trim();
      if (before) {
        parsedBlocks.push({
          kind: 'markdown',
          html: renderMarkdownWithLatex(before, visualAssets),
        });
      }
      const rawKind = match[1].toLowerCase();
      const kind = rawKind === 'diag' ? 'diagram' : rawKind;
      const refId = match[2].trim();
      if (kind === 'diagram') {
        const idx = findDiag(refId);
        if (idx !== -1 && !usedDiag.has(idx)) {
          usedDiag.add(idx);
          parsedBlocks.push({ kind: 'diagram', diagram: diagrams[idx] });
        }
      } else if (kind === 'heuristic') {
        const idx = findHq(refId);
        if (idx !== -1 && !usedHq.has(idx)) {
          usedHq.add(idx);
          parsedBlocks.push({ kind: 'heuristic', heuristic: heuristics[idx] });
        }
      } else if (kind === 'exercise') {
        const idx = findEx(refId);
        if (idx !== -1 && !usedEx.has(idx)) {
          usedEx.add(idx);
          parsedBlocks.push({ kind: 'exercise', exercise: exercises[idx] });
        }
      }
      lastIdx = match.index + match[0].length;
    }

    const tail = rawMd.slice(lastIdx).trim();
    if (tail) {
      parsedBlocks.push({
        kind: 'markdown',
        html: renderMarkdownWithLatex(tail, visualAssets),
      });
    }

    return {
      blocks: parsedBlocks,
      leftoverDiagrams: diagrams.filter((_, idx) => !usedDiag.has(idx)),
      leftoverHeuristics: heuristics.filter((_, idx) => !usedHq.has(idx)),
      leftoverExercises: exercises.filter((_, idx) => !usedEx.has(idx)),
    };
  }, [lesson, visualAssets]);

  if (!isOpen || !lesson) return null;

  const renderDiagramCard = (diag: LessonDiagram, key: string) => (
    <div
      key={key}
      className="border border-neutral-800 bg-neutral-950/70 rounded-lg p-4 space-y-2 my-3"
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span
          className="font-medium text-neutral-100"
          dangerouslySetInnerHTML={{
            __html: renderInlineMathWithLatex(diag.title || diag.id || ''),
          }}
        />
        <span className="font-mono text-[11px] text-neutral-500">{diag.id}</span>
      </div>
      {diag.svgCode ? (
        <div
          className="w-full overflow-x-auto bg-black border border-neutral-900 rounded p-3 flex justify-center"
          dangerouslySetInnerHTML={{ __html: diag.svgCode }}
        />
      ) : (
        <div className="w-full bg-black/80 border border-dashed border-sky-800/70 rounded p-3 space-y-1 text-xs">
          <div className="text-sky-300 font-medium">阶段一图示规格（待阶段二生成 SVG）</div>
          <div className="text-neutral-300 leading-relaxed whitespace-pre-wrap">
            {diag.topologySpec || diag.caption || '已声明图示规格节点'}
          </div>
        </div>
      )}
      {diag.caption && (
        <div
          className="text-xs text-neutral-400 leading-relaxed"
          dangerouslySetInnerHTML={{
            __html: renderInlineMathWithLatex(diag.caption),
          }}
        />
      )}
    </div>
  );

  const renderHeuristicCard = (hq: HeuristicQuestionItem, key: string) => (
    <div
      key={key}
      className="border border-sky-900/60 bg-sky-950/20 rounded-lg p-4 space-y-2 my-3 text-xs"
    >
      <div className="flex items-center justify-between text-sky-300 font-medium">
        <span>启发式思考 · {hq.context || hq.id}</span>
        <span className="font-mono text-[11px] text-sky-400/70">{hq.id}</span>
      </div>
      <div
        className="text-neutral-100 leading-relaxed"
        dangerouslySetInnerHTML={{
          __html: renderMarkdownWithLatex(hq.question || '', visualAssets),
        }}
      />
      {hq.hint && (
        <div className="text-neutral-400">
          <span className="text-sky-300">提示：</span>
          <span dangerouslySetInnerHTML={{ __html: renderInlineMathWithLatex(hq.hint) }} />
        </div>
      )}
      {hq.answerReveal && (
        <details className="pt-1">
          <summary className="cursor-pointer text-sky-300 hover:text-sky-200 select-none">
            查看解析
          </summary>
          <div
            className="mt-2 pt-2 border-t border-sky-900/40 text-neutral-300 prose prose-invert prose-sm max-w-none"
            dangerouslySetInnerHTML={{
              __html: renderMarkdownWithLatex(hq.answerReveal, visualAssets),
            }}
          />
        </details>
      )}
    </div>
  );

  const renderExerciseCard = (ex: ExerciseQuestion, key: string) => (
    <div
      key={key}
      className="border border-neutral-800 bg-neutral-950/80 rounded-lg p-4 space-y-2.5 my-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-700 text-neutral-200 font-mono">
          {ex.id} · {ex.categoryLabel || ex.type}
        </span>
        {ex.difficulty && (
          <span className="text-neutral-500 font-mono">{ex.difficulty}</span>
        )}
      </div>
      <div
        className="text-neutral-100 leading-relaxed prose prose-invert prose-sm max-w-none"
        dangerouslySetInnerHTML={{
          __html: renderMarkdownWithLatex(ex.question || '', visualAssets),
        }}
      />
      {Array.isArray(ex.options) && ex.options.length > 0 && (
        <ul className="space-y-1 pl-1">
          {ex.options.map((opt, idx) => (
            <li
              key={idx}
              className="text-neutral-300 bg-black/60 border border-neutral-900 rounded px-2.5 py-1.5"
              dangerouslySetInnerHTML={{ __html: renderInlineMathWithLatex(opt) }}
            />
          ))}
        </ul>
      )}
      <details className="pt-1">
        <summary className="cursor-pointer text-emerald-400 hover:text-emerald-300 select-none">
          查看答案与解析
        </summary>
        <div className="mt-2 pt-2 border-t border-neutral-800 space-y-1.5 text-neutral-300">
          <div>
            <span className="text-emerald-400 font-medium">答案：</span>
            <span dangerouslySetInnerHTML={{ __html: renderInlineMathWithLatex(ex.answer) }} />
          </div>
          {ex.explanation && (
            <div
              className="prose prose-invert prose-sm max-w-none"
              dangerouslySetInnerHTML={{
                __html: renderMarkdownWithLatex(ex.explanation, visualAssets),
              }}
            />
          )}
        </div>
      </details>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="课件预览（尚未保存）"
      data-testid="step3-lesson-preview-modal"
    >
      <div className="w-full max-w-4xl max-h-[90vh] bg-black border border-neutral-700 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-neutral-800 bg-neutral-950">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 border border-amber-600/70 text-amber-200 font-mono text-[11px]">
              <Eye className="w-3 h-3" />
              <span>预览模式（尚未保存）</span>
            </span>
            {sectionId && (
              <span className="font-mono text-xs text-neutral-400">
                {sectionId}
                {dayIndex ? ` · 第 ${dayIndex} 讲` : ''}
              </span>
            )}
            <span
              className="text-sm font-semibold text-white truncate"
              dangerouslySetInnerHTML={{
                __html: renderInlineMathWithLatex(lesson.title || '未命名课件'),
              }}
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            title="退出预览"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Audit warning banner if any */}
        {hasAuditIssues && auditSummaryText && (
          <div className="px-5 py-2 bg-red-950/40 border-b border-red-900/60 text-xs text-red-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{auditSummaryText}</span>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-sm text-neutral-200">
          {/* Summary & Meta */}
          <div className="border border-neutral-800 bg-neutral-950/60 rounded-lg p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
              <span>
                预计学时：{lesson.estimatedMinutes ? `${lesson.estimatedMinutes} 分钟` : '未标注'}
                {' · '}
                图示 {(lesson.diagrams || []).length} 幅 · 练习 {(lesson.exercises || []).length} 题
              </span>
            </div>
            {lesson.summary && (
              <div
                className="text-neutral-200 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: renderInlineMathWithLatex(lesson.summary) }}
              />
            )}
            {Array.isArray(lesson.keyPoints) && lesson.keyPoints.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {lesson.keyPoints.map((kp, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-xs text-neutral-300"
                    dangerouslySetInnerHTML={{ __html: renderInlineMathWithLatex(kp) }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Teaching Context */}
          {lesson.teachingContext && (
            <div className="border border-neutral-800 rounded-lg p-4 space-y-1.5 text-xs text-neutral-300 bg-neutral-950/30">
              {lesson.teachingContext.prerequisiteCheck && (
                <div>
                  <span className="text-neutral-400 font-medium">先修自检：</span>
                  <span
                    dangerouslySetInnerHTML={{
                      __html: renderInlineMathWithLatex(lesson.teachingContext.prerequisiteCheck),
                    }}
                  />
                </div>
              )}
              {lesson.teachingContext.teachingScope && (
                <div>
                  <span className="text-neutral-400 font-medium">教学范围：</span>
                  <span
                    dangerouslySetInnerHTML={{
                      __html: renderInlineMathWithLatex(lesson.teachingContext.teachingScope),
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Main Markdown & Inline Anchors */}
          <div className="lesson-prose space-y-3">
            {blocks.map((block, idx) => {
              if (block.kind === 'markdown') {
                return (
                  <div
                    key={`md-${idx}`}
                    className="prose prose-invert prose-sm max-w-none leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: block.html }}
                  />
                );
              }
              if (block.kind === 'diagram') {
                return renderDiagramCard(block.diagram, `diag-${idx}`);
              }
              if (block.kind === 'heuristic') {
                return renderHeuristicCard(block.heuristic, `hq-${idx}`);
              }
              return renderExerciseCard(block.exercise, `ex-${idx}`);
            })}
          </div>

          {/* Leftover unanchored blocks */}
          {leftoverDiagrams.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-neutral-900">
              <div className="text-xs font-medium text-neutral-400">附带图示</div>
              {leftoverDiagrams.map((d, idx) => renderDiagramCard(d, `l-diag-${idx}`))}
            </div>
          )}
          {leftoverHeuristics.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-neutral-900">
              <div className="text-xs font-medium text-neutral-400">启发式问题</div>
              {leftoverHeuristics.map((h, idx) => renderHeuristicCard(h, `l-hq-${idx}`))}
            </div>
          )}
          {leftoverExercises.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-neutral-900">
              <div className="text-xs font-medium text-neutral-400">练习题</div>
              {leftoverExercises.map((e, idx) => renderExerciseCard(e, `l-ex-${idx}`))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-neutral-800 bg-neutral-950 text-xs">
          <span className="text-neutral-500">
            此预览仅用于检查排版、公式与图示效果，尚未写入磁盘。
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="step3-preview-close-btn"
              onClick={onClose}
              className="px-3.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white rounded transition-colors"
            >
              返回继续编辑 / 修补
            </button>
            {onConfirmSave && (
              <button
                type="button"
                data-testid="step3-preview-save-btn"
                disabled={isSaving}
                onClick={onConfirmSave}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-white text-black hover:bg-neutral-200 font-medium rounded transition-colors disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isSaving ? '正在保存...' : '确认保存本节课件'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
