# 笔记信息流 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有笔记列表增加瀑布流、全库字面量搜索与北京时间月历，不改新增、阅读或编辑体验。
**Architecture:** 保留 useNotes 与 mutation；独立只读搜索及月历 query。列表使用 ResizeObserver 测量卡片，按 DOM 数据顺序分配最短列。后端复用列表分页和账号权限，增加搜索过滤及按月聚合。
**Tech Stack:** Next.js / React / React Query / SCSS；Express / Mongoose；Vitest / node:test。
**Spec:** ../specs/2026-11-08-notes-feed-design.md

## Global Constraints

- 现有 compose/highlight/fromChat、草稿、revision、保存导航、侧栏及其他页面不改。
- 全库搜索，字面量、英文不区分大小写，最长 100 字符；历史正文按 Spec 回退。
- 月历展示型、Asia/Shanghai；不新增模型、依赖、worker 或历史迁移。
- 当前目录仅存在未跟踪 Spec；在 codex/notes-feed 分支原地实现，保留该文档。

## Review Focus

- 切换关键词与账号后旧响应不能串入当前结果。
- 搜索中新增不匹配笔记后不能混入结果，最近笔记始终来自普通列表。
- 历史正文缺失、空白 contentText 与特殊字符必须符合查询语义。
- 月首跨北京时间、闰年与快速切月统计必须正确。
- 卡片尺寸变化、隐藏再显示与分页追加不能破坏顺序或返回位置。

### Task 1: 只读查询服务

Files: backend/services/noteListQueries.ts、noteListCursor.ts、noteService.ts、controllers/noteController.ts、routes/notes.ts；tests/noteListQueries.test.ts、noteReadQueries.test.ts。
Interface: parseSearchQuery(value): string；buildNoteSearchFilter(q): object；calendarMonthRange(month): {start,end}；GET /notes?q&cursor；GET /notes/calendar?month。
- [x] 写失败测试：字符转义/正文回退、游标跨查询、UTC 月边界/闰年、服务账号与响应、输入校验。
- [x] 运行新测试确认失败，最小实现，再运行相关后端测试。

### Task 2: 独立列表查询与交互

Files: frontend/src/app/notes/hooks/useNoteSearch.ts、useNoteCalendar.ts、components/NotesFeed.tsx、NotesCalendar.tsx；对应 .test.tsx；utils/noteFeed.ts 与测试。
Interfaces: 搜索由 userId/q/queryClient 隔离并游标追加；日历缓存按 userId/month；Feed props 为 notes/onOpen，Calendar props 为 userId。
- [x] 写失败测试：搜索旧响应/分页、重试与空结果；月历切月/跨账号；摘要与布局数据顺序。
- [x] 实现独立 hook 和组件，复用现有提取与主题，验证测试。

### Task 3: 页面集成与写入同步

Files: page.tsx、NotesWorkspace.module.scss；page.feed.test.tsx 与现有回归。
- [x] 写失败集成测试：筛选只改变列表、普通最近投影不变、compose/highlight 路由保持、搜索阅读返回状态保持。
- [x] 集成搜索与月历；写入成功局部同步只读缓存，不改 mutation；保留分页/滚动/焦点与现有编辑器。
- [x] 局部列表样式、1–4 列布局及紧凑日历，执行现有页面和保存回归。

### Task 4: 验证与文档

- [x] 根 typecheck、完整测试、前端 lint、build:all、route budgets；明确报告任何已有失败或环境限制。
- [x] 浏览器真实页面检查搜索、月历、阅读往返与桌面深浅主题布局，使用模拟接口验证可重复边界，截图。
- [x] 更新 notes README、后端模块 README、DESIGN/PRODUCT 对应列表条款，不拓展功能。
- [x] 最终独立审核，核实并修复实质问题；交付实际验证结果，不部署。

执行说明：按用户“开始执行”授权在当前新分支内直接推进。独立只读缓存使用页面内 hook 而非变更 useNotes / 全局 QueryClient：适配现有保持挂载的列表并降低写入链路影响。最终验证与审核见 ../../releases/2026-11-notes-feed.md。
