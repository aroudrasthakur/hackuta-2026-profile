import type { GenericId } from "convex/values";
import type { MutationCtx } from "../lib/dataModel";
import {
  ADMIN_SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
} from "./staffAuth";

/** Removes every active session row for an organizer account. */
export async function invalidateAdminSessions(
  ctx: MutationCtx,
  adminId: GenericId<"admins">,
) {
  const sessions = await ctx.db
    .query("adminSessions")
    .withIndex("by_admin", (q) => q.eq("adminId", adminId))
    .collect();
  for (const session of sessions) {
    await ctx.db.delete(session._id);
  }
}

/** Creates a fresh session after clearing any existing sessions for the admin. */
export async function createAdminSession(
  ctx: MutationCtx,
  adminId: GenericId<"admins">,
) {
  await invalidateAdminSessions(ctx, adminId);

  const sessionToken = generateSessionToken();
  const sessionTokenHash = await hashSessionToken(sessionToken);
  const now = Date.now();
  const expiresAt = now + ADMIN_SESSION_TTL_MS;

  await ctx.db.insert("adminSessions", {
    adminId,
    sessionTokenHash,
    expiresAt,
    createdAt: now,
  });

  return { sessionToken, expiresAt };
}
