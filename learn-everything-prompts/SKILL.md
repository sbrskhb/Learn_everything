---
name: learn-everything-prompts
description: Configurable, self-study oriented courseware generation prompt system for the Learn_everything local Web learning application. Use whenever generating or refining multi-day study plans, STEM/Math/Physics/Electronics/General daily courseware, or English vocabulary set-difference reading lessons across API, Agent, and Chat modes.
---

# Learn_everything — 课件生成提示词系统 (Skill Specification)

本 Skill 是 **Learn_everything** 课件生成提示词的唯一真实来源（Single Source of Truth）。所有教学提示词模板、可配置模块、学科适配规则与输出结构契约均维护在本目录中，应用程序通过读取本 Skill 目录下的文件进行组合与调用，保证 **API、Agent、Chat 三种生成模式的教学规范与数据结构完全一致**。

---

## 一、核心目标：以小节为独立教学单元的自主学习与纠错闭环

课件的目标不是罗列定义或堆砌篇幅，而是**引导学习者逐步思考、理解、练习、诊断、补救并独立掌握知识**。每小节课件必须围绕以下机制组织：

1. **7 步自主学习反馈闭环**：
   - 每个核心知识点内部遵循“**问题引入 → 独立思考 (`{{heuristic:hq-X}}`) → 分层讲解（含 `> [!PREREQ]` / `> [!INTUITION]` / `> [!TEXTBOOK]` / `> [!EXTENSION]` 深色提示框与 `{{diagram:diag-X}}`） → 即时练习 (`{{exercise:ex-X}}`) → 错误诊断 (`wrongOptionsAnalysis`) → 针对性补救 (`remediation`) → 变式检验 (`variantCheck`)**”，支持完全离线自学与纠错。
2. **先修知识精准适配**：
   - 根据学习者已掌握基础与目标深度，在 `teachingContext.prerequisiteCheck` 提供简短先修诊断，对必要但未确认掌握的前提在 `> [!PREREQ]` 框中精准补充，避免重复讲解已掌握内容。
3. **图文前置规格与深色模式可读性**：
   - 先在 `topologySpec` 确定电路拓扑/节点连接/元件参数/参考方向（或几何坐标系与状态流转），再生成深色高对比 SVG，校验与正文公式的一致性；复杂题设配专属 SVG（`diagramId`）。
4. **单小节 6 阶段构造与局部修复**：
   - 按“① 教学规划 → ② 正文与推导 → ③ 练习与补救反馈 → ④ 图示与拓扑规范 → ⑤ 质量核验 → ⑥ JSON 组装”分阶段把控质量，支持通过增量补丁对局部阶段重试修复。

---

## 二、提示词文件结构与按需组合说明 (`references/`)

| 模块文件 | 用途 | 适用阶段 |
| :--- | :--- | :--- |
| `references/core-pedagogy-modules.md` | 核心教学机制（先思考后讲解、知识点闭环、图文同步、迁移能力、严格中间步骤复核、简洁规范表达）及学习者水平适配模块 | 所有课件生成的公共可配置底座 |
| `references/pdf-segmentation-prompt.md` | 阶段 1：结合课程要求与 PDF 书签目录/页码摘要，由 LLM 确定划分区域 (`regions`)，供本地脚本切割小节 PDF | 阶段 1：PDF 区域划分与脚本切割 (`split-plan.json`) |
| `references/syllabus-planning-prompt.md` | 阶段 2：基于课程要求与第 1 步划分/切割的教材区域，生成知识点目录与完整课程大纲并绑定 `regionId` | 阶段 2：生成完整课程目录 (`outline.json`) |
| `references/stem-courseware-prompt.md` | 数学、物理、电子技术与工科课程的学科适配规则、内联图文同步、连续推导与输出契约 | 阶段 3：理工科小节课件生成 |
| `references/general-courseware-prompt.md` | 通用专业课程、人文社科与计算机课程的学科适配规则与输出契约 | 阶段 3：通用与计算机小节课件生成 |
| `references/english-reading-prompt.md` | 英语词库差集本节词汇、自然语境阅读、内联句法思考、词义辨析与分层练习 | 阶段 3：英语小节课件生成 |
| `references/runtime-user-prompts.md` | API 自动生成模式的运行时 User Prompt 模板 | API 自动生成模式 |
| `references/agent-mode-prompt.md` | 面向 Antigravity、Codex 等 AI Agent 的区域划分、大纲生成与逐节课件生成执行提示词模板 | Agent 课件模式 |
| `references/chat-mode-prompt.md` | 面向 ChatGPT、Gemini 等对话式 AI 的区域划分、课程目录与单节课件提示词模板 | Chat 课件模式 |

---

## 三、动态组合与工作流（规划与生成解耦）

1. **第 1 步：按小节切分 PDF (`segments/split-plan.json`)**：加载 `references/pdf-segmentation-prompt.md`，按教材章节、知识边界与先修关系切分独立教学单元（允许合并过短/拆分过长小节，保留原页码、公式、图示与 `crossRefPages`），再由本地脚本（`scripts/split_pdf.ts`）无损切出 `segments/region-XX.pdf`。
2. **第 2 步：全课程大纲生成 (`outline.json`)**：加载 `references/syllabus-planning-prompt.md`，生成不受目标天数限制的知识结构 `knowledgeCatalog` 与独立教学小节 `sections`（大纲阶段专注知识划分与先修关系，不在此步骤预估学习时长）。
3. **第 3 步：逐小节独立生成课件并评估学习时长 (`lessons/sec-XX.json`)**：每次聚焦 1 个独立小节（第 3 步提示词不含任何日历日期或排程天数），动态组合 `core-pedagogy-modules.md` + 学科规范 + 学习者配置，输出 7 步自主闭环与深色模式分类标注课件；在写完本节具体正文、推导、图示与练习后，评估并输出 `estimatedMinutes`（支持按阶段局部重试与补丁修复）。
4. **第 4 步：代码确定性分配学习天数**：应用本地算法（`allocateSectionsToDays`）根据各小节实际课件的 `estimatedMinutes` 将小节均衡分配至目标学习天数（支持修改学习天数后立即重算日程，无需重新生成课件）。
