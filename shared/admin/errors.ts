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
  DECISION_EMAIL_MISSING:
    "This application has no email address, so the decision cannot be queued.",
  DECISION_EMAIL_QUEUE_EMPTY: "There are no queued decision emails to send.",
  DECISION_EMAIL_SEND_IN_PROGRESS:
    "Decision emails are already being sent. Wait for that release to finish.",
  INVALID_POINTS: "That point change isn't allowed.",
  INVALID_EVENT: "Check the event name, points, and schedule, then try again.",
  INVALID_MEAL: "Enter a meal name (up to 100 characters), a description up to 1000 characters, and an end time after the start time.",
  MEAL_NOT_FOUND: "This meal no longer exists. Refresh the meals list and try again.",
  MEAL_OVERLAP: "This serving window overlaps another enabled meal. Change the schedule or disable the other meal first.",
  MEAL_HAS_REDEMPTIONS: "This meal has collection history and cannot be removed. Deactivate it to preserve its history.",
  EVENT_NOT_FOUND: "We couldn't find that event.",
  EVENT_INACTIVE: "This event isn't active.",
  EVENT_ACCESS_DENIED: "You aren't assigned to this event.",
  POINTS_ALREADY_AWARDED: "This participant already received points for that event.",
  EVENT_POINTS_LOCKED:
    "This event's points can't change because participants have already received them.",
  PARTICIPANT_NOT_FOUND: "We couldn't find this participant.",
  PARTICIPANT_NOT_ELIGIBLE: "This participant isn't eligible for that action.",
  VOLUNTEER_ONLY: "Only volunteers can perform this action.",
  CAPABILITY_DENIED: "You don't have permission for this scan.",
  STAFF_ACCOUNT_EXISTS: "A staff account already uses that email or participant.",
  VOLUNTEER_NOT_FOUND: "We couldn't find that volunteer account.",
  INVALID_STAFF_NAME: "Enter a name for this staff account.",
  INVALID_EVENT_ASSIGNMENT: "Each event can be listed once, up to 50 events. Remove duplicates and try again.",
  INVALID_LOG_FILTER: "Check the date range and try again.",
  INVALID_ADJUSTMENT_REASON: "Enter a reason for this point change (up to 200 characters).",
  INVALID_PARTICIPANT_FILTER: "Shorten the search to 100 characters or fewer and try again.",
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
