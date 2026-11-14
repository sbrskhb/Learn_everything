# Agent Mode Execution Prompt Reference

This file defines the Agent Mode instruction templates loaded by `src/prompts/promptLibrary.ts`:
- `template: agent-syllabus-prompt` (Step 2: Generate `outline.json` based on requirements + Step 1 split regions)
- `template: agent-batch-prompt` (Step 3: Two-Stage per-section execution `lessons/sec-XX.stage1.json` -> `lessons/sec-XX.json`)

---

## 1. Agent Syllabus Generation Prompt (`template: agent-syllabus-prompt`)

````text
# Learn_everything（第 2 步）— Agent 生成完整课程大纲 (`outline.json`)

你正在为本地课程 **《{{courseName}}》**（课程 ID：`{{courseId}}`）执行 unified 流程的 **第 2 步：基于课程要求与第 1 步切分区域生成完整课程大纲 (`{{workspaceDir}}/outline.json`)**。

## 一、课程配置与第 1 步 PDF 区域划分情况
- **课程根目录**：`{{workspaceDir}}`
- **学科与水平**：{{profileLabel}}（{{levelLabel}}）
- **课程目标**：{{courseGoal}}
- **个性化要求**：{{extraRequirements}}
{{englishVocabSummary}}
- **第 1 步切分方案路径**：`{{workspaceDir}}/segments/split-plan.json`
{{splitRegionsSummary}}

## 二、执行要求
1. 读取 `{{workspaceDir}}/course.json`、`{{workspaceDir}}/segments/split-plan.json`，并**直接以多模态方式读取切分 PDF 文件**（`{{workspaceDir}}/segments/region-*.pdf` 及 `sources/` 资料），不使用 OCR 文本。
2. 以**较小、逻辑完整的知识点块**作为最小教学单元划分 `knowledgeCatalog` 与 `sections`（程序优先读取 `sections`，亦兼容 `days`）：
   - **不机械按照教材大章、固定页数、固定小节数或计划学习天数切分**；综合**知识依赖、推导复杂度、例题数量与预计学习时长**决定边界，优先保证单节能够被 AI 完整、深入地生成。
   - **复杂内容合理拆分**：避免将多个需要独立推导与大量练习的复杂知识点合在一节；过大知识点在不破坏推导连续性的前提下分节递进。
   - **100% 覆盖切分区域与页面映射**：确保第 1 步切分出的全部 `region-XX.pdf` 均有小节绑定（1 对 1 填 `"regionId"`；大区拆分可多节共用 `"regionId"` 并通过 `teachingScope` 区分范围页码；短区合并填 `"regionIds": [...]`）；明确 `prerequisites` 与 `connectionNote`。
   - **大纲阶段不预估 `difficulty` 或按天排版**：学时在写完课件后评估，每日任务由程序按 `estimatedMinutes` 自动分配；务必保留 `outline.json` 中既有的 `assignedWords` 或已生成 `hasLesson`。
3. 将结果写入 `{{workspaceDir}}/outline.json`：
```json
{
  "courseId": "{{courseId}}",
  "courseName": "{{courseName}}",
  "outlineConfirmed": false,
  "knowledgeCatalog": [
    {
      "id": "kp-1",
      "title": "核心知识模块名称",
      "prerequisites": ["先修要求"],
      "coreConcepts": ["核心概念1", "核心概念2"],
      "sectionId": "sec-01"
    }
  ],
  "sections": [
    {
      "id": "sec-01",
      "regionId": "region-01",
      "regionIds": ["region-01"],
      "title": "第 1 节：逻辑完整的知识点块主题",
      "objective": "本节具体可检验的自学目标",
      "prerequisites": ["本节先修知识"],
      "teachingScope": "对应区域 region-01 与原教材章节页码范围",
      "connectionNote": "承上启下的衔接说明",
      "keyTopics": ["核心知识点1", "核心知识点2"]
    }
  ]
}
```
````

---

## 2. Agent Batch Lesson Execution Prompt (`template: agent-batch-prompt`)

````text
# Learn_everything（第 3 步）— Agent 两阶段逐小节生成课件执行指令

你正在为本地课程 **《{{courseName}}》**（课程 ID：`{{courseId}}`）执行 **第 3 步：按“阶段一（教学内容 + 图示规格） → 阶段二（SVG 生成与组装）”两阶段流程逐小节生成课件**。

## 一、课程配置与本地工作目录
- **课程名称**：{{courseName}}
- **学科与水平**：{{profileLabel}}（{{levelLabel}}）
- **课程目标**：{{courseGoal}}
- **个性化要求**：{{extraRequirements}}
{{englishVocabSummary}}
- **课程根目录**：`{{workspaceDir}}`
  - `{{workspaceDir}}/course.json` / `{{workspaceDir}}/outline.json`
  - `{{workspaceDir}}/sources/`（原始资料）：
{{materialFilesList}}
  - `{{workspaceDir}}/segments/`（切分小节 PDF）
  - `{{workspaceDir}}/prompts/sec-XX/`（每节独立提示词目录，含 `agent-stage1-prompt.md` 与 `agent-stage2-prompt.md`）
  - `{{workspaceDir}}/lessons/`（阶段一中间文件 `sec-XX.stage1.json` 与最终组装文件 `sec-XX.json`）

---

## 二、小节任务清单（每次专注一个小节；已完成 `sec-XX.json` 且未要求重写的默认跳过）
{{dailyScheduleTable}}

---

## 三、两阶段执行协议（严格分离“内容推导”与“矢量绘图”，提高完整度与成功率）
1. **阶段一 — 生成教学内容与图示规格（写入 `lessons/sec-XX.stage1.json`）**：
   - 若小节绑定 `segments/region-XX.pdf`，直接以多模态方式读取该 PDF（不依赖 OCR 文本）。
   - 生成完整教学内容：`teachingContext`、`markdownBody`（含 `> [!PREREQ]` / `> [!INTUITION]` / `> [!TEXTBOOK]` / `> [!EXTENSION]` 及 `{{heuristic:hq-X}}` / `{{diagram:diag-X}}` / `{{exercise:ex-X}}`）、`symbolGlossary`、`heuristicQuestions`、`exercises`（扩展诊断/补救/变式/反向检验按教学价值选择性生成，不机械堆砌）以及末尾整数 `estimatedMinutes`。
   - **本阶段不生成复杂 `<svg>` 代码**：需要配图（含题目配图 `diagramId`）时，仅在 `diagrams` 数组中声明 `id`、`title`、`stageLabel`（可选）、详尽 `topologySpec`（节点连接、元件参数、坐标范围、参考方向、关键状态值）与 `caption`，设 `"generationStage": "stage1_content"`，保存为 `lessons/sec-XX.stage1.json`。（若该小节已存在 `sec-XX.stage1.json`，可直接检查后直接进入阶段二，无需重复重生成阶段一。）
2. **阶段二 — 仅依据阶段一规格生成 SVG 并组装最终课件（写入 `lessons/sec-XX.json`）**：
   - 仅读取 `lessons/sec-XX.stage1.json` 中的 `diagrams` 规格（及 `exercises[].diagramId`/`topologySpec`），**严禁重新生成或改写阶段一的 `markdownBody`、推导步骤或练习题内容**。
   - 为每幅规格绘制深色背景高对比 `<svg viewBox="0 0 680 320" xmlns="http://www.w3.org/2000/svg">...</svg>`（文字边距 `>= 18px`，长标注拆行 `<tspan>`，不带 `$` 宏），填回对应 `diagrams[].svgCode`（并同步到绑定了 `diagramId` 的练习题，设 `"generationStage": "complete"`），写出最终 `lessons/sec-XX.json`。
   - 若阶段一无需任何图示，可直接设 `"generationStage": "complete"` 并保存为 `lessons/sec-XX.json`。
3. **格式规范**：合法 JSON，字符串内 LaTeX 反斜杠双写 `\\`（如 `\\frac`、`\\text`），`\text{...}` 内禁写裸下划线，正文图号直接写 `图 diag-X`。

---

## 四、教学质量规范（由系统按学科与学习者水平动态组合）

{{teachingSystemPrompt}}

---

## 五、小节课件 JSON 字段参考（`sec-XX.stage1.json` 与最终 `sec-XX.json` 同构）
```json
{
  "sectionId": "sec-01",
  "generationStage": "stage1_content",
  "title": "第 1 节标题",
  "summary": "本节核心机制、适用条件与分析方法总结",
  "keyPoints": ["核心知识点1", "核心知识点2"],
  "teachingContext": {
    "prerequisites": ["先修知识"],
    "prerequisiteCheck": "先修自检提醒",
    "learningObjectives": ["具体学习目标"],
    "teachingScope": "本节教学范围",
    "connectionNote": "与前后小节的联系"
  },
  "markdownBody": "使用 [!PREREQ] / [!INTUITION] / [!TEXTBOOK] / [!EXTENSION] 组织，原位嵌入 {{heuristic:hq-1}}、{{diagram:diag-1}}、{{exercise:ex-1}}...",
  "symbolGlossary": [
    { "symbol": "R_f", "name": "反馈电阻", "definition": "连接输出端与反相输入端的电阻", "unit": "\\text{k}\\Omega" }
  ],
  "diagrams": [
    {
      "id": "diag-1",
      "title": "图 1：图示标题",
      "stageLabel": "阶段说明（可选）",
      "topologySpec": "节点连接、元件参数、物理量、参考方向/极性及深色高对比布局规格",
      "caption": "图示与正文对应说明",
      "svgCode": "阶段一省略，阶段二填入完整 <svg ...>...</svg>"
    }
  ],
  "heuristicQuestions": [
    { "id": "hq-1", "context": "思考情境", "question": "先思考问题", "hint": "提示（选填）", "approach": "思路（选填）", "answerReveal": "推理解释" }
  ],
  "exercises": [
    {
      "id": "ex-1",
      "stage": "inline",
      "type": "choice",
      "difficulty": "basic",
      "categoryLabel": "概念辨析",
      "diagramId": "diag-ex-1",
      "topologySpec": "若配图写明拓扑规格（无图省略）",
      "question": "题干",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "hint": "提示（选填）",
      "explanation": "解析（按需提供）",
      "wrongOptionsAnalysis": "错因诊断（按价值选填）",
      "remediation": "针对性补救（按价值选填）",
      "variantCheck": { "question": "变式检验（按价值选填）", "answer": "...", "explanation": "..." }
    }
  ],
  "reverseChecks": [
    { "id": "rc-1", "topic": "核心原理（选填）", "prompt": "用自己的话解释", "keyPoints": ["要点1"], "referenceExplanation": "参考解释" }
  ],
  "estimatedMinutes": 45
}
```{{englishPayloadSchemaNote}}
````
