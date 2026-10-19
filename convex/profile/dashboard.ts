import { query } from "../_generated/server";
import { applicationFormWasSubmitted, getAuthUser } from "../lib/applications";
import { getEventConfigRow } from "../lib/eventConfig";
import { DEFAULT_HACKATHON_NAME } from "../../shared/hackathon/eventDefaults";
import { normalizeEmail } from "../lib/normalizeEmail";

/** Participant-only dashboard payload; never exposes another user's data or tokens. */
export const getMyParticipantDashboard = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) {
      return null;
    }
    const authUserId = user._id;

    const application = await ctx.db
      .query("applications")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", authUserId))
      .unique();

    const review = application
      ? await ctx.db
          .query("applicationReviews")
          .withIndex("by_application", (q) => q.eq("applicationId", application._id))
          .unique()
      : null;

    const participant = await ctx.db
      .query("participants")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", authUserId))
      .unique();

    const eventConfig = await getEventConfigRow(ctx);
    const hackathonName = eventConfig?.name ?? DEFAULT_HACKATHON_NAME;

    const firstName = application?.firstName?.trim() ?? "";
    const lastName = application?.lastName?.trim() ?? "";
    const displayName =
      [firstName, lastName].filter(Boolean).join(" ") ||
      user.name?.trim() ||
      normalizeEmail(user.email) ||
      "Participant";

    const submitted = application ? applicationFormWasSubmitted(application) : false;
    const reviewStatus = review?.status ?? null;

    return {
      profile: {
        displayName,
        email: normalizeEmail(user.email),
      },
      application: application
        ? {
            submitted,
            submittedAt: application.submittedAt ?? null,
            school: application.school?.trim() || null,
          }
        : null,
      reviewStatus,
      participant: participant
        ? {
            qrCodeToken: participant.qrCodeToken,
            acceptedAt: participant.acceptedAt,
          }
        : null,
      hackathon: {
        name: hackathonName,
        startsAt: eventConfig?.startsAt ?? null,
        endsAt: eventConfig?.endsAt ?? null,
        decisionsReleasedAt: eventConfig?.decisionsReleasedAt ?? null,
        registrationOpensAt: eventConfig?.registrationOpensAt ?? null,
        registrationClosesAt: eventConfig?.registrationClosesAt ?? null,
      },
    };
  },
});
