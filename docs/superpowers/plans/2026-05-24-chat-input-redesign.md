# Chat Input ChatGPT-Style Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ChatInputArea 输入框视觉升级为 ChatGPT 风格——柔和阴影、精致 focus 过渡、圆角箭头发送按钮。

**Architecture:** 纯 CSS 类替换，单文件 `ChatInputArea.tsx`，不接触逻辑、SCSS 或基础 UI 组件。

**Tech Stack:** React + Tailwind CSS + lucide-react (ArrowRight)

---

### Task 1: 更换发送按钮图标和尺寸

**Files:**
- Modify: `frontend/src/components/ChatInputArea.tsx:12,84-94`

- [ ] **Step 1: 导入 ArrowRight 替换 Send**

```tsx
// line 12: 修改 import
import { Send, Loader2 } from 'lucide-react';
// →
import { ArrowRight, Loader2 } from 'lucide-react';
```

- [ ] **Step 2: 更新按钮 JSX**

```tsx
// line 80-94: 替换按钮
<Button
  onClick={onSend}
  disabled={loading || !input.trim()}
  size="icon"
  className={cn(
    "h-9 w-9 rounded-full transition-all duration-200 shrink-0",
    input.trim()
      ? "bg-foreground text-background shadow-[0_2px_8px_rgba(0,0,0,0.15)] hover:bg-foreground/90"
      : "bg-muted text-muted-foreground"
  )}
>
  {loading ? (
    <Loader2 className="h-4 w-4 animate-spin" />
  ) : (
    <ArrowRight className="h-4 w-4" />
  )}
</Button>
```

变更点：
- `h-8 w-8` → `h-9 w-9`
- `mb-1 mr-1` 移除
- `bg-primary text-primary-foreground` → `bg-foreground text-background`
- `hover:bg-muted` 从禁用态移除
- 新增 `transition-all duration-200`
- 新增激活态 `shadow-[0_2px_8px_rgba(0,0,0,0.15)]` + `hover:bg-foreground/90`
- `Send` → `ArrowRight`

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/ChatInputArea.tsx
git commit -m "feat: 升级 ChatInputArea 按钮——ArrowRight 图标、圆形 36px、过渡动画、激活态微阴影"
```

---

### Task 2: 升级输入框容器样式

**Files:**
- Modify: `frontend/src/components/ChatInputArea.tsx:69`

- [ ] **Step 1: 替换容器 div 的 className**

```tsx
// line 69: 替换外层 div 的 className
<div className="relative w-full max-w-[800px] flex items-end gap-2 p-2 rounded-[26px] bg-background border shadow-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
// →
<div className="relative w-full max-w-[800px] flex items-end gap-2 p-2 rounded-[30px] bg-background border border-border/60 shadow-[0_2px_6px_rgba(15,23,42,0.02),0_8px_24px_rgba(15,23,42,0.03)] ring-offset-background focus-within:border-border focus-within:shadow-[0_4px_12px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06)] transition-all duration-200">
```

变更点：
- `rounded-[26px]` → `rounded-[30px]`
- `shadow-sm` → 多层微阴影
- `border` → `border border-border/60`（半透明边框）
- `focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2` → 阴影加深 + 边框恢复不透明
- 新增 `transition-all duration-200`

- [ ] **Step 2: 验证视觉效果**

```bash
cd frontend && npm run dev
```

打开 `/chat` 页面，确认：
- 输入框圆角更圆润
- 阴影柔和
- 点击输入框时 focus 过渡流畅
- 输入文字后发送按钮变黑底白箭头 + 微阴影
- 加载中时按钮显示旋转动画

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/ChatInputArea.tsx
git commit -m "feat: 升级 ChatInputArea 容器——30px 圆角、多层微阴影、柔和 focus 态、平滑过渡"
```
