# Agent Mode Execution Prompt Reference

This file defines the Agent Mode instruction templates loaded by `src/prompts/promptLibrary.ts`:
- `template: agent-syllabus-prompt` (Step 2: Generate `outline.json` based on requirements + Step 1 split regions)
- `template: agent-batch-prompt` (Step 3: Generate per-section lessons `lessons/sec-XX.json` after Step 1 & Step 2 are finalized)

---

## 1. Agent Syllabus Generation Prompt (`template: agent-syllabus-prompt`)

```text
# Learn_everything（第 2 步）— Agent 生成完整课程大纲 (`outline.json`)

你正在为本地课程 **《{{courseName}}》**（课程 ID：`{{courseId}}`）执行 unified 流程的 **第 2 步：基于课程要求与第 1 步切分的教材区域，生成完整课程大纲 (`{{workspaceDir}}/outline.json`)**。

## 一、课程配置与第 1 步 PDF 区域划分情况
- **课程根目录**：`{{workspaceDir}}`
- **学科与水平**：{{profileLabel}}（{{levelLabel}}）
- **课程目标**：{{courseGoal}}
- **周期与起始日**：共 {{durationDays}} 天（起始日期：{{startDate}}）
- **个性化要求**：{{extraRequirements}}
{{englishVocabSummary}}
- **第 1 步切分方案路径**：`{{workspaceDir}}/segments/split-plan.json`
{{splitRegionsSummary}}

## 二、执行要求
1. 读取 `{{workspaceDir}}/course.json`、`{{workspaceDir}}/segments/split-plan.json`，并**直接以多模态方式读取第 1 步无损切分出的 PDF 文件**（`{{workspaceDir}}/segments/region-*.pdf`，以及 `sources/` 中的参考资料），不使用任何 OCR 提取文本。
2. 结合学习目标与各划分区域 PDF 的实际内容，为第 1 ~ {{durationDays}} 天规划完整、先修递进且负荷合理的课程大纲：
   - **每节聚焦 1~3 个紧密关联的核心知识点**；
   - 通过 `"regionId": "region-XX"` 关联第 1 步切分的对应 PDF 区域；
   - 若课程目录中已包含英语分配词汇（`assignedWords`）或已有课件（`hasLesson`），请予以保留，不得丢失或覆盖。
3. 将生成的完整目录写入 `{{workspaceDir}}/outline.json`（保留 `courseId`, `courseName`, `startDate`, `durationDays` 等顶层字段，更新 `knowledgeCatalog` 与 `days` 数组）。

## 三、`outline.json` 输出格式规范
```json
{
  "courseId": "{{courseId}}",
  "courseName": "{{courseName}}",
  "startDate": "{{startDate}}",
  "durationDays": {{durationDays}},
  "outlineConfirmed": false,
  "knowledgeCatalog": [
    {
      "id": "kp-1",
      "title": "核心知识模块名称",
      "prerequisites": ["先修要求"],
      "difficulty": "medium",
      "coreConcepts": ["核心概念1", "核心概念2"],
      "assignedDayIndex": 1
    }
  ],
  "days": [
    {
      "id": "sec-01",
      "dayIndex": 1,
      "date": "{{startDate}}",
      "regionId": "region-01",
      "title": "第 1 讲：聚焦明确的教学主题",
      "objective": "本节具体可检验的自学目标",
      "prerequisites": ["本节先修知识"],
      "teachingScope": "对应区域 region-01 与教材章节范围",
      "connectionNote": "与前后课程的衔接说明",
      "keyTopics": ["核心知识点1", "核心知识点2"]
    }
  ]
}
```
```

---

## 2. Agent Batch Lesson Execution Prompt (`template: agent-batch-prompt`)

```text
# Learn_everything（第 3 步）— Agent 逐节生成课件执行指令（自学闭环与图文同步增强版）

你正在为本地课程 **《{{courseName}}》**（课程 ID：`{{courseId}}`）执行 unified 流程的 **第 3 步：在区域划分、脚本切割与课程大纲均已确定后，逐节生成课件 (`lessons/sec-XX.json`)**。
请严格保证 Agent 模式与 API、Chat 模式的数据结构、生成顺序及教学规范 **100% 一致**。

## 一、课程基本配置与本地文件夹结构
- **课程名称**：{{courseName}}
- **学科与水平**：{{profileLabel}}（{{levelLabel}}）
- **课程目标**：{{courseGoal}}
- **周期与起始日**：共 {{durationDays}} 天（起始日期：{{startDate}}）
- **个性化要求**：{{extraRequirements}}
{{englishVocabSummary}}
- **课程独立本地根目录**：`{{workspaceDir}}`
  - `{{workspaceDir}}/course.json`：课程元数据与配置
  - `{{workspaceDir}}/outline.json`：第 2 步已确定的完整课程目录与区域绑定（`regionId`）
  - `{{workspaceDir}}/sources/`：原始教材 PDF、词库等参考资料：
{{materialFilesList}}
  - `{{workspaceDir}}/segments/`：第 1 步本地脚本无损切割后的区域 PDF 文件（`region-01.pdf` / `sec-01.pdf`）及 `split-plan.json`
  - `{{workspaceDir}}/lessons/`：第 3 步各小节已生成课件 JSON（`sec-01.json`, `sec-02.json` ...）
  - `{{workspaceDir}}/assets/`：课件关联图片或静态资源

---

## 二、课程目录与各小节任务清单（请按顺序逐节生成）
{{dailyScheduleTable}}

> **重要流程约束（默认 Agent 具备多模态 PDF 阅读能力）**：
> 1. 若某小节绑定了第 1 步切分的区域 PDF（`segments/region-XX.pdf`），生成该节课件时请**直接以多模态方式读取对应切分 PDF 原文件**（含公式、电路图、几何图与排版细节），不使用 OCR 文本，也无需重复读取数百页完整原始教材。
> 2. 课程目录（`outline.json`）与课件内容（`lessons/sec-XX.json`）严格分离；已生成课件的小节除非用户明确要求重写，否则保留原文件。

---

## 三、课件教学规范（重点提升独立自学能力，拒绝堆砌式电子讲义）

{{teachingSystemPrompt}}

### 每一节课件必须落实的核心教学要求：
1. **一、教学流程优化**：
   - **先思考，后讲解**：在关键概念、核心推导和解题步骤**之前**设置启发式问题，引导学生先独立思考，再逐步揭示提示（`hint`）、分析思路（`approach`）和完整解释（`answerReveal`）。**必须在 `markdownBody` 对应段落直接插入内联锚点 `{{heuristic:hq-1}}`、`{{heuristic:hq-2}}` 等，严禁将全部思考题集中在课件末尾**。
   - **知识点闭环**：每个核心知识点遵循**“实际问题引入 → 直观解释 → 严格定义 → 原理推导 → 典型例题 → 即时练习（`{{exercise:ex-X}}`）”**的教学顺序，根据学科特点灵活设置自然标题，避免连续讲解大量理论后才安排练习。
   - **合理控制学习负荷**：围绕本节 1~3 个核心知识点讲深讲透，衔接好先修关系。
   - **强化迁移能力**：不仅解释结论，还应讲清**推导思路的来源（为什么会想到这样构造/变形）**、**适用条件与失效边界**、**常见误区**及**面对新问题时的分析方法**。
2. **二、图示与内容质量**：
   - **图文同步**：几何关系、物理结构、电路原理、状态转移等知识应在**首次讲解时**提供对应 SVG 图示，**直接在 `markdownBody` 对应段落插入内联锚点 `{{diagram:diag-1}}`、`{{diagram:diag-2}}` 等，不得将图集中堆放在课件末尾**。
   - **图示参与教学**：SVG 图中明确标注关键变量、参考方向（箭头）、极性和状态，必要时使用分阶段图示（标注 `stageLabel`）解释变化过程，并在正文中直接引用图中符号展开推导。
   - **严格正确性检查**：独立复核数学公式、极限、正负号、推导步骤、图示和练习答案，**重点检查“结论正确但中间推理存在错误、跳步或条件遗漏”的情况**，并将复核结论写入 `qualityCheck.intermediateStepsAuditNote`。
   - **表达简洁规范**：避免重复解释、冗余证明和浮夸措辞，以理解效果而非输出字数衡量课件质量。
3. **三、练习与自主检验（100% 离线自检）**：
   - **即时练习 + 章节末综合练习**：每个核心知识点后安排 1~2 道有针对性的**即时练习**（设置 `"stage": "inline"`，并在正文对应知识点末尾插入 `{{exercise:ex-1}}` 等内联锚点），章节末再进行**综合练习**（设置 `"stage": "comprehensive"`）。
   - **四维能力覆盖**：练习题（不少于 4 道）应覆盖**概念辨析**、**直接应用**、**错误分析**及**知识迁移**。
   - **完整离线解析**：所有练习必须自带 `hint`（启发式提示）、`answer`（唯一标准答案）、`explanation`（可展开的完整分步解析）和 `wrongOptionsAnalysis`（错因分析），确保在没有实时 LLM 调用的情况下即可查看标准答案与解析；同时提供 `reverseChecks`（反向解释检验）。

---

## 四、单节课件 JSON 文件输出格式 (`{{workspaceDir}}/lessons/sec-XX.json`)
请将每节课保存为合法的 UTF-8 JSON 文件，结构如下：
```json
{
  "sectionId": "sec-01",
  "dayIndex": 1,
  "date": "{{startDate}}",
  "title": "第 1 讲标题",
  "summary": "本节核心机制、适用条件与分析方法总结",
  "keyPoints": ["核心知识点1", "核心知识点2"],
  "teachingContext": {
    "prerequisites": ["先修知识"],
    "learningObjectives": ["具体学习目标"],
    "teachingScope": "本节教学范围",
    "connectionNote": "与前后课程的联系"
  },
  "markdownBody": "采用知识点闭环组织的完整正文（Markdown + LaTeX），在对应位置内联包含 {{heuristic:hq-1}}、{{diagram:diag-1}}、{{exercise:ex-1}} 等锚点...",
  "diagrams": [
    {
      "id": "diag-1",
      "title": "图 1：图示标题",
      "stageLabel": "阶段一（可选）",
      "caption": "详细教学图注：说明关键变量、方向和状态变化",
      "svgCode": "<svg viewBox=\"0 0 680 320\" xmlns=\"http://www.w3.org/2000/svg\">...</svg>"
    }
  ],
  "heuristicQuestions": [
    {
      "id": "hq-1",
      "context": "对应的概念或推导环节",
      "question": "先思考：启发式问题内容",
      "hint": "第一层轻量提示",
      "approach": "第二层分析思路切入点",
      "answerReveal": "第三层完整推导与解释"
    }
  ],
  "exercises": [
    {
      "id": "ex-1",
      "stage": "inline",
      "type": "choice",
      "difficulty": "basic",
      "categoryLabel": "概念辨析",
      "question": "即时练习题干",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "hint": "启发式解题提示",
      "explanation": "完整分步标准解析",
      "wrongOptionsAnalysis": "B/C/D 错误选项原因分析"
    },
    {
      "id": "ex-2",
      "stage": "comprehensive",
      "type": "fill",
      "difficulty": "comprehensive",
      "categoryLabel": "知识迁移",
      "question": "章节末综合练习题干",
      "answer": "标准答案",
      "hint": "启发式解题提示",
      "explanation": "完整分步标准解析",
      "wrongOptionsAnalysis": "常见误区说明"
    }
  ],
  "reverseChecks": [
    {
      "id": "rc-1",
      "topic": "核心概念或定理",
      "prompt": "请用自己的话解释该结论成立的原因与适用边界",
      "keyPoints": ["核对要点1", "核对要点2"],
      "referenceExplanation": "标准参考解释"
    }
  ],
  "qualityCheck": {
    "coveredPoints": ["已覆盖的核心知识点"],
    "formulaAndUnitNote": "公式符号与单位核对说明",
    "derivationContinuityNote": "推导思路来源与连续性说明",
    "diagramAlignmentNote": "图文同步与变量方向标注一致性说明",
    "intermediateStepsAuditNote": "对数学公式、极限、正负号、中间推导步骤、图示和练习答案的独立复核记录"
  }{{englishPayloadSchemaNote}}
}
```
```
