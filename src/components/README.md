# Components (`src/components`)

Shared React UI for the HackUTA registration app: auth shell, route guards, themed controls, and storm/weather chrome. Page-specific form widgets live under [src/pages/Register/components/](../pages/Register/components/).

## Overview

| Path | Summary |
| --- | --- |
| [art/](art/README.md) | Odyssey-themed SVG logo wrapper and decorative illustrations |
| [AuthBootstrap.tsx](AuthBootstrap.tsx) | Waits for the initial Convex Auth read before rendering routed pages |
| [MockAuthProvider.tsx](MockAuthProvider.tsx) | In-memory auth when VITE_USE_MOCK_API=true (dev/tests only) |
| [OdysseyButton.tsx](OdysseyButton.tsx) | Primary CTA: internal Link, external anchor, or button |
| [OtpCodeInput.tsx](OtpCodeInput.tsx) | Six-digit OTP input (sign-up verify and forgot-password verify steps) |
| [PageShell.tsx](PageShell.tsx) | Register/profile content frame with logo header and clay background |
| [ProtectedRoute.tsx](ProtectedRoute.tsx) | Auth guard and redirect when registration already submitted |
| [SignInAtmosphere.tsx](SignInAtmosphere.tsx) | WebGL dithering shader layer for storm backdrop (lazy-loaded) |
| [SignInShell.tsx](SignInShell.tsx) | Sign-in page layout: storm backdrop, logo, title, form slot |
| [SignInStormBackdrop.tsx](SignInStormBackdrop.tsx) | Animated storm sky, rain, lightning; wraps SignInAtmosphere |
| [SignOutButton.tsx](SignOutButton.tsx) | Signs out (Convex or mock) and navigates to /sign-in |
| [StormPageFrame.tsx](StormPageFrame.tsx) | Register/profile wrapper with weather mood + storm backdrop |
| [WeatherMoodToggle.tsx](WeatherMoodToggle.tsx) | Calm / Enrage toggle for storm intensity on app pages |

## Usage

| Component | Used by |
| --- | --- |
| AuthBootstrap | [main.tsx](../main.tsx) |
| MockAuthProvider | [main.tsx](../main.tsx), unit tests |
| ProtectedRoute | [main.tsx](../main.tsx) — /register (requireNoSubmittedRegistration), /profile |
| SignInShell, OtpCodeInput | [SignInPage](../pages/SignIn/SignInPage.tsx), [ForgotPasswordFlow](../pages/SignIn/ForgotPasswordFlow.tsx) |
| StormPageFrame, PageShell, SignOutButton | [RegisterPage](../pages/Register/RegisterPage.tsx), [ProfilePage](../pages/Profile/ProfilePage.tsx) |
| OdysseyButton | Register form, profile, success step, sign-out |
| SignInStormBackdrop | SignInShell, StormPageFrame |
| SignInAtmosphere | SignInStormBackdrop only |
| WeatherMoodToggle | StormPageFrame only |
| art/* | [art/README.md](art/README.md) |

## Related

| Location | Role |
| --- | --- |
| [hooks/README.md](../hooks/README.md) | Session auth and routing hooks consumed here |
| [main.tsx](../main.tsx) | Convex Auth uses `sessionStorage`; AuthBootstrap restores sessions on refresh |
| [constants/README.md](../constants/README.md) | Logo paths and storm config |
| [styles/README.md](../styles/README.md) | CSS classes referenced by these components |

Parent index: [../README.md](../README.md).
