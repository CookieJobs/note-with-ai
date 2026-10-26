# Notes Reliability Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the current production-equivalent `main@9ca9ba3`, implement M01–M04, M08 and M10 without importing the discarded visual redesign, new product modules, or unrelated admin changes.

**Architecture:** Keep the existing notes screen and its visual structure. Add a user-scoped quick-capture session at the hook boundary; evolve the notes API from an unbounded list into a cursor-page contract; fetch association summaries independently of the loaded list; require summaries to match the source note's current revision; defer rich-text code until edit intent. All state transitions are covered by focused regression tests before production code is changed.

**Tech Stack:** Next.js/React, TanStack Query, TypeScript, Express, Mongoose, Vitest, Node test runner.

**Spec:** `docs/recovery/2026-09-19-code-reuse-assessment.md` (approved decision items M01, M02, M03, M04, M08 and M10).

## Global Constraints

- Base every change on current `main@9ca9ba3`; preserve the committed admin-production release.
- Do not import the discarded frontend theme, layout, navigation, card, color-token, memory, sharing, inspiration, feedback, analytics, or admin UI work.
- Retain the present notes-page visual baseline; any new text is limited to accurate save/draft state and uses existing local component structure.
- Cursor pagination defaults to 30 notes and accepts at most 50; ordering is stable by `createdAt DESC, _id DESC`.
- All list writes must invalidate/cancel stale reads and preserve optimistic temporary notes.
- Association summaries enforce ownership, current source revision, absent/deleted target filtering, and a maximum of five results.
- Tests are written and observed failing before each corresponding production change.
- No deploy, merge, or follow-on capability begins without user acceptance.

## Review Focus

- A rich-text local draft whose JSON is malformed must retain recoverable plain text, never crash the note page.
- A failed save and a save followed by more typing must retain the newest content and never claim it was saved.
- Cursor page responses that return after a create, update, or delete must not overwrite the newer cache.
- A related-note target outside the first loaded page, deleted after caching, or owned by another user must never produce a false result or content leak.
- A source note whose association cache is absent or from an older revision must not be represented as current associations.

---

### Task 1: M01/M02 quick-capture session and its behavior tests

**Files:**
- Modify: `frontend/src/app/notes/hooks/useCreateNote.test.tsx`
- Modify: `frontend/src/app/notes/hooks/useCreateNote.ts`
- Modify: `frontend/src/app/notes/page.test.tsx`
- Modify: `frontend/src/app/notes/page.tsx`
- Modify: `frontend/src/app/notes/components/FloatingQuickCompose.tsx`
- Modify only if required for existing class hooks: `frontend/src/app/notes/styles/floating-compose.module.scss`

**Interfaces:**
- Consumes: `createNote(command): Promise<Note>`, current authenticated user ID from the notes page.
- Produces: `changeContent`, `discardDraft`, `saveState`, `localDraftState`, `draftRestored`, `saveError`, and `handleSubmit(): Promise<boolean>` from `useCreateNote`.

- [ ] **Step 1: Write failing hook tests for user-scoped recovery and malformed rich text**

```ts
it('restores only the signed-in user\'s persisted draft after remount', () => {
  localStorage.setItem('quick-capture-draft:user-a', JSON.stringify({ version: 1, text: '继续写', json: null }));
  const { result } = renderHook(() => useCreateNote(createNote, { userId: 'user-a' }));
  expect(result.current.newContentText).toBe('继续写');
  expect(result.current.draftRestored).toBe(true);
});

it('falls back to persisted text when rich-text JSON is invalid', () => {
  localStorage.setItem('quick-capture-draft:user-a', JSON.stringify({ version: 1, text: '保住文字', json: { type: 'not-a-doc' } }));
  const { result } = renderHook(() => useCreateNote(createNote, { userId: 'user-a' }));
  expect(result.current.newContentText).toBe('保住文字');
  expect(result.current.newContentJson).toBeNull();
});
```

- [ ] **Step 2: Run the targeted hook tests and verify they fail because drafts are not persisted/restored**

Run: `cd frontend && npm test -- src/app/notes/hooks/useCreateNote.test.tsx`

Expected: FAIL on absent `userId`/draft recovery behavior.

- [ ] **Step 3: Write failing tests for failed save, concurrent typing, and cross-tab-safe cleanup**

```ts
it('keeps text and reports failed state when saving rejects', async () => {
  const { result } = renderHook(() => useCreateNote(vi.fn().mockRejectedValue(new Error('offline')), { userId: 'user-a' }));
  act(() => result.current.setNewContentText('不要丢'));
  await act(async () => { await result.current.handleSubmit(); });
  expect(result.current.newContentText).toBe('不要丢');
  expect(result.current.saveState).toBe('failed');
});

it('does not clear text typed after an earlier save began', async () => {
  const deferred = deferredPromise<Note>();
  const { result } = renderHook(() => useCreateNote(vi.fn().mockReturnValue(deferred.promise), { userId: 'user-a' }));
  act(() => result.current.setNewContentText('第一段'));
  void act(async () => { void result.current.handleSubmit(); });
  act(() => result.current.setNewContentText('第一段，继续写'));
  await act(async () => { deferred.resolve(createdNote); });
  expect(result.current.newContentText).toBe('第一段，继续写');
});
```

- [ ] **Step 4: Implement the minimal session state machine**

Implement a private session containing user ID, text, JSON, monotonically increasing revision, last persisted value, local-draft status, save state, restored flag and error. Persist synchronously on content change under `quick-capture-draft:<userId>`; validate rich text against the existing editor schema; only remove storage if its value still matches the submitting session; clear visible input only when the response belongs to the unchanged session.

- [ ] **Step 5: Wire the current user ID and existing quick-capture component without a visual redesign**

Pass `user?.id` to the hook, pass `changeContent` rather than separate setters, and render only the minimal restoration/error/save text required by M01/M02. Keep existing layout, card, navigation, colors, and animations. Add page/component tests for restored text and retryable failure.

- [ ] **Step 6: Run focused frontend tests and type checking**

Run: `cd frontend && npm test -- src/app/notes/hooks/useCreateNote.test.tsx src/app/notes/page.test.tsx && npm run typecheck`

Expected: PASS.

### Task 2: M03 cursor API, independent note read, and front-end page cache

**Files:**
- Create: `backend/services/noteListCursor.ts`
- Modify: `backend/services/noteService.ts`
- Modify: `backend/controllers/noteController.ts`
- Modify: `backend/routes/notes.ts`
- Modify: `backend/schemas/noteSchemas.ts`
- Modify: `backend/types/index.ts`
- Modify: `backend/tests/noteListCursor.test.ts`
- Modify: `backend/tests/noteHttpContract.test.ts`
- Create: `frontend/src/app/notes/hooks/notePages.ts`
- Modify: `frontend/src/app/notes/hooks/useNotes.test.tsx`
- Modify: `frontend/src/app/notes/hooks/useNotes.ts`
- Modify: `frontend/src/app/notes/page.test.tsx`
- Modify: `frontend/src/app/notes/page.tsx`

**Interfaces:**
- Consumes: `GET /api/notes?limit=<1..50>&cursor=<opaque>`.
- Produces: `{ notes, pageInfo: { nextCursor: string | null, hasMore: boolean } }`, `GET /api/notes/:id`, and a flattened front-end list with `fetchNextPage`.

- [ ] **Step 1: Write failing backend cursor tests**

```ts
it('uses createdAt and _id as a stable opaque cursor and returns no more than the requested capped page', async () => {
  const page = await noteService.getNotesPage('user-1', { limit: 30, cursor: null });
  assert.equal(page.notes.length, 30);
  assert.equal(typeof page.pageInfo.hasMore, 'boolean');
});

it('rejects malformed cursors before querying notes', async () => {
  await assert.rejects(() => noteService.getNotesPage('user-1', { limit: 30, cursor: 'bad' }));
});
```

- [ ] **Step 2: Run cursor tests and verify they fail because `getNotesPage` does not exist**

Run: `cd backend && npx tsx --test tests/noteListCursor.test.ts`

Expected: FAIL with missing page/cursor API.

- [ ] **Step 3: Implement the cursor codec and server contracts**

Add a base64url JSON cursor carrying only validated `createdAt` and `_id`; query with `createdAt < cursor.createdAt OR (createdAt = cursor.createdAt AND _id < cursor._id)`; fetch `limit + 1` records; cap at 50; preserve the current DTO/enrichment mapping. Add authenticated `GET /:id` before mutating `/:id` routes and return 404 for non-owned notes.

- [ ] **Step 4: Write failing front-end page tests**

```ts
it('appends a second cursor page without duplicating notes from the first page', async () => {
  // Mock two page envelopes, render useNotes, call fetchNextPage.
  expect(result.current.notes.map(note => note._id)).toEqual(['n3', 'n2', 'n1']);
});

it('keeps the newer cache when a pre-write page request resolves late', async () => {
  // Hold the GET promise, create a note, then resolve the held response.
  expect(result.current.notes[0]._id).toBe(createdNote._id);
});
```

- [ ] **Step 5: Implement a focused `notePages` adapter and migrate `useNotes`**

Keep page-envelope parsing, stable deduplication, page flattening and stale-generation handling in `notePages.ts`. Use TanStack Query infinite pages; preserve existing optimistic create/update/delete and polling behavior; ensure writes cancel/invalidate list pages rather than reintroducing an unbounded array query. Add the current-page “load more” control using existing page structure only.

- [ ] **Step 6: Run focused backend and frontend pagination suites**

Run: `cd backend && npx tsx --test tests/noteListCursor.test.ts tests/noteHttpContract.test.ts`

Run: `cd frontend && npm test -- src/app/notes/hooks/useNotes.test.tsx src/app/notes/hooks/useNotesPolling.test.tsx src/app/notes/page.test.tsx && npm run typecheck`

Expected: PASS.

### Task 3: M04 independent association summaries

**Files:**
- Create: `backend/services/relatedNoteSummaryService.ts`
- Modify: `backend/routes/recommend.ts`
- Modify: `backend/tests/recommendAndPerformanceRoutes.test.ts`
- Create: `backend/tests/relatedNoteSummaryService.test.ts`
- Create: `frontend/src/app/notes/services/relatedNotes.ts`
- Create: `frontend/src/app/notes/services/relatedNotes.test.ts`
- Modify: `frontend/src/app/notes/components/RelatedNotesDrawer.tsx`
- Modify: `frontend/src/app/notes/components/RelatedNotesDrawer.test.tsx`
- Modify: `frontend/src/app/notes/page.tsx`

**Interfaces:**
- Consumes: `GET /api/recommend/notes/:noteId`.
- Produces: at most five sanitized associated-note summaries from the source note’s current revision cache; a drawer request keyed by source note ID and source revision.

- [ ] **Step 1: Write failing service and route tests for ownership, current revision, deleted targets, and the five-item limit**

```ts
it('returns only owned targets from the current source revision and caps them at five', async () => {
  const summaries = await relatedNoteSummaryService.list('user-1', 'source-1');
  assert.equal(summaries.length, 5);
  assert.ok(summaries.every(item => item.noteId !== 'deleted-or-foreign'));
});
```

- [ ] **Step 2: Run the related-summary tests and verify they fail because the service and route are absent**

Run: `cd backend && npx tsx --test tests/relatedNoteSummaryService.test.ts tests/recommendAndPerformanceRoutes.test.ts`

Expected: FAIL with missing service/route.

- [ ] **Step 3: Implement the narrow summary service and route**

Read only the source note owned by the requester; accept cache entries only when `sourceRevision === source.revision`; load candidate notes by IDs with requester ownership; preserve existing relation type/reason values; omit scores and internal diagnostics; cap to five. Return an empty successful list for a current empty cache and a safe stale/missing state for a source cache that cannot be trusted.

- [ ] **Step 4: Write failing drawer tests for a target not present in the loaded list and response races**

```tsx
it('renders a fetched related target that is absent from allNotes', async () => {
  render(<RelatedNotesDrawer isOpen selectedNoteId="source" allNotes={[source]} />);
  expect(await screen.findByText('列表外笔记')).toBeInTheDocument();
});

it('ignores a late response for the previously selected source revision', async () => {
  // Resolve request A after selection changes to B; assert only B is displayed.
});
```

- [ ] **Step 5: Implement the small client adapter and drawer state key**

Fetch summaries only while the drawer is open and a selected source exists. Key state by `noteId:revision`, abort or ignore stale responses, retain existing close/navigation interactions, and use existing drawer markup rather than importing archived drawer/theme styles.

- [ ] **Step 6: Run association suites**

Run: `cd backend && npx tsx --test tests/relatedNoteSummaryService.test.ts tests/recommendAndPerformanceRoutes.test.ts`

Run: `cd frontend && npm test -- src/app/notes/services/relatedNotes.test.ts src/app/notes/components/RelatedNotesDrawer.test.tsx && npm run typecheck`

Expected: PASS.

### Task 4: M08 rich-text loading on edit intent and M10 full regression verification

**Files:**
- Create: `frontend/src/app/notes/components/richTextEditorLoader.ts`
- Modify: `frontend/src/app/notes/page.tsx`
- Modify: `frontend/src/app/notes/page.test.tsx`
- Create: `frontend/scripts/check-route-budgets.mjs`
- Create: `frontend/scripts/check-route-budgets.test.mjs`
- Create: `frontend/scripts/route-budget-baseline.json`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`

**Interfaces:**
- Consumes: current rich-text editor component import and a generated Next route build manifest.
- Produces: a lazy editor loader that is invoked only on compose/edit intent and a budget script with checked-in baseline values.

- [ ] **Step 1: Write failing page tests for deferred editor loading**

```tsx
it('does not request the rich-text editor until the user opens compose', async () => {
  const loader = vi.fn();
  render(<NotesPage editorLoader={loader} />);
  expect(loader).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /记录|新建/i }));
  expect(loader).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the page test and verify it fails because the editor is eagerly imported**

Run: `cd frontend && npm test -- src/app/notes/page.test.tsx`

Expected: FAIL on eager import/load.

- [ ] **Step 3: Implement the loader with a stable fallback**

Use a dynamic import wrapper for the existing rich-text editor only, retain the current plain-text fallback while the chunk is pending, cache the resolved module, and preserve the first edit’s text/selection. Do not change card, page, navigation, or color styles.

- [ ] **Step 4: Write failing route-budget script tests**

```js
test('fails when a tracked route grows beyond its recorded production baseline', () => {
  expect(() => checkRouteBudgets(fixtureWithOversizedNotesRoute)).toThrow(/notes/);
});
```

- [ ] **Step 5: Implement the minimal build-manifest budget checker**

Read only generated production route artifact sizes, compare against a checked-in baseline with a documented tolerance, and make the checker fail nonzero when the notes route exceeds it. Do not use this script as an accessibility/style gate.

- [ ] **Step 6: Run all targeted tests, full suites, build/type checks, and review the diff**

Run: `cd frontend && npm test && npm run typecheck && npm run build && node scripts/check-route-budgets.mjs`

Run: `cd backend && npm test && npm run typecheck && npm run build`

Then run: `git diff --check && git diff --stat`

Expected: all commands pass; report every pre-existing or newly discovered failure by name.
