# Note Architecture Hardening Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each normal Note create or save one canonical Note write, whose backend owner normalizes content, atomically applies the write, and best-effort schedules derived artifacts.

**Architecture:** Deepen the existing `NoteUpdateOrchestrator` into the Note write module; it owns only `create` and `update`. Express remains an HTTP adapter, Mongo/Mongoose stays the sole persistence mechanism, and an in-process scheduler owns asynchronous meta, embedding, and recommendation work with revision freshness checks.

**Tech Stack:** TypeScript, Express, Mongoose, Node test runner, Next.js, React Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-note-architecture-hardening-phase-1-design.md`

## Global Constraints

- Preserve all existing user changes; inspect every overlapping diff before editing it.
- No queue, microservice, repository interface, generic event bus, global DTO migration, Chat-session work, or `recommendService` split.
- Schema changes are additive. Keep legacy Note fields and maintenance routes; no irreversible data conversion.
- Production code follows red-green-refactor: every behavior begins with a failing characterization or contract test.
- Normal frontend create and save flows each make one Note HTTP write and never orchestrate enrichment requests.
- Verification must naturally exit; never use forced exit, `ignoreBuildErrors`, broad `any`, `@ts-ignore`, or deletion of failing tests.

---

### Task 0: Protect the current worktree and establish engineering scripts

**Files:**
- Modify: `package.json`, `backend/package.json`, `frontend/package.json`, `frontend/next.config.js`, `backend/utils/embedding.ts`
- Test: existing backend test command and `npm --prefix frontend run build`

- [ ] Record `git status`, all current diffs for overlapping files, current branch, and test baseline.
- [ ] Add root `typecheck`, `test`, and `verify`; add backend/frontend `typecheck` and `test` scripts without replacing existing scripts.
- [ ] Replace the module-level embedding cleanup interval with a non-blocking lifecycle-safe handle.
- [ ] Remove `typescript.ignoreBuildErrors`; fix the actual compiler errors it reveals.
- [ ] Run `npm run verify` and isolate any unrelated baseline failures with command output.

### Task 1: Characterize Note input, normalization, and HTTP behavior

**Files:**
- Create: `backend/services/noteContentNormalizer.ts`, `backend/tests/noteWriteModule.test.ts`, `backend/tests/noteHttpContract.test.ts`
- Modify: `backend/schemas/noteSchemas.ts`
- Test: `backend/tests/noteWriteModule.test.ts`, `backend/tests/noteHttpContract.test.ts`

**Interfaces:**
- Produces `normalizePlainText(value: string): string` and `normalizeRichTextDocument(document): { contentText: string }`.
- Invalid rich-text throws `NOTE_BODY_INVALID`; empty normalized body throws `NOTE_BODY_EMPTY`.

- [ ] Write tests for CRLF normalization, blocks, hard breaks, image placeholder, malformed document, empty body, and legacy content fallback.
- [ ] Run those tests and observe missing-module/contract failures.
- [ ] Implement the pure normalizer and request schema validation minimally.
- [ ] Re-run the focused tests and preserve the existing HTTP request shape until Task 4.

### Task 2: Add atomic Note writes and compatibility-safe projections

**Files:**
- Modify: `backend/types/index.ts`, `backend/models/Note.ts`, `backend/services/NoteUpdateOrchestrator.ts`, `backend/services/noteService.ts`
- Create: `backend/services/noteDto.ts`, `backend/scripts/backfill_note_revisions.ts`
- Test: `backend/tests/noteWriteModule.test.ts`

**Interfaces:**
- `NoteUpdateOrchestrator.create({ userId, body })` and `.update({ userId, noteId, expectedRevision, changes })` return `{ note, enrichment }`.
- `NoteDto` has `_id`, user-visible Note fields, ISO dates, `revision`, and no embedding/internal metadata.

- [ ] Write failing create, no-op, not-found, conflict snapshot, and concurrent-CAS tests against the two public methods.
- [ ] Implement additive `revision` and `enrichment` schema fields plus an idempotent external backfill script.
- [ ] Implement atomic `findOneAndUpdate({ _id, userId, revision })` for actual user changes; validate revision before no-op detection.
- [ ] Map legacy HTTP `updatedAt` only in the adapter; keep the module’s public update input revision-only.
- [ ] Add legacy projection fallback (`contentText || content`) without GET-side writes.

### Task 3: Move enrichment invalidation and freshness into the Note module

**Files:**
- Modify: `backend/services/NoteUpdateOrchestrator.ts`, `backend/services/noteEmbeddingService.ts`, `backend/services/noteService.ts`, `backend/services/recommendService.ts`
- Create: `backend/services/noteEnrichmentScheduler.ts`
- Test: `backend/tests/noteWriteModule.test.ts`, `backend/tests/noteEmbeddingService.test.ts`

**Interfaces:**
- Scheduler receives `{ noteId, userId, sourceRevision, invalidatedArtifacts }`; production scheduling is in-process and tests use a collecting/inline fake.
- Artifact writes match `{ _id, userId, revision: sourceRevision }` and use `{ timestamps: false }`.

- [ ] Write failing tests for the dependency matrix, duplicate scheduling protection, stale result dropping, unchanged `revision`/`updatedAt`, and degraded artifacts after an external failure.
- [ ] Implement atomic invalidation state changes with the core write.
- [ ] Schedule meta and embedding after persistence; run recommendation after meta settles; record stable failed status without rolling back the user write.
- [ ] Convert Note embedding/recommendation/meta write guards from `updatedAt` to `revision` while retaining maintenance adapters.

### Task 4: Adapt the Note HTTP contract and migrate normal frontend flows

**Files:**
- Modify: `backend/controllers/noteController.ts`, `backend/routes/notes.ts`, `backend/schemas/noteSchemas.ts`, `backend/utils/errorHandler.ts`, `frontend/src/types/index.ts`, `frontend/src/app/notes/hooks/useNotes.ts`, `frontend/src/app/notes/hooks/useCreateNote.ts`, `frontend/src/app/notes/hooks/useNoteEditor.ts`, `frontend/src/app/notes/components/ModernNoteCard.tsx`, `frontend/src/app/notes/page.tsx`
- Create: `frontend/src/app/notes/hooks/useCreateNote.test.tsx`, `frontend/src/app/notes/hooks/useNoteEditor.test.tsx`
- Test: Note HTTP contract tests and both frontend hook tests.

**Interfaces:**
- Success is only `{ success, message, data: { note, enrichment } }`.
- Conflict is `{ success: false, code: 'NOTE_WRITE_CONFLICT', message, current: { note, enrichment } }`.

- [ ] Write frontend request-count tests that fail because create/save still call embed, summary, or semantic recommendation APIs.
- [ ] Make POST/PATCH accept canonical bodies; map legacy DTOs only at the controller/schema boundary; retain POST title and maintenance routes as adapters.
- [ ] Change creation to one POST and canonical `data.note` parsing; remove post-create enrichment orchestration.
- [ ] Change body/title/keyword saving to PATCH with `expectedRevision`; remove threshold, embed, and save-triggered recommendation logic.
- [ ] Preserve conflict draft and expose server current data instead of overwriting editor state.
- [ ] Restrict pending polling to five unified Notes refetches in sixty seconds, with focus/visibility stop conditions.

### Task 5: Finish the limited LLM/document cleanup

**Files:**
- Modify: `backend/services/noteService.ts`, `backend/services/llmService.ts`, `backend/services/README.md`
- Test: focused backend tests plus `rg` caller evidence.

- [ ] Use `rg` to prove the deprecated empty `llmService.generateEmbedding` has no callers.
- [ ] Write/adjust a contract test proving Note chat uses the existing LLM seam.
- [ ] Replace direct `DeepSeekApiClient` construction in the Note path with `llmService`, delete the unused empty export, and correct the README’s stale file reference.
- [ ] Do not restructure Chat or recommendations.

### Task 6: Verification and scope audit

**Files:**
- Review: all files in `git diff` created by these tasks.

- [ ] Run focused NoteWrite, HTTP-contract, concurrency/freshness, and frontend request-count tests.
- [ ] Run `npm run verify` and `npm --prefix frontend run build` from a fresh shell.
- [ ] Re-read the Spec acceptance checklist against the final diff; record compatibility layers, removal conditions, limitations, and deviations.
- [ ] Confirm the final diff contains no changes to pre-existing user changes outside the Note/verification overlap.
