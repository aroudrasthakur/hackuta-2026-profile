import { v } from "convex/values";

/** Non-decision review activity recorded by `logApplicationReviewAction`. */
export const applicationReviewLogActivityAction = v.union(
  v.literal("viewed"),
  v.literal("started_review"),
  v.literal("review_ended"),
);

/** Decision events recorded by `setApplicationDecision`. */
export const applicationReviewLogDecisionAction = v.union(
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("waitlisted"),
);

/** Full append-only action union stored on `applicationReviewLogs.action`. */
export const applicationReviewLogAction = v.union(
  v.literal("viewed"),
  v.literal("started_review"),
  v.literal("review_ended"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("waitlisted"),
);
