# Profile Convex functions

Participant-only queries. Callers must be authenticated with Convex Auth (same accounts as registration).

| Module | Purpose |
| --- | --- |
| [`dashboard.ts`](dashboard.ts) | `getMyParticipantDashboard` — returns the signed-in user's application status, event timeline fields, and check-in QR token when a participant row exists |

Do not expose participant or QR data by application id or email. Always scope reads to the authenticated `users` row.
