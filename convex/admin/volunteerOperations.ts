/**
 * Volunteer scan operations: door check-in, food redemption, and event point
 * awards. See [VOLUNTEER_AUTHORIZATION.md](./VOLUNTEER_AUTHORIZATION.md).
 *
 * Each mutation re-runs the session, capability or assignment, QR, and
 * eligibility checks itself; a `resolveQrForScan` preview proves nothing.
 * Repeat scans are no-ops: they return the stored result and write no
 * participant, award, or log rows.
 *
 * Same throttle rules as the preview: session failures throw before any
 * write, and every outcome after the attempt row is returned, not thrown.
 * Event `startsAt` / `endsAt` are reference only and do not gate awards.
 */
import { v } from "convex/values";
import type { GenericId } from "convex/values";
import { mutation } from "../_generated/server";
import type { MutationCtx } from "../lib/dataModel";
import { applyEventAward, isParticipantEligible } from "./pointsLedger";
import { requireVolunteerAccess, sessionTokenArgs, volunteerCapabilities } from "./staffAuth";
import { findParticipantByQrToken, redeemMealForVolunteer } from "./volunteerScan";
import {
  isVolunteerScanThrottled,
  recordVolunteerScanAttempt,
  recordVolunteerScanFailure,
} from "./volunteerScanRateLimit";

type AdminDoc = Awaited<ReturnType<typeof requireVolunteerAccess>>;
type Scan = { volunteer: AdminDoc; now: number };

const scanArgs = { ...sessionTokenArgs, qrCodeToken: v.string() };
const RATE_LIMITED = { status: "rate_limited" as const };

/** Throttle check, then one attempt row. Null when throttled; nothing is written. */
async function beginScan(ctx: MutationCtx, volunteer: AdminDoc): Promise<Scan | null> {
  const now = Date.now();
  if (await isVolunteerScanThrottled(ctx, volunteer._id, now)) return null;
  await recordVolunteerScanAttempt(ctx, volunteer._id, now);
  return { volunteer, now };
}

/** Denials and unknown tokens count toward the failure limit. */
async function deny<S extends string>(ctx: MutationCtx, scan: Scan, status: S) {
  await recordVolunteerScanFailure(ctx, scan.volunteer._id, scan.now);
  return { status };
}

/** Participant behind an eligible QR token, or the failure result to return. */
async function eligibleParticipant(ctx: MutationCtx, scan: Scan, qrCodeToken: string) {
  const participant = await findParticipantByQrToken(ctx, qrCodeToken);
  if (!participant) return { failure: await deny(ctx, scan, "qr_not_found") };
  if (!await isParticipantEligible(ctx, participant)) {
    return { failure: { status: "participant_not_eligible" as const } };
  }
  return { participant };
}

async function logScan(
  ctx: MutationCtx,
  scan: Scan,
  participantId: GenericId<"participants">,
  action: "check_in" | "food_check_in",
) {
  await ctx.db.insert("volunteerActionLogs", {
    actorAdminId: scan.volunteer._id,
    participantId,
    action,
    createdAt: scan.now,
  });
}

/** Door check-in. Needs `canCheckIn === true`. A repeat returns the first timestamp. */
export const checkInParticipant = mutation({
  args: scanArgs,
  handler: async (ctx, { sessionToken, qrCodeToken }) => {
    const volunteer = await requireVolunteerAccess(ctx, sessionToken);
    const scan = await beginScan(ctx, volunteer);
    if (!scan) return RATE_LIMITED;
    if (!volunteerCapabilities(volunteer).canCheckIn) return deny(ctx, scan, "not_authorized");

    const found = await eligibleParticipant(ctx, scan, qrCodeToken);
    if ("failure" in found) return found.failure;
    const { participant } = found;
    if (participant.checkedInAt !== undefined) {
      return { status: "already_checked_in" as const, checkedInAt: participant.checkedInAt };
    }

    await ctx.db.patch(participant._id, { checkedInAt: scan.now, updatedAt: scan.now });
    await logScan(ctx, scan, participant._id, "check_in");
    return { status: "success" as const, checkedInAt: scan.now };
  },
});

/**
 * Compatibility entry point for food clients. A selected meal is required to
 * redeem; the legacy timestamp is never read or changed. New clients use redeemMeal.
 */
export const foodCheckInParticipant = mutation({
  args: { ...scanArgs, mealPeriodId: v.optional(v.id("mealPeriods")) },
  handler: async (ctx, { sessionToken, ...args }) => {
    const volunteer = await requireVolunteerAccess(ctx, sessionToken);
    return redeemMealForVolunteer(ctx, volunteer, args);
  },
});

/**
 * Awards an event's stored points once per participant. There is no points
 * argument. Missing and unassigned events both return `event_denied`, so
 * volunteers learn nothing about events outside their assignments. The
 * participant must already be door checked in.
 */
export const awardEventPoints = mutation({
  args: { ...scanArgs, eventId: v.id("events") },
  handler: async (ctx, { sessionToken, qrCodeToken, eventId }) => {
    const volunteer = await requireVolunteerAccess(ctx, sessionToken);
    const scan = await beginScan(ctx, volunteer);
    if (!scan) return RATE_LIMITED;

    const assignment = await ctx.db
      .query("volunteerEventAccess")
      .withIndex("by_volunteer_event", (q) =>
        q.eq("volunteerAdminId", volunteer._id).eq("eventId", eventId),
      )
      .unique();
    const event = assignment ? await ctx.db.get(eventId) : null;
    if (!event) return deny(ctx, scan, "event_denied");
    if (!event.active) return deny(ctx, scan, "event_inactive");

    const found = await eligibleParticipant(ctx, scan, qrCodeToken);
    if ("failure" in found) return found.failure;
    const { participant } = found;
    if (participant.checkedInAt === undefined) {
      return { status: "participant_not_checked_in" as const };
    }

    const award = await applyEventAward(ctx, {
      actorAdminId: volunteer._id,
      participant,
      event,
      now: scan.now,
    });
    if (award.status === "already_awarded") return award;
    return { status: "success" as const, pointsAwarded: award.pointsAwarded };
  },
});
