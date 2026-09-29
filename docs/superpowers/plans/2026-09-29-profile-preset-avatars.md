# Profile Preset Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace new remote-avatar entry with eight bundled, non-gendered presets and an initials option while preserving existing custom URL avatars until the user chooses a new option.

**Architecture:** Store only a stable local selection key for new choices (`preset:initials` or `preset:01` through `preset:08`). Render those keys from app-bundled assets; keep legacy URL strings readable and unchanged unless the user explicitly saves a different choice. A native radio-group picker owns preview and draft state, while the profile page modal owns Save/Cancel.

**Tech Stack:** Next.js/React, TypeScript, SVG assets, Express/Zod, Vitest, Node `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-29-profile-rework-design.md`

## Global Constraints

- Provide exactly 8 bundled local presets with no gender cues and a name-initials option.
- Preview and selection are modal-local draft state; only Save persists; Cancel/close discards.
- No new upload control or external URL input.
- Existing custom `User.avatar` URL remains displayed and unmodified until explicit user choice.
- New saved choices use stable keys `preset:initials` or `preset:01` … `preset:08`.
- Preset choices must be keyboard-operable and screen-reader distinguishable with accessible name and selected state.

## Review Focus

- Saving only a username must omit `avatar` from the update and preserve an existing URL.
- Opening and cancelling the modal must never write an avatar key.
- A legacy URL must render as before; new preset identifiers must resolve only to local assets.
- Keyboard arrow/space interaction must update the preview and checked radio state.
- Unknown non-empty legacy avatar values must not be erased or interpreted as external values newly entered in the UI.

---

### Task 1: Add the local preset registry and accessible picker

**Files:**
- Create: `frontend/public/avatars/profile-preset-01.svg` … `profile-preset-08.svg`
- Create: `frontend/src/app/profile/avatarPresets.ts`
- Create: `frontend/src/app/profile/AvatarPicker.tsx`
- Create: `frontend/src/app/profile/AvatarPicker.module.scss`
- Create: `frontend/src/app/profile/AvatarPicker.test.tsx`

**Interfaces:**
- `type AvatarSelection = 'preset:initials' | 'preset:01' | ... | 'preset:08'`.
- `resolveAvatarDisplay(value: string | undefined, username: string): { kind: 'preset' | 'legacy-url' | 'initials'; src?: string; initials: string }` maps preset keys only to bundled assets and retains legacy values as legacy URLs.
- `<AvatarPicker value: AvatarSelection | null; legacyAvatarUrl?: string; username: string; onChange(value: AvatarSelection)>` is a controlled native radio group. `null` preserves and previews an existing legacy URL; it does not persist.

- [ ] **Step 1: Write failing picker tests** named `renders exactly eight presets and initials with accessible labels`, `supports keyboard radio selection and updates preview`, `maps preset keys to local assets`, and `keeps a legacy URL in legacy display mode`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/app/profile/AvatarPicker.test.tsx`. Expected: FAIL because component/registry do not exist.
- [ ] **Step 3: Implement eight bundled abstract/local SVGs with abstract, gender-neutral shapes and the native `fieldset`/`legend` radio picker**. Radio labels provide accessible names; native checked state exposes selection; preview resolves to local assets, initials, or the unchanged legacy URL. A legacy URL starts with no preset selected.
- [ ] **Step 4: Run** `cd frontend && npx vitest run src/app/profile/AvatarPicker.test.tsx && npm run typecheck`. Expected: PASS; verify the asset registry has exactly eight preset keys and visually inspect that all eight remain abstract and gender-neutral.
- [ ] **Step 5: Commit** `git add frontend/public/avatars/profile-preset-*.svg frontend/src/app/profile/avatarPresets.ts frontend/src/app/profile/AvatarPicker.tsx frontend/src/app/profile/AvatarPicker.module.scss frontend/src/app/profile/AvatarPicker.test.tsx && git commit -m "feat: add local profile avatar presets"`.

### Task 2: Enforce selection-only avatar updates with legacy compatibility

**Files:**
- Modify: `frontend/src/app/profile/page.tsx`
- Modify: `frontend/src/app/profile/page.test.tsx`
- Modify: `frontend/src/services/userService.ts`
- Modify: `backend/schemas/authSchemas.ts`
- Create: `backend/tests/profileAvatarContract.test.ts`

**Interfaces:**
- `updateProfile({ username, avatar? })` sends `avatar` only when the user deliberately selected a preset in the current modal session.
- The backend accepts only `preset:initials | preset:01…preset:08` for avatar writes; profile reads continue returning old `User.avatar` URL strings unchanged.
- Main profile display and modal preview both use `resolveAvatarDisplay`; a legacy URL is shown as existing state but cannot be re-entered/edited as an external URL.
- With no stored avatar, initials are the visual fallback; unrelated profile saves do not implicitly persist a selection.

- [ ] **Step 1: Write failing tests** named `username-only save omits avatar and preserves legacy URL`, `cancel and close discard avatar draft`, `explicit preset save writes its stable key`, `legacy avatar is rendered without conversion`, and `avatar schema rejects newly submitted external URL`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/app/profile/page.test.tsx`; `cd backend && npx tsx --test tests/profileAvatarContract.test.ts`. Expected: FAIL on URL text input/current `avatar` write behavior.
- [ ] **Step 3: Integrate controlled picker into the edit modal** and initialize the draft to an existing preset, `null` for a legacy URL, or visual initials fallback when unset. Track explicit user selection. Send avatar only after an explicit choice; restrict writes to canonical keys and do not modify a stored legacy value on unrelated profile saves.
- [ ] **Step 4: Run** `cd frontend && npx vitest run src/app/profile/AvatarPicker.test.tsx src/app/profile/page.test.tsx && npm run typecheck`; `cd backend && npx tsx --test tests/profileAvatarContract.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add frontend/src/app/profile/page.tsx frontend/src/app/profile/page.test.tsx frontend/src/services/userService.ts backend/schemas/authSchemas.ts backend/tests/profileAvatarContract.test.ts && git commit -m "feat: use local profile avatar selections"`.

## Spec Coverage Self-Review

- Eight local illustrations, initials fallback, non-gendered style, preview and single selection: Task 1.
- Keyboard and screen-reader operation: Task 1 tests the native radio contract.
- Save/Cancel, username-only update, no external URL entry, stable preset storage: Task 2.
- Legacy URL display and preservation; no bulk migration: Tasks 1–2.
- Execute Plans A and B first: A establishes core profile/modal wiring; B establishes the topic component/page composition. Plan C then edits only avatar-specific modal and display integration.
