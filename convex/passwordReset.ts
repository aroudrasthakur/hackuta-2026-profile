import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { requireAuthUserId } from "./lib/auth";
import {
  isAuthSignInRateLimited,
  recordFailedAuthSignIn,
} from "./lib/authSignInRateLimit";
import { invalidateAllSessionsForUser } from "./lib/invalidateAuthSessions";
import { normalizeEmail } from "./lib/normalizeEmail";
import { sha256Hex } from "./lib/sha256Hex";

const INVALID_RESET_CODE_MESSAGE = "Invalid code";

/** Clears every auth session after a successful password reset. */
export const invalidateSessionsAfterPasswordReset = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);
    await invalidateAllSessionsForUser(ctx, userId);
    return { ok: true as const };
  },
});

export const invalidateResetSession = internalMutation({
  args: { userId: v.id("users"), sessionId: v.id("authSessions") },
  handler: async (ctx, { userId, sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session || session.userId !== userId) return;

    const refreshTokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const token of refreshTokens) {
      await ctx.db.delete(token._id);
    }
    await ctx.db.delete(sessionId);
  },
});

/** Confirms a reset OTP is still unused without consuming it. */
export const assertResetCodeAvailable = mutation({
  args: { email: v.string(), code: v.string() },
  handler: async (ctx, { email, code }) => {
    const normalized = normalizeEmail(email);
    const trimmedCode = code.trim();
    if (!normalized || !/^\d{6}$/.test(trimmedCode)) {
      throw new Error(INVALID_RESET_CODE_MESSAGE);
    }

    if (await isAuthSignInRateLimited(ctx, normalized)) {
      return { ok: false as const };
    }

    const codeHash = await sha256Hex(trimmedCode);
    const verificationCode = await ctx.db
      .query("authVerificationCodes")
      .withIndex("code", (q) => q.eq("code", codeHash))
      .unique();

    const usable =
      verificationCode !== null &&
      verificationCode.provider === "password-reset" &&
      verificationCode.emailVerified === normalized &&
      verificationCode.expirationTime >= Date.now() &&
      verificationCode.verifier === undefined;

    if (!usable) {
      await recordFailedAuthSignIn(ctx, normalized);
      return { ok: false as const };
    }

    return { ok: true as const };
  },
});
