import {
  Course,
  DailyLessonContent,
  DailyPlanSlot,
  DailyScheduleDay,
  ExerciseQuestion,
  ExerciseSubmissionRecord,
  PdfSplitPlanItem,
  VocabBank,
  VocabCoverageStats,
  VocabItem,
} from '../types';

/**
 * Ensure stable unique section ID (e.g. "sec-01", "sec-02") so renaming or shifting dates
 * never breaks links between outline.json, segments/sec-XX.pdf, and lessons/sec-XX.json.
 */
export function ensureStableSectionId(dayIndex: number, existingId?: string): string {
  if (existingId && typeof existingId === 'string' && /^[a-zA-Z0-9_-]+$/.test(existingId.trim())) {
    return existingId.trim();
  }
  return `sec-${String(Math.max(1, dayIndex)).padStart(2, '0')}`;
}

/**
 * Sanitize course name into a valid, collision-free folder name under `courses/`.
 * Handles illegal filesystem characters, path traversal, Windows reserved names,
 * and avoids duplicate folder names.
 */
export function sanitizeCourseFolderName(
  rawName: string,
  existingFolderNames: Iterable<string> = []
): string {
  const existingSet = new Set(Array.from(existingFolderNames).map((s) => s.toLowerCase()));

  let cleaned = (rawName || '')
    .trim()
    // Remove illegal path characters across Windows/Linux/macOS
    .replace(/[<>:"/\\|?*\x00-\x1f~#%&+{}`'=@!$,;()[\]]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/\.+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!cleaned || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) {
    cleaned = 'course_project';
  }

  if (cleaned.length > 64) {
    cleaned = cleaned.slice(0, 64).replace(/_+$/g, '');
  }

  let candidate = cleaned;
  let counter = 2;
  while (existingSet.has(candidate.toLowerCase())) {
    candidate = `${cleaned}_${counter}`;
    counter++;
  }
  return candidate;
}

/**
 * Convert arbitrary filename into an ASCII-safe filename for internal PDF script safety
 * while preserving extension.
 */
export function sanitizeMaterialFileName(fileName: string, index: number): string {
  const extMatch = (fileName || '').match(/(\.[a-zA-Z0-9]{1,8})$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : '.txt';
  const baseRaw = extMatch ? fileName.slice(0, -extMatch[0].length) : fileName;
  const asciiPart = baseRaw
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const prefix = `source-${String(index + 1).padStart(2, '0')}`;
  return asciiPart ? `${prefix}_${asciiPart}${ext}` : `${prefix}${ext}`;
}

/**
 * Normalize a vocabulary word or phrase for set comparison (lowercase, collapsed spaces, trimmed).
 */
export function normalizeWordKey(word: string): string {
  return String(word || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseDelimitedRow(line: string, delimiter: ',' | '\t'): string[] {
  if (delimiter === '\t') {
    return line.split('\t').map((c) => c.trim());
  }
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

function looksLikePhoneticOrReading(text: string): boolean {
  const s = text.trim();
  if (!s) return false;
  if (/^[/\[].*[/\]]$/.test(s)) return true;
  if (/^[\u3040-\u30ffー\s]+$/.test(s)) return true;
  return false;
}

/**
 * Parse raw text, CSV/TSV, or JSON string into structured VocabItem list.
 * Supports single words, English multi-word phrases, and non-Latin languages (e.g. Japanese).
 */
export function parseVocabularyInput(rawText: string): VocabItem[] {
  const trimmed = (rawText || '').replace(/^\uFEFF/, '').trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.words)
          ? parsed.words
          : Object.entries(parsed || {}).map(([word, val]) =>
              typeof val === 'string'
                ? { word, meaning: val }
                : val && typeof val === 'object'
                  ? { word, ...(val as Record<string, unknown>) }
                  : { word, meaning: '待结合语境学习' }
            );
      if (Array.isArray(arr)) {
        const result: VocabItem[] = [];
        for (const item of arr) {
          if (typeof item === 'string' && item.trim()) {
            result.push({ word: item.trim(), meaning: '待结合语境学习' });
          } else if (item && typeof item === 'object' && typeof (item as any).word === 'string') {
            const obj = item as any;
            result.push({
              ...(typeof obj.id === 'string' && obj.id.trim() ? { id: obj.id.trim() } : {}),
              word: obj.word.trim(),
              phonetic: typeof obj.phonetic === 'string' && obj.phonetic.trim() ? obj.phonetic.trim() : undefined,
              meaning:
                typeof obj.meaning === 'string' && obj.meaning.trim()
                  ? obj.meaning.trim()
                  : typeof obj.translation === 'string' && obj.translation.trim()
                    ? obj.translation.trim()
                    : typeof obj.definition === 'string' && obj.definition.trim()
                      ? obj.definition.trim()
                      : '待结合语境学习',
              example: typeof obj.example === 'string' && obj.example.trim() ? obj.example.trim() : undefined,
              exampleTranslation:
                typeof obj.exampleTranslation === 'string' && obj.exampleTranslation.trim()
                  ? obj.exampleTranslation.trim()
                  : undefined,
              ...(Array.isArray(obj.tags) ? { tags: obj.tags.map(String).filter(Boolean) } : {}),
            });
          }
        }
        return deduplicateVocabList(result);
      }
    } catch {
      // Fall back to line-based parsing
    }
  }

  const lines = trimmed.split(/\r?\n/);
  const items: VocabItem[] = [];

  let csvHeaderMap: {
    delimiter: ',' | '\t';
    idIdx: number;
    wordIdx: number;
    phoneticIdx: number;
    meaningIdx: number;
    exampleIdx: number;
    exampleTransIdx: number;
  } | null = null;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // Detect optional CSV/TSV header on the first content line
    if (items.length === 0 && !csvHeaderMap && (line.includes(',') || line.includes('\t'))) {
      const delim: ',' | '\t' = line.includes('\t') ? '\t' : ',';
      const cols = parseDelimitedRow(line, delim).map((c) => c.toLowerCase());
      const wordIdx = cols.findIndex((c) =>
        /^(?:word|vocab|term|phrase|expression|单词|词汇|词条|外文|日文)$/.test(c)
      );
      const meaningIdx = cols.findIndex((c) =>
        /^(?:meaning|definition|translation|gloss|释义|中文|意思|翻译)$/.test(c)
      );
      if (cols.length >= 2 && (wordIdx >= 0 || meaningIdx >= 0)) {
        csvHeaderMap = {
          delimiter: delim,
          idIdx: cols.findIndex((c) => /^(?:id|序号|编号)$/.test(c)),
          wordIdx: wordIdx >= 0 ? wordIdx : 0,
          phoneticIdx: cols.findIndex((c) => /^(?:phonetic|ipa|reading|kana|音标|读音|假名)$/.test(c)),
          meaningIdx: meaningIdx >= 0 ? meaningIdx : Math.min(cols.length - 1, wordIdx >= 0 ? wordIdx + 1 : 1),
          exampleIdx: cols.findIndex((c) => /^(?:example|sentence|例句)$/.test(c)),
          exampleTransIdx: cols.findIndex((c) => /^(?:exampletranslation|example_translation|例句翻译|译文)$/.test(c)),
        };
        continue;
      }
    }

    if (csvHeaderMap) {
      const cols = parseDelimitedRow(line, csvHeaderMap.delimiter);
      const w = (cols[csvHeaderMap.wordIdx] || '').trim();
      if (!w) continue;
      const id = csvHeaderMap.idIdx >= 0 ? (cols[csvHeaderMap.idIdx] || '').trim() : '';
      const phonetic = csvHeaderMap.phoneticIdx >= 0 ? (cols[csvHeaderMap.phoneticIdx] || '').trim() : '';
      const meaning =
        csvHeaderMap.meaningIdx >= 0 ? (cols[csvHeaderMap.meaningIdx] || '').trim() : '';
      const example = csvHeaderMap.exampleIdx >= 0 ? (cols[csvHeaderMap.exampleIdx] || '').trim() : '';
      const exampleTranslation =
        csvHeaderMap.exampleTransIdx >= 0 ? (cols[csvHeaderMap.exampleTransIdx] || '').trim() : '';
      items.push({
        ...(id ? { id } : {}),
        word: w,
        ...(phonetic ? { phonetic } : {}),
        meaning: meaning || '待结合语境学习',
        ...(example ? { example } : {}),
        ...(exampleTranslation ? { exampleTranslation } : {}),
      });
      continue;
    }

    // Strip optional list numbering / bullet prefix (e.g., "1. word", "- word")
    const cleanedLine = line.replace(/^(?:\d+[.)]\s+|[-*•]\s+)/, '').trim();
    if (!cleanedLine) continue;

    // 1. Tab-delimited lines
    if (cleanedLine.includes('\t')) {
      const cols = parseDelimitedRow(cleanedLine, '\t').filter((c, i) => i === 0 || c !== '');
      if (cols[0]) {
        if (cols.length >= 4) {
          items.push({
            word: cols[0],
            phonetic: cols[1] || undefined,
            meaning: cols[2] || '待结合语境学习',
            example: cols[3] || undefined,
            exampleTranslation: cols[4] || undefined,
          });
        } else if (cols.length === 3) {
          if (looksLikePhoneticOrReading(cols[1])) {
            items.push({ word: cols[0], phonetic: cols[1], meaning: cols[2] || '待结合语境学习' });
          } else {
            items.push({ word: cols[0], meaning: cols[1] || '待结合语境学习', example: cols[2] });
          }
        } else {
          items.push({ word: cols[0], meaning: cols[1] || '待结合语境学习' });
        }
        continue;
      }
    }

    // 2. Quoted CSV lines without header
    if (cleanedLine.startsWith('"') || cleanedLine.includes(',"')) {
      const cols = parseDelimitedRow(cleanedLine, ',');
      if (cols[0]) {
        if (cols.length >= 3 && looksLikePhoneticOrReading(cols[1])) {
          items.push({
            word: cols[0],
            phonetic: cols[1] || undefined,
            meaning: cols.slice(2).join(', ').trim() || '待结合语境学习',
          });
        } else {
          items.push({
            word: cols[0],
            meaning: cols.slice(1).join(', ').trim() || '待结合语境学习',
          });
        }
        continue;
      }
    }

    // 3. word /phonetic/ meaning or word [phonetic] meaning
    const phoneticMatch = cleanedLine.match(/^([^\t]+?)\s+(\/[^/]+\/|\[[^\]]+\])\s*(.*)$/);
    if (phoneticMatch) {
      items.push({
        word: phoneticMatch[1].trim(),
        phonetic: phoneticMatch[2].trim(),
        meaning: phoneticMatch[3].trim() || '待结合语境学习',
      });
      continue;
    }

    // 4. Explicit separator: " - ", " — ", " – ", " : ", "：", or 2+ spaces
    const sepMatch = cleanedLine.match(/^(.+?)(?:\s+[-—–:]\s+|\s*：\s*|\s{2,})(.+)$/);
    if (sepMatch) {
      items.push({
        word: sepMatch[1].trim(),
        meaning: sepMatch[2].trim(),
      });
      continue;
    }

    // 5. Comma-separated line (either "word, meaning" OR "word1, word2, word3")
    if (cleanedLine.includes(',')) {
      const cols = parseDelimitedRow(cleanedLine, ',').filter(Boolean);
      const isBareEnglishWordList =
        cols.length >= 2 &&
        !/\p{Script=Han}/u.test(cleanedLine) &&
        !/^(?:n|v|vi|vt|adj|adv|prep|conj|pron|num|art|int|phr|aux)\.\s/i.test(cols[1]) &&
        cols.every((c) => /^[a-zA-Z][a-zA-Z0-9\s'’\-]*$/.test(c) && c.split(/\s+/).length <= 4);
      if (isBareEnglishWordList) {
        for (const w of cols) {
          items.push({ word: w, meaning: '待结合语境学习' });
        }
        continue;
      }
      if (cols.length >= 2) {
        items.push({
          word: cols[0],
          meaning: cols.slice(1).join(', ').trim() || '待结合语境学习',
        });
        continue;
      }
    }

    // 6. Single-space separated English word/multi-word phrase + POS/Chinese meaning
    const engMeaningMatch = cleanedLine.match(
      /^([a-zA-Z][a-zA-Z0-9\s'’\-/.]*?)\s+((?:n|v|vi|vt|adj|adv|prep|conj|pron|num|art|int|phr|aux)\.\s*.+|[\p{Script=Han}].*)$/u
    );
    if (engMeaningMatch) {
      items.push({
        word: engMeaningMatch[1].trim(),
        meaning: engMeaningMatch[2].trim(),
      });
      continue;
    }

    // 7. Single-space separated non-Latin (e.g. Japanese kana/kanji) + meaning
    const nonLatinSepMatch = cleanedLine.match(/^([^\s]+[\u3040-\u30ff][^\s]*)\s+(.+)$/);
    if (nonLatinSepMatch) {
      items.push({
        word: nonLatinSepMatch[1].trim(),
        meaning: nonLatinSepMatch[2].trim(),
      });
      continue;
    }

    // 8. Pure single word, multi-word English phrase (e.g. "take into account"), or non-Latin term
    if (
      /^[a-zA-Z][a-zA-Z0-9\s'’\-]*$/.test(cleanedLine) ||
      (cleanedLine.length <= 80 && !/\s{2,}/.test(cleanedLine))
    ) {
      items.push({
        word: cleanedLine,
        meaning: '待结合语境学习',
      });
    }
  }

  return deduplicateVocabList(items);
}

export function deduplicateVocabList(items: VocabItem[]): VocabItem[] {
  const seen = new Map<string, VocabItem>();
  for (const item of items) {
    const cleanedWord = String(item.word || '').trim().replace(/\s+/g, ' ');
    const key = normalizeWordKey(cleanedWord);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.set(key, {
        ...item,
        word: cleanedWord,
        meaning: item.meaning?.trim() || '待结合语境学习',
      });
    } else {
      const existing = seen.get(key)!;
      const incomingMeaning = item.meaning?.trim();
      const shouldReplaceMeaning =
        (!existing.meaning || existing.meaning === '待结合语境学习') &&
        incomingMeaning &&
        incomingMeaning !== '待结合语境学习';
      seen.set(key, {
        ...existing,
        id: existing.id || item.id,
        phonetic: existing.phonetic || item.phonetic,
        meaning: shouldReplaceMeaning ? incomingMeaning! : existing.meaning,
        example: existing.example || item.example,
        exampleTranslation: existing.exampleTranslation || item.exampleTranslation,
        tags: existing.tags?.length ? existing.tags : item.tags,
      });
    }
  }
  return Array.from(seen.values());
}

/**
 * Assign deterministic, non-reordered stable IDs (`w-001`, `w-002`, ...) to vocabulary items.
 * Preserves existing IDs (both on `item.id` and matched by normalized word key in `existingItems`).
 */
export function assignStableVocabIds(
  items: VocabItem[],
  existingItems: VocabItem[] = []
): VocabItem[] {
  const deduped = deduplicateVocabList(items);
  const existingIdByKey = new Map<string, string>();
  const usedIds = new Set<string>();
  let maxSeq = 0;

  const trackId = (id?: string) => {
    if (!id) return;
    usedIds.add(id);
    const m = id.match(/^w-(\d+)$/);
    if (m) {
      maxSeq = Math.max(maxSeq, Number(m[1]));
    }
  };

  for (const ex of existingItems) {
    if (typeof ex.id === 'string' && ex.id.trim()) {
      const cleanId = ex.id.trim();
      existingIdByKey.set(normalizeWordKey(ex.word), cleanId);
      trackId(cleanId);
    }
  }
  for (const item of deduped) {
    if (typeof item.id === 'string' && item.id.trim()) {
      trackId(item.id.trim());
    }
  }

  return deduped.map((item) => {
    const key = normalizeWordKey(item.word);
    const candidateId =
      (typeof item.id === 'string' && item.id.trim()) || existingIdByKey.get(key) || '';
    if (candidateId) {
      return { ...item, id: candidateId };
    }
    maxSeq += 1;
    let nextId = `w-${String(maxSeq).padStart(3, '0')}`;
    while (usedIds.has(nextId)) {
      maxSeq += 1;
      nextId = `w-${String(maxSeq).padStart(3, '0')}`;
    }
    usedIds.add(nextId);
    return { ...item, id: nextId };
  });
}

function escapeCsvCell(val: string): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Format vocabulary list for local export in TXT, CSV, or JSON format.
 */
export function formatVocabularyExport(
  words: VocabItem[],
  format: 'txt' | 'csv' | 'json',
  bankMeta?: Partial<VocabBank>
): string {
  const normalized = assignStableVocabIds(words);
  if (format === 'json') {
    return JSON.stringify(
      {
        ...(bankMeta?.name ? { name: bankMeta.name } : {}),
        ...(bankMeta?.language ? { language: bankMeta.language } : {}),
        ...(bankMeta?.description ? { description: bankMeta.description } : {}),
        totalCount: normalized.length,
        words: normalized,
      },
      null,
      2
    );
  }
  if (format === 'csv') {
    const header = 'id,word,phonetic,meaning,example';
    const rows = normalized.map((w) =>
      [
        escapeCsvCell(w.id || ''),
        escapeCsvCell(w.word),
        escapeCsvCell(w.phonetic || ''),
        escapeCsvCell(w.meaning || ''),
        escapeCsvCell(w.example || ''),
      ].join(',')
    );
    return [header, ...rows].join('\n');
  }
  return normalized
    .map((w) => [w.word, w.phonetic, w.meaning].filter(Boolean).join('\t'))
    .join('\n');
}

/**
 * Vocabulary Set Difference Operation:
 * Target Vocabulary Set - Excluded (Mastered) Vocabulary Set = Actual Words to Learn
 */
export function computeVocabSetDifference(
  targetWords: VocabItem[],
  excludedWords: VocabItem[]
): {
  targetTotal: number;
  excludedTotal: number;
  overlapCount: number;
  effectiveWords: VocabItem[];
} {
  const dedupedTarget = deduplicateVocabList(targetWords);
  const dedupedExcluded = deduplicateVocabList(excludedWords);
  const excludedSet = new Set(dedupedExcluded.map((w) => normalizeWordKey(w.word)));

  const effectiveWords: VocabItem[] = [];
  let overlapCount = 0;

  for (const item of dedupedTarget) {
    const key = normalizeWordKey(item.word);
    if (excludedSet.has(key)) {
      overlapCount++;
    } else {
      effectiveWords.push(item);
    }
  }

  return {
    targetTotal: dedupedTarget.length,
    excludedTotal: dedupedExcluded.length,
    overlapCount,
    effectiveWords,
  };
}

/**
 * Compute vocabulary coverage & capacity warning for English courses.
 */
export function computeVocabCoverageStats(
  effectiveTotal: number,
  durationDays: number,
  dailyWordCount: number
): VocabCoverageStats {
  const safeDays = Math.max(1, Math.floor(durationDays || 1));
  const safeDaily = Math.max(1, Math.floor(dailyWordCount || 20));
  const plannedTotal = safeDays * safeDaily;
  const actualAllocatedTotal = Math.min(effectiveTotal, plannedTotal);
  const unallocatedRemainingCount = Math.max(0, effectiveTotal - plannedTotal);
  const isExceedingCapacity = plannedTotal > effectiveTotal;
  const fullDaysCount = safeDaily > 0 ? Math.floor(effectiveTotal / safeDaily) : 0;
  const coveragePercent =
    effectiveTotal > 0 ? Math.min(100, Math.round((actualAllocatedTotal / effectiveTotal) * 100)) : 0;

  let message = '';
  if (effectiveTotal === 0) {
    message = '当前待学词库为空（0 词），请调整目标词库或排除词库。';
  } else if (isExceedingCapacity) {
    const coveredDays = Math.ceil(effectiveTotal / safeDaily);
    message = `容量提醒：计划 ${safeDays} 天 × 每日 ${safeDaily} 词 = ${plannedTotal} 词，已超过待学词库实际容量（${effectiveTotal} 词）。系统将不重复分配全部 ${effectiveTotal} 词（可覆盖前 ${coveredDays} 天，其中 ${fullDaysCount} 天满额），建议调小每日单词数、缩短期限或扩充目标词库。`;
  } else {
    message = `词库覆盖正常：计划 ${safeDays} 天 × 每日 ${safeDaily} 词 = 共随机抽取 ${actualAllocatedTotal} 词（同一周期内不重复），覆盖待学词库（${effectiveTotal} 词）的 ${coveragePercent}%，词库剩余 ${unallocatedRemainingCount} 词未分配。`;
  }

  return {
    effectiveTotal,
    dailyWordCount: safeDaily,
    durationDays: safeDays,
    plannedTotal,
    actualAllocatedTotal,
    unallocatedRemainingCount,
    isExceedingCapacity,
    fullDaysCount,
    coveragePercent,
    message,
  };
}

/**
 * Deterministic or random Fisher-Yates shuffle of vocabulary array.
 */
export function shuffleVocabList(words: VocabItem[], seedStr?: string): VocabItem[] {
  const copy = [...words];
  if (copy.length <= 1) return copy;

  let rng: () => number = Math.random;
  if (seedStr) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let state = h >>> 0 || 1;
    rng = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Allocate vocabulary words randomly across study days according to `dailyWordCount`:
 * - Randomly draws words from `effectiveWords` without repetition within the study cycle.
 * - Each day receives up to `dailyWordCount` words.
 * - If `preserveStartedSlots` is true, slots that already have a generated lesson (`Boolean(slot.lesson)`)
 *   keep their existing `assignedWords` unchanged, and only unstarted slots receive freshly randomized words
 *   from the remaining unused vocabulary pool!
 */
export function allocateEnglishWordsRandomly(params: {
  effectiveWords: VocabItem[];
  durationDays: number;
  dailyWordCount: number;
  seedStr?: string;
  existingSlots?: DailyPlanSlot[];
  masteredWords?: string[];
  preserveStartedSlots?: boolean;
}): {
  buckets: VocabItem[][];
  coverageStats: VocabCoverageStats;
} {
  const {
    effectiveWords,
    durationDays,
    dailyWordCount,
    seedStr,
    existingSlots = [],
    masteredWords = [],
    preserveStartedSlots = false,
  } = params;

  const days = Math.max(1, Math.floor(durationDays || 1));
  const perDay = Math.max(1, Math.floor(dailyWordCount || 20));
  const dedupedPool = deduplicateVocabList(effectiveWords);
  const coverageStats = computeVocabCoverageStats(dedupedPool.length, days, perDay);

  const lockedWordsSet = new Set<string>(masteredWords.map(normalizeWordKey));
  const buckets: VocabItem[][] = Array.from({ length: days }, () => []);
  const lockedDayIndices = new Set<number>();

  if (preserveStartedSlots && existingSlots.length > 0) {
    for (let i = 0; i < days; i++) {
      const slot = existingSlots[i];
      if (slot && slot.lesson && Array.isArray(slot.assignedWords) && slot.assignedWords.length > 0) {
        buckets[i] = [...slot.assignedWords];
        lockedDayIndices.add(i);
        for (const w of slot.assignedWords) {
          lockedWordsSet.add(normalizeWordKey(w.word));
        }
      }
    }
  }

  const availablePool = dedupedPool.filter((w) => !lockedWordsSet.has(normalizeWordKey(w.word)));
  const shuffled = shuffleVocabList(availablePool, seedStr);

  let cursor = 0;
  for (let i = 0; i < days; i++) {
    if (lockedDayIndices.has(i)) continue;
    const slice = shuffled.slice(cursor, cursor + perDay);
    buckets[i] = slice;
    cursor += slice.length;
  }

  return { buckets, coverageStats };
}

/**
 * Legacy helper: Evenly or by dailyWordCount distribute vocabulary words across N study days.
 */
export function allocateWordsToDays(
  words: VocabItem[],
  durationDays: number,
  dailyWordCount?: number,
  seedStr?: string
): VocabItem[][] {
  if (dailyWordCount && dailyWordCount > 0) {
    return allocateEnglishWordsRandomly({
      effectiveWords: words,
      durationDays,
      dailyWordCount,
      seedStr,
    }).buckets;
  }
  const days = Math.max(1, Math.floor(durationDays));
  const buckets: VocabItem[][] = Array.from({ length: days }, () => []);
  if (words.length === 0) return buckets;

  const total = words.length;
  for (let i = 0; i < total; i++) {
    const dayIdx = Math.min(days - 1, Math.floor((i * days) / total));
    buckets[dayIdx].push(words[i]);
  }
  return buckets;
}

/**
 * Date math utilities (YYYY-MM-DD in local time)
 */
export function getTodayDateString(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToDateString(dateStr: string, offsetDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function formatChineseDateLabel(dateStr: string): {
  monthDay: string;
  weekday: string;
  year: string;
} {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const weekday = WEEKDAY_NAMES[dt.getUTCDay()] || '';
  return {
    monthDay: `${String(m).padStart(2, '0')}月${String(d).padStart(2, '0')}日`,
    weekday,
    year: String(y),
  };
}

export interface TimelineDateEntry {
  date: string;
  isToday: boolean;
  items: Array<{
    course: Course;
    slot: DailyPlanSlot;
  }>;
}

/**
 * Build a continuous chronological timeline of dates covering today and all scheduled course dates.
 */
export function buildDateTimeline(
  courses: Course[],
  todayStr: string = getTodayDateString()
): TimelineDateEntry[] {
  const dateMap = new Map<string, Array<{ course: Course; slot: DailyPlanSlot }>>();

  let minDate = todayStr;
  let maxDate = addDaysToDateString(todayStr, 13); // Show at least a 14-day window even when empty

  for (const course of courses) {
    for (const slot of course.dailyPlan) {
      if (!slot.date) continue;
      if (slot.date < minDate) minDate = slot.date;
      if (slot.date > maxDate) maxDate = slot.date;

      const list = dateMap.get(slot.date) || [];
      list.push({ course, slot });
      dateMap.set(slot.date, list);
    }
  }

  const entries: TimelineDateEntry[] = [];
  let cursor = minDate;
  let safetyCounter = 0;
  while (cursor <= maxDate && safetyCounter < 400) {
    entries.push({
      date: cursor,
      isToday: cursor === todayStr,
      items: dateMap.get(cursor) || [],
    });
    cursor = addDaysToDateString(cursor, 1);
    safetyCounter++;
  }

  return entries;
}

/**
 * Partition timeline entries so Today is always Row 1 of `todayAndUpcomingEntries`,
 * while any earlier dates (`date < todayStr`) are placed in `pastEntries`.
 */
export function partitionTimelineAroundToday(entries: TimelineDateEntry[]): {
  pastEntries: TimelineDateEntry[];
  todayAndUpcomingEntries: TimelineDateEntry[];
} {
  const todayIdx = entries.findIndex((e) => e.isToday);
  if (todayIdx <= 0) {
    return {
      pastEntries: [],
      todayAndUpcomingEntries: entries,
    };
  }
  return {
    pastEntries: entries.slice(0, todayIdx),
    todayAndUpcomingEntries: entries.slice(todayIdx),
  };
}

/**
 * Deterministic offline exercise grading (requires NO LLM or internet connection).
 */
export function gradeSingleExercise(
  question: ExerciseQuestion,
  userRawAnswer: string,
  options?: { selfUnderstood?: boolean }
): { isCorrect: boolean; normalizedUser: string; normalizedExpected: string } {
  const userClean = (userRawAnswer || '').trim();
  const expectedClean = (question.answer || '').trim();

  if (question.type === 'choice') {
    const userLetterMatch = userClean.match(/^([A-Da-d])(?:\b|[.、:：\s])/);
    const expectedLetterMatch = expectedClean.match(/^([A-Da-d])(?:\b|[.、:：\s])/);
    const u = userLetterMatch ? userLetterMatch[1].toUpperCase() : userClean.toUpperCase();
    const e = expectedLetterMatch ? expectedLetterMatch[1].toUpperCase() : expectedClean.toUpperCase();
    return {
      isCorrect: Boolean(u && u === e),
      normalizedUser: u,
      normalizedExpected: e,
    };
  }

  if (options?.selfUnderstood) {
    return {
      isCorrect: true,
      normalizedUser: userClean || '已理解',
      normalizedExpected: expectedClean,
    };
  }

  const normalizeText = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[.,;!?。，；！？]+$/g, '');

  const uNorm = normalizeText(userClean);
  const candidates = expectedClean.split(/\s*[/|]\s*/).map(normalizeText);
  const isCorrect = Boolean(uNorm && candidates.includes(uNorm));

  return {
    isCorrect,
    normalizedUser: userClean,
    normalizedExpected: expectedClean,
  };
}

export function gradeExerciseSet(
  questions: ExerciseQuestion[],
  userAnswers: Record<string, string>,
  selfUnderstoodIds?: string[] | Set<string>
): {
  score: number;
  total: number;
  details: Record<string, { isCorrect: boolean; expected: string; explanation: string }>;
} {
  let score = 0;
  const details: Record<string, { isCorrect: boolean; expected: string; explanation: string }> = {};
  const understoodSet = new Set(selfUnderstoodIds || []);

  for (const q of questions) {
    const res = gradeSingleExercise(q, userAnswers[q.id] || '', {
      selfUnderstood: understoodSet.has(q.id),
    });
    if (res.isCorrect) score++;
    details[q.id] = {
      isCorrect: res.isCorrect,
      expected: q.answer,
      explanation: q.explanation || '',
    };
  }

  return {
    score,
    total: questions.length,
    details,
  };
}

export function formatStudyDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

export interface ComputedLearningStats {
  totalStudySeconds: number;
  todayStudySeconds: number;
  totalQuestionsAnswered: number;
  totalQuestionsCorrect: number;
  accuracyPercent: number | null;
  todayQuestionsAnswered: number;
  todayQuestionsCorrect: number;
  todayAccuracyPercent: number | null;
  completedLessonsCount: number;
  totalLessonsCount: number;
}

export function getSlotExerciseSubmission(
  course: Course,
  slot: DailyPlanSlot
): ExerciseSubmissionRecord | undefined {
  const subs = course.exerciseSubmissions || {};
  if (slot.id && subs[slot.id]) {
    return subs[slot.id];
  }
  const secKey = ensureStableSectionId(slot.dayIndex, slot.id);
  if (subs[secKey]) {
    return subs[secKey];
  }
  if (slot.date && subs[slot.date]) {
    const record = subs[slot.date];
    if (!record.sectionId || record.sectionId === secKey || record.sectionId === slot.id) {
      return record;
    }
  }
  return undefined;
}

/** Estimate study time from finished courseware, without trusting imported estimates. */
export function estimateWrittenLessonMinutes(lesson: DailyLessonContent): number {
  const body = (lesson.markdownBody || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\{\{[^}]+\}\}/g, '');
  const displayMath = /\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]/g;
  let derivationMinutes = 0;
  for (const match of body.matchAll(displayMath)) {
    const formula = match[1] ?? match[2];
    const steps = formula.split(/\\\\|\\(?:Rightarrow|Longrightarrow|implies)/).filter((step) => step.trim()).length;
    if (steps >= 2) derivationMinutes += steps > 4 ? 4 : 2;
  }
  const paragraphs = Array.isArray(lesson.englishPayload?.paragraphs) ? lesson.englishPayload.paragraphs : [];
  const prose = [
    body.replace(displayMath, '').replace(/\$[^$\n]+\$|\\\([^\n]*?\\\)/g, ''),
    ...paragraphs.map(({ english, chinese }) => `${english || ''} ${chinese || ''}`),
    lesson.englishPayload?.grammarAndUsageNotes || '',
  ].join(' ');
  const readingMinutes = (prose.match(/\p{Script=Han}/gu)?.length || 0) / 200
    + (prose.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length || 0) / 150;
  const concepts = new Set((lesson.keyPoints || []).map((point) => point.trim()).filter(Boolean));
  const exerciseWeights = { basic: 2, application: 5, comprehensive: 10 };
  const exerciseMinutes = (lesson.exercises || []).reduce((total, exercise) =>
    total + (exercise.difficulty ? exerciseWeights[exercise.difficulty] ?? 5 : 5), 0);
  const minutes = readingMinutes + concepts.size * 2 + derivationMinutes
    + (lesson.diagrams?.length || 0) * 1.5 + exerciseMinutes
    + (lesson.heuristicQuestions?.length || 0) * 2 + (lesson.reverseChecks?.length || 0) * 2;
  return Math.max(1, Math.ceil(minutes));
}

export function getEvaluatedSectionMinutes(slot: Partial<DailyPlanSlot>): number | undefined {
  return slot.lesson && slot.lesson.generationStage !== 'stage1_content'
    ? estimateWrittenLessonMinutes(slot.lesson)
    : undefined;
}

/**
 * Deterministic estimation fallback for a teaching section's study duration in minutes
 * when an imported/legacy outline omits `estimatedMinutes`.
 */
export function estimateSectionMinutesFallback(slot: Partial<DailyPlanSlot>): number {
  const evaluated = getEvaluatedSectionMinutes(slot);
  if (evaluated !== undefined) {
    return evaluated;
  }
  const segPages = slot.pdfSegment
    ? Math.max(
        1,
        (Number(slot.pdfSegment.physicalEndPage) || 1) -
          (Number(slot.pdfSegment.physicalStartPage) || 1) +
          1
      )
    : 0;
  const topicCount = Array.isArray(slot.keyTopics) ? slot.keyTopics.length : 0;

  let estimate = 45;
  if (segPages > 0 && topicCount > 0) {
    estimate = Math.round(segPages * 4.5 + topicCount * 6);
  } else if (segPages > 0) {
    estimate = Math.round(segPages * 5.5);
  } else if (topicCount > 0) {
    estimate = Math.round(topicCount * 14);
  }
  return Math.max(20, Math.min(120, estimate));
}

/**
 * Deterministic sequence-preserving day allocation algorithm:
 * Partitions ordered sections across `durationDays` based on `estimatedMinutes`,
 * using `totalMinutes / durationDays` as the baseline daily load while preserving
 * strict section order and section indivisibility (no AI used for scheduling).
 */
export function allocateSectionsToDays(
  slots: DailyPlanSlot[],
  durationDays: number,
  startDate: string
): DailyPlanSlot[] {
  if (!Array.isArray(slots) || slots.length === 0) return [];
  const safeStartDate =
    typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
      ? startDate
      : getTodayDateString();
  const M = slots.length;
  const N = Math.max(1, Math.min(180, Math.round(Number(durationDays) || M)));

  const normalized: DailyPlanSlot[] = slots.map((slot, idx) => {
    const secNum = idx + 1;
    const stableId = ensureStableSectionId(secNum, slot.id);
    const evaluatedOrExplicit = getEvaluatedSectionMinutes(slot);
    return {
      ...slot,
      id: stableId,
      dayIndex: secNum,
      estimatedMinutes: evaluatedOrExplicit,
    };
  });

  if (M === N) {
    return normalized.map((slot, idx) => ({
      ...slot,
      scheduledDay: idx + 1,
      date: addDaysToDateString(safeStartDate, idx),
    }));
  }

  const weights = normalized.map((s) => estimateSectionMinutesFallback(s));
  const totalMinutes = weights.reduce((acc, w) => acc + w, 0);

  if (M < N) {
    // Spread M indivisible sections proportionally across N days by cumulative midpoint,
    // keeping strict monotonic progression: Day 1 gets section 1, and each section advances.
    const assignedDays: number[] = new Array(M).fill(1);
    let cumBefore = 0;
    for (let i = 0; i < M; i++) {
      const w = weights[i];
      if (i === 0) {
        assignedDays[i] = 1;
      } else {
        const midpointRatio = totalMinutes > 0 ? (cumBefore + w * 0.5) / totalMinutes : i / M;
        const idealDay = Math.floor(midpointRatio * N) + 1;
        const minAllowed = assignedDays[i - 1] + 1;
        const maxAllowed = N - (M - 1 - i);
        assignedDays[i] = Math.max(minAllowed, Math.min(maxAllowed, idealDay));
      }
      cumBefore += w;
    }
    return normalized.map((slot, idx) => {
      const d = assignedDays[idx];
      return {
        ...slot,
        scheduledDay: d,
        date: addDaysToDateString(safeStartDate, d - 1),
      };
    });
  }

  // M > N: Exact dynamic programming partition minimizing SSE from targetMinutes = totalMinutes / N
  const target = totalMinutes / N;
  const prefix = new Array<number>(M + 1).fill(0);
  for (let i = 0; i < M; i++) {
    prefix[i + 1] = prefix[i] + weights[i];
  }

  const INF = Number.POSITIVE_INFINITY;
  const dpSse: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(INF));
  const dpMaxLoad: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(INF));
  const prevSplit: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0));

  for (let i = 1; i <= M - (N - 1); i++) {
    const load = prefix[i];
    const diff = load - target;
    dpSse[1][i] = diff * diff;
    dpMaxLoad[1][i] = load;
    prevSplit[1][i] = 0;
  }

  for (let d = 2; d <= N; d++) {
    const maxI = M - (N - d);
    for (let i = d; i <= maxI; i++) {
      let bestSse = INF;
      let bestMax = INF;
      let bestJ = d - 1;
      for (let j = d - 1; j < i; j++) {
        if (dpSse[d - 1][j] === INF) continue;
        const segLoad = prefix[i] - prefix[j];
        const diff = segLoad - target;
        const candSse = dpSse[d - 1][j] + diff * diff;
        const candMax = Math.max(dpMaxLoad[d - 1][j], segLoad);
        if (
          candSse < bestSse - 1e-6 ||
          (Math.abs(candSse - bestSse) <= 1e-6 && candMax < bestMax)
        ) {
          bestSse = candSse;
          bestMax = candMax;
          bestJ = j;
        }
      }
      dpSse[d][i] = bestSse;
      dpMaxLoad[d][i] = bestMax;
      prevSplit[d][i] = bestJ;
    }
  }

  // Reconstruct day index (1..N) for each section 0..M-1
  const assignedDays = new Array<number>(M).fill(N);
  let cursorEnd = M;
  for (let d = N; d >= 1; d--) {
    const startIdx = prevSplit[d][cursorEnd];
    for (let k = startIdx; k < cursorEnd; k++) {
      assignedDays[k] = d;
    }
    cursorEnd = startIdx;
  }

  return normalized.map((slot, idx) => {
    const d = assignedDays[idx];
    return {
      ...slot,
      scheduledDay: d,
      date: addDaysToDateString(safeStartDate, d - 1),
    };
  });
}

/**
 * Build day-by-day grouped study schedule summary from allocated section slots.
 */
export function buildCourseDailySchedule(
  slots: DailyPlanSlot[],
  durationDays: number,
  startDate: string
): DailyScheduleDay[] {
  const safeStartDate =
    typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
      ? startDate
      : getTodayDateString();
  const safeDays = Math.max(1, Math.min(180, Math.round(Number(durationDays) || slots.length || 1)));
  const totalMinutes = slots.reduce((sum, s) => sum + (getEvaluatedSectionMinutes(s) || 0), 0);
  const targetMinutes = Math.round(totalMinutes / safeDays);

  const byDate = new Map<string, DailyPlanSlot[]>();
  for (const s of slots) {
    const key = s.date || addDaysToDateString(safeStartDate, Math.max(0, (s.scheduledDay || s.dayIndex) - 1));
    const list = byDate.get(key) || [];
    list.push(s);
    byDate.set(key, list);
  }

  const schedule: DailyScheduleDay[] = [];
  for (let d = 1; d <= safeDays; d++) {
    const date = addDaysToDateString(safeStartDate, d - 1);
    const daySlots = byDate.get(date) || [];
    schedule.push({
      dayNumber: d,
      date,
      sectionIds: daySlots.map((s) => ensureStableSectionId(s.dayIndex, s.id)),
      estimatedMinutes: daySlots.reduce((sum, s) => sum + (getEvaluatedSectionMinutes(s) || 0), 0),
      targetMinutes,
    });
  }
  return schedule;
}

export function computeLearningStats(
  courses: Course[],
  studyStats: {
    totalSeconds?: number;
    secondsByDate?: Record<string, number>;
    secondsByCourse?: Record<string, number>;
  } | null | undefined,
  todayStr: string = getTodayDateString()
): ComputedLearningStats {
  const totalStudySeconds = Math.max(0, Math.floor(studyStats?.totalSeconds || 0));
  const todayStudySeconds = Math.max(
    0,
    Math.floor(studyStats?.secondsByDate?.[todayStr] || 0)
  );

  let totalQuestionsAnswered = 0;
  let totalQuestionsCorrect = 0;
  let todayQuestionsAnswered = 0;
  let todayQuestionsCorrect = 0;
  let completedLessonsCount = 0;
  let totalLessonsCount = 0;

  for (const course of courses) {
    totalLessonsCount += course.dailyPlan.length;
    const slotDateBySecId = new Map<string, string>();
    for (const slot of course.dailyPlan) {
      if (slot.id) slotDateBySecId.set(slot.id, slot.date);
      slotDateBySecId.set(ensureStableSectionId(slot.dayIndex, slot.id), slot.date);
      if (slot.lesson) {
        completedLessonsCount++;
      }
    }
    const subs = course.exerciseSubmissions || {};
    for (const [subKey, sub] of Object.entries(subs)) {
      if (!sub || typeof sub.total !== 'number' || sub.total <= 0) continue;
      const total = Math.max(0, Number(sub.total) || 0);
      const score = Math.max(0, Math.min(total, Number(sub.score) || 0));
      totalQuestionsAnswered += total;
      totalQuestionsCorrect += score;
      const effectiveDate = sub.date || slotDateBySecId.get(subKey) || subKey;
      if (subKey === todayStr || effectiveDate === todayStr) {
        todayQuestionsAnswered += total;
        todayQuestionsCorrect += score;
      }
    }
  }

  const accuracyPercent =
    totalQuestionsAnswered > 0
      ? Math.round((totalQuestionsCorrect / totalQuestionsAnswered) * 1000) / 10
      : null;

  const todayAccuracyPercent =
    todayQuestionsAnswered > 0
      ? Math.round((todayQuestionsCorrect / todayQuestionsAnswered) * 1000) / 10
      : null;

  return {
    totalStudySeconds,
    todayStudySeconds,
    totalQuestionsAnswered,
    totalQuestionsCorrect,
    accuracyPercent,
    todayQuestionsAnswered,
    todayQuestionsCorrect,
    todayAccuracyPercent,
    completedLessonsCount,
    totalLessonsCount,
  };
}

function normalizeRegionToken(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^region[-_\s]?(\d+)$/i);
  if (match) {
    return `region-${String(Number(match[1])).padStart(2, '0')}`;
  }
  return trimmed;
}

/**
 * Extract all referenced PDF region IDs (`region-01`, `region-02`, ...) from a section's
 * `regionIds`, `regionId`, `teachingScope`, and `title`.
 */
export function extractReferencedRegionIds(slot: {
  regionId?: string;
  regionIds?: string[];
  teachingScope?: string;
  title?: string;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pushId = (raw: string) => {
    const normalized = normalizeRegionToken(raw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  if (Array.isArray(slot.regionIds)) {
    for (const entry of slot.regionIds) {
      if (typeof entry !== 'string') continue;
      for (const token of entry.split(/[,，、;；/+&\s]+/)) {
        if (token.trim()) pushId(token);
      }
    }
  }

  if (typeof slot.regionId === 'string' && slot.regionId.trim()) {
    for (const token of slot.regionId.split(/[,，、;；/+&\s]+/)) {
      if (token.trim()) pushId(token);
    }
  }

  const scanText = `${slot.teachingScope || ''}\n${slot.title || ''}`;
  const matches = scanText.match(/region[-_\s]?\d+/gi) || [];
  for (const m of matches) {
    pushId(m);
  }

  return out;
}

/**
 * Resolve ALL PDF segments bound to a section (supporting 1-to-1 and many-to-one merged regions).
 */
export function resolveSlotPdfSegments(
  slot: Pick<
    DailyPlanSlot,
    'id' | 'dayIndex' | 'regionId' | 'regionIds' | 'teachingScope' | 'title' | 'pdfSegment' | 'pdfSegments'
  >,
  splitPlan?: PdfSplitPlanItem[]
): PdfSplitPlanItem[] {
  const fallbackList = (): PdfSplitPlanItem[] => {
    const items: PdfSplitPlanItem[] = [];
    const seen = new Set<string>();
    const add = (seg?: PdfSplitPlanItem) => {
      if (!seg) return;
      const key = seg.sectionId || seg.segmentFileName || seg.segmentRelPath || String(seg.dayIndex);
      if (seen.has(key)) return;
      seen.add(key);
      items.push(seg);
    };
    if (Array.isArray(slot.pdfSegments)) {
      for (const s of slot.pdfSegments) add(s);
    }
    add(slot.pdfSegment);
    return items;
  };

  if (!splitPlan || splitPlan.length === 0) {
    return fallbackList();
  }

  const findInPlan = (id: string): PdfSplitPlanItem | undefined => {
    const norm = normalizeRegionToken(id);
    return splitPlan.find(
      (p) => p.sectionId === id || normalizeRegionToken(p.sectionId) === norm
    );
  };

  const refIds = extractReferencedRegionIds(slot);
  const matched: PdfSplitPlanItem[] = [];
  const seen = new Set<string>();
  for (const refId of refIds) {
    const found = findInPlan(refId);
    if (found && !seen.has(found.sectionId)) {
      seen.add(found.sectionId);
      matched.push(found);
    }
  }
  if (matched.length > 0) {
    return matched;
  }

  // Compatibility fallback when section didn't specify regionId
  const bySecId = findInPlan(slot.id);
  if (bySecId) return [bySecId];
  const byDayIndex = splitPlan.find((p) => p.dayIndex === slot.dayIndex);
  if (byDayIndex) return [byDayIndex];

  return fallbackList();
}

function findBestSlotIndexByPageOverlap(
  slots: DailyPlanSlot[],
  region: PdfSplitPlanItem
): number {
  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < slots.length; i++) {
    const text = `${slots[i].teachingScope || ''}\n${slots[i].title || ''}`;
    let score = 0;

    // Look for physical or printed page ranges like "物理页54~64" or "329~339"
    const rangeRegex = /(\d{1,4})\s*[~–\-－至到]\s*(\d{1,4})/g;
    let m: RegExpExecArray | null;
    while ((m = rangeRegex.exec(text)) !== null) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
      const physOverlap = Math.max(
        0,
        Math.min(b, region.physicalEndPage) - Math.max(a, region.physicalStartPage) + 1
      );
      if (physOverlap > 0) {
        score += physOverlap * 2;
      }
      if (
        typeof region.printedStartPage === 'number' &&
        typeof region.printedEndPage === 'number'
      ) {
        const printedOverlap = Math.max(
          0,
          Math.min(b, region.printedEndPage) - Math.max(a, region.printedStartPage) + 1
        );
        if (printedOverlap > 0) {
          score += printedOverlap * 2;
        }
      }
    }

    if (score >= bestScore && score > 0) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Bind every section to its referenced PDF region(s) and guarantee 100% coverage of all
 * split PDF regions in `splitPlan` so no sliced PDF is left unused.
 */
export function bindAndEnsureAllPdfRegionsCovered(
  slots: DailyPlanSlot[],
  splitPlan?: PdfSplitPlanItem[]
): DailyPlanSlot[] {
  if (!slots || slots.length === 0) return [];
  if (!splitPlan || splitPlan.length === 0) {
    return slots.map((slot) => {
      const existingSegs = resolveSlotPdfSegments(slot, undefined);
      const existingIds = extractReferencedRegionIds(slot);
      return {
        ...slot,
        regionId: existingIds[0] || slot.regionId || existingSegs[0]?.sectionId,
        regionIds:
          existingIds.length > 0
            ? existingIds
            : existingSegs.length > 0
              ? existingSegs.map((s) => s.sectionId)
              : slot.regionIds,
        pdfSegment: existingSegs[0] || slot.pdfSegment,
        pdfSegments: existingSegs.length > 0 ? existingSegs : slot.pdfSegments,
      };
    });
  }

  const orderIndex = new Map<string, number>();
  splitPlan.forEach((p, idx) => orderIndex.set(p.sectionId, idx));

  // Pass 1: resolve explicitly referenced regions per slot
  const slotSegLists: PdfSplitPlanItem[][] = slots.map((slot) =>
    resolveSlotPdfSegments(slot, splitPlan)
  );

  const covered = new Set<string>();
  for (const list of slotSegLists) {
    for (const seg of list) {
      covered.add(seg.sectionId);
    }
  }

  // Pass 2: assign any uncovered regions so every split PDF region is attached to a section
  for (let rIdx = 0; rIdx < splitPlan.length; rIdx++) {
    const region = splitPlan[rIdx];
    if (covered.has(region.sectionId)) continue;

    let targetSlotIdx = findBestSlotIndexByPageOverlap(slots, region);

    if (targetSlotIdx < 0 && rIdx > 0) {
      const prevRegionId = splitPlan[rIdx - 1].sectionId;
      for (let i = slots.length - 1; i >= 0; i--) {
        if (slotSegLists[i].some((s) => s.sectionId === prevRegionId)) {
          targetSlotIdx = i;
          break;
        }
      }
    }

    if (targetSlotIdx < 0 && rIdx + 1 < splitPlan.length) {
      const nextRegionId = splitPlan[rIdx + 1].sectionId;
      for (let i = 0; i < slots.length; i++) {
        if (slotSegLists[i].some((s) => s.sectionId === nextRegionId)) {
          targetSlotIdx = i;
          break;
        }
      }
    }

    if (targetSlotIdx < 0) {
      const proportional = Math.floor((rIdx / Math.max(1, splitPlan.length)) * slots.length);
      targetSlotIdx = Math.max(0, Math.min(slots.length - 1, proportional));
    }

    if (!slotSegLists[targetSlotIdx].some((s) => s.sectionId === region.sectionId)) {
      slotSegLists[targetSlotIdx].push(region);
    }
    covered.add(region.sectionId);
  }

  // Pass 3: normalize ordering and sync regionId/regionIds/pdfSegment/pdfSegments
  return slots.map((slot, idx) => {
    const unique = new Map<string, PdfSplitPlanItem>();
    for (const seg of slotSegLists[idx]) {
      if (!unique.has(seg.sectionId)) unique.set(seg.sectionId, seg);
    }
    const sortedSegs = Array.from(unique.values()).sort(
      (a, b) => (orderIndex.get(a.sectionId) ?? 9999) - (orderIndex.get(b.sectionId) ?? 9999)
    );
    const regionIds = sortedSegs.map((s) => s.sectionId);
    return {
      ...slot,
      regionId: regionIds[0] || slot.regionId,
      regionIds: regionIds.length > 0 ? regionIds : undefined,
      pdfSegment: sortedSegs[0] || slot.pdfSegment,
      pdfSegments: sortedSegs.length > 0 ? sortedSegs : undefined,
    };
  });
}

