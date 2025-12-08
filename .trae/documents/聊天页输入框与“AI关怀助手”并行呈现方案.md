## 目标
- 在聊天页始终展示输入框（类似 ChatGPT 的主输入区）。
- 在输入框下方呈现“AI关怀助手”卡片，展示来源片段与 AI 开场白，用户可：
  - 直接在输入框提问（常规聊天）
  - 选择基于“AI关怀助手”的话题继续聊天（插入到输入框或直接发送）

## 现状与依赖
- 聊天页：`frontend/src/app/chat/page.tsx`，输入组件 `ChatInputArea`，内容区 `ChatMainContent`，会话管理 `useChatSessions`、消息管理 `useChatMessages`。
- 后端已提供：`GET /api/chat/robot/intro`（迁移完成），返回 `{ noteId, noteTitle, snippet, aiOpening }`。

## 前端实现
- 新增组件：`CareAssistantPanel.tsx`
  - 拉取：首次渲染或点击“换一个”时调用 `authFetch('/api/chat/robot/intro')`
  - 展示：
    - 标题：AI 关怀助手
    - 来源：`noteTitle`（可选）与 `snippet`
    - 开场白：`aiOpening`
    - 操作：
      - “插入到输入框”：将 `aiOpening` 插入当前输入框（追加或覆盖，采用覆盖但保留撤销）
      - “直接发送”：将 `aiOpening` 作为第一条消息发送（调用 `sendMessageHook`），并滚动到最新
      - “换一个”：重新调用接口获取新的开场白
  - 状态：`loading`/`error`/`success` 三态；失败时展示重试按钮
  - 可选：在空会话时提示“使用此话题开启对话”
- 页面集成：`frontend/src/app/chat/page.tsx`
  - 保持输入框始终可见（现有逻辑已满足）
  - 在输入框下方渲染 `CareAssistantPanel`（使用现有布局容器）
  - 将 `onInsert` 绑定为 `setInput(value)`，`onSend` 绑定为现有的 `sendMessageHook(...)`
  - 取消或保留“自动插入第一条问候”的逻辑：
    - 推荐改为不自动插入，仅显示助手卡片；用户主动选择
    - 若需保留自动插入，可加开关 `autoInsertCareIntro`，默认关闭
- 样式：扩展 `chat.module.scss`
  - 卡片样式与按钮风格与现有页面保持一致；移动端适配（窄屏堆叠）
  - 输入区与助手卡片之间合理间距；滚动容器内不出现遮挡
- 可访问性与体验
  - 键盘支持：Tab 聚焦按钮、Enter 触发；ARIA 标签
  - 状态指示：加载动画、错误提示、已插入反馈（Toast 或轻量文本）

## 后端确认
- 接口：`GET /api/chat/robot/intro` 已可用；鉴权 `authenticateToken`，返回结构统一 `ResponseHandler.success`
- 兼容：无笔记时返回兜底文案；DeepSeek 不可用时降级提示

## 交互流程
1. 用户进入聊天页，看到输入框与下方“AI关怀助手”卡片
2. 用户选择：
   - 在输入框自主提问 → 常规发送
   - 点击“插入到输入框” → `aiOpening` 放入输入框，用户可编辑后发送
   - 点击“直接发送” → 以 `aiOpening` 开始对话
   - 点击“换一个” → 获取新的开场白

## 验收标准
- 聊天页加载后输入框始终可用；助手卡片正常展示并可交互
- 插入与直接发送行为分别成功更新会话与消息列表，持久化到本地与服务器
- 在无笔记/接口异常场景下有清晰的提示与重试，不影响输入框正常使用

## 后续（可选）
- 在“继续在聊天中聊”时，附上来源笔记片段为系统提示（更强上下文）
- 支持将 `noteTitle` 作为临时会话标题前缀（便于归档）
- 记录助手卡片使用率与转化指标，优化开场文案生成策略