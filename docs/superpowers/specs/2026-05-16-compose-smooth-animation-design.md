# Compose 平滑形变动画设计

## 目标

笔记输入框在收起态、展开态、全屏态之间切换时，始终保持同一个元素在连续形变，消除当前 `AnimatePresence mode="wait"` 导致的空白帧和跳变。

## 当前问题

| 切换 | 问题 |
|------|------|
| 收起→展开 | `AnimatePresence mode="wait"` 先退场再入场，中间有空白帧 |
| 展开↔全屏 | DOM 结构不同，`layoutId` 勉强 morph 但内容跳动 |
| 全屏→展开 | 主动设置 `sharedLayoutEnabled=false` 禁掉动画，等于跳变 |

## 方案：统一 layoutId 形变

### 组件结构

```
motion.div  layout + layoutId  ← 唯一外壳，始终存在
  ├── 收起内容  (opacity 切换)
  ├── 展开内容  (opacity 切换)
  └── 全屏内容  (opacity 切换)
```

三种状态共用一个 `motion.div` 外壳，通过 className 切换尺寸/圆角/定位。内部内容用 `AnimatePresence` 独立做淡入淡出。

### 形变参数

**外壳**：`spring { stiffness: 200, damping: 25, mass: 0.8 }`

**内容**：`duration: 0.2s, ease: [0.22, 1, 0.36, 1]`，进入延迟 0.05s，退出无延迟

**时间线**：
```
0ms     → 外壳形变开始
0-150ms → 旧内容淡出
120-300ms → 新内容淡入（延迟让外壳先撑开）
```

### 移除项

- `AnimatePresence mode="wait"` 包裹
- 收起/展开各自独立的 `key` 元素
- `sharedLayoutEnabled` 状态和禁用逻辑
- 全屏元素的独立 `initial/animate/exit` 动画
- CSS `transition` 属性上的重复动画（与 framer-motion 冲突）

### 边界情况

| 场景 | 行为 |
|------|------|
| 快速连点 | spring 动画天然支持中断，从当前状态平滑过渡 |
| Escape 全屏 | 平滑缩回展开态 |
| 点击外部收起 | 平滑缩回收起态 |
| 全屏提交 | 一步缩回收起态，不经过展开态中转 |
| 有草稿收起 | 收起条显示"继续编辑草稿…"+ 蓝色圆点，fade 过渡 |

### 涉及文件

- `frontend/src/app/notes/components/v2/FloatingQuickCompose.tsx`
- `frontend/src/app/notes/styles/floating-compose.module.scss`

### CSS 状态驱动

收起/展开/全屏三种状态通过一个 `data-state` 属性区分，CSS 据此切换样式：

```
data-state="collapsed" → relative, width:100%, max-width:800px, border-radius:12px
data-state="expanded"  → relative, width:100%, max-width:800px, border-radius:20px  
data-state="fullscreen" → fixed inset-0, border-radius:0
```
