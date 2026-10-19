# Hooks (`src/hooks`)

React hooks and context providers for auth, routing state, and UI mood. Flat directory (no subfolders).

## Overview

| File | Summary |
| --- | --- |
| [useSessionAuth.tsx](useSessionAuth.tsx) | SessionAuthProvider, useSessionAuth() — Convex Auth loading state, persistence, and sign-out |
| [mockAuthContext.ts](mockAuthContext.ts) | MockAuthContext, MockAuthContextValue, defaultMockAuthValue |
| [useMockAuth.ts](useMockAuth.ts) | useMockAuth() — reads MockAuthContext |
| [useApplicantRouting.ts](useApplicantRouting.ts) | useApplicantRouting() — auth, verified email, hasSubmittedRegistration |
| [useWeatherMood.tsx](useWeatherMood.tsx) | WeatherMoodProvider, useWeatherMood(), WeatherMood — calm/enraged toggle |

## Usage

| Export | Used by |
| --- | --- |
| SessionAuthProvider | [main.tsx](../main.tsx) |
| useSessionAuth | AuthBootstrap, SignOutButton, SignInPage, ApplicationForm |
| useMockAuth | MockAuthProvider, SignOutButton, useApplicantRouting, useSessionAuth, sign-in/register/profile pages |
| useApplicantRouting | ProtectedRoute, HomeRedirect, SignInPage |
| WeatherMoodProvider, useWeatherMood | StormPageFrame, WeatherMoodToggle |

## Related

| Location | Role |
| --- | --- |
| [convex/README.md](../convex/README.md) | Client function refs used by useApplicantRouting |
| [components/README.md](../components/README.md) | Route guards and shells that consume these hooks |

Parent index: [../README.md](../README.md).
