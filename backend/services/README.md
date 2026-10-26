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

## 单篇笔记聊天上下文

- `chatTurnCommitService` 在主回答结束后，为可选会话命名和关联检索提供共享的 3 秒等待预算；超时沿用已有标题与关联，不执行迟到写回。实际对话和来源快照仍须保存成功后才能向浏览器确认提交。

- `chatNoteContextService.ts` 每轮只按 `_id + userId` 读取显式绑定笔记的最新已保存文字，返回 `types/chatSource.ts` 中的来源快照；不查询其他笔记，不缓存正文。
- 正文优先使用可信 `contentText`，缺失时从 `contentJson` 推导，最后兼容旧 `content`。图片仅保留未识别标记，不向文字模型传递图片地址或 base64；纯图片、空正文、读取失败和不可访问笔记都明确报错。
- 单篇正文最多 12,000 个 Unicode 字符，模型消息合计最多 24,000 个 Unicode 字符（含系统说明、JSON 封包及完整聊天历史）；超过预算直接拒绝，绝不静默截断。
- 模型只接收静态系统说明、单独的 JSON 资料消息和经过角色/正文校验的完整历史。每轮最新来源插在最后一条用户问题紧前，旧消息保持原顺序；静态说明按服务端绑定状态选择，明确这份来源是本轮自动读取的最新已保存正文，旧来源声明和旧回答不能替代它。笔记标题和正文始终是资料。
- 回答直接使用已读取的笔记，不向用户展示或索要 JSON、封包、字段等内部技术资料；缺少事实及图片未识别的限制仍须如实说明。未绑定聊天不会把用户伪造的资料声明当成服务端来源，并引导用户使用已有的“从这条笔记聊起”入口。
- `chatService.prepareTurn` 在生成前读取当前用户拥有的会话绑定；已绑定会话使用服务端历史，仅接受当前的新问题，不能通过浏览器替换旧回答或切换绑定。公开保存接口不接受来源快照，已绑定的历史只允许幂等保存；实际回答与旧来源由 `chatTurnCommitService` 通过服务端路径一起保存。
