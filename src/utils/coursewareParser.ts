import type {
  CourseGenerationMode,
  DailyLessonContent,
  DailyPlanSlot,
  ExerciseQuestion,
  KnowledgeCatalogNode,
  LessonDiagram,
} from '../types';
import { addDaysToDateString, ensureStableSectionId } from './learningLogic';

/**
 * Strip meaningless LLM grounding citation tags such as `[cite: 125, 126]`,
 * `[cite: 12]`, `[cite_start]`, `[cite_end]`, or `【cite: 1-3】` while preserving
 * surrounding sentence spacing, punctuation, LaTeX, and Markdown indentation.
 */
export function stripAiCitationArtifacts(text: string): string {
  if (!text) return text;
  const citeTagPattern =
    '(?:\\[\\s*cite(?:_start|_end)?(?:\\s*[:：]\\s*[^\\]]*)?\\s*\\]|【\\s*cite(?:_start|_end)?(?:\\s*[:：]\\s*[^】]*)?\\s*】)';

  let cleaned = text;
  // 1. Remove citation tag at start of a line along with single following horizontal space
  cleaned = cleaned.replace(new RegExp(`(^|\\n)([ \\t]*)${citeTagPattern}[ \\t]*`, 'gi'), '$1$2');
  // 2. Remove leading horizontal space + citation tag when followed by punctuation, space, closing bracket, or line end
  cleaned = cleaned.replace(
    new RegExp(`[ \\t]*${citeTagPattern}(?=[ \\t]*[，。；：！？、,.!?;:)\\]】\\s]|$)`, 'gi'),
    ''
  );
  // 3. Remove any remaining inline citation tag (e.g. "word [cite: 12]next" -> "word next")
  cleaned = cleaned.replace(new RegExp(citeTagPattern, 'gi'), '');
  // 4. Remove stray spaces introduced right before CJK punctuation after tag removal
  cleaned = cleaned.replace(/[ \t]+([，。；：！？、])/g, '$1');
  return cleaned;
}

/**
 * Deep-clean citation artifacts across all readable fields of a DailyLessonContent object.
 */
export function sanitizeLessonCitations(lesson: DailyLessonContent): DailyLessonContent {
  if (!lesson) return lesson;
  return {
    ...lesson,
    title: stripAiCitationArtifacts(lesson.title),
    summary: stripAiCitationArtifacts(lesson.summary),
    keyPoints: Array.isArray(lesson.keyPoints)
      ? lesson.keyPoints.map((k) => stripAiCitationArtifacts(String(k)))
      : [],
    teachingContext: lesson.teachingContext
      ? {
          ...lesson.teachingContext,
          prerequisites: Array.isArray(lesson.teachingContext.prerequisites)
            ? lesson.teachingContext.prerequisites.map((p) => stripAiCitationArtifacts(String(p)))
            : [],
          learningObjectives: Array.isArray(lesson.teachingContext.learningObjectives)
            ? lesson.teachingContext.learningObjectives.map((o) => stripAiCitationArtifacts(String(o)))
            : [],
          teachingScope: stripAiCitationArtifacts(lesson.teachingContext.teachingScope || ''),
          connectionNote: stripAiCitationArtifacts(lesson.teachingContext.connectionNote || ''),
        }
      : undefined,
    markdownBody: stripAiCitationArtifacts(lesson.markdownBody || ''),
    diagrams: Array.isArray(lesson.diagrams)
      ? lesson.diagrams.map((d) => ({
          ...d,
          title: stripAiCitationArtifacts(d.title || ''),
          stageLabel: d.stageLabel ? stripAiCitationArtifacts(d.stageLabel) : d.stageLabel,
          caption: stripAiCitationArtifacts(d.caption || ''),
        }))
      : [],
    heuristicQuestions: Array.isArray(lesson.heuristicQuestions)
      ? lesson.heuristicQuestions.map((hq) => ({
          ...hq,
          context: stripAiCitationArtifacts(hq.context || ''),
          question: stripAiCitationArtifacts(hq.question || ''),
          hint: hq.hint ? stripAiCitationArtifacts(hq.hint) : hq.hint,
          approach: hq.approach ? stripAiCitationArtifacts(hq.approach) : hq.approach,
          answerReveal: stripAiCitationArtifacts(hq.answerReveal || ''),
        }))
      : lesson.heuristicQuestions,
    englishPayload: lesson.englishPayload
      ? {
          ...lesson.englishPayload,
          articleTitle: stripAiCitationArtifacts(lesson.englishPayload.articleTitle || ''),
          sourceReference: lesson.englishPayload.sourceReference
            ? stripAiCitationArtifacts(lesson.englishPayload.sourceReference)
            : lesson.englishPayload.sourceReference,
          targetWords: Array.isArray(lesson.englishPayload.targetWords)
            ? lesson.englishPayload.targetWords.map((w) => ({
                ...w,
                meaning: stripAiCitationArtifacts(w.meaning || ''),
                example: w.example ? stripAiCitationArtifacts(w.example) : w.example,
                exampleTranslation: w.exampleTranslation
                  ? stripAiCitationArtifacts(w.exampleTranslation)
                  : w.exampleTranslation,
              }))
            : [],
          paragraphs: Array.isArray(lesson.englishPayload.paragraphs)
            ? lesson.englishPayload.paragraphs.map((p) => ({
                english: stripAiCitationArtifacts(p.english || ''),
                chinese: stripAiCitationArtifacts(p.chinese || ''),
              }))
            : [],
          grammarAndUsageNotes: stripAiCitationArtifacts(
            lesson.englishPayload.grammarAndUsageNotes || ''
          ),
        }
      : undefined,
    exercises: Array.isArray(lesson.exercises)
      ? lesson.exercises.map((ex) => ({
          ...ex,
          question: stripAiCitationArtifacts(ex.question || ''),
          options: Array.isArray(ex.options)
            ? ex.options.map((opt) => stripAiCitationArtifacts(String(opt)))
            : ex.options,
          answer: stripAiCitationArtifacts(ex.answer || ''),
          hint: ex.hint ? stripAiCitationArtifacts(ex.hint) : ex.hint,
          explanation: stripAiCitationArtifacts(ex.explanation || ''),
          wrongOptionsAnalysis: ex.wrongOptionsAnalysis
            ? stripAiCitationArtifacts(ex.wrongOptionsAnalysis)
            : ex.wrongOptionsAnalysis,
        }))
      : [],
    reverseChecks: Array.isArray(lesson.reverseChecks)
      ? lesson.reverseChecks.map((rc) => ({
          ...rc,
          topic: stripAiCitationArtifacts(rc.topic || ''),
          prompt: stripAiCitationArtifacts(rc.prompt || ''),
          keyPoints: Array.isArray(rc.keyPoints)
            ? rc.keyPoints.map((kp) => stripAiCitationArtifacts(String(kp)))
            : [],
          referenceExplanation: stripAiCitationArtifacts(rc.referenceExplanation || ''),
        }))
      : lesson.reverseChecks,
    qualityCheck: lesson.qualityCheck
      ? {
          ...lesson.qualityCheck,
          coveredPoints: Array.isArray(lesson.qualityCheck.coveredPoints)
            ? lesson.qualityCheck.coveredPoints.map((cp) => stripAiCitationArtifacts(String(cp)))
            : [],
          formulaAndUnitNote: stripAiCitationArtifacts(
            lesson.qualityCheck.formulaAndUnitNote || ''
          ),
          derivationContinuityNote: stripAiCitationArtifacts(
            lesson.qualityCheck.derivationContinuityNote || ''
          ),
          diagramAlignmentNote: stripAiCitationArtifacts(
            lesson.qualityCheck.diagramAlignmentNote || ''
          ),
          intermediateStepsAuditNote: lesson.qualityCheck.intermediateStepsAuditNote
            ? stripAiCitationArtifacts(lesson.qualityCheck.intermediateStepsAuditNote)
            : lesson.qualityCheck.intermediateStepsAuditNote,
        }
      : lesson.qualityCheck,
  };
}

/**
 * Extract local image references (e.g. ![alt](fig1.png) or ![alt](assets/circuit.png))
 * that are not data: URLs or http(s) URLs, so the user can upload missing images in Chat/Agent mode.
 */
export function detectUnresolvedImageRefs(
  markdownBody: string,
  existingAssets: Record<string, string> = {}
): string[] {
  if (!markdownBody) return [];
  const unresolved = new Set<string>();

  const mdImgRegex = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdImgRegex.exec(markdownBody)) !== null) {
    const rawUrl = match[1].trim();
    if (
      !rawUrl ||
      rawUrl.startsWith('data:') ||
      rawUrl.startsWith('http://') ||
      rawUrl.startsWith('https://') ||
      rawUrl.startsWith('/api/')
    ) {
      continue;
    }
    const cleanName = rawUrl.replace(/^(?:\.\/|assets\/|images\/)+/i, '');
    if (!existingAssets[rawUrl] && !existingAssets[cleanName]) {
      unresolved.add(rawUrl);
    }
  }

  return Array.from(unresolved);
}

/**
 * Replace local image references in markdownBody with uploaded asset data URLs.
 */
export function resolveLessonAssetReferences(
  lesson: DailyLessonContent,
  assets: Record<string, string> = {}
): DailyLessonContent {
  if (!assets || Object.keys(assets).length === 0 || !lesson.markdownBody) {
    return lesson;
  }

  let updatedMarkdown = lesson.markdownBody;
  for (const [key, dataUrl] of Object.entries(assets)) {
    if (!dataUrl) continue;
    const cleanName = key.replace(/^(?:\.\/|assets\/|images\/)+/i, '');
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedClean = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `(!\\[[^\\]]*\\]\\()(?:\\.\\/|assets\\/|images\\/)?(?:${escapedKey}|${escapedClean})(\\))`,
      'g'
    );
    updatedMarkdown = updatedMarkdown.replace(regex, `$1${dataUrl}$2`);
  }

  return {
    ...lesson,
    markdownBody: updatedMarkdown,
  };
}

function tryExtractJsonObject(rawText: string): any | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
    let bestCandidate: any = null;
    let m: RegExpExecArray | null;
    while ((m = codeBlockRegex.exec(trimmed)) !== null) {
      try {
        const parsed = JSON.parse(m[1].trim());
        if (parsed && typeof parsed === 'object') {
          bestCandidate = parsed;
          if (parsed.markdownBody || parsed.englishPayload || parsed.days || parsed.dailyPlan) {
            return parsed;
          }
        }
      } catch {
        // continue
      }
    }
    if (bestCandidate) return bestCandidate;

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        // continue
      }
    }
  }
  return null;
}

/**
 * Parse single-lesson content imported via Chat mode (paste or file) or Agent mode JSON.
 * Supports both structured JSON and raw Markdown with LaTeX, inline SVG, and exercises.
 */
export function parseImportedLessonContent(
  rawInput: string,
  slot: Pick<
    DailyPlanSlot,
    | 'id'
    | 'dayIndex'
    | 'date'
    | 'title'
    | 'objective'
    | 'keyTopics'
    | 'prerequisites'
    | 'teachingScope'
    | 'connectionNote'
  >,
  sourceMode: CourseGenerationMode = 'chat',
  existingAssets: Record<string, string> = {}
): {
  lesson: DailyLessonContent;
  unresolvedImageRefs: string[];
} {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) {
    throw new Error('导入内容为空，请粘贴 AI 生成的课件内容或选择课件文件。');
  }

  const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);
  const parsedJson = tryExtractJsonObject(trimmed);

  if (parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson)) {
    const markdownBody =
      typeof parsedJson.markdownBody === 'string' && parsedJson.markdownBody.trim()
        ? parsedJson.markdownBody.trim()
        : typeof parsedJson.content === 'string'
          ? parsedJson.content.trim()
          : '';

    const diagrams: LessonDiagram[] = Array.isArray(parsedJson.diagrams)
      ? parsedJson.diagrams
          .filter((d: any) => d && (typeof d.svgCode === 'string' || typeof d.svg === 'string'))
          .map((d: any, idx: number) => ({
            id: d.id || `diag-${idx + 1}`,
            title: d.title || `图 ${slot.dayIndex}.${idx + 1}`,
            stageLabel: d.stageLabel,
            caption: d.caption || '',
            svgCode: d.svgCode || d.svg,
          }))
      : [];

    const exercises: ExerciseQuestion[] = Array.isArray(parsedJson.exercises)
      ? parsedJson.exercises
          .filter(
            (ex: any) =>
              ex && ex.question && (ex.answer !== undefined || ex.correctAnswer !== undefined)
          )
          .map((ex: any, idx: number) => {
            const id = ex.id || `ex-${idx + 1}`;
            const isInlineInBody = markdownBody.includes(`{{exercise:${id}}}`);
            const stage: 'inline' | 'comprehensive' =
              ex.stage === 'inline' || ex.stage === 'comprehensive'
                ? ex.stage
                : isInlineInBody
                  ? 'inline'
                  : ex.difficulty === 'comprehensive'
                    ? 'comprehensive'
                    : idx < Math.ceil((parsedJson.exercises?.length || 1) / 2)
                      ? 'inline'
                      : 'comprehensive';
            const rawType = String(ex.type || '').toLowerCase();
            const isFill = rawType === 'fill' || rawType === 'fill_blank';
            const wrongAnalysis = Array.isArray(ex.wrongOptionsAnalysis)
              ? ex.wrongOptionsAnalysis.join('；')
              : ex.wrongOptionsAnalysis
                ? String(ex.wrongOptionsAnalysis)
                : undefined;

            return {
              id,
              stage,
              type: isFill ? 'fill' : 'choice',
              difficulty: ex.difficulty,
              categoryLabel: ex.categoryLabel || ex.category,
              question: String(ex.question),
              options: Array.isArray(ex.options) ? ex.options.map(String) : undefined,
              answer: String(ex.answer ?? ex.correctAnswer ?? ''),
              hint: ex.hint ? String(ex.hint) : undefined,
              explanation: String(ex.explanation || ''),
              wrongOptionsAnalysis: wrongAnalysis,
            };
          })
      : [];

    const heuristicQuestions = Array.isArray(parsedJson.heuristicQuestions)
      ? parsedJson.heuristicQuestions
          .filter((hq: any) => hq && hq.question)
          .map((hq: any, idx: number) => ({
            id: hq.id || `hq-${idx + 1}`,
            context: hq.context || `关键思考点 ${idx + 1}`,
            question: String(hq.question),
            hint: hq.hint ? String(hq.hint) : undefined,
            approach: hq.approach ? String(hq.approach) : undefined,
            answerReveal: String(hq.answerReveal || hq.explanation || ''),
          }))
      : [];

    const reverseChecks = Array.isArray(parsedJson.reverseChecks)
      ? parsedJson.reverseChecks
          .filter((rc: any) => rc && rc.prompt)
          .map((rc: any, idx: number) => ({
            id: rc.id || `rc-${idx + 1}`,
            topic: rc.topic || `反向解释检验 ${idx + 1}`,
            prompt: String(rc.prompt),
            keyPoints: Array.isArray(rc.keyPoints)
              ? rc.keyPoints.map(String)
              : Array.isArray(rc.evaluationCriteria)
                ? rc.evaluationCriteria.map(String)
                : [],
            referenceExplanation: String(
              rc.referenceExplanation || rc.referenceAnswer || ''
            ),
          }))
      : [];

    const rawQc = parsedJson.qualityCheck;
    const qualityCheck = rawQc
      ? {
          coveredPoints: Array.isArray(rawQc.coveredPoints)
            ? rawQc.coveredPoints.map(String)
            : slot.keyTopics,
          formulaAndUnitNote:
            rawQc.formulaAndUnitNote || rawQc.CoverageAuditNote || '已核对公式符号含义与单位',
          derivationContinuityNote:
            rawQc.derivationContinuityNote || '已核对推导思路来源与步骤连续性',
          diagramAlignmentNote:
            rawQc.diagramAlignmentNote || '已核对图文同步位置与图示标注',
          intermediateStepsAuditNote:
            rawQc.intermediateStepsAuditNote || undefined,
        }
      : undefined;

    const baseLesson: DailyLessonContent = {
      sectionId,
      dayIndex: slot.dayIndex,
      date: slot.date,
      title:
        typeof parsedJson.title === 'string' && parsedJson.title.trim()
          ? parsedJson.title.trim()
          : slot.title,
      summary:
        typeof parsedJson.summary === 'string' && parsedJson.summary.trim()
          ? parsedJson.summary.trim()
          : slot.objective,
      keyPoints:
        Array.isArray(parsedJson.keyPoints) && parsedJson.keyPoints.length > 0
          ? parsedJson.keyPoints.map(String)
          : slot.keyTopics,
      teachingContext: parsedJson.teachingContext || {
        prerequisites: Array.isArray(parsedJson.prerequisites)
          ? parsedJson.prerequisites.map(String)
          : slot.prerequisites || [],
        learningObjectives: Array.isArray(parsedJson.objectives)
          ? parsedJson.objectives.map(String)
          : [slot.objective],
        teachingScope: slot.teachingScope || slot.keyTopics.join('、'),
        connectionNote: slot.connectionNote || '',
      },
      markdownBody,
      diagrams,
      heuristicQuestions,
      englishPayload: parsedJson.englishPayload,
      exercises,
      reverseChecks,
      qualityCheck,
      sourceMode,
      generatedAt: new Date().toISOString(),
    };

    const sanitizedLesson = sanitizeLessonCitations(baseLesson);
    const resolvedLesson = resolveLessonAssetReferences(sanitizedLesson, existingAssets);
    const unresolvedImageRefs = detectUnresolvedImageRefs(
      resolvedLesson.markdownBody,
      existingAssets
    );

    return { lesson: resolvedLesson, unresolvedImageRefs };
  }

  // Fallback: User pasted pure Markdown + LaTeX + inline SVG from a Chat window
  const headingMatch = trimmed.match(/^#\s+(.+)$/m);
  const extractedTitle = headingMatch ? headingMatch[1].trim() : slot.title;

  const extractedDiagrams: LessonDiagram[] = [];
  const svgRegex = /<svg[\s\S]*?<\/svg>/gi;
  let svgMatch: RegExpExecArray | null;
  let svgIdx = 1;
  while ((svgMatch = svgRegex.exec(trimmed)) !== null) {
    extractedDiagrams.push({
      title: `图 ${slot.dayIndex}.${svgIdx}`,
      caption: '课件内嵌原理图示',
      svgCode: svgMatch[0],
    });
    svgIdx++;
  }

  const baseLesson: DailyLessonContent = {
    sectionId,
    dayIndex: slot.dayIndex,
    date: slot.date,
    title: extractedTitle,
    summary: slot.objective,
    keyPoints: slot.keyTopics,
    teachingContext: {
      prerequisites: slot.prerequisites || [],
      learningObjectives: [slot.objective],
      teachingScope: slot.teachingScope || slot.keyTopics.join('、'),
      connectionNote: slot.connectionNote || '',
    },
    markdownBody: trimmed,
    diagrams: extractedDiagrams,
    exercises: [],
    sourceMode,
    generatedAt: new Date().toISOString(),
  };

  const sanitizedLesson = sanitizeLessonCitations(baseLesson);
  const resolvedLesson = resolveLessonAssetReferences(sanitizedLesson, existingAssets);
  const unresolvedImageRefs = detectUnresolvedImageRefs(
    resolvedLesson.markdownBody,
    existingAssets
  );

  return { lesson: resolvedLesson, unresolvedImageRefs };
}

/**
 * Parse syllabus / outline JSON imported via Chat or Agent mode.
 * Preserves stable section IDs (`id`), existing lessons, PDF segments, and assigned words.
 */
export function parseImportedSyllabusContent(
  rawInput: string,
  startDate: string,
  durationDays: number,
  existingSlots: DailyPlanSlot[] = []
): {
  knowledgeCatalog: KnowledgeCatalogNode[];
  dailyPlan: DailyPlanSlot[];
} {
  const parsed = tryExtractJsonObject(rawInput);
  const rawDays = Array.isArray(parsed?.days)
    ? parsed.days
    : Array.isArray(parsed?.dailyPlan)
      ? parsed.dailyPlan
      : Array.isArray(parsed?.sections)
        ? parsed.sections
        : null;

  if (!parsed || !rawDays || rawDays.length === 0) {
    throw new Error('未能解析出有效的课程目录 JSON（需包含 days 或 sections 数组）。');
  }

  const totalCount = Math.max(durationDays, rawDays.length);
  const slots: DailyPlanSlot[] = [];

  for (let i = 0; i < durationDays; i++) {
    const item = rawDays[i] || rawDays[rawDays.length - 1];
    const dayIndex = i + 1;
    const requestedId = item?.id || item?.sectionId;
    const existingById = requestedId
      ? existingSlots.find((s) => s.id === requestedId)
      : undefined;
    const existing = existingById || existingSlots.find((s) => s.dayIndex === dayIndex);
    const stableId = ensureStableSectionId(dayIndex, requestedId || existing?.id);
    const date = item?.date || addDaysToDateString(startDate, i);

    slots.push({
      id: stableId,
      dayIndex,
      date,
      title: stripAiCitationArtifacts(item?.title || existing?.title || `第 ${dayIndex} 讲`),
      objective: stripAiCitationArtifacts(item?.objective || existing?.objective || ''),
      prerequisites: Array.isArray(item?.prerequisites)
        ? item.prerequisites.map((p: any) => stripAiCitationArtifacts(String(p)))
        : existing?.prerequisites,
      teachingScope: item?.teachingScope
        ? stripAiCitationArtifacts(String(item.teachingScope))
        : existing?.teachingScope,
      connectionNote: item?.connectionNote
        ? stripAiCitationArtifacts(String(item.connectionNote))
        : existing?.connectionNote,
      regionId: item?.regionId || existing?.regionId,
      keyTopics:
        Array.isArray(item?.keyTopics) && item.keyTopics.length > 0
          ? item.keyTopics.map((k: any) => stripAiCitationArtifacts(String(k)))
          : existing?.keyTopics || [],
      assignedWords: existing?.assignedWords,
      pdfSegment: existing?.pdfSegment,
      // Preserve any already-generated lesson so modifying outline NEVER deletes existing lessons!
      lesson: existing?.lesson,
    });
  }

  void totalCount;
  return {
    knowledgeCatalog: Array.isArray(parsed.knowledgeCatalog)
      ? parsed.knowledgeCatalog.map((node: any) => ({
          ...node,
          title: stripAiCitationArtifacts(String(node?.title || '')),
          prerequisites: Array.isArray(node?.prerequisites)
            ? node.prerequisites.map((p: any) => stripAiCitationArtifacts(String(p)))
            : [],
          coreConcepts: Array.isArray(node?.coreConcepts)
            ? node.coreConcepts.map((c: any) => stripAiCitationArtifacts(String(c)))
            : [],
        }))
      : [],
    dailyPlan: slots,
  };
}
