# Optional note titles and tag retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make untitled notes first-class, add explicit title suggestions, and retire tags without changing existing users' original records.

**Architecture:** Keep revision-fenced note writes and enrichment. Separate suggested titles from persistence, share one title/body editing session, and derive reference labels from original text and actual dates. Retain historical retired fields inert; remove all production consumers and runtime entry points.

**Tech Stack:** TypeScript, Express/Zod/Mongoose/MongoDB, Next.js/React/Tiptap, node:test/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-optional-note-titles-no-tags-design.md`

**Status (2026-10-13):** Tasks 1–6 implemented locally and independently reviewed. Full suites passed; later source and legacy-title fixes have scoped regression/type/build evidence. No production deployment. See [validation record](../reviews/2026-10-13-optional-note-titles-no-tags-validation.md) for exact test stages and browser limitations.

## Global Constraints

- New notes default to title=""; no body first-line naming. User write titles are trimmed, single-line, at most 100 Unicode code points; old stored values remain readable.
- Historical title/body/keywords/topic fields remain untouched; new records do not get retired defaults. No production data migration, bulk repair, push or deployment.
- Explicit keywords in canonical or legacy writes return 400/NOTE_TAGS_RETIRED; authenticated legacy topic/recommend routes return 410 without queries or tasks.
- Background meta only generates summary and internal concepts, never title/keywords. Preserve chat titles, profiles, inspiration headlines and semantic recall.
- Title suggestions do not write notes: input <=12,000 code points; output nonempty single-line string title <=60; 30-second server/32-second client deadlines; one provider attempt; per-account 1 in flight, 5/minute, 30/hour; process 2 provider calls. Shared atomic lease with unique owner token.
- Editing and save concurrency follow spec sections 4–5, including monotonic draft versions and stale success/catch/finally protection. Quick draft version 2 preserves title/text/json, account isolation and old formats.
- Reference labels use genuine title, original first text line <=48 code points, or image/date/legacy fallback. Never summary as original text. Open original by noteId even beyond loaded pages.
- Inspiration uses only actual optional title and usable short summary, no keywords or raw-body expansion. Known stale summaries excluded; partially usable context continues, all unusable stops with truthful reason.
- Preserve current uncommitted visual changes. Work on codex/optional-note-titles-no-tags; do not commit pre-existing changes. No child subagents from implementers/reviewers.

## Review Focus

- Null/absent/overlong legacy titles: read and body-only saves retain history; new invalid title writes fail.
- Generation ABA/edit/save/account switches: stale result/error/finally never changes newer draft or request state.
- Save while title/body keep changing: accepted snapshot advances revision, newer draft survives and subsequent save succeeds.
- Untitled image and list-outside references: true source date/type, stable ID and clear missing/forbidden state.
- Pending/failed/stale summaries: inspiration never sends retired data or claims retrieval happened when it did not.

---

### Task 1: Backend optional titles and tag retirement

**Files:** Modify `backend/models/Note.ts`, `backend/services/NoteUpdateOrchestrator.ts`, `backend/services/noteService.ts`, `backend/controllers/noteController.ts`, `backend/schemas/noteSchemas.ts`, `backend/services/llmService.ts`, `backend/services/noteEnrichmentWorker.ts`, `backend/index.ts`, `backend/routes/profileRoutes.ts`, `backend/controllers/profileController.ts`, `backend/routes/recommend.ts`, associated HTTP/write/worker/routes tests. Create a shared title-validation helper if useful.

**Interfaces:** Create input `{userId,body,title?:string}`; update changes only `{body?,title?}`. Normal NoteDto excludes keywords and has title:string. `summarizeNoteMeta(content,userId?)` returns summary only; worker continues concepts independently. Preserve stored legacy schema paths, deletion cleanup and existing semantic endpoints.

- [x] Add failing regression cases for untitled/manual create, empty title, 100/101 astral code points, multiline/type errors, explicit keywords retirement, body-only legacy-title preservation and one-revision combined update.
- [x] Run relevant node:test files and record expected failures.
- [x] Implement title normalization at all boundaries, no derived title/default retired fields, no public keywords, and meta write whitelist. Disconnect all production topic scheduling/startup/old recommendation consumption; use fixed authenticated 410 compatibility responses.
- [x] Test legacy default-origin empty title under meta/ensure/admin retry; verify title-only writes preserve body/embedding and retire routes never query data. Update intentionally changed legacy tests; retain inert stored history tests.
- [x] Run backend typecheck and affected tests; report changed paths and evidence, no commits.

### Task 2: Explicit title suggestion API and shared quota

**Files:** Create `backend/models/NoteTitleQuota.ts`, `backend/services/noteTitleQuotaService.ts`, `backend/services/noteTitleSuggestionService.ts`, `backend/controllers/noteTitleSuggestionController.ts`, focused quota/provider/HTTP tests. Modify `backend/routes/notes.ts`, `backend/models/AiUsageEvent.ts`; adapt shared provider transport only if needed.

**Interfaces:** Authenticated `POST /api/notes/title-suggestions` body `{body:NoteBodyInput,clientRequestId:UUID}` returns `{success:true,data:{title,clientRequestId,sourceFingerprint}}`. Service exports injectable dependencies for tests. Errors and statuses exactly spec 5.3, details.retryAfterSeconds on 429.

- [x] Write failing cases for normalization, image-only 422/mixed-text input, input 12,000/12,001, invalid UUID/body, strict title results 60/61, auth and no Note writes.
- [x] Implement dedicated faithful prompt and single-attempt transport with abort covering body read; add note_title telemetry without content logs.
- [x] Implement shared Mongo atomic sliding quota and owner-token lease, account/user unique index, expired recovery, token-specific release; local process capacity 2 held through transport settlement. Do not call provider when storage/budget unavailable.
- [x] Test timeout/disconnect, failed-call quota accounting, max concurrency and old finally release protection using fake transport; real Mongo concurrent acquisition tests use isolated `note_with_ai_optional_titles_test_20261011` database only.
- [x] Run backend typecheck and affected tests; report paths/evidence, no commits.

### Task 3: Unified title/body drafts and note UI

**Files:** Modify `frontend/src/app/notes/hooks/useCreateNote.ts`, `useNotes.ts`, `useNoteEditor.ts`, `components/FloatingQuickCompose.tsx`, `components/ModernNoteCard.tsx`, `styles/floating-compose.module.scss`, `styles/note-card.module.scss`, `page.tsx`, `frontend/src/types/index.ts`, `frontend/src/components/RelatedNoteCard.tsx`, profile page and topic component/service retirement. Create `frontend/src/services/noteTitleSuggestions.ts` and `frontend/src/hooks/useNoteTitleSuggestion.ts` plus tests.

**Interfaces:** Create command accepts title; update command only body/title. Title hook consumes user/editor identity, current body/title, monotonic versions, open state and callback; supports invalidate, generate, undo and independent idle/generating/failed states. Saved editor uses one expectedRevision and one save snapshot for all dirty fields; existing title/content save wrappers may call the same operation for compatibility.

- [x] Add failing quick draft v1/v2/title-only/storage failure and save-with-newer-edit cases, generation ABA/stale errors/finally/session tests, combined-save/clear/title-only/revision-conflict tests.
- [x] Extend draft persistence to v2; submit title/body snapshots; preserve newer edits and storage failure truth. Normalize generated suggestion into draft only and invalidate on every spec event.
- [x] Unify existing editor title/body draft and baseline; preserve blur/collapse drafts, explicit cancel, conflicts and in-flight later edits. One successful response advances baseline, still-dirty session remains open.
- [x] Add secondary 添加标题 / AI 生成标题, single-line input and undo/retry. Untitled card renders body without placeholder or skeleton. Move editing errors/save/cancel out of deleted tag row. Remove tag UI/types/mutations and profile topic requests/services.
- [x] Preserve user layout/design changes; run frontend typecheck and focused hooks/component/profile tests, report evidence, no commits.

### Task 4: Original-note references and outside-list navigation

**Files:** Create `frontend/src/utils/noteReference.ts` and tests; modify ReferenceNote/ChatMessage/ChatRelatedNotesPanel/CareAssistantPanel/RelatedNotesDrawer, note page and related service/types, `useChatSession.ts`/chat snapshot projection. Modify backend related summaries, chat/recommend/care DTOs and care-source creation with tests.

**Interfaces:** Shared display helper accepts optional title, original contentText/content, image/type and actual source createdAt; returns derived label/date/secondary original line as appropriate. DTO adds bounded original excerpt, image identifier and real date; no retired fields. Source opening uses existing authenticated GET `/api/notes/:id`, by ID, with reading view/current note card container; retain historical snapshot compatibility.

- [x] Add failing label tests for blank titles, 48-code-point original line, summary-only history, invalid dates, same-day images and real Shanghai dates. Add opening tests for IDs outside feed, account changes, removed/forbidden source.
- [x] Supply true empty title and bounded source metadata through affected backend/frontend projections; care links depend on noteId. Mark source date provenance to avoid inventing old care dates.
- [x] Integrate helper in all affected references while preserving IDs and existing navigation/keyboard behavior. Use time/second original line/first thumbnail to distinguish same-day similar records.
- [x] Resolve `highlight` via per-ID fetch when not loaded; show original, explicit unavailable/error state, prevent cross-account stale result. No new global search or classification.
- [x] Run types and focused source/reference/navigation tests; report evidence, no commits.

### Task 5: Inspiration compatibility and production regression

**Files:** Modify `backend/services/inspirationTypes.ts`, `inspirationService.ts`, `inspirationLlm.ts`, `inspirationWorker.ts`, related worker-store/schedule status if needed, `frontend/src/services/inspirationService.ts`, inspiration page and related tests.

**Interfaces:** LimitedNoteContext `{noteId,revision,title,summary}` only. Manual all-unusable =>409/INSPIRATION_NOTE_CONTEXT_UNAVAILABLE with details.reason `no_notes|summary_pending|context_unavailable`; scheduled outcome `no_result` reason recorded using existing completion flow. No rawbody fallback, no GET-triggered repair.

- [x] Add failing cases for untitled-summary-only note, partial usable context, known stale versus unknown-provenance legacy summary, all-pending/failed/images/no notes, and payload absence of keywords/body.
- [x] Select recent five metadata with enrichment revision/status; filter each context independently; keep unknown history compatible. Change prompts/payloads/explanations. Preserve historical inspiration and source/headline naming.
- [x] Return truthful reason for no research; scheduled no-result carries reason without new quick retries. Frontend shows matching error and keeps saved/history items.
- [x] Run frontend/backend typechecks and complete tests once on integrated code; verify production topic entry points absent and model prompts/normal DTOs have no retired note keywords.
- [x] Run build and independent final review; resolve material findings with scoped tests.

### Task 6: Local experience and release record

**Files:** Create `docs/superpowers/reviews/2026-10-11-optional-note-titles-no-tags-validation.md`; update spec implementation status and this plan's checkboxes from actual evidence.

**Interfaces:** Validation records precise commands/results, isolated DB identity, UI desktop1440/mobile390, representative source/generation evidence, and release cutover constraints.

- [x] Use local app and isolated QA user/database for reversible write interaction. Production/local real account notes are read-only representative material.
- [x] Verify untitled/manual/clear/generate/undo/failure, title-body save, sources outside feed and pure/mixed image at desktop/mobile with keyboard flows.
- [x] Review 12–20 representative samples for source recognition and faithful title output; clearly distinguish deterministic/fake-provider tests from any actual AI calls. Do not claim AI quality on mock responses.
- [x] Record remaining product limitations honestly; production release requires stopping old instances and synchronized frontend/backend switch. No production data change or deployment in this task.
