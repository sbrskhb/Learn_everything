import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { FileText, Plus, Trash2, Upload, X } from 'lucide-react';
import type {
  Course,
  CourseCategory,
  CourseGenerationMode,
  EnglishArticleMode,
  LanguageInputMode,
  LanguageLearningPurpose,
  LearnerBaselinePreset,
  LearnerLevel,
  LearningDepthPreset,
  UploadedMaterial,
  VocabBank,
  VocabItem,
} from '../types';
import {
  assignStableVocabIds,
  computeVocabSetDifference,
  getTodayDateString,
  parseVocabularyInput,
} from '../utils/learningLogic';
import {
  computeEnglishReadingPlanStats,
  resolveLanguageInputMode,
} from '../utils/vocabCoverage';
import {
  deriveLegacyLearnerLevel,
  getBaselinePresetOptions,
  getDepthPresetOptions,
  mapLegacyLevelToDualAxis,
  resolveLearnerProfile,
} from '../utils/learnerProfile';
import { parseUploadedFile, readApiJson } from '../utils/fileExtractor';

interface AddCourseModalProps {
  isOpen: boolean;
  defaultLearnerLevel?: LearnerLevel;
  defaultLearnerBaseline?: LearnerBaselinePreset;
  defaultCustomLearnerBaseline?: string;
  defaultLearningDepth?: LearningDepthPreset;
  defaultCustomLearningDepth?: string;
  defaultGenerationMode?: CourseGenerationMode;
  vocabBanks?: VocabBank[];
  onVocabBanksChanged?: (banks: VocabBank[]) => void;
  onOpenVocabManager?: () => void;
  onClose: () => void;
  onCourseCreated: (course: Course) => void;
}

const INPUT_MODE_META: Record<
  LanguageInputMode,
  { label: string; desc: string }
> = {
  vocab_only: {
    label: '输入组合：仅词库',
    desc: 'LLM 分析词库语义规划 N 个主题与文章，按稳定 ID 分配并追踪正文实际覆盖',
  },
  material_only: {
    label: '输入组合：仅教材 / 资料',
    desc: '严格依据上传教材结构、书签与页面内容规划循序渐进的语言课程大纲',
  },
  vocab_and_material: {
    label: '输入组合：词库 + 教材整合',
    desc: '以教材决定主要知识顺序，词库作为覆盖目标有机融入并在必要时补充单元',
  },
  ai_autonomous: {
    label: '输入组合：AI 自主规划',
    desc: '未额外上传词库与教材，由 AI 结合目标语言、学习目的、兴趣偏好与当前水平自主规划',
  },
};

export const AddCourseModal: React.FC<AddCourseModalProps> = ({
  isOpen,
  defaultLearnerLevel = 'intermediate',
  defaultLearnerBaseline,
  defaultCustomLearnerBaseline = '',
  defaultLearningDepth,
  defaultCustomLearningDepth = '',
  defaultGenerationMode = 'api',
  vocabBanks = [],
  onVocabBanksChanged,
  onOpenVocabManager,
  onClose,
  onCourseCreated,
}) => {
  const initialDual = mapLegacyLevelToDualAxis(defaultLearnerLevel);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CourseCategory>('stem');
  const [generationMode, setGenerationMode] = useState<CourseGenerationMode>(defaultGenerationMode);
  const [learnerBaseline, setLearnerBaseline] = useState<LearnerBaselinePreset>(
    defaultLearnerBaseline || initialDual.baseline
  );
  const [customLearnerBaseline, setCustomLearnerBaseline] = useState(
    defaultCustomLearnerBaseline
  );
  const [learningDepth, setLearningDepth] = useState<LearningDepthPreset>(
    defaultLearningDepth || initialDual.depth
  );
  const [customLearningDepth, setCustomLearningDepth] = useState(defaultCustomLearningDepth);
  const [goal, setGoal] = useState('');
  const [durationDays, setDurationDays] = useState<number>(15);
  const [startDate, setStartDate] = useState<string>(getTodayDateString());
  const [extraRequirements, setExtraRequirements] = useState('');
  const [materials, setMaterials] = useState<UploadedMaterial[]>([]);
  const [isParsingFiles, setIsParsingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ percent: number; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const nextFallback = mapLegacyLevelToDualAxis(defaultLearnerLevel);
      setGenerationMode(defaultGenerationMode || 'api');
      setLearnerBaseline(defaultLearnerBaseline || nextFallback.baseline);
      setCustomLearnerBaseline(defaultCustomLearnerBaseline || '');
      setLearningDepth(defaultLearningDepth || nextFallback.depth);
      setCustomLearningDepth(defaultCustomLearningDepth || '');
    }
  }, [
    isOpen,
    defaultGenerationMode,
    defaultLearnerLevel,
    defaultLearnerBaseline,
    defaultCustomLearnerBaseline,
    defaultLearningDepth,
    defaultCustomLearningDepth,
  ]);

  // Language course specific states (supports custom vocab banks, materials, or autonomous planning)
  const [learningPurpose, setLearningPurpose] = useState<LanguageLearningPurpose>('interest');
  const [interestPreferences, setInterestPreferences] = useState<string>('');
  const [targetBankId, setTargetBankId] = useState<string>('none');
  const [excludedBankId, setExcludedBankId] = useState<string>('none');
  const [customTargetVocabText, setCustomTargetVocabText] = useState<string>('');
  const [customExcludedVocabText, setCustomExcludedVocabText] = useState<string>('');
  const [inlineSaveBankName, setInlineSaveBankName] = useState<string>('');
  const [isSavingInlineBank, setIsSavingInlineBank] = useState<boolean>(false);
  const [inlineBankFeedback, setInlineBankFeedback] = useState<string | null>(null);

  const [topicCountInput, setTopicCountInput] = useState<string>('');
  const [newWordsPerArticle, setNewWordsPerArticle] = useState<number>(15);
  const [targetWordDensityPct, setTargetWordDensityPct] = useState<number>(4);
  const [expectedRepeatsPerWord, setExpectedRepeatsPerWord] = useState<number>(2);
  const [articleMode, setArticleMode] = useState<EnglishArticleMode>('llm_original');
  const [preferredSources, setPreferredSources] = useState<string>(
    'The New Yorker, The Economist, Scientific American'
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Compute live vocabulary set difference and stable IDs for language courses
  const vocabDiff = useMemo(() => {
    const selectedTarget = vocabBanks.find((b) => b.id === targetBankId);
    const customTarget = parseVocabularyInput(customTargetVocabText);
    const combinedTarget: VocabItem[] = [
      ...(selectedTarget?.words || []),
      ...customTarget,
    ];

    const selectedExcluded = vocabBanks.find((b) => b.id === excludedBankId);
    const customExcluded = parseVocabularyInput(customExcludedVocabText);
    const combinedExcluded: VocabItem[] = [
      ...(selectedExcluded?.words || []),
      ...customExcluded,
    ];

    const diff = computeVocabSetDifference(combinedTarget, combinedExcluded);
    return {
      ...diff,
      effectiveWords: assignStableVocabIds(diff.effectiveWords),
    };
  }, [vocabBanks, targetBankId, excludedBankId, customTargetVocabText, customExcludedVocabText]);

  const languageInputMode = useMemo(
    () => resolveLanguageInputMode(vocabDiff.effectiveWords.length, materials.length),
    [vocabDiff.effectiveWords.length, materials.length]
  );

  const readingPlanStats = useMemo(
    () =>
      computeEnglishReadingPlanStats({
        effectiveTotal: vocabDiff.effectiveWords.length,
        newWordsPerArticle,
        targetWordDensity: Math.max(0.005, (Number(targetWordDensityPct) || 4) / 100),
        expectedRepeatsPerWord,
      }),
    [
      vocabDiff.effectiveWords.length,
      newWordsPerArticle,
      targetWordDensityPct,
      expectedRepeatsPerWord,
    ]
  );

  if (!isOpen) return null;

  const handleMaterialFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setIsParsingFiles(true);
    setErrorMsg(null);
    setUploadProgress({ percent: 2, message: '准备上传文件...' });
    try {
      const parsedItems: UploadedMaterial[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const item = await parseUploadedFile(f, {
          onProgress: (percent, message) => {
            setUploadProgress({ percent, message });
          },
        });
        parsedItems.push(item);
      }
      setMaterials((prev) => [...prev, ...parsedItems]);
    } catch (err: any) {
      setErrorMsg(err?.message || '上传或读取资料失败，请重试');
    } finally {
      setIsParsingFiles(false);
      setUploadProgress(null);
      e.target.value = '';
    }
  };

  const handleVocabFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'target' | 'excluded'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (target === 'target') {
        setCustomTargetVocabText((prev) => (prev ? `${prev}\n${text}` : text));
      } else {
        setCustomExcludedVocabText((prev) => (prev ? `${prev}\n${text}` : text));
      }
    } catch {
      setErrorMsg('读取词库文件失败，请使用 UTF-8 编码的 TXT/CSV/JSON 文件');
    } finally {
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!name.trim()) {
      setErrorMsg('请输入课程名称');
      return;
    }
    if (!goal.trim()) {
      setErrorMsg('请输入学习目标');
      return;
    }
    if (learnerBaseline === 'custom' && !customLearnerBaseline.trim()) {
      setErrorMsg('请填写自定义的「我的当前水平」，或选择上方预设选项');
      return;
    }
    if (learningDepth === 'custom' && !customLearningDepth.trim()) {
      setErrorMsg('请填写自定义的「我的学习目标深度」，或选择上方预设选项');
      return;
    }
    if (
      category === 'english' &&
      vocabDiff.targetTotal > 0 &&
      vocabDiff.effectiveWords.length === 0
    ) {
      setErrorMsg('目标词库已全部被排除词库抵消（待学词汇为 0），请调整词库或清除排除词库');
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedTargetBank = vocabBanks.find((b) => b.id === targetBankId);
      const selectedExcludedBank = vocabBanks.find((b) => b.id === excludedBankId);
      const targetLabel =
        selectedTargetBank?.name ||
        (customTargetVocabText.trim() ? '临时导入目标词表' : '无外加词库');
      const excludedLabel =
        selectedExcludedBank?.name ||
        (customExcludedVocabText.trim() ? '临时导入排除词表' : '无排除词库');
      const derivedLevel = deriveLegacyLearnerLevel(learnerBaseline, learningDepth);
      const parsedTopicCount = Number(topicCountInput);
      const cleanTopicCount =
        Number.isFinite(parsedTopicCount) && parsedTopicCount >= 1
          ? Math.min(50, Math.round(parsedTopicCount))
          : null;
      const clampedNewWords = Math.max(1, Math.min(100, Math.round(Number(newWordsPerArticle) || 15)));
      const clampedDensity = Math.max(
        0.005,
        Math.min(0.25, (Number(targetWordDensityPct) || 4) / 100)
      );
      const clampedRepeats = Math.max(1, Math.min(10, Number(expectedRepeatsPerWord) || 2));

      const res = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          category,
          generationMode,
          learnerLevel: derivedLevel,
          learnerBaseline,
          customLearnerBaseline: customLearnerBaseline.trim(),
          learningDepth,
          customLearningDepth: customLearningDepth.trim(),
          goal: goal.trim(),
          startDate,
          durationDays: Math.max(1, Math.min(180, Number(durationDays) || 15)),
          extraRequirements: extraRequirements.trim(),
          materials,
          englishConfig:
            category === 'english'
              ? {
                  targetBankId: selectedTargetBank?.id,
                  excludedBankId: selectedExcludedBank?.id,
                  targetBankName: targetLabel,
                  excludedBankName: excludedLabel,
                  totalTargetCount: vocabDiff.targetTotal,
                  excludedCount: vocabDiff.overlapCount,
                  effectiveWords: vocabDiff.effectiveWords,
                  dailyWordCount: clampedNewWords,
                  newWordsPerArticle: clampedNewWords,
                  targetWordDensity: clampedDensity,
                  expectedRepeatsPerWord: clampedRepeats,
                  topicCount: cleanTopicCount,
                  learningPurpose,
                  interestPreferences: interestPreferences.trim() || undefined,
                  inputMode: languageInputMode,
                  articleMode,
                  preferredSources: preferredSources.trim(),
                }
              : undefined,
        }),
      });

      const data = await readApiJson<{ course: Course }>(res);
      onCourseCreated(data.course);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || '创建课程失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-course-title"
    >
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="glow-border w-full max-w-2xl obsidian-surface border border-neutral-800 rounded-md p-6 my-8 max-h-[90vh] overflow-y-auto shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4 mb-5">
          <div>
            <h2 id="add-course-title" className="font-display text-xl font-bold text-white">
              添加课程
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              {category === 'english'
                ? '语言学习 3 阶段流程：选择任意输入组合（仅词库 / 仅教材 / 词库+教材 / AI 自主规划）➔ 1. 教材切分与词库差集 ➔ 2. 生成并确认主题与目标词大纲 ➔ 3. 逐节生成课件并追踪正文实际词汇覆盖'
                : '专业课 4 步工作流：提交课程要求与教材资料 ➔ 1. LLM 确定 PDF 划分区域并本地切割 ➔ 2. LLM 生成并确认课程大纲 (outline.json) ➔ 3. LLM 按小节逐节生成精讲课件（写完时评估学时并自动排程）'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="关闭添加课程窗口"
            className="p-1.5 text-neutral-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* 0. 课件生成方式选择（API / Agent / Chat） */}
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-2">
              课件生成方式（三种模式共享统一本地文件夹结构 courses/课程名称/，创建后可随时切换）
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setGenerationMode('api')}
                className={`glow-border p-2.5 rounded border text-left text-xs transition-colors ${
                  generationMode === 'api'
                    ? 'bg-neutral-900 border-white text-white'
                    : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                }`}
              >
                <div className="font-medium mb-0.5">API 自动生成</div>
                <div className="text-[11px] text-neutral-500">
                  {category === 'english'
                    ? '本地执行词库差集与每节随机分配，自动规划阅读主题大纲并逐节流式生成外刊精读与词汇解析课件'
                    : '先调用 LLM 规划 PDF 划分区域并脚本切割，再生成并确认大纲，最后逐节流式生成推导课件'}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setGenerationMode('agent')}
                className={`glow-border p-2.5 rounded border text-left text-xs transition-colors ${
                  generationMode === 'agent'
                    ? 'bg-neutral-900 border-white text-white'
                    : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                }`}
              >
                <div className="font-medium mb-0.5">Agent 课件模式</div>
                <div className="text-[11px] text-neutral-500">
                  {category === 'english'
                    ? '无需 API Key，本地完成词库差集与分节抽词，导出结构化提示词供 Agent 直接写入逐节英语精读课件'
                    : '无需 API Key，按顺序提供区域划分、大纲生成与逐节课件提示词供 Agent 操作本地文件夹'}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setGenerationMode('chat')}
                className={`glow-border p-2.5 rounded border text-left text-xs transition-colors ${
                  generationMode === 'chat'
                    ? 'bg-neutral-900 border-white text-white'
                    : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                }`}
              >
                <div className="font-medium mb-0.5">Chat 课件模式</div>
                <div className="text-[11px] text-neutral-500">
                  {category === 'english'
                    ? '无需 API Key，逐节复制含本节目标词表的提示词发送给网页 AI，粘贴回传即可保存精读文章与练习'
                    : '无需 API Key，按顺序复制区域划分、大纲与单节提示词并搭配切片 PDF 在外部对话导入'}
                </div>
              </button>
            </div>
          </div>

          {/* 1. 课程类型选择（已去除意义不明的“通用学科”，保留清晰的“专业课程与教材精讲”与“英语词汇与外刊精读”双模式） */}
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-2">
              课程类型（切换后下方配置项、水平描述与学习流程将自动适配）
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="category-stem"
                aria-pressed={category !== 'english'}
                onClick={() => setCategory('stem')}
                className={`glow-border p-2.5 rounded border text-left transition-colors ${
                  category !== 'english'
                    ? 'bg-neutral-900 border-white text-white'
                    : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                }`}
              >
                <div className="text-xs font-semibold mb-0.5">
                  专业课程与教材精讲（理工 / 数学 / 计算机 / 专业课）
                </div>
                <div className="text-[11px] text-neutral-500">
                  教材 PDF 智能切分 · 无跳步公式推导 · 分阶段图示与闭环自测
                </div>
              </button>
              <button
                type="button"
                data-testid="category-english"
                aria-pressed={category === 'english'}
                onClick={() => setCategory('english')}
                className={`glow-border p-2.5 rounded border text-left transition-colors ${
                  category === 'english'
                    ? 'bg-neutral-900 border-white text-white'
                    : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                }`}
              >
                <div className="text-xs font-semibold mb-0.5">
                  语言学习（英语 / 日语等外语）
                </div>
                <div className="text-[11px] text-neutral-500">
                  支持自定义词库、PDF 教材、词库+教材整合或 AI 自主规划 · 备考/兴趣双模式
                </div>
              </button>
            </div>
          </div>

          {/* 1b. 语言学习专属基础配置（学习目的 / 兴趣与内容偏好） */}
          {category === 'english' && (
            <div className="border border-neutral-800 rounded p-4 space-y-3.5 bg-neutral-950/50">
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                  学习目的
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="purpose-interest"
                    aria-pressed={learningPurpose === 'interest'}
                    onClick={() => setLearningPurpose('interest')}
                    className={`p-2 rounded border text-left transition-colors ${
                      learningPurpose === 'interest'
                        ? 'bg-neutral-900 border-white text-white'
                        : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                    }`}
                  >
                    <div className="text-xs font-semibold">兴趣学习</div>
                    <div className="text-[10px] text-neutral-500 mt-0.5">
                      重内容连贯、语境自然与实际运用
                    </div>
                  </button>
                  <button
                    type="button"
                    data-testid="purpose-exam"
                    aria-pressed={learningPurpose === 'exam'}
                    onClick={() => setLearningPurpose('exam')}
                    className={`p-2 rounded border text-left transition-colors ${
                      learningPurpose === 'exam'
                        ? 'bg-neutral-900 border-white text-white'
                        : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                    }`}
                  >
                    <div className="text-xs font-semibold">备考学习</div>
                    <div className="text-[10px] text-neutral-500 mt-0.5">
                      优先完整覆盖指定词库、教材与考点
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="interest-preferences-input"
                    className="text-xs font-medium text-neutral-300"
                  >
                    兴趣与内容偏好（可选，自然语言描述）
                  </label>
                  <span className="text-[11px] text-neutral-500">
                    影响主题权重分配，同时保持大纲主题广度与多样性
                  </span>
                </div>
                <textarea
                  id="interest-preferences-input"
                  rows={2}
                  value={interestPreferences}
                  onChange={(e) => setInterestPreferences(e.target.value)}
                  placeholder="例如：偏爱科技商业、认知心理学与日常实用对话，可多安排相关阅读主题，同时也希望兼顾生态、历史与社会议题。"
                  className="w-full bg-black border border-neutral-800 rounded px-3 py-2 text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
                />
              </div>
            </div>
          )}

          {/* 2. 课程名称与学习目标 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="course-name-input"
                className="block text-xs font-medium text-neutral-300 mb-1.5"
              >
                {category === 'english'
                  ? '语言课程名称（将自动创建本地课程文件夹）'
                  : '专业课程名称（将自动创建本地课程文件夹）'}
              </label>
              <input
                id="course-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  category === 'english'
                    ? '例如：雅思核心词汇精读 / 新标日进阶与生活会话'
                    : '例如：模拟电子技术基础 / 线性代数 / 算法导论'
                }
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
              />
            </div>

            <div>
              <label
                htmlFor="course-goal-input"
                className="block text-xs font-medium text-neutral-300 mb-1.5"
              >
                {category === 'english'
                  ? '学习目标（目标语种、主题范围、能力期望或考试目标）'
                  : '专业学习目标（期望攻克的章节、推导或工程能力）'}
              </label>
              <input
                id="course-goal-input"
                type="text"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder={
                  category === 'english'
                    ? '例如：掌握六级高频词并读懂外刊；或从零学完日语日常对话与短文'
                    : '例如：掌握运算放大器负反馈推导与频率响应分析'
                }
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
              />
            </div>
          </div>

          {/* 3. 学习期限与起始日期 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="course-duration-input"
                className="block text-xs font-medium text-neutral-300 mb-1.5"
              >
                {category === 'english'
                  ? '目标学习天数（用于写完课件后按预计学时自动分配学习日程）'
                  : '目标学习天数（用于写完课件后按预计学时自动分配日程，不限制大纲小节数）'}
              </label>
              <div className="flex items-center gap-1.5">
                {[7, 15, 30].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDurationDays(preset)}
                    className={`px-2.5 py-2 text-xs font-mono rounded border transition-colors whitespace-nowrap shrink-0 ${
                      durationDays === preset
                        ? 'bg-neutral-900 border-white text-white'
                        : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                    }`}
                  >
                    {preset}天
                  </button>
                ))}
                <input
                  id="course-duration-input"
                  type="number"
                  min={1}
                  max={180}
                  value={durationDays}
                  onChange={(e) => setDurationDays(Math.max(1, Number(e.target.value) || 1))}
                  className="w-20 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-2 text-sm font-mono text-white focus:outline-none focus:border-neutral-500"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="course-start-date"
                className="block text-xs font-medium text-neutral-300 mb-1.5"
              >
                起始日期
              </label>
              <input
                id="course-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-neutral-500"
              />
            </div>
          </div>

          {/* 3.5 双轴独立适配：我的当前水平 + 我的学习目标深度（随专业课/英语类型动态切换文案） */}
          <div className="space-y-4 border border-neutral-900 rounded p-3.5 bg-neutral-950/40">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <label className="text-xs font-medium text-neutral-200">
                  {category === 'english'
                    ? '我的当前语言水平（决定词汇门槛、语法铺垫与句法拆解细致度）'
                    : '我的当前水平（决定前段铺垫门槛：先修概念、符号直觉与工具回顾）'}
                </label>
                <span className="text-[11px] font-mono text-neutral-500">起点维度</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {getBaselinePresetOptions(category).map((item) => {
                  const active = learnerBaseline === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      data-testid={`baseline-${item.value}`}
                      aria-pressed={active}
                      onClick={() => setLearnerBaseline(item.value)}
                      className={`glow-border p-2.5 rounded border text-left transition-colors ${
                        active
                          ? 'bg-neutral-900 border-white text-white'
                          : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-white">{item.title}</span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                            active
                              ? 'border-sky-500/60 bg-sky-950/50 text-sky-200'
                              : 'border-neutral-800 bg-neutral-950 text-neutral-500'
                          }`}
                        >
                          {item.tag}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-300 leading-relaxed">{item.audience}</p>
                      <p className="text-[11px] text-neutral-500 leading-relaxed mt-0.5">{item.behavior}</p>
                    </button>
                  );
                })}
                <button
                  type="button"
                  data-testid="baseline-custom"
                  aria-pressed={learnerBaseline === 'custom'}
                  onClick={() => setLearnerBaseline('custom')}
                  className={`glow-border p-2.5 rounded border text-left transition-colors ${
                    learnerBaseline === 'custom'
                      ? 'bg-neutral-900 border-white text-white'
                      : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold text-white">
                      {category === 'english' ? '自定义我的语言水平' : '自定义我的水平'}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        learnerBaseline === 'custom'
                          ? 'border-sky-500/60 bg-sky-950/50 text-sky-200'
                          : 'border-neutral-800 bg-neutral-950 text-neutral-500'
                      }`}
                    >
                      {category === 'english' ? '自由输入语言背景' : '自由输入背景'}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-300 leading-relaxed">
                    {category === 'english'
                      ? '精确描述当前词汇量、已考证书或长难句痛点（如：四级刚过，长从句找不准主干）。'
                      : '精确描述已掌握和生疏的先修知识（如：会高数微积分，但没学过电路与复数相量）。'}
                  </p>
                </button>
              </div>
              {learnerBaseline === 'custom' && (
                <div className="mt-2">
                  <input
                    type="text"
                    data-testid="custom-baseline-input"
                    value={customLearnerBaseline}
                    onChange={(e) => setCustomLearnerBaseline(e.target.value)}
                    placeholder={
                      category === 'english'
                        ? '例如：四级 500 分左右，认识孤立单词但遇到外刊长难句和熟词僻义就读不懂'
                        : '例如：熟悉高中物理与一元微积分，但对运放虚短虚断、复数相量与拉普拉斯变换零基础'
                    }
                    aria-label="自定义当前水平描述"
                    className="w-full bg-black border border-neutral-700 rounded px-3 py-2 text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:border-sky-400"
                  />
                </div>
              )}
            </div>

            <div className="border-t border-neutral-900 pt-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <label className="text-xs font-medium text-neutral-200">
                  {category === 'english'
                    ? '我的语言学习目标深度（决定语境难度、辨析深度与运用高度——绝不因低起点而降格）'
                    : '我的学习目标深度（决定最终推导深度与习题高度——绝不因低起点而降格）'}
                </label>
                <span className="text-[11px] font-mono text-neutral-500">终点维度</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {getDepthPresetOptions(category).map((item) => {
                  const active = learningDepth === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      data-testid={`depth-${item.value}`}
                      aria-pressed={active}
                      onClick={() => setLearningDepth(item.value)}
                      className={`glow-border p-2.5 rounded border text-left transition-colors ${
                        active
                          ? 'bg-neutral-900 border-white text-white'
                          : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-white">{item.title}</span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                            active
                              ? 'border-emerald-500/60 bg-emerald-950/50 text-emerald-200'
                              : 'border-neutral-800 bg-neutral-950 text-neutral-500'
                          }`}
                        >
                          {item.tag}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-300 leading-relaxed">{item.target}</p>
                      <p className="text-[11px] text-neutral-500 leading-relaxed mt-0.5">{item.behavior}</p>
                    </button>
                  );
                })}
                <button
                  type="button"
                  data-testid="depth-custom"
                  aria-pressed={learningDepth === 'custom'}
                  onClick={() => setLearningDepth('custom')}
                  className={`glow-border p-2.5 rounded border text-left transition-colors ${
                    learningDepth === 'custom'
                      ? 'bg-neutral-900 border-white text-white'
                      : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold text-white">
                      {category === 'english' ? '自定义语言目标深度' : '自定义学习目标深度'}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        learningDepth === 'custom'
                          ? 'border-emerald-500/60 bg-emerald-950/50 text-emerald-200'
                          : 'border-neutral-800 bg-neutral-950 text-neutral-500'
                      }`}
                    >
                      {category === 'english' ? '自由输入目标要求' : '自由输入深度'}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-300 leading-relaxed">
                    {category === 'english'
                      ? '指定目标考试标准、期望读懂的刊物难度或专项能力（如：攻克考研英语一长难句与熟词僻义）。'
                      : '指定期望吃透的推导深度、考点标准或工程迁移要求（例如：从零起步直学模电第六章全部误差与电路设计）。'}
                  </p>
                </button>
              </div>
              {learningDepth === 'custom' && (
                <div className="mt-2">
                  <input
                    type="text"
                    data-testid="custom-depth-input"
                    value={customLearningDepth}
                    onChange={(e) => setCustomLearningDepth(e.target.value)}
                    placeholder={
                      category === 'english'
                        ? '例如：能独立精读《经济学人》科技商业版块，吃透本节词汇的熟词僻义并用于学术写作'
                        : '例如：吃透模电第六章全部传递函数推导、失调温漂误差计算，并能独立完成典型加减运算电路设计'
                    }
                    aria-label="自定义学习目标深度描述"
                    className="w-full bg-black border border-neutral-700 rounded px-3 py-2 text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:border-emerald-400"
                  />
                </div>
              )}
            </div>

            <div
              data-testid="learner-strategy-preview"
              className="border border-neutral-800 bg-black/80 rounded px-3 py-2 text-[11px] text-neutral-300 leading-relaxed"
            >
              <span className="font-mono text-sky-300 mr-1.5">协同教学策略：</span>
              {
                resolveLearnerProfile({
                  category,
                  learnerBaseline,
                  customLearnerBaseline,
                  learningDepth,
                  customLearningDepth,
                }).strategySummary
              }
            </div>
          </div>

          {/* 4. 语言课程专属：自定义词库选择/导入、输入组合与阅读密度规划 */}
          {category === 'english' && (
            <div className="border border-neutral-800 rounded p-4 space-y-4 bg-neutral-950/50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-white">
                    自定义词库配置（可选 · 支持仅词库 / 仅教材 / 词库+教材 / AI 自主规划）
                  </span>
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    {INPUT_MODE_META[languageInputMode].desc}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono px-2 py-1 rounded border border-neutral-700 bg-black text-sky-300">
                    {INPUT_MODE_META[languageInputMode].label}
                  </span>
                  {onOpenVocabManager && (
                    <button
                      type="button"
                      onClick={onOpenVocabManager}
                      className="px-2.5 py-1 text-xs border border-neutral-700 hover:border-white text-neutral-200 hover:text-white rounded transition-colors"
                    >
                      管理本地词库
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 目标词库（可选） */}
                <div className="space-y-2">
                  <label
                    htmlFor="target-vocab-select"
                    className="block text-xs text-neutral-300"
                  >
                    目标词库（可选，从本地已保存词库选择或导入）
                  </label>
                  <select
                    id="target-vocab-select"
                    value={targetBankId}
                    onChange={(e) => setTargetBankId(e.target.value)}
                    className="w-full bg-black border border-neutral-800 rounded px-2.5 py-2 text-xs text-white focus:outline-none focus:border-neutral-500"
                  >
                    <option value="none">不使用已保存目标词库</option>
                    {vocabBanks.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.name} ({bank.words.length} 词)
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-neutral-500">或临时粘贴 / 导入词表</span>
                    <label className="cursor-pointer text-xs text-neutral-300 hover:text-white underline underline-offset-4">
                      上传词表 (.txt/.csv/.tsv/.json)
                      <input
                        type="file"
                        accept=".txt,.csv,.tsv,.json,.md"
                        onChange={(e) => handleVocabFileUpload(e, 'target')}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <textarea
                    rows={2}
                    value={customTargetVocabText}
                    onChange={(e) => setCustomTargetVocabText(e.target.value)}
                    placeholder="可选：每行输入单词/短语或“单词 释义”，支持 CSV/TSV/JSON"
                    className="w-full bg-black border border-neutral-800 rounded p-2 text-xs font-mono text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
                  />

                  {customTargetVocabText.trim() && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <input
                        type="text"
                        value={inlineSaveBankName}
                        onChange={(e) => setInlineSaveBankName(e.target.value)}
                        placeholder="输入词库名保存以便复用"
                        className="flex-1 min-w-[140px] bg-black border border-neutral-800 rounded px-2 py-1 text-xs text-white"
                      />
                      <button
                        type="button"
                        disabled={isSavingInlineBank || !inlineSaveBankName.trim()}
                        onClick={async () => {
                          setIsSavingInlineBank(true);
                          setInlineBankFeedback(null);
                          try {
                            const r = await fetch('/api/vocab-banks', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                name: inlineSaveBankName.trim(),
                                rawText: customTargetVocabText,
                              }),
                            });
                            const data = await r.json().catch(() => ({}));
                            if (!r.ok) {
                              const rawErr = typeof data?.error === 'string' ? data.error : '';
                              if (r.status === 404 && (!rawErr || rawErr.includes('未找到接口'))) {
                                throw new Error(
                                  '未找到词库接口（本地后端服务尚未重启以加载新接口，请重启本地服务后刷新页面重试）'
                                );
                              }
                              throw new Error(rawErr || '保存词库失败');
                            }
                            if (onVocabBanksChanged && Array.isArray(data.vocabBanks)) {
                              onVocabBanksChanged(data.vocabBanks);
                            }
                            if (data.vocabBank?.id) {
                              setTargetBankId(data.vocabBank.id);
                              setCustomTargetVocabText('');
                              setInlineSaveBankName('');
                            }
                            setInlineBankFeedback(
                              `已保存为本地词库「${data.vocabBank?.name}」(${data.vocabBank?.words?.length || 0} 词)`
                            );
                          } catch (err: any) {
                            setInlineBankFeedback(err?.message || '保存本地词库失败');
                          } finally {
                            setIsSavingInlineBank(false);
                          }
                        }}
                        className="px-2.5 py-1 text-xs bg-neutral-900 border border-neutral-700 hover:border-white text-white rounded transition-colors disabled:opacity-40"
                      >
                        {isSavingInlineBank ? '保存中...' : '保存为本地词库'}
                      </button>
                      {inlineBankFeedback && (
                        <span className="w-full text-[11px] text-neutral-400">
                          {inlineBankFeedback}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* 排除词库（可选） */}
                <div className="space-y-2">
                  <label
                    htmlFor="excluded-vocab-select"
                    className="block text-xs text-neutral-300"
                  >
                    已掌握排除词库（可选）
                  </label>
                  <select
                    id="excluded-vocab-select"
                    value={excludedBankId}
                    onChange={(e) => setExcludedBankId(e.target.value)}
                    className="w-full bg-black border border-neutral-800 rounded px-2.5 py-2 text-xs text-white focus:outline-none focus:border-neutral-500"
                  >
                    <option value="none">不排除任何已保存词库</option>
                    {vocabBanks.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.name} ({bank.words.length} 词)
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-neutral-500">或临时导入已掌握词表</span>
                    <label className="cursor-pointer text-xs text-neutral-300 hover:text-white underline underline-offset-4">
                      上传排除词表 (.txt/.csv/.tsv/.json)
                      <input
                        type="file"
                        accept=".txt,.csv,.tsv,.json,.md"
                        onChange={(e) => handleVocabFileUpload(e, 'excluded')}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <textarea
                    rows={2}
                    value={customExcludedVocabText}
                    onChange={(e) => setCustomExcludedVocabText(e.target.value)}
                    placeholder="可选：输入已掌握单词以从学习计划中排除"
                    className="w-full bg-black border border-neutral-800 rounded p-2 text-xs font-mono text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
                  />
                </div>
              </div>

              {/* 主题数 N 与英语词库阅读规划参数 */}
              <div className="border-t border-neutral-800 pt-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label
                      htmlFor="topic-count-input"
                      className="block text-[11px] text-neutral-400 mb-1"
                    >
                      计划主题数 N（留空由 AI 决定）
                    </label>
                    <input
                      id="topic-count-input"
                      type="number"
                      min={1}
                      max={50}
                      value={topicCountInput}
                      onChange={(e) => setTopicCountInput(e.target.value)}
                      placeholder="自动"
                      className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
                    />
                  </div>

                  {vocabDiff.effectiveWords.length > 0 && (
                    <>
                      <div>
                        <label
                          htmlFor="daily-word-count-input"
                          className="block text-[11px] text-neutral-400 mb-1"
                        >
                          每篇引入新词数
                        </label>
                        <input
                          id="daily-word-count-input"
                          type="number"
                          min={1}
                          max={100}
                          value={newWordsPerArticle}
                          onChange={(e) =>
                            setNewWordsPerArticle(
                              Math.max(1, Math.min(100, Number(e.target.value) || 15))
                            )
                          }
                          className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-neutral-500"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="target-density-input"
                          className="block text-[11px] text-neutral-400 mb-1"
                        >
                          目标词密度（出现次数/总词数 %）
                        </label>
                        <input
                          id="target-density-input"
                          type="number"
                          step={0.5}
                          min={0.5}
                          max={25}
                          value={targetWordDensityPct}
                          onChange={(e) =>
                            setTargetWordDensityPct(
                              Math.max(0.5, Math.min(25, Number(e.target.value) || 4))
                            )
                          }
                          className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-neutral-500"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="expected-repeats-input"
                          className="block text-[11px] text-neutral-400 mb-1"
                        >
                          预计单篇每词复现次数
                        </label>
                        <input
                          id="expected-repeats-input"
                          type="number"
                          step={0.5}
                          min={1}
                          max={10}
                          value={expectedRepeatsPerWord}
                          onChange={(e) =>
                            setExpectedRepeatsPerWord(
                              Math.max(1, Math.min(10, Number(e.target.value) || 2))
                            )
                          }
                          className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-neutral-500"
                        />
                      </div>
                    </>
                  )}
                </div>

                {vocabDiff.targetTotal > 0 || vocabDiff.effectiveWords.length > 0 ? (
                  <>
                    <div className="text-xs text-neutral-300 font-mono flex flex-wrap items-center justify-between gap-2">
                      <span>
                        目标词库 ({vocabDiff.targetTotal}) − 排除 ({vocabDiff.overlapCount}) ={' '}
                        <strong className="text-white">
                          待学 {vocabDiff.effectiveWords.length} 词（已分配稳定 ID）
                        </strong>
                      </span>
                      <span className="text-neutral-500 truncate max-w-xs">
                        样本：
                        {vocabDiff.effectiveWords
                          .slice(0, 5)
                          .map((w) => w.word)
                          .join(', ')}
                        {vocabDiff.effectiveWords.length > 5 ? ' ...' : ''}
                      </span>
                    </div>

                    <div className="text-xs rounded px-3 py-2 border border-neutral-800 bg-black text-neutral-300">
                      {readingPlanStats.message}
                      <span className="text-neutral-500 ml-1">
                        （非英语语种将按自身分词与教学目标自然调整篇幅）
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-xs rounded px-3 py-2 border border-neutral-800 bg-black text-neutral-400">
                    当前未绑定自定义词库：若下方上传教材 PDF/文本，将依据教材结构规划大纲；若两者均不提供，将由 AI 根据学习目的与兴趣偏好自主规划完整课程。
                  </div>
                )}
              </div>

              {/* 文章题材与来源方式 */}
              <div className="border-t border-neutral-800 pt-3 space-y-2">
                <label className="block text-xs text-neutral-300">
                  阅读文本题材与生成方式（以语境自然连贯为先，绝不机械堆砌单词）
                </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setArticleMode('llm_original')}
                      className={`p-2.5 rounded border text-left text-xs transition-colors ${
                        articleMode === 'llm_original'
                          ? 'bg-neutral-900 border-white text-white'
                          : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                      }`}
                    >
                      <div className="font-medium mb-0.5">LLM 直接原创连贯文章</div>
                      <div className="text-neutral-500">
                        结合兴趣偏好与本节目标词/复习词，创作自然连贯的阅读文本
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setArticleMode('media_search')}
                      className={`p-2.5 rounded border text-left text-xs transition-colors ${
                        articleMode === 'media_search'
                          ? 'bg-neutral-900 border-white text-white'
                          : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                      }`}
                    >
                      <div className="font-medium mb-0.5">参考外刊风格议题</div>
                      <div className="text-neutral-500">
                        参考 The New Yorker / Economist 等社论与科普叙事视角
                      </div>
                    </button>
                  </div>

                  {articleMode === 'media_search' && (
                    <div className="pt-1">
                      <label
                        htmlFor="preferred-sources-input"
                        className="block text-xs text-neutral-400 mb-1"
                      >
                        参考外刊风格偏好
                      </label>
                      <input
                        id="preferred-sources-input"
                        type="text"
                        value={preferredSources}
                        onChange={(e) => setPreferredSources(e.target.value)}
                        className="w-full bg-black border border-neutral-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-neutral-500"
                      />
                    </div>
                  )}
                </div>
            </div>
          )}

          {/* 5. 上传 PDF 等学习资料（支持大型数百页 PDF 智能切分 / 语言教材） */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-neutral-300">
                {category === 'english'
                  ? '上传语言教材 / 参考资料（可选：支持“仅教材”或“词库+教材整合”模式）'
                  : '上传学习资料（原始文件将保存在 courses/课程名称/sources/，支持大型 PDF 按目录智能切分）'}
              </label>
              <label className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-700 rounded cursor-pointer transition-colors whitespace-nowrap shrink-0">
                <Upload className="w-3.5 h-3.5" />
                <span>
                  {isParsingFiles && uploadProgress
                    ? `上传中 ${uploadProgress.percent}%`
                    : isParsingFiles
                      ? '上传读取中...'
                      : '选择文件'}
                </span>
                <input
                  type="file"
                  multiple
                  disabled={isParsingFiles}
                  accept=".pdf,.txt,.md,.csv,.json"
                  onChange={handleMaterialFilesUpload}
                  className="hidden"
                />
              </label>
            </div>

            {uploadProgress && (
              <div className="mb-2 border border-sky-900/60 bg-sky-950/20 rounded px-3 py-2 space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2 text-sky-200 font-mono">
                  <span className="truncate">{uploadProgress.message}</span>
                  <span>{uploadProgress.percent}%</span>
                </div>
                <div className="w-full h-1.5 bg-neutral-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-400 transition-all duration-150"
                    style={{ width: `${Math.max(3, Math.min(100, uploadProgress.percent))}%` }}
                  />
                </div>
              </div>
            )}

            {materials.length === 0 ? (
              <div className="border border-dashed border-neutral-800 rounded py-4 px-3 text-center text-xs text-neutral-500">
                {category === 'english'
                  ? '暂未上传教材或参考文件（非必填）。若选择词库，系统可按“仅词库”生成；若词库与教材均不提供，将由 AI 自主规划课程大纲。'
                  : '暂未上传文件。支持百兆级整本教材 PDF 分块上传、讲义笔记或参考文本，系统将先由多模态模型确定划分区域并由本地脚本无损切分 PDF，再基于切分区域生成完整课程大纲与逐节课件。'}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto border border-neutral-800 rounded p-2 bg-neutral-950">
                {materials.map((m) => {
                  const sizeLabel =
                    m.fileSize >= 1024 * 1024
                      ? `${(m.fileSize / (1024 * 1024)).toFixed(1)} MB`
                      : `${(m.fileSize / 1024).toFixed(1)} KB`;
                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between text-xs py-1.5 px-2.5 bg-black border border-neutral-900 rounded"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <FileText className="w-3.5 h-3.5 text-sky-400/80 shrink-0" />
                        <span className="text-neutral-200 truncate">{m.fileName}</span>
                        <span className="text-neutral-500 font-mono shrink-0">
                          · {sizeLabel}
                          {m.isPdf && m.totalPages ? ` · 共 ${m.totalPages} 物理页` : ''}
                          {m.isPdf && m.tocEntries && m.tocEntries.length > 0
                            ? ` · 含 ${m.tocEntries.length} 条目录书签`
                            : m.isPdf
                              ? ' · 多模态直读原文件'
                              : ` · 纯文本 (${m.extractedText.length} 字符)`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setMaterials((prev) => prev.filter((item) => item.id !== m.id))
                        }
                        aria-label={`移除文件 ${m.fileName}`}
                        className="text-neutral-500 hover:text-neutral-200 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 6. 额外要求（学习重点、个人兴趣、生成偏好） */}
          <div>
            <label
              htmlFor="extra-req-input"
              className="block text-xs font-medium text-neutral-300 mb-1.5"
            >
              {category === 'english'
                ? '额外要求（阅读话题偏好、目标考试倾向、文体与长难句讲解重点）'
                : '额外要求（学习重点、重点推导章节、图示与例题偏好）'}
            </label>
            <textarea
              id="extra-req-input"
              rows={3}
              value={extraRequirements}
              onChange={(e) => setExtraRequirements(e.target.value)}
              placeholder={
                category === 'english'
                  ? '例如：我对人工智能伦理、宏观经济和物理学史感兴趣，希望文章多结合这些话题，重点解析长难句。'
                  : '例如：重点推导频域稳定性判据与波特图分析，每节课给出详细的分步数学推导和电路原理图。'
              }
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
            />
          </div>

          {errorMsg && (
            <div className="text-xs text-red-400 border border-red-900/60 bg-red-950/30 rounded px-3 py-2">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-neutral-300 hover:text-white border border-neutral-800 rounded transition-colors whitespace-nowrap"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isParsingFiles}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-white text-black hover:bg-neutral-200 disabled:opacity-50 rounded transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>
                {isSubmitting
                  ? category === 'english'
                    ? '正在创建英语课程并执行第 1 步（词库差集与分节随机分配）...'
                    : '正在创建课程并执行第 1 步（区域划分分析）...'
                  : category === 'english'
                    ? '创建课程并进入第 1 步（词库差集与分节分配）'
                    : '创建课程并进入第 1 步（区域划分与切割）'}
              </span>
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
