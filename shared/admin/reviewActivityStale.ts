/** Timing fields used to decide whether an active review claim can be reclaimed. */
export type ReviewActivityTiming = {
  expiresAt?: number;
  isStale?: boolean;
  lastActiveAt?: number | null;
  activeReviewStaleMs?: number;
};

/**
 * Prefer server-provided `expiresAt`, then `isStale`, then compute from last activity.
 * Keeps the UI usable when an older Convex deployment omits `expiresAt`.
 */
export function resolveReviewIsStale(activity: ReviewActivityTiming, now: number): boolean {
  if (activity.expiresAt !== undefined) {
    return now > activity.expiresAt;
  }
  if (activity.isStale !== undefined) {
    return activity.isStale;
  }
  if (
    activity.lastActiveAt != null &&
    activity.activeReviewStaleMs != null &&
    activity.activeReviewStaleMs > 0
  ) {
    return now > activity.lastActiveAt + activity.activeReviewStaleMs;
  }
  return false;
}
