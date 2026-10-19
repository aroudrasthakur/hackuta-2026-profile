import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";

/** Wide ctx type — full schema auth tables break GenericDataModel in CI/deploy tsc. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional wide db for auth session cleanup
type MutationCtx = GenericMutationCtx<any>;

/** Remove every session and refresh token for the given auth user. */
export async function invalidateAllSessionsForUser(
  ctx: MutationCtx,
  userId: GenericId<"users">,
) {
  const sessions = await ctx.db
    .query("authSessions")
    .filter((q) => q.eq(q.field("userId"), userId))
    .collect();

  for (const session of sessions) {
    const refreshTokens = await ctx.db
      .query("authRefreshTokens")
      .filter((q) => q.eq(q.field("sessionId"), session._id))
      .collect();

    for (const token of refreshTokens) {
      await ctx.db.delete(token._id);
    }

    await ctx.db.delete(session._id);
  }
}
