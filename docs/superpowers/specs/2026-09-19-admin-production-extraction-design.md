# NoteWithAI 运营后台受控生产发布设计

日期：2026-09-19

状态：已获用户确认，待实施计划复核

## 目标

在不重新引入 `50956a1` 中普通用户端样式和功能回归的前提下，从其中恢复经过测试的运营后台 Phase 1，并将其安全部署到现有服务器。后台继续使用现有 Next.js、Express、MongoDB 和 Redis；不新增服务或数据库。

完成后，授权管理员可在 `https://bloomy16.com/admin` 登录并查看线上用户、笔记、聊天、AI 使用、失败富化任务、反馈、系统健康和审计数据。普通用户页面及现有 API 的功能和视觉表现必须保持线上基线 `a9e1ebb` 的状态。

## 已确认事实

- 生产服务器为 `47.118.16.95`，项目目录为 `/root/note-with-ai`，当前提交为 `a9e1ebb`。
- MongoDB 是同机 Docker 服务 `note-mongo`，业务数据库为 `note-with-ai`；后台必须读取这一既有数据库，不能另建或覆盖数据库。
- 当前库有 91 条笔记、28 位用户，`adminaccounts` 集合不存在管理员账号。
- 当前线上只有 HTTP 的 Nginx 默认站点，未安装 Certbot；管理员会话的生产 Cookie 需要 HTTPS 才能工作。
- 服务器上的 `docker-compose.yml` 有未提交的 OpenRouter/embedding 环境变量传递配置。这些现有配置必须保留。
- 当前 `main` 是回退基线，不含后台；完整后台历史存在于 `50956a1` 和远程归档分支，但该历史版本还包含 228 个文件的无关产品改动。

## 发布边界

### 允许恢复

1. 管理员身份、安全会话和固定 RBAC：独立管理员模型、独立 JWT 密钥、加密的 TOTP secret、`HttpOnly` + `Secure` + `SameSite=Strict` Cookie、Origin 校验、请求 ID 与不可修改审计日志。
2. 后台路由与页面：`/admin/login`、概览、用户、AI、反馈、系统和审计；API 位于 `/api/admin/*`。
3. 后台查询与受控命令：隐私最小化的用户投影、失败富化任务重试、用户启停和反馈状态更新，均通过服务端权限和审计控制。
4. 后台指标所需的最小数据采集：无正文的 `ProductEvent` 和 `AiUsageEvent`，以及必要的服务端写入钩子。采集失败不得阻断用户的既有写入。
5. 管理反馈数据模型与普通用户提交接口。此次不增加普通用户反馈页面，因此该新增接口不改变既有用户页面。
6. 后台构建所需依赖、测试、环境变量模板、部署文档及 Docker Compose 环境变量传递。

### 明确禁止恢复

- `50956a1` 中普通用户端的视觉重构、响应式调整、组件替换、笔记列表/编辑器改造、聊天改造、个人页改造和鉴权页面改造。
- 记忆、灵感、公开发布、核心体验循环及其 API、模型和页面。
- 无关的推荐算法、向量、富化流程、数据模型、第三方服务或基础设施变更。
- 任意 MongoDB 原始 CRUD、管理端直连数据库、笔记/聊天正文、Prompt、AI 回复或 embedding 的后台读取/导出。

## 代码提取策略

在新分支 `codex/admin-production-release` 上从 `a9e1ebb` 开始，按依赖顺序选取后台历史提交，而不是合并 `50956a1`：管理员存储与加密、管理员认证与审计、第一方产品事件、无内容 AI 用量、概览/用户/反馈/AI 服务、管理 UI 和后续安全修复。

每次提取后均执行文件白名单审查。允许改变的普通业务文件只限于为无内容事件、AI 用量或禁用用户即时失效所需的服务端接缝；任何普通用户 React 页面、样式或既有 API 行为的变更均视为越界，必须移除或停止发布。

历史 AI/产品事件不会自动补齐。已有用户、笔记和聊天总数可立即显示；依赖 `ProductEvent`/`AiUsageEvent` 的趋势和用量从发布后开始积累，UI 必须表达为数据积累中而非伪造历史值。

## 安全与配置

- 在服务器本地使用安全随机源生成 `ADMIN_JWT_SECRET` 和 32-byte base64 `ADMIN_ENCRYPTION_KEY`；两者不得打印、提交或传回聊天，且 `ADMIN_JWT_SECRET` 不得等于普通 `JWT_SECRET`。
- `.env` 权限为 owner 可读，Compose 只把所需变量传给 backend。服务器现有 embedding 变量必须原样保留。
- 配置 HTTPS，HTTP 仅重定向至 HTTPS。Nginx 只代理 Web 和 API；管理员 session Cookie 仅随 HTTPS 请求发送。
- 仅在后台镜像稳定、HTTPS 可用后创建首个 `owner`。创建通过容器内 CLI 的一次性环境变量执行，生成密码与 TOTP provisioning URI 不写进仓库或持久化日志。
- 管理登录及所有 mutation 使用服务端 RBAC 和审计，前端仅作为展示层。
- 本次不在未经单独验证的情况下关闭现有 Mongo/Redis/应用端口映射；端口收敛另立变更，以避免未知外部依赖被意外中断。

## 部署与回滚

部署前必须记录当前 commit、镜像 ID 和 Compose 配置，导出 `note-with-ai` Mongo archive，并验证备份可读。部署过程不得执行 `dropDatabase`、`mongorestore`、`git reset --hard` 或覆盖服务器 `.env`。

新版本通过 Docker Compose 构建和启动。验证包括容器稳定、`/api/health`、普通用户关键路由、`/admin/login`、HTTPS 证书和重定向、管理员 Cookie 属性、普通用户 token 无法访问 Admin API、以及管理员登录后的概览读取。

如果验证失败，恢复部署前 commit/镜像与 Compose/.env 备份，重启原有服务；不回滚数据库数据，因为本发布仅新增集合与可追加事件。

## 验收标准

1. 发布分支的 diff 不含禁止恢复目录或普通用户 UI 样式改动；白名单审查有记录。
2. 后端与前端类型检查、完整测试和生产构建均通过；新增后台安全、RBAC、隐私投影与页面测试均通过。
3. 生产端 `/admin/login` 返回 200，且只可通过 HTTPS 使用管理员 Cookie；HTTP 返回 HTTPS 重定向。
4. 管理员可看到线上既有用户/笔记/聊天汇总；管理员 API 不暴露私密正文或配置密钥。
5. 普通用户页面与 API 健康检查保持可用；普通用户 JWT 获取 Admin API 时得到 401/403。
6. MongoDB 备份、部署前 commit、镜像 ID、健康检查结果和回滚命令被保存并汇报。
