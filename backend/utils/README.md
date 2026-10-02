# Utilities

- `apiClient.ts` 提供通用 HTTP 与 DeepSeek 客户端。DeepSeek 默认保留两次 HTTP 总尝试；话题索引专用客户端可传 `retries: 1`，避免与数据库中的持久重试次数相乘。其他调用继续使用默认值。
