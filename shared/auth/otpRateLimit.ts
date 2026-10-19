export const OTP_RESEND_COOLDOWN_SECONDS = 30;
export const OTP_SEND_MAX_PER_HOUR = 5;

export const OTP_HOURLY_LIMIT_MESSAGE =
  "Too many verification requests. Please try again later.";

const RATE_LIMIT_PATTERNS = [
  /too many verification requests/i,
  /too many reset requests/i,
  /please wait before requesting another code/i,
];

export function isOtpRateLimitError(message: string) {
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message));
}

export function isMaskedConvexAuthError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.trim();
  return /server error/i.test(message) || /\[CONVEX A\(auth:signIn\)\]/i.test(message);
}

export function shouldShowOtpSendCooldown(status: OtpSendCooldownStatus) {
  return status.waitSeconds > 0 || status.hourlyLimitReached;
}

export function hasPendingOtpCode(status: OtpSendCooldownStatus) {
  return status.waitSeconds > 0;
}

export function formatOtpCooldownMessage(waitSeconds: number) {
  return `Please wait before requesting another code. You can send another in ${waitSeconds}s.`;
}

export function formatOtpResendLabel(waitSeconds: number) {
  return waitSeconds > 0 ? `Resend code in ${waitSeconds}s` : "Resend code";
}

export type OtpSendCooldownStatus = {
  waitSeconds: number;
  hourlyLimitReached: boolean;
};

export function getCooldownWaitSeconds(
  expiresAt: number | null,
  now = Date.now(),
) {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function cooldownStatusFromExpiry(
  expiresAt: number | null,
  hourlyLimitReached: boolean,
  now = Date.now(),
): OtpSendCooldownStatus {
  return {
    waitSeconds: getCooldownWaitSeconds(expiresAt, now),
    hourlyLimitReached,
  };
}

/** Keep the active cooldown when syncing from the server; never extend it upward. */
export function mergeCooldownExpiry(
  currentExpiresAt: number | null,
  status: OtpSendCooldownStatus,
  now = Date.now(),
): number | null {
  if (status.hourlyLimitReached) return currentExpiresAt;

  if (status.waitSeconds <= 0) {
    return currentExpiresAt && currentExpiresAt > now ? currentExpiresAt : null;
  }

  const serverExpiresAt = now + status.waitSeconds * 1000;
  if (!currentExpiresAt || currentExpiresAt <= now) {
    return serverExpiresAt;
  }

  return Math.min(currentExpiresAt, serverExpiresAt);
}

export function startCooldownExpiry(
  waitSeconds: number,
  now = Date.now(),
) {
  return now + waitSeconds * 1000;
}

export function getOtpSendStatusMessage(status: OtpSendCooldownStatus) {
  if (status.hourlyLimitReached) {
    return OTP_HOURLY_LIMIT_MESSAGE;
  }
  if (status.waitSeconds > 0) {
    return formatOtpCooldownMessage(status.waitSeconds);
  }
  return null;
}

export function shouldTreatAsOtpRateLimit(
  error: unknown,
  status?: OtpSendCooldownStatus,
) {
  if (status?.hourlyLimitReached || (status?.waitSeconds ?? 0) > 0) {
    return true;
  }
  if (!(error instanceof Error) || !error.message.trim()) {
    return false;
  }
  return isOtpRateLimitError(error.message.trim());
}

export function getOtpSendErrorMessage(error: unknown, _devMode: boolean): string | null {
  void _devMode;
  if (!(error instanceof Error) || !error.message.trim()) {
    return null;
  }

  const message = error.message.trim();
  if (isOtpRateLimitError(message)) {
    return message;
  }

  return null;
}
