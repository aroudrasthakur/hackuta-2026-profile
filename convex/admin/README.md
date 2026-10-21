# Admin Convex functions (`convex/admin/`)

Organizer-only queries, mutations, and internal actions. **Admin-owned** — safe to add and edit files here.

## Overview

| Path | Summary |
| --- | --- |
| [auth.ts](auth.ts) | Organizer sign-in, sign-out, session lookup, credential provisioning |
| [staffAuth.ts](staffAuth.ts) | Session resolution and reusable reviewer/admin authorization helpers |
| [applications.ts](applications.ts) | Read-only application queue and submitted application detail (no audit logs on list) |
| [passwordHash.ts](passwordHash.ts) | Scrypt password hash + verify |
| [fields.ts](fields.ts) | Shared Convex validators for admin-owned tables |
| [participantCreation.ts](participantCreation.ts) | Idempotent participant lookup/insert (`applicationId` + `authUserId`) |
| [acceptanceDecision.ts](acceptanceDecision.ts) | Atomic accept → review update + audit log + participant row |
| [applicationReviewLogs.ts](applicationReviewLogs.ts) | Review activity, confirmed decisions, and admin-only history (requires `sessionToken`) |
| [decisionFinalize.ts](decisionFinalize.ts) | Idempotent final decision: review patch, audit log, decision email schedule |
| [decisionEmailTemplates.ts](decisionEmailTemplates.ts) | Plain-text copy for acceptance, rejection, and waitlist emails |
| [decisionEmailService.ts](decisionEmailService.ts) | Decision mail via register-locked `sendMailMessage` (same email service HTTP client) |
| [sendDecisionEmails.ts](sendDecisionEmails.ts) | Internal action that sends decision notifications |
| [participants.ts](participants.ts) | `createParticipantFromAcceptance` — internal entry point for the helper |

## Authentication

Organizer auth is **independent** from applicant Convex Auth (`convex/auth.ts`).

| Table | Purpose |
| --- | --- |
| `admins` | Identity, `role`, `active` — source of truth for authorization |
| `adminAuthAccounts` | One password hash per admin (`adminId`) |
| `adminSessions` | Hashed session tokens with `expiresAt` |

Protected queries and mutations accept `sessionToken`. The helpers take `(ctx, sessionToken)` because internal authentication uses explicit session tokens:

- `getCurrentAdmin` returns the active `admins` record, or `null` for an invalid, expired, revoked, or orphaned session.
- `requireReviewerAccess` allows active reviewers and admins; activity logging and application decisions use it.
- `requireAdminRole` allows only active admins; historical review log queries use it.

Each protected request resolves the current stored role and active status. Acting identity always comes from the returned `admin._id`, including `applicationReviews.reviewedBy`, `applicationReviewLogs.adminId`, and `participants.acceptedBy`; public operations never accept an acting admin ID or role. Applicant authentication cannot satisfy these guards.

Application decisions require a submitted application, even if a draft already has a review row. Both the submission flag and legacy submission timestamp are supported. Draft rejection leaves the application, review, audit logs, and participants unchanged.

The SPA obtains the token from `/api/admin/session-token`, which reads an HttpOnly cookie set by `/api/admin/sign-in`. Sign-in clears any prior sessions for that admin. These functions use the existing `standing-manatee-425` deployment configured in `.env.example`.

`getApplication` uses `requireReviewerAccess` before reading applicant data. It returns `null` for malformed, missing, or unsubmitted applications, and returns resume availability separately from the application. A missing review record remains missing; reading detail never creates review rows, audit events, or participants. No historical reviewer logs are returned.

After detail loads, the page calls `logApplicationReviewAction` with `action: "viewed"`. The mutation requires a submitted application and appends an event with the session-derived admin ID and server timestamp. Repeated visits remain separate events; viewing never claims the application or changes review state.

## Schema notes

- `applicationReviews` — register-origin table editable in [schema.ts](../schema.ts); holds the current or final review state per application. `reviewedBy` (an `admins` id) is always set from the session, never from client args. `started_review` claims the review via [reviewClaim.ts](reviewClaim.ts): active claims block silent takeover, stale claims reset `startedAt`, and final decisions cannot restart review. `viewed` is log-only; decisions set `completedAt`. Decision patches live in [reviewState.ts](reviewState.ts).
- `admins` — admin-only table.
- `applicationReviewLogs` — append-only activity history; full history is restricted to admins.
- `participants` — admin-only table; one row per accepted application (reuses `users`). Copies `foodRestriction` from the linked application when the row is created; other profile fields stay on `applications`.

Registration reads/writes for applicants remain in register-locked modules ([applications.ts](../applications.ts), [registrations.ts](../registrations.ts), etc.).

## Waitlist decisions

Waitlisted applicants can be accepted through the same confirmed decision mutation. This appends an acceptance event, creates the participant atomically, and schedules an acceptance email. The earlier waitlist event remains in history. Accepted, rejected, and withdrawn decisions cannot be changed through this workflow; repeated confirmation of the same recorded decision is idempotent.

## Related

| Location | Role |
| --- | --- |
| [pages/admin/README.md](../../src/pages/admin/README.md) | UI routes that will call these functions |
| [REGISTER_SCHEMA.md](../REGISTER_SCHEMA.md) | Lock policy |

Parent index: [../README.md](../README.md).
