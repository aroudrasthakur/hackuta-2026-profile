import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericId } from "convex/values";
import { normalizeEmail } from "./normalizeEmail";
import type { AuthUserDoc, MutationCtx, QueryCtx } from "./dataModel";

export type AuthCtx = QueryCtx | MutationCtx;

export async function requireAuthUserId(ctx: {
  auth: AuthCtx["auth"];
}): Promise<GenericId<"users">> {
  const authUserId = await getAuthUserId(ctx as AuthCtx);
  if (!authUserId) {
    throw new Error("Authentication required.");
  }
  return authUserId;
}

export async function getAuthUser(ctx: AuthCtx): Promise<AuthUserDoc | null> {
  const authUserId = await getAuthUserId(ctx);
  if (authUserId) {
    const authUser = await ctx.db.get(authUserId);
    if (authUser) return authUser;
  }

  const identity = await ctx.auth.getUserIdentity();
  const email = normalizeEmail(identity?.email);
  if (!email) return null;

  return ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .first();
}

export async function requireAuthUser(ctx: AuthCtx): Promise<AuthUserDoc> {
  const user = await getAuthUser(ctx);
  if (!user) {
    throw new Error("Authentication required.");
  }
  return user;
}

export async function requireVerifiedAuthUser(ctx: AuthCtx): Promise<AuthUserDoc> {
  const user = await requireAuthUser(ctx);
  if (!user.emailVerificationTime) {
    throw new Error("Verify your email before submitting your application.");
  }
  return user;
}

export async function requireAuthIdentity(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required.");
  }
  return identity;
}
