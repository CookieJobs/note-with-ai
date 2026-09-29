# Profile Note Topics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a recoverable, per-note topic index for all user notes and expose date-filtered topic counts with accurate coverage and retry states.

**Architecture:** Store one durable index record per note, keyed by note/user, with current source revision and canonical input fingerprint. A resumable backfill and durable pending records feed per-note workers; a profile topics API aggregates only current ready records and reports pending/failed/old snapshots separately. The profile UI consumes that endpoint without making AI calls when the user changes ranges.

**Tech Stack:** Express, Mongoose, TypeScript, existing DeepSeek client, existing note write/enrichment services, React/Next.js, Node `node:test` via `tsx`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-profile-rework-design.md`

## Global Constraints

- Scopes are `all | year | sixMonths`; all date boundaries use `Asia/Shanghai` calendar days and months.
- One note contributes at most one count to each normalized topic.
- Current index freshness requires both user `revision` and `sourceFingerprint` to match.
- A stale worker must not write current status or replace a newer success snapshot.
- Initial backfill is background, resumable, and idempotent; it never reruns whole-user profile analysis.
- Use existing `keywords`/`summary` as the first extraction inputs. If the resulting source has no usable topic labels, send only that note's title/body/available summary to DeepSeek; never batch notes, and cap the combined model input at 3,000 Unicode characters.
- The topic worker allows at most 2 concurrent DeepSeek calls per process and 1 active call per user across processes. Persist claims/leases so replicas cannot process the same note or user concurrently.
- For each note input fingerprint, make at most 3 automatic AI attempts total (first attempt plus retries), with delays of 30 seconds then 120 seconds. Do not automatically retry after exhaustion.
- A manual retry runs one attempt per failed note, subject to a per-note cooldown of 10 minutes and a rolling limit of 3 manual attempts per 24 hours. The window naturally restores eligibility; users never need to edit an unchanged note to recover from a prolonged provider outage. Manual attempts do not reset automatic attempts or create an automatic retry loop.
- Normalize topic labels with NFKC, trim, collapse whitespace, and lowercase Latin text. Apply a versioned explicit alias map; version 1 maps `AI` and `人工智能` to canonical display label `人工智能`. Add aliases only through a reviewed map/test change, never fuzzy model matching.
- Range changes only query/filter the index; they never call AI or rebuild an index.
- Current topics and `X/Y` include only current ready records; old success snapshots remain a separately labeled display and count as neither ready nor current topic counts.
- Preserve `/api/recommend`, note `recommendCache`, and note enrichment recommendation artifacts.

## Review Focus

- Async summary/keyword writes can change a fingerprint without changing `Note.revision`.
- A note can change while DeepSeek is running; neither its stale result nor stale failure may overwrite current state or `lastSuccess`.
- Missing index records and stale revision/fingerprint records count as pending; all per-note states sum to the scoped note total.
- A leap/month-end date and a timestamp near UTC midnight must map to the correct Shanghai range.
- Backfill interruption/restart, duplicate scheduling, replica claims, concurrency limits, and exhausted retries must not double-count or leave jobs stuck/running forever.

---

### Task 1: Define canonical topic inputs and persistent index state

**Files:**
- Create: `backend/models/UserNoteTopicIndex.ts`
- Create: `backend/services/userNoteTopicInputs.ts`
- Create: `backend/tests/userNoteTopicInputs.test.ts`
- Create: `backend/tests/userNoteTopicIndexModel.test.ts`

**Interfaces:**
- `buildTopicInputs(note: TopicInputNote): { sourceRevision: number; sourceFingerprint: string; source: 'keywords' | 'summary' | 'bounded_content' | 'mixed'; promptText: string; candidateTopics: string[] }` canonicalizes title/body/summary/keywords in fixed field order and hashes all actual source values, including values added by async metadata generation. Use SHA-256 over versioned canonical JSON; prompt text uses `contentText.trim()` or `content.trim()` and a 3,000-code-point total cap including title and available summary.
- `normalizeTopicLabel(label: string): string` applies NFKC, trim, whitespace collapse, lowercase Latin text, then the explicit alias map; version 1 maps `ai` and `人工智能` to canonical `人工智能`. Unknown labels remain distinct. Export `TOPIC_ALIAS_VERSION = '1'` and bump it only alongside a reviewed alias-map and regression-test change.
- `UserNoteTopicIndex` is uniquely indexed by `{ userId: 1, noteId: 1 }`; it stores `sourceRevision`, `sourceFingerprint`, `status`, `topics`, `source`, `indexedAt`, `errorAt`, `lastSuccess`, attempts, and claim timestamp needed to recover work.

- [ ] **Step 1: Write failing tests** named `fingerprint changes when summary or keywords change at same revision`, `fingerprint and prompt input normalize deterministically`, `bounded model input is at most 3000 Unicode code points`, `existing keywords and summary become candidate topics`, `AI and 人工智能 normalize to one canonical Chinese topic`, `unknown Chinese labels remain distinct`, and `index schema has a unique user-note key and explicit states`.
- [ ] **Step 2: Run** `cd backend && npx tsx --test tests/userNoteTopicInputs.test.ts tests/userNoteTopicIndexModel.test.ts`. Expected: FAIL because types/model are absent.
- [ ] **Step 3: Implement the pure input builder and schema**. Keep the full canonical fingerprint inputs separate from the capped LLM text. Topic statuses are `pending | processing | ready | failed`; persist prior successful result only in `lastSuccess` when a current attempt begins.
- [ ] **Step 4: Run** `cd backend && npx tsx --test tests/userNoteTopicInputs.test.ts tests/userNoteTopicIndexModel.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add backend/models/UserNoteTopicIndex.ts backend/services/userNoteTopicInputs.ts backend/tests/userNoteTopicInputs.test.ts backend/tests/userNoteTopicIndexModel.test.ts && git commit -m "feat: define per-note topic index state"`.

### Task 2: Implement single-note topic worker, CAS, and retries

**Files:**
- Create: `backend/services/userNoteTopicIndexService.ts`
- Create: `backend/services/userNoteTopicIndexWorker.ts`
- Create: `backend/models/UserNoteTopicWorkerLease.ts`
- Create: `backend/tests/userNoteTopicIndexWorker.test.ts`
- Create: `backend/tests/userNoteTopicWorkerLease.test.ts`

**Interfaces:**
- `scheduleUserNoteTopicIndex(userId: string, noteId: string): Promise<void>` upserts the latest pending state by current revision/fingerprint and is idempotent.
- `retryFailedUserTopics(userId: string, scope: TopicScope): Promise<{ acceptedCount: number; alreadyRunningCount: number; rateLimitedCount: number; nextRetryAt: string | null }>` requeues only current failed notes in that scope and owned by `userId`; each eligible note adds exactly one manual attempt. Limit each note (across fingerprints) to one manual attempt per 10 minutes and 3 per rolling 24 hours, tracked persistently by user/note. Return `rateLimitedCount` and the earliest applicable `nextRetryAt`; do not label automatic exhaustion as permanent or require a fingerprint change for manual recovery.
- Worker jobs capture `{ noteId, userId, sourceRevision, sourceFingerprint }`; worker final writes compare both plus the latest topic source fields. `lastSuccess` changes only after a current successful result.
- Automatic attempts are capped at 3 per fingerprint total, including the first call; a changed input fingerprint starts a fresh counter. Failure schedules attempt 2 after 30 seconds and attempt 3 after 120 seconds; failure of attempt 3 becomes `failed` for automatic processing but remains eligible for rate-limited manual retry. Persist `attemptCount`, manual attempt timestamps, `retryMode`, and `nextAttemptAt`.
- A process-local semaphore caps DeepSeek concurrency at 2. A unique per-user lease document, claimed atomically with an expiry/owner token, caps active topic work to 1 per user across replicas; note-state CAS prevents duplicate claims for the same note.

- [ ] **Step 1: Write failing worker tests** named `uses existing keywords as candidates without a DeepSeek call`, `sends one bounded note when no candidate topics exist`, `keeps other note content out of the prompt`, `summary changes at unchanged revision make completion stale`, `does not replace last success on stale result or failure`, `automatic attempts stop after three with 30s and 120s delays`, `manual retry is limited to once per note per ten minutes`, and `manual retry allows three attempts per rolling 24 hours and recovers after the window`.
- [ ] **Step 2: Run** `cd backend && npx tsx --test tests/userNoteTopicIndexWorker.test.ts tests/userNoteTopicWorkerLease.test.ts`. Expected: FAIL because worker/service/lease are absent.
- [ ] **Step 3: Implement per-note extraction, persisted claims, and stale protection** using the existing DeepSeek client. Prefer candidate topics from `keywords`; when no candidate labels exist, make one call for that note using its available summary or bounded body. Enforce the stated process/user concurrency and retry limits. Before writing state, use compare-and-set filters containing both revision and captured actual input field values so a stale worker cannot commit after an async metadata update.
- [ ] **Step 4: Run** `cd backend && npx tsx --test tests/userNoteTopicIndexWorker.test.ts tests/userNoteTopicWorkerLease.test.ts tests/aiUsageTelemetry.test.ts && npm run typecheck`. Expected: PASS; assert single-note calls carry the topic-extraction operation context and no aggregate note corpus.
- [ ] **Step 5: Commit** `git add backend/models/UserNoteTopicWorkerLease.ts backend/services/userNoteTopicIndexService.ts backend/services/userNoteTopicIndexWorker.ts backend/tests/userNoteTopicIndexWorker.test.ts backend/tests/userNoteTopicWorkerLease.test.ts && git commit -m "feat: index topics per note"`.

### Task 3: Add resumable backfill and note-change scheduling

**Files:**
- Create: `backend/models/UserNoteTopicBackfill.ts`
- Create: `backend/services/userNoteTopicBackfill.ts`
- Create: `backend/services/userNoteTopicRuntime.ts`
- Modify: `backend/services/NoteUpdateOrchestrator.ts`
- Modify: `backend/services/noteEnrichmentWorker.ts`
- Modify: `backend/services/noteService.ts`
- Modify: `backend/index.ts`
- Create: `backend/tests/userNoteTopicBackfill.test.ts`
- Create: `backend/tests/userNoteTopicRuntime.test.ts`
- Modify: `backend/tests/userNoteTopicWorkerLease.test.ts`
- Modify: `backend/tests/noteWriteModule.test.ts`
- Modify: `backend/tests/noteEnrichmentWorker.test.ts`
- Modify: `backend/tests/noteService.test.ts`

**Interfaces:**
- `runTopicBackfillPage({ userId, limit }): Promise<{ scanned: number; cursor: string | null; done: boolean }>` persists an idempotent per-user note cursor and enqueues missing/stale notes. At startup, the singleton scanner pages through records from existing `backend/models/User.ts` and resumes each unfinished `UserNoteTopicBackfill` record; it does not run as a side effect of a profile GET.
- `startUserNoteTopicRuntime(): void` starts one bounded poll loop with a process-wide semaphore of 2, a persistent per-user lease (1 active note per user across replicas), persisted note claims, and automatic retry delays/caps from Task 2. An expired lease is recoverable; stop/cleanup is exposed for deterministic tests.
- Note create/update and successful async metadata writes call `scheduleUserNoteTopicIndex` for only that note. Deletes remove that note’s topic state.

- [ ] **Step 1: Write failing tests** named `backfill resumes after persisted cursor and can repeat safely`, `runtime reclaims an expired processing lease`, `two runtime instances cannot claim the same user lease`, `runtime never exceeds two concurrent calls per process`, `create and topic-relevant update schedule one-note index`, `delete removes index`, and `successful metadata write queues index with same user revision`.
- [ ] **Step 2: Run** `cd backend && npx tsx --test tests/userNoteTopicBackfill.test.ts tests/userNoteTopicRuntime.test.ts tests/userNoteTopicWorkerLease.test.ts tests/noteWriteModule.test.ts tests/noteEnrichmentWorker.test.ts tests/noteService.test.ts`. Expected: FAIL for missing integration and recovery.
- [ ] **Step 3: Implement persistent cursor/upsert recovery**, a bounded consumer loop, and one-note scheduling. Mark abandoned `processing` claims recoverable after a bounded lease; start the singleton scanner/consumer from successful database startup, not from an HTTP request.
- [ ] **Step 4: Run** `cd backend && npx tsx --test tests/userNoteTopicBackfill.test.ts tests/userNoteTopicRuntime.test.ts tests/userNoteTopicWorkerLease.test.ts tests/noteWriteModule.test.ts tests/noteEnrichmentWorker.test.ts tests/noteService.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add backend/models/UserNoteTopicBackfill.ts backend/services/userNoteTopicBackfill.ts backend/services/userNoteTopicRuntime.ts backend/services/NoteUpdateOrchestrator.ts backend/services/noteEnrichmentWorker.ts backend/services/noteService.ts backend/index.ts backend/tests/userNoteTopicBackfill.test.ts backend/tests/userNoteTopicRuntime.test.ts backend/tests/userNoteTopicWorkerLease.test.ts backend/tests/noteWriteModule.test.ts backend/tests/noteEnrichmentWorker.test.ts backend/tests/noteService.test.ts && git commit -m "feat: backfill and maintain note topic index"`.

### Task 4: Query scoped topics and expose retry API

**Files:**
- Modify: `backend/services/userNoteTopicIndexService.ts`
- Modify: `backend/controllers/profileController.ts`
- Modify: `backend/routes/profileRoutes.ts`
- Create: `backend/tests/userNoteTopicRoutes.test.ts`

**Interfaces:**
- `getUserTopicIndex(userId: string, scope: TopicScope, now?: Date): Promise<UserTopicIndexDto>` returns the exact spec DTO, including counts/status, current topics, and optional labeled stale snapshot.
- `GET /api/profile/topics?scope=all|year|sixMonths` reads only; `POST /api/profile/topics/retry` accepts `{ scope }` and returns `{ acceptedCount, alreadyRunningCount, rateLimitedCount, nextRetryAt }`. A limited response tells the user when retry becomes available; automatic exhaustion remains manually recoverable after cooldown/window limits and never requires editing an unchanged note.

- [ ] **Step 1: Write failing tests** named `counts distinct ready notes and sorts ties by topic`, `counts missing and stale records as pending`, `returns stale snapshot separately from current topics`, `applies Shanghai bounds across UTC midnight`, `clamps month-end lookback to the last calendar day`, `rejects unknown scope`, `GET topics never returns another user's notes`, `retry route cannot enqueue another user's failed notes`, `retry route reports cooldown and rate-limited counts`, and `retry route never waits for AI`.
- [ ] **Step 2: Run** `cd backend && npx tsx --test tests/userNoteTopicRoutes.test.ts`. Expected: FAIL because topic routes/aggregation are absent.
- [ ] **Step 3: Implement range aggregation** over owned notes and their index records. Enforce `ready + pending + failed = total`; status precedence is `empty`, all-ready, `partial` (some ready or both failed and pending), all-failed, otherwise `building`.
- [ ] **Step 4: Run** `cd backend && npx tsx --test tests/userNoteTopicRoutes.test.ts tests/userNoteTopicIndexWorker.test.ts tests/userNoteTopicBackfill.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add backend/services/userNoteTopicIndexService.ts backend/controllers/profileController.ts backend/routes/profileRoutes.ts backend/tests/userNoteTopicRoutes.test.ts && git commit -m "feat: expose scoped note topics"`.

### Task 5: Add the topic panel and independent UI states

**Files:**
- Create: `frontend/src/services/profileTopicsService.ts`
- Create: `frontend/src/app/profile/ProfileTopicsSection.tsx`
- Create: `frontend/src/app/profile/ProfileTopicsSection.test.tsx`
- Modify: `frontend/src/app/profile/page.tsx`
- Modify: `frontend/src/app/profile/profile.module.scss`
- Modify: `frontend/src/app/profile/page.test.tsx`

**Interfaces:**
- `getProfileTopics(scope: TopicScope): Promise<UserTopicIndexDto>` calls the GET route; `retryFailedProfileTopics(scope): Promise<TopicRetryResponse>` calls POST.
- Plan A provides `profileRoutes`, `profileService`, page statistics/profile state, and a topic-panel insertion point. The section owns only scope selection, topic states, and topic retry; it does not own profile or stats errors.

- [ ] **Step 1: Write failing panel tests** named `defaults to all notes`, `switches scopes without calling retry or AI`, `shows X of Y and current ready topics only`, `shows old snapshot label separately`, `shows empty-range link to all notes`, `keeps cached topics and labels partial failures`, `retries failed notes only`, `shows next retry time for rate-limited notes`, `allows retry after cooldown without editing the note`, `shows a region error when no cache exists`, and `ends loading with an independent error and retry`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/app/profile/ProfileTopicsSection.test.tsx src/app/profile/page.test.tsx`. Expected: FAIL because component/service are absent.
- [ ] **Step 3: Implement the section** using the exact response state; display note counts, never interest percentages. Ensure range changes invoke GET only; preserve successful cached results while refreshing; stale snapshots are visibly labeled and excluded from `X/Y`.
- [ ] **Step 4: Run** `cd frontend && npx vitest run src/app/profile/ProfileTopicsSection.test.tsx src/app/profile/page.test.tsx && npm run typecheck`; `cd backend && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add frontend/src/services/profileTopicsService.ts frontend/src/app/profile/ProfileTopicsSection.tsx frontend/src/app/profile/ProfileTopicsSection.test.tsx frontend/src/app/profile/page.tsx frontend/src/app/profile/profile.module.scss frontend/src/app/profile/page.test.tsx && git commit -m "feat: show note topics on profile"`.

## Spec Coverage Self-Review

- Per-note inputs, fingerprint+revision freshness, bounded DeepSeek and stale CAS: Tasks 1–2.
- New/update/delete scheduling, async metadata changes, recoverable backfill: Task 3.
- Scopes, Shanghai date boundaries, count uniqueness, status/coverage sums, stale snapshots, failed-only retry: Task 4.
- Default all scope, zero/empty states, `X/Y`, cached partial data, isolated errors/retry, and no model call on range changes: Task 5.
- The profile API path/controller are produced by Plan A; Plan B adds only topic routes to that router. Execute A before B. Plan C runs after B and owns avatar-only account-modal changes.
