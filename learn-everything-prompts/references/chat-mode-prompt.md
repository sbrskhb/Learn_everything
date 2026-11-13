# Chat Mode Manual Workbench Prompt Reference

This file defines the copy-paste prompt templates for **Chat Mode** (`template: chat-lesson-prompt` and `template: chat-syllabus-prompt`) loaded by `src/prompts/promptLibrary.ts`.

---

## 1. Chat Mode Single-Lesson Prompt (`template: chat-lesson-prompt`)

````text
请为我的课程《{{courseName}}》编写 **第 {{dayIndex}}/{{durationDays}} 讲（{{date}}）：{{slotTitle}}** 的自学深度课件。
重点提升课件的**独立自学能力**，让课件从“完整展示知识的电子讲义”转变为**“能够引导我逐步思考、理解、练习并独立掌握知识的自学材料”**。
（注：本对话模型默认具备多模态 PDF 阅读能力，如有随附的切分 PDF 或原教材 PDF，请直接阅读 PDF 原文件本身获取正文、公式与图示，不依赖任何 OCR 提取文本。）

### 一、本节课程与资料上下文
- **学科与学习者水平**：{{profileLabel}}（{{levelLabel}}）
- **课程总目标**：{{courseGoal}}
- **本节学习目标**：{{slotObjective}}
- **本节先修知识**：{{prerequisites}}
- **本节教学范围**：{{teachingScope}}
- **本节核心知识点**：{{keyTopics}}
- **前后课程衔接**：前序为 {{prevCourseInfo}}；后续为 {{nextCourseInfo}}（{{connectionNote}}）
- **补充要求**：{{extraRequirements}}
{{englishWordsSection}}{{materialSection}}

---

### 二、教学设计与内容质量硬性要求（请严格执行）

{{teachingSystemPrompt}}

#### 1. 教学流程优化
- **先思考，后讲解**：在关键概念、推导和解题步骤**之前**设置启发式问题，引导我先独立思考，再逐步揭示提示（`hint`）、分析思路（`approach`）和完整解释（`answerReveal`）。**请在 `markdownBody` 对应段落直接插入内联锚点 `{{heuristic:hq-1}}`、`{{heuristic:hq-2}}` 等，不要将全部思考题集中在课件末尾**。
- **知识点闭环**：每个核心知识点请遵循**“实际问题引入 → 直观解释 → 严格定义 → 原理推导 → 典型例题 → 即时练习（`{{exercise:ex-X}}`）”**的教学顺序，根据学科特点灵活设置标题，避免连续讲解大量理论后才安排练习。
- **合理控制学习负荷**：围绕本节核心知识点把控深度，做好与先修知识的衔接。
- **强化迁移能力**：不仅解释结论，还应讲清**推导思路的来源（为什么会想到这样构造/变形）**、**适用条件与边界**、**常见误区**及**面对新问题时的分析方法**。

#### 2. 图示与内容质量
- **图文同步与可点图引用**：几何关系、物理结构、电路原理等知识应在**首次讲解时**提供对应 SVG 图示，**直接在 `markdownBody` 对应段落插入内联锚点 `{{diagram:diag-1}}`、`{{diagram:diag-2}}` 等，不得将图集中堆放在课件末尾**。在后续推导、思考题或章节末习题中再次提及该图时，请使用 `图 diag-1` 等明确图号（点击即可悬浮小窗查看）。
- **图示参与教学与安全边界**：SVG 图中明确标注关键变量、方向（箭头）和状态；**严禁单行长文本超出 `viewBox` 右边界**（长提示语拆分为多行 `<tspan>` 并预留充足底部高度）。
- **全模块严格 LaTeX 排版**：在 `heuristicQuestions`、`exercises`、`reverseChecks`、`diagrams.caption`、`summary`、`keyPoints` 与正文的所有公式、变量上下标和单位中，**均须使用 `$...$` 包裹**（如 `$u_O = -i_F R_f$`、`$R_1 = 100\,\text{k}\Omega$`）。
- **严格正确性检查**：独立复核数学公式、极限、符号、推导步骤、图示和练习答案，**重点检查“结论正确但中间推理存在错误、跳步或条件遗漏”的情况**，并在 `qualityCheck.intermediateStepsAuditNote` 中记录复核结果。
- **表达简洁规范**：避免重复解释、冗余证明和浮夸措辞，以理解效果而非输出字数衡量课件质量。**严禁在正文、图注或解析中输出 `[cite: 123]`、`[cite: 125, 126]` 等来源引用角标**。

#### 3. 练习与自主检验（100% 离线自检）
- **即时练习 + 章节末综合练习**：每个核心知识点后安排 1~2 道有针对性的**即时练习**（设置 `"stage": "inline"`，并在正文对应位置插入 `{{exercise:ex-1}}` 等内联锚点），章节末再进行**综合练习**（设置 `"stage": "comprehensive"`）。
- **四维能力覆盖**：练习题（不少于 4 道）应覆盖**概念辨析**、**直接应用**、**错误分析**及**知识迁移**。
- **完整离线解析**：保留启发式提示（`hint`）、唯一标准答案（`answer`）、可展开的完整解析（`explanation` + `wrongOptionsAnalysis`）和反向解释检验（`reverseChecks`），确保我在没有实时 LLM 调用的情况下即可查看标准答案与解析。

---

### 三、请输出以下 JSON 代码块（复制粘贴即可直接导入 Learn_everything）
```json
{
  "title": "{{slotTitle}}",
  "summary": "本节核心机制、适用条件与分析方法总结",
  "keyPoints": ["核心知识点1", "核心知识点2"],
  "teachingContext": {
    "prerequisites": ["本节先修知识"],
    "learningObjectives": ["{{slotObjective}}"],
    "teachingScope": "{{teachingScope}}",
    "connectionNote": "{{connectionNote}}"
  },
  "markdownBody": "采用知识点闭环组织的完整自学讲义（Markdown + LaTeX），在正文对应讲解处直接内联包含 {{heuristic:hq-1}}、{{diagram:diag-1}}、{{exercise:ex-1}} 等锚点...",
  "diagrams": [
    {
      "id": "diag-1",
      "title": "图 1：图示标题",
      "stageLabel": "阶段一（可选）",
      "caption": "详细教学图注：说明关键变量、方向和状态关系",
      "svgCode": "<svg viewBox=\"0 0 680 320\" xmlns=\"http://www.w3.org/2000/svg\">...</svg>"
    }
  ],
  "heuristicQuestions": [
    {
      "id": "hq-1",
      "context": "对应的关键概念或推导步骤",
      "question": "先思考：启发式问题内容",
      "hint": "第一层轻量提示",
      "approach": "第二层分析思路",
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
      "question": "紧跟核心知识点的即时练习题干",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "hint": "启发式解题提示",
      "explanation": "完整分步标准解析",
      "wrongOptionsAnalysis": "干扰项错因诊断"
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
      "topic": "核心概念或推导结论",
      "prompt": "请用自己的话解释该结论为什么成立及适用条件",
      "keyPoints": ["核对要点1", "核对要点2"],
      "referenceExplanation": "标准参考解释"
    }
  ],
  "qualityCheck": {
    "coveredPoints": ["已覆盖的核心知识点"],
    "formulaAndUnitNote": "公式符号含义与单位核对说明",
    "derivationContinuityNote": "推导思路来源与无跳步说明",
    "diagramAlignmentNote": "图文同步与变量方向标注说明",
    "intermediateStepsAuditNote": "对公式、极限、符号、中间推导步骤、图示和练习答案的独立复核记录"
  }{{englishPayloadField}}
}
```
````

---

## 2. Chat Mode Syllabus Prompt (`template: chat-syllabus-prompt`)

````text
请为我的课程《{{courseName}}》制定一份为期 **{{durationDays}} 天**（起始日期：{{startDate}}）的完整课程目录与每日学习计划（当前为第 2 步：在区域划分后规划课程大纲）。
- **学科与水平**：{{profileLabel}}（{{levelLabel}}）
- **课程目标**：{{courseGoal}}
- **补充要求**：{{extraRequirements}}
{{splitRegionsSection}}
{{materialSection}}

### 规划核心原则
1. **直接阅读 PDF 原文件并关联第 1 步切分区域**：默认对话 AI 具备多模态 PDF 阅读能力，请直接依据随附的原教材 PDF 或第 1 步切分出的区域 PDF（`region-01.pdf`, `region-02.pdf`, ...）规划每天主题，并在每天的 JSON 中通过 `"regionId": "region-XX"` 绑定对应区域。
2. **合理控制学习负荷**：根据知识难度和先修关系调整讲解深度与课时划分，**每节课聚焦 1~3 个紧密关联的核心知识点**，避免单节课程容纳过多独立知识点；对复杂推导单独安排课时。
3. **支持知识点闭环自学**：每节课的范围应便于展开“实际问题引入 → 直观解释 → 严格定义 → 原理推导 → 典型例题 → 即时练习”的完整闭环。
4. **明确标注资料范围**：在 `teachingScope` 中注明每节课对应区域及原教材的章节号或页码范围。

请严格输出以下 JSON 代码块（`days` 数组长度必须为 {{durationDays}}）：
```json
{
  "knowledgeCatalog": [
    {
      "id": "kp-1",
      "title": "知识模块名称",
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
      "title": "第 1 讲：聚焦明确的教学主题（1~3个核心知识点）",
      "objective": "本节具体可检验的自学目标",
      "prerequisites": ["本节先修知识"],
      "teachingScope": "对应区域 region-01 / 原教材第X章X.X节",
      "connectionNote": "与前后课程的衔接关系",
      "keyTopics": ["核心知识点1", "核心知识点2"]
    }
  ]
}
```
````
