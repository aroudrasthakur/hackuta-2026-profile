# Convex client refs (`src/convex/`)

Typed `makeFunctionReference` wrappers for Convex queries and mutations. Import these instead of string paths so renames stay type-safe.

| Export | Convex function |
| --- | --- |
| getPublicEventConfigRef | eventConfig:getPublicEventConfig |
| getApplicantRoutingStateRef | applicant:getApplicantRoutingState |
| getMyApplicantDashboardRef | applications:getMyApplicantDashboard |
| getMyApplicationDraftRef | applications:getMyApplicationDraft |
| saveApplicationDraftRef | applications:saveApplicationDraft |
| ensureApplicantApplicationRef | applicant:ensureApplicantApplication |
| getOtpSendCooldownRef | rateLimits:getOtpSendCooldown |
| getPasswordResetSendCooldownRef | rateLimits:getPasswordResetSendCooldown |
| invalidateSessionsAfterPasswordResetRef | passwordReset:invalidateSessionsAfterPasswordReset |

Live client setup: [client.ts](client.ts) (excluded from unit coverage; exercised in e2e).

Parent index: [src/README.md](../README.md).
