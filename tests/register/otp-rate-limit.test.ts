import { describe, expect, it, vi } from "vitest";
import {
  cooldownStatusFromExpiry,
  formatOtpCooldownMessage,
  formatOtpResendLabel,
  getOtpSendErrorMessage,
  getOtpSendStatusMessage,
  isMaskedConvexAuthError,
  isOtpRateLimitError,
  getCooldownWaitSeconds,
  hasPendingOtpCode,
  mergeCooldownExpiry,
  shouldShowOtpSendCooldown,
  shouldTreatAsOtpRateLimit,
  startCooldownExpiry,
} from "../../shared/auth/otpRateLimit";

describe("otp rate limit helpers", () => {
  it("detects server rate-limit messages", () => {
    expect(isOtpRateLimitError("Too many verification requests. Please try again later.")).toBe(
      true,
    );
    expect(isOtpRateLimitError("Please wait before requesting another code.")).toBe(true);
    expect(isOtpRateLimitError("Missing environment variable SITE_URL")).toBe(false);
  });

  it("detects masked Convex auth errors", () => {
    expect(isMaskedConvexAuthError(new Error("Server Error"))).toBe(true);
    expect(
      isMaskedConvexAuthError(
        new Error("[CONVEX A(auth:signIn)] [Request ID: abc123] Server Error"),
      ),
    ).toBe(true);
    expect(isMaskedConvexAuthError(new Error("Please wait before requesting another code."))).toBe(
      false,
    );
  });

  it("keeps a shared cooldown expiry when syncing from the server", () => {
    const now = 1_000_000;
    const current = startCooldownExpiry(40, now);
    const merged = mergeCooldownExpiry(
      current,
      { waitSeconds: 60, hourlyLimitReached: false },
      now,
    );
    expect(getCooldownWaitSeconds(merged, now + 5_000)).toBe(35);
    expect(getCooldownWaitSeconds(merged, now + 20_000)).toBe(20);
  });

  it("only shows cooldown UI when the server reports an active limit", () => {
    expect(shouldShowOtpSendCooldown({ waitSeconds: 0, hourlyLimitReached: false })).toBe(false);
    expect(shouldShowOtpSendCooldown({ waitSeconds: 12, hourlyLimitReached: false })).toBe(true);
    expect(shouldShowOtpSendCooldown({ waitSeconds: 0, hourlyLimitReached: true })).toBe(true);
    expect(hasPendingOtpCode({ waitSeconds: 12, hourlyLimitReached: false })).toBe(true);
    expect(hasPendingOtpCode({ waitSeconds: 0, hourlyLimitReached: true })).toBe(false);
  });

  it("formats cooldown messages with live seconds", () => {
    expect(formatOtpCooldownMessage(45)).toBe(
      "Please wait before requesting another code. You can send another in 45s.",
    );
    expect(formatOtpResendLabel(12)).toBe("Resend code in 12s");
    expect(formatOtpResendLabel(0)).toBe("Resend code");
  });

  it("builds status messages from server cooldown state", () => {
    expect(getOtpSendStatusMessage({ waitSeconds: 0, hourlyLimitReached: false })).toBeNull();
    expect(getOtpSendStatusMessage({ waitSeconds: 30, hourlyLimitReached: false })).toBe(
      "Please wait before requesting another code. You can send another in 30s.",
    );
    expect(getOtpSendStatusMessage({ waitSeconds: 0, hourlyLimitReached: true })).toBe(
      "Too many verification requests. Please try again later.",
    );
  });

  it("treats server cooldown state as a rate limit", () => {
    expect(shouldTreatAsOtpRateLimit(new Error("Server Error"))).toBe(false);
    expect(
      shouldTreatAsOtpRateLimit(new Error("Please wait before requesting another code."), {
        waitSeconds: 0,
        hourlyLimitReached: false,
      }),
    ).toBe(true);
  });

  it("returns rate-limit messages in production mode", () => {
    expect(
      getOtpSendErrorMessage(
        new Error("Please wait before requesting another code."),
        false,
      ),
    ).toBe("Please wait before requesting another code.");
  });

  it("returns other errors only in dev mode", () => {
    expect(getOtpSendErrorMessage(new Error("Missing SITE_URL"), false)).toBeNull();
    expect(getOtpSendErrorMessage(new Error("Missing SITE_URL"), true)).toBeNull();
    expect(getOtpSendErrorMessage(new Error("Server Error"), true)).toBeNull();
  });

  it("never treats non-Error values as masked Convex auth errors", () => {
    expect(isMaskedConvexAuthError("Server Error")).toBe(false);
    expect(isMaskedConvexAuthError({ message: "Server Error" })).toBe(false);
  });

  describe("mergeCooldownExpiry", () => {
    const now = 5_000_000;

    it("keeps the current expiry untouched while the hourly limit is reached", () => {
      expect(mergeCooldownExpiry(null, { waitSeconds: 30, hourlyLimitReached: true }, now)).toBeNull();
      expect(
        mergeCooldownExpiry(now + 9_000, { waitSeconds: 0, hourlyLimitReached: true }, now),
      ).toBe(now + 9_000);
    });

    it("keeps an active local cooldown when the server reports none", () => {
      const noWait = { waitSeconds: 0, hourlyLimitReached: false };
      expect(mergeCooldownExpiry(now + 4_000, noWait, now)).toBe(now + 4_000);
      expect(mergeCooldownExpiry(now - 1, noWait, now)).toBeNull();
      expect(mergeCooldownExpiry(now, noWait, now)).toBeNull();
      expect(mergeCooldownExpiry(null, noWait, now)).toBeNull();
    });

    it("adopts the server cooldown when there is no active local one", () => {
      const wait = { waitSeconds: 20, hourlyLimitReached: false };
      expect(mergeCooldownExpiry(null, wait, now)).toBe(now + 20_000);
      expect(mergeCooldownExpiry(now - 10, wait, now)).toBe(now + 20_000);
    });

    it("never extends an active local cooldown upward", () => {
      expect(
        mergeCooldownExpiry(now + 60_000, { waitSeconds: 10, hourlyLimitReached: false }, now),
      ).toBe(now + 10_000);
    });

    it("defaults `now` to the current clock", () => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        expect(mergeCooldownExpiry(null, { waitSeconds: 1, hourlyLimitReached: false })).toBe(
          now + 1_000,
        );
        expect(getCooldownWaitSeconds(now + 1_500)).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("computes wait seconds with rounding up and a floor of zero", () => {
    expect(getCooldownWaitSeconds(null, 0)).toBe(0);
    expect(getCooldownWaitSeconds(0, 0)).toBe(0);
    expect(getCooldownWaitSeconds(1_001, 0)).toBe(2);
    expect(getCooldownWaitSeconds(500, 1_000)).toBe(0);
    expect(cooldownStatusFromExpiry(3_000, true, 0)).toEqual({
      waitSeconds: 3,
      hourlyLimitReached: true,
    });
  });

  it("treats server status alone as a rate limit and otherwise inspects the error", () => {
    expect(shouldTreatAsOtpRateLimit(null, { waitSeconds: 0, hourlyLimitReached: true })).toBe(true);
    expect(shouldTreatAsOtpRateLimit(null, { waitSeconds: 5, hourlyLimitReached: false })).toBe(true);
    expect(shouldTreatAsOtpRateLimit("Too many verification requests")).toBe(false);
    expect(shouldTreatAsOtpRateLimit(new Error("  "))).toBe(false);
    expect(
      shouldTreatAsOtpRateLimit(new Error("Too many verification requests. Please try again later.")),
    ).toBe(true);
  });

  it("ignores non-error values and blank messages", () => {
    expect(getOtpSendErrorMessage("not an error", false)).toBeNull();
    expect(getOtpSendErrorMessage(new Error("   "), false)).toBeNull();
  });
});
