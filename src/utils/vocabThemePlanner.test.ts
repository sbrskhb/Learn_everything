import test from 'node:test';
import assert from 'node:assert/strict';
import type { Course, VocabItem, VocabThemeItem, VocabThemePlan } from '../types';
import { assignStableVocabIds } from './learningLogic';
import {
  allocateVocabByThemes,
  buildCompactVocabText,
  getNextMappingBatch,
  getVocabThemeMappingProgress,
  matchWordsToThemesLocally,
  parseImportedVocabThemes,
  parseImportedWordThemeMappings,
  sampleVocabForThemePlanning,
} from './vocabThemePlanner';
import { syncCourseVocabCoverage } from './vocabCoverage';
import {
  buildSyllabusUserPrompt,
  buildVocabThemePlanningPrompt,
  buildVocabWordMappingPrompt,
} from '../prompts/promptLibrary';

function makeTestCourse(words: VocabItem[], overrides?: Partial<Course>): Course {
  const effectiveWords = assignStableVocabIds(words);
  return {
    id: 'course-theme-test',
    name: 'CET-6 Reading Test',
    category: 'english',
    generationMode: 'chat',
    learnerLevel: 'intermediate',
    learnerBaseline: 'partial_base',
    learningDepth: 'master_textbook',
    goal: '全面掌握核心阅读词汇',
    startDate: '2026-11-20',
    durationDays: 10,
    extraRequirements: '',
    materials: [],
    englishConfig: {
      targetBankName: 'Test Bank',
      excludedBankName: '无排除词库',
      totalTargetCount: effectiveWords.length,
      excludedCount: 0,
      effectiveWords,
      dailyWordCount: 20,
      newWordsPerArticle: 20,
      targetWordDensity: 0.02,
      expectedRepeatsPerWord: 2,
      articleMode: 'llm_original',
      preferredSources: 'The Economist',
      learningPurpose: 'exam',
      interestPreferences: '人工智能、商业科技',
      inputMode: 'vocab_only',
    },
    dailyPlan: [],
    masteredWords: [],
    exerciseSubmissions: {},
    createdAt: '2026-11-20T00:00:00Z',
    ...overrides,
  };
}

test('sampleVocabForThemePlanning & buildCompactVocabText produce stratified IDs', () => {
  const words: VocabItem[] = Array.from({ length: 300 }, (_, i) => ({
    word: `term${i + 1}`,
    meaning: `释义 ${i + 1}`,
  }));
  const sampled = sampleVocabForThemePlanning(words, 30);
  assert.equal(sampled.length, 30);
  assert.equal(sampled[0].id, 'w-001');
  assert.notEqual(sampled[29].id, 'w-030'); // spans across the whole 300-word bank

  const compact = buildCompactVocabText(words.slice(0, 3));
  assert.equal(compact, 'w-001\tterm1\t释义 1\nw-002\tterm2\t释义 2\nw-003\tterm3\t释义 3');
});

test('parseImportedVocabThemes normalizes fenced JSON, IDs, weights, and fallback flag', () => {
  const raw = [
    '下面是为您规划的主题：',
    '```json',
    '{',
    '  "themes": [',
    '    {',
    '      "id": "t1",',
    '      "name": "AI 与数字科技",',
    '      "description": "算法与智能化转型",',
    '      "weight": 2.2,',
    '      "isInterestBoosted": true,',
    '      "keywords": ["algorithm", "智能", "智能"]',
    '    },',
    '    {',
    '      "name": "通用跨领域逻辑词",',
    '      "description": "通用学术与抽象表达",',
    '      "weight": 9.9,',
    '      "isGeneralFallback": true,',
    '      "keywords": ["essential"]',
    '    }',
    '  ]',
    '}',
    '```',
  ].join('\n');

  const themes = parseImportedVocabThemes(raw);
  assert.equal(themes.length, 2);
  assert.equal(themes[0].id, 'T01');
  assert.equal(themes[0].weight, 2.2);
  assert.equal(themes[0].isInterestBoosted, true);
  assert.deepEqual(themes[0].keywords, ['algorithm', '智能']);
  assert.equal(themes[1].id, 'T02');
  assert.equal(themes[1].weight, 4.0); // clamped from 9.9
  assert.equal(themes[1].isGeneralFallback, true);
});

test('parseImportedWordThemeMappings handles all 4 formats + compact hyphen IDs + truncated JSON salvage', () => {
  const words = assignStableVocabIds([
    { word: 'algorithm', meaning: '算法' },
    { word: 'well-known', meaning: '著名的' },
    { word: 'mitigate', meaning: '减轻' },
    { word: 'revenue', meaning: '收入' },
    { word: 'wildlife', meaning: '野生生物' },
  ]);
  const themes: VocabThemeItem[] = [
    { id: 'T01', name: '科技', description: 'AI', weight: 2.0, keywords: [] },
    { id: 'T02', name: '商业经济', description: '商业', weight: 1.5, keywords: [] },
    { id: 'T03', name: '生态自然', description: '自然', weight: 1.0, keywords: [] },
  ];

  // Format 1: JSON { assignments }
  const r1 = parseImportedWordThemeMappings(
    JSON.stringify({ assignments: { 'w-001': ['T01', 'T02'], 'w-004': ['T02'] } }),
    words,
    themes
  );
  assert.equal(r1.acceptedWordCount, 2);
  assert.deepEqual(r1.mappings['w-001'].themeIds, ['T01', 'T02']);

  // Format 2: Theme-inverted JSON merging multiple themes per word
  const r2 = parseImportedWordThemeMappings(
    JSON.stringify({
      themes: {
        T01: ['w-001', 'mitigate'],
        T03: ['mitigate', 'wildlife'],
      },
    }),
    words,
    themes
  );
  assert.equal(r2.acceptedWordCount, 3);
  assert.deepEqual(r2.mappings['w-003'].themeIds, ['T01', 'T03']);
  assert.deepEqual(r2.mappings['w-005'].themeIds, ['T03']);

  // Format 3: JSON array with word text & theme name lookup
  const r3 = parseImportedWordThemeMappings(
    JSON.stringify([{ word: 'revenue', themes: ['商业经济'] }]),
    words,
    themes
  );
  assert.deepEqual(r3.mappings['w-004'].themeIds, ['T02']);

  // Format 4: Compact line format including differing zero-padding (`W-01`), hyphenated ID (`w-001`), and hyphenated word (`well-known`)
  const compactOut = [
    '```text',
    'W-01: T01, T02',
    'well-known: T02',
    'w-0005 -> T03',
    '```',
  ].join('\n');
  const r4 = parseImportedWordThemeMappings(compactOut, words, themes);
  assert.equal(r4.acceptedWordCount, 3);
  assert.deepEqual(r4.mappings['w-001'].themeIds, ['T01', 'T02']);
  assert.deepEqual(r4.mappings['w-002'].themeIds, ['T02']);
  assert.deepEqual(r4.mappings['w-005'].themeIds, ['T03']);

  // Truncated JSON salvage
  const truncatedJson = '{"assignments":{"w-001":["T01"],"w-004":["T02","T01"],"w-005":["T';
  const r5 = parseImportedWordThemeMappings(truncatedJson, words, themes);
  assert.equal(r5.acceptedWordCount, 2);
  assert.deepEqual(r5.mappings['w-001'].themeIds, ['T01']);
  assert.deepEqual(r5.mappings['w-004'].themeIds, ['T02', 'T01']);
});

test('matchWordsToThemesLocally tags confident matches and preserves AI/manual mappings', () => {
  const words = assignStableVocabIds([
    { word: 'algorithm', meaning: 'n. 算法，计算程序' },
    { word: 'contamination', meaning: 'n. 污染，玷污' },
    { word: 'monopolize', meaning: 'vt. 垄断，独占' },
    { word: 'vague', meaning: 'adj. 模糊的，不明确的' },
  ]);
  const themes: VocabThemeItem[] = [
    {
      id: 'T01',
      name: '人工智能与计算科技',
      description: '数字与算法',
      weight: 2.0,
      keywords: ['algorithm', 'compute', '算法', '计算'],
    },
    {
      id: 'T02',
      name: '生态环境与可持续发展',
      description: '环境与气候',
      weight: 1.0,
      keywords: ['contamination', 'pollution', '污染', '生态'],
    },
    {
      id: 'T03',
      name: '通用学术与抽象描述',
      description: '跨领域词汇',
      weight: 1.0,
      isGeneralFallback: true,
      keywords: [],
    },
  ];

  const existing = {
    'w-003': { themeIds: ['T01'], source: 'ai' as const },
  };
  const confident = matchWordsToThemesLocally(words, themes, existing, { mode: 'confident_only' });
  assert.deepEqual(confident.mappings['w-001'].themeIds, ['T01']);
  assert.equal(confident.mappings['w-001'].source, 'local');
  assert.deepEqual(confident.mappings['w-002'].themeIds, ['T02']);
  assert.equal(confident.mappings['w-003'].source, 'ai'); // preserved!
  assert.equal(confident.mappings['w-004'], undefined); // low confidence skipped in confident_only

  const filled = matchWordsToThemesLocally(words, themes, confident.mappings, {
    mode: 'fill_remaining',
  });
  assert.equal(filled.fallbackCount, 1);
  assert.deepEqual(filled.mappings['w-004'].themeIds, ['T03']); // went to general fallback

  const progress = getVocabThemeMappingProgress(words, themes, filled.mappings);
  assert.equal(progress.aiMappedCount, 1);
  assert.equal(progress.localMappedCount, 3);
  assert.equal(progress.totalMappedCount, 4);
  assert.equal(progress.unmappedWordIds.length, 0);

  const batchWithLocal = getNextMappingBatch(words, filled.mappings, {
    batchSize: 10,
    includeLocal: true,
  });
  assert.equal(batchWithLocal.batchWords.length, 3); // excludes w-003 ('ai')
});

test('allocateVocabByThemes respects single-candidate semantics, tilts multi-candidate words by weight, interleaves, preserves lessons, and yields 100% Layer 1 coverage', () => {
  // 300 words:
  // 1..60: strictly T02 (single candidate - medical/bio)
  // 61..120: strictly T01 (single candidate - AI)
  // 121..260: multi-candidate [T02, T01] (can naturally appear in bio or AI tech; T01 has weight 2.5 vs T02 0.8)
  // 261..300: unmapped -> fallback / local
  const words: VocabItem[] = Array.from({ length: 300 }, (_, i) => ({
    word: `lexeme${i + 1}`,
    meaning: i >= 260 ? '通用概念或抽象词' : `专项词 ${i + 1}`,
  }));
  const normalized = assignStableVocabIds(words);
  const themes: VocabThemeItem[] = [
    {
      id: 'T01',
      name: 'AI 与数字科技',
      description: '智能科技主题',
      weight: 2.5,
      isInterestBoosted: true,
      keywords: ['tech', '科技'],
      subtopics: ['机器学习进展', '数字化治理'],
    },
    {
      id: 'T02',
      name: '生命健康与生态',
      description: '医学与生物',
      weight: 0.8,
      keywords: ['medical', '生态'],
      subtopics: ['公共卫生'],
    },
    {
      id: 'T03',
      name: '通用综合论述',
      description: '跨领域词汇',
      weight: 0.9,
      isGeneralFallback: true,
      keywords: ['通用'],
    },
  ];

  const wordThemes: VocabThemePlan['wordThemes'] = {};
  for (let i = 0; i < 60; i++) {
    wordThemes[normalized[i].id!] = { themeIds: ['T02'], source: 'ai' };
  }
  for (let i = 60; i < 120; i++) {
    wordThemes[normalized[i].id!] = { themeIds: ['T01'], source: 'ai' };
  }
  for (let i = 120; i < 260; i++) {
    wordThemes[normalized[i].id!] = { themeIds: ['T02', 'T01'], source: 'ai' };
  }

  const course = makeTestCourse(normalized);
  const plan: VocabThemePlan = {
    themes,
    wordThemes,
    interleaveThemes: true,
  };

  const result = allocateVocabByThemes(course, plan, {
    newWordsPerArticle: 20,
    interleaveThemes: true,
    preserveStartedSlots: false,
  });

  assert.equal(result.coverage?.totalTargetWords, 300);
  assert.equal(result.coverage?.plannedCoverageRate, 100);
  assert.equal(result.coverage?.unassignedWordIds.length, 0);
  assert.ok(!course.dailyPlan.some((s) => s.topicGroup === '补充词汇巩固专题'));

  // Check single-candidate integrity
  const slotThemeByWordId = new Map<string, string>();
  for (const s of course.dailyPlan) {
    for (const id of s.targetWordIds || []) {
      slotThemeByWordId.set(id, s.themeId || '');
    }
  }
  for (let i = 0; i < 60; i++) {
    assert.equal(slotThemeByWordId.get(normalized[i].id!), 'T02');
  }
  for (let i = 60; i < 120; i++) {
    assert.equal(slotThemeByWordId.get(normalized[i].id!), 'T01');
  }

  // Because T01 has weight 2.5 vs T02 weight 0.8, multi-candidate words tilt strongly toward T01
  const t01Dist = result.summary.themeDistribution.find((d) => d.themeId === 'T01')!;
  const t02Dist = result.summary.themeDistribution.find((d) => d.themeId === 'T02')!;
  assert.ok(t01Dist.wordCount > t02Dist.wordCount, `Expected T01 (${t01Dist.wordCount}) > T02 (${t02Dist.wordCount})`);

  // Verify interleaving: first 4 slots should contain multiple themes instead of locking all T01 first
  const firstFourThemeIds = new Set(course.dailyPlan.slice(0, 4).map((s) => s.themeId));
  assert.ok(firstFourThemeIds.size >= 2);

  // Check Step 1A/1B/Step 2 prompt integration
  const p1a = buildVocabThemePlanningPrompt({ course, mode: 'chat' });
  assert.ok(p1a.userPrompt.includes('120 / 300'));
  const p1b = buildVocabWordMappingPrompt({
    course,
    themes,
    batchWords: normalized.slice(260, 270),
    batchIndex: 1,
    totalBatches: 1,
    mode: 'chat',
  });
  assert.ok(p1b.userPrompt.includes('w-261'));
  const p2 = buildSyllabusUserPrompt({
    name: course.name,
    category: course.category,
    goal: course.goal,
    durationDays: course.durationDays,
    extraRequirements: '',
    materials: [],
    effectiveWords: normalized,
    dailyWordCount: 20,
    vocabThemePlan: course.englishConfig!.vocabThemePlan,
    existingSlots: course.dailyPlan,
  });
  assert.ok(p2.includes('第 1 步已完成 AI 主题规划与加权语义分节'));
  assert.ok(p2.includes('无需重复搬运'));
  assert.ok(p2.includes('sec-01 | 主题:'));

  // Test generated-lesson preservation on subsequent re-allocation
  course.dailyPlan[0].lesson = {
    dayIndex: 1,
    date: course.startDate,
    title: 'Locked Lesson 1',
    summary: 'Done',
    keyPoints: ['a'],
    markdownBody: 'Body',
    exercises: [],
    generatedAt: '2026-11-20T01:00:00Z',
  };
  const lockedIds = [...(course.dailyPlan[0].targetWordIds || [])];
  const res2 = allocateVocabByThemes(course, course.englishConfig!.vocabThemePlan!, {
    newWordsPerArticle: 20,
    interleaveThemes: false, // grouped mode
    preserveStartedSlots: true,
  });
  assert.equal(course.dailyPlan[0].lesson?.title, 'Locked Lesson 1');
  assert.deepEqual(course.dailyPlan[0].targetWordIds, lockedIds);
  assert.equal(res2.coverage?.plannedCoverageRate, 100);
});

test('allocateVocabByThemes supports pure topic-article mode without a vocab bank and distributes articles by weight', () => {
  const themes: VocabThemeItem[] = [
    {
      id: 'T01',
      name: '人工智能与商业',
      description: 'AI 与商业前沿',
      weight: 2.0,
      isInterestBoosted: true,
      keywords: ['AI', 'business'],
      subtopics: ['AI Agent', 'SaaS Pricing'],
    },
    {
      id: 'T02',
      name: '气候与能源',
      description: '绿色转型',
      weight: 1.0,
      keywords: ['climate', 'grid'],
      subtopics: ['Clean Grid'],
    },
    {
      id: 'T03',
      name: '文化与社会',
      description: '社会洞察',
      weight: 1.0,
      isGeneralFallback: true,
      keywords: ['society', 'culture'],
      subtopics: ['Urban Life'],
    },
  ];

  const course = makeTestCourse([]);
  course.englishConfig!.inputMode = 'ai_autonomous';
  const plan: VocabThemePlan = {
    themes,
    wordThemes: {},
    interleaveThemes: true,
  };

  const result = allocateVocabByThemes(course, plan, {
    totalArticles: 12,
    interleaveThemes: true,
    preserveStartedSlots: false,
  });

  assert.equal(result.totalSections, 12);
  assert.equal(course.dailyPlan.length, 12);
  assert.equal(result.summary.totalWords, 0);

  const t01 = result.summary.themeDistribution.find((d) => d.themeId === 'T01')!;
  const t02 = result.summary.themeDistribution.find((d) => d.themeId === 'T02')!;
  const t03 = result.summary.themeDistribution.find((d) => d.themeId === 'T03')!;
  // Weights 2 : 1 : 1 over 12 articles => 6 : 3 : 3 articles
  assert.equal(t01.sectionCount, 6);
  assert.equal(t02.sectionCount, 3);
  assert.equal(t03.sectionCount, 3);
  assert.equal(t01.sharePct, 50);

  // Interleaving puts T01 alongside T02/T03 in the opening articles
  const firstThreeThemes = new Set(course.dailyPlan.slice(0, 3).map((s) => s.themeId));
  assert.ok(firstThreeThemes.size >= 2);
});
