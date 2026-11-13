import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  FolderSync,
  HelpCircle,
  ImagePlus,
  ListChecks,
  Maximize2,
  MessageSquare,
  Minimize2,
  Move,
  Pin,
  RefreshCw,
  RotateCcw,
  Scissors,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { OutlineWorkbenchStep } from './CourseOutlineModal';
import type {
  Course,
  CourseGenerationMode,
  DailyLessonContent,
  DailyPlanSlot,
  VocabItem,
} from '../types';
import {
  renderInlineMathWithLatex,
  renderMarkdownWithLatex,
  type VisualAssetRef,
} from '../utils/markdownMath';
import { enhanceDiagramSvg, normalizeSvgLatexCommands } from '../utils/svgMath';
import { gradeExerciseSet, normalizeWordKey } from '../utils/learningLogic';
import {
  detectUnresolvedImageRefs,
  parseImportedLessonContent,
  resolveLessonAssetReferences,
  stripAiCitationArtifacts,
} from '../utils/coursewareParser';
import { copyCourseFileToClipboard } from '../utils/clipboardFile';

interface LessonViewProps {
  course: Course;
  slot: DailyPlanSlot;
  onBack: () => void;
  onSelectDayIndex?: (dayIndex: number) => void;
  onCourseUpdated: (updatedCourse: Course) => void;
  onOpenAgentModal: (course: Course) => void;
  onOpenOutlineModal?: (
    course: Course,
    step?: OutlineWorkbenchStep
  ) => void;
}

const DIFFICULTY_LABELS: Record<string, string> = {
  basic: '基础辨析',
  application: '直接应用',
  comprehensive: '综合与迁移分析',
};

export const LessonView: React.FC<LessonViewProps> = ({
  course,
  slot,
  onBack,
  onSelectDayIndex,
  onCourseUpdated,
  onOpenAgentModal,
  onOpenOutlineModal,
}) => {
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenElapsedSec, setRegenElapsedSec] = useState(0);
  const [regenSuccessSummary, setRegenSuccessSummary] = useState<string | null>(null);
  const [isDeletingLesson, setIsDeletingLesson] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  // Quick Section Material Access states
  const [copiedQuickPrompt, setCopiedQuickPrompt] = useState(false);
  const [copiedQuickPdf, setCopiedQuickPdf] = useState(false);
  const [pdfCopyNotice, setPdfCopyNotice] = useState<string | null>(null);
  const [isCuttingSegment, setIsCuttingSegment] = useState(false);

  // Unified Inline Workbench states (Chat Mode, Agent Mode, and Direct Edit share the exact same inline level)
  const [isChatWorkbenchOpen, setIsChatWorkbenchOpen] = useState<boolean>(
    !slot.lesson && (course.generationMode === 'chat' || course.generationMode === 'agent')
  );
  const [workbenchTab, setWorkbenchTab] = useState<'chat' | 'agent' | 'edit'>(
    course.generationMode === 'agent' ? 'agent' : 'chat'
  );
  const [chatLessonPrompt, setChatLessonPrompt] = useState<string>('');
  const [isLoadingChatPrompt, setIsLoadingChatPrompt] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Inline Agent Mode states (same level as Chat Mode, no modal popup required)
  const [agentPromptText, setAgentPromptText] = useState<string>('');
  const [agentWorkspaceDir, setAgentWorkspaceDir] = useState<string>('');
  const [isLoadingAgentPrompt, setIsLoadingAgentPrompt] = useState(false);
  const [copiedAgentPrompt, setCopiedAgentPrompt] = useState(false);
  const [isSyncingAgent, setIsSyncingAgent] = useState(false);
  const [agentForceOverwrite, setAgentForceOverwrite] = useState(false);
  const [agentSyncMsg, setAgentSyncMsg] = useState<string | null>(null);
  const [agentSyncErr, setAgentSyncErr] = useState<string | null>(null);

  const [rawImportInput, setRawImportInput] = useState<string>('');
  const [pendingAssets, setPendingAssets] = useState<Record<string, string>>({});
  const [previewLesson, setPreviewLesson] = useState<DailyLessonContent | null>(null);
  const [unresolvedImages, setUnresolvedImages] = useState<string[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [isSavingImport, setIsSavingImport] = useState(false);

  // Direct text & image fields inside the 'edit' tab of the unified workbench
  const [editTitle, setEditTitle] = useState(slot.lesson?.title || slot.title);
  const [editSummary, setEditSummary] = useState(slot.lesson?.summary || slot.objective);
  const [editMarkdown, setEditMarkdown] = useState(slot.lesson?.markdownBody || '');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // English reading interactive states (100% offline-capable)
  const [showTranslation, setShowTranslation] = useState(true);
  const [hideVocabMeaning, setHideVocabMeaning] = useState(false);
  const [vocabFilter, setVocabFilter] = useState<'all' | 'unmastered'>('all');
  const [activeWordCard, setActiveWordCard] = useState<VocabItem | null>(null);

  // Heuristic thinking question states ("先思考，后讲解" 渐进提示与完整解释)
  const [revealedHeuristicHints, setRevealedHeuristicHints] = useState<Record<string, boolean>>({});
  const [revealedHeuristics, setRevealedHeuristics] = useState<Record<string, boolean>>({});

  // Exercise states (persisted + graded offline, plus per-question hint & instant offline check)
  const savedSubmission = course.exerciseSubmissions?.[slot.date];
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>(
    savedSubmission?.userAnswers || {}
  );
  const [isSubmitted, setIsSubmitted] = useState<boolean>(Boolean(savedSubmission));
  const [revealedExerciseHints, setRevealedExerciseHints] = useState<Record<string, boolean>>({});
  const [revealedSingleExercises, setRevealedSingleExercises] = useState<Record<string, boolean>>(
    {}
  );

  // Reverse explanation self-check states (persisted locally offline)
  const savedReverseNotes = course.reverseCheckNotes?.[slot.date] || {};
  const [reverseDrafts, setReverseDrafts] = useState<Record<string, string>>(savedReverseNotes);
  const [revealedReverseChecks, setRevealedReverseChecks] = useState<Record<string, boolean>>({});

  // Floating non-blocking diagram / image mini-window states
  const [floatingVisualId, setFloatingVisualId] = useState<string | null>(null);
  const [floatingTempVisual, setFloatingTempVisual] = useState<VisualAssetRef | null>(null);
  const [isFloatingExpanded, setIsFloatingExpanded] = useState(false);
  const [isFloatingCollapsed, setIsFloatingCollapsed] = useState(false);
  const [floatingScale, setFloatingScale] = useState(1);
  const [floatingOffset, setFloatingOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const dragStateRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    origDx: number;
    origDy: number;
  }>({ dragging: false, startX: 0, startY: 0, origDx: 0, origDy: 0 });

  // Active displayed lesson: either previewLesson (when previewing in Chat Mode) or slot.lesson
  const activeLesson = previewLesson || slot.lesson;

  const hasPdfSource = useMemo(
    () =>
      course.materials?.some(
        (m) => m.isPdf || m.fileName.toLowerCase().endsWith('.pdf')
      ) || Boolean(slot.pdfSegment),
    [course.materials, slot.pdfSegment]
  );

  const sortedSlots = useMemo(
    () => [...course.dailyPlan].sort((a, b) => a.dayIndex - b.dayIndex),
    [course.dailyPlan]
  );
  const currentSlotIdx = sortedSlots.findIndex((s) => s.dayIndex === slot.dayIndex);
  const prevSlot = currentSlotIdx > 0 ? sortedSlots[currentSlotIdx - 1] : null;
  const nextSlot =
    currentSlotIdx >= 0 && currentSlotIdx < sortedSlots.length - 1
      ? sortedSlots[currentSlotIdx + 1]
      : null;

  useEffect(() => {
    setRawImportInput('');
    setPreviewLesson(null);
    setUnresolvedImages([]);
    setImportError(null);
    setImportSuccessMsg(null);
    setPendingAssets({});
    setPdfCopyNotice(null);
    setRegenError(null);
    setRegenSuccessSummary(null);
    setAgentSyncMsg(null);
    setAgentSyncErr(null);
    setWorkbenchTab(course.generationMode === 'agent' ? 'agent' : 'chat');
    setActiveWordCard(null);
    setRevealedHeuristicHints({});
    setRevealedHeuristics({});
    setRevealedExerciseHints({});
    setRevealedSingleExercises({});
    setRevealedReverseChecks({});
    setFloatingVisualId(null);
    setFloatingTempVisual(null);
    setIsFloatingExpanded(false);
    setIsFloatingCollapsed(false);
    setFloatingScale(1);
    setFloatingOffset({ dx: 0, dy: 0 });
    const sub = course.exerciseSubmissions?.[slot.date];
    setUserAnswers(sub?.userAnswers || {});
    setIsSubmitted(Boolean(sub));
    setReverseDrafts(course.reverseCheckNotes?.[slot.date] || {});
    setIsChatWorkbenchOpen(
      !slot.lesson && (course.generationMode === 'chat' || course.generationMode === 'agent')
    );
  }, [course.id, slot.dayIndex]);

  useEffect(() => {
    if (!isRegenerating) return;
    const startedAt = Date.now();
    setRegenElapsedSec(0);
    const timer = window.setInterval(() => {
      setRegenElapsedSec((Date.now() - startedAt) / 1000);
    }, 200);
    return () => window.clearInterval(timer);
  }, [isRegenerating]);

  useEffect(() => {
    if (!floatingVisualId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFloatingVisualId(null);
        setFloatingTempVisual(null);
      }
    };
    const handlePointerMove = (e: PointerEvent) => {
      if (!dragStateRef.current.dragging) return;
      const nextDx = dragStateRef.current.origDx + (e.clientX - dragStateRef.current.startX);
      const nextDy = dragStateRef.current.origDy + (e.clientY - dragStateRef.current.startY);
      setFloatingOffset({
        dx: Math.max(-window.innerWidth + 180, Math.min(24, nextDx)),
        dy: Math.max(-window.innerHeight + 120, Math.min(24, nextDy)),
      });
    };
    const handlePointerUp = () => {
      dragStateRef.current.dragging = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [floatingVisualId]);

  useEffect(() => {
    setEditTitle(slot.lesson?.title || slot.title);
    setEditSummary(slot.lesson?.summary || slot.objective);
    setEditMarkdown(slot.lesson?.markdownBody || '');
  }, [slot.dayIndex, slot.lesson, slot.title, slot.objective]);

  useEffect(() => {
    setIsLoadingChatPrompt(true);
    fetch(`/api/courses/${course.id}/days/${slot.dayIndex}/chat-prompt`)
      .then((res) => res.json())
      .then((data) => {
        if (data.lessonPrompt) setChatLessonPrompt(data.lessonPrompt);
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        setIsLoadingChatPrompt(false);
      });
  }, [course.id, slot.dayIndex]);

  useEffect(() => {
    setIsLoadingAgentPrompt(true);
    fetch(`/api/courses/${course.id}/agent-prompt`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.prompt) setAgentPromptText(data.prompt);
        if (data?.workspaceDir) setAgentWorkspaceDir(data.workspaceDir);
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        setIsLoadingAgentPrompt(false);
      });
  }, [course.id, slot.dayIndex]);

  const handleQuickCopySectionPrompt = async () => {
    try {
      let promptToCopy = chatLessonPrompt;
      if (!promptToCopy) {
        const res = await fetch(`/api/courses/${course.id}/days/${slot.dayIndex}/chat-prompt`);
        const data = await res.json();
        promptToCopy = data.lessonPrompt || '';
        if (promptToCopy) setChatLessonPrompt(promptToCopy);
      }
      if (promptToCopy) {
        await navigator.clipboard.writeText(promptToCopy);
        setCopiedQuickPrompt(true);
        setTimeout(() => setCopiedQuickPrompt(false), 2000);
      }
    } catch {
      // ignore
    }
  };

  const firstPdfMaterial = course.materials.find(
    (m) => Boolean(m.isPdf || m.fileName.toLowerCase().endsWith('.pdf'))
  );

  const handleQuickCutSectionPdf = async () => {
    setIsCuttingSegment(true);
    setRegenError(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/pdf-split/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionId: slot.pdfSegment?.sectionId || slot.regionId || slot.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '切割本节 PDF 失败');
      onCourseUpdated(data.course);
    } catch (err: any) {
      setRegenError(err?.message || '切割本节 PDF 失败');
    } finally {
      setIsCuttingSegment(false);
    }
  };

  const handleCopyPdfFileToClipboard = async () => {
    setRegenError(null);
    setPdfCopyNotice(null);
    const relPath = slot.pdfSegment
      ? `segments/${slot.pdfSegment.segmentFileName || `${slot.pdfSegment.sectionId || slot.id}.pdf`}`
      : firstPdfMaterial
        ? `sources/${firstPdfMaterial.fileName}`
        : '';
    if (!relPath) return;

    try {
      const result = await copyCourseFileToClipboard(course.id, relPath);
      setCopiedQuickPdf(true);
      setTimeout(() => setCopiedQuickPdf(false), 2500);
      if (result.copiedToOsClipboard) {
        setPdfCopyNotice(
          `已将 ${result.fileName || relPath} 复制到系统剪贴板，等效资源管理器 Ctrl+C，可直接按 Ctrl+V 粘贴给 AI 对话框或文件夹。`
        );
      } else {
        setPdfCopyNotice(
          result.reason ||
            `当前环境无桌面剪贴板权限，可点击右侧“下载/打开”按钮获取 ${result.fileName || relPath}。`
        );
      }
    } catch (err: any) {
      setRegenError(err?.message || '复制 PDF 文件到系统剪贴板失败');
    }
  };

  const combinedAssets = useMemo(
    () => ({ ...(course.customAssets || {}), ...pendingAssets }),
    [course.customAssets, pendingAssets]
  );

  const existingLessonUnresolvedRefs = useMemo(() => {
    if (!activeLesson?.markdownBody) return [];
    return detectUnresolvedImageRefs(activeLesson.markdownBody, combinedAssets);
  }, [activeLesson?.markdownBody, combinedAssets]);

  const resolvedActiveLesson = useMemo(() => {
    if (!activeLesson) return null;
    return resolveLessonAssetReferences(activeLesson, combinedAssets);
  }, [activeLesson, combinedAssets]);

  // Unified list of all SVG diagrams + Markdown images in this lesson for cross-referencing & mini-window
  const lessonVisuals = useMemo<VisualAssetRef[]>(() => {
    if (!resolvedActiveLesson) return [];
    const visuals: VisualAssetRef[] = [];
    const diagrams = resolvedActiveLesson.diagrams || [];
    diagrams.forEach((d, idx) => {
      const id = (d.id || `diag-${idx + 1}`).trim();
      visuals.push({
        id,
        title: stripAiCitationArtifacts(d.title || `图 ${idx + 1}`),
        stageLabel: d.stageLabel ? stripAiCitationArtifacts(d.stageLabel) : undefined,
        caption: d.caption ? stripAiCitationArtifacts(d.caption) : undefined,
        kind: 'svg',
        svgCode: enhanceDiagramSvg(d.svgCode),
        index: idx + 1,
      });
    });

    const seenImgUrls = new Set<string>();
    const rawBody = activeLesson?.markdownBody || '';
    const resolvedBody = resolvedActiveLesson.markdownBody || '';
    const rawImgMatches = [...rawBody.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)];
    const resolvedImgMatches = [...resolvedBody.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)];
    let imgCounter = 0;

    resolvedImgMatches.forEach((m, i) => {
      const alt = stripAiCitationArtifacts((m[1] || '').trim());
      const resolvedUrl = (m[2] || '').trim();
      if (!resolvedUrl || seenImgUrls.has(resolvedUrl)) return;
      seenImgUrls.add(resolvedUrl);
      imgCounter++;
      const rawRef = rawImgMatches[i]?.[2]?.trim() || '';
      const rawFileName =
        rawRef && !rawRef.startsWith('data:')
          ? rawRef.split('/').pop() || rawRef
          : undefined;
      const visualIdx = diagrams.length + imgCounter;
      visuals.push({
        id: `img-${imgCounter}`,
        title: alt || rawFileName || `插图 ${imgCounter}`,
        kind: 'image',
        imageUrl: resolvedUrl,
        fileName: rawFileName,
        index: visualIdx,
      });
    });

    return visuals;
  }, [resolvedActiveLesson, activeLesson?.markdownBody]);

  const activeFloatingVisual = useMemo(() => {
    if (!floatingVisualId) return null;
    return (
      lessonVisuals.find((v) => v.id === floatingVisualId) ||
      (floatingTempVisual?.id === floatingVisualId ? floatingTempVisual : null)
    );
  }, [floatingVisualId, lessonVisuals, floatingTempVisual]);

  const openFloatingVisual = (visualId: string, fallbackVisual?: VisualAssetRef) => {
    if (fallbackVisual) {
      setFloatingTempVisual(fallbackVisual);
    } else {
      setFloatingTempVisual(null);
    }
    setFloatingVisualId(visualId);
    setIsFloatingCollapsed(false);
  };

  /**
   * Build interleaved closed-loop flow so heuristic questions ("先思考，后讲解"),
   * teaching diagrams ("图文同步"), and immediate exercises ("知识点闭环即时练习")
   * are rendered in-place inside each knowledge point instead of piled at the end.
   */
  const interleavedLessonFlow = useMemo(() => {
    if (!activeLesson) {
      return {
        blocks: [] as Array<
          | { kind: 'markdown'; html: string }
          | { kind: 'heuristic'; hqIdx: number }
          | { kind: 'diagram'; diagIdx: number }
          | { kind: 'exercise'; exIdx: number }
        >,
        comprehensiveExerciseIndices: [] as number[],
      };
    }

    const resolved = resolveLessonAssetReferences(activeLesson, combinedAssets);
    const rawMd = resolved.markdownBody || '';
    const diagrams = activeLesson.diagrams || [];
    const heuristics = activeLesson.heuristicQuestions || [];
    const exercises = activeLesson.exercises || [];

    const usedDiagIndices = new Set<number>();
    const usedHqIndices = new Set<number>();
    const usedExIndices = new Set<number>();

    const findDiagramIdx = (token: string): number => {
      const clean = token.trim();
      const byId = diagrams.findIndex(
        (d, idx) => (d.id || `diag-${idx + 1}`).toLowerCase() === clean.toLowerCase()
      );
      if (byId !== -1) return byId;
      const numMatch = clean.match(/(\d+)/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        if (idx >= 0 && idx < diagrams.length) return idx;
      }
      return -1;
    };

    const findHqIdx = (token: string): number => {
      const clean = token.trim();
      const byId = heuristics.findIndex(
        (h, idx) => (h.id || `hq-${idx + 1}`).toLowerCase() === clean.toLowerCase()
      );
      if (byId !== -1) return byId;
      const numMatch = clean.match(/(\d+)/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        if (idx >= 0 && idx < heuristics.length) return idx;
      }
      return -1;
    };

    const findExIdx = (token: string): number => {
      const clean = token.trim();
      const byId = exercises.findIndex(
        (ex, idx) => (ex.id || `ex-${idx + 1}`).toLowerCase() === clean.toLowerCase()
      );
      if (byId !== -1) return byId;
      const numMatch = clean.match(/(\d+)/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        if (idx >= 0 && idx < exercises.length) return idx;
      }
      return -1;
    };

    type RawBlock =
      | { kind: 'markdown'; md: string }
      | { kind: 'heuristic'; hqIdx: number }
      | { kind: 'diagram'; diagIdx: number }
      | { kind: 'exercise'; exIdx: number };

    // Step 1: Parse explicit {{heuristic:...}}, {{diagram:...}}, {{exercise:...}} anchors
    const tokenRegex = /\{\{\s*(heuristic|diagram|exercise)\s*:\s*([^}]+?)\s*\}\}/gi;
    const initialBlocks: RawBlock[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(rawMd)) !== null) {
      const before = rawMd.slice(lastIdx, match.index).trim();
      if (before) {
        initialBlocks.push({ kind: 'markdown', md: before });
      }
      const kind = match[1].toLowerCase();
      const refId = match[2].trim();
      if (kind === 'heuristic') {
        const idx = findHqIdx(refId);
        if (idx !== -1 && !usedHqIndices.has(idx)) {
          usedHqIndices.add(idx);
          initialBlocks.push({ kind: 'heuristic', hqIdx: idx });
        }
      } else if (kind === 'diagram') {
        const idx = findDiagramIdx(refId);
        if (idx !== -1 && !usedDiagIndices.has(idx)) {
          usedDiagIndices.add(idx);
          initialBlocks.push({ kind: 'diagram', diagIdx: idx });
        }
      } else if (kind === 'exercise') {
        const idx = findExIdx(refId);
        if (idx !== -1 && !usedExIndices.has(idx)) {
          usedExIndices.add(idx);
          initialBlocks.push({ kind: 'exercise', exIdx: idx });
        }
      }
      lastIdx = match.index + match[0].length;
    }

    const tail = rawMd.slice(lastIdx).trim();
    if (tail) {
      initialBlocks.push({ kind: 'markdown', md: tail });
    }

    // Step 2: Check for any un-anchored heuristics, diagrams, or inline exercises
    const remainingHqIndices = heuristics
      .map((_, idx) => idx)
      .filter((idx) => !usedHqIndices.has(idx));
    const remainingDiagIndices = diagrams
      .map((_, idx) => idx)
      .filter((idx) => !usedDiagIndices.has(idx));

    // Inline exercises are either explicitly marked stage === 'inline' OR (when no stage is set) non-comprehensive exercises
    const inlineCandidateIndices = exercises
      .map((ex, idx) => ({ ex, idx }))
      .filter(({ ex, idx }) => {
        if (usedExIndices.has(idx)) return false;
        if (ex.stage === 'inline') return true;
        if (ex.stage === 'comprehensive') return false;
        return ex.difficulty !== 'comprehensive' && idx < Math.ceil(exercises.length / 2);
      })
      .map(({ idx }) => idx);

    let finalRawBlocks: RawBlock[] = [];

    if (
      remainingHqIndices.length > 0 ||
      remainingDiagIndices.length > 0 ||
      inlineCandidateIndices.length > 0
    ) {
      // Split markdown blocks by ## knowledge-point sections so we can interleave un-anchored items naturally
      const expandedMdChunks: RawBlock[] = [];
      for (const blk of initialBlocks) {
        if (blk.kind !== 'markdown') {
          expandedMdChunks.push(blk);
          continue;
        }
        const sections = blk.md
          .split(/\n(?=##\s+)/)
          .map((s) => s.trim())
          .filter(Boolean);
        for (const sec of sections) {
          expandedMdChunks.push({ kind: 'markdown', md: sec });
        }
      }

      const mdSectionPositions = expandedMdChunks
        .map((b, i) => (b.kind === 'markdown' ? i : -1))
        .filter((i) => i !== -1);

      const numSections = Math.max(1, mdSectionPositions.length);
      let hqCursor = 0;
      let diagCursor = 0;
      let exCursor = 0;

      for (let i = 0; i < expandedMdChunks.length; i++) {
        const blk = expandedMdChunks[i];
        if (blk.kind !== 'markdown') {
          finalRawBlocks.push(blk);
          continue;
        }

        const secOrder = mdSectionPositions.indexOf(i);
        const isLastMdSection = secOrder === numSections - 1;

        const targetHqCount = isLastMdSection
          ? remainingHqIndices.length - hqCursor
          : Math.ceil((remainingHqIndices.length - hqCursor) / (numSections - secOrder));
        const targetDiagCount = isLastMdSection
          ? remainingDiagIndices.length - diagCursor
          : Math.ceil((remainingDiagIndices.length - diagCursor) / (numSections - secOrder));
        const targetExCount = isLastMdSection
          ? inlineCandidateIndices.length - exCursor
          : Math.ceil((inlineCandidateIndices.length - exCursor) / (numSections - secOrder));

        // Split the markdown section after its heading/opening paragraph so "先思考，后讲解" and diagram appear inside the section
        const paragraphs = blk.md.split(/\n{2,}/);
        const introPart = paragraphs.slice(0, Math.min(2, paragraphs.length)).join('\n\n').trim();
        const restPart = paragraphs.slice(Math.min(2, paragraphs.length)).join('\n\n').trim();

        if (introPart) {
          finalRawBlocks.push({ kind: 'markdown', md: introPart });
        }

        for (let k = 0; k < targetHqCount && hqCursor < remainingHqIndices.length; k++) {
          const hIdx = remainingHqIndices[hqCursor++];
          usedHqIndices.add(hIdx);
          finalRawBlocks.push({ kind: 'heuristic', hqIdx: hIdx });
        }

        for (let k = 0; k < targetDiagCount && diagCursor < remainingDiagIndices.length; k++) {
          const dIdx = remainingDiagIndices[diagCursor++];
          usedDiagIndices.add(dIdx);
          finalRawBlocks.push({ kind: 'diagram', diagIdx: dIdx });
        }

        if (restPart) {
          finalRawBlocks.push({ kind: 'markdown', md: restPart });
        }

        for (let k = 0; k < targetExCount && exCursor < inlineCandidateIndices.length; k++) {
          const eIdx = inlineCandidateIndices[exCursor++];
          usedExIndices.add(eIdx);
          finalRawBlocks.push({ kind: 'exercise', exIdx: eIdx });
        }
      }

      // If markdownBody was empty, still push any remaining items
      while (hqCursor < remainingHqIndices.length) {
        const hIdx = remainingHqIndices[hqCursor++];
        usedHqIndices.add(hIdx);
        finalRawBlocks.push({ kind: 'heuristic', hqIdx: hIdx });
      }
      while (diagCursor < remainingDiagIndices.length) {
        const dIdx = remainingDiagIndices[diagCursor++];
        usedDiagIndices.add(dIdx);
        finalRawBlocks.push({ kind: 'diagram', diagIdx: dIdx });
      }
      while (exCursor < inlineCandidateIndices.length) {
        const eIdx = inlineCandidateIndices[exCursor++];
        usedExIndices.add(eIdx);
        finalRawBlocks.push({ kind: 'exercise', exIdx: eIdx });
      }
    } else {
      finalRawBlocks = initialBlocks;
    }

    const blocks = finalRawBlocks.map((b) =>
      b.kind === 'markdown'
        ? { kind: 'markdown' as const, html: renderMarkdownWithLatex(b.md, lessonVisuals) }
        : b
    );

    const comprehensiveExerciseIndices = exercises
      .map((_, idx) => idx)
      .filter((idx) => !usedExIndices.has(idx));

    return { blocks, comprehensiveExerciseIndices };
  }, [activeLesson, combinedAssets, lessonVisuals]);

  const renderedGrammarNotes = useMemo(() => {
    if (!activeLesson?.englishPayload?.grammarAndUsageNotes) return '';
    return renderMarkdownWithLatex(activeLesson.englishPayload.grammarAndUsageNotes, lessonVisuals);
  }, [activeLesson?.englishPayload?.grammarAndUsageNotes, lessonVisuals]);

  const gradeReport = useMemo(() => {
    if (!activeLesson?.exercises || !isSubmitted) return null;
    return gradeExerciseSet(activeLesson.exercises, userAnswers);
  }, [activeLesson?.exercises, isSubmitted, userAnswers]);

  const handlePersistModePreference = async (newMode: CourseGenerationMode) => {
    try {
      const res = await fetch(`/api/courses/${course.id}/mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationMode: newMode }),
      });
      if (res.ok) {
        const data = await res.json();
        onCourseUpdated(data.course);
      }
    } catch {
      // ignore
    }
  };

  const handleRegenerateLesson = async () => {
    const startedAt = Date.now();
    setIsChatWorkbenchOpen(false);
    setIsRegenerating(true);
    setRegenError(null);
    setRegenSuccessSummary(null);
    try {
      const res = await fetch(
        `/api/courses/${course.id}/days/${slot.dayIndex}/generate`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '重新生成课件失败');
      }
      setPreviewLesson(null);
      onCourseUpdated(data.course);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      const updatedSlot = (data.course as Course)?.dailyPlan?.find(
        (d) => d.dayIndex === slot.dayIndex
      );
      const genLesson = updatedSlot?.lesson;
      const diagCount = genLesson?.diagrams?.length || 0;
      const hqCount = genLesson?.heuristicQuestions?.length || 0;
      const exCount = genLesson?.exercises?.length || 0;
      setRegenSuccessSummary(
        `API 课件生成完成（耗时 ${elapsed}s）：共生成 ${diagCount} 幅图文同步 SVG 图示、${hqCount} 个先思考后讲解问题、${exCount} 道分层练习题，已自动保存至 lessons/${slot.id}.json。`
      );
    } catch (err: any) {
      setRegenError(err?.message || '生成课件失败，请检查设置或使用下方 Chat / Agent 模式导入');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleCopyAgentPromptInline = async () => {
    if (!agentPromptText) return;
    try {
      await navigator.clipboard.writeText(agentPromptText);
      setCopiedAgentPrompt(true);
      setTimeout(() => setCopiedAgentPrompt(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleDownloadAgentPromptInline = () => {
    if (!agentPromptText) return;
    const blob = new Blob([agentPromptText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${course.folderName || course.name}_AGENT_TASK_PROMPT.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSyncAgentDirectoryInline = async () => {
    setIsSyncingAgent(true);
    setAgentSyncMsg(null);
    setAgentSyncErr(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/agent-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceOverwrite: agentForceOverwrite }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '同步本地课程目录失败');
      }
      onCourseUpdated(data.course);
      const importedCount = Array.isArray(data.importedDays) ? data.importedDays.length : 0;
      const updatedThisSlot = (data.course as Course)?.dailyPlan?.find(
        (d) => d.dayIndex === slot.dayIndex
      )?.lesson;
      if (importedCount > 0 || data.syllabusUpdated || data.splitPlanUpdated) {
        setAgentSyncMsg(
          `同步完成：从本地目录关联了 ${importedCount} 节课件${
            updatedThisSlot ? '（本节课件已就绪）' : ''
          }。`
        );
        if (updatedThisSlot) {
          setIsChatWorkbenchOpen(false);
        }
      } else {
        setAgentSyncMsg(
          `已扫描本地课程目录，暂未检测到新的 lessons/${slot.id}.json 或其他待导入课件文件。`
        );
      }
    } catch (err: any) {
      setAgentSyncErr(err?.message || '扫描同步 Agent 目录失败');
    } finally {
      setIsSyncingAgent(false);
    }
  };

  const handleAgentBatchUploadInline = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setIsSyncingAgent(true);
    setAgentSyncMsg(null);
    setAgentSyncErr(null);
    try {
      const uploadedFiles: Array<{ fileName: string; content: string }> = [];
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const content = await f.text();
        uploadedFiles.push({ fileName: f.name, content });
      }

      const res = await fetch(`/api/courses/${course.id}/agent-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forceOverwrite: agentForceOverwrite,
          uploadedFiles,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '导入文件失败');
      }
      onCourseUpdated(data.course);
      const importedCount = Array.isArray(data.importedDays) ? data.importedDays.length : 0;
      setAgentSyncMsg(`成功从所选文件导入并关联了 ${importedCount} 节课件。`);
      const updatedThisSlot = (data.course as Course)?.dailyPlan?.find(
        (d) => d.dayIndex === slot.dayIndex
      )?.lesson;
      if (updatedThisSlot) {
        setIsChatWorkbenchOpen(false);
      }
    } catch (err: any) {
      setAgentSyncErr(err?.message || '批量导入课件文件失败');
    } finally {
      setIsSyncingAgent(false);
      e.target.value = '';
    }
  };

  const handleDeleteCurrentLesson = async () => {
    setIsDeletingLesson(true);
    setRegenError(null);
    try {
      const res = await fetch(
        `/api/courses/${course.id}/days/${slot.dayIndex}/lesson`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '删除本节课件失败');
      }
      setIsChatWorkbenchOpen(false);
      setPreviewLesson(null);
      onCourseUpdated(data.course);
    } catch (err: any) {
      setRegenError(err?.message || '删除本节课件失败');
    } finally {
      setIsDeletingLesson(false);
    }
  };

  const handleCopyChatPrompt = async () => {
    if (!chatLessonPrompt) return;
    try {
      await navigator.clipboard.writeText(chatLessonPrompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleDownloadChatPrompt = () => {
    if (!chatLessonPrompt) return;
    const blob = new Blob([chatLessonPrompt], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${course.name}_day-${String(slot.dayIndex).padStart(2, '0')}_CHAT_PROMPT.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setRawImportInput(text);
      setImportError(null);
      const parsed = parseImportedLessonContent(text, slot, 'chat', combinedAssets);
      setPreviewLesson(parsed.lesson);
      setUnresolvedImages(parsed.unresolvedImageRefs);
    } catch (err: any) {
      setImportError(err?.message || '读取导入文件失败');
    } finally {
      e.target.value = '';
    }
  };

  const handlePreviewImportedContent = () => {
    setImportError(null);
    setImportSuccessMsg(null);
    try {
      const parsed = parseImportedLessonContent(rawImportInput, slot, 'chat', combinedAssets);
      setPreviewLesson(parsed.lesson);
      setUnresolvedImages(parsed.unresolvedImageRefs);
    } catch (err: any) {
      setImportError(err?.message || '解析课件内容失败，请检查粘贴格式');
    }
  };

  const handleUploadSupplementalImages = async (
    e: React.ChangeEvent<HTMLInputElement>,
    targetRefName?: string
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAssets: Record<string, string> = { ...pendingAssets };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });
      if (dataUrl) {
        newAssets[file.name] = dataUrl;
        newAssets[`assets/${file.name}`] = dataUrl;
        if (targetRefName) {
          newAssets[targetRefName] = dataUrl;
        }
      }
    }

    setPendingAssets(newAssets);
    const merged = { ...(course.customAssets || {}), ...newAssets };

    if (previewLesson) {
      const updated = resolveLessonAssetReferences(previewLesson, merged);
      setPreviewLesson(updated);
      setUnresolvedImages(detectUnresolvedImageRefs(updated.markdownBody, merged));
    } else if (slot.lesson && !targetRefName) {
      // If user uploaded an image in Edit mode, append markdown image link if not already referenced
      const firstFile = files[0];
      if (firstFile && !editMarkdown.includes(firstFile.name)) {
        setEditMarkdown((prev) => `${prev}\n\n![${firstFile.name}](${firstFile.name})\n`);
      }
    }
    e.target.value = '';
  };

  const handleConfirmSaveImport = async (advanceToNext = false) => {
    setIsSavingImport(true);
    setImportError(null);
    setImportSuccessMsg(null);
    try {
      const parsed =
        previewLesson ||
        parseImportedLessonContent(rawImportInput, slot, 'chat', combinedAssets).lesson;

      const res = await fetch(`/api/courses/${course.id}/days/${slot.dayIndex}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawContent: rawImportInput,
          lessonData: parsed,
          uploadedAssets: pendingAssets,
          sourceMode: 'chat',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '保存导入课件失败');
      }
      setPreviewLesson(null);
      setRawImportInput('');
      onCourseUpdated(data.course);
      if (advanceToNext && nextSlot && onSelectDayIndex) {
        onSelectDayIndex(nextSlot.dayIndex);
      } else {
        setIsChatWorkbenchOpen(false);
        setImportSuccessMsg('本节课件已保存并同步到本地文件夹。');
      }
    } catch (err: any) {
      setImportError(err?.message || '保存导入课件失败');
    } finally {
      setIsSavingImport(false);
    }
  };

  const handleSaveEditedLesson = async () => {
    setIsSavingEdit(true);
    try {
      const res = await fetch(`/api/courses/${course.id}/days/${slot.dayIndex}/lesson`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          summary: editSummary,
          markdownBody: editMarkdown,
          uploadedAssets: pendingAssets,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onCourseUpdated(data.course);
        setIsChatWorkbenchOpen(false);
      }
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleToggleWordMastery = async (word: string) => {
    try {
      const res = await fetch(`/api/courses/${course.id}/vocab-mastery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word }),
      });
      if (res.ok) {
        const data = await res.json();
        onCourseUpdated({
          ...course,
          masteredWords: data.masteredWords,
        });
      }
    } catch {
      const norm = normalizeWordKey(word);
      const exists = course.masteredWords.includes(norm);
      const next = exists
        ? course.masteredWords.filter((w) => w !== norm)
        : [...course.masteredWords, norm];
      onCourseUpdated({ ...course, masteredWords: next });
    }
  };

  const handleSubmitExercises = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLesson?.exercises) return;

    const result = gradeExerciseSet(activeLesson.exercises, userAnswers);
    setIsSubmitted(true);

    try {
      const res = await fetch(`/api/courses/${course.id}/exercises`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: slot.date,
          userAnswers,
          score: result.score,
          total: result.total,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onCourseUpdated(data.course);
      }
    } catch {
      // Offline fallback works seamlessly
    }
  };

  const handleResetExercises = () => {
    setUserAnswers({});
    setIsSubmitted(false);
  };

  const handleSaveReverseCheck = async (checkId: string) => {
    setRevealedReverseChecks((prev) => ({ ...prev, [checkId]: true }));
    try {
      const res = await fetch(`/api/courses/${course.id}/reverse-checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: slot.date,
          checkId,
          userExplanation: reverseDrafts[checkId] || '',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onCourseUpdated(data.course);
      }
    } catch {
      // Offline local state already updated
    }
  };

  const renderHighlightedEnglishParagraph = (
    text: string,
    targetWords: VocabItem[]
  ) => {
    if (!targetWords || targetWords.length === 0) return text;
    const wordMap = new Map<string, VocabItem>();
    for (const item of targetWords) {
      wordMap.set(normalizeWordKey(item.word), item);
    }

    const escapedWords = targetWords
      .map((w) => w.word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .filter(Boolean);

    if (escapedWords.length === 0) return text;

    const regex = new RegExp(`\\b(${escapedWords.join('|')})(?:s|es|ed|ing|d)?\\b`, 'gi');
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const matchedStr = match[0];
      const baseCandidate = match[1].toLowerCase();
      const start = match.index;
      if (start > lastIndex) {
        parts.push(text.slice(lastIndex, start));
      }
      const vocabObj =
        wordMap.get(baseCandidate) ||
        targetWords.find((w) =>
          matchedStr.toLowerCase().startsWith(w.word.toLowerCase().slice(0, 5))
        );

      parts.push(
        <button
          key={`${start}-${matchedStr}`}
          type="button"
          onClick={() => vocabObj && setActiveWordCard(vocabObj)}
          className="text-white font-medium underline decoration-neutral-500 hover:decoration-white underline-offset-4 px-0.5 transition-colors"
          title={vocabObj ? `${vocabObj.word}: ${vocabObj.meaning}` : matchedStr}
        >
          {matchedStr}
        </button>
      );
      lastIndex = start + matchedStr.length;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    return parts;
  };

  const currentMode: CourseGenerationMode = course.generationMode || 'api';

  return (
    <div className="min-h-screen bg-black text-neutral-100 pb-24">
      <header className="sticky top-0 z-30 bg-black/95 border-b border-neutral-900 px-6 py-4">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-400 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>时间轴</span>
            </button>
            <span className="text-neutral-700" aria-hidden="true">
              /
            </span>
            <span className="text-xs text-neutral-200 font-medium truncate max-w-[140px]">
              {course.name}
            </span>

            {onSelectDayIndex ? (
              <div className="flex items-center gap-1 ml-1">
                <button
                  type="button"
                  onClick={() => prevSlot && onSelectDayIndex(prevSlot.dayIndex)}
                  disabled={!prevSlot}
                  title={prevSlot ? `上一讲：${stripAiCitationArtifacts(prevSlot.title)}` : '已是第 1 讲'}
                  aria-label="上一讲"
                  className="p-1 border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 hover:text-white disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <label className="sr-only" htmlFor="lesson-section-switcher">
                  切换课程小节
                </label>
                <select
                  id="lesson-section-switcher"
                  value={slot.dayIndex}
                  onChange={(e) => onSelectDayIndex(Number(e.target.value))}
                  className="bg-black border border-neutral-800 hover:border-neutral-600 rounded px-2 py-1 text-xs font-mono text-neutral-200 max-w-[220px] focus:outline-none"
                >
                  {sortedSlots.map((s) => (
                    <option key={s.dayIndex} value={s.dayIndex}>
                      第 {s.dayIndex}/{course.durationDays} 讲 {s.lesson ? '✓' : '·'}{' '}
                      {normalizeSvgLatexCommands(stripAiCitationArtifacts(s.title))}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => nextSlot && onSelectDayIndex(nextSlot.dayIndex)}
                  disabled={!nextSlot}
                  title={nextSlot ? `下一讲：${stripAiCitationArtifacts(nextSlot.title)}` : '已是最后一讲'}
                  aria-label="下一讲"
                  className="p-1 border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 hover:text-white disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <span className="text-xs font-mono text-neutral-400">
                {slot.date} (第 {slot.dayIndex}/{course.durationDays} 天)
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onOpenOutlineModal && (
              <button
                type="button"
                onClick={() =>
                  onOpenOutlineModal(
                    course,
                    course.outlineConfirmed
                      ? 'lessons'
                      : hasPdfSource
                        ? 'split_vocab'
                        : 'outline'
                  )
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors whitespace-nowrap"
              >
                <ListChecks className="w-3.5 h-3.5" />
                <span>课程工作台</span>
              </button>
            )}

            {/* 独立的一键 API 生成按钮（不再依赖模式下拉框，避免切到 API 仍停留在提示词界面的错觉） */}
            <button
              type="button"
              onClick={handleRegenerateLesson}
              disabled={isRegenerating}
              title="直接调用后端配置的 API 多模态模型自动生成本节完整课件"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${
                isRegenerating
                  ? 'border border-sky-500/70 bg-sky-950/40 text-sky-200'
                  : !slot.lesson && !isChatWorkbenchOpen
                    ? 'bg-white text-black hover:bg-neutral-200'
                    : 'border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
              <span>
                {isRegenerating
                  ? `API 生成中 (${regenElapsedSec.toFixed(1)}s)...`
                  : slot.lesson
                    ? 'API 重新生成'
                    : 'API 生成课件'}
              </span>
            </button>

            {/* 统一的 Chat / Agent / 直接编辑同级工作台入口 */}
            <button
              type="button"
              onClick={() => {
                setIsChatWorkbenchOpen((v) => !v);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border rounded transition-colors whitespace-nowrap ${
                isChatWorkbenchOpen
                  ? 'border-white bg-neutral-900 text-white'
                  : 'border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>
                {slot.lesson
                  ? isChatWorkbenchOpen
                    ? '收起更新 / 编辑'
                    : '更新 / 编辑课件 (Chat · Agent · 编辑)'
                  : isChatWorkbenchOpen
                    ? '收起 Chat / Agent 工作台'
                    : 'Chat / Agent 生成工作台'}
              </span>
            </button>

            {slot.lesson && (
              <button
                type="button"
                onClick={handleDeleteCurrentLesson}
                disabled={isDeletingLesson}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-neutral-800 hover:border-red-700 text-neutral-300 hover:text-red-400 rounded transition-colors whitespace-nowrap disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingLesson ? '删除中...' : '删除'}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 pt-8">
        {regenError && (
          <div className="mb-6 text-xs text-red-400 border border-red-900/60 bg-red-950/30 rounded px-4 py-3">
            {regenError}
          </div>
        )}

        {/* API 生成实时多阶段进度反馈与完成摘要 */}
        {isRegenerating && (
          <section
            aria-label="API 课件生成实时进度"
            className="mb-6 border border-sky-800/70 bg-sky-950/20 rounded p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <RefreshCw className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-white">
                    正在通过 API 多模态生成第 {slot.dayIndex}/{course.durationDays} 讲课件
                  </div>
                  <div className="text-xs text-neutral-400 mt-0.5">
                    模型正在深入解析本节教材 PDF 切片与大纲目标，推导公式并绘制 SVG 图示，请稍候...
                  </div>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded bg-sky-950/80 border border-sky-700/60 text-xs font-mono text-sky-200">
                已耗时 {regenElapsedSec.toFixed(1)}s
              </span>
            </div>

            <div className="w-full h-1.5 bg-neutral-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-400 transition-all duration-300"
                style={{
                  width: `${Math.min(94, Math.max(12, Math.round(regenElapsedSec * 5.5)))}%`,
                }}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {[
                {
                  step: 1,
                  threshold: 0,
                  label: '1. 读取本节大纲目标与教材 PDF 物理页切片上下文',
                },
                {
                  step: 2,
                  threshold: 2.5,
                  label: '2. 推导核心数学/物理公式、构建“先思考后讲解”启发式问题',
                },
                {
                  step: 3,
                  threshold: 6.0,
                  label: '3. 绘制图文同步 SVG 教学图示与分层闭环练习题',
                },
                {
                  step: 4,
                  threshold: 10.5,
                  label: `4. 执行中间步骤与量纲自检并写入 lessons/${slot.id}.json`,
                },
              ].map((st, idx, arr) => {
                const isDone =
                  idx < arr.length - 1 && regenElapsedSec >= arr[idx + 1].threshold;
                const isActive =
                  regenElapsedSec >= st.threshold &&
                  (idx === arr.length - 1 || regenElapsedSec < arr[idx + 1].threshold);
                return (
                  <div
                    key={st.step}
                    className={`flex items-center gap-2 px-3 py-2 rounded border ${
                      isActive
                        ? 'border-sky-700/70 bg-sky-950/40 text-sky-100 font-medium'
                        : isDone
                          ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-300'
                          : 'border-neutral-900 bg-black/50 text-neutral-500'
                    }`}
                  >
                    {isDone ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : isActive ? (
                      <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
                    ) : (
                      <span className="w-3.5 h-3.5 inline-block rounded-full border border-neutral-700 shrink-0" />
                    )}
                    <span>{st.label}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {!isRegenerating && regenSuccessSummary && (
          <div className="mb-6 border border-emerald-800/70 bg-emerald-950/25 rounded px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-300">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{regenSuccessSummary}</span>
            </div>
            <button
              type="button"
              onClick={() => setRegenSuccessSummary(null)}
              className="text-neutral-400 hover:text-white"
            >
              关闭提示
            </button>
          </div>
        )}

        {/* 小节资料快速获取栏 (Quick Section Material Access) */}
        <section
          aria-label="本节输入材料与提示词快速获取"
          className="mb-6 border border-neutral-900 rounded p-4 bg-neutral-950/50 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-neutral-400">
              <span className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-200">
                小节 ID：{slot.id}
              </span>
              <span>第 {slot.dayIndex} 天（{slot.date}）</span>
              {slot.pdfSegment ? (
                <span className="text-neutral-200">
                  · 小节 PDF：物理页第 {slot.pdfSegment.physicalStartPage}–{slot.pdfSegment.physicalEndPage} 页
                  {slot.pdfSegment.printedStartPage != null &&
                  slot.pdfSegment.printedEndPage != null
                    ? `（印刷页 ${slot.pdfSegment.printedStartPage}–${slot.pdfSegment.printedEndPage}）`
                    : ''}{' '}
                  ({slot.pdfSegment.segmentRelPath})
                </span>
              ) : hasPdfSource ? (
                <span className="text-neutral-500">· PDF 待切割或可立即按本节切割</span>
              ) : null}
              {course.category === 'english' && slot.assignedWords && (
                <span className="text-neutral-300">
                  · 今日目标词汇：{slot.assignedWords.length} 词
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!slot.pdfSegment && hasPdfSource && (
                <button
                  type="button"
                  onClick={handleQuickCutSectionPdf}
                  disabled={isCuttingSegment}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>{isCuttingSegment ? '切割中...' : '切割并获取本节 PDF'}</span>
                </button>
              )}

              {!isChatWorkbenchOpen && (
                <>
                  <button
                    type="button"
                    onClick={handleQuickCopySectionPrompt}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap"
                  >
                    {copiedQuickPrompt ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>已复制本节提示词</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>复制本节生成提示词</span>
                      </>
                    )}
                  </button>

                  {slot.pdfSegment ? (
                    <>
                      <button
                        type="button"
                        onClick={handleCopyPdfFileToClipboard}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap"
                        title="将本节 PDF 文件直接复制到系统剪贴板（等效在资源管理器按 Ctrl+C），可直接 Ctrl+V 粘贴"
                      >
                        {copiedQuickPdf ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>已复制本节 PDF</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>复制小节 PDF</span>
                          </>
                        )}
                      </button>
                      <a
                        href={`/api/courses/${course.id}/segments/${slot.pdfSegment.sectionId || slot.id}/pdf?download=1`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors whitespace-nowrap"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>
                          下载/打开本节 PDF ({slot.pdfSegment.segmentFileName || `${slot.pdfSegment.sectionId || slot.id}.pdf`})
                        </span>
                      </a>
                    </>
                  ) : firstPdfMaterial ? (
                    <>
                      <button
                        type="button"
                        onClick={handleCopyPdfFileToClipboard}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap"
                        title="将原教材 PDF 文件直接复制到系统剪贴板，等效资源管理器 Ctrl+C"
                      >
                        {copiedQuickPdf ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>已复制原 PDF</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>复制原 PDF</span>
                          </>
                        )}
                      </button>
                      <a
                        href={`/api/courses/${course.id}/files/download?path=${encodeURIComponent(`sources/${firstPdfMaterial.fileName}`)}&download=1`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>下载原 PDF ({firstPdfMaterial.fileName})</span>
                      </a>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {pdfCopyNotice && (
            <div className="text-xs text-emerald-400 border border-emerald-900/60 bg-emerald-950/25 rounded px-3 py-2">
              {pdfCopyNotice}
            </div>
          )}

          <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              教学范围：
              <span
                className="[&_.katex]:text-neutral-300"
                dangerouslySetInnerHTML={{
                  __html: renderInlineMathWithLatex(slot.objective),
                }}
              />
            </span>
            {slot.prerequisites && slot.prerequisites.length > 0 && (
              <span>
                先修知识：
                <span
                  dangerouslySetInnerHTML={{
                    __html: renderInlineMathWithLatex(slot.prerequisites.join(' / ')),
                  }}
                />
              </span>
            )}
          </div>
        </section>

        {/* 统一同级工作台：Chat 模式提示词粘贴导入 · Agent 本地工作区同步 · 直接编辑正文与配图 */}
        {isChatWorkbenchOpen && (
          <section
            aria-label="本节课件生成、导入更新与直接编辑工作台"
            className="mb-8 border border-neutral-800 rounded p-5 bg-neutral-950/60 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-900 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  {slot.lesson ? '更新 / 编辑本节课件' : 'Chat / Agent 课件生成工作台'} — 第{' '}
                  {slot.dayIndex}/{course.durationDays} 讲：
                  <span
                    dangerouslySetInnerHTML={{
                      __html: renderInlineMathWithLatex(slot.title),
                    }}
                  />
                </h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {workbenchTab === 'edit' && slot.lesson
                    ? '直接调整当前课件的标题、导读摘要、正文 Markdown / LaTeX 或补充上传本地插图'
                    : workbenchTab === 'agent'
                      ? `复制 Agent 提示词交给本地 AI Agent 将课件写入 lessons/${slot.id}.json，完成后点击下方“扫描并同步本地课程文件夹”即可生效`
                      : `1. 复制提示词并附上本节 PDF 发送给外部多模态 AI ➔ 2. 粘贴返回结果 ➔ 3. ${nextSlot ? '保存并直接进入下一讲' : '确认保存本节课件'}`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex flex-wrap rounded border border-neutral-800 bg-black p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setWorkbenchTab('chat');
                      handlePersistModePreference('chat');
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
                      workbenchTab === 'chat'
                        ? 'bg-neutral-800 text-white font-medium'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Chat 提示词与粘贴导入</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWorkbenchTab('agent');
                      handlePersistModePreference('agent');
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
                      workbenchTab === 'agent'
                        ? 'bg-neutral-800 text-white font-medium'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <FolderSync className="w-3.5 h-3.5" />
                    <span>Agent 本地工作区同步</span>
                  </button>
                  {slot.lesson && (
                    <button
                      type="button"
                      onClick={() => setWorkbenchTab('edit')}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
                        workbenchTab === 'edit'
                          ? 'bg-neutral-800 text-white font-medium'
                          : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>直接修改正文与配图</span>
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setIsChatWorkbenchOpen(false)}
                  className="px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-400 hover:text-white rounded"
                >
                  收起面板
                </button>
              </div>
            </div>

            {slot.lesson && workbenchTab === 'edit' ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-neutral-400">
                    修改当前已生成的课件内容（支持 Markdown、LaTeX 公式与本地图片插入）：
                  </span>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded cursor-pointer transition-colors">
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>上传并插入本地图片</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => handleUploadSupplementalImages(e)}
                      className="hidden"
                    />
                  </label>
                </div>

                {existingLessonUnresolvedRefs.length > 0 && (
                  <div className="border border-amber-900/60 bg-amber-950/20 rounded p-3 space-y-2 text-xs">
                    <div className="text-amber-300">
                      当前课件包含未绑定的图片引用，点击下方按钮可绑定对应图片：
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {existingLessonUnresolvedRefs.map((refName) => (
                        <label
                          key={refName}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-black border border-amber-800 text-amber-200 rounded cursor-pointer font-mono"
                        >
                          <ImagePlus className="w-3.5 h-3.5" />
                          <span>绑定 {refName}</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleUploadSupplementalImages(e, refName)}
                            className="hidden"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">课件标题</label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full bg-black border border-neutral-800 rounded px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">本节导读摘要</label>
                    <input
                      type="text"
                      value={editSummary}
                      onChange={(e) => setEditSummary(e.target.value)}
                      className="w-full bg-black border border-neutral-800 rounded px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-neutral-400 mb-1">
                    课件正文（支持 Markdown、LaTeX 公式 $...$ / $$...$$ 与图片引用 ![说明](文件名.png)）
                  </label>
                  <textarea
                    rows={10}
                    value={editMarkdown}
                    onChange={(e) => setEditMarkdown(e.target.value)}
                    className="w-full bg-black border border-neutral-800 rounded p-3 text-xs font-mono text-neutral-200 leading-relaxed"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsChatWorkbenchOpen(false)}
                    className="px-3 py-1.5 text-xs border border-neutral-800 rounded text-neutral-400 hover:text-white"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEditedLesson}
                    disabled={isSavingEdit}
                    className="px-4 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded"
                  >
                    {isSavingEdit ? '正在保存...' : '保存修改'}
                  </button>
                </div>
              </div>
            ) : workbenchTab === 'agent' ? (
              /* 同级内联 Agent 模式面板（无需弹窗，与 Chat 模式平级切换） */
              <div className="space-y-4">
                <div className="border border-neutral-900 rounded p-3.5 bg-black/70 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono text-neutral-400">
                  <div>
                    <span className="text-neutral-500">本地课程目录：</span>
                    <span className="text-neutral-200">
                      {agentWorkspaceDir || course.courseDirPath || `courses/${course.folderName || course.id}`}/
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-500">本节目标落盘文件：</span>
                    <span className="text-emerald-300">
                      {agentWorkspaceDir || course.courseDirPath || `courses/${course.folderName || course.id}`}/lessons/{slot.id}.json
                    </span>
                  </div>
                  {slot.pdfSegment && (
                    <div className="md:col-span-2">
                      <span className="text-neutral-500">本节教材 PDF 切片：</span>
                      <span className="text-neutral-200">
                        {agentWorkspaceDir || course.courseDirPath || `courses/${course.folderName || course.id}`}/{slot.pdfSegment.segmentRelPath}（物理页第 {slot.pdfSegment.physicalStartPage}–{slot.pdfSegment.physicalEndPage} 页）
                      </span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="agent-inline-prompt-box"
                      className="text-xs font-medium text-neutral-300"
                    >
                      第一步：复制 Agent 任务提示词（面向 Antigravity / Codex / Claude Code 等具备文件读写能力的 Agent）
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopyAgentPromptInline}
                        disabled={isLoadingAgentPrompt || !agentPromptText}
                        className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors whitespace-nowrap"
                      >
                        {copiedAgentPrompt ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>已复制 Agent 提示词</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>一键复制 Agent 提示词</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadAgentPromptInline}
                        disabled={isLoadingAgentPrompt || !agentPromptText}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-300 rounded transition-colors whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>导出 (.md)</span>
                      </button>
                    </div>
                  </div>

                  <textarea
                    id="agent-inline-prompt-box"
                    readOnly
                    rows={7}
                    value={
                      isLoadingAgentPrompt
                        ? '正在生成本地 Agent 执行提示词...'
                        : agentPromptText
                    }
                    className="w-full bg-black border border-neutral-800 rounded p-3 text-xs font-mono text-neutral-300 leading-relaxed focus:outline-none"
                  />
                </div>

                <div className="space-y-3 pt-2 border-t border-neutral-900">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-neutral-300 font-medium">
                      第二步：Agent 写入 <code className="text-neutral-200">lessons/{slot.id}.json</code> 后，扫描同步本地文件夹或直接选择生成的 JSON 文件导入
                    </div>
                    <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={agentForceOverwrite}
                        onChange={(e) => setAgentForceOverwrite(e.target.checked)}
                        className="accent-white"
                      />
                      <span>覆盖已有课件（默认不勾选以保护已有内容）</span>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSyncAgentDirectoryInline}
                      disabled={isSyncingAgent}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors disabled:opacity-50"
                    >
                      <FolderSync className={`w-3.5 h-3.5 ${isSyncingAgent ? 'animate-spin' : ''}`} />
                      <span>{isSyncingAgent ? '正在扫描并同步...' : '扫描并同步本地课程文件夹'}</span>
                    </button>

                    <label className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-700 rounded cursor-pointer transition-colors">
                      <Upload className="w-3.5 h-3.5" />
                      <span>选择文件批量导入 (sec-XX.json / outline.json)</span>
                      <input
                        type="file"
                        multiple
                        accept=".json,.md"
                        onChange={handleAgentBatchUploadInline}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {agentSyncMsg && (
                    <div className="text-xs text-emerald-400 border border-emerald-900/60 bg-emerald-950/30 rounded px-3 py-2">
                      {agentSyncMsg}
                    </div>
                  )}
                  {agentSyncErr && (
                    <div className="text-xs text-red-400 border border-red-900/60 bg-red-950/30 rounded px-3 py-2">
                      {agentSyncErr}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* 步骤 1：复制单节课件提示词与 PDF */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="chat-prompt-box"
                      className="text-xs font-medium text-neutral-300"
                    >
                      第一步：复制本节教学提示词，连同 PDF 文件一并发送给 ChatGPT / Gemini 等多模态 AI
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      {slot.pdfSegment ? (
                        <>
                          <button
                            type="button"
                            onClick={handleCopyPdfFileToClipboard}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                            title="将本节 PDF 复制到系统剪贴板，等效资源管理器 Ctrl+C"
                          >
                            {copiedQuickPdf ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{copiedQuickPdf ? '已复制本节 PDF' : '复制本节 PDF'}</span>
                          </button>
                          <a
                            href={`/api/courses/${course.id}/segments/${slot.pdfSegment.sectionId || slot.id}/pdf?download=1`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 rounded transition-colors whitespace-nowrap"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>下载本节 PDF</span>
                          </a>
                        </>
                      ) : firstPdfMaterial ? (
                        <>
                          <button
                            type="button"
                            onClick={handleCopyPdfFileToClipboard}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                            title="将原 PDF 复制到系统剪贴板，等效资源管理器 Ctrl+C"
                          >
                            {copiedQuickPdf ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{copiedQuickPdf ? '已复制原 PDF' : '复制原 PDF'}</span>
                          </button>
                          <a
                            href={`/api/courses/${course.id}/files/download?path=${encodeURIComponent(`sources/${firstPdfMaterial.fileName}`)}&download=1`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 rounded transition-colors whitespace-nowrap"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>下载原 PDF</span>
                          </a>
                        </>
                      ) : null}
                      <button
                        type="button"
                        onClick={handleCopyChatPrompt}
                        disabled={isLoadingChatPrompt}
                        className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors whitespace-nowrap"
                      >
                        {copiedPrompt ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>已复制提示词</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>一键复制提示词</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadChatPrompt}
                        disabled={isLoadingChatPrompt}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-300 rounded transition-colors whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>导出 (.md)</span>
                      </button>
                    </div>
                  </div>

                  <textarea
                    id="chat-prompt-box"
                    readOnly
                    rows={7}
                    value={
                      isLoadingChatPrompt
                        ? '正在生成针对本节的完整提示词...'
                        : chatLessonPrompt
                    }
                    className="w-full bg-black border border-neutral-800 rounded p-3 text-xs font-mono text-neutral-300 leading-relaxed focus:outline-none"
                  />
                </div>

                {/* 步骤 2：粘贴 AI 输出或通过文件导入 */}
                <div className="space-y-2 pt-2 border-t border-neutral-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="chat-import-box"
                      className="text-xs font-medium text-neutral-300"
                    >
                      第二步：将外部 AI 生成的回复粘贴到下方（支持完整 JSON 代码块或含 LaTeX / SVG 的 Markdown），或通过文件导入
                    </label>

                    <div className="flex items-center gap-2">
                      <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded cursor-pointer transition-colors whitespace-nowrap">
                        <Upload className="w-3.5 h-3.5" />
                        <span>从文件导入 (.json / .md / .txt)</span>
                        <input
                          type="file"
                          accept=".json,.md,.txt"
                          onChange={handleImportFileSelect}
                          className="hidden"
                        />
                      </label>

                      <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded cursor-pointer transition-colors whitespace-nowrap">
                        <ImagePlus className="w-3.5 h-3.5" />
                        <span>补充上传课件图片</span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => handleUploadSupplementalImages(e)}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  <textarea
                    id="chat-import-box"
                    rows={7}
                    value={rawImportInput}
                    onChange={(e) => setRawImportInput(e.target.value)}
                    placeholder="在此粘贴外部 AI 输出的课件内容（支持 ```json ... ``` 代码块或完整 Markdown 讲义）..."
                    className="w-full bg-black border border-neutral-800 rounded p-3 text-xs font-mono text-neutral-200 leading-relaxed focus:outline-none focus:border-neutral-500"
                  />

                  {/* 检测到的未绑定图片引用提示 */}
                  {unresolvedImages.length > 0 && (
                    <div className="border border-amber-900/60 bg-amber-950/20 rounded p-3 space-y-2 text-xs">
                      <div className="text-amber-300 font-medium">
                        检测到课件引用了以下本地图片，可点击对应按钮补充上传图片文件：
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {unresolvedImages.map((imgRef) => (
                          <label
                            key={imgRef}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-black border border-amber-800 hover:border-amber-500 text-amber-200 rounded cursor-pointer font-mono"
                          >
                            <ImagePlus className="w-3.5 h-3.5" />
                            <span>上传 {imgRef}</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleUploadSupplementalImages(e, imgRef)}
                              className="hidden"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {importError && (
                    <div className="text-xs text-red-400 border border-red-900/60 bg-red-950/30 rounded px-3 py-2">
                      {importError}
                    </div>
                  )}

                  {importSuccessMsg && (
                    <div className="text-xs text-emerald-400 border border-emerald-900/60 bg-emerald-950/30 rounded px-3 py-2">
                      {importSuccessMsg}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <div className="text-xs text-neutral-500">
                      {previewLesson ? (
                        <span>
                          已解析预览：《
                          <span
                            dangerouslySetInnerHTML={{
                              __html: renderInlineMathWithLatex(previewLesson.title),
                            }}
                          />
                          》（含 {previewLesson.exercises.length} 道练习题）。页面底部保存栏亦随时可点击保存。
                        </span>
                      ) : (
                        '粘贴或选择文件后可直接保存，或先点击“解析并预览课件”检查排版。'
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handlePreviewImportedContent}
                        disabled={!rawImportInput.trim()}
                        className="px-3.5 py-1.5 text-xs font-medium border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white rounded transition-colors disabled:opacity-50"
                      >
                        解析并预览课件
                      </button>

                      <button
                        type="button"
                        onClick={() => handleConfirmSaveImport(false)}
                        disabled={isSavingImport || (!rawImportInput.trim() && !previewLesson)}
                        className={`px-4 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-50 ${
                          nextSlot && onSelectDayIndex
                            ? 'border border-neutral-600 hover:border-neutral-400 text-neutral-100'
                            : 'bg-white text-black hover:bg-neutral-200'
                        }`}
                      >
                        {isSavingImport ? '正在保存...' : nextSlot ? '确认保存并留在本节' : '确认保存本节课件'}
                      </button>

                      {nextSlot && onSelectDayIndex && (
                        <button
                          type="button"
                          onClick={() => handleConfirmSaveImport(true)}
                          disabled={isSavingImport || (!rawImportInput.trim() && !previewLesson)}
                          className="px-4 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors disabled:opacity-50"
                        >
                          {isSavingImport ? '正在保存...' : `保存并进入第 ${nextSlot.dayIndex} 讲 →`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {!activeLesson ? (
          !isChatWorkbenchOpen ? (
            <div className="border border-neutral-800 rounded p-8 my-8 space-y-4">
              <div className="text-xs font-mono text-neutral-500">
                {slot.date} · 第 {slot.dayIndex}/{course.durationDays} 讲 · 尚未生成本节课件
              </div>
              <h1
                className="text-xl font-semibold text-white"
                dangerouslySetInnerHTML={{ __html: renderInlineMathWithLatex(slot.title) }}
              />
              <p
                className="text-sm text-neutral-400"
                dangerouslySetInnerHTML={{ __html: renderInlineMathWithLatex(slot.objective) }}
              />
              {slot.prerequisites && slot.prerequisites.length > 0 && (
                <div className="text-xs text-neutral-500">
                  本节先修知识：
                  <span
                    dangerouslySetInnerHTML={{
                      __html: renderInlineMathWithLatex(slot.prerequisites.join(' · ')),
                    }}
                  />
                </div>
              )}
              <div className="text-xs text-neutral-500 pb-2">
                计划涵盖知识点：
                <span
                  dangerouslySetInnerHTML={{
                    __html: renderInlineMathWithLatex(slot.keyTopics.join(' · ')),
                  }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleRegenerateLesson}
                  disabled={isRegenerating}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
                  <span>{isRegenerating ? '正在生成完整课件...' : 'API 自动生成本节课件'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setWorkbenchTab('chat');
                    setIsChatWorkbenchOpen(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white rounded transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Chat 提示词与粘贴导入</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setWorkbenchTab('agent');
                    setIsChatWorkbenchOpen(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white rounded transition-colors"
                >
                  <FolderSync className="w-3.5 h-3.5" />
                  <span>Agent 本地工作区同步</span>
                </button>
              </div>
            </div>
          ) : null
        ) : (
          <article
            className="space-y-10"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              const refBtn = target.closest('[data-visual-ref]') as HTMLElement | null;
              if (refBtn) {
                const refId = refBtn.getAttribute('data-visual-ref');
                if (refId) {
                  e.preventDefault();
                  openFloatingVisual(refId);
                }
                return;
              }
              const imgEl = target.closest('.lesson-prose img') as HTMLImageElement | null;
              if (imgEl && imgEl.src) {
                const matched = lessonVisuals.find(
                  (v) =>
                    v.kind === 'image' &&
                    (v.imageUrl === imgEl.getAttribute('src') || v.imageUrl === imgEl.src)
                );
                if (matched) {
                  openFloatingVisual(matched.id);
                } else {
                  openFloatingVisual('img-inline-click', {
                    id: 'img-inline-click',
                    title: imgEl.alt || '插图放大预览',
                    kind: 'image',
                    imageUrl: imgEl.src,
                    index: lessonVisuals.length + 1,
                  });
                }
              }
            }}
          >
            {previewLesson && (
              <div className="border border-emerald-800 bg-emerald-950/30 rounded p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                <span className="text-emerald-300">
                  当前正在预览待导入的课件内容，确认无误后可直接保存。
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewLesson(null)}
                    className="px-3 py-1 border border-neutral-700 rounded text-neutral-300 hover:text-white"
                  >
                    退出预览
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfirmSaveImport(false)}
                    disabled={isSavingImport}
                    className="px-3.5 py-1 border border-neutral-600 text-neutral-100 font-medium rounded hover:border-neutral-400"
                  >
                    {isSavingImport ? '保存中...' : '确认保存本节课件'}
                  </button>
                  {nextSlot && onSelectDayIndex && (
                    <button
                      type="button"
                      onClick={() => handleConfirmSaveImport(true)}
                      disabled={isSavingImport}
                      className="px-3.5 py-1 bg-white text-black font-medium rounded hover:bg-neutral-200"
                    >
                      {isSavingImport ? '保存中...' : `保存并进入第 ${nextSlot.dayIndex} 讲 →`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Lesson Title, Teaching Context (Prerequisites, Scope, Connections) */}
            <header className="border-b border-neutral-900 pb-6 space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 font-mono">
                <span>{slot.date}</span>
                <span aria-hidden="true">·</span>
                <span>
                  第 {slot.dayIndex} / {course.durationDays} 天
                </span>
                {activeLesson.sourceMode && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      来源：
                      {activeLesson.sourceMode === 'agent'
                        ? 'Agent 课件模式'
                        : activeLesson.sourceMode === 'chat'
                          ? 'Chat 课件模式'
                          : 'API 自动生成'}
                    </span>
                  </>
                )}
              </div>
              <h1
                className="text-2xl font-semibold text-white tracking-tight"
                dangerouslySetInnerHTML={{
                  __html: renderInlineMathWithLatex(activeLesson.title, lessonVisuals),
                }}
              />
              <div
                className="text-sm text-neutral-300 leading-relaxed [&>p]:m-0"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdownWithLatex(activeLesson.summary, lessonVisuals),
                }}
              />

              {/* Teaching Context Box: 先修知识、学习目标、教学范围、前后课程联系 */}
              {activeLesson.teachingContext && (
                <div className="border border-neutral-900 rounded p-4 bg-neutral-950/50 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-neutral-400">
                  {activeLesson.teachingContext.prerequisites?.length > 0 && (
                    <div>
                      <span className="text-neutral-500">先修知识：</span>
                      <span
                        className="text-neutral-200"
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(
                            activeLesson.teachingContext.prerequisites.join('、'),
                            lessonVisuals
                          ),
                        }}
                      />
                    </div>
                  )}
                  {activeLesson.teachingContext.teachingScope && (
                    <div>
                      <span className="text-neutral-500">教学范围：</span>
                      <span
                        className="text-neutral-200"
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(
                            activeLesson.teachingContext.teachingScope,
                            lessonVisuals
                          ),
                        }}
                      />
                    </div>
                  )}
                  {activeLesson.teachingContext.learningObjectives?.length > 0 && (
                    <div className="md:col-span-2">
                      <span className="text-neutral-500">本节目标：</span>
                      <span
                        className="text-neutral-200"
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(
                            activeLesson.teachingContext.learningObjectives.join('；'),
                            lessonVisuals
                          ),
                        }}
                      />
                    </div>
                  )}
                  {activeLesson.teachingContext.connectionNote && (
                    <div className="md:col-span-2">
                      <span className="text-neutral-500">前后课程联系：</span>
                      <span
                        className="text-neutral-300"
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(
                            activeLesson.teachingContext.connectionNote,
                            lessonVisuals
                          ),
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {activeLesson.keyPoints && activeLesson.keyPoints.length > 0 && (
                <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400">
                  <span className="text-neutral-500">本节知识点：</span>
                  {activeLesson.keyPoints.map((pt, idx) => (
                    <span key={idx}>
                      {idx + 1}.{' '}
                      <span
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(pt, lessonVisuals),
                        }}
                      />
                    </span>
                  ))}
                </div>
              )}
            </header>

            {/* English Course Dedicated Module */}
            {activeLesson.englishPayload && (
              <section className="space-y-10">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-900 pb-3">
                    <div>
                      <h2 className="text-base font-semibold text-white">
                        一、本节目标词汇与例句（共 {activeLesson.englishPayload.targetWords.length} 词）
                      </h2>
                      {course.englishConfig && (
                        <p className="text-xs text-neutral-500 mt-0.5 font-mono">
                          词库范围：{course.englishConfig.targetBankName} −{' '}
                          {course.englishConfig.excludedBankName}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setHideVocabMeaning((v) => !v)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 transition-colors whitespace-nowrap"
                      >
                        {hideVocabMeaning ? (
                          <>
                            <Eye className="w-3.5 h-3.5" />
                            <span>显示释义</span>
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-3.5 h-3.5" />
                            <span>遮盖释义自测</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setVocabFilter((f) => (f === 'all' ? 'unmastered' : 'all'))
                        }
                        className="px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 transition-colors whitespace-nowrap"
                      >
                        {vocabFilter === 'all' ? '仅看未掌握' : '显示全部词汇'}
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-neutral-900 border border-neutral-900 rounded">
                    {activeLesson.englishPayload.targetWords
                      .filter((item) =>
                        vocabFilter === 'all'
                          ? true
                          : !course.masteredWords.includes(normalizeWordKey(item.word))
                      )
                      .map((item) => {
                        const isMastered = course.masteredWords.includes(
                          normalizeWordKey(item.word)
                        );
                        return (
                          <div
                            key={item.word}
                            className="p-4 flex flex-col md:flex-row md:items-start justify-between gap-4 bg-black hover:bg-neutral-950/60 transition-colors"
                          >
                            <div className="space-y-1.5 flex-1">
                              <div className="flex items-baseline gap-3">
                                <span className="text-base font-semibold text-white font-mono">
                                  {item.word}
                                </span>
                                {item.phonetic && (
                                  <span className="text-xs font-mono text-neutral-500">
                                    {item.phonetic}
                                  </span>
                                )}
                                <span
                                  className={`text-sm ${
                                    hideVocabMeaning
                                      ? 'bg-neutral-900 text-transparent select-none rounded px-2 cursor-pointer hover:text-neutral-200'
                                      : 'text-neutral-200'
                                  }`}
                                  onClick={() => hideVocabMeaning && setHideVocabMeaning(false)}
                                >
                                  {stripAiCitationArtifacts(item.meaning)}
                                </span>
                              </div>
                              {item.example && (
                                <div className="text-xs text-neutral-400 space-y-0.5 pt-1">
                                  <p className="font-serif-reading text-neutral-300 text-sm">
                                    {stripAiCitationArtifacts(item.example)}
                                  </p>
                                  {!hideVocabMeaning && item.exampleTranslation && (
                                    <p className="text-neutral-500">
                                      {stripAiCitationArtifacts(item.exampleTranslation)}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => handleToggleWordMastery(item.word)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border transition-colors whitespace-nowrap shrink-0 ${
                                isMastered
                                  ? 'border-neutral-700 bg-neutral-900 text-white'
                                  : 'border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200'
                              }`}
                            >
                              <Check className="w-3 h-3" />
                              <span>{isMastered ? '已掌握' : '标记已掌握'}</span>
                            </button>
                          </div>
                        );
                      })}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-900 pb-3">
                    <div>
                      <h2 className="text-base font-semibold text-white">
                        二、文章阅读：{stripAiCitationArtifacts(activeLesson.englishPayload.articleTitle)}
                      </h2>
                      {activeLesson.englishPayload.sourceReference && (
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {stripAiCitationArtifacts(activeLesson.englishPayload.sourceReference)} · 点击文中下划线词汇可查看释义
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowTranslation((v) => !v)}
                      className="px-3 py-1 text-xs border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 transition-colors whitespace-nowrap"
                    >
                      {showTranslation ? '隐藏中文译文（纯英阅读）' : '显示逐段中文译文'}
                    </button>
                  </div>

                  {activeWordCard && (
                    <div className="border border-neutral-700 bg-neutral-950 rounded p-3 flex items-center justify-between gap-4">
                      <div className="text-xs space-y-0.5">
                        <div className="flex items-center gap-2">
                          <strong className="text-sm font-mono text-white">
                            {activeWordCard.word}
                          </strong>
                          <span className="font-mono text-neutral-400">
                            {activeWordCard.phonetic}
                          </span>
                          <span className="text-neutral-200">{activeWordCard.meaning}</span>
                        </div>
                        {activeWordCard.example && (
                          <p className="text-neutral-400">{activeWordCard.example}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveWordCard(null)}
                        className="text-xs text-neutral-400 hover:text-white whitespace-nowrap"
                      >
                        关闭
                      </button>
                    </div>
                  )}

                  <div className="space-y-6">
                    {activeLesson.englishPayload.paragraphs.map((para, idx) => (
                      <div key={idx} className="space-y-2">
                        <p className="font-serif-reading text-base md:text-[17px] leading-8 text-neutral-100">
                          {renderHighlightedEnglishParagraph(
                            stripAiCitationArtifacts(para.english),
                            activeLesson.englishPayload!.targetWords
                          )}
                        </p>
                        {showTranslation && (
                          <p className="text-sm leading-relaxed text-neutral-400 pt-1">
                            {stripAiCitationArtifacts(para.chinese)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Closed-Loop Interleaved Self-Study Flow:
                先思考后讲解 (Inline Heuristics) + 图文同步 (Inline Diagrams) + 知识点即时练习 (Inline Exercises) */}
            {interleavedLessonFlow.blocks.length > 0 && (
              <section className="space-y-6">
                {interleavedLessonFlow.blocks.map((block, bIdx) => {
                  if (block.kind === 'markdown') {
                    return (
                      <div
                        key={`md-${bIdx}`}
                        className="lesson-prose"
                        dangerouslySetInnerHTML={{ __html: block.html }}
                      />
                    );
                  }

                  if (block.kind === 'heuristic') {
                    const hq = activeLesson.heuristicQuestions?.[block.hqIdx];
                    if (!hq) return null;
                    const hqKey = hq.id || `hq-${block.hqIdx + 1}`;
                    const isHintOpen = Boolean(revealedHeuristicHints[hqKey]);
                    const isFullOpen = Boolean(revealedHeuristics[hqKey]);

                    return (
                      <div
                        key={`hq-${hqKey}-${bIdx}`}
                        className="border border-neutral-800 rounded p-4 bg-neutral-950/60 space-y-3 my-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1.5 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-neutral-400">
                              <span className="px-1.5 py-0.5 border border-neutral-700 rounded text-neutral-200 bg-neutral-900">
                                先思考，后讲解
                              </span>
                              {hq.context && (
                                <span className="inline-flex flex-wrap items-center gap-1">
                                  <span>·</span>
                                  <span
                                    dangerouslySetInnerHTML={{
                                      __html: renderInlineMathWithLatex(hq.context, lessonVisuals),
                                    }}
                                  />
                                </span>
                              )}
                            </div>
                            <div
                              className="text-sm font-medium text-white leading-relaxed [&>p]:m-0"
                              dangerouslySetInnerHTML={{
                                __html: renderMarkdownWithLatex(hq.question, lessonVisuals),
                              }}
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {(hq.hint || hq.approach) && (
                              <button
                                type="button"
                                onClick={() =>
                                  setRevealedHeuristicHints((prev) => ({
                                    ...prev,
                                    [hqKey]: !prev[hqKey],
                                  }))
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 transition-colors whitespace-nowrap"
                              >
                                <HelpCircle className="w-3.5 h-3.5" />
                                <span>{isHintOpen ? '收起提示与思路' : '1. 查看提示与思路'}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setRevealedHeuristics((prev) => ({
                                  ...prev,
                                  [hqKey]: !prev[hqKey],
                                }))
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 rounded text-neutral-200 transition-colors whitespace-nowrap"
                            >
                              {isFullOpen ? (
                                <>
                                  <ChevronDown className="w-3.5 h-3.5" />
                                  <span>收起完整解释</span>
                                </>
                              ) : (
                                <>
                                  <ChevronRight className="w-3.5 h-3.5" />
                                  <span>2. 展开完整解释</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {isHintOpen && (hq.hint || hq.approach) && (
                          <div className="pt-2.5 border-t border-neutral-900 text-xs text-neutral-300 space-y-1.5">
                            {hq.hint && (
                              <div
                                className="leading-relaxed [&>p]:m-0"
                                dangerouslySetInnerHTML={{
                                  __html: renderMarkdownWithLatex(
                                    `**思考提示：** ${hq.hint}`,
                                    lessonVisuals
                                  ),
                                }}
                              />
                            )}
                            {hq.approach && (
                              <div
                                className="leading-relaxed text-neutral-400 [&>p]:m-0"
                                dangerouslySetInnerHTML={{
                                  __html: renderMarkdownWithLatex(
                                    `**分析切入思路：** ${hq.approach}`,
                                    lessonVisuals
                                  ),
                                }}
                              />
                            )}
                          </div>
                        )}

                        {isFullOpen && (
                          <div
                            className="pt-3 border-t border-neutral-900 text-xs text-neutral-300 leading-relaxed lesson-prose"
                            dangerouslySetInnerHTML={{
                              __html: renderMarkdownWithLatex(hq.answerReveal, lessonVisuals),
                            }}
                          />
                        )}
                      </div>
                    );
                  }

                  if (block.kind === 'diagram') {
                    const diag = activeLesson.diagrams?.[block.diagIdx];
                    if (!diag) return null;
                    const diagId = (diag.id || `diag-${block.diagIdx + 1}`).trim();
                    const visualEntry = lessonVisuals.find((v) => v.id === diagId);
                    const enhancedSvg = visualEntry?.svgCode || enhanceDiagramSvg(diag.svgCode);
                    const diagTitle = stripAiCitationArtifacts(diag.title || diagId);

                    return (
                      <figure
                        key={`diag-${diagId}-${bIdx}`}
                        className="border border-neutral-900 rounded p-4 bg-neutral-950/40 my-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-mono px-1.5 py-0.5 border border-neutral-800 rounded text-neutral-400">
                              图文同步 · {diagId}
                            </span>
                            <span
                              className="text-xs font-medium text-neutral-200"
                              dangerouslySetInnerHTML={{
                                __html: renderInlineMathWithLatex(diagTitle),
                              }}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            {diag.stageLabel && (
                              <span
                                className="text-xs font-mono text-neutral-400"
                                dangerouslySetInnerHTML={{
                                  __html: renderInlineMathWithLatex(diag.stageLabel),
                                }}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => openFloatingVisual(diagId)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 hover:text-white transition-colors whitespace-nowrap"
                              title="在悬浮小窗中打开此图，方便长推导或做题时随时对照"
                            >
                              <Pin className="w-3 h-3" />
                              <span>小窗置顶查看</span>
                            </button>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => openFloatingVisual(diagId)}
                          aria-label={`点击在小窗中查看图示：${diagTitle}`}
                          className="diagram-svg-frame w-full block text-left overflow-x-auto cursor-zoom-in rounded hover:bg-neutral-900/30 transition-colors focus:outline-none focus:ring-1 focus:ring-neutral-600"
                          dangerouslySetInnerHTML={{ __html: enhancedSvg }}
                        />
                        {diag.caption && (
                          <figcaption
                            className="text-xs text-neutral-400 mt-3 leading-relaxed [&>p]:m-0"
                            dangerouslySetInnerHTML={{
                              __html: renderMarkdownWithLatex(diag.caption, lessonVisuals),
                            }}
                          />
                        )}
                      </figure>
                    );
                  }

                  if (block.kind === 'exercise') {
                    const q = activeLesson.exercises?.[block.exIdx];
                    if (!q) return null;
                    const qIdx = block.exIdx;
                    const currentVal = userAnswers[q.id] || '';
                    const singleReport = gradeExerciseSet([q], userAnswers).details[q.id];
                    const showAnswer =
                      isSubmitted || Boolean(revealedSingleExercises[q.id]);
                    const showHint = Boolean(revealedExerciseHints[q.id]);
                    const diffLabel = q.difficulty
                      ? DIFFICULTY_LABELS[q.difficulty] || q.difficulty
                      : '';

                    return (
                      <div
                        key={`inline-ex-${q.id}-${bIdx}`}
                        className="border border-neutral-800 rounded p-5 bg-neutral-950/50 space-y-4 my-5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-neutral-400">
                              <span className="px-1.5 py-0.5 border border-neutral-700 rounded text-neutral-200 bg-neutral-900">
                                知识点闭环 · 即时练习 #{qIdx + 1}
                              </span>
                              {(diffLabel || q.categoryLabel) && (
                                <span
                                  dangerouslySetInnerHTML={{
                                    __html: renderInlineMathWithLatex(
                                      [diffLabel, q.categoryLabel].filter(Boolean).join(' · '),
                                      lessonVisuals
                                    ),
                                  }}
                                />
                              )}
                            </div>
                            <div
                              className="text-sm text-neutral-100 leading-relaxed pt-1 [&>p]:m-0"
                              dangerouslySetInnerHTML={{
                                __html: renderMarkdownWithLatex(q.question, lessonVisuals),
                              }}
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {q.hint && (
                              <button
                                type="button"
                                onClick={() =>
                                  setRevealedExerciseHints((prev) => ({
                                    ...prev,
                                    [q.id]: !prev[q.id],
                                  }))
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 transition-colors"
                              >
                                <HelpCircle className="w-3 h-3" />
                                <span>{showHint ? '隐藏提示' : '启发式提示'}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setRevealedSingleExercises((prev) => ({
                                  ...prev,
                                  [q.id]: !prev[q.id],
                                }))
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 rounded text-neutral-200 transition-colors"
                            >
                              {showAnswer ? '收起本题解析' : '核对本题答案与解析'}
                            </button>
                          </div>
                        </div>

                        {showHint && q.hint && (
                          <div
                            className="p-3 rounded border border-neutral-800 bg-black text-xs text-neutral-300 leading-relaxed [&>p]:m-0"
                            dangerouslySetInnerHTML={{
                              __html: renderMarkdownWithLatex(
                                `**启发式解题提示：** ${q.hint}`,
                                lessonVisuals
                              ),
                            }}
                          />
                        )}

                        {q.type === 'choice' && Array.isArray(q.options) ? (
                          <div className="grid grid-cols-1 gap-2">
                            {q.options.map((opt) => {
                              const letterMatch = opt.match(/^([A-Da-d])(?:\b|[.、:：\s])/);
                              const optKey = letterMatch ? letterMatch[1].toUpperCase() : opt;
                              const isSelected =
                                currentVal.toUpperCase() === optKey.toUpperCase() ||
                                currentVal === opt;

                              return (
                                <label
                                  key={opt}
                                  className={`flex items-center gap-3 p-2.5 rounded border text-xs cursor-pointer transition-colors ${
                                    isSelected
                                      ? 'border-white bg-neutral-900 text-white'
                                      : 'border-neutral-800 bg-black text-neutral-300 hover:border-neutral-700'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name={`exercise-${q.id}`}
                                    value={optKey}
                                    checked={isSelected}
                                    disabled={isSubmitted}
                                    onChange={() =>
                                      setUserAnswers((prev) => ({
                                        ...prev,
                                        [q.id]: optKey,
                                      }))
                                    }
                                    className="accent-white"
                                  />
                                  <span
                                    className="[&>p]:m-0"
                                    dangerouslySetInnerHTML={{
                                      __html: renderMarkdownWithLatex(opt, lessonVisuals),
                                    }}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          <div>
                            <input
                              type="text"
                              value={currentVal}
                              disabled={isSubmitted}
                              onChange={(e) =>
                                setUserAnswers((prev) => ({
                                  ...prev,
                                  [q.id]: e.target.value,
                                }))
                              }
                              placeholder="请输入你的答案..."
                              aria-label={`第 ${qIdx + 1} 题填空答案`}
                              className="w-full max-w-md bg-black border border-neutral-800 rounded px-3 py-2 text-sm font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500 disabled:opacity-70"
                            />
                          </div>
                        )}

                        {showAnswer && singleReport && (
                          <div className="pt-3 border-t border-neutral-900 text-xs space-y-2">
                            <div className="flex items-center justify-between gap-2 font-mono">
                              <span className="text-neutral-300">
                                标准答案：
                                <strong
                                  className="text-white"
                                  dangerouslySetInnerHTML={{
                                    __html: renderInlineMathWithLatex(
                                      singleReport.expected,
                                      lessonVisuals
                                    ),
                                  }}
                                />
                              </span>
                              {currentVal.trim() !== '' && (
                                <span
                                  className={
                                    singleReport.isCorrect ? 'text-emerald-400' : 'text-red-400'
                                  }
                                >
                                  {singleReport.isCorrect ? '✓ 回答正确' : '✗ 回答错误'}
                                </span>
                              )}
                            </div>
                            <div
                              className="text-neutral-300 leading-relaxed"
                              dangerouslySetInnerHTML={{
                                __html: renderMarkdownWithLatex(
                                  `**解题步骤与解析：** ${singleReport.explanation}`,
                                  lessonVisuals
                                ),
                              }}
                            />
                            {q.wrongOptionsAnalysis && (
                              <div
                                className="text-neutral-400 leading-relaxed"
                                dangerouslySetInnerHTML={{
                                  __html: renderMarkdownWithLatex(
                                    `**错误选项与常见误区分析：** ${q.wrongOptionsAnalysis}`,
                                    lessonVisuals
                                  ),
                                }}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }

                  return null;
                })}
              </section>
            )}

            {renderedGrammarNotes &&
              renderedGrammarNotes !==
                renderMarkdownWithLatex(activeLesson.markdownBody || '', lessonVisuals) && (
                <section className="space-y-3 border-t border-neutral-900 pt-6">
                  <div
                    className="lesson-prose"
                    dangerouslySetInnerHTML={{ __html: renderedGrammarNotes }}
                  />
                </section>
              )}

            {/* End-of-Chapter Comprehensive Exercises & Full-Lesson Offline Grading */}
            {activeLesson.exercises && activeLesson.exercises.length > 0 && (
              <section className="border-t border-neutral-800 pt-8 space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-white">
                      {interleavedLessonFlow.comprehensiveExerciseIndices.length > 0
                        ? '章节末综合与迁移练习（含全节自主检验判分）'
                        : '本节练习总评与离线判分'}
                    </h2>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      覆盖概念辨析、直接应用、错误分析与知识迁移；支持单题随时展开提示与解析，或点击下方按钮汇总本节全部 {activeLesson.exercises.length} 道练习得分（100% 离线可用）。
                    </p>
                  </div>

                  {isSubmitted && gradeReport && (
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono font-semibold text-white">
                        本节总得分：{gradeReport.score} / {gradeReport.total}
                      </span>
                      <button
                        type="button"
                        onClick={handleResetExercises}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>重做本节练习</span>
                      </button>
                    </div>
                  )}
                </div>

                <form onSubmit={handleSubmitExercises} className="space-y-6">
                  {interleavedLessonFlow.comprehensiveExerciseIndices.map((qIdx) => {
                    const q = activeLesson.exercises[qIdx];
                    if (!q) return null;
                    const currentVal = userAnswers[q.id] || '';
                    const singleReport = gradeExerciseSet([q], userAnswers).details[q.id];
                    const showAnswer =
                      isSubmitted || Boolean(revealedSingleExercises[q.id]);
                    const showHint = Boolean(revealedExerciseHints[q.id]);
                    const diffLabel = q.difficulty
                      ? DIFFICULTY_LABELS[q.difficulty] || q.difficulty
                      : '';

                    return (
                      <div
                        key={q.id}
                        className="border border-neutral-900 rounded p-5 bg-neutral-950/40 space-y-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-neutral-500">
                              <span className="px-1.5 py-0.5 border border-neutral-800 rounded text-neutral-300">
                                综合练习 #{qIdx + 1}
                              </span>
                              {(diffLabel || q.categoryLabel) && (
                                <span
                                  dangerouslySetInnerHTML={{
                                    __html: renderInlineMathWithLatex(
                                      [diffLabel, q.categoryLabel].filter(Boolean).join(' · '),
                                      lessonVisuals
                                    ),
                                  }}
                                />
                              )}
                            </div>
                            <div className="text-sm text-neutral-100 leading-relaxed flex gap-2 pt-1">
                              <span className="font-mono text-neutral-400 shrink-0">
                                {qIdx + 1}.
                              </span>
                              <div
                                className="[&>p]:m-0"
                                dangerouslySetInnerHTML={{
                                  __html: renderMarkdownWithLatex(q.question, lessonVisuals),
                                }}
                              />
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {q.hint && (
                              <button
                                type="button"
                                onClick={() =>
                                  setRevealedExerciseHints((prev) => ({
                                    ...prev,
                                    [q.id]: !prev[q.id],
                                  }))
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 transition-colors"
                              >
                                <HelpCircle className="w-3 h-3" />
                                <span>{showHint ? '隐藏提示' : '启发式提示'}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setRevealedSingleExercises((prev) => ({
                                  ...prev,
                                  [q.id]: !prev[q.id],
                                }))
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 rounded text-neutral-200 transition-colors"
                            >
                              {showAnswer ? '收起本题解析' : '核对本题答案与解析'}
                            </button>
                          </div>
                        </div>

                        {showHint && q.hint && (
                          <div
                            className="ml-5 p-3 rounded border border-neutral-800 bg-black text-xs text-neutral-300 leading-relaxed [&>p]:m-0"
                            dangerouslySetInnerHTML={{
                              __html: renderMarkdownWithLatex(
                                `**启发式解题提示：** ${q.hint}`,
                                lessonVisuals
                              ),
                            }}
                          />
                        )}

                        {q.type === 'choice' && Array.isArray(q.options) ? (
                          <div className="grid grid-cols-1 gap-2 pl-5">
                            {q.options.map((opt) => {
                              const letterMatch = opt.match(/^([A-Da-d])(?:\b|[.、:：\s])/);
                              const optKey = letterMatch ? letterMatch[1].toUpperCase() : opt;
                              const isSelected =
                                currentVal.toUpperCase() === optKey.toUpperCase() ||
                                currentVal === opt;

                              return (
                                <label
                                  key={opt}
                                  className={`flex items-center gap-3 p-2.5 rounded border text-xs cursor-pointer transition-colors ${
                                    isSelected
                                      ? 'border-white bg-neutral-900 text-white'
                                      : 'border-neutral-800 bg-black text-neutral-300 hover:border-neutral-700'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name={`exercise-${q.id}`}
                                    value={optKey}
                                    checked={isSelected}
                                    disabled={isSubmitted}
                                    onChange={() =>
                                      setUserAnswers((prev) => ({
                                        ...prev,
                                        [q.id]: optKey,
                                      }))
                                    }
                                    className="accent-white"
                                  />
                                  <span
                                    className="[&>p]:m-0"
                                    dangerouslySetInnerHTML={{
                                      __html: renderMarkdownWithLatex(opt, lessonVisuals),
                                    }}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="pl-5">
                            <input
                              type="text"
                              value={currentVal}
                              disabled={isSubmitted}
                              onChange={(e) =>
                                setUserAnswers((prev) => ({
                                  ...prev,
                                  [q.id]: e.target.value,
                                }))
                              }
                              placeholder="请输入你的答案..."
                              aria-label={`第 ${qIdx + 1} 题填空答案`}
                              className="w-full max-w-md bg-black border border-neutral-800 rounded px-3 py-2 text-sm font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500 disabled:opacity-70"
                            />
                          </div>
                        )}

                        {showAnswer && singleReport && (
                          <div className="pl-5 pt-3 border-t border-neutral-900 text-xs space-y-2">
                            <div className="flex items-center justify-between gap-2 font-mono">
                              <span className="text-neutral-300">
                                标准答案：
                                <strong
                                  className="text-white"
                                  dangerouslySetInnerHTML={{
                                    __html: renderInlineMathWithLatex(
                                      singleReport.expected,
                                      lessonVisuals
                                    ),
                                  }}
                                />
                              </span>
                              {currentVal.trim() !== '' && (
                                <span
                                  className={
                                    singleReport.isCorrect ? 'text-emerald-400' : 'text-red-400'
                                  }
                                >
                                  {singleReport.isCorrect ? '✓ 回答正确' : '✗ 回答错误'}
                                </span>
                              )}
                            </div>
                            <div
                              className="text-neutral-300 leading-relaxed"
                              dangerouslySetInnerHTML={{
                                __html: renderMarkdownWithLatex(
                                  `**解题步骤与解析：** ${singleReport.explanation}`,
                                  lessonVisuals
                                ),
                              }}
                            />
                            {q.wrongOptionsAnalysis && (
                              <div
                                className="text-neutral-400 leading-relaxed"
                                dangerouslySetInnerHTML={{
                                  __html: renderMarkdownWithLatex(
                                    `**错误选项与常见误区分析：** ${q.wrongOptionsAnalysis}`,
                                    lessonVisuals
                                  ),
                                }}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {!isSubmitted && (
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        className="px-5 py-2 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors"
                      >
                        提交判分
                      </button>
                    </div>
                  )}
                </form>
              </section>
            )}

            {/* Reverse Explanation Verification (反向解释检验) */}
            {activeLesson.reverseChecks && activeLesson.reverseChecks.length > 0 && (
              <section className="border-t border-neutral-800 pt-8 space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    理解检验（反向解释检验）
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    请尝试不看讲义，用自己的语言解释以下概念或说明结论为什么成立，然后对照参考要点检验是否真正想通。
                  </p>
                </div>

                <div className="space-y-4">
                  {activeLesson.reverseChecks.map((rc, idx) => {
                    const isRevealed = Boolean(revealedReverseChecks[rc.id]);
                    return (
                      <div
                        key={rc.id || idx}
                        className="border border-neutral-900 rounded p-5 bg-neutral-950/40 space-y-3"
                      >
                        <div className="text-xs font-mono text-neutral-400">
                          检验主题：
                          <span
                            dangerouslySetInnerHTML={{
                              __html: renderInlineMathWithLatex(rc.topic, lessonVisuals),
                            }}
                          />
                        </div>
                        <div
                          className="text-sm text-white leading-relaxed [&>p]:m-0"
                          dangerouslySetInnerHTML={{
                            __html: renderMarkdownWithLatex(rc.prompt, lessonVisuals),
                          }}
                        />

                        <textarea
                          rows={3}
                          value={reverseDrafts[rc.id] || ''}
                          onChange={(e) =>
                            setReverseDrafts((prev) => ({
                              ...prev,
                              [rc.id]: e.target.value,
                            }))
                          }
                          placeholder="用自己的话写下你的解释或推导逻辑（保存在本地）..."
                          className="w-full bg-black border border-neutral-800 rounded p-3 text-xs text-neutral-200 focus:outline-none focus:border-neutral-500"
                        />

                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleSaveReverseCheck(rc.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-700 rounded transition-colors"
                          >
                            <HelpCircle className="w-3.5 h-3.5" />
                            <span>保存并对照参考解释</span>
                          </button>
                        </div>

                        {isRevealed && (
                          <div className="pt-3 border-t border-neutral-900 space-y-2 text-xs">
                            {rc.keyPoints && rc.keyPoints.length > 0 && (
                              <div className="space-y-1">
                                <div className="font-medium text-neutral-300">
                                  自测核对要点：
                                </div>
                                <ul className="list-disc pl-5 text-neutral-400 space-y-0.5">
                                  {rc.keyPoints.map((kp, kpIdx) => (
                                    <li
                                      key={kpIdx}
                                      dangerouslySetInnerHTML={{
                                        __html: renderMarkdownWithLatex(kp, lessonVisuals),
                                      }}
                                    />
                                  ))}
                                </ul>
                              </div>
                            )}
                            <div
                              className="text-neutral-300 leading-relaxed pt-1"
                              dangerouslySetInnerHTML={{
                                __html: renderMarkdownWithLatex(
                                  `**参考解释：** ${rc.referenceExplanation}`,
                                  lessonVisuals
                                ),
                              }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Strict Correctness Audit & Quality Verification Summary */}
            {activeLesson.qualityCheck && (
              <section className="border-t border-neutral-900 pt-6">
                <div className="border border-neutral-900 rounded p-4 bg-neutral-950/30 space-y-2 text-xs text-neutral-400">
                  <div className="font-medium text-neutral-300">
                    课件内容与中间推理正确性复核说明
                  </div>
                  {activeLesson.qualityCheck.intermediateStepsAuditNote && (
                    <p className="leading-relaxed">
                      · 严格正确性检查：
                      <span
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(
                            activeLesson.qualityCheck.intermediateStepsAuditNote,
                            lessonVisuals
                          ),
                        }}
                      />
                    </p>
                  )}
                  {activeLesson.qualityCheck.derivationContinuityNote && (
                    <p className="leading-relaxed">
                      · 推导思路与连续性：
                      <span
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(
                            activeLesson.qualityCheck.derivationContinuityNote,
                            lessonVisuals
                          ),
                        }}
                      />
                    </p>
                  )}
                  {activeLesson.qualityCheck.diagramAlignmentNote && (
                    <p className="leading-relaxed">
                      · 图文同步与标注：
                      <span
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(
                            activeLesson.qualityCheck.diagramAlignmentNote,
                            lessonVisuals
                          ),
                        }}
                      />
                    </p>
                  )}
                  {activeLesson.qualityCheck.formulaAndUnitNote && (
                    <p className="leading-relaxed">
                      · 公式符号与单位：
                      <span
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(
                            activeLesson.qualityCheck.formulaAndUnitNote,
                            lessonVisuals
                          ),
                        }}
                      />
                    </p>
                  )}
                </div>
              </section>
            )}

            {onSelectDayIndex && (prevSlot || nextSlot) && (
              <nav
                aria-label="章节切换导航"
                className="border-t border-neutral-800 pt-6 flex flex-wrap items-center justify-between gap-3"
              >
                {prevSlot ? (
                  <button
                    type="button"
                    onClick={() => onSelectDayIndex(prevSlot.dayIndex)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>
                      上一讲：
                      <span
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(prevSlot.title),
                        }}
                      />
                    </span>
                  </button>
                ) : (
                  <span />
                )}

                {nextSlot && (
                  <button
                    type="button"
                    onClick={() => onSelectDayIndex(nextSlot.dayIndex)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors"
                  >
                    <span>
                      下一讲（第 {nextSlot.dayIndex} 讲）：
                      <span
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(nextSlot.title),
                        }}
                      />
                    </span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </nav>
            )}
          </article>
        )}
      </main>

      {/* 常驻底部保存课件操作栏：当填入待导入课件或正在预览课件时始终悬浮在页面底部，无需滚回顶部 */}
      {(previewLesson !== null || rawImportInput.trim().length > 0) && (
        <div
          role="region"
          aria-label="课件预览与常驻保存操作栏"
          className="fixed bottom-0 inset-x-0 z-40 bg-black/95 backdrop-blur border-t border-emerald-800/70 px-6 py-3 shadow-2xl"
        >
          <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              {previewLesson ? (
                <span className="text-emerald-200 truncate">
                  正在预览待保存课件：
                  <strong
                    className="font-semibold text-white ml-1"
                    dangerouslySetInnerHTML={{
                      __html: renderInlineMathWithLatex(previewLesson.title),
                    }}
                  />
                  <span className="text-neutral-400 ml-2 font-mono">
                    （含 {previewLesson.diagrams?.length || 0} 幅图示 ·{' '}
                    {previewLesson.exercises?.length || 0} 道练习）
                  </span>
                </span>
              ) : (
                <span className="text-neutral-200 truncate">
                  已填入待导入课件内容（{rawImportInput.trim().length} 字符），可随时预览排版或直接保存本节课件
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {previewLesson ? (
                <button
                  type="button"
                  onClick={() => setPreviewLesson(null)}
                  className="px-3 py-1.5 text-xs border border-neutral-700 hover:border-neutral-500 rounded text-neutral-300 hover:text-white transition-colors"
                >
                  退出预览
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePreviewImportedContent}
                  disabled={!rawImportInput.trim()}
                  className="px-3 py-1.5 text-xs font-medium border border-neutral-700 hover:border-neutral-500 rounded text-neutral-200 hover:text-white transition-colors disabled:opacity-50"
                >
                  解析并预览课件
                </button>
              )}

              <button
                type="button"
                onClick={() => handleConfirmSaveImport(false)}
                disabled={isSavingImport || (!rawImportInput.trim() && !previewLesson)}
                className={`px-4 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-50 ${
                  nextSlot && onSelectDayIndex
                    ? 'border border-emerald-600/80 bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-100'
                    : 'bg-white text-black hover:bg-neutral-200'
                }`}
              >
                {isSavingImport
                  ? '正在保存...'
                  : nextSlot
                    ? '确认保存本节课件'
                    : '确认保存本节课件'}
              </button>

              {nextSlot && onSelectDayIndex && (
                <button
                  type="button"
                  onClick={() => handleConfirmSaveImport(true)}
                  disabled={isSavingImport || (!rawImportInput.trim() && !previewLesson)}
                  className="px-4 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors disabled:opacity-50"
                >
                  {isSavingImport ? '正在保存...' : `保存并进入第 ${nextSlot.dayIndex} 讲 →`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 非阻塞悬浮小窗：长推导 / 做题时随时查看已点击的电路图、示意 SVG 或插图 */}
      {activeFloatingVisual && (
        <aside
          role="region"
          aria-label="悬浮看图小窗"
          style={{ transform: `translate(${floatingOffset.dx}px, ${floatingOffset.dy}px)` }}
          className={`fixed bottom-5 right-5 z-50 border border-neutral-700 bg-[#0a0a0a]/98 backdrop-blur rounded-lg shadow-2xl overflow-hidden transition-[width] duration-150 ${
            isFloatingExpanded ? 'w-[min(92vw,760px)]' : 'w-[min(88vw,390px)]'
          }`}
        >
          <div
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              dragStateRef.current = {
                dragging: true,
                startX: e.clientX,
                startY: e.clientY,
                origDx: floatingOffset.dx,
                origDy: floatingOffset.dy,
              };
            }}
            className="flex items-center justify-between gap-2 px-3 py-2 bg-neutral-900/95 border-b border-neutral-800 cursor-move select-none"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Move className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <Pin className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="text-xs font-mono text-neutral-400 shrink-0">
                {activeFloatingVisual.id}
              </span>
              <span
                className="text-xs font-medium text-white truncate"
                dangerouslySetInnerHTML={{
                  __html: renderInlineMathWithLatex(activeFloatingVisual.title),
                }}
              />
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setFloatingScale((s) => Math.max(0.75, +(s - 0.25).toFixed(2)))}
                aria-label="缩小悬浮图片"
                title="缩小"
                className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-mono text-neutral-400 min-w-[36px] text-center">
                {Math.round(floatingScale * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setFloatingScale((s) => Math.min(2, +(s + 0.25).toFixed(2)))}
                aria-label="放大悬浮图片"
                title="放大"
                className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsFloatingExpanded((v) => !v)}
                aria-label={isFloatingExpanded ? '还原小窗尺寸' : '加宽悬浮小窗'}
                title={isFloatingExpanded ? '还原小窗尺寸' : '加宽查看'}
                className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
              >
                {isFloatingExpanded ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setIsFloatingCollapsed((v) => !v)}
                aria-label={isFloatingCollapsed ? '展开悬浮小窗' : '折叠悬浮小窗'}
                title={isFloatingCollapsed ? '展开' : '折叠'}
                className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
              >
                {isFloatingCollapsed ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFloatingVisualId(null);
                  setFloatingTempVisual(null);
                }}
                aria-label="关闭悬浮图窗"
                title="关闭 (Esc)"
                className="p-1 text-neutral-400 hover:text-red-400 rounded hover:bg-neutral-800 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {!isFloatingCollapsed && (
            <>
              {lessonVisuals.length > 1 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-950 border-b border-neutral-900 overflow-x-auto">
                  {lessonVisuals.map((vis) => {
                    const isActive = vis.id === activeFloatingVisual.id;
                    return (
                      <button
                        key={vis.id}
                        type="button"
                        onClick={() => openFloatingVisual(vis.id)}
                        className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors whitespace-nowrap ${
                          isActive
                            ? 'border-sky-500/70 bg-sky-950/40 text-sky-200'
                            : 'border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200'
                        }`}
                      >
                        {vis.id}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="max-h-[65vh] overflow-auto p-3 bg-black">
                {activeFloatingVisual.kind === 'svg' ? (
                  <div
                    className="floating-diagram-svg mx-auto"
                    style={{ width: `${floatingScale * 100}%` }}
                    dangerouslySetInnerHTML={{
                      __html: activeFloatingVisual.svgCode || '',
                    }}
                  />
                ) : activeFloatingVisual.imageUrl ? (
                  <img
                    src={activeFloatingVisual.imageUrl}
                    alt={activeFloatingVisual.title}
                    style={{ width: `${floatingScale * 100}%` }}
                    className="max-w-none h-auto rounded mx-auto block"
                  />
                ) : null}
              </div>

              {activeFloatingVisual.caption && (
                <div
                  className="px-3 py-2 border-t border-neutral-900 bg-neutral-950 text-[11px] text-neutral-400 leading-relaxed"
                  dangerouslySetInnerHTML={{
                    __html: renderInlineMathWithLatex(activeFloatingVisual.caption),
                  }}
                />
              )}
            </>
          )}
        </aside>
      )}
    </div>
  );
};
