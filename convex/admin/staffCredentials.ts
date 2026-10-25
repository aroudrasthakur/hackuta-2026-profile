import type { GenericId } from "convex/values";
import type { MutationCtx } from "../lib/dataModel";
import { validatePasswordRequirements } from "../../shared/auth/password";
import { hashPassword } from "./passwordHash";
import { invalidateAdminSessions } from "./sessionLifecycle";

/** Shared credential write. Never returns credentials; every change signs out old sessions. */
export async function setStaffPassword(
  ctx: MutationCtx,
  adminId: GenericId<"admins">,
  password: string,
) {
  validatePasswordRequirements(password);
  const passwordHash = await hashPassword(password);
  const now = Date.now();
  const account = await ctx.db.query("adminAuthAccounts")
    .withIndex("by_admin", (q) => q.eq("adminId", adminId)).unique();
  if (account) {
    await ctx.db.patch(account._id, { passwordHash, updatedAt: now });
  } else {
    await ctx.db.insert("adminAuthAccounts", {
      adminId, passwordHash, createdAt: now, updatedAt: now,
    });
  }
  await invalidateAdminSessions(ctx, adminId);
}
