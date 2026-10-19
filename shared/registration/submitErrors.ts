import {
  RESUME_EMPTY_ERROR_MESSAGE,
  RESUME_MISSING_MESSAGE,
  RESUME_SIZE_ERROR_MESSAGE,
  RESUME_UPLOAD_EXPIRED_MESSAGE,
} from "./resume";

export const SUBMIT_ERROR_MESSAGE =
  "We couldn't submit your application. Please try again.";
export const APPLICATION_CLOSED_MESSAGE = "Applications are closed.";
export const APPLICATION_NOT_OPEN_MESSAGE = "Applications are not open yet.";

export const DRAFT_SAVE_ERROR_MESSAGE =
  "We couldn't save your latest changes. Please try again.";

export const RESUME_UPLOAD_ERROR_MESSAGE =
  "We couldn't upload your resume. Please try again.";

export const SIGN_IN_REQUIRED_MESSAGE =
  "Please sign in to submit your application.";

export const RESUME_UPLOAD_AUTH_REQUIRED_MESSAGE =
  "Please sign in to upload your resume.";

export const RESUME_REMOVE_ERROR_MESSAGE =
  "We couldn't remove your resume. Please try again.";

/** Server messages safe to show applicants in production. */
const USER_FACING_SERVER_MESSAGES = new Set([
  APPLICATION_CLOSED_MESSAGE,
  APPLICATION_NOT_OPEN_MESSAGE,
  SIGN_IN_REQUIRED_MESSAGE,
  RESUME_UPLOAD_AUTH_REQUIRED_MESSAGE,
  "You have already submitted an application.",
  "Please upload a valid PDF resume of 2 MB or smaller.",
  "This resume is already attached to another application.",
  RESUME_UPLOAD_EXPIRED_MESSAGE,
  "That email address is already associated with another account. Sign in with that email or contact us for help.",
  "Too many resume upload attempts. Please wait a few minutes and try again.",
]);

/** Submission failures that should highlight the resume field. */
const RESUME_FIELD_MESSAGES = new Set([
  "Please select a PDF file.",
  RESUME_EMPTY_ERROR_MESSAGE,
  RESUME_SIZE_ERROR_MESSAGE,
  "Please upload a PDF.",
  "Content-Length header is required.",
  "Invalid upload request.",
  "Too many uploads. Please try again later.",
  "Too many resume upload attempts. Please wait a few minutes and try again.",
  "Please upload a valid PDF resume of 2 MB or smaller.",
  "This resume is already attached to another application.",
  RESUME_UPLOAD_EXPIRED_MESSAGE,
  RESUME_MISSING_MESSAGE,
  RESUME_REMOVE_ERROR_MESSAGE,
  RESUME_UPLOAD_ERROR_MESSAGE,
  "Resume upload is unavailable. Please try again later or contact us.",
  "We couldn't upload your resume. Check your connection and try again.",
]);

export function isResumeFieldMessage(message: string) {
  return RESUME_FIELD_MESSAGES.has(message);
}

const UPLOAD_SERVER_MESSAGE_ALIASES: Record<string, string> = {
  "Content-Length header is required.": "We couldn't upload your resume. Please try again.",
  "Invalid upload request.": "We couldn't upload your resume. Please try again.",
  "Origin is not allowed.": "Resume upload is unavailable. Please try again later or contact us.",
  "The resume could not be stored.": RESUME_UPLOAD_ERROR_MESSAGE,
  "Please upload a PDF.": "Please select a PDF file.",
  "The PDF is too large.": RESUME_SIZE_ERROR_MESSAGE,
  "The PDF must be between 1 byte and 2 MB.": RESUME_SIZE_ERROR_MESSAGE,
  "The PDF must be between 1 byte and 5 MB.": RESUME_SIZE_ERROR_MESSAGE,
  "Please upload a valid PDF resume of 5 MB or smaller.": RESUME_SIZE_ERROR_MESSAGE,
  "The PDF is empty.": RESUME_EMPTY_ERROR_MESSAGE,
  "The PDF is empty. Please select another file.": RESUME_EMPTY_ERROR_MESSAGE,
};

function isLegacyResumeSizeMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("too large") ||
    normalized.includes("between 1 byte and") ||
    (normalized.includes("5 mb") && (normalized.includes("pdf") || normalized.includes("resume")))
  );
}

function normalizeUploadServerMessage(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (UPLOAD_SERVER_MESSAGE_ALIASES[trimmed]) {
    return UPLOAD_SERVER_MESSAGE_ALIASES[trimmed];
  }
  if (isLegacyResumeSizeMessage(trimmed)) {
    return RESUME_SIZE_ERROR_MESSAGE;
  }
  if (isResumeFieldMessage(trimmed)) {
    return trimmed;
  }
  return null;
}

export function mapUploadError(error: unknown): string {
  if (error instanceof Error) {
    const normalized = normalizeUploadServerMessage(error.message);
    if (normalized) return normalized;
  }
  return RESUME_UPLOAD_ERROR_MESSAGE;
}

export function mapConvexErrorToUserMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : "";
  const normalizedUploadMessage = normalizeUploadServerMessage(detail);
  if (normalizedUploadMessage) return normalizedUploadMessage;
  if (USER_FACING_SERVER_MESSAGES.has(detail)) {
    return detail;
  }
  const normalized = detail.toLowerCase();
  if (normalized.includes("applications are closed")) {
    return APPLICATION_CLOSED_MESSAGE;
  }
  if (normalized.includes("applications are not open yet")) {
    return APPLICATION_NOT_OPEN_MESSAGE;
  }
  if (normalized.includes("authentication required")) {
    return SIGN_IN_REQUIRED_MESSAGE;
  }
  if (normalized.includes("verify your email") || normalized.includes("verified email")) {
    return "Please verify your email before submitting your application.";
  }
  if (normalized.includes("already submitted")) {
    return "You have already submitted an application.";
  }
  if (normalized.includes("already attached")) {
    return "This resume is already attached to another application.";
  }
  if (normalized.includes("resume upload expired")) {
    return RESUME_UPLOAD_EXPIRED_MESSAGE;
  }
  if (isLegacyResumeSizeMessage(detail)) {
    return RESUME_SIZE_ERROR_MESSAGE;
  }
  if (isResumeFieldMessage(detail)) {
    return detail;
  }
  return SUBMIT_ERROR_MESSAGE;
}

export function mapResumeUploadHttpError(
  status: number,
  body: unknown,
): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    const normalized = normalizeUploadServerMessage(body.error);
    if (normalized) return normalized;
  }

  switch (status) {
    case 401:
      return RESUME_UPLOAD_AUTH_REQUIRED_MESSAGE;
    case 400:
    case 411:
      return "We couldn't upload your resume. Please try again.";
    case 413:
      return RESUME_SIZE_ERROR_MESSAGE;
    case 415:
      return "Please select a PDF file.";
    case 429:
      return "Too many uploads. Please try again later.";
    case 403:
      return "Resume upload is unavailable. Please try again later or contact us.";
    default:
      return RESUME_UPLOAD_ERROR_MESSAGE;
  }
}
