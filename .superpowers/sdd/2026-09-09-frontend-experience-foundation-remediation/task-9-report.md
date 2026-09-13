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
