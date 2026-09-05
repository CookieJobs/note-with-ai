# Trusted Memory, Sharing & Inspiration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build user-governed AI memory, revocable single-note public snapshots, and source-grounded external inspiration without creating a social feed.

**Architecture:** New owner-scoped Mongo models back isolated service/controller/route modules. Publications render only sanitized snapshots by high-entropy slugs. Inspiration uses a credentialed provider adapter with strict URL validation, snippet-only evidence, and durable opt-in jobs.

**Tech Stack:** Express, Mongoose, Zod, Node test runner, Next.js, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-trusted-memory-sharing-inspiration-design.md`

## Global Constraints

- All private data is scoped by the authenticated user; public output contains no owner or source-note identifiers.
- Do not modify the Note, chat, relationship, recommendation, or global types prohibited by Spec section 14.
- No mock or fabricated provider results; missing configuration returns `SEARCH_PROVIDER_UNAVAILABLE`.
- Public responses use a sanitized snapshot, `Cache-Control: no-store`, and `noindex, nofollow`.
- Search never sends full notes or direct identifiers to a provider.

---

### Task 1: Persistence and security primitives

**Files:**
- Create: `backend/models/MemoryInsight.ts`, `MemorySuppression.ts`, `NoteAiPreference.ts`, `PublishedNote.ts`, `InspirationItem.ts`, `InspirationSettings.ts`, `InspirationJob.ts`
- Create: `backend/services/publicSnapshot.ts`, `backend/services/searchValidation.ts`
- Test: `backend/tests/trustedDomainModels.test.ts`, `publicSnapshot.test.ts`, `searchValidation.test.ts`

**Interfaces:** `sanitizeNoteSnapshot(note)` returns a safe ProseMirror document; `isSafeExternalUrl(url)` validates public HTTP(S) provider sources.

- [ ] Write tests for schema indexes, unsafe rich-text stripping, and private/unsafe URLs.
- [ ] Run each test and observe a missing-module failure.
- [ ] Implement models and pure helpers.
- [ ] Run the focused tests and `npm --prefix backend run typecheck`.

### Task 2: Memory governance APIs

**Files:**
- Create: `backend/services/memoryInsightService.ts`, `backend/controllers/memoryInsightController.ts`, `backend/routes/memoryInsights.ts`, `backend/routes/noteAiPreferences.ts`, `backend/schemas/memorySchemas.ts`
- Modify: `backend/index.ts`, `backend/models/ProductEvent.ts`, `backend/services/productEventService.ts`
- Test: `backend/tests/memoryInsightService.test.ts`, `backend/tests/memoryHttpContract.test.ts`

**Interfaces:** private memory list/confirm/correct/delete and note-AI-preference GET/PUT contracts; deletion creates a minimum fingerprint suppression.

- [ ] Test owner isolation, evidence validity, correction precedence, deletion suppression, and preference updates.
- [ ] Observe failure, then implement owner-scoped Zod-validated routes and content-free events.
- [ ] Verify focused backend tests.

### Task 3: Publication snapshots

**Files:**
- Create: `backend/services/publicationService.ts`, `backend/controllers/publicationController.ts`, `backend/routes/publications.ts`, `backend/schemas/publicationSchemas.ts`
- Modify: `backend/index.ts`
- Test: `backend/tests/publicationService.test.ts`, `backend/tests/publicationHttpContract.test.ts`

**Interfaces:** private create/list/update/revoke APIs and a public active-slug GET that returns only snapshot fields.

- [ ] Test snapshot isolation, refresh revision, randomized replacement slugs, 404 on revoke, and public DTO non-disclosure.
- [ ] Observe failure, implement services/routes, and verify cache/robots headers.

### Task 4: Real provider-backed inspiration

**Files:**
- Modify: `backend/config/index.ts`, `backend/services/search.ts`, `backend/index.ts`, product event files
- Create: `backend/services/inspirationService.ts`, `backend/services/inspirationScheduler.ts`, `backend/controllers/inspirationController.ts`, `backend/routes/inspirations.ts`, `backend/routes/inspirationSettings.ts`, `backend/schemas/inspirationSchemas.ts`
- Test: `backend/tests/searchProvider.test.ts`, `backend/tests/inspirationService.test.ts`, `backend/tests/inspirationHttpContract.test.ts`

**Interfaces:** `SearchProvider.search`, 202 job generation/status endpoints, user-scoped items and settings.

- [ ] Test unavailable provider, malformed/duplicate sources, minimized query input, concurrency, grounded snippets, and owner isolation.
- [ ] Observe failure, implement settings/job persistence and a 24-hour opt-in scheduler cap.
- [ ] Verify focused backend tests.

### Task 5: Private frontend experiences

**Files:**
- Create: private service clients plus `frontend/src/app/memory/**`, `publish/**`, and `inspiration/**`
- Modify: profile and TopNavigation files within the Spec allowlist
- Test: memory, inspiration, and navigation Vitest files

- [ ] Test evidence expansion, correction/deletion dialog accessibility, provider-unavailable and no-result states, bounded job polling, and navigation.
- [ ] Observe failure, implement pages and clients, then run focused frontend tests/typecheck.

### Task 6: Public reader and complete verification

**Files:**
- Create: `frontend/src/app/p/[slug]/page.tsx`, `PublicSnapshot.tsx`, public styles, and tests
- Test: end-to-end domain regression tests

- [ ] Test noindex metadata, no private navigation, safe snapshot render, and generic revoked/not-found state.
- [ ] Observe failure, implement read-only public reader.
- [ ] Run `npm run verify && npm run build:all`, audit the diff against Spec sections 14, 16, and 17, then commit.

