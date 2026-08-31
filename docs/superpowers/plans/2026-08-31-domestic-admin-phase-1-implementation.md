# NoteWithAI Domestic Admin Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the assigned worktree. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch the implementation to a different user-visible Session.

**Goal:** Build a secure, first-party, zero-subscription domestic operations admin covering overview metrics, users, AI usage/failures, feedback, system health, and immutable audit history.

**Architecture:** Add a native `/admin` area to the existing Next.js frontend and explicit `/api/admin/*` use-case routes to the existing Express backend. Keep MongoDB as the only persistent store; isolate admin identity/session/RBAC from ordinary users, collect privacy-minimized product/AI telemetry at authoritative backend boundaries, and route every admin mutation through an audited command.

**Tech Stack:** TypeScript, Express 5, Mongoose 8, Zod 4, Next.js 15 App Router, React 18, bcryptjs, OTPAuth, HttpOnly JWT cookie, node:test, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-31-domestic-admin-phase-1-design.md`

## Global Constraints

- Do not add GA4, Firebase, Appsmith, Umami, PostHog, Grafana, PostgreSQL, ClickHouse, a queue, an event bus, or another running service.
- Do not expose Note/Chat body, Prompt, AI reply, embedding vector, provider raw response, secret, Cookie, password, or OTP through events, admin DTOs, audit, or logs.
- Admin identity is separate from `User`; admin JWT uses `ADMIN_JWT_SECRET`, lives only in `nwai_admin_session`, and is checked against `AdminAccount.isActive` plus `tokenVersion` on every request.
- Admin mutations require both role permission and allowed `Origin`, create a `pending` audit before the command, and finish that audit as `succeeded` or `failed`.
- Product telemetry failure must not fail an already successful user write; admin mutation/audit failure is not best-effort.
- Use `Asia/Shanghai` for day boundaries, cap admin date ranges at 90 days, and cap list limits at 100.
- Provider Token fields are real usage or `null`; never invent Token values. Cost is `null` when Token or configured price is unavailable.
- Write every behavior test first, observe the focused failure, implement the smallest production change, rerun the focused test, and commit the independently testable task.
- Preserve unrelated user files and changes. Do not add `.impeccable/` or `PRODUCT.md` to any commit.

## Locked File Structure

Backend security and contracts:

- `backend/models/AdminAccount.ts`: separate administrator persistence.
- `backend/models/AdminAuditLog.ts`: append-only mutation/security audit.
- `backend/models/ProductEvent.ts`: allowlisted first-party behavior events.
- `backend/models/AiUsageEvent.ts`: content-free provider call telemetry.
- `backend/models/UserFeedback.ts`: user feedback and internal workflow state.
- `backend/services/admin/adminCrypto.ts`: AES-256-GCM TOTP-secret encryption/decryption.
- `backend/services/admin/adminAuthService.ts`: password/TOTP login and session identity.
- `backend/services/admin/adminAuditService.ts`: pending/succeeded/failed audited command runner.
- `backend/services/admin/adminOverviewService.ts`: bounded metric aggregation.
- `backend/services/admin/adminUserService.ts`: privacy-safe user queries and status command.
- `backend/services/admin/adminAiService.ts`: usage/failure queries and revision-safe retry.
- `backend/services/admin/adminFeedbackService.ts`: feedback queries and audited transitions.
- `backend/services/productEventService.ts`: strict event write API and active-day dedupe.
- `backend/services/aiUsageService.ts`: provider telemetry lifecycle and pricing.
- `backend/middleware/adminAuth.ts`: cookie session, role, Origin, request-id, no-store.
- `backend/utils/adminJwt.ts`: admin-only signing and verification.
- `backend/schemas/adminSchemas.ts`: all admin route schemas.
- `backend/routes/admin/*.ts`: explicit Admin HTTP adapters.
- `backend/routes/events.ts`: authenticated `association_opened` adapter only.
- `backend/routes/feedback.ts`: authenticated user feedback submission.
- `backend/scripts/create_admin.ts`: owner bootstrap CLI; no bootstrap HTTP route.

Frontend admin application:

- `frontend/src/app/admin/lib/adminApi.ts`: credentialed admin-only fetch; never imports ordinary `authFetch`.
- `frontend/src/app/admin/lib/contracts.ts`: admin response DTOs.
- `frontend/src/app/admin/components/AdminShell.tsx`: session guard, navigation, role filtering.
- `frontend/src/app/admin/components/*.tsx`: focused metric/table/dialog primitives.
- `frontend/src/app/admin/login/page.tsx`: email/password/TOTP login.
- `frontend/src/app/admin/layout.tsx`: admin metadata and isolated styling boundary.
- `frontend/src/app/admin/page.tsx`: overview.
- `frontend/src/app/admin/users/page.tsx` and `users/[id]/page.tsx`.
- `frontend/src/app/admin/ai/page.tsx`.
- `frontend/src/app/admin/feedback/page.tsx`.
- `frontend/src/app/admin/system/page.tsx`.
- `frontend/src/app/admin/audit/page.tsx`.
- `frontend/src/app/admin/admin.module.scss`: shared admin visual system.

Do not create generic repositories, base controllers, arbitrary collection CRUD, a shared frontend store, or a generalized workflow framework.

---

### Task 1: Admin persistence, encryption, and bootstrap CLI

**Files:**
- Create: `backend/models/AdminAccount.ts`
- Create: `backend/models/AdminAuditLog.ts`
- Create: `backend/services/admin/adminCrypto.ts`
- Create: `backend/scripts/create_admin.ts`
- Create: `backend/tests/adminCryptoAndBootstrap.test.ts`
- Modify: `backend/config/index.ts`
- Modify: `backend/.env.example`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`

**Interfaces:**
- Produces: `AdminRole`, `AdminAccount`, `encryptAdminSecret(secret)`, `decryptAdminSecret(payload)`, `AdminAuditLog`, and `npm run admin:create`.
- Consumes later: `ADMIN_JWT_SECRET`, `ADMIN_JWT_EXPIRES_IN`, `ADMIN_ENCRYPTION_KEY`, optional AI price variables.

- [ ] **Step 1: Add failing crypto/model tests**

Test round-trip, random IV/non-deterministic ciphertext, authentication-tag rejection, schema secrecy, role enum, unique email/requestId indexes, and production config rejection when admin secrets equal ordinary secrets. Use a fixed 32-byte test key:

```ts
process.env.ADMIN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const encryptedA = encryptAdminSecret('JBSWY3DPEHPK3PXP');
const encryptedB = encryptAdminSecret('JBSWY3DPEHPK3PXP');
assert.notEqual(encryptedA, encryptedB);
assert.equal(decryptAdminSecret(encryptedA), 'JBSWY3DPEHPK3PXP');
assert.throws(() => decryptAdminSecret(`${encryptedA.slice(0, -1)}A`));
```

- [ ] **Step 2: Run the focused test and confirm it fails because the modules do not exist**

Run: `npm --prefix backend exec -- tsx --test backend/tests/adminCryptoAndBootstrap.test.ts`

- [ ] **Step 3: Install only the security dependency and implement focused models/config**

Run: `npm --prefix backend install otpauth`

Use AES-256-GCM payload format `v1.<iv-base64url>.<ciphertext-base64url>.<tag-base64url>`. Parse `ADMIN_ENCRYPTION_KEY` as base64 and require exactly 32 bytes. Extend config with:

```ts
ADMIN_JWT_SECRET: z.string().min(32),
ADMIN_JWT_EXPIRES_IN: z.string().default('8h'),
ADMIN_ENCRYPTION_KEY: z.string().min(1),
AI_PRICING_EFFECTIVE_AT: z.string().datetime().optional(),
DEEPSEEK_CHAT_INPUT_CNY_PER_MILLION: z.coerce.number().nonnegative().optional(),
DEEPSEEK_CHAT_OUTPUT_CNY_PER_MILLION: z.coerce.number().nonnegative().optional(),
OPENROUTER_EMBEDDING_CNY_PER_MILLION: z.coerce.number().nonnegative().optional(),
DASHSCOPE_EMBEDDING_CNY_PER_MILLION: z.coerce.number().nonnegative().optional(),
```

In test/development, allow explicit safe test defaults so existing test imports do not fail. In production, reject missing admin secrets and `ADMIN_JWT_SECRET === JWT_SECRET`.

- [ ] **Step 4: Implement bootstrap script without an HTTP escape hatch**

Read `ADMIN_CREATE_EMAIL`, `ADMIN_CREATE_DISPLAY_NAME`, `ADMIN_CREATE_PASSWORD`, optional `ADMIN_CREATE_ROLE` (default `owner`), and optional `ADMIN_CREATE_TOTP_SECRET`. Validate a 12-character alphanumeric password minimum, hash with bcrypt, encrypt the TOTP secret, upsert only when `ADMIN_CREATE_ALLOW_UPDATE=true`, and print only the provisioning URI plus created email—not password, hash, encryption payload, or DB URI.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
npm --prefix backend exec -- tsx --test backend/tests/adminCryptoAndBootstrap.test.ts
npm --prefix backend run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add backend/models/AdminAccount.ts backend/models/AdminAuditLog.ts backend/services/admin/adminCrypto.ts backend/scripts/create_admin.ts backend/tests/adminCryptoAndBootstrap.test.ts backend/config/index.ts backend/.env.example backend/package.json backend/package-lock.json
git commit -m "feat(admin): add secure admin identity storage"
```

---

### Task 2: Admin session, RBAC, Origin defense, and audit runner

**Files:**
- Create: `backend/utils/adminJwt.ts`
- Create: `backend/services/admin/adminAuthService.ts`
- Create: `backend/services/admin/adminAuditService.ts`
- Create: `backend/middleware/adminAuth.ts`
- Create: `backend/schemas/adminSchemas.ts`
- Create: `backend/routes/admin/auth.ts`
- Create: `backend/routes/admin/index.ts`
- Create: `backend/tests/adminAuthAndRbac.test.ts`
- Modify: `backend/index.ts`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`

**Interfaces:**
- Produces: `AdminJwtPayload`, `signAdminToken`, `verifyAdminToken`, `requireAdmin`, `requireAdminPermission(permission)`, `requireAdminMutationOrigin`, `runAuditedAdminCommand`, and `/api/admin/auth/{login,logout,me}`.
- `Express.Request.admin` is `{ id, email, displayName, role }`; `Express.Request.requestId` is a UUID.

- [ ] **Step 1: Add failing route/middleware tests**

Cover missing cookie, ordinary Bearer JWT, wrong `typ`, inactive admin, stale `tokenVersion`, each permission matrix branch, missing/mismatched mutation Origin, login anti-enumeration, TOTP window, cookie attributes, logout, no-store, and request ID. Assert the login failure envelope is identical for missing account, wrong password, and wrong OTP.

```ts
assert.equal(response.headers['cache-control'], 'no-store');
assert.match(response.headers['set-cookie'], /nwai_admin_session=/);
assert.match(response.headers['set-cookie'], /HttpOnly/);
assert.match(response.headers['set-cookie'], /SameSite=Strict/);
assert.match(response.headers['set-cookie'], /Path=\/api\/admin/);
```

- [ ] **Step 2: Run focused test and observe the missing modules/routes failure**

Run: `npm --prefix backend exec -- tsx --test backend/tests/adminAuthAndRbac.test.ts`

- [ ] **Step 3: Add cookie parsing and implement admin-only JWT/session**

Run: `npm --prefix backend install cookie-parser && npm --prefix backend install -D @types/cookie-parser`

Mount `cookieParser()` before routes. Use `typ: 'admin'`, separate secret, 8-hour default, DB validation per request, and an exact permission map:

```ts
type AdminPermission =
  | 'overview:read' | 'users:read' | 'users:status'
  | 'ai:read' | 'ai:retry' | 'feedback:read' | 'feedback:write'
  | 'system:read' | 'audit:read' | 'admins:manage';
```

Do not reuse `authenticateToken`, `authFetch`, or ordinary user local storage.

- [ ] **Step 4: Implement login rate limiting, Cookie, Origin, and audit lifecycle**

Use the existing Redis-backed `RateLimitService` pattern where available; keep the login error generic. Record content-free security audit entries for login success/failure and permission denial; a failed login may omit `actorId` but may include normalized email hash, request ID, IP, and outcome, never raw password/OTP. `runAuditedAdminCommand` must create `{ status:'pending' }`, run the supplied command, update `succeeded` with safe result metadata, or update `failed` with normalized code before rethrowing:

```ts
async function runAuditedAdminCommand<T>(input: AuditCommandInput, command: () => Promise<T>): Promise<T>
```

No audit update/delete HTTP routes may exist.

- [ ] **Step 5: Mount `/api/admin` and rerun focused verification**

Run:

```bash
npm --prefix backend exec -- tsx --test backend/tests/adminAuthAndRbac.test.ts
npm --prefix backend run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add backend/utils/adminJwt.ts backend/services/admin/adminAuthService.ts backend/services/admin/adminAuditService.ts backend/middleware/adminAuth.ts backend/schemas/adminSchemas.ts backend/routes/admin backend/tests/adminAuthAndRbac.test.ts backend/index.ts backend/package.json backend/package-lock.json
git commit -m "feat(admin): secure admin sessions and audited RBAC"
```

---

### Task 3: Privacy-minimized product events and disabled-user enforcement

**Files:**
- Create: `backend/models/ProductEvent.ts`
- Create: `backend/services/productEventService.ts`
- Create: `backend/routes/events.ts`
- Create: `backend/tests/productEvents.test.ts`
- Modify: `backend/models/User.ts`
- Modify: `backend/services/auth/AuthService.ts`
- Modify: `backend/utils/userValidation.ts`
- Modify: `backend/services/NoteUpdateOrchestrator.ts`
- Modify: `backend/services/chatTurnCommitService.ts`
- Modify: `backend/index.ts`

**Interfaces:**
- Produces: `trackProductEvent(input): Promise<void>`, `trackProductEventBestEffort(input): void`, `trackActiveDay(userId): void`, and authenticated `POST /api/events` for `association_opened` only.
- Event properties are event-specific strict schemas and cannot contain arbitrary records.

- [ ] **Step 1: Add failing event/privacy tests**

Cover allowlisted names, rejection of `note_created` from the browser route, stripping/rejecting extra properties, 100-character property limit, Shanghai day key, active-day unique upsert, 400-day TTL schema index, and best-effort logging. Add regression tests proving both `validateAndGetUser` and `authenticateUser` reject `isActive=false` after JWT verification.

```ts
await assert.rejects(
  () => ProductEventService.recordWebEvent('user-1', 'note_created' as never, {}),
  /不允许上报/
);
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm --prefix backend exec -- tsx --test backend/tests/productEvents.test.ts`

- [ ] **Step 3: Implement model/service and authoritative hooks**

Record `user_registered` after registration persistence, `note_created` after canonical Note creation, `chat_turn_committed` after committed session save, and `feedback_submitted` in Task 7. Call `trackActiveDay` after an active user is loaded. Keep telemetry writes outside transaction-critical results and log only event name/user ID/error code on failure.

- [ ] **Step 4: Add the one public web event adapter**

`POST /api/events` accepts exactly:

```ts
{ name: 'association_opened', properties: { surface: 'notes' | 'chat' } }
```

It derives user ID from authentication, returns 202, and rejects all other names/keys.

- [ ] **Step 5: Run focused tests plus affected auth/note/chat tests**

Run:

```bash
npm --prefix backend exec -- tsx --test backend/tests/productEvents.test.ts backend/tests/authFlowService.test.ts backend/tests/noteWriteModule.test.ts backend/tests/chatTurnCommitService.test.ts
npm --prefix backend run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add backend/models/ProductEvent.ts backend/services/productEventService.ts backend/routes/events.ts backend/tests/productEvents.test.ts backend/models/User.ts backend/services/auth/AuthService.ts backend/utils/userValidation.ts backend/services/NoteUpdateOrchestrator.ts backend/services/chatTurnCommitService.ts backend/index.ts
git commit -m "feat(analytics): record first-party product events"
```

---

### Task 4: Content-free AI usage telemetry

**Files:**
- Create: `backend/models/AiUsageEvent.ts`
- Create: `backend/services/aiUsageService.ts`
- Create: `backend/tests/aiUsageTelemetry.test.ts`
- Modify: `backend/utils/apiClient.ts`
- Modify: `backend/services/llmService.ts`
- Modify: `backend/services/chatService.ts`
- Modify: `backend/services/chatTurnCommitService.ts`
- Modify: `backend/services/noteEnrichmentWorker.ts`
- Modify: `backend/services/noteEmbeddingService.ts`
- Modify: `backend/services/recommendService.ts`
- Modify: `backend/services/vectorStore.ts`

**Interfaces:**
- Produces:

```ts
type AiTelemetryContext = {
  requestId: string;
  userId?: string;
  operation: 'chat' | 'chat_title' | 'note_meta' | 'note_concepts' | 'rerank' | 'embedding' | 'care_intro';
};

type ProviderUsage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
```

- Provider adapters accept explicit telemetry context and persist one terminal `AiUsageEvent` per request ID.

- [ ] **Step 1: Add failing telemetry tests**

Test non-streaming success with real usage, success without usage (`null`), provider failure, streaming completion usage, client abort, unique request ID, CNY micro-cost with configured price, missing-price `null`, and a recursive forbidden-key assertion proving saved documents do not contain `messages`, `content`, `prompt`, `response`, `body`, `email`, or provider raw payload.

```ts
assert.deepEqual(saved, {
  requestId: 'req-1', provider: 'deepseek', model: 'deepseek-chat',
  operation: 'chat', status: 'succeeded', inputTokens: 12,
  outputTokens: 8, totalTokens: 20, currency: 'CNY',
  // startedAt/finishedAt/durationMs and configured cost asserted separately
});
```

- [ ] **Step 2: Run focused test and observe missing telemetry failure**

Run: `npm --prefix backend exec -- tsx --test backend/tests/aiUsageTelemetry.test.ts`

- [ ] **Step 3: Implement lifecycle/pricing service**

Implement `AiUsageService.run(context, providerInfo, call)` and a streaming recorder with an idempotent terminal write. Store normalized error codes only. Compute micro-CNY at record time only when the relevant input/output token fields and price exist.

- [ ] **Step 4: Instrument provider boundaries while preserving existing return contracts**

Extend `DeepSeekResponse` with provider `usage`, request stream usage with `stream_options: { include_usage: true }`, and pass telemetry context from Chat, Note enrichment, rerank, care intro, and embedding paths. Preserve callers that expect a string/async iterable. Do not log raw provider response.

- [ ] **Step 5: Run focused and affected AI tests**

Run:

```bash
npm --prefix backend exec -- tsx --test backend/tests/aiUsageTelemetry.test.ts backend/tests/noteEnrichmentWorker.test.ts backend/tests/embeddingProvider.test.ts backend/tests/chatTurnCommitService.test.ts backend/tests/recommendService.test.ts
npm --prefix backend run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add backend/models/AiUsageEvent.ts backend/services/aiUsageService.ts backend/tests/aiUsageTelemetry.test.ts backend/utils/apiClient.ts backend/services/llmService.ts backend/services/chatService.ts backend/services/chatTurnCommitService.ts backend/services/noteEnrichmentWorker.ts backend/services/noteEmbeddingService.ts backend/services/recommendService.ts backend/services/vectorStore.ts
git commit -m "feat(analytics): meter AI calls without content"
```

---

### Task 5: Overview and system-health Admin APIs

**Files:**
- Create: `backend/services/admin/adminOverviewService.ts`
- Create: `backend/routes/admin/overview.ts`
- Create: `backend/routes/admin/system.ts`
- Create: `backend/tests/adminOverviewAndSystem.test.ts`
- Modify: `backend/routes/admin/index.ts`

**Interfaces:**
- Produces: `getOverview({ range, now })`, `getSystemHealth()`, `GET /overview`, and `GET /system/health`.
- Overview returns `summary`, `timeseries`, `retention`, `tokenCoverage`, and `costCoverage` with explicit `null` for unavailable retention/cost.

- [ ] **Step 1: Add failing aggregation/contract tests**

Use fixed Shanghai boundary timestamps. Cover 7d/30d, reject 91d/arbitrary values, DAU/WAU/MAU distinct users, activation, empty data, missing retention window, known-token coverage, missing pricing, current failed artifact counts, no private fields, and health response secret/internal-address exclusion.

```ts
assert.equal(result.retention.d30, null);
assert.equal(result.coverage.tokens.knownCalls, 2);
assert.equal(result.coverage.tokens.totalSucceededCalls, 3);
assert.ok(!JSON.stringify(result).includes('content'));
```

- [ ] **Step 2: Run focused test and confirm failure**

Run: `npm --prefix backend exec -- tsx --test backend/tests/adminOverviewAndSystem.test.ts`

- [ ] **Step 3: Implement bounded indexed aggregations**

Use existing model collections plus `ProductEvent` and `AiUsageEvent`; never hydrate Note/Chat documents. Project only timestamps, IDs, revision, and enrichment status needed for counts. Use `Promise.all` for independent aggregates and fixed date buckets filled with zero in service code.

- [ ] **Step 4: Mount permission-protected no-store routes**

Both routes require `overview:read` or `system:read`; return only public application version, process uptime, Mongo ready state label, failure counts, and 24h AI success rate.

- [ ] **Step 5: Run focused tests and typecheck, then commit**

```bash
npm --prefix backend exec -- tsx --test backend/tests/adminOverviewAndSystem.test.ts
npm --prefix backend run typecheck
git add backend/services/admin/adminOverviewService.ts backend/routes/admin/overview.ts backend/routes/admin/system.ts backend/tests/adminOverviewAndSystem.test.ts backend/routes/admin/index.ts
git commit -m "feat(admin): expose private overview and health metrics"
```

---

### Task 6: Privacy-safe user management and immutable audit query

**Files:**
- Create: `backend/services/admin/adminUserService.ts`
- Create: `backend/routes/admin/users.ts`
- Create: `backend/routes/admin/audit.ts`
- Create: `backend/tests/adminUsersAndAudit.test.ts`
- Modify: `backend/schemas/adminSchemas.ts`
- Modify: `backend/routes/admin/index.ts`

**Interfaces:**
- Produces: paginated `AdminUserView`, role-aware email projection, idempotent `setUserActive`, and read-only audit query.

- [ ] **Step 1: Add failing privacy/RBAC/audit tests**

Cover exact ID/email and username-prefix search, status/date filters, limit=101 rejection, masked list email, viewer masked detail, support full detail but no mutation, owner/operator mutation, 5–200 reason, idempotency, no password/content/vector in serialized DTO, disabled existing-token regression, pending/succeeded/failed audit, and absence of POST/PATCH/DELETE audit routes.

```ts
assert.deepEqual(Object.keys(userView).sort(), [
  'aiCalls30d','aiKnownTokens30d','chatCount','createdAt','id','isActive',
  'isVerified','lastActiveAt','maskedEmail','noteCount','username'
].sort());
```

- [ ] **Step 2: Run focused test and observe failure**

Run: `npm --prefix backend exec -- tsx --test backend/tests/adminUsersAndAudit.test.ts`

- [ ] **Step 3: Implement aggregation projections and audited status command**

Use `$lookup`/group projections or bounded parallel count queries without loading content fields. `setUserActive` filters by ID, uses `$set`, returns canonical state, and is wrapped by `runAuditedAdminCommand` with action `user.status_changed` and reason.

- [ ] **Step 4: Implement read-only audit adapter**

Support actor/action/status/date pagination for owner/operator. Return safe metadata only; there must be no audit mutation service exported to routes beyond the internal lifecycle updater.

- [ ] **Step 5: Verify and commit**

```bash
npm --prefix backend exec -- tsx --test backend/tests/adminUsersAndAudit.test.ts backend/tests/productEvents.test.ts
npm --prefix backend run typecheck
git add backend/services/admin/adminUserService.ts backend/routes/admin/users.ts backend/routes/admin/audit.ts backend/tests/adminUsersAndAudit.test.ts backend/schemas/adminSchemas.ts backend/routes/admin/index.ts
git commit -m "feat(admin): manage users with privacy-safe audit"
```

---

### Task 7: Feedback submission and audited workflow

**Files:**
- Create: `backend/models/UserFeedback.ts`
- Create: `backend/services/admin/adminFeedbackService.ts`
- Create: `backend/routes/feedback.ts`
- Create: `backend/routes/admin/feedback.ts`
- Create: `backend/tests/feedbackWorkflow.test.ts`
- Modify: `backend/services/productEventService.ts`
- Modify: `backend/schemas/adminSchemas.ts`
- Modify: `backend/routes/admin/index.ts`
- Modify: `backend/index.ts`

**Interfaces:**
- Produces: authenticated `POST /api/feedback`, paginated admin feedback query, and audited `PATCH /api/admin/feedback/:id`.

- [ ] **Step 1: Add failing submission/workflow tests**

Cover ordinary authentication, content 5–2000, contact/appVersion limits, strict category enum, five submissions per user/hour, product response excluding `internalNote`, `feedback_submitted` event, viewer read-only, support/operator/owner update, empty patch rejection, resolution timestamp set/cleared, and audit result.

- [ ] **Step 2: Run focused test and observe failure**

Run: `npm --prefix backend exec -- tsx --test backend/tests/feedbackWorkflow.test.ts`

- [ ] **Step 3: Implement model, user adapter, and best-effort event**

Enforce the hourly limit with a count over `{ userId, createdAt: { $gte: oneHourAgo } }`; save user content only in `UserFeedback`, never in `ProductEvent` or logs. Return `{ id }` to the user.

- [ ] **Step 4: Implement admin query/update command**

Allow status, category, date, user ID filters. Interpret `assignedToSelf=true` from authenticated admin ID. Wrap updates with action `feedback.updated`; audit only changed field names and IDs, never feedback content/internal note text.

- [ ] **Step 5: Verify and commit**

```bash
npm --prefix backend exec -- tsx --test backend/tests/feedbackWorkflow.test.ts backend/tests/productEvents.test.ts backend/tests/adminAuthAndRbac.test.ts
npm --prefix backend run typecheck
git add backend/models/UserFeedback.ts backend/services/admin/adminFeedbackService.ts backend/routes/feedback.ts backend/routes/admin/feedback.ts backend/tests/feedbackWorkflow.test.ts backend/services/productEventService.ts backend/schemas/adminSchemas.ts backend/routes/admin/index.ts backend/index.ts
git commit -m "feat(feedback): add first-party feedback workflow"
```

---

### Task 8: AI usage/failure Admin APIs and revision-safe retry

**Files:**
- Create: `backend/services/admin/adminAiService.ts`
- Create: `backend/routes/admin/ai.ts`
- Create: `backend/tests/adminAiOperations.test.ts`
- Modify: `backend/schemas/adminSchemas.ts`
- Modify: `backend/routes/admin/index.ts`

**Interfaces:**
- Produces: usage summary, content-free failed artifact list, and `retryFailedArtifact({ noteId, artifact, expectedRevision, reason, admin })`.

- [ ] **Step 1: Add failing usage/failure/retry tests**

Cover 7d/30d usage, provider/operation grouping, success and Token/cost coverage, content-free projection, permissions, ObjectId/reason validation, exact revision, failed+sourceRevision precondition, atomic `failed -> pending`, concurrent second retry rejection, worker `saved|failed|stale`, and pending/succeeded/failed audit.

```ts
assert.deepEqual(failure, {
  noteId: 'note-1', userId: 'user-1', artifact: 'embedding',
  sourceRevision: 4, currentRevision: 4,
  attemptedAt: '2026-08-31T00:00:00.000Z', errorCode: 'NOTE_ENRICHMENT_EMBEDDING_FAILED'
});
```

- [ ] **Step 2: Run focused test and observe failure**

Run: `npm --prefix backend exec -- tsx --test backend/tests/adminAiOperations.test.ts`

- [ ] **Step 3: Implement usage and failure projections**

Use `$objectToArray` on `enrichment` or three explicit bounded pipelines, projecting only the fields in the Spec. Never select title, summary, content, contentText, contentJson, keywords, embedding, or recommendCache.

- [ ] **Step 4: Implement audited CAS retry**

Use `Note.updateOne` filtered by `_id`, `revision`, `enrichment.<artifact>.status:'failed'`, and matching source revision. Set only the artifact state to pending with `{ timestamps:false }`, then call `runProductionNoteEnrichmentTask`. Do not add batch or automatic retry.

- [ ] **Step 5: Verify and commit**

```bash
npm --prefix backend exec -- tsx --test backend/tests/adminAiOperations.test.ts backend/tests/noteEnrichmentWorker.test.ts
npm --prefix backend run typecheck
git add backend/services/admin/adminAiService.ts backend/routes/admin/ai.ts backend/tests/adminAiOperations.test.ts backend/schemas/adminSchemas.ts backend/routes/admin/index.ts
git commit -m "feat(admin): inspect and retry failed AI artifacts"
```

---

### Task 9: Admin frontend foundation and session-safe navigation

**Files:**
- Create: `frontend/src/app/admin/lib/contracts.ts`
- Create: `frontend/src/app/admin/lib/adminApi.ts`
- Create: `frontend/src/app/admin/components/AdminShell.tsx`
- Create: `frontend/src/app/admin/components/AdminShell.test.tsx`
- Create: `frontend/src/app/admin/login/page.tsx`
- Create: `frontend/src/app/admin/login/page.test.tsx`
- Create: `frontend/src/app/admin/layout.tsx`
- Create: `frontend/src/app/admin/admin.module.scss`

**Interfaces:**
- Produces: `adminFetch<T>()`, `AdminIdentity`, role-aware `AdminShell`, login/logout/session behavior, and shared admin layout styles.

- [ ] **Step 1: Add failing frontend auth/shell tests**

Cover `credentials:'include'`, absence of `Authorization` and localStorage writes, unauthenticated redirect, valid shell, role-filtered navigation, 401 redirect, 403 inline permission state without ordinary `logout()`, login fields/OTP, generic login failure, and logout.

```ts
expect(fetch).toHaveBeenCalledWith('/api/admin/auth/me', expect.objectContaining({ credentials: 'include' }));
expect(localStorage.getItem('token')).toBeNull();
```

- [ ] **Step 2: Run focused Vitest and observe failure**

Run: `npm --prefix frontend test -- src/app/admin/components/AdminShell.test.tsx src/app/admin/login/page.test.tsx`

- [ ] **Step 3: Implement admin API client and isolated shell**

Do not import `frontend/src/utils/auth.ts`. Define an `AdminApiError` carrying HTTP status/code. `AdminShell` loads `/auth/me`, renders loading/error/session states, and uses exact role rules matching the backend while treating them as presentation only.

- [ ] **Step 4: Implement accessible login and styles**

Use labels for email/password/6-digit OTP, pending disable, generic error, and no ordinary-user navigation. Use the existing SCSS stack and Lucide icons; do not add a UI or chart dependency.

- [ ] **Step 5: Verify and commit**

```bash
npm --prefix frontend test -- src/app/admin/components/AdminShell.test.tsx src/app/admin/login/page.test.tsx
npm --prefix frontend run typecheck
git add frontend/src/app/admin
git commit -m "feat(admin-ui): add secure admin session shell"
```

---

### Task 10: Overview, users, and AI admin pages

**Files:**
- Create: `frontend/src/app/admin/components/MetricCard.tsx`
- Create: `frontend/src/app/admin/components/TrendChart.tsx`
- Create: `frontend/src/app/admin/components/ReasonDialog.tsx`
- Create: `frontend/src/app/admin/page.tsx`
- Create: `frontend/src/app/admin/page.test.tsx`
- Create: `frontend/src/app/admin/users/page.tsx`
- Create: `frontend/src/app/admin/users/[id]/page.tsx`
- Create: `frontend/src/app/admin/users/users.test.tsx`
- Create: `frontend/src/app/admin/ai/page.tsx`
- Create: `frontend/src/app/admin/ai/page.test.tsx`
- Modify: `frontend/src/app/admin/admin.module.scss`

**Interfaces:**
- Consumes: Task 5/6/8 Admin API contracts.
- Produces: functional overview, user management, and AI usage/failure pages.

- [ ] **Step 1: Add failing page tests**

Cover overview loading/empty/error/7d/30d, retention null text “数据积累中”, Token/cost coverage, SVG trend accessibility; user search/pagination/privacy/detail, reason validation, canonical refresh after status command, no optimistic mutation; AI usage groups, failure list, reason dialog, retry status, and role-hidden actions.

- [ ] **Step 2: Run focused tests and observe failure**

Run: `npm --prefix frontend test -- src/app/admin/page.test.tsx src/app/admin/users/users.test.tsx src/app/admin/ai/page.test.tsx`

- [ ] **Step 3: Implement shared focused components**

`TrendChart` uses an SVG polyline/path with textual summary and does not add a chart package. `ReasonDialog` requires 5–200 characters, supports pending/error, traps focus sufficiently for the existing component style, closes on Escape only when not pending, and never uses `window.confirm()`.

- [ ] **Step 4: Implement pages against canonical Admin API**

Every page renders loading, empty, error, and success. After a user-status or retry mutation, refetch the affected canonical resource. Never render hidden/private fields even if a malformed mock includes them.

- [ ] **Step 5: Verify and commit**

```bash
npm --prefix frontend test -- src/app/admin/page.test.tsx src/app/admin/users/users.test.tsx src/app/admin/ai/page.test.tsx
npm --prefix frontend run typecheck
git add frontend/src/app/admin
git commit -m "feat(admin-ui): add overview users and AI operations"
```

---

### Task 11: Feedback, system, and read-only audit pages

**Files:**
- Create: `frontend/src/app/admin/feedback/page.tsx`
- Create: `frontend/src/app/admin/feedback/page.test.tsx`
- Create: `frontend/src/app/admin/system/page.tsx`
- Create: `frontend/src/app/admin/system/page.test.tsx`
- Create: `frontend/src/app/admin/audit/page.tsx`
- Create: `frontend/src/app/admin/audit/page.test.tsx`
- Modify: `frontend/src/app/admin/admin.module.scss`

**Interfaces:**
- Consumes: feedback/system/audit Admin API.
- Produces: remaining Phase 1 admin pages with no audit write affordance.

- [ ] **Step 1: Add failing tests**

Cover feedback filters/pagination/status/internal note/pending/error/role readonly; health degraded/healthy labels without secrets; audit actor/action/status/date filters, pending uncertainty indicator, safe metadata rendering, and explicit absence of edit/delete controls.

- [ ] **Step 2: Run focused tests and observe failure**

Run: `npm --prefix frontend test -- src/app/admin/feedback/page.test.tsx src/app/admin/system/page.test.tsx src/app/admin/audit/page.test.tsx`

- [ ] **Step 3: Implement the three pages**

Render feedback user content only on the feedback page, never in audit. Display audit metadata from a safe key/value allowlist; do not recursively dump arbitrary server JSON. Display system version/state/uptime/failure counts only.

- [ ] **Step 4: Verify and commit**

```bash
npm --prefix frontend test -- src/app/admin/feedback/page.test.tsx src/app/admin/system/page.test.tsx src/app/admin/audit/page.test.tsx
npm --prefix frontend run typecheck
git add frontend/src/app/admin
git commit -m "feat(admin-ui): add feedback system and audit pages"
```

---

### Task 12: Cross-cutting security review, documentation, and full verification

**Files:**
- Modify: `README.md`
- Modify: `backend/.env.example`
- Modify: implementation files only when verification exposes a defect
- Update: `docs/superpowers/plans/2026-08-31-domestic-admin-phase-1-implementation.md` checkboxes

**Interfaces:**
- Produces: operator setup instructions, completed plan evidence, and a clean verified branch.

- [ ] **Step 1: Run targeted forbidden-data and route inventory checks**

Run:

```bash
rg -n "content|contentText|contentJson|messages|prompt|embedding|recommendCache" backend/routes/admin backend/services/admin
rg -n "router\.(post|put|patch|delete)" backend/routes/admin/audit.ts
rg -n "localStorage|authFetch|Authorization" frontend/src/app/admin
```

Inspect every match. Legitimate negative projections/test assertions are acceptable; no admin DTO/log/audit leak, audit mutation route, ordinary auth reuse, or localStorage admin session is acceptable.

- [ ] **Step 2: Document secure setup and operational boundaries**

Add README instructions for required admin secrets, `npm --prefix backend run admin:create`, TOTP provisioning, `/admin/login`, price-coverage semantics, no-content analytics, and the fact that no third-party analytics/admin service is deployed. Do not include real secret examples.

- [ ] **Step 3: Run all required verification**

Run in order and record exit code plus test counts in the execution report:

```bash
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
npm run verify
git diff --check
git status --short
```

- [ ] **Step 4: Review against every measurable Spec result**

Create a 1–11 acceptance matrix in the execution Session final report. For each result, cite the implementing file(s), test(s), and verification evidence. List any result not fully met as an explicit blocker; do not describe partial behavior as complete.

- [ ] **Step 5: Final commit**

```bash
git add README.md backend/.env.example docs/superpowers/plans/2026-08-31-domestic-admin-phase-1-implementation.md
git commit -m "docs(admin): document secure operations setup"
```

The execution Session must then report its branch name and final commit SHA to the parent Session and wait for acceptance. It must not merge, cherry-pick, or modify the parent worktree.
