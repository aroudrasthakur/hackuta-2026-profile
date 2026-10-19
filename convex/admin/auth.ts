import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import {
  ADMIN_SIGN_IN_CLIENT_IP_MAX_LENGTH,
  buildAdminSignInRateLimitKey,
  clearAdminSignInFailures,
  isAdminSignInRateLimited,
  normalizeRateLimitClientIp,
  recordFailedAdminSignIn,
} from "./adminSignInRateLimit";
import { normalizeEmail } from "../lib/normalizeEmail";
import { ADMIN_ERROR_MESSAGES, adminError } from "../../shared/admin/errors";
import { validatePasswordRequirements } from "../../shared/auth/password";
import { hashPassword, verifyPassword } from "./passwordHash";
import { ADMIN_SIGN_IN_DUMMY_PASSWORD_HASH } from "./signInSecurityConstants";
import { createAdminSession, invalidateAdminSessions } from "./sessionLifecycle";
import { hashSessionToken, requireAdminRole, resolveAdminSession, sessionTokenArgs } from "./staffAuth";

type SignInFailureCode = "INVALID_CREDENTIALS" | "ACCOUNT_INACTIVE" | "SIGN_IN_RATE_LIMITED";

function signInFailure(code: SignInFailureCode) {
  return { ok: false as const, code, error: ADMIN_ERROR_MESSAGES[code] };
}

const signInResult = v.union(
  v.object({
    ok: v.literal(true),
    sessionToken: v.string(),
    expiresAt: v.number(),
  }),
  v.object({
    ok: v.literal(false),
    code: v.union(
      v.literal("INVALID_CREDENTIALS"),
      v.literal("ACCOUNT_INACTIVE"),
      v.literal("SIGN_IN_RATE_LIMITED"),
    ),
    error: v.string(),
  }),
);

/** Email + password sign-in for provisioned organizer accounts only. */
export const signIn = mutation({
  args: {
    email: v.string(),
    password: v.string(),
    clientIp: v.optional(v.string()),
  },
  returns: signInResult,
  handler: async (ctx, { email, password, clientIp }) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
      return signInFailure("INVALID_CREDENTIALS");
    }

    if (clientIp !== undefined && clientIp.length > ADMIN_SIGN_IN_CLIENT_IP_MAX_LENGTH) {
      return signInFailure("INVALID_CREDENTIALS");
    }

    const rateLimitKey = buildAdminSignInRateLimitKey(
      clientIp === undefined ? undefined : normalizeRateLimitClientIp(clientIp),
      normalizedEmail,
    );
    if (!rateLimitKey) {
      return signInFailure("INVALID_CREDENTIALS");
    }

    if (await isAdminSignInRateLimited(ctx, rateLimitKey)) {
      return signInFailure("SIGN_IN_RATE_LIMITED");
    }

    const admin = await ctx.db
      .query("admins")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .unique();

    const authAccount = admin
      ? await ctx.db
          .query("adminAuthAccounts")
          .withIndex("by_admin", (q) => q.eq("adminId", admin._id))
          .unique()
      : null;

    const valid = await verifyPassword(
      authAccount?.passwordHash ?? ADMIN_SIGN_IN_DUMMY_PASSWORD_HASH,
      password,
    );

    if (!admin || !authAccount || !valid) {
      await recordFailedAdminSignIn(ctx, rateLimitKey);
      return signInFailure("INVALID_CREDENTIALS");
    }

    if (!admin.active) {
      return signInFailure("ACCOUNT_INACTIVE");
    }

    await clearAdminSignInFailures(ctx, rateLimitKey);
    const session = await createAdminSession(ctx, admin._id);
    return {
      ok: true as const,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
    };
  },
});

/** Invalidates the current organizer session. */
export const signOut = mutation({
  args: sessionTokenArgs,
  handler: async (ctx, { sessionToken }) => {
    const sessionTokenHash = await hashSessionToken(sessionToken);
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token_hash", (q) => q.eq("sessionTokenHash", sessionTokenHash))
      .unique();
    if (session) {
      await ctx.db.delete(session._id);
    }
    return { ok: true as const };
  },
});

/** Returns staff profile from a valid session; role always comes from `admins`. */
export const getCurrentStaff = query({
  args: sessionTokenArgs,
  handler: async (ctx, { sessionToken }) => {
    const resolved = await resolveAdminSession(ctx, sessionToken);
    if (!resolved) {
      return null;
    }
    const { admin, session } = resolved;
    return {
      adminId: admin._id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      expiresAt: session.expiresAt,
    };
  },
});

/** Developer provisioning — sets password hash and clears existing sessions. */
export const provisionAdminAuthAccount = internalMutation({
  args: {
    adminId: v.id("admins"),
    password: v.string(),
  },
  handler: async (ctx, { adminId, password }) => {
    validatePasswordRequirements(password);

    const admin = await ctx.db.get(adminId);
    if (!admin) {
      throw new Error("Admin not found.");
    }

    const passwordHash = await hashPassword(password);
    const now = Date.now();
    const existing = await ctx.db
      .query("adminAuthAccounts")
      .withIndex("by_admin", (q) => q.eq("adminId", adminId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { passwordHash, updatedAt: now });
    } else {
      await ctx.db.insert("adminAuthAccounts", {
        adminId,
        passwordHash,
        createdAt: now,
        updatedAt: now,
      });
    }

    await invalidateAdminSessions(ctx, adminId);
    return { ok: true as const };
  },
});

/** Organizer provisioning — creates or updates an admin row and sets credentials. Restricted to existing admins. */
export const createAndProvisionAdmin = mutation({
  args: {
    ...sessionTokenArgs,
    email: v.string(),
    name: v.string(),
    role: v.union(v.literal("reviewer"), v.literal("admin")),
    password: v.string(),
  },
  handler: async (ctx, { sessionToken, email, name, role, password }) => {
    await requireAdminRole(ctx, sessionToken);

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      throw adminError("INVALID_EMAIL");
    }
    validatePasswordRequirements(password);

    const now = Date.now();
    const existingAdmin = await ctx.db
      .query("admins")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .unique();

    const profile = { name, role, active: true, updatedAt: now };
    const adminId =
      existingAdmin?._id ??
      (await ctx.db.insert("admins", {
        ...profile,
        email: normalizedEmail,
        createdAt: now,
      }));
    if (existingAdmin) {
      await ctx.db.patch(adminId, profile);
    }

    const passwordHash = await hashPassword(password);
    const existingAccount = await ctx.db
      .query("adminAuthAccounts")
      .withIndex("by_admin", (q) => q.eq("adminId", adminId))
      .unique();

    if (existingAccount) {
      await ctx.db.patch(existingAccount._id, { passwordHash, updatedAt: now });
    } else {
      await ctx.db.insert("adminAuthAccounts", {
        adminId,
        passwordHash,
        createdAt: now,
        updatedAt: now,
      });
    }

    await invalidateAdminSessions(ctx, adminId);
    return { adminId, email: normalizedEmail, ok: true as const };
  },
});
