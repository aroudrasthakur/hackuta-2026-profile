const DECISION_STATUSES = new Set([
  "accepted",
  "waitlisted",
  "rejected",
  "withdrawn",
]);

type ApplicantRegistration = {
  status: string;
  submittedAt?: number | null;
} | null;

export function getApplicantStatusLabel(registration: ApplicantRegistration) {
  if (!registration || registration.status === "draft" || !registration.submittedAt) {
    return null;
  }

  if (DECISION_STATUSES.has(registration.status)) {
    return registration.status.replace("-", " ");
  }

  return "Under review";
}
