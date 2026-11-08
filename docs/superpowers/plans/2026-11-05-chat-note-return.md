# Chat note return implementation plan

**Goal:** Implement the user-approved HTML interaction, then delete `design-preview/chat-note-return/index.html`.

**Architecture:** Keep the existing per-account, per-tab, 30-minute conversation/draft/scroll snapshot. Mark note visits with `fromChat=<sessionId>`, validate against that snapshot without consuming it, and propagate the marker when opening related notes. Render a fixed return strip outside the note scroller; navigation uses the existing editor guard and explicit chat session URL.

**Tech stack:** Next.js, React, TypeScript, SCSS, Vitest/Testing Library.

**Approved design:** In this chat: a return button and original conversation title remain visible while reading/editing notes; related-note visits keep the same origin; returning restores draft/scroll; dirty editors require save/discard/cancel. Ordinary note entry has no return strip. Existing “和 AI 讨论” retains its new-discussion behavior.

## Constraints and review focus

- No backend or deployment changes; preserve unrelated preview work.
- Never display another account's context or consume the snapshot while reading notes.
- Reject expired, malformed, missing or mismatched snapshots; direct note URLs are ordinary entry.
- Related-note navigation and refresh retain the original session; compose/list navigation exits the return flow.
- Return must wait for editor save acknowledgement; failure/cancel keeps the editor.
- Explicit missing chat sessions retain existing error behavior instead of opening another session.

## Tasks

- [x] Add utility regression tests for non-consuming snapshot reads, title metadata, expiry, account isolation and malformed storage. Run them red; implement `readChatSourceReturn(userId)` and reuse it from `takeChatSourceReturn`.
- [x] Extend chat-entry tests to assert origin-bearing note URLs, title preservation and explicit-session restoration. Run red; update the central source-note entry for cards, links, related sidebar and drawer.
- [x] Add notes-page tests for contextual return, related hops, refresh, direct entry, invalid snapshots and guarded navigation. Run red; implement return strip and responsive/theme-aware styles; use existing navigation protection.
- [x] Run frontend tests/typecheck/lint/build and browser checks for desktop/mobile, related hops, draft/scroll restoration, editor protection and dark theme. Review diff, update page documentation and remove only this feature's HTML prototype after validation.

## Progress

- Initial repository: `main`, no tracked product changes; unrelated preview changes remain untouched. Work continues on `codex/chat-note-return` in the current checkout.

- Verification: 64 frontend test files / 580 tests passed; TypeScript passed; ESLint passed with 10 existing warnings; isolated production build and route budgets passed.
- Browser checks (fixture API, actual Next/React pages): fixed bar during long-note scroll; related-note hop/reload; exact draft and scroll restoration; cancel, failed save/retry, saved return, discarded return; dark/mobile rendering; ordinary entry without a bar. No page errors. No real note writes, AI calls or deployment.
- Removed the approved throwaway HTML after validation.
