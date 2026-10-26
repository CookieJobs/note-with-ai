# NoteWithAI 发布前缺陷修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 修复发布前报告 R1–R6 与无修改保存的 P3，保留现有真实业务，交付可复验版本和准确的发布准备边界。

**Architecture:** 主代理在现有专用分支逐组实施，使用回归测试证明红→绿；最终一名独立代理审阅完整修复差异。账户改密的会话结束脱离表单生命周期，历史读取区分失败/成功并可重试，历史正文继续走完整 Markdown 解析器。

**Tech Stack:** Next.js、React、TypeScript、SCSS Modules、Vitest、Tiptap 与已有 tiptap-markdown。

**Spec:** `docs/superpowers/specs/2026-10-24-workspace-ui-migration-design.md`；修复依据 `docs/superpowers/reviews/2026-10-25-workspace-ui-release-risk-review.md`。

## Global Constraints

- 保留当前专用分支 `codex/workspace-ui-migration`、全部已有未提交工作、主稿和恢复快照；不 reset/clean，不提交/合并/部署。
- 排除 `/admin/**` 及登录/注册/重置密码改版；仅必要的会话辅助逻辑与测试可变更，不改后端密码或 JWT 合同。
- 本轮不新增依赖、数据迁移或模拟业务；强调色 `#266FE1` 和已验收构图保持。
- 红测、绿测和真实检查结果落盘；不得把断言缺陷存在的旧复现“通过”当成修复成功。
- 所有产品文件由 Root 单独修改；只在结束时委派只读独立审阅。
- 智能接续仅一条真实恢复时点后两分钟的单次任务；进入人工验收立即删除。

## Review Focus

1. 改密前笔记脏输入：继续编辑/保存失败不得进入改密，保存或明确放弃后才进入（Task 1）。
2. 改密请求/成功提示期间卸载与换账号：原会话须结束，不能清除后来账号凭据（Task 1）。
3. 显式会话的网络错误→恢复/再次失败/不存在，以及多次点击重试与迟到历史（Task 2）。
4. 删除完成时卸载、换用户、来源 A→B→A：旧动作不能抢导航，新页面不受影响（Task 3）。
5. 旧 Markdown 缩进代码/参考链接/Setext 标题与纯文本软换行同时保留，JSON 正文优先（Task 3）。

## Task 1: 改密前保护与成功后的会话结束

**Files:** Modify `frontend/src/components/workspace/WorkspaceShell.tsx`、`frontend/src/app/profile/components/WorkspaceAccountDialogs.tsx`；Create `frontend/src/utils/passwordChangeSession.ts` 及测试；Test `Workspace.test.tsx`、`WorkspaceAccountDialogs.test.tsx`，同步所属 README。

**Interfaces:** Shell 的 `openAccountDialog('password')` 经现有 `requestAction` 执行；资料入口维持当前行为。新增 `schedulePasswordSessionLogout(userId: string, token: string | null): void`，成功后按原 1500ms 延时检查同一用户和 token 再 logout，不依赖表单挂载。表单在请求前捕获 token，成功后先调度业务后续，再按 active 判断是否更新 UI；密码不进入本地存储或定时器闭包。

- [x] 写预期正确行为的红测：脏笔记三分支/失败，卸载前后成功、换用户或同用户新 token 不误退出，正常改密保留原校验/延时。
- [x] 运行上述定向测试并保存红测结果，确认失败来自报告问题。
- [x] 最小实现接口，清除表单取消业务退出定时器的耦合；运行账户/工作区相关测试到绿。
- [x] 保存完成范围、命令与结果，不提交 Git。

## Task 2: 对话历史可重试与错误归属

**Files:** Modify `frontend/src/hooks/useChatSession.ts`、`frontend/src/app/chat/page.tsx` 与对应测试、chat README；必要时只添加当前错误按钮的局部样式。

**Interfaces:** Hook 提供 `sessionsError: string`、`sessionsLoading: boolean`、`retrySessions: () => Promise<void>`；`sessionsLoaded` 表示本用户成功读取过服务端历史。失败不将显式会话标记为已校验；页面提供“重试加载对话”，重试期间锁重复请求并保留输入。历史请求按用户生命周期和请求代次拒绝迟到响应；不改流提交合同。普通发送接受后清理独立 `careError`，流错误仍按会话归属。

- [x] 写红测：首次 503→重试成功后同一显式会话可发、重试再次失败保留草稿、成功读到不存在仍挡发送；旧开场错误在正常发送接受后清除。
- [x] 验证红测，再实现最小历史错误/重试状态和页面动作；补重试重复点击/换用户迟到保护。
- [x] 运行聊天页、hook 与流相关用例，记录绿测；保持 source-return、committed/超时和空绑定真实行为。
- [x] 保存完成范围、命令与结果，不提交 Git。

## Task 3: 笔记迟到删除、旧格式阅读与无修改保存

**Files:** Modify `frontend/src/app/notes/page.tsx`、`components/NoteWorkspaceReader.tsx`、`components/RichTextViewer.tsx`、`components/tiptap/richTextPreset.ts`、`components/NoteWorkspaceEditor.tsx` 及相应测试、notes README。

**Interfaces:** 删除操作捕获 `discussionOwner` 同类的页面/用户/来源会话，成功只在当前会话仍有效时返回列表，不取消真实删除和既有缓存更新。Reader 优先 contentJson，否则 content/contentText 交既有 Markdown 解析器；Viewer 使用可选 `preserveLineBreaks?: boolean`，传至 `createRichTextExtensions({preserveLineBreaks})` 为 Markdown 配置 `breaks:true`，默认消费者保持原行为。干净编辑点击保存可明确返回阅读，不触发空写入。

- [x] 写红测：卸载/换用户或来源时迟到删除不导航、当前删除正常返回；缩进代码/参考链接/Setext/纯文本换行及 JSON；干净保存退出且不调用写接口。
- [x] 验证红测，再按接口最小实现；逐项定向绿测。
- [x] 运行笔记页/编辑会话/读取/富文本相关测试；保存结果，不提交 Git。

## Task 4: 独立审阅、全量与浏览器验证、发布准备

**Files:** 验证报告、当前 recovery、必要的本次发布准备文档；不覆盖旧后台部署指南。

- [x] 从修复前快照生成精确差异，委派一名只读 reviewer，核对 R1–R6/P3 与新增边界；确认问题按红→绿修正并定向复核。
- [x] 全量 `npm test`、`npm run typecheck`、`npm run lint`；在独立前端副本 build 与 notes route budget。只因新改动/失败再重复必要检查。
- [x] 浏览器实际检查设置改密前脏笔记保护、干净保存、历史重试入口及旧格式阅读；真实密码提交仅在隔离本机测试账号、已知可恢复凭据的条件下执行并恢复，绝不修改日常/线上账号；无法安全完成的情形记录准确边界。
- [x] 提供准确变更/依赖清单及预发布、回滚准备，未读取真实现网版本则明确未核对；不冒称已可独立部署前端，不自动登录线上或执行发版。
- [x] 落盘最终检查、截图和已解决问题；删除接续任务，交付并等待用户确认。

## 执行裁定

用户“好的，请开始”已批准报告中的具体修复和随后验收，不再要求重复审核该实施计划。使用主代理 inline 实施以减少多份上下文与共享文件冲突，结束时保留独立审查。沿用既有专用分支和快照隔离策略；未提交历史工作不适合搬到缺少依赖的干净 worktree。恢复证据需保留，直到最终版本提交接管恢复能力后再考虑清理。


## 2026-10-26 完成状态

修复、585项全量、typecheck/lint、独立build/notes预算、独立审查和浏览器复验完成。详见 ../reviews/2026-10-26-workspace-ui-release-fixes-verification.md。真实新密码提交仍按浏览器工具的凭据变更交接要求留给本人，不以接口绕过；自动回归覆盖其生命周期/身份行为。发布依赖及尚未读取的现网版本列在release-preparation文档。未提交/合并/部署；等待用户验收时删除接续。
