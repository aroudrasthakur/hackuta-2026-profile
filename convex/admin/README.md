# Admin Convex functions (`convex/admin/`)

Organizer-only queries, mutations, and internal actions. **Admin-owned** — safe to add and edit files here.

## Overview

| Path | Summary |
| --- | --- |
| [auth.ts](auth.ts) | Organizer sign-in, sign-out, session lookup, credential provisioning |
| [staffAuth.ts](staffAuth.ts) | Session resolution and role guards (see [VOLUNTEER_AUTHORIZATION.md](VOLUNTEER_AUTHORIZATION.md)) |
| [volunteers.ts](volunteers.ts) | Admin-only volunteer management: creation, resets, revoke/restore, capabilities, event assignments, and audit log queries |
| [events.ts](events.ts) | Admin-only event list, creation, edits, and activation, each audited in `staffConfigLogs` |
| [participantsAdmin.ts](participantsAdmin.ts) | Admin-only participant roster, details, point corrections, adjustment history, and participant-to-volunteer promotion |
| [meals.ts](meals.ts) | Admin-only meal create/edit/activate/remove, reactive served counts, and paginated collection history |
| [mealCountsBackfill.ts](mealCountsBackfill.ts) | Internal, bounded, resumable backfill of served counts for existing meals |
| [volunteerProvisioning.ts](volunteerProvisioning.ts) | Shared volunteer account provisioning (validation, hashing, audit) used by both modules above |
| [adminQueryHelpers.ts](adminQueryHelpers.ts) | Display-name lookups and date-range bounds for admin list queries |
| [staffCredentials.ts](staffCredentials.ts) | Shared password validation, hashing, credential storage, and session invalidation |
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
| [volunteerScan.ts](volunteerScan.ts) | Volunteer scan options, meal availability, QR previews, and atomic per-meal redemption |
| [volunteerScanRateLimit.ts](volunteerScanRateLimit.ts) | Per-volunteer QR lookup throttling in `rateLimits`, plus internal cleanup |
| [shopAdmin.ts](shopAdmin.ts) | Admin-only shop items, images, purchase history, refunds, and volunteer shop access |
| [shopFlashSales.ts](shopFlashSales.ts) | Admin-only flash sales and their participant notifications |
| [shopRedemption.ts](shopRedemption.ts) | Volunteer shop catalog, purchase preview, and the purchase mutation (`canRedeemShop`) |
| [shopLedger.ts](shopLedger.ts), [shopPricing.ts](shopPricing.ts) | Internal points, refund, and pricing helpers (not auth boundaries) |
| [participantShop.ts](participantShop.ts) | Participant shop, own purchase history, and published notifications for the profile portal |

## Meal management

Meal management requires `requireAdminRole` on every endpoint. `createMealPeriod`
and `updateMealPeriod` validate custom names (1–100 characters), optional descriptions
(up to 1000 characters), and Unix millisecond serving windows with `startsAt < endsAt`.
Enabled windows must not overlap; adjacent windows are allowed. `setMealPeriodActive`
rechecks overlaps on activation. `removeMealPeriod` rejects meals with redemption
history, including collections recorded since the UI loaded; deactivate these meals
instead. Configuration changes write `staffConfigLogs` entries with the actor,
meal ID, and schedule/name details, preserving the name even after removal.

`listMealPeriods` returns schedules ordered by start and cached `servedCount`
values without reading redemption history. Each successful collection increments
its meal's count in the same transaction as the redemption and audit log; duplicates
leave it unchanged. Count updates do not change `updatedAt`, so they do not reset
scanner previews. `listMealRedemptions` requires a meal ID and pagination
options and accepts inclusive `from`/`to` collection timestamps. History is newest
first and exposes participant/staff display names and collection times only.
The food scanner uses `listActiveMealPeriods`, `resolveQrForMeal`, and `redeemMeal`
from `volunteerScan.ts`. Availability follows enabled schedules and serving-window
boundaries. Redemption rechecks server time, current eligibility and capability,
and the indexed per-meal duplicate record in one transaction. Legacy food endpoints
delegate to the same checks and require a selected meal. Existing
`participants.foodCheckedInAt` values remain historical data. Deploy backend changes
through profile after refreshing its admin schema lock.

New meals start with a complete count of zero. For meals created before cached
counts were introduced, run the internal mutation
`admin/mealCountsBackfill:backfillMealServedCount` with `{ "mealPeriodId": "<id>" }`
from profile, repeating until `isDone` is true for each existing meal. Each call
reads at most 100 redemptions and stores its cursor on the meal. The operation is
safe to resume or repeat, including while volunteers are serving food: new
redemptions are marked `countedInServedCount`, and the backfill counts each legacy
row once. Until complete, the admin page shows “Updating count…” and disables
removal rather than displaying a partial total. History remains available.

## Authentication

Organizer auth is **independent** from applicant Convex Auth (`convex/auth.ts`).

| Table | Purpose |
| --- | --- |
| `admins` | Identity, `role`, `active` — source of truth for authorization |
| `adminAuthAccounts` | One password hash per admin (`adminId`) |
| `adminSessions` | Hashed session tokens with `expiresAt` |

Protected queries and mutations accept `sessionToken`. The helpers take `(ctx, sessionToken)` because internal authentication uses explicit session tokens:

- `getCurrentAdmin` returns the active `admins` record, or `null` for an invalid, expired, revoked, or orphaned session.
- `requireAdminRole` allows only active admins; application review, decisions, history, and other admin operations use it.
- `requireVolunteerAccess` allows active volunteers and administrators.
- `requireVolunteerCapability` grants administrators every scan capability; volunteers need an explicit `true` for `canCheckIn`, `canFoodCheckIn`, or `canRedeemShop` on each request.
- `requireVolunteerEventAccess` grants administrators every active event; volunteers need their own assignment. Schedule times are reference only. Removing an assignment takes effect on the next request.

Each protected request resolves the current stored role and active status. Acting identity always comes from the returned `admin._id`, including `applicationReviews.reviewedBy`, `applicationReviewLogs.adminId`, and `participants.acceptedBy`; public operations never accept an acting admin ID or role. Applicant authentication cannot satisfy these guards.

Application decisions require a submitted application, even if a draft already has a review row. Both the submission flag and legacy submission timestamp are supported. Draft rejection leaves the application, review, audit logs, and participants unchanged.

The SPA obtains the token from `/api/admin/session-token`, which reads an HttpOnly cookie set by `/api/admin/sign-in`. Sign-in clears any prior sessions for that admin. These functions use the existing `standing-manatee-425` deployment configured in `.env.example`.

Sign-in permits five failed attempts per normalized email within 15 minutes, across all callers. This account-wide counter prevents direct Convex callers from bypassing throttling by changing or omitting `clientIp`. The existing IP/email counter remains enforced, including previously recorded failures. Successful sign-in clears the account counter and the current IP/email counter; failures outside the window no longer count.

## Volunteer accounts and authorization audit (#59)

Volunteers use this same staff login and cookie transport. Applicant Convex Auth never grants staff access. `getCurrentStaff` returns identity, expiry, and normalized capabilities; it never returns credentials, participant data, or point totals. The SPA sends volunteer sessions to `/volunteer`, blocks review routes, and returns to login on revocation or expiry, including idle and resumed tabs.

## Volunteer management (#62)

Every export in `volunteers.ts` calls `requireAdminRole` first. Volunteers get `NOT_AUTHORIZED`, so a volunteer cannot change their own capabilities or events, create or restore accounts, reset passwords, or read either audit log.

- `createVolunteer` makes a standalone volunteer (not a participant). Admins can call it from the Volunteers page. The role is always `volunteer`, the account is active, and `canCheckIn` / `canFoodCheckIn` are optional booleans (omitted or anything but an explicit `true` is denied, so new volunteers normally start with no access). The email is normalized like staff sign-in, and any existing staff row with that email (any role, active or not) is rejected. The password is validated and hashed with the shared staff credential helper.
- `promoteParticipantToVolunteer` (in `participantsAdmin.ts`, built on `volunteerProvisioning.ts`) creates a **separate** staff account linked through `admins.participantId`. The participant must still be accepted. The email and name default to the registration values and can be overridden. It rejects a second link for the same participant and any email already used by staff, and never converts an admin. The participant row (points, QR token), application, `users`, and `authAccounts` are not modified. It is audited as `volunteer_promoted` (with `targetParticipantId`); standalone creation is `volunteer_created`.
- `listVolunteers` is paginated over `admins.by_role` and returns name, email, active status, linked participant, capabilities, assigned events, and created/updated times. No credentials, sessions, QR tokens, or points.
- `getVolunteer` returns one volunteer in the same shape, or `null` when the id is missing or not a volunteer.
- `resetVolunteerPassword` validates the new password and deletes all sessions. No password retrieval API exists.
- `revokeVolunteer` sets `active: false` and deletes every session, which stops all scanning on the next request. Assignments, capabilities, and history are kept. `restoreVolunteer` reactivates the account and deletes sessions again, so a fresh login is always required.
- `setVolunteerCapabilities` takes `canCheckIn` and `canFoodCheckIn` explicitly, plus an optional `canRedeemShop` (omitted leaves shop access unchanged). Unchanged values are a no-op; otherwise the log records `changedFields`, `before`, and `after`.
- `setVolunteerEventAccess` replaces the volunteer's event set. Optional `canScanAllEvents` grants every current and future event without listing them. It validates the whole list (at most 50, no duplicates, every event exists, no new grants to a revoked volunteer) before any write. Unchanged rows are kept, removed ones are deleted, and duplicate rows for one event are collapsed. The log records the final list plus added and removed ids, and the all-events flag when it changes.
- `listVolunteerActionLogs` filters by volunteer, action, participant, event, and a `from`/`to` date range, newest first, paginated. The most selective filter picks an index (`by_participant_createdAt`, `by_actor_createdAt`, `by_event_createdAt`, `by_action_createdAt`, or `by_createdAt`). Rows include actor and participant names, event name, point delta, and the reason for admin adjustments only.
- `listStaffConfigLogs` lists configuration changes newest first, filterable by target staff account, action, and date range, with names and parsed details.

Every configuration change writes a `staffConfigLogs` row with the acting admin and timestamp in the same transaction. Details go through `buildStaffConfigDetails`, which only stores allowlisted booleans, numbers, and ids. Generic organizer provisioning still rejects volunteer targets.

### Events (#63)

Every export in `events.ts` calls `requireAdminRole` first; volunteers get `NOT_AUTHORIZED`. Input goes through `normalizeEventInput`: a trimmed name of 1–120 characters, an optional description up to 2,000 characters, whole points from 1 to 100,000, and finite whole-millisecond `startsAt` before `endsAt`; anything else is `INVALID_EVENT`. `createdAt` and `updatedAt` are always set by the server.

- `listEvents` is paginated over every event (switched on or off, past or future), newest first. Each row has `active`, `startsAt`, `endsAt`, and `pointsLocked` (true once `participantEventAwards.by_event` has a row), so the client can label it with `eventStatus`: `inactive`, `upcoming`, `active`, or `ended`. Those labels are display only; the query does not compute status because cached results would not refresh when the clock crosses a boundary.
- `getEvent` returns one event in the same shape, or `null`.
- `createEvent` inserts a switched-on event and logs `event_created` with the new values.
- `updateEvent` changes name, description, and schedule. A missing event is `EVENT_NOT_FOUND`; an unchanged submission is a no-op; otherwise `event_updated` records `changedFields` and the previous and new schedule. A blank description clears it. Schedule times are stored for reference and do not change who can scan.
- `setEventPoints` changes `pointsAwarded` until the first award, then throws `EVENT_POINTS_LOCKED`. Existing awards and balances are never rewritten. `event_updated` records the previous and new value.
- `setEventActive` is a no-op when unchanged; otherwise `event_active_changed` records before and after.

Points can be awarded while the event is switched on. `startsAt` / `endsAt` are reference only and are not checked by the award mutation, the ledger helper, or the scan preview. Switching an event off keeps its volunteer assignments, and `listMyScanOptions` lists every assigned switched-on event, so scanning resumes without reassignment when it is switched back on. No export here awards points.

## Participant administration (#64)

Every export in `participantsAdmin.ts` calls `requireAdminRole` first; volunteers get `NOT_AUTHORIZED`. QR tokens are never returned.

- `listParticipants` returns the accepted-participant roster (rows whose application review is not `accepted` are skipped): participant id, full name, email, point balance, check-in and food timestamps, and the linked volunteer's id and active status. Filters: `search` (name or email, case-insensitive, up to 100 characters), `checkedIn`, `foodRedeemed`, and `volunteerStatus` (`none`, `linked`, `active`, `inactive`). Order is participant creation order. Each call reads at most 100 participants and filters that slice, so there is never an unbounded read; a filtered page can be shorter than requested (or empty) while `isDone` is false, and `scanned` reports how many rows were read. Name and email live on register-locked `applications`, so no search index is added.
- `getParticipantDetails` returns one accepted participant with event awards, dietary info, linked volunteer, and `ledgerPoints` / `pointsConsistent` comparing the cached balance with awards plus adjustments. Missing or non-accepted participants return `null`.
- `setParticipantPoints({ participantId, points, reason })` sets an accepted participant's balance. `points` must be a nonnegative safe integer and `reason` a trimmed, nonempty string up to 200 characters. The previous balance and `pointsDelta = points - previous` are computed server-side; the client cannot send them. The balance patch and the immutable `admin_adjust` log (actor, previous, new, delta, reason, timestamp) are written in one transaction through `adjustPoints`. Setting the current balance is a no-op with no log.
- `listPointAdjustments` lists `admin_adjust` history newest first, paginated, filterable by participant, admin, and date range, with admin and participant names, previous and new balance, delta, and reason.
- `promoteParticipantToVolunteer` is described under volunteer management above.

Accounting: `participants.points` = event awards + admin adjustments. Corrections never delete or change `participantEventAwards` rows or event values, so award uniqueness holds after a reset (re-awarding the same event is still `POINTS_ALREADY_AWARDED`). Correcting a wrong award keeps the award and records an offsetting adjustment; an award-reversal workflow is out of scope.

| Entry point | Required access |
| --- | --- |
| Application list/detail, review activity and decisions | Admin |
| Application history and sample application creation | Admin |
| Decision email queue reads | Admin |
| Decision email hold, retry, release (via the guarded internal claim mutation) | Admin |
| Generic organizer provisioning | Admin; volunteer targets rejected |
| Volunteer listing, creation, promotion, reset, revoke, restore, capabilities, assignments, and audit logs | Admin |
| Participant roster, details, point corrections, and adjustment history | Admin |
| Session profile/sign-out | The caller's staff session only |
| Participant creation | Internal only; accepting staff must be an active admin |
| Point ledger and participant eligibility helpers | Ordinary server helpers, not public Convex APIs |
| Own scan options and QR scan preview | Admin, or volunteer with the purpose's capability or event assignment |
| Two-step badge check-in (`badgeCheckIn.ts`) | Admin, or volunteer with `canCheckIn`, re-checked on every call |
| Badge replacement or late assignment (`badgeAdmin.ts`) | Admin |
| Food redemption, event point award (`volunteerOperations.ts`) | Admin, or volunteer with the capability or event assignment, re-checked on every call |

The participant roster and point corrections (`participantsAdmin.ts`) are admin-only. Scanner endpoints must independently call the relevant volunteer guard **inside their query/mutation** before using participant or ledger helpers. In particular, `awardEventPoints` is a ledger helper, not an authorization boundary: its caller must use `requireVolunteerEventAccess` and derive the actor and timestamp on the server. Scanner and management screens are separate work from this authentication foundation.

Deployment: sync these admin-owned modules and `shared/admin` helpers into `hackuta-2026-profile` using its `npm run admin-schema-lock:refresh`, verify its schema includes #58, and run backend checks there. Backend uploads must run from profile to preserve `convex/profile`. Do not upload from this repository or refresh register-owned files for this change.

`getApplication` uses `requireAdminRole` before reading applicant data. It returns `null` for malformed, missing, or unsubmitted applications, and returns resume availability separately from the application. A missing review record remains missing; reading detail never creates review rows, audit events, or participants. No historical reviewer logs are returned.

After detail loads, the page calls `logApplicationReviewAction` with `action: "viewed"`. The mutation requires a submitted application and appends an event with the session-derived admin ID and server timestamp. Repeated visits remain separate events; viewing never claims the application or changes review state.

## Volunteer QR scan preview (#60)

`listMyScanOptions` returns scan capabilities and switched-on events. Administrators receive every capability and every active event; volunteers receive their own grants and assigned events (name, points, schedule). `resolveQrForScan` previews one scanned badge for `food_check_in`, `point_scan`, or `shop` and returns a typed status instead of throwing, so its rate-limit rows persist. It changes no participant, award, or log rows; the later state-changing scan mutations must re-check everything. Dietary info appears only in food previews; point totals, emails, applications, and tokens never appear. Order of checks, response fields, and the rate-limit thresholds and cleanup are in [VOLUNTEER_AUTHORIZATION.md](VOLUNTEER_AUTHORIZATION.md#qr-scan-preview-volunteerscants).

Door check-in is a separate two-scan flow (registration QR, then a preprinted badge, then confirm) that assigns the badge and checks the participant in atomically. After that, food, points, and the shop accept only the badge. See [badge check-in](VOLUNTEER_AUTHORIZATION.md#badge-check-in-badgecheckints).

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
