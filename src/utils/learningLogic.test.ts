import { estimateWrittenLessonMinutes } from './learningLogic';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import {
  addDaysToDateString,
  allocateEnglishWordsRandomly,
  allocateSectionsToDays,
  allocateWordsToDays,
  buildCourseDailySchedule,
  buildDateTimeline,
  computeLearningStats,
  computeVocabCoverageStats,
  computeVocabSetDifference,
  estimateSectionMinutesFallback,
  formatStudyDuration,
  getEvaluatedSectionMinutes,
  getSlotExerciseSubmission,
  gradeExerciseSet,
  gradeSingleExercise,
  parseVocabularyInput,
  sanitizeCourseFolderName,
} from './learningLogic';

const MOCK_BASE_WORDS = Array.from({ length: 10 }, (_, idx) => ({
  word: `baseword${idx + 1}`,
  meaning: `基础词汇${idx + 1}`,
}));

const MOCK_TARGET_WORDS = [
  ...MOCK_BASE_WORDS,
  ...Array.from({ length: 25 }, (_, idx) => ({
    word: `advanced${idx + 1}`,
    meaning: `进阶词汇${idx + 1}`,
  })),
];
import {
  analyzePdfBuffer,
  applyPageOffsetToSplitPlan,
  buildHeuristicPdfSplitPlan,
  createMultiPagePdfBuffer,
  executePdfSplitPlanOnDisk,
  isCorruptedBookmarkTitle,
  parseImportedPdfSplitPlan,
} from './pdfProcessor';
import {
  buildCourseLessonUserPrompt,
  buildEnglishLessonUserPrompt,
  buildPdfSplitPrompts,
  buildSyllabusUserPrompt,
  composeCoursewareSystemPrompt,
  getDefaultPromptsFromSkill,
  getPromptPresetsFromSkill,
  inferSubjectProfile,
} from '../prompts/promptLibrary';

test('sanitizeCourseFolderName handles illegal characters, Chinese names, and duplicate folder avoidance', () => {
  const existing = new Set<string>(['信号与系统']);
  assert.equal(sanitizeCourseFolderName('信号与系统', existing), '信号与系统_2');
  assert.equal(
    sanitizeCourseFolderName('C++ / 操作系统: 导论?*', new Set()),
    'C____操作系统__导论'
  );
  assert.equal(sanitizeCourseFolderName('   ', new Set()), 'course_project');
});

test('vocabulary set difference: target minus base yields exact remaining words', () => {
  const diff = computeVocabSetDifference(MOCK_TARGET_WORDS, MOCK_BASE_WORDS);
  assert.equal(diff.overlapCount, MOCK_BASE_WORDS.length);
  assert.equal(diff.effectiveWords.length, diff.targetTotal - MOCK_BASE_WORDS.length);
  const baseKeys = new Set(MOCK_BASE_WORDS.map((w) => w.word.toLowerCase()));
  for (const item of diff.effectiveWords) {
    assert.equal(baseKeys.has(item.word.toLowerCase()), false);
  }
});

test('allocateEnglishWordsRandomly & computeVocabCoverageStats: random non-repeating draw and preserving started sections', () => {
  const diff = computeVocabSetDifference(MOCK_TARGET_WORDS, MOCK_BASE_WORDS);

  const coverageOk = computeVocabCoverageStats(diff.effectiveWords.length, 4, 5);
  assert.equal(coverageOk.isExceedingCapacity, false);
  assert.equal(coverageOk.plannedTotal, 20);

  const coverageOverflow = computeVocabCoverageStats(diff.effectiveWords.length, 10, 20);
  assert.equal(coverageOverflow.isExceedingCapacity, true);

  const initialAlloc = allocateEnglishWordsRandomly({
    effectiveWords: diff.effectiveWords,
    durationDays: 3,
    dailyWordCount: 5,
    seedStr: 'seed-42',
  });
  assert.equal(initialAlloc.buckets.length, 3);
  assert.equal(initialAlloc.buckets[0].length, 5);
  assert.equal(initialAlloc.buckets[1].length, 5);
  assert.equal(initialAlloc.buckets[2].length, 5);

  // Verify no duplicate words across days within the same study cycle
  const allAssignedKeys = initialAlloc.buckets
    .flat()
    .map((w) => w.word.toLowerCase());
  assert.equal(new Set(allAssignedKeys).size, allAssignedKeys.length);

  // Verify re-randomization preserves already-started Day 1 while re-drawing Days 2 and 3
  const existingSlots = [
    {
      id: 'sec-01',
      dayIndex: 1,
      date: '2026-11-11',
      title: 'Day 1',
      objective: 'Obj 1',
      keyTopics: [],
      assignedWords: initialAlloc.buckets[0],
      lesson: {
        sectionId: 'sec-01',
        dayIndex: 1,
        date: '2026-11-11',
        title: 'Day 1 Lesson',
        summary: 'Summary',
        keyPoints: [],
        markdownBody: 'Body',
        exercises: [],
        generatedAt: '2026-11-11T00:00:00Z',
      },
    },
    {
      id: 'sec-02',
      dayIndex: 2,
      date: '2026-11-12',
      title: 'Day 2',
      objective: 'Obj 2',
      keyTopics: [],
      assignedWords: initialAlloc.buckets[1],
    },
    {
      id: 'sec-03',
      dayIndex: 3,
      date: '2026-11-13',
      title: 'Day 3',
      objective: 'Obj 3',
      keyTopics: [],
      assignedWords: initialAlloc.buckets[2],
    },
  ];

  const reAlloc = allocateEnglishWordsRandomly({
    effectiveWords: diff.effectiveWords,
    durationDays: 3,
    dailyWordCount: 5,
    existingSlots,
    preserveStartedSlots: true,
    seedStr: 'seed-999',
  });

  // Day 1 words must remain identical
  assert.deepEqual(
    reAlloc.buckets[0].map((w) => w.word),
    initialAlloc.buckets[0].map((w) => w.word)
  );
  // Still zero duplicates across all 3 days
  const reAllocKeys = reAlloc.buckets.flat().map((w) => w.word.toLowerCase());
  assert.equal(new Set(reAllocKeys).size, reAllocKeys.length);
});

test('PDF smart split plan, printed-to-physical page offset conversion, and lossless local PDF cutting', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-everything-pdf-test-'));
  try {
    const sourcesDir = path.join(tmpDir, 'sources');
    fs.mkdirSync(sourcesDir, { recursive: true });

    const pdfBytes = await createMultiPagePdfBuffer([
      'Cover Page',
      'Preface and Table of Contents\nChapter 1 Linear Systems ........ 1\nChapter 2 Fourier Transform ..... 3',
      'Chapter 1 Linear Systems\nPage 1',
      'Chapter 1 Continued\nPage 2',
      'Chapter 2 Fourier Transform\nPage 3',
      'Chapter 2 Continued\nPage 4',
    ]);
    fs.writeFileSync(path.join(sourcesDir, 'textbook.pdf'), pdfBytes);

    const dailyPlan = [
      {
        id: 'sec-01',
        dayIndex: 1,
        date: '2026-11-11',
        title: '第 1 讲：线性系统基础',
        objective: '掌握线性时不变系统性质',
        keyTopics: ['线性系统'],
      },
      {
        id: 'sec-02',
        dayIndex: 2,
        date: '2026-11-12',
        title: '第 2 讲：傅里叶变换',
        objective: '掌握连续时间傅里叶变换',
        keyTopics: ['傅里叶变换'],
      },
    ];

    const heuristicPlan = buildHeuristicPdfSplitPlan({
      outline: dailyPlan,
      pdfMetas: [
        {
          fileName: 'textbook.pdf',
          totalPages: 6,
          detectedPageOffset: 2,
          tocEntries: [
            { title: 'Chapter 1 Linear Systems', printedPage: 1, physicalPage: 3 },
            { title: 'Chapter 2 Fourier Transform', printedPage: 3, physicalPage: 5 },
          ],
          pages: [
            { physicalPage: 1, textPreview: 'Cover Page' },
            { physicalPage: 2, textPreview: 'TOC' },
            { physicalPage: 3, printedPageHint: 1, textPreview: 'Chapter 1 Page 1' },
            { physicalPage: 4, printedPageHint: 2, textPreview: 'Chapter 1 Page 2' },
            { physicalPage: 5, printedPageHint: 3, textPreview: 'Chapter 2 Page 3' },
            { physicalPage: 6, printedPageHint: 4, textPreview: 'Chapter 2 Page 4' },
          ],
        },
      ],
      globalPageOffset: 2,
    });
    assert.equal(heuristicPlan.length, 2);

    // Test printed-page to physical-page offset conversion:
    // Printed pages 1-2 with offset +2 -> Physical pages 3-4
    const importedPlan = parseImportedPdfSplitPlan(
      JSON.stringify({
        pageOffset: 2,
        splitPlan: [
          {
            sectionId: 'sec-01',
            dayIndex: 1,
            printedStartPage: 1,
            printedEndPage: 2,
            crossRefPages: [2],
            outlineMappingNote: '第一章对应印刷页 1-2（物理页 3-4）',
          },
          {
            sectionId: 'sec-02',
            dayIndex: 2,
            printedStartPage: 3,
            printedEndPage: 4,
            crossRefPages: [],
            outlineMappingNote: '第二章对应印刷页 3-4（物理页 5-6）',
          },
        ],
      }),
      dailyPlan,
      'textbook.pdf',
      6,
      2
    );

    const adjustedPlan = applyPageOffsetToSplitPlan(importedPlan, 2, 6);
    assert.equal(adjustedPlan[0].physicalStartPage, 3);
    assert.equal(adjustedPlan[0].physicalEndPage, 4);
    assert.equal(adjustedPlan[1].physicalStartPage, 5);
    assert.equal(adjustedPlan[1].physicalEndPage, 6);

    // Execute local PDF slicing
    const slicedPlan = await executePdfSplitPlanOnDisk({
      courseDir: tmpDir,
      courseRelDir: 'courses/信号与系统',
      splitPlan: adjustedPlan,
    });

    const seg1 = slicedPlan.find((s) => s.sectionId === 'sec-01');
    assert.equal(Boolean(seg1), true);
    assert.equal(seg1?.status, 'sliced');
    assert.equal(seg1?.segmentRelPath, 'courses/信号与系统/segments/sec-01.pdf');
    assert.equal(seg1?.extractedSegmentText, undefined);
    assert.equal(fs.existsSync(path.join(tmpDir, 'segments', 'sec-01.txt')), false);

    const slicedBytes = fs.readFileSync(path.join(tmpDir, 'segments', 'sec-01.pdf'));
    const slicedDoc = await PDFDocument.load(slicedBytes);
    // Physical pages 3-4 plus crossRefPage 2 = 3 pages in segments/sec-01.pdf
    assert.equal(slicedDoc.getPageCount(), 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('parseVocabularyInput parses multiple formats and deduplicates case-insensitively', () => {
  const raw = `
    # Custom vocabulary list
    alleviate /əˈliːvieɪt/ v. 减轻，缓解
    paradigm, n. 范式
    ALLeVIATE - duplicate entry should be ignored
    resilient  adj. 有韧性的
    ephemeral
  `;
  const parsed = parseVocabularyInput(raw);
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].word, 'alleviate');
  assert.equal(parsed[0].phonetic, '/əˈliːvieɪt/');
  assert.equal(parsed[1].word, 'paradigm');
  assert.equal(parsed[3].word, 'ephemeral');
});

test('allocateWordsToDays distributes words across N days without losing any item', () => {
  const sampleWords = MOCK_TARGET_WORDS.slice(0, 25);
  const buckets = allocateWordsToDays(sampleWords, 5);
  assert.equal(buckets.length, 5);
  const flattened = buckets.flat();
  assert.equal(flattened.length, 25);
  assert.equal(buckets[0].length, 5);
});

test('buildDateTimeline creates continuous chronological timeline across courses', () => {
  const today = '2026-11-11';
  const timelineEmpty = buildDateTimeline([], today);
  assert.equal(timelineEmpty.length, 14);
  assert.equal(timelineEmpty[0].date, '2026-11-11');
  assert.equal(timelineEmpty[0].isToday, true);
  assert.equal(addDaysToDateString(today, 4), '2026-11-15');
});

test('gradeSingleExercise and gradeExerciseSet grade choice and fill questions offline', () => {
  const questions = [
    {
      id: 'q1',
      type: 'choice' as const,
      question: 'What is the derivative of sin(x)?',
      options: ['A. cos(x)', 'B. -cos(x)', 'C. sin(x)', 'D. -sin(x)'],
      answer: 'A',
      explanation: 'd/dx sin(x) = cos(x).',
    },
    {
      id: 'q2',
      type: 'fill' as const,
      question: 'Complete the word meaning to reduce severity: ________',
      answer: 'alleviate / mitigate',
      explanation: 'Both alleviate and mitigate mean to make less severe.',
    },
  ];

  const single1 = gradeSingleExercise(questions[0], 'A. cos(x)');
  assert.equal(single1.isCorrect, true);

  const batchResult = gradeExerciseSet(questions, {
    q1: 'a',
    q2: 'Mitigate.',
  });
  assert.equal(batchResult.score, 2);
  assert.equal(batchResult.total, 2);

  // Fill question marked "我理解了" (selfUnderstood) passes automatically even with empty or different text,
  // while choice questions ignore selfUnderstood.
  assert.equal(gradeSingleExercise(questions[1], '', { selfUnderstood: true }).isCorrect, true);
  assert.equal(gradeSingleExercise(questions[0], 'B', { selfUnderstood: true }).isCorrect, false);
  const understoodBatch = gradeExerciseSet(questions, { q1: 'B', q2: '' }, ['q1', 'q2']);
  assert.equal(understoodBatch.score, 1);
  assert.equal(understoodBatch.details.q1.isCorrect, false);
  assert.equal(understoodBatch.details.q2.isCorrect, true);
});

test('promptLibrary loads modular prompts and PDF split prompts accurately', () => {
  const presets = getPromptPresetsFromSkill();
  assert.equal(presets.length >= 6, true);

  const defaults = getDefaultPromptsFromSkill();
  assert.equal(defaults.syllabusSystemPrompt.includes('最小教学单元'), true);
  assert.equal(defaults.courseSystemPrompt.includes('实际问题'), true);

  assert.equal(inferSubjectProfile('stem', '模拟电子技术基础'), 'electronics_engineering');
  assert.equal(inferSubjectProfile('stem', '高等数学与微积分'), 'math_physics');
  assert.equal(inferSubjectProfile('stem', '操作系统与数据结构'), 'computer_science');

  const composedBeginner = composeCoursewareSystemPrompt({
    subjectProfile: 'math_physics',
    learnerLevel: 'beginner',
  });
  assert.equal(composedBeginner.includes('零基础入门'), true);

  const syllabusPrompt = buildSyllabusUserPrompt({
    name: '信号与系统',
    category: 'stem',
    goal: '掌握拉普拉斯变换与系统稳定性分析',
    durationDays: 15,
    extraRequirements: '多给电路实例',
    materials: [
      {
        id: 'm1',
        fileName: 'ch1.pdf',
        fileSize: 1024,
        extractedText: '第一章 线性时不变系统',
      },
    ],
  });
  assert.equal(syllabusPrompt.includes('信号与系统'), true);
  assert.equal(syllabusPrompt.includes('最小教学单元'), true);
  assert.equal(syllabusPrompt.includes('实际耗时'), true);

  const mockSlot = {
    id: 'sec-02',
    dayIndex: 2,
    scheduledDay: 3,
    date: '2026-11-12',
    title: '第 2 讲：深度负反馈的闭环增益推导',
    objective: '推导 A_f = A / (1 + AF)',
    keyTopics: ['环路增益', '闭环传递函数'],
  };

  const mockCourse = {
    id: 'c1',
    name: '模拟电子技术',
    folderName: '模拟电子技术',
    courseDirPath: 'courses/模拟电子技术',
    category: 'stem' as const,
    generationMode: 'api' as const,
    learnerLevel: 'intermediate' as const,
    subjectProfile: 'electronics_engineering' as const,
    goal: '掌握负反馈放大器',
    startDate: '2026-11-11',
    durationDays: 10,
    extraRequirements: '详细推导传递函数',
    materials: [],
    dailyPlan: [mockSlot],
    masteredWords: [],
    exerciseSubmissions: {},
    createdAt: '2026-11-11T00:00:00Z',
  };

  const pdfSplitPrompts = buildPdfSplitPrompts({
    course: mockCourse,
    pdfMetas: [
      {
        fileName: 'analog_electronics.pdf',
        totalPages: 320,
        detectedPageOffset: 12,
        tocEntries: [{ title: '第 2 章 负反馈放大器', printedPage: 45, physicalPage: 57 }],
        pages: [{ physicalPage: 57, printedPageHint: 45, textPreview: '第 2 章 负反馈放大器' }],
      },
    ],
    courseRelDir: 'courses/模拟电子技术',
  });
  assert.equal(pdfSplitPrompts.chatSplitPrompt.includes('pageOffset'), true);
  assert.equal(pdfSplitPrompts.agentSplitPrompt.includes('scripts/split_pdf.ts'), true);

  const stemPrompt = buildCourseLessonUserPrompt({
    course: mockCourse,
    slot: mockSlot,
    materialContext: '反馈网络系数 F',
  });
  assert.equal(stemPrompt.includes('第 2 节'), true);
  assert.equal(stemPrompt.includes('sec-02'), true);
  assert.equal(stemPrompt.includes('"estimatedMinutes"'), false);
  assert.equal(stemPrompt.includes('2026-11-12'), false);
  assert.equal(stemPrompt.includes('排程第'), false);
  assert.equal(stemPrompt.includes('topologySpec'), true);
  assert.equal(stemPrompt.includes('{{heuristic:hq-1}}'), true);
  assert.equal(stemPrompt.includes('{{diagram:diag-1}}'), true);
  assert.equal(stemPrompt.includes('{{exercise:ex-1}}'), true);
  assert.equal(stemPrompt.includes('intermediateStepsAuditNote'), false);

  const englishPrompt = buildEnglishLessonUserPrompt({
    course: { ...mockCourse, name: '六级外刊精读', category: 'english' },
    slot: mockSlot,
    targetWords: [{ word: 'alleviate', phonetic: '/əˈliːvieɪt/', meaning: 'v. 减轻' }],
    articleMode: 'media_search',
    preferredSources: 'The New Yorker, The Economist',
    materialContext: '',
  });
  assert.equal(englishPrompt.includes('alleviate'), true);
  assert.equal(englishPrompt.includes('sec-02'), true);
  assert.equal(englishPrompt.includes('estimatedMinutes'), false);
  assert.equal(englishPrompt.includes('2026-11-12'), false);
  assert.equal(englishPrompt.includes('排程第'), false);
  assert.equal(englishPrompt.includes('最近一个月内'), true);
  assert.equal(englishPrompt.includes('contentOrigin'), true);
  assert.equal(englishPrompt.includes('sourceUrl'), true);
  assert.equal(englishPrompt.includes('词汇用法精讲'), true);
  assert.equal(englishPrompt.includes('长难句解析'), true);
  assert.equal(englishPrompt.includes('englishPayload'), true);
});

test('Agent Mode & Chat Mode prompts and unified coursewareParser work end-to-end with closed-loop inline anchors', async () => {
  const {
    buildAgentExecutionPrompt,
    buildChatLessonPrompt,
    buildChatSyllabusPrompt,
    composeCoursewareSystemPrompt,
  } = await import('../prompts/promptLibrary');
  const {
    detectUnresolvedImageRefs,
    parseImportedLessonContent,
    parseImportedSyllabusContent,
  } = await import('./coursewareParser');

  const sampleCourse = {
    id: 'course-test-agent',
    name: '电路原理与信号分析',
    folderName: '电路原理与信号分析',
    courseDirPath: 'courses/电路原理与信号分析',
    category: 'stem' as const,
    generationMode: 'agent' as const,
    learnerLevel: 'intermediate' as const,
    subjectProfile: 'electronics_engineering' as const,
    goal: '掌握一阶RC电路暂态响应与拉普拉斯分析',
    startDate: '2026-11-11',
    durationDays: 3,
    extraRequirements: '详细推导微分方程，绘制分阶段电流图',
    materials: [
      {
        id: 'm1',
        fileName: 'rc_circuit.pdf',
        fileSize: 2048,
        extractedText: '一阶 RC 电路零输入响应与零状态响应推导',
        isPdf: true,
        totalPages: 40,
      },
    ],
    dailyPlan: [
      {
        id: 'sec-01',
        dayIndex: 1,
        date: '2026-11-11',
        title: '第 1 讲：RC 一阶电路的暂态物理过程',
        objective: '理解电容电压不能突变的物理原因并建立微分方程',
        prerequisites: ['基尔霍夫定律'],
        teachingScope: '换路定则与微分方程建立',
        connectionNote: '为第 2 讲三要素法打下基础',
        keyTopics: ['换路定则', '时间常数 τ = RC'],
        pdfSegment: {
          sectionId: 'sec-01',
          dayIndex: 1,
          date: '2026-11-11',
          sectionTitle: '第 1 讲：RC 一阶电路的暂态物理过程',
          sourceFileName: 'rc_circuit.pdf',
          physicalStartPage: 5,
          physicalEndPage: 14,
          printedStartPage: 1,
          printedEndPage: 10,
          pageOffset: 4,
          segmentFileName: 'sec-01.pdf',
          segmentRelPath: 'courses/电路原理与信号分析/segments/sec-01.pdf',
          extractedSegmentText: '本节 PDF 提取文字：换路定则与 RC 微分方程',
        },
      },
    ],
    masteredWords: [],
    exerciseSubmissions: {},
    createdAt: '2026-11-11T00:00:00Z',
  };

  const teachingSystemPrompt = composeCoursewareSystemPrompt({
    subjectProfile: 'electronics_engineering',
    learnerLevel: 'intermediate',
  });
  assert.equal(teachingSystemPrompt.includes('先思考后讲解'), true);
  assert.equal(teachingSystemPrompt.includes('教学闭环'), true);
  assert.equal(teachingSystemPrompt.includes('图示同步'), true);
  assert.equal(teachingSystemPrompt.includes('迁移'), true);

  const agentPrompt = buildAgentExecutionPrompt({
    course: sampleCourse,
    workspaceDir: 'courses/电路原理与信号分析',
    materialFilePaths: ['courses/电路原理与信号分析/sources/rc_circuit.pdf'],
    teachingSystemPrompt,
  });
  assert.equal(agentPrompt.includes('courses/电路原理与信号分析/lessons/sec-01.json'), true);
  assert.equal(agentPrompt.includes('segments/sec-01.pdf'), true);
  assert.equal(agentPrompt.includes('"estimatedMinutes"'), false);
  assert.equal(agentPrompt.includes('2026-11-11'), false);
  assert.equal(agentPrompt.includes('计划总天数与起始日'), false);
  assert.equal(agentPrompt.includes('排程第'), false);
  assert.equal(agentPrompt.includes('{{heuristic:hq-1}}'), true);
  assert.equal(agentPrompt.includes('{{diagram:diag-1}}'), true);
  assert.equal(agentPrompt.includes('{{exercise:ex-1}}'), true);
  assert.equal(agentPrompt.includes('intermediateStepsAuditNote'), false);
  assert.equal(agentPrompt.includes('.stage1.json'), true);

  const chatLessonPrompt = buildChatLessonPrompt({
    course: sampleCourse,
    slot: sampleCourse.dailyPlan[0],
    teachingSystemPrompt,
  });
  assert.equal(chatLessonPrompt.includes('sec-01.pdf'), true);
  assert.equal(chatLessonPrompt.includes('sec-01'), true);
  assert.equal(chatLessonPrompt.includes('"estimatedMinutes"'), false);
  assert.equal(chatLessonPrompt.includes('2026-11-11'), false);
  assert.equal(chatLessonPrompt.includes('排程第'), false);
  assert.equal(chatLessonPrompt.includes('换路定则'), true);
  assert.equal(chatLessonPrompt.includes('{{heuristic:hq-1}}'), true);
  assert.equal(chatLessonPrompt.includes('{{diagram:diag-1}}'), true);
  assert.equal(chatLessonPrompt.includes('{{exercise:ex-1}}'), true);

  const chatSyllabusPrompt = buildChatSyllabusPrompt({ course: sampleCourse });
  assert.equal(chatSyllabusPrompt.includes('knowledgeCatalog'), true);
  assert.equal(chatSyllabusPrompt.includes('最小教学单元'), true);
  assert.equal(chatSyllabusPrompt.includes('本步骤暂不按天排期'), true);

  const rawChatResponse = `下面是为您生成的第 1 讲完整课件：
\`\`\`json
{
  "sectionId": "sec-01",
  "dayIndex": 1,
  "date": "2026-11-11",
  "title": "第 1 讲：RC 一阶电路的暂态物理过程与时间常数",
  "summary": "从去耦电容与延时电路引入，推导一阶微分方程 $RC \\\\frac{du_C}{dt} + u_C = U_S$。",
  "keyPoints": ["换路定则", "时间常数 $\\\\tau = RC$"],
  "markdownBody": "## 一、换路定则与能量连续性\\n在数字芯片供电引脚旁总要并联去耦电容。参见实验波形 ![RC充放电波形](rc_waveform.png)。\\n{{heuristic:hq-1}}\\n{{diagram:diag-1}}\\n$$RC \\\\frac{du_C(t)}{dt} + u_C(t) = U_S$$\\n{{exercise:ex-1}}",
  "diagrams": [
    {
      "id": "diag-1",
      "title": "图 1.1：RC 阶跃响应电流与极性标注",
      "stageLabel": "阶段一：换路瞬间 t = 0+",
      "caption": "标注了 u_C(t) 极性与参考电流 i_C(t) 方向",
      "svgCode": "<svg viewBox=\\"0 0 680 240\\"><text x=\\"20\\" y=\\"40\\">i_C(t)</text></svg>"
    }
  ],
  "heuristicQuestions": [
    {
      "id": "hq-1",
      "context": "换路定则物理前提",
      "question": "如果电容两端电压在 t=0 瞬间发生有限跃变，电路中的电流会发生什么反常现象？",
      "hint": "回忆电容的本构关系 i_C = C du_C / dt。",
      "approach": "分析当 dt -> 0 而 du_C 有限时，导数 du_C/dt 的极限行为及功率 P = u i。",
      "answerReveal": "若电压突变，则 du_C/dt 趋于无穷大，要求电源瞬间提供无穷大功率，这在有限功率物理系统中不可能发生。"
    }
  ],
  "exercises": [
    {
      "id": "ex-1",
      "stage": "inline",
      "type": "choice",
      "difficulty": "basic",
      "categoryLabel": "概念辨析",
      "question": "在无冲激源的 RC 电路中，换路瞬间 $t=0_+$ 保持连续不突变的物理量是：",
      "options": ["A. 电容电压 $u_C$", "B. 电容电流 $i_C$", "C. 电阻电压 $u_R$", "D. 电容吸收功率 $p_C$"],
      "answer": "A",
      "hint": "判断哪个物理量直接对应电场储能 $W_e = \\\\frac{1}{2}Cu_C^2$。",
      "explanation": "电容电场能量不能突变，因此电容电压 $u_C(0_+) = u_C(0_-)$；而电流 $i_C$ 可以发生突变。",
      "wrongOptionsAnalysis": "B/C/D 均与支路瞬时电流相关，换路瞬间回路压降跳变会导致电流突变。"
    },
    {
      "id": "ex-2",
      "stage": "comprehensive",
      "type": "fill",
      "difficulty": "comprehensive",
      "categoryLabel": "知识迁移",
      "diagramId": "diag-ex-2",
      "svgCode": "<svg viewBox=\\"0 0 560 220\\"><text x=\\"20\\" y=\\"40\\">R_4</text></svg>",
      "diagramTitle": "图 ex-2：三输入加减运算电路",
      "question": "若 $R = 2\\\\text{ k}\\\\Omega, C = 5\\\\text{ }\\\\mu\\\\text{F}$，则该一阶电路的时间常数 $\\\\tau$ 为 ________ ms。",
      "answer": "10",
      "hint": "注意单位换算：$\\\\text{k}\\\\Omega \\\\times \\\\mu\\\\text{F} = 10^3 \\\\times 10^{-6}\\\\text{ s} = 10^{-3}\\\\text{ s} = 1\\\\text{ ms}$。",
      "explanation": "$\\\\tau = RC = 2 \\\\times 10^3 \\\\times 5 \\\\times 10^{-6}\\\\text{ s} = 0.01\\\\text{ s} = 10\\\\text{ ms}$。"
    }
  ],
  "qualityCheck": {
    "coveredPoints": ["换路定则", "时间常数 τ = RC"],
    "formulaAndUnitNote": "已核对 RC 量纲为秒 (s)",
    "derivationContinuityNote": "从 KVL 与电容本构方程连续推导一阶常微分方程",
    "diagramAlignmentNote": "图 diag-1 已内联置于换路定则讲解处",
    "intermediateStepsAuditNote": "已独立验算微分方程正负号、时间常数数量级换算及两道练习题答案，中间推理无跳步或隐含假设遗漏"
  }
}
\`\`\``;

  assert.equal(chatLessonPrompt.includes('复杂题设'), true);
  assert.equal(chatLessonPrompt.includes('diagramId'), true);

  const parsedResult = parseImportedLessonContent(
    rawChatResponse,
    sampleCourse.dailyPlan[0],
    'chat',
    {}
  );
  assert.equal(parsedResult.lesson.sectionId, 'sec-01');
  assert.deepEqual(parsedResult.unresolvedImageRefs, ['rc_waveform.png']);
  assert.equal(parsedResult.lesson.diagrams?.[0]?.id, 'diag-1');
  assert.equal(parsedResult.lesson.diagrams?.[1]?.id, 'diag-ex-2');
  assert.equal(
    parsedResult.lesson.heuristicQuestions?.[0]?.approach?.includes('du_C/dt'),
    true
  );
  assert.equal(parsedResult.lesson.exercises[0].stage, 'inline');
  assert.equal(parsedResult.lesson.exercises[0].hint?.includes('电场储能'), true);
  assert.equal(parsedResult.lesson.exercises[1].stage, 'comprehensive');
  assert.equal(parsedResult.lesson.exercises[1].diagramId, 'diag-ex-2');
  assert.equal(parsedResult.lesson.exercises[1].svgCode?.includes('<svg'), true);
  assert.equal(
    parsedResult.lesson.qualityCheck?.intermediateStepsAuditNote?.includes('独立验算'),
    true
  );

  // Verify syllabus import preserves already-generated lessons AND stable section IDs + pdfSegment
  const existingSlotsWithLesson = [
    {
      ...sampleCourse.dailyPlan[0],
      lesson: parsedResult.lesson,
    },
  ];
  const syllabusImported = parseImportedSyllabusContent(
    JSON.stringify({
      knowledgeCatalog: [],
      days: [
        { id: 'sec-01', dayIndex: 1, title: '第 1 讲（更新标题）', objective: '新目标', keyTopics: ['换路定则'] },
        { id: 'sec-02', dayIndex: 2, title: '第 2 讲：三要素法', objective: '掌握三要素公式', keyTopics: ['三要素法'] },
        { id: 'sec-03', dayIndex: 3, title: '第 3 讲：阶跃响应', objective: '掌握单位阶跃响应', keyTopics: ['阶跃响应'] },
      ],
    }),
    '2026-11-11',
    3,
    existingSlotsWithLesson
  );
  assert.equal(syllabusImported.dailyPlan.length, 3);
  assert.equal(Boolean(syllabusImported.dailyPlan[0].lesson), true);
  assert.equal(
    syllabusImported.dailyPlan[0].pdfSegment?.segmentRelPath,
    'courses/电路原理与信号分析/segments/sec-01.pdf'
  );
  assert.equal(detectUnresolvedImageRefs('![pic](https://example.com/a.png)').length, 0);
});

test('isCorruptedBookmarkTitle rejects corrupted glyph titles while keeping readable bookmarks', () => {
  assert.equal(isCorruptedBookmarkTitle('2.08 k,SsS_R0-50vkO|ep0 VN:Rv_QeOS|epQ\\,b@NN:'), true);
  assert.equal(isCorruptedBookmarkTitle('6.1 Wg,{u5 281 _QR=500 k (2) NW0cS,R{,N~SN:S'), true);

  assert.equal(isCorruptedBookmarkTitle('第 6 章 放大电路中的反馈与稳定性分析'), false);
  assert.equal(isCorruptedBookmarkTitle('Chapter 6 Feedback Amplifiers and Stability'), false);
});

test('analyzePdfBuffer returns structural metadata only (zero text extraction) and preserves regionId across Step 1 & Step 2', async () => {
  const { parseImportedSyllabusContent } = await import('./coursewareParser');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-everything-region-test-'));
  try {
    const sourcesDir = path.join(tmpDir, 'sources');
    fs.mkdirSync(sourcesDir, { recursive: true });

    const pdfBytes = await createMultiPagePdfBuffer([
      'Chapter 1 Feedback Concepts Page 1',
      'Chapter 1 Loop Gain Derivation Page 2',
      'Chapter 2 Frequency Response Page 3',
      'Chapter 2 Bode Plot Stability Page 4',
    ]);
    fs.writeFileSync(path.join(sourcesDir, 'analog.pdf'), pdfBytes);

    const analyzed = await analyzePdfBuffer(pdfBytes, 'analog.pdf');
    assert.equal(analyzed.meta.totalPages, 4);
    assert.equal(analyzed.fullText, '');
    assert.deepEqual(analyzed.meta.pages, []);

    // Step 1: Parse regions BEFORE outline exists (empty outline)
    const regionPlan = parseImportedPdfSplitPlan(
      JSON.stringify({
        pageOffset: 0,
        regions: [
          {
            regionId: 'region-01',
            title: '区域一：负反馈基本概念与环路增益',
            startPage: 1,
            endPage: 2,
            rationale: '对应第1章前两页核心推导',
          },
          {
            regionId: 'region-02',
            title: '区域二：频率响应与波特图稳定性',
            startPage: 3,
            endPage: 4,
            additionalPages: [2],
            rationale: '对应第2章并前置引用第2页环路增益定义',
          },
        ],
      }),
      [],
      'analog.pdf',
      analyzed.meta.totalPages,
      0
    );

    assert.equal(regionPlan.length, 2);
    assert.equal(regionPlan[0].sectionId, 'region-01');
    assert.equal(regionPlan[1].sectionId, 'region-02');
    assert.deepEqual(regionPlan[1].crossRefPages, [2]);

    const slicedRegions = await executePdfSplitPlanOnDisk({
      courseDir: tmpDir,
      courseRelDir: 'courses/模拟电子技术',
      splitPlan: regionPlan,
    });
    assert.equal(slicedRegions[0].status, 'sliced');
    assert.equal(slicedRegions[0].segmentFileName, 'region-01.pdf');
    assert.equal(fs.existsSync(path.join(tmpDir, 'segments', 'region-01.pdf')), true);
    assert.equal(fs.existsSync(path.join(tmpDir, 'segments', 'region-02.pdf')), true);

    // Step 2: Syllabus prompt consumes Step 1 regions, and imported outline preserves regionId
    const syllabusPrompt = buildSyllabusUserPrompt({
      name: '模拟电子技术',
      category: 'stem',
      goal: '掌握负反馈与频率响应',
      durationDays: 2,
      extraRequirements: '逐步推导',
      materials: [],
      pdfSplitPlan: slicedRegions,
    });
    assert.equal(syllabusPrompt.includes('region-01'), true);
    assert.equal(syllabusPrompt.includes('region-02'), true);

    const parsedSyllabus = parseImportedSyllabusContent(
      JSON.stringify({
        days: [
          {
            id: 'sec-01',
            dayIndex: 1,
            regionId: 'region-01',
            title: '第 1 讲：负反馈方框图与闭环增益',
            objective: '建立反馈模型',
            keyTopics: ['环路增益 AF', '负反馈组态'],
          },
          {
            id: 'sec-02',
            dayIndex: 2,
            regionId: 'region-02',
            title: '第 2 讲：波特图与相位裕度',
            objective: '分析自激振荡判据',
            keyTopics: ['幅频波特图', '相位裕度'],
          },
        ],
      }),
      '2026-11-12',
      2
    );
    assert.equal(parsedSyllabus.dailyPlan[0].regionId, 'region-01');
    assert.equal(parsedSyllabus.dailyPlan[1].regionId, 'region-02');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pure multimodal PDF flow: zero extracted PDF text injected into API, Agent, or Chat prompts across all 3 steps', async () => {
  const { buildChatLessonPrompt, buildChatSyllabusPrompt } = await import('../prompts/promptLibrary');

  const pdfBytes = await createMultiPagePdfBuffer([
    '278 Chapter 6 Signal Operations',
    'Fig 6.1.1 Basic OpAmp Circuit 279',
    '6.1.2 Inverting Amplifier 281',
    'Exercise 6.1.8 Superposition Principle 285',
  ]);

  const analyzed = await analyzePdfBuffer(pdfBytes, 'example.pdf');
  assert.equal(analyzed.meta.totalPages, 4);
  assert.equal(analyzed.meta.detectedPageOffset, 0);
  assert.equal(analyzed.fullText, '');
  assert.deepEqual(analyzed.meta.pages, []);
  assert.deepEqual(analyzed.meta.tocEntries, []);

  const mockCourse = {
    id: 'c-opamp',
    name: '模电',
    category: 'stem' as const,
    goal: '掌握模电第六章',
    startDate: '2026-11-12',
    durationDays: 7,
    extraRequirements: '按教材深入理解',
    materials: [
      {
        id: 'm-pdf',
        fileName: 'example.pdf',
        fileSize: 102400,
        isPdf: true,
        totalPages: 62,
        extractedText: 'LEGACY_TEXT_SHOULD_NEVER_BE_IN_PROMPT',
      },
      {
        id: 'm-txt',
        fileName: 'teacher_notes.txt',
        fileSize: 512,
        isPdf: false,
        extractedText: 'PLAIN_TEXT_SUPPLEMENT_NOTE',
      },
    ],
    dailyPlan: [
      {
        id: 'sec-01',
        dayIndex: 1,
        date: '2026-11-12',
        title: '第 1 讲：集成运放基本线性应用',
        objective: '掌握虚短与虚断',
        keyTopics: ['虚短', '虚断'],
        pdfSegment: {
          sectionId: 'region-01',
          dayIndex: 1,
          date: '2026-11-12',
          sectionTitle: '6.1 基本运算电路',
          sourceFileName: 'example.pdf',
          physicalStartPage: 1,
          physicalEndPage: 12,
          segmentFileName: 'region-01.pdf',
          extractedSegmentText: 'LEGACY_SEGMENT_SHOULD_NOT_APPEAR',
          status: 'sliced' as const,
        },
      },
    ],
    pdfSplitPlan: [
      {
        sectionId: 'region-01',
        dayIndex: 1,
        date: '2026-11-12',
        sectionTitle: '6.1 基本运算电路',
        sourceFileName: 'example.pdf',
        physicalStartPage: 1,
        physicalEndPage: 12,
        segmentFileName: 'region-01.pdf',
        extractedSegmentText: 'LEGACY_SEGMENT_SHOULD_NOT_APPEAR',
        status: 'sliced' as const,
      },
    ],
    masteredWords: [],
    exerciseSubmissions: {},
    createdAt: '2026-11-12T00:00:00Z',
  };

  // Step 1: API / Agent / Chat split prompts must NEVER contain extracted page dumps or .txt notes for PDFs
  const prompts = buildPdfSplitPrompts({
    course: mockCourse,
    pdfMetas: [
      {
        fileName: 'example.pdf',
        totalPages: 62,
        detectedPageOffset: 0,
        tocEntries: [],
        pages: [],
      },
    ],
    courseRelDir: 'courses/模电',
  });

  for (const promptStr of [prompts.apiUserPrompt, prompts.agentSplitPrompt, prompts.chatSplitPrompt]) {
    assert.equal(promptStr.includes('LEGACY_TEXT_SHOULD_NEVER_BE_IN_PROMPT'), false);
    assert.equal(promptStr.includes('example.pdf'), true);
    assert.equal(promptStr.includes('多模态'), true);
  }
  assert.equal(prompts.agentSplitPrompt.includes('.txt'), false);

  // Step 2: Syllabus prompts preserve plain-text notes without injecting PDF dumps
  const apiSyllabusPrompt = buildSyllabusUserPrompt({
    name: mockCourse.name,
    category: mockCourse.category,
    goal: mockCourse.goal,
    durationDays: mockCourse.durationDays,
    extraRequirements: mockCourse.extraRequirements,
    materials: mockCourse.materials,
    pdfSplitPlan: mockCourse.pdfSplitPlan,
  });
  const chatSyllabusPrompt = buildChatSyllabusPrompt({ course: mockCourse });
  for (const sPrompt of [apiSyllabusPrompt, chatSyllabusPrompt]) {
    assert.equal(sPrompt.includes('LEGACY_TEXT_SHOULD_NEVER_BE_IN_PROMPT'), false);
    assert.equal(sPrompt.includes('LEGACY_SEGMENT_SHOULD_NOT_APPEAR'), false);
    assert.equal(sPrompt.includes('PLAIN_TEXT_SUPPLEMENT_NOTE'), true);
    assert.equal(sPrompt.includes('region-01.pdf'), true);
  }

  // Step 3: Chat lesson prompt references sliced PDF & plain-text notes directly
  const chatLessonPrompt = buildChatLessonPrompt({
    course: mockCourse,
    slot: mockCourse.dailyPlan[0],
    teachingSystemPrompt: '系统教学规范',
  });
  assert.equal(chatLessonPrompt.includes('LEGACY_TEXT_SHOULD_NEVER_BE_IN_PROMPT'), false);
  assert.equal(chatLessonPrompt.includes('LEGACY_SEGMENT_SHOULD_NOT_APPEAR'), false);
  assert.equal(chatLessonPrompt.includes('PLAIN_TEXT_SUPPLEMENT_NOTE'), true);
  assert.equal(chatLessonPrompt.includes('region-01.pdf'), true);
});

test('computeLearningStats and formatStudyDuration compute real study time and exercise accuracy', () => {
  assert.equal(formatStudyDuration(0), '0s');
  assert.equal(formatStudyDuration(65), '1m 05s');
  assert.equal(formatStudyDuration(3720), '1h 02m');

  const stats = computeLearningStats(
    [
      {
        id: 'c1',
        name: '模电',
        category: 'stem',
        goal: '掌握负反馈',
        startDate: '2026-11-12',
        durationDays: 2,
        extraRequirements: '',
        materials: [],
        dailyPlan: [
          {
            id: 'sec-01',
            dayIndex: 1,
            date: '2026-11-12',
            title: '第1讲',
            objective: '目标1',
            keyTopics: [],
            lesson: {
              dayIndex: 1,
              date: '2026-11-12',
              title: '第1讲',
              summary: '摘要',
              keyPoints: [],
              markdownBody: '正文',
              exercises: [],
              generatedAt: '2026-11-12T00:00:00Z',
            },
          },
          {
            id: 'sec-02',
            dayIndex: 2,
            date: '2026-11-13',
            title: '第2讲',
            objective: '目标2',
            keyTopics: [],
          },
        ],
        masteredWords: [],
        exerciseSubmissions: {
          '2026-11-12': {
            userAnswers: { q1: 'A', q2: 'B' },
            submittedAt: '2026-11-12T10:00:00Z',
            score: 3,
            total: 4,
          },
          '2026-11-13': {
            userAnswers: { q3: 'C' },
            submittedAt: '2026-11-13T10:00:00Z',
            score: 1,
            total: 2,
          },
        },
        createdAt: '2026-11-12T00:00:00Z',
      },
    ],
    {
      totalSeconds: 185,
      secondsByDate: { '2026-11-13': 125 },
      secondsByCourse: { c1: 185 },
    },
    '2026-11-13'
  );

  assert.equal(stats.totalStudySeconds, 185);
  assert.equal(stats.todayStudySeconds, 125);
  assert.equal(stats.totalQuestionsAnswered, 6);
  assert.equal(stats.totalQuestionsCorrect, 4);
  assert.equal(stats.accuracyPercent, 66.7);
  assert.equal(stats.todayAccuracyPercent, 50);
  assert.equal(stats.completedLessonsCount, 1);
  assert.equal(stats.totalLessonsCount, 2);
});

test('stripAiCitationArtifacts and coursewareParser remove [cite: ...] artifacts cleanly without breaking math or markdown', async () => {
  const {
    stripAiCitationArtifacts,
    parseImportedLessonContent,
    parseImportedSyllabusContent,
  } = await import('./coursewareParser');
  const { renderMarkdownWithLatex } = await import('./markdownMath');

  assert.equal(
    stripAiCitationArtifacts('反相比例运算电路利用虚短和虚断原则推导闭环增益 [cite: 125, 126]。'),
    '反相比例运算电路利用虚短和虚断原则推导闭环增益。'
  );
  assert.equal(
    stripAiCitationArtifacts('[cite_start]当 $R_f = 10R_1$ 时 [cite: 12]，输出反相放大 10 倍。[cite_end]'),
    '当 $R_f = 10R_1$ 时，输出反相放大 10 倍。'
  );
  assert.equal(
    stripAiCitationArtifacts('积分运算电路见教材第 286 页【cite: 3, 4】\n- 虚地条件 $u_- = 0$ [cite: 9]'),
    '积分运算电路见教材第 286 页\n- 虚地条件 $u_- = 0$'
  );

  const renderedHtml = renderMarkdownWithLatex('同相放大器增益为 $1 + R_f/R_1$ [cite: 125, 126]。');
  assert.equal(renderedHtml.includes('cite'), false);
  assert.equal(renderedHtml.includes('同相放大器增益为'), true);

  const importedLesson = parseImportedLessonContent(
    JSON.stringify({
      title: '第 1 讲：反相比例电路 [cite: 125, 126]',
      summary: '通过 KCL 推导闭环电压增益 [cite: 12]。',
      keyPoints: ['虚短 $u_+ = u_-$ [cite: 5]', '虚断 $i_+ = i_- = 0$ 【cite: 6】'],
      markdownBody: '## 一、反相放大器 [cite: 125, 126]\n由节点电流定律得 $A_u = -R_f / R_1$ [cite: 127]。',
      diagrams: [
        {
          id: 'diag-1',
          title: '反相电路图 [cite: 8]',
          stageLabel: '静态分析 [cite: 9]',
          caption: '电流方向标定 [cite: 10]',
          svgCode: '<svg viewBox="0 0 100 40"></svg>',
        },
      ],
      heuristicQuestions: [
        {
          id: 'hq-1',
          context: '虚地条件 [cite: 11]',
          question: '为什么反相端电位近似为零？ [cite: 12]',
          hint: '利用虚短概念 [cite: 13]',
          approach: '比较运放开环增益 [cite: 14]',
          answerReveal: '因为同相端接地且开环增益极高 [cite: 15]。',
        },
      ],
      exercises: [
        {
          id: 'ex-1',
          stage: 'inline',
          type: 'choice',
          difficulty: 'basic',
          question: '理想运放开环差模增益为 [cite: 125, 126]',
          options: ['A. 无穷大 [cite: 1]', 'B. 零'],
          answer: 'A [cite: 2]',
          hint: '考虑理想化条件 [cite: 3]',
          explanation: '理想运放开环增益趋近无穷大 [cite: 125, 126]。',
        },
      ],
      reverseChecks: [
        {
          id: 'rc-1',
          topic: '虚短与虚断 [cite: 20]',
          prompt: '用自己的话解释虚地 [cite: 21]',
          keyPoints: ['同相端接地 [cite: 22]', '差模电压为零 [cite: 23]'],
          referenceExplanation: '反相端电位跟随同相端电位 [cite: 24]。',
        },
      ],
    }),
    {
      id: 'sec-01',
      dayIndex: 1,
      date: '2026-11-12',
      title: '第 1 讲',
      objective: '掌握反相比例电路 [cite: 99]',
      keyTopics: ['虚短'],
    },
    'chat'
  );

  const serializedLesson = JSON.stringify(importedLesson.lesson);
  assert.equal(serializedLesson.includes('[cite:'), false);
  assert.equal(serializedLesson.includes('【cite:'), false);
  assert.equal(serializedLesson.includes('cite_start'), false);

  const importedSyllabus = parseImportedSyllabusContent(
    JSON.stringify({
      days: [
        {
          id: 'sec-01',
          dayIndex: 1,
          title: '第 1 讲：集成运放 [cite: 125, 126]',
          objective: '掌握虚短虚断 [cite: 127]',
          keyTopics: ['反相放大 [cite: 128]'],
        },
      ],
    }),
    '2026-11-12',
    1
  );
  assert.equal(JSON.stringify(importedSyllabus).includes('[cite:'), false);
});

test('enhanceDiagramSvg formats math subscripts, strips $ delimiters, and wraps overflowing callout text', async () => {
  const { enhanceDiagramSvg } = await import('./svgMath');

  const rawSvg = `<svg viewBox="0 0 680 320" width="680" height="320" xmlns="http://www.w3.org/2000/svg">
    <text x="20" y="28" font-size="14">(a) 同相比例运算电路 (u_O = (1 + R_f/R)u_I)</text>
    <text x="190" y="50" font-size="13">$R_f$</text>
    <text x="120" y="210" font-size="13">u_P=u_I</text>
    <rect x="26" y="250" width="600" height="58" rx="8" />
    <text x="42" y="272" font-size="13">共模输入警示与隔离特性：</text>
    <text x="42" y="295" font-size="12">1. 运放净输入 u_P = u_N = u_I ≠ 0，存在共模输入电压，高精度场合必须选用高共模抑制比（K_CMR）运放；2. 理想 R_in 极大且反馈系数 F = 1。</text>
  </svg>`;

  const enhanced = enhanceDiagramSvg(rawSvg);
  // $ delimiters stripped inside SVG
  assert.equal(enhanced.includes('$'), false);
  // Raw underscore subscripts converted to SVG baseline-shift tspans
  assert.equal(enhanced.includes('baseline-shift="sub"'), true);
  assert.equal(enhanced.includes('>O</tspan>'), true);
  assert.equal(enhanced.includes('>f</tspan>'), true);
  assert.equal(enhanced.includes('>CMR</tspan>'), true);
  assert.equal(enhanced.includes('u_P'), false);
  assert.equal(enhanced.includes('K_CMR'), false);
  // Overflowing callout wrapped into multi-line <tspan x="42" dy="..."> and rect/viewBox expanded
  assert.equal(/<tspan x="42" dy="/.test(enhanced), true);
  const rectHMatch = enhanced.match(/<rect[^>]*height="(\d+)"/);
  assert.equal(Boolean(rectHMatch && Number(rectHMatch[1]) > 58), true);
  const vbMatch = enhanced.match(/viewBox="0 0 680 (\d+)"/);
  assert.equal(Boolean(vbMatch && Number(vbMatch[1]) > 320), true);
});

test('normalizeBareMathForMarkdown, KaTeX rendering, and linkifyDiagramRefsInHtml handle special boxes and figure citations cleanly', async () => {
  const {
    normalizeBareMathForMarkdown,
    renderInlineMathWithLatex,
    renderMarkdownWithLatex,
    linkifyDiagramRefsInHtml,
  } = await import('./markdownMath');

  const heuristicText =
    '先思考：在基本反相比例电路中，u_O = -i_F R_f，而受限于虚断i_F=i_I=u_I/R_1。如果工程上要求输入电阻 R_1 = 100 kΩ不变，且禁止使用兆欧（MΩ）级大电阻，从而撑起很大的 u_O？（保留 code identifier `section_id`）';

  const normalized = normalizeBareMathForMarkdown(heuristicText);
  assert.equal(normalized.includes('$u_O = -i_F R_f$'), true);
  assert.equal(normalized.includes('$i_F=i_I=u_I/R_1$'), true);
  assert.equal(normalized.includes('$R_1 = 100\\,\\text{k}\\Omega$'), true);
  assert.equal(normalized.includes('$u_O$'), true);
  // Multi-char snake_case inside inline code stays untouched
  assert.equal(normalized.includes('`section_id`'), true);

  const visuals = [
    {
      id: 'diag-1',
      title: '图 1.1：T形网络反相比例运算电路',
      kind: 'svg' as const,
      svgCode: '<svg viewBox="0 0 100 40"><text x="10" y="20">u_O</text></svg>',
      index: 1,
    },
    {
      id: 'img-1',
      title: '实测波形图',
      kind: 'image' as const,
      imageUrl: 'data:image/png;base64,AAA',
      fileName: 'scope_wave.png',
      index: 2,
    },
  ];

  const contextHtml = renderInlineMathWithLatex(
    '在引入T形网络反相比例运算电路（图 diag-1）的推导之前',
    visuals
  );
  assert.equal(contextHtml.includes('data-visual-ref="diag-1"'), true);
  assert.equal(contextHtml.includes('<p>'), false);

  const questionHtml = renderMarkdownWithLatex(heuristicText, visuals);
  assert.equal(questionHtml.includes('class="katex"'), true);
  const visibleQuestionHtml = questionHtml.replace(/<annotation[\s\S]*?<\/annotation>/g, '');
  assert.equal(visibleQuestionHtml.includes('u_O'), false);
  assert.equal(visibleQuestionHtml.includes('i_F'), false);
  assert.equal(questionHtml.includes('<code>section_id</code>'), true);

  // Verify linkifyDiagramRefsInHtml skips <svg>, <pre><code>, and .katex nodes while upgrading inline <code>diag-*</code> pills and loose variants
  const visualsExtended = [
    ...visuals,
    {
      id: 'diag-4c',
      title: '图 4c：二阶巴特沃斯低通滤波器',
      kind: 'svg' as const,
      svgCode: '<svg viewBox="0 0 100 40"><text x="10" y="20">Q=0.707</text></svg>',
      index: 3,
    },
  ];
  const mixedHtml =
    '<p>根据图 diag-1 与图 1.1 分析，参见图片 scope_wave.png；(图 <code>diag-4c</code>)、diag_4c、图 4c 均可点击；<pre><code>diag-1</code></pre> 与 <span class="katex">diag-1</span> 不应被包裹。</p><svg><text>diag-1</text></svg>';
  const linked = linkifyDiagramRefsInHtml(mixedHtml, visualsExtended);
  assert.equal(linked.includes('data-visual-ref="diag-1"'), true);
  assert.equal(linked.includes('data-visual-ref="diag-4c"'), true);
  assert.equal(linked.includes('data-visual-ref="img-1"'), true);
  assert.equal(linked.includes('<pre><code>diag-1</code></pre>'), true);
  assert.equal(linked.includes('<span class="katex">diag-1</span>'), true);
  assert.equal(linked.includes('<svg><text>diag-1</text></svg>'), true);

  // Verify single-tilde ~ in page/section ranges never produces <del> strikethrough
  const scopeText =
    '对应区域 region-01（物理第 1~8 页）/原教材第6章 6.1.2(续)~6.1.3 节（第 278~285 页，含例 6.1.1~6.1.3）';
  const scopeHtml = renderInlineMathWithLatex(scopeText);
  assert.equal(scopeHtml.includes('<del>'), false);
  assert.equal(scopeHtml.includes('1~8'), true);
  assert.equal(scopeHtml.includes('6.1.2(续)~6.1.3'), true);
  assert.equal(scopeHtml.includes('278~285'), true);
  assert.equal(scopeHtml.includes('6.1.1~6.1.3'), true);

  // Verify compact STEM subscript formulas without underscores or $ delimiters render into KaTeX
  const prereqText =
    '理想集成运放线性工作区基本判据：存在负反馈，满足“虚短”（uP = uN）与“虚断”（iP = iN = 0）、基本反相比例运算电路结构及其输出关系 uO = -(Rf / R1) * uI 与输入电阻 Ri = R1、基尔霍夫电流定律（KCL）、基尔霍夫电压定律（KVL）与线性电路叠加原理';
  const prereqNorm = normalizeBareMathForMarkdown(prereqText);
  assert.equal(prereqNorm.includes('$u_P = u_N$'), true);
  assert.equal(prereqNorm.includes('$i_P = i_N = 0$'), true);
  assert.equal(prereqNorm.includes('$u_O = -(R_f / R_1) \\cdot u_I$'), true);
  assert.equal(prereqNorm.includes('$R_i = R_1$'), true);
  // Acronyms like KCL / KVL remain plain text
  assert.equal(prereqNorm.includes('（KCL）'), true);
  assert.equal(prereqNorm.includes('（KVL）'), true);

  const prereqHtml = renderInlineMathWithLatex(prereqText);
  assert.equal(prereqHtml.includes('class="katex"'), true);
  const visiblePrereqHtml = prereqHtml.replace(/<annotation[\s\S]*?<\/annotation>/g, '');
  assert.equal(visiblePrereqHtml.includes('uP = uN'), false);
  assert.equal(visiblePrereqHtml.includes('uO = -(Rf / R1)'), false);
  assert.equal(visiblePrereqHtml.includes('Ri = R1'), false);
});

test('cross-disciplinary LaTeX robustness across Math, Physics, Electronics, Chemistry, CS, and Linear Algebra in titles and special boxes', async () => {
  const { renderInlineMathWithLatex, renderMarkdownWithLatex } = await import('./markdownMath');
  const { enhanceDiagramSvg } = await import('./svgMath');

  // 1. Calculus & Differential Equations in title
  const calcTitle = renderInlineMathWithLatex('第 2 讲：动态微积分电路 du_C/dt 与 di_L/dt 响应');
  assert.equal(calcTitle.includes('class="katex"'), true);
  assert.equal(calcTitle.replace(/<annotation[\s\S]*?<\/annotation>/g, '').includes('du_C/dt'), false);

  // 2. Electromagnetism & Quantum Physics bare LaTeX commands in title
  const physicsTitle = renderInlineMathWithLatex(
    '第 3 讲：麦克斯韦旋度方程 \\nabla \\times \\vec{E} = -\\frac{\\partial \\vec{B}}{\\partial t} 与薛定谔算符 \\hat{H}\\psi = E\\psi'
  );
  assert.equal(physicsTitle.includes('class="katex"'), true);
  assert.equal(physicsTitle.replace(/<annotation[\s\S]*?<\/annotation>/g, '').includes('\\nabla'), false);

  // 3. Chemistry formulas & ionic charges in title / badge (never merging COOH into subscript 3)
  const chemTitle = renderInlineMathWithLatex(
    '第 4 讲：弱电解质 CH_3COOH \\rightleftharpoons CH_3COO^- + H^+ 与 SO_4^{2-} 检验 (u_P = u_N != 0)'
  );
  assert.equal(chemTitle.includes('class="katex"'), true);
  assert.equal(chemTitle.includes('_{3COOH}'), false);
  assert.equal(chemTitle.includes('!='), false);
  const visibleChem = chemTitle.replace(/<annotation[\s\S]*?<\/annotation>/g, '');
  assert.equal(visibleChem.includes('>3</span>'), true);
  assert.equal(visibleChem.includes('3COOH'), false);
  assert.equal(visibleChem.includes('CH_3COOH'), false);
  assert.equal(visibleChem.includes('SO_4'), false);

  // 4. Computer Science complexity & log_2 in title
  const csTitle = renderInlineMathWithLatex('第 5 讲：归并排序时间复杂度 O(n \\log_2 n) 与主定理 T(n) = 2T(n/2) + O(n)');
  assert.equal(csTitle.includes('class="katex"'), true);
  assert.equal(csTitle.replace(/<annotation[\s\S]*?<\/annotation>/g, '').includes('\\log_2'), false);

  // 5. Linear Algebra & Piecewise cases environment without outer $$ in special box
  const linalgBox = renderMarkdownWithLatex(
    '状态转移分段函数：\n\\begin{cases} x_1 + 2x_2 = 0 \\\\ 3x_1 - x_2 = 1 \\end{cases}'
  );
  assert.equal(linalgBox.includes('class="katex-display"'), true);

  // 6. Electronics compact variables (VGS, VTH, gm, rbe) in special box
  const mosfetTitle = renderInlineMathWithLatex('MOSFET 导通条件 VGS > VTH 与跨导 gm、输入电阻 rbe');
  assert.equal(mosfetTitle.includes('class="katex"'), true);
  const visibleMosfet = mosfetTitle.replace(/<annotation[\s\S]*?<\/annotation>/g, '');
  assert.equal(visibleMosfet.includes('VGS > VTH'), false);

  // 7. SVG diagram with Greek letters, vectors, and chemical formulas
  const svgOut = enhanceDiagramSvg(
    '<svg viewBox="0 0 400 120"><text x="20" y="40">\\nabla \\times \\vec{E}, SO_4^{2-}, du_C/dt</text></svg>'
  );
  assert.equal(svgOut.includes('∇'), true);
  assert.equal(svgOut.includes('baseline-shift="sub"'), true);
  assert.equal(svgOut.includes('baseline-shift="super"'), true);
});

test('analyzeStreamedLessonBuffer derives truthful stage, percent, fields, and live heading from streamed JSON chunks', async () => {
  const { analyzeStreamedLessonBuffer } = await import('./streamProgress');

  // 1. Metadata chunk only -> step 2, 20..27%
  const s1 = analyzeStreamedLessonBuffer('{"title": "第1讲：微分电路", "summary": "核心概要"');
  assert.equal(s1.step, 2);
  assert.equal(s1.percent >= 20 && s1.percent <= 27, true);
  assert.deepEqual(s1.detectedFields, ['title', 'summary']);

  // 2. Streaming markdownBody with section heading -> step 2, increases with chars, extracts latest heading
  const bodyContent = '## 2.1 一阶 RC 微分电路微分方程推导\\n由基尔霍夫电流定律得 ' + 'u_C(t) '.repeat(350);
  const s2 = analyzeStreamedLessonBuffer(
    `{"title": "第1讲", "summary": "摘要", "markdownBody": "${bodyContent}"`
  );
  assert.equal(s2.step, 2);
  assert.equal(s2.percent > s1.percent && s2.percent <= 54, true);
  assert.equal(s2.detectedFields.includes('markdownBody'), true);
  assert.equal(s2.liveSnippet.includes('2.1 一阶 RC 微分电路微分方程推导'), true);

  // 3. Streaming diagrams + heuristicQuestions -> step 3, >= 56%
  const s3 = analyzeStreamedLessonBuffer(
    `{"title": "第1讲", "markdownBody": "正文", "diagrams": [{"id": "diag-1"}], "heuristicQuestions": [`
  );
  assert.equal(s3.step, 3);
  assert.equal(s3.percent >= 56 && s3.percent < 72, true);
  assert.equal(s3.detectedFields.includes('diagrams'), true);
  assert.equal(s3.detectedFields.includes('heuristicQuestions'), true);

  // 4. Streaming exercises -> step 3, >= 72%
  const s4 = analyzeStreamedLessonBuffer(
    `{"title": "第1讲", "markdownBody": "${'x'.repeat(5500)}", "diagrams": [], "exercises": [{"id": "ex-1"}]`
  );
  assert.equal(s4.step, 3);
  assert.equal(s4.percent >= 72 && s4.percent < 84, true);

  // 5. Streaming reverseChecks / qualityCheck -> step 4, >= 84% and capped <= 91% before final save
  const s5 = analyzeStreamedLessonBuffer(
    `{"title": "第1讲", "markdownBody": "${'x'.repeat(12000)}", "diagrams": [], "exercises": [], "reverseChecks": [], "qualityCheck": {"passed": true}}`
  );
  assert.equal(s5.step, 4);
  assert.equal(s5.percent >= 84 && s5.percent <= 91, true);
  assert.equal(s5.detectedFields.includes('qualityCheck'), true);

  // 6. English mode detects englishPayload properly
  const sEn = analyzeStreamedLessonBuffer(
    '{"title": "Unit 1", "englishPayload": {"articleTitle": "Tech"',
    true
  );
  assert.equal(sEn.step, 2);
  assert.equal(sEn.detectedFields.includes('englishPayload'), true);
  assert.equal(sEn.currentSectionLabel.includes('englishPayload'), true);
});

test('rendering pipeline preserves SI units inside \\text{}, repairs damaged units, expands uI1..uI3, and avoids katex-error', async () => {
  const { expandCompactStemSubscripts, renderMarkdownWithLatex, renderInlineMathWithLatex } = await import(
    './markdownMath'
  );

  // 1. \text{nA} / \text{pF} never turned into \text{n_A} / \text{p_F}, and already broken \text{n_A}/\text{p_F} repaired
  assert.equal(expandCompactStemSubscripts('\\Delta I_{I_O} = 20\\,\\text{nA}'), '\\Delta I_{I_O} = 20\\,\\text{nA}');
  assert.equal(expandCompactStemSubscripts('C_1 = 2\\text{pF}, C_2 = 20\\text{pF}'), 'C_1 = 2\\text{pF}, C_2 = 20\\text{pF}');
  assert.equal(expandCompactStemSubscripts('\\text{n_A} + \\text{p_F}'), '\\text{nA} + \\text{pF}');

  const unitHtml = renderMarkdownWithLatex(
    '电流漂移 $\\Delta I_{I_O} = 20\\,\\text{nA}$，损坏输入 $\\Delta I_{I_O} = 20\\,\\text{n_A}$，电容 $C_1 = 2\\text{p_F}$，$C_2 = 20\\text{pF}$。'
  );
  assert.equal(unitHtml.includes('katex-error'), false);
  assert.equal(unitHtml.includes('class="katex"'), true);

  // 2. Compact uI1/uI2/uI3 inside bare equations expand cleanly
  const bareSum = renderInlineMathWithLatex('u_O = -R_f(uI1/R_1 + uI2/R_2 + uI3/R_3)');
  assert.equal(bareSum.includes('katex-error'), false);
  assert.equal(bareSum.includes('class="katex"'), true);
  const visibleSum = bareSum.replace(/<annotation[\s\S]*?<\/annotation>/g, '');
  assert.equal(visibleSum.includes('uI1'), false);
  assert.equal(visibleSum.includes('uI2'), false);
  assert.equal(visibleSum.includes('uI3'), false);

  // 3. Radical and tall absolute delimiter formulas render properly without katex-error
  const sqrtAndAbs = renderMarkdownWithLatex(
    '| \\delta | = \\frac{\\Delta U_{I_O} + \\Delta I_{I_O} R}{u_I}\n\n$$Q = \\frac{R_1 \\| R_2 \\| R_f}{C_2 R_2 R_f} \\cdot \\sqrt{\\frac{C_1}{R_2 R_f C_2}}$$\n\n$$Q = 0.707\\left(\\frac{1}{\\sqrt{2}}\\right)$$'
  );
  assert.equal(sqrtAndAbs.includes('katex-error'), false);
  assert.equal(sqrtAndAbs.includes('<svg'), true);
});

test('coursewareDiagnostics detects KaTeX errors, unclosed math, missing diag refs, broken JSON, malformed SVGs, and generates repair prompts', async () => {
  const { auditCoursewareRendering, auditRawCoursewareInput } = await import('./coursewareDiagnostics');

  // 1. Valid lesson passes with 0 errors
  const cleanReport = auditCoursewareRendering({
    sectionId: 'sec-01',
    dayIndex: 1,
    date: '2026-11-12',
    title: '运算放大器线性应用',
    summary: '掌握反相求和 $u_O = -R_f(u_{I1}/R_1 + u_{I2}/R_2)$ 与频域误差。',
    keyPoints: ['输入偏置电流漂移 $\\Delta I_{I_O} = 20\\,\\text{nA}$'],
    markdownBody: '参考电路 (图 `diag-4c`)：\n\n$$Q = 0.707\\left(\\frac{1}{\\sqrt{2}}\\right)$$\n\n{{diagram:diag-4c}}',
    diagrams: [
      {
        id: 'diag-4c',
        title: '二阶巴特沃斯低通滤波器',
        caption: '标准二阶巴特沃斯电路',
        svgCode: '<svg viewBox="0 0 680 320" xmlns="http://www.w3.org/2000/svg"><text x="20" y="40">Q=0.707</text></svg>',
      },
    ],
    heuristicQuestions: [],
    exercises: [],
    reverseChecks: [],
    generatedAt: new Date().toISOString(),
    sourceMode: 'chat',
  });
  assert.equal(cleanReport.hasErrors, false);
  assert.equal(cleanReport.errorCount, 0);

  // 2. Broken lesson catches LaTeX syntax error, unclosed $, missing diag-3b, leaked \frac, and broken SVG
  const brokenReport = auditCoursewareRendering({
    sectionId: 'sec-01',
    dayIndex: 1,
    date: '2026-11-12',
    title: '故障测试',
    summary: '总结测试',
    keyPoints: ['未闭合公式 $u_O = R_f'],
    markdownBody: '正文有语法报错 $\\frac{1$ 和缺失图引用 (图 diag-3b)，以及裸露命令 \\sqrt{2}。',
    diagrams: [
      {
        id: 'diag-4c',
        title: '损坏图示',
        caption: '图示说明',
        svgCode: '<svg viewBox="0 0 680 320"><text>no close tag',
      },
    ],
    heuristicQuestions: [],
    exercises: [
      {
        id: 'ex-1',
        stage: 'inline',
        type: 'fill',
        difficulty: 'basic',
        question: '参见图 diag-9z，计算结果',
        answer: '10',
        explanation: '解析说明',
      },
    ],
    reverseChecks: [],
    generatedAt: new Date().toISOString(),
    sourceMode: 'chat',
  });
  assert.equal(brokenReport.hasErrors, true);
  assert.equal(brokenReport.errorCount >= 4, true);
  const cats = new Set(brokenReport.issues.map((i) => i.category));
  assert.equal(cats.has('unclosed_math'), true);
  assert.equal(cats.has('latex_error'), true);
  assert.equal(cats.has('missing_diagram'), true);
  assert.equal(cats.has('svg_error'), true);
  assert.equal(brokenReport.repairPrompt.includes('diag-3b'), true);
  assert.equal(brokenReport.repairPrompt.includes('diag-9z'), true);
  assert.equal(brokenReport.repairPrompt.includes('diag-4c'), true);

  // 3. Raw truncated JSON input is flagged with json_syntax_error and repairPrompt
  const jsonAudit = auditRawCoursewareInput(
    '```json\n{"title": "第1讲", "markdownBody": "u_O = \\\\frac{1}{2}"',
    {
      id: 'sec-01',
      dayIndex: 1,
      date: '2026-11-12',
      title: '第1讲',
      objective: '理解运放',
      keyTopics: ['运放'],
    }
  );
  assert.ok(jsonAudit);
  assert.equal(jsonAudit.parsedLesson, null);
  assert.equal(jsonAudit.report.hasErrors, true);
  assert.equal(jsonAudit.report.issues[0].category, 'json_syntax_error');
  assert.equal(jsonAudit.report.repairPrompt.includes('JSON'), true);
});

test('sub-panel references (diag-4c, diag_4c, 图 4c) resolve to parent diagram (diag-4) when unified in one SVG, while exact sub-panel overrides and missing ids are preserved', async () => {
  const { resolveVisualRefByToken, linkifyDiagramRefsInHtml } = await import('./markdownMath');
  const { auditCoursewareRendering } = await import('./coursewareDiagnostics');

  const combinedVisuals = [
    {
      id: 'diag-4',
      title: '图 4：三种二阶有源低通滤波器 (a)(b)(c)',
      kind: 'svg' as const,
      svgCode: '<svg viewBox="0 0 680 320"><text x="20" y="40">(a)(b)(c)</text></svg>',
      index: 1,
    },
  ];

  // Sub-panel references resolve cleanly to parent diag-4
  assert.equal(resolveVisualRefByToken('diag-4c', combinedVisuals)?.id, 'diag-4');
  assert.equal(resolveVisualRefByToken('diag_4b', combinedVisuals)?.id, 'diag-4');
  assert.equal(resolveVisualRefByToken('图 4a', combinedVisuals)?.id, 'diag-4');
  // Unrelated missing diagram still returns null
  assert.equal(resolveVisualRefByToken('diag-9z', combinedVisuals), null);

  const html = '<p>对比子图 (图 diag-4c)、(图 <code>diag-4c</code>)、diag_4b 与 图 4a。</p>';
  const linked = linkifyDiagramRefsInHtml(html, combinedVisuals);
  assert.equal(linked.includes('data-visual-ref="diag-4"'), true);
  assert.equal(/>图 diag-4c<\/button>/.test(linked), true);
  assert.equal(/>diag-4c<\/button>/.test(linked), true);
  assert.equal(/>图 diag-4<\/button>c/.test(linked), false);

  // When an explicit diag-4c ALSO exists alongside diag-4, exact diag-4c takes precedence
  const bothVisuals = [
    ...combinedVisuals,
    {
      id: 'diag-4c',
      title: '图 4c 单独特写',
      kind: 'svg' as const,
      svgCode: '<svg viewBox="0 0 320 200"><text x="10" y="20">4c</text></svg>',
      index: 2,
    },
  ];
  assert.equal(resolveVisualRefByToken('diag-4c', bothVisuals)?.id, 'diag-4c');
  assert.equal(resolveVisualRefByToken('diag-4b', bothVisuals)?.id, 'diag-4');

  // Diagnostics report 0 missing_diagram errors when prose references diag-4a/4b/4c for unified diag-4
  const cleanUnifiedReport = auditCoursewareRendering({
    sectionId: 'sec-01',
    dayIndex: 1,
    date: '2026-11-13',
    title: '二阶有源滤波器的三种实现',
    summary: '在图 diag-4 中对比 (a)(b)(c) 三种电路。',
    keyPoints: ['参见图 diag-4c'],
    markdownBody: '如图所示 {{diagram:diag-4}}，其中 (图 `diag-4a`)、(图 `diag-4b`) 与 图 4c 同绘于一张组合图内。',
    diagrams: [
      {
        id: 'diag-4',
        title: '二阶低通滤波器总图 (a)(b)(c)',
        caption: '包含 (a)(b)(c) 三个子图',
        svgCode: '<svg viewBox="0 0 680 320"><text x="20" y="30">(a)(b)(c)</text></svg>',
      },
    ],
    heuristicQuestions: [],
    exercises: [],
    reverseChecks: [],
    generatedAt: new Date().toISOString(),
    sourceMode: 'chat',
  });
  assert.equal(cleanUnifiedReport.hasErrors, false);
  assert.equal(cleanUnifiedReport.errorCount, 0);
});

test('buildLessonSymbolIndex and normalizeSymbolKeys extract preceding LaTeX symbol explanations from prose, tables, and symbolGlossary', async () => {
  const {
    normalizeSymbolKeys,
    buildLessonSymbolIndex,
    lookupSymbolInIndex,
  } = await import('./latexSymbols');
  const { parseImportedLessonContent } = await import('./coursewareParser');

  // 1. Normalization handles subscripts, braces, Greek commands, and Unicode symbols identically
  assert.deepEqual(normalizeSymbolKeys('R_f'), { canonicalKey: 'Rf', looseKey: 'Rf' });
  assert.deepEqual(normalizeSymbolKeys('$R_{f}$'), { canonicalKey: 'Rf', looseKey: 'Rf' });
  assert.deepEqual(normalizeSymbolKeys('Rf'), { canonicalKey: 'Rf', looseKey: 'Rf' });
  assert.deepEqual(normalizeSymbolKeys('\\Delta I_{I_O}'), {
    canonicalKey: 'ΔIIO',
    looseKey: 'Δiio',
  });
  assert.deepEqual(normalizeSymbolKeys('ΔIIO'), {
    canonicalKey: 'ΔIIO',
    looseKey: 'Δiio',
  });
  assert.deepEqual(normalizeSymbolKeys('\\delta'), {
    canonicalKey: 'δ',
    looseKey: 'δ',
  });
  // Rejects full equations or pure numbers or SI units
  assert.equal(normalizeSymbolKeys('u_O = -R_f u_I'), null);
  assert.equal(normalizeSymbolKeys('100'), null);
  assert.equal(normalizeSymbolKeys('kΩ'), null);

  // 2. Prose + table + symbolGlossary mining and citation cleanup
  const parsed = parseImportedLessonContent(
    JSON.stringify({
      sectionId: 'sec-01',
      dayIndex: 1,
      date: '2026-11-13',
      title: '反相比例与非理想误差分析',
      summary: '掌握闭环电压增益 $A_{uf}$（反相闭环电压放大倍数）与温漂误差分析。',
      keyPoints: ['品质因数 $Q$（表征谐振回路选频特性的无量纲参数）'],
      markdownBody: [
        '## 一、基本反相比例运算电路',
        '设输入信号经输入电阻 $R_1$ 接入运放反相端，反馈支路跨接反馈电阻 $R_f = 100\\,\\text{k}\\Omega$。',
        '当环境温度升高时，运放输入失调电流温漂 $\\Delta I_{I_O} = 20\\,\\text{nA}$。',
        '',
        '| 符号 | 物理含义 | 单位 |',
        '| --- | --- | --- |',
        '| $K_{CMR}$ | 共模抑制比 | $\\text{dB}$ |',
        '',
        '由此推导闭环增益与相对误差：',
        '$$A_{uf} = -\\frac{R_f}{R_1}, \\quad |\\delta| = \\frac{\\Delta U_{I_O} + \\Delta I_{I_O} R}{u_I}$$',
      ].join('\n'),
      symbolGlossary: [
        {
          symbol: '\\Delta U_{I_O}',
          name: '输入失调电压温漂 [cite: 12]',
          definition: '温度变化引起的等效输入失调电压漂移量 [cite: 13]',
          unit: '\\text{mV}',
        },
      ],
      exercises: [],
    }),
    {
      id: 'sec-01',
      dayIndex: 1,
      date: '2026-11-13',
      title: '反相比例',
      objective: '掌握推导',
      keyTopics: ['虚短'],
    },
    'chat'
  );

  assert.equal(parsed.lesson.symbolGlossary?.length, 1);
  assert.equal(parsed.lesson.symbolGlossary?.[0].name, '输入失调电压温漂');
  assert.equal(parsed.lesson.symbolGlossary?.[0].definition.includes('cite'), false);

  const index = buildLessonSymbolIndex(parsed.lesson);
  // Mined from summary/keyPoints (-1 offset)
  const auf = lookupSymbolInIndex(index, 'A_{uf}');
  assert.ok(auf);
  assert.equal(auf.definedAtChar, -1);
  assert.equal(auf.name.includes('反相闭环电压放大倍数'), true);

  const qSym = lookupSymbolInIndex(index, 'Q');
  assert.ok(qSym);
  assert.equal(qSym.definedAtChar, -1);

  // Mined from preceding prose (offset >= 0)
  const rf = lookupSymbolInIndex(index, 'R_f');
  assert.ok(rf);
  assert.equal(rf.name, '反馈电阻');
  assert.equal(rf.unit, 'kΩ');
  assert.equal(rf.definedAtChar >= 0, true);

  const r1 = lookupSymbolInIndex(index, 'R_1');
  assert.ok(r1);
  assert.equal(r1.name, '输入电阻');

  const deltaIio = lookupSymbolInIndex(index, 'ΔIIO');
  assert.ok(deltaIio);
  assert.equal(deltaIio.name.includes('输入失调电流温漂'), true);
  assert.equal(deltaIio.unit, 'nA');

  // Mined from markdown table
  const kcmr = lookupSymbolInIndex(index, 'K_{CMR}');
  assert.ok(kcmr);
  assert.equal(kcmr.name, '共模抑制比');

  // Merged from symbolGlossary
  const deltaUio = lookupSymbolInIndex(index, '\\Delta U_{I_O}');
  assert.ok(deltaUio);
  assert.equal(deltaUio.name, '输入失调电压温漂');
  assert.equal(deltaUio.source, 'glossary');
});

test('dual-axis learner baseline + target depth resolves independently and composes zero-base + deep-rigorous prompts without reducing target depth', async () => {
  const {
    composeCoursewareSystemPrompt,
    buildSyllabusUserPrompt,
    buildCourseLessonUserPrompt,
    resolveLearnerProfile,
  } = await import('../prompts/promptLibrary');

  // 1. Zero-base + Deep-rigorous ("从零开始学模电，但上来就要学明白第六章")
  const profileZeroDeep = resolveLearnerProfile({
    learnerBaseline: 'zero_base',
    learningDepth: 'deep_rigorous',
  });
  assert.equal(profileZeroDeep.baseline, 'zero_base');
  assert.equal(profileZeroDeep.depth, 'deep_rigorous');
  assert.equal(profileZeroDeep.legacyLevel, 'advanced');
  assert.equal(profileZeroDeep.combinedLabel.includes('零基础'), true);
  assert.equal(profileZeroDeep.combinedLabel.includes('深度钻研'), true);
  assert.equal(profileZeroDeep.strategySummary.includes('不删减难度'), true);

  const sysPrompt = composeCoursewareSystemPrompt({
    subjectProfile: 'electronics_engineering',
    learnerBaseline: 'zero_base',
    learningDepth: 'deep_rigorous',
  });
  assert.equal(sysPrompt.includes('学习起点：零基础'), true);
  assert.equal(sysPrompt.includes('目标深度：深度钻研与高阶拓展'), true);
  assert.equal(
    sysPrompt.includes('严禁以零基础为由删减核心连续推导'),
    true
  );
  assert.equal(sysPrompt.includes('symbolGlossary'), true);

  // 2. Custom free-text baseline and custom target depth
  const customSysPrompt = composeCoursewareSystemPrompt({
    subjectProfile: 'electronics_engineering',
    learnerBaseline: 'custom',
    customLearnerBaseline: '学过高中物理与一元微积分，没学过电路分析与复数相量',
    learningDepth: 'custom',
    customLearningDepth: '直接吃透模电第六章反相求和、积分温漂误差与二阶有源滤波器推导',
  });
  assert.equal(
    customSysPrompt.includes('学过高中物理与一元微积分，没学过电路分析与复数相量'),
    true
  );
  assert.equal(
    customSysPrompt.includes('直接吃透模电第六章反相求和、积分温漂误差与二阶有源滤波器推导'),
    true
  );

  // 3. Syllabus & Lesson user prompts include dual-axis combined summary
  const syllabusUser = buildSyllabusUserPrompt({
    name: '模拟电子技术基础（第六章）',
    category: 'stem',
    learnerBaseline: 'zero_base',
    learningDepth: 'master_textbook',
    goal: '从零开始学明白第六章运算电路与有源滤波',
    durationDays: 7,
    extraRequirements: '',
    materials: [],
  });
  assert.equal(syllabusUser.includes('我的当前水平：零基础'), true);
  assert.equal(syllabusUser.includes('我的学习目标深度：学透核心原理与典型题型'), true);

  const slot = {
    id: 'sec-01',
    dayIndex: 1,
    date: '2026-11-13',
    title: '第 1 讲：比例与加减运算电路',
    objective: '掌握虚短与虚断推导',
    keyTopics: ['虚短', '虚断'],
  };
  const lessonUser = buildCourseLessonUserPrompt({
    course: {
      id: 'c-dual',
      name: '模拟电子技术基础',
      category: 'stem',
      learnerBaseline: 'custom',
      customLearnerBaseline: '仅懂欧姆定律，零模电基础',
      learningDepth: 'deep_rigorous',
      goal: '学透第六章',
      startDate: '2026-11-13',
      durationDays: 7,
      extraRequirements: '',
      materials: [],
      dailyPlan: [slot],
      masteredWords: [],
      exerciseSubmissions: {},
      createdAt: '2026-11-13T00:00:00Z',
    },
    slot,
    materialContext: '',
  });
  assert.equal(lessonUser.includes('自定义水平：仅懂欧姆定律，零模电基础'), true);
  assert.equal(lessonUser.includes('深度钻研与高阶拓展'), true);

  // 4. Language category dynamically switches baseline/depth option copy and unified strategy summary
  const { getBaselinePresetOptions, getDepthPresetOptions } = await import(
    '../prompts/promptLibrary'
  );
  const stemBaselines = getBaselinePresetOptions('stem');
  const engBaselines = getBaselinePresetOptions('english');
  assert.notEqual(stemBaselines[1].title, engBaselines[1].title);
  assert.equal(engBaselines[1].title.includes('常规基础'), true);

  const stemDepths = getDepthPresetOptions('stem');
  const engDepths = getDepthPresetOptions('english');
  assert.notEqual(stemDepths[1].title, engDepths[1].title);
  assert.equal(engDepths[1].title.includes('精读教材'), true);

  const engProfile = resolveLearnerProfile({
    category: 'english',
    learnerBaseline: 'zero_base',
    learningDepth: 'master_textbook',
  });
  assert.equal(engProfile.combinedLabel.includes('语言零基础'), true);
  assert.equal(engProfile.combinedLabel.includes('吃透精读教材'), true);
  assert.equal(engProfile.strategySummary.includes('语言跨阶强攀升策略'), true);
});

test('browsingState utilities sanitize, merge local vs server state, and reconcile against courses', async () => {
  const {
    computeBrowsingViewKey,
    sanitizeBrowsingState,
    selectNewestBrowsingState,
    reconcileBrowsingStateWithCourses,
  } = await import('./browsingState');

  assert.equal(
    computeBrowsingViewKey({ activeLessonRef: { courseId: 'c1', dayIndex: 3 } }),
    'lesson:c1:3'
  );
  assert.equal(
    computeBrowsingViewKey({ focusedDate: '2026-11-13' }),
    'daily:2026-11-13'
  );
  assert.equal(
    computeBrowsingViewKey({ selectedCourseFilter: 'c1' }),
    'timeline:c1'
  );

  const localState = sanitizeBrowsingState({
    view: 'lesson',
    selectedCourseFilter: 'c1',
    focusedDate: '2026-11-13',
    activeLessonRef: { courseId: 'c1', dayIndex: 2 },
    scrollY: 640,
    scrollMap: { 'timeline:all': 310, 'lesson:c1:2': 640 },
    updatedAt: '2026-11-13T18:00:00.000Z',
  });
  const serverState = sanitizeBrowsingState({
    view: 'lesson',
    selectedCourseFilter: 'c1',
    focusedDate: '2026-11-13',
    activeLessonRef: { courseId: 'c1', dayIndex: 2 },
    scrollY: 920,
    scrollMap: { 'lesson:c1:2': 920, 'daily:2026-11-13': 140 },
    updatedAt: '2026-11-13T18:05:00.000Z',
  });

  const merged = selectNewestBrowsingState(localState, serverState);
  assert.ok(merged);
  assert.equal(merged.scrollY, 920);
  assert.equal(merged.scrollMap?.['timeline:all'], 310);
  assert.equal(merged.scrollMap?.['lesson:c1:2'], 920);
  assert.equal(merged.scrollMap?.['daily:2026-11-13'], 140);

  const sampleCourse = {
    id: 'c1',
    name: '模拟电子技术',
    category: 'stem' as const,
    level: 'intermediate' as const,
    goal: '掌握第6章',
    startDate: '2026-11-12',
    durationDays: 2,
    extraRequirements: '',
    materials: [],
    dailyPlan: [
      { id: 'sec-01', dayIndex: 1, date: '2026-11-12', title: '第1讲', objective: '', prerequisites: [], keyTopics: [] },
      { id: 'sec-02', dayIndex: 2, date: '2026-11-13', title: '第2讲', objective: '', prerequisites: [], keyTopics: [] },
    ],
    masteredWords: [],
    exerciseSubmissions: {},
    createdAt: '2026-11-12T00:00:00Z',
  };

  const reconciledValid = reconcileBrowsingStateWithCourses(merged, [sampleCourse]);
  assert.ok(reconciledValid);
  assert.equal(reconciledValid.view, 'lesson');
  assert.deepEqual(reconciledValid.activeLessonRef, { courseId: 'c1', dayIndex: 2 });
  assert.equal(reconciledValid.scrollY, 920);

  // When course is deleted, falls back gracefully to daily view (since focusedDate is set) and resets selectedCourseFilter to 'all'
  const reconciledDeleted = reconcileBrowsingStateWithCourses(merged, []);
  assert.ok(reconciledDeleted);
  assert.equal(reconciledDeleted.selectedCourseFilter, 'all');
  assert.equal(reconciledDeleted.activeLessonRef, null);
  assert.equal(reconciledDeleted.view, 'daily');
  assert.equal(reconciledDeleted.scrollY, 140);
});

test('incremental courseware repair prompt, raw audit diagnostics, and applyCoursewareRepairPatch merge fixes without full regeneration', async () => {
  const {
    auditCoursewareRendering,
    auditRawCoursewareInput,
    applyCoursewareRepairPatch,
  } = await import('./coursewareDiagnostics');

  const cleanBaseLesson = {
    sectionId: 'sec-01',
    dayIndex: 1,
    date: '2026-11-13',
    title: '第 1 讲：积分运算与有源滤波',
    summary: '保留的本讲核心概要：利用虚短虚断推导积分器传递函数。',
    keyPoints: ['积分器传递函数 $H(s) = -\\frac{1}{sRC}$'],
    markdownBody:
      '## 一、保留的完整推导段落\n这是已经生成好的长篇推导正文，包含占位符 $\\frac{1}{1}$ 以及图示引用 (图 {{diagram:diag-3b}})。',
    diagrams: [
      {
        id: 'diag-4c',
        title: '二阶低通滤波器',
        caption: '已有图示',
        svgCode: '<svg viewBox="0 0 680 320"><text x="20" y="40">已有合法 SVG</text></svg>',
      },
    ],
    heuristicQuestions: [
      {
        id: 'hq-1',
        context: '保留的启发式铺垫',
        question: '为什么积分电容并联大电阻？',
        answerReveal: '防止直流失调饱和。',
      },
    ],
    exercises: [
      {
        id: 'ex-1',
        stage: 'inline' as const,
        type: 'fill' as const,
        difficulty: 'basic' as const,
        question: '保留的练习题：开关电容 $C_1 = 2\\text{pF}$，求等效电阻。',
        answer: '5',
        explanation: '完整保留的解析。',
      },
    ],
    reverseChecks: [],
    generatedAt: '2026-11-13T10:00:00.000Z',
    sourceMode: 'chat' as const,
  };

  // 1. Diagnostics detect unclosed math, bare backslash commands, and missing diagram, generating incremental patch prompt
  const brokenLesson = {
    ...cleanBaseLesson,
    keyPoints: ['未闭合公式 $u_O = -R_f u_I'],
    diagrams: [
      {
        id: 'diag-4c',
        title: '二阶低通滤波器',
        caption: '损坏 SVG',
        svgCode: '<svg viewBox="0 0 680 320"><text x="20" y="40">no close tag',
      },
    ],
  };

  const preReport = auditCoursewareRendering(brokenLesson);
  assert.equal(preReport.hasErrors, true);
  assert.equal(preReport.repairPrompt.includes('不要重新生成整节完整课件'), true);
  assert.equal(preReport.repairPrompt.includes('textReplacements'), true);
  assert.equal(preReport.repairPrompt.includes('diagramsToUpsert'), true);

  // 2. Incremental JSON patch supplies ONLY fixes + missing diagram diag-3b while preserving all existing content
  const patchJson = JSON.stringify({
    textReplacements: [
      {
        target: '$\\frac{1}{1}$',
        replacement: '$\\frac{1}{sRC}$',
      },
    ],
    diagramsToUpsert: [
      {
        id: 'diag-3b',
        title: '图 3b：开关电容等效电阻电路',
        caption: '两相时钟控制的开关电容单元',
        svgCode:
          '<svg viewBox="0 0 680 260" xmlns="http://www.w3.org/2000/svg"><text x="30" y="50">C_1 = 2pF</text></svg>',
      },
    ],
  });

  const slotInfo = {
    id: 'sec-01',
    dayIndex: 1,
    date: '2026-11-13',
    title: '第 1 讲：积分运算与有源滤波',
    objective: '掌握积分器与开关电容',
    keyTopics: ['积分器'],
  };

  const patchedResult = applyCoursewareRepairPatch(cleanBaseLesson, patchJson, slotInfo);
  assert.equal(patchedResult.appliedMode, 'patch_json');
  assert.equal(patchedResult.mergedLesson.markdownBody.includes('保留的完整推导段落'), true);
  assert.equal(patchedResult.mergedLesson.markdownBody.includes('$\\frac{1}{sRC}$'), true);
  assert.equal(patchedResult.mergedLesson.heuristicQuestions?.length, 1);
  assert.equal(patchedResult.mergedLesson.exercises.length, 1);
  assert.equal(patchedResult.mergedLesson.diagrams?.length, 2);

  const finalAudit = auditCoursewareRendering(patchedResult.mergedLesson);
  assert.equal(finalAudit.hasErrors, false);
  assert.equal(finalAudit.errorCount, 0);

  // 3. Bare <svg>...</svg> snippet also merges directly into missing diagram slot
  const bareSvgPatched = applyCoursewareRepairPatch(
    cleanBaseLesson,
    '<svg viewBox="0 0 680 240"><text x="20" y="40">diag-3b bare svg</text></svg>',
    slotInfo
  );
  assert.equal(bareSvgPatched.appliedMode, 'bare_svg');
  assert.equal(auditCoursewareRendering(bareSvgPatched.mergedLesson).errorCount, 0);

  // 4. Raw broken JSON input reports json_syntax_error clearly via auditRawCoursewareInput (without silent auto-repair)
  const rawAuditBroken = auditRawCoursewareInput('{"title": "broken', slotInfo);
  assert.ok(rawAuditBroken);
  assert.equal(rawAuditBroken.report.hasErrors, true);
  assert.equal(rawAuditBroken.report.issues[0]?.category, 'json_syntax_error');
});

test('allocateSectionsToDays balances estimatedMinutes across days and preserves lessons on reallocation', () => {
  const sampleLesson = {
    dayIndex: 1,
    date: '2026-11-01',
    title: '第 1 讲',
    summary: '已有课件摘要',
    markdownBody: '保留的原课件正文。',
    keyPoints: ['KCL'],
    heuristicQuestions: [],
    exercises: [],
    reverseChecks: [],
    diagramCheckPassed: true,
    generatedAt: '2026-11-01T00:00:00.000Z',
  };

  const sections = [40, 35, 50, 45, 30, 60].map((mins, idx) => ({
    id: `sec-0${idx + 1}`,
    dayIndex: idx + 1,
    date: '2026-11-01',
    title: `第 ${idx + 1} 节`,
    objective: `目标 ${idx + 1}`,
    keyTopics: [`主题${idx + 1}`],
    prerequisites: [],
    estimatedMinutes: mins,
    lesson: idx === 0 ? sampleLesson : undefined,
  }));

  // 1. M > N (6 sections into 3 days)
  const allocated3 = allocateSectionsToDays(sections, 3, '2026-11-01');
  assert.equal(allocated3.length, 6);
  assert.deepEqual(
    allocated3.map((s) => s.dayIndex),
    [1, 2, 3, 4, 5, 6]
  );
  // Order is monotonic and non-decreasing in scheduledDay across 1..3
  for (let i = 1; i < allocated3.length; i++) {
    assert.equal(
      (allocated3[i].scheduledDay || 0) >= (allocated3[i - 1].scheduledDay || 0),
      true
    );
  }
  const dayBuckets3 = buildCourseDailySchedule(allocated3, 3, '2026-11-01');
  assert.equal(dayBuckets3.length, 3);
  assert.equal(
    dayBuckets3.reduce((sum, d) => sum + d.sectionIds.length, 0),
    6
  );
  assert.equal(allocated3[0].lesson?.markdownBody, '保留的原课件正文。');

  // 2. Reallocate to durationDays = 2 and durationDays = 6 without losing lesson
  const allocated2 = allocateSectionsToDays(allocated3, 2, '2026-11-05');
  assert.equal(allocated2[0].date, '2026-11-05');
  assert.equal(allocated2[0].lesson?.summary, '已有课件摘要');
  const maxDay2 = Math.max(...allocated2.map((s) => s.scheduledDay || 0));
  assert.equal(maxDay2 <= 2, true);

  // 3. M < N (2 sections into 5 days)
  const fewSections = sections.slice(0, 2);
  const allocatedFew = allocateSectionsToDays(fewSections, 5, '2026-11-01');
  assert.equal(allocatedFew.length, 2);
  assert.equal(
    allocatedFew.every((s) => (s.scheduledDay || 0) >= 1 && (s.scheduledDay || 0) <= 5),
    true
  );

  // 4. getSlotExerciseSubmission prefers sectionId and falls back to legacy date
  const fakeCourse: any = {
    exerciseSubmissions: {
      '2026-11-01': { date: '2026-11-01', score: 1, total: 2, userAnswers: { q1: 'A' }, submittedAt: '' },
      'sec-02': { sectionId: 'sec-02', date: '2026-11-01', score: 2, total: 2, userAnswers: { q1: 'B' }, submittedAt: '' },
    },
  };
  assert.equal(
    getSlotExerciseSubmission(fakeCourse, { ...sections[0], id: 'sec-01', date: '2026-11-01' })?.score,
    1
  );
  assert.equal(
    getSlotExerciseSubmission(fakeCourse, { ...sections[1], id: 'sec-02', date: '2026-11-01' })?.score,
    2
  );
});

test('parseImportedSyllabusContent supports unconstrained sections + estimatedMinutes and legacy outline.json', async () => {
  const { parseImportedSyllabusContent } = await import('./coursewareParser');

  const rawUnconstrained = JSON.stringify({
    sections: [
      { sectionId: 'sec-01', title: '1.1 节点分析基础', objective: '掌握KCL方程', keyTopics: ['KCL'], estimatedMinutes: 40, regionId: 'region-01' },
      { sectionId: 'sec-02', title: '1.2 戴维南定理', objective: '掌握等效电阻求解', keyTopics: ['戴维南'], estimatedMinutes: 55, regionId: 'region-02' },
      { sectionId: 'sec-03', title: '1.3 运放虚短虚断', objective: '建立理想运放模型', keyTopics: ['运放'], estimatedMinutes: 50, regionId: 'region-03' },
      { sectionId: 'sec-04', title: '1.4 反相与同相比例', objective: '推导闭环增益', keyTopics: ['比例电路'], estimatedMinutes: 45, regionId: 'region-04' },
      { sectionId: 'sec-05', title: '1.5 积分与微分电路', objective: '分析复频域响应', keyTopics: ['积分器'], estimatedMinutes: 60, regionId: 'region-05' },
    ],
  });

  // Course durationDays is 3 while syllabus produces 5 sections
  const parsedNew = parseImportedSyllabusContent(rawUnconstrained, '2026-11-01', 3);
  assert.equal(parsedNew.dailyPlan.length, 5);
  assert.deepEqual(
    parsedNew.dailyPlan.map((s) => s.id),
    ['sec-01', 'sec-02', 'sec-03', 'sec-04', 'sec-05']
  );
  assert.deepEqual(
    parsedNew.dailyPlan.map((s) => s.estimatedMinutes),
    [undefined, undefined, undefined, undefined, undefined]
  );
  assert.equal(
    parsedNew.dailyPlan.every((s) => (s.scheduledDay || 0) >= 1 && (s.scheduledDay || 0) <= 3),
    true
  );

  // Backward compatibility check against legacy courses/模电_example/模电/outline.json
  const legacyOutlinePath = path.resolve(
    process.cwd(),
    'courses',
    '模电_example',
    '模电',
    'outline.json'
  );
  assert.equal(fs.existsSync(legacyOutlinePath), true);
  const legacyRaw = fs.readFileSync(legacyOutlinePath, 'utf-8');
  const legacyParsed = parseImportedSyllabusContent(legacyRaw, '2026-11-01', 4);
  assert.equal(legacyParsed.dailyPlan.length >= 1, true);
  assert.equal(
    legacyParsed.dailyPlan.every((s) => estimateSectionMinutesFallback(s) >= 10),
    true
  );
  assert.equal(
    legacyParsed.dailyPlan.every((s) => (s.scheduledDay || 0) >= 1),
    true
  );
});

test('parseImportedLessonContent parses prerequisiteCheck, topologySpec, remediation and variantCheck', async () => {
  const { parseImportedLessonContent } = await import('./coursewareParser');

  const slot = {
    id: 'sec-01',
    dayIndex: 1,
    date: '2026-11-01',
    title: '第 1 讲：反相放大器与反馈闭环',
    objective: '掌握虚短虚断与闭环增益推导',
    keyTopics: ['虚短虚断', '反相放大器'],
    prerequisites: ['KCL 节点电流定律'],
  };

  const payload = JSON.stringify({
    title: slot.title,
    summary: '围绕虚短虚断建立反相放大器分析闭环。',
    estimatedMinutes: 65,
    teachingContext: {
      prerequisites: ['KCL 节点电流定律'],
      prerequisiteCheck: '请先确认当反相输入端为虚地时，$i_{R_1} = V_{\\text{in}}/R_1$。',
      teachingScope: '第 2 章 2.1–2.2 节',
      learningObjectives: ['推导 $A_v = -R_f/R_1$'],
      connectionNote: '为下节同相与差分放大电路铺垫。',
    },
    diagrams: [
      {
        id: 'diag-01',
        title: '图 1：反相比例运算电路',
        caption: '标准负反馈拓扑',
        topologySpec: '节点N-连接R1左端(接Vin)与Rf左端(接Vout)，N+直接接地，参考电流i1由Vin流向N-。',
        svgCode: '<svg viewBox="0 0 600 260" xmlns="http://www.w3.org/2000/svg"><text x="20" y="40">Vout</text></svg>',
      },
    ],
    markdownBody: [
      '> [!TEXTBOOK] 教材核心定义',
      '> 理想运放开环增益 $A_{od} \\to \\infty$ 时，$u_+ \\approx u_-$。',
      '',
      '> [!INTUITION] 物理直觉',
      '> 负反馈会把反相端拉回与同相端相等的电位。',
    ].join('\n'),
    exercises: [
      {
        id: 'ex-1',
        type: 'choice',
        question: '若 $R_1 = 2\\text{ k}\\Omega, R_f = 10\\text{ k}\\Omega$，闭环电压增益为多少？',
        options: ['A. $-5$', 'B. $5$', 'C. $-6$', 'D. $6$'],
        answer: 'A',
        explanation: '由虚地节点方程得 $A_v = -R_f / R_1 = -5$。',
        wrongOptionsAnalysis: '选 C 误套用了同相放大公式 $1 + R_f/R_1$。',
        remediation: '区分信号输入端：反相端输入时，反馈电阻与输入电阻共节点但同相端接地。',
        topologySpec: '反相端接入R1=2kΩ，反馈支路Rf=10kΩ，同相端直接接地。',
        variantCheck: {
          question: '若保持反相输入不变，将 $R_f$ 改为 $20\\text{ k}\\Omega$，增益变为多少？',
          options: ['A. $-10$', 'B. $10$', 'C. $-11$'],
          answer: 'A',
          explanation: '$A_v = -20 / 2 = -10$。',
        },
      },
    ],
  });

  const parsed = parseImportedLessonContent(payload, slot);
  assert.equal(
    parsed.lesson.teachingContext?.prerequisiteCheck?.includes('i_{R_1}'),
    true
  );
  assert.equal(
    parsed.lesson.diagrams?.[0]?.topologySpec?.includes('参考电流'),
    true
  );
  assert.equal(
    parsed.lesson.exercises[0]?.remediation?.includes('同相端接地'),
    true
  );
  assert.equal(
    parsed.lesson.exercises[0]?.topologySpec?.includes('Rf=10kΩ'),
    true
  );
  const vc = parsed.lesson.exercises[0]?.variantCheck;
  assert.equal(typeof vc === 'object' && vc.answer === 'A', true);
  assert.equal(parsed.lesson.estimatedMinutes, estimateWrittenLessonMinutes(parsed.lesson));
  assert.notEqual(parsed.lesson.estimatedMinutes, 65);
  assert.equal(
    estimateSectionMinutesFallback({
      ...slot,
      estimatedMinutes: 45,
      lesson: parsed.lesson,
    }),
    parsed.lesson.estimatedMinutes
  );

  // When estimatedMinutes is omitted in an imported lesson, parseImportedLessonContent estimates it from written content
  const parsedNoMinutes = parseImportedLessonContent(
    JSON.stringify({ title: slot.title, markdownBody: '推导正文 $u_O = -\\frac{R_f}{R_1} u_I$' }),
    slot
  );
  assert.equal(parsedNoMinutes.lesson.estimatedMinutes, estimateWrittenLessonMinutes(parsedNoMinutes.lesson));
});

test('renderMarkdownWithLatex transforms dark-mode semantic callouts cleanly', async () => {
  const { renderMarkdownWithLatex } = await import('./markdownMath');
  const md = [
    '> [!TEXTBOOK] 教材定理',
    '> 对节点 $A$ 列写 KCL：$I_1 + I_2 = 0$。',
    '',
    '> [!PREREQ] 先修复习',
    '> 回顾欧姆定律 $I = V/R$。',
    '',
    '> [!INTUITION] 工程直觉',
    '> 电容电压不能突变。',
    '',
    '> [!EXTENSION] 失效边界',
    '> 高频下运放增益带宽积限制理想虚短。',
  ].join('\n');

  const html = renderMarkdownWithLatex(md);
  assert.equal(html.includes('lesson-callout-plain'), true);
  assert.equal(html.includes('lesson-callout-textbook'), false);
  assert.equal(html.includes('教材正文'), false);
  assert.equal(html.includes('lesson-callout-prereq'), false);
  assert.equal(html.includes('先修补充'), false);
  assert.equal(html.includes('lesson-callout-intuition'), false);
  assert.equal(html.includes('直观解释'), false);
  assert.equal(html.includes('lesson-callout-extension'), false);
  assert.equal(html.includes('边界与拓展'), false);
  assert.equal(html.includes('教材定理'), true);
  assert.equal(html.includes('失效边界'), true);
});

test('auditCoursewareRendering detects duplicate_id and placeholder_error; applyCoursewareRepairPatch patches teachingContext and prefix; buildStageRepairPrompt scopes stages', async () => {
  const {
    auditCoursewareRendering,
    applyCoursewareRepairPatch,
    buildStageRepairPrompt,
  } = await import('./coursewareDiagnostics');

  const brokenLesson: any = {
    title: '第 1 讲：检测测试',
    summary: '摘要',
    markdownBody: '正文推导待补充。\n\n{{diagram:diag-1}}',
    diagrams: [
      { id: 'diag-1', title: '图 1', caption: '', svgCode: '<svg viewBox="0 0 100 100"></svg>' },
      { id: 'diag-1', title: '图 2', caption: '', svgCode: '<svg viewBox="0 0 100 100"></svg>' },
    ],
    exercises: [
      {
        id: 'ex-1',
        type: 'fill',
        question: '请推导结果',
        answer: 'TODO',
        explanation: '略',
      },
      {
        id: 'ex-1',
        type: 'fill',
        question: '第二题',
        answer: '5V',
        explanation: '正常解析',
      },
    ],
  };

  const report = auditCoursewareRendering(brokenLesson);
  assert.equal(report.hasErrors, true);
  assert.equal(report.issues.some((i) => i.category === 'duplicate_id'), true);
  assert.equal(report.issues.some((i) => i.category === 'placeholder_error'), true);

  const patchRes = applyCoursewareRepairPatch(
    brokenLesson,
    JSON.stringify({
      teachingContextPatch: {
        prerequisiteCheck: '先修检验：确认节点电势参考点为地电位 $0\\text{ V}$。',
      },
      markdownBodyPrefixPrepend: '> [!PREREQ] 补全先修\n> 参考方向从高电位指向低电位。\n\n',
    }),
    {
      id: 'sec-01',
      dayIndex: 1,
      date: '2026-11-01',
      title: '第 1 讲',
      objective: '目标',
      keyTopics: ['KCL'],
    }
  );
  assert.equal(
    patchRes.mergedLesson.teachingContext?.prerequisiteCheck?.includes('地电位'),
    true
  );
  assert.equal(
    patchRes.mergedLesson.markdownBody.startsWith('> [!PREREQ] 补全先修'),
    true
  );

  const stagePromptEx = buildStageRepairPrompt({
    course: {
      id: 'c-1',
      name: '模拟电子技术',
      category: 'math_science',
      goal: '掌握运放与反馈',
      durationDays: 3,
      startDate: '2026-11-01',
      materials: [],
      dailyPlan: [],
    } as any,
    slot: {
      id: 'sec-01',
      dayIndex: 1,
      date: '2026-11-01',
      title: '第 1 讲：反相放大器',
      objective: '推导闭环增益',
      keyTopics: ['反相放大器'],
      lesson: brokenLesson,
    },
    stage: 'exercises_feedback',
    issueSummary: '- 练习缺少 remediation',
  });
  assert.equal(stagePromptEx.includes('exercises'), true);
  assert.equal(stagePromptEx.includes('remediation'), true);

  const stagePromptDiag = buildStageRepairPrompt({
    course: {
      id: 'c-1',
      name: '模拟电子技术',
      category: 'math_science',
      goal: '掌握运放与反馈',
      durationDays: 3,
      startDate: '2026-11-01',
      materials: [],
      dailyPlan: [],
    } as any,
    slot: {
      id: 'sec-01',
      dayIndex: 1,
      date: '2026-11-01',
      title: '第 1 讲：反相放大器',
      objective: '推导闭环增益',
      keyTopics: ['反相放大器'],
      lesson: brokenLesson,
    },
    stage: 'diagrams_topology',
  });
  assert.equal(stagePromptDiag.includes('topologySpec'), true);
});

test('getEvaluatedSectionMinutes, allocateSectionsToDays, parseImportedSyllabusContent and Step 1/2 prompts do not fabricate minutes or couple with durationDays/startDate', async () => {
  const { parseImportedSyllabusContent } = await import('./coursewareParser');
  const {
    buildAgentSyllabusPrompt,
    buildChatSyllabusPrompt,
  } = await import('../prompts/promptLibrary');

  // 1. Unassessed outline sections keep estimatedMinutes undefined
  const unassessedOutline = JSON.stringify({
    sections: [
      {
        sectionId: 'sec-01',
        title: '6.1 集成运放运算电路',
        objective: '掌握虚短虚断',
        keyTopics: ['反相比例', '同相比例', '差分运算'],
        regionId: 'region-01',
      },
      {
        sectionId: 'sec-02',
        title: '6.2 有源滤波电路',
        objective: '理解一阶与二阶滤波',
        keyTopics: ['低通滤波', '高通滤波'],
        regionId: 'region-02',
      },
    ],
  });
  const parsed = parseImportedSyllabusContent(unassessedOutline, '2026-11-14', 15);
  assert.equal(parsed.dailyPlan.length, 2);
  assert.equal(parsed.dailyPlan[0].estimatedMinutes, undefined);
  assert.equal(parsed.dailyPlan[1].estimatedMinutes, undefined);
  assert.equal(getEvaluatedSectionMinutes(parsed.dailyPlan[0]), undefined);

  const reallocated = allocateSectionsToDays(parsed.dailyPlan, 2, '2026-11-14');
  assert.equal(reallocated[0].estimatedMinutes, undefined);
  assert.equal(reallocated[1].estimatedMinutes, undefined);

  const scheduleBeforeLessons = buildCourseDailySchedule(reallocated, 2, '2026-11-14');
  assert.equal(scheduleBeforeLessons[0].estimatedMinutes, 0);

  // Once a lesson has evaluated estimatedMinutes, getEvaluatedSectionMinutes & schedule reflect it
  const withLessonSlot = {
    ...reallocated[0],
    lesson: {
      dayIndex: 1,
      date: '2026-11-14',
      title: '6.1',
      estimatedMinutes: 65,
      summary: 'summary',
      keyPoints: ['KCL'],
      markdownBody: 'content',
      exercises: [],
      generatedAt: '2026-11-14T00:00:00.000Z',
    },
  };
  assert.equal(getEvaluatedSectionMinutes(withLessonSlot), 3);
  const afterEval = allocateSectionsToDays([withLessonSlot, reallocated[1]], 2, '2026-11-14');
  assert.equal(afterEval[0].estimatedMinutes, estimateWrittenLessonMinutes(afterEval[0].lesson!));
  assert.equal(afterEval[1].estimatedMinutes, undefined);
  const scheduleAfterEval = buildCourseDailySchedule(afterEval, 2, '2026-11-14');
  assert.equal(scheduleAfterEval[0].estimatedMinutes, afterEval[0].estimatedMinutes);
  assert.equal(getEvaluatedSectionMinutes({ ...afterEval[0], lesson: undefined }), undefined);

  // 2. Step 1 & Step 2 prompts do not leak durationDays, startDate, or "dayIndex"
  const testCourse = {
    id: 'course-decoupled',
    name: '模电测试',
    category: 'stem' as const,
    generationMode: 'chat' as const,
    subjectProfile: 'electronics_engineering' as const,
    goal: '掌握第6-7章',
    durationDays: 17,
    startDate: '2028-09-01',
    extraRequirements: '',
    materials: [],
    masteredWords: [],
    exerciseSubmissions: {},
    dailyPlan: [],
    createdAt: '2026-11-14T00:00:00.000Z',
  };
  const chatSyllabusPrompt = buildChatSyllabusPrompt({ course: testCourse });
  assert.equal(chatSyllabusPrompt.includes('2028-09-01'), false);
  assert.equal(chatSyllabusPrompt.includes('17'), false);
  assert.equal(chatSyllabusPrompt.includes('"dayIndex"'), false);

  const agentSyllabusPrompt = buildAgentSyllabusPrompt({
    course: testCourse,
    workspaceDir: 'courses/模电测试',
  });
  assert.equal(agentSyllabusPrompt.includes('2028-09-01'), false);
  assert.equal(agentSyllabusPrompt.includes('17'), false);
  assert.equal(agentSyllabusPrompt.includes('"dayIndex"'), false);

  const syllabusApiPrompt = buildSyllabusUserPrompt({
    name: '模电测试',
    category: 'stem',
    goal: '掌握第6-7章',
    durationDays: 17,
    extraRequirements: '',
    materials: [],
  });
  assert.equal(syllabusApiPrompt.includes('17'), false);
  assert.equal(syllabusApiPrompt.includes('"dayIndex"'), false);

  const splitPrompts = buildPdfSplitPrompts({
    course: testCourse,
    pdfMetas: [
      {
        fileName: 'analog.pdf',
        totalPages: 120,
        detectedPageOffset: 0,
        tocEntries: [],
        pages: [{ physicalPage: 1, textPreview: 'Chapter 6' }],
      },
    ],
    courseRelDir: 'courses/模电测试',
  });
  assert.equal(splitPrompts.apiUserPrompt.includes('"dayIndex"'), false);
  assert.equal(splitPrompts.agentSplitPrompt.includes('"dayIndex"'), false);
  assert.equal(splitPrompts.chatSplitPrompt.includes('"dayIndex"'), false);
});

test('multi-region PDF binding ensures 100% coverage across sections including merged tail/middle regions', async () => {
  const {
    extractReferencedRegionIds,
    resolveSlotPdfSegments,
    bindAndEnsureAllPdfRegionsCovered,
  } = await import('./learningLogic');

  assert.deepEqual(
    extractReferencedRegionIds({
      regionId: 'region-06',
      regionIds: [],
      teachingScope: '对应区域 region-06（6.4）与 region-07（第6章小结与习题）',
      title: '第 8 节：第6章仿真与习题',
    }),
    ['region-06', 'region-07'],
  );

  const splitPlan = Array.from({ length: 13 }, (_, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    const physicalStartPage = idx * 10 + 1;
    const physicalEndPage = physicalStartPage + 9;
    return {
      sectionId: `region-${num}`,
      dayIndex: idx + 1,
      date: '',
      sectionTitle: `区域 ${num}`,
      sourceFileName: 'chap6,7.pdf',
      physicalStartPage,
      physicalEndPage,
      printedStartPage: 275 + physicalStartPage,
      printedEndPage: 275 + physicalEndPage,
      pageOffset: 275,
      segmentFileName: `region-${num}.pdf`,
      segmentRelPath: `courses/模电/segments/region-${num}.pdf`,
      status: 'sliced' as const,
      segmentPageCount: 10,
    };
  });

  const rawSlots = [
    { id: 'sec-01', dayIndex: 1, date: '', title: '第 1 节', objective: 'o1', keyTopics: [], regionId: 'region-01', teachingScope: '对应 region-01' },
    { id: 'sec-02', dayIndex: 2, date: '', title: '第 2 节', objective: 'o2', keyTopics: [], regionId: 'region-02', teachingScope: '对应 region-02' },
    { id: 'sec-03', dayIndex: 3, date: '', title: '第 3 节', objective: 'o3', keyTopics: [], regionId: 'region-02', teachingScope: '对应 region-02' },
    { id: 'sec-04', dayIndex: 4, date: '', title: '第 4 节', objective: 'o4', keyTopics: [], regionId: 'region-03', teachingScope: '对应 region-03' },
    { id: 'sec-05', dayIndex: 5, date: '', title: '第 5 节', objective: 'o5', keyTopics: [], regionId: 'region-04', teachingScope: '对应 region-04' },
    { id: 'sec-06', dayIndex: 6, date: '', title: '第 6 节', objective: 'o6', keyTopics: [], regionId: 'region-05', teachingScope: '对应 region-05' },
    { id: 'sec-07', dayIndex: 7, date: '', title: '第 7 节', objective: 'o7', keyTopics: [], regionId: 'region-06', teachingScope: '对应 region-06' },
    { id: 'sec-08', dayIndex: 8, date: '', title: '第 8 节', objective: 'o8', keyTopics: [], regionId: 'region-06', teachingScope: '对应区域 region-06 与 region-07' },
    { id: 'sec-09', dayIndex: 9, date: '', title: '第 9 节', objective: 'o9', keyTopics: [], regionId: 'region-08', teachingScope: '对应 region-08' },
    { id: 'sec-10', dayIndex: 10, date: '', title: '第 10 节', objective: 'o10', keyTopics: [], regionId: 'region-09', teachingScope: '对应 region-09' },
    { id: 'sec-11', dayIndex: 11, date: '', title: '第 11 节', objective: 'o11', keyTopics: [], regionId: 'region-10', teachingScope: '对应 region-10' },
    { id: 'sec-12', dayIndex: 12, date: '', title: '第 12 节', objective: 'o12', keyTopics: [], regionId: 'region-11', teachingScope: '对应 region-11' },
    { id: 'sec-13', dayIndex: 13, date: '', title: '第 13 节', objective: 'o13', keyTopics: [], regionId: 'region-12', teachingScope: '对应区域 region-12 与 region-13' },
  ];

  const bound = bindAndEnsureAllPdfRegionsCovered(rawSlots, splitPlan);
  const coveredSet = new Set<string>();
  for (const s of bound) {
    for (const seg of resolveSlotPdfSegments(s, splitPlan)) {
      coveredSet.add(seg.sectionId);
    }
  }
  assert.equal(coveredSet.size, 13);
  assert.deepEqual(bound[7].regionIds, ['region-06', 'region-07']);
  assert.deepEqual(bound[7].pdfSegments?.map((s) => s.segmentFileName), ['region-06.pdf', 'region-07.pdf']);
  assert.deepEqual(bound[12].regionIds, ['region-12', 'region-13']);
  assert.deepEqual(bound[12].pdfSegments?.map((s) => s.segmentFileName), ['region-12.pdf', 'region-13.pdf']);

  // Also covers unreferenced orphan regions when added to splitPlan
  const splitPlanWithOrphan = [
    ...splitPlan,
    {
      sectionId: 'region-14',
      dayIndex: 14,
      date: '',
      sectionTitle: '附录补充',
      sourceFileName: 'chap6,7.pdf',
      physicalStartPage: 125,
      physicalEndPage: 135,
      printedStartPage: 400,
      printedEndPage: 410,
      pageOffset: 275,
      segmentFileName: 'region-14.pdf',
      segmentRelPath: 'courses/模电/segments/region-14.pdf',
      status: 'sliced' as const,
      segmentPageCount: 11,
    },
  ];
  const boundWithOrphan = bindAndEnsureAllPdfRegionsCovered(rawSlots, splitPlanWithOrphan);
  const coveredWithOrphan = new Set(
    boundWithOrphan.flatMap((s) => (s.pdfSegments || []).map((seg) => seg.sectionId)),
  );
  assert.equal(coveredWithOrphan.size, 14);
  assert.equal(coveredWithOrphan.has('region-14'), true);
});

test('Step 3 lesson prompts list all bound multi-region PDF segments without prompting for estimatedMinutes', async () => {
  const {
    buildAgentExecutionPrompt,
    buildChatLessonPrompt,
  } = await import('../prompts/promptLibrary');

  const seg06 = {
    sectionId: 'region-06',
    dayIndex: 6,
    date: '',
    sectionTitle: '6.4 预处理放大电路',
    sourceFileName: 'chap6,7.pdf',
    physicalStartPage: 46,
    physicalEndPage: 55,
    printedStartPage: 321,
    printedEndPage: 330,
    segmentFileName: 'region-06.pdf',
    segmentRelPath: 'courses/模电/segments/region-06.pdf',
    status: 'sliced' as const,
  };
  const seg07 = {
    sectionId: 'region-07',
    dayIndex: 7,
    date: '',
    sectionTitle: '第6章仿真与习题',
    sourceFileName: 'chap6,7.pdf',
    physicalStartPage: 55,
    physicalEndPage: 68,
    printedStartPage: 330,
    printedEndPage: 343,
    segmentFileName: 'region-07.pdf',
    segmentRelPath: 'courses/模电/segments/region-07.pdf',
    status: 'sliced' as const,
  };

  const slot = {
    id: 'sec-08',
    dayIndex: 8,
    date: '2026-11-22',
    title: '第 8 节：第6章综合实战与习题',
    objective: '综合运用第6章运算与滤波知识',
    keyTopics: ['Multisim仿真', '综合习题'],
    teachingScope: '对应 region-06 与 region-07',
    regionId: 'region-06',
    regionIds: ['region-06', 'region-07'],
    pdfSegment: seg06,
    pdfSegments: [seg06, seg07],
  };

  const course = {
    id: 'course-multi-pdf',
    name: '模电',
    folderPath: 'courses/模电',
    category: 'stem' as const,
    generationMode: 'chat' as const,
    subjectProfile: 'electronics_engineering' as const,
    goal: '掌握模电第六章和第七章',
    durationDays: 15,
    startDate: '2026-11-14',
    extraRequirements: '',
    materials: [],
    masteredWords: [],
    exerciseSubmissions: {},
    dailyPlan: [slot],
    createdAt: '2026-11-14T00:00:00.000Z',
  };

  const chatPrompt = buildChatLessonPrompt({ course, slot, teachingSystemPrompt: '' });
  const agentPrompt = buildAgentExecutionPrompt({
    course,
    workspaceDir: 'courses/模电',
    materialFilePaths: ['courses/模电/sources/chap6,7.pdf'],
    teachingSystemPrompt: '',
  });
  const apiUserPrompt = buildCourseLessonUserPrompt({ course, slot, materialContext: '' });

  for (const p of [chatPrompt, agentPrompt, apiUserPrompt]) {
    assert.equal(p.includes('region-06.pdf'), true);
    assert.equal(p.includes('region-07.pdf'), true);
    assert.ok(p.includes('"reverseChecks"'));
    assert.ok(!p.includes('estimatedMinutes'));
  }
});

test('Step 3 lesson parser and repair patch update estimatedMinutes and markdown callouts preserve category header classes', async () => {
  const { parseImportedLessonContent } = await import('./coursewareParser');
  const { applyCoursewareRepairPatch } = await import('./coursewareDiagnostics');
  const { renderMarkdownWithLatex } = await import('./markdownMath');

  const slot = {
    id: 'sec-02',
    dayIndex: 2,
    date: '2026-11-15',
    title: '第 2 节：积分与微分电路',
    objective: '推导积分输出表达式',
    keyTopics: ['积分电路'],
    estimatedMinutes: 30,
  };

  const parsedMd = parseImportedLessonContent(
    `# 第 2 节：积分与微分电路\n\n这里是详细推导过程。\n\n预计学习时间：52 分钟`,
    slot,
    'chat',
  );
  assert.equal(parsedMd.lesson.estimatedMinutes, estimateWrittenLessonMinutes(parsedMd.lesson));
  assert.notEqual(parsedMd.lesson.estimatedMinutes, 52);

  const repaired = applyCoursewareRepairPatch(
    parsedMd.lesson,
    JSON.stringify({ summary: '更新摘要', estimatedMinutes: 58 }),
    slot,
  );
  assert.equal(repaired.mergedLesson.estimatedMinutes, estimateWrittenLessonMinutes(repaired.mergedLesson));
  assert.notEqual(repaired.mergedLesson.estimatedMinutes, 58);

  const badgeOnlyHtml = renderMarkdownWithLatex('> [!textbook]\n> 教材原话内容');
  assert.equal(badgeOnlyHtml.includes('lesson-callout-plain'), true);
  assert.equal(badgeOnlyHtml.includes('lesson-callout-textbook'), false);
  assert.equal(badgeOnlyHtml.includes('lesson-callout-header-badge-only'), false);
  assert.equal(badgeOnlyHtml.includes('教材正文'), false);
  assert.equal(badgeOnlyHtml.includes('教材原话内容'), true);

  const titledHtml = renderMarkdownWithLatex('> [!textbook] 核心定义\n> 教材原话内容');
  assert.equal(titledHtml.includes('lesson-callout-plain-title'), true);
  assert.equal(titledHtml.includes('核心定义'), true);
  assert.equal(titledHtml.includes('lesson-callout-title'), false);
  assert.equal(titledHtml.includes('lesson-callout-header-badge-only'), false);
});

test('selective optional lesson fields and two-stage lesson generation (Stage 1 specs -> Stage 2 SVG merge)', async () => {
  const {
    parseImportedLessonContent,
    extractPendingDiagramSpecs,
    mergeStage2DiagramsIntoStage1,
  } = await import('./coursewareParser');
  const { auditCoursewareRendering } = await import('./coursewareDiagnostics');
  const {
    buildLessonStage2DiagramsPrompt,
    buildCourseLessonStage1Prompt,
    buildChatLessonStage1Prompt,
    buildSyllabusUserPrompt,
  } = await import('../prompts/promptLibrary');

  const slot = {
    id: 'sec-03',
    dayIndex: 3,
    date: '2026-11-16',
    title: '第 3 节：反相与同相比例运算电路',
    objective: '掌握虚短虚断分析反相与同相放大器增益',
    keyTopics: ['反相比例电路', '同相比例电路'],
    estimatedMinutes: 45,
  };

  // 1. Knowledge-block syllabus segmentation prompt rules
  const sylPrompt = buildSyllabusUserPrompt({
    name: '模拟电子技术',
    category: 'stem',
    goal: '零基础学透集成运放线性应用',
    durationDays: 10,
    extraRequirements: '',
    materials: [],
    subjectProfile: 'electronics_engineering',
    learnerLevel: 'beginner',
  });
  assert.equal(sylPrompt.includes('推导连续'), true);

  // 2. Selective optional fields omitted cleanly in Stage 1 JSON
  const stage1Raw = JSON.stringify({
    sectionId: 'sec-03',
    dayIndex: 3,
    title: '第 3 讲：反相与同相比例运算电路',
    summary: '利用虚短虚断分别推导反相与同相比例放大电路增益。',
    keyPoints: ['反相比例增益 $A_{uf} = -\\frac{R_f}{R_1}$'],
    markdownBody:
      '## 一、反相比例电路\n{{heuristic:hq-1}}\n\n{{diagram:diag-inv}}\n\n### 即时练习\n{{exercise:ex-1}}',
    diagrams: [
      {
        id: 'diag-inv',
        title: '图 1：反相比例放大器拓扑',
        topologySpec:
          '运放负输入接 R1 到输入 uI，Rf 跨接于负输入与输出 uO 之间，正输入接地；标注电流 i1 与 if 方向。',
        caption: '反相比例电路（阶段一规格）',
      },
    ],
    heuristicQuestions: [
      {
        id: 'hq-1',
        context: '已知运放开环增益极高且工作在线性区。',
        question: '为什么可以近似认为反相输入端处于“虚地”？',
        // answerReveal deliberately omitted
      },
    ],
    exercises: [
      {
        id: 'ex-1',
        stage: 'inline',
        type: 'calculation',
        difficulty: 'basic',
        question: '若 $R_1 = 10\\,\\text{k}\\Omega$、$R_f = 50\\,\\text{k}\\Omega$，求电压增益并结合 {{diagram:diag-ex1}} 作答。',
        answer: '-5',
        diagramId: 'diag-ex1',
        topologySpec: '仅给出 R1=10kΩ 与 Rf=50kΩ 的反相比例放大器，不标注增益结果。',
        // explanation, hint, approach, remediation, variantCheck deliberately omitted!
      },
    ],
    // reverseChecks and qualityCheck deliberately omitted!
  });

  const stage1Parsed = parseImportedLessonContent(stage1Raw, slot, 'chat', {}, {
    stageMode: 'stage1',
  });
  assert.equal(stage1Parsed.lesson.generationStage, 'stage1_content');
  assert.equal(Boolean(stage1Parsed.lesson.diagrams?.[0]?.svgCode), false);
  assert.equal(
    stage1Parsed.lesson.diagrams?.[0]?.topologySpec?.includes('负输入接 R1'),
    true
  );

  // Stage 1 audit passes when pending diagrams have topologySpec (no false missing-SVG error)
  const stage1Audit = auditCoursewareRendering(stage1Parsed.lesson, {}, { stage: 'stage1' });
  assert.equal(stage1Audit.hasErrors, false);
  assert.equal(stage1Audit.errorCount, 0);

  // Extracting pending diagram specs picks up both diag-inv and diag-ex1 (exercise-bound)
  const pendingSpecs = extractPendingDiagramSpecs(stage1Parsed.lesson);
  assert.deepEqual(
    pendingSpecs.map((s) => s.id),
    ['diag-inv', 'diag-ex1']
  );

  // 3. Stage 2 prompt uses only Stage 1 specs (does NOT require uploading textbook PDF)
  const stage2Prompt = buildLessonStage2DiagramsPrompt({
    courseName: '模拟电子技术',
    slot,
    diagramSpecs: pendingSpecs,
  });
  assert.equal(stage2Prompt.includes('diag-inv'), true);
  assert.equal(stage2Prompt.includes('diag-ex1'), true);
  assert.equal(stage2Prompt.includes('无需教材原文 PDF'), true);
  assert.equal(stage2Prompt.includes('"diagrams"'), true);

  const mockCourseForStage1 = {
    id: 'c1',
    name: '模电',
    courseDirPath: 'courses/模电',
    category: 'stem' as const,
    generationMode: 'api' as const,
    subjectProfile: 'electronics_engineering' as const,
    goal: '学透模电',
    durationDays: 10,
    startDate: '2026-11-16',
    extraRequirements: '',
    materials: [],
    masteredWords: [],
    exerciseSubmissions: {},
    dailyPlan: [slot],
    createdAt: '2026-11-16T00:00:00Z',
  };

  // Verify Stage 1 prompt helpers work for both API & Chat modes
  const apiStage1 = buildCourseLessonStage1Prompt({
    course: mockCourseForStage1,
    slot,
    materialContext: '反相与同相放大',
  });
  assert.equal(apiStage1.includes('topologySpec'), true);
  assert.equal(apiStage1.includes('阶段一'), true);

  const chatStage1 = buildChatLessonStage1Prompt({
    course: { ...mockCourseForStage1, generationMode: 'chat' },
    slot,
    teachingSystemPrompt: '',
  });
  assert.equal(chatStage1.includes('阶段一'), true);

  // 4. Failed Stage 2 merge throws without mutating Stage 1 draft
  assert.throws(() => {
    mergeStage2DiagramsIntoStage1(stage1Parsed.lesson, '{bad json');
  });
  assert.equal(Boolean(stage1Parsed.lesson.diagrams?.[0]?.svgCode), false);
  assert.equal(stage1Parsed.lesson.generationStage, 'stage1_content');

  // 5. Valid Stage 2 SVG JSON merges into Stage 1 cleanly without altering Stage 1 prose
  const stage2Output = JSON.stringify({
    diagrams: [
      {
        id: 'diag-inv',
        title: '图 1：反相比例放大器拓扑',
        caption: '反相比例电路图（已绘制）',
        svgCode:
          '<svg viewBox="0 0 680 280" xmlns="http://www.w3.org/2000/svg"><line x1="80" y1="120" x2="220" y2="120" stroke="#fff"/><text x="120" y="100">R1</text></svg>',
      },
      {
        id: 'diag-ex1',
        title: '练习配图：反相放大器数值图',
        caption: 'R1=10kΩ, Rf=50kΩ',
        svgCode:
          '<svg viewBox="0 0 680 260" xmlns="http://www.w3.org/2000/svg"><rect x="100" y="80" width="80" height="30" stroke="#fff" fill="none"/><text x="115" y="100">10k</text></svg>',
      },
    ],
  });

  const merged = mergeStage2DiagramsIntoStage1(stage1Parsed.lesson, stage2Output);
  assert.equal(merged.matchedCount, 2);
  assert.equal(merged.addedCount, 0);
  assert.equal(merged.pendingRemaining.length, 0);
  assert.equal(merged.mergedLesson.generationStage, 'complete');
  assert.equal(merged.mergedLesson.markdownBody, stage1Parsed.lesson.markdownBody);
  assert.equal(merged.mergedLesson.exercises[0].svgCode?.includes('<svg'), true);

  const completeAudit = auditCoursewareRendering(merged.mergedLesson, {}, { stage: 'complete' });
  assert.equal(completeAudit.hasErrors, false);
  assert.equal(completeAudit.errorCount, 0);
});

test('LaTeX unescaped backslash repair fixes single-backslash \\tilde{\\alpha}/\\tilde{\\beta} and passes Lesson 5 Stage 1 audit', async () => {
  const {
    repairUnescapedLatexInJsonString,
    tryExtractJsonObject,
    extractPendingDiagramSpecs,
  } = await import('./coursewareParser');
  const { auditRawCoursewareInput } = await import('./coursewareDiagnostics');

  // Inline synthetic JSON with single-backslash \alpha (SyntaxError: Bad escaped character) and \beta (becomes 0x08 BS)
  const rawBrokenFixture =
    '{"title":"第 5 讲：多级阻容耦合放大电路的频率响应","summary":"级联分析","estimatedMinutes":45,"markdownBody":"零极点位移 $\\\\tilde{\\alpha} + \\\\tilde{\\beta} + \\\\theta$ 推导。","diagrams":[{"id":"diag-5-1","title":"多级幅频特性","caption":"波特图","topologySpec":"画三级极点分布"}],"exercises":[{"id":"ex-1","type":"short_answer","question":"计算 $\\\\tilde{\\beta}$","answer":"B","explanation":"ok"}]}';

  assert.throws(() => JSON.parse(rawBrokenFixture));
  const repaired = repairUnescapedLatexInJsonString(rawBrokenFixture);
  const parsedObj = JSON.parse(repaired);
  assert.equal(parsedObj.markdownBody.includes('\\alpha'), true);
  assert.equal(parsedObj.markdownBody.includes('\\beta'), true);
  assert.equal(parsedObj.markdownBody.includes('\b'), false);
  assert.notEqual(tryExtractJsonObject(rawBrokenFixture), null);

  const fixtureSlot: any = {
    id: 'sec-05',
    dayIndex: 5,
    date: '2026-11-20',
    title: '多级放大电路频响',
    objective: '掌握零极点拟合',
    keyTopics: ['频率响应'],
  };
  const stage1Audit = auditRawCoursewareInput(rawBrokenFixture, fixtureSlot, {}, { stage: 'stage1' });
  assert.ok(stage1Audit);
  assert.equal(stage1Audit.parsedLesson !== null, true);
  assert.equal(stage1Audit.report.errorCount, 0);
  assert.equal(extractPendingDiagramSpecs(stage1Audit.parsedLesson!).length, 1);

  const uploadedLesson5Path =
    'C:/Users/GNZ/.gemini/antigravity/brain/ace2ba22-49be-4a81-96bb-b2ce31a0c75e/.user_uploaded/media_1794705532669_58deb011.json';
  if (fs.existsSync(uploadedLesson5Path)) {
    const rawLesson5 = fs.readFileSync(uploadedLesson5Path, 'utf-8');
    const lesson5Audit = auditRawCoursewareInput(rawLesson5, fixtureSlot, {}, { stage: 'stage1' });
    assert.ok(lesson5Audit);
    assert.equal(lesson5Audit.parsedLesson !== null, true);
    assert.equal(lesson5Audit.report.errorCount, 0);
    assert.equal(extractPendingDiagramSpecs(lesson5Audit.parsedLesson!).length > 0, true);
  }
});

test('detectPastedCoursewareInputKind identifies stage1/stage2/patch/complete and applyCoursewareRepairPatch supports find/replace', async () => {
  const { detectPastedCoursewareInputKind } = await import('./coursewareParser');
  const { applyCoursewareRepairPatch } = await import('./coursewareDiagnostics');

  const stage1Text = JSON.stringify({
    title: '第 1 讲',
    markdownBody: '正弦信号 $\\sin(\\omega t)$\n\n{{diagram:diag-1}}',
    diagrams: [{ id: 'diag-1', title: '图 1', topologySpec: '画波形图' }],
  });
  const stage2Text = JSON.stringify({
    diagrams: [{ id: 'diag-1', title: '图 1', svgCode: '<svg viewBox="0 0 100 100"></svg>' }],
  });
  const patchText = JSON.stringify({
    textReplacements: [{ find: '旧错别字', replace: '新修正文本' }],
  });
  const completeText = JSON.stringify({
    title: '第 1 讲',
    markdownBody: '正文\n\n{{diagram:diag-1}}',
    diagrams: [{ id: 'diag-1', title: '图 1', svgCode: '<svg viewBox="0 0 100 100"></svg>' }],
    exercises: [{ id: 'ex-1', type: 'short_answer', question: 'Q', answer: 'A', explanation: 'E' }],
  });

  assert.equal(detectPastedCoursewareInputKind(stage1Text, { hasStage1Draft: false }), 'stage1');
  assert.equal(detectPastedCoursewareInputKind(stage2Text, { hasStage1Draft: true }), 'stage2');
  assert.equal(detectPastedCoursewareInputKind(patchText, { hasBaseLesson: true }), 'patch');
  assert.equal(detectPastedCoursewareInputKind(completeText), 'complete');

  const baseLesson: any = {
    title: '第 1 讲',
    summary: '摘要',
    markdownBody: '这里有一个旧错别字需要修补。',
    diagrams: [],
    exercises: [],
  };
  const slot: any = { id: 'sec-01', dayIndex: 1, date: '2026-11-15', title: '第 1 讲', objective: '', keyTopics: [] };
  const patched = applyCoursewareRepairPatch(baseLesson, patchText, slot);
  assert.equal(patched.mergedLesson.markdownBody.includes('新修正文本'), true);
  assert.equal(patched.mergedLesson.markdownBody.includes('旧错别字'), false);
});

test('PDF split salvage, incremental merge, and minimal repair prompt preserve intact regions on truncation', async () => {
  const {
    salvagePartialPdfSplitRegions,
    mergeImportedPdfSplitRegions,
    buildPdfSplitIncrementalRepairPrompt,
  } = await import('./coursewareParser');

  const truncatedSplitJson = `{
    "pageOffset": 14,
    "regions": [
      {"sectionId": "region-01", "sectionTitle": "绪论", "printedStartPage": 1, "printedEndPage": 8},
      {"sectionId": "region-02", "sectionTitle": "二极管基本模型", "printedStartPage": 9, "printedEndPage": 24},
      {"sectionId": "region-03", "sectionTitle": "放大电路分析", "printedStartPage": 25, "printedEndPage": `;

  const salvaged = salvagePartialPdfSplitRegions(truncatedSplitJson, 'textbook.pdf', 120);
  assert.equal(salvaged.detectedPageOffset, 14);
  assert.equal(salvaged.salvagedRegions.length, 2);
  assert.equal(salvaged.salvagedRegions[0].physicalStartPage, 15);
  assert.equal(salvaged.salvagedRegions[1].sectionTitle, '二极管基本模型');

  const incrementalPatch = [
    {
      sectionId: 'region-02',
      dayIndex: 2,
      date: '',
      sectionTitle: '二极管基本模型与开关特性',
      physicalStartPage: 23,
      physicalEndPage: 38,
      sourceFileName: 'textbook.pdf',
      status: 'planned',
    },
    {
      sectionId: 'region-03',
      dayIndex: 3,
      date: '',
      sectionTitle: '放大电路分析',
      physicalStartPage: 39,
      physicalEndPage: 62,
      sourceFileName: 'textbook.pdf',
      status: 'planned',
    },
  ];
  const merged = mergeImportedPdfSplitRegions(salvaged.salvagedRegions, incrementalPatch as any);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].sectionId, 'region-01');
  assert.equal(merged[1].sectionTitle, '二极管基本模型与开关特性');
  assert.equal(merged[2].sectionId, 'region-03');

  const repair = buildPdfSplitIncrementalRepairPrompt({
    rawInput: truncatedSplitJson,
    errorMessage: 'Unexpected end of JSON input',
    defaultSourceFileName: 'textbook.pdf',
    totalPages: 120,
  });
  assert.equal(repair.salvagedRegions.length, 2);
  assert.equal(repair.repairPrompt.includes('region-01'), true);
  assert.equal(repair.repairPrompt.includes('请勿重复输出已成功解析的前 2 个区域'), true);
  assert.equal(repair.repairPrompt.includes('请仅输出剩余未完成或出错的区域'), true);
  assert.equal(repair.repairPrompt.includes('"incremental": true'), true);
});

test('Broken JSON audit pinpoints exact [❌] SyntaxError offset and salvages intact top-level lesson fields', async () => {
  const { auditRawCoursewareInput, salvagePartialLessonFromBrokenJson } = await import(
    './coursewareDiagnostics'
  );

  const slot: any = { id: 'sec-04', dayIndex: 4, date: '2026-11-19', title: '频率响应基础', objective: '', keyTopics: [] };

  // Truncated tiny object still triggers json_syntax_error with no salvaged lesson
  const tinyBroken = auditRawCoursewareInput('{"title": "broken', slot, {});
  assert.ok(tinyBroken);
  assert.equal(tinyBroken.parsedLesson, null);
  assert.equal(tinyBroken.report.issues[0].category, 'json_syntax_error');

  // Larger broken JSON with syntax error inside exercises retains intact markdownBody and marks [❌] near error position
  const brokenMidJson =
    '{"title":"第 4 讲：频率响应基础","summary":"摘要完成","estimatedMinutes":42,"markdownBody":"' +
    '这是完整正文，推导 $H(j\\\\omega) = \\\\frac{1}{1+j\\\\omega RC}$。' +
    '","diagrams":[{"id":"diag-1","title":"幅频曲线","topologySpec":"画出 -20dB/dec 下降斜率"}],"exercises":[{"id":"ex-1","type":"short_answer","question":"broken unescaped quote "here"}]}';

  const salvaged = salvagePartialLessonFromBrokenJson(brokenMidJson, slot, {});
  assert.ok(salvaged.salvagedLesson);
  assert.equal(salvaged.salvagedFields.includes('markdownBody'), true);
  assert.equal(salvaged.salvagedFields.includes('diagrams'), true);

  const audited = auditRawCoursewareInput(brokenMidJson, slot, {}, { stage: 'stage1' });
  assert.ok(audited);
  assert.equal(audited.report.issues.some((i) => i.category === 'json_syntax_error'), true);
  assert.equal(audited.report.repairPrompt.includes('[❌]'), true);
  assert.equal(audited.report.repairPrompt.includes('增量修复/续写 JSON 补丁'), true);
});

test('CJK punctuation bold spans (**“虚地”**, **$u_P = 0$**) render cleanly and prime symbols (R vs R\') stay distinct', async () => {
  const { renderMarkdownWithLatex } = await import('./markdownMath');
  const { normalizeSymbolKeys, buildLessonSymbolIndex, lookupSymbolInIndex } = await import(
    './latexSymbols'
  );

  const html = renderMarkdownWithLatex(
    '——教材中称之为**“虚地”**（“虚”即“假”），且得到**$u_P = 0$**的结论，保留`**not bold**`。'
  );
  assert.equal(html.includes('<strong>“虚地”</strong>'), true);
  assert.equal(html.includes('<strong><span class="katex">'), true);
  assert.equal(html.includes('<code>**not bold**</code>'), true);

  assert.deepEqual(normalizeSymbolKeys("R'"), { canonicalKey: "R'", looseKey: "R'" });
  assert.deepEqual(normalizeSymbolKeys('R′'), { canonicalKey: "R'", looseKey: "R'" });
  assert.deepEqual(normalizeSymbolKeys('R^{\\prime}'), { canonicalKey: "R'", looseKey: "R'" });
  assert.deepEqual(normalizeSymbolKeys('R'), { canonicalKey: 'R', looseKey: 'R' });

  const idx = buildLessonSymbolIndex({
    sectionId: 'sec-prime-test',
    dayIndex: 1,
    date: '2026-11-15',
    title: '反相比例电路',
    summary: '',
    keyPoints: [],
    markdownBody: '串联补偿电阻 $R\' = R // R_f$。',
    symbolGlossary: [
      { symbol: "R'", name: '平衡补偿电阻', definition: '同相端补偿电阻', unit: 'kΩ' },
    ],
    diagrams: [],
    exercises: [],
    generatedAt: '2026-11-15T00:00:00Z',
  });
  assert.equal(lookupSymbolInIndex(idx, "R'")?.name, '平衡补偿电阻');
  assert.equal(lookupSymbolInIndex(idx, 'R′')?.name, '平衡补偿电阻');
  assert.equal(lookupSymbolInIndex(idx, 'R'), null);
});

test('LessonPreview heuristic context renders inline LaTeX and enhanceDiagramSvg prevents narrow rect text overflow', async () => {
  const { renderInlineMathWithLatex } = await import('./markdownMath');
  const { enhanceDiagramSvg } = await import('./svgMath');

  const renderedContext = renderInlineMathWithLatex(
    "启发式思考 · 在证明复合函数链式法则 $\\frac{dy}{dx} = \\frac{dy}{du} \\cdot \\frac{du}{dx}$ 时，$\\lim_{\\Delta x \\to 0} \\frac{\\Delta y}{\\Delta x} = f'(u)g'(x)$。"
  );
  assert.equal(renderedContext.includes('class="katex"'), true);
  assert.equal(renderedContext.includes('$\\frac'), false);

  const narrowBoxSvg = `<svg viewBox="0 0 680 180" xmlns="http://www.w3.org/2000/svg">
    <rect x="170" y="60" width="340" height="44" rx="8" fill="#18181b" stroke="#f59e0b" />
    <text x="340" y="87" text-anchor="middle" font-size="15" font-weight="bold" fill="#fb923c">变化率（链式法则）：dy/dx = (dy/du) · (du/dx) = f'(u) · g'(x)</text>
  </svg>`;
  const enhanced = enhanceDiagramSvg(narrowBoxSvg);
  const widthMatch = enhanced.match(/<rect[^>]*width="(\d+)"/i);
  const heightMatch = enhanced.match(/<rect[^>]*height="(\d+)"/i);
  const widened = widthMatch ? Number(widthMatch[1]) > 340 : false;
  const wrappedTaller = heightMatch ? Number(heightMatch[1]) > 44 : false;
  assert.equal(widened || wrappedTaller, true);
});

test('markdownMath preserves polynomial exponents and bare lim f[g(x)], while coursewareDiagnostics flags suspicious valid-syntax LaTeX for AI review', async () => {
  const { normalizeBareMathForMarkdown, normalizeMathUnicodeToLatex } = await import('./markdownMath');
  const { auditCoursewareRendering } = await import('./coursewareDiagnostics');

  // 1. Regression fixes in markdownMath
  assert.equal(normalizeMathUnicodeToLatex('\\lim_{x\\to 2}(x^2+ax+b)'), '\\lim_{x\\to 2}(x^2+ax+b)');
  assert.equal(normalizeMathUnicodeToLatex('x^n+1'), 'x^n+1');
  assert.equal(normalizeMathUnicodeToLatex('Fe^2+ + SO_4^2-'), 'Fe^{2+} + SO_4^{2-}');
  assert.equal(
    normalizeBareMathForMarkdown('复合函数极限运算法则 \\lim_{x\\to x_0}f[g(x)]=\\lim_{u\\to u_0}f(u) 成立'),
    '复合函数极限运算法则 $\\lim_{x\\to x_0}f[g(x)]=\\lim_{u\\to u_0}f(u)$ 成立'
  );

  // 2. Semantic/layout anomaly alerts (syntactically valid LaTeX that should be flagged for AI review)
  const suspiciousReport = auditCoursewareRendering({
    sectionId: 'sec-04',
    dayIndex: 1,
    date: '2026-11-16',
    title: '异常公式复查测试',
    summary: '正常化学离子 $\\text{Fe}^{2+} + 2\\text{e}^- \\to \\text{Fe}$ 与单侧极限 $\\lim_{x\\to 0^+}\\frac{1}{x}$',
    keyPoints: [
      '异常上标：$$\\lim_{x\\to 2}(x^{2+}ax+b) = 0$$',
      '公式内混入转义美元符：$[g(x)]=\\$\\lim_{u\\to u_0}f$',
      '吞入中文从句：$g(x)] 不存在，因为 x\\to 0$',
      '函数括号被拆开：$\\lim_{x\\to 0}f$[g(x)] = 0',
    ],
    markdownBody: '正文正常。',
    diagrams: [],
    heuristicQuestions: [],
    exercises: [],
    reverseChecks: [],
    generatedAt: new Date().toISOString(),
    sourceMode: 'chat',
  });

  const suspiciousIssues = suspiciousReport.issues.filter((i) => i.category === 'suspicious_math');
  assert.equal(suspiciousIssues.length >= 4, true);
  assert.equal(suspiciousReport.warningCount >= 4, true);
  assert.equal(suspiciousReport.repairPrompt.includes('textReplacements'), true);
  assert.equal(suspiciousReport.repairPrompt.includes('x^{2+}ax+b'), true);
  // Valid chemistry/one-sided limit in summary must not be flagged
  assert.equal(
    suspiciousReport.issues.some((i) => i.locationLabel.includes('summary')),
    false
  );
});








test('calculate finished lesson time by content and drop stale estimates on deletion', () => {
  const lesson = {
    dayIndex: 1,
    date: '',
    title: 'Test',
    summary: '',
    generatedAt: '',
    estimatedMinutes: 99,
    markdownBody: '字'.repeat(200) + String.raw`$$x \Rightarrow y \Rightarrow z$$`,
    keyPoints: ['概念', '概念'],
    diagrams: [{ id: 'diag-1', title: 'Diagram', caption: '', svgCode: '' }],
    exercises: [
      { id: 'ex-1', type: 'fill', question: 'Q', answer: 'A', difficulty: 'basic' },
      { id: 'ex-2', type: 'fill', question: 'Q', answer: 'A', difficulty: 'application' },
      { id: 'ex-3', type: 'fill', question: 'Q', answer: 'A', difficulty: 'comprehensive' },
    ],
  } as const;
  const complete = { ...lesson, keyPoints: [...lesson.keyPoints], diagrams: [...lesson.diagrams], exercises: [...lesson.exercises] };
  assert.equal(getEvaluatedSectionMinutes({ lesson: complete, estimatedMinutes: 99 }), 24);
  assert.equal(getEvaluatedSectionMinutes({ estimatedMinutes: 99 }), undefined);
  assert.equal(getEvaluatedSectionMinutes({ lesson: { ...complete, generationStage: 'stage1_content' } }), undefined);
});


test('render rectangular matrix shorthand in exercises and multiline matrices in semantic callouts', async () => {
  const { renderMarkdownWithLatex, renderInlineMathWithLatex } = await import('./markdownMath');
  const question = '设 A=(0 a_1 0 0;0 0 a_2 0;0 0 0 a_3;a_4 0 0 0)，且 A 可逆。';
  const callout = String.raw`> [!INTUITION]
> $$
> C=\begin{pmatrix}
> 1 & 2 \\
> 3 & 4
> \end{pmatrix}
> $$`;
  for (const html of [
    renderMarkdownWithLatex(question),
    renderMarkdownWithLatex(callout),
    renderInlineMathWithLatex('$B=[1,2;3,4]$'),
  ]) {
    assert.ok(html.includes('<mtable'));
    assert.ok(!html.includes('katex-error'));
  }
  assert.ok(!renderInlineMathWithLatex('P=(1,2)').includes('<mtable'));
});

test('calculus bare-math, Greek/prime SVG subscripts, and escaped-SVG audit checks handle edge cases cleanly', async () => {
  const fs = await import('node:fs');
  const { normalizeBareMathForMarkdown, normalizeMathUnicodeToLatex, renderInlineMathWithLatex } =
    await import('./markdownMath');
  const { enhanceDiagramSvg } = await import('./svgMath');
  const { auditCoursewareRendering } = await import('./coursewareDiagnostics');

  // 1. Regression: n^2+\pi must not turn into n^{2+}\pi
  assert.equal(normalizeMathUnicodeToLatex('n^2+\\pi'), 'n^2+\\pi');
  const piHtml = renderInlineMathWithLatex('$n^2+\\pi$');
  assert.ok(!piHtml.includes('katex-error'));

  // 2. Regression: parenthesized calculus scripts, limits, Taylor polynomials, and Δx powers remain intact
  assert.equal(
    normalizeBareMathForMarkdown("曲率分母 (1 + y'^2)^{3/2} 非零"),
    "曲率分母 $(1 + y'^2)^{3/2}$ 非零"
  );
  assert.equal(
    normalizeBareMathForMarkdown('计算极限 lim_{x→0^+} (1 + 2x)^{1/x} 的值'),
    '计算极限 $\\lim_{x\\to 0^+} (1 + 2x)^{1/x}$ 的值'
  );
  assert.equal(
    normalizeBareMathForMarkdown('满足条件 p_n(x_0)=f(x_0) 且增量 (Δx)^2 很小'),
    '满足条件 $p_n(x_0)=f(x_0)$ 且增量 $(\\Delta x)^2$ 很小'
  );

  // 3. SVG Greek letters, primes with subscripts, and trig operators
  const enhancedSvg = enhanceDiagramSvg(
    '<svg viewBox="0 0 680 320" xmlns="http://www.w3.org/2000/svg"><text x="20" y="30">\\theta_1, \\xi_1, f\'_+(x_0), \\sec t</text></svg>'
  );
  assert.ok(!enhancedSvg.includes('\\sec'));
  assert.ok(!enhancedSvg.includes('\\theta'));
  assert.ok(enhancedSvg.includes('baseline-shift="sub" font-size="0.72em">1</tspan>'));
  assert.ok(enhancedSvg.includes('baseline-shift="sub" font-size="0.72em">+</tspan>'));
  assert.ok(enhancedSvg.includes('sec t'));

  // 4. Escaped SVG tags are flagged by auditCoursewareRendering
  const badSvgReport = auditCoursewareRendering({
    sectionId: 'sec-test',
    dayIndex: 1,
    date: '2026-11-18',
    title: '转义 SVG 检测',
    summary: '摘要',
    markdownBody: '如图 {{diagram:diag-1}} 所示。',
    keyPoints: ['要点'],
    diagrams: [
      {
        id: 'diag-1',
        title: '图 1',
        caption: '图注',
        svgCode: '<svg viewBox=\\"0 0 680 320\\">\\<rect width=\\"680\\" height=\\"320\\"/></svg>',
      },
    ],
    exercises: [{ id: 'ex-1', type: 'choice', question: 'Q', answer: 'A' }],
    generatedAt: '2026-11-18T00:00:00Z',
  });
  assert.ok(
    badSvgReport.issues.some((iss) => iss.category === 'svg_error' && iss.id.startsWith('svg-escaped-'))
  );

  // 5. Verify sec-11, sec-14, sec-15, sec-16 pass full audit cleanly with valid unescaped SVGs
  for (const num of ['11', '14', '15', '16']) {
    const lesson = JSON.parse(fs.readFileSync(`courses/高数/lessons/sec-${num}.json`, 'utf8'));
    const report = auditCoursewareRendering(lesson);
    assert.equal(report.errorCount, 0, `sec-${num} should have 0 errors`);
    assert.equal(report.warningCount, 0, `sec-${num} should have 0 warnings`);
    for (const diag of lesson.diagrams || []) {
      assert.ok(diag.svgCode && !diag.svgCode.includes('\\"') && !diag.svgCode.includes('\\<'));
    }
  }
});

test('BARE_MATH_EXPR_RE stays compact for Safari/WebKit YARR and normalizes all STEM cases accurately', async () => {
  const {
    BARE_MATH_EXPR_RE,
    normalizeBareMathForMarkdown,
    renderInlineMathWithLatex,
  } = await import('./markdownMath');

  assert.equal(BARE_MATH_EXPR_RE.source.length < 15000, true);
  assert.equal(BARE_MATH_EXPR_RE.source.includes('(?<!'), false);
  assert.equal(BARE_MATH_EXPR_RE.source.includes('(?<='), false);

  const cases: Array<[string, string]> = [
    ['输出关系 u_O = -i_F R_f 成立', '输出关系 $u_O = -i_F R_f$ 成立'],
    ['电路 u_O = -(R_f / R_1) * u_I 推导', '电路 $u_O = -(R_f / R_1) \\cdot u_I$ 推导'],
    ["分母 (1 + y'^2)^{3/2} 非零", "分母 $(1 + y'^2)^{3/2}$ 非零"],
    ['极限 lim_{x→0^+} (1 + 2x)^{1/x} 存在', '极限 $\\lim_{x\\to 0^+} (1 + 2x)^{1/x}$ 存在'],
    [
      '复合函数 \\lim_{x\\to x_0}f[g(x)]=\\lim_{u\\to u_0}f(u) 成立',
      '复合函数 $\\lim_{x\\to x_0}f[g(x)]=\\lim_{u\\to u_0}f(u)$ 成立',
    ],
    ["满足 |f'(x)| <= M 成立", "满足 $|f'(x)| \\le  M$ 成立"],
    ['高阶无穷小 (Δx)^2 忽略', '高阶无穷小 $(\\Delta x)^2$ 忽略'],
    ['弱电解质 CH_3COOH 电离', '弱电解质 $CH_3COOH$ 电离'],
    ['硫酸根离子 SO_4^{2-} 检验', '硫酸根离子 $SO_4^{2-}$ 检验'],
    ['复杂度 O(n \\log_2 n) 分析', '复杂度 $O(n \\log_2 n)$ 分析'],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizeBareMathForMarkdown(input), expected);
    const html = renderInlineMathWithLatex(input);
    assert.equal(html.includes('class="katex"'), true);
    assert.equal(html.includes('katex-error'), false);
  }
});

test('Diagram Engine: all 5 structured engines compile deterministically with dark/print dual theme and zero NaN', async () => {
  const {
    validateDiagramSpec,
    compileDiagramSpecSync,
    compileDiagramSpec,
  } = await import('../diagrams');
  const { enhanceDiagramSvg } = await import('./svgMath');

  // 1a. grid-annot: 3x3 determinant Sarrus diagonals + matrix/det brackets
  const sarrusSvg = compileDiagramSpecSync({
    type: 'grid-annot',
    title: '三阶行列式沙路法（主/副对角线乘积符号）',
    brackets: 'det',
    cells: [
      ['a_{11}', 'a_{12}', 'a_{13}'],
      ['a_{21}', 'a_{22}', 'a_{23}'],
      ['a_{31}', 'a_{32}', 'a_{33}'],
    ],
    highlights: [{ row: 0, col: 0, tone: 'positive' }],
    diagonals: [
      { cells: [[0, 0], [1, 1], [2, 2]], label: '+a_11 a_22 a_33', tone: 'positive' },
      { cells: [[0, 2], [1, 1], [2, 0]], label: '-a_13 a_22 a_31', tone: 'negative', dashed: true },
    ],
    arrows: [{ from: [0, 1], to: [1, 2], tone: 'accent', curve: 14 }],
    notes: ['主对角线方向取正号，副对角线方向取负号'],
  });
  assert.ok(sarrusSvg);
  assert.equal(sarrusSvg.includes('<svg'), true);
  assert.equal(sarrusSvg.includes('data-diagram-engine="grid-annot"'), true);
  assert.equal(sarrusSvg.includes('viewBox="'), true);
  assert.equal(sarrusSvg.includes('@media print'), true);
  assert.equal(sarrusSvg.includes('NaN'), false);
  // enhanceDiagramSvg must pass structured engine SVG through untouched
  assert.equal(enhanceDiagramSvg(sarrusSvg), sarrusSvg);

  // 1b. grid-annot: Karnaugh map with headers and rounded grouping boxes
  const kmapSvg = compileDiagramSpecSync({
    type: 'grid-annot',
    title: '四变量卡诺图化简',
    rowHeaders: ['00', '01', '11', '10'],
    colHeaders: ['00', '01', '11', '10'],
    cells: [
      ['1', '1', '0', '0'],
      ['1', '1', '0', '0'],
      ['0', '0', '1', '1'],
      ['0', '0', '1', '0'],
    ],
    boxes: [
      { from: [0, 0], to: [1, 1], tone: 'positive', label: "\\bar{A}\\bar{C}" },
      { from: [2, 2], to: [2, 3], tone: 'accent', dashed: true, label: 'ABC' },
    ],
  });
  assert.ok(kmapSvg);
  assert.equal(kmapSvg.includes('data-diagram-engine="grid-annot"'), true);
  assert.equal(kmapSvg.includes('NaN'), false);

  // 2. plot2d: expr-eval safe curve rendering, shaded integral region, projections, and 1/x asymptote break
  const integralSvg = compileDiagramSpecSync({
    type: 'plot2d',
    title: '抛物线积分面积与 1/x 渐近线断线测试',
    xRange: [-3, 3],
    yRange: [-4, 5],
    functions: [
      { expr: 'x^2', label: 'y = x^2', tone: 'accent' },
      { expr: '1 / x', label: 'y = 1/x', tone: 'negative' },
    ],
    shadedRegions: [
      { expr: 'x^2', from: 0, to: 2, tone: 'positive', label: '∫_0^2 x^2 dx = 8/3' },
    ],
    points: [
      { x: 2, y: 4, label: '(2, 4)', tone: 'warn', showProjections: true },
    ],
    vlines: [{ x: 0, label: 'x=0', tone: 'muted', style: 'dashed' }],
    hlines: [{ y: 1, label: 'y=1', tone: 'muted', style: 'dotted' }],
  });
  assert.ok(integralSvg);
  assert.equal(integralSvg.includes('data-diagram-engine="plot2d"'), true);
  assert.equal(integralSvg.includes('viewBox="'), true);
  assert.equal(integralSvg.includes('@media print'), true);
  assert.equal(integralSvg.includes('NaN'), false);
  assert.equal(integralSvg.includes('y = 1/x'), true);
  // 1/x curve has an asymptote at x=0, so its path should contain multiple 'M ' subpaths rather than bridging -Inf to +Inf
  const pathMatches = [...integralSvg.matchAll(/<path d="(M [^"]+)"/g)].map((m) => m[1]);
  assert.equal(
    pathMatches.some((d) => (d.match(/\bM\s/g) || []).length >= 2),
    true,
    'expected 1/x curve path to break cleanly across x=0 asymptote'
  );

  // 3. graph: async ELK orthogonal layout with feedback control block + sum junction
  const graphSpec = {
    type: 'graph' as const,
    title: '闭环负反馈控制系统框图',
    direction: 'LR' as const,
    nodes: [
      { id: 'r', label: 'R(s)', shape: 'pill' as const, tone: 'accent' as const },
      { id: 'sum', label: 'Σ', shape: 'sum' as const, tone: 'default' as const },
      { id: 'g', label: 'G(s)', subLabel: '前向通路', shape: 'rect' as const, tone: 'positive' as const },
      { id: 'c', label: 'C(s)', shape: 'circle' as const, tone: 'accent' as const },
      { id: 'cond', label: '稳态?', shape: 'diamond' as const, tone: 'warn' as const },
      { id: 'h', label: 'H(s)', shape: 'round' as const, tone: 'negative' as const },
    ],
    edges: [
      { from: 'r', to: 'sum', label: '+' },
      { from: 'sum', to: 'g', label: 'E(s)' },
      { from: 'g', to: 'c', tone: 'positive' as const },
      { from: 'c', to: 'cond', style: 'dashed' as const },
      { from: 'c', to: 'h' },
      { from: 'h', to: 'sum', label: '-', tone: 'negative' as const },
    ],
  };
  assert.equal(compileDiagramSpecSync(graphSpec), null, 'uncached graph spec returns null in sync mode');
  const graphSvg = await compileDiagramSpec(graphSpec);
  assert.equal(graphSvg.includes('data-diagram-engine="graph"'), true);
  assert.equal(graphSvg.includes('viewBox="'), true);
  assert.equal(graphSvg.includes('@media print'), true);
  assert.equal(graphSvg.includes('NaN'), false);
  assert.equal(graphSvg.includes('G(s)'), true);
  assert.equal(graphSvg.includes('H(s)'), true);
  assert.equal(compileDiagramSpecSync(graphSpec), graphSvg, 'cached graph spec resolves synchronously');

  // 4. wavedrom: timing waveform + register bitfield via async wavedrom + onml
  const timingSvg = await compileDiagramSpec({
    type: 'wavedrom',
    title: 'SPI 同步传输时序',
    signal: [
      { name: 'SCLK', wave: 'p.....' },
      { name: 'MOSI', wave: 'x.34.5x', data: ['ADDR', 'D0', 'CRC'] },
      { name: 'CS_N', wave: '10....1' },
    ],
    head: { text: 'Mode 0 Timing', tick: 0 },
    foot: { tock: 1 },
  });
  assert.equal(timingSvg.includes('data-diagram-engine="wavedrom"'), true);
  assert.equal(timingSvg.includes('viewBox="'), true);
  assert.equal(timingSvg.includes('@media print'), true);
  assert.equal(timingSvg.includes('NaN'), false);
  assert.equal(timingSvg.includes('SCLK'), true);
  assert.equal(timingSvg.includes('ADDR'), true);

  const bitfieldSvg = await compileDiagramSpec({
    type: 'wavedrom',
    title: '状态寄存器位域分布',
    reg: [
      { bits: 4, name: 'MODE', attr: 'RW', type: 2 },
      { bits: 3, name: 'IRQ', attr: 'RO', type: 4 },
      { bits: 1, name: 'EN', attr: 'RW', type: 5 },
    ],
  });
  assert.equal(bitfieldSvg.includes('data-diagram-engine="wavedrom"'), true);
  assert.equal(bitfieldSvg.includes('viewBox="'), true);
  assert.equal(bitfieldSvg.includes('NaN'), false);
  assert.equal(bitfieldSvg.includes('MODE'), true);

  // 5a. circuit: inverting op-amp amplifier with anchors & relative directions
  const opampSvg = compileDiagramSpecSync({
    type: 'circuit',
    title: '反相比例运算放大器电路',
    elements: [
      { kind: 'voltage_dc', label: 'u_I', dir: 'up', anchor: 'vin' },
      { kind: 'resistor', label: 'R_1', value: '10kΩ', dir: 'right', currentLabel: 'i_1' },
      { kind: 'node', label: 'u_-', anchor: 'sum' },
      { kind: 'opamp', id: 'u1', anchor: 'u1', label: 'A' },
      { kind: 'wire', fromAnchor: 'sum', dir: 'up', length: 0.7 },
      { kind: 'resistor', label: 'R_f', value: '100kΩ', dir: 'right', currentLabel: 'i_F', length: 1.5 },
      { kind: 'wire', toAnchor: 'u1.out' },
      { kind: 'ground', fromAnchor: 'u1.in+' },
    ],
  });
  assert.ok(opampSvg);
  assert.equal(opampSvg.includes('data-diagram-engine="circuit"'), true);
  assert.equal(opampSvg.includes('viewBox="'), true);
  assert.equal(opampSvg.includes('@media print'), true);
  assert.equal(opampSvg.includes('NaN'), false);
  assert.equal(opampSvg.includes('100kΩ'), true);
  assert.equal(opampSvg.includes('>f</tspan>'), true);

  // 5b. circuit: remaining primitives (voltage_ac, current_source, capacitor, inductor, diode)
  const rlcDiodeSvg = compileDiagramSpecSync({
    type: 'circuit',
    title: 'RLC 与整流/恒流元件集合',
    elements: [
      { kind: 'voltage_ac', label: 'u_s', dir: 'up', anchor: 'src_top' },
      { kind: 'capacitor', label: 'C_1', value: '10uF', dir: 'right' },
      { kind: 'inductor', label: 'L_1', value: '2mH', dir: 'right' },
      { kind: 'diode', label: 'D_1', dir: 'down', tone: 'accent' },
      { kind: 'current_source', label: 'I_s', value: '5mA', dir: 'left' },
      { kind: 'ground' },
    ],
  });
  assert.ok(rlcDiodeSvg);
  assert.equal(rlcDiodeSvg.includes('data-diagram-engine="circuit"'), true);
  assert.equal(rlcDiodeSvg.includes('NaN'), false);
  assert.equal(rlcDiodeSvg.includes('2mH'), true);
  assert.equal(rlcDiodeSvg.includes('>1</tspan>'), true);

  // 5c. circuit: BJT (npn/pnp) and MOSFET (nmos/pmos) primitives
  const transistorSvg = compileDiagramSpecSync({
    type: 'circuit',
    title: 'BJT 与 MOSFET 元件',
    elements: [
      { kind: 'node', label: 'u_i', anchor: 'in' },
      { kind: 'capacitor', label: 'C_1', dir: 'right' },
      { kind: 'npn', id: 'Q1', label: 'T_1', value: 'β=100' },
      { kind: 'resistor', label: 'R_C', fromAnchor: 'Q1.c', dir: 'up' },
      { kind: 'node', label: 'V_{CC}', anchor: 'vcc' },
      { kind: 'resistor', label: 'R_E', fromAnchor: 'Q1.e', dir: 'down' },
      { kind: 'ground' },
      { kind: 'pnp', id: 'Q2', fromAnchor: 'vcc', pin: 'e', dir: 'left', length: 1 },
      { kind: 'nmos', id: 'M1', label: 'M_1', fromAnchor: 'Q1.c' },
      { kind: 'pmos', id: 'M2', depletion: true, flip: true },
      { kind: 'wire', fromAnchor: 'M1.s', toAnchor: 'Q2.c' },
    ],
  });
  assert.ok(transistorSvg);
  assert.equal(transistorSvg.includes('data-diagram-engine="circuit"'), true);
  assert.equal(transistorSvg.includes('NaN'), false);
  assert.equal(transistorSvg.includes('data-ckt-kind="npn"'), true);
  assert.equal(transistorSvg.includes('data-ckt-kind="pnp"'), true);
  assert.equal(transistorSvg.includes('data-ckt-kind="nmos"'), true);
  assert.equal(transistorSvg.includes('data-ckt-kind="pmos"'), true);

  // 5d. circuit: orthogonal auto-routing & junction dot (log-amp diode feedback)
  const logOpampSvg = compileDiagramSpecSync({
    type: 'circuit',
    title: '负输入极性（u_I < 0）二极管对数运算电路',
    elements: [
      { kind: 'opamp', label: 'A', dir: 'right', anchor: 'u1' },
      { kind: 'wire', dir: 'left', fromAnchor: 'in-', anchor: 'N', length: 0.5 },
      { kind: 'resistor', label: 'R', dir: 'left', fromAnchor: 'N', anchor: 'uI', currentLabel: 'i_R', length: 1.5 },
      { kind: 'node', label: 'u_I (u_I < 0)', dir: 'right', anchor: 'uI' },
      { kind: 'wire', dir: 'up', fromAnchor: 'N', anchor: 'fb_left', length: 1.2 },
      { kind: 'wire', dir: 'up', fromAnchor: 'out', anchor: 'fb_right', length: 1.6 },
      { kind: 'diode', label: 'D', dir: 'left', fromAnchor: 'fb_right', toAnchor: 'fb_left', currentLabel: 'i_D', polarity: '+-' },
      { kind: 'wire', dir: 'right', fromAnchor: 'out', anchor: 'uO', length: 0.6 },
      { kind: 'node', label: 'u_O', dir: 'right', anchor: 'uO' },
      { kind: 'resistor', label: "R'", dir: 'down', fromAnchor: 'in+', anchor: 'gnd_top', length: 1 },
      { kind: 'ground', dir: 'down', fromAnchor: 'gnd_top' },
    ],
  });
  assert.ok(logOpampSvg);
  assert.equal(logOpampSvg.includes('data-ckt-junction="1"'), true);
  assert.equal(logOpampSvg.includes('NaN'), false);

  const assertOrthogonal = (svg: string) => {
    const stripped = svg.replace(/<g data-ckt-kind="[^"]*">[\s\S]*?<\/g>/g, '');
    for (const m of stripped.matchAll(/rotate\((-?[\d.]+)\)/g)) {
      const angle = Number(m[1]);
      assert.ok(
        Math.abs(angle / 90 - Math.round(angle / 90)) < 1e-3,
        `Expected orthogonal rotation angle, got ${angle}`
      );
    }
    for (const m of stripped.matchAll(/<line\b[^>]*>/g)) {
      const tag = m[0];
      const x1 = Number(tag.match(/\bx1="(-?[\d.]+)"/)?.[1]);
      const y1 = Number(tag.match(/\by1="(-?[\d.]+)"/)?.[1]);
      const x2 = Number(tag.match(/\bx2="(-?[\d.]+)"/)?.[1]);
      const y2 = Number(tag.match(/\by2="(-?[\d.]+)"/)?.[1]);
      assert.ok(
        Math.abs(x1 - x2) < 0.05 || Math.abs(y1 - y2) < 0.05,
        `Expected orthogonal <line>, got (${x1},${y1})->(${x2},${y2})`
      );
    }
  };
  assertOrthogonal(opampSvg);
  assertOrthogonal(rlcDiodeSvg);
  assertOrthogonal(transistorSvg);
  assertOrthogonal(logOpampSvg);

  const cktAliased = validateDiagramSpec({
    type: 'circuit',
    elements: [
      { kind: 'bjt' },
      { kind: 'PNP' },
      { kind: 'mosfet', channel: 'p' },
      { kind: 'nfet' },
    ],
  });
  assert.equal(cktAliased.success, true);
  if (cktAliased.success && cktAliased.data.type === 'circuit') {
    assert.deepEqual(
      cktAliased.data.elements.map((el) => el.kind),
      ['npn', 'pnp', 'pmos', 'nmos']
    );
  }

  // 6. Zod normalization + invalid rejection
  const aliased = validateDiagramSpec({
    type: 'matrix',
    cells: [[1, 2], [3, 4]],
    highlights: [{ row: 0, col: 0, tone: 'green' }],
  });
  assert.equal(aliased.success, true);
  if (aliased.success) {
    assert.equal(aliased.data.type, 'grid-annot');
    assert.equal(aliased.data.highlights?.[0]?.tone, 'positive');
  }

  assert.equal(validateDiagramSpec({ type: 'unknown', cells: [] }).success, false);
  assert.equal(validateDiagramSpec({ type: 'grid-annot', cells: [] }).success, false);
  assert.equal(validateDiagramSpec({ type: 'plot2d', xRange: [5, 1], functions: [{ expr: 'x' }] }).success, false);
  assert.equal(validateDiagramSpec({ type: 'wavedrom', signal: [] }).success, false);
  assert.equal(validateDiagramSpec({ type: 'circuit', elements: [{ kind: 'flux_capacitor' }] }).success, false);
});

test('Diagram Engine primary two-stage flow, diagnostics validation, repair patch, and markdown fenced blocks', async () => {
  const {
    parseImportedLessonContent,
    extractPendingDiagramSpecs,
    mergeStage2DiagramsIntoStage1,
    hasValidDiagramContent,
  } = await import('./coursewareParser');
  const {
    auditCoursewareRendering,
    applyCoursewareRepairPatch,
  } = await import('./coursewareDiagnostics');
  const { renderMarkdownWithLatex } = await import('./markdownMath');

  const slot = {
    id: 'sec-det-diag',
    dayIndex: 2,
    sectionId: 'sec-det-diag',
    title: '三阶行列式展开',
    date: '2026-11-19',
    objective: '掌握三阶行列式沙路法展开规律',
    keyTopics: ['三阶行列式', '沙路法'],
    prerequisites: [],
  };

  // 1. Primary track two-stage generation using diagramSpec in Stage 2
  const stage1Payload = JSON.stringify({
    title: '三阶行列式展开',
    summary: '掌握三阶行列式沙路法展开规律。',
    keyPoints: ['主对角线方向 3 项取正，副对角线方向 3 项取负'],
    markdownBody: '对照 {{diagram:diag-1}} 观察三阶行列式的沙路展开规则，完成后完成下方练习。',
    diagrams: [
      {
        id: 'diag-1',
        title: '三阶行列式沙路法示意',
        caption: '正负对角线方向标记',
        topologySpec: '3x3 grid-annot det with positive main diagonals and negative anti-diagonals',
        svgCode: '',
      },
    ],
    exercises: [
      {
        id: 'ex-1',
        type: 'fill',
        question: '结合附图计算行列式的值。',
        answer: '0',
        diagramId: 'diag-1',
        svgCode: '',
      },
    ],
  });

  const stage1Parsed = parseImportedLessonContent(stage1Payload, slot, 'chat', {}, { stageMode: 'stage1' });
  assert.equal(stage1Parsed.lesson.generationStage, 'stage1_content');
  const pending = extractPendingDiagramSpecs(stage1Parsed.lesson);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 'diag-1');

  const stage2Payload = JSON.stringify({
    diagrams: [
      {
        id: 'diag-1',
        title: '三阶行列式沙路法示意',
        caption: '正负对角线方向标记',
        diagramSpec: {
          type: 'grid-annot',
          brackets: 'det',
          cells: [
            ['1', '2', '3'],
            ['4', '5', '6'],
            ['7', '8', '9'],
          ],
          diagonals: [
            { cells: [[0, 0], [1, 1], [2, 2]], label: '+45', tone: 'positive' },
            { cells: [[0, 2], [1, 1], [2, 0]], label: '-105', tone: 'negative', dashed: true },
          ],
        },
      },
    ],
  });

  const mergedResult = mergeStage2DiagramsIntoStage1(stage1Parsed.lesson, stage2Payload);
  assert.equal(mergedResult.mergedLesson.generationStage, 'complete');
  assert.equal(mergedResult.mergedLesson.diagrams?.[0]?.diagramSpec?.type, 'grid-annot');
  assert.equal(hasValidDiagramContent(mergedResult.mergedLesson.diagrams?.[0]), true);
  assert.equal(mergedResult.mergedLesson.exercises[0].diagramSpec?.type, 'grid-annot');

  const cleanReport = auditCoursewareRendering(mergedResult.mergedLesson);
  assert.equal(cleanReport.errorCount, 0);

  // 2. auditCoursewareRendering detects invalid diagramSpec (in diagrams[], exercises[], and markdown fences),
  //    and applyCoursewareRepairPatch repairs it via diagramsToUpsert
  const brokenLesson = {
    ...mergedResult.mergedLesson,
    markdownBody: [
      '观察 {{diagram:diag-1}} 与公式 u_O = -(R_f / R_1) * u_I：',
      '',
      '```diagram:plot2d',
      '{"xRange": [10, 2], "functions": [{"expr": "x^2"}]}',
      '```',
    ].join('\n'),
    diagrams: [
      {
        id: 'diag-1',
        title: '损坏图',
        caption: '缺少字段',
        diagramSpec: { type: 'grid-annot', cells: [] } as any,
      },
    ],
    exercises: [
      {
        id: 'ex-1',
        type: 'fill' as const,
        question: '观察图形回答。',
        answer: '1',
        diagramSpec: { type: 'wavedrom', signal: [] } as any,
      },
    ],
  };

  const brokenReport = auditCoursewareRendering(brokenLesson);
  assert.equal(brokenReport.errorCount >= 3, true);
  assert.equal(brokenReport.repairPrompt.includes('diagramSpec'), true);

  const patchJson = JSON.stringify({
    diagramsToUpsert: [
      {
        id: 'diag-1',
        title: '修复后行列式图',
        caption: '修复完成',
        diagramSpec: {
          type: 'grid-annot',
          brackets: 'det',
          cells: [['1', '0'], ['0', '1']],
          diagonals: [{ cells: [[0, 0], [1, 1]], label: '+1', tone: 'positive' }],
        },
      },
    ],
  });
  const patchRes = applyCoursewareRepairPatch(
    {
      ...mergedResult.mergedLesson,
      diagrams: brokenLesson.diagrams,
      exercises: [
        {
          ...mergedResult.mergedLesson.exercises[0],
        },
      ],
    },
    patchJson,
    slot
  );
  assert.equal(patchRes.mergedLesson.diagrams?.[0]?.diagramSpec?.type, 'grid-annot');
  assert.equal(auditCoursewareRendering(patchRes.mergedLesson).errorCount, 0);

  // 3. Secondary track: markdown fenced diagram blocks + bare math coexistence + async placeholder
  const md = [
    '反相电路输出关系 u_O = -(R_f / R_1) * u_I 成立。',
    '',
    '```diagram:grid-annot',
    '{"brackets": "matrix", "cells": [[1, 2], [3, 4]], "highlights": [{"row": 0, "col": 0, "tone": "accent"}]}',
    '```',
    '',
    '```diagram:plot2d',
    '{"xRange": [-2, 2], "functions": [{"expr": "x^2", "label": "y = x^2", "tone": "positive"}]}',
    '```',
    '',
    '```diagram:graph',
    '{"direction": "LR", "nodes": [{"id": "a", "label": "Input"}, {"id": "b", "label": "Output"}], "edges": [{"from": "a", "to": "b"}]}',
    '```',
    '',
    '```diagram:plot2d',
    '{not valid json',
    '```',
    '',
    '```diagram:plot2d',
    '{"xRange": [10, 2], "functions": []}',
    '```',
  ].join('\n');

  const html = renderMarkdownWithLatex(md);
  assert.equal(html.includes('class="katex"'), true);
  assert.equal(html.includes('katex-error'), false);
  assert.equal(html.includes('data-diagram-engine="grid-annot"'), true);
  assert.equal(html.includes('data-diagram-engine="plot2d"'), true);
  assert.equal(html.includes('data-diagram-async-spec='), true);
  assert.equal(html.includes('正在等待完整结构化图表 JSON'), true);
  assert.equal(html.includes('data-diagram-engine="error"'), true);
});

test('Two-stage prompts enforce Stage 1 spec-only -> Stage 2 structured diagramSpec priority with free-SVG fallback and clean mode switching', async () => {
  const {
    composeCoursewareSystemPrompt,
    buildCourseLessonStage1Prompt,
    buildChatLessonStage1Prompt,
    buildLessonStage2DiagramsPrompt,
    buildAgentExecutionPrompt,
    buildAgentSectionStagePrompt,
  } = await import('../prompts/promptLibrary');
  const {
    parseImportedLessonContent,
    extractPendingDiagramSpecs,
    mergeStage2DiagramsIntoStage1,
  } = await import('./coursewareParser');
  const {
    auditCoursewareRendering,
    applyCoursewareRepairPatch,
  } = await import('./coursewareDiagnostics');

  const sysPrompt = composeCoursewareSystemPrompt({
    subjectProfile: 'electronics_engineering',
    learnerLevel: 'intermediate',
  });
  assert.equal(sysPrompt.includes('严禁在阶段一提前输出 `diagramSpec` 或 `svgCode`'), true);
  assert.equal(sysPrompt.includes('自由图表'), true);
  for (const kind of ['grid-annot', 'plot2d', 'graph', 'wavedrom', 'circuit']) {
    assert.equal(sysPrompt.includes(kind), true);
  }

  const slot = {
    id: 'sec-05',
    dayIndex: 5,
    date: '2026-11-19',
    title: '第 5 节：系统稳定裕度与受力分析',
    objective: '掌握频率响应波特图与复杂受力自由体图绘制',
    keyTopics: ['频率响应', '受力分析'],
    prerequisites: ['拉普拉斯变换'],
  };
  const course = {
    id: 'course-twostage-diag',
    name: '控制与力学综合',
    folderName: '控制与力学综合',
    courseDirPath: 'courses/控制与力学综合',
    category: 'stem' as const,
    generationMode: 'api' as const,
    subjectProfile: 'electronics_engineering' as const,
    goal: '全面适配两阶段图表工作流',
    durationDays: 8,
    startDate: '2026-11-19',
    extraRequirements: '',
    materials: [],
    masteredWords: [],
    exerciseSubmissions: {},
    dailyPlan: [slot],
    createdAt: '2026-11-19T00:00:00Z',
  };

  // 1. Stage 1 prompts across API, Chat, and Agent all forbid diagramSpec/svgCode and ask for [推荐类型: ...]
  const apiStage1 = buildCourseLessonStage1Prompt({
    course,
    slot,
    materialContext: '测试教材章节',
  });
  const chatStage1 = buildChatLessonStage1Prompt({
    course: { ...course, generationMode: 'chat' },
    slot,
    teachingSystemPrompt: sysPrompt,
  });
  const agentStage1 = buildAgentSectionStagePrompt({
    course,
    slot,
    workspaceDir: 'courses/控制与力学综合',
    stage: 'stage1',
    teachingSystemPrompt: sysPrompt,
  });
  const agentBatch = buildAgentExecutionPrompt({
    course,
    workspaceDir: 'courses/控制与力学综合',
    materialFilePaths: [],
    teachingSystemPrompt: sysPrompt,
  });

  for (const p of [apiStage1, chatStage1, agentStage1, agentBatch]) {
    assert.equal(p.includes('推荐类型'), true);
    assert.equal(p.includes('自由图表(svgCode)'), true);
    assert.equal(p.includes('grid-annot'), true);
    assert.equal(p.includes('plot2d'), true);
    assert.equal(p.includes('circuit'), true);
  }
  assert.equal(apiStage1.includes('禁止在本阶段输出 `diagramSpec`'), true);
  assert.equal(chatStage1.includes('禁止输出 `diagramSpec`'), true);
  assert.equal(agentStage1.includes('禁止输出 `diagramSpec`'), true);
  assert.equal(agentBatch.includes('禁止在本阶段输出 `diagramSpec`'), true);

  // 2. Stage 2 prompts across API/Chat and Agent prioritize 5 structured engines and allow free-SVG fallback
  const stage2Specs = [
    {
      id: 'diag-plot',
      title: '图 1：二次函数积分阴影',
      topologySpec: '[推荐类型: plot2d] 绘制 y=x^2 在 [-2, 2] 的图像与 [0, 2] 阴影面积',
      caption: '抛物线与面积阴影',
    },
    {
      id: 'diag-free',
      title: '图 2：斜面上滑块受力三维示意',
      topologySpec: '[推荐类型: 自由图表(svgCode)] 倾角 30° 光滑斜面与斜向上拉力 F、重力 G、法向支持力 N 的矢量图',
      caption: '5 类图表均无法直接绘制任意斜角力学受力，采用自由 SVG',
    },
  ];
  const stage2Prompt = buildLessonStage2DiagramsPrompt({
    courseName: course.name,
    slot,
    diagramSpecs: stage2Specs,
  });
  const agentStage2 = buildAgentSectionStagePrompt({
    course,
    slot,
    workspaceDir: 'courses/控制与力学综合',
    stage: 'stage2',
    teachingSystemPrompt: sysPrompt,
    diagramSpecs: stage2Specs,
  });

  for (const p of [stage2Prompt, agentStage2]) {
    assert.equal(p.includes('无需教材原文 PDF'), true);
    assert.equal(p.includes('diagramSpec'), true);
    assert.equal(p.includes('自由图表'), true);
    assert.equal(p.includes('svgCode'), true);
    assert.equal(p.includes('二选一'), true);
    assert.equal(p.includes('严禁写入 LaTeX 反斜杠命令'), true);
  }
  assert.equal(agentStage2.includes('只依据规格生成 SVG'), false);

  // 3. Stage 1 empty spec warning tells user to complete topologySpec only (never asking for diagramSpec in Stage 1)
  const stage1EmptySpecAudit = auditCoursewareRendering(
    {
      sectionId: 'sec-05',
      dayIndex: 5,
      date: '2026-11-19',
      title: '空规格告警检测',
      summary: '摘要',
      generationStage: 'stage1_content',
      keyPoints: ['要点'],
      markdownBody: '正文中引用 {{diagram:diag-empty}}。',
      diagrams: [{ id: 'diag-empty', title: '图 1', caption: '' }],
      exercises: [],
      generatedAt: '2026-11-19T00:00:00Z',
    },
    {},
    { stage: 'stage1' }
  );
  const specEmptyIssue = stage1EmptySpecAudit.issues.find((i) => i.id.startsWith('spec-empty-'));
  assert.ok(specEmptyIssue);
  assert.equal(specEmptyIssue.fixInstruction.includes('阶段一无需输出 diagramSpec 或 svgCode'), true);

  // 4. Hybrid Stage 2 merge: one structured diagramSpec + one free-form svgCode
  const stage1Raw = JSON.stringify({
    generationStage: 'stage1_content',
    title: slot.title,
    summary: '综合图表示例',
    keyPoints: ['函数积分与受力分析'],
    markdownBody: '首先看曲线 {{diagram:diag-plot}}，再看斜面力学分析 {{diagram:diag-free}}。',
    diagrams: [
      {
        id: 'diag-plot',
        title: '图 1：二次函数曲线',
        topologySpec: '[推荐类型: plot2d] y=x^2，x in [-2, 2]',
        caption: '曲线与积分阴影',
      },
      {
        id: 'diag-free',
        title: '图 2：斜面滑块受力分析',
        topologySpec: '[推荐类型: 自由图表(svgCode)] 30° 斜面滑块 G/N/F 矢量示意',
        caption: '斜面受力矢量图',
      },
    ],
    exercises: [
      {
        id: 'ex-1',
        type: 'fill',
        question: '结合图 diag-free，求沿斜面方向平衡分量。',
        answer: 'G sin 30°',
        diagramId: 'diag-free',
      },
    ],
  });
  const s1 = parseImportedLessonContent(stage1Raw, slot, 'chat', {}, { stageMode: 'stage1' }).lesson;
  assert.equal(extractPendingDiagramSpecs(s1).length, 2);

  const hybridStage2 = JSON.stringify({
    diagrams: [
      {
        id: 'diag-plot',
        title: '图 1：二次函数曲线',
        caption: '曲线与积分阴影',
        diagramSpec: {
          type: 'plot2d',
          xRange: [-2, 2],
          functions: [{ expr: 'x^2', label: 'y = x^2', tone: 'accent' }],
          shadedRegions: [{ expr: 'x^2', from: 0, to: 1.5, tone: 'positive' }],
        },
      },
      {
        id: 'diag-free',
        title: '图 2：斜面滑块受力分析',
        caption: '斜面受力矢量图',
        svgCode: '<svg viewBox="0 0 680 320" xmlns="http://www.w3.org/2000/svg"><line x1="80" y1="260" x2="520" y2="260" stroke="#94a3b8" stroke-width="2"/><text x="120" y="240" fill="#e2e8f0" font-size="14">30 deg</text></svg>',
      },
    ],
  });
  const hybridMerged = mergeStage2DiagramsIntoStage1(s1, hybridStage2);
  assert.equal(hybridMerged.matchedCount, 2);
  assert.equal(hybridMerged.pendingRemaining.length, 0);
  assert.equal(hybridMerged.mergedLesson.diagrams?.[0]?.diagramSpec?.type, 'plot2d');
  assert.equal(hybridMerged.mergedLesson.diagrams?.[0]?.svgCode, undefined);
  assert.equal(hybridMerged.mergedLesson.diagrams?.[1]?.diagramSpec, undefined);
  assert.equal(hybridMerged.mergedLesson.diagrams?.[1]?.svgCode?.includes('<svg'), true);
  assert.equal(hybridMerged.mergedLesson.exercises[0].diagramSpec, undefined);
  assert.equal(hybridMerged.mergedLesson.exercises[0].svgCode?.includes('<svg'), true);
  const hybridAudit = auditCoursewareRendering(hybridMerged.mergedLesson);
  assert.equal(hybridAudit.errorCount, 0);

  // 5. Malformed diagramSpec in Stage 2 is preserved for Zod diagnostics & repair patch can switch cleanly to free svgCode (clearing stale diagramSpec on both diagram and exercise)
  const badStage2Payload = JSON.stringify({
    diagrams: [
      {
        id: 'diag-free',
        title: '图 2：误用失败的 plot2d',
        caption: '待修正',
        diagramSpec: { type: 'plot2d', xRange: [10, 2], functions: [] },
      },
      {
        id: 'diag-plot',
        diagramSpec: { type: 'plot2d', xRange: [-2, 2], functions: [{ expr: 'x^2' }] },
      },
    ],
  });
  const badMerged = mergeStage2DiagramsIntoStage1(s1, badStage2Payload);
  assert.equal(badMerged.pendingRemaining.some((p) => p.id === 'diag-free'), true);
  const badAudit = auditCoursewareRendering(badMerged.mergedLesson);
  assert.equal(badAudit.errorCount > 0, true);
  assert.equal(
    badAudit.issues.some((iss) => iss.id.startsWith('diagramspec-invalid-') && iss.locationLabel.includes('diag-free')),
    true
  );

  // Switch diag-free from malformed diagramSpec to free-form svgCode via repair patch
  const switchToSvgPatch = JSON.stringify({
    diagramsToUpsert: [
      {
        id: 'diag-free',
        title: '图 2：斜面滑块受力分析',
        caption: '切换为自由图表 SVG',
        svgCode: '<svg viewBox="0 0 680 320" xmlns="http://www.w3.org/2000/svg"><rect x="40" y="40" width="200" height="120" fill="#18181b" stroke="#38bdf8"/><text x="60" y="95" fill="#f8fafc" font-size="14">Free Diagram</text></svg>',
      },
    ],
  });
  const patchedToSvg = applyCoursewareRepairPatch(badMerged.mergedLesson, switchToSvgPatch, slot);
  assert.equal(patchedToSvg.mergedLesson.diagrams?.[1]?.diagramSpec, undefined);
  assert.equal(patchedToSvg.mergedLesson.diagrams?.[1]?.svgCode?.includes('<svg'), true);
  assert.equal(patchedToSvg.mergedLesson.exercises[0].diagramSpec, undefined);
  assert.equal(patchedToSvg.mergedLesson.exercises[0].svgCode?.includes('<svg'), true);
  assert.equal(auditCoursewareRendering(patchedToSvg.mergedLesson).errorCount, 0);

  // Conversely, switching diag-free back to valid structured diagramSpec clears stale svgCode on both diagram & exercise
  const switchToSpec = mergeStage2DiagramsIntoStage1(patchedToSvg.mergedLesson, JSON.stringify({
    diagrams: [
      {
        id: 'diag-free',
        diagramSpec: {
          type: 'graph',
          direction: 'LR',
          nodes: [{ id: 'a', label: 'Block' }, { id: 'b', label: 'Force' }],
          edges: [{ from: 'a', to: 'b', label: 'F' }],
        },
      },
    ],
  }));
  assert.equal(switchToSpec.mergedLesson.diagrams?.[1]?.diagramSpec?.type, 'graph');
  assert.equal(switchToSpec.mergedLesson.diagrams?.[1]?.svgCode, undefined);
  assert.equal(switchToSpec.mergedLesson.exercises[0].diagramSpec?.type, 'graph');
  assert.equal(switchToSpec.mergedLesson.exercises[0].svgCode, undefined);
  assert.equal(auditCoursewareRendering(switchToSpec.mergedLesson).errorCount, 0);
});

test('copyPromptText preserves synchronous execCommand gesture on mobile HTTP LAN, supports iOS Safari selection, and falls back/throws cleanly', async () => {
  const { copyPromptText } = await import('./clipboardFile');

  const origWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const origDocDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');

  const restoreGlobals = () => {
    if (origWindowDesc) Object.defineProperty(globalThis, 'window', origWindowDesc);
    else delete (globalThis as any).window;
    if (origNavDesc) Object.defineProperty(globalThis, 'navigator', origNavDesc);
    else delete (globalThis as any).navigator;
    if (origDocDesc) Object.defineProperty(globalThis, 'document', origDocDesc);
    else delete (globalThis as any).document;
  };

  try {
    // 1. Mobile non-secure HTTP LAN context (Android Chrome): skips clipboard.writeText even if stubbed, invokes focus + execCommand synchronously
    let writeTextCalled = 0;
    let execCommandResult = true;
    const calls: string[] = [];
    let createdField: any = null;
    const fakeSelection = {
      ranges: [] as any[],
      removeAllRanges() {
        this.ranges = [];
        calls.push('removeAllRanges');
      },
      addRange(r: any) {
        this.ranges.push(r);
        calls.push('addRange');
      },
    };
    const fakeDocument = {
      activeElement: { focus: () => calls.push('restoreFocus') },
      body: {
        appendChild(el: any) {
          createdField = el;
          calls.push('appendChild');
        },
      },
      createElement() {
        const el: any = {
          value: '',
          readOnly: false,
          contentEditable: 'inherit',
          style: { cssText: '' },
          setAttribute() {},
          focus() {
            calls.push('focus');
          },
          select() {
            calls.push('select');
          },
          setSelectionRange(s: number, e: number) {
            calls.push(`setSelectionRange:${s}-${e}`);
          },
          remove() {
            calls.push('remove');
          },
        };
        return el;
      },
      createRange() {
        return {
          selectNodeContents() {
            calls.push('selectNodeContents');
          },
        };
      },
      execCommand(cmd: string) {
        calls.push(`execCommand:${cmd}`);
        return execCommandResult;
      },
    };

    Object.defineProperty(globalThis, 'document', { value: fakeDocument, configurable: true });
    Object.defineProperty(globalThis, 'window', {
      value: { isSecureContext: false, getSelection: () => fakeSelection },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
        clipboard: {
          writeText: async () => {
            writeTextCalled++;
          },
        },
      },
      configurable: true,
    });

    await copyPromptText('stage2-prompt-android');
    assert.equal(writeTextCalled, 0);
    assert.equal(createdField.readOnly, true);
    assert.equal(calls.includes('focus'), true);
    assert.equal(calls.includes('select'), true);
    assert.equal(calls.includes('execCommand:copy'), true);
    assert.ok(calls.indexOf('focus') < calls.indexOf('execCommand:copy'));

    // 2. iOS Safari HTTP LAN path: sets contentEditable=true, readOnly=false, uses Range + getSelection
    calls.length = 0;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
      },
      configurable: true,
    });
    await copyPromptText('stage2-prompt-ios');
    assert.equal(createdField.contentEditable, 'true');
    assert.equal(createdField.readOnly, false);
    assert.equal(calls.includes('selectNodeContents'), true);
    assert.equal(calls.includes('addRange'), true);
    assert.equal(calls.includes('execCommand:copy'), true);

    // 3. Secure context where navigator.clipboard.writeText rejects falls back cleanly to execCommand
    calls.length = 0;
    let secureAttempted = 0;
    Object.defineProperty(globalThis, 'window', {
      value: { isSecureContext: true, getSelection: () => fakeSelection },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        platform: 'iPhone',
        maxTouchPoints: 5,
        clipboard: {
          writeText: async () => {
            secureAttempted++;
            throw new Error('NotAllowedError');
          },
        },
      },
      configurable: true,
    });
    await copyPromptText('fallback-after-reject');
    assert.equal(secureAttempted, 1);
    assert.equal(calls.includes('execCommand:copy'), true);

    // 4. Both async clipboard and execCommand fail -> throws actionable error for manual preview fallback
    execCommandResult = false;
    await assert.rejects(
      () => copyPromptText('fail-both'),
      /一键复制全文/
    );
  } finally {
    restoreGlobals();
  }
});
