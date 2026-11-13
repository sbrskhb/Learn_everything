import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  BookOpen,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderSync,
  Plus,
  RefreshCw,
  Scissors,
  Shuffle,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  Course,
  CourseDiskFile,
  CourseGenerationMode,
  DailyPlanSlot,
  PdfDocumentMeta,
  PdfSplitPlanItem,
} from '../types';
import {
  addDaysToDateString,
  computeVocabCoverageStats,
  ensureStableSectionId,
} from '../utils/learningLogic';
import { copyCourseFileToClipboard } from '../utils/clipboardFile';
import { renderInlineMathWithLatex } from '../utils/markdownMath';

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
  const [activeStep, setActiveStep] = useState<OutlineWorkbenchStep>(initialStep);

  // Step 1: Outline editing states
  const [draftSlots, setDraftSlots] = useState<DailyPlanSlot[]>([]);
  const [draftStartDate, setDraftStartDate] = useState<string>('');
  const [isSavingOutline, setIsSavingOutline] = useState(false);
  const [isRegeneratingOutline, setIsRegeneratingOutline] = useState(false);
  const [chatSyllabusPrompt, setChatSyllabusPrompt] = useState<string>('');
  const [agentSyllabusPrompt, setAgentSyllabusPrompt] = useState<string>('');
  const [rawSyllabusImport, setRawSyllabusImport] = useState<string>('');
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
  const [isPlanningSplit, setIsPlanningSplit] = useState(false);
  const [isExecutingSplit, setIsExecutingSplit] = useState(false);
  const [isSyncingAgentInline, setIsSyncingAgentInline] = useState(false);
  const [slicingSectionId, setSlicingSectionId] = useState<string | null>(null);

  // English vocab allocation states
  const [dailyWordCountInput, setDailyWordCountInput] = useState<number>(20);
  const [isReallocatingVocab, setIsReallocatingVocab] = useState(false);

  // Step 3: Per-section quick material & generation states
  const [generatingDayIndex, setGeneratingDayIndex] = useState<number | null>(null);
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);
  const [deletingLessonDay, setDeletingLessonDay] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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
    const mode = course.generationMode || 'api';
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

  if (!isOpen || !course) return null;

  const triggerCopyFeedback = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2000);
  };

  const handleSwitchWorkbenchMode = async (nextMode: CourseGenerationMode) => {
    if (nextMode === 'agent') {
      setSplitModeTab('agent');
      setSyllabusWorkbenchTab('agent');
    } else if (nextMode === 'chat') {
      setSplitModeTab('chat');
      setSyllabusWorkbenchTab('chat');
    }
    if ((nextMode === 'chat' || nextMode === 'agent') && !course.outlineConfirmed) {
      setShowSyllabusImportBox(true);
    }
    try {
      const res = await fetch(`/api/courses/${course.id}/mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationMode: nextMode }),
      });
      if (res.ok) {
        const data = await res.json();
        onCourseUpdated(data.course);
      }
    } catch {
      // ignore
    }
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
        pdfSegment: matched || undefined,
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
          dailyPlan: draftSlots,
          confirmOutline,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存课程目录失败');

      onCourseUpdated(data.course);
      setDraftSlots(data.course.dailyPlan);
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

  const handleImportChatSyllabus = async () => {
    if (!rawSyllabusImport.trim()) return;
    setIsSavingOutline(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/import-syllabus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawContent: rawSyllabusImport,
          confirmOutline: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '导入目录 JSON 失败');
      onCourseUpdated(data.course);
      setDraftSlots(data.course.dailyPlan);
      setRawSyllabusImport('');
      setShowSyllabusImportBox(false);
      setActiveStep('lessons');
      setStatusMessage('已导入并确认完整课程大纲 (outline.json)，可直接开始按序生成各节课件。');
    } catch (err: any) {
      setErrorMessage(err?.message || '解析导入目录失败');
    } finally {
      setIsSavingOutline(false);
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

  const handleImportChatSplitPlan = async () => {
    if (!rawSplitImport.trim()) return;
    setIsExecutingSplit(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/pdf-split/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawContent: rawSplitImport,
          pageOffset,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '导入 PDF 划分方案失败');

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
      refreshChatPrompts(course.id);
      const slicedCount = latestPlan.filter((p) => p.status === 'sliced').length;
      setStatusMessage(
        slicedCount > 0
          ? `已导入区域划分方案并自动完成本地 PDF 无损切割（共 ${slicedCount} 个区域），可直接点击“进入第 2 步：LLM 生成课程大纲”。`
          : '已成功导入外部 AI 的 PDF 划分区域方案，可点击下方按钮调用本地脚本完成切割。'
      );
    } catch (err: any) {
      setErrorMessage(err?.message || '导入 PDF 划分方案失败');
    } finally {
      setIsExecutingSplit(false);
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
        '已按每日目标词数重新随机分配尚未开始学习的词汇（已生成课件的小节保持不变，结果已稳定保存）。'
      );
    } catch (err: any) {
      setErrorMessage(err?.message || '重新分配词汇失败');
    } finally {
      setIsReallocatingVocab(false);
    }
  };

  // --- Step 3 Handlers: Quick Material Access & Per-Section Generation ---
  const handleCopySectionLessonPrompt = async (dayIndex: number) => {
    try {
      const res = await fetch(`/api/courses/${course.id}/days/${dayIndex}/chat-prompt`);
      if (res.ok) {
        const data = await res.json();
        if (data.lessonPrompt) {
          triggerCopyFeedback(`prompt-${dayIndex}`, data.lessonPrompt);
        }
      }
    } catch {
      // ignore
    }
  };

  const handleGenerateSingleSectionApi = async (dayIndex: number) => {
    setGeneratingDayIndex(dayIndex);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/days/${dayIndex}/generate`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `生成第 ${dayIndex} 节课件失败`);
      onCourseUpdated(data.course);
      setDraftSlots(data.course.dailyPlan);
      setStatusMessage(
        `第 ${dayIndex} 讲课件已生成并保存到本地 ${course.courseDirPath}/lessons/sec-${String(dayIndex).padStart(2, '0')}.json`
      );
    } catch (err: any) {
      setErrorMessage(err?.message || `生成第 ${dayIndex} 节课件失败，可重试或切换 Chat/Agent 模式`);
    } finally {
      setGeneratingDayIndex(null);
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
        const res = await fetch(`/api/courses/${course.id}/days/${s.dayIndex}/generate`, {
          method: 'POST',
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `生成第 ${s.dayIndex} 节课件失败`);
        }
        onCourseUpdated(data.course);
        setDraftSlots(data.course.dailyPlan);
        completed++;
      }
      setStatusMessage(`已按目录顺序完成全部 ${completed} 节课件生成。`);
    } catch (err: any) {
      setErrorMessage(
        `${err?.message || '批量生成中断'}（已完成 ${completed}/${pendingSlots.length} 节，可继续从断点生成）`
      );
    } finally {
      setGeneratingDayIndex(null);
      setIsGeneratingBatch(false);
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="outline-workbench-title"
    >
      <div className="w-full max-w-5xl bg-black border border-neutral-800 rounded-md p-6 my-6 max-h-[92vh] overflow-y-auto space-y-5">
        {/* Top Header */}
        <div className="flex items-start justify-between gap-4 border-b border-neutral-800 pb-4">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-neutral-400">
              <span className="text-white font-sans font-semibold text-base" id="outline-workbench-title">
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

          <div className="flex items-center gap-2.5 shrink-0">
            <label className="sr-only" htmlFor="workbench-mode-select">
              工作台生成方式
            </label>
            <select
              id="workbench-mode-select"
              value={course.generationMode || 'api'}
              onChange={(e) =>
                handleSwitchWorkbenchMode(e.target.value as CourseGenerationMode)
              }
              className="bg-black border border-neutral-800 hover:border-neutral-600 rounded px-2.5 py-1 text-xs text-neutral-200 focus:outline-none"
              title="切换当前课程的生成方式（API / Agent / Chat）"
            >
              <option value="api">模式：API 自动生成</option>
              <option value="agent">模式：Agent 课件模式</option>
              <option value="chat">模式：Chat 课件模式</option>
            </select>

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
            className={`p-3 rounded border text-left transition-colors ${
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
                ? `每日 ${dailyWordCountInput} 词 · 周期内不重复随机抽取`
                : `已规划 ${draftSplitPlan.length} 区域 · 已切割 ${slicedRegionCount} PDF`}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveStep('outline')}
            className={`p-3 rounded border text-left transition-colors ${
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
            className={`p-3 rounded border text-left transition-colors ${
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
            className={`p-3 rounded border text-left transition-colors ${
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
                    ? `第 1 步已配置 ${draftSplitPlan.length} 个区域（其中 ${slicedRegionCount} 个已无损切割）。课程大纲与课件内容严格分离，修改目录不会删除任何已生成课件。`
                    : '课程大纲与课件内容严格分离：修改目录、调整日期或重命名小节不会删除任何已生成课件。'}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRegenerateOutlineApi}
                  disabled={isRegeneratingOutline}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white text-black font-medium rounded hover:bg-neutral-200 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRegeneratingOutline ? 'animate-spin' : ''}`} />
                  <span>{isRegeneratingOutline ? 'API 正在生成大纲...' : 'API 生成/重新生成大纲'}</span>
                </button>

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
                      ? '收起 Chat / Agent 大纲工作台'
                      : 'Chat / Agent 大纲生成与同步'}
                  </span>
                </button>
              </div>
            </div>

            {showSyllabusImportBox && (
              <div className="border border-neutral-800 rounded p-4 bg-neutral-950 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-900 pb-2.5">
                  <div className="inline-flex rounded border border-neutral-800 bg-black p-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSyllabusWorkbenchTab('chat');
                        handleSwitchWorkbenchMode('chat');
                      }}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        syllabusWorkbenchTab === 'chat'
                          ? 'bg-neutral-800 text-white font-medium'
                          : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      Chat 大纲提示词与粘贴导入
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSyllabusWorkbenchTab('agent');
                        handleSwitchWorkbenchMode('agent');
                      }}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        syllabusWorkbenchTab === 'agent'
                          ? 'bg-neutral-800 text-white font-medium'
                          : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      Agent 本地大纲写入与同步
                    </button>
                  </div>
                </div>

                {syllabusWorkbenchTab === 'agent' ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-neutral-300 font-medium">
                        Agent 模式：复制下方第 2 步大纲提示词交给本地 AI Agent 写入 <code className="text-neutral-200">{courseRelDir}/outline.json</code>，完成后点击右侧同步按钮即可
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => triggerCopyFeedback('agent-syllabus', agentSyllabusPrompt)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white text-black font-medium rounded"
                        >
                          {copiedKey === 'agent-syllabus' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedKey === 'agent-syllabus' ? '已复制 Agent 大纲提示词' : '复制 Agent 大纲提示词'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleInlineAgentSync}
                          disabled={isSyncingAgentInline}
                          className="inline-flex items-center gap-1 px-3 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded"
                        >
                          <FolderSync className={`w-3 h-3 ${isSyncingAgentInline ? 'animate-spin' : ''}`} />
                          <span>{isSyncingAgentInline ? '正在扫描同步...' : '扫描并同步本地 outline.json'}</span>
                        </button>
                      </div>
                    </div>
                    <textarea
                      readOnly
                      rows={4}
                      value={agentSyllabusPrompt || chatSyllabusPrompt}
                      className="w-full bg-black border border-neutral-800 rounded p-2.5 font-mono text-neutral-300"
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-neutral-300 font-medium">
                        Chat 模式生成完整大纲（默认外部 AI 具备多模态能力）：复制/上传原 PDF 与大纲提示词 ➔ 粘贴返回 JSON 一键确认并进入第 3 步
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        {pdfMetas.slice(0, 2).map((pm) => (
                          <React.Fragment key={pm.fileName}>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyCourseFile(`sources/${pm.fileName}`, `copy-src-syl-${pm.fileName}`)
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                              title="将原 PDF 复制到系统剪贴板，等效资源管理器 Ctrl+C"
                            >
                              {copiedKey === `copy-src-syl-${pm.fileName}` ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>
                                {copiedKey === `copy-src-syl-${pm.fileName}`
                                  ? '已复制 PDF 文件'
                                  : `复制原 PDF (${pm.fileName})`}
                              </span>
                            </button>
                            <a
                              href={`/api/courses/${course.id}/files/download?path=${encodeURIComponent(`sources/${pm.fileName}`)}&download=1`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-800 hover:border-neutral-600 text-neutral-300 rounded transition-colors"
                            >
                              <Download className="w-3 h-3" />
                              <span>下载原 PDF</span>
                            </a>
                          </React.Fragment>
                        ))}
                        <button
                          type="button"
                          onClick={() => triggerCopyFeedback('chat-syllabus', chatSyllabusPrompt)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white text-black font-medium rounded"
                        >
                          {copiedKey === 'chat-syllabus' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedKey === 'chat-syllabus' ? '已复制大纲提示词' : '复制大纲生成提示词'}</span>
                        </button>
                      </div>
                    </div>
                    <textarea
                      rows={4}
                      value={rawSyllabusImport}
                      onChange={(e) => setRawSyllabusImport(e.target.value)}
                      placeholder="在此粘贴外部 AI 输出的完整大纲 JSON（包含 days 数组与 regionId 绑定）..."
                      className="w-full bg-black border border-neutral-800 rounded p-2.5 font-mono text-neutral-200"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleImportChatSyllabus}
                        disabled={isSavingOutline || !rawSyllabusImport.trim()}
                        className="px-4 py-1.5 bg-white text-black font-medium rounded hover:bg-neutral-200 disabled:opacity-50"
                      >
                        {isSavingOutline ? '导入确认中...' : '导入大纲并进入第 3 步：生成课件 →'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Outline Preview / Editor List */}
            {!showAdvancedWorkflowDetails ? (
              <div className="space-y-2 max-h-[48vh] overflow-y-auto pr-1">
                {draftSlots.map((slot) => {
                  const secId = ensureStableSectionId(slot.dayIndex, slot.id);
                  return (
                    <div
                      key={secId}
                      className="border border-neutral-800 rounded p-3 bg-neutral-950/40 space-y-1 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-sans font-semibold">
                            第 {slot.dayIndex} 讲 ·{' '}
                            <span
                              dangerouslySetInnerHTML={{
                                __html: renderInlineMathWithLatex(slot.title),
                              }}
                            />
                          </span>
                          {slot.lesson && (
                            <span className="text-emerald-400">· 已有课件（受保护）</span>
                          )}
                        </div>
                        <span className="text-neutral-500">{slot.date}</span>
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
                          <input
                            type="date"
                            value={slot.date}
                            onChange={(e) => handleUpdateSlotField(idx, 'date', e.target.value)}
                            aria-label={`第 ${slot.dayIndex} 讲日期`}
                            className="bg-black border border-neutral-800 rounded px-2 py-0.5 text-xs font-mono text-neutral-200"
                          />
                          {draftSplitPlan.length > 0 && (
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
                  已简化大纲预览；如需手动增删小节或修改日期/目标，
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
                    disabled={isSavingOutline}
                    className="px-3.5 py-2 text-xs border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
                  >
                    仅保存目录草稿
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleSaveOutline(true)}
                  disabled={isSavingOutline}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors"
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
                      英语课程每日词汇随机分配（本地差集与去重，不依赖 LLM）
                    </h3>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      词库差集：{course.englishConfig.targetBankName} ({course.englishConfig.totalTargetCount}) −{' '}
                      {course.englishConfig.excludedBankName} ({course.englishConfig.excludedCount}) = 实际待学{' '}
                      {course.englishConfig.effectiveWords.length} 词
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-neutral-400">每日目标单词数：</span>
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
                      aria-label="调整每日目标单词数"
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
                            {slot.id} · 第 {slot.dayIndex} 天 ({slot.date})
                          </span>
                          <span className="text-neutral-400">
                            {words.length} 词 {slot.lesson ? '· 已锁定(已学)' : '· 稳定保存'}
                          </span>
                        </div>
                        <p className="text-neutral-400 font-mono truncate">
                          {words.length > 0
                            ? words.map((w) => w.word).join(', ')
                            : '（词库容量已分配完毕，当日无剩余未分配词）'}
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

                {/* Standalone API Split Action + Peer Chat / Agent Inline Tabs */}
                <div className="flex flex-wrap items-center gap-2">
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

                  <div className="inline-flex rounded border border-neutral-800 bg-black p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setSplitModeTab('chat')}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        splitModeTab === 'chat'
                          ? 'bg-neutral-800 text-white font-medium'
                          : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      Chat 划分提示词与导入
                    </button>
                    <button
                      type="button"
                      onClick={() => setSplitModeTab('agent')}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        splitModeTab === 'agent'
                          ? 'bg-neutral-800 text-white font-medium'
                          : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      Agent 本地划分与同步
                    </button>
                  </div>

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
                      可选手动偏移量修正（默认 0，不通过 OCR 自动猜算；物理页码 = 教材印刷页码 + 偏移量）
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
              {splitModeTab === 'agent' && (
                <div className="bg-black border border-neutral-800 rounded p-3.5 space-y-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-neutral-300 font-medium">
                      Agent 模式：复制下方第 1 步提示词交给 Antigravity / Codex，Agent 写入 <code className="text-neutral-200">segments/split-plan.json</code> 并执行切割脚本后，点击右侧同步按钮即可
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => triggerCopyFeedback('agent-split', agentSplitPrompt)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-white text-black font-medium rounded"
                      >
                        {copiedKey === 'agent-split' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === 'agent-split' ? '已复制 Agent 划分提示词' : '复制 Agent 划分提示词'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleInlineAgentSync}
                        disabled={isSyncingAgentInline}
                        className="inline-flex items-center gap-1 px-3 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded"
                      >
                        <FolderSync className={`w-3.5 h-3.5 ${isSyncingAgentInline ? 'animate-spin' : ''}`} />
                        <span>{isSyncingAgentInline ? '正在扫描同步...' : '扫描同步本地 split-plan.json'}</span>
                      </button>
                    </div>
                  </div>
                  <textarea
                    readOnly
                    rows={5}
                    value={agentSplitPrompt}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded p-2.5 font-mono text-neutral-300"
                  />
                </div>
              )}

              {splitModeTab === 'chat' && (
                <div className="bg-black border border-neutral-800 rounded p-3.5 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-neutral-300 font-medium">
                      Chat 模式：1. 下载原 PDF 并连同下方提示词一并上传给多模态外部 AI ➔ 2. 粘贴返回 JSON ➔ 3. 本地切割
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {pdfMetas.slice(0, 2).map((pm) => (
                        <React.Fragment key={pm.fileName}>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyCourseFile(`sources/${pm.fileName}`, `copy-src-split-${pm.fileName}`)
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors"
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
                          <a
                            href={`/api/courses/${course.id}/files/download?path=${encodeURIComponent(`sources/${pm.fileName}`)}&download=1`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-800 hover:border-neutral-600 text-neutral-300 rounded transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>下载原 PDF</span>
                          </a>
                        </React.Fragment>
                      ))}
                      <button
                        type="button"
                        onClick={() => triggerCopyFeedback('chat-split', chatSplitPrompt)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-white text-black font-medium rounded"
                      >
                        {copiedKey === 'chat-split' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === 'chat-split' ? '已复制区域划分提示词' : '一键复制区域划分提示词'}</span>
                      </button>
                    </div>
                  </div>
                  <textarea
                    readOnly
                    rows={4}
                    value={chatSplitPrompt}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded p-2.5 font-mono text-neutral-400"
                  />
                  <div className="space-y-2 pt-2 border-t border-neutral-900">
                    <label className="block text-neutral-300">
                      粘贴外部 AI 返回的结构化 PDF 划分区域 JSON：
                    </label>
                    <textarea
                      rows={4}
                      value={rawSplitImport}
                      onChange={(e) => setRawSplitImport(e.target.value)}
                      placeholder='在此粘贴包含 "regions": [...] (或 "segments": [...]) 的 JSON 划分方案...'
                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2.5 font-mono text-neutral-200"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleImportChatSplitPlan}
                        disabled={isExecutingSplit || !rawSplitImport.trim()}
                        className="px-3.5 py-1.5 bg-white text-black font-medium rounded hover:bg-neutral-200 disabled:opacity-50"
                      >
                        {isExecutingSplit ? '正在导入并切割 PDF...' : '导入并自动切割 PDF'}
                      </button>
                    </div>
                  </div>
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
                  每节自动关联第 1 步切分出的区域 PDF 与第 2 步大纲目标；进入任一小节后支持“保存并连续进入下一讲”。
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
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
                      ? `API 正在按序生成第 ${generatingDayIndex} 节...`
                      : 'API 按序生成全部未完成小节'}
                  </span>
                </button>

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

            <div className="space-y-2.5 max-h-[54vh] overflow-y-auto pr-1">
              {draftSlots.map((slot) => {
                const secId = ensureStableSectionId(slot.dayIndex, slot.id);
                const seg =
                  slot.pdfSegment ||
                  (slot.regionId
                    ? draftSplitPlan.find((p) => p.sectionId === slot.regionId)
                    : undefined) ||
                  draftSplitPlan.find(
                    (p) => p.sectionId === secId || p.dayIndex === slot.dayIndex
                  );
                const segId = seg?.sectionId || secId;
                const hasLesson = Boolean(slot.lesson);
                const isGenThis = generatingDayIndex === slot.dayIndex;

                return (
                  <div
                    key={secId}
                    className="border border-neutral-800 rounded p-3.5 bg-black flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-mono">
                        <span className="px-2 py-0.5 bg-neutral-900 border border-neutral-700 rounded text-white">
                          {secId}
                        </span>
                        <span className="text-neutral-400">
                          第 {slot.dayIndex} 天 · {slot.date}
                        </span>
                        <span
                          className={
                            hasLesson ? 'text-emerald-400' : 'text-neutral-500'
                          }
                        >
                          {hasLesson
                            ? `✅ 已生成 (lessons/${secId}.json)`
                            : '⏳ 待生成课件'}
                        </span>
                        {seg && (
                          <span className="text-neutral-400">
                            · 绑定区域: {seg.segmentFileName || `${segId}.pdf`} (物理第{' '}
                            {seg.physicalStartPage}~{seg.physicalEndPage} 页)
                          </span>
                        )}
                      </div>

                      <div
                        className="text-sm font-semibold text-white truncate"
                        dangerouslySetInnerHTML={{
                          __html: renderInlineMathWithLatex(slot.title),
                        }}
                      />

                      <div
                        className="text-neutral-400 truncate"
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
                          今日目标词汇 ({slot.assignedWords.length} 词)：
                          {slot.assignedWords.map((w) => w.word).join(', ')}
                        </div>
                      )}
                    </div>

                    {/* Quick Section Material Access & Generation Actions */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopySectionLessonPrompt(slot.dayIndex)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                        title="一键复制包含课程目标、先修知识、上下文及本节范围的课件生成提示词"
                      >
                        {copiedKey === `prompt-${slot.dayIndex}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {copiedKey === `prompt-${slot.dayIndex}`
                            ? '已复制提示词'
                            : '复制本节提示词'}
                        </span>
                      </button>

                      {seg?.status === 'sliced' ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyCourseFile(
                                `segments/${seg.segmentFileName || `${segId}.pdf`}`,
                                `copy-seg-step3-${secId}`
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded transition-colors whitespace-nowrap"
                            title="将本节 PDF 文件复制到系统剪贴板，等效在资源管理器按 Ctrl+C，可直接 Ctrl+V 粘贴"
                          >
                            {copiedKey === `copy-seg-step3-${secId}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {copiedKey === `copy-seg-step3-${secId}`
                                ? '已复制文件'
                                : '复制小节 PDF'}
                            </span>
                          </button>
                          <a
                            href={`/api/courses/${course.id}/segments/${segId}/pdf?download=1`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-800 hover:border-neutral-600 text-neutral-300 rounded transition-colors whitespace-nowrap"
                            title="导出或下载该小节对应的切分 PDF 原文件"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>导出小节 PDF</span>
                          </a>
                        </>
                      ) : pdfMetas[0] ? (
                        <>
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
                          <a
                            href={`/api/courses/${course.id}/files/download?path=${encodeURIComponent(`sources/${pdfMetas[0].fileName}`)}&download=1`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-neutral-800 hover:border-neutral-600 text-neutral-300 rounded transition-colors whitespace-nowrap"
                            title="下载原始教材 PDF 文件"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>下载原 PDF</span>
                          </a>
                        </>
                      ) : null}

                      {(showAdvancedWorkflowDetails || (course.generationMode || 'api') === 'api') && (
                        <button
                          type="button"
                          onClick={() => handleGenerateSingleSectionApi(slot.dayIndex)}
                          disabled={isGenThis || isGeneratingBatch}
                          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded transition-colors whitespace-nowrap disabled:opacity-50 ${
                            (course.generationMode || 'api') === 'api'
                              ? 'bg-white text-black hover:bg-neutral-200 font-medium'
                              : 'border border-neutral-800 hover:border-neutral-600 text-neutral-300'
                          }`}
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${isGenThis ? 'animate-spin' : ''}`}
                          />
                          <span>
                            {isGenThis
                              ? '生成中...'
                              : hasLesson
                                ? 'API 重新生成'
                                : 'API 生成本节'}
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
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded transition-colors whitespace-nowrap ${
                          (course.generationMode || 'api') === 'chat'
                            ? 'bg-white text-black hover:bg-neutral-200 font-medium'
                            : 'bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-700'
                        }`}
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>{hasLesson ? '阅读课件' : '进入 Chat 生成'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
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
      </div>
    </div>
  );
};
