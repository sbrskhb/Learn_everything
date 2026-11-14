export type GenerationStage =
  | 'connecting'
  | 'preparing'
  | 'thinking'
  | 'streaming'
  | 'diagrams'
  | 'parsing'
  | 'saving'
  | 'done'
  | 'error';

export interface GenerationProgressEvent {
  type: 'progress' | 'done' | 'error';
  stage: GenerationStage;
  step: 1 | 2 | 3 | 4;
  percent: number;
  message: string;
  model?: string;
  pdfSummary?: string;
  charsReceived?: number;
  thinkingChars?: number;
  chunksReceived?: number;
  detectedFields?: string[];
  liveSnippet?: string;
  course?: any;
  lesson?: any;
  stage1Draft?: any;
  pendingDiagramsCount?: number;
  error?: string;
}

export interface StreamedBufferAnalysis {
  step: 2 | 3 | 4;
  percent: number;
  detectedFields: string[];
  currentSectionLabel: string;
  liveSnippet: string;
}

const EXPECTED_STEM_FIELDS = [
  'title',
  'summary',
  'keyPoints',
  'markdownBody',
  'diagrams',
  'heuristicQuestions',
  'exercises',
  'reverseChecks',
  'qualityCheck',
] as const;

const EXPECTED_ENGLISH_FIELDS = [
  'title',
  'summary',
  'keyPoints',
  'englishPayload',
  'markdownBody',
  'diagrams',
  'heuristicQuestions',
  'exercises',
  'reverseChecks',
  'qualityCheck',
] as const;

/**
 * Inspect the actual accumulated JSON text streamed from the LLM and derive
 * truthful, non-timer-based progress milestones (step, percentage, detected fields,
 * and a clean human-readable snippet of what the model is currently writing).
 */
export function analyzeStreamedLessonBuffer(
  rawBuffer: string,
  isEnglish = false
): StreamedBufferAnalysis {
  const expected = isEnglish ? EXPECTED_ENGLISH_FIELDS : EXPECTED_STEM_FIELDS;
  const detectedFields: string[] = [];

  for (const field of expected) {
    const pattern = new RegExp(`"${field}"\\s*:`);
    if (pattern.test(rawBuffer)) {
      detectedFields.push(field);
    }
  }

  const chars = rawBuffer.length;

  // Determine real phase from actual JSON keys observed in the stream
  const hasQualityOrReverse =
    detectedFields.includes('qualityCheck') || detectedFields.includes('reverseChecks');
  const hasExercises = detectedFields.includes('exercises');
  const hasVisualsOrHeuristics =
    detectedFields.includes('diagrams') || detectedFields.includes('heuristicQuestions');
  const hasBody =
    detectedFields.includes('markdownBody') || detectedFields.includes('englishPayload');

  let step: 2 | 3 | 4 = 2;
  let currentSectionLabel = '构建课程元数据与摘要 (title / summary)';
  let basePercent = 20;

  if (hasQualityOrReverse) {
    step = 4;
    currentSectionLabel = '自检与复述检验生成中 (reverseChecks / qualityCheck)';
    basePercent = 84;
  } else if (hasExercises) {
    step = 3;
    currentSectionLabel = '分层练习与迁移题生成中 (exercises)';
    basePercent = 72;
  } else if (hasVisualsOrHeuristics) {
    step = 3;
    currentSectionLabel = detectedFields.includes('diagrams')
      ? '同步绘制 SVG 原理图与标注 (diagrams)'
      : '生成“先思考，后讲解”启发式问题 (heuristicQuestions)';
    basePercent = 56;
  } else if (hasBody) {
    step = 2;
    currentSectionLabel = isEnglish
      ? '生成英文精读文本与语法精讲 (englishPayload / markdownBody)'
      : '推演核心原理、公式与正文讲义 (markdownBody)';
    // Smooth real-character curve between 28% and 54% while body streams
    basePercent = Math.min(54, 28 + Math.round((chars / 5500) * 26));
  } else if (chars > 0) {
    step = 2;
    basePercent = Math.min(27, 20 + Math.round((chars / 800) * 7));
  }

  // Add modest real byte-based progress within stages 3..4 (capped at 91% until stream finishes)
  const charBonus =
    step >= 3 ? Math.min(7, Math.floor(Math.max(0, chars - 4000) / 1200)) : 0;
  const percent = Math.min(91, Math.max(20, basePercent + charBonus));

  // Extract latest readable heading or sentence fragment from raw JSON stream
  let liveSnippet = '';
  const headingMatches = [...rawBuffer.matchAll(/#{2,3}\s+([^\n\\"]{3,60})/g)];
  if (headingMatches.length > 0) {
    const lastHeading = headingMatches[headingMatches.length - 1][1].trim();
    liveSnippet = `最新章节：${lastHeading}`;
  } else {
    const cleanedTail = rawBuffer
      .slice(-180)
      .replace(/\\n/g, ' ')
      .replace(/\\"/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanedTail) {
      liveSnippet = cleanedTail.length > 90 ? `...${cleanedTail.slice(-90)}` : cleanedTail;
    }
  }

  return {
    step,
    percent,
    detectedFields,
    currentSectionLabel,
    liveSnippet,
  };
}
