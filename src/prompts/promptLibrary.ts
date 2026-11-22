import fs from 'fs';
import path from 'path';
import type {
  Course,
  CourseCategory,
  DailyPlanSlot,
  EnglishArticleMode,
  DailyLessonContent,
  LanguageInputMode,
  LanguageLearningPurpose,
  LearnerBaselinePreset,
  LearnerLevel,
  LearningDepthPreset,
  PdfDocumentMeta,
  PdfSplitPlanItem,
  PromptModuleToggles,
  SubjectProfile,
  TargetLanguageCode,
  UploadedMaterial,
  VocabItem,
  VocabThemeItem,
  VocabThemePlan,
} from '../types';
import {
  assignStableVocabIds,
  ensureStableSectionId,
  getTodayDateString,
  normalizeWordKey,
} from '../utils/learningLogic';
import {
  computeEnglishReadingPlanStats,
  getEligibleReviewWordsForSlot,
  getGroupedReviewWordsForSlot,
  resolveLanguageInputMode,
  computeSectionAssociatedVocabStats,
  extractPendingGlossWordsForSection,
  isWeakBaselineForVocabSimplification,
  syncCourseVocabCoverage,
  type PendingWordGlossItem,
} from '../utils/vocabCoverage';
import { sampleVocabForThemePlanning } from '../utils/vocabThemePlanner';
import { isCorruptedBookmarkTitle } from '../utils/pdfProcessor';
import {
  BASELINE_LABELS,
  BASELINE_PRESET_OPTIONS,
  DEPTH_LABELS,
  DEPTH_PRESET_OPTIONS,
  deriveLegacyLearnerLevel,
  ENGLISH_BASELINE_LABELS,
  ENGLISH_BASELINE_PRESET_OPTIONS,
  ENGLISH_DEPTH_LABELS,
  ENGLISH_DEPTH_PRESET_OPTIONS,
  getBaselinePresetOptions,
  getDepthPresetOptions,
  mapLegacyLevelToDualAxis,
  resolveLearnerProfile,
} from '../utils/learnerProfile';

export {
  BASELINE_LABELS,
  BASELINE_PRESET_OPTIONS,
  DEPTH_LABELS,
  DEPTH_PRESET_OPTIONS,
  deriveLegacyLearnerLevel,
  ENGLISH_BASELINE_LABELS,
  ENGLISH_BASELINE_PRESET_OPTIONS,
  ENGLISH_DEPTH_LABELS,
  ENGLISH_DEPTH_PRESET_OPTIONS,
  getBaselinePresetOptions,
  getDepthPresetOptions,
  mapLegacyLevelToDualAxis,
  resolveLearnerProfile,
};

export const DEFAULT_PROMPT_MODULE_TOGGLES: PromptModuleToggles = {
  problemIntroduction: true,
  intuitionToDefinition: true,
  knowledgeConnection: true,
  continuousDerivation: true,
  confusionComparison: true,
  stagedDiagrams: true,
  workedExamples: true,
  heuristicQuestions: true,
  progressiveExercises: true,
  reverseExplanationCheck: true,
  noCodeForNonCS: true,
};

export interface PromptPresetItem {
  id: string;
  targetField: 'syllabus' | 'course' | 'english';
  subjectProfile?: SubjectProfile;
  learnerLevel?: LearnerLevel;
  label: string;
  description: string;
  prompt: string;
}

const SKILL_REFS_DIR = path.resolve(process.cwd(), 'learn-everything-prompts', 'references');

function readSkillRefFile(fileName: string): string {
  const fullPath = path.join(SKILL_REFS_DIR, fileName);
  if (!fs.existsSync(fullPath)) return '';
  return fs.readFileSync(fullPath, 'utf-8');
}

function extractTaggedBlock(markdown: string, marker: string): string {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRegex = new RegExp(`^#{2,3}\\s+[^\\n]*\`${escapedMarker}\`[^\\n]*$`, 'm');
  const headingMatch = headingRegex.exec(markdown);
  const startSearchIdx = headingMatch ? headingMatch.index + headingMatch[0].length : markdown.indexOf(marker);
  if (startSearchIdx === -1) return '';
  const afterMarker = markdown.slice(startSearchIdx);

  const fenceMatch = afterMarker.match(/(`{3,})text\r?\n/);
  if (!fenceMatch || fenceMatch.index === undefined) return '';
  const fenceTicks = fenceMatch[1];
  const bodyStart = fenceMatch.index + fenceMatch[0].length;

  const nextTaggedHeading = afterMarker
    .slice(bodyStart)
    .search(/\n#{2,3}\s+[^\n]*`(?:id|template|profile|level|baseline|depth):/);
  const sectionSlice =
    nextTaggedHeading !== -1
      ? afterMarker.slice(bodyStart, bodyStart + nextTaggedHeading)
      : afterMarker.slice(bodyStart);

  const closeRegex = new RegExp(`\\r?\\n${fenceTicks}\\s*$`);
  const closeMatch = sectionSlice.trimEnd().match(closeRegex);
  if (closeMatch && closeMatch.index !== undefined) {
    return sectionSlice.trimEnd().slice(0, closeMatch.index).trim();
  }
  const lastFence = sectionSlice.lastIndexOf(fenceTicks);
  if (lastFence === -1) return sectionSlice.trim();
  return sectionSlice.slice(0, lastFence).trim();
}

function extractFirstTextBlock(markdown: string): string {
  const match = markdown.match(/`{3,}text\r?\n([\s\S]*?)`{3,}/);
  return match ? match[1].trim() : '';
}

function interpolateTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    const val = vars[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
}

/**
 * Load all reusable prompt blocks directly from /learn-everything-prompts/references/*.md
 */
export function loadSkillPromptBlocks() {
  const coreMd = readSkillRefFile('core-pedagogy-modules.md');
  const syllabusMd = readSkillRefFile('syllabus-planning-prompt.md');
  const stemMd = readSkillRefFile('stem-courseware-prompt.md');
  const generalMd = readSkillRefFile('general-courseware-prompt.md');
  const englishMd = readSkillRefFile('english-reading-prompt.md');
  const runtimeMd = readSkillRefFile('runtime-user-prompts.md');
  const agentMd = readSkillRefFile('agent-mode-prompt.md');
  const chatMd = readSkillRefFile('chat-mode-prompt.md');

  return {
    basePedagogy: extractTaggedBlock(coreMd, 'id: base-pedagogy'),
    rules: {
      contentOrganization: extractTaggedBlock(coreMd, 'id: content-organization'),
      explanationQuality: extractTaggedBlock(coreMd, 'id: explanation-quality'),
      diagramsAndFormulas: extractTaggedBlock(coreMd, 'id: diagrams-and-formulas'),
      examplesAndExercises: extractTaggedBlock(coreMd, 'id: examples-and-exercises'),
      qualityVerification: extractTaggedBlock(coreMd, 'id: quality-verification'),
    },
    levels: {
      beginner: extractTaggedBlock(coreMd, 'level: beginner'),
      intermediate: extractTaggedBlock(coreMd, 'level: intermediate'),
      advanced: extractTaggedBlock(coreMd, 'level: advanced'),
    } as Record<LearnerLevel, string>,
    baselines: {
      zero_base: extractTaggedBlock(coreMd, 'baseline: zero_base'),
      partial_base: extractTaggedBlock(coreMd, 'baseline: partial_base'),
      solid_base: extractTaggedBlock(coreMd, 'baseline: solid_base'),
    } as Record<Exclude<LearnerBaselinePreset, 'custom'>, string>,
    depths: {
      understand_basics: extractTaggedBlock(coreMd, 'depth: understand_basics'),
      master_textbook: extractTaggedBlock(coreMd, 'depth: master_textbook'),
      deep_rigorous: extractTaggedBlock(coreMd, 'depth: deep_rigorous'),
    } as Record<Exclude<LearningDepthPreset, 'custom'>, string>,
    synergy: extractTaggedBlock(coreMd, 'id: baseline-depth-synergy'),
    profiles: {
      electronics_engineering: extractTaggedBlock(stemMd, 'profile: electronics_engineering'),
      math_physics: extractTaggedBlock(stemMd, 'profile: math_physics'),
      general_academic: extractTaggedBlock(generalMd, 'profile: general_academic'),
      computer_science: extractTaggedBlock(generalMd, 'profile: computer_science'),
      english_language: extractTaggedBlock(englishMd, 'profile: english_language'),
    } as Record<SubjectProfile, string>,
    syllabusSystem: extractFirstTextBlock(syllabusMd),
    templates: {
      syllabusUser: extractTaggedBlock(runtimeMd, 'template: syllabus-user-prompt'),
      courseLessonUser: extractTaggedBlock(runtimeMd, 'template: course-lesson-user-prompt'),
      courseLessonStage1: extractTaggedBlock(runtimeMd, 'template: course-lesson-stage1-prompt'),
      lessonStage2Diagrams: extractTaggedBlock(runtimeMd, 'template: lesson-stage2-diagrams-prompt'),
      englishLessonUser: extractTaggedBlock(runtimeMd, 'template: english-lesson-user-prompt'),
      agentSyllabus: extractTaggedBlock(agentMd, 'template: agent-syllabus-prompt'),
      agentBatch: extractTaggedBlock(agentMd, 'template: agent-batch-prompt'),
      agentEnglishBatch: extractTaggedBlock(agentMd, 'template: agent-english-batch-prompt'),
      chatLesson: extractTaggedBlock(chatMd, 'template: chat-lesson-prompt'),
      chatLessonStage1: extractTaggedBlock(chatMd, 'template: chat-lesson-stage1-prompt'),
      chatEnglishLesson: extractTaggedBlock(chatMd, 'template: chat-english-lesson-prompt'),
      chatSyllabus: extractTaggedBlock(chatMd, 'template: chat-syllabus-prompt'),
    },
  };
}

/**
 * Dynamically compose the courseware system prompt from the skill's modular files
 */
export function composeCoursewareSystemPrompt(params?: {
  subjectProfile?: SubjectProfile;
  targetLanguage?: TargetLanguageCode;
  customLanguageName?: string;
  learningPurpose?: LanguageLearningPurpose;
  learnerLevel?: LearnerLevel;
  learnerBaseline?: LearnerBaselinePreset;
  customLearnerBaseline?: string;
  learningDepth?: LearningDepthPreset;
  customLearningDepth?: string;
  modules?: Partial<PromptModuleToggles>;
  customSupplement?: string;
}): string {
  const blocks = loadSkillPromptBlocks();
  const profile = params?.subjectProfile || 'electronics_engineering';
  const hasDualAxis = Boolean(params?.learnerBaseline || params?.learningDepth);
  const resolved = resolveLearnerProfile({
    category: profile === 'english_language' ? 'english' : undefined,
    targetLanguage: params?.targetLanguage,
    learnerLevel: params?.learnerLevel,
    learnerBaseline: params?.learnerBaseline,
    customLearnerBaseline: params?.customLearnerBaseline,
    learningDepth: params?.learningDepth,
    customLearningDepth: params?.customLearningDepth,
  });
  const level = resolved.legacyLevel;
  const toggles: PromptModuleToggles = {
    ...DEFAULT_PROMPT_MODULE_TOGGLES,
    ...(params?.modules || {}),
  };

  const buildDualAxisBlocks = (): string[] => {
    if (!hasDualAxis) {
      return [blocks.levels[level] || blocks.levels.intermediate];
    }
    const baselineBlock =
      resolved.baseline === 'custom'
        ? `【学习起点（用户自定义当前水平）】：${resolved.baselineText}`
        : blocks.baselines[resolved.baseline] || blocks.baselines.partial_base;
    const depthBlock =
      resolved.depth === 'custom'
        ? `【学习目标深度（用户自定义目标）】：${resolved.depthText}`
        : blocks.depths[resolved.depth] || blocks.depths.master_textbook;
    return [baselineBlock, depthBlock, blocks.synergy].filter(Boolean);
  };

  if (profile === 'english_language') {
    const explicitLangLabel = params?.targetLanguage
      ? formatTargetLanguageLabel(params.targetLanguage, params.customLanguageName)
      : '外语/语言学习';
    const purposeNote =
      params?.learningPurpose === 'exam'
        ? `【学习目的：备考学习（${explicitLangLabel}）】优先覆盖目标词汇、教材重点及考试考点与近义辨析。`
        : params?.learningPurpose === 'interest'
          ? `【学习目的：兴趣学习（${explicitLangLabel}）】优先保证语境连贯、知识递进与实际语言运用体验。`
          : params?.targetLanguage && params.targetLanguage !== 'english'
            ? `【目标语言：${explicitLangLabel}】请按${explicitLangLabel}语言习惯组织词汇、语法、阅读或对话训练，不套用英文词数统计规则。`
            : '';
    const langAdaptationBlocks = [
      `【学习起点】：${resolved.baselineText}`,
      `【目标深度】：${resolved.depthText}`,
      `【双轴语言教学策略】：${resolved.strategySummary}`,
    ];
    const parts = [
      blocks.profiles.english_language,
      purposeNote,
      ...langAdaptationBlocks,
      params?.customSupplement?.trim() || '',
    ].filter(Boolean);
    return parts.join('\n\n');
  }

  const adaptationBlocks = buildDualAxisBlocks();

  const selectedRuleBlocks: string[] = [];
  if (
    toggles.problemIntroduction ||
    toggles.intuitionToDefinition ||
    toggles.knowledgeConnection
  ) {
    selectedRuleBlocks.push(blocks.rules.contentOrganization);
  }
  if (toggles.continuousDerivation || toggles.confusionComparison) {
    selectedRuleBlocks.push(blocks.rules.explanationQuality);
  }
  if (toggles.stagedDiagrams) {
    selectedRuleBlocks.push(blocks.rules.diagramsAndFormulas);
  }
  if (
    toggles.workedExamples ||
    toggles.heuristicQuestions ||
    toggles.progressiveExercises ||
    toggles.reverseExplanationCheck
  ) {
    selectedRuleBlocks.push(blocks.rules.examplesAndExercises);
  }
  if (toggles.noCodeForNonCS) {
    selectedRuleBlocks.push(blocks.rules.qualityVerification);
  }

  const composed = [
    blocks.basePedagogy,
    blocks.profiles[profile] || blocks.profiles.general_academic,
    ...adaptationBlocks,
    ...selectedRuleBlocks,
    params?.customSupplement?.trim() || '',
  ].filter(Boolean);

  return composed.join('\n\n');
}

export function getDefaultPromptsFromSkill() {
  const blocks = loadSkillPromptBlocks();
  return {
    syllabusSystemPrompt: blocks.syllabusSystem,
    courseSystemPrompt: composeCoursewareSystemPrompt({
      subjectProfile: 'electronics_engineering',
      learnerLevel: 'intermediate',
    }),
    englishSystemPrompt: blocks.profiles.english_language,
  };
}

export function getPromptPresetsFromSkill(): PromptPresetItem[] {
  const blocks = loadSkillPromptBlocks();
  return [
    {
      id: 'syllabus-default',
      targetField: 'syllabus',
      label: '资料目录与小节大纲解析模板（默认）',
      description: '按教材知识边界划分独立教学小节、构建知识点目录与先修依赖',
      prompt: blocks.syllabusSystem,
    },
    {
      id: 'course-electronics',
      targetField: 'course',
      subjectProfile: 'electronics_engineering',
      learnerLevel: 'intermediate',
      label: '电子技术与工科模板（默认）',
      description: '实际问题引入、分阶段电路图示、连续推导与递进练习',
      prompt: composeCoursewareSystemPrompt({
        subjectProfile: 'electronics_engineering',
        learnerLevel: 'intermediate',
      }),
    },
    {
      id: 'course-math-physics',
      targetField: 'course',
      subjectProfile: 'math_physics',
      learnerLevel: 'intermediate',
      label: '数学与物理模板',
      description: '几何/物理意义引入、定理来源与连续无跳步推导、符号单位说明',
      prompt: composeCoursewareSystemPrompt({
        subjectProfile: 'math_physics',
        learnerLevel: 'intermediate',
      }),
    },
    {
      id: 'course-beginner',
      targetField: 'course',
      subjectProfile: 'math_physics',
      learnerLevel: 'beginner',
      label: '零基础入门模板',
      description: '解释全部首次出现的术语与符号，用简单实例铺垫直觉',
      prompt: composeCoursewareSystemPrompt({
        subjectProfile: 'math_physics',
        learnerLevel: 'beginner',
      }),
    },
    {
      id: 'course-cs',
      targetField: 'course',
      subjectProfile: 'computer_science',
      learnerLevel: 'intermediate',
      label: '计算机科学模板',
      description: '实际瓶颈引入、状态转移分阶段图示、复杂度推导与核心代码解析',
      prompt: composeCoursewareSystemPrompt({
        subjectProfile: 'computer_science',
        learnerLevel: 'intermediate',
      }),
    },
    {
      id: 'english-default',
      targetField: 'english',
      label: '语言学习与语境阅读模板（默认）',
      description: '支持英语阅读与日语等多语种，包含词汇/语法精讲、语境阅读与递进练习',
      prompt: blocks.profiles.english_language,
    },
  ];
}

export function inferSubjectProfile(
  category: CourseCategory,
  courseName: string,
  extraRequirements?: string
): SubjectProfile {
  if (category === 'english') return 'english_language';
  const combined = `${courseName} ${extraRequirements || ''}`.toLowerCase();
  if (
    /编程|算法|数据结构|操作系统|计算机网络|数据库|python|java|c\+\+|rust|javascript|typescript|代码|软件/.test(
      combined
    )
  ) {
    return 'computer_science';
  }
  if (
    /电路|电子|模电|数电|运放|放大器|晶体管|mos|信号|控制|通信|单片机|嵌入式|电力|电机|传感器|滤波|反馈/.test(
      combined
    )
  ) {
    return 'electronics_engineering';
  }
  if (
    category === 'stem' ||
    /数学|微积分|高数|线性代数|矩阵|概率|统计|微分方程|物理|力学|电磁|光学|热学|量子/.test(
      combined
    )
  ) {
    return 'math_physics';
  }
  return 'general_academic';
}

export function formatTargetLanguageLabel(
  lang?: TargetLanguageCode,
  customName?: string
): string {
  if (lang === 'japanese') return '日语';
  if (lang === 'other') return customName?.trim() || '其他语言';
  return '英语';
}

export const PROFILE_LABELS: Record<SubjectProfile, string> = {
  electronics_engineering: '电子技术与工科',
  math_physics: '数学与物理',
  computer_science: '计算机科学',
  english_language: '语言学习',
  general_academic: '通用专业课程',
};

export const LEVEL_LABELS: Record<LearnerLevel, string> = {
  beginner: '零基础入门（补全先修常识 · 从特例与直觉讲起）',
  intermediate: '课本基础同步（标准本科教材推导深度与常规练习）',
  advanced: '深入拓展（非理想误差、失效边界与高阶变式迁移）',
};

function formatSplitRegionsSummary(pdfSplitPlan?: PdfSplitPlanItem[]): string {
  if (!pdfSplitPlan || pdfSplitPlan.length === 0) return '';
  const lines = pdfSplitPlan.map((seg) => {
    const hasCustomOffset = Boolean(seg.pageOffset && seg.pageOffset !== 0);
    const segFile = seg.segmentFileName || `${seg.sectionId}.pdf`;
    return [
      `- 区域 **${seg.sectionId}**（《${seg.sectionTitle}》｜原文件：${seg.sourceFileName}｜物理第 ${seg.physicalStartPage}~${seg.physicalEndPage} 页${
        hasCustomOffset && seg.printedStartPage
          ? ` / 教材印刷第 ${seg.printedStartPage}~${seg.printedEndPage} 页`
          : ''
      }｜状态：${seg.status === 'sliced' ? `已切分 PDF：${segFile}（请直接多模态读取该 PDF 文件）` : '已规划待切割'}）`,
      seg.outlineMappingNote ? `  - 划分说明：${seg.outlineMappingNote}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return `- **第 1 步已按小节划分/切割的教材 PDF 区域（共 ${pdfSplitPlan.length} 个独立单元；请确保下方全部 \`region-XX\` 都被大纲 \`sections\` 的 \`regionId\` / \`regionIds\` 100% 覆盖，禁止遗漏任何切分 PDF）**：\n${lines.join('\n')}`;
}

function buildLanguageSyllabusContext(params: {
  category: CourseCategory;
  materialsCount: number;
  effectiveWords?: VocabItem[];
  dailyWordCount?: number;
  targetLanguage?: TargetLanguageCode;
  customLanguageName?: string;
  learningPurpose?: LanguageLearningPurpose;
  interestPreferences?: string;
  inputMode?: LanguageInputMode;
  topicCount?: number | null;
  newWordsPerArticle?: number;
  targetWordDensity?: number;
  expectedRepeatsPerWord?: number;
  vocabThemePlan?: VocabThemePlan;
  existingSlots?: DailyPlanSlot[];
  isAgentMode?: boolean;
}): string {
  if (params.category !== 'english') return '';

  const hasExplicitLang = Boolean(params.targetLanguage);
  const langDesc = hasExplicitLang
    ? `目标语言「${formatTargetLanguageLabel(params.targetLanguage, params.customLanguageName)}」`
    : '语言学习（依据课程名称、学习目标、词库与教材自动适配对应语种）';
  const purposeLabel =
    params.learningPurpose === 'exam'
      ? '备考学习（优先保证指定词库、教材与考试目标的完整覆盖）'
      : '兴趣学习（优先保证内容连贯、知识递进与实际语言运用）';

  const normalizedWords = assignStableVocabIds(params.effectiveWords || []);
  const inputMode: LanguageInputMode =
    params.inputMode || resolveLanguageInputMode(normalizedWords.length, params.materialsCount);

  const inputModeDescMap: Record<LanguageInputMode, string> = {
    vocab_only: '仅词库（分析词库内容，规划 N 个主题及下属文章，按语义分配目标词）',
    material_only: '仅教材（严格依据上传教材/资料结构与内容规划课程大纲）',
    vocab_and_material:
      '词库 + 教材（整合为同一套课程：以教材决定主要知识顺序，词库作为额外覆盖目标，必要时增加补充单元）',
    ai_autonomous: '无外加词库与教材（由 AI 根据学习目标、目的与水平自主规划完整课程大纲）',
  };

  const lines: string[] = [
    `- **语言学习配置**：${langDesc}｜学习目的：${purposeLabel}｜输入组合：${inputModeDescMap[inputMode]}`,
  ];

  if (params.interestPreferences?.trim()) {
    lines.push(
      `- **用户兴趣与内容偏好（权重因素）**：${params.interestPreferences.trim()}（请提高相关领域的主题与文章占比，但仍须保证大纲主题具有广泛性和多样性，确保其他重要领域得到合理覆盖）`
    );
  } else {
    lines.push(
      `- **主题规划要求**：请保持主题的广泛性与多样性，结合学习目标与水平循序渐进组织模块。`
    );
  }

  if (params.topicCount && params.topicCount > 0) {
    lines.push(
      `- **主题数量规划 (N)**：请围绕 ${params.topicCount} 个核心主题及其下属小节/文章组织大纲（如为兼顾语义自然或词库覆盖需微调边界，可在保持主线清晰的前提下适度调整）。`
    );
  } else if (inputMode === 'vocab_only' || inputMode === 'vocab_and_material') {
    lines.push(
      `- **主题数量规划 (N)**：请先分析词库语义分布，自主规划合适数量的主题及其下属小节，避免为凑数量而拼凑语义不自然的文章。`
    );
  }

  if (!hasExplicitLang || params.targetLanguage !== 'english') {
    lines.push(
      `- **多语言模块结构提示**：可依据学习目标与语种特点在大纲中有机包含词汇、语法、阅读、对话等模块，直接遵循已有学习者起点与目标深度约束（非英语/非空格分词语言不强制套用英文词数密度规则）。`
    );
  }

  if (normalizedWords.length > 0) {
    const newWordsCount = Math.max(
      1,
      Number(params.newWordsPerArticle || params.dailyWordCount || 15)
    );
    if (!hasExplicitLang || params.targetLanguage === 'english') {
      const readingStats = computeEnglishReadingPlanStats({
        effectiveTotal: normalizedWords.length,
        newWordsPerArticle: newWordsCount,
        targetWordDensity: params.targetWordDensity || 0.04,
        expectedRepeatsPerWord: params.expectedRepeatsPerWord || 2,
      });
      const densityPct = Math.round(readingStats.targetWordDensity * 1000) / 10;
      lines.push(
        `- **词库阅读规划参数**：共 ${normalizedWords.length} 个待学目标词，用户期望每篇/节引入约 ${readingStats.newWordsPerArticle} 个不同新词（预计约 ${readingStats.estimatedArticleCount} 篇，**不按固定天数限制篇数**）；若为英语等空格分词阅读，目标词密度约 ${densityPct}%（参考文章长度约 ${readingStats.minWordLength}~${readingStats.maxWordLength} 词，自然连贯优先；日语等非空格分词语言可按自然篇幅调整）。`
      );
    } else {
      const langLabel = formatTargetLanguageLabel(params.targetLanguage, params.customLanguageName);
      const estCount = Math.max(1, Math.ceil(normalizedWords.length / newWordsCount));
      lines.push(
        `- **${langLabel}词库规划参数**：共 ${normalizedWords.length} 个待学目标词，参考每节引入约 ${newWordsCount} 个新词（预计约 ${estCount} 节，可依语法/对话体量自然调整）。`
      );
    }

    lines.push(
      `- **目标词稳定 ID 分配规则**：请在输出 \`sections\` 的每一节中使用 \`topicGroup\` 标明所属主题，并在 \`targetWordIds\` 数组中填入本节首次引入的目标词 ID（确保全词库每个词只在一个小节作为新词首次引入；若某节需复现已学词可填入 \`reviewWordIds\`，不计入新增词数；允许依据语义分组灵活调整每节新词个数）。`
    );

    const themePlan = params.vocabThemePlan;
    const existingSlots = Array.isArray(params.existingSlots) ? params.existingSlots : [];
    const themedSlots = existingSlots.filter(
      (s) => Boolean(s.targetWordIds && s.targetWordIds.length > 0 && (s.themeId || s.topicGroup))
    );

    if (themePlan?.lastAllocatedAt && themedSlots.length > 0) {
      const distLines = (themePlan.allocationSummary?.themeDistribution || []).map(
        (d) =>
          `  - ${d.themeId}「${d.themeName}」：${d.wordCount} 词 · ${d.sectionCount} 节（占比 ${d.sharePct}%）`
      );
      lines.push(
        `- **第 1 步已完成 AI 主题规划与加权语义分节（共 ${themedSlots.length} 节）**：\n${distLines.join('\n')}`
      );
      lines.push(
        `- **基于第 1 步结果完善第 2 步大纲**：请保持各节 \`id\`（\`sec-01\` ~ \`sec-${String(themedSlots.length).padStart(2, '0')}\`）与 \`topicGroup\` 一致，重点完善每节的具体文章角度、\`title\`、\`objective\`、\`keyTopics\`、\`teachingScope\`、\`connectionNote\` 与 \`reviewWordIds\`；**大纲 JSON 中可省略 \`targetWordIds\`**（系统将自动保留第 1 步按语义归类分配好的准确目标词 ID，无需重复搬运上千词 ID）。`
      );
      if (themedSlots.length <= 60) {
        const previewLines = themedSlots.map((s) => {
          const sample = (s.assignedWords || [])
            .slice(0, 4)
            .map((w) => w.word)
            .join(', ');
          return `  - ${s.id} | 主题: ${s.topicGroup || s.themeId} | 新词 ${s.targetWordIds?.length || 0} 个 (${sample}...)`;
        });
        lines.push(`- **第 1 步已分配小节预览**：\n${previewLines.join('\n')}`);
      } else {
        lines.push(
          `- **大词库分节提示**：当前共 ${themedSlots.length} 节${
            params.isAgentMode
              ? '（完整分节与 `targetWordIds` 已保存在课程目录 `outline.json` 与 `segments/vocab-theme-plan.json`，请直接读取并原地完善每节标题、目标与角度，切勿丢弃已有 `targetWordIds`）'
              : '（因小节数量较多，请按上述主题分布与小节总数顺序逐节细化标题、目标与话题方向）'
          }。`
        );
      }
    } else {
      if (themePlan && Array.isArray(themePlan.themes) && themePlan.themes.length > 0) {
        const plannedLines = themePlan.themes.map(
          (t) =>
            `  - ${t.id}「${t.name}」（权重 ${t.weight}${t.isInterestBoosted ? '，兴趣加权' : ''}${t.isGeneralFallback ? '，通用兜底' : ''}）：${t.description}`
        );
        lines.push(
          `- **第 1 步已确定的课程主题规划（共 ${themePlan.themes.length} 个主题）**：\n${plannedLines.join('\n')}`
        );
      }

      const maxInlineWords = 260;
      const displayedWords = normalizedWords.slice(0, maxInlineWords);
      const wordLines = displayedWords
        .map((w) => {
          const shortMeaning =
            w.meaning && w.meaning !== '待结合语境学习' ? ` (${w.meaning.slice(0, 32)})` : '';
          return `  - ${w.id}: ${w.word}${shortMeaning}`;
        })
        .join('\n');
      lines.push(`- **待分配目标词表（稳定 ID : 词条）**：\n${wordLines}`);
      if (normalizedWords.length > maxInlineWords) {
        lines.push(
          `  - （另有 ${normalizedWords.length - maxInlineWords} 个目标词未在此完整展开${
            params.isAgentMode ? '，请直接读取 `sources/vocabulary-effective.json` 获取全部词条与 ID' : ''
          }）`
        );
      }
    }
  }

  return lines.join('\n');
}

function getRecentOneMonthWindow(): { currentDate: string; oneMonthAgoDate: string } {
  const currentDate = getTodayDateString();
  const baseMs = Date.parse(`${currentDate}T00:00:00`);
  const d = Number.isFinite(baseMs) ? new Date(baseMs) : new Date();
  d.setDate(d.getDate() - 30);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return {
    currentDate,
    oneMonthAgoDate: `${year}-${month}-${day}`,
  };
}

function resolveSlotLanguageWords(course: Course, slot: DailyPlanSlot): {
  newWords: VocabItem[];
  prevSectionWords: VocabItem[];
  earlierReviewWords: VocabItem[];
  reviewWords: VocabItem[];
} {
  const effectiveWords = assignStableVocabIds(course.englishConfig?.effectiveWords || []);
  const vocabById = new Map<string, VocabItem>();
  const vocabByKey = new Map<string, VocabItem>();
  for (const w of effectiveWords) {
    if (w.id) vocabById.set(w.id, w);
    vocabByKey.set(normalizeWordKey(w.word), w);
  }

  let newWords: VocabItem[] = [];
  if (Array.isArray(slot.targetWordIds) && slot.targetWordIds.length > 0) {
    newWords = slot.targetWordIds
      .map((id) => vocabById.get(id))
      .filter((w): w is VocabItem => Boolean(w));
  }
  if (newWords.length === 0 && Array.isArray(slot.assignedWords) && slot.assignedWords.length > 0) {
    newWords = slot.assignedWords.map((w) => vocabByKey.get(normalizeWordKey(w.word)) || w);
  }

  const slotIdx = Math.max(
    0,
    course.dailyPlan.findIndex((s) => s.id === slot.id || s.dayIndex === slot.dayIndex)
  );
  const { prevSectionWords, earlierReviewWords } = getGroupedReviewWordsForSlot(course, slotIdx, {
    maxPrevCount: 16,
    maxEarlierCount: 14,
  });
  const reviewWords = getEligibleReviewWordsForSlot(course, slotIdx, 24);

  return { newWords, prevSectionWords, earlierReviewWords, reviewWords };
}

function buildLanguageLessonContext(
  course: Course,
  slot: DailyPlanSlot,
  explicitTargets?: VocabItem[]
): {
  targetLanguage: TargetLanguageCode;
  langLabel: string;
  learningPurpose: LanguageLearningPurpose;
  purposeLabel: string;
  newWords: VocabItem[];
  prevSectionWords: VocabItem[];
  earlierReviewWords: VocabItem[];
  reviewWords: VocabItem[];
  topicThemeInfo: string;
  readingLengthHint: string;
  targetWordsSection: string;
  prevSectionReviewInfo: string;
  earlierReviewInfo: string;
  languageContextSection: string;
  reviewWordsSection: string;
  bankSummary: string;
  wordListText: string;
} {
  const cfg = course.englishConfig;
  const hasExplicitLang = Boolean(cfg?.targetLanguage);
  const targetLanguage: TargetLanguageCode = cfg?.targetLanguage || 'english';
  const langLabel = hasExplicitLang
    ? formatTargetLanguageLabel(targetLanguage, cfg?.customLanguageName)
    : '外语/语言学习（随课程目标适配）';
  const learningPurpose: LanguageLearningPurpose = cfg?.learningPurpose || 'interest';
  const purposeLabel =
    learningPurpose === 'exam'
      ? '备考学习（重视核心词义、近义辨析与推断深度）'
      : '兴趣学习（重视文章可读性、表达地道与实际语用）';

  const resolved = resolveSlotLanguageWords(course, slot);
  const newWords =
    explicitTargets && explicitTargets.length > 0 ? explicitTargets : resolved.newWords;
  const { prevSectionWords, earlierReviewWords, reviewWords } = resolved;

  const inputMode: LanguageInputMode =
    cfg?.inputMode ||
    resolveLanguageInputMode(cfg?.effectiveWords?.length || 0, course.materials.length);

  const matchedTheme = (cfg?.vocabThemePlan?.themes || []).find(
    (t) =>
      (slot.themeId && t.id === slot.themeId) ||
      (slot.topicGroup && t.name === slot.topicGroup)
  );
  const topicThemeParts = [
    slot.topicGroup ? `主题：${slot.topicGroup}` : '',
    matchedTheme?.description ? `范围：${matchedTheme.description}` : '',
    slot.teachingScope ? `本节聚焦：${slot.teachingScope}` : '',
    !slot.topicGroup && !slot.teachingScope ? slot.title : '',
  ].filter(Boolean);
  const topicThemeInfo = topicThemeParts.join('｜') || slot.title;

  let readingLengthHint = '';
  if (newWords.length > 0 && (!hasExplicitLang || targetLanguage === 'english')) {
    const readingStats = computeEnglishReadingPlanStats({
      effectiveTotal: cfg?.effectiveWords?.length || newWords.length,
      newWordsPerArticle: newWords.length,
      targetWordDensity: cfg?.targetWordDensity || 0.04,
      expectedRepeatsPerWord: cfg?.expectedRepeatsPerWord || 2,
    });
    const densityPct = Math.round(readingStats.targetWordDensity * 1000) / 10;
    readingLengthHint = `英文正文参考 ${readingStats.minWordLength}~${readingStats.maxWordLength} 词（参考新词比例/密度约 ${densityPct}%，自然连贯优先，严禁生硬堆词；完整原文可高于参考长度）`;
  } else if (hasExplicitLang && targetLanguage !== 'english') {
    readingLengthHint = `采用适合${langLabel}的自然阅读/对话体量（不套用英文词数密度）`;
  } else {
    readingLengthHint = '优先使用最近一个月内真实英文文章完整原文（常见外刊深度阅读约 600~1500 词）；若无法展示完整原文而改写 AI 原创文章，请提供约 500~900 词完整语篇';
  }

  const lines: string[] = [
    `- **语言学习配置与目的**：${langLabel}｜${purposeLabel}`,
    `- **本节主题与话题**：${topicThemeInfo}`,
  ];
  if (cfg?.interestPreferences?.trim()) {
    lines.push(`- **学习者兴趣偏好**：${cfg.interestPreferences.trim()}`);
  }
  lines.push(`- **篇幅与选材参考**：${readingLengthHint}`);
  if (inputMode === 'vocab_and_material') {
    lines.push(`- **教材与词库整合要求**：紧扣关联教材主题并自然覆盖本节目标词。`);
  }

  const formatWordLine = (w: VocabItem) => {
    const meaningNote =
      w.meaning && w.meaning !== '待结合语境学习' ? `: ${w.meaning}` : ': （结合本文语境给出释义）';
    return `  - ${w.id ? `[${w.id}] ` : ''}${w.word}${w.phonetic ? ` (${w.phonetic})` : ''}${meaningNote}`;
  };

  const wordListText =
    newWords.length > 0
      ? newWords.map(formatWordLine).join('\n')
      : '（未指定必考词表：请从文章正文中自主精选 6～12 个有学习价值的生词写入 `englishPayload.targetWords`，供正文点击弹出释义）';

  const targetWordsSection =
    newWords.length > 0
      ? `- **本节首次引入目标词汇（共 ${newWords.length} 词，请自然融入文章语境，严禁机械堆砌；并全部收入 \`englishPayload.targetWords\` 支持正文点击弹窗）**：\n${newWords.map(formatWordLine).join('\n')}`
      : `- **本节生词处理方式**：当前为纯主题文章模式（未绑定外加词表），请从本篇英文正文中精选 6～12 个高价值生词/搭配写入 \`englishPayload.targetWords\`，供界面「点击正文生词弹出释义」使用。`;

  const slotIdx = Math.max(
    0,
    course.dailyPlan.findIndex((s) => s.id === slot.id || s.dayIndex === slot.dayIndex)
  );
  const immediatePrevSlot = slotIdx >= 1 ? course.dailyPlan[slotIdx - 1] : undefined;

  const prevSectionReviewInfo =
    prevSectionWords.length > 0
      ? `- **前一节（${
          immediatePrevSlot ? `第 ${immediatePrevSlot.dayIndex} 节《${immediatePrevSlot.title}》` : '上一节'
        }）已学词汇（可选复习词，共 ${prevSectionWords.length} 词；允许在本文与练习中自然复现，不强制重复次数，不计入本篇新增目标词数，若复现请一并放入 \`targetWords\` 且标 \`"isReview": true\`）**：\n${prevSectionWords
          .map(formatWordLine)
          .join('\n')}`
      : '';

  const earlierReviewInfo =
    earlierReviewWords.length > 0
      ? `- **更早小节已学词汇（补充可选复习词，共 ${earlierReviewWords.length} 词；自然复现即可，不计入本篇新增目标词数）**：\n${earlierReviewWords
          .map(formatWordLine)
          .join('\n')}`
      : '';

  const reviewWordsSection = [prevSectionReviewInfo, earlierReviewInfo]
    .filter(Boolean)
    .map((s) => `\n${s}`)
    .join('');

  const bankSummary = cfg
    ? cfg.effectiveWords.length > 0
      ? `${cfg.targetBankName || '自定义词库'}${cfg.excludedCount ? ` − ${cfg.excludedBankName || '已排除'} (${cfg.excludedCount})` : ''} = 待学 ${cfg.effectiveWords.length} 词（本节新词 ${newWords.length} 词${reviewWords.length > 0 ? `，可用复习词 ${reviewWords.length} 词` : ''}）`
      : `无外加词库（${inputMode === 'material_only' ? '基于教材结构规划' : '纯主题文章 / AI 自主规划'}）`
    : `本节 ${newWords.length} 词`;

  return {
    targetLanguage,
    langLabel,
    learningPurpose,
    purposeLabel,
    newWords,
    prevSectionWords,
    earlierReviewWords,
    reviewWords,
    topicThemeInfo,
    readingLengthHint,
    targetWordsSection,
    prevSectionReviewInfo,
    earlierReviewInfo,
    languageContextSection: lines.join('\n'),
    reviewWordsSection,
    bankSummary,
    wordListText,
  };
}

export function buildSyllabusUserPrompt(params: {
  name: string;
  category: CourseCategory;
  subjectProfile?: SubjectProfile;
  learnerLevel?: LearnerLevel;
  learnerBaseline?: LearnerBaselinePreset;
  customLearnerBaseline?: string;
  learningDepth?: LearningDepthPreset;
  customLearningDepth?: string;
  goal: string;
  durationDays: number;
  extraRequirements: string;
  materials: UploadedMaterial[];
  pdfSplitPlan?: PdfSplitPlanItem[];
  effectiveWords?: VocabItem[];
  dailyWordCount?: number;
  targetLanguage?: TargetLanguageCode;
  customLanguageName?: string;
  learningPurpose?: LanguageLearningPurpose;
  interestPreferences?: string;
  inputMode?: LanguageInputMode;
  topicCount?: number | null;
  targetWordDensity?: number;
  expectedRepeatsPerWord?: number;
  vocabThemePlan?: VocabThemePlan;
  existingSlots?: DailyPlanSlot[];
}): string {
  const blocks = loadSkillPromptBlocks();
  const {
    name,
    category,
    subjectProfile,
    learnerLevel = 'intermediate',
    learnerBaseline,
    customLearnerBaseline,
    learningDepth,
    customLearningDepth,
    goal,
    extraRequirements,
    materials,
    pdfSplitPlan = [],
    effectiveWords = [],
    dailyWordCount,
    targetLanguage,
    customLanguageName,
    learningPurpose,
    interestPreferences,
    inputMode,
    topicCount,
    targetWordDensity,
    expectedRepeatsPerWord,
    vocabThemePlan,
    existingSlots = [],
  } = params;

  const resolvedProfile = subjectProfile || inferSubjectProfile(category, name, extraRequirements);
  const resolvedLearner = resolveLearnerProfile({
    category,
    targetLanguage,
    learnerLevel,
    learnerBaseline,
    customLearnerBaseline,
    learningDepth,
    customLearningDepth,
  });
  const splitRegionsSummary = formatSplitRegionsSummary(pdfSplitPlan);
  const materialSummary = materials
    .map((m) => {
      const isPdf = Boolean(m.isPdf || m.fileName.toLowerCase().endsWith('.pdf'));
      if (isPdf) {
        const validBookmarks = (m.tocEntries || []).filter(
          (t) =>
            t.title &&
            !isCorruptedBookmarkTitle(t.title) &&
            (t.physicalPage === undefined ||
              (t.physicalPage >= 1 && (!m.totalPages || t.physicalPage <= m.totalPages)))
        );
        const tocNote =
          validBookmarks.length > 0
            ? `\n【PDF 内嵌电子书签】\n${validBookmarks
                .slice(0, 40)
                .map((t) => `- ${t.title} (物理第 ${t.physicalPage ?? '?'} 页)`)
                .join('\n')}`
            : '';
        return `【PDF 教材: ${m.fileName}${m.totalPages ? ` (共 ${m.totalPages} 物理页)` : ''}】\n- 多模态直读：本资料为 PDF 原文件，请直接依据随附的 PDF（或第 1 步切分出的区域 PDF）内容规划目录。${tocNote}`;
      }
      return `【文本资料: ${m.fileName}】\n${(m.extractedText || '').slice(0, 6500)}`;
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 20000);

  const vocabSection = buildLanguageSyllabusContext({
    category,
    materialsCount: materials.length,
    effectiveWords,
    dailyWordCount,
    targetLanguage,
    customLanguageName,
    learningPurpose,
    interestPreferences,
    inputMode,
    topicCount,
    newWordsPerArticle: dailyWordCount,
    targetWordDensity,
    expectedRepeatsPerWord,
    vocabThemePlan,
    existingSlots,
  });

  return interpolateTemplate(blocks.templates.syllabusUser, {
    name,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel: resolvedLearner.combinedLabel,
    goal,
    extraRequirements: extraRequirements || '按照课程目标与资料体系结构完整规划核心内容与练习',
    splitRegionsSection: splitRegionsSummary,
    materialSection: materialSummary ? `- 上传学习资料：\n${materialSummary}` : '',
    vocabSection,
  });
}

function buildCourseLessonTemplateVars(params: {
  course: Course;
  slot: DailyPlanSlot;
  prevSlot?: DailyPlanSlot;
  nextSlot?: DailyPlanSlot;
  materialContext: string;
}) {
  const { course, slot, prevSlot, nextSlot, materialContext } = params;
  const resolvedProfile =
    course.subjectProfile ||
    inferSubjectProfile(course.category, course.name, course.extraRequirements);
  const levelLabel = resolveLearnerProfile(course).combinedLabel;
  const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);

  const catalogText =
    course.knowledgeCatalog && course.knowledgeCatalog.length > 0
      ? `\n【课程知识点目录与先修依赖】\n${course.knowledgeCatalog
          .map(
            (n) =>
              `- ${n.title}（先修：${n.prerequisites.join('、') || '无'}${n.sectionId ? ` | 对应小节 ${n.sectionId}` : ''}）`
          )
          .join('\n')}`
      : '';

  const boundSegments =
    slot.pdfSegments && slot.pdfSegments.length > 0
      ? slot.pdfSegments
      : slot.pdfSegment
        ? [slot.pdfSegment]
        : [];
  const pdfSegmentNote =
    boundSegments.length > 0
      ? `\n【本节关联切分 PDF 资料】\n- 小节唯一 ID：${sectionId}（绑定区域：${boundSegments.map((s) => s.sectionId).join('、')}）\n${boundSegments
          .map(
            (seg, idx) =>
              `- 切分小节文件${boundSegments.length > 1 ? ` #${idx + 1}` : ''}：${seg.segmentRelPath || `segments/${seg.segmentFileName || `${seg.sectionId || sectionId}.pdf`}`}（原始 PDF：${seg.sourceFileName}，物理第 ${seg.physicalStartPage}~${seg.physicalEndPage} 页${
                seg.printedStartPage ? `，教材印刷第 ${seg.printedStartPage}~${seg.printedEndPage} 页` : ''
              }）`
          )
          .join('\n')}`
      : `\n【本节唯一标识】${sectionId}`;

  return {
    courseName: course.name,
    sectionId,
    dayIndex: slot.dayIndex,
    slotTitle: slot.title,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel,
    courseGoal: course.goal,
    slotObjective: slot.objective,
    prerequisites:
      slot.prerequisites?.join('、') ||
      (prevSlot ? `第 ${prevSlot.dayIndex} 节《${prevSlot.title}》` : '基础先修常识'),
    teachingScope: slot.teachingScope || slot.keyTopics.join('、'),
    keyTopics: slot.keyTopics.join('、'),
    prevCourseInfo: prevSlot ? `第 ${prevSlot.dayIndex} 节《${prevSlot.title}》` : '本节为第 1 节',
    nextCourseInfo: nextSlot ? `第 ${nextSlot.dayIndex} 节《${nextSlot.title}》` : '本节为最后一节',
    connectionNote: slot.connectionNote || '承接前序概念并为后续内容打基础',
    extraRequirements: course.extraRequirements || '推导连续，解释物理意义，语言朴实准确',
    catalogSection: `${catalogText}${pdfSegmentNote}`,
    materialSection: materialContext ? `\n【本节对应参考资料原文】\n${materialContext}` : '',
  };
}

export function buildCourseLessonUserPrompt(params: {
  course: Course;
  slot: DailyPlanSlot;
  prevSlot?: DailyPlanSlot;
  nextSlot?: DailyPlanSlot;
  materialContext: string;
}): string {
  const blocks = loadSkillPromptBlocks();
  return interpolateTemplate(blocks.templates.courseLessonUser, buildCourseLessonTemplateVars(params));
}

export function buildCourseLessonStage1Prompt(params: {
  course: Course;
  slot: DailyPlanSlot;
  prevSlot?: DailyPlanSlot;
  nextSlot?: DailyPlanSlot;
  materialContext: string;
}): string {
  const blocks = loadSkillPromptBlocks();
  return interpolateTemplate(blocks.templates.courseLessonStage1, buildCourseLessonTemplateVars(params));
}

export function buildLessonStage2DiagramsPrompt(params: {
  courseName: string;
  slot: Pick<DailyPlanSlot, 'id' | 'dayIndex' | 'title'>;
  diagramSpecs: Array<{
    id: string;
    title: string;
    stageLabel?: string;
    topologySpec: string;
    caption: string;
    linkedExerciseId?: string;
    contextSnippet?: string;
  }>;
}): string {
  const blocks = loadSkillPromptBlocks();
  const sectionId = ensureStableSectionId(params.slot.dayIndex, params.slot.id);
  const diagramSpecsJson = JSON.stringify(params.diagramSpecs, null, 2);
  return interpolateTemplate(blocks.templates.lessonStage2Diagrams, {
    courseName: params.courseName,
    dayIndex: params.slot.dayIndex,
    slotTitle: params.slot.title,
    sectionId,
    specCount: params.diagramSpecs.length,
    diagramSpecsJson,
  });
}

export function buildEnglishLessonUserPrompt(params: {
  course: Course;
  slot: DailyPlanSlot;
  prevSlot?: DailyPlanSlot;
  nextSlot?: DailyPlanSlot;
  targetWords: VocabItem[];
  articleMode: EnglishArticleMode;
  preferredSources: string;
  materialContext: string;
}): string {
  const blocks = loadSkillPromptBlocks();
  const {
    course,
    slot,
    prevSlot,
    nextSlot,
    targetWords,
    articleMode,
    preferredSources,
    materialContext,
  } = params;

  const langCtx = buildLanguageLessonContext(course, slot, targetWords);
  const englishLearnerProfile = resolveLearnerProfile({
    ...course,
    category: 'english',
    targetLanguage: langCtx.targetLanguage,
  });
  const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);
  const { currentDate, oneMonthAgoDate } = getRecentOneMonthWindow();

  return interpolateTemplate(blocks.templates.englishLessonUser, {
    courseName: course.name,
    sectionId,
    dayIndex: slot.dayIndex,
    slotTitle: slot.title,
    topicThemeInfo: langCtx.topicThemeInfo,
    slotObjective: slot.objective || `围绕「${langCtx.topicThemeInfo}」完成精读理解、词汇与长难句掌握`,
    learnerProfile: `${englishLearnerProfile.combinedLabel}（${englishLearnerProfile.strategySummary}）`,
    learningPurpose: langCtx.purposeLabel,
    currentDate,
    oneMonthAgoDate,
    preferredSources: preferredSources || 'The Economist, The Guardian, Nature, MIT Technology Review, BBC',
    readingLengthHint: langCtx.readingLengthHint,
    targetWordsSection: langCtx.targetWordsSection,
    prevSectionReviewInfo: langCtx.prevSectionReviewInfo,
    earlierReviewInfo: langCtx.earlierReviewInfo,
    courseGoal: course.goal,
    languageContextSection: langCtx.languageContextSection,
    bankSummary: langCtx.bankSummary,
    extraRequirements:
      (course.extraRequirements ? `${course.extraRequirements}；` : '') +
      (langCtx.newWords.length > 0
        ? '选文优先级：找最近一个月真实原文并微调词汇 > 根据原文自己重写并加入词汇 > 纯 AI 原创（严禁生硬堆砌）。'
        : '选文优先级：找最近一个月真实原文并微调词汇 > 根据原文自己重写并加入高价值词汇 > 纯 AI 原创并明确标注。'),
    articleMode,
    articleModeDesc:
      course.englishConfig?.targetLanguage && course.englishConfig.targetLanguage !== 'english'
        ? `依据${langCtx.langLabel}语言特征组织自然阅读、对话或语法精讲`
        : `优先找最近一个月（${oneMonthAgoDate} ~ ${currentDate}）真实原文并微调融入词汇 > 基于真实原文自己改写并加入词汇 > 无可用原文时再纯 AI 原创`,
    prevCourseInfo: prevSlot ? prevSlot.title : '第 1 讲',
    nextCourseInfo: nextSlot ? nextSlot.title : '课程总结',
    wordCount: langCtx.newWords.length,
    wordListText: langCtx.wordListText,
    reviewWordsSection: langCtx.reviewWordsSection,
    materialSection: materialContext ? `\n- **补充参考资料**：\n${materialContext}` : '',
  });
}

/**
 * Step 1: Build PDF Region Split Planning Prompts (API / Agent / Chat).
 * Assumes all three modes (API / Agent / Chat) use multimodal models that read the PDF file directly.
 */
export function buildPdfSplitPrompts(params: {
  course: Course;
  pdfMetas: PdfDocumentMeta[];
  courseRelDir: string;
}): {
  systemPrompt: string;
  apiUserPrompt: string;
  agentSplitPrompt: string;
  chatSplitPrompt: string;
} {
  const { course, pdfMetas, courseRelDir } = params;
  const primaryPdf = pdfMetas[0];
  const fileName = primaryPdf?.fileName || course.materials.find((m) => m.isPdf)?.fileName || 'textbook.pdf';
  const totalPages = Math.max(1, primaryPdf?.totalPages || course.materials.find((m) => m.isPdf)?.totalPages || 100);
  // Only apply manual offset explicitly set by the user (default 0)
  const pageOffset = course.pdfPageOffset ?? 0;
  const resolvedProfile =
    course.subjectProfile ||
    inferSubjectProfile(course.category, course.name, course.extraRequirements);
  const levelLabel = resolveLearnerProfile(course).combinedLabel;

  const cleanBookmarks = (primaryPdf?.tocEntries || []).filter(
    (t) =>
      t.title &&
      !isCorruptedBookmarkTitle(t.title) &&
      (t.physicalPage === undefined || (t.physicalPage >= 1 && t.physicalPage <= totalPages))
  );
  const tocSummary =
    cleanBookmarks.length > 0
      ? cleanBookmarks
          .slice(0, 80)
          .map(
            (t) =>
              `  - ${t.title} -> PDF 物理页: ${t.physicalPage ?? '?'}${
                t.printedPage !== undefined ? ` | 印刷页: ${t.printedPage}` : ''
              }`
          )
          .join('\n')
      : '  - （该 PDF 未包含内嵌电子书签，请直接多模态阅读随附 PDF 原文件本身中的目录页与各章节页面，确定物理页码范围）';

  const existingOutlineHint =
    course.outlineConfirmed && course.dailyPlan.length > 0
      ? `\n- 已参考的课程小节（供页码对齐）：\n${course.dailyPlan
          .map((s) => `  - ${ensureStableSectionId(s.dayIndex, s.id)}: 《${s.title}》`)
          .join('\n')}`
      : '';

  const offsetInstruction =
    pageOffset !== 0
      ? `用户已手动设定页码偏移量 pageOffset = ${pageOffset}（\`physicalPage = printedPage + ${pageOffset}\`），切分脚本最终严格按 \`physicalStartPage\` 与 \`physicalEndPage\`（1 ~ ${totalPages}）执行物理切割。`
      : `请直接通过多模态阅读 PDF 原文件的实际页面与物理页码（第 1 ~ ${totalPages} 页），输出 \`physicalStartPage\` 与 \`physicalEndPage\`。`;

  const systemPrompt = `你是一位严谨的多模态教材结构分析与 PDF 按小节切分规划专家。
你的任务（统一流程第 1 步）是根据用户提交的学习目标、基础水平、额外要求以及随附的教材 PDF 原文件本身，**依据教材章节、知识边界及先修关系划分出独立教学单元（\`region-01\`, \`region-02\`, ...）**（允许合并过短小节或拆分过长小节，**不受目标学习天数限制**），供本地脚本执行无损切割并保留原教材页码、公式、图示及引用关系；之后系统才会在第 2 步基于切分小节生成完整课程大纲。
注意：
1. 默认你具备多模态 PDF 原文件阅读能力，请直接阅读随附 PDF 原文件本身（含目录页、章节标题、公式与图表）。
2. 你只负责分析和输出结构化 JSON 区域划分方案（split-plan.json），实际 PDF 文件切割由本地脚本（scripts/split_pdf.ts）无损执行，请勿重新排版或生成 PDF 文件。
3. ${offsetInstruction}（同时请保留印刷页 \`printedStartPage\` / \`printedEndPage\` 与换算后物理页码，便于后续对照原教材）。
4. 每个划分区域应覆盖语义完整、先修顺序连贯的独立教学单元（避免将完整推导或图示截断在两区之间），若某区域需要前置章节的公式表、定义或原图引用，请填入 \`crossRefPages\` 数组（填入 1 ~ ${totalPages} 内的物理页码）并在 \`outlineMappingNote\` 中注明引用关系。`;

  const exampleEnd = Math.min(totalPages, 12);
  const jsonSchemaBlock = `{
  "sourceFileName": "${fileName}",
  "totalPages": ${totalPages},
  "pageOffset": ${pageOffset},
  "regions": [
    {
      "regionId": "region-01",
      "sectionTitle": "划分区域 1：按知识边界切分的独立教学小节（例如 1.1~1.2 核心概念与基础电路）",
      "sourceFileName": "${fileName}",
      "printedStartPage": 1,
      "printedEndPage": ${exampleEnd},
      "pageOffset": ${pageOffset},
      "physicalStartPage": 1,
      "physicalEndPage": ${exampleEnd},
      "crossRefPages": [],
      "outlineMappingNote": "涵盖的原教材章节号、核心公式/图示及跨节先修引用说明"
    }
  ]
}`;

  const apiUserPrompt = `请为课程《${course.name}》（第 1 步：按教材章节与知识边界切分 PDF 独立教学小节）制定结构化切分方案：
- **学科与水平**：${PROFILE_LABELS[resolvedProfile]}（${levelLabel}）
- **学习目标**：${course.goal}
- **个性化要求**：${course.extraRequirements || '按教材章节体系完整学习'}
- **原始 PDF 原文件**：\`${fileName}\`（共 ${totalPages} 物理页；已直接作为多模态 PDF 随本次请求附上，请直接阅读 PDF 原文件本身）${
    pageOffset !== 0 ? `；用户手动偏移量 pageOffset = ${pageOffset}` : ''
  }${existingOutlineHint}

- **PDF 内嵌电子书签目录**：
${tocSummary}

请依据教材章节结构、知识边界及先修关系划分为若干连续的独立教学小节（允许合并过短小节或拆分过长小节，**切分数量由教材知识边界决定，勿受限于目标学习天数**；完整保留原页码、公式、图示与跨节引用 \`crossRefPages\`），所有 \`physicalStartPage\` 与 \`physicalEndPage\` 必须严格落在 1 ~ ${totalPages} 之间。请严格输出以下 JSON 代码块（包含 \`regions\` 数组）：
\`\`\`json
${jsonSchemaBlock}
\`\`\``;

  const agentSplitPrompt = `# Agent 任务（第 1 步）：直接多模态阅读《${course.name}》PDF 原文件并按小节切分，调用脚本执行切割

## 一、课程要求与文件路径
- **课程名称**：${course.name}（${PROFILE_LABELS[resolvedProfile]} / ${levelLabel}）
- **学习目标**：${course.goal}
- **个性化要求**：${course.extraRequirements || '按教材体系深入自学'}
- **课程根目录**：\`${courseRelDir}\`
- **原始教材 PDF 原文件路径**：\`${courseRelDir}/sources/${fileName}\`（共 ${totalPages} 物理页；请直接以多模态方式读取该 PDF 文件）
- **区域划分方案输出路径**：\`${courseRelDir}/segments/split-plan.json\`
- **本地无损切割脚本**：\`npx tsx scripts/split_pdf.ts "${courseRelDir}"\`

## 二、PDF 内嵌电子书签（若有）
${tocSummary}

## 三、执行步骤要求
1. **直接多模态读取原始 PDF 文件 \`${courseRelDir}/sources/${fileName}\`** 的目录页与各章节实际页面，核对原教材印刷页码与 PDF 物理页码（共 1 ~ ${totalPages} 页；${
    pageOffset !== 0
      ? `用户已设手动偏移量 pageOffset = ${pageOffset}，即 physicalPage = printedPage + ${pageOffset}`
      : '直接按 PDF 实际物理页码规划'
  }）。
2. 按**教材章节、知识边界与先修关系**划分出独立教学单元（\`region-01\`, \`region-02\`, ...，允许合并过短小节或拆分过长小节，不受目标学习天数限制），规划准确的 \`printedStartPage\` / \`printedEndPage\` 与 \`physicalStartPage\` / \`physicalEndPage\`（1 ~ ${totalPages}）、前置交叉参考页 \`crossRefPages\` 与 \`outlineMappingNote\`，写入 \`${courseRelDir}/segments/split-plan.json\`。
3. 调用本地无损切割脚本，从原 PDF 无损切出各小节 PDF 文件（完整保留原教材页码、公式与图示），供第 2 步生成完整课程大纲：
   \`\`\`bash
   npx tsx scripts/split_pdf.ts "${courseRelDir}"
   \`\`\`
   脚本将在 \`${courseRelDir}/segments/\` 下生成 \`region-01.pdf\`、\`region-02.pdf\` 等无损区域 PDF。

## 四、\`split-plan.json\` 输出格式规范
\`\`\`json
${jsonSchemaBlock}
\`\`\``;

  const chatSplitPrompt = `我正在创建课程《${course.name}》（目标：${course.goal}，水平：${levelLabel}，要求：${course.extraRequirements || '按教材深入理解'}）。
现在是流程的 **第 1 步（按小节切分 PDF，保留页码/公式/图示与引用关系）**：请**直接多模态阅读我上传提交的教材 PDF 原文件（\`${fileName}\`，共 ${totalPages} 物理页）本身**，依据**教材章节、知识边界及先修关系**划分出独立教学单元（允许合并过短小节或拆分过长小节，**无需受限于学习天数**），给出准确的印刷页码与 **PDF 物理页码范围（1 ~ ${totalPages}）**，返回给我后由本地脚本完成无损切割。

### 1. PDF 内嵌书签与页码准则
- **直接读 PDF 原文件**：默认对话模型具备多模态 PDF 阅读能力，请直接查阅随附 PDF 原文件中的目录与正文页面。
- **页码与引用规范**：${
    pageOffset !== 0 ? `用户当前手动偏移量为 ${pageOffset}，` : ''
  }请保留印刷页码与换算后的 PDF 物理页码（第 1 ~ ${totalPages} 页），跨章引用前序公式/图示的物理页码请写入 \`crossRefPages\`，绝不截断完整公式推导或连续图解。
${tocSummary}

### 2. 输出要求
请只输出一个 \`\`\`json ... \`\`\` 代码块，列出全部切分小节的准确页码范围（\`region-01\`, \`region-02\`, ...）：
\`\`\`json
${jsonSchemaBlock}
\`\`\``;

  return {
    systemPrompt,
    apiUserPrompt,
    agentSplitPrompt,
    chatSplitPrompt,
  };
}

/**
 * Step 2: Build Agent Mode Syllabus Generation Prompt (after Step 1 PDF regions are split & sliced).
 */
export function buildAgentSyllabusPrompt(params: {
  course: Course;
  workspaceDir: string;
}): string {
  const blocks = loadSkillPromptBlocks();
  const { course, workspaceDir } = params;
  const resolvedProfile =
    course.subjectProfile ||
    inferSubjectProfile(course.category, course.name, course.extraRequirements);
  const levelLabel = resolveLearnerProfile({
    ...course,
    targetLanguage: course.englishConfig?.targetLanguage,
  }).combinedLabel;
  const splitRegionsSummary = formatSplitRegionsSummary(course.pdfSplitPlan);
  const cfg = course.englishConfig;
  const englishVocabSummary =
    course.category === 'english'
      ? buildLanguageSyllabusContext({
          category: course.category,
          materialsCount: course.materials.length,
          effectiveWords: cfg?.effectiveWords || [],
          dailyWordCount: cfg?.newWordsPerArticle || cfg?.dailyWordCount,
          targetLanguage: cfg?.targetLanguage,
          customLanguageName: cfg?.customLanguageName,
          learningPurpose: cfg?.learningPurpose,
          interestPreferences: cfg?.interestPreferences,
          inputMode: cfg?.inputMode,
          topicCount: cfg?.topicCount,
          newWordsPerArticle: cfg?.newWordsPerArticle || cfg?.dailyWordCount,
          targetWordDensity: cfg?.targetWordDensity,
          expectedRepeatsPerWord: cfg?.expectedRepeatsPerWord,
          vocabThemePlan: cfg?.vocabThemePlan,
          existingSlots: course.dailyPlan,
          isAgentMode: true,
        })
      : '';

  return interpolateTemplate(blocks.templates.agentSyllabus, {
    courseId: course.id,
    courseName: course.name,
    workspaceDir,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel,
    courseGoal: course.goal,
    extraRequirements: course.extraRequirements || '按知识依赖与先修关系合理划分独立教学小节',
    englishVocabSummary,
    splitRegionsSummary: splitRegionsSummary || '- （暂无已划分 PDF 区域，请直接多模态读取 `sources/` 中的 PDF 原文件或按课程目标规划完整大纲）',
  });
}

/**
 * Step 3: Dynamically build the complete Agent Mode Execution Prompt from the skill template.
 * Uses the unified `courses/<课程名称>/` directory and references per-section bound segmented PDFs (`segments/region-XX.pdf` or `segments/sec-XX.pdf`).
 */
export function buildAgentExecutionPrompt(params: {
  course: Course;
  workspaceDir: string;
  materialFilePaths: string[];
  teachingSystemPrompt: string;
}): string {
  const blocks = loadSkillPromptBlocks();
  const { course, workspaceDir, materialFilePaths, teachingSystemPrompt } = params;
  const resolvedProfile =
    course.subjectProfile ||
    inferSubjectProfile(course.category, course.name, course.extraRequirements);
  const levelLabel = resolveLearnerProfile({
    ...course,
    targetLanguage: course.englishConfig?.targetLanguage,
  }).combinedLabel;

  const materialFilesList =
    materialFilePaths.length > 0
      ? materialFilePaths.map((p) => `  - \`${p}\``).join('\n')
      : course.category === 'english'
        ? '  - （未上传外部资料文件：请优先检索最近一个月内真实英文文章完整原文，或基于近期可靠信息编写 AI 原创文章）'
        : '  - （未上传外部资料文件，请依据课程目标与标准教材体系编写）';

  if (course.category === 'english') {
    const cfg = course.englishConfig;
    const { currentDate, oneMonthAgoDate } = getRecentOneMonthWindow();
    const englishScheduleTable = course.dailyPlan
      .map((slot) => {
        const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);
        const status = slot.lesson ? '✅ 已完成（默认跳过，避免覆盖）' : '⏳ 待生成完整阅读课件';
        const langCtx = buildLanguageLessonContext(course, slot);
        const wordsNote =
          langCtx.newWords.length > 0
            ? `\n  - 本节新词(${langCtx.newWords.length}词)：${langCtx.newWords
                .map((w) => (w.id ? `${w.id}:${w.word}` : w.word))
                .join(', ')}`
            : '';
        const prevRevNote =
          langCtx.prevSectionWords.length > 0
            ? `\n  - 前一节可选复习词(${langCtx.prevSectionWords.length}词，允许自然复现)：${langCtx.prevSectionWords
                .slice(0, 14)
                .map((w) => w.word)
                .join(', ')}`
            : '';
        const topicNote = slot.topicGroup ? ` | 主题：${slot.topicGroup}` : '';
        const promptDirNote = `\n  - 单节阅读指令文件：\`${workspaceDir}/prompts/${sectionId}/agent-stage1-prompt.md\``;
        return `- **小节 \`${sectionId}\`（第 ${slot.dayIndex} 节）** -> 直接写入 \`${workspaceDir}/lessons/${sectionId}.json\` | 状态：${status}\n  - 标题：${slot.title}${topicNote}\n  - 目标：${slot.objective}\n  - 主题范围：${langCtx.topicThemeInfo}${wordsNote}${prevRevNote}${promptDirNote}`;
      })
      .join('\n');

    const englishVocabSummary = `- **语言学习配置**：${
      cfg?.targetLanguage
        ? `目标语言「${formatTargetLanguageLabel(cfg.targetLanguage, cfg.customLanguageName)}」｜`
        : ''
    }学习目的：${
      cfg?.learningPurpose === 'exam' ? '备考学习' : '兴趣学习'
    }${cfg?.interestPreferences ? `｜兴趣偏好：${cfg.interestPreferences}` : ''}${
      cfg && cfg.effectiveWords.length > 0
        ? `｜待学词库 ${cfg.effectiveWords.length} 词（新词分配保存在 \`outline.json\` 的 \`targetWordIds\` / \`assignedWords\` 与 \`sources/vocabulary-effective.json\` 中；复习词不计入新增词数；无需模型自行报告词频与覆盖率）`
        : '｜纯主题文章模式（每节从正文自主精选 6～12 个有学习价值的生词填入 targetWords 以支持点击弹窗）'
    }`;

    return interpolateTemplate(blocks.templates.agentEnglishBatch, {
      courseId: course.id,
      courseIdEncoded: encodeURIComponent(course.id),
      courseName: course.name,
      profileLabel: PROFILE_LABELS[resolvedProfile],
      levelLabel,
      courseGoal: course.goal,
      extraRequirements:
        course.extraRequirements ||
        '以完整英文文章为主体、词汇理解与实际运用为辅助，坚持先阅读后讲解再练习',
      englishVocabSummary,
      workspaceDir,
      materialFilesList,
      dailyScheduleTable: englishScheduleTable,
      teachingSystemPrompt,
      currentDate,
      oneMonthAgoDate,
    });
  }

  const dailyScheduleTable = course.dailyPlan
    .map((slot) => {
      const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);
      const status = slot.lesson
        ? '✅ 已完成（默认跳过，避免覆盖）'
        : slot.stage1Draft
          ? `📝 阶段一已完成（已存 lessons/${sectionId}.stage1.json，仅需执行阶段二图表生成与组装 -> lessons/${sectionId}.json）`
          : '⏳ 待从阶段一开始生成';
      const wordsNote =
        slot.assignedWords && slot.assignedWords.length > 0
          ? ` | 目标词汇(${slot.assignedWords.length}词)：${slot.assignedWords.map((w) => w.word).join(', ')}`
          : '';
      const topicNote = slot.topicGroup ? ` | 主题：${slot.topicGroup}` : '';
      const boundSegments =
        slot.pdfSegments && slot.pdfSegments.length > 0
          ? slot.pdfSegments
          : slot.pdfSegment
            ? [slot.pdfSegment]
            : [];
      const segNote =
        boundSegments.length > 0
          ? boundSegments
              .map((seg, segIdx) => {
                const segFileBase = seg.sectionId || sectionId;
                const relPath = seg.segmentRelPath || `${workspaceDir}/segments/${segFileBase}.pdf`;
                return `\n  - 关联切分 PDF${boundSegments.length > 1 ? ` #${segIdx + 1}` : ''}（请直接多模态读取该 PDF 原文件）：\`${relPath}\`（原始 PDF 物理第 ${seg.physicalStartPage}~${seg.physicalEndPage} 页）`;
              })
              .join('')
          : '';
      const promptDirNote = `\n  - 独立提示词目录：\`${workspaceDir}/prompts/${sectionId}/\`（阶段一：\`prompts/${sectionId}/agent-stage1-prompt.md\`，阶段二：\`prompts/${sectionId}/agent-stage2-prompt.md\`）`;
      return `- **小节 \`${sectionId}\`（第 ${slot.dayIndex} 节）** -> 输出文件：\`${workspaceDir}/lessons/${sectionId}.json\` | 状态：${status}\n  - 标题：${slot.title}${topicNote}\n  - 目标：${slot.objective}\n  - 教学范围与知识点：${slot.teachingScope || slot.keyTopics.join('、')}${wordsNote}${promptDirNote}${segNote}`;
    })
    .join('\n');

  return interpolateTemplate(blocks.templates.agentBatch, {
    courseId: course.id,
    courseIdEncoded: encodeURIComponent(course.id),
    courseName: course.name,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel,
    courseGoal: course.goal,
    extraRequirements: course.extraRequirements || '按教材标准深度编写，推导连续，语言朴实准确',
    englishVocabSummary: '',
    workspaceDir,
    materialFilesList,
    dailyScheduleTable,
    teachingSystemPrompt,
    englishPayloadSchemaNote: '',
  });
}

function buildChatLessonTemplateVars(params: {
  course: Course;
  slot: DailyPlanSlot;
  teachingSystemPrompt: string;
}) {
  const { course, slot, teachingSystemPrompt } = params;
  const resolvedProfile =
    course.subjectProfile ||
    inferSubjectProfile(course.category, course.name, course.extraRequirements);
  const levelLabel = resolveLearnerProfile(course).combinedLabel;
  const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);

  const prevSlot = course.dailyPlan.find((d) => d.dayIndex === slot.dayIndex - 1);
  const nextSlot = course.dailyPlan.find((d) => d.dayIndex === slot.dayIndex + 1);

  const nonPdfMaterialContext = course.materials
    .filter((m) => !m.isPdf && !m.fileName.toLowerCase().endsWith('.pdf'))
    .map((m) => `【文本资料: ${m.fileName}】\n${(m.extractedText || '').slice(0, 5000)}`)
    .join('\n\n')
    .slice(0, 12000);

  const pdfMaterials = course.materials.filter(
    (m) => Boolean(m.isPdf || m.fileName.toLowerCase().endsWith('.pdf'))
  );
  const boundSegments =
    slot.pdfSegments && slot.pdfSegments.length > 0
      ? slot.pdfSegments
      : slot.pdfSegment
        ? [slot.pdfSegment]
        : [];
  const pdfSegmentBanner =
    boundSegments.length > 0
      ? `- **本节关联切分 PDF 原文件（共 ${boundSegments.length} 个）**：${boundSegments
          .map((seg) => {
            const fileName = seg.segmentFileName || `${seg.sectionId || sectionId}.pdf`;
            const crossRef =
              seg.crossRefPages && seg.crossRefPages.length > 0
                ? `，含跨章前置页：第 ${seg.crossRefPages.join(', ')} 页`
                : '';
            return `\`${fileName}\`（对应原书《${seg.sourceFileName}》物理第 ${seg.physicalStartPage}~${seg.physicalEndPage} 页${crossRef}）`;
          })
          .join('；')}。\n  - **多模态直读说明**：请直接将${boundSegments.length > 1 ? '以上全部切分 PDF 文件' : '此切分 PDF 文件'}随本提示词一并上传给外部多模态 AI（无需上传整本教材）。\n`
      : pdfMaterials.length > 0
        ? `- **本节关联教材 PDF 原文件**：${pdfMaterials.map((m) => `\`${m.fileName}\`${m.totalPages ? ` (${m.totalPages}页)` : ''}`).join('、')}。\n  - **多模态直读说明**：请直接将教材 PDF 原文件随本提示词一并上传给外部多模态 AI 阅读。\n`
        : '';

  const langCtx = course.category === 'english' ? buildLanguageLessonContext(course, slot) : null;
  const englishWordsSection = langCtx
    ? `${langCtx.languageContextSection}${
        langCtx.newWords.length > 0
          ? `\n- **本节首次引入目标词汇（共 ${langCtx.newWords.length} 词，请自然融入正文，严禁生硬堆砌）**：\n${langCtx.newWords
              .map(
                (w) =>
                  `  - ${w.id ? `[${w.id}] ` : ''}${w.word}${w.phonetic ? ` (${w.phonetic})` : ''}: ${w.meaning}`
              )
              .join('\n')}`
          : ''
      }${langCtx.reviewWordsSection}\n- 注：无需自行报告词频统计或覆盖率。`
    : '';

  const englishPayloadField =
    course.category === 'english'
      ? `,\n  "englishPayload": {\n    "articleTitle": "阅读文章或对话标题",\n    "sourceReference": "主题参考来源",\n    "articleMode": "${course.englishConfig?.articleMode || 'llm_original'}",\n    "targetWords": [{"id": "w-001", "word": "单词", "phonetic": "/音标或读音/", "meaning": "释义", "example": "例句", "exampleTranslation": "例句翻译"}],\n    "paragraphs": [{"english": "外文段落", "chinese": "中文译文"}],\n    "grammarAndUsageNotes": "句法/语法拆解与近义辨析"\n  }`
      : '';

  const resolvedLevelLabel = resolveLearnerProfile({
    ...course,
    targetLanguage: course.englishConfig?.targetLanguage,
  }).combinedLabel;

  return {
    courseName: course.name,
    sectionId,
    dayIndex: slot.dayIndex,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel: resolvedLevelLabel,
    courseGoal: course.goal,
    slotTitle: slot.title,
    slotObjective: slot.objective,
    prerequisites:
      slot.prerequisites?.join('、') ||
      (prevSlot ? `第 ${prevSlot.dayIndex} 节《${prevSlot.title}》` : '基础先修常识'),
    teachingScope: slot.teachingScope || slot.keyTopics.join('、'),
    keyTopics: slot.keyTopics.join('、'),
    prevCourseInfo: prevSlot ? `第 ${prevSlot.dayIndex} 节《${prevSlot.title}》` : '本节为第 1 讲',
    nextCourseInfo: nextSlot ? `第 ${nextSlot.dayIndex} 节《${nextSlot.title}》` : '本节为最后一讲',
    connectionNote: slot.connectionNote || '承接前序概念并为后续内容打基础',
    extraRequirements: course.extraRequirements || '推导连续，解释物理意义，语言朴实准确',
    englishWordsSection: `${pdfSegmentBanner}${englishWordsSection}`,
    materialSection: nonPdfMaterialContext ? `\n- **补充文本资料**：\n${nonPdfMaterialContext}` : '',
    teachingSystemPrompt,
    englishPayloadField,
  };
}

function buildChatEnglishLessonTemplateVars(params: {
  course: Course;
  slot: DailyPlanSlot;
  teachingSystemPrompt: string;
}) {
  const { course, slot, teachingSystemPrompt } = params;
  const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);
  const prevSlot = course.dailyPlan.find((d) => d.dayIndex === slot.dayIndex - 1);
  const nextSlot = course.dailyPlan.find((d) => d.dayIndex === slot.dayIndex + 1);
  const langCtx = buildLanguageLessonContext(course, slot);
  const { currentDate, oneMonthAgoDate } = getRecentOneMonthWindow();

  const nonPdfMaterialContext = course.materials
    .filter((m) => !m.isPdf && !m.fileName.toLowerCase().endsWith('.pdf'))
    .map((m) => `【文本资料: ${m.fileName}】\n${(m.extractedText || '').slice(0, 5000)}`)
    .join('\n\n')
    .slice(0, 12000);

  const pdfMaterials = course.materials.filter(
    (m) => Boolean(m.isPdf || m.fileName.toLowerCase().endsWith('.pdf'))
  );
  const boundSegments =
    slot.pdfSegments && slot.pdfSegments.length > 0
      ? slot.pdfSegments
      : slot.pdfSegment
        ? [slot.pdfSegment]
        : [];
  const pdfSegmentBanner =
    boundSegments.length > 0
      ? `- **本节关联切分 PDF 原文件（共 ${boundSegments.length} 个）**：${boundSegments
          .map((seg) => `\`${seg.segmentFileName || `${seg.sectionId || sectionId}.pdf`}\``)
          .join('；')}。\n`
      : pdfMaterials.length > 0
        ? `- **本节关联教材 PDF 原文件**：${pdfMaterials.map((m) => `\`${m.fileName}\``).join('、')}。\n`
        : '';

  const englishWordsSection = `${pdfSegmentBanner}${langCtx.languageContextSection}\n${langCtx.targetWordsSection}${langCtx.reviewWordsSection}\n- 注：无需自行报告词频统计或覆盖率。`;
  const resolvedLevelLabel = resolveLearnerProfile({
    ...course,
    category: 'english',
    targetLanguage: course.englishConfig?.targetLanguage,
  }).combinedLabel;

  return {
    courseName: course.name,
    sectionId,
    dayIndex: slot.dayIndex,
    slotTitle: slot.title,
    topicThemeInfo: langCtx.topicThemeInfo,
    slotObjective: slot.objective || `围绕「${langCtx.topicThemeInfo}」完成精读与词汇运用`,
    courseGoal: course.goal,
    levelLabel: resolvedLevelLabel,
    learningPurpose: langCtx.purposeLabel,
    oneMonthAgoDate,
    currentDate,
    preferredSources:
      course.englishConfig?.preferredSources ||
      'The Economist, The Guardian, Nature, MIT Technology Review, BBC',
    readingLengthHint: langCtx.readingLengthHint,
    articleMode: course.englishConfig?.articleMode || 'media_search',
    prevCourseInfo: prevSlot ? `第 ${prevSlot.dayIndex} 节《${prevSlot.title}》` : '本节为第 1 讲',
    nextCourseInfo: nextSlot ? `第 ${nextSlot.dayIndex} 节《${nextSlot.title}》` : '本节为最后一讲',
    connectionNote: slot.connectionNote || '自然承接前一节所学词汇并扩展新主题阅读',
    extraRequirements:
      course.extraRequirements ||
      '以完整英文文章为主体、词汇理解与实际运用为辅助，先阅读后讲解再练习',
    englishWordsSection,
    materialSection: nonPdfMaterialContext ? `\n- **补充参考文本资料**：\n${nonPdfMaterialContext}` : '',
    teachingSystemPrompt,
  };
}

/**
 * Step 3: Build Chat Mode Stage 1 Prompt (Teaching content + diagram specs only, no SVG;
 * or single-shot complete reading lesson when course.category === 'english').
 */
export function buildChatLessonStage1Prompt(params: {
  course: Course;
  slot: DailyPlanSlot;
  teachingSystemPrompt: string;
}): string {
  const blocks = loadSkillPromptBlocks();
  if (params.course.category === 'english' && blocks.templates.chatEnglishLesson) {
    return interpolateTemplate(
      blocks.templates.chatEnglishLesson,
      buildChatEnglishLessonTemplateVars(params)
    );
  }
  return interpolateTemplate(blocks.templates.chatLessonStage1, buildChatLessonTemplateVars(params));
}

/**
 * Step 3: Dynamically build the single-lesson Chat Mode Prompt from the skill template.
 * Instructs multimodal Chat AI to read the attached PDF file directly.
 */
export function buildChatLessonPrompt(params: {
  course: Course;
  slot: DailyPlanSlot;
  teachingSystemPrompt: string;
}): string {
  const blocks = loadSkillPromptBlocks();
  if (params.course.category === 'english' && blocks.templates.chatEnglishLesson) {
    return interpolateTemplate(
      blocks.templates.chatEnglishLesson,
      buildChatEnglishLessonTemplateVars(params)
    );
  }
  return interpolateTemplate(blocks.templates.chatLesson, buildChatLessonTemplateVars(params));
}

/**
 * Step 2: Dynamically build the Chat Mode Syllabus Prompt from the skill template (consuming Step 1 split regions).
 * Instructs multimodal Chat AI to read the attached PDF files directly.
 */
export function buildChatSyllabusPrompt(params: {
  course: Course;
}): string {
  const blocks = loadSkillPromptBlocks();
  const { course } = params;
  const resolvedProfile =
    course.subjectProfile ||
    inferSubjectProfile(course.category, course.name, course.extraRequirements);
  const levelLabel = resolveLearnerProfile({
    ...course,
    targetLanguage: course.englishConfig?.targetLanguage,
  }).combinedLabel;
  const splitRegionsSummary = formatSplitRegionsSummary(course.pdfSplitPlan);
  const cfg = course.englishConfig;
  const vocabSection =
    course.category === 'english'
      ? buildLanguageSyllabusContext({
          category: course.category,
          materialsCount: course.materials.length,
          effectiveWords: cfg?.effectiveWords || [],
          dailyWordCount: cfg?.newWordsPerArticle || cfg?.dailyWordCount,
          targetLanguage: cfg?.targetLanguage,
          customLanguageName: cfg?.customLanguageName,
          learningPurpose: cfg?.learningPurpose,
          interestPreferences: cfg?.interestPreferences,
          inputMode: cfg?.inputMode,
          topicCount: cfg?.topicCount,
          newWordsPerArticle: cfg?.newWordsPerArticle || cfg?.dailyWordCount,
          targetWordDensity: cfg?.targetWordDensity,
          expectedRepeatsPerWord: cfg?.expectedRepeatsPerWord,
          vocabThemePlan: cfg?.vocabThemePlan,
          existingSlots: course.dailyPlan,
        })
      : '';

  const materialContext = course.materials
    .map((m) => {
      const isPdf = Boolean(m.isPdf || m.fileName.toLowerCase().endsWith('.pdf'));
      if (isPdf) {
        return `【PDF 教材原文件: ${m.fileName}${m.totalPages ? ` (共 ${m.totalPages} 页)` : ''}】请直接上传此 PDF 或第 1 步切分出的区域 PDF（region-XX.pdf）给外部多模态 AI 阅读。`;
      }
      return `【文本资料: ${m.fileName}】\n${(m.extractedText || '').slice(0, 6000)}`;
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 15000);

  return interpolateTemplate(blocks.templates.chatSyllabus, {
    courseName: course.name,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel,
    courseGoal: course.goal,
    extraRequirements: course.extraRequirements || '按知识依赖与先修关系合理划分独立教学小节',
    vocabSection,
    splitRegionsSection: splitRegionsSummary,
    materialSection: materialContext ? `- **学习资料（多模态 PDF 原文件直读）**：\n${materialContext}` : '',
  });
}

/**
 * Build a concise prompt for AI semantic verification of uncertain/homograph vocabulary matches.
 */
export function buildVocabSemanticReviewPrompt(
  course: Course,
  targetSectionId?: string
): {
  prompt: string;
  pendingItems: Array<{
    sectionId: string;
    wordId: string;
    word: string;
    meaning: string;
    snippets: string[];
  }>;
} {
  const coverage = syncCourseVocabCoverage(course);
  const vocabById = new Map<string, VocabItem>();
  for (const w of course.englishConfig?.effectiveWords || []) {
    if (w.id) vocabById.set(w.id, w);
  }

  const pendingItems: Array<{
    sectionId: string;
    wordId: string;
    word: string;
    meaning: string;
    snippets: string[];
  }> = [];

  if (coverage) {
    for (const [secId, secRec] of Object.entries(coverage.bySection)) {
      if (targetSectionId && secId !== targetSectionId) continue;
      for (const m of secRec.matches) {
        if (m.semanticStatus === 'needs_review') {
          const item = vocabById.get(m.wordId);
          pendingItems.push({
            sectionId: secId,
            wordId: m.wordId,
            word: m.word,
            meaning: item?.meaning || '待结合语境学习',
            snippets: m.snippets,
          });
        }
      }
    }
  }

  const prompt =
    pendingItems.length > 0
      ? [
          `请对课程《${course.name}》中以下存在同形异义或词形歧义的目标词进行语义复核：判断正文中该词的实际词义是否符合目标词释义。`,
          '仅输出合法 JSON 对象：',
          '```json',
          JSON.stringify(
            {
              reviews: pendingItems.map((it) => ({
                sectionId: it.sectionId,
                wordId: it.wordId,
                status: 'confirmed | rejected',
                reason: '简述判断理由',
              })),
            },
            null,
            2
          ),
          '```',
          '',
          '待复核词条与原文语境：',
          ...pendingItems.map(
            (it, idx) =>
              `${idx + 1}. [${it.sectionId} / ${it.wordId}] **${it.word}**（目标释义：${it.meaning}）\n   原文语境：${it.snippets.join(' | ') || '（无片段）'}`
          ),
        ].join('\n')
      : '';

  return { prompt, pendingItems };
}

/**
 * Step 1A: Build prompt for AI to design N semantic course themes tailored to the
 * vocabulary bank, learning purpose, learner baseline, and optional interest weights.
 */
export function buildVocabThemePlanningPrompt(params: {
  course: Course;
  mode: 'api' | 'chat' | 'agent';
  courseRelDir?: string;
}): {
  systemPrompt: string;
  userPrompt: string;
} {
  const { course, mode, courseRelDir } = params;
  const cfg = course.englishConfig;
  const effectiveWords = assignStableVocabIds(cfg?.effectiveWords || []);
  const newWordsPerArticle = Math.max(
    1,
    Number(cfg?.newWordsPerArticle || cfg?.dailyWordCount || 20)
  );
  const estArticles =
    effectiveWords.length > 0
      ? Math.ceil(effectiveWords.length / newWordsPerArticle)
      : Math.max(1, Number(cfg?.estimatedArticleCount || course.durationDays || 10));
  const requestedN =
    typeof cfg?.topicCount === 'number' && cfg.topicCount > 0 ? cfg.topicCount : null;
  const recommendedMin = Math.max(4, Math.min(12, Math.round(estArticles / 6) || 4));
  const recommendedMax = Math.max(recommendedMin + 2, Math.min(18, Math.round(estArticles / 3) + 3));

  const learner = resolveLearnerProfile({
    ...course,
    targetLanguage: cfg?.targetLanguage,
  });
  const purposeLabel =
    cfg?.learningPurpose === 'exam'
      ? '备考学习（要求主题完整覆盖词库与常考语境，不偏科遗漏）'
      : '兴趣学习（注重内容趣味性、连贯性与实用语境）';
  const interestText = cfg?.interestPreferences?.trim();
  const sampleWords = sampleVocabForThemePlanning(effectiveWords, 120);
  const sampleLines = sampleWords
    .map((w) => {
      const meaning =
        w.meaning && w.meaning !== '待结合语境学习' ? ` — ${w.meaning.slice(0, 28)}` : '';
      return `${w.id}: ${w.word}${meaning}`;
    })
    .join('\n');

  const workspaceDir =
    courseRelDir || course.courseDirPath || `courses/${course.folderName || course.id}`;

  const systemPrompt = [
    '你是资深语言课程架构师与词汇语料分析专家。',
    effectiveWords.length > 0
      ? '请根据待学词库的语义分布、用户学习目的与兴趣权重，规划结构清晰、覆盖全面且主题边界明确的课程主题体系。'
      : '请根据用户的学习目标、学习目的、水平与兴趣偏好，规划多元均衡的主题阅读体系及每个主题权重。',
    '输出必须是合法 JSON，不要编造空泛占位词，也不得强行把全部领域都塞进用户兴趣方向导致视野狭窄。',
  ].join('\n');

  const jsonSchemaBlock = [
    '{',
    '  "themes": [',
    '    {',
    '      "id": "T01",',
    '      "name": "主题中文名称（清晰具体，如：人工智能、数字科技与信息社会）",',
    '      "description": "1~2句话说明该主题适合容纳哪类词汇、阅读题材与文章角度",',
    '      "weight": 1.8,',
    '      "isInterestBoosted": true,',
    '      "isGeneralFallback": false,',
    '      "subtopics": ["代表子话题1", "代表子话题2", "代表子话题3"],',
    '      "keywords": ["algorithm", "digital", "innovation", "智能", "算法", "数据", "科技", "网络"]',
    '    },',
    '    {',
    '      "id": "T08",',
    '      "name": "通用逻辑表达、动作变化与跨领域论述",',
    '      "description": "专用于容纳不局限单一学科的高频动词、抽象名词、程度副词与论证衔接词",',
    '      "weight": 1.0,',
    '      "isInterestBoosted": false,',
    '      "isGeneralFallback": true,',
    '      "subtopics": ["逻辑论证与观点表达", "趋势变化与过程描述"],',
    '      "keywords": ["abstract", "essential", "maintain", "趋势", "影响", "本质", "逐步"]',
    '    }',
    '  ]',
    '}',
  ].join('\n');

  const lines: string[] = [
    `# 步骤 1A：为语言课程《${course.name}》规划课程主题`,
    '',
    `- **学习目的**：${purposeLabel}`,
    `- **学习目标**：${course.goal || '在真实语境精读中系统提升阅读理解与词汇运用能力'}`,
    `- **学习者配置**：${learner.combinedLabel}`,
    effectiveWords.length > 0
      ? `- **词库规模**：待学 **${effectiveWords.length}** 词；每篇约引入 ${newWordsPerArticle} 新词（预计共约 ${estArticles} 篇文章）`
      : `- **课程形式**：纯主题阅读课程（未绑定外加词库；预计规划约 **${estArticles}** 篇主题文章，按权重比例直接分节，可跳过第 2 步大纲生成）`,
    requestedN
      ? `- **目标主题数量 (N)**：请规划 **${requestedN}** 个主题（含 1 个通用跨领域主题 \`isGeneralFallback: true\`）。`
      : `- **目标主题数量 (N)**：请依据目标与预计 ${estArticles} 篇文章，合理规划 **${recommendedMin}~${recommendedMax}** 个主题（含 1 个 \`isGeneralFallback: true\` 主题）。`,
    interestText
      ? `- **用户兴趣与偏好权重（重点）**：${interestText}\n  - 请为贴合上述偏好的主题设置较高 \`weight\`（如 \`1.5 ~ 2.4\`）并标 \`"isInterestBoosted": true\`；\n  - **同时保持主题广泛性与多样性**：其余非偏好基础领域（如社会民生、生态环境、健康医学、文化教育、经济法律等）仍须设置合理主题（\`weight: 0.7 ~ 1.1\`），保证视野/考试覆盖广度，切勿只生成兴趣主题。`
      : `- **主题广度要求**：用户未限定单一兴趣方向，请均衡覆盖科技、经济商业、社会民生、生态自然、教育文化、健康心理与通用学术论述等多元领域，\`weight\` 可依据需求微调（0.8 ~ 1.3）。`,
    `- **子话题与关键词要求**：每个主题请提供 3~5 个具体可写作最近一个月外刊文章的 \`subtopics\`，以及 15~25 个中英双语特征词 \`keywords\`。`,
  ];

  if (effectiveWords.length > 0) {
    lines.push(
      '',
      '## 待学词库分层抽样样本（共 ' + sampleWords.length + ' / ' + effectiveWords.length + ' 词）',
      '```text',
      sampleLines,
      '```'
    );
  }

  if (mode === 'agent') {
    lines.push(
      '',
      '## Agent 工作区输出要求',
      ...(effectiveWords.length > 0
        ? [`- 请同时查阅工作区完整词表 \`${workspaceDir}/sources/vocabulary-effective.json\` 校验词库领域分布。`]
        : []),
      `- 将最终 JSON（含顶层 \`"themes": [...]\`）写入 \`${workspaceDir}/segments/vocab-theme-plan.json\`（若该文件已存在且含 \`wordThemes\`，请保留已有有效映射，仅更新 \`themes\` 与 \`lastThemesUpdatedAt\`）。`,
      '',
      '目标 JSON 结构示例：',
      '```json',
      jsonSchemaBlock,
      '```'
    );
  } else {
    lines.push(
      '',
      '## 输出格式要求',
      '请**仅输出合法 JSON 对象**，不要包含多余解释文字，格式如下：',
      '```json',
      jsonSchemaBlock,
      '```'
    );
  }

  return {
    systemPrompt,
    userPrompt: lines.join('\n'),
  };
}

/**
 * Step 1B: Build compact prompt for AI to assign 1~3 candidate theme IDs per vocabulary word.
 */
export function buildVocabWordMappingPrompt(params: {
  course: Course;
  themes: VocabThemeItem[];
  batchWords: VocabItem[];
  batchIndex: number;
  totalBatches: number;
  mode: 'api' | 'chat' | 'agent';
  fullFileMode?: boolean;
  courseRelDir?: string;
}): {
  systemPrompt: string;
  userPrompt: string;
} {
  const {
    course,
    themes,
    batchWords,
    batchIndex,
    totalBatches,
    mode,
    fullFileMode = false,
    courseRelDir,
  } = params;

  const workspaceDir =
    courseRelDir || course.courseDirPath || `courses/${course.folderName || course.id}`;

  const themeLegend = themes
    .map(
      (t) =>
        `- **${t.id}**：${t.name}（权重 ${t.weight}${t.isInterestBoosted ? ' · 兴趣加权' : ''}${t.isGeneralFallback ? ' · 通用兜底' : ''}）— ${t.description}`
    )
    .join('\n');

  const systemPrompt = [
    '你是语言词汇语义分类助手。请严格依据每个词的词义与典型使用语境，从给定的主题 ID 列表中选出 1~3 个最契合的主题 ID（按契合度由高到低排序）。',
    '注意：绝对不要为了迎合兴趣主题而强行归入语义无关的词汇；不局限于具体学科的通用动词/抽象形容词应归入通用跨领域兜底主题（或同时列出 2~3 个自然适用的场景主题）。',
  ].join('\n');

  const rulesBlock = [
    '## 归类规则',
    '1. 每个词条分配 **1~3 个主题 ID**（如 `T02` 或 `T02, T01`），**第 1 个为最契合主主题**，其余为也可自然出现的候选主题。',
    '2. 请保持忠实语义匹配：不要强行把非兴趣领域的词塞进兴趣主题；后续算法会利用多候选列表按主题权重自然平衡篇幅。',
    '3. 请勿遗漏本批中的任何词条 ID，不要自造不存在的主题 ID。',
  ];

  if (mode === 'agent') {
    const lines = [
      `# 步骤 1B（Agent 模式）：为《${course.name}》全词库词条归类候选主题`,
      '',
      `- **词库源文件**：读取 \`${workspaceDir}/sources/vocabulary-effective.json\` 中的全部 \`effectiveWords\`（含稳定 \`id\`、\`word\`、\`meaning\`）`,
      `- **主题定义文件**：读取 \`${workspaceDir}/segments/vocab-theme-plan.json\`（若已存在部分 \`wordThemes\`，保留 \`source: "manual"\` 及已有有效 \`"ai"\` 映射，补全其余未归类或 \`"local"\` 词条）`,
      '',
      '## 可选主题清单',
      themeLegend,
      '',
      ...rulesBlock,
      '',
      '## 本地执行与写入格式',
      `- 请分批认真完成全部待学词的语义归类（禁止用随机函数代替语义判断），并将结果合并写入 \`${workspaceDir}/segments/vocab-theme-plan.json\` 的 \`wordThemes\` 字段，格式为：`,
      '```json',
      '{',
      '  "themes": [ ...保留原 themes 数组... ],',
      '  "wordThemes": {',
      '    "w-0001": { "themeIds": ["T02", "T01"], "source": "ai" },',
      '    "w-0002": { "themeIds": ["T08"], "source": "ai" }',
      '  }',
      '}',
      '```',
      `- 写入完成后提示用户在本工作台点击「扫描同步本地 vocab-theme-plan.json」。`,
    ];
    return {
      systemPrompt,
      userPrompt: lines.join('\n'),
    };
  }

  if (mode === 'api') {
    const wordList = batchWords
      .map((w) => {
        const meaning =
          w.meaning && w.meaning !== '待结合语境学习' ? w.meaning.slice(0, 40) : '';
        return `${w.id}\t${w.word}\t${meaning}`;
      })
      .join('\n');
    const lines = [
      `请为以下 ${batchWords.length} 个目标词分配最契合的 1~3 个主题 ID（第 ${batchIndex}/${Math.max(1, totalBatches)} 批）：`,
      '',
      '## 可选主题清单',
      themeLegend,
      '',
      ...rulesBlock,
      '',
      '仅输出合法 JSON 对象（不要额外解释）：',
      '```json',
      '{"assignments":{"w-0001":["T02","T01"],"w-0002":["T08"]}}',
      '```',
      '',
      '## 本批待归类词条（ID \\t 词条 \\t 释义）',
      wordList,
    ];
    return {
      systemPrompt,
      userPrompt: lines.join('\n'),
    };
  }

  // Chat mode: either full-file upload or ultra-compact batching
  if (fullFileMode) {
    const lines = [
      `# 步骤 1B（Chat 上传词表文件全量归类）：《${course.name}》`,
      '',
      '我已随本提示词附带了压缩词表文件 **`vocabulary-compact.txt`**（每行格式：`w-0001<TAB>单词<TAB>释义`）。',
      '',
      '## 可选主题清单',
      themeLegend,
      '',
      ...rulesBlock,
      '',
      '## 输出要求（请生成可复制或可下载的结果）',
      '- 请读取附件中的所有词条 ID，逐一输出每个词对应的 1~3 个主题 ID。',
      '- **强烈建议使用最省 token 的紧凑逐行格式**（若词数多可分代码块输出，或直接生成并给出一个供我下载的 `vocab-theme-map.txt` / `.json` 文件）：',
      '```text',
      'w-0001: T02, T01',
      'w-0002: T08',
      '```',
      '- 如模型支持直接写出文件，也可输出 JSON：`{"assignments":{"w-0001":["T02","T01"]}}`。完成后我将直接粘贴或导入结果文件。',
    ];
    return {
      systemPrompt,
      userPrompt: lines.join('\n'),
    };
  }

  const compactWordLines = batchWords
    .map((w) => {
      const meaning =
        w.meaning && w.meaning !== '待结合语境学习' ? w.meaning.slice(0, 32) : '';
      return `${w.id} | ${w.word}${meaning ? ` | ${meaning}` : ''}`;
    })
    .join('\n');

  const lines = [
    `# 步骤 1B（分批语义归类 · 本批 ${batchWords.length} 词 · 第 ${batchIndex}/${Math.max(1, totalBatches)} 批）`,
    '',
    '## 可选主题清单',
    themeLegend,
    '',
    ...rulesBlock,
    '',
    '## 输出格式（请严格使用下方紧凑逐行格式输出在单个代码块中，最省输出长度且支持自动合并）',
    '```text',
    'w-0001: T02, T01',
    'w-0002: T08',
    '```',
    '',
    `## 本批待归类词条（共 ${batchWords.length} 词）`,
    '```text',
    compactWordLines,
    '```',
  ];

  return {
    systemPrompt,
    userPrompt: lines.join('\n'),
  };
}

/**
 * Step 3 (Agent Mode): Targeted single-section prompt for Stage 1 or Stage 2 execution/retry in local workspace.
 */
export function buildEnglishStage2WordGlossPrompt(params: {
  course: Course;
  slot: DailyPlanSlot;
  lesson: DailyLessonContent;
  pendingWords?: PendingWordGlossItem[];
  allowSynonymReplacement?: boolean;
  mode: 'api' | 'chat' | 'agent';
  workspaceDir?: string;
}): {
  systemInstruction: string;
  userPrompt: string;
  pendingCount: number;
  allowSynonymReplacement: boolean;
  stats: ReturnType<typeof computeSectionAssociatedVocabStats>;
} {
  const { course, slot, lesson, mode, workspaceDir = '.' } = params;
  const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);
  const liveStats = computeSectionAssociatedVocabStats(course, slot, lesson);
  const words = params.pendingWords ?? extractPendingGlossWordsForSection(course, slot, lesson);
  const allowSynonymReplacement =
    params.allowSynonymReplacement ?? isWeakBaselineForVocabSimplification(course);
  const articleTitle = lesson.englishPayload?.articleTitle || lesson.title || slot.title;
  const paragraphs = lesson.englishPayload?.paragraphs || [];

  const protectedWords = Array.from(
    new Set(
      [
        ...(lesson.englishPayload?.targetWords || []).map((w) => String(w.word || '').trim()),
        ...(slot.assignedWords || []).map((w) => String(w.word || '').trim()),
      ].filter(Boolean)
    )
  );

  const statsLines = [
    `## Step 2 当前文章关联生词统计（由本地程序确定性计算）`,
    `- 课程与小节：《${course.name}》 · ${sectionId} ${slot.title}`,
    `- 文章标题：${articleTitle}`,
    `- 学习者基础定位：${course.learnerBaseline || course.learnerLevel || 'default'}${course.customLearnerBaseline ? `（${course.customLearnerBaseline}）` : ''}`,
    `- 正文词数：约 ${liveStats.proseWordCount} 词 ｜ 本节规划新词：${liveStats.plannedNewCount} 词 ｜ 前节复现词：${liveStats.reviewWordCount} 词`,
    `- 当前关联生词（词库中非本节规划的命中词）：${liveStats.associatedWordCount} 词（共出现 ${liveStats.associatedOccurrences} 次，占正文约 ${liveStats.associatedDensityPercent}%）`,
    `- 待补充简明释义词数：${words.length} 词`,
  ];

  const candidateRows: string[] = [];
  if (words.length > 0) {
    words.forEach((w, idx) => {
      const surfaceNote =
        w.surfaceForms.length > 0 && w.surfaceForms.join('/') !== w.word
          ? `（文中形态: ${w.surfaceForms.join('/')}）`
          : '';
      const roleNote = w.role === 'new' ? '[目标新词缺释义]' : w.role === 'review' ? '[复现词缺释义]' : '[关联词]';
      const snippetNote = w.contextSnippet ? ` ｜ 语境: "${w.contextSnippet}"` : '';
      candidateRows.push(`${idx + 1}. ${w.wordId} | ${w.word}${surfaceNote} ${roleNote}${snippetNote}`);
    });
  } else if (allowSynonymReplacement && liveStats.associatedWords.length > 0) {
    liveStats.associatedWords.slice(0, 80).forEach((w, idx) => {
      const snippetNote = w.snippet ? ` ｜ 语境: "${w.snippet}"` : '';
      candidateRows.push(`${idx + 1}. ${w.wordId} | ${w.word}（文中出现 ${w.count} 次）${snippetNote}`);
    });
  }

  const agentHeader =
    mode === 'agent'
      ? [
          `# Agent 模式单节 Step 2 补充词义执行指令（${sectionId}）`,
          `- **读取当前课件文件**：\`${workspaceDir}/lessons/${sectionId}.json\``,
          allowSynonymReplacement
            ? `- **更新规则**：按下方要求在 \`englishPayload.paragraphs\` 中对过度密集的关联生词作简单同义替换（禁止改动受保护目标词与复现词），同步更新 \`markdownBody\` 中涉及被替换词的精讲内容（若精讲句已采用 \`{{quote:P段落:S句}}\` 引用原文则会自动同步），并将保留词的简明释义写入 \`englishPayload.extraWordGlosses\`（及替换记录 \`englishPayload.synonymReplacements\`），设 \`"generationStage": "complete"\` 写回 \`${workspaceDir}/lessons/${sectionId}.json\`。`
            : `- **禁止改写正文与练习**：请只将下方待补单词的简明释义追加/合并写入 \`englishPayload.extraWordGlosses\`，保持 \`paragraphs\`、\`targetWords\`（仅当存在占位释义时补全）、\`grammarAndUsageNotes\` 和 \`exercises\` 完全不变，设 \`"generationStage": "complete"\` 写回 \`${workspaceDir}/lessons/${sectionId}.json\`。`,
          '',
        ].join('\n')
      : '';

  if (allowSynonymReplacement) {
    const systemInstruction = [
      '你是专注英语分级精读与词汇脚手架搭建的教学专家。',
      '学习者当前英语基础较薄弱，需要在保留本节规划目标生词的前提下，适度降低文章中非目标关联生词带来的阅读阻力。',
      '严格输出合法 JSON（或按指令直接修改本地 JSON 文件），不要自行计算词频或覆盖率。',
    ].join('\n');

    const paragraphBlock = paragraphs
      .map((p, idx) => `[${idx}] ${String(p.english || '').trim()}`)
      .join('\n\n');
    const currentMarkdownBody = String(lesson.markdownBody || '').trim();

    const outputSpec =
      mode === 'agent'
        ? `请直接更新 \`englishPayload.paragraphs\`、\`englishPayload.synonymReplacements\`、\`englishPayload.extraWordGlosses\` 以及 \`markdownBody\`（同步底下的词汇与长难句精讲），本地同步后程序会自动**再次统计关联生词量**并校验受保护新词。`
        : [
            `请输出严格 JSON 对象（不要用冗余长解释；不要自行统计词数/覆盖率，本地程序会在合并后自动再次统计关联生词量）：`,
            '```json',
            '{',
            '  "paragraphUpdates": [',
            '    {',
            '      "index": 0,',
            '      "english": "修改后的整段英文（仅输出需要改写的段落索引）"',
            '    }',
            '  ],',
            '  "synonymReplacements": [',
            '    {',
            '      "paragraphIndex": 0,',
            '      "originalWord": "被替换的关联生词原形",',
            '      "originalWordId": "w-142",',
            '      "replacedWith": "常见简单高频英文表达",',
            '      "reason": "基础薄弱降难替换"',
            '    }',
            '  ],',
            '  "markdownReplacements": [',
            '    {',
            '      "from": "底下精讲(markdownBody)中需同步替换的原词或原句片段（若无改动可省略）",',
            '      "to": "同步修改后的词或句"',
            '    }',
            '  ],',
            '  "extraWordGlosses": [',
            '    {',
            '      "id": "w-166",',
            '      "word": "collide",',
            '      "phonetic": "/kəˈlaɪd/",',
            '      "meaning": "v. 碰撞；冲突"',
            '    }',
            '  ]',
            '}',
            '```',
          ].join('\n');

    const userPrompt = [
      agentHeader,
      ...statsLines,
      '',
      `## 任务要求（基础薄弱：简单同义替换 + 补充简明释义）`,
      `1. **受保护词汇（严禁替换或删除，必须原样保留在文章中）**：${protectedWords.length > 0 ? protectedWords.join(', ') : '（见 targetWords 列表）'}`,
      `2. **关联生词简单同义替换（词库外词难度 ≤ 词库词难度）**：检查下方段落中的非受保护关联生词。对明显偏难、偏学术或过于密集的非目标关联生词，请在确保句意准确、语法时态连贯的前提下，自然替换为**更常见、基础且难度小于等于目标词库词汇的日常高频同义表达**（严禁引入新的生僻词，也不要修改受保护目标词和练习题干）。`,
      `3. **同步底下精讲内容（\`markdownBody\`）**：若下方「当前精讲内容」中出现了被你同义替换掉的词汇或未采用 \`{{quote:P段落:S句}}\` 引用的改写原句，请通过 \`markdownReplacements\`（Agent 模式直接修改 \`markdownBody\`）同步更新，确保精讲中的词句与修改后的原文一致（若精讲句已采用 \`{{quote:P1:S2}}\` 引用原文，界面会自动同步）。`,
      `4. **补充保留词的简明释义**：对改写后**仍然保留在文章中且缺少中文释义**的词库词（含受保护词中缺少释义者），在 \`extraWordGlosses\` 中给出**简明贴合语境的中文释义（15 字以内，带词性）**与标准音标。`,
      '',
      `## 文章英文段落原文`,
      paragraphBlock || '（无英文段落）',
      ...(currentMarkdownBody ? ['', `## 当前底下精讲内容（markdownBody）`, currentMarkdownBody] : []),
      '',
      `## 关联/待补释义词清单`,
      candidateRows.length > 0 ? candidateRows.join('\n') : '（当前无可处理关联词）',
      '',
      outputSpec,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      systemInstruction,
      userPrompt,
      pendingCount: words.length,
      allowSynonymReplacement: true,
      stats: liveStats,
    };
  }

  const systemInstruction = [
    '你是专注英语精读的词典编纂与教学辅助专家。',
    '任务：只为指定英语文章中尚缺释义的单词补充准确、简洁、贴合上下文语境的中文简明释义（15 字以内，标明词性）与国际音标。',
    '严禁改写原文、增删段落或修改练习题。请只输出合法 JSON。',
  ].join('\n');

  const outputSpec =
    mode === 'agent'
      ? `请将结果合并写入 \`${workspaceDir}/lessons/${sectionId}.json\` 的 \`englishPayload.extraWordGlosses\`，保存后本地程序会自动重新统计覆盖与待补词数。`
      : [
          `请输出严格 JSON 对象（勿修改文章正文，勿自行统计词频）：`,
          '```json',
          '{',
          '  "extraWordGlosses": [',
          '    {',
          '      "id": "w-142",',
          '      "word": "profound",',
          '      "phonetic": "/prəˈfaʊnd/",',
          '      "meaning": "adj. 深远的；深刻的"',
          '    }',
          '  ]',
          '}',
          '```',
          mode === 'chat'
            ? '（Chat 模式下如遇长词表输出长度受限，也可改用紧凑行格式逐行输出：`wordId | word | /音标/ | 词性. 简明中文释义`，系统同样支持自动识别导入。）'
            : '',
        ]
          .filter(Boolean)
          .join('\n');

  const userPrompt = [
    agentHeader,
    ...statsLines,
    '',
    `## 任务要求（仅补充简明词义，严禁改写文章正文）`,
    `- 根据每词下方提供的原文语境片段，给出**最贴合本文当前语境**的简明中文释义（建议 1～2 个最核心义项，15 字以内，标注常见词性如 \`n.\` / \`v.\` / \`adj.\` / \`adv.\`）以及音标（\`/.../\`）。`,
    `- 请保持 \`id\` 与 \`word\`（词形原形）与下方清单一致，确保每词都有独立词条，不要遗漏。`,
    '',
    `## 待补充简明释义单词清单（共 ${words.length} 词）`,
    candidateRows.length > 0 ? candidateRows.join('\n') : '（当前无待补充释义的单词）',
    '',
    outputSpec,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    systemInstruction,
    userPrompt,
    pendingCount: words.length,
    allowSynonymReplacement: false,
    stats: liveStats,
  };
}

export function buildAgentSectionStagePrompt(params: {
  course: Course;
  slot: DailyPlanSlot;
  workspaceDir: string;
  stage: 'stage1' | 'stage2';
  teachingSystemPrompt: string;
  allowSynonymReplacement?: boolean;
  pendingWords?: PendingWordGlossItem[];
  diagramSpecs?: Array<{
    id: string;
    title: string;
    stageLabel?: string;
    topologySpec: string;
    caption: string;
    linkedExerciseId?: string;
    contextSnippet?: string;
  }>;
}): string {
  const { course, slot, workspaceDir, stage, teachingSystemPrompt, diagramSpecs = [] } = params;
  const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);
  const stage1Path = `${workspaceDir}/lessons/${sectionId}.stage1.json`;
  const finalPath = `${workspaceDir}/lessons/${sectionId}.json`;
  const validationInstruction = `完成最终课件后，请求本地应用的 \`GET /api/courses/${encodeURIComponent(course.id)}/agent-diagnostics/${encodeURIComponent(sectionId)}\`（应用地址和端口以运行配置为准，默认 http://127.0.0.1:3000）。响应的 report.issues 一次列出检测到的渲染问题及位置，report.hasErrors 指示是否有错误。直接修改文件并重复请求直到没有错误，尽可能处理警告。无需等待用户反馈或再次提问；若请求失败或问题无法修复，明确报告原因及剩余问题，不要声称通过。完成后提示用户同步本地文件。`;

  if (stage === 'stage2') {
    if (course.category === 'english') {
      const baseLesson = slot.lesson || slot.stage1Draft;
      if (baseLesson?.englishPayload) {
        const step2 = buildEnglishStage2WordGlossPrompt({
          course,
          slot,
          lesson: baseLesson,
          pendingWords: params.pendingWords,
          allowSynonymReplacement: params.allowSynonymReplacement,
          mode: 'agent',
          workspaceDir,
        });
        return `${step2.userPrompt}\n\n${validationInstruction}`;
      }
      return [
        `# Agent 模式英文阅读 Step 2 补充词义执行指令（${sectionId}）`,
        `请先完成 Step 1 并写入 \`${finalPath}\`，再读取正文补充 \`englishPayload.extraWordGlosses\`${params.allowSynonymReplacement ? ' 并按需对关联生词进行简单同义替换' : ''}。`,
        '',
        validationInstruction,
      ].join('\n');
    }

    const stage2Core = buildLessonStage2DiagramsPrompt({
      courseName: course.name,
      slot,
      diagramSpecs,
    });
    return [
      `# Agent 模式单节阶段二执行指令（${sectionId}）`,
      `- **读取阶段一产物**：\`${stage1Path}\`（如尚不存在，可对照本地已导入的规格）`,
      `- **禁止改写阶段一正文与练习**：请只依据规格**优先生成 5 类零坐标结构化 \`diagramSpec\`**（\`grid-annot\` | \`plot2d\` | \`graph\` | \`wavedrom\` | \`circuit\`）；**仅当 5 类均不符合教学表达需求时**，才省略 \`diagramSpec\` 并回退生成深色高对比自由图表 \`svgCode\`（两者二选一）。将结果填入对应 \`diagrams\` 及关联练习题的 \`diagramId\`，设 \`"generationStage": "complete"\` 写入 \`${finalPath}\`。`,
      '',
      stage2Core,
      '',
      validationInstruction,
    ].join('\n');
  }

  if (course.category === 'english' && stage === 'stage1') {
    const readingPrompt = buildChatLessonStage1Prompt({
      course,
      slot,
      teachingSystemPrompt,
    });
    return [
      `# Agent 模式单节阅读课件执行指令（${sectionId}）`,
      `- **直接写入最终文件**：\`${finalPath}\`（设 \`"generationStage": "complete"\`，语言阅读课程采用单阶段完整输出，无需分阶段生成图示）。`,
      `- **本地词表参考**（如存在）：\`${workspaceDir}/sources/vocabulary-effective.json\`，且前序小节已学词可直接查阅 \`${workspaceDir}/lessons/\`。`,
      '',
      readingPrompt,
      '',
      validationInstruction,
    ].join('\n');
  }

  const chatStage1 = buildChatLessonStage1Prompt({
    course,
    slot,
    teachingSystemPrompt,
  });
  const boundSegments =
    slot.pdfSegments && slot.pdfSegments.length > 0
      ? slot.pdfSegments
      : slot.pdfSegment
        ? [slot.pdfSegment]
        : [];
  const hasPdfMaterial = course.materials.some(
    (m) => Boolean(m.isPdf || m.fileName.toLowerCase().endsWith('.pdf'))
  );
  const pdfPathsNote =
    boundSegments.length > 0
      ? boundSegments
          .map(
            (seg) =>
              `\`${seg.segmentRelPath || `${workspaceDir}/segments/${seg.sectionId || sectionId}.pdf`}\``
          )
          .join('、')
      : hasPdfMaterial
        ? `${workspaceDir}/sources/ 中原始 PDF`
        : `无 PDF 教材（若需查看完整词表或文本资料可读取 \`${workspaceDir}/sources/\`）`;

  return [
    `# Agent 模式单节阶段一执行指令（${sectionId}）`,
    `- **多模态直读资料**：${pdfPathsNote}`,
    `- **输出文件路径**：请将阶段一结果写入 \`${stage1Path}\`（若本节无需任何配图，可直接设 \`"generationStage": "complete"\` 同时写入 \`${finalPath}\`）。`,
    '',
    chatStage1,
    '',
    `同一轮对话继续完成阶段二：读取阶段一的图示描述规格，优先生成 5 类结构化 diagramSpec（均不符合需求时再回退自由图表 svgCode）并合并写入 \`${finalPath}\`，将 generationStage 设为 complete；无需图示时直接写入最终文件。`,
    validationInstruction,
  ].join('\n');
}

export {
  buildStageRepairPrompt,
  type LessonGenerationStage,
} from '../utils/coursewareDiagnostics';
