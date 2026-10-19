# Convex backend (`convex/`)

Server functions, schema, HTTP routes, and auth for the shared HackUTA deployment. This repo is the **sole deploy path** — [hackuta-2026-register](../hackuta-2026-register) does not push backend code.

Generated types live in [_generated/](_generated/) (gitignored). Local typecheck uses a stub from [scripts/ensure-convex-server-stub.mjs](../scripts/ensure-convex-server-stub.mjs).

## Schema ownership

| Doc | Purpose |
| --- | --- |
| [**REGISTER_SCHEMA.md**](REGISTER_SCHEMA.md) | Locked registration tables and files (read first) |
| [`schema.ts`](schema.ts) | Deployment schema |
| [`../hackuta-2026-register/convex/schema.ts`](../hackuta-2026-register/convex/schema.ts) | Live reference in register repo |

**Editable:** admin-owned tables in `schema.ts` (including `adminAuthAccounts`, `adminSessions`), plus [`admin/`](admin/README.md).

**Frozen:** all other top-level modules, [`lib/`](lib/README.md), [`email/`](email/README.md), and all of [`shared/`](../shared/README.md).

```bash
npm run verify:register-schema-lock
npm run convex:push-dev
```

## Overview

| Path | Summary | Lock |
| --- | --- | --- |
| [schema.ts](schema.ts) | Deployment schema | Partial — see REGISTER_SCHEMA.md |
| [REGISTER_SCHEMA.md](REGISTER_SCHEMA.md) | Register lock policy | Admin docs |
| [auth.ts](auth.ts) | Convex Auth — password, sign-up OTP, password-reset OTP | Register-locked |
| [passwordReset.ts](passwordReset.ts) | Session invalidation after password reset | Register-locked |
| [auth.config.ts](auth.config.ts) | Auth provider configuration | Register-locked |
| [applicant.ts](applicant.ts) | Application bootstrap and routing state | Register-locked |
| [applications.ts](applications.ts) | Draft save/load and applicant dashboard | Register-locked |
| [registrations.ts](registrations.ts) | Application submission | Register-locked |
| [resumeUploads.ts](resumeUploads.ts) | Upload sessions, rate limits, cleanup | Register-locked |
| [http.ts](http.ts) | Resume upload + Auth HTTP routes | Register-locked |
| [rateLimits.ts](rateLimits.ts) | OTP throttling | Register-locked |
| [resumeUploadSecurity.ts](resumeUploadSecurity.ts) | Upload origin allowlist | Register-locked |
| [emailDeliveries.ts](emailDeliveries.ts) | Email queue-ID tracking | Register-locked |
| [eventConfig.ts](eventConfig.ts) | Hackathon timeline (server) | Register-locked |
| [maintenance.ts](maintenance.ts) | Internal resetAllData (**destructive**) | Register-locked |
| [migrations.ts](migrations.ts) | One-time data migrations | Register-locked |
| [crons.ts](crons.ts) | Scheduled resume-session cleanup | Register-locked |
| [applicationFields.ts](applicationFields.ts) | Convex validators from shared field registry | Register-locked |
| [lib/](lib/README.md) | Shared server helpers | Register-locked |
| [email/](email/README.md) | Email service client and actions | Register-locked |
| [admin/](admin/README.md) | Organizer queries and mutations | **Admin-owned** |

## Nested README index

| Directory | README |
| --- | --- |
| lib/ | [lib/README.md](lib/README.md) |
| email/ | [email/README.md](email/README.md) |
| admin/ | [admin/README.md](admin/README.md) |

## Configuration and operations

| Task | Command / location |
| --- | --- |
| Push to shared dev | npm run convex:push-dev |
| Deploy production | npm run convex:deploy |
| Verify register lock | npm run verify:register-schema-lock |
| Operator docs | [docs/OPERATIONS.md](../docs/OPERATIONS.md) |

## Related

| Location | Role |
| --- | --- |
| [shared/README.md](../shared/README.md) | Isomorphic validation |
| [src/README.md](../src/README.md) | Admin SPA |
| [scripts/README.md](../scripts/README.md) | Codegen stub and lock scripts |

Parent index: [README.md](../README.md).
