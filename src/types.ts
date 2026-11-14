export type CourseCategory = 'general' | 'stem' | 'english';

export type SubjectProfile =
  | 'electronics_engineering'
  | 'math_physics'
  | 'computer_science'
  | 'english_language'
  | 'general_academic';

export type LearnerLevel = 'beginner' | 'intermediate' | 'advanced';

export type LearnerBaselinePreset =
  | 'zero_base'
  | 'partial_base'
  | 'solid_base'
  | 'custom';

export type LearningDepthPreset =
  | 'understand_basics'
  | 'master_textbook'
  | 'deep_rigorous'
  | 'custom';

export interface LessonSymbolEntry {
  symbol: string;
  aliases?: string[];
  name: string;
  definition: string;
  unit?: string;
}

export type EnglishArticleMode = 'media_search' | 'llm_original';

export interface PromptModuleToggles {
  problemIntroduction: boolean;      // 从实际或工程问题引入
  intuitionToDefinition: boolean;    // 先通俗解释核心思想，再给严格定义与术语解释
  knowledgeConnection: boolean;      // 说明与已学知识的联系、区别与适用场景
  continuousDerivation: boolean;     // 逐步展示推导，注明每步原理、符号含义与单位，禁止跳步
  confusionComparison: boolean;      // 主动比较易混淆概念，指出常见误解与判断方法
  stagedDiagrams: boolean;           // 提供标明部件、物理量与方向的分阶段或结构图示
  workedExamples: boolean;           // 代表性例题，含题意、思路、分步解答与结果分析
  heuristicQuestions: boolean;       // 关键推导与解题前设置引导性思考问题
  progressiveExercises: boolean;     // 按概念辨析→直接应用→综合迁移设置递进练习，附错因分析
  reverseExplanationCheck: boolean;  // 反向解释检验：要求用自己的语言解释概念或结论成立原因
  noCodeForNonCS: boolean;           // 非计算机类课程不无故输出程序代码
}

export interface VocabItem {
  word: string;
  phonetic?: string;
  meaning: string;
  example?: string;
  exampleTranslation?: string;
}

export type ExerciseDifficulty = 'basic' | 'application' | 'comprehensive';
export type ExerciseStage = 'inline' | 'comprehensive';

export interface ExerciseVariantCheck {
  question: string;
  options?: string[];
  answer: string;
  explanation?: string;
}

export interface ExerciseQuestion {
  id: string;
  stage?: ExerciseStage;           // 'inline' (紧跟核心知识点的即时练习) | 'comprehensive' (章节末综合练习)
  type: 'choice' | 'fill';
  difficulty?: ExerciseDifficulty; // 基础概念辨析 | 直接应用 | 综合与迁移分析
  categoryLabel?: string;          // 例如：概念辨析 / 直接应用 / 错误分析 / 知识迁移
  diagramId?: string;              // 关联的题目配图 ID（如 "diag-ex-1"），当题目需要复杂描述才能画出的电路/几何/物理图时内嵌展示
  topologySpec?: string;           // 复杂题设配图生成 SVG 前确定的电路拓扑、节点连接、元件参数与参考方向说明
  svgCode?: string;                // 可选：直接内联在练习题对象上的 SVG 代码
  diagramTitle?: string;           // 可选：题目配图标题
  diagramCaption?: string;         // 可选：题目配图图注说明
  question: string;
  options?: string[];              // For 'choice', e.g. ["A. ...", "B. ...", "C. ...", "D. ..."]
  answer: string;                  // Standard answer, e.g. "A" or exact word/value
  hint?: string;                   // 启发式解题提示（支持离线随时展开）
  explanation?: string;            // Detailed step-by-step solution (可选：按教学价值选择性生成)
  wrongOptionsAnalysis?: string;   // 可选：错误选项原因分析或常见误解说明（错误诊断）
  remediation?: string;            // 可选：针对典型错误概念根源的针对性补救讲解
  variantCheck?: ExerciseVariantCheck | string; // 可选：补救后的变式检验题（离线再次检验）
}

export interface LessonDiagram {
  id?: string;                     // 内联锚点标识，如 "diag-1"，用于在正文 {{diagram:diag-1}} 处图文同步渲染
  title: string;
  stageLabel?: string;             // 例如：阶段一：静态工作点建立 / 阶段二：交流小信号叠加
  topologySpec?: string;           // 绘图规格：拓扑连接、元件参数、物理量、参考方向及坐标系要求
  caption: string;                 // 图示与正文的对应说明（标明部件、物理量、方向及相互关系）
  svgCode?: string;                // 内联 SVG 代码（阶段一仅输出规格时可为空，由阶段二组装补全）
}

export interface HeuristicQuestionItem {
  id: string;                      // 内联锚点标识，如 "hq-1"，用于在正文 {{heuristic:hq-1}} 处“先思考，后讲解”
  context: string;                 // 对应的推导环节或知识点位置
  question: string;                // 引导性思考问题（先思考再看下一步）
  hint?: string;                   // 可选第一层：轻量思考提示
  approach?: string;               // 可选第二层：分析切入思路
  answerReveal?: string;           // 完整推导解释或原理说明（支持 Markdown + LaTeX）
}

export interface ReverseCheckItem {
  id: string;
  topic: string;                   // 检验的核心概念或定理
  prompt: string;                  // 要求用户用自己的语言解释的问题（例如说明某结论为什么成立）
  keyPoints?: string[];            // 可选：自测核对要点列表
  referenceExplanation?: string;   // 可选：标准参考解释
}

export interface LessonTeachingContext {
  prerequisites: string[];         // 本节先修知识
  prerequisiteCheck?: string;      // 先修知识快速诊断与薄弱点补充说明
  learningObjectives: string[];    // 本节具体学习目标
  teachingScope: string;           // 本节教学范围
  connectionNote: string;          // 与前后课程的联系
}

export interface LessonQualityCheck {
  coveredPoints?: string[];        // 可选：已覆盖的资料/大纲核心知识点
  formulaAndUnitNote?: string;     // 可选：公式符号含义与单位核对说明
  derivationContinuityNote?: string;// 可选：推导思路来源与连续性说明
  diagramAlignmentNote?: string;   // 可选：图文同步与图中变量/方向标注说明
  intermediateStepsAuditNote?: string; // 可选兼容字段
}

export interface EnglishArticleSection {
  english: string;
  chinese: string;
}

export interface EnglishLessonPayload {
  articleTitle: string;
  sourceReference?: string;
  articleMode: EnglishArticleMode;
  targetWords: VocabItem[];
  paragraphs: EnglishArticleSection[];
  grammarAndUsageNotes: string;
}

export type CourseGenerationMode = 'api' | 'agent' | 'chat';

export interface PdfTocEntry {
  title: string;
  printedPage?: number;
  physicalPage?: number;
}

export interface PdfPageEntry {
  physicalPage: number;            // 1-based physical page in PDF
  printedPageHint?: number;        // Detected printed textbook page number if any
  textPreview: string;             // Extracted text on this page
  headings?: string[];             // Detected headings on this page
}

export interface PdfDocumentMeta {
  fileName: string;
  totalPages: number;
  detectedPageOffset: number;      // physicalPage = printedPage + detectedPageOffset
  tocEntries: PdfTocEntry[];
  pages: PdfPageEntry[];
}

export interface PdfSplitPlanItem {
  sectionId: string;               // 稳定唯一区域/小节 ID，例如 "region-01" 或 "sec-01"
  dayIndex: number;                // 1-based 排序序号
  date: string;                    // YYYY-MM-DD
  sectionTitle: string;            // 划分区域或小节标题
  sourceFileName: string;          // 原始 PDF 文件名 (位于 sources/)
  physicalStartPage: number;       // 1-based 准确的 PDF 物理起始页码
  physicalEndPage: number;         // 1-based 准确的 PDF 物理结束页码
  printedStartPage?: number;       // 教材印刷起始页码
  printedEndPage?: number;         // 教材印刷结束页码
  pageOffset?: number;             // 物理页码与教材印刷页码偏移量 (physical = printed + pageOffset)
  crossRefPages?: number[];        // 跨章节引用或前置知识物理页码列表
  outlineMappingNote?: string;     // 区域划分理由及涵盖核心知识点说明
  segmentFileName?: string;        // 切分后生成的 PDF 文件名，如 "region-01.pdf" (位于 segments/)
  segmentRelPath?: string;         // 例如 "courses/xxx/segments/region-01.pdf"
  segmentPageCount?: number;       // 切分后区域 PDF 页数
  extractedSegmentText?: string;   // 该区域对应的 PDF 提取文字
  status?: 'planned' | 'sliced' | 'error';
  slicedAt?: string;
  errorMessage?: string;
}

export interface DailyLessonContent {
  sectionId?: string;              // 绑定的稳定小节唯一 ID (如 "sec-01")
  dayIndex: number;                // 1-based
  date: string;                    // YYYY-MM-DD
  title: string;
  summary: string;
  estimatedMinutes?: number;       // 写完本节具体课件后评估的预计学习时长（分钟，唯一负荷指标）
  generationStage?: 'stage1_content' | 'complete'; // 两阶段生成状态（省略则视为 complete）
  keyPoints: string[];
  teachingContext?: LessonTeachingContext;
  markdownBody: string;            // 完整课件正文（Markdown + LaTeX $...$, $$...$$）
  symbolGlossary?: LessonSymbolEntry[]; // 本节公式符号表（供推导中点击符号弹出上文解释）
  diagrams?: LessonDiagram[];
  heuristicQuestions?: HeuristicQuestionItem[];
  englishPayload?: EnglishLessonPayload;
  exercises: ExerciseQuestion[];
  reverseChecks?: ReverseCheckItem[];
  qualityCheck?: LessonQualityCheck;
  sourceMode?: CourseGenerationMode;
  generatedAt: string;
}

export interface KnowledgeCatalogNode {
  id: string;
  title: string;
  prerequisites: string[];
  difficulty?: 'low' | 'medium' | 'high' | string; // 历史兼容字段；新版流程以 estimatedMinutes 为唯一负荷指标
  estimatedMinutes?: number;       // 预计学习时长（分钟）
  sectionId?: string;              // 关联小节 ID
  coreConcepts: string[];
  assignedDayIndex?: number;
}

export interface DailyScheduleDay {
  dayNumber: number;               // 1..durationDays
  date: string;                    // YYYY-MM-DD
  sectionIds: string[];            // 当日包含的小节 ID 列表，如 ['sec-01', 'sec-02']
  estimatedMinutes: number;        // 当日小节总预计时长
  targetMinutes: number;           // 每日负荷基准 (总时长 / durationDays)
}

export interface DailyPlanSlot {
  id: string;                      // 稳定唯一小节 ID (例如 "sec-01")，重命名或调整日期后不丢失关联
  dayIndex: number;                // 1-based 小节序号 (1..sections.length)
  scheduledDay?: number;           // 1-based 分配到的学习天数序号 (1..durationDays)
  date: string;                    // 分配到的学习日历日期 YYYY-MM-DD
  estimatedMinutes?: number;       // AI 评估的小节预计学习时长（分钟，唯一负荷指标）
  title: string;
  objective: string;
  keyTopics: string[];
  prerequisites?: string[];        // 本节先修知识
  teachingScope?: string;          // 本节教学范围
  connectionNote?: string;         // 与前后课程的联系
  regionId?: string;               // 关联的第 1 步切分 PDF 区域 ID（如 "region-01"）
  regionIds?: string[];            // 关联的多个切分 PDF 区域 ID（当合并多个切分区域时使用）
  assignedWords?: VocabItem[];     // For English courses (随机不重复抽取并稳定保存的每日词汇)
  pdfSegment?: PdfSplitPlanItem;   // 绑定的本节 PDF 切分信息与小节 PDF 路径
  pdfSegments?: PdfSplitPlanItem[];// 绑定的本节全部 PDF 切分区域列表（多区域覆盖时）
  stage1Draft?: DailyLessonContent;// 阶段一（教学内容+图示规格）中间产物，阶段二失败或重试时保留
  lesson?: DailyLessonContent;
}

export interface UploadedMaterial {
  id: string;
  fileName: string;
  fileSize: number;
  extractedText: string;
  isPdf?: boolean;
  totalPages?: number;
  detectedPageOffset?: number;
  tocEntries?: PdfTocEntry[];
  pages?: PdfPageEntry[];
  sourceRelPath?: string;          // 保存在 courses/<课程名称>/sources/ 下的相对路径
  tempUploadId?: string;           // 分块二进制上传到服务端临时区的标识
  base64Data?: string;             // 小文件或兼容测试用临时二进制
}

export interface StudyStats {
  totalSeconds: number;
  secondsByDate: Record<string, number>;
  secondsByCourse: Record<string, number>;
}

export interface VocabCoverageStats {
  effectiveTotal: number;          // 差集运算后实际待学词库总量
  dailyWordCount: number;          // 用户设置的每日目标单词数
  durationDays: number;            // 计划学习天数
  plannedTotal: number;            // 计划总词数 (durationDays * dailyWordCount)
  actualAllocatedTotal: number;    // 实际分配不重复总词数
  unallocatedRemainingCount: number; // 词库剩余未分配词数
  isExceedingCapacity: boolean;    // 计划词数是否超过实际词库容量
  fullDaysCount: number;           // 可满额分配的天数
  coveragePercent: number;         // 词库覆盖百分比
  message: string;                 // 覆盖情况与容量提示文案
}

export interface ExerciseSubmissionRecord {
  userAnswers: Record<string, string>;
  submittedAt: string;
  score: number;
  total: number;
  sectionId?: string;
  date?: string;
}

export interface Course {
  id: string;
  name: string;
  folderName?: string;             // 合法化处理后的课程文件夹名
  courseDirPath?: string;          // courses/<folderName>
  category: CourseCategory;
  generationMode?: CourseGenerationMode; // 'api' | 'agent' | 'chat'
  subjectProfile?: SubjectProfile;
  learnerLevel?: LearnerLevel;
  learnerBaseline?: LearnerBaselinePreset;
  customLearnerBaseline?: string;
  learningDepth?: LearningDepthPreset;
  customLearningDepth?: string;
  goal: string;
  startDate: string;               // YYYY-MM-DD
  durationDays: number;
  extraRequirements: string;
  outlineConfirmed?: boolean;      // 用户是否已预览并确认完整课程目录
  outlineConfirmedAt?: string;
  pdfPageOffset?: number;          // 教材印刷页码与 PDF 物理页码的全局偏移量
  pdfSplitPlan?: PdfSplitPlanItem[]; // 统一格式的 PDF 切分方案
  materials: UploadedMaterial[];
  knowledgeCatalog?: KnowledgeCatalogNode[];
  agentWorkspacePath?: string;     // courses/<folderName>
  customAssets?: Record<string, string>; // 统一图片/附件资源映射表 (fileName -> dataUrl)
  englishConfig?: {
    targetBankName: string;
    excludedBankName: string;
    totalTargetCount: number;
    excludedCount: number;
    effectiveWords: VocabItem[];
    dailyWordCount: number;        // 每日目标单词数（如 20、30、50）
    articleMode: EnglishArticleMode;
    preferredSources: string;
    lastAllocatedAt?: string;
  };
  dailyPlan: DailyPlanSlot[];
  dailySchedule?: DailyScheduleDay[];
  masteredWords: string[];
  exerciseSubmissions: Record<
    string, // sectionId (e.g. "sec-01") or legacy date YYYY-MM-DD
    ExerciseSubmissionRecord
  >;
  reverseCheckNotes?: Record<string, Record<string, string>>; // sectionId or date -> reverseCheckId -> user's explanation
  createdAt: string;
}

export interface AppSettings {
  providerMode: 'builtin_gemini' | 'openai_compatible';
  apiBaseUrl: string;
  modelName: string;
  hasCustomApiKey: boolean;
  hasBuiltinGeminiKey: boolean;
  defaultLearnerLevel: LearnerLevel;
  defaultLearnerBaseline?: LearnerBaselinePreset;
  defaultCustomLearnerBaseline?: string;
  defaultLearningDepth?: LearningDepthPreset;
  defaultCustomLearningDepth?: string;
  showAdvancedWorkflowDetails?: boolean;
  showContentCategoryBadges?: boolean;
  promptModules: PromptModuleToggles;
  syllabusSystemPrompt: string;
  courseSystemPrompt: string;
  englishSystemPrompt: string;
  customTeachingSupplement: string;
}

export interface CourseDiskFile {
  name: string;
  relPath: string;
  category: 'sources' | 'segments' | 'lessons' | 'assets' | 'root';
  size: number;
  modifiedAt: string;
  ext: string;
  isPdf: boolean;
  isImage: boolean;
  isJson: boolean;
  isText: boolean;
  deletable: boolean;
}

export interface CourseFileListing {
  ok: boolean;
  folderName: string;
  absPath: string;
  relDir: string;
  totalFiles: number;
  totalBytes: number;
  files: CourseDiskFile[];
  backendEngine?: string;
}

export interface LastBrowsingState {
  view: 'timeline' | 'daily' | 'lesson';
  selectedCourseFilter: string;
  focusedDate: string | null;
  activeLessonRef: {
    courseId: string;
    dayIndex: number;
  } | null;
  scrollY: number;
  scrollMap?: Record<string, number>;
  updatedAt: string;
}


