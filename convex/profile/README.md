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

Do not expose participant or QR data by application id or email. Always scope reads to the authenticated `users` row.
