# 从你的笔记继续：主动思考 Agent 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户控制、可核对证据和硬预算边界内，从其笔记生成可继续讨论的发现，并让用户决定是否保存草稿。

**Architecture:** 持久化调度与独立 worker 管理任务、租约、预算及恢复；受限 Agent 工具仅在认证用户的笔记范围检索和读取，候选经服务端证据校验后发布。认证 HTTP 接口和前端发现面板提供状态、反馈、会话承接及显式保存；已有单篇聊天契约保持兼容。

**Tech Stack:** TypeScript、Express、Mongoose、现有 AiUsageService/LLM provider、React、后端 `tsx --test` 和前端仓库现有测试脚本。

**Spec:** [已批准设计](../specs/2026-11-17-note-continuation-agent-design.md)

**状态：** 用户已确认原型并授权直接在 main 实现；实施进度由各任务验收记录更新。

## Global Constraints

- 一个受界限 Agent；确定性服务端执行器管理预算、权限、持久化和发布。
- 单次最多 3 次模型决策/生成调用、8 次工具调用、12 篇不同笔记全文、输入 24000 tokens、输出 4000 tokens、90 秒。
- 自动新增/修改合并静默 2 分钟；本地日最多 6 次自动运行，滚动小时最多 2 次；手动每日最多 3 次并有 60 秒冷却。
- 首页每日首次曝光最多 3 条，最多展开 3 条；自动发现可关闭，不发外部通知、不自动写笔记或任务。
- 证据必须由服务端按用户、当前 revision 和原文摘录验证；关联笔记列表不是模型已读证据。
- 没有充分证据时返回成功无结果；模型及供应商成本未知或价格/预算配置缺失时 fail closed，禁止自动运行或未预留即调用。
- 笔记内容是不可信数据；Agent 工具不得接受模型提供的 userId，不提供任意 SQL、Shell、网络或直接笔记写入。
- 独立 HTML 原型已获用户确认；生产入口受特性开关保护。
- 部署须先合入 `main`，并另行取得部署授权。

用户时区由浏览器 IANA timezone 经服务端验证后写入偏好，缺失默认 Asia/Shanghai；改时区不清零限次，额外保留滚动 24 小时上限防重复领额度。费用上限与单价必须显式配置；本阶段不猜测生产成本或启用付费调用。

## Review Focus

- 跨用户伪造 noteId / 引用：执行器测试断言查找和引用校验总带服务端 userId，跨账户数据零泄露。
- 内容内提示注入：工具/Agent 测试断言笔记指令不提升权限，不触发任意操作。
- 修订并发或删除：校验及发布竞态测试断言旧 revision 不发布，删除后不可重新读取来源。
- 多实例重复、关闭开关与崩溃恢复：持久化 store 测试覆盖唯一键、租约、取消边界、变更水位不丢失和幂等发布。
- 未知计费、缺用量、预算并发超限：预算测试断言调用前预留，缺价格/预算配置拒绝启动，结算不会突破用户或全局上限。

## 文件结构与阶段

实现前沿用现有模式：`backend/models/InspirationRun.ts`、`backend/services/inspirationWorkerStore.ts`、`backend/services/inspirationWorker.ts` 与 `backend/scripts/run_inspiration_worker.ts` 展示持久任务、租约和独立 worker 进程；`backend/services/aiUsageService.ts` 和 `backend/models/AiUsageEvent.ts` 仅展示 best-effort 用量遥测，不构成硬预算；`backend/services/chatNoteContextService.ts` 提供单篇来源契约；`backend/services/NoteUpdateOrchestrator.ts` 是修订 CAS 写入口；`backend/services/noteService.ts` 是单篇删除入口。应用入口是 `backend/index.ts`，没有 app.ts/server.ts。现有 inspiration 是外部资料研究，不能复用其产品范围/检索结果。

阶段 0（本轮）：主 Agent 制作独立 HTML 原型，明确模拟数据；展示三类发现、证据、继续探索、草稿保存预览、反馈、无结果/失败，并提交给用户审阅。此计划不实现生产界面。

阶段 1（原型确认后）：后端数据、预算、执行器、证据/发现、接口与聊天承接；阶段 2 才做生产 UI。多 Agent 子任务由主 Agent监督，按下方文件所有权拆分；预算/证据/账户隔离/集成由主 Agent复核，禁止并行改同一文件。

### Task 1: 持久化实体、特性配置与迁移边界

**Files:** Create `backend/models/NoteDiscoveryRun.ts`, `backend/models/NoteDiscovery.ts`, `backend/models/NoteDiscoveryPreference.ts`, `backend/types/noteDiscovery.ts`; Modify `backend/config/index.ts`, `backend/models/AiUsageEvent.ts`; Test `backend/tests/noteDiscoveryModel.test.ts`, `backend/tests/config.test.ts`。

**Interfaces:**
- Produces `NoteDiscoveryRun` 状态 `queued|running|completed|no_result|failed|cancelled`，含用户、变更水位、幂等键、租约、用量与失败分类；唯一用户+幂等键索引及运行状态索引。
- Produces `NoteDiscovery` 类型 `connection|follow_up|next_step`、观察、证据快照、来源指纹、问题/关系标识、可选草稿、质量结果、曝光/状态及会话/保存笔记引用。
- Produces `NoteDiscoveryPreference` 自动开关及可撤销、可过期的结构化反馈。所有记录按 `userId` 限权；不得存人格画像。
- Config 新增 Agent enablement、调用/频率上限、用户/全局 CNY 上限及每次预留上限。值须经 schema 校验；缺必要上限或任一选定模型价格时将能力标为不可运行，不给默认无限值。

- [ ] 写模型索引、枚举、用户隔离及缺少必需预算配置时拒绝启用的失败测试。
- [ ] 运行 `cd backend && npx tsx --test tests/noteDiscoveryModel.test.ts tests/config.test.ts`；预期先因实现缺失失败。
- [ ] 实现三个 schema、共享类型和配置解析；usage operation 增加 `note_continuation`，事件字段仍走既有计量结构。
- [ ] 重跑上述命令，预期通过；提交本任务。

### Task 2: 原子预算预留、用量结算与持久任务 store

**Files:** Create `backend/models/NoteDiscoveryBudget.ts`, `backend/services/noteDiscoveryBudgetService.ts`, `backend/services/noteDiscoveryWorkerStore.ts`; Test `backend/tests/noteDiscoveryBudgetService.test.ts`, `backend/tests/noteDiscoveryWorkerStore.test.ts`。

**Interfaces:**
- `reserve(runId: string, userId: string, generation: number, estimate: CostEstimate): Promise<BudgetReservation | null>` 原子预留用户及全局余量；`CostEstimate` 要求 provider/model、输入/输出价格及硬 token 上限，缺项返回 null。
- `settle(reservationId: string, generation: number, usage: UsageResult): Promise<void>`，其中 `UsageResult = {kind:'known'; inputTokens:number; outputTokens:number; costCnyMicros:number} | {kind:'unknown'; reason:string}`；unknown 全额结算，不能表达为零用量。
- 缺失/不可信用量或实际成本时保守结算整笔预留额（不退款）；每次重试另行预留同一硬上限并计作已消耗，不因重试释放前次预留。任何无法足额预留的重试都不执行。
- Store 提供 `enqueue(userId, watermark, idempotencyKey)`、`claimNext(now)`、`renewLease(runId, token)`、`finish(runId, token, status)`、`cancelQueued(userId)`、`hasEnabledPreference(userId)`。数据库唯一约束及 CAS 为并发依据，不用进程 Map。
- 每用户一个活动运行；到达中的新水位并入下一次待执行水位；租约到期可恢复，provider 已开始且结果不确定时不得盲目重跑付费调用。
- 所有写入/发布携带当前 run token 和 fencing generation；失效租约持有者即使模型迟返也不得发布、结算成当前运行或覆盖新 worker 结果。

- [ ] 写并发预留、未知价格 fail-closed、未知用量全额结算、重复结算幂等、唯一任务、租约恢复和取消边界测试。
- [ ] 运行 `cd backend && npx tsx --test tests/noteDiscoveryBudgetService.test.ts tests/noteDiscoveryWorkerStore.test.ts`；预期先失败。
- [ ] 预算用单个 UTC 周期账本文档存 `reservedTotalMicros`、`spentTotalMicros`、每用户 reserved/spent map 与 reservations 数组；reserve 用单次 `findOneAndUpdate` pipeline 原子校验用户与全局的 spent + reserved + 本次预留不超过各自 cap 并追加 reservation。settle/release 用同文档 reservation id+reserved 状态作 CAS，通过单次 pipeline 改状态、减少 reserved 并增加 spent；已消费不能因结算重新成为余额，避免事务及跨文档双写。单文档达 8MB 或每日 10000 笔预留则停止新调用并报警，不另开账本绕过总额。账本按 UTC 日统一分桶，频次按用户时区另算。周期文档最多保留 10,000 条 reservation；达到上限时 fail closed，不得删除幂等记录后继续调用。
- [ ] reservation 保存 runId、generation、金额上限、状态、租约。租约过期不自动退额：恢复先以实际用量结算，或未知时全额结算，之后才允许新预留。provider 已开始而结果未知不自动重试。每次重试需新预留全额上限，之前已消费和未知用量保守结算部分不退款；可核实未消费部分按幂等结算释放。
- [ ] 实现 `reserve(runId,userId,generation,estimate): Promise<BudgetReservation|null>` 与上方 settle 签名；已知成本超预留则失败并封禁进一步调用。
- [ ] 重跑上述命令，预期预算与恢复测试通过；提交本任务。

### Task 3: 用户笔记检索工具与来源读取

**Files:** Create `backend/services/noteDiscoveryTools.ts`, `backend/services/noteDiscoveryEvidenceService.ts`; Test `backend/tests/noteDiscoveryTools.test.ts`, `backend/tests/noteDiscoveryEvidenceService.test.ts`。

**Interfaces:**
- `createNoteDiscoveryTools(userId: string, limits: ToolLimits): NoteDiscoveryTool[]` 闭包绑定认证用户，暴露 `listRecentNotes(limit<=20)`、`searchOwnNotes(query, limit)`、`readOwnNote(noteId)`、`listOwnFeedback()`、`submitCandidate(candidate)`。
- `readOwnNote` 返回真实正文、标题、revision、日期及 `hasImages`；不含图片识别猜测；12 篇全文计数及 8 次工具调用由执行器共享计数器控制。
- `validateEvidence(userId: string, evidence: EvidenceInput[]): Promise<ValidatedEvidence[]>` 验证 ObjectId、归属、revision、摘录精确存在于正文并生成标题/日期快照与定位；删除或过期 revision 明确拒绝。
- Agent 不能从入参覆盖 userId；`relatedNotes` 不会自动成为 evidence。

- [ ] 写跨账户访问、注入无权限影响、摘录不匹配/revision 过期/图片说明、调用和全文计数上限失败测试。
- [ ] 运行 `cd backend && npx tsx --test tests/noteDiscoveryTools.test.ts tests/noteDiscoveryEvidenceService.test.ts`；预期先失败。
- [ ] 实现受限工具和纯服务端引用校验；检索复用语义 recall 仅作为候选，全文必须再次按用户权限读取。
- [ ] 重跑上述命令，预期不合法引用绝不进入候选发布路径；提交本任务。

### Task 4: Agent 编排、质量门槛与发现发布

**Files:** Create `backend/services/noteContinuationAgent.ts`, `backend/services/noteDiscoveryService.ts`, `backend/services/noteDiscoveryWorker.ts`, `backend/scripts/run_note_discovery_worker.ts`; Modify `backend/services/NoteUpdateOrchestrator.ts`, `backend/services/noteService.ts`, `backend/package.json`; Test `backend/tests/noteContinuationAgent.test.ts`, `backend/tests/noteDiscoveryWorker.test.ts`, `backend/tests/noteDiscoveryService.test.ts`。

**Interfaces:**
- `runDiscovery(userId, runId, canContinue): Promise<'completed'|'no_result'|'cancelled'>` 使用 Task 3 工具；执行器硬执行最多 3 次模型调用、8 次工具调用、12 篇全文、24000 输入 tokens、4000 输出 tokens、90 秒（含工具时间）。每调用前检查租约、开关、剩余预算；单次可重试错误最多重试一次且重新计量/预算。
- provider 工具调用能力启动时验证；默认沿用可用兼容路径。若无原生工具调用，使用结构化动作协议，经同一服务端 schema/权限检查，不引入 Agent SDK。
- `validateCandidate(candidate, evidence): Promise<QualityResult>` 检查三种类型条件、至少两条独立来源的 connection、follow_up 时序、next_step 缺失信息、证据、具体增量/反例/当下价值；失败或证据不足为 `no_result`，不得伪造摘要引用。
- 发布前二次检查所有引用当前仍有效，Discovery 幂等写入。note 更新/删除引发来源失效：在 `backend/services/NoteUpdateOrchestrator.ts` revision CAS 成功后和 `backend/services/noteService.ts` 删除成功后调用失效服务；错误不允许旧发现继续显示。保留历史聊天快照既有规则。
- Worker 使用 Task 2 持久 store 独立轮询；关闭开关取消 queued，运行任务在下一工具边界停止且禁止发布。状态包含失败分类和用量，不把故障伪装成闲聊。

- [ ] 写三类约束、反例/注入、所有硬额度、未知用量、重试重新预留、无结果不重试、失效租约 fencing、修订竞态、幂等发布和取消失败测试。
- [ ] 运行 `cd backend && npx tsx --test tests/noteContinuationAgent.test.ts tests/noteDiscoveryWorker.test.ts tests/noteDiscoveryService.test.ts`；预期先失败。
- [ ] 实现 Agent adapter/质量 gate 和独立 worker。脚本沿 `backend/scripts/run_inspiration_worker.ts` 的连接与信号处理模式，由进程管理器启动；不在 `backend/index.ts` HTTP 进程启动 worker。
- [ ] revision CAS 成功后及 `noteService.deleteNote` 删除成功后标记发现失效。候选发布 CAS 校验 run id、token、generation、租约有效；过期 worker 不可发布。
- [ ] 重跑新测试，再运行 `cd backend && npx tsx --test tests/inspirationWorker.test.ts tests/noteService.test.ts tests/noteWriteModule.test.ts`；预期旧行为通过；提交本任务。

### Task 5: 发现 API、偏好/反馈、会话承接与显式保存

**Files:** Create `backend/controllers/noteDiscoveryController.ts`, `backend/routes/noteDiscoveries.ts`; Modify `backend/index.ts`（`createApp()` 路由挂载）、`backend/services/chatService.ts`, `backend/services/chatTurnCommitService.ts`, `backend/controllers/chatController.ts`, `backend/routes/chat.ts`, `backend/models/Chat.ts`, `backend/types/index.ts`; Test `backend/tests/noteDiscoveryHttp.test.ts`, `backend/tests/noteDiscoveryChat.test.ts`。

**Interfaces:**
- 认证 API：`GET /api/note-discoveries`（当前及历史/状态）、`POST /api/note-discoveries/run`、`PATCH /api/note-discoveries/preferences`、`POST /api/note-discoveries/:id/feedback`、`DELETE /api/note-discoveries/:id/feedback`、`POST /api/note-discoveries/:id/session`、`POST /api/note-discoveries/:id/save`。
- GET 返回等待/分析中/无新发现/额度耗尽/失败独立状态；开启页面不等待模型。关闭开关撤销 queued，运行由 worker 边界检查。
- 自动节流按用户本地日 6 次、滚动小时 2 次；手动日 3 次、冷却 60 秒；每用户运行中最多一个。候选保留，首次曝光每日最多 3 条，显式查看历史可浏览已生成项。
- feedback 类型含 `not_interested|not_related|already_finished`，结构化目标、来源集、期限/撤销；不感兴趣同观察+来源集合压制 30 天；关系反例压制该关系直至来源实质更新并复核；已结束压制对应问题。
- session 接口幂等创建/复用发现会话，`Chat` 增加显式 `sourceMode: 'single_note'|'multi_note_discovery'` 和 discoveryId；选中来源每轮服务端读取最新已保存正文并写本轮多篇快照。贯通 `chatService.prepareTurn/streamChat/saveSession`、`chatTurnCommitService.ts` committed turn、controller/routes、Chat schema。客户端持久化迁移限于 `frontend/src/hooks/useChatSession.ts`、`frontend/src/hooks/chatSessionStore.ts`、`frontend/src/hooks/useChatStream.ts`。旧 single-note 默认不变，relatedNotes 只作 UI 信息。
- 保存接口只将用户确认的草稿以 `noteWriteModule.create` 新建笔记，客户端可先提交编辑后文本；幂等键防重复并回写 discovery.savedNoteId。自动流程没有笔记写入工具。账户清理入口需按真实删除流程挂钩，清理发现、反馈、运行、草稿。

- [ ] 写 API 所有权、限频、反馈撤销、曝光限制、双击幂等、多来源 committed snapshot、single-note 回归和保存重放测试。
- [ ] 运行 `cd backend && npx tsx --test tests/noteDiscoveryHttp.test.ts tests/noteDiscoveryChat.test.ts`；预期先失败。
- [ ] 在共享类型文件定义 API DTO：`EvidenceDto={noteId:string;revision:number;title:string;noteDate:string;excerpt:string;locator?:{start:number;end:number};hasImages:boolean}`；`DiscoveryDto={id:string;kind:'connection'|'follow_up'|'next_step';title:string;observation:string;whyNow:string;evidence:EvidenceDto[];qualification:string;suggestedAction:string;draft?:string;status:'ready'|'stale'|'dismissed'|'completed';createdAt:string;exposedAt?:string;sessionId?:string;savedNoteId?:string}`；list 返回 `{items:DiscoveryDto[];run:{status:'idle'|'queued'|'running'|'completed'|'no_result'|'budget_exhausted'|'failed';retryAt?:string;errorCode?:string}}`。手动触发 `{runId,status}`；session `{session:IChat,reused:boolean}`；save `{note:NoteDto,discovery:DiscoveryDto}`。
- [ ] 认证后在 `backend/index.ts` 的 `createApp()` 挂路由。贯通多来源 prepareTurn/streamChat/saveSession 与 committed turn；single-note 保持既有服务端快照逻辑。
- [ ] 当前 `rg` 未发现账户删除 API/service/controller；不虚构删除入口。提供幂等 `cleanupUser(userId)` 服务，Task 8 文档标注当前无账户删除流程，未来若增加再挂接。
- [ ] 重跑新测试，并运行 `cd backend && npx tsx --test tests/chatNoteContextService.test.ts tests/chatTurnCommitService.test.ts tests/chatSingleNote.test.ts tests/noteService.test.ts`；预期旧聊天契约通过、账户隔离为零泄漏；提交本任务。

### Task 6: 变更调度与 feature flag 集成

**Files:** Create `backend/services/noteDiscoveryScheduleService.ts`; Test `backend/tests/noteDiscoveryScheduleService.test.ts`。`backend/config/index.ts` 只由 Task 1 拥有；`NoteUpdateOrchestrator.ts` 只由 Task 4 拥有。

**Interfaces:**
- `scheduleChanged(userId: string, noteId: string, revision: number, now: Date): Promise<void>` 新增/修改合并静默 2 分钟水位；启动或开关新启用时建立近期初始化水位并允许全历史搜索。
- 扫描/打开页时仅在从未有效扫描或超 24 小时且有未扫描变更时补排；无变化不重复消耗模型。每日按用户本地日期，不使用 UTC 日替代。
- 调度参数可配置并限界；feature flag 关闭时不注册新入口/worker，原接口行为兼容。

- [ ] 写 debounce 合并、用户时区日界、6/2/3 限额、24 小时条件、无变更静默、关闭/重开和运行中水位合并失败测试。
- [ ] 运行 `cd backend && npx tsx --test tests/noteDiscoveryScheduleService.test.ts`；预期先失败。
- [ ] 实现调度。note update 钩子由 Task 4 修改 `NoteUpdateOrchestrator.ts`，本任务不重复编辑；worker 定时扫描仅由 Task 4 独立脚本运行，不在 HTTP handler 启动后台 Promise。
- [ ] 重跑命令，预期多实例由持久 store 保证幂等；提交本任务。

### Task 7: 生产界面与可访问状态

**Files:** Create/Modify 由原型确认后列定，预计 `frontend/src/components/NoteDiscoveryPanel.tsx`、对应 module.scss、`frontend/src/services/noteDiscoveries.ts`、`frontend/src/hooks/useNoteDiscoveries.ts`、首页/工作区入口、`frontend/src/hooks/useChatSession.ts`、`frontend/src/hooks/chatSessionStore.ts`、`frontend/src/hooks/useChatStream.ts`；Test 对应组件、hook 与本地/远程会话迁移 tests。

**Interfaces:** 只实现用户确认原型所列流程；API 类型必须匹配 Task 5。入口显示自动发现开关；卡片最多主推一条、可展开三条，展示证据/来源修订；提供继续探索、草稿可编辑保存、不感兴趣/联系不成立/已结束/撤销。活跃会话时不插入主动消息；来源失效安静撤卡；无笔记给普通记录/聊天入口。

- [ ] 原型经用户确认后锁定组件/交互文件清单；确认前只交付独立 HTML，不改生产组件。
- [ ] 按确认原型实现状态、反馈、继续探索、草稿预览与保存；失败/额度耗尽清晰呈现，不伪装闲聊。
- [ ] 增加交互测试，验证首屏曝光上限和会话打开后承接已选动作、不重复询问开场。
- [ ] 写前端组件/hook 测试，运行 `cd frontend && npm test -- <测试文件路径>`（脚本为 `vitest run`）；预期先失败，再实现后重跑通过，并运行 `cd frontend && npm run build`。提交本任务并交主 Agent做视觉及权限边界复核。

### Task 8: 评估、观测、文档与阶段验收

**Files:** Create 合成评估 fixtures/test harness（`backend/tests/fixtures/noteContinuation/`、`backend/tests/noteContinuationEvaluation.test.ts`）；Modify 实际存在的产品、架构、AI 配置、worker 运维文档（先 `rg --files` 确认，不预设文档文件名）。

- [ ] 建至少 24 组固定合成案例：三类正例各 4 组，12 组覆盖伪关联、反例、已结束、重复、稀疏、图片、提示注入、跨账户、修订变化、删除、额度和故障；断言硬门槛和契约。
- [ ] 配独立真实模型人工评估流程；mock 不能作为质量合格证据。逐条评估有依据、非复述、可继续价值；正例至少 9/12 合格，负例无无依据结论，否则改检索/筛选，不增加数量。
- [ ] 观测成功/无结果率、延迟、单次成本、重复率、曝光后认可/否定、继续讨论和保存比例；日志不收私人正文。
- [ ] 更新实际存在的产品、架构、AI 配置与 worker 部署文档，说明回滚/关闭 feature flag；记录当前无账户删除 API/service，展示需由调用方显式调用 `cleanupUser(userId)`。验证预算结算、租约断点恢复、引用 100% 可核对、跨账户泄漏为零。
- [ ] 在每个环境配置已核实的模型 token 单价及用户/全局 CNY 上限；供应商价格或配置未知时运行保持关闭。不得在计划中预设未核实价格。
- [ ] 发布前依项目指引核对 `origin/main` 精确提交、备份与候选版本；本计划不授权发布，发布须用户另行授权。

## 自审覆盖

任务按依赖顺序串行实施；允许 Agent 分别拥有 Task 1、Task 2、Task 3 的独立文件，但 Task 4、5、6 会触及共享写入口，须同一集成负责人依次合并、不得并行编辑 `NoteUpdateOrchestrator.ts`、`noteService.ts`、`index.ts`、Chat 类型或 session persistence。Task 7 等原型确认后再锁定 UI 文件清单。检查命令以 backend `tsx --test` 执行，不传 Vitest 参数；前端命令按 `frontend/package.json`。账号删除入口经本轮 `rg` 未发现，故只计划独立幂等清理服务而不声称已接入。Spec 各产品约束由 Global Constraints 与 Task 1–8 覆盖；实现前仍验证 provider 工具调用/价格，未知时 fail closed。
