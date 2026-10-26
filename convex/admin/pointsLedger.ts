/**
 * Participant points ledger — **internal helpers only** (not Convex entry points).
 *
 * These functions trust their caller for authorization. They do **not** replace
 * `requireVolunteerAccess`, `requireVolunteerCapability`, or
 * `requireVolunteerEventAccess`. See [VOLUNTEER_AUTHORIZATION.md](./VOLUNTEER_AUTHORIZATION.md).
 */
import type { DocumentByName } from "convex/server";
import type { GenericId } from "convex/values";
import type { DataModel, MutationCtx, QueryCtx } from "../lib/dataModel";
import { adminError } from "../../shared/admin/errors";
import {
  assertAdjustmentDelta,
  assertPointBalance,
  normalizeAdjustmentReason,
} from "../../shared/admin/volunteerRules";

type ParticipantId = GenericId<"participants">;
type EventId = GenericId<"events">;
type AdminId = GenericId<"admins">;
type ParticipantDoc = DocumentByName<DataModel, "participants">;
type EventDoc = DocumentByName<DataModel, "events">;

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
 * Eligibility comes from the linked application review, not from the
 * participant row existing. A missing review row is not eligible.
 */
export async function isParticipantEligible(
  ctx: QueryCtx | MutationCtx,
  participant: { applicationId: GenericId<"applications"> },
) {
  const review = await ctx.db
    .query("applicationReviews")
    .withIndex("by_application", (q) => q.eq("applicationId", participant.applicationId))
    .unique();
  return review?.status === "accepted";
}

/** Throwing variant for callers whose failures should roll back the transaction. */
export async function requireEligibleParticipant(ctx: MutationCtx, participantId: ParticipantId) {
  const participant = await ctx.db.get(participantId);
  if (!participant) {
    throw adminError("PARTICIPANT_NOT_FOUND");
  }
  if (!await isParticipantEligible(ctx, participant)) {
    throw adminError("PARTICIPANT_NOT_ELIGIBLE");
  }
  return participant;
}

/**
 * Awards an event's fixed points once. **Not an auth boundary.**
 *
 * Does not verify session, volunteer role, capability, or event assignment.
 * Public scan mutations must call `requireVolunteerEventAccess` (and capability
 * guards) first, then pass `actorAdminId` from the guard result.
 *
 * `startsAt` / `endsAt` are reference only. Award row, balance, and log are
 * written in the caller's mutation transaction.
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
  const result = await applyEventAward(ctx, {
    actorAdminId: args.actorAdminId,
    participant,
    event,
    now: args.now,
  });
  if (result.status === "already_awarded") {
    throw adminError("POINTS_ALREADY_AWARDED");
  }
  const { previousPoints, newPoints, pointsAwarded } = result;
  return { previousPoints, newPoints, pointsAwarded };
}

/**
 * Award core for a participant and event the caller has already loaded and
 * checked. **Not an auth boundary.** Returns `already_awarded` instead of
 * throwing so scan mutations keep their rate-limit rows.
 *
 * The amount always comes from the stored event. The award lookup and all
 * writes run in the caller's transaction: if two scans race, Convex retries
 * the loser, which then sees the first award and returns `already_awarded`.
 * The `by_participant_event` index does not enforce uniqueness by itself.
 */
export async function applyEventAward(
  ctx: MutationCtx,
  args: {
    actorAdminId: AdminId;
    participant: ParticipantDoc;
    event: EventDoc;
    now: number;
  },
) {
  const { participant, event } = args;
  if (!Number.isSafeInteger(event.pointsAwarded) || event.pointsAwarded <= 0) {
    throw adminError("INVALID_EVENT");
  }

  const existing = await ctx.db
    .query("participantEventAwards")
    .withIndex("by_participant_event", (q) =>
      q.eq("participantId", participant._id).eq("eventId", event._id),
    )
    .first();
  if (existing) {
    return { status: "already_awarded" as const };
  }

  // Balance is optional until backfill; fall back to the ledger, not zero.
  const previousPoints = assertPointBalance(
    participant.points ?? await computeLedgerPoints(ctx, participant._id),
  );
  const pointsAwarded = event.pointsAwarded;
  const newPoints = assertPointBalance(previousPoints + pointsAwarded);

  await ctx.db.insert("participantEventAwards", {
    participantId: participant._id,
    eventId: event._id,
    pointsAwarded,
    awardedBy: args.actorAdminId,
    awardedAt: args.now,
  });
  await ctx.db.patch(participant._id, {
    points: newPoints,
    updatedAt: args.now,
  });
  await ctx.db.insert("volunteerActionLogs", {
    actorAdminId: args.actorAdminId,
    participantId: participant._id,
    action: "point_scan",
    eventId: event._id,
    pointsDelta: pointsAwarded,
    previousPoints,
    newPoints,
    createdAt: args.now,
  });

  return { status: "success" as const, previousPoints, newPoints, pointsAwarded };
}

/**
 * Call before any write that changes `events.pointsAwarded`. Once one award
 * exists the value is locked, so every participant gets the same amount.
 * Past award rows keep their own `pointsAwarded` either way; corrections go
 * through `adjustPoints`. Unchanged values always pass.
 */
export async function assertEventPointsEditable(
  ctx: MutationCtx,
  eventId: EventId,
  pointsAwarded: number,
) {
  const event = await ctx.db.get(eventId);
  if (!event) {
    throw adminError("EVENT_NOT_FOUND");
  }
  if (event.pointsAwarded === pointsAwarded) {
    return;
  }
  const award = await ctx.db
    .query("participantEventAwards")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .first();
  if (award) {
    throw adminError("EVENT_POINTS_LOCKED");
  }
}

/**
 * Signed point adjustment. **Not a session auth boundary** — only checks that
 * `actorAdminId` refers to an active admin row. Public mutations must call
 * `requireAdminRole` first and pass that admin's id.
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
