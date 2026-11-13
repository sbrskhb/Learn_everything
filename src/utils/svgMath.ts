/**
 * Pure utilities for rendering mathematical expressions, subscripts, superscripts,
 * and LaTeX symbols cleanly inside inline SVG <text> elements, while preventing
 * single-line callout text overflow past the SVG viewBox right edge.
 */

import { expandCompactStemSubscripts } from './markdownMath';

const LATEX_SYMBOL_MAP: Array<[RegExp, string]> = [
  [/\\Omega\b/g, 'Ω'],
  [/\\omega\b/g, 'ω'],
  [/\\infty\b/g, '∞'],
  [/\\Delta\b/g, 'Δ'],
  [/\\delta\b/g, 'δ'],
  [/\\Gamma\b/g, 'Γ'],
  [/\\gamma\b/g, 'γ'],
  [/\\Lambda\b/g, 'Λ'],
  [/\\lambda\b/g, 'λ'],
  [/\\Sigma\b/g, 'Σ'],
  [/\\sigma\b/g, 'σ'],
  [/\\Theta\b/g, 'Θ'],
  [/\\theta\b/g, 'θ'],
  [/\\vartheta\b/g, 'ϑ'],
  [/\\Phi\b/g, 'Φ'],
  [/\\phi\b/g, 'φ'],
  [/\\varphi\b/g, 'φ'],
  [/\\Psi\b/g, 'Ψ'],
  [/\\psi\b/g, 'ψ'],
  [/\\Pi\b/g, 'Π'],
  [/\\pi\b/g, 'π'],
  [/\\Xi\b/g, 'Ξ'],
  [/\\xi\b/g, 'ξ'],
  [/\\mu\b/g, 'μ'],
  [/\\tau\b/g, 'τ'],
  [/\\alpha\b/g, 'α'],
  [/\\beta\b/g, 'β'],
  [/\\epsilon\b/g, 'ϵ'],
  [/\\varepsilon\b/g, 'ε'],
  [/\\zeta\b/g, 'ζ'],
  [/\\eta\b/g, 'η'],
  [/\\kappa\b/g, 'κ'],
  [/\\nu\b/g, 'ν'],
  [/\\rho\b/g, 'ρ'],
  [/\\chi\b/g, 'χ'],
  [/\\partial\b/g, '∂'],
  [/\\nabla\b/g, '∇'],
  [/\\int\b/g, '∫'],
  [/\\oint\b/g, '∮'],
  [/\\sum\b/g, '∑'],
  [/\\prod\b/g, '∏'],
  [/\\neq\b/g, '≠'],
  [/\\ne\b/g, '≠'],
  [/\\leq\b/g, '≤'],
  [/\\le\b/g, '≤'],
  [/\\geq\b/g, '≥'],
  [/\\ge\b/g, '≥'],
  [/\\ll\b/g, '≪'],
  [/\\gg\b/g, '≫'],
  [/\\approx\b/g, '≈'],
  [/\\equiv\b/g, '≡'],
  [/\\propto\b/g, '∝'],
  [/\\times\b/g, '×'],
  [/\\div\b/g, '÷'],
  [/\\cdot\b/g, '·'],
  [/\\pm\b/g, '±'],
  [/\\mp\b/g, '∓'],
  [/\\perp\b/g, '⊥'],
  [/\\parallel\b/g, '∥'],
  [/\\angle\b/g, '∠'],
  [/\\triangle\b/g, '△'],
  [/\\in\b/g, '∈'],
  [/\\notin\b/g, '∉'],
  [/\\subset\b/g, '⊂'],
  [/\\subseteq\b/g, '⊆'],
  [/\\cup\b/g, '∪'],
  [/\\cap\b/g, '∩'],
  [/\\forall\b/g, '∀'],
  [/\\exists\b/g, '∃'],
  [/\\Rightarrow\b/g, '⇒'],
  [/\\implies\b/g, '⇒'],
  [/\\Leftarrow\b/g, '⇐'],
  [/\\Leftrightarrow\b/g, '⇔'],
  [/\\iff\b/g, '⇔'],
  [/\\rightleftharpoons\b/g, '⇌'],
  [/\\rightarrow\b/g, '→'],
  [/\\to\b/g, '→'],
  [/\\leftarrow\b/g, '←'],
  [/\\degree\b/g, '°'],
  [/\\circ\b/g, '°'],
  [/\\left\s*/g, ''],
  [/\\right\s*/g, ''],
  [/\\,/g, ' '],
  [/\\;/g, ' '],
  [/\\quad\b/g, '  '],
];

function escapeXmlText(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeXmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function normalizeSvgLatexCommands(raw: string): string {
  let out = raw;
  // Unwrap $...$ or \(...\) delimiters that models sometimes leave inside SVG <text>
  out = out.replace(/\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/g, (_m, g1, g2) => g1 ?? g2 ?? '');
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_m, g1) => g1 ?? '');

  // \text{...} / \mathrm{...} / \mathbf{...} / \mathcal{...} / \operatorname{...} -> plain inner text
  out = out.replace(
    /\\(?:text|mathrm|mathbf|mathit|mathcal|mathbb|operatorname)\{([^{}]*)\}/g,
    '$1'
  );

  // Accents: \vec{x} -> x⃗, \bar{x} -> x̄, \hat{x} -> x̂, \dot{x} -> ẋ
  out = out.replace(/\\(?:vec|overrightarrow)\{([^{}]+)\}/g, '$1\u20d7');
  out = out.replace(/\\(?:bar|overline)\{([^{}]+)\}/g, '$1\u0304');
  out = out.replace(/\\(?:hat|widehat)\{([^{}]+)\}/g, '$1\u0302');
  out = out.replace(/\\dot\{([^{}]+)\}/g, '$1\u0307');

  // \frac{a}{b} -> a/b (wrap compound numerator/denominator if needed)
  for (let pass = 0; pass < 3; pass++) {
    out = out.replace(/\\[dtc]?frac\{([^{}]+)\}\{([^{}]+)\}/g, (_m, num, den) => {
      const n = /[+\-\s]/.test(num.trim()) ? `(${num.trim()})` : num.trim();
      const d = /[+\-\s]/.test(den.trim()) ? `(${den.trim()})` : den.trim();
      return `${n}/${d}`;
    });
  }

  // \sqrt{x} -> √(x) or √x
  out = out.replace(/\\sqrt\{([^{}]+)\}/g, (_m, inner) =>
    inner.trim().length <= 2 ? `√${inner.trim()}` : `√(${inner.trim()})`
  );

  for (const [re, replacement] of LATEX_SYMBOL_MAP) {
    out = out.replace(re, replacement);
  }

  return expandCompactStemSubscripts(out);
}

/**
 * Convert plain text with math subscripts/superscripts (e.g. u_O, R_f, K_CMR, 10^{-6}, du_C, SO_4^{2-})
 * into SVG <tspan> runs with crisp italic variables and baseline-shifted scripts.
 */
export function formatSvgTextContentToTspans(rawText: string): string {
  const normalized = normalizeSvgLatexCommands(unescapeXmlEntities(rawText));

  // Match variable/element/digit/paren followed by subscript/superscript chains
  // e.g. u_O, R_f, i_F, K_CMR, A_{uf}, u_C^2, 10^{-6}, u_+, u_-, du_C, H_2, SO_4^{2-}
  const tokenRegex =
    /(?<![A-Za-z0-9_])(d[A-Za-z]|[A-Za-z]+|\d+(?:\.\d+)?|[)\]])((?:(?:_\{[^{}]+\}|_[A-Za-z0-9+\-']+|\^\{[^{}]+\}|\^[A-Za-z0-9+\-'°]+))+)/g;

  let result = '';
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(normalized)) !== null) {
    const start = match.index;
    if (start > lastIdx) {
      result += escapeXmlText(normalized.slice(lastIdx, start));
    }

    const base = match[1];
    const scriptsRaw = match[2];

    // Style single-letter or differential variables italic, keep multi-uppercase chemical/operator tokens upright
    if (/^(?:d[A-Za-z]|[A-Za-z])$/.test(base)) {
      result += `<tspan font-style="italic">${escapeXmlText(base)}</tspan>`;
    } else {
      result += escapeXmlText(base);
    }

    const scriptPartRegex = /([_^])(?:\{([^{}]+)\}|([A-Za-z0-9+\-'°]+))/g;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = scriptPartRegex.exec(scriptsRaw)) !== null) {
      const kind = sMatch[1];
      const value = sMatch[2] ?? sMatch[3] ?? '';
      const shift = kind === '_' ? 'sub' : 'super';
      result += `<tspan baseline-shift="${shift}" font-size="0.72em">${escapeXmlText(value)}</tspan>`;
    }

    lastIdx = start + match[0].length;
  }

  if (lastIdx < normalized.length) {
    result += escapeXmlText(normalized.slice(lastIdx));
  }

  return result;
}

function estimateTextWidthUnits(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) {
      units += 1.02;
    } else if (/[A-ZMW]/.test(ch)) {
      units += 0.68;
    } else if (/[ijlI1.,:;!|'\s]/.test(ch)) {
      units += 0.34;
    } else {
      units += 0.56;
    }
  }
  return units * fontSize;
}

function wrapLongTextLines(text: string, maxUnitsWidth: number, fontSize: number): string[] {
  const normalized = normalizeSvgLatexCommands(unescapeXmlEntities(text)).trim();
  if (!normalized) return [''];
  if (estimateTextWidthUnits(normalized, fontSize) <= maxUnitsWidth) {
    return [normalized];
  }

  const lines: string[] = [];
  let current = '';
  // Split into tokens preserving CJK chars, math segments, and ASCII words/punctuation
  const tokens = normalized.match(/\S+\s*|\s+/g) || [normalized];

  // Expand long CJK runs inside a token so wrapping can break naturally between CJK characters or punctuation
  const granularTokens: string[] = [];
  for (const tok of tokens) {
    if (estimateTextWidthUnits(tok, fontSize) > maxUnitsWidth * 0.65) {
      const subParts = tok.match(/[\u4e00-\u9fff，。；：、]|[A-Za-z0-9_^{}+\-*/=().Ω∞μτΔ≠≤≥≈×·±→]+|\s+|./g) || [tok];
      granularTokens.push(...subParts);
    } else {
      granularTokens.push(tok);
    }
  }

  for (const tok of granularTokens) {
    const candidate = current + tok;
    if (current.trim() && estimateTextWidthUnits(candidate, fontSize) > maxUnitsWidth) {
      lines.push(current.trimEnd());
      current = tok.trimStart();
    } else {
      current = candidate;
    }
  }
  if (current.trim()) {
    lines.push(current.trimEnd());
  }

  return lines.length > 0 ? lines : [normalized];
}

function getAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = attrs.match(re);
  return m ? (m[1] ?? m[2] ?? '') : null;
}

function getNumericAttr(attrs: string, name: string): number | null {
  const val = getAttr(attrs, name);
  if (val === null) return null;
  const parsed = parseFloat(val);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Enhance LLM-generated inline SVG diagrams:
 * 1. Format math subscripts/superscripts/LaTeX symbols inside <text> and <tspan> elements.
 * 2. Detect single-line callout/label <text> elements that overflow the SVG viewBox right edge,
 *    wrap them into clean multi-line <tspan> rows, and grow enclosing <rect>/viewBox height.
 */
export function enhanceDiagramSvg(svgCode: string): string {
  if (!svgCode || !/<svg[\s>]/i.test(svgCode)) return svgCode;

  let output = svgCode;

  // Inspect viewBox dimensions if available
  const vbMatch = output.match(/viewBox\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
  const vbParts = (vbMatch?.[1] || vbMatch?.[2] || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const hasViewBox = vbParts.length === 4 && vbParts.every((n) => Number.isFinite(n));
  const vbX = hasViewBox ? vbParts[0] : 0;
  const vbY = hasViewBox ? vbParts[1] : 0;
  const vbW = hasViewBox ? vbParts[2] : 680;
  const vbH = hasViewBox ? vbParts[3] : 320;

  let extraBottomNeeded = 0;

  // Collect candidate rects (wide container boxes that might enclose overflowing callout text)
  const rectRegex = /<rect\b([^>]*?)\/?>/gi;
  const rects: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    attrs: string;
    fullMatch: string;
  }> = [];
  let rMatch: RegExpExecArray | null;
  while ((rMatch = rectRegex.exec(output)) !== null) {
    const attrs = rMatch[1];
    const x = getNumericAttr(attrs, 'x') ?? 0;
    const y = getNumericAttr(attrs, 'y') ?? 0;
    const w = getNumericAttr(attrs, 'width') ?? 0;
    const h = getNumericAttr(attrs, 'height') ?? 0;
    if (w > vbW * 0.4 && h >= 28) {
      rects.push({ x, y, w, h, attrs, fullMatch: rMatch[0] });
    }
  }

  const rectExtraMap = new Map<string, number>();

  output = output.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi, (full, attrs: string, inner: string) => {
    // Skip if already formatted with baseline-shift
    if (/baseline-shift\s*=/.test(inner)) {
      return full;
    }

    const hasChildTspan = /<tspan\b/i.test(inner);
    if (hasChildTspan) {
      const updatedInner = inner.replace(
        /(<tspan\b[^>]*>)([\s\S]*?)(<\/tspan>)/gi,
        (_tm, openTag: string, tText: string, closeTag: string) => {
          if (/<[a-z]/i.test(tText)) return _tm;
          return `${openTag}${formatSvgTextContentToTspans(tText)}${closeTag}`;
        }
      );
      return `<text${attrs}>${updatedInner}</text>`;
    }

    const plainText = unescapeXmlEntities(inner).trim();
    if (!plainText) return full;

    const textX = getNumericAttr(attrs, 'x');
    const textY = getNumericAttr(attrs, 'y');
    const styleFontMatch = attrs.match(/font-size\s*:\s*([0-9.]+)/i);
    const fontSize =
      getNumericAttr(attrs, 'font-size') ??
      (styleFontMatch ? parseFloat(styleFontMatch[1]) : null) ??
      13;
    const anchor = (getAttr(attrs, 'text-anchor') || 'start').toLowerCase();

    // Check if single-line text overflows container/viewBox width
    if (hasViewBox && textX !== null && textY !== null) {
      const normalizedFlat = normalizeSvgLatexCommands(plainText);
      const estW = estimateTextWidthUnits(normalizedFlat, fontSize);
      const enclosingRect = rects.find(
        (r) => textX >= r.x && textX <= r.x + r.w && textY >= r.y && textY <= r.y + r.h + 8
      );
      const rightBoundary = enclosingRect ? enclosingRect.x + enclosingRect.w - 14 : vbX + vbW - 14;
      const availableWidth =
        anchor === 'middle'
          ? Math.min(textX - vbX, rightBoundary - textX) * 2 - 12
          : anchor === 'end'
            ? textX - vbX - 14
            : rightBoundary - textX;

      if (availableWidth > fontSize * 6 && estW > availableWidth + 4 && normalizedFlat.length > 22) {
        const lines = wrapLongTextLines(plainText, availableWidth, fontSize);
        if (lines.length > 1) {
          const lineStep = Math.round(fontSize * 1.45);
          const addedHeight = (lines.length - 1) * lineStep;
          if (enclosingRect) {
            const prev = rectExtraMap.get(enclosingRect.fullMatch) || 0;
            rectExtraMap.set(enclosingRect.fullMatch, Math.max(prev, addedHeight));
            const newBottom = enclosingRect.y + enclosingRect.h + Math.max(prev, addedHeight) + 12;
            if (newBottom > vbY + vbH) {
              extraBottomNeeded = Math.max(extraBottomNeeded, newBottom - (vbY + vbH));
            }
          } else {
            const newBottom = textY + addedHeight + fontSize + 12;
            if (newBottom > vbY + vbH) {
              extraBottomNeeded = Math.max(extraBottomNeeded, newBottom - (vbY + vbH));
            }
          }

          const wrappedTspans = lines
            .map((lineText, idx) => {
              const formattedLine = formatSvgTextContentToTspans(lineText);
              if (idx === 0) {
                return `<tspan x="${textX}">${formattedLine}</tspan>`;
              }
              return `<tspan x="${textX}" dy="${lineStep}">${formattedLine}</tspan>`;
            })
            .join('');
          return `<text${attrs}>${wrappedTspans}</text>`;
        }
      }
    }

    return `<text${attrs}>${formatSvgTextContentToTspans(inner)}</text>`;
  });

  // Expand enclosing rects whose text wrapped onto extra lines
  for (const [origRect, extraH] of rectExtraMap.entries()) {
    if (extraH <= 0) continue;
    const hMatch = origRect.match(/height\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    if (hMatch) {
      const oldH = parseFloat(hMatch[1] ?? hMatch[2] ?? '0');
      if (Number.isFinite(oldH)) {
        const updatedRect = origRect.replace(
          /height\s*=\s*(?:"[^"]+"|'[^']+')/i,
          `height="${Math.ceil(oldH + extraH)}"`
        );
        output = output.replace(origRect, updatedRect);
      }
    }
  }

  // Expand SVG viewBox height (and root <svg height="..."> if numeric) if wrapped bottom lines extended past initial viewBox
  if (hasViewBox && extraBottomNeeded > 0 && vbMatch) {
    const newVh = Math.ceil(vbH + extraBottomNeeded);
    output = output.replace(vbMatch[0], `viewBox="${vbX} ${vbY} ${vbW} ${newVh}"`);
    output = output.replace(/^(<svg\b[^>]*?\sheight\s*=\s*)(?:"([0-9.]+)(px)?"|'([0-9.]+)(px)?')/i, (_m, prefix: string, h1?: string, u1?: string, h2?: string, u2?: string) => {
      const oldSvgH = parseFloat(h1 ?? h2 ?? '0');
      if (!Number.isFinite(oldSvgH) || oldSvgH <= 0) return _m;
      const unit = u1 || u2 || '';
      return `${prefix}"${Math.ceil(oldSvgH + extraBottomNeeded)}${unit}"`;
    });
  }

  return output;
}
