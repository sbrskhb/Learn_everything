import type { DailyLessonContent, LessonSymbolEntry } from '../types';

export interface ResolvedLessonSymbol extends LessonSymbolEntry {
  canonicalKey: string;
  looseKey: string;
  allKeys: string[];
  source: 'glossary' | 'prose' | 'table';
  definedAtChar: number; // -1 means defined in summary/keyPoints/teachingContext (always preceding body)
  contextSnippet?: string;
}

export interface LessonSymbolIndex {
  entries: ResolvedLessonSymbol[];
  byKey: Map<string, ResolvedLessonSymbol>;
}

const GREEK_COMMAND_TO_UNICODE: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  Gamma: 'Γ',
  delta: 'δ',
  Delta: 'Δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  Theta: 'Θ',
  vartheta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  Lambda: 'Λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  Xi: 'Ξ',
  pi: 'π',
  Pi: 'Π',
  rho: 'ρ',
  varrho: 'ρ',
  sigma: 'σ',
  Sigma: 'Σ',
  tau: 'τ',
  upsilon: 'υ',
  Upsilon: 'Υ',
  phi: 'φ',
  varphi: 'φ',
  Phi: 'Φ',
  chi: 'χ',
  psi: 'ψ',
  Psi: 'Ψ',
  omega: 'ω',
  Omega: 'Ω',
  partial: '∂',
  nabla: '∇',
  ell: 'ℓ',
  hbar: 'ℏ',
};

const STOP_WORDS_BEFORE_SYMBOL = new Set([
  '如',
  '即',
  '为',
  '是',
  '有',
  '得',
  '见',
  '图',
  '式',
  '第',
  '等',
  '约',
  '在',
  '由',
  '从',
  '对',
  '把',
  '将',
  '让',
  '使',
  '若',
  '当',
  '则',
  '且',
  '或',
  '与',
  '和',
  '及',
  '并',
  '而',
  '但',
  '其中',
  '已知',
  '假设',
  '设',
  '令',
  '可得',
  '代入',
  '整理',
  '整理得',
  '化简',
  '解得',
  '因此',
  '所以',
  '于是',
  '故',
  '满足',
  '等于',
  '大于',
  '小于',
  '趋近于',
  '无穷',
  '此时',
  '这里',
  '显然',
  '注意',
  '因为',
  '由于',
  '根据',
  '利用',
  '通过',
  '结合',
]);

const FORBIDDEN_SINGLE_KEYS = new Set([
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'ln',
  'log',
  'lg',
  'exp',
  'lim',
  'max',
  'min',
  'sup',
  'inf',
  'det',
  'dim',
  'arg',
  'gcd',
  'mod',
  'dB',
  'Hz',
  'kHz',
  'MHz',
  'GHz',
  'mV',
  'kV',
  'mA',
  'μA',
  'nA',
  'pA',
  'kΩ',
  'MΩ',
  'mΩ',
  'μF',
  'nF',
  'pF',
  'mH',
  'μH',
  'ms',
  'μs',
  'ns',
]);

function stripCombiningAndAccents(str: string): string {
  return str
    .normalize('NFKD')
    .replace(/[\u0300-\u036f˙ˉˆ˜⃗]/g, '');
}

/**
 * Canonicalize any LaTeX math symbol OR KaTeX rendered DOM `.textContent`
 * into deterministic exact & loose matching keys.
 * Examples:
 * - `R_f`, `R_{f}`, KaTeX `"Rf"` -> canonicalKey `"Rf"`, looseKey `"Rf"`
 * - `\Delta I_{I_O}`, KaTeX `"ΔIIO"` -> canonicalKey `"ΔIIO"`, looseKey `"Δiio"`
 * - `\delta`, KaTeX `"δ"` -> canonicalKey `"δ"`, looseKey `"δ"`
 */
export function normalizeSymbolKeys(raw: string): {
  canonicalKey: string;
  looseKey: string;
} | null {
  if (!raw) return null;
  let work = raw
    .trim()
    .replace(/^\$+|\$+$/g, '')
    .replace(/^\\\(|\\\)$/g, '')
    .replace(/^\\left\s*\|\s*|\s*\\right\s*\|$/g, '')
    .replace(/^\|(.*)\|$/g, '$1')
    .trim();

  if (!work) return null;

  // Reject compound expressions with binary operators or fractions
  if (/[+=<>≈≠≤≥÷×]|\\frac\b|\\sum\b|\\int\b/.test(work)) {
    return null;
  }

  // Replace Greek / math commands with Unicode equivalents
  work = work.replace(/\\([A-Za-z]+)/g, (_m, cmd: string) => {
    if (cmd === 'prime') {
      return "'";
    }
    if (GREEK_COMMAND_TO_UNICODE[cmd]) {
      return GREEK_COMMAND_TO_UNICODE[cmd];
    }
    if (
      cmd === 'mathrm' ||
      cmd === 'mathbf' ||
      cmd === 'mathit' ||
      cmd === 'mathcal' ||
      cmd === 'mathbb' ||
      cmd === 'text' ||
      cmd === 'operatorname' ||
      cmd === 'boldsymbol' ||
      cmd === 'dot' ||
      cmd === 'ddot' ||
      cmd === 'bar' ||
      cmd === 'overline' ||
      cmd === 'hat' ||
      cmd === 'widehat' ||
      cmd === 'tilde' ||
      cmd === 'widetilde' ||
      cmd === 'vec' ||
      cmd === 'left' ||
      cmd === 'right'
    ) {
      return '';
    }
    return cmd;
  });

  // Preserve prime marks (normalized to ASCII `'`) so `R` and `R'` stay distinct
  work = stripCombiningAndAccents(work)
    .replace(/′/g, "'")
    .replace(/[\u200B-\u200D\uFEFF\u2060{}_\^\s,，;；:：()\[\]]+/g, '')
    .trim();

  if (!work || work.length > 18) return null;
  // Reject pure numbers or punctuation
  if (/^[\d.\-]+$/.test(work)) return null;
  if (!/[A-Za-zα-ωΑ-Ω∂∇ℓℏ]/.test(work)) return null;
  if (FORBIDDEN_SINGLE_KEYS.has(work)) return null;

  const firstChar = work.slice(0, 1);
  const rest = work.slice(1);
  const looseKey = firstChar + rest.toLowerCase();

  return {
    canonicalKey: work,
    looseKey,
  };
}

function cleanExplanationText(raw: string): string {
  return (raw || '')
    .replace(/\s+/g, ' ')
    .replace(/^[：:、，,\s\-—]+|[。；;，,\s]+$/g, '')
    .trim();
}

function extractUnitFromRhs(rhs: string): string | undefined {
  if (!rhs) return undefined;
  const flattened = rhs
    .replace(/\\(?:text|mathrm)\{([^}]*)\}/g, '$1')
    .replace(/\\mu\b/g, 'μ')
    .replace(/\\Omega\b/g, 'Ω')
    .replace(/\\[,;!\s]+/g, ' ');
  const textCmdMatch = flattened.match(
    /((?:k|M|G|m|μ|u|n|p)?(?:Ω|V|A|F|H|W|Hz|s|S|dB|J|K|N|Pa|rad\/s|mol\/L))(?:$|[^A-Za-z])/
  );
  if (textCmdMatch) {
    return textCmdMatch[1];
  }
  const wrappedMatch = rhs.match(/\\text\{([^}]{1,12})\}/);
  if (wrappedMatch && /[A-Za-zΩμ]/.test(wrappedMatch[1])) {
    return wrappedMatch[1].trim();
  }
  return undefined;
}

function extractTermBeforeMath(precedingText: string): string | null {
  if (!precedingText) return null;
  // Take only the immediate trailing clause after punctuation/connectors
  const clause = precedingText
    .replace(/[*`#>\[\]()（）]/g, ' ')
    .split(/[。！？；;，,\n：:（）()]/)
    .pop()
    ?.trim();

  if (!clause) return null;

  // Trim leading conjunctions / verbs
  let candidate = clause
    .replace(
      /^(?:其中|已知|假设|设|令|若|当|由|从|在|对|把|将|让|使|若将|与|和|及|并|且|或|即|则|为|是|有|得到|可得|定义|引入|考虑|记|表示)\s*/g,
      ''
    )
    .replace(/^(?:的|了)\s*/g, '')
    .trim();

  // Split on conjunctions or action verbs so only the noun phrase right before `$sym$` is kept
  // e.g. "设输入信号经输入电阻" -> "输入电阻", "反馈支路跨接反馈电阻" -> "反馈电阻", "运放输入失调电压产生温漂" -> keep meaningful noun phrase
  const afterVerb = candidate
    .split(
      /(?:与|和|及|以及|还有|加上|跨接|串联|并联|接入|连接|经过|通过|经|流过|选用|选取|选定|采用|设置|具有|存在|包含|等于|满足|求得|解得|计算|测得)/
    )
    .pop()
    ?.trim();
  if (afterVerb && afterVerb.length >= 2) {
    candidate = afterVerb;
  }

  // Normalize "使X产生Y" -> "XY" (e.g. "运放输入失调电流产生温漂" -> "运放输入失调电流温漂")
  candidate = candidate.replace(/产生/g, '');

  // Strip trailing "为" / "是" / "记作" / "称为"
  candidate = candidate
    .replace(/(?:为|是|记作|记为|称为|称作|叫做|的符号|符号|的值|大小)$/g, '')
    .trim();

  if (candidate.length < 2 || candidate.length > 26) return null;
  if (STOP_WORDS_BEFORE_SYMBOL.has(candidate)) return null;
  if (!/[\u4e00-\u9fa5A-Za-z]/.test(candidate)) return null;
  return candidate;
}

interface MinedCandidate {
  symbol: string;
  name: string;
  definition: string;
  unit?: string;
  source: 'prose' | 'table';
  definedAtChar: number;
  contextSnippet?: string;
}

function mineSymbolsFromText(text: string, baseOffset: number): MinedCandidate[] {
  if (!text) return [];
  const results: MinedCandidate[] = [];

  // 1. Markdown table rows: | $R_f$ | 反馈电阻 | $\text{k}\Omega$ |
  const lineStartOffsets: Array<{ line: string; offset: number }> = [];
  let cursor = 0;
  for (const line of text.split('\n')) {
    lineStartOffsets.push({ line, offset: cursor });
    cursor += line.length + 1;
  }

  for (const { line, offset } of lineStartOffsets) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed
      .split('|')
      .map((c) => c.trim())
      .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    if (cells.length >= 2) {
      const firstMath = cells[0].match(/^\$([^$\n]+)\$$/);
      if (firstMath) {
        const symTex = firstMath[1].trim();
        if (normalizeSymbolKeys(symTex)) {
          const meaning = cleanExplanationText(cells[1]);
          if (meaning && meaning.length >= 2 && !/^[-:]+$/.test(meaning)) {
            const unitCell = cells[2] ? cleanExplanationText(cells[2].replace(/^\$|\$$/g, '')) : undefined;
            results.push({
              symbol: symTex,
              name: meaning.slice(0, 22),
              definition: meaning,
              unit: unitCell || undefined,
              source: 'table',
              definedAtChar: baseOffset < 0 ? -1 : baseOffset + offset,
              contextSnippet: `${symTex}：${meaning}`,
            });
          }
        }
      }
    }
  }

  // 2. Inline math spans `$sym$` or `$sym = ...$`
  const inlineMathRe = /(^|[^\\])\$((?:\\.|[^\n$\\]){1,80}?)\$/g;
  let match: RegExpExecArray | null;
  while ((match = inlineMathRe.exec(text)) !== null) {
    const rawInside = match[2].trim();
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;

    // Extract symbol token (either whole span or LHS of `=`/`≈`)
    let symTex = rawInside;
    let rhsNote = '';
    const eqMatch = rawInside.match(/^([^=≈]+?)\s*[=≈]\s*(.+)$/);
    if (eqMatch) {
      symTex = eqMatch[1].trim();
      rhsNote = eqMatch[2].trim();
    }

    const keys = normalizeSymbolKeys(symTex);
    if (!keys) continue;

    const unit = extractUnitFromRhs(rhsNote);

    // Check Pattern B after `$sym$`: e.g., `$R_f$（反馈电阻）` or `$R_f$ 表示反馈电阻...`
    const after = text.slice(matchEnd, Math.min(text.length, matchEnd + 90));
    const parenAfter = after.match(/^\s*[（(]([^）)\n]{2,42})[）)]/);
    const verbAfter = after.match(
      /^\s*(?:为|表示|代表|是指|指|即|是|称作|称为|定义为|记作|记为|：|:|——|—)\s*([^。；;\n]{2,56})/
    );

    if (parenAfter) {
      const inner = cleanExplanationText(parenAfter[1]);
      if (
        inner.length >= 2 &&
        !/^(?:图|表|式|第)\s*\d/.test(inner) &&
        !/^[\d.\s]+(?:V|A|Ω|Hz|F|H|W|mV|kΩ|nA|pF)$/i.test(inner) &&
        /[\u4e00-\u9fa5A-Za-z]/.test(inner)
      ) {
        results.push({
          symbol: symTex,
          name: inner.split(/[，,；;]/)[0].trim().slice(0, 24),
          definition: inner,
          unit,
          source: 'prose',
          definedAtChar: baseOffset < 0 ? -1 : baseOffset + matchStart,
          contextSnippet: `${match[0]}${parenAfter[0]}`.trim(),
        });
        continue;
      }
    }

    if (verbAfter) {
      const desc = cleanExplanationText(verbAfter[1]);
      // Skip purely algebraic continuations like `$u_I$ 为 0.5 V` if too short, unless it has Chinese words
      if (desc.length >= 2 && /[\u4e00-\u9fa5]/.test(desc)) {
        const shortName = desc
          .replace(/^(?:电路的|运放的|系统的|本节中的|其中的)/, '')
          .split(/[，,；;（(]/)[0]
          .trim()
          .slice(0, 24);
        results.push({
          symbol: symTex,
          name: shortName || desc.slice(0, 24),
          definition: desc,
          unit,
          source: 'prose',
          definedAtChar: baseOffset < 0 ? -1 : baseOffset + matchStart,
          contextSnippet: `${match[0]} ${verbAfter[0]}`.trim(),
        });
        continue;
      }
    }

    // Check Pattern A before `$sym$`: e.g., `反馈电阻 $R_f$` or `积分电阻 $R = 100\,\text{k}\Omega$`
    const before = text.slice(Math.max(0, matchStart - 48), matchStart);
    const term = extractTermBeforeMath(before);
    if (term) {
      const fullSentenceSnippet = `${term} $${rawInside}$`;
      const defText = rhsNote
        ? `${term}（在本例/上文中取值或关系为 $${symTex} = ${rhsNote}$）`
        : term;
      results.push({
        symbol: symTex,
        name: term,
        definition: defText,
        unit,
        source: 'prose',
        definedAtChar: baseOffset < 0 ? -1 : baseOffset + matchStart,
        contextSnippet: fullSentenceSnippet,
      });
    }
  }

  return results;
}

function registerEntry(
  index: LessonSymbolIndex,
  candidate: {
    symbol: string;
    aliases?: string[];
    name: string;
    definition: string;
    unit?: string;
    source: 'glossary' | 'prose' | 'table';
    definedAtChar: number;
    contextSnippet?: string;
  },
  overwriteExisting: boolean
): void {
  const keys = normalizeSymbolKeys(candidate.symbol);
  if (!keys) return;

  const allKeys = new Set<string>([keys.canonicalKey, keys.looseKey]);
  if (Array.isArray(candidate.aliases)) {
    for (const al of candidate.aliases) {
      const ak = normalizeSymbolKeys(al);
      if (ak) {
        allKeys.add(ak.canonicalKey);
        allKeys.add(ak.looseKey);
      }
    }
  }

  const existing = index.byKey.get(keys.canonicalKey) || index.byKey.get(keys.looseKey);
  if (existing) {
    if (candidate.definedAtChar < existing.definedAtChar) {
      existing.definedAtChar = candidate.definedAtChar;
    }
    if (overwriteExisting) {
      existing.name = candidate.name || existing.name;
      existing.definition = candidate.definition || existing.definition;
      if (candidate.unit) existing.unit = candidate.unit;
      if (candidate.source === 'glossary') existing.source = 'glossary';
    }
    for (const k of allKeys) {
      if (!index.byKey.has(k)) index.byKey.set(k, existing);
    }
    return;
  }

  const resolved: ResolvedLessonSymbol = {
    symbol: candidate.symbol.replace(/^\$+|\$+$/g, '').trim(),
    aliases: candidate.aliases,
    name: candidate.name,
    definition: candidate.definition,
    unit: candidate.unit,
    canonicalKey: keys.canonicalKey,
    looseKey: keys.looseKey,
    allKeys: Array.from(allKeys),
    source: candidate.source,
    definedAtChar: candidate.definedAtChar,
    contextSnippet: candidate.contextSnippet,
  };

  index.entries.push(resolved);
  for (const k of allKeys) {
    if (!index.byKey.has(k)) {
      index.byKey.set(k, resolved);
    }
  }
}

/**
 * Build a unified index of all explained LaTeX symbols for a lesson, merging:
 * 1) Preceding header fields (`summary`, `teachingContext`, `keyPoints`) -> `definedAtChar = -1`
 * 2) Automated prose & table mining in `markdownBody` -> `definedAtChar >= 0`
 * 3) Explicit `lesson.symbolGlossary` entries (preserving earliest prose explanation offset if present)
 */
export function buildLessonSymbolIndex(lesson: DailyLessonContent | null | undefined): LessonSymbolIndex {
  const index: LessonSymbolIndex = {
    entries: [],
    byKey: new Map(),
  };
  if (!lesson) return index;

  // 1. Header fields (always precede markdownBody derivations)
  const headerTexts: string[] = [
    lesson.summary || '',
    ...(lesson.keyPoints || []),
    ...(lesson.teachingContext?.prerequisites || []),
    ...(lesson.teachingContext?.learningObjectives || []),
    lesson.teachingContext?.teachingScope || '',
    lesson.teachingContext?.connectionNote || '',
  ].filter(Boolean);

  for (const ht of headerTexts) {
    for (const m of mineSymbolsFromText(ht, -1)) {
      registerEntry(index, m, false);
    }
  }

  // 2. Explicit symbolGlossary entries (enriched with earliest definition/mention offset in body)
  const body = lesson.markdownBody || '';
  const bodyMined = mineSymbolsFromText(body, 0);

  // Register body-mined candidates first so we know exact prose definition offsets
  for (const m of bodyMined) {
    registerEntry(index, m, false);
  }

  // Merge explicit symbolGlossary on top (authoritative name/definition/unit, preserving prose offset when introduced in body)
  if (Array.isArray(lesson.symbolGlossary)) {
    for (const item of lesson.symbolGlossary) {
      const rawDef =
        item?.definition ||
        (item as any)?.explanation ||
        (item as any)?.meaning ||
        (item as any)?.description ||
        '';
      if (!item?.symbol || (!item.name && !rawDef)) continue;
      const keys = normalizeSymbolKeys(item.symbol);
      if (!keys) continue;

      const existing = index.byKey.get(keys.canonicalKey) || index.byKey.get(keys.looseKey);
      const definedAtChar = existing ? existing.definedAtChar : -1;

      registerEntry(
        index,
        {
          symbol: item.symbol,
          aliases: item.aliases,
          name: item.name || item.symbol,
          definition: rawDef || item.name,
          unit: item.unit,
          source: 'glossary',
          definedAtChar,
        },
        true
      );
    }
  }

  return index;
}

export function lookupSymbolInIndex(
  index: LessonSymbolIndex,
  rawSymbolOrText: string
): ResolvedLessonSymbol | null {
  if (!index || index.byKey.size === 0 || !rawSymbolOrText) return null;
  const keys = normalizeSymbolKeys(rawSymbolOrText);
  if (!keys) return null;
  return index.byKey.get(keys.canonicalKey) || index.byKey.get(keys.looseKey) || null;
}

/**
 * Annotate rendered `.katex` DOM elements inside a lesson article container so that
 * any symbol that was ALREADY explained in preceding context (`definedAtChar < 0` or
 * earlier in the article DOM) gets `data-latex-symbol="<canonicalKey>"`.
 * Never mutates DOM geometry (no wrapping elements added; KaTeX layout stays pixel-identical).
 */
export function annotateKatexSymbolsInContainer(
  rootEl: HTMLElement | null | undefined,
  index: LessonSymbolIndex
): number {
  if (!rootEl || !index || index.entries.length === 0) return 0;

  // Clear stale annotations before re-annotating
  const prevAnnotated = rootEl.querySelectorAll('[data-latex-symbol]');
  prevAnnotated.forEach((el) => {
    el.removeAttribute('data-latex-symbol');
    el.removeAttribute('data-latex-symbol-label');
    el.removeAttribute('title');
  });

  // Track the first `.katex` occurrence (or body order) of body-defined symbols
  // so symbols explained in preceding prose become interactive in all subsequent formulas & exercises.
  const katexNodes = Array.from(rootEl.querySelectorAll<HTMLElement>('.katex'));
  const firstProseKatexIndexByKey = new Map<string, number>();

  for (let i = 0; i < katexNodes.length; i++) {
    const kEl = katexNodes[i];
    const inHeaderScope = Boolean(kEl.closest('[data-symbol-scope="header"]'));
    if (inHeaderScope) continue;
    const htmlSpan = kEl.querySelector<HTMLElement>('.katex-html');
    if (!htmlSpan) continue;

    const candidates = collectSymbolCandidatesFromKatexHtml(htmlSpan);
    for (const c of candidates) {
      const matched = lookupSymbolInIndex(index, c.rawText);
      if (matched && matched.definedAtChar >= 0) {
        if (!firstProseKatexIndexByKey.has(matched.canonicalKey)) {
          firstProseKatexIndexByKey.set(matched.canonicalKey, i);
        }
      }
    }
  }

  let annotatedCount = 0;

  for (let i = 0; i < katexNodes.length; i++) {
    const kEl = katexNodes[i];
    const inHeaderScope = Boolean(kEl.closest('[data-symbol-scope="header"]'));
    const inPostBodyScope = Boolean(kEl.closest('[data-symbol-scope="post-body"]'));
    const htmlSpan = kEl.querySelector<HTMLElement>('.katex-html');
    if (!htmlSpan) continue;

    const candidates = collectSymbolCandidatesFromKatexHtml(htmlSpan);
    for (const cand of candidates) {
      const matched = lookupSymbolInIndex(index, cand.rawText);
      if (!matched) continue;

      // Enforce preceding-context rule ("上文解释过"):
      // 1. Defined in header/summary/glossary (-1): unlocked everywhere (or after header if inside body)
      // 2. Defined in body prose (>= 0):
      //    - Never unlock inside header scope
      //    - Unlock in post-body scope (end exercises, reverse checks)
      //    - Inside body, unlock on any occurrence strictly AFTER the first introduction/explanation site
      if (matched.definedAtChar >= 0) {
        if (inHeaderScope) continue;
        if (!inPostBodyScope) {
          const introIdx = firstProseKatexIndexByKey.get(matched.canonicalKey);
          if (introIdx !== undefined && i <= introIdx) {
            continue;
          }
        }
      }

      if (cand.elements.some((el) => el.hasAttribute('data-latex-symbol'))) {
        continue;
      }

      for (const targetEl of cand.elements) {
        targetEl.setAttribute('data-latex-symbol', matched.canonicalKey);
        targetEl.setAttribute(
          'data-latex-symbol-label',
          `${matched.name}：${matched.definition}`
        );
        targetEl.setAttribute(
          'title',
          `点击查看上文符号「${matched.name}」的解释`
        );
        annotatedCount++;
      }
    }
  }

  return annotatedCount;
}

interface KatexSymbolCandidate {
  rawText: string;
  elements: HTMLElement[];
}

function isSimpleSymbolContainer(mord: HTMLElement): boolean {
  // Reject containers holding operators, delimiters, fractions, or large operators
  if (
    mord.querySelector('.mbin, .mrel, .mopen, .mclose, .mpunct, .mfrac, .mop')
  ) {
    return false;
  }
  return true;
}

function collectSymbolCandidatesFromKatexHtml(htmlSpan: HTMLElement): KatexSymbolCandidate[] {
  const candidates: KatexSymbolCandidate[] = [];
  const allMords = Array.from(htmlSpan.querySelectorAll<HTMLElement>('.mord'));
  const claimed = new Set<HTMLElement>();

  // Pass 1: Look for compound subscripted/superscripted `.mord` (has direct `.msupsub`)
  // and mark their descendants as claimed so subscripts like `f` inside `R_f` are never misidentified.
  for (let i = 0; i < allMords.length; i++) {
    const mord = allMords[i];
    if (mord.closest('.msupsub')) continue;
    if (!isSimpleSymbolContainer(mord)) continue;

    const hasMsupsub = Array.from(mord.children).some((ch) =>
      ch.classList.contains('msupsub')
    );
    if (!hasMsupsub) continue;

    const text = (mord.textContent || '').replace(/[\u200B-\u200D\uFEFF\u2060]/g, '').trim();
    if (!text) continue;

    // Check if preceded immediately by a Greek/differential prefix sibling `.mord` (`Δ`, `δ`, `∂`, `d`)
    const prevSib = mord.previousElementSibling as HTMLElement | null;
    const prevText = (prevSib?.textContent || '').replace(/[\u200B-\u200D\uFEFF\u2060]/g, '').trim();
    if (
      prevSib &&
      prevSib.classList.contains('mord') &&
      !claimed.has(prevSib) &&
      /^[Δδ∂d]$/.test(prevText)
    ) {
      const combined = `${prevText}${text}`;
      candidates.push({ rawText: combined, elements: [prevSib, mord] });
    }

    candidates.push({ rawText: text, elements: [mord] });
    claimed.add(mord);
    mord.querySelectorAll<HTMLElement>('.mord').forEach((child) => claimed.add(child));
  }

  // Pass 2: Standalone leaf `.mord` (e.g. `R`, `C`, `Q`, `\delta`, `\tau`) not inside `.msupsub` and not claimed
  for (let i = 0; i < allMords.length; i++) {
    const mord = allMords[i];
    if (claimed.has(mord) || mord.closest('.msupsub')) continue;
    if (!isSimpleSymbolContainer(mord)) continue;

    const hasNestedMord = Boolean(mord.querySelector('.mord'));
    if (hasNestedMord) continue;

    const text = (mord.textContent || '').replace(/[\u200B-\u200D\uFEFF\u2060]/g, '').trim();
    if (!text) continue;

    const prevSib = mord.previousElementSibling as HTMLElement | null;
    const prevText = (prevSib?.textContent || '').replace(/[\u200B-\u200D\uFEFF\u2060]/g, '').trim();
    if (
      prevSib &&
      prevSib.classList.contains('mord') &&
      !claimed.has(prevSib) &&
      /^[Δδ∂d]$/.test(prevText)
    ) {
      const combined = `${prevText}${text}`;
      candidates.push({ rawText: combined, elements: [prevSib, mord] });
    }

    candidates.push({ rawText: text, elements: [mord] });
  }

  return candidates;
}
