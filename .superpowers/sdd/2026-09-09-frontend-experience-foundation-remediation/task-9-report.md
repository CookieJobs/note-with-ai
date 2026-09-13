# Task 9 report: relationship cue and core-route normalization

## Delivered

- Added `RelationshipCue`, a text-first relationship presentation with optional source, target, kind, explanation, and named destination link.
- Marked connector lines and nodes as `aria-hidden`; source, target, kind, and explanation remain readable text.
- Replaced existing inspiration source metadata and memory evidence presentation with truthful cues using their existing data. Memory evidence keeps its original destination and analytics event.
- Migrated the named Inspiration, Memory, Publish, Chat, and Notes route styles to semantic tokens for route surfaces, typography, borders, actions, and focus states. The existing Chat drawer state behavior and Memory selectors were not changed.
- Added a style contract that rejects raw business-page hex literals in the six named style modules, with limited, selector-scoped exceptions for notes atmosphere and editor-syntax output rather than a blanket notes exemption.

## TDD evidence

RED:

```text
cd frontend && npm test -- src/components/ui/relationship-cue.test.tsx
FAIL  Failed to resolve import "./relationship-cue"
```

The failure was caused by the absent component named by the new test.

GREEN:

```text
cd frontend && npm test -- src/components/ui/relationship-cue.test.tsx
Test Files  1 passed (1)
Tests  1 passed (1)

cd frontend && npm test -- src/styles/style-contract.test.ts
FAIL  ../app/inspiration/inspiration.module.scss should not introduce a business-page hex literal

cd frontend && npm test -- src/components/ui/relationship-cue.test.tsx src/styles/style-contract.test.ts src/app/memory/page.test.tsx src/app/inspiration/page.test.tsx
Test Files  4 passed (4)
Tests  16 passed (16)
```

## Final verification

```text
cd frontend && npm test
Test Files  34 passed (34)
Tests  214 passed (214)

cd frontend && npm run lint
exit 0

cd frontend && npm run typecheck
exit 0

git diff --check
exit 0

rg -n -o '#[0-9A-Fa-f]{3,8}\\b|transition\\s*:\\s*all\\b' \
  src/app/inspiration/inspiration.module.scss \
  src/app/memory/memory.module.scss \
  src/app/publish/publish.module.scss \
  src/app/chat/chat.module.scss \
  src/app/notes/styles/layout.module.scss \
  src/app/notes/styles/note-card.module.scss
# no matches
```

## Files changed

- `frontend/src/components/ui/relationship-cue.tsx`
- `frontend/src/components/ui/relationship-cue.test.tsx`
- `frontend/src/app/inspiration/page.tsx`
- `frontend/src/app/inspiration/inspiration.module.scss`
- `frontend/src/app/memory/page.tsx`
- `frontend/src/app/memory/memory.module.scss`
- `frontend/src/app/publish/publish.module.scss`
- `frontend/src/app/chat/chat.module.scss`
- `frontend/src/app/notes/styles/layout.module.scss`
- `frontend/src/app/notes/styles/note-card.module.scss`
- `frontend/src/styles/style-contract.test.ts`

## Self-review and concerns

- Confirmed that the component does not infer any relationship: both integrations render only labels, evidence, URLs, and publishers already present in the page data.
- Confirmed that the visual connector is decoration only and that the named link remains a semantic anchor.
- Confirmed the style contract deliberately permits only scoped editor/atmosphere contexts, retaining freedom for non-business visual output without exempting an entire Notes file.
- No remaining concerns found in the scoped change.

## Fix Round 1

### Changes

- Raised the Inspiration and Publish primary CTA minimum height from 42px to 44px.
- Applied the shared `lg` Button size to the named Memory generation and “这是准确的” primary actions; compact secondary controls remain compact.
- Raised the mobile Chat related-notes entry height from 40px to 44px.
- Replaced the raw-hex allowlist substring check with parsed rule and declaration validation. The only allowed hex contexts are the designated Notes atmosphere `background` gradient declarations and `color` declarations in `:global(.hljs...)` syntax selectors.
- Added control-size assertions and negative tests covering a raw `color` after an allowed radial gradient and a `border-color` inside an hljs rule.

### RED/GREEN evidence

```text
cd frontend && npm test -- src/styles/style-contract.test.ts
FAIL 3 tests
- named primary route controls were below 44px
- raw color after an allowed atmosphere declaration was incorrectly allowed
- non-syntax declaration inside an hljs rule was incorrectly allowed

cd frontend && npm test -- src/styles/style-contract.test.ts
Test Files  1 passed (1)
Tests  10 passed (10)

cd frontend && npm test -- src/components/ui/relationship-cue.test.tsx src/app/memory/page.test.tsx src/app/inspiration/page.test.tsx
Test Files  3 passed (3)
Tests  9 passed (9)

cd frontend && npm test -- src/app/publish/page.test.tsx
Test Files  1 passed (1)
Tests  1 passed (1)
```

### Final verification

```text
cd frontend && npm test
Test Files  34 passed (34)
Tests  217 passed (217)

cd frontend && npm run lint
exit 0

cd frontend && npm run typecheck
exit 0

git diff --check
exit 0
```

### Self-review

- Each named primary control is covered by the style contract and resolves to at least 44px; secondary actions were not broadly resized.
- The allowlist now evaluates the enclosing rule selector, CSS property, and declaration value, so an unrelated declaration cannot inherit an allowance from a nearby gradient or hljs selector.
- No remaining concerns found in this fix round.

## Fix Round 2

### Changes

- Applied the shared `lg` Button size to Memory’s “保存修改” primary action, so all three named Memory primary actions are at least 44px tall.
- Replaced prefix selector matching in the raw-hex atmosphere exceptions with exact selectors for the existing Notes workspace atmosphere rules. The syntax allowlist is also anchored to an exact hljs selector.
- Added a second descendant-selector negative fixture for the Notes workspace overlay, alongside the existing layout-container fixture.

### RED/GREEN evidence

```text
cd frontend && npm test -- src/styles/style-contract.test.ts
FAIL 2 tests
- “保存修改” lacked the required lg primary size
- a .container descendant selector inherited the atmosphere exception

cd frontend && npm test -- src/styles/style-contract.test.ts
Test Files  1 passed (1)
Tests  11 passed (11)

cd frontend && npm test -- src/app/memory/page.test.tsx src/components/ui/relationship-cue.test.tsx
Test Files  2 passed (2)
Tests  7 passed (7)

cd frontend && npm test
Test Files  34 passed (34)
Tests  218 passed (218)

cd frontend && npm run lint
exit 0

cd frontend && npm run typecheck
exit 0

git diff --check
exit 0
```

### Commit and self-review

- Fix commit: `94af3c0 fix(ui): close route control and color allowlist gaps`.
- The three named Memory primary actions now explicitly use the shared 44px `lg` size; compact secondary and destructive actions remain unchanged.
- The allowance must now match a complete designated selector, `background` property, and gradient declaration. Descendants merely sharing `.container` or `.workspaceOverlayPanel` cannot inherit it.
- No remaining concerns found in this fix round.
