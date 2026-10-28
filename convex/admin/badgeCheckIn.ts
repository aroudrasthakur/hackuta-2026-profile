/**
 * Two-scan volunteer check-in: the participant's registration QR, then the
 * QR printed on their physical badge. See
 * [VOLUNTEER_AUTHORIZATION.md](./VOLUNTEER_AUTHORIZATION.md).
 *
 * `resolveRegistrationForCheckIn` and `resolveBadgeForCheckIn` are previews
 * and write only rate-limit rows. `checkInWithBadge` re-runs every check and,
 * in one transaction, assigns the badge, retires the registration QR, sets
 * the check-in and badge timestamps, and writes a `check_in` log. A rejected
 * badge leaves the participant unchanged.
 *
 * Like the other scan mutations, session failures throw before any write and
 * every outcome after the attempt row is returned, not thrown.
 */
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import type { MutationCtx } from "../lib/dataModel";
import { normalizeBadgeQr } from "../../shared/admin/qrValues";
import {
  assignBadge,
  checkBadgeAvailable,
  participantName,
  resolveScannedQr,
  type BadgeConflict,
  type ParticipantDoc,
} from "./participantQr";
import { isParticipantEligible } from "./pointsLedger";
import { hasVolunteerCapability, requireVolunteerAccess, sessionTokenArgs } from "./staffAuth";
import {
  isVolunteerScanThrottled,
  recordVolunteerScanAttempt,
  recordVolunteerScanFailure,
} from "./volunteerScanRateLimit";

type AdminDoc = Awaited<ReturnType<typeof requireVolunteerAccess>>;
type Scan = { volunteer: AdminDoc; now: number };

const registrationArgs = { ...sessionTokenArgs, registrationQrCodeToken: v.string() };
const badgeArgs = { ...registrationArgs, badgeQrCodeToken: v.string() };

/** Conflicts from guessing or reusing codes count toward the failure limit; a mix-up does not. */
const COUNTED_CONFLICTS = new Set<BadgeConflict>(["badge_invalid", "badge_in_use", "badge_retired"]);

/** Throttle, one attempt row, then `canCheckIn`. */
async function beginCheckIn(ctx: MutationCtx, volunteer: AdminDoc) {
  const now = Date.now();
  if (await isVolunteerScanThrottled(ctx, volunteer._id, now)) {
    return { result: { status: "rate_limited" as const } };
  }
  await recordVolunteerScanAttempt(ctx, volunteer._id, now);
  if (!hasVolunteerCapability(volunteer, "canCheckIn")) {
    await recordVolunteerScanFailure(ctx, volunteer._id, now);
    return { result: { status: "not_authorized" as const } };
  }
  return { scan: { volunteer, now } };
}

async function countFailure(ctx: MutationCtx, scan: Scan) {
  await recordVolunteerScanFailure(ctx, scan.volunteer._id, scan.now);
}

/** Participant whose registration QR can start check-in, or the result to return. */
async function registrationHolder(ctx: MutationCtx, scan: Scan, raw: string) {
  const scanned = await resolveScannedQr(ctx, raw);
  if (scanned.kind === "not_found" || scanned.kind === "badge_retired") {
    await countFailure(ctx, scan);
    return { result: { status: "qr_not_found" as const } };
  }
  const { participant } = scanned;
  if (scanned.kind === "registration_replaced") {
    return {
      result: {
        status: "registration_qr_used" as const,
        participant: { name: await participantName(ctx, participant), checkedInAt: participant.checkedInAt ?? null },
      },
    };
  }
  if (!await isParticipantEligible(ctx, participant)) {
    return { result: { status: "participant_not_eligible" as const } };
  }
  if (scanned.kind === "badge" || participant.checkedInAt !== undefined) {
    return {
      result: {
        status: "already_checked_in" as const,
        participant: { name: await participantName(ctx, participant), checkedInAt: participant.checkedInAt ?? null },
      },
    };
  }
  return { participant };
}

/** Exact badge value to assign, or the conflict to return. */
async function availableBadge(ctx: MutationCtx, scan: Scan, raw: string) {
  const checked = await checkBadgeAvailable(ctx, raw);
  if ("badge" in checked) return { badge: checked.badge };
  if (COUNTED_CONFLICTS.has(checked.conflict)) await countFailure(ctx, scan);
  return { result: { status: checked.conflict } };
}

function okPreview(name: string) {
  return { status: "ok" as const, participant: { name } };
}

/**
 * Step 1. Identifies the participant behind a registration QR. Statuses:
 * `ok` (with name), `already_checked_in` and `registration_qr_used` (with
 * name and time), `qr_not_found`, `participant_not_eligible`,
 * `not_authorized`, and `rate_limited`. Changes no participant.
 */
export const resolveRegistrationForCheckIn = mutation({
  args: registrationArgs,
  handler: async (ctx, { sessionToken, registrationQrCodeToken }) => {
    const begun = await beginCheckIn(ctx, await requireVolunteerAccess(ctx, sessionToken));
    if ("result" in begun) return begun.result;
    const holder = await registrationHolder(ctx, begun.scan, registrationQrCodeToken);
    if ("result" in holder) return holder.result;
    return okPreview(await participantName(ctx, holder.participant));
  },
});

/**
 * Step 2. Re-checks the registration QR, then the badge. Adds the badge
 * statuses `badge_invalid`, `badge_is_registration`, `badge_in_use`, and
 * `badge_retired`. Changes no participant.
 */
export const resolveBadgeForCheckIn = mutation({
  args: badgeArgs,
  handler: async (ctx, { sessionToken, registrationQrCodeToken, badgeQrCodeToken }) => {
    const begun = await beginCheckIn(ctx, await requireVolunteerAccess(ctx, sessionToken));
    if ("result" in begun) return begun.result;
    const holder = await registrationHolder(ctx, begun.scan, registrationQrCodeToken);
    if ("result" in holder) return holder.result;
    const badge = await availableBadge(ctx, begun.scan, badgeQrCodeToken);
    if ("result" in badge) return badge.result;
    return okPreview(await participantName(ctx, holder.participant));
  },
});

/** A retried confirmation whose first attempt committed: same participant, same badge. */
async function alreadyAssigned(ctx: MutationCtx, raw: string, badgeRaw: string) {
  const scanned = await resolveScannedQr(ctx, raw);
  if (scanned.kind !== "registration_replaced") return null;
  const badge = normalizeBadgeQr(badgeRaw);
  const participant: ParticipantDoc = scanned.participant;
  if (badge === null || participant.badgeQrCodeToken !== badge) return null;
  return {
    status: "already_checked_in" as const,
    participant: { name: await participantName(ctx, participant), checkedInAt: participant.checkedInAt ?? null },
  };
}

/**
 * Step 3. Checks in the participant and assigns the badge in one transaction.
 * Returns `success` with `checkedInAt`, or any step 1 or step 2 status with
 * nothing changed. A retry with the same registration QR and badge after a
 * committed check-in returns `already_checked_in`.
 */
export const checkInWithBadge = mutation({
  args: badgeArgs,
  handler: async (ctx, { sessionToken, registrationQrCodeToken, badgeQrCodeToken }) => {
    const begun = await beginCheckIn(ctx, await requireVolunteerAccess(ctx, sessionToken));
    if ("result" in begun) return begun.result;
    const { scan } = begun;
    const repeat = await alreadyAssigned(ctx, registrationQrCodeToken, badgeQrCodeToken);
    if (repeat) return repeat;
    const holder = await registrationHolder(ctx, scan, registrationQrCodeToken);
    if ("result" in holder) return holder.result;
    const badge = await availableBadge(ctx, scan, badgeQrCodeToken);
    if ("result" in badge) return badge.result;

    await assignBadge(ctx, {
      participant: holder.participant,
      badge: badge.badge,
      actorAdminId: scan.volunteer._id,
      now: scan.now,
      checkIn: true,
    });
    await ctx.db.insert("volunteerActionLogs", {
      actorAdminId: scan.volunteer._id,
      participantId: holder.participant._id,
      action: "check_in",
      createdAt: scan.now,
    });
    return { status: "success" as const, checkedInAt: scan.now };
  },
});
