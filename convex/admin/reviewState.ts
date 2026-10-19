import type { DocumentByName } from "convex/server";
import type { GenericId } from "convex/values";
import type { DataModel } from "../lib/dataModel";

type ApplicationReviewDoc = DocumentByName<DataModel, "applicationReviews">;
type ReviewDecision = "accepted" | "rejected" | "waitlisted";

/** `applicationReviews` patch for a final decision made by the session admin. */
export function decisionPatch(
  review: ApplicationReviewDoc,
  adminId: GenericId<"admins">,
  status: ReviewDecision,
  now: number,
) {
  return {
    status,
    reviewedBy: adminId,
    startedAt: review.startedAt ?? now,
    lastActiveAt: now,
    completedAt: now,
    updatedAt: now,
  };
}
