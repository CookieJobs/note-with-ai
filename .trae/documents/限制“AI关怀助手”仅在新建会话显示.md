## 目标
- 仅在“新建对话且尚未发送任何消息”的情况下展示 AI 关怀助手。
- 进入已有会话或一旦发送第一条消息后，助手面板不再显示。

## 前端改动
- 在 `frontend/src/app/chat/page.tsx` 中，按条件渲染 `CareAssistantPanel`：
  - 仅当 `currentSession` 存在且 `currentSession.messages.length === 0` 时渲染。
  - 使用现有 `messages` 变量判断：`messages.length === 0`。
- 保持输入框始终可见；助手面板挂载时才触发拉取开场白（避免无意义请求）。
- 无需更改样式与组件逻辑，现有 `CareAssistantPanel` 的加载/重试/插入/直接发送交互保持不变。

## 验收
- 新建会话 → 显示助手面板。
- 发送第一条消息 → 面板消失。
- 切换到已有会话 → 无面板显示。