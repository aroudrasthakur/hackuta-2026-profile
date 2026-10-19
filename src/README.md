# Frontend source (`src/`)

React + Vite client for HackUTA 2026 registration. Convex Auth, applicant profile draft/submit, and Odyssey-themed UI.

## Overview

| Path | Summary |
| --- | --- |
| [main.tsx](main.tsx) | App entry: router, auth providers, routes, global CSS |
| [components/](components/README.md) | Shared UI — shells, buttons, storm backdrop, route guards |
| [constants/](constants/README.md) | Env-backed URLs, mock auth, logo paths, storm config |
| [hooks/](hooks/README.md) | Session auth, applicant routing, weather mood |
| [convex/](convex/README.md) | Browser Convex client + typed function refs |
| [pages/](pages/README.md) | Route views — home redirect, sign-in, register, profile |
| [styles/](styles/README.md) | Global Tailwind theme and component CSS |

## Nested README index

| Directory | README |
| --- | --- |
| components/ | [components/README.md](components/README.md) |
| components/art/ | [components/art/README.md](components/art/README.md) |
| constants/ | [constants/README.md](constants/README.md) |
| hooks/ | [hooks/README.md](hooks/README.md) |
| convex/ (client) | [convex/README.md](convex/README.md) |
| styles/ | [styles/README.md](styles/README.md) |
| pages/ | [pages/README.md](pages/README.md) |
| pages/SignIn/ | [pages/SignIn/README.md](pages/SignIn/README.md) |
| pages/Register/ | [pages/Register/README.md](pages/Register/README.md) |
| pages/Register/components/ | [pages/Register/components/README.md](pages/Register/components/README.md) |
| pages/Profile/ | [pages/Profile/README.md](pages/Profile/README.md) |

Server Convex docs: [convex/README.md](../convex/README.md).

## Bootstrap flow (`main.tsx`)

```
ConvexAuthProvider | MockAuthProvider + ConvexProvider?
  └─ SessionAuthProvider
       └─ BrowserRouter
            └─ AuthBootstrap (initial auth loading gate)
                 └─ Routes → pages
```

| Mode | When |
| --- | --- |
| Mock API | VITE_USE_MOCK_API=true — in-memory auth, optional Convex for reads |
| Live auth | Convex Auth + sessionStorage (persists across refresh in the same tab) |
| No VITE_CONVEX_URL | Client null; mock or error paths in register API |

## Related

| Location | Role |
| --- | --- |
| [convex/README.md](../convex/README.md) | Server functions, schema, HTTP routes |
| [shared/README.md](../shared/README.md) | Registration schema, validation, auth helpers |
| [public/README.md](../public/README.md) | Static fonts, images, trusted-types script |
| [tests/README.md](../tests/README.md) | Unit and Playwright e2e |

Parent index: [README.md](../README.md).
