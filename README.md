# Learn_everything

> 本地优先的多模态智能学习规划与交互式课件生成系统：上传教材 PDF 与学习目标，自动切分章节、规划大纲，并按日期时间轴生成含公式推导、SVG 原理图、启发式思考与分层练习的本地课件。

---

## 核心特性

### 1. 轻量每日统计时间轴 & 沉浸式日期详情页
- **低干扰学习总览**：主时间轴保留清晰的纵向日期结构，每日右侧聚焦展示 **当日课程总数（含独立课件就绪数）**、**已评估预计学习时长** 与 **实际已完成小节数量及细进度条**。
- **就绪与完成状态严格解耦**：已生成/已导入课件（课件就绪）不会误计为“已学完”，进度条仅统计实际完成并提交练习的小节。
- **分层退出导航体验**：从主时间轴点击日期或统计面板进入当日详情页，集中查看当天所有小节、进入学习或打开工作台；支持从课件返回详情页再返回时间轴的连续导航。

### 2. 两阶段（Two-Stage）课件生成架构 & API / Agent / Chat 三模式同级协作
- **单节两阶段生成原理**：
  - **Stage 1（核心教学与配图规划）**：先生成完整教学正文、连续公式推导、启发式「先思考，后讲解」问题、分层练习以及每张插图的 `diagramSpecs` 原理图规范。
  - **Stage 2（矢量原理图专项绘制与合并）**：仅当存在配图需求时触发，依据 `diagramSpecs` 专项绘制高可读性 `diagrams` SVG 矢量图并合并入节数据（无配图小节在 Stage 1 自动完结）。
- **API 模式（单节单步独立请求 + 真实流式进度）**：支持 Gemini 与任意 OpenAI 兼容接口。每个小节的每个阶段作为独立 HTTP 请求运行，支持工作台内定点重生成与断点续跑；后端通过 NDJSON (`?stream=1`) 实时推送阶段切换、推理思考字数、已接收字符与 chunk 数及字段进度，拒绝虚假进度条。
- **Agent 课件模式（按小节目录精准分发）**：自动将提示词分散写入各小节专属文件夹 `courses/<课程>/prompts/<secId>/`（包含 `stage1` / `stage2` 任务提示与模板），配合本地 Agent 逐节产出 `lessons/<secId>.json` 并一键扫描同步。
- **Chat 课件模式**：一键复制分阶段提示词与对应小节 PDF，粘贴外部大模型输出后即可本地即时预览、诊断与保存。

### 3. 多模态 PDF 原文件直传与无损切片
- **多模态物理页直传**：直接将原教材或切片后的 PDF 物理页发送给多模态模型，完整保留公式、电路图、坐标轴与原书版式上下文，避免文本抽取失真。
- **本地无损切割**：根据划分方案在本地将整本教材无损切分为各小节 `segments/sec-XX.pdf`。
- **资源管理器级剪贴板复制**：支持一键点击「复制小节 PDF」将真实 PDF 文件写入系统剪贴板，等效文件管理器 `Ctrl+C`，可直接 `Ctrl+V` 粘贴到外部 AI 对话框。
- **英语精读词库配额**：支持目标词库与已掌握词库的集合差集运算，按学习天数随机不重复抽取词汇。

### 4. 跨学科公式排版、增量诊断修复与学习闭环
- **全学科 LaTeX 鲁棒渲染**：基于 KaTeX 自动补全与修复数学微积分、电磁学/量子物理（`\nabla \times \vec{E}`）、电路符号（`u_P = u_N`, `VGS > VTH`）、化学分子式与离子价态（`CH_3COOH`, `SO_4^{2-}`）、算法复杂度（`O(n \log_2 n)`）与矩阵分段环境，标题、选项及特殊文本框均安全渲染。
- **渲染质量诊断与增量修复**：自动检测 SVG 标签异常、KaTeX 公式错误及缺失插图引用，支持生成分阶段增量修复补丁，无需整节推倒重来。
- **可拖拽缩放看图小窗**：长篇推导或题目引用图号（如 `图 diag-1`、`scope.png`）时，点击即可在非阻塞悬浮小窗中缩放对照查看。
- **闭环教学与本地持久化**：问题引入 → 直觉到定义 → 公式连续推导 →「先思考，后讲解」→ 图文同步 SVG → 分层练习（离线自动判分与持久化）→ 费曼反向复述检验；支持 `.zip` 一键导出备份与跨设备恢复。

---

## 技术栈

- **前端**：React 19 · TypeScript · Vite · Tailwind CSS v4 · Motion · KaTeX · Marked · Lucide Icons
- **主服务端**：Node.js · Express · `tsx` · `@google/genai` · `pdf-lib` · `pdfjs-dist`
- **本地文件伴随后端**：Python 3.8+（`backend/server.py`，纯标准库实现，零额外 pip 依赖）

---

## 快速开始

### 环境要求
- **Node.js** >= 18（推荐 LTS）
- **Python** >= 3.8

### 方式一：Windows 一键启动

双击根目录下的 `start.bat`，脚本会自动完成：
1. 检查 Node.js 与 Python 环境；
2. 首次运行时安装 npm 依赖并创建本地 `.venv` 虚拟环境；
3. 启动本地 Python 文件服务（`http://127.0.0.1:3001`）与主服务（`http://localhost:3000`）；
4. 自动打开浏览器访问 `http://localhost:3000`。

### 方式二：手动启动（Windows / macOS / Linux）

```bash
# 1. 克隆仓库并进入目录
git clone https://github.com/<your-username>/Learn_everything.git
cd Learn_everything

# 2. 安装前端与 Node 服务端依赖
npm install

# 3. （可选）配置环境变量，也可启动后在网页右下角「设置」中填写 OpenAI 兼容或 Gemini Key
cp .env.example .env

# 4. 启动开发环境（Express + Vite + 自动拉起 Python 后端）
npm run dev
```

启动后在浏览器打开 `http://localhost:3000` 即可使用。

### 生产构建

```bash
npm run build
npm start
```

---

## 模型与 API 配置说明

应用提供三种灵活接入方式：
1. **网页内配置**：点击界面右下角 **设置**，可切换内置 Gemini 或自定义 **OpenAI 兼容接口**（填写 Base URL、模型名与 API Key，保存在本地 `data/settings.json`，已被 `.gitignore` 忽略）。
2. **环境变量配置**：在 `.env` 中设置 `GEMINI_API_KEY`（见 `.env.example`）。
3. **无 API Key 离线/零密钥工作流**：若不配置任何 API Key，可直接使用 **Chat 课件模式** 或 **Agent 课件模式** 完成教材切片、大纲规划与逐节完整课件导入学习。

---

## 目录结构

```text
Learn_everything/
├── backend/                  # Python 本地文件管理、剪贴板写入与 ZIP 备份后端
│   ├── server.py
│   ├── requirements.txt
│   └── test_server.py
├── learn-everything-prompts/ # 模块化可复用教学提示词与学科模板体系
├── public/                   # 静态资源与提示词打包下载
├── scripts/                  # 本地 PDF 无损切分脚本
├── src/
│   ├── components/           # 添加课程、工作台、每日详情页(DailyFocusView)、Agent 同步、课件阅读与设置弹窗
│   ├── prompts/              # 提示词组装与预设管理
│   ├── utils/                # LaTeX/Markdown 渲染、SVG 增强、PDF 处理、诊断修复、流式进度解析与客户端
│   ├── App.tsx               # 主应用与每日学习统计时间轴
│   └── types.ts              # 领域模型类型定义
├── server.ts                 # Express API、两阶段 NDJSON 流式生成与 Python 进程管理
├── start.bat                 # Windows 一键安装与启动脚本
├── .env.example              # 环境变量模板（不含真实密钥）
├── .gitignore                # 开源忽略规则（保护本地教材、个人课程与密钥不上传）
└── LICENSE                   # GNU Affero General Public License v3.0 (AGPL-3.0)
```

> 运行后本地生成的课程目录（`courses/`，包含切分 `segments/`、按小节拆分的 `prompts/<secId>/` 与生成的 `lessons/<secId>.json`）和学习数据（`data/`）均保留在本地磁盘。

---

## 测试与代码检查

```bash
# 运行 TypeScript 核心逻辑、PDF 处理、LaTeX 渲染、诊断修复与流式进度单元测试
npx tsx --test src/utils/learningLogic.test.ts

# 运行 Python 本地后端单元测试（Windows 可使用 python，macOS/Linux 使用 python3）
python -m unittest backend/test_server.py -v

# TypeScript 类型检查
npm run lint
```

---

## 开源协议与隐私安全提示

- 本项目基于 [GNU Affero General Public License v3.0 (AGPL-3.0)](./LICENSE) 开源协议发布。
- 在执行 `git add` / `git push` 到 GitHub 前，请确认以下本地敏感数据与个人文件已被 `.gitignore` 正确排除：
  - `.env` / `.env.*`：包含环境变量中的 API Key（仅保留 `.env.example`）；
  - `data/`：包含 `settings.json`（网页设置中填写的 `customApiKey`）和 `db.json`；
  - `courses/`：包含本地上传的教材 PDF 原文件、切片、提示词及个人学习课件；
  - `.aistudio/`、`public/assets/aistudio/`：开发调试时的临时附件；
  - `.venv/`、`node_modules/`、`dist/`：本地依赖与构建产物。

若此前曾在本地初始化过 Git 并误跟踪过上述目录，建议在首次推送前运行 `git status` 检查，必要时使用 `git rm -r --cached data courses .env` 取消跟踪后再提交。
