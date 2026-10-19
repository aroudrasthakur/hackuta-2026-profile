# Frontend source (`src/`)

React + Vite client for the **HackUTA 2026 participant portal**: sign-in (shared Convex Auth) and `/dashboard` (status, timeline, check-in QR).

## Overview

| Path | Summary |
| --- | --- |
| [main.tsx](main.tsx) | App entry: router, auth providers, routes, global CSS |
| [components/](components/README.md) | Shared UI — sign-in shell, route guards, Odyssey buttons |
| [constants/](constants/README.md) | Env-backed URLs, mock auth, logo paths |
| [hooks/](hooks/README.md) | Session auth, applicant routing |
| [convex/](convex/README.md) | Browser Convex client + typed function refs |
| [pages/](pages/README.md) | Home redirect, sign-in, participant dashboard |
| [styles/](styles/README.md) | Global Tailwind theme and dashboard CSS |

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
| Mock API | `VITE_USE_MOCK_API=true` — in-memory auth (dev/CI only) |
| Live auth | Convex Auth + `sessionStorage` |
| No `VITE_CONVEX_URL` | Client null; sign-in and queries degrade gracefully |

Server Convex docs: [convex/README.md](../convex/README.md).

Parent index: [README.md](../README.md).
