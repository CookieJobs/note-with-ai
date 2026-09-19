# NoteWithAI 运营后台受控生产发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从问题版本中仅恢复后台和已验证 UI 优化，推送专用分支并安全部署到既有线上 MongoDB。

**Architecture:** 发布分支从 `a9e1ebb` 出发，按固定历史提交恢复管理员身份、后台 API、无内容指标和 `/admin` 页面；随后只摘取 UI 提交 `e566a36`。通过路径白名单阻止普通用户端回归。服务器继续使用同机 Docker Mongo/Redis，在 HTTPS、密钥和 owner 初始化后切换。

**Tech Stack:** Next.js 15、Express 5、MongoDB 6、Redis 7、Docker Compose、Nginx、Let’s Encrypt。

**Spec:** `docs/superpowers/specs/2026-09-19-admin-production-extraction-design.md`

## Global Constraints

- 起点固定为 `a9e1ebb`，发布分支固定为 `codex/admin-production-release`；绝不合并 `50956a1`。
- 只允许后台目录和 Spec 列出的必要服务端接缝；不得恢复普通用户 React 页面、样式或既有功能改动。
- 任何冲突解决或新的生产代码都必须先写聚焦回归测试、观察失败，再作最小修复。
- 密钥、数据库 URI、密码、TOTP secret 和 provisioning URI 不得提交、写入文档或打印到持久日志。
- 部署前备份；不执行 `dropDatabase`、`mongorestore`、`git reset --hard` 或覆盖服务器 `.env`。
- 保留服务器已有的 OpenRouter/embedding Compose 配置。
- 首个 owner 的邮箱和显示名必须由用户明确提供，不能从预览、源码或数据库推断。

## Review Focus

- 不得出现 `frontend/src/app/admin/**` 外的前端文件变化。
- backend 容器必须接收 `ADMIN_JWT_SECRET`、`ADMIN_ENCRYPTION_KEY`、`ALLOWED_ORIGINS` 和既有 embedding 变量。
- HTTPS 管理 Cookie 必须为 `Secure`、`HttpOnly`、`SameSite=Strict`，Path 为 `/api/admin`。
- Admin API 不得返回笔记/聊天正文、Prompt、AI 回复、embedding 或密钥。
- 用户首页、笔记、聊天、登录和 `/api/health` 必须继续可用，普通用户 token 必须无权访问 Admin API。

---

### Task 1: 恢复管理员安全基础与认证审计

**Files:**
- Create: `backend/models/AdminAccount.ts`, `backend/models/AdminAuditLog.ts`, `backend/services/admin/adminCrypto.ts`, `backend/services/admin/adminAuthService.ts`, `backend/services/admin/adminAuditService.ts`, `backend/middleware/adminAuth.ts`, `backend/utils/adminJwt.ts`, `backend/routes/admin/auth.ts`, `backend/routes/admin/index.ts`, `backend/schemas/adminSchemas.ts`, `backend/scripts/create_admin.ts`.
- Modify: `backend/config/index.ts`, `backend/index.ts`, `backend/package.json`, `backend/package-lock.json`, `backend/.env.example`.
- Test: `backend/tests/adminCryptoAndBootstrap.test.ts`, `backend/tests/adminAuthAndRbac.test.ts`.

**Interfaces:** Produces independent admin JWT/TOTP encryption, fixed RBAC, audited Admin mutations and `/api/admin/auth/{login,logout,me}`. Consumes `ADMIN_JWT_SECRET`, `ADMIN_ENCRYPTION_KEY` and `ALLOWED_ORIGINS`.

- [ ] **Step 1: Confirm recovery root and clean source state**

Run:

```bash
git rev-parse --verify a9e1ebb
test "$(git merge-base HEAD a9e1ebb)" = "$(git rev-parse a9e1ebb)"
git status --short
```

Expected: only committed design documents precede source recovery; no source file is modified.

- [ ] **Step 2: Apply the exact security history with provenance**

Run:

```bash
git cherry-pick -x 2dda4d1 bf798b6 29bcb5d cc372cf d148f47 3ef08b9 6beb688
```

Expected: seven historical commits apply in order. A conflict requires a focused failing test for the affected security behavior before changing production code, then `git cherry-pick --continue` after the test passes.

- [ ] **Step 3: Verify security and bootstrap behavior**

Run:

```bash
env JWT_SECRET=release-test-jwt REDIS_URL=redis://127.0.0.1:6399 QQ_EMAIL_USER=release-test@example.invalid QQ_EMAIL_PASS=release-test-password ADMIN_LOCAL_PASSWORD_ONLY=false npm --prefix backend exec -- tsx --test tests/adminCryptoAndBootstrap.test.ts tests/adminAuthAndRbac.test.ts
npm --prefix backend run typecheck
```

Expected: focused tests and backend typecheck pass.

- [ ] **Step 4: Check the task path boundary**

Run:

```bash
git diff --name-only a9e1ebb..HEAD | rg -v '^(backend/(config|models/Admin|services/admin|middleware/adminAuth|utils/admin|routes/admin|schemas/admin|scripts/create_admin|tests/admin)|backend/(index\.ts|package(-lock)?\.json|\.env\.example)|docs/superpowers/)' && exit 1 || true
git diff --check a9e1ebb..HEAD
```

Expected: no unexpected path or whitespace error.

### Task 2: 恢复后台数据采集、运营接口与安全修复

**Files:**
- Create: `backend/models/{ProductEvent,AiUsageEvent,UserFeedback}.ts`, `backend/services/{productEventService,aiUsageService}.ts`, `backend/services/admin/{adminOverviewService,adminUserService,adminFeedbackService,adminAiService}.ts`, `backend/routes/{events,feedback}.ts`, `backend/routes/admin/{overview,system,users,audit,feedback,ai}.ts`.
- Modify: only backend service/model/route files required for metadata-only events, AI telemetry, disabled-user enforcement and admin operations.
- Test: `backend/tests/{productEvents,aiUsageTelemetry,adminOverviewAndSystem,adminUsersAndAudit,adminAiOperations,feedbackWorkflow}.test.ts`.

**Interfaces:** Produces overview/user/AI/feedback/system/audit APIs and metadata-only `ProductEvent`/`AiUsageEvent` records. Existing user requests keep their response contracts.

- [ ] **Step 1: Apply the complete ordered operations history**

Run:

```bash
git cherry-pick -x 2e0b3a1 ddc776a 5ae37d0 24f0606 fe341fb 5a17afe
```

Expected: only listed commits apply. Never cherry-pick `b8d7f9b`, `a45ad73`, `9eebfa6`, `eaeeb3b`, any frontend remediation commit, or `50956a1`. The later cross-layer Admin fixes deliberately belong to Task 3 because they edit both backend and Admin UI files.

- [ ] **Step 2: Run full backend and type verification**

Run:

```bash
env JWT_SECRET=release-test-jwt REDIS_URL=redis://127.0.0.1:6399 QQ_EMAIL_USER=release-test@example.invalid QQ_EMAIL_PASS=release-test-password ADMIN_LOCAL_PASSWORD_ONLY=false npm --prefix backend test
npm --prefix backend run typecheck
```

Expected: full suite passes, including admin, privacy, telemetry, feedback and pre-existing business tests.

- [ ] **Step 3: Enforce backend allowlist**

Run:

```bash
git diff --name-only a9e1ebb..HEAD > /tmp/admin-release-paths.txt
rg '^frontend/' /tmp/admin-release-paths.txt && exit 1 || true
rg '^(backend/(models/(Admin|ProductEvent|AiUsageEvent|UserFeedback)|services/(admin/|aiUsageService|productEventService|auth/AuthService|NoteUpdateOrchestrator|chatTurnCommitService|chatService|llmService|noteEmbeddingService|noteEnrichmentWorker|recommendService)|routes/(admin/|events|feedback)|middleware/adminAuth|schemas/adminSchemas|scripts/create_admin|tests/(admin|productEvents|aiUsageTelemetry|feedbackWorkflow)|types|utils/(admin|apiClient|embedding|userValidation)|config|index\.ts|package(-lock)?\.json|\.env\.example)|docs/superpowers/)' /tmp/admin-release-paths.txt
```

Expected: each changed backend path has an explicit admin, telemetry or disabled-user rationale.

### Task 3: 恢复基础后台页面并摘取已验证 UI 优化

**Files:**
- Create: `frontend/src/app/admin/{layout.tsx,login/page.tsx,page.tsx,admin.module.scss,lib/adminApi.ts,lib/contracts.ts}`, admin AI/users/feedback/system/audit pages and components.
- Modify from verified UI commit: only `frontend/src/app/admin/**`.
- Create: `frontend/src/app/admin/components/TrendChart.test.tsx`, `frontend/src/app/admin/lib/presentation.ts`.
- Documentation: `docs/verification/2026-09-19-admin-ui-refresh.md`.

**Interfaces:** Produces presentation-only `/admin` routes using `/api/admin/*`; it has no direct MongoDB access and cannot affect ordinary user routes.

- [ ] **Step 1: Restore the minimum historical Admin UI**

Run:

```bash
git cherry-pick -x bacb90f a954185 b6a4da1
npm --prefix frontend exec -- vitest run src/app/admin
npm --prefix frontend run typecheck
```

Expected: only admin paths are added; admin tests and typecheck pass. A conflict requires the associated Vitest test to fail before production UI code is edited.

- [ ] **Step 2: Apply cross-layer Admin acceptance and security fixes in their original dependency order**

Run:

```bash
git cherry-pick -x f902704 7699638 b92a164 d5a85de 3eab535 e81b604 3989cc5 4cf5b06 98cd927 8a5f442 36a4802 f67e6f7
env JWT_SECRET=release-test-jwt REDIS_URL=redis://127.0.0.1:6399 QQ_EMAIL_USER=release-test@example.invalid QQ_EMAIL_PASS=release-test-password ADMIN_LOCAL_PASSWORD_ONLY=false npm --prefix backend test
npm --prefix frontend exec -- vitest run src/app/admin
```

Expected: the original post-UI Admin security fixes apply after their UI targets exist; backend and Admin UI tests pass. No unrelated frontend path may be introduced.

- [ ] **Step 3: Verify the approved UI delivery scope before applying**

Run:

```bash
git show --name-only --format='' e566a36 | rg -v '^(frontend/src/app/admin/|docs/verification/2026-09-19-admin-ui-refresh\.md$)' && exit 1 || true
git show --check e566a36
```

Expected: exactly 22 approved files and no whitespace error.

- [ ] **Step 4: Apply UI polish as one provenance-preserving commit**

Run:

```bash
git cherry-pick -x e566a36
```

Expected: unified navigation, overview hierarchy, responsive tables, presentation helpers, session recovery and request-race protection appear only under Admin UI.

- [ ] **Step 5: Run full frontend verification**

Run:

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npx --prefix frontend eslint src/app/admin
git diff --check a9e1ebb..HEAD
```

Expected: frontend suite, typecheck, Admin lint and diff check pass.

### Task 4: 配置生产环境、HTTPS 模板与容器可运行性

**Files:**
- Modify: `docker-compose.yml`, `.env.example`, `backend/.env.example`, `deploy/nginx.conf.example`, `deploy/DEPLOY_GUIDE.md`.
- Verify: `backend/Dockerfile`, `frontend/Dockerfile`, compiled `dist/scripts/create_admin.js`.

**Interfaces:** Backend receives independent Admin secrets, `ALLOWED_ORIGINS` and current embedding variables. Nginx terminates TLS and forwards `/` to frontend and `/api/` to backend without stripping the prefix.

- [ ] **Step 1: Add non-secret backend environment forwarding**

Modify `docker-compose.yml` backend environment to include these exact key mappings:

```yaml
- OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
- OPENROUTER_BASE_URL=${OPENROUTER_BASE_URL}
- EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER}
- EMBEDDING_MODEL=${EMBEDDING_MODEL}
- EMBEDDING_DIMENSION=${EMBEDDING_DIMENSION}
- EMBEDDING_MODALITY=${EMBEDDING_MODALITY}
- EMBEDDING_QUERY_INPUT_TYPE=${EMBEDDING_QUERY_INPUT_TYPE}
- EMBEDDING_DOCUMENT_INPUT_TYPE=${EMBEDDING_DOCUMENT_INPUT_TYPE}
- ALLOWED_ORIGINS=${ALLOWED_ORIGINS}
- ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET}
- ADMIN_JWT_EXPIRES_IN=${ADMIN_JWT_EXPIRES_IN:-8h}
- ADMIN_ENCRYPTION_KEY=${ADMIN_ENCRYPTION_KEY}
```

Document key names only in env examples. Do not write a secret value to Git.

- [ ] **Step 2: Validate Compose with inert values**

Run:

```bash
env DEEPSEEK_API_KEY=x DASHSCOPE_API_KEY=x OPENROUTER_API_KEY=x OPENROUTER_BASE_URL=https://openrouter.ai/api/v1 EMBEDDING_PROVIDER=openrouter EMBEDDING_MODEL=model EMBEDDING_DIMENSION=2048 EMBEDDING_MODALITY=text EMBEDDING_QUERY_INPUT_TYPE=search_query EMBEDDING_DOCUMENT_INPUT_TYPE=search_document JWT_SECRET=ordinary-test-secret QQ_EMAIL_USER=test@example.invalid QQ_EMAIL_PASS=test-password ALLOWED_ORIGINS=https://bloomy16.com ADMIN_JWT_SECRET=independent-admin-test-secret-with-32-characters ADMIN_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= docker compose config
```

Expected: Compose exits 0 and exposes all required keys only in resolved local output.

- [ ] **Step 3: Update TLS template and deployment runbook**

Make `deploy/nginx.conf.example` contain an HTTP `bloomy16.com` server that allows ACME challenge requests and redirects all other requests to HTTPS, plus a TLS server with `location /` forwarding to `127.0.0.1:3000` and `location /api/` forwarding to `127.0.0.1:3001`. Document backup, certbot, config reload, health and rollback steps.

Run:

```bash
rg -n 'listen 443 ssl|ssl_certificate|return 301 https|location /api/|proxy_pass http://127\.0\.0\.1:3001' deploy/nginx.conf.example
git diff --check
```

Expected: all required TLS/proxy markers exist with a clean diff.

- [ ] **Step 4: Build images and prove the compiled owner CLI is available**

Run:

```bash
docker compose build backend frontend
docker compose run --rm --no-deps --entrypoint sh backend -c 'test -f dist/scripts/create_admin.js'
```

Expected: image build succeeds and the compiled owner CLI is present, proving production uses compiled JavaScript rather than unavailable `ts-node`.

- [ ] **Step 5: Commit deployment configuration**

Run:

```bash
git add docker-compose.yml .env.example backend/.env.example deploy/nginx.conf.example deploy/DEPLOY_GUIDE.md
git commit -m "chore(deploy): configure secure admin release"
```

Expected: staged diff contains no secret or generated artifact.

### Task 5: 全量验证、审核和 GitHub 推送

**Files:** Verify all source and deployment files from Tasks 1–4.

**Interfaces:** Produces `origin/codex/admin-production-release`, the only ref the server may deploy.

- [ ] **Step 1: Run full local verification**

Run:

```bash
env JWT_SECRET=release-test-jwt REDIS_URL=redis://127.0.0.1:6399 QQ_EMAIL_USER=release-test@example.invalid QQ_EMAIL_PASS=release-test-password ADMIN_LOCAL_PASSWORD_ONLY=false npm test
npm run typecheck
npm --prefix frontend run build
git diff --check a9e1ebb..HEAD
```

Expected: complete tests, both typechecks, production build and diff check pass.

- [ ] **Step 2: Review final scope and request the already-authorized Admin UI task to perform a fresh code review**

Run:

```bash
git diff --name-only a9e1ebb..HEAD | tee /tmp/admin-production-release-paths.txt
rg '^frontend/' /tmp/admin-production-release-paths.txt | rg -v '^frontend/src/app/admin/' && exit 1 || true
git log --oneline a9e1ebb..HEAD
git diff --stat a9e1ebb..HEAD
```

Expected: no prohibited frontend path. Send the review package to task `01a0afdf-10e3-7c83-b22a-fc2e694b679f`, which the user explicitly authorized for collaboration; resolve all Critical and Important findings before push.

- [ ] **Step 3: Push the release branch without force**

Run:

```bash
git push -u origin codex/admin-production-release
git ls-remote --heads origin refs/heads/codex/admin-production-release
```

Expected: remote SHA equals local `HEAD`.

### Task 6: 服务器备份、HTTPS、切换与线上验收

**Files:**
- Server-only: `/root/note-with-ai/.env`, `/etc/nginx/sites-available/default`, and a timestamped directory under `/root` whose name begins with `deploy-backup-`.

**Interfaces:** Server fetches the release branch, preserves data and existing Compose config, then exposes secure Admin UI at `https://bloomy16.com/admin`.

- [ ] **Step 1: Obtain owner identity before security-sensitive actions**

Get explicit `OWNER_EMAIL` and `OWNER_DISPLAY_NAME` from the user. Use `OWNER_EMAIL` for Let’s Encrypt renewal contact. Generate the owner password and TOTP seed only after TLS and container health checks; never infer an account identity from preview data.

- [ ] **Step 2: Create a reversible server snapshot and fetch release**

Run on server:

```bash
set -e
cd /root/note-with-ai
release_ts=$(date +%Y%m%d-%H%M%S)
backup_dir="/root/deploy-backup-${release_ts}"
mkdir -p "$backup_dir"
git rev-parse HEAD > "$backup_dir/commit.txt"
docker inspect --format '{{.Image}}' note-backend note-frontend > "$backup_dir/images.txt"
cp docker-compose.yml .env "$backup_dir/"
docker compose exec -T mongo mongodump --db note-with-ai --archive > "$backup_dir/mongo.archive"
test -s "$backup_dir/mongo.archive"
git fetch origin codex/admin-production-release
git show --stat --oneline FETCH_HEAD
```

Expected: nonempty Mongo archive, configuration backup and fetched release commit.

- [ ] **Step 3: Retain server-only Compose configuration while switching code**

Run:

```bash
git diff -- docker-compose.yml > "$backup_dir/server-compose.patch"
git checkout --detach FETCH_HEAD
git apply --3way "$backup_dir/server-compose.patch" || true
git diff -- docker-compose.yml
```

Expected: final Compose file contains existing embedding configuration and released Admin variables; `.env` is never overwritten.

- [ ] **Step 4: Configure secrets and TLS before enabling Admin login**

Generate independent `ADMIN_JWT_SECRET` and 32-byte base64 `ADMIN_ENCRYPTION_KEY` only on server, append missing values atomically to `.env`, set `ALLOWED_ORIGINS=https://bloomy16.com`, and run `chmod 600 .env`. Install Certbot/Nginx plugin, validate Nginx, issue the `bloomy16.com` certificate using `OWNER_EMAIL`, then reload Nginx. List only env key names afterward.

- [ ] **Step 5: Build, switch containers, create owner and verify production**

Run:

```bash
docker compose build backend frontend
docker compose up -d
docker compose ps
docker compose logs --tail=120 backend
curl -fsS http://127.0.0.1:3001/api/health
curl -I http://bloomy16.com/admin/login
curl -I https://bloomy16.com/admin/login
curl -fsS -o /dev/null -w 'home=%{http_code}\n' https://bloomy16.com/
curl -fsS -o /dev/null -w 'notes=%{http_code}\n' https://bloomy16.com/notes
curl -fsS -o /dev/null -w 'health=%{http_code}\n' https://bloomy16.com/api/health
curl -fsS -o /dev/null -w 'admin-login=%{http_code}\n' https://bloomy16.com/admin/login
docker compose exec -T mongo mongosh --quiet --eval 'db.getSiblingDB("note-with-ai").notes.countDocuments()'
```

Expected: HTTP redirects to HTTPS; ordinary pages, health and Admin login return successfully; note count is preserved and containers are stable. Only then run `node dist/scripts/create_admin.js` inside backend with one-time `ADMIN_CREATE_*` process variables and securely deliver its generated password/provisioning URI to the user.

- [ ] **Step 6: Verify authorization and preserve rollback evidence**

Verify ordinary user token is rejected by `/api/admin/auth/me`; verify owner login reads `/api/admin/overview` with a secure cookie. Record backup directory, old/new commits, image IDs, health results and the exact rollback procedure. Rollback restores prior code, Compose config and Nginx then rebuilds services; it does not restore Mongo without separate authorization because this release is additive.
