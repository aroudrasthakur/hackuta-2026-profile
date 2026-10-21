export { openDecisionEmailForApplication } from "../admin/decisionEmailQueue";

type ReviewSnapshot = {
  status: string;
  startedAt?: number;
  lastActiveAt?: number;
} | null;

/**
 * Review status safe to show applicants. While a decision email is still queued,
 * held, or sending, the queued outcome must not appear on profile or participant UI.
 */
export function applicantVisibleReviewStatus(
  review: ReviewSnapshot,
  openQueue: { decision: string } | null,
): string | null {
  const status = review?.status ?? null;
  if (!openQueue) return status;

  if (status === openQueue.decision) {
    if (!review) return "unreviewed";
    if (status === "under_review" || status === "unreviewed") return status;
    return "under_review";
  }

  return status;
}

/** Hide participant check-in until an acceptance email has been released. */
export function applicantVisibleParticipant<T>(
  participant: T | null,
  openQueue: { decision: string } | null,
): T | null {
  if (!participant) return null;
  if (openQueue?.decision === "accepted") return null;
  return participant;
}
