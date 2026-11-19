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
请为课程《{{courseName}}》生成 **第 {{dayIndex}} 节（小节 ID：`{{sectionId}}`）：{{slotTitle}}** 的**阶段一课件（完整教学内容 + 图表描述规格，不生成图表代码）**。

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

讲解例题、自测和练习必须按教材考点改编。重新组织题干，并至少改变数值、条件、所求量或情境之一，重新校验答案。定义、定理、通用公式和标准证明保持准确。
1. **阶段一专注教学质量与精确图表描述规格**：
   - 完整生成正文推导（使用 `> [!PREREQ]` / `> [!INTUITION]` / `> [!TEXTBOOK]` / `> [!EXTENSION]`，原位嵌入 `{{heuristic:hq-X}}`、`{{diagram:diag-X}}`、`{{exercise:ex-X}}` 唯一锚点）、符号表 `symbolGlossary`、启发思考题 `heuristicQuestions`、练习题 `exercises`（以及按教学价值选择性配置的 `wrongOptionsAnalysis`、`remediation`、`variantCheck`、`reverseChecks`）。
   - **禁止在本阶段输出 `diagramSpec` 图表代码或 `<svg>` 源码**：凡正文或题目需要配图之处，请在 `diagrams` 中声明条目并写出详尽的 `topologySpec` 与 `caption`，留空或省略 `diagramSpec` 与 `svgCode`（练习题配图请在题中写明 `diagramId` 并在 `diagrams` 中定义对应 `id` 与 `topologySpec`）。图表代码将在阶段二依据此规格专项生成并自动合并。
   - **如何填写高质量 `topologySpec`（供阶段二无 PDF 精确绘图）**：请在开头注明推荐图表类别 `[推荐类型: grid-annot | plot2d | graph | wavedrom | circuit | 自由图表(svgCode)]`，并写齐所需关键要素：
     - `grid-annot`（行列式/矩阵/卡诺图/内存/DP表）：写清矩阵内容、行列标题、brackets 形式（`matrix`/`det`）、需高亮/圈选的格子坐标及对角线/箭头流向；
     - `plot2d`（函数/切线/定积分/概率密度/伏安特性）：写清函数数学关系、自变量/因变量区间 `[min, max]`、积分阴影边界、关键特征点与参考虚线；
     - `graph`（流程图/树图/状态机 FSM/自控框图）：写清布局方向（`LR`/`TB`）、全部节点标签/形状及有向边标注；
     - `wavedrom`（数字时序波形/寄存器位域）：写清周期拍数、各信号变化规律或各字段比特位宽/名称；
     - `circuit`（直流/交流/运放原理图）：写清电源、R/L/C/二极管/运放/接地的拓扑连接、关键节点名、参数值、电压极性与电流参考方向；
     - `自由图表(svgCode)`：仅当上述 5 类均无法表达本图需求时（如 3D 几何、任意角度受力/斜面滑轮、光路、实验装置/器件物理剖面或复杂专用电路）选用，并写清坐标系、几何构型、微元/矢量箭头与标注文本。
2. **格式与转义规则**：
   - 仅输出合法 JSON；JSON 字符串内的 LaTeX 反斜杠必须双写为 `\\`（如 `\\frac`、`\\text`）；`\text{...}` 内禁止裸下划线；文内引用图号直接写 `图 diag-1`（不加反引号）。

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
      "topologySpec": "[推荐类型: circuit] 节点连接(Vin经R1接反相端N-，Rf跨接N-与Vo，同相端N+接地)、元件参数(R1=10kΩ, Rf=100kΩ)、电流方向(i1流入N-，iF从N-流向Vo)、极性与坐标说明（阶段一不输出 diagramSpec 或 svgCode）",
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
      "topologySpec": "[推荐类型: plot2d] 若本题需要专属配图，写明推荐图表类型及具体连接/函数/坐标规格并确保 diagrams 中有对应 diag-ex-1（无需配图则省略）",
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
  ]
}
```
````

---

## 3. Stage 2 Prompt — Diagrams Generation from Stage 1 Specs (`template: lesson-stage2-diagrams-prompt`)

````text
请为课程《{{courseName}}》第 {{dayIndex}} 节《{{slotTitle}}》（小节 ID：`{{sectionId}}`）执行**阶段二：仅根据阶段一已确认的图示描述规格生成图表代码（优先 5 类结构化 `diagramSpec`，均不符合需求时再回退自由图表 `svgCode`）**。

### 严格职责限制（严禁重写完整课件）
1. **只输出图表 JSON**：严禁重新生成、改写或输出 `markdownBody`、`exercises`、`heuristicQuestions` 等阶段一已有内容（前端/程序将按图号 `id` 自动与阶段一教学内容合并）。
2. **无需教材原文 PDF**：阶段一已完成建模与符号对齐。请严格依据下方每项图示的 `id`、`topologySpec`、`caption` 及上下文片段，在 **`diagramSpec`（优先）** 与 **`svgCode`（自由图表兜底）** 之间**二选一**输出（每幅图仅需填写其一）。
3. **图表选型优先级（5 类结构化 `diagramSpec` 优先 → 自由图表 `svgCode` 兜底）**：
   - **`grid-annot`**（矩阵、行列式沙路法、卡诺图圈选、内存数组、DP 状态表；`row`/`col` 从 `0` 开始）：`{ "type": "grid-annot", "title"?: "...", "cells": [["a_{11}","a_{12}"],...], "brackets"?: "none|matrix|det|box", "rowHeaders"?: [], "colHeaders"?: [], "highlights"?: [{"row":0,"col":0,"tone":"accent|positive|negative|warn|purple"}], "boxes"?: [{"from":[r1,c1],"to":[r2,c2],"tone":"positive","label":"...","dashed":false}], "arrows"?: [{"from":[r1,c1],"to":[r2,c2],"label":"...","dashed":false,"curve":14}], "diagonals"?: [{"cells":[[0,0],[1,1],[2,2]],"tone":"positive","label":"+","dashed":false}], "notes"?: ["..."] }`
   - **`plot2d`**（函数图像、切线、定积分阴影、概率密度、伏安特性、供需曲线）：`{ "type": "plot2d", "title"?: "...", "xRange": [-4,4], "yRange"?: [-2,6], "xLabel"?: "x", "yLabel"?: "y", "functions": [{"expr":"x^2","label":"y=x^2","tone":"accent","style":"solid|dashed|dotted"}], "shadedRegions"?: [{"expr":"x^2","expr2"?: "0","from":0,"to":2,"tone":"positive","label":"S"}], "points"?: [{"x":1,"y":1,"label":"(1,1)","showProjections":true}], "vlines"?: [{"x":2,"label":"x=2"}], "hlines"?: [{"y":1,"label":"y=1"}] }`
     - **表达式规则**：`expr`/`expr2` 必须写标准安全数学表达式（如 `x^2`、`2*x+1`、`sin(x)`、`cos(x)`、`exp(-x)`、`sqrt(x)`、`abs(x)`、`1/x`、`pi`、`e`），**严禁写入 LaTeX 反斜杠命令**（如 `\frac`、`\sin`）。
   - **`graph`**（流程图、FSM 状态机、二叉树/图、自控系统框图、架构图）：`{ "type": "graph", "title"?: "...", "direction": "LR|TB|RL|BT", "nodes": [{"id":"n1","label":"...","subLabel"?: "...","shape":"rect|round|circle|diamond|pill|sum","tone":"default|accent|positive|negative|warn|purple"}], "edges": [{"from":"n1","to":"n2","label"?: "...","style":"solid|dashed|dotted","tone":"default","bidirectional"?: false}] }`
   - **`wavedrom`**（数电时序波形、通信协议时序、芯片寄存器位域）：`{ "type": "wavedrom", "title"?: "...", "signal": [{"name":"CLK","wave":"p...."}], "head"?: {"text":"...","tick":0}, "foot"?: {"tock":1} }` 或 `{ "type": "wavedrom", "title"?: "...", "reg": [{"name":"MODE","bits":4,"attr":"RW"}] }`（`signal` 与 `reg` 必须二选一且非空）。
   - **`circuit`**（直流/交流/RLC/二极管/运算放大器相对走向原理图）：`{ "type": "circuit", "title"?: "...", "elements": [{"kind":"voltage_dc|voltage_ac|current_source|resistor|capacitor|inductor|diode|ground|wire|node|opamp","dir":"right|down|left|up","label"?: "R_1","value"?: "10kΩ","anchor"?: "n1","fromAnchor"?: "n1","toAnchor"?: "n2","currentLabel"?: "i_1","polarity"?: "+-|-+|none","length"?: 1}] }`
     - 提示：`opamp`（若 `anchor`/`id` 为 `"u1"`）自动注册 `u1.in-`、`u1.in+`、`u1.out`（以及 `in-`、`in+`、`out`）供反馈回路与接地引用。
   - **回退使用“自由图表（`svgCode`）”**：**仅当上述 5 类结构化图表均不符合本图课件表达需求时**（例如：三维几何体与曲面、任意角度受力分析与滑轮/斜面机械图、光学反射折射光路、物理化学实验装置与分子结构、半导体器件物理剖面、或超出 `circuit` 内置 11 种基础元件的复杂专用器件电路），才省略 `diagramSpec` 并退回输出适配深色背景高对比的原生自由 SVG 填入 `"svgCode"`（`<svg viewBox="0 0 680 320" xmlns="http://www.w3.org/2000/svg">...</svg>`，文字安全边距 `>= 18px`，长标注用 `<tspan>` 换行，不用 `$` 宏）。
   - 输出合法 JSON，注意双引号按 `\"` 正确转义。

### 待生成图示规格列表（共 {{specCount}} 幅）
{{diagramSpecsJson}}

### 请仅输出以下紧凑 JSON（每项在 `diagramSpec` 与 `svgCode` 中二选一）
```json
{
  "diagrams": [
    {
      "id": "必须与上方规格中的 id 严格一致（如 diag-1）",
      "title": "沿用或微调图示标题",
      "caption": "沿用或微调图注说明",
      "diagramSpec": {
        "type": "circuit",
        "elements": [
          { "kind": "resistor", "dir": "right", "label": "R_1", "anchor": "N-" }
        ]
      }
    }
  ]
}
```
注：若某幅图确实无法用 5 类 `diagramSpec` 表达，请在该项中删除 `"diagramSpec"` 并改填 `"svgCode": "<svg viewBox=\"0 0 680 320\" xmlns=\"http://www.w3.org/2000/svg\">...</svg>"`。
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

讲解例题、自测和练习必须按教材考点改编。重新组织题干，并至少改变数值、条件、所求量或情境之一，重新校验答案。定义、定理、通用公式和标准证明保持准确。
1. 请将“教学内容组织”严格按系统规范执行：先修诊断 `prerequisiteCheck`、深色分类块（`[!PREREQ]` / `[!INTUITION]` / `[!TEXTBOOK]` / `[!EXTENSION]`）、内联锚点 `{{heuristic:hq-X}}` / `{{diagram:diag-X}}` / `{{exercise:ex-X}}`、`symbolGlossary`，并按教学价值选择性补充 `wrongOptionsAnalysis`、`remediation`、`variantCheck`、`reverseChecks`。
2. 凡涉及图示（含题目配图 `diagramId`），先在 `"topologySpec"` 注明推荐图表类型与完整连接/参数/坐标边界，再**优先输出零坐标结构化 `"diagramSpec"`**（支持 `grid-annot`、`plot2d`、`graph`、`wavedrom`、`circuit`），**仅当上述 5 类均不符合需求时**再省略 `diagramSpec` 并回退提供深色高对比自由图表 `"svgCode"`（`<svg viewBox="0 0 680 320" ...>...</svg>`，两者二选一）。
3. 仅输出合法 JSON；JSON 字符串中的 LaTeX 反斜杠须双写为 `\\`；`\text{...}` 内禁写裸下划线。

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
      "topologySpec": "[推荐类型: grid-annot | plot2d | graph | wavedrom | circuit | 自由图表(svgCode)] 节点连接、元件参数、参考方向、极性及坐标系边界",
      "caption": "图示与正文对照说明",
      "diagramSpec": {
        "type": "grid-annot | plot2d | graph | wavedrom | circuit"
      },
      "svgCode": "可选兜底（二选一）：仅当 5 类 diagramSpec 均不符合需求时省略 diagramSpec 并填写手写自由图表 <svg ...>...</svg>"
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
  ]
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

讲解例题、自测和练习必须按教材考点改编。重新组织题干，并至少改变数值、条件、所求量或情境之一，重新校验答案。定义、定理、通用公式和标准证明保持准确。
- 输出包含 `title`, `summary`, `keyPoints`, `teachingContext`（含 `prerequisiteCheck`）, `markdownBody`（结合 `[!PREREQ]` / `[!TEXTBOOK]` / `[!INTUITION]` / `[!EXTENSION]` 及 `{{heuristic:hq-X}}`、`{{exercise:ex-X}}`）, `diagrams`（如含句法分析图，先写 `topologySpec`）, `heuristicQuestions`, `englishPayload`（`articleTitle`, `sourceReference`, `articleMode`, `targetWords`, `paragraphs`, `grammarAndUsageNotes`）, `exercises`（含必需 `answer`，按教学价值选填 `hint`/`explanation`/`wrongOptionsAnalysis`/`remediation`/`variantCheck`）, `reverseChecks`（按需选填）的合法 JSON 对象。
````
