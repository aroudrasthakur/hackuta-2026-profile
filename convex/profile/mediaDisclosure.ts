import { mutation } from "../_generated/server";
import type { GenericId } from "convex/values";
import { getAuthUser } from "../lib/applications";
import type { MutationCtx, QueryCtx } from "../lib/dataModel";
import { resolveApplicationForAuthUser } from "./applicationLookup";
import {
  applicantVisibleParticipant,
  applicantVisibleReviewStatus,
  openDecisionEmailForApplication,
} from "./openDecisionEmail";

export async function getParticipantMediaDisclosure(
  ctx: QueryCtx | MutationCtx,
  participantId: GenericId<"participants">,
) {
  return ctx.db
    .query("participantMediaDisclosures")
    .withIndex("by_participant", (q) => q.eq("participantId", participantId))
    .unique();
}

export function hasAcceptedMediaDisclosure(
  row: Awaited<ReturnType<typeof getParticipantMediaDisclosure>>,
) {
  return row !== null;
}

/**
 * Records a one-time media-disclosure acceptance for the signed-in accepted
 * participant. `acceptedAt` is stamped on the server. A second call returns
 * the existing row and does not overwrite the timestamp.
 */
export const acceptMyMediaDisclosure = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) {
      return { ok: false as const, code: "unauthenticated" as const };
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
      return { ok: false as const, code: "not_eligible" as const };
    }

    const existing = await getParticipantMediaDisclosure(ctx, visibleParticipant._id);
    if (existing) {
      return { ok: true as const, acceptedAt: existing.acceptedAt };
    }

    const acceptedAt = Date.now();
    await ctx.db.insert("participantMediaDisclosures", {
      participantId: visibleParticipant._id,
      acceptedAt,
    });
    return { ok: true as const, acceptedAt };
  },
});
