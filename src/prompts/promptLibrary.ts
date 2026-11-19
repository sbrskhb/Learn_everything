import fs from 'fs';
import path from 'path';
import type {
  Course,
  CourseCategory,
  DailyPlanSlot,
  EnglishArticleMode,
  LearnerBaselinePreset,
  LearnerLevel,
  LearningDepthPreset,
  PdfDocumentMeta,
  PdfSplitPlanItem,
  PromptModuleToggles,
  SubjectProfile,
  UploadedMaterial,
  VocabItem,
} from '../types';
import { ensureStableSectionId } from '../utils/learningLogic';
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
      chatLesson: extractTaggedBlock(chatMd, 'template: chat-lesson-prompt'),
      chatLessonStage1: extractTaggedBlock(chatMd, 'template: chat-lesson-stage1-prompt'),
      chatSyllabus: extractTaggedBlock(chatMd, 'template: chat-syllabus-prompt'),
    },
  };
}

/**
 * Dynamically compose the courseware system prompt from the skill's modular files
 */
export function composeCoursewareSystemPrompt(params?: {
  subjectProfile?: SubjectProfile;
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

  const adaptationBlocks = buildDualAxisBlocks();

  if (profile === 'english_language') {
    const parts = [
      blocks.profiles.english_language,
      ...adaptationBlocks,
      params?.customSupplement?.trim() || '',
    ].filter(Boolean);
    return parts.join('\n\n');
  }

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
      label: '英语词库与语境阅读模板（默认）',
      description: '支持外刊主题参考与原创文章，包含词汇辨析、长难句拆解与递进练习',
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

export const PROFILE_LABELS: Record<SubjectProfile, string> = {
  electronics_engineering: '电子技术与工科',
  math_physics: '数学与物理',
  computer_science: '计算机科学',
  english_language: '英语学习',
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
    durationDays,
    extraRequirements,
    materials,
    pdfSplitPlan = [],
    effectiveWords = [],
    dailyWordCount,
  } = params;

  const resolvedProfile = subjectProfile || inferSubjectProfile(category, name, extraRequirements);
  const resolvedLearner = resolveLearnerProfile({
    category,
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

  const perSectionWords =
    dailyWordCount || (durationDays > 0 ? Math.ceil(effectiveWords.length / durationDays) : 20);

  return interpolateTemplate(blocks.templates.syllabusUser, {
    name,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel: resolvedLearner.combinedLabel,
    goal,
    extraRequirements: extraRequirements || '按照教材结构完整覆盖定义、原理、推导、例题与练习',
    splitRegionsSection: splitRegionsSummary,
    materialSection: materialSummary ? `- 上传学习资料：\n${materialSummary}` : '',
    vocabSection:
      category === 'english' && effectiveWords.length > 0
        ? `- 词库集合运算待学词汇：共 ${effectiveWords.length} 词（每节目标单词数 ${perSectionWords} 词，同一周期内随机抽取不重复）`
        : '',
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

  const wordListText = targetWords
    .map((w) => `- ${w.word} (${w.phonetic || ''}): ${w.meaning}`)
    .join('\n');

  const bankSummary = course.englishConfig
    ? `${course.englishConfig.targetBankName} − ${course.englishConfig.excludedBankName} = ${course.englishConfig.effectiveWords.length} 词（每节目标 ${course.englishConfig.dailyWordCount || targetWords.length} 词）`
    : `本节 ${targetWords.length} 词`;
  const englishLearnerProfile = resolveLearnerProfile({
    ...course,
    category: 'english',
  });
  const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);

  return interpolateTemplate(blocks.templates.englishLessonUser, {
    courseName: course.name,
    sectionId,
    dayIndex: slot.dayIndex,
    slotTitle: slot.title,
    courseGoal: course.goal,
    bankSummary,
    extraRequirements:
      `【学习者水平与目标深度】${englishLearnerProfile.combinedLabel}（${englishLearnerProfile.strategySummary}）；` +
      (course.extraRequirements ? `${course.extraRequirements}；` : '') +
      '本节英语文章必须以本节分配的目标词汇为主要依据，自然融入阅读内容，严禁生硬堆砌。',
    articleMode,
    articleModeDesc:
      articleMode === 'media_search'
        ? `参考真实外刊媒体（${preferredSources}）主题编写，自然融入本节目标词汇`
        : '由 LLM 直接原创连贯文章，将本节目标词汇自然融入深度阅读语境',
    prevCourseInfo: prevSlot ? prevSlot.title : '第 1 讲',
    nextCourseInfo: nextSlot ? nextSlot.title : '课程总结',
    wordCount: targetWords.length,
    wordListText,
    materialSection: materialContext ? `\n【上传参考资料】\n${materialContext}` : '',
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
  const levelLabel = resolveLearnerProfile(course).combinedLabel;
  const splitRegionsSummary = formatSplitRegionsSummary(course.pdfSplitPlan);
  const englishVocabSummary =
    course.category === 'english' && course.englishConfig
      ? `- **英语词库差集与分节词汇**：${course.englishConfig.targetBankName} − ${course.englishConfig.excludedBankName} = 待学 ${course.englishConfig.effectiveWords.length} 词，每节目标 ${course.englishConfig.dailyWordCount || 20} 词`
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
  const levelLabel = resolveLearnerProfile(course).combinedLabel;

  const materialFilesList =
    materialFilePaths.length > 0
      ? materialFilePaths.map((p) => `  - \`${p}\``).join('\n')
      : '  - （未上传外部资料文件，请依据课程目标与标准教材体系编写）';

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
      return `- **小节 \`${sectionId}\`（第 ${slot.dayIndex} 节）** -> 输出文件：\`${workspaceDir}/lessons/${sectionId}.json\` | 状态：${status}\n  - 标题：${slot.title}\n  - 目标：${slot.objective}\n  - 教学范围与知识点：${slot.teachingScope || slot.keyTopics.join('、')}${wordsNote}${promptDirNote}${segNote}`;
    })
    .join('\n');

  const englishVocabSummary =
    course.category === 'english' && course.englishConfig
      ? `- **英语词库差集与按小节随机分配**：${course.englishConfig.targetBankName} (${course.englishConfig.totalTargetCount}) − ${course.englishConfig.excludedBankName} (${course.englishConfig.excludedCount}) = 待学 ${course.englishConfig.effectiveWords.length} 词，每节目标 ${course.englishConfig.dailyWordCount || 20} 词（已由本地程序完成随机不重复抽取并保存在 \`outline.json\` 的 \`assignedWords\` 中，请严格以各小节目标词汇为依据撰写自然阅读文章）`
      : '';

  const englishPayloadSchemaNote =
    course.category === 'english'
      ? `\n注意：本课程为英语课程，请在每个小节课件 JSON 中额外包含 \`englishPayload\` 字段（结构含 \`articleTitle\`, \`sourceReference\`, \`articleMode\`, \`targetWords\`, \`paragraphs\`, \`grammarAndUsageNotes\`）。`
      : '';

  return interpolateTemplate(blocks.templates.agentBatch, {
    courseId: course.id,
    courseIdEncoded: encodeURIComponent(course.id),
    courseName: course.name,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel,
    courseGoal: course.goal,
    extraRequirements: course.extraRequirements || '按教材标准深度编写，推导连续，语言朴实准确',
    englishVocabSummary,
    workspaceDir,
    materialFilesList,
    dailyScheduleTable,
    teachingSystemPrompt,
    englishPayloadSchemaNote,
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

  const englishWordsSection =
    course.category === 'english' && slot.assignedWords && slot.assignedWords.length > 0
      ? `- **本节分配目标词汇（共 ${slot.assignedWords.length} 词，请以这些词汇为主要依据自然融入阅读文章，避免生硬堆砌）**：\n${slot.assignedWords
          .map((w) => `  - ${w.word} (${w.phonetic || ''}): ${w.meaning}`)
          .join('\n')}`
      : '';

  const englishPayloadField =
    course.category === 'english'
      ? `,\n  "englishPayload": {\n    "articleTitle": "英文文章标题",\n    "sourceReference": "主题参考来源",\n    "articleMode": "${course.englishConfig?.articleMode || 'llm_original'}",\n    "targetWords": [{"word": "单词", "phonetic": "/音标/", "meaning": "释义", "example": "例句", "exampleTranslation": "例句翻译"}],\n    "paragraphs": [{"english": "英文段落", "chinese": "中文译文"}],\n    "grammarAndUsageNotes": "长难句拆解与近义词辨析"\n  }`
      : '';

  return {
    courseName: course.name,
    sectionId,
    dayIndex: slot.dayIndex,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel,
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

/**
 * Step 3: Build Chat Mode Stage 1 Prompt (Teaching content + diagram specs only, no SVG).
 */
export function buildChatLessonStage1Prompt(params: {
  course: Course;
  slot: DailyPlanSlot;
  teachingSystemPrompt: string;
}): string {
  const blocks = loadSkillPromptBlocks();
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
  const levelLabel = resolveLearnerProfile(course).combinedLabel;
  const splitRegionsSummary = formatSplitRegionsSummary(course.pdfSplitPlan);

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
    splitRegionsSection: splitRegionsSummary,
    materialSection: materialContext ? `- **学习资料（多模态 PDF 原文件直读）**：\n${materialContext}` : '',
  });
}

/**
 * Step 3 (Agent Mode): Targeted single-section prompt for Stage 1 or Stage 2 execution/retry in local workspace.
 */
export function buildAgentSectionStagePrompt(params: {
  course: Course;
  slot: DailyPlanSlot;
  workspaceDir: string;
  stage: 'stage1' | 'stage2';
  teachingSystemPrompt: string;
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
  const pdfPathsNote =
    boundSegments.length > 0
      ? boundSegments
          .map(
            (seg) =>
              `\`${seg.segmentRelPath || `${workspaceDir}/segments/${seg.sectionId || sectionId}.pdf`}\``
          )
          .join('、')
      : `${workspaceDir}/sources/ 中原始 PDF`;

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
