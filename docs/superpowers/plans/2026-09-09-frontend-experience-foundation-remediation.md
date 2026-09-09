# Frontend Experience Foundation Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every P1 and P2 item in the approved frontend experience foundation spec while preserving existing NoteWithAI business behavior.

**Architecture:** Build one semantic token and interaction-primitive layer, migrate shared navigation and the seven core pages onto it, then replace the all-at-once notes list with a cursor-paginated contract. Profile atmosphere colors remain a constrained decorative layer; Auth retains its compact single-card structure but consumes the shared NoteWithAI system.

**Tech Stack:** Next.js 15.5, React 18, TypeScript, SCSS Modules, Tailwind CSS 3, TanStack Query 5, Radix primitives, Vitest/Testing Library, Express 5, Mongoose 8, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-09-frontend-experience-foundation-remediation-design.md`

## Global Constraints

- WCAG 2.2 AA is the baseline; normal text contrast is at least 4.5:1 and meaningful controls/graphics at least 3:1.
- The product uses 44×44 CSS px as its own primary touch-target baseline; do not describe 44px as the WCAG 2.2 AA minimum.
- Support 320, 360, 390, 768, 1024, and 1440px widths plus 200% zoom.
- Keep Profile atmosphere colors, but only through `--atmosphere-accent`, `--atmosphere-soft`, and `--atmosphere-glow`; they may not control text, actions, focus, or status colors.
- Keep Auth login/register/reset behavior and compact card structure; replace Apple-specific visual values with shared NoteWithAI tokens.
- Preserve quick-capture draft recovery, revision conflict handling, recommendation refresh, and enrichment polling behavior.
- Do not add social features, a user theme marketplace, or unrelated backend refactors.
- Avoid new raw color literals in business-page styles. Components consume semantic or component tokens.
- All non-essential animation must be disabled by `prefers-reduced-motion: reduce`; do not add `transition: all`.
- Stage only files owned by the current task. Existing changes in `.env.local`, Admin files, `.impeccable/`, `PRODUCT.md`, `docs/archify/`, `docs/product-review-2026-09-06.md`, and `web-app-rendered.html` belong to the user.
- Each task follows red-green-refactor and ends with a focused commit.

## File and Interface Map

### New frontend units

- `frontend/src/components/ui/dialog.tsx`: Radix-backed modal and drawer primitives with labelled content and focus restoration.
- `frontend/src/components/ui/form-field.tsx`: persistent label, description, and error wiring for form controls.
- `frontend/src/components/ui/menu.tsx`: keyboard-operable popover menu wrapper for account and card actions.
- `frontend/src/components/ui/relationship-cue.tsx`: shared source/relationship visual language.
- `frontend/src/styles/reduced-motion.scss`: global motion fallback.
- `frontend/src/app/notes/hooks/notePages.ts`: `InfiniteData<NotePage>` cache helpers so optimistic writes remain isolated from transport shape.
- `frontend/src/app/notes/services/relatedNotes.ts`: fetch and validate relationship-summary responses.

### New backend units

- `backend/services/noteListCursor.ts`: encode/decode stable `{ createdAt, id }` cursors.
- `backend/services/relatedNoteSummaryService.ts`: return owned candidate summaries for one owned source note.

### Shared interfaces

```ts
export interface NotePage {
  notes: Note[];
  pageInfo: { hasNextPage: boolean; nextCursor: string | null };
}

export interface RelatedNoteSummary {
  id: string;
  title: string;
  contentText: string;
  createdAt: string;
  type: string;
  reason: string;
  scoreBand: 'possible' | 'supported';
}

export interface AtmosphereTokens {
  accent: string;
  soft: string;
  glow: string;
}
```

---

## Work Package A — P1 Correctness and Accessibility

### Task 1: Establish semantic tokens, typography, focus, and reduced motion

**Files:**
- Modify: `frontend/src/styles/globals.scss`
- Modify: `frontend/src/styles/_variables.scss`
- Create: `frontend/src/styles/reduced-motion.scss`
- Modify: `frontend/src/app/layout.tsx`
- Test: `frontend/src/styles/style-contract.test.ts`

**Interfaces:**
- Produces CSS custom properties named `--color-text-*`, `--color-surface-*`, `--color-border-*`, `--color-action-*`, `--color-status-*`, `--focus-ring`, `--radius-*`, and `--motion-*`.
- Produces `.focus-ring` and global reduced-motion behavior consumed by later tasks.

- [ ] **Step 1: Write the failing style-contract test**

Read the stylesheet text and assert that semantic tokens, a Chinese-capable font stack, the reduced-motion media query, and no `transition: all` exist in the new foundation files. Use `readFileSync(new URL(..., import.meta.url), 'utf8')` so the test does not depend on a browser CSS engine.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd frontend && npm test -- src/styles/style-contract.test.ts`

Expected: FAIL because the semantic token set and reduced-motion file do not exist.

- [ ] **Step 3: Implement the semantic foundation**

Define light and dark semantic values in one source. Put the actual project font variable first, followed by `"PingFang SC"`, `"Noto Sans CJK SC"`, `"Microsoft YaHei"`, and `sans-serif`; do not place Arial before the project variable. Import reduced-motion globally and restrict transitions to explicit properties.

- [ ] **Step 4: Run style-contract, lint, and typecheck**

Run:

```bash
cd frontend
npm test -- src/styles/style-contract.test.ts
npm run lint
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 5: Commit the foundation**

```bash
git add frontend/src/styles
git commit -m "feat(ui): establish accessible semantic tokens"
```

### Task 2: Add accessible Dialog, Drawer, Menu, and FormField primitives

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/src/components/ui/dialog.tsx`
- Create: `frontend/src/components/ui/menu.tsx`
- Create: `frontend/src/components/ui/form-field.tsx`
- Test: `frontend/src/components/ui/dialog.test.tsx`
- Test: `frontend/src/components/ui/menu.test.tsx`
- Test: `frontend/src/components/ui/form-field.test.tsx`

**Interfaces:**
- Produces `Dialog`, `DialogTrigger`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogClose` and `DrawerContent` built on `@radix-ui/react-dialog`.
- Produces `Menu`, `MenuTrigger`, `MenuContent`, `MenuItem` using the existing Floating UI or a focused Radix menu dependency.
- Produces `FormField({ id, label, description?, error?, required?, children })`, cloning or rendering children with `aria-describedby` and `aria-invalid`.

- [ ] **Step 1: Install the smallest required dialog dependency**

Run: `cd frontend && npm install @radix-ui/react-dialog`

Use the existing `@floating-ui/react` dependency for Menu keyboard roving, dismissal, and focus restoration; do not add a second menu dependency.

- [ ] **Step 2: Write failing behavior tests**

Cover: dialog title/description association, Escape close, focus containment, focus restoration, overlay dismissal policy, menu keyboard open/selection/close, and FormField label/error association.

- [ ] **Step 3: Run tests and verify failure**

Run: `cd frontend && npm test -- src/components/ui/dialog.test.tsx src/components/ui/menu.test.tsx src/components/ui/form-field.test.tsx`

Expected: FAIL because the primitives do not exist.

- [ ] **Step 4: Implement minimal reusable primitives**

Use semantic tokens from Task 1. `DrawerContent` is a styled `DialogContent`, not a separate focus-management implementation. Destructive confirmation must not receive default focus.

- [ ] **Step 5: Run focused and full frontend tests**

Run: `cd frontend && npm test`

Expected: all tests PASS.

- [ ] **Step 6: Commit the primitives**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/components/ui
git commit -m "feat(ui): add accessible interaction primitives"
```

### Task 3: Rebuild TopNavigation for mobile reflow and keyboard access

**Files:**
- Modify: `frontend/src/components/TopNavigation.tsx`
- Modify: `frontend/src/components/TopNavigation.module.scss`
- Modify: `frontend/src/components/TopNavigation.test.tsx`

**Interfaces:**
- Consumes `Menu*` from Task 2 and semantic tokens from Task 1.
- Preserves existing `onMenuClick` and route mapping props.

- [ ] **Step 1: Add failing semantic tests**

Assert: the brand is a home link rather than an H1; account trigger is a button with `aria-expanded`; current route has `aria-current="page"`; menu can open and close by keyboard.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd frontend && npm test -- src/components/TopNavigation.test.tsx`

- [ ] **Step 3: Implement semantic navigation markup**

Replace the clickable user `div` with `MenuTrigger`. Keep logout/profile behavior. Make decorative chevrons `aria-hidden`.

- [ ] **Step 4: Implement responsive CSS**

At `<768px`, use a two-row layout: compact brand/account row and a no-wrap three-item nav row. Allow nav-level horizontal overflow only if 320px plus 200% zoom requires it; never allow document-level overflow or per-character wrapping.

- [ ] **Step 5: Verify tests and static responsive rules**

Run: `cd frontend && npm test -- src/components/TopNavigation.test.tsx && npm run typecheck`

Expected: PASS, with a stylesheet test or assertion covering the `<768px` rule and `white-space: nowrap`.

- [ ] **Step 6: Commit navigation**

```bash
git add frontend/src/components/TopNavigation.tsx frontend/src/components/TopNavigation.module.scss frontend/src/components/TopNavigation.test.tsx
git commit -m "fix(ui): make primary navigation responsive and accessible"
```

### Task 4: Repair Memory action styling and modal semantics

**Files:**
- Modify: `frontend/src/app/memory/page.tsx`
- Modify: `frontend/src/app/memory/memory.module.scss`
- Modify: `frontend/src/app/memory/page.test.tsx`

**Interfaces:**
- Consumes shared `Button` and `Dialog*` primitives.
- Preserves `confirmMemoryInsight`, `correctMemoryInsight`, and `deleteMemoryInsight` calls.

- [ ] **Step 1: Write failing tests**

Assert that the confirmation control uses the primary shared variant; edit/delete dialogs expose a labelled modal; Escape closes without calling mutation functions; focus returns to the initiating control.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd frontend && npm test -- src/app/memory/page.test.tsx`

- [ ] **Step 3: Replace selector-dependent buttons and inline dialog divs**

Remove `.actions button` rules that override semantic variants. Use shared buttons and Dialog. Keep evidence expansion inline because it is not modal.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd frontend && npm test -- src/app/memory/page.test.tsx && npm run typecheck`

- [ ] **Step 5: Commit Memory fixes**

```bash
git add frontend/src/app/memory
git commit -m "fix(memory): restore visible actions and dialog semantics"
```

### Task 5: Make Chat history a true accessible drawer and list

**Files:**
- Modify: `frontend/src/components/ChatHistoryPanel.tsx`
- Modify: `frontend/src/app/chat/chat.module.scss`
- Modify: `frontend/src/components/ChatInputArea.tsx`
- Create: `frontend/src/components/ChatHistoryPanel.test.tsx`

**Interfaces:**
- Consumes `DrawerContent` from Task 2.
- Preserves `onSessionSelect`, `onNewSession`, `onDeleteSession`, and desktop persistent-sidebar behavior.

- [ ] **Step 1: Write failing tests**

Cover: closed mobile history is absent/inert to accessibility queries; Escape closes; session titles are buttons or links; delete is a separate named button; input/send controls meet names and size classes.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd frontend && npm test -- src/components/ChatHistoryPanel.test.tsx`

- [ ] **Step 3: Implement responsive sidebar/drawer split**

Render the persistent `<aside>` only for desktop CSS layout. Render the mobile history through `DrawerContent`; when closed, it must be unmounted by Radix rather than translated off-screen. Replace clickable session `div` elements with semantic controls.

- [ ] **Step 4: Normalize Chat input and disclaimer contrast**

Use a 44px send target, visible focus-within and focus-visible states, and semantic secondary text. Preserve message submission behavior.

- [ ] **Step 5: Run focused tests, Chat tests, and typecheck**

Run: `cd frontend && npm test -- src/components/ChatHistoryPanel.test.tsx && npm run typecheck`

- [ ] **Step 6: Commit Chat fixes**

```bash
git add frontend/src/components/ChatHistoryPanel.tsx frontend/src/components/ChatHistoryPanel.test.tsx frontend/src/components/ChatInputArea.tsx frontend/src/app/chat/chat.module.scss
git commit -m "fix(chat): make history and input accessible on mobile"
```

### Task 6: Reflow note cards and expose touch-safe actions

**Files:**
- Modify: `frontend/src/app/notes/components/ModernNoteCard.tsx`
- Modify: `frontend/src/app/notes/styles/note-card.module.scss`
- Modify: `frontend/src/app/notes/components/ModernNoteCard.test.tsx`
- Create: `frontend/src/app/notes/components/NoteCardActionsMenu.tsx`

**Interfaces:**
- Consumes `Menu*`, `Button`, and semantic tokens.
- Adds an explicit `onOpenRelated(noteId: string)` callback if the card currently relies on a wrapper click.

- [ ] **Step 1: Write failing behavior and structure tests**

Assert: a named relationship action is always present when relationships are available; edit/delete/publish remain keyboard reachable; mobile secondary actions live in a named menu; hover is not required to expose the relationship action.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd frontend && npm test -- src/app/notes/components/ModernNoteCard.test.tsx`

- [ ] **Step 3: Refactor card header and action markup**

Separate title, metadata, relationship cue, and actions. Use semantic buttons and menu items. Do not change note mutation behavior or draft ownership.

- [ ] **Step 4: Implement mobile CSS**

At `<650px`, stack title and metadata, reserve full content width for long titles, use 44px primary targets, and remove hover-only opacity. Replace `transition: all` with named properties.

- [ ] **Step 5: Run note-card, page, and editor tests**

Run:

```bash
cd frontend
npm test -- src/app/notes/components/ModernNoteCard.test.tsx src/app/notes/page.test.tsx src/app/notes/hooks/useNoteEditor.test.tsx
npm run typecheck
```

- [ ] **Step 6: Commit note-card fixes**

```bash
git add frontend/src/app/notes/components/ModernNoteCard.tsx frontend/src/app/notes/components/ModernNoteCard.test.tsx frontend/src/app/notes/components/NoteCardActionsMenu.tsx frontend/src/app/notes/styles/note-card.module.scss
git commit -m "fix(notes): reflow cards and expose touch-safe actions"
```

### Task 7: Correct Auth form semantics without changing authentication behavior

**Files:**
- Modify: `frontend/src/app/auth/page.tsx`
- Modify: `frontend/src/app/auth/auth.module.scss`
- Create: `frontend/src/app/auth/page.test.tsx`

**Interfaces:**
- Consumes `FormField`, `Button`, and semantic tokens.
- Preserves endpoint payloads and mode transitions.

- [ ] **Step 1: Write failing tests for all three modes**

Use `getByLabelText` for email, password/new password, and verification code. Assert the password visibility button has a changing accessible name, current mode is exposed, and errors are associated with invalid fields.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd frontend && npm test -- src/app/auth/page.test.tsx`

- [ ] **Step 3: Implement persistent labels and named controls**

Keep placeholders as examples only. Use a proper tablist or an equivalent group of buttons with selected state. Do not change fetch URLs, payloads, countdown, validation, or successful redirects.

- [ ] **Step 4: Move Auth to shared visual tokens**

Remove Apple-specific comments and raw brand values. Retain the centered compact card, precise spacing, restrained shadow, and three modes. Replace the emoji with the shared text mark or relationship mark.

- [ ] **Step 5: Run focused tests, lint, and typecheck**

Run: `cd frontend && npm test -- src/app/auth/page.test.tsx && npm run lint && npm run typecheck`

- [ ] **Step 6: Commit Auth changes**

```bash
git add frontend/src/app/auth frontend/src/components/ui/form-field.tsx
git commit -m "fix(auth): add accessible branded form controls"
```

## Work Package B — P2 Visual System and Controlled Personality

### Task 8: Constrain Profile atmosphere colors and simplify hierarchy

**Files:**
- Modify: `frontend/src/app/profile/profileBackgroundTheme.ts`
- Modify: `frontend/src/app/profile/profileBackgroundTheme.selftest.ts`
- Modify: `frontend/src/app/profile/page.tsx`
- Modify: `frontend/src/app/profile/profile.module.scss`
- Modify: `frontend/src/app/profile/page.test.tsx`

**Interfaces:**
- `resolveProfileAtmosphere(theme): AtmosphereTokens` always returns three safe decorative CSS colors.
- Profile content consumes shared semantic tokens; only the hero/preview consumes atmosphere tokens.

- [ ] **Step 1: Write failing theme-safety tests**

For default, light, saturated, malformed, and very dark source themes, assert that the resolver returns exactly `accent`, `soft`, and `glow`, clamps unsafe input, and falls back to indigo on invalid data.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `cd frontend && npm test -- src/app/profile/profileBackgroundTheme.selftest.ts src/app/profile/page.test.tsx`

- [ ] **Step 3: Implement the constrained resolver**

Keep deterministic personalization, but remove whole-page theme objects and hash-generated arbitrary gradients. Compute bounded decoration values; never output text, button, status, focus, or card-surface colors.

- [ ] **Step 4: Restructure Profile content hierarchy**

Use one clear page title. Keep account, statistics, AI understanding, sources/update time, theme preview, and recommendations. Replace exact-looking colorful progress bars with text, source counts, and timestamps. Replace clickable feed `div` elements with links/buttons. Use consistent Chinese labels.

- [ ] **Step 5: Rewrite Profile styles on semantic tokens**

Limit atmosphere color to the hero glow, avatar accent, theme preview, and small relationship markers. Reduce nested cards and fix desktop/mobile column balance.

- [ ] **Step 6: Run Profile tests, lint, and typecheck**

Run: `cd frontend && npm test -- src/app/profile/profileBackgroundTheme.selftest.ts src/app/profile/page.test.tsx && npm run lint && npm run typecheck`

- [ ] **Step 7: Commit Profile changes**

```bash
git add frontend/src/app/profile
git commit -m "feat(profile): constrain atmosphere colors and clarify hierarchy"
```

### Task 9: Add the shared relationship cue and normalize core routes

**Files:**
- Create: `frontend/src/components/ui/relationship-cue.tsx`
- Create: `frontend/src/components/ui/relationship-cue.test.tsx`
- Modify: `frontend/src/app/inspiration/inspiration.module.scss`
- Modify: `frontend/src/app/memory/memory.module.scss`
- Modify: `frontend/src/app/publish/publish.module.scss`
- Modify: `frontend/src/app/chat/chat.module.scss`
- Modify: `frontend/src/app/notes/styles/layout.module.scss`
- Modify: `frontend/src/app/notes/styles/note-card.module.scss`

**Interfaces:**
- Produces `RelationshipCue({ sourceLabel, targetLabel?, kind?, explanation?, href? })`.
- Consumes semantic tokens and exposes meaning in text, not color alone.

- [ ] **Step 1: Write the failing RelationshipCue test**

Assert that source/target/kind are readable to assistive technology, decorative line/node elements are hidden, and link mode has a named destination.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd frontend && npm test -- src/components/ui/relationship-cue.test.tsx`

- [ ] **Step 3: Implement the cue and use it where relationship context is already shown**

Do not invent new relationship data. Replace only existing generic badges/lines where the current data can provide a truthful source or relationship label.

- [ ] **Step 4: Normalize core route styles**

Migrate page backgrounds, content widths, headings, secondary text, borders, buttons, and focus states to semantic tokens. Preserve the established Inspiration/Memory/Publish structure. Remove duplicate raw colors and `transition: all` in touched files.

- [ ] **Step 5: Add a raw-color migration assertion**

Extend `style-contract.test.ts` with an allowlist for temporary editor syntax colors and atmosphere resolver output. Fail on new business-page hex literals outside the allowlist.

- [ ] **Step 6: Run full frontend tests**

Run: `cd frontend && npm test && npm run lint && npm run typecheck`

- [ ] **Step 7: Commit route normalization**

```bash
git add frontend/src/components/ui/relationship-cue.tsx frontend/src/components/ui/relationship-cue.test.tsx frontend/src/app/inspiration/inspiration.module.scss frontend/src/app/memory/memory.module.scss frontend/src/app/publish/publish.module.scss frontend/src/app/chat/chat.module.scss frontend/src/app/notes/styles/layout.module.scss frontend/src/app/notes/styles/note-card.module.scss frontend/src/styles/style-contract.test.ts
git commit -m "feat(ui): unify core routes around relationship language"
```

## Work Package C — P2 Notes Performance

### Task 10: Add stable cursor pagination and batched note preferences

**Files:**
- Create: `backend/services/noteListCursor.ts`
- Create: `backend/tests/noteListCursor.test.ts`
- Modify: `backend/services/noteService.ts`
- Modify: `backend/controllers/noteController.ts`
- Modify: `backend/schemas/noteSchemas.ts`
- Modify: `backend/routes/notes.ts`
- Modify: `backend/tests/noteService.test.ts`
- Modify: `backend/tests/noteHttpContract.test.ts`
- Modify: `backend/types/index.ts`
- Modify: `frontend/src/app/publish/select/page.tsx`
- Modify: `frontend/src/app/publish/[noteId]/page.tsx`

**Interfaces:**
- `encodeNoteCursor(input: { createdAt: Date; id: string }): string`
- `decodeNoteCursor(value: string): { createdAt: Date; id: string }`, throwing a validation error for malformed input.
- `noteService.getNotesPage(userId, { limit, cursor }): Promise<{ notes: NoteListItem[]; pageInfo: { hasNextPage: boolean; nextCursor: string | null } }>`
- `noteService.getNote(userId, noteId): Promise<NoteListItem>` and `GET /api/notes/:id` return one owned note for direct preview routes.
- Each list note contains `aiIncluded: boolean`, defaulting to `true` when no preference row exists.

- [ ] **Step 1: Write failing cursor tests**

Cover round-trip, malformed base64url, invalid date, missing id, and stable ordering for equal timestamps.

- [ ] **Step 2: Run cursor tests and verify failure**

Run: `cd backend && npm test -- --test-name-pattern="note list cursor"`

- [ ] **Step 3: Implement cursor codec**

Encode a versioned JSON payload with base64url. Validate version, ISO date, and Mongo ObjectId before returning.

- [ ] **Step 4: Write failing service and HTTP contract tests**

Cover default limit 30, maximum limit 50, `limit + 1` lookahead, `(createdAt desc, _id desc)` tie-breaking, user ownership, next cursor, final page, malformed cursor 400, batched preference mapping, and owned/not-found behavior for `GET /api/notes/:id`.

- [ ] **Step 5: Implement paginated service and controller**

Use one notes query and one `NoteAiPreference.find({ userId, noteId: { $in: ids } })` query per page. Do not perform a query per card. Return `data.notes` and `data.pageInfo`. Add `GET /api/notes/:id` before mutation routes so Publish preview can fetch one owned note without scanning pages. Update Publish selection to consume `pageInfo` and expose “加载更多笔记”; update Publish preview to call the single-note endpoint.

- [ ] **Step 6: Run backend tests, typecheck, and build**

Run:

```bash
cd backend
npm test
npm run typecheck
npm run build
```

- [ ] **Step 7: Commit pagination backend**

```bash
git add backend/services/noteListCursor.ts backend/services/noteService.ts backend/controllers/noteController.ts backend/schemas/noteSchemas.ts backend/routes/notes.ts backend/types/index.ts backend/tests/noteListCursor.test.ts backend/tests/noteService.test.ts backend/tests/noteHttpContract.test.ts frontend/src/app/publish/select/page.tsx 'frontend/src/app/publish/[noteId]/page.tsx'
git commit -m "feat(notes): paginate list and batch AI preferences"
```

### Task 11: Return relationship summaries independently of the loaded list

**Files:**
- Create: `backend/services/relatedNoteSummaryService.ts`
- Modify: `backend/routes/recommend.ts`
- Modify: `backend/tests/recommendAndPerformanceRoutes.test.ts`
- Create: `backend/tests/relatedNoteSummaryService.test.ts`
- Create: `frontend/src/app/notes/services/relatedNotes.ts`
- Create: `frontend/src/app/notes/services/relatedNotes.test.ts`
- Modify: `frontend/src/app/notes/components/RelatedNotesDrawer.tsx`
- Modify: `frontend/src/app/notes/components/RelatedNotesDrawer.test.tsx`

**Interfaces:**
- `getRelatedNoteSummaries({ userId, noteId }): Promise<RelatedNoteSummary[]>`
- `GET /api/recommend/notes/:noteId` returns `{ success: true, data: { sourceRevision, relationships } }`.
- Frontend `fetchRelatedNotes(noteId, signal?): Promise<RelatedNoteSummary[]>` validates the envelope.

- [ ] **Step 1: Write failing backend service tests**

Cover source ownership, deleted candidates, candidate ownership, maximum five results, cached type/reason mapping, score-band mapping without raw numeric scores, and stale/missing cache behavior.

- [ ] **Step 2: Run backend focused tests and verify failure**

Run: `cd backend && npm test -- --test-name-pattern="related note summaries"`

- [ ] **Step 3: Implement summary service and route**

Fetch the owned source note, read candidate IDs from its current recommendation cache, fetch owned candidate summaries in one query, preserve ranking, and omit `s1`, `s2`, embeddings, and internal weights from the public response.

- [ ] **Step 4: Write failing frontend service and drawer tests**

Assert the drawer can render candidates not present in the loaded notes page, exposes normal-language reason/type, contains no “综合分/向量(s1)/模型(s2)”, and handles loading/error/empty states.

- [ ] **Step 5: Implement frontend service and drawer migration**

Remove the `allNotes.find` candidate dependency. The drawer may still receive the selected source note from the loaded page, but candidate content comes from the endpoint. Render candidate navigation as links.

- [ ] **Step 6: Run backend and frontend focused suites**

Run:

```bash
cd backend
npm test -- --test-name-pattern="related note summaries|recommend and performance"
cd ../frontend
npm test -- src/app/notes/services/relatedNotes.test.ts src/app/notes/components/RelatedNotesDrawer.test.tsx
npm run typecheck
```

- [ ] **Step 7: Commit relationship summaries**

```bash
git add backend/services/relatedNoteSummaryService.ts backend/routes/recommend.ts backend/tests/relatedNoteSummaryService.test.ts backend/tests/recommendAndPerformanceRoutes.test.ts frontend/src/app/notes/services/relatedNotes.ts frontend/src/app/notes/services/relatedNotes.test.ts frontend/src/app/notes/components/RelatedNotesDrawer.tsx frontend/src/app/notes/components/RelatedNotesDrawer.test.tsx
git commit -m "feat(notes): decouple relationships from loaded pages"
```

### Task 12: Migrate useNotes to infinite pages without losing mutation correctness

**Files:**
- Create: `frontend/src/app/notes/hooks/notePages.ts`
- Create: `frontend/src/app/notes/hooks/notePages.test.ts`
- Modify: `frontend/src/app/notes/hooks/useNotes.ts`
- Modify: `frontend/src/app/notes/hooks/useNotes.test.tsx`
- Modify: `frontend/src/app/notes/hooks/useNotesPolling.test.tsx`
- Modify: `frontend/src/app/notes/page.tsx`
- Modify: `frontend/src/app/notes/page.test.tsx`

**Interfaces:**
- `flattenNotePages(data?: InfiniteData<NotePage>): Note[]`
- `mapNotesInPages(data, updater): InfiniteData<NotePage>`
- `prependNoteToPages(data, note): InfiniteData<NotePage>`
- `removeNoteFromPages(data, noteId): InfiniteData<NotePage>`
- `useNotes` additionally returns `hasNextPage`, `isFetchingNextPage`, and `loadMore(): Promise<void>`.

- [ ] **Step 1: Write failing pure cache-helper tests**

Cover flattening, prepending optimistic notes, replacing canonical snapshots by revision/enrichment precedence, removing across pages, avoiding duplicates, and preserving pageInfo/pageParams.

- [ ] **Step 2: Run helper tests and verify failure**

Run: `cd frontend && npm test -- src/app/notes/hooks/notePages.test.ts`

- [ ] **Step 3: Implement cache helpers**

Keep page transport details out of mutation functions. Helpers must return new page objects only where data changes.

- [ ] **Step 4: Convert list query tests to paginated envelopes**

Add tests for first page, load more, no next page, load-more failure without erasing existing pages, optimistic create, canonical replace, delete, edit conflict, polling merge, and late GET protection.

- [ ] **Step 5: Migrate `useNotes` to `useInfiniteQuery`**

Use `pageParam` as cursor and `getNextPageParam` from `pageInfo.nextCursor`. Preserve list-generation and temporary-note protections by applying them through the pure helpers.

- [ ] **Step 6: Add an explicit load-more control to Notes**

Render 30 notes initially. Provide a named “加载更多笔记” button and a loading state; IntersectionObserver may enhance it but cannot be the only path. Do not render unloaded pages or prefetch every remaining cursor.

- [ ] **Step 7: Run all Notes and frontend tests**

Run: `cd frontend && npm test -- src/app/notes && npm run lint && npm run typecheck`

- [ ] **Step 8: Commit frontend pagination**

```bash
git add frontend/src/app/notes/hooks/notePages.ts frontend/src/app/notes/hooks/notePages.test.ts frontend/src/app/notes/hooks/useNotes.ts frontend/src/app/notes/hooks/useNotes.test.tsx frontend/src/app/notes/hooks/useNotesPolling.test.tsx frontend/src/app/notes/page.tsx frontend/src/app/notes/page.test.tsx
git commit -m "feat(notes): render cursor-paginated note pages"
```

### Task 13: Make editor loading intent-driven and bound list animation

**Files:**
- Modify: `frontend/src/app/notes/page.tsx`
- Modify: `frontend/src/app/notes/page.test.tsx`
- Modify: `frontend/src/app/notes/components/richTextEditorLoader.ts`
- Modify: `frontend/src/app/notes/styles/layout.module.scss`
- Modify: `frontend/src/app/notes/styles/note-card.module.scss`

**Interfaces:**
- Preserves `loadRichTextEditor(): Promise<typeof import('./RichTextEditor')>`.
- Adds `preloadRichTextEditorFromIntent()` as an idempotent wrapper if existing loader state is not already idempotent.

- [ ] **Step 1: Write failing preload tests**

Use fake timers to prove waiting beyond 1200ms does not call the loader. Assert pointer/focus/keyboard intent and opening compose preload once.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `cd frontend && npm test -- src/app/notes/page.test.tsx`

- [ ] **Step 3: Remove time-based preload and wire intent events**

Do not preload on mount or idle timeout. Preload on capture trigger pointer/focus and before entering edit mode. Keep dynamic import and loading fallback.

- [ ] **Step 4: Bound animation**

Remove whole-list layout spring. Animate only inserted/deleted visible cards with transform/opacity, and disable those transitions under reduced motion. Remove filter-heavy or wobble effects from routine list operations.

- [ ] **Step 5: Run Notes tests and typecheck**

Run: `cd frontend && npm test -- src/app/notes && npm run typecheck`

- [ ] **Step 6: Commit loading and motion changes**

```bash
git add frontend/src/app/notes/page.tsx frontend/src/app/notes/page.test.tsx frontend/src/app/notes/components/richTextEditorLoader.ts frontend/src/app/notes/styles/layout.module.scss frontend/src/app/notes/styles/note-card.module.scss
git commit -m "perf(notes): load editor on intent and bound list motion"
```

## Work Package D — Closure and Independent Acceptance

### Task 14: Add accessibility, visual-matrix, and bundle-budget regression gates

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/src/test/accessibility.test.tsx`
- Create: `frontend/scripts/check-route-budgets.mjs`
- Create: `frontend/scripts/route-budget-baseline.json`
- Create: `docs/verification/2026-09-09-frontend-experience-remediation.md`

**Interfaces:**
- `npm run test:a11y` executes automated checks for the core rendered states.
- `npm run check:route-budgets` parses a production-build artifact or emitted route table and fails when `/notes` exceeds the agreed budget.

- [ ] **Step 1: Add an accessibility test dependency and failing scripts**

Install `axe-core` as a dev dependency. Add scripts for `test:a11y` and `check:route-budgets`. Initially point them at tests/scripts that fail with a clear missing-implementation message.

- [ ] **Step 2: Implement automated accessibility states**

Render TopNavigation, Auth modes, Memory dialogs, Chat drawer, Profile feed, and Note card actions with stable fixtures. Run axe and also assert focus behavior not covered by static rules.

- [ ] **Step 3: Implement route-budget parser**

Store `{ "notesFirstLoadKb": 421, "maxNotesFirstLoadKb": 300, "minReductionPercent": 25 }` in `route-budget-baseline.json`. Make the build script save the Next route table to `.next-route-sizes.txt`; parse the `/notes` “First Load JS” value and fail if the row is absent, the value exceeds 300kB, or the reduction from 421kB is below 25%.

- [ ] **Step 4: Run the full automated gate**

Run:

```bash
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
npm run test:a11y
npm run check:route-budgets
cd ../backend
npm run typecheck
npm test
npm run build
```

Expected: every command PASS.

- [ ] **Step 5: Perform the manual matrix and record evidence**

For Notes, Chat, Memory, Inspiration, Profile, Publish, and Auth, record results at 320, 390, 768, and 1440px. Also record 200% zoom, keyboard-only, VoiceOver spot checks, reduced motion, light/dark, long titles, three Profile atmosphere themes, 251-note account, and a 1000-note fixture. Include before/after `/notes` bundle size and initial accessibility-tree/DOM counts.

- [ ] **Step 6: Re-run Impeccable audit**

Record Accessibility, Performance, Responsive, Theming, and Anti-pattern scores. Required result: at least 16/20 with zero P0/P1. Any P0/P1 reopens the owning task; do not waive it in the report.

- [ ] **Step 7: Commit verification gates and evidence**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/test/accessibility.test.tsx frontend/scripts/check-route-budgets.mjs frontend/scripts/route-budget-baseline.json docs/verification/2026-09-09-frontend-experience-remediation.md
git commit -m "test(ui): gate frontend remediation acceptance"
```

## Final Integration Review

- [ ] Compare every requirement in Sections 5–12 of the Spec to a passing test or recorded manual check.
- [ ] Review `git diff` from the parent of Task 1 through HEAD for unrelated user-file changes.
- [ ] Confirm Profile atmosphere colors never feed semantic text/action/status/focus tokens.
- [ ] Confirm Auth requests and redirects are unchanged.
- [ ] Confirm Notes draft, mutation conflict, polling, recommendation refresh, and pagination tests all pass together.
- [ ] Confirm closed drawers are absent or inert to the accessibility tree.
- [ ] Confirm no fixed timer downloads RichTextEditor.
- [ ] Confirm `/notes` meets both absolute or relative bundle budget and initial-card/AX-tree budgets.
- [ ] Confirm full frontend/backend lint, test, typecheck, and builds pass from a clean build directory.
- [ ] Confirm the final verification report contains no unresolved P0/P1.
