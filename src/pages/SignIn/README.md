# Sign-in page (`src/pages/SignIn`)

Password sign-up/sign-in with email verification OTP on first registration, plus forgot-password reset via a separate OTP flow.

## Overview

| File | Summary |
| --- | --- |
| [SignInPage.tsx](SignInPage.tsx) | Credentials step, verify step, forgot-password entry, mock vs Convex auth branches |
| [ForgotPasswordFlow.tsx](ForgotPasswordFlow.tsx) | Email → reset OTP → new password; returns to sign-in with success message |

## Routes and behavior

| Concern | Detail |
| --- | --- |
| Route | /sign-in ([main.tsx](../../main.tsx)) |
| Shell | [SignInShell](../../components/SignInShell.tsx) + [OtpCodeInput](../../components/OtpCodeInput.tsx) |
| Convex | useAuthActions().signIn / signOut, ensureApplicantApplicationRef, getOtpSendCooldownRef, getPasswordResetSendCooldownRef, invalidateSessionsAfterPasswordResetRef |
| Mock | useMockAuth requestOtp / verifyOtp with MOCK_OTP from [mockAuth.ts](../../constants/mockAuth.ts) |
| Redirect | Authenticated users on the main sign-in view sent to /register or /profile |
| Session | JWT persists across refresh in the same tab (`sessionStorage` via Convex Auth) |

Password, OTP, and reset copy: [shared/auth/](../../../shared/auth/).

### Sign-up / sign-in flows

| Step | `flow` value | FormData |
| --- | --- | --- |
| Sign up | `signUp` | `email`, `password` |
| Verify email | `email-verification` | `email`, `code` |
| Sign in | `signIn` | `email`, `password` |

### Forgot password flows

| Step | `flow` value | FormData |
| --- | --- | --- |
| Request reset code | `reset` | `email` |
| Set new password | `reset-verification` | `email`, `code`, `newPassword` |

After a successful reset, the app invalidates all auth sessions, signs out, and shows a success banner on the sign-in form. Accepted reset code requests return the same non-session result for registered and unregistered emails. Both advance to the code step with neutral copy (“If an account exists…”) and the same request cooldown. Operational errors keep the user on the email step with a generic error; request limits apply to all addresses before account lookup.

Signup OTPs use provider `email-verification`; reset OTPs use `password-reset` (separate buckets and email templates).

## UI actions

Primary submits use `.sign-in-btn`. Secondary navigation uses `.sign-in-btn.sign-in-btn--secondary` — grouped in `.sign-in-actions` below the primary button, or in `.sign-in-otp__footer` beside the text-style resend control.

| Step | Primary | Secondary |
| --- | --- | --- |
| Credentials (sign in) | Sign in | Forgot password?, Need an account? Create one (`.sign-in-actions`) |
| Credentials (sign up) | Create account | Already have an account? Sign in (`.sign-in-actions`) |
| Email verification | Verify email | Resend (`.sign-in-resend`), Back to sign in (`.sign-in-otp__footer`) |
| Forgot password — email | Send code | Back to sign in (`.sign-in-actions`) |
| Forgot password — OTP | Continue | Resend (`.sign-in-resend`), Change email (`.sign-in-otp__footer`) |
| Forgot password — new password | Save new password | Back to reset code (`.sign-in-actions`) |

Styles: [src/styles/README.md](../../styles/README.md) · [index.css](../../styles/index.css).

## Related

| Location | Role |
| --- | --- |
| [hooks/README.md](../../hooks/README.md) | useSessionAuth, useApplicantRouting |
| [convex/README.md](../../convex/README.md) | auth.ts, rateLimits.ts, passwordReset.ts |
| [docs/API.md](../../../docs/API.md) | Auth and rate-limit reference |

Parent index: [../README.md](../README.md).
