# Task 14 report — acceptance gates and final verification

## Result

Added executable axe and route-budget gates, then used their RED evidence to correct the smallest upstream defects required for a green acceptance run. The production `/notes` first-load budget is now 231 kB, below the binding 300 kB cap and 45.1% below the 421 kB reference.

## TDD evidence

- Initial `npm run test:a11y` failed because the required test file did not exist; `npm run check:route-budgets` failed because the parser did not exist.
- The parser test initially failed to resolve `check-route-budgets.mjs`; after implementation, its 3 cases passed, including absent `/notes`, kB/MB parsing, absolute cap, and reduction floor.
- The first axe run found the invalid Auth `form[role=tabpanel]` and Note `menuitem[aria-pressed]`. Focused Auth/Card regressions failed before the fixes and passed afterward.
- The bundle guard initially exposed 470 kB First Load JS. Source-contract RED tests then failed while the Notes entry retained the Tiptap schema/viewer. Moving those imports across the existing dynamic boundary reduced First Load JS to 231 kB; draft recovery and Notes suites stayed green.

## Acceptance evidence

The final sequential run passed frontend lint, typecheck, 38 Vitest files / 263 tests, production build, axe, route budget, backend typecheck, backend 168 tests, backend build, and `git diff --check`.

## Ruling and cost

Task 14 received an explicit final-acceptance ruling to reopen only the Auth panel semantics and Note menu ARIA, and to reduce the binding bundle budget without weakening the parser. Cost: the smallest corrections touched two upstream components/tests plus Notes dynamic-import and draft-validation boundaries. Auth network payloads/redirects and Task 12/13 behavior remain covered by the full suite.

## Visual/audit limitation

Auth was inspected in the production browser at 320×800 and 1440×900. Full authenticated long-list, three-theme Profile, dark-mode, 200% zoom, and VoiceOver checks remain manual-only because the local server lacked seeded authenticated fixtures and a screen-reader session. Impeccable's prescribed bootstrap was blocked by the missing `PRODUCT.md`; its code-level acceptance score is recorded in the verification artifact as 17/20, zero P0/P1.
