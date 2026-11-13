import React, { useMemo, useState } from 'react';
import { FileText, Plus, Trash2, Upload, X } from 'lucide-react';
import type {
  Course,
  CourseCategory,
  CourseGenerationMode,
  EnglishArticleMode,
  LearnerLevel,
  UploadedMaterial,
  VocabItem,
} from '../types';
import {
  BUILTIN_VOCAB_BANKS,
  computeVocabCoverageStats,
  computeVocabSetDifference,
  getTodayDateString,
  parseVocabularyInput,
} from '../utils/learningLogic';
import { parseUploadedFile } from '../utils/fileExtractor';

interface AddCourseModalProps {
  isOpen: boolean;
  defaultLearnerLevel?: LearnerLevel;
  onClose: () => void;
  onCourseCreated: (course: Course) => void;
}

export const AddCourseModal: React.FC<AddCourseModalProps> = ({
  isOpen,
  defaultLearnerLevel = 'intermediate',
  onClose,
  onCourseCreated,
}) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CourseCategory>('stem');
  const [generationMode, setGenerationMode] = useState<CourseGenerationMode>('api');
  const [learnerLevel, setLearnerLevel] = useState<LearnerLevel>(defaultLearnerLevel);
  const [goal, setGoal] = useState('');
  const [durationDays, setDurationDays] = useState<number>(15);
  const [startDate, setStartDate] = useState<string>(getTodayDateString());
  const [extraRequirements, setExtraRequirements] = useState('');
  const [materials, setMaterials] = useState<UploadedMaterial[]>([]);
  const [isParsingFiles, setIsParsingFiles] = useState(false);

  // English course specific states
  const [targetBankId, setTargetBankId] = useState<string>('cet6');
  const [excludedBankId, setExcludedBankId] = useState<string>('gaokao');
  const [customTargetVocabText, setCustomTargetVocabText] = useState<string>('');
  const [customExcludedVocabText, setCustomExcludedVocabText] = useState<string>('');
  const [dailyWordCount, setDailyWordCount] = useState<number>(20);
  const [articleMode, setArticleMode] = useState<EnglishArticleMode>('media_search');
  const [preferredSources, setPreferredSources] = useState<string>(
    'The New Yorker, The Economist, Scientific American'
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Compute live vocabulary set difference for English courses
  const vocabDiff = useMemo(() => {
    const presetTarget = BUILTIN_VOCAB_BANKS[targetBankId]?.words || [];
    const customTarget = parseVocabularyInput(customTargetVocabText);
    const combinedTarget: VocabItem[] = [...presetTarget, ...customTarget];

    const presetExcluded = BUILTIN_VOCAB_BANKS[excludedBankId]?.words || [];
    const customExcluded = parseVocabularyInput(customExcludedVocabText);
    const combinedExcluded: VocabItem[] = [...presetExcluded, ...customExcluded];

    return computeVocabSetDifference(combinedTarget, combinedExcluded);
  }, [targetBankId, excludedBankId, customTargetVocabText, customExcludedVocabText]);

  const vocabCoverage = useMemo(
    () =>
      computeVocabCoverageStats(
        vocabDiff.effectiveWords.length,
        durationDays,
        dailyWordCount
      ),
    [vocabDiff.effectiveWords.length, durationDays, dailyWordCount]
  );

  if (!isOpen) return null;

  const handleMaterialFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setIsParsingFiles(true);
    setErrorMsg(null);
    try {
      const parsedItems: UploadedMaterial[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const item = await parseUploadedFile(fileList[i]);
        parsedItems.push(item);
      }
      setMaterials((prev) => [...prev, ...parsedItems]);
    } catch (err: any) {
      setErrorMsg(err?.message || '解析上传文件失败');
    } finally {
      setIsParsingFiles(false);
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
    if (category === 'english' && vocabDiff.effectiveWords.length === 0) {
      setErrorMsg('当前词库集合相减后待学词汇为 0，请调整目标词库或排除词库');
      return;
    }

    setIsSubmitting(true);
    try {
      const targetLabel =
        BUILTIN_VOCAB_BANKS[targetBankId]?.label || '自定义目标词库';
      const excludedLabel =
        BUILTIN_VOCAB_BANKS[excludedBankId]?.label || '无排除词库';

      const res = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          category,
          generationMode,
          learnerLevel,
          goal: goal.trim(),
          startDate,
          durationDays: Math.max(1, Math.min(180, Number(durationDays) || 15)),
          extraRequirements: extraRequirements.trim(),
          materials,
          englishConfig:
            category === 'english'
              ? {
                  targetBankName: targetLabel,
                  excludedBankName: excludedLabel,
                  totalTargetCount: vocabDiff.targetTotal,
                  excludedCount: vocabDiff.overlapCount,
                  effectiveWords: vocabDiff.effectiveWords,
                  dailyWordCount: Math.max(1, Math.min(200, Number(dailyWordCount) || 20)),
                  articleMode,
                  preferredSources: preferredSources.trim(),
                }
              : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '创建课程失败');
      }

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-course-title"
    >
      <div className="w-full max-w-2xl bg-black border border-neutral-800 rounded-md p-6 my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4 mb-5">
          <div>
            <h2 id="add-course-title" className="text-lg font-semibold text-white">
              添加课程
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              统一 4 步工作流：提交课程要求与资料 ➔ 1. LLM 确定 PDF 划分区域并本地切割 ➔ 2. LLM 生成并确认课程大纲 (outline.json) ➔ 3. LLM 按目录逐节生成课件
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
                className={`p-2.5 rounded border text-left text-xs transition-colors ${
                  generationMode === 'api'
                    ? 'bg-neutral-900 border-white text-white'
                    : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                }`}
              >
                <div className="font-medium mb-0.5">API 自动生成</div>
                <div className="text-[11px] text-neutral-500">
                  先调用 LLM 规划 PDF 划分区域并脚本切割，再生成并确认大纲，最后逐节生成课件
                </div>
              </button>

              <button
                type="button"
                onClick={() => setGenerationMode('agent')}
                className={`p-2.5 rounded border text-left text-xs transition-colors ${
                  generationMode === 'agent'
                    ? 'bg-neutral-900 border-white text-white'
                    : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                }`}
              >
                <div className="font-medium mb-0.5">Agent 课件模式</div>
                <div className="text-[11px] text-neutral-500">
                  无需 API Key，按顺序提供区域划分、大纲生成与逐节课件提示词供 Agent 操作本地文件夹
                </div>
              </button>

              <button
                type="button"
                onClick={() => setGenerationMode('chat')}
                className={`p-2.5 rounded border text-left text-xs transition-colors ${
                  generationMode === 'chat'
                    ? 'bg-neutral-900 border-white text-white'
                    : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                }`}
              >
                <div className="font-medium mb-0.5">Chat 课件模式</div>
                <div className="text-[11px] text-neutral-500">
                  无需 API Key，按顺序复制区域划分、大纲与单节提示词并搭配切片 PDF 在外部对话导入
                </div>
              </button>
            </div>
          </div>

          {/* 1. 学科类型选择 */}
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-2">
              课程类型
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setCategory('stem')}
                className={`py-2 px-3 text-xs font-medium rounded border text-left transition-colors whitespace-nowrap truncate ${
                  category === 'stem'
                    ? 'bg-neutral-900 border-white text-white'
                    : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                }`}
              >
                理工科（数学 / 电子 / 计算机）
              </button>
              <button
                type="button"
                onClick={() => setCategory('english')}
                className={`py-2 px-3 text-xs font-medium rounded border text-left transition-colors whitespace-nowrap truncate ${
                  category === 'english'
                    ? 'bg-neutral-900 border-white text-white'
                    : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                }`}
              >
                英语学习（词库差集与每日随机分配）
              </button>
              <button
                type="button"
                onClick={() => setCategory('general')}
                className={`py-2 px-3 text-xs font-medium rounded border text-left transition-colors whitespace-nowrap truncate ${
                  category === 'general'
                    ? 'bg-neutral-900 border-white text-white'
                    : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                }`}
              >
                通用学科与专业阅读
              </button>
            </div>
          </div>

          {/* 2. 课程名称与学习目标 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="course-name-input"
                className="block text-xs font-medium text-neutral-300 mb-1.5"
              >
                课程名称（将自动创建本地课程文件夹）
              </label>
              <input
                id="course-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  category === 'english'
                    ? '例如：六级核心词汇与外刊精读'
                    : '例如：模拟电子技术基础 / 线性代数'
                }
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
              />
            </div>

            <div>
              <label
                htmlFor="course-goal-input"
                className="block text-xs font-medium text-neutral-300 mb-1.5"
              >
                学习目标
              </label>
              <input
                id="course-goal-input"
                type="text"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder={
                  category === 'english'
                    ? '例如：掌握六级高频词并能流畅阅读 The New Yorker'
                    : '例如：掌握运算放大器负反馈推导与频率响应分析'
                }
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
              />
            </div>
          </div>

          {/* 3. 学习期限、开始日期与学习者水平 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="course-duration-input"
                className="block text-xs font-medium text-neutral-300 mb-1.5"
              >
                学习期限（天数）
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

            <div>
              <label
                htmlFor="course-learner-level"
                className="block text-xs font-medium text-neutral-300 mb-1.5"
              >
                当前基础水平
              </label>
              <select
                id="course-learner-level"
                value={learnerLevel}
                onChange={(e) => setLearnerLevel(e.target.value as LearnerLevel)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-500"
              >
                <option value="beginner">初学者 / 零基础</option>
                <option value="intermediate">具备基础 / 教材同步</option>
                <option value="advanced">进阶深入</option>
              </select>
            </div>
          </div>

          {/* 4. 英语课程专属：词库差集运算、每日目标单词数与随机不重复分配 */}
          {category === 'english' && (
            <div className="border border-neutral-800 rounded p-4 space-y-4 bg-neutral-950/50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white">
                  英语词库差集与每日随机分配（本地程序执行差集、去重与不重复抽取）
                </span>
                <span className="text-xs font-mono text-neutral-300">
                  实际待学 {vocabDiff.effectiveWords.length} 词 · 每日目标 {dailyWordCount} 词
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 目标词库 */}
                <div className="space-y-2">
                  <label
                    htmlFor="target-vocab-select"
                    className="block text-xs text-neutral-300"
                  >
                    目标词库（被减数集合 A）
                  </label>
                  <select
                    id="target-vocab-select"
                    value={targetBankId}
                    onChange={(e) => setTargetBankId(e.target.value)}
                    className="w-full bg-black border border-neutral-800 rounded px-2.5 py-2 text-xs text-white focus:outline-none focus:border-neutral-500"
                  >
                    {Object.values(BUILTIN_VOCAB_BANKS).map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.label} ({bank.words.length} 词)
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-neutral-500">或追加上传自定义目标词库</span>
                    <label className="cursor-pointer text-xs text-neutral-300 hover:text-white underline underline-offset-4">
                      上传词表 (.txt/.csv/.json)
                      <input
                        type="file"
                        accept=".txt,.csv,.json"
                        onChange={(e) => handleVocabFileUpload(e, 'target')}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <textarea
                    rows={2}
                    value={customTargetVocabText}
                    onChange={(e) => setCustomTargetVocabText(e.target.value)}
                    placeholder="可选：每行输入一个单词或“单词 释义”追加到目标词库"
                    className="w-full bg-black border border-neutral-800 rounded p-2 text-xs font-mono text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
                  />
                </div>

                {/* 排除词库 */}
                <div className="space-y-2">
                  <label
                    htmlFor="excluded-vocab-select"
                    className="block text-xs text-neutral-300"
                  >
                    已掌握排除词库（减数集合 B）
                  </label>
                  <select
                    id="excluded-vocab-select"
                    value={excludedBankId}
                    onChange={(e) => setExcludedBankId(e.target.value)}
                    className="w-full bg-black border border-neutral-800 rounded px-2.5 py-2 text-xs text-white focus:outline-none focus:border-neutral-500"
                  >
                    {Object.values(BUILTIN_VOCAB_BANKS).map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.label} ({bank.words.length} 词)
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-neutral-500">或追加上传已掌握词表</span>
                    <label className="cursor-pointer text-xs text-neutral-300 hover:text-white underline underline-offset-4">
                      上传排除词表 (.txt/.csv/.json)
                      <input
                        type="file"
                        accept=".txt,.csv,.json"
                        onChange={(e) => handleVocabFileUpload(e, 'excluded')}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <textarea
                    rows={2}
                    value={customExcludedVocabText}
                    onChange={(e) => setCustomExcludedVocabText(e.target.value)}
                    placeholder="可选：每行输入一个已掌握单词以从学习计划中排除"
                    className="w-full bg-black border border-neutral-800 rounded p-2 text-xs font-mono text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
                  />
                </div>
              </div>

              {/* 每日目标单词数设置与容量覆盖情况提示 */}
              <div className="border-t border-neutral-800 pt-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label
                    htmlFor="daily-word-count-input"
                    className="text-xs font-medium text-neutral-200"
                  >
                    每日目标单词数（同一周期内随机抽取且默认不重复，结果稳定保存）
                  </label>
                  <div className="flex items-center gap-1.5">
                    {[10, 20, 30, 50].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setDailyWordCount(preset)}
                        className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors whitespace-nowrap ${
                          dailyWordCount === preset
                            ? 'bg-neutral-900 border-white text-white'
                            : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                        }`}
                      >
                        {preset}词/天
                      </button>
                    ))}
                    <input
                      id="daily-word-count-input"
                      type="number"
                      min={1}
                      max={200}
                      value={dailyWordCount}
                      onChange={(e) =>
                        setDailyWordCount(Math.max(1, Math.min(200, Number(e.target.value) || 20)))
                      }
                      aria-label="每日目标单词数"
                      className="w-20 bg-black border border-neutral-800 rounded px-2.5 py-1 text-xs font-mono text-white focus:outline-none focus:border-neutral-500"
                    />
                  </div>
                </div>

                {/* 集合差集与容量提示 */}
                <div className="text-xs text-neutral-300 font-mono flex flex-wrap items-center justify-between gap-2">
                  <span>
                    目标词库 ({vocabDiff.targetTotal}) − 重合排除 ({vocabDiff.overlapCount}) ={' '}
                    <strong className="text-white">
                      实际待学 {vocabDiff.effectiveWords.length} 词
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

                <div
                  className={`text-xs rounded px-3 py-2 border ${
                    vocabCoverage.isExceedingCapacity
                      ? 'border-amber-800/80 bg-amber-950/30 text-amber-300'
                      : 'border-neutral-800 bg-black text-neutral-300'
                  }`}
                >
                  {vocabCoverage.message}
                </div>
              </div>

              {/* 英语文章来源方式 */}
              <div className="border-t border-neutral-800 pt-3 space-y-2">
                <label className="block text-xs text-neutral-300">
                  阅读文章生成方式（以当日目标词汇为主要依据自然融入，避免生硬堆砌）
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setArticleMode('media_search')}
                    className={`p-2.5 rounded border text-left text-xs transition-colors ${
                      articleMode === 'media_search'
                        ? 'bg-neutral-900 border-white text-white'
                        : 'bg-black border-neutral-800 text-neutral-400 hover:border-neutral-700'
                    }`}
                  >
                    <div className="font-medium mb-0.5">检索并参考真实外刊主题</div>
                    <div className="text-neutral-500">
                      参考 The New Yorker / Economist 等真实议题，自然融入当日目标词汇
                    </div>
                  </button>
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
                      结合个人兴趣与当日目标词汇，创作逻辑严密、语境自然的原创文章
                    </div>
                  </button>
                </div>

                {articleMode === 'media_search' && (
                  <div className="pt-1">
                    <label
                      htmlFor="preferred-sources-input"
                      className="block text-xs text-neutral-400 mb-1"
                    >
                      参考外刊媒体偏好
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

          {/* 5. 上传 PDF 等学习资料（支持大型数百页 PDF 智能切分） */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-neutral-300">
                上传学习资料（原始文件将保存在 courses/课程名称/sources/，支持大型 PDF 按目录智能切分）
              </label>
              <label className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-700 rounded cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                <span>{isParsingFiles ? '解析资料与页码中...' : '选择文件'}</span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.txt,.md,.csv,.json"
                  onChange={handleMaterialFilesUpload}
                  className="hidden"
                />
              </label>
            </div>

            {materials.length === 0 ? (
              <div className="border border-dashed border-neutral-800 rounded py-4 px-3 text-center text-xs text-neutral-500">
                暂未上传文件。可上传整本数百页教材 PDF、讲义笔记或参考文本，系统将先由 LLM 确定划分区域并由本地脚本无损切分 PDF，再基于切分区域生成完整课程大纲与逐节课件。
              </div>
            ) : (
              <div className="space-y-1.5 max-h-32 overflow-y-auto border border-neutral-800 rounded p-2 bg-neutral-950">
                {materials.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between text-xs py-1 px-2 bg-black border border-neutral-900 rounded"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <FileText className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <span className="text-neutral-200 truncate">{m.fileName}</span>
                      <span className="text-neutral-500 font-mono shrink-0">
                        · {(m.fileSize / 1024).toFixed(1)} KB
                        {m.isPdf && m.totalPages ? ` · 共 ${m.totalPages} 物理页` : ''} · 已提取{' '}
                        {m.extractedText.length} 字符
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
                ))}
              </div>
            )}
          </div>

          {/* 6. 额外要求（学习重点、个人兴趣、生成偏好） */}
          <div>
            <label
              htmlFor="extra-req-input"
              className="block text-xs font-medium text-neutral-300 mb-1.5"
            >
              额外要求（学习重点、个人兴趣、课程生成偏好）
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
                  ? '正在创建课程并执行第 1 步（区域划分分析）...'
                  : '创建课程并进入第 1 步（区域划分与切割）'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
