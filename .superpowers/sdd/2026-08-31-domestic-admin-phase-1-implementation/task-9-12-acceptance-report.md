# Task 9–12 acceptance report

## Verdict

**DONE.** All Phase 1 acceptance gates and every open item from acceptance-fix round 3 are implemented and covered by interaction tests. No unresolved item remains.

This round started from clean commit `3eab535e07f59b3ba83179ad697fae065db7fa80` on `codex/domestic-admin-phase1-luna-cont`.

## Acceptance-fix evidence

| Area | Implemented behavior | Interaction evidence |
|---|---|---|
| Feedback | Category/status/assignment/date filters, submitted-filter pagination, nested pagination, editable status/internal note/self-assignment (both `true` and `false`), pending/error/success feedback, canonical refetch, and viewer read-only presentation. | `feedback/page.test.tsx` submits every filter and paginates it; asserts the exact PATCH body `{ status, internalNote, assignedToSelf }`; separately asserts clearing assignment sends `false`; covers pending, rejected mutation without refetch, successful refetch, viewer controls absent, recovery, and empty state. |
| Users list | Draft search does not request until submit; query/status/createdFrom/createdTo are sent together and retained for pagination; loading, recovery, and empty states are explicit. | `users/users.test.tsx` drives every input, submit, pagination, and retry through the rendered UI and asserts request URLs. |
| User detail | Viewer responses are defensively masked even if the server sends a malicious exact email. Owner/operator status control uses the canonical reason command, does not update optimistically, shows pending/error/success, and refetches only after success. | `users/users.test.tsx` injects a malicious viewer payload and asserts the exact email is absent; asserts POST path/body, pre-refetch display, canonical refetch, visible success, visible error, no failed-command refetch, loading, and recovery. |
| AI | Identity, usage, and failures have independent loading/error/data/empty state; usage switches 7/30 days without coupling failure pagination; failures paginate independently; calls/success/tokens/cost/coverage are displayed and unknown values say `数据积累中`; retry is role-gated and exposes pending/result/error with canonical refetch. | `ai/page.test.tsx` independently resolves/rejects all three requests, changes range, paginates failures, checks metrics and unknown semantics, asserts the exact retry POST body, checks pending/result/error, checks refetch, and verifies viewer controls are absent. |
| Audit | Actor/action/status/from/to filters and retained pagination are present. Metadata rendering uses a frontend hard-coded allowlist and bounded scalar values only; unknown and nested values such as `secret` never render; pending uncertainty is explicit. | `audit/page.test.tsx` drives filters/pagination and injects safe, unknown, nested, and secret metadata; it asserts the safe result and absence of the unsafe values, plus loading/recovery/empty. |
| Overview | Range-specific loading/error/data/empty state, 7/30-day switching, same-selected-range retry, metrics/trend, success/token/cost coverage, and unknown retention semantics. | `page.test.tsx` holds the request pending, changes range, rejects then retries and asserts the identical range URL, checks the explicit empty state, all metrics, `数据积累中`, and an accessible trend. |
| System | Safe fields only, healthy/degraded semantics, nullable metric semantics, loading/error/retry. | `system/page.test.tsx` covers delayed success, degraded/null data, and visible recovery. |
| Shared API | Every admin request uses `credentials: 'include'`; caller Authorization is removed; POST/PATCH JSON is canonical; no production localStorage or ordinary `authFetch`; 401 redirects only to `/admin/login`; 403 remains inline. | New `lib/adminApi.test.ts` asserts fetch options, header removal, method/bodies, typed errors, 401 redirect, and no 403 redirect. |
| Shell and login | Exact role navigation, session loading, inline 403, admin logout, no login-page session request; login has a generic rejection message and a disabled/pending submit state. | `components/AdminShell.test.tsx` covers all four roles, exact labels/hrefs, session states, logout and login bypass. `login/page.test.tsx` covers submitted credentials, pending state, success redirect, and generic failure. |
| Reason dialog | Trimmed 5–200-character validation, pending/error/retry, one Escape close, Escape disabled while pending, focus containment, and focus restoration. | New `components/ReasonDialog.test.tsx` exercises boundary inputs, rejected and retried submit, keyboard events, single-close counting, tab containment, and restored trigger focus. |
| Maintainability | Admin TS/TSX contracts and pages are normal multiline, typed implementations; the modified admin TypeScript contains no `any`; the compressed one-line admin stylesheet was expanded into reviewable rules. | `rg`/`awk` scans below find no `any` and no lines over 180 characters in admin TS/TSX/SCSS. |

The eight required existing test areas were all materially rewritten and strengthened. The canonical shell test path in the implementation plan/repository is `frontend/src/app/admin/components/AdminShell.test.tsx` (not `frontend/src/components/AdminShell.test.tsx`). Two focused suites were added for `adminApi` and `ReasonDialog`. These tests use rendered UI interaction and observable requests/results; none rely on static source inspection.

## Spec result matrix

| Spec result | Evidence | Status |
|---|---|---|
| 1. Independent admin session/TOTP | Existing hardened backend admin-auth contract remains green; shell/login use only `/api/admin/auth/*`. | met |
| 2. HttpOnly cookie/no localStorage | `adminApi.ts` always uses cookie credentials and strips Authorization; focused request tests and production scans pass. | met |
| 3. Overview metrics/trends | Range switching, metrics, coverage, trend accessibility, empty/error/retry behavior are implemented and tested. | met |
| 4. Content-free first-party events | Existing backend projection/telemetry security tests remain green. | met |
| 5. Privacy-safe user metadata | List uses masked identity; detail defensively suppresses exact email for viewers, including hostile payloads. | met |
| 6. Audited user status command | Exact reason POST body, pending/error/success visibility, no optimistic state, and canonical refetch are tested. | met |
| 7. AI usage telemetry | Independent dashboard states and calls/success/token/cost/coverage semantics are implemented and tested. | met |
| 8. Safe failed-artifact retry | Role control, exact revision-aware retry body, visible result/error, and canonical refetch are tested. | met |
| 9. Feedback workflow | Complete filters, nested pagination, editable workflow fields, true/false assignment and viewer read-only behavior are tested. | met |
| 10. Health and read-only audit | System safe states and audit hard-coded metadata allowlist/read-only route are verified. | met |
| 11. Verification | Focused, complete backend/frontend, build, root verification, lint, diff and security scans below all pass. | met |

## Verification commands and actual results

All commands were run from `/Users/liujin/.codex/worktrees/599a/noteWithAI` unless a different directory is stated.

1. `npm --prefix backend run typecheck`
   - exit 0; TypeScript passed.
2. `npm --prefix backend test`
   - exit 0; **21 suites, 110 tests passed, 0 failed**.
3. `npm --prefix frontend run typecheck`
   - exit 0; TypeScript passed with incremental compilation disabled by the script.
4. `npm --prefix frontend test -- src/app/admin/components/AdminShell.test.tsx src/app/admin/login/page.test.tsx src/app/admin/page.test.tsx src/app/admin/users/users.test.tsx src/app/admin/ai/page.test.tsx src/app/admin/feedback/page.test.tsx src/app/admin/system/page.test.tsx src/app/admin/audit/page.test.tsx src/app/admin/lib/adminApi.test.ts src/app/admin/components/ReasonDialog.test.tsx`
   - exit 0; **10 files, 63 tests passed, 0 failed**.
5. `npm --prefix frontend test`
   - exit 0; **22 files, 140 tests passed, 0 failed**.
6. `npm --prefix frontend run build`
   - exit 0; Next.js production build compiled, typechecked, and generated all 17 pages successfully; no compiler or lint warning.
7. `node_modules/.bin/eslint src/app/admin` (from `frontend`)
   - exit 0; no output and no warnings.
8. `npm run verify`
   - exit 0; backend and frontend typechecks passed; **110 backend + 140 frontend tests passed, 0 failed**. Redis fallback warning lines in the backend output are intentional assertions from failure-path tests, not verification failures.
9. `rg -n "content|contentText|contentJson|messages|prompt|embedding|recommendCache" backend/routes/admin backend/services/admin`
   - only expected bounded implementation matches: the overview activation lookup, public feedback `content`, and the `embedding` artifact enum. No note body/message/prompt or derived-content projection is exposed.
10. `rg -n "router\.(post|put|patch|delete)" backend/routes/admin/audit.ts`
    - exit 1/no matches, confirming the audit route has no mutation handler.
11. `rg -n "localStorage|authFetch|Authorization" frontend/src/app/admin`
    - matches only negative assertions/test names and `headers.delete('Authorization')`; production contains no localStorage/authFetch use and cannot send an Authorization header.
12. `rg -n "\bany\b" frontend/src/app/admin -g '*.ts' -g '*.tsx'`
    - exit 1/no matches.
13. `awk 'length($0) > 180 { print FNR ":" length($0) ":" FILENAME }' $(rg --files frontend/src/app/admin | rg '\.(ts|tsx|scss)$')`
    - exit 0/no matches.
14. `git diff --check`
    - exit 0/no whitespace errors.

## Open concerns

None. No backend contract change was necessary in this round; the existing backend allowlists and all 110 backend tests remain intact.
