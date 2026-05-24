# Chat Input ChatGPT-Style Redesign

## Summary

将 `/chat` 页面的 `ChatInputArea` 输入框视觉升级为 ChatGPT 风格——更圆润的胶囊外形、柔和的悬浮阴影、精致的 focus 态过渡、以及协调的圆形箭头发送按钮。

## Scope

- **仅修改** `frontend/src/components/ChatInputArea.tsx`
- 不改 SCSS 模块、不改 UI 基础组件、不改页面逻辑

## Design Tokens (no new tokens, reusing existing)

所有样式通过 Tailwind 类 + 内联 `shadow-[...]` 实现，不新增 CSS 变量或 SCSS。

## Changes

### 1. 容器 (textarea 外层 div)

| 属性 | 当前 | 改为 | 原因 |
|------|------|------|------|
| `rounded` | `rounded-[26px]` | `rounded-[30px]` | 更接近 ChatGPT 的大圆角胶囊感 |
| `shadow` | `shadow-sm` | `shadow-[0_2px_6px_rgba(15,23,42,0.02),0_8px_24px_rgba(15,23,42,0.03)]` | 多层微阴影代替单层粗阴影，更精致 |
| `border` | `border` | `border border-border/60` | 半透明边框，更柔和 |
| `focus-within` | `focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2` | `focus-within:border-border focus-within:shadow-[0_4px_12px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06)]` | 去掉硬 ring，改用阴影加深 + 边框恢复实色 |
| `transition` | (无) | `transition-all duration-200` | 焦点切换有平滑过渡 |

### 2. 发送按钮

| 属性 | 当前 | 改为 | 原因 |
|------|------|------|------|
| `size` | `h-8 w-8` (32px) | `h-9 w-9` (36px) | 稍大一圈，视觉重心更足 |
| `icon` | `Send` | `ArrowRight` | ChatGPT 风格箭头图标 |
| `margin` | `mb-1 mr-1` | (移除) | 新容器间距已足够 |
| 激活态 `shadow` | (无) | `shadow-[0_2px_8px_rgba(0,0,0,0.15)]` | 激活时发送按钮有微阴影提升层次 |
| `transition` | (无) | `transition-all duration-200` | 状态切换平滑 |
| `radius` | `rounded-full` | 保持不变 | 用户要求保持圆形与胶囊容器协调 |
| 禁用态底色 | `bg-muted` | `bg-muted` | 保持不变 |

### 3. Textarea

保持不变（`bg-transparent`, `border-0`, `resize-none` 等）。

## States

### Default
- 白色胶囊容器，半透明边框，极淡阴影
- 发送按钮灰底灰箭头

### Focus
- 阴影轻微加深，边框恢复不透明
- 200ms ease 过渡

### Active (有输入文字)
- 发送按钮黑底白箭头 + 微阴影
- 200ms ease 过渡

### Loading
- 输入框 disabled，placeholder 变为 "AI正在思考中..."
- 发送按钮黑底 + 旋转 Loader2 图标

## Risks

- **Breaking**: 无。纯样式修改，不改接口不改行为。
- **Dark mode**: 使用的 `bg-background`, `border`, `shadow` 等均为语义化 Tailwind token，`shadow-[...]` 使用固定 rgba 值，深色模式下阴影仍可见但不突兀。
- **Mobile**: 容器和按钮尺寸已在移动端响应式范围内，无需额外处理。
