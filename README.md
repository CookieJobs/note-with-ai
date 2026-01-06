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

## 本地部署
1. 下载安装 mongodb \
   https://www.mongodb.com/try/download/community

2. 
