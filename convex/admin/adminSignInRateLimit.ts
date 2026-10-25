import type { MutationCtx } from "../lib/dataModel";
import { normalizeEmail } from "../lib/normalizeEmail";

/** Durable sign-in throttling for an account and each client IP + email pair. */
export const ADMIN_SIGN_IN_FAILURE_BUCKET = "admin_sign_in_failure";
export const ADMIN_SIGN_IN_ACCOUNT_FAILURE_BUCKET = "admin_sign_in_account_failure";
export const ADMIN_SIGN_IN_MAX_FAILURES = 5;
export const ADMIN_SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
export const ADMIN_SIGN_IN_CLIENT_IP_MAX_LENGTH = 64;

type SignInFailureBucket =
  | typeof ADMIN_SIGN_IN_FAILURE_BUCKET
  | typeof ADMIN_SIGN_IN_ACCOUNT_FAILURE_BUCKET;

export function normalizeRateLimitClientIp(raw: string | undefined) {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return "unknown";
  }
  return trimmed.slice(0, ADMIN_SIGN_IN_CLIENT_IP_MAX_LENGTH);
}

/** Composite rate-limit key: `${clientIp}:${normalizedEmail}`. */
export function buildAdminSignInRateLimitKey(clientIp: string | undefined, email: string) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }
  const ip = normalizeRateLimitClientIp(clientIp);
  return `${ip}:${normalizedEmail}`;
}

async function recentFailureRows(
  ctx: MutationCtx,
  rateLimitKey: string,
  windowStart: number,
  bucket: SignInFailureBucket,
) {
  return ctx.db
    .query("rateLimits")
    .withIndex("by_bucket_createdAt", (q) => q.eq("bucket", bucket))
    .filter((q) =>
      q.and(
        q.eq(q.field("key"), rateLimitKey),
        q.gte(q.field("createdAt"), windowStart),
      ),
    )
    .collect();
}

export async function isAdminSignInRateLimited(
  ctx: MutationCtx,
  rateLimitKey: string,
  bucket: SignInFailureBucket = ADMIN_SIGN_IN_FAILURE_BUCKET,
) {
  const windowStart = Date.now() - ADMIN_SIGN_IN_WINDOW_MS;
  const failures = await recentFailureRows(ctx, rateLimitKey, windowStart, bucket);
  return failures.length >= ADMIN_SIGN_IN_MAX_FAILURES;
}

export async function recordFailedAdminSignIn(
  ctx: MutationCtx,
  rateLimitKey: string,
  bucket: SignInFailureBucket = ADMIN_SIGN_IN_FAILURE_BUCKET,
) {
  const now = Date.now();
  await ctx.db.insert("rateLimits", {
    bucket,
    key: rateLimitKey,
    createdAt: now,
  });

  const cutoff = now - ADMIN_SIGN_IN_WINDOW_MS;
  const rows = await recentFailureRows(ctx, rateLimitKey, 0, bucket);
  for (const entry of rows) {
    if (entry.createdAt < cutoff) {
      await ctx.db.delete(entry._id);
    }
  }
}

export async function clearAdminSignInFailures(
  ctx: MutationCtx,
  rateLimitKey: string,
  bucket: SignInFailureBucket = ADMIN_SIGN_IN_FAILURE_BUCKET,
) {
  const failures = await recentFailureRows(ctx, rateLimitKey, 0, bucket);
  await Promise.all(failures.map((row) => ctx.db.delete(row._id)));
}
