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
  '(?:kΩ|MΩ|GΩ|mΩ|Ω|μF|uF|nF|pF|mF|mA|μA|uA|nA|pA|kA|mV|μV|uV|kV|MV|mW|μW|uW|nW|kW|MW|mH|μH|uH|nH|pH|mC|μC|uC|nC|pC|mS|μS|uS|nS|pS|kHz|MHz|GHz|Hz|ms|μs|us|ns|ps|dBm|dB|mol\\/L|mol|kJ\\/mol|kJ|mJ|eV|Pa|kPa|MPa|N·m)';

const TEXT_MODE_CMD_RE =
  /\\(?:text|mathrm|mbox|operatorname|mathbf|mathit|mathcal|mathbb|ce|pu)\{(?:[^{}]|\{[^{}]*\})*\}/g;

/**
 * Fix accidentally subscripted SI units inside text-mode LaTeX commands
 * (e.g. \text{p_F} -> \text{pF}, \text{n_A} -> \text{nA}).
 */
export function repairDamagedUnitsInLatex(tex: string): string {
  if (!tex) return '';
  return tex.replace(
    /(\\(?:text|mathrm|mbox|operatorname)\{)([^{}]*(?:\{[^{}]*\}[^{}]*)*)(\})/g,
    (_m, open: string, body: string, close: string) => {
      const fixedBody = body.replace(
        /\b([fpnumμckMGT])_([AFVSWCJHN])\b/g,
        '$1$2'
      );
      return `${open}${fixedBody}${close}`;
    }
  );
}

/**
 * Expand unambiguous compact STEM variable+subscript tokens written without underscores
 * across Electronics, Physics, Mechanics, Chemistry, and CS
 * (e.g. uP -> u_P, uN -> u_N, iP -> i_P, iN -> i_N, uO -> u_O, uI -> u_I,
 * uI1 -> u_{I1}, Rf -> R_f, Ri -> R_i, R1 -> R_1, Auf -> A_{uf}, KCMR -> K_{CMR},
 * VGS -> V_{GS}, VTH -> V_{TH}, rbe -> r_{be}, gm -> g_m, Ek -> E_k, Ep -> E_p, v0 -> v_0)
 * while NEVER corrupting text-mode LaTeX (\text{nA}, \text{pF}), SI units, or normal English acronyms.
 */
export function expandCompactStemSubscripts(text: string): string {
  if (!text) return '';

  // Protect text-mode LaTeX spans & existing protection placeholders before expanding compact tokens
  const guarded: string[] = [];
  const stashText = (raw: string): string => {
    const idx = guarded.length;
    guarded.push(raw);
    return `@@STEMGUARD-${idx}@@`;
  };

  let out = repairDamagedUnitsInLatex(text)
    .replace(/@@PROTSPAN-\d+@@/g, (m) => stashText(m))
    .replace(TEXT_MODE_CMD_RE, (m) => stashText(m));

  // 1. Lowercase signal/electrical/physics symbol + uppercase/numeric subscript (incl. uI1, uI2, uO1):
  // Skip digit-preceded SI units (e.g. 20 nA, 2pF, 5 uN, 10 uC) and unambiguous standalone SI abbreviations (nA, pA, nF, pF, mL),
  // while STILL expanding electrical voltages uN, uC, uS, uL, uF when not preceded by a number.
  out = out.replace(
    /(?<![A-Za-z0-9_\\])([uiqpwevaxyztmqn])([PNIOFMACRLDS][0-9]*|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, base: string, sub: string, offset: number, fullStr: string) => {
      const token = base + sub;
      const before = fullStr.slice(Math.max(0, offset - 16), offset);
      const precededByNumber = /\d(?:\.\d+)?\s*$/.test(before);
      if (precededByNumber && /^(?:[fpnum])(?:A|F|C|S|N|L|M|W|H|V)$/.test(token)) {
        return token;
      }
      if (/^(?:nA|pA|nF|pF|mL)$/.test(token)) {
        return token;
      }
      return sub.length > 1 ? `${base}_{${sub}}` : `${base}_${sub}`;
    }
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
    /(?<![A-Za-z0-9_\\])R(in|out|ref|eq|[fFiIoOnNpPsScCmMlLBE][0-9]*|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, sub: string) => (sub.length > 1 ? `R_{${sub}}` : `R_${sub}`)
  );

  // 3. Capacitor C & Inductor L + subscript: Cf, Ci, Cp, Cn, Cs, Cl, Cm, C1, C2, Cin, Cout, Ceq, L1, L2, Lf
  out = out.replace(
    /(?<![A-Za-z0-9_\\])([CL])(in|out|eq|[fFiInNpPsSlLmM][0-9]*|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, base: string, sub: string) =>
      sub.length > 1 ? `${base}_{${sub}}` : `${base}_${sub}`
  );

  // 4. Uppercase Voltage U/V + subscript: Uo, Ui, Uf, Un, Vo, Vi, Vf, Vn, U1, V1, VCC, VEE, VDD, VSS, VGS, VDS, VTH, VBE, VCE, VCB, Uref, Vref, Uom
  out = out.replace(
    /(?<![A-Za-z0-9_\\])([UV])(in|out|ref|cc|ee|dd|ss|CC|EE|DD|SS|GS|DS|TH|BE|CE|CB|gs|ds|th|be|ce|cb|om|OM|pp|PP|rms|RMS|(?:[PNIOFMACRLDS]|[oifn])[0-9]*|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, base: string, sub: string) =>
      sub.length > 1 ? `${base}_{${sub}}` : `${base}_${sub}`
  );

  // 5. Uppercase Current I + subscript: Io, IP, IN, IO, II, IF, IB, IC, IE, ID, IS, IG, ICEO, ICBO, IDSS, I0, I1, I2, Iref
  out = out.replace(
    /(?<![A-Za-z0-9_\\])I(in|out|ref|CEO|CBO|DSS|(?:[PNIOFMACRLDSBCEG]|[o])[0-9]*|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
    (_m, sub: string) => (sub.length > 1 ? `I_{${sub}}` : `I_${sub}`)
  );

  // 6. Amplifier Gain A, CMRR / Equilibrium K, Frequency f, Energy E, Force F
  out = out.replace(
    /(?<![A-Za-z0-9_\\])A(uf|uo|uu|od|ud|id|cm|[ufvdc][0-9]*|[0-9]+)(?='|(?![A-Za-z0-9_]))/g,
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

  return out.replace(/@@STEMGUARD-(\d+)@@/g, (_m, i) => guarded[Number(i)] || '');
}

function braceMultiCharScripts(tex: string): string {
  // Turn K_CMR, V_CC, A_uf, R_in, C_12 -> K_{CMR}, V_{CC}, A_{uf}, R_{in}, C_{12} if not already braced,
  // while NEVER altering underscores inside \text{...}/\mathrm{...} or merging chemical suffixes (CH_3COOH)
  let out = expandCompactStemSubscripts(tex);

  const protectedSpans: string[] = [];
  out = out.replace(TEXT_MODE_CMD_RE, (m) => {
    const idx = protectedSpans.length;
    protectedSpans.push(m);
    return `@@SCRIPTGUARD-${idx}@@`;
  });

  out = out.replace(/([A-Za-z0-9)\]])_(\d{2,}|[A-Za-z+\-][A-Za-z0-9+\-']+)/g, '$1_{$2}');
  out = out.replace(
    /([A-Za-z0-9)\]])\^(\d{2,}|[0-9]+[+\-]|[A-Za-z+\-][A-Za-z0-9+\-']+)/g,
    '$1^{$2}'
  );

  return out.replace(/@@SCRIPTGUARD-(\d+)@@/g, (_m, i) => protectedSpans[Number(i)] || '');
}

export function normalizeMathUnicodeToLatex(tex: string): string {
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
  // First protect existing \text{...}/\mathrm{...}/\mbox{...} so we never double-wrap "\text{20 nA}"
  const textProtected: string[] = [];
  out = out.replace(TEXT_MODE_CMD_RE, (m) => {
    const idx = textProtected.length;
    textProtected.push(m);
    return `@@UNITGUARD-${idx}@@`;
  });

  out = out.replace(
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})(?![A-Za-z0-9_])`, 'g'),
    (_m, num, unit: string) => {
      switch (unit) {
        case 'kΩ':
          return `${num}\\,\\text{k}\\Omega`;
        case 'MΩ':
          return `${num}\\,\\text{M}\\Omega`;
        case 'GΩ':
          return `${num}\\,\\text{G}\\Omega`;
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
        case 'μV':
        case 'uV':
          return `${num}\\,\\mu\\text{V}`;
        case 'μW':
        case 'uW':
          return `${num}\\,\\mu\\text{W}`;
        case 'μH':
        case 'uH':
          return `${num}\\,\\mu\\text{H}`;
        case 'μC':
        case 'uC':
          return `${num}\\,\\mu\\text{C}`;
        case 'μS':
        case 'uS':
          return `${num}\\,\\mu\\text{S}`;
        case 'μs':
        case 'us':
          return `${num}\\,\\mu\\text{s}`;
        default:
          return `${num}\\,\\text{${unit}}`;
      }
    }
  );

  out = out.replace(/@@UNITGUARD-(\d+)@@/g, (_m, i) => textProtected[Number(i)] || '');

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
 * `\begin{cases}...\end{cases}`) outside code blocks, diagram IDs, and existing $...$ delimiters
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

  // 1. Protect code blocks, inline code, existing math delimiters, anchors, diagram IDs, URLs, Markdown links/images, HTML tags
  let work = text
    .replace(/```[\s\S]*?```/g, (m) => stash(m))
    .replace(/`[^`\n]+`/g, (m) => stash(m))
    .replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]/g, (m) => stash(m))
    .replace(/(?<!\\)\$([^\n$]+?)(?<!\\)\$|\\\([\s\S]+?\\\)/g, (m) => stash(m))
    .replace(/\{\{\s*(?:heuristic|diagram|diag|exercise)\s*:[^}]+\}\}/gi, (m) => stash(m))
    .replace(/\[\[\s*(?:heuristic|diagram|diag|exercise)\s*:[^\]]+\]\]/gi, (m) => stash(m))
    .replace(/\bdiag(?:ram)?[-_][A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*\b/gi, (m) => stash(m))
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

  // 1c. Expand compact STEM subscript tokens (uP -> u_P, uI1 -> u_{I1}, Rf -> R_f, VGS -> V_{GS}, etc.)
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
    `left(?:\\\\\\{|\\\\\\||\\.)|right(?:\\\\\\}|\\\\\\||\\.)|[bB]igl|[bB]igr|langle|rangle|lfloor|rfloor|lceil|rceil|l[vV]ert|r[vV]ert|` +
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
  const optTrailScripts = `(?:\\s*${scriptPart})*`;
  const innerSeq = (atom: string) =>
    `[+-]?${atom}(?:\\s*${opToken}\\s*[+-]?${atom}|\\s*(?=\\\\)${atom}|\\s+${atom})*`;
  const innerRound = `(?:\\\\left)?\\(${innerSeq(anyMathToken)}(?:\\\\right)?\\)${optTrailScripts}`;
  const innerSquare = `(?:\\\\left)?\\[${innerSeq(anyMathToken)}(?:\\\\right)?\\]${optTrailScripts}`;
  const atomOrInner = `(?:${innerRound}|${innerSquare}|${anyMathToken})`;
  const parenGroup = `(?:\\\\left)?\\(${innerSeq(atomOrInner)}(?:\\\\right)?\\)${optTrailScripts}`;
  const bracketGroup = `(?:\\\\left)?\\[${innerSeq(atomOrInner)}(?:\\\\right)?\\]${optTrailScripts}`;
  const delimGroup = `(?:${parenGroup}|${bracketGroup})`;
  const term = `(?:${delimGroup}|${anyMathToken})(?:\\s*(?:${delimGroup}|${strongSubSup}|${latexCmd}))*`;

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
 * Canonical key for loose diagram ID matching (e.g. `diag-4c`, `diag_4c`, `DIAG4C` -> `diag4c`).
 */
export function normalizeDiagramIdKey(id: string): string {
  return (id || '')
    .trim()
    .toLowerCase()
    .replace(/^图(?:示)?\s*/, '')
    .replace(/^fig(?:ure)?\.?\s*/i, '')
    .replace(/[-_\s]+/g, '');
}

/**
 * Extract the core identifier suffix after `diag`/`diagram` (e.g. `diag-4c` -> `4c`, `diag-1` -> `1`).
 */
export function extractDiagramSuffix(id: string): string {
  const norm = normalizeDiagramIdKey(id);
  const m = norm.match(/^(?:diagram|diag)(.+)$/);
  return m ? m[1] : norm;
}

/**
 * Resolve any flexible diagram token (`diag-4c`, `diag_4c`, `diag4c`, `图 diag-4c`, `图 4c`, `diagram-4c`)
 * against the visual list. Never blindly maps `diag-4c` to array index 4 when `diag-4c` does not exist.
 */
export function resolveVisualRefByToken(
  token: string,
  visuals: VisualAssetRef[]
): VisualAssetRef | null {
  if (!token || !visuals || visuals.length === 0) return null;
  const clean = token
    .trim()
    .replace(/^[\[\(（]+|[\]\)）]+$/g, '')
    .replace(/^(?:图示|图)\s*/, '')
    .trim();
  if (!clean) return null;

  const lowerClean = clean.toLowerCase();
  const exact = visuals.find((v) => v.id.trim().toLowerCase() === lowerClean);
  if (exact) return exact;

  const cleanKey = normalizeDiagramIdKey(clean).replace(/^diagram/, 'diag');
  const byNorm = visuals.find(
    (v) => normalizeDiagramIdKey(v.id).replace(/^diagram/, 'diag') === cleanKey
  );
  if (byNorm) return byNorm;

  const cleanSuffix = extractDiagramSuffix(clean);
  if (cleanSuffix) {
    const bySuffix = visuals.find((v) => extractDiagramSuffix(v.id) === cleanSuffix);
    if (bySuffix) return bySuffix;
  }

  // Exact title or filename match
  const byTitle = visuals.find((v) => v.title.trim().toLowerCase() === lowerClean);
  if (byTitle) return byTitle;
  const byFile = visuals.find((v) => v.fileName?.trim().toLowerCase() === lowerClean);
  if (byFile) return byFile;

  // Sub-panel parent fallback: e.g. `diag-4c` or `图 4c` resolves to parent `diag-4`
  // when all sub-parts (a)(b)(c) are drawn inside one combined SVG diagram
  const subPanelMatch = cleanSuffix.match(/^(\d+)[a-z]$/i);
  if (subPanelMatch) {
    const parentNum = subPanelMatch[1];
    const byParentSuffix = visuals.find((v) => extractDiagramSuffix(v.id) === parentNum);
    if (byParentSuffix) return byParentSuffix;
    const byParentIdx = parseInt(parentNum, 10) - 1;
    if (
      byParentIdx >= 0 &&
      byParentIdx < visuals.length &&
      visuals.some((v) => /^\d+$/.test(extractDiagramSuffix(v.id)))
    ) {
      return visuals[byParentIdx];
    }
  }

  // Numeric-only fallback ONLY for pure numbers or plain `diag-N` / `diagram-N` (no letter suffix like 4c)
  const plainNumMatch = lowerClean.match(/^(?:(?:diagram|diag)[-_\s]*)?(\d+)$/);
  if (plainNumMatch) {
    const idx = parseInt(plainNumMatch[1], 10) - 1;
    if (idx >= 0 && idx < visuals.length) {
      return visuals[idx];
    }
  }

  return null;
}

/**
 * Linkify diagram and uploaded image references inside rendered HTML text nodes
 * AND upgrade inline `<code>diag-xx</code>` pills into clickable floating-diagram links
 * (never mutating HTML attributes, <svg>, <pre>, <a>, <button>, or KaTeX spans).
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
      // 1. Exact ID (case-insensitive via combinedRegex 'gi'), never truncating a longer suffix like diag-4c
      patterns.push({ regexSrc: `(?:图示|图)\\s*${escId}(?![A-Za-z0-9_-])`, priority: 110 + cleanId.length, visual: v });
      patterns.push({ regexSrc: `\\[${escId}\\]`, priority: 105 + cleanId.length, visual: v });
      patterns.push({ regexSrc: `\\b${escId}(?![A-Za-z0-9_-])`, priority: 95 + cleanId.length, visual: v });

      // 2. Variants of diag-4c / diag_4c / diag4c / diagram-4c / 图 4c
      const diagStemMatch = cleanId.match(/^(diag(?:ram)?)[-_]?([A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*)$/i);
      if (diagStemMatch) {
        const suffix = diagStemMatch[2];
        const flexSuffix = escapeRegExp(suffix).replace(/[-_]/g, '[-_\\s]?');
        const flexDiagVariant = `diag(?:ram)?[-_\\s]?${flexSuffix}`;
        patterns.push({
          regexSrc: `(?:图示|图|Fig(?:ure)?\\.?)\\s*${flexDiagVariant}(?![A-Za-z0-9_-])`,
          priority: 108 + suffix.length,
          visual: v,
        });
        patterns.push({
          regexSrc: `\\b${flexDiagVariant}(?![A-Za-z0-9_-])`,
          priority: 92 + suffix.length,
          visual: v,
        });

        // Match "图 4c", "图示4c", "Fig. 4c" whenever suffix has a letter (e.g. 4c, 3b) or >= 2 chars
        if (/[A-Za-z]/.test(suffix) || suffix.length >= 2) {
          patterns.push({
            regexSrc: `(?:图示|图|Fig(?:ure)?\\.?)\\s*${flexSuffix}(?![A-Za-z0-9._-])`,
            priority: 88 + suffix.length,
            visual: v,
          });
        }

        // If cleanId is a pure numeric parent (e.g. diag-4), allow lower-priority sub-panel refs
        // like diag-4a / diag-4c / 图 4c to resolve to diag-4 when no separate diag-4c exists
        if (/^\d+$/.test(suffix)) {
          patterns.push({
            regexSrc: `(?:图示|图|Fig(?:ure)?\\.?)\\s*diag(?:ram)?[-_\\s]?${escapeRegExp(suffix)}[a-z](?![A-Za-z0-9_-])`,
            priority: 72,
            visual: v,
          });
          patterns.push({
            regexSrc: `\\bdiag(?:ram)?[-_\\s]?${escapeRegExp(suffix)}[a-z](?![A-Za-z0-9_-])`,
            priority: 70,
            visual: v,
          });
          patterns.push({
            regexSrc: `(?:图示|图|Fig(?:ure)?\\.?)\\s*${escapeRegExp(suffix)}[a-z](?![A-Za-z0-9._-])`,
            priority: 68,
            visual: v,
          });
        }
      }
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
          regexSrc: `${prefix}(?![A-Za-z.\\d_-])`,
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
      regexSrc: `(?:图|图示)\\s*${v.index}(?![A-Za-z.\\d\\-])`,
      priority: 60,
      visual: v,
    });
  }

  // Deduplicate regex sources preserving highest priority
  const seenSrc = new Set<string>();
  const sorted = patterns
    .sort((a, b) => b.priority - a.priority)
    .filter((p) => {
      const key = p.regexSrc.toLowerCase();
      if (seenSrc.has(key)) return false;
      seenSrc.add(key);
      return true;
    });

  if (sorted.length === 0) return html;

  const combinedRegex = new RegExp(
    sorted.map((p, i) => `(?<g${i}>${p.regexSrc})`).join('|'),
    'gi'
  );

  const buildRefButton = (visual: VisualAssetRef, labelHtml: string) =>
    `<button type="button" data-visual-ref="${escapeHtmlAttr(visual.id)}" class="diagram-ref-link inline text-sky-300 hover:text-sky-200 underline decoration-sky-500/70 hover:decoration-sky-300 underline-offset-4 cursor-pointer font-medium transition-colors" title="点击在小窗中查看图示：${escapeHtmlAttr(visual.title)}">${labelHtml}</button>`;

  // Split HTML into tags and text nodes, tracking depth inside non-linkifiable elements.
  // Inline <code>diag-4c</code> (outside <pre>) IS upgraded into a clickable floating-diagram button,
  // whereas <pre><code>...</code></pre>, <svg>, <a>, <button>, and KaTeX spans remain untouched.
  const tokens = html.split(/(<[^>]+>)/g);
  const skipTagStack: string[] = [];
  const SKIP_TAGS = new Set(['svg', 'pre', 'a', 'button', 'script', 'style']);
  let katexDepth = 0;
  const output: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;

    // Upgrade inline <code>diag-4c</code> pills when NOT inside a protected tag or KaTeX
    if (
      skipTagStack.length === 0 &&
      katexDepth === 0 &&
      /^<code(?:\s+[^>]*)?>$/i.test(tok) &&
      i + 2 < tokens.length &&
      /^<\/code>$/i.test(tokens[i + 2])
    ) {
      const codeInner = (tokens[i + 1] || '').trim();
      if (
        codeInner &&
        /^(?:[\[(（]?\s*(?:图示?|Fig(?:ure)?\.?)?\s*(?:diag(?:ram)?[-_\s]?[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*|[0-9]+[A-Za-z]?)\s*[\])）]?)$/i.test(
          codeInner
        )
      ) {
        const matchedVisual = resolveVisualRefByToken(codeInner, visuals);
        if (matchedVisual) {
          output.push(buildRefButton(matchedVisual, escapeHtmlAttr(codeInner)));
          i += 2;
          continue;
        }
      }
      // Keep non-diagram inline <code>...</code> intact without linkifying inner text
      output.push(tok, tokens[i + 1] || '', tokens[i + 2]);
      i += 2;
      continue;
    }

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
      output.push(tok);
      continue;
    }

    // Skip text nodes inside protected containers or KaTeX math trees
    if (skipTagStack.length > 0 || katexDepth > 0) {
      output.push(tok);
      continue;
    }

    output.push(
      tok.replace(combinedRegex, (...args) => {
        const fullMatch = args[0] as string;
        const groups = args[args.length - 1] as Record<string, string | undefined>;
        let matchedVisual: VisualAssetRef | null = null;
        if (groups) {
          for (let gIdx = 0; gIdx < sorted.length; gIdx++) {
            if (groups[`g${gIdx}`] !== undefined) {
              matchedVisual = sorted[gIdx].visual;
              break;
            }
          }
        }
        if (!matchedVisual) return fullMatch;
        return buildRefButton(matchedVisual, fullMatch);
      })
    );
  }

  return output.join('');
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

  // 4b. Normalize **...** bold spans outside code blocks/inline code so CJK + punctuation
  // (e.g. `称之为**“虚地”**` or `得到**$u_P=0$**`) never fails CommonMark flanking rules.
  const inlineCodeSpans: string[] = [];
  processed = processed.replace(/(`+)([^`\n]+?)\1/g, (match) => {
    const idx = inlineCodeSpans.length;
    inlineCodeSpans.push(match);
    return `@@INLINECODE-${idx}@@`;
  });
  processed = processed.replace(
    /(?<!\*)\*\*(?!\s|\*)((?:(?!\*\*|\n).)+?(?<!\s|\*))\*\*(?!\*)/g,
    '<strong>$1</strong>'
  );
  processed = processed.replace(/@@INLINECODE-(\d+)@@/g, (_m, i) => inlineCodeSpans[Number(i)] || '');

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

  // 8. Linkify diagram/image references inside visible text nodes & inline code pills
  return linkifyDiagramRefsInHtml(withMath, visuals);
}

/**
 * Unwrap Obsidian/GitHub-style source-classification blockquotes
 * (> [!TEXTBOOK], > [!PREREQ], > [!INTUITION], > [!EXTENSION])
 * into clean unboxed prose without colored borders, boxes, or source badges.
 */
export function enhanceSemanticCalloutBlockquotes(html: string): string {
  if (!html || !html.includes('<blockquote')) return html;
  return html.replace(
    /<blockquote(\s[^>]*)?>([\s\S]*?)<\/blockquote>/gi,
    (fullMatch, _attrs = '', inner = '') => {
      const trimmedInner = String(inner).trim();
      const match = trimmedInner.match(
        /^<p([^>]*)>\s*\[!(TEXTBOOK|PREREQ|INTUITION|EXTENSION)\](?:[ \t]*((?:(?!<\/p>|<br\s*\/?>)[^\r\n])*?))?\s*(?:(<\/p>)|(?:<br\s*\/?>|\r?\n)\s*([\s\S]*)$)/i
      );
      if (!match) return fullMatch;

      const pAttrs = match[1] || '';
      const rawInline = (match[3] || '').trim();
      const hadClosingP = Boolean(match[4]);

      let headerTitle = '';
      let bodyHtml = '';

      if (hadClosingP) {
        const afterFirstP = trimmedInner.slice(match[0].length);
        if (!afterFirstP.trim() && rawInline.length > 24) {
          bodyHtml = `<p${pAttrs}>${rawInline}</p>`;
        } else {
          headerTitle = rawInline;
          bodyHtml = afterFirstP;
        }
      } else {
        headerTitle = rawInline;
        const remainder = match[5] || '';
        bodyHtml = `<p${pAttrs}>${remainder}`;
      }

      const titleHtml = headerTitle
        ? `<p class="lesson-callout-plain-title">${headerTitle}</p>`
        : '';

      return `<div class="lesson-callout-plain">${titleHtml}${bodyHtml}</div>`;
    }
  );
}

/**
 * Render Markdown text containing inline ($...$) and block ($$...$$) LaTeX formulas
 * safely into HTML string. Automatically upgrades bare STEM formulas, linkifies diagram refs,
 * and styles dark-mode semantic classification callouts ([!TEXTBOOK], [!PREREQ], [!INTUITION], [!EXTENSION]).
 */
export function renderMarkdownWithLatex(
  markdown: string,
  visuals?: VisualAssetRef[]
): string {
  return enhanceSemanticCalloutBlockquotes(processLatexAndHtml(markdown, false, visuals));
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
