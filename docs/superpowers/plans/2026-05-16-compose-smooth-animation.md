# Compose 平滑形变动画 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 FloatingQuickCompose 三种状态（收起/展开/全屏）统一为一个 motion.div 外壳，通过 layout 形变实现连续平滑过渡。

**Architecture:** 单一 `motion.div` 外壳 + `layout` prop 驱动几何形变 + `AnimatePresence` 驱动内容淡入淡出。CSS 通过 `data-state` 属性切换尺寸/圆角/定位。移除 `sharedLayoutEnabled` hack 和 `mode="wait"` 空白帧问题。

**Tech Stack:** React, framer-motion, SCSS modules, Next.js App Router

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `frontend/src/app/notes/styles/floating-compose.module.scss` | 修改 | 添加 `data-state` 驱动样式，移除 CSS transition 冲突 |
| `frontend/src/app/notes/components/v2/FloatingQuickCompose.tsx` | 重写 | 统一外壳结构，移除 hack 逻辑，简化状态管理 |

---

### Task 1: 更新 SCSS — 添加 data-state 驱动样式

**Files:**
- Modify: `frontend/src/app/notes/styles/floating-compose.module.scss`

- [ ] **Step 1: 重写外壳和状态样式**

将 `.floatingComposeShell`、`.floatingComposeBar`、`.floatingComposeExpanded` 的样式重构为 `data-state` 驱动。

定位到 `.floatingComposeShell`（约 line 282），替换为：

```scss
.floatingComposeShell {
  width: 100%;
  max-width: 800px;
  margin: 0 auto 20px;
  will-change: transform, opacity;

  &[data-state="collapsed"] {
    position: relative;
    border-radius: 12px;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.04);
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.04),
      0 4px 16px rgba(0, 0, 0, 0.04);
    padding: 14px 24px;
    display: flex;
    align-items: center;
    cursor: pointer;

    &:hover {
      box-shadow:
        0 1px 3px rgba(0, 0, 0, 0.04),
        0 8px 24px rgba(0, 0, 0, 0.06);
    }
  }

  &[data-state="expanded"] {
    position: relative;
    overflow: visible;
    display: flex;
    flex-direction: column;
    max-height: var(--floating-expanded-max, none);
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.04);
    border-radius: 20px;
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.04),
      0 8px 32px rgba(0, 0, 0, 0.06);
    padding: 20px 24px;
  }

  &[data-state="fullscreen"] {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    border-radius: 0;
    background: #fff;
    display: flex;
    flex-direction: column;
    max-width: none;
    margin: 0;
  }
}
```

- [ ] **Step 2: 移除旧的独立样式块和 CSS transition 冲突**

删除以下不再需要的样式块（约 line 274-363）：

```scss
// 删除 .inlineCompose (line 274-280)
// 删除 .floatingComposeShell 旧定义 (line 282-285) — 已在上一步重写
// 删除 .floatingComposeBar (line 287-306) — 合并到 data-state="collapsed"
// 删除 .floatingComposeBarInner (line 315-322)
// 删除 .floatingComposeHover .floatingComposeBar (line 333-337)
// 删除 .floatingComposeOpen .floatingComposeBar (line 339-343)
// 删除 .floatingComposeExpanded (line 345-363) — 合并到 data-state="expanded"
// 删除 .floatingComposeExpandedNoSuggest (line 365-367)
```

同时，从 `.floatingComposeBar` 删除 `transition` 属性（如果 CSS 仍保留的话），因为 framer-motion 的 layout 动画会与 CSS transition 冲突。

保留的样式：`.floatingComposeBarText`、`.floatingComposeDraftDot`、`.fullscreenPill`、`.floatingComposeHint`、`.floatingComposeEditor`、`.composeCancelBtn`、`.composeSaveBtn`、`.floatingComposeActions` 以及所有 `@keyframes`。

- [ ] **Step 3: 更新 .floatingComposeEditor 的展开态样式**

在 `.floatingComposeEditor` 中添加 `data-state` 感知（line 411 附近）：

```scss
.floatingComposeEditor {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border-radius: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  padding: 0;
  flex: 1;

  & > div {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
}

/* 全屏态编辑器：撑满剩余空间 */
.floatingComposeShell[data-state="fullscreen"] .floatingComposeEditor {
  flex: 1;
  overflow-y: auto;
}
```

- [ ] **Step 4: 删除 .floatingComposeBar 和 .inlineCompose 的 CSS transition**

定位到 `.floatingComposeBar` 的 `transition` 行（约 line 301-305）和 `.floatingComposeExpanded` 的 `transition` 行（约 line 358-361），删除这些 `transition` 属性。framer-motion 的 layout 动画完全接管这些属性的过渡。

- [ ] **Step 5: 验证 SCSS 编译**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

---

### Task 2: 重写 FloatingQuickCompose.tsx — 统一外壳

**Files:**
- Modify: `frontend/src/app/notes/components/v2/FloatingQuickCompose.tsx`

- [ ] **Step 1: 删除 sharedLayoutEnabled 状态及相关逻辑**

删除以下代码：

```tsx
// 删除 (line 84):
const [hover, setHover] = useState(false);

// 删除 (line 85):
const [sharedLayoutEnabled, setSharedLayoutEnabled] = useState(true);

// 删除 (line 105-109):
const exitFullscreenWithoutSharedLayout = useCallback((nextOpen: boolean) => {
  setSharedLayoutEnabled(false);
  setOpen(nextOpen);
  exitFullscreen();
}, [exitFullscreen]);

// 删除 (line 111-113):
const exitToSmallWindow = useCallback(() => {
  exitFullscreenWithoutSharedLayout(true);
}, [exitFullscreenWithoutSharedLayout]);

// 删除 (line 151-157):
useEffect(() => {
  if (isFullscreen || sharedLayoutEnabled) return;
  const raf = requestAnimationFrame(() => {
    setSharedLayoutEnabled(true);
  });
  return () => cancelAnimationFrame(raf);
}, [isFullscreen, sharedLayoutEnabled]);

// 删除 (line 189):
const sharedLayoutId = sharedLayoutEnabled ? 'quick-compose-container' : undefined;
```

- [ ] **Step 2: 重写 exitToSmallWindow、submitAndClose、handleCancel**

替换为简化版本，不再操作 `sharedLayoutEnabled`：

```tsx
const exitToSmallWindow = useCallback(() => {
  setOpen(true);
  exitFullscreen();
}, [exitFullscreen]);

const submitAndClose = () => {
  if (!canSubmit) return;
  if (isFullscreen) {
    exitFullscreen();
  }
  setOpen(false);
  onSubmit();
};

const handleCancel = () => {
  if (isFullscreen) {
    exitFullscreen();
  }
  onCancel();
  setOpen(false);
};
```

- [ ] **Step 3: 更新过渡参数**

替换当前参数（line 191-213）：

```tsx
const shellTransition = {
  type: 'spring',
  stiffness: 200,
  damping: 25,
  mass: 0.8,
} as const;

const contentTransition = {
  duration: 0.2,
  ease: [0.22, 1, 0.36, 1] as const,
};

const contentEnterTransition = {
  duration: 0.2,
  delay: 0.05,
  ease: [0.22, 1, 0.36, 1] as const,
};
```

- [ ] **Step 4: 重写 renderContent — 统一外壳**

将整个 `renderContent` 函数替换为：

```tsx
const renderContent = () => {
  const state: 'collapsed' | 'expanded' | 'fullscreen' =
    isFullscreen ? 'fullscreen' : open ? 'expanded' : 'collapsed';

  return (
    <motion.div
      ref={rootRef}
      layout
      layoutId="quick-compose-container"
      data-state={state}
      className={`${composeStyles.floatingComposeShell}`}
      transition={shellTransition}
      // hover 效果由 CSS `[data-state="collapsed"]:hover` 处理，无需 JS 状态
    >
      <AnimatePresence initial={false} mode="wait">
        {state === 'collapsed' && (
          <motion.button
            key="collapsed"
            type="button"
            className={composeStyles.floatingComposeBarInner}
            onClick={() => setOpen(true)}
            aria-label="打开快速记录"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={contentTransition}
          >
            <motion.span
              className={composeStyles.floatingComposeBarText}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={contentTransition}
            >
              {hasDraft ? '继续编辑草稿…' : '发送消息...'}
            </motion.span>
            {hasDraft && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={contentTransition}
                className={composeStyles.floatingComposeDraftDot}
                aria-label="有草稿"
                title="有草稿"
              />
            )}
          </motion.button>
        )}

        {state === 'expanded' && (
          <motion.div
            key="expanded"
            ref={expandedRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={contentTransition}
          >
            {/* Fullscreen pill */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
              <button
                type="button"
                className={composeStyles.fullscreenPill}
                onMouseDown={(e) => e.preventDefault()}
                onClick={enterFullscreen}
                aria-label="全屏编辑"
                title="全屏编辑"
              >
                <Maximize2 size={14} />
                <span>全屏</span>
              </button>
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={contentEnterTransition}
              className={composeStyles.floatingComposeEditor}
            >
              <RichTextEditor
                value={valueJson}
                onChange={onChange}
                placeholder="此刻的想法、待办或总结..."
                showToolbar
                autoFocus="end"
                toolbarVariant="advanced"
                onModEnter={() => {
                  submitAndClose();
                }}
                className="text-gray-900 !mx-auto"
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={contentEnterTransition}
              className={composeStyles.floatingComposeActions}
            >
              <div className={composeStyles.floatingComposeHint}>Cmd/Ctrl + Enter 保存</div>
              <button
                type="button"
                className={composeStyles.composeCancelBtn}
                onClick={handleCancel}
                disabled={disabled}
              >
                取消
              </button>
              <button
                type="button"
                className={composeStyles.composeSaveBtn}
                onClick={submitAndClose}
                disabled={!canSubmit}
              >
                {loading ? '保存中...' : '保存'}
              </button>
            </motion.div>
          </motion.div>
        )}

        {state === 'fullscreen' && (
          <motion.div
            key="fullscreen"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={contentTransition}
            style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
          >
            <FullscreenHeader
              onBack={exitToSmallWindow}
              onSend={submitAndClose}
              canSubmit={canSubmit}
              loading={loading}
            />
            <div className={composeStyles.floatingComposeEditor} ref={expandedRef} style={{ flex: 1 }}>
              <RichTextEditor
                value={valueJson}
                onChange={onChange}
                placeholder="此刻的想法、待办或总结..."
                showToolbar
                autoFocus="end"
                toolbarVariant="advanced"
                onModEnter={submitAndClose}
                className="text-gray-900"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
```

- [ ] **Step 5: 检查 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: 验证页面渲染**

启动 dev server，打开 notes 页面，依次测试：
1. 点击收起条 → 展开动画是否连续
2. 点全屏 → 放大动画是否平滑
3. Escape / 点返回 → 缩回动画是否平滑
4. 快速连点 → 动画是否自然中断

```bash
cd frontend && npm run dev
```

---

### Task 3: 清理 page.tsx 中的 compose hover/open 样式类引用

**Files:**
- Modify: `frontend/src/app/notes/page.tsx`

- [ ] **Step 1: 移除 FloatingQuickCompose 上的 hover/open className**

当前代码（line 275）：
```tsx
className={`${composeStyles.inlineCompose} ${open ? composeStyles.floatingComposeOpen : ''} ${hover ? composeStyles.floatingComposeHover : ''}`}
```

这些 className 已经在新结构中不再使用（外壳由 `data-state` 驱动）。但这段代码在 FloatingQuickCompose 组件内部（line 275），不在 page.tsx 中。

确认 page.tsx 第 191 行附近的 FloatingQuickCompose 使用不需要修改——父组件没有传递 hover/open 相关的 className。

此任务为空，跳过。

---

### Task 4: 最终验证和提交

- [ ] **Step 1: TypeScript 编译验证**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/app/notes/components/v2/FloatingQuickCompose.tsx \
        frontend/src/app/notes/styles/floating-compose.module.scss
git commit -m "feat: rewrite compose animation with unified layout morph across all states"
```
