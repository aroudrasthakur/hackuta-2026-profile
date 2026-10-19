# Pages (`src/pages`)

Route-level React views. Shared chrome comes from [src/components/](../components/README.md).

## Overview

| Path | Summary |
| --- | --- |
| [HomeRedirect.tsx](HomeRedirect.tsx) | / — sends users to sign-in, register, or profile |
| [SignIn/](SignIn/README.md) | /sign-in — account creation, sign-in, and forgot-password reset |
| [Register/](Register/README.md) | /register — application form and success step |
| [Profile/](Profile/README.md) | /profile — applicant dashboard |

## Route map

| Path | Component | Auth |
| --- | --- | --- |
| / | HomeRedirect | Redirect logic only |
| /sign-in | SignInPage | Public |
| /register | RegisterPage | Required; blocks if already submitted |
| /profile | ProfilePage | Required |
| * | Navigate → / | — |

Defined in [main.tsx](../main.tsx).

## HomeRedirect logic

| Condition | Destination |
| --- | --- |
| Loading | Loading screen |
| Not authenticated | /sign-in |
| Has submitted registration | /profile |
| Otherwise | /register |

Uses [useApplicantRouting](../hooks/useApplicantRouting.ts).

## Nested READMEs

| Folder | README |
| --- | --- |
| SignIn/ | [SignIn/README.md](SignIn/README.md) |
| Register/ | [Register/README.md](Register/README.md) |
| Register/components/ | [Register/components/README.md](Register/components/README.md) |
| Profile/ | [Profile/README.md](Profile/README.md) |

Form option lists for the register page are in [Register/constants.ts](Register/constants.ts) (not [src/constants/](../constants/README.md)).

## Related

| Location | Role |
| --- | --- |
| [hooks/README.md](../hooks/README.md) | Routing and session hooks |
| [shared/README.md](../../shared/README.md) | Form validation and constants |

Parent index: [../README.md](../README.md).
