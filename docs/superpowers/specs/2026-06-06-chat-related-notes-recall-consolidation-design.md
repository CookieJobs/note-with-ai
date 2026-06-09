# Chat Related Notes Recall Consolidation — Spec

**Date**: 2026-06-06
**Status**: Approved

## Overview

收敛聊天相关笔记召回能力，消除当前在 `chatRelatedNotes` 路由与 `chatService` 中并行存在的多套实现。目标是让“新建笔记后的相关笔记召回”和“聊天结束后的会话相关笔记召回”共享同一套查询构造、阈值过滤和返回 DTO，同时下线历史冗余路由。

## Decisions

| 决策 | 选择 |
|---|---|
| 统一入口 | 保留 `/api/chat/context-related-notes` |
| 下线路由 | 删除 `/api/chat/related-notes` 与 `/api/chat/search-related-notes` |
| 统一返回 | `{ noteId, title, content, score, matchType, createdAt }` |
| 核心实现位置 | 新建后端召回服务，路由和控制器只做场景编排 |
| 前端迁移 | `useCreateNote` 与 `useChatStream` 都改用统一入口 |
| 兼容边界 | `saveSession` 的 `normalizeRelatedNotes()` 暂时保留多格式兼容 |

## Problem Statement

当前存在三条相近但不一致的相关笔记召回链路：

- `backend/routes/chatRelatedNotes.ts` 中的 `/related-notes`
- `backend/routes/chatRelatedNotes.ts` 中的 `/context-related-notes`
- `backend/routes/chat.ts` -> `chatController.searchRelatedNotes()` -> `chatService.searchRelatedNotes()`

这些实现已经出现以下漂移：

- 阈值不一致：`0.3`、`0.2` 与硬编码 `0.5`
- 查询输入不一致：单条文本、最近 6 条消息上下文、用户消息 + AI 回复双向量
- 输出结构不一致：`{ note, score }`、扁平对象、`similarity` 命名
- 路由层承载算法细节，导致调参与回归都要跨多个文件修改

## Backend Architecture

新增统一召回服务，负责以下职责：

- 从消息列表构建查询上下文
- 调用 embedding 与 `vectorStore.search()`
- 执行阈值过滤、去重、排除当前 note
- 统一映射为标准 `RelatedNote` DTO

建议结构：

```text
backend/services/chatRelatedNoteRecallService.ts
backend/routes/chatRelatedNotes.ts
backend/controllers/chatController.ts
backend/services/chatService.ts
```

### ChatRelatedNoteRecallService

统一暴露一个场景化入口：

```ts
recallFromMessages({
  userId,
  messages,
  limit,
  threshold,
  excludeNoteId,
}): Promise<RelatedNoteDto[]>
```

约束如下：

- `messages` 至少包含一条带文本内容的消息
- 服务内部默认只取最近 6 条消息构造上下文
- 上下文格式统一为 `用户: xxx` / `AI: xxx`
- 搜索时取 `limit * 2` 作为粗召回窗口，再做过滤和裁剪
- 最终按分数降序输出

### DTO

统一输出：

```ts
type RelatedNoteDto = {
  noteId: string;
  title?: string;
  content?: string;
  score?: number;
  matchType?: string;
  createdAt?: Date | string;
};
```

后端新代码只产生这一种 DTO；会话保存仍允许消费历史格式，避免老数据或本地缓存回放出错。

## Route Plan

### 保留

保留 `/api/chat/context-related-notes`，作为统一查询入口。

请求体维持：

```json
{
  "messages": [{ "role": "user", "content": "..." }],
  "threshold": 0.3,
  "limit": 5,
  "excludeNoteId": "optional"
}
```

返回体统一为：

```json
{
  "success": true,
  "data": {
    "relatedNotes": [
      {
        "noteId": "note-id",
        "title": "标题",
        "content": "内容",
        "score": 0.83,
        "matchType": "vector",
        "createdAt": "2026-06-06T00:00:00.000Z"
      }
    ],
    "count": 1
  }
}
```

### 下线

下线以下入口：

- `/api/chat/related-notes`
- `/api/chat/batch-related-notes`
- `/api/chat/search-related-notes`

本次实现中直接从后端路由移除，不保留转发兼容层。对应前端和控制器调用同步迁移。

## Frontend Migration

### useCreateNote

新建笔记后不再调用 `/api/chat/related-notes`，改为调用统一入口：

- 把新建笔记正文包装成单条 `user` 消息
- 继续透传 `excludeNoteId`
- 直接消费扁平 `RelatedNoteDto[]`

请求形态：

```json
{
  "messages": [{ "role": "user", "content": "<created.contentText>" }],
  "excludeNoteId": "<created._id>",
  "limit": 3,
  "threshold": 0.3
}
```

### useChatStream

继续调用 `/api/chat/context-related-notes`，但依赖统一后的返回结构，不再承担接口分叉适配责任。

## Error Handling

- 当 `messages` 为空或全部为空文本时，返回参数校验错误
- 当 embedding 或向量检索失败时，接口返回错误；前端维持当前“记录日志并忽略相关笔记”的降级体验
- `excludeNoteId` 仅在合法且命中结果中存在时生效，不影响其他结果返回

## Testing

### Backend

- 为统一召回服务补测试，覆盖：
- 最近 6 条消息上下文拼装
- `threshold` 生效，不再被硬编码覆盖
- `excludeNoteId` 正常排除当前 note
- 输出 DTO 结构稳定

### Frontend

- 更新 `useChatStream.test.ts`，确保统一入口和统一返回结构下测试仍通过
- 为 `useCreateNote` 的相关笔记映射补一条聚焦测试，至少覆盖扁平 DTO 到前端 `RelatedNote` 的转换

## Non-Goals

- 本次不调整聊天会话状态管理结构
- 本次不修改推荐系统 `recommendService` 的语义召回逻辑
- 本次不清理 `saveSession` 中的历史兼容解析逻辑，只确保新路径统一
