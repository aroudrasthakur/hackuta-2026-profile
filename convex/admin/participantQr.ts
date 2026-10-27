/**
 * Participant QR identity. `participants.qrCodeToken` is the only scannable
 * value: the registration token until check-in assigns a badge, then the
 * badge. Every scan workflow resolves through this module so check-in, food,
 * points, shop, and admin badge changes treat each kind of code the same way.
 *
 * Lookups read indexes inside the caller's mutation. Convex serializes
 * conflicting transactions, so a badge check followed by a write cannot let
 * two participants end up with the same badge.
 *
 * Raw QR values are never returned, logged, or stored outside `participants`;
 * retired badges keep only a SHA-256 hash.
 */
import type { DocumentByName } from "convex/server";
import type { GenericId } from "convex/values";
import type { DataModel, MutationCtx } from "../lib/dataModel";
import { formatApplicantFullName } from "../lib/applications";
import { sha256Hex } from "../lib/sha256Hex";
import { normalizeBadgeQr, normalizeRegistrationQr, scanLookupCandidates } from "../../shared/admin/qrValues";

export type ParticipantDoc = DocumentByName<DataModel, "participants">;

export type ScannedQr =
  /** Active registration token: the participant has no badge yet. */
  | { kind: "registration"; participant: ParticipantDoc }
  /** Active badge. */
  | { kind: "badge"; participant: ParticipantDoc }
  /** Registration token a badge replaced. Never scannable again. */
  | { kind: "registration_replaced"; participant: ParticipantDoc }
  /** Badge an admin took out of service. */
  | { kind: "badge_retired" }
  | { kind: "not_found" };

export function hashBadgeToken(value: string) {
  return sha256Hex(value);
}

/** Display name from the linked application. */
export async function participantName(ctx: MutationCtx, participant: Pick<ParticipantDoc, "applicationId">) {
  const application = await ctx.db.get(participant.applicationId);
  return (application && formatApplicantFullName(application)) ?? "Participant";
}

/** Classifies one scanned value. Malformed input is `not_found` and is never looked up. */
export async function resolveScannedQr(ctx: MutationCtx, raw: string): Promise<ScannedQr> {
  const candidates = scanLookupCandidates(raw);
  for (const value of candidates) {
    const participant = await ctx.db.query("participants")
      .withIndex("by_qr_token", (q) => q.eq("qrCodeToken", value))
      .first();
    if (participant) {
      return participant.badgeQrCodeToken === undefined
        ? { kind: "registration", participant }
        : { kind: "badge", participant };
    }
  }
  for (const value of candidates) {
    const participant = await ctx.db.query("participants")
      .withIndex("by_registration_qr_token", (q) => q.eq("registrationQrCodeToken", value))
      .first();
    if (participant) return { kind: "registration_replaced", participant };
  }
  for (const value of candidates) {
    const tokenHash = await hashBadgeToken(value);
    const retired = await ctx.db.query("retiredBadgeTokens")
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

/**
 * Participant behind an assigned badge, for food, points, and shop scans.
 * A registration QR never resolves here, before or after check-in.
 * `countsAsFailure` marks unknown or dead codes for the scan failure limit.
 */
export async function resolveBadgeHolder(ctx: MutationCtx, raw: string): Promise<
  | { participant: ParticipantDoc }
  | { failure: PostCheckInFailure; countsAsFailure: boolean }
> {
  const scanned = await resolveScannedQr(ctx, raw);
  switch (scanned.kind) {
    case "badge":
      return { participant: scanned.participant };
    case "registration":
      return scanned.participant.checkedInAt === undefined
        ? { failure: "participant_not_checked_in", countsAsFailure: false }
        : { failure: "badge_not_assigned", countsAsFailure: false };
    case "registration_replaced":
      return { failure: "registration_qr_replaced", countsAsFailure: true };
    case "badge_retired":
      return { failure: "badge_retired", countsAsFailure: true };
    case "not_found":
      return { failure: "qr_not_found", countsAsFailure: true };
  }
}

export type BadgeConflict = "badge_invalid" | "badge_is_registration" | "badge_in_use" | "badge_retired";

/**
 * Checks a badge value before it is assigned. Returns the exact value to
 * store, or why it cannot be used: malformed, any participant's current or
 * past registration token, assigned to anyone (including this participant),
 * or retired.
 */
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
  const assigned = await ctx.db.query("participants")
    .withIndex("by_badge_qr_token", (q) => q.eq("badgeQrCodeToken", badge))
    .first();
  if (assigned) return { conflict: "badge_in_use" };
  // A badge that reads as a registration token after normalizing (for example,
  // the same hex in capitals) is still a registration code.
  const registration = normalizeRegistrationQr(badge);
  if (registration !== null && registration !== badge) {
    const asRegistration = await resolveScannedQr(ctx, registration);
    if (asRegistration.kind === "registration" || asRegistration.kind === "registration_replaced") {
      return { conflict: "badge_is_registration" };
    }
  }
  return { badge };
}

/**
 * Makes `badge` the participant's only scannable value. The registration
 * token is kept once, on the first assignment; a replaced badge is retired by
 * hash so it can never be scanned or assigned again. Callers must have passed
 * `checkBadgeAvailable` in the same transaction.
 */
export async function assignBadge(ctx: MutationCtx, args: {
  participant: ParticipantDoc;
  badge: string;
  actorAdminId: GenericId<"admins">;
  now: number;
  checkIn: boolean;
}) {
  const { participant, badge, actorAdminId, now, checkIn } = args;
  const previousBadge = participant.badgeQrCodeToken;
  if (previousBadge !== undefined) {
    await ctx.db.insert("retiredBadgeTokens", {
      tokenHash: await hashBadgeToken(previousBadge),
      participantId: participant._id,
      retiredBy: actorAdminId,
      retiredAt: now,
    });
  }
  await ctx.db.patch(participant._id, {
    qrCodeToken: badge,
    badgeQrCodeToken: badge,
    ...(previousBadge === undefined ? { registrationQrCodeToken: participant.qrCodeToken } : {}),
    badgeAssignedAt: now,
    badgeAssignedBy: actorAdminId,
    ...(checkIn ? { checkedInAt: now } : {}),
    updatedAt: now,
  });
}
