/**
 * Administrator-only badge recovery for a lost, damaged, or wrong badge.
 * Calls `requireAdminRole` first; reviewers get `ADMIN_ONLY` and volunteers
 * `NOT_AUTHORIZED`, so volunteers can never move a completed assignment.
 * See [VOLUNTEER_AUTHORIZATION.md](./VOLUNTEER_AUTHORIZATION.md).
 *
 * Points, meals, awards, and purchases belong to the participant id, not the
 * QR value, so they carry over to the new badge unchanged.
 */
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { adminError, type AdminErrorCode } from "../../shared/admin/errors";
import { BADGE_REASON_MAX_LENGTH } from "../../shared/admin/qrValues";
import { assignBadge, checkBadgeAvailable, type BadgeConflict } from "./participantQr";
import { requireEligibleParticipant } from "./pointsLedger";
import { requireAdminRole, sessionTokenArgs } from "./staffAuth";

const CONFLICT_ERRORS: Record<BadgeConflict, AdminErrorCode> = {
  badge_invalid: "INVALID_BADGE",
  badge_is_registration: "BADGE_IS_REGISTRATION",
  badge_in_use: "BADGE_IN_USE",
  badge_retired: "BADGE_RETIRED",
};

function normalizeBadgeReason(reason: string) {
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > BADGE_REASON_MAX_LENGTH) throw adminError("INVALID_BADGE_REASON");
  return trimmed;
}

/**
 * Gives a checked-in participant a new badge in one transaction. The old
 * badge is retired at once and can never be scanned or assigned again; a
 * legacy check-in without a badge gets its first one and its registration QR
 * stops working. `expectedBadgeAssignedAt` is the `badge.assignedAt` the admin
 * reviewed (null for none), so a stale screen cannot overwrite a newer change.
 * Writes a `badge_replaced` or `badge_assigned` log with the reason; QR values
 * are never logged.
 */
export const assignParticipantBadge = mutation({
  args: {
    ...sessionTokenArgs,
    participantId: v.id("participants"),
    badgeQrCodeToken: v.string(),
    reason: v.string(),
    expectedBadgeAssignedAt: v.union(v.number(), v.null()),
  },
  returns: v.object({ ok: v.literal(true), replaced: v.boolean(), assignedAt: v.number() }),
  handler: async (ctx, { sessionToken, participantId, badgeQrCodeToken, reason, expectedBadgeAssignedAt }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const normalizedReason = normalizeBadgeReason(reason);
    const participant = await requireEligibleParticipant(ctx, participantId);
    if (participant.checkedInAt === undefined) throw adminError("PARTICIPANT_NOT_CHECKED_IN");
    if ((participant.badgeAssignedAt ?? null) !== expectedBadgeAssignedAt) {
      throw adminError("BADGE_ASSIGNMENT_CHANGED");
    }
    const checked = await checkBadgeAvailable(ctx, badgeQrCodeToken);
    if ("conflict" in checked) throw adminError(CONFLICT_ERRORS[checked.conflict]);

    const now = Date.now();
    const replaced = participant.badgeQrCodeToken !== undefined;
    await assignBadge(ctx, { participant, badge: checked.badge, actorAdminId: actor._id, now, checkIn: false });
    await ctx.db.insert("volunteerActionLogs", {
      actorAdminId: actor._id,
      participantId,
      action: replaced ? "badge_replaced" : "badge_assigned",
      reason: normalizedReason,
      createdAt: now,
    });
    return { ok: true as const, replaced, assignedAt: now };
  },
});
