# HackUTA 2026 — Participant profile

Participant portal for accepted (and registered) applicants. Shares the **standing-manatee-425** Convex deployment with [hackuta-2026-register](../hackuta-2026-register) and [hackuta-2026-admin](../hackuta-2026-admin).

## Local development

```bash
cp .env.example .env.local
npm install
npm run convex:codegen
npm run dev
```

Vite listens on **http://127.0.0.1:5473**.

Sign in uses the same Convex Auth password account created on the registration site. Forgot-password uses the shared Convex reset flow. Registration itself runs on the register app (`VITE_REGISTER_URL`), not in this router.

## Routes

| Path | Purpose |
| --- | --- |
| `/sign-in` | Sign in / forgot password |
| `/dashboard` | Participant portal (status, dates, QR when accepted) |

Legacy `src/pages/Register` and `src/pages/Profile` trees are reference copies (schema lock); they are not mounted in [main.tsx](src/main.tsx).

## Schema locks

| Lock | Command |
| --- | --- |
| Register-owned Convex + shared files | `npm run verify:register-schema-lock` |
| Admin-owned `convex/admin/**` | `npm run verify:admin-schema-lock` |

Profile-owned code lives under `convex/profile/`, `src/`, and `tests/`. Do not edit locked register or admin modules without refreshing the corresponding lock from the source repo.

Register is in production. Do not run `register-schema-lock:refresh` in this repo or in admin unless the register repo itself has shipped a backend change.

## Deploy backend

This repo is the only Convex push path. Register does not push. Admin `convex:dev`, `convex:push-dev`, and `convex:deploy` refuse so an admin-only upload cannot drop `convex/profile`.

After admin Convex, `convex/schema.ts`, or shared admin helper changes in the admin repo:

```bash
npm run admin-schema-lock:refresh
npm run verify:admin-schema-lock
```

Commit the copied files here, then push from this repo.

### Shared dev

```bash
npm run convex:push-dev
```

### Production

For issue #103, complete the [notification removal release checks](#issue-103-release-checks) before uploading the backend.

1. `npm run check:whitespace && npm run verify:register-schema-lock && npm run verify:admin-schema-lock && npm run lint && npm run typecheck && npm run test:coverage && npm run build`
2. `npm run convex:deploy` (runs both schema locks first)
3. Deploy the admin and profile frontends. The register Vercel app stays as it is.

### Issue #103 release checks

The synchronized backend combines admin branch `refactor/103-remove-notification-backend`, reviewed at `e9709da17d238e9aa7040d40d3071084e72d4c1c` ([#104](https://github.com/aroudrasthakur/hackuta-2026-admin/pull/104), [#105](https://github.com/aroudrasthakur/hackuta-2026-admin/pull/105), [#107](https://github.com/aroudrasthakur/hackuta-2026-admin/pull/107)), with admin `main` at `302ed67` ([#106](https://github.com/aroudrasthakur/hackuta-2026-admin/pull/106)). This preserves the `checkedIn` table migration already integrated by profile [#16](https://github.com/aroudrasthakur/hackuta-2026-profile/pull/16). The admin stack must also retain that migration when integrated. After the admin stack reaches `main`, refresh and verify the admin lock again before release.

Before deploying the final schema removal, confirm the owner's empty-data assumption for `participantNotifications`, legacy `shopFlashSales.notificationId`, and notification-specific `staffConfigLogs.action` values and `targetNotificationId`. Check for jobs targeting `admin/notifications:publishScheduledNotification`; cancel pending jobs and let running jobs finish before removing the handler. If incompatible records exist, stop the schema upload and resolve them safely. Preserve sales, sale items, purchases, inventory, participants, and unrelated audit records. Follow admin's [release instructions](../hackuta-2026-admin/docs/OPERATIONS.md#releasing-issue-103).

These changes do not perform live-data cleanup, cancel deployed jobs, or deploy Convex. Deployment must run exclusively from this repository after coordinated review and the checks above. Authentication and application decision emails retain their existing flows.

## Quality

```bash
npm run lint
npm run test:coverage
npm run test:e2e
```
