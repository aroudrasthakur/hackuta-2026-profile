/** UI state derived from the register's review status and the organizer's claim. */
export type QueueApplication = {
  reviewStatus: "unreviewed" | "under_review" | "accepted" | "rejected" | "waitlisted" | "withdrawn" | null;
  currentReviewerName: string | null;
  reviewClaim?: { reviewedBy: string; expiresAt?: number };
  /** Optional legacy hint when an older backend omits `reviewClaim.expiresAt`. */
  claimIsStale?: boolean;
};

function isClaimStale(application: QueueApplication, now: number) {
  if (application.reviewClaim?.expiresAt !== undefined) {
    return now > application.reviewClaim.expiresAt;
  }
  return application.claimIsStale === true;
}

export function queueReviewStatus(application: QueueApplication, now: number) {
  if (application.reviewStatus !== "under_review") return application.reviewStatus ?? "unreviewed";
  if (application.reviewClaim) {
    return isClaimStale(application, now) ? "stale" : "under_review";
  }
  return application.currentReviewerName ? "under_review" : "unreviewed";
}

export function needsApplicationReview(application: QueueApplication) {
  return application.reviewStatus === null || application.reviewStatus === "unreviewed" || application.reviewStatus === "under_review";
}

export function availableToReview(application: QueueApplication, staffAdminId: string, now: number) {
  if (!needsApplicationReview(application)) return false;
  return queueReviewStatus(application, now) !== "under_review" || application.reviewClaim?.reviewedBy === staffAdminId;
}
