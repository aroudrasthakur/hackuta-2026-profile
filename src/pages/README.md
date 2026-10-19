# Pages (`src/pages`)

Route-level React views for the **participant portal**. Shared chrome comes from [src/components/](../components/README.md).

## Active routes

| Path | Component | Auth |
| --- | --- | --- |
| / | HomeRedirect | Redirect only |
| /sign-in | SignInPage | Public |
| /dashboard | ParticipantDashboardPage | Required |

Defined in [main.tsx](../main.tsx).

## HomeRedirect

| Condition | Destination |
| --- | --- |
| Loading | Loading screen |
| Not authenticated | /sign-in |
| Authenticated | /dashboard |

Uses [useApplicantRouting](../hooks/useApplicantRouting.ts) for session + routing query.

## Legacy register copies (not routed)

[Register/](Register/README.md) and [Profile/](Profile/README.md) are kept for schema-lock alignment and reference. They are **excluded from `tsconfig.json`** and are not mounted in this app’s router. Applicants complete registration on the register site (`VITE_REGISTER_URL`).

## Nested READMEs

| Folder | README |
| --- | --- |
| SignIn/ | [SignIn/README.md](SignIn/README.md) |
| dashboard/ | Participant dashboard (no separate README) |
| Register/ | [Register/README.md](Register/README.md) — reference only |
| Profile/ | [Profile/README.md](Profile/README.md) — reference only |

Parent index: [../README.md](../README.md).
