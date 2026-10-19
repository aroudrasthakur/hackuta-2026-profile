import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./lib/dataModel";

type ResettableTable =
  | "applications"
  | "applicationReviews"
  | "resumeUploadSessions"
  | "rateLimits"
  | "authRefreshTokens"
  | "authVerificationCodes"
  | "authVerifiers"
  | "authSessions"
  | "authAccounts"
  | "authRateLimits"
  | "users";

const CLEANUP_PAGE_SIZE = 100;

async function deleteAllFromTable(ctx: MutationCtx, table: ResettableTable) {
  let deleted = CLEANUP_PAGE_SIZE;
  while (deleted === CLEANUP_PAGE_SIZE) {
    const rows = await ctx.db.query(table).take(CLEANUP_PAGE_SIZE);
    deleted = rows.length;
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  }
}

async function deleteAllStorage(ctx: MutationCtx) {
  let deleted = CLEANUP_PAGE_SIZE;
  while (deleted === CLEANUP_PAGE_SIZE) {
    const files = await ctx.db.system
      .query("_storage")
      .take(CLEANUP_PAGE_SIZE);
    deleted = files.length;
    for (const file of files) {
      await ctx.storage.delete(file._id);
    }
  }
}

/**
 * Wipes all application and auth data from the deployment.
 * Run from Convex dashboard (internal) or: npx convex run maintenance:resetAllData --prod
 */
export const resetAllData = internalMutation({
  args: {},
  handler: async (ctx) => {
    await deleteAllStorage(ctx);

    await deleteAllFromTable(ctx, "applicationReviews");
    await deleteAllFromTable(ctx, "applications");
    await deleteAllFromTable(ctx, "resumeUploadSessions");
    await deleteAllFromTable(ctx, "rateLimits");

    await deleteAllFromTable(ctx, "authRefreshTokens");
    await deleteAllFromTable(ctx, "authVerificationCodes");
    await deleteAllFromTable(ctx, "authVerifiers");
    await deleteAllFromTable(ctx, "authSessions");
    await deleteAllFromTable(ctx, "authAccounts");
    await deleteAllFromTable(ctx, "authRateLimits");
    await deleteAllFromTable(ctx, "users");

    return { ok: true as const };
  },
});
