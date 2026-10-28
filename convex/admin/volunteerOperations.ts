/**
 * Volunteer scan operations after check-in: food redemption and event point
 * awards. Door check-in lives in `badgeCheckIn.ts`. See
 * [VOLUNTEER_AUTHORIZATION.md](./VOLUNTEER_AUTHORIZATION.md).
 *
 * Each mutation re-runs the session, capability or assignment, QR, and
 * eligibility checks itself; a `resolveQrForScan` preview proves nothing.
 * Only an assigned badge QR resolves a participant. Repeat scans are no-ops:
 * they return the stored result and write no participant, award, or log rows.
 *
 * Same throttle rules as the preview: session failures throw before any
 * write, and every outcome after the attempt row is returned, not thrown.
 * Point awards need a switched-on event; schedule times are reference only.
 */
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import type { MutationCtx } from "../lib/dataModel";
import { applyEventAward, isParticipantEligible } from "./pointsLedger";
import { requireVolunteerAccess, sessionTokenArgs } from "./staffAuth";
import { badgeHolderForScan, redeemMealForVolunteer } from "./volunteerScan";
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

/** Denials count toward the failure limit. */
async function deny<S extends string>(ctx: MutationCtx, scan: Scan, status: S) {
  await recordVolunteerScanFailure(ctx, scan.volunteer._id, scan.now);
  return { status };
}

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
 * participant is found by badge, so they are already checked in.
 */
export const awardEventPoints = mutation({
  args: { ...scanArgs, eventId: v.id("events") },
  handler: async (ctx, { sessionToken, qrCodeToken, eventId }) => {
    const volunteer = await requireVolunteerAccess(ctx, sessionToken);
    const scan = await beginScan(ctx, volunteer);
    if (!scan) return RATE_LIMITED;

    const hasAccess = volunteer.role === "admin" || (await ctx.db
      .query("volunteerEventAccess")
      .withIndex("by_volunteer_event", (q) =>
        q.eq("volunteerAdminId", volunteer._id).eq("eventId", eventId),
      )
      .unique()) !== null;
    const event = hasAccess ? await ctx.db.get(eventId) : null;
    if (!event) return deny(ctx, scan, "event_denied");
    if (!event.active) return deny(ctx, scan, "event_inactive");

    const found = await badgeHolderForScan(ctx, volunteer._id, scan.now, qrCodeToken);
    if ("failure" in found) return found.failure;
    const { participant } = found;
    if (!await isParticipantEligible(ctx, participant)) {
      return { status: "participant_not_eligible" as const };
    }
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
