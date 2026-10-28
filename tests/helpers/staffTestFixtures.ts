import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { hashPassword } from "../../convex/admin/passwordHash";
import { hashSessionToken } from "../../convex/admin/staffAuth";
import {
  ADMIN_SIGN_IN_FAILURE_BUCKET,
  buildAdminSignInRateLimitKey,
} from "../../convex/admin/adminSignInRateLimit";
import type { ConvexTestInstance } from "./convexTestContext";

export const ORGANIZER_TEST_PASSWORD = "SecurePass1";

export type OrganizerSignInResult =
  | { ok: true; sessionToken: string; expiresAt: number }
  | {
      ok: false;
      code: "INVALID_CREDENTIALS" | "ACCOUNT_INACTIVE" | "SIGN_IN_RATE_LIMITED";
      error: string;
    };

const organizerSignInRef = makeFunctionReference<
  "mutation",
  { email: string; password: string; clientIp?: string },
  OrganizerSignInResult
>("admin/auth:signIn");

export async function mutateOrganizerSignIn(
  t: ConvexTestInstance,
  args: { email: string; password: string; clientIp?: string },
) {
  return t.mutation(organizerSignInRef, args);
}

/** Calls sign-in and throws with the server error when credentials are rejected. */
export async function signInOrganizer(
  t: ConvexTestInstance,
  email: string,
  password: string = ORGANIZER_TEST_PASSWORD,
) {
  const result = await mutateOrganizerSignIn(t, { email, password });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result;
}

export async function seedAdminSignInFailures(
  t: ConvexTestInstance,
  email: string,
  count: number,
  clientIp = "203.0.113.10",
  now = Date.now(),
) {
  const rateLimitKey = buildAdminSignInRateLimitKey(clientIp, email);
  if (!rateLimitKey) {
    throw new Error("Invalid email for sign-in rate-limit seed.");
  }
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i += 1) {
      await ctx.db.insert("rateLimits", {
        bucket: ADMIN_SIGN_IN_FAILURE_BUCKET,
        key: rateLimitKey,
        createdAt: now - i * 1000,
      });
    }
  });
}

export async function seedAdminAccount(
  t: ConvexTestInstance,
  fields: {
    email: string;
    role: "admin" | "volunteer";
    active: boolean;
    password?: string;
    name?: string;
  },
) {
  const adminId = await t.run((ctx) =>
    ctx.db.insert("admins", {
      email: fields.email,
      name: fields.name ?? "Test Organizer",
      role: fields.role,
      active: fields.active,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  const passwordHash = await hashPassword(fields.password ?? ORGANIZER_TEST_PASSWORD);
  await t.run((ctx) =>
    ctx.db.insert("adminAuthAccounts", {
      adminId,
      passwordHash,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  return adminId;
}

export async function seedSubmittedApplication(
  t: ConvexTestInstance,
  email = "applicant@example.com",
  applicationFields: Record<string, unknown> = {},
) {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { email, name: "Applicant" }),
  );
  const applicationId = await t.run((ctx) =>
    ctx.db.insert("applications", {
      authUserId: userId,
      email,
      createdAt: 1,
      formSubmitted: true,
      submittedAt: 2,
      ...applicationFields,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("applicationReviews", {
      applicationId,
      status: "under_review",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  return applicationId as GenericId<"applications">;
}

export async function insertStaffSession(
  t: ConvexTestInstance,
  fields: {
    adminId: GenericId<"admins">;
    sessionToken?: string;
    expiresAt?: number;
  },
) {
  const sessionToken = fields.sessionToken ?? "a".repeat(64);
  const sessionTokenHash = await hashSessionToken(sessionToken);
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("adminSessions", {
      adminId: fields.adminId,
      sessionTokenHash,
      createdAt: Date.now(),
      expiresAt: fields.expiresAt ?? Date.now() + 60_000,
    }),
  );
  return { sessionId, sessionToken };
}

/** Admin with a valid session and one submitted application + review row. */
export async function createStaffAuthorizationFixture(
  t: ConvexTestInstance,
  role: "admin" = "admin",
) {
  const adminId = await t.run((ctx) =>
    ctx.db.insert("admins", {
      email: "staff@hackuta.org",
      name: "Test Organizer",
      role,
      active: true,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  const { sessionId, sessionToken } = await insertStaffSession(t, { adminId });
  const applicationId = await seedSubmittedApplication(t);
  return { adminId, sessionId, sessionToken, applicationId };
}
