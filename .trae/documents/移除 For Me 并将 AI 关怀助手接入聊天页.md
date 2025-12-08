## 目标
- 删除 For Me 页面与相关后端代码。
- 在聊天页新建会话时自动启用 AI 关怀助手：打开新对话后自动插入一条来自助手的问候消息（来源 `GET /api/for-me/robot/intro`）。

## 待删除范围
- 前端：
  - 删除 `frontend/src/app/for-me/page.tsx`
  - 删除样式 `frontend/src/app/for-me/for-me.module.scss`
  - 从 `frontend/src/components/TopNavigation.tsx` 移除 `/for-me` 菜单项
- 后端：
  - 删除 `backend/routes/for-me.ts`
  - 删除 `backend/services/webSearchProvider.ts`
  - 保留 `backend/services/search.ts`（若无其他引用，可一起删除；当前作为模拟源不再需要，可一并移除）
  - 在 `backend/index.ts` 取消挂载 `/api/for-me`

## 聊天页改造
- 触发时机：新建会话后或当前会话为空消息时触发。
- 接入方式：
  - 在 `frontend/src/app/chat/page.tsx` 新建会话 `startNewSession` 调用后，发起 `authFetch('/api/for-me/robot/intro')`。
  - 将返回的 `aiOpening` 作为第一条 `assistant` 消息插入当前会话消息列表。
  - 通过已有 `updateSessionMessagesHook` 与 `saveSessionToDBHook` 写入并持久化。
- 展示样式：
  - 第一条消息上方可显示“来自 AI 关怀助手”的轻提示（沿用现有卡片风格，不额外新增复杂组件）。
  - 保留“相关笔记”检索能力与聊天交互不变。

## 后端沿用
- 机器人接口保留：`GET /api/for-me/robot/intro`（现有实现可复用，后续若你希望改名，可迁移到 `/api/chat/robot/intro`）。
- 鉴权与异常沿用：`authenticateToken` 与 `ResponseHandler.success`。

## 验证
- 打开聊天页，点击“新建会话”，自动出现来自 AI 的问候消息。
- 删除 For Me 后导航不再显示该入口；后端不再挂载 `/api/for-me` 列表/刷新接口。

## 兼容与回滚
- 若需恢复 For Me，可回滚删除的文件并恢复路由挂载。
- 若希望机器人接口改名到 `chat` 命名空间，可以在确认后进行迁移（同时更新前端调用）。