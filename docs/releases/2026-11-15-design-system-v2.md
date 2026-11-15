# Design System V2 production release — 2026-11-15

User authorized commit, push and production deployment after approving the visual upgrade and removing the card's decorative icon.

- Deployed application commit: `3e7f0cb399c53934bd010d59cc2930294d0d75f4`, pushed to `origin/codex/notes-feed`.
- Frontend image: `sha256:f84c63712e0fceec68187fa30841e8c768e85676f9d7fdb66ad7e052cfacad42` (`nwai-frontend:3e7f0cb`).
- Backend unchanged: `sha256:a66e0aaccf2b9f7c4aaba1388e7299b81b943cd084f06182a48790b16399b9f7`. Backend, Compose, Dockerfile and dependency manifests compared unchanged against the previously deployed source before a frontend-only switch.
- Prior server source: `ab425f1dfc7130e61058d1681a9024f4b44adc3c`.

## Verification

Local typecheck, 603 tests, lint (0 errors / 12 existing warnings) and production build passed after the icon removal. Server candidate `/notes`, `/auth`, and brand asset returned 200; compiled notes bundle contained no `cardIcon`. Candidate checks completed before the frontend switch. Release script exit code was 0, runtime image matched the candidate, backend runtime image stayed unchanged.

Public `/notes`, `/auth`, `/brand/icon-192.png`, `/api/health` returned 200; all 14 referenced Next assets were reachable. Public CSS contained the new visual tokens and no card icon style. Unauthenticated `/api/notes` returned 401. Authenticated production note creation/editing was not exercised.

## Backups and build exception

Workbench release directory: `/root/notewithai-releases/20261115-3e7f0cb/` (restricted permissions). Contains prior commit and image IDs, protected configuration copies, Mongo archive, saved rollback images, SHA256 checksums, attempt logs/scripts and final exit-code file. Both archived-image and database checksums verified after deployment. Rollback tags: `nwai-rollback-frontend:20261115-3e7f0cb` and `nwai-rollback-backend:20261115-3e7f0cb`.

The official Alpine repository stalled during dependency installation. Stopped the blocked builds before any service switch, verified the Aliyun Alpine mirror, then built with host networking and a release-local Dockerfile changing only the Alpine mirror. Repository Dockerfile and deployed application source remained unchanged. The effective Dockerfile is preserved in the release directory.

For code rollback, retag the retained frontend image to the Compose frontend tag and recreate only frontend using the preserved configuration, then verify both runtime IDs and public checks. Do not restore the database for a normal code rollback. No data volumes, old images or build caches were pruned. Disk after release: 94% used, approximately 2.6 GB free; capacity should be addressed before further large builds.
