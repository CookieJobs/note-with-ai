# Desktop visual rebuild implementation plan

> Execute in the current workspace, preserving other sessions' uncommitted work. This is an approved continuation of the desktop visual-quality diagnosis, with no backend or data-model changes.

**Goal:** Rebuild the notes page as a composed reading workspace, then carry the same hierarchy into chat arrival and related-note surfaces.

**Design:** Cool neutral canvas, white reading surface, existing blue used deliberately. A wider, aligned page header/capture/list composition. Untitled notes begin with prose; title is optional; dates and secondary actions follow content. Notes remain open rows inside one reading surface. Long-note save/cancel stay visible. System sans, 16px readable prose, clear 18px titles and 28px page heading. Chat starts with its writing prompt and composer; a sourced suggestion follows as one coherent secondary block. Profile atmosphere remains an existing personalized capability.

**Scope:** Existing frontend components and SCSS only. No new dependencies, fabricated content, navigation destinations, tags, automatic titles, or phone-specific work.

- [x] Task 1: Record current working-copy baseline; add meaningful failing DOM-order regressions for notes and chat input priority.
- [x] Task 2: Recompose notes: backdrop, aligned frame, capture affordance, reading rows, prose rhythm, optional title, metadata footer, editing/selected states.
- [x] Task 3: Align chat arrival, shared navigation and related-note hierarchy with the notes foundation.
- [x] Task 4: Inspect real desktop short/untitled/long/editing notes and chat/source states; compare screenshots at the same window size; address visual issues before functional sign-off.
- [x] Task 5: Run affected tests, typecheck and full frontend suite, obtain independent visual/code review, update design conventions and acceptance evidence.

**Acceptance:** Real-content before/after visuals, not a detector score. Prose leads untitled rows; capture is clearly actionable; metadata is quiet and compact; no empty title band; shared surfaces look related; no nested source cards; all previously repaired editing, source routing, IME and focus behavior retained. No real note writes, chat submissions or AI refresh/generation clicks during visual acceptance.

**Evidence:** [Desktop visual rebuild acceptance](../reviews/2026-10-18-desktop-visual-rebuild-validation.md). Full frontend suite: 50 files / 356 tests passed. Typecheck passed. Independent review findings were fixed and rechecked.
