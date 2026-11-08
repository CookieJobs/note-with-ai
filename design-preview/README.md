# NoteWithAI 整体 UI 主稿与风格升级提案

本目录保留整体 UI 主稿，以及 2026-10-27 基于最新代码功能制作的风格升级提案。两份都是独立 HTML 交互预览，不代表生产实现已完成。

## 记忆卡牌风格升级提案（2026-10-27）

- [打开 HTML](notewithai-memorydeck-workspace.html)
- [设计说明与功能对齐](notewithai-memorydeck-workspace-notes.md)
- [验收截图](shots/memorydeck-workspace/)

以 2026-10-25 Memory Deck 的视觉语言为准，套用到最新工作区：左侧栏、笔记列表/阅读/编辑、AI 对话与来源快照、灵感研究、个人页与设置。Memory Deck 的抽卡、撞卡、卡片编号、字数统计与「小光」人格没有迁入，功能口径以最新代码为准。预览数据与 AI 回复均为本地模拟，产品代码未改动。

## 整体 UI 主稿（2026-10-23）

- [打开整合版 HTML](2026-10-23-整体UI-DeepSeek与Codex整合版.html)
- [设计说明与功能边界](notewithai-unified-design-notes.md)

主稿在 DeepSeek harness + DeepSeek v4.1 Flash 原作基础上由 Codex 整合，包含笔记、阅读与编辑、AI 对话、灵感、个人页面和设置。CSS、JavaScript、SVG 与模拟数据全部内置，无需后端。

登录、注册、重置密码页面沿用现有产品样式，不在本次 UI 改版范围内。

### 主稿验收截图

- [笔记首页](notewithai-unified-notes.png)
- [普通对话](notewithai-unified-chat.png)
- [笔记开场](notewithai-unified-note-chat.png)
- [上下文设置](notewithai-unified-settings.png)

本目录保留视觉主稿及其配套证据，HTML 内容保持原样。它记录原型阶段，不代表全部模拟功能已进入产品；现行行为见[产品范围](../PRODUCT.md)与[工作区发布记录](../docs/releases/2026-10-workspace-ui.md)。
