import type { GenericId } from "convex/values";
import type { DocumentByName } from "convex/server";
import type { DataModel, MutationCtx } from "../lib/dataModel";
import { applicationFormWasSubmitted, getApplicationReview } from "../lib/applications";
import { adminError } from "../../shared/admin/errors";

type ApplicationReviewDoc = DocumentByName<DataModel, "applicationReviews">;
type AdminDoc = DocumentByName<DataModel, "admins">;

/** Shared inactivity window before another organizer may claim an active review. */
export const ACTIVE_REVIEW_STALE_MS = 30 * 60 * 1000;

export function isFinalReviewStatus(status: ApplicationReviewDoc["status"]) {
  return (
    status === "accepted" ||
    status === "rejected" ||
    status === "waitlisted" ||
    status === "withdrawn"
  );
}

export function reviewClaimExpiresAt(review: ApplicationReviewDoc) {
  return (review.lastActiveAt ?? review.startedAt ?? review.updatedAt) + ACTIVE_REVIEW_STALE_MS;
}

export function isReviewStale(review: ApplicationReviewDoc, now: number) {
  if (!review.reviewedBy || review.status !== "under_review") {
    return false;
  }
  return now > reviewClaimExpiresAt(review);
}

function isActiveReviewClaim(review: ApplicationReviewDoc, now: number) {
  return (
    review.status === "under_review" &&
    review.reviewedBy !== undefined &&
    !isReviewStale(review, now)
  );
}

/** True when another organizer holds a non-stale in-progress claim. */
export function isActiveReviewClaimHeldByOther(
  review: ApplicationReviewDoc,
  adminId: GenericId<"admins">,
  now: number,
) {
  return (
    isActiveReviewClaim(review, now) &&
    review.reviewedBy !== undefined &&
    review.reviewedBy !== adminId
  );
}

export type StartReviewClaimResult =
  | { outcome: "logged" }
  | { outcome: "refreshed" };

/**
 * Claims or resumes an in-progress review. State updates and optional audit log
 * are returned to the caller so `started_review` stays atomic with patches.
 */
export async function startReviewClaim(
  ctx: MutationCtx,
  args: {
    applicationId: GenericId<"applications">;
    admin: AdminDoc;
    now: number;
  },
): Promise<StartReviewClaimResult> {
  const application = await ctx.db.get(args.applicationId);
  if (!application || !applicationFormWasSubmitted(application)) {
    throw adminError("APPLICATION_NOT_FOUND");
  }

  const review = await getApplicationReview(ctx, args.applicationId);
  if (review && isFinalReviewStatus(review.status)) {
    throw adminError("REVIEW_FINALIZED");
  }

  if (review && isActiveReviewClaim(review, args.now)) {
    if (review.reviewedBy === args.admin._id) {
      await ctx.db.patch(review._id, {
        lastActiveAt: args.now,
        updatedAt: args.now,
      });
      return { outcome: "refreshed" };
    }
    throw adminError("REVIEW_CLAIMED");
  }

  const stale = review ? isReviewStale(review, args.now) : false;
  const switchingReviewer =
    review?.reviewedBy !== undefined && review.reviewedBy !== args.admin._id;
  const resetStartedAt = stale || switchingReviewer || !review?.startedAt;

  if (!review) {
    await ctx.db.insert("applicationReviews", {
      applicationId: args.applicationId,
      status: "under_review",
      reviewedBy: args.admin._id,
      startedAt: args.now,
      lastActiveAt: args.now,
      createdAt: args.now,
      updatedAt: args.now,
    });
    return { outcome: "logged" };
  }

  await ctx.db.patch(review._id, {
    status: "under_review",
    reviewedBy: args.admin._id,
    startedAt: resetStartedAt ? args.now : review.startedAt,
    lastActiveAt: args.now,
    updatedAt: args.now,
  });
  return { outcome: "logged" };
}
