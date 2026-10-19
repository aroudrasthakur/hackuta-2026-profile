import { ConvexError } from "convex/values";

export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_REQUIREMENTS_MESSAGE =
  "Password must be at least 8 characters and include uppercase, lowercase, and a number.";

export function validatePasswordRequirements(password: string) {
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    !/\d/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password)
  ) {
    throw new ConvexError(PASSWORD_REQUIREMENTS_MESSAGE);
  }
}

export function validatePasswordConfirmation(
  password: string,
  confirmPassword: string,
) {
  if (password !== confirmPassword) {
    throw new ConvexError("Passwords do not match.");
  }
}
