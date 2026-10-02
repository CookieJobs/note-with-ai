# Models

- `Note.ts` 保存笔记输入字段和派生任务 fencing。话题成功快照写在 Note 同一文档，并通过 revision、完整源字段、claim token、claim version 与未过期租约保护；内部更新不修改用户 `updatedAt`。
- `UserNoteTopicIndex.ts` 是逐篇话题索引和任务状态投影，包含持久自动退避、人工配额和 claim 字段。
- `UserNoteTopicWorkerLease.ts` 用每用户唯一文档与过期 token 限制跨进程并发。
