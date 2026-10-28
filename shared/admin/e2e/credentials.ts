/** Fixed organizer accounts for VITE_E2E_MOCK browser tests only — not real deployments. */
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

/** Volunteer with check-in, food, and two event assignments for scanner tests. */
export const E2E_SCAN_VOLUNTEER = {
  email: "lead@e2e.hackuta.test",
  password: "E2eLeadVolunteer1!",
  name: "E2E Lead Volunteer",
  role: "volunteer" as const,
};

/**
 * Registration QR tokens seeded in the E2E mock store. `ready` and
 * `checkedIn` were replaced by badges at check-in, so they no longer scan;
 * `arrival` has not checked in, and `legacy` checked in before badges.
 */
export const E2E_QR_TOKENS = {
  ready: "a1".repeat(32),
  checkedIn: "b2".repeat(32),
  ineligible: "c3".repeat(32),
  unknown: "d4".repeat(32),
  arrival: "e5".repeat(32),
  legacy: "f6".repeat(32),
} as const;

/** Preprinted badge values seeded in the E2E mock store. `unused*` belong to nobody yet. */
export const E2E_BADGES = {
  ready: "HACKUTA-BADGE-0001",
  checkedIn: "HACKUTA-BADGE-0002",
  alex: "HACKUTA-BADGE-0003",
  retired: "HACKUTA-BADGE-0099",
  unused: "HACKUTA-BADGE-0101",
  unusedSecond: "HACKUTA-BADGE-0102",
} as const;

export const E2E_EVENTS = {
  workshop: { eventId: "e2e-event-workshop", name: "Intro to Hardware", pointsAwarded: 25 },
  panel: { eventId: "e2e-event-panel", name: "Career Panel", pointsAwarded: 10 },
} as const;

export const E2E_APPLICATION_IDS = {
  unreviewed: "e2e-app-unreviewed",
  underReview: "e2e-app-under-review",
  readyForDecision: "e2e-app-decision",
  accepted: "e2e-app-accepted",
} as const;
