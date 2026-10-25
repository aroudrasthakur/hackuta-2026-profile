import { v, type GenericId } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx } from "../lib/dataModel";
import { isValidEmailSyntax, normalizeEmail } from "../lib/normalizeEmail";
import { adminError } from "../../shared/admin/errors";
import { validatePasswordRequirements } from "../../shared/auth/password";
import { requireEligibleParticipant } from "./pointsLedger";
import { newVolunteerFields, requireAdminRole, sessionTokenArgs, volunteerCapabilities } from "./staffAuth";
import { setStaffPassword } from "./staffCredentials";
import { invalidateAdminSessions } from "./sessionLifecycle";
import { buildStaffConfigDetails } from "../../shared/admin/volunteerRules";

const volunteerArgs = { ...sessionTokenArgs, volunteerAdminId: v.id("admins") };
const okResult = v.object({ ok: v.literal(true) });

async function requireVolunteerAccount(ctx: MutationCtx, adminId: GenericId<"admins">) {
  const volunteer = await ctx.db.get(adminId);
  if (!volunteer || volunteer.role !== "volunteer") throw adminError("VOLUNTEER_NOT_FOUND");
  return volunteer;
}

/** A new, distinct staff identity; existing staff accounts are never converted. */
export const createVolunteer = mutation({
  args: {
    ...sessionTokenArgs,
    email: v.string(),
    name: v.string(),
    password: v.string(),
    participantId: v.optional(v.id("participants")),
  },
  returns: v.object({ ok: v.literal(true), adminId: v.id("admins"), email: v.string() }),
  handler: async (ctx, { sessionToken, email, name, password, participantId }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !isValidEmailSyntax(normalizedEmail)) throw adminError("INVALID_EMAIL");
    const normalizedName = name.trim();
    if (!normalizedName) throw adminError("INVALID_STAFF_NAME");
    validatePasswordRequirements(password);
    const existing = await ctx.db.query("admins")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail)).first();
    if (existing) throw adminError("STAFF_ACCOUNT_EXISTS");
    if (participantId) {
      await requireEligibleParticipant(ctx, participantId);
      const linked = await ctx.db.query("admins")
        .withIndex("by_participant", (q) => q.eq("participantId", participantId)).first();
      if (linked) throw adminError("STAFF_ACCOUNT_EXISTS");
    }
    const now = Date.now();
    const adminId = await ctx.db.insert("admins", {
      email: normalizedEmail, name: normalizedName, active: true,
      ...newVolunteerFields(),
      ...(participantId ? { participantId } : {}),
      createdAt: now, updatedAt: now,
    });
    await setStaffPassword(ctx, adminId, password);
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id, action: "volunteer_created", targetAdminId: adminId,
      ...(participantId ? { targetParticipantId: participantId } : {}),
      createdAt: now,
    });
    return { ok: true as const, adminId, email: normalizedEmail };
  },
});

/** Only administrators can enumerate volunteer staff; credentials are never returned. */
export const listVolunteers = query({
  args: sessionTokenArgs,
  handler: async (ctx, { sessionToken }) => {
    await requireAdminRole(ctx, sessionToken);
    const volunteers = await ctx.db.query("admins")
      .withIndex("by_role", (q) => q.eq("role", "volunteer")).collect();
    return volunteers.map((volunteer) => ({
      adminId: volunteer._id, email: volunteer.email, name: volunteer.name,
      active: volunteer.active, participantId: volunteer.participantId,
      ...volunteerCapabilities(volunteer),
    }));
  },
});

export const resetVolunteerPassword = mutation({
  args: { ...volunteerArgs, password: v.string() },
  returns: okResult,
  handler: async (ctx, { sessionToken, volunteerAdminId, password }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    await requireVolunteerAccount(ctx, volunteerAdminId);
    await setStaffPassword(ctx, volunteerAdminId, password);
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id, action: "volunteer_password_reset",
      targetAdminId: volunteerAdminId, createdAt: Date.now(),
    });
    return { ok: true as const };
  },
});

function volunteerActiveMutation(active: boolean) {
  return mutation({
    args: volunteerArgs,
    returns: okResult,
    handler: async (ctx, { sessionToken, volunteerAdminId }) => {
      const actor = await requireAdminRole(ctx, sessionToken);
      await requireVolunteerAccount(ctx, volunteerAdminId);
      await ctx.db.patch(volunteerAdminId, { active, updatedAt: Date.now() });
      // Clear sessions on both paths: restoration can never resurrect an old login.
      await invalidateAdminSessions(ctx, volunteerAdminId);
      await ctx.db.insert("staffConfigLogs", {
        actorAdminId: actor._id, action: active ? "volunteer_restored" : "volunteer_revoked",
        targetAdminId: volunteerAdminId, createdAt: Date.now(),
      });
      return { ok: true as const };
    },
  });
}

export const revokeVolunteer = volunteerActiveMutation(false);
export const restoreVolunteer = volunteerActiveMutation(true);

export const updateVolunteerCapabilities = mutation({
  args: { ...volunteerArgs, canCheckIn: v.boolean(), canFoodCheckIn: v.boolean() },
  returns: okResult,
  handler: async (ctx, { sessionToken, volunteerAdminId, canCheckIn, canFoodCheckIn }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    await requireVolunteerAccount(ctx, volunteerAdminId);
    await ctx.db.patch(volunteerAdminId, { canCheckIn, canFoodCheckIn, updatedAt: Date.now() });
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id, action: "volunteer_capabilities_updated", targetAdminId: volunteerAdminId,
      details: buildStaffConfigDetails({ canCheckIn, canFoodCheckIn }), createdAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/**
 * Grants or revokes event assignment rows. Assignment existence is the permission.
 *
 * Invariant: revoking (`granted: false`) deletes rows immediately; the volunteer
 * loses access on the next scan because `requireVolunteerEventAccess` re-queries
 * the index every time (no cached grants in sessions).
 */
export const setVolunteerEventAccess = mutation({
  args: { ...volunteerArgs, eventId: v.id("events"), granted: v.boolean() },
  returns: okResult,
  handler: async (ctx, { sessionToken, volunteerAdminId, eventId, granted }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const volunteer = await requireVolunteerAccount(ctx, volunteerAdminId);
    if (granted && !volunteer.active) throw adminError("ACCOUNT_INACTIVE");
    if (!await ctx.db.get(eventId)) throw adminError("EVENT_NOT_FOUND");
    const assignments = await ctx.db.query("volunteerEventAccess")
      .withIndex("by_volunteer_event", (q) => q.eq("volunteerAdminId", volunteerAdminId).eq("eventId", eventId))
      .collect();
    if (granted && assignments.length === 0) {
      await ctx.db.insert("volunteerEventAccess", {
        volunteerAdminId, eventId, grantedBy: actor._id, createdAt: Date.now(),
      });
    } else if (!granted) {
      for (const assignment of assignments) await ctx.db.delete(assignment._id);
    }
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id, action: "volunteer_event_access_updated",
      targetAdminId: volunteerAdminId, targetEventId: eventId,
      details: buildStaffConfigDetails({ eventIds: granted ? [eventId] : [] }), createdAt: Date.now(),
    });
    return { ok: true as const };
  },
});
