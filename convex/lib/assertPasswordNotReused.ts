import { ConvexError } from "convex/values";
import { Scrypt } from "lucia";
import { PASSWORD_REUSE_MESSAGE } from "../../shared/auth/passwordResetMessages";

/** Reject password reset when the new password matches the current hash. */
export async function assertPasswordNotReused(currentHash: string | undefined, newPassword: string) {
  if (!currentHash) throw new Error("Password account is not configured.");
  if (await new Scrypt().verify(currentHash, newPassword)) {
    throw new ConvexError(PASSWORD_REUSE_MESSAGE);
  }
}
