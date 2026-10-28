import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { getAuthUser } from "../lib/applications";
import { normalizeEmail } from "../lib/normalizeEmail";
import { normalizeRegistrationQr } from "../../shared/admin/qrValues";
import { resolveApplicationForAuthUser } from "./applicationLookup";
import {
  applicantVisibleParticipant,
  applicantVisibleReviewStatus,
  openDecisionEmailForApplication,
} from "./openDecisionEmail";
import { isParticipantCheckedIn } from "./participantCheckIn";

export type AppleWalletPassDataInput = {
  serialNumber: string;
  displayName: string;
  qrCodeToken: string;
};

export type AppleWalletPassLookupResult =
  | { status: "unauthenticated" }
  | { status: "not_eligible" }
  | { status: "already_checked_in" }
  | { status: "ok"; passInput: AppleWalletPassDataInput };

/** Stable, unique pass serial number per participant. Never embeds the QR token. */
export function formatAppleWalletSerialNumber(participantId: string) {
  return `hackuta-2026-${participantId}`;
}

/**
 * Loads the signed-in participant's pre-check-in registration QR and display name
 * for server-side Apple Wallet pass generation via the wallet service.
 *
 * Rejects unauthenticated users, unaccepted/masked applications, and checked-in
 * participants (whose registration QR has been replaced by a physical badge).
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

    const pendingDecisionEmail = application
      ? await openDecisionEmailForApplication(ctx, application._id)
      : null;
    const reviewStatus = applicantVisibleReviewStatus(review, pendingDecisionEmail);
    const visibleParticipant = applicantVisibleParticipant(participant, pendingDecisionEmail);

    if (!visibleParticipant || reviewStatus !== "accepted") {
      return { status: "not_eligible" };
    }

    if (
      isParticipantCheckedIn(visibleParticipant) ||
      visibleParticipant.badgeQrCodeToken !== undefined
    ) {
      return { status: "already_checked_in" };
    }

    const qrCodeToken = normalizeRegistrationQr(visibleParticipant.qrCodeToken);
    if (!qrCodeToken) {
      return { status: "not_eligible" };
    }

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
        qrCodeToken,
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
