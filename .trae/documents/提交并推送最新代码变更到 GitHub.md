根据 `git status` 检查，发现有多个文件被修改但尚未提交，包括后端 Embedding 逻辑重构、前端笔记页面优化以及 Vercel 部署配置的更新。

为了将最新代码更新到 GitHub，我计划执行以下操作：

1.  **添加所有变更**：将所有修改过和新添加的文件（如 `.trae/documents/` 下的文档、后端脚本、前端组件等）添加到暂存区。
2.  **提交更改**：创建一个新的提交，包含以下主要内容：
    *   **后端**：重构 Embedding 处理逻辑（移除 `embeddingCronJob.ts`，新增 `repair_embeddings.ts`），更新 `notes` 和 `chat` 路由。
    *   **前端**：优化笔记页面布局、`RelatedNoteCard` 组件及全局快捷键。
    *   **配置**：更新 Vercel 配置文件及依赖。
3.  **推送到 GitHub**：将提交推送到 `origin/main` 分支。

准备好后，请确认执行。