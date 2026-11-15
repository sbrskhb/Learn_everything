import katex from 'katex';
import type { Course, DailyLessonContent, DailyPlanSlot } from '../types';
import { resolveLearnerProfile } from './learnerProfile';
import { ensureStableSectionId } from './learningLogic';
import {
  detectUnresolvedImageRefs,
  parseImportedLessonContent,
  repairUnescapedLatexInJsonString,
  resolveLessonAssetReferences,
  stripAiCitationArtifacts,
  tryParseJsonWithLatexRepair,
} from './coursewareParser';
import {
  normalizeBareMathForMarkdown,
  normalizeMathUnicodeToLatex,
  renderInlineMathWithLatex,
  renderMarkdownWithLatex,
  resolveVisualRefByToken,
  type VisualAssetRef,
} from './markdownMath';

export type CoursewareIssueCategory =
  | 'json_syntax_error'
  | 'latex_error'
  | 'unclosed_math'
  | 'missing_diagram'
  | 'missing_anchor'
  | 'svg_error'
  | 'duplicate_id'
  | 'placeholder_error'
  | 'unresolved_image';

export interface CoursewareDiagnosticIssue {
  id: string;
  severity: 'error' | 'warning';
  category: CoursewareIssueCategory;
  categoryLabel: string;
  locationLabel: string;
  rawSnippet: string;
  detail: string;
  fixInstruction: string;
}

export interface CoursewareDiagnosticReport {
  hasErrors: boolean;
  errorCount: number;
  warningCount: number;
  issues: CoursewareDiagnosticIssue[];
  repairPrompt: string;
  summaryText: string;
}

function truncateSnippet(text: string, maxLen = 140): string {
  const oneLine = (text || '').replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen)}…`;
}

function findLineNumber(fullText: string, charIndex: number): number {
  if (!fullText || charIndex <= 0) return 1;
  return fullText.slice(0, charIndex).split('\n').length;
}

function stripNonProseRegionsForLeakScan(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/\$\$[\s\S]+?\$\$/g, ' ')
    .replace(/\\\[[\s\S]+?\\\]/g, ' ')
    .replace(/(?<!\\)\$([^\n$]+?)(?<!\\)\$/g, ' ')
    .replace(/\\\([\s\S]+?\\\)/g, ' ');
}

function stripSafeHtmlContainers(html: string): string {
  // Remove annotations, katex blocks (unless katex-error which we check separately), code/pre/svg
  return html
    .replace(/<annotation[\s\S]*?<\/annotation>/gi, ' ')
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<code[\s\S]*?<\/code>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function auditFieldMath(params: {
  text: string;
  fieldLabel: string;
  isBlockMarkdown: boolean;
  visuals: VisualAssetRef[];
  issues: CoursewareDiagnosticIssue[];
}) {
  const { text, fieldLabel, isBlockMarkdown, visuals, issues } = params;
  if (!text || !text.trim()) return;

  const cleaned = stripAiCitationArtifacts(text);

  // 1. Check unbalanced $$ or per-line unescaped $ delimiters (outside code blocks & inline code)
  const withoutCode = cleaned
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));

  const displayMatches = withoutCode.match(/\$\$/g) || [];
  if (displayMatches.length % 2 !== 0) {
    const lastIdx = withoutCode.lastIndexOf('$$');
    const lineNo = findLineNumber(withoutCode, lastIdx);
    const lineText = withoutCode.split('\n')[lineNo - 1] || '';
    issues.push({
      id: `unclosed-display-${issues.length + 1}`,
      severity: 'error',
      category: 'unclosed_math',
      categoryLabel: '块级公式定界符未闭合',
      locationLabel: isBlockMarkdown ? `${fieldLabel}（第 ${lineNo} 行附近）` : fieldLabel,
      rawSnippet: truncateSnippet(lineText || cleaned),
      detail: `检测到奇数个 "$$" 定界符（共 ${displayMatches.length} 个），会导致后续公式与正文串行或渲染失败。`,
      fixInstruction: '检查并补齐缺失的 "$$" 成对定界符。',
    });
  } else {
    // Strip matched $$...$$ blocks and \[...\] blocks, then inspect per-line unescaped single $
    const withoutDisplay = withoutCode
      .replace(/\$\$[\s\S]+?\$\$/g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\\\[[\s\S]+?\\\]/g, (m) => m.replace(/[^\n]/g, ' '));

    const lines = withoutDisplay.split('\n');
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const singleDollars = line.match(/(?<!\\)\$/g) || [];
      if (singleDollars.length % 2 !== 0) {
        issues.push({
          id: `unclosed-inline-${issues.length + 1}`,
          severity: 'error',
          category: 'unclosed_math',
          categoryLabel: '行内公式 $ 未成对闭合',
          locationLabel: isBlockMarkdown ? `${fieldLabel}（第 ${li + 1} 行）` : fieldLabel,
          rawSnippet: truncateSnippet(line),
          detail: `该行检测到奇数个 "$"（共 ${singleDollars.length} 个），缺少闭合 "$" 或误把两个公式拆开。`,
          fixInstruction: '为该行公式补齐缺失的 "$"，确保所有行内公式均由成对 "$...$" 完整包裹。',
        });
      }
    }
  }

  // 2. Run actual preprocessing pipeline and strictly test every math segment with KaTeX throwOnError: true
  const normalized = normalizeBareMathForMarkdown(cleaned);
  let scanWork = normalized.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '));

  const validateTex = (rawBody: string, displayMode: boolean, offset: number) => {
    const tex = normalizeMathUnicodeToLatex((rawBody || '').trim());
    if (!tex) return;
    try {
      katex.renderToString(tex, {
        displayMode,
        throwOnError: true,
        strict: false,
      });
    } catch (err: any) {
      const lineNo = findLineNumber(scanWork, offset);
      const rawErr = String(err?.message || err || 'KaTeX syntax error')
        .replace(/^KaTeX parse error:\s*/i, '')
        .trim();
      issues.push({
        id: `katex-err-${issues.length + 1}`,
        severity: 'error',
        category: 'latex_error',
        categoryLabel: 'LaTeX 公式解析失败',
        locationLabel: isBlockMarkdown ? `${fieldLabel}（第 ${lineNo} 行附近）` : fieldLabel,
        rawSnippet: truncateSnippet(displayMode ? `$$${rawBody.trim()}$$` : `$${rawBody.trim()}$`),
        detail: `KaTeX 报错：${rawErr}`,
        fixInstruction:
          '修复该公式的 LaTeX 语法错误（检查花括号是否配对、命令拼写是否正确、\\text{...} 内不要出现裸下划线 "_" 等）。',
      });
    }
  };

  scanWork = scanWork.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (full, g1, g2, offset: number) => {
    validateTex(g1 || g2 || '', true, offset);
    return full.replace(/[^\n]/g, ' ');
  });

  scanWork.replace(
    /(?<!\\)\$([^\n$]+?)(?<!\\)\$|\\\(([\s\S]+?)\\\)/g,
    (full, g1, g2, offset: number) => {
      validateTex(g1 || g2 || '', false, offset);
      return full;
    }
  );

  // 3. Detect leaked raw LaTeX commands outside math delimiters (e.g. broken macro not enclosed in $...$)
  const renderedHtml = isBlockMarkdown
    ? renderMarkdownWithLatex(cleaned, visuals)
    : renderInlineMathWithLatex(cleaned, visuals);

  const visibleStripped = stripSafeHtmlContainers(renderedHtml);
  const leakedLatexMatch = visibleStripped.match(
    /\\(?:frac|sqrt|dfrac|tfrac|text|mathrm|operatorname|mathbf|left|right|Delta|Sigma|Omega|alpha|beta|gamma|theta|lambda|omega|cdot|times|approx|equiv|neq|leq|geq|nabla|partial|sum|int)\b/
  );
  if (leakedLatexMatch) {
    // Find approximate source snippet in cleaned text outside delimiters
    const bareText = stripNonProseRegionsForLeakScan(cleaned);
    const idx = bareText.indexOf(leakedLatexMatch[0]);
    const snippetStart = Math.max(0, (idx === -1 ? 0 : idx) - 24);
    const snippet = bareText.slice(snippetStart, snippetStart + 120);
    issues.push({
      id: `leaked-latex-${issues.length + 1}`,
      severity: 'error',
      category: 'unclosed_math',
      categoryLabel: '裸露未渲染的 LaTeX 命令',
      locationLabel: fieldLabel,
      rawSnippet: truncateSnippet(snippet || leakedLatexMatch[0]),
      detail: `正文可见文本中残留了未进入公式定界符的 LaTeX 命令 "${leakedLatexMatch[0]}"（常见原因：漏写 "$...$" 或花括号嵌套损坏）。`,
      fixInstruction: `确保包含 "${leakedLatexMatch[0]}" 的完整数学表达式被成对 "$...$" 或 "$$...$$" 包裹，并检查括号匹配。`,
    });
  }
}

function collectMissingDiagRefsInText(params: {
  text: string;
  fieldLabel: string;
  visuals: VisualAssetRef[];
  reportedMissingDiagIds: Set<string>;
  issues: CoursewareDiagnosticIssue[];
}) {
  const { text, fieldLabel, visuals, reportedMissingDiagIds, issues } = params;
  if (!text) return;

  // Strip fenced code blocks and SVG code so we only check prose/prompts/questions/captions
  const scanText = text.replace(/```[\s\S]*?```/g, ' ');
  const availableIds = visuals.map((v) => v.id).join('、') || '（当前无可用 SVG 图示）';

  // 1. Explicit anchors {{diagram:X}} / {{diag:X}} / [[diagram:X]] / [[diag:X]]
  const anchorRe = /(?:\{\{|\[{2})\s*(?:diagram|diag)\s*:\s*([^}\]]+?)\s*(?:\}\}|\]{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(scanText)) !== null) {
    const token = m[1].trim();
    const resolved = resolveVisualRefByToken(token, visuals);
    if (!resolved) {
      const dedupKey = `anchor:${token.toLowerCase()}`;
      if (reportedMissingDiagIds.has(dedupKey)) continue;
      reportedMissingDiagIds.add(dedupKey);
      issues.push({
        id: `missing-diag-anchor-${issues.length + 1}`,
        severity: 'error',
        category: 'missing_diagram',
        categoryLabel: '内联图示锚点缺失对应 SVG',
        locationLabel: fieldLabel,
        rawSnippet: m[0],
        detail: `引用了图示锚点 "${token}"，但 diagrams 数组中不存在匹配该编号的 SVG 图示（当前已有编号：${availableIds}）。`,
        fixInstruction: `请在 "diagrams" 数组中补全 id 为 "${token}" 的 SVG 图示对象，或将 "${m[0]}" 修改为已有图示的正确编号。`,
      });
    }
  }

  // 2. Inline prose/backtick citations: `diag-4c`, 图 diag-3b, diag_4c, etc.
  const refRe = /\b(diag(?:ram)?[-_][A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*)\b/gi;
  while ((m = refRe.exec(scanText)) !== null) {
    const rawId = m[1].trim();
    const resolved = resolveVisualRefByToken(rawId, visuals);
    if (!resolved) {
      const dedupKey = `ref:${rawId.toLowerCase()}`;
      if (reportedMissingDiagIds.has(dedupKey)) continue;
      reportedMissingDiagIds.add(dedupKey);
      const lineStart = Math.max(0, m.index - 24);
      const contextSnippet = scanText.slice(lineStart, m.index + rawId.length + 32);
      issues.push({
        id: `missing-diag-ref-${issues.length + 1}`,
        severity: 'error',
        category: 'missing_diagram',
        categoryLabel: '图号引用无法匹配任何图示',
        locationLabel: fieldLabel,
        rawSnippet: truncateSnippet(contextSnippet),
        detail: `提到了图示编号 "${rawId}"，但当前课件 diagrams 中未找到对应的图示定义（已有编号：${availableIds}）。`,
        fixInstruction: `请补充 id 为 "${rawId}" 的 SVG 图示（需包含在 diagrams 数组中），或将其修正为已有图示编号之一（${availableIds}）。同时勿用反引号包裹图号（直接写 图 ${rawId}）。`,
      });
    }
  }
}

export interface RepairPromptExtraContext {
  salvagedFields?: string[];
  isTailTruncation?: boolean;
  errorOffset?: number;
}

export function buildCoursewareRepairPrompt(
  lessonTitle: string,
  issues: CoursewareDiagnosticIssue[],
  availableDiagramIds: string[],
  extraContext?: RepairPromptExtraContext
): string {
  if (!issues || issues.length === 0) return '';

  const isFatalJsonError = issues.some((i) => i.category === 'json_syntax_error');
  const hasTextOrMathIssue = issues.some(
    (i) =>
      i.category === 'latex_error' ||
      i.category === 'unclosed_math' ||
      i.category === 'missing_anchor' ||
      i.category === 'placeholder_error' ||
      i.category === 'duplicate_id'
  );
  const hasDiagramIssue = issues.some(
    (i) => i.category === 'missing_diagram' || i.category === 'svg_error'
  );

  const issueLines = issues.map((iss, idx) => {
    return [
      `${idx + 1}. **【${iss.categoryLabel}】位置：${iss.locationLabel}**`,
      `   - 问题片段：\`${iss.rawSnippet}\``,
      `   - 原因：${iss.detail}`,
      `   - 修复要求：${iss.fixInstruction}`,
    ].join('\n');
  });

  const diagListText =
    availableDiagramIds.length > 0 ? availableDiagramIds.join('、') : '（当前尚未生成任何 SVG 图示）';

  if (isFatalJsonError) {
    const salvaged = extraContext?.salvagedFields || [];
    if (salvaged.length > 0) {
      const hasMarkdownSalvaged = salvaged.includes('markdownBody');
      return `你前面生成的课件《${lessonTitle || '本节课件'}》在局部位置发生 JSON 语法损坏或长度截断，但系统已成功抢救以下完整字段（**切勿重复生成它们**）：
- 已完整抢救保留的字段：\`${salvaged.join('`、`')}\`

### 唯一需要处理的故障点
${issueLines.join('\n\n')}

### 请仅输出增量修复/续写 JSON 补丁（无需重新生成整节课件！）
${
  hasMarkdownSalvaged
    ? '- `markdownBody` 正文已完整保留：若故障在 `diagrams`、`exercises`、`heuristicQuestions` 或 `reverseChecks` 中，只需输出被截断/损坏的那部分字段 JSON；若仅正文内部某一行有错，使用 `textReplacements` 局部替换即可。'
    : '- 请仅补齐上述缺失或被截断字段的合法 JSON。'
}
- 注意 JSON 字符串内 LaTeX 反斜杠双写 \`\\\\\`，双引号写 \`\\"\`，禁止在字符串值中出现未转义换行。
\`\`\`json
{
  "textReplacements": [
    { "find": "若有需要替换的出错原文", "replace": "修正后的内容" }
  ],
  "exercisesToUpsert": [],
  "diagramsToUpsert": []
}
\`\`\``;
    }

    return `你前面生成的课件《${lessonTitle || '本节课件'}》存在 JSON 语法损坏或输出截断：

${issueLines.join('\n\n')}

请仅对照上述精准报错位置修复 JSON 语法/转义/截断问题（注意 JSON 字符串内的 LaTeX 反斜杠双写为 \`\\\\\`，内嵌双引号转义为 \`\\"\`），输出完整合法的 \`\`\`json ... \`\`\` 代码块。`;
  }

  const patchSchemaParts: string[] = [];
  if (hasTextOrMathIssue) {
    patchSchemaParts.push(`  "textReplacements": [
    {
      "find": "原报错片段中的精确原样文本",
      "replace": "修复后的正确 LaTeX 公式或文本"
    }
  ]`);
  }
  if (hasDiagramIssue) {
    patchSchemaParts.push(`  "diagramsToUpsert": [
    {
      "id": "缺失或需修复的图示 ID（如 diag-3b）",
      "title": "图示标题",
      "caption": "详细教学图注（公式用 $...$ 包裹）",
      "svgCode": "<svg viewBox=\\"0 0 680 320\\" xmlns=\\"http://www.w3.org/2000/svg\\">...</svg>"
    }
  ]`);
  }
  if (patchSchemaParts.length === 0) {
    patchSchemaParts.push(`  "textReplacements": [
    {
      "find": "原报错片段",
      "replace": "修复后内容"
    }
  ]`);
  }

  return `你前面生成的课件《${lessonTitle || '本节课件'}》仅有以下 ${issues.length} 处局部渲染问题。
**请不要重新生成整节完整课件！只需输出包含修复项的精简增量 JSON 补丁**，前端会自动将补丁合并到已有课件中：

### 待修复局部问题（共 ${issues.length} 处，已有图示 ID：${diagListText}）
${issueLines.join('\n\n')}

### 请仅输出以下精简增量补丁 JSON（无需输出其余已正常内容）
\`\`\`json
{
${patchSchemaParts.join(',\n')}
}
\`\`\`
- 规范提示：JSON 字符串内反斜杠须双写为 \`\\\\\`（如 \`\\\\frac\`、\`\\\\text\`）；\`\\text{...}\` 内禁止裸下划线（应写 \`20\\,\\text{nA}\` 而非 \`\\text{n_A}\`）；图号直接写 \`(图 diag-xx)\` 勿加反引号。`;
}

/**
 * Audit a structured DailyLessonContent object for KaTeX/LaTeX errors, unclosed math delimiters,
 * broken diag references/anchors, malformed SVG elements, and unresolved local images.
 */
export function auditCoursewareRendering(
  lesson: DailyLessonContent,
  existingAssets: Record<string, string> = {},
  options?: { stage?: 'stage1' | 'complete' }
): CoursewareDiagnosticReport {
  const issues: CoursewareDiagnosticIssue[] = [];
  const resolved = resolveLessonAssetReferences(lesson, existingAssets);
  const isStage1 =
    options?.stage === 'stage1' || resolved.generationStage === 'stage1_content';

  // Build visuals matching LessonView
  const visuals: VisualAssetRef[] = (resolved.diagrams || []).map((d, idx) => ({
    id: (d.id || `diag-${idx + 1}`).trim(),
    title: stripAiCitationArtifacts(d.title || `图 ${idx + 1}`),
    stageLabel: d.stageLabel ? stripAiCitationArtifacts(d.stageLabel) : undefined,
    caption: d.caption ? stripAiCitationArtifacts(d.caption) : undefined,
    kind: 'svg',
    svgCode: d.svgCode,
    index: idx + 1,
  }));

  const rawBody = resolved.markdownBody || '';
  const imgRegex = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let imgMatch: RegExpExecArray | null;
  let imgIdx = 0;
  while ((imgMatch = imgRegex.exec(rawBody)) !== null) {
    imgIdx++;
    visuals.push({
      id: `img-${imgIdx}`,
      title: imgMatch[1] || `插图 ${imgIdx}`,
      kind: 'image',
      imageUrl: imgMatch[2],
      fileName: imgMatch[2].split('/').pop(),
      index: (resolved.diagrams?.length || 0) + imgIdx,
    });
  }

  // 1. Audit SVG diagrams structure (Stage 1 allows diagram specs without svgCode)
  (resolved.diagrams || []).forEach((d, idx) => {
    const diagId = (d.id || `diag-${idx + 1}`).trim();
    const code = (d.svgCode || '').trim();
    if (isStage1 && !code) {
      if (!d.topologySpec?.trim() && !d.caption?.trim()) {
        issues.push({
          id: `spec-empty-${issues.length + 1}`,
          severity: 'warning',
          category: 'svg_error',
          categoryLabel: '阶段一图示规格缺少绘图参数描述',
          locationLabel: `diagrams[${idx}] (${diagId})`,
          rawSnippet: truncateSnippet(d.title || diagId),
          detail: `阶段一图示 ${diagId} 尚未包含 topologySpec 或 caption 绘图规格，阶段二可能缺少足够绘图依据。`,
          fixInstruction: `为 ${diagId} 补充 topologySpec（节点连接、元件参数、物理量与参考方向说明）。`,
        });
      }
      return;
    }
    if (!code || !/<svg\b/i.test(code) || !/<\/svg>/i.test(code)) {
      issues.push({
        id: `svg-broken-${issues.length + 1}`,
        severity: 'error',
        category: 'svg_error',
        categoryLabel: 'SVG 图示代码不完整',
        locationLabel: `diagrams[${idx}] (${diagId})`,
        rawSnippet: truncateSnippet(code || '(空 SVG)'),
        detail: `图示 ${diagId} 缺少完整的 <svg ...>...</svg> 闭合标签，无法正确绘制原理图。`,
        fixInstruction: `补全 ${diagId} 的完整合法 <svg viewBox="0 0 680 320" xmlns="http://www.w3.org/2000/svg">...</svg> 矢量代码。`,
      });
    } else if (!/viewBox\s*=/i.test(code)) {
      issues.push({
        id: `svg-viewbox-${issues.length + 1}`,
        severity: 'warning',
        category: 'svg_error',
        categoryLabel: 'SVG 缺少 viewBox 自适应属性',
        locationLabel: `diagrams[${idx}] (${diagId})`,
        rawSnippet: truncateSnippet(code.slice(0, 120)),
        detail: `图示 ${diagId} 未声明 viewBox 属性，在悬浮小窗缩放或窄屏下可能被裁切。`,
        fixInstruction: `为 ${diagId} 的 <svg> 根标签补充合适的 viewBox="0 0 680 320" 属性。`,
      });
    }
  });

  // 2. Audit math/LaTeX across all text fields
  auditFieldMath({
    text: resolved.title,
    fieldLabel: '课件标题 (title)',
    isBlockMarkdown: false,
    visuals,
    issues,
  });
  auditFieldMath({
    text: resolved.summary,
    fieldLabel: '本节导读摘要 (summary)',
    isBlockMarkdown: true,
    visuals,
    issues,
  });
  (resolved.keyPoints || []).forEach((kp, idx) => {
    auditFieldMath({
      text: kp,
      fieldLabel: `本节核心知识点 #${idx + 1}`,
      isBlockMarkdown: false,
      visuals,
      issues,
    });
  });

  auditFieldMath({
    text: rawBody,
    fieldLabel: '课件正文 (markdownBody)',
    isBlockMarkdown: true,
    visuals,
    issues,
  });

  (resolved.diagrams || []).forEach((d, idx) => {
    const label = d.id || `diag-${idx + 1}`;
    auditFieldMath({
      text: d.title,
      fieldLabel: `图示 ${label} 标题`,
      isBlockMarkdown: false,
      visuals,
      issues,
    });
    if (d.caption) {
      auditFieldMath({
        text: d.caption,
        fieldLabel: `图示 ${label} 说明 (caption)`,
        isBlockMarkdown: true,
        visuals,
        issues,
      });
    }
  });

  (resolved.heuristicQuestions || []).forEach((hq, idx) => {
    const label = `先思考后讲解 ${hq.id || `hq-${idx + 1}`}`;
    auditFieldMath({ text: hq.context, fieldLabel: `${label} · 情境`, isBlockMarkdown: false, visuals, issues });
    auditFieldMath({ text: hq.question, fieldLabel: `${label} · 提问`, isBlockMarkdown: true, visuals, issues });
    if (hq.hint) auditFieldMath({ text: hq.hint, fieldLabel: `${label} · 提示`, isBlockMarkdown: true, visuals, issues });
    if (hq.approach) auditFieldMath({ text: hq.approach, fieldLabel: `${label} · 切入思路`, isBlockMarkdown: true, visuals, issues });
    if (hq.answerReveal) auditFieldMath({ text: hq.answerReveal, fieldLabel: `${label} · 完整解释`, isBlockMarkdown: true, visuals, issues });
  });

  (resolved.exercises || []).forEach((ex, idx) => {
    const label = `练习题 #${idx + 1} (${ex.id})`;
    auditFieldMath({ text: ex.question, fieldLabel: `${label} · 题干`, isBlockMarkdown: true, visuals, issues });
    (ex.options || []).forEach((opt, oIdx) => {
      auditFieldMath({ text: opt, fieldLabel: `${label} · 选项 ${oIdx + 1}`, isBlockMarkdown: true, visuals, issues });
    });
    auditFieldMath({ text: ex.answer, fieldLabel: `${label} · 标准答案`, isBlockMarkdown: false, visuals, issues });
    if (ex.hint) auditFieldMath({ text: ex.hint, fieldLabel: `${label} · 提示`, isBlockMarkdown: true, visuals, issues });
    if (ex.explanation) auditFieldMath({ text: ex.explanation, fieldLabel: `${label} · 解析`, isBlockMarkdown: true, visuals, issues });
    if (ex.wrongOptionsAnalysis) {
      auditFieldMath({ text: ex.wrongOptionsAnalysis, fieldLabel: `${label} · 错因分析`, isBlockMarkdown: true, visuals, issues });
    }
    if (ex.remediation) {
      auditFieldMath({ text: ex.remediation, fieldLabel: `${label} · 针对性补救`, isBlockMarkdown: true, visuals, issues });
    }
    if (typeof ex.variantCheck === 'string' && ex.variantCheck.trim()) {
      auditFieldMath({ text: ex.variantCheck, fieldLabel: `${label} · 变式检验`, isBlockMarkdown: true, visuals, issues });
    } else if (ex.variantCheck && typeof ex.variantCheck === 'object') {
      auditFieldMath({ text: ex.variantCheck.question, fieldLabel: `${label} · 变式检验题干`, isBlockMarkdown: true, visuals, issues });
      (ex.variantCheck.options || []).forEach((vOpt, vIdx) => {
        auditFieldMath({ text: vOpt, fieldLabel: `${label} · 变式选项 ${vIdx + 1}`, isBlockMarkdown: true, visuals, issues });
      });
      auditFieldMath({ text: ex.variantCheck.answer, fieldLabel: `${label} · 变式答案`, isBlockMarkdown: false, visuals, issues });
      if (ex.variantCheck.explanation) {
        auditFieldMath({ text: ex.variantCheck.explanation, fieldLabel: `${label} · 变式解析`, isBlockMarkdown: true, visuals, issues });
      }
    }
  });

  if (resolved.teachingContext?.prerequisiteCheck) {
    auditFieldMath({
      text: resolved.teachingContext.prerequisiteCheck,
      fieldLabel: '先修前提诊断 (prerequisiteCheck)',
      isBlockMarkdown: true,
      visuals,
      issues,
    });
  }

  (resolved.reverseChecks || []).forEach((rc, idx) => {
    const label = `反向解释检验 #${idx + 1}`;
    auditFieldMath({ text: rc.topic, fieldLabel: `${label} · 主题`, isBlockMarkdown: false, visuals, issues });
    auditFieldMath({ text: rc.prompt, fieldLabel: `${label} · 题目`, isBlockMarkdown: true, visuals, issues });
    (rc.keyPoints || []).forEach((kp, kIdx) => {
      auditFieldMath({ text: kp, fieldLabel: `${label} · 要点 ${kIdx + 1}`, isBlockMarkdown: true, visuals, issues });
    });
    if (rc.referenceExplanation) {
      auditFieldMath({
        text: rc.referenceExplanation,
        fieldLabel: `${label} · 参考解释`,
        isBlockMarkdown: true,
        visuals,
        issues,
      });
    }
  });

  if (resolved.englishPayload?.grammarAndUsageNotes) {
    auditFieldMath({
      text: resolved.englishPayload.grammarAndUsageNotes,
      fieldLabel: '英语语法与辨析笔记',
      isBlockMarkdown: true,
      visuals,
      issues,
    });
  }

  // 3. Audit missing/broken diagram references across prose, boxes, and captions
  const reportedMissingDiagIds = new Set<string>();
  collectMissingDiagRefsInText({
    text: rawBody,
    fieldLabel: '课件正文 (markdownBody)',
    visuals,
    reportedMissingDiagIds,
    issues,
  });
  (resolved.diagrams || []).forEach((d, idx) => {
    if (d.caption) {
      collectMissingDiagRefsInText({
        text: d.caption,
        fieldLabel: `图示 ${d.id || `diag-${idx + 1}`} 说明`,
        visuals,
        reportedMissingDiagIds,
        issues,
      });
    }
  });
  (resolved.heuristicQuestions || []).forEach((hq, idx) => {
    const label = `先思考后讲解 ${hq.id || `hq-${idx + 1}`}`;
    collectMissingDiagRefsInText({
      text: [hq.context, hq.question, hq.hint || '', hq.approach || '', hq.answerReveal || ''].join('\n'),
      fieldLabel: label,
      visuals,
      reportedMissingDiagIds,
      issues,
    });
  });
  (resolved.exercises || []).forEach((ex, idx) => {
    const label = `练习题 #${idx + 1} (${ex.id})`;
    if (ex.diagramId && !resolveVisualRefByToken(ex.diagramId, visuals)) {
      const dedupKey = `ex-diag:${ex.diagramId.toLowerCase()}`;
      if (!reportedMissingDiagIds.has(dedupKey)) {
        reportedMissingDiagIds.add(dedupKey);
        issues.push({
          id: `missing-ex-diag-${issues.length + 1}`,
          severity: 'error',
          category: 'missing_diagram',
          categoryLabel: isStage1 ? '练习题配图 ID 未在阶段一 diagrams 声明' : '练习题配图 ID 缺失对应 SVG',
          locationLabel: `${label} · diagramId="${ex.diagramId}"`,
          rawSnippet: ex.diagramId,
          detail: `练习题 ${ex.id} 绑定了 diagramId="${ex.diagramId}"，但 diagrams 数组中未找到对应${isStage1 ? '图示规格' : ' SVG'}。`,
          fixInstruction: `请在 diagramsToUpsert / diagrams 中补充 id="${ex.diagramId}" 的${isStage1 ? '拓扑规格说明（topologySpec）' : '清晰 SVG 图示（先写 topologySpec）'}。`,
        });
      }
    }
    const variantTexts =
      typeof ex.variantCheck === 'string'
        ? [ex.variantCheck]
        : ex.variantCheck && typeof ex.variantCheck === 'object'
          ? [ex.variantCheck.question, ...(ex.variantCheck.options || []), ex.variantCheck.explanation || '']
          : [];
    collectMissingDiagRefsInText({
      text: [
        ex.question,
        ...(ex.options || []),
        ex.hint || '',
        ex.explanation || '',
        ex.wrongOptionsAnalysis || '',
        ex.remediation || '',
        ...variantTexts,
      ].join('\n'),
      fieldLabel: label,
      visuals,
      reportedMissingDiagIds,
      issues,
    });
  });
  (resolved.reverseChecks || []).forEach((rc, idx) => {
    collectMissingDiagRefsInText({
      text: [rc.prompt, rc.referenceExplanation || ''].join('\n'),
      fieldLabel: `反向解释检验 #${idx + 1}`,
      visuals,
      reportedMissingDiagIds,
      issues,
    });
  });

  // 4. Audit broken {{heuristic:...}} / {{exercise:...}} anchors in markdownBody
  const bodyNoCode = rawBody.replace(/```[\s\S]*?```/g, ' ');
  const hqIds = new Set(
    (resolved.heuristicQuestions || []).map((h, i) => (h.id || `hq-${i + 1}`).trim().toLowerCase())
  );
  const exIds = new Set(
    (resolved.exercises || []).map((ex, i) => (ex.id || `ex-${i + 1}`).trim().toLowerCase())
  );

  const nonDiagAnchorRe = /(?:\{\{|\[{2})\s*(heuristic|exercise)\s*:\s*([^}\]]+?)\s*(?:\}\}|\]{2})/gi;
  let aMatch: RegExpExecArray | null;
  while ((aMatch = nonDiagAnchorRe.exec(bodyNoCode)) !== null) {
    const kind = aMatch[1].toLowerCase();
    const refId = aMatch[2].trim();
    const numOnly = refId.match(/^(\d+)$/)?.[1];
    if (kind === 'heuristic') {
      const exists =
        hqIds.has(refId.toLowerCase()) ||
        (numOnly && Number(numOnly) >= 1 && Number(numOnly) <= (resolved.heuristicQuestions?.length || 0));
      if (!exists) {
        issues.push({
          id: `missing-hq-${issues.length + 1}`,
          severity: 'error',
          category: 'missing_anchor',
          categoryLabel: '思考题锚点缺失目标条目',
          locationLabel: `课件正文（${aMatch[0]}）`,
          rawSnippet: aMatch[0],
          detail: `正文插入了 ${aMatch[0]}，但 heuristicQuestions 数组中不存在 id="${refId}" 的条目。`,
          fixInstruction: `补充 id 为 "${refId}" 的 heuristicQuestions 条目，或更正正文中的锚点 ID。`,
        });
      }
    } else if (kind === 'exercise') {
      const exists =
        exIds.has(refId.toLowerCase()) ||
        (numOnly && Number(numOnly) >= 1 && Number(numOnly) <= (resolved.exercises?.length || 0));
      if (!exists) {
        issues.push({
          id: `missing-ex-${issues.length + 1}`,
          severity: 'error',
          category: 'missing_anchor',
          categoryLabel: '即时练习锚点缺失目标条目',
          locationLabel: `课件正文（${aMatch[0]}）`,
          rawSnippet: aMatch[0],
          detail: `正文插入了 ${aMatch[0]}，但 exercises 数组中不存在 id="${refId}" 的题目。`,
          fixInstruction: `补充 id 为 "${refId}" 的 exercises 题目对象，或更正正文中的锚点 ID。`,
        });
      }
    }
  }

  // 5. Audit unresolved local images
  const unresolvedImgs = detectUnresolvedImageRefs(rawBody, existingAssets);
  for (const imgRef of unresolvedImgs) {
    issues.push({
      id: `unresolved-img-${issues.length + 1}`,
      severity: 'warning',
      category: 'unresolved_image',
      categoryLabel: '本地图片引用尚未绑定文件',
      locationLabel: '课件正文图片引用',
      rawSnippet: imgRef,
      detail: `引用了本地图片 "${imgRef}"，但尚未上传对应图片资产，阅读时会显示破损图片占位符。`,
      fixInstruction: `在前端上传 "${imgRef}" 图片文件，或让 AI 改为内联 SVG 图示（写入 diagrams 数组）。`,
    });
  }

  // 6. Audit duplicate IDs across diagrams, heuristicQuestions, exercises, reverseChecks
  const checkDuplicateIds = (
    items: Array<{ id?: string } | undefined>,
    kindLabel: string,
    defaultPrefix: string
  ) => {
    const seen = new Set<string>();
    items.forEach((item, idx) => {
      const rawId = (item?.id || '').trim();
      if (!rawId) return;
      const norm = rawId.toLowerCase();
      if (seen.has(norm)) {
        issues.push({
          id: `dup-id-${defaultPrefix}-${issues.length + 1}`,
          severity: 'error',
          category: 'duplicate_id',
          categoryLabel: `${kindLabel} ID 重复`,
          locationLabel: `${kindLabel}[${idx}] (${rawId})`,
          rawSnippet: rawId,
          detail: `${kindLabel} 中存在重复的 id="${rawId}"，会导致内联锚点、修复补丁或作答记录冲突。`,
          fixInstruction: `为第 ${idx + 1} 项修改为全局唯一的新 ID（并同步更新正文中的锚点引用）。`,
        });
      }
      seen.add(norm);
    });
  };
  checkDuplicateIds(resolved.diagrams || [], '图示 diagrams', 'diag');
  checkDuplicateIds(resolved.heuristicQuestions || [], '启发思考 heuristicQuestions', 'hq');
  checkDuplicateIds(resolved.exercises || [], '练习 exercises', 'ex');
  checkDuplicateIds(resolved.reverseChecks || [], '反向检验 reverseChecks', 'rc');

  // 7. Audit unreplaced AI placeholder text (e.g., TODO, 待补充, 此处省略..., <svg>...</svg>)
  const placeholderRegex =
    /(?:\b(?:TODO|FIXME|TBD)\b|待补充|待完善|请在此填写|此处省略(?:若干|一万|\.\.\.)字|diagram_placeholder|placeholder|<svg\b[^>]*>\s*\.\.\.\s*<\/svg>)/i;
  const checkPlaceholderField = (text: string | undefined, fieldLabel: string) => {
    if (!text) return;
    const scanText = text.replace(/```[\s\S]*?```/g, ' ');
    const match = scanText.match(placeholderRegex);
    if (match) {
      const idx = match.index ?? 0;
      issues.push({
        id: `placeholder-${issues.length + 1}`,
        severity: 'error',
        category: 'placeholder_error',
        categoryLabel: '存在未完成的占位符文本',
        locationLabel: fieldLabel,
        rawSnippet: truncateSnippet(scanText.slice(Math.max(0, idx - 20), idx + 60)),
        detail: `检测到说明性占位符 "${match[0]}"，完整课件禁止遗留未实现片段或省略占位。`,
        fixInstruction: `请将 ${fieldLabel} 中的 "${match[0]}" 替换为完整、准确的教学正文或合法 SVG 代码。`,
      });
    }
  };
  checkPlaceholderField(rawBody, '课件正文 (markdownBody)');
  (resolved.diagrams || []).forEach((d, idx) => {
    if (d.svgCode && /<svg\b[^>]*>\s*\.\.\.\s*<\/svg>/i.test(d.svgCode)) {
      checkPlaceholderField(d.svgCode, `图示 ${d.id || `diag-${idx + 1}`} (svgCode)`);
    }
  });
  (resolved.exercises || []).forEach((ex, idx) => {
    const label = `练习题 #${idx + 1} (${ex.id})`;
    checkPlaceholderField(ex.question, `${label} · 题干`);
    checkPlaceholderField(ex.answer, `${label} · 答案`);
    checkPlaceholderField(ex.explanation, `${label} · 解析`);
    checkPlaceholderField(ex.remediation, `${label} · 补救`);
  });

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const availableIds = (resolved.diagrams || []).map((d, idx) => d.id || `diag-${idx + 1}`);
  const repairPrompt = buildCoursewareRepairPrompt(resolved.title, issues, availableIds);

  const summaryText =
    issues.length === 0
      ? '渲染自检通过：未检测到公式 LaTeX 语法报错、未闭合定界符或缺失 diag 图示引用。'
      : `自动检测到 ${errorCount} 处渲染错误${warningCount > 0 ? `、${warningCount} 项警告` : ''}（已生成针对性 AI 修复提示词）。`;

  return {
    hasErrors: errorCount > 0,
    errorCount,
    warningCount,
    issues,
    repairPrompt,
    summaryText,
  };
}

/**
 * Recover already-complete top-level JSON fields from a partially broken or truncated lesson JSON string
 * so the user doesn't lose 90% of a generated lesson when only one tail field or quote broke.
 */
export function salvagePartialLessonFromBrokenJson(
  candidateJson: string,
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
  existingAssets: Record<string, string> = {}
): {
  salvagedLesson: DailyLessonContent | null;
  salvagedFields: string[];
} {
  const salvagedObj: Record<string, any> = {};
  const salvagedFields: string[] = [];

  const targetKeys = [
    'generationStage',
    'title',
    'summary',
    'keyPoints',
    'teachingContext',
    'markdownBody',
    'symbolGlossary',
    'diagrams',
    'heuristicQuestions',
    'exercises',
    'reverseChecks',
    'estimatedMinutes',
  ];

  const keyRegex = new RegExp(`"(${targetKeys.join('|')})"\\s*:\\s*`, 'g');
  let m: RegExpExecArray | null;

  const extractBalancedJsonValue = (startIdx: number): string | null => {
    let idx = startIdx;
    while (idx < candidateJson.length && /\s/.test(candidateJson[idx])) idx++;
    if (idx >= candidateJson.length) return null;

    const firstCh = candidateJson[idx];
    if (firstCh === '"') {
      let i = idx + 1;
      let escaped = false;
      while (i < candidateJson.length) {
        const c = candidateJson[i];
        if (escaped) {
          escaped = false;
        } else if (c === '\\') {
          escaped = true;
        } else if (c === '"') {
          return candidateJson.slice(idx, i + 1);
        }
        i++;
      }
      return null;
    }

    if (firstCh === '{' || firstCh === '[') {
      const stack: string[] = [firstCh === '{' ? '}' : ']'];
      let i = idx + 1;
      let inStr = false;
      let escaped = false;
      while (i < candidateJson.length) {
        const c = candidateJson[i];
        if (inStr) {
          if (escaped) escaped = false;
          else if (c === '\\') escaped = true;
          else if (c === '"') inStr = false;
        } else if (c === '"') {
          inStr = true;
        } else if (c === '{') {
          stack.push('}');
        } else if (c === '[') {
          stack.push(']');
        } else if (c === '}' || c === ']') {
          const expected = stack.pop();
          if (c !== expected) return null;
          if (stack.length === 0) return candidateJson.slice(idx, i + 1);
        }
        i++;
      }
      return null;
    }

    const primMatch = candidateJson.slice(idx).match(/^(?:-?\d+(?:\.\d+)?|true|false|null)/);
    return primMatch ? primMatch[0] : null;
  };

  while ((m = keyRegex.exec(candidateJson)) !== null) {
    const key = m[1];
    if (key in salvagedObj) continue;
    const rawVal = extractBalancedJsonValue(m.index + m[0].length);
    if (!rawVal) continue;
    try {
      const parsedVal = JSON.parse(repairUnescapedLatexInJsonString(rawVal));
      salvagedObj[key] = parsedVal;
      salvagedFields.push(key);
    } catch {
      // ignore unsalvageable field
    }
  }

  const markdownLen =
    typeof salvagedObj.markdownBody === 'string' ? salvagedObj.markdownBody.trim().length : 0;
  const hasArrayContent =
    (Array.isArray(salvagedObj.diagrams) && salvagedObj.diagrams.length > 0) ||
    (Array.isArray(salvagedObj.exercises) && salvagedObj.exercises.length > 0) ||
    (Array.isArray(salvagedObj.heuristicQuestions) && salvagedObj.heuristicQuestions.length > 0);

  if (
    salvagedFields.length === 0 ||
    (!hasArrayContent && markdownLen < 80 && salvagedFields.length < 3)
  ) {
    return { salvagedLesson: null, salvagedFields };
  }

  try {
    const { lesson } = parseImportedLessonContent(
      JSON.stringify(salvagedObj),
      slot,
      'chat',
      existingAssets,
      { stageMode: salvagedObj.generationStage === 'stage1_content' ? 'stage1' : 'auto' }
    );
    return { salvagedLesson: lesson, salvagedFields };
  } catch {
    return { salvagedLesson: null, salvagedFields };
  }
}

/**
 * Audit raw pasted/uploaded text right after input in the Chat/Edit workbench.
 * Automatically repairs single-backslash LaTeX commands before parsing, catches broken/truncated JSON
 * with exact error position diagnostics & partial field salvage, then runs full formula/SVG diagnostics.
 */
export function auditRawCoursewareInput(
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
  existingAssets: Record<string, string> = {},
  options?: { stage?: 'stage1' | 'complete' }
): {
  report: CoursewareDiagnosticReport;
  parsedLesson: DailyLessonContent | null;
} | null {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) return null;

  // Check if user clearly intended JSON output (starts with { or ```json block or contains "markdownBody":)
  const jsonFenceMatch = trimmed.match(/```json\s*([\s\S]*?)(?:```|$)/i);
  const looksLikeJson =
    trimmed.startsWith('{') || Boolean(jsonFenceMatch) || /"markdownBody"\s*:/.test(trimmed);

  if (looksLikeJson) {
    let candidateJson = trimmed;
    if (jsonFenceMatch) {
      candidateJson = jsonFenceMatch[1].trim();
    } else if (!trimmed.startsWith('{')) {
      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (firstBrace !== -1) {
        candidateJson = trimmed.slice(firstBrace, lastBrace > firstBrace ? lastBrace + 1 : undefined);
      }
    }

    const sanitizedCandidate = repairUnescapedLatexInJsonString(candidateJson);
    try {
      JSON.parse(sanitizedCandidate);
    } catch (jsonErr: any) {
      const msg = String(jsonErr?.message || 'Invalid JSON');
      const posMatch = msg.match(/position\s+(\d+)/i);
      const errPos = posMatch ? Math.min(sanitizedCandidate.length, Number(posMatch[1])) : -1;
      const isTailTruncation =
        errPos === -1 ||
        errPos >= sanitizedCandidate.length - 180 ||
        /unexpected end|unterminated string/i.test(msg);

      const errorWindow =
        errPos >= 0
          ? `${sanitizedCandidate.slice(Math.max(0, errPos - 90), errPos)}[❌]${sanitizedCandidate.slice(errPos, Math.min(sanitizedCandidate.length, errPos + 90))}`
          : sanitizedCandidate.length > 200
            ? sanitizedCandidate.slice(-180)
            : sanitizedCandidate;

      const { salvagedLesson, salvagedFields } = salvagePartialLessonFromBrokenJson(
        sanitizedCandidate,
        slot,
        existingAssets
      );

      const issues: CoursewareDiagnosticIssue[] = [
        {
          id: 'json-syntax-1',
          severity: 'error',
          category: 'json_syntax_error',
          categoryLabel: isTailTruncation ? '课件 JSON 输出截断或缺少末尾括号' : '课件 JSON 局部语法错误',
          locationLabel:
            errPos >= 0
              ? `字符偏移 ${errPos} / ${sanitizedCandidate.length}`
              : '输入文本整体结构',
          rawSnippet: truncateSnippet(errorWindow, 220),
          detail: `JSON.parse 失败：${msg}。${
            salvagedFields.length > 0
              ? `已自动抢救保留 ${salvagedFields.length} 个完整字段（${salvagedFields.join('、')}），无需整节重生成。`
              : '常见原因：AI 输出被长度截断缺少末尾括号，或字符串内出现了未转义的双引号/反斜杠。'
          }`,
          fixInstruction:
            salvagedFields.length > 0
              ? '请仅针对报错/缺失字段输出增量修复或续写补丁 JSON，无需重新输出已抢救字段。'
              : '请补全被截断的 JSON 末尾结构，或修正报错偏移处的引号与反斜杠转义。',
        },
      ];
      return {
        parsedLesson: salvagedLesson,
        report: {
          hasErrors: true,
          errorCount: 1,
          warningCount: 0,
          issues,
          repairPrompt: buildCoursewareRepairPrompt(slot.title, issues, [], {
            salvagedFields,
            isTailTruncation,
            errorOffset: errPos >= 0 ? errPos : undefined,
          }),
          summaryText:
            salvagedFields.length > 0
              ? `检测到 JSON 局部损坏/截断，已自动抢救 ${salvagedFields.join('、')}，可仅生成增量补丁修复剩余部分。`
              : '检测到输入的 JSON 存在语法错误或被截断，已精准定位报错位置。',
        },
      };
    }
  }

  try {
    const parsed = parseImportedLessonContent(trimmed, slot, 'chat', existingAssets, {
      stageMode: options?.stage === 'stage1' ? 'stage1' : options?.stage === 'complete' ? 'complete' : 'auto',
    });
    const report = auditCoursewareRendering(parsed.lesson, existingAssets, options);
    return { report, parsedLesson: parsed.lesson };
  } catch (err: any) {
    const issues: CoursewareDiagnosticIssue[] = [
      {
        id: 'parse-fatal-1',
        severity: 'error',
        category: 'json_syntax_error',
        categoryLabel: '课件内容解析异常',
        locationLabel: '输入内容',
        rawSnippet: truncateSnippet(trimmed),
        detail: err?.message || '无法解析输入内容',
        fixInstruction: '请检查输出是否符合课件 JSON 或 Markdown 格式要求。',
      },
    ];
    return {
      parsedLesson: null,
      report: {
        hasErrors: true,
        errorCount: 1,
        warningCount: 0,
        issues,
        repairPrompt: buildCoursewareRepairPrompt(slot.title, issues, []),
        summaryText: '课件解析失败，请根据提示词重新生成。',
      },
    };
  }
}

/**
 * Apply an incremental repair patch (or bare SVG or full replacement) onto an existing lesson
 * WITHOUT regenerating or losing untouched sections, derivations, diagrams, or exercises.
 */
export function applyCoursewareRepairPatch(
  baseLesson: DailyLessonContent,
  rawPatchInput: string,
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
  existingAssets: Record<string, string> = {}
): {
  mergedLesson: DailyLessonContent;
  appliedMode: 'patch_json' | 'bare_svg' | 'full_replace';
  appliedSummary: string;
} {
  const trimmed = (rawPatchInput || '').trim();
  if (!trimmed) {
    throw new Error('粘贴的修复内容为空');
  }

  const cloned: DailyLessonContent = JSON.parse(JSON.stringify(baseLesson));

  // Extract JSON candidate if wrapped in ```json ... ```
  const jsonFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidateJsonStr = jsonFenceMatch ? jsonFenceMatch[1].trim() : trimmed;

  // 1. Check if input is a JSON object
  if (candidateJsonStr.startsWith('{')) {
    const parsedObj = tryParseJsonWithLatexRepair(candidateJsonStr);

    if (parsedObj && typeof parsedObj === 'object' && !Array.isArray(parsedObj)) {
      const isIncrementalPatch =
        Array.isArray(parsedObj.textReplacements) ||
        Array.isArray(parsedObj.diagramsToUpsert) ||
        Array.isArray(parsedObj.exercisesToUpsert) ||
        Array.isArray(parsedObj.heuristicQuestionsToUpsert) ||
        Array.isArray(parsedObj.reverseChecksToUpsert) ||
        Boolean(parsedObj.teachingContextPatch && typeof parsedObj.teachingContextPatch === 'object') ||
        typeof parsedObj.markdownBodyPrefixPrepend === 'string' ||
        typeof parsedObj.markdownBodySuffixAppend === 'string' ||
        (!parsedObj.markdownBody &&
          (Array.isArray(parsedObj.diagrams) ||
            Array.isArray(parsedObj.exercises) ||
            Array.isArray(parsedObj.heuristicQuestions) ||
            Array.isArray(parsedObj.reverseChecks) ||
            Array.isArray(parsedObj.symbolGlossary)));

      if (isIncrementalPatch) {
        let replacementHits = 0;
        let upsertedDiagrams = 0;
        let upsertedExercises = 0;
        let upsertedHeuristics = 0;
        let updatedContext = 0;

        if (parsedObj.teachingContextPatch && typeof parsedObj.teachingContextPatch === 'object') {
          const patch = parsedObj.teachingContextPatch;
          cloned.teachingContext = {
            prerequisites: Array.isArray(patch.prerequisites)
              ? patch.prerequisites.map(String)
              : cloned.teachingContext?.prerequisites || [],
            prerequisiteCheck:
              typeof patch.prerequisiteCheck === 'string'
                ? stripAiCitationArtifacts(patch.prerequisiteCheck)
                : cloned.teachingContext?.prerequisiteCheck,
            learningObjectives: Array.isArray(patch.learningObjectives)
              ? patch.learningObjectives.map(String)
              : cloned.teachingContext?.learningObjectives || [],
            teachingScope:
              typeof patch.teachingScope === 'string'
                ? patch.teachingScope
                : cloned.teachingContext?.teachingScope || '',
            connectionNote:
              typeof patch.connectionNote === 'string'
                ? patch.connectionNote
                : cloned.teachingContext?.connectionNote || '',
          };
          updatedContext++;
        }

        if (
          typeof parsedObj.markdownBodyPrefixPrepend === 'string' &&
          parsedObj.markdownBodyPrefixPrepend.trim()
        ) {
          const prefix = parsedObj.markdownBodyPrefixPrepend.trim();
          if (!(cloned.markdownBody || '').includes(prefix.slice(0, 24))) {
            cloned.markdownBody = `${prefix}\n\n${cloned.markdownBody || ''}`.trim();
            replacementHits++;
          }
        }

        const replacements: Array<{ target: string; replacement: string }> = Array.isArray(
          parsedObj.textReplacements
        )
          ? parsedObj.textReplacements
              .map((item: any) => ({
                target: String(item?.target ?? item?.find ?? item?.old ?? item?.from ?? '').trim(),
                replacement: String(
                  item?.replacement ?? item?.replace ?? item?.new ?? item?.to ?? ''
                ).trim(),
              }))
              .filter((r: { target: string; replacement: string }) => r.target.length > 0)
          : [];

        const applyStringReplacements = (str: string | undefined): string => {
          if (!str || replacements.length === 0) return str || '';
          let out = str;
          for (const { target, replacement } of replacements) {
            if (out.includes(target)) {
              out = out.split(target).join(replacement);
              replacementHits++;
            } else {
              // Also try matching with normalized whitespace if exact substring didn't hit
              const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
              const re = new RegExp(escapedTarget, 'g');
              if (re.test(out)) {
                out = out.replace(re, replacement);
                replacementHits++;
              }
            }
          }
          return out;
        };

        if (replacements.length > 0) {
          cloned.summary = applyStringReplacements(cloned.summary);
          cloned.keyPoints = (cloned.keyPoints || []).map((kp) => applyStringReplacements(kp));
          if (cloned.teachingContext?.prerequisiteCheck) {
            cloned.teachingContext.prerequisiteCheck = applyStringReplacements(
              cloned.teachingContext.prerequisiteCheck
            );
          }
          cloned.markdownBody = applyStringReplacements(cloned.markdownBody);
          cloned.heuristicQuestions = (cloned.heuristicQuestions || []).map((hq) => ({
            ...hq,
            context: applyStringReplacements(hq.context),
            question: applyStringReplacements(hq.question),
            hint: hq.hint ? applyStringReplacements(hq.hint) : hq.hint,
            approach: hq.approach ? applyStringReplacements(hq.approach) : hq.approach,
            answerReveal: applyStringReplacements(hq.answerReveal),
          }));
          cloned.exercises = (cloned.exercises || []).map((ex) => ({
            ...ex,
            question: applyStringReplacements(ex.question),
            options: ex.options?.map((o) => applyStringReplacements(o)),
            answer: applyStringReplacements(ex.answer),
            hint: ex.hint ? applyStringReplacements(ex.hint) : ex.hint,
            explanation: applyStringReplacements(ex.explanation),
            wrongOptionsAnalysis: ex.wrongOptionsAnalysis
              ? applyStringReplacements(ex.wrongOptionsAnalysis)
              : ex.wrongOptionsAnalysis,
            remediation: ex.remediation
              ? applyStringReplacements(ex.remediation)
              : ex.remediation,
            variantCheck:
              typeof ex.variantCheck === 'string'
                ? applyStringReplacements(ex.variantCheck)
                : ex.variantCheck && typeof ex.variantCheck === 'object'
                  ? {
                      ...ex.variantCheck,
                      question: applyStringReplacements(ex.variantCheck.question),
                      options: ex.variantCheck.options?.map((o) => applyStringReplacements(o)),
                      answer: applyStringReplacements(ex.variantCheck.answer),
                      explanation: ex.variantCheck.explanation
                        ? applyStringReplacements(ex.variantCheck.explanation)
                        : ex.variantCheck.explanation,
                    }
                  : ex.variantCheck,
          }));
          cloned.reverseChecks = (cloned.reverseChecks || []).map((rc) => ({
            ...rc,
            topic: applyStringReplacements(rc.topic),
            prompt: applyStringReplacements(rc.prompt),
            keyPoints: (rc.keyPoints || []).map((kp) => applyStringReplacements(kp)),
            referenceExplanation: applyStringReplacements(rc.referenceExplanation),
          }));
        }

        const diagsInput: any[] = Array.isArray(parsedObj.diagramsToUpsert)
          ? parsedObj.diagramsToUpsert
          : !parsedObj.markdownBody && Array.isArray(parsedObj.diagrams)
          ? parsedObj.diagrams
          : [];

        if (diagsInput.length > 0) {
          const existingDiags = [...(cloned.diagrams || [])];
          for (const rawD of diagsInput) {
            if (!rawD || typeof rawD !== 'object') continue;
            const id = String(rawD.id || `diag-${existingDiags.length + 1}`).trim();
            const svgCode = String(rawD.svgCode || '').trim();
            if (!svgCode) continue;
            const newDiag = {
              id,
              title: stripAiCitationArtifacts(String(rawD.title || id)),
              stageLabel: rawD.stageLabel
                ? stripAiCitationArtifacts(String(rawD.stageLabel))
                : undefined,
              topologySpec: rawD.topologySpec
                ? stripAiCitationArtifacts(String(rawD.topologySpec))
                : undefined,
              caption: stripAiCitationArtifacts(String(rawD.caption || rawD.title || '')),
              svgCode,
            };
            const idx = existingDiags.findIndex((d) => (d.id || '').toLowerCase() === id.toLowerCase());
            if (idx >= 0) {
              existingDiags[idx] = newDiag;
            } else {
              existingDiags.push(newDiag);
            }
            // Also sync to any exercise that references this diagramId
            cloned.exercises = (cloned.exercises || []).map((ex) =>
              ex.diagramId && ex.diagramId.toLowerCase() === id.toLowerCase()
                ? { ...ex, svgCode, diagramTitle: ex.diagramTitle || newDiag.title }
                : ex
            );
            upsertedDiagrams++;
          }
          cloned.diagrams = existingDiags;
        }

        const exInput: any[] = Array.isArray(parsedObj.exercisesToUpsert)
          ? parsedObj.exercisesToUpsert
          : !parsedObj.markdownBody && Array.isArray(parsedObj.exercises)
          ? parsedObj.exercises
          : [];
        if (exInput.length > 0) {
          const existingEx = [...(cloned.exercises || [])];
          for (const rawEx of exInput) {
            if (!rawEx || typeof rawEx !== 'object') continue;
            const id = String(rawEx.id || `ex-${existingEx.length + 1}`).trim();
            const idx = existingEx.findIndex((e) => (e.id || '').toLowerCase() === id.toLowerCase());
            if (idx >= 0) {
              existingEx[idx] = { ...existingEx[idx], ...rawEx, id };
            } else {
              existingEx.push({ ...rawEx, id });
            }
            upsertedExercises++;
          }
          cloned.exercises = existingEx;
        }

        const hqInput: any[] = Array.isArray(parsedObj.heuristicQuestionsToUpsert)
          ? parsedObj.heuristicQuestionsToUpsert
          : !parsedObj.markdownBody && Array.isArray(parsedObj.heuristicQuestions)
          ? parsedObj.heuristicQuestions
          : [];
        if (hqInput.length > 0) {
          const existingHq = [...(cloned.heuristicQuestions || [])];
          for (const rawHq of hqInput) {
            if (!rawHq || typeof rawHq !== 'object') continue;
            const id = String(rawHq.id || `hq-${existingHq.length + 1}`).trim();
            const idx = existingHq.findIndex((h) => h.id.toLowerCase() === id.toLowerCase());
            if (idx >= 0) {
              existingHq[idx] = { ...existingHq[idx], ...rawHq, id };
            } else {
              existingHq.push({ ...rawHq, id });
            }
            upsertedHeuristics++;
          }
          cloned.heuristicQuestions = existingHq;
        }

        const rcInput: any[] = Array.isArray(parsedObj.reverseChecksToUpsert)
          ? parsedObj.reverseChecksToUpsert
          : !parsedObj.markdownBody && Array.isArray(parsedObj.reverseChecks)
            ? parsedObj.reverseChecks
            : [];
        if (rcInput.length > 0) {
          const existingRc = [...(cloned.reverseChecks || [])];
          for (const rawRc of rcInput) {
            if (!rawRc || typeof rawRc !== 'object') continue;
            const id = String(rawRc.id || `rc-${existingRc.length + 1}`).trim();
            const idx = existingRc.findIndex((r) => (r.id || '').toLowerCase() === id.toLowerCase());
            if (idx >= 0) {
              existingRc[idx] = { ...existingRc[idx], ...rawRc, id };
            } else {
              existingRc.push({ ...rawRc, id });
            }
          }
          cloned.reverseChecks = existingRc;
        }

        if (!parsedObj.markdownBody && Array.isArray(parsedObj.symbolGlossary)) {
          cloned.symbolGlossary = parsedObj.symbolGlossary;
        }

        if (
          typeof parsedObj.markdownBodySuffixAppend === 'string' &&
          parsedObj.markdownBodySuffixAppend.trim()
        ) {
          const suffix = parsedObj.markdownBodySuffixAppend.trim();
          cloned.markdownBody = `${cloned.markdownBody || ''}\n\n${suffix}`.trim();
          replacementHits++;
        }

        const explicitPatchMinutes = Number(
          parsedObj.estimatedMinutes ?? parsedObj.studyMinutes ?? parsedObj.durationMinutes
        );
        if (Number.isFinite(explicitPatchMinutes) && explicitPatchMinutes > 0) {
          cloned.estimatedMinutes = Math.max(10, Math.min(300, Math.round(explicitPatchMinutes)));
        }

        const summaryParts: string[] = [];
        if (updatedContext > 0) summaryParts.push('更新先修诊断与教学上下文');
        if (replacementHits > 0) summaryParts.push(`局部替换 ${replacementHits} 处公式/文本片段`);
        if (upsertedDiagrams > 0) summaryParts.push(`增量更新/补齐 ${upsertedDiagrams} 幅 SVG 图示`);
        if (upsertedExercises > 0) summaryParts.push(`增量更新 ${upsertedExercises} 道练习题`);
        if (upsertedHeuristics > 0) summaryParts.push(`增量更新 ${upsertedHeuristics} 个启发思考节点`);

        return {
          mergedLesson: cloned,
          appliedMode: 'patch_json',
          appliedSummary:
            summaryParts.length > 0
              ? `增量补丁合并成功（${summaryParts.join('，')}，其余正文与推导完整保留）`
              : '已应用增量补丁并合并到现有课件',
        };
      }
    }
  }

  // 2. Check if user pasted bare <svg>...</svg> snippet(s) directly
  const svgMatches = Array.from(trimmed.matchAll(/<svg[\s\S]*?<\/svg>/gi));
  if (svgMatches.length > 0 && !trimmed.includes('"markdownBody"')) {
    const currentAudit = auditCoursewareRendering(cloned, existingAssets);
    const targetDiagIds = currentAudit.issues
      .filter((i) => i.category === 'missing_diagram' || i.category === 'svg_error')
      .map((i) => {
        const quotedMatch =
          i.detail.match(/编号\s*"([^"]+)"/) ||
          i.detail.match(/锚点\s*"([^"]+)"/) ||
          i.locationLabel.match(/id="([^"]+)"/);
        if (quotedMatch) return quotedMatch[1].trim();
        const diagTokenMatch =
          i.rawSnippet.match(/\b(diag(?:ram)?[-_][A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*)\b/i) ||
          i.detail.match(/\b(diag(?:ram)?[-_][A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*)\b/i);
        return diagTokenMatch ? diagTokenMatch[1].trim() : '';
      })
      .filter(Boolean);

    const existingDiags = [...(cloned.diagrams || [])];
    svgMatches.forEach((m, idx) => {
      const svgCode = m[0];
      const targetId = targetDiagIds[idx] || `diag-${existingDiags.length + 1}`;
      const existingIdx = existingDiags.findIndex(
        (d) => (d.id || '').toLowerCase() === targetId.toLowerCase()
      );
      if (existingIdx >= 0) {
        existingDiags[existingIdx] = {
          ...existingDiags[existingIdx],
          svgCode,
        };
      } else {
        existingDiags.push({
          id: targetId,
          title: `补充图示（${targetId}）`,
          caption: '补充绘制的电路/物理示意图',
          svgCode,
        });
      }
    });
    cloned.diagrams = existingDiags;
    return {
      mergedLesson: cloned,
      appliedMode: 'bare_svg',
      appliedSummary: `已将 ${svgMatches.length} 幅 SVG 图示增量注入原课件（无需重生成全文）`,
    };
  }

  // 3. Fallback: Full lesson JSON or Markdown input -> parse and merge preserving omitted arrays
  const parsedFull = parseImportedLessonContent(trimmed, slot, 'chat', existingAssets);
  const mergedFull: DailyLessonContent = {
    ...parsedFull.lesson,
    diagrams:
      parsedFull.lesson.diagrams && parsedFull.lesson.diagrams.length > 0
        ? parsedFull.lesson.diagrams
        : cloned.diagrams,
    heuristicQuestions:
      parsedFull.lesson.heuristicQuestions && parsedFull.lesson.heuristicQuestions.length > 0
        ? parsedFull.lesson.heuristicQuestions
        : cloned.heuristicQuestions,
    exercises:
      parsedFull.lesson.exercises && parsedFull.lesson.exercises.length > 0
        ? parsedFull.lesson.exercises
        : cloned.exercises,
    symbolGlossary:
      parsedFull.lesson.symbolGlossary && parsedFull.lesson.symbolGlossary.length > 0
        ? parsedFull.lesson.symbolGlossary
        : cloned.symbolGlossary,
  };
  return {
    mergedLesson: mergedFull,
    appliedMode: 'full_replace',
    appliedSummary: '已解析完整课件并完成合并',
  };
}

export type LessonGenerationStage =
  | 'planning_prereq'
  | 'prose_derivation'
  | 'exercises_feedback'
  | 'diagrams_topology';

/**
 * Browser-safe helper to build a targeted partial regeneration / repair prompt for a single stage
 * of a section's lesson, producing incremental JSON compatible with `applyCoursewareRepairPatch`.
 */
export function buildStageRepairPrompt(params: {
  course: Course;
  slot: DailyPlanSlot;
  stage: LessonGenerationStage;
  issueSummary?: string;
}): string {
  const { course, slot, stage, issueSummary } = params;
  const sectionId = ensureStableSectionId(slot.dayIndex, slot.id);
  const levelLabel = resolveLearnerProfile(course).combinedLabel;
  const lesson = slot.lesson;
  const contextLine = `课程《${course.name}》小节 \`${sectionId}\`（${slot.title}｜学习者：${levelLabel}）`;
  const existingDiagIds = (lesson?.diagrams || []).map((d) => d.id || 'diag').join('、') || '无';
  const existingExIds = (lesson?.exercises || []).map((e) => e.id).join('、') || '无';
  const existingHqIds = (lesson?.heuristicQuestions || []).map((h) => h.id).join('、') || '无';

  const issueNote = issueSummary?.trim() ? `\n- **需重点处理的问题**：${issueSummary.trim()}` : '';

  if (stage === 'planning_prereq') {
    return `请仅局部增补/修复 ${contextLine} 的**【先修排查与教学上下文阶段】**（无需重生成正文与练习）：${issueNote}
请对照学习者当前基础，给出简洁精准的先修自检（\`prerequisiteCheck\`）及必要的前置补充（正文用 \`> [!PREREQ]\` 提示框，不重复讲解学生已掌握知识）。

请严格只输出以下增量 JSON 补丁：
\`\`\`json
{
  "teachingContextPatch": {
    "prerequisites": ["本节必需的先修知识"],
    "prerequisiteCheck": "1~2 句先修前提诊断问句 + 若未掌握请先看 [!PREREQ] 补充框的引导",
    "learningObjectives": ["本节可检验学习目标"]
  },
  "markdownBodyPrefixPrepend": "> [!PREREQ]\\n> 简短精准的未确认先修要点补充（若无缺失先修可留空）"
}
\`\`\``;
  }

  if (stage === 'prose_derivation') {
    return `请仅局部修复 ${contextLine} 的**【正文、语义标注与启发推导阶段】**：${issueNote}
- 已有锚点参考：思考题 \`${existingHqIds}\`｜图示 \`${existingDiagIds}\`｜练习题 \`${existingExIds}\`
- 规范要求：使用 \`> [!TEXTBOOK]\`、\`> [!PREREQ]\`、\`> [!INTUITION]\`、\`> [!EXTENSION]\` 深色提示框分类，所有公式严格 \`$...$\` 包裹，禁止 \`[cite: ...]\` 或任何占位符；可在 \`textReplacements\` 精确替换出错段落，或更新指定 \`heuristicQuestionsToUpsert\`。

请严格只输出增量 JSON 补丁：
\`\`\`json
{
  "textReplacements": [
    {
      "find": "原正文中需要替换的精确片段",
      "replace": "修复后的正确推导与分类文本"
    }
  ],
  "heuristicQuestionsToUpsert": [
    {
      "id": "hq-1",
      "context": "关键概念或推导步",
      "question": "先思考提问",
      "hint": "提示",
      "approach": "分析思路",
      "answerReveal": "完整推导与解释"
    }
  ]
}
\`\`\``;
  }

  if (stage === 'exercises_feedback') {
    return `请仅局部修复或补全 ${contextLine} 的**【练习、错因诊断、补救与变式检验阶段】**（无需重写正文）：${issueNote}
- 已有练习 ID：\`${existingExIds}\`｜已有图示 ID：\`${existingDiagIds}\`
- 要求：每题必须自带 \`wrongOptionsAnalysis\`（错因诊断）、\`remediation\`（针对性补救微讲解）与 \`variantCheck\`（离线变式再检验，含 \`question\`/\`options\`/\`answer\`/\`explanation\`），复杂电路或几何题必须配 \`diagramId\` 与 SVG。

请严格只输出增量 JSON 补丁：
\`\`\`json
{
  "exercisesToUpsert": [
    {
      "id": "ex-1",
      "stage": "inline",
      "type": "choice",
      "categoryLabel": "概念辨析",
      "diagramId": "diag-ex-1",
      "question": "题干（公式用 $...$ 包裹）",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "hint": "解题提示",
      "explanation": "完整分步标准解析",
      "wrongOptionsAnalysis": "干扰项错因诊断",
      "remediation": "针对性补救微讲解",
      "variantCheck": {
        "question": "改变条件/参数的变式检验小问",
        "options": ["A. ...", "B. ..."],
        "answer": "B",
        "explanation": "变式检验标准解析"
      }
    }
  ]
}
\`\`\``;
  }

  return `请仅局部修复或重绘 ${contextLine} 的**【电路/几何拓扑规范与 SVG 图示阶段】**（无需重生成全文）：${issueNote}
- 已有图示 ID：\`${existingDiagIds}\`
- 硬性要求：先在每项 \`"topologySpec"\` 明确写出**节点连接、元件参数、电流/电压参考方向（箭头/+ -）或坐标系边界**，再严格按此拓扑生成适配**深色背景**的高对比 \`<svg viewBox="0 0 680 320" xmlns="http://www.w3.org/2000/svg">...</svg>\`，确保图中符号与正文公式 100% 一致（长文本请拆行并留足边距）。

请严格只输出增量 JSON 补丁：
\`\`\`json
{
  "diagramsToUpsert": [
    {
      "id": "diag-1",
      "title": "图 1：图示标题",
      "topologySpec": "节点连接、元件参数与参考方向完整定义",
      "caption": "图示与正文公式符号对照说明（公式用 $...$）",
      "svgCode": "<svg viewBox=\\"0 0 680 320\\" xmlns=\\"http://www.w3.org/2000/svg\\">...</svg>"
    }
  ]
}
\`\`\``;
}

