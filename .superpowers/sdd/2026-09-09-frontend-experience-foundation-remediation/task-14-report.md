# Task 14 report — acceptance gates and final verification

## Result

Added executable axe and route-budget gates, then used their RED evidence to correct the smallest upstream defects required for a green acceptance run. This fix round also hardens schema-free rich-draft recovery, replaces the Notes delete overlay with the shared dialog contract, and broadens style/motion contracts. The production `/notes` first-load budget remains 231 kB, below the binding 300 kB cap and 45.1% below the 421 kB reference.

## TDD evidence

- Initial `npm run test:a11y` failed because the required test file did not exist; `npm run check:route-budgets` failed because the parser did not exist.
- The parser test initially failed to resolve `check-route-budgets.mjs`; after implementation, its 3 cases passed, including absent `/notes`, kB/MB parsing, absolute cap, and reduction floor.
- The first axe run found the invalid Auth `form[role=tabpanel]` and Note `menuitem[aria-pressed]`. Focused Auth/Card regressions failed before the fixes and passed afterward.
- The bundle guard initially exposed 470 kB First Load JS. Source-contract RED tests then failed while the Notes entry retained the Tiptap schema/viewer. Moving those imports across the existing dynamic boundary reduced First Load JS to 231 kB; draft recovery and Notes suites stayed green.
- The rich-draft validator RED cases showed that a type-name whitelist accepted direct document text, marks on block nodes, nested block/inline violations, and non-leaf content. The schema-free validator now mirrors the supported ProseMirror placement, leaf, content, and mark rules without importing Tiptap into the route bundle; its valid boundary document remains accepted.
- The Notes delete confirmation RED cases showed a non-modal custom overlay. It now composes the shared dialog primitive, including a labelled modal role, focus lifecycle, Escape/overlay close policy, deterministic opener-focus restoration, removed closed DOM, 44px actions, and an axe assertion. Memory's delete dialog is now covered by axe as well.
- Style-contract RED cases exposed raw hex/RGB/RGBA/HSL/HSLA business colors and three `transition: all` declarations. Active route/component styles now consume component or semantic tokens, transitions name their properties, and affected motion has a reduced-motion path.

## Acceptance evidence

The final sequential run passed frontend lint, typecheck, 39 Vitest files / 268 tests, production build, axe, route budget, backend typecheck, backend 168 tests, backend build, and `git diff --check`.

## Ruling and cost

Task 14 was reopened rather than waiving the generated acceptance defects. This round's ruling is to preserve the dynamic editor split while making the static draft validator accurately enforce the editor's supported grammar, to use the shared dialog contract for destructive Notes actions, and to reject non-token business colors and broad transitions.

Cost: the validator duplicates the supported static grammar without a runtime Tiptap import; delete intent now carries a persistent opener ref from menu to card to page; and active Notes/Chat styles were migrated to component tokens with property-specific transitions. The rejected alternatives—adding Tiptap to the entry bundle, retaining a bespoke overlay, or broadly allowlisting raw colors—would violate the binding budget, accessibility, or style-contract requirements. Task 12/13 behavior remains covered by the full suite.

## Visual/audit limitation

Auth was inspected in the production browser at 320×800 and 1440×900. Full authenticated long-list, three-theme Profile, dark-mode, 200% zoom, and VoiceOver checks remain **pending root verification** because the local server lacked seeded authenticated fixtures and a screen-reader session. The manual P1 acceptance matrix is therefore open: this report makes no final zero-P1 claim. Impeccable's prescribed bootstrap was blocked by the missing `PRODUCT.md`; creating that product artifact remains outside Task 14 scope.
