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
 * Session failures throw before any write; outcomes are returned, not thrown.
 * Shop scans keep volunteer rate limits; food and event scans do not.
 * Point awards need a switched-on event; schedule times are reference only.
 */
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import type { MutationCtx } from "../lib/dataModel";
import { isOwnParticipant } from "./participantQr";
import { applyEventAward, isParticipantEligible } from "./pointsLedger";
import { requireVolunteerAccess, sessionTokenArgs, volunteerHasAllEventAccess } from "./staffAuth";
import { badgeHolderForScan, redeemMealForVolunteer } from "./volunteerScan";

type AdminDoc = Awaited<ReturnType<typeof requireVolunteerAccess>>;

const scanArgs = { ...sessionTokenArgs, qrCodeToken: v.string() };

function deny<S extends string>(status: S) {
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
    const now = Date.now();

    const hasAccess = volunteerHasAllEventAccess(volunteer) || (await ctx.db
      .query("volunteerEventAccess")
      .withIndex("by_volunteer_event", (q) =>
        q.eq("volunteerAdminId", volunteer._id).eq("eventId", eventId),
      )
      .unique()) !== null;
    const event = hasAccess ? await ctx.db.get(eventId) : null;
    if (!event) return deny("event_denied");
    if (!event.active) return deny("event_inactive");

    const found = await badgeHolderForScan(ctx, volunteer._id, now, qrCodeToken);
    if ("failure" in found) return found.failure;
    const { participant, checkedIn } = found;
    if (await isOwnParticipant(ctx, volunteer, participant, checkedIn._id)) {
      return deny("self_scan_denied");
    }
    if (!await isParticipantEligible(ctx, participant)) {
      return { status: "participant_not_eligible" as const };
    }

    const award = await applyEventAward(ctx, {
      actorAdminId: volunteer._id,
      checkedIn,
      event,
      now,
    });
    if (award.status === "already_awarded") return award;
    return { status: "success" as const, pointsAwarded: award.pointsAwarded };
  },
});
