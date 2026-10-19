import { ConvexError } from "convex/values";

/**
 * Organizer-facing errors. Convex functions throw these as `ConvexError({ code, message })`.
 *
 * **ConvexError contract (admin):**
 * - Preferred payload: `{ code: AdminErrorCode, message: string }` on `error.data`.
 * - Also accepted: `error.data` is a bare `AdminErrorCode` string (message resolved from catalog).
 * - String-only `ConvexError("…")` and plain `Error` are not treated as admin codes (returns null).
 * - In production, Convex may redact the message shown in the browser; structured `data.code` still
 *   reaches the client for known `adminError()` throws.
 */
export const ADMIN_ERROR_MESSAGES = {
  NOT_AUTHENTICATED: "Your session has expired. Please sign in again.",
  NOT_AUTHORIZED: "You do not have permission to perform this action.",
  ADMIN_ONLY: "Only admins can perform this action.",
  APPLICATION_NOT_FOUND: "We couldn't find this application. It may have been removed.",
  APPLICATION_NOT_SUBMITTED: "This application hasn't been submitted yet.",
  REVIEW_CLAIMED:
    "Another organizer is reviewing this application. Try again later or pick another one.",
  REVIEW_FINALIZED: "This application already has a final decision.",
  APPLICANT_ACCOUNT_MISSING:
    "The applicant's account no longer exists, so this application can't be accepted. Contact the tech team.",
  PARTICIPANT_CONFLICT:
    "This applicant already has a participant record from a different application. Contact the tech team before accepting.",
  APPLICANT_ALREADY_SUBMITTED: "This applicant already has a submitted application.",
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_CREDENTIALS: "Incorrect email or password. Please try again.",
  ACCOUNT_INACTIVE:
    "This organizer account is deactivated. Contact an admin if you need access.",
  SIGN_IN_RATE_LIMITED:
    "Too many failed sign-in attempts. Please wait a few minutes and try again.",
} as const;

export type AdminErrorCode = keyof typeof ADMIN_ERROR_MESSAGES;

export type AdminErrorData = { code: AdminErrorCode; message: string };

/** Shown for unexpected failures; details stay in the console and server logs. */
export const GENERIC_ERROR_MESSAGE =
  "Something went wrong. Please try again. If it keeps happening, contact the tech team.";

export const SIGN_IN_FAILED_MESSAGE =
  "We couldn't sign you in right now. Please try again in a moment.";

export function isAdminErrorCode(value: unknown): value is AdminErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ADMIN_ERROR_MESSAGES, value);
}

export function adminError(code: AdminErrorCode) {
  return new ConvexError<AdminErrorData>({ code, message: ADMIN_ERROR_MESSAGES[code] });
}

function normalizeAdminErrorData(data: unknown): AdminErrorData | null {
  if (isAdminErrorCode(data)) {
    return { code: data, message: ADMIN_ERROR_MESSAGES[data] };
  }
  if (!data || typeof data !== "object") {
    return null;
  }
  const code = (data as { code?: unknown }).code;
  if (!isAdminErrorCode(code)) {
    return null;
  }
  const message = (data as { message?: unknown }).message;
  return {
    code,
    message: typeof message === "string" ? message : ADMIN_ERROR_MESSAGES[code],
  };
}

/** Reads the code from a thrown `adminError`, or null for anything else. */
export function adminErrorCode(error: unknown): AdminErrorCode | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const data = (error as { data?: unknown }).data;
  return normalizeAdminErrorData(data)?.code ?? null;
}

export function adminErrorData(error: unknown): AdminErrorData | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  return normalizeAdminErrorData((error as { data?: unknown }).data);
}
