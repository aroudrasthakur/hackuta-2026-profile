import type { GenericId } from "convex/values";
import type { MutationCtx, QueryCtx } from "../lib/dataModel";
import { adminError } from "../../shared/admin/errors";
import {
  assertAdjustmentDelta,
  assertPointBalance,
  isWithinEventWindow,
  normalizeAdjustmentReason,
} from "../../shared/admin/volunteerRules";

type ParticipantId = GenericId<"participants">;
type EventId = GenericId<"events">;
type AdminId = GenericId<"admins">;

async function requireStoredEvent(ctx: MutationCtx, eventId: EventId) {
  const event = await ctx.db.get(eventId);
  if (!event) {
    throw adminError("EVENT_NOT_FOUND");
  }
  if (!event.active) {
    throw adminError("EVENT_INACTIVE");
  }
  return event;
}

/**
 * Accepted participants only. A missing review row is not eligible.
 */
export async function requireEligibleParticipant(ctx: MutationCtx, participantId: ParticipantId) {
  const participant = await ctx.db.get(participantId);
  if (!participant) {
    throw adminError("PARTICIPANT_NOT_FOUND");
  }

  const review = await ctx.db
    .query("applicationReviews")
    .withIndex("by_application", (q) => q.eq("applicationId", participant.applicationId))
    .unique();
  if (review?.status !== "accepted") {
    throw adminError("PARTICIPANT_NOT_ELIGIBLE");
  }
  return participant;
}

/**
 * Awards an event's fixed points once. The caller does not choose the amount.
 * Award row, cached balance, and audit log are written in the caller's mutation.
 */
export async function awardEventPoints(
  ctx: MutationCtx,
  args: {
    actorAdminId: AdminId;
    participantId: ParticipantId;
    eventId: EventId;
    now: number;
  },
) {
  const participant = await requireEligibleParticipant(ctx, args.participantId);
  const event = await requireStoredEvent(ctx, args.eventId);
  if (!isWithinEventWindow(event, args.now)) {
    throw adminError("EVENT_OUTSIDE_WINDOW");
  }
  if (!Number.isSafeInteger(event.pointsAwarded) || event.pointsAwarded <= 0) {
    throw adminError("INVALID_EVENT");
  }

  const existing = await ctx.db
    .query("participantEventAwards")
    .withIndex("by_participant_event", (q) =>
      q.eq("participantId", args.participantId).eq("eventId", args.eventId),
    )
    .first();
  if (existing) {
    throw adminError("POINTS_ALREADY_AWARDED");
  }

  const previousPoints = assertPointBalance(participant.points ?? 0);
  const pointsAwarded = event.pointsAwarded;
  const newPoints = assertPointBalance(previousPoints + pointsAwarded);

  await ctx.db.insert("participantEventAwards", {
    participantId: args.participantId,
    eventId: args.eventId,
    pointsAwarded,
    awardedBy: args.actorAdminId,
    awardedAt: args.now,
  });
  await ctx.db.patch(args.participantId, {
    points: newPoints,
    updatedAt: args.now,
  });
  await ctx.db.insert("volunteerActionLogs", {
    actorAdminId: args.actorAdminId,
    participantId: args.participantId,
    action: "point_scan",
    eventId: args.eventId,
    pointsDelta: pointsAwarded,
    previousPoints,
    newPoints,
    createdAt: args.now,
  });

  return { previousPoints, newPoints, pointsAwarded };
}

/**
 * Admin-only signed adjustment. Rejects a balance that would drop below zero.
 * The adjustment log is the ledger entry; awards are not rewritten.
 */
export async function adjustPoints(
  ctx: MutationCtx,
  args: {
    actorAdminId: AdminId;
    participantId: ParticipantId;
    delta: number;
    reason: string;
  },
) {
  const actor = await ctx.db.get(args.actorAdminId);
  if (!actor?.active || actor.role !== "admin") {
    throw adminError("ADMIN_ONLY");
  }

  const participant = await ctx.db.get(args.participantId);
  if (!participant) {
    throw adminError("PARTICIPANT_NOT_FOUND");
  }

  const delta = assertAdjustmentDelta(args.delta);
  const reason = normalizeAdjustmentReason(args.reason);
  const previousPoints = assertPointBalance(participant.points ?? 0);
  const newPoints = assertPointBalance(previousPoints + delta);
  const now = Date.now();

  await ctx.db.patch(args.participantId, {
    points: newPoints,
    updatedAt: now,
  });
  await ctx.db.insert("volunteerActionLogs", {
    actorAdminId: args.actorAdminId,
    participantId: args.participantId,
    action: "admin_adjust",
    pointsDelta: delta,
    previousPoints,
    newPoints,
    reason,
    createdAt: now,
  });

  return { previousPoints, newPoints, pointsDelta: delta };
}

/**
 * Awards plus signed `admin_adjust` deltas. `point_scan` logs are not added again.
 */
export async function computeLedgerPoints(ctx: QueryCtx | MutationCtx, participantId: ParticipantId) {
  const awards = await ctx.db
    .query("participantEventAwards")
    .withIndex("by_participant_event", (q) => q.eq("participantId", participantId))
    .collect();
  const logs = await ctx.db
    .query("volunteerActionLogs")
    .withIndex("by_participant", (q) => q.eq("participantId", participantId))
    .collect();

  let total = 0;
  for (const award of awards) {
    if (!Number.isSafeInteger(award.pointsAwarded)) {
      throw adminError("INVALID_POINTS");
    }
    total += award.pointsAwarded;
  }
  for (const log of logs) {
    if (log.action !== "admin_adjust" || log.pointsDelta === undefined) {
      continue;
    }
    if (!Number.isSafeInteger(log.pointsDelta)) {
      throw adminError("INVALID_POINTS");
    }
    total += log.pointsDelta;
  }
  return assertPointBalance(total);
}
