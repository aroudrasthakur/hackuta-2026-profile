/**
 * Administrator-only participant roster, point corrections, adjustment history,
 * and participant-to-volunteer promotion. Every export calls
 * `requireAdminRole` first; volunteers get `NOT_AUTHORIZED`.
 * See [VOLUNTEER_AUTHORIZATION.md](./VOLUNTEER_AUTHORIZATION.md).
 *
 * Accounting invariant: `participants.points` = sum of `participantEventAwards`
 * + sum of `admin_adjust`, `shop_purchase`, and `shop_refund` deltas. Manual corrections only append an
 * `admin_adjust` log; event awards are never deleted or changed here, so event
 * uniqueness and award values stay intact. QR tokens are never returned.
 */
import { paginationOptsValidator } from "convex/server";
import { v, type GenericId } from "convex/values";
import { mutation, query } from "../_generated/server";
import { formatApplicantFullName } from "../lib/applications";
import type { QueryCtx } from "../lib/dataModel";
import { adminError } from "../../shared/admin/errors";
import { assertPointBalance, normalizeAdjustmentReason } from "../../shared/admin/volunteerRules";
import { createdAtBounds, nameLookups, UNNAMED_PARTICIPANT } from "./adminQueryHelpers";
import {
  adjustPoints,
  computeLedgerPoints,
  isParticipantEligible,
  requireEligibleParticipant,
} from "./pointsLedger";
import { requireAdminRole, sessionTokenArgs, volunteerCapabilities } from "./staffAuth";
import { promoteParticipant } from "./volunteerProvisioning";

/** Participants scanned per `listParticipants` call; bounds reads regardless of filters. */
export const MAX_PARTICIPANT_PAGE_SIZE = 100;
export const MAX_PARTICIPANT_SEARCH_LENGTH = 100;

type ParticipantId = GenericId<"participants">;

const volunteerStatusFilter = v.union(
  v.literal("none"),
  v.literal("linked"),
  v.literal("active"),
  v.literal("inactive"),
);

function normalizeSearch(search: string | undefined) {
  const trimmed = search?.trim().toLowerCase() ?? "";
  if (trimmed.length > MAX_PARTICIPANT_SEARCH_LENGTH) throw adminError("INVALID_PARTICIPANT_FILTER");
  return trimmed;
}

async function participantIdentity(
  ctx: QueryCtx,
  participant: { applicationId: GenericId<"applications">; authUserId: GenericId<"users"> },
) {
  const application = await ctx.db.get(participant.applicationId);
  const email = application?.email ?? (await ctx.db.get(participant.authUserId))?.email ?? null;
  return {
    name: (application && formatApplicantFullName(application)) ?? UNNAMED_PARTICIPANT,
    email,
  };
}

function linkedVolunteer(ctx: QueryCtx, participantId: ParticipantId) {
  return ctx.db.query("admins")
    .withIndex("by_participant", (q) => q.eq("participantId", participantId))
    .first();
}

/**
 * Accepted-participant roster in creation order (stable). Each call reads at
 * most `MAX_PARTICIPANT_PAGE_SIZE` participants and filters that slice, so a
 * filtered page can be shorter than requested (or empty) while `isDone` is
 * false; keep paging with `continueCursor`. Rows whose application review is
 * not `accepted` are never included.
 */
export const listParticipants = query({
  args: {
    ...sessionTokenArgs,
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    checkedIn: v.optional(v.boolean()),
    foodRedeemed: v.optional(v.boolean()),
    volunteerStatus: v.optional(volunteerStatusFilter),
  },
  handler: async (ctx, { sessionToken, paginationOpts, search, checkedIn, foodRedeemed, volunteerStatus }) => {
    await requireAdminRole(ctx, sessionToken);
    const term = normalizeSearch(search);
    const numItems = Math.min(Math.max(Math.floor(paginationOpts.numItems), 1), MAX_PARTICIPANT_PAGE_SIZE);
    const result = await ctx.db.query("participants").order("asc").paginate({ ...paginationOpts, numItems });

    const page = [];
    for (const participant of result.page) {
      if (checkedIn !== undefined && (participant.checkedInAt !== undefined) !== checkedIn) continue;
      if (foodRedeemed !== undefined && (participant.foodCheckedInAt !== undefined) !== foodRedeemed) continue;
      if (!await isParticipantEligible(ctx, participant)) continue;
      const { name, email } = await participantIdentity(ctx, participant);
      if (term && !name.toLowerCase().includes(term) && !(email ?? "").toLowerCase().includes(term)) continue;
      const volunteer = await linkedVolunteer(ctx, participant._id);
      if (volunteerStatus === "none" && volunteer) continue;
      if (volunteerStatus === "linked" && !volunteer) continue;
      if (volunteerStatus === "active" && !volunteer?.active) continue;
      if (volunteerStatus === "inactive" && (!volunteer || volunteer.active)) continue;
      page.push({
        participantId: participant._id,
        name,
        email,
        points: participant.points ?? 0,
        checkedInAt: participant.checkedInAt ?? null,
        foodCheckedInAt: participant.foodCheckedInAt ?? null,
        badgeAssigned: participant.badgeQrCodeToken !== undefined,
        volunteer: volunteer ? { adminId: volunteer._id, active: volunteer.active } : null,
      });
    }
    return { page, continueCursor: result.continueCursor, isDone: result.isDone, scanned: result.page.length };
  },
});

/**
 * One accepted participant with event awards, a ledger cross-check, and who
 * assigned their badge and when. Returns null for missing or non-accepted
 * participants. No QR or badge value.
 */
export const getParticipantDetails = query({
  args: { ...sessionTokenArgs, participantId: v.id("participants") },
  handler: async (ctx, { sessionToken, participantId }) => {
    await requireAdminRole(ctx, sessionToken);
    const participant = await ctx.db.get(participantId);
    if (!participant || !await isParticipantEligible(ctx, participant)) return null;
    const { name, email } = await participantIdentity(ctx, participant);
    const names = nameLookups(ctx);
    const awardRows = await ctx.db.query("participantEventAwards")
      .withIndex("by_participant_event", (q) => q.eq("participantId", participantId))
      .collect();
    const awards = [];
    for (const award of awardRows) {
      awards.push({
        eventId: award.eventId,
        eventName: await names.eventName(award.eventId),
        pointsAwarded: award.pointsAwarded,
        awardedAt: award.awardedAt,
        awardedBy: { adminId: award.awardedBy, name: await names.staffName(award.awardedBy) },
      });
    }
    awards.sort((a, b) => a.awardedAt - b.awardedAt);
    const volunteer = await linkedVolunteer(ctx, participantId);
    const points = participant.points ?? 0;
    const ledgerPoints = await computeLedgerPoints(ctx, participantId);
    return {
      participantId,
      name,
      email,
      acceptedAt: participant.acceptedAt,
      points,
      ledgerPoints,
      pointsConsistent: points === ledgerPoints,
      checkedInAt: participant.checkedInAt ?? null,
      foodCheckedInAt: participant.foodCheckedInAt ?? null,
      badge: participant.badgeQrCodeToken !== undefined && participant.badgeAssignedAt !== undefined
        ? {
          assignedAt: participant.badgeAssignedAt,
          assignedBy: participant.badgeAssignedBy
            ? { adminId: participant.badgeAssignedBy, name: await names.staffName(participant.badgeAssignedBy) }
            : null,
        }
        : null,
      awards,
      volunteer: volunteer
        ? {
          adminId: volunteer._id,
          name: volunteer.name,
          email: volunteer.email,
          active: volunteer.active,
          ...volunteerCapabilities(volunteer),
        }
        : null,
    };
  },
});

/**
 * Sets an accepted participant's balance to `points`. The previous balance and
 * delta are computed server-side in the same transaction as the balance patch
 * and the immutable `admin_adjust` log, so concurrent corrections serialize
 * and each log chains from the last committed balance. Event awards are not
 * touched. Setting the current balance is a no-op and writes no log.
 */
export const setParticipantPoints = mutation({
  args: {
    ...sessionTokenArgs,
    participantId: v.id("participants"),
    points: v.number(),
    reason: v.string(),
  },
  returns: v.object({
    ok: v.literal(true),
    changed: v.boolean(),
    previousPoints: v.number(),
    newPoints: v.number(),
    pointsDelta: v.number(),
  }),
  handler: async (ctx, { sessionToken, participantId, points, reason }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const target = assertPointBalance(points);
    const normalizedReason = normalizeAdjustmentReason(reason);
    const participant = await requireEligibleParticipant(ctx, participantId);
    const previousPoints = assertPointBalance(participant.points ?? 0);
    const pointsDelta = target - previousPoints;
    if (pointsDelta === 0) {
      return { ok: true as const, changed: false, previousPoints, newPoints: target, pointsDelta };
    }
    const result = await adjustPoints(ctx, {
      actorAdminId: actor._id, participantId, delta: pointsDelta, reason: normalizedReason,
    });
    return { ok: true as const, changed: true, ...result };
  },
});

/** Admin point-correction history, newest first, filterable by participant, admin, and date range. */
export const listPointAdjustments = query({
  args: {
    ...sessionTokenArgs,
    paginationOpts: paginationOptsValidator,
    participantId: v.optional(v.id("participants")),
    actorAdminId: v.optional(v.id("admins")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, { sessionToken, paginationOpts, participantId, actorAdminId, from, to }) => {
    await requireAdminRole(ctx, sessionToken);
    const { lower, upper } = createdAtBounds(from, to);
    const table = ctx.db.query("volunteerActionLogs");
    const indexed = participantId
      ? table
        .withIndex("by_participant_createdAt", (q) =>
          q.eq("participantId", participantId).gte("createdAt", lower).lte("createdAt", upper))
        .filter((q) => q.eq(q.field("action"), "admin_adjust"))
      : table.withIndex("by_action_createdAt", (q) =>
        q.eq("action", "admin_adjust").gte("createdAt", lower).lte("createdAt", upper));
    const filtered = actorAdminId
      ? indexed.filter((q) => q.eq(q.field("actorAdminId"), actorAdminId))
      : indexed;
    const result = await filtered.order("desc").paginate(paginationOpts);

    const names = nameLookups(ctx);
    const page = [];
    for (const log of result.page) {
      page.push({
        logId: log._id,
        createdAt: log.createdAt,
        admin: { adminId: log.actorAdminId, name: await names.staffName(log.actorAdminId) },
        participant: { participantId: log.participantId, name: await names.participantName(log.participantId) },
        previousPoints: log.previousPoints ?? null,
        newPoints: log.newPoints ?? null,
        pointsDelta: log.pointsDelta ?? null,
        reason: log.reason ?? null,
      });
    }
    return { ...result, page };
  },
});

/**
 * Promotes an accepted participant to a separate volunteer staff account via
 * the shared provisioning helper (same validation, hashing, and audit as
 * standalone volunteers). Capabilities default to denied.
 */
export const promoteParticipantToVolunteer = mutation({
  args: {
    ...sessionTokenArgs,
    participantId: v.id("participants"),
    password: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    canCheckIn: v.optional(v.boolean()),
    canFoodCheckIn: v.optional(v.boolean()),
  },
  returns: v.object({ ok: v.literal(true), adminId: v.id("admins"), email: v.string() }),
  handler: async (ctx, { sessionToken, ...args }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    return promoteParticipant(ctx, actor._id, args);
  },
});
