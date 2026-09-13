# Task 12 report — cursor-paginated Notes pages

## Result

Migrated the Notes list cache from one `Note[]` query result to cursor-backed `InfiniteData<NotePage>`. The Notes page now starts from the backend's 30-note page, flattens only loaded pages in stable de-duplicated order, and exposes an explicit, keyboard-accessible `加载更多笔记` action. It never uses automatic scroll loading or prefetches unknown cursors.

Implementation commit: `8c7ce2171a037d84e2da7988d05333b6775a39cf` (`feat(notes): render cursor-paginated note pages`).

## Takeover state

The prior worker left uncommitted changes in `useNotes.ts`, `useNotes.test.tsx`, `notePages.ts`, and `notePages.test.ts`. The helper/query migration was retained after review because it separated page transport from mutations and kept page metadata immutable. The inherited hook test rewrite had dropped most prior coverage, and polling plus editor-cache tests still wrote the legacy array cache into a now-infinite query; those fixtures caused runtime failures and were converted to `NotePages`. Coverage was restored around writes, optimistic rollback, stale GET protection, recommendation refresh, polling, and the explicit UI states.

## Implementation

- Added pure page-cache helpers for flattening, canonical revision/enrichment selection, in-page mapping, prepend/deduplication, and removal across loaded pages while preserving `pageInfo` and `pageParams`.
- Replaced `useQuery` with `useInfiniteQuery`, using `?limit=30` and `pageInfo.nextCursor`; `loadMore` only calls `fetchNextPage` when a cursor exists and no next-page request is already active.
- Preserved canonical write precedence, temporary create insertion/rollback, delete behavior, AI-preference updates, polling, list-generation cancellation, and stale GET protection across page caches.
- Updated the editor-cache propagation and polling suites to seed/read `InfiniteData`, rather than relying on the removed array cache shape.
- Added Notes-page controls for loading, failure/retry, disabled while loading, and an announced all-pages-loaded state. The action uses the project 44px target contract (`min-h-11 min-w-11`) and uses no new animation.
- Kept Task 11's endpoint-loaded highlighted-note insertion independent of the Notes page cache and pagination state.

## RED / GREEN evidence

- **Takeover RED:** `cd frontend && npm test -- src/app/notes/hooks/notePages.test.ts src/app/notes/hooks/useNotes.test.tsx src/app/notes/hooks/useNotesPolling.test.tsx src/app/notes/page.test.tsx` initially had all 7 polling tests fail with `TypeError: Cannot read properties of undefined (reading 'length')`; the polling suite was still seeding `Note[]` into `useInfiniteQuery`.
- **UI RED:** after adding the page-level pagination expectation, `cd frontend && npm test -- src/app/notes/page.test.tsx` failed because no accessible button named `加载更多笔记` existed.
- **Focused GREEN:** `cd frontend && npm test -- src/app/notes/hooks/useNotes.test.tsx src/app/notes/hooks/notePages.test.ts src/app/notes/hooks/useNotesPolling.test.tsx src/app/notes/page.test.tsx` passed 30 tests.
- **Notes GREEN:** `cd frontend && npm test -- src/app/notes` passed 13 files and 83 tests, including the dependent editor-cache suite.

## Verification

| Command | Result |
| --- | --- |
| `cd frontend && npm test` | PASS — 36 files, 224 tests |
| `cd frontend && npm run lint` | PASS |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm run build` | PASS |
| `git diff --check` | PASS |

Backend source was not changed, so no backend verification was required for this frontend cache/UI task.

## Risks / follow-up

- Cursor pagination intentionally retains page sizes after optimistic insertion/removal rather than redistributing loaded pages; the backend cursor remains the source of truth on a later refetch.
- The production build still reports `/notes` at 470 kB first-load JS. The plan assigns editor-loading and bundle-budget remediation to Tasks 13 and 14; this task does not add another automatic preload path.

## Hashes

- Starting revision: `f0505d5d92e64b14e44a5b8c2637555d37c195a6`
- Implementation: `8c7ce2171a037d84e2da7988d05333b6775a39cf`
