import type {
  CourseGenerationMode,
  DailyLessonContent,
  DailyPlanSlot,
  ExerciseQuestion,
  ExerciseVariantCheck,
  KnowledgeCatalogNode,
  LessonDiagram,
  LessonSymbolEntry,
  PdfSplitPlanItem,
} from '../types';
import {
  allocateSectionsToDays,
  ensureStableSectionId,
  extractReferencedRegionIds,
} from './learningLogic';

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
        prerequisiteCheck: lesson.teachingContext.prerequisiteCheck
          ? stripAiCitationArtifacts(String(lesson.teachingContext.prerequisiteCheck))
          : lesson.teachingContext.prerequisiteCheck,
        learningObjectives: Array.isArray(lesson.teachingContext.learningObjectives)
          ? lesson.teachingContext.learningObjectives.map((o) => stripAiCitationArtifacts(String(o)))
          : [],
        teachingScope: stripAiCitationArtifacts(lesson.teachingContext.teachingScope || ''),
        connectionNote: stripAiCitationArtifacts(lesson.teachingContext.connectionNote || ''),
      }
      : undefined,
    markdownBody: stripAiCitationArtifacts(lesson.markdownBody || ''),
    symbolGlossary: Array.isArray(lesson.symbolGlossary)
      ? lesson.symbolGlossary.map((s) => ({
        ...s,
        symbol: String(s.symbol || '').trim(),
        name: stripAiCitationArtifacts(String(s.name || '')),
        definition: stripAiCitationArtifacts(String(s.definition || '')),
        unit: s.unit ? stripAiCitationArtifacts(String(s.unit)) : s.unit,
        aliases: Array.isArray(s.aliases) ? s.aliases.map(String) : s.aliases,
      }))
      : lesson.symbolGlossary,
    diagrams: Array.isArray(lesson.diagrams)
      ? lesson.diagrams.map((d) => ({
        ...d,
        title: stripAiCitationArtifacts(d.title || ''),
        stageLabel: d.stageLabel ? stripAiCitationArtifacts(d.stageLabel) : d.stageLabel,
        topologySpec: d.topologySpec
          ? stripAiCitationArtifacts(String(d.topologySpec))
          : d.topologySpec,
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
        answerReveal: hq.answerReveal
          ? stripAiCitationArtifacts(hq.answerReveal)
          : hq.answerReveal,
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
        explanation: ex.explanation
          ? stripAiCitationArtifacts(ex.explanation)
          : ex.explanation,
        wrongOptionsAnalysis: ex.wrongOptionsAnalysis
          ? stripAiCitationArtifacts(ex.wrongOptionsAnalysis)
          : ex.wrongOptionsAnalysis,
        topologySpec: ex.topologySpec
          ? stripAiCitationArtifacts(String(ex.topologySpec))
          : ex.topologySpec,
        remediation: ex.remediation
          ? stripAiCitationArtifacts(String(ex.remediation))
          : ex.remediation,
        variantCheck:
          typeof ex.variantCheck === 'string'
            ? stripAiCitationArtifacts(ex.variantCheck)
            : ex.variantCheck && typeof ex.variantCheck === 'object'
              ? {
                ...ex.variantCheck,
                question: stripAiCitationArtifacts(ex.variantCheck.question || ''),
                options: Array.isArray(ex.variantCheck.options)
                  ? ex.variantCheck.options.map((opt) => stripAiCitationArtifacts(String(opt)))
                  : ex.variantCheck.options,
                answer: stripAiCitationArtifacts(ex.variantCheck.answer || ''),
                explanation: ex.variantCheck.explanation
                  ? stripAiCitationArtifacts(ex.variantCheck.explanation)
                  : ex.variantCheck.explanation,
              }
              : ex.variantCheck,
      }))
      : [],
    reverseChecks: Array.isArray(lesson.reverseChecks)
      ? lesson.reverseChecks.map((rc) => ({
        ...rc,
        topic: stripAiCitationArtifacts(rc.topic || ''),
        prompt: stripAiCitationArtifacts(rc.prompt || ''),
        keyPoints: Array.isArray(rc.keyPoints)
          ? rc.keyPoints.map((kp) => stripAiCitationArtifacts(String(kp)))
          : undefined,
        referenceExplanation: rc.referenceExplanation
          ? stripAiCitationArtifacts(rc.referenceExplanation)
          : rc.referenceExplanation,
      }))
      : lesson.reverseChecks,
    qualityCheck: lesson.qualityCheck
      ? {
        ...lesson.qualityCheck,
        coveredPoints: Array.isArray(lesson.qualityCheck.coveredPoints)
          ? lesson.qualityCheck.coveredPoints.map((cp) => stripAiCitationArtifacts(String(cp)))
          : undefined,
        formulaAndUnitNote: lesson.qualityCheck.formulaAndUnitNote
          ? stripAiCitationArtifacts(lesson.qualityCheck.formulaAndUnitNote)
          : undefined,
        derivationContinuityNote: lesson.qualityCheck.derivationContinuityNote
          ? stripAiCitationArtifacts(lesson.qualityCheck.derivationContinuityNote)
          : undefined,
        diagramAlignmentNote: lesson.qualityCheck.diagramAlignmentNote
          ? stripAiCitationArtifacts(lesson.qualityCheck.diagramAlignmentNote)
          : undefined,
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

function estimateWrittenLessonMinutes(params: {
  markdownBody: string;
  diagramsCount: number;
  exercisesCount: number;
  heuristicsCount: number;
  paragraphsCount?: number;
}): number {
  const textLen = (params.markdownBody || '').replace(/\s+/g, '').length;
  const formulaCount = ((params.markdownBody || '').match(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g) || [])
    .length;
  const proseMin = Math.min(45, Math.max(8, Math.round(textLen / 180)));
  const formulaMin = Math.min(20, Math.round(formulaCount * 0.6));
  const diagramMin = Math.min(18, params.diagramsCount * 4);
  const exerciseMin = Math.min(35, params.exercisesCount * 5);
  const heuristicMin = Math.min(15, params.heuristicsCount * 3);
  const englishMin = Math.min(20, (params.paragraphsCount || 0) * 3);
  const total = proseMin + formulaMin + diagramMin + exerciseMin + heuristicMin + englishMin;
  return Math.max(20, Math.min(120, total));
}

/**
 * Repair common unescaped LaTeX backslashes and literal control characters inside JSON string literals.
 * Leaves already-valid escaped sequences (`\\alpha`, `\n`, `\"`, `\/`, `\uXXXX`) untouched, while
 * healing invalid single-backslash LaTeX commands (`\alpha`, `\lim`, `\sin`, `\{`, etc.) and
 * LaTeX commands whose first letter collides with JSON escapes (`\beta`, `\frac`, `\text`, `\tilde`,
 * `\right`, `\neq`, etc.) so `JSON.parse` neither fails nor silently corrupts them into control chars.
 */
export function repairUnescapedLatexInJsonString(rawJson: string): string {
  if (!rawJson || !rawJson.includes('"')) return rawJson;

  const isLatexAfterControlChar = (escChar: string, rest: string): boolean => {
    switch (escChar) {
      case 'b':
        return /^(?:eta(?![a-zA-Z])|egin(?:\{|(?![a-zA-Z]))|ar(?:\{|(?![a-zA-Z]))|inom(?:\{|(?![a-zA-Z]))|ig[lrm]?(?![a-zA-Z])|igger(?![a-zA-Z])|oxed(?:\{|(?![a-zA-Z]))|oldsymbol(?:\{|(?![a-zA-Z]))|ullet(?![a-zA-Z])|ackslash(?![a-zA-Z])|ot(?![a-zA-Z])|lacktriangle|ecause(?![a-zA-Z])|etween(?![a-zA-Z]))/.test(
          rest
        );
      case 'f':
        return /^(?:rac(?:\{|(?![a-zA-Z]))|orall(?![a-zA-Z])|rown(?![a-zA-Z])|lat(?![a-zA-Z])|box(?:\{|(?![a-zA-Z]))|int(?![a-zA-Z]))/.test(
          rest
        );
      case 't':
        return /^(?:ext(?:bf|it|rm|tt|sf|sc)?(?:\{|(?![a-zA-Z]))|ilde(?:\{|(?![a-zA-Z]))|an(?:\{|(?![a-zA-Z]))|anh(?![a-zA-Z])|imes(?![a-zA-Z])|o(?=[ \\{}\^_0-9+-]|$)|heta(?![a-zA-Z])|au(?![a-zA-Z])|riangle(?:left|right|q)?(?![a-zA-Z])|frac(?:\{|(?![a-zA-Z]))|op(?![a-zA-Z])|herefore(?![a-zA-Z])|hickapprox(?![a-zA-Z])|iny(?![a-zA-Z]))/.test(
          rest
        );
      case 'r':
        return /^(?:ight(?:arrow|harpoondown|harpoonup|leftarrows)?(?![a-zA-Z])|ho(?![a-zA-Z])|angle(?![a-zA-Z])|ceil(?![a-zA-Z])|floor(?![a-zA-Z])|hd(?![a-zA-Z])|m(?:\{|(?![a-zA-Z]))|Vert(?![a-zA-Z])|vert(?![a-zA-Z]))/.test(
          rest
        );
      case 'n':
        return /^(?:eq(?![a-zA-Z])|abla(?![a-zA-Z])|otin(?![a-zA-Z])|eg(?![a-zA-Z])|atural(?![a-zA-Z])|mid(?![a-zA-Z])|parallel(?![a-zA-Z])|ewline(?![a-zA-Z])|exists(?![a-zA-Z])|leqslant(?![a-zA-Z])|geqslant(?![a-zA-Z])|less(?![a-zA-Z])|gtr(?![a-zA-Z])|cong(?![a-zA-Z])|sim(?![a-zA-Z])|subset(?![a-zA-Z])|supset(?![a-zA-Z])|vdash(?![a-zA-Z])|u(?=[ \\{}\^_0-9+\-*/=.,)$]|$))/.test(
          rest
        );
      default:
        return false;
    }
  };

  let out = '';
  let inString = false;
  let i = 0;

  while (i < rawJson.length) {
    const ch = rawJson[i];
    if (!inString) {
      out += ch;
      if (ch === '"') {
        inString = true;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      out += ch;
      inString = false;
      i++;
      continue;
    }

    if (ch === '\\') {
      if (i + 1 >= rawJson.length) {
        out += '\\\\';
        i++;
        continue;
      }
      const next = rawJson[i + 1];
      if (next === '"' || next === '\\' || next === '/') {
        out += ch + next;
        i += 2;
        continue;
      }
      if (next === 'u') {
        const hex = rawJson.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += rawJson.slice(i, i + 6);
          i += 6;
        } else {
          out += '\\\\u';
          i += 2;
        }
        continue;
      }
      if (next === 'b' || next === 'f' || next === 'n' || next === 'r' || next === 't') {
        const rest = rawJson.slice(i + 2, i + 26);
        if (isLatexAfterControlChar(next, rest)) {
          out += '\\\\' + next;
        } else {
          out += ch + next;
        }
        i += 2;
        continue;
      }
      // Invalid JSON escape sequence (e.g. \alpha, \sin, \cos, \lim, \{, \}, \,): double the backslash
      out += '\\\\' + next;
      i += 2;
      continue;
    }

    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      const rest = rawJson.slice(i + 1, i + 24);
      if (ch === '\b') {
        out += isLatexAfterControlChar('b', rest) ? '\\\\b' : '\\b';
      } else if (ch === '\f') {
        out += isLatexAfterControlChar('f', rest) ? '\\\\f' : '\\f';
      } else if (ch === '\t') {
        out += isLatexAfterControlChar('t', rest) ? '\\\\t' : '\\t';
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        if (rawJson[i + 1] === '\n') {
          out += '\\n';
          i += 2;
          continue;
        }
        out += '\\r';
      } else {
        out += ' ';
      }
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

export function tryParseJsonWithLatexRepair(rawCandidate: string): any | null {
  const trimmed = (rawCandidate || '').trim();
  if (!trimmed) return null;

  const repaired = repairUnescapedLatexInJsonString(trimmed);
  try {
    return JSON.parse(repaired);
  } catch {
    if (repaired !== trimmed) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // ignore
      }
    }
    return null;
  }
}

export function tryExtractJsonObject(rawText: string): any | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const direct = tryParseJsonWithLatexRepair(trimmed);
  if (direct && typeof direct === 'object') return direct;

  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let bestCandidate: any = null;
  let m: RegExpExecArray | null;
  while ((m = codeBlockRegex.exec(trimmed)) !== null) {
    const parsed = tryParseJsonWithLatexRepair(m[1].trim());
    if (parsed && typeof parsed === 'object') {
      bestCandidate = parsed;
      if (
        !Array.isArray(parsed) &&
        (parsed.markdownBody || parsed.englishPayload || parsed.days || parsed.dailyPlan)
      ) {
        return parsed;
      }
    }
  }
  if (bestCandidate) return bestCandidate;

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');

  if (
    firstBrace !== -1 &&
    lastBrace > firstBrace &&
    (firstBracket === -1 || firstBrace < firstBracket)
  ) {
    const parsedObj = tryParseJsonWithLatexRepair(trimmed.slice(firstBrace, lastBrace + 1));
    if (parsedObj) return parsedObj;
  }

  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const parsedArr = tryParseJsonWithLatexRepair(trimmed.slice(firstBracket, lastBracket + 1));
    if (parsedArr) return parsedArr;
  }

  return null;
}

export type PastedCoursewareKind = 'stage1' | 'stage2' | 'patch' | 'complete';

/**
 * Automatically inspect pasted/imported AI output in Step 3 / LessonView to classify whether
 * it is Stage 1 content+specs, Stage 2 SVG diagrams, an incremental repair patch, or a complete lesson.
 */
export function detectPastedCoursewareInputKind(
  rawText: string,
  options?: { hasStage1Draft?: boolean; hasBaseLesson?: boolean }
): PastedCoursewareKind {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return 'complete';

  const parsed = tryExtractJsonObject(trimmed);
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed)) {
      const looksLikeDiagrams = parsed.some(
        (item) =>
          item &&
          typeof item === 'object' &&
          (typeof item.svgCode === 'string' || typeof item.svg === 'string' || typeof item.id === 'string')
      );
      if (looksLikeDiagrams) {
        return options?.hasStage1Draft ? 'stage2' : options?.hasBaseLesson ? 'patch' : 'stage2';
      }
    } else {
      const hasBody =
        (typeof parsed.markdownBody === 'string' && parsed.markdownBody.trim().length > 0) ||
        (typeof parsed.content === 'string' && parsed.content.trim().length > 0);

      if (!hasBody) {
        const hasPatchFields =
          Array.isArray(parsed.textReplacements) ||
          Array.isArray(parsed.exercisesToUpsert) ||
          Array.isArray(parsed.heuristicQuestionsToUpsert) ||
          Boolean(parsed.teachingContextPatch && typeof parsed.teachingContextPatch === 'object') ||
          typeof parsed.markdownBodyPrefixPrepend === 'string' ||
          typeof parsed.markdownBodySuffixAppend === 'string' ||
          Array.isArray(parsed.exercises) ||
          Array.isArray(parsed.heuristicQuestions) ||
          typeof parsed.summary === 'string';

        if (hasPatchFields) {
          return 'patch';
        }
        if (Array.isArray(parsed.diagramsToUpsert) || Array.isArray(parsed.diagrams)) {
          return options?.hasStage1Draft ? 'stage2' : options?.hasBaseLesson ? 'patch' : 'stage2';
        }
      }

      if (parsed.generationStage === 'stage1_content') {
        return 'stage1';
      }

      if (hasBody) {
        const diagPending =
          Array.isArray(parsed.diagrams) &&
          parsed.diagrams.some((d: any) => d && !hasValidSvgMarkup(d.svgCode || d.svg));
        const exPending =
          Array.isArray(parsed.exercises) &&
          parsed.exercises.some(
            (ex: any) => ex && (ex.diagramId || ex.topologySpec) && !hasValidSvgMarkup(ex.svgCode || ex.svg)
          );
        const anySvg =
          Array.isArray(parsed.diagrams) &&
          parsed.diagrams.some((d: any) => d && hasValidSvgMarkup(d.svgCode || d.svg));
        if ((diagPending && !anySvg) || ((diagPending || exPending) && parsed.generationStage !== 'complete')) {
          return 'stage1';
        }
        return 'complete';
      }
    }
  }

  if (/<svg[\s\S]*?<\/svg>/i.test(trimmed) && !trimmed.includes('"markdownBody"') && !/^#\s+/m.test(trimmed)) {
    return options?.hasStage1Draft ? 'stage2' : options?.hasBaseLesson ? 'patch' : 'stage2';
  }

  return 'complete';
}

export function hasValidSvgMarkup(svgCode?: string): boolean {
  const code = (svgCode || '').trim();
  return Boolean(code && /<svg\b/i.test(code) && /<\/svg>/i.test(code));
}

export interface DiagramSpecItem {
  id: string;
  title: string;
  stageLabel?: string;
  topologySpec: string;
  caption: string;
  linkedExerciseId?: string;
  contextSnippet?: string;
}

/**
 * Extract all diagram specifications from a Stage 1 (or partial) lesson that do not yet have valid SVG code.
 * Stage 2 uses ONLY these extracted specs + concise anchor context — zero textbook PDF re-upload needed.
 */
export function extractPendingDiagramSpecs(lesson?: DailyLessonContent | null): DiagramSpecItem[] {
  if (!lesson) return [];
  const specs: DiagramSpecItem[] = [];
  const seen = new Set<string>();
  const body = lesson.markdownBody || '';

  const buildContextSnippet = (diagId: string): string | undefined => {
    if (!body || !diagId) return undefined;
    const escaped = diagId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = body.match(new RegExp(`(?:\\{\\{diagram:${escaped}\\}\\}|图\\s*${escaped})`, 'i'));
    if (!match || match.index === undefined) return undefined;
    const start = Math.max(0, match.index - 180);
    const end = Math.min(body.length, match.index + 240);
    return body.slice(start, end).replace(/\s+/g, ' ').trim();
  };

  for (let i = 0; i < (lesson.diagrams || []).length; i++) {
    const d = lesson.diagrams![i];
    if (!d) continue;
    const diagId = (d.id || `diag-${i + 1}`).trim();
    const key = diagId.toLowerCase();
    if (seen.has(key)) continue;
    if (!hasValidSvgMarkup(d.svgCode)) {
      seen.add(key);
      specs.push({
        id: diagId,
        title: d.title || `图示 ${diagId}`,
        stageLabel: d.stageLabel,
        topologySpec: (d.topologySpec || d.caption || d.title || '').trim(),
        caption: (d.caption || '').trim(),
        contextSnippet: buildContextSnippet(diagId),
      });
    }
  }

  for (let i = 0; i < (lesson.exercises || []).length; i++) {
    const ex = lesson.exercises![i];
    if (!ex || hasValidSvgMarkup(ex.svgCode)) continue;
    const diagId = (ex.diagramId || '').trim();
    if (!diagId && !ex.topologySpec) continue;
    const resolvedId = diagId || `diag-${ex.id || `ex-${i + 1}`}`;
    const key = resolvedId.toLowerCase();
    if (seen.has(key)) continue;
    // Check if diagrams already provides valid SVG for this ID
    const existingDiag = (lesson.diagrams || []).find(
      (d) => (d.id || '').trim().toLowerCase() === key && hasValidSvgMarkup(d.svgCode)
    );
    if (existingDiag) continue;
    seen.add(key);
    specs.push({
      id: resolvedId,
      title: ex.diagramTitle || `练习题 #${i + 1} 配图（${resolvedId}）`,
      topologySpec: (ex.topologySpec || ex.question || '').trim(),
      caption: (ex.diagramCaption || '').trim(),
      linkedExerciseId: ex.id,
      contextSnippet: ex.question ? ex.question.slice(0, 260) : undefined,
    });
  }

  return specs;
}

/**
 * Parse single-lesson content imported via Chat mode (paste or file) or Agent mode JSON.
 * Supports both structured JSON (Stage 1 content+specs or complete courseware) and raw Markdown.
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
  existingAssets: Record<string, string> = {},
  options?: { stageMode?: 'auto' | 'stage1' | 'complete' }
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
        .filter(
          (d: any) =>
            d &&
            (typeof d.svgCode === 'string' ||
              typeof d.svg === 'string' ||
              typeof d.topologySpec === 'string' ||
              typeof d.id === 'string' ||
              typeof d.title === 'string')
        )
        .map((d: any, idx: number) => {
          const rawSvg =
            typeof d.svgCode === 'string' && d.svgCode.trim()
              ? d.svgCode.trim()
              : typeof d.svg === 'string' && d.svg.trim()
                ? d.svg.trim()
                : undefined;
          return {
            id: d.id || `diag-${idx + 1}`,
            title: d.title || `图 ${slot.dayIndex}.${idx + 1}`,
            stageLabel: d.stageLabel,
            topologySpec:
              typeof d.topologySpec === 'string' && d.topologySpec.trim()
                ? d.topologySpec.trim()
                : undefined,
            caption: d.caption || '',
            svgCode: rawSvg,
          };
        })
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

          const rawSvgCode =
            typeof ex.svgCode === 'string' && ex.svgCode.trim().includes('<svg')
              ? ex.svgCode.trim()
              : typeof ex.svg === 'string' && ex.svg.trim().includes('<svg')
                ? ex.svg.trim()
                : typeof ex.diagramSvg === 'string' && ex.diagramSvg.trim().includes('<svg')
                  ? ex.diagramSvg.trim()
                  : undefined;
          let resolvedDiagramId =
            typeof ex.diagramId === 'string' && ex.diagramId.trim()
              ? ex.diagramId.trim()
              : undefined;

          const rawTopologySpec =
            typeof ex.topologySpec === 'string' && ex.topologySpec.trim()
              ? ex.topologySpec.trim()
              : undefined;

          if (rawSvgCode || (resolvedDiagramId && rawTopologySpec)) {
            if (!resolvedDiagramId) {
              resolvedDiagramId = `diag-${id}`;
            }
            const existsInDiagrams = diagrams.some(
              (d) => (d.id || '').trim().toLowerCase() === resolvedDiagramId!.toLowerCase()
            );
            if (!existsInDiagrams) {
              diagrams.push({
                id: resolvedDiagramId,
                title:
                  (typeof ex.diagramTitle === 'string' && ex.diagramTitle.trim()) ||
                  `练习题 #${idx + 1} 配图`,
                topologySpec: rawTopologySpec,
                caption:
                  typeof ex.diagramCaption === 'string' ? ex.diagramCaption.trim() : '',
                svgCode: rawSvgCode,
              });
            }
          }

          let parsedVariantCheck: ExerciseVariantCheck | string | undefined;
          if (typeof ex.variantCheck === 'string' && ex.variantCheck.trim()) {
            parsedVariantCheck = ex.variantCheck.trim();
          } else if (
            ex.variantCheck &&
            typeof ex.variantCheck === 'object' &&
            (ex.variantCheck.question || ex.variantCheck.prompt)
          ) {
            parsedVariantCheck = {
              question: String(ex.variantCheck.question || ex.variantCheck.prompt),
              options: Array.isArray(ex.variantCheck.options)
                ? ex.variantCheck.options.map(String)
                : undefined,
              answer: String(ex.variantCheck.answer ?? ex.variantCheck.correctAnswer ?? ''),
              explanation: ex.variantCheck.explanation
                ? String(ex.variantCheck.explanation)
                : undefined,
            };
          }

          return {
            id,
            stage,
            type: isFill ? 'fill' : 'choice',
            difficulty: ex.difficulty,
            categoryLabel: ex.categoryLabel || ex.category,
            topologySpec:
              typeof ex.topologySpec === 'string' && ex.topologySpec.trim()
                ? ex.topologySpec.trim()
                : undefined,
            diagramId: resolvedDiagramId,
            svgCode: rawSvgCode,
            diagramTitle:
              typeof ex.diagramTitle === 'string' && ex.diagramTitle.trim()
                ? ex.diagramTitle.trim()
                : undefined,
            diagramCaption:
              typeof ex.diagramCaption === 'string' && ex.diagramCaption.trim()
                ? ex.diagramCaption.trim()
                : undefined,
            question: String(ex.question),
            options: Array.isArray(ex.options) ? ex.options.map(String) : undefined,
            answer: String(ex.answer ?? ex.correctAnswer ?? ''),
            hint: ex.hint ? String(ex.hint) : undefined,
            explanation:
              typeof ex.explanation === 'string' && ex.explanation.trim()
                ? ex.explanation.trim()
                : undefined,
            wrongOptionsAnalysis: wrongAnalysis,
            remediation:
              typeof ex.remediation === 'string' && ex.remediation.trim()
                ? ex.remediation.trim()
                : undefined,
            variantCheck: parsedVariantCheck,
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
          answerReveal:
            hq.answerReveal || hq.explanation
              ? String(hq.answerReveal || hq.explanation)
              : undefined,
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
              : undefined,
          referenceExplanation:
            rc.referenceExplanation || rc.referenceAnswer
              ? String(rc.referenceExplanation || rc.referenceAnswer)
              : undefined,
        }))
      : [];

    const rawQc = parsedJson.qualityCheck;
    const qualityCheck =
      rawQc &&
        typeof rawQc === 'object' &&
        (Array.isArray(rawQc.coveredPoints) ||
          rawQc.formulaAndUnitNote ||
          rawQc.CoverageAuditNote ||
          rawQc.derivationContinuityNote ||
          rawQc.diagramAlignmentNote ||
          rawQc.intermediateStepsAuditNote)
        ? {
          coveredPoints: Array.isArray(rawQc.coveredPoints)
            ? rawQc.coveredPoints.map(String)
            : undefined,
          formulaAndUnitNote:
            rawQc.formulaAndUnitNote || rawQc.CoverageAuditNote || undefined,
          derivationContinuityNote: rawQc.derivationContinuityNote || undefined,
          diagramAlignmentNote: rawQc.diagramAlignmentNote || undefined,
          intermediateStepsAuditNote: rawQc.intermediateStepsAuditNote || undefined,
        }
        : undefined;

    const symbolGlossary: LessonSymbolEntry[] | undefined = Array.isArray(
      parsedJson.symbolGlossary
    )
      ? parsedJson.symbolGlossary
        .filter((s: any) => s && s.symbol && (s.name || s.definition || s.meaning))
        .map((s: any) => ({
          symbol: String(s.symbol).trim(),
          aliases: Array.isArray(s.aliases) ? s.aliases.map(String) : undefined,
          name: String(s.name || s.label || s.symbol).trim(),
          definition: String(s.definition || s.meaning || s.description || s.name || '').trim(),
          unit: s.unit ? String(s.unit).trim() : undefined,
        }))
      : undefined;

    const rawTc = parsedJson.teachingContext;
    const teachingContext = rawTc
      ? {
        prerequisites: Array.isArray(rawTc.prerequisites)
          ? rawTc.prerequisites.map(String)
          : slot.prerequisites || [],
        prerequisiteCheck:
          typeof rawTc.prerequisiteCheck === 'string' && rawTc.prerequisiteCheck.trim()
            ? rawTc.prerequisiteCheck.trim()
            : typeof parsedJson.prerequisiteCheck === 'string' &&
              parsedJson.prerequisiteCheck.trim()
              ? parsedJson.prerequisiteCheck.trim()
              : undefined,
        learningObjectives: Array.isArray(rawTc.learningObjectives)
          ? rawTc.learningObjectives.map(String)
          : [slot.objective],
        teachingScope: String(rawTc.teachingScope || slot.teachingScope || slot.keyTopics.join('、')),
        connectionNote: String(rawTc.connectionNote || slot.connectionNote || ''),
      }
      : {
        prerequisites: Array.isArray(parsedJson.prerequisites)
          ? parsedJson.prerequisites.map(String)
          : slot.prerequisites || [],
        prerequisiteCheck:
          typeof parsedJson.prerequisiteCheck === 'string' && parsedJson.prerequisiteCheck.trim()
            ? parsedJson.prerequisiteCheck.trim()
            : undefined,
        learningObjectives: Array.isArray(parsedJson.objectives)
          ? parsedJson.objectives.map(String)
          : [slot.objective],
        teachingScope: slot.teachingScope || slot.keyTopics.join('、'),
        connectionNote: slot.connectionNote || '',
      };

    const rawLessonMinutes = Number(
      parsedJson.estimatedMinutes ?? parsedJson.studyMinutes ?? parsedJson.durationMinutes
    );
    const evaluatedMinutes =
      Number.isFinite(rawLessonMinutes) && rawLessonMinutes > 0
        ? Math.max(10, Math.min(300, Math.round(rawLessonMinutes)))
        : estimateWrittenLessonMinutes({
          markdownBody,
          diagramsCount: diagrams.length,
          exercisesCount: exercises.length,
          heuristicsCount: heuristicQuestions.length,
          paragraphsCount: Array.isArray(parsedJson.englishPayload?.paragraphs)
            ? parsedJson.englishPayload.paragraphs.length
            : 0,
        });

    const hasPendingSpecs = diagrams.some((d) => !hasValidSvgMarkup(d.svgCode));
    const isStage1Draft =
      options?.stageMode === 'stage1' ||
      (options?.stageMode !== 'complete' &&
        (parsedJson.generationStage === 'stage1_content' ||
          (hasPendingSpecs && diagrams.some((d) => Boolean(d.topologySpec) && !hasValidSvgMarkup(d.svgCode)))));

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
      estimatedMinutes: evaluatedMinutes,
      ...(isStage1Draft
        ? { generationStage: 'stage1_content' as const }
        : parsedJson.generationStage === 'complete'
          ? { generationStage: 'complete' as const }
          : {}),
      keyPoints:
        Array.isArray(parsedJson.keyPoints) && parsedJson.keyPoints.length > 0
          ? parsedJson.keyPoints.map(String)
          : slot.keyTopics,
      teachingContext,
      markdownBody,
      symbolGlossary,
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

  const explicitMinuteMatch =
    trimmed.match(/"estimatedMinutes"\s*:\s*(\d{1,3})/i) ||
    trimmed.match(/(?:预计学习(?:时间|时长)|预计耗时)\s*[：:]\s*(\d{1,3})\s*(?:分钟|min)/i);
  const explicitMinutes = explicitMinuteMatch ? Number(explicitMinuteMatch[1]) : NaN;
  const fallbackMinutes =
    Number.isFinite(explicitMinutes) && explicitMinutes > 0
      ? Math.max(10, Math.min(300, Math.round(explicitMinutes)))
      : estimateWrittenLessonMinutes({
        markdownBody: trimmed,
        diagramsCount: extractedDiagrams.length,
        exercisesCount: 0,
        heuristicsCount: 0,
      });

  const baseLesson: DailyLessonContent = {
    sectionId,
    dayIndex: slot.dayIndex,
    date: slot.date,
    title: extractedTitle,
    summary: slot.objective,
    estimatedMinutes: fallbackMinutes,
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
  const rawSections = Array.isArray(parsed?.sections)
    ? parsed.sections
    : Array.isArray(parsed?.days)
      ? parsed.days
      : Array.isArray(parsed?.dailyPlan)
        ? parsed.dailyPlan
        : null;

  if (!parsed || !rawSections || rawSections.length === 0) {
    throw new Error('未能解析出有效的课程目录 JSON（需包含 sections 或 days 数组）。');
  }

  const rawSlots: DailyPlanSlot[] = rawSections.map((item: any, i: number) => {
    const dayIndex = i + 1;
    const requestedId = item?.id || item?.sectionId;
    const existingById = requestedId
      ? existingSlots.find((s) => s.id === requestedId)
      : undefined;
    const existing = existingById || existingSlots.find((s) => s.dayIndex === dayIndex);
    const stableId = ensureStableSectionId(dayIndex, requestedId || existing?.id);

    const parsedMinutes = Number(item?.estimatedMinutes);
    const keyTopics =
      Array.isArray(item?.keyTopics) && item.keyTopics.length > 0
        ? item.keyTopics.map((k: any) => stripAiCitationArtifacts(String(k)))
        : existing?.keyTopics || [];
    const lessonMinutes = Number(existing?.lesson?.estimatedMinutes);
    const evaluatedMinutes =
      Number.isFinite(lessonMinutes) && lessonMinutes > 0
        ? Math.max(10, Math.min(300, Math.round(lessonMinutes)))
        : Number.isFinite(parsedMinutes) && parsedMinutes > 0
          ? Math.max(10, Math.min(300, Math.round(parsedMinutes)))
          : undefined;

    const extractedRegions = extractReferencedRegionIds({
      regionId: item?.regionId,
      regionIds: Array.isArray(item?.regionIds) ? item.regionIds : undefined,
      teachingScope: item?.teachingScope,
      title: item?.title,
    });
    const resolvedRegionIds =
      extractedRegions.length > 0
        ? extractedRegions
        : existing?.regionIds?.length
          ? existing.regionIds
          : existing?.regionId
            ? [existing.regionId]
            : [];

    return {
      id: stableId,
      dayIndex,
      scheduledDay:
        typeof item?.scheduledDay === 'number' && item.scheduledDay > 0
          ? item.scheduledDay
          : existing?.scheduledDay,
      estimatedMinutes: evaluatedMinutes,
      date: item?.date || existing?.date || startDate,
      title: stripAiCitationArtifacts(item?.title || existing?.title || `第 ${dayIndex} 节`),
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
      regionId: resolvedRegionIds[0] || item?.regionId || existing?.regionId,
      regionIds: resolvedRegionIds.length > 0 ? resolvedRegionIds : undefined,
      keyTopics,
      assignedWords: existing?.assignedWords,
      pdfSegment: existing?.pdfSegment,
      pdfSegments: existing?.pdfSegments,
      // Preserve any already-generated lesson or stage1Draft so modifying outline NEVER deletes existing work!
      stage1Draft: existing?.stage1Draft,
      lesson: existing?.lesson,
    };
  });

  // Deterministically assign sections to study days by estimatedMinutes
  const allocatedSlots = allocateSectionsToDays(rawSlots, durationDays, startDate);

  return {
    knowledgeCatalog: Array.isArray(parsed.knowledgeCatalog)
      ? parsed.knowledgeCatalog.map((node: any, idx: number) => ({
        id: String(node?.id || `kp-${idx + 1}`),
        title: stripAiCitationArtifacts(String(node?.title || '')),
        prerequisites: Array.isArray(node?.prerequisites)
          ? node.prerequisites.map((p: any) => stripAiCitationArtifacts(String(p)))
          : [],
        coreConcepts: Array.isArray(node?.coreConcepts)
          ? node.coreConcepts.map((c: any) => stripAiCitationArtifacts(String(c)))
          : [],
        estimatedMinutes:
          typeof node?.estimatedMinutes === 'number' && node.estimatedMinutes > 0
            ? Math.round(node.estimatedMinutes)
            : undefined,
        sectionId: node?.sectionId
          ? String(node.sectionId)
          : typeof node?.assignedDayIndex === 'number' && node.assignedDayIndex > 0
            ? ensureStableSectionId(node.assignedDayIndex)
            : undefined,
        difficulty: node?.difficulty,
        assignedDayIndex:
          typeof node?.assignedDayIndex === 'number' ? node.assignedDayIndex : undefined,
      }))
      : [],
    dailyPlan: allocatedSlots,
  };
}

/**
 * Merge Stage 2 diagram SVG outputs into a Stage 1 lesson WITHOUT overwriting or rewriting
 * Stage 1 markdown prose, derivations, heuristic questions, or exercises.
 */
export function mergeStage2DiagramsIntoStage1(
  stage1Lesson: DailyLessonContent,
  rawStage2Input: string,
  existingAssets: Record<string, string> = {}
): {
  mergedLesson: DailyLessonContent;
  matchedCount: number;
  addedCount: number;
  pendingRemaining: DiagramSpecItem[];
} {
  const trimmed = (rawStage2Input || '').trim();
  if (!trimmed) {
    throw new Error('阶段二图示内容为空，请粘贴 Stage 2 输出的 SVG 图示 JSON。');
  }

  let incomingDiags: any[] = [];
  const parsed = tryExtractJsonObject(trimmed);
  if (Array.isArray(parsed)) {
    incomingDiags = parsed;
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.diagramsToUpsert) && parsed.diagramsToUpsert.length > 0) {
      incomingDiags = parsed.diagramsToUpsert;
    } else if (Array.isArray(parsed.diagrams) && parsed.diagrams.length > 0) {
      incomingDiags = parsed.diagrams;
    }
  } else {
    // Try code fence containing a JSON array
    const arrFenceMatch = trimmed.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/i);
    if (arrFenceMatch) {
      const arr = tryParseJsonWithLatexRepair(arrFenceMatch[1]);
      if (Array.isArray(arr)) incomingDiags = arr;
    }
  }

  // Fallback: bare <svg>...</svg> blocks matched sequentially to pending diagram specs
  if (incomingDiags.length === 0) {
    const svgMatches = Array.from(trimmed.matchAll(/<svg[\s\S]*?<\/svg>/gi)).map((m) => m[0]);
    if (svgMatches.length > 0) {
      const pending = extractPendingDiagramSpecs(stage1Lesson);
      incomingDiags = svgMatches.map((svgCode, idx) => ({
        id: pending[idx]?.id || `diag-${idx + 1}`,
        title: pending[idx]?.title || `图示 ${idx + 1}`,
        caption: pending[idx]?.caption || '',
        svgCode,
      }));
    }
  }

  if (incomingDiags.length === 0) {
    throw new Error(
      '未在阶段二输出中解析出有效的 diagrams / diagramsToUpsert 数组或 <svg> 代码。'
    );
  }

  const normalizeDiagKey = (val?: string) =>
    (val || '').trim().toLowerCase().replace(/^diagram[-_]?/, 'diag-').replace(/_/g, '-');

  const mergedDiagrams: LessonDiagram[] = (stage1Lesson.diagrams || []).map((d) => ({ ...d }));
  let matchedCount = 0;
  let addedCount = 0;

  for (let i = 0; i < incomingDiags.length; i++) {
    const raw = incomingDiags[i];
    if (!raw || typeof raw !== 'object') continue;
    const svgCode =
      typeof raw.svgCode === 'string' && raw.svgCode.trim()
        ? raw.svgCode.trim()
        : typeof raw.svg === 'string' && raw.svg.trim()
          ? raw.svg.trim()
          : '';
    if (!hasValidSvgMarkup(svgCode)) continue;

    const rawId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
    const normIncoming = normalizeDiagKey(rawId);

    let targetIdx = rawId
      ? mergedDiagrams.findIndex((d) => normalizeDiagKey(d.id) === normIncoming)
      : -1;
    if (targetIdx === -1 && mergedDiagrams.length > 0 && !rawId) {
      targetIdx = mergedDiagrams.findIndex((d) => !hasValidSvgMarkup(d.svgCode));
    }

    if (targetIdx >= 0) {
      const prev = mergedDiagrams[targetIdx];
      mergedDiagrams[targetIdx] = {
        ...prev,
        id: prev.id || rawId || `diag-${targetIdx + 1}`,
        title:
          prev.title && !/^图\s*\d+\.\d+$/.test(prev.title)
            ? prev.title
            : (typeof raw.title === 'string' && raw.title.trim()) || prev.title,
        stageLabel: prev.stageLabel || (typeof raw.stageLabel === 'string' ? raw.stageLabel : undefined),
        topologySpec:
          prev.topologySpec ||
          (typeof raw.topologySpec === 'string' && raw.topologySpec.trim()
            ? raw.topologySpec.trim()
            : undefined),
        caption:
          prev.caption || (typeof raw.caption === 'string' && raw.caption.trim())
            ? prev.caption || String(raw.caption).trim()
            : '',
        svgCode,
      };
      matchedCount++;
    } else {
      const assignedId = rawId || `diag-${mergedDiagrams.length + 1}`;
      mergedDiagrams.push({
        id: assignedId,
        title: (typeof raw.title === 'string' && raw.title.trim()) || `图示 ${assignedId}`,
        stageLabel: typeof raw.stageLabel === 'string' ? raw.stageLabel : undefined,
        topologySpec:
          typeof raw.topologySpec === 'string' && raw.topologySpec.trim()
            ? raw.topologySpec.trim()
            : undefined,
        caption: typeof raw.caption === 'string' ? raw.caption.trim() : '',
        svgCode,
      });
      addedCount++;
    }
  }

  if (matchedCount === 0 && addedCount === 0) {
    throw new Error('阶段二输出中未包含合法闭合的 <svg>...</svg> 图形代码。');
  }

  const updatedExercises = (stage1Lesson.exercises || []).map((ex) => {
    if (!ex.diagramId) return ex;
    const matchDiag = mergedDiagrams.find(
      (d) => normalizeDiagKey(d.id) === normalizeDiagKey(ex.diagramId)
    );
    if (!matchDiag || !hasValidSvgMarkup(matchDiag.svgCode)) return ex;
    return {
      ...ex,
      svgCode: matchDiag.svgCode,
      diagramTitle: ex.diagramTitle || matchDiag.title,
      diagramCaption: ex.diagramCaption || matchDiag.caption || undefined,
    };
  });

  const mergedBase: DailyLessonContent = {
    ...stage1Lesson,
    generationStage: 'complete',
    diagrams: mergedDiagrams,
    exercises: updatedExercises,
    generatedAt: new Date().toISOString(),
  };

  const sanitized = sanitizeLessonCitations(mergedBase);
  const mergedLesson = resolveLessonAssetReferences(sanitized, existingAssets);
  const pendingRemaining = extractPendingDiagramSpecs(mergedLesson);

  return {
    mergedLesson,
    matchedCount,
    addedCount,
    pendingRemaining,
  };
}

/**
 * Normalize raw PDF split region objects into `PdfSplitPlanItem[]`.
 * Browser-safe helper used by both Node (`pdfProcessor.ts`) and React workbench.
 */
export function normalizePdfSplitRegionObjects(
  rawItems: any[],
  defaultSourceFileName: string,
  totalPages = 2000,
  globalOffset = 0
): PdfSplitPlanItem[] {
  return rawItems.map((item, idx) => {
    const orderIdx = Number(item?.dayIndex) || idx + 1;
    const rawId = item?.regionId || item?.sectionId || item?.slotId;
    const regionId =
      typeof rawId === 'string' && /^[a-zA-Z0-9_-]+$/.test(rawId.trim())
        ? rawId.trim()
        : `region-${String(idx + 1).padStart(2, '0')}`;

    const itemOffset = typeof item?.pageOffset === 'number' ? item.pageOffset : globalOffset;

    let physicalStart = Number(item?.physicalStartPage ?? item?.startPage);
    let physicalEnd = Number(item?.physicalEndPage ?? item?.endPage);
    const printedStartRaw = item?.printedStartPage ?? item?.printStartPage;
    const printedEndRaw = item?.printedEndPage ?? item?.printEndPage;
    const printedStart = printedStartRaw !== undefined ? Number(printedStartRaw) : undefined;
    const printedEnd = printedEndRaw !== undefined ? Number(printedEndRaw) : undefined;

    if ((Number.isNaN(physicalStart) || physicalStart <= 0) && printedStart !== undefined) {
      physicalStart = printedStart + itemOffset;
    }
    if ((Number.isNaN(physicalEnd) || physicalEnd <= 0) && printedEnd !== undefined) {
      physicalEnd = printedEnd + itemOffset;
    }

    physicalStart = Math.max(1, Math.min(totalPages, physicalStart || 1));
    physicalEnd = Math.max(physicalStart, Math.min(totalPages, physicalEnd || physicalStart));

    const crossRefRaw = Array.isArray(item?.crossRefPages)
      ? item.crossRefPages
      : Array.isArray(item?.additionalPages)
        ? item.additionalPages
        : [];
    const crossRefPages = crossRefRaw
      .map(Number)
      .filter((n: number) => !Number.isNaN(n) && n >= 1 && n <= totalPages);

    const title = String(item?.sectionTitle || item?.title || `划分区域 ${idx + 1}`).trim();

    return {
      sectionId: regionId,
      dayIndex: orderIdx,
      date: String(item?.date || ''),
      sectionTitle: title,
      sourceFileName: item?.sourceFileName || defaultSourceFileName,
      physicalStartPage: physicalStart,
      physicalEndPage: physicalEnd,
      printedStartPage: printedStart ?? Math.max(1, physicalStart - itemOffset),
      printedEndPage: printedEnd ?? Math.max(1, physicalEnd - itemOffset),
      pageOffset: itemOffset,
      crossRefPages,
      outlineMappingNote:
        item?.outlineMappingNote ||
        item?.rationale ||
        item?.mappingNote ||
        `学习区域 ${regionId}（物理第 ${physicalStart}~${physicalEnd} 页）`,
      segmentFileName: `${regionId}.pdf`,
      status: item?.status === 'sliced' ? 'sliced' : 'planned',
      segmentRelPath: item?.segmentRelPath,
      segmentPageCount: item?.segmentPageCount,
    };
  });
}

/**
 * Merge newly imported/repaired PDF split regions incrementally into an existing plan by `sectionId`,
 * preserving untouched regions and ordering cleanly.
 */
export function mergeImportedPdfSplitRegions(
  existingPlan: PdfSplitPlanItem[],
  incomingRegions: PdfSplitPlanItem[]
): PdfSplitPlanItem[] {
  const byId = new Map<string, PdfSplitPlanItem>();
  const orderedIds: string[] = [];

  for (const item of existingPlan || []) {
    const id = item.sectionId || `region-${String(item.dayIndex || orderedIds.length + 1).padStart(2, '0')}`;
    if (!byId.has(id)) orderedIds.push(id);
    byId.set(id, { ...item, sectionId: id });
  }

  for (const item of incomingRegions || []) {
    const id = item.sectionId || `region-${String(item.dayIndex || orderedIds.length + 1).padStart(2, '0')}`;
    if (!byId.has(id)) orderedIds.push(id);
    byId.set(id, { ...item, sectionId: id });
  }

  return orderedIds.map((id, idx) => {
    const item = byId.get(id)!;
    return {
      ...item,
      dayIndex: idx + 1,
    };
  });
}

/**
 * Extract completed top-level region objects from a partially truncated or broken Step 1 split JSON string
 * so the user never loses already-generated regions or has to ask the AI to regenerate from scratch.
 */
export function salvagePartialPdfSplitRegions(
  rawText: string,
  defaultSourceFileName = 'textbook.pdf',
  totalPages = 2000,
  defaultOffset = 0
): {
  salvagedRegions: PdfSplitPlanItem[];
  detectedPageOffset: number;
  brokenTailSnippet: string;
} {
  const trimmed = (rawText || '').trim();
  const offsetMatch = trimmed.match(/"pageOffset"\s*:\s*(-?\d+)/);
  const detectedPageOffset = offsetMatch ? Number(offsetMatch[1]) : defaultOffset;

  const objects: any[] = [];
  let i = 0;
  let inString = false;
  let escaped = false;
  let objStart = -1;
  let objDepth = 0;
  let lastValidEnd = 0;

  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      i++;
      continue;
    }

    if (ch === '{') {
      // Skip only the outer wrapper object ("regions" / "segments" / "splitPlan": [...]) before the first region item
      const nextBrace = trimmed.indexOf('{', i + 1);
      const headerSlice = nextBrace > i ? trimmed.slice(i + 1, nextBrace) : '';
      const isOuterWrapper =
        objDepth === 0 &&
        objects.length === 0 &&
        /"(?:regions|segments|splitPlan)"\s*:\s*\[/.test(headerSlice);
      if (!isOuterWrapper) {
        if (objDepth === 0) objStart = i;
        objDepth++;
      }
    } else if (ch === '}') {
      if (objDepth > 0) {
        objDepth--;
        if (objDepth === 0 && objStart !== -1) {
          const slice = trimmed.slice(objStart, i + 1);
          const parsed = tryParseJsonWithLatexRepair(slice);
          if (
            parsed &&
            typeof parsed === 'object' &&
            (parsed.regionId ||
              parsed.sectionId ||
              parsed.physicalStartPage !== undefined ||
              parsed.printedStartPage !== undefined ||
              parsed.startPage !== undefined)
          ) {
            objects.push(parsed);
            lastValidEnd = i + 1;
          }
          objStart = -1;
        }
      }
    }
    i++;
  }

  const salvagedRegions = normalizePdfSplitRegionObjects(
    objects,
    defaultSourceFileName,
    totalPages,
    detectedPageOffset
  );

  const tailRaw =
    lastValidEnd > 0
      ? trimmed.slice(lastValidEnd).trim()
      : trimmed.slice(Math.max(0, trimmed.length - 220)).trim();

  return {
    salvagedRegions,
    detectedPageOffset,
    brokenTailSnippet: tailRaw.slice(0, 260),
  };
}

/**
 * Build a minimal incremental repair/continuation prompt for Step 1 PDF split failures
 * instead of forcing the AI to regenerate all completed regions again.
 */
export function buildPdfSplitIncrementalRepairPrompt(params: {
  rawInput: string;
  errorMessage: string;
  defaultSourceFileName?: string;
  totalPages?: number;
  defaultOffset?: number;
}): {
  repairPrompt: string;
  salvagedRegions: PdfSplitPlanItem[];
  brokenSnippet: string;
} {
  const { salvagedRegions, detectedPageOffset, brokenTailSnippet } = salvagePartialPdfSplitRegions(
    params.rawInput,
    params.defaultSourceFileName || 'textbook.pdf',
    params.totalPages || 2000,
    params.defaultOffset || 0
  );

  const lastRegion = salvagedRegions[salvagedRegions.length - 1];
  const coveredSummary =
    salvagedRegions.length > 0
      ? salvagedRegions
        .map(
          (r) =>
            `- \`${r.sectionId}\`：${r.sectionTitle}（物理第 ${r.physicalStartPage}~${r.physicalEndPage} 页）`
        )
        .join('\n')
      : '（暂未能抢救出完整已闭合区域）';

  const repairPrompt =
    salvagedRegions.length > 0
      ? `你前面生成的 PDF 区域划分方案在第 \`${lastRegion.sectionId}\` 之后发生语法错误或输出截断（报错：${params.errorMessage}）。
**请勿重复输出已成功解析的前 ${salvagedRegions.length} 个区域！**系统已自动保留以下已完成区域（最后覆盖到物理第 ${lastRegion.physicalEndPage} 页）：

${coveredSummary}

### 断点/出错位置附近片段
\`\`\`text
${brokenTailSnippet || '（末尾截断）'}
\`\`\`

### 请仅输出剩余未完成或出错的区域（增量补丁 JSON，\`"incremental": true\`）
- 从下一个 \`region-${String(salvagedRegions.length + 1).padStart(2, '0')}\`（物理第 ${Math.min(params.totalPages || 2000, lastRegion.physicalEndPage + 1)} 页附近）继续覆盖到教材末尾（共 ${params.totalPages || '?'} 页），\`pageOffset: ${detectedPageOffset}\`。
- JSON 字符串内若有公式反斜杠必须双写 \`\\\\\`，不要插入未转义换行符。
\`\`\`json
{
  "incremental": true,
  "pageOffset": ${detectedPageOffset},
  "regions": [
    {
      "regionId": "region-${String(salvagedRegions.length + 1).padStart(2, '0')}",
      "sectionTitle": "...",
      "sourceFileName": "${params.defaultSourceFileName || 'textbook.pdf'}",
      "physicalStartPage": ${Math.min(params.totalPages || 2000, lastRegion.physicalEndPage + 1)},
      "physicalEndPage": ${params.totalPages || lastRegion.physicalEndPage + 1},
      "printedStartPage": 1,
      "printedEndPage": 10,
      "crossRefPages": [],
      "rationale": "..."
    }
  ]
}
\`\`\``
      : `你前面生成的 PDF 区域划分 JSON 解析失败（报错：${params.errorMessage}）。
请检查出错片段，仅修正语法错误（如末尾缺失括号、字符串内 \`\\\\\` 未双写、多余逗号）后输出合法 JSON（\`pageOffset\` 与 \`regions\` 数组）：

\`\`\`text
${brokenTailSnippet || params.rawInput.slice(0, 260)}
\`\`\``;

  return {
    repairPrompt,
    salvagedRegions,
    brokenSnippet: brokenTailSnippet,
  };
}
