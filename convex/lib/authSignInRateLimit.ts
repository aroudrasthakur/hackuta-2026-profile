import type { MutationCtx } from "./dataModel";

/** Matches `signIn.maxFailedAttempsPerHour` in convex/auth.ts. */
export const AUTH_MAX_FAILED_ATTEMPTS_PER_HOUR = 5;

function attemptsLeftForLimit(
  limit: { attemptsLeft: number; lastAttemptTime: number },
  now: number,
) {
  const elapsed = now - limit.lastAttemptTime;
  const maxAttemptsPerMs = AUTH_MAX_FAILED_ATTEMPTS_PER_HOUR / (60 * 60 * 1000);
  return Math.min(
    AUTH_MAX_FAILED_ATTEMPTS_PER_HOUR,
    limit.attemptsLeft + elapsed * maxAttemptsPerMs,
  );
}

export async function isAuthSignInRateLimited(ctx: MutationCtx, identifier: string) {
  const limit = await ctx.db
    .query("authRateLimits")
    .withIndex("identifier", (q) => q.eq("identifier", identifier))
    .unique();
  if (limit === null) return false;
  return attemptsLeftForLimit(limit, Date.now()) < 1;
}

export async function recordFailedAuthSignIn(ctx: MutationCtx, identifier: string) {
  const now = Date.now();
  const limit = await ctx.db
    .query("authRateLimits")
    .withIndex("identifier", (q) => q.eq("identifier", identifier))
    .unique();
  if (limit !== null) {
    await ctx.db.patch(limit._id, {
      attemptsLeft: attemptsLeftForLimit(limit, now) - 1,
      lastAttemptTime: now,
    });
    return;
  }
  await ctx.db.insert("authRateLimits", {
    identifier,
    attemptsLeft: AUTH_MAX_FAILED_ATTEMPTS_PER_HOUR - 1,
    lastAttemptTime: now,
  });
}
