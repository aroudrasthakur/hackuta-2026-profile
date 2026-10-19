import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import type { MutationCtx } from "./lib/dataModel";
import { MAX_RESUME_BYTES } from "../shared/registration/resume";
import { requireAuthUser } from "./lib/auth";
import { findApplicationByResume } from "./lib/applications";
import { RESUME_UPLOAD_BUCKET } from "./lib/rateLimitBuckets";
import { RESUME_UPLOAD_EXPIRY_MS } from "./lib/resumeUpload";

const RESUME_UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const MAX_RESUME_UPLOADS_PER_WINDOW = 5;
const MAX_GLOBAL_RESUME_UPLOADS_PER_WINDOW = 100;
const CLEANUP_PAGE_SIZE = 100;

const cleanupExpiredUploadSessionsRef = makeFunctionReference<"mutation">(
  "resumeUploads:cleanupExpiredUploadSessions",
);

async function countRecentUploadAttempts(
  ctx: MutationCtx,
  key: string,
  windowStart: number,
) {
  return ctx.db
    .query("rateLimits")
    .withIndex("by_bucket_createdAt", (q) => q.eq("bucket", RESUME_UPLOAD_BUCKET))
    .filter((q) =>
      q.and(
        q.eq(q.field("key"), key),
        q.gte(q.field("createdAt"), windowStart),
      ),
    )
    .collect();
}

export const assertUploadRateLimit = internalMutation({
  args: {
    requestKey: v.string(),
    authUserId: v.id("users"),
  },
  handler: async (ctx: MutationCtx, { requestKey, authUserId }) => {
    const now = Date.now();
    const windowStart = now - RESUME_UPLOAD_WINDOW_MS;
    const userRateKey = `user:${authUserId}`;
    const [recentClientRequests, recentUserRequests, recentGlobalRequests] =
      await Promise.all([
        countRecentUploadAttempts(ctx, requestKey, windowStart),
        countRecentUploadAttempts(ctx, userRateKey, windowStart),
        ctx.db
          .query("rateLimits")
          .withIndex("by_bucket_createdAt", (q) => q.eq("bucket", RESUME_UPLOAD_BUCKET))
          .filter((q) => q.gte(q.field("createdAt"), windowStart))
          .take(MAX_GLOBAL_RESUME_UPLOADS_PER_WINDOW),
      ]);

    if (
      recentClientRequests.length >= MAX_RESUME_UPLOADS_PER_WINDOW ||
      recentUserRequests.length >= MAX_RESUME_UPLOADS_PER_WINDOW ||
      recentGlobalRequests.length >= MAX_GLOBAL_RESUME_UPLOADS_PER_WINDOW
    ) {
      throw new Error("Too many resume upload attempts. Please wait a few minutes and try again.");
    }

    await ctx.db.insert("rateLimits", {
      bucket: RESUME_UPLOAD_BUCKET,
      key: requestKey,
      createdAt: now,
    });
    await ctx.db.insert("rateLimits", {
      bucket: RESUME_UPLOAD_BUCKET,
      key: userRateKey,
      createdAt: now,
    });
  },
});

export const createVerifiedUploadSession = internalMutation({
  args: {
    uploadToken: v.string(),
    storageId: v.id("_storage"),
    authUserId: v.id("users"),
  },
  handler: async (ctx: MutationCtx, { uploadToken, storageId, authUserId }) => {
    const [existingToken, metadata] = await Promise.all([
      ctx.db
        .query("resumeUploadSessions")
        .withIndex("by_token", (q) => q.eq("token", uploadToken))
        .first(),
      ctx.db.system.get("_storage", storageId),
    ]);
    if (
      existingToken ||
      !metadata ||
      metadata.size === 0 ||
      metadata.size > MAX_RESUME_BYTES
    ) {
      throw new Error("Invalid resume upload.");
    }
    const now = Date.now();
    await ctx.db.insert("resumeUploadSessions", {
      token: uploadToken,
      authUserId,
      storageId,
      createdAt: now,
      verifiedAt: now,
    });
    await ctx.scheduler.runAfter(RESUME_UPLOAD_EXPIRY_MS, cleanupExpiredUploadSessionsRef, {});
  },
});

export const discardUploadSession = mutation({
  args: { uploadToken: v.string() },
  handler: async (ctx: MutationCtx, { uploadToken }) => {
    const authUser = await requireAuthUser(ctx);
    const session = await ctx.db
      .query("resumeUploadSessions")
      .withIndex("by_token", (q) => q.eq("token", uploadToken))
      .first();
    if (!session || session.consumedAt || session.authUserId !== authUser._id) {
      return { ok: true as const };
    }

    if (session.storageId) {
      const attachment = await findApplicationByResume(ctx, session.storageId);
      if (!attachment) await ctx.storage.delete(session.storageId);
    }
    await ctx.db.delete(session._id);
    return { ok: true as const };
  },
});

export const cleanupExpiredUploadSessions = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const cutoff = Date.now() - RESUME_UPLOAD_EXPIRY_MS;
    const expiredSessions = await ctx.db
      .query("resumeUploadSessions")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(CLEANUP_PAGE_SIZE);
    for (const session of expiredSessions) {
      if (session.storageId) {
        const attachment = await findApplicationByResume(ctx, session.storageId);
        if (!attachment) await ctx.storage.delete(session.storageId);
      }
      await ctx.db.delete(session._id);
    }

    const expiredRateLimits = await ctx.db
      .query("rateLimits")
      .withIndex("by_bucket_createdAt", (q) => q.eq("bucket", RESUME_UPLOAD_BUCKET))
      .filter((q) => q.lt(q.field("createdAt"), cutoff))
      .take(CLEANUP_PAGE_SIZE);
    for (const entry of expiredRateLimits) {
      await ctx.db.delete(entry._id);
    }

    if (
      expiredSessions.length === CLEANUP_PAGE_SIZE ||
      expiredRateLimits.length === CLEANUP_PAGE_SIZE
    ) {
      await ctx.scheduler.runAfter(0, cleanupExpiredUploadSessionsRef, {});
    }
  },
});
