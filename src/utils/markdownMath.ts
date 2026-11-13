import katex from 'katex';
import { Marked } from 'marked';
import { stripAiCitationArtifacts } from './coursewareParser';

// Dedicated Marked instance where only double-tilde ~~...~~ triggers <del> strikethrough.
// Single tilde ~ is heavily used in Chinese/STEM text for page/section/value ranges
// (e.g. 物理第 1~8 页, 6.1.2(续)~6.1.3 节, 第 278~285 页) and must never strike through text.
const markedInstance = new Marked({
  gfm: true,
  breaks: false,
});

markedInstance.use({
  tokenizer: {
    del(src: string) {
      const cap = /^(~~)(?=\S)([\s\S]*?\S)\1(?!~)/.exec(src);
      if (cap) {
        return {
          type: 'del',
          raw: cap[0],
          text: cap[2],
          tokens: this.lexer.inlineTokens(cap[2]),
        };
      }
      return undefined;
    },
  },
});

export interface VisualAssetRef {
  id: string;
  title: string;
  stageLabel?: string;
  caption?: string;
  kind: 'svg' | 'image';
  svgCode?: string;
  imageUrl?: string;
  fileName?: string;
  index: number;
}

const UNIT_PATTERN =
  '(?:kΩ|MΩ|mΩ|Ω|μF|uF|nF|pF|mA|μA|uA|mV|kV|kHz|MHz|GHz|Hz|ms|μs|us|dB|mol\\/L|mol|kJ\\/mol|kJ|eV|Pa|kPa|MPa|N·m)';

/**
 * Expand unambiguous compact STEM variable+subscript tokens written without underscores
 * across Electronics, Physics, Mechanics, Chemistry, and CS
 * (e.g. uP -> u_P, uN -> u_N, iP -> i_P, iN -> i_N, uO -> u_O, uI -> u_I,
 * Rf -> R_f, Ri -> R_i, R1 -> R_1, Auf -> A_{uf}, KCMR -> K_{CMR},
 * VGS -> V_{GS}, VTH -> V_{TH}, rbe -> r_{be}, gm -> g_m, Ek -> E_k, Ep -> E_p, v0 -> v_0)
 * while leaving normal English words and acronyms (KCL, KVL, CMOS, BJT, PDF, CPU, DNA) untouched.
 */
export function expandCompactStemSubscripts(text: string): string {
  if (!text) return '';
  let out = text;

  // 1. Lowercase signal/electrical/physics symbol + uppercase or numeric subscript:
  // uP, uN, uO, uI, iP, iN, iF, u1, i1, v0, vx, vy, vz, a0, ax, ay, x0, x1, x2, y0, y1, z0, t0, t1, t2, m1, m2, q1, q2, n1, n2
  out = out.replace(
    /(?<![A-Za-z0-9_\\])([uiqpwevaxyztmqn])([PNIOFMACRLDS]|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, base: string, sub: string) =>
      sub.length > 1 ? `${base}_{${sub}}` : `${base}_${sub}`
  );

  // 1b. Small-signal transistor parameters & physics constants: rbe, rce, rds, gm, kB
  out = out.replace(
    /(?<![A-Za-z0-9_\\])r(be|ce|ds|bb|ee)(?='|(?![A-Za-z0-9_]))/g,
    (_m, sub: string) => `r_{${sub}}`
  );
  out = out.replace(/(?<![A-Za-z0-9_\\])gm(?='|(?![A-Za-z0-9_]))/g, 'g_m');
  out = out.replace(/(?<![A-Za-z0-9_\\])kB(?='|(?![A-Za-z0-9_]))/g, 'k_B');

  // 2. Resistor R + subscript: Rf, Ri, Ro, Rp, Rn, Rs, Rc, Rl, Rm, R1, R2, Rin, Rout, Rref, Req, RL, RS, RC, RB, RE
  out = out.replace(
    /(?<![A-Za-z0-9_\\])R(in|out|ref|eq|[fFiIoOnNpPsScCmMlLBE]|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, sub: string) => (sub.length > 1 ? `R_{${sub}}` : `R_${sub}`)
  );

  // 3. Capacitor C & Inductor L + subscript: Cf, Ci, Cp, Cn, Cs, Cl, Cm, C1, C2, Cin, Cout, Ceq, L1, L2, Lf
  out = out.replace(
    /(?<![A-Za-z0-9_\\])([CL])(in|out|eq|[fFiInNpPsSlLmM]|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, base: string, sub: string) =>
      sub.length > 1 ? `${base}_{${sub}}` : `${base}_${sub}`
  );

  // 4. Uppercase Voltage U/V + subscript: Uo, Ui, Uf, Un, Vo, Vi, Vf, Vn, U1, V1, VCC, VEE, VDD, VSS, VGS, VDS, VTH, VBE, VCE, VCB, Uref, Vref, Uom
  out = out.replace(
    /(?<![A-Za-z0-9_\\])([UV])(in|out|ref|cc|ee|dd|ss|CC|EE|DD|SS|GS|DS|TH|BE|CE|CB|gs|ds|th|be|ce|cb|om|OM|pp|PP|rms|RMS|[PNIOFMACRLDS]|[oifn]|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, base: string, sub: string) =>
      sub.length > 1 ? `${base}_{${sub}}` : `${base}_${sub}`
  );

  // 5. Uppercase Current I + subscript: Io, IP, IN, IO, II, IF, IB, IC, IE, ID, IS, IG, ICEO, ICBO, IDSS, I0, I1, I2, Iref
  out = out.replace(
    /(?<![A-Za-z0-9_\\])I(in|out|ref|CEO|CBO|DSS|[PNIOFMACRLDSBCEG]|[o]|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, sub: string) => (sub.length > 1 ? `I_{${sub}}` : `I_${sub}`)
  );

  // 6. Amplifier Gain A, CMRR / Equilibrium K, Frequency f, Energy E, Force F, Temperature/Period T
  out = out.replace(
    /(?<![A-Za-z0-9_\\])A(uf|uo|uu|od|ud|id|cm|[ufvdc]|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, sub: string) => (sub.length > 1 ? `A_{${sub}}` : `A_${sub}`)
  );
  out = out.replace(
    /(?<![A-Za-z0-9_\\])K(CMR|cmr|sp|eq|[abw]|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, sub: string) => (sub.length > 1 ? `K_{${sub}}` : `K_${sub}`)
  );
  out = out.replace(
    /(?<![A-Za-z0-9_\\])f(bw|BW|[HLPT]|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, sub: string) => (sub.length > 1 ? `f_{${sub}}` : `f_${sub}`)
  );
  out = out.replace(
    /(?<![A-Za-z0-9_\\])E([kp0]|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, sub: string) => (sub.length > 1 ? `E_{${sub}}` : `E_${sub}`)
  );
  out = out.replace(
    /(?<![A-Za-z0-9_\\])F([Nf]|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, sub: string) => (sub.length > 1 ? `F_{${sub}}` : `F_${sub}`)
  );

  return out;
}

function braceMultiCharScripts(tex: string): string {
  // Turn K_CMR, V_CC, A_uf, R_in, C_12 -> K_{CMR}, V_{CC}, A_{uf}, R_{in}, C_{12} if not already braced,
  // while NEVER merging trailing chemical elements after a numeric subscript (e.g. CH_3COOH -> CH_3COOH, H_2O -> H_2O)
  let out = expandCompactStemSubscripts(tex);
  out = out.replace(/([A-Za-z0-9)\]])_(\d{2,}|[A-Za-z+\-][A-Za-z0-9+\-']+)/g, '$1_{$2}');
  out = out.replace(
    /([A-Za-z0-9)\]])\^(\d{2,}|[0-9]+[+\-]|[A-Za-z+\-][A-Za-z0-9+\-']+)/g,
    '$1^{$2}'
  );
  return out;
}

function normalizeMathUnicodeToLatex(tex: string): string {
  let out = braceMultiCharScripts(tex);

  // Convert binary multiplication * (e.g. -(Rf / R1) * uI) into \cdot
  out = out.replace(/([A-Za-z0-9)}\]])\s*\*\s*(?=[A-Za-z0-9({\\])/g, '$1 \\cdot ');

  // Convert ASCII relational & arrow operators inside math expressions
  out = out
    .replace(/!=/g, '\\neq ')
    .replace(/<=>/g, '\\Leftrightarrow ')
    .replace(/<->/g, '\\leftrightarrow ')
    .replace(/<=/g, '\\le ')
    .replace(/>=/g, '\\ge ')
    .replace(/->/g, '\\to ')
    .replace(/<-/g, '\\leftarrow ');

  // Convert bare math function names with subscripts like log_2 -> \log_2, lim_{x\to 0} -> \lim_{x\to 0}
  out = out.replace(
    /(?<![\\A-Za-z])(log|ln|lg|lim|sin|cos|tan|cot|sec|csc|max|min|sup|inf|det|exp)(?=[_^(\s])/g,
    '\\$1'
  );

  // Convert explicit number + unit clusters inside math like "100 kΩ" or "5 μF" -> "100\,\text{k}\Omega"
  out = out.replace(
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})(?![A-Za-z0-9_])`, 'g'),
    (_m, num, unit: string) => {
      switch (unit) {
        case 'kΩ':
          return `${num}\\,\\text{k}\\Omega`;
        case 'MΩ':
          return `${num}\\,\\text{M}\\Omega`;
        case 'mΩ':
          return `${num}\\,\\text{m}\\Omega`;
        case 'Ω':
          return `${num}\\,\\Omega`;
        case 'μF':
        case 'uF':
          return `${num}\\,\\mu\\text{F}`;
        case 'μA':
        case 'uA':
          return `${num}\\,\\mu\\text{A}`;
        case 'μs':
        case 'us':
          return `${num}\\,\\mu\\text{s}`;
        default:
          return `${num}\\,\\text{${unit}}`;
      }
    }
  );

  out = out
    .replace(/≠/g, '\\neq ')
    .replace(/≤/g, '\\le ')
    .replace(/≥/g, '\\ge ')
    .replace(/≈/g, '\\approx ')
    .replace(/≡/g, '\\equiv ')
    .replace(/∝/g, '\\propto ')
    .replace(/∞/g, '\\infty ')
    .replace(/±/g, '\\pm ')
    .replace(/∓/g, '\\mp ')
    .replace(/×/g, '\\times ')
    .replace(/÷/g, '\\div ')
    .replace(/·/g, '\\cdot ')
    .replace(/∂/g, '\\partial ')
    .replace(/∇/g, '\\nabla ')
    .replace(/∈/g, '\\in ')
    .replace(/∉/g, '\\notin ')
    .replace(/⊂/g, '\\subset ')
    .replace(/⊆/g, '\\subseteq ')
    .replace(/∪/g, '\\cup ')
    .replace(/∩/g, '\\cap ')
    .replace(/∀/g, '\\forall ')
    .replace(/∃/g, '\\exists ')
    .replace(/⊥/g, '\\perp ')
    .replace(/∥/g, '\\parallel ')
    .replace(/∠/g, '\\angle ')
    .replace(/°/g, '^\\circ ')
    .replace(/⇌/g, '\\rightleftharpoons ')
    .replace(/⇔/g, '\\Leftrightarrow ')
    .replace(/⇒/g, '\\Rightarrow ')
    .replace(/⇐/g, '\\Leftarrow ')
    .replace(/→/g, '\\to ')
    .replace(/←/g, '\\leftarrow ')
    .replace(/Ω/g, '\\Omega ')
    .replace(/ω/g, '\\omega ')
    .replace(/μ/g, '\\mu ')
    .replace(/τ/g, '\\tau ')
    .replace(/Δ/g, '\\Delta ')
    .replace(/δ/g, '\\delta ')
    .replace(/α/g, '\\alpha ')
    .replace(/β/g, '\\beta ')
    .replace(/γ/g, '\\gamma ')
    .replace(/Γ/g, '\\Gamma ')
    .replace(/θ/g, '\\theta ')
    .replace(/Θ/g, '\\Theta ')
    .replace(/λ/g, '\\lambda ')
    .replace(/Λ/g, '\\Lambda ')
    .replace(/σ/g, '\\sigma ')
    .replace(/Σ/g, '\\Sigma ')
    .replace(/φ/g, '\\phi ')
    .replace(/Φ/g, '\\Phi ')
    .replace(/ψ/g, '\\psi ')
    .replace(/Ψ/g, '\\Psi ')
    .replace(/π/g, '\\pi ')
    .replace(/Π/g, '\\Pi ')
    .replace(/ε/g, '\\varepsilon ')
    .replace(/ρ/g, '\\rho ')
    .replace(/η/g, '\\eta ')
    .replace(/ζ/g, '\\zeta ');

  return out.trim();
}

/**
 * Normalize bare STEM mathematical tokens/equations across all disciplines
 * (e.g. `u_O = -i_F R_f`, `uP = uN`, `uO = -(Rf / R1) * uI`, `du_C/dt`,
 * `H_2O`, `SO_4^{2-}`, `CH_3COOH`, `O(n \log n)`, `\nabla \times \vec{E}`,
 * `\begin{cases}...\end{cases}`) outside code blocks and existing $...$ delimiters
 * into crisp `$...$` / `$$...$$` spans so KaTeX renders them identically inside
 * prose, heuristic boxes, exercises, captions, titles, and summary fields.
 */
export function normalizeBareMathForMarkdown(text: string): string {
  if (!text) return '';

  const protectedSpans: string[] = [];
  const stash = (raw: string): string => {
    const idx = protectedSpans.length;
    protectedSpans.push(raw);
    return `@@PROTSPAN-${idx}@@`;
  };

  // 1. Protect code blocks, inline code, existing math delimiters, anchors, URLs, Markdown links/images, HTML tags
  let work = text
    .replace(/```[\s\S]*?```/g, (m) => stash(m))
    .replace(/`[^`\n]+`/g, (m) => stash(m))
    .replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]/g, (m) => stash(m))
    .replace(/(?<!\\)\$([^\n$]+?)(?<!\\)\$|\\\([\s\S]+?\\\)/g, (m) => stash(m))
    .replace(/\{\{\s*(?:heuristic|diagram|exercise)\s*:[^}]+\}\}/gi, (m) => stash(m))
    .replace(/!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)/g, (m) => stash(m))
    .replace(/https?:\/\/[^\s)<>]+/gi, (m) => stash(m))
    .replace(/<\/?[a-zA-Z][^>]*>/g, (m) => stash(m));

  // 1a. Wrap bare LaTeX display environments (\begin{aligned|cases|...matrix|array}...\end{...}) in $$...$$
  work = work.replace(
    /\\begin\{(aligned|align\*?|cases|p?b?v?V?matrix|array)\}[\s\S]*?\\end\{\1\}/g,
    (m) => stash(`$$${m}$$`)
  );

  // 1b. Protect genuine lowercase snake_case programming identifiers (like section_id, max_width, split_plan)
  // while NEVER blocking math/chemistry/differential tokens (du_C, di_L, SO_4, CH_3, Fe_2, log_2, lim_n, V_GS)
  work = work.replace(
    /\b(?!log_|lim_|sin_|cos_|tan_|cot_|sec_|csc_|min_|max_|sup_|inf_|arg_|det_|dim_|ker_|deg_|exp_|var_|cov_|mod_)[a-z]{3,}_[a-z0-9_]{2,}\b/g,
    (m) => stash(m)
  );

  // 1c. Expand compact STEM subscript tokens (uP -> u_P, Rf -> R_f, R1 -> R_1, VGS -> V_{GS}, etc.)
  work = expandCompactStemSubscripts(work);

  // 2. Group contiguous bare math expressions containing at least one strong math trigger
  //    Supports single-letter vars, differentials (du_C, di_L), chemical formulas (H_2O, SO_4^{2-}, CH_3COOH),
  //    operator scripts (log_2, lim_{x\to 0}), and comprehensive LaTeX commands across all STEM fields.
  const nestedBraces = `\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\}`;
  const scriptPart = `(?:_${nestedBraces}|_(?:\\d+|[A-Za-z+\\-'()][A-Za-z0-9+\\-'()]*)|\\^${nestedBraces}|\\^(?:\\d+[+\\-]?|[A-Za-z+\\-'()°∘][A-Za-z0-9+\\-'()°∘]*))`;
  const strongSubSup = `(?:[A-Za-z]+|\\d+(?:\\.\\d+)?|[)\\]])(?:${scriptPart}+[A-Za-z0-9]*)+`;

  const latexCmd =
    `\\\\(?:` +
    `[dtc]?frac|sqrt|binom|overset|underset|stackrel|` +
    `sum|prod|coprod|ii*nt|oint|lim(?:sup|inf)?|nabla|partial|` +
    `vec|overrightarrow|overleftarrow|hat|widehat|bar|overline|underline|tilde|widetilde|dd?ot|` +
    `mathbf|mathrm|mathit|mathcal|mathbb|mathfrak|mathscr|boldsymbol|text|operatorname|mbox|boxed|` +
    `left|right|[bB]igl|[bB]igr|langle|rangle|lfloor|rfloor|lceil|rceil|l[vV]ert|r[vV]ert|` +
    `arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|cot|sec|csc|ln|log|lg|exp|max|min|sup|inf|arg|det|dim|ker|deg|gcd|bmod|pmod|` +
    `alpha|beta|gamma|Gamma|delta|Delta|epsilon|varepsilon|zeta|eta|theta|Theta|vartheta|iota|kappa|lambda|Lambda|mu|nu|xi|Xi|pi|Pi|varpi|rho|varrho|sigma|Sigma|varsigma|tau|upsilon|Upsilon|phi|varphi|Phi|chi|psi|Psi|omega|Omega|` +
    `infty|hbar|ell|forall|exists|nexists|in|notin|ni|subset|supset|subseteq|supseteq|cup|cap|setminus|emptyset|varnothing|neg|lnot|land|lor|` +
    `neq|ne|leq|le|geq|ge|ll|gg|approx|sim|simeq|cong|equiv|propto|` +
    `times|div|cdot|cdots|ldots|dots|vdots|ddots|pm|mp|oplus|otimes|odot|circ|bullet|star|ast|perp|parallel|angle|triangle|degree|` +
    `rightarrow|to|leftarrow|gets|leftrightarrow|Rightarrow|implies|Leftarrow|Leftrightarrow|iff|mapsto|uparrow|downarrow|rightleftharpoons|leftharpoons` +
    `)(?:\\s*${scriptPart})*(?:\\s*${nestedBraces})*(?:\\s*${scriptPart})*`;

  const plainOperand = `(?:\\d+(?:\\.\\d+)?(?:\\s*${UNIT_PATTERN})?|d[A-Za-z]|[A-Za-z]'?)`;
  const opToken = `(?:!=|<=>|<->|<=|>=|->|<-|=>|=|≠|≤|≥|≈|≡|∝|±|∓|×|÷|·|\\+|\\-|\\*|/|<|>|→|←|⇌|⇔|⇒|∈|⊂|⊆|∪|∩)`;
  const unitCluster = `(?:\\d+(?:\\.\\d+)?\\s*${UNIT_PATTERN})`;
  const anyMathToken = `(?:${latexCmd}|${strongSubSup}|${unitCluster}|${plainOperand})`;
  const innerParen = `\\([+-]?${anyMathToken}(?:\\s*${opToken}\\s*[+-]?${anyMathToken}|\\s+${anyMathToken})*\\)`;
  const atomOrInner = `(?:${innerParen}|${anyMathToken})`;
  const parenGroup = `\\([+-]?${atomOrInner}(?:\\s*${opToken}\\s*[+-]?${atomOrInner}|\\s+${atomOrInner})*\\)`;
  const term = `(?:${parenGroup}|${anyMathToken})(?:\\s*(?:${parenGroup}|${strongSubSup}|${latexCmd}))*`;

  // Match contiguous equation / expression sequences on a single line (supports unary -/+ after operators)
  const exprRegex = new RegExp(
    `[+-]?${term}(?:\\s*${opToken}\\s*[+-]?${term}|\\s+${term})*`,
    'g'
  );

  work = work.replace(exprRegex, (candidate, offset: number, fullStr: string) => {
    // Must contain at least one strong math trigger (_, ^, or \) to avoid touching normal English/numbers
    if (!/[_^\\]/.test(candidate)) {
      return candidate;
    }
    // Avoid transforming inside protected placeholders
    if (candidate.includes('@@PROTSPAN-')) {
      return candidate;
    }

    // Do not break surrounding identifiers
    const charBefore = offset > 0 ? fullStr[offset - 1] : '';
    const charAfter = offset + candidate.length < fullStr.length ? fullStr[offset + candidate.length] : '';
    if (/[A-Za-z0-9_]/.test(charBefore) || /[A-Za-z0-9_]/.test(charAfter)) {
      return candidate;
    }

    let trimmed = candidate.trim();
    const leadingWs = candidate.slice(0, candidate.length - candidate.trimStart().length);
    const trailingWs = candidate.slice(candidate.trimEnd().length);

    // Strip redundant outer balanced parentheses only if the whole expression is wrapped in (...)
    // like "(u_O = (1 + R_f/R)u_I)" -> "(${$u_O = (1 + R_f/R)u_I$})"
    let outerPrefix = '';
    let outerSuffix = '';
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      let depth = 0;
      let wrapsEntire = true;
      for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i] === '(') depth++;
        else if (trimmed[i] === ')') depth--;
        if (depth === 0 && i < trimmed.length - 1) {
          wrapsEntire = false;
          break;
        }
      }
      if (wrapsEntire) {
        outerPrefix = '(';
        outerSuffix = ')';
        trimmed = trimmed.slice(1, -1).trim();
      }
    }

    const tex = normalizeMathUnicodeToLatex(trimmed);
    return stash(`${leadingWs}${outerPrefix}$${tex}$${outerSuffix}${trailingWs}`);
  });

  // 3. Catch any remaining isolated bare math tokens that weren't captured above
  work = work.replace(
    new RegExp(`(?<![A-Za-z0-9_@$])(${latexCmd}|${strongSubSup})(?![A-Za-z0-9_@])`, 'g'),
    (_m, tok: string) => stash(`$${normalizeMathUnicodeToLatex(tok)}$`)
  );

  // Restore protected spans
  return work.replace(/@@PROTSPAN-(\d+)@@/g, (_m, i) => protectedSpans[Number(i)] || '');
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Linkify diagram and uploaded image references inside rendered HTML text nodes
 * (never mutating HTML attributes, <svg>, <code>, <pre>, <a>, <button>, or KaTeX spans).
 */
export function linkifyDiagramRefsInHtml(
  html: string,
  visuals?: VisualAssetRef[]
): string {
  if (!html || !visuals || visuals.length === 0) return html;

  const patterns: Array<{ regexSrc: string; priority: number; visual: VisualAssetRef }> = [];

  for (const v of visuals) {
    const cleanId = v.id.trim();
    const cleanTitle = (v.title || '').trim();

    if (cleanId) {
      const escId = escapeRegExp(cleanId);
      patterns.push({ regexSrc: `(?:图示|图)\\s*${escId}`, priority: 100 + cleanId.length, visual: v });
      patterns.push({ regexSrc: `\\b${escId}\\b`, priority: 85 + cleanId.length, visual: v });
    }

    if (cleanTitle.length >= 3) {
      // Exact title (without leading/trailing whitespace)
      patterns.push({
        regexSrc: escapeRegExp(cleanTitle),
        priority: 95 + cleanTitle.length,
        visual: v,
      });

      // Extract leading figure designator such as "图 1.1" or "图6.1.3" from title
      const figNumMatch = cleanTitle.match(/^((?:图|Fig\.?)\s*\d+(?:\.\d+)*)/i);
      if (figNumMatch) {
        const prefix = figNumMatch[1].replace(/\s+/g, '\\s*');
        patterns.push({
          regexSrc: `${prefix}(?![.\\d])`,
          priority: 80 + figNumMatch[1].length,
          visual: v,
        });
      }
    }

    if (v.fileName && v.fileName.length >= 3) {
      patterns.push({
        regexSrc: escapeRegExp(v.fileName),
        priority: 75 + v.fileName.length,
        visual: v,
      });
    }

    // Generic "图 1" / "图1" fallback mapped to 1-based visual index
    patterns.push({
      regexSrc: `(?:图|图示)\\s*${v.index}(?![.\\d\\-])`,
      priority: 60,
      visual: v,
    });
  }

  // Deduplicate regex sources preserving highest priority
  const seenSrc = new Set<string>();
  const sorted = patterns
    .sort((a, b) => b.priority - a.priority)
    .filter((p) => {
      if (seenSrc.has(p.regexSrc)) return false;
      seenSrc.add(p.regexSrc);
      return true;
    });

  if (sorted.length === 0) return html;

  const combinedRegex = new RegExp(
    sorted.map((p, i) => `(?<g${i}>${p.regexSrc})`).join('|'),
    'g'
  );

  // Split HTML into tags and text nodes, tracking depth inside non-linkifiable elements
  const tokens = html.split(/(<[^>]+>)/g);
  const skipTagStack: string[] = [];
  const SKIP_TAGS = new Set(['svg', 'code', 'pre', 'a', 'button', 'script', 'style']);
  let katexDepth = 0;

  return tokens
    .map((tok) => {
      if (!tok) return '';
      if (tok.startsWith('<')) {
        const lower = tok.toLowerCase();
        const isClosing = /^<\//.test(lower);
        const isSelfClosing = /\/>$/.test(lower);
        const tagMatch = lower.match(/^<\/?([a-z0-9-]+)/);
        const tagName = tagMatch ? tagMatch[1] : '';

        if (tagName === 'span') {
          if (!isClosing && !isSelfClosing && /class="[^"]*\bkatex\b/i.test(tok)) {
            katexDepth++;
          } else if (isClosing && katexDepth > 0) {
            katexDepth--;
          }
        }

        if (SKIP_TAGS.has(tagName) && !isSelfClosing) {
          if (!isClosing) {
            skipTagStack.push(tagName);
          } else {
            const idx = skipTagStack.lastIndexOf(tagName);
            if (idx !== -1) skipTagStack.splice(idx, 1);
          }
        }
        return tok;
      }

      // Skip text nodes inside protected containers or KaTeX math trees
      if (skipTagStack.length > 0 || katexDepth > 0) {
        return tok;
      }

      return tok.replace(combinedRegex, (...args) => {
        const fullMatch = args[0] as string;
        const groups = args[args.length - 1] as Record<string, string | undefined>;
        let matchedVisual: VisualAssetRef | null = null;
        if (groups) {
          for (let i = 0; i < sorted.length; i++) {
            if (groups[`g${i}`] !== undefined) {
              matchedVisual = sorted[i].visual;
              break;
            }
          }
        }
        if (!matchedVisual) return fullMatch;
        return `<button type="button" data-visual-ref="${escapeHtmlAttr(matchedVisual.id)}" class="diagram-ref-link inline text-sky-300 hover:text-sky-200 underline decoration-sky-500/70 hover:decoration-sky-300 underline-offset-4 cursor-pointer font-medium transition-colors" title="点击在小窗中查看图示：${escapeHtmlAttr(matchedVisual.title)}">${fullMatch}</button>`;
      });
    })
    .join('');
}

function processLatexAndHtml(
  input: string,
  inlineOnly: boolean,
  visuals?: VisualAssetRef[]
): string {
  if (!input) return '';

  const mathBlocks: string[] = [];
  const codeBlocks: string[] = [];

  // 1. Clean AI citation artifacts and auto-delimit bare STEM math expressions
  const cleaned = stripAiCitationArtifacts(input);
  const normalized = normalizeBareMathForMarkdown(cleaned);

  // 2. Protect fenced code blocks first so $ inside code is not treated as math
  let processed = normalized.replace(/```[\s\S]*?```/g, (match) => {
    const idx = codeBlocks.length;
    codeBlocks.push(match);
    return `@@CODEBLOCK-${idx}@@`;
  });

  // 3. Replace display math $$...$$ and \[...\]
  processed = processed.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (_match, g1, g2) => {
    const tex = normalizeMathUnicodeToLatex((g1 || g2 || '').trim());
    const idx = mathBlocks.length;
    try {
      const html = katex.renderToString(tex, {
        displayMode: true,
        throwOnError: false,
        strict: false,
      });
      mathBlocks.push(`<div class="my-4 overflow-x-auto">${html}</div>`);
    } catch {
      mathBlocks.push(`<pre class="text-neutral-300 font-mono">${tex}</pre>`);
    }
    return `@@MATHBLOCK-${idx}@@`;
  });

  // 4. Replace inline math $...$ and \(...\)
  processed = processed.replace(
    /(?<!\\)\$([^\n$]+?)(?<!\\)\$|\\\(([\s\S]+?)\\\)/g,
    (_match, g1, g2) => {
      const tex = normalizeMathUnicodeToLatex((g1 || g2 || '').trim());
      if (!tex) return _match;
      const idx = mathBlocks.length;
      try {
        const html = katex.renderToString(tex, {
          displayMode: false,
          throwOnError: false,
          strict: false,
        });
        mathBlocks.push(html);
      } catch {
        mathBlocks.push(`<code>${tex}</code>`);
      }
      return `@@MATHBLOCK-${idx}@@`;
    }
  );

  // 5. Restore code blocks before running marked
  processed = processed.replace(/@@CODEBLOCK-(\d+)@@/g, (_m, i) => codeBlocks[Number(i)] || '');

  // 6. Parse Markdown (block vs inline) using markedInstance where single ~ does not trigger <del>
  const rawHtml = (
    inlineOnly
      ? markedInstance.parseInline(processed, { async: false })
      : markedInstance.parse(processed, { async: false })
  ) as string;

  // 7. Restore rendered KaTeX HTML blocks
  const withMath = rawHtml.replace(/@@MATHBLOCK-(\d+)@@/g, (_m, i) => mathBlocks[Number(i)] || '');

  // 8. Linkify diagram/image references inside visible text nodes
  return linkifyDiagramRefsInHtml(withMath, visuals);
}

/**
 * Render Markdown text containing inline ($...$) and block ($$...$$) LaTeX formulas
 * safely into HTML string. Automatically upgrades bare STEM formulas and linkifies diagram refs.
 */
export function renderMarkdownWithLatex(
  markdown: string,
  visuals?: VisualAssetRef[]
): string {
  return processLatexAndHtml(markdown, false, visuals);
}

/**
 * Render single-line/inline text (titles, headings, badges, keyPoints, summaries, diagram titles)
 * with full bare-math normalization, KaTeX rendering, and clickable diagram refs without <p> wrappers.
 */
export function renderInlineMathWithLatex(
  text: string,
  visuals?: VisualAssetRef[]
): string {
  return processLatexAndHtml(text, true, visuals);
}
