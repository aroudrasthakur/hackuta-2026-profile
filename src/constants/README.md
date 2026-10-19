# Constants (`src/constants`)

App-wide configuration values: env-backed URLs, mock-auth toggles, logo asset paths, and sign-in storm visuals. Flat directory (no subfolders).

Registration form option lists live in [src/pages/Register/constants.ts](../pages/Register/constants.ts) (re-exports from shared/registration/).

## Overview

| File | Summary |
| --- | --- |
| [site.ts](site.ts) | LANDING_URL — marketing site for logo/home links (VITE_LANDING_URL) |
| [mockAuth.ts](mockAuth.ts) | MockAuthScenario, MOCK_OTP, isMockApiEnabled() for VITE_USE_MOCK_API |
| [images.ts](images.ts) | LogoVariant, LogoLayout, LOGO_SIZES, logoSrcSet(), logoDefaultSrc() |
| [signInWeather.ts](signInWeather.ts) | SIGN_IN_AMBIENT_STORM, SIGN_IN_RAIN_DROPS — storm backdrop config |

## Usage

| Export | Used by |
| --- | --- |
| LANDING_URL | PageShell, SignInShell, SuccessStep, unit tests |
| isMockApiEnabled() | main.tsx, MockAuthProvider, registerApi.ts, ApplicationForm |
| MOCK_OTP, MockAuthScenario | MockAuthProvider, mockAuthContext, sign-in/profile tests, Playwright e2e |
| logoSrcSet, logoDefaultSrc, LOGO_SIZES | [components/art/Logo.tsx](../components/art/Logo.tsx) |
| SIGN_IN_AMBIENT_STORM, SIGN_IN_RAIN_DROPS | SignInStormBackdrop |

## Environment variables

| Variable | Read in | Purpose |
| --- | --- | --- |
| VITE_LANDING_URL | site.ts | External marketing site for back-to-home / logo links |
| VITE_USE_MOCK_API | mockAuth.ts | When "true", enables in-memory auth and mock API paths (dev/CI only) |

See [.env.example](../../.env.example) and [docs/OPERATIONS.md](../../docs/OPERATIONS.md). Production builds fail if VITE_USE_MOCK_API=true on Vercel ([verify-production-env.mjs](../../scripts/verify-production-env.mjs)).

## Related

| Location | Role |
| --- | --- |
| [components/README.md](../components/README.md) | UI that consumes these constants |
| [pages/Register/constants.ts](../pages/Register/constants.ts) | MLH form field options |

Parent index: [../README.md](../README.md).
