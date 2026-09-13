# Frontend experience remediation verification

Date: 2026-09-14

## Automated gates

| Command | Result |
| --- | --- |
| `cd frontend && npm run lint` | PASS |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm test` | PASS, 38 files and 263 tests |
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

The entry bundle previously pulled the full Tiptap schema and read-only viewer into `/notes`. Draft recovery now validates the persisted document structurally at the route boundary, while the editor and viewer retain their separate dynamic imports. Existing malformed-draft recovery, quick-capture, editor intent, pagination, polling, and conflict suites remain green.

## Accessibility gate and upstream corrections

`axe-core` runs stable renders for TopNavigation, all Auth modes, Memory dialogs, the mobile Chat drawer, Profile feed, and Note-card actions. The suite also asserts Chat drawer focus restoration, which static axe rules cannot infer. It excludes color contrast because jsdom has no layout/canvas color compositor, route-landmark checks because components are rendered as isolated fixtures, and Floating UI's generated hidden focus guards.

The initial RED run identified two real defects:

- Auth applied `role="tabpanel"` to a native form. It now uses a panel wrapper around the native form and preserves roving tabs and form submit behavior.
- The Note AI participation action applied `aria-pressed` to a `menuitem`. It is now a plainly named menu action, matching its "change to" label.

Focused regressions and the full axe suite passed after those corrections.

## Visual and manual matrix

Browser inspection of the production build verified the Auth compact-card surface at 320×800 and 1440×900: labels, mode tabs, inputs, password action, primary action, and footer links remained readable with no visible horizontal overflow. The 320px capture also exercised the required compact-card direction rather than Apple-specific visual values.

Automated, deterministic coverage supplies the remaining available matrix evidence: semantic light/dark contrast and focus contracts, 44px target contracts, reduced-motion contracts, long Chinese Note title fixture, responsive navigation contract, Profile atmosphere resolver inputs (default, light, saturated, malformed, and very dark), and Profile's occurrence-level decorative-token allowlist.

The local production server had no authenticated seeded 251-note or 1000-note account, no browser-driven theme toggle, and no VoiceOver session. Consequently those live checks, plus full route-by-route 320/390/768/1440 and three rendered Profile-atmosphere screenshots, remain manual-only follow-up checks. This is an evidence limitation, not a waived automated failure; no P0/P1 was found by the executable gates.

## Impeccable acceptance review

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Accessibility | 4/4 | Axe core states, semantic contrast tests, focus restoration, and named controls pass. |
| Performance | 4/4 | `/notes` is 231 kB first-load, cursor pages limit initial content, and editor/viewer are split. |
| Responsive | 3/4 | Source contracts plus 320px/1440px production inspection pass; the complete live route matrix needs seeded data. |
| Theming | 3/4 | Light/dark semantic tokens and Profile decorative-only atmosphere allowlist pass; live dark/profile screenshots remain manual. |
| Anti-patterns | 3/4 | Shared semantics and relationship language pass; legacy editor-token material remains isolated from business surfaces. |
| **Total** | **17/20** | Good, with zero P0/P1 from executable checks. |

The Impeccable skill bootstrap could not execute its repository audit because this worktree has no `PRODUCT.md` and its required setup directs creation of one. Creating that product artifact is outside Task 14 scope, so this report records the limitation rather than inventing the missing project context.

## Residual risks

- Dynamic viewer loading briefly uses an accessible `role="status"` placeholder before rich content hydrates; the dynamic import is required to keep the first-load budget binding.
- The manual-only live matrix should be repeated against authenticated 251- and 1000-note fixture accounts, three Profile atmosphere values, system dark mode, 200% zoom, and VoiceOver before a user-facing release.

## Hashes

- Task 14 start: `083cd8ec559e5a824f80fdb27068b878a83aa189`
- Task 14 implementation: `7e49066d5a41bda0e90b2edb122e56352ea58663` (amended below only to record its final hash).
