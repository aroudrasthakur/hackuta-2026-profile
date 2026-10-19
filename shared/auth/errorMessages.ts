import {
  isOtpRateLimitError,
  OTP_HOURLY_LIMIT_MESSAGE,
} from "./otpRateLimit";
import {
  PASSWORD_RESET_FAILED_MESSAGE,
  PASSWORD_RESET_HOURLY_LIMIT_MESSAGE,
  PASSWORD_REUSE_MESSAGE,
} from "./passwordResetMessages";
import { PASSWORD_REQUIREMENTS_MESSAGE } from "./password";

export const AUTH_FAILED_MESSAGE =
  "Incorrect email or password. Please try again.";
export const ACCOUNT_CREATION_FAILED_MESSAGE =
  "Sorry we couldn't create your account. Please try again.";
export const OTP_INVALID_MESSAGE =
  "This code is invalid or has expired. Please request a new code.";

export function mapAuthError(
  error: unknown,
  mode: "signIn" | "signUp" = "signIn",
): string {
  const detail = error instanceof Error ? error.message.trim() : "";
  const normalized = detail.toLowerCase();
  const fallback = mode === "signUp" ? ACCOUNT_CREATION_FAILED_MESSAGE : AUTH_FAILED_MESSAGE;

  if (!detail) return fallback;
  if (isOtpRateLimitError(detail)) {
    return normalized.includes("too many")
      ? OTP_HOURLY_LIMIT_MESSAGE
      : "Please wait before requesting another code.";
  }
  if (normalized.includes("passwords do not match")) {
    return "Passwords do not match.";
  }
  if (
    normalized.includes("invalid password") ||
    normalized.includes("password must")
  ) {
    return PASSWORD_REQUIREMENTS_MESSAGE;
  }
  if (
    normalized.includes("invalid email") ||
    normalized.includes("enter a valid email")
  ) {
    return "Please enter a valid email address.";
  }
  if (
    normalized.includes("already exists") ||
    normalized.includes("already registered") ||
    normalized.includes("email is already")
  ) {
    return "An account with this email already exists. Sign in instead.";
  }
  if (
    normalized.includes("invalid code") ||
    normalized.includes("expired code") ||
    normalized.includes("verification code")
  ) {
    return OTP_INVALID_MESSAGE;
  }
  if (
    normalized.includes("incorrect") ||
    normalized.includes("invalid credentials") ||
    normalized.includes("wrong password")
  ) {
    return AUTH_FAILED_MESSAGE;
  }

  return fallback;
}

function authErrorDetail(error: unknown): string {
  if (error && typeof error === "object") {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "string" && data.trim()) {
      return data.trim();
    }
  }
  if (error instanceof Error) {
    return error.message.trim();
  }
  return "";
}

export function mapPasswordResetError(error: unknown): string {
  const detail = authErrorDetail(error);
  const normalized = detail.toLowerCase();

  if (!detail) return PASSWORD_RESET_FAILED_MESSAGE;
  if (detail === PASSWORD_REUSE_MESSAGE || normalized.includes("same as your current")) {
    return PASSWORD_REUSE_MESSAGE;
  }
  if (isOtpRateLimitError(detail)) {
    return normalized.includes("too many")
      ? PASSWORD_RESET_HOURLY_LIMIT_MESSAGE
      : "Please wait before requesting another code.";
  }
  if (normalized.includes("passwords do not match")) {
    return "Passwords do not match.";
  }
  if (
    normalized.includes("invalid password") ||
    normalized.includes("password must")
  ) {
    return PASSWORD_REQUIREMENTS_MESSAGE;
  }
  if (
    normalized.includes("invalid email") ||
    normalized.includes("enter a valid email")
  ) {
    return "Please enter a valid email address.";
  }
  if (
    normalized.includes("invalid code") ||
    normalized.includes("expired code") ||
    normalized.includes("could not verify code") ||
    normalized.includes("verification code") ||
    normalized.includes("reset code")
  ) {
    return OTP_INVALID_MESSAGE;
  }

  return PASSWORD_RESET_FAILED_MESSAGE;
}
