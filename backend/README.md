# 后端服务目录说明

本目录为 Node.js/Express 后端服务，提供认证、聊天、笔记与推荐等 API，组织为路由→中间件→控制器→服务→模型→工具。

## 文件清单（名字 / 地位 / 功能）
- `index.ts` — 服务入口 — 初始化 Express、注册路由与中间件
- `.env.example` — 配置示例 — 环境变量示例模板
- `package.json` — 项目配置 — 脚本与依赖管理
- `tsconfig.json` — 编译配置 — TypeScript 编译选项
- `package-lock.json` — 锁定文件 — 依赖版本锁定
- `config/` — 目录 — 配置项（如嵌入生成参数）
- `controllers/` — 目录 — 业务控制器（处理请求）
- `middleware/` — 目录 — 鉴权与通用中间件
- `models/` — 目录 — 数据模型
- `routes/` — 目录 — 路由定义
- `scripts/` — 目录 — 维护/修复脚本
- `services/` — 目录 — 外部服务与业务服务
- `utils/` — 目录 — 通用工具函数

一旦我所属的文件夹有所变化，请更新我。

