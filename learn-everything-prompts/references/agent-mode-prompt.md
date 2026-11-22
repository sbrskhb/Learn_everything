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
   - **大纲阶段不预估 `difficulty` 或按天排版**：学时在写完课件后评估，每日任务由程序按程序计算的学时 自动分配；务必保留 `outline.json` 中既有的 `assignedWords` 或已生成 `hasLesson`。
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
      "topicGroup": "所属主题（语言课程适用，其他可省略）",
      "title": "第 1 节：逻辑完整的知识点块主题",
      "objective": "本节具体可检验的自学目标",
      "prerequisites": ["本节先修知识"],
      "teachingScope": "对应区域 region-01 与原教材章节页码范围",
      "connectionNote": "承上启下的衔接说明",
      "keyTopics": ["核心知识点1", "核心知识点2"],
      "targetWordIds": ["w-001"],
      "reviewWordIds": []
    }
  ]
}
```
````

---

## 2. Agent Batch Lesson Execution Prompt (`template: agent-batch-prompt`)

````text
# Learn_everything（第 3 步）— Agent 两阶段逐小节生成课件执行指令

你正在为本地课程 **《{{courseName}}》**（课程 ID：`{{courseId}}`）执行 **第 3 步：按“阶段一（教学内容 + 图表描述规格） → 阶段二（图表代码生成与组装）”两阶段流程逐小节生成课件**。

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

## 三、两阶段执行协议（严格分离“内容推导”与“图表生成”，提高完整度与成功率）
1. **阶段一 — 生成教学内容与图表描述规格（写入 `lessons/sec-XX.stage1.json`）**：
   - 若小节绑定 `segments/region-XX.pdf`，直接以多模态方式读取该 PDF（不依赖 OCR 文本）。
   - 生成完整教学内容：`teachingContext`、`markdownBody`（含 `> [!PREREQ]` / `> [!INTUITION]` / `> [!TEXTBOOK]` / `> [!EXTENSION]` 及 `{{heuristic:hq-X}}` / `{{diagram:diag-X}}` / `{{exercise:ex-X}}`）、`symbolGlossary`、`heuristicQuestions`、`exercises`（扩展诊断/补救/变式/反向检验按教学价值选择性生成，不机械堆砌）。
   - **禁止在本阶段输出 `diagramSpec` 图表代码或 `<svg>` 源码**：需要配图（含题目配图 `diagramId`）时，仅在 `diagrams` 数组中声明 `id`、`title`、`stageLabel`（可选）、详尽 `topologySpec`（开头写明 `[推荐类型: grid-annot | plot2d | graph | wavedrom | circuit | 自由图表(svgCode)]`，并写清节点连接、元件参数、数学表达式、坐标范围、参考方向、关键状态值）与 `caption`，设 `"generationStage": "stage1_content"`，保存为 `lessons/sec-XX.stage1.json`。（若该小节已存在 `sec-XX.stage1.json`，可直接检查后直接进入阶段二，无需重复重生成阶段一。）
2. **阶段二 — 仅依据阶段一规格生成图表代码并组装最终课件（写入 `lessons/sec-XX.json`）**：
   - 仅读取 `lessons/sec-XX.stage1.json` 中的 `diagrams` 规格（及 `exercises[].diagramId`/`topologySpec`），**严禁重新生成或改写阶段一的 `markdownBody`、推导步骤或练习题内容**。
   - **选型优先级**：**优先**为每幅规格输出零坐标结构化 `diagrams[].diagramSpec`（支持 `grid-annot`、`plot2d`、`graph`、`wavedrom`、`circuit`；具体字段规范见 `prompts/sec-XX/agent-stage2-prompt.md`）；**仅当这 5 类结构化图表均不符合教学表达需求时**（如 3D 几何、斜面受力分析、光学光路、实验装置/器件剖面或复杂专用电路），才省略 `diagramSpec` 并回退绘制深色高对比自由图表 `<svg viewBox="0 0 680 320" xmlns="http://www.w3.org/2000/svg">...</svg>` 填入 `diagrams[].svgCode`（两者二选一；并同步到绑定了 `diagramId` 的练习题，设 `"generationStage": "complete"`），写出最终 `lessons/sec-XX.json`。
   - 若阶段一无需任何图示，可直接设 `"generationStage": "complete"` 并保存为 `lessons/sec-XX.json`。
3. **格式规范**：合法 JSON，字符串内 LaTeX 反斜杠双写 `\\`（如 `\\frac`、`\\text`），`\text{...}` 内禁写裸下划线，正文图号直接写 `图 diag-X`。
4. **同一轮对话内完成检查与修复**：每节写完最终文件后，请求本地应用的 `GET /api/courses/{{courseIdEncoded}}/agent-diagnostics/sec-XX`（替换为实际小节 ID；应用地址和端口以当前运行配置为准，默认 `http://127.0.0.1:3000`）。响应的 `report.issues` 一次列出诊断问题及位置，`report.hasErrors` 指示是否有错误。直接修改对应 JSON 并重新请求，直到没有错误；不要等待用户复制错误或再次提问。警告也尽可能处理。请求失败或无法解决时明确列出原因和剩余问题，不得声称通过。所有目标小节完成后再汇报；同步到应用仍需用户操作。

---

## 四、教学质量规范（由系统按学科与学习者水平动态组合）

讲解例题、自测和练习必须按教材考点改编。重新组织题干，并至少改变数值、条件、所求量或情境之一，重新校验答案。定义、定理、通用公式和标准证明保持准确。

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
      "topologySpec": "[推荐类型: grid-annot | plot2d | graph | wavedrom | circuit | 自由图表(svgCode)] 节点连接、元件参数、物理量、参考方向/极性及坐标系规格",
      "caption": "图示与正文对应说明",
      "diagramSpec": "阶段一禁止输出；阶段二优先填入 grid-annot/plot2d/graph/wavedrom/circuit 结构化对象",
      "svgCode": "阶段一禁止输出；阶段二仅当 5 类 diagramSpec 均不符合需求时，省略 diagramSpec 并填入自由图表 <svg ...>...</svg>"
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
  ]
}
```{{englishPayloadSchemaNote}}
````

---

## 3. Agent Mode Language Reading Batch Prompt (`template: agent-english-batch-prompt`)

````text
# Learn_everything（第 3 步·语言阅读）— Agent 逐节生成完整阅读课件 (`lessons/sec-XX.json`)

你正在本地课程工作区 **`{{workspaceDir}}`** 中，为语言课程 **《{{courseName}}》**（课程 ID：`{{courseId}}`）按序编写阅读课件。本课程为**语言精读课程，采用单阶段完整生成协议**（直接写入 `{{workspaceDir}}/lessons/sec-XX.json`，设 `"generationStage": "complete"`，无需分阶段生成图示）。

## 一、课程配置与资料
- **语言与学习者水平**：{{profileLabel}}（{{levelLabel}}）
- **学习目标**：{{courseGoal}}
- **近期原文检索窗（最近一个月内）**：`{{oneMonthAgoDate}}` ~ `{{currentDate}}`
- **补充要求**：{{extraRequirements}}
{{englishVocabSummary}}
- **工作区资料文件**：
{{materialFilesList}}

---

## 二、小节任务清单（每次专注一个小节；已完成 `sec-XX.json` 且未要求重写的默认跳过）
{{dailyScheduleTable}}

---

## 三、单阶段语言课件执行协议
1. **文章正文严格遵循三级优先级（`{{oneMonthAgoDate}}` ~ `{{currentDate}}`）**：
   - **① 首选（找到原文章并微调词汇）**：具备联网搜索/抓取能力时，优先检索**最近一个月内**与本节主题匹配的真实英文完整原文，保持主体事实与行文结构并按需轻量微调融入目标词汇；若搜到的单篇文章过短，**可在一节课件中组合放入两篇同主题近期短文章**（在 `paragraphs` 中分篇呈现，并在 `articleTitle` / `sourceReference` / `sourceUrl` / `originNote` 中合并保留两篇来源），设 `"contentOrigin": "authentic_article"`。
   - **② 次选（根据原文章自己写，加入词汇）**：若无法直接完整展示原文或目标词密集导致微调难以自然融入，请严格基于检索到的近期真实原文观点、事实与脉络**自己重写完整文章并自然加入目标词汇**；保留所参考原文的来源、标题、发布日期与链接，设 `"contentOrigin": "adapted_article"`，并在 `originNote` 注明改写。
   - **③ 兜底（纯自己编）**：仅当无法检索到可用近期真实文章时，才基于可靠信息纯 AI 原创完整文章，设 `"contentOrigin": "ai_original"`、`sourceUrl: ""`，并在 `originNote` 明确标注（禁止编造虚假新闻链接）。
2. **自然复现前序词汇（跨文章复习）**：
   - 按顺序生成时，可将前一节及更早小节学过的词汇自然融入后续文章正文与新语境练习中（不强制重复次数，不计入本节新增目标词数）。
3. **点击生词弹窗与精炼讲解**：
   - `englishPayload.targetWords` 收录本节目标词、文章高价值生词及正文中复现的前节词（标 `"isReview": true`），填写语境释义、音标、`collocations`、`usageNote` 与例句，驱动界面阅读时的**点词弹窗释义**。**若课程配有目标词库，正文中除词库词汇以外的其余用词难度应小于等于词库中的词汇**（避免在词库之外引入更生僻的高难词）。
   - `markdownBody` 保持精简准确，包含「## 词汇用法精讲」（选重点讲搭配、熟词生义与近义辨析）与「## 长难句解析」（1～3 个代表性复杂句；**引用正文句子时优先使用 `{{quote:P<段落号>:S<句号>}}` 如 `{{quote:P1:S2}}` 直接引用原文**，确保原文修改时精讲句子同步更新）。
   - `exercises` 包含 **3～5 道阅读理解题**（主旨/细节/推断/作者观点，避免照抄原文）+ **2～4 道词汇练习**（语境选词/搭配辨析/句子改写，脱离原文新语境），全部提供答案与解析。**所有选择题（`choice`）的正确选项与干扰项必须保持词数、句式复杂度与细节密度大致均衡，严禁出现“正确选项明显比错误选项长”的特征**，并随机分布正确选项位置。
4. **验证与自检**：每写完一节 `lessons/sec-XX.json`，请求 `GET /api/courses/{{courseIdEncoded}}/agent-diagnostics/sec-XX`（端口以运行配置为准），确认 `report.hasErrors === false`。中文讲解中的美元金额勿成对写 `$`。

---

## 四、核心教学质量规范
{{teachingSystemPrompt}}

---

## 五、语言课件 JSON 字段参考（写入 `{{workspaceDir}}/lessons/sec-XX.json`）
```json
{
  "sectionId": "sec-01",
  "generationStage": "complete",
  "title": "第 1 节标题",
  "summary": "文章主旨与语言要点概述",
  "keyPoints": ["核心阅读技能", "重点表达"],
  "teachingContext": {
    "prerequisites": ["前序关联主题"],
    "learningObjectives": ["本节学习目标"],
    "teachingScope": "主题范围",
    "connectionNote": "与前后节衔接说明"
  },
  "englishPayload": {
    "articleTitle": "Article Title",
    "contentOrigin": "authentic_article | adapted_article | ai_original",
    "sourceReference": "来源刊物 / 参考原文媒体",
    "publishDate": "YYYY-MM-DD",
    "sourceUrl": "https://...（仅 ai_original 时留空）",
    "originNote": "标注：真实原文微调词汇 / 基于近期真实原文改写加词 / 纯 AI 原创",
    "articleMode": "media_search | llm_original",
    "targetWords": [
      {
        "id": "w-001",
        "word": "resilient",
        "phonetic": "/rɪˈzɪliənt/",
        "meaning": "adj. 有韧性的；能迅速恢复的",
        "usageNote": "常用于描述系统、经济或心理在冲击后的恢复能力",
        "collocations": ["resilient supply chain", "economically resilient"],
        "example": "A resilient grid recovers rapidly from extreme weather.",
        "exampleTranslation": "有韧性的电网能从极端天气中迅速恢复。",
        "isReview": false
      }
    ],
    "paragraphs": [
      { "english": "Full English paragraph...", "chinese": "流畅中文译文..." }
    ],
    "grammarAndUsageNotes": ""
  },
  "markdownBody": "## 词汇用法精讲\n...\n\n## 长难句解析\n...",
  "exercises": [
    {
      "id": "ex-1",
      "stage": "comprehensive",
      "type": "choice",
      "difficulty": "application",
      "categoryLabel": "阅读理解·主旨概括",
      "question": "题目",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "B",
      "explanation": "解析"
    }
  ],
  "diagrams": [],
  "heuristicQuestions": [],
  "reverseChecks": []
}
```
````
