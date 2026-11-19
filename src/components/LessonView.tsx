import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
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
} from 'lucide-react';
import type { OutlineWorkbenchStep } from './CourseOutlineModal';
import type {
  Course,
  CourseGenerationMode,
  DailyLessonContent,
  DailyPlanSlot,
  ExerciseQuestion,
  ExerciseVariantCheck,
  LessonDiagram,
  PdfSplitPlanItem,
  StudyStats,
  VocabItem,
} from '../types';
import {
  extractDiagramSuffix,
  normalizeDiagramIdKey,
  renderInlineMathWithLatex,
  renderMarkdownWithLatex,
  type VisualAssetRef,
} from '../utils/markdownMath';
import { enhanceDiagramSvg, normalizeSvgLatexCommands } from '../utils/svgMath';
import {
  getEvaluatedSectionMinutes,
  getSlotExerciseSubmission,
  getTodayDateString,
  gradeExerciseSet,
  gradeSingleExercise,
  normalizeWordKey,
  resolveSlotPdfSegments,
} from '../utils/learningLogic';
import {
  detectPastedCoursewareInputKind,
  detectUnresolvedImageRefs,
  extractPendingDiagramSpecs,
  hasValidDiagramContent,
  mergeStage2DiagramsIntoStage1,
  parseImportedLessonContent,
  resolveLessonAssetReferences,
  stripAiCitationArtifacts,
} from '../utils/coursewareParser';
import {
  DiagramRenderer,
  hydrateAsyncMarkdownDiagrams,
  useCompiledLessonDiagrams,
} from './DiagramRenderer';
import {
  applyCoursewareRepairPatch,
  auditCoursewareRendering,
  auditRawCoursewareInput,
  buildStageRepairPrompt,
  type CoursewareDiagnosticReport,
  type LessonGenerationStage,
} from '../utils/coursewareDiagnostics';
import {
  annotateKatexSymbolsInContainer,
  buildLessonSymbolIndex,
  lookupSymbolInIndex,
  type ResolvedLessonSymbol,
} from '../utils/latexSymbols';
import {
  copyCourseFileToClipboard,
  copyPromptText,
  copyPromptMarkdownFileToClipboard,
} from '../utils/clipboardFile';
import { generateLessonWithProgressStream } from '../utils/streamLessonClient';
import type { GenerationProgressEvent } from '../utils/streamProgress';

const SAFE_EMPTY_AUDIT_REPORT: CoursewareDiagnosticReport = {
  hasErrors: false,
  errorCount: 0,
  warningCount: 0,
  issues: [],
  repairPrompt: '',
  summaryText: '',
};

function safeAuditCoursewareRendering(
  lesson: DailyLessonContent,
  customAssets?: Record<string, string>,
  options?: { stage?: 'stage1' | 'complete' }
): CoursewareDiagnosticReport {
  try {
    return auditCoursewareRendering(lesson, customAssets, options);
  } catch (err) {
    console.warn('[LessonView] auditCoursewareRendering fallback:', err);
    return SAFE_EMPTY_AUDIT_REPORT;
  }
}

function hasMathPreviewSignal(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /[\\^_${}()[\]|√=<>+*/α-ωΑ-Ω]/.test(trimmed);
}

function renderLiveMathPreview(value: string, visuals?: VisualAssetRef[]): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const normalized =
    !trimmed.includes('$') && /\\[A-Za-z]+|[_^]/.test(trimmed) && !/[\u4e00-\u9fff]/.test(trimmed)
      ? `$${trimmed}$`
      : trimmed;
  return renderInlineMathWithLatex(normalized, visuals);
}

function renderInputMathPreviewBox(
  value: string,
  visuals: VisualAssetRef[],
  testId: string,
  surfaceClass = 'bg-neutral-950/80'
): React.ReactNode {
  if (!hasMathPreviewSignal(value)) return null;
  return (
    <div
      data-testid={testId}
      className={`px-2.5 py-1.5 rounded border border-sky-900/50 ${surfaceClass} text-xs text-neutral-200 flex items-center gap-2 overflow-x-auto`}
    >
      <span className="text-[11px] font-mono text-sky-400 shrink-0">公式预览：</span>
      <span
        className="[&>p]:m-0"
        dangerouslySetInnerHTML={{
          __html: renderLiveMathPreview(value, visuals),
        }}
      />
    </div>
  );
}

interface LessonViewProps {
  course: Course;
  slot: DailyPlanSlot;
  backLabel?: string;
  onBack: (e?: React.MouseEvent) => void;
  onSelectDayIndex?: (dayIndex: number) => void;
  onCourseUpdated: (updatedCourse: Course) => void;
  onOpenOutlineModal?: (
    course: Course,
    step?: OutlineWorkbenchStep
  ) => void;
  onLiveStudySecondsChange?: (seconds: number) => void;
  onStudyStatsUpdated?: (stats: StudyStats) => void;
  showLessonTools?: boolean;
  showContentCategoryBadges?: boolean;
}

const DIFFICULTY_LABELS: Record<string, string> = {
  basic: '基础辨析',
  application: '直接应用',
  comprehensive: '综合与迁移分析',
};

export const LessonView: React.FC<LessonViewProps> = ({
  course,
  slot,
  backLabel = '时间轴',
  onBack,
  onSelectDayIndex,
  onCourseUpdated,
  onOpenOutlineModal,
  onLiveStudySecondsChange,
  onStudyStatsUpdated,
  showLessonTools = false,
  showContentCategoryBadges = false,
}) => {
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenElapsedSec, setRegenElapsedSec] = useState(0);
  const [regenProgress, setRegenProgress] = useState<GenerationProgressEvent | null>(null);
  const [regenSuccessSummary, setRegenSuccessSummary] = useState<string | null>(null);
  const [isDeletingLesson, setIsDeletingLesson] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  // Quick Section Material Access states
  const [copiedQuickPrompt, setCopiedQuickPrompt] = useState(false);
  const [copiedQuickPdfKey, setCopiedQuickPdfKey] = useState<string | null>(null);
  const [pdfCopyNotice, setPdfCopyNotice] = useState<string | null>(null);
  const [isCuttingSegment, setIsCuttingSegment] = useState(false);

  // Unified Inline Workbench states (Chat Mode, Agent Mode, and Direct Edit share the exact same inline level)
  const [isChatWorkbenchOpen, setIsChatWorkbenchOpen] = useState<boolean>(
    !slot.lesson && (course.generationMode === 'chat' || course.generationMode === 'agent')
  );
  useEffect(() => {
    if (!isChatWorkbenchOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setIsChatWorkbenchOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [isChatWorkbenchOpen]);
  const [workbenchTab, setWorkbenchTab] = useState<'chat' | 'agent' | 'edit'>(
    course.generationMode === 'agent' ? 'agent' : 'chat'
  );
  const [chatLessonPrompt, setChatLessonPrompt] = useState<string>('');
  const [chatStage1Prompt, setChatStage1Prompt] = useState<string>('');
  const [chatStage2Prompt, setChatStage2Prompt] = useState<string>('');
  const [isLoadingChatPrompt, setIsLoadingChatPrompt] = useState(false);
  const [copiedChatPromptKey, setCopiedChatPromptKey] = useState<
    'stage1' | 'stage2' | 'quick-stage2' | 'manual' | null
  >(null);
  const [chatPromptCopyNotice, setChatPromptCopyNotice] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [copiedMdKey, setCopiedMdKey] = useState<string | null>(null);
  const [showChatManualPaste, setShowChatManualPaste] = useState(false);

  // Inline Agent Mode states (same level as Chat Mode, no modal popup required)
  const [agentPromptText, setAgentPromptText] = useState<string>('');
  const [agentStage1Prompt, setAgentStage1Prompt] = useState<string>('');
  const [agentStage2Prompt, setAgentStage2Prompt] = useState<string>('');
  const [agentInlineStage, setAgentInlineStage] = useState<'stage1' | 'stage2'>('stage1');
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
  const [latchedImportAudit, setLatchedImportAudit] = useState<{
    report: ReturnType<typeof auditCoursewareRendering>;
    parsedLesson: DailyLessonContent | null;
  } | null>(null);
  const [manualPromptPreview, setManualPromptPreview] = useState<{
    title: string;
    text: string;
  } | null>(null);
  const [unresolvedImages, setUnresolvedImages] = useState<string[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [isSavingImport, setIsSavingImport] = useState(false);

  // Direct text & image fields inside the 'edit' tab of the unified workbench
  const [editTitle, setEditTitle] = useState(slot.lesson?.title || slot.title);
  const [editSummary, setEditSummary] = useState(slot.lesson?.summary || slot.objective);
  const [editMarkdown, setEditMarkdown] = useState(slot.lesson?.markdownBody || '');
  const [showEditPreview, setShowEditPreview] = useState(false);
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
  const savedSubmission = getSlotExerciseSubmission(course, slot);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>(
    savedSubmission?.userAnswers || {}
  );
  const [isSubmitted, setIsSubmitted] = useState<boolean>(Boolean(savedSubmission));
  const [revealedExerciseHints, setRevealedExerciseHints] = useState<Record<string, boolean>>({});
  const [revealedSingleExercises, setRevealedSingleExercises] = useState<Record<string, boolean>>(
    {}
  );
  const [variantAnswers, setVariantAnswers] = useState<Record<string, string>>({});
  const [variantSubmitted, setVariantSubmitted] = useState<Record<string, boolean>>({});

  // Reverse explanation self-check states (persisted locally offline)
  const savedReverseNotes =
    course.reverseCheckNotes?.[slot.id] || course.reverseCheckNotes?.[slot.date] || {};
  const [reverseDrafts, setReverseDrafts] = useState<Record<string, string>>(savedReverseNotes);
  const [revealedReverseChecks, setRevealedReverseChecks] = useState<Record<string, boolean>>({});

  // Hideable qualityCheck state (persisted in localStorage)
  const [hideQualityCheck, setHideQualityCheck] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem('learn_everything_hide_quality_check_v1');
      return stored === null ? true : stored === '1';
    } catch {
      return true;
    }
  });
  const handleToggleQualityCheckVisibility = (nextHidden: boolean) => {
    setHideQualityCheck(nextHidden);
    try {
      window.localStorage.setItem('learn_everything_hide_quality_check_v1', nextHidden ? '1' : '0');
    } catch {
      // ignore storage failure
    }
  };

  // Automatic render audit & repair prompt UI states
  const [copiedImportRepairPrompt, setCopiedImportRepairPrompt] = useState(false);
  const [copiedActiveRepairPrompt, setCopiedActiveRepairPrompt] = useState(false);
  const [copiedStageKey, setCopiedStageKey] = useState<LessonGenerationStage | null>(null);
  const [stageRepairPreview, setStageRepairPreview] = useState<{
    stage: LessonGenerationStage;
    prompt: string;
  } | null>(null);
  const [showActiveAuditDetails, setShowActiveAuditDetails] = useState(false);
  const [dismissedActiveAuditKey, setDismissedActiveAuditKey] = useState<string | null>(null);
  const [showQuickRepairBox, setShowQuickRepairBox] = useState(false);
  const [quickRepairInput, setQuickRepairInput] = useState('');
  const [isApplyingQuickRepair, setIsApplyingQuickRepair] = useState(false);
  const [quickRepairNotice, setQuickRepairNotice] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [importReplaceHint, setImportReplaceHint] = useState<string | null>(null);
  const chatImportBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const quickRepairBoxRef = useRef<HTMLTextAreaElement | null>(null);

  // Floating non-blocking diagram / image mini-window states
  const [floatingVisualId, setFloatingVisualId] = useState<string | null>(null);
  const [floatingTempVisual, setFloatingTempVisual] = useState<VisualAssetRef | null>(null);
  const [isFloatingExpanded, setIsFloatingExpanded] = useState(false);
  const [isFloatingCollapsed, setIsFloatingCollapsed] = useState(false);
  const [floatingOffset, setFloatingOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const dragStateRef = useRef<{
    dragging: boolean;
    pointerId?: number;
    startX: number;
    startY: number;
    origDx: number;
    origDy: number;
  }>({ dragging: false, startX: 0, startY: 0, origDx: 0, origDy: 0 });

  // Interactive LaTeX symbol explanation popover states (for symbols explained earlier in the lesson)
  const articleRef = useRef<HTMLElement | null>(null);
  const editPreviewRef = useRef<HTMLDivElement | null>(null);
  const [activeSymbolPopover, setActiveSymbolPopover] = useState<{
    entry: ResolvedLessonSymbol;
    rect: { left: number; top: number; bottom: number; width: number };
  } | null>(null);

  // Active displayed lesson: either previewLesson (when previewing in Chat Mode) or slot.lesson
  const activeLesson = previewLesson || slot.lesson;

  const boundSegments = useMemo(
    () => resolveSlotPdfSegments(slot, course.pdfSplitPlan),
    [slot, course.pdfSplitPlan]
  );
  const slicedBoundSegments = useMemo(
    () =>
      boundSegments.filter(
        (seg) =>
          seg.status === 'sliced' ||
          Boolean(seg.segmentRelPath || seg.segmentFileName)
      ),
    [boundSegments]
  );
  const primaryBoundSegment =
    slicedBoundSegments[0] || boundSegments[0] || slot.pdfSegment;

  const hasPdfSource = useMemo(
    () =>
      course.materials?.some(
        (m) => m.isPdf || m.fileName.toLowerCase().endsWith('.pdf')
      ) ||
      boundSegments.length > 0 ||
      Boolean(slot.pdfSegment),
    [course.materials, boundSegments.length, slot.pdfSegment]
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
    setLatchedImportAudit(null);
    setManualPromptPreview(null);
    setUnresolvedImages([]);
    setImportError(null);
    setImportSuccessMsg(null);
    setPendingAssets({});
    setPdfCopyNotice(null);
    setChatPromptCopyNotice(null);
    setCopiedChatPromptKey(null);
    setCopiedQuickPrompt(false);
    setRegenError(null);
    setRegenProgress(null);
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
    setFloatingOffset({ dx: 0, dy: 0 });
    setShowQuickRepairBox(false);
    setQuickRepairInput('');
    setQuickRepairNotice(null);
    setImportReplaceHint(null);
    setShowChatManualPaste(false);
    setCopiedMdKey(null);
    const sub = getSlotExerciseSubmission(course, slot);
    setUserAnswers(sub?.userAnswers || {});
    setIsSubmitted(Boolean(sub));
    setVariantAnswers({});
    setVariantSubmitted({});
    setStageRepairPreview(null);
    setCopiedStageKey(null);
    setReverseDrafts(
      course.reverseCheckNotes?.[slot.id] || course.reverseCheckNotes?.[slot.date] || {}
    );
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

  // Track real active study time inside LessonView and flush periodically + on unmount
  const unsyncedStudySecRef = useRef(0);
  const studyCourseIdRef = useRef(course.id);
  const onLiveStudySecondsChangeRef = useRef(onLiveStudySecondsChange);
  const onStudyStatsUpdatedRef = useRef(onStudyStatsUpdated);
  studyCourseIdRef.current = course.id;
  onLiveStudySecondsChangeRef.current = onLiveStudySecondsChange;
  onStudyStatsUpdatedRef.current = onStudyStatsUpdated;

  useEffect(() => {
    unsyncedStudySecRef.current = 0;
    onLiveStudySecondsChangeRef.current?.(0);

    const flushStudyTime = (useKeepalive = false) => {
      const pending = unsyncedStudySecRef.current;
      if (pending <= 0) return;
      unsyncedStudySecRef.current = 0;
      onLiveStudySecondsChangeRef.current?.(0);
      const payload = JSON.stringify({
        date: getTodayDateString(),
        courseId: studyCourseIdRef.current,
        deltaSeconds: pending,
      });
      fetch('/api/stats/study-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: useKeepalive,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.studyStats) {
            onStudyStatsUpdatedRef.current?.(data.studyStats);
          }
        })
        .catch(() => {
          // ignore transient sync failure
        });
    };

    const tickTimer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      unsyncedStudySecRef.current += 1;
      onLiveStudySecondsChangeRef.current?.(unsyncedStudySecRef.current);
      if (unsyncedStudySecRef.current >= 10) {
        flushStudyTime(false);
      }
    }, 1000);

    return () => {
      window.clearInterval(tickTimer);
      flushStudyTime(true);
    };
  }, [course.id, slot.dayIndex]);

  useEffect(() => {
    if (!floatingVisualId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFloatingVisualId(null);
        setFloatingTempVisual(null);
      }
    };
    const handlePointerMove = (e: PointerEvent) => {
      if (!dragStateRef.current.dragging || dragStateRef.current.pointerId !== e.pointerId) return;
      const nextDx = dragStateRef.current.origDx + (e.clientX - dragStateRef.current.startX);
      const nextDy = dragStateRef.current.origDy + (e.clientY - dragStateRef.current.startY);
      setFloatingOffset({
        dx: Math.max(-window.innerWidth + 180, Math.min(24, nextDx)),
        dy: Math.max(-window.innerHeight + 120, Math.min(24, nextDy)),
      });
    };
    const handlePointerUp = (e: PointerEvent) => {
      if (dragStateRef.current.pointerId === e.pointerId) dragStateRef.current.dragging = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
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
        setChatStage1Prompt(data.stage1Prompt || data.lessonPrompt || '');
        setChatStage2Prompt(data.stage2Prompt || '');
        if (data.agentStage1Prompt) setAgentStage1Prompt(data.agentStage1Prompt);
        if (data.agentStage2Prompt) {
          setAgentStage2Prompt(data.agentStage2Prompt);
          if (slot.stage1Draft && !slot.lesson) {
            setAgentInlineStage('stage2');
          }
        } else {
          setAgentStage2Prompt('');
          setAgentInlineStage('stage1');
        }
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        setIsLoadingChatPrompt(false);
      });
  }, [course.id, slot.dayIndex, slot.stage1Draft, slot.lesson]);

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

  const pendingLessonSpecs = useMemo(
    () => extractPendingDiagramSpecs(previewLesson || slot.stage1Draft || slot.lesson),
    [previewLesson, slot.stage1Draft, slot.lesson]
  );
  const isStage2PendingChat = Boolean(
    (pendingLessonSpecs.length > 0 || (slot.stage1Draft && !slot.lesson)) && chatStage2Prompt
  );
  const effectiveChatStepPrompt = isStage2PendingChat
    ? chatStage2Prompt
    : chatStage1Prompt || chatLessonPrompt;

  const handleCopyMdPromptFile = async (
    feedbackKey: string,
    fileName: string,
    content: string
  ) => {
    if (!content) return;
    setImportError(null);
    try {
      const result = await copyPromptMarkdownFileToClipboard(course.id, fileName, content);
      setCopiedMdKey(feedbackKey);
      setManualPromptPreview(null);
      window.setTimeout(
        () => setCopiedMdKey((prev) => (prev === feedbackKey ? null : prev)),
        2500
      );
      const okMsg = result.copiedToOsClipboard
        ? `已将 ${result.fileName || fileName} 作为文件复制到系统剪贴板，可直接 Ctrl+V 发送给 AI。`
        : result.reason || `已复制/触发下载 ${result.fileName || fileName}。`;
      setImportReplaceHint(okMsg);
      setChatPromptCopyNotice({ ok: true, message: `✅ ${okMsg}` });
      if (!isChatWorkbenchOpen) setPdfCopyNotice(`✅ ${okMsg}`);
    } catch (err: any) {
      setManualPromptPreview({
        title: `${fileName}（剪贴板受限，请点击一键复制或长按全选）`,
        text: content,
      });
      const failMsg = err?.message || '复制 .md 提示词失败，已在下方展开文本供手动复制。';
      setImportError(failMsg);
      setChatPromptCopyNotice({ ok: false, message: failMsg });
    }
  };

  const handleQuickCopySectionPrompt = async () => {
    setImportError(null);
    try {
      let promptToCopy = effectiveChatStepPrompt;
      let isStage2 = isStage2PendingChat;
      if (!promptToCopy) {
        const res = await fetch(`/api/courses/${course.id}/days/${slot.dayIndex}/chat-prompt`);
        if (!res.ok) throw new Error('获取本节提示词失败');
        const data = await res.json();
        const useStage2 = Boolean(slot.stage1Draft && !slot.lesson && data.stage2Prompt);
        isStage2 = useStage2;
        promptToCopy =
          (useStage2 && data.stage2Prompt) ||
          data.stage1Prompt ||
          data.lessonPrompt ||
          '';
        if (data.lessonPrompt) setChatLessonPrompt(data.lessonPrompt);
        if (data.stage1Prompt) setChatStage1Prompt(data.stage1Prompt);
        if (data.stage2Prompt) setChatStage2Prompt(data.stage2Prompt);
      }
      if (!promptToCopy) {
        throw new Error('未能获取当前小节提示词');
      }
      try {
        await copyPromptText(promptToCopy);
        setCopiedQuickPrompt(true);
        setManualPromptPreview(null);
        setPdfCopyNotice(
          `✅ 已复制${isStage2 ? '阶段二图表提示词' : '本节提示词'}（${promptToCopy.length} 字符），可直接切换到 AI 对话框粘贴。`
        );
        setTimeout(() => setCopiedQuickPrompt(false), 2500);
      } catch {
        setManualPromptPreview({
          title: isStage2 ? '阶段二图表提示词（请点击一键复制或长按全选）' : '本节提示词（请点击一键复制或长按全选）',
          text: promptToCopy,
        });
      }
    } catch (err: any) {
      setPdfCopyNotice(null);
      setImportError(err?.message || '获取本节提示词失败，请稍后重试。');
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
          sectionId: primaryBoundSegment?.sectionId || slot.pdfSegment?.sectionId || slot.regionId || slot.id,
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

  const handleCopyPdfFileToClipboard = async (
    targetSegmentOrEvent?: PdfSplitPlanItem | React.MouseEvent,
    copyKey = 'default'
  ) => {
    const targetSegment =
      targetSegmentOrEvent &&
      typeof targetSegmentOrEvent === 'object' &&
      'sectionId' in targetSegmentOrEvent
        ? targetSegmentOrEvent
        : primaryBoundSegment;
    setRegenError(null);
    setPdfCopyNotice(null);
    const relPath = targetSegment
      ? `segments/${targetSegment.segmentFileName || `${targetSegment.sectionId || slot.id}.pdf`}`
      : firstPdfMaterial
        ? `sources/${firstPdfMaterial.fileName}`
        : '';
    if (!relPath) return;

    try {
      const result = await copyCourseFileToClipboard(course.id, relPath);
      if (result.copiedToOsClipboard) setCopiedQuickPdfKey(copyKey);
      setTimeout(() => {
        setCopiedQuickPdfKey((prev) => (prev === copyKey ? null : prev));
      }, 2500);
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

  const importAuditResult = useMemo(() => {
    const trimmed = rawImportInput.trim();
    if (!trimmed) return null;
    try {
      const baseForPatch = previewLesson || slot.stage1Draft || slot.lesson || null;
      const stage1BaseForPreview =
        (previewLesson && extractPendingDiagramSpecs(previewLesson).length > 0
          ? previewLesson
          : slot.stage1Draft) ||
        previewLesson ||
        null;
      const kind = detectPastedCoursewareInputKind(trimmed, {
        hasStage1Draft: Boolean(
          (slot.stage1Draft && !slot.lesson) ||
            (previewLesson && extractPendingDiagramSpecs(previewLesson).length > 0)
        ),
        hasBaseLesson: Boolean(baseForPatch),
      });
      if (kind === 'stage2' && stage1BaseForPreview) {
        try {
          const merged = mergeStage2DiagramsIntoStage1(
            stage1BaseForPreview,
            trimmed,
            combinedAssets
          );
          return {
            report: safeAuditCoursewareRendering(merged.mergedLesson, combinedAssets, {
              stage: 'complete',
            }),
            parsedLesson: merged.mergedLesson,
          };
        } catch {
          // fallback below
        }
      }
      if (kind === 'patch' && baseForPatch) {
        try {
          const patched = applyCoursewareRepairPatch(baseForPatch, trimmed, slot, combinedAssets);
          const hasAnySvgAfterPatch = (patched.mergedLesson.diagrams || []).some((d) =>
            hasValidDiagramContent(d)
          );
          const stillStage1 =
            !slot.lesson &&
            extractPendingDiagramSpecs(patched.mergedLesson).length > 0 &&
            !hasAnySvgAfterPatch;
          return {
            report: safeAuditCoursewareRendering(patched.mergedLesson, combinedAssets, {
              stage: stillStage1 ? 'stage1' : 'complete',
            }),
            parsedLesson: patched.mergedLesson,
          };
        } catch {
          // fallback below
        }
      }
      return auditRawCoursewareInput(trimmed, slot, combinedAssets, {
        stage: kind === 'stage1' ? 'stage1' : 'complete',
      });
    } catch (err) {
      console.warn('[LessonView] importAuditResult fallback:', err);
      return null;
    }
  }, [rawImportInput, slot, previewLesson, combinedAssets]);

  const displayedImportAudit = importAuditResult || latchedImportAudit;

  const quickRepairAuditResult = useMemo(() => {
    const trimmed = quickRepairInput.trim();
    if (!trimmed) return null;
    try {
      if (activeLesson) {
        try {
          const { mergedLesson, appliedSummary, appliedMode } = applyCoursewareRepairPatch(
            activeLesson,
            trimmed,
            slot,
            combinedAssets
          );
          const report = safeAuditCoursewareRendering(mergedLesson, combinedAssets);
          return {
            report,
            parsedLesson: mergedLesson,
            appliedSummary,
            appliedMode,
          };
        } catch {
          // Fallback to raw input audit so JSON syntax errors are reported clearly
        }
      }
      const rawAudit = auditRawCoursewareInput(trimmed, slot, combinedAssets);
      return rawAudit
        ? {
            ...rawAudit,
            appliedSummary: undefined,
            appliedMode: undefined,
          }
        : null;
    } catch (err) {
      console.warn('[LessonView] quickRepairAuditResult fallback:', err);
      return null;
    }
  }, [quickRepairInput, activeLesson, slot, combinedAssets]);

  const activeLessonAudit = useMemo(() => {
    if (!activeLesson) return null;
    return safeAuditCoursewareRendering(activeLesson, combinedAssets);
  }, [activeLesson, combinedAssets]);

  const existingLessonUnresolvedRefs = useMemo(() => {
    if (!activeLesson?.markdownBody) return [];
    return detectUnresolvedImageRefs(activeLesson.markdownBody, combinedAssets);
  }, [activeLesson?.markdownBody, combinedAssets]);

  const resolvedActiveLesson = useMemo(() => {
    if (!activeLesson) return null;
    return resolveLessonAssetReferences(activeLesson, combinedAssets);
  }, [activeLesson, combinedAssets]);

  const compiledDiagramSvgs = useCompiledLessonDiagrams(resolvedActiveLesson || activeLesson);

  // Unified list of all SVG diagrams + Markdown images in this lesson for cross-referencing & mini-window
  const lessonVisuals = useMemo<VisualAssetRef[]>(() => {
    if (!resolvedActiveLesson) return [];
    const visuals: VisualAssetRef[] = [];
    const diagrams = resolvedActiveLesson.diagrams || [];
    diagrams.forEach((d, idx) => {
      const id = (d.id || `diag-${idx + 1}`).trim();
      const compiledSvg = compiledDiagramSvgs[id] || compiledDiagramSvgs[id.toLowerCase()];
      visuals.push({
        id,
        title: stripAiCitationArtifacts(d.title || `图 ${idx + 1}`),
        stageLabel: d.stageLabel ? stripAiCitationArtifacts(d.stageLabel) : undefined,
        caption: d.caption ? stripAiCitationArtifacts(d.caption) : undefined,
        kind: 'svg',
        svgCode: compiledSvg || enhanceDiagramSvg(d.svgCode || ''),
        index: idx + 1,
      });
    });

    (resolvedActiveLesson.exercises || []).forEach((ex, exIdx) => {
      if (ex.diagramSpec !== undefined || (ex.svgCode && ex.svgCode.includes('<svg'))) {
        const exDiagId = (ex.diagramId || `diag-${ex.id || `ex-${exIdx + 1}`}`).trim();
        if (!visuals.some((v) => v.id.toLowerCase() === exDiagId.toLowerCase())) {
          const compiledSvg =
            compiledDiagramSvgs[exDiagId] || compiledDiagramSvgs[exDiagId.toLowerCase()];
          visuals.push({
            id: exDiagId,
            title: stripAiCitationArtifacts(ex.diagramTitle || `练习题 #${exIdx + 1} 配图`),
            caption: ex.diagramCaption ? stripAiCitationArtifacts(ex.diagramCaption) : undefined,
            kind: 'svg',
            svgCode: compiledSvg || enhanceDiagramSvg(ex.svgCode || ''),
            index: visuals.length + 1,
          });
        }
      }
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
  }, [resolvedActiveLesson, activeLesson?.markdownBody, compiledDiagramSvgs]);

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

  const symbolIndex = useMemo(
    () => buildLessonSymbolIndex(resolvedActiveLesson || activeLesson),
    [resolvedActiveLesson, activeLesson]
  );

  // Close symbol popover when switching lessons or pressing Escape / clicking outside
  useEffect(() => {
    setActiveSymbolPopover(null);
    if (articleRef.current) {
      articleRef.current
        .querySelectorAll('.latex-symbol-active')
        .forEach((el) => el.classList.remove('latex-symbol-active'));
    }
  }, [slot.dayIndex, slot.date, activeLesson?.title]);

  useEffect(() => {
    if (!activeSymbolPopover) return;
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setActiveSymbolPopover(null);
        articleRef.current
          ?.querySelectorAll('.latex-symbol-active')
          .forEach((el) => el.classList.remove('latex-symbol-active'));
      }
    };
    const handleDocClick = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest('[data-testid="latex-symbol-popover"]') ||
        target.closest('[data-latex-symbol]')
      ) {
        return;
      }
      setActiveSymbolPopover(null);
      articleRef.current
        ?.querySelectorAll('.latex-symbol-active')
        .forEach((el) => el.classList.remove('latex-symbol-active'));
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleDocClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleDocClick);
    };
  }, [activeSymbolPopover]);

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
        exerciseDiagramsByExId: {} as Record<string, LessonDiagram>,
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
      const clean = token
        .trim()
        .replace(/^[\[\(（]+|[\]\)）]+$/g, '')
        .replace(/^(?:图示|图)\s*/, '')
        .trim();
      const byExact = diagrams.findIndex(
        (d, idx) => (d.id || `diag-${idx + 1}`).trim().toLowerCase() === clean.toLowerCase()
      );
      if (byExact !== -1) return byExact;

      const cleanKey = normalizeDiagramIdKey(clean).replace(/^diagram/, 'diag');
      const byNorm = diagrams.findIndex(
        (d, idx) =>
          normalizeDiagramIdKey(d.id || `diag-${idx + 1}`).replace(/^diagram/, 'diag') === cleanKey
      );
      if (byNorm !== -1) return byNorm;

      const cleanSuffix = extractDiagramSuffix(clean);
      if (cleanSuffix) {
        const bySuffix = diagrams.findIndex(
          (d, idx) => extractDiagramSuffix(d.id || `diag-${idx + 1}`) === cleanSuffix
        );
        if (bySuffix !== -1) return bySuffix;

        // Sub-panel parent fallback: e.g. `diag-4c` -> parent `diag-4` (one SVG containing (a)(b)(c) sub-panels)
        const subPanelMatch = cleanSuffix.match(/^(\d+)[a-z]$/i);
        if (subPanelMatch) {
          const parentNum = subPanelMatch[1];
          const byParentSuffix = diagrams.findIndex(
            (d, idx) => extractDiagramSuffix(d.id || `diag-${idx + 1}`) === parentNum
          );
          if (byParentSuffix !== -1) return byParentSuffix;
        }
      }

      // Numeric index fallback ONLY for pure numbers or plain `diag-N` (no letter suffix like 4c)
      const numOnlyMatch = clean.toLowerCase().match(/^(?:(?:diagram|diag)[-_\s]*)?(\d+)$/);
      if (numOnlyMatch) {
        const idx = parseInt(numOnlyMatch[1], 10) - 1;
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

    // Step 1: Parse explicit {{heuristic:...}}, {{diagram:...}}, {{diag:...}}, [[diagram:...]], {{exercise:...}} anchors
    const tokenRegex =
      /`?\s*(?:\{\{|\[{2})\s*(heuristic|diagram|diag|exercise)\s*:\s*([^}\]]+?)\s*(?:\}\}|\]{2})\s*`?/gi;
    const initialBlocks: RawBlock[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(rawMd)) !== null) {
      const before = rawMd.slice(lastIdx, match.index).trim();
      if (before) {
        initialBlocks.push({ kind: 'markdown', md: before });
      }
      const rawKind = match[1].toLowerCase();
      const kind = rawKind === 'diag' ? 'diagram' : rawKind;
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

    // Step 1.5: Claim exercise-dedicated diagrams (via ex.diagramId, ex.svgCode, or diag-ex-* in question)
    // so they render directly inside the exercise card rather than getting interleaved into prose sections.
    const exerciseDiagramsByExId: Record<string, LessonDiagram> = {};
    exercises.forEach((ex, exIdx) => {
      const exId = ex.id || `ex-${exIdx + 1}`;
      let matchedDiagIdx = -1;

      if (ex.diagramId) {
        matchedDiagIdx = findDiagramIdx(ex.diagramId);
      }
      if (matchedDiagIdx === -1) {
        // Check if diagrams array has a dedicated diagram like `diag-ex-1` or `diag-${ex.id}`
        matchedDiagIdx = diagrams.findIndex((d, dIdx) => {
          const dId = (d.id || `diag-${dIdx + 1}`).trim().toLowerCase();
          return (
            dId === `diag-${exId.toLowerCase()}` ||
            dId === `diag-ex-${exIdx + 1}` ||
            dId === `diag_ex_${exIdx + 1}`
          );
        });
      }
      if (matchedDiagIdx === -1 && ex.question) {
        // Check if the question explicitly references a dedicated exercise diagram like `diag-ex-1`
        const exDiagRefMatch = ex.question.match(/\b(diag(?:ram)?[-_]?ex[-_]?\w+)\b/i);
        if (exDiagRefMatch) {
          matchedDiagIdx = findDiagramIdx(exDiagRefMatch[1]);
        }
      }

      if (matchedDiagIdx !== -1 && diagrams[matchedDiagIdx]) {
        exerciseDiagramsByExId[exId] = diagrams[matchedDiagIdx];
        usedDiagIndices.add(matchedDiagIdx);
      } else if ((ex.svgCode && ex.svgCode.includes('<svg')) || ex.diagramSpec) {
        exerciseDiagramsByExId[exId] = {
          id: ex.diagramId || `diag-${exId}`,
          title: ex.diagramTitle || `练习题 #${exIdx + 1} 配图`,
          caption: ex.diagramCaption || '',
          ...(ex.diagramSpec ? { diagramSpec: ex.diagramSpec } : {}),
          svgCode: ex.svgCode,
        };
      }
    });

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

    return { blocks, comprehensiveExerciseIndices, exerciseDiagramsByExId };
  }, [activeLesson, combinedAssets, lessonVisuals]);

  // Annotate rendered KaTeX symbols that were explained earlier in the lesson & hydrate async markdown diagrams
  useEffect(() => {
    if (articleRef.current) {
      annotateKatexSymbolsInContainer(articleRef.current, symbolIndex);
      hydrateAsyncMarkdownDiagrams(articleRef.current);
    }
    if (editPreviewRef.current && showEditPreview) {
      hydrateAsyncMarkdownDiagrams(editPreviewRef.current);
    }
  }, [
    symbolIndex,
    interleavedLessonFlow,
    activeLesson,
    isSubmitted,
    revealedHeuristicHints,
    revealedHeuristics,
    revealedExerciseHints,
    revealedSingleExercises,
    revealedReverseChecks,
    hideQualityCheck,
    showEditPreview,
    editMarkdown,
  ]);

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
    setRegenProgress({
      type: 'progress',
      stage: 'connecting',
      step: 1,
      percent: 4,
      message: '正在连接后端并准备本节教材 PDF 上下文...',
    });
    try {
      const data = await generateLessonWithProgressStream(
        course.id,
        slot.dayIndex,
        (ev) => setRegenProgress(ev)
      );
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
      setRegenProgress(null);
    }
  };

  const effectiveAgentInlinePrompt =
    agentInlineStage === 'stage2' && agentStage2Prompt
      ? agentStage2Prompt
      : agentStage1Prompt || agentPromptText;

  const handleCopyAgentPromptInline = async () => {
    if (!effectiveAgentInlinePrompt) return;
    try {
      await copyPromptText(effectiveAgentInlinePrompt);
      setCopiedAgentPrompt(true);
      setManualPromptPreview(null);
      setTimeout(() => setCopiedAgentPrompt(false), 2500);
    } catch {
      setManualPromptPreview({
        title: agentInlineStage === 'stage2' ? 'Agent 阶段二图表指令（请点击一键复制或长按全选）' : 'Agent 本节指令（请点击一键复制或长按全选）',
        text: effectiveAgentInlinePrompt,
      });
    }
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

  const handleCopyChatPrompt = async (
    stageOverride?: 'stage1' | 'stage2',
    feedbackKey?: 'stage1' | 'stage2' | 'quick-stage2'
  ) => {
    const isTargetStage2 =
      stageOverride === 'stage2' || (stageOverride === undefined && isStage2PendingChat);
    const resolvedKey: 'stage1' | 'stage2' | 'quick-stage2' =
      feedbackKey || (isTargetStage2 ? 'stage2' : 'stage1');
    setImportError(null);
    setChatPromptCopyNotice(null);

    let textToCopy =
      stageOverride === 'stage1'
        ? chatStage1Prompt || chatLessonPrompt
        : stageOverride === 'stage2'
        ? chatStage2Prompt
        : effectiveChatStepPrompt;

    if (!textToCopy) {
      try {
        const res = await fetch(`/api/courses/${course.id}/days/${slot.dayIndex}/chat-prompt`);
        if (res.ok) {
          const data = await res.json();
          if (data.lessonPrompt) setChatLessonPrompt(data.lessonPrompt);
          if (data.stage1Prompt) setChatStage1Prompt(data.stage1Prompt);
          if (data.stage2Prompt) setChatStage2Prompt(data.stage2Prompt);
          textToCopy =
            stageOverride === 'stage1'
              ? String(data.stage1Prompt || data.lessonPrompt || '')
              : stageOverride === 'stage2'
              ? String(data.stage2Prompt || '')
              : String(
                  (slot.stage1Draft && !slot.lesson && data.stage2Prompt) ||
                    data.stage1Prompt ||
                    data.lessonPrompt ||
                    ''
                );
        }
      } catch {
        // handled below via !textToCopy
      }
    }

    if (!textToCopy) {
      const missingMsg = isTargetStage2
        ? '当前小节尚未生成阶段二图表规格，请先完成并导入阶段一内容。'
        : '提示词尚未加载完成，请稍后重试。';
      setImportError(missingMsg);
      setChatPromptCopyNotice({ ok: false, message: missingMsg });
      return;
    }

    try {
      await copyPromptText(textToCopy);
      setCopiedChatPromptKey(resolvedKey);
      setManualPromptPreview((prev) => (prev && prev.text === textToCopy ? prev : null));
      const label = isTargetStage2 ? '阶段二图表提示词' : '阶段一提示词';
      const okMsg = `✅ 已复制${label}（${textToCopy.length} 字符），可直接切换到 AI 对话框粘贴。`;
      setChatPromptCopyNotice({ ok: true, message: okMsg });
      if (!isChatWorkbenchOpen) {
        setPdfCopyNotice(okMsg);
      }
      setTimeout(
        () => setCopiedChatPromptKey((prev) => (prev === resolvedKey ? null : prev)),
        2500
      );
    } catch {
      const failTitle = isTargetStage2
        ? '阶段二图表提示词（剪贴板受限，请点击一键复制或长按全选）'
        : '阶段一提示词（剪贴板受限，请点击一键复制或长按全选）';
      setManualPromptPreview({
        title: failTitle,
        text: textToCopy,
      });
      const failMsg = '自动写入剪贴板受限，已展开完整提示词文本框，请点击“一键复制全文”或长按全选复制。';
      setChatPromptCopyNotice({ ok: false, message: failMsg });
      if (isChatWorkbenchOpen) {
        setImportError(failMsg);
      }
    }
  };

  const persistStage1DraftToBackend = async (lessonToSave: DailyLessonContent): Promise<boolean> => {
    try {
      const res = await fetch(`/api/courses/${course.id}/days/${slot.dayIndex}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawContent: JSON.stringify(lessonToSave, null, 2),
          lessonData: lessonToSave,
          uploadedAssets: pendingAssets,
          sourceMode: 'chat',
          importStage: 'stage1',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.stage2Prompt === 'string' && data.stage2Prompt) {
          setChatStage2Prompt(data.stage2Prompt);
        }
        onCourseUpdated(data.course);
        return true;
      }
    } catch {
      // preserve local previewLesson even if background save fails
    }
    return false;
  };

  const latchCurrentImportBaseAndClearInput = async (customHint?: string) => {
    const currentAudit = importAuditResult || latchedImportAudit;
    if (!currentAudit) {
      setRawImportInput('');
      setShowChatManualPaste(true);
      setImportReplaceHint(
        customHint || '已清空粘贴框，请在此直接粘贴 AI 输出的修复补丁或内容。'
      );
      window.setTimeout(() => chatImportBoxRef.current?.focus(), 30);
      return;
    }

    setLatchedImportAudit(currentAudit);
    const baseLesson = currentAudit.parsedLesson;
    if (baseLesson) {
      setPreviewLesson(baseLesson);
      setUnresolvedImages(
        detectUnresolvedImageRefs(baseLesson.markdownBody || '', combinedAssets)
      );
    }
    setRawImportInput('');
    setShowChatManualPaste(true);
    setImportReplaceHint(
      customHint ||
        (baseLesson
          ? '已暂存阶段一底稿并清空粘贴框，请在此直接粘贴 AI 输出的增量修复补丁或阶段二 SVG。'
          : '已保留下方修复诊断并清空粘贴框，请在此直接粘贴 AI 修复后的完整内容。')
    );
    window.setTimeout(() => chatImportBoxRef.current?.focus(), 30);

    if (baseLesson) {
      const hasStage1 = Boolean(slot.stage1Draft && !slot.lesson);
      const trimmed = rawImportInput.trim();
      const kind = trimmed
        ? detectPastedCoursewareInputKind(trimmed, {
            hasStage1Draft: hasStage1,
            hasBaseLesson: Boolean(previewLesson || slot.stage1Draft || slot.lesson),
          })
        : extractPendingDiagramSpecs(baseLesson).length > 0
        ? 'stage1'
        : 'complete';
      if (kind === 'stage1' || (!slot.lesson && extractPendingDiagramSpecs(baseLesson).length > 0)) {
        await persistStage1DraftToBackend(baseLesson);
      }
    }
  };

  const handleProcessChatImportText = async (
    rawTextInput: string,
    autoSaveIfClean = true,
    advanceToNext = false
  ) => {
    const trimmed = rawTextInput.trim();
    if (!trimmed) {
      setImportError('粘贴的 AI 输出内容为空，请先复制 AI 回复。');
      return;
    }
    const wasManualPasteOpen = showChatManualPaste;
    setImportError(null);
    setImportSuccessMsg(null);
    setImportReplaceHint(null);

    try {
      const hasStage1 = Boolean(
        (slot.stage1Draft && !slot.lesson) ||
          (previewLesson && extractPendingDiagramSpecs(previewLesson).length > 0)
      );
      const baseForPatch = previewLesson || slot.stage1Draft || slot.lesson || null;
      const stage1Base =
        (previewLesson && extractPendingDiagramSpecs(previewLesson).length > 0
          ? previewLesson
          : slot.stage1Draft) ||
        previewLesson ||
        null;
      const kind = detectPastedCoursewareInputKind(trimmed, {
        hasStage1Draft: hasStage1,
        hasBaseLesson: Boolean(baseForPatch),
      });

      let targetLesson: DailyLessonContent | null = null;
      let issuesCount = 0;
      let preservedAuditReport: ReturnType<typeof auditCoursewareRendering> | null = null;
      let importStageToSave: 'stage1' | 'stage2_merge' | 'complete' = 'complete';
      let note = '';

      if (kind === 'stage2') {
        if (!stage1Base) {
          setRawImportInput(trimmed);
          setImportError('检测到阶段二 SVG 输出，但本节尚未保存阶段一底稿，请先导入阶段一内容。');
          return;
        }
        const merged = mergeStage2DiagramsIntoStage1(stage1Base, trimmed, combinedAssets);
        const report = auditCoursewareRendering(merged.mergedLesson, combinedAssets, {
          stage: 'complete',
        });
        targetLesson = merged.mergedLesson;
        issuesCount = report.issues.length;
        preservedAuditReport = report;
        importStageToSave = 'stage2_merge';
        note = `自动识别为阶段二 SVG · 组装 ${merged.matchedCount + merged.addedCount} 张图示`;
      } else if (kind === 'patch' && baseForPatch) {
        const patched = applyCoursewareRepairPatch(baseForPatch, trimmed, slot, combinedAssets);
        const hasAnySvgAfterPatch = (patched.mergedLesson.diagrams || []).some((d) =>
          hasValidDiagramContent(d)
        );
        const isStage1Remaining =
          !slot.lesson &&
          extractPendingDiagramSpecs(patched.mergedLesson).length > 0 &&
          !hasAnySvgAfterPatch;
        const report = auditCoursewareRendering(patched.mergedLesson, combinedAssets, {
          stage: isStage1Remaining ? 'stage1' : 'complete',
        });
        targetLesson = patched.mergedLesson;
        issuesCount = report.issues.length;
        preservedAuditReport = report;
        importStageToSave = isStage1Remaining ? 'stage1' : 'complete';
        note = patched.appliedSummary;
      } else {
        const check = auditRawCoursewareInput(trimmed, slot, combinedAssets, {
          stage: kind === 'stage1' ? 'stage1' : 'complete',
        });
        if (check) {
          targetLesson = check.parsedLesson;
          issuesCount = check.report.issues.length;
          preservedAuditReport = check.report;
        } else {
          const parsedFallback = parseImportedLessonContent(trimmed, slot, 'chat', combinedAssets, {
            stageMode: kind === 'stage1' ? 'stage1' : 'auto',
          });
          targetLesson = parsedFallback.lesson;
        }
        if (
          targetLesson &&
          (kind === 'stage1' ||
            (!slot.lesson &&
              extractPendingDiagramSpecs(targetLesson).length > 0 &&
              !(targetLesson.diagrams || []).some((d) => hasValidDiagramContent(d))))
        ) {
          importStageToSave = 'stage1';
          note = '自动识别为阶段一正文与图示规格';
        }
      }

      if (targetLesson) {
        setPreviewLesson(targetLesson);
        setUnresolvedImages(detectUnresolvedImageRefs(targetLesson.markdownBody || '', combinedAssets));
      }

      if (issuesCount > 0 || !targetLesson) {
        const reportForLatch =
          preservedAuditReport ||
          (targetLesson
            ? auditCoursewareRendering(targetLesson, combinedAssets, {
                stage:
                  kind === 'stage1' ||
                  (!slot.lesson && extractPendingDiagramSpecs(targetLesson).length > 0)
                    ? 'stage1'
                    : 'complete',
              })
            : null);
        if (reportForLatch) {
          setLatchedImportAudit({
            report: reportForLatch,
            parsedLesson: targetLesson,
          });
        }
        if (targetLesson) {
          if (
            kind === 'stage1' ||
            (!slot.lesson && extractPendingDiagramSpecs(targetLesson).length > 0)
          ) {
            await persistStage1DraftToBackend(targetLesson);
          }
          setRawImportInput('');
          setShowChatManualPaste(true);
          setImportReplaceHint(
            `已暂存阶段一底稿（检测到 ${issuesCount} 处待修问题），请复制下方修复提示词后，在此直接粘贴 AI 输出的增量修复补丁或阶段二 SVG。`
          );
        } else {
          setRawImportInput(trimmed);
          setShowChatManualPaste(true);
          setImportReplaceHint(
            '检测到 JSON 语法错误，请复制下方修复提示词（或 .md 文件）让 AI 修复后再粘贴。'
          );
        }
        return;
      }

      if (!autoSaveIfClean) {
        setRawImportInput(trimmed);
        return;
      }

      setIsSavingImport(true);
      const res = await fetch(`/api/courses/${course.id}/days/${slot.dayIndex}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawContent: trimmed,
          lessonData: targetLesson,
          uploadedAssets: pendingAssets,
          sourceMode: 'chat',
          importStage: importStageToSave,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '导入保存本节课件失败');
      }
      setRawImportInput('');
      setLatchedImportAudit(null);
      onCourseUpdated(data.course);
      if (importStageToSave === 'stage1') {
        if (typeof data.stage2Prompt === 'string' && data.stage2Prompt) {
          setChatStage2Prompt(data.stage2Prompt);
        }
        setPreviewLesson(null);
        setShowChatManualPaste(
          Boolean(
            wasManualPasteOpen ||
              typeof navigator === 'undefined' ||
              !navigator.clipboard?.readText
          )
        );
        setImportSuccessMsg(
          `已自动识别并保存阶段一成果，请继续复制上方「阶段二图表」提示词或 .md 文件发给 AI（无需重传 PDF）。`
        );
      } else if (advanceToNext && nextSlot && onSelectDayIndex) {
        setPreviewLesson(null);
        setShowChatManualPaste(false);
        onSelectDayIndex(nextSlot.dayIndex);
      } else {
        setPreviewLesson(null);
        setShowChatManualPaste(false);
        setIsChatWorkbenchOpen(false);
        setImportSuccessMsg(
          note ? `已自动识别并保存本节课件（${note}）。` : '本节课件已保存并同步到本地文件夹。'
        );
      }
    } catch (err: any) {
      setRawImportInput(trimmed);
      setImportError(err?.message || '自动识别或导入失败，请检查内容格式');
    } finally {
      setIsSavingImport(false);
    }
  };

  const handleImportFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const fileText = await file.text();
      await handleProcessChatImportText(fileText, true);
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
    const trimmed = rawImportInput.trim();
    if (trimmed) {
      const hasStage1 = Boolean(
        (slot.stage1Draft && !slot.lesson) ||
          (previewLesson && extractPendingDiagramSpecs(previewLesson).length > 0)
      );
      const baseForPatch = previewLesson || slot.stage1Draft || slot.lesson || null;
      const kind = detectPastedCoursewareInputKind(trimmed, {
        hasStage1Draft: hasStage1,
        hasBaseLesson: Boolean(baseForPatch),
      });
      if (kind === 'stage1' || kind === 'stage2' || kind === 'patch') {
        await handleProcessChatImportText(trimmed, true, advanceToNext);
        return;
      }
    }

    const wasManualPasteOpen = showChatManualPaste;
    setIsSavingImport(true);
    setImportError(null);
    setImportSuccessMsg(null);
    try {
      const parsed =
        previewLesson ||
        parseImportedLessonContent(rawImportInput, slot, 'chat', combinedAssets).lesson;
      const pendingSpecs = extractPendingDiagramSpecs(parsed);
      const hasAnyDrawnSvg = (parsed.diagrams || []).some((d) =>
        hasValidDiagramContent(d)
      );
      const isStage1Only =
        pendingSpecs.length > 0 &&
        (!hasAnyDrawnSvg || parsed.generationStage === 'stage1_content');

      const res = await fetch(`/api/courses/${course.id}/days/${slot.dayIndex}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawContent: trimmed || JSON.stringify(parsed, null, 2),
          lessonData: parsed,
          uploadedAssets: pendingAssets,
          sourceMode: 'chat',
          importStage: isStage1Only ? 'stage1' : 'complete',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '保存导入课件失败');
      }
      setPreviewLesson(null);
      setLatchedImportAudit(null);
      setRawImportInput('');
      onCourseUpdated(data.course);
      if (isStage1Only) {
        setShowChatManualPaste(
          Boolean(
            wasManualPasteOpen ||
              typeof navigator === 'undefined' ||
              !navigator.clipboard?.readText
          )
        );
        setImportSuccessMsg(
          '已自动识别并保存阶段一成果，请继续复制上方「阶段二 SVG」提示词或 .md 文件发给 AI（无需重传 PDF）。'
        );
      } else if (advanceToNext && nextSlot && onSelectDayIndex) {
        setShowChatManualPaste(false);
        onSelectDayIndex(nextSlot.dayIndex);
      } else {
        setShowChatManualPaste(false);
        setIsChatWorkbenchOpen(false);
        setImportSuccessMsg('本节课件已保存并同步到本地文件夹。');
      }
    } catch (err: any) {
      setImportError(err?.message || '保存导入课件失败');
    } finally {
      setIsSavingImport(false);
    }
  };

  const handleApplyQuickRepair = async (overrideText?: string) => {
    const sourceText = (overrideText ?? quickRepairInput).trim();
    if (!sourceText) {
      setQuickRepairNotice({
        ok: false,
        message: '请先粘贴 AI 输出的增量修复补丁 JSON、单独 SVG 代码块或修复后内容。',
      });
      return;
    }
    setIsApplyingQuickRepair(true);
    setQuickRepairNotice(null);
    try {
      let targetLesson: DailyLessonContent;
      if (activeLesson) {
        const patched = applyCoursewareRepairPatch(
          activeLesson,
          sourceText,
          slot,
          combinedAssets
        );
        targetLesson = patched.mergedLesson;
      } else {
        const check = auditRawCoursewareInput(sourceText, slot, combinedAssets);
        if (
          check &&
          !check.parsedLesson &&
          check.report.issues[0]?.category === 'json_syntax_error'
        ) {
          throw new Error(check.report.issues[0].detail);
        }
        targetLesson =
          check?.parsedLesson ||
          parseImportedLessonContent(sourceText, slot, 'chat', combinedAssets).lesson;
      }

      const res = await fetch(`/api/courses/${course.id}/days/${slot.dayIndex}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawContent: JSON.stringify(targetLesson, null, 2),
          lessonData: targetLesson,
          uploadedAssets: pendingAssets,
          sourceMode: activeLesson?.sourceMode || 'chat',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '保存修复后课件失败');
      }
      setPreviewLesson(null);
      setQuickRepairInput('');
      setShowQuickRepairBox(false);
      setShowActiveAuditDetails(false);
      setDismissedActiveAuditKey(null);
      onCourseUpdated(data.course);
    } catch (err: any) {
      setQuickRepairNotice({
        ok: false,
        message:
          err?.message ||
          '解析或应用修复补丁失败，请检查粘贴内容是否为增量补丁 JSON、SVG 代码块或合法课件格式。',
      });
    } finally {
      setIsApplyingQuickRepair(false);
    }
  };

  const handlePasteClipboardToQuickRepair = async () => {
    setQuickRepairNotice(null);
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error('no-clipboard-read');
      }
      const clipText = (await navigator.clipboard.readText()).trim();
      if (!clipText) {
        setShowQuickRepairBox(true);
        setQuickRepairNotice({
          ok: false,
          message: '剪贴板当前为空，请先复制 AI 返回的增量补丁或修复内容后再试。',
        });
        window.setTimeout(() => quickRepairBoxRef.current?.focus(), 40);
        return;
      }
      setQuickRepairInput(clipText);
      if (activeLesson) {
        try {
          const patched = applyCoursewareRepairPatch(activeLesson, clipText, slot, combinedAssets);
          const postAudit = auditCoursewareRendering(patched.mergedLesson, combinedAssets);
          if (postAudit.errorCount === 0) {
            await handleApplyQuickRepair(clipText);
            return;
          }
          setShowQuickRepairBox(true);
          setQuickRepairNotice({
            ok: false,
            message: `${patched.appliedSummary}，但仍余 ${postAudit.errorCount} 处问题，请核对下方提示或再次粘贴修复。`,
          });
          return;
        } catch {
          // Fall through to raw check
        }
      }
      const check = auditRawCoursewareInput(clipText, slot, combinedAssets);
      if (check && check.parsedLesson && check.report.errorCount === 0) {
        await handleApplyQuickRepair(clipText);
      } else {
        setShowQuickRepairBox(true);
        if (check && check.report.issues.length > 0) {
          setQuickRepairNotice({
            ok: false,
            message: `已读取剪贴板内容，但仍检测到 ${check.report.errorCount} 处问题，请核对下方提示后重新修复。`,
          });
        }
      }
    } catch {
      setShowQuickRepairBox(true);
      setQuickRepairNotice({
        ok: false,
        message: '浏览器未授予自动读取剪贴板权限，请在下方临时粘贴框按 Ctrl+V / Cmd+V 粘贴后点击应用。',
      });
      window.setTimeout(() => quickRepairBoxRef.current?.focus(), 40);
    }
  };

  const handlePasteClipboardToImportBox = async () => {
    setImportReplaceHint(null);
    setImportError(null);
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error('no-clipboard-read');
      }
      const clipText = (await navigator.clipboard.readText()).trim();
      if (!clipText) {
        setImportError('剪贴板当前为空，请先复制外部 AI 生成或修复的内容后再点击。');
        return;
      }
      await handleProcessChatImportText(clipText, true);
    } catch {
      setShowChatManualPaste(true);
      setImportReplaceHint('浏览器未开放自动读取剪贴板权限，请在下方临时粘贴框按 Ctrl+V 后点击“识别并导入”。');
      window.setTimeout(() => chatImportBoxRef.current?.focus(), 30);
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
          sectionId: slot.id,
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
          sectionId: slot.id,
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

  const renderDiagramTopologySpec = (topologySpec?: string) => {
    const cleanSpec = (topologySpec || '').trim();
    if (!cleanSpec) return null;
    return (
      <details className="mt-2 border border-neutral-800/80 rounded bg-neutral-950/70 px-3 py-2 text-[11px] text-neutral-300">
        <summary className="cursor-pointer select-none font-mono text-neutral-400 hover:text-neutral-200 transition-colors">
          查看前置结构规格（节点 / 连接 / 参考方向 / 关键参数）
        </summary>
        <div
          className="mt-2 pt-2 border-t border-neutral-800/70 text-neutral-300 leading-relaxed whitespace-pre-wrap [&>p]:m-0"
          dangerouslySetInnerHTML={{
            __html: renderMarkdownWithLatex(cleanSpec, lessonVisuals),
          }}
        />
      </details>
    );
  };

  const renderExerciseRemediationAndVariant = (q: ExerciseQuestion) => {
    const hasRemediation = Boolean(q.remediation?.trim());
    const rawVariant = q.variantCheck;
    const variantObj: ExerciseVariantCheck | null =
      rawVariant && typeof rawVariant === 'object'
        ? rawVariant
        : typeof rawVariant === 'string' && rawVariant.trim()
        ? { question: rawVariant.trim(), answer: '', explanation: '' }
        : null;
    const hasVariant = Boolean(variantObj?.question?.trim());
    if (!hasRemediation && !hasVariant) return null;

    const variantQuestion: ExerciseQuestion | null =
      variantObj && variantObj.answer?.trim()
        ? {
            id: `${q.id}-variant`,
            type:
              Array.isArray(variantObj.options) && variantObj.options.length > 0
                ? 'choice'
                : 'fill',
            question: variantObj.question,
            options: variantObj.options,
            answer: variantObj.answer,
            explanation: variantObj.explanation || '',
          }
        : null;
    const currentVariantVal = variantAnswers[q.id] || '';
    const isVariantChecked = Boolean(variantSubmitted[q.id]);
    const variantReport =
      variantQuestion && isVariantChecked
        ? gradeSingleExercise(variantQuestion, currentVariantVal)
        : null;

    return (
      <div className="space-y-3 pt-1">
        {hasRemediation && (
          <div
            data-testid={`exercise-remediation-${q.id}`}
            className="p-3 rounded border border-amber-900/50 bg-amber-950/20 text-xs text-amber-100/90 leading-relaxed [&>p]:m-0"
            dangerouslySetInnerHTML={{
              __html: renderMarkdownWithLatex(
                `**针对性补救讲解：** ${q.remediation}`,
                lessonVisuals
              ),
            }}
          />
        )}

        {variantObj && hasVariant && (
          <div
            data-testid={`exercise-variant-${q.id}`}
            className="p-3 rounded border border-sky-900/50 bg-sky-950/15 space-y-2.5 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-sky-800/80 bg-sky-950/50 text-sky-200">
                变式再检验 · 同原理迁移核对
              </span>
              {variantReport && (
                <span
                  className={`font-mono text-[11px] ${
                    variantReport.isCorrect ? 'text-emerald-400' : 'text-amber-300'
                  }`}
                >
                  {variantReport.isCorrect ? '✓ 变式通过' : '↻ 需再核对'}
                </span>
              )}
            </div>

            <div
              className="text-neutral-200 leading-relaxed [&>p]:m-0"
              dangerouslySetInnerHTML={{
                __html: renderMarkdownWithLatex(variantObj.question, lessonVisuals),
              }}
            />

            {variantQuestion && (
              <>
                {Array.isArray(variantObj.options) && variantObj.options.length > 0 ? (
                  <div className="grid grid-cols-1 gap-1.5">
                    {variantObj.options.map((opt: string) => {
                      const letterMatch = opt.match(/^([A-Da-d])(?:\b|[.、:：\s])/);
                      const optKey = letterMatch ? letterMatch[1].toUpperCase() : opt;
                      const selected =
                        currentVariantVal.toUpperCase() === optKey.toUpperCase() ||
                        currentVariantVal === opt;
                      return (
                        <label
                          key={opt}
                          className={`flex items-center gap-2.5 p-2 rounded border text-xs cursor-pointer transition-colors ${
                            selected
                              ? 'border-sky-500/70 bg-sky-950/40 text-white'
                              : 'border-neutral-800 bg-black/60 text-neutral-300 hover:border-neutral-700'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`variant-${q.id}`}
                            value={optKey}
                            checked={selected}
                            onChange={() =>
                              setVariantAnswers((prev) => ({ ...prev, [q.id]: optKey }))
                            }
                            className="accent-sky-400"
                          />
                          <span
                            className="flex-1 [&>p]:m-0"
                            dangerouslySetInnerHTML={{
                              __html: renderInlineMathWithLatex(opt, lessonVisuals),
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={currentVariantVal}
                      onChange={(e) =>
                        setVariantAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                      }
                      placeholder="输入变式题答案或核心表达式..."
                      className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-sky-600"
                    />
                    {renderInputMathPreviewBox(
                      currentVariantVal,
                      lessonVisuals,
                      `variant-input-latex-preview-${q.id}`,
                      'bg-black/70'
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setVariantSubmitted((prev) => ({ ...prev, [q.id]: true }))
                    }
                    className="px-2.5 py-1 rounded border border-sky-700/80 bg-sky-950/40 hover:bg-sky-900/50 text-sky-200 font-medium transition-colors"
                  >
                    {isVariantChecked ? '重新核对变式答案' : '检验变式答案'}
                  </button>
                </div>

                {isVariantChecked && (
                  <div className="p-2.5 rounded border border-neutral-800 bg-black/80 space-y-1.5 text-xs">
                    <div
                      className={
                        variantReport?.isCorrect ? 'text-emerald-300' : 'text-amber-300'
                      }
                    >
                      参考答案：
                      <span
                        className="font-mono font-medium ml-1"
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(variantObj.answer, lessonVisuals),
                        }}
                      />
                    </div>
                    {variantObj.explanation && (
                      <div
                        className="text-neutral-300 leading-relaxed [&>p]:m-0"
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdownWithLatex(
                            `**变式解析：** ${variantObj.explanation}`,
                            lessonVisuals
                          ),
                        }}
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
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

  const renderManualPromptPreviewBox = () => {
    if (!manualPromptPreview) return null;
    const isCopied = copiedChatPromptKey === 'manual';
    return (
      <div
        data-testid="manual-prompt-preview-box"
        className="border border-sky-800/70 bg-black rounded p-3 space-y-2 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-sky-200">{manualPromptPreview.title}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await copyPromptText(manualPromptPreview.text);
                  setCopiedChatPromptKey('manual');
                  setChatPromptCopyNotice({
                    ok: true,
                    message: `✅ 已复制完整提示词（${manualPromptPreview.text.length} 字符），可直接粘贴到 AI 对话框。`,
                  });
                  if (!isChatWorkbenchOpen) {
                    setPdfCopyNotice(
                      `✅ 已复制完整提示词（${manualPromptPreview.text.length} 字符），可直接粘贴到 AI 对话框。`
                    );
                  }
                  setTimeout(
                    () => setCopiedChatPromptKey((prev) => (prev === 'manual' ? null : prev)),
                    2500
                  );
                } catch {
                  setImportError('仍无法调用系统剪贴板，请直接长按下方文本框内容全选复制。');
                }
              }}
              className="px-2.5 py-1 rounded bg-white text-black hover:bg-neutral-200 font-medium inline-flex items-center gap-1"
            >
              {isCopied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" />
                  <span>已复制全文</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>一键复制全文</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setManualPromptPreview(null)}
              className="text-neutral-400 hover:text-white px-2 py-0.5 border border-neutral-800 rounded"
            >
              收起
            </button>
          </div>
        </div>
        <textarea
          readOnly
          rows={5}
          value={manualPromptPreview.text}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 font-mono text-[11px] text-neutral-200 focus:outline-none focus:border-sky-500"
        />
      </div>
    );
  };

  return (
    <div
      className={`min-h-screen bg-black text-neutral-100 pb-24 ${
        showContentCategoryBadges ? 'lesson-show-category-badges' : 'lesson-hide-category-badges'
      }`}
    >
      <header className="sticky top-0 z-30 bg-black/95 border-b border-neutral-900 px-6 py-4">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={(e) => onBack(e)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-400 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{backLabel}</span>
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
                  title={
                    prevSlot
                      ? `上一讲：${normalizeSvgLatexCommands(stripAiCitationArtifacts(prevSlot.title).replace(/\$/g, ''))}`
                      : '已是第 1 讲'
                  }
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
                  {sortedSlots.map((s) => {
                    const mins = getEvaluatedSectionMinutes(s);
                    return (
                      <option key={s.dayIndex} value={s.dayIndex}>
                        第 {s.dayIndex} 讲 (第 {s.scheduledDay || s.dayIndex}/{course.durationDays} 天 · {mins !== undefined ? `${mins}m` : '待评估'}) {s.lesson ? '✓' : '·'}{' '}
                        {normalizeSvgLatexCommands(stripAiCitationArtifacts(s.title))}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  onClick={() => nextSlot && onSelectDayIndex(nextSlot.dayIndex)}
                  disabled={!nextSlot}
                  title={
                    nextSlot
                      ? `下一讲：${normalizeSvgLatexCommands(stripAiCitationArtifacts(nextSlot.title).replace(/\$/g, ''))}`
                      : '已是最后一讲'
                  }
                  aria-label="下一讲"
                  className="p-1 border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 hover:text-white disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <span className="text-xs font-mono text-neutral-400">
                {slot.date} · {slot.id} (排程第 {slot.scheduledDay || slot.dayIndex}/{course.durationDays} 天 ·{' '}
                {(() => {
                  const mins = getEvaluatedSectionMinutes(slot);
                  return mins !== undefined ? `预计 ${mins} 分钟` : '待生成后评估学时';
                })()})
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

            {/* 统一的 Chat / Agent / 直接编辑同级工作台入口 */}
            {(currentMode !== 'api' || slot.lesson) && (
<button
              type="button"
              onClick={() => {
                if (currentMode === 'api') setWorkbenchTab('edit');
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
                    : currentMode === 'api' ? '编辑课件' : '更新 / 编辑课件 (Chat · Agent · 编辑)'
                  : isChatWorkbenchOpen
                    ? '收起 Chat / Agent 工作台'
                    : 'Chat / Agent 生成工作台'}
              </span>
            </button>
)}

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
        <AnimatePresence mode="wait">
          <motion.div
            key={`${course.id}-${slot.dayIndex}`}
            initial={{ opacity: 0, scale: 0.975, filter: 'blur(5px)' }}
            animate={{
              opacity: 1,
              scale: 1,
              filter: 'blur(0px)',
              transitionEnd: { filter: 'none', transform: 'none' },
            }}
            exit={{ opacity: 0, scale: 1.02, filter: 'blur(5px)' }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: '50% 25%' }}
          >
        {regenError && (
          <div className="mb-6 text-xs text-red-400 border border-red-900/60 bg-red-950/30 rounded px-4 py-3">
            {regenError}
          </div>
        )}

        {/* 真实服务端驱动的流式多阶段进度反馈与字段追踪 */}
        {isRegenerating && (
          <section
            aria-label="API 课件生成实时进度"
            className="mb-6 border border-sky-800/70 bg-sky-950/20 rounded p-5 space-y-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <RefreshCw className="w-4 h-4 text-sky-400 animate-spin shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">
                    正在通过 API 真实流式生成第 {slot.dayIndex} 讲课件（{slot.id} · 排程第 {slot.scheduledDay || slot.dayIndex}/{course.durationDays} 天）
                  </div>
                  <div
                    data-testid="regen-progress-message"
                    className="text-xs text-sky-200/90 mt-0.5 break-words"
                  >
                    {regenProgress?.message || '正在向后端发起流式生成请求...'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  data-testid="regen-progress-percent"
                  className="px-2.5 py-1 rounded bg-sky-950/90 border border-sky-600/70 text-xs font-mono font-semibold text-sky-100"
                >
                  {regenProgress?.percent ?? 0}%
                </span>
                <span className="px-2.5 py-1 rounded bg-neutral-950 border border-neutral-800 text-xs font-mono text-neutral-300">
                  已耗时 {regenElapsedSec.toFixed(1)}s
                </span>
              </div>
            </div>

            <div className="w-full h-2 bg-neutral-900 rounded-full overflow-hidden border border-neutral-800">
              <div
                data-testid="regen-progress-bar"
                className="h-full bg-sky-400 transition-all duration-200"
                style={{
                  width: `${Math.max(2, Math.min(100, regenProgress?.percent ?? 0))}%`,
                }}
              />
            </div>

            {(regenProgress?.model ||
              regenProgress?.pdfSummary ||
              typeof regenProgress?.charsReceived === 'number' ||
              typeof regenProgress?.thinkingChars === 'number') && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-neutral-300">
                {regenProgress?.model && (
                  <span className="px-2 py-0.5 rounded bg-black/70 border border-neutral-800">
                    模型：{regenProgress.model}
                  </span>
                )}
                {regenProgress?.pdfSummary && (
                  <span className="px-2 py-0.5 rounded bg-black/70 border border-neutral-800">
                    上下文：{regenProgress.pdfSummary}
                  </span>
                )}
                {typeof regenProgress?.charsReceived === 'number' && (
                  <span
                    data-testid="regen-stream-bytes"
                    className="px-2 py-0.5 rounded bg-black/70 border border-neutral-800 text-sky-200"
                  >
                    已接收 {regenProgress.charsReceived.toLocaleString()} 字符 ·{' '}
                    {regenProgress.chunksReceived ?? 0} chunks
                  </span>
                )}
                {typeof regenProgress?.thinkingChars === 'number' &&
                  regenProgress.thinkingChars > 0 && (
                    <span className="px-2 py-0.5 rounded bg-black/70 border border-neutral-800 text-amber-300">
                      思考输出 {regenProgress.thinkingChars.toLocaleString()} 字符
                    </span>
                  )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {[
                {
                  step: 1,
                  label: '1. 准备本节大纲与教材 PDF 物理页上下文',
                },
                {
                  step: 2,
                  label: '2. 模型推理与流式输出核心公式、正文讲义 (markdownBody)',
                },
                {
                  step: 3,
                  label: '3. 流式生成图文同步 SVG、启发式思考题与分层练习 (diagrams / exercises)',
                },
                {
                  step: 4,
                  label: `4. 复述检验、量纲自检并写入 lessons/${slot.id}.json`,
                },
              ].map((st) => {
                const currentStep = regenProgress?.step ?? 1;
                const isDone =
                  regenProgress?.stage === 'done' || currentStep > st.step;
                const isActive =
                  regenProgress?.stage !== 'done' && currentStep === st.step;
                return (
                  <div
                    key={st.step}
                    data-stage-step={st.step}
                    data-stage-state={isDone ? 'done' : isActive ? 'active' : 'pending'}
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

            {regenProgress?.detectedFields && regenProgress.detectedFields.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                <span className="text-neutral-400 mr-1">已检测输出字段：</span>
                {(course.category === 'english'
                  ? [
                      'title',
                      'summary',
                      'englishPayload',
                      'markdownBody',
                      'diagrams',
                      'heuristicQuestions',
                      'exercises',
                      'reverseChecks',
                      'qualityCheck',
                    ]
                  : [
                      'title',
                      'summary',
                      'markdownBody',
                      'diagrams',
                      'heuristicQuestions',
                      'exercises',
                      'reverseChecks',
                      'qualityCheck',
                    ]
                ).map((field) => {
                  const seen = regenProgress.detectedFields?.includes(field);
                  return (
                    <span
                      key={field}
                      className={`px-2 py-0.5 rounded border ${
                        seen
                          ? 'border-emerald-800/80 bg-emerald-950/40 text-emerald-300'
                          : 'border-neutral-900 bg-black/40 text-neutral-600'
                      }`}
                    >
                      {seen ? `✓ ${field}` : field}
                    </span>
                  );
                })}
              </div>
            )}

            {regenProgress?.liveSnippet && (
              <div
                data-testid="regen-live-snippet"
                className="text-[11px] font-mono text-neutral-300 bg-black/80 border border-neutral-800 rounded px-3 py-2 truncate"
              >
                流式实时内容：{regenProgress.liveSnippet}
              </div>
            )}
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

        {(showLessonTools || Boolean(activeLessonAudit?.issues.length)) && (
        <section
          aria-label="本节输入材料与提示词快速获取"
          className="mb-6 border border-neutral-900 rounded p-4 bg-neutral-950/50 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-neutral-400">
              <span className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-200">
                小节 ID：{slot.id}
              </span>
              <span>
                第 {slot.dayIndex} 讲 · 排程第 {slot.scheduledDay || slot.dayIndex}/{course.durationDays} 天（{slot.date} ·{' '}
                {(() => {
                  const mins = getEvaluatedSectionMinutes(slot);
                  return mins !== undefined ? `预计 ${mins} 分钟` : '待生成后评估学时';
                })()}）
              </span>
              {boundSegments.length > 0 ? (
                <span className="text-neutral-200">
                  · 小节 PDF：
                  {boundSegments
                    .map(
                      (seg) =>
                        `${seg.segmentFileName || `${seg.sectionId}.pdf`}（物理页第 ${seg.physicalStartPage}–${seg.physicalEndPage} 页${
                          seg.printedStartPage != null && seg.printedEndPage != null
                            ? `，印刷页 ${seg.printedStartPage}–${seg.printedEndPage}`
                            : ''
                        }）`
                    )
                    .join(' + ')}
                </span>
              ) : hasPdfSource ? (
                <span className="text-neutral-500">· PDF 待切割或可立即按本节切割</span>
              ) : null}
              {course.category === 'english' && slot.assignedWords && (
                <span className="text-neutral-300">
                  · 本节目标词汇：{slot.assignedWords.length} 词
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {slicedBoundSegments.length === 0 && hasPdfSource && (
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

              {currentMode !== 'api' && !isChatWorkbenchOpen && (
                <>
                  <button
                    type="button"
                    onClick={handleQuickCopySectionPrompt}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap"
                  >
                    {copiedQuickPrompt ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>已复制本节提示词</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>
                          {isStage2PendingChat ? '复制阶段二图表提示词' : '复制本节生成提示词'}
                        </span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyMdPromptFile(
                        'quick-prompt-md',
                        `${slot.id}-${isStage2PendingChat ? 'stage2' : 'stage1'}-prompt.md`,
                        effectiveChatStepPrompt
                      )
                    }
                    disabled={!effectiveChatStepPrompt}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap disabled:opacity-45"
                    title="将提示词保存为 .md 文件并复制到系统剪贴板"
                  >
                    {copiedMdKey === 'quick-prompt-md' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>已复制 .md</span>
                      </>
                    ) : (
                      <>
                        <FileText className="w-3.5 h-3.5" />
                        <span>复制提示词 .md</span>
                      </>
                    )}
                  </button>
                  {!isStage2PendingChat && Boolean(chatStage2Prompt) && (
                    <>
                      <button
                        type="button"
                        data-testid="quick-copy-stage2-prompt-btn"
                        onClick={() => handleCopyChatPrompt('stage2', 'quick-stage2')}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border rounded transition-colors whitespace-nowrap ${
                          copiedChatPromptKey === 'quick-stage2'
                            ? 'border-emerald-600 bg-emerald-950/50 text-emerald-200'
                            : 'border-sky-800/80 hover:border-sky-500 text-sky-200 hover:text-white'
                        }`}
                      >
                        {copiedChatPromptKey === 'quick-stage2' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>已复制阶段二提示词</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>复制阶段二图表提示词</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyMdPromptFile(
                            'quick-stage2-md',
                            `${slot.id}-stage2-prompt.md`,
                            chatStage2Prompt
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>{copiedMdKey === 'quick-stage2-md' ? '已复制阶段二 .md' : '复制阶段二 .md'}</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    data-testid="quick-open-manual-paste-btn"
                    onClick={() => {
                      setWorkbenchTab('chat');
                      setIsChatWorkbenchOpen(true);
                      setShowChatManualPaste(true);
                      window.setTimeout(() => chatImportBoxRef.current?.focus(), 60);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-sky-700/80 hover:border-sky-400 bg-sky-950/40 text-sky-200 hover:text-white rounded transition-colors whitespace-nowrap"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>粘贴 AI 输出 / 补丁</span>
                  </button>

                  {slicedBoundSegments.length > 0 ? (
                    slicedBoundSegments.map((seg) => {
                      const segId = seg.sectionId || slot.id;
                      const fileName = seg.segmentFileName || `${segId}.pdf`;
                      const copyKey = `quick-seg-${segId}`;
                      const isMulti = slicedBoundSegments.length > 1;
                      return (
                        <React.Fragment key={segId}>
                          {currentMode === 'chat' && (
<button
                            type="button"
                            onClick={() => handleCopyPdfFileToClipboard(seg, copyKey)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap"
                            title={`将 ${fileName} 复制到系统剪贴板（等效在资源管理器按 Ctrl+C），可直接 Ctrl+V 粘贴`}
                          >
                            {copiedQuickPdfKey === copyKey ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>已复制 {isMulti ? fileName : '本节 PDF'}</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>{isMulti ? `复制 ${fileName}` : '复制小节 PDF'}</span>
                              </>
                            )}
                          </button>
)}
                          <a
                            href={`/api/courses/${course.id}/segments/${segId}/pdf?download=1`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors whitespace-nowrap"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>下载/打开 ({fileName})</span>
                          </a>
                        </React.Fragment>
                      );
                    })
                  ) : firstPdfMaterial ? (
                    <>
                      {currentMode === 'chat' && (
<button
                        type="button"
                        onClick={() => handleCopyPdfFileToClipboard(undefined, 'quick-src')}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap"
                        title="将原教材 PDF 文件直接复制到系统剪贴板，等效资源管理器 Ctrl+C"
                      >
                        {copiedQuickPdfKey === 'quick-src' ? (
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
)}
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

          {!isChatWorkbenchOpen && importError && (
            <div className="text-xs text-red-400 border border-red-900/60 bg-red-950/25 rounded px-3 py-2">
              {importError}
            </div>
          )}

          {!isChatWorkbenchOpen && renderManualPromptPreviewBox()}

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
        )}

        {/* 统一同级工作台：Chat 模式提示词粘贴导入 · Agent 本地工作区同步 · 直接编辑正文与配图 */}
        {isChatWorkbenchOpen && (currentMode !== 'api' || slot.lesson) && (
          <section
            aria-label="本节课件生成、导入更新与直接编辑工作台"
            className="lesson-workbench-enter glow-border mb-8 border border-neutral-800 rounded p-5 bg-neutral-950/60 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-900 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  {slot.lesson ? '更新 / 编辑本节课件' : 'Chat / Agent 课件生成工作台'} — 第{' '}
                  {slot.dayIndex} 讲（{slot.id} · 排程第 {slot.scheduledDay || slot.dayIndex}/{course.durationDays} 天）：
                  <span
                    dangerouslySetInnerHTML={{
                      __html: renderInlineMathWithLatex(slot.title),
                    }}
                  />
                </h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {(currentMode === 'api' || workbenchTab === 'edit') && slot.lesson
                    ? '直接调整当前课件的标题、导读摘要、正文 Markdown / LaTeX 或补充上传本地插图'
                    : workbenchTab === 'agent'
                      ? `复制 Agent 提示词交给本地 AI Agent 将课件写入 lessons/${slot.id}.json，完成后点击下方“扫描并同步本地课程文件夹”即可生效`
                      : `1. 复制提示词并附上本节 PDF 发送给外部多模态 AI ➔ 2. 粘贴返回结果 ➔ 3. ${nextSlot ? '保存并直接进入下一讲' : '确认保存本节课件'}`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex flex-wrap rounded border border-neutral-800 bg-black p-0.5 text-xs">
                  {currentMode !== 'api' && (<>
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
</>)}
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

            {onSelectDayIndex && sortedSlots.length > 1 && (
              <div
                data-testid="lesson-workbench-section-tabs"
                className="flex flex-wrap items-center gap-1.5 pb-2 border-b border-neutral-900/80"
              >
                <span className="text-[11px] font-mono text-neutral-500 mr-1">切换小节：</span>
                {sortedSlots.map((s) => {
                  const sId = s.id || `sec-${String(s.dayIndex).padStart(2, '0')}`;
                  const isSelected = s.dayIndex === slot.dayIndex;
                  return (
                    <button
                      key={sId}
                      type="button"
                      data-testid={`lesson-workbench-tab-${s.dayIndex}`}
                      onClick={() => onSelectDayIndex(s.dayIndex)}
                      className={`px-2 py-1 rounded font-mono text-[11px] border transition-colors inline-flex items-center gap-1 ${
                        isSelected
                          ? 'bg-white text-black border-white font-semibold'
                          : s.lesson
                          ? 'bg-emerald-950/30 text-emerald-300 border-emerald-800/60 hover:border-emerald-500'
                          : s.stage1Draft
                          ? 'bg-sky-950/30 text-sky-300 border-sky-800/60 hover:border-sky-500'
                          : 'bg-black text-neutral-300 border-neutral-800 hover:border-neutral-600'
                      }`}
                      title={s.title}
                    >
                      <span>{sId}</span>
                      <span>{s.lesson ? '✓' : s.stage1Draft ? '①' : '·'}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {renderManualPromptPreviewBox()}

            {slot.lesson && (currentMode === 'api' || workbenchTab === 'edit') ? (
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
                    {hasMathPreviewSignal(editTitle) && (
                      <div
                        className="mt-1 px-2.5 py-1 rounded border border-neutral-800 bg-neutral-950/70 text-[11px] text-neutral-200 [&>p]:m-0 overflow-x-auto"
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(editTitle, lessonVisuals),
                        }}
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">本节导读摘要</label>
                    <input
                      type="text"
                      value={editSummary}
                      onChange={(e) => setEditSummary(e.target.value)}
                      className="w-full bg-black border border-neutral-800 rounded px-3 py-1.5 text-xs text-white"
                    />
                    {hasMathPreviewSignal(editSummary) && (
                      <div
                        className="mt-1 px-2.5 py-1 rounded border border-neutral-800 bg-neutral-950/70 text-[11px] text-neutral-300 [&>p]:m-0 overflow-x-auto"
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(editSummary, lessonVisuals),
                        }}
                      />
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs text-neutral-400">
                      课件正文（支持 Markdown、LaTeX 公式 $...$ / $$...$$ 与图片引用 ![说明](文件名.png)）
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowEditPreview((prev) => !prev)}
                      className="text-[11px] font-mono px-2 py-0.5 rounded border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white transition-colors"
                    >
                      {showEditPreview ? '隐藏实时公式预览' : '预览 LaTeX 与排版效果'}
                    </button>
                  </div>
                  <textarea
                    rows={10}
                    value={editMarkdown}
                    onChange={(e) => setEditMarkdown(e.target.value)}
                    className="w-full bg-black border border-neutral-800 rounded p-3 text-xs font-mono text-neutral-200 leading-relaxed"
                  />
                  {showEditPreview && (
                    <div
                      ref={editPreviewRef}
                      data-testid="edit-markdown-latex-preview"
                      className="mt-2 p-3 rounded border border-neutral-800 bg-neutral-950/80 lesson-prose text-xs max-h-72 overflow-y-auto"
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdownWithLatex(editMarkdown, lessonVisuals),
                      }}
                    />
                  )}
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
                  {boundSegments.length > 0 && (
                    <div className="md:col-span-2">
                      <span className="text-neutral-500">本节教材 PDF 切片：</span>
                      <span className="text-neutral-200">
                        {boundSegments
                          .map((seg) => {
                            const ws =
                              agentWorkspaceDir ||
                              course.courseDirPath ||
                              `courses/${course.folderName || course.id}`;
                            const rel =
                              seg.segmentRelPath ||
                              `segments/${seg.segmentFileName || `${seg.sectionId}.pdf`}`;
                            const fullRel =
                              rel.startsWith('courses/') || rel.startsWith(ws)
                                ? rel
                                : `${ws}/${rel}`;
                            return `${fullRel}（物理页第 ${seg.physicalStartPage}–${seg.physicalEndPage} 页）`;
                          })
                          .join('；')}
                      </span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <label
                        htmlFor="agent-inline-prompt-box"
                        className="text-xs font-medium text-neutral-300"
                      >
                        第一步：复制本节 Agent 提示词；Agent 将在同一次对话中生成、检查并修复课件
                      </label>
                      <div className="inline-flex items-center gap-1 border border-neutral-800 rounded p-0.5 bg-black">
                        <button
                          type="button"
                          onClick={() => setAgentInlineStage('stage1')}
                          className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                            agentInlineStage === 'stage1'
                              ? 'bg-white text-black font-medium'
                              : 'text-neutral-400 hover:text-white'
                          }`}
                        >
                          阶段一内容
                        </button>
                        <button
                          type="button"
                          onClick={() => setAgentInlineStage('stage2')}
                          disabled={!agentStage2Prompt}
                          className={`px-2 py-0.5 rounded text-[11px] transition-colors disabled:opacity-40 ${
                            agentInlineStage === 'stage2'
                              ? 'bg-white text-black font-medium'
                              : 'text-neutral-400 hover:text-white'
                          }`}
                        >
                          阶段二图表
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopyAgentPromptInline}
                        disabled={(isLoadingAgentPrompt && isLoadingChatPrompt) || !effectiveAgentInlinePrompt}
                        className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors whitespace-nowrap"
                      >
                        {copiedAgentPrompt ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>已复制本节 Agent 提示词</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>一键复制本节 Agent 提示词</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyMdPromptFile(
                            `agent-inline-${agentInlineStage}-md`,
                            `${slot.id}-agent-${agentInlineStage}-prompt.md`,
                            effectiveAgentInlinePrompt
                          )
                        }
                        disabled={(isLoadingAgentPrompt && isLoadingChatPrompt) || !effectiveAgentInlinePrompt}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap disabled:opacity-45"
                      >
                        {copiedMdKey === `agent-inline-${agentInlineStage}-md` ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>已复制 .md</span>
                          </>
                        ) : (
                          <>
                            <FileText className="w-3.5 h-3.5" />
                            <span>复制 .md 文件</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
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
                      {slicedBoundSegments.length > 0 ? (
                        slicedBoundSegments.map((seg) => {
                          const segId = seg.sectionId || slot.id;
                          const fileName = seg.segmentFileName || `${segId}.pdf`;
                          const copyKey = `chat-seg-${segId}`;
                          const isMulti = slicedBoundSegments.length > 1;
                          return (
                            <React.Fragment key={segId}>
                              <button
                                type="button"
                                onClick={() => handleCopyPdfFileToClipboard(seg, copyKey)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                                title={`将 ${fileName} 复制到系统剪贴板，等效资源管理器 Ctrl+C`}
                              >
                                {copiedQuickPdfKey === copyKey ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                                <span>
                                  {copiedQuickPdfKey === copyKey
                                    ? `已复制 ${isMulti ? fileName : '本节 PDF'}`
                                    : isMulti
                                      ? `复制 ${fileName}`
                                      : '复制本节 PDF'}
                                </span>
                              </button>
                              <a
                                href={`/api/courses/${course.id}/segments/${segId}/pdf?download=1`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 rounded transition-colors whitespace-nowrap"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>{isMulti ? `下载 ${fileName}` : '下载本节 PDF'}</span>
                              </a>
                            </React.Fragment>
                          );
                        })
                      ) : firstPdfMaterial ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCopyPdfFileToClipboard(undefined, 'chat-src')}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                            title="将原 PDF 复制到系统剪贴板，等效资源管理器 Ctrl+C"
                          >
                            {copiedQuickPdfKey === 'chat-src' ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{copiedQuickPdfKey === 'chat-src' ? '已复制原 PDF' : '复制原 PDF'}</span>
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
                      {isStage2PendingChat ? (
                        <>
                          <button
                            type="button"
                            data-testid="chat-copy-stage2-prompt-btn"
                            onClick={() => handleCopyChatPrompt('stage2', 'stage2')}
                            disabled={isLoadingChatPrompt}
                            className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors whitespace-nowrap"
                          >
                            {copiedChatPromptKey === 'stage2' ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span>已复制阶段二提示词</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>复制阶段二图表提示词</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyMdPromptFile(
                                'chat-stage2-md',
                                `${slot.id}-stage2-prompt.md`,
                                chatStage2Prompt
                              )
                            }
                            disabled={isLoadingChatPrompt || !chatStage2Prompt}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                          >
                            {copiedMdKey === 'chat-stage2-md' ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <FileText className="w-3.5 h-3.5" />
                            )}
                            <span>{copiedMdKey === 'chat-stage2-md' ? '已复制 .md' : '复制阶段二 .md'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyChatPrompt('stage1', 'stage1')}
                            disabled={isLoadingChatPrompt}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-400 hover:text-neutral-200 rounded transition-colors whitespace-nowrap"
                          >
                            {copiedChatPromptKey === 'stage1' ? (
                              <span className="text-emerald-300">已复制阶段一</span>
                            ) : (
                              <span>重复制阶段一</span>
                            )}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCopyChatPrompt('stage1', 'stage1')}
                            disabled={isLoadingChatPrompt}
                            className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors whitespace-nowrap"
                          >
                            {copiedChatPromptKey === 'stage1' ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span>已复制提示词</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>复制阶段一提示词</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyMdPromptFile(
                                'chat-stage1-md',
                                `${slot.id}-stage1-prompt.md`,
                                chatStage1Prompt || chatLessonPrompt
                              )
                            }
                            disabled={isLoadingChatPrompt || !(chatStage1Prompt || chatLessonPrompt)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                          >
                            {copiedMdKey === 'chat-stage1-md' ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <FileText className="w-3.5 h-3.5" />
                            )}
                            <span>{copiedMdKey === 'chat-stage1-md' ? '已复制 .md' : '复制阶段一 .md'}</span>
                          </button>
                          {Boolean(chatStage2Prompt) && (
                            <>
                              <button
                                type="button"
                                data-testid="chat-copy-stage2-prompt-btn"
                                onClick={() => handleCopyChatPrompt('stage2', 'stage2')}
                                disabled={isLoadingChatPrompt}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border rounded transition-colors whitespace-nowrap ${
                                  copiedChatPromptKey === 'stage2'
                                    ? 'border-emerald-600 bg-emerald-950/50 text-emerald-200'
                                    : 'border-sky-800/80 hover:border-sky-500 text-sky-200'
                                }`}
                              >
                                {copiedChatPromptKey === 'stage2' ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>已复制阶段二提示词</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>复制阶段二图表提示词</span>
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyMdPromptFile(
                                    'chat-stage2-md',
                                    `${slot.id}-stage2-prompt.md`,
                                    chatStage2Prompt
                                  )
                                }
                                disabled={isLoadingChatPrompt}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                              >
                                {copiedMdKey === 'chat-stage2-md' ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <FileText className="w-3.5 h-3.5" />
                                )}
                                <span>{copiedMdKey === 'chat-stage2-md' ? '已复制 .md' : '复制阶段二 .md'}</span>
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {chatPromptCopyNotice && (
                    <div
                      className={`text-xs rounded border px-3 py-2 ${
                        chatPromptCopyNotice.ok
                          ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-200'
                          : 'border-red-800/70 bg-red-950/30 text-red-200'
                      }`}
                    >
                      {chatPromptCopyNotice.message}
                    </div>
                  )}
                </div>

                {/* 步骤 2：一键粘贴 AI 输出（自动识别阶段一 / 阶段二 / 修复补丁） */}
                <div className="space-y-2.5 pt-2 border-t border-neutral-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-neutral-300">
                      第二步：{isStage2PendingChat
                        ? '阶段一已就绪，点击下方按钮粘贴阶段二图表输出并自动组装完成：'
                        : '点击粘贴 AI 输出（自动识别阶段一 / 阶段二 / 修复补丁 / 完整课件）：'}
                    </span>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid="chat-step2-clipboard-paste-btn"
                        onClick={handlePasteClipboardToImportBox}
                        disabled={isSavingImport}
                        className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-sky-400 text-black hover:bg-sky-300 rounded transition-colors whitespace-nowrap disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{isSavingImport ? '识别保存中...' : '粘贴 AI 输出并自动识别导入'}</span>
                      </button>

                      <button
                        type="button"
                        data-testid="chat-step2-toggle-manual-paste-btn"
                        onClick={() => {
                          setShowChatManualPaste((v) => {
                            const next = !v;
                            if (next) {
                              window.setTimeout(() => chatImportBoxRef.current?.focus(), 30);
                            }
                            return next;
                          });
                        }}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs border rounded transition-colors whitespace-nowrap ${
                          showChatManualPaste
                            ? 'border-sky-500/70 bg-sky-950/40 text-sky-200'
                            : 'border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white'
                        }`}
                      >
                        <span>{showChatManualPaste ? '收起粘贴框' : '手动粘贴框 / 补丁'}</span>
                      </button>

                      <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded cursor-pointer transition-colors whitespace-nowrap">
                        <Upload className="w-3.5 h-3.5" />
                        <span>导入文件 (.json/.md)</span>
                        <input
                          type="file"
                          accept=".json,.md,.txt"
                          onChange={handleImportFileSelect}
                          className="hidden"
                        />
                      </label>

                      <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded cursor-pointer transition-colors whitespace-nowrap">
                        <ImagePlus className="w-3.5 h-3.5" />
                        <span>补充图片</span>
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

                  {showChatManualPaste && (
                    <div className="bg-neutral-950 border border-neutral-800 rounded p-2.5 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-neutral-400">
                        <span>在此手动粘贴阶段一 JSON / 阶段二图表 / 局部修复补丁后点击识别导入：</span>
                        <div className="flex items-center gap-2 shrink-0">
                          {rawImportInput && (
                            <button
                              type="button"
                              onClick={() => {
                                setRawImportInput('');
                                chatImportBoxRef.current?.focus();
                              }}
                              className="text-neutral-400 hover:text-white"
                            >
                              清空
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setShowChatManualPaste(false)}
                            className="text-neutral-500 hover:text-neutral-300"
                          >
                            收起
                          </button>
                        </div>
                      </div>
                      {!displayedImportAudit && importReplaceHint && (
                        <div className="text-[11px] text-sky-300 font-mono">
                          {importReplaceHint}
                        </div>
                      )}
                      <textarea
                        ref={chatImportBoxRef}
                        id="chat-import-box"
                        rows={5}
                        value={rawImportInput}
                        onChange={(e) => {
                          setRawImportInput(e.target.value);
                          if (importReplaceHint) setImportReplaceHint(null);
                        }}
                        placeholder="按 Ctrl+V 或长按粘贴外部 AI 输出的阶段一 JSON / 阶段二 SVG / 增量修复补丁 / Markdown..."
                        className="w-full bg-black border border-neutral-800 rounded p-2.5 text-xs font-mono text-neutral-200 leading-relaxed focus:outline-none focus:border-sky-500"
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleProcessChatImportText(rawImportInput, true)}
                          disabled={isSavingImport || !rawImportInput.trim()}
                          className="px-3 py-1 text-xs font-medium bg-sky-400 text-black hover:bg-sky-300 rounded disabled:opacity-50"
                        >
                          识别并导入
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 自动渲染与图示引用自检面板（输入课件内容后实时检测失败部分并生成修改提示词） */}
                  {displayedImportAudit && (
                    <div
                      data-testid="import-render-audit"
                      className={`rounded border p-3.5 space-y-2.5 text-xs ${
                        displayedImportAudit.report.issues.length > 0
                          ? 'border-red-900/70 bg-red-950/25 text-neutral-200'
                          : 'border-emerald-900/60 bg-emerald-950/20 text-emerald-300'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-medium">
                          {displayedImportAudit.report.issues.length > 0 ? (
                            <>
                              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                              <span className="text-red-200">
                                {displayedImportAudit.report.summaryText}
                              </span>
                            </>
                          ) : (
                            <>
                              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                              <span>{displayedImportAudit.report.summaryText}</span>
                            </>
                          )}
                        </div>

                        {displayedImportAudit.report.issues.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                const repairText = displayedImportAudit.report.repairPrompt;
                                try {
                                  await copyPromptText(repairText);
                                  setCopiedImportRepairPrompt(true);
                                  setTimeout(() => setCopiedImportRepairPrompt(false), 2000);
                                } catch {
                                  await handleCopyMdPromptFile(
                                    'import-repair-md',
                                    `${slot.id}-repair-prompt.md`,
                                    repairText
                                  );
                                }
                                await latchCurrentImportBaseAndClearInput();
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1 bg-white text-black hover:bg-neutral-200 font-medium rounded transition-colors"
                            >
                              {copiedImportRepairPrompt ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>已复制增量补丁提示词</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>复制增量补丁提示词</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await handleCopyMdPromptFile(
                                  'import-repair-md',
                                  `${slot.id}-repair-prompt.md`,
                                  displayedImportAudit.report.repairPrompt
                                );
                                await latchCurrentImportBaseAndClearInput();
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                            >
                              {copiedMdKey === 'import-repair-md' ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <FileText className="w-3.5 h-3.5" />
                              )}
                              <span>{copiedMdKey === 'import-repair-md' ? '已复制修复 .md' : '复制修复 .md'}</span>
                            </button>
                            <button
                              type="button"
                              data-testid="import-clipboard-replace-btn"
                              onClick={handlePasteClipboardToImportBox}
                              className="px-2.5 py-1 border border-sky-700/80 hover:border-sky-400 bg-sky-950/40 text-sky-200 hover:text-white rounded transition-colors"
                            >
                              重新从剪贴板粘贴
                            </button>
                            <button
                              type="button"
                              data-testid="import-clear-for-patch-btn"
                              onClick={() => void latchCurrentImportBaseAndClearInput()}
                              className="px-2.5 py-1 border border-neutral-700 hover:border-sky-500 text-neutral-200 hover:text-white rounded transition-colors"
                            >
                              清空并粘贴补丁
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleConfirmSaveImport(false)}
                            disabled={isSavingImport}
                            className="px-3 py-1 bg-emerald-400 text-black hover:bg-emerald-300 font-medium rounded transition-colors disabled:opacity-50"
                          >
                            {isSavingImport ? '保存中...' : '一键保存本节课件'}
                          </button>
                        )}
                      </div>

                      {importReplaceHint && (
                        <div className="text-[11px] text-sky-300 font-mono">
                          {importReplaceHint}
                        </div>
                      )}

                      {displayedImportAudit.report.issues.length > 0 && (
                        <>
                          <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                            {displayedImportAudit.report.issues.map((iss) => (
                              <li
                                key={iss.id}
                                className="border border-red-900/40 bg-black/70 rounded px-3 py-2 space-y-1"
                              >
                                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                                  <span
                                    className={`px-1.5 py-0.5 rounded border ${
                                      iss.severity === 'error'
                                        ? 'border-red-800 bg-red-950/60 text-red-300'
                                        : 'border-amber-800 bg-amber-950/50 text-amber-300'
                                    }`}
                                  >
                                    {iss.categoryLabel}
                                  </span>
                                  <span className="text-neutral-300">{iss.locationLabel}</span>
                                </div>
                                <div className="text-[11px] font-mono text-red-300/90 break-all bg-neutral-950 border border-neutral-900 rounded px-2 py-1">
                                  {iss.rawSnippet}
                                </div>
                                <div
                                  className="text-[11px] text-neutral-400 [&>p]:m-0"
                                  dangerouslySetInnerHTML={{
                                    __html: renderInlineMathWithLatex(iss.detail, lessonVisuals),
                                  }}
                                />
                              </li>
                            ))}
                          </ul>


                        </>
                      )}
                    </div>
                  )}

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
          (currentMode === 'api' || !isChatWorkbenchOpen) ? (
            <div className="border border-neutral-800 rounded p-8 my-8 space-y-4">
              <div className="text-xs font-mono text-neutral-500">
                {slot.date} · {slot.id} · 第 {slot.dayIndex} 讲（排程第 {slot.scheduledDay || slot.dayIndex}/{course.durationDays} 天 ·{' '}
                {(() => {
                  const mins = getEvaluatedSectionMinutes(slot);
                  return mins !== undefined ? `预计 ${mins} 分钟` : '待生成后评估学时';
                })()}）· 尚未生成本节课件
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
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors"
                  >
                    <ListChecks className="w-3.5 h-3.5" />
                    <span>
                      {currentMode === 'api'
                        ? '打开课程工作台 (API 分步生成 / 切分)'
                        : '打开课程工作台'}
                    </span>
                  </button>
                )}

                {currentMode !== 'api' && (<>
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
</>)}
              </div>
            </div>
          ) : null
        ) : (
          <article
            ref={articleRef}
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
              const symEl = target.closest('[data-latex-symbol]') as HTMLElement | null;
              if (symEl) {
                const symKey = symEl.getAttribute('data-latex-symbol') || '';
                const matchedEntry =
                  symbolIndex.byKey.get(symKey) || lookupSymbolInIndex(symbolIndex, symKey);
                if (matchedEntry) {
                  e.stopPropagation();
                  const wasSameActive = symEl.classList.contains('latex-symbol-active');
                  articleRef.current
                    ?.querySelectorAll('.latex-symbol-active')
                    .forEach((el) => el.classList.remove('latex-symbol-active'));
                  if (wasSameActive) {
                    setActiveSymbolPopover(null);
                    return;
                  }
                  symEl.classList.add('latex-symbol-active');
                  const anchorBox = (
                    (symEl.closest('.katex') as HTMLElement | null) || symEl
                  ).getBoundingClientRect();
                  setActiveSymbolPopover({
                    entry: matchedEntry,
                    rect: {
                      left: anchorBox.left,
                      top: anchorBox.top,
                      bottom: anchorBox.bottom,
                      width: anchorBox.width,
                    },
                  });
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

            {/* 已加载课件的渲染/引用异常提示与一键复制提示词 + 快速粘贴修复 */}
            {activeLessonAudit &&
              activeLessonAudit.issues.length > 0 &&
              dismissedActiveAuditKey !== `${course.id}-${slot.dayIndex}-${activeLesson.generatedAt || ''}` && (
                <section
                  data-testid="active-lesson-render-audit"
                  className="border border-red-900/60 bg-red-950/20 rounded p-4 space-y-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-red-200 font-medium">
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                      <span>{activeLessonAudit.summaryText}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowActiveAuditDetails((v) => !v)}
                        className="px-2.5 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                      >
                        {showActiveAuditDetails ? '收起诊断详情' : `查看 ${activeLessonAudit.issues.length} 处详情`}
                      </button>
                      {currentMode !== 'api' && (<>
<button
                        type="button"
                        onClick={async () => {
                          try {
                            await copyPromptText(activeLessonAudit.repairPrompt);
                            setCopiedActiveRepairPrompt(true);
                            setTimeout(() => setCopiedActiveRepairPrompt(false), 2000);
                          } catch {
                            await handleCopyMdPromptFile(
                              'active-repair-md',
                              `${slot.id}-repair-prompt.md`,
                              activeLessonAudit.repairPrompt
                            );
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-white text-black hover:bg-neutral-200 font-medium rounded transition-colors"
                      >
                        {copiedActiveRepairPrompt ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>已复制增量补丁提示词</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>复制增量修复提示词</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyMdPromptFile(
                            'active-repair-md',
                            `${slot.id}-repair-prompt.md`,
                            activeLessonAudit.repairPrompt
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                      >
                        {copiedMdKey === 'active-repair-md' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <FileText className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedMdKey === 'active-repair-md' ? '已复制 .md' : '复制修复 .md'}</span>
                      </button>
                      <button
                        type="button"
                        data-testid="toggle-quick-repair-btn"
                        onClick={handlePasteClipboardToQuickRepair}
                        disabled={isApplyingQuickRepair}
                        className="px-2.5 py-1 border border-sky-700/80 hover:border-sky-400 bg-sky-950/40 text-sky-200 hover:text-white rounded transition-colors disabled:opacity-50"
                      >
                        {isApplyingQuickRepair ? '合并修复中...' : '粘贴增量修复补丁'}
                      </button>
</>)}
                      <button
                        type="button"
                        onClick={() =>
                          setDismissedActiveAuditKey(
                            `${course.id}-${slot.dayIndex}-${activeLesson.generatedAt || ''}`
                          )
                        }
                        aria-label="暂时收起本节渲染检查提示"
                        className="p-1 text-neutral-400 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {currentMode !== 'api' && showQuickRepairBox && (
                    <div
                      data-testid="quick-repair-box"
                      className="border border-sky-900/60 bg-black/80 rounded p-3 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-sky-200">
                          增量合并修复（支持粘贴 AI 输出的增量补丁 JSON、单独 &lt;svg&gt;...&lt;/svg&gt; 代码块或完整课件，不会丢失原有章节）
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            data-testid="quick-repair-clipboard-btn"
                            onClick={handlePasteClipboardToQuickRepair}
                            disabled={isApplyingQuickRepair}
                            className="px-2.5 py-1 text-xs border border-sky-700/80 hover:border-sky-400 bg-sky-950/50 text-sky-100 rounded transition-colors disabled:opacity-50"
                          >
                            从剪贴板一键粘贴并合并
                          </button>
                          {quickRepairInput && (
                            <button
                              type="button"
                              onClick={() => {
                                setQuickRepairInput('');
                                setQuickRepairNotice(null);
                                quickRepairBoxRef.current?.focus();
                              }}
                              className="px-2 py-1 text-[11px] border border-neutral-800 hover:border-neutral-600 text-neutral-400 hover:text-white rounded"
                            >
                              清空
                            </button>
                          )}
                        </div>
                      </div>

                      <textarea
                        ref={quickRepairBoxRef}
                        data-testid="quick-repair-textarea"
                        rows={5}
                        value={quickRepairInput}
                        onChange={(e) => {
                          setQuickRepairInput(e.target.value);
                          if (quickRepairNotice) setQuickRepairNotice(null);
                        }}
                        placeholder='在此直接粘贴 AI 输出的增量修复补丁（如 {"textReplacements": [...], "diagramsToUpsert": [...]} 或单独的 <svg>...</svg> 代码块），自动合并到当前课件，无需重新生成全文...'
                        className="w-full bg-neutral-950 border border-neutral-800 rounded p-2.5 text-xs font-mono text-neutral-100 leading-relaxed focus:outline-none focus:border-sky-500"
                      />

                      {quickRepairAuditResult && (
                        <div
                          data-testid="quick-repair-status"
                          className={`text-[11px] font-mono px-2.5 py-1.5 rounded border ${
                            quickRepairAuditResult.report.issues.length === 0
                              ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-300'
                              : 'border-amber-800/70 bg-amber-950/25 text-amber-200'
                          }`}
                        >
                          {quickRepairAuditResult.report.issues.length === 0
                            ? `✓ ${quickRepairAuditResult.appliedSummary || '补丁合并后渲染自检已全部通过（0 错误）'}，可直接点击右侧按钮保存。`
                            : `${quickRepairAuditResult.appliedSummary ? `${quickRepairAuditResult.appliedSummary}；` : ''}合并后仍余 ${quickRepairAuditResult.report.errorCount} 处错误（${quickRepairAuditResult.report.issues[0]?.categoryLabel}：${quickRepairAuditResult.report.issues[0]?.locationLabel}）`}
                        </div>
                      )}

                      {quickRepairNotice && (
                        <div
                          className={`text-[11px] px-2.5 py-1.5 rounded border ${
                            quickRepairNotice.ok
                              ? 'border-emerald-800 bg-emerald-950/30 text-emerald-300'
                              : 'border-red-800 bg-red-950/30 text-red-300'
                          }`}
                        >
                          {quickRepairNotice.message}
                        </div>
                      )}

                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setShowQuickRepairBox(false)}
                          className="px-3 py-1 text-xs border border-neutral-800 text-neutral-400 hover:text-white rounded"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          data-testid="quick-repair-apply-btn"
                          onClick={() => handleApplyQuickRepair()}
                          disabled={isApplyingQuickRepair || !quickRepairInput.trim()}
                          className="px-3.5 py-1 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors disabled:opacity-50"
                        >
                          {isApplyingQuickRepair ? '正在合并保存...' : '立即应用补丁并保存'}
                        </button>
                      </div>
                    </div>
                  )}

                  {showActiveAuditDetails && (
                    <div className="space-y-3 pt-1">
                      <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                        {activeLessonAudit.issues.map((iss) => (
                          <li
                            key={iss.id}
                            className="border border-red-900/40 bg-black/70 rounded px-3 py-2 space-y-1"
                          >
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                              <span className="px-1.5 py-0.5 rounded border border-red-800 bg-red-950/60 text-red-300">
                                {iss.categoryLabel}
                              </span>
                              <span className="text-neutral-300">{iss.locationLabel}</span>
                            </div>
                            <div className="text-[11px] font-mono text-red-300/90 break-all bg-neutral-950 border border-neutral-900 rounded px-2 py-1">
                              {iss.rawSnippet}
                            </div>
                            <div
                              className="text-[11px] text-neutral-400 [&>p]:m-0"
                              dangerouslySetInnerHTML={{
                                __html: renderInlineMathWithLatex(iss.detail, lessonVisuals),
                              }}
                            />
                          </li>
                        ))}
                      </ul>
                      {currentMode !== 'api' && (
<div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <span className="text-[11px] font-mono text-neutral-400">
                          分阶段局部重生成 / 修复提示词（不重生成整节）：
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(
                            [
                              { stage: 'planning_prereq', label: '先修与规划' },
                              { stage: 'prose_derivation', label: '正文与推导' },
                              { stage: 'exercises_feedback', label: '练习与反馈' },
                              { stage: 'diagrams_topology', label: '拓扑与图表代码' },
                            ] as const
                          ).map(({ stage, label }) => (
                            <button
                              key={stage}
                              type="button"
                              onClick={async () => {
                                const promptText = buildStageRepairPrompt({
                                  course,
                                  slot,
                                  stage,
                                  issueSummary: activeLessonAudit.issues
                                    .map((i) => `- [${i.categoryLabel}] ${i.locationLabel}: ${i.detail}`)
                                    .join('\n'),
                                });
                                setStageRepairPreview({ stage, prompt: promptText });
                                setShowQuickRepairBox(true);
                                try {
                                  await copyPromptText(promptText);
                                  setCopiedStageKey(stage);
                                  setTimeout(() => setCopiedStageKey(null), 2000);
                                } catch {
                                  // Preview textarea displays promptText
                                }
                              }}
                              className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${
                                copiedStageKey === stage
                                  ? 'border-emerald-600 bg-emerald-950/60 text-emerald-200'
                                  : 'border-neutral-700 hover:border-sky-600 bg-neutral-950 text-neutral-300 hover:text-white'
                              }`}
                            >
                              {copiedStageKey === stage ? `✓ 已复制${label}` : label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyMdPromptFile(
                                'active-stage-repair-md',
                                `${slot.id}-${stageRepairPreview?.stage || 'repair'}-prompt.md`,
                                stageRepairPreview?.prompt || activeLessonAudit.repairPrompt
                              )
                            }
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-neutral-700 hover:border-neutral-500 text-[11px] text-neutral-200 hover:text-white"
                          >
                            <FileText className="w-3 h-3" />
                            <span>
                              {copiedMdKey === 'active-stage-repair-md'
                                ? '已复制 .md'
                                : '复制修复 .md 文件'}
                            </span>
                          </button>
                        </div>
                      </div>
)}
                    </div>
                  )}
                </section>
              )}

            {/* Lesson Title, Teaching Context (Prerequisites, Scope, Connections) */}
            <header data-symbol-scope="header" className="border-b border-neutral-900 pb-6 space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 font-mono">
                <span>{slot.date}</span>
                <span aria-hidden="true">·</span>
                <span>{slot.id}</span>
                <span aria-hidden="true">·</span>
                <span>
                  第 {slot.dayIndex} 讲 · 排程第 {slot.scheduledDay || slot.dayIndex}/{course.durationDays} 天 ·{' '}
                  {(() => {
                    const mins = getEvaluatedSectionMinutes(slot);
                    return mins !== undefined ? `预计 ${mins} 分钟` : '待生成后评估学时';
                  })()}
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
                className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight"
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
                  {activeLesson.teachingContext.prerequisiteCheck && (
                    <div
                      data-testid="lesson-prerequisite-check"
                      className="md:col-span-2 p-2.5 rounded border border-violet-900/50 bg-violet-950/20 text-xs text-violet-100/90 leading-relaxed [&>p]:m-0"
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdownWithLatex(
                          `**先修微诊断与衔接：** ${activeLesson.teachingContext.prerequisiteCheck}`,
                          lessonVisuals
                        ),
                      }}
                    />
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
                                      ? 'bg-neutral-900 text-transparent select-none rounded px-2 cursor-pointer hover:text-neutral-200 [&_*]:!text-transparent'
                                      : 'text-neutral-200'
                                  } [&>p]:m-0`}
                                  onClick={() => hideVocabMeaning && setHideVocabMeaning(false)}
                                  dangerouslySetInnerHTML={{
                                    __html: renderInlineMathWithLatex(
                                      stripAiCitationArtifacts(item.meaning),
                                      lessonVisuals
                                    ),
                                  }}
                                />
                              </div>
                              {item.example && (
                                <div className="text-xs text-neutral-400 space-y-0.5 pt-1">
                                  <p
                                    className="font-serif-reading text-neutral-300 text-sm [&>p]:m-0"
                                    dangerouslySetInnerHTML={{
                                      __html: renderInlineMathWithLatex(
                                        stripAiCitationArtifacts(item.example),
                                        lessonVisuals
                                      ),
                                    }}
                                  />
                                  {!hideVocabMeaning && item.exampleTranslation && (
                                    <p
                                      className="text-neutral-500 [&>p]:m-0"
                                      dangerouslySetInnerHTML={{
                                        __html: renderInlineMathWithLatex(
                                          stripAiCitationArtifacts(item.exampleTranslation),
                                          lessonVisuals
                                        ),
                                      }}
                                    />
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
                        二、文章阅读：
                        <span
                          className="[&>p]:m-0"
                          dangerouslySetInnerHTML={{
                            __html: renderInlineMathWithLatex(
                              stripAiCitationArtifacts(activeLesson.englishPayload.articleTitle),
                              lessonVisuals
                            ),
                          }}
                        />
                      </h2>
                      {activeLesson.englishPayload.sourceReference && (
                        <p className="text-xs text-neutral-500 mt-0.5">
                          <span
                            className="[&>p]:m-0"
                            dangerouslySetInnerHTML={{
                              __html: renderInlineMathWithLatex(
                                stripAiCitationArtifacts(activeLesson.englishPayload.sourceReference),
                                lessonVisuals
                              ),
                            }}
                          />{' '}
                          · 点击文中下划线词汇可查看释义
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
                          <span
                            className="text-neutral-200 [&>p]:m-0"
                            dangerouslySetInnerHTML={{
                              __html: renderInlineMathWithLatex(
                                stripAiCitationArtifacts(activeWordCard.meaning),
                                lessonVisuals
                              ),
                            }}
                          />
                        </div>
                        {activeWordCard.example && (
                          <p
                            className="text-neutral-400 [&>p]:m-0"
                            dangerouslySetInnerHTML={{
                              __html: renderInlineMathWithLatex(
                                stripAiCitationArtifacts(activeWordCard.example),
                                lessonVisuals
                              ),
                            }}
                          />
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
                          <p
                            className="text-sm leading-relaxed text-neutral-400 pt-1 [&>p]:m-0"
                            dangerouslySetInnerHTML={{
                              __html: renderInlineMathWithLatex(
                                stripAiCitationArtifacts(para.chinese),
                                lessonVisuals
                              ),
                            }}
                          />
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
              <section data-symbol-scope="body" className="space-y-6">
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
                        className="glow-border border border-neutral-800 rounded p-4 bg-neutral-950/60 space-y-3 my-4"
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
                              __html: renderMarkdownWithLatex(hq.answerReveal || '', lessonVisuals),
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
                    const enhancedSvg = visualEntry?.svgCode || enhanceDiagramSvg(diag.svgCode || '');
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
                        >
                          <DiagramRenderer spec={diag.diagramSpec} svgCode={enhancedSvg} />
                        </button>
                        {diag.caption && (
                          <figcaption
                            className="text-xs text-neutral-400 mt-3 leading-relaxed [&>p]:m-0"
                            dangerouslySetInnerHTML={{
                              __html: renderMarkdownWithLatex(diag.caption, lessonVisuals),
                            }}
                          />
                        )}
                        {renderDiagramTopologySpec(diag.topologySpec)}
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
                        className="glow-border border border-neutral-800 rounded p-5 bg-neutral-950/50 space-y-4 my-5"
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

                        {(() => {
                          const exDiag = interleavedLessonFlow.exerciseDiagramsByExId[q.id];
                          if (!exDiag) return null;
                          const exDiagId = (exDiag.id || `diag-${q.id}`).trim();
                          const visualEntry = lessonVisuals.find((v) => v.id === exDiagId);
                          const enhancedSvg =
                            visualEntry?.svgCode || enhanceDiagramSvg(exDiag.svgCode || '');
                          const exDiagTitle = stripAiCitationArtifacts(
                            exDiag.title || `练习题 #${qIdx + 1} 题设配图`
                          );
                          return (
                            <figure
                              data-testid={`exercise-svg-${q.id}`}
                              className="border border-neutral-800/90 rounded p-3.5 bg-black/70 space-y-2.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[11px] font-mono px-1.5 py-0.5 border border-neutral-800 rounded text-neutral-400">
                                    题目配图 · {exDiagId}
                                  </span>
                                  <span
                                    className="text-xs font-medium text-neutral-200"
                                    dangerouslySetInnerHTML={{
                                      __html: renderInlineMathWithLatex(exDiagTitle, lessonVisuals),
                                    }}
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openFloatingVisual(exDiagId)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 hover:text-white transition-colors whitespace-nowrap"
                                  title="在悬浮小窗中打开此题配图，方便演算对照"
                                >
                                  <Pin className="w-3 h-3" />
                                  <span>小窗置顶查看</span>
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => openFloatingVisual(exDiagId)}
                                aria-label={`点击在小窗中查看题目配图：${exDiagTitle}`}
                                className="diagram-svg-frame w-full block text-left overflow-x-auto cursor-zoom-in rounded hover:bg-neutral-900/30 transition-colors focus:outline-none focus:ring-1 focus:ring-neutral-600"
                              >
                                <DiagramRenderer spec={exDiag.diagramSpec} svgCode={enhancedSvg} />
                              </button>
                              {exDiag.caption && (
                                <figcaption
                                  className="text-xs text-neutral-400 leading-relaxed [&>p]:m-0"
                                  dangerouslySetInnerHTML={{
                                    __html: renderMarkdownWithLatex(exDiag.caption, lessonVisuals),
                                  }}
                                />
                              )}
                              {renderDiagramTopologySpec(exDiag.topologySpec)}
                            </figure>
                          );
                        })()}

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
                          <div className="space-y-1.5 max-w-md">
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
                            {renderInputMathPreviewBox(
                              currentVal,
                              lessonVisuals,
                              `exercise-input-latex-preview-${q.id}`
                            )}
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
                            {singleReport.explanation && (
                              <div
                                className="text-neutral-300 leading-relaxed"
                                dangerouslySetInnerHTML={{
                                  __html: renderMarkdownWithLatex(
                                    `**解题步骤与解析：** ${singleReport.explanation}`,
                                    lessonVisuals
                                  ),
                                }}
                              />
                            )}
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
                            {renderExerciseRemediationAndVariant(q)}
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
              <section data-symbol-scope="post-body" className="border-t border-neutral-800 pt-8 space-y-6">
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
                        className="glow-border border border-neutral-900 rounded p-5 bg-neutral-950/40 space-y-4"
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

                        {(() => {
                          const exDiag = interleavedLessonFlow.exerciseDiagramsByExId[q.id];
                          if (!exDiag) return null;
                          const exDiagId = (exDiag.id || `diag-${q.id}`).trim();
                          const visualEntry = lessonVisuals.find((v) => v.id === exDiagId);
                          const enhancedSvg =
                            visualEntry?.svgCode || enhanceDiagramSvg(exDiag.svgCode || '');
                          const exDiagTitle = stripAiCitationArtifacts(
                            exDiag.title || `综合练习 #${qIdx + 1} 题设配图`
                          );
                          return (
                            <figure
                              data-testid={`exercise-svg-${q.id}`}
                              className="ml-5 border border-neutral-800/90 rounded p-3.5 bg-black/70 space-y-2.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[11px] font-mono px-1.5 py-0.5 border border-neutral-800 rounded text-neutral-400">
                                    题目配图 · {exDiagId}
                                  </span>
                                  <span
                                    className="text-xs font-medium text-neutral-200"
                                    dangerouslySetInnerHTML={{
                                      __html: renderInlineMathWithLatex(exDiagTitle, lessonVisuals),
                                    }}
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openFloatingVisual(exDiagId)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] border border-neutral-800 hover:border-neutral-600 rounded text-neutral-300 hover:text-white transition-colors whitespace-nowrap"
                                  title="在悬浮小窗中打开此题配图，方便演算对照"
                                >
                                  <Pin className="w-3 h-3" />
                                  <span>小窗置顶查看</span>
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => openFloatingVisual(exDiagId)}
                                aria-label={`点击在小窗中查看题目配图：${exDiagTitle}`}
                                className="diagram-svg-frame w-full block text-left overflow-x-auto cursor-zoom-in rounded hover:bg-neutral-900/30 transition-colors focus:outline-none focus:ring-1 focus:ring-neutral-600"
                              >
                                <DiagramRenderer spec={exDiag.diagramSpec} svgCode={enhancedSvg} />
                              </button>
                              {exDiag.caption && (
                                <figcaption
                                  className="text-xs text-neutral-400 leading-relaxed [&>p]:m-0"
                                  dangerouslySetInnerHTML={{
                                    __html: renderMarkdownWithLatex(exDiag.caption, lessonVisuals),
                                  }}
                                />
                              )}
                              {renderDiagramTopologySpec(exDiag.topologySpec)}
                            </figure>
                          );
                        })()}

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
                          <div className="pl-5 space-y-1.5 max-w-md">
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
                            {renderInputMathPreviewBox(
                              currentVal,
                              lessonVisuals,
                              `exercise-input-latex-preview-${q.id}`
                            )}
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
                            {singleReport.explanation && (
                              <div
                                className="text-neutral-300 leading-relaxed"
                                dangerouslySetInnerHTML={{
                                  __html: renderMarkdownWithLatex(
                                    `**解题步骤与解析：** ${singleReport.explanation}`,
                                    lessonVisuals
                                  ),
                                }}
                              />
                            )}
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
                            {renderExerciseRemediationAndVariant(q)}
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
              <section data-symbol-scope="post-body" className="border-t border-neutral-800 pt-8 space-y-5">
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
                          placeholder="用自己的话写下你的解释或推导逻辑（支持 Markdown 与 $LaTeX$ 公式，保存在本地）..."
                          className="w-full bg-black border border-neutral-800 rounded p-3 text-xs text-neutral-200 focus:outline-none focus:border-neutral-500"
                        />

                        {(reverseDrafts[rc.id] || '').trim() && (
                          <div
                            data-testid={`reverse-check-preview-${rc.id}`}
                            className="p-3 rounded border border-neutral-800 bg-black/75 space-y-1 text-xs"
                          >
                            <div className="text-[11px] font-mono text-sky-400">
                              我的推导与解释预览：
                            </div>
                            <div
                              className="text-neutral-200 leading-relaxed lesson-prose [&>p]:m-0"
                              dangerouslySetInnerHTML={{
                                __html: renderMarkdownWithLatex(
                                  reverseDrafts[rc.id] || '',
                                  lessonVisuals
                                ),
                              }}
                            />
                          </div>
                        )}

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
                            {rc.referenceExplanation && (
                              <div
                                className="text-neutral-300 leading-relaxed pt-1"
                                dangerouslySetInnerHTML={{
                                  __html: renderMarkdownWithLatex(
                                    `**参考解释：** ${rc.referenceExplanation}`,
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
                </div>
              </section>
            )}

            {/* Strict Correctness Audit & Quality Verification Summary (hideable) */}
            {activeLesson.qualityCheck && (
              <section className="border-t border-neutral-900 pt-6">
                {hideQualityCheck ? (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleToggleQualityCheckVisibility(false)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-neutral-500 hover:text-neutral-200 border border-neutral-900 hover:border-neutral-700 rounded transition-colors"
                    >
                      <Eye className="w-3 h-3" />
                      <span>显示课件内容与中间推理正确性复核说明</span>
                    </button>
                  </div>
                ) : (
                  <div className="border border-neutral-900 rounded p-4 bg-neutral-950/30 space-y-2 text-xs text-neutral-400">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-neutral-300">
                        课件内容与中间推理正确性复核说明
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleQualityCheckVisibility(true)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-neutral-400 hover:text-white border border-neutral-800 hover:border-neutral-600 rounded transition-colors"
                      >
                        <EyeOff className="w-3 h-3" />
                        <span>隐藏复核说明</span>
                      </button>
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
                )}
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
          </motion.div>
        </AnimatePresence>
      </main>

      {/* 常驻底部保存课件操作栏：直接挂载至 body，确保任何转场动效下都严格悬浮在视口底部 */}
      {typeof document !== 'undefined' &&
        (previewLesson !== null || rawImportInput.trim().length > 0) &&
        createPortal(
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
          </div>,
          document.body
        )}

      {/* 非阻塞悬浮小窗：通过 Portal 挂载到 body，避免祖先 transform/filter 破坏 fixed 视口定位 */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {activeFloatingVisual && (
              <aside
                key="floating-visual-window"
                role="region"
                aria-label="悬浮看图小窗"
                style={{
                  transform: `translate3d(${floatingOffset.dx}px, ${floatingOffset.dy}px, 0)`,
                }}
                className="fixed bottom-5 right-5 z-50"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className={`glow-border border border-neutral-700 bg-[#0a0a0a]/98 backdrop-blur rounded-lg shadow-2xl overflow-hidden transition-[width] duration-150 ${
                    isFloatingExpanded ? 'w-[min(92vw,760px)]' : 'w-[min(88vw,390px)]'
                  }`}
                >
          <div
            onPointerDown={(e) => {
              if (!e.isPrimary || e.button !== 0 || (e.target as Element).closest('button')) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              dragStateRef.current = {
                dragging: true,
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                origDx: floatingOffset.dx,
                origDy: floatingOffset.dy,
              };
            }}
            className="flex items-center justify-between gap-2 px-3 py-2 bg-neutral-900/95 border-b border-neutral-800 cursor-move select-none touch-none"
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
                onClick={() => setIsFloatingExpanded((v) => !v)}
                aria-label={isFloatingExpanded ? '还原窗口尺寸' : '放大窗口'}
                title={isFloatingExpanded ? '还原窗口尺寸' : '放大窗口'}
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
                    style={{ width: '100%' }}
                  >
                    <DiagramRenderer
                      spec={
                        activeLesson?.diagrams?.find(
                          (d) => (d.id || '').trim().toLowerCase() === activeFloatingVisual.id.toLowerCase()
                        )?.diagramSpec ||
                        activeLesson?.exercises?.find(
                          (ex) => (ex.diagramId || `diag-${ex.id}`).trim().toLowerCase() === activeFloatingVisual.id.toLowerCase()
                        )?.diagramSpec
                      }
                      svgCode={activeFloatingVisual.svgCode || ''}
                    />
                  </div>
                ) : activeFloatingVisual.imageUrl ? (
                  <img
                    src={activeFloatingVisual.imageUrl}
                    alt={activeFloatingVisual.title}
                    style={{ width: '100%' }}
                    className="max-w-none h-auto rounded mx-auto block"
                  />
                ) : null}
              </div>

              {activeFloatingVisual.caption && (
                <div
                  className="px-3 py-2 border-t border-neutral-900 bg-neutral-950 text-[11px] text-neutral-400 leading-relaxed [&>p]:m-0"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdownWithLatex(activeFloatingVisual.caption, lessonVisuals),
                  }}
                />
              )}
            </>
          )}
                </motion.div>
              </aside>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* 交互式 LaTeX 上文符号释义浮窗：点击推导/练习中上文已解释的符号弹出 */}
      {typeof document !== 'undefined' &&
        activeSymbolPopover &&
        createPortal(
          (() => {
            const { entry, rect } = activeSymbolPopover;
            const popoverWidth = 340;
            const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
            const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
            const clampedLeft = Math.max(
              12,
              Math.min(vw - popoverWidth - 12, rect.left + rect.width / 2 - popoverWidth / 2)
            );
            const showBelow = rect.bottom + 185 < vh;
            const topPos = showBelow ? rect.bottom + 10 : Math.max(12, rect.top - 175);
            const cleanSymbolTex = entry.symbol.replace(/^\$+|\$+$/g, '').trim();

            return (
              <div
                data-testid="latex-symbol-popover"
                role="dialog"
                aria-label={`符号 ${entry.name} 的上文解释`}
                style={{
                  left: `${Math.round(clampedLeft)}px`,
                  top: `${Math.round(topPos)}px`,
                  width: `${popoverWidth}px`,
                }}
                className="fixed z-50 border border-sky-500/50 bg-[#070b12]/98 backdrop-blur-md rounded-lg shadow-2xl p-3.5 space-y-2"
              >
                <div className="flex items-start justify-between gap-2 border-b border-neutral-800/80 pb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="px-2 py-0.5 rounded bg-sky-950/60 border border-sky-500/40 text-sky-100 text-sm shrink-0"
                      dangerouslySetInnerHTML={{
                        __html: renderInlineMathWithLatex(`$${cleanSymbolTex}$`, lessonVisuals),
                      }}
                    />
                    <div className="min-w-0">
                      <div
                        className="text-xs font-semibold text-white truncate [&>p]:m-0"
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(entry.name, lessonVisuals),
                        }}
                      />
                      <div className="text-[10px] font-mono text-sky-300/80">
                        {entry.source === 'glossary' ? '上文符号释义表' : '自动识别自上文讲解'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="关闭符号释义"
                    onClick={() => {
                      setActiveSymbolPopover(null);
                      articleRef.current
                        ?.querySelectorAll('.latex-symbol-active')
                        .forEach((el) => el.classList.remove('latex-symbol-active'));
                    }}
                    className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div
                  className="text-xs text-neutral-200 leading-relaxed [&>p]:m-0"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdownWithLatex(entry.definition, lessonVisuals),
                  }}
                />

                {entry.unit && (
                  <div className="pt-1 border-t border-neutral-900 flex items-center gap-2 text-[11px] font-mono text-neutral-400">
                    <span>常用单位：</span>
                    <span
                      className="text-neutral-200"
                      dangerouslySetInnerHTML={{
                        __html: renderInlineMathWithLatex(
                          entry.unit.includes('$') ? entry.unit : `$${entry.unit}$`,
                          lessonVisuals
                        ),
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })(),
          document.body
        )}
    </div>
  );
};
