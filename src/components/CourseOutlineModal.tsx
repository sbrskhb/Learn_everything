import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Archive,
  BookOpen,
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FolderOpen,
  FolderSync,
  Plus,
  RefreshCw,
  RotateCcw,
  Scissors,
  Shuffle,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  Course,
  CourseDiskFile,
  DailyLessonContent,
  DailyPlanSlot,
  PdfDocumentMeta,
  PdfSplitPlanItem,
} from '../types';
import {
  addDaysToDateString,
  bindAndEnsureAllPdfRegionsCovered,
  computeVocabCoverageStats,
  ensureStableSectionId,
  getEvaluatedSectionMinutes,
  resolveSlotPdfSegments,
} from '../utils/learningLogic';
import {
  copyCourseFileToClipboard,
  copyPromptMarkdownFileToClipboard,
} from '../utils/clipboardFile';
import { renderInlineMathWithLatex } from '../utils/markdownMath';
import { generateLessonWithProgressStream } from '../utils/streamLessonClient';
import type { GenerationProgressEvent } from '../utils/streamProgress';
import {
  applyCoursewareRepairPatch,
  auditCoursewareRendering,
  auditRawCoursewareInput,
} from '../utils/coursewareDiagnostics';
import {
  detectPastedCoursewareInputKind,
  extractPendingDiagramSpecs,
  mergeStage2DiagramsIntoStage1,
  parseImportedLessonContent,
  tryExtractJsonObject,
} from '../utils/coursewareParser';
import { LessonPreviewModal } from './LessonPreviewModal';

export type OutlineWorkbenchStep = 'outline' | 'split_vocab' | 'lessons' | 'files';

interface CourseOutlineModalProps {
  isOpen: boolean;
  course: Course | null;
  initialStep?: OutlineWorkbenchStep;
  showAdvancedWorkflowDetails?: boolean;
  onOpenSettings?: () => void;
  onClose: () => void;
  onCourseUpdated: (course: Course) => void;
  onOpenLesson: (courseId: string, dayIndex: number) => void;
  onOpenAgentModal: (course: Course) => void;
}

export const CourseOutlineModal: React.FC<CourseOutlineModalProps> = ({
  isOpen,
  course,
  initialStep = 'outline',
  showAdvancedWorkflowDetails = false,
  onOpenSettings,
  onClose,
  onCourseUpdated,
  onOpenLesson,
  onOpenAgentModal,
}) => {
  return (
    <AnimatePresence>
      {isOpen && course && (
        <CourseOutlineModalInner
          key={course.id}
          course={course}
          initialStep={initialStep}
          showAdvancedWorkflowDetails={showAdvancedWorkflowDetails}
          onOpenSettings={onOpenSettings}
          onClose={onClose}
          onCourseUpdated={onCourseUpdated}
          onOpenLesson={onOpenLesson}
          onOpenAgentModal={onOpenAgentModal}
        />
      )}
    </AnimatePresence>
  );
};

interface CourseOutlineModalInnerProps extends Omit<CourseOutlineModalProps, 'isOpen' | 'course'> {
  course: Course;
}

const CourseOutlineModalInner: React.FC<CourseOutlineModalInnerProps> = ({
  course,
  initialStep = 'outline',
  showAdvancedWorkflowDetails = false,
  onOpenSettings,
  onClose,
  onCourseUpdated,
  onOpenLesson,
  onOpenAgentModal,
}) => {
  const isOpen = true;
  const [activeStep, setActiveStep] = useState<OutlineWorkbenchStep>(initialStep);

  // Step 1: Outline editing states
  const [draftSlots, setDraftSlots] = useState<DailyPlanSlot[]>([]);
  const [draftStartDate, setDraftStartDate] = useState<string>('');
  const [draftDurationDays, setDraftDurationDays] = useState<number>(course.durationDays || 1);
  const [isReallocatingSchedule, setIsReallocatingSchedule] = useState(false);
  const [isSavingOutline, setIsSavingOutline] = useState(false);
  const [isRegeneratingOutline, setIsRegeneratingOutline] = useState(false);
  const [chatSyllabusPrompt, setChatSyllabusPrompt] = useState<string>('');
  const [agentSyllabusPrompt, setAgentSyllabusPrompt] = useState<string>('');
  const [rawSyllabusImport, setRawSyllabusImport] = useState<string>('');
  const [showSyllabusFallbackPaste, setShowSyllabusFallbackPaste] = useState(false);
  const [syllabusRepairPrompt, setSyllabusRepairPrompt] = useState<string | null>(null);
  const [showSyllabusImportBox, setShowSyllabusImportBox] = useState(false);
  const [syllabusWorkbenchTab, setSyllabusWorkbenchTab] = useState<'chat' | 'agent'>('chat');

  // Step 2: PDF Splitting & English Vocab states
  const [splitModeTab, setSplitModeTab] = useState<'chat' | 'agent'>('chat');
  const [pdfMetas, setPdfMetas] = useState<PdfDocumentMeta[]>([]);
  const [draftSplitPlan, setDraftSplitPlan] = useState<PdfSplitPlanItem[]>([]);
  const [pageOffset, setPageOffset] = useState<number>(0);
  const [agentSplitPrompt, setAgentSplitPrompt] = useState<string>('');
  const [chatSplitPrompt, setChatSplitPrompt] = useState<string>('');
  const [rawSplitImport, setRawSplitImport] = useState<string>('');
  const [showSplitFallbackPaste, setShowSplitFallbackPaste] = useState(false);
  const [splitRepairState, setSplitRepairState] = useState<{
    error: string;
    repairPrompt: string;
    salvagedCount: number;
    brokenSnippet?: string;
  } | null>(null);
  const [isPlanningSplit, setIsPlanningSplit] = useState(false);
  const [isExecutingSplit, setIsExecutingSplit] = useState(false);
  const [isSyncingAgentInline, setIsSyncingAgentInline] = useState(false);
  const [slicingSectionId, setSlicingSectionId] = useState<string | null>(null);

  // English vocab allocation states
  const [dailyWordCountInput, setDailyWordCountInput] = useState<number>(20);
  const [isReallocatingVocab, setIsReallocatingVocab] = useState(false);

  // Step 3: Per-section quick material & generation states
  const [generatingDayIndex, setGeneratingDayIndex] = useState<number | null>(null);
  const [generatingDayProgress, setGeneratingDayProgress] =
    useState<GenerationProgressEvent | null>(null);
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);
  const [deletingLessonDay, setDeletingLessonDay] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [selectedStep3ChatDay, setSelectedStep3ChatDay] = useState<number>(() => {
    const firstPending = course.dailyPlan.find((s) => !s.lesson);
    return firstPending ? firstPending.dayIndex : course.dailyPlan[0]?.dayIndex || 1;
  });
  const [workbenchMode, setWorkbenchMode] = useState<'chat' | 'agent' | 'api'>(
    course.generationMode || 'api'
  );
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);
  const [step3PendingDraft, setStep3PendingDraft] = useState<DailyLessonContent | null>(null);
  const [step3PendingDraftAudit, setStep3PendingDraftAudit] = useState<{
    report: ReturnType<typeof auditCoursewareRendering>;
    parsedLesson: DailyLessonContent | null;
    appliedSummary?: string;
  } | null>(null);
  const [showStep3FallbackPaste, setShowStep3FallbackPaste] = useState<boolean>(false);
  const [step3RawImportText, setStep3RawImportText] = useState<string>('');
  const [step3PreviewLesson, setStep3PreviewLesson] = useState<DailyLessonContent | null>(null);
  const [step3PreviewKind, setStep3PreviewKind] = useState<'stage1' | 'stage2' | 'complete' | null>(null);
  const [isSavingStep3Import, setIsSavingStep3Import] = useState<boolean>(false);
  const [step3ImportNotice, setStep3ImportNotice] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [showStep3IssueDetails, setShowStep3IssueDetails] = useState<boolean>(false);
  const step3TextareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Step 4: Local File Manager & Backup states (via Python Backend)
  const [diskFiles, setDiskFiles] = useState<CourseDiskFile[]>([]);
  const [diskTotalBytes, setDiskTotalBytes] = useState<number>(0);
  const [diskAbsPath, setDiskAbsPath] = useState<string>('');
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [deletingRelPath, setDeletingRelPath] = useState<string | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadDiskFiles = async (courseId: string) => {
    setIsLoadingFiles(true);
    try {
      const r = await fetch(`/api/courses/${courseId}/files`);
      if (r.ok) {
        const data = await r.json();
        setDiskFiles(Array.isArray(data.files) ? data.files : []);
        setDiskTotalBytes(Number(data.totalBytes) || 0);
        setDiskAbsPath(String(data.absPath || ''));
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const refreshChatPrompts = (courseId: string) => {
    fetch(`/api/courses/${courseId}/days/1/chat-prompt`)
      .then((r) => r.json())
      .then((data) => {
        if (data.syllabusPrompt) setChatSyllabusPrompt(data.syllabusPrompt);
      })
      .catch(() => {
        // ignore
      });
    fetch(`/api/courses/${courseId}/agent-prompt`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.agentSyllabusPrompt) setAgentSyllabusPrompt(data.agentSyllabusPrompt);
        if (data?.agentSplitPrompt) setAgentSplitPrompt(data.agentSplitPrompt);
      })
      .catch(() => {
        // ignore
      });
  };

  useEffect(() => {
    if (!isOpen || !course) return;
    setActiveStep(initialStep);
    setDraftSlots(
      course.dailyPlan.map((s) => ({
        ...s,
        id: ensureStableSectionId(s.dayIndex, s.id),
      }))
    );
    setDraftStartDate(course.startDate);
    setDraftDurationDays(Math.max(1, course.durationDays || 1));
    const mode = course.generationMode || 'api';
    setWorkbenchMode(mode);
    setSplitModeTab(mode === 'agent' ? 'agent' : 'chat');
    setSyllabusWorkbenchTab(mode === 'agent' ? 'agent' : 'chat');
    setShowSyllabusImportBox((mode === 'chat' || mode === 'agent') && !course.outlineConfirmed);
    setPageOffset(course.pdfPageOffset || 0);
    setDraftSplitPlan(course.pdfSplitPlan || []);
    setDailyWordCountInput(course.englishConfig?.dailyWordCount || 20);
    setStatusMessage(null);
    setErrorMessage(null);

    // Fetch PDF split info & prompts
    fetch(`/api/courses/${course.id}/pdf-split/info`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.pdfMetas)) setPdfMetas(data.pdfMetas);
        if (Array.isArray(data.splitPlan) && data.splitPlan.length > 0) {
          setDraftSplitPlan(data.splitPlan);
        }
        if (typeof data.pageOffset === 'number') {
          setPageOffset(data.pageOffset);
        }
        if (data.agentSplitPrompt) setAgentSplitPrompt(data.agentSplitPrompt);
        if (data.chatSplitPrompt) setChatSplitPrompt(data.chatSplitPrompt);
      })
      .catch(() => {
        // ignore
      });

    refreshChatPrompts(course.id);
    loadDiskFiles(course.id);
  }, [isOpen, course?.id, initialStep]);

  useEffect(() => {
    if (!isOpen || !course) return;
    if (
      activeStep === 'outline' &&
      (course.generationMode === 'chat' || course.generationMode === 'agent') &&
      !course.outlineConfirmed
    ) {
      setShowSyllabusImportBox(true);
    }
  }, [activeStep, isOpen, course?.id, course?.generationMode, course?.outlineConfirmed]);

  const vocabCoverage = useMemo(() => {
    if (!course?.englishConfig) return null;
    return computeVocabCoverageStats(
      course.englishConfig.effectiveWords?.length || 0,
      draftSlots.length || course.durationDays,
      dailyWordCountInput
    );
  }, [course?.englishConfig, draftSlots.length, course?.durationDays, dailyWordCountInput]);

  const triggerCopyFeedback = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2000);
  };

  const handleInlineAgentSync = async () => {
    setIsSyncingAgentInline(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/agent-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceOverwrite: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '同步本地课程目录失败');
      const updatedCourse: Course = data.course;
      onCourseUpdated(updatedCourse);
      setDraftSlots(
        updatedCourse.dailyPlan.map((s) => ({
          ...s,
          id: ensureStableSectionId(s.dayIndex, s.id),
        }))
      );
      if (Array.isArray(updatedCourse.pdfSplitPlan)) {
        setDraftSplitPlan(updatedCourse.pdfSplitPlan);
      }
      const importedCount = Array.isArray(data.importedDays) ? data.importedDays.length : 0;
      setStatusMessage(
        `已扫描并同步本地课程文件夹：关联 ${importedCount} 节课件${
          data.syllabusUpdated ? '，已同步 outline.json' : ''
        }${data.splitPlanUpdated ? '，已同步 segments/split-plan.json' : ''}。`
      );
      loadDiskFiles(course.id);
    } catch (err: any) {
      setErrorMessage(err?.message || '扫描并同步本地课程文件夹失败');
    } finally {
      setIsSyncingAgentInline(false);
    }
  };

  const handleCopyCourseFile = async (relPath: string, key: string) => {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await copyCourseFileToClipboard(course.id, relPath);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2500);
      if (result.copiedToOsClipboard) {
        setStatusMessage(
          `已将文件 ${result.fileName || relPath} 复制到系统剪贴板，可直接按 Ctrl+V 粘贴到 AI 对话框或资源管理器。`
        );
      } else {
        setStatusMessage(
          result.reason ||
            `当前环境不支持直接写入桌面剪贴板，可点击右侧“下载/导出”获取 ${result.fileName || relPath}。`
        );
      }
    } catch (err: any) {
      setErrorMessage(err?.message || '复制文件到系统剪贴板失败');
    }
  };

  const handleCopyPromptAsMdFile = async (
    key: string,
    fileName: string,
    content: string
  ) => {
    if (!content.trim()) {
      setErrorMessage('当前提示词尚未就绪，请稍后再试。');
      return;
    }
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await copyPromptMarkdownFileToClipboard(course.id, fileName, content);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2500);
      if (result.copiedToOsClipboard) {
        setStatusMessage(
          `已将提示词文件 ${result.fileName || fileName} 复制到系统剪贴板，可直接在 Chat 对话框按 Ctrl+V 作为 .md 附件发送。`
        );
      } else {
        setStatusMessage(
          result.reason ||
            `已保存提示词至 ${result.fileName || fileName}（当前环境不支持写入剪贴板文件，请在「本地文件管理」或 prompts/ 目录拖拽使用）。`
        );
      }
    } catch (err: any) {
      setErrorMessage(err?.message || '复制 .md 提示词文件失败');
    }
  };

  // --- Step 2 Handlers: Outline Edit & Confirm ---
  const handleUpdateSlotField = (
    idx: number,
    field: keyof DailyPlanSlot,
    value: any
  ) => {
    setDraftSlots((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const handleSelectSlotRegion = (idx: number, regionId: string) => {
    const matched = draftSplitPlan.find((r) => r.sectionId === regionId);
    setDraftSlots((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        regionId: regionId || undefined,
        regionIds: regionId ? [regionId] : undefined,
        pdfSegment: matched || undefined,
        pdfSegments: matched ? [matched] : undefined,
      };
      return next;
    });
  };

  const handleAddSectionToOutline = () => {
    setDraftSlots((prev) => {
      const nextDayIndex = prev.length + 1;
      const nextDate = addDaysToDateString(draftStartDate || course.startDate, nextDayIndex - 1);
      const existingIds = new Set(prev.map((s) => s.id));
      let num = nextDayIndex;
      let candidateId = ensureStableSectionId(num);
      while (existingIds.has(candidateId)) {
        num++;
        candidateId = ensureStableSectionId(num);
      }
      return [
        ...prev,
        {
          id: candidateId,
          dayIndex: nextDayIndex,
          date: nextDate,
          title: `第 ${nextDayIndex} 讲：新增教学小节`,
          objective: `围绕“${course.goal}”完成本节核心概念与练习`,
          teachingScope: '核心概念与推导应用',
          prerequisites: prev.length > 0 ? [prev[prev.length - 1].title] : [],
          keyTopics: ['核心知识点'],
        },
      ];
    });
  };

  const handleRemoveSectionFromOutline = (idx: number) => {
    if (draftSlots.length <= 1) return;
    setDraftSlots((prev) => {
      const filtered = prev.filter((_, i) => i !== idx);
      return filtered.map((slot, i) => ({
        ...slot,
        dayIndex: i + 1,
        date: addDaysToDateString(draftStartDate || course.startDate, i),
      }));
    });
  };

  const handleSaveOutline = async (confirmOutline: boolean) => {
    setIsSavingOutline(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/outline`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: draftStartDate,
          durationDays: Math.max(1, Number(draftDurationDays) || 1),
          dailyPlan: effectiveSlots,
          confirmOutline,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存课程目录失败');

      onCourseUpdated(data.course);
      setDraftSlots(data.course.dailyPlan);
      setDraftDurationDays(data.course.durationDays || draftDurationDays);
      if (Array.isArray(data.course.pdfSplitPlan)) {
        setDraftSplitPlan(data.course.pdfSplitPlan);
      }
      if (confirmOutline) {
        setStatusMessage('已确认并保存完整课程大纲 (outline.json)，可开始逐节生成课件。');
        setActiveStep('lessons');
      } else {
        setStatusMessage('课程大纲修改已保存到本地 outline.json，已有课件保持完好。');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || '保存课程目录失败');
    } finally {
      setIsSavingOutline(false);
    }
  };

  const handleReallocateSchedule = async () => {
    if (draftSlots.length === 0) return;
    setIsReallocatingSchedule(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const sectionMinutes: Record<string, number> = {};
      for (const s of draftSlots) {
        const secId = ensureStableSectionId(s.dayIndex, s.id);
        const mins = getEvaluatedSectionMinutes(s);
        if (mins !== undefined) {
          sectionMinutes[secId] = mins;
        }
      }
      const res = await fetch(`/api/courses/${course.id}/schedule/reallocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          durationDays: Math.max(1, Number(draftDurationDays) || 1),
          startDate: draftStartDate || course.startDate,
          sectionMinutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '按预计学时分配学习天数失败');
      onCourseUpdated(data.course);
      setDraftSlots(data.course.dailyPlan);
      setDraftDurationDays(data.course.durationDays || draftDurationDays);
      setDraftStartDate(data.course.startDate || draftStartDate);
      const assessedCount = data.course.dailyPlan.filter(
        (s: DailyPlanSlot) => getEvaluatedSectionMinutes(s) !== undefined
      ).length;
      const totalMins = data.course.dailyPlan.reduce(
        (sum: number, s: DailyPlanSlot) => sum + (getEvaluatedSectionMinutes(s) || 0),
        0
      );
      setStatusMessage(
        assessedCount > 0
          ? `已按已评估学时（${assessedCount}/${data.course.dailyPlan.length} 节，共 ${totalMins} 分钟）将 ${data.course.dailyPlan.length} 个独立小节分配至 ${data.course.durationDays} 天；所有课件保持完好，无需重新生成。`
          : `已将 ${data.course.dailyPlan.length} 个独立小节分配至 ${data.course.durationDays} 天（当前小节尚未评估学时，写完课件后可再次按学时均衡重排）。`
      );
    } catch (err: any) {
      setErrorMessage(err?.message || '按预计学时分配学习天数失败');
    } finally {
      setIsReallocatingSchedule(false);
    }
  };

  const handleRegenerateOutlineApi = async () => {
    setIsRegeneratingOutline(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/outline/regenerate`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI 重新生成目录失败');
      onCourseUpdated(data.course);
      setDraftSlots(data.course.dailyPlan);
      if (Array.isArray(data.course.pdfSplitPlan)) {
        setDraftSplitPlan(data.course.pdfSplitPlan);
      }
      setStatusMessage('已重新生成完整课程目录，请预览并点击“确认并保存完整目录”。');
    } catch (err: any) {
      setErrorMessage(err?.message || '重新生成目录失败');
    } finally {
      setIsRegeneratingOutline(false);
    }
  };

  const handleImportChatSyllabus = async (overrideRawText?: string) => {
    const rawText = (overrideRawText ?? rawSyllabusImport).trim();
    if (!rawText) {
      setErrorMessage('请先复制外部 AI 生成的课程大纲 JSON 再导入。');
      return;
    }
    setIsSavingOutline(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setSyllabusRepairPrompt(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/import-syllabus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawContent: rawText,
          confirmOutline: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '导入目录 JSON 失败');
      onCourseUpdated(data.course);
      setDraftSlots(data.course.dailyPlan);
      setDraftDurationDays(data.course.durationDays || draftDurationDays);
      setRawSyllabusImport('');
      setShowSyllabusFallbackPaste(false);
      setSyllabusRepairPrompt(null);
      setShowSyllabusImportBox(false);
      setActiveStep('lessons');
      setStatusMessage('已导入并确认完整课程大纲 (outline.json)，已自动进入第 3 步：生成课件。');
    } catch (err: any) {
      const errMsg = err?.message || '解析导入目录失败';
      setErrorMessage(errMsg);
      setRawSyllabusImport(rawText);
      setSyllabusRepairPrompt(
        [
          '【第 2 步大纲 JSON 语法修复任务】你刚才输出的大纲 JSON 解析失败，请仅修正 JSON 语法/字段结构后返回合法的完整 JSON（保留原有章节边界与 regionId 绑定）。',
          `错误信息：${errMsg}`,
          rawText.length > 500
            ? `原输出首尾片段：\n\`\`\`text\n${rawText.slice(0, 240)}\n...\n${rawText.slice(-240)}\n\`\`\``
            : `原输出：\n\`\`\`text\n${rawText}\n\`\`\``,
        ].join('\n\n')
      );
    } finally {
      setIsSavingOutline(false);
    }
  };

  const handlePasteAndImportChatSyllabus = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error('no-clipboard-api');
      }
      const clipText = (await navigator.clipboard.readText()).trim();
      if (!clipText) {
        setErrorMessage('剪贴板当前为空，请先复制外部 AI 输出的大纲 JSON 再点击。');
        return;
      }
      await handleImportChatSyllabus(clipText);
    } catch {
      setShowSyllabusFallbackPaste(true);
      setErrorMessage('浏览器未授予剪贴板读取权限，请在下方临时粘贴框按 Ctrl+V 粘贴或选择文件导入。');
    }
  };

  const handleImportSyllabusJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = (await file.text()).trim();
      if (text) await handleImportChatSyllabus(text);
    } catch (err: any) {
      setErrorMessage(err?.message || `读取大纲文件 ${file.name} 失败`);
    } finally {
      e.target.value = '';
    }
  };

  // --- Step 1 Handlers: PDF Smart Split & Local Slicing ---
  const handleAiPlanPdfSplit = async () => {
    setIsPlanningSplit(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/pdf-split/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageOffset }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'LLM 规划 PDF 区域划分失败');
      let latestCourse = data.course;
      let latestPlan: PdfSplitPlanItem[] = data.splitPlan || [];

      if (!showAdvancedWorkflowDetails && latestPlan.length > 0) {
        const execRes = await fetch(`/api/courses/${course.id}/pdf-split/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ splitPlan: latestPlan }),
        });
        if (execRes.ok) {
          const execData = await execRes.json();
          latestCourse = execData.course;
          latestPlan = execData.splitPlan || latestPlan;
        }
      }

      onCourseUpdated(latestCourse);
      setDraftSplitPlan(latestPlan);
      setDraftSlots(latestCourse.dailyPlan);
      refreshChatPrompts(course.id);
      const sliced = latestPlan.filter((p) => p.status === 'sliced').length;
      setStatusMessage(
        sliced > 0
          ? `已完成区域划分与本地 PDF 无损切割（共 ${sliced} 个区域），请点击下方“进入第 2 步：LLM 生成课程大纲”。`
          : '第 1 步 LLM 区域划分完成，请确认页码范围后点击“执行本地脚本切割全部区域 PDF”。'
      );
    } catch (err: any) {
      setErrorMessage(err?.message || '规划 PDF 区域划分失败');
    } finally {
      setIsPlanningSplit(false);
    }
  };

  const handleApplyPageOffsetToAll = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/pdf-split/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          splitPlan: draftSplitPlan,
          pageOffset,
          applyOffsetToAll: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '换算页码偏移失败');
      onCourseUpdated(data.course);
      setDraftSplitPlan(data.splitPlan || []);
      refreshChatPrompts(course.id);
      setStatusMessage(
        `已按偏移量 (${pageOffset >= 0 ? `+${pageOffset}` : pageOffset} 页) 统一换算全部区域的 PDF 物理页码（物理页 = 印刷页 + 偏移量）。`
      );
    } catch (err: any) {
      setErrorMessage(err?.message || '换算页码偏移失败');
    }
  };

  const handleSaveSplitPlanOnly = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/pdf-split/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          splitPlan: draftSplitPlan,
          pageOffset,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存区域划分方案失败');
      onCourseUpdated(data.course);
      setDraftSplitPlan(data.splitPlan || []);
      refreshChatPrompts(course.id);
      setStatusMessage('已保存当前区域划分方案至 segments/split-plan.json。');
    } catch (err: any) {
      setErrorMessage(err?.message || '保存区域划分方案失败');
    }
  };

  const handleImportChatSplitPlan = async (overrideRawText?: string) => {
    const rawText = (overrideRawText ?? rawSplitImport).trim();
    if (!rawText) {
      setErrorMessage('请先复制外部 AI 输出的 PDF 区域划分 JSON 再导入。');
      return;
    }
    setIsExecutingSplit(true);
    setErrorMessage(null);
    setStatusMessage(null);
    const shouldMergeIncremental = Boolean(
      splitRepairState && splitRepairState.salvagedCount > 0
    );
    try {
      const res = await fetch(`/api/courses/${course.id}/pdf-split/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawContent: rawText,
          pageOffset,
          incremental: shouldMergeIncremental,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const salvaged: PdfSplitPlanItem[] = Array.isArray(data.salvagedRegions)
          ? data.salvagedRegions
          : [];
        if (salvaged.length > 0) {
          setDraftSplitPlan(salvaged);
          if (data.course) onCourseUpdated(data.course);
        }
        setSplitRepairState({
          error: data.error || '导入 PDF 划分方案失败',
          repairPrompt:
            data.repairPrompt ||
            `请仅针对以下报错修正划分方案 JSON，不要重复输出已正确完成的区域：\n${data.error || 'JSON 解析失败'}`,
          salvagedCount: salvaged.length,
          brokenSnippet: data.brokenSnippet,
        });
        setErrorMessage(data.error || '导入 PDF 划分方案失败');
        return;
      }

      let latestCourse = data.course;
      let latestPlan: PdfSplitPlanItem[] = data.splitPlan || [];

      if (latestPlan.length > 0) {
        const execRes = await fetch(`/api/courses/${course.id}/pdf-split/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ splitPlan: latestPlan }),
        });
        if (execRes.ok) {
          const execData = await execRes.json();
          latestCourse = execData.course;
          latestPlan = execData.splitPlan || latestPlan;
        }
      }

      onCourseUpdated(latestCourse);
      setDraftSplitPlan(latestPlan);
      setDraftSlots(latestCourse.dailyPlan);
      setRawSplitImport('');
      setShowSplitFallbackPaste(false);
      setSplitRepairState(null);
      refreshChatPrompts(course.id);
      const slicedCount = latestPlan.filter((p) => p.status === 'sliced').length;
      if (slicedCount > 0) {
        setStatusMessage(
          `已完成区域划分与本地 PDF 无损切割（共 ${slicedCount} 个区域），已自动进入第 2 步：LLM 生成课程大纲。`
        );
        setActiveStep('outline');
      } else {
        setStatusMessage(
          '已成功导入外部 AI 的 PDF 划分区域方案，可点击下方按钮调用本地脚本完成切割。'
        );
      }
    } catch (err: any) {
      setErrorMessage(err?.message || '导入 PDF 划分方案失败');
    } finally {
      setIsExecutingSplit(false);
    }
  };

  const handlePasteAndImportSplitPlan = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error('no-clipboard-api');
      }
      const clipText = (await navigator.clipboard.readText()).trim();
      if (!clipText) {
        setErrorMessage('剪贴板当前为空，请先复制 AI 返回的区域划分 JSON 再点击。');
        return;
      }
      await handleImportChatSplitPlan(clipText);
    } catch {
      setShowSplitFallbackPaste(true);
      setErrorMessage('浏览器未授予剪贴板读取权限，请在下方临时粘贴框按 Ctrl+V 粘贴或导入文件。');
    }
  };

  const handleImportSplitJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = (await file.text()).trim();
      if (text) await handleImportChatSplitPlan(text);
    } catch (err: any) {
      setErrorMessage(err?.message || `读取文件 ${file.name} 失败`);
    } finally {
      e.target.value = '';
    }
  };

  const handleAddSplitRegion = () => {
    const primaryMeta = pdfMetas[0];
    const defaultSource =
      primaryMeta?.fileName ||
      course.materials.find((m) => m.isPdf || m.fileName.toLowerCase().endsWith('.pdf'))?.fileName ||
      'textbook.pdf';
    const totalPages = primaryMeta?.totalPages || 200;

    setDraftSplitPlan((prev) => {
      const existingIds = new Set(prev.map((r) => r.sectionId));
      let idx = prev.length + 1;
      let regionId = `region-${String(idx).padStart(2, '0')}`;
      while (existingIds.has(regionId)) {
        idx++;
        regionId = `region-${String(idx).padStart(2, '0')}`;
      }
      const lastItem = prev[prev.length - 1];
      const physStart = lastItem ? Math.min(totalPages, lastItem.physicalEndPage + 1) : 1;
      const physEnd = Math.min(totalPages, physStart + 9);
      const printStart = Math.max(1, physStart - pageOffset);
      const printEnd = Math.max(printStart, physEnd - pageOffset);

      return [
        ...prev,
        {
          sectionId: regionId,
          dayIndex: prev.length + 1,
          date: course.startDate,
          sectionTitle: `区域 ${idx}：第 ${idx} 主题章节`,
          sourceFileName: defaultSource,
          printedStartPage: printStart,
          printedEndPage: printEnd,
          physicalStartPage: physStart,
          physicalEndPage: physEnd,
          pageOffset,
          crossRefPages: [],
          outlineMappingNote: '',
          segmentFileName: `${regionId}.pdf`,
          segmentRelPath: `${course.courseDirPath || `courses/${course.folderName || course.id}`}/segments/${regionId}.pdf`,
          status: 'planned',
        },
      ];
    });
  };

  const handleRemoveSplitRegion = async (idx: number) => {
    const target = draftSplitPlan[idx];
    const nextPlan = draftSplitPlan.filter((_, i) => i !== idx);
    setDraftSplitPlan(nextPlan);
    if (target) {
      try {
        const res = await fetch(`/api/courses/${course.id}/pdf-split/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            splitPlan: nextPlan,
            pageOffset,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          onCourseUpdated(data.course);
          setDraftSlots(data.course.dailyPlan);
          loadDiskFiles(course.id);
          setStatusMessage(`已移除区域 ${target.sectionId} 并同步清理对应的切片文件。`);
        }
      } catch {
        // local draft already removed
      }
    }
  };

  const handleUpdateSplitItem = (
    idx: number,
    field: keyof PdfSplitPlanItem,
    value: any
  ) => {
    setDraftSplitPlan((prev) => {
      const next = [...prev];
      const item = { ...next[idx], [field]: value };

      // If user edits printedStartPage or printedEndPage, automatically sync physical page using pageOffset
      if (field === 'printedStartPage') {
        const pStart = Number(value) || 1;
        item.physicalStartPage = Math.max(1, pStart + pageOffset);
      } else if (field === 'printedEndPage') {
        const pEnd = Number(value) || 1;
        item.physicalEndPage = Math.max(item.physicalStartPage, pEnd + pageOffset);
      }
      next[idx] = item;
      return next;
    });
  };

  const handleExecuteLocalPdfSplit = async (targetSectionId?: string) => {
    if (targetSectionId) {
      setSlicingSectionId(targetSectionId);
    } else {
      setIsExecutingSplit(true);
    }
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const res = await fetch(`/api/courses/${course.id}/pdf-split/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionId: targetSectionId,
          splitPlan: draftSplitPlan,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '执行本地 PDF 切割脚本失败');
      onCourseUpdated(data.course);
      setDraftSplitPlan(data.splitPlan || []);
      setDraftSlots(data.course.dailyPlan);
      refreshChatPrompts(course.id);
      const slicedCount = (data.splitPlan || []).filter(
        (p: PdfSplitPlanItem) => p.status === 'sliced'
      ).length;
      setStatusMessage(
        targetSectionId
          ? `区域 ${targetSectionId} 的 PDF 已由本地脚本无损切割至 ${course.courseDirPath}/segments/${targetSectionId}.pdf`
          : `本地 PDF 切割完成：已在 ${course.courseDirPath}/segments/ 生成 ${slicedCount} 个区域 PDF 文件，可进入第 2 步由 LLM 生成课程大纲。`
      );
    } catch (err: any) {
      setErrorMessage(err?.message || '执行本地 PDF 切割失败');
    } finally {
      setSlicingSectionId(null);
      setIsExecutingSplit(false);
    }
  };

  // --- Step 2b Handlers: English Vocab Re-allocation ---
  const handleReallocateEnglishVocab = async (preserveStartedSlots = true) => {
    setIsReallocatingVocab(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/vocab/reallocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dailyWordCount: dailyWordCountInput,
          preserveStartedSlots,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '重新分配词汇失败');
      onCourseUpdated(data.course);
      setDraftSlots(data.course.dailyPlan);
      setStatusMessage(
        '已按每节目标词数重新随机分配尚未开始学习的词汇（已生成课件的小节保持不变，结果已稳定保存）。'
      );
    } catch (err: any) {
      setErrorMessage(err?.message || '重新分配词汇失败');
    } finally {
      setIsReallocatingVocab(false);
    }
  };

  const effectiveSlots = useMemo(
    () =>
      draftSplitPlan.length > 0
        ? bindAndEnsureAllPdfRegionsCovered(draftSlots, draftSplitPlan)
        : draftSlots,
    [draftSlots, draftSplitPlan]
  );

  const pdfCoverageStats = useMemo(() => {
    const totalRegions = draftSplitPlan.length;
    if (totalRegions === 0) {
      return { totalRegions: 0, coveredCount: 0, uncoveredIds: [] as string[] };
    }
    const coveredSet = new Set<string>();
    for (const slot of effectiveSlots) {
      for (const seg of resolveSlotPdfSegments(slot, draftSplitPlan)) {
        coveredSet.add(seg.sectionId);
      }
    }
    const uncoveredIds = draftSplitPlan
      .filter((item) => !coveredSet.has(item.sectionId))
      .map((item) => item.sectionId);
    return {
      totalRegions,
      coveredCount: totalRegions - uncoveredIds.length,
      uncoveredIds,
    };
  }, [effectiveSlots, draftSplitPlan]);

  // --- Step 3 Handlers: Quick Material Access & Per-Section Generation ---
  const selectedStep3Slot = useMemo(
    () =>
      effectiveSlots.find((s) => s.dayIndex === selectedStep3ChatDay) ||
      effectiveSlots.find((s) => !s.lesson) ||
      effectiveSlots[0] ||
      null,
    [effectiveSlots, selectedStep3ChatDay]
  );

  useEffect(() => {
    if (!selectedStep3Slot) return;
    if (selectedStep3Slot.dayIndex !== selectedStep3ChatDay) {
      setSelectedStep3ChatDay(selectedStep3Slot.dayIndex);
    }
  }, [selectedStep3Slot, selectedStep3ChatDay]);

  const handleSwitchWorkbenchMode = async (nextMode: 'chat' | 'agent' | 'api') => {
    if (nextMode === workbenchMode || isSwitchingMode) return;
    setIsSwitchingMode(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: nextMode }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '切换生成模式失败');
      }
      setWorkbenchMode(nextMode);
      setSplitModeTab(nextMode === 'agent' ? 'agent' : 'chat');
      setSyllabusWorkbenchTab(nextMode === 'agent' ? 'agent' : 'chat');
      onCourseUpdated(data.course);
      const modeLabel =
        nextMode === 'agent'
          ? 'Agent 本地自主工作模式'
          : nextMode === 'chat'
          ? 'Chat 外部 AI 网页对话模式'
          : 'API 直接生成模式';
      setStatusMessage(`已切换到「${modeLabel}」（保留当前课程大纲、草稿与已生成课件）。`);
    } catch (err: any) {
      setErrorMessage(err?.message || '切换生成模式失败');
    } finally {
      setIsSwitchingMode(false);
    }
  };

  useEffect(() => {
    if (!selectedStep3Slot) return;
    setStep3PendingDraft(null);
    setStep3PendingDraftAudit(null);
    setStep3RawImportText('');
    setShowStep3FallbackPaste(false);
    setShowStep3IssueDetails(false);
  }, [selectedStep3Slot?.dayIndex]);

  const duplicateLessonDaysByDay = useMemo(() => {
    const byNormTitle = new Map<string, Array<{ dayIndex: number; secId: string }>>();
    for (const slot of effectiveSlots) {
      const title = (slot.lesson?.title || '').trim().toLowerCase().replace(/\s+/g, '');
      if (!slot.lesson || !title) continue;
      const list = byNormTitle.get(title) || [];
      list.push({
        dayIndex: slot.dayIndex,
        secId: ensureStableSectionId(slot.dayIndex, slot.id),
      });
      byNormTitle.set(title, list);
    }
    const result = new Map<number, string[]>();
    for (const group of byNormTitle.values()) {
      if (group.length <= 1) continue;
      for (const item of group) {
        result.set(
          item.dayIndex,
          group.filter((other) => other.dayIndex !== item.dayIndex).map((other) => other.secId)
        );
      }
    }
    return result;
  }, [effectiveSlots]);

  const stage1IsNewerThanLesson = useMemo(() => {
    const s1Time = selectedStep3Slot?.stage1Draft?.generatedAt
      ? Date.parse(selectedStep3Slot.stage1Draft.generatedAt)
      : 0;
    const lessonTime = selectedStep3Slot?.lesson?.generatedAt
      ? Date.parse(selectedStep3Slot.lesson.generatedAt)
      : 0;
    return Boolean(
      selectedStep3Slot?.stage1Draft &&
        (!selectedStep3Slot?.lesson || (s1Time > 0 && lessonTime > 0 && s1Time > lessonTime))
    );
  }, [selectedStep3Slot?.stage1Draft, selectedStep3Slot?.lesson]);

  const step3Stage1BaseLesson = useMemo(
    () =>
      step3PendingDraft ||
      (stage1IsNewerThanLesson
        ? selectedStep3Slot?.stage1Draft
        : selectedStep3Slot?.lesson || selectedStep3Slot?.stage1Draft) ||
      null,
    [step3PendingDraft, stage1IsNewerThanLesson, selectedStep3Slot?.lesson, selectedStep3Slot?.stage1Draft]
  );

  const pendingStep3Specs = useMemo(
    () => (step3Stage1BaseLesson ? extractPendingDiagramSpecs(step3Stage1BaseLesson) : []),
    [step3Stage1BaseLesson]
  );

  const autoStep3Stage: 'repair' | 'stage2' | 'stage1' | 'complete' = useMemo(() => {
    if (step3PendingDraftAudit && step3PendingDraftAudit.report.issues.length > 0) {
      return 'repair';
    }
    if ((step3PendingDraft || stage1IsNewerThanLesson) && pendingStep3Specs.length > 0) {
      return 'stage2';
    }
    if (selectedStep3Slot?.lesson) {
      return pendingStep3Specs.length > 0 ? 'stage2' : 'complete';
    }
    if (selectedStep3Slot?.stage1Draft && pendingStep3Specs.length > 0) {
      return 'stage2';
    }
    return 'stage1';
  }, [
    step3PendingDraftAudit,
    stage1IsNewerThanLesson,
    selectedStep3Slot?.stage1Draft,
    selectedStep3Slot?.lesson,
    step3PendingDraft,
    pendingStep3Specs.length,
  ]);

  const handleCopySectionStagePrompt = async (
    dayIndex: number,
    target: 'stage1' | 'stage2' | 'agent_full' | 'agent_stage1' | 'agent_stage2' | 'legacy',
    asMdFile = false
  ) => {
    setSelectedStep3ChatDay(dayIndex);
    setErrorMessage(null);
    const feedbackKey = `${target}${asMdFile ? '-md' : ''}-${dayIndex}`;
    const targetSlot = effectiveSlots.find((s) => s.dayIndex === dayIndex);
    const secId = ensureStableSectionId(dayIndex, targetSlot?.id);
    try {
      if (target === 'agent_full') {
        const res = await fetch(`/api/courses/${course.id}/agent-prompt`);
        if (!res.ok) throw new Error('获取 Agent 总指令失败');
        const data = await res.json();
        if (asMdFile) {
          await handleCopyCourseFile('AGENT_TASK_PROMPT.md', feedbackKey);
        } else if (data?.prompt) {
          triggerCopyFeedback(feedbackKey, data.prompt);
        }
        return;
      }

      const res = await fetch(`/api/courses/${course.id}/days/${dayIndex}/chat-prompt`);
      if (!res.ok) {
        throw new Error('获取本节提示词失败');
      }
      const data = await res.json();
      if (target === 'stage1') {
        if (asMdFile) {
          if (data?.stage1PromptMdRelPath) {
            await handleCopyCourseFile(data.stage1PromptMdRelPath, feedbackKey);
          } else if (data?.stage1Prompt) {
            await handleCopyPromptAsMdFile(feedbackKey, `${secId}-stage1-prompt.md`, data.stage1Prompt);
          } else {
            throw new Error('未能生成阶段一 .md 提示词文件');
          }
        } else if (data?.stage1Prompt) {
          triggerCopyFeedback(feedbackKey, data.stage1Prompt);
        }
      } else if (target === 'stage2') {
        if (!data?.stage2Prompt) {
          throw new Error('当前阶段一没有待生成的 SVG 图示规格，可直接保存阶段一为完整课件。');
        }
        if (asMdFile) {
          if (data?.stage2PromptMdRelPath) {
            await handleCopyCourseFile(data.stage2PromptMdRelPath, feedbackKey);
          } else {
            await handleCopyPromptAsMdFile(feedbackKey, `${secId}-stage2-prompt.md`, data.stage2Prompt);
          }
        } else {
          triggerCopyFeedback(feedbackKey, data.stage2Prompt);
        }
      } else if (target === 'agent_stage1') {
        if (asMdFile) {
          if (!data?.agentStage1Prompt) throw new Error('未找到本节 Agent 阶段一指令');
          await handleCopyPromptAsMdFile(
            feedbackKey,
            `${secId}-agent-stage1-prompt.md`,
            data.agentStage1Prompt
          );
        } else if (data?.agentStage1Prompt) {
          triggerCopyFeedback(feedbackKey, data.agentStage1Prompt);
        }
      } else if (target === 'agent_stage2') {
        if (!data?.agentStage2Prompt) {
          throw new Error('请先让 Agent 完成阶段一并同步后，再复制本节阶段二 SVG 生成指令。');
        }
        if (asMdFile) {
          await handleCopyPromptAsMdFile(
            feedbackKey,
            `${secId}-agent-stage2-prompt.md`,
            data.agentStage2Prompt
          );
        } else {
          triggerCopyFeedback(feedbackKey, data.agentStage2Prompt);
        }
      } else {
        if (asMdFile) {
          if (data?.promptMdRelPath) {
            await handleCopyCourseFile(data.promptMdRelPath, feedbackKey);
          } else if (data?.lessonPrompt) {
            await handleCopyPromptAsMdFile(feedbackKey, `${secId}-prompt.md`, data.lessonPrompt);
          } else {
            throw new Error('未能生成 .md 提示词文件');
          }
        } else if (data?.lessonPrompt) {
          triggerCopyFeedback(feedbackKey, data.lessonPrompt);
        }
      }
    } catch (err: any) {
      setErrorMessage(err?.message || '复制提示词失败');
    }
  };

  const persistStep3FinalLesson = async (
    lessonToSave: DailyLessonContent,
    options?: {
      rawContent?: string;
      importStage?: 'complete' | 'stage2_merge';
      summaryNote?: string;
      openAfterSave?: boolean;
      advanceToNext?: boolean;
    }
  ) => {
    if (!selectedStep3Slot) return;
    setIsSavingStep3Import(true);
    setStep3ImportNotice(null);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/courses/${course.id}/days/${selectedStep3Slot.dayIndex}/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawContent: options?.rawContent || JSON.stringify(lessonToSave, null, 2),
            lessonData: lessonToSave,
            sourceMode: 'chat',
            importStage: options?.importStage || 'complete',
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '导入保存本节课件失败');
      }

      onCourseUpdated(data.course);
      const updatedSlots: DailyPlanSlot[] = (data.course.dailyPlan || []).map((s: DailyPlanSlot) =>
        s.dayIndex === selectedStep3Slot.dayIndex && lessonToSave.estimatedMinutes
          ? { ...s, estimatedMinutes: lessonToSave.estimatedMinutes }
          : s
      );
      setDraftSlots(updatedSlots);
      loadDiskFiles(course.id);

      const savedDay = selectedStep3Slot.dayIndex;
      const savedSecId = ensureStableSectionId(savedDay, selectedStep3Slot.id);
      setStep3PendingDraft(null);
      setStep3PendingDraftAudit(null);
      setStep3RawImportText('');
      setShowStep3FallbackPaste(false);
      setStep3PreviewLesson(null);
      setStep3PreviewKind(null);
      setShowStep3IssueDetails(false);

      if (options?.openAfterSave) {
        onClose();
        onOpenLesson(course.id, savedDay);
        return;
      }

      const note = options?.summaryNote ? ` · ${options.summaryNote}` : '';
      if (options?.advanceToNext !== false) {
        const nextPending =
          updatedSlots.find((s) => s.dayIndex > savedDay && !s.lesson) ||
          updatedSlots.find((s) => !s.lesson);
        if (nextPending && nextPending.dayIndex !== savedDay) {
          const nextSecId = ensureStableSectionId(nextPending.dayIndex, nextPending.id);
          setSelectedStep3ChatDay(nextPending.dayIndex);
          const msg = `✅ 已保存第 ${savedDay} 讲（lessons/${savedSecId}.json）${note}，已自动跳转到下一待生成第 ${nextPending.dayIndex} 讲（${nextSecId}）。`;
          setStep3ImportNotice({ ok: true, message: msg });
          setStatusMessage(msg);
          return;
        }
      }

      const doneMsg = `✅ 已保存第 ${savedDay} 讲（lessons/${savedSecId}.json）${note}。`;
      setStep3ImportNotice({ ok: true, message: doneMsg });
      setStatusMessage(doneMsg);
    } catch (err: any) {
      const errMsg = err?.message || '保存本节课件失败，请重试。';
      setStep3ImportNotice({ ok: false, message: errMsg });
      setErrorMessage(errMsg);
    } finally {
      setIsSavingStep3Import(false);
    }
  };

  const persistStep3Stage1Lesson = async (
    parsedLesson: DailyLessonContent,
    finalizeDirect = false
  ) => {
    if (!selectedStep3Slot) return;
    const pendingSpecs = extractPendingDiagramSpecs(parsedLesson);
    if (finalizeDirect && pendingSpecs.length === 0) {
      await persistStep3FinalLesson(parsedLesson, {
        importStage: 'complete',
        summaryNote: '无待绘 SVG · 直接完成',
        advanceToNext: true,
      });
      return;
    }

    setIsSavingStep3Import(true);
    setStep3ImportNotice(null);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/courses/${course.id}/days/${selectedStep3Slot.dayIndex}/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawContent: JSON.stringify(parsedLesson, null, 2),
            lessonData: parsedLesson,
            sourceMode: 'chat',
            importStage: 'stage1',
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '保存阶段一成果失败');
      }

      onCourseUpdated(data.course);
      setDraftSlots(data.course.dailyPlan || []);
      loadDiskFiles(course.id);

      const savedDay = selectedStep3Slot.dayIndex;
      const savedSecId = ensureStableSectionId(savedDay, selectedStep3Slot.id);
      setStep3PendingDraft(null);
      setStep3PendingDraftAudit(null);
      setStep3RawImportText('');
      setShowStep3FallbackPaste(false);
      setStep3PreviewLesson(null);
      setStep3PreviewKind(null);
      setShowStep3IssueDetails(false);

      const stageMsg =
        pendingSpecs.length > 0
          ? `✅ 已保存第 ${savedDay} 讲阶段一成果（lessons/${savedSecId}.stage1.json），提取到 ${pendingSpecs.length} 张待绘图示规格，已自动切换为阶段二 SVG 生成（无需再上传 PDF）。`
          : `✅ 已保存第 ${savedDay} 讲阶段一草稿（lessons/${savedSecId}.stage1.json）。`;
      setStep3ImportNotice({ ok: true, message: stageMsg });
      setStatusMessage(stageMsg);
    } catch (err: any) {
      const errMsg = err?.message || '阶段一 JSON 保存失败，请检查格式。';
      setStep3ImportNotice({ ok: false, message: errMsg });
      setErrorMessage(errMsg);
    } finally {
      setIsSavingStep3Import(false);
    }
  };

  const handleUnifiedStep3Import = async (rawTextInput: string) => {
    if (!selectedStep3Slot) return;
    const trimmed = rawTextInput.trim();
    if (!trimmed) {
      setStep3ImportNotice({
        ok: false,
        message: '粘贴的 AI 输出内容为空，请先复制 AI 回复后再试。',
      });
      return;
    }

    setStep3ImportNotice(null);
    setErrorMessage(null);
    const assets = course.customAssets || {};

    try {
      const hasStage1Base = Boolean(step3Stage1BaseLesson && pendingStep3Specs.length > 0);
      const baseForPatch =
        step3PendingDraft || selectedStep3Slot.lesson || selectedStep3Slot.stage1Draft || null;
      const kind = detectPastedCoursewareInputKind(trimmed, {
        hasStage1Draft: hasStage1Base,
        hasBaseLesson: Boolean(baseForPatch),
      });

      if (kind === 'stage2') {
        if (!step3Stage1BaseLesson) {
          setStep3ImportNotice({
            ok: false,
            message: '检测到阶段二 SVG 输出，但当前小节尚无阶段一正文底稿，请先导入阶段一内容。',
          });
          return;
        }
        const merged = mergeStage2DiagramsIntoStage1(step3Stage1BaseLesson, trimmed, assets);
        const report = auditCoursewareRendering(merged.mergedLesson, assets, {
          stage: 'complete',
        });
        const mergeSummary = `自动识别为阶段二 SVG · 组装 ${merged.matchedCount + merged.addedCount} 张图示`;

        if (report.issues.length > 0) {
          setStep3PendingDraft(merged.mergedLesson);
          setStep3PendingDraftAudit({
            report,
            parsedLesson: merged.mergedLesson,
            appliedSummary: mergeSummary,
          });
          setStep3ImportNotice({
            ok: false,
            message: `${mergeSummary}，但检测到 ${report.issues.length} 处图示/渲染问题，可复制下方修复提示词或 .md 文件让 AI 局部补修。`,
          });
          return;
        }

        await persistStep3FinalLesson(merged.mergedLesson, {
          rawContent: trimmed,
          importStage: 'stage2_merge',
          summaryNote: mergeSummary,
          advanceToNext: true,
        });
        return;
      }

      if (kind === 'patch' && baseForPatch) {
        const patched = applyCoursewareRepairPatch(
          baseForPatch,
          trimmed,
          selectedStep3Slot,
          assets
        );
        const rawPatchObj = tryExtractJsonObject(trimmed);
        const touchedDiagrams =
          patched.appliedMode === 'bare_svg' ||
          Boolean(
            rawPatchObj &&
              (Array.isArray(rawPatchObj.diagrams) ||
                Array.isArray(rawPatchObj.diagramsToUpsert))
          );
        const isStage1StillPendingSvg =
          !selectedStep3Slot.lesson &&
          extractPendingDiagramSpecs(patched.mergedLesson).length > 0 &&
          !touchedDiagrams;
        const report = auditCoursewareRendering(patched.mergedLesson, assets, {
          stage: isStage1StillPendingSvg ? 'stage1' : 'complete',
        });

        if (report.issues.length > 0) {
          setStep3PendingDraft(patched.mergedLesson);
          setStep3PendingDraftAudit({
            report,
            parsedLesson: patched.mergedLesson,
            appliedSummary: patched.appliedSummary,
          });
          setStep3ImportNotice({
            ok: false,
            message: `已应用局部补丁（${patched.appliedSummary}），但仍余 ${report.issues.length} 处问题，请继续复制修复提示词处理。`,
          });
          return;
        }

        if (isStage1StillPendingSvg) {
          await persistStep3Stage1Lesson(patched.mergedLesson, false);
        } else {
          await persistStep3FinalLesson(patched.mergedLesson, {
            rawContent: JSON.stringify(patched.mergedLesson, null, 2),
            importStage: 'complete',
            summaryNote: patched.appliedSummary,
            advanceToNext: true,
          });
        }
        return;
      }

      // Stage 1 or Complete lesson output
      const expectedStage: 'stage1' | 'complete' = kind === 'stage1' ? 'stage1' : 'complete';
      const check = auditRawCoursewareInput(trimmed, selectedStep3Slot, assets, {
        stage: expectedStage,
      });

      if (check && check.report.issues.length > 0) {
        setStep3PendingDraft(check.parsedLesson || null);
        setStep3PendingDraftAudit({
          report: check.report,
          parsedLesson: check.parsedLesson,
        });
        setStep3ImportNotice({
          ok: false,
          message:
            check.parsedLesson
              ? `检测到 ${check.report.issues.length} 处可局部修复的问题（已保留已解析字段），可复制下方修复提示词或 .md 文件，修复后再点粘贴。`
              : `检测到 JSON 语法错误，请复制下方精确修复提示词（或 .md 文件）让 AI 修复后再次粘贴。`,
        });
        return;
      }

      const parsedLesson =
        check?.parsedLesson ||
        parseImportedLessonContent(trimmed, selectedStep3Slot, 'chat', assets, {
          stageMode: kind === 'stage1' ? 'stage1' : 'auto',
        }).lesson;
      const pendingSpecs = extractPendingDiagramSpecs(parsedLesson);

      if (kind === 'stage1' && pendingSpecs.length > 0) {
        await persistStep3Stage1Lesson(parsedLesson, false);
      } else {
        await persistStep3FinalLesson(parsedLesson, {
          rawContent: JSON.stringify(parsedLesson, null, 2),
          importStage: 'complete',
          summaryNote:
            pendingSpecs.length === 0 ? '自动识别为完整课件' : undefined,
          advanceToNext: true,
        });
      }
    } catch (err: any) {
      setStep3ImportNotice({
        ok: false,
        message: err?.message || '自动识别或解析 AI 输出失败，请确认粘贴的是完整 JSON / 补丁 / Markdown。',
      });
    }
  };

  const handleStep3PasteFromClipboard = async () => {
    setStep3ImportNotice(null);
    setErrorMessage(null);
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error('no-clipboard-api');
      }
      const clipText = (await navigator.clipboard.readText()).trim();
      if (!clipText) {
        setStep3ImportNotice({
          ok: false,
          message: '剪贴板当前为空，请先在外部 AI 页面复制生成结果后再点击。',
        });
        return;
      }
      await handleUnifiedStep3Import(clipText);
    } catch {
      setShowStep3FallbackPaste(true);
      setStep3ImportNotice({
        ok: false,
        message: '浏览器未授予读取剪贴板权限，请在下方临时粘贴框按 Ctrl+V 或选择文件导入。',
      });
      window.setTimeout(() => step3TextareaRef.current?.focus(), 30);
    }
  };

  const handleStep3ImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStep3ImportNotice(null);
    try {
      const text = (await file.text()).trim();
      if (!text) {
        setStep3ImportNotice({
          ok: false,
          message: `所选文件 ${file.name} 内容为空。`,
        });
        return;
      }
      await handleUnifiedStep3Import(text);
    } catch (err: any) {
      setStep3ImportNotice({
        ok: false,
        message: err?.message || `读取文件 ${file.name} 失败。`,
      });
    } finally {
      e.target.value = '';
    }
  };

  const handlePreviewCurrentStep3Lesson = () => {
    if (!selectedStep3Slot) return;
    const candidate =
      step3PendingDraft || selectedStep3Slot.lesson || selectedStep3Slot.stage1Draft || null;
    if (!candidate) {
      setStep3ImportNotice({
        ok: false,
        message: '当前小节尚未导入或生成任何可预览的课件内容。',
      });
      return;
    }
    const hasPending = extractPendingDiagramSpecs(candidate).length > 0;
    const isStage1 =
      hasPending &&
      (candidate.generationStage === 'stage1_content' || !selectedStep3Slot.lesson);
    setStep3PreviewKind(isStage1 ? 'stage1' : 'complete');
    setStep3PreviewLesson(candidate);
  };

  const handleConfirmStep3PreviewSave = async () => {
    if (!selectedStep3Slot || !step3PreviewLesson) return;
    const lessonToSave = step3PreviewLesson;
    const kind = step3PreviewKind;
    setStep3PreviewLesson(null);
    setStep3PreviewKind(null);

    const pendingSpecs = extractPendingDiagramSpecs(lessonToSave);
    if (kind === 'stage1' && pendingSpecs.length > 0) {
      await persistStep3Stage1Lesson(lessonToSave, false);
      return;
    }
    await persistStep3FinalLesson(lessonToSave, {
      rawContent: JSON.stringify(lessonToSave, null, 2),
      importStage: kind === 'stage2' ? 'stage2_merge' : 'complete',
      advanceToNext: true,
    });
  };

  const handleGenerateSingleSectionApi = async (
    dayIndex: number,
    stage: 'all' | 'stage1' | 'stage2' = 'all'
  ) => {
    setGeneratingDayIndex(dayIndex);
    setGeneratingDayProgress({
      type: 'progress',
      stage: 'connecting',
      step: 1,
      percent: 4,
      message:
        stage === 'stage1'
          ? `正在流式生成第 ${dayIndex} 讲阶段一（正文与图示规格）...`
          : stage === 'stage2'
          ? `正在流式执行第 ${dayIndex} 讲阶段二（SVG 图示生成与组装）...`
          : `正在准备第 ${dayIndex} 讲两阶段资料与流式连接...`,
    });
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const data = await generateLessonWithProgressStream(
        course.id,
        dayIndex,
        (ev) => setGeneratingDayProgress(ev),
        stage
      );
      onCourseUpdated(data.course);
      setDraftSlots(data.course.dailyPlan);
      loadDiskFiles(course.id);
      const secId = `sec-${String(dayIndex).padStart(2, '0')}`;
      setStatusMessage(
        stage === 'stage1'
          ? `第 ${dayIndex} 讲阶段一已保存至 ${course.courseDirPath}/lessons/${secId}.stage1.json（可继续仅生成阶段二 SVG）`
          : `第 ${dayIndex} 讲课件已生成并保存到本地 ${course.courseDirPath}/lessons/${secId}.json`
      );
    } catch (err: any) {
      // Stage 2 failures still persist Stage 1 on the backend; refresh course snapshot so Stage 1 stays visible!
      try {
        const refreshRes = await fetch(`/api/courses/${course.id}`);
        if (refreshRes.ok) {
          const fresh = await refreshRes.json();
          if (fresh?.course) {
            onCourseUpdated(fresh.course);
            setDraftSlots(fresh.course.dailyPlan || []);
          }
        }
      } catch {
        // ignore refresh failure
      }
      setErrorMessage(
        err?.message || `生成第 ${dayIndex} 节课件失败（若阶段一已保存，可单独重跑阶段二或切换 Chat/Agent 模式）`
      );
    } finally {
      setGeneratingDayIndex(null);
      setGeneratingDayProgress(null);
    }
  };

  const handleGenerateAllRemainingApi = async () => {
    const pendingSlots = draftSlots.filter((s) => !s.lesson);
    if (pendingSlots.length === 0) {
      setStatusMessage('所有小节课件均已生成。');
      return;
    }
    setIsGeneratingBatch(true);
    setErrorMessage(null);
    setStatusMessage(null);
    let completed = 0;
    try {
      for (const s of pendingSlots) {
        setGeneratingDayIndex(s.dayIndex);
        setGeneratingDayProgress({
          type: 'progress',
          stage: 'connecting',
          step: 1,
          percent: 4,
          message: `[步骤 1/2] 正在准备第 ${s.dayIndex} 讲阶段一请求...`,
        });

        let needsStage2 = true;
        if (!s.stage1Draft) {
          const s1Data = await generateLessonWithProgressStream(
            course.id,
            s.dayIndex,
            (ev) =>
              setGeneratingDayProgress({
                ...ev,
                percent: Math.max(1, Math.min(54, Math.round((ev.percent || 0) * 0.54))),
                message: `[步骤 1/2] ${ev.message}`,
              }),
            'stage1'
          );
          onCourseUpdated(s1Data.course);
          setDraftSlots(s1Data.course.dailyPlan);
          needsStage2 = (s1Data.pendingDiagramsCount ?? 0) > 0;
        } else {
          needsStage2 = extractPendingDiagramSpecs(s.stage1Draft).length > 0;
        }

        if (needsStage2) {
          const s2Data = await generateLessonWithProgressStream(
            course.id,
            s.dayIndex,
            (ev) =>
              setGeneratingDayProgress({
                ...ev,
                percent: Math.max(56, Math.min(99, 56 + Math.round((ev.percent || 0) * 0.43))),
                message: `[步骤 2/2] ${ev.message}`,
              }),
            'stage2'
          );
          onCourseUpdated(s2Data.course);
          setDraftSlots(s2Data.course.dailyPlan);
        }
        completed++;
      }
      setStatusMessage(`已按单节单步请求顺序完成全部 ${completed} 节课件生成。`);
    } catch (err: any) {
      setErrorMessage(
        `${err?.message || '批量生成中断'}（已完成 ${completed}/${pendingSlots.length} 节，可继续从断点生成）`
      );
    } finally {
      setGeneratingDayIndex(null);
      setGeneratingDayProgress(null);
      setIsGeneratingBatch(false);
    }
  };

  const handleResetSectionToOutline = async (slot: DailyPlanSlot, autoRunApi = false) => {
    setDeletingLessonDay(slot.dayIndex);
    setErrorMessage(null);
    setStatusMessage(null);
    setStep3ImportNotice(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/days/${slot.dayIndex}/reset-to-outline`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '按大纲重置小节失败');
      onCourseUpdated(data.course);
      setDraftSlots(data.course.dailyPlan);
      setStep3PendingDraft(null);
      setStep3PendingDraftAudit(null);
      setSelectedStep3ChatDay(slot.dayIndex);
      loadDiskFiles(course.id);
      const secId = ensureStableSectionId(slot.dayIndex, slot.id);
      setStatusMessage(
        `已按大纲恢复 ${secId}（${data.restoredTitle || slot.title}）并清空重复/旧课件，请从阶段一重新生成。`
      );
      if (autoRunApi && workbenchMode === 'api') {
        await handleGenerateSingleSectionApi(slot.dayIndex, 'all');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || '按大纲重置小节失败');
    } finally {
      setDeletingLessonDay(null);
    }
  };

  const handleDeleteSingleLesson = async (slot: DailyPlanSlot) => {
    setDeletingLessonDay(slot.dayIndex);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/days/${slot.dayIndex}/lesson`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '删除小节课件失败');
      onCourseUpdated(data.course);
      setDraftSlots(data.course.dailyPlan);
      loadDiskFiles(course.id);
      setStatusMessage(`已从本地磁盘删除 ${slot.id} 的课件文件，可随时重新生成或导入。`);
    } catch (err: any) {
      setErrorMessage(err?.message || '删除小节课件失败');
    } finally {
      setDeletingLessonDay(null);
    }
  };

  const handleDeleteDiskFile = async (relPath: string) => {
    setDeletingRelPath(relPath);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch(
        `/api/courses/${course.id}/files?path=${encodeURIComponent(relPath)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `删除文件 ${relPath} 失败`);
      if (data.course) {
        onCourseUpdated(data.course);
        setDraftSlots(data.course.dailyPlan);
        if (Array.isArray(data.course.pdfSplitPlan)) {
          setDraftSplitPlan(data.course.pdfSplitPlan);
        }
      }
      setDiskFiles(Array.isArray(data.files) ? data.files : []);
      const removed = Array.isArray(data.deleted) ? data.deleted.join(', ') : relPath;
      setStatusMessage(`已从本地磁盘彻底删除：${removed}`);
    } catch (err: any) {
      setErrorMessage(err?.message || `删除文件 ${relPath} 失败`);
    } finally {
      setDeletingRelPath(null);
    }
  };

  const handleUploadCourseFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
    category: 'sources' | 'assets'
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploadingFile(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      let latestCourse = course;
      let latestFiles = diskFiles;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const isBinary =
          category === 'assets' || f.name.toLowerCase().endsWith('.pdf') || !f.type.startsWith('text/');
        let base64Data: string | undefined;
        let textContent: string | undefined;
        if (isBinary) {
          const buf = await f.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          const chunkSize = 0x8000;
          for (let j = 0; j < bytes.length; j += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(j, j + chunkSize));
          }
          base64Data = btoa(binary);
        } else {
          textContent = await f.text();
        }
        const res = await fetch(`/api/courses/${course.id}/files/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category,
            fileName: f.name,
            base64Data,
            textContent,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `上传 ${f.name} 失败`);
        if (data.course) latestCourse = data.course;
        if (Array.isArray(data.files)) latestFiles = data.files;
      }
      onCourseUpdated(latestCourse);
      setDiskFiles(latestFiles);
      loadDiskFiles(course.id);
      setStatusMessage(`已通过 Python 后端保存文件至 ${courseRelDir}/${category}/`);
    } catch (err: any) {
      setErrorMessage(err?.message || '上传课程文件失败');
    } finally {
      setIsUploadingFile(false);
      e.target.value = '';
    }
  };

  const handleOpenLocalFolder = async () => {
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/open-folder`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '打开目录失败');
      if (data.opened) {
        setStatusMessage(`已在系统文件管理器中打开：${data.absPath}`);
      } else {
        setStatusMessage(`${data.reason || ''} 本地目录路径：${data.absPath}`);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || '打开本地目录失败');
    }
  };

  const courseRelDir = course.courseDirPath || `courses/${course.folderName || course.id}`;
  const hasPdfMaterials =
    course.materials.some((m) => m.isPdf || m.fileName.toLowerCase().endsWith('.pdf')) ||
    pdfMetas.length > 0;
  const slicedRegionCount = draftSplitPlan.filter((p) => p.status === 'sliced').length;

  return (
        <motion.div
          key="outline-workbench-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="outline-workbench-title"
        >
          <motion.div
            key="outline-workbench-panel"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="glow-border w-full max-w-5xl bg-black border border-neutral-800 rounded-md p-6 my-6 max-h-[92vh] overflow-y-auto space-y-5 shadow-2xl"
          >
            {/* Top Header */}
            <div className="flex items-start justify-between gap-4 border-b border-neutral-800 pb-4">
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-neutral-400">
                  <span className="font-display text-white font-semibold text-base" id="outline-workbench-title">
                    《{course.name}》 — {showAdvancedWorkflowDetails ? '区域划分、大纲规划与课件生成工作台' : '课程生成工作台'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {course.outlineConfirmed ? '大纲状态：已确认' : '大纲状态：待第 2 步生成确认'}
                  </span>
                  {showAdvancedWorkflowDetails && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>本地路径：{courseRelDir}/</span>
                    </>
                  )}
                </div>
                {showAdvancedWorkflowDetails && (
                  <p className="text-xs text-neutral-500 font-mono">
                    目录结构：{courseRelDir}/ &#123; course.json, outline.json, sources/, segments/, lessons/, assets/ &#125;
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <div
                  data-testid="workbench-mode-switch"
                  className="inline-flex items-center rounded border border-neutral-800 bg-neutral-950 p-0.5 text-[11px] font-mono"
                  title="无需退出工作台直接切换生成模式，保留当前课程大纲、草稿与已生成课件"
                >
                  {(
                    [
                      { id: 'chat', label: 'Chat 对话模式' },
                      { id: 'agent', label: 'Agent 模式' },
                      { id: 'api', label: 'API 模式' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`workbench-mode-${item.id}`}
                      disabled={isSwitchingMode}
                      onClick={() => handleSwitchWorkbenchMode(item.id)}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        workbenchMode === item.id
                          ? 'bg-white text-black font-semibold'
                          : 'text-neutral-400 hover:text-white'
                      } disabled:opacity-60`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                {workbenchMode === 'agent' && onOpenAgentModal && (
                  <button
                    type="button"
                    onClick={() => onOpenAgentModal(course)}
                    className="px-2.5 py-1.5 text-[11px] font-mono border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white rounded transition-colors"
                    title="打开独立 Agent 终端指引窗口（可选）"
                  >
                    Agent 独立指引窗
                  </button>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭课程目录与切分工作台"
                  className="p-1.5 text-neutral-400 hover:text-white transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

        {/* 4-Tab Navigation Bar (Strict Workflow Order 1 -> 2 -> 3 + 4. File Manager & Backup) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => setActiveStep('split_vocab')}
            className={`glow-border p-3 rounded border text-left transition-colors ${
              activeStep === 'split_vocab'
                ? 'bg-neutral-900 border-white text-white'
                : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
            }`}
          >
            <div className="text-xs font-semibold">
              {course.category === 'english' && !hasPdfMaterials
                ? '1. 英语词库差集与词汇分配'
                : '1. LLM 划分区域与本地切割'}
            </div>
            <div className="text-[11px] text-neutral-500 mt-0.5">
              {course.category === 'english' && !hasPdfMaterials
                ? `每节 ${dailyWordCountInput} 词 · 周期内不重复随机抽取`
                : `已规划 ${draftSplitPlan.length} 区域 · 已切割 ${slicedRegionCount} PDF`}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveStep('outline')}
            className={`glow-border p-3 rounded border text-left transition-colors ${
              activeStep === 'outline'
                ? 'bg-neutral-900 border-white text-white'
                : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
            }`}
          >
            <div className="text-xs font-semibold">
              2. LLM 生成与确认课程大纲
            </div>
            <div className="text-[11px] text-neutral-500 mt-0.5">
              共 {draftSlots.length} 讲 · {course.outlineConfirmed ? '已确认大纲' : '基于第 1 步区域生成'}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveStep('lessons')}
            className={`glow-border p-3 rounded border text-left transition-colors ${
              activeStep === 'lessons'
                ? 'bg-neutral-900 border-white text-white'
                : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
            }`}
          >
            <div className="text-xs font-semibold">
              3. LLM 按序逐节生成课件
            </div>
            <div className="text-[11px] text-neutral-500 mt-0.5">
              已生成 {draftSlots.filter((s) => Boolean(s.lesson)).length}/{draftSlots.length} 讲 · 生成与导出 PDF
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveStep('files');
              loadDiskFiles(course.id);
            }}
            className={`glow-border p-3 rounded border text-left transition-colors ${
              activeStep === 'files'
                ? 'bg-neutral-900 border-white text-white'
                : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
            }`}
          >
            <div className="text-xs font-semibold">
              4. 本地文件管理与备份
            </div>
            <div className="text-[11px] text-neutral-500 mt-0.5">
              共 {diskFiles.length} 个文件 · 删除/上传/ZIP 导出
            </div>
          </button>
        </div>

        {statusMessage && (
          <div className="text-xs text-emerald-400 border border-emerald-900/60 bg-emerald-950/30 rounded px-3.5 py-2.5">
            {statusMessage}
          </div>
        )}
        {errorMessage && (
          <div className="text-xs text-red-400 border border-red-900/60 bg-red-950/30 rounded px-3.5 py-2.5">
            {errorMessage}
          </div>
        )}

        {/* ==================== STEP 2: COMPLETE COURSE OUTLINE (BASED ON STEP 1 REGIONS) ==================== */}
        {activeStep === 'outline' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-950/60 border border-neutral-900 rounded p-3.5 text-xs">
              <div className="space-y-1">
                <div className="text-white font-medium">
                  第 2 步：由 LLM 基于课程要求与第 1 步划分/切割的资料区域生成完整课程大纲 (outline.json)
                </div>
                <div className="text-neutral-500">
                  {hasPdfMaterials
                    ? `第 1 步已配置 ${draftSplitPlan.length} 个区域（其中 ${slicedRegionCount} 个已无损切割${
                        draftSlots.length > 0 && pdfCoverageStats.totalRegions > 0
                          ? `，当前大纲已覆盖 ${pdfCoverageStats.coveredCount}/${pdfCoverageStats.totalRegions} 个区域`
                          : ''
                      }）。本步仅规划完整知识结构与小节划分，不受学习天数限制。`
                    : '本步仅规划完整知识大纲，不受学习天数限制；修改目录或重命名小节不会删除任何已生成课件。'}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {workbenchMode === 'api' && (
                  <button
                    type="button"
                    onClick={handleRegenerateOutlineApi}
                    disabled={isRegeneratingOutline}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white text-black font-medium rounded hover:bg-neutral-200 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRegeneratingOutline ? 'animate-spin' : ''}`} />
                    <span>{isRegeneratingOutline ? 'API 正在生成大纲...' : 'API 生成/重新生成大纲'}</span>
                  </button>
                )}

                {workbenchMode !== 'api' && (
                  <button
                    type="button"
                    onClick={() => setShowSyllabusImportBox((v) => !v)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors ${
                      showSyllabusImportBox
                        ? 'border border-white bg-neutral-900 text-white'
                        : 'border border-neutral-700 hover:border-neutral-500 text-neutral-200'
                    }`}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>
                      {showSyllabusImportBox
                        ? '收起大纲操作栏'
                        : workbenchMode === 'agent'
                        ? '展开 Agent 大纲操作栏'
                        : '展开 Chat 大纲操作栏'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {(showSyllabusImportBox || workbenchMode !== 'api') && (showSyllabusImportBox || !course.outlineConfirmed) && (
              <div className="border border-neutral-800 rounded p-4 bg-neutral-950 space-y-3 text-xs">
                {workbenchMode === 'agent' || syllabusWorkbenchTab === 'agent' ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-neutral-300 font-medium">
                      Agent 模式：复制大纲提示词（或 .md 文件）交给本地 Agent 写入 <code className="text-neutral-200">{courseRelDir}/outline.json</code>，完成后点击右侧同步即可
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => triggerCopyFeedback('agent-syllabus', agentSyllabusPrompt || chatSyllabusPrompt)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white text-black font-medium rounded"
                      >
                        {copiedKey === 'agent-syllabus' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === 'agent-syllabus' ? '已复制 Agent 大纲提示词' : '复制 Agent 大纲提示词'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyPromptAsMdFile(
                            'agent-syllabus-md',
                            'agent-syllabus-prompt.md',
                            agentSyllabusPrompt || chatSyllabusPrompt
                          )
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded"
                      >
                        {copiedKey === 'agent-syllabus-md' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <FileText className="w-3.5 h-3.5" />}
                        <span>{copiedKey === 'agent-syllabus-md' ? '已复制 .md' : '复制 .md 文件'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleInlineAgentSync}
                        disabled={isSyncingAgentInline}
                        className="inline-flex items-center gap-1 px-3 py-1.5 border border-emerald-700/80 hover:border-emerald-400 bg-emerald-950/30 text-emerald-200 rounded"
                      >
                        <FolderSync className={`w-3.5 h-3.5 ${isSyncingAgentInline ? 'animate-spin' : ''}`} />
                        <span>{isSyncingAgentInline ? '正在扫描同步...' : '扫描并同步本地 outline.json'}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-neutral-300 font-medium">
                        第 2 步（Chat 模式）：① 复制源文件 ➔ ② 复制提示词（或 .md 文件）➔ ③ 粘贴 AI 输出（自动确认大纲并进入第 3 步）
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        {pdfMetas.slice(0, 2).map((pm) => (
                          <React.Fragment key={pm.fileName}>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyCourseFile(`sources/${pm.fileName}`, `copy-src-syl-${pm.fileName}`)
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                              title="将原 PDF 复制到系统剪贴板，等效 Ctrl+C"
                            >
                              {copiedKey === `copy-src-syl-${pm.fileName}` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              <span>
                                {copiedKey === `copy-src-syl-${pm.fileName}`
                                  ? '已复制原 PDF'
                                  : `复制原 PDF (${pm.fileName})`}
                              </span>
                            </button>
                          </React.Fragment>
                        ))}
                        <button
                          type="button"
                          onClick={() => triggerCopyFeedback('chat-syllabus', chatSyllabusPrompt)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-white text-black font-medium rounded hover:bg-neutral-200"
                        >
                          {copiedKey === 'chat-syllabus' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedKey === 'chat-syllabus' ? '已复制大纲提示词' : '复制大纲生成提示词'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyPromptAsMdFile(
                              'chat-syllabus-md',
                              'syllabus-prompt.md',
                              chatSyllabusPrompt
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                          title="将第 2 步大纲提示词保存为 .md 文件并复制到系统剪贴板"
                        >
                          {copiedKey === 'chat-syllabus-md' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <FileText className="w-3.5 h-3.5" />
                          )}
                          <span>{copiedKey === 'chat-syllabus-md' ? '已复制 .md' : '复制 .md 文件'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handlePasteAndImportChatSyllabus}
                          disabled={isSavingOutline}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-sky-400 text-black font-medium rounded hover:bg-sky-300 disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{isSavingOutline ? '导入确认中...' : '粘贴 AI 输出并生成大纲 →'}</span>
                        </button>
                        <label className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded cursor-pointer transition-colors">
                          <Upload className="w-3.5 h-3.5" />
                          <span>导入 JSON 文件</span>
                          <input
                            type="file"
                            accept=".json,.txt,.md"
                            onChange={handleImportSyllabusJsonFile}
                            disabled={isSavingOutline}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>

                    {syllabusRepairPrompt && (
                      <div className="border border-red-900/60 bg-red-950/25 rounded p-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-red-200">
                          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                          <span>检测到课程大纲 JSON 解析错误，可复制下方修复提示词让 AI 仅修正语法后再粘贴。</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => triggerCopyFeedback('syllabus-repair', syllabusRepairPrompt)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white text-black font-medium rounded"
                          >
                            {copiedKey === 'syllabus-repair' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                            <span>{copiedKey === 'syllabus-repair' ? '已复制修复提示词' : '复制修复提示词'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyPromptAsMdFile(
                                'syllabus-repair-md',
                                'syllabus-repair-prompt.md',
                                syllabusRepairPrompt
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-700 text-neutral-200 rounded"
                          >
                            <FileText className="w-3 h-3" />
                            <span>复制修复 .md 文件</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {showSyllabusFallbackPaste && (
                      <div className="pt-2 border-t border-neutral-900 space-y-2">
                        <textarea
                          rows={3}
                          value={rawSyllabusImport}
                          onChange={(e) => setRawSyllabusImport(e.target.value)}
                          placeholder='剪贴板权限受限时可在此按 Ctrl+V 粘贴大纲 JSON...'
                          className="w-full bg-black border border-neutral-800 rounded p-2.5 font-mono text-neutral-200"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setShowSyllabusFallbackPaste(false)}
                            className="px-2.5 py-1 border border-neutral-800 text-neutral-400 rounded"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={() => handleImportChatSyllabus()}
                            disabled={isSavingOutline || !rawSyllabusImport.trim()}
                            className="px-3 py-1 bg-white text-black font-medium rounded disabled:opacity-50"
                          >
                            导入并进入第 3 步 →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Outline Preview / Editor List */}
            {draftSlots.length === 0 ? (
              <div className="border border-dashed border-neutral-800 rounded p-6 text-center space-y-3 text-xs bg-neutral-950/30">
                <p className="text-neutral-300 font-medium">
                  当前尚未生成课程大纲（0 节）。大纲小节数量由第 1 步切分区域与知识边界决定，不受学习天数限制。
                </p>
                <p className="text-neutral-500">
                  请点击上方「API 生成/重新生成大纲」或使用「Chat / Agent 大纲生成与同步」生成并导入大纲，也可手动新增小节：
                </p>
                <button
                  type="button"
                  onClick={handleAddSectionToOutline}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>手动新增第 1 节</span>
                </button>
              </div>
            ) : !showAdvancedWorkflowDetails ? (
              <div className="space-y-2 max-h-[48vh] overflow-y-auto pr-1">
                {effectiveSlots.map((slot) => {
                  const secId = ensureStableSectionId(slot.dayIndex, slot.id);
                  const boundSegs = resolveSlotPdfSegments(slot, draftSplitPlan);
                  return (
                    <div
                      key={secId}
                      className="border border-neutral-800 rounded p-3 bg-neutral-950/40 space-y-1 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-300 text-[11px]">
                            {secId}
                          </span>
                          <span className="text-white font-sans font-semibold">
                            第 {slot.dayIndex} 讲 ·{' '}
                            <span
                              dangerouslySetInnerHTML={{
                                __html: renderInlineMathWithLatex(slot.title),
                              }}
                            />
                          </span>
                          {boundSegs.length > 0 ? (
                            boundSegs.map((seg) => (
                              <span
                                key={seg.sectionId}
                                className="px-1.5 py-0.5 rounded border border-neutral-800 bg-black text-neutral-300 text-[11px]"
                              >
                                区域 {seg.sectionId} (p.{seg.physicalStartPage}–{seg.physicalEndPage})
                              </span>
                            ))
                          ) : slot.regionId ? (
                            <span className="px-1.5 py-0.5 rounded border border-neutral-800 bg-black text-neutral-400 text-[11px]">
                              区域 {slot.regionId}
                            </span>
                          ) : null}
                          {slot.lesson && (
                            <span className="text-emerald-400">· 已有课件（受保护）</span>
                          )}
                        </div>
                      </div>
                      <p
                        className="text-neutral-400 leading-relaxed"
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(slot.objective),
                        }}
                      />
                      {slot.keyTopics && slot.keyTopics.length > 0 && (
                        <p className="text-neutral-500">
                          知识点：
                          <span
                            dangerouslySetInnerHTML={{
                              __html: renderInlineMathWithLatex(slot.keyTopics.join('、')),
                            }}
                          />
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[48vh] overflow-y-auto pr-1">
                {draftSlots.map((slot, idx) => {
                  const secId = ensureStableSectionId(slot.dayIndex, slot.id);
                  return (
                    <div
                      key={secId}
                      className="border border-neutral-800 rounded p-3.5 bg-neutral-950/40 space-y-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 font-mono">
                          <span className="px-2 py-0.5 bg-neutral-900 border border-neutral-700 rounded text-neutral-200">
                            {secId}
                          </span>
                          <span className="text-neutral-400">第 {slot.dayIndex} 讲</span>
                          {draftSplitPlan.length > 0 && (
                            <>
                              <select
                                aria-label={`${secId} 绑定第 1 步 PDF 区域`}
                                value={slot.regionId || ''}
                                onChange={(e) => handleSelectSlotRegion(idx, e.target.value)}
                                className="bg-black border border-neutral-800 rounded px-2 py-0.5 text-xs font-mono text-neutral-200"
                              >
                                <option value="">（未绑定切分区域 / 使用全局资料）</option>
                                {draftSplitPlan.map((r) => (
                                  <option key={r.sectionId} value={r.sectionId}>
                                    区域 {r.sectionId} · {r.sectionTitle} (物理 p.{r.physicalStartPage}–{r.physicalEndPage}
                                    {r.status === 'sliced' ? ' · 已切割' : ''})
                                  </option>
                                ))}
                              </select>
                              {(() => {
                                const effectiveSlot = effectiveSlots[idx] || slot;
                                const allSegs = resolveSlotPdfSegments(effectiveSlot, draftSplitPlan);
                                const primaryId = slot.regionId || allSegs[0]?.sectionId;
                                return allSegs
                                  .filter((seg) => seg.sectionId !== primaryId)
                                  .map((seg) => (
                                    <span
                                      key={seg.sectionId}
                                      className="px-1.5 py-0.5 rounded border border-sky-800/60 bg-sky-950/30 text-sky-300 text-[11px]"
                                      title="该合并区域将随本讲一并关联"
                                    >
                                      + {seg.sectionId} (p.{seg.physicalStartPage}–{seg.physicalEndPage})
                                    </span>
                                  ));
                              })()}
                            </>
                          )}
                          {slot.lesson && (
                            <span className="text-emerald-400">· 已有课件（受保护）</span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveSectionFromOutline(idx)}
                          disabled={draftSlots.length <= 1 || Boolean(slot.lesson)}
                          title={
                            slot.lesson
                              ? '已生成课件的小节不可直接删除，避免丢失课件'
                              : '移除该小节'
                          }
                          className="text-neutral-500 hover:text-red-400 disabled:opacity-30 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] text-neutral-500 mb-1">
                            小节教学主题 (Title)
                          </label>
                          <input
                            type="text"
                            value={slot.title}
                            onChange={(e) => handleUpdateSlotField(idx, 'title', e.target.value)}
                            className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-neutral-500 mb-1">
                            本节学习目标 (Objective)
                          </label>
                          <input
                            type="text"
                            value={slot.objective}
                            onChange={(e) => handleUpdateSlotField(idx, 'objective', e.target.value)}
                            className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-neutral-200"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] text-neutral-500 mb-1">
                            知识范围与核心知识点（用顿号或逗号分隔）
                          </label>
                          <input
                            type="text"
                            value={(slot.keyTopics || []).join('、')}
                            onChange={(e) =>
                              handleUpdateSlotField(
                                idx,
                                'keyTopics',
                                e.target.value
                                  .split(/[、,，]/)
                                  .map((s) => s.trim())
                                  .filter(Boolean)
                              )
                            }
                            className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-neutral-300"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-neutral-500 mb-1">
                            先修知识要求（用顿号或逗号分隔）
                          </label>
                          <input
                            type="text"
                            value={(slot.prerequisites || []).join('、')}
                            onChange={(e) =>
                              handleUpdateSlotField(
                                idx,
                                'prerequisites',
                                e.target.value
                                  .split(/[、,，]/)
                                  .map((s) => s.trim())
                                  .filter(Boolean)
                              )
                            }
                            className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-neutral-300"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-neutral-800">
              {showAdvancedWorkflowDetails ? (
                <button
                  type="button"
                  onClick={handleAddSectionToOutline}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>新增一节课程安排</span>
                </button>
              ) : (
                <div className="text-xs text-neutral-500">
                  已简化大纲预览；如需手动增删小节或修改目标，
                  {onOpenSettings ? (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="text-neutral-300 hover:text-white underline underline-offset-4 ml-1"
                    >
                      在设置中开启编辑细节
                    </button>
                  ) : (
                    '可在右下角「设置」中开启编辑细节'
                  )}
                </div>
              )}

              <div className="flex items-center gap-2.5">
                {showAdvancedWorkflowDetails && (
                  <button
                    type="button"
                    onClick={() => handleSaveOutline(false)}
                    disabled={isSavingOutline || draftSlots.length === 0}
                    className="px-3.5 py-2 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors disabled:opacity-50"
                  >
                    仅保存目录草稿
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleSaveOutline(true)}
                  disabled={isSavingOutline || draftSlots.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>
                    {isSavingOutline ? '正在保存确认...' : '确认完整课程大纲并进入第 3 步：生成课件'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== STEP 2: PDF SMART SPLITTING & ENGLISH VOCAB ==================== */}
        {activeStep === 'split_vocab' && (
          <div className="space-y-6">
            {/* Section A: English Course Vocabulary Allocation */}
            {course.category === 'english' && course.englishConfig && (
              <div className="border border-neutral-800 rounded p-4 bg-neutral-950/50 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-900 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      英语课程每节词汇随机分配（本地差集与去重，不依赖 LLM）
                    </h3>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      词库差集：{course.englishConfig.targetBankName} ({course.englishConfig.totalTargetCount}) −{' '}
                      {course.englishConfig.excludedBankName} ({course.englishConfig.excludedCount}) = 实际待学{' '}
                      {course.englishConfig.effectiveWords.length} 词
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-neutral-400">每节目标单词数：</span>
                    {[15, 20, 30, 50].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setDailyWordCountInput(preset)}
                        className={`px-2 py-1 text-xs font-mono rounded border ${
                          dailyWordCountInput === preset
                            ? 'bg-neutral-900 border-white text-white'
                            : 'bg-black border-neutral-800 text-neutral-400'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={dailyWordCountInput}
                      onChange={(e) =>
                        setDailyWordCountInput(Math.max(1, Math.min(200, Number(e.target.value) || 20)))
                      }
                      aria-label="调整每节目标单词数"
                      className="w-16 bg-black border border-neutral-800 rounded px-2 py-1 text-xs font-mono text-white"
                    />
                    <button
                      type="button"
                      onClick={() => handleReallocateEnglishVocab(true)}
                      disabled={isReallocatingVocab}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors disabled:opacity-50"
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                      <span>
                        {isReallocatingVocab
                          ? '正在分配...'
                          : '重新随机分配尚未开始学习的词汇'}
                      </span>
                    </button>
                  </div>
                </div>

                {vocabCoverage && (
                  <div
                    className={`text-xs rounded px-3 py-2 border ${
                      vocabCoverage.isExceedingCapacity
                        ? 'border-amber-800/80 bg-amber-950/30 text-amber-300'
                        : 'border-neutral-800 bg-black text-neutral-300'
                    }`}
                  >
                    {vocabCoverage.message}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-60 overflow-y-auto pr-1">
                  {draftSlots.map((slot) => {
                    const words = slot.assignedWords || [];
                    return (
                      <div
                        key={slot.id}
                        className="border border-neutral-800 rounded p-2.5 bg-black text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between font-mono">
                          <span className="text-white font-sans font-medium">
                            {slot.id} · 第 {slot.dayIndex} 节
                          </span>
                          <span className="text-neutral-400">
                            {words.length} 词 {slot.lesson ? '· 已锁定(已学)' : '· 稳定保存'}
                          </span>
                        </div>
                        <p className="text-neutral-400 font-mono truncate">
                          {words.length > 0
                            ? words.map((w) => w.word).join(', ')
                            : '（词库容量已分配完毕，本节无剩余未分配词）'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Section B: Large PDF Smart Splitting (API / Agent / Chat + Local Script) */}
            <div className="border border-neutral-800 rounded p-4 bg-neutral-950/50 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-900 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    第 1 步：LLM 确定 PDF 划分区域与本地脚本无损切割（segments/region-XX.pdf）
                  </h3>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    结合课程要求与教材目录，先由 LLM（API / Agent / Chat）规划划分区域 (split-plan.json)，再由本地脚本无损切出各区域 PDF，供第 2 步生成课程大纲。
                  </p>
                </div>

                {/* Standalone API Split Action (API mode only) + Optional Add */}
                <div className="flex flex-wrap items-center gap-2">
                  {workbenchMode === 'api' && (
                    <button
                      type="button"
                      onClick={handleAiPlanPdfSplit}
                      disabled={isPlanningSplit || isExecutingSplit}
                      className="inline-flex items-center gap-1.5 px-3 py-1 text-xs bg-white text-black font-medium rounded hover:bg-neutral-200 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isPlanningSplit ? 'animate-spin' : ''}`} />
                      <span>
                        {isPlanningSplit
                          ? 'API 正在分析划分区域...'
                          : showAdvancedWorkflowDetails
                            ? 'API 自动规划划分区域'
                            : 'API 自动划分并切割 PDF'}
                      </span>
                    </button>
                  )}

                  {showAdvancedWorkflowDetails && (
                    <button
                      type="button"
                      onClick={handleAddSplitRegion}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>手动新增划分区域</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Printed vs Physical Page Offset Bar (shown only when advanced workflow details enabled) */}
              {showAdvancedWorkflowDetails && (
                <div className="flex flex-wrap items-center justify-between gap-3 bg-black border border-neutral-800 rounded p-3 text-xs">
                  <div className="space-y-0.5">
                    <div className="text-neutral-200 font-medium">
                      可选手动偏移量修正（默认 0；物理页码 = 教材印刷页码 + 偏移量）
                    </div>
                    <div className="text-neutral-500">
                      若需要按书本目录印刷页码批量换算为 PDF 物理页码再手动填写（例如前言占 12 页则填 +12）；否则直接让 AI 依据随附 PDF 原文件物理页划分即可。
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <label htmlFor="pdf-page-offset-input" className="text-neutral-400">
                      偏移量 (页)：
                    </label>
                    <input
                      id="pdf-page-offset-input"
                      type="number"
                      min={-100}
                      max={500}
                      value={pageOffset}
                      onChange={(e) => setPageOffset(Number(e.target.value) || 0)}
                      className="w-20 bg-neutral-950 border border-neutral-700 rounded px-2.5 py-1 text-xs font-mono text-white"
                    />
                    <button
                      type="button"
                      onClick={handleApplyPageOffsetToAll}
                      className="px-3 py-1 bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-700 rounded transition-colors whitespace-nowrap"
                    >
                      按偏移量换算全部物理页码
                    </button>
                  </div>
                </div>
              )}

              {/* Peer Chat / Agent Inline Workbench */}
              {(workbenchMode === 'agent' || splitModeTab === 'agent') && workbenchMode !== 'chat' && (
                <div className="bg-black border border-neutral-800 rounded p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-neutral-300 font-medium">
                    Agent 模式：复制划分提示词（或 .md 文件）交给本地 Agent 写入 <code className="text-neutral-200">segments/split-plan.json</code> 并切割，完成后点击右侧同步即可
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => triggerCopyFeedback('agent-split', agentSplitPrompt)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-black font-medium rounded"
                    >
                      {copiedKey === 'agent-split' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey === 'agent-split' ? '已复制 Agent 划分提示词' : '复制 Agent 划分提示词'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyPromptAsMdFile(
                          'agent-split-md',
                          'agent-split-prompt.md',
                          agentSplitPrompt
                        )
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded"
                    >
                      {copiedKey === 'agent-split-md' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <FileText className="w-3.5 h-3.5" />}
                      <span>{copiedKey === 'agent-split-md' ? '已复制 .md' : '复制 .md 文件'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleInlineAgentSync}
                      disabled={isSyncingAgentInline}
                      className="inline-flex items-center gap-1 px-3 py-1.5 border border-emerald-700/80 hover:border-emerald-400 bg-emerald-950/30 text-emerald-200 rounded"
                    >
                      <FolderSync className={`w-3.5 h-3.5 ${isSyncingAgentInline ? 'animate-spin' : ''}`} />
                      <span>{isSyncingAgentInline ? '正在扫描同步...' : '扫描同步本地 split-plan.json'}</span>
                    </button>
                  </div>
                </div>
              )}

              {(workbenchMode === 'chat' || (workbenchMode === 'api' && splitModeTab === 'chat')) && (
                <div className="bg-black border border-neutral-800 rounded p-3.5 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-neutral-300 font-medium">
                      第 1 步（Chat 模式）：① 复制原 PDF ➔ ② 复制划分提示词（或 .md 文件）➔ ③ 粘贴 AI 输出（自动切分并进入第 2 步）
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {pdfMetas.slice(0, 2).map((pm) => (
                        <button
                          key={pm.fileName}
                          type="button"
                          onClick={() =>
                            handleCopyCourseFile(`sources/${pm.fileName}`, `copy-src-split-${pm.fileName}`)
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                          title="将原 PDF 文件复制到系统剪贴板，等效 Ctrl+C"
                        >
                          {copiedKey === `copy-src-split-${pm.fileName}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {copiedKey === `copy-src-split-${pm.fileName}`
                              ? '已复制 PDF 文件'
                              : `复制原 PDF (${pm.fileName})`}
                          </span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => triggerCopyFeedback('chat-split', chatSplitPrompt)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-black font-medium rounded hover:bg-neutral-200"
                      >
                        {copiedKey === 'chat-split' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === 'chat-split' ? '已复制区域划分提示词' : '复制区域划分提示词'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyPromptAsMdFile(
                            'chat-split-md',
                            'pdf-split-prompt.md',
                            chatSplitPrompt
                          )
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                        title="将第 1 步划分提示词保存为 .md 文件并复制到系统剪贴板"
                      >
                        {copiedKey === 'chat-split-md' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <FileText className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedKey === 'chat-split-md' ? '已复制 .md' : '复制 .md 文件'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handlePasteAndImportSplitPlan}
                        disabled={isExecutingSplit}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-400 text-black font-medium rounded hover:bg-sky-300 disabled:opacity-50"
                      >
                        <Scissors className="w-3.5 h-3.5" />
                        <span>{isExecutingSplit ? '正在导入并切割...' : '粘贴 AI 输出并自动切割 →'}</span>
                      </button>
                      <label className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded cursor-pointer transition-colors">
                        <Upload className="w-3.5 h-3.5" />
                        <span>导入 JSON 文件</span>
                        <input
                          type="file"
                          accept=".json,.txt,.md"
                          onChange={handleImportSplitJsonFile}
                          disabled={isExecutingSplit}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  {splitRepairState && (
                    <div className="border border-red-900/60 bg-red-950/25 rounded p-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-0.5 text-red-200">
                        <div className="flex items-center gap-2 font-medium">
                          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                          <span>
                            PDF 划分 JSON 解析失败
                            {splitRepairState.salvagedCount > 0
                              ? `（已自动抢救保留前 ${splitRepairState.salvagedCount} 个完整区域！无需重输出全文）`
                              : ''}
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-300">
                          {splitRepairState.error}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => triggerCopyFeedback('split-repair', splitRepairState.repairPrompt)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white text-black font-medium rounded"
                        >
                          {copiedKey === 'split-repair' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                          <span>
                            {copiedKey === 'split-repair'
                              ? '已复制增量修复提示词'
                              : splitRepairState.salvagedCount > 0
                              ? '复制增量续写/修复提示词'
                              : '复制局部修复提示词'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyPromptAsMdFile(
                              'split-repair-md',
                              'pdf-split-repair-prompt.md',
                              splitRepairState.repairPrompt
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-700 text-neutral-200 rounded"
                        >
                          <FileText className="w-3 h-3" />
                          <span>复制修复 .md 文件</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {showSplitFallbackPaste && (
                    <div className="space-y-2 pt-2 border-t border-neutral-900">
                      <textarea
                        rows={3}
                        value={rawSplitImport}
                        onChange={(e) => setRawSplitImport(e.target.value)}
                        placeholder='剪贴板权限受限时可在此按 Ctrl+V 粘贴 PDF 划分 JSON...'
                        className="w-full bg-neutral-950 border border-neutral-800 rounded p-2.5 font-mono text-neutral-200"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setShowSplitFallbackPaste(false)}
                          className="px-2.5 py-1 border border-neutral-800 text-neutral-400 rounded"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => handleImportChatSplitPlan()}
                          disabled={isExecutingSplit || !rawSplitImport.trim()}
                          className="px-3.5 py-1 bg-white text-black font-medium rounded disabled:opacity-50"
                        >
                          {isExecutingSplit ? '正在导入并切割 PDF...' : '导入并自动切割 PDF'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Split Plan Preview (Streamlined) or Editable Table (Advanced) */}
              <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                {draftSplitPlan.length === 0 ? (
                  <div className="border border-dashed border-neutral-800 rounded p-5 text-center text-xs text-neutral-500">
                    尚未配置 PDF 划分区域。请点击上方“LLM 自动规划 PDF 划分区域”或通过 Agent / Chat 导入方案
                    {showAdvancedWorkflowDetails ? '，或点击“手动新增划分区域”' : ''}。
                  </div>
                ) : !showAdvancedWorkflowDetails ? (
                  draftSplitPlan.map((item) => {
                    const isSliced = item.status === 'sliced';
                    const segRel = `segments/${item.segmentFileName || `${item.sectionId}.pdf`}`;
                    return (
                      <div
                        key={item.sectionId}
                        className="border border-neutral-800 rounded p-3 bg-black flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <span className="px-2 py-0.5 bg-neutral-900 border border-neutral-700 rounded text-white font-mono">
                            {item.sectionId}
                          </span>
                          <span
                            className="font-medium text-white truncate"
                            dangerouslySetInnerHTML={{
                              __html: renderInlineMathWithLatex(item.sectionTitle),
                            }}
                          />
                          <span className="text-neutral-500 font-mono">
                            (第 {item.physicalStartPage}–{item.physicalEndPage} 页)
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono ${
                              isSliced ? 'text-emerald-400' : 'text-neutral-500'
                            }`}
                          >
                            {isSliced ? '已切分' : '待切割'}
                          </span>
                          {isSliced && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyCourseFile(segRel, `copy-seg-step1-${item.sectionId}`)
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                                title="将本区域 PDF 文件复制到系统剪贴板，等效资源管理器 Ctrl+C"
                              >
                                {copiedKey === `copy-seg-step1-${item.sectionId}` ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>
                                  {copiedKey === `copy-seg-step1-${item.sectionId}`
                                    ? '已复制文件'
                                    : '复制 PDF 文件'}
                                </span>
                              </button>
                              <a
                                href={`/api/courses/${course.id}/segments/${item.sectionId}/pdf`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-700 rounded transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>打开/导出 PDF</span>
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  draftSplitPlan.map((item, idx) => {
                    const isSliced = item.status === 'sliced';
                    const isSlicingThis = slicingSectionId === item.sectionId;
                    const segRel = `segments/${item.segmentFileName || `${item.sectionId}.pdf`}`;
                    return (
                      <div
                        key={item.sectionId}
                        className="border border-neutral-800 rounded p-3 bg-black flex flex-col gap-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 font-mono flex-1 min-w-0">
                            <span className="px-2 py-0.5 bg-neutral-900 border border-neutral-700 rounded text-white shrink-0">
                              {item.sectionId}
                            </span>
                            <input
                              type="text"
                              value={item.sectionTitle}
                              onChange={(e) =>
                                handleUpdateSplitItem(idx, 'sectionTitle', e.target.value)
                              }
                              aria-label={`${item.sectionId} 区域标题`}
                              className="bg-neutral-950 border border-neutral-800 rounded px-2 py-0.5 text-xs font-sans font-medium text-white min-w-[200px] flex-1 max-w-sm"
                            />
                            <span className="text-neutral-500 shrink-0">
                              · 源文件: {item.sourceFileName}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span
                              className={`font-mono ${
                                isSliced ? 'text-emerald-400' : 'text-neutral-500'
                              }`}
                            >
                              {isSliced
                                ? `已切分: ${item.segmentFileName} (${item.segmentPageCount || item.physicalEndPage - item.physicalStartPage + 1}页)`
                                : '待执行本地切割'}
                            </span>

                            <button
                              type="button"
                              onClick={() => handleExecuteLocalPdfSplit(item.sectionId)}
                              disabled={isSlicingThis || isExecutingSplit}
                              className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                            >
                              <Scissors className="w-3 h-3" />
                              <span>{isSlicingThis ? '切割中...' : '单独切割该区域'}</span>
                            </button>

                            {isSliced && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleCopyCourseFile(segRel, `copy-seg-adv-${item.sectionId}`)
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                                  title="将本区域 PDF 复制到系统剪贴板，等效资源管理器 Ctrl+C"
                                >
                                  {copiedKey === `copy-seg-adv-${item.sectionId}` ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                  <span>
                                    {copiedKey === `copy-seg-adv-${item.sectionId}`
                                      ? '已复制文件'
                                      : '复制 PDF'}
                                  </span>
                                </button>
                                <a
                                  href={`/api/courses/${course.id}/segments/${item.sectionId}/pdf`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-700 rounded transition-colors"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>打开/导出 PDF</span>
                                </a>
                              </>
                            )}

                            <button
                              type="button"
                              onClick={() => handleRemoveSplitRegion(idx)}
                              aria-label={`删除区域 ${item.sectionId}`}
                              className="p-1 text-neutral-500 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 pt-1">
                          <div>
                            <label className="block text-[11px] text-neutral-500 mb-0.5">
                              教材印刷页码范围 (起 ~ 止)
                            </label>
                            <div className="flex items-center gap-1 font-mono">
                              <input
                                type="number"
                                min={1}
                                value={item.printedStartPage ?? item.physicalStartPage}
                                onChange={(e) =>
                                  handleUpdateSplitItem(idx, 'printedStartPage', Number(e.target.value))
                                }
                                aria-label={`${item.sectionId} 印刷起始页`}
                                className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-neutral-200"
                              />
                              <span className="text-neutral-500">~</span>
                              <input
                                type="number"
                                min={1}
                                value={item.printedEndPage ?? item.physicalEndPage}
                                onChange={(e) =>
                                  handleUpdateSplitItem(idx, 'printedEndPage', Number(e.target.value))
                                }
                                aria-label={`${item.sectionId} 印刷结束页`}
                                className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-neutral-200"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] text-neutral-300 mb-0.5">
                              PDF 物理页码范围 (实际切割依据)
                            </label>
                            <div className="flex items-center gap-1 font-mono">
                              <input
                                type="number"
                                min={1}
                                value={item.physicalStartPage}
                                onChange={(e) =>
                                  handleUpdateSplitItem(idx, 'physicalStartPage', Number(e.target.value))
                                }
                                aria-label={`${item.sectionId} 物理起始页`}
                                className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-white"
                              />
                              <span className="text-neutral-500">~</span>
                              <input
                                type="number"
                                min={1}
                                value={item.physicalEndPage}
                                onChange={(e) =>
                                  handleUpdateSplitItem(idx, 'physicalEndPage', Number(e.target.value))
                                }
                                aria-label={`${item.sectionId} 物理结束页`}
                                className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-white"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] text-neutral-500 mb-0.5">
                              跨章节/前置参考物理页 (逗号分隔)
                            </label>
                            <input
                              type="text"
                              value={(item.crossRefPages || []).join(', ')}
                              onChange={(e) =>
                                handleUpdateSplitItem(
                                  idx,
                                  'crossRefPages',
                                  e.target.value
                                    .split(/[,，\s]+/)
                                    .map(Number)
                                    .filter((n) => !Number.isNaN(n) && n > 0)
                                )
                              }
                              placeholder="例如: 2, 5"
                              className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 font-mono text-neutral-300"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] text-neutral-500 mb-0.5">
                              区域知识范围说明 (用于第 2 步生成大纲)
                            </label>
                            <input
                              type="text"
                              value={item.outlineMappingNote || ''}
                              onChange={(e) =>
                                handleUpdateSplitItem(idx, 'outlineMappingNote', e.target.value)
                              }
                              className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-neutral-300"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-neutral-800">
                {showAdvancedWorkflowDetails ? (
                  <span className="text-xs text-neutral-500">
                    切分后的区域 PDF 保存在 <code className="text-neutral-300">{courseRelDir}/segments/region-XX.pdf</code>，原始 PDF 在 <code className="text-neutral-300">sources/</code> 下保持不变。
                  </span>
                ) : (
                  <span className="text-xs text-neutral-500">
                    已简化切分视图（隐藏页码偏移与手动编辑）；
                    {onOpenSettings ? (
                      <button
                        type="button"
                        onClick={onOpenSettings}
                        className="text-neutral-300 hover:text-white underline underline-offset-4 ml-1"
                      >
                        在设置中开启切分细节
                      </button>
                    ) : (
                      '可在右下角「设置」中开启切分细节'
                    )}
                  </span>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {showAdvancedWorkflowDetails && (
                    <button
                      type="button"
                      onClick={handleSaveSplitPlanOnly}
                      disabled={draftSplitPlan.length === 0}
                      className="px-3 py-2 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors disabled:opacity-50"
                    >
                      保存区域方案
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleExecuteLocalPdfSplit()}
                    disabled={isExecutingSplit || draftSplitPlan.length === 0}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded transition-colors disabled:opacity-50 ${
                      slicedRegionCount > 0
                        ? 'border border-neutral-700 hover:border-neutral-500 text-neutral-200'
                        : 'font-medium bg-white text-black hover:bg-neutral-200'
                    }`}
                  >
                    <Scissors className="w-3.5 h-3.5" />
                    <span>
                      {isExecutingSplit
                        ? '正在调用本地脚本切割 PDF...'
                        : slicedRegionCount > 0
                          ? '重新切割全部区域 PDF'
                          : '执行本地脚本切割全部区域 PDF'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveStep('outline')}
                    className={`px-4 py-2 text-xs rounded transition-colors ${
                      slicedRegionCount > 0
                        ? 'font-medium bg-white text-black hover:bg-neutral-200'
                        : 'border border-neutral-700 hover:border-neutral-500 text-neutral-200'
                    }`}
                  >
                    进入第 2 步：LLM 生成课程大纲 →
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== STEP 3: QUICK SECTION MATERIALS & LESSON GENERATION ==================== */}
        {activeStep === 'lessons' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-950/60 border border-neutral-900 rounded p-3.5 text-xs">
              <div className="space-y-1">
                <div className="text-white font-medium">
                  第 3 步：按大纲顺序逐节由 LLM 生成课件（lessons/sec-XX.json）
                </div>
                <div className="text-neutral-500">
                  每节自动关联第 1 步切分出的区域 PDF 与第 2 步大纲目标，并在写完课件时评估预计学习时长；进入任一小节后支持“保存并连续进入下一讲”。
                  {draftSlots.length > 0 && (() => {
                    const assessedCount = draftSlots.filter(
                      (s) => getEvaluatedSectionMinutes(s) !== undefined
                    ).length;
                    const totalMins = draftSlots.reduce(
                      (sum, s) => sum + (getEvaluatedSectionMinutes(s) || 0),
                      0
                    );
                    return (
                      <span>
                        {assessedCount > 0
                          ? ` · 已评估学时 ${assessedCount}/${draftSlots.length} 节（共 ${totalMins} 分钟）· 排程 ${draftDurationDays} 天`
                          : ` · 学时将在逐节生成课件时评估（当前目标 ${draftDurationDays} 天）`}
                      </span>
                    );
                  })()}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {workbenchMode === 'api' && (
                  <button
                    type="button"
                    onClick={handleGenerateAllRemainingApi}
                    disabled={
                      isGeneratingBatch ||
                      generatingDayIndex !== null ||
                      draftSlots.every((s) => Boolean(s.lesson))
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingBatch ? 'animate-spin' : ''}`} />
                    <span>
                      {isGeneratingBatch
                        ? `API 正在生成第 ${generatingDayIndex} 节 (${generatingDayProgress?.percent ?? 0}%)`
                        : 'API 按序生成全部未完成小节'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleInlineAgentSync}
                  disabled={isSyncingAgentInline}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <FolderSync className={`w-3.5 h-3.5 ${isSyncingAgentInline ? 'animate-spin' : ''}`} />
                  <span>{isSyncingAgentInline ? '正在扫描同步...' : '扫描同步本地 Agent 课件'}</span>
                </button>

                {(() => {
                  const firstPending = draftSlots.find((s) => !s.lesson) || draftSlots[0];
                  return firstPending ? (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenLesson(course.id, firstPending.dayIndex);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium border border-neutral-700 hover:border-neutral-500 text-neutral-100 hover:text-white rounded transition-colors whitespace-nowrap"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>
                        {firstPending.lesson
                          ? `进入第 ${firstPending.dayIndex} 讲阅读 →`
                          : `进入第 ${firstPending.dayIndex} 讲工作台 →`}
                      </span>
                    </button>
                  ) : null;
                })()}
              </div>
            </div>

            {/* Deterministic Study Load & Day Reallocation Bar (Step 3) */}
            {draftSlots.length > 0 && (() => {
              const assessedCount = draftSlots.filter(
                (s) => getEvaluatedSectionMinutes(s) !== undefined
              ).length;
              const totalMinutes = draftSlots.reduce(
                (sum, s) => sum + (getEvaluatedSectionMinutes(s) || 0),
                0
              );
              const safeDays = Math.max(1, Number(draftDurationDays) || 1);
              const targetPerDay = assessedCount > 0 ? Math.round(totalMinutes / safeDays) : null;
              return (
                <div className="flex flex-wrap items-center justify-between gap-3 bg-black border border-neutral-800 rounded p-3 text-xs">
                  <div className="space-y-0.5">
                    <div className="text-neutral-200 font-medium">
                      {assessedCount > 0
                        ? `学时负荷与确定性排期：已评估 ${assessedCount}/${draftSlots.length} 节 · 累计 ${totalMinutes} 分钟 · 目标每日基准约 ${targetPerDay} 分钟`
                        : `学时负荷与确定性排期：共 ${draftSlots.length} 个独立小节 · 尚未写完课件评估学时（生成后将按实际学时均衡排程）`}
                    </div>
                    <div className="text-neutral-500">
                      写完具体课件时评估各小节耗时，再由本地算法按总学时连续分配到目标天数；随时修改天数并重排，已生成课件零重做。
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 text-neutral-400">
                      <span>开课</span>
                      <input
                        type="date"
                        value={draftStartDate}
                        onChange={(e) => setDraftStartDate(e.target.value)}
                        className="bg-neutral-950 border border-neutral-800 rounded px-2 py-1 font-mono text-neutral-200"
                      />
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-neutral-400">
                      <span>天数</span>
                      <input
                        type="number"
                        min={1}
                        max={180}
                        value={draftDurationDays}
                        onChange={(e) =>
                          setDraftDurationDays(Math.max(1, Number(e.target.value) || 1))
                        }
                        aria-label="目标学习天数"
                        className="w-16 bg-neutral-950 border border-neutral-800 rounded px-2 py-1 font-mono text-white text-center"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleReallocateSchedule}
                      disabled={isReallocatingSchedule}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-sky-700/80 bg-sky-950/40 hover:bg-sky-900/50 text-sky-200 font-medium rounded transition-colors disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isReallocatingSchedule ? 'animate-spin' : ''}`}
                      />
                      <span>
                        {isReallocatingSchedule ? '正在按学时分配...' : '按学时重排学习天数'}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })()}

            {generatingDayIndex !== null && generatingDayProgress && (
              <div className="border border-sky-800/70 bg-sky-950/20 rounded p-3 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sky-100 font-medium">
                    第 {generatingDayIndex} 讲实时流式生成：{generatingDayProgress.message}
                  </span>
                  <span className="font-mono text-sky-200">
                    {generatingDayProgress.percent}%
                    {typeof generatingDayProgress.charsReceived === 'number'
                      ? ` · ${generatingDayProgress.charsReceived.toLocaleString()} 字符`
                      : ''}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-neutral-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-400 transition-all duration-200"
                    style={{ width: `${Math.max(2, Math.min(100, generatingDayProgress.percent))}%` }}
                  />
                </div>
              </div>
            )}

            {/* ==================== STEP 3 WORKBENCH: TWO-STAGE CHAT / AGENT / API ==================== */}
            {selectedStep3Slot && (() => {
              const secId = ensureStableSectionId(selectedStep3Slot.dayIndex, selectedStep3Slot.id);
              const boundSegs = resolveSlotPdfSegments(selectedStep3Slot, draftSplitPlan);
              const slicedSegs = boundSegs.filter(
                (item) =>
                  item.status === 'sliced' ||
                  Boolean(item.segmentRelPath || item.segmentFileName)
              );
              const hasStage1 = Boolean(selectedStep3Slot.stage1Draft || selectedStep3Slot.lesson);
              const hasFinalLesson = Boolean(selectedStep3Slot.lesson);
              const modeBadgeLabel =
                workbenchMode === 'agent'
                  ? 'Agent 工作台'
                  : workbenchMode === 'api'
                  ? 'API 工作台'
                  : 'Chat 模式工作台';

              return (
              <div
                data-testid="step3-chat-workbench"
                className="border border-neutral-800 bg-neutral-950/90 rounded-lg p-4 space-y-3.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-900 pb-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 bg-white text-black font-mono font-semibold rounded text-[11px]">
                        {modeBadgeLabel}
                      </span>
                      <span className="font-semibold text-white text-sm">
                        当前目标小节：{secId}（第 {selectedStep3Slot.dayIndex} 讲）
                      </span>
                      {boundSegs.map((seg) => (
                        <span
                          key={seg.sectionId}
                          className="font-mono text-[11px] px-2 py-0.5 rounded border border-neutral-800 bg-black text-neutral-300"
                        >
                          {seg.segmentFileName || `${seg.sectionId}.pdf`} (p.{seg.physicalStartPage}–{seg.physicalEndPage})
                        </span>
                      ))}
                      {pdfCoverageStats.totalRegions > 0 && (
                        <span
                          data-testid="step3-region-coverage"
                          className={`font-mono text-[11px] px-2 py-0.5 rounded border ${
                            pdfCoverageStats.uncoveredIds.length === 0
                              ? 'border-sky-800/70 bg-sky-950/30 text-sky-300'
                              : 'border-amber-800/70 bg-amber-950/40 text-amber-300'
                          }`}
                        >
                          PDF 区域覆盖 {pdfCoverageStats.coveredCount}/{pdfCoverageStats.totalRegions}
                          {pdfCoverageStats.uncoveredIds.length > 0
                            ? `（未绑定: ${pdfCoverageStats.uncoveredIds.join(', ')}）`
                            : ' · 100%'}
                        </span>
                      )}
                      <span
                        data-testid="step3-slot-stage-status"
                        className={`font-mono text-[11px] px-2 py-0.5 rounded border ${
                          hasFinalLesson
                            ? 'border-emerald-800/70 bg-emerald-950/40 text-emerald-300'
                            : hasStage1
                            ? 'border-sky-800/70 bg-sky-950/40 text-sky-300'
                            : 'border-amber-800/70 bg-amber-950/30 text-amber-300'
                        }`}
                      >
                        {hasFinalLesson
                          ? '已完成终稿（支持局部补丁或重跑任意阶段）'
                          : hasStage1
                          ? `阶段一已存${pendingStep3Specs.length > 0 ? ` · ${pendingStep3Specs.length} 张图示待生成` : ' · 待最终保存'}`
                          : '待生成阶段一内容'}
                      </span>
                    </div>
                    <p className="text-neutral-400">
                      两阶段流水线：阶段一专注教学正文、推导与图示规格 ➔ 阶段二仅按图示规格生成 SVG 并自动组装（无需重复上传 PDF）；任一阶段失败可单独重试且不丢失另一阶段成果。
                    </p>
                  </div>

                  {/* 快速切换小节选择器 */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {effectiveSlots.map((s) => {
                      const sId = ensureStableSectionId(s.dayIndex, s.id);
                      const isSelected = s.dayIndex === selectedStep3Slot.dayIndex;
                      const segs = resolveSlotPdfSegments(s, draftSplitPlan);
                      const regionBadge = segs
                        .map((seg) => seg.sectionId.replace(/^region-/i, 'R'))
                        .join('+');
                      return (
                        <button
                          key={sId}
                          type="button"
                          data-testid={`step3-chat-tab-${s.dayIndex}`}
                          title={
                            segs.length > 0
                              ? `${sId} · ${s.title}（绑定 ${segs.map((seg) => seg.segmentFileName || `${seg.sectionId}.pdf`).join(' + ')}）`
                              : `${sId} · ${s.title}`
                          }
                          onClick={() => {
                            setSelectedStep3ChatDay(s.dayIndex);
                            setStep3ImportNotice(null);
                          }}
                          className={`px-2 py-1 rounded font-mono text-[11px] border transition-colors inline-flex items-center gap-1 ${
                            isSelected
                              ? 'bg-white text-black border-white font-semibold'
                              : s.lesson
                              ? 'bg-emerald-950/30 text-emerald-300 border-emerald-800/60 hover:border-emerald-500'
                              : s.stage1Draft
                              ? 'bg-sky-950/30 text-sky-300 border-sky-800/60 hover:border-sky-500'
                              : 'bg-black text-neutral-300 border-neutral-800 hover:border-neutral-600'
                          }`}
                        >
                          <span>{sId}</span>
                          {regionBadge && (
                            <span className="text-[10px] opacity-75">[{regionBadge}]</span>
                          )}
                          <span>{s.lesson ? '✓' : s.stage1Draft ? '①' : '·'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Agent 模式本地两阶段执行栏 */}
                {workbenchMode === 'agent' && (
                  <div
                    data-testid="step3-agent-panel"
                    className="border border-sky-900/60 bg-sky-950/15 rounded p-3 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="text-sky-200 font-semibold">
                          Agent 两阶段本地执行指引（{courseRelDir}/lessons/{secId}.stage1.json ➔ {secId}.json）
                        </div>
                        <div className="text-[11px] text-neutral-400">
                          Agent 在本地读取对应分段 PDF 与上下文，先写出 stage1 JSON，再仅根据 stage1 中的图示规格生成 SVG 并合并为最终课件。
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopySectionStagePrompt(selectedStep3Slot.dayIndex, 'agent_full', false)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                        >
                          {copiedKey === `agent_full-${selectedStep3Slot.dayIndex}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>复制全课程 Agent 总指令</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopySectionStagePrompt(selectedStep3Slot.dayIndex, 'agent_full', true)}
                          className="inline-flex items-center gap-1 px-2 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                        >
                          {copiedKey === `agent_full-md-${selectedStep3Slot.dayIndex}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <FileText className="w-3.5 h-3.5" />
                          )}
                          <span>总指令 .md</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopySectionStagePrompt(selectedStep3Slot.dayIndex, 'agent_stage1', false)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white text-black hover:bg-neutral-200 font-medium rounded transition-colors"
                        >
                          {copiedKey === `agent_stage1-${selectedStep3Slot.dayIndex}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>复制本节阶段一指令</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopySectionStagePrompt(selectedStep3Slot.dayIndex, 'agent_stage1', true)}
                          className="inline-flex items-center gap-1 px-2 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                        >
                          {copiedKey === `agent_stage1-md-${selectedStep3Slot.dayIndex}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <FileText className="w-3.5 h-3.5" />
                          )}
                          <span>阶段一 .md</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopySectionStagePrompt(selectedStep3Slot.dayIndex, 'agent_stage2', false)}
                          disabled={!hasStage1}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-sky-700/80 hover:border-sky-400 bg-sky-950/40 text-sky-200 rounded transition-colors disabled:opacity-45"
                        >
                          {copiedKey === `agent_stage2-${selectedStep3Slot.dayIndex}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>复制本节阶段二 SVG 指令</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopySectionStagePrompt(selectedStep3Slot.dayIndex, 'agent_stage2', true)}
                          disabled={!hasStage1}
                          className="inline-flex items-center gap-1 px-2 py-1.5 border border-sky-700/80 hover:border-sky-400 text-sky-200 rounded transition-colors disabled:opacity-45"
                        >
                          {copiedKey === `agent_stage2-md-${selectedStep3Slot.dayIndex}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <FileText className="w-3.5 h-3.5" />
                          )}
                          <span>阶段二 .md</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleInlineAgentSync}
                          disabled={isSyncingAgentInline}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-emerald-700/80 hover:border-emerald-400 bg-emerald-950/30 text-emerald-200 rounded transition-colors disabled:opacity-50"
                        >
                          <FolderSync className={`w-3.5 h-3.5 ${isSyncingAgentInline ? 'animate-spin' : ''}`} />
                          <span>{isSyncingAgentInline ? '扫描同步中...' : '同步磁盘成果'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 精简统一工作台（零标签 / 无多余文本框 / 自动识别导入） */}
                <div className="space-y-3" data-testid="step3-unified-workbench">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-black border border-neutral-900 rounded p-3">
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[11px] font-medium ${
                            autoStep3Stage === 'repair'
                              ? 'bg-red-950/60 border border-red-800/80 text-red-200'
                              : autoStep3Stage === 'stage2'
                              ? 'bg-sky-950/60 border border-sky-700/80 text-sky-200'
                              : autoStep3Stage === 'complete'
                              ? 'bg-emerald-950/60 border border-emerald-700/80 text-emerald-200'
                              : 'bg-white text-black'
                          }`}
                        >
                          {autoStep3Stage === 'repair'
                            ? '检测到异常 · 等待局部修复'
                            : autoStep3Stage === 'stage2'
                            ? `当前：阶段二 · SVG 图示（待绘 ${pendingStep3Specs.length} 张）`
                            : autoStep3Stage === 'complete'
                            ? '当前：已完成终稿（可直接粘贴补丁/重跑）'
                            : '当前：阶段一 · 教学正文与图示规格'}
                        </span>
                        <span
                          className="text-neutral-200 font-medium truncate"
                          dangerouslySetInnerHTML={{
                            __html: renderInlineMathWithLatex(selectedStep3Slot.title),
                          }}
                        />
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        {autoStep3Stage === 'stage2'
                          ? '无需重复上传 PDF，直接复制阶段二提示词（或 .md 文件）发给 AI，再点击粘贴自动组装并跳转下一节。'
                          : '依次完成「① 复制源文件 → ② 复制提示词（或 .md）→ ③ 粘贴 AI 输出」，系统将自动识别阶段一/阶段二/补丁并推进。'}
                      </div>
                    </div>

                    {workbenchMode === 'api' && (
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono shrink-0">
                        <button
                          type="button"
                          onClick={() => handleGenerateSingleSectionApi(selectedStep3Slot.dayIndex, 'stage1')}
                          disabled={generatingDayIndex !== null || isGeneratingBatch}
                          className="px-2.5 py-1 border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded disabled:opacity-50"
                          title="通过 API 仅重跑或生成阶段一（保留既有终稿直至新内容保存，失败不清空）"
                        >
                          API 仅执行阶段一
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGenerateSingleSectionApi(selectedStep3Slot.dayIndex, 'stage2')}
                          disabled={!hasStage1 || generatingDayIndex !== null || isGeneratingBatch}
                          className="px-2.5 py-1 border border-sky-800/80 hover:border-sky-500 text-sky-300 hover:text-white rounded disabled:opacity-45"
                          title="仅基于阶段一规格通过 API 重跑或生成阶段二 SVG（不重写阶段一正文）"
                        >
                          API 仅执行阶段二 SVG
                        </button>
                      </div>
                    )}
                  </div>

                  {pendingStep3Specs.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {pendingStep3Specs.map((spec) => (
                        <div
                          key={spec.id}
                          className="border border-sky-900/50 bg-black rounded px-2.5 py-2 space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                            <span className="text-sky-300 font-semibold">{spec.id}</span>
                            <span className="text-neutral-400 truncate">{spec.title}</span>
                          </div>
                          <div className="text-[11px] text-neutral-400 line-clamp-2">
                            {spec.topologySpec || spec.caption || '待绘制图示'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 bg-black border border-neutral-900 rounded p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {slicedSegs.length > 0 ? (
                        slicedSegs.map((seg) => {
                          const segId = seg.sectionId || secId;
                          const fileName = seg.segmentFileName || `${segId}.pdf`;
                          const copyKey = `copy-seg-workbench-${secId}-${segId}`;
                          return (
                            <button
                              key={segId}
                              type="button"
                              onClick={() => handleCopyCourseFile(`segments/${fileName}`, copyKey)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 border rounded transition-colors whitespace-nowrap ${
                                autoStep3Stage === 'stage2'
                                  ? 'border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200'
                                  : 'border-neutral-700 hover:border-neutral-500 text-neutral-100'
                              }`}
                              title={`将切分 PDF (${fileName}，物理第 ${seg.physicalStartPage}~${seg.physicalEndPage} 页) 复制到系统剪贴板`}
                            >
                              {copiedKey === copyKey ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              <span>
                                {copiedKey === copyKey
                                  ? `已复制 ${slicedSegs.length > 1 ? fileName : '小节 PDF'}`
                                  : `① 复制 ${slicedSegs.length > 1 ? fileName : '小节 PDF'}`}
                              </span>
                            </button>
                          );
                        })
                      ) : pdfMetas[0] ? (
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyCourseFile(
                              `sources/${pdfMetas[0].fileName}`,
                              `copy-src-workbench-${secId}`
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-100 rounded transition-colors whitespace-nowrap"
                        >
                          {copiedKey === `copy-src-workbench-${secId}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {copiedKey === `copy-src-workbench-${secId}`
                              ? '已复制原教材 PDF'
                              : '① 复制原教材 PDF'}
                          </span>
                        </button>
                      ) : null}

                      {autoStep3Stage === 'stage2' ? (
                        <>
                          <button
                            type="button"
                            data-testid="step3-copy-stage2-prompt-btn"
                            onClick={() =>
                              handleCopySectionStagePrompt(selectedStep3Slot.dayIndex, 'stage2', false)
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-black hover:bg-neutral-200 font-medium rounded transition-colors whitespace-nowrap"
                          >
                            {copiedKey === `stage2-${selectedStep3Slot.dayIndex}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {copiedKey === `stage2-${selectedStep3Slot.dayIndex}`
                                ? '已复制阶段二提示词'
                                : '② 复制阶段二 SVG 提示词'}
                            </span>
                          </button>
                          <button
                            type="button"
                            data-testid="step3-copy-stage2-prompt-md-btn"
                            onClick={() =>
                              handleCopySectionStagePrompt(selectedStep3Slot.dayIndex, 'stage2', true)
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                            title="将阶段二提示词保存为 .md 文件并复制到系统剪贴板"
                          >
                            {copiedKey === `stage2-md-${selectedStep3Slot.dayIndex}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <FileText className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {copiedKey === `stage2-md-${selectedStep3Slot.dayIndex}`
                                ? '已复制阶段二 .md'
                                : '复制阶段二 .md 文件'}
                            </span>
                          </button>
                          <button
                            type="button"
                            data-testid="step3-chat-copy-prompt-btn"
                            onClick={() =>
                              handleCopySectionStagePrompt(selectedStep3Slot.dayIndex, 'stage1', false)
                            }
                            className="inline-flex items-center gap-1 px-2 py-1.5 border border-neutral-800 hover:border-neutral-600 text-neutral-400 hover:text-neutral-200 rounded transition-colors whitespace-nowrap"
                            title="如需重跑阶段一，可重新复制阶段一提示词"
                          >
                            <Copy className="w-3 h-3" />
                            <span>
                              {copiedKey === `stage1-${selectedStep3Slot.dayIndex}`
                                ? '已复制阶段一'
                                : '重复制阶段一'}
                            </span>
                          </button>
                          <button
                            type="button"
                            data-testid="step3-chat-copy-prompt-md-btn"
                            onClick={() =>
                              handleCopySectionStagePrompt(selectedStep3Slot.dayIndex, 'stage1', true)
                            }
                            className="inline-flex items-center gap-1 px-2 py-1.5 border border-neutral-800 hover:border-neutral-600 text-neutral-400 hover:text-neutral-200 rounded transition-colors whitespace-nowrap"
                            title="复制阶段一 .md 文件"
                          >
                            <FileText className="w-3 h-3" />
                            <span>阶段一 .md</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            data-testid="step3-chat-copy-prompt-btn"
                            onClick={() =>
                              handleCopySectionStagePrompt(selectedStep3Slot.dayIndex, 'stage1', false)
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-black hover:bg-neutral-200 font-medium rounded transition-colors whitespace-nowrap"
                          >
                            {copiedKey === `stage1-${selectedStep3Slot.dayIndex}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {copiedKey === `stage1-${selectedStep3Slot.dayIndex}`
                                ? '已复制阶段一提示词'
                                : '② 复制阶段一提示词'}
                            </span>
                          </button>
                          <button
                            type="button"
                            data-testid="step3-chat-copy-prompt-md-btn"
                            onClick={() =>
                              handleCopySectionStagePrompt(selectedStep3Slot.dayIndex, 'stage1', true)
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                            title="将阶段一提示词保存为 .md 文件并复制到系统剪贴板"
                          >
                            {copiedKey === `stage1-md-${selectedStep3Slot.dayIndex}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <FileText className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {copiedKey === `stage1-md-${selectedStep3Slot.dayIndex}`
                                ? '已复制阶段一 .md'
                                : '复制阶段一 .md 文件'}
                            </span>
                          </button>
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid="step3-chat-clipboard-import-btn"
                        onClick={handleStep3PasteFromClipboard}
                        disabled={isSavingStep3Import}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-sky-400 text-black hover:bg-sky-300 font-medium rounded transition-colors disabled:opacity-50 whitespace-nowrap"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>
                          {isSavingStep3Import
                            ? '正在识别并保存...'
                            : '③ 粘贴 AI 输出（自动识别并推进）'}
                        </span>
                      </button>

                      <label className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white rounded transition-colors cursor-pointer whitespace-nowrap">
                        <Upload className="w-3.5 h-3.5" />
                        <span>导入 JSON 文件</span>
                        <input
                          type="file"
                          data-testid="step3-chat-import-json-file-input"
                          accept=".json,.txt,.md"
                          onChange={handleStep3ImportJsonFile}
                          disabled={isSavingStep3Import}
                          className="hidden"
                        />
                      </label>

                      <button
                        type="button"
                        data-testid="step3-chat-preview-btn"
                        onClick={handlePreviewCurrentStep3Lesson}
                        disabled={
                          !(
                            step3PendingDraft ||
                            selectedStep3Slot.stage1Draft ||
                            selectedStep3Slot.lesson
                          )
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-sky-500 text-neutral-200 hover:text-sky-200 rounded transition-colors disabled:opacity-45 whitespace-nowrap"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>预览课件</span>
                      </button>

                      {(selectedStep3Slot.lesson || selectedStep3Slot.stage1Draft || step3PendingDraft) && (
                        <button
                          type="button"
                          data-testid="step3-reset-to-outline-btn"
                          onClick={() => handleResetSectionToOutline(selectedStep3Slot, workbenchMode === 'api')}
                          disabled={deletingLessonDay === selectedStep3Slot.dayIndex || isGeneratingBatch}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 border rounded transition-colors disabled:opacity-45 whitespace-nowrap ${
                            duplicateLessonDaysByDay.has(selectedStep3Slot.dayIndex)
                              ? 'border-amber-600/80 bg-amber-950/40 text-amber-200 hover:border-amber-400'
                              : 'border-neutral-700 hover:border-amber-500/70 text-neutral-300 hover:text-amber-200'
                          }`}
                          title="清空当前课件与阶段一草稿、恢复大纲原标题，并重新从阶段一开始生成"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>
                            {deletingLessonDay === selectedStep3Slot.dayIndex
                              ? '重置中...'
                              : workbenchMode === 'api'
                                ? '从大纲重新生成 (API)'
                                : '从大纲重新生成'}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {duplicateLessonDaysByDay.has(selectedStep3Slot.dayIndex) && (
                    <div className="bg-amber-950/30 border border-amber-700/70 rounded px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200">
                      <span>
                        ⚠ 检测到当前小节与{' '}
                        {duplicateLessonDaysByDay.get(selectedStep3Slot.dayIndex)!.join('、')}{' '}
                        生成内容重复（可能误导入了其他节）。建议点击「从大纲重新生成」恢复原始大纲标题并重跑阶段一。
                      </span>
                      <button
                        type="button"
                        onClick={() => handleResetSectionToOutline(selectedStep3Slot, workbenchMode === 'api')}
                        disabled={deletingLessonDay === selectedStep3Slot.dayIndex || isGeneratingBatch}
                        className="px-2.5 py-1 rounded border border-amber-500/60 bg-amber-900/40 hover:bg-amber-800/50 text-amber-100 font-medium whitespace-nowrap"
                      >
                        立即从大纲重置
                      </button>
                    </div>
                  )}

                  {showStep3FallbackPaste && (
                    <div className="bg-black border border-neutral-800 rounded p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-300">
                        <span>浏览器未开放读取剪贴板权限，请在此临时粘贴后点击识别导入：</span>
                        <button
                          type="button"
                          onClick={() => {
                            setShowStep3FallbackPaste(false);
                            setStep3RawImportText('');
                          }}
                          className="text-neutral-500 hover:text-neutral-300"
                        >
                          收起
                        </button>
                      </div>
                      <textarea
                        ref={step3TextareaRef}
                        id="step3-chat-paste-textarea"
                        data-testid="step3-chat-paste-textarea"
                        rows={4}
                        value={step3RawImportText}
                        onChange={(e) => setStep3RawImportText(e.target.value)}
                        placeholder="按 Ctrl+V 粘贴 AI 输出（自动识别阶段一 JSON / 阶段二 SVG / 局部修复补丁 / 完整课件）..."
                        className="w-full bg-neutral-950 border border-neutral-800 rounded p-2.5 text-xs font-mono text-neutral-100 focus:outline-none focus:border-sky-500"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleUnifiedStep3Import(step3RawImportText)}
                          disabled={isSavingStep3Import || !step3RawImportText.trim()}
                          className="px-3 py-1.5 bg-sky-400 text-black hover:bg-sky-300 font-medium rounded transition-colors disabled:opacity-50"
                        >
                          识别并导入
                        </button>
                      </div>
                    </div>
                  )}

                  {step3PendingDraftAudit && step3PendingDraftAudit.report.issues.length > 0 && (
                    <div
                      data-testid="step3-chat-render-audit"
                      className="rounded border border-red-900/70 bg-red-950/25 text-neutral-200 p-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-medium min-w-0">
                          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                          <span className="text-red-200">
                            {step3PendingDraftAudit.report.summaryText}
                            {step3PendingDraftAudit.appliedSummary
                              ? `（${step3PendingDraftAudit.appliedSummary}）`
                              : ''}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            data-testid="step3-chat-copy-repair-btn"
                            onClick={() =>
                              triggerCopyFeedback(
                                `step3-repair-${secId}`,
                                step3PendingDraftAudit.report.repairPrompt
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white text-black hover:bg-neutral-200 font-medium rounded transition-colors"
                          >
                            {copiedKey === `step3-repair-${secId}` ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span>已复制修复提示词</span>
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
                            data-testid="step3-chat-copy-repair-md-btn"
                            onClick={() =>
                              handleCopyPromptAsMdFile(
                                `step3-repair-md-${secId}`,
                                `${secId}-repair-prompt.md`,
                                step3PendingDraftAudit.report.repairPrompt
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-100 rounded transition-colors"
                          >
                            {copiedKey === `step3-repair-md-${secId}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <FileText className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {copiedKey === `step3-repair-md-${secId}`
                                ? '已复制修复 .md'
                                : '复制修复 .md 文件'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setShowStep3IssueDetails((v) => !v)}
                            className="px-2 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-300 rounded"
                          >
                            {showStep3IssueDetails ? '收起详情' : '查看错误详情'}
                          </button>

                          {step3PendingDraftAudit.parsedLesson && (
                            <button
                              type="button"
                              onClick={() => {
                                const parsed = step3PendingDraftAudit.parsedLesson;
                                if (!parsed) return;
                                const stillPending =
                                  !selectedStep3Slot.lesson &&
                                  extractPendingDiagramSpecs(parsed).length > 0;
                                if (stillPending) {
                                  persistStep3Stage1Lesson(parsed, false);
                                } else {
                                  persistStep3FinalLesson(parsed, {
                                    rawContent: JSON.stringify(parsed, null, 2),
                                    importStage: 'complete',
                                    advanceToNext: true,
                                  });
                                }
                              }}
                              disabled={isSavingStep3Import}
                              className="px-2.5 py-1 border border-amber-700/80 hover:border-amber-400 text-amber-200 rounded transition-colors disabled:opacity-50"
                            >
                              忽略警告直接保存
                            </button>
                          )}
                        </div>
                      </div>

                      {showStep3IssueDetails && (
                        <ul className="space-y-1.5 pt-2 border-t border-red-900/50 text-[11px] text-red-100/90">
                          {step3PendingDraftAudit.report.issues.map((issue, idx) => (
                            <li
                              key={`${issue.id}-${idx}`}
                              className="bg-black/50 border border-red-900/40 rounded px-2.5 py-1.5"
                            >
                              <div className="font-medium text-red-200">
                                {issue.categoryLabel}
                                {issue.locationLabel ? ` · ${issue.locationLabel}` : ''}
                              </div>
                              <div className="text-neutral-300 mt-0.5">{issue.detail}</div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {step3ImportNotice && (
                    <div
                      data-testid="step3-chat-import-notice"
                      className={`px-3 py-2 rounded border text-xs ${
                        step3ImportNotice.ok
                          ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-200'
                          : 'border-red-800/70 bg-red-950/30 text-red-200'
                      }`}
                    >
                      {step3ImportNotice.message}
                    </div>
                  )}
                </div>
              </div>
              );
            })()}

            {draftSlots.length === 0 ? (
              <div className="border border-dashed border-neutral-800 rounded p-6 text-center space-y-3 text-xs bg-neutral-950/30">
                <p className="text-neutral-300 font-medium">
                  尚未生成课程大纲（0 节），无法逐节制作课件。
                </p>
                <p className="text-neutral-500">
                  请先返回第 2 步生成或导入完整课程大纲 (outline.json)，再回到本步逐节生成课件并评估学时。
                </p>
                <button
                  type="button"
                  onClick={() => setActiveStep('outline')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white text-black font-medium rounded hover:bg-neutral-200 transition-colors"
                >
                  <span>返回第 2 步：生成课程大纲 →</span>
                </button>
              </div>
            ) : (
            <div className="space-y-3 max-h-[48vh] overflow-y-auto pr-1">
              {effectiveSlots.map((slot) => {
                const secId = ensureStableSectionId(slot.dayIndex, slot.id);
                const boundSegs = resolveSlotPdfSegments(slot, draftSplitPlan);
                const slicedSegs = boundSegs.filter(
                  (item) =>
                    item.status === 'sliced' ||
                    Boolean(item.segmentRelPath || item.segmentFileName)
                );
                const hasLesson = Boolean(slot.lesson);
                const isGenThis = generatingDayIndex === slot.dayIndex;
                const isSelectedChatSlot = selectedStep3Slot?.dayIndex === slot.dayIndex;
                const evaluatedMinutes = getEvaluatedSectionMinutes(slot);

                return (
                  <div
                    key={secId}
                    data-testid={`step3-section-card-${slot.dayIndex}`}
                    className={`border rounded-lg p-4 bg-black flex flex-col gap-3 text-xs transition-colors ${
                      isSelectedChatSlot
                        ? 'border-neutral-500 ring-1 ring-white/15'
                        : 'border-neutral-800 hover:border-neutral-700'
                    }`}
                  >
                    {/* Top Metadata Row (never crushed horizontally) */}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 font-mono min-w-0">
                        <span className="px-2 py-0.5 bg-neutral-900 border border-neutral-700 rounded text-white font-semibold">
                          {secId}
                        </span>
                        <span className="text-neutral-300">
                          第 {slot.dayIndex} 讲 · 排程第 {slot.scheduledDay || slot.dayIndex}/{draftDurationDays} 天
                        </span>
                        <span className="text-neutral-500" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-neutral-400">
                          {evaluatedMinutes !== undefined
                            ? `预计 ${evaluatedMinutes} 分钟`
                            : '待生成课件后评估学时'}
                        </span>
                        <span className="text-neutral-500" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-neutral-500">{slot.date}</span>
                        {boundSegs.map((seg) => (
                          <span
                            key={seg.sectionId}
                            className="px-2 py-0.5 rounded border border-neutral-800 bg-neutral-950 text-neutral-300 text-[11px]"
                          >
                            {seg.segmentFileName || `${seg.sectionId}.pdf`} (物理第{' '}
                            {seg.physicalStartPage}~{seg.physicalEndPage} 页)
                          </span>
                        ))}
                      </div>

                      <span
                        className={`font-mono text-[11px] px-2 py-0.5 rounded border shrink-0 ${
                          hasLesson
                            ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-300'
                            : slot.stage1Draft
                            ? 'border-sky-800/70 bg-sky-950/30 text-sky-300'
                            : 'border-neutral-800 bg-neutral-950 text-neutral-400'
                        }`}
                      >
                        {hasLesson
                          ? `✅ 已生成 (lessons/${secId}.json)`
                          : slot.stage1Draft
                          ? `📝 阶段一已存 (${extractPendingDiagramSpecs(slot.stage1Draft).length} 图待生成)`
                          : '⏳ 待生成课件'}
                      </span>
                    </div>

                    {/* Full-Width Title, Objective & Scope */}
                    <div className="space-y-1 min-w-0">
                      <div
                        className="text-sm font-semibold text-white leading-snug"
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(slot.title),
                        }}
                      />

                      <div
                        className="text-neutral-400 leading-relaxed"
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(
                            `目标：${slot.objective} · 范围：${
                              slot.teachingScope || (slot.keyTopics || []).join('、') || '待完善'
                            }`
                          ),
                        }}
                      />

                      {slot.assignedWords && slot.assignedWords.length > 0 && (
                        <div className="text-neutral-500 font-mono truncate">
                          本节目标词汇 ({slot.assignedWords.length} 词)：
                          {slot.assignedWords.map((w) => w.word).join(', ')}
                        </div>
                      )}
                    </div>

                    {/* Bottom Action Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-neutral-900">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleCopySectionStagePrompt(slot.dayIndex, 'stage1', false)
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                          title="复制本节阶段一提示词（教学正文与图示规格）"
                        >
                          {copiedKey === `stage1-${slot.dayIndex}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {copiedKey === `stage1-${slot.dayIndex}`
                              ? '已复制阶段一'
                              : '复制阶段一提示词'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleCopySectionStagePrompt(slot.dayIndex, 'stage1', true)
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                          title="将阶段一提示词保存为 .md 文件并复制到系统剪贴板"
                        >
                          {copiedKey === `stage1-md-${slot.dayIndex}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <FileText className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {copiedKey === `stage1-md-${slot.dayIndex}`
                              ? '已复制 .md'
                              : '复制阶段一 .md'}
                          </span>
                        </button>

                        {slot.stage1Draft && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopySectionStagePrompt(slot.dayIndex, 'stage2', false)
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-sky-800/80 hover:border-sky-500 bg-sky-950/30 text-sky-200 rounded transition-colors whitespace-nowrap"
                              title="复制阶段二 SVG 生成提示词（复用阶段一规格，无需上传 PDF）"
                            >
                              {copiedKey === `stage2-${slot.dayIndex}` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              <span>
                                {copiedKey === `stage2-${slot.dayIndex}`
                                  ? '已复制阶段二'
                                  : '复制阶段二 SVG'}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopySectionStagePrompt(slot.dayIndex, 'stage2', true)
                              }
                              className="inline-flex items-center gap-1 px-2 py-1.5 border border-sky-800/80 hover:border-sky-500 text-sky-200 rounded transition-colors whitespace-nowrap"
                              title="将阶段二 SVG 提示词复制为 .md 文件"
                            >
                              {copiedKey === `stage2-md-${slot.dayIndex}` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <FileText className="w-3.5 h-3.5" />
                              )}
                              <span>阶段二 .md</span>
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          data-testid={`step3-select-paste-${slot.dayIndex}`}
                          onClick={() => {
                            setSelectedStep3ChatDay(slot.dayIndex);
                            setStep3ImportNotice(null);
                            window.setTimeout(() => {
                              const workbenchEl = document.querySelector(
                                '[data-testid="step3-chat-workbench"]'
                              );
                              workbenchEl?.scrollIntoView({
                                behavior: 'smooth',
                                block: 'center',
                              });
                            }, 30);
                          }}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 border rounded transition-colors whitespace-nowrap ${
                            isSelectedChatSlot
                              ? 'border-sky-500/80 bg-sky-950/40 text-sky-200'
                              : 'border-neutral-700 hover:border-neutral-500 text-neutral-200'
                          }`}
                          title="切换上方工作台到本节并导入或局部修补"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>
                            {hasLesson
                              ? '进入工作台修补'
                              : slot.stage1Draft
                              ? '继续阶段二 SVG'
                              : '进入工作台导入'}
                          </span>
                        </button>

                        {slicedSegs.length > 0 ? (
                          slicedSegs.map((seg) => {
                            const segId = seg.sectionId || secId;
                            const fileName = seg.segmentFileName || `${segId}.pdf`;
                            const copyKey = `copy-seg-step3-${secId}-${segId}`;
                            return (
                              <button
                                key={segId}
                                type="button"
                                onClick={() =>
                                  handleCopyCourseFile(`segments/${fileName}`, copyKey)
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                                title={`将 ${fileName} 复制到系统剪贴板，等效在资源管理器按 Ctrl+C，可直接 Ctrl+V 粘贴`}
                              >
                                {copiedKey === copyKey ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                                <span>
                                  {copiedKey === copyKey
                                    ? `已复制 ${slicedSegs.length > 1 ? fileName : '文件'}`
                                    : `复制 ${slicedSegs.length > 1 ? fileName : '小节 PDF'}`}
                                </span>
                              </button>
                            );
                          })
                        ) : pdfMetas[0] ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyCourseFile(
                                `sources/${pdfMetas[0].fileName}`,
                                `copy-src-step3-${secId}`
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                            title="将原始教材 PDF 复制到系统剪贴板，等效资源管理器 Ctrl+C"
                          >
                            {copiedKey === `copy-src-step3-${secId}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {copiedKey === `copy-src-step3-${secId}`
                                ? '已复制文件'
                                : '复制原 PDF'}
                            </span>
                          </button>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {workbenchMode === 'api' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleGenerateSingleSectionApi(slot.dayIndex, 'stage1')}
                              disabled={isGenThis || isGeneratingBatch}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors whitespace-nowrap disabled:opacity-50"
                              title="单次请求仅执行阶段一（教学内容与图示规格）"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${isGenThis ? 'animate-spin' : ''}`}
                              />
                              <span>API 步骤一：生成内容</span>
                            </button>
                            {(slot.stage1Draft || slot.lesson) && (
                              <button
                                type="button"
                                onClick={() => handleGenerateSingleSectionApi(slot.dayIndex, 'stage2')}
                                disabled={isGenThis || isGeneratingBatch}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-sky-800/80 hover:border-sky-500 text-sky-300 hover:text-white rounded transition-colors whitespace-nowrap disabled:opacity-50"
                                title="单次请求仅基于阶段一规格生成/重跑阶段二 SVG（不清除阶段一）"
                              >
                                <RefreshCw
                                  className={`w-3.5 h-3.5 ${isGenThis ? 'animate-spin' : ''}`}
                                />
                                <span>API 步骤二：生成 SVG</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleGenerateSingleSectionApi(slot.dayIndex, 'all')}
                              disabled={isGenThis || isGeneratingBatch}
                              className="inline-flex items-center gap-1 px-3 py-1.5 border border-neutral-800 hover:border-neutral-600 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap disabled:opacity-50"
                              title="依次发起步骤一和步骤二两个独立请求完成本节课件"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${isGenThis ? 'animate-spin' : ''}`}
                              />
                              <span>
                                {isGenThis
                                  ? `生成中 ${generatingDayProgress?.percent ?? 0}%`
                                  : hasLesson
                                    ? 'API 分步重生成 (1➔2)'
                                    : 'API 分步生成本节 (1➔2)'}
                              </span>
                            </button>
                          </>
                        )}

                        {(hasLesson || slot.stage1Draft) && (
                          <button
                            type="button"
                            onClick={() => handleResetSectionToOutline(slot, workbenchMode === 'api')}
                            disabled={deletingLessonDay === slot.dayIndex || isGeneratingBatch}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 border rounded transition-colors whitespace-nowrap disabled:opacity-50 ${
                              duplicateLessonDaysByDay.has(slot.dayIndex)
                                ? 'border-amber-600/80 bg-amber-950/30 text-amber-200 hover:border-amber-400'
                                : 'border-neutral-800 hover:border-amber-600/70 text-neutral-300 hover:text-amber-200'
                            }`}
                            title="清空当前课件并恢复大纲原标题，从阶段一重新生成"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>
                              {deletingLessonDay === slot.dayIndex
                                ? '重置中...'
                                : duplicateLessonDaysByDay.has(slot.dayIndex)
                                  ? `与 ${duplicateLessonDaysByDay.get(slot.dayIndex)!.join('/')} 重复 · 从大纲重生成`
                                  : '从大纲重新生成'}
                            </span>
                          </button>
                        )}

                        {hasLesson && (
                          <button
                            type="button"
                            onClick={() => handleDeleteSingleLesson(slot)}
                            disabled={deletingLessonDay === slot.dayIndex || isGeneratingBatch}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-800 hover:border-red-700 text-neutral-400 hover:text-red-400 rounded transition-colors whitespace-nowrap disabled:opacity-50"
                            title={`从磁盘删除 lessons/${secId}.json 课件`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{deletingLessonDay === slot.dayIndex ? '删除中...' : '删除课件'}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenLesson(course.id, slot.dayIndex);
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-white text-black hover:bg-neutral-200 font-medium rounded transition-colors whitespace-nowrap"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <span>{hasLesson ? '阅读课件' : '进入独立工作台'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </div>
        )}

        {/* ==================== STEP 4: LOCAL FILE MANAGER & BACKUP (PYTHON BACKEND) ==================== */}
        {activeStep === 'files' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-950/60 border border-neutral-900 rounded p-3.5 text-xs">
              <div className="space-y-1">
                <div className="text-white font-medium">
                  本地文件管理与打包备份（由 Python 本地后端执行真实磁盘读写与删除）
                </div>
                <div className="text-neutral-500 font-mono">
                  磁盘路径：{diskAbsPath || `${courseRelDir}/`} · 共 {diskFiles.length} 个文件（
                  {(diskTotalBytes / 1024).toFixed(1)} KB）
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => loadDiskFiles(course.id)}
                  disabled={isLoadingFiles}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                  <span>刷新列表</span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenLocalFolder}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>打开本地文件夹</span>
                </button>

                <a
                  href={`/api/courses/${course.id}/backup`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>导出整课备份 (.zip)</span>
                </a>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 hover:border-neutral-500 bg-neutral-950 text-neutral-200 rounded cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                <span>{isUploadingFile ? '正在保存...' : '追加上传教材/资料到 sources/'}</span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.txt,.md,.csv,.json"
                  onChange={(e) => handleUploadCourseFile(e, 'sources')}
                  disabled={isUploadingFile}
                  className="hidden"
                />
              </label>

              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 hover:border-neutral-500 bg-neutral-950 text-neutral-200 rounded cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                <span>{isUploadingFile ? '正在保存...' : '上传配图资源到 assets/'}</span>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={(e) => handleUploadCourseFile(e, 'assets')}
                  disabled={isUploadingFile}
                  className="hidden"
                />
              </label>
            </div>

            <div className="space-y-3 max-h-[48vh] overflow-y-auto pr-1">
              {(['sources', 'segments', 'lessons', 'assets', 'root'] as const).map((cat) => {
                const groupFiles = diskFiles.filter((f) => f.category === cat);
                const catTitles: Record<typeof cat, string> = {
                  sources: 'sources/ — 原始学习资料 (PDF / 文本 / 词库)',
                  segments: 'segments/ — 按区域无损切分的 PDF',
                  lessons: 'lessons/ — 已生成的课程讲义 JSON',
                  assets: 'assets/ — 课件图片与附件资源',
                  root: '根目录 — 课程配置文件与提示词',
                };
                if (groupFiles.length === 0) return null;

                return (
                  <div
                    key={cat}
                    className="border border-neutral-800 rounded bg-neutral-950/40 overflow-hidden"
                  >
                    <div className="px-3.5 py-2 bg-neutral-950 border-b border-neutral-900 text-xs font-mono text-neutral-300 flex items-center justify-between">
                      <span>{catTitles[cat]}</span>
                      <span className="text-neutral-500">{groupFiles.length} 个文件</span>
                    </div>
                    <div className="divide-y divide-neutral-900/70">
                      {groupFiles.map((file) => {
                        const isDelThis = deletingRelPath === file.relPath;
                        const copyFileKey = `copy-disk-${file.relPath}`;
                        return (
                          <div
                            key={file.relPath}
                            className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs hover:bg-neutral-950/60"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <FileText className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                              <span className="font-mono text-neutral-200 truncate">
                                {file.relPath}
                              </span>
                              <span className="font-mono text-neutral-500 shrink-0">
                                {(file.size / 1024).toFixed(1)} KB
                              </span>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleCopyCourseFile(file.relPath, copyFileKey)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors"
                                title="将该文件复制到系统剪贴板，等效 Ctrl+C"
                              >
                                {copiedKey === copyFileKey ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>{copiedKey === copyFileKey ? '已复制' : '复制文件'}</span>
                              </button>
                              <a
                                href={`/api/courses/${course.id}/files/download?path=${encodeURIComponent(file.relPath)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>查看</span>
                              </a>
                              <a
                                href={`/api/courses/${course.id}/files/download?path=${encodeURIComponent(file.relPath)}&download=1`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors"
                              >
                                <Download className="w-3 h-3" />
                                <span>下载</span>
                              </a>
                              {file.deletable ? (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDiskFile(file.relPath)}
                                  disabled={isDelThis}
                                  aria-label={`删除文件 ${file.relPath}`}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-800 hover:border-red-700 text-neutral-400 hover:text-red-400 rounded transition-colors disabled:opacity-50"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>{isDelThis ? '删除中...' : '删除文件'}</span>
                                </button>
                              ) : (
                                <span className="text-[11px] font-mono text-neutral-600 px-2">
                                  核心配置
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {diskFiles.length === 0 && !isLoadingFiles && (
                <div className="border border-dashed border-neutral-800 rounded p-6 text-center text-xs text-neutral-500">
                  当前课程目录暂无可显示文件，请点击“刷新列表”或上传资料。
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-neutral-900 text-xs">
          <span className="text-neutral-500 font-mono">
            小节唯一标识保证修改目录或日期后资料与课件绝不发生错位
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-neutral-300 hover:text-white border border-neutral-800 rounded transition-colors"
          >
            关闭工作台
          </button>
        </div>
          </motion.div>

          <LessonPreviewModal
            isOpen={Boolean(step3PreviewLesson)}
            lesson={step3PreviewLesson}
            sectionId={
              selectedStep3Slot
                ? ensureStableSectionId(selectedStep3Slot.dayIndex, selectedStep3Slot.id)
                : undefined
            }
            dayIndex={selectedStep3Slot?.dayIndex}
            customAssets={course.customAssets || {}}
            hasAuditIssues={Boolean(
              step3PendingDraftAudit && step3PendingDraftAudit.report.issues.length > 0
            )}
            auditSummaryText={step3PendingDraftAudit?.report.summaryText}
            isSaving={isSavingStep3Import}
            onClose={() => {
              setStep3PreviewLesson(null);
              setStep3PreviewKind(null);
            }}
            onConfirmSave={handleConfirmStep3PreviewSave}
          />
        </motion.div>
  );
};
