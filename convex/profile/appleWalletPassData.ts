import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { getAuthUser } from "../lib/applications";
import { getEventConfigRow } from "../lib/eventConfig";
import { normalizeEmail } from "../lib/normalizeEmail";
import { DEFAULT_HACKATHON_NAME } from "../../shared/hackathon/eventDefaults";
import { resolveHackathonTimelineSource } from "../../shared/hackathon/schedule";
import { normalizeRegistrationQr } from "../../shared/admin/qrValues";
import { resolveApplicationForAuthUser } from "./applicationLookup";
import {
  applicantVisibleParticipant,
  applicantVisibleReviewStatus,
  openDecisionEmailForApplication,
} from "./openDecisionEmail";
import { getParticipantMediaDisclosure, hasAcceptedMediaDisclosure } from "./mediaDisclosure";
import { isParticipantCheckedIn } from "./participantCheckIn";

export type AppleWalletPassDataInput = {
  serialNumber: string;
  displayName: string;
  email: string | null;
  qrCodeToken: string;
  hackathonName: string;
  startsAt: number;
  endsAt: number;
};

export type AppleWalletPassLookupResult =
  | { status: "unauthenticated" }
  | { status: "not_eligible" }
  | { status: "media_disclosure_required" }
  | { status: "already_checked_in" }
  | { status: "ok"; passInput: AppleWalletPassDataInput };

/** Stable, unique pass serial number per participant. Never embeds the QR token. */
export function formatAppleWalletSerialNumber(participantId: string) {
  return `hackuta-2026-${participantId}`;
}

/**
 * Loads the signed-in participant's pre-check-in registration QR and event metadata
 * for server-side Apple Wallet pass generation.
 *
 * Rejects unauthenticated users, unaccepted/masked applications, participants
 * who have not accepted the media disclosure, and checked-in participants
 * (whose registration QR has been replaced by a physical badge).
 */
export const getMyAppleWalletPassInput = internalQuery({
  args: {},
  handler: async (ctx): Promise<AppleWalletPassLookupResult> => {
    const user = await getAuthUser(ctx);
    if (!user) {
      return { status: "unauthenticated" };
    }

    const application = await resolveApplicationForAuthUser(ctx, user);
    const review = application
      ? await ctx.db
          .query("applicationReviews")
          .withIndex("by_application", (q) => q.eq("applicationId", application._id))
          .unique()
      : null;

    const participant = await ctx.db
      .query("participants")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", user._id))
      .unique();
    const attendee = participant
      ? await ctx.db
        .query("checkedIn")
        .withIndex("by_participant", (q) => q.eq("participantId", participant._id))
        .unique()
      : null;

    const pendingDecisionEmail = application
      ? await openDecisionEmailForApplication(ctx, application._id)
      : null;
    const reviewStatus = applicantVisibleReviewStatus(review, pendingDecisionEmail);
    const visibleParticipant = applicantVisibleParticipant(participant, pendingDecisionEmail);

    if (!visibleParticipant || reviewStatus !== "accepted") {
      return { status: "not_eligible" };
    }

    if (attendee || isParticipantCheckedIn(visibleParticipant)) {
      return { status: "already_checked_in" };
    }

    const mediaDisclosure = await getParticipantMediaDisclosure(ctx, visibleParticipant._id);
    if (!hasAcceptedMediaDisclosure(mediaDisclosure)) {
      return { status: "media_disclosure_required" };
    }

    const qrCodeToken = normalizeRegistrationQr(visibleParticipant.qrCodeToken);
    if (!qrCodeToken) {
      return { status: "not_eligible" };
    }

    const eventConfig = await getEventConfigRow(ctx);
    const hackathonName = eventConfig?.name ?? DEFAULT_HACKATHON_NAME;
    const schedule = resolveHackathonTimelineSource(eventConfig);

    const firstName = application?.firstName?.trim() ?? "";
    const lastName = application?.lastName?.trim() ?? "";
    const displayName =
      [firstName, lastName].filter(Boolean).join(" ") ||
      user.name?.trim() ||
      normalizeEmail(user.email) ||
      "Participant";

    return {
      status: "ok",
      passInput: {
        serialNumber: formatAppleWalletSerialNumber(String(visibleParticipant._id)),
        displayName,
        email: normalizeEmail(user.email) ?? null,
        qrCodeToken,
        hackathonName,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
      },
    };
  },
});

/** Deletes a temporary `.pkpass` blob from Convex storage once its download window expires. */
export const deleteAppleWalletPassFile = internalMutation({
  args: {
    storageId: v.id("_storage"),
  },
  handler: async (ctx, { storageId }) => {
    try {
      await ctx.storage.delete(storageId);
    } catch {
      // Already deleted or absent.
    }
  },
});
