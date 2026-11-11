# Profile Convex functions

Participant-only queries and internal seed functions. Participant queries use Convex Auth (the same accounts as registration).

After adding or changing these modules locally, deploy to the shared dev deployment (`standing-manatee-425`) from the profile repo root. This is the only repo that should upload Convex functions:

```bash
npm run convex:push-dev
```

`convex:push-dev` and `convex:deploy` verify the register lock and the admin lock before uploading. Without a profile push, `/dashboard` stays on “Loading your participant dashboard…” because the browser calls `profile/dashboard:getMyParticipantDashboard`.

| Module | Purpose |
| --- | --- |
| [`dashboard.ts`](dashboard.ts) | `getMyParticipantDashboard` — returns the signed-in user's application status, event timeline fields, and check-in QR token when a participant row exists and media disclosure has been accepted |
| [`mediaDisclosure.ts`](mediaDisclosure.ts) | `acceptMyMediaDisclosure` — one-time server-stamped acceptance; the QR token is withheld until this row exists |
| [`schedule.ts`](schedule.ts) | `listPublicSchedule` — public reactive schedule of active participant activities, ordered by start time (landing + profile) |
| [`scheduleMigration.ts`](scheduleMigration.ts) | `migrateLegacyWeekendSchedule` — idempotent internal seed for any legacy activity data |
| [`leaderboard.ts`](leaderboard.ts) | `getMyPointsLeaderboard` — live top 10 by points (rank, name, points, `isYou` only) |
| [`seedTestProfile.ts`](seedTestProfile.ts) | Dev-only internal seed for a signed-in accepted participant (`seedTestAcceptedParticipant`) |
| [`seedTestPendingApplications.ts`](seedTestPendingApplications.ts) | Dev-only internal seed for submitted applications left in `under_review` (`seedTestPendingApplications`) |
| [`seedTestVolunteer.ts`](seedTestVolunteer.ts) | Dev-only internal seed for an admin-app volunteer with scan access (`seedTestVolunteer`) |

Do not expose participant or QR data by application id or email. Always scope reads to the authenticated `users` row.

The schedule lives in its own `schedule` table and does not change `events`, which remains responsible for point awards and volunteer scanning. The legacy participant schedule contained no activity rows to seed; its two date tabs were placeholders. The idempotent internal migration can be run with `npx convex run profile/scheduleMigration:migrateLegacyWeekendSchedule --env-file .env.local`.

### Dev test accounts (standing-manatee-425 only)

```bash
npx convex run profile/seedTestProfile:seedTestAcceptedParticipant --env-file .env.local
npx convex run profile/seedTestPendingApplications:seedTestPendingApplications --env-file .env.local
npx convex run profile/seedTestVolunteer:seedTestVolunteer --env-file .env.local
```

The volunteer seed creates **Testing Volunteer** (`testing-volunteer@hackuta.dev` / `HackutaVolunteerTest1`) with check-in, food, and two active event assignments for scanner QA on the admin app.
