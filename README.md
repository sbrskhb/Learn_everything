# Learn_everything

> 本地优先的多模态智能学习规划与交互式课件生成系统：上传教材 PDF 与学习目标，自动切分章节、规划大纲，并按日期时间轴生成含公式推导、SVG 原理图、启发式思考与分层练习的本地课件。

---

## 核心特性

### 1. 多模态 PDF 原文件直传与无损切片
- **拒绝低质量 OCR**：直接把原教材或切片后的 PDF 物理页发送给多模态模型，保留公式、电路图、坐标轴与版式上下文。
- **本地无损切割**：根据划分方案在本地将整本教材无损切分为各小节 `segments/sec-XX.pdf`。
- **资源管理器级剪贴板复制**：支持一键点击「复制小节 PDF」将真实 PDF 文件写入系统剪贴板，等效文件管理器 `Ctrl+C`，可直接 `Ctrl+V` 粘贴到外部 AI 对话框。

### 2. 三步式课程工作台 & 极简/高级视图切换
1. **区域划分与切片（或英语词库配额）**：LLM 规划 PDF 物理页区域并本地无损切片；英语精读课程支持目标词库与已掌握词库的集合差集运算，按日随机不重复抽取词汇。
2. **课程大纲生成与确认**：依据切片生成连贯的 `outline.json`，自动传递前后讲的先修知识点与范围约束。
3. **按大纲逐节生成与学习**：按时间轴进入每日学习，支持单节生成、按序批量生成以及“保存并连续进入下一讲”。
- **低心智负担默认视图**：默认隐藏页码偏移换算、手动切分微调与大纲改写细节；需要深度定制时可在右下角「设置」中随时开启。

### 3. API / Chat / Agent 三模式同级协作
- **API 一键生成（真实流式进度）**：支持 Gemini 与任意 OpenAI 兼容接口。后端通过 NDJSON (`?stream=1`) 实时推送文件装载、模型推理思考字数、已接收字符与 chunk 数、已检测到的 JSON 字段及最新章节摘要，零虚假定时器进度条。
- **Chat 课件模式**：一键复制定制提示词与小节 PDF，粘贴外部 AI 返回结果后即时预览渲染，底部常驻保存栏支持随时保存。
- **Agent 课件模式**：与 Chat 模式同级嵌入工作台，可直接复制目录级任务提示词交由本地 Agent 生成 `lessons/sec-XX.json` 并一键扫描同步。

### 4. 跨学科公式排版与交互式学习闭环
- **全学科 LaTeX 鲁棒渲染**：基于 KaTeX 自动补全与修复数学微积分、电磁学/量子物理（`\nabla \times \vec{E}`）、电路符号（`u_P = u_N`, `VGS > VTH`）、化学分子式与离子价态（`CH_3COOH`, `SO_4^{2-}`）、算法复杂度（`O(n \log_2 n)`）与矩阵分段环境，标题、选项及特殊文本框均安全渲染。
- **可拖拽缩放看图小窗**：长篇推导或远处题目引用图片名（如 `图 diag-1`、`scope.png`）时，点击即可在非阻塞悬浮小窗中放大对照查看。
- **闭环教学结构**：问题引入 → 直觉到定义 → 公式连续推导 →「先思考，后讲解」渐进提示 → 图文同步 SVG → 分层练习（离线自动判分与持久化）→ 费曼反向复述检验。
- **完全本地化存储与备份**：课程资料与学习记录保存在本地 `courses/` 与 `data/` 目录，由本地 Python 后端辅助磁盘管理，支持 `.zip` 一键导出备份与跨设备恢复。

---

## 技术栈

- **前端**：React 19 · TypeScript · Vite · Tailwind CSS v4 · KaTeX · Marked · Lucide Icons
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
git clone https://github.com/sbrskhb/Learn_everything.git
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

应用提供两种配置方式（任选其一）：
1. **网页内配置**：点击界面右下角 **设置**，可切换内置 Gemini 或自定义 **OpenAI 兼容接口**（填写 Base URL、模型名与 API Key，保存在本地 `data/settings.json`，已被 `.gitignore` 忽略）。
2. **环境变量配置**：在 `.env` 中设置 `GEMINI_API_KEY`（见 `.env.example`）。
3. **无 API Key 也可使用**：若不配置任何 API Key，可直接使用 **Chat 课件模式** 或 **Agent 课件模式** 完成大纲制定、PDF 切片与完整课件导入学习。

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
│   ├── components/           # 添加课程、工作台、Agent 同步、课件阅读与设置弹窗
│   ├── prompts/              # 提示词组装与预设管理
│   ├── utils/                # LaTeX/Markdown 渲染、SVG 增强、PDF 处理、流式进度解析与客户端
│   ├── App.tsx               # 主应用与每日学习时间轴
│   └── types.ts              # 领域模型类型定义
├── server.ts                 # Express API、NDJSON 流式生成与 Python 进程管理
├── start.bat                 # Windows 一键安装与启动脚本
├── .env.example              # 环境变量模板（不含真实密钥）
└── .gitignore                # 开源忽略规则（保护本地教材与密钥不上传）
```

---

## 测试与代码检查

```bash
# 运行 TypeScript 核心逻辑、PDF 处理、LaTeX 渲染与流式进度单元测试
npx tsx --test src/utils/learningLogic.test.ts

# 运行 Python 本地后端单元测试
python3 -m unittest backend/test_server.py -v

# TypeScript 类型检查
npm run lint
```

---

## 开源与隐私安全提示

在执行 `git add` / `git push` 到 GitHub 前，请确认以下本地敏感数据与大文件已被 `.gitignore` 正确排除：
- `.env` / `.env.local`：包含环境变量中的 API Key；
- `data/`：包含 `settings.json`（网页设置里填入的 `customApiKey`）和 `db.json`；
- `courses/`：包含你本地上传的教材 PDF 原文件、切片及生成的个人学习课件；
- `public/assets/aistudio/`：开发调试时的临时截图附件；
- `.venv/`、`node_modules/`、`dist/`：本地依赖与构建产物。

若此前曾在本地初始化过 Git 并误跟踪过上述目录，建议在首次推送前检查：`git status`，必要时用 `git rm -r --cached data courses .env` 取消跟踪。
