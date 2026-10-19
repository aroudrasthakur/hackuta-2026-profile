import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../lib/dataModel";
import { sha256Hex } from "../lib/sha256Hex";
import { adminError } from "../../shared/admin/errors";

/** Organizer session lifetime (24 hours). */
export const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export const sessionTokenArgs = {
  sessionToken: v.string(),
};

export function generateSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashSessionToken(sessionToken: string) {
  return sha256Hex(sessionToken);
}

export async function resolveAdminSession(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string,
) {
  if (!sessionToken || sessionToken.length < 32) {
    return null;
  }

  const sessionTokenHash = await hashSessionToken(sessionToken);
  const session = await ctx.db
    .query("adminSessions")
    .withIndex("by_token_hash", (q) => q.eq("sessionTokenHash", sessionTokenHash))
    .unique();
  if (!session || session.expiresAt <= Date.now()) {
    return null;
  }

  const admin = await ctx.db.get(session.adminId);
  if (!admin?.active) {
    return null;
  }

  return { admin, session };
}

/** Resolves only internal staff sessions; applicant authentication is never used. */
export async function getCurrentAdmin(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string,
) {
  const resolved = await resolveAdminSession(ctx, sessionToken);
  return resolved?.admin ?? null;
}

/** Both active reviewers and admins can review applications and make decisions. */
export async function requireReviewerAccess(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string,
) {
  const admin = await getCurrentAdmin(ctx, sessionToken);
  if (!admin) {
    throw adminError("NOT_AUTHENTICATED");
  }
  if (admin.role !== "reviewer" && admin.role !== "admin") {
    throw adminError("NOT_AUTHORIZED");
  }
  return admin;
}

/** Historical review logs and other admin-only operations require the admin role. */
export async function requireAdminRole(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string,
) {
  const admin = await requireReviewerAccess(ctx, sessionToken);
  if (admin.role !== "admin") {
    throw adminError("ADMIN_ONLY");
  }
  return admin;
}
