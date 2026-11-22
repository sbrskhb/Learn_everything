import type {
  CourseCategory,
  LearnerBaselinePreset,
  LearnerLevel,
  LearningDepthPreset,
  TargetLanguageCode,
} from '../types';

export interface BaselineOptionItem {
  value: Exclude<LearnerBaselinePreset, 'custom'>;
  title: string;
  tag: string;
  audience: string;
  behavior: string;
}

export interface DepthOptionItem {
  value: Exclude<LearningDepthPreset, 'custom'>;
  title: string;
  tag: string;
  target: string;
  behavior: string;
}

export const BASELINE_PRESET_OPTIONS: BaselineOptionItem[] = [
  {
    value: 'zero_base',
    title: '零基础 / 无先修',
    tag: '从直觉与工具铺垫讲起',
    audience: '未修先修课，或对微积分、相量、矩阵及前置定律仍生疏。',
    behavior: '首次出现的术语与数学工具先给直观类比与最简特例，绝不假设前提常识。',
  },
  {
    value: 'partial_base',
    title: '具备部分基础',
    tag: '快速唤醒关键先修结论',
    audience: '学过中学数理或部分先修课，对个别定理与等效模型略生疏。',
    behavior: '跳过纯常识啰嗦，开篇精炼点出 1~2 个关键前置结论后平稳切入推导。',
  },
  {
    value: 'solid_base',
    title: '基础扎实',
    tag: '直奔核心矛盾与推导',
    audience: '已系统掌握先修数学与基础学科工具，希望节奏紧凑高效。',
    behavior: '省去低阶铺垫与入门回顾，直接采用严格符号与先修定理切入主体。',
  },
];

export const ENGLISH_BASELINE_PRESET_OPTIONS: BaselineOptionItem[] = [
  {
    value: 'zero_base',
    title: '零基础 / 基础薄弱',
    tag: '从文字、基础句型与核心词义讲起',
    audience: '尚未系统学习该语言，或处于基础起步阶段，面对长难句与语法变形容易卡壳。',
    behavior: '首次出现的文字/术语、词尾变形与基础句法均从直观例句与结构骨架讲起，绝不跳过桥梁。',
  },
  {
    value: 'partial_base',
    title: '具备常规基础 / 阅读进阶',
    tag: '唤醒高频搭配、语法接续与句干',
    audience: '具备常规读写与入门语法基础（如四六级或中级基础），遇到复杂长难句、熟词僻义或习惯表达仍需梳理。',
    behavior: '跳过纯字母或入门语法啰嗦，重点点拨高频搭配、熟词僻义、关键语法接续与长难句主干。',
  },
  {
    value: 'solid_base',
    title: '高阶基础 / 语感扎实',
    tag: '直入原版修辞与深层语域',
    audience: '已掌握较丰富的词汇与语法体系，希望直接进入原版文献、深度对话或考级冲刺训练。',
    behavior: '省去基础语法扫盲，直接聚焦近义表达语体差异、习惯用法、作者态度与篇章论证。',
  },
];

export const DEPTH_PRESET_OPTIONS: DepthOptionItem[] = [
  {
    value: 'understand_basics',
    title: '建立直觉与初步理解',
    tag: '重物理图像与主干结论',
    target: '重在看懂核心机理、主要公式因果关系与基础例题，不被偏门推导劝退。',
    behavior: '保留清晰主干推导与必要成立条件，练习偏概念辨析与基础直接应用。',
  },
  {
    value: 'master_textbook',
    title: '学透核心原理与题型',
    tag: '标准高水平教材深度',
    target: '严格达到本科核心教材要求，吃透完整无跳步推导与典型综合题。',
    behavior: '核心推导绝不缩水，哪怕起点为零基础也会先补桥梁再推至完整教材深度。',
  },
  {
    value: 'deep_rigorous',
    title: '深度钻研与高阶拓展',
    tag: '非理想边界与工程迁移',
    target: '深入非理想误差、失效边界、寄生/极限分析及复杂跨章变式设计。',
    behavior: '必须推导出误差阶次与边界条件，练习覆盖诊断、反例与高阶综合迁移。',
  },
];

export const ENGLISH_DEPTH_PRESET_OPTIONS: DepthOptionItem[] = [
  {
    value: 'understand_basics',
    title: '读懂大意与日常实用运用',
    tag: '重语境复现与核心交际表达',
    target: '重在记住目标词汇的核心含义与常用搭配，能顺畅读懂常见短文或开展日常对话运用。',
    behavior: '句式自然清晰，练习聚焦语境填空、词义匹配、常用表达与主旨理解。',
  },
  {
    value: 'master_textbook',
    title: '吃透精读教材与标准应试',
    tag: '教材 / 四六级 / 考研 / 托福 / JLPT 标准',
    target: '对标系统教材或主流语言考试标准，掌握一词多义、近义辨析、核心语法体系与长句拆解。',
    behavior: '哪怕起点薄弱也先搭好语法词汇桥梁，再完整训练长难句剖析、同义替换与综合阅读/运用。',
  },
  {
    value: 'deep_rigorous',
    title: '原版深度鉴赏与高阶迁移',
    tag: '原刊 / 学术文献与地道表达迁移',
    target: '深入原版评论与学术期刊级复杂句法、修辞隐喻、语域辨析，并能完成地道迁移输出。',
    behavior: '全面剖析细微语义张力、文化语境与表达风格，练习覆盖深层推断与高阶仿写。',
  },
];

export const NON_ENGLISH_LANG_BASELINE_PRESET_OPTIONS: BaselineOptionItem[] = [
  {
    value: 'zero_base',
    title: '零基础 / 入门起跑',
    tag: '从文字、发音与基础句型讲起',
    audience: '尚未系统学过该语言，需要从基础文字（如假名/字母）、基础词序与入门语法铺垫。',
    behavior: '首次出现的文字、词尾变形与语法助词给足直观对照与最简例句，绝不跳过入门桥梁。',
  },
  {
    value: 'partial_base',
    title: '具备基础 / 日常进阶',
    tag: '快速唤醒核心词形与常见句型',
    audience: '掌握基础读写与入门语法，但面对长难复句、敬体/简体内涵或复合接续仍需梳理。',
    behavior: '跳过纯字母/假名扫盲，聚焦高频语法接续、词形活用与地道语境搭配。',
  },
  {
    value: 'solid_base',
    title: '中高阶基础 / 语感扎实',
    tag: '直奔原汁文献与高阶辨析',
    audience: '具备较扎实的读写与语法体系，希望直接进入原版文章、深度对话或考级冲刺训练。',
    behavior: '省去基础语法讲解，聚焦近义表达语体差异、习惯用法与复杂篇章结构。',
  },
];

export const NON_ENGLISH_LANG_DEPTH_PRESET_OPTIONS: DepthOptionItem[] = [
  {
    value: 'understand_basics',
    title: '理解大意与日常实用运用',
    tag: '重核心词汇、常用对话与基础阅读',
    target: '重在读懂常见主题短文、掌握高频对话与核心词汇含义，建立稳定语感。',
    behavior: '句式自然清晰，练习聚焦语境理解、常用词替换与日常场景应用。',
  },
  {
    value: 'master_textbook',
    title: '系统精学与标准考试达标',
    tag: '教材 / 考级标准深度',
    target: '对标系统教材或标准考级（如 JLPT 等），吃透词汇辨析、核心语法体系与长句拆解。',
    behavior: '哪怕起点较低也先搭好语言桥梁，再完整训练语法运用、精细辨析与阅读理解。',
  },
  {
    value: 'deep_rigorous',
    title: '深度鉴赏与地道表达迁移',
    tag: '高阶原版精读与复杂表达',
    target: '深入高阶文学/评论文章、修辞语感、敬语或专业语域辨析，并能完成地道迁移表达。',
    behavior: '全面剖析细微语义差、文化语境与表达风格，练习覆盖深层推断与高阶仿写。',
  },
];

export function getBaselinePresetOptions(
  category?: CourseCategory,
  _targetLanguage?: TargetLanguageCode
): BaselineOptionItem[] {
  if (category !== 'english') return BASELINE_PRESET_OPTIONS;
  return ENGLISH_BASELINE_PRESET_OPTIONS;
}

export function getDepthPresetOptions(
  category?: CourseCategory,
  _targetLanguage?: TargetLanguageCode
): DepthOptionItem[] {
  if (category !== 'english') return DEPTH_PRESET_OPTIONS;
  return ENGLISH_DEPTH_PRESET_OPTIONS;
}

export const NON_ENGLISH_LANG_BASELINE_LABELS: Record<Exclude<LearnerBaselinePreset, 'custom'>, string> = {
  zero_base: '语言零基础（需从文字/发音与最简基础句型起步）',
  partial_base: '具备语言入门基础（已会基本读写 · 需强化语法接续与语境词汇）',
  solid_base: '语言基础扎实（可直入原版文章、地道语体与复杂句法辨析）',
};

export const NON_ENGLISH_LANG_DEPTH_LABELS: Record<Exclude<LearningDepthPreset, 'custom'>, string> = {
  understand_basics: '日常理解与实用运用（重语境词汇与常见交际表达）',
  master_textbook: '系统精学与考级达标（完整覆盖教材语法体系与阅读词汇辨析）',
  deep_rigorous: '高阶原版精读与地道表达迁移（细微语感、修辞语域与高阶输出）',
};

export const BASELINE_LABELS: Record<Exclude<LearnerBaselinePreset, 'custom'>, string> = {
  zero_base: '零基础（未修先修课 · 需补全术语与数学工具直觉）',
  partial_base: '具备部分基础（有中学/部分先修印象 · 需快速唤醒关键结论）',
  solid_base: '基础扎实（已修先修课 · 可直接切入严格符号与核心推导）',
};

export const ENGLISH_BASELINE_LABELS: Record<Exclude<LearnerBaselinePreset, 'custom'>, string> = {
  zero_base: '语言零基础 / 基础薄弱（需从文字/基础句型与核心词义拆解起步）',
  partial_base: '具备语言常规基础（会基础读写与语法 · 需点拨高频搭配、语法接续与长难句）',
  solid_base: '高阶语言基础扎实（词汇句法扎实 · 可直入原版文献与深层语域辨析）',
};

export const DEPTH_LABELS: Record<Exclude<LearningDepthPreset, 'custom'>, string> = {
  understand_basics: '建立直觉与初步理解（看懂核心机理与基础应用）',
  master_textbook: '学透核心原理与典型题型（标准高水平本科教材与完整推导）',
  deep_rigorous: '深度钻研与高阶拓展（非理想因素、误差边界与复杂变式迁移）',
};

export const ENGLISH_DEPTH_LABELS: Record<Exclude<LearningDepthPreset, 'custom'>, string> = {
  understand_basics: '读懂大意与日常实用运用（重语境复现、高频搭配与基础理解）',
  master_textbook: '吃透精读教材与标准应试（对标教材/考纲长难句拆解、语法与近义辨析）',
  deep_rigorous: '原版深度鉴赏与高阶迁移（复杂修辞逻辑、语域辨析与高阶迁移输出）',
};

export function mapLegacyLevelToDualAxis(level?: LearnerLevel): {
  baseline: Exclude<LearnerBaselinePreset, 'custom'>;
  depth: Exclude<LearningDepthPreset, 'custom'>;
} {
  if (level === 'beginner') {
    return { baseline: 'zero_base', depth: 'understand_basics' };
  }
  if (level === 'advanced') {
    return { baseline: 'solid_base', depth: 'deep_rigorous' };
  }
  return { baseline: 'partial_base', depth: 'master_textbook' };
}

export function deriveLegacyLearnerLevel(
  baseline?: LearnerBaselinePreset,
  depth?: LearningDepthPreset
): LearnerLevel {
  if (depth === 'deep_rigorous') return 'advanced';
  if (depth === 'understand_basics' && baseline !== 'solid_base') return 'beginner';
  if (baseline === 'zero_base' && depth !== 'master_textbook') return 'beginner';
  return 'intermediate';
}

export function resolveLearnerProfile(input?: {
  category?: CourseCategory;
  targetLanguage?: TargetLanguageCode;
  learnerLevel?: LearnerLevel;
  learnerBaseline?: LearnerBaselinePreset;
  customLearnerBaseline?: string;
  learningDepth?: LearningDepthPreset;
  customLearningDepth?: string;
}): {
  baseline: LearnerBaselinePreset;
  customBaseline: string;
  depth: LearningDepthPreset;
  customDepth: string;
  legacyLevel: LearnerLevel;
  baselineText: string;
  depthText: string;
  combinedLabel: string;
  strategySummary: string;
} {
  const isLanguage = input?.category === 'english';
  const fallback = mapLegacyLevelToDualAxis(input?.learnerLevel);
  const baseline: LearnerBaselinePreset = input?.learnerBaseline || fallback.baseline;
  const depth: LearningDepthPreset = input?.learningDepth || fallback.depth;
  const customBaseline = (input?.customLearnerBaseline || '').trim();
  const customDepth = (input?.customLearningDepth || '').trim();

  const baselineMap = isLanguage ? ENGLISH_BASELINE_LABELS : BASELINE_LABELS;
  const depthMap = isLanguage ? ENGLISH_DEPTH_LABELS : DEPTH_LABELS;

  const baselineText =
    baseline === 'custom'
      ? customBaseline
        ? `自定义水平：${customBaseline}`
        : '自定义水平（待填写）'
      : baselineMap[baseline];
  const depthText =
    depth === 'custom'
      ? customDepth
        ? `自定义目标深度：${customDepth}`
        : '自定义目标深度（待填写）'
      : depthMap[depth];

  const legacyLevel =
    input?.learnerBaseline || input?.learningDepth
      ? deriveLegacyLearnerLevel(baseline, depth)
      : input?.learnerLevel || 'intermediate';

  const combinedLabel = `我的当前水平：${baselineText} ｜ 我的学习目标深度：${depthText}`;

  let strategySummary: string;
  if (isLanguage) {
    if (
      baseline === 'zero_base' &&
      (depth === 'master_textbook' || depth === 'deep_rigorous')
    ) {
      strategySummary =
        '语言跨阶强攀升策略：前段先从文字/基础句型、句子主干与核心词义搭好入门阶梯；中后段不降低教材/考级或原版阅读深度，完整讲透语法接续、熟词僻义、近义辨析与高阶迁移。';
    } else if (baseline === 'zero_base' && depth === 'custom') {
      strategySummary =
        '语言零基础起跑 + 自定义目标：先补齐基础句法骨架与核心词义直觉，随后严格围绕你设定的自定义语言目标完成精读拆解与训练。';
    } else if (baseline === 'solid_base' && depth === 'understand_basics') {
      strategySummary =
        '高起点轻快运用策略：省略基础语法拆解，直接通过地道阅读与对话语境高效串联目标词汇与高频搭配。';
    } else if (baseline === 'custom' || depth === 'custom') {
      strategySummary =
        '自定义语言双轴策略：句法拆解与词汇助记严格贴合你输入的当前水平，语言难度、表达语域与练习深度严格对齐你设定的学习目标。';
    } else {
      strategySummary =
        '语言均衡进阶策略：前段按当前语言水平点拨高频搭配、语法接续与句法结构，后段内容深度与练习严格对齐目标教材、考试标准或实际运用目标。';
    }
  } else {
    if (
      baseline === 'zero_base' &&
      (depth === 'master_textbook' || depth === 'deep_rigorous')
    ) {
      strategySummary =
        '双阶梯强攀升策略：前段先零门槛补齐术语、微积分/电路直觉与先修桥梁，中后段不删减难度，完整推演至目标章全部核心推导与高阶训练。';
    } else if (baseline === 'zero_base' && depth === 'custom') {
      strategySummary =
        '零基础起跑 + 自定义目标：开篇补全全部前置工具与术语直觉，随后严格围绕你设定的自定义目标深度完成推导与训练。';
    } else if (baseline === 'solid_base' && depth === 'understand_basics') {
      strategySummary =
        '高起点精炼理解策略：省略低阶常识铺垫，直接用严谨先修语言点透核心物理图像与工程主干结论。';
    } else if (baseline === 'custom' || depth === 'custom') {
      strategySummary =
        '自定义双轴协同策略：讲义前段铺垫严格贴合你输入的当前水平，中后段推导步幅与习题深度严格对齐你设定的学习目标。';
    } else {
      strategySummary =
        '均衡匹配策略：前段铺垫依据当前水平按需唤醒先修知识，后段推导步幅与练习梯度严格对齐目标深度。';
    }
  }

  return {
    baseline,
    customBaseline,
    depth,
    customDepth,
    legacyLevel,
    baselineText,
    depthText,
    combinedLabel,
    strategySummary,
  };
}
