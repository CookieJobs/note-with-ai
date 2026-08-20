# Note Phase 1 Acceptance Remediation Implementation Plan

> **For agentic workers:** Use TDD for every behavior change; this remediation executes inline because the user explicitly requested immediate implementation in the shared worktree.

**Goal:** Close the first-round acceptance gaps without extending the Phase 1 architecture.

**Architecture:** Keep `NoteUpdateOrchestrator` as the direct Mongoose core writer, retain only the scheduler as a behavioral seam, and route existing maintenance operations through the same revision-guarded artifact write rules. Preserve legacy HTTP adapters and maintenance routes.

**Tech Stack:** TypeScript, Express, Mongoose, node:test, Vitest, React Query.

**Spec:** `docs/superpowers/specs/2026-08-18-note-architecture-hardening-phase-1-design.md`

## Global Constraints

- Do not modify Auth, Chat, Profile, `architecture-visual`, or other user dirty work.
- No queue, repository/DAO interface, event bus, new public repair API, force exit, or ignored type errors.
- Write each regression test first, observe its intended failure, then make the smallest production change.
- All derived writes must use `{ _id, userId, revision }` and `{ timestamps: false }`.

### Task 1: Keyword conflict recovery

**Files:** `frontend/src/app/notes/hooks/useNoteEditor.ts`, `frontend/src/app/notes/hooks/useNoteEditor.test.tsx`, `frontend/src/app/notes/components/ModernNoteCard.tsx`

- [x] Add failing 409 keyword-delete test asserting no local update callback, a visible stable conflict error, and a retryable keyword edit state.
- [x] Make keyword PATCH branches gate on `response.ok`; only invoke `onUpdateKeywords` on canonical success.
- [x] Preserve/reopen the affected keyword editor on 409 and retain a stable conflict message; leave other failures non-successful.
- [x] Re-run the focused Vitest test.

### Task 2: Revision-first recommendation freshness

**Files:** `frontend/src/app/notes/utils/recommendCache.ts`, new `recommendCache.test.ts`

- [x] Add failing tests for matching `sourceRevision` with differing timestamps, and for old timestamp-only cache fallback.
- [x] Make cache state prefer revision equality when `sourceRevision` exists; otherwise use the legacy timestamp rule.
- [x] Pass the note revision into locally built explicit-refresh caches and include it in the cache result.
- [x] Re-run the focused Vitest test.

### Task 3: Close maintenance artifact recovery

**Files:** `backend/services/noteEnrichmentWorker.ts`, `backend/services/noteService.ts`, `backend/services/recommendService.ts`, tests for worker/service/recommendation behavior

- [x] Add failing recovery tests for meta and recommendation artifact writes after a degraded pending state, plus database `.limit(limit)`/actual processed count.
- [x] Expose only internal worker artifact helpers; reuse revision CAS + `timestamps:false` for maintenance completions and failures.
- [x] Make summary maintenance generate summary and concepts together, write them atomically, and mark meta ready/failed without touching core timestamps.
- [x] Make explicit recommendation refresh mark recommendations ready/failed for its captured revision.
- [x] Re-run focused backend tests.

### Task 4: Remove the Mongoose storage seam and configure stale time/backfill

**Files:** `backend/services/NoteUpdateOrchestrator.ts`, `backend/tests/noteWriteModule.test.ts`, `backend/package.json`, `backend/services/README.md`

- [x] Add a failing stale-boundary test using an environment override.
- [x] Replace `NoteWriteModel` constructor injection with direct `Note` static calls; migrate module tests to static Mongoose mocks.
- [x] Read `NOTE_ENRICHMENT_STALE_MS` with a five-minute default and enforce the boundary in the aggregate view.
- [x] Add the explicit revision-backfill script and deployment prerequisite documentation.
- [x] Run focused backend tests and then the full required verification.
