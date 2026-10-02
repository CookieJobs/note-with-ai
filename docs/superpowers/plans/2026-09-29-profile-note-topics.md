# 个人中心笔记话题实施计划

> **供智能体执行：** 必须使用子技能 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项执行本计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 为所有用户笔记构建可恢复的逐篇话题索引，并提供按日期筛选的话题计数，准确呈现覆盖率和重试状态。

**架构：** 每篇笔记存储一条持久索引记录，以笔记/用户为键，并记录当前来源修订号和规范化输入指纹。可恢复的回填流程与持久待处理记录驱动逐篇处理任务；个人中心话题 API 仅聚合当前有效的 `ready` 记录，并分别报告 `pending`/`failed`/旧快照。用户切换时间范围时，个人中心 UI 只查询该端点，不调用 AI。

**技术栈：** Express、Mongoose、TypeScript、现有 DeepSeek 客户端、现有笔记写入/补充服务、React/Next.js、通过 `tsx` 执行的 Node `node:test`、Vitest。

**规格：** `docs/superpowers/specs/2026-09-29-profile-rework-design.md`

## 全局约束

- 范围为 `all | year | sixMonths`；所有日期边界使用 `Asia/Shanghai` 日历日和日历月。
- 每篇笔记对每个规范化话题最多贡献一次计数。
- 当前索引只有在用户 `revision` 和 `sourceFingerprint` 均匹配时才算新鲜有效。
- 过期的处理任务不得写入当前状态或替换较新的成功快照。
- 首次回填在后台执行，可恢复且幂等；不得重新运行全用户画像分析。
- 首先使用现有 `keywords`/`summary` 提取。如果得到的来源没有可用话题标签，只能将该篇笔记的标题/正文/可用摘要发送给 DeepSeek；不得批量发送笔记，合并后的模型输入最多 3,000 个 Unicode 字符。
- 每个进程最多允许 2 个 DeepSeek 调用并发；跨进程每个用户最多允许 1 个活动调用。通过持久化任务领取记录和租约，避免多个副本同时处理同一笔记或用户。
- 每个笔记输入指纹最多自动调用 AI 3 次（首次调用加重试）；间隔分别为 30 秒和 120 秒。自动重试耗尽后不得继续自动重试。
- 每次人工重试对每篇失败笔记只触发一次调用，并受每笔记 10 分钟冷却期和滚动 24 小时最多 3 次限制。窗口过后自动恢复资格；供应商长期故障后，用户无需编辑未变更的笔记即可恢复。人工调用不重置自动调用次数，也不得形成自动重试循环。
- 话题标签先做 NFKC、去除首尾空白、合并连续空白、拉丁字母小写化。再应用有版本号的显式别名表；版本 1 将 `AI` 和 `人工智能` 映射到规范显示标签 `人工智能`。新增别名必须经过审阅，并同步修改映射和测试；不得使用模糊模型匹配。
- 切换范围仅查询/筛选索引；不得调用 AI 或重建索引。
- 当前话题和 `X/Y` 只包含当前有效的 ready 记录；旧成功快照单独标注展示，不计入 ready 或当前话题计数。
- 保留 `/api/recommend`、笔记 `recommendCache` 和笔记补充处理中的推荐产物。

## 审查重点

- 异步摘要/关键词写入即使不改变 `Note.revision`，也可能改变输入指纹。
- DeepSeek 处理期间笔记可能发生变化；旧结果和旧失败均不得覆盖当前状态或 `lastSuccess`。
- 缺失索引记录、修订号/指纹过期记录都计为 pending；每篇笔记状态计数之和必须等于筛选范围内的笔记总数。
- 闰日/月末日期以及接近 UTC 午夜的时间戳必须归入正确的上海时区范围。
- 回填中断/重启、重复调度、副本任务领取、并发限制和重试耗尽都不得造成重复计数或任务永久卡在运行中。

---

### 任务 1：定义规范话题输入和持久索引状态

**文件：**

- 新建：`backend/models/UserNoteTopicIndex.ts`
- 新建：`backend/services/userNoteTopicInputs.ts`
- 新建：`backend/tests/userNoteTopicInputs.test.ts`
- 新建：`backend/tests/userNoteTopicIndexModel.test.ts`

**接口：**

- `buildTopicInputs(note: TopicInputNote): { sourceRevision: number; sourceFingerprint: string; source: 'keywords' | 'summary' | 'bounded_content' | 'mixed'; promptText: string; candidateTopics: string[] }` 按固定字段顺序规范化标题/正文/摘要/关键词，并对所有真实来源值计算哈希，包括异步元数据生成后新增的值。使用版本化规范 JSON 的 SHA-256；提示文本使用 `contentText.trim()` 或 `content.trim()`，总上限为 3,000 个码点，包含标题和可用摘要。
- `normalizeTopicLabel(label: string): string` 执行 NFKC、去除首尾空白、合并连续空白、拉丁字母小写化，再应用显式别名表；版本 1 将 `ai` 和 `人工智能` 映射为规范标签 `人工智能`。未知标签保持不同。导出 `TOPIC_ALIAS_VERSION = '1'`；仅在经过审阅的别名表和回归测试同时变更时才递增版本。
- `UserNoteTopicIndex` 对 `{ userId: 1, noteId: 1 }` 建唯一索引；存储 `sourceRevision`、`sourceFingerprint`、`status`、`topics`、`source`、`indexedAt`、`errorAt`、`lastSuccess`、尝试信息，以及恢复任务所需的领取时间戳。

- [ ] **步骤 1：编写失败的测试**，测试名为 `摘要或关键词在修订号不变时变化会改变指纹`、`指纹和提示文本输入可确定性规范化`、`模型输入最多为 3000 个 Unicode 码点`、`现有关键词和摘要成为候选话题`、`AI 和人工智能规范化为同一个中文规范话题`、`未知中文标签保持不同` 和 `索引模型具有用户-笔记唯一键和明确状态`。
- [ ] **步骤 2：运行** `cd backend && npx tsx --test tests/userNoteTopicInputs.test.ts tests/userNoteTopicIndexModel.test.ts`。预期：因类型/数据模型尚不存在而失败。
- [ ] **步骤 3：实现纯输入构建器和数据模型**。将完整规范指纹输入与长度受限的 LLM 文本分开。话题状态为 `pending | processing | ready | failed`；当前尝试开始时，仅将此前成功结果保存在 `lastSuccess`。
- [ ] **步骤 4：运行** `cd backend && npx tsx --test tests/userNoteTopicInputs.test.ts tests/userNoteTopicIndexModel.test.ts && npm run typecheck`。预期：通过。
- [ ] **步骤 5：提交** `git add backend/models/UserNoteTopicIndex.ts backend/services/userNoteTopicInputs.ts backend/tests/userNoteTopicInputs.test.ts backend/tests/userNoteTopicIndexModel.test.ts && git commit -m "feat: define per-note topic index state"`。

### 任务 2：实现逐篇话题处理任务、CAS 和重试

**文件：**

- 新建：`backend/services/userNoteTopicIndexService.ts`
- 新建：`backend/services/userNoteTopicIndexWorker.ts`
- 新建：`backend/models/UserNoteTopicWorkerLease.ts`
- 新建：`backend/tests/userNoteTopicIndexWorker.test.ts`
- 新建：`backend/tests/userNoteTopicWorkerLease.test.ts`

**接口：**

- `scheduleUserNoteTopicIndex(userId: string, noteId: string): Promise<void>` 按当前修订号/指纹插入或更新最新 pending 状态，并保持幂等。
- `retryFailedUserTopics(userId: string, scope: TopicScope): Promise<{ acceptedCount: number; alreadyRunningCount: number; rateLimitedCount: number; nextRetryAt: string | null }>` 仅重新排入该用户在指定范围内当前失败的笔记；每篇符合条件的笔记只新增一次人工尝试。每篇笔记（跨指纹）每 10 分钟最多一次、滚动 24 小时最多 3 次，并按用户/笔记持久记录。返回 `rateLimitedCount` 和最早适用的 `nextRetryAt`；自动尝试耗尽不得标记为永久失败，也不得要求改变指纹才能人工恢复。
- 处理任务捕获 `{ noteId, userId, sourceRevision, sourceFingerprint }`；任务最终写入时同时比较这两项以及最新的话题来源字段。只有当前有效的成功结果才能更新 `lastSuccess`。
- 自动尝试总数（含首次调用）按每个指纹最多 3 次；输入指纹变化后计数器重置。失败后分别在 30 秒和 120 秒后安排第 2、3 次尝试；第 3 次失败后自动处理状态变为 `failed`，但仍可按限流规则人工重试。持久化 `attemptCount`、人工尝试时间戳、`retryMode` 和 `nextAttemptAt`。
- 每个进程通过信号量将 DeepSeek 并发限制为 2。每用户唯一的租约文档通过带过期时间/所有者令牌的原子任务领取，将跨副本的活动话题处理限制为每用户 1 个；笔记状态 CAS 防止同一笔记被重复领取。

- [ ] **步骤 1：编写失败的处理任务测试**，测试名为 `使用现有关键词作为候选且不调用 DeepSeek`、`没有候选话题时只发送一篇有界笔记`、`提示文本不包含其他笔记内容`、`修订号不变但摘要变化会使完成结果过期`、`旧结果或失败不会替换最近成功结果`、`自动尝试在 30 秒和 120 秒间隔后最多三次即停止`、`同一笔记每十分钟最多人工重试一次` 和 `滚动 24 小时最多允许三次人工重试且窗口后恢复`。
- [ ] **步骤 2：运行** `cd backend && npx tsx --test tests/userNoteTopicIndexWorker.test.ts tests/userNoteTopicWorkerLease.test.ts`。预期：因处理任务/服务/租约尚不存在而失败。
- [ ] **步骤 3：使用现有 DeepSeek 客户端实现逐篇提取、持久化任务领取和过期保护**。优先使用 `keywords` 中的候选话题；没有候选标签时，仅为该篇笔记调用一次，并使用其可用摘要或有界正文。执行上述进程/用户并发限制和重试限制。写入状态前，使用同时包含修订号和捕获到的实际输入字段值的比较并交换（CAS）筛选条件，确保异步元数据更新后旧处理任务无法提交。
- [ ] **步骤 4：运行** `cd backend && npx tsx --test tests/userNoteTopicIndexWorker.test.ts tests/userNoteTopicWorkerLease.test.ts tests/aiUsageTelemetry.test.ts && npm run typecheck`。预期：通过；断言单篇调用携带话题提取操作上下文，且不包含聚合笔记语料。
- [ ] **步骤 5：提交** `git add backend/models/UserNoteTopicWorkerLease.ts backend/services/userNoteTopicIndexService.ts backend/services/userNoteTopicIndexWorker.ts backend/tests/userNoteTopicIndexWorker.test.ts backend/tests/userNoteTopicWorkerLease.test.ts && git commit -m "feat: index topics per note"`。

### 任务 3：添加可恢复回填和笔记变更调度

**文件：**

- 新建：`backend/models/UserNoteTopicBackfill.ts`
- 新建：`backend/services/userNoteTopicBackfill.ts`
- 新建：`backend/services/userNoteTopicRuntime.ts`
- 修改：`backend/services/NoteUpdateOrchestrator.ts`
- 修改：`backend/services/noteEnrichmentWorker.ts`
- 修改：`backend/services/noteService.ts`
- 修改：`backend/index.ts`
- 新建：`backend/tests/userNoteTopicBackfill.test.ts`
- 新建：`backend/tests/userNoteTopicRuntime.test.ts`
- 修改：`backend/tests/userNoteTopicWorkerLease.test.ts`
- 修改：`backend/tests/noteWriteModule.test.ts`
- 修改：`backend/tests/noteEnrichmentWorker.test.ts`
- 修改：`backend/tests/noteService.test.ts`

**接口：**

- `runTopicBackfillPage({ userId, limit }): Promise<{ scanned: number; cursor: string | null; done: boolean }>` 持久化每用户笔记游标，幂等地将缺失/过期笔记加入队列。启动时，单例扫描器分页处理现有 `backend/models/User.ts` 中的记录，并恢复每条未完成的 `UserNoteTopicBackfill` 记录；不得由个人中心 GET 的副作用触发。
- `startUserNoteTopicRuntime(): void` 启动一个有界轮询循环，使用进程级并发信号量 2、持久化的每用户租约（跨副本每用户最多 1 篇活动笔记）、持久化笔记任务领取，以及任务 2 中的自动重试间隔/上限。过期租约可恢复；提供 stop/cleanup 以便确定性测试。
- 笔记创建/更新以及成功的异步元数据写入，只为该篇笔记调用 `scheduleUserNoteTopicIndex`。删除笔记时移除该笔记的话题状态。

- [ ] **步骤 1：编写失败的测试**，测试名为 `回填可从持久化游标恢复且重复执行安全`、`运行器回收过期的处理中任务租约`、`两个运行器实例不能领取同一用户的租约`、`运行器不会超过每进程两个并发调用`、`创建和话题相关更新仅调度一篇索引`、`删除会移除索引` 和 `成功的元数据写入以相同用户修订号排队索引`。
- [ ] **步骤 2：运行** `cd backend && npx tsx --test tests/userNoteTopicBackfill.test.ts tests/userNoteTopicRuntime.test.ts tests/userNoteTopicWorkerLease.test.ts tests/noteWriteModule.test.ts tests/noteEnrichmentWorker.test.ts tests/noteService.test.ts`。预期：因集成和恢复逻辑缺失而失败。
- [ ] **步骤 3：实现持久化游标和插入或更新恢复逻辑**、有界消费者循环和逐篇调度。对被遗弃的 `processing` 任务领取记录设置有界租约，超时后恢复；从数据库成功启动流程启动单例扫描器/消费者，不得依赖 HTTP 请求。
- [ ] **步骤 4：运行** `cd backend && npx tsx --test tests/userNoteTopicBackfill.test.ts tests/userNoteTopicRuntime.test.ts tests/userNoteTopicWorkerLease.test.ts tests/noteWriteModule.test.ts tests/noteEnrichmentWorker.test.ts tests/noteService.test.ts && npm run typecheck`。预期：通过。
- [ ] **步骤 5：提交** `git add backend/models/UserNoteTopicBackfill.ts backend/services/userNoteTopicBackfill.ts backend/services/userNoteTopicRuntime.ts backend/services/NoteUpdateOrchestrator.ts backend/services/noteEnrichmentWorker.ts backend/services/noteService.ts backend/index.ts backend/tests/userNoteTopicBackfill.test.ts backend/tests/userNoteTopicRuntime.test.ts backend/tests/userNoteTopicWorkerLease.test.ts backend/tests/noteWriteModule.test.ts backend/tests/noteEnrichmentWorker.test.ts backend/tests/noteService.test.ts && git commit -m "feat: backfill and maintain note topic index"`。

### 任务 4：查询筛选范围内的话题并提供重试 API

**文件：**

- 修改：`backend/services/userNoteTopicIndexService.ts`
- 修改：`backend/controllers/profileController.ts`
- 修改：`backend/routes/profileRoutes.ts`
- 新建：`backend/tests/userNoteTopicRoutes.test.ts`

**接口：**

- `getUserTopicIndex(userId: string, scope: TopicScope, now?: Date): Promise<UserTopicIndexDto>` 返回规格定义的 DTO，包括计数/状态、当前话题，以及可选的已标注旧快照。
- `GET /api/profile/topics?scope=all|year|sixMonths` 仅负责读取；`POST /api/profile/topics/retry` 接收 `{ scope }` 并返回 `{ acceptedCount, alreadyRunningCount, rateLimitedCount, nextRetryAt }`。受到限流的响应告知用户何时可再次重试；自动尝试耗尽后仍可在冷却/窗口限制允许时人工恢复，无需编辑未变更的笔记。

- [ ] **步骤 1：编写失败的测试**，测试名为 `对不同 ready 笔记去重计数并按话题排序平局项`、`将缺失和过期记录计为 pending`、`单独返回旧快照`、`处理跨 UTC 午夜的上海时区边界`、`将月末回溯限制在该月最后一个日历日`、`拒绝未知范围`、`话题 GET 接口不返回其他用户的笔记`、`重试路由不能将其他用户的失败笔记加入队列`、`重试路由返回冷却和限流计数` 和 `重试路由不会等待 AI`。
- [ ] **步骤 2：运行** `cd backend && npx tsx --test tests/userNoteTopicRoutes.test.ts`。预期：因话题路由/聚合逻辑尚不存在而失败。
- [ ] **步骤 3：实现对用户拥有的笔记及其索引记录的范围聚合**。保证 `ready + pending + failed = total`；状态优先级为 `empty`、全部 ready、`partial`（存在 ready，或 failed 与 pending 并存）、全部 failed，否则为 `building`。
- [ ] **步骤 4：运行** `cd backend && npx tsx --test tests/userNoteTopicRoutes.test.ts tests/userNoteTopicIndexWorker.test.ts tests/userNoteTopicBackfill.test.ts && npm run typecheck`。预期：通过。
- [ ] **步骤 5：提交** `git add backend/services/userNoteTopicIndexService.ts backend/controllers/profileController.ts backend/routes/profileRoutes.ts backend/tests/userNoteTopicRoutes.test.ts && git commit -m "feat: expose scoped note topics"`。

### 任务 5：添加话题面板及独立 UI 状态

**文件：**

- 新建：`frontend/src/services/profileTopicsService.ts`
- 新建：`frontend/src/app/profile/ProfileTopicsSection.tsx`
- 新建：`frontend/src/app/profile/ProfileTopicsSection.test.tsx`
- 修改：`frontend/src/app/profile/page.tsx`
- 修改：`frontend/src/app/profile/profile.module.scss`
- 修改：`frontend/src/app/profile/page.test.tsx`

**接口：**

- `getProfileTopics(scope: TopicScope): Promise<UserTopicIndexDto>` 调用 GET 路由；`retryFailedProfileTopics(scope): Promise<TopicRetryResponse>` 调用 POST。
- 计划 A 提供 `profileRoutes`、`profileService`、页面统计/画像状态和话题面板插入点。本区域只负责范围选择、话题状态和话题重试；不负责个人资料或统计错误。

- [ ] **步骤 1：编写失败的面板测试**，测试名为 `默认范围为全部笔记`、`切换范围时不调用重试或 AI`、`显示 X/Y 和当前 ready 话题`、`单独显示旧快照标签`、`无结果范围提供返回全部笔记的入口`、`保留缓存话题并标注部分失败`、`只重试失败笔记`、`为受限流笔记显示下次重试时间`、`无需编辑笔记即可在冷却后重试`、`无缓存时显示本区域错误` 和 `结束加载并显示独立错误与重试入口`。
- [ ] **步骤 2：运行** `cd frontend && npx vitest run src/app/profile/ProfileTopicsSection.test.tsx src/app/profile/page.test.tsx`。预期：因组件/服务尚不存在而失败。
- [ ] **步骤 3：使用准确的响应状态实现话题区域**；显示笔记篇数，绝不显示兴趣百分比。范围变化仅调用 GET；刷新期间保留成功缓存；旧快照需明确标记并排除在 `X/Y` 之外。
- [ ] **步骤 4：运行** `cd frontend && npx vitest run src/app/profile/ProfileTopicsSection.test.tsx src/app/profile/page.test.tsx && npm run typecheck`；`cd backend && npm run typecheck`。预期：通过。
- [ ] **步骤 5：提交** `git add frontend/src/services/profileTopicsService.ts frontend/src/app/profile/ProfileTopicsSection.tsx frontend/src/app/profile/ProfileTopicsSection.test.tsx frontend/src/app/profile/page.tsx frontend/src/app/profile/profile.module.scss frontend/src/app/profile/page.test.tsx && git commit -m "feat: show note topics on profile"`。

## 规格覆盖自审

- 逐篇输入、指纹+修订号新鲜度、有界 DeepSeek 调用和过期 CAS：任务 1–2。
- 创建/更新/删除调度、异步元数据变更、可恢复回填：任务 3。
- 范围、上海时区日期边界、计数去重、状态/覆盖率总和、旧快照、仅对失败项重试：任务 4。
- 默认全部范围、零笔记/空结果状态、`X/Y`、缓存部分数据、隔离错误/重试、切换范围不调用模型：任务 5。
- 个人中心 API 路径/控制器由计划 A 提供；计划 B 只向该路由器添加话题路由。先执行 A 再执行 B。计划 C 在 B 之后执行，且只负责头像相关的账户弹窗变更。
