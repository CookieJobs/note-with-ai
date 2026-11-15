# Design System V2 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply the user-approved November 15 HTML visual direction to the production workspace.
**Architecture:** Keep workspace-scoped SCSS variables, existing Lucide icons and all data/navigation behavior. Extend the existing tokens and update existing surfaces; card icons use the generic document fallback because no trustworthy semantic category exists.
**Tech Stack:** Next.js, React, SCSS modules, lucide-react.
**Spec:** Approved `design-preview/design-system-v2-2026-11-15/index.html` and the user's pasted Design System V2 brief.

## Constraints and review focus

Preserve logo references, API contracts, note order, masonry layout, reading/editor widths, image fallback, theme preferences and keyboard behavior. Scope changes to the workspace. Keep readable text contrast, dark primary button contrast, collapsed navigation and mobile drawer widths. No new dependencies, mock records, classification logic or nested card actions.

## Tasks

- [x] Extend workspace tokens (blue, neutral, surface, shadow, radii), preserving existing variable consumers and dark mode. Update sidebar dimensions and navigation surfaces, normalize workspace icon stroke and transitions.
- [x] Update quick capture, search, cards and calendar using shared tokens. Add an aria-hidden document icon to cards; preserve accessible names and API order. Retain masonry sizing algorithm.
- [x] Update design/module documentation. Run existing workspace/note tests, lint, typecheck and build. Render the real components with read-only fixture data for desktop/mobile visual inspection if local tools permit.

## Execution notes

User approved the HTML and explicitly requested direct implementation. Work proceeds in the existing feature branch `codex/notes-feed`; pre-existing untracked design previews are preserved. Visual-only changes use existing behavioral regressions and screenshot inspection rather than CSS implementation-mirroring tests. No production deployment is requested.

Completed: 603 tests, typecheck, lint (12 existing warnings), production build and route budgets passed. Actual built notes page inspected at desktop/mobile with isolated browser fixtures; evidence in docs/verification/design-system-v2-2026-11-15/. Independent review contrast findings corrected. No commit, push or deployment performed.

Final adjustment: user requested removal of the decorative card icon; removed its markup/import/style. Other workspace icons retain the unified specification.
