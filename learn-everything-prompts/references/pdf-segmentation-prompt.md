# 模块 8：第 1 步 — LLM 确定 PDF 按知识点块切分区域与本地脚本切割提示词 (PDF Region Split Prompts)

本文件定义统一流程**第 1 步**的提示词模板：用户输入课程要求与教材 PDF 后，由 LLM 根据课程目标与 PDF 书签目录/页码采样，**以“较小、逻辑完整的知识点块”作为最小教学切分单元**（而非机械按章节号、固定页数或固定小节数切分），随后由应用本地脚本（`scripts/split_pdf.ts` / `pdf-lib`）执行无损 PDF 物理切割，完整保留原教材页码、公式、图示及跨区引用关系。

---

## 模板 1：API 模式 PDF 区域划分规划提示词 (`template: pdf-segment-api-prompt`)

```text
你是一名资深的教材结构分析与教学教研专家。
在用户提交课程要求和大型教材 PDF 后，你的任务（第 1 步）是：**结合课程目标与教材 PDF 的书签目录/页码采样，以“较小、逻辑完整的知识点块”为最小单元划分独立教学区域 (`regions`)**。随后本地脚本将根据你的区域页码范围无损切割 PDF，保留原教材页码、公式、图示及引用关系，供第 2 步生成课程大纲。

### 一、课程需求上下文
- **课程名称**：{{courseName}}
- **学科类别**：{{profileLabel}}（学习者水平：{{levelLabel}}）
- **学习目标**：{{courseGoal}}
- **个性化要求**：{{extraRequirements}}
- **原始 PDF 文件**：`{{sourceFileName}}`（总物理页数：{{totalPages}} 页，印刷页与物理页偏移说明：{{pageOffsetNote}}）

### 二、PDF 目录 / 书签与页码采样
{{materialTOCSample}}

---

### 三、划分原则与输出格式
1. **以“较小、逻辑完整的知识点块”为最小切分单元（拒绝机械切分）**：
   - **严禁机械按照教材大章、固定页数（如每 15 页一刀）或计划学习天数切分**。
   - **综合决定切分粒度**：结合**知识依赖、推导复杂度、例题密度与预计学时**划分边界。若某章（或某一小节）包含多个需要独立推导和大量练习的复杂知识点，必须拆分为多个较小区域；过长的单一大型知识点应按“概念/基础模型 → 核心推导/变式”合理拆分，但**绝不得在完整公式推导或连续例题解答中途截断**。
   - **优先保证单节可完整深入生成**：切分出的每个区域对应的内容体量应适合 AI 在单节课件中从直觉到推导、例题、练习完整讲透，避免贪多求大。过短的相邻基础小段可合并为一个连续块；依据学习目标无需涉及的章节可按要求跳过，但教材核心覆盖范围内的内容不得遗漏。
2. **精准页码映射与跨区引用**：同时保留原教材印刷页码（`printedStartPage` / `printedEndPage`）与换算后的 **PDF 物理页码**（1 ~ {{totalPages}}，`physicalPage = printedPage + pageOffset`），严禁页码越界或倒挂；若某区域需要引用前文公式表、定义或图示，将相关物理页码填入 `crossRefPages` 并在 `outlineMappingNote` 中说明。
3. **严格输出 JSON**：仅输出合法 JSON 代码块，包含 `pageOffset` 与 `regions` 数组（区域 ID 统一为 `region-01`, `region-02`, ...）：

```json
{
  "sourceFileName": "{{sourceFileName}}",
  "totalPages": {{totalPages}},
  "pageOffset": 0,
  "regions": [
    {
      "regionId": "region-01",
      "sectionTitle": "独立知识点块名称（如：2.1 理想运放模型与虚短虚断建立条件）",
      "printedStartPage": 1,
      "printedEndPage": 8,
      "pageOffset": 0,
      "physicalStartPage": 1,
      "physicalEndPage": 8,
      "crossRefPages": [],
      "outlineMappingNote": "涵盖的教材小节、知识依赖、核心推导/例题边界与前置引用说明"
    }
  ]
}
```
```

---

## 模板 2：Agent 模式 PDF 区域划分与切割提示词 (`template: pdf-segment-agent-prompt`)

```text
# Learn_everything（第 1 步）— Agent 按逻辑知识点块划分 PDF 区域并执行本地无损切割

你是一个具备本地文件读写与命令执行能力的 AI Agent。当前处于课程创建流程的 **第 1 步**：根据课程目标与 `sources/` 中的原始 PDF，直接以多模态方式阅读教材并**以“较小、逻辑完整的知识点块”为最小单元划分教学区域**（综合知识依赖、推导复杂度、例题数量与预计学时确定粒度；不按大章节、固定页数或固定天数机械切分，确保推导连续且不截断、单区适合单节深入展开），随后调用本地脚本完成无损切割。

### 一、课程要求与文件位置
- **课程根目录**：`{{workspaceDir}}`
- **课程配置**：`{{workspaceDir}}/course.json`
- **原始教材 PDF 路径**：`{{sourcePdfRelPath}}`（总物理页数：{{totalPages}} 页）
- **PDF 页码索引与书签文件**：`{{workspaceDir}}/sources/{{sourceFileName}}.pages.json`
- **区域划分方案输出路径**：`{{workspaceDir}}/segments/split-plan.json`
- **本地无损切割脚本**：`npx tsx scripts/split_pdf.ts "{{workspaceDir}}"`

### 二、执行步骤
1. 读取 `{{workspaceDir}}/course.json` 了解学习目标（{{courseGoal}}）与个性化要求（{{extraRequirements}}）。
2. 直接以多模态方式读取 `{{sourcePdfRelPath}}` 与 `{{workspaceDir}}/sources/{{sourceFileName}}.pages.json`，核对原教材印刷页码与 PDF 物理页码的偏移量 `pageOffset`。
3. 按知识依赖、推导复杂度与例题负荷划分粒度适中、逻辑完整的教学知识点块（不得将多个复杂推导硬塞入同一大区，亦不得破坏单一公式推导的连续性；跨区引用页填入 `crossRefPages`），写入 `{{workspaceDir}}/segments/split-plan.json`：
```json
{
  "sourceFileName": "{{sourceFileName}}",
  "totalPages": {{totalPages}},
  "pageOffset": 0,
  "regions": [
    {
      "regionId": "region-01",
      "sectionTitle": "知识点块 1 主题标题",
      "printedStartPage": 1,
      "printedEndPage": 8,
      "pageOffset": 0,
      "physicalStartPage": 1,
      "physicalEndPage": 8,
      "crossRefPages": [],
      "outlineMappingNote": "涵盖的教材章节、推导连续性边界及前置引用关系说明"
    }
  ]
}
```
4. 运行本地无损切割脚本，生成保留原页码、公式与图示的 `segments/region-XX.pdf`：
```bash
npx tsx scripts/split_pdf.ts "{{workspaceDir}}"
```
```

---

## 模板 3：Chat 模式 PDF 区域划分提示词 (`template: pdf-segment-chat-prompt`)

```text
# Learn_everything（第 1 步）— Chat 模式按知识点块划分 PDF 区域

我正在准备学习《{{courseName}}》（目标：{{courseGoal}}）。在生成课程大纲之前，请先用多模态直接阅读随附教材 PDF（文件名：`{{sourceFileName}}`，共 {{totalPages}} 物理页），按**较小、逻辑完整的知识点块**划分独立教学区域：
- **切分粒度原则**：请综合**知识依赖、推导复杂度、例题数量与预计学时**切分，而非机械按章节标题、固定页数或固定天数硬凑；避免将多个需要独立推导和大量练习的复杂知识点合在一个区域，较大知识点应在不截断推导连续性的前提下合理拆分，优先保证每个区域都能在单节中被 AI 完整深入地讲透。

### PDF 书签目录与页码参考
{{materialTOCSample}}

### 输出要求
请保留原教材印刷页码与准确换算后的 **PDF 物理页码范围（1 ~ {{totalPages}}）**，如某区引用前面章节的公式/图示请将对应物理页填入 `crossRefPages`。请只输出一个如下格式的 `json` 代码块：

```json
{
  "sourceFileName": "{{sourceFileName}}",
  "totalPages": {{totalPages}},
  "pageOffset": 0,
  "regions": [
    {
      "regionId": "region-01",
      "sectionTitle": "逻辑完整的知识点块标题",
      "printedStartPage": 1,
      "printedEndPage": 8,
      "pageOffset": 0,
      "physicalStartPage": 1,
      "physicalEndPage": 8,
      "crossRefPages": [],
      "outlineMappingNote": "涵盖的章节号、推导/例题边界与前置引用说明"
    }
  ]
}
```
```
