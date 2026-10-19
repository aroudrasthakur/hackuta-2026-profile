import { ConvexError } from "convex/values";
import { Scrypt } from "lucia";
import { describe, expect, it } from "vitest";
import { assertPasswordNotReused } from "../../convex/lib/assertPasswordNotReused";
import { PASSWORD_REUSE_MESSAGE } from "../../shared/auth/passwordResetMessages";

describe("assertPasswordNotReused", () => {
  it("rejects the current password using the stored scrypt hash", async () => {
    const hash = await new Scrypt().hash("OldPass1");
    await expect(assertPasswordNotReused(hash, "OldPass1")).rejects.toThrow(
      new ConvexError(PASSWORD_REUSE_MESSAGE),
    );
  });

  it("allows a different password without a sign-in attempt", async () => {
    const hash = await new Scrypt().hash("OldPass1");
    await expect(assertPasswordNotReused(hash, "NewPass1")).resolves.toBeUndefined();
  });

  it("fails closed when the password account has no stored hash", async () => {
    await expect(assertPasswordNotReused(undefined, "NewPass1")).rejects.toThrow();
  });
});
