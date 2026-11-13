---
name: learn-everything-prompts
description: Configurable, self-study oriented courseware generation prompt system for the Learn_everything local Web learning application. Use whenever generating or refining multi-day study plans, STEM/Math/Physics/Electronics/General daily courseware, or English vocabulary set-difference reading lessons across API, Agent, and Chat modes.
---

# Learn_everything — 课件生成提示词系统 (Skill Specification)

本 Skill 是 **Learn_everything** 课件生成提示词的唯一真实来源（Single Source of Truth）。所有教学提示词模板、可配置模块、学科适配规则与输出结构契约均维护在本目录中，应用程序通过读取本 Skill 目录下的文件进行组合与调用，保证 **API、Agent、Chat 三种生成模式的教学规范与数据结构完全一致**。

---

## 一、核心目标：从“电子讲义”升级为“引导式独立自学材料”

课件的目标不是罗列定义或堆砌篇幅，而是**引导学习者逐步思考、理解、练习并独立掌握知识**。每节课件必须围绕以下四项教学机制组织：

1. **先思考，后讲解（嵌入式渐进启发）**：
   - 在关键概念、公式推导转折处和例题关键步骤前设置启发式思考问题（通过 `{{heuristic:hq-X}}` 内联嵌入正文对应位置，**严禁将全部思考题集中堆放在课件末尾**）。
   - 采用“**提出问题 → 启发提示 (`hint`) → 分析思路 (`approach`) → 完整推导与解释 (`answerReveal`)**”的渐进揭示结构，引导学习者先独立动脑，再对照讲解。
2. **每个核心知识点形成完整闭环**：
   - 单节课程合理控制认知负荷（聚焦 1~3 个紧密关联的核心知识点），每个核心知识点内部遵循“**实际问题引入 → 直观解释（配同步图示 `{{diagram:diag-X}}`） → 严格定义 → 原理推导与思路来源 → 典型例题 → 即时练习 (`{{exercise:ex-X}}`)**”的教学闭环，**避免连续讲解大量理论后才在文末集中安排练习**。
   - 根据学科特点与具体内容灵活命制标题，不机械套用完全相同的固定标题。
3. **图文同步、强化迁移与严格正确性复核**：
   - **图文同步参与教学**：几何关系、物理结构、电路原理、状态流转等在首次讲解时即通过 `{{diagram:diag-X}}` 原地嵌入图示（**不得将图集中堆放在课件末尾**），图中明确标注关键变量、方向和状态，必要时采用分阶段图示解释变化过程。
   - **强化迁移能力**：不仅解释结论本身，还必须讲清**推导思路的来源（为什么会想到这样做）、成立前提与适用条件、常见误区及面对新问题时的分析方法**。
   - **严格正确性检查**：独立复核数学公式、极限、正负号、积分上下限、量纲单位、推导步骤、图示标注和练习答案，**重点排查“最终结论正确但中间推理存在错误或条件偷换”的情况**。
4. **分层练习与 100% 离线自主检验**：
   - **知识点后即时练习 (`stage: "inline"`) + 章节末综合练习 (`stage: "comprehensive"`)**：覆盖**概念辨析、直接应用、错误分析、知识迁移**四类维度。
   - 所有练习均附带**启发式提示 (`hint`)、唯一标准答案 (`answer`)、可展开的完整解析 (`explanation`) 与错误选项/误区分析 (`wrongOptionsAnalysis`)**，配合章节末的**反向解释检验 (`reverseChecks`)**，无需实时调用 LLM 即可离线完成全部自测。

---

## 二、提示词文件结构与按需组合说明 (`references/`)

| 模块文件 | 用途 | 适用阶段 |
| :--- | :--- | :--- |
| `references/core-pedagogy-modules.md` | 核心教学机制（先思考后讲解、知识点闭环、图文同步、迁移能力、严格中间步骤复核、简洁规范表达）及学习者水平适配模块 | 所有课件生成的公共可配置底座 |
| `references/pdf-segmentation-prompt.md` | 阶段 1：结合课程要求与 PDF 书签目录/页码摘要，由 LLM 确定划分区域 (`regions`)，供本地脚本切割小节 PDF | 阶段 1：PDF 区域划分与脚本切割 (`split-plan.json`) |
| `references/syllabus-planning-prompt.md` | 阶段 2：基于课程要求与第 1 步划分/切割的教材区域，生成知识点目录与完整课程大纲并绑定 `regionId` | 阶段 2：生成完整课程目录 (`outline.json`) |
| `references/stem-courseware-prompt.md` | 数学、物理、电子技术与工科课程的学科适配规则、内联图文同步、连续推导与输出契约 | 阶段 3：理工科每日课件生成 |
| `references/general-courseware-prompt.md` | 通用专业课程、人文社科与计算机课程的学科适配规则与输出契约 | 阶段 3：通用与计算机每日课件生成 |
| `references/english-reading-prompt.md` | 英语词库差集每日词汇、自然语境阅读、内联句法思考、词义辨析与分层练习 | 阶段 3：英语每日课件生成 |
| `references/runtime-user-prompts.md` | API 自动生成模式的运行时 User Prompt 模板 | API 自动生成模式 |
| `references/agent-mode-prompt.md` | 面向 Antigravity、Codex 等 AI Agent 的区域划分、大纲生成与逐节课件生成执行提示词模板 | Agent 课件模式 |
| `references/chat-mode-prompt.md` | 面向 ChatGPT、Gemini 等对话式 AI 的区域划分、课程目录与单节课件提示词模板 | Chat 课件模式 |

---

## 三、动态组合与验证

1. **第 1 步：确定划分区域与本地脚本切割 (`segments/split-plan.json`)**：加载 `references/pdf-segmentation-prompt.md`，结合课程要求与 PDF 书签目录/页码摘要由 LLM 确定 `region-01`..`region-NN` 页码范围，再由本地脚本（`scripts/split_pdf.ts`）无损切出 `segments/region-XX.pdf` 与干净的 `segments/region-XX.txt`。
2. **第 2 步：LLM 生成完整课程目录 (`outline.json`)**：加载 `references/syllabus-planning-prompt.md`，结合课程要求与第 1 步切分出的教材区域，规划单节知识点容量（1~3 个核心知识点）并绑定 `regionId`，预览确认目录。
3. **第 3 步：LLM 逐节生成课件 (`lessons/sec-XX.json`)**：
   - 从 `references/core-pedagogy-modules.md` 组合教学要求与学习者水平（初学者 / 教材同步 / 进阶深入）；
   - 根据学科加载 `references/stem-courseware-prompt.md`、`references/general-courseware-prompt.md` 或 `references/english-reading-prompt.md`；
   - 在 `markdownBody` 正文中通过 `{{heuristic:hq-1}}`、`{{diagram:diag-1}}`、`{{exercise:ex-1}}` 将启发式思考、SVG 图示和即时练习原位嵌入每个核心知识点的讲解闭环中。
