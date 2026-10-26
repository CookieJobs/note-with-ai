# Utilities

- `apiClient.ts` 提供通用 HTTP 与 DeepSeek 客户端。DeepSeek 默认保留两次 HTTP 总尝试；话题索引专用客户端可传 `retries: 1`，避免与数据库中的持久重试次数相乘。流式调用首响应与空闲等待上限为45秒、总时限为120秒，必须收到 `[DONE]` 或 `finish_reason` 为 `stop`/`length` 才视为完成；日志只记录请求 ID、阶段、错误分类、HTTP 状态、白名单网络原因和耗时。其他调用继续使用默认值。
