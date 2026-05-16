# Note Input Box Redesign

## Summary

优化 `/notes` 页面笔记输入框（FloatingQuickCompose）展开态的视觉样式，以及全屏按钮的位置和样式。

## Current State

- **展开框**：白色背景 + 极淡灰边框，但整体缺乏层次感
- **全屏按钮**：位于 RichTextEditor 的 `toolbarRight` 区域，独占一行工具栏，左边大面积空白，按钮 30x30px 颜色淡（`#cbd5e1`），在白色背景上几乎看不见

## Design Decisions

- 浅色白色卡片风格，与笔记卡片和全站内容区保持一致
- 展开框 20px 大圆角，营造柔和现代感
- 全屏按钮改为右上角紧凑标签式按钮（图标 + "全屏"），不再独占一行
- 统一蓝色 #2563eb 作为强调色，全屏按钮和保存按钮共用同一色系
- 内部不再嵌套编辑器背景框，减少视觉噪声
- 按钮圆角保持原来的 8px（rounded-lg）

## Visual Spec

### 折叠态

- 背景：`#fff`
- 圆角：`20px`
- 边框：`1px solid rgba(0,0,0,0.04)`
- 阴影：`0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)`
- Padding：`14px 24px`
- 文字：`#9ca3af`，字号 14px

### 展开态

- 背景：`#fff`
- 圆角：`20px`
- 边框：`1px solid rgba(0,0,0,0.04)`
- 阴影：`0 1px 3px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.06)`
- Padding：`20px 24px`

### 全屏按钮

- 位置：展开框内右上角
- 背景：`#eff6ff`（浅蓝）
- 边框：`1px solid rgba(37,99,235,0.15)`
- 圆角：`8px`
- Padding：`5px 10px`
- 图标 + "全屏" 文案
- 图标和文字颜色：`#2563eb`

### 编辑区

- 无内部背景框、无内部边框
- Placeholder 颜色：`#9ca3af`

### 底部分隔线

- `1px solid #f3f4f6`
- 位于编辑区和操作栏之间

### 取消按钮

- 背景：`#fff`
- 边框：`1px solid #e5e7eb`
- 文字：`#6b7280`
- 圆角：`8px`
- Padding：`6px 16px`

### 保存按钮

- 背景：`#2563eb`
- 文字：`#fff`，font-weight 600
- 圆角：`8px`
- Padding：`6px 16px`

### 快捷键提示

- 文字：`#d1d5db`，字号 11px
- 位于底部操作栏左侧

## Files to Modify

1. `frontend/src/app/notes/components/v2/FloatingQuickCompose.tsx` — 移除 `toolbarRight` 中的全屏按钮，改为在展开态内部直接渲染；调整 JSX 结构
2. `frontend/src/app/notes/styles/floating-compose.module.scss` — 重写 `.floatingComposeExpanded`、`.floatingComposeMaxBtn` 相关样式；新增全屏标签按钮样式
3. `frontend/src/app/notes/components/RichTextEditor.tsx` — 可能不需要改，如果不再传 `toolbarRight`，工具栏区域自然消失

## Out of Scope

- 全屏模式（`?mode=fullscreen`）本身的样式
- 笔记卡片的样式
- 富文本编辑器的格式化工具栏
