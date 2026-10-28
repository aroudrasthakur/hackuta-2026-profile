# Profile Convex functions

Participant-only queries. Callers must be authenticated with Convex Auth (same accounts as registration).

After adding or changing these modules locally, deploy to the shared dev deployment (`standing-manatee-425`) from the profile repo root. This is the only repo that should upload Convex functions:

```bash
npm run convex:push-dev
```

`convex:push-dev` and `convex:deploy` verify the register lock and the admin lock before uploading. Without a profile push, `/dashboard` stays on “Loading your participant dashboard…” because the browser calls `profile/dashboard:getMyParticipantDashboard`.

| Module | Purpose |
| --- | --- |
| [`dashboard.ts`](dashboard.ts) | `getMyParticipantDashboard` — returns the signed-in user's application status, event timeline fields, and check-in QR token when a participant row exists |
| [`appleWalletPass.ts`](appleWalletPass.ts) | `generateMyAppleWalletPass` — signs and serves a pre-check-in `.pkpass` bundle for Apple Wallet using the participant's existing registration QR token |
| [`appleWalletPassData.ts`](appleWalletPassData.ts) | Internal query and storage cleanup helpers for Apple Wallet pass generation |
| [`leaderboard.ts`](leaderboard.ts) | `getMyPointsLeaderboard` — live top 10 by points (rank, name, points, `isYou` only) |
| [`seedTestProfile.ts`](seedTestProfile.ts) | Dev-only internal seed for a signed-in accepted participant (`seedTestAcceptedParticipant`) |
| [`seedTestVolunteer.ts`](seedTestVolunteer.ts) | Dev-only internal seed for an admin-app volunteer with scan access (`seedTestVolunteer`) |

Do not expose participant or QR data by application id or email. Always scope reads to the authenticated `users` row.

### Dev test accounts (standing-manatee-425 only)

```bash
npx convex run profile/seedTestProfile:seedTestAcceptedParticipant --env-file .env.local
npx convex run profile/seedTestVolunteer:seedTestVolunteer --env-file .env.local
```

The volunteer seed creates **Testing Volunteer** (`testing-volunteer@hackuta.dev` / `HackutaVolunteerTest1`) with check-in, food, and two active event assignments for scanner QA on the admin app.
