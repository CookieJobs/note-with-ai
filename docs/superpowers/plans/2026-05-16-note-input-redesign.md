# Note Input Box Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化笔记输入框展开态样式，将全屏按钮从独立工具栏移至展开框内右上角，统一浅色白色风格。

**Architecture:** 重写 `floating-compose.module.scss` 的折叠态和展开态样式（深色玻璃 → 浅色白色），更新 `FloatingQuickCompose.tsx` 移除 `toolbarRight` 并在展开态 JSX 中直接渲染全屏标签按钮。RichTextEditor.tsx 无需改动。

**Tech Stack:** React, TypeScript, SCSS Modules, Framer Motion

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/app/notes/styles/floating-compose.module.scss` | Modify | 折叠态、展开态、全屏按钮、编辑区、底部操作栏样式 |
| `frontend/src/app/notes/components/v2/FloatingQuickCompose.tsx` | Modify | 全屏按钮位置迁移、清理 inline style overrides |

---

### Task 1: Rewrite SCSS — collapsed bar & expanded shell

**Files:**
- Modify: `frontend/src/app/notes/styles/floating-compose.module.scss`

Replace the dark glass styles for `.floatingComposeBar`, `.floatingComposeExpanded`, and remove related pseudo-elements. Replace with light white card styles.

- [ ] **Step 1: Replace `.floatingComposeBar` styles (lines 287-317)**

Replace the current dark glass `.floatingComposeBar` with light white collapsed state:

```scss
.floatingComposeBar {
  position: relative;
  width: 100%;
  border-radius: 20px;
  border: 1px solid rgba(0, 0, 0, 0.04);
  background: #fff;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 4px 16px rgba(0, 0, 0, 0.04);
  display: flex;
  align-items: center;
  padding: 14px 24px;
  text-align: left;
  cursor: pointer;
  transition:
    box-shadow 220ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 180ms ease;
  will-change: transform, opacity, box-shadow;
}
```

- [ ] **Step 2: Remove `.floatingComposeBar::before` pseudo-element (lines 319-338)**

Delete the entire `::before` block — it's dark glass specific.

- [ ] **Step 3: Replace `.floatingComposeBarText` (lines 340-344)**

```scss
.floatingComposeBarText {
  font-size: 14px;
  font-weight: 400;
  color: #9ca3af;
}
```

- [ ] **Step 4: Replace `.floatingComposeBarInner` (lines 346-353)**

```scss
.floatingComposeBarInner {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
}
```

- [ ] **Step 5: Replace `.floatingComposeDraftDot` (lines 355-362)**

```scss
.floatingComposeDraftDot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
  animation: draftBreath 6s ease-in-out infinite;
}
```

- [ ] **Step 6: Replace hover/open state styles (lines 364-394)**

Replace `.floatingComposeHover .floatingComposeBar` and related selectors:

```scss
.floatingComposeHover .floatingComposeBar {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 8px 24px rgba(0, 0, 0, 0.06);
}

.floatingComposeHover .floatingComposeBar::before {
  /* removed — no pseudo-element in light version */
}

.floatingComposeOpen .floatingComposeBar {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 8px 24px rgba(0, 0, 0, 0.06);
}

.floatingComposeOpen .floatingComposeBar::before {
  /* removed — no pseudo-element in light version */
}
```

Actually, since `::before` is removed, clean up the hover/open blocks to only reference existing selectors:

```scss
.floatingComposeHover .floatingComposeBar {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 8px 24px rgba(0, 0, 0, 0.06);
}

.floatingComposeOpen .floatingComposeBar {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 8px 24px rgba(0, 0, 0, 0.06);
}
```

- [ ] **Step 7: Replace `.floatingComposeExpanded` (lines 396-417)**

Replace dark glass expanded shell with light white:

```scss
.floatingComposeExpanded {
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
  transition:
    box-shadow 220ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 180ms ease,
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform, opacity, box-shadow;
}
```

- [ ] **Step 8: Remove `.floatingComposeExpanded::before` (lines 423-444)**

Delete the entire `::before` block.

- [ ] **Step 9: Remove `.floatingComposeExpanded::after` (lines 446-458)**

Delete the entire `::after` block.

- [ ] **Step 10: Remove `.floatingComposeOpen .floatingComposeExpanded::before` and `::after` (lines 460-469)**

Delete both blocks.

- [ ] **Step 11: Remove `.floatingComposeMaximized .floatingComposeExpanded` (lines 471-480)**

Delete this block — replaced by simpler handling.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/app/notes/styles/floating-compose.module.scss
git commit -m "style: rewrite floating compose shell styles to light white card"
```

---

### Task 2: Rewrite SCSS — editor area & fullscreen button

**Files:**
- Modify: `frontend/src/app/notes/styles/floating-compose.module.scss`

- [ ] **Step 1: Replace `.floatingComposeEditor` (lines 520-542)**

Replace dark glass editor with clean white:

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
}
```

- [ ] **Step 2: Remove `.floatingComposeEditor::before` (lines 587-604)**

Delete the `::before` block.

- [ ] **Step 3: Remove `.floatingComposeEditor::after` (lines 606-618)**

Delete the `::after` block.

- [ ] **Step 4: Remove `.floatingComposeOpen .floatingComposeEditor::before` and `::after` (lines 620-629)**

Delete both blocks.

- [ ] **Step 5: Simplify `.floatingComposeEditor .richToolbar` (lines 631-637)**

Replace with:

```scss
.floatingComposeEditor .richToolbar {
  display: none;
}
```

- [ ] **Step 6: Replace `.floatingComposeMaxBtn` (lines 487-508) with new `.fullscreenPill`**

```scss
.fullscreenPill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 8px;
  padding: 5px 10px;
  background: #eff6ff;
  border: 1px solid rgba(37, 99, 235, 0.15);
  color: #2563eb;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;

  &:hover {
    background: #dbeafe;
  }

  &:active {
    transform: scale(0.98);
  }
}
```

- [ ] **Step 7: Replace `.floatingComposeHint` (lines 510-518)**

```scss
.floatingComposeHint {
  font-size: 11px;
  font-weight: 400;
  color: #d1d5db;
  display: inline-flex;
  align-items: center;
  height: 30px;
  line-height: 1;
}
```

- [ ] **Step 8: Update editor content selection colors (lines 548-553)**

Replace dark theme selection with light theme:

```scss
.floatingComposeEditor .richEditorContent ::selection,
.floatingComposeEditor :global(.ProseMirror) ::selection {
  background: rgba(37, 99, 235, 0.15);
  color: inherit;
}
```

- [ ] **Step 9: Remove `.floatingComposeEditor :global(.tiptap-button)` dark button overrides (lines 555-585)**

Delete lines 555-585 — the dark theme tiptap button color overrides. Not needed since editor has no formatting toolbar.

- [ ] **Step 10: Add `.composeCancelBtn` and `.composeSaveBtn` styles**

`noteEditCancel` / `noteEditSave` in note-card.module.scss are dark glass themed. Create new light button classes:

```scss
.composeCancelBtn {
  padding: 6px 16px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: #fff;
  border: 1px solid #e5e7eb;
  color: #6b7280;
  transition: background 120ms ease, border-color 120ms ease;

  &:hover {
    background: #f9fafb;
    border-color: #d1d5db;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
}

.composeSaveBtn {
  padding: 6px 16px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  background: #2563eb;
  border: none;
  color: #fff;
  transition: background 120ms ease, transform 120ms ease;

  &:hover {
    background: #1d4ed8;
  }

  &:active {
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    transform: none;
  }
}
```

- [ ] **Step 11: Commit**

```bash
git add frontend/src/app/notes/styles/floating-compose.module.scss
git commit -m "style: add fullscreenPill, compose buttons, clean up editor dark glass styles"
```

---

### Task 3: Update FloatingQuickCompose TSX

**Files:**
- Modify: `frontend/src/app/notes/components/v2/FloatingQuickCompose.tsx`

- [ ] **Step 1: Update collapsed button (lines 292)**

Remove all `!` overrides, keep only the SCSS classes:

```tsx
className={`${composeStyles.floatingComposeBar}`}
```

- [ ] **Step 2: Update collapsed button text span (lines 313)**

```tsx
className={`${composeStyles.floatingComposeBarText}`}
```

- [ ] **Step 3: Update expanded shell (lines 334)**

Remove all `!` overrides:

```tsx
className={`${composeStyles.floatingComposeExpanded} ${composeStyles.floatingComposeExpandedNoSuggest}`}
```

- [ ] **Step 4: Update editor wrapper (lines 347)**

Remove `!` overrides:

```tsx
className={`${composeStyles.floatingComposeEditor}`}
```

- [ ] **Step 5: Remove `toolbarRight` prop and add fullscreen button in JSX**

Replace lines 356-369 (the `toolbarRight` prop on RichTextEditor) with no `toolbarRight`:

```tsx
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
```

Then add the fullscreen button between the editor and the actions divider:

After the closing `</motion.div>` of the editor wrapper (line 375), add:

```tsx
{/* Divider + fullscreen pill + actions */}
<div style={{ height: 1, background: '#f3f4f6', margin: '14px 0' }} />

<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
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
```

Wait, let me reconsider the layout. Looking at the current structure:

```
expanded div
  editor (motion.div)
    RichTextEditor (with toolbarRight)
  actions (motion.div)
    hint
    cancel button
    save button
```

The new structure should be:

```
expanded div
  editor (motion.div)
    RichTextEditor (no toolbarRight)
  divider
  bottom row:
    fullscreen pill (left)
    hint (center-left)  
    cancel + save (right)
```

Actually, let me keep it simpler. The fullscreen button and the hint/keyboard shortcut can share space, with the action buttons on the right:

```
expanded div
  editor (motion.div)
    RichTextEditor (no toolbarRight)
  divider (1px #f3f4f6)
  actions row:
    fullscreen pill | hint | spacer | cancel | save
```

Let me reconsider — actually, looking at the design spec again:

- The fullscreen button should be in the top-right area of the expanded box
- The bottom has: hint (left) + cancel + save (right)

So the structure should be:

```
expanded div
  fullscreen pill (right-aligned)
  editor (motion.div)
    RichTextEditor
  divider
  actions row:
    hint (left) | cancel | save (right)
```

Let me update the plan step:

- [ ] **Step 5: Restructure JSX — move fullscreen button above editor, remove toolbarRight**

The expanded block (lines 331-402) should be restructured. Key changes:

a) Remove `toolbarRight` from RichTextEditor
b) Add fullscreen pill button above the editor, right-aligned
c) Move the divider inside the bottom area
d) Clean up all `!` overrides from bottom actions

Let me rewrite the entire expanded block for clarity:

```tsx
) : (
  <motion.div
    key="expanded"
    layout
    className={`${composeStyles.floatingComposeExpanded} ${composeStyles.floatingComposeExpandedNoSuggest}`}
    ref={expandedRef}
    initial={{ opacity: 0, y: 10, scale: 0.988 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: 6, scale: 0.992 }}
    transition={surfaceTransition}
    style={{ transformOrigin: 'center bottom' }}
  >
    {/* Fullscreen pill — top right */}
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
      initial={{ opacity: 0, y: 7, scale: 0.994 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -2, scale: 0.998 }}
      transition={contentEnterTransition}
      className={`${composeStyles.floatingComposeEditor}`}
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
      initial={{ opacity: 0, y: 8, scale: 0.996 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.998 }}
      transition={actionsEnterTransition}
      className={`${composeStyles.floatingComposeActions}`}
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
)
```

Wait, I also need to update the `.floatingComposeActions` style to include the divider as a top border. Let me update the SCSS.

- [ ] **Step 6: Update `.floatingComposeActions` SCSS (lines 708-714)**

Replace with:

```scss
.floatingComposeActions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #f3f4f6;
}
```

- [ ] **Step 7: Remove unused `cardStyles` import if no longer needed**

Check if `cardStyles` is used elsewhere in the file. If only for the old cancel/save buttons, remove the import:
```tsx
import cardStyles from '../../styles/note-card.module.scss';
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/notes/components/v2/FloatingQuickCompose.tsx frontend/src/app/notes/styles/floating-compose.module.scss
git commit -m "feat: redesign note input with light white card and fullscreen pill"
```

---

### Task 4: Verify and clean up

- [ ] **Step 1: Start dev server and visually check**

```bash
cd frontend && npm run dev
```

Open `/notes`, click the input box to expand, verify:
- Collapsed state: white bg, 20px radius, subtle shadow
- Expanded state: white card, 20px radius, fullscreen pill in top-right
- Fullscreen pill: light blue bg, blue text, "全屏" label
- Bottom actions: divider line, hint text, cancel + save buttons
- Save button: blue-600 bg, 8px radius

- [ ] **Step 2: Test fullscreen mode**

Click the fullscreen pill → should enter fullscreen mode (`?mode=fullscreen`).
Press Escape → should return to inline expanded state.

- [ ] **Step 3: Test submit and cancel**

Type some text, click Save → note should be created.
Click Cancel → input should collapse.

- [ ] **Step 4: Commit any final tweaks**

```bash
git add -A
git commit -m "chore: final polish for note input redesign"
```
