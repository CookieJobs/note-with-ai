# Core Experience Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Spec 1's capture → relationship → source review → continuation/chat loop with revision-safe, private, human-readable relationship evidence.

**Architecture:** Keep the existing vector recall and diagnostic cache as internal plumbing, then project eligible candidates into a new `NoteRelationship` contract containing verified excerpts and natural-language explanation. Persist account-scoped feedback separately, filter hidden pairs before response, and expose one relationship-oriented frontend model consumed by notes and relationship-context chat. Quick capture owns a user-scoped local draft and delegates canonical writes to `useNotes`.

**Tech Stack:** Next.js/React/TypeScript, Vitest + Testing Library, Express, Mongoose, Node test runner, existing DeepSeek client, existing revision-CAS enrichment worker.

**Spec:** `docs/superpowers/specs/2026-09-01-core-experience-loop-design.md`

## Global Constraints

- Do not expose `s1`, `s2`, combined scores, or numeric confidence to ordinary users.
- Relationship evidence must be verified against the exact source/candidate revisions before display.
- All relationship and feedback reads/writes derive `userId` from the authenticated request.
- Keep hidden-pair filtering account-scoped, idempotent, and order-normalized.
- Preserve the existing Note write/revision contract; enrichment must not block capture or mutate Note revision.
- Modify only Spec 1 ownership files; do not touch Spec 2 modules, `backend/index.ts`, `TopNavigation`, search/feed, profile, or publication/inspiration paths.
- Do not log full note bodies, prompts, or evidence excerpts.
- Every behavior change starts with a failing automated test and ends with fresh verification.

### Task 1: Relationship domain contracts and verified explanation service

**Files:**
- Create: `backend/models/NoteRelationship.ts`
- Create: `backend/models/RelationshipFeedback.ts`
- Create: `backend/services/relationshipService.ts`
- Create: `backend/tests/relationshipService.test.ts`
- Modify: `backend/services/recommendService.ts`

**Interfaces:**
- `RelationshipKind`, `ConfidenceBand`, `NoteEvidence`, `NoteRelationship` are defined in the service-local domain module and exported for route/frontend adapters.
- `buildVerifiedRelationship(source, candidate, rerank)` returns `NoteRelationship | null` and rejects missing, stale, or non-substring evidence.
- `normalizePair(noteA, noteB)` returns a stable ordered pair for feedback filtering.
- `submitRelationshipFeedback(input)` upserts `(userId, relationshipId)` and returns the selected verdict.

- [x] Write tests for exact-revision evidence validation, natural-language kind mapping, stable pair ordering, idempotent feedback, and hidden-pair filtering.
- [x] Run `npm --prefix backend exec tsx --test tests/relationshipService.test.ts` and confirm the new tests fail for missing contracts.
- [x] Implement the models/service with unique `(userId, relationshipId)` feedback index and no body-bearing logs.
- [x] Run the focused tests and refactor only after green.

### Task 2: Revision-safe recommendation projection and feedback routes

**Files:**
- Modify: `backend/services/recommendService.ts`
- Modify: `backend/services/noteEnrichmentWorker.ts`
- Modify: `backend/services/NoteUpdateOrchestrator.ts`
- Modify: `backend/routes/recommend.ts`
- Modify: `backend/tests/recommendService.test.ts`
- Modify: `backend/tests/recommendAndPerformanceRoutes.test.ts`

**Interfaces:**
- `updateNoteRecommendations` returns `{ sourceNoteId, sourceRevision, status, relationships, generatedAt, meta }` while retaining internal cache/diagnostic fields only server-side.
- `POST /api/recommend/relationships/:relationshipId/feedback` accepts note IDs, both revisions, and `helpful | not_relevant | hide_pair`.

- [x] Add failing tests for verified two-sided excerpts, stale candidate revision rejection, insufficient-history/enriching/failed statuses, ownership checks, and all three feedback verdicts.
- [x] Implement the projection after recall/rerank, fetch exact current revisions, generate concise explanation through the existing LLM client, validate evidence, and discard invalid results.
- [x] Filter deleted/hidden/previously processed pairs, cap three relationships per source, persist cache bound to source/candidate revisions, and preserve stale CAS behavior.
- [x] Add structured event logging with IDs/timings/error codes only and route-level auth/validation.
- [x] Run backend focused tests, then existing backend tests with test-only environment variables.

### Task 3: Capture draft persistence, status expression, and cold-start experience

**Files:**
- Create: `frontend/src/app/notes/hooks/useQuickCaptureDraft.ts`
- Create: `frontend/src/app/notes/hooks/useQuickCaptureDraft.test.ts`
- Modify: `frontend/src/app/notes/components/FloatingQuickCompose.tsx`
- Modify: `frontend/src/app/notes/page.tsx`
- Modify: `frontend/src/app/notes/hooks/useCreateNote.ts`
- Modify: `frontend/src/app/notes/styles/floating-compose.module.scss`
- Modify: `frontend/src/types/index.ts`

**Interfaces:**
- Draft storage key is `quick-capture-draft:<userId>` and stores text, optional title, editor mode, updated timestamp, and optional relationship context.
- `useQuickCaptureDraft(userId)` exposes `draft`, `saveDraft`, `clearDraft`, `restoreDraft`, and `storageAvailable`.

- [x] Add failing tests for throttled draft writes, restore after remount, clear only after canonical save, failed save retention, explicit discard confirmation, and relationship context not entering body text.
- [x] Implement the hook and wire capture open/close/submit to it; default copy becomes `记下这一刻`, default UI is plain capture with progressive “更多格式”.
- [x] Separate saving/saved/failed/enriching labels, preserve content on network failure, restore focus/return focus, and expose keyboard shortcut and 44px controls.
- [x] Add empty/one-note/no-relationship/relationship-ready copy without progress counts or numeric scores.
- [x] Run focused frontend tests and typecheck.

### Task 4: Relationship card, source review, feedback, continue-writing, and chat entry

**Files:**
- Create: `frontend/src/app/notes/components/RelationshipCard.tsx`
- Create: `frontend/src/app/notes/components/RelationshipCard.test.tsx`
- Modify: `frontend/src/app/notes/components/RelatedNotesDrawer.tsx`
- Modify: `frontend/src/app/notes/components/ModernNoteCard.tsx`
- Modify: `frontend/src/app/notes/page.tsx`
- Modify: `frontend/src/app/notes/utils/recommendCache.ts`
- Modify: `frontend/src/types/index.ts`

**Interfaces:**
- Relationship cards consume `NoteRelationship` only; no `s1`, `s2`, `score`, or algorithm labels are accepted by the UI component.
- Actions are `onOpenSource`, `onFeedback`, `onContinueWriting`, and `onStartChat`.

- [x] Add failing component tests for two attributed excerpts, dates, natural-language explanation, accessible feedback buttons, selected-state persistence, source opening, and action callbacks.
- [x] Implement card/drawer with inline feedback, “看看原文”, “继续写”, “和 AI 聊聊”, “为什么会看到这个？”, reduced-motion-safe transitions, narrow layout, and keyboard semantics.
- [x] Replace legacy cache rendering with relationship responses and safe legacy-empty fallback; ensure stale revision never renders.
- [x] Run component tests, lint, and focused keyboard-oriented DOM assertions.

### Task 5: Relationship context in chat and end-to-end regression contracts

**Files:**
- Modify: `frontend/src/app/chat/page.tsx`
- Modify: `frontend/src/components/ChatRelatedNotesPanel.tsx`
- Modify: `frontend/src/types/index.ts`
- Create/modify: `frontend/src/app/chat/page.test.tsx`
- Modify: `backend/routes/recommend.ts` (relationship context read adapter within recommend route domain)
- Create: `backend/tests/relationshipContextRoute.test.ts`

**Interfaces:**
- Chat entry uses `/chat?source=relationship&relationshipId=<id>` and loads a private relationship context before rendering note cards.
- Context response contains only authorized note IDs, titles, dates, and source excerpts; user can remove either note and no message is auto-sent.

- [x] Add failing tests for valid context, foreign relationship rejection, deleted/stale relationship rejection, removable note chips, and no automatic send.
- [x] Implement the authenticated context read and chat-page loading state using the existing chat session flow without changing behavior when parameters are absent.
- [x] Update chat related-note UI to show evidence/context rather than scores and preserve accessible navigation.
- [x] Run focused frontend/backend tests and the complete suite.

### Task 6: Verification, acceptance audit, and branch handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-09-01-core-experience-loop-implementation.md`

- [x] Run backend tests, frontend tests, root `npm test`, `npm run typecheck`, frontend lint, `npm run build:all`, and any existing doc checks; record unavailable commands explicitly.
- [x] Execute narrow-screen checks at mobile viewport sizes and keyboard-only flow checks; record any manual-only items.
- [x] Re-read Spec §14 and mark all twelve acceptance criteria with evidence or a concrete residual risk.
- [x] Inspect `git diff`, ownership boundaries, and logs for forbidden files/fields; preserve unrelated user changes.
- [x] Commit the implementation and plan on `codex/core-experience-loop`, then report the commit hash, evidence, residual risks, and post-merge seams without merging.

## Verification record

- Automated: backend `npm test` 69/69, frontend `npm test` 80/80, root `npm test` green; backend/frontend typechecks green; frontend lint green; `npm run build:all` green.
- Focused: relationship service 7/7, recommendation/route contracts 5/5, new frontend relationship/draft tests 3/3.
- Manual-only: narrow viewport and keyboard-only interaction review were implemented by inspection (44px controls, Escape close, reduced-motion transition, removable context); no browser automation is configured in this worktree.
- Residual risk: relationship generation depends on the configured LLM provider and degrades to an empty relationship list when the provider is unavailable; legacy numeric recommendation data remains internal compatibility plumbing only.
- Scope audit: no changes to profile, inspiration/publication, search/feed, `TopNavigation`, `backend/index.ts`, `User`, or `UserProfile`; relationship types remain local to `frontend/src/app/notes/types/relationships.ts`.
