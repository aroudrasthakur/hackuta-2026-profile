/**
 * Volunteer QR scan service: shows a volunteer what they may scan and
 * previews the participant behind a scanned QR code. See
 * [VOLUNTEER_AUTHORIZATION.md](./VOLUNTEER_AUTHORIZATION.md).
 *
 * `resolveQrForScan` is a **preview only**. It changes no participant, award,
 * or log rows. Check-in, food, and point-award mutations must re-run every
 * guard and eligibility check themselves; never trust a preview result.
 *
 * Results after the throttle are returned, not thrown, because a throw rolls
 * back the rate-limit rows. Session failures (`NOT_AUTHENTICATED`,
 * `VOLUNTEER_ONLY`) still throw: nothing has been written at that point.
 * QR tokens are never logged, returned, or regenerated here.
 */
import { v } from "convex/values";
import type { GenericId } from "convex/values";
import { mutation, query } from "../_generated/server";
import { formatApplicantFullName } from "../lib/applications";
import type { MutationCtx } from "../lib/dataModel";
import { eventStatus } from "../../shared/admin/volunteerRules";
import { isParticipantEligible } from "./pointsLedger";
import { requireVolunteerAccess, sessionTokenArgs, volunteerCapabilities } from "./staffAuth";
import {
  isVolunteerScanThrottled,
  recordVolunteerScanAttempt,
  recordVolunteerScanFailure,
} from "./volunteerScanRateLimit";

const QR_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const UNNAMED_PARTICIPANT = "Participant";

type AdminDoc = Awaited<ReturnType<typeof requireVolunteerAccess>>;
type ScanPurpose = "check_in" | "food_check_in" | "point_scan";

/** 256-bit lowercase hex, matching `createQrCodeToken`. Length is checked before the regex. */
export function isWellFormedQrToken(token: string) {
  return token.length === 64 && QR_TOKEN_PATTERN.test(token);
}

/** Participant for a QR token, or null. Malformed tokens are never looked up. */
export async function findParticipantByQrToken(ctx: MutationCtx, qrCodeToken: string) {
  if (!isWellFormedQrToken(qrCodeToken)) return null;
  return ctx.db
    .query("participants")
    .withIndex("by_qr_token", (q) => q.eq("qrCodeToken", qrCodeToken))
    .first();
}

/**
 * Lists the caller's own scan permissions and assigned switched-on events with
 * their schedule. No participant data. Not filtered by the clock: cached query
 * results would not refresh when a window opens, so awards check it instead.
 */
export const listMyScanOptions = query({
  args: sessionTokenArgs,
  handler: async (ctx, { sessionToken }) => {
    const volunteer = await requireVolunteerAccess(ctx, sessionToken);
    const assignments = await ctx.db
      .query("volunteerEventAccess")
      .withIndex("by_volunteer", (q) => q.eq("volunteerAdminId", volunteer._id))
      .collect();
    const events = [];
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
    events.sort((a, b) => a.startsAt - b.startsAt || a.name.localeCompare(b.name));
    return { ...volunteerCapabilities(volunteer), events };
  },
});

/**
 * Event for a point-scan preview, or null. Missing, unassigned, switched-off,
 * and out-of-window events look the same so volunteers learn nothing about
 * events outside their assignments.
 */
async function assignedOpenEvent(
  ctx: MutationCtx,
  volunteer: AdminDoc,
  eventId: GenericId<"events"> | undefined,
  now: number,
) {
  if (!eventId) return null;
  const assignment = await ctx.db
    .query("volunteerEventAccess")
    .withIndex("by_volunteer_event", (q) =>
      q.eq("volunteerAdminId", volunteer._id).eq("eventId", eventId),
    )
    .unique();
  if (!assignment) return null;
  const event = await ctx.db.get(eventId);
  return event && eventStatus(event, now) === "active" ? event : null;
}

async function participantName(ctx: MutationCtx, applicationId: GenericId<"applications">) {
  const application = await ctx.db.get(applicationId);
  return (application && formatApplicantFullName(application)) ?? UNNAMED_PARTICIPANT;
}

async function resolveQr(
  ctx: MutationCtx,
  volunteer: AdminDoc,
  args: { qrCodeToken: string; purpose: ScanPurpose; eventId?: GenericId<"events"> },
  now: number,
) {
  const capabilities = volunteerCapabilities(volunteer);
  let event = null;
  if (args.purpose === "check_in" && !capabilities.canCheckIn) return null;
  if (args.purpose === "food_check_in" && !capabilities.canFoodCheckIn) return null;
  if (args.purpose === "point_scan") {
    event = await assignedOpenEvent(ctx, volunteer, args.eventId, now);
    if (!event) return null;
  }

  const participant = await findParticipantByQrToken(ctx, args.qrCodeToken);
  if (!participant) {
    await recordVolunteerScanFailure(ctx, volunteer._id, now);
    return { status: "qr_not_found" as const };
  }
  if (!await isParticipantEligible(ctx, participant)) {
    return { status: "participant_not_eligible" as const };
  }

  const name = await participantName(ctx, participant.applicationId);
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
  if (args.purpose === "check_in") {
    return {
      status: "ok" as const,
      purpose: "check_in" as const,
      participant: {
        name,
        checkedIn: participant.checkedInAt !== undefined,
        checkedInAt: participant.checkedInAt ?? null,
      },
    };
  }
  return {
    status: "ok" as const,
    purpose: "food_check_in" as const,
    participant: {
      name,
      foodCheckedIn: participant.foodCheckedInAt !== undefined,
      foodCheckedInAt: participant.foodCheckedInAt ?? null,
      dietaryInfo: participant.foodRestriction ?? null,
    },
  };
}

/**
 * Previews a scanned QR code for one purpose. Mutation (not query) so every
 * attempt is counted. Statuses: `ok`, `qr_not_found` (missing and malformed
 * tokens look identical), `participant_not_eligible`, `not_authorized`
 * (missing capability or event access, or point scan without `eventId`), and
 * `rate_limited`.
 */
export const resolveQrForScan = mutation({
  args: {
    ...sessionTokenArgs,
    qrCodeToken: v.string(),
    purpose: v.union(v.literal("check_in"), v.literal("food_check_in"), v.literal("point_scan")),
    eventId: v.optional(v.id("events")),
  },
  handler: async (ctx, { sessionToken, ...args }) => {
    const volunteer = await requireVolunteerAccess(ctx, sessionToken);
    const now = Date.now();
    if (await isVolunteerScanThrottled(ctx, volunteer._id, now)) {
      return { status: "rate_limited" as const };
    }
    await recordVolunteerScanAttempt(ctx, volunteer._id, now);

    const result = await resolveQr(ctx, volunteer, args, now);
    if (result) return result;
    await recordVolunteerScanFailure(ctx, volunteer._id, now);
    return { status: "not_authorized" as const };
  },
});
