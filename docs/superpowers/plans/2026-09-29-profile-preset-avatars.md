# 个人中心预设头像实施计划

> **供智能体执行：** 必须使用子技能 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项执行本计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 将新头像选择改为 8 款本地预设和姓名首字母选项，同时保留现有自定义 URL 头像，直到用户主动选择其他选项。

**架构：** 新选择仅存储稳定的本地选项键（`preset:initials` 或 `preset:01` 到 `preset:08`）。从应用打包的资源渲染这些键；旧 URL 字符串保持可读，除非用户明确保存了其他选项，否则不做更改。使用原生单选组选择器管理预览和草稿状态；个人中心页面弹窗负责保存/取消。

**技术栈：** Next.js/React、TypeScript、SVG 资源、Express/Zod、Vitest、通过 `tsx` 执行的 Node `node:test`。

**规格：** `docs/superpowers/specs/2026-09-29-profile-rework-design.md`

## 全局约束

- 提供恰好 8 款打包在应用中的本地预设，不带性别暗示，并提供姓名首字母选项。
- 预览和选择属于弹窗内草稿状态；仅“保存”会持久化；取消/关闭会丢弃更改。
- 不提供新的上传控件或外部 URL 输入。
- 现有自定义 `User.avatar` URL 持续显示且保持不变，直到用户主动选择。
- 新保存的选项使用稳定键 `preset:initials` 或 `preset:01` … `preset:08`。
- 预设选择必须支持键盘操作，且屏幕阅读器可通过可访问名称和选中状态辨识。

## 审查重点

- 仅保存用户名时，更新请求不得包含 `avatar`，并且必须保留现有 URL。
- 打开并取消弹窗不得写入头像键。
- 旧 URL 必须照常渲染；新的预设标识只能解析为本地资源。
- 方向键/空格交互必须更新预览和选中的单选项状态。
- 未知的非空旧头像值不得被清除，也不得被解释成 UI 新输入的外部值。

---

### 任务 1：添加本地预设注册表和可访问选择器

**文件：**

- 新建：`frontend/public/avatars/profile-preset-01.svg` … `profile-preset-08.svg`
- 新建：`frontend/src/app/profile/avatarPresets.ts`
- 新建：`frontend/src/app/profile/AvatarPicker.tsx`
- 新建：`frontend/src/app/profile/AvatarPicker.module.scss`
- 新建：`frontend/src/app/profile/AvatarPicker.test.tsx`

**接口：**

- `type AvatarSelection = 'preset:initials' | 'preset:01' | ... | 'preset:08'`。
- `resolveAvatarDisplay(value: string | undefined, username: string): { kind: 'preset' | 'legacy-url' | 'initials'; src?: string; initials: string }` 仅将预设键映射到打包在应用中的资源，并将旧值保留为旧 URL。
- `<AvatarPicker value: AvatarSelection | null; legacyAvatarUrl?: string; username: string; onChange(value: AvatarSelection)>` 是受控原生单选组。`null` 表示保留并预览已有旧 URL，不表示持久化。

- [ ] **步骤 1：编写失败的选择器测试**，测试名为 `恰好渲染八款预设和首字母选项且标签可访问`、`支持键盘单选并更新预览`、`将预设键映射到本地资源` 和 `保持旧 URL 的旧值显示模式`。
- [ ] **步骤 2：运行** `cd frontend && npx vitest run src/app/profile/AvatarPicker.test.tsx`。预期：因组件/注册表不存在而失败。
- [ ] **步骤 3：实现八款打包在应用中的抽象/本地 SVG，并使用原生 `fieldset`/`legend` 单选选择器**。单选项标签提供可访问名称；原生选中状态呈现选择情况；预览解析为本地资源、姓名首字母或未更改的旧 URL。旧 URL 初始状态下不选中任何预设。
- [ ] **步骤 4：运行** `cd frontend && npx vitest run src/app/profile/AvatarPicker.test.tsx && npm run typecheck`。预期：通过；验证资源注册表恰好有八个预设键，并目视检查八款均保持抽象且无性别暗示。
- [ ] **步骤 5：提交** `git add frontend/public/avatars/profile-preset-*.svg frontend/src/app/profile/avatarPresets.ts frontend/src/app/profile/AvatarPicker.tsx frontend/src/app/profile/AvatarPicker.module.scss frontend/src/app/profile/AvatarPicker.test.tsx && git commit -m "feat: add local profile avatar presets"`。

### 任务 2：确保头像仅按选择更新并兼容旧值

**文件：**

- 修改：`frontend/src/app/profile/page.tsx`
- 修改：`frontend/src/app/profile/page.test.tsx`
- 修改：`frontend/src/services/userService.ts`
- 修改：`backend/schemas/authSchemas.ts`
- 新建：`backend/tests/profileAvatarContract.test.ts`

**接口：**

- `updateProfile({ username, avatar? })` 仅在用户于当前弹窗会话中主动选择预设时才发送 `avatar`。
- 后端仅接受 `preset:initials | preset:01…preset:08` 作为头像写入值；个人资料读取继续原样返回旧 `User.avatar` URL 字符串。
- 个人中心主页面和弹窗预览均使用 `resolveAvatarDisplay`；旧 URL 显示为已有状态，但不能作为新外部 URL 在界面中重新输入或编辑。
- 未存储头像时使用姓名首字母作为视觉回退；无关的个人资料保存不得隐式持久化头像选项。

- [ ] **步骤 1：编写失败的测试**，测试名为 `仅保存用户名时省略 avatar 并保留旧 URL`、`取消或关闭时丢弃头像草稿`、`显式保存预设时写入其稳定键`、`渲染旧头像且不做转换` 和 `头像校验结构拒绝新提交的外部 URL`。
- [ ] **步骤 2：运行** `cd frontend && npx vitest run src/app/profile/page.test.tsx`；`cd backend && npx tsx --test tests/profileAvatarContract.test.ts`。预期：因当前 URL 文本输入/头像写入行为而失败。
- [ ] **步骤 3：将受控选择器集成到编辑弹窗**，并将草稿初始化为已有预设、旧 URL 对应的 `null`，或未设置时的姓名首字母视觉回退。跟踪用户是否明确选择。仅在用户明确选择后发送 avatar；写入值限制为规范键；无关个人资料保存时不得修改已有旧值。
- [ ] **步骤 4：运行** `cd frontend && npx vitest run src/app/profile/AvatarPicker.test.tsx src/app/profile/page.test.tsx && npm run typecheck`；`cd backend && npx tsx --test tests/profileAvatarContract.test.ts && npm run typecheck`。预期：通过。
- [ ] **步骤 5：提交** `git add frontend/src/app/profile/page.tsx frontend/src/app/profile/page.test.tsx frontend/src/services/userService.ts backend/schemas/authSchemas.ts backend/tests/profileAvatarContract.test.ts && git commit -m "feat: use local profile avatar selections"`。

## 规格覆盖自审

- 八款本地插画、首字母回退、无性别暗示的样式、预览和单选：任务 1。
- 键盘和屏幕阅读器交互：任务 1 测试原生单选契约。
- 保存/取消、仅更新用户名、不允许外部 URL 输入、稳定预设存储：任务 2。
- 旧 URL 显示和保留；不进行批量迁移：任务 1–2。
- 先执行计划 A 和 B：A 建立个人中心核心页面/弹窗接线；B 建立话题组件/页面组合。随后计划 C 只修改头像相关的弹窗与显示集成。
