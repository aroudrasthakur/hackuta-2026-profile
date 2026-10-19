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

## Deploy backend

```bash
npm run convex:push-dev
```

Only run from this repo when profile Convex functions change. Schema must stay aligned with admin.

## Quality

```bash
npm run lint
npm run test:coverage
npm run test:e2e
```
