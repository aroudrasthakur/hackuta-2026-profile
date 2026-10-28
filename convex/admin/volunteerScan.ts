/**
 * Volunteer QR scan service: shows a volunteer what they may scan and
 * previews the participant behind a scanned QR code. See
 * [VOLUNTEER_AUTHORIZATION.md](./VOLUNTEER_AUTHORIZATION.md).
 *
 * `resolveQrForScan` is a **preview only**. It changes no participant, award,
 * or log rows. Food, point-award, and shop mutations must re-run every guard
 * and eligibility check themselves; never trust a preview result.
 *
 * These workflows run after check-in and accept only an assigned badge QR. A
 * registration QR is rejected before and after check-in; door check-in has
 * its own two-scan flow in `badgeCheckIn.ts`.
 *
 * Results after the throttle are returned, not thrown, because a throw rolls
 * back the rate-limit rows. Session failures (`NOT_AUTHENTICATED`,
 * `VOLUNTEER_ONLY`) still throw: nothing has been written at that point.
 * QR tokens are never logged, returned, or regenerated here.
 */
import { v } from "convex/values";
import type { GenericId } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx } from "../lib/dataModel";
import {
  isOwnParticipant,
  participantName,
  resolveBadgeHolder,
  type ParticipantDoc,
  type PostCheckInFailure,
} from "./participantQr";
import { computeLedgerPoints, isParticipantEligible } from "./pointsLedger";
import { hasVolunteerCapability, requireVolunteerAccess, sessionTokenArgs, volunteerCapabilities } from "./staffAuth";
import {
  isVolunteerScanThrottled,
  recordVolunteerScanAttempt,
  recordVolunteerScanFailure,
} from "./volunteerScanRateLimit";

type AdminDoc = Awaited<ReturnType<typeof requireVolunteerAccess>>;
type ScanPurpose = "food_check_in" | "point_scan" | "shop";
type MealScanArgs = { qrCodeToken: string; mealPeriodId?: GenericId<"mealPeriods"> };

/**
 * Participant behind an assigned badge, or the failure to return. Unknown,
 * replaced, and retired codes count toward the failure limit.
 */
export async function badgeHolderForScan(
  ctx: MutationCtx,
  volunteerId: AdminDoc["_id"],
  now: number,
  raw: string,
): Promise<{ participant: ParticipantDoc } | { failure: { status: PostCheckInFailure } }> {
  const found = await resolveBadgeHolder(ctx, raw);
  if ("participant" in found) return { participant: found.participant };
  if (found.countsAsFailure) await recordVolunteerScanFailure(ctx, volunteerId, now);
  return { failure: { status: found.failure } };
}

/**
 * Lists the caller's own scan permissions and assigned switched-on events with
 * their schedule (reference only). Administrators automatically receive all
 * capabilities and all switched-on events. No participant data.
 */
export const listMyScanOptions = query({
  args: sessionTokenArgs,
  handler: async (ctx, { sessionToken }) => {
    const volunteer = await requireVolunteerAccess(ctx, sessionToken);
    const events = [];
    if (volunteer.role === "admin") {
      const activeEvents = await ctx.db
        .query("events")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect();
      for (const event of activeEvents) {
        events.push({
          eventId: event._id,
          name: event.name,
          pointsAwarded: event.pointsAwarded,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
        });
      }
    } else {
      const assignments = await ctx.db
        .query("volunteerEventAccess")
        .withIndex("by_volunteer", (q) => q.eq("volunteerAdminId", volunteer._id))
        .collect();
      for (const assignment of assignments) {
        const event = await ctx.db.get(assignment.eventId);
        if (!event?.active) continue;
        events.push({
          eventId: event._id,
          name: event.name,
          pointsAwarded: event.pointsAwarded,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
        });
      }
    }
    events.sort((a, b) => a.startsAt - b.startsAt || a.name.localeCompare(b.name));
    const capabilities = volunteer.role === "admin"
      ? { canCheckIn: true, canFoodCheckIn: true, canRedeemShop: true }
      : volunteerCapabilities(volunteer);
    return { ...capabilities, events };
  },
});

/**
 * Event for a point-scan preview, or null. Missing, unassigned, and switched-off
 * events look the same so volunteers learn nothing about events outside their
 * assignments. Administrators may scan any active event. Schedule times are not checked.
 */
async function assignedActiveEvent(
  ctx: MutationCtx,
  volunteer: AdminDoc,
  eventId: GenericId<"events"> | undefined,
) {
  if (!eventId) return null;
  if (volunteer.role !== "admin") {
    const assignment = await ctx.db
      .query("volunteerEventAccess")
      .withIndex("by_volunteer_event", (q) =>
        q.eq("volunteerAdminId", volunteer._id).eq("eventId", eventId),
      )
      .unique();
    if (!assignment) return null;
  }
  const event = await ctx.db.get(eventId);
  return event?.active ? event : null;
}

/**
 * Enabled meal schedules, including future windows so the scanner can follow
 * clock boundaries without depending on a database write or resetting an active
 * request every time a polling query changes arguments. The UI filters serving
 * windows; preview and redemption always check the server's current time.
 */
export const listActiveMealPeriods = query({
  args: sessionTokenArgs,
  handler: async (ctx, { sessionToken }) => {
    const volunteer = await requireVolunteerAccess(ctx, sessionToken);
    if (!hasVolunteerCapability(volunteer, "canFoodCheckIn")) return [];
    const meals = await ctx.db.query("mealPeriods")
      .withIndex("by_active_startsAt", (q) => q.eq("active", true)).collect();
    return meals.map((meal) => ({
      mealPeriodId: meal._id, name: meal.name, startsAt: meal.startsAt,
      endsAt: meal.endsAt, updatedAt: meal.updatedAt,
    }));
  },
});

/** All checks run inside the caller's mutation; returned failures commit throttle counters. */
async function prepareMealScan(ctx: MutationCtx, volunteer: AdminDoc, args: MealScanArgs) {
  const now = Date.now();
  if (await isVolunteerScanThrottled(ctx, volunteer._id, now)) return { status: "rate_limited" as const };
  await recordVolunteerScanAttempt(ctx, volunteer._id, now);
  if (!hasVolunteerCapability(volunteer, "canFoodCheckIn")) {
    await recordVolunteerScanFailure(ctx, volunteer._id, now);
    return { status: "not_authorized" as const };
  }
  // Old clients must select a meal too; there is no single-use eligibility fallback.
  if (!args.mealPeriodId) return { status: "meal_not_active" as const };
  const found = await badgeHolderForScan(ctx, volunteer._id, now, args.qrCodeToken);
  if ("failure" in found) return { status: found.failure.status };
  const { participant } = found;
  if (!await isParticipantEligible(ctx, participant)) return { status: "participant_ineligible" as const };
  const meal = await ctx.db.get(args.mealPeriodId);
  if (!meal?.active) return { status: "meal_not_active" as const };
  if (now < meal.startsAt) return { status: "meal_not_started" as const };
  if (now >= meal.endsAt) return { status: "meal_ended" as const };
  const redemption = await ctx.db.query("mealRedemptions")
    .withIndex("by_participant_meal", (q) => q.eq("participantId", participant._id).eq("mealPeriodId", meal._id))
    .first();
  return { participant, meal, redemption, now };
}

/** Internal implementation shared with the legacy preview entry point. */
async function previewMeal(ctx: MutationCtx, volunteer: AdminDoc, args: MealScanArgs) {
  const target = await prepareMealScan(ctx, volunteer, args);
  if (target.status !== undefined) return { status: target.status };
  const { participant, meal, redemption } = target;
  return {
    status: "ok" as const, purpose: "food_check_in" as const,
    meal: { mealPeriodId: meal._id, name: meal.name },
    participant: {
      name: await participantName(ctx, participant),
      alreadyRedeemed: redemption !== null, redeemedAt: redemption?.redeemedAt ?? null,
      dietaryInfo: participant.foodRestriction ?? null,
    },
  };
}

/** Shared with the legacy food mutation so it cannot bypass meal restrictions. */
export async function redeemMealForVolunteer(ctx: MutationCtx, volunteer: AdminDoc, args: MealScanArgs) {
  const target = await prepareMealScan(ctx, volunteer, args);
  if (target.status !== undefined) return { status: target.status };
  const { participant, meal, redemption, now } = target;
  const selectedMeal = { mealPeriodId: meal._id, name: meal.name };
  if (redemption) return { status: "already_redeemed" as const, redeemedAt: redemption.redeemedAt, meal: selectedMeal };
  await ctx.db.insert("mealRedemptions", {
    participantId: participant._id, mealPeriodId: meal._id, scannedBy: volunteer._id, redeemedAt: now,
    countedInServedCount: true,
  });
  await ctx.db.patch(meal._id, {
    servedCount: (meal.servedCount ?? 0) + 1,
    // New collections are already counted even if legacy history is still being backfilled.
    ...(meal.servedCount === undefined ? { servedCountBackfillCursor: null } : {}),
  });
  await ctx.db.insert("volunteerActionLogs", {
    actorAdminId: volunteer._id, participantId: participant._id, mealPeriodId: meal._id,
    action: "food_check_in", createdAt: now,
  });
  return { status: "success" as const, redeemedAt: now, meal: selectedMeal };
}

const mealScanArgs = { ...sessionTokenArgs, qrCodeToken: v.string(), mealPeriodId: v.id("mealPeriods") };

export const resolveQrForMeal = mutation({
  args: mealScanArgs,
  handler: async (ctx, { sessionToken, ...args }) => {
    const volunteer = await requireVolunteerAccess(ctx, sessionToken);
    return previewMeal(ctx, volunteer, args);
  },
});

/** The indexed duplicate check, insertion, and audit write form a single transaction. */
export const redeemMeal = mutation({
  args: mealScanArgs,
  handler: async (ctx, { sessionToken, ...args }) => {
    const volunteer = await requireVolunteerAccess(ctx, sessionToken);
    return redeemMealForVolunteer(ctx, volunteer, args);
  },
});

async function resolveQr(
  ctx: MutationCtx,
  volunteer: AdminDoc,
  args: { qrCodeToken: string; purpose: Exclude<ScanPurpose, "food_check_in">; eventId?: GenericId<"events"> },
  now: number,
) {
  let event = null;
  if (args.purpose === "shop" && !hasVolunteerCapability(volunteer, "canRedeemShop")) return null;
  if (args.purpose === "point_scan") {
    event = await assignedActiveEvent(ctx, volunteer, args.eventId);
    if (!event) return null;
  }

  const found = await badgeHolderForScan(ctx, volunteer._id, now, args.qrCodeToken);
  if ("failure" in found) return found.failure;
  const { participant } = found;
  if (!await isParticipantEligible(ctx, participant)) {
    return { status: "participant_not_eligible" as const };
  }

  if (await isOwnParticipant(ctx, volunteer, participant)) {
    return { status: event ? "self_scan_denied" as const : "self_purchase_denied" as const };
  }

  const name = await participantName(ctx, participant);
  if (event) {
    const eventId = event._id;
    const award = await ctx.db
      .query("participantEventAwards")
      .withIndex("by_participant_event", (q) =>
        q.eq("participantId", participant._id).eq("eventId", eventId),
      )
      .first();
    return {
      status: "ok" as const,
      purpose: "point_scan" as const,
      participant: { name },
      event: { eventId, name: event.name, pointsAwarded: event.pointsAwarded },
      alreadyAwarded: award !== null,
    };
  }
  return {
    status: "ok" as const,
    purpose: "shop" as const,
    participant: {
      participantId: participant._id,
      name,
      points: participant.points ?? await computeLedgerPoints(ctx, participant._id),
    },
  };
}

/**
 * Previews a scanned badge QR for one purpose. Mutation (not query) so every
 * attempt is counted. Statuses: `ok`; `qr_not_found` (missing and malformed
 * values look identical); `registration_qr_replaced` and `badge_retired`
 * (codes that no longer work); `participant_not_checked_in` and
 * `badge_not_assigned` (a registration QR, before check-in or for a legacy
 * check-in without a badge); `participant_not_eligible`; `not_authorized`
 * (missing capability or event access, or point scan without `eventId`);
 * `self_purchase_denied` (shop scan of the volunteer's own participant
 * record, including an unlinked account with the same email);
 * `self_scan_denied` (point scan of the volunteer's own badge); and
 * `rate_limited`. A shop preview returns the participant id
 * and balance for the purchase screens.
 */
export const resolveQrForScan = mutation({
  args: {
    ...sessionTokenArgs,
    qrCodeToken: v.string(),
    purpose: v.union(v.literal("food_check_in"), v.literal("point_scan"), v.literal("shop")),
    eventId: v.optional(v.id("events")),
    mealPeriodId: v.optional(v.id("mealPeriods")),
  },
  handler: async (ctx, { sessionToken, ...args }) => {
    const volunteer = await requireVolunteerAccess(ctx, sessionToken);
    if (args.purpose === "food_check_in") return previewMeal(ctx, volunteer, args);
    const now = Date.now();
    if (await isVolunteerScanThrottled(ctx, volunteer._id, now)) {
      return { status: "rate_limited" as const };
    }
    await recordVolunteerScanAttempt(ctx, volunteer._id, now);

    const result = await resolveQr(ctx, volunteer, { ...args, purpose: args.purpose }, now);
    if (result) {
      if (result.status === "self_scan_denied") {
        await recordVolunteerScanFailure(ctx, volunteer._id, now);
      }
      return result;
    }
    await recordVolunteerScanFailure(ctx, volunteer._id, now);
    return { status: "not_authorized" as const };
  },
});
