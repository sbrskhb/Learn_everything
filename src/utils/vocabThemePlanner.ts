import type {
  Course,
  CourseVocabCoverageRecord,
  DailyPlanSlot,
  VocabItem,
  VocabThemeItem,
  VocabThemePlan,
  VocabWordThemeMapping,
} from '../types';
import {
  allocateSectionsToDays,
  assignStableVocabIds,
  buildCourseDailySchedule,
  ensureStableSectionId,
  getTodayDateString,
  normalizeWordKey,
} from './learningLogic';
import { stripAiCitationArtifacts, tryExtractJsonObject } from './coursewareParser';
import { syncCourseVocabCoverage } from './vocabCoverage';

function clampWeight(raw: unknown): number {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 1;
  return Math.round(Math.max(0.3, Math.min(4.0, num)) * 100) / 100;
}

function dedupeStringArray(raw: unknown, maxItems = 40): string[] {
  if (!Array.isArray(raw)) {
    if (typeof raw === 'string' && raw.trim()) {
      return raw
        .split(/[,，、;\n]+/)
        .map((s) => stripAiCitationArtifacts(s.trim()))
        .filter(Boolean)
        .slice(0, maxItems);
    }
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const cleaned = stripAiCitationArtifacts(String(item || '').trim());
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
      if (out.length >= maxItems) break;
    }
  }
  return out;
}

function normalizeThemeIdCandidate(rawId: unknown, index: number, usedIds: Set<string>): string {
  const rawStr = typeof rawId === 'string' ? rawId.trim().toUpperCase() : '';
  const m = rawStr.match(/^T[-_]?0*(\d+)$/);
  let candidate = m ? `T${String(Number(m[1])).padStart(2, '0')}` : '';
  if (!candidate || usedIds.has(candidate)) {
    let seq = index + 1;
    while (usedIds.has(`T${String(seq).padStart(2, '0')}`)) {
      seq++;
    }
    candidate = `T${String(seq).padStart(2, '0')}`;
  }
  usedIds.add(candidate);
  return candidate;
}

/**
 * Format compact tab-separated vocabulary list (`w-0001\tword\tmeaning`)
 * for lightweight file upload / batch prompts.
 */
export function buildCompactVocabText(effectiveWords: VocabItem[]): string {
  const normalized = assignStableVocabIds(effectiveWords || []);
  return normalized
    .map((w) => {
      const id = w.id || '';
      const word = String(w.word || '').replace(/[\r\n\t]+/g, ' ').trim();
      const meaning = String(w.meaning || '').replace(/[\r\n\t]+/g, ' ').trim();
      return `${id}\t${word}\t${meaning}`;
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Stratified even sampling across a potentially large vocabulary list
 * so theme planning sees full breadth rather than just the head slice.
 */
export function sampleVocabForThemePlanning(
  effectiveWords: VocabItem[],
  maxCount = 120
): VocabItem[] {
  const normalized = assignStableVocabIds(effectiveWords || []);
  if (normalized.length <= maxCount) return normalized;
  const limit = Math.max(10, Math.floor(maxCount));
  const out: VocabItem[] = [];
  const step = normalized.length / limit;
  const seen = new Set<string>();
  for (let i = 0; i < limit; i++) {
    const idx = Math.min(normalized.length - 1, Math.floor(i * step));
    const item = normalized[idx];
    const key = item.id || normalizeWordKey(item.word);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Normalize raw theme definitions from AI output, user edits, or disk JSON.
 */
export function normalizeVocabThemes(rawThemes: any[]): VocabThemeItem[] {
  if (!Array.isArray(rawThemes)) return [];
  const usedIds = new Set<string>();
  const out: VocabThemeItem[] = [];

  for (let i = 0; i < rawThemes.length; i++) {
    const raw = rawThemes[i];
    if (!raw || typeof raw !== 'object') continue;
    const rawName = stripAiCitationArtifacts(
      String(raw.name || raw.title || raw.topicGroup || raw.topic || '').trim()
    );
    if (!rawName) continue;

    const id = normalizeThemeIdCandidate(raw.id || raw.themeId, i, usedIds);
    const description = stripAiCitationArtifacts(
      String(raw.description || raw.scope || raw.summary || '').trim()
    );
    const keywords = dedupeStringArray(raw.keywords ?? raw.cues, 45);
    const subtopics = dedupeStringArray(raw.subtopics ?? raw.articles, 20);
    const isGeneralFallback = Boolean(
      raw.isGeneralFallback ||
        raw.generalFallback ||
        /(?:通用|跨领域|综合|abstract|general)/i.test(rawName)
    );

    out.push({
      id,
      name: rawName,
      description: description || `围绕「${rawName}」核心概念与表达展开的主题模块`,
      weight: clampWeight(raw.weight ?? (raw.isInterestBoosted ? 1.8 : 1.0)),
      ...(raw.isInterestBoosted ? { isInterestBoosted: true } : {}),
      ...(isGeneralFallback ? { isGeneralFallback: true } : {}),
      keywords,
      ...(subtopics.length > 0 ? { subtopics } : {}),
    });
  }

  return out;
}

/**
 * Parse AI-generated or user-imported JSON for Step 1A curriculum themes.
 */
export function parseImportedVocabThemes(rawInput: string): VocabThemeItem[] {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    throw new Error('主题规划输入为空，请粘贴 AI 输出的主题 JSON。');
  }

  const parsed = tryExtractJsonObject(trimmed);
  let candidateList: any[] | null = null;
  if (Array.isArray(parsed)) {
    candidateList = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const nested = parsed.themes || parsed.topics || parsed.categories || parsed.data;
    if (Array.isArray(nested)) {
      candidateList = nested;
    }
  }

  const normalized = normalizeVocabThemes(candidateList || []);
  if (normalized.length === 0) {
    throw new Error('未能解析出有效的课程主题列表，请确认输出包含 themes 数组及主题 name 字段。');
  }
  return normalized;
}

function buildThemeLookup(themes: VocabThemeItem[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const t of themes) {
    const upper = t.id.trim().toUpperCase();
    lookup.set(upper, t.id);
    const m = upper.match(/^T0*(\d+)$/);
    if (m) {
      lookup.set(`T${m[1]}`, t.id);
      lookup.set(`T${m[1].padStart(2, '0')}`, t.id);
      lookup.set(`T-${m[1].padStart(2, '0')}`, t.id);
    }
    lookup.set(t.name.trim().toLowerCase(), t.id);
  }
  return lookup;
}

function buildWordLookup(effectiveWords: VocabItem[]): {
  byId: Map<string, string>;
  byWord: Map<string, string>;
} {
  const normalized = assignStableVocabIds(effectiveWords || []);
  const byId = new Map<string, string>();
  const byWord = new Map<string, string>();
  for (const w of normalized) {
    if (!w.id) continue;
    const idClean = w.id.trim();
    byId.set(idClean, idClean);
    byId.set(idClean.toLowerCase(), idClean);
    const m = idClean.match(/^w-0*(\d+)$/i);
    if (m) {
      byId.set(`w-${m[1]}`, idClean);
    }
    const wordKey = normalizeWordKey(w.word);
    if (wordKey && !byWord.has(wordKey)) {
      byWord.set(wordKey, idClean);
    }
  }
  return { byId, byWord };
}

function resolveWordIdToken(
  token: string,
  lookup: { byId: Map<string, string>; byWord: Map<string, string> }
): string | null {
  const clean = token.replace(/^["'`\s]+|["'`\s]+$/g, '').trim();
  if (!clean) return null;
  const direct = lookup.byId.get(clean) || lookup.byId.get(clean.toLowerCase());
  if (direct) return direct;
  const paddedMatch = clean.match(/^w[-_]?0*(\d+)$/i);
  if (paddedMatch) {
    const unpadded = `w-${Number(paddedMatch[1])}`;
    const byUnpadded = lookup.byId.get(unpadded);
    if (byUnpadded) return byUnpadded;
  }
  const normWord = normalizeWordKey(clean);
  if (normWord && lookup.byWord.has(normWord)) {
    return lookup.byWord.get(normWord)!;
  }
  return null;
}

function resolveThemeTokens(rawVal: unknown, themeLookup: Map<string, string>): string[] {
  const rawTokens: string[] = [];
  if (Array.isArray(rawVal)) {
    for (const item of rawVal) {
      rawTokens.push(String(item || ''));
    }
  } else if (rawVal && typeof rawVal === 'object') {
    const nested = (rawVal as any).themeIds || (rawVal as any).themes || (rawVal as any).topics;
    return resolveThemeTokens(nested, themeLookup);
  } else if (typeof rawVal === 'string') {
    for (const part of rawVal.split(/[,，、;；|\s]+/)) {
      if (part.trim()) rawTokens.push(part);
    }
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of rawTokens) {
    const clean = tok.replace(/^["'`[\]()]+|["'`[\]()]+$/g, '').trim();
    if (!clean) continue;
    const matched =
      themeLookup.get(clean.toUpperCase()) ||
      themeLookup.get(clean.toLowerCase()) ||
      (() => {
        const m = clean.toUpperCase().match(/\bT[-_]?0*(\d+)\b/);
        return m ? themeLookup.get(`T${m[1]}`) : undefined;
      })();
    if (matched && !seen.has(matched)) {
      seen.add(matched);
      out.push(matched);
      if (out.length >= 4) break;
    }
  }
  return out;
}

/**
 * Parse Step 1B word-to-theme mappings from AI or file output.
 * Supports:
 * 1. JSON `{ assignments: { "w-0001": ["T02", "T01"] } }` / `{ wordThemes: ... }` / bare object
 * 2. Theme-inverted JSON `{ themes: { "T01": ["w-0001", ...] } }` / `{ groups: ... }`
 * 3. JSON array `[{ id|wordId|word, themes|themeIds|theme }]`
 * 4. Compact line format (`w-0001: T02, T01` / `wildfire: T06`) & truncated JSON salvage
 */
export function parseImportedWordThemeMappings(
  rawInput: string,
  effectiveWords: VocabItem[],
  themes: VocabThemeItem[],
  source: 'ai' | 'local' | 'manual' = 'ai'
): {
  mappings: Record<string, VocabWordThemeMapping>;
  acceptedWordCount: number;
  ignoredEntriesCount: number;
} {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed || themes.length === 0) {
    return { mappings: {}, acceptedWordCount: 0, ignoredEntriesCount: 0 };
  }

  const wordLookup = buildWordLookup(effectiveWords);
  const themeLookup = buildThemeLookup(themes);
  const mappings: Record<string, VocabWordThemeMapping> = {};
  const nowIso = new Date().toISOString();
  let ignoredEntriesCount = 0;

  const mergeWordThemes = (wordId: string, themeIds: string[]) => {
    if (themeIds.length === 0) {
      ignoredEntriesCount++;
      return;
    }
    const existing = mappings[wordId]?.themeIds || [];
    const merged: string[] = [...existing];
    for (const tid of themeIds) {
      if (!merged.includes(tid)) merged.push(tid);
      if (merged.length >= 4) break;
    }
    mappings[wordId] = {
      themeIds: merged,
      source,
      updatedAt: nowIso,
    };
  };

  const parsed = tryExtractJsonObject(trimmed);
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        if (!row || typeof row !== 'object') {
          ignoredEntriesCount++;
          continue;
        }
        const rawKey = String(row.id || row.wordId || row.word || '').trim();
        const wordId = resolveWordIdToken(rawKey, wordLookup);
        if (!wordId) {
          ignoredEntriesCount++;
          continue;
        }
        const resolvedThemes = resolveThemeTokens(
          row.themeIds ?? row.themes ?? row.theme ?? row.topicIds,
          themeLookup
        );
        mergeWordThemes(wordId, resolvedThemes);
      }
    } else {
      const invertedObj = parsed.themes || parsed.groups;
      const forwardObj = parsed.assignments || parsed.wordThemes;
      const candidateObj = forwardObj && typeof forwardObj === 'object' ? forwardObj : parsed;

      const checkIsThemeInverted = (obj: Record<string, unknown>): boolean => {
        const keys = Object.keys(obj);
        if (keys.length === 0) return false;
        let themeKeyHits = 0;
        let sample = 0;
        for (const k of keys.slice(0, 12)) {
          sample++;
          if (themeLookup.has(k.trim().toUpperCase()) || themeLookup.has(k.trim().toLowerCase())) {
            themeKeyHits++;
          }
        }
        return sample > 0 && themeKeyHits / sample >= 0.5;
      };

      if (invertedObj && typeof invertedObj === 'object' && !Array.isArray(invertedObj)) {
        for (const [themeKey, wordList] of Object.entries(invertedObj)) {
          const resolvedThemeIds = resolveThemeTokens(themeKey, themeLookup);
          const tid = resolvedThemeIds[0];
          if (!tid || !Array.isArray(wordList)) {
            ignoredEntriesCount++;
            continue;
          }
          for (const rawW of wordList) {
            const wid = resolveWordIdToken(String(rawW || ''), wordLookup);
            if (wid) mergeWordThemes(wid, [tid]);
            else ignoredEntriesCount++;
          }
        }
      } else if (checkIsThemeInverted(candidateObj)) {
        for (const [themeKey, wordList] of Object.entries(candidateObj)) {
          const tid = resolveThemeTokens(themeKey, themeLookup)[0];
          if (!tid || !Array.isArray(wordList)) {
            ignoredEntriesCount++;
            continue;
          }
          for (const rawW of wordList) {
            const wid = resolveWordIdToken(String(rawW || ''), wordLookup);
            if (wid) mergeWordThemes(wid, [tid]);
            else ignoredEntriesCount++;
          }
        }
      } else {
        for (const [rawKey, rawVal] of Object.entries(candidateObj)) {
          if (rawKey === 'assignments' || rawKey === 'wordThemes' || rawKey === 'themes') continue;
          const wid = resolveWordIdToken(rawKey, wordLookup);
          if (!wid) {
            ignoredEntriesCount++;
            continue;
          }
          const resolvedThemes = resolveThemeTokens(rawVal, themeLookup);
          mergeWordThemes(wid, resolvedThemes);
        }
      }
    }
  }

  // Fallback / truncation-resilient line & JSON-entry parser
  if (Object.keys(mappings).length === 0) {
    // 1. Salvage JSON-like `"w-0001": ["T02", "T01"]` pairs even in truncated output
    const jsonPairRegex = /["']([^"'\n]{1,64})["']\s*:\s*\[([^\]]+)\]/g;
    let jm: RegExpExecArray | null;
    while ((jm = jsonPairRegex.exec(trimmed)) !== null) {
      const wid = resolveWordIdToken(jm[1], wordLookup);
      if (!wid) continue;
      const tids = resolveThemeTokens(jm[2], themeLookup);
      if (tids.length > 0) mergeWordThemes(wid, tids);
    }

    // 2. Parse compact line format: `w-0001: T02, T01` / `w-0001\tT02 T01` / `w-0001 -> T02, T01` / `wildfire: T06`
    const lines = trimmed.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('```') || line.startsWith('#') || line.startsWith('//')) {
        continue;
      }
      const lineMatch = line.match(
        /^[-*•]?\s*(.+?)\s*(?:[:：]|->|=>|\t|\|)\s*(.+)$/
      );
      if (!lineMatch) continue;
      const wid = resolveWordIdToken(lineMatch[1].trim(), wordLookup);
      if (!wid) {
        ignoredEntriesCount++;
        continue;
      }
      const tids = resolveThemeTokens(lineMatch[2], themeLookup);
      mergeWordThemes(wid, tids);
    }
  }

  return {
    mappings,
    acceptedWordCount: Object.keys(mappings).length,
    ignoredEntriesCount,
  };
}

interface ThemeCueIndex {
  theme: VocabThemeItem;
  englishExactTokens: Set<string>;
  englishStemTokens: string[];
  cjkExplicitKeywords: string[];
  cjkBigrams: Set<string>;
}

function extractCjkBigrams(text: string): Set<string> {
  const bigrams = new Set<string>();
  const runs = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) {
      bigrams.add(run.slice(i, i + 2));
    }
  }
  return bigrams;
}

function buildThemeCueIndices(themes: VocabThemeItem[]): ThemeCueIndex[] {
  return themes.map((theme) => {
    const englishExactTokens = new Set<string>();
    const englishStemSet = new Set<string>();
    const cjkExplicitSet = new Set<string>();

    const allCueStrings = [
      theme.name,
      ...(theme.subtopics || []),
      ...(theme.keywords || []),
    ];

    for (const raw of allCueStrings) {
      const clean = String(raw || '').trim();
      if (!clean) continue;
      const enWords = clean.toLowerCase().match(/[a-z]+(?:[-'][a-z]+)*/g) || [];
      for (const ew of enWords) {
        if (ew.length >= 2) {
          englishExactTokens.add(ew);
          if (ew.length >= 5) {
            englishStemSet.add(ew.slice(0, 5));
          }
        }
      }
      const cjkSegments = clean.match(/[\u4e00-\u9fff]+/g) || [];
      for (const seg of cjkSegments) {
        if (seg.length >= 2) {
          cjkExplicitSet.add(seg);
        }
      }
    }

    for (const kw of theme.keywords || []) {
      const clean = String(kw || '').trim();
      if (/^[\u4e00-\u9fff]$/.test(clean)) {
        cjkExplicitSet.add(clean);
      }
    }

    const combinedCjkText = [
      theme.name,
      theme.description,
      ...(theme.subtopics || []),
      ...(theme.keywords || []),
    ].join(' ');

    return {
      theme,
      englishExactTokens,
      englishStemTokens: Array.from(englishStemSet),
      cjkExplicitKeywords: Array.from(cjkExplicitSet),
      cjkBigrams: extractCjkBigrams(combinedCjkText),
    };
  });
}

function selectGeneralFallbackTheme(themes: VocabThemeItem[]): VocabThemeItem {
  const explicit = themes.find((t) => t.isGeneralFallback);
  if (explicit) return explicit;
  const byName = themes.find((t) =>
    /(?:通用|跨领域|综合|抽象|general|abstract)/i.test(`${t.name} ${t.description}`)
  );
  if (byName) return byName;
  return themes[themes.length - 1];
}

function scoreWordAgainstTheme(item: VocabItem, cue: ThemeCueIndex): number {
  const wordLower = normalizeWordKey(item.word);
  const meaningText = String(item.meaning || '');
  const tagsText = Array.isArray(item.tags) ? item.tags.join(' ') : '';
  const combinedEnText = `${wordLower} ${meaningText.toLowerCase()} ${tagsText.toLowerCase()}`;
  const enTokens = combinedEnText.match(/[a-z]+(?:[-'][a-z]+)*/g) || [];
  const cjkText = `${meaningText} ${tagsText}`;

  let score = 0;

  if (cue.englishExactTokens.has(wordLower)) {
    score += 4.5;
  }
  for (const tok of enTokens) {
    if (tok !== wordLower && cue.englishExactTokens.has(tok)) {
      score += 3.2;
    } else if (tok.length >= 5) {
      const prefix = tok.slice(0, 5);
      if (cue.englishStemTokens.includes(prefix)) {
        score += 2.2;
      }
    }
  }

  for (const kw of cue.cjkExplicitKeywords) {
    if (cjkText.includes(kw)) {
      score += kw.length >= 2 ? 3.0 : 1.0;
    }
  }

  const wordBigrams = extractCjkBigrams(cjkText);
  let bigramHits = 0;
  for (const bg of wordBigrams) {
    if (cue.cjkBigrams.has(bg)) {
      bigramHits++;
    }
  }
  score += Math.min(2.1, bigramHits * 0.35);

  return Math.round(score * 100) / 100;
}

/**
 * Local fast bilingual cue-matching helper using Step 1A's AI-generated theme keywords.
 * Never overwrites `'ai'` or `'manual'` entries unless `overwriteExisting` is explicitly true.
 */
export function matchWordsToThemesLocally(
  effectiveWords: VocabItem[],
  themes: VocabThemeItem[],
  existingMappings: Record<string, VocabWordThemeMapping> = {},
  options?: {
    mode?: 'confident_only' | 'fill_remaining';
    overwriteExisting?: boolean;
  }
): {
  mappings: Record<string, VocabWordThemeMapping>;
  matchedCount: number;
  fallbackCount: number;
} {
  const normalizedWords = assignStableVocabIds(effectiveWords || []);
  const nextMappings: Record<string, VocabWordThemeMapping> = { ...existingMappings };
  if (themes.length === 0) {
    return { mappings: nextMappings, matchedCount: 0, fallbackCount: 0 };
  }

  const mode = options?.mode || 'confident_only';
  const overwriteExisting = Boolean(options?.overwriteExisting);
  const fallbackTheme = selectGeneralFallbackTheme(themes);
  const scorableThemes = themes.filter(
    (t) => t.id !== fallbackTheme.id || themes.length === 1
  );
  const cueIndices = buildThemeCueIndices(scorableThemes);
  const nowIso = new Date().toISOString();

  let matchedCount = 0;
  let fallbackCount = 0;

  for (const item of normalizedWords) {
    const id = item.id;
    if (!id) continue;
    const prev = nextMappings[id];
    if (
      !overwriteExisting &&
      prev &&
      prev.themeIds.length > 0 &&
      (prev.source === 'ai' || prev.source === 'manual' || mode === 'fill_remaining')
    ) {
      continue;
    }

    const scored = cueIndices
      .map((cue) => ({
        themeId: cue.theme.id,
        score: scoreWordAgainstTheme(item, cue),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    const topScore = scored[0]?.score || 0;

    if (mode === 'confident_only') {
      if (topScore >= 2.0) {
        const picked = scored
          .filter((s) => s.score >= Math.max(1.5, topScore * 0.5))
          .slice(0, 3)
          .map((s) => s.themeId);
        if (picked.length > 0) {
          nextMappings[id] = {
            themeIds: picked,
            source: 'local',
            confidence: Math.min(0.95, Math.round((topScore / 6) * 100) / 100),
            updatedAt: nowIso,
          };
          matchedCount++;
        }
      }
      continue;
    }

    // fill_remaining mode
    if (topScore > 0) {
      const picked = scored
        .filter((s) => s.score >= Math.max(0.7, topScore * 0.45))
        .slice(0, 3)
        .map((s) => s.themeId);
      if (picked.length > 0) {
        nextMappings[id] = {
          themeIds: picked,
          source: 'local',
          confidence: Math.min(0.9, Math.round((topScore / 6) * 100) / 100),
          updatedAt: nowIso,
        };
        matchedCount++;
        continue;
      }
    }

    nextMappings[id] = {
      themeIds: [fallbackTheme.id],
      source: 'local',
      confidence: 0.25,
      updatedAt: nowIso,
    };
    fallbackCount++;
  }

  return {
    mappings: nextMappings,
    matchedCount,
    fallbackCount,
  };
}

/**
 * Compute Step 1B progress metrics and per-theme candidate counts.
 */
export function getVocabThemeMappingProgress(
  effectiveWords: VocabItem[],
  themes: VocabThemeItem[],
  wordThemes: Record<string, VocabWordThemeMapping> = {}
): {
  totalWords: number;
  aiMappedCount: number;
  localMappedCount: number;
  manualMappedCount: number;
  totalMappedCount: number;
  unmappedWordIds: string[];
  nonAiWordIds: string[];
  themeCandidateCounts: Record<string, { primary: number; candidate: number }>;
} {
  const normalizedWords = assignStableVocabIds(effectiveWords || []);
  const validThemeSet = new Set(themes.map((t) => t.id));

  let aiMappedCount = 0;
  let localMappedCount = 0;
  let manualMappedCount = 0;
  let totalMappedCount = 0;
  const unmappedWordIds: string[] = [];
  const nonAiWordIds: string[] = [];
  const themeCandidateCounts: Record<string, { primary: number; candidate: number }> = {};

  for (const t of themes) {
    themeCandidateCounts[t.id] = { primary: 0, candidate: 0 };
  }

  for (const w of normalizedWords) {
    const id = w.id;
    if (!id) continue;
    const mapping = wordThemes[id];
    const validIds = mapping
      ? Array.from(new Set(mapping.themeIds.filter((tid) => validThemeSet.has(tid))))
      : [];

    if (validIds.length === 0) {
      unmappedWordIds.push(id);
      nonAiWordIds.push(id);
      continue;
    }

    totalMappedCount++;
    if (mapping.source === 'ai') {
      aiMappedCount++;
    } else if (mapping.source === 'manual') {
      manualMappedCount++;
    } else {
      localMappedCount++;
      nonAiWordIds.push(id);
    }

    validIds.forEach((tid, idx) => {
      const rec = themeCandidateCounts[tid];
      if (!rec) return;
      rec.candidate++;
      if (idx === 0) rec.primary++;
    });
  }

  return {
    totalWords: normalizedWords.length,
    aiMappedCount,
    localMappedCount,
    manualMappedCount,
    totalMappedCount,
    unmappedWordIds,
    nonAiWordIds,
    themeCandidateCounts,
  };
}

/**
 * Select the next batch of unmapped (or non-AI) words for Chat/API semantic mapping.
 */
export function getNextMappingBatch(
  effectiveWords: VocabItem[],
  wordThemes: Record<string, VocabWordThemeMapping> = {},
  options?: { batchSize?: number; includeLocal?: boolean }
): {
  batchWords: VocabItem[];
  batchIndex: number;
  totalBatches: number;
  totalRemaining: number;
  remainingAfterBatch: number;
} {
  const normalizedWords = assignStableVocabIds(effectiveWords || []);
  const includeLocal = Boolean(options?.includeLocal);
  const pendingWords = normalizedWords.filter((w) => {
    const id = w.id;
    if (!id) return false;
    const entry = wordThemes[id];
    if (!entry || !Array.isArray(entry.themeIds) || entry.themeIds.length === 0) {
      return true;
    }
    return includeLocal && entry.source === 'local';
  });

  const totalRemaining = pendingWords.length;
  const rawBatchSize = Number(options?.batchSize);
  const batchSize =
    Number.isFinite(rawBatchSize) && rawBatchSize > 0
      ? Math.min(totalRemaining || 1, Math.round(rawBatchSize))
      : Math.min(500, Math.max(1, totalRemaining));

  const batchWords = totalRemaining > 0 ? pendingWords.slice(0, batchSize) : [];
  const totalBatches = totalRemaining > 0 ? Math.ceil(totalRemaining / batchSize) : 0;
  const remainingAfterBatch = Math.max(0, totalRemaining - batchWords.length);

  return {
    batchWords,
    batchIndex: totalRemaining > 0 ? 1 : 0,
    totalBatches,
    totalRemaining,
    remainingAfterBatch,
  };
}

/**
 * Compute theme target word quotas proportional to `theme.weight`, clamped within
 * `[minSupply, maxSupply]` and reconciled deterministically to `totalPendingWords`.
 */
function computeThemeWordQuotas(params: {
  themes: VocabThemeItem[];
  mandatoryCounts: Map<string, number>;
  eligibleCounts: Map<string, number>;
  totalPendingWords: number;
}): Map<string, number> {
  const { themes, mandatoryCounts, eligibleCounts, totalPendingWords } = params;
  const quotas = new Map<string, number>();

  for (const t of themes) {
    const minNeed = mandatoryCounts.get(t.id) || 0;
    const maxCap = eligibleCounts.get(t.id) || 0;
    quotas.set(t.id, Math.min(maxCap, minNeed));
  }

  let assignedTotal = Array.from(quotas.values()).reduce((a, b) => a + b, 0);
  const flexibleDemand = Math.max(0, totalPendingWords - assignedTotal);
  const weightSum = themes.reduce((sum, t) => {
    const room = Math.max(0, (eligibleCounts.get(t.id) || 0) - (quotas.get(t.id) || 0));
    return room > 0 ? sum + Math.max(0.1, t.weight) : sum;
  }, 0);

  if (flexibleDemand > 0 && weightSum > 0) {
    const remainders: Array<{ id: string; frac: number; weight: number }> = [];
    for (const t of themes) {
      const current = quotas.get(t.id) || 0;
      const cap = eligibleCounts.get(t.id) || 0;
      const room = Math.max(0, cap - current);
      if (room <= 0) continue;
      const idealAdd = (flexibleDemand * Math.max(0.1, t.weight)) / weightSum;
      const addFloor = Math.min(room, Math.floor(idealAdd));
      quotas.set(t.id, current + addFloor);
      assignedTotal += addFloor;
      remainders.push({
        id: t.id,
        frac: idealAdd - Math.floor(idealAdd),
        weight: t.weight,
      });
    }

    // Water-fill any remaining capacity slots
    remainders.sort((a, b) => b.frac - a.frac || b.weight - a.weight);
    let safety = 0;
    while (assignedTotal < totalPendingWords && safety < 5000) {
      safety++;
      let progressed = false;
      for (const r of remainders) {
        if (assignedTotal >= totalPendingWords) break;
        const cur = quotas.get(r.id) || 0;
        const cap = eligibleCounts.get(r.id) || 0;
        if (cur < cap) {
          quotas.set(r.id, cur + 1);
          assignedTotal++;
          progressed = true;
        }
      }
      if (!progressed) break;
    }
  }

  return quotas;
}

/**
 * Deterministically allocate all effective vocabulary words into themed reading/learning sections
 * using Step 1A's weighted themes and Step 1B's candidate mappings.
 */
export function allocateVocabByThemes(
  course: Course,
  plan: VocabThemePlan,
  options?: {
    newWordsPerArticle?: number;
    totalArticles?: number;
    interleaveThemes?: boolean;
    preserveStartedSlots?: boolean;
    fallbackUnmapped?: boolean;
  }
): {
  summary: NonNullable<VocabThemePlan['allocationSummary']>;
  coverage: CourseVocabCoverageRecord | undefined;
  totalSections: number;
} {
  if (!course.englishConfig) {
    throw new Error('当前课程未启用语言词库配置');
  }

  const effectiveWords = assignStableVocabIds(course.englishConfig.effectiveWords || []);
  course.englishConfig.effectiveWords = effectiveWords;
  const vocabById = new Map<string, VocabItem>();
  for (const w of effectiveWords) {
    if (w.id) vocabById.set(w.id, w);
  }

  const baseThemes = normalizeVocabThemes(plan.themes || []);
  if (baseThemes.length === 0) {
    throw new Error('请先在步骤 1A 中规划并保存至少 1 个课程主题');
  }

  const newWordsPerArticle = Math.max(
    1,
    Math.min(
      100,
      Math.round(
        options?.newWordsPerArticle ||
          course.englishConfig.newWordsPerArticle ||
          course.englishConfig.dailyWordCount ||
          15
      )
    )
  );
  const preserveStartedSlots = options?.preserveStartedSlots !== false;
  const interleaveThemes =
    options?.interleaveThemes !== undefined
      ? Boolean(options.interleaveThemes)
      : plan.interleaveThemes !== false;

  // 1. Preserve already-generated lesson slots if requested
  const lockedSlots: DailyPlanSlot[] = [];
  const lockedWordIds = new Set<string>();
  if (preserveStartedSlots) {
    for (const slot of course.dailyPlan || []) {
      if (!slot.lesson) continue;
      lockedSlots.push({ ...slot });
      for (const id of slot.targetWordIds || []) {
        lockedWordIds.add(id);
      }
      for (const w of slot.assignedWords || []) {
        if (w.id) lockedWordIds.add(w.id);
      }
    }
  }

  const workingThemes: VocabThemeItem[] = baseThemes.map((t) => ({ ...t }));
  const baseStartDate = course.startDate || getTodayDateString();

  // Pure topic-article allocation (when no vocab bank is attached)
  if (effectiveWords.length === 0) {
    const targetArticleCount = Math.max(
      1,
      Math.min(
        200,
        Math.round(
          options?.totalArticles ||
            course.englishConfig.estimatedArticleCount ||
            course.durationDays ||
            10
        )
      )
    );
    const remainingCount = Math.max(0, targetArticleCount - lockedSlots.length);
    const allocThemes = [...workingThemes].sort(
      (a, b) => b.weight - a.weight || a.id.localeCompare(b.id)
    );
    const weightTotal = allocThemes.reduce((s, t) => s + Math.max(0.1, t.weight), 0) || 1;

    const countsByThemeId = new Map<string, number>();
    const remainders: Array<{ id: string; frac: number; weight: number }> = [];
    let allocated = 0;
    for (const t of allocThemes) {
      const exact = (remainingCount * Math.max(0.1, t.weight)) / weightTotal;
      const floored = Math.floor(exact);
      countsByThemeId.set(t.id, floored);
      allocated += floored;
      remainders.push({ id: t.id, frac: exact - floored, weight: t.weight });
    }
    remainders.sort((a, b) => b.frac - a.frac || b.weight - a.weight || a.id.localeCompare(b.id));
    for (let i = 0; allocated < remainingCount && i < remainders.length; i++) {
      const id = remainders[i].id;
      countsByThemeId.set(id, (countsByThemeId.get(id) || 0) + 1);
      allocated++;
    }

    interface PendingTopicSection {
      theme: VocabThemeItem;
      sectionWithinThemeIdx: number;
      totalThemeSections: number;
    }

    const queuesByTheme: PendingTopicSection[][] = [];
    for (const t of allocThemes) {
      const cnt = countsByThemeId.get(t.id) || 0;
      if (cnt <= 0) continue;
      const queue: PendingTopicSection[] = [];
      for (let s = 0; s < cnt; s++) {
        queue.push({
          theme: t,
          sectionWithinThemeIdx: s + 1,
          totalThemeSections: cnt,
        });
      }
      queuesByTheme.push(queue);
    }

    const orderedPendingSections: PendingTopicSection[] = [];
    if (interleaveThemes && queuesByTheme.length > 1) {
      const totalSectionsToSchedule = queuesByTheme.reduce((sum, q) => sum + q.length, 0);
      const totalPerQueue = queuesByTheme.map((q) => q.length);
      const cursorPerQueue = queuesByTheme.map(() => 0);

      for (let step = 1; step <= totalSectionsToSchedule; step++) {
        let bestQueueIdx = -1;
        let bestDeficit = -Infinity;
        for (let qi = 0; qi < queuesByTheme.length; qi++) {
          const remaining = totalPerQueue[qi] - cursorPerQueue[qi];
          if (remaining <= 0) continue;
          const expectedByNow = (step * totalPerQueue[qi]) / totalSectionsToSchedule;
          const deficit = expectedByNow - cursorPerQueue[qi];
          if (deficit > bestDeficit) {
            bestDeficit = deficit;
            bestQueueIdx = qi;
          }
        }
        if (bestQueueIdx === -1) break;
        orderedPendingSections.push(queuesByTheme[bestQueueIdx][cursorPerQueue[bestQueueIdx]++]);
      }
    } else {
      for (const q of queuesByTheme) {
        orderedPendingSections.push(...q);
      }
    }

    const nextDailyPlan: DailyPlanSlot[] = [...lockedSlots];
    for (const item of orderedPendingSections) {
      const dayIndex = nextDailyPlan.length + 1;
      const subtopicHint =
        item.theme.subtopics && item.theme.subtopics.length > 0
          ? item.theme.subtopics[(item.sectionWithinThemeIdx - 1) % item.theme.subtopics.length]
          : '';
      const sectionPartLabel =
        item.totalThemeSections > 1
          ? `（${item.sectionWithinThemeIdx}/${item.totalThemeSections}）`
          : '';
      const titleFocus = subtopicHint ? `${item.theme.name} · ${subtopicHint}` : item.theme.name;

      nextDailyPlan.push({
        id: ensureStableSectionId(dayIndex),
        dayIndex,
        date: baseStartDate,
        topicGroup: item.theme.name,
        themeId: item.theme.id,
        title: `第 ${dayIndex} 讲：${titleFocus}${sectionPartLabel}`,
        objective: `围绕「${item.theme.name}${subtopicHint ? ` - ${subtopicHint}` : ''}」阅读近期完整英文文章，完成深度阅读理解、高价值词汇精讲、长难句解析与运用练习。`,
        keyTopics: [
          item.theme.name,
          ...(subtopicHint ? [subtopicHint] : []),
          ...(item.theme.keywords.slice(0, 2)),
        ].slice(0, 4),
        teachingScope: `${item.theme.name}${subtopicHint ? ` · ${subtopicHint}` : ''}（第 ${item.sectionWithinThemeIdx}/${item.totalThemeSections} 篇）`,
        targetWordIds: [],
        assignedWords: [],
      });
    }

    course.dailyPlan = allocateSectionsToDays(
      nextDailyPlan,
      course.durationDays,
      baseStartDate
    );
    course.dailySchedule = buildCourseDailySchedule(
      course.dailyPlan,
      course.durationDays,
      baseStartDate
    );
    course.englishConfig.estimatedArticleCount = course.dailyPlan.length;

    const distSectionCount = new Map<string, number>();
    for (const slot of course.dailyPlan) {
      const matchedTheme =
        workingThemes.find((t) => t.id === slot.themeId) ||
        workingThemes.find((t) => t.name === slot.topicGroup);
      const key = matchedTheme?.id || slot.themeId || 'OTHER';
      distSectionCount.set(key, (distSectionCount.get(key) || 0) + 1);
    }

    const denomSections = course.dailyPlan.length || 1;
    const themeDistribution = workingThemes
      .map((t) => {
        const sc = distSectionCount.get(t.id) || 0;
        return {
          themeId: t.id,
          themeName: t.name,
          wordCount: 0,
          sectionCount: sc,
          sharePct: Math.round((sc / denomSections) * 1000) / 10,
        };
      })
      .filter((d) => d.sectionCount > 0);

    const summary: NonNullable<VocabThemePlan['allocationSummary']> = {
      totalWords: 0,
      mappedByAiCount: 0,
      mappedByLocalCount: 0,
      unmappedFallbackCount: 0,
      totalSections: course.dailyPlan.length,
      themeDistribution,
    };

    course.englishConfig.vocabThemePlan = {
      themes: workingThemes,
      wordThemes: plan.wordThemes || {},
      interleaveThemes,
      lastThemesUpdatedAt: plan.lastThemesUpdatedAt || new Date().toISOString(),
      lastMappingUpdatedAt: plan.lastMappingUpdatedAt,
      lastAllocatedAt: new Date().toISOString(),
      allocationSummary: summary,
    };
    course.englishConfig.lastAllocatedAt = new Date().toISOString();

    const coverage = syncCourseVocabCoverage(course);
    return {
      summary,
      coverage,
      totalSections: course.dailyPlan.length,
    };
  }

  const pendingWords = effectiveWords.filter((w) => w.id && !lockedWordIds.has(w.id));

  // 2. Resolve candidate themes for every pending word
  const wordThemesCopy: Record<string, VocabWordThemeMapping> = {
    ...(plan.wordThemes || {}),
  };
  const validThemeSet = new Set(workingThemes.map((t) => t.id));

  const fallbackResult =
    options?.fallbackUnmapped !== false
      ? matchWordsToThemesLocally(pendingWords, workingThemes, wordThemesCopy, {
          mode: 'fill_remaining',
          overwriteExisting: false,
        })
      : { mappings: wordThemesCopy, matchedCount: 0, fallbackCount: 0 };

  let mappedByAiCount = 0;
  let mappedByLocalCount = 0;
  let unmappedFallbackCount = 0;

  const candidateListByWordId = new Map<string, string[]>();
  const mandatoryCounts = new Map<string, number>();
  const eligibleCounts = new Map<string, number>();
  for (const t of workingThemes) {
    mandatoryCounts.set(t.id, 0);
    eligibleCounts.set(t.id, 0);
  }

  const generalFallbackTheme = selectGeneralFallbackTheme(workingThemes);

  for (const w of pendingWords) {
    const id = w.id!;
    const original = wordThemesCopy[id];
    const resolvedEntry = fallbackResult.mappings[id];
    let candidates = (resolvedEntry?.themeIds || []).filter((tid) => validThemeSet.has(tid));

    if (original && original.themeIds.some((tid) => validThemeSet.has(tid))) {
      if (original.source === 'ai' || original.source === 'manual') mappedByAiCount++;
      else mappedByLocalCount++;
    } else if (candidates.length > 0 && resolvedEntry && (resolvedEntry.confidence || 0) > 0.3) {
      mappedByLocalCount++;
    } else {
      unmappedFallbackCount++;
      if (candidates.length === 0) {
        candidates = [generalFallbackTheme.id];
      }
    }

    const dedupedCandidates = Array.from(new Set(candidates));
    candidateListByWordId.set(id, dedupedCandidates);

    if (dedupedCandidates.length === 1) {
      const only = dedupedCandidates[0];
      mandatoryCounts.set(only, (mandatoryCounts.get(only) || 0) + 1);
    }
    for (const tid of dedupedCandidates) {
      eligibleCounts.set(tid, (eligibleCounts.get(tid) || 0) + 1);
    }
  }

  // 3. Weighted quota calculation + single-candidate locking + multi-candidate balancing
  const themeQuotas = computeThemeWordQuotas({
    themes: workingThemes,
    mandatoryCounts,
    eligibleCounts,
    totalPendingWords: pendingWords.length,
  });

  const assignedByTheme = new Map<string, VocabItem[]>();
  const themeById = new Map<string, VocabThemeItem>();
  for (const t of workingThemes) {
    assignedByTheme.set(t.id, []);
    themeById.set(t.id, t);
  }

  const multiCandidateWords: VocabItem[] = [];
  for (const w of pendingWords) {
    const cands = candidateListByWordId.get(w.id!) || [generalFallbackTheme.id];
    if (cands.length === 1) {
      assignedByTheme.get(cands[0])!.push(w);
    } else {
      multiCandidateWords.push(w);
    }
  }

  // Sort most constrained words first for tighter quota & semantic adherence
  multiCandidateWords.sort((a, b) => {
    const lenA = (candidateListByWordId.get(a.id!) || []).length;
    const lenB = (candidateListByWordId.get(b.id!) || []).length;
    if (lenA !== lenB) return lenA - lenB;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  for (const w of multiCandidateWords) {
    const cands = candidateListByWordId.get(w.id!) || [generalFallbackTheme.id];
    let bestThemeId = cands[0];
    let bestScore = -Infinity;

    cands.forEach((tid, rankIdx) => {
      const themeObj = themeById.get(tid);
      if (!themeObj) return;
      const quota = Math.max(1, themeQuotas.get(tid) || 1);
      const currentCount = assignedByTheme.get(tid)?.length || 0;
      const quotaGap = (quota - currentCount) / quota;
      const rankScore = rankIdx === 0 ? 1.0 : rankIdx === 1 ? 0.78 : 0.62;
      const weightBonus = Math.min(0.4, Math.max(-0.15, (themeObj.weight - 1) * 0.22));
      const score = rankScore + quotaGap * 0.75 + weightBonus;
      if (score > bestScore) {
        bestScore = score;
        bestThemeId = tid;
      }
    });

    assignedByTheme.get(bestThemeId)!.push(w);
  }

  // 4. Pack each theme's assigned words evenly into reading sections
  interface PendingThemedSection {
    theme: VocabThemeItem;
    sectionWithinThemeIdx: number;
    totalThemeSections: number;
    words: VocabItem[];
  }

  const queuesByTheme: PendingThemedSection[][] = [];
  const activeThemes = workingThemes.filter(
    (t) => (assignedByTheme.get(t.id)?.length || 0) > 0
  );

  // Sort themes descending by weight for grouped mode & stable priority
  const orderedThemes = [...activeThemes].sort(
    (a, b) => b.weight - a.weight || a.id.localeCompare(b.id)
  );

  for (const t of orderedThemes) {
    const words = assignedByTheme.get(t.id) || [];
    const numSections = Math.max(1, Math.round(words.length / newWordsPerArticle));
    const baseSize = Math.floor(words.length / numSections);
    const extra = words.length % numSections;
    const queue: PendingThemedSection[] = [];
    let cursor = 0;

    for (let s = 0; s < numSections; s++) {
      const size = baseSize + (s < extra ? 1 : 0);
      const bucket = words.slice(cursor, cursor + size);
      cursor += size;
      if (bucket.length > 0) {
        queue.push({
          theme: t,
          sectionWithinThemeIdx: s + 1,
          totalThemeSections: numSections,
          words: bucket,
        });
      }
    }
    if (queue.length > 0) queuesByTheme.push(queue);
  }

  // 5. Order sections across themes (smooth proportional interleaving vs grouped blocks)
  const orderedPendingSections: PendingThemedSection[] = [];
  if (interleaveThemes && queuesByTheme.length > 1) {
    const totalSectionsToSchedule = queuesByTheme.reduce((sum, q) => sum + q.length, 0);
    const totalPerQueue = queuesByTheme.map((q) => q.length);
    const cursorPerQueue = queuesByTheme.map(() => 0);

    for (let step = 1; step <= totalSectionsToSchedule; step++) {
      let bestQueueIdx = -1;
      let bestDeficit = -Infinity;
      for (let qi = 0; qi < queuesByTheme.length; qi++) {
        const remaining = totalPerQueue[qi] - cursorPerQueue[qi];
        if (remaining <= 0) continue;
        const expectedByNow = (step * totalPerQueue[qi]) / totalSectionsToSchedule;
        const deficit = expectedByNow - cursorPerQueue[qi];
        if (deficit > bestDeficit) {
          bestDeficit = deficit;
          bestQueueIdx = qi;
        }
      }
      if (bestQueueIdx === -1) break;
      orderedPendingSections.push(queuesByTheme[bestQueueIdx][cursorPerQueue[bestQueueIdx]++]);
    }
  } else {
    for (const q of queuesByTheme) {
      orderedPendingSections.push(...q);
    }
  }

  // 6. Build DailyPlanSlots keeping locked generated sections intact
  const nextDailyPlan: DailyPlanSlot[] = [...lockedSlots];

  for (const item of orderedPendingSections) {
    const dayIndex = nextDailyPlan.length + 1;
    const subtopicHint =
      item.theme.subtopics && item.theme.subtopics.length > 0
        ? item.theme.subtopics[(item.sectionWithinThemeIdx - 1) % item.theme.subtopics.length]
        : '';
    const sampleWords = item.words
      .slice(0, 3)
      .map((w) => w.word)
      .join(', ');
    const sectionPartLabel =
      item.totalThemeSections > 1
        ? `（${item.sectionWithinThemeIdx}/${item.totalThemeSections}）`
        : '';
    const titleFocus = subtopicHint ? `${item.theme.name} · ${subtopicHint}` : item.theme.name;

    nextDailyPlan.push({
      id: ensureStableSectionId(dayIndex),
      dayIndex,
      date: baseStartDate,
      topicGroup: item.theme.name,
      themeId: item.theme.id,
      title: `第 ${dayIndex} 讲：${titleFocus}${sectionPartLabel} (${sampleWords} 等 ${item.words.length} 词)`,
      objective: `围绕「${item.theme.name}」语境精读与词汇运用，自然引入并巩固本节 ${item.words.length} 个目标词。`,
      keyTopics: [
        item.theme.name,
        ...(subtopicHint ? [subtopicHint] : []),
        ...(item.theme.keywords.slice(0, 2)),
      ].slice(0, 4),
      teachingScope: `${item.theme.name}（第 ${item.sectionWithinThemeIdx}/${item.totalThemeSections} 篇，目标新词 ${item.words.length} 词）`,
      targetWordIds: item.words.map((w) => w.id!).filter(Boolean),
      assignedWords: item.words,
    });
  }

  course.dailyPlan = allocateSectionsToDays(
    nextDailyPlan,
    course.durationDays,
    baseStartDate
  );
  course.dailySchedule = buildCourseDailySchedule(
    course.dailyPlan,
    course.durationDays,
    baseStartDate
  );

  // Recompute distribution across the final full dailyPlan
  const distWordCount = new Map<string, number>();
  const distSectionCount = new Map<string, number>();
  for (const slot of course.dailyPlan) {
    const matchedTheme =
      workingThemes.find((t) => t.id === slot.themeId) ||
      workingThemes.find((t) => t.name === slot.topicGroup);
    const key = matchedTheme?.id || slot.themeId || 'OTHER';
    const wordCount = slot.targetWordIds?.length || slot.assignedWords?.length || 0;
    distWordCount.set(key, (distWordCount.get(key) || 0) + wordCount);
    distSectionCount.set(key, (distSectionCount.get(key) || 0) + 1);
  }

  const totalEffective = effectiveWords.length || 1;
  const themeDistribution = workingThemes
    .map((t) => {
      const wc = distWordCount.get(t.id) || 0;
      const sc = distSectionCount.get(t.id) || 0;
      return {
        themeId: t.id,
        themeName: t.name,
        wordCount: wc,
        sectionCount: sc,
        sharePct: Math.round((wc / totalEffective) * 1000) / 10,
      };
    })
    .filter((d) => d.wordCount > 0 || d.sectionCount > 0);

  const summary: NonNullable<VocabThemePlan['allocationSummary']> = {
    totalWords: effectiveWords.length,
    mappedByAiCount,
    mappedByLocalCount,
    unmappedFallbackCount,
    totalSections: course.dailyPlan.length,
    themeDistribution,
  };

  course.englishConfig.vocabThemePlan = {
    themes: workingThemes,
    wordThemes: wordThemesCopy,
    interleaveThemes,
    lastThemesUpdatedAt: plan.lastThemesUpdatedAt || new Date().toISOString(),
    lastMappingUpdatedAt: plan.lastMappingUpdatedAt,
    lastAllocatedAt: new Date().toISOString(),
    allocationSummary: summary,
  };
  course.englishConfig.lastAllocatedAt = new Date().toISOString();

  const coverage = syncCourseVocabCoverage(course);
  return {
    summary,
    coverage,
    totalSections: course.dailyPlan.length,
  };
}
