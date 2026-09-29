# Profile Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/profile` daily feed with account/profile content, two independent note statistics, and explicit, honest legacy-profile state.

**Architecture:** Move profile reads and explicit analysis triggers into an authenticated profile API; keep note statistics as an independent request. The page removes feed rendering and presents independent loading/error/retry behavior for stats and legacy profile while leaving a dedicated slot for the topic panel delivered by Plan B.

**Tech Stack:** Next.js/React, TypeScript, Express, Mongoose, Vitest, Node.js `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-29-profile-rework-design.md`

## Global Constraints

- `/profile` displays only total notes and this month’s new notes as statistics.
- The product calendar timezone is `Asia/Shanghai`.
- Legacy profile generation is explicit; GET never triggers it.
- Fewer than 5 notes returns `insufficient_data` and does not update `lastAnalyzedAt`.
- Only a successfully generated and committed profile result may update `lastAnalyzedAt`.
- Existing profile data with fewer than 5 current notes is historical only, never shown as a current inference.
- Remove profile daily recommendation generation and UI; preserve note-level semantic recommendations and their enrichment.
- Each profile subsection loads, fails, and retries independently; do not show raw technical errors.

## Review Focus

- A profile GET with 0–4 notes must be read-only and must not create an analysis job.
- Existing skills/biography after deletion to 1–4 notes must not appear current.
- An analysis that started with 5+ notes but finishes after deletion below 5 must not commit a current profile.
- `insufficient_data`, queueing, failure, and stale completion must not advance `lastAnalyzedAt`.
- Stats failure must end its skeleton without hiding profile or topic content.
- Removing the `/api/feed` mount must leave `/api/recommend/semantic-notes` intact.

---

### Task 1: Reduce the profile statistics contract

**Files:**
- Modify: `backend/services/userStatsService.ts`
- Test: `backend/tests/userStatsService.test.ts`
- Modify: `frontend/src/services/feedService.ts`

**Interfaces:**
- Produces `UserStatsDto = { totalNotes: number; notesThisMonth: number }` for the profile and a client `UserStats` with those same two fields.
- `GET /api/user/stats` remains the statistics endpoint; monthly boundaries are Shanghai calendar month start inclusive and next month start exclusive.

- [ ] **Step 1: Write failing service tests** named `returns only total and Shanghai-month note counts` and `uses Shanghai boundaries independent of host timezone`; assert the DTO has exactly the two contract fields and aggregation boundaries use the documented month.
- [ ] **Step 2: Run the focused backend test**: `cd backend && npx tsx --test tests/userStatsService.test.ts`. Expected: FAIL because extra metrics/timezone behavior remain.
- [ ] **Step 3: Implement the two-field service/client contract** in the files above; remove profile-only queries for `UserProfile.interests` and host-local month calculations. Keep existing feed exports temporarily; Task 3 removes them after the page switches to profile-specific calls.
- [ ] **Step 4: Run focused tests**: `cd backend && npx tsx --test tests/userStatsService.test.ts`; `cd frontend && npx vitest run src/app/profile/page.test.tsx`. Expected: PASS after updating fixtures to the two-field DTO.
- [ ] **Step 5: Commit** `git add backend/services/userStatsService.ts backend/tests/userStatsService.test.ts frontend/src/services/feedService.ts && git commit -m "feat: simplify profile statistics contract"`.

### Task 2: Add explicit legacy-profile read and generation endpoints

**Files:**
- Create: `backend/controllers/profileController.ts`
- Create: `backend/routes/profileRoutes.ts`
- Modify: `backend/index.ts`
- Modify: `backend/models/UserProfile.ts`
- Modify: `backend/services/profileAnalysisCoordinator.ts`
- Modify: `backend/services/userAnalysisService.ts`
- Create: `backend/tests/profileRoutes.test.ts`
- Test: `backend/tests/userAnalysisService.test.ts`

**Interfaces:**
- `GET /api/profile/analysis` returns `{ userProfile, historicalProfile, profileStatus, noteCount, analysisError, lastAnalyzedAt, analysisInputNoteCount, analysisInputScope }`. With fewer than 5 notes, `userProfile=null` and any prior result is returned only as `historicalProfile`; at 5+ notes, `historicalProfile=null`. `profileStatus` is `idle | analyzing | ready | failed | insufficient_data`; missing metadata on historical records is `null` and treated as unknown.
- `POST /api/profile/analysis` returns `{ accepted, profileStatus, reason, analysisError }`; under 5 notes it returns `accepted:false`, `reason:'insufficient_data'`, and does not queue work or change timestamps.
- Successful analysis stores the actual note count/scope with the result; legacy runs still use at most 20 notes.

- [ ] **Step 1: Write failing route/service tests** named `profile GET is read-only and returns legacy fields and scope`, `profile POST rejects fewer than five notes without enqueue or timestamp write`, `analysis does not commit if note count falls below five before writeback`, and `successful profile commit records actual input count and scope`. Verify existing cached skills/summary survive failed refreshes; add route registration coverage that `/api/feed` is not mounted.
- [ ] **Step 2: Run focused backend tests**: `cd backend && npx tsx --test tests/profileRoutes.test.ts tests/userAnalysisService.test.ts`. Expected: FAIL for missing endpoints and current insufficient-data timestamp write.
- [ ] **Step 3: Implement `GET/POST /api/profile/analysis`** and mount `profileRoutes` at `/api/profile`. Remove the coordinator's `source:'auto'` path so every analysis request is explicit; reject insufficient data before queueing and recheck note count before result commit. Remove the no-profile-update path’s `lastAnalyzedAt` write; persist input count/scope only with successful generated results. Preserve `analysisVersion` stale-result protection.
- [ ] **Step 4: Run focused tests**: `cd backend && npx tsx --test tests/profileRoutes.test.ts tests/userAnalysisService.test.ts`; `cd backend && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add backend/controllers/profileController.ts backend/routes/profileRoutes.ts backend/index.ts backend/models/UserProfile.ts backend/services/profileAnalysisCoordinator.ts backend/services/userAnalysisService.ts backend/tests/profileRoutes.test.ts backend/tests/userAnalysisService.test.ts && git commit -m "feat: expose explicit profile analysis API"`.

### Task 3: Remove profile feed and build independent core sections

**Files:**
- Modify: `frontend/src/app/profile/page.tsx`
- Modify: `frontend/src/app/profile/profile.module.scss`
- Modify: `frontend/src/app/profile/page.test.tsx`
- Create: `frontend/src/services/profileService.ts`
- Delete: `frontend/src/services/feedService.ts`
- Delete: `backend/controllers/feedController.ts`
- Delete: `backend/routes/feedRoutes.ts`
- Modify: `backend/index.ts`

**Interfaces:**
- Frontend exports `getProfileAnalysis(): Promise<ProfileAnalysisResponse>`, `triggerProfileAnalysis(): Promise<ProfileAnalysisTriggerResponse>`, and `getStats(): Promise<UserStats>`; each calls only its own endpoint.
- `ProfileAnalysisResponse` is `{ userProfile: LegacyProfileDto | null; historicalProfile: LegacyProfileDto | null; profileStatus: 'idle' | 'analyzing' | 'ready' | 'failed' | 'insufficient_data'; noteCount: number; analysisError: string; lastAnalyzedAt: string | null; analysisInputNoteCount: number | null; analysisInputScope: 'recent_up_to_20' | 'unknown' | null }`.
- Page data uses `profileStatus`, `noteCount`, the legacy profile DTO, and profile input metadata. The topic-panel insertion point is reserved for Plan B; no feed DTO or request remains.

- [ ] **Step 1: Write failing page tests** named `does not request or render daily recommendations`, `loads stats and profile independently`, `ends stats skeleton and retries only stats on failure`, `shows generate action for missing profile with five or more notes`, `shows insufficient-data explanation below five notes`, `shows cached inferences only as historical when note count falls below five`, `keeps cached legacy profile visible with retry after analysis failure`, `edit-profile modal still saves username and preserves read-only email`, and `change-password modal still opens and submits valid credentials`.
- [ ] **Step 2: Run focused frontend tests**: `cd frontend && npx vitest run src/app/profile/page.test.tsx`. Expected: FAIL on feed rendering/request and coupled states.
- [ ] **Step 3: Implement the page/service changes**; remove the `/api/feed` route mount and recommendation-building controller; keep `/api/recommend` unchanged. GET profile remains read-only; explicit POST labels are “生成画像” / “重新分析”; under 5 notes render only `historicalProfile` inside a clearly labeled historical snapshot with the insufficient-data explanation, never as current `userProfile`.
- [ ] **Step 4: Run verification**: `cd frontend && npx vitest run src/app/profile/page.test.tsx && npm run typecheck`; `cd backend && npx tsx --test tests/profileRoutes.test.ts tests/userAnalysisService.test.ts tests/recommendAndPerformanceRoutes.test.ts && npm run typecheck`. Expected: PASS, no `/api/feed` usage or mount, note recommendation tests still pass.
- [ ] **Step 5: Commit** `git add frontend/src/app/profile/page.tsx frontend/src/app/profile/profile.module.scss frontend/src/app/profile/page.test.tsx frontend/src/services/profileService.ts frontend/src/services/feedService.ts backend/controllers/feedController.ts backend/routes/feedRoutes.ts backend/index.ts && git commit -m "feat: remove profile daily feed"`.

## Spec Coverage Self-Review

- Profile layout, two metrics, independent errors/retries, and feed removal: Task 3; stats contract/timezone: Task 1.
- Profile GET/POST semantics, <5-note refusal, cached historical profile, analysis input range, and timestamp rule: Task 2 plus Tasks 3 tests.
- Topic interface insertion is deliberately delivered by Plan B; account/avatar editing remains for Plan C.
- Legacy `/api/feed` calls are intentionally unsupported after same-release frontend/backend deployment; note-level recommendations are verified unchanged.
- Execution order is A → B → C; do not run these plans concurrently because B extends A’s route/page contracts and C edits A/B’s shared profile page.
