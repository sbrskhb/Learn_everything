import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import {
  BUILTIN_VOCAB_BANKS,
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

test('vocabulary set difference: CET-6 minus Gaokao yields exact remaining words', () => {
  const cet6 = BUILTIN_VOCAB_BANKS.cet6.words;
  const gaokao = BUILTIN_VOCAB_BANKS.gaokao.words;

  const diff = computeVocabSetDifference(cet6, gaokao);
  assert.equal(diff.overlapCount, gaokao.length);
  assert.equal(diff.effectiveWords.length, diff.targetTotal - gaokao.length);
  const gaokaoKeys = new Set(gaokao.map((w) => w.word.toLowerCase()));
  for (const item of diff.effectiveWords) {
    assert.equal(gaokaoKeys.has(item.word.toLowerCase()), false);
  }
});

test('allocateEnglishWordsRandomly & computeVocabCoverageStats: random non-repeating draw and preserving started sections', () => {
  const cet6 = BUILTIN_VOCAB_BANKS.cet6.words;
  const gaokao = BUILTIN_VOCAB_BANKS.gaokao.words;
  const diff = computeVocabSetDifference(cet6, gaokao);

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
  const sampleWords = BUILTIN_VOCAB_BANKS.gaokao.words.slice(0, 25);
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
  assert.equal(stemPrompt.includes('"estimatedMinutes"'), true);
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
  assert.equal(englishPrompt.includes('estimatedMinutes'), true);
  assert.equal(englishPrompt.includes('2026-11-12'), false);
  assert.equal(englishPrompt.includes('排程第'), false);
  assert.equal(englishPrompt.includes('{{heuristic:hq-X}}'), true);
  assert.equal(englishPrompt.includes('{{exercise:ex-X}}'), true);
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
  assert.equal(agentPrompt.includes('"estimatedMinutes"'), true);
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
  assert.equal(chatLessonPrompt.includes('"estimatedMinutes"'), true);
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

  // 4. English category dynamically switches baseline/depth option copy and strategy summary
  const { getBaselinePresetOptions, getDepthPresetOptions } = await import(
    '../prompts/promptLibrary'
  );
  const stemBaselines = getBaselinePresetOptions('stem');
  const engBaselines = getBaselinePresetOptions('english');
  assert.notEqual(stemBaselines[1].title, engBaselines[1].title);
  assert.equal(engBaselines[1].title.includes('四六级'), true);

  const stemDepths = getDepthPresetOptions('stem');
  const engDepths = getDepthPresetOptions('english');
  assert.notEqual(stemDepths[1].title, engDepths[1].title);
  assert.equal(engDepths[1].title.includes('外刊精读'), true);

  const engProfile = resolveLearnerProfile({
    category: 'english',
    learnerBaseline: 'zero_base',
    learningDepth: 'master_textbook',
  });
  assert.equal(engProfile.combinedLabel.includes('英语基础薄弱'), true);
  assert.equal(engProfile.combinedLabel.includes('吃透外刊精读'), true);
  assert.equal(engProfile.strategySummary.includes('英语跨阶强攀升策略'), true);
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
    [40, 55, 50, 45, 60]
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
  assert.equal(parsed.lesson.estimatedMinutes, 65);
  assert.equal(
    estimateSectionMinutesFallback({
      ...slot,
      estimatedMinutes: 45,
      lesson: parsed.lesson,
    }),
    65
  );

  // When estimatedMinutes is omitted in an imported lesson, parseImportedLessonContent estimates it from written content
  const parsedNoMinutes = parseImportedLessonContent(
    JSON.stringify({ title: slot.title, markdownBody: '推导正文 $u_O = -\\frac{R_f}{R_1} u_I$' }),
    slot
  );
  assert.equal((parsedNoMinutes.lesson.estimatedMinutes || 0) >= 20, true);
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
  assert.equal(html.includes('lesson-callout-textbook'), true);
  assert.equal(html.includes('教材正文'), true);
  assert.equal(html.includes('lesson-callout-prereq'), true);
  assert.equal(html.includes('先修补充'), true);
  assert.equal(html.includes('lesson-callout-intuition'), true);
  assert.equal(html.includes('直观解释'), true);
  assert.equal(html.includes('lesson-callout-extension'), true);
  assert.equal(html.includes('边界与拓展'), true);
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
  assert.equal(getEvaluatedSectionMinutes(withLessonSlot), 65);
  const afterEval = allocateSectionsToDays([withLessonSlot, reallocated[1]], 2, '2026-11-14');
  assert.equal(afterEval[0].estimatedMinutes, 65);
  assert.equal(afterEval[1].estimatedMinutes, undefined);
  const scheduleAfterEval = buildCourseDailySchedule(afterEval, 2, '2026-11-14');
  assert.equal(scheduleAfterEval[0].estimatedMinutes, 65);

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

test('Step 3 lesson prompts list all bound multi-region PDF segments and place estimatedMinutes after qualityCheck', async () => {
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
    const revIdx = p.indexOf('"reverseChecks"');
    assert.equal(revIdx >= 0, true);
    const afterRev = p.slice(revIdx);
    assert.equal(afterRev.includes('"estimatedMinutes"'), true);
    const summaryIdx = p.lastIndexOf('"summary"', revIdx);
    if (summaryIdx >= 0) {
      assert.equal(p.slice(summaryIdx, revIdx).includes('"estimatedMinutes"'), false);
    }
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
  assert.equal(parsedMd.lesson.estimatedMinutes, 52);

  const repaired = applyCoursewareRepairPatch(
    parsedMd.lesson,
    JSON.stringify({ summary: '更新摘要', estimatedMinutes: 58 }),
    slot,
  );
  assert.equal(repaired.mergedLesson.estimatedMinutes, 58);

  const badgeOnlyHtml = renderMarkdownWithLatex('> [!textbook]\n> 教材原话内容');
  assert.equal(badgeOnlyHtml.includes('lesson-callout-textbook'), true);
  assert.equal(badgeOnlyHtml.includes('lesson-callout-header-badge-only'), true);
  assert.equal(badgeOnlyHtml.includes('教材正文'), true);

  const titledHtml = renderMarkdownWithLatex('> [!textbook] 核心定义\n> 教材原话内容');
  assert.equal(titledHtml.includes('lesson-callout-title'), true);
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


