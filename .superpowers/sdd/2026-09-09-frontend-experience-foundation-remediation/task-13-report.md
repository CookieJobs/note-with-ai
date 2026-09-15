# Task 13 report — intent-driven editor loading and bounded list motion

## Result

The Notes page no longer schedules a RichTextEditor import on mount, idle time, or a fixed timeout. It starts the existing dynamically split editor only after an explicit capture or edit intent: pointer hover, focus, touch, Enter/Space, capture open, or a card-content interaction captured before content editing.

`preloadRichTextEditorFromIntent()` joins the loader's shared import promise, and the page additionally sends only one preload request per mounted Notes page. Dynamic editor loading and its fallback remain unchanged.

The former whole-list Framer Motion `layout` spring is gone. Only the first eight visible inserted/deleted cards use a short opacity/transform transition; later loaded pages do not gain entrance work. With reduced motion requested, every card uses an immediate no-motion path. Unused filter-heavy shard/crowd and wobble keyframes were removed from the Notes page styles.

Implementation commit: `195fe07fd785a2a1f716525611bee390a74d95ec` (`perf(notes): load editor on intent and bound list motion`).

## RED / GREEN evidence

- **RED:** `cd frontend && npm test -- src/app/notes/page.test.tsx` failed 8 new cases against the old code: a timer invoked preload after 1201ms, hover/focus/touch/keyboard had no intent path, the combined interaction did not open the editor as asserted, and list cards had no bounded/reduced-motion state.
- **Focused GREEN:** `cd frontend && npm test -- src/app/notes/page.test.tsx` passed 15 tests after the intent, deduplication, motion-bound, and reduced-motion changes.
- **Notes GREEN:** `cd frontend && npm test -- src/app/notes` passed 13 files and 115 tests, including Task 12's cursor-pagination suites.

## Verification

| Command | Result |
| --- | --- |
| `cd frontend && npm test -- src/app/notes` | PASS — 13 files, 115 tests |
| `cd frontend && npm run lint` | PASS |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm test` | PASS — 36 files, 254 tests |
| `cd frontend && npm run build` | PASS — `/notes` 308 kB route / 470 kB first-load JS |
| `git diff --check` | PASS |

The final source observation found no preload timer or idle callback. The remaining `setTimeout` in `page.tsx` schedules highlight scrolling only; it does not reference the editor loader.

## Risks / follow-up

- The current `/notes` production first-load figure remains 470 kB. This task prevents an unsolicited editor fetch; Task 14 owns the broader final bundle budget and route-observation acceptance.
- The eight-card bound deliberately avoids animating appended cursor pages. A later product requirement for in-view page-entry feedback should use a viewport-aware, equally bounded treatment rather than restoring whole-list layout animation.

## Hashes

- Starting revision: `42e6450cff9cbdfffc2b9d7086b017b3962470eb`
- Implementation: `195fe07fd785a2a1f716525611bee390a74d95ec`
