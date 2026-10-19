# Profile Convex functions

Participant-only queries. Callers must be authenticated with Convex Auth (same accounts as registration).

After adding or changing these modules locally, deploy to the shared dev deployment (`standing-manatee-425`) from the profile repo root:

```bash
npm run convex:push-dev
```

Without that step, `/dashboard` stays on “Loading your participant dashboard…” because the browser calls `profile/dashboard:getMyParticipantDashboard`, which is not part of register/admin-only pushes.

| Module | Purpose |
| --- | --- |
| [`dashboard.ts`](dashboard.ts) | `getMyParticipantDashboard` — returns the signed-in user's application status, event timeline fields, and check-in QR token when a participant row exists |

Do not expose participant or QR data by application id or email. Always scope reads to the authenticated `users` row.
