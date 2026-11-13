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
  allocateWordsToDays,
  buildDateTimeline,
  computeVocabCoverageStats,
  computeVocabSetDifference,
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
  isGarbledPdfText,
  parseImportedPdfSplitPlan,
  sanitizePdfExtractedText,
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
  assert.equal(defaults.syllabusSystemPrompt.includes('知识点目录'), true);
  assert.equal(defaults.courseSystemPrompt.includes('实际问题引入'), true);

  assert.equal(inferSubjectProfile('stem', '模拟电子技术基础'), 'electronics_engineering');
  assert.equal(inferSubjectProfile('stem', '高等数学与微积分'), 'math_physics');
  assert.equal(inferSubjectProfile('stem', '操作系统与数据结构'), 'computer_science');

  const composedBeginner = composeCoursewareSystemPrompt({
    subjectProfile: 'math_physics',
    learnerLevel: 'beginner',
  });
  assert.equal(composedBeginner.includes('初学者'), true);

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

  const mockSlot = {
    id: 'sec-02',
    dayIndex: 2,
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
  assert.equal(stemPrompt.includes('2/10'), true);
  assert.equal(stemPrompt.includes('先思考，后讲解'), true);
  assert.equal(stemPrompt.includes('{{heuristic:hq-1}}'), true);
  assert.equal(stemPrompt.includes('{{diagram:diag-1}}'), true);
  assert.equal(stemPrompt.includes('{{exercise:ex-1}}'), true);
  assert.equal(stemPrompt.includes('intermediateStepsAuditNote'), true);

  const englishPrompt = buildEnglishLessonUserPrompt({
    course: { ...mockCourse, name: '六级外刊精读', category: 'english' },
    slot: mockSlot,
    targetWords: [{ word: 'alleviate', phonetic: '/əˈliːvieɪt/', meaning: 'v. 减轻' }],
    articleMode: 'media_search',
    preferredSources: 'The New Yorker, The Economist',
    materialContext: '',
  });
  assert.equal(englishPrompt.includes('alleviate'), true);
  assert.equal(englishPrompt.includes('{{heuristic:hq-1}}'), true);
  assert.equal(englishPrompt.includes('{{diagram:diag-1}}'), true);
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
  assert.equal(teachingSystemPrompt.includes('先思考，后讲解'), true);
  assert.equal(teachingSystemPrompt.includes('知识点闭环'), true);
  assert.equal(teachingSystemPrompt.includes('图文同步'), true);
  assert.equal(teachingSystemPrompt.includes('强化迁移能力'), true);

  const agentPrompt = buildAgentExecutionPrompt({
    course: sampleCourse,
    workspaceDir: 'courses/电路原理与信号分析',
    materialFilePaths: ['courses/电路原理与信号分析/sources/rc_circuit.pdf'],
    teachingSystemPrompt,
  });
  assert.equal(agentPrompt.includes('courses/电路原理与信号分析/lessons/sec-01.json'), true);
  assert.equal(agentPrompt.includes('segments/sec-01.pdf'), true);
  assert.equal(agentPrompt.includes('{{heuristic:hq-1}}'), true);
  assert.equal(agentPrompt.includes('{{diagram:diag-1}}'), true);
  assert.equal(agentPrompt.includes('{{exercise:ex-1}}'), true);
  assert.equal(agentPrompt.includes('intermediateStepsAuditNote'), true);

  const chatLessonPrompt = buildChatLessonPrompt({
    course: sampleCourse,
    slot: sampleCourse.dailyPlan[0],
    teachingSystemPrompt,
  });
  assert.equal(chatLessonPrompt.includes('sec-01.pdf'), true);
  assert.equal(chatLessonPrompt.includes('换路定则'), true);
  assert.equal(chatLessonPrompt.includes('{{heuristic:hq-1}}'), true);
  assert.equal(chatLessonPrompt.includes('{{diagram:diag-1}}'), true);
  assert.equal(chatLessonPrompt.includes('{{exercise:ex-1}}'), true);

  const chatSyllabusPrompt = buildChatSyllabusPrompt({ course: sampleCourse });
  assert.equal(chatSyllabusPrompt.includes('knowledgeCatalog'), true);
  assert.equal(chatSyllabusPrompt.includes('合理控制学习负荷'), true);

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

  const parsedResult = parseImportedLessonContent(
    rawChatResponse,
    sampleCourse.dailyPlan[0],
    'chat',
    {}
  );
  assert.equal(parsedResult.lesson.sectionId, 'sec-01');
  assert.deepEqual(parsedResult.unresolvedImageRefs, ['rc_waveform.png']);
  assert.equal(parsedResult.lesson.diagrams?.[0]?.id, 'diag-1');
  assert.equal(
    parsedResult.lesson.heuristicQuestions?.[0]?.approach?.includes('du_C/dt'),
    true
  );
  assert.equal(parsedResult.lesson.exercises[0].stage, 'inline');
  assert.equal(parsedResult.lesson.exercises[0].hint?.includes('电场储能'), true);
  assert.equal(parsedResult.lesson.exercises[1].stage, 'comprehensive');
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

test('isGarbledPdfText and sanitizePdfExtractedText reject CID glyph gibberish while preserving clean lines', () => {
  assert.equal(isGarbledPdfText('2.08 k,SsS_R0-50vkO|ep0 VN:Rv_QeOS|epQ\\,b@NN:'), true);
  assert.equal(isGarbledPdfText('6.1 Wg,{u5 281 _QR=500 k (2) NW0cS,R{,N~SN:S'), true);
  assert.equal(isGarbledPdfText('6.1.17) V'), true);
  assert.equal(isGarbledPdfText('6.1.21) dt V'), true);

  assert.equal(isGarbledPdfText('第 6 章 放大电路中的反馈与稳定性分析'), false);
  assert.equal(isGarbledPdfText('Chapter 6 Feedback Amplifiers and Stability'), false);

  const cleaned = sanitizePdfExtractedText(
    [
      '2.08 k,SsS_R0-50vkO|ep0 VN:Rv_QeOS|epQ\\,b@NN:',
      '第 6 章 负反馈放大电路基础',
      '6.1 Wg,{u5 281 _QR=500 k (2) NW0cS,R{,N~SN:S',
      '6.1.17) V',
      '闭环增益公式 Af = A / (1 + AF)',
    ].join('\n')
  );
  assert.equal(cleaned.includes('第 6 章 负反馈放大电路基础'), true);
  assert.equal(cleaned.includes('闭环增益公式'), true);
  assert.equal(cleaned.includes('SsS_R0'), false);
  assert.equal(cleaned.includes('6.1.17) V'), false);
});

test('analyzePdfBuffer extracts clean text via pdfjs-dist and Step 1 region split -> Step 2 outline preserves regionId', async () => {
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
    assert.equal(analyzed.fullText.includes('Feedback Concepts'), true);
    assert.equal(analyzed.fullText.includes('Bode Plot Stability'), true);

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

test('pure multimodal PDF flow: zero OCR text injected into API, Agent, or Chat prompts across all 3 steps', async () => {
  const { detectTocAndOffsetFromPages } = await import('./pdfProcessor');
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
  assert.deepEqual(analyzed.meta.tocEntries, []);
  for (const page of analyzed.meta.pages) {
    assert.equal(page.printedPageHint, undefined);
  }

  // Even direct calls to deprecated detectTocAndOffsetFromPages return empty/zero
  const deprecatedDetected = detectTocAndOffsetFromPages([
    { physicalPage: 1, textPreview: '278 第6章信号的运算和处理' },
    { physicalPage: 2, textPreview: '图 6.1.1 的电路图 279' },
  ]);
  assert.equal(deprecatedDetected.detectedPageOffset, 0);
  assert.deepEqual(deprecatedDetected.tocEntries, []);

  // Simulate dirty OCR page previews & extractedText on a 62-page PDF
  const pages62 = Array.from({ length: 62 }, (_, i) => ({
    physicalPage: i + 1,
    textPreview: `DIRTY_OCR_TOKEN_PAGE_${i + 1} 2.08 k,SsS_R0-50vkO`,
  }));

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
        extractedText: 'GARBAGE_OCR_DUMP_SHOULD_NEVER_BE_IN_PROMPT',
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
          extractedSegmentText: 'LEGACY_OCR_SEGMENT_SHOULD_NOT_APPEAR',
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
        extractedSegmentText: 'LEGACY_OCR_SEGMENT_SHOULD_NOT_APPEAR',
        status: 'sliced' as const,
      },
    ],
    masteredWords: [],
    exerciseSubmissions: {},
    createdAt: '2026-11-12T00:00:00Z',
  };

  // Step 1: API / Agent / Chat split prompts must NEVER contain OCR text or appendix
  const prompts = buildPdfSplitPrompts({
    course: mockCourse,
    pdfMetas: [
      {
        fileName: 'example.pdf',
        totalPages: 62,
        detectedPageOffset: 0,
        tocEntries: [],
        pages: pages62,
      },
    ],
    courseRelDir: 'courses/模电',
  });

  for (const promptStr of [prompts.apiUserPrompt, prompts.agentSplitPrompt, prompts.chatSplitPrompt]) {
    assert.equal(promptStr.includes('印刷第'), false);
    assert.equal(promptStr.includes('DIRTY_OCR_TOKEN'), false);
    assert.equal(promptStr.includes('附：PDF 各物理页提取文本'), false);
    assert.equal(promptStr.includes('example.pdf'), true);
    assert.equal(promptStr.includes('多模态'), true);
  }
  assert.equal(prompts.agentSplitPrompt.includes('.txt'), false);

  // Step 2: Syllabus prompts must NEVER inject PDF OCR text, while preserving plain-text notes
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
    assert.equal(sPrompt.includes('GARBAGE_OCR_DUMP'), false);
    assert.equal(sPrompt.includes('LEGACY_OCR_SEGMENT'), false);
    assert.equal(sPrompt.includes('PLAIN_TEXT_SUPPLEMENT_NOTE'), true);
    assert.equal(sPrompt.includes('region-01.pdf'), true);
  }

  // Step 3: Chat lesson prompt must NEVER inject PDF OCR text, while referencing sliced PDF & plain-text notes
  const chatLessonPrompt = buildChatLessonPrompt({
    course: mockCourse,
    slot: mockCourse.dailyPlan[0],
    teachingSystemPrompt: '系统教学规范',
  });
  assert.equal(chatLessonPrompt.includes('GARBAGE_OCR_DUMP'), false);
  assert.equal(chatLessonPrompt.includes('LEGACY_OCR_SEGMENT'), false);
  assert.equal(chatLessonPrompt.includes('PLAIN_TEXT_SUPPLEMENT_NOTE'), true);
  assert.equal(chatLessonPrompt.includes('region-01.pdf'), true);
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

  // Verify linkifyDiagramRefsInHtml skips <svg>, <code>, and .katex nodes while linking distant text citations
  const mixedHtml =
    '<p>根据图 diag-1 与图 1.1 分析，参见图片 scope_wave.png；<code>diag-1</code> 与 <span class="katex">diag-1</span> 不应被包裹。</p><svg><text>diag-1</text></svg>';
  const linked = linkifyDiagramRefsInHtml(mixedHtml, visuals);
  assert.equal(linked.includes('data-visual-ref="diag-1"'), true);
  assert.equal(linked.includes('data-visual-ref="img-1"'), true);
  assert.equal(linked.includes('<code>diag-1</code>'), true);
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

