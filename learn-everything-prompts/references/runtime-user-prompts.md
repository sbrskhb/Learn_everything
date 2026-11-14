# Runtime User Prompts Reference

This file defines the runtime user prompt templates loaded by `src/prompts/promptLibrary.ts`:
- `template: syllabus-user-prompt`
- `template: course-lesson-user-prompt` (legacy single-shot compatible)
- `template: course-lesson-stage1-prompt` (Stage 1: teaching prose + exercises + diagram specs, no SVG)
- `template: lesson-stage2-diagrams-prompt` (Stage 2: SVG generation purely from Stage 1 specs, shared across API/Chat)
- `template: english-lesson-user-prompt`

---

## 1. Syllabus Planning User Prompt (`template: syllabus-user-prompt`)

````text
请为以下课程制定一份**先修递进清晰、切分粒度合理**的完整课程目录（JSON）：
- 课程名称：{{name}}
- 课程学科类型：{{profileLabel}}
- 学习者起点与目标深度：{{levelLabel}}
- 课程总体目标：{{goal}}
- 补充要求：{{extraRequirements}}
{{vocabSection}}
{{splitRegionsSection}}
{{materialSection}}

### 切分与规划原则
1. **以“较小、逻辑完整的知识点块”为最小教学单元**：
   - 不机械按照教材章节、页数或固定知识点数量切分，也不受计划学习天数约束（系统后续按写完课件的实际耗时自动排期）。
   - 综合**知识依赖、推导复杂度、例题数量与预计学时**确定每节粒度，优先保证单节能够被 AI 完整、深入地生成；避免将多个需要独立推导和大量练习的复杂知识点合并为一节，过大知识点在不破坏推导连续性的前提下合理拆分。
2. **教材全覆盖与第 1 步区域 100% 绑定**：
   - 若上方提供了切分区域列表（`region-01`, ...），必须确保每一个 `region-XX` 均被至少一小节绑定（1 对 1 填 `"regionId"`；大区拆分可多节共用同一 `"regionId"` 并通过 `teachingScope` 区分页码与范围；短区合并须填 `"regionIds": [...]`）。
   - 明确各小节先修 `prerequisites` 与前后衔接 `connectionNote`，暂不输出 `difficulty` 评分。
3. **输出要求**：仅输出包含 `knowledgeCatalog` 与 `sections` 数组的合法 JSON 对象（使用规范专业术语，禁止乱码）。
````

---

## 2. Course Lesson Stage 1 Prompt — Teaching Content & Diagram Specs (`template: course-lesson-stage1-prompt`)

````text
请为课程《{{courseName}}》生成 **第 {{dayIndex}} 节（小节 ID：`{{sectionId}}`）：{{slotTitle}}** 的**阶段一课件（完整教学内容 + 图示规格，不生成 SVG 代码）**。

### 一、本节课程上下文
- **学科与水平**：{{profileLabel}}（{{levelLabel}}）
- **课程总目标**：{{courseGoal}}
- **本节学习目标**：{{slotObjective}}
- **本节先修知识**：{{prerequisites}}
- **本节教学范围**：{{teachingScope}}
- **本节核心知识点**：{{keyTopics}}
- **前后衔接**：前序 {{prevCourseInfo}}；后续 {{nextCourseInfo}}（{{connectionNote}}）
- **个性化要求**：{{extraRequirements}}
{{catalogSection}}
{{materialSection}}

### 二、阶段一职责边界与格式约定
1. **阶段一专注教学质量与精确绘图规格**：
   - 完整生成正文推导（使用 `> [!PREREQ]` / `> [!INTUITION]` / `> [!TEXTBOOK]` / `> [!EXTENSION]`，原位嵌入 `{{heuristic:hq-X}}`、`{{diagram:diag-X}}`、`{{exercise:ex-X}}` 唯一锚点）、符号表 `symbolGlossary`、启发思考题 `heuristicQuestions`、练习题 `exercises`（以及按教学价值选择性配置的 `wrongOptionsAnalysis`、`remediation`、`variantCheck`、`reverseChecks`）。
   - **禁止在本阶段输出复杂 `<svg>` 代码**：凡正文或题目需要配图之处，请在 `diagrams` 中声明条目并写出详尽的 `topologySpec`（节点连接、元件参数、物理量/变量符号、参考方向/极性、坐标轴范围及关键数值状态）与 `caption`，留空或省略 `svgCode`（练习题配图请在题中写明 `diagramId` 并在 `diagrams` 中定义对应 `id` 与 `topologySpec`）。图示 SVG 将在阶段二依据此规格专项生成并自动合并。
2. **格式与转义规则**：
   - 仅输出合法 JSON；JSON 字符串内的 LaTeX 反斜杠必须双写为 `\\`（如 `\\frac`、`\\text`）；`\text{...}` 内禁止裸下划线；文内引用图号直接写 `图 diag-1`（不加反引号）。
   - 全文内容完成后在 JSON 末尾输出整数 `estimatedMinutes`（预计自学耗时，分钟）。

### 三、阶段一输出 JSON Schema
```json
{
  "generationStage": "stage1_content",
  "title": "{{slotTitle}}",
  "summary": "本节核心机制、适用条件与方法总结",
  "keyPoints": ["核心知识点1", "核心知识点2"],
  "teachingContext": {
    "prerequisites": ["本节依赖的先修知识点"],
    "prerequisiteCheck": "先修自检提示：未确认掌握核心前提时可先查看下方 [!PREREQ] 框",
    "learningObjectives": ["具体可检验的学习目标"],
    "teachingScope": "{{teachingScope}}",
    "connectionNote": "{{connectionNote}}"
  },
  "markdownBody": "教学正文：使用 [!PREREQ] / [!INTUITION] / [!TEXTBOOK] / [!EXTENSION] 组织，原位嵌入 {{heuristic:hq-1}}、{{diagram:diag-1}}、{{exercise:ex-1}}...",
  "symbolGlossary": [
    {
      "symbol": "R_f",
      "name": "反馈电阻",
      "definition": "连接输出端与反相输入端的电阻",
      "unit": "\\text{k}\\Omega"
    }
  ],
  "diagrams": [
    {
      "id": "diag-1",
      "title": "图 1：图示标题（如：反相比例运算电路与虚短虚断电流流向）",
      "stageLabel": "工作状态或阶段说明（可选）",
      "topologySpec": "绘图规格：节点连接(Vin经R1接反相端N-，Rf跨接N-与Vo，同相端N+接地)、元件参数(R1, Rf)、参考方向(i1流向N-，if从N-流向Vo)、极性标注、高对比深色风格",
      "caption": "图示与正文的对应说明：指出关键部件、物理量及因果关系"
    }
  ],
  "heuristicQuestions": [
    {
      "id": "hq-1",
      "context": "对应概念或推导步骤",
      "question": "先思考：启发式引导问题",
      "hint": "思考提示（按需填写）",
      "approach": "切入思路（按需填写）",
      "answerReveal": "完整推理解释"
    }
  ],
  "exercises": [
    {
      "id": "ex-1",
      "stage": "inline",
      "type": "choice",
      "difficulty": "basic",
      "categoryLabel": "概念辨析",
      "diagramId": "diag-ex-1",
      "topologySpec": "若本题需要专属配图，写明连接/坐标规格并确保 diagrams 中有对应 diag-ex-1（无需配图则省略）",
      "question": "练习题干",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "hint": "启发提示（按教学价值选填）",
      "explanation": "分步解析（按需要提供）",
      "wrongOptionsAnalysis": "典型错因诊断（仅在存在易混干扰项时选填）",
      "remediation": "针对性补救讲解（按教学价值选填）",
      "variantCheck": {
        "question": "变式检验题（按教学价值选填）",
        "options": ["A. ...", "B. ..."],
        "answer": "B",
        "explanation": "变式解析"
      }
    }
  ],
  "reverseChecks": [
    {
      "id": "rc-1",
      "topic": "检验主题（按本节实际教学价值选填）",
      "prompt": "不用公式，用自己的话解释结论为何成立",
      "keyPoints": ["核对要点1", "核对要点2"],
      "referenceExplanation": "参考要点"
    }
  ],
  "estimatedMinutes": 40
}
```
````

---

## 3. Stage 2 Prompt — Diagrams Generation from Stage 1 Specs (`template: lesson-stage2-diagrams-prompt`)

````text
请为课程《{{courseName}}》第 {{dayIndex}} 节《{{slotTitle}}》（小节 ID：`{{sectionId}}`）执行**阶段二：仅根据阶段一已确认的图示规格生成精准 SVG 矢量图**。

### 严格职责限制（严禁重写完整课件）
1. **只输出新增图示 JSON**：严禁重新生成、改写或输出 `markdownBody`、`exercises`、`heuristicQuestions` 等阶段一已有内容（前端/程序将按图号 `id` 自动与阶段一教学内容合并）。
2. **无需教材原文 PDF**：阶段一已完成建模与符号对齐，请严格按下方每一项图示的 `id`、`topologySpec`、`caption` 及上下文符号要求绘制 `svgCode`。
3. **SVG 绘图与格式规范**：
   - 使用深色高对比背景配色（例如 `#09090b` / `transparent` 底配亮色线、高对比青/橙/白/绿文字），根标签须含清晰 `viewBox="0 0 680 320"`（可按图示复杂度调整高度）。
   - 精准标注节点名、箭头方向、坐标轴刻度、正负极性与变量符号；SVG `<text>` 内直接写清晰符号（如 `u_O`、`R_f`），不要使用 `$...$` 或 `\frac` 等 LaTeX 命令。
   - **严禁单行 `<text>` 溢出右边界**：左右边距至少留 `18px`，长标注拆分为多行 `<tspan>`。
   - 输出合法 JSON，注意双引号按 `\"` 正确转义。

### 待生成图示规格列表（共 {{specCount}} 幅）
{{diagramSpecsJson}}

### 请仅输出以下紧凑 JSON
```json
{
  "diagrams": [
    {
      "id": "必须与上方规格中的 id 严格一致（如 diag-1）",
      "title": "沿用或微调图示标题",
      "caption": "沿用或微调图注说明",
      "svgCode": "<svg viewBox=\"0 0 680 320\" xmlns=\"http://www.w3.org/2000/svg\">...</svg>"
    }
  ]
}
```
````

---

## 4. Course Lesson User Prompt — Unified / Single-Shot Compatible (`template: course-lesson-user-prompt`)

````text
请为课程《{{courseName}}》生成 **第 {{dayIndex}} 节（小节 ID：`{{sectionId}}`）：{{slotTitle}}** 的自主学习闭环课件。

### 一、本节课程上下文
- **学科与水平**：{{profileLabel}}（{{levelLabel}}）
- **课程总目标**：{{courseGoal}}
- **本节学习目标**：{{slotObjective}}
- **本节先修知识**：{{prerequisites}}
- **本节教学范围**：{{teachingScope}}
- **本节核心知识点**：{{keyTopics}}
- **前后衔接**：前序 {{prevCourseInfo}}；后续 {{nextCourseInfo}}（{{connectionNote}}）
- **个性化要求**：{{extraRequirements}}
{{catalogSection}}
{{materialSection}}

### 二、输出结构与格式规范
1. 请将“教学内容组织”严格按系统规范执行：先修诊断 `prerequisiteCheck`、深色分类块（`[!PREREQ]` / `[!INTUITION]` / `[!TEXTBOOK]` / `[!EXTENSION]`）、内联锚点 `{{heuristic:hq-X}}` / `{{diagram:diag-X}}` / `{{exercise:ex-X}}`、`symbolGlossary`，并按教学价值选择性补充 `wrongOptionsAnalysis`、`remediation`、`variantCheck`、`reverseChecks`。
2. 凡涉及图示（含题目配图 `diagramId`），先在 `"topologySpec"` 写清连接关系、元件参数、参考方向与坐标边界，再提供与正文符号一致的深色高对比 SVG（`<svg viewBox="0 0 680 320" ...>...</svg>`）。
3. 仅输出合法 JSON；JSON 字符串中的 LaTeX 反斜杠须双写为 `\\`；`\text{...}` 内禁写裸下划线；在 JSON 最后一个字段输出整数 `"estimatedMinutes"`。

### 三、输出 JSON Schema
```json
{
  "title": "{{slotTitle}}",
  "summary": "本节核心机制、适用条件与方法总结",
  "keyPoints": ["核心知识点1", "核心知识点2"],
  "teachingContext": {
    "prerequisites": ["先修知识点"],
    "prerequisiteCheck": "先修自检与补救提示",
    "learningObjectives": ["本节可检验的学习目标"],
    "teachingScope": "{{teachingScope}}",
    "connectionNote": "{{connectionNote}}"
  },
  "markdownBody": "包含 [!PREREQ] / [!INTUITION] / [!TEXTBOOK] / [!EXTENSION] 与 {{heuristic:hq-1}}、{{diagram:diag-1}}、{{exercise:ex-1}} 锚点的完整正文...",
  "symbolGlossary": [
    {
      "symbol": "R_f",
      "name": "反馈电阻",
      "definition": "连接输出端与反相输入端、形成负反馈的电阻",
      "unit": "\\text{k}\\Omega"
    }
  ],
  "diagrams": [
    {
      "id": "diag-1",
      "title": "图 1：图示标题",
      "stageLabel": "阶段一（可选）",
      "topologySpec": "节点连接、元件参数、参考方向、极性及高对比深色风格",
      "caption": "图示与正文对照说明",
      "svgCode": "<svg viewBox=\"0 0 680 320\" xmlns=\"http://www.w3.org/2000/svg\">...</svg>"
    }
  ],
  "heuristicQuestions": [
    {
      "id": "hq-1",
      "context": "对应知识点或推导关键步",
      "question": "先思考问题",
      "hint": "思考提示（选填）",
      "approach": "切入思路（选填）",
      "answerReveal": "完整推理解释"
    }
  ],
  "exercises": [
    {
      "id": "ex-1",
      "stage": "inline",
      "type": "choice",
      "difficulty": "basic",
      "categoryLabel": "概念辨析",
      "topologySpec": "如含配图写明拓扑规则，否则省略",
      "diagramId": "diag-ex-1",
      "question": "练习题干",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "hint": "解题提示（按教学价值选填）",
      "explanation": "分步解析（按需提供）",
      "wrongOptionsAnalysis": "典型错因分析（按教学价值选填）",
      "remediation": "针对性补救讲解（按教学价值选填）",
      "variantCheck": {
        "question": "变式检验题（按教学价值选填）",
        "options": ["A. ...", "B. ..."],
        "answer": "B",
        "explanation": "变式解析"
      }
    }
  ],
  "reverseChecks": [
    {
      "id": "rc-1",
      "topic": "核心概念（按教学价值选填）",
      "prompt": "用自己的语言解释成立原因与适用条件",
      "keyPoints": ["核对要点1", "核对要点2"],
      "referenceExplanation": "参考解释"
    }
  ],
  "estimatedMinutes": 45
}
```
````

---

## 5. English Lesson User Prompt (`template: english-lesson-user-prompt`)

````text
请为英语课程《{{courseName}}》生成 **第 {{dayIndex}} 节（小节 ID：`{{sectionId}}`）：{{slotTitle}}** 的语境精读与词汇闭环自学课件。

### 一、本节课程与词库上下文
- **课程目标**：{{courseGoal}}
- **词库差集与分配信息**：{{bankSummary}}
- **文章生成模式**：{{articleMode}}（{{articleModeDesc}}）
- **前后衔接**：前序 {{prevCourseInfo}}；后续 {{nextCourseInfo}}
- **补充要求**：{{extraRequirements}}
- **本节目标单词（共 {{wordCount}} 词）**：
{{wordListText}}
{{materialSection}}

### 二、格式与数据结构要求
- 输出包含 `title`, `summary`, `keyPoints`, `teachingContext`（含 `prerequisiteCheck`）, `markdownBody`（结合 `[!PREREQ]` / `[!TEXTBOOK]` / `[!INTUITION]` / `[!EXTENSION]` 及 `{{heuristic:hq-X}}`、`{{exercise:ex-X}}`）, `diagrams`（如含句法分析图，先写 `topologySpec`）, `heuristicQuestions`, `englishPayload`（`articleTitle`, `sourceReference`, `articleMode`, `targetWords`, `paragraphs`, `grammarAndUsageNotes`）, `exercises`（含必需 `answer`，按教学价值选填 `hint`/`explanation`/`wrongOptionsAnalysis`/`remediation`/`variantCheck`）, `reverseChecks`（按需选填）及末尾整数 `"estimatedMinutes"` 的合法 JSON 对象。
````
