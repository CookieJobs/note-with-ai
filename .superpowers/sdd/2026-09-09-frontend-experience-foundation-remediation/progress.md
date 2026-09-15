# SDD ledger — plan: docs/superpowers/plans/2026-09-09-frontend-experience-foundation-remediation.md

Workspace: `/Users/liujin/Documents/noteWithAI/.worktrees/frontend-experience-remediation`
Branch: `codex/frontend-experience-remediation`
Start commit: `d09b8c0`
Spec: `docs/superpowers/specs/2026-09-09-frontend-experience-foundation-remediation-design.md`

## Baseline

- Frontend: 27 files, 163 tests passed.
- Backend: 151 tests passed.
- Dependency install reported existing audit findings: frontend 10 (1 low, 4 moderate, 4 high, 1 critical); backend 4 (3 moderate, 1 high). No automatic audit fix authorized or applied.

## Preflight consistency scan

| Task(s) | Producer / consumer or self-consistency check | Finding |
|---|---|---|
| 1 | Creates semantic tokens, font order, reduced-motion and style-contract test | Internally consistent; later visual tasks consume these tokens. |
| 1 → 9 | Task 9 extends Task 1 style-contract coverage to migrated business styles | Clean; Task 1 only gates foundation files, Task 9 adds the migration allowlist. |
| 2 | Adds Dialog/Drawer/Menu/FormField and their behavior tests | Internally consistent; dependency change and lockfile are both named. |
| 2 → 3 | Menu primitives support account trigger and focus restoration | Clean; TopNavigation preserves route behavior. |
| 2 → 4 | Dialog and Button support Memory confirmations | Clean; evidence expansion remains correctly non-modal. |
| 2 → 5 | Drawer supports mobile Chat history while desktop keeps an aside | Clean; CSS-hidden duplicate surfaces must not both appear in the accessibility tree. |
| 2 → 6 | Menu and Button support note-card secondary actions | Clean; card business mutations stay in ModernNoteCard. |
| 2 → 7 | FormField/Button support Auth semantics | Clean; HTTP payloads and redirects are explicitly preserved. |
| 3 | Tests match semantic markup and responsive CSS described by implementation steps | Internally consistent. |
| 3 → 14 | Navigation semantics and responsive layout enter final accessibility/visual matrices | Clean. |
| 4 → 9 | Memory semantics are fixed before its stylesheet is token-normalized | Clean; Task 9 must preserve Task 4 variants and dialog behavior. |
| 4 → 14 | Memory dialogs and primary action enter final axe/manual checks | Clean. |
| 5 → 9 | Chat behavior is fixed before chat styles are token-normalized | Clean; Task 9 must not reintroduce transform-only hiding. |
| 5 → 14 | Chat mobile drawer and input enter final accessibility matrix | Clean. |
| 6 → 9 | Note-card structure precedes token normalization | Clean; Task 9 migrates appearance without moving action ownership. |
| 6 → 13 | Note-card motion is bounded after responsive/action structure stabilizes | Clean; Task 13 may remove animation only, not alter note mutations. |
| 6 → 14 | Long titles, touch targets and action menus enter final visual/axe checks | Clean. |
| 7 | Tests cover all Auth modes; code step preserves endpoints, countdown, validation and redirects | Internally consistent. |
| 7 → 14 | Auth modes and errors enter final accessibility and visual checks | Clean. |
| 8 | Resolver interface, safety tests, markup and styles are all named | Internally consistent. |
| 8 → 14 | Three atmosphere themes enter final visual verification | Clean. |
| 9 | Creates RelationshipCue, migrates named route styles, and expands raw-color gate | Internally consistent; no new relationship data is invented. |
| 9 → 11 | RelationshipCue may be reused when RelatedNotesDrawer later switches data source | Clean; Task 11 must preserve truthful labels and remove numeric diagnostics. |
| 10 | Cursor codec, page service, HTTP contract, preference batching and Publish consumers change together | Internally consistent; `data.notes` remains readable before Task 12 starts consuming `pageInfo`. |
| 10 → 12 | Produces NotePage/pageInfo contract consumed by useInfiniteQuery | Clean; exact cursor and page signatures match. |
| 10 → 14 | Page size and route behavior feed bundle/DOM validation | Clean. |
| 11 | Backend summary endpoint and frontend validator/drawer migrate in one task | Internally consistent; ownership and stale-cache tests are specified. |
| 11 → 12 | Drawer no longer requires all loaded notes before pagination lands | Clean and correctly ordered. |
| 11 → 14 | Human-readable relations and absence of numeric scores enter final checks | Clean. |
| 12 | Pure InfiniteData helpers precede hook migration and UI load-more | Internally consistent; mutation/polling concurrency tests are named. |
| 12 → 13 | Notes page and tests are shared; Task 13 changes preload and animation only | Clean; Task 13 must retain pagination behavior. |
| 12 → 14 | Initial card count and long-account behavior enter final budgets | Clean. |
| 13 | Preload tests, intent wiring and motion changes share the named page/loader/style files | Internally consistent. |
| 13 → 14 | No fixed preload timer and reduced motion enter final gates | Clean. |
| 14 | Adds axe, route-budget scripts, verification evidence and full commands | Internally consistent; parser must fail closed when the `/notes` row is absent. |

No preflight conflicts require a ruling.

## Task progress

- Task 1: fix round 1/5 (3 addressed, 0 open — opaque focus ring, tertiary text contrast, contrast/dark-token contract tests; commit 12bbfef)
- Task 1: complete (commits d09b8c0..12bbfef, review clean)
- Task 2: fix round 1/5 (1 addressed, 0 open — MenuTrigger/MenuItem 44px touch targets; commit fd869f3)
- Task 2: complete (commits 12bbfef..fd869f3, review clean)
- Task 3: fix round 1/5 (1 addressed, 0 open — chat mobile menu trigger 44px target; commit a3a0943)
- Task 3: complete (commits fd869f3..a3a0943, review clean)
- Task 4: fix round 1/5 (1 addressed, 1 open — dark action contrast fixed; disabled contrast test still incomplete; commit 00b18eb)
- Task 4: fix round 2/5 (1 addressed, 0 open — disabled active-token composite contrast test; commit 1fce7f6)
- Task 4: complete (commits a3a0943..1fce7f6, review clean)
- Task 5: Ruling: allow the smallest typed ref plumbing through ChatPage and TopNavigation if required for deterministic drawer focus restoration — the opener lives outside the Task 5 file list, and selector-based focus recovery would be brittle — cost if wrong: a slightly broader diff may touch already-reviewed navigation code and therefore requires focused navigation regression tests.
- Task 5: fix round 1/5 (3 addressed, 0 open — drawer focus restoration, dark disclaimer contrast, scoped motion; commit d394db9)
- Task 5: complete (commits 1fce7f6..d394db9, review clean)
- Task 6: fix round 1/5 (2 addressed, 0 open — card reduced-motion coverage and real keyboard action tests; commit 4edb854)
- Task 6: complete (commits d394db9..4edb854, review clean)
- Task 7: fix round 1/5 (1 addressed, 0 open — Auth tabs use tested roving tabindex; commit b88eec9)
- Task 7: complete (commits 4edb854..b88eec9, review clean)
- Task 8: fix round 1/5 (1 addressed, 1 open — atmosphere moved off text surfaces and 44px targets fixed; guard incomplete; commit 745ae13)
- Task 8: fix round 2/5 (1 addressed, 0 open — complete selector/property atmosphere allowlist; commit f5caa29)
- Task 8: complete (commits b88eec9..f5caa29, review clean)
- Task 9: fix round 1/5 (2 addressed, 0 open — route primary controls raised to 44px and raw-hex exceptions narrowed to declaration-aware rules; commit 916d81d)
- Task 9: fix round 2/5 (2 addressed, 0 open — Memory save action covered and atmosphere selectors made exact; commit 94af3c0)
- Task 9: fix round 3/5 (1 addressed, 0 open — removed wildcard syntax selector allowance and added hostile-selector regression coverage; commit 0a8eff6)
- Task 9: complete (commits f5caa29..34ca32f, review clean)
- Task 10: complete (commits 34ca32f..033aa1d, review clean — stable cursor pagination, owned single-note route, and batched AI preferences verified)
- Task 11: fix round 1/5 (4 addressed, 0 open — unloaded candidate navigation, source-keyed results, bounded summaries, 44px candidate links; commit f53f572)
- Task 11: fix round 2/5 (2 addressed, 0 open — atomically keyed request state and independent validator boundary tests; commit 413133f)
- Task 11: fix round 3/5 (2 addressed, 0 open — isolated invalid-calendar timestamp test and corrected verification count; commits 358ff3a, f0505d5)
- Task 11: complete (commits 033aa1d..f0505d5, review clean)
- Task 12: fix round 1/5 (2 addressed, 1 open — stale new-cursor responses now cancel; deletion race added; historical regression restoration still incomplete; commit 54723d7)
- Task 12: fix round 2/5 (3 addressed, 0 open — restored 16 historical hook regressions, added five deferred next-page write races, corrected verification evidence; commits 373a42f, c29b6ce, 41e2e56, 42e6450)
- Task 12: complete (commits f0505d5..42e6450, review clean — 35 hook cases and 246 full frontend tests)
- Task 13: complete (commits 42e6450..083cd8e, review clean — intent-driven editor preload, bounded list motion, and 254 full frontend tests)
- Task 14: Ruling: reopen the smallest Task 6/7 and Notes bundle boundaries required by the final axe and route-budget gates — final acceptance exposed invalid Auth/menu ARIA and a 470 kB Notes first-load path — cost if wrong: already-reviewed components are touched and therefore require focused regression, axe, full-suite, and route-budget re-verification.
- Task 14: fix round 1/5 (5 addressed, 0 automated open — schema grammar validation, shared Notes delete Dialog, Memory delete axe coverage, expanded color/motion gates, honest manual-matrix status; commits 3d5cca1, 1eb15a0)
- Task 14: fix round 2/5 (3 addressed, 0 automated open — underline/empty-text schema parity, direct-TSX color enforcement, exact route exclusions; commits 8e4cf3d, 8c2d04a)
- Task 14: fix round 3/5 (1 addressed, 0 automated open — self-checking seven-route TSX manifest including all Publish pages; commits ff4f32e, 68b045e)
- Task 14: automated acceptance complete (commits 083cd8e..68b045e, review clean — 276 frontend tests, 168 backend tests, axe/build/budget green; manual matrix pending root verification)
- Task 14: ruling authorized the smallest upstream Auth/Note ARIA corrections and a scoped Notes code-splitting remediation after axe found invalid panel/menu ARIA and the production bundle measured 470 kB. Fix round 1 additionally hardens the schema-free draft grammar, migrates the Notes destructive flow to the shared dialog contract, and turns raw-color/`transition: all` findings into active style gates. Cost: static grammar duplication without a runtime Tiptap import, opener-ref plumbing through Notes interactions, and component-token migration; no threshold was weakened. Executable acceptance is green: axe gate, `/notes` 231 kB First Load JS (45.1% reduction), frontend 276 tests, backend 168 tests, builds/typechecks/lint/diff check. The seeded-account, three-theme, dark-mode, zoom, and VoiceOver visual matrix is **pending root verification**; it is an open manual P1 acceptance requirement, so no final zero-P1 ruling is recorded.
- Task 14 fix round 2: added static underline coverage and empty-text rejection, plus a scoped SCSS/TSX raw-color gate for the approved seven-route matrix and its listed shared route components. Public `/p/[slug]`, user-owned Admin, and Profile's separately-constrained decorative atmosphere resolver are intentionally excluded; no repository-wide color claim is made.
- Task 14 fix round 3: added a direct-page source manifest and regression assertion for every declared core route, including `/publish`, `/publish/select`, and `/publish/[noteId]`.
- Task 14 live matrix: initial 24-combination run found sub-44px controls; automated fix rounds 4/5 and the keyword semantic fix resolved them. Post-fix Notes/Chat/Memory/Inspiration/Profile/Publish at 320/390/768/1440 had no horizontal overflow and no visible in-scope anchor/button below 44×44px.
- Task 14 live matrix: 1000-note fixture verified 30-note initial render and duplicate-free 60-note append; 251-note fixture reached 251/251 unique notes with terminal pagination; three Profile atmosphere fixtures, Auth roving tabs, Notes Dialog, and Chat Drawer keyboard/focus paths passed.
- Task 14 manual status: after explicit authorization, Chrome under actual macOS dark appearance passed visible/computed-token verification; an actual VoiceOver Auth keyboard/semantic path passed and VoiceOver was restored to off. Equivalent 320/390 reflow and automated dark/reduced-motion contracts also passed.
- Task 14 final independent review: 7 findings closed across commits e5b784d, 646c727, and dd830c6 — reachable system dark, named Care CTA, shared URL Dialog, raw Tailwind palette enforcement, batched `aiIncluded` consumption, revision-safe related-note responses, and a 20-candidate pre-query bound.
- Task 14 final composition closure: commit 62fc3c0 gives the controlled slash-menu Dialog trigger sole pointer ownership and maps server revision drift to a retryable error without stale data.
- Task 14 final portal closure: commit 37a28a3 suspends slash-menu capture listeners while the image Dialog owns pointer, Enter, Escape, and focus behavior; independent re-review returned no findings.
- Task 14 system-dark cascade closure: the authorized Chrome pass caught zero-specificity `:where(...)` losing to base `:root`; commit b943cff adds the RED-to-GREEN regression and winning `:root:not(.light)` selector, with corrected dark tokens confirmed live.
- Task 14 explicit-dark cascade closure: independent review caught plain `.dark` losing specificity to the repaired system selector; a two-failure RED contract and equally specific `:root.dark` implementation preserve the later explicit override, followed by a fully green frontend gate.
- Task 14 final root gates: frontend 41 files / 302 tests, lint, typecheck, axe, production build and `/notes` 231.0 kB budget pass; backend 169 tests, typecheck and build pass. All required automated, live-browser, macOS dark-appearance, and VoiceOver checks are complete.
