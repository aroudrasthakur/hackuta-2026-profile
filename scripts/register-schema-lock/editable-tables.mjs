/** Tables stripped from profile schema.ts when comparing/hashing the register-owned portion. */
export const ADMIN_EDITABLE_TABLES = [
  "applicationReviews",
  "admins",
  "applicationReviewLogs",
  "participants",
  "checkedIn",
  "retiredBadgeTokens",
  "mealPeriods",
  "mealRedemptions",
  "events",
  "volunteerEventAccess",
  "participantEventAwards",
  "volunteerActionLogs",
  "staffConfigLogs",
  "adminAuthAccounts",
  "adminSessions",
  "decisionEmailQueue",
  "shopItems",
  "shopRedemptions",
  "shopFlashSales",
  "shopFlashSaleItems",
];

export const REFERENCE_EDITABLE_TABLES = ["applicationReviews"];

export const PROFILE_EDITABLE_TABLES = ["schedule", "participantMediaDisclosures"];
