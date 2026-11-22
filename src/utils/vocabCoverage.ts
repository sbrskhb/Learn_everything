import type {
  Course,
  CourseVocabCoverageRecord,
  DailyLessonContent,
  DailyPlanSlot,
  EnglishReadingPlanStats,
  EnglishStep2GlossSummary,
  EnglishSynonymReplacementRecord,
  LanguageInputMode,
  SectionVocabCoverageRecord,
  SectionWordActualMatch,
  TargetLanguageCode,
  VocabItem,
  VocabManualVerification,
  VocabSemanticStatus,
} from '../types';
import { assignStableVocabIds, normalizeWordKey } from './learningLogic';

const IRREGULAR_WORD_FORMS: Record<string, string[]> = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done', 'doing'],
  go: ['goes', 'went', 'gone', 'going'],
  come: ['comes', 'came', 'coming'],
  take: ['takes', 'took', 'taken', 'taking'],
  make: ['makes', 'made', 'making'],
  give: ['gives', 'gave', 'given', 'giving'],
  get: ['gets', 'got', 'gotten', 'getting'],
  see: ['sees', 'saw', 'seen', 'seeing'],
  know: ['knows', 'knew', 'known', 'knowing'],
  think: ['thinks', 'thought', 'thinking'],
  run: ['runs', 'ran', 'running'],
  write: ['writes', 'wrote', 'written', 'writing'],
  read: ['reads', 'reading'],
  grow: ['grows', 'grew', 'grown', 'growing'],
  draw: ['draws', 'drew', 'drawn', 'drawing'],
  drive: ['drives', 'drove', 'driven', 'driving'],
  rise: ['rises', 'rose', 'risen', 'rising'],
  arise: ['arises', 'arose', 'arisen', 'arising'],
  break: ['breaks', 'broke', 'broken', 'breaking'],
  choose: ['chooses', 'chose', 'chosen', 'choosing'],
  speak: ['speaks', 'spoke', 'spoken', 'speaking'],
  steal: ['steals', 'stole', 'stolen', 'stealing'],
  wear: ['wears', 'wore', 'worn', 'wearing'],
  bear: ['bears', 'bore', 'born', 'borne', 'bearing'],
  tear: ['tears', 'tore', 'torn', 'tearing'],
  fall: ['falls', 'fell', 'fallen', 'falling'],
  feel: ['feels', 'felt', 'feeling'],
  find: ['finds', 'found', 'finding'],
  hold: ['holds', 'held', 'holding'],
  keep: ['keeps', 'kept', 'keeping'],
  leave: ['leaves', 'left', 'leaving'],
  lead: ['leads', 'led', 'leading'],
  lose: ['loses', 'lost', 'losing'],
  meet: ['meets', 'met', 'meeting'],
  pay: ['pays', 'paid', 'paying'],
  say: ['says', 'said', 'saying'],
  seek: ['seeks', 'sought', 'seeking'],
  sell: ['sells', 'sold', 'selling'],
  send: ['sends', 'sent', 'sending'],
  set: ['sets', 'setting'],
  show: ['shows', 'showed', 'shown', 'showing'],
  sit: ['sits', 'sat', 'sitting'],
  stand: ['stands', 'stood', 'standing'],
  strike: ['strikes', 'struck', 'stricken', 'striking'],
  teach: ['teaches', 'taught', 'teaching'],
  tell: ['tells', 'told', 'telling'],
  understand: ['understands', 'understood', 'understanding'],
  win: ['wins', 'won', 'winning'],
  begin: ['begins', 'began', 'begun', 'beginning'],
  bring: ['brings', 'brought', 'bringing'],
  build: ['builds', 'built', 'building'],
  buy: ['buys', 'bought', 'buying'],
  catch: ['catches', 'caught', 'catching'],
  cost: ['costs', 'costing'],
  cut: ['cuts', 'cutting'],
  drink: ['drinks', 'drank', 'drunk', 'drinking'],
  eat: ['eats', 'ate', 'eaten', 'eating'],
  fight: ['fights', 'fought', 'fighting'],
  fly: ['flies', 'flew', 'flown', 'flying'],
  forget: ['forgets', 'forgot', 'forgotten', 'forgetting'],
  forgive: ['forgives', 'forgave', 'forgiven', 'forgiving'],
  freeze: ['freezes', 'froze', 'frozen', 'freezing'],
  hear: ['hears', 'heard', 'hearing'],
  hide: ['hides', 'hid', 'hidden', 'hiding'],
  hit: ['hits', 'hitting'],
  hurt: ['hurts', 'hurting'],
  lay: ['lays', 'laid', 'laying'],
  lie: ['lies', 'lay', 'lain', 'lying'],
  lend: ['lends', 'lent', 'lending'],
  let: ['lets', 'letting'],
  mean: ['means', 'meant', 'meaning'],
  put: ['puts', 'putting'],
  ride: ['rides', 'rode', 'ridden', 'riding'],
  ring: ['rings', 'rang', 'rung', 'ringing'],
  shake: ['shakes', 'shook', 'shaken', 'shaking'],
  shine: ['shines', 'shone', 'shining'],
  shoot: ['shoots', 'shot', 'shooting'],
  shut: ['shuts', 'shutting'],
  sing: ['sings', 'sang', 'sung', 'singing'],
  sink: ['sinks', 'sank', 'sunk', 'sinking'],
  sleep: ['sleeps', 'slept', 'sleeping'],
  slide: ['slides', 'slid', 'sliding'],
  spend: ['spends', 'spent', 'spending'],
  spread: ['spreads', 'spreading'],
  spring: ['springs', 'sprang', 'sprung', 'springing'],
  stick: ['sticks', 'stuck', 'sticking'],
  swear: ['swears', 'swore', 'sworn', 'swearing'],
  sweep: ['sweeps', 'swept', 'sweeping'],
  swim: ['swims', 'swam', 'swum', 'swimming'],
  throw: ['throws', 'threw', 'thrown', 'throwing'],
  wake: ['wakes', 'woke', 'woken', 'waking'],
  weave: ['weaves', 'wove', 'woven', 'weaving'],
  wind: ['winds', 'wound', 'winding'],
  withdraw: ['withdraws', 'withdrew', 'withdrawn', 'withdrawing'],
  undergo: ['undergoes', 'underwent', 'undergone', 'undergoing'],
  undertake: ['undertakes', 'undertook', 'undertaken', 'undertaking'],
  overcome: ['overcomes', 'overcame', 'overcoming'],
  withstand: ['withstands', 'withstood', 'withstanding'],
  bind: ['binds', 'bound', 'binding'],
  child: ['children'],
  person: ['people', 'persons'],
  man: ['men'],
  woman: ['women'],
  foot: ['feet'],
  tooth: ['teeth'],
  mouse: ['mice'],
  criterion: ['criteria'],
  criteria: ['criterion'],
  phenomenon: ['phenomena'],
  phenomena: ['phenomenon'],
  analysis: ['analyses'],
  analyses: ['analysis'],
  basis: ['bases'],
  crisis: ['crises'],
  hypothesis: ['hypotheses'],
  hypotheses: ['hypothesis'],
  thesis: ['theses'],
  medium: ['media', 'mediums'],
  datum: ['data'],
  curriculum: ['curricula', 'curriculums'],
  stimulus: ['stimuli'],
  index: ['indices', 'indexes'],
  appendix: ['appendices', 'appendixes'],
  focus: ['foci', 'focuses'],
  radius: ['radii', 'radiuses'],
  leaf: ['leaves'],
  life: ['lives'],
  knife: ['knives'],
  wife: ['wives'],
  shelf: ['shelves'],
  wolf: ['wolves'],
  half: ['halves'],
  self: ['selves'],
  good: ['better', 'best'],
  bad: ['worse', 'worst'],
  far: ['farther', 'further', 'farthest', 'furthest'],
  little: ['less', 'least'],
  much: ['more', 'most'],
  many: ['more', 'most'],
};

const HOMOGRAPH_WORDS = new Set<string>([
  'address', 'attribute', 'bank', 'bark', 'bat', 'bear', 'bow', 'cell', 'charge',
  'close', 'compound', 'conduct', 'content', 'contract', 'current', 'date',
  'decline', 'deliberate', 'desert', 'digest', 'draft', 'elaborate', 'fair',
  'fast', 'file', 'fine', 'firm', 'flat', 'ground', 'interest', 'invalid',
  'issue', 'lead', 'lean', 'leave', 'left', 'letter', 'lie', 'light', 'live',
  'log', 'match', 'matter', 'mean', 'medium', 'mine', 'minor', 'minute',
  'monitor', 'novel', 'object', 'objective', 'order', 'park', 'party',
  'passage', 'patient', 'peer', 'permit', 'pitch', 'plain', 'plane', 'plant',
  'plot', 'point', 'pool', 'port', 'post', 'pound', 'present', 'press', 'prime',
  'principal', 'produce', 'project', 'pupil', 'quarter', 'race', 'range',
  'record', 'refuse', 'register', 'reserve', 'resort', 'rest', 'resume',
  'right', 'ring', 'rock', 'rose', 'row', 'rule', 'run', 'scale', 'seal',
  'season', 'second', 'sentence', 'set', 'shed', 'shift', 'sink', 'sound',
  'spring', 'square', 'stable', 'staff', 'stage', 'stake', 'stamp', 'stand',
  'state', 'stem', 'stick', 'still', 'stock', 'strain', 'strike', 'strip',
  'subject', 'suit', 'suspect', 'table', 'tap', 'tear', 'term', 'tie', 'tip',
  'tone', 'trace', 'track', 'train', 'treat', 'trip', 'trunk', 'type',
  'vessel', 'volume', 'watch', 'wave', 'well', 'will', 'wind', 'wound', 'yield',
]);

const AMBIGUOUS_INFLECTIONS = new Set<string>([
  'found', 'rose', 'saw', 'left', 'leaves', 'lay', 'wound', 'bound', 'felt',
  'ground', 'axes', 'bases', 'tears', 'bears', 'mines', 'flies', 'lies',
]);

/**
 * Determine which of the 4 input combinations a language course uses.
 */
export function resolveLanguageInputMode(
  effectiveWordsCount: number,
  materialsCount: number
): LanguageInputMode {
  const hasVocab = effectiveWordsCount > 0;
  const hasMaterials = materialsCount > 0;
  if (hasVocab && hasMaterials) return 'vocab_and_material';
  if (hasVocab) return 'vocab_only';
  if (hasMaterials) return 'material_only';
  return 'ai_autonomous';
}

/**
 * Deterministic English vocabulary-driven reading calculation (independent of study days).
 */
export function computeEnglishReadingPlanStats(params: {
  effectiveTotal: number;
  newWordsPerArticle: number;
  targetWordDensity: number;
  expectedRepeatsPerWord?: number;
}): EnglishReadingPlanStats {
  const effectiveTotal = Math.max(0, Math.floor(params.effectiveTotal || 0));
  const newWordsPerArticle = Math.max(1, Math.min(100, Math.round(params.newWordsPerArticle || 15)));
  const rawDensity = Number(params.targetWordDensity);
  const targetWordDensity =
    Number.isFinite(rawDensity) && rawDensity > 0
      ? Math.max(0.005, Math.min(0.25, rawDensity))
      : 0.04;
  const rawRepeats = Number(params.expectedRepeatsPerWord);
  const expectedRepeatsPerWord =
    Number.isFinite(rawRepeats) && rawRepeats >= 1 ? Math.min(10, rawRepeats) : 2;

  const estimatedArticleCount =
    effectiveTotal > 0 ? Math.ceil(effectiveTotal / newWordsPerArticle) : 0;
  const expectedOccurrencesPerArticle = Math.round(newWordsPerArticle * expectedRepeatsPerWord * 10) / 10;
  const estimatedArticleWordLength = Math.max(
    120,
    Math.round(expectedOccurrencesPerArticle / targetWordDensity)
  );
  const minWordLength = Math.max(100, Math.round(estimatedArticleWordLength * 0.8));
  const maxWordLength = Math.max(minWordLength + 80, Math.round(estimatedArticleWordLength * 1.2));
  const densityPct = Math.round(targetWordDensity * 1000) / 10;

  const message =
    effectiveTotal > 0
      ? `待学目标词 ${effectiveTotal} 词 ÷ 每篇引入 ${newWordsPerArticle} 新词 ≈ 预计 ${estimatedArticleCount} 篇文章；按目标词密度 ${densityPct}%（预计每词复现 ${expectedRepeatsPerWord} 次）推算，参考文章长度约 ${estimatedArticleWordLength} 词（自然浮动 ${minWordLength}~${maxWordLength} 词，优先保证语义自然连贯）。`
      : `当前未提供待学词库；若后续补充词库，将按每篇引入 ${newWordsPerArticle} 新词与目标词密度 ${densityPct}% 推算预计文章数与参考长度。`;

  return {
    effectiveTotal,
    newWordsPerArticle,
    targetWordDensity,
    expectedRepeatsPerWord,
    estimatedArticleCount,
    expectedOccurrencesPerArticle,
    estimatedArticleWordLength,
    minWordLength,
    maxWordLength,
    message,
  };
}

/**
 * Build case-insensitive inflection forms for a single lowercase English word.
 */
export function buildEnglishInflectionForms(word: string, meaning?: string): Set<string> {
  const base = normalizeWordKey(word);
  const forms = new Set<string>();
  if (!base) return forms;
  forms.add(base);

  if (IRREGULAR_WORD_FORMS[base]) {
    for (const f of IRREGULAR_WORD_FORMS[base]) {
      forms.add(f);
    }
  }

  // Spelling variants (-ize <-> -ise, -yze <-> -yse)
  const candidates = new Set<string>([base]);
  if (/ize$/.test(base)) candidates.add(base.replace(/ize$/, 'ise'));
  if (/ise$/.test(base)) candidates.add(base.replace(/ise$/, 'ize'));
  if (/yze$/.test(base)) candidates.add(base.replace(/yze$/, 'yse'));
  if (/yse$/.test(base)) candidates.add(base.replace(/yse$/, 'yze'));

  for (const w of candidates) {
    forms.add(w);
    if (!/^[a-z][a-z'-]*$/.test(w) || w.length < 2) continue;

    // Plural / 3rd-person singular (-s / -es / -ies / -ves)
    if (/(?:s|sh|ch|x|z)$/.test(w)) {
      forms.add(`${w}es`);
    } else if (/[^aeiou]y$/.test(w)) {
      forms.add(`${w.slice(0, -1)}ies`);
    } else if (/f$/.test(w)) {
      forms.add(`${w}s`);
      forms.add(`${w.slice(0, -1)}ves`);
    } else if (/fe$/.test(w)) {
      forms.add(`${w}s`);
      forms.add(`${w.slice(0, -2)}ves`);
    } else if (/o$/.test(w)) {
      forms.add(`${w}s`);
      forms.add(`${w}es`);
    } else {
      forms.add(`${w}s`);
    }

    // Past (-ed) and progressive (-ing)
    if (/ie$/.test(w)) {
      forms.add(`${w}d`);
      forms.add(`${w.slice(0, -2)}ying`);
    } else if (/(?:ee|oe|ye)$/.test(w)) {
      forms.add(`${w}d`);
      forms.add(`${w}ing`);
    } else if (/e$/.test(w)) {
      forms.add(`${w}d`);
      forms.add(`${w.slice(0, -1)}ing`);
    } else if (/[^aeiou]y$/.test(w)) {
      forms.add(`${w.slice(0, -1)}ied`);
      forms.add(`${w}ing`);
    } else if (/[aeiou]c$/.test(w)) {
      forms.add(`${w}ked`);
      forms.add(`${w}king`);
    } else {
      forms.add(`${w}ed`);
      forms.add(`${w}ing`);
      // CVC final consonant doubling (e.g. compel -> compelled, stop -> stopped, focus -> focussed)
      if (w.length >= 3 && /[bcdfghjklmnpqrstvwxyz][aeiou][bcdfgjklmnprstvz]$/.test(w)) {
        const last = w[w.length - 1];
        forms.add(`${w}${last}ed`);
        forms.add(`${w}${last}ing`);
      }
    }

    // Comparative / superlative (-er / -est) only for likely adjectives/adverbs
    const meaningLower = (meaning || '').toLowerCase();
    const explicitlyAdjOrAdv = /\b(?:adj|adv)\b/.test(meaningLower);
    const explicitlyNonAdj = /\b(?:v|vt|vi|n|prep|conj)\b/.test(meaningLower) && !explicitlyAdjOrAdv;
    const shouldGenerateDegree =
      explicitlyAdjOrAdv || (!explicitlyNonAdj && w.length <= 7 && !IRREGULAR_WORD_FORMS[w]);
    if (shouldGenerateDegree) {
      if (/e$/.test(w)) {
        forms.add(`${w}r`);
        forms.add(`${w}st`);
      } else if (/[^aeiou]y$/.test(w)) {
        forms.add(`${w.slice(0, -1)}ier`);
        forms.add(`${w.slice(0, -1)}iest`);
      } else {
        forms.add(`${w}er`);
        forms.add(`${w}est`);
        if (w.length >= 3 && /[bcdfghjklmnpqrstvwxyz][aeiou][bcdfgjklmnprstvz]$/.test(w)) {
          const last = w[w.length - 1];
          forms.add(`${w}${last}er`);
          forms.add(`${w}${last}est`);
        }
      }
    }
  }

  return forms;
}

/**
 * Extract ONLY body prose from a lesson so words listed solely in vocab tables, prompts,
 * notes, exercises, or metadata are NOT counted toward actual body usage.
 */
export function extractLessonProseForCoverage(
  lesson?: DailyLessonContent | null,
  _targetLanguage: TargetLanguageCode = 'english'
): string {
  if (!lesson) return '';

  const paragraphs = Array.isArray(lesson.englishPayload?.paragraphs)
    ? lesson.englishPayload.paragraphs
        .map((p) => (typeof p?.english === 'string' ? p.english.trim() : ''))
        .filter(Boolean)
    : [];

  if (paragraphs.length > 0) {
    return paragraphs.join('\n\n');
  }

  // Fallback for non-English or markdown-only lessons: strip vocab glossary sections & metadata
  let body = lesson.markdownBody || '';
  if (!body.trim()) return '';

  body = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\{\{[^}]+\}\}/g, ' ')
    .replace(/\[!(?:PREREQ|INTUITION|TEXTBOOK|EXTENSION)\]/gi, ' ');

  const lines = body.split(/\r?\n/);
  const keptLines: string[] = [];
  let skipHeadingLevel = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      if (skipHeadingLevel > 0 && level <= skipHeadingLevel) {
        skipHeadingLevel = 0;
      }
      if (
        /(?:词汇|生词|单词|词表|词汇表|Vocabulary|Word\s*List|Glossary|New\s*Words|単語|語彙)/i.test(
          headingText
        )
      ) {
        skipHeadingLevel = level;
        continue;
      }
    }
    if (skipHeadingLevel > 0) continue;

    const trimmed = line.trim();
    // Exclude markdown table rows and glossary bullet lines ("- word /ipa/ meaning" or "- word: meaning")
    if (trimmed.startsWith('|')) continue;
    if (
      /^[-*•]\s+\*{0,2}[A-Za-z][A-Za-z\s'-]*\*{0,2}\s*(?:\/[^/]+\/|\[[^\]]+\]|\([^)]*\))?\s*[:：\-—]\s*.+$/.test(
        trimmed
      )
    ) {
      continue;
    }

    keptLines.push(line);
  }

  return keptLines.join('\n').trim();
}

export interface ProseToken {
  raw: string;
  cleanLower: string;
  baseLower: string;
  isCapitalized: boolean;
  isSentenceStart: boolean;
  start: number;
  end: number;
  sentence: string;
}

function splitSentenceAt(text: string, start: number, end: number): string {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const leftIdx = Math.max(
    before.lastIndexOf('.'),
    before.lastIndexOf('!'),
    before.lastIndexOf('?'),
    before.lastIndexOf('。'),
    before.lastIndexOf('\n')
  );
  const rightMatch = after.search(/[.!?。\n]/);
  const sStart = leftIdx >= 0 ? leftIdx + 1 : 0;
  const sEnd = rightMatch >= 0 ? end + rightMatch + 1 : text.length;
  return text.slice(sStart, sEnd).replace(/\s+/g, ' ').trim();
}

export function tokenizeEnglishProse(prose: string): ProseToken[] {
  const tokens: ProseToken[] = [];
  if (!prose) return tokens;

  const regex = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
  let prevEnd = 0;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(prose)) !== null) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    const gap = prose.slice(prevEnd, start);
    const isSentenceStart =
      prevEnd === 0 ||
      /(?:^|\n|[.!?]\s*["”’')\]]*\s*)$/.test(gap) ||
      /[.!?]\s*$/.test(gap) ||
      gap.includes('\n');
    const cleanLower = raw.toLowerCase();
    const baseLower = cleanLower.replace(/['’]s$/i, '');
    const isCapitalized = /^[A-Z][a-z]/.test(raw);
    tokens.push({
      raw,
      cleanLower,
      baseLower,
      isCapitalized,
      isSentenceStart,
      start,
      end,
      sentence: splitSentenceAt(prose, start, end),
    });
    prevEnd = end;
  }
  return tokens;
}

export function countProseWords(prose: string, _targetLanguage?: TargetLanguageCode): number {
  if (!prose.trim()) return 0;
  const latinWords = prose.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length || 0;
  const nonSpaceCjk = prose.replace(/[\s\p{P}\p{S}A-Za-z0-9]/gu, '').length;
  return latinWords + nonSpaceCjk;
}

function buildJapaneseForms(word: string): string[] {
  const clean = word.trim();
  if (!clean) return [];
  const forms = [clean];
  // Simple Japanese verb stem relaxation for ichidan/godan dictionary endings
  if (clean.length >= 2 && /[るうくぐすつぬぶむ]$/.test(clean)) {
    const stem = clean.slice(0, -1);
    if (stem.length >= 1) {
      forms.push(stem);
    }
  }
  return Array.from(new Set(forms));
}

function simpleSnippetHash(snippets: string[]): string {
  const joined = snippets.join('|');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/**
 * Match a single VocabItem against extracted prose using boundary-aware token & inflection matching.
 */
export function matchVocabItemInProse(params: {
  item: VocabItem;
  prose: string;
  tokens: ProseToken[];
  targetLanguage: TargetLanguageCode;
}): {
  count: number;
  matchedForms: string[];
  snippets: string[];
  semanticStatus: VocabSemanticStatus;
  reviewReason?: string;
} {
  const { item, prose, tokens } = params;
  const wordClean = String(item.word || '').trim().replace(/\s+/g, ' ');
  if (!wordClean || !prose.trim()) {
    return { count: 0, matchedForms: [], snippets: [], semanticStatus: 'confirmed' };
  }

  // Non-Latin (e.g., Japanese / Chinese / Hangul) matching
  if (!/[A-Za-z]/.test(wordClean)) {
      const forms = buildJapaneseForms(wordClean);
      let count = 0;
      const matchedForms = new Set<string>();
      const snippets: string[] = [];
      const exactRegex = new RegExp(wordClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      for (const m of prose.matchAll(exactRegex)) {
        count++;
        matchedForms.add(m[0]);
        if (snippets.length < 3 && m.index !== undefined) {
          snippets.push(splitSentenceAt(prose, m.index, m.index + m[0].length));
        }
      }
      if (count === 0 && forms.length > 1) {
        const stem = forms[1];
        const stemRegex = new RegExp(
          `${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[たてでますないようれらりるろくぐすつぬぶむ]|$)`,
          'g'
        );
        for (const m of prose.matchAll(stemRegex)) {
          count++;
          matchedForms.add(m[0]);
          if (snippets.length < 3 && m.index !== undefined) {
            snippets.push(splitSentenceAt(prose, m.index, m.index + m[0].length));
          }
        }
      }
      return {
        count,
        matchedForms: Array.from(matchedForms),
        snippets,
        semanticStatus: 'confirmed',
      };
  }

  const phraseParts = wordClean.split(/[\s-]+/).filter(Boolean);
  const lowerClean = wordClean.toLowerCase();

  // Single-word English match
  if (phraseParts.length <= 1) {
    const forms = buildEnglishInflectionForms(wordClean, item.meaning);
    const matchedForms = new Set<string>();
    const snippets: string[] = [];
    let count = 0;
    let onlyMidSentenceProperNoun = true;
    let sawAmbiguousInflection = false;

    for (const tok of tokens) {
      // Check both full baseLower and hyphen-split if target had no hyphen
      if (forms.has(tok.baseLower) || forms.has(tok.cleanLower)) {
        count++;
        matchedForms.add(tok.raw);
        if (snippets.length < 3 && !snippets.includes(tok.sentence)) {
          snippets.push(tok.sentence);
        }
        if (!(tok.isCapitalized && !tok.isSentenceStart)) {
          onlyMidSentenceProperNoun = false;
        }
        if (AMBIGUOUS_INFLECTIONS.has(tok.baseLower) && tok.baseLower !== lowerClean) {
          sawAmbiguousInflection = true;
        }
      }
    }

    if (count === 0) {
      return { count: 0, matchedForms: [], snippets: [], semanticStatus: 'confirmed' };
    }

    let semanticStatus: VocabSemanticStatus = 'confirmed';
    let reviewReason: string | undefined;

    if (HOMOGRAPH_WORDS.has(lowerClean)) {
      semanticStatus = 'needs_review';
      reviewReason = `「${wordClean}」属于常见同形异义/多义词，请结合语境例句确认语义是否吻合`;
    } else if (sawAmbiguousInflection) {
      semanticStatus = 'needs_review';
      reviewReason = `匹配到的词形（${Array.from(matchedForms).join('/')}）可能与其他词同形，请确认词义`;
    } else if (/^[a-z]/.test(wordClean) && onlyMidSentenceProperNoun) {
      semanticStatus = 'needs_review';
      reviewReason = `仅在句中以首字母大写专有名词形式出现（${Array.from(matchedForms).join('/')}），请确认是否符合目标词义`;
    }

    return {
      count,
      matchedForms: Array.from(matchedForms),
      snippets,
      semanticStatus,
      reviewReason,
    };
  }

  // Multi-word English phrase matching (contiguous + separable phrasal verbs)
  const partFormSets = phraseParts.map((part, idx) => {
    if (idx === 0 || idx === phraseParts.length - 1) {
      return buildEnglishInflectionForms(part);
    }
    return new Set<string>([part.toLowerCase()]);
  });

  const matchedForms = new Set<string>();
  const snippets: string[] = [];
  let count = 0;
  let lastMatchedEndTok = -1;

  for (let i = 0; i < tokens.length; i++) {
    if (i <= lastMatchedEndTok) continue;
    const firstTok = tokens[i];
    // Handle hyphenated single token vs space-separated tokens:
    // If prose has hyphenated token "long-term", tokenizeEnglishProse keeps "long-term" as one token!
    if (firstTok.baseLower.includes('-')) {
      const subParts = firstTok.baseLower.split('-');
      if (
        subParts.length === phraseParts.length &&
        subParts.every((sp, k) => partFormSets[k].has(sp))
      ) {
        count++;
        matchedForms.add(firstTok.raw);
        if (snippets.length < 3 && !snippets.includes(firstTok.sentence)) {
          snippets.push(firstTok.sentence);
        }
        lastMatchedEndTok = i;
        continue;
      }
    }

    if (!partFormSets[0].has(firstTok.baseLower)) continue;

    // 1. Try contiguous match across tokens[i .. i + len - 1]
    if (i + phraseParts.length <= tokens.length) {
      let contiguousOk = true;
      for (let k = 1; k < phraseParts.length; k++) {
        const gap = prose.slice(tokens[i + k - 1].end, tokens[i + k].start);
        if (/[.!?;:\n]/.test(gap) || !partFormSets[k].has(tokens[i + k].baseLower)) {
          contiguousOk = false;
          break;
        }
      }
      if (contiguousOk) {
        const endTok = tokens[i + phraseParts.length - 1];
        count++;
        matchedForms.add(prose.slice(firstTok.start, endTok.end));
        if (snippets.length < 3 && !snippets.includes(firstTok.sentence)) {
          snippets.push(firstTok.sentence);
        }
        lastMatchedEndTok = i + phraseParts.length - 1;
        continue;
      }
    }

    // 2. Try separable phrasal verb match (1~3 non-punctuation words inserted after tokens[i])
    for (let gapCount = 1; gapCount <= 3; gapCount++) {
      const restStart = i + 1 + gapCount;
      if (restStart + phraseParts.length - 1 > tokens.length) break;
      const gapText = prose.slice(firstTok.end, tokens[restStart].start);
      if (/[.!?;:\n,]/.test(gapText)) break;

      let restOk = true;
      for (let k = 1; k < phraseParts.length; k++) {
        const tokIdx = restStart + k - 1;
        if (k > 1) {
          const innerGap = prose.slice(tokens[tokIdx - 1].end, tokens[tokIdx].start);
          if (/[.!?;:\n]/.test(innerGap)) {
            restOk = false;
            break;
          }
        }
        if (!partFormSets[k].has(tokens[tokIdx].baseLower)) {
          restOk = false;
          break;
        }
      }

      if (restOk) {
        const endTokIdx = restStart + phraseParts.length - 2;
        const endTok = tokens[endTokIdx];
        count++;
        matchedForms.add(prose.slice(firstTok.start, endTok.end));
        if (snippets.length < 3 && !snippets.includes(firstTok.sentence)) {
          snippets.push(firstTok.sentence);
        }
        lastMatchedEndTok = endTokIdx;
        break;
      }
    }
  }

  if (count === 0) {
    return { count: 0, matchedForms: [], snippets: [], semanticStatus: 'confirmed' };
  }

  return {
    count,
    matchedForms: Array.from(matchedForms),
    snippets,
    semanticStatus: 'confirmed',
  };
}

function makeVerificationKey(sectionId: string, wordId: string): string {
  return `${sectionId}::${wordId}`;
}

/**
 * Resolve the list of planned new target words and prior review words for a specific section slot.
 */
export function resolveSlotWordIds(
  slot: DailyPlanSlot,
  vocabById: Map<string, VocabItem>,
  vocabByKey: Map<string, VocabItem>
): { newWordIds: string[]; reviewWordIds: string[] } {
  const newWordIds: string[] = [];
  const seenNew = new Set<string>();
  const pushNew = (id?: string) => {
    if (!id || seenNew.has(id)) return;
    if (vocabById.size > 0 && !vocabById.has(id)) return;
    seenNew.add(id);
    newWordIds.push(id);
  };

  if (Array.isArray(slot.targetWordIds) && slot.targetWordIds.length > 0) {
    for (const id of slot.targetWordIds) {
      pushNew(String(id).trim());
    }
  } else if (Array.isArray(slot.assignedWords) && slot.assignedWords.length > 0) {
    for (const w of slot.assignedWords) {
      if (w.id && vocabById.has(w.id)) {
        pushNew(w.id);
      } else {
        const matched = vocabByKey.get(normalizeWordKey(w.word));
        if (matched?.id) pushNew(matched.id);
      }
    }
  }

  const reviewWordIds: string[] = [];
  const seenRev = new Set<string>();
  if (Array.isArray(slot.reviewWordIds)) {
    for (const rawId of slot.reviewWordIds) {
      const id = String(rawId).trim();
      if (!id || seenNew.has(id) || seenRev.has(id)) continue;
      if (vocabById.size > 0 && !vocabById.has(id)) continue;
      seenRev.add(id);
      reviewWordIds.push(id);
    }
  }

  return { newWordIds, reviewWordIds };
}

/**
 * Return eligible prior words for review in `slotIndex`, grouped cleanly into:
 * - `prevSectionWords`: words learned in the immediately preceding section (`slotIndex - 1`),
 *   drawn from both planned target words and `lesson.englishPayload.targetWords` (so even
 *   courses without a preset vocab bank carry Section N-1 vocabulary into Section N).
 * - `earlierReviewWords`: explicit `slot.reviewWordIds` plus words from earlier sections
 *   ordered most-recent-first (`slotIndex - 2` down to `0`).
 * Never counts toward the current section's new-word quota.
 */
export function getGroupedReviewWordsForSlot(
  course: Course,
  slotIndex: number,
  options?: { maxPrevCount?: number; maxEarlierCount?: number }
): { prevSectionWords: VocabItem[]; earlierReviewWords: VocabItem[] } {
  const maxPrevCount = options?.maxPrevCount ?? 20;
  const maxEarlierCount = options?.maxEarlierCount ?? 16;
  const effectiveWords = assignStableVocabIds(course.englishConfig?.effectiveWords || []);
  const vocabById = new Map<string, VocabItem>();
  const vocabByKey = new Map<string, VocabItem>();
  for (const w of effectiveWords) {
    if (w.id) vocabById.set(w.id, w);
    vocabByKey.set(normalizeWordKey(w.word), w);
  }

  const currentSlot = course.dailyPlan[slotIndex];
  const currentResolved = currentSlot
    ? resolveSlotWordIds(currentSlot, vocabById, vocabByKey)
    : { newWordIds: [], reviewWordIds: [] };
  const currentNewIdSet = new Set(currentResolved.newWordIds);
  const currentNewKeySet = new Set<string>();
  for (const id of currentResolved.newWordIds) {
    const item = vocabById.get(id);
    if (item?.word) currentNewKeySet.add(normalizeWordKey(item.word));
  }
  for (const w of currentSlot?.assignedWords || []) {
    if (w?.word) currentNewKeySet.add(normalizeWordKey(w.word));
  }

  const isExcludedCurrentWord = (id?: string, word?: string): boolean => {
    if (id && currentNewIdSet.has(id)) return true;
    const key = word ? normalizeWordKey(word) : '';
    return Boolean(key && currentNewKeySet.has(key));
  };

  const prevSectionWords: VocabItem[] = [];
  const seenKeys = new Set<string>();
  const seenIds = new Set<string>();

  const pushCandidate = (target: VocabItem[], item: VocabItem | undefined, limit: number) => {
    if (!item || !item.word || target.length >= limit) return;
    const key = normalizeWordKey(item.word);
    if (!key) return;
    if (isExcludedCurrentWord(item.id, item.word)) return;
    if (seenKeys.has(key) || (item.id && seenIds.has(item.id))) return;
    seenKeys.add(key);
    if (item.id) seenIds.add(item.id);
    target.push(item);
  };

  const collectFromSlot = (
    slotItem: DailyPlanSlot | undefined,
    target: VocabItem[],
    limit: number
  ) => {
    if (!slotItem || target.length >= limit) return;
    const lessonWordByKey = new Map<string, VocabItem>();
    for (const lw of slotItem.lesson?.englishPayload?.targetWords || []) {
      const k = normalizeWordKey(lw.word);
      if (k && !lessonWordByKey.has(k)) lessonWordByKey.set(k, lw);
    }
    const enrichWithLesson = (base: VocabItem | undefined): VocabItem | undefined => {
      if (!base) return undefined;
      const lw = lessonWordByKey.get(normalizeWordKey(base.word));
      if (!lw) return base;
      return {
        ...lw,
        ...base,
        phonetic: base.phonetic || lw.phonetic,
        meaning:
          base.meaning && base.meaning !== '待结合语境学习'
            ? base.meaning
            : lw.meaning || base.meaning,
      };
    };

    const { newWordIds } = resolveSlotWordIds(slotItem, vocabById, vocabByKey);
    for (const id of newWordIds) {
      pushCandidate(target, enrichWithLesson(vocabById.get(id)), limit);
    }
    for (const w of slotItem.assignedWords || []) {
      const canonical =
        (w.id && vocabById.get(w.id)) || vocabByKey.get(normalizeWordKey(w.word)) || w;
      pushCandidate(target, enrichWithLesson(canonical), limit);
    }
    for (const w of slotItem.lesson?.englishPayload?.targetWords || []) {
      if (w.isReview) continue;
      const canonical = (w.id && vocabById.get(w.id)) || vocabByKey.get(normalizeWordKey(w.word));
      pushCandidate(
        target,
        canonical
          ? {
              ...canonical,
              ...w,
              id: canonical.id || w.id,
              meaning:
                canonical.meaning && canonical.meaning !== '待结合语境学习'
                  ? canonical.meaning
                  : w.meaning || canonical.meaning,
            }
          : w,
        limit
      );
    }
  };

  // 1. Immediately preceding section (slotIndex - 1) comes first
  if (slotIndex >= 1 && slotIndex - 1 < course.dailyPlan.length) {
    collectFromSlot(course.dailyPlan[slotIndex - 1], prevSectionWords, maxPrevCount);
  }

  // 2. Explicit reviewWordIds + earlier sections (most-recent first: slotIndex - 2 down to 0)
  const earlierReviewWords: VocabItem[] = [];
  for (const id of currentResolved.reviewWordIds) {
    pushCandidate(earlierReviewWords, vocabById.get(id), maxEarlierCount);
  }
  for (let i = Math.min(slotIndex - 2, course.dailyPlan.length - 1); i >= 0; i--) {
    collectFromSlot(course.dailyPlan[i], earlierReviewWords, maxEarlierCount);
  }

  return { prevSectionWords, earlierReviewWords };
}

/**
 * Return eligible prior words for review in `slotIndex` (immediately preceding section first,
 * followed by earlier sections and explicit `reviewWordIds`). Never counts toward new-word quota.
 */
export function getEligibleReviewWordsForSlot(
  course: Course,
  slotIndex: number,
  maxCount = 24
): VocabItem[] {
  const { prevSectionWords, earlierReviewWords } = getGroupedReviewWordsForSlot(course, slotIndex, {
    maxPrevCount: maxCount,
    maxEarlierCount: maxCount,
  });
  return [...prevSectionWords, ...earlierReviewWords].slice(0, maxCount);
}

/**
 * Synchronize and deterministically recompute both layers of vocabulary coverage on a Course:
 * - Layer 1 (Planned): checks targetWordIds assigned in outline, lists unassigned word IDs.
 * - Layer 2 (Actual): inspects generated lesson prose (excluding vocab tables/metadata),
 *   applies inflection/phrase/homograph rules, preserves valid manual/AI confirmations,
 *   and prevents duplicate counting or stale data.
 */
export function syncCourseVocabCoverage(course: Course): CourseVocabCoverageRecord | undefined {
  if (!course.englishConfig) return undefined;

  const targetLanguage: TargetLanguageCode = course.englishConfig.targetLanguage || 'english';
  const effectiveWords = assignStableVocabIds(course.englishConfig.effectiveWords || []);
  course.englishConfig.effectiveWords = effectiveWords;

  const vocabById = new Map<string, VocabItem>();
  const vocabByKey = new Map<string, VocabItem>();
  for (const item of effectiveWords) {
    if (item.id) vocabById.set(item.id, item);
    vocabByKey.set(normalizeWordKey(item.word), item);
  }

  const existingVerifications: Record<string, VocabManualVerification> = {
    ...(course.englishConfig.vocabCoverage?.verifications || {}),
  };
  const validVerifications: Record<string, VocabManualVerification> = {};
  const nowIso = new Date().toISOString();

  const allTargetIds = effectiveWords.map((w) => w.id!).filter(Boolean);
  const needsIncidentalScan = (course.dailyPlan || []).some(
    (s) => Boolean(s.lesson && s.lesson.generationStage !== 'stage1_content')
  );
  const precomputedFirstPartForms = new Map<string, Set<string>>();
  if (needsIncidentalScan) {
    for (const item of effectiveWords) {
      if (!item.id) continue;
      const clean = String(item.word || '').trim().replace(/\s+/g, ' ');
      if (!clean) continue;
      const parts = clean.split(/[\s-]+/).filter(Boolean);
      const keyToken = parts[0] || clean;
      if (/[A-Za-z]/.test(keyToken)) {
        precomputedFirstPartForms.set(
          item.id,
          buildEnglishInflectionForms(keyToken, parts.length <= 1 ? item.meaning : undefined)
        );
      }
    }
  }

  // Deduplicate "first introduced" across ordered sections:
  // If a word ID was already introduced in an earlier section, move it to reviewWordIds.
  const introducedSoFar = new Set<string>();
  const plannedWordIds: string[] = [];
  const bySection: Record<string, SectionVocabCoverageRecord> = {};
  const actualCoveredSet = new Set<string>();
  const actualUncertainSet = new Set<string>();

  for (let sIdx = 0; sIdx < (course.dailyPlan || []).length; sIdx++) {
    const slot = course.dailyPlan[sIdx];
    const sectionId = slot.id || `sec-${String(slot.dayIndex || sIdx + 1).padStart(2, '0')}`;
    const resolved = resolveSlotWordIds(slot, vocabById, vocabByKey);

    const cleanNewIds: string[] = [];
    const cleanReviewIds: string[] = [...resolved.reviewWordIds];
    for (const id of resolved.newWordIds) {
      if (!introducedSoFar.has(id)) {
        introducedSoFar.add(id);
        cleanNewIds.push(id);
        plannedWordIds.push(id);
      } else if (!cleanReviewIds.includes(id)) {
        cleanReviewIds.push(id);
      }
    }

    // Keep slot fields normalized without overriding legacy slots that have no words
    if (cleanNewIds.length > 0 || (Array.isArray(slot.targetWordIds) && slot.targetWordIds.length > 0)) {
      slot.targetWordIds = cleanNewIds;
      slot.assignedWords = cleanNewIds
        .map((id) => vocabById.get(id))
        .filter((w): w is VocabItem => Boolean(w));
    }
    if (cleanReviewIds.length > 0) {
      slot.reviewWordIds = cleanReviewIds;
    }

    // Also allow incidental detection of prior introduced words even if not explicitly listed in reviewWordIds
    const priorIntroducedIds = Array.from(introducedSoFar).filter((id) => !cleanNewIds.includes(id));

    const hasLesson = Boolean(slot.lesson && slot.lesson.generationStage !== 'stage1_content');
    const prose = hasLesson ? extractLessonProseForCoverage(slot.lesson, targetLanguage) : '';
    const tokens = prose && /[A-Za-z]/.test(prose) ? tokenizeEnglishProse(prose) : [];
    const proseWordCount = countProseWords(prose, targetLanguage);

    const matches: SectionWordActualMatch[] = [];
    const coveredNewWordIds: string[] = [];
    const missingNewWordIds: string[] = [];
    const uncertainNewWordIds: string[] = [];
    let actualTargetOccurrences = 0;

    if (hasLesson && effectiveWords.length > 0) {
      const checkIds: Array<{ id: string; role: 'new' | 'review' | 'incidental' }> = [];
      const checkedSet = new Set<string>();
      for (const id of cleanNewIds) {
        if (!checkedSet.has(id)) {
          checkedSet.add(id);
          checkIds.push({ id, role: 'new' });
        }
      }
      for (const id of cleanReviewIds) {
        if (!checkedSet.has(id)) {
          checkedSet.add(id);
          checkIds.push({ id, role: 'review' });
        }
      }
      for (const id of priorIntroducedIds) {
        if (!checkedSet.has(id)) {
          checkedSet.add(id);
          checkIds.push({ id, role: 'incidental' });
        }
      }

      // Also detect any remaining target bank words appearing incidentally in prose
      const proseTokenSet = new Set<string>();
      for (const tok of tokens) {
        proseTokenSet.add(tok.baseLower);
        proseTokenSet.add(tok.cleanLower);
        if (tok.baseLower.includes('-')) {
          for (const sub of tok.baseLower.split('-')) {
            if (sub) proseTokenSet.add(sub);
          }
        }
      }
      for (const item of effectiveWords) {
        const id = item.id;
        if (!id || checkedSet.has(id)) continue;
        if (/[A-Za-z]/.test(item.word)) {
          const forms = precomputedFirstPartForms.get(id);
          if (!forms) continue;
          let maybeHit = false;
          for (const f of forms) {
            if (proseTokenSet.has(f)) {
              maybeHit = true;
              break;
            }
          }
          if (!maybeHit) continue;
        } else {
          const clean = String(item.word || '').trim();
          if (!clean) continue;
          const stem = clean.length >= 2 ? clean.slice(0, -1) : clean;
          if (!prose.includes(clean) && !prose.includes(stem)) continue;
        }
        checkedSet.add(id);
        checkIds.push({ id, role: 'incidental' });
      }

      for (const entry of checkIds) {
        const item = vocabById.get(entry.id);
        if (!item) continue;
        const matchRes = matchVocabItemInProse({
          item,
          prose,
          tokens,
          targetLanguage,
        });

        if (matchRes.count === 0) {
          if (entry.role === 'new') {
            missingNewWordIds.push(entry.id);
          }
          continue;
        }

        const vKey = makeVerificationKey(sectionId, entry.id);
        const sHash = simpleSnippetHash(matchRes.snippets);
        const existingVerif = existingVerifications[vKey];
        let semanticStatus: VocabSemanticStatus = matchRes.semanticStatus;
        let reviewReason = matchRes.reviewReason;

        if (existingVerif && (!existingVerif.snippetHash || existingVerif.snippetHash === sHash)) {
          validVerifications[vKey] = existingVerif;
          semanticStatus = existingVerif.status;
          if (existingVerif.reason) {
            reviewReason = existingVerif.reason;
          } else if (existingVerif.status === 'confirmed') {
            reviewReason = `已由${existingVerif.reviewer === 'ai' ? 'AI 复核' : '人工'}确认语义匹配`;
          } else if (existingVerif.status === 'rejected') {
            reviewReason = `已标记为语境词义不符`;
          }
        }

        if (semanticStatus !== 'rejected') {
          actualTargetOccurrences += matchRes.count;
        }

        matches.push({
          wordId: entry.id,
          word: item.word,
          role: entry.role,
          count: matchRes.count,
          matchedForms: matchRes.matchedForms,
          snippets: matchRes.snippets,
          semanticStatus,
          reviewReason,
        });

        if (semanticStatus === 'confirmed') {
          actualCoveredSet.add(entry.id);
          if (entry.role === 'new') coveredNewWordIds.push(entry.id);
        } else if (semanticStatus === 'needs_review') {
          actualUncertainSet.add(entry.id);
          if (entry.role === 'new') uncertainNewWordIds.push(entry.id);
        } else if (entry.role === 'new') {
          missingNewWordIds.push(entry.id);
        }
      }
    } else {
      missingNewWordIds.push(...cleanNewIds);
    }

    const actualDensity =
      proseWordCount > 0 ? Math.round((actualTargetOccurrences / proseWordCount) * 10000) / 10000 : 0;

    bySection[sectionId] = {
      sectionId,
      plannedNewWordIds: cleanNewIds,
      plannedReviewWordIds: cleanReviewIds,
      hasLesson,
      proseWordCount,
      actualTargetOccurrences,
      actualDensity,
      matches,
      coveredNewWordIds,
      missingNewWordIds,
      uncertainNewWordIds,
      updatedAt: nowIso,
    };
  }

  // Confirmed coverage takes precedence over uncertain if another section already confirmed that word ID
  for (const confirmedId of actualCoveredSet) {
    actualUncertainSet.delete(confirmedId);
  }

  const plannedSet = new Set(plannedWordIds);
  const unassignedWordIds = allTargetIds.filter((id) => !plannedSet.has(id));
  const actualCoveredWordIds = allTargetIds.filter((id) => actualCoveredSet.has(id));
  const actualUncertainWordIds = allTargetIds.filter((id) => actualUncertainSet.has(id));
  const actualUncoveredWordIds = allTargetIds.filter(
    (id) => !actualCoveredSet.has(id) && !actualUncertainSet.has(id)
  );

  const totalTargetWords = allTargetIds.length;
  const plannedCoverageRate =
    totalTargetWords > 0 ? Math.round((plannedWordIds.length / totalTargetWords) * 1000) / 10 : 0;
  const actualCoverageRate =
    totalTargetWords > 0 ? Math.round((actualCoveredWordIds.length / totalTargetWords) * 1000) / 10 : 0;

  const coverage: CourseVocabCoverageRecord = {
    totalTargetWords,
    plannedWordIds,
    unassignedWordIds,
    plannedCoverageRate,
    actualCoveredWordIds,
    actualUncertainWordIds,
    actualUncoveredWordIds,
    actualCoverageRate,
    bySection,
    verifications: validVerifications,
    updatedAt: nowIso,
  };

  course.englishConfig.vocabCoverage = coverage;
  return coverage;
}

/**
 * Reassign unassigned or uncovered target word IDs into pending (unstarted) sections,
 * or optionally append new supplementary reading sections when no pending slots remain.
 */
export function reassignVocabWordsToCourse(
  course: Course,
  options?: {
    scope?: 'unassigned' | 'uncovered' | 'both';
    appendSupplementarySections?: boolean;
    wordsPerSection?: number;
  }
): {
  reassignedCount: number;
  appendedSectionsCount: number;
  coverage: CourseVocabCoverageRecord | undefined;
} {
  if (!course.englishConfig) {
    return { reassignedCount: 0, appendedSectionsCount: 0, coverage: undefined };
  }

  const preCoverage = syncCourseVocabCoverage(course);
  if (!preCoverage) {
    return { reassignedCount: 0, appendedSectionsCount: 0, coverage: undefined };
  }

  const scope = options?.scope || 'both';
  const candidateIdsSet = new Set<string>();
  if (scope === 'unassigned' || scope === 'both') {
    for (const id of preCoverage.unassignedWordIds) candidateIdsSet.add(id);
  }
  if (scope === 'uncovered' || scope === 'both') {
    // Only pick uncovered words that aren't already scheduled in a future ungenerated slot
    const scheduledPendingSet = new Set<string>();
    for (const slot of course.dailyPlan) {
      if (slot.lesson) continue;
      for (const id of slot.targetWordIds || []) scheduledPendingSet.add(id);
    }
    for (const id of preCoverage.actualUncoveredWordIds) {
      if (!scheduledPendingSet.has(id)) candidateIdsSet.add(id);
    }
  }

  const candidateIds = Array.from(candidateIdsSet);
  if (candidateIds.length === 0) {
    return { reassignedCount: 0, appendedSectionsCount: 0, coverage: preCoverage };
  }

  const effectiveWords = assignStableVocabIds(course.englishConfig.effectiveWords || []);
  const vocabById = new Map<string, VocabItem>();
  for (const w of effectiveWords) {
    if (w.id) vocabById.set(w.id, w);
  }

  // Detach uncovered words from already-generated slots so they can be cleanly reintroduced as new words
  const moveSet = new Set(candidateIds);
  for (const slot of course.dailyPlan) {
    if (!slot.lesson) continue;
    const removedKeys = new Set<string>();
    if (Array.isArray(slot.targetWordIds)) {
      slot.targetWordIds = slot.targetWordIds.filter((id) => {
        if (!moveSet.has(id)) return true;
        const w = vocabById.get(id);
        if (w) removedKeys.add(normalizeWordKey(w.word));
        return false;
      });
    }
    if (Array.isArray(slot.assignedWords)) {
      slot.assignedWords = slot.assignedWords.filter(
        (w) => !(w.id && moveSet.has(w.id)) && !removedKeys.has(normalizeWordKey(w.word))
      );
    }
  }

  const perSection = Math.max(
    1,
    Math.min(
      100,
      Math.round(
        options?.wordsPerSection ||
          course.englishConfig.newWordsPerArticle ||
          course.englishConfig.dailyWordCount ||
          15
      )
    )
  );

  let cursor = 0;
  let reassignedCount = 0;
  let appendedSectionsCount = 0;

  // 1. Fill existing unstarted sections up to `perSection` words
  for (const slot of course.dailyPlan) {
    if (cursor >= candidateIds.length) break;
    if (slot.lesson) continue;
    const currentIds = Array.isArray(slot.targetWordIds) ? [...slot.targetWordIds] : [];
    const currentSet = new Set(currentIds);
    const capacity = Math.max(0, perSection - currentIds.length);
    for (let k = 0; k < capacity && cursor < candidateIds.length; k++) {
      const nextId = candidateIds[cursor++];
      if (!currentSet.has(nextId)) {
        currentIds.push(nextId);
        currentSet.add(nextId);
        reassignedCount++;
      }
    }
    slot.targetWordIds = currentIds;
    slot.assignedWords = currentIds
      .map((id) => vocabById.get(id))
      .filter((w): w is VocabItem => Boolean(w));
  }

  // 2. Append supplementary sections if still remaining and allowed
  const appendAllowed = options?.appendSupplementarySections !== false;
  if (cursor < candidateIds.length && appendAllowed) {
    while (cursor < candidateIds.length) {
      const sliceIds = candidateIds.slice(cursor, cursor + perSection);
      cursor += sliceIds.length;
      reassignedCount += sliceIds.length;
      appendedSectionsCount++;

      const nextIdx = course.dailyPlan.length + 1;
      const nextId = `sec-${String(nextIdx).padStart(2, '0')}`;
      const sampleWords = sliceIds
        .slice(0, 3)
        .map((id) => vocabById.get(id)?.word)
        .filter(Boolean)
        .join(', ');

      course.dailyPlan.push({
        id: nextId,
        dayIndex: nextIdx,
        date: course.startDate,
        topicGroup: '补充词汇巩固专题',
        title: `第 ${nextIdx} 节：补充词汇精读（${sampleWords}${sliceIds.length > 3 ? ' 等' : ''}）`,
        objective: `覆盖并自然运用未分配/未覆盖的 ${sliceIds.length} 个目标词汇`,
        keyTopics: ['词汇语境巩固', '长难句与搭配辨析'],
        teachingScope: `补充词汇单元（${sliceIds.length} 个目标词）`,
        targetWordIds: sliceIds,
        assignedWords: sliceIds
          .map((id) => vocabById.get(id))
          .filter((w): w is VocabItem => Boolean(w)),
      });
    }
  }

  const coverage = syncCourseVocabCoverage(course);
  return { reassignedCount, appendedSectionsCount, coverage };
}

/**
 * Set manual or AI semantic verification status for a section word match and recompute coverage.
 */
export function setVocabManualVerification(params: {
  course: Course;
  sectionId: string;
  wordId: string;
  status: 'confirmed' | 'rejected' | 'reset';
  reviewer?: 'manual' | 'ai';
  reason?: string;
}): CourseVocabCoverageRecord | undefined {
  const { course, sectionId, wordId, status, reviewer = 'manual', reason } = params;
  const pre = syncCourseVocabCoverage(course);
  if (!course.englishConfig) return undefined;

  if (!course.englishConfig.vocabCoverage) {
    course.englishConfig.vocabCoverage = pre;
  }
  const verifications = { ...(course.englishConfig.vocabCoverage?.verifications || {}) };
  const key = makeVerificationKey(sectionId, wordId);

  if (status === 'reset') {
    delete verifications[key];
  } else {
    const secRecord = pre?.bySection?.[sectionId];
    const match = secRecord?.matches.find((m) => m.wordId === wordId);
    const snippetHash = match ? simpleSnippetHash(match.snippets) : undefined;
    verifications[key] = {
      sectionId,
      wordId,
      status,
      reviewer,
      ...(reason ? { reason } : {}),
      ...(snippetHash ? { snippetHash } : {}),
      updatedAt: new Date().toISOString(),
    };
  }

  if (course.englishConfig.vocabCoverage) {
    course.englishConfig.vocabCoverage.verifications = verifications;
  }
  return syncCourseVocabCoverage(course);
}

export interface PendingWordGlossItem {
  wordId: string;
  word: string;
  surfaceForms: string[];
  role: 'new' | 'review' | 'incidental';
  contextSnippet: string;
  phonetic?: string;
}

export interface AssociatedVocabWordDetail {
  wordId: string;
  word: string;
  surfaceForms: string[];
  count: number;
  hasMeaning: boolean;
  isExtraGlossed: boolean;
  snippet: string;
}

export interface EnglishSectionAssociatedVocabStats {
  proseWordCount: number;
  plannedNewCount: number;
  reviewWordCount: number;
  associatedWordCount: number;
  associatedOccurrences: number;
  associatedDensityPercent: number;
  totalBankWordCount: number;
  glossedExtraCount: number;
  pendingGlossCount: number;
  associatedWords: AssociatedVocabWordDetail[];
}

export interface ParsedStep2EnglishOutput {
  extraWordGlosses: VocabItem[];
  paragraphUpdates: Array<{ index: number; english: string; chinese?: string }>;
  fullParagraphs: Array<{ english: string; chinese?: string }>;
  synonymReplacements: EnglishSynonymReplacementRecord[];
  markdownReplacements?: Array<{ from: string; to: string }>;
  markdownBody?: string;
}

export interface ApplyStep2EnglishEnhancementResult {
  lesson: DailyLessonContent;
  beforeStats: EnglishSectionAssociatedVocabStats;
  afterStats: EnglishSectionAssociatedVocabStats;
  addedGlossCount: number;
  appliedParagraphEditCount: number;
  rejectedParagraphEdits: Array<{ paragraphIndex: number; reason: string }>;
  appliedReplacements: EnglishSynonymReplacementRecord[];
}

/**
 * Check whether the course learner baseline indicates very weak English / beginner proficiency
 * so Step 2 may offer safe synonym simplification for dense incidental words.
 */
export function isWeakBaselineForVocabSimplification(course: Course): boolean {
  if (course.learnerBaseline === 'zero_base') return true;
  if (course.learnerBaseline === 'custom') {
    const note = String(course.customLearnerBaseline || '').trim();
    if (
      /(零基础|基础(?:很差|较差|差|薄弱|弱|入门)|词汇量(?:很少|很低|低|少)|初学者|刚起步|elementary|beginner)/i.test(
        note
      )
    ) {
      return true;
    }
  }
  if (!course.learnerBaseline && course.learnerLevel === 'beginner') {
    return true;
  }
  return false;
}

/**
 * Determine whether a vocabulary meaning is empty or a known placeholder string
 * that still needs Step 2 contextual gloss generation.
 */
export function isPlaceholderVocabMeaning(meaning?: string | null): boolean {
  const raw = String(meaning || '').trim();
  if (!raw) return true;
  const stripped = raw
    .replace(/^[（(【\[]\s*/, '')
    .replace(/\s*[）)】\]]$/, '')
    .trim();
  if (!stripped) return true;
  if (/^未收录到本节词表/.test(stripped)) return true;
  return /^(?:待结合语境学习|待补充(?:释义|含义|翻译)?|待生成(?:释义|含义)?|暂无(?:释义|含义|解释|翻译)|未填写|无释义|tbd|n\/a|none|unknown|\?+|—+|-+)$/i.test(
    stripped
  );
}

const ENGLISH_ABBREV_RE =
  /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|U\.S|U\.K|Inc|Ltd|Corp|Co|No|Jan|Feb|Mar|Apr|Aug|Sept|Oct|Nov|Dec|[A-Z])$/;

/**
 * Split an English paragraph into trimmed sentences (1-indexed for {{quote:P1:S2}} anchors).
 */
export function splitEnglishParagraphSentences(text: string): string[] {
  const src = String(text || '').trim();
  if (!src) return [];
  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '。' && ch !== '！' && ch !== '？') {
      continue;
    }
    if (ch === '.') {
      const prev = i > 0 ? src[i - 1] : '';
      const next = i + 1 < src.length ? src[i + 1] : '';
      if (/\d/.test(prev) && /\d/.test(next)) continue;
      if (ENGLISH_ABBREV_RE.test(src.slice(start, i))) continue;
    }

    let end = i + 1;
    while (end < src.length && /["'”’)\]]/.test(src[end])) {
      end++;
    }
    const after = src.slice(end);
    if (!after.trim() || /^\s+(?:[A-Z0-9"'“‘(\[]|$)/.test(after)) {
      const piece = src.slice(start, end).trim();
      if (piece) sentences.push(piece);
      start = end;
      while (start < src.length && /\s/.test(src[start])) start++;
      i = Math.max(i, start - 1);
    }
  }

  const tail = src.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

/**
 * Resolve `{{quote:P<n>:S<m>}}` and `{{quote:P<n>}}` anchors in markdownBody dynamically
 * against `englishPayload.paragraphs` so explanation quotes always stay synced with prose edits.
 */
export function resolveEnglishQuoteAnchors(
  markdownBody: string,
  paragraphs?: Array<{ english: string; chinese?: string }>
): string {
  const raw = String(markdownBody || '');
  if (!raw || !Array.isArray(paragraphs) || paragraphs.length === 0) return raw;

  return raw.replace(
    /\{\{\s*quote\s*:\s*p(\d+)(?:\s*[:_-]\s*s(\d+))?\s*\}\}/gi,
    (match, pStr: string, sStr?: string) => {
      const pIdx = Number.parseInt(pStr, 10) - 1;
      if (!Number.isInteger(pIdx) || pIdx < 0 || pIdx >= paragraphs.length) return match;
      const paraText = String(paragraphs[pIdx]?.english || '').trim();
      if (!paraText) return match;
      if (!sStr) return paraText;
      const sIdx = Number.parseInt(sStr, 10) - 1;
      const sentences = splitEnglishParagraphSentences(paraText);
      if (Number.isInteger(sIdx) && sIdx >= 0 && sIdx < sentences.length) {
        return sentences[sIdx];
      }
      return paraText;
    }
  );
}

function findSnippetForWordInProse(word: string, prose: string, tokens: ProseToken[]): string {
  const clean = String(word || '').trim();
  if (!clean || !prose) return '';
  const forms = /[A-Za-z]/.test(clean)
    ? buildEnglishInflectionForms(clean.split(/[\s-]+/)[0] || clean)
    : new Set([clean]);
  for (const tok of tokens) {
    if (forms.has(tok.baseLower) || forms.has(tok.cleanLower)) {
      return tok.sentence.slice(0, 220);
    }
  }
  const idx = prose.toLowerCase().indexOf(clean.toLowerCase());
  if (idx >= 0) {
    return splitSentenceAt(prose, idx, idx + clean.length).slice(0, 220);
  }
  return '';
}

function scanSectionVocabMatchesFresh(
  course: Course,
  slot: DailyPlanSlot,
  lesson?: DailyLessonContent | null
) {
  const targetLanguage: TargetLanguageCode = course.englishConfig?.targetLanguage || 'english';
  const effectiveWords = assignStableVocabIds(course.englishConfig?.effectiveWords || []);
  const vocabById = new Map<string, VocabItem>();
  const vocabByKey = new Map<string, VocabItem>();
  for (const item of effectiveWords) {
    if (item.id) vocabById.set(item.id, item);
    const key = normalizeWordKey(item.word);
    if (key && !vocabByKey.has(key)) vocabByKey.set(key, item);
  }

  const plan = course.dailyPlan || [];
  let slotIndex = plan.findIndex((s) => s === slot);
  if (slotIndex < 0) {
    slotIndex = plan.findIndex(
      (s) => (slot.id && s.id === slot.id) || s.dayIndex === slot.dayIndex
    );
  }

  const introducedSoFar = new Set<string>();
  const priorLimit = slotIndex >= 0 ? slotIndex : 0;
  for (let i = 0; i < priorLimit; i++) {
    const prevResolved = resolveSlotWordIds(plan[i], vocabById, vocabByKey);
    for (const id of prevResolved.newWordIds) {
      introducedSoFar.add(id);
    }
  }

  const resolved = resolveSlotWordIds(slot, vocabById, vocabByKey);
  const cleanNewIds: string[] = [];
  const cleanReviewIds: string[] = [...resolved.reviewWordIds];
  for (const id of resolved.newWordIds) {
    if (!introducedSoFar.has(id)) {
      cleanNewIds.push(id);
    } else if (!cleanReviewIds.includes(id)) {
      cleanReviewIds.push(id);
    }
  }
  const newIdSet = new Set(cleanNewIds);
  const reviewIdSet = new Set(cleanReviewIds);

  const prose = lesson ? extractLessonProseForCoverage(lesson, targetLanguage) : '';
  const tokens = prose && /[A-Za-z]/.test(prose) ? tokenizeEnglishProse(prose) : [];
  const proseWordCount = countProseWords(prose, targetLanguage);
  const tokenPositionByKey = new Map<string, number>();
  const proseTokenSet = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tokenPositionByKey.has(tok.baseLower)) tokenPositionByKey.set(tok.baseLower, i);
    if (!tokenPositionByKey.has(tok.cleanLower)) tokenPositionByKey.set(tok.cleanLower, i);
    proseTokenSet.add(tok.baseLower);
    proseTokenSet.add(tok.cleanLower);
    if (tok.baseLower.includes('-')) {
      for (const sub of tok.baseLower.split('-')) {
        if (sub) proseTokenSet.add(sub);
      }
    }
  }

  const matches: Array<{
    wordId: string;
    word: string;
    role: 'new' | 'review' | 'incidental';
    matchedForms: string[];
    count: number;
    snippets: string[];
    bankItem: VocabItem;
  }> = [];

  if (prose.trim() && effectiveWords.length > 0) {
    const checkEntries: Array<{ item: VocabItem; role: 'new' | 'review' | 'incidental' }> = [];
    const checkedIds = new Set<string>();

    for (const id of cleanNewIds) {
      const item = vocabById.get(id);
      if (item && !checkedIds.has(id)) {
        checkedIds.add(id);
        checkEntries.push({ item, role: 'new' });
      }
    }
    for (const id of cleanReviewIds) {
      const item = vocabById.get(id);
      if (item && !checkedIds.has(id)) {
        checkedIds.add(id);
        checkEntries.push({ item, role: 'review' });
      }
    }

    for (const item of effectiveWords) {
      const id = item.id || '';
      if (!id || checkedIds.has(id)) continue;
      if (/[A-Za-z]/.test(item.word)) {
        const clean = String(item.word || '').trim().replace(/\s+/g, ' ');
        const parts = clean.split(/[\s-]+/).filter(Boolean);
        const keyToken = parts[0] || clean;
        const forms = buildEnglishInflectionForms(keyToken, parts.length <= 1 ? item.meaning : undefined);
        let maybeHit = false;
        for (const f of forms) {
          if (proseTokenSet.has(f)) {
            maybeHit = true;
            break;
          }
        }
        if (!maybeHit) continue;
      } else {
        const clean = String(item.word || '').trim();
        if (!clean) continue;
        const stem = clean.length >= 2 ? clean.slice(0, -1) : clean;
        if (!prose.includes(clean) && !prose.includes(stem)) continue;
      }
      checkedIds.add(id);
      checkEntries.push({ item, role: 'incidental' });
    }

    for (const entry of checkEntries) {
      const matchRes = matchVocabItemInProse({
        item: entry.item,
        prose,
        tokens,
        targetLanguage,
      });
      if (matchRes.count === 0) continue;
      matches.push({
        wordId: entry.item.id || '',
        word: entry.item.word,
        role: entry.role,
        matchedForms: matchRes.matchedForms,
        count: matchRes.count,
        snippets: matchRes.snippets,
        bankItem: entry.item,
      });
    }
  }

  return {
    prose,
    tokens,
    proseWordCount,
    tokenPositionByKey,
    vocabById,
    vocabByKey,
    newIdSet,
    reviewIdSet,
    matches,
  };
}

/**
 * Detect English-lesson vocabulary items appearing in the current lesson prose or targetWords
 * whose Chinese meaning is still missing or a placeholder, without mutating `course`.
 */
export function extractPendingGlossWordsForSection(
  course: Course,
  slot: DailyPlanSlot,
  lessonOverride?: DailyLessonContent | null,
  extraBankWords: VocabItem[] = []
): PendingWordGlossItem[] {
  const lesson = lessonOverride === undefined ? slot.lesson || slot.stage1Draft : lessonOverride;
  if (!lesson?.englishPayload) return [];

  const scan = scanSectionVocabMatchesFresh(course, slot, lesson);

  const glossedById = new Set<string>();
  const glossedByKey = new Set<string>();
  const markGlossed = (w: VocabItem) => {
    if (isPlaceholderVocabMeaning(w.meaning)) return;
    if (w.id) glossedById.add(w.id);
    const key = normalizeWordKey(w.word);
    if (key) glossedByKey.add(key);
  };
  for (const w of lesson.englishPayload.extraWordGlosses || []) markGlossed(w);
  for (const w of lesson.englishPayload.targetWords || []) markGlossed(w);

  const extraByKey = new Map<string, VocabItem>();
  for (const w of extraBankWords || []) {
    const k = normalizeWordKey(w.word);
    if (!k) continue;
    if (!extraByKey.has(k) || !isPlaceholderVocabMeaning(w.meaning)) {
      extraByKey.set(k, w);
    }
  }

  const hasValidMeaning = (id?: string, word?: string, ownMeaning?: string): boolean => {
    if (ownMeaning && !isPlaceholderVocabMeaning(ownMeaning)) return true;
    if (id && glossedById.has(id)) return true;
    const key = word ? normalizeWordKey(word) : '';
    if (key && glossedByKey.has(key)) return true;
    const bankItem =
      (id ? scan.vocabById.get(id) : undefined) || (key ? scan.vocabByKey.get(key) : undefined);
    if (bankItem && !isPlaceholderVocabMeaning(bankItem.meaning)) return true;
    const extraItem = key ? extraByKey.get(key) : undefined;
    return Boolean(extraItem && !isPlaceholderVocabMeaning(extraItem.meaning));
  };

  const pendingMap = new Map<string, PendingWordGlossItem>();
  const upsertPending = (item: PendingWordGlossItem) => {
    const key = normalizeWordKey(item.word);
    if (!key || pendingMap.has(key)) return;
    pendingMap.set(key, item);
  };

  // 1. Check explicit lesson.englishPayload.targetWords with missing/placeholder meanings
  for (let idx = 0; idx < (lesson.englishPayload.targetWords || []).length; idx++) {
    const tw = lesson.englishPayload.targetWords[idx];
    const cleanWord = String(tw.word || '').trim();
    if (!cleanWord) continue;
    const key = normalizeWordKey(cleanWord);
    const bankItem = (tw.id ? scan.vocabById.get(tw.id) : undefined) || scan.vocabByKey.get(key);
    const wordId = tw.id || bankItem?.id || `tw-${idx + 1}`;
    if (hasValidMeaning(wordId, cleanWord, tw.meaning)) continue;
    const role: 'new' | 'review' | 'incidental' =
      tw.isReview || scan.reviewIdSet.has(wordId) ? 'review' : 'new';
    const snippet =
      findSnippetForWordInProse(cleanWord, scan.prose, scan.tokens) ||
      String(tw.example || '').trim().slice(0, 220);
    upsertPending({
      wordId,
      word: cleanWord,
      surfaceForms: [cleanWord],
      role,
      contextSnippet: snippet,
      phonetic: tw.phonetic || bankItem?.phonetic,
    });
  }

  // 2. Check fresh prose matches against vocab bank
  for (const m of scan.matches) {
    if (hasValidMeaning(m.wordId, m.word, m.bankItem.meaning)) continue;
    upsertPending({
      wordId: m.wordId,
      word: m.word,
      surfaceForms: m.matchedForms.length > 0 ? m.matchedForms : [m.word],
      role: m.role,
      contextSnippet: (
        m.snippets[0] || findSnippetForWordInProse(m.word, scan.prose, scan.tokens)
      ).slice(0, 220),
      phonetic: m.bankItem.phonetic,
    });
  }

  // 3. Check user-marked vocabulary bank words appearing in prose that still need meanings
  if (scan.prose.trim() && extraByKey.size > 0) {
    const targetLanguage: TargetLanguageCode = course.englishConfig?.targetLanguage || 'english';
    for (const [k, extraItem] of extraByKey.entries()) {
      if (pendingMap.has(k) || hasValidMeaning(extraItem.id, extraItem.word, extraItem.meaning)) {
        continue;
      }
      const matchRes = matchVocabItemInProse({
        item: extraItem,
        prose: scan.prose,
        tokens: scan.tokens,
        targetLanguage,
      });
      if (matchRes.count === 0) continue;
      upsertPending({
        wordId: extraItem.id || `mk-${k}`,
        word: extraItem.word,
        surfaceForms: matchRes.matchedForms.length > 0 ? matchRes.matchedForms : [extraItem.word],
        role: 'incidental',
        contextSnippet: (
          matchRes.snippets[0] || findSnippetForWordInProse(extraItem.word, scan.prose, scan.tokens)
        ).slice(0, 220),
        phonetic: extraItem.phonetic,
      });
    }
  }

  const roleWeight: Record<PendingWordGlossItem['role'], number> = {
    new: 0,
    review: 1,
    incidental: 2,
  };
  return Array.from(pendingMap.values()).sort((a, b) => {
    const rw = roleWeight[a.role] - roleWeight[b.role];
    if (rw !== 0) return rw;
    const posA =
      scan.tokenPositionByKey.get(normalizeWordKey(a.surfaceForms[0] || a.word)) ??
      scan.tokenPositionByKey.get(normalizeWordKey(a.word)) ??
      Number.MAX_SAFE_INTEGER;
    const posB =
      scan.tokenPositionByKey.get(normalizeWordKey(b.surfaceForms[0] || b.word)) ??
      scan.tokenPositionByKey.get(normalizeWordKey(b.word)) ??
      Number.MAX_SAFE_INTEGER;
    if (posA !== posB) return posA - posB;
    return a.word.localeCompare(b.word);
  });
}

/**
 * Deterministically count planned new words, review words, and associated (incidental) bank words
 * currently appearing in an English reading lesson. Used both before and after Step 2 edits.
 */
export function computeSectionAssociatedVocabStats(
  course: Course,
  slot: DailyPlanSlot,
  lessonOverride?: DailyLessonContent | null
): EnglishSectionAssociatedVocabStats {
  const lesson = lessonOverride === undefined ? slot.lesson || slot.stage1Draft : lessonOverride;
  if (!lesson?.englishPayload) {
    return {
      proseWordCount: 0,
      plannedNewCount: 0,
      reviewWordCount: 0,
      associatedWordCount: 0,
      associatedOccurrences: 0,
      associatedDensityPercent: 0,
      totalBankWordCount: 0,
      glossedExtraCount: 0,
      pendingGlossCount: 0,
      associatedWords: [],
    };
  }

  const scan = scanSectionVocabMatchesFresh(course, slot, lesson);
  const extraById = new Set<string>();
  const extraByKey = new Set<string>();
  for (const g of lesson.englishPayload.extraWordGlosses || []) {
    if (isPlaceholderVocabMeaning(g.meaning)) continue;
    if (g.id) extraById.add(g.id);
    const k = normalizeWordKey(g.word);
    if (k) extraByKey.add(k);
  }
  const targetGlossedById = new Set<string>();
  const targetGlossedByKey = new Set<string>();
  for (const tw of lesson.englishPayload.targetWords || []) {
    if (isPlaceholderVocabMeaning(tw.meaning)) continue;
    if (tw.id) targetGlossedById.add(tw.id);
    const k = normalizeWordKey(tw.word);
    if (k) targetGlossedByKey.add(k);
  }

  let plannedNewCount = 0;
  let reviewWordCount = 0;
  let associatedOccurrences = 0;
  let glossedExtraCount = 0;
  const associatedWords: AssociatedVocabWordDetail[] = [];

  for (const m of scan.matches) {
    if (m.role === 'new') {
      plannedNewCount++;
      continue;
    }
    if (m.role === 'review') {
      reviewWordCount++;
      continue;
    }
    const key = normalizeWordKey(m.word);
    const isExtraGlossed = Boolean((m.wordId && extraById.has(m.wordId)) || extraByKey.has(key));
    const hasMeaning =
      isExtraGlossed ||
      Boolean((m.wordId && targetGlossedById.has(m.wordId)) || targetGlossedByKey.has(key)) ||
      !isPlaceholderVocabMeaning(m.bankItem.meaning);
    if (isExtraGlossed) {
      glossedExtraCount++;
    }
    associatedOccurrences += m.count;
    associatedWords.push({
      wordId: m.wordId,
      word: m.word,
      surfaceForms: m.matchedForms.length > 0 ? m.matchedForms : [m.word],
      count: m.count,
      hasMeaning,
      isExtraGlossed,
      snippet: m.snippets[0] || findSnippetForWordInProse(m.word, scan.prose, scan.tokens),
    });
  }

  associatedWords.sort((a, b) => {
    const posA =
      scan.tokenPositionByKey.get(normalizeWordKey(a.surfaceForms[0] || a.word)) ??
      scan.tokenPositionByKey.get(normalizeWordKey(a.word)) ??
      Number.MAX_SAFE_INTEGER;
    const posB =
      scan.tokenPositionByKey.get(normalizeWordKey(b.surfaceForms[0] || b.word)) ??
      scan.tokenPositionByKey.get(normalizeWordKey(b.word)) ??
      Number.MAX_SAFE_INTEGER;
    if (posA !== posB) return posA - posB;
    return a.word.localeCompare(b.word);
  });

  const associatedWordCount = associatedWords.length;
  const associatedDensityPercent =
    scan.proseWordCount > 0
      ? Number(((associatedWordCount / scan.proseWordCount) * 100).toFixed(1))
      : 0;
  const pendingGlossCount = extractPendingGlossWordsForSection(course, slot, lesson).length;

  return {
    proseWordCount: scan.proseWordCount,
    plannedNewCount,
    reviewWordCount,
    associatedWordCount,
    associatedOccurrences,
    associatedDensityPercent,
    totalBankWordCount: plannedNewCount + reviewWordCount + associatedWordCount,
    glossedExtraCount,
    pendingGlossCount,
    associatedWords,
  };
}

function cleanImportedGlossField(text: string): string {
  return String(text || '')
    .replace(/\[\s*cite(?:_start|_end)?(?:\s*[:：]\s*[^\]]*)?\s*\]/gi, '')
    .replace(/【\s*cite(?:_start|_end)?(?:\s*[:：]\s*[^】]*)?\s*】/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tryParseJsonFlexible(raw: string): unknown {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];
  const fenceRegex = /```(?:json|jsonc|txt)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRegex.exec(trimmed)) !== null) {
    if (fenceMatch[1]?.trim()) candidates.unshift(fenceMatch[1].trim());
  }

  for (const cand of candidates) {
    try {
      return JSON.parse(cand);
    } catch {
      // Try slicing first {...} or [...] block
      const objStart = cand.indexOf('{');
      const objEnd = cand.lastIndexOf('}');
      if (objStart >= 0 && objEnd > objStart) {
        try {
          return JSON.parse(cand.slice(objStart, objEnd + 1));
        } catch {
          // ignore
        }
      }
      const arrStart = cand.indexOf('[');
      const arrEnd = cand.lastIndexOf(']');
      if (arrStart >= 0 && arrEnd > arrStart) {
        try {
          return JSON.parse(cand.slice(arrStart, arrEnd + 1));
        } catch {
          // ignore
        }
      }
    }
  }
  return null;
}

/**
 * Parse Step 2 contextual word glosses from JSON objects, arrays, key-value maps,
 * or compact line-based formats (`id | word | phonetic | meaning`).
 */
export function parseImportedWordGlosses(
  rawText: string,
  pendingWords: PendingWordGlossItem[] = []
): VocabItem[] {
  const byId = new Map<string, PendingWordGlossItem>();
  const byWordKey = new Map<string, PendingWordGlossItem>();
  const bySurfaceKey = new Map<string, PendingWordGlossItem>();
  for (const p of pendingWords) {
    if (p.wordId) byId.set(p.wordId.trim(), p);
    const wKey = normalizeWordKey(p.word);
    if (wKey && !byWordKey.has(wKey)) byWordKey.set(wKey, p);
    for (const s of p.surfaceForms || []) {
      const sKey = normalizeWordKey(s);
      if (sKey && !bySurfaceKey.has(sKey)) bySurfaceKey.set(sKey, p);
    }
  }

  const parsedEntries: VocabItem[] = [];
  const seenKeys = new Set<string>();

  const pushEntry = (rawId: unknown, rawWord: unknown, rawMeaning: unknown, rawPhonetic?: unknown, rawUsageNote?: unknown) => {
    const idStr = cleanImportedGlossField(String(rawId || ''));
    const wordStr = cleanImportedGlossField(String(rawWord || ''));
    const meaningStr = cleanImportedGlossField(String(rawMeaning || ''));
    const phoneticStr = cleanImportedGlossField(String(rawPhonetic || ''));
    const usageNoteStr = cleanImportedGlossField(String(rawUsageNote || ''));

    if (!meaningStr || isPlaceholderVocabMeaning(meaningStr)) return;

    const matchedPending =
      (idStr ? byId.get(idStr) : undefined) ||
      (wordStr ? byWordKey.get(normalizeWordKey(wordStr)) : undefined) ||
      (wordStr ? bySurfaceKey.get(normalizeWordKey(wordStr)) : undefined) ||
      (idStr ? byWordKey.get(normalizeWordKey(idStr)) : undefined);

    const finalWord = matchedPending?.word || wordStr || idStr;
    if (!finalWord || !/[A-Za-z\u3040-\u30ff\u4e00-\u9fff]/.test(finalWord)) return;
    const finalKey = normalizeWordKey(finalWord);
    if (!finalKey || seenKeys.has(finalKey)) return;
    seenKeys.add(finalKey);

    const resolvedId = matchedPending?.wordId || (/^w[-_a-z0-9]+$/i.test(idStr) ? idStr : undefined);
    parsedEntries.push({
      ...(resolvedId ? { id: resolvedId } : {}),
      word: finalWord,
      meaning: meaningStr,
      ...(phoneticStr ? { phonetic: phoneticStr } : {}),
      ...(usageNoteStr ? { usageNote: usageNoteStr } : {}),
    });
  };

  const jsonVal = tryParseJsonFlexible(rawText);
  if (jsonVal !== null) {
    const metadataKeys = new Set([
      'sectionid',
      'dayindex',
      'articletitle',
      'title',
      'note',
      'notes',
      'source',
      'stage',
      'mode',
    ]);
    const consumeArray = (arr: unknown[]) => {
      for (const row of arr) {
        if (!row || typeof row !== 'object') continue;
        const rec = row as Record<string, unknown>;
        const meaning =
          rec.meaning ?? rec.gloss ?? rec.definition ?? rec.zh ?? rec.translation ?? rec.mean;
        const word = rec.word ?? rec.lemma ?? rec.term ?? rec.token ?? rec.surface;
        const id = rec.wordId ?? rec.id ?? rec.wid;
        if (word !== undefined || id !== undefined) {
          pushEntry(id, word, meaning, rec.phonetic ?? rec.ipa, rec.usageNote ?? rec.note);
        } else {
          for (const [k, v] of Object.entries(rec)) {
            if (typeof v === 'string') pushEntry('', k, v);
          }
        }
      }
    };

    if (Array.isArray(jsonVal)) {
      consumeArray(jsonVal);
    } else if (typeof jsonVal === 'object') {
      const obj = jsonVal as Record<string, unknown>;
      const listCandidate =
        obj.extraWordGlosses ?? obj.wordGlosses ?? obj.glosses ?? obj.words ?? obj.items;
      if (Array.isArray(listCandidate)) {
        consumeArray(listCandidate);
      } else if (listCandidate && typeof listCandidate === 'object') {
        for (const [k, v] of Object.entries(listCandidate as Record<string, unknown>)) {
          if (typeof v === 'string') {
            pushEntry(k, k, v);
          } else if (v && typeof v === 'object') {
            const sub = v as Record<string, unknown>;
            pushEntry(
              sub.wordId ?? sub.id ?? k,
              sub.word ?? k,
              sub.meaning ?? sub.gloss ?? sub.definition ?? sub.zh,
              sub.phonetic ?? sub.ipa,
              sub.usageNote
            );
          }
        }
      } else {
        for (const [k, v] of Object.entries(obj)) {
          if (metadataKeys.has(k.toLowerCase())) continue;
          if (typeof v === 'string') {
            pushEntry(k, k, v);
          } else if (v && typeof v === 'object') {
            const sub = v as Record<string, unknown>;
            pushEntry(
              sub.wordId ?? sub.id ?? k,
              sub.word ?? k,
              sub.meaning ?? sub.gloss ?? sub.definition ?? sub.zh,
              sub.phonetic ?? sub.ipa,
              sub.usageNote
            );
          }
        }
      }
    }
  }

  if (parsedEntries.length > 0) {
    return parsedEntries;
  }

  // Fallback: compact line-by-line formats (`w-142 | profound | /prəˈfaʊnd/ | adj. 深远的` or `profound: adj. 深远的`)
  const lines = String(rawText || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
      .replace(/^\s*```.*$/, '')
      .trim();
    if (!line || line.startsWith('#')) continue;

    if (line.includes('|') && !/^[|:\s-]+$/.test(line)) {
      const cells = line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cells.length >= 2) {
        if (/^(?:wordId|id|编号)$/i.test(cells[0])) continue;
        if (cells.length >= 4) {
          pushEntry(cells[0], cells[1], cells.slice(3).join('；'), cells[2]);
        } else if (cells.length === 3) {
          if (/^w[-_a-z0-9]+$/i.test(cells[0]) || /^tw-\d+$/i.test(cells[0])) {
            pushEntry(cells[0], cells[1], cells[2]);
          } else if (/^[/\[].*[/\]]$/.test(cells[1])) {
            pushEntry('', cells[0], cells[2], cells[1]);
          } else {
            pushEntry('', cells[0], cells[2], cells[1]);
          }
        } else {
          pushEntry('', cells[0], cells[1]);
        }
        continue;
      }
    }

    const kvMatch = line.match(
      /^(?:\*{1,2})?([A-Za-z][A-Za-z\s'-]{0,50})(?:\*{1,2})?(?:\s*(\/[^/]+\/))?\s*(?:[:：]|—|-|\t)\s*(.+)$/
    );
    if (kvMatch) {
      pushEntry('', kvMatch[1], kvMatch[3], kvMatch[2]);
    }
  }

  return parsedEntries;
}

/**
 * Merge Step 2 contextual word glosses into `lesson.englishPayload.extraWordGlosses`
 * (and backfill any placeholder `targetWords` meanings) without altering article prose or exercises.
 */
export function mergeExtraWordGlossesIntoLesson(
  lesson: DailyLessonContent,
  newGlosses: VocabItem[],
  course?: Course
): DailyLessonContent {
  if (!lesson?.englishPayload) {
    return lesson;
  }

  const effectiveWords = assignStableVocabIds(course?.englishConfig?.effectiveWords || []);
  const bankById = new Map<string, VocabItem>();
  const bankByKey = new Map<string, VocabItem>();
  for (const w of effectiveWords) {
    if (w.id) bankById.set(w.id, w);
    const k = normalizeWordKey(w.word);
    if (k && !bankByKey.has(k)) bankByKey.set(k, w);
  }

  const glossByKey = new Map<string, VocabItem>();
  const upsertGloss = (raw: VocabItem) => {
    const cleanWord = String(raw.word || '').trim();
    const key = normalizeWordKey(cleanWord);
    if (!key) return;
    const bankMatch = (raw.id ? bankById.get(raw.id) : undefined) || bankByKey.get(key);
    const id = raw.id || bankMatch?.id;
    const existing = glossByKey.get(key);
    const incomingMeaning = String(raw.meaning || '').trim();
    if (!incomingMeaning || isPlaceholderVocabMeaning(incomingMeaning)) return;
    glossByKey.set(key, {
      ...(existing || {}),
      ...raw,
      ...(id ? { id } : {}),
      word: bankMatch?.word || existing?.word || cleanWord,
      meaning: incomingMeaning,
      ...(raw.phonetic?.trim()
        ? { phonetic: raw.phonetic.trim() }
        : existing?.phonetic || bankMatch?.phonetic
          ? { phonetic: existing?.phonetic || bankMatch?.phonetic }
          : {}),
    });
  };

  for (const existing of lesson.englishPayload.extraWordGlosses || []) {
    upsertGloss(existing);
  }
  for (const incoming of newGlosses || []) {
    upsertGloss(incoming);
  }

  const targetWords = (lesson.englishPayload.targetWords || []).map((tw) => {
    if (!isPlaceholderVocabMeaning(tw.meaning)) return tw;
    const g = glossByKey.get(normalizeWordKey(tw.word));
    if (!g) return tw;
    return {
      ...tw,
      meaning: g.meaning,
      ...(tw.phonetic ? {} : g.phonetic ? { phonetic: g.phonetic } : {}),
      ...(tw.usageNote ? {} : g.usageNote ? { usageNote: g.usageNote } : {}),
    };
  });

  return {
    ...lesson,
    englishPayload: {
      ...lesson.englishPayload,
      targetWords,
      extraWordGlosses: Array.from(glossByKey.values()),
    },
  };
}

function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyLiteralWordReplacement(text: string, originalWord: string, replacedWith: string): string {
  const cleanOrig = String(originalWord || '').trim();
  const cleanRep = String(replacedWith || '').trim();
  if (!cleanOrig || !cleanRep) return text;
  const escaped = escapeRegexLiteral(cleanOrig).replace(/\s+/g, '\\s+');
  const pattern = new RegExp(`(^|[^A-Za-z0-9_])(${escaped})(?=$|[^A-Za-z0-9_])`, 'gi');
  return text.replace(pattern, (_full, prefix: string, matched: string) => {
    let rep = cleanRep;
    if (matched && /^[A-Z]/.test(matched) && /^[a-z]/.test(rep)) {
      rep = rep[0].toUpperCase() + rep.slice(1);
    }
    return `${prefix}${rep}`;
  });
}

/**
 * Parse Step 2 English reading output supporting contextual glosses as well as optional
 * paragraph updates and synonym replacement records for weak-baseline courses.
 */
export function parseImportedStep2EnglishOutput(
  rawText: string,
  pendingWords: PendingWordGlossItem[] = []
): ParsedStep2EnglishOutput {
  const extraWordGlosses = parseImportedWordGlosses(rawText, pendingWords);
  const paragraphUpdates: Array<{ index: number; english: string; chinese?: string }> = [];
  const fullParagraphs: Array<{ english: string; chinese?: string }> = [];
  const synonymReplacements: EnglishSynonymReplacementRecord[] = [];
  const markdownReplacements: Array<{ from: string; to: string }> = [];
  let markdownBody: string | undefined;

  const jsonVal = tryParseJsonFlexible(rawText);
  if (jsonVal && typeof jsonVal === 'object' && !Array.isArray(jsonVal)) {
    const obj = jsonVal as Record<string, unknown>;
    const rawUpdates = obj.paragraphUpdates ?? obj.paragraphsUpdates ?? obj.updatedParagraphs;
    if (Array.isArray(rawUpdates)) {
      const seenIndices = new Set<number>();
      for (const row of rawUpdates) {
        if (!row || typeof row !== 'object') continue;
        const rec = row as Record<string, unknown>;
        const rawIdx = rec.index ?? rec.paragraphIndex ?? rec.paraIndex;
        const idx = typeof rawIdx === 'number' ? Math.round(rawIdx) : Number.parseInt(String(rawIdx ?? ''), 10);
        const en = cleanImportedGlossField(String(rec.english ?? rec.text ?? rec.en ?? ''));
        const zh = cleanImportedGlossField(String(rec.chinese ?? rec.zh ?? ''));
        if (!Number.isInteger(idx) || idx < 0 || !en || seenIndices.has(idx)) continue;
        seenIndices.add(idx);
        paragraphUpdates.push({ index: idx, english: en, ...(zh ? { chinese: zh } : {}) });
      }
    }

    const rawFullParas = obj.fullParagraphs ?? obj.paragraphs;
    if (Array.isArray(rawFullParas)) {
      for (const row of rawFullParas) {
        if (!row || typeof row !== 'object') continue;
        const rec = row as Record<string, unknown>;
        const en = cleanImportedGlossField(String(rec.english ?? rec.text ?? rec.en ?? ''));
        const zh = cleanImportedGlossField(String(rec.chinese ?? rec.zh ?? ''));
        if (en) {
          fullParagraphs.push({ english: en, ...(zh ? { chinese: zh } : {}) });
        }
      }
    }

    const rawReps = obj.synonymReplacements ?? obj.replacements ?? obj.simplifiedWords;
    if (Array.isArray(rawReps)) {
      const seenRep = new Set<string>();
      for (const row of rawReps) {
        if (!row || typeof row !== 'object') continue;
        const rec = row as Record<string, unknown>;
        const rawIdx = rec.paragraphIndex ?? rec.index ?? rec.paraIndex;
        const idx =
          typeof rawIdx === 'number' && Number.isFinite(rawIdx)
            ? Math.max(0, Math.round(rawIdx))
            : Number.isInteger(Number.parseInt(String(rawIdx ?? ''), 10))
              ? Math.max(0, Number.parseInt(String(rawIdx), 10))
              : 0;
        const originalWord = cleanImportedGlossField(
          String(rec.originalWord ?? rec.original ?? rec.from ?? rec.word ?? '')
        );
        const originalWordId = cleanImportedGlossField(
          String(rec.originalWordId ?? rec.wordId ?? rec.id ?? '')
        );
        const replacedWith = cleanImportedGlossField(
          String(rec.replacedWith ?? rec.replacement ?? rec.to ?? rec.substitute ?? '')
        );
        const reason = cleanImportedGlossField(String(rec.reason ?? rec.note ?? ''));
        if (!originalWord || !replacedWith) continue;
        const repKey = `${idx}:${normalizeWordKey(originalWord)}:${normalizeWordKey(replacedWith)}`;
        if (seenRep.has(repKey)) continue;
        seenRep.add(repKey);
        synonymReplacements.push({
          paragraphIndex: idx,
          originalWord,
          ...(originalWordId ? { originalWordId } : {}),
          replacedWith,
          ...(reason ? { reason } : {}),
        });
      }
    }

    const rawMdReps = obj.markdownReplacements ?? obj.explanationReplacements;
    if (Array.isArray(rawMdReps)) {
      for (const row of rawMdReps) {
        if (!row || typeof row !== 'object') continue;
        const rec = row as Record<string, unknown>;
        const from = String(rec.from ?? rec.original ?? rec.find ?? '').trim();
        const to = String(rec.to ?? rec.replacement ?? rec.replace ?? '').trim();
        if (from && to && from !== to) {
          markdownReplacements.push({ from, to });
        }
      }
    }

    if (typeof obj.markdownBody === 'string' && obj.markdownBody.trim()) {
      markdownBody = obj.markdownBody;
    }
  }

  return {
    extraWordGlosses,
    paragraphUpdates,
    fullParagraphs,
    synonymReplacements,
    ...(markdownReplacements.length > 0 ? { markdownReplacements } : {}),
    ...(markdownBody ? { markdownBody } : {}),
  };
}

/**
 * Apply Step 2 contextual glosses and optional weak-baseline synonym simplifications to an English
 * lesson, strictly guarding planned target new words against removal and deterministically recounting
 * associated vocabulary statistics before/after the update.
 */
export function applyStep2EnglishEnhancementToLesson(params: {
  course: Course;
  slot: DailyPlanSlot;
  lesson: DailyLessonContent;
  parsed: ParsedStep2EnglishOutput;
  allowSynonymReplacement: boolean;
}): ApplyStep2EnglishEnhancementResult {
  const { course, slot, lesson, parsed, allowSynonymReplacement } = params;
  if (!lesson?.englishPayload) {
    const emptyStats = computeSectionAssociatedVocabStats(course, slot, lesson);
    return {
      lesson,
      beforeStats: emptyStats,
      afterStats: emptyStats,
      addedGlossCount: 0,
      appliedParagraphEditCount: 0,
      rejectedParagraphEdits: [],
      appliedReplacements: [],
    };
  }

  const beforeScan = scanSectionVocabMatchesFresh(course, slot, lesson);
  const beforeStats = computeSectionAssociatedVocabStats(course, slot, lesson);
  const beforeNewMatchedIds = new Set(
    beforeScan.matches.filter((m) => m.role === 'new').map((m) => m.wordId)
  );

  const protectedWordKeys = new Set<string>();
  for (const id of beforeScan.newIdSet) {
    const item = beforeScan.vocabById.get(id);
    if (item?.word) protectedWordKeys.add(normalizeWordKey(item.word));
  }
  for (const id of beforeScan.reviewIdSet) {
    const item = beforeScan.vocabById.get(id);
    if (item?.word) protectedWordKeys.add(normalizeWordKey(item.word));
  }
  for (const tw of lesson.englishPayload.targetWords || []) {
    const k = normalizeWordKey(tw.word);
    if (k) protectedWordKeys.add(k);
  }

  const origParagraphs = (lesson.englishPayload.paragraphs || []).map((p) => ({ ...p }));
  const nextParagraphs = origParagraphs.map((p) => ({ ...p }));
  const appliedIndices = new Set<number>();
  const rejectedParagraphEdits: Array<{ paragraphIndex: number; reason: string }> = [];
  const rejectedProtectedKeys = new Set<string>();

  if (allowSynonymReplacement && origParagraphs.length > 0) {
    if (
      parsed.fullParagraphs.length > 0 &&
      parsed.fullParagraphs.length === nextParagraphs.length
    ) {
      for (let i = 0; i < nextParagraphs.length; i++) {
        const candEn = parsed.fullParagraphs[i].english.trim();
        if (candEn && candEn !== origParagraphs[i].english.trim()) {
          nextParagraphs[i] = {
            english: candEn,
            chinese: parsed.fullParagraphs[i].chinese?.trim() || origParagraphs[i].chinese || '',
          };
          appliedIndices.add(i);
        }
      }
    } else if (parsed.paragraphUpdates.length > 0) {
      for (const upd of parsed.paragraphUpdates) {
        if (upd.index < 0 || upd.index >= nextParagraphs.length) continue;
        const candEn = upd.english.trim();
        if (candEn && candEn !== origParagraphs[upd.index].english.trim()) {
          nextParagraphs[upd.index] = {
            english: candEn,
            chinese: upd.chinese?.trim() || origParagraphs[upd.index].chinese || '',
          };
          appliedIndices.add(upd.index);
        }
      }
    } else if (parsed.synonymReplacements.length > 0) {
      for (const rep of parsed.synonymReplacements) {
        const origKey = normalizeWordKey(rep.originalWord);
        if (protectedWordKeys.has(origKey)) {
          rejectedProtectedKeys.add(origKey);
          rejectedParagraphEdits.push({
            paragraphIndex: rep.paragraphIndex,
            reason: `「${rep.originalWord}」属于本节目标或复现词，已禁止替换为「${rep.replacedWith}」`,
          });
          continue;
        }
        const targetIdxs =
          Number.isInteger(rep.paragraphIndex) &&
          rep.paragraphIndex >= 0 &&
          rep.paragraphIndex < nextParagraphs.length
            ? [rep.paragraphIndex]
            : nextParagraphs.map((_, i) => i);
        for (const pIdx of targetIdxs) {
          const updated = applyLiteralWordReplacement(
            nextParagraphs[pIdx].english,
            rep.originalWord,
            rep.replacedWith
          );
          if (updated !== nextParagraphs[pIdx].english) {
            nextParagraphs[pIdx] = {
              ...nextParagraphs[pIdx],
              english: updated,
            };
            appliedIndices.add(pIdx);
          }
        }
      }
    }
  }

  // Hard guardrail: revert any paragraph edit that causes a previously covered planned 'new' word to disappear
  if (appliedIndices.size > 0 && beforeNewMatchedIds.size > 0) {
    const candidateLesson: DailyLessonContent = {
      ...lesson,
      englishPayload: {
        ...lesson.englishPayload,
        paragraphs: nextParagraphs,
      },
    };
    const afterCandidateScan = scanSectionVocabMatchesFresh(course, slot, candidateLesson);
    const afterCandidateNewIds = new Set(
      afterCandidateScan.matches.filter((m) => m.role === 'new').map((m) => m.wordId)
    );
    const disappearedNewIds = Array.from(beforeNewMatchedIds).filter(
      (id) => !afterCandidateNewIds.has(id)
    );

    if (disappearedNewIds.length > 0) {
      const targetLanguage: TargetLanguageCode = course.englishConfig?.targetLanguage || 'english';
      for (const idx of Array.from(appliedIndices)) {
        const origText = origParagraphs[idx]?.english || '';
        const newText = nextParagraphs[idx]?.english || '';
        const origTokens = tokenizeEnglishProse(origText);
        const newTokens = tokenizeEnglishProse(newText);
        const brokeAnyNewWord = disappearedNewIds.some((id) => {
          const item = beforeScan.vocabById.get(id);
          if (!item) return false;
          const hadInOrig =
            matchVocabItemInProse({
              item,
              prose: origText,
              tokens: origTokens,
              targetLanguage,
            }).count > 0;
          const hasInNew =
            matchVocabItemInProse({
              item,
              prose: newText,
              tokens: newTokens,
              targetLanguage,
            }).count > 0;
          return hadInOrig && !hasInNew;
        });

        if (brokeAnyNewWord) {
          nextParagraphs[idx] = { ...origParagraphs[idx] };
          appliedIndices.delete(idx);
          rejectedParagraphEdits.push({
            paragraphIndex: idx,
            reason: `第 ${idx + 1} 段改写后遗漏了本节规划目标新词，已自动回退保留原段`,
          });
        }
      }
    }
  }

  const workingLesson: DailyLessonContent = {
    ...lesson,
    englishPayload: {
      ...lesson.englishPayload,
      paragraphs: nextParagraphs,
    },
  };

  const mergedLesson = mergeExtraWordGlossesIntoLesson(
    workingLesson,
    parsed.extraWordGlosses,
    course
  );
  const afterStats = computeSectionAssociatedVocabStats(course, slot, mergedLesson);

  const rejectedIdxSet = new Set(rejectedParagraphEdits.map((r) => r.paragraphIndex));
  const acceptedNewReplacements = allowSynonymReplacement
    ? parsed.synonymReplacements.filter((r) => {
        const origKey = normalizeWordKey(r.originalWord);
        if (protectedWordKeys.has(origKey) || rejectedProtectedKeys.has(origKey)) return false;
        if (appliedIndices.size > 0 && !appliedIndices.has(r.paragraphIndex)) {
          return !rejectedIdxSet.has(r.paragraphIndex) && appliedIndices.size > 0;
        }
        return !rejectedIdxSet.has(r.paragraphIndex);
      })
    : [];

  const mergedReplacementsMap = new Map<string, EnglishSynonymReplacementRecord>();
  for (const r of lesson.englishPayload.synonymReplacements || []) {
    const key = `${r.paragraphIndex}:${normalizeWordKey(r.originalWord)}:${normalizeWordKey(r.replacedWith)}`;
    mergedReplacementsMap.set(key, r);
  }
  for (const r of acceptedNewReplacements) {
    const key = `${r.paragraphIndex}:${normalizeWordKey(r.originalWord)}:${normalizeWordKey(r.replacedWith)}`;
    mergedReplacementsMap.set(key, r);
  }
  const mergedReplacements = Array.from(mergedReplacementsMap.values());

  const priorBefore = lesson.englishPayload.step2VocabStats?.associatedWordCountBefore;
  const associatedWordCountBefore =
    typeof priorBefore === 'number' ? priorBefore : beforeStats.associatedWordCount;
  const netDeltaReplaced = Math.max(
    0,
    associatedWordCountBefore - afterStats.associatedWordCount
  );

  let nextMarkdownBody = lesson.markdownBody || '';
  if (allowSynonymReplacement) {
    if (typeof parsed.markdownBody === 'string' && parsed.markdownBody.trim()) {
      nextMarkdownBody = parsed.markdownBody;
    } else if (Array.isArray(parsed.markdownReplacements) && parsed.markdownReplacements.length > 0 && nextMarkdownBody) {
      for (const mr of parsed.markdownReplacements) {
        if (!mr.from || !mr.to || mr.from === mr.to) continue;
        nextMarkdownBody = nextMarkdownBody.split(mr.from).join(mr.to);
      }
    }
  }

  const finalLesson: DailyLessonContent = {
    ...mergedLesson,
    ...(nextMarkdownBody !== (lesson.markdownBody || '') ? { markdownBody: nextMarkdownBody } : {}),
    englishPayload: mergedLesson.englishPayload
      ? {
          ...mergedLesson.englishPayload,
          ...(mergedReplacements.length > 0 ? { synonymReplacements: mergedReplacements } : {}),
          step2VocabStats: {
            updatedAt: new Date().toISOString(),
            proseWordCount: afterStats.proseWordCount,
            plannedNewCount: afterStats.plannedNewCount,
            reviewWordCount: afterStats.reviewWordCount,
            associatedWordCountBefore,
            associatedWordCount: afterStats.associatedWordCount,
            associatedOccurrences: afterStats.associatedOccurrences,
            associatedDensityPercent: afterStats.associatedDensityPercent,
            totalBankWordCount: afterStats.totalBankWordCount,
            glossedExtraCount: afterStats.glossedExtraCount,
            pendingGlossCount: afterStats.pendingGlossCount,
            synonymReplacementEnabled: allowSynonymReplacement,
            replacedCount: Math.max(mergedReplacements.length, netDeltaReplaced),
          },
        }
      : undefined,
  };

  return {
    lesson: finalLesson,
    beforeStats,
    afterStats,
    addedGlossCount: parsed.extraWordGlosses.length,
    appliedParagraphEditCount: appliedIndices.size,
    rejectedParagraphEdits,
    appliedReplacements: acceptedNewReplacements,
  };
}
