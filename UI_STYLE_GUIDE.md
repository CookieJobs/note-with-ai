# NoteWithAI 极简浅色 UI 规范指南 (UI Style Guide)

## 设计哲学 (Design Philosophy)
- **极简主义 (Minimalism)**: 剥离多余的装饰，保留核心内容。
- **高对比度，低饱和度**: 大量使用浅灰色和白色作为基底，深灰/纯黑作为文本，用极其克制的彩色作为点缀。
- **轻量感 (Lightness)**: 抛弃厚重的阴影、深色背景和粗糙的边框，通过柔和的圆角和微弱的线条来划分层级。
- **呼吸感 (Whitespace)**: 增加组件间的间距和内边距，让页面显得不拥挤。

---

## 1. 颜色系统 (Color System)

### 1.1 背景色 (Backgrounds)
- **全局背景**: `bg-gray-50` (极浅灰，用于页面底层)
- **卡片/内容区背景**: `bg-white` (纯白，用于浮在底色上的模块)
- **Hover/激活态背景**: `bg-gray-50` 或 `bg-gray-100` (用于交互元素的轻微反馈)

### 1.2 文本色 (Typography Colors)
- **主要文本 (Primary Text)**: `text-gray-900` (如标题、用户输入内容，强烈的黑色)
- **次要文本 (Secondary Text)**: `text-gray-700` 或 `text-gray-600` (如正文、描述)
- **辅助文本 (Tertiary Text)**: `text-gray-500` 或 `text-gray-400` (如时间戳、占位符、次要图标)

### 1.3 边框色 (Borders)
- **基础边框**: `border-gray-100` (极其微弱的线条，用于模块分割)
- **强调边框**: `border-gray-200` (用于输入框或需要稍微突出的元素)

### 1.4 状态色 (Status Colors)
- **危险/删除 (Danger)**: `text-red-500` / `bg-red-50` / `text-red-600`
- **主题/强调 (Primary Accent)**: `text-blue-600` / `bg-blue-50` / `bg-blue-600` (按钮)
- **成功/积极 (Success)**: `text-emerald-600` / `bg-emerald-50`

---

## 2. 阴影与圆角 (Shadows & Border Radius)

### 2.1 阴影 (Shadows)
- **极简阴影**: 绝不使用厚重的深色阴影。
- **默认卡片/按钮**: `shadow-sm` (极轻微的弥散阴影)
- **浮层/下拉菜单/弹窗**: `shadow-lg` 配合 `border border-gray-100`，确保有足够的层级感但依然轻盈。

### 2.2 圆角 (Border Radius)
- **小元素 (标签/小按钮)**: `rounded-md` 或 `rounded-full` (药丸样式)
- **常规卡片/输入框**: `rounded-xl`
- **大型浮层/容器**: `rounded-2xl`

---

## 3. 核心组件规范 (Components)

### 3.1 导航栏 (Navigation)
- **背景**: 纯白或浅灰 (`bg-gray-50`)，去除毛玻璃 (`backdrop-filter-none`)。
- **边框**: 底部单线 `border-b border-gray-100`。
- **菜单项**: 默认文本色 `text-gray-500`，Hover 变 `bg-gray-100 text-gray-900 rounded-lg`。

### 3.2 卡片 (Cards)
- **结构**:
  ```html
  <div className="bg-white shadow-sm border border-gray-100 rounded-xl p-6">
    <!-- Content -->
  </div>
  ```
- **原则**: 卡片之间通过间距 (`gap`) 或浅色底板区分，不需要强烈的区块感。

### 3.3 按钮 (Buttons)
- **主按钮 (Primary)**: `bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 border-none`
- **次按钮 (Secondary/Cancel)**: `bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 rounded-lg px-4 py-2`
- **幽灵按钮 (Ghost/Icon)**: `bg-transparent text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-md border-none`

### 3.4 标签 (Tags/Pills)
- **药丸样式**:
  ```html
  <span className="bg-gray-100 text-gray-600 rounded-full px-3 py-1 text-xs border-none">
    标签文本
  </span>
  ```
- **彩色标签**: 使用对应颜色的 `50` 背景和 `600` 文本色，如 `bg-blue-50 text-blue-600`。

### 3.5 输入框 (Inputs)
- **结构**:
  ```html
  <input className="bg-white rounded-xl border border-gray-200/50 shadow-sm text-gray-900 px-4 py-2 focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
  ```
- **原则**: 保证内部留白，边框在 focus 时有柔和的高亮。

### 3.6 下拉菜单 / 浮层 (Dropdowns / Tooltips)
- **结构**:
  ```html
  <div className="bg-white shadow-lg border border-gray-100 rounded-xl py-2">
    <!-- Menu Items -->
  </div>
  ```
- **菜单项**: `flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900`

---

## 4. 实施指南 (Implementation in current codebase)
由于目前项目主要使用 CSS Modules，为了快速且不破坏原有复杂逻辑地应用此规范，**推荐做法**是：
在原有 `className` 后面追加 Tailwind CSS 实用类，并使用 `!` (important) 修饰符来覆盖旧有样式。

例如：
```tsx
<div className={`${styles.oldCard} !bg-white !border !border-gray-100 !shadow-sm !rounded-xl`}>
  {/* ... */}
</div>
```
这样可以在后续的重构和新功能开发中，保持视觉风格的绝对统一。