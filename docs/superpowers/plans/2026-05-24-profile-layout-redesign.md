# Profile Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebalance profile page — horizontal stats bar, left column section groups (Account / AI), collapsible AI panel with clear "update" relationship

**Architecture:** Frontend-only refactor of 2 files. StatsPanel becomes horizontal StatsBar. Left column flat cards become two sectionGroup cards. AI group gets collapsible toggle, purple theming, sub-cards.

**Tech Stack:** Next.js App Router, CSS Modules (SCSS), React useState

---

### Task 1: Rewrite profile.module.scss

**Files:** Modify: `frontend/src/app/profile/profile.module.scss`

Replace the entire SCSS file with the updated styles (stats bar, section groups, ai sub-cards, collapse animation). Full file content in the plan document — copy from `docs/superpowers/plans/2026-05-24-profile-layout-redesign.scss-content`.

- [ ] **Step 1:** Write the updated SCSS to `profile.module.scss`
- [ ] **Step 2:** Run `npx tsc --noEmit` in frontend directory, expect no errors

### Task 2: Restructure profile/page.tsx

**Files:** Modify: `frontend/src/app/profile/page.tsx`

Key structural changes:
- `StatsPanel` (vertical grid) → `StatsBar` (horizontal single line)
- Flat card list → `AccountSection` group + `AIProfileSection` group
- AI group: collapsible (`useState`), purple border, sub-cards with `aiSubCard` class
- `useEffect` auto-collapses AI when `profileStatus === 'analyzing'`
- `formatTimeAgo()` helper for "last analyzed" display

- [ ] **Step 1:** Write the updated `page.tsx`
- [ ] **Step 2:** Run `npx tsc --noEmit`, expect no errors
- [ ] **Step 3:** Open `http://localhost:3000/profile`, verify layout

### Task 3: Commit

```bash
git add frontend/src/app/profile/page.tsx frontend/src/app/profile/profile.module.scss
git commit -m "feat: redesign profile layout — stats bar, section groups, collapsible AI panel"
```
