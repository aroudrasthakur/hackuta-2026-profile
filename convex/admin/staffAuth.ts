/**
 * Staff session resolution and role guards.
 *
 * **Authorization contract:** [VOLUNTEER_AUTHORIZATION.md](./VOLUNTEER_AUTHORIZATION.md)
 *
 * UI route redirects are not security. Every public Convex handler that touches
 * participant, event, or point data must call the appropriate guard here first.
 */
import { v, type GenericId } from "convex/values";
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

export type VolunteerCapability = "canCheckIn" | "canFoodCheckIn";

/**
 * Missing capability flags are denied. Only an explicit `true` grants the scan.
 */
export function volunteerCapabilities(admin: {
  canCheckIn?: boolean;
  canFoodCheckIn?: boolean;
}) {
  return {
    canCheckIn: admin.canCheckIn === true,
    canFoodCheckIn: admin.canFoodCheckIn === true,
  };
}

/** Fields for a newly appointed volunteer. Both scans start denied. */
export function newVolunteerFields() {
  return {
    role: "volunteer" as const,
    canCheckIn: false,
    canFoodCheckIn: false,
  };
}

/** Active volunteer session. Reviewers and admins are rejected. */
export async function requireVolunteerAccess(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string,
) {
  const admin = await getCurrentAdmin(ctx, sessionToken);
  if (!admin) {
    throw adminError("NOT_AUTHENTICATED");
  }
  if (admin.role !== "volunteer") {
    throw adminError("VOLUNTEER_ONLY");
  }
  return admin;
}

/** Volunteer session plus an explicit capability grant. */
export async function requireVolunteerCapability(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string,
  capability: VolunteerCapability,
) {
  const admin = await requireVolunteerAccess(ctx, sessionToken);
  if (!volunteerCapabilities(admin)[capability]) {
    throw adminError("CAPABILITY_DENIED");
  }
  return admin;
}

/**
 * Checks the volunteer's **current** assignment and an active event immediately
 * before a point-scan (or similar) operation.
 *
 * Invariant: deleting `volunteerEventAccess` takes effect on the next request;
 * there is no session cache of assignments. Schedule fields on `events` are not
 * checked here (reference only).
 */
export async function requireVolunteerEventAccess(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string,
  eventId: GenericId<"events">,
) {
  const volunteer = await requireVolunteerAccess(ctx, sessionToken);
  const assignment = await ctx.db
    .query("volunteerEventAccess")
    .withIndex("by_volunteer_event", (q) =>
      q.eq("volunteerAdminId", volunteer._id).eq("eventId", eventId),
    )
    .unique();
  if (!assignment) {
    throw adminError("EVENT_ACCESS_DENIED");
  }
  const event = await ctx.db.get(eventId);
  if (!event) {
    throw adminError("EVENT_NOT_FOUND");
  }
  if (!event.active) {
    throw adminError("EVENT_INACTIVE");
  }
  return { volunteer, event };
}
