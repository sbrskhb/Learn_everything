import type {
  CourseCategory,
  LearnerBaselinePreset,
  LearnerLevel,
  LearningDepthPreset,
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
    tag: '从基础句型与核心词义讲起',
    audience: '词汇量在中学/高考阶段，面对复合长难句、非谓语与虚拟语气容易卡壳。',
    behavior: '放缓语境复杂度，逐句拆解主干谓语与从句引导词，配合直观词根词缀助记。',
  },
  {
    value: 'partial_base',
    title: '四六级 / 常规阅读基础',
    tag: '唤醒高频搭配与长难句主干',
    audience: '具备四六级基础词汇与基本语法，但遇外刊熟词僻义、倒装省略或长从句仍需梳理。',
    behavior: '跳过简单基础语法啰嗦，重点点拨熟词僻义、地道短语搭配与复杂句法结构。',
  },
  {
    value: 'solid_base',
    title: '高阶阅读基础 / 语感扎实',
    tag: '直入原刊修辞与深层逻辑',
    audience: '已掌握较丰富学术词汇与复杂句法，希望直接进入高信息密度原刊语境。',
    behavior: '省去基础语法扫盲，直接聚焦近义词微妙语体差异、作者修辞态度与篇章论证。',
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
    title: '读懂大意与掌握核心词义',
    tag: '重语境复现与高频搭配',
    target: '重在记住每日目标词的核心含义与常见搭配，能顺畅读懂中等长度语境文章。',
    behavior: '文章句式清晰自然，练习聚焦词汇语境填空、词义匹配与主旨细节理解。',
  },
  {
    value: 'master_textbook',
    title: '吃透外刊精读与应试进阶',
    tag: '六级 / 考研 / 托福标准深度',
    target: '严格对标六级/考研/托福阅读标准，掌握一词多义、近义词辨析与长难句精析。',
    behavior: '哪怕起点薄弱也先拆解句法骨架，再完整训练长难句剖析、同义替换与阅读推断。',
  },
  {
    value: 'deep_rigorous',
    title: '原刊深度鉴赏与学术写作迁移',
    tag: 'Economist / 学术期刊级深度',
    target: '深入 The New Yorker / Economist 级复杂长难句、修辞隐喻、语域辨析与高阶写作改写。',
    behavior: '全面剖析词源逻辑、修辞张力与批判性推理，练习覆盖深层态度推断与高阶句式仿写。',
  },
];

export function getBaselinePresetOptions(category?: CourseCategory): BaselineOptionItem[] {
  return category === 'english' ? ENGLISH_BASELINE_PRESET_OPTIONS : BASELINE_PRESET_OPTIONS;
}

export function getDepthPresetOptions(category?: CourseCategory): DepthOptionItem[] {
  return category === 'english' ? ENGLISH_DEPTH_PRESET_OPTIONS : DEPTH_PRESET_OPTIONS;
}

export const BASELINE_LABELS: Record<Exclude<LearnerBaselinePreset, 'custom'>, string> = {
  zero_base: '零基础（未修先修课 · 需补全术语与数学工具直觉）',
  partial_base: '具备部分基础（有中学/部分先修印象 · 需快速唤醒关键结论）',
  solid_base: '基础扎实（已修先修课 · 可直接切入严格符号与核心推导）',
};

export const ENGLISH_BASELINE_LABELS: Record<Exclude<LearnerBaselinePreset, 'custom'>, string> = {
  zero_base: '英语基础薄弱（中学/高考词汇量 · 需逐句拆解主干与基础语法铺垫）',
  partial_base: '四六级常规阅读基础（掌握基本语法 · 需点拨外刊熟词僻义与复杂从句）',
  solid_base: '高阶英语阅读基础（词汇与句法扎实 · 可直入原刊修辞与深层逻辑）',
};

export const DEPTH_LABELS: Record<Exclude<LearningDepthPreset, 'custom'>, string> = {
  understand_basics: '建立直觉与初步理解（看懂核心机理与基础应用）',
  master_textbook: '学透核心原理与典型题型（标准高水平本科教材与完整推导）',
  deep_rigorous: '深度钻研与高阶拓展（非理想因素、误差边界与复杂变式迁移）',
};

export const ENGLISH_DEPTH_LABELS: Record<Exclude<LearningDepthPreset, 'custom'>, string> = {
  understand_basics: '读懂大意与掌握核心词义（重语境复现、高频搭配与基础理解）',
  master_textbook: '吃透外刊精读与应试进阶（对标六级/考研/托福长难句拆解与近义词辨析）',
  deep_rigorous: '原刊深度鉴赏与学术写作迁移（Economist 级修辞逻辑、语域辨析与高阶仿写）',
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
  const isEnglish = input?.category === 'english';
  const fallback = mapLegacyLevelToDualAxis(input?.learnerLevel);
  const baseline: LearnerBaselinePreset = input?.learnerBaseline || fallback.baseline;
  const depth: LearningDepthPreset = input?.learningDepth || fallback.depth;
  const customBaseline = (input?.customLearnerBaseline || '').trim();
  const customDepth = (input?.customLearningDepth || '').trim();

  const baselineMap = isEnglish ? ENGLISH_BASELINE_LABELS : BASELINE_LABELS;
  const depthMap = isEnglish ? ENGLISH_DEPTH_LABELS : DEPTH_LABELS;

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
  if (isEnglish) {
    if (
      baseline === 'zero_base' &&
      (depth === 'master_textbook' || depth === 'deep_rigorous')
    ) {
      strategySummary =
        '英语跨阶强攀升策略：前段先逐句拆解句子主干、从句引导词与基础词根，帮零基础扫清语法障碍；中后段不降低外刊文章立意与考纲深度，完整讲透熟词僻义、同义辨析与高阶阅读题。';
    } else if (baseline === 'zero_base' && depth === 'custom') {
      strategySummary =
        '英语基础起跑 + 自定义目标：先补齐基础句法骨架与核心词义直觉，随后严格围绕你设定的自定义英语目标完成精读拆解与训练。';
    } else if (baseline === 'solid_base' && depth === 'understand_basics') {
      strategySummary =
        '高起点轻快阅读策略：省略基础语法拆解，直接通过地道外刊语境高效串联当日目标词与核心搭配。';
    } else if (baseline === 'custom' || depth === 'custom') {
      strategySummary =
        '自定义英语双轴策略：句法拆解与词汇助记严格贴合你输入的当前英语水平，文章语域复杂度与练习深度严格对齐你设定的学习目标。';
    } else {
      strategySummary =
        '英语均衡进阶策略：前段按当前英语水平点拨高频搭配与句法结构，后段精读文章深度与阅读练习严格对齐目标考纲或外刊标准。';
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
