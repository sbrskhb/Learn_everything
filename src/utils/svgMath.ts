/**
 * Pure utilities for rendering mathematical expressions, subscripts, superscripts,
 * and LaTeX symbols cleanly inside inline SVG <text> elements, while preventing
 * single-line callout text overflow past the SVG viewBox right edge.
 */

import { expandCompactStemSubscripts } from './markdownMath';

const LATEX_SYMBOL_MAP: Array<[RegExp, string]> = [
  [/\\Omega(?![A-Za-z])/g, 'Ω'],
  [/\\omega(?![A-Za-z])/g, 'ω'],
  [/\\infty(?![A-Za-z])/g, '∞'],
  [/\\Delta(?![A-Za-z])/g, 'Δ'],
  [/\\delta(?![A-Za-z])/g, 'δ'],
  [/\\Gamma(?![A-Za-z])/g, 'Γ'],
  [/\\gamma(?![A-Za-z])/g, 'γ'],
  [/\\Lambda(?![A-Za-z])/g, 'Λ'],
  [/\\lambda(?![A-Za-z])/g, 'λ'],
  [/\\Sigma(?![A-Za-z])/g, 'Σ'],
  [/\\sigma(?![A-Za-z])/g, 'σ'],
  [/\\Theta(?![A-Za-z])/g, 'Θ'],
  [/\\theta(?![A-Za-z])/g, 'θ'],
  [/\\vartheta(?![A-Za-z])/g, 'ϑ'],
  [/\\Phi(?![A-Za-z])/g, 'Φ'],
  [/\\phi(?![A-Za-z])/g, 'φ'],
  [/\\varphi(?![A-Za-z])/g, 'φ'],
  [/\\Psi(?![A-Za-z])/g, 'Ψ'],
  [/\\psi(?![A-Za-z])/g, 'ψ'],
  [/\\Pi(?![A-Za-z])/g, 'Π'],
  [/\\pi(?![A-Za-z])/g, 'π'],
  [/\\Xi(?![A-Za-z])/g, 'Ξ'],
  [/\\xi(?![A-Za-z])/g, 'ξ'],
  [/\\mu(?![A-Za-z])/g, 'μ'],
  [/\\tau(?![A-Za-z])/g, 'τ'],
  [/\\alpha(?![A-Za-z])/g, 'α'],
  [/\\beta(?![A-Za-z])/g, 'β'],
  [/\\epsilon(?![A-Za-z])/g, 'ϵ'],
  [/\\varepsilon(?![A-Za-z])/g, 'ε'],
  [/\\zeta(?![A-Za-z])/g, 'ζ'],
  [/\\eta(?![A-Za-z])/g, 'η'],
  [/\\kappa(?![A-Za-z])/g, 'κ'],
  [/\\nu(?![A-Za-z])/g, 'ν'],
  [/\\rho(?![A-Za-z])/g, 'ρ'],
  [/\\chi(?![A-Za-z])/g, 'χ'],
  [/\\partial(?![A-Za-z])/g, '∂'],
  [/\\nabla(?![A-Za-z])/g, '∇'],
  [/\\int(?![A-Za-z])/g, '∫'],
  [/\\oint(?![A-Za-z])/g, '∮'],
  [/\\sum(?![A-Za-z])/g, '∑'],
  [/\\prod(?![A-Za-z])/g, '∏'],
  [/\\neq(?![A-Za-z])/g, '≠'],
  [/\\ne(?![A-Za-z])/g, '≠'],
  [/\\leq(?![A-Za-z])/g, '≤'],
  [/\\le(?![A-Za-z])/g, '≤'],
  [/\\geq(?![A-Za-z])/g, '≥'],
  [/\\ge(?![A-Za-z])/g, '≥'],
  [/\\ll(?![A-Za-z])/g, '≪'],
  [/\\gg(?![A-Za-z])/g, '≫'],
  [/\\approx(?![A-Za-z])/g, '≈'],
  [/\\equiv(?![A-Za-z])/g, '≡'],
  [/\\propto(?![A-Za-z])/g, '∝'],
  [/\\times(?![A-Za-z])/g, '×'],
  [/\\div(?![A-Za-z])/g, '÷'],
  [/\\cdot(?![A-Za-z])/g, '·'],
  [/\\pm(?![A-Za-z])/g, '±'],
  [/\\mp(?![A-Za-z])/g, '∓'],
  [/\\perp(?![A-Za-z])/g, '⊥'],
  [/\\parallel(?![A-Za-z])/g, '∥'],
  [/\\angle(?![A-Za-z])/g, '∠'],
  [/\\triangle(?![A-Za-z])/g, '△'],
  [/\\in(?![A-Za-z])/g, '∈'],
  [/\\notin(?![A-Za-z])/g, '∉'],
  [/\\subset(?![A-Za-z])/g, '⊂'],
  [/\\subseteq(?![A-Za-z])/g, '⊆'],
  [/\\cup(?![A-Za-z])/g, '∪'],
  [/\\cap(?![A-Za-z])/g, '∩'],
  [/\\forall(?![A-Za-z])/g, '∀'],
  [/\\exists(?![A-Za-z])/g, '∃'],
  [/\\Rightarrow(?![A-Za-z])/g, '⇒'],
  [/\\implies(?![A-Za-z])/g, '⇒'],
  [/\\Leftarrow(?![A-Za-z])/g, '⇐'],
  [/\\Leftrightarrow(?![A-Za-z])/g, '⇔'],
  [/\\iff(?![A-Za-z])/g, '⇔'],
  [/\\rightleftharpoons(?![A-Za-z])/g, '⇌'],
  [/\\rightarrow(?![A-Za-z])/g, '→'],
  [/\\to(?![A-Za-z])/g, '→'],
  [/\\leftarrow(?![A-Za-z])/g, '←'],
  [/\\degree(?![A-Za-z])/g, '°'],
  [/\\circ(?![A-Za-z])/g, '°'],
  [/\\left(?![A-Za-z])\s*/g, ''],
  [/\\right(?![A-Za-z])\s*/g, ''],
  [/\\displaystyle(?![A-Za-z])\s*/g, ''],
  [/\\(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|cot|sec|csc|ln|log|lg|lim|exp|max|min|sup|inf)(?![A-Za-z])/g, '$1'],
  [/\\,/g, ' '],
  [/\\;/g, ' '],
  [/\\quad(?![A-Za-z])/g, '  '],
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
    /(^|[^A-Za-z0-9α-ωΑ-Ω_])([dΔδ][A-Za-zα-ωΑ-Ω]|[A-Za-zα-ωΑ-Ω]+['′]*|\d+(?:\.\d+)?|[)\]])((?:(?:_\{[^{}]+\}|_[A-Za-z0-9α-ωΑ-Ω+\-'′]+|\^\{[^{}]+\}|\^[A-Za-z0-9α-ωΑ-Ω+\-'′°∞]+))+)/g;

  let result = '';
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(normalized)) !== null) {
    const start = match.index;
    if (start > lastIdx) {
      result += escapeXmlText(normalized.slice(lastIdx, start));
    }

    const pre = match[1];
    if (pre) {
      result += escapeXmlText(pre);
    }
    const base = match[2];
    const scriptsRaw = match[3];

    // Style single-letter or differential variables italic, keep multi-uppercase chemical/operator tokens upright
    if (/^(?:[dΔδ][A-Za-zα-ωΑ-Ω]|[A-Za-zα-ωΑ-Ω]['′]*)$/.test(base)) {
      result += `<tspan font-style="italic">${escapeXmlText(base)}</tspan>`;
    } else {
      result += escapeXmlText(base);
    }

    const scriptPartRegex = /([_^])(?:\{([^{}]+)\}|([A-Za-z0-9α-ωΑ-Ω+\-'′°∞]+))/g;
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
  if (/data-diagram-engine\s*=/i.test(svgCode)) return svgCode;

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
    if (w > vbW * 0.2 && h >= 26) {
      rects.push({ x, y, w, h, attrs, fullMatch: rMatch[0] });
    }
  }

  const rectExtraMap = new Map<string, number>();
  const rectExpandWidthMap = new Map<string, { x: number; w: number }>();

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
      const isBold =
        /font-weight\s*=\s*["']?(?:bold|[6-9]00)/i.test(attrs) ||
        /font-weight\s*:\s*(?:bold|[6-9]00)/i.test(attrs);
      const estW = estimateTextWidthUnits(normalizedFlat, fontSize) * (isBold ? 1.08 : 1);
      const enclosingRect = rects.find(
        (r) => textX >= r.x && textX <= r.x + r.w && textY >= r.y && textY <= r.y + r.h + 8
      );
      const leftBoundary = enclosingRect ? enclosingRect.x + 14 : vbX + 14;
      const rightBoundary = enclosingRect ? enclosingRect.x + enclosingRect.w - 14 : vbX + vbW - 14;
      const availableWidth =
        anchor === 'middle'
          ? Math.min(textX - leftBoundary, rightBoundary - textX) * 2
          : anchor === 'end'
            ? textX - leftBoundary
            : rightBoundary - textX;

      if (
        availableWidth > fontSize * 5 &&
        estW > availableWidth + 2 &&
        (enclosingRect ? normalizedFlat.length > 12 : normalizedFlat.length > 22)
      ) {
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
        } else if (enclosingRect && estW > availableWidth + 2) {
          // Single-line formula/label that couldn't wrap cleanly: widen enclosing rect symmetrically
          const neededW = Math.min(vbW - 16, Math.ceil(estW + 28));
          if (neededW > enclosingRect.w) {
            const centerX = enclosingRect.x + enclosingRect.w / 2;
            const newX = Math.max(vbX + 8, Math.min(vbX + vbW - 8 - neededW, Math.round(centerX - neededW / 2)));
            rectExpandWidthMap.set(enclosingRect.fullMatch, { x: newX, w: neededW });
          }
        }
      } else if (enclosingRect && estW > enclosingRect.w - 20) {
        const neededW = Math.min(vbW - 16, Math.ceil(estW + 28));
        if (neededW > enclosingRect.w) {
          const centerX = enclosingRect.x + enclosingRect.w / 2;
          const newX = Math.max(vbX + 8, Math.min(vbX + vbW - 8 - neededW, Math.round(centerX - neededW / 2)));
          rectExpandWidthMap.set(enclosingRect.fullMatch, { x: newX, w: neededW });
        }
      }
    }

    return `<text${attrs}>${formatSvgTextContentToTspans(inner)}</text>`;
  });

  // Expand enclosing rects whose text wrapped onto extra lines or overflowed horizontally
  const allAffectedRects = new Set<string>([...rectExtraMap.keys(), ...rectExpandWidthMap.keys()]);
  for (const origRect of allAffectedRects) {
    const extraH = rectExtraMap.get(origRect) || 0;
    const expandW = rectExpandWidthMap.get(origRect);
    let updatedRect = origRect;
    if (extraH > 0) {
      const hMatch = updatedRect.match(/height\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      if (hMatch) {
        const oldH = parseFloat(hMatch[1] ?? hMatch[2] ?? '0');
        if (Number.isFinite(oldH)) {
          updatedRect = updatedRect.replace(
            /height\s*=\s*(?:"[^"]+"|'[^']+')/i,
            `height="${Math.ceil(oldH + extraH)}"`
          );
        }
      }
    }
    if (expandW) {
      updatedRect = updatedRect
        .replace(/\bx\s*=\s*(?:"[^"]+"|'[^']+')/i, `x="${expandW.x}"`)
        .replace(/\bwidth\s*=\s*(?:"[^"]+"|'[^']+')/i, `width="${expandW.w}"`);
    }
    if (updatedRect !== origRect) {
      output = output.replace(origRect, updatedRect);
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
