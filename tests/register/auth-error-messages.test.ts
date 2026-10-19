import { describe, expect, it } from "vitest";
import {
  ACCOUNT_CREATION_FAILED_MESSAGE,
  AUTH_FAILED_MESSAGE,
  mapAuthError,
  mapPasswordResetError,
  OTP_INVALID_MESSAGE,
} from "../../shared/auth/errorMessages";
import { OTP_HOURLY_LIMIT_MESSAGE } from "../../shared/auth/otpRateLimit";
import { PASSWORD_REQUIREMENTS_MESSAGE } from "../../shared/auth/password";
import {
  PASSWORD_RESET_FAILED_MESSAGE,
  PASSWORD_RESET_HOURLY_LIMIT_MESSAGE,
  PASSWORD_REUSE_MESSAGE,
} from "../../shared/auth/passwordResetMessages";

describe("authentication error mapping", () => {
  it("maps unknown auth errors to the safe fallback", () => {
    expect(mapAuthError(new Error("[CONVEX A(auth:signIn)] database timeout"))).toBe(
      AUTH_FAILED_MESSAGE,
    );
  });

  it("maps known credential failures to actionable copy", () => {
    expect(mapAuthError(new Error("Invalid credentials"))).toBe(AUTH_FAILED_MESSAGE);
    expect(mapAuthError(new Error("An account with this email already exists"))).toBe(
      "An account with this email already exists. Sign in instead.",
    );
  });

  it("maps verification failures without exposing provider details", () => {
    expect(mapAuthError(new Error("Verification code has expired"))).toBe(OTP_INVALID_MESSAGE);
    expect(mapAuthError(new Error("Invalid code"))).toBe(OTP_INVALID_MESSAGE);
    expect(mapAuthError(new Error("[CONVEX A(auth:signIn)] Server Error"))).toBe(
      AUTH_FAILED_MESSAGE,
    );
  });
  it("maps signUp errors to the correct message", () => {
    expect(mapAuthError(new Error("Some error"), "signUp")).toBe(
      ACCOUNT_CREATION_FAILED_MESSAGE,
    );
  });

  it("maps password reset errors without exposing backend details", () => {
    expect(mapPasswordResetError(new Error(PASSWORD_REUSE_MESSAGE))).toBe(
      PASSWORD_REUSE_MESSAGE,
    );
    expect(PASSWORD_REUSE_MESSAGE).toContain("Request a new reset code");
    expect(
      mapPasswordResetError({ data: PASSWORD_REUSE_MESSAGE, message: "Server Error" }),
    ).toBe(PASSWORD_REUSE_MESSAGE);
    expect(mapPasswordResetError(new Error("Verification code has expired"))).toBe(
      OTP_INVALID_MESSAGE,
    );
    expect(mapPasswordResetError(new Error("Too many reset requests. Please try again later."))).toBe(
      "Too many reset requests. Please try again later.",
    );
    expect(mapPasswordResetError(new Error("[CONVEX A(auth:signIn)] Server Error"))).toBe(
      PASSWORD_RESET_FAILED_MESSAGE,
    );
  });
});

describe("mapAuthError", () => {
  it.each([
    ["non-Error values", "boom", "signIn", AUTH_FAILED_MESSAGE],
    ["null", null, "signUp", ACCOUNT_CREATION_FAILED_MESSAGE],
    ["whitespace-only messages", new Error("   "), "signIn", AUTH_FAILED_MESSAGE],
  ] as const)("falls back safely for %s", (_label, error, mode, expected) => {
    expect(mapAuthError(error, mode)).toBe(expected);
  });

  it.each([
    ["Too many verification requests. Please try again later.", OTP_HOURLY_LIMIT_MESSAGE],
    ["Please wait before requesting another code.", "Please wait before requesting another code."],
    ["Passwords do not match", "Passwords do not match."],
    ["Invalid password", PASSWORD_REQUIREMENTS_MESSAGE],
    ["Password must contain a number", PASSWORD_REQUIREMENTS_MESSAGE],
    ["Invalid email", "Please enter a valid email address."],
    ["Enter a valid email address", "Please enter a valid email address."],
    ["User is already registered", "An account with this email already exists. Sign in instead."],
    ["This email is already in use", "An account with this email already exists. Sign in instead."],
    ["Expired code", OTP_INVALID_MESSAGE],
    ["Incorrect password", AUTH_FAILED_MESSAGE],
    ["Wrong password supplied", AUTH_FAILED_MESSAGE],
  ])("maps %j to user-facing copy", (message, expected) => {
    expect(mapAuthError(new Error(message), "signUp")).toBe(expected);
  });

  it("checks rate limits before credential wording so cooldowns are not reported as bad passwords", () => {
    expect(
      mapAuthError(new Error("Please wait before requesting another code. Incorrect code.")),
    ).toBe("Please wait before requesting another code.");
  });
});

describe("mapPasswordResetError", () => {
  it.each([
    ["undefined", undefined],
    ["a plain object without data", { message: "hidden" }],
    ["blank data and a non-Error", { data: "   " }],
    ["a blank Error", new Error("  ")],
  ])("uses the generic reset failure for %s", (_label, error) => {
    expect(mapPasswordResetError(error)).toBe(PASSWORD_RESET_FAILED_MESSAGE);
  });

  it("prefers ConvexError data over the masked message", () => {
    const error = Object.assign(new Error("Server Error"), { data: "Invalid code" });
    expect(mapPasswordResetError(error)).toBe(OTP_INVALID_MESSAGE);
  });

  it.each([
    ["New password is the same as your current password", PASSWORD_REUSE_MESSAGE],
    ["Please wait before requesting another code.", "Please wait before requesting another code."],
    ["Passwords do not match", "Passwords do not match."],
    ["Invalid password", PASSWORD_REQUIREMENTS_MESSAGE],
    ["Password must be at least 8 characters", PASSWORD_REQUIREMENTS_MESSAGE],
    ["Invalid email", "Please enter a valid email address."],
    ["Enter a valid email", "Please enter a valid email address."],
    ["Invalid code", OTP_INVALID_MESSAGE],
    ["Could not verify code", OTP_INVALID_MESSAGE],
    ["Expired code", OTP_INVALID_MESSAGE],
    ["Reset code not found", OTP_INVALID_MESSAGE],
    ["Incorrect password", PASSWORD_RESET_FAILED_MESSAGE],
  ])("maps %j", (message, expected) => {
    expect(mapPasswordResetError(new Error(message))).toBe(expected);
  });

  it("uses the reset-specific hourly message for too-many limits", () => {
    expect(
      mapPasswordResetError(new Error("Too many verification requests. Please try again later.")),
    ).toBe(PASSWORD_RESET_HOURLY_LIMIT_MESSAGE);
  });
});
