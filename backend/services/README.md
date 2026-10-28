# 后端业务服务

系统边界见[现行架构](../../ARCHITECTURE_DOCUMENTATION.md)，存储格式见[模型说明](../models/README.md)。本目录负责业务写入、异步富化和聊天来源的信任边界。

## 笔记写入与派生任务

- [NoteUpdateOrchestrator.ts](NoteUpdateOrchestrator.ts) 是 Note 正文与标题的核心写入入口，提供 `create`、`update`，负责规范化、revision CAS、派生状态失效及任务安排。标题可空；标签写入返回 `NOTE_TAGS_RETIRED`。
- [noteContentNormalizer.ts](noteContentNormalizer.ts) 从富文本 JSON 推导可信 `contentText`，客户端不能自行指定语义正文。
- [noteEnrichmentScheduler.ts](noteEnrichmentScheduler.ts) 调度进程内、可 drain 的任务；[noteEnrichmentWorker.ts](noteEnrichmentWorker.ts) 仅在源 revision 匹配时写回摘要/概念、embedding 和推荐状态，不修改用户 `updatedAt` 或 revision，也不自动填写标题或标签。
- [noteService.ts](noteService.ts) 提供列表、删除与维护入口，请求 DTO 由 controller 适配后进入核心写模块。[noteEmbeddingService.ts](noteEmbeddingService.ts) 管理向量生成、metadata、修复与统计；[recommendService.ts](recommendService.ts) 管理关联检索和缓存写回。普通 Note DTO 不返回 embedding。

旧数据只有 revision 缺失或无效时才需要幂等回填；先备份和检查，再按[部署指南](../../deploy/DEPLOY_GUIDE.md)运行已编译的维护脚本。不要在普通 GET 或应用启动时批量写库。

`userNoteTopic*` 服务是已退役话题功能的遗留实现。生产入口未启动 topic runtime，话题查询/重试接口返回 410；不要把保留文件当作现行调度能力。

## 聊天来源与提交

[chatService.prepareTurn](chatService.ts) 核对用户拥有的会话和服务端绑定。已绑定会话沿用服务端历史，只接收当前新问题；浏览器不能更换绑定、改写旧回答或提交受信任来源快照。公开保存接口对已绑定历史只允许幂等保存。

[chatNoteContextService.ts](chatNoteContextService.ts) 每轮按 `_id + userId` 读取显式绑定笔记的最新已保存文字，不检索其他笔记、不缓存正文。正文优先 `contentText`，缺失时从 `contentJson` 推导，再兼容旧 `content`。图片仅保留未识别标记，不把地址或 base64 送入文字模型；空正文、纯图片、不可访问或读取失败均明确拒绝。正文上限为 12,000 个 Unicode 字符，完整模型上下文上限为 24,000 字符，超限拒绝，不截断。

静态系统说明与笔记资料、用户/助手历史分开，最新来源放在当前问题之前，旧来源声明不能替代本轮读取结果。模型应自然讨论笔记，不展示或索要内部 JSON 封包。

[chatTurnCommitService.ts](chatTurnCommitService.ts) 将实际回答和来源快照通过服务端路径一起保存，成功后才向浏览器确认 `committed`。可选的会话命名和关联检索共享 3 秒等待预算，超时沿用已有标题与关联，不执行迟到写回；可选步骤不能取代真实提交确认。

## 模型客户端与日志

[llmService.ts](llmService.ts) 是 DeepSeek 对话、摘要、概念扩展和重排的惰性入口，Note 路径不直接创建 `DeepSeekApiClient`。

[apiClient.ts](../utils/apiClient.ts) 提供通用 HTTP 与 DeepSeek 客户端。DeepSeek 默认最多两次 HTTP 总尝试；流式首响应和空闲等待各 45 秒，总时限 120 秒，仅收到 `[DONE]` 或 `finish_reason=stop/length` 才视为完整结束。流式错误日志限于请求 ID、阶段、错误分类、HTTP 状态、白名单网络原因和耗时。生产环境不记录完整模型响应；其他调试输出保留已有截断限制。
