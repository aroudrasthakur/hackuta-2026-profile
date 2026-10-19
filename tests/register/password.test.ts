import { describe, expect, it } from "vitest";
import {
  PASSWORD_REQUIREMENTS_MESSAGE,
  validatePasswordConfirmation,
  validatePasswordRequirements,
} from "../../shared/auth/password";

describe("password validation", () => {
  it("accepts a strong password", () => {
    expect(() => validatePasswordRequirements("Hackuta1")).not.toThrow();
  });

  it("rejects passwords missing complexity requirements", () => {
    expect(() => validatePasswordRequirements("password")).toThrow(
      PASSWORD_REQUIREMENTS_MESSAGE,
    );
  });

  it("requires matching confirmation passwords", () => {
    expect(() => validatePasswordConfirmation("Hackuta1", "Hackuta2")).toThrow(
      "Passwords do not match.",
    );
  });
});
