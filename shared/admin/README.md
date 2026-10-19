# shared/admin

Admin-only shared code (not register-locked).

| Path | Role |
| --- | --- |
| [`errors.ts`](errors.ts) | Error codes, `adminError()` throws, and `adminErrorCode()` parsing |
| [`logAdminError.ts`](logAdminError.ts) | Structured `console.error` helper (no PII) |
| [`e2e/`](e2e/) | Mock store and credentials for E2E tests |

## Errors

- Backend: `throw adminError("REVIEW_CLAIMED")` → `ConvexError({ code, message })` on `error.data`.
- `adminErrorCode(error)` reads `data.code` (object or bare code string). String-only `ConvexError` payloads are ignored.
- Frontend: `userFacingErrorMessage(error, fallback)` shows the catalog message for known codes.
- Logging: `logAdminError(context, caught, meta?)` or `reportUserFacingError(..., meta?)` — always structured meta, never email/password/IP.

## Sign-in API migration

Failed `POST /api/admin/sign-in` responses include **`code` + `error`**. See [docs/CHANGES.md](../../docs/CHANGES.md).

Internal checks organizers should never see can keep using `throw new Error(...)`.
