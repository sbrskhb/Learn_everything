import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  BarChart2,
  Check,
  CheckCircle2,
  Clock,
  Compass,
  Download,
  MapPin,
  RotateCcw,
  Sliders,
  X,
} from 'lucide-react';
import type {
  AppSettings,
  Course,
  LastBrowsingState,
  LearnerBaselinePreset,
  LearnerLevel,
  LearningDepthPreset,
  PromptModuleToggles,
  StudyStats,
  SubjectProfile,
} from '../types';
import type { PromptPresetItem } from '../prompts/promptLibrary';
import {
  BASELINE_LABELS,
  DEPTH_LABELS,
  deriveLegacyLearnerLevel,
  mapLegacyLevelToDualAxis,
  resolveLearnerProfile,
} from '../utils/learnerProfile';
import {
  computeLearningStats,
  formatStudyDuration,
  getTodayDateString,
} from '../utils/learningLogic';

interface SettingsModalProps {
  isOpen: boolean;
  settings: AppSettings;
  promptPresets: PromptPresetItem[];
  courses?: Course[];
  studyStats?: StudyStats;
  liveSessionSeconds?: number;
  lastBrowsingState?: LastBrowsingState | null;
  onClose: () => void;
  onSettingsUpdated: (settings: AppSettings, presets?: PromptPresetItem[]) => void;
  onOpenWelcome?: () => void;
}

const MODULE_LABELS: Array<{
  key: keyof PromptModuleToggles;
  label: string;
  desc: string;
}> = [
  { key: 'problemIntroduction', label: '知识点闭环：实际问题引入', desc: '每个核心知识点按引入→直观→定义→推导→例题→即时练习闭环' },
  { key: 'intuitionToDefinition', label: '直观解释→严格定义', desc: '先讲物理/几何直觉，再给严格定义与符号单位' },
  { key: 'knowledgeConnection', label: '合理负荷与先修衔接', desc: '单节聚焦1~3个核心点，明确与先修知识联系' },
  { key: 'continuousDerivation', label: '推导思路来源与无跳步', desc: '讲清为什么想到这一步、适用条件与连续推导' },
  { key: 'confusionComparison', label: '常见误区与新问题迁移', desc: '剖析易错假设，总结面对新变式题的分析方法' },
  { key: 'stagedDiagrams', label: '图文同步与分阶段图示', desc: '首次讲解处内联配图，标注变量、方向与状态变化' },
  { key: 'workedExamples', label: '典型例题分步拆解', desc: '完整展示破题思路、严格演算与结果合理性检验' },
  { key: 'heuristicQuestions', label: '先思考，后讲解（内联）', desc: '关键概念与推导前内联提问，渐进揭示提示与解释' },
  { key: 'progressiveExercises', label: '即时练习+综合练习（离线）', desc: '覆盖概念辨析/直接应用/错误分析/知识迁移，含离线解析' },
  { key: 'reverseExplanationCheck', label: '反向解释检验', desc: '要求不看公式用自己的话解释结论成立原因与边界' },
  { key: 'noCodeForNonCS', label: '严格正确性复核与精炼表达', desc: '独立复核中间推理与答案，避免重复冗余与无关代码' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  promptPresets,
  courses = [],
  studyStats = { totalSeconds: 0, secondsByDate: {}, secondsByCourse: {} },
  liveSessionSeconds = 0,
  lastBrowsingState = null,
  onClose,
  onSettingsUpdated,
  onOpenWelcome,
}) => {
  const todayStr = getTodayDateString();
  const learningStats = useMemo(() => {
    const base = computeLearningStats(courses, studyStats, todayStr);
    return {
      ...base,
      totalStudySeconds: base.totalStudySeconds + Math.max(0, liveSessionSeconds),
      todayStudySeconds: base.todayStudySeconds + Math.max(0, liveSessionSeconds),
    };
  }, [courses, studyStats, todayStr, liveSessionSeconds]);

  const accuracyLabel =
    learningStats.accuracyPercent !== null ? `${learningStats.accuracyPercent}%` : '--';

  const lastPositionLabel = useMemo(() => {
    if (!lastBrowsingState) return '主界面时间轴（默认今日课程行）';
    if (lastBrowsingState.view === 'lesson' && lastBrowsingState.activeLessonRef) {
      const targetCourse = courses.find(
        (c) => c.id === lastBrowsingState.activeLessonRef?.courseId
      );
      const dayIdx = lastBrowsingState.activeLessonRef.dayIndex;
      const slot = targetCourse?.dailyPlan.find((d) => d.dayIndex === dayIdx);
      const cName = targetCourse?.name || '课程';
      const sTitle = slot?.title || `第 ${dayIdx} 讲`;
      return `${cName} · ${sTitle}（滚动位置 ${Math.round(lastBrowsingState.scrollY || 0)}px）`;
    }
    if (lastBrowsingState.view === 'daily' && lastBrowsingState.focusedDate) {
      return `单日课程聚焦 · ${lastBrowsingState.focusedDate}（滚动位置 ${Math.round(lastBrowsingState.scrollY || 0)}px）`;
    }
    const filterCourse =
      lastBrowsingState.selectedCourseFilter &&
      lastBrowsingState.selectedCourseFilter !== 'all'
        ? courses.find((c) => c.id === lastBrowsingState.selectedCourseFilter)?.name
        : null;
    return `主界面时间轴${filterCourse ? `（筛选：${filterCourse}）` : ''} · 滚动位置 ${Math.round(lastBrowsingState.scrollY || 0)}px`;
  }, [lastBrowsingState, courses]);

  const [providerMode, setProviderMode] = useState<'builtin_gemini' | 'openai_compatible'>(
    settings.providerMode
  );
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl);
  const [modelName, setModelName] = useState(settings.modelName);
  const [newApiKey, setNewApiKey] = useState('');
  const [defaultLearnerLevel, setDefaultLearnerLevel] = useState<LearnerLevel>(
    settings.defaultLearnerLevel || 'intermediate'
  );
  const initialDual = mapLegacyLevelToDualAxis(settings.defaultLearnerLevel || 'intermediate');
  const [defaultLearnerBaseline, setDefaultLearnerBaseline] = useState<LearnerBaselinePreset>(
    settings.defaultLearnerBaseline || initialDual.baseline
  );
  const [defaultCustomLearnerBaseline, setDefaultCustomLearnerBaseline] = useState<string>(
    settings.defaultCustomLearnerBaseline || ''
  );
  const [defaultLearningDepth, setDefaultLearningDepth] = useState<LearningDepthPreset>(
    settings.defaultLearningDepth || initialDual.depth
  );
  const [defaultCustomLearningDepth, setDefaultCustomLearningDepth] = useState<string>(
    settings.defaultCustomLearningDepth || ''
  );
  const [showAdvancedWorkflowDetails, setShowAdvancedWorkflowDetails] = useState<boolean>(
    Boolean(settings.showAdvancedWorkflowDetails)
  );
  const [showContentCategoryBadges, setShowContentCategoryBadges] = useState<boolean>(
    Boolean(settings.showContentCategoryBadges)
  );
  const [composeProfile, setComposeProfile] = useState<SubjectProfile>('electronics_engineering');
  const [promptModules, setPromptModules] = useState<PromptModuleToggles>(settings.promptModules);
  const [syllabusSystemPrompt, setSyllabusSystemPrompt] = useState(settings.syllabusSystemPrompt);
  const [courseSystemPrompt, setCourseSystemPrompt] = useState(settings.courseSystemPrompt);
  const [englishSystemPrompt, setEnglishSystemPrompt] = useState(settings.englishSystemPrompt);
  const [customTeachingSupplement, setCustomTeachingSupplement] = useState(
    settings.customTeachingSupplement || ''
  );

  const [activePromptTab, setActivePromptTab] = useState<'course' | 'english' | 'syllabus'>(
    'course'
  );
  const [isComposing, setIsComposing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    const nextFallback = mapLegacyLevelToDualAxis(settings.defaultLearnerLevel || 'intermediate');
    setProviderMode(settings.providerMode);
    setApiBaseUrl(settings.apiBaseUrl);
    setModelName(settings.modelName);
    setDefaultLearnerLevel(settings.defaultLearnerLevel || 'intermediate');
    setDefaultLearnerBaseline(settings.defaultLearnerBaseline || nextFallback.baseline);
    setDefaultCustomLearnerBaseline(settings.defaultCustomLearnerBaseline || '');
    setDefaultLearningDepth(settings.defaultLearningDepth || nextFallback.depth);
    setDefaultCustomLearningDepth(settings.defaultCustomLearningDepth || '');
    setShowAdvancedWorkflowDetails(Boolean(settings.showAdvancedWorkflowDetails));
    setShowContentCategoryBadges(Boolean(settings.showContentCategoryBadges));
    setPromptModules(settings.promptModules);
    setSyllabusSystemPrompt(settings.syllabusSystemPrompt);
    setCourseSystemPrompt(settings.courseSystemPrompt);
    setEnglishSystemPrompt(settings.englishSystemPrompt);
    setCustomTeachingSupplement(settings.customTeachingSupplement || '');
    setNewApiKey('');
    setSavedNotice(false);
    setTestResult(null);
  }, [settings, isOpen]);

  // Render animated overlay via AnimatePresence below

  const handleToggleModule = (key: keyof PromptModuleToggles) => {
    setPromptModules((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleComposeFromSkill = async (
    targetProfile: SubjectProfile = composeProfile,
    targetBaseline: LearnerBaselinePreset = defaultLearnerBaseline,
    targetDepth: LearningDepthPreset = defaultLearningDepth,
    targetModules: PromptModuleToggles = promptModules
  ) => {
    setIsComposing(true);
    try {
      const derivedLevel = deriveLegacyLearnerLevel(targetBaseline, targetDepth);
      const res = await fetch('/api/compose-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectProfile: targetProfile,
          learnerLevel: derivedLevel,
          learnerBaseline: targetBaseline,
          customLearnerBaseline: defaultCustomLearnerBaseline.trim(),
          learningDepth: targetDepth,
          customLearningDepth: defaultCustomLearningDepth.trim(),
          promptModules: targetModules,
          customSupplement: customTeachingSupplement,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.prompt) {
          setCourseSystemPrompt(data.prompt);
        }
      }
    } finally {
      setIsComposing(false);
    }
  };

  const handleTestConnectivity = async () => {
    setIsTestingApi(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerMode,
          apiBaseUrl: apiBaseUrl.trim(),
          modelName: modelName.trim(),
          newApiKey: newApiKey.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setTestResult({
          ok: true,
          message: data.message || `接口连通正常 (${data.model || modelName})`,
        });
      } else {
        setTestResult({
          ok: false,
          message: data.error || data.message || '接口连通测试失败',
        });
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err?.message || '无法连接本地测试接口',
      });
    } finally {
      setIsTestingApi(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSavedNotice(false);
    try {
      const nextLegacyLevel = deriveLegacyLearnerLevel(defaultLearnerBaseline, defaultLearningDepth);
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerMode,
          apiBaseUrl: apiBaseUrl.trim(),
          modelName: modelName.trim(),
          newApiKey: newApiKey.trim() || undefined,
          defaultLearnerLevel: nextLegacyLevel || defaultLearnerLevel,
          defaultLearnerBaseline,
          defaultCustomLearnerBaseline: defaultCustomLearnerBaseline.trim(),
          defaultLearningDepth,
          defaultCustomLearningDepth: defaultCustomLearningDepth.trim(),
          showAdvancedWorkflowDetails,
          showContentCategoryBadges,
          promptModules,
          syllabusSystemPrompt,
          courseSystemPrompt,
          englishSystemPrompt,
          customTeachingSupplement,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onSettingsUpdated(data.settings, data.promptPresets);
        setNewApiKey('');
        setSavedNotice(true);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const coursePresets = promptPresets.filter((p) => p.targetField === 'course');
  const englishPresets = promptPresets.filter((p) => p.targetField === 'english');
  const syllabusPresets = promptPresets.filter((p) => p.targetField === 'syllabus');

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="settings-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
        >
          <motion.div
            key="settings-modal-panel"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.21, ease: [0.16, 1, 0.3, 1] }}
            className="glow-border w-full max-w-3xl bg-black border border-neutral-800 rounded-md p-6 my-8 max-h-[92vh] overflow-y-auto shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-neutral-800 pb-4 mb-5">
              <div>
                <h2 id="settings-modal-title" className="font-display text-lg font-semibold text-white">
                  设置
                </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              配置模型接口参数与可复用的课件生成提示词系统（提示词源文件位于 learn-everything-prompts）
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭设置窗口"
            className="p-1.5 text-neutral-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          {/* 0a. 学习数据统计（原左下角统计面板迁移至设置中心） */}
          <div
            data-testid="settings-stats-section"
            role="region"
            aria-label="学习数据统计详情"
            className="glow-border border border-neutral-800 rounded p-4 bg-neutral-950/70 space-y-3.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-900 pb-2.5">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-sky-400 shrink-0" />
                <span className="font-display text-xs font-semibold text-white tracking-wide">
                  学习数据统计
                </span>
              </div>
              <span className="font-mono text-[10px] text-neutral-500">
                STUDY OVERVIEW · 实时累计与离线判分统计
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="border border-neutral-900 bg-black/80 rounded p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                  <Clock className="w-3 h-3 text-neutral-500" />
                  <span>课件累计学习</span>
                </div>
                <div
                  data-testid="settings-stat-total-time"
                  className="font-mono text-sm font-semibold text-white mt-1 tabular-nums"
                >
                  {formatStudyDuration(learningStats.totalStudySeconds)}
                </div>
              </div>

              <div className="border border-neutral-900 bg-black/80 rounded p-3">
                <div className="text-[11px] text-neutral-400">今日课件学习</div>
                <div
                  data-testid="settings-stat-today-time"
                  className="font-mono text-sm font-semibold text-sky-300 mt-1 tabular-nums"
                >
                  {formatStudyDuration(learningStats.todayStudySeconds)}
                </div>
              </div>

              <div className="border border-neutral-900 bg-black/80 rounded p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                  <CheckCircle2 className="w-3 h-3 text-neutral-500" />
                  <span>答题综合正确率</span>
                </div>
                <div
                  data-testid="settings-stat-accuracy"
                  className="font-mono text-sm font-semibold text-white mt-1 tabular-nums"
                >
                  {accuracyLabel}
                </div>
                <div className="text-[10px] font-mono text-neutral-500 mt-0.5">
                  {learningStats.totalQuestionsAnswered > 0
                    ? `${learningStats.totalQuestionsCorrect}/${learningStats.totalQuestionsAnswered} 题`
                    : '暂无交卷记录'}
                </div>
              </div>

              <div className="border border-neutral-900 bg-black/80 rounded p-3">
                <div className="text-[11px] text-neutral-400">已生成课件</div>
                <div
                  data-testid="settings-stat-lessons"
                  className="font-mono text-sm font-semibold text-neutral-200 mt-1 tabular-nums"
                >
                  {learningStats.completedLessonsCount}/{learningStats.totalLessonsCount} 讲
                </div>
                <div className="text-[10px] font-mono text-neutral-500 mt-0.5">
                  共 {courses.length} 门课程
                </div>
              </div>
            </div>

            {courses.length > 0 && (
              <div className="pt-1 space-y-1.5">
                <div className="text-[11px] text-neutral-500 font-mono">
                  各课程学习时长与课件进度：
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {courses.map((course) => {
                    const cSeconds = studyStats.secondsByCourse?.[course.id] || 0;
                    const cGenerated = course.dailyPlan.filter((d) => Boolean(d.lesson)).length;
                    return (
                      <div
                        key={course.id}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-neutral-900 bg-black/60 text-xs"
                      >
                        <span className="text-neutral-200 truncate">{course.name}</span>
                        <span className="font-mono text-[11px] text-neutral-400 shrink-0 tabular-nums">
                          {formatStudyDuration(cSeconds)} · {cGenerated}/{course.dailyPlan.length} 讲
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-900 text-[11px] text-neutral-400">
              <div className="inline-flex items-center gap-1.5 min-w-0">
                <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="text-neutral-500 shrink-0">当前记忆浏览位置：</span>
                <span
                  data-testid="settings-last-position-summary"
                  className="font-mono text-neutral-300 truncate"
                >
                  {lastPositionLabel}
                </span>
              </div>
              <span className="text-[10px] font-mono text-neutral-500">
                刷新或重开应用自动恢复
              </span>
            </div>
          </div>

          {/* 0b. 界面精简、新手引导与工作流细节开关 */}
          <div className="glow-border border border-neutral-800 rounded p-3.5 bg-neutral-950/60 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-white">
                工作台界面模式与新手引导
              </div>
              {onOpenWelcome && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenWelcome();
                  }}
                  className="glow-border inline-flex items-center gap-1.5 px-3 py-1 text-xs border border-neutral-700 hover:border-sky-400/70 text-neutral-200 hover:text-white bg-black rounded transition-colors"
                >
                  <Compass className="w-3.5 h-3.5 text-sky-400" />
                  <span>重新打开新手引导与模式选择</span>
                </button>
              )}
            </div>
            <label
              htmlFor="settings-advanced-workflow-toggle"
              className="flex items-start gap-2.5 text-xs cursor-pointer"
            >
              <input
                id="settings-advanced-workflow-toggle"
                type="checkbox"
                checked={showAdvancedWorkflowDetails}
                onChange={(e) => setShowAdvancedWorkflowDetails(e.target.checked)}
                className="mt-0.5 accent-white"
              />
              <div>
                <div className="text-neutral-200 font-medium">
                  显示 PDF 切分与课程大纲编辑细节（高级模式）
                </div>
                <div className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">
                  默认关闭，隐藏页码偏移量换算、区域起止页码表格、大纲逐节字段修改与手动增删控件，仅保留“划分区域 ➔ 生成并确认大纲 ➔ 生成课件”主操作流；需要人工微调页码或目录细节时可在此打开。
                </div>
              </div>
            </label>

            <label
              htmlFor="settings-content-category-badges-toggle"
              className="flex items-start gap-2.5 text-xs cursor-pointer pt-2.5 border-t border-neutral-900"
            >
              <input
                id="settings-content-category-badges-toggle"
                type="checkbox"
                checked={showContentCategoryBadges}
                onChange={(e) => setShowContentCategoryBadges(e.target.checked)}
                className="mt-0.5 accent-white"
              />
              <div>
                <div className="text-neutral-200 font-medium">
                  显示单节课件中的内容分类标签与提示框（教材正文 / 先修补充 / 直观解释 / 边界与拓展）
                </div>
                <div className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">
                  默认关闭，在单节课件阅读页中隐藏“教材正文（课本内容）”“边界与拓展（拓展内容）”“先修补充”“直观解释”等分类标签与色块边框，保持纯净连贯的正文排版；开启后展示四类深色语义提示框。
                </div>
              </div>
            </label>
          </div>

          {/* 1. 接口模式选择 */}
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-2">
              LLM 接口模式（保存在本地服务端 data/settings.json，不暴露于前端代码）
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setProviderMode('openai_compatible');
                  if (modelName === 'gemini-3.8-flash') {
                    setModelName('gpt-4o-mini');
                  }
                }}
                className={`glow-border p-3 rounded border text-left text-xs transition-colors ${
                  providerMode === 'openai_compatible'
                    ? 'bg-neutral-900 border-white text-white'
                    : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                }`}
              >
                <div className="font-medium mb-0.5">OpenAI 兼容接口（多模态模型）</div>
                <div className="text-neutral-500">
                  支持 GPT-4o、Gemini OpenAI 兼容端点等可直读 PDF 文件的多模态 /v1/chat/completions 接口
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setProviderMode('builtin_gemini');
                  if (!modelName.startsWith('gemini-')) {
                    setModelName('gemini-3.8-flash');
                  }
                }}
                className={`glow-border p-3 rounded border text-left text-xs transition-colors ${
                  providerMode === 'builtin_gemini'
                    ? 'bg-neutral-900 border-white text-white'
                    : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                }`}
              >
                <div className="font-medium mb-0.5">服务端默认多模态模型（Gemini）</div>
                <div className="text-neutral-500">
                  使用服务端环境变量凭证与 gemini-3.8-flash 原生直读 PDF 原文件
                </div>
              </button>
            </div>
          </div>

          {/* 2. API 接口地址、模型名称与服务端凭据 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="settings-base-url"
                className="block text-xs font-medium text-neutral-300 mb-1.5"
              >
                API 接口地址 (Base URL)
              </label>
              <input
                id="settings-base-url"
                type="text"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-xs font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
              />
            </div>

            <div>
              <label
                htmlFor="settings-model-name"
                className="block text-xs font-medium text-neutral-300 mb-1.5"
              >
                模型名称 (Model Name)
              </label>
              <input
                id="settings-model-name"
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="例如：deepseek-chat / gpt-4o / gemini-3.8-flash"
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-xs font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="settings-local-credential"
                className="text-xs font-medium text-neutral-300"
              >
                本地服务端调用凭证（仅写入本地 data/settings.json，前端不回显）
              </label>
              <span className="text-xs font-mono text-neutral-500">
                状态：
                {settings.hasCustomApiKey
                  ? '已保存在本地服务端'
                  : settings.hasBuiltinGeminiKey
                    ? '使用环境变量默认凭证'
                    : '未配置'}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="settings-local-credential"
                type="password"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder={
                  settings.hasCustomApiKey
                    ? '已在本地服务端保存凭证（留空保持不变，输入新值则覆盖）'
                    : '输入自定义接口凭证以保存到本地服务端配置'
                }
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-xs font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
              />
              <button
                type="button"
                onClick={handleTestConnectivity}
                disabled={isTestingApi}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-neutral-700 hover:border-neutral-500 bg-neutral-950 text-neutral-200 hover:text-white rounded transition-colors whitespace-nowrap disabled:opacity-50"
              >
                <Activity className="w-3.5 h-3.5" />
                <span>{isTestingApi ? '测试中...' : '测试接口连通性'}</span>
              </button>
            </div>
            {testResult && (
              <p
                className={`mt-1.5 text-xs font-mono ${
                  testResult.ok ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {testResult.message}
              </p>
            )}
          </div>

          {/* 3. 可配置、可复用的课件生成提示词模块 */}
          <div className="border-t border-neutral-800 pt-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-white">
                  模块化课件生成提示词配置
                </h3>
                <p className="text-xs text-neutral-500">
                  可按学科、学习者水平和教学要求模块组合生成提示词，也可直接修改下方文本
                </p>
              </div>
              <div className="flex items-center gap-1.5 border border-neutral-800 rounded p-1 bg-neutral-950 shrink-0">
                <button
                  type="button"
                  onClick={() => setActivePromptTab('course')}
                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    activePromptTab === 'course'
                      ? 'bg-white text-black font-medium'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  课件生成提示词
                </button>
                <button
                  type="button"
                  onClick={() => setActivePromptTab('english')}
                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    activePromptTab === 'english'
                      ? 'bg-white text-black font-medium'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  英语文章提示词
                </button>
                <button
                  type="button"
                  onClick={() => setActivePromptTab('syllabus')}
                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                    activePromptTab === 'syllabus'
                      ? 'bg-white text-black font-medium'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  课程大纲提示词
                </button>
              </div>
            </div>

            {activePromptTab === 'course' && (
              <div className="space-y-4">
                {/* 学科与学习者水平选择 + 教学要求模块开关 */}
                <div className="border border-neutral-900 rounded p-3.5 bg-neutral-950/50 space-y-3">
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-neutral-400 mb-1">
                        学科适配模块
                      </label>
                      <select
                        value={composeProfile}
                        onChange={(e) => {
                          const nextProfile = e.target.value as SubjectProfile;
                          setComposeProfile(nextProfile);
                        }}
                        className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-neutral-500"
                      >
                        <option value="electronics_engineering">电子技术与工科（电路图/连续推导）</option>
                        <option value="math_physics">数学与物理（几何物理图像/严密证明）</option>
                        <option value="computer_science">计算机科学（状态图示/核心代码）</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="settings-default-baseline"
                          className="block text-xs text-neutral-400 mb-1"
                        >
                          默认当前水平（起点铺垫门槛）
                        </label>
                        <select
                          id="settings-default-baseline"
                          value={defaultLearnerBaseline}
                          onChange={(e) => {
                            const next = e.target.value as LearnerBaselinePreset;
                            setDefaultLearnerBaseline(next);
                            setDefaultLearnerLevel(
                              deriveLegacyLearnerLevel(next, defaultLearningDepth)
                            );
                          }}
                          className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-neutral-500"
                        >
                          <option value="zero_base">{BASELINE_LABELS.zero_base}</option>
                          <option value="partial_base">{BASELINE_LABELS.partial_base}</option>
                          <option value="solid_base">{BASELINE_LABELS.solid_base}</option>
                          <option value="custom">自定义当前水平</option>
                        </select>
                        {defaultLearnerBaseline === 'custom' && (
                          <input
                            type="text"
                            value={defaultCustomLearnerBaseline}
                            onChange={(e) => setDefaultCustomLearnerBaseline(e.target.value)}
                            placeholder="填写默认当前水平背景..."
                            className="mt-1.5 w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
                          />
                        )}
                      </div>

                      <div>
                        <label
                          htmlFor="settings-default-depth"
                          className="block text-xs text-neutral-400 mb-1"
                        >
                          默认学习目标深度（终点推导难度）
                        </label>
                        <select
                          id="settings-default-depth"
                          value={defaultLearningDepth}
                          onChange={(e) => {
                            const next = e.target.value as LearningDepthPreset;
                            setDefaultLearningDepth(next);
                            setDefaultLearnerLevel(
                              deriveLegacyLearnerLevel(defaultLearnerBaseline, next)
                            );
                          }}
                          className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-neutral-500"
                        >
                          <option value="understand_basics">{DEPTH_LABELS.understand_basics}</option>
                          <option value="master_textbook">{DEPTH_LABELS.master_textbook}</option>
                          <option value="deep_rigorous">{DEPTH_LABELS.deep_rigorous}</option>
                          <option value="custom">自定义学习目标深度</option>
                        </select>
                        {defaultLearningDepth === 'custom' && (
                          <input
                            type="text"
                            value={defaultCustomLearningDepth}
                            onChange={(e) => setDefaultCustomLearningDepth(e.target.value)}
                            placeholder="填写默认目标深度要求..."
                            className="mt-1.5 w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
                          />
                        )}
                      </div>
                    </div>

                    <p className="text-[11px] text-neutral-400 leading-relaxed border border-neutral-900 bg-black/70 rounded px-2.5 py-1.5">
                      {
                        resolveLearnerProfile({
                          learnerBaseline: defaultLearnerBaseline,
                          customLearnerBaseline: defaultCustomLearnerBaseline,
                          learningDepth: defaultLearningDepth,
                          customLearningDepth: defaultCustomLearningDepth,
                        }).strategySummary
                      }
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-neutral-400">
                        启用的教学要求模块（勾选后点击右侧按钮组合到下方提示词）
                      </span>
                      <button
                        type="button"
                        disabled={isComposing}
                        onClick={() =>
                          handleComposeFromSkill(
                            composeProfile,
                            defaultLearnerBaseline,
                            defaultLearningDepth,
                            promptModules
                          )
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-700 rounded transition-colors"
                      >
                        <Sliders className="w-3 h-3" />
                        <span>{isComposing ? '组合中...' : '按所选模块重新组合提示词'}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {MODULE_LABELS.map((item) => (
                        <label
                          key={item.key}
                          className="flex items-start gap-2 p-2 rounded border border-neutral-900 bg-black text-xs cursor-pointer hover:border-neutral-700"
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(promptModules?.[item.key])}
                            onChange={() => handleToggleModule(item.key)}
                            className="mt-0.5 accent-white"
                          />
                          <div>
                            <div className="text-neutral-200 font-medium">{item.label}</div>
                            <div className="text-[11px] text-neutral-500">{item.desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 预设切换与自定义编辑 */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="settings-course-prompt"
                      className="text-xs font-medium text-neutral-300"
                    >
                      自定义课件生成提示词（可直接修改）
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {coursePresets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setCourseSystemPrompt(preset.prompt)}
                          className="px-2 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors"
                          title={preset.description}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    id="settings-course-prompt"
                    rows={8}
                    value={courseSystemPrompt}
                    onChange={(e) => setCourseSystemPrompt(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded p-3 text-xs font-mono text-neutral-200 leading-relaxed focus:outline-none focus:border-neutral-500"
                  />
                </div>
              </div>
            )}

            {activePromptTab === 'english' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="settings-english-prompt"
                    className="text-xs font-medium text-neutral-300"
                  >
                    英语文章与词汇课件生成提示词
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {englishPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setEnglishSystemPrompt(preset.prompt)}
                        className="px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors"
                        title={preset.description}
                      >
                        <RotateCcw className="w-3 h-3 inline mr-1" />
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  id="settings-english-prompt"
                  rows={8}
                  value={englishSystemPrompt}
                  onChange={(e) => setEnglishSystemPrompt(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded p-3 text-xs font-mono text-neutral-200 leading-relaxed focus:outline-none focus:border-neutral-500"
                />
              </div>
            )}

            {activePromptTab === 'syllabus' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="settings-syllabus-prompt"
                    className="text-xs font-medium text-neutral-300"
                  >
                    学习资料解析与每日课程计划划分提示词
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {syllabusPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setSyllabusSystemPrompt(preset.prompt)}
                        className="px-2.5 py-1 text-xs border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white rounded transition-colors"
                        title={preset.description}
                      >
                        <RotateCcw className="w-3 h-3 inline mr-1" />
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  id="settings-syllabus-prompt"
                  rows={8}
                  value={syllabusSystemPrompt}
                  onChange={(e) => setSyllabusSystemPrompt(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded p-3 text-xs font-mono text-neutral-200 leading-relaxed focus:outline-none focus:border-neutral-500"
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-neutral-800">
            <div className="flex items-center gap-3 text-xs text-neutral-400">
              <a
                href="/learn-everything-prompts.zip"
                download="learn-everything-prompts.zip"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 hover:border-neutral-500 text-neutral-200 hover:text-white rounded transition-colors"
                title="打包下载全套课件与教学提示词压缩包 (.zip)"
              >
                <Download className="w-3.5 h-3.5" />
                <span>下载全部提示词包 (.zip)</span>
              </a>
              {savedNotice && (
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <Check className="w-3.5 h-3.5" />
                  <span>设置已保存到本地配置</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-neutral-300 hover:text-white border border-neutral-800 rounded transition-colors"
              >
                关闭
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 text-xs font-medium bg-white text-black hover:bg-neutral-200 rounded transition-colors disabled:opacity-50"
              >
                {isSaving ? '保存中...' : '保存设置'}
              </button>
            </div>
          </div>
        </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
