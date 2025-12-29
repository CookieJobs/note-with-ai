我将修改 `backend/routes/notes.ts` 以修复笔记自动生成摘要时的并发冲突问题。

**具体步骤：**

1.  **修改 `PATCH /api/notes/:id` 接口**：
    *   定位到处理 `autoSummarize` 的代码块。
    *   在调用耗时的 `summarizeNote` (AI摘要) 函数并获得结果**之后**。
    *   增加一步：**重新从数据库查询该笔记的最新记录** (`Note.findById(id)`)。
    *   将生成的 `title` 和 `keywords` 更新到这个**新查询到的笔记对象**上，而不是直接修改旧的 `note` 对象。
    *   调用 `save()` 保存这个新对象。

这能确保在 AI 耗时操作期间，如果有其他请求（如 Embedding 生成）更新了笔记，我们依然能在最新的数据基础上进行合并保存，避免 MongoDB 的版本冲突错误 (`VersionError`)。
