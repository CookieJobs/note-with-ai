# Desktop UI Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The root agent implements; an independent sub agent reviews the Spec before implementation.

**Goal:** Close R1–R8 of the reviewed desktop UI repair Spec with behavior tests and browser acceptance.

**Architecture:** Keep current components and data flows. Add small pure chat-history and excerpt utilities plus a source-excerpt presentation component. Preserve parallel work and already-correct styles.

**Tech Stack:** Next.js / React / TypeScript / SCSS / Vitest / Testing Library / existing browser tools.

**Spec:** `docs/superpowers/specs/2026-10-16-desktop-ui-audit-fixes-design.md`

## Global Constraints

- Desktop Web acceptance; no mobile adaptation, new backend APIs, dependencies, real test messages, or data writes.
- Preserve optional titles, source snapshots, and all unrelated working-tree changes.
- Do not reset, migrate, push, deploy, or batch-commit the existing dirty tree.
- Record task completion in `docs/superpowers/reviews/2026-10-16-desktop-ui-audit-fixes-validation.md` for resumption.

## Review Focus

- IME Enter reported through either isComposing or keyCode 229 must not send; pin both in task 1.
- A source may exist only inside message.relatedNotes; pin in task 2.
- Untitled image-only sources must not replace a useful conversation label with an ID-only placeholder; pin in task 2.
- A source excerpt may contain HTML, Markdown, long Unicode text and repeated source IDs across items; pin safe text and reset behavior in task 3.
- /profile is not a notes route, but /notes/child is; pin both in task 4.

## Task 1: Safe editing and input (R1, R2, R3)

Files: ChatInputArea.tsx + new ChatInputArea.test.tsx; ModernNoteCard.tsx + existing test; note-card.module.scss only if current styles fail acceptance.

Interfaces: keep existing callbacks; an untitled edit button enters beginTitleEdit/established unified editor.

- [x] Add failing tests for composition/229, normal Enter, Shift+Enter, disabled/empty submission, untitled keyboard entry and cancellation without writes.
- [x] Run targeted tests and confirm expected failures; implement minimal guards and native edit button.
- [x] Verify targeted tests, existing note tests, and R3 desktop appearance. Record results.

## Task 2: Useful conversation recovery and honest suggestions (R4, R5, R6 chat)

Files: new `frontend/src/utils/chatHistory.ts` + tests; ChatHistoryPanel.tsx/tests; CareAssistantPanel.tsx/tests.

Interfaces: `getChatHistoryLabel(session: IChat): string`, `matchesChatHistoryQuery(session: IChat, query: string): boolean`.

- [x] Add failing tests for explicit/generic titles, source and message fallback order, Unicode truncation, message-level sources, content search, no selection on filtering, source/no-source/failure CTA.
- [x] Implement pure helpers, integrate consistent labels and query matching, conditional CTA, and clear source/refresh colors.
- [x] Verify component/helper tests and browser recovery of the real 飞书 sample. Record results.

## Task 3: Controlled source reading (R6 inspiration, R7)

Files: new `frontend/src/app/inspiration/utils/sourceExcerpt.ts` + tests; new `components/SourceExcerpt.tsx` + tests; inspiration/page.tsx, page.test.tsx and inspiration.module.scss.

Interfaces: a pure cleaned preview helper and `SourceExcerpt({ snippet: string })`; parent keys include inspiration ID so switching items resets expansion.

- [x] Add failing tests for 220-code-point preview, Markdown/plain-text safety, original full disclosure, independent expansion and reset on item switch.
- [x] Implement preview/disclosure; retain source links and citations; update only relevant muted text colors.
- [x] Verify targeted tests and the real ignored long-source detail. Record results.

## Task 4: Accurate navigation and full acceptance (R8, all)

Files: TopNavigation.tsx/tests; Spec, plan, validation ledger.

Interfaces: active index -1 for no match; existing matched route indices unchanged.

- [x] Add failing profile-route test and retain child-route test; implement no-match index.
- [x] Run full frontend tests, typecheck, changed-file lint, diff check.
- [x] Perform desktop browser acceptance and save current screenshots; obtain fresh final implementation review and address important findings.
- [x] Mark Spec/plan/validation complete only when R1–R8 acceptance is satisfied; stop temporary continuation automation and report actual results.
