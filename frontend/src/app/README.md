# 页面组合

根 `layout.tsx` 保留全局 Providers、键盘辅助、UUID 与提示服务，并使用 `WorkspaceRoot` 隔离普通工作区。`/notes`、`/chat`、`/inspiration`、`/profile` 共享持久工作区外壳；登录、注册、重置密码和全部 `/admin/**` 沿用现有页面，不应用新工作区主题。

本轮以 2026-10-24 工作区迁移 Spec 与 S1 计划为准。页面依旧通过原 hooks/services 访问业务，具体模块进度见 docs/recovery/2026-10-24-workspace-ui-migration-progress.md。
