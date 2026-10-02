# Services

本目录承载后端业务服务。Note 的核心写入边界与异步富化约定如下。

## Note 写入

- `NoteUpdateOrchestrator.ts` 是唯一的 Note 核心写模块，对外只有 `create` 和 `update`。它负责正文规范化、revision CAS、派生状态失效和任务安排。
- `noteContentNormalizer.ts` 从富文本 JSON 推导可信 `contentText`；客户端不能自行指定语义文本。
- `noteEnrichmentScheduler.ts` 是进程内、可 drain 的任务调度器。`noteEnrichmentWorker.ts` 在 revision 仍匹配时写回 meta、embedding 和 recommendation 状态；不改变核心 `updatedAt` 或 revision。
- `noteService.ts` 负责列表、删除和维护入口。旧请求 DTO 只在 `controllers/noteController.ts` 适配后才调用核心模块。
- `noteEmbeddingService.ts` 继续管理 embedding 的生成、metadata、修复与统计；普通 Note DTO 不返回 embedding。
- `recommendService.ts` 管理用户主动触发的相关推荐查询及缓存写回。
- `userNoteTopicIndexService.ts` 用完整 source CAS 与单调 fence 调度逐篇索引、租约和人工配额；Note 内 `topicIndexSuccess` 是成功快照权威，索引集合是可校验投影。
- `userNoteTopicIndexWorker.ts` 单篇处理话题提取，按每指纹三次自动尝试退避；仅无现成候选标签时使用专用单次 HTTP DeepSeek 客户端。

部署启用新的 revision CAS 代码前，必须先运行一次幂等的 `npm run backfill:note-revisions`。该 backfill 只补齐无效 revision，且不会修改时间戳；不得把它接入普通 GET 或应用启动流程进行批量写库。

## LLM 与日志

- `llmService.ts` 是 DeepSeek 聊天、摘要、概念扩展与重排的惰性入口。Note 路径不得直接创建 `DeepSeekApiClient`。
- 话题提取从 `getDeepSeekTopicClient()` 使用独立的一次 HTTP 尝试配置；持久 worker 负责 30 秒/120 秒自动重试，其他 AI 调用保留默认配置。
- 生产环境不记录完整模型响应；调试日志仅保留截断预览。
