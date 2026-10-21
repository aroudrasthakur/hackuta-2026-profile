import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { ensureParticipantForAcceptance } from "./participantCreation";

/**
 * Create the participant row for a confirmed acceptance.
 * Internal only: the public client cannot call this, so QR tokens are minted only
 * from the staff-gated acceptance transaction (or other internal callers).
 * Idempotent: returns the existing participant if the application already has one
 * and does not rotate `qrCodeToken`.
 * Reuses the applicant's existing `users` account; copies `foodRestriction` from `applications` at creation.
 */
export const createParticipantFromAcceptance = internalMutation({
  args: {
    applicationId: v.id("applications"),
    acceptedBy: v.id("admins"),
  },
  handler: async (ctx, { applicationId, acceptedBy }) => {
    const application = await ctx.db.get(applicationId);
    if (!application) {
      throw new Error("Application not found.");
    }

    const review = await ctx.db
      .query("applicationReviews")
      .withIndex("by_application", (q) => q.eq("applicationId", applicationId))
      .unique();
    if (review?.status !== "accepted") {
      throw new Error("Application has not been accepted.");
    }

    const admin = await ctx.db.get(acceptedBy);
    if (!admin?.active) {
      throw new Error("Accepting admin not found or inactive.");
    }

    const user = await ctx.db.get(application.authUserId);
    if (!user) {
      throw new Error("Applicant user account not found.");
    }

    const { participantId } = await ensureParticipantForAcceptance(ctx, {
      applicationId,
      authUserId: application.authUserId,
      acceptedBy,
      acceptedAt: review.completedAt ?? Date.now(),
    });
    return participantId;
  },
});
