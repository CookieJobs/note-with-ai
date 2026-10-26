# Desktop visual rebuild acceptance — 2026-10-18

## Scope and baseline

The user approved continuing from the visual-quality diagnosis: rebuild the desktop notes composition, then align chat arrival and related-note hierarchy. This changes presentation and content order, with no backend, data-model, title-generation, or tag changes. Other sessions' uncommitted work is preserved. The baseline is the current working copy saved under `/tmp/desktop-visual-rebuild-20261018/before/`, not Git HEAD.

The implementation plan is [2026-10-18-desktop-visual-rebuild.md](../plans/2026-10-18-desktop-visual-rebuild.md). Updated conventions live in [DESIGN.md](../../../DESIGN.md).

## Visual result

- Notes now have a cool gray outer canvas and one white reading surface, with a 900px frame aligning the heading, capture, and list. Meaningful surface boundaries restore grouping without reinstating floating navigation or nested note cards.
- Untitled notes start with prose. Optional existing titles precede content; dates and secondary actions follow. The real first short record measures 105.8px high, with 24px horizontal insets, rather than reserving an empty metadata/title band above its text.
- Capture has a writing icon, an opening affordance, and a visible white surface. Loading and expanded states keep the same frame.
- Reading and editing use 16px note prose and 1.8 leading. Paragraph spacing is 8px. Authored blank paragraphs and Shift+Enter breaks remain intact; no content normalization or deletion was introduced.
- Chat arrival puts free-form writing first. The optional suggestion is grouped below it with a heading, opening, excerpt, source and secondary action. A source-free or failed suggestion uses the neutral heading “聊聊最近”.
- Navigation uses the same restrained blue as active controls. Related references use larger readable titles/excerpts, and dates no longer consume excerpt-clamp space. Existing conversations keep a white reading column.
- Personalized profile atmosphere remains an existing feature; auth and mobile-specific redesign were outside this continuation.

## Real desktop verification

Chrome viewport: **1680 × 999**. The parent agent inspected actual user content without creating, saving, deleting notes, submitting chats, or clicking AI generation/refresh controls.

Verified short and untitled records, optional-title editing, quick capture opening/cancel, long reading/expansion, long editing with visible sticky Save/Cancel, existing chat replies and their source references. Browser measurements confirmed 16px / 28.8px for long prose in reading and editing, including existing nonempty paragraphs containing hard breaks. Quick-capture cancel restores focus to “打开快速记录”; note cancel restores the original title/edit trigger.

The note drawer was not opened against an uncached record because that can automatically refresh recommendations. Its row insets were checked in shared styles and component regressions; populated reference appearance was inspected in the existing chat panel. No new claim is made about live AI generation, a new source-return scenario, or phone layouts in this pass.

### Before / after evidence

All images are unaltered desktop captures from the same viewport size:

| View | Before | After |
| --- | --- | --- |
| Notes composition | [Before](/Users/liujin/.codex/visualizations/2026/10/08/01a11bbc-5bba-77e3-8567-e47b2688d4c5/design-diagnosis-notes-2026-10-18.png) | [After](/Users/liujin/.codex/visualizations/2026/10/08/01a11bbc-5bba-77e3-8567-e47b2688d4c5/visual-rebuild-notes-2026-10-18.png) |
| Chat arrival | [Before](/Users/liujin/.codex/visualizations/2026/10/08/01a11bbc-5bba-77e3-8567-e47b2688d4c5/design-diagnosis-chat-start-2026-10-18.png) | [After](/Users/liujin/.codex/visualizations/2026/10/08/01a11bbc-5bba-77e3-8567-e47b2688d4c5/visual-rebuild-chat-start-2026-10-18.png) |
| Chat references | [Before](/Users/liujin/.codex/visualizations/2026/10/08/01a11bbc-5bba-77e3-8567-e47b2688d4c5/design-diagnosis-chat-reading-2026-10-18.png) | [After](/Users/liujin/.codex/visualizations/2026/10/08/01a11bbc-5bba-77e3-8567-e47b2688d4c5/visual-rebuild-chat-reading-2026-10-18.png) |

Additional final captures: [Long reading](/Users/liujin/.codex/visualizations/2026/10/08/01a11bbc-5bba-77e3-8567-e47b2688d4c5/visual-rebuild-long-reading-2026-10-18.png), [Long editing](/Users/liujin/.codex/visualizations/2026/10/08/01a11bbc-5bba-77e3-8567-e47b2688d4c5/visual-rebuild-long-editor-2026-10-18.png). Chat suggestion content and chat reading scroll positions are not identical across captures; those views establish grouping and source hierarchy, not a controlled typography comparison of identical paragraphs.

## Independent review and corrections

The read-only `visual_rebuild_review` subagent reviewed the scoped working-copy diff and before/after images. It found three issues during iteration:

1. Moving footer actions after the body put “查看相关笔记” before Save/Cancel in the keyboard path. Browser reproduction confirmed Tab exited editing. Footer actions now appear only outside editing. Browser verification confirms **body → Cancel → Save** retains the editor; a regression first failed with “查看相关笔记” as the next control, then passed.
2. A generic fallback intro initially acquired a “从你的笔记继续” heading. The heading is now conditional on a source note, covered by a no-source assertion that failed before the fix and passed after it.
3. An attempted empty-paragraph selector also matched nonempty hard-break paragraphs. Both selectors were removed, preserving uniform leading. Actual existing hard-break prose was checked in reading and editing after the correction.

The reviewer rechecked all three corrections and reported no unresolved findings. Visual review found improved composition and hierarchy; it does not establish a universal aesthetic score or substitute for the user's taste judgment.

## Functional checks

- Initial notes/chat DOM-order regressions correctly failed before their implementations and passed after them.
- Final full frontend suite: **50 files, 356 tests passed** (`npm --prefix frontend test`).
- Final affected component rerun after the review fixes: **2 files, 18 tests passed**.
- Frontend typecheck passed (`npm --prefix frontend run typecheck`).
- Affected TS/TSX ESLint: **0 errors, 2 existing `next/no-img-element` warnings** on source thumbnails.
- Diff whitespace check passed. Tests still emit existing jsdom navigation/scrollTo notices. During CSS hot replacement, Next's dev HMR emitted a `removeChild` error; a fresh page load rendered successfully with the final styles. No production build or deployment is claimed.

All substantive UI behavior changes were checked before acceptance. Final CSS-only paragraph/hover corrections were verified in the real browser and independently reviewed. No commit, push, or deployment was performed.
