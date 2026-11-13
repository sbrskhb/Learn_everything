import fs from 'fs';
import path from 'path';
import type {
  Course,
  CourseCategory,
  DailyPlanSlot,
  EnglishArticleMode,
  LearnerLevel,
  PdfDocumentMeta,
  PdfSplitPlanItem,
  PromptModuleToggles,
  SubjectProfile,
  UploadedMaterial,
  VocabItem,
} from '../types';
import { ensureStableSectionId } from '../utils/learningLogic';
import { isGarbledPdfText } from '../utils/pdfProcessor';

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
    .search(/\n#{2,3}\s+[^\n]*`(?:id|template|profile|level):/);
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
      englishLessonUser: extractTaggedBlock(runtimeMd, 'template: english-lesson-user-prompt'),
      agentSyllabus: extractTaggedBlock(agentMd, 'template: agent-syllabus-prompt'),
      agentBatch: extractTaggedBlock(agentMd, 'template: agent-batch-prompt'),
      chatLesson: extractTaggedBlock(chatMd, 'template: chat-lesson-prompt'),
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
  modules?: Partial<PromptModuleToggles>;
  customSupplement?: string;
}): string {
  const blocks = loadSkillPromptBlocks();
  const profile = params?.subjectProfile || 'electronics_engineering';
  const level = params?.learnerLevel || 'intermediate';
  const toggles: PromptModuleToggles = {
    ...DEFAULT_PROMPT_MODULE_TOGGLES,
    ...(params?.modules || {}),
  };

  if (profile === 'english_language') {
    const parts = [
      blocks.profiles.english_language,
      blocks.levels[level],
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
    blocks.levels[level] || blocks.levels.intermediate,
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
      label: '资料目录解析与依赖划分模板（默认）',
      description: '解析学习资料建立知识点目录与依赖关系，按难度合理划分每日课程',
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
      id: 'course-general',
      targetField: 'course',
      subjectProfile: 'general_academic',
      learnerLevel: 'intermediate',
      label: '通用专业课程模板',
      description: '完整覆盖原始资料结构、概念联系与易混淆内容辨析',
      prompt: composeCoursewareSystemPrompt({
        subjectProfile: 'general_academic',
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
  beginner: '初学者 / 零基础',
  intermediate: '具备基础 / 教材同步',
  advanced: '进阶深入',
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
  return `- **第 1 步已划分/切割的教材 PDF 区域（共 ${pdfSplitPlan.length} 个区域，请结合随附 PDF 原文件在规划每天课程时绑定对应的 regionId）**：\n${lines.join('\n')}`;
}

export function buildSyllabusUserPrompt(params: {
  name: string;
  category: CourseCategory;
  subjectProfile?: SubjectProfile;
  learnerLevel?: LearnerLevel;
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
    goal,
    durationDays,
    extraRequirements,
    materials,
    pdfSplitPlan = [],
    effectiveWords = [],
    dailyWordCount,
  } = params;

  const resolvedProfile = subjectProfile || inferSubjectProfile(category, name, extraRequirements);
  const splitRegionsSummary = formatSplitRegionsSummary(pdfSplitPlan);
  const materialSummary = materials
    .map((m) => {
      const isPdf = Boolean(m.isPdf || m.fileName.toLowerCase().endsWith('.pdf'));
      if (isPdf) {
        const validBookmarks = (m.tocEntries || []).filter(
          (t) =>
            t.title &&
            !isGarbledPdfText(t.title) &&
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
        return `【PDF 教材: ${m.fileName}${m.totalPages ? ` (共 ${m.totalPages} 物理页)` : ''}】\n- 多模态直读：本资料为 PDF 原文件，请直接依据随附的 PDF（或第 1 步切分出的区域 PDF）内容规划目录，不使用任何 OCR 提取文本。${tocNote}`;
      }
      return `【文本资料: ${m.fileName}】\n${(m.extractedText || '').slice(0, 6500)}`;
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 20000);

  const perDayWords =
    dailyWordCount || (durationDays > 0 ? Math.ceil(effectiveWords.length / durationDays) : 20);

  return interpolateTemplate(blocks.templates.syllabusUser, {
    name,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel: LEVEL_LABELS[learnerLevel],
    goal,
    durationDays,
    extraRequirements: extraRequirements || '按照教材结构完整覆盖定义、原理、推导、例题与练习',
    splitRegionsSection: splitRegionsSummary,
    materialSection: materialSummary ? `- 上传学习资料：\n${materialSummary}` : '',
    vocabSection:
      category === 'english' && effectiveWords.length > 0
        ? `- 词库集合运算待学词汇：共 ${effectiveWords.length} 词（每日目标单词数 ${perDayWords} 词，同一周期内随机抽取不重复）`
        : '',
  });
}

export function buildCourseLessonUserPrompt(params: {
  course: Course;
  slot: DailyPlanSlot;
  prevSlot?: DailyPlanSlot;
  nextSlot?: DailyPlanSlot;
  materialContext: string;
}): string {
  const blocks = loadSkillPromptBlocks();
  const { course, slot, prevSlot, nextSlot, materialContext } = params;
  const resolvedProfile =
    course.subjectProfile ||
    inferSubjectProfile(course.category, course.name, course.extraRequirements);
  const levelLabel = LEVEL_LABELS[course.learnerLevel || 'intermediate'];
  const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);

  const catalogText =
    course.knowledgeCatalog && course.knowledgeCatalog.length > 0
      ? `\n【课程知识点目录与依赖关系】\n${course.knowledgeCatalog
          .map(
            (n) =>
              `- ${n.title}（先修：${n.prerequisites.join('、') || '无'} | 第 ${n.assignedDayIndex || '?'} 天）`
          )
          .join('\n')}`
      : '';

  const pdfSegmentNote = slot.pdfSegment
    ? `\n【本节关联切分 PDF 资料】\n- 小节唯一 ID：${sectionId}（绑定区域：${slot.regionId || slot.pdfSegment.sectionId}）\n- 原始 PDF：${slot.pdfSegment.sourceFileName}（物理第 ${slot.pdfSegment.physicalStartPage}~${slot.pdfSegment.physicalEndPage} 页${
        slot.pdfSegment.printedStartPage
          ? `，教材印刷第 ${slot.pdfSegment.printedStartPage}~${slot.pdfSegment.printedEndPage} 页`
          : ''
      }）\n- 切分小节文件：${slot.pdfSegment.segmentRelPath || `segments/${slot.pdfSegment.segmentFileName || `${sectionId}.pdf`}`}`
    : `\n【本节唯一标识】${sectionId}`;

  return interpolateTemplate(blocks.templates.courseLessonUser, {
    courseName: course.name,
    dayIndex: slot.dayIndex,
    durationDays: course.durationDays,
    date: slot.date,
    slotTitle: `${slot.title} [${sectionId}]`,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel,
    courseGoal: course.goal,
    slotObjective: slot.objective,
    prerequisites:
      slot.prerequisites?.join('、') ||
      (prevSlot ? `第 ${prevSlot.dayIndex} 天《${prevSlot.title}》` : '基础先修常识'),
    teachingScope: slot.teachingScope || slot.keyTopics.join('、'),
    keyTopics: slot.keyTopics.join('、'),
    prevCourseInfo: prevSlot ? `第 ${prevSlot.dayIndex} 天《${prevSlot.title}》` : '本节为第 1 讲',
    nextCourseInfo: nextSlot ? `第 ${nextSlot.dayIndex} 天《${nextSlot.title}》` : '本节为最后一讲',
    connectionNote: slot.connectionNote || '承接前序概念并为后续内容打基础',
    extraRequirements: course.extraRequirements || '推导连续，解释物理意义，语言朴实准确',
    catalogSection: `${catalogText}${pdfSegmentNote}`,
    materialSection: materialContext ? `\n【本节对应参考资料原文】\n${materialContext}` : '',
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
    ? `${course.englishConfig.targetBankName} − ${course.englishConfig.excludedBankName} = ${course.englishConfig.effectiveWords.length} 词（每日目标 ${course.englishConfig.dailyWordCount || targetWords.length} 词）`
    : `本节 ${targetWords.length} 词`;

  return interpolateTemplate(blocks.templates.englishLessonUser, {
    courseName: course.name,
    dayIndex: slot.dayIndex,
    durationDays: course.durationDays,
    date: slot.date,
    slotTitle: slot.title,
    courseGoal: course.goal,
    bankSummary,
    extraRequirements:
      (course.extraRequirements ? `${course.extraRequirements}；` : '') +
      '每日英语文章必须以当天分配的目标词汇为主要依据，自然融入阅读内容，严禁生硬堆砌。',
    articleMode,
    articleModeDesc:
      articleMode === 'media_search'
        ? `参考真实外刊媒体（${preferredSources}）主题编写，自然融入今日目标词汇`
        : '由 LLM 直接原创连贯文章，将今日目标词汇自然融入深度阅读语境',
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
 * NEVER injects OCR-extracted PDF text into any prompt.
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
  // Only apply manual offset explicitly set by the user (default 0; never auto-guessed via OCR)
  const pageOffset = course.pdfPageOffset ?? 0;
  const resolvedProfile =
    course.subjectProfile ||
    inferSubjectProfile(course.category, course.name, course.extraRequirements);
  const levelLabel = LEVEL_LABELS[course.learnerLevel || 'intermediate'];

  const cleanBookmarks = (primaryPdf?.tocEntries || []).filter(
    (t) =>
      t.title &&
      !isGarbledPdfText(t.title) &&
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
      : '  - （该 PDF 未包含内嵌电子书签；不提供也不依赖 OCR 文本，请直接以随附的 PDF 原文件本身读取各章节并确定物理页码范围）';

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

  const systemPrompt = `你是一位严谨的多模态教材结构分析与 PDF 划分区域规划专家。
你的任务（统一流程第 1 步）是根据用户提交的课程要求（学习目标、计划天数、基础水平、额外要求）以及随附提交的教材 PDF 原文件本身，规划出最合理的若干学习区域（\`region-01\`, \`region-02\`, ...）及其准确的 PDF 物理页码范围，供本地脚本执行无损切割；之后系统才会在第 2 步基于这些切分出的区域 PDF 生成完整课程大纲。
注意：
1. 默认你具备多模态 PDF 原文件阅读能力，请直接阅读随附 PDF 原文件本身（含目录页、章节标题、公式与图表），本系统不提供、也不应依赖任何 OCR 提取文本。
2. 你只负责分析和输出结构化 JSON 区域划分方案（split-plan.json），实际 PDF 文件切割由本地脚本（scripts/split_pdf.ts）无损执行，请勿重新排版或生成 PDF 文件。
3. ${offsetInstruction}
4. 每个划分区域应覆盖完整、连贯的知识单元或章节（避免将完整推导截断在两区之间），若某区域需要前置章节的公式表或基础定义，请填入 \`crossRefPages\` 数组（填入 1 ~ ${totalPages} 内的物理页码）。`;

  const exampleEnd = Math.min(totalPages, 12);
  const jsonSchemaBlock = `{
  "sourceFileName": "${fileName}",
  "totalPages": ${totalPages},
  "pageOffset": ${pageOffset},
  "regions": [
    {
      "regionId": "region-01",
      "dayIndex": 1,
      "sectionTitle": "划分区域 1：聚焦核心章节主题（例如 第1节 基本概念与核心电路）",
      "sourceFileName": "${fileName}",
      "physicalStartPage": 1,
      "physicalEndPage": ${exampleEnd},
      "crossRefPages": [],
      "outlineMappingNote": "该区域涵盖的教材章节、核心概念及与学习目标的对应关系"
    }
  ]
}`;

  const apiUserPrompt = `请为课程《${course.name}》（第 1 步：先确定教材 PDF 划分区域）制定结构化切分方案：
- **学科与水平**：${PROFILE_LABELS[resolvedProfile]}（${levelLabel}）
- **学习目标**：${course.goal}
- **预计学习天数**：${course.durationDays} 天
- **个性化要求**：${course.extraRequirements || '按教材章节体系完整学习'}
- **原始 PDF 原文件**：\`${fileName}\`（共 ${totalPages} 物理页；已直接作为多模态 PDF 随本次请求附上，请直接阅读 PDF 原文件本身，不附带 OCR 文本）${
    pageOffset !== 0 ? `；用户手动偏移量 pageOffset = ${pageOffset}` : ''
  }${existingOutlineHint}

- **PDF 内嵌电子书签目录**：
${tocSummary}

请结合学习目标和预计天数，将教材合理划分为若干连续的知识区域（通常 ${Math.min(course.durationDays, 12)}~${course.durationDays} 个区域，或按主要章节划分），所有 \`physicalStartPage\` 与 \`physicalEndPage\` 必须严格落在 1 ~ ${totalPages} 之间。请严格输出以下 JSON 代码块（包含 \`regions\` 数组）：
\`\`\`json
${jsonSchemaBlock}
\`\`\``;

  const agentSplitPrompt = `# Agent 任务（第 1 步）：直接多模态阅读《${course.name}》PDF 原文件并确定划分区域，调用脚本执行切割

## 一、课程要求与文件路径
- **课程名称**：${course.name}（${PROFILE_LABELS[resolvedProfile]} / ${levelLabel}）
- **学习目标**：${course.goal}
- **预计学习天数**：${course.durationDays} 天
- **个性化要求**：${course.extraRequirements || '按教材体系深入自学'}
- **课程根目录**：\`${courseRelDir}\`
- **原始教材 PDF 原文件路径**：\`${courseRelDir}/sources/${fileName}\`（共 ${totalPages} 物理页；请直接以多模态方式读取该 PDF 文件，严禁依赖 OCR 文本）
- **区域划分方案输出路径**：\`${courseRelDir}/segments/split-plan.json\`
- **本地无损切割脚本**：\`npx tsx scripts/split_pdf.ts "${courseRelDir}"\`

## 二、PDF 内嵌电子书签（若有）
${tocSummary}

## 三、执行步骤要求
1. **直接多模态读取原始 PDF 文件 \`${courseRelDir}/sources/${fileName}\`** 的目录页与各章节实际页面，确定准确的物理页码（共 1 ~ ${totalPages} 页；${
    pageOffset !== 0
      ? `用户已设手动偏移量 pageOffset = ${pageOffset}，即 physicalPage = printedPage + ${pageOffset}`
      : '直接按 PDF 实际物理页码规划，不使用 OCR 猜算偏移量'
  }）。
2. 结合学习目标和天数，划分出清晰的知识区域（\`region-01\`, \`region-02\`, ...），规划准确的 \`physicalStartPage\`、\`physicalEndPage\`（均须在 1 ~ ${totalPages} 范围内）、前置交叉参考页 \`crossRefPages\` 与 \`outlineMappingNote\`，写入 \`${courseRelDir}/segments/split-plan.json\`。
3. 调用本地无损切割脚本，从原 PDF 无损切出各区域 PDF 文件，供第 2 步生成课程大纲：
   \`\`\`bash
   npx tsx scripts/split_pdf.ts "${courseRelDir}"
   \`\`\`
   脚本将在 \`${courseRelDir}/segments/\` 下生成 \`region-01.pdf\`、\`region-02.pdf\` 等无损区域 PDF，完整保留原始页面文字、公式和图表。

## 四、\`split-plan.json\` 输出格式规范
\`\`\`json
${jsonSchemaBlock}
\`\`\``;

  const chatSplitPrompt = `我正在创建课程《${course.name}》（目标：${course.goal}，计划学习 ${course.durationDays} 天，水平：${levelLabel}，要求：${course.extraRequirements || '按教材深入理解'}）。
现在是流程的 **第 1 步（先确定 PDF 划分区域，再切割，再生成大纲）**：请**直接多模态阅读我上传提交的教材 PDF 原文件（\`${fileName}\`，共 ${totalPages} 物理页）本身**，根据我的学习目标和教材章节结构，划分出若干学习区域并给出准确的 **PDF 物理页码范围（1 ~ ${totalPages}）**，返回给我后由本地脚本完成无损切割。

### 1. PDF 内嵌书签与页码准则
- **直接读 PDF 原文件**：默认对话模型具备多模态 PDF 阅读能力，请直接查阅随附 PDF 原文件中的目录与正文页面，不提供也不依赖任何 OCR 提取文本。
- **物理页码准则**：${
    pageOffset !== 0 ? `用户当前手动偏移量为 ${pageOffset}，但最终` : ''
  }请直接按 PDF 原文件的物理页码（第 1 ~ ${totalPages} 页）规划每个区域的 \`physicalStartPage\` 和 \`physicalEndPage\`。
${tocSummary}

### 2. 输出要求
请只输出一个 \`\`\`json ... \`\`\` 代码块，列出全部划分区域的准确物理页码范围（\`region-01\`, \`region-02\`, ...）：
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
  const levelLabel = LEVEL_LABELS[course.learnerLevel || 'intermediate'];
  const splitRegionsSummary = formatSplitRegionsSummary(course.pdfSplitPlan);
  const englishVocabSummary =
    course.category === 'english' && course.englishConfig
      ? `- **英语词库差集与每日词汇**：${course.englishConfig.targetBankName} − ${course.englishConfig.excludedBankName} = 待学 ${course.englishConfig.effectiveWords.length} 词，每日目标 ${course.englishConfig.dailyWordCount || 20} 词`
      : '';

  return interpolateTemplate(blocks.templates.agentSyllabus, {
    courseId: course.id,
    courseName: course.name,
    workspaceDir,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel,
    courseGoal: course.goal,
    durationDays: course.durationDays,
    startDate: course.startDate,
    extraRequirements: course.extraRequirements || '按知识依赖与认知负荷合理安排每日课时',
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
  const levelLabel = LEVEL_LABELS[course.learnerLevel || 'intermediate'];

  const materialFilesList =
    materialFilePaths.length > 0
      ? materialFilePaths.map((p) => `  - \`${p}\``).join('\n')
      : '  - （未上传外部资料文件，请依据课程目标与标准教材体系编写）';

  const dailyScheduleTable = course.dailyPlan
    .map((slot) => {
      const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);
      const status = slot.lesson ? '✅ 已生成（默认跳过，避免覆盖）' : '⏳ 待生成';
      const wordsNote =
        slot.assignedWords && slot.assignedWords.length > 0
          ? ` | 目标词汇(${slot.assignedWords.length}词)：${slot.assignedWords.map((w) => w.word).join(', ')}`
          : '';
      const segFileBase = slot.pdfSegment?.sectionId || slot.regionId || sectionId;
      const segNote = slot.pdfSegment
        ? `\n  - 关联切分 PDF（请直接多模态读取该 PDF 原文件）：\`${slot.pdfSegment.segmentRelPath || `${workspaceDir}/segments/${segFileBase}.pdf`}\`（原始 PDF 物理第 ${slot.pdfSegment.physicalStartPage}~${slot.pdfSegment.physicalEndPage} 页）`
        : '';
      return `- **小节 \`${sectionId}\` | 第 ${slot.dayIndex} 天（${slot.date}）** -> 输出文件：\`${workspaceDir}/lessons/${sectionId}.json\` | 状态：${status}\n  - 标题：${slot.title}\n  - 目标：${slot.objective}\n  - 教学范围与知识点：${slot.teachingScope || slot.keyTopics.join('、')}${wordsNote}${segNote}`;
    })
    .join('\n');

  const englishVocabSummary =
    course.category === 'english' && course.englishConfig
      ? `- **英语词库差集与每日随机分配**：${course.englishConfig.targetBankName} (${course.englishConfig.totalTargetCount}) − ${course.englishConfig.excludedBankName} (${course.englishConfig.excludedCount}) = 待学 ${course.englishConfig.effectiveWords.length} 词，每日目标 ${course.englishConfig.dailyWordCount || 20} 词（已由本地程序完成随机不重复抽取并保存在 \`outline.json\` 的 \`assignedWords\` 中，请严格以当天目标词汇为依据撰写自然阅读文章）`
      : '';

  const englishPayloadSchemaNote =
    course.category === 'english'
      ? `\n注意：本课程为英语课程，请在每个小节课件 JSON 中额外包含 \`englishPayload\` 字段（结构含 \`articleTitle\`, \`sourceReference\`, \`articleMode\`, \`targetWords\`, \`paragraphs\`, \`grammarAndUsageNotes\`）。`
      : '';

  return interpolateTemplate(blocks.templates.agentBatch, {
    courseId: course.id,
    courseName: course.name,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel,
    courseGoal: course.goal,
    durationDays: course.durationDays,
    startDate: course.startDate,
    extraRequirements: course.extraRequirements || '按教材标准深度编写，推导连续，语言朴实准确',
    englishVocabSummary,
    workspaceDir,
    materialFilesList,
    dailyScheduleTable,
    teachingSystemPrompt,
    englishPayloadSchemaNote,
  });
}

/**
 * Step 3: Dynamically build the single-lesson Chat Mode Prompt from the skill template.
 * Never injects OCR text for PDFs; instructs multimodal Chat AI to read the attached PDF file directly.
 */
export function buildChatLessonPrompt(params: {
  course: Course;
  slot: DailyPlanSlot;
  teachingSystemPrompt: string;
}): string {
  const blocks = loadSkillPromptBlocks();
  const { course, slot, teachingSystemPrompt } = params;
  const resolvedProfile =
    course.subjectProfile ||
    inferSubjectProfile(course.category, course.name, course.extraRequirements);
  const levelLabel = LEVEL_LABELS[course.learnerLevel || 'intermediate'];
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
  const pdfSegmentBanner = slot.pdfSegment
    ? `- **本节关联切分 PDF 原文件**：\`${slot.pdfSegment.segmentFileName || `${slot.pdfSegment.sectionId || sectionId}.pdf`}\`（对应原书《${slot.pdfSegment.sourceFileName}》物理第 ${slot.pdfSegment.physicalStartPage}~${slot.pdfSegment.physicalEndPage} 页${
        slot.pdfSegment.crossRefPages && slot.pdfSegment.crossRefPages.length > 0
          ? `，含跨章前置页：第 ${slot.pdfSegment.crossRefPages.join(', ')} 页`
          : ''
      }）。\n  - **多模态直读说明**：请直接将此切分 PDF 文件随本提示词一并上传给外部多模态 AI（无需上传整本教材，也不附带 OCR 文本）。\n`
    : pdfMaterials.length > 0
      ? `- **本节关联教材 PDF 原文件**：${pdfMaterials.map((m) => `\`${m.fileName}\`${m.totalPages ? ` (${m.totalPages}页)` : ''}`).join('、')}。\n  - **多模态直读说明**：请直接将教材 PDF 原文件随本提示词一并上传给外部多模态 AI 阅读（不使用 OCR 文本）。\n`
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

  return interpolateTemplate(blocks.templates.chatLesson, {
    courseName: course.name,
    dayIndex: slot.dayIndex,
    durationDays: course.durationDays,
    date: slot.date,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel,
    courseGoal: course.goal,
    slotTitle: `${slot.title} (${sectionId})`,
    slotObjective: slot.objective,
    prerequisites:
      slot.prerequisites?.join('、') ||
      (prevSlot ? `第 ${prevSlot.dayIndex} 天《${prevSlot.title}》` : '基础先修常识'),
    teachingScope: slot.teachingScope || slot.keyTopics.join('、'),
    keyTopics: slot.keyTopics.join('、'),
    prevCourseInfo: prevSlot ? `第 ${prevSlot.dayIndex} 天《${prevSlot.title}》` : '本节为第 1 讲',
    nextCourseInfo: nextSlot ? `第 ${nextSlot.dayIndex} 天《${nextSlot.title}》` : '本节为最后一讲',
    connectionNote: slot.connectionNote || '承接前序概念并为后续内容打基础',
    extraRequirements: course.extraRequirements || '推导连续，解释物理意义，语言朴实准确',
    englishWordsSection: `${pdfSegmentBanner}${englishWordsSection}`,
    materialSection: nonPdfMaterialContext ? `\n- **补充文本资料**：\n${nonPdfMaterialContext}` : '',
    teachingSystemPrompt,
    englishPayloadField,
  });
}

/**
 * Step 2: Dynamically build the Chat Mode Syllabus Prompt from the skill template (consuming Step 1 split regions).
 * Never injects OCR text for PDFs; instructs multimodal Chat AI to read the attached PDF files directly.
 */
export function buildChatSyllabusPrompt(params: {
  course: Course;
}): string {
  const blocks = loadSkillPromptBlocks();
  const { course } = params;
  const resolvedProfile =
    course.subjectProfile ||
    inferSubjectProfile(course.category, course.name, course.extraRequirements);
  const levelLabel = LEVEL_LABELS[course.learnerLevel || 'intermediate'];
  const splitRegionsSummary = formatSplitRegionsSummary(course.pdfSplitPlan);

  const materialContext = course.materials
    .map((m) => {
      const isPdf = Boolean(m.isPdf || m.fileName.toLowerCase().endsWith('.pdf'));
      if (isPdf) {
        return `【PDF 教材原文件: ${m.fileName}${m.totalPages ? ` (共 ${m.totalPages} 页)` : ''}】请直接上传此 PDF 或第 1 步切分出的区域 PDF（region-XX.pdf）给外部多模态 AI 阅读，不使用 OCR 提取文本。`;
      }
      return `【文本资料: ${m.fileName}】\n${(m.extractedText || '').slice(0, 6000)}`;
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 15000);

  return interpolateTemplate(blocks.templates.chatSyllabus, {
    courseName: course.name,
    durationDays: course.durationDays,
    startDate: course.startDate,
    profileLabel: PROFILE_LABELS[resolvedProfile],
    levelLabel,
    courseGoal: course.goal,
    extraRequirements: course.extraRequirements || '按知识依赖关系和难度合理划分每日课程',
    splitRegionsSection: splitRegionsSummary,
    materialSection: materialContext ? `- **学习资料（多模态 PDF 原文件直读）**：\n${materialContext}` : '',
  });
}
