import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ClipboardPaste,
  Copy,
  FileText,
  FolderSync,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import type { Course, VocabThemeItem, VocabThemePlan } from '../types';
import {
  copyCourseFileToClipboard,
  copyPromptMarkdownFileToClipboard,
  copyPromptText,
} from '../utils/clipboardFile';

interface VocabPlanProgress {
  totalWords: number;
  aiMappedCount: number;
  localMappedCount: number;
  manualMappedCount: number;
  totalMappedCount: number;
  unmappedWordIds: string[];
  nonAiWordIds: string[];
  themeCandidateCounts: Record<string, { primary: number; candidate: number }>;
}

interface VocabPlanInfoResponse {
  vocabThemePlan: VocabThemePlan;
  progress: VocabPlanProgress;
  themePlanningPrompts: {
    chatPrompt: string;
    agentPrompt: string;
    apiSystemPrompt: string;
    apiUserPrompt: string;
  };
  wordMappingPrompts: {
    chatBatchPrompt: string;
    chatFilePrompt: string;
    agentPrompt: string;
    batchWordIds: string[];
    batchIndex: number;
    totalBatches: number;
    totalRemaining: number;
    remainingAfterBatch: number;
  };
  compactVocabRelPath: string;
}

interface VocabThemePlanningPanelProps {
  course: Course;
  workbenchMode: 'chat' | 'agent' | 'api';
  newWordsPerArticle: number;
  targetWordDensity: number;
  expectedRepeatsPerWord: number;
  isSyncingAgentInline: boolean;
  onSyncAgentWorkspace: () => Promise<void>;
  onCourseUpdated: (course: Course) => void;
  onGoToStep2Outline?: () => void;
  onGoToStep3Lessons: () => void;
  onSetStatusMessage: (msg: string | null) => void;
  onSetErrorMessage: (msg: string | null) => void;
}

function formatPlanApiError(res: Response, data: any, fallback: string): string {
  const raw = typeof data?.error === 'string' ? data.error : '';
  if (res.status === 404 && (!raw || raw.includes('未找到接口'))) {
    return '未找到主题规划接口（本地后端服务尚未重启以加载新接口，请重启服务后重试）';
  }
  return raw || fallback;
}

export const VocabThemePlanningPanel: React.FC<VocabThemePlanningPanelProps> = ({
  course,
  workbenchMode,
  newWordsPerArticle,
  targetWordDensity,
  expectedRepeatsPerWord,
  isSyncingAgentInline,
  onSyncAgentWorkspace,
  onCourseUpdated,
  onGoToStep2Outline: _onGoToStep2Outline,
  onGoToStep3Lessons,
  onSetStatusMessage,
  onSetErrorMessage,
}) => {
  const [planInfo, setPlanInfo] = useState<VocabPlanInfoResponse | null>(null);
  const [topicCountInput, setTopicCountInput] = useState<string>(() =>
    course.englishConfig?.topicCount && course.englishConfig.topicCount > 0
      ? String(course.englishConfig.topicCount)
      : ''
  );
  const [totalArticlesInput, setTotalArticlesInput] = useState<number>(() =>
    Math.max(1, Number(course.englishConfig?.estimatedArticleCount || course.durationDays || 12))
  );
  const [draftThemes, setDraftThemes] = useState<VocabThemeItem[]>(
    course.englishConfig?.vocabThemePlan?.themes || []
  );
  const [themesDirty, setThemesDirty] = useState(false);

  // Step 1A import / busy states
  const [isBusyStep1A, setIsBusyStep1A] = useState(false);
  const [showThemePasteBox, setShowThemePasteBox] = useState(false);
  const [rawThemeImport, setRawThemeImport] = useState('');

  // Step 1B mapping states
  const [batchSizeChoice, setBatchSizeChoice] = useState<number>(500);
  const [includeLocalForAi, setIncludeLocalForAi] = useState<boolean>(false);
  const [isBusyStep1B, setIsBusyStep1B] = useState(false);
  const [apiBatchProgressText, setApiBatchProgressText] = useState<string | null>(null);
  const stopApiLoopRef = useRef(false);
  const [showMapPasteBox, setShowMapPasteBox] = useState(false);
  const [rawMapImport, setRawMapImport] = useState('');

  // Step 1C allocation states
  const [interleaveThemes, setInterleaveThemes] = useState<boolean>(
    course.englishConfig?.vocabThemePlan?.interleaveThemes ?? true
  );
  const [preserveStartedSlots, setPreserveStartedSlots] = useState<boolean>(true);
  const [isAllocating, setIsAllocating] = useState(false);

  // Copy & fallback prompt viewer
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [manualCopyPrompt, setManualCopyPrompt] = useState<{ title: string; text: string } | null>(
    null
  );

  const effectiveTotal = course.englishConfig?.effectiveWords?.length || 0;
  const hasGeneratedLessons = useMemo(
    () => (course.dailyPlan || []).some((s) => Boolean(s.lesson)),
    [course.dailyPlan]
  );

  useEffect(() => {
    const incomingTopicN = course.englishConfig?.topicCount;
    setTopicCountInput(incomingTopicN && incomingTopicN > 0 ? String(incomingTopicN) : '');
    if (
      typeof course.englishConfig?.estimatedArticleCount === 'number' &&
      course.englishConfig.estimatedArticleCount > 0
    ) {
      setTotalArticlesInput(course.englishConfig.estimatedArticleCount);
    }
  }, [course.id, course.englishConfig?.topicCount, course.englishConfig?.estimatedArticleCount]);

  useEffect(() => {
    const incomingThemes = course.englishConfig?.vocabThemePlan?.themes || [];
    setDraftThemes(incomingThemes);
    setThemesDirty(false);
    if (course.englishConfig?.vocabThemePlan?.interleaveThemes !== undefined) {
      setInterleaveThemes(Boolean(course.englishConfig.vocabThemePlan.interleaveThemes));
    }
  }, [
    course.id,
    course.englishConfig?.vocabThemePlan?.themes,
    course.englishConfig?.vocabThemePlan?.lastThemesUpdatedAt,
    course.englishConfig?.vocabThemePlan?.interleaveThemes,
  ]);

  const fetchPlanInfo = useCallback(
    async (signal?: AbortSignal) => {
      const effectiveBatchSize =
        effectiveTotal === 0 ? 500 : batchSizeChoice === 0 ? effectiveTotal : batchSizeChoice;
      try {
        const res = await fetch(
          `/api/courses/${encodeURIComponent(course.id)}/vocab-plan/info?batchSize=${effectiveBatchSize}&includeLocal=${includeLocalForAi ? '1' : '0'}`,
          { signal }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(formatPlanApiError(res, data, '加载词库主题规划状态失败'));
        }
        if (!signal?.aborted) {
          setPlanInfo(data as VocabPlanInfoResponse);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        onSetErrorMessage(err?.message || '加载词库主题规划状态失败');
      }
    },
    [course.id, effectiveTotal, batchSizeChoice, includeLocalForAi, onSetErrorMessage]
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchPlanInfo(controller.signal);
    return () => controller.abort();
  }, [
    fetchPlanInfo,
    course.englishConfig?.vocabThemePlan?.lastThemesUpdatedAt,
    course.englishConfig?.vocabThemePlan?.lastMappingUpdatedAt,
    course.englishConfig?.vocabThemePlan?.lastAllocatedAt,
  ]);

  const handleCopyPrompt = async (key: string, text: string, title: string) => {
    if (!text.trim()) {
      onSetErrorMessage('当前提示词尚未就绪，请稍后再试。');
      return;
    }
    onSetErrorMessage(null);
    try {
      await copyPromptText(text);
      setCopiedKey(key);
      setManualCopyPrompt(null);
      onSetStatusMessage(`已复制「${title}」（${text.length} 字符），请直接粘贴到 AI 对话框。`);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2500);
    } catch {
      setManualCopyPrompt({ title, text });
      onSetErrorMessage('剪贴板写入受限，已在下方展开提示词全文，请手动全选复制。');
    }
  };

  const handleCopyPromptMd = async (key: string, fileName: string, text: string) => {
    if (!text.trim()) {
      onSetErrorMessage('当前提示词尚未就绪，请稍后再试。');
      return;
    }
    onSetErrorMessage(null);
    try {
      const result = await copyPromptMarkdownFileToClipboard(course.id, fileName, text);
      setCopiedKey(key);
      onSetStatusMessage(
        result.copiedToOsClipboard
          ? `已复制 ${fileName} 到系统剪贴板，可直接在对话框 Ctrl+V 发送。`
          : result.reason || `已复制「${fileName}」文本内容。`
      );
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2500);
    } catch (err: any) {
      onSetErrorMessage(err?.message || `复制 ${fileName} 失败`);
    }
  };

  const handleCopyCompactVocabFile = async () => {
    onSetErrorMessage(null);
    try {
      const result = await copyCourseFileToClipboard(
        course.id,
        planInfo?.compactVocabRelPath || 'sources/vocabulary-compact.txt'
      );
      setCopiedKey('copy-compact-vocab');
      onSetStatusMessage(
        result.copiedToOsClipboard
          ? '已将压缩词表 vocabulary-compact.txt 复制到剪贴板，可直接在 Chat 中 Ctrl+V 作为附件发送。'
          : result.reason || '当前环境无法直接复制文件，可使用右侧「下载词表」手动上传。'
      );
      setTimeout(
        () => setCopiedKey((prev) => (prev === 'copy-compact-vocab' ? null : prev)),
        2500
      );
    } catch (err: any) {
      onSetErrorMessage(err?.message || '复制压缩词表文件失败');
    }
  };

  // --- Step 1A Handlers ---
  const parsedTopicCountArg = () => {
    const n = Number(topicCountInput);
    return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
  };

  const handleApiPlanThemes = async () => {
    setIsBusyStep1A(true);
    onSetErrorMessage(null);
    onSetStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(course.id)}/vocab-plan/themes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_api',
          topicCount: parsedTopicCountArg(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatPlanApiError(res, data, 'API 自动规划主题失败'));
      onCourseUpdated(data.course);
      onSetStatusMessage(`步骤 1A 完成：AI 已规划 ${data.themes?.length || 0} 个课程主题，请确认后继续步骤 1B。`);
    } catch (err: any) {
      onSetErrorMessage(err?.message || 'API 自动规划主题失败');
    } finally {
      setIsBusyStep1A(false);
    }
  };

  const handleImportThemesRaw = async (rawText: string) => {
    if (!rawText.trim()) {
      onSetErrorMessage('请先粘贴 AI 输出的主题 JSON。');
      return;
    }
    setIsBusyStep1A(true);
    onSetErrorMessage(null);
    onSetStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(course.id)}/vocab-plan/themes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          rawContent: rawText,
          topicCount: parsedTopicCountArg(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatPlanApiError(res, data, '导入主题规划失败'));
      onCourseUpdated(data.course);
      setRawThemeImport('');
      setShowThemePasteBox(false);
      onSetStatusMessage(`步骤 1A 已导入并保存 ${data.themes?.length || 0} 个主题，接下来请在步骤 1B 确定词库所属主题。`);
    } catch (err: any) {
      onSetErrorMessage(err?.message || '导入主题规划失败');
    } finally {
      setIsBusyStep1A(false);
    }
  };

  const handlePasteAndImportThemes = async () => {
    onSetErrorMessage(null);
    try {
      if (!navigator.clipboard?.readText) throw new Error('no-clipboard');
      const clipText = (await navigator.clipboard.readText()).trim();
      if (!clipText) {
        onSetErrorMessage('剪贴板为空，请先复制 AI 返回的主题 JSON。');
        return;
      }
      await handleImportThemesRaw(clipText);
    } catch {
      setShowThemePasteBox(true);
      onSetErrorMessage('浏览器限制了剪贴板读取，请在下方粘贴框 Ctrl+V 粘贴或上传 JSON 文件。');
    }
  };

  const handleSaveEditedThemes = async () => {
    setIsBusyStep1A(true);
    onSetErrorMessage(null);
    onSetStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(course.id)}/vocab-plan/themes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          themes: draftThemes,
          topicCount: parsedTopicCountArg(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatPlanApiError(res, data, '保存主题修改失败'));
      onCourseUpdated(data.course);
      setThemesDirty(false);
      onSetStatusMessage(`已保存 ${data.themes?.length || 0} 个主题设置与权重。`);
    } catch (err: any) {
      onSetErrorMessage(err?.message || '保存主题修改失败');
    } finally {
      setIsBusyStep1A(false);
    }
  };

  const handleAddManualTheme = () => {
    const nextSeq = draftThemes.length + 1;
    const id = `T${String(nextSeq).padStart(2, '0')}`;
    setDraftThemes((prev) => [
      ...prev,
      {
        id,
        name: `新主题 ${nextSeq}`,
        description: '补充主题范围说明与典型语境',
        weight: 1.0,
        keywords: [],
      },
    ]);
    setThemesDirty(true);
  };

  // --- Step 1B Handlers ---
  const handleImportWordMappingsRaw = async (rawText: string) => {
    if (!rawText.trim()) {
      onSetErrorMessage('请先粘贴 AI 输出的词条主题归类结果。');
      return;
    }
    setIsBusyStep1B(true);
    onSetErrorMessage(null);
    onSetStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(course.id)}/vocab-plan/map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          rawContent: rawText,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatPlanApiError(res, data, '导入词条主题归类失败'));
      onCourseUpdated(data.course);
      setRawMapImport('');
      setShowMapPasteBox(false);
      onSetStatusMessage(
        `本批已合并导入 ${data.importedCount} 个词的主题归类；当前累计已归类 ${data.totalMappedCount}/${effectiveTotal} 词${
          data.remainingCount > 0 ? `，还剩 ${data.remainingCount} 词待归类。` : '（全词库已归类完毕，可执行步骤 1C 分配！）'
        }`
      );
    } catch (err: any) {
      onSetErrorMessage(err?.message || '导入词条主题归类失败');
    } finally {
      setIsBusyStep1B(false);
    }
  };

  const handlePasteAndImportWordMappings = async () => {
    onSetErrorMessage(null);
    try {
      if (!navigator.clipboard?.readText) throw new Error('no-clipboard');
      const clipText = (await navigator.clipboard.readText()).trim();
      if (!clipText) {
        onSetErrorMessage('剪贴板为空，请先复制 AI 输出的词条主题列表。');
        return;
      }
      await handleImportWordMappingsRaw(clipText);
    } catch {
      setShowMapPasteBox(true);
      onSetErrorMessage('浏览器限制了剪贴板读取，请在下方粘贴框 Ctrl+V 粘贴或导入结果文件。');
    }
  };

  const handleApiAutoMapAllBatches = async () => {
    setIsBusyStep1B(true);
    stopApiLoopRef.current = false;
    onSetErrorMessage(null);
    onSetStatusMessage(null);
    const apiBatchSize = 220;
    let round = 0;
    let totalAdded = 0;

    try {
      while (!stopApiLoopRef.current && round < 40) {
        round++;
        setApiBatchProgressText(`正在调用 API 语义归类第 ${round} 批（每批 ${apiBatchSize} 词）...`);
        const res = await fetch(`/api/courses/${encodeURIComponent(course.id)}/vocab-plan/map`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'generate_api',
            batchSize: apiBatchSize,
            maxBatches: 1,
            includeLocal: includeLocalForAi,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(formatPlanApiError(res, data, 'API 分批语义归类失败'));
        onCourseUpdated(data.course);
        totalAdded += Number(data.batchMappedCount || 0);
        if (!data.batchesProcessed || Number(data.remainingCount || 0) === 0) {
          break;
        }
      }
      onSetStatusMessage(
        stopApiLoopRef.current
          ? `已手动暂停 API 归类，累计本轮新增/更新 ${totalAdded} 词（进度已自动保存）。`
          : `API 语义归类完成，累计更新 ${totalAdded} 个目标词的主题归类！`
      );
    } catch (err: any) {
      onSetErrorMessage(err?.message || 'API 自动语义归类失败');
    } finally {
      setApiBatchProgressText(null);
      setIsBusyStep1B(false);
    }
  };

  const handleLocalPretag = async (mode: 'confident_only' | 'fill_remaining') => {
    setIsBusyStep1B(true);
    onSetErrorMessage(null);
    onSetStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(course.id)}/vocab-plan/map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'local_pretag',
          mode,
          overwriteExisting: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatPlanApiError(res, data, '本地预标失败'));
      onCourseUpdated(data.course);
      onSetStatusMessage(
        mode === 'confident_only'
          ? `本地双语特征词快速预标完成：高置信命中 ${data.matchedCount} 词（未覆盖 AI/人工归类），剩余 ${data.remainingCount} 词可交由 AI 精细归类。`
          : `已本地补全剩余词：线索命中 ${data.matchedCount} 词，通用主题兜底 ${data.fallbackCount} 词，当前共 ${data.totalMappedCount}/${effectiveTotal} 词就绪。`
      );
    } catch (err: any) {
      onSetErrorMessage(err?.message || '本地预标失败');
    } finally {
      setIsBusyStep1B(false);
    }
  };

  const handleClearMappings = async (scope: 'local' | 'all') => {
    setIsBusyStep1B(true);
    onSetErrorMessage(null);
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(course.id)}/vocab-plan/map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear', scope }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatPlanApiError(res, data, '清空归类失败'));
      onCourseUpdated(data.course);
      onSetStatusMessage(scope === 'local' ? '已清空本地预标结果（保留 AI 与人工归类）。' : '已清空全部词汇主题归类。');
    } catch (err: any) {
      onSetErrorMessage(err?.message || '清空归类失败');
    } finally {
      setIsBusyStep1B(false);
    }
  };

  // --- Step 1C Handler (主题阅读模式：分配并跳过大纲直进第 3 步) ---
  const handleAllocateAndEnterStep3 = async () => {
    if (themesDirty) {
      await handleSaveEditedThemes();
    }
    setIsAllocating(true);
    onSetErrorMessage(null);
    onSetStatusMessage(null);
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(course.id)}/vocab-plan/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newWordsPerArticle,
          totalArticles: effectiveTotal === 0 ? Math.max(1, Math.round(totalArticlesInput || 10)) : undefined,
          targetWordDensity,
          expectedRepeatsPerWord,
          interleaveThemes,
          preserveStartedSlots,
          fallbackUnmapped: true,
          confirmOutline: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatPlanApiError(res, data, '按主题权重分配小节失败'));
      onCourseUpdated(data.course);
      onSetStatusMessage(
        effectiveTotal > 0
          ? `已完成按主题与生词比例分配（共 ${data.totalSections} 篇，覆盖 ${data.summary?.totalWords || effectiveTotal} 词），已跳过第 2 步大纲并进入第 3 步生成课件。`
          : `已完成按主题权重分配（共 ${data.totalSections} 篇主题阅读），已跳过第 2 步大纲并进入第 3 步生成课件。`
      );
      onGoToStep3Lessons();
    } catch (err: any) {
      onSetErrorMessage(err?.message || '按主题权重分配小节失败');
    } finally {
      setIsAllocating(false);
    }
  };

  const progress = planInfo?.progress;
  const mappedPct =
    progress && progress.totalWords > 0
      ? Math.round((progress.totalMappedCount / progress.totalWords) * 1000) / 10
      : 0;
  const aiMappedPct =
    progress && progress.totalWords > 0
      ? Math.round(
          ((progress.aiMappedCount + progress.manualMappedCount) / progress.totalWords) * 1000
        ) / 10
      : 0;

  const allocSummary = course.englishConfig?.vocabThemePlan?.allocationSummary;

  return (
    <div className="space-y-3 border border-neutral-800 rounded p-3.5 bg-black/70">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-900 pb-2.5">
        <div>
          <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span>
              {effectiveTotal > 0
                ? 'AI 主题规划 → 词库主题映射 → 按权重与生词比例直接分节（可跳过大纲）'
                : 'AI 主题规划 → 按主题权重设定各篇主题（纯主题文章模式可跳过大纲）'}
            </span>
          </h4>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            {effectiveTotal > 0
              ? '先由 AI 结合学习目的与兴趣权重确定课程主题（1A），再映射目标词所属主题（1B），最后按主题权重与每篇新词比例分配篇目（1C，支持直接跳过第 2 步大纲进入第 3 步）。'
              : '先由 AI 结合学习目标与兴趣权重确定课程主题（1A），再设定总篇数按权重比例分配每篇文章主题（1C），可直接跳过第 2 步大纲生成并进入第 3 步生成课件。'}
          </p>
        </div>
      </div>

      {/* ==================== STEP 1A: AI PLAN THEMES ==================== */}
      <div className="border border-neutral-800/90 rounded p-3 bg-neutral-950/60 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-700 text-[11px] font-mono text-white">
              1A
            </span>
            <span className="text-xs font-semibold text-white">AI 确定课程主题与权重</span>
            <label className="inline-flex items-center gap-1 text-[11px] text-neutral-400 ml-1">
              <span>主题数 N</span>
              <input
                type="number"
                min={2}
                max={30}
                value={topicCountInput}
                onChange={(e) => setTopicCountInput(e.target.value)}
                placeholder="自动"
                className="w-14 bg-black border border-neutral-800 rounded px-1.5 py-0.5 text-[11px] font-mono text-white"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {workbenchMode === 'api' && (
              <button
                type="button"
                onClick={handleApiPlanThemes}
                disabled={isBusyStep1A}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-white text-black font-medium rounded hover:bg-neutral-200 disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isBusyStep1A ? 'animate-spin' : ''}`} />
                <span>{isBusyStep1A ? 'API 规划主题中...' : 'API 自动规划主题'}</span>
              </button>
            )}

            {workbenchMode === 'chat' && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyPrompt(
                      'chat-themes',
                      planInfo?.themePlanningPrompts.chatPrompt || '',
                      '1A 主题规划提示词'
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-white text-black font-medium rounded hover:bg-neutral-200"
                >
                  {copiedKey === 'chat-themes' ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copiedKey === 'chat-themes' ? '已复制提示词' : '复制主题规划提示词'}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyPromptMd(
                      'chat-themes-md',
                      'vocab-themes-prompt.md',
                      planInfo?.themePlanningPrompts.chatPrompt || ''
                    )
                  }
                  className="inline-flex items-center gap-1 px-2 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded"
                >
                  <FileText className="w-3 h-3" />
                  <span>复制 .md</span>
                </button>
                <button
                  type="button"
                  onClick={handlePasteAndImportThemes}
                  disabled={isBusyStep1A}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-sky-400 text-black font-medium rounded hover:bg-sky-300 disabled:opacity-50"
                >
                  <ClipboardPaste className="w-3 h-3" />
                  <span>{isBusyStep1A ? '导入中...' : '粘贴主题 JSON 并导入'}</span>
                </button>
                <label className="inline-flex items-center gap-1 px-2 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded cursor-pointer">
                  <Upload className="w-3 h-3" />
                  <span>导入 JSON</span>
                  <input
                    type="file"
                    accept=".json,.txt,.md"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      const txt = await f.text();
                      void handleImportThemesRaw(txt);
                    }}
                  />
                </label>
              </>
            )}

            {workbenchMode === 'agent' && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyPrompt(
                      'agent-themes',
                      planInfo?.themePlanningPrompts.agentPrompt || '',
                      'Agent 1A 主题规划指令'
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-white text-black font-medium rounded hover:bg-neutral-200"
                >
                  {copiedKey === 'agent-themes' ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>
                    {copiedKey === 'agent-themes' ? '已复制指令' : '复制 Agent 主题规划指令'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyPromptMd(
                      'agent-themes-md',
                      'agent-vocab-themes-prompt.md',
                      planInfo?.themePlanningPrompts.agentPrompt || ''
                    )
                  }
                  className="inline-flex items-center gap-1 px-2 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded"
                >
                  <FileText className="w-3 h-3" />
                  <span>复制 .md</span>
                </button>
                <button
                  type="button"
                  onClick={() => void onSyncAgentWorkspace()}
                  disabled={isSyncingAgentInline}
                  className="inline-flex items-center gap-1 px-2.5 py-1 border border-emerald-700/80 hover:border-emerald-400 bg-emerald-950/30 text-emerald-200 rounded disabled:opacity-50"
                >
                  <FolderSync className={`w-3 h-3 ${isSyncingAgentInline ? 'animate-spin' : ''}`} />
                  <span>扫描同步本地</span>
                </button>
              </>
            )}
          </div>
        </div>

        {showThemePasteBox && (
          <div className="space-y-2 border border-neutral-800 rounded p-2.5 bg-black">
            <textarea
              rows={4}
              value={rawThemeImport}
              onChange={(e) => setRawThemeImport(e.target.value)}
              placeholder='粘贴 AI 输出的 {"themes": [...]} JSON...'
              className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-xs font-mono text-neutral-200"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowThemePasteBox(false)}
                className="px-2.5 py-1 text-xs text-neutral-400 hover:text-white"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isBusyStep1A || !rawThemeImport.trim()}
                onClick={() => void handleImportThemesRaw(rawThemeImport)}
                className="px-3 py-1 text-xs bg-white text-black font-medium rounded disabled:opacity-40"
              >
                确认导入主题
              </button>
            </div>
          </div>
        )}

        {draftThemes.length === 0 ? (
          <div className="border border-dashed border-neutral-800 rounded p-3 text-[11px] text-neutral-500 flex flex-wrap items-center justify-between gap-2">
            <span>尚未规划课程主题。请通过上方 AI 规划生成主题体系（将自动分析抽样词汇与兴趣权重）。</span>
            <button
              type="button"
              onClick={handleAddManualTheme}
              className="inline-flex items-center gap-1 px-2 py-1 border border-neutral-800 hover:border-neutral-600 text-neutral-300 rounded"
            >
              <Plus className="w-3 h-3" />
              <span>手动添加主题</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
              {draftThemes.map((theme, idx) => {
                const counts = progress?.themeCandidateCounts?.[theme.id];
                return (
                  <div
                    key={theme.id}
                    className="border border-neutral-800 rounded p-2 bg-black text-xs space-y-1.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-700 font-mono text-[11px] text-neutral-200 shrink-0">
                        {theme.id}
                      </span>
                      <input
                        type="text"
                        value={theme.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDraftThemes((prev) =>
                            prev.map((it, i) => (i === idx ? { ...it, name: val } : it))
                          );
                          setThemesDirty(true);
                        }}
                        className="flex-1 min-w-0 bg-neutral-950 border border-neutral-800 rounded px-2 py-0.5 text-xs text-white"
                      />
                      <label className="inline-flex items-center gap-1 text-[11px] text-neutral-400 shrink-0">
                        <span>权重</span>
                        <input
                          type="number"
                          step={0.1}
                          min={0.3}
                          max={4}
                          value={theme.weight}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 1;
                            setDraftThemes((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, weight: val } : it))
                            );
                            setThemesDirty(true);
                          }}
                          className="w-12 bg-neutral-950 border border-neutral-800 rounded px-1 py-0.5 text-[11px] font-mono text-white"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setDraftThemes((prev) => prev.filter((_, i) => i !== idx));
                          setThemesDirty(true);
                        }}
                        title="移除该主题"
                        className="p-1 text-neutral-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-neutral-400">
                      <div className="flex items-center gap-1.5">
                        {theme.isInterestBoosted && (
                          <span className="px-1.5 py-0.2 bg-sky-950/60 border border-sky-800 text-sky-300 rounded">
                            兴趣加权
                          </span>
                        )}
                        {theme.isGeneralFallback && (
                          <span className="px-1.5 py-0.2 bg-neutral-900 border border-neutral-700 text-neutral-300 rounded">
                            通用兜底
                          </span>
                        )}
                        {counts && (
                          <span className="font-mono text-neutral-500">
                            主选 {counts.primary} · 候选 {counts.candidate}
                          </span>
                        )}
                      </div>
                      <span className="text-neutral-500 truncate max-w-[230px]">
                        {theme.keywords.slice(0, 6).join(', ')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <button
                type="button"
                onClick={handleAddManualTheme}
                className="inline-flex items-center gap-1 px-2 py-1 border border-neutral-800 hover:border-neutral-600 text-neutral-300 rounded"
              >
                <Plus className="w-3 h-3" />
                <span>手动新增主题</span>
              </button>
              {themesDirty && (
                <button
                  type="button"
                  disabled={isBusyStep1A}
                  onClick={handleSaveEditedThemes}
                  className="px-3 py-1 bg-white text-black font-medium rounded hover:bg-neutral-200 disabled:opacity-50"
                >
                  保存主题修改（刷新权重/关键词）
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ==================== STEP 1B: WORD -> CANDIDATE THEMES ==================== */}
      {draftThemes.length > 0 && effectiveTotal > 0 && (
        <div className="border border-neutral-800/90 rounded p-3 bg-neutral-950/60 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-700 font-mono text-[11px] text-white">
                1B
              </span>
              <span className="text-xs font-semibold text-white">
                确定词库中每个词会出现在哪些主题里（1~3 个候选主题）
              </span>
            </div>
            {progress && (
              <span className="text-[11px] font-mono text-neutral-300">
                已归类 {progress.totalMappedCount} / {progress.totalWords} ({mappedPct}%)
                {' · '}AI/人工 {progress.aiMappedCount + progress.manualMappedCount} ({aiMappedPct}%)
                {' · '}本地预标 {progress.localMappedCount}
                {' · '}未归类{' '}
                <strong
                  className={
                    progress.unmappedWordIds.length > 0 ? 'text-amber-300' : 'text-emerald-300'
                  }
                >
                  {progress.unmappedWordIds.length}
                </strong>
              </span>
            )}
          </div>

          {/* Dual-layer progress bar (AI/Manual vs Local Pre-tag) */}
          {progress && progress.totalWords > 0 && (
            <div className="w-full h-1.5 bg-neutral-900 rounded overflow-hidden flex">
              <div
                className="h-full bg-emerald-400 transition-all"
                style={{
                  width: `${((progress.aiMappedCount + progress.manualMappedCount) / progress.totalWords) * 100}%`,
                }}
                title="AI/人工语义归类"
              />
              <div
                className="h-full bg-sky-500/80 transition-all"
                style={{
                  width: `${(progress.localMappedCount / progress.totalWords) * 100}%`,
                }}
                title="本地特征词预标"
              />
            </div>
          )}

          {/* Primary AI Semantic Mapping Controls */}
          {workbenchMode === 'api' && (
            <div className="flex flex-wrap items-center justify-between gap-2 bg-black border border-neutral-800 rounded p-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {!apiBatchProgressText ? (
                  <button
                    type="button"
                    onClick={handleApiAutoMapAllBatches}
                    disabled={isBusyStep1B || planInfo?.wordMappingPrompts.totalRemaining === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-black font-medium rounded hover:bg-neutral-200 disabled:opacity-40"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>API 自动分批语义归类（每批 220 词）</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sky-300 font-medium">{apiBatchProgressText}</span>
                    <button
                      type="button"
                      onClick={() => {
                        stopApiLoopRef.current = true;
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 border border-red-800 text-red-300 hover:border-red-500 rounded"
                    >
                      <Square className="w-3 h-3" />
                      <span>停止</span>
                    </button>
                  </div>
                )}
              </div>

              {(progress?.localMappedCount || 0) > 0 && (
                <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeLocalForAi}
                    onChange={(e) => setIncludeLocalForAi(e.target.checked)}
                    className="rounded border-neutral-700 bg-black"
                  />
                  <span>AI 复标“本地预标”词（{progress?.localMappedCount}）</span>
                </label>
              )}
            </div>
          )}

          {workbenchMode === 'chat' && (
            <div className="space-y-2 bg-black border border-neutral-800 rounded p-2.5 text-xs">
              {/* Chat Option A: Inline Batched Prompts */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-neutral-300 font-medium">方式 A（分批粘贴对话）：</span>
                  <select
                    value={batchSizeChoice}
                    onChange={(e) => setBatchSizeChoice(Number(e.target.value))}
                    aria-label="每批归类词数"
                    className="bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-[11px] text-white"
                  >
                    <option value={300}>每批 300 词</option>
                    <option value={500}>每批 500 词（推荐）</option>
                    <option value={800}>每批 800 词</option>
                    <option value={0}>全部待归类词</option>
                  </select>
                  <span className="text-[11px] font-mono text-neutral-400">
                    {planInfo?.wordMappingPrompts.totalRemaining
                      ? `待处理 ${planInfo.wordMappingPrompts.totalRemaining} 词 · 共 ${planInfo.wordMappingPrompts.totalBatches} 批`
                      : '当前已全部归类完毕'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={!planInfo?.wordMappingPrompts.chatBatchPrompt}
                    onClick={() =>
                      handleCopyPrompt(
                        'chat-map-batch',
                        planInfo?.wordMappingPrompts.chatBatchPrompt || '',
                        `1B 本批词汇归类提示词（${planInfo?.wordMappingPrompts.batchWordIds.length || 0} 词）`
                      )
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white text-black font-medium rounded hover:bg-neutral-200 disabled:opacity-40"
                  >
                    {copiedKey === 'chat-map-batch' ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>
                      {copiedKey === 'chat-map-batch' ? '已复制本批词' : '复制本批归类提示词'}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={!planInfo?.wordMappingPrompts.chatBatchPrompt}
                    onClick={() =>
                      handleCopyPromptMd(
                        'chat-map-batch-md',
                        'vocab-map-batch.md',
                        planInfo?.wordMappingPrompts.chatBatchPrompt || ''
                      )
                    }
                    className="inline-flex items-center gap-1 px-2 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded disabled:opacity-40"
                  >
                    <FileText className="w-3 h-3" />
                    <span>复制 .md</span>
                  </button>
                  <button
                    type="button"
                    disabled={isBusyStep1B}
                    onClick={handlePasteAndImportWordMappings}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-sky-400 text-black font-medium rounded hover:bg-sky-300 disabled:opacity-50"
                  >
                    <ClipboardPaste className="w-3 h-3" />
                    <span>{isBusyStep1B ? '合并中...' : '粘贴 AI 输出并合并'}</span>
                  </button>
                </div>
              </div>

              {/* Chat Option B: Full File Upload */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-900">
                <span className="text-neutral-400 text-[11px]">
                  方式 B（发送整份词表文件给外部 AI 一次或分段处理）：
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCopyCompactVocabFile}
                    className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded"
                  >
                    {copiedKey === 'copy-compact-vocab' ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>
                      {copiedKey === 'copy-compact-vocab'
                        ? '已复制词表文件'
                        : '复制词表文件 (vocabulary-compact.txt)'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyPrompt(
                        'chat-map-file',
                        planInfo?.wordMappingPrompts.chatFilePrompt || '',
                        '1B 全量文件归类提示词'
                      )
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded"
                  >
                    <Copy className="w-3 h-3" />
                    <span>复制全量文件提示词</span>
                  </button>
                  <label className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded cursor-pointer">
                    <Upload className="w-3 h-3" />
                    <span>导入结果文件 (.json/.txt)</span>
                    <input
                      type="file"
                      accept=".txt,.json,.md,.csv"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        const txt = await f.text();
                        void handleImportWordMappingsRaw(txt);
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {workbenchMode === 'agent' && (
            <div className="flex flex-wrap items-center justify-between gap-2 bg-black border border-neutral-800 rounded p-2.5 text-xs">
              <span className="text-neutral-300">
                Agent 模式：让本地 Agent 读取全词表与主题定义，将语义映射写入{' '}
                <code className="text-neutral-200">segments/vocab-theme-plan.json</code>
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    handleCopyPrompt(
                      'agent-map',
                      planInfo?.wordMappingPrompts.agentPrompt || '',
                      'Agent 1B 全量语义归类指令'
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-white text-black font-medium rounded hover:bg-neutral-200"
                >
                  <Copy className="w-3 h-3" />
                  <span>复制 Agent 归类指令</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyPromptMd(
                      'agent-map-md',
                      'agent-vocab-map-prompt.md',
                      planInfo?.wordMappingPrompts.agentPrompt || ''
                    )
                  }
                  className="inline-flex items-center gap-1 px-2 py-1 border border-neutral-700 hover:border-neutral-500 text-neutral-200 rounded"
                >
                  <FileText className="w-3 h-3" />
                  <span>复制 .md</span>
                </button>
                <button
                  type="button"
                  onClick={() => void onSyncAgentWorkspace()}
                  disabled={isSyncingAgentInline}
                  className="inline-flex items-center gap-1 px-2.5 py-1 border border-emerald-700/80 hover:border-emerald-400 bg-emerald-950/30 text-emerald-200 rounded disabled:opacity-50"
                >
                  <FolderSync className={`w-3 h-3 ${isSyncingAgentInline ? 'animate-spin' : ''}`} />
                  <span>扫描同步本地</span>
                </button>
              </div>
            </div>
          )}

          {showMapPasteBox && (
            <div className="space-y-2 border border-neutral-800 rounded p-2.5 bg-black">
              <textarea
                rows={4}
                value={rawMapImport}
                onChange={(e) => setRawMapImport(e.target.value)}
                placeholder={'粘贴 AI 返回的紧凑行或 JSON，例如：\nw-0001: T02, T01\nw-0002: T08'}
                className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-xs font-mono text-neutral-200"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowMapPasteBox(false)}
                  className="px-2.5 py-1 text-xs text-neutral-400 hover:text-white"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={isBusyStep1B || !rawMapImport.trim()}
                  onClick={() => void handleImportWordMappingsRaw(rawMapImport)}
                  className="px-3 py-1 text-xs bg-white text-black font-medium rounded disabled:opacity-40"
                >
                  合并本批映射
                </button>
              </div>
            </div>
          )}

          {/* Local Fast Helper Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-400 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-neutral-500">辅助本地规则匹配（可选加速）：</span>
              <button
                type="button"
                disabled={isBusyStep1B}
                onClick={() => void handleLocalPretag('confident_only')}
                className="px-2.5 py-1 border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded disabled:opacity-40"
              >
                本地特征词预标（高置信）
              </button>
              {(progress?.unmappedWordIds.length || 0) > 0 && (
                <button
                  type="button"
                  disabled={isBusyStep1B}
                  onClick={() => void handleLocalPretag('fill_remaining')}
                  className="px-2.5 py-1 border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded disabled:opacity-40"
                >
                  本地兜底补全剩余词
                </button>
              )}
              {workbenchMode === 'chat' && (progress?.localMappedCount || 0) > 0 && (
                <label className="inline-flex items-center gap-1 cursor-pointer ml-1">
                  <input
                    type="checkbox"
                    checked={includeLocalForAi}
                    onChange={(e) => setIncludeLocalForAi(e.target.checked)}
                    className="rounded border-neutral-700 bg-black"
                  />
                  <span>待 AI 批包含本地预标词</span>
                </label>
              )}
            </div>

            <div className="flex items-center gap-2">
              {(progress?.localMappedCount || 0) > 0 && (
                <button
                  type="button"
                  disabled={isBusyStep1B}
                  onClick={() => void handleClearMappings('local')}
                  className="text-neutral-500 hover:text-neutral-300 underline underline-offset-2"
                >
                  仅清本地预标
                </button>
              )}
              {(progress?.totalMappedCount || 0) > 0 && (
                <button
                  type="button"
                  disabled={isBusyStep1B}
                  onClick={() => void handleClearMappings('all')}
                  className="text-neutral-500 hover:text-red-400 underline underline-offset-2"
                >
                  清空重标
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== STEP 1C: WEIGHTED SEMANTIC ALLOCATION ==================== */}
      {draftThemes.length > 0 && (
        <div className="border border-neutral-800/90 rounded p-3 bg-neutral-950/60 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-700 font-mono text-[11px] text-white">
                {effectiveTotal > 0 ? '1C' : '1B'}
              </span>
              <span className="text-xs font-semibold text-white">
                {effectiveTotal > 0
                  ? '主题阅读模式：按主题权重与生词比例分配并跳过大纲'
                  : '主题阅读模式：按主题权重分配篇数并跳过大纲'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              {effectiveTotal === 0 && (
                <label className="inline-flex items-center gap-1 text-[11px] text-neutral-300">
                  <span>计划文章数</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={totalArticlesInput}
                    onChange={(e) =>
                      setTotalArticlesInput(Math.max(1, Math.min(100, Number(e.target.value) || 10)))
                    }
                    className="w-16 bg-black border border-neutral-800 rounded px-2 py-1 text-xs font-mono text-white"
                  />
                  <span>篇</span>
                </label>
              )}

              <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={interleaveThemes}
                  onChange={(e) => setInterleaveThemes(e.target.checked)}
                  className="rounded border-neutral-700 bg-black"
                />
                <span>跨主题交替穿插（推荐）</span>
              </label>

              {hasGeneratedLessons && (
                <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preserveStartedSlots}
                    onChange={(e) => setPreserveStartedSlots(e.target.checked)}
                    className="rounded border-neutral-700 bg-black"
                  />
                  <span>保留已生成课件的小节</span>
                </label>
              )}

              <button
                type="button"
                disabled={isAllocating || draftThemes.length === 0}
                onClick={() => void handleAllocateAndEnterStep3()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white text-black font-medium rounded hover:bg-neutral-200 disabled:opacity-40"
              >
                <span>
                  {isAllocating
                    ? '正在分配...'
                    : '分配并跳过大纲，进入第 3 步生成课件 →'}
                </span>
              </button>
            </div>
          </div>

          {allocSummary && allocSummary.themeDistribution.length > 0 && (
            <div className="border border-neutral-800 rounded p-2.5 bg-black space-y-2 text-[11px]">
              <div className="text-neutral-300">
                上次主题分配结果：共 <strong className="text-white">{allocSummary.totalSections}</strong> 篇
                {effectiveTotal > 0
                  ? ` · AI/人工归类 ${allocSummary.mappedByAiCount} 词 · 本地匹配 ${allocSummary.mappedByLocalCount} 词${
                      allocSummary.unmappedFallbackCount > 0
                        ? ` · 兜底主题吸收 ${allocSummary.unmappedFallbackCount} 词`
                        : ''
                    }`
                  : ' · 纯主题文章按权重分配'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {allocSummary.themeDistribution.map((d) => (
                  <span
                    key={d.themeId}
                    className="px-2 py-0.5 rounded border border-neutral-800 bg-neutral-950 text-neutral-300 font-mono"
                  >
                    {d.themeId} {d.themeName}：
                    {effectiveTotal > 0 ? `${d.wordCount}词 / ` : ''}
                    {d.sectionCount}篇 ({d.sharePct}%)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual Prompt Preview Fallback */}
      {manualCopyPrompt && (
        <div className="border border-neutral-700 rounded p-2.5 bg-black space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-neutral-200 font-medium">{manualCopyPrompt.title}</span>
            <button
              type="button"
              onClick={() => setManualCopyPrompt(null)}
              className="text-neutral-500 hover:text-white"
            >
              关闭
            </button>
          </div>
          <textarea
            readOnly
            rows={5}
            value={manualCopyPrompt.text}
            onFocus={(e) => e.target.select()}
            className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 font-mono text-[11px] text-neutral-300"
          />
        </div>
      )}
    </div>
  );
};
