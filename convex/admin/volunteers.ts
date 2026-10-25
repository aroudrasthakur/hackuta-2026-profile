/**
 * Administrator-only volunteer management: accounts, participant promotion,
 * capabilities, event assignments, and the volunteer / staff audit logs.
 *
 * Every export calls `requireAdminRole` before reading or writing. Volunteers
 * and reviewers are denied, so nobody can change their own permissions,
 * assignments, or credentials here. See
 * [VOLUNTEER_AUTHORIZATION.md](./VOLUNTEER_AUTHORIZATION.md).
 *
 * Applicant `users` / `authAccounts` rows are never created or modified:
 * volunteers always get a separate `admins` identity with its own credentials.
 */
import { paginationOptsValidator } from "convex/server";
import { v, type GenericId } from "convex/values";
import { mutation, query } from "../_generated/server";
import { formatApplicantFullName } from "../lib/applications";
import type { MutationCtx, QueryCtx } from "../lib/dataModel";
import { isValidEmailSyntax, normalizeEmail } from "../lib/normalizeEmail";
import { adminError } from "../../shared/admin/errors";
import { buildStaffConfigDetails } from "../../shared/admin/volunteerRules";
import { validatePasswordRequirements } from "../../shared/auth/password";
import { staffConfigLogAction, volunteerActionLogAction } from "./fields";
import { requireEligibleParticipant } from "./pointsLedger";
import { invalidateAdminSessions } from "./sessionLifecycle";
import { newVolunteerFields, requireAdminRole, sessionTokenArgs, volunteerCapabilities } from "./staffAuth";
import { setStaffPassword } from "./staffCredentials";

/** Matches the `staffConfigLogs.details` id-list limit. */
export const MAX_VOLUNTEER_EVENTS = 50;

const UNNAMED_PARTICIPANT = "Participant";
const UNKNOWN_STAFF = "Unknown staff";
const UNKNOWN_EVENT = "Unknown event";

type AdminId = GenericId<"admins">;
type EventId = GenericId<"events">;
type ParticipantId = GenericId<"participants">;
type Ctx = QueryCtx | MutationCtx;

const volunteerArgs = { ...sessionTokenArgs, volunteerAdminId: v.id("admins") };
const okResult = v.object({ ok: v.literal(true) });
const createdResult = v.object({ ok: v.literal(true), adminId: v.id("admins"), email: v.string() });
const capabilityArgs = {
  canCheckIn: v.optional(v.boolean()),
  canFoodCheckIn: v.optional(v.boolean()),
};
const dateRangeArgs = { from: v.optional(v.number()), to: v.optional(v.number()) };

async function requireVolunteerAccount(ctx: MutationCtx, adminId: AdminId) {
  const volunteer = await ctx.db.get(adminId);
  if (!volunteer || volunteer.role !== "volunteer") throw adminError("VOLUNTEER_NOT_FOUND");
  return volunteer;
}

function requireStaffName(name: string | null | undefined) {
  const trimmed = name?.trim();
  if (!trimmed) throw adminError("INVALID_STAFF_NAME");
  return trimmed;
}

/** Same normalization as staff sign-in. Any existing staff row (any role, active or not) blocks reuse. */
async function requireAvailableStaffEmail(ctx: MutationCtx, email: string | null | undefined) {
  const normalized = normalizeEmail(email ?? "");
  if (!normalized || !isValidEmailSyntax(normalized)) throw adminError("INVALID_EMAIL");
  const existing = await ctx.db.query("admins")
    .withIndex("by_email", (q) => q.eq("email", normalized)).first();
  if (existing) throw adminError("STAFF_ACCOUNT_EXISTS");
  return normalized;
}

async function insertVolunteer(
  ctx: MutationCtx,
  actorAdminId: AdminId,
  fields: {
    email: string;
    name: string;
    password: string;
    canCheckIn?: boolean;
    canFoodCheckIn?: boolean;
    participantId?: ParticipantId;
  },
) {
  const now = Date.now();
  const capabilities = {
    canCheckIn: fields.canCheckIn === true,
    canFoodCheckIn: fields.canFoodCheckIn === true,
  };
  const adminId = await ctx.db.insert("admins", {
    email: fields.email,
    name: fields.name,
    active: true,
    ...newVolunteerFields(),
    ...capabilities,
    ...(fields.participantId ? { participantId: fields.participantId } : {}),
    createdAt: now,
    updatedAt: now,
  });
  await setStaffPassword(ctx, adminId, fields.password);
  await ctx.db.insert("staffConfigLogs", {
    actorAdminId,
    action: "volunteer_created",
    targetAdminId: adminId,
    ...(fields.participantId ? { targetParticipantId: fields.participantId } : {}),
    details: buildStaffConfigDetails({ after: { ...capabilities, active: true } }),
    createdAt: now,
  });
  return { ok: true as const, adminId, email: fields.email };
}

/** Standalone volunteer (not a registered participant). Role is always `volunteer`. */
export const createVolunteer = mutation({
  args: {
    ...sessionTokenArgs,
    email: v.string(),
    name: v.string(),
    password: v.string(),
    ...capabilityArgs,
  },
  returns: createdResult,
  handler: async (ctx, { sessionToken, email, name, password, canCheckIn, canFoodCheckIn }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const normalizedName = requireStaffName(name);
    validatePasswordRequirements(password);
    const normalizedEmail = await requireAvailableStaffEmail(ctx, email);
    return insertVolunteer(ctx, actor._id, {
      email: normalizedEmail, name: normalizedName, password, canCheckIn, canFoodCheckIn,
    });
  },
});

/**
 * Creates a **separate** volunteer staff account linked to an accepted
 * participant. Email and name default to the registration values. The
 * participant row, QR token, points, application, and applicant account are
 * left untouched, and existing staff accounts are never converted.
 */
export const promoteParticipantToVolunteer = mutation({
  args: {
    ...sessionTokenArgs,
    participantId: v.id("participants"),
    password: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    ...capabilityArgs,
  },
  returns: createdResult,
  handler: async (ctx, { sessionToken, participantId, password, ...fields }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const participant = await requireEligibleParticipant(ctx, participantId);
    const linked = await ctx.db.query("admins")
      .withIndex("by_participant", (q) => q.eq("participantId", participantId)).first();
    if (linked) throw adminError("STAFF_ACCOUNT_EXISTS");
    const application = await ctx.db.get(participant.applicationId);
    const registrationEmail = application?.email ?? (await ctx.db.get(participant.authUserId))?.email;
    const name = requireStaffName(fields.name ?? (application && formatApplicantFullName(application)));
    validatePasswordRequirements(password);
    const email = await requireAvailableStaffEmail(ctx, fields.email ?? registrationEmail);
    return insertVolunteer(ctx, actor._id, {
      email, name, password, participantId,
      canCheckIn: fields.canCheckIn, canFoodCheckIn: fields.canFoodCheckIn,
    });
  },
});

/** Per-request name lookups shared by the list endpoints. */
function nameLookups(ctx: Ctx) {
  const staff = new Map<string, string>();
  const events = new Map<string, string>();
  const participants = new Map<string, string>();
  return {
    async staffName(adminId: AdminId) {
      if (!staff.has(adminId)) staff.set(adminId, (await ctx.db.get(adminId))?.name ?? UNKNOWN_STAFF);
      return staff.get(adminId)!;
    },
    async eventName(eventId: EventId) {
      if (!events.has(eventId)) events.set(eventId, (await ctx.db.get(eventId))?.name ?? UNKNOWN_EVENT);
      return events.get(eventId)!;
    },
    async participantName(participantId: ParticipantId) {
      if (!participants.has(participantId)) {
        const participant = await ctx.db.get(participantId);
        const application = participant ? await ctx.db.get(participant.applicationId) : null;
        participants.set(participantId, (application && formatApplicantFullName(application)) ?? UNNAMED_PARTICIPANT);
      }
      return participants.get(participantId)!;
    },
  };
}

/** Paginated volunteer roster. Never returns credentials, sessions, QR tokens, or points. */
export const listVolunteers = query({
  args: { ...sessionTokenArgs, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { sessionToken, paginationOpts }) => {
    await requireAdminRole(ctx, sessionToken);
    const result = await ctx.db.query("admins")
      .withIndex("by_role", (q) => q.eq("role", "volunteer"))
      .paginate(paginationOpts);
    const names = nameLookups(ctx);
    const page = [];
    for (const volunteer of result.page) {
      const assignments = await ctx.db.query("volunteerEventAccess")
        .withIndex("by_volunteer", (q) => q.eq("volunteerAdminId", volunteer._id)).collect();
      const events = [];
      for (const eventId of new Set(assignments.map((row) => row.eventId))) {
        const event = await ctx.db.get(eventId);
        if (event) events.push({ eventId, name: event.name, active: event.active });
      }
      page.push({
        adminId: volunteer._id,
        name: volunteer.name,
        email: volunteer.email,
        active: volunteer.active,
        participant: volunteer.participantId
          ? { participantId: volunteer.participantId, name: await names.participantName(volunteer.participantId) }
          : null,
        ...volunteerCapabilities(volunteer),
        events,
        createdAt: volunteer.createdAt,
        updatedAt: volunteer.updatedAt,
      });
    }
    return { ...result, page };
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

/**
 * Revoke and restore both delete every session, so a restored volunteer must
 * sign in again. Assignments, capabilities, and history are kept.
 */
function volunteerActiveMutation(active: boolean) {
  return mutation({
    args: volunteerArgs,
    returns: okResult,
    handler: async (ctx, { sessionToken, volunteerAdminId }) => {
      const actor = await requireAdminRole(ctx, sessionToken);
      const volunteer = await requireVolunteerAccount(ctx, volunteerAdminId);
      const now = Date.now();
      await ctx.db.patch(volunteerAdminId, { active, updatedAt: now });
      await invalidateAdminSessions(ctx, volunteerAdminId);
      await ctx.db.insert("staffConfigLogs", {
        actorAdminId: actor._id, action: active ? "volunteer_restored" : "volunteer_revoked",
        targetAdminId: volunteerAdminId,
        details: buildStaffConfigDetails({ before: { active: volunteer.active }, after: { active } }),
        createdAt: now,
      });
      return { ok: true as const };
    },
  });
}

export const revokeVolunteer = volunteerActiveMutation(false);
export const restoreVolunteer = volunteerActiveMutation(true);

/** Sets both capabilities explicitly. Guards re-read them on every request, so changes apply immediately. */
export const setVolunteerCapabilities = mutation({
  args: { ...volunteerArgs, canCheckIn: v.boolean(), canFoodCheckIn: v.boolean() },
  returns: v.object({ ok: v.literal(true), changed: v.boolean() }),
  handler: async (ctx, { sessionToken, volunteerAdminId, canCheckIn, canFoodCheckIn }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const volunteer = await requireVolunteerAccount(ctx, volunteerAdminId);
    const before = volunteerCapabilities(volunteer);
    const after = { canCheckIn, canFoodCheckIn };
    const changedFields = (Object.keys(after) as Array<keyof typeof after>)
      .filter((key) => before[key] !== after[key]);
    if (changedFields.length === 0) return { ok: true as const, changed: false };
    const now = Date.now();
    await ctx.db.patch(volunteerAdminId, { ...after, updatedAt: now });
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id, action: "volunteer_capabilities_updated", targetAdminId: volunteerAdminId,
      details: buildStaffConfigDetails({ changedFields, before, after }), createdAt: now,
    });
    return { ok: true as const, changed: true };
  },
});

/**
 * Replaces the volunteer's assigned events with `eventIds`. The whole input is
 * validated before any row changes. Unchanged assignments keep their row;
 * duplicate rows for one event are collapsed. Removal takes effect on the
 * volunteer's next request (guards re-query assignments every time).
 */
export const setVolunteerEventAccess = mutation({
  args: { ...volunteerArgs, eventIds: v.array(v.id("events")) },
  returns: v.object({ ok: v.literal(true), added: v.number(), removed: v.number() }),
  handler: async (ctx, { sessionToken, volunteerAdminId, eventIds }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const volunteer = await requireVolunteerAccount(ctx, volunteerAdminId);
    const desired = new Set<EventId>(eventIds);
    if (desired.size !== eventIds.length || eventIds.length > MAX_VOLUNTEER_EVENTS) {
      throw adminError("INVALID_EVENT_ASSIGNMENT");
    }
    for (const eventId of desired) {
      if (!await ctx.db.get(eventId)) throw adminError("EVENT_NOT_FOUND");
    }

    const current = await ctx.db.query("volunteerEventAccess")
      .withIndex("by_volunteer", (q) => q.eq("volunteerAdminId", volunteerAdminId)).collect();
    const kept = new Set<EventId>();
    const rowsToDelete = [];
    const removedEventIds = new Set<EventId>();
    for (const row of current) {
      if (desired.has(row.eventId) && !kept.has(row.eventId)) {
        kept.add(row.eventId);
      } else {
        rowsToDelete.push(row._id);
        if (!desired.has(row.eventId)) removedEventIds.add(row.eventId);
      }
    }
    const addedEventIds = eventIds.filter((eventId) => !kept.has(eventId));
    if (addedEventIds.length > 0 && !volunteer.active) throw adminError("ACCOUNT_INACTIVE");

    const now = Date.now();
    for (const rowId of rowsToDelete) await ctx.db.delete(rowId);
    for (const eventId of addedEventIds) {
      await ctx.db.insert("volunteerEventAccess", {
        volunteerAdminId, eventId, grantedBy: actor._id, createdAt: now,
      });
    }
    if (addedEventIds.length > 0 || removedEventIds.size > 0) {
      await ctx.db.insert("staffConfigLogs", {
        actorAdminId: actor._id, action: "volunteer_event_access_updated", targetAdminId: volunteerAdminId,
        details: buildStaffConfigDetails({
          eventIds, addedEventIds, removedEventIds: [...removedEventIds],
        }),
        createdAt: now,
      });
    }
    return { ok: true as const, added: addedEventIds.length, removed: removedEventIds.size };
  },
});

function createdAtBounds(from?: number, to?: number) {
  const lower = from ?? 0;
  const upper = to ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
    throw adminError("INVALID_LOG_FILTER");
  }
  return { lower, upper };
}

/**
 * Volunteer scan and point-adjustment history, newest first. The most
 * selective filter picks the index; the rest are applied to that range.
 */
export const listVolunteerActionLogs = query({
  args: {
    ...sessionTokenArgs,
    paginationOpts: paginationOptsValidator,
    volunteerAdminId: v.optional(v.id("admins")),
    action: v.optional(volunteerActionLogAction),
    participantId: v.optional(v.id("participants")),
    eventId: v.optional(v.id("events")),
    ...dateRangeArgs,
  },
  handler: async (ctx, { sessionToken, paginationOpts, from, to, ...filters }) => {
    await requireAdminRole(ctx, sessionToken);
    const { lower, upper } = createdAtBounds(from, to);
    const table = ctx.db.query("volunteerActionLogs");
    const { participantId, volunteerAdminId, eventId, action } = filters;
    const indexed = participantId
      ? table.withIndex("by_participant_createdAt", (q) =>
        q.eq("participantId", participantId).gte("createdAt", lower).lte("createdAt", upper))
      : volunteerAdminId
        ? table.withIndex("by_actor_createdAt", (q) =>
          q.eq("actorAdminId", volunteerAdminId).gte("createdAt", lower).lte("createdAt", upper))
        : eventId
          ? table.withIndex("by_event_createdAt", (q) =>
            q.eq("eventId", eventId).gte("createdAt", lower).lte("createdAt", upper))
          : action
            ? table.withIndex("by_action_createdAt", (q) =>
              q.eq("action", action).gte("createdAt", lower).lte("createdAt", upper))
            : table.withIndex("by_createdAt", (q) => q.gte("createdAt", lower).lte("createdAt", upper));
    const result = await indexed
      .filter((q) => q.and(
        volunteerAdminId ? q.eq(q.field("actorAdminId"), volunteerAdminId) : true,
        eventId ? q.eq(q.field("eventId"), eventId) : true,
        action ? q.eq(q.field("action"), action) : true,
      ))
      .order("desc")
      .paginate(paginationOpts);

    const names = nameLookups(ctx);
    const page = [];
    for (const log of result.page) {
      page.push({
        logId: log._id,
        actor: { adminId: log.actorAdminId, name: await names.staffName(log.actorAdminId) },
        action: log.action,
        participant: { participantId: log.participantId, name: await names.participantName(log.participantId) },
        event: log.eventId ? { eventId: log.eventId, name: await names.eventName(log.eventId) } : null,
        pointsDelta: log.pointsDelta ?? null,
        reason: log.action === "admin_adjust" ? (log.reason ?? null) : null,
        createdAt: log.createdAt,
      });
    }
    return { ...result, page };
  },
});

function parseDetails(details: string | undefined): Record<string, unknown> | null {
  if (!details) return null;
  try {
    return JSON.parse(details) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Staff and event configuration audit, newest first. Administrators only. */
export const listStaffConfigLogs = query({
  args: {
    ...sessionTokenArgs,
    paginationOpts: paginationOptsValidator,
    targetAdminId: v.optional(v.id("admins")),
    action: v.optional(staffConfigLogAction),
    ...dateRangeArgs,
  },
  handler: async (ctx, { sessionToken, paginationOpts, targetAdminId, action, from, to }) => {
    await requireAdminRole(ctx, sessionToken);
    const { lower, upper } = createdAtBounds(from, to);
    const table = ctx.db.query("staffConfigLogs");
    const indexed = targetAdminId
      ? table.withIndex("by_target_admin_createdAt", (q) =>
        q.eq("targetAdminId", targetAdminId).gte("createdAt", lower).lte("createdAt", upper))
      : table.withIndex("by_createdAt", (q) => q.gte("createdAt", lower).lte("createdAt", upper));
    const result = await indexed
      .filter((q) => (action ? q.eq(q.field("action"), action) : true))
      .order("desc")
      .paginate(paginationOpts);

    const names = nameLookups(ctx);
    const page = [];
    for (const log of result.page) {
      page.push({
        logId: log._id,
        actor: { adminId: log.actorAdminId, name: await names.staffName(log.actorAdminId) },
        action: log.action,
        target: log.targetAdminId
          ? { adminId: log.targetAdminId, name: await names.staffName(log.targetAdminId) }
          : null,
        event: log.targetEventId
          ? { eventId: log.targetEventId, name: await names.eventName(log.targetEventId) }
          : null,
        participant: log.targetParticipantId
          ? { participantId: log.targetParticipantId, name: await names.participantName(log.targetParticipantId) }
          : null,
        details: parseDetails(log.details),
        createdAt: log.createdAt,
      });
    }
    return { ...result, page };
  },
});
