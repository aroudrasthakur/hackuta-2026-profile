# Volunteer authorization contract

This document is the **server-side** contract for volunteer, participant, and event operations. Keep it next to [staffAuth.ts](staffAuth.ts) when adding scan APIs or admin tooling.

## Route redirects are not protection

The SPA may send volunteers to `/volunteer` and hide review routes. That improves UX only. **Every** public Convex query or mutation that reads or writes participant rows, event rows, point balances, scan logs, or volunteer configuration must enforce authorization **inside the handler** before touching data.

Applicant Convex Auth (`convex/auth.ts`) never satisfies staff guards.

## Guard layer (use these; do not reimplement)

| Helper | Who may pass | Use before |
| --- | --- | --- |
| `requireReviewerAccess` | Active reviewer or admin | Application list/detail, review activity, decisions, decision-email queue reads |
| `requireAdminRole` | Active admin | Review history, sample apps, organizer provisioning, decision-email hold/retry/release, all of `volunteerAccounts.ts` |
| `requireVolunteerAccess` | Active volunteer only | Any volunteer-only participant/event operation (check-in, food, point scan UI) |
| `requireVolunteerCapability` | Volunteer with explicit `true` on `canCheckIn` or `canFoodCheckIn` | Door check-in or food scan mutations (missing flag = denied) |
| `requireVolunteerEventAccess` | Volunteer with a **current** `volunteerEventAccess` row and an **active** event | Point scan mutations that award event-fixed points |

Admins and reviewers **cannot** call volunteer guards: they receive `VOLUNTEER_ONLY`. Volunteers **cannot** call review guards: they receive `NOT_AUTHORIZED`.

Acting identity always comes from the guard return value (`admin._id`). Never trust client-supplied admin ids, roles, or capabilities.

## Event assignment semantics (invariant)

- Permission to award an event's points is **only** the presence of a `volunteerEventAccess` row for `(volunteerAdminId, eventId)` at the time of the request.
- **Removing** an assignment (`setVolunteerEventAccess` with `granted: false`) deletes the row in that transaction. The volunteer loses access on the **next** scan request; there is no caching of assignments in sessions.
- `events.startsAt` / `events.endsAt` are **reference schedule only**. They do **not** gate scanning (see [pointsLedger.ts](pointsLedger.ts)).
- Inactive or missing events reject even when an assignment row still exists (`EVENT_INACTIVE`, `EVENT_NOT_FOUND`).

## Ledger helpers are not auth boundaries

[pointsLedger.ts](pointsLedger.ts) exports **internal** helpers (`awardEventPoints`, `adjustPoints`, `requireEligibleParticipant`, `computeLedgerPoints`). They are **not** registered as public Convex functions.

- `awardEventPoints` writes awards, balances, and `point_scan` logs. It does **not** verify volunteer session, capability, or event assignment. A public point-scan mutation **must** call `requireVolunteerEventAccess` (and any capability guard) first, then pass `actorAdminId` from the returned volunteer and `now` from the server.
- `adjustPoints` enforces admin role on the **stored** `actorAdminId` argument only. Public admin-adjust APIs must call `requireAdminRole` first and pass that admin's id.

If you add a new public mutation that imports `pointsLedger`, add a row to the entry-point audit in [volunteer-public-entrypoints.test.ts](../../tests/integration/volunteer-public-entrypoints.test.ts) and call the appropriate guard before any ledger or participant read/write.

## Public entry points (current)

| Module | Export | Required guard |
| --- | --- | --- |
| `auth.ts` | `signIn`, `signOut` | Public auth flow (no staff session) |
| `auth.ts` | `getCurrentStaff` | Session lookup only; no participant/event data |
| `auth.ts` | `createAndProvisionAdmin` | `requireAdminRole` |
| `applications.ts` | `listSubmittedApplications`, `getApplication` | `requireReviewerAccess` |
| `applications.ts` | `createSampleApplication` | `requireAdminRole` |
| `applicationReviewLogs.ts` | `logApplicationReviewAction`, `setApplicationDecision` | `requireReviewerAccess` |
| `applicationReviewLogs.ts` | `listApplicationReviewLogs` | `requireAdminRole` |
| `decisionEmailQueue.ts` | `listDecisionEmailQueue` | `requireReviewerAccess` |
| `decisionEmailQueue.ts` | `setDecisionEmailHold`, `retryFailedDecisionEmails`, `claimDecisionEmails` | `requireAdminRole` |
| `decisionEmailRelease.ts` | `releaseDecisionEmails` | Admin session via action wrapper |
| `volunteerAccounts.ts` | all exports | `requireAdminRole` |
| `participants.ts` | — | **Internal only** (`internalMutation`) |
| `pointsLedger.ts`, `pointsBackfill.ts` | — | **Helpers / internal only** |

Future volunteer scan modules belong in `convex/admin/` and must follow the guard table above.

## Deployment note

Profile owns [schema.ts](../schema.ts). After admin-owned Convex changes, run `npm run admin-schema-lock:refresh` in **hackuta-2026-profile** and deploy Convex from profile (`npm run convex:push-dev` / `convex:deploy`), not from this repo.
