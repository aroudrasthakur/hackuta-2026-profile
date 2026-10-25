# Volunteer authorization contract

This document is the **server-side** contract for volunteer, participant, and event operations. Keep it next to [staffAuth.ts](staffAuth.ts) when adding scan APIs or admin tooling.

## Route redirects are not protection

The SPA may send volunteers to `/volunteer` and hide review routes. That improves UX only. **Every** public Convex query or mutation that reads or writes participant rows, event rows, point balances, scan logs, or volunteer configuration must enforce authorization **inside the handler** before touching data.

Applicant Convex Auth (`convex/auth.ts`) never satisfies staff guards.

## Guard layer (use these; do not reimplement)

| Helper | Who may pass | Use before |
| --- | --- | --- |
| `requireReviewerAccess` | Active reviewer or admin | Application list/detail, review activity, decisions, decision-email queue reads |
| `requireAdminRole` | Active admin | Review history, sample apps, organizer provisioning, decision-email hold/retry/release, all of `volunteers.ts` |
| `requireVolunteerAccess` | Active volunteer only | Any volunteer-only participant/event operation (check-in, food, point scan UI) |
| `requireVolunteerCapability` | Volunteer with explicit `true` on `canCheckIn` or `canFoodCheckIn` | Door check-in or food scan mutations (missing flag = denied) |
| `requireVolunteerEventAccess` | Volunteer with a **current** `volunteerEventAccess` row and an **active** event | Point scan mutations that award event-fixed points |

Admins and reviewers **cannot** call volunteer guards: they receive `VOLUNTEER_ONLY`. Volunteers **cannot** call review guards: they receive `NOT_AUTHORIZED`.

Acting identity always comes from the guard return value (`admin._id`). Never trust client-supplied admin ids, roles, or capabilities.

## Event assignment semantics (invariant)

- Permission to award an event's points is **only** the presence of a `volunteerEventAccess` row for `(volunteerAdminId, eventId)` at the time of the request.
- **Removing** an assignment (leaving the event out of the `setVolunteerEventAccess` list) deletes the row in that transaction. The volunteer loses access on the **next** scan request; there is no caching of assignments in sessions.
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
| `volunteers.ts` | all exports (accounts, capabilities, event access, `listVolunteerActionLogs`, `listStaffConfigLogs`) | `requireAdminRole` |
| `participantsAdmin.ts` | all exports (`listParticipants`, `getParticipantDetails`, `setParticipantPoints`, `listPointAdjustments`, `promoteParticipantToVolunteer`) | `requireAdminRole` |
| `volunteerProvisioning.ts`, `adminQueryHelpers.ts` | — | **Helpers only** (callers must guard first) |
| `volunteerScan.ts` | `listMyScanOptions`, `resolveQrForScan` | `requireVolunteerAccess`, then per-purpose capability / assignment checks |
| `volunteerScanRateLimit.ts` | `pruneVolunteerScanRateLimits` | **Internal only** (`internalMutation`) |
| `participants.ts` | — | **Internal only** (`internalMutation`) |
| `pointsLedger.ts`, `pointsBackfill.ts` | — | **Helpers / internal only** |

Future volunteer scan modules belong in `convex/admin/` and must follow the guard table above.

## QR scan preview (`volunteerScan.ts`)

`resolveQrForScan` only **previews** a participant. It writes nothing except rate-limit rows. The check-in, food, and point-award mutations that come later must re-run the session guard, the capability or assignment check, the eligibility check (`requireEligibleParticipant`), and the event check themselves. A preview result is never proof of permission.

Order inside the handler:

1. `requireVolunteerAccess`. Session failures throw `NOT_AUTHENTICATED` or `VOLUNTEER_ONLY`; nothing has been written yet.
2. Throttle check. A full bucket returns `rate_limited` and writes nothing.
3. Record one attempt row.
4. Purpose check: `check_in` needs `canCheckIn === true`, `food_check_in` needs `canFoodCheckIn === true`, and `point_scan` needs an `eventId` with a current assignment on an active event. Missing, unassigned, and inactive events all return `not_authorized`, and the token is not looked up.
5. Token check: 64-char lowercase hex (256-bit), then `participants.by_qr_token`. Malformed and unknown tokens both return `qr_not_found`.
6. Eligibility: the linked `applicationReviews` row must be `accepted`, otherwise `participant_not_eligible` with no participant data.

After step 2, outcomes are **returned, not thrown**, because a throw would roll back the counter rows.

Response fields by purpose. Point totals, emails, applications, and QR tokens are never returned.

| Purpose | Fields |
| --- | --- |
| `check_in` | name, `checkedIn`, `checkedInAt` |
| `food_check_in` | name, `foodCheckedIn`, `foodCheckedInAt`, `dietaryInfo` (the only response with dietary data) |
| `point_scan` | name, event name, event `pointsAwarded`, `alreadyAwarded` |

Event `startsAt` / `endsAt` are not checked for point scans (reference schedule only, same as `awardEventPoints`).

### Rate limits

Rows live in the shared `rateLimits` table with its existing fields. Buckets include the volunteer id, so volunteers never share a counter.

| Bucket | Counts | Limit |
| --- | --- | --- |
| `volunteer_qr_scan_attempt:<adminId>` | Every attempt past the throttle (success, invalid, denied) | 60 per 1 minute |
| `volunteer_qr_scan_failure:<adminId>` | Malformed or unknown tokens, and `not_authorized` denials | 10 per 5 minutes |

Either bucket being full returns `rate_limited`. Cleanup: each recorded row deletes up to 20 of that volunteer's expired rows. Rows left by volunteers who stop scanning are removed with the internal `admin/volunteerScanRateLimit:pruneVolunteerScanRateLimits` (paginated; re-run with the returned cursor until `isDone`). `convex/crons.ts` is register-owned, so no cron is added for this.

## Deployment note

Profile owns [schema.ts](../schema.ts). After admin-owned Convex changes, run `npm run admin-schema-lock:refresh` in **hackuta-2026-profile** and deploy Convex from profile (`npm run convex:push-dev` / `convex:deploy`), not from this repo.
