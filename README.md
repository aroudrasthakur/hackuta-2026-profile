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

1. `npm run check:whitespace && npm run verify:register-schema-lock && npm run verify:admin-schema-lock && npm run lint && npm run typecheck && npm run test:coverage && npm run build`
2. `npm run convex:deploy` (runs both schema locks first)
3. Deploy the admin and profile frontends. The register Vercel app stays as it is.

## Quality

```bash
npm run lint
npm run test:coverage
npm run test:e2e
```
