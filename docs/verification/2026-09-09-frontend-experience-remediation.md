# Frontend experience remediation verification

Date: 2026-09-14

## Automated gates

| Command | Result |
| --- | --- |
| `cd frontend && npm run lint` | PASS |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm test` | PASS, 39 files and 268 tests |
| `cd frontend && npm run build` | PASS |
| `cd frontend && npm run test:a11y` | PASS, 3 core-state tests |
| `cd frontend && npm run check:route-budgets` | PASS, `/notes` 231.0 kB and 45.1% reduction |
| `cd backend && npm run typecheck` | PASS |
| `cd backend && npm test` | PASS, 168 tests |
| `cd backend && npm run build` | PASS |
| `git diff --check` | PASS |

The production build writes its route table to `frontend/.next-route-sizes.txt`. The budget parser is deliberately fail-closed: it rejects a missing `/notes` row, an unparsable First Load JS column, a value above 300 kB, or a reduction below 25% from the 421 kB baseline. Parser unit coverage passed 3 cases, including the missing-row path.

## Bundle result

| Measurement | Before Task 14 | Final production build |
| --- | ---: | ---: |
| `/notes` route size | 308 kB | 69.6 kB |
| `/notes` First Load JS | 470 kB | 231 kB |
| Required First Load JS ceiling | 300 kB | 231 kB |
| Reduction from 421 kB reference | not met | 45.1% |

The entry bundle previously pulled the full Tiptap schema and read-only viewer into `/notes`. Draft recovery now validates the persisted document structurally at the route boundary, including supported ProseMirror content placement, leaves, and marks, while the editor and viewer retain their separate dynamic imports. Direct root text, block marks, invalid nested block/inline nodes, leaf content, and valid-boundary recovery are covered without importing Tiptap at runtime. Existing malformed-draft recovery, quick-capture, editor intent, pagination, polling, and conflict suites remain green.

## Accessibility gate and upstream corrections

`axe-core` runs stable renders for TopNavigation, all Auth modes, both Memory edit and delete dialogs, the Notes delete dialog, the mobile Chat drawer, Profile feed, and Note-card actions. The Notes dialog test additionally verifies the shared modal lifecycle: labelled modal role, initial focus, focus trap, Escape/overlay close policy, focus return to the invoker, closed-DOM removal, and 44px actions. The suite also asserts Chat drawer focus restoration, which static axe rules cannot infer. It excludes color contrast because jsdom has no layout/canvas color compositor, route-landmark checks because components are rendered as isolated fixtures, and Floating UI's generated hidden focus guards.

The initial RED run identified two real defects:

- Auth applied `role="tabpanel"` to a native form. It now uses a panel wrapper around the native form and preserves roving tabs and form submit behavior.
- The Note AI participation action applied `aria-pressed` to a `menuitem`. It is now a plainly named menu action, matching its "change to" label.

Focused regressions and the full axe suite passed after those corrections.

The style contract now rejects raw hexadecimal, RGB/RGBA, and HSL/HSLA colors in active business route/component styles (there are no business-style exemptions), and rejects `transition: all`. The affected Notes and Chat modules consume semantic or component tokens; remaining animations/transitions have typed properties and reduced-motion coverage.

## Visual and manual matrix

Browser inspection of the production build verified the Auth compact-card surface at 320×800 and 1440×900: labels, mode tabs, inputs, password action, primary action, and footer links remained readable with no visible horizontal overflow. The 320px capture also exercised the required compact-card direction rather than Apple-specific visual values.

Automated, deterministic coverage supplies the remaining available matrix evidence: semantic light/dark contrast and focus contracts, 44px target contracts, reduced-motion contracts, long Chinese Note title fixture, responsive navigation contract, Profile atmosphere resolver inputs (default, light, saturated, malformed, and very dark), and Profile's occurrence-level decorative-token allowlist.

The local production server had no authenticated seeded 251-note or 1000-note account, no browser-driven theme toggle, and no VoiceOver session. Consequently those live checks, plus full route-by-route 320/390/768/1440 and three rendered Profile-atmosphere screenshots, remain **pending root verification**. This is an open manual P1 acceptance requirement, not a waived automated failure. Automated gates did not report a P0/P1, but no final zero-P1 ruling can be made until the root verification matrix is completed.

## Impeccable acceptance review

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Accessibility | Automated pass | Axe core states, dialog lifecycle tests, semantic contrast tests, focus restoration, and named controls pass; VoiceOver remains pending root verification. |
| Performance | Automated pass | `/notes` is 231 kB first-load, cursor pages limit initial content, and editor/viewer are split. |
| Responsive | Pending root verification | Source contracts plus 320px/1440px production inspection pass; the complete live route matrix needs seeded data. |
| Theming | Pending root verification | Light/dark semantic tokens and Profile decorative-only atmosphere allowlist pass; live dark/profile screenshots remain manual. |
| Anti-patterns | Automated pass | Shared semantics, color-token, and typed-motion contracts pass; legacy editor-token material remains isolated from business surfaces. |
| **Final acceptance** | **Pending root verification** | The manual P1 matrix is open. Do not infer a zero-P1 ruling from executable gates alone. |

The Impeccable skill bootstrap could not execute its repository audit because this worktree has no `PRODUCT.md` and its required setup directs creation of one. Creating that product artifact is outside Task 14 scope, so this report records the limitation rather than inventing the missing project context.

## Residual risks

- Dynamic viewer loading briefly uses an accessible `role="status"` placeholder before rich content hydrates; the dynamic import is required to keep the first-load budget binding.
- The manual-only live matrix should be repeated against authenticated 251- and 1000-note fixture accounts, three Profile atmosphere values, system dark mode, 200% zoom, and VoiceOver before a user-facing release.

## Fix-round ruling and cost

The remediation was reopened to fix acceptance defects rather than waive them. The cost is deliberate: a static validator mirrors the supported editor grammar without reintroducing Tiptap to `/notes`; delete intent carries an opener ref through the Notes menu/card/page boundary; and active business styles use component tokens instead of raw literal colors while naming transitioned properties. Reintroducing the runtime schema, retaining a custom destructive overlay, or broadly allowlisting violations would conflict with the bundle, accessibility, and style constraints.

## Hashes

- Task 14 start: `083cd8ec559e5a824f80fdb27068b878a83aa189`
- Task 14 implementation: `7e49066d5a41bda0e90b2edb122e56352ea58663` (amended below only to record its final hash).
- Task 14 fix round 1 implementation: `3d5cca17b2ffc35fd24a63b3029d6fe21d187324`
