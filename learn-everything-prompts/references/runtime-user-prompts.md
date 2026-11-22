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
     - `circuit`（直流/交流/运放/晶体管原理图）：写清电源、R/L/C/二极管/运放/BJT/MOSFET/接地的拓扑连接，晶体管各引脚（b/c/e 或 g/d/s）所接节点，关键节点名、参数值、电压极性与电流参考方向；
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
      "options": ["A. 选项A（四项词数与细节长度大致均衡，严禁正确项明显最长）", "B. ...", "C. ...", "D. ..."],
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
   - **`circuit`**（直流/交流/RLC/二极管/运放/BJT/MOSFET 相对走向原理图，引擎自动横平竖直）：`{ "type": "circuit", "title"?: "...", "elements": [{"kind":"voltage_dc|voltage_ac|current_source|resistor|capacitor|inductor|diode|ground|wire|node|opamp|npn|pnp|nmos|pmos","id"?: "Q1","dir":"right|down|left|up","label"?: "R_1","value"?: "10kΩ","anchor"?: "n1","fromAnchor"?: "n1","toAnchor"?: "n2","currentLabel"?: "i_1","polarity"?: "+-|-+|none","length"?: 1,"route"?: "auto|hv|vh","pin"?: "b|c|e|g|d|s|in-|in+|out","flip"?: false,"depletion"?: false}] }`
     - 提示：`opamp`（若 `anchor`/`id` 为 `"u1"`）自动注册 `u1.in-`、`u1.in+`、`u1.out`（以及 `in-`、`in+`、`out`）供反馈回路与接地引用。
     - 晶体管：`npn`/`pnp`（BJT，引脚 `b`/`c`/`e`）与 `nmos`/`pmos`（默认增强型，`"depletion": true` 为耗尽型，引脚 `g`/`d`/`s`）。**必须设置 `id`**（如 `"Q1"`、`"M1"`），引擎会自动注册 `Q1.b`、`Q1.c`、`Q1.e`（或 `M1.g`、`M1.d`、`M1.s`）。默认基极/栅极落在起点（当前光标或 `fromAnchor`），从左侧进入；`"dir":"left"` 时镜像为从右侧进入。`npn`/`nmos` 默认 c/d 在上、e/s 在下，`pnp`/`pmos` 默认 e/s 在上、c/d 在下，`"flip": true` 上下翻转。`"pin":"e"` 等可指定由哪个引脚落在起点（opamp 同样支持 `in-`/`in+`/`out`）。放置后光标位于 c/d，其余支路用 `"fromAnchor":"Q1.e"` 等引出。
     - 横平竖直：每个元件只能沿 `right/down/left/up` 放置，**禁止斜线**。`toAnchor` 与起点不共线时，引擎会自动走直角折线：`route` 为 `hv` 时先水平后竖直，为 `vh` 时先竖直后水平，为 `auto` 时按 `dir` 决定；元件本体放在与 `dir` 同向的那一段上。推荐写法：反馈或旁路支路从节点竖直引出，反馈元件水平放置，最后用一根 `wire` 加 `toAnchor`（如 `"u1.out"`）闭合，无需手算长度。三条及以上支路交汇处会自动画节点圆点。
   - **回退使用“自由图表（`svgCode`）”**：**仅当上述 5 类结构化图表均不符合本图课件表达需求时**（例如：三维几何体与曲面、任意角度受力分析与滑轮/斜面机械图、光学反射折射光路、物理化学实验装置与分子结构、半导体器件物理剖面、或超出 `circuit` 内置 15 种元件（含 BJT/MOSFET）的复杂专用器件电路（如 JFET、晶闸管、变压器、多发射极晶体管）），才省略 `diagramSpec` 并退回输出适配深色背景高对比的原生自由 SVG 填入 `"svgCode"`（`<svg viewBox="0 0 680 320" xmlns="http://www.w3.org/2000/svg">...</svg>`，文字安全边距 `>= 18px`，长标注用 `<tspan>` 换行，不用 `$` 宏）。
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
      "options": ["A. 选项A（四项词数与细节长度大致均衡，严禁正确项明显最长）", "B. ...", "C. ...", "D. ..."],
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
请为语言课程《{{courseName}}》生成 **第 {{dayIndex}} 节（小节 ID：`{{sectionId}}`）：{{slotTitle}}** 的英语精读课件。

### 一、本节主题、检索窗口与学习配置
- **课程目标**：{{courseGoal}}
- **本节主题与话题范围**：{{topicThemeInfo}}
- **本节学习目标**：{{slotObjective}}
- **学习者水平与目的**：{{learnerProfile}}｜{{learningPurpose}}
- **文章获取三级优先级（`{{oneMonthAgoDate}}` ~ `{{currentDate}}`）**：
  1. **首选 `authentic_article`**：找到最近一个月内真实英文原文，尽量保留原文主体结构与内容，仅作自然微调融入本节目标词；若搜到的单篇文章过短，可在一节课件中组合放入两篇同主题近期短文章（保留两篇来源、标题、发布日期与链接）；
  2. **次选 `adapted_article`**：若无法直接展示完整原文或微调难以自然覆盖目标词，则严格根据检索到的近期真实原文内容自己重写完整文章并自然加入目标词汇（保留参考原文的来源、标题、发布日期与链接，并在 `originNote` 注明改写）；
  3. **兜底 `ai_original`**：仅当确实检索不到合适原文（或无联网能力）时，基于近期可靠信息纯 AI 编写完整文章（`sourceUrl` 留空，严禁虚构链接）。
- **偏好信源参考**：{{preferredSources}}
- **内容模式与篇幅参考**：{{articleModeDesc}}｜{{readingLengthHint}}
- **前后衔接**：前序 {{prevCourseInfo}}；后续 {{nextCourseInfo}}
- **补充要求**：{{extraRequirements}}
{{targetWordsSection}}
{{prevSectionReviewInfo}}
{{earlierReviewInfo}}
{{materialSection}}

### 二、内容组织与 JSON 格式规范
请严格遵循 **先阅读、后讲解、再练习**，仅输出一个合法 JSON 对象（一次完成终稿，设 `"generationStage": "complete"`，`"diagrams": []`）：
```json
{
  "sectionId": "{{sectionId}}",
  "generationStage": "complete",
  "title": "{{slotTitle}}",
  "summary": "1~2 句话概括文章主题、语言难点与本节学习收获",
  "keyPoints": ["核心阅读能力或表达要点1", "要点2"],
  "teachingContext": {
    "prerequisites": ["已学前序主题/基础语境"],
    "learningObjectives": ["{{slotObjective}}"],
    "teachingScope": "{{topicThemeInfo}}",
    "connectionNote": "与前后节的主题及复习词衔接说明"
  },
  "englishPayload": {
    "articleTitle": "完整英文文章标题",
    "contentOrigin": "authentic_article | adapted_article | ai_original",
    "sourceReference": "来源媒体或参考原文刊物（无原文时写「AI 原创（基于近期公开信息）」）",
    "publishDate": "YYYY-MM-DD（原文发布日期或创作基准日期）",
    "sourceUrl": "真实/参考原文链接 https://...（仅 ai_original 时留空字符串 \"\"，严禁编造 URL）",
    "originNote": "注明：真实原文（微调融入词汇）/ 基于近期真实原文改写并加入词汇 / 纯 AI 原创（未能检索到可用原文）",
    "articleMode": "{{articleMode}}",
    "targetWords": [
      {
        "id": "w-001",
        "word": "词条原型（与正文用词匹配，支持弹窗点选释义）",
        "phonetic": "/.../",
        "meaning": "贴合本文语境的中文释义",
        "usageNote": "精炼点明熟词生义、语气色彩或近义词区别（可选）",
        "collocations": ["常用搭配1", "常用搭配2"],
        "example": "选自或仿照新语境的地道英文例句",
        "exampleTranslation": "例句中文翻译",
        "isReview": false
      }
    ],
    "paragraphs": [
      {
        "english": "完整英文正文段落（自然地道，不机械堆砌单词；若课程配有词库，除词库词汇以外的其余用词难度应小于等于词库中的词汇；自然出现前一节或前序生词以供跨文章复习）",
        "chinese": "对应段落的流畅中文译文"
      }
    ],
    "grammarAndUsageNotes": ""
  },
  "markdownBody": "## 词汇用法精讲\n精选正文中有学习价值的重点生词，精炼讲解语境词义、固定搭配、熟词生义、近义词区别与常见用法（不必逐词重复）；若有前一节复现词点明其在新语境下的用法。\n\n## 长难句解析\n选取文章中 1～3 个最具代表性的复杂句，使用 `{{quote:P<段落号>:S<句号>}}`（如 `{{quote:P1:S2}}`）直接引用原文句子并清晰拆解关键语法结构（如主干、从句、非谓语/倒装等）与准确句意，确保原文修改时精讲同步。",
  "exercises": [
    {
      "id": "ex-1",
      "stage": "comprehensive",
      "type": "choice",
      "difficulty": "application",
      "categoryLabel": "阅读理解·主旨概括（可选：细节理解 / 逻辑推断 / 作者观点）",
      "question": "需基于全篇理解、推断或观点辨析作答的题目（3～5 题，避免原文照抄）",
      "options": ["A. 选项A（四项词数与细节长度大致均衡，严禁正确项明显最长）", "B. ...", "C. ...", "D. ..."],
      "answer": "B",
      "explanation": "清晰解析为何该项符合文章逻辑与作者意图，并简述主要干扰项偏差"
    },
    {
      "id": "ex-2",
      "stage": "comprehensive",
      "type": "choice | fill",
      "difficulty": "application",
      "categoryLabel": "词汇练习·语境选词（可选：搭配辨析 / 句子改写）",
      "question": "脱离原文的新语境选词、搭配辨析或句子改写题（2～4 题，可复现前一节词汇）",
      "options": ["A. 选项A（四项词数与细节长度大致均衡，严禁正确项明显最长）", "B. ...", "C. ...", "D. ..."],
      "answer": "正确答案（choice 填选项字母如 A；fill 填标准单词或完整改写参考句）",
      "explanation": "解析语境线索、固定搭配或语法改写要点"
    }
  ],
  "diagrams": [],
  "heuristicQuestions": [],
  "reverseChecks": []
}
```
注意：`markdownBody` 与中文译文中若涉及美元等货币金额请写作「100 美元」或 `USD 100`，避免在同一段落中成对出现 `$` 符号误触发公式解析。
````
