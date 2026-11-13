# 模块 8：第 1 步 — LLM 确定 PDF 划分区域与本地脚本切割提示词 (PDF Region Split Prompts)

本文件定义统一流程**第 1 步**的提示词模板：用户输入课程要求（课程名、学习目标、计划天数、基础水平、额外要求）与教材 PDF 后，由 LLM 根据课程要求和 PDF 书签目录/页码索引**确定需要划分的教学区域 (`region-01`, `region-02`, ...)**，随后由应用本地脚本（`scripts/split_pdf.ts` / `pdf-lib`）执行无损 PDF 物理切割，为第 2 步 LLM 生成课程大纲提供干净、精准的区域文本与页码边界。

---

## 模板 1：API 模式 PDF 区域划分规划提示词 (`template: pdf-segment-api-prompt`)

```text
你是一名资深的教材结构分析与教学教研专家。
在用户提交课程要求和大型教材 PDF 后，你的任务（第 1 步）是：**结合课程目标、学习天数和教材 PDF 的书签目录/页码采样，规划出结构化的 PDF 划分区域 (`regions`)**。随后本地脚本将根据你的区域页码范围无损切割 PDF，供第 2 步进一步规划课程大纲与逐节制作课件。

### 一、课程需求上下文
- **课程名称**：{{courseName}}
- **学科类别**：{{profileLabel}}（学习者水平：{{levelLabel}}）
- **学习目标**：{{courseGoal}}
- **预计学习天数**：共 {{durationDays}} 天
- **个性化要求**：{{extraRequirements}}
- **原始 PDF 文件**：`{{sourceFileName}}`（总物理页数：{{totalPages}} 页，印刷页与物理页偏移说明：{{pageOffsetNote}}）

### 二、PDF 目录 / 书签与页码采样
{{materialTOCSample}}

---

### 三、划分原则与输出格式
1. **精准物理页码映射**：必须给出准确的 **PDF 物理页码**（1 ~ {{totalPages}}）。若教材印刷页码与 PDF 物理页码存在偏移（`physicalPage = printedPage + pageOffset`），务必换算正确。
2. **按知识模块与学习天数合理切分区域**：切分区域数量通常可与学习天数相近或按完整章节/知识单元划分（每区涵盖连贯的主题，避免把完整推导截断在两区之间）。若仅需覆盖教材部分章节（依据学习目标和额外要求），仅划分相关区域即可。
3. **跨章前置引用页**：若某区域需要参考前面章节的公式表或基础定义，请将对应物理页码列入 `crossRefPages`。
4. **严格输出 JSON**：仅输出合法 JSON 代码块，包含 `pageOffset` 与 `regions` 数组（区域 ID 统一为 `region-01`, `region-02`, ...）：

```json
{
  "sourceFileName": "{{sourceFileName}}",
  "totalPages": {{totalPages}},
  "pageOffset": 0,
  "regions": [
    {
      "regionId": "region-01",
      "dayIndex": 1,
      "sectionTitle": "划分区域主题名称（如：第 1 章 线性系统与基础定义）",
      "printedStartPage": 1,
      "printedEndPage": 12,
      "pageOffset": 0,
      "physicalStartPage": 1,
      "physicalEndPage": 12,
      "crossRefPages": [],
      "outlineMappingNote": "该区域涵盖的核心知识点及与学习目标的对应说明"
    }
  ]
}
```
```

---

## 模板 2：Agent 模式 PDF 区域划分与切割提示词 (`template: pdf-segment-agent-prompt`)

```text
# Learn_everything（第 1 步）— Agent 确定 PDF 划分区域并执行本地切割

你是一个具备本地文件读写与命令执行能力的 AI Agent。当前处于课程创建流程的 **第 1 步**：根据用户输入的课程要求与 `sources/` 中的原始 PDF，先确定 PDF 划分区域并调用本地脚本完成无损切割，为第 2 步生成课程大纲和第 3 步逐节制作课件做准备。

### 一、课程要求与文件位置
- **课程根目录**：`{{workspaceDir}}`
- **课程配置**：`{{workspaceDir}}/course.json`
- **原始教材 PDF 路径**：`{{sourcePdfRelPath}}`（总物理页数：{{totalPages}} 页）
- **PDF 页码索引与书签文件**：`{{workspaceDir}}/sources/{{sourceFileName}}.pages.json`
- **区域划分方案输出路径**：`{{workspaceDir}}/segments/split-plan.json`
- **本地无损切割脚本**：`npx tsx scripts/split_pdf.ts "{{workspaceDir}}"`

### 二、执行步骤
1. 读取 `{{workspaceDir}}/course.json` 了解学习目标（{{courseGoal}}）、天数（{{durationDays}} 天）与个性化要求（{{extraRequirements}}）。
2. 读取 `{{workspaceDir}}/sources/{{sourceFileName}}.pages.json` 中的书签目录与页码摘要，核对印刷页码与 PDF 物理页码的偏移量。
3. 规划结构化区域划分方案（`region-01`, `region-02`, ...）并写入 `{{workspaceDir}}/segments/split-plan.json`：
```json
{
  "sourceFileName": "{{sourceFileName}}",
  "totalPages": {{totalPages}},
  "pageOffset": 0,
  "regions": [
    {
      "regionId": "region-01",
      "dayIndex": 1,
      "sectionTitle": "区域 1 主题标题",
      "printedStartPage": 1,
      "printedEndPage": 12,
      "pageOffset": 0,
      "physicalStartPage": 1,
      "physicalEndPage": 12,
      "crossRefPages": [],
      "outlineMappingNote": "涵盖的教材章节及核心知识点说明"
    }
  ]
}
```
4. 运行本地无损切割脚本，生成 `segments/region-XX.pdf` 与提取文本 `segments/region-XX.txt`：
```bash
npx tsx scripts/split_pdf.ts "{{workspaceDir}}"
```
```

---

## 模板 3：Chat 模式 PDF 区域划分提示词 (`template: pdf-segment-chat-prompt`)

```text
# Learn_everything（第 1 步）— Chat 模式确定 PDF 划分区域

我正在准备学习《{{courseName}}》（目标：{{courseGoal}}，计划 {{durationDays}} 天）。在生成正式课程大纲之前，我需要先用你帮我分析教材 PDF（文件名：`{{sourceFileName}}`，共 {{totalPages}} 物理页）并**划分学习区域**，返回给我后由本地脚本切割成若干小节 PDF。

### PDF 书签目录与页码参考
{{materialTOCSample}}

### 输出要求
请结合我的学习目标和预计天数，输出各划分区域的准确 PDF **物理页码范围（1 ~ {{totalPages}}）**。请只输出一个如下格式的 `json` 代码块（粘贴回系统即可执行脚本切割）：

```json
{
  "sourceFileName": "{{sourceFileName}}",
  "totalPages": {{totalPages}},
  "pageOffset": 0,
  "regions": [
    {
      "regionId": "region-01",
      "dayIndex": 1,
      "sectionTitle": "区域主题标题",
      "printedStartPage": 1,
      "printedEndPage": 12,
      "pageOffset": 0,
      "physicalStartPage": 1,
      "physicalEndPage": 12,
      "crossRefPages": [],
      "outlineMappingNote": "该区域覆盖的章节与核心内容说明"
    }
  ]
}
```
```
