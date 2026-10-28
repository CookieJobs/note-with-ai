# NoteWithAI

NoteWithAI 面向中文桌面浏览器，支持记录笔记、围绕已保存的笔记与 AI 对话，以及发现和收藏灵感。

## 从哪里开始

- [产品范围](PRODUCT.md)：面向谁、保留什么能力、哪些功能已经退役。
- [设计规范](DESIGN.md)：工作区布局、主题、组件和交互规则。
- [架构与数据契约](ARCHITECTURE_DOCUMENTATION.md)：业务边界、数据一致性、来源可信性和模块入口。
- [文档目录与维护规则](docs/README.md)：现行文档、历史验收和资料存放方式。
- [部署与回滚](deploy/DEPLOY_GUIDE.md)：生产备份、成套发布、管理员配置和独立 worker。
- [工作区版本验收与发布记录](docs/releases/2026-10-workspace-ui.md)。

## 仓库结构

| 目录 | 职责 |
| --- | --- |
| `frontend/` | Next.js 15、React 18、Tiptap 和工作区界面 |
| `backend/` | Express 5、MongoDB 数据访问、AI 与账户服务 |
| `deploy/` | 部署指南及 Nginx 示例 |
| `design-preview/` | 独立 HTML 视觉主稿及说明，使用模拟数据 |
| `docs/` | 文档索引、版本验收和可复用测试资料 |
| `scripts/` | 维护脚本；运行前核对其作用范围 |

## 本地开发

Dockerfile 使用 Node.js 20。原生开发建议至少 Node.js 20.19，并遵守 lockfile 中工具的 engine 要求。MongoDB 和 Redis 必须可访问；Compose 的本机端口分别是 27017 和 **6380**，Redis 容器内端口仍是 6379。不要为了开发重建已有生产数据卷。

在仓库根目录安装依赖：

```bash
npm run install:all
cp .env.example .env
```

编辑自己的 `.env`，至少核对 `MONGODB_URI`、`REDIS_URL`、`ALLOWED_ORIGINS` 和安全配置。若使用本机 Compose Redis，连接为 `redis://localhost:6380`；示例的 `localhost:6379` 适用于另行运行的本机 Redis。选择自己独立的开发数据库，不要连接生产数据库。开发跨域可设为 `http://localhost:3000,http://localhost:3001`。配置中的开发默认值不能用于生产。

向量服务默认使用 OpenRouter，聊天使用 DeepSeek；灵感研究还需要 Tavily。没有相应密钥时，不应把外部 AI 功能视为可用。供应商变量与模型配置见 [AI 配置](docs/ai-configuration.md)。密钥留在本机环境或受控环境文件，不能提交到仓库。

后端同时存在配置模块的显式 dotenv 路径和入口的工作目录读取。原生开发从仓库根目录进入后端，先用已安装的 dotenv 预加载同一份环境，再启动开发入口，避免两份 `.env` 配置相互冲突。环境文件按 dotenv 格式解析，不作为 shell 脚本执行：

```bash
cd backend
NODE_ENV=development DOTENV_CONFIG_PATH=../.env node --require dotenv/config ./node_modules/ts-node-dev/lib/bin.js --trace-deprecation --respawn --transpile-only index.ts
```

另开终端，在仓库根目录运行前端：

```bash
BACKEND_URL=http://localhost:3001 npm --prefix frontend run dev
```

访问 `http://localhost:3000`。前端请求同源 `/api`，由 Next.js 的 `BACKEND_URL` rewrite 代理到后端；不要假设 Next.js 会自动读取仓库根 `.env`，也不要用旧的 `NEXT_PUBLIC_API_URL` 指南替代当前代理配置。生产 Compose 环境由根 `.env` 插值注入，不等同于原生开发的 dotenv 读取。

## 检查与构建

```bash
npm run typecheck
npm test
npm --prefix frontend run lint
npm run build:all
npm --prefix frontend run check:route-budgets
```

后端完整 Mongo 集成测试需要独立测试数据库环境；发布验收使用过 `PROFILE_TOPIC_MONGO_TEST=1 NODE_ENV=test npm --prefix backend test`。不要把测试指向生产数据库。前端预算检查需要先成功构建。生产发布以部署指南为准，根目录 `build` 本身不构建应用。

## 文档贡献

业务变化时同步维护对应的产品、设计或模块契约。README 只在确实有独立职责或特殊约束时新增。临时执行清单、代理账本和本机日志不进入公共文档；维护规则见 [文档目录](docs/README.md)。`doc:scan`、`doc:inject`、`doc:check` 是可选的注释工具，不是功能或文档准确性门禁。
