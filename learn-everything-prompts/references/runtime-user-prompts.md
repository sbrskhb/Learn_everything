# Runtime User Prompts Reference

This file defines the runtime user prompt templates loaded by `src/prompts/promptLibrary.ts`:
- `template: syllabus-user-prompt`
- `template: course-lesson-user-prompt`
- `template: english-lesson-user-prompt`

---

## 1. Syllabus Planning User Prompt (`template: syllabus-user-prompt`)

```text
请为以下课程制定一份**学习负荷合理、先修关系清晰、支持知识点闭环自学**的完整课程目录（JSON）：
- 课程名称：{{name}}
- 课程学科类型：{{profileLabel}}
- 学习者当前水平：{{levelLabel}}
- 课程总体目标：{{goal}}
- 计划总天数：{{durationDays}} 天
- 补充要求：{{extraRequirements}}
{{vocabSection}}
{{splitRegionsSection}}
{{materialSection}}

### 规划与课时划分硬性要求
1. **基于第 1 步切分区域进行大纲规划**：若上方提供了第 1 步已划分/切割的教材区域列表（`region-01`, `region-02`, ...），请依据各区域的主题与页码范围来规划第 1 ~ {{durationDays}} 讲的教学内容，并在 `days` 每一项中填写 `"regionId": "region-XX"` 绑定对应的资料区域。
2. **合理控制单节学习负荷**：根据知识难度和先修关系调整讲解深度与课时划分，**每节课聚焦 1~3 个紧密关联的核心知识点**，避免单节课程容纳过多独立知识点；对复杂推导或高难度核心机制单独划分课时。
3. **保障单节闭环空间**：每节课的知识范围应能够自然展开“实际问题引入 → 直观解释 → 严格定义 → 原理推导 → 典型例题 → 即时练习”的完整闭环。
4. **严格准确可读**：所有标题和知识点必须使用清晰的学科专业术语，严禁出现任何乱码或无意义符号。
5. 严格输出合法的 JSON 对象（包含 `knowledgeCatalog` 数组和长度为 {{durationDays}} 的 `days` 数组）。
```

---

## 2. Course Lesson User Prompt (`template: course-lesson-user-prompt`)

```text
请为课程《{{courseName}}》生成 **第 {{dayIndex}}/{{durationDays}} 讲（{{date}}）：{{slotTitle}}** 的自学深度课件。

### 一、本节课程上下文
- **学科与水平**：{{profileLabel}}（{{levelLabel}}）
- **课程总目标**：{{courseGoal}}
- **本节具体目标**：{{slotObjective}}
- **本节先修知识**：{{prerequisites}}
- **本节教学范围**：{{teachingScope}}
- **本节核心知识点**：{{keyTopics}}
- **前后课程衔接**：前序为 {{prevCourseInfo}}；后续为 {{nextCourseInfo}}（{{connectionNote}}）
- **个性化要求**：{{extraRequirements}}
{{catalogSection}}
{{materialSection}}

---

### 二、课件编写硬性要求（将电子讲义升级为高独立性自学材料）

1. **教学流程优化**：
   - **先思考，后讲解**：在关键概念、推导和解题步骤前设置启发式问题，引导学生独立思考，再逐步揭示提示（`hint`）、分析思路（`approach`）和完整解释（`answerReveal`）。**必须在 `markdownBody` 对应段落直接插入内联锚点 `{{heuristic:hq-1}}`、`{{heuristic:hq-2}}` 等，严禁将全部思考题集中在课件末尾**。
   - **知识点闭环**：本节每个核心知识点遵循**“实际问题引入 → 直观解释 → 严格定义 → 原理推导 → 典型例题 → 即时练习（`{{exercise:ex-X}}`）”**的教学顺序，根据学科特点灵活设置自然标题（不机械套用固定标题），避免连续讲解大量理论后才安排练习。
   - **合理控制学习负荷**：聚焦本节核心知识点讲深讲透，注意与先修知识的衔接。
   - **强化迁移能力**：不仅解释结论，还必须讲清**推导思路的来源（为什么想到这一步构造/变换）**、**适用条件与边界**、**常见误区**及**面对新问题时的分析方法**。

2. **图示与内容质量**：
   - **图文同步**：几何关系、物理结构、电路原理、状态转移等知识应在**首次讲解时**提供对应 SVG 图示，**直接在 `markdownBody` 对应段落插入内联锚点 `{{diagram:diag-1}}`、`{{diagram:diag-2}}` 等，不得将图集中堆放在课件末尾**。
   - **图示参与教学**：SVG 图中明确标注关键变量、参考方向（箭头）、极性和状态，必要时使用分阶段图示（设置 `stageLabel`）解释变化过程，并在正文中直接引用图中符号进行讲解。
   - **严格正确性检查**：独立复核数学公式、极限、符号、推导步骤、图示和练习答案，**重点检查“结论正确但中间推理存在错误、跳步或条件遗漏”的情况**，并在 `qualityCheck.intermediateStepsAuditNote` 中记录复核结果。
   - **表达简洁规范**：避免重复解释、冗余证明和浮夸措辞，以理解效果而非输出字数衡量课件质量。

3. **练习与自主检验（100% 离线可用）**：
   - **即时练习 + 章节末综合练习**：每个核心知识点后安排 1~2 道有针对性的**即时练习**（在 `exercises` 中设置 `"stage": "inline"`，并在 `markdownBody` 对应知识点末尾插入 `{{exercise:ex-1}}` 等内联锚点），章节末再进行**综合练习**（设置 `"stage": "comprehensive"`）。
   - **四维能力覆盖**：练习题（不少于 4 道）应覆盖**概念辨析**、**直接应用**、**错误分析**及**知识迁移**。
   - **保留启发式提示、可展开的完整解析和反向解释检验**：所有练习必须包含 `hint`（启发式提示）、`answer`（唯一标准答案）、`explanation`（完整分步解析）和 `wrongOptionsAnalysis`（错误选项分析），使学习者在没有实时 LLM 调用的情况下即可查看标准答案与解析。

---

### 三、严格输出 JSON Schema
请直接输出合法的 JSON 对象（注意转义 LaTeX 中的反斜杠 `\\`）：
{
  "title": "{{slotTitle}}",
  "summary": "本节核心机制、适用条件与分析方法精炼总结",
  "keyPoints": ["核心知识点1", "核心知识点2"],
  "teachingContext": {
    "prerequisites": ["先修知识点及本节用到它的地方"],
    "learningObjectives": ["本节具体可检验的学习目标"],
    "teachingScope": "{{teachingScope}}",
    "connectionNote": "{{connectionNote}}"
  },
  "markdownBody": "采用知识点闭环组织的 Markdown + LaTeX 正文。每个核心知识点内：实际问题引入 → 内联思考题 {{heuristic:hq-1}} → 结合内联同步图示 {{diagram:diag-1}} 给出直观解释与严格定义 → 连续无跳步原理推导（讲清思路来源、适用条件、常见误区） → 典型例题分步精解 → 紧跟内联即时练习 {{exercise:ex-1}}。切勿把思考题、图示和即时练习堆在文末。",
  "diagrams": [
    {
      "id": "diag-1",
      "title": "图 1：标明变量、方向与状态的教学图示标题",
      "stageLabel": "阶段一 / 状态说明（可选）",
      "caption": "图示与正文的对应说明：指出图中关键部件、物理量、参考方向及变化关系",
      "svgCode": "<svg viewBox=\"0 0 680 320\" xmlns=\"http://www.w3.org/2000/svg\">...</svg>"
    }
  ],
  "heuristicQuestions": [
    {
      "id": "hq-1",
      "context": "对应知识点或推导关键步名称",
      "question": "设置在概念定义或推导关键步之前的启发式思考问题",
      "hint": "第一层提示：点拨观察角度或特例，不直接给出结论",
      "approach": "第二层分析思路：说明从已知条件切入推导的桥梁与方法",
      "answerReveal": "第三层完整解释：严谨的推导结论、原理解释与常见直觉误区"
    }
  ],
  "exercises": [
    {
      "id": "ex-1",
      "stage": "inline",
      "type": "choice",
      "difficulty": "basic",
      "categoryLabel": "概念辨析",
      "question": "紧跟核心知识点后的即时练习题干（支持 LaTeX）",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "hint": "启发式解题提示：点明审题关键或隐含条件，引导独立解题",
      "explanation": "完整分步标准解析（无需实时 LLM 即可离线查看）",
      "wrongOptionsAnalysis": "B/C/D 干扰项的具体错因诊断与常见误区剖析"
    },
    {
      "id": "ex-2",
      "stage": "comprehensive",
      "type": "fill",
      "difficulty": "comprehensive",
      "categoryLabel": "知识迁移",
      "question": "章节末综合与迁移练习题干",
      "answer": "唯一明确的标准答案",
      "hint": "启发式解题提示：如何将新问题归约为本节所学模型",
      "explanation": "完整分步标准解析（含建模思路、中间演算与边界检验）",
      "wrongOptionsAnalysis": "常见计算或概念陷阱提示"
    }
  ],
  "reverseChecks": [
    {
      "id": "rc-1",
      "topic": "检验的核心概念或推导原理",
      "prompt": "要求学习者不看公式，用自己的语言解释该结论为何成立、适用条件是什么",
      "keyPoints": ["核对要点1：核心因果机制", "核对要点2：成立前提与失效边界"],
      "referenceExplanation": "清晰准确的标准参考解释"
    }
  ],
  "qualityCheck": {
    "coveredPoints": ["已覆盖的核心知识点列表"],
    "formulaAndUnitNote": "公式符号含义、物理量单位与正负号核对说明",
    "derivationContinuityNote": "推导思路来源与无跳步连续性说明",
    "diagramAlignmentNote": "图文同步位置与图中变量/方向标注一致性说明",
    "intermediateStepsAuditNote": "严格正确性独立复核记录：确认所有数学公式、极限、正负号、中间推理步骤、图示与练习标准答案均经独立验算，不存在『结论正确但中间推理有误』的情况"
  }
}
```

---

## 3. English Lesson User Prompt (`template: english-lesson-user-prompt`)

```text
请为英语课程《{{courseName}}》生成 **第 {{dayIndex}}/{{durationDays}} 讲（{{date}}）：{{slotTitle}}** 的语境精读与词汇闭环自学课件。

### 一、本节课程与词库上下文
- **课程目标**：{{courseGoal}}
- **词库差集与分配信息**：{{bankSummary}}
- **文章生成模式**：{{articleMode}}（{{articleModeDesc}}）
- **前后课程衔接**：前序为 {{prevCourseInfo}}；后续为 {{nextCourseInfo}}
- **补充要求**：{{extraRequirements}}
- **今日分配的目标单词（共 {{wordCount}} 词，随机不重复抽取）**：
{{wordListText}}
{{materialSection}}

---

### 二、英语自学课件编写硬性要求
1. **先思考，后讲解**：
   - 在拆解复杂长难句语法结构或辨析核心近义词之前，设置启发式思考问题，并在 `markdownBody` 对应段落直接插入 `{{heuristic:hq-1}}`、`{{heuristic:hq-2}}` 等内联锚点，提供 `hint`（提示）→ `approach`（分析思路）→ `answerReveal`（完整解析）三层引导，不得将全部思考题堆在文末。
2. **语境精读与知识点闭环（图文同步）**：
   - 围绕今日目标词汇撰写自然连贯的深度双语文章（`englishPayload.paragraphs`）。
   - 在 `markdownBody` 中按段落群展开“语境引入 → 长难句同步 SVG 句法图解（直接插入 `{{diagram:diag-1}}`） → 核心词汇意象/搭配边界/常见中式误用辨析 → 典型例句迁移 → 紧跟内联即时练习（`{{exercise:ex-1}}`，`"stage": "inline"`）”的教学闭环；篇末再安排综合练习（`"stage": "comprehensive"`）。
3. **四维练习与严格正确性检查**：
   - 练习题（不少于 4 道）覆盖**概念/词义辨析**、**直接应用**、**错误分析**及**知识迁移**，全部自带 `hint`、唯一 `answer`、`explanation` 和 `wrongOptionsAnalysis`（支持 100% 离线核对）。
   - 独立复核音标、语法成分标注、译文准确性与练习答案，记录在 `qualityCheck.intermediateStepsAuditNote` 中。

请严格返回包含 `title`, `summary`, `keyPoints`, `teachingContext`, `markdownBody`, `diagrams`, `heuristicQuestions`, `englishPayload`（含 `articleTitle`, `sourceReference`, `articleMode`, `targetWords`, `paragraphs`, `grammarAndUsageNotes`）, `exercises`, `reverseChecks`, `qualityCheck` 的合法 JSON 对象。
```
