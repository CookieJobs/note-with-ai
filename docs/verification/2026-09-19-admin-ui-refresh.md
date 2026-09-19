# Admin UI refresh 交付说明

## 评审范围

- 基线：`50956a1`
- 分支：`codex/admin-ui-refresh`
- 原 `main` 已回滚到 `dbefe52`，因此不能直接合并整条分支；请在用户评审后按需恢复后台 UI 补丁。

本次补丁覆盖：后台外壳、概览图表、6 页中文表格状态、反馈弹窗错误提示、会话超时恢复，以及概览和 AI 用量范围切换的请求竞态处理。

## 本地预览启动

预览使用根仓库 `/Users/liujin/Documents/noteWithAI/.env` 中已有的本地 MongoDB 配置；配置只在进程环境中加载，不复制到 tracked 文件，也不在本文档记录任何 secret。

前端（worktree 的 `frontend/` 目录）：

```sh
BACKEND_URL=http://127.0.0.1:3101 \
NEXT_PUBLIC_ADMIN_LOCAL_PASSWORD_ONLY=true \
npm run dev -- --port 3100 --hostname 127.0.0.1
```

后端（worktree 的 `backend/` 目录；只挂载 admin routes，不运行 `index.ts` 主函数，因此不会启动 scheduler）：

```sh
NODE_ENV=development \
ADMIN_LOCAL_PASSWORD_ONLY=true \
ALLOWED_ORIGINS=http://localhost:3100,http://127.0.0.1:3100 \
node -r tsx/cjs -e "require('dotenv').config({path:'/Users/liujin/Documents/noteWithAI/.env'});const express=require('express');const mongoose=require('mongoose');const app=express();app.use(express.json());app.use(require('cookie-parser')());app.use('/api/admin',require('./routes/admin').default);app.use(require('./utils/errorHandler').globalErrorHandler);mongoose.connect(process.env.MONGODB_URI,{autoIndex:false}).then(()=>app.listen(3101,'127.0.0.1',()=>console.log('Admin preview API ready; schedulers disabled'))).catch(()=>{console.error('Local preview database connection failed');process.exit(1)})"
```

## 启动检查

收尾时确认并启动了本 worktree 的预览服务：前端监听 `127.0.0.1:3100`，后端监听 `127.0.0.1:3101`，后端仅挂载 admin routes，scheduler 未启动。`GET /admin` 返回 HTTP 200；直连 `GET http://127.0.0.1:3101/api/admin/auth/me` 与经前端代理的 `GET http://127.0.0.1:3100/api/admin/auth/me` 在无凭据时均返回 HTTP 401。

浏览器验收覆盖登录、概览、用户列表和详情、AI、系统、反馈、审计，以及原因弹窗的打开和取消。390px 宽度下用户页 `scrollWidth = clientWidth = 375`，页面没有横向溢出；宽表格在表格容器内横向滚动。

未使用凭据进行真实写入测试，业务数据库没有变更。常规管理员登录写入审计记录属于预期行为。

## 测试结果

- `npm test`：通过，42 个测试文件、313 个测试。
- `npm run typecheck`：通过。
- `npx eslint src/app/admin`：通过。
- `git diff --check 50956a1`：通过。
- `BACKEND_URL=http://127.0.0.1:3101 NEXT_PUBLIC_ADMIN_LOCAL_PASSWORD_ONLY=true npm run build`：通过（Next.js 15.5.21；无警告）。

构建前后已检查 Git 状态；没有新增 tracked 构建产物。

## 已知后端后续事项

本轮聚焦前端 UI，不修改以下后端问题：

1. **P1：**用户搜索正则需要转义，并应使用 `max=100` 的 schema 限制输入长度。
2. **P1：**留存统计需要记录采集生效边界、排除不可观测 cohort，并显示样本量。
3. **P2：**概览自然日统计与 AI 滚动窗口需要统一时间口径。
4. **P2：**AI 诊断需补充按 `model`、`errorCode` 和 `durationMs` 的维度。
