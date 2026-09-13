# Task 10 report — stable note-list pagination

## Result

Implemented stable cursor pagination for `GET /api/notes`, batched AI-preference projection, and an owned single-note endpoint for Publish previews. The implementation commit is `b408d5d` (`feat(notes): paginate list and batch AI preferences`).

## RED / GREEN evidence

- **Cursor RED:** `cd backend && npm test -- --test-name-pattern='note list cursor'` failed because `../services/noteListCursor` did not exist (`MODULE_NOT_FOUND`).
- **Cursor GREEN:** `cd backend && npx tsx --test tests/noteListCursor.test.ts` passed 4 tests: exact round-trip plus malformed base64url, invalid timestamp, and missing-id rejection.
- **Service RED:** `cd backend && npx tsx --test tests/noteService.test.ts` failed because `noteService.getNotesPage` and `noteService.getNote` were not functions.
- **Service GREEN:** focused cursor/service/HTTP test command passed 16 tests after implementation.
- **HTTP RED:** `cd backend && npx tsx --test tests/noteHttpContract.test.ts` failed: the controller used the old unbounded `getNotes`, malformed cursor was accepted, and `getNote` did not exist.
- **HTTP GREEN:** the same focused command passed, verifying the page envelope, malformed-cursor 400, and owned single-note envelope.

## Implementation

- Added a versioned, canonical base64url cursor codec containing `{ version, createdAt, id }`; it requires an exact ISO date and a 24-hex Mongo ObjectId.
- Added `getNotesPage(userId, { limit, cursor })`: default 30, capped at 50, `limit + 1` lookahead, and `(createdAt DESC, _id DESC)` continuation filtering.
- Added the `{ userId, createdAt, _id }` index to support the page query.
- Projects `aiIncluded` from one `NoteAiPreference.find({ userId, noteId: { $in: ids } })` query per non-empty page. A missing preference projects as `true`.
- Added `getNote`/`GET /api/notes/:id`, scoped by both note ID and owner, before mutation routes.
- `GET /api/notes` now returns `data: { notes, pageInfo }`; query validation accepts only a positive integer limit up to 50 and a bounded cursor.
- Publish selection reads `pageInfo`, retains loaded pages, and provides the visible `加载更多笔记` action. Publish preview fetches only `/api/notes/:id`.

## Files changed

- `backend/services/noteListCursor.ts`
- `backend/services/noteService.ts`
- `backend/controllers/noteController.ts`
- `backend/schemas/noteSchemas.ts`
- `backend/routes/notes.ts`
- `backend/models/Note.ts`
- `backend/types/index.ts`
- `backend/tests/noteListCursor.test.ts`
- `backend/tests/noteService.test.ts`
- `backend/tests/noteHttpContract.test.ts`
- `frontend/src/app/publish/select/page.tsx`
- `frontend/src/app/publish/[noteId]/page.tsx`

## Verification

| Command | Result |
| --- | --- |
| `cd backend && npm test` | PASS — 161 tests |
| `cd backend && npm run typecheck` | PASS |
| `cd backend && npm run build` | PASS |
| `cd frontend && npm test` | PASS — 34 files, 218 tests |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm run lint` | PASS |
| `git diff --check` | PASS |

## Risks / follow-up

- Existing Notes UI still consumes the first `data.notes` page; its cache migration to infinite pages is intentionally deferred to Task 12.
- The legacy internal `noteService.getNotes` compatibility method now delegates to one capped 50-item page. No production route calls it after this task.
- The new compound index is declared in the model and will be created by the application’s normal Mongoose index lifecycle; deployment operators should ensure index synchronization is enabled or create it through their migration process.
