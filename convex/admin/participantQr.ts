/**
 * QR identity across accepted and checked-in rows.
 * Registration tokens live on `participants`. After door check-in, the
 * scannable badge lives on `checkedIn`.
 */
import type { GenericId } from "convex/values";
import type { MutationCtx, QueryCtx } from "../lib/dataModel";
import { formatApplicantFullName } from "../lib/applications";
import { normalizeEmail } from "../lib/normalizeEmail";
import { sha256Hex } from "../lib/sha256Hex";
import { normalizeBadgeQr, normalizeRegistrationQr, scanLookupCandidates } from "../../shared/admin/qrValues";
import {
  checkedInForParticipant,
  type CheckedInDoc,
  type ParticipantDoc,
} from "./checkedInLookup";

export type { CheckedInDoc, ParticipantDoc };

export type ScannedQr =
  | { kind: "registration"; participant: ParticipantDoc }
  | { kind: "badge"; participant: ParticipantDoc; checkedIn: CheckedInDoc }
  | { kind: "registration_replaced"; participant: ParticipantDoc; checkedIn: CheckedInDoc }
  | { kind: "badge_retired" }
  | { kind: "not_found" };

export function hashBadgeToken(value: string) {
  return sha256Hex(value);
}

export async function participantName(
  ctx: MutationCtx | QueryCtx,
  holder: Pick<ParticipantDoc, "applicationId">,
) {
  const application = await ctx.db.get(holder.applicationId);
  return (application && formatApplicantFullName(application)) ?? "Participant";
}

type StaffIdentity = {
  email: string;
  participantId?: GenericId<"participants">;
  checkedInId?: GenericId<"checkedIn">;
};

export async function isOwnParticipant(
  ctx: QueryCtx | MutationCtx,
  staff: StaffIdentity,
  participant: Pick<ParticipantDoc, "_id" | "applicationId">,
  checkedInId?: GenericId<"checkedIn">,
) {
  if (staff.participantId === participant._id) {
    return true;
  }
  if (checkedInId && staff.checkedInId === checkedInId) {
    return true;
  }
  const application = await ctx.db.get(participant.applicationId);
  if (!application?.email) {
    return false;
  }
  return normalizeEmail(application.email) === normalizeEmail(staff.email);
}

export async function resolveScannedQr(ctx: MutationCtx, raw: string): Promise<ScannedQr> {
  const candidates = scanLookupCandidates(raw);
  for (const value of candidates) {
    const participant = await ctx.db
      .query("participants")
      .withIndex("by_qr_token", (q) => q.eq("qrCodeToken", value))
      .first();
    if (participant) {
      const checkedIn = await checkedInForParticipant(ctx, participant._id);
      if (checkedIn) {
        if (checkedIn.qrCodeToken === value || checkedIn.badgeQrCodeToken === value) {
          return { kind: "badge", participant, checkedIn };
        }
        return { kind: "registration_replaced", participant, checkedIn };
      }
      return { kind: "registration", participant };
    }
  }
  for (const value of candidates) {
    const checkedIn = await ctx.db
      .query("checkedIn")
      .withIndex("by_qr_token", (q) => q.eq("qrCodeToken", value))
      .first();
    if (checkedIn) {
      const participant = await ctx.db.get(checkedIn.participantId);
      if (!participant) return { kind: "not_found" };
      return { kind: "badge", participant, checkedIn };
    }
  }
  for (const value of candidates) {
    const checkedIn = await ctx.db
      .query("checkedIn")
      .withIndex("by_registration_qr_token", (q) => q.eq("registrationQrCodeToken", value))
      .first();
    if (checkedIn) {
      const participant = await ctx.db.get(checkedIn.participantId);
      if (!participant) return { kind: "not_found" };
      return { kind: "registration_replaced", participant, checkedIn };
    }
  }
  for (const value of candidates) {
    const tokenHash = await hashBadgeToken(value);
    const retired = await ctx.db
      .query("retiredBadgeTokens")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (retired) return { kind: "badge_retired" };
  }
  return { kind: "not_found" };
}

export type PostCheckInFailure =
  | "qr_not_found"
  | "participant_not_checked_in"
  | "badge_not_assigned"
  | "registration_qr_replaced"
  | "badge_retired";

export async function resolveBadgeHolder(ctx: MutationCtx, raw: string): Promise<
  | { participant: ParticipantDoc; checkedIn: CheckedInDoc }
  | { failure: PostCheckInFailure; countsAsFailure: boolean }
> {
  const scanned = await resolveScannedQr(ctx, raw);
  switch (scanned.kind) {
    case "badge":
      return scanned.checkedIn.badgeQrCodeToken === undefined
        ? { failure: "badge_not_assigned", countsAsFailure: false }
        : { participant: scanned.participant, checkedIn: scanned.checkedIn };
    case "registration":
      return { failure: "participant_not_checked_in", countsAsFailure: false };
    case "registration_replaced":
      return scanned.checkedIn.badgeQrCodeToken === undefined
        ? { failure: "badge_not_assigned", countsAsFailure: false }
        : { failure: "registration_qr_replaced", countsAsFailure: true };
    case "badge_retired":
      return { failure: "badge_retired", countsAsFailure: true };
    case "not_found":
      return { failure: "qr_not_found", countsAsFailure: true };
  }
}

export type BadgeConflict = "badge_invalid" | "badge_is_registration" | "badge_in_use" | "badge_retired";

export async function checkBadgeAvailable(ctx: MutationCtx, raw: string): Promise<
  { badge: string } | { conflict: BadgeConflict }
> {
  const badge = normalizeBadgeQr(raw);
  if (badge === null) return { conflict: "badge_invalid" };
  const scanned = await resolveScannedQr(ctx, badge);
  if (scanned.kind === "registration" || scanned.kind === "registration_replaced") {
    return { conflict: "badge_is_registration" };
  }
  if (scanned.kind === "badge") return { conflict: "badge_in_use" };
  if (scanned.kind === "badge_retired") return { conflict: "badge_retired" };
  const assigned = await ctx.db
    .query("checkedIn")
    .withIndex("by_badge_qr_token", (q) => q.eq("badgeQrCodeToken", badge))
    .first();
  if (assigned) return { conflict: "badge_in_use" };
  const registration = normalizeRegistrationQr(badge);
  if (registration !== null && registration !== badge) {
    const asRegistration = await resolveScannedQr(ctx, registration);
    if (asRegistration.kind === "registration" || asRegistration.kind === "registration_replaced") {
      return { conflict: "badge_is_registration" };
    }
  }
  return { badge };
}

export async function assignBadge(ctx: MutationCtx, args: {
  participant: ParticipantDoc;
  badge: string;
  actorAdminId: GenericId<"admins">;
  now: number;
  checkIn: boolean;
}) {
  const { participant, badge, actorAdminId, now, checkIn } = args;
  const existing = await checkedInForParticipant(ctx, participant._id);
  const previousBadge = existing?.badgeQrCodeToken;
  if (existing && previousBadge !== undefined) {
    await ctx.db.insert("retiredBadgeTokens", {
      tokenHash: await hashBadgeToken(previousBadge),
      checkedInId: existing._id,
      retiredBy: actorAdminId,
      retiredAt: now,
    });
  }

  if (existing) {
    await ctx.db.patch(existing._id, {
      qrCodeToken: badge,
      badgeQrCodeToken: badge,
      badgeAssignedAt: now,
      badgeAssignedBy: actorAdminId,
      updatedAt: now,
    });
    if (checkIn && participant.checkedInAt === undefined) {
      await ctx.db.patch(participant._id, { checkedInAt: now, updatedAt: now });
    } else {
      await ctx.db.patch(participant._id, { updatedAt: now });
    }
    return existing._id;
  }

  if (!checkIn && participant.checkedInAt === undefined) {
    throw new Error("checkedIn row required before assigning a badge without check-in.");
  }

  const checkedInAt = participant.checkedInAt ?? now;
  const checkedInId = await ctx.db.insert("checkedIn", {
    participantId: participant._id,
    applicationId: participant.applicationId,
    authUserId: participant.authUserId,
    acceptedAt: participant.acceptedAt,
    acceptedBy: participant.acceptedBy,
    ...(participant.foodRestriction !== undefined ? { foodRestriction: participant.foodRestriction } : {}),
    checkedInAt,
    checkedInBy: actorAdminId,
    qrCodeToken: badge,
    registrationQrCodeToken: participant.qrCodeToken,
    badgeQrCodeToken: badge,
    badgeAssignedAt: now,
    badgeAssignedBy: actorAdminId,
    points: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(participant._id, { checkedInAt, updatedAt: now });
  return checkedInId;
}
