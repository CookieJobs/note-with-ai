# noteWithAI 项目说明

本项目包含前端（Next.js）与后端（Node.js/Express）两部分，以及若干维护脚本。

## 贡献约定
- 建议在重要变更时补充必要文档（本仓库仅保留项目级 `README.md`、`CHANGELOG.md` 等顶层文档）。
- `scripts/doc-tools/*` 的文档扫描/注入/校验脚本为可选工具；当前未强制在提交阶段执行。

## 仓库结构（概览）
- `frontend/`：Next.js 前端应用
- `backend/`：Node.js/Express 后端服务
- `scripts/`：项目维护与运维脚本

## 文档与注释规范（可选）
- 可按需在关键模块文件中保留 `Input/Output/Pos/Note` 头注释，便于团队理解与维护；不再作为全仓库硬性门禁。

## 脚本与校验（可选）
- 提供 `doc:scan`、`doc:inject`、`doc:check` 三个脚本，用于扫描、注入模板与校验规范（按需使用）。

## 本地部署指南

### 1. 环境准备
- **Node.js**: 建议使用 v18 或以上版本。
- **MongoDB**: 本地运行需要 MongoDB 数据库支持。请先下载安装并启动 MongoDB 服务。
  - 下载地址: [MongoDB Community Server](https://www.mongodb.com/try/download/community)
  - 默认数据库连接地址为: `mongodb://localhost:27017/note-with-ai`

### 2. 安装依赖
在项目根目录下，运行以下命令。该命令会自动安装根目录、`frontend` 和 `backend` 的所有依赖包：
```bash
npm run install:all
```

### 3. 环境变量配置
项目包含前端和后端的独立环境变量配置，请根据示例文件创建自己的 `.env` 文件。

- **后端环境变量**：
  ```bash
  cd backend
  cp .env.example .env
  ```
  请在 `backend/.env` 中配置你的 JWT Secret 和相关的 AI 模型 API Key（如 `DASHSCOPE_API_KEY` 或 `DEEPSEEK_API_KEY`）。

- **根目录环境变量 (适用于前端)**：
  ```bash
  cp .env.example .env
  ```
  *(注：Next.js 前端通常会读取根目录下的 `.env`)*

### 4. 启动服务
为了正常使用，你需要同时启动前端和后端服务（建议打开两个终端窗口）。

**启动后端服务 (默认端口 3001)**:
```bash
cd backend
npm run dev
```

**启动前端服务 (默认端口 3000)**:
```bash
cd frontend
npm run dev
```

### 5. 访问应用
服务启动成功后，在浏览器中访问 [http://localhost:3000](http://localhost:3000) 即可开始使用 noteWithAI。

## 技术栈概览
- **前端**: Next.js (React), Tailwind CSS, Tiptap (富文本编辑器)
- **后端**: Node.js, Express, MongoDB (Mongoose)
- **AI 能力**: 接入 Qwen / DeepSeek 模型用于对话与文本向量化 (Embeddings)
