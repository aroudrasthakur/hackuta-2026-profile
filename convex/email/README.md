# Convex email (`convex/email/`)

HackUTA email service client and templates for registration auth and confirmations.

> **Register-locked:** Do not edit files in this directory. See [REGISTER_SCHEMA.md](../REGISTER_SCHEMA.md).

## Overview

| File | Summary |
| --- | --- |
| [emailService.ts](emailService.ts) | HTTP client for the HackUTA email service (`EMAIL_SERVICE_URL`, `EMAIL_SERVICE_API_KEY`) |
| [templates.ts](templates.ts) | HTML/text bodies for OTP, password reset, and confirmation mail |
| [sendOtpEmail.ts](sendOtpEmail.ts) | sendOtpEmail action — sign-up verification (from [auth.ts](../auth.ts)) |
| [sendPasswordResetEmail.ts](sendPasswordResetEmail.ts) | sendPasswordResetEmail action — password reset (from [auth.ts](../auth.ts)) |
| [sendApplicationConfirmationEmail.ts](sendApplicationConfirmationEmail.ts) | Post-submit confirmation (from [registrations.ts](../registrations.ts)) |
| [checkEmailStatus.ts](checkEmailStatus.ts) | Internal operator action — email service delivery lookup |

## Delivery

- Emails queue via `POST /send-email`; IDs recorded in `emailDeliveries`.
- Failures to write audit rows go to `emailDeliveryRecordingFailures`.
- Env vars set on the Convex deployment, not as `VITE_*`.

## Related

| Location | Role |
| --- | --- |
| [../README.md](../README.md) | Convex backend index |
| [hackuta-2026-register/docs/OPERATIONS.md](../../hackuta-2026-register/docs/OPERATIONS.md) | Email service env setup |

Parent index: [../README.md](../README.md).
