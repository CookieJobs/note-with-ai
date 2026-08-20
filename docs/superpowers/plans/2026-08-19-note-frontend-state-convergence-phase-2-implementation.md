# Note Frontend State Convergence Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the frontend Note data Module the single owner of canonical Note requests, React Query cache mutation, optimistic creation, typed conflicts, recommendation refresh, and bounded enrichment polling.

**Architecture:** Deepen the existing `useNotes` Module rather than adding a repository or global store. `useCreateNote` and `useNoteEditor` retain UI state but call the Note data Interface; `ModernNoteCard`, `RelatedNotesDrawer`, and the page forward domain intent without reconstructing Note snapshots.

**Tech Stack:** TypeScript, React 18, Next.js 15, TanStack React Query 5, Vitest 4, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-19-note-frontend-state-convergence-phase-2-design.md`

## Global constraints

- Read the entire Spec and the Phase 1 Spec before editing.
- Preserve every existing user change. Inspect the current diff for each overlapping file before modifying it.
- This phase is frontend-only. Do not modify backend code or contracts.
- Do not touch Auth, Chat, Profile, rich-text visual controls, dependency versions, or `docs/architecture-visual/`.
- Do not introduce Redux, Zustand, Context global state, a repository Interface, a generic HTTP client, command bus, or DTO package.
- Keep React Query and the concrete `authFetch` Adapter.
- Do not split `ModernNoteCard` or redesign UI.
- Do not weaken TypeScript, ESLint, build, or test configuration.
- Do not use broad `any`, `@ts-ignore`, forced test exit, or deleted assertions to make verification pass.
- Follow red-green-refactor for every behaviour.
- Do not commit or push. User instructions override the plan skill's usual commit checkpoints.
- Normal create/update paths must each issue exactly one Note write request.

## File map

**Production files to modify**

- `frontend/src/app/notes/hooks/useNotes.ts` — public Note data Interface and private canonical/cache/polling Implementation.
- `frontend/src/app/notes/hooks/useCreateNote.ts` — compose draft UI; delegates create intent.
- `frontend/src/app/notes/hooks/useNoteEditor.ts` — editor/draft/conflict UI; delegates update intent.
- `frontend/src/app/notes/components/ModernNoteCard.tsx` — accepts one update intent instead of three field callbacks.
- `frontend/src/app/notes/components/RelatedNotesDrawer.tsx` — requests recommendation refresh by Note id only.
- `frontend/src/app/notes/page.tsx` — layout wiring only; removes Note HTTP and polling orchestration.
- `frontend/src/types/index.ts` — canonical Note remains one shape; no client-only `enriching` field.

**Test files**

- Create `frontend/src/app/notes/hooks/useNotes.test.tsx` — canonical writes, optimistic create, delete, conflicts, recommendation freshness.
- Create `frontend/src/app/notes/hooks/useNotesPolling.test.tsx` — coalesced polling lifecycle.
- Modify `frontend/src/app/notes/hooks/useCreateNote.test.tsx` — compose delegation and retryable input.
- Modify `frontend/src/app/notes/hooks/useNoteEditor.test.tsx` — update intent, edit baseline, typed conflicts, explicit retry.
- Modify `frontend/src/app/notes/hooks/useNoteEditorCachePropagation.test.tsx` — cross-Module full snapshot regression.

No new production file is planned. `useNotes.ts` is expected to become a deep Module; private helpers may stay in the same file. Extract a private internal file only if the final hook becomes materially harder to understand, and do not create a second exported pass-through Interface.

---

### Task 1: Add the canonical Note update Interface and typed conflict

**Files:**

- Modify: `frontend/src/app/notes/hooks/useNotes.ts`
- Create: `frontend/src/app/notes/hooks/useNotes.test.tsx`
- Reference: `frontend/src/types/index.ts`

**Interfaces:**

- Produces `UpdateNoteCommand` and `NoteWriteConflict` exports.
- Produces `updateNote(command: UpdateNoteCommand): Promise<Note>` from `useNotes`.
- Temporarily retains existing field-specific callbacks until Task 5 migrates all callers.

- [ ] **Step 1: Build a fresh QueryClient test harness**

Create a helper in `useNotes.test.tsx` that exposes both the hook and QueryClient:

```tsx
function makeHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}
```

Mock only the existing `authFetch` Adapter. Use `useNotes(null)` so the list query does not auto-run in mutation-focused tests.

- [ ] **Step 2: Write failing canonical replacement tests**

Seed `['notes']` with revision 4 containing stale `summary`, `concepts`, and a non-null recommendation cache. Mock a successful PATCH returning revision 5 with different server-owned fields and `recommendCache: null`.

Assert:

```ts
await result.current.updateNote({
  noteId: 'note-1',
  expectedRevision: 4,
  changes: { title: 'new title' },
});

expect(authFetch).toHaveBeenCalledTimes(1);
expect(JSON.parse(String(request.body))).toEqual({
  expectedRevision: 4,
  changes: { title: 'new title' },
});
expect(queryClient.getQueryData<Note[]>(['notes'])?.[0]).toEqual({
  ...canonicalNote,
  enrichment: canonicalEnrichment,
});
expect(queryClient.getQueryData<Note[]>(['notes'])?.[0].recommendCache).toBeNull();
```

Include an extra enumerable field in the mocked canonical Note and assert it survives full replacement at runtime. Do not add that field to the production `INote` type solely for the test.

- [ ] **Step 3: Run the focused test and observe RED**

Run:

```bash
npm --prefix frontend test -- useNotes.test.tsx
```

Expected: failure because `updateNote` and `NoteWriteConflict` do not exist.

- [ ] **Step 4: Define the public types and minimal validators**

In `useNotes.ts`, export the logical Interface:

```ts
export type NoteBodyInput =
  | { kind: 'rich-text'; document: Record<string, unknown>; fallbackMarkdown?: string }
  | { kind: 'plain-text'; text: string };

export type UpdateNoteCommand = {
  noteId: string;
  expectedRevision: number;
  changes: {
    body?: NoteBodyInput;
    title?: string;
    keywords?: string[];
  };
};

export class NoteWriteConflict extends Error {
  readonly code = 'NOTE_WRITE_CONFLICT' as const;
  constructor(public readonly current: Note) {
    super('笔记已被其他写入更新');
    this.name = 'NoteWriteConflict';
  }
}
```

Add private `readCanonicalNoteWrite(payload: unknown): Note`. Validate object shape, non-empty `_id`, positive integer `revision`, and an enrichment object whose source revision is numeric and whose status is pending/ready/degraded. Preserve the full Note object with spread and attach the validated enrichment.

- [ ] **Step 5: Implement `updateNote` with full snapshot replacement**

Use one private cache helper:

```ts
function replaceCachedNote(notes: Note[] | undefined, canonical: Note): Note[] {
  return (notes ?? []).map((note) => note._id === canonical._id ? canonical : note);
}
```

`updateNote` must send exactly one PATCH. On valid success, replace and return the canonical Note.

For a valid 409:

```ts
const current = readCanonicalNoteWrite(payload.current);
queryClient.setQueryData<Note[]>(NOTES_QUERY_KEY, (notes) => replaceCachedNote(notes, current));
throw new NoteWriteConflict(current);
```

Adapt `readCanonicalNoteWrite` so it can decode either `{ note, enrichment }` or the success wrapper's `data`. Malformed success/conflict payloads reject without mutating the cache.

- [ ] **Step 6: Add and pass conflict/invalid-payload tests**

Add tests proving:

- a valid 409 replaces shared state with revision 5 and throws `NoteWriteConflict.current`;
- malformed 409 does not mutate revision 4 cache;
- HTTP 200 with missing/invalid canonical data does not mutate cache.

Run the focused test until green, then run:

```bash
npm --prefix frontend run typecheck
```

Expected: both pass while old callback callers still compile.

---

### Task 2: Move optimistic create and delete behind the Note data Interface

**Files:**

- Modify: `frontend/src/app/notes/hooks/useNotes.ts`
- Test: `frontend/src/app/notes/hooks/useNotes.test.tsx`

**Interfaces:**

- Consumes `readCanonicalNoteWrite` and the cache helper from Task 1.
- Produces `CreateNoteCommand` and `createNote(command): Promise<Note>`.
- Keeps `deleteNote(noteId): Promise<void>` but makes failure reject while preserving cache.

- [ ] **Step 1: Write failing optimistic create success and isolated rollback tests**

Define:

```ts
export type CreateNoteCommand = {
  body: NoteBodyInput;
  optimistic: {
    contentText: string;
    contentJson?: Record<string, unknown> | null;
  };
};
```

Use a deferred `authFetch` promise. After calling `createNote`, assert one temporary `temp-*` Note is at the front with revision 0 and pending enrichment. Resolve the request and assert only the temp id is replaced by the canonical Note.

For failure, insert an unrelated Note into QueryClient while the POST is pending. Reject/return failure, then assert the temp id is removed but the unrelated concurrent Note remains.

- [ ] **Step 2: Run focused tests and observe RED**

```bash
npm --prefix frontend test -- useNotes.test.tsx
```

Expected: create tests fail because create is still owned by `useCreateNote`.

- [ ] **Step 3: Implement the temporary Note lifecycle**

Move UUID generation into `useNotes`. Insert this shape privately:

```ts
const temporary: Note = {
  _id: `temp-${generateUUID()}`,
  title: '',
  content: command.optimistic.contentText,
  contentText: command.optimistic.contentText,
  contentJson: command.optimistic.contentJson ?? undefined,
  summary: '',
  concepts: [],
  keywords: [],
  recommendCache: null,
  revision: 0,
  enrichment: { sourceRevision: 0, status: 'pending' },
  createdAt: now,
  updatedAt: now,
};
```

Replace/remove by `temporary._id` only. Never restore a pre-request list snapshot.

- [ ] **Step 4: Characterize and preserve delete behaviour**

Add tests:

- DELETE success removes exactly the requested Note;
- DELETE failure rejects and leaves the cache unchanged.

If the existing mutation already satisfies this, keep its Implementation and expose the same `Promise<void>` semantics. Do not make deletion optimistic in this phase.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
npm --prefix frontend test -- useNotes.test.tsx
npm --prefix frontend run typecheck
```

Expected: green.

---

### Task 3: Implement bounded coalesced enrichment polling

**Files:**

- Modify: `frontend/src/app/notes/hooks/useNotes.ts`
- Create: `frontend/src/app/notes/hooks/useNotesPolling.test.tsx`

**Interfaces:**

- Polling remains private; no `startEnrichmentPolling` is exported.
- Consumes canonical `Note.enrichment` produced by GET/create/update.

- [ ] **Step 1: Write fake-timer tests for the polling state machine**

Use `vi.useFakeTimers()` and restore real timers after each test. Mock `document.visibilityState` and `document.hasFocus()` explicitly.

Cover these sequences:

1. one pending Note triggers no immediate refetch, then one GET after five seconds;
2. two pending Notes still trigger one list GET per interval;
3. ready/degraded response stops future attempts;
4. a new revision retires the old `(id, revision)` observation;
5. hidden/unfocused state performs no polling and remaining budget can resume after visibility/focus;
6. a permanently pending revision never exceeds five attempts or sixty seconds;
7. unmount clears timers/listeners.

Assert request URLs rather than private timer data.

- [ ] **Step 2: Run polling tests and observe RED**

```bash
npm --prefix frontend test -- useNotesPolling.test.tsx
```

Expected: failure because pending state is not observed by `useNotes`.

- [ ] **Step 3: Implement one private observation map and one timer**

Use an internal key and state:

```ts
type PendingObservation = { attempts: number; observedAt: number };
const pendingRef = useRef(new Map<string, PendingObservation>());
const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const keyFor = (note: Note) => `${note._id}:${note.enrichment?.sourceRevision ?? note.revision}`;
```

Reconcile the map whenever canonical notes change:

- register current pending pairs once;
- remove terminal, deleted, and superseded pairs;
- do not reset `attempts` for the same pair after every GET.

Schedule one timer for the whole map. At each eligible tick, call the Notes list refetch once, increment attempts for observations that were eligible at tick start, reconcile returned data, and schedule again only if at least one observation has budget.

- [ ] **Step 4: Add visibility/focus lifecycle**

Do not poll unless:

```ts
document.visibilityState === 'visible' && document.hasFocus()
```

Listen for `visibilitychange`, `focus`, and `blur`. On focus/visible, allow React Query's normal refetch and schedule remaining pending budget. On hidden/blur, clear only the timer, not observation budgets.

- [ ] **Step 5: Pass focused polling tests and full frontend tests**

```bash
npm --prefix frontend test -- useNotesPolling.test.tsx
npm --prefix frontend test
```

Expected: all frontend tests pass. Do not export polling internals just to satisfy tests.

---

### Task 4: Migrate compose creation to the deep Note data Module

**Files:**

- Modify: `frontend/src/app/notes/hooks/useCreateNote.ts`
- Modify: `frontend/src/app/notes/hooks/useCreateNote.test.tsx`
- Modify: `frontend/src/app/notes/page.tsx`

**Interfaces:**

- Consumes `createNote(command: CreateNoteCommand): Promise<Note>`.
- `useCreateNote` no longer accepts `setNotes` or `onEnrichmentPending`.

- [ ] **Step 1: Rewrite tests around the compose Interface and observe RED**

Render:

```ts
const createNote = vi.fn().mockResolvedValue(canonicalNote);
const { result } = renderHook(() => useCreateNote(createNote, { onError }));
```

Assert one call with:

```ts
{
  body: { kind: 'plain-text', text: '正文' },
  optimistic: { contentText: '正文', contentJson: null },
}
```

Add rich-text coverage. Add failure coverage proving `newContentText`/`newContentJson` remain intact and the error is surfaced. Success clears both.

Run:

```bash
npm --prefix frontend test -- useCreateNote.test.tsx
```

Expected: old signature and direct HTTP assertions fail.

- [ ] **Step 2: Remove data ownership from `useCreateNote`**

Delete imports of `authFetch`, UUID, and `Note`. Replace the signature with the single intent function plus UI options. `handleSubmit` should:

```ts
await createNote({
  body: newContentJson
    ? { kind: 'rich-text', document: newContentJson }
    : { kind: 'plain-text', text: contentText },
  optimistic: { contentText, contentJson: newContentJson },
});
```

Clear inputs only after resolve. Keep the existing loading guard and error handling.

- [ ] **Step 3: Wire the page to `createNote` and remove page polling**

Take `createNote` from `useNotes` and pass it to `useCreateNote`. Delete:

- `setNotes` destructuring;
- `enrichmentPollTimers`;
- `startEnrichmentPolling` and `stopEnrichmentPolling`;
- their cleanup effect;
- `onEnrichmentPending` wiring.

Preserve the current page behaviour that closes the compose shell on submit. The draft remains in the hook on failure and is visible when reopened.

- [ ] **Step 4: Pass focused tests, typecheck, and create request-count regression**

```bash
npm --prefix frontend test -- useCreateNote.test.tsx useNotes.test.tsx useNotesPolling.test.tsx
npm --prefix frontend run typecheck
```

Assert the integration makes one Note POST and no embed/summary/recommendation request.

---

### Task 5: Migrate all editor writes and preserve explicit conflict retry

**Files:**

- Modify: `frontend/src/app/notes/hooks/useNoteEditor.ts`
- Modify: `frontend/src/app/notes/hooks/useNoteEditor.test.tsx`
- Modify: `frontend/src/app/notes/hooks/useNoteEditorCachePropagation.test.tsx`
- Modify: `frontend/src/app/notes/components/ModernNoteCard.tsx`
- Modify: `frontend/src/app/notes/page.tsx`

**Interfaces:**

- Consumes `updateNote(command: UpdateNoteCommand): Promise<Note>` and `NoteWriteConflict`.
- Removes `onUpdateTitle`, `onUpdateContent`, and `onUpdateKeywords` from editor/card/page.

- [ ] **Step 1: Rewrite editor success tests around `updateNote`**

Pass one mocked function:

```ts
const updateNote = vi.fn().mockResolvedValue(canonicalRevisionFive);
useNoteEditor({ note, updateNote, ...uiProps });
```

For title, body, keyword edit, and keyword delete, assert command shape and revision. Stop asserting long positional callback lists.

- [ ] **Step 2: Add baseline and explicit retry conflict tests**

Cover this exact body sequence:

1. enter edit at revision 4;
2. rerender the hook with Note prop revision 5 without a conflict;
3. save and assert `expectedRevision: 4`;
4. reject with `new NoteWriteConflict(serverRevisionFive)`;
5. assert draft remains and no automatic second call occurs;
6. invoke save explicitly again;
7. assert the second command uses revision 5.

Add equivalent retryability assertions for title and keywords. Body conflict displays current server content; keyword conflict preserves the existing message.

Run and observe RED:

```bash
npm --prefix frontend test -- useNoteEditor.test.tsx
```

- [ ] **Step 3: Replace three write implementations with one intent**

Update `UseNoteEditorProps` to accept `updateNote`. Keep the UI reducer and drafts. Add refs/state for edit baseline and conflict retry revision; do not derive an active edit's expected revision directly from changing props.

Each handler calls `updateNote` exactly once per explicit action. On success, use returned canonical values for local UI settlement only; React Query is already updated.

On `NoteWriteConflict`:

- preserve the local value/draft;
- record `error.current.revision` for the next explicit action;
- show existing conflict state;
- never auto-resubmit.

Other failures preserve existing generic UI behaviour.

- [ ] **Step 4: Narrow Card and page Interfaces**

`ModernNoteCard` receives one `updateNote` prop and passes it to `useNoteEditor`. The page passes `useNotes().updateNote`. Delete all three field callback prop declarations and destructuring.

- [ ] **Step 5: Convert the cache propagation regression**

Keep the two valuable scenarios—JSON-only and keyword-only—but call the real `useNotes().updateNote` through the editor. Assert the stored Note equals the complete canonical snapshot and `getRecommendCacheState(...).needsRefresh === false`.

Add a third canonical-null scenario proving stale cache clears.

- [ ] **Step 6: Run the editor/data tests and typecheck**

```bash
npm --prefix frontend test -- useNoteEditor.test.tsx useNoteEditorCachePropagation.test.tsx useNotes.test.tsx
npm --prefix frontend run typecheck
```

Expected: green with one PATCH per explicit save and no field-specific callbacks.

---

### Task 6: Move recommendation refresh and remove the remaining cache seam leaks

**Files:**

- Modify: `frontend/src/app/notes/hooks/useNotes.ts`
- Test: `frontend/src/app/notes/hooks/useNotes.test.tsx`
- Modify: `frontend/src/app/notes/components/RelatedNotesDrawer.tsx`
- Modify: `frontend/src/app/notes/page.tsx`

**Interfaces:**

- Produces `refreshRecommendCache(noteId: string): Promise<void>` from `useNotes`.
- Drawer callback becomes `(noteId: string) => Promise<void>`.

- [ ] **Step 1: Write failing same-revision and late-response tests**

Seed revision 4. For same-revision success, resolve `/api/recommend/semantic-notes`, assert the cache is built with source revision 4 and applied.

For the late result:

1. start refresh at revision 4 with a deferred response;
2. replace the QueryClient Note with canonical revision 5;
3. resolve the revision 4 recommendation response;
4. assert revision 5 and its recommendation cache remain unchanged.

Run and observe RED:

```bash
npm --prefix frontend test -- useNotes.test.tsx
```

- [ ] **Step 2: Implement the private revision guard**

Move `buildRecommendCacheFromResponse` use into `useNotes`. Capture the source Note before the request. At apply time:

```ts
queryClient.setQueryData<Note[]>(NOTES_QUERY_KEY, (notes = []) =>
  notes.map((note) =>
    note._id === noteId && note.revision === source.revision
      ? { ...note, recommendCache: nextCache }
      : note
  )
);
```

This guarded field-only write is private and is the Spec's sole exception to full canonical Note replacement.

- [ ] **Step 3: Narrow the drawer and page wiring**

Change the drawer callback call from three arguments to only `currentNote._id`. Delete the page's direct `authFetch`, recommendation request, `buildRecommendCacheFromResponse`, and partial cache update callback. Pass `useNotes().refreshRecommendCache` directly.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
npm --prefix frontend test -- useNotes.test.tsx
npm --prefix frontend run typecheck
```

Expected: green.

---

### Task 7: Remove obsolete Interface, audit scope, and verify

**Files:**

- Modify: `frontend/src/app/notes/hooks/useNotes.ts`
- Modify: `frontend/src/app/notes/hooks/useNoteEditor.ts`
- Modify: `frontend/src/app/notes/components/ModernNoteCard.tsx`
- Modify: `frontend/src/app/notes/page.tsx`
- Modify: `frontend/src/types/index.ts` only if required to keep the canonical Note shape accurate.
- Review: all files changed by Tasks 1–6.

**Interfaces:**

- Final `useNotes` exposes notes/loading, create/update/delete, recommendation refresh, and optional explicit refetch only.
- No raw cache setter or field-specific updater remains.

- [ ] **Step 1: Delete compatibility methods only after caller proof**

Run:

```bash
rg -n "setNotes|updateTitle|updateContent|updateKeywords|updateRecommendCache|onEnrichmentPending|\.enriching" frontend/src/app/notes frontend/src/types/index.ts
```

Classify every match. Delete the public raw setter, field-specific update callbacks, temporary `enriching` type/reads, and obsolete imports. Rendering uses canonical `note.enrichment?.status === 'pending'`.

Expected final matches: UI-local setter names unrelated to the Note cache are allowed only after manual inspection; no listed Note cache Interface remains.

- [ ] **Step 2: Confirm HTTP and timer ownership with `rg`**

```bash
rg -n "authFetch|semantic-notes|enrichmentPoll|setQueryData" \
  frontend/src/app/notes/page.tsx \
  frontend/src/app/notes/hooks/useCreateNote.ts \
  frontend/src/app/notes/hooks/useNoteEditor.ts \
  frontend/src/app/notes/components/ModernNoteCard.tsx \
  frontend/src/app/notes/hooks/useNotes.ts
```

Expected:

- Note HTTP and Note `setQueryData` matches are confined to `useNotes.ts`;
- no page polling map/timer remains;
- editor/create/card do not import `authFetch`.

- [ ] **Step 3: Run focused Note frontend tests**

```bash
npm --prefix frontend test -- \
  useNotes.test.tsx \
  useNotesPolling.test.tsx \
  useCreateNote.test.tsx \
  useNoteEditor.test.tsx \
  useNoteEditorCachePropagation.test.tsx \
  recommendCache.test.ts
```

Expected: all pass with no unhandled React update/timer warning.

- [ ] **Step 4: Run complete verification in a fresh shell**

From repository root:

```bash
npm run verify
npm --prefix frontend run lint
npm --prefix frontend run build
git diff --check
```

Expected: backend/frontend tests and typechecks pass; lint/build/diff check pass. Do not hide warnings. Record exact test counts and warnings.

- [ ] **Step 5: Review scope and report**

Compare final diffs against both the Phase 2 Spec and the pre-task dirty-worktree snapshot. The final report must include:

- each completed slice;
- final public Note data Interface;
- test counts and verification commands;
- any deviation with reason;
- explicit confirmation of no commit/push and no unrelated subsystem edits;
- request for acceptance sent back to the originating task.
