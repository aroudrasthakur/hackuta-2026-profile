/**
 * Persistent throttling for volunteer QR lookups, stored in the shared
 * `rateLimits` table (fields unchanged). Buckets embed the volunteer id so each
 * volunteer reads and writes only their own index range.
 *
 * - Every attempt that passes the throttle (success, invalid token, denial)
 *   adds one row to the attempts bucket.
 * - Invalid/malformed tokens and denials also add a row to the failures bucket,
 *   which has a much lower ceiling to stop token guessing.
 * - Rate-limited requests write nothing, so a throttled client cannot grow the
 *   table.
 *
 * Cleanup: each recorded attempt deletes up to `QR_SCAN_PRUNE_PER_WRITE` of the same
 * volunteer's rows that are older than the window. Rows left behind by
 * volunteers who stop scanning are removed by `pruneVolunteerScanRateLimits`
 * (internal; run after the event). `convex/crons.ts` is register-owned, so no
 * cron is registered from here.
 */
import { v } from "convex/values";
import type { GenericId } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../lib/dataModel";

export const QR_SCAN_ATTEMPT_LIMIT = 60;
export const QR_SCAN_ATTEMPT_WINDOW_MS = 60 * 1000;
export const QR_SCAN_FAILURE_LIMIT = 10;
export const QR_SCAN_FAILURE_WINDOW_MS = 5 * 60 * 1000;

export const QR_SCAN_PRUNE_PER_WRITE = 20;

const ATTEMPT_BUCKET_PREFIX = "volunteer_qr_scan_attempt:";
const FAILURE_BUCKET_PREFIX = "volunteer_qr_scan_failure:";

type AdminId = GenericId<"admins">;
type ScanBucket = { bucket: string; limit: number; windowMs: number };

function attemptBucket(volunteerId: AdminId): ScanBucket {
  return {
    bucket: `${ATTEMPT_BUCKET_PREFIX}${volunteerId}`,
    limit: QR_SCAN_ATTEMPT_LIMIT,
    windowMs: QR_SCAN_ATTEMPT_WINDOW_MS,
  };
}

function failureBucket(volunteerId: AdminId): ScanBucket {
  return {
    bucket: `${FAILURE_BUCKET_PREFIX}${volunteerId}`,
    limit: QR_SCAN_FAILURE_LIMIT,
    windowMs: QR_SCAN_FAILURE_WINDOW_MS,
  };
}

async function isOverLimit(ctx: MutationCtx, { bucket, limit, windowMs }: ScanBucket, now: number) {
  const recent = await ctx.db
    .query("rateLimits")
    .withIndex("by_bucket_createdAt", (q) =>
      q.eq("bucket", bucket).gte("createdAt", now - windowMs),
    )
    .take(limit);
  return recent.length >= limit;
}

async function recordRow(ctx: MutationCtx, { bucket, windowMs }: ScanBucket, now: number) {
  await ctx.db.insert("rateLimits", { bucket, key: bucket, createdAt: now });
  const expired = await ctx.db
    .query("rateLimits")
    .withIndex("by_bucket_createdAt", (q) =>
      q.eq("bucket", bucket).lt("createdAt", now - windowMs),
    )
    .take(QR_SCAN_PRUNE_PER_WRITE);
  for (const row of expired) {
    await ctx.db.delete(row._id);
  }
}

/** True when either bucket is full. Reads only; never writes. */
export async function isVolunteerScanThrottled(ctx: MutationCtx, volunteerId: AdminId, now: number) {
  return (
    await isOverLimit(ctx, failureBucket(volunteerId), now) ||
    await isOverLimit(ctx, attemptBucket(volunteerId), now)
  );
}

export async function recordVolunteerScanAttempt(ctx: MutationCtx, volunteerId: AdminId, now: number) {
  await recordRow(ctx, attemptBucket(volunteerId), now);
}

export async function recordVolunteerScanFailure(ctx: MutationCtx, volunteerId: AdminId, now: number) {
  await recordRow(ctx, failureBucket(volunteerId), now);
}

function isExpiredScanRow(row: { bucket: string; createdAt: number }, now: number) {
  if (row.bucket.startsWith(ATTEMPT_BUCKET_PREFIX)) {
    return row.createdAt < now - QR_SCAN_ATTEMPT_WINDOW_MS;
  }
  if (row.bucket.startsWith(FAILURE_BUCKET_PREFIX)) {
    return row.createdAt < now - QR_SCAN_FAILURE_WINDOW_MS;
  }
  return false;
}

/**
 * Deletes expired volunteer scan rows one page at a time. Other buckets are
 * never touched. Re-run with the returned cursor until `isDone`.
 * `npx convex run admin/volunteerScanRateLimit:pruneVolunteerScanRateLimits '{}'`
 */
export const pruneVolunteerScanRateLimits = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, batchSize }) => {
    const now = Date.now();
    const page = await ctx.db
      .query("rateLimits")
      .paginate({ cursor: cursor ?? null, numItems: Math.min(Math.max(batchSize ?? 200, 1), 500) });
    let deleted = 0;
    for (const row of page.page) {
      if (isExpiredScanRow(row, now)) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return { deleted, cursor: page.continueCursor, isDone: page.isDone };
  },
});
