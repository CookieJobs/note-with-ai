# NoteWithAI 工作区 UI 迁移 S1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 交付公共工作区与真实笔记首页、阅读、编辑流程，作为整站迁移的可验收样板。

**Architecture:** 根布局使用按路由隔离的客户端 WorkspaceRoot，只有四个普通用户路由进入持久工作区外壳，URL 不变，认证与后台保持原样。业务仍由现有 hooks 管理，公共层提供导航保护、主题与设置；新笔记视图复用真实保存、富文本和推荐服务。

**Tech Stack:** Next.js 15、React 18、TypeScript、SCSS Modules、React Query、Tiptap、lucide-react、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-24-workspace-ui-migration-design.md`（用户 2026-10-24 批准并要求直接开始）。

## Global Constraints

- 排除全部 `/admin/**`、`/auth`、`/login`、`/register`，包括认证三种模式。
- 强调色 `#266FE1`，工作区字体/颜色/布局来自指定 HTML；不更改主稿。
- 保留 Tiptap、可选标题、手写标题 100 字符、AI 建议 60 字符、revision 冲突和异步输入保护。
- 列表按创建时间倒序；旧 `/notes?highlight=<id>` 链接可用。
- 不新增后端 API、模型调用配置、全局搜索、删除撤销、模拟数据或生产部署。
- 桌面 1440×900、1280×800、1024×768；关联栏在 1200px 切换，侧栏在 980px 附近检查。
- 当前脏工作树是有效基线；分支 `codex/workspace-ui-migration`，初始源码备份 `.superpowers/workspace-ui-migration/baseline-source.tar.gz`，禁止清理或批量提交。

## Review Focus

1. 编辑期间点击侧栏、来源或浏览器后退，三个离开分支保护同一份输入，保存失败不执行目标动作。
2. 保存请求中继续输入，响应只确认提交的版本，不能清空新文字或提前离开。
3. 直接打开未分页加载的 highlight，独立读取后可阅读/修改；删除或失败不会展示另一篇笔记。
4. 深色与字号只作用工作区，设置覆盖背景编辑器，不重建任务或将认证/后台染色。
5. 仅加载列表时不能把富文本编辑器打入公共初始包；长无标题/图片/表格不撑破阅读列。

## 文件与接口

主代理独占 `frontend/src/components/workspace/**`、`app/layout.tsx`、`components/TopNavigation.tsx`、共享 README、`DESIGN.md`、本计划和迁移进度。笔记代理独占 `app/notes/page.tsx`、新增 `NotesWorkspace.module.scss`、`components/NoteWorkspaceEditor.tsx`、`components/NoteWorkspaceReader.tsx`、对应测试、notes README，以及必要的 `hooks/useNoteEditor.ts` 返回值调整。不得修改其他页面业务。

公共接口（位于 `frontend/src/components/workspace/WorkspaceContext.tsx`）：

```ts
export type WorkspaceRecentNote = { id: string; title: string; href: string };
export type WorkspaceEditor = {
  isDirty: () => boolean;
  isSaving: () => boolean;
  save: () => Promise<boolean>;
  discard: () => boolean | void;
  focus?: () => void;
};
export type WorkspaceContextValue = {
  navigate: (href: string) => void;
  requestAction: (action: () => void) => void;
  registerEditor: (editor: WorkspaceEditor) => () => void;
  setRecentNotes: (notes: WorkspaceRecentNote[]) => void;
};
export function useWorkspace(): WorkspaceContextValue | null;
```

无 Provider 时 hook 返回 null，保留隔离组件可测性。登记编辑器返回清理函数；getter 读取最新状态，save 只有真实成功且无后来修改时返回 true。页面主动按钮通过 `requestAction`，链接由工作区捕获并走相同保护。新建统一用 `/notes?compose=1`，创建期间保留参数，保存、取消或离开后才切换 URL；页面直接由 URL 派生创建状态，不因设置打开而卸载。

### Task 1: 基线与设计约定（主代理）

- [x] 保存工作树清单、179 个前端/设计文件的哈希与源码快照，切换保留修改的工作分支。
- [x] 运行原有 test/typecheck/lint，完整日志写 `.superpowers/workspace-ui-migration/baseline-*.log`，区分既有失败。
- [x] 用新主稿更新 `DESIGN.md`；明确它是现行设计来源，实际实现进度以迁移记录为准。
- [x] 更新 Spec 为已批准、进度为 S1，恢复自动接续的实施提示。

### Task 2: 公共工作区与外观（主代理）

**Files:** Create `components/workspace/WorkspaceContext.tsx`、`WorkspaceRoot.tsx`、`WorkspaceShell.tsx`、`WorkspaceSettings.tsx`、`Workspace.module.scss`、`Workspace.test.tsx`、`README.md`; Modify `app/layout.tsx`、`components/TopNavigation.tsx`、所属 README。

- [x] 先写测试：四个普通路由有外壳；`/auth` 与 `/admin` 不进入；折叠后导航可达；设置关闭保留子组件输入；主题偏好恢复并不修改 html/body；账户菜单 Escape 恢复焦点。
- [x] `npx vitest run src/components/workspace/Workspace.test.tsx`，先观察正确原因失败。
- [x] 实现 scope、共享上下文、260/64px 侧栏、轻量顶栏、真实用户菜单与灵感徽标；主内容剩余高度滚动，不双重占据 100vh。TopNavigation 在新外壳内停止绘制旧导航，独立/排除环境仍沿用原实现。
- [x] 实现上下文设置的外观分组：浅/深/系统、15/16/18px、减少动态。S1 账户提供前往真实个人页，灵感提供前往真实设置位置；S3 再整合真实表单/开关，不能放假开关。
- [x] 同一测试命令通过；浏览器检查初始字体/尺寸/无布局溢出。样式只作用 workspace 根节点和内部 dialog。

### Task 3: 公共未保存保护（主代理，与笔记模块接口并行）

**Files:** Above context/shell; Create `WorkspaceNavigation.tsx`（若职责需要拆出）；Test `Workspace.test.tsx`。

- [x] 先写三分支、失败不导航、保存期间二次动作、编辑器注销不能清掉新登记、beforeunload、返回恢复的测试。
- [x] 实现唯一待执行动作、三按钮确认、最新 getter、失败/重复提交保护；原生 beforeunload。所有窗口事件只在工作区挂载期间存在，注销后恢复。
- [x] 浏览器后退/前进必须实际检查，不能只测应用内按钮。必要时为 workspace history 条目登记不覆盖 Next 状态的索引，取消回原条目，确认才重放目标。
- [x] 相关测试通过，保存失败/冲突时草稿不丢。若原生浏览器机制有具体限制，以真实证据记录并修复，不静默降级。

### Task 4: 真实笔记列表、阅读和编辑（笔记代理）

**Files:** 见上方独占清单。可复用现有 FloatingQuickCompose、RichTextViewer、NoteTitleField、useNotes/useCreateNote/useNoteEditor/useFocusedSourceNote、RelatedNotesDrawer。共享样式只通过 workspace tokens 消费。

- [x] 先写 `app/notes/page.test.tsx`：列表点开阅读；highlight 未在列表时显示独立来源；返回列表保留选择上下文；创建入口；相关栏只在主动开启时显示。
- [x] 先写 `NoteWorkspaceEditor.test.tsx`：复用显式保存；保存失败留在编辑；登记保护读取当前 dirty 状态；Ctrl/Cmd+Enter；标题与正文同事务；修改期间打开设置不注销编辑器。
- [x] 运行对应测试，观察失败后实现页面：800px 主列、时间分组、快速记录；读写分离，无标题直接正文，列表用真实摘录；保留分页和读取错误重试。
- [x] 实现编辑壳层并复用 hook。若 hook 原 save 无结果，改为 `Promise<boolean>`，所有失败/并发/迟到返回 false，只有已确认且无后来草稿返回 true；既有调用者忽略布尔值仍兼容。
- [x] 新建用现有草稿 hook，应用内动作统一登记保护；取消 dirty 编辑先经过保护；保存成功回阅读，期间再输入留在编辑。
- [x] 保留真实删除确认、推荐刷新、来源 revision。右侧 330px/1200px，窄桌面抽屉；不改推荐/标题后端。
- [x] 运行新增及既有 note hooks、ModernNoteCard、rich editor、related drawer 回归；报告准确文件与结果，禁止提交或改公共文件。

### Task 5: 整合、独立检查与 S1 浏览器验收（主代理 + 只读审阅者）

- [x] 主代理整合接口，运行前端完整 test/typecheck/lint；基线失败独立记录。生产 build 后顺序运行 route budgets（notes 上限 1,500,000 bytes），不与 dev 共用 `.next`。
- [x] 独立代理审阅 S1 源码与基线快照的增量，聚焦五项 Review Focus、范围隔离和真实数据，不扩大到用户已有无关改动。
- [x] 实际浏览器检查列表/阅读/富文本编辑、保存刷新、取消保护三分支、浏览器返回、设置/深色/窄窗、来源和删除失败；使用隔离数据和开发测试账号，不改日常笔记。
- [x] 保存 S1 截图、真实检查日志、偏差和环境限制至 `docs/superpowers/reviews/` 与进度。真实服务不可用则准确保留联调未验收项。
- [x] 交付 S1 可运行样板，请用户确认视觉；此时进度写“等待 S1 视觉确认”，接续保持安静，不自动启动 S2/S3。

## 后续阶段

S1 视觉确认后，分别写对话迁移计划和灵感/个人设置迁移计划，复用已验证公共接口，再按 Spec C/I/P 与 A1–A10 推进；最终统一整站验收。当前计划不将那些阶段宣称已实现。

## 执行裁定

- 用户已明确要求“可以直接开始”，已同意主代理整合与子代理分模块；不额外停在第二轮计划审批。
- 当前功能依赖大量未提交工作，因此在带源码备份的新工作分支原地增量实现；不创建丢失这些改动的干净 worktree，不提交无关改动。共享代码主代理执行，笔记作为独立任务委派，结束进行独立整体审阅。
- 阶段进度与测试结果及时记录；没有用户要求时不做 git commit、push、PR 或发布。

## S1 交付状态（2026-10-25）

实现、当前检查与独立审阅完成，等待用户视觉确认。真实浏览器覆盖与自动化覆盖的区别、尚未执行的破坏性/外部模型端到端项，见 `docs/superpowers/reviews/2026-10-25-workspace-ui-s1-verification.md`；这些未验收项不能据此标为整站完成。后续阶段尚未开始。
