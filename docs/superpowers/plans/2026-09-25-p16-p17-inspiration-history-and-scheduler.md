# P16＋P17 灵感历史与主动发现 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在一轮交付中，让用户整理、回看 P15 灵感，并在明确开启后每 24 小时以内最多自动研究一次，安全地呈现在同一份历史中。

**Architecture:** 保留 P15 的研究与来源校验流程，将“生成状态”“用户整理状态”“查看状态”“产生方式”分开。MongoDB 保存历史、用户设置、研究占用和自动任务；独立 worker 只唤醒扫描，所有认领、频率、额度和状态写入都由数据库原子操作裁决。前端只通过鉴权 API 读取和改变当前用户的状态。

**Tech Stack:** TypeScript、Express 5、Mongoose 8、MongoDB、Next.js 15、React 18、Sass、Node test runner、Vitest。

**Spec:** [P16＋P17 联合评审稿](../specs/2026-09-25-p16-inspiration-library-design.md)

## Global Constraints

- P16 与 P17 使用同一开发分支、同一整体验收；不合并只有 P16 的半成品。P15 本地体验验证是开始实施前的前置条件。
- 保存只改变灵感记录，不创建或改写笔记；忽略可恢复，不影响未来主题学习，也不释放 `InspirationSource` 去重记录。
- 旧 `InspirationItem.status` 继续只表示 `draft | completed`；新增字段不能改变 P15 结果和旧记录的可读性。
- 主动发现默认关闭，开启本身不调用供应商；首次自动尝试在开启满 24 小时后，后续每用户至少相隔 24 小时，手动研究顺延下次自动时间。
- 仅标题、关键词、短摘要可送 DeepSeek；Tavily 只接收查询；不得读/传笔记正文。所有新接口保持 `Cache-Control: no-store`、按用户隔离和安全 DTO。
- 自动任务默认全站最多 2 个并发、每天最多 20 次尝试，两者通过后端环境变量配置；达到上限要延后而非补跑。
- 只做站内未查看提示，不做邮件、短信、系统推送；生产部署不得包含运营后台上线步骤。
- 本计划仅针对本地开发和验证；不推送 GitHub、不部署线上，等待用户完整体验和明确决定。
- 执行时从当前本地基线创建单独的 `codex/` 分支；先核对工作区中现有的未跟踪文档，绝不把它们顺手加入功能提交。

## Review Focus

1. 旧 P15 灵感缺少 `userState/origin/viewedAt`：读取必须视为普通手动历史，不能漏掉或误计为“新”。Task 1、2 测试。
2. 伪造 ID、跨用户 ID、非法状态流转及两个标签页竞争：不能泄露或改变他人数据。Task 2、3 测试。
3. 自动任务在供应商调用后崩溃、租约过期或两个 worker 同时扫描：不得在同一周期再次花钱或突破同用户互斥。Task 4、5 测试。
4. 用户在任务中关闭开关：不能发起后续供应商调用，已发出的请求允许收尾，不能生成空卡或泄露私有内容。Task 4、5 测试。
5. 列表翻页期间插入新结果、切换视图与网络故障：不能重复/漏掉旧记录，也不能清空已显示结果。Task 2、6 测试。

---

## File Map

| 文件 | 唯一职责 |
| --- | --- |
| `backend/models/InspirationItem.ts` | 灵感状态字段及列表索引 |
| `backend/models/InspirationSettings.ts` | 每用户主动授权、下次时间及上次结果 |
| `backend/models/InspirationRun.ts` | 每次自动周期的持久状态与供应商调用边界 |
| `backend/models/InspirationResearchGate.ts` | 手动/自动共用的每用户研究占用 |
| `backend/models/InspirationDailyBudget.ts` | 全站每日自动尝试计数 |
| `backend/models/InspirationWorkerSlot.ts` | 全站最多两个自动并发租约 |
| `backend/services/inspirationCatalogService.ts` | 历史游标、详情、整理及已查看操作 |
| `backend/services/inspirationScheduleService.ts` | 授权、时间推进、原子任务认领、结果安全状态 |
| `backend/services/inspirationResearchGate.ts` | 原子研究占用与释放 |
| `backend/services/inspirationService.ts` | 复用 P15 研究链，并在手动/自动入口使用持久占用 |
| `backend/services/inspirationWorker.ts` | 仅扫描、执行和结束已经认领的自动任务 |
| `backend/scripts/run_inspiration_worker.ts` | 独立进程入口，连接 MongoDB 后循环唤醒 worker |
| `backend/routes/inspirations.ts` | 已登录用户的灵感与设置 API |
| `backend/services/inspirationTypes.ts` | 安全 DTO 和稳定错误码 |
| `frontend/src/services/inspirationService.ts` | 前端安全 DTO 解析及请求封装 |
| `frontend/src/app/inspiration/page.tsx` | 研究、历史、整理及主动发现的单页体验 |
| `frontend/src/app/inspiration/inspiration.module.scss` | 现有灵感页样式增量扩展 |
| `frontend/src/components/TopNavigation.tsx` | 站内未查看主动灵感提示 |
| `backend/config/index.ts`、`.env.example`、`backend/.env.example`、`docker-compose.yml`、`deploy/DEPLOY_GUIDE.md` | 自动额度与 worker 启动/关闭说明；不执行部署 |

## Task 1: 分离灵感状态并兼容旧结果

**Files:** Modify `backend/models/InspirationItem.ts`, `backend/services/inspirationTypes.ts`, `backend/services/inspirationService.ts`; Test `backend/tests/inspirationService.test.ts`, create `backend/tests/inspirationModel.test.ts`.

**Interfaces:** Produces `InspirationDto` fields `userState: 'regular'|'saved'|'dismissed'`, `origin: 'manual'|'scheduled'`, `viewedAt: string|null`; `toInspirationDto(item)` for later catalog and route use. Missing legacy fields normalize to `regular`, `manual`, `null` without writing user data.

- [ ] **Step 1: Write failing tests** for old completed records and new result defaults:

```ts
const oldResult = { _id: '507f191e810c19729de860ea', status: 'completed', createdAt: new Date('2026-09-22T00:00:00Z') };
assert.equal(toInspirationDto(oldResult).userState, 'regular');
assert.equal(toInspirationDto(oldResult).origin, 'manual');
assert.equal(toInspirationDto(oldResult).viewedAt, null);
```

- [ ] **Step 2: Verify red.** Run `cd backend && npx tsx --test tests/inspirationModel.test.ts tests/inspirationService.test.ts`; expected: missing DTO fields/helper.
- [ ] **Step 3: Add fields and safe DTO mapping.** Preserve `status` exactly; add `userState`, `userStateChangedAt`, `origin`, `viewedAt` and indexes `{ userId, status, createdAt, _id }` and `{ userId, status, userState, userStateChangedAt, _id }`. New P15 creations set `origin: 'manual'`, `userState: 'regular'`, and mark the auto-opened manual result viewed. Do not expose `relatedNotes` or internal queries.

```ts
userState: { type: String, enum: ['regular', 'saved', 'dismissed'], default: 'regular' },
origin: { type: String, enum: ['manual', 'scheduled'], default: 'manual' },
viewedAt: { type: Date, default: null },
```
- [ ] **Step 4: Verify green and typecheck.** Run the two tests and `cd backend && npm run typecheck`; expected PASS.
- [ ] **Step 5: Commit only Task 1 files.** `git add backend/models/InspirationItem.ts backend/services/inspirationTypes.ts backend/services/inspirationService.ts backend/tests/inspirationModel.test.ts backend/tests/inspirationService.test.ts && git commit -m "feat(inspiration): separate lifecycle and user state"`.

## Task 2: 历史列表、详情与稳定分页

**Files:** Create `backend/services/inspirationCatalogService.ts`, `backend/tests/inspirationCatalogService.test.ts`; modify `backend/routes/inspirations.ts`, `backend/tests/inspirationHttpContract.test.ts`.

**Interfaces:** `list(userId, view, cursor): Promise<{items: InspirationDto[]; nextCursor: string|null}>`, `detail(userId,id): Promise<InspirationDto>`, `latest(userId): Promise<InspirationDto|null>`. Three views are `recent|saved|dismissed`; cursor is opaque base64url of version, view, timestamp and id.

- [ ] **Step 1: Write failing service and route tests.** Seed 25 completed records, an unfinished draft, a dismissed item and another user's item. Assert `recent` includes saved but excludes dismissed, `saved/dismissed` sort by `userStateChangedAt`, each page has at most 20, the next cursor returns the remaining 5, and an inserted newer item between pages does not duplicate or omit the original 25. Assert malformed/wrong-view cursors return 400, other-user detail returns 404, and all routes authenticate first with `no-store`.

```ts
const first = await catalog.list(userId, 'recent', null);
assert.equal(first.items.length, 20);
const second = await catalog.list(userId, 'recent', first.nextCursor);
assert.equal(new Set([...first.items, ...second.items].map(x => x.id)).size, 25);
```

- [ ] **Step 2: Verify red.** Run `cd backend && npx tsx --test tests/inspirationCatalogService.test.ts tests/inspirationHttpContract.test.ts`; expected: catalog endpoints do not exist.
- [ ] **Step 3: Implement keyset queries.** Filter `status:'completed'` and `userId` in every query; legacy `userState` missing counts as regular. For `recent`, exclude dismissed with `$ne`; for other views match their state. Use timestamp-descending, `_id`-descending tuple predicates, fetch 21 to compute the next cursor, and validate cursor shape and size before Mongo usage. Add `GET /`, `GET /:id`; keep `/latest` declared before `/:id` and make it exclude dismissed.

```ts
const page = await InspirationItem.find({ userId, status: 'completed', userState: { $ne: 'dismissed' }, ...cursorPredicate })
  .sort({ createdAt: -1, _id: -1 }).limit(21).lean();
return { items: page.slice(0, 20).map(toInspirationDto), nextCursor: page.length > 20 ? encodeCursor(page[19]) : null };
```
- [ ] **Step 4: Verify green.** Run focused tests plus `cd backend && npm run typecheck`; expected PASS.
- [ ] **Step 5: Commit Task 2 files.** `git add backend/services/inspirationCatalogService.ts backend/routes/inspirations.ts backend/tests/inspirationCatalogService.test.ts backend/tests/inspirationHttpContract.test.ts && git commit -m "feat(inspiration): add paged history and detail"`.

## Task 3: 保存、忽略、恢复和未查看提示

**Files:** Modify `backend/services/inspirationCatalogService.ts`, `backend/routes/inspirations.ts`, `backend/services/inspirationTypes.ts`; test `backend/tests/inspirationCatalogService.test.ts`, `backend/tests/inspirationHttpContract.test.ts`.

**Interfaces:** `changeUserState(userId,id,operation)` where `operation` is `save|unsave|dismiss|restore`; `markViewed(userId,id)`; `unviewedCount(userId)`. Each state change uses a conditional `findOneAndUpdate` scoped by `userId`, completed status, expected old state. Repeated identical operation is idempotent; conflicting stale transition is 409.

- [ ] **Step 1: Write failing transition tests** for regular→saved→regular, regular→dismissed→regular; saved→dismiss returns 409; repeated save/view are idempotent; two concurrent opposite operations yield one winner; other-user ID returns 404; ignored unviewed scheduled item does not count. Assert no planner/search/synthesizer call during state/view operations.

```ts
assert.equal((await catalog.changeUserState(userId, id, 'save')).userState, 'saved');
assert.equal((await catalog.changeUserState(userId, id, 'save')).userState, 'saved');
await assert.rejects(catalog.changeUserState(userId, id, 'dismiss'),
  (error: any) => error.statusCode === 409);
assert.equal(await catalog.unviewedCount(userId), expectedCount);
```

- [ ] **Step 2: Verify red.** Run the two focused test files; expected: methods/routes absent.
- [ ] **Step 3: Implement conditional transitions** and `PATCH /:id/user-state`, `POST /:id/viewed`, `GET /unviewed-count` (register count before `/:id`). Validate exact operation enum, only write `viewedAt` once, use safe DTO, and never mutate `InspirationSource` on ignore.

```ts
const updated = await InspirationItem.findOneAndUpdate(
  { _id: id, userId, status: 'completed', userState: expectedState },
  { $set: { userState: nextState, userStateChangedAt: new Date() } },
  { new: true },
);
```
- [ ] **Step 4: Verify green.** Run focused tests and backend typecheck; expected PASS.
- [ ] **Step 5: Commit Task 3 files.** `git add backend/services/inspirationCatalogService.ts backend/routes/inspirations.ts backend/services/inspirationTypes.ts backend/tests/inspirationCatalogService.test.ts backend/tests/inspirationHttpContract.test.ts && git commit -m "feat(inspiration): add reversible organization and viewed state"`.

## Task 4: 持久授权、每用户研究占用与共享 P15 链

**Files:** Create `backend/models/InspirationSettings.ts`, `backend/models/InspirationResearchGate.ts`, `backend/services/inspirationScheduleService.ts`, `backend/services/inspirationResearchGate.ts`, `backend/tests/inspirationScheduleService.test.ts`, `backend/tests/inspirationResearchGate.test.ts`; modify `backend/services/inspirationService.ts`, `backend/routes/inspirations.ts`, `backend/tests/inspirationService.test.ts`, `backend/tests/inspirationHttpContract.test.ts`.

**Interfaces:** `settings.get(userId)`, `settings.setEnabled(userId, boolean, now)`, `gate.acquire(userId, origin, now): Promise<token|null>`, `gate.release(userId, token)`, `inspirationService.request(userId)` and `inspirationService.runScheduled(userId, canContinue)` both use the same research core and gate. `canContinue()` checks authorization before every new provider stage.

- [ ] **Step 1: Write failing tests** for default disabled, enable→first `nextEligibleAt = now+24h`, disable cancellation, repeated enable not resetting the clock, missing API-key refusal, manual research deferring the next automatic time, two service instances contending on the same user, and a disabled setting stopping the next scheduled provider stage.

```ts
assert.equal((await settings.get(userId)).enabled, false);
await settings.setEnabled(userId, true, at);
assert.equal((await settings.get(userId)).nextEligibleAt, new Date(at.getTime() + 86_400_000).toISOString());
assert.ok(await gate.acquire(userId, 'manual', at));
assert.equal(await gate.acquire(userId, 'scheduled', at), null);
```

- [ ] **Step 2: Verify red.** Run `cd backend && npx tsx --test tests/inspirationScheduleService.test.ts tests/inspirationResearchGate.test.ts tests/inspirationService.test.ts`; expected: new models/services missing.
- [ ] **Step 3: Implement settings and gate.** Use a unique `userId` index on both documents, compare-and-set acquisition with random fencing token and lease expiry, owner-token release, and a bounded provider-call duration less than the lease. Preserve no-result and P15 source dedupe. Scheduled calls set `origin:'scheduled'`, `viewedAt:null`; manual calls set `origin:'manual'`, `viewedAt` when auto-opened. Add authenticated `GET/PUT /settings`, exact boolean validation and safe status DTO. Recheck `enabled` before DeepSeek planning, Tavily search and DeepSeek synthesis. If disabled during an already sent call, do not start the next one.

```ts
const token = randomUUID();
const gate = await InspirationResearchGate.findOneAndUpdate(
  { userId, $or: [{ busyUntil: { $lte: now } }, { busyUntil: null }] },
  { $set: { token, origin, busyUntil: new Date(now.getTime() + leaseMs) } },
  { new: true },
);
if (!gate) throw inspirationError('INSPIRATION_IN_PROGRESS', 409);
```

Create the unique per-user gate document idempotently before acquisition; do not use an unindexed upsert that allows duplicate gate documents. Register `/settings` before `/:id`.
- [ ] **Step 4: Verify green.** Run focused tests and backend typecheck; expected PASS.
- [ ] **Step 5: Commit Task 4 files.** Stage the files listed in Task 4 individually, then `git commit -m "feat(inspiration): persist opt-in and shared research gate"`.

## Task 5: 可恢复的独立自动任务与额度保护

**Files:** Create `backend/models/InspirationRun.ts`, `backend/models/InspirationDailyBudget.ts`, `backend/models/InspirationWorkerSlot.ts`, `backend/services/inspirationWorker.ts`, `backend/scripts/run_inspiration_worker.ts`, `backend/tests/inspirationWorker.test.ts`; modify `backend/services/inspirationScheduleService.ts`, `backend/config/index.ts`, `.env.example`, `backend/.env.example`, `docker-compose.yml`, `deploy/DEPLOY_GUIDE.md`.

**Interfaces:** `worker.tick(now): Promise<void>` is safe for concurrent calls from two processes. Run state is `queued|claimed|provider_started|completed|no_result|failed|cancelled`; a unique `{userId, cycleAt}` key prevents duplicate cycles. The worker entrypoint connects MongoDB, ticks periodically, and closes cleanly on SIGTERM; the interval itself is *not* the task source of truth.

- [ ] **Step 1: Write failing worker tests** with injected clock and fake research. Assert: disabled never schedules; before first 24h never runs; due user gets at most one daily attempt even on no-result/failure; manual work defers it; two concurrent `tick()` calls produce one claim; two auto jobs max globally; daily UTC counter never exceeds 20; crash before provider start can be reclaimed, crash after `provider_started` is marked failed without a second provider call; stale lease clears; shutdown/restart does not backfill missed days. Assert logs contain codes, not search query or note snippets.

```ts
await Promise.all([workerA.tick(due), workerB.tick(due)]);
assert.equal(fakeResearch.callsFor(userId), 1);
await workerA.tick(new Date(due.getTime() + 60_000));
assert.equal(fakeResearch.callsFor(userId), 1);
```

- [ ] **Step 2: Verify red.** Run `cd backend && npx tsx --test tests/inspirationWorker.test.ts`; expected: worker absent.
- [ ] **Step 3: Implement atomic scheduler.** Reserve a due cycle and advance `lastAttemptAt/nextEligibleAt` *before* provider work; reserve one of two global worker slots and a daily quota token atomically; write `provider_started` before calling providers. On lease expiry, recover a pre-provider claim but never replay a provider-started cycle. Finish with `completed|no_result|failed`; expose only safe last status through settings. A controlled cancellation checks the setting between provider stages. Use worker-specific bounded timeouts and a lease exceeding the complete worst-case provider pipeline; fence every completion write by token.

```ts
const claimed = await InspirationRun.findOneAndUpdate(
  { state: 'queued', cycleAt: { $lte: now } },
  { $set: { state: 'claimed', leaseOwner: token, leaseUntil } },
  { sort: { cycleAt: 1, _id: 1 }, new: true },
);
await InspirationRun.updateOne(
  { _id: claimed?._id, state: 'claimed', leaseOwner: token },
  { $set: { state: 'provider_started' } },
);
```

The real implementation must use an atomic compare-and-set **for each document**, then acquire quota, slot, due-time claim and per-user gate in a documented order before the first external call. This project's local MongoDB is standalone, so do not assume a multi-document transaction: compensate unused reservations when a later acquisition fails, and make a crash leave the system conservative rather than exceed the quota. A crash after `provider_started` may lose one cycle, intentionally preferring that over a duplicate paid call; it must not be retried within that cycle.
- [ ] **Step 4: Wire a separate worker process.** Add config `INSPIRATION_AUTO_CONCURRENCY` default `2`, `INSPIRATION_AUTO_DAILY_LIMIT` default `20`, and `INSPIRATION_WORKER_POLL_MS` with a bounded default. Add a `backend`-image `inspiration-worker` service in `docker-compose.yml` with the existing MongoDB, DeepSeek and Tavily variables, explicit command `node dist/scripts/run_inspiration_worker.js`, `profiles: ["inspiration"]`, and `restart: always`; do not add a web endpoint that runs arbitrary jobs. Document how to leave the worker off for local P15 testing, start it only after P16＋P17 acceptance, check safe status, and turn it off without deleting results. Ensure `TAVILY_API_KEY` is passed to both backend and worker, never frontend.

```yaml
inspiration-worker:
  profiles: ["inspiration"]
  command: ["node", "dist/scripts/run_inspiration_worker.js"]
  restart: always
```
- [ ] **Step 5: Verify green and deployment syntax.** Run worker tests, backend typecheck/build and `docker compose config`; expected PASS and valid service configuration. Inspect generated config without printing real environment-secret values into the task log.
- [ ] **Step 6: Commit Task 5 files.** Stage Task 5 files individually, then `git commit -m "feat(inspiration): add durable opt-in research worker"`.

## Task 6: 单页历史与整理体验

**Files:** Modify `frontend/src/services/inspirationService.ts`, `frontend/src/services/inspirationService.test.ts`, `frontend/src/app/inspiration/page.tsx`, `frontend/src/app/inspiration/page.test.tsx`, `frontend/src/app/inspiration/inspiration.module.scss`.

**Interfaces:** Frontend functions `listInspirations(view,cursor)`, `getInspiration(id)`, `changeInspirationState(id,operation)`, `markInspirationViewed(id)`, `getInspirationSettings()`, `setInspirationEnabled(enabled)` consume only the safe backend DTOs. Existing `requestInspiration()` remains the manual action.

- [ ] **Step 1: Write failing service/UI tests.** Cover legacy DTO defaults, three views, save/unsave/dismiss/restore, load-more location at the end of its list, keyboard focus, results inserted once, no-result feedback, retrieval/update errors preserving visible cards, and keeping each view's cursor on tab changes. Use a real 25-item fixture for pagination.

```tsx
fireEvent.click(await screen.findByRole('button', { name: '保存灵感' }));
expect(await screen.findByRole('button', { name: '取消保存' })).toBeInTheDocument();
fireEvent.click(screen.getByRole('tab', { name: '已保存' }));
expect(screen.getByText('已保存的研究标题')).toBeInTheDocument();
```

- [ ] **Step 2: Verify red.** Run `cd frontend && npx vitest run src/services/inspirationService.test.ts src/app/inspiration/page.test.tsx`; expected: absent actions.
- [ ] **Step 3: Implement safe parsers and UI.** Split large page into focused local components if needed (`InspirationHistory`, `InspirationCard`, `InspirationSettingsPanel`) without redesigning global navigation. Preserve existing citation links and privacy notice. Place “加载更多” after the final item of the active history view, not above the first card. When a request fails, retain current list and cursor; show actionable retry. After manual research, prepend once, open once, and mark viewed.

```tsx
<section aria-label="灵感历史">
  <InspirationHistory items={items} onOpen={openItem} />
  {nextCursor && <button type="button" onClick={loadMore}>加载更多灵感</button>}
</section>
```
- [ ] **Step 4: Verify green.** Run focused tests, frontend typecheck and lint for touched files; expected PASS.
- [ ] **Step 5: Commit Task 6 files.** Stage Task 6 files individually, then `git commit -m "feat(inspiration): organize and browse research history"`.

## Task 7: 主动发现设置、站内新结果与整体验收

**Files:** Modify `frontend/src/app/inspiration/page.tsx`, `frontend/src/app/inspiration/page.test.tsx`, `frontend/src/app/inspiration/inspiration.module.scss`, `frontend/src/components/TopNavigation.tsx`, `frontend/src/components/TopNavigation.module.scss`, `frontend/src/services/inspirationService.ts`, `frontend/src/services/inspirationService.test.ts`; create `frontend/src/components/TopNavigation.test.tsx`; modify `docs/superpowers/specs/2026-09-25-p16-inspiration-library-design.md` only if implementation discovers an approved clarification.

**Interfaces:** `getUnviewedInspirationCount(): Promise<number>` reads the authenticated count; settings UI uses the Task 6 service functions. Opening a scheduled item calls `markInspirationViewed(id)` and refreshes the count. No browser timer or browser-only state controls server scheduling.

- [ ] **Step 1: Write failing tests** for default-off opt-in, disclosure text, first run `now+24h` shown in local time, enable/disable state and failure recovery, safe last-run result, new-count badge on navigation and history, marking viewed when detail actually opens, ignored unseen result disappearing from count, and no email/browser notification.

```tsx
expect(screen.getByRole('switch', { name: '定期为我寻找灵感' })).not.toBeChecked();
fireEvent.click(screen.getByRole('switch', { name: '定期为我寻找灵感' }));
expect(mockSetInspirationEnabled).toHaveBeenCalledWith(true);
expect(screen.getByText('新灵感')).toBeInTheDocument();
```

- [ ] **Step 2: Verify red.** Run focused frontend tests; expected: setting and count absent.
- [ ] **Step 3: Implement settings and badge.** Keep the switch disabled while saving, show exact data-use/cadence disclosure before first enable, render server-provided estimated next time via browser locale, and display failure codes as user-readable states. Count comes from server and is reset only by the viewed API; polling may refresh the badge but must never trigger research.

```tsx
<label htmlFor="inspiration-schedule">定期为我寻找灵感</label>
<input id="inspiration-schedule" type="checkbox" role="switch"
  checked={settings.enabled} disabled={savingSettings}
  onChange={(event) => void saveSettings(event.target.checked)} />
```
- [ ] **Step 4: Full verification.** Run `cd backend && npm test && npm run typecheck && npm run build`; `cd frontend && npm test && npm run typecheck && npm run lint && npm run build && npm run check:route-budgets`; `docker compose config` with safe dummy environment only. Manually use two accounts and controllable worker clock to follow the ten acceptance cases in the spec. Do not call live Tavily/DeepSeek in automated tests.
- [ ] **Step 5: Inspect changes and commit.** Run `git diff --check`, `git status --short`, review staged files for secrets and unrelated edits; stage Task 7 files individually, then `git commit -m "feat(inspiration): complete opt-in discovery experience"`. Present the combined local branch and test results for user trial; do not push, merge, or deploy without a subsequent user request.

## Execution boundary

This is one integrated delivery, but every task is independently testable. Task 1–3 prepare a working library; Task 4–5 add safe automation; Task 6–7 complete the joint user experience. Do not start Task 4–5 until the P15 experience prerequisite is explicitly accepted; if the user only wants planning now, stop after this document for review. Keep existing untracked recovery documents and any user changes untouched.
