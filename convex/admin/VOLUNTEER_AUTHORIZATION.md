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
| `requireVolunteerAccess` | Active volunteer or admin | Any participant/event scan operation (check-in, food, point scan, shop) |
| `requireVolunteerCapability` | Admin, or volunteer with explicit `true` on `canCheckIn`, `canFoodCheckIn`, or `canRedeemShop` | Door check-in, food scan, or shop mutations (missing flag on a volunteer = denied) |
| `requireVolunteerEventAccess` | Admin, or volunteer with a **current** `volunteerEventAccess` row, plus an **active** event | Point scan mutations that award event-fixed points |

Reviewers **cannot** call volunteer guards: they receive `VOLUNTEER_ONLY`. Volunteers **cannot** call review guards: they receive `NOT_AUTHORIZED`. Administrators automatically satisfy all scan capability and event-access checks.

Acting identity always comes from the guard return value (`admin._id`). Never trust client-supplied admin ids, roles, or capabilities.

## Event assignment semantics (invariant)

- Permission to award an event's points is **only** the presence of a `volunteerEventAccess` row for `(volunteerAdminId, eventId)` at the time of the request.
- **Removing** an assignment (leaving the event out of the `setVolunteerEventAccess` list) deletes the row in that transaction. The volunteer loses access on the **next** scan request; there is no caching of assignments in sessions.
- `events.startsAt` / `events.endsAt` are **reference only** and do not gate point awards.
- Inactive or missing events reject even when an assignment row still exists (`EVENT_INACTIVE`, `EVENT_NOT_FOUND`). Assignments are not removed when an event is switched off, so switching it back on restores scanning without reassigning.

## Ledger helpers are not auth boundaries

[pointsLedger.ts](pointsLedger.ts) exports **internal** helpers (`awardEventPoints`, `applyEventAward`, `adjustPoints`, `eventHasAwards`, `requireEligibleParticipant`, `computeLedgerPoints`). They are **not** registered as public Convex functions. (The public scan mutation in `volunteerOperations.ts` is also named `awardEventPoints`; it is a different function.)

- `applyEventAward` is the non-throwing award core used by the scan mutation. It returns `already_awarded` instead of throwing.
- `eventHasAwards` reads `participantEventAwards.by_event`. `events.setEventPoints` uses it to throw `EVENT_POINTS_LOCKED` once an event has one award; fix balances with `adjustPoints` instead.
- `awardEventPoints` writes awards, balances, and `point_scan` logs. It rejects a switched-off event with `EVENT_INACTIVE` and does **not** check the schedule. It also does **not** verify volunteer session, capability, or event assignment. A public point-scan mutation **must** call `requireVolunteerEventAccess` (and any capability guard) first, then pass `actorAdminId` from the returned volunteer and `now` from the server.
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
| `volunteerScan.ts` | `listMyScanOptions`, `resolveQrForScan`, `listActiveMealPeriods`, `resolveQrForMeal`, `redeemMeal` | `requireVolunteerAccess`, then per-purpose capability / assignment checks |
| `meals.ts` | all exports (schedules, availability, counts, and history) | `requireAdminRole` |
| `shopAdmin.ts`, `shopFlashSales.ts` | all exports (items, stock, history, refunds, shop access, flash sales) | `requireAdminRole` |
| `notifications.ts` | all public exports (`saveNotificationDraft`, `publishNotificationNow`, `scheduleNotification`, `updateNotification`, `cancelNotification`, `listNotificationsAdmin`, `getNotificationAdmin`) | `requireAdminRole` (`publishScheduledNotification` is an `internalMutation`) |
| `shopRedemption.ts` | `listShopCatalogForVolunteer`, `getShopCustomer`, `previewShopPurchase`, `purchaseShopItem` | `requireVolunteerCapability(..., "canRedeemShop")` |
| `participantShop.ts` | `listShop`, `getMyShopHistory`, `listPublishedNotifications` | Signed-in applicant (`getAuthUser`); own data only |
| `shopLedger.ts`, `shopPricing.ts` | — | **Helpers only** (callers must guard first) |
| `badgeCheckIn.ts` | `resolveRegistrationForCheckIn`, `resolveBadgeForCheckIn`, `checkInWithBadge` | `requireVolunteerAccess`, then `canCheckIn` |
| `badgeAdmin.ts` | `assignParticipantBadge` | `requireAdminRole` (volunteers get `NOT_AUTHORIZED`) |
| `participantQr.ts` | — | **Helpers only** (callers must guard first) |
| `volunteerOperations.ts` | `foodCheckInParticipant`, `awardEventPoints` | `requireVolunteerAccess`, then capability / assignment checks |
| `volunteerScanRateLimit.ts` | `pruneVolunteerScanRateLimits` | **Internal only** (`internalMutation`) |
| `participants.ts` | — | **Internal only** (`internalMutation`) |
| `pointsLedger.ts`, `pointsBackfill.ts` | — | **Helpers / internal only** |

Future volunteer scan modules belong in `convex/admin/` and must follow the guard table above.

## Badge check-in (`badgeCheckIn.ts`)

Door check-in takes two scans and one confirmation. The registration QR (from the participant portal) identifies the participant; a preprinted badge QR becomes their identity for the rest of the event. Badge values are opaque: trimmed, 1–256 characters, no control characters, and otherwise stored exactly as printed. The backend never generates badges.

| Mutation | Args | Writes |
| --- | --- | --- |
| `resolveRegistrationForCheckIn` | `registrationQrCodeToken` | Rate-limit rows only. Returns the participant's name |
| `resolveBadgeForCheckIn` | `registrationQrCodeToken`, `badgeQrCodeToken` | Rate-limit rows only. Rechecks the registration, then the badge |
| `checkInWithBadge` | same | In one transaction: badge fields, `qrCodeToken` → badge, `registrationQrCodeToken` ← old token, `checkedInAt`, `updatedAt`, one `check_in` log |

Each call runs `requireVolunteerAccess` (throws), the throttle (`rate_limited`), one attempt row, then `canCheckIn` (`not_authorized`). Every check is repeated by `checkInWithBadge`; the previews are never proof of anything.

- Registration results: `qr_not_found` (unknown, malformed, or a retired badge), `registration_qr_used` (this registration already received a badge), `already_checked_in` (a badge was scanned, or a legacy check-in), `participant_not_eligible`, `self_scan_denied` (the volunteer or administrator is scanning their own registration, including an unlinked staff account whose email matches the application).
- Badge results: `badge_invalid`, `badge_is_registration` (any participant's registration token, current or replaced), `badge_in_use`, `badge_retired`.
- Retrying a confirmation that already succeeded with the same badge returns `already_checked_in` and writes nothing. A failed check writes nothing to the participant, so a rejected badge never leaves a partial check-in.
- Two desks assigning one badge at once: Convex serializes the transactions and the second sees the first holder (`badge_in_use`).
- Logs, responses, and errors never contain registration or badge values.

## Badge replacement (`badgeAdmin.ts`)

`assignParticipantBadge({ participantId, badgeQrCodeToken, reason, expectedBadgeAssignedAt })` is admin-only. It requires a checked-in, accepted participant, a reason (1–200 characters), and `expectedBadgeAssignedAt` equal to the current `badgeAssignedAt` (`null` for none), otherwise `BADGE_ASSIGNMENT_CHANGED`. The badge goes through the same availability checks (`INVALID_BADGE`, `BADGE_IS_REGISTRATION`, `BADGE_IN_USE`, `BADGE_RETIRED`). The old badge is retired by storing its SHA-256 hash in `retiredBadgeTokens`, and it stops working immediately. Points, awards, meals, and purchases are keyed by participant and do not change. One `badge_replaced` or `badge_assigned` log records the admin and reason. Volunteers cannot call it, and check-in never reassigns a badge.

## QR scan preview (`volunteerScan.ts`)

`resolveQrForScan` only **previews** a participant. It writes nothing except rate-limit rows. Meal redemption, point-award, and purchase mutations re-run their session, capability/assignment, eligibility, and availability checks. A preview result is never proof of permission. Food previews require a `mealPeriodId` and use the meal flow below, including through the compatibility endpoint.

Order inside the handler:

1. `requireVolunteerAccess`. Session failures throw `NOT_AUTHENTICATED` or `VOLUNTEER_ONLY`; nothing has been written yet.
2. Throttle check. A full bucket returns `rate_limited` and writes nothing.
3. Record one attempt row.
4. Purpose check: `food_check_in` needs `canFoodCheckIn === true`, `point_scan` needs an `eventId` with a current assignment on an active event, and `shop` needs `canRedeemShop === true`. Missing, unassigned, and inactive events all return `not_authorized`, and the value is not looked up.
5. Badge check (`badgeHolderForScan`): only a currently assigned badge resolves. A replaced registration QR returns `registration_qr_replaced`, a retired badge `badge_retired`, a registration QR of someone not checked in `participant_not_checked_in`, a legacy check-in without a badge `badge_not_assigned`, and anything else `qr_not_found`. There is no fallback to the registration token.
6. Eligibility: the linked `applicationReviews` row must be `accepted`, otherwise `participant_not_eligible` for points or `participant_ineligible` for meals, with no participant data.

After step 2, outcomes are **returned, not thrown**, because a throw would roll back the counter rows.

Response fields by purpose. Point totals (except for the shop), emails, applications, and QR values are never returned.

| Purpose | Fields |
| --- | --- |
| `food_check_in` | name, `alreadyRedeemed`, `redeemedAt`, `dietaryInfo`, and selected meal ID/name (the only scan response with dietary data) |
| `point_scan` | name, event name, event `pointsAwarded`, `alreadyAwarded` |

Event `startsAt` / `endsAt` are not checked for point-scan previews or awards. They are stored for reference only.

## Scan operations (`volunteerOperations.ts`)

These mutations do the real work. Each one re-checks everything itself and shares the preview's rate limits (one attempt row per call, so a preview plus a scan uses two).

| Mutation | Needs | Writes on success |
| --- | --- | --- |
| `foodCheckInParticipant` | Compatibility alias for `redeemMeal`; requires a selected meal and all the same checks | One `mealRedemptions` row and one meal-specific `food_check_in` log; participant timestamps stay unchanged |
| `awardEventPoints` | Current assignment, active event, accepted participant who is door checked in | Award row, `points`, one `point_scan` log with delta and previous/new balance |

- Points always come from the stored event. There is no points argument.
- Both resolve the participant by badge only, with the same results as preview step 5.
- Repeat scans change nothing and return `already_redeemed` (with the original `redeemedAt` and meal) or `already_awarded`.
- Other results: `qr_not_found`, `registration_qr_replaced`, `badge_retired`, `badge_not_assigned`, `not_authorized` (missing capability), `event_denied` (unassigned or missing event), `event_inactive`, `participant_not_checked_in`, `participant_not_eligible`, `self_scan_denied` (own badge, including an unlinked staff email match), `rate_limited`.
- One award per participant and event comes from the `by_participant_event` lookup inside the mutation's transaction. If two scans race, Convex retries one of them, and the retry sees the first award. The index alone does not enforce uniqueness.
- Logs never contain QR tokens, session tokens, or dietary data.

## Meal redemption (`volunteerScan.ts`)

`listActiveMealPeriods` exposes enabled schedules (including future windows) to
administrators and to volunteers with explicit `canFoodCheckIn === true`;
volunteers without that grant receive an empty list. The scanner filters by `startsAt <= now < endsAt` and wakes at
serving boundaries even without database writes. Returning schedule metadata lets
the UI update time-based availability without polling queries that would interrupt
an in-progress confirmation. This query returns no participant or dietary data.

`resolveQrForMeal({ sessionToken, qrCodeToken, mealPeriodId })` previews the selected
meal. `redeemMeal` takes the same arguments and rechecks every guard in its own
transaction: active volunteer session, explicit food capability, valid QR, current
accepted status, an existing enabled meal, and its serving window using server time.
The participant need not have checked in at the door. `foodCheckedInAt` is neither
read for eligibility nor written. A missing meal on the compatibility endpoints
returns `meal_not_active`; there is no global food redemption fallback.

The `mealRedemptions.by_participant_meal` lookup and insertion share one mutation.
Concurrent calls retry against the committed redemption and exactly one succeeds.
A duplicate preserves the first timestamp and writes no redemption or audit log.
Successful redemptions write a `food_check_in` audit row with `mealPeriodId` in the
same transaction. A preview writes only rate-limit counters and returns `ok` with
`alreadyRedeemed`; the UI shows **Food Already Collected** when this flag is set.

Meal mutation outcomes are `success`, `already_redeemed`, `meal_not_active`,
`meal_not_started`, `meal_ended`, `participant_ineligible`, `qr_not_found`,
`not_authorized`, and `rate_limited`. Session failures throw before any writes.
All other failures are returned so throttle counters commit. Invalid tokens and
capability denials increment the shared failure bucket; expected eligibility and
schedule failures increment only the attempt bucket. Expiry or disabled/removed
meals are checked before duplicates, so an unavailable meal cannot be redeemed.

## Shop sales (`shopRedemption.ts`)

Selling needs `canRedeemShop === true` for volunteers (administrators bypass that flag). Admins turn volunteer shop access on with `setVolunteerShopAccess`.

- `resolveQrForScan` with `purpose: "shop"` returns the participant's id, name, and balance.
- `purchaseShopItem` needs the scanned badge again, so a participant id alone cannot be charged. Registration QRs are rejected as in preview step 5.
- The server works out the price. If it differs from `expectedUnitPointsCost`, the result is `price_changed` and nothing is written.
- Quantity is 1 to 10 per purchase.
- A volunteer cannot sell to their own participant record (`self_purchase_denied`). The match is the promotion `participantId` **or** a normalized email match with the linked application, so an unlinked volunteer created with `createVolunteer` cannot buy for themselves either. Administrators are blocked the same way.

### Self-scan rule

`isOwnParticipant` in [participantQr.ts](participantQr.ts) is the shared check. Door check-in and event point awards return `self_scan_denied` and count a failure. Shop returns `self_purchase_denied`. Meal redemption does **not** use this check: a volunteer may collect food for themselves once per meal.

### Shop customer lookup by id

`getShopCustomer` and `previewShopPurchase` are queries keyed by `participantId`. They require shop capability but have no badge scan and no throttle. A shop volunteer who has seen an id can keep reading that participant's name and balance. Spending still requires the badge QR in `purchaseShopItem`. Closing this would need a session-scoped scan token.
- The same `idempotencyKey` returns the first receipt (`duplicate`) and charges nothing.
- A success writes the balance, stock, a `shopRedemptions` row, a `purchase` inventory row, and a `shop_purchase` log in one transaction.
- Purchases share the scan rate limits.

### Rate limits

Rows live in the shared `rateLimits` table with its existing fields. Buckets include the volunteer id, so volunteers never share a counter.

| Bucket | Counts | Limit |
| --- | --- | --- |
| `volunteer_qr_scan_attempt:<adminId>` | Every attempt past the throttle (success, invalid, denied) | 60 per 1 minute |
| `volunteer_qr_scan_failure:<adminId>` | Malformed or unknown tokens, and `not_authorized` denials | 10 per 5 minutes |

Either bucket being full returns `rate_limited`. Cleanup: each recorded row deletes up to 20 of that volunteer's expired rows. Rows left by volunteers who stop scanning are removed with the internal `admin/volunteerScanRateLimit:pruneVolunteerScanRateLimits` (paginated; re-run with the returned cursor until `isDone`). `convex/crons.ts` is register-owned, so no cron is added for this.

## Deployment note

Profile owns [schema.ts](../schema.ts). After admin-owned Convex changes, run `npm run admin-schema-lock:refresh` in **hackuta-2026-profile** and deploy Convex from profile (`npm run convex:push-dev` / `convex:deploy`), not from this repo.
