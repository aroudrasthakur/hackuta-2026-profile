/** Fixed organizer accounts for VITE_E2E_MOCK browser tests only — not real deployments. */
export const E2E_REVIEWER = {
  email: "reviewer@e2e.hackuta.test",
  password: "E2eReviewer1!",
  name: "E2E Reviewer",
  role: "reviewer" as const,
};

export const E2E_ADMIN = {
  email: "admin@e2e.hackuta.test",
  password: "E2eAdmin1!",
  name: "E2E Admin",
  role: "admin" as const,
};

export const E2E_VOLUNTEER = {
  email: "volunteer@e2e.hackuta.test",
  password: "E2eVolunteer1!",
  name: "E2E Volunteer",
  role: "volunteer" as const,
};

export const E2E_APPLICATION_IDS = {
  unreviewed: "e2e-app-unreviewed",
  underReview: "e2e-app-under-review",
  readyForDecision: "e2e-app-decision",
  accepted: "e2e-app-accepted",
} as const;
