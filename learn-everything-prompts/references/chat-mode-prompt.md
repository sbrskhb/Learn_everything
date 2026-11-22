# Chat Mode Manual Workbench Prompt Reference

This file defines the copy-paste prompt templates for **Chat Mode** loaded by `src/prompts/promptLibrary.ts`:
- `template: chat-lesson-stage1-prompt` (Stage 1: content + diagram specs, attached PDF)
- `template: chat-lesson-prompt` (Single-shot fallback compatible template)
- `template: chat-syllabus-prompt` (Step 2: knowledge-block-first outline JSON)
(Stage 2 Chat prompt reuses `template: lesson-stage2-diagrams-prompt` from `runtime-user-prompts.md` so Stage 2 needs zero PDF re-upload.)

---

## 1. Chat Mode Stage 1 Prompt — Teaching Content & Diagram Specs (`template: chat-lesson-stage1-prompt`)

````text
请为我的课程《{{courseName}}》独立编写 **第 {{dayIndex}} 节（小节 ID：`{{sectionId}}`）：{{slotTitle}}** 的**阶段一课件（完整教学内容 + 图表描述规格，不生成图表代码）**。
（注：如有随附教材 PDF 或切分 PDF，请直接以多模态方式阅读 PDF 原文件本身，不依赖 OCR 文本。）

### 一、本节课程与资料上下文
- **学科与学习者水平**：{{profileLabel}}（{{levelLabel}}）
- **课程总目标**：{{courseGoal}}
- **本节学习目标**：{{slotObjective}}
- **本节先修知识**：{{prerequisites}}
- **本节教学范围**：{{teachingScope}}
- **本节核心知识点**：{{keyTopics}}
- **前后衔接**：前序 {{prevCourseInfo}}；后续 {{nextCourseInfo}}（{{connectionNote}}）
- **补充要求**：{{extraRequirements}}
{{englishWordsSection}}{{materialSection}}

---

### 二、教学质量规范

讲解例题、自测和练习必须按教材考点改编。重新组织题干，并至少改变数值、条件、所求量或情境之一，重新校验答案。定义、定理、通用公式和标准证明保持准确。

{{teachingSystemPrompt}}

---

### 三、阶段一输出边界与 JSON 格式规则
1. **禁止输出 `diagramSpec` 图表代码或 `<svg>` 源码**：专心把先修铺垫、正文直觉与连续推导、例题、启发题（`{{heuristic:hq-X}}`）和练习（`{{exercise:ex-X}}`）写深写透；**凡需要配图的位置**（正文 `{{diagram:diag-X}}` 或题目 `diagramId`），只在 `diagrams` 数组里提供清晰的 `id`、`title`、`topologySpec` 与 `caption`，**不要输出 `diagramSpec` 或 `svgCode`**。
   - 请在 `topologySpec` 开头写明推荐图表类别 `[推荐类型: grid-annot | plot2d | graph | wavedrom | circuit | 自由图表(svgCode)]`，并写明阶段二所需全部参数（矩阵/格子与高亮对角线；函数表达式与坐标区间/阴影；节点与有向边；时序波形或寄存器位域；电路连接/参数/极性/电流方向；若 5 类均不符合需求则标为 `自由图表(svgCode)` 并详述几何构型）。导入 Learn_everything 后，第 2 阶段会自动提取这些规格生成专项图表提示词——优先生成 5 类结构化图表 `diagramSpec`，均不适用再回退自由图表 SVG（且阶段二**无需再上传 PDF**）。
2. **扩展交互字段按需编写**：除练习 `question`/`answer` 等核心项外，`hint`、`explanation`、`wrongOptionsAnalysis`、`remediation`、`variantCheck`、`reverseChecks` 仅在具有实质教学价值时生成，勿机械凑数。
3. **格式约定**：只输出一个合法 `json` 代码块；字符串内 LaTeX 反斜杠双写为 `\\`（如 `\\frac`、`\\text`）；`\text{...}` 内禁写裸下划线；正文中引用图号直接写 `图 diag-1`（勿加反引号）。

```json
{
  "generationStage": "stage1_content",
  "title": "{{slotTitle}}",
  "summary": "本节核心机制、适用条件与分析方法总结",
  "keyPoints": ["核心知识点1", "核心知识点2"],
  "teachingContext": {
    "prerequisites": ["本节先修知识"],
    "prerequisiteCheck": "先修自检提示",
    "learningObjectives": ["{{slotObjective}}"],
    "teachingScope": "{{teachingScope}}",
    "connectionNote": "{{connectionNote}}"
  },
  "markdownBody": "使用 [!PREREQ] / [!INTUITION] / [!TEXTBOOK] / [!EXTENSION] 组织正文，原位包含 {{heuristic:hq-1}}、{{diagram:diag-1}}、{{exercise:ex-1}}...",
  "symbolGlossary": [
    { "symbol": "R_f", "name": "反馈电阻", "definition": "连接输出端与反相输入端的电阻", "unit": "\\text{k}\\Omega" }
  ],
  "diagrams": [
    {
      "id": "diag-1",
      "title": "图 1：图示标题",
      "stageLabel": "阶段说明（可选）",
      "topologySpec": "[推荐类型: grid-annot | plot2d | graph | wavedrom | circuit | 自由图表(svgCode)] 详细图表描述规格：节点连接、元件参数/函数式/矩阵格子、电流电压参考方向/极性、坐标系或工作状态标注（阶段一禁止输出 diagramSpec 或 svgCode）",
      "caption": "详细教学图注"
    }
  ],
  "heuristicQuestions": [
    { "id": "hq-1", "context": "思考情境", "question": "启发思考问题", "hint": "轻量提示（选填）", "approach": "切入思路（选填）", "answerReveal": "完整推理解释" }
  ],
  "exercises": [
    {
      "id": "ex-1",
      "stage": "inline",
      "type": "choice",
      "difficulty": "basic",
      "categoryLabel": "概念辨析",
      "diagramId": "diag-ex-1",
      "topologySpec": "[推荐类型: ...] 若本题需配图在此说明规格，无图省略",
      "question": "练习题干",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "hint": "提示（选填）",
      "explanation": "分步解析（按需提供）",
      "wrongOptionsAnalysis": "典型错因诊断（按价值选填）",
      "remediation": "针对性补救微讲解（按价值选填）",
      "variantCheck": { "question": "变式检验题（按价值选填）", "options": ["A. ...", "B. ..."], "answer": "B", "explanation": "变式解析" }
    }
  ],
  "reverseChecks": [
    { "id": "rc-1", "topic": "核心概念（按价值选填）", "prompt": "不用公式解释成立原因与适用条件", "keyPoints": ["要点1"], "referenceExplanation": "参考解释" }
  ]{{englishPayloadField}}
}
```
````

---

## 2. Chat Mode Single-Lesson Prompt — Single-Shot Compatible (`template: chat-lesson-prompt`)

````text
请为我的课程《{{courseName}}》独立编写 **第 {{dayIndex}} 节（小节 ID：`{{sectionId}}`）：{{slotTitle}}** 的自主学习闭环课件。
（注：如有随附的切分 PDF 或原教材 PDF，请直接以多模态阅读 PDF 原文件本身，不依赖 OCR 提取文本。）

### 一、本节课程与资料上下文
- **学科与学习者水平**：{{profileLabel}}（{{levelLabel}}）
- **课程总目标**：{{courseGoal}}
- **本节学习目标**：{{slotObjective}}
- **本节先修知识**：{{prerequisites}}
- **本节教学范围**：{{teachingScope}}
- **本节核心知识点**：{{keyTopics}}
- **前后衔接**：前序 {{prevCourseInfo}}；后续 {{nextCourseInfo}}（{{connectionNote}}）
- **补充要求**：{{extraRequirements}}
{{englishWordsSection}}{{materialSection}}

---

### 二、教学质量规范

讲解例题、自测和练习必须按教材考点改编。重新组织题干，并至少改变数值、条件、所求量或情境之一，重新校验答案。定义、定理、通用公式和标准证明保持准确。

{{teachingSystemPrompt}}

---

### 三、输出数据结构与格式规则（请只输出一个 `json` 代码块）
- 扩展字段（`hint`、`explanation`、`wrongOptionsAnalysis`、`remediation`、`variantCheck`、`reverseChecks`）按实际教学价值选择性生成，勿机械凑数。
- 每幅配图先在 `topologySpec` 明确推荐图表类型与连接/参数/参考方向后，**优先输出零坐标结构化 `diagramSpec`**（`grid-annot` / `plot2d` / `graph` / `wavedrom` / `circuit`）；**仅当这 5 类结构化图表均不符合需求时**，才省略 `diagramSpec` 并回退输出手写深色高对比自由图表 `svgCode`（`<svg viewBox="0 0 680 320" ...>...</svg>`，两者二选一；含题目专属配图 `diagramId`）。
- JSON 字符串内 LaTeX 反斜杠双写 `\\`；`\text{...}` 内禁写裸下划线；正文中图号直接写 `图 diag-1`。

```json
{
  "title": "{{slotTitle}}",
  "summary": "本节核心机制、适用条件与分析方法总结",
  "keyPoints": ["核心知识点1", "核心知识点2"],
  "teachingContext": {
    "prerequisites": ["本节先修知识"],
    "prerequisiteCheck": "先修自检提示",
    "learningObjectives": ["{{slotObjective}}"],
    "teachingScope": "{{teachingScope}}",
    "connectionNote": "{{connectionNote}}"
  },
  "markdownBody": "使用 [!PREREQ] / [!INTUITION] / [!TEXTBOOK] / [!EXTENSION] 组织正文，原位包含 {{heuristic:hq-1}}、{{diagram:diag-1}}、{{exercise:ex-1}}...",
  "symbolGlossary": [
    { "symbol": "R_f", "name": "反馈电阻", "definition": "连接输出端与反相输入端的电阻", "unit": "\\text{k}\\Omega" }
  ],
  "diagrams": [
    {
      "id": "diag-1",
      "title": "图 1：图示标题",
      "stageLabel": "阶段一（可选）",
      "topologySpec": "[推荐类型: grid-annot | plot2d | graph | wavedrom | circuit | 自由图表(svgCode)] 先明确节点连接、元件参数、电流电压参考方向",
      "caption": "详细教学图注",
      "diagramSpec": {
        "type": "grid-annot | plot2d | graph | wavedrom | circuit"
      },
      "svgCode": "可选兜底（二选一）：仅当 5 类 diagramSpec 均不符合需求时省略 diagramSpec 并填写手写自由图表 <svg ...>...</svg>"
    }
  ],
  "heuristicQuestions": [
    { "id": "hq-1", "context": "思考情境", "question": "启发思考问题", "hint": "轻量提示（选填）", "approach": "切入思路（选填）", "answerReveal": "完整推理解释" }
  ],
  "exercises": [
    {
      "id": "ex-1",
      "stage": "inline",
      "type": "choice",
      "difficulty": "basic",
      "categoryLabel": "概念辨析",
      "topologySpec": "若本题含图示先写明拓扑规则",
      "diagramId": "diag-ex-1",
      "question": "练习题干",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "hint": "解题提示（选填）",
      "explanation": "分步解析（按需提供）",
      "wrongOptionsAnalysis": "错因诊断（按价值选填）",
      "remediation": "针对性补救（按价值选填）",
      "variantCheck": { "question": "变式检验（按价值选填）", "options": ["A. ...", "B. ..."], "answer": "B", "explanation": "变式解析" }
    }
  ],
  "reverseChecks": [
    { "id": "rc-1", "topic": "核心概念（按价值选填）", "prompt": "用自己的话解释成立原因与适用条件", "keyPoints": ["要点1"], "referenceExplanation": "参考解释" }
  ]{{englishPayloadField}}
}
```
````

---

## 3. Chat Mode Syllabus Prompt (`template: chat-syllabus-prompt`)

````text
请为我的课程《{{courseName}}》制定一份完整课程大纲（当前为第 2 步：基于第 1 步教材切分结果划分为适合 AI 单节完整生成的教学小节；本步骤暂不按天排期，后续写完具体课件再由本地程序按程序计算的学时 自动排入学习日程）。
- **学科与水平**：{{profileLabel}}（{{levelLabel}}）
- **课程目标**：{{courseGoal}}
- **补充要求**：{{extraRequirements}}
{{vocabSection}}
{{splitRegionsSection}}
{{materialSection}}

### 规划核心原则
1. **以“较小、逻辑完整的知识点块”为最小教学单元**：
   - 请直接以多模态方式阅读附带 PDF 或第 1 步切分区域（`region-01.pdf` ...）。
   - **不机械按照教材大章、固定页数或固定知识点数量切分**，而是综合**知识依赖、推导复杂度、例题数量与预计学习时长**决定边界，优先保证单节内容能被 AI 完整、深入地讲透；避免将多个需要独立推导和大量练习的复杂知识点硬塞进一节，较大知识点在不破坏推导连续性的前提下合理拆分。
2. **100% 覆盖切分区域并保留上下文衔接**：
   - 必须保证第 1 步的**每一个 `region-XX`** 都被至少一小节绑定（1 对 1 填 `"regionId"`；大区拆节可多节绑定同一 `regionId` 并用 `teachingScope` 区分页码；短区合并填 `"regionIds": [...]`）；明确 `prerequisites`、`connectionNote` 与 `teachingScope`（含章节及页码范围），无需输出 `difficulty`。

请严格只输出以下 JSON 代码块（粘贴回 Learn_everything 导入）：
```json
{
  "knowledgeCatalog": [
    {
      "id": "kp-1",
      "title": "知识模块名称",
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
      "teachingScope": "对应区域 region-01 / 原教材章节及页码范围",
      "connectionNote": "与前后小节的衔接关系",
      "keyTopics": ["核心知识点1", "核心知识点2"],
      "targetWordIds": ["w-001"],
      "reviewWordIds": []
    }
  ]
}
```
````

---

## 4. Chat Mode Language Reading Prompt (`template: chat-english-lesson-prompt`)

````text
请为我的语言课程《{{courseName}}》生成 **第 {{dayIndex}} 节（小节 ID：`{{sectionId}}`）：{{slotTitle}}** 的英文阅读课件（以**完整英文文章为主体，词汇理解与实际运用为辅助**，一次输出完整终稿 JSON，无需分两阶段）。

### 一、本节主题、时间窗与学习背景
- **课程目标**：{{courseGoal}}
- **本节主题与话题**：{{topicThemeInfo}}
- **本节学习目标**：{{slotObjective}}
- **学习者水平与目的**：{{levelLabel}}｜{{learningPurpose}}
- **文章检索窗口（最近一个月内）**：`{{oneMonthAgoDate}}` ~ `{{currentDate}}`
- **偏好来源参考**：{{preferredSources}}
- **篇幅与难度参考**：{{readingLengthHint}}
- **前后衔接**：前序 {{prevCourseInfo}}；后续 {{nextCourseInfo}}
- **补充要求**：{{extraRequirements}}
{{englishWordsSection}}{{materialSection}}

### 二、教学要求与质量规范
{{teachingSystemPrompt}}

### 三、联网检索优先级与输出 JSON 规范
1. **严格按三级优先级获取或生成文章正文（检索窗 `{{oneMonthAgoDate}}` ~ `{{currentDate}}`）**：
   - **① 首选（找到原文章并微调词汇）**：若支持联网检索，优先找最近一个月内与「{{topicThemeInfo}}」相关的真实英文原文，在保持原文章事实与行文基础上自然微调、融入本节目标词与前节复现词；若搜到的单篇原文过短，**可在一节课件中放入两篇同主题近期短文章**（在 `paragraphs` 中分段标注两篇标题与正文，并保留两篇的 `sourceReference`、`publishDate` 与 `sourceUrl`），设 `"contentOrigin": "authentic_article"`，并在 `originNote` 注明是否微调词汇或双篇组合。
   - **② 次选（根据原文章自己写，加入词汇）**：若无法直接完整展示原文，或目标词较多难以仅靠微调融入，请严格根据检索到的近期真实文章核心内容与结构**自己重写完整文章并自然加入目标词汇**；保留所参考原文的 `sourceReference`、`articleTitle`、`publishDate` 与 `sourceUrl`，设 `"contentOrigin": "adapted_article"`，`originNote` 注明「基于近期真实原文改写并加入词汇」。
   - **③ 兜底（纯自己编）**：仅当无法检索到合适近期文章（或当前环境无法联网）时，才基于可靠背景纯 AI 原创完整文章，设 `"contentOrigin": "ai_original"`、`sourceUrl: ""`，并在 `originNote` 明确标注 AI 原创（严禁虚构新闻链接或信源）。
2. `englishPayload.targetWords` 将直接驱动阅读界面的**「点击正文生词弹出释义」**交互，请将本节重点新词、文章中出现的有价值生词以及正文中自然复现的前节生词（标 `"isReview": true`）一并收入其中（写明原型、音标、语境释义、搭配与例句）。**当存在目标词库时，正文中除词库词汇以外的其余用词难度应小于等于词库中的词汇**（避免在词库外引入更生僻的高难词）。
3. 坚持**先阅读、后讲解、再练习**：`markdownBody` 仅精炼呈现「词汇用法精讲」与「1～3 个长难句解析」，无需逐词罗列全部生词；**「长难句解析」或精讲中引用正文句子时，请使用 `{{quote:P<段落号>:S<句号>}}`（1-based，如 `{{quote:P1:S2}}`）锚点直接引用原文**，确保原文微调时精讲句子与用词同步更新；`exercises` 包含 3～5 道深度阅读理解题 + 2～4 道脱离原文的词汇运用题（语境选词/搭配辨析/句子改写）。**所有选择题的正确选项与错误选项必须保持词数与信息量大致均衡，避免“三短一长选最长”**，且正确选项位置随机分布。无需自行报告词频与覆盖率。
4. 只输出一个合法 \`\`\`json ... \`\`\` 代码块（中文讲解中货币金额请写「美元」，勿成对使用 `$`）：
```json
{
  "sectionId": "{{sectionId}}",
  "generationStage": "complete",
  "title": "{{slotTitle}}",
  "summary": "本节文章主题与语言学习要点概括",
  "keyPoints": ["阅读理解重点", "核心词汇与表达收获"],
  "teachingContext": {
    "prerequisites": ["前序主题衔接"],
    "learningObjectives": ["{{slotObjective}}"],
    "teachingScope": "{{topicThemeInfo}}",
    "connectionNote": "{{connectionNote}}"
  },
  "englishPayload": {
    "articleTitle": "完整英文文章标题",
    "contentOrigin": "authentic_article | adapted_article | ai_original",
    "sourceReference": "来源刊物/网站名称",
    "publishDate": "YYYY-MM-DD",
    "sourceUrl": "https://...（仅 ai_original 时留空）",
    "originNote": "标注：真实原文微调 / 基于近期真实原文改写 / 纯 AI 原创",
    "articleMode": "{{articleMode}}",
    "targetWords": [
      {
        "id": "w-001",
        "word": "单词原型或短语",
        "phonetic": "/.../",
        "meaning": "语境中文释义",
        "usageNote": "固定搭配、熟词生义或近义辨析简注",
        "collocations": ["常用搭配1", "常用搭配2"],
        "example": "新语境例句",
        "exampleTranslation": "例句翻译",
        "isReview": false
      }
    ],
    "paragraphs": [
      {
        "english": "完整英文正文段落...",
        "chinese": "流畅中文译文..."
      }
    ],
    "grammarAndUsageNotes": ""
  },
  "markdownBody": "## 词汇用法精讲\n聚焦重点生词的语境义、搭配、熟词生义与近义词区别。\n\n## 长难句解析\n选取 1～3 句正文复杂句，解析关键语法结构与准确句意。",
  "exercises": [
    {
      "id": "ex-1",
      "stage": "comprehensive",
      "type": "choice",
      "difficulty": "application",
      "categoryLabel": "阅读理解·主旨概括",
      "question": "阅读理解题目（3～5 题，涵盖主旨、细节、推断、作者观点）",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "B",
      "explanation": "答案依据与干扰项辨析"
    },
    {
      "id": "ex-2",
      "stage": "comprehensive",
      "type": "choice",
      "difficulty": "application",
      "categoryLabel": "词汇练习·语境选词",
      "question": "新语境选词/搭配辨析/句子改写题（2～4 题；句子改写可将 type 设为 fill）",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "explanation": "用法解析"
    }
  ],
  "diagrams": [],
  "heuristicQuestions": [],
  "reverseChecks": []
}
```
````
