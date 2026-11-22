import test from 'node:test';
import assert from 'node:assert/strict';
import type { Course, DailyLessonContent, VocabItem } from '../types';
import {
  assignStableVocabIds,
  deduplicateVocabList,
  formatVocabularyExport,
  parseVocabularyInput,
} from './learningLogic';
import {
  applyStep2EnglishEnhancementToLesson,
  buildEnglishInflectionForms,
  computeEnglishReadingPlanStats,
  computeSectionAssociatedVocabStats,
  extractLessonProseForCoverage,
  extractPendingGlossWordsForSection,
  getEligibleReviewWordsForSlot,
  getGroupedReviewWordsForSlot,
  isPlaceholderVocabMeaning,
  isWeakBaselineForVocabSimplification,
  mergeExtraWordGlossesIntoLesson,
  parseImportedStep2EnglishOutput,
  parseImportedWordGlosses,
  reassignVocabWordsToCourse,
  resolveEnglishQuoteAnchors,
  resolveLanguageInputMode,
  setVocabManualVerification,
  splitEnglishParagraphSentences,
  syncCourseVocabCoverage,
} from './vocabCoverage';
import {
  parseImportedLessonContent,
  parseImportedSyllabusContent,
  sanitizeLessonCitations,
} from './coursewareParser';
import {
  buildAgentExecutionPrompt,
  buildAgentSectionStagePrompt,
  buildAgentSyllabusPrompt,
  buildChatLessonPrompt,
  buildChatLessonStage1Prompt,
  buildChatSyllabusPrompt,
  buildEnglishLessonUserPrompt,
  buildEnglishStage2WordGlossPrompt,
  buildSyllabusUserPrompt,
  buildVocabSemanticReviewPrompt,
  composeCoursewareSystemPrompt,
} from '../prompts/promptLibrary';

function makeVocabCourse(params: {
  words: VocabItem[];
  dailyPlan?: Course['dailyPlan'];
  materials?: Course['materials'];
  targetLanguage?: 'english' | 'japanese' | 'other';
  learningPurpose?: 'interest' | 'exam';
  interestPreferences?: string;
}): Course {
  const effectiveWords = assignStableVocabIds(params.words);
  return {
    id: 'course-lang-test',
    name: 'Language Coverage Test',
    category: 'english',
    generationMode: 'api',
    learnerLevel: 'intermediate',
    learnerBaseline: 'partial_base',
    learningDepth: 'master_textbook',
    goal: 'Master target expressions in natural context',
    startDate: '2026-11-20',
    durationDays: 3,
    extraRequirements: '',
    outlineConfirmed: true,
    materials: params.materials || [],
    englishConfig: {
      targetBankName: 'Custom Test Bank',
      excludedBankName: 'None',
      totalTargetCount: effectiveWords.length,
      excludedCount: 0,
      effectiveWords,
      dailyWordCount: 3,
      newWordsPerArticle: 3,
      targetWordDensity: 0.05,
      expectedRepeatsPerWord: 2,
      articleMode: 'llm_original',
      preferredSources: 'The Economist',
      targetLanguage: params.targetLanguage || 'english',
      learningPurpose: params.learningPurpose || 'exam',
      interestPreferences: params.interestPreferences,
      inputMode: resolveLanguageInputMode(
        effectiveWords.length,
        (params.materials || []).length
      ),
    },
    dailyPlan: params.dailyPlan || [],
    masteredWords: ['mitigate'],
    exerciseSubmissions: {},
    reverseCheckNotes: {},
    createdAt: '2026-11-20T00:00:00.000Z',
  };
}

test('custom vocab import, deduplication, stable IDs, and TXT/CSV/JSON export roundtrip', () => {
  const csvRaw = [
    'word,phonetic,meaning',
    '"take off","/teɪk ɔːf/","起飞，突然成功"',
    '"mitigate","","减轻, 缓和"',
    '"Take   Off","","duplicate phrase with different spacing/case"',
    '食べる,たべる,吃',
  ].join('\n');

  const parsed = parseVocabularyInput(csvRaw);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].word, 'take off');
  assert.equal(parsed[0].meaning, '起飞，突然成功');
  assert.equal(parsed[2].word, '食べる');

  const withIds = assignStableVocabIds(parsed);
  assert.deepEqual(
    withIds.map((w) => w.id),
    ['w-001', 'w-002', 'w-003']
  );

  // Appending new item + duplicate keeps original stable IDs intact
  const merged = assignStableVocabIds(
    deduplicateVocabList([
      ...withIds,
      { word: 'mitigate', meaning: 'dup' },
      { word: 'resilient', meaning: '有韧性的' },
    ])
  );
  assert.equal(merged.length, 4);
  assert.equal(merged[0].id, 'w-001');
  assert.equal(merged[1].id, 'w-002');
  assert.equal(merged[2].id, 'w-003');
  assert.equal(merged[3].id, 'w-004');

  // Roundtrip CSV / TXT / JSON exports
  const exportedCsv = formatVocabularyExport(merged, 'csv');
  const reparsedFromCsv = parseVocabularyInput(exportedCsv);
  assert.equal(reparsedFromCsv.length, 4);
  assert.equal(reparsedFromCsv[0].word, 'take off');
  assert.equal(reparsedFromCsv[1].meaning, '减轻, 缓和');

  const exportedJson = formatVocabularyExport(merged, 'json');
  const reparsedFromJson = parseVocabularyInput(exportedJson);
  assert.equal(reparsedFromJson.length, 4);
  assert.equal(reparsedFromJson[3].id, 'w-004');

  const exportedTxt = formatVocabularyExport(merged, 'txt');
  const reparsedFromTxt = parseVocabularyInput(exportedTxt);
  assert.equal(reparsedFromTxt.length, 4);
});

test('computeEnglishReadingPlanStats derives article count and density-based length independent of durationDays', () => {
  const stats = computeEnglishReadingPlanStats({
    effectiveTotal: 90,
    newWordsPerArticle: 15,
    targetWordDensity: 0.05,
    expectedRepeatsPerWord: 2,
  });

  // 90 / 15 = 6 articles (not constrained by 3 study days)
  assert.equal(stats.estimatedArticleCount, 6);
  // 15 new words * 2 repeats = 30 occurrences; 30 / 0.05 = 600 words (+/- 20% float)
  assert.equal(stats.expectedOccurrencesPerArticle, 30);
  assert.equal(stats.estimatedArticleWordLength, 600);
  assert.equal(stats.minWordLength, 480);
  assert.equal(stats.maxWordLength, 720);
});

test('syllabus & lesson prompts cover all 4 input combinations, interest breadth weighting, exam vs interest, and Japanese without English density rules', () => {
  const sampleWords = assignStableVocabIds([
    { word: 'catalyst', meaning: '催化剂，促成因素' },
    { word: 'resilient', meaning: '有韧性的' },
  ]);
  const textMaterial = [
    {
      id: 'mat-1',
      fileName: 'unit1-notes.txt',
      fileSize: 512,
      extractedText: 'Chapter 1: Foundations of Modern Economics and Trade.',
    },
  ];

  // 1. vocab_only with interest preference + topicCount + exam purpose
  const vocabOnlyPrompt = buildSyllabusUserPrompt({
    name: '雅思商业阅读',
    category: 'english',
    learningPurpose: 'exam',
    interestPreferences: '金融市场与科技商业，同时想广泛提升阅读面',
    topicCount: 4,
    targetLanguage: 'english',
    goal: '完整覆盖目标词库并冲刺高分阅读',
    durationDays: 10,
    extraRequirements: '',
    materials: [],
    effectiveWords: sampleWords,
    dailyWordCount: 10,
    targetWordDensity: 0.04,
    expectedRepeatsPerWord: 2,
  });
  assert.match(vocabOnlyPrompt, /仅词库/);
  assert.match(vocabOnlyPrompt, /备考学习/);
  assert.match(vocabOnlyPrompt, /提高相关领域的主题与文章占比.*广泛性和多样性/);
  assert.match(vocabOnlyPrompt, /4 个核心主题/);
  assert.match(vocabOnlyPrompt, /不按固定天数限制篇数/);
  assert.match(vocabOnlyPrompt, /w-001: catalyst/);

  // 2. material_only
  const materialOnlyPrompt = buildSyllabusUserPrompt({
    name: '经济学选读',
    category: 'english',
    learningPurpose: 'interest',
    targetLanguage: 'english',
    goal: '跟读教材章节',
    durationDays: 5,
    extraRequirements: '',
    materials: textMaterial,
    effectiveWords: [],
  });
  assert.match(materialOnlyPrompt, /仅教材/);
  assert.match(materialOnlyPrompt, /兴趣学习/);

  // 3. vocab_and_material
  const integratedCourse = makeVocabCourse({
    words: sampleWords,
    materials: textMaterial,
    learningPurpose: 'exam',
  });
  const chatIntegratedPrompt = buildChatSyllabusPrompt({ course: integratedCourse });
  const agentIntegratedPrompt = buildAgentSyllabusPrompt({
    course: integratedCourse,
    workspaceDir: 'courses/test',
  });
  assert.match(chatIntegratedPrompt, /词库 \+ 教材/);
  assert.match(agentIntegratedPrompt, /以教材决定主要知识顺序/);
  assert.match(agentIntegratedPrompt, /targetWordIds/);

  // 4. ai_autonomous + Japanese interest course (no English word-density rule forced)
  const jpAutonomousPrompt = buildSyllabusUserPrompt({
    name: '日语日常与动漫文化',
    category: 'english',
    targetLanguage: 'japanese',
    learningPurpose: 'interest',
    interestPreferences: '东京日常旅行与推理小说表达',
    goal: '从零学会日常会话、核心助词与短文阅读',
    durationDays: 7,
    extraRequirements: '',
    materials: [],
    effectiveWords: [],
  });
  assert.match(jpAutonomousPrompt, /日语/);
  assert.match(jpAutonomousPrompt, /无外加词库与教材/);
  assert.match(jpAutonomousPrompt, /词汇、语法、阅读、对话/);
  assert.doesNotMatch(jpAutonomousPrompt, /英语词库阅读规划参数/);

  const jpSystem = composeCoursewareSystemPrompt({
    subjectProfile: 'english_language',
    targetLanguage: 'japanese',
    learningPurpose: 'interest',
    learnerBaseline: 'zero_base',
    learningDepth: 'understand_basics',
  });
  assert.match(jpSystem, /日语/);
  assert.match(jpSystem, /无需自行统计或报告词频与覆盖率/);

  // Lesson user prompt for English never asks LLM to report word frequencies and distinguishes review words
  const lessonSlot = {
    id: 'sec-02',
    dayIndex: 2,
    date: '2026-11-21',
    topicGroup: 'Tech & Society',
    title: 'Resilience in Innovation',
    objective: 'Read deeply',
    keyTopics: ['Resilience'],
    targetWordIds: ['w-002'],
    reviewWordIds: ['w-001'],
  };
  const twoSecCourse = makeVocabCourse({
    words: sampleWords,
    dailyPlan: [
      {
        id: 'sec-01',
        dayIndex: 1,
        date: '2026-11-20',
        title: 'Catalysts',
        objective: 'Read',
        keyTopics: ['Catalyst'],
        targetWordIds: ['w-001'],
      },
      lessonSlot,
    ],
  });
  const enLessonPrompt = buildEnglishLessonUserPrompt({
    course: twoSecCourse,
    slot: lessonSlot,
    targetWords: [sampleWords[1]],
    articleMode: 'llm_original',
    preferredSources: 'The Economist',
    materialContext: '',
  });
  assert.match(enLessonPrompt, /w-002.*resilient/);
  assert.match(enLessonPrompt, /可选复习词[\s\S]*catalyst/);
  assert.match(enLessonPrompt, /不计入本篇新增目标词数/);
});

test('parseImportedSyllabusContent preserves topicGroup, targetWordIds, and reviewWordIds', () => {
  const imported = parseImportedSyllabusContent(
    JSON.stringify({
      knowledgeCatalog: [],
      sections: [
        {
          id: 'sec-01',
          topicGroup: 'Climate & Energy',
          title: 'Grid Transformation',
          objective: 'Understand renewable storage',
          keyTopics: ['Storage', 'Grid'],
          targetWordIds: ['w-001', 'w-002'],
          reviewWordIds: [],
        },
        {
          id: 'sec-02',
          topicGroup: 'Behavioral Economics',
          title: 'Choice Architecture',
          objective: 'Analyze nudges',
          keyTopics: ['Nudge'],
          targetWordIds: ['w-003'],
          reviewWordIds: ['w-001'],
        },
      ],
    }),
    '2026-11-20',
    5
  );

  assert.equal(imported.dailyPlan[0].topicGroup, 'Climate & Energy');
  assert.deepEqual(imported.dailyPlan[0].targetWordIds, ['w-001', 'w-002']);
  assert.deepEqual(imported.dailyPlan[1].reviewWordIds, ['w-001']);
});

test('two-layer vocab coverage: inflections, separable phrases, prose-only exclusion, homograph needs_review, review exclusion, reassignment, and lesson edits', () => {
  const words: VocabItem[] = [
    { word: 'mitigate', meaning: 'v. 减轻，缓和' },
    { word: 'carry out', meaning: 'phr. 执行，开展' },
    { word: 'art', meaning: 'n. 艺术' },
    { word: 'bank', meaning: 'n. 银行；河岸' },
    { word: 'criterion', meaning: 'n. 标准' },
    { word: 'grace', meaning: 'n. 优雅' },
    { word: 'ephemeral', meaning: 'adj. 短暂的' },
  ];

  const lesson1: DailyLessonContent = {
    dayIndex: 1,
    date: '2026-11-20',
    title: 'Policy and Practice',
    summary: 'Study mitigate, carry out, and art without mixing start.',
    keyPoints: [],
    generatedAt: '2026-11-20T00:00:00.000Z',
    markdownBody: '## Vocabulary Notes\nPlease memorize ephemeral and start.\n',
    englishPayload: {
      articleTitle: 'Urban Resilience',
      articleMode: 'llm_original',
      // Listing ephemeral here MUST NOT count as actual prose coverage!
      targetWords: [
        { id: 'w-001', word: 'mitigate', meaning: 'v. 减轻' },
        { id: 'w-002', word: 'carry out', meaning: 'phr. 执行' },
        { id: 'w-003', word: 'art', meaning: 'n. 艺术' },
        { id: 'w-004', word: 'bank', meaning: 'n. 银行' },
        { id: 'w-005', word: 'criterion', meaning: 'n. 标准' },
        { id: 'w-006', word: 'grace', meaning: 'n. 优雅' },
        { id: 'w-007', word: 'ephemeral', meaning: 'adj. 短暂的' },
      ],
      paragraphs: [
        {
          // 'start' must NOT match 'art'; 'mitigated' matches 'mitigate';
          // 'carried the plan out' matches separable 'carry out';
          // 'criteria' matches irregular plural of 'criterion';
          // 'bank' is homograph -> needs_review;
          // 'Grace' mid-sentence capitalized only -> needs_review.
          english:
            'Cities start mitigating flood damage quickly. Engineers carried the plan out near the river bank with strict criteria, while Grace watched silently.',
          chinese: '城市迅速开始缓解洪水损害。',
        },
      ],
      grammarAndUsageNotes: 'Note ephemeral in grammar notes only does not count.',
    },
    exercises: [],
  };

  // Initial course: sec-01 introduces w-001..w-006; w-007 (ephemeral) is unassigned initially
  const course = makeVocabCourse({
    words,
    dailyPlan: [
      {
        id: 'sec-01',
        dayIndex: 1,
        date: '2026-11-20',
        title: 'Section 1',
        objective: 'Read',
        keyTopics: ['Urban'],
        targetWordIds: ['w-001', 'w-002', 'w-003', 'w-004', 'w-005', 'w-006'],
        lesson: lesson1,
      },
      {
        id: 'sec-02',
        dayIndex: 2,
        date: '2026-11-21',
        title: 'Section 2',
        objective: 'Review',
        keyTopics: ['Review'],
        targetWordIds: [],
        reviewWordIds: ['w-001'],
      },
    ],
  });

  // Prose-only extraction ignores targetWords table & grammar notes
  const extractedProse = extractLessonProseForCoverage(lesson1, 'english');
  assert.equal(extractedProse.includes('ephemeral'), false);

  const formsCriterion = buildEnglishInflectionForms('criterion');
  assert.equal(formsCriterion.has('criteria'), true);

  const cov1 = syncCourseVocabCoverage(course)!;
  // Layer 1 planned: 6 planned, 1 unassigned (w-007 'ephemeral')
  assert.deepEqual(cov1.unassignedWordIds, ['w-007']);
  assert.equal(cov1.plannedWordIds.length, 6);

  // Layer 2 actual before verification:
  // Confirmed: w-001 (mitigating), w-002 (carried ... out), w-005 (criteria)
  // Missing: w-003 (art did NOT match 'start'), w-007 (ephemeral in table/notes only)
  // Uncertain (needs_review): w-004 (bank homograph), w-006 (mid-sentence capitalized Grace)
  assert.deepEqual(cov1.actualCoveredWordIds, ['w-001', 'w-002', 'w-005']);
  assert.deepEqual(cov1.actualUncertainWordIds, ['w-004', 'w-006']);
  assert.deepEqual(cov1.actualUncoveredWordIds, ['w-003', 'w-007']);
  assert.deepEqual(cov1.bySection['sec-01'].missingNewWordIds, ['w-003']);

  // masteredWords was ['mitigate'] initially and must stay untouched (coverage !== mastery)
  assert.deepEqual(course.masteredWords, ['mitigate']);

  // Review prompt lists bank + grace
  const reviewPromptInfo = buildVocabSemanticReviewPrompt(course, 'sec-01');
  assert.equal(reviewPromptInfo.pendingItems.length, 2);

  // Manual rejection for w-004 (river bank !== commercial bank) and confirmation for w-006
  setVocabManualVerification({
    course,
    sectionId: 'sec-01',
    wordId: 'w-004',
    status: 'rejected',
    reviewer: 'manual',
    reason: '正文此处为河岸，不符合商业银行释义',
  });
  const cov2 = setVocabManualVerification({
    course,
    sectionId: 'sec-01',
    wordId: 'w-006',
    status: 'confirmed',
    reviewer: 'ai',
  })!;

  assert.deepEqual(cov2.actualCoveredWordIds, ['w-001', 'w-002', 'w-005', 'w-006']);
  assert.deepEqual(cov2.actualUncertainWordIds, []);
  assert.deepEqual(cov2.actualUncoveredWordIds, ['w-003', 'w-004', 'w-007']);

  // Reassign unassigned + uncovered words (w-003, w-004, w-007) -> lands in sec-02 as new targetWordIds (not demoted to review!)
  const reassignRes = reassignVocabWordsToCourse(course, {
    scope: 'both',
    wordsPerSection: 5,
  });
  assert.equal(reassignRes.reassignedCount, 3);
  assert.deepEqual(course.dailyPlan[1].targetWordIds, ['w-007', 'w-003', 'w-004']);
  // w-001 stays in reviewWordIds and is NOT counted in sec-02 plannedNewWordIds
  assert.deepEqual(reassignRes.coverage!.bySection['sec-02'].plannedNewWordIds, [
    'w-007',
    'w-003',
    'w-004',
  ]);
  assert.deepEqual(reassignRes.coverage!.bySection['sec-02'].plannedReviewWordIds, ['w-001']);

  // Regenerating/editing sec-02 covers w-003, w-004, w-007 plus review word w-001 twice
  course.dailyPlan[1].lesson = {
    dayIndex: 2,
    date: '2026-11-21',
    title: 'Culture and Banking',
    summary: 'Follow up',
    keyPoints: [],
    generatedAt: '2026-11-21T00:00:00.000Z',
    markdownBody: '',
    englishPayload: {
      articleTitle: 'Art and Finance',
      articleMode: 'llm_original',
      grammarAndUsageNotes: '',
      targetWords: [
        { id: 'w-003', word: 'art', meaning: 'n. 艺术' },
        { id: 'w-004', word: 'bank', meaning: 'n. 银行' },
        { id: 'w-007', word: 'ephemeral', meaning: 'adj. 短暂的' },
      ],
      paragraphs: [
        {
          english:
            'The central bank funded modern art despite ephemeral criticism. These grants mitigate volatility and mitigate risk.',
          chinese: '央行资助了现代艺术。',
        },
      ],
    },
    exercises: [],
  };

  const cov3 = syncCourseVocabCoverage(course)!;
  // In sec-02: w-003 (art) and w-007 (ephemeral) confirmed, w-004 (bank) uncertain (homograph again with new snippet!),
  // w-001 (review word) counted as 2 occurrences in matches(review) without counting as planned new word
  assert.deepEqual(cov3.bySection['sec-02'].coveredNewWordIds, ['w-007', 'w-003']);
  const revMatch = cov3.bySection['sec-02'].matches.find((m) => m.wordId === 'w-001');
  assert.equal(revMatch?.role, 'review');
  assert.equal(revMatch?.count, 2);

  // Confirm w-004 in sec-02 -> 100% actual coverage (7/7)
  const cov4 = setVocabManualVerification({
    course,
    sectionId: 'sec-02',
    wordId: 'w-004',
    status: 'confirmed',
  })!;
  assert.equal(cov4.actualCoveredWordIds.length, 7);
  assert.equal(cov4.actualCoverageRate, 100);

  // Deleting sec-02 lesson recalculates coverage cleanly (drops sec-02 covered words)
  course.dailyPlan[1].lesson = undefined;
  const covAfterDelete = syncCourseVocabCoverage(course)!;
  assert.deepEqual(covAfterDelete.actualCoveredWordIds, [
    'w-001',
    'w-002',
    'w-005',
    'w-006',
  ]);
  assert.deepEqual(covAfterDelete.actualUncoveredWordIds, ['w-003', 'w-004', 'w-007']);
});

test('Japanese lesson prose coverage extracts non-Latin body without vocab table false positives', () => {
  const course = makeVocabCourse({
    targetLanguage: 'japanese',
    words: [
      { word: '食べる', meaning: '吃' },
      { word: '電車', meaning: '电车' },
    ],
    dailyPlan: [
      {
        id: 'sec-01',
        dayIndex: 1,
        date: '2026-11-20',
        title: '通勤と食事',
        objective: '日常对话',
        keyTopics: ['会話'],
        targetWordIds: ['w-001', 'w-002'],
        lesson: {
          dayIndex: 1,
          date: '2026-11-20',
          title: '通勤と食事',
          summary: '日常会話',
          keyPoints: [],
          generatedAt: '2026-11-20T00:00:00.000Z',
          markdownBody: [
            '## 語彙リスト',
            '| 単語 | 意味 |',
            '| --- | --- |',
            '| 電車 | 电车 |',
            '',
            '## 本文会話',
            '昨日、友達と一緒にラーメンを食べました。その後、歩いて帰りました。',
          ].join('\n'),
          exercises: [],
        },
      },
    ],
  });

  const cov = syncCourseVocabCoverage(course)!;
  // 食べました matches stem of 食べる; 電車 only appeared in 語彙リスト table so MUST be missing!
  assert.deepEqual(cov.bySection['sec-01'].coveredNewWordIds, ['w-001']);
  assert.deepEqual(cov.bySection['sec-01'].missingNewWordIds, ['w-002']);
});

test('unified language config without targetLanguage auto-detects scripts and adapts prompts cleanly', () => {
  const unifiedCourse = makeVocabCourse({
    words: [
      { word: 'catalyst', meaning: '催化剂' },
      { word: '食べる', meaning: '吃' },
    ],
    dailyPlan: [
      {
        id: 'sec-01',
        dayIndex: 1,
        date: '2026-11-20',
        title: 'Mixed Reading',
        objective: 'Auto script detection',
        keyTopics: ['Reading'],
        targetWordIds: ['w-001', 'w-002'],
        lesson: {
          dayIndex: 1,
          date: '2026-11-20',
          title: 'Mixed Reading',
          summary: 'Mixed',
          keyPoints: [],
          generatedAt: '2026-11-20T00:00:00.000Z',
          markdownBody: 'The catalyst drove change, そして毎日パンを食べます。',
          exercises: [],
        },
      },
    ],
  });
  // Omit explicit targetLanguage (the unified language course format)
  delete unifiedCourse.englishConfig!.targetLanguage;

  const cov = syncCourseVocabCoverage(unifiedCourse)!;
  assert.deepEqual(cov.actualCoveredWordIds, ['w-001', 'w-002']);

  const unifiedPrompt = buildSyllabusUserPrompt({
    name: '跨语种阅读与会话',
    category: 'english',
    learningPurpose: 'interest',
    interestPreferences: '科学史与日常交流',
    goal: '根据课程目标灵活学习',
    durationDays: 5,
    extraRequirements: '',
    materials: [],
    effectiveWords: [],
  });
  assert.match(unifiedPrompt, /自动适配对应语种/);
  assert.match(unifiedPrompt, /多语言模块结构提示/);
  assert.match(unifiedPrompt, /兴趣学习/);
});

test('getGroupedReviewWordsForSlot prioritizes immediately preceding section and works without a vocab bank', () => {
  const sec1Lesson: DailyLessonContent = {
    dayIndex: 1,
    date: '2026-11-18',
    title: 'AI Governance',
    summary: 'Read about AI policy.',
    keyPoints: [],
    generatedAt: '2026-11-18T00:00:00.000Z',
    markdownBody: '## 词汇用法精讲\n...',
    englishPayload: {
      articleTitle: 'Global AI Governance',
      contentOrigin: 'authentic_article',
      sourceReference: 'The Economist',
      publishDate: '2026-11-10',
      sourceUrl: 'https://www.economist.com/example',
      articleMode: 'media_search',
      targetWords: [
        { word: 'oversight', meaning: 'n. 监管' },
        { word: 'deploy', meaning: 'v. 部署' },
      ],
      paragraphs: [{ english: 'Oversight helps teams deploy safely.', chinese: '监管有助于安全部署。' }],
      grammarAndUsageNotes: '',
    },
    exercises: [],
  };

  const sec2Lesson: DailyLessonContent = {
    dayIndex: 2,
    date: '2026-11-19',
    title: 'Grid Resilience',
    summary: 'Read about grids.',
    keyPoints: [],
    generatedAt: '2026-11-19T00:00:00.000Z',
    markdownBody: '## 词汇用法精讲\n...',
    englishPayload: {
      articleTitle: 'Upgrading Power Grids',
      contentOrigin: 'ai_original',
      originNote: 'AI 原创文章（基于近期可靠信息编写）',
      articleMode: 'llm_original',
      targetWords: [
        { word: 'bottleneck', meaning: 'n. 瓶颈' },
        { word: 'oversight', meaning: 'n. 监管', isReview: true },
      ],
      paragraphs: [{ english: 'Grid bottlenecks require oversight.', chinese: '电网瓶颈需要监管。' }],
      grammarAndUsageNotes: '',
    },
    exercises: [],
  };

  const topicOnlyCourse = makeVocabCourse({
    words: [],
    dailyPlan: [
      {
        id: 'sec-01',
        dayIndex: 1,
        date: '2026-11-18',
        topicGroup: '人工智能',
        title: '第 1 讲：AI 监管',
        objective: 'Read authentic article',
        keyTopics: ['AI'],
        lesson: sec1Lesson,
      },
      {
        id: 'sec-02',
        dayIndex: 2,
        date: '2026-11-19',
        topicGroup: '能源科技',
        title: '第 2 讲：电网韧性',
        objective: 'Read energy article',
        keyTopics: ['Energy'],
        lesson: sec2Lesson,
      },
      {
        id: 'sec-03',
        dayIndex: 3,
        date: '2026-11-20',
        topicGroup: '全球商业',
        title: '第 3 讲：供应链重塑',
        objective: 'Analyze recent supply chain shifts',
        keyTopics: ['Business'],
      },
    ],
  });

  const grouped = getGroupedReviewWordsForSlot(topicOnlyCourse, 2);
  // Section 2 introduced 'bottleneck' (and skipped 'oversight' with isReview: true), so prevSectionWords puts bottleneck first
  assert.deepEqual(
    grouped.prevSectionWords.map((w) => w.word),
    ['bottleneck']
  );
  // Section 1 introduced 'oversight' and 'deploy', which appear in earlierReviewWords
  assert.deepEqual(
    grouped.earlierReviewWords.map((w) => w.word),
    ['oversight', 'deploy']
  );

  const combined = getEligibleReviewWordsForSlot(topicOnlyCourse, 2);
  assert.equal(combined[0]?.word, 'bottleneck');
});

test('parseImportedLessonContent preserves article origin metadata and extended vocab fields', () => {
  const slot = {
    id: 'sec-01',
    dayIndex: 1,
    date: '2026-11-20',
    title: '第 1 节',
    objective: '阅读原文并掌握核心搭配',
    keyTopics: ['Tech'],
  };
  const parsed = parseImportedLessonContent(
    JSON.stringify({
      sectionId: 'sec-01',
      generationStage: 'complete',
      title: 'Chip Architecture Shifts',
      summary: 'Summary',
      keyPoints: ['Main idea'],
      markdownBody: '## 词汇用法精讲\n...',
      englishPayload: {
        articleTitle: 'Chip Architecture Shifts',
        contentOrigin: 'authentic_article',
        sourceReference: 'MIT Technology Review',
        publishDate: '2026-11-05',
        sourceUrl: 'https://www.technologyreview.com/2026/11/05/example',
        originNote: '完整精选原文转载',
        articleMode: 'media_search',
        targetWords: [
          {
            id: 'w-001',
            word: 'bottleneck',
            phonetic: '/ˈbɒtlnek/',
            meaning: 'n. 瓶颈',
            usageNote: '常用于形容算力、产能或供应链中的关键阻塞环节',
            collocations: ['supply-chain bottleneck', 'ease the bottleneck'],
            example: 'Memory bandwidth has become the primary bottleneck.',
            exampleTranslation: '内存带宽已成为主要瓶颈。',
            isReview: true,
          },
        ],
        paragraphs: [{ english: 'Memory bandwidth remains a bottleneck.', chinese: '内存带宽仍是瓶颈。' }],
        grammarAndUsageNotes: '',
      },
      exercises: [],
    }),
    slot,
    'chat'
  );

  const payload = parsed.lesson.englishPayload!;
  assert.equal(payload.contentOrigin, 'authentic_article');
  assert.equal(payload.publishDate, '2026-11-05');
  assert.equal(payload.sourceUrl, 'https://www.technologyreview.com/2026/11/05/example');
  assert.equal(payload.originNote, '完整精选原文转载');
  assert.equal(payload.targetWords[0].usageNote, '常用于形容算力、产能或供应链中的关键阻塞环节');
  assert.deepEqual(payload.targetWords[0].collocations, [
    'supply-chain bottleneck',
    'ease the bottleneck',
  ]);
  assert.equal(payload.targetWords[0].isReview, true);

  const adaptedParsed = parseImportedLessonContent(
    JSON.stringify({
      sectionId: 'sec-02',
      generationStage: 'complete',
      title: 'Adapted Article Test',
      summary: 'Adapted',
      keyPoints: [],
      markdownBody: '## 词汇用法精讲\n...',
      englishPayload: {
        articleTitle: 'Adapted Tech Report',
        contentOrigin: 'adapted_article',
        sourceReference: 'The Guardian',
        publishDate: '2026-11-10',
        sourceUrl: 'https://www.theguardian.com/example',
        originNote: '基于近期真实原文改写并加入词汇',
        articleMode: 'media_search',
        targetWords: [],
        paragraphs: [{ english: 'Adapted text.', chinese: '改写段落。' }],
        grammarAndUsageNotes: '',
      },
      exercises: [],
    }),
    slot,
    'chat'
  );
  assert.equal(adaptedParsed.lesson.englishPayload?.contentOrigin, 'adapted_article');
});

test('redesigned English reading prompts cover 6 reading-first requirements across API/Chat/Agent with zero STEM leakage', () => {
  const words: VocabItem[] = [
    { id: 'w-001', word: 'catalyst', meaning: 'n. 催化剂；促成因素' },
    { id: 'w-002', word: 'resilient', meaning: 'adj. 有韧性的；适应力强的' },
  ];
  const slot1 = {
    id: 'sec-01',
    dayIndex: 1,
    date: '2026-11-19',
    topicGroup: '人工智能与商业',
    title: '第 1 讲：AI 催化商业创新',
    objective: '理解文章主旨并掌握 catalyst',
    keyTopics: ['AI', 'Business'],
    targetWordIds: ['w-001'],
  };
  const slot2 = {
    id: 'sec-02',
    dayIndex: 2,
    date: '2026-11-20',
    topicGroup: '全球供应链',
    title: '第 2 讲：有韧性的全球供应链',
    objective: '理解文章论证与长难句并掌握 resilient',
    keyTopics: ['Supply Chain', 'Resilience'],
    targetWordIds: ['w-002'],
  };
  const course = makeVocabCourse({
    words,
    learningPurpose: 'interest',
    dailyPlan: [slot1, slot2],
  });

  const sysPrompt = composeCoursewareSystemPrompt({
    subjectProfile: 'english_language',
    targetLanguage: 'english',
    learningPurpose: 'interest',
    learnerBaseline: 'partial_base',
    learningDepth: 'master_textbook',
  });
  assert.match(sysPrompt, /完整英文文章为主体，词汇理解与实际运用为辅助/);
  assert.match(sysPrompt, /先阅读、后讲解、再练习/);
  assert.match(sysPrompt, /最近一个月内/);
  assert.match(sysPrompt, /3～5 道/);
  assert.match(sysPrompt, /1～3 个/);
  assert.doesNotMatch(sysPrompt, /R_f|wavedrom|circuit|diagramSpec|物理图像|无跳步推导/);

  const apiPrompt = buildEnglishLessonUserPrompt({
    course,
    slot: slot2,
    prevSlot: slot1,
    targetWords: [words[1]],
    articleMode: 'media_search',
    preferredSources: 'The Economist, MIT Technology Review',
    materialContext: '',
  });
  const chatPrompt = buildChatLessonStage1Prompt({
    course,
    slot: slot2,
    teachingSystemPrompt: sysPrompt,
  });
  const chatFallbackPrompt = buildChatLessonPrompt({
    course,
    slot: slot2,
    teachingSystemPrompt: sysPrompt,
  });
  const agentSectionPrompt = buildAgentSectionStagePrompt({
    course,
    slot: slot2,
    workspaceDir: 'courses/test-lang',
    stage: 'stage1',
    teachingSystemPrompt: sysPrompt,
  });
  const agentBatchPrompt = buildAgentExecutionPrompt({
    course,
    workspaceDir: 'courses/test-lang',
    materialFilePaths: [],
    teachingSystemPrompt: sysPrompt,
  });

  assert.equal(chatPrompt, chatFallbackPrompt);

  for (const [label, promptText] of [
    ['API', apiPrompt],
    ['Chat', chatPrompt],
    ['Agent-Section', agentSectionPrompt],
    ['Agent-Batch', agentBatchPrompt],
  ] as const) {
    assert.match(promptText, /最近一个月内/, `${label} missing 1-month search requirement`);
    assert.match(promptText, /authentic_article/, `${label} missing authentic_article tier`);
    assert.match(promptText, /两篇/, `${label} missing two-short-articles guidance`);
    assert.match(promptText, /均衡|最长/, `${label} missing balanced-option-length guidance`);
    assert.match(promptText, /adapted_article/, `${label} missing adapted_article tier`);
    assert.match(promptText, /ai_original/, `${label} missing ai_original fallback tier`);
    assert.match(promptText, /3～5/, `${label} missing 3~5 reading comprehension`);
    assert.match(promptText, /1～3/, `${label} missing 1~3 complex sentences`);
    assert.match(promptText, /contentOrigin/, `${label} missing contentOrigin schema`);
    assert.match(promptText, /sourceUrl/, `${label} missing sourceUrl schema`);
    assert.match(promptText, /catalyst/, `${label} missing previous section review word`);
    assert.doesNotMatch(promptText, /反馈电阻|wavedrom|plot2d|stage1\.json/, `${label} leaked STEM instructions`);
  }
});

function makeStep2TestSlot(params: {
  title: string;
  targetWordIds: string[];
  lesson: DailyLessonContent;
}) {
  return {
    id: 'sec-01',
    dayIndex: 1,
    date: '2026-11-20',
    title: params.title,
    objective: 'Read authentic article and expand contextual vocabulary',
    keyTopics: ['space', 'reading'],
    focus: 'space',
    targetWordIds: params.targetWordIds,
    lesson: params.lesson,
  };
}

function makeStep2TestCourse(params: {
  id: string;
  effectiveWords: VocabItem[];
  dailyPlan: ReturnType<typeof makeStep2TestSlot>[];
  learnerBaseline?: Course['learnerBaseline'];
  customLearnerBaseline?: string;
  learnerLevel?: Course['learnerLevel'];
  generationMode?: Course['generationMode'];
  articleMode?: 'media_search' | 'llm_original';
}): Course {
  return {
    id: params.id,
    name: '英语测试课程',
    category: 'english',
    goal: '阅读与词汇',
    generationMode: params.generationMode || 'chat',
    learnerBaseline: params.learnerBaseline,
    customLearnerBaseline: params.customLearnerBaseline,
    learnerLevel: params.learnerLevel,
    courseDirPath: `courses/${params.id}`,
    startDate: '2026-11-20',
    durationDays: 1,
    extraRequirements: '',
    materials: [],
    masteredWords: [],
    exerciseSubmissions: {},
    englishConfig: {
      targetBankName: 'Test Bank',
      excludedBankName: 'None',
      totalTargetCount: params.effectiveWords.length,
      excludedCount: 0,
      effectiveWords: params.effectiveWords,
      dailyWordCount: 1,
      articleMode: params.articleMode || 'media_search',
      preferredSources: 'The Guardian',
      targetLanguage: 'english',
    },
    dailyPlan: params.dailyPlan,
    createdAt: '2026-11-20T00:00:00Z',
  };
}

test('isPlaceholderVocabMeaning and isWeakBaselineForVocabSimplification classify placeholders and weak baselines accurately', () => {
  assert.equal(isPlaceholderVocabMeaning(''), true);
  assert.equal(isPlaceholderVocabMeaning('  '), true);
  assert.equal(isPlaceholderVocabMeaning('待结合语境学习'), true);
  assert.equal(isPlaceholderVocabMeaning('（待补充释义）'), true);
  assert.equal(isPlaceholderVocabMeaning('N/A'), true);
  assert.equal(isPlaceholderVocabMeaning('adj. 深远的'), false);

  const baseCourse = makeStep2TestCourse({
    id: 'c-weak-test',
    effectiveWords: [],
    dailyPlan: [],
  });

  assert.equal(
    isWeakBaselineForVocabSimplification({ ...baseCourse, learnerBaseline: 'zero_base' }),
    true
  );
  assert.equal(
    isWeakBaselineForVocabSimplification({
      ...baseCourse,
      learnerBaseline: 'custom',
      customLearnerBaseline: '词汇量很少，基础很差',
    }),
    true
  );
  assert.equal(
    isWeakBaselineForVocabSimplification({ ...baseCourse, learnerBaseline: 'partial_base' }),
    false
  );
  assert.equal(
    isWeakBaselineForVocabSimplification({ ...baseCourse, learnerBaseline: 'solid_base' }),
    false
  );
  assert.equal(
    isWeakBaselineForVocabSimplification({ ...baseCourse, learnerLevel: 'beginner' }),
    true
  );
});

test('Step 2 pending gloss extraction, multi-format parsing, gloss-only merge, and associated vocab stats recount', () => {
  const effectiveWords = assignStableVocabIds([
    { word: 'velocity', meaning: 'n. 速度' },
    { word: 'profound', meaning: '待结合语境学习' },
    { word: 'collide', meaning: '待结合语境学习' },
    { word: 'curated', meaning: 'adj. 精选的' },
  ]);
  const velocityId = effectiveWords[0].id!;
  const profoundId = effectiveWords[1].id!;
  const collideId = effectiveWords[2].id!;

  const lesson: DailyLessonContent = {
    sectionId: 'sec-01',
    dayIndex: 1,
    date: '2026-11-20',
    title: 'Mercury Orbit',
    summary: 'Space probe reading',
    keyPoints: ['orbital mechanics'],
    markdownBody: '### 重点词\n- velocity',
    exercises: [],
    generatedAt: '2026-11-20T01:00:00Z',
    englishPayload: {
      articleTitle: 'Mercury Orbit',
      contentOrigin: 'adapted_article',
      articleMode: 'media_search',
      targetWords: [{ id: velocityId, word: 'velocity', meaning: 'n. 速度；速率' }],
      paragraphs: [
        {
          english:
            'The probe shed excess velocity as profound instruments avoided particles that collide with the curated shield.',
          chinese: '探测器降低速度。',
        },
      ],
      grammarAndUsageNotes: '',
    },
  };

  const slot = makeStep2TestSlot({
    title: 'Mercury Orbit',
    targetWordIds: [velocityId],
    lesson,
  });

  const course = makeStep2TestCourse({
    id: 'c-step2-gloss',
    learnerBaseline: 'partial_base',
    effectiveWords,
    dailyPlan: [slot],
  });

  const statsBefore = computeSectionAssociatedVocabStats(course, slot, lesson);
  assert.equal(statsBefore.plannedNewCount, 1);
  assert.equal(statsBefore.associatedWordCount, 3); // profound, collide, curated
  assert.equal(statsBefore.pendingGlossCount, 2); // curated already has non-placeholder bank meaning

  const pending = extractPendingGlossWordsForSection(course, slot, lesson);
  assert.deepEqual(
    pending.map((p) => p.word),
    ['profound', 'collide']
  );

  // Test compact pipe format + JSON map format
  const parsedPipe = parseImportedWordGlosses(
    `${profoundId} | profound | /prəˈfaʊnd/ | adj. 深远的\ncollide: v. 碰撞`,
    pending
  );
  assert.equal(parsedPipe.length, 2);
  assert.equal(parsedPipe[0].id, profoundId);
  assert.equal(parsedPipe[1].id, collideId);

  const parsedJson = parseImportedStep2EnglishOutput(
    JSON.stringify({
      extraWordGlosses: [
        { id: profoundId, word: 'profound', phonetic: '/prəˈfaʊnd/', meaning: 'adj. 深远的' },
        { id: collideId, word: 'collide', meaning: 'v. 碰撞；相撞' },
      ],
    }),
    pending
  );
  assert.equal(parsedJson.extraWordGlosses.length, 2);

  const parsedDirectGloss = mergeExtraWordGlossesIntoLesson(
    lesson,
    [{ id: profoundId, word: 'profound', phonetic: '/prəˈfaʊnd/', meaning: 'adj. 深远的' }],
    course
  );
  assert.equal(parsedDirectGloss.englishPayload?.extraWordGlosses?.length, 1);

  const enhanced = applyStep2EnglishEnhancementToLesson({
    course,
    slot,
    lesson,
    parsed: parsedJson,
    allowSynonymReplacement: false,
  });

  // Prose remains untouched in gloss-only mode
  assert.equal(
    enhanced.lesson.englishPayload?.paragraphs[0].english,
    lesson.englishPayload?.paragraphs[0].english
  );
  assert.equal(enhanced.afterStats.pendingGlossCount, 0);
  assert.equal(enhanced.afterStats.glossedExtraCount, 2);
  assert.equal(enhanced.afterStats.associatedWordCount, 3);
  assert.equal(enhanced.lesson.englishPayload?.step2VocabStats?.associatedWordCountBefore, 3);
  assert.equal(enhanced.lesson.englishPayload?.step2VocabStats?.synonymReplacementEnabled, false);
});

test('Weak-baseline synonym simplification recounts associated words, records replacements, and reverts edits that drop planned new words', () => {
  const effectiveWords = assignStableVocabIds([
    { word: 'velocity', meaning: 'n. 速度' },
    { word: 'profound', meaning: '待结合语境学习' },
    { word: 'collide', meaning: '待结合语境学习' },
  ]);
  const velocityId = effectiveWords[0].id!;
  const profoundId = effectiveWords[1].id!;
  const collideId = effectiveWords[2].id!;

  const lesson: DailyLessonContent = {
    sectionId: 'sec-01',
    dayIndex: 1,
    date: '2026-11-20',
    title: 'Solar Craft',
    summary: 'Simple orbit',
    keyPoints: [],
    markdownBody: '',
    exercises: [],
    generatedAt: '2026-11-20T01:00:00Z',
    englishPayload: {
      articleTitle: 'Solar Craft',
      contentOrigin: 'ai_original',
      articleMode: 'llm_original',
      targetWords: [{ id: velocityId, word: 'velocity', meaning: 'n. 速度' }],
      paragraphs: [
        {
          english: 'A profound change in velocity helps astronauts steer.',
          chinese: '速度的深刻变化帮助宇航员操控。',
        },
        {
          english: 'Small rocks may collide in deep space.',
          chinese: '小岩石可能在深空碰撞。',
        },
      ],
      grammarAndUsageNotes: '',
    },
  };

  const slot = makeStep2TestSlot({
    title: 'Solar Craft',
    targetWordIds: [velocityId],
    lesson,
  });

  const course = makeStep2TestCourse({
    id: 'c-weak-simplify',
    learnerBaseline: 'zero_base',
    generationMode: 'api',
    articleMode: 'llm_original',
    effectiveWords,
    dailyPlan: [slot],
  });

  // Case A: Paragraph 0 drops planned target word 'velocity' -> MUST revert; Paragraph 1 simplifies 'collide' -> 'hit'
  const parsedUnsafe = parseImportedStep2EnglishOutput(
    JSON.stringify({
      paragraphUpdates: [
        { index: 0, english: 'A big change in speed helps astronauts steer.' }, // accidentally removed velocity!
        { index: 1, english: 'Small rocks may hit each other in deep space.' }, // simplified collide -> hit
      ],
      synonymReplacements: [
        { paragraphIndex: 0, originalWord: 'profound', originalWordId: profoundId, replacedWith: 'big' },
        { paragraphIndex: 1, originalWord: 'collide', originalWordId: collideId, replacedWith: 'hit' },
      ],
      extraWordGlosses: [
        { id: profoundId, word: 'profound', meaning: 'adj. 深刻的' },
      ],
    })
  );

  const res = applyStep2EnglishEnhancementToLesson({
    course,
    slot,
    lesson,
    parsed: parsedUnsafe,
    allowSynonymReplacement: true,
  });

  // Paragraph 0 reverted to protect 'velocity'; Paragraph 1 simplified cleanly
  assert.equal(
    res.lesson.englishPayload?.paragraphs[0].english,
    'A profound change in velocity helps astronauts steer.'
  );
  assert.equal(
    res.lesson.englishPayload?.paragraphs[1].english,
    'Small rocks may hit each other in deep space.'
  );
  assert.equal(res.rejectedParagraphEdits.length, 1);
  assert.equal(res.rejectedParagraphEdits[0].paragraphIndex, 0);
  // Before: 2 associated words (profound + collide); After: 1 associated word (profound kept in P0)
  assert.equal(res.beforeStats.associatedWordCount, 2);
  assert.equal(res.afterStats.associatedWordCount, 1);
  assert.equal(res.afterStats.plannedNewCount, 1);
  assert.equal(res.lesson.englishPayload?.step2VocabStats?.associatedWordCountBefore, 2);
  assert.equal(res.lesson.englishPayload?.step2VocabStats?.associatedWordCount, 1);
  assert.equal(res.lesson.englishPayload?.synonymReplacements?.length, 1);
  assert.equal(res.lesson.englishPayload?.synonymReplacements?.[0].originalWord, 'collide');
});

test('Step 2 prompts and sanitizeLessonCitations handle gloss-only, weak-baseline simplification, Agent stage2, and citation cleanup', () => {
  const effectiveWords = assignStableVocabIds([
    { word: 'velocity', meaning: 'n. 速度' },
    { word: 'profound', meaning: '待结合语境学习' },
  ]);
  const lesson: DailyLessonContent = {
    sectionId: 'sec-01',
    dayIndex: 1,
    date: '2026-11-20',
    title: 'Solar Craft',
    summary: 'Orbit reading',
    keyPoints: [],
    markdownBody: '',
    exercises: [],
    generatedAt: '2026-11-20T01:00:00Z',
    englishPayload: {
      articleTitle: 'Solar Craft',
      contentOrigin: 'adapted_article',
      articleMode: 'media_search',
      targetWords: [{ id: effectiveWords[0].id, word: 'velocity', meaning: 'n. 速度' }],
      extraWordGlosses: [{ id: effectiveWords[1].id, word: 'profound', meaning: 'adj. 深远的 [cite: 2]' }],
      synonymReplacements: [
        { paragraphIndex: 0, originalWord: 'collide', replacedWith: 'hit [cite: 3]', reason: '简化 [cite: 4]' },
      ],
      step2VocabStats: {
        updatedAt: '2026-11-20T01:00:00Z',
        proseWordCount: 10,
        plannedNewCount: 1,
        reviewWordCount: 0,
        associatedWordCountBefore: 2,
        associatedWordCount: 1,
        associatedOccurrences: 1,
        associatedDensityPercent: 10,
        totalBankWordCount: 2,
        glossedExtraCount: 1,
        pendingGlossCount: 0,
        synonymReplacementEnabled: true,
        replacedCount: 1,
      },
      paragraphs: [{ english: 'Profound changes in velocity matter.', chinese: '深刻的变化很重要。' }],
      grammarAndUsageNotes: '',
    },
  };

  const sanitized = sanitizeLessonCitations(lesson);
  assert.equal(sanitized.englishPayload?.extraWordGlosses?.[0].meaning, 'adj. 深远的');
  assert.equal(sanitized.englishPayload?.synonymReplacements?.[0].replacedWith, 'hit');
  assert.equal(sanitized.englishPayload?.synonymReplacements?.[0].reason, '简化');
  assert.equal(sanitized.englishPayload?.step2VocabStats?.associatedWordCountBefore, 2);

  // Build prompt on pre-gloss lesson
  const preGlossLesson: DailyLessonContent = {
    ...lesson,
    englishPayload: {
      ...lesson.englishPayload!,
      extraWordGlosses: [],
      synonymReplacements: [],
      step2VocabStats: undefined,
    },
  };
  const slot = makeStep2TestSlot({
    title: 'Solar Craft',
    targetWordIds: [effectiveWords[0].id!],
    lesson: preGlossLesson,
  });
  const weakCourse = makeStep2TestCourse({
    id: 'c-prompt-test',
    learnerBaseline: 'zero_base',
    generationMode: 'agent',
    effectiveWords,
    dailyPlan: [slot],
  });

  const glossOnlyChat = buildEnglishStage2WordGlossPrompt({
    course: weakCourse,
    slot,
    lesson: preGlossLesson,
    allowSynonymReplacement: false,
    mode: 'chat',
  });
  assert.match(glossOnlyChat.userPrompt, /严禁改写文章正文/);
  assert.match(glossOnlyChat.userPrompt, /profound/);

  const simplifyChat = buildEnglishStage2WordGlossPrompt({
    course: weakCourse,
    slot,
    lesson: preGlossLesson,
    allowSynonymReplacement: true,
    mode: 'chat',
  });
  assert.match(simplifyChat.userPrompt, /简单同义替换/);
  assert.match(simplifyChat.userPrompt, /受保护词汇.*velocity/);

  const agentStage2 = buildAgentSectionStagePrompt({
    course: weakCourse,
    slot,
    workspaceDir: 'courses/prompt-test',
    stage: 'stage2',
    teachingSystemPrompt: 'test',
  });
  assert.match(agentStage2, /Agent 模式单节 Step 2 补充词义执行指令/);
  assert.match(agentStage2, /agent-diagnostics/);
});

test('extractPendingGlossWordsForSection includes user-marked extraBankWords that appear in prose without meanings', () => {
  const effectiveWords = assignStableVocabIds([{ word: 'velocity', meaning: 'n. 速度' }]);
  const lesson: DailyLessonContent = {
    sectionId: 'sec-01',
    dayIndex: 1,
    date: '2026-11-20',
    title: 'Solar Craft',
    summary: 'Orbit reading',
    keyPoints: [],
    markdownBody: '',
    exercises: [],
    generatedAt: '2026-11-20T01:00:00Z',
    englishPayload: {
      articleTitle: 'Solar Craft',
      contentOrigin: 'authentic_article',
      articleMode: 'media_search',
      targetWords: [{ id: effectiveWords[0].id, word: 'velocity', meaning: 'n. 速度' }],
      paragraphs: [
        {
          english: 'Magnetospheric sensors measure velocity with electrostatic precision.',
          chinese: '磁层传感器以静电精度测量速度。',
        },
      ],
      grammarAndUsageNotes: '',
    },
  };
  const slot = makeStep2TestSlot({
    title: 'Solar Craft',
    targetWordIds: [effectiveWords[0].id!],
    lesson,
  });
  const course = makeStep2TestCourse({
    id: 'c-marked-bank',
    effectiveWords,
    dailyPlan: [slot],
  });

  const markedBankWords: VocabItem[] = [
    { id: 'mk-1', word: 'electrostatic', meaning: '待结合语境学习' },
    { id: 'mk-2', word: 'sensors', meaning: 'n. 传感器' },
    {
      id: 'mk-3',
      word: 'precision',
      meaning: '未收录到本节词表，可点击下方「标记生词」加入生词本并在 Step 2 一并查词',
    },
  ];
  const pending = extractPendingGlossWordsForSection(course, slot, lesson, markedBankWords);
  assert.deepEqual(
    pending.map((p) => p.word),
    ['electrostatic', 'precision']
  );
  assert.equal(
    isPlaceholderVocabMeaning(
      '未收录到本节词表，可点击下方「标记生词」加入生词本并在 Step 2 一并查词'
    ),
    true
  );
});

test('resolveEnglishQuoteAnchors resolves {{quote:P1:S2}} dynamically and Step 2 markdownReplacements syncs explanations', () => {
  const paragraphs = [
    {
      english: 'Dr. Smith checked the 3.14 ratio at U.S. labs. Because funding tightened, small teams hit limits quickly.',
      chinese: '史密斯博士在美国实验室核查了3.14的比率。由于资金收紧，小团队很快触及上限。',
    },
    {
      english: 'Newer sensors cut waste.',
      chinese: '新型传感器减少了浪费。',
    },
  ];
  const sents = splitEnglishParagraphSentences(paragraphs[0].english);
  assert.equal(sents.length, 2);
  assert.equal(sents[0], 'Dr. Smith checked the 3.14 ratio at U.S. labs.');
  assert.equal(sents[1], 'Because funding tightened, small teams hit limits quickly.');

  const md = [
    '## 词汇用法精讲',
    '- **tightened** (收紧): 对应原文中的趋势。',
    '',
    '## 长难句解析',
    '> {{quote:P1:S2}}',
    '- 主干：small teams hit limits quickly。',
    '',
    '整段参考：{{quote:P2}}',
  ].join('\n');

  const resolved = resolveEnglishQuoteAnchors(md, paragraphs);
  assert.equal(
    resolved.includes('> Because funding tightened, small teams hit limits quickly.'),
    true
  );
  assert.equal(resolved.includes('整段参考：Newer sensors cut waste.'), true);

  // Verify Step 2 markdownReplacements updates markdownBody when allowSynonymReplacement is true
  const effectiveWords = assignStableVocabIds([{ word: 'velocity', meaning: 'n. 速度' }]);
  const baseLesson: DailyLessonContent = {
    title: 'Lab Update',
    summary: 'Summary',
    keyPoints: [],
    teachingContext: { prerequisites: [], learningObjectives: [] },
    markdownBody: '## 词汇用法精讲\n- **ubiquitous**：无处不在的\n\n## 长难句解析\n> {{quote:P1:S1}}',
    exercises: [],
    generatedAt: '2026-11-20T01:00:00Z',
    englishPayload: {
      articleTitle: 'Lab Update',
      contentOrigin: 'llm_original',
      articleMode: 'llm_original',
      targetWords: [{ id: effectiveWords[0].id, word: 'velocity', meaning: 'n. 速度' }],
      paragraphs: [
        {
          english: 'Sensors are ubiquitous in velocity tests.',
          chinese: '传感器在速度测试中无处不在。',
        },
      ],
      grammarAndUsageNotes: '',
    },
  };
  const slot = makeStep2TestSlot({
    title: 'Lab Update',
    targetWordIds: [effectiveWords[0].id!],
    lesson: baseLesson,
  });
  const course = makeStep2TestCourse({
    id: 'c-md-sync',
    learnerBaseline: 'zero_base',
    effectiveWords,
    dailyPlan: [slot],
  });

  const parsed = parseImportedStep2EnglishOutput(
    JSON.stringify({
      paragraphUpdates: [{ index: 0, english: 'Sensors are common in velocity tests.' }],
      synonymReplacements: [
        { paragraphIndex: 0, originalWord: 'ubiquitous', replacedWith: 'common' },
      ],
      markdownReplacements: [{ from: '**ubiquitous**：无处不在的', to: '**common**：常见的' }],
    })
  );

  const applied = applyStep2EnglishEnhancementToLesson({
    course,
    slot,
    lesson: baseLesson,
    parsed,
    allowSynonymReplacement: true,
  });

  assert.equal(
    applied.lesson.markdownBody?.includes('**common**：常见的'),
    true
  );
  assert.equal(
    resolveEnglishQuoteAnchors(applied.lesson.markdownBody || '', applied.lesson.englishPayload?.paragraphs).includes(
      '> Sensors are common in velocity tests.'
    ),
    true
  );
});
