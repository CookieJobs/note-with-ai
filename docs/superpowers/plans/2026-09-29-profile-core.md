# 个人中心核心实施计划

**执行状态（2026-10-03）：** 任务 1–3 已实施并验收；原计划步骤保留为设计记录，不代表需要重新执行。实际回归、最后修补和方法偏差见 `docs/superpowers/reviews/2026-10-02-profile-rework-acceptance.md`。尚未合并 main 或推送。

> **供智能体执行：** 必须使用子技能 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项执行本计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 将 `/profile` 每日推荐区域改为账户/个人资料内容、两项独立笔记统计，以及状态明确且准确的旧画像。

**架构：** 将个人资料读取和显式分析触发移入经过认证的个人中心 API；笔记统计保持为独立请求。页面移除每日推荐，并分别呈现统计与旧画像各自的加载、错误和重试状态，同时为计划 B 提供的话题面板留出专用位置。

**技术栈：** Next.js/React、TypeScript、Express、Mongoose、Vitest、通过 `tsx` 执行的 Node.js `node:test`。

**规格：** `docs/superpowers/specs/2026-09-29-profile-rework-design.md`

## 全局约束

- `/profile` 仅将笔记总数和本月新增笔记数作为统计展示。
- 产品日历时区为 `Asia/Shanghai`。
- 旧画像必须显式生成；GET 不得触发生成。
- 笔记少于 5 篇时返回 `insufficient_data`，且不得更新 `lastAnalyzedAt`。
- 只有成功生成并提交的画像结果可以更新 `lastAnalyzedAt`。
- 当前笔记少于 5 篇时，已有个人资料数据仅作为历史数据展示，不得作为当前推断展示。
- 移除个人中心每日推荐的生成逻辑和 UI；保留笔记级语义推荐及其补充处理。
- 个人中心的每个子区域分别加载、失败和重试；不得展示原始技术错误。

## 审查重点

- 笔记数为 0–4 时，个人资料 GET 必须只读，不得创建分析任务。
- 删除笔记后只剩 1–4 篇时，已有技能/传记不得显示为当前结果。
- 分析开始时有 5 篇或以上、但写回前删除笔记导致不足 5 篇时，不得提交为当前画像。
- `insufficient_data`、排队、失败和过期完成均不得推进 `lastAnalyzedAt`。
- 统计失败后必须结束骨架屏，且不得隐藏个人资料或话题内容。
- 移除 `/api/feed` 挂载时必须保留 `/api/recommend/semantic-notes`。

---

### 任务 1：精简个人中心统计契约

**文件：**

- 修改：`backend/services/userStatsService.ts`
- 测试：`backend/tests/userStatsService.test.ts`
- 修改：`frontend/src/services/feedService.ts`

**接口：**

- 为个人中心生成 `UserStatsDto = { totalNotes: number; notesThisMonth: number }`，客户端 `UserStats` 也包含相同的两个字段。
- `GET /api/user/stats` 仍作为统计端点；月度边界为上海日历月月初（含）至下月月初（不含）。

- [ ] **步骤 1：编写失败的服务测试**，测试名为 `仅返回笔记总数和上海时区本月笔记数` 和 `不受主机时区影响地使用上海时区边界`；断言 DTO 恰好包含这两个契约字段，且聚合边界采用已说明的月份。
- [ ] **步骤 2：运行聚焦的后端测试**：`cd backend && npx tsx --test tests/userStatsService.test.ts`。预期：因仍存在额外指标/时区行为而失败。
- [ ] **步骤 3：在上述文件中实现仅含两个字段的服务端/客户端契约**；移除仅供个人中心使用的 `UserProfile.interests` 查询和基于主机本地时区的月份计算。暂时保留现有 feed 导出；待任务 3 页面切换到个人中心专用调用后再移除。
- [ ] **步骤 4：运行聚焦测试**：`cd backend && npx tsx --test tests/userStatsService.test.ts`；`cd frontend && npx vitest run src/app/profile/page.test.tsx`。预期：更新测试数据以适配两个字段的 DTO 后通过。
- [ ] **步骤 5：提交** `git add backend/services/userStatsService.ts backend/tests/userStatsService.test.ts frontend/src/services/feedService.ts && git commit -m "feat: simplify profile statistics contract"`。

### 任务 2：添加显式旧画像读取和生成端点

**文件：**

- 新建：`backend/controllers/profileController.ts`
- 新建：`backend/routes/profileRoutes.ts`
- 修改：`backend/index.ts`
- 修改：`backend/models/UserProfile.ts`
- 修改：`backend/services/profileAnalysisCoordinator.ts`
- 修改：`backend/services/userAnalysisService.ts`
- 新建：`backend/tests/profileRoutes.test.ts`
- 测试：`backend/tests/userAnalysisService.test.ts`

**接口：**

- `GET /api/profile/analysis` 返回 `{ userProfile, historicalProfile, profileStatus, noteCount, analysisError, lastAnalyzedAt, analysisInputNoteCount, analysisInputScope }`。笔记少于 5 篇时，`userProfile=null`，任何既有结果仅通过 `historicalProfile` 返回；笔记达到 5 篇或以上时，`historicalProfile=null`。`profileStatus` 为 `idle | analyzing | ready | failed | insufficient_data`；历史记录缺少的元数据为 `null`，并视为未知。
- `POST /api/profile/analysis` 返回 `{ accepted, profileStatus, reason, analysisError }`；少于 5 篇时返回 `accepted:false`、`reason:'insufficient_data'`，不得排队或修改时间戳。
- 成功分析时，将实际笔记数/范围与结果一同存储；旧分析仍最多使用 20 篇笔记。

- [ ] **步骤 1：编写失败的路由/服务测试**，测试名为 `个人资料 GET 只读并返回旧字段和范围`、`个人资料 POST 在笔记少于五篇时拒绝且不排队或写入时间戳`、`写回前笔记数降至五篇以下时分析不提交` 和 `成功提交画像时记录实际输入笔记数和范围`。验证缓存的技能/摘要在刷新失败时仍保留；补充路由注册测试，确认 `/api/feed` 未挂载。
- [ ] **步骤 2：运行聚焦的后端测试**：`cd backend && npx tsx --test tests/profileRoutes.test.ts tests/userAnalysisService.test.ts`。预期：因端点缺失以及当前少于最低数据量时仍会写入时间戳而失败。
- [ ] **步骤 3：实现 `GET/POST /api/profile/analysis`** 并将 `profileRoutes` 挂载到 `/api/profile`。移除分析协调器中的 `source:'auto'` 路径，让每次分析请求都必须显式发起；排队前拒绝数据不足，并在提交结果前再次检查笔记数。移除无画像更新路径中对 `lastAnalyzedAt` 的写入；仅在成功生成结果时保存输入笔记数/范围。保留 `analysisVersion` 过期结果保护。
- [ ] **步骤 4：运行聚焦测试**：`cd backend && npx tsx --test tests/profileRoutes.test.ts tests/userAnalysisService.test.ts`；`cd backend && npm run typecheck`。预期：通过。
- [ ] **步骤 5：提交** `git add backend/controllers/profileController.ts backend/routes/profileRoutes.ts backend/index.ts backend/models/UserProfile.ts backend/services/profileAnalysisCoordinator.ts backend/services/userAnalysisService.ts backend/tests/profileRoutes.test.ts backend/tests/userAnalysisService.test.ts && git commit -m "feat: expose explicit profile analysis API"`。

### 任务 3：移除个人中心每日推荐并构建相互独立的核心区域

**文件：**

- 修改：`frontend/src/app/profile/page.tsx`
- 修改：`frontend/src/app/profile/profile.module.scss`
- 修改：`frontend/src/app/profile/page.test.tsx`
- 新建：`frontend/src/services/profileService.ts`
- 删除：`frontend/src/services/feedService.ts`
- 删除：`backend/controllers/feedController.ts`
- 删除：`backend/routes/feedRoutes.ts`
- 修改：`backend/index.ts`

**接口：**

- 前端导出 `getProfileAnalysis(): Promise<ProfileAnalysisResponse>`、`triggerProfileAnalysis(): Promise<ProfileAnalysisTriggerResponse>` 和 `getStats(): Promise<UserStats>`；每个方法仅调用各自的端点。
- `ProfileAnalysisResponse` 为 `{ userProfile: LegacyProfileDto | null; historicalProfile: LegacyProfileDto | null; profileStatus: 'idle' | 'analyzing' | 'ready' | 'failed' | 'insufficient_data'; noteCount: number; analysisError: string; lastAnalyzedAt: string | null; analysisInputNoteCount: number | null; analysisInputScope: 'recent_up_to_20' | 'unknown' | null }`。
- 页面数据使用 `profileStatus`、`noteCount`、旧画像 DTO 和画像输入元数据。话题面板插入位置留给计划 B；不再保留 feed DTO 或请求。

- [ ] **步骤 1：编写失败的页面测试**，测试名为 `不请求或渲染每日推荐`、`分别加载统计和个人资料`、`统计失败后结束骨架屏且仅重试统计`、`笔记达到五篇或以上且缺少画像时显示生成操作`、`笔记少于五篇时显示数据不足说明`、`笔记数低于五篇时仅将缓存推断显示为历史数据`、`分析失败后保留缓存的旧画像并提供重试`、`编辑资料弹窗仍可保存用户名并保留只读邮箱` 和 `修改密码弹窗仍可打开并提交有效凭据`。
- [ ] **步骤 2：运行聚焦的前端测试**：`cd frontend && npx vitest run src/app/profile/page.test.tsx`。预期：因 feed 渲染/请求仍存在、状态仍耦合而失败。
- [ ] **步骤 3：实现页面/服务变更**；移除 `/api/feed` 路由挂载和推荐构建控制器；保持 `/api/recommend` 不变。个人资料 GET 保持只读；显式 POST 按钮文字为“生成画像”/“重新分析”；少于 5 篇时，只在明确标注的历史快照中渲染 `historicalProfile` 并显示数据不足说明，绝不将其作为当前 `userProfile`。
- [ ] **步骤 4：运行验证**：`cd frontend && npx vitest run src/app/profile/page.test.tsx && npm run typecheck`；`cd backend && npx tsx --test tests/profileRoutes.test.ts tests/userAnalysisService.test.ts tests/recommendAndPerformanceRoutes.test.ts && npm run typecheck`。预期：通过；不存在 `/api/feed` 的使用或挂载，笔记推荐测试仍通过。
- [ ] **步骤 5：提交** `git add frontend/src/app/profile/page.tsx frontend/src/app/profile/profile.module.scss frontend/src/app/profile/page.test.tsx frontend/src/services/profileService.ts frontend/src/services/feedService.ts backend/controllers/feedController.ts backend/routes/feedRoutes.ts backend/index.ts && git commit -m "feat: remove profile daily feed"`。

## 规格覆盖自审

- 个人中心布局、两项指标、独立错误/重试和移除 feed：任务 3；统计契约/时区：任务 1。
- 个人资料 GET/POST 语义、少于 5 篇时拒绝、缓存画像的历史状态、分析输入范围和时间戳规则：任务 2 及任务 3 的测试。
- 话题接口插入点由计划 B 提供；账户/头像编辑归计划 C。
- 同版本前后端部署后，旧 `/api/feed` 调用不再受支持；笔记级推荐通过测试确认不变。
- 执行顺序为 A → B → C；不要并行执行这些计划，因为 B 扩展 A 的路由/页面契约，C 会修改 A/B 共用的个人中心页面。
