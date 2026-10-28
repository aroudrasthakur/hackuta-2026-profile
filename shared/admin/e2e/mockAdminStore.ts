import { ADMIN_ERROR_MESSAGES, adminError } from "../errors.ts";
import { assertEventPoints, normalizeEventInput, type EventScheduleInput } from "../volunteerRules.ts";
import { normalizeBadgeQr, scanLookupCandidates } from "../qrValues.ts";
import {
  mockMealsMutation, mockMealsQuery, resetMockMeals, mockActiveMeals,
  getMockMeal, mockMealRedemption, recordMockMealRedemption, configureMockMeals, type MockMealScenario,
} from "./mockMeals.ts";
import { sampleResumeUrl } from "./resumeFixture.ts";
import {
  E2E_ADMIN,
  E2E_APPLICATION_IDS,
  E2E_BADGES,
  E2E_EVENTS,
  E2E_QR_TOKENS,
  E2E_REVIEWER,
  E2E_SCAN_VOLUNTEER,
  E2E_VOLUNTEER,
} from "./credentials.ts";

const ACTIVE_REVIEW_STALE_MS = 30 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

type StaffRole = "reviewer" | "admin" | "volunteer";

type StaffRecord = {
  adminId: string;
  email: string;
  name: string;
  role: StaffRole;
  active?: boolean;
  participantId?: string;
  canCheckIn?: boolean;
  canFoodCheckIn?: boolean;
  canRedeemShop?: boolean;
};

type ParticipantRecord = {
  participantId: string;
  applicationId: string;
  name: string;
  email: string;
  points: number;
  checkedInAt: number | null;
  foodCheckedInAt: number | null;
  badgeToken?: string;
  badge: { assignedAt: number; assignedBy: { adminId: string; name: string } | null } | null;
  volunteerAdminId?: string;
  awards: Array<{
    eventId: string;
    eventName: string;
    pointsAwarded: number;
    awardedAt: number;
    awardedBy: { adminId: string; name: string };
  }>;
};

type ApplicationRecord = {
  _id: string;
  _creationTime: number;
  authUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  school: string;
  createdAt: number;
  formSubmitted: true;
  submittedAt: number;
};

type ReviewRecord = {
  applicationId: string;
  status: string;
  reviewedBy?: string;
  startedAt?: number;
  lastActiveAt?: number;
  createdAt: number;
  updatedAt: number;
};

type LogRecord = {
  _id: string;
  applicationId: string;
  adminId: string;
  action: string;
  createdAt: number;
};

type SessionRecord = {
  sessionToken: string;
  adminId: string;
  expiresAt: number;
};

type ScanParticipantRecord = {
  participantId: string;
  /** Map key; kept as the participant's stable id in shop rows. */
  registrationToken: string;
  badgeToken?: string;
  retiredBadges?: string[];
  name: string;
  points: number;
  eligible: boolean;
  foodRestriction?: string;
  checkedInAt?: number;
  foodCheckedInAt?: number;
  awardedEventIds: Set<string>;
};

type EventRecord = {
  eventId: string;
  name: string;
  description?: string | undefined;
  pointsAwarded: number;
  active: boolean;
  startsAt: number;
  endsAt: number;
  createdAt: number;
  updatedAt: number;
};

type VolunteerActionLogRecord = {
  logId: string;
  actorAdminId: string;
  action: "check_in" | "food_check_in" | "point_scan" | "admin_adjust" | "badge_assigned" | "badge_replaced";
  participantName: string;
  eventId?: string;
  pointsDelta?: number;
  reason?: string;
  createdAt: number;
};

type StaffConfigLogRecord = {
  logId: string;
  actorAdminId: string;
  action: string;
  targetAdminId?: string;
  targetEventId?: string;
  details?: Record<string, unknown>;
  createdAt: number;
};

let revision = 0;
const listeners = new Set<() => void>();

function bump() {
  revision += 1;
  for (const listener of listeners) listener();
}

export function subscribeE2eMockStore(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getE2eMockRevision() {
  return revision;
}

const staffById = new Map<string, StaffRecord>();
const staffByEmail = new Map<string, StaffRecord>();
const sessions = new Map<string, SessionRecord>();
const applications = new Map<string, ApplicationRecord>();
const reviews = new Map<string, ReviewRecord>();
const participants = new Map<string, ParticipantRecord>();
const logs: LogRecord[] = [];
const decisionQueue = new Map<string, {
  decision: "accepted" | "rejected" | "waitlisted";
  status: "queued" | "held" | "sending" | "sent" | "failed";
  queuedAt: number;
  errorMessage?: string;
}>();
export type DecisionQueueScenario = "mixed" | "sending" | "empty" | "loading" | "error" | "ready" | "long-content";
let decisionQueueScenario: DecisionQueueScenario = "ready";
let nextLogId = 100;
const participantsByToken = new Map<string, ScanParticipantRecord>();
/** Badges retired from roster participants by an admin replacement. */
const retiredRosterBadges = new Set<string>();
const events = new Map<string, EventRecord>();
const eventAssignments = new Map<string, string[]>();
const volunteerActionLogs: VolunteerActionLogRecord[] = [];
const staffConfigLogs: StaffConfigLogRecord[] = [];
let nextEventId = 1;

// --- Shop (mirrors convex/admin/shop*.ts closely enough for browser tests) ---

type ShopItemRecord = {
  itemId: string;
  name: string;
  description: string;
  pointsCost: number;
  stockQuantity: number;
  lowStockThreshold: number | null;
  status: "active" | "inactive" | "archived";
  featured: boolean;
  createdAt: number;
  updatedAt: number;
};

type ShopSaleRecord = {
  flashSaleId: string;
  title: string;
  message: string;
  startsAt: number;
  endsAt: number;
  cancelledAt: number | null;
  items: Array<{ itemId: string; salePointsCost: number }>;
  createdAt: number;
};

type ShopRedemptionRecord = {
  redemptionId: string;
  participantToken: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unitPointsCost: number;
  basePointsCost: number;
  totalPointsSpent: number;
  pointsBefore: number;
  pointsAfter: number;
  redeemedBy: string;
  redeemedAt: number;
  flashSaleId: string | null;
  idempotencyKey: string;
  refund: { refundedBy: string; refundedAt: number; reason: string; restocked: boolean; pointsRestored: number } | null;
};

type ShopAdjustmentRecord = {
  adjustmentId: string;
  itemId: string;
  kind: "initial" | "manual" | "restock" | "purchase" | "refund_restock";
  previousQuantity: number;
  newQuantity: number;
  delta: number;
  reason: string | null;
  actorAdminId: string;
  createdAt: number;
};

type MockNotificationRecord = {
  notificationId: string;
  title: string;
  message: string;
  type: "general" | "event" | "reminder" | "flash_sale" | "important";
  status: "draft" | "scheduled" | "published" | "cancelled";
  scheduledAt: number | null;
  publishedAt: number | null;
  expiresAt: number | null;
  cancelledAt: number | null;
  linkUrl: string | null;
  linkLabel: string | null;
  relatedEventId: string | null;
  relatedFlashSaleId: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
};

const shopItems = new Map<string, ShopItemRecord>();
const shopSales: ShopSaleRecord[] = [];
const shopRedemptions: ShopRedemptionRecord[] = [];
const shopAdjustments: ShopAdjustmentRecord[] = [];
const mockNotifications: MockNotificationRecord[] = [];
let nextShopId = 1;
/** When set, the next purchase is saved but its response is lost, like a dropped connection. */
let dropNextPurchaseResponse = false;

/** Shop item and sale ids seeded for browser tests. */
export const E2E_SHOP = {
  tee: "e2e-item-tee",
  stickers: "e2e-item-stickers",
  bottle: "e2e-item-bottle",
  mug: "e2e-item-mug",
  keyboard: "e2e-item-keyboard",
  sale: "e2e-sale-midnight",
} as const;

const SHOP_MAX_QUANTITY = 10;

function seedStaff(record: StaffRecord) {
  staffById.set(record.adminId, record);
  staffByEmail.set(record.email, record);
}

function seedApplication(
  id: string,
  fields: Omit<ApplicationRecord, "_id" | "_creationTime" | "formSubmitted">,
  review?: Omit<ReviewRecord, "applicationId">,
) {
  applications.set(id, {
    _id: id,
    _creationTime: fields.createdAt,
    formSubmitted: true,
    ...fields,
  });
  if (review) {
    reviews.set(id, { applicationId: id, ...review });
  }
}

function resetStore() {
  resetMockMeals();
  staffById.clear();
  staffByEmail.clear();
  sessions.clear();
  applications.clear();
  reviews.clear();
  participants.clear();
  logs.length = 0;
  decisionQueue.clear();
  decisionQueueScenario = "ready";
  nextLogId = 100;
  participantsByToken.clear();
  retiredRosterBadges.clear();
  events.clear();
  eventAssignments.clear();
  volunteerActionLogs.length = 0;
  staffConfigLogs.length = 0;
  nextEventId = 1;

  seedStaff({
    adminId: "e2e-admin-reviewer",
    email: E2E_REVIEWER.email,
    name: E2E_REVIEWER.name,
    role: E2E_REVIEWER.role,
  });
  seedStaff({
    adminId: "e2e-admin-admin",
    email: E2E_ADMIN.email,
    name: E2E_ADMIN.name,
    role: E2E_ADMIN.role,
  });
  seedStaff({
    adminId: "e2e-admin-volunteer",
    email: E2E_VOLUNTEER.email,
    name: E2E_VOLUNTEER.name,
    role: E2E_VOLUNTEER.role,
    canCheckIn: true,
    canFoodCheckIn: false,
  });
  seedStaff({
    adminId: "e2e-admin-lead",
    email: E2E_SCAN_VOLUNTEER.email,
    name: E2E_SCAN_VOLUNTEER.name,
    role: E2E_SCAN_VOLUNTEER.role,
    canCheckIn: true,
    canFoodCheckIn: true,
    canRedeemShop: true,
  });

  const now = Date.now();
  for (const event of Object.values(E2E_EVENTS)) {
    events.set(event.eventId, {
      ...event, active: true, startsAt: now - 60_000, endsAt: now + 3_600_000, createdAt: now - 86_400_000, updatedAt: now - 86_400_000,
    });
  }
  seedShop(now);
  eventAssignments.set("e2e-admin-lead", Object.values(E2E_EVENTS).map(({ eventId }) => eventId));
  volunteerActionLogs.push(
    { logId: "e2e-action-seed-1", actorAdminId: "e2e-admin-lead", action: "check_in", participantName: "Morgan Present", createdAt: now - 600_000 },
    {
      logId: "e2e-action-seed-2", actorAdminId: "e2e-admin-lead", action: "point_scan", participantName: "Morgan Present",
      eventId: E2E_EVENTS.panel.eventId, pointsDelta: E2E_EVENTS.panel.pointsAwarded, createdAt: now - 500_000,
    },
  );
  const seedScanParticipant = (record: ScanParticipantRecord) => participantsByToken.set(record.registrationToken, record);
  seedScanParticipant({
    participantId: "e2e-participant-ready",
    registrationToken: E2E_QR_TOKENS.ready,
    badgeToken: E2E_BADGES.ready,
    name: "Riley Ready",
    points: 1250,
    eligible: true,
    foodRestriction: "Vegetarian; Allergies: peanuts",
    checkedInAt: now - 900_000,
    awardedEventIds: new Set(),
  });
  seedScanParticipant({
    participantId: "e2e-participant-present",
    registrationToken: E2E_QR_TOKENS.checkedIn,
    badgeToken: E2E_BADGES.checkedIn,
    retiredBadges: [E2E_BADGES.retired],
    name: "Morgan Present",
    points: 40,
    eligible: true,
    checkedInAt: now - 600_000,
    foodCheckedInAt: now - 300_000,
    awardedEventIds: new Set([E2E_EVENTS.panel.eventId]),
  });
  seedScanParticipant({
    participantId: "e2e-participant-arrival",
    registrationToken: E2E_QR_TOKENS.arrival,
    name: "Avery Arrival",
    points: 0,
    eligible: true,
    awardedEventIds: new Set(),
  });
  seedScanParticipant({
    participantId: "e2e-participant-legacy",
    registrationToken: E2E_QR_TOKENS.legacy,
    name: "Lee Legacy",
    points: 0,
    eligible: true,
    checkedInAt: now - 1_200_000,
    awardedEventIds: new Set(),
  });
  seedScanParticipant({
    participantId: "e2e-participant-pending",
    registrationToken: E2E_QR_TOKENS.ineligible,
    name: "Pat Pending",
    points: 0,
    eligible: false,
    awardedEventIds: new Set(),
  });
  seedApplication(E2E_APPLICATION_IDS.unreviewed, {
    authUserId: "e2e-user-1",
    email: "taylor.unreviewed@example.com",
    firstName: "Taylor",
    lastName: "Unreviewed",
    school: "Example University",
    createdAt: now - 3_000,
    submittedAt: now - 2_000,
  }, { status: "under_review", createdAt: now, updatedAt: now });

  seedApplication(
    E2E_APPLICATION_IDS.underReview,
    {
      authUserId: "e2e-user-2",
      email: "jordan.review@example.com",
      firstName: "Jordan",
      lastName: "Review",
      school: "North Texas College",
      createdAt: now - 2_000,
      submittedAt: now - 1_500,
    },
    {
      status: "under_review",
      reviewedBy: "e2e-admin-reviewer",
      startedAt: now - 600_000,
      lastActiveAt: now - 300_000,
      createdAt: now - 600_000,
      updatedAt: now - 300_000,
    },
  );

  seedApplication(
    E2E_APPLICATION_IDS.readyForDecision,
    {
      authUserId: "e2e-user-3",
      email: "casey.decision@example.com",
      firstName: "Casey",
      lastName: "Decision",
      school: "Tech Institute",
      createdAt: now - 1_000,
      submittedAt: now - 500,
    },
    {
      status: "under_review",
      reviewedBy: "e2e-admin-reviewer",
      startedAt: now - 120_000,
      lastActiveAt: now - 60_000,
      createdAt: now - 120_000,
      updatedAt: now - 60_000,
    },
  );

  seedApplication(
    E2E_APPLICATION_IDS.accepted,
    {
      authUserId: "e2e-user-4",
      email: "alex.accepted@example.com",
      firstName: "Alex",
      lastName: "Accepted",
      school: "State University",
      createdAt: now - 5_000,
      submittedAt: now - 4_000,
    },
    {
      status: "accepted",
      reviewedBy: "e2e-admin-admin",
      startedAt: now - 3_000,
      lastActiveAt: now - 2_000,
      createdAt: now - 3_000,
      updatedAt: now - 2_000,
    },
  );

  logs.push({
    _id: "e2e-seed-log-accepted",
    applicationId: E2E_APPLICATION_IDS.accepted,
    adminId: "e2e-admin-admin",
    action: "accepted",
    createdAt: now - 2_000,
  });
  participants.set("e2e-participant-accepted", {
    participantId: "e2e-participant-accepted",
    applicationId: E2E_APPLICATION_IDS.accepted,
    name: "Alex Accepted",
    email: "alex.accepted@example.com",
    points: 20,
    checkedInAt: now - 1_800_000,
    foodCheckedInAt: null,
    badgeToken: E2E_BADGES.alex,
    badge: { assignedAt: now - 1_800_000, assignedBy: { adminId: "e2e-admin-lead", name: E2E_SCAN_VOLUNTEER.name } },
    awards: [],
  });

  bump();
}

resetStore();

export function resetE2eMockStore() {
  resetStore();
}

/** Saves the next shop purchase but fails its response, so a retry must come back as a duplicate. */
export function dropNextE2eShopPurchaseResponse() {
  dropNextPurchaseResponse = true;
}

/** Deterministic browser fixtures; exposed only when VITE_E2E_MOCK is enabled. */
export function configureE2eDecisionQueue(scenario: DecisionQueueScenario) {
  decisionQueueScenario = scenario;
  if (scenario === "long-content") {
    for (const staff of staffById.values()) staff.name = "Alexandria Montgomery-Wellington, HackUTA Operations";
    for (const application of applications.values()) {
      application.lastName = "Montgomery-Wellington-With-A-Very-Long-Family-Name";
      application.email = `${"longemail".repeat(8)}@example.com`;
      application.school = "The International University of Engineering, Technology, and Applied Sciences";
    }
  }
  if (scenario === "mixed" || scenario === "sending" || scenario === "empty") {
    decisionQueue.clear();
    if (scenario !== "empty") {
      const now = Date.now();
      decisionQueue.set(E2E_APPLICATION_IDS.readyForDecision, { decision: "accepted", status: scenario === "sending" ? "sending" : "queued", queuedAt: now });
      decisionQueue.set(E2E_APPLICATION_IDS.underReview, { decision: "rejected", status: "held", queuedAt: now - 1000 });
      decisionQueue.set(E2E_APPLICATION_IDS.unreviewed, { decision: "waitlisted", status: "failed", queuedAt: now - 2000, errorMessage: "Email service unavailable. Retry this delivery." });
      decisionQueue.set(E2E_APPLICATION_IDS.accepted, { decision: "accepted", status: "sent", queuedAt: now - 3000 });
    }
  }
  bump();
}

function adminFromSessionToken(sessionToken: string) {
  const embedded = /^e2e-session-(e2e-admin-(?:reviewer|admin|volunteer|lead))-(\d+)$/.exec(sessionToken);
  if (embedded?.[1]) {
    if (Number(embedded[2]) + SESSION_TTL_MS <= Date.now()) return null;
    const admin = staffById.get(embedded[1]);
    if (admin) return admin;
  }
  const session = sessions.get(sessionToken);
  if (!session || session.expiresAt <= Date.now()) {
    return null;
  }
  return staffById.get(session.adminId) ?? null;
}

function requireSession(sessionToken: string) {
  const admin = adminFromSessionToken(sessionToken);
  if (!admin) {
    throw adminError("NOT_AUTHENTICATED");
  }
  return admin;
}

function requireVolunteer(sessionToken: string) {
  const staff = requireSession(sessionToken);
  if (staff.role !== "volunteer" && staff.role !== "admin") throw adminError("VOLUNTEER_ONLY");
  return staff;
}

function assignedEvents(staff: StaffRecord) {
  if (staff.role === "admin") {
    return [...events.values()]
      .filter((event) => event.active)
      .sort((a, b) => a.startsAt - b.startsAt || a.name.localeCompare(b.name));
  }
  return (eventAssignments.get(staff.adminId) ?? [])
    .map((eventId) => events.get(eventId))
    .filter((event): event is EventRecord => event?.active === true);
}

function paginate<T>(rows: T[], args: Record<string, unknown>) {
  const paginationOpts = args.paginationOpts as { numItems: number; cursor: string | null };
  const start = Number(paginationOpts.cursor ?? 0);
  const end = start + paginationOpts.numItems;
  const done = end >= rows.length;
  return { page: rows.slice(start, end), isDone: done, continueCursor: done ? null : String(end) };
}

function staffName(adminId: string) {
  return staffById.get(adminId)?.name ?? "Unknown staff";
}

function eventPointsLocked(eventId: string) {
  return [...participantsByToken.values()].some((participant) => participant.awardedEventIds.has(eventId));
}

function volunteerRow(volunteer: StaffRecord) {
  const linked = volunteer.participantId ? participants.get(volunteer.participantId) : undefined;
  return {
    adminId: volunteer.adminId,
    name: volunteer.name,
    email: volunteer.email,
    active: volunteer.active !== false,
    participant: volunteer.participantId ? { participantId: volunteer.participantId, name: linked?.name ?? null } : null,
    canCheckIn: volunteer.canCheckIn === true,
    canFoodCheckIn: volunteer.canFoodCheckIn === true,
    canRedeemShop: volunteer.canRedeemShop === true,
    events: (eventAssignments.get(volunteer.adminId) ?? []).flatMap((eventId) => {
      const event = events.get(eventId);
      return event ? [{ eventId, name: event.name, active: event.active }] : [];
    }),
    createdAt: 0,
    updatedAt: 0,
  };
}

function eventRow(event: EventRecord) {
  return {
    eventId: event.eventId,
    name: event.name,
    description: event.description ?? null,
    pointsAwarded: event.pointsAwarded,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    active: event.active,
    pointsLocked: eventPointsLocked(event.eventId),
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function logStaffConfig(record: Omit<StaffConfigLogRecord, "logId" | "createdAt">) {
  staffConfigLogs.push({ ...record, logId: `e2e-config-${nextLogId++}`, createdAt: Date.now() });
}

function logVolunteerAction(record: Omit<VolunteerActionLogRecord, "logId" | "createdAt">) {
  volunteerActionLogs.push({ ...record, logId: `e2e-action-${nextLogId++}`, createdAt: Date.now() });
}

type MockScan =
  | { kind: "registration" | "badge" | "registration_replaced"; participant: ScanParticipantRecord }
  | { kind: "badge_retired" | "not_found" };

/** Same classification as `resolveScannedQr`. */
function resolveMockScan(raw: string): MockScan {
  const candidates = scanLookupCandidates(raw);
  const rows = [...participantsByToken.values()];
  for (const value of candidates) {
    const badge = rows.find((row) => row.badgeToken === value);
    if (badge) return { kind: "badge", participant: badge };
    const registration = rows.find((row) => row.registrationToken === value);
    if (registration) return { kind: registration.badgeToken === undefined ? "registration" : "registration_replaced", participant: registration };
  }
  if (candidates.some((value) => rows.some((row) => row.retiredBadges?.includes(value)))) return { kind: "badge_retired" };
  return { kind: "not_found" };
}

/** Same as `resolveBadgeHolder`: only an assigned badge resolves. */
function mockBadgeHolder(raw: string) {
  const scanned = resolveMockScan(raw);
  if (scanned.kind === "badge") return { participant: scanned.participant };
  if (scanned.kind === "registration") {
    return { failure: scanned.participant.checkedInAt === undefined ? "participant_not_checked_in" as const : "badge_not_assigned" as const };
  }
  if (scanned.kind === "registration_replaced") return { failure: "registration_qr_replaced" as const };
  if (scanned.kind === "badge_retired") return { failure: "badge_retired" as const };
  return { failure: "qr_not_found" as const };
}

type MockBadgeConflict = "badge_invalid" | "badge_is_registration" | "badge_in_use" | "badge_retired";

/** Same as `checkBadgeAvailable`, across scan and roster participants. */
function mockBadgeConflict(raw: string): { badge: string } | { conflict: MockBadgeConflict } {
  const badge = normalizeBadgeQr(raw);
  if (badge === null) return { conflict: "badge_invalid" as const };
  const scanned = resolveMockScan(badge);
  if (scanned.kind === "registration" || scanned.kind === "registration_replaced") return { conflict: "badge_is_registration" as const };
  if (scanned.kind === "badge" || [...participants.values()].some((row) => row.badgeToken === badge)) return { conflict: "badge_in_use" as const };
  if (scanned.kind === "badge_retired" || retiredRosterBadges.has(badge)) return { conflict: "badge_retired" as const };
  return { badge };
}

/** Same capability, assignment, badge, and eligibility order as the Convex scan functions. */
function scanTarget(staff: StaffRecord, args: Record<string, unknown>, purpose: string) {
  const isAdmin = staff.role === "admin";
  if (purpose === "food_check_in" && !isAdmin && staff.canFoodCheckIn !== true) return { failure: "not_authorized" as const };
  if (purpose === "shop" && !isAdmin && staff.canRedeemShop !== true) return { failure: "not_authorized" as const };
  let event: EventRecord | undefined;
  if (purpose === "point_scan") {
    const eventId = String(args.eventId ?? "");
    const hasAccess = isAdmin || (eventAssignments.get(staff.adminId) ?? []).includes(eventId);
    event = hasAccess ? events.get(eventId) : undefined;
    if (!event) return { failure: "event_denied" as const };
    if (!event.active) return { failure: "event_inactive" as const };
  }
  const found = mockBadgeHolder(String(args.qrCodeToken ?? ""));
  if ("failure" in found) return { failure: found.failure };
  const { participant } = found;
  if (!participant.eligible) return { failure: "participant_not_eligible" as const };
  return { participant, event };
}

/** Mirrors `badgeCheckIn.ts`: registration step, then badge step, then the atomic check-in. */
function mockCheckIn(staff: StaffRecord, args: Record<string, unknown>, stage: "registration" | "badge" | "commit") {
  if (staff.role !== "admin" && staff.canCheckIn !== true) return { status: "not_authorized" };
  const registrationRaw = String(args.registrationQrCodeToken ?? "");
  const badgeRaw = String(args.badgeQrCodeToken ?? "");
  const scanned = resolveMockScan(registrationRaw);
  if (stage === "commit" && scanned.kind === "registration_replaced" && scanned.participant.badgeToken === normalizeBadgeQr(badgeRaw)) {
    return { status: "already_checked_in", participant: { name: scanned.participant.name, checkedInAt: scanned.participant.checkedInAt ?? null } };
  }
  if (!("participant" in scanned)) return { status: "qr_not_found" };
  const { participant } = scanned;
  const summary = { name: participant.name, checkedInAt: participant.checkedInAt ?? null };
  if (scanned.kind === "registration_replaced") return { status: "registration_qr_used", participant: summary };
  if (!participant.eligible) return { status: "participant_not_eligible" };
  if (scanned.kind === "badge" || participant.checkedInAt !== undefined) return { status: "already_checked_in", participant: summary };
  if (stage === "registration") return { status: "ok", participant: { name: participant.name } };
  const checked = mockBadgeConflict(badgeRaw);
  if ("conflict" in checked) return { status: checked.conflict };
  if (stage === "badge") return { status: "ok", participant: { name: participant.name } };
  const now = Date.now();
  participant.badgeToken = checked.badge;
  participant.checkedInAt = now;
  logVolunteerAction({ actorAdminId: staff.adminId, action: "check_in", participantName: participant.name });
  bump();
  return { status: "success", checkedInAt: now };
}

export function configureE2eMeals(scenario: MockMealScenario) {
  configureMockMeals(scenario);
  bump();
}

function runMockMealScan(staff: StaffRecord, args: Record<string, unknown>, redeem: boolean) {
  const target = scanTarget(staff, args, "food_check_in");
  if ("failure" in target) return { status: target.failure === "participant_not_eligible" ? "participant_ineligible" : target.failure };
  const meal = getMockMeal(String(args.mealPeriodId ?? ""));
  const now = Date.now();
  if (!meal?.active) return { status: "meal_not_active" };
  if (now < meal.startsAt) return { status: "meal_not_started" };
  if (now >= meal.endsAt) return { status: "meal_ended" };
  const selected = { mealPeriodId: meal._id, name: meal.name };
  const previous = mockMealRedemption(meal._id, target.participant.name);
  if (!redeem) return {
    status: "ok", purpose: "food_check_in", meal: selected,
    participant: { name: target.participant.name, alreadyRedeemed: previous !== undefined,
      redeemedAt: previous?.redeemedAt ?? null, dietaryInfo: target.participant.foodRestriction ?? null },
  };
  if (previous) return { status: "already_redeemed", redeemedAt: previous.redeemedAt, meal: selected };
  recordMockMealRedemption(meal._id, target.participant.name, staff.name, now);
  bump();
  return { status: "success", redeemedAt: now, meal: selected };
}

function requireReviewer(sessionToken: string) {
  const staff = requireSession(sessionToken);
  if (staff.role === "volunteer") throw adminError("NOT_AUTHORIZED");
  return staff;
}

function requireAdmin(sessionToken: string) {
  const admin = requireSession(sessionToken);
  if (admin.role !== "admin") {
    throw adminError("ADMIN_ONLY");
  }
  return admin;
}

function isFinalStatus(status: string) {
  return status === "accepted" || status === "rejected" || status === "waitlisted";
}

function reviewActivity(review: ReviewRecord | undefined, now: number) {
  if (!review) {
    return {
      reviewedBy: null,
      currentReviewerName: null,
      startedAt: null,
      lastActiveAt: null,
      isFinal: false,
      isStale: false,
      activeReviewStaleMs: ACTIVE_REVIEW_STALE_MS,
    };
  }
  const reviewer = review.reviewedBy ? staffById.get(review.reviewedBy) : undefined;
  const lastActiveAt = review.lastActiveAt ?? null;
  const isStale =
    review.status === "under_review" &&
    lastActiveAt !== null &&
    now - lastActiveAt > ACTIVE_REVIEW_STALE_MS;
  return {
    reviewedBy: review.reviewedBy ?? null,
    currentReviewerName: reviewer?.name ?? null,
    startedAt: review.startedAt ?? null,
    lastActiveAt,
    isFinal: isFinalStatus(review.status),
    isStale,
    ...(review.status === "under_review" && review.reviewedBy ? { expiresAt: (review.lastActiveAt ?? review.startedAt ?? review.updatedAt) + ACTIVE_REVIEW_STALE_MS } : {}),
    activeReviewStaleMs: ACTIVE_REVIEW_STALE_MS,
  };
}

export function e2eMockSignIn(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const staff = staffByEmail.get(normalized);
  const valid =
    (normalized === E2E_REVIEWER.email && password === E2E_REVIEWER.password) ||
    (normalized === E2E_ADMIN.email && password === E2E_ADMIN.password) ||
    (normalized === E2E_VOLUNTEER.email && password === E2E_VOLUNTEER.password) ||
    (normalized === E2E_SCAN_VOLUNTEER.email && password === E2E_SCAN_VOLUNTEER.password);
  if (!staff || !valid) {
    return {
      ok: false as const,
      code: "INVALID_CREDENTIALS" as const,
      error: ADMIN_ERROR_MESSAGES.INVALID_CREDENTIALS,
    };
  }
  const sessionToken = `e2e-session-${staff.adminId}-${Date.now()}`;
  sessions.set(sessionToken, {
    sessionToken,
    adminId: staff.adminId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  bump();
  return {
    ok: true as const,
    sessionToken,
    expiresAt: sessions.get(sessionToken)!.expiresAt,
  };
}

export function e2eMockSignOut(sessionToken: string) {
  sessions.delete(sessionToken);
  bump();
  return { ok: true as const };
}

export function e2eMockRunQuery(path: string, args: Record<string, unknown>) {
  const sessionToken = String(args.sessionToken ?? "");
  if (path.startsWith("admin/meals:")) {
    requireAdmin(sessionToken);
    return mockMealsQuery(path, args);
  }

  switch (path) {
    case "admin/volunteerScan:listActiveMealPeriods": {
      const staff = requireVolunteer(sessionToken);
      return staff.role === "admin" || staff.canFoodCheckIn === true ? mockActiveMeals() : [];
    }
    case "admin/volunteerScan:listMyScanOptions": {
      const admin = requireVolunteer(sessionToken);
      const isAdmin = admin.role === "admin";
      return {
        canCheckIn: isAdmin || admin.canCheckIn === true,
        canFoodCheckIn: isAdmin || admin.canFoodCheckIn === true,
        canRedeemShop: isAdmin || admin.canRedeemShop === true,
        events: assignedEvents(admin).map(({ eventId, name, pointsAwarded, startsAt, endsAt }) => ({ eventId, name, pointsAwarded, startsAt, endsAt })),
      };
    }
    case "admin/auth:getCurrentStaff": {
      const admin = adminFromSessionToken(sessionToken);
      if (!admin) return null;
      return {
        adminId: admin.adminId,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        canCheckIn: admin.canCheckIn === true,
        canFoodCheckIn: admin.canFoodCheckIn === true,
        canRedeemShop: admin.canRedeemShop === true,
        expiresAt: Number(sessionToken.split("-").pop()) + SESSION_TTL_MS,
      };
    }
    case "admin/volunteers:listVolunteers": {
      requireAdmin(sessionToken);
      const volunteers = [...staffById.values()].filter((staff) => staff.role === "volunteer").map(volunteerRow);
      return paginate(volunteers, args);
    }
    case "admin/volunteers:getVolunteer": {
      requireAdmin(sessionToken);
      const volunteer = staffById.get(String(args.volunteerAdminId ?? ""));
      return volunteer?.role === "volunteer" ? volunteerRow(volunteer) : null;
    }
    case "admin/volunteers:listVolunteerActionLogs": {
      requireAdmin(sessionToken);
      const volunteerAdminId = typeof args.volunteerAdminId === "string" ? args.volunteerAdminId : undefined;
      const action = typeof args.action === "string" ? args.action : undefined;
      const rows = volunteerActionLogs
        .filter((log) => (!volunteerAdminId || log.actorAdminId === volunteerAdminId) && (!action || log.action === action))
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((log) => ({
          logId: log.logId,
          actor: { adminId: log.actorAdminId, name: staffName(log.actorAdminId) },
          action: log.action,
          participant: { participantId: `e2e-participant-${log.participantName}`, name: log.participantName },
          event: log.eventId ? { eventId: log.eventId, name: events.get(log.eventId)?.name ?? null } : null,
          pointsDelta: log.pointsDelta ?? null,
          reason: log.reason ?? null,
          createdAt: log.createdAt,
        }));
      return paginate(rows, args);
    }
    case "admin/volunteers:listStaffConfigLogs": {
      requireAdmin(sessionToken);
      const targetAdminId = typeof args.targetAdminId === "string" ? args.targetAdminId : undefined;
      const rows = staffConfigLogs
        .filter((log) => !targetAdminId || log.targetAdminId === targetAdminId)
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((log) => ({
          logId: log.logId,
          actor: { adminId: log.actorAdminId, name: staffName(log.actorAdminId) },
          action: log.action,
          target: log.targetAdminId ? { adminId: log.targetAdminId, name: staffName(log.targetAdminId) } : null,
          event: log.targetEventId ? { eventId: log.targetEventId, name: events.get(log.targetEventId)?.name ?? null } : null,
          participant: null,
          details: log.details ?? null,
          createdAt: log.createdAt,
        }));
      return paginate(rows, args);
    }
    case "admin/events:listEvents": {
      requireAdmin(sessionToken);
      return paginate([...events.values()].sort((left, right) => right.createdAt - left.createdAt).map(eventRow), args);
    }
    case "admin/applications:listSubmittedApplications": {
      requireReviewer(sessionToken);
      return [...applications.values()]
        .map((application) => {
          const review = reviews.get(application._id);
          const reviewer = review?.reviewedBy ? staffById.get(review.reviewedBy) : undefined;
          return {
            applicationId: application._id,
            email: application.email,
            applicantName: `${application.firstName} ${application.lastName}`,
            school: application.school,
            submittedAt: application.submittedAt,
            reviewStatus: review?.status ?? null,
            currentReviewerName: reviewer?.name ?? null,
            ...(review?.status === "under_review" && review.reviewedBy ? {
              reviewClaim: { reviewedBy: review.reviewedBy, expiresAt: (review.lastActiveAt ?? review.startedAt ?? review.updatedAt) + ACTIVE_REVIEW_STALE_MS },
            } : {}),
          };
        })
        .sort((left, right) => (right.submittedAt ?? 0) - (left.submittedAt ?? 0));
    }
    case "admin/participantsAdmin:listParticipants": {
      requireAdmin(sessionToken);
      const search = String(args.search ?? "").trim().toLowerCase();
      const checkedIn = typeof args.checkedIn === "boolean" ? args.checkedIn : undefined;
      const foodRedeemed = typeof args.foodRedeemed === "boolean" ? args.foodRedeemed : undefined;
      const volunteerStatus = String(args.volunteerStatus ?? "");
      const paginationOpts = args.paginationOpts as { numItems: number; cursor: string | null };
      const filtered = [...participants.values()].filter((participant) => {
        const volunteer = participant.volunteerAdminId ? staffById.get(participant.volunteerAdminId) : undefined;
        if (search && !participant.name.toLowerCase().includes(search) && !participant.email.toLowerCase().includes(search)) return false;
        if (checkedIn !== undefined && (participant.checkedInAt !== null) !== checkedIn) return false;
        if (foodRedeemed !== undefined && (participant.foodCheckedInAt !== null) !== foodRedeemed) return false;
        if (volunteerStatus === "none" && volunteer) return false;
        if (volunteerStatus === "linked" && !volunteer) return false;
        if (volunteerStatus === "active" && (!volunteer || volunteer.active === false)) return false;
        if (volunteerStatus === "inactive" && (!volunteer || volunteer.active !== false)) return false;
        return true;
      });
      const start = Number(paginationOpts.cursor ?? 0);
      const end = start + paginationOpts.numItems;
      const page = filtered.slice(start, end).map((participant) => {
        const volunteer = participant.volunteerAdminId ? staffById.get(participant.volunteerAdminId) : undefined;
        return {
          participantId: participant.participantId,
          name: participant.name,
          email: participant.email,
          points: participant.points,
          checkedInAt: participant.checkedInAt,
          foodCheckedInAt: participant.foodCheckedInAt,
          badgeAssigned: participant.badge !== null,
          volunteer: volunteer ? { adminId: volunteer.adminId, active: volunteer.active !== false } : null,
        };
      });
      return {
        page,
        continueCursor: end >= filtered.length ? null : String(end),
        isDone: end >= filtered.length,
        scanned: page.length,
      };
    }
    case "admin/participantsAdmin:getParticipantDetails": {
      requireAdmin(sessionToken);
      const participant = participants.get(String(args.participantId ?? ""));
      if (!participant) return null;
      const volunteer = participant.volunteerAdminId ? staffById.get(participant.volunteerAdminId) : undefined;
      return {
        participantId: participant.participantId,
        name: participant.name,
        email: participant.email,
        points: participant.points,
        acceptedAt: reviews.get(participant.applicationId)?.updatedAt ?? Date.now(),
        ledgerPoints: participant.points,
        pointsConsistent: true,
        checkedInAt: participant.checkedInAt,
        foodCheckedInAt: participant.foodCheckedInAt,
        badge: participant.badge,
        awards: participant.awards,
        volunteer: volunteer ? {
          adminId: volunteer.adminId,
          name: volunteer.name,
          email: volunteer.email,
          active: volunteer.active !== false,
          canCheckIn: volunteer.canCheckIn === true,
          canFoodCheckIn: volunteer.canFoodCheckIn === true,
        } : null,
      };
    }
    case "admin/applications:getApplication": {
      requireReviewer(sessionToken);
      const applicationId = String(args.applicationId ?? "");
      const application = applications.get(applicationId);
      if (!application) return null;
      const review = reviews.get(applicationId);
      const now = Date.now();
      return {
        application,
        reviewStatus: review?.status ?? null,
        pendingDecision: decisionQueue.has(applicationId)
          ? {
              decision: decisionQueue.get(applicationId)!.decision,
              status: decisionQueue.get(applicationId)!.status,
              queuedAt: decisionQueue.get(applicationId)!.queuedAt,
            }
          : null,
        reviewActivity: reviewActivity(review, now),
        resume: applicationId === E2E_APPLICATION_IDS.unreviewed
          ? { status: "available" as const, url: sampleResumeUrl(), filename: "sample-resume.pdf" }
          : { status: "none" as const, url: null, filename: null },
      };
    }
    case "admin/decisionEmailQueue:listDecisionEmailQueue": {
      requireReviewer(sessionToken);
      if (decisionQueueScenario === "loading") return undefined;
      if (decisionQueueScenario === "error") throw new Error("Mock decision queue unavailable");
      const rows = [...decisionQueue.entries()].map(([applicationId, row]) => {
        const application = applications.get(applicationId);
        const applicantName = [application?.firstName, application?.lastName].filter(Boolean).join(" ");
        return {
          itemId: applicationId,
          applicationId,
          decision: row.decision,
          recipientEmail: application?.email ?? "",
          applicantName: applicantName || "Applicant",
          status: row.status,
          queuedAt: row.queuedAt,
          sentAt: row.status === "sent" ? row.queuedAt : null,
          errorMessage: row.status === "failed" ? row.errorMessage ?? "Delivery failed" : null,
        };
      });
      const counts = { queued: 0, held: 0, sending: 0, failed: 0, sent: 0 };
      for (const row of rows) counts[row.status] += 1;
      return {
        counts,
        active: rows.filter((row) => row.status !== "sent").sort((left, right) => right.queuedAt - left.queuedAt),
        sent: rows.filter((row) => row.status === "sent"),
      };
    }
    case "admin/applicationReviewLogs:listApplicationReviewLogs": {
      requireAdmin(sessionToken);
      const applicationId = String(args.applicationId ?? "");
      if (!applications.has(applicationId)) throw adminError("APPLICATION_NOT_FOUND");
      const paginationOpts = args.paginationOpts as { numItems: number; cursor: string | null };
      const filtered = logs
        .filter((log) => log.applicationId === applicationId)
        .sort((left, right) => right.createdAt - left.createdAt);
      const end = paginationOpts.numItems;
      const page = filtered.slice(0, end);
      return {
        page: page.map((log) => ({
          _id: log._id,
          action: log.action,
          createdAt: log.createdAt,
          actorName: staffById.get(log.adminId)?.name ?? "Unknown organizer",
        })),
        isDone: end >= filtered.length,
        continueCursor: end >= filtered.length ? null : String(end),
      };
    }
    default: {
      const shop = runShopQuery(path, args, sessionToken);
      if (shop !== NOT_SHOP) return shop;
      throw new Error(`Unhandled E2E mock query: ${path}`);
    }
  }
}

export async function e2eMockRunMutation(path: string, args: Record<string, unknown>) {
  const sessionToken = String(args.sessionToken ?? "");
  const now = Date.now();
  if (path.startsWith("admin/meals:")) {
    const admin = requireAdmin(sessionToken);
    const result = mockMealsMutation(path, args, admin.adminId);
    bump();
    return result;
  }

  switch (path) {
    case "admin/volunteerScan:resolveQrForMeal":
      return runMockMealScan(requireVolunteer(sessionToken), args, false);
    case "admin/volunteerScan:redeemMeal":
      return runMockMealScan(requireVolunteer(sessionToken), args, true);
    case "admin/volunteerScan:resolveQrForScan": {
      const staff = requireVolunteer(sessionToken);
      const purpose = String(args.purpose ?? "");
      if (purpose === "food_check_in") return runMockMealScan(staff, args, false);
      const target = scanTarget(staff, args, purpose);
      if ("failure" in target) {
        return { status: target.failure === "event_denied" || target.failure === "event_inactive" ? "not_authorized" : target.failure };
      }
      const { participant, event } = target;
      if (purpose === "shop") {
        return { status: "ok", purpose: "shop", participant: { participantId: participant.participantId, name: participant.name, points: participant.points } };
      }
      if (event) {
        return {
          status: "ok",
          purpose: "point_scan",
          participant: { name: participant.name },
          event: { eventId: event.eventId, name: event.name, pointsAwarded: event.pointsAwarded },
          alreadyAwarded: participant.awardedEventIds.has(event.eventId),
        };
      }
      throw new Error("Unexpected scan purpose");
    }
    case "admin/badgeCheckIn:resolveRegistrationForCheckIn":
      return mockCheckIn(requireVolunteer(sessionToken), args, "registration");
    case "admin/badgeCheckIn:resolveBadgeForCheckIn":
      return mockCheckIn(requireVolunteer(sessionToken), args, "badge");
    case "admin/badgeCheckIn:checkInWithBadge":
      return mockCheckIn(requireVolunteer(sessionToken), args, "commit");
    case "admin/badgeAdmin:assignParticipantBadge": {
      const admin = requireAdmin(sessionToken);
      const participant = participants.get(String(args.participantId ?? ""));
      if (!participant) throw adminError("PARTICIPANT_NOT_FOUND");
      const reason = String(args.reason ?? "").trim();
      if (!reason || reason.length > 200) throw adminError("INVALID_BADGE_REASON");
      if (participant.checkedInAt === null) throw adminError("PARTICIPANT_NOT_CHECKED_IN");
      if ((participant.badge?.assignedAt ?? null) !== args.expectedBadgeAssignedAt) throw adminError("BADGE_ASSIGNMENT_CHANGED");
      const checked = mockBadgeConflict(String(args.badgeQrCodeToken ?? ""));
      if ("conflict" in checked) {
        throw adminError(({
          badge_invalid: "INVALID_BADGE", badge_is_registration: "BADGE_IS_REGISTRATION",
          badge_in_use: "BADGE_IN_USE", badge_retired: "BADGE_RETIRED",
        } as const)[checked.conflict]);
      }
      const replaced = participant.badge !== null;
      if (participant.badgeToken) retiredRosterBadges.add(participant.badgeToken);
      participant.badgeToken = checked.badge;
      participant.badge = { assignedAt: now, assignedBy: { adminId: admin.adminId, name: admin.name } };
      logVolunteerAction({ actorAdminId: admin.adminId, action: replaced ? "badge_replaced" : "badge_assigned", participantName: participant.name, reason });
      bump();
      return { ok: true, replaced, assignedAt: now };
    }
    case "admin/volunteerOperations:foodCheckInParticipant": {
      return runMockMealScan(requireVolunteer(sessionToken), args, true);
    }
    case "admin/volunteerOperations:awardEventPoints": {
      const staff = requireVolunteer(sessionToken);
      const target = scanTarget(staff, args, "point_scan");
      if ("failure" in target) return { status: target.failure };
      const { participant, event } = target;
      if (participant.checkedInAt === undefined) return { status: "participant_not_checked_in" };
      if (participant.awardedEventIds.has(event!.eventId)) return { status: "already_awarded" };
      participant.awardedEventIds.add(event!.eventId);
      logVolunteerAction({
        actorAdminId: staff.adminId, action: "point_scan", participantName: participant.name,
        eventId: event!.eventId, pointsDelta: event!.pointsAwarded,
      });
      bump();
      return { status: "success", pointsAwarded: event!.pointsAwarded };
    }
    case "admin/applicationReviewLogs:logApplicationReviewAction": {
      const admin = requireReviewer(sessionToken);
      const applicationId = String(args.applicationId ?? "");
      const action = String(args.action ?? "");
      if (!applications.has(applicationId)) throw adminError("APPLICATION_NOT_FOUND");

      if (action === "started_review") {
        let review = reviews.get(applicationId);
        if (!review) {
          review = {
            applicationId,
            status: "under_review",
            reviewedBy: admin.adminId,
            startedAt: now,
            lastActiveAt: now,
            createdAt: now,
            updatedAt: now,
          };
          reviews.set(applicationId, review);
        } else if (review.status === "under_review" && review.reviewedBy === admin.adminId) {
          review.lastActiveAt = now;
          review.updatedAt = now;
        } else if (
          review.status !== "under_review" ||
          !review.reviewedBy ||
          review.reviewedBy === admin.adminId ||
          (review.lastActiveAt !== undefined && now - review.lastActiveAt > ACTIVE_REVIEW_STALE_MS)
        ) {
          review.status = "under_review";
          review.reviewedBy = admin.adminId;
          review.startedAt = review.startedAt ?? now;
          review.lastActiveAt = now;
          review.updatedAt = now;
        } else {
          throw adminError("REVIEW_CLAIMED");
        }
      }

      const logId = `e2e-log-${nextLogId++}`;
      logs.push({
        _id: logId,
        applicationId,
        adminId: admin.adminId,
        action,
        createdAt: now,
      });
      bump();
      return logId;
    }
    case "admin/applicationReviewLogs:setApplicationDecision": {
      const admin = requireReviewer(sessionToken);
      const applicationId = String(args.applicationId ?? "");
      const decision = String(args.decision ?? "") as "accepted" | "rejected" | "waitlisted";
      if (!applications.has(applicationId)) throw adminError("APPLICATION_NOT_FOUND");
      const review = reviews.get(applicationId);
      if (!review) throw new Error("Application review not found");
      const promotingWaitlist = review.status === "waitlisted" && decision === "accepted";
      if (isFinalStatus(review.status) && !promotingWaitlist) {
        throw adminError("REVIEW_FINALIZED");
      }
      if (
        review.status === "under_review" &&
        review.reviewedBy &&
        review.reviewedBy !== admin.adminId &&
        review.lastActiveAt !== undefined &&
        now - review.lastActiveAt <= ACTIVE_REVIEW_STALE_MS
      ) {
        throw adminError("REVIEW_CLAIMED");
      }
      const email = applications.get(applicationId)?.email.trim();
      if (!email) throw adminError("DECISION_EMAIL_MISSING");
      const open = decisionQueue.get(applicationId);
      if (open && open.status !== "sent" && open.status !== "failed" && open.decision === decision) {
        bump();
        return { queued: true, duplicate: true };
      }
      decisionQueue.set(applicationId, { decision, status: "queued", queuedAt: now });
      bump();
      return { queued: true, duplicate: false };
    }
    case "admin/decisionEmailQueue:setDecisionEmailHold": {
      requireAdmin(sessionToken);
      const itemId = String(args.itemId ?? "");
      const row = decisionQueue.get(itemId);
      if (!row) throw adminError("APPLICATION_NOT_FOUND");
      const next = args.held === true ? "held" : "queued";
      row.status = next;
      bump();
      return { status: next };
    }
    case "admin/decisionEmailQueue:retryFailedDecisionEmails": {
      requireAdmin(sessionToken);
      let retried = 0;
      for (const row of decisionQueue.values()) {
        if (row.status === "failed") {
          row.status = "queued";
          retried += 1;
        }
      }
      bump();
      return { retried };
    }
    case "admin/participantsAdmin:setParticipantPoints": {
      requireAdmin(sessionToken);
      const participant = participants.get(String(args.participantId ?? ""));
      if (!participant) throw adminError("PARTICIPANT_NOT_FOUND");
      const nextPoints = Number(args.points);
      if (!Number.isSafeInteger(nextPoints) || nextPoints < 0) throw adminError("INVALID_POINTS");
      const previousPoints = participant.points;
      participant.points = nextPoints;
      bump();
      return {
        ok: true,
        changed: previousPoints !== nextPoints,
        previousPoints,
        newPoints: nextPoints,
        pointsDelta: nextPoints - previousPoints,
      };
    }
    case "admin/participantsAdmin:promoteParticipantToVolunteer": {
      requireAdmin(sessionToken);
      const participant = participants.get(String(args.participantId ?? ""));
      if (!participant) throw adminError("PARTICIPANT_NOT_FOUND");
      const email = String(args.email ?? "").trim().toLowerCase();
      if (participant.volunteerAdminId || staffByEmail.has(email)) throw adminError("STAFF_ACCOUNT_EXISTS");
      const adminId = `e2e-volunteer-${staffById.size}`;
      const volunteer: StaffRecord = {
        adminId,
        email,
        name: participant.name,
        role: "volunteer",
        active: true,
        participantId: participant.participantId,
        canCheckIn: args.canCheckIn === true,
        canFoodCheckIn: args.canFoodCheckIn === true,
      };
      staffById.set(adminId, volunteer);
      staffByEmail.set(email, volunteer);
      participant.volunteerAdminId = adminId;
      bump();
      return { ok: true, adminId, email };
    }
    case "admin/volunteers:createVolunteer": {
      requireAdmin(sessionToken);
      const name = String(args.name ?? "").trim();
      if (!name) throw adminError("INVALID_STAFF_NAME");
      const email = String(args.email ?? "").trim().toLowerCase();
      if (staffByEmail.has(email)) throw adminError("STAFF_ACCOUNT_EXISTS");
      const adminId = `e2e-volunteer-${staffById.size}`;
      const volunteer: StaffRecord = {
        adminId,
        email,
        name,
        role: "volunteer",
        active: true,
        canCheckIn: false,
        canFoodCheckIn: false,
        canRedeemShop: false,
      };
      staffById.set(adminId, volunteer);
      staffByEmail.set(email, volunteer);
      bump();
      return { ok: true, adminId, email };
    }
    case "admin/volunteers:revokeVolunteer":
    case "admin/volunteers:restoreVolunteer": {
      requireAdmin(sessionToken);
      const volunteer = staffById.get(String(args.volunteerAdminId ?? ""));
      if (!volunteer || volunteer.role !== "volunteer") throw adminError("VOLUNTEER_NOT_FOUND");
      const restoring = path.endsWith("restoreVolunteer");
      const wasActive = volunteer.active !== false;
      if (wasActive !== restoring) {
        logStaffConfig({
          actorAdminId: requireAdmin(sessionToken).adminId,
          action: restoring ? "volunteer_restored" : "volunteer_revoked",
          targetAdminId: volunteer.adminId,
        });
      }
      volunteer.active = restoring;
      bump();
      return { ok: true };
    }
    case "admin/volunteers:setVolunteerCapabilities": {
      const actor = requireAdmin(sessionToken);
      const volunteer = staffById.get(String(args.volunteerAdminId ?? ""));
      if (!volunteer || volunteer.role !== "volunteer") throw adminError("VOLUNTEER_NOT_FOUND");
      const before: Record<string, boolean> = { canCheckIn: volunteer.canCheckIn === true, canFoodCheckIn: volunteer.canFoodCheckIn === true };
      const after: Record<string, boolean> = { canCheckIn: args.canCheckIn === true, canFoodCheckIn: args.canFoodCheckIn === true };
      if (typeof args.canRedeemShop === "boolean") {
        before.canRedeemShop = volunteer.canRedeemShop === true;
        after.canRedeemShop = args.canRedeemShop;
      }
      const changedFields = (Object.keys(after) as Array<keyof typeof after>).filter((key) => before[key] !== after[key]);
      if (changedFields.length === 0) return { ok: true, changed: false };
      Object.assign(volunteer, after);
      logStaffConfig({
        actorAdminId: actor.adminId, action: "volunteer_capabilities_updated", targetAdminId: volunteer.adminId,
        details: { changedFields, before, after },
      });
      bump();
      return { ok: true, changed: true };
    }
    case "admin/volunteers:setVolunteerEventAccess": {
      const actor = requireAdmin(sessionToken);
      const volunteer = staffById.get(String(args.volunteerAdminId ?? ""));
      if (!volunteer || volunteer.role !== "volunteer") throw adminError("VOLUNTEER_NOT_FOUND");
      const eventIds = Array.isArray(args.eventIds) ? args.eventIds.map(String) : [];
      if (new Set(eventIds).size !== eventIds.length) throw adminError("INVALID_EVENT_ASSIGNMENT");
      if (eventIds.some((eventId) => !events.has(eventId))) throw adminError("EVENT_NOT_FOUND");
      const current = eventAssignments.get(volunteer.adminId) ?? [];
      const addedEventIds = eventIds.filter((eventId) => !current.includes(eventId));
      const removedEventIds = current.filter((eventId) => !eventIds.includes(eventId));
      if (addedEventIds.length > 0 && volunteer.active === false) throw adminError("ACCOUNT_INACTIVE");
      eventAssignments.set(volunteer.adminId, eventIds);
      if (addedEventIds.length > 0 || removedEventIds.length > 0) {
        logStaffConfig({
          actorAdminId: actor.adminId, action: "volunteer_event_access_updated", targetAdminId: volunteer.adminId,
          details: { eventIds, addedEventIds, removedEventIds },
        });
      }
      bump();
      return { ok: true, added: addedEventIds.length, removed: removedEventIds.length };
    }
    case "admin/events:createEvent": {
      const actor = requireAdmin(sessionToken);
      const fields = normalizeEventInput(args as unknown as EventScheduleInput);
      const eventId = `e2e-event-new-${nextEventId++}`;
      events.set(eventId, { eventId, ...fields, active: true, createdAt: now, updatedAt: now });
      logStaffConfig({ actorAdminId: actor.adminId, action: "event_created", targetEventId: eventId, details: { after: { active: true } } });
      bump();
      return { ok: true, eventId };
    }
    case "admin/events:updateEvent": {
      const actor = requireAdmin(sessionToken);
      const event = events.get(String(args.eventId ?? ""));
      if (!event) throw adminError("EVENT_NOT_FOUND");
      const fields = normalizeEventInput({ ...(args as unknown as EventScheduleInput), pointsAwarded: event.pointsAwarded });
      const changedFields = (["name", "description", "startsAt", "endsAt"] as const).filter((key) => fields[key] !== event[key]);
      if (changedFields.length === 0) return { ok: true, changed: false };
      Object.assign(event, { name: fields.name, description: fields.description, startsAt: fields.startsAt, endsAt: fields.endsAt, updatedAt: now });
      logStaffConfig({ actorAdminId: actor.adminId, action: "event_updated", targetEventId: event.eventId, details: { changedFields } });
      bump();
      return { ok: true, changed: true };
    }
    case "admin/events:setEventPoints": {
      const actor = requireAdmin(sessionToken);
      const event = events.get(String(args.eventId ?? ""));
      if (!event) throw adminError("EVENT_NOT_FOUND");
      const pointsAwarded = assertEventPoints(Number(args.pointsAwarded));
      if (pointsAwarded === event.pointsAwarded) return { ok: true, changed: false };
      if (eventPointsLocked(event.eventId)) throw adminError("EVENT_POINTS_LOCKED");
      logStaffConfig({
        actorAdminId: actor.adminId, action: "event_updated", targetEventId: event.eventId,
        details: { changedFields: ["pointsAwarded"], before: { pointsAwarded: event.pointsAwarded }, after: { pointsAwarded } },
      });
      Object.assign(event, { pointsAwarded, updatedAt: now });
      bump();
      return { ok: true, changed: true };
    }
    case "admin/events:setEventActive": {
      const actor = requireAdmin(sessionToken);
      const event = events.get(String(args.eventId ?? ""));
      if (!event) throw adminError("EVENT_NOT_FOUND");
      const active = args.active === true;
      if (event.active === active) return { ok: true, changed: false };
      logStaffConfig({
        actorAdminId: actor.adminId, action: "event_active_changed", targetEventId: event.eventId,
        details: { before: { active: event.active }, after: { active } },
      });
      event.active = active;
      event.updatedAt = now;
      bump();
      return { ok: true, changed: true };
    }
    case "admin/decisionEmailRelease:releaseDecisionEmails": {
      requireAdmin(sessionToken);
      const requested = Array.isArray(args.itemIds) ? args.itemIds.map(String) : null;
      const ids = requested ?? [...decisionQueue.entries()].filter(([, row]) => row.status === "queued").map(([id]) => id);
      if (requested?.some((id) => decisionQueue.get(id)?.status !== "queued") || ids.length === 0) {
        throw adminError("DECISION_EMAIL_QUEUE_EMPTY");
      }
      for (const id of ids) {
        const row = decisionQueue.get(id);
        const review = reviews.get(id);
        if (!row || !review) continue;
        review.status = row.decision;
        review.updatedAt = now;
        row.status = "sent";
      }
      bump();
      return { sent: ids.length, failed: 0, total: ids.length };
    }
    default: {
      const shop = runShopMutation(path, args, sessionToken);
      if (shop !== NOT_SHOP) return shop;
      throw new Error(`Unhandled E2E mock mutation: ${path}`);
    }
  }
}


function shopId(prefix: string) {
  nextShopId += 1;
  return `e2e-${prefix}-${nextShopId}`;
}

function seedShop(now: number) {
  shopItems.clear();
  shopSales.length = 0;
  shopRedemptions.length = 0;
  shopAdjustments.length = 0;
  mockNotifications.length = 0;
  nextShopId = 1;
  dropNextPurchaseResponse = false;
  const seed = (itemId: string, fields: Omit<ShopItemRecord, "itemId" | "createdAt" | "updatedAt">, age: number) => {
    shopItems.set(itemId, { itemId, ...fields, createdAt: now - age, updatedAt: now - age });
    if (fields.stockQuantity > 0) {
      shopAdjustments.push({ adjustmentId: shopId("adj"), itemId, kind: "initial", previousQuantity: 0, newQuantity: fields.stockQuantity, delta: fields.stockQuantity, reason: null, actorAdminId: "e2e-admin-admin", createdAt: now - age });
    }
  };
  seed(E2E_SHOP.tee, { name: "HackUTA 2026 T-shirt", description: "Soft cotton tee with the voyage ship.", pointsCost: 400, stockQuantity: 12, lowStockThreshold: null, status: "active", featured: true }, 5_000);
  seed(E2E_SHOP.stickers, { name: "Sticker pack", description: "Six die-cut stickers.", pointsCost: 50, stockQuantity: 3, lowStockThreshold: null, status: "active", featured: false }, 4_000);
  seed(E2E_SHOP.bottle, { name: "Insulated bottle", description: "20 oz steel bottle.", pointsCost: 600, stockQuantity: 0, lowStockThreshold: null, status: "active", featured: false }, 3_000);
  seed(E2E_SHOP.keyboard, { name: "Mechanical keyboard", description: "Compact 65% board.", pointsCost: 2500, stockQuantity: 2, lowStockThreshold: 1, status: "active", featured: false }, 2_000);
  seed(E2E_SHOP.mug, { name: "Amphora mug", description: "Black-figure mug.", pointsCost: 350, stockQuantity: 8, lowStockThreshold: null, status: "inactive", featured: false }, 1_000);
  shopSales.push({
    flashSaleId: E2E_SHOP.sale,
    title: "Midnight tee sale",
    message: "T-shirts are 300 points for one hour.",
    startsAt: now - 600_000,
    endsAt: now + 3_600_000,
    cancelledAt: null,
    items: [{ itemId: E2E_SHOP.tee, salePointsCost: 300 }],
    createdAt: now - 700_000,
  });
  mockNotifications.push(
    {
      notificationId: "e2e-notif-lunch",
      title: "Lunch is Ready",
      message: "Head to the main atrium with your badge for lunch check-in.",
      type: "general",
      status: "published",
      scheduledAt: null,
      publishedAt: now - 1_200_000,
      expiresAt: null,
      cancelledAt: null,
      linkUrl: "/dashboard/schedule",
      linkLabel: "View schedule",
      relatedEventId: null,
      relatedFlashSaleId: null,
      createdBy: "e2e-admin-admin",
      updatedBy: "e2e-admin-admin",
      createdAt: now - 1_200_000,
      updatedAt: now - 1_200_000,
    },
    {
      notificationId: "e2e-notif-workshop",
      title: "AI Workshop",
      message: "Bring your laptop to Room 204 for the hands-on AI session.",
      type: "event",
      status: "scheduled",
      scheduledAt: now + 3_600_000,
      publishedAt: null,
      expiresAt: null,
      cancelledAt: null,
      linkUrl: "/dashboard/schedule",
      linkLabel: "Workshop details",
      relatedEventId: null,
      relatedFlashSaleId: null,
      createdBy: "e2e-admin-admin",
      updatedBy: "e2e-admin-admin",
      createdAt: now - 900_000,
      updatedAt: now - 900_000,
    },
    {
      notificationId: "e2e-notif-sale",
      title: "Midnight tee sale",
      message: "T-shirts are 300 points for one hour.",
      type: "flash_sale",
      status: "published",
      scheduledAt: null,
      publishedAt: now - 600_000,
      expiresAt: now + 3_600_000,
      cancelledAt: null,
      linkUrl: "/dashboard",
      linkLabel: "Open dashboard",
      relatedEventId: null,
      relatedFlashSaleId: E2E_SHOP.sale,
      createdBy: "e2e-admin-admin",
      updatedBy: "e2e-admin-admin",
      createdAt: now - 700_000,
      updatedAt: now - 600_000,
    },
  );
}

function saleStatus(sale: ShopSaleRecord, now: number) {
  if (sale.cancelledAt !== null) return "cancelled" as const;
  if (now < sale.startsAt) return "scheduled" as const;
  if (now < sale.endsAt) return "live" as const;
  return "ended" as const;
}

function shopPrice(item: ShopItemRecord, now: number) {
  for (const sale of shopSales) {
    if (saleStatus(sale, now) !== "live") continue;
    const entry = sale.items.find((row) => row.itemId === item.itemId);
    if (entry) return { unitPointsCost: entry.salePointsCost, basePointsCost: item.pointsCost, flashSaleId: sale.flashSaleId, saleEndsAt: sale.endsAt };
  }
  return { unitPointsCost: item.pointsCost, basePointsCost: item.pointsCost, flashSaleId: null, saleEndsAt: null };
}

function shopStockStatus(item: ShopItemRecord) {
  if (item.stockQuantity <= 0) return "out" as const;
  if (item.stockQuantity <= (item.lowStockThreshold ?? 5)) return "low" as const;
  return "in_stock" as const;
}

function nextShopPriceChange(now: number) {
  let next: number | null = null;
  for (const sale of shopSales) {
    if (sale.cancelledAt !== null) continue;
    for (const at of [sale.startsAt, sale.endsAt]) if (at > now) next = Math.min(next ?? at, at);
  }
  return next;
}

function requireShopItem(itemId: unknown) {
  const item = shopItems.get(String(itemId ?? ""));
  if (!item) throw adminError("SHOP_ITEM_NOT_FOUND");
  return item;
}

function requireShopVolunteer(sessionToken: string) {
  const staff = requireVolunteer(sessionToken);
  if (staff.role !== "admin" && staff.canRedeemShop !== true) throw adminError("CAPABILITY_DENIED");
  return staff;
}

function shopReason(reason: unknown) {
  const trimmed = String(reason ?? "").trim();
  if (!trimmed || trimmed.length > 200) throw adminError("INVALID_SHOP_REASON");
  return trimmed;
}

function changeStock(item: ShopItemRecord, delta: number, kind: ShopAdjustmentRecord["kind"], actorAdminId: string, reason: string | null, now: number) {
  const next = item.stockQuantity + delta;
  if (!Number.isSafeInteger(delta) || delta === 0 || next < 0) throw adminError("INVALID_STOCK_ADJUSTMENT");
  shopAdjustments.push({ adjustmentId: shopId("adj"), itemId: item.itemId, kind, previousQuantity: item.stockQuantity, newQuantity: next, delta, reason, actorAdminId, createdAt: now });
  item.stockQuantity = next;
  item.updatedAt = now;
}

function participantById(participantId: unknown) {
  return [...participantsByToken.values()].find((row) => row.participantId === participantId);
}

function receipt(row: ShopRedemptionRecord) {
  return {
    redemptionId: row.redemptionId,
    itemId: row.itemId,
    itemName: row.itemName,
    quantity: row.quantity,
    unitPointsCost: row.unitPointsCost,
    basePointsCost: row.basePointsCost,
    totalPointsSpent: row.totalPointsSpent,
    pointsBefore: row.pointsBefore,
    pointsAfter: row.pointsAfter,
    flashSaleId: row.flashSaleId,
    redeemedAt: row.redeemedAt,
  };
}

function validateSale(args: Record<string, unknown>, now: number, ignoreId?: string) {
  const title = String(args.title ?? "").trim();
  const startsAt = Number(args.startsAt);
  const endsAt = Number(args.endsAt);
  const items = (Array.isArray(args.items) ? args.items : []) as Array<{ itemId: string; salePointsCost: number }>;
  if (!title || !(startsAt < endsAt) || endsAt <= now || items.length === 0) throw adminError("INVALID_FLASH_SALE");
  for (const entry of items) {
    const item = requireShopItem(entry.itemId);
    if (item.status === "archived" || !(entry.salePointsCost > 0 && entry.salePointsCost < item.pointsCost)) throw adminError("INVALID_FLASH_SALE");
    const overlap = shopSales.some((sale) => sale.flashSaleId !== ignoreId && sale.cancelledAt === null &&
      sale.items.some((row) => row.itemId === entry.itemId) && sale.startsAt < endsAt && sale.endsAt > startsAt);
    if (overlap) throw adminError("FLASH_SALE_OVERLAP");
  }
  return { title, message: String(args.message ?? "").trim(), startsAt, endsAt, items: items.map(({ itemId, salePointsCost }) => ({ itemId, salePointsCost })) };
}

function formatMockNotification(row: MockNotificationRecord, now: number) {
  return {
    notificationId: row.notificationId,
    title: row.title,
    message: row.message,
    type: row.type,
    status: row.status,
    scheduledAt: row.scheduledAt,
    publishedAt: row.publishedAt,
    expiresAt: row.expiresAt,
    cancelledAt: row.cancelledAt,
    expired: row.status === "published" && row.expiresAt !== null && row.expiresAt <= now,
    linkUrl: row.linkUrl,
    linkLabel: row.linkLabel,
    relatedEvent: row.relatedEventId ? { eventId: row.relatedEventId, name: "Event" } : null,
    relatedFlashSale: row.relatedFlashSaleId
      ? {
          flashSaleId: row.relatedFlashSaleId,
          title: shopSales.find((s) => s.flashSaleId === row.relatedFlashSaleId)?.title ?? "Flash sale",
        }
      : null,
    createdBy: { adminId: row.createdBy, name: staffName(row.createdBy) },
    updatedBy: { adminId: row.updatedBy, name: staffName(row.updatedBy) },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const NOT_SHOP = Symbol("not shop");

function runShopQuery(path: string, args: Record<string, unknown>, sessionToken: string) {
  const now = Date.now();
  switch (path) {
    case "admin/shopAdmin:listShopItemsAdmin": {
      requireAdmin(sessionToken);
      const items = [...shopItems.values()].sort((a, b) => b.createdAt - a.createdAt).map((item) => {
        const price = shopPrice(item, now);
        return {
          itemId: item.itemId, name: item.name, description: item.description,
          pointsCost: item.pointsCost, effectivePointsCost: price.unitPointsCost, flashSaleId: price.flashSaleId, saleEndsAt: price.saleEndsAt,
          stockQuantity: item.stockQuantity, stockStatus: shopStockStatus(item), lowStockThreshold: item.lowStockThreshold,
          status: item.status, featured: item.featured, createdAt: item.createdAt, updatedAt: item.updatedAt,
        };
      });
      return { items, nextPriceChangeAt: nextShopPriceChange(now) };
    }
    case "admin/shopAdmin:listInventoryAdjustments": {
      requireAdmin(sessionToken);
      return paginate([...shopAdjustments].reverse().map((row) => ({
        adjustmentId: row.adjustmentId, itemId: row.itemId, itemName: shopItems.get(row.itemId)?.name ?? "Unknown item", kind: row.kind,
        previousQuantity: row.previousQuantity, newQuantity: row.newQuantity, delta: row.delta, reason: row.reason, redemptionId: null,
        admin: { adminId: row.actorAdminId, name: staffName(row.actorAdminId) }, createdAt: row.createdAt,
      })), args);
    }
    case "admin/shopAdmin:listShopRedemptions": {
      requireAdmin(sessionToken);
      const term = String(args.search ?? "").trim().toLowerCase();
      const rows = [...shopRedemptions].reverse().map((row) => {
        const participant = participantsByToken.get(row.participantToken);
        return {
          redemptionId: row.redemptionId,
          participant: { participantId: participant?.participantId ?? "", name: participant?.name ?? "Participant" },
          item: { itemId: row.itemId, name: row.itemName },
          quantity: row.quantity, unitPointsCost: row.unitPointsCost, basePointsCost: row.basePointsCost, totalPointsSpent: row.totalPointsSpent,
          pointsBefore: row.pointsBefore, pointsAfter: row.pointsAfter,
          volunteer: { adminId: row.redeemedBy, name: staffName(row.redeemedBy) },
          redeemedAt: row.redeemedAt,
          flashSale: row.flashSaleId ? { flashSaleId: row.flashSaleId, title: shopSales.find((sale) => sale.flashSaleId === row.flashSaleId)?.title ?? "Flash sale" } : null,
          refund: row.refund ? { ...row.refund, refundedBy: { adminId: row.refund.refundedBy, name: staffName(row.refund.refundedBy) } } : null,
        };
      }).filter((row) => !term || [row.participant.name, row.item.name, row.volunteer.name].some((name) => name.toLowerCase().includes(term)));
      return paginate(rows, args);
    }
    case "admin/shopAdmin:listShopVolunteers": {
      requireAdmin(sessionToken);
      return [...staffById.values()].filter((staff) => staff.role === "volunteer")
        .map((staff) => ({ adminId: staff.adminId, name: staff.name, email: staff.email, canRedeemShop: staff.canRedeemShop === true }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    case "admin/shopFlashSales:listFlashSales": {
      requireAdmin(sessionToken);
      return [...shopSales].sort((a, b) => b.startsAt - a.startsAt).map((sale) => ({
        flashSaleId: sale.flashSaleId, title: sale.title, message: sale.message, startsAt: sale.startsAt, endsAt: sale.endsAt,
        status: saleStatus(sale, now), cancelledAt: sale.cancelledAt, createdAt: sale.createdAt,
        items: sale.items.map((row) => ({ itemId: row.itemId, name: shopItems.get(row.itemId)?.name ?? "Unknown item", pointsCost: shopItems.get(row.itemId)?.pointsCost ?? null, salePointsCost: row.salePointsCost })),
      }));
    }
    case "admin/shopRedemption:listShopCatalogForVolunteer": {
      requireShopVolunteer(sessionToken);
      const items = [...shopItems.values()].filter((item) => item.status === "active").map((item) => ({
        itemId: item.itemId, name: item.name, description: item.description, imageUrl: null, ...shopPrice(item, now),
        stockQuantity: item.stockQuantity, stockStatus: shopStockStatus(item), featured: item.featured,
      })).sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name));
      return { items, maxQuantity: SHOP_MAX_QUANTITY, nextPriceChangeAt: nextShopPriceChange(now) };
    }
    case "admin/shopRedemption:getShopCustomer": {
      requireShopVolunteer(sessionToken);
      const participant = participantById(args.participantId);
      return participant?.eligible ? { participantId: participant.participantId, name: participant.name, points: participant.points } : null;
    }
    case "admin/shopRedemption:previewShopPurchase": {
      requireShopVolunteer(sessionToken);
      const participant = participantById(args.participantId);
      if (!participant?.eligible) return { status: "participant_not_eligible" };
      const item = shopItems.get(String(args.itemId ?? ""));
      if (item?.status !== "active") return { status: "item_unavailable" };
      const quantity = Number(args.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > SHOP_MAX_QUANTITY) return { status: "invalid_quantity", maxQuantity: SHOP_MAX_QUANTITY };
      const price = shopPrice(item, now);
      const totalPointsCost = price.unitPointsCost * quantity;
      return {
        status: "ok", ...price, quantity, totalPointsCost, stockQuantity: item.stockQuantity, points: participant.points,
        pointsAfter: participant.points - totalPointsCost, hasEnoughPoints: participant.points >= totalPointsCost, hasEnoughStock: item.stockQuantity >= quantity,
      };
    }
    case "admin/notifications:listNotificationsAdmin": {
      requireAdmin(sessionToken);
      const term = String(args.search ?? "").trim().toLowerCase();
      const status = typeof args.status === "string" ? args.status : undefined;
      const type = typeof args.type === "string" ? args.type : undefined;
      const rows = [...mockNotifications]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .filter((row) => (!status || row.status === status) && (!type || row.type === type))
        .filter((row) => !term || row.title.toLowerCase().includes(term) || row.message.toLowerCase().includes(term))
        .map((row) => formatMockNotification(row, now));
      return paginate(rows, args);
    }
    case "admin/notifications:getNotificationAdmin": {
      requireAdmin(sessionToken);
      const row = mockNotifications.find((candidate) => candidate.notificationId === args.notificationId);
      return row ? formatMockNotification(row, now) : null;
    }
    default:
      return NOT_SHOP;
  }
}

function runShopMutation(path: string, args: Record<string, unknown>, sessionToken: string) {
  const now = Date.now();
  switch (path) {
    case "admin/shopAdmin:generateShopImageUploadUrl": {
      requireAdmin(sessionToken);
      return "https://e2e-upload.invalid/upload";
    }
    case "admin/shopAdmin:createShopItem": {
      const admin = requireAdmin(sessionToken);
      const name = String(args.name ?? "").trim();
      const pointsCost = Number(args.pointsCost);
      const stockQuantity = Number(args.stockQuantity);
      if (!name || !Number.isSafeInteger(pointsCost) || pointsCost <= 0 || !Number.isSafeInteger(stockQuantity) || stockQuantity < 0) throw adminError("INVALID_SHOP_ITEM");
      const item: ShopItemRecord = {
        itemId: shopId("item"), name, description: String(args.description ?? "").trim(), pointsCost, stockQuantity: 0,
        lowStockThreshold: typeof args.lowStockThreshold === "number" ? args.lowStockThreshold : null,
        status: args.active === false ? "inactive" : "active", featured: args.featured === true, createdAt: now, updatedAt: now,
      };
      shopItems.set(item.itemId, item);
      if (stockQuantity > 0) changeStock(item, stockQuantity, "initial", admin.adminId, null, now);
      bump();
      return { itemId: item.itemId };
    }
    case "admin/shopAdmin:updateShopItem": {
      requireAdmin(sessionToken);
      const item = requireShopItem(args.itemId);
      const name = String(args.name ?? "").trim();
      const pointsCost = Number(args.pointsCost);
      if (!name || !Number.isSafeInteger(pointsCost) || pointsCost <= 0) throw adminError("INVALID_SHOP_ITEM");
      Object.assign(item, {
        name, description: String(args.description ?? "").trim(), pointsCost, featured: args.featured === true,
        lowStockThreshold: typeof args.lowStockThreshold === "number" ? args.lowStockThreshold : null, updatedAt: now,
      });
      bump();
      return { ok: true, changed: true };
    }
    case "admin/shopAdmin:setShopItemStatus": {
      requireAdmin(sessionToken);
      requireShopItem(args.itemId).status = args.status as ShopItemRecord["status"];
      bump();
      return { ok: true, changed: true };
    }
    case "admin/shopAdmin:adjustShopStock": {
      const admin = requireAdmin(sessionToken);
      const item = requireShopItem(args.itemId);
      const hasDelta = typeof args.delta === "number";
      if (hasDelta === (typeof args.newQuantity === "number")) throw adminError("INVALID_STOCK_ADJUSTMENT");
      const delta = hasDelta ? Number(args.delta) : Number(args.newQuantity) - item.stockQuantity;
      if (args.kind === "restock" && delta <= 0) throw adminError("INVALID_STOCK_ADJUSTMENT");
      const previousQuantity = item.stockQuantity;
      changeStock(item, delta, args.kind === "restock" ? "restock" : "manual", admin.adminId, shopReason(args.reason), now);
      bump();
      return { ok: true, previousQuantity, newQuantity: item.stockQuantity };
    }
    case "admin/shopAdmin:refundShopRedemption": {
      const admin = requireAdmin(sessionToken);
      const row = shopRedemptions.find((candidate) => candidate.redemptionId === args.redemptionId);
      if (!row) throw adminError("REDEMPTION_NOT_FOUND");
      if (row.refund) throw adminError("REDEMPTION_ALREADY_REFUNDED");
      const reason = shopReason(args.reason);
      const participant = participantsByToken.get(row.participantToken);
      if (participant) participant.points += row.totalPointsSpent;
      const item = shopItems.get(row.itemId);
      const restocked = args.restock === true && item !== undefined;
      if (item && restocked) changeStock(item, row.quantity, "refund_restock", admin.adminId, reason, now);
      row.refund = { refundedBy: admin.adminId, refundedAt: now, reason, restocked, pointsRestored: row.totalPointsSpent };
      bump();
      return { ok: true, pointsRestored: row.totalPointsSpent, restocked };
    }
    case "admin/shopAdmin:setVolunteerShopAccess": {
      requireAdmin(sessionToken);
      const volunteer = staffById.get(String(args.volunteerAdminId ?? ""));
      if (!volunteer || volunteer.role !== "volunteer") throw adminError("VOLUNTEER_NOT_FOUND");
      volunteer.canRedeemShop = args.canRedeemShop === true;
      bump();
      return { ok: true, changed: true };
    }
    case "admin/shopFlashSales:createFlashSale": {
      const admin = requireAdmin(sessionToken);
      const input = validateSale(args, now);
      const flashSaleId = shopId("sale");
      shopSales.push({ flashSaleId, ...input, cancelledAt: null, createdAt: now });
      const immediate = input.startsAt <= now;
      mockNotifications.push({
        notificationId: shopId("notif"),
        title: input.title,
        message: input.message || "Limited-time shop discount is live.",
        type: "flash_sale",
        status: immediate ? "published" : "scheduled",
        scheduledAt: immediate ? null : input.startsAt,
        publishedAt: immediate ? now : null,
        expiresAt: input.endsAt,
        cancelledAt: null,
        linkUrl: "/dashboard",
        linkLabel: "Open dashboard",
        relatedEventId: null,
        relatedFlashSaleId: flashSaleId,
        createdBy: admin.adminId,
        updatedBy: admin.adminId,
        createdAt: now,
        updatedAt: now,
      });
      bump();
      return { flashSaleId };
    }
    case "admin/shopFlashSales:updateFlashSale": {
      const admin = requireAdmin(sessionToken);
      const sale = shopSales.find((candidate) => candidate.flashSaleId === args.flashSaleId);
      if (!sale) throw adminError("FLASH_SALE_NOT_FOUND");
      if (saleStatus(sale, now) !== "scheduled") throw adminError("FLASH_SALE_NOT_EDITABLE");
      const next = validateSale(args, now, sale.flashSaleId);
      Object.assign(sale, next);
      const linked = mockNotifications.find((row) => row.relatedFlashSaleId === sale.flashSaleId);
      if (linked) {
        const immediate = next.startsAt <= now;
        Object.assign(linked, {
          title: next.title,
          message: next.message || "Limited-time shop discount is live.",
          status: immediate ? "published" : "scheduled",
          scheduledAt: immediate ? null : next.startsAt,
          publishedAt: immediate ? now : null,
          expiresAt: next.endsAt,
          updatedBy: admin.adminId,
          updatedAt: now,
        });
      }
      bump();
      return { ok: true };
    }
    case "admin/shopFlashSales:cancelFlashSale": {
      const admin = requireAdmin(sessionToken);
      const sale = shopSales.find((candidate) => candidate.flashSaleId === args.flashSaleId);
      if (!sale) throw adminError("FLASH_SALE_NOT_FOUND");
      const status = saleStatus(sale, now);
      if (status === "ended" || status === "cancelled") throw adminError("FLASH_SALE_NOT_EDITABLE");
      sale.cancelledAt = now;
      const linked = mockNotifications.find((row) => row.relatedFlashSaleId === sale.flashSaleId);
      if (linked) {
        Object.assign(linked, { status: "cancelled", cancelledAt: now, updatedBy: admin.adminId, updatedAt: now });
      }
      bump();
      return { ok: true };
    }
    case "admin/notifications:saveNotificationDraft":
    case "admin/notifications:publishNotificationNow":
    case "admin/notifications:scheduleNotification":
    case "admin/notifications:updateNotification": {
      const admin = requireAdmin(sessionToken);
      const title = String(args.title ?? "").trim();
      const message = String(args.message ?? "").trim();
      const type = String(args.type ?? "general") as MockNotificationRecord["type"];
      if (!title || !message) throw adminError("INVALID_NOTIFICATION");
      const linkUrl = typeof args.linkUrl === "string" && args.linkUrl.trim() ? args.linkUrl.trim() : null;
      const linkLabel = typeof args.linkLabel === "string" && args.linkLabel.trim() ? args.linkLabel.trim() : null;
      const expiresAt = typeof args.expiresAt === "number" ? args.expiresAt : null;
      const existing = args.notificationId
        ? mockNotifications.find((candidate) => candidate.notificationId === args.notificationId)
        : undefined;
      if (args.notificationId && !existing) throw adminError("NOTIFICATION_NOT_FOUND");
      if (existing && (existing.status === "published" || existing.status === "cancelled")) {
        throw adminError("NOTIFICATION_NOT_EDITABLE");
      }
      const isPublish = path.endsWith(":publishNotificationNow");
      const isSchedule = path.endsWith(":scheduleNotification") || (path.endsWith(":updateNotification") && (existing?.status === "scheduled" || typeof args.scheduledAt === "number"));
      const scheduledAt = isSchedule ? Number(args.scheduledAt ?? existing?.scheduledAt) : null;
      if (isSchedule && (!scheduledAt || !Number.isSafeInteger(scheduledAt) || scheduledAt <= now)) {
        throw adminError("INVALID_NOTIFICATION_SCHEDULE");
      }
      const nextStatus: MockNotificationRecord["status"] = isPublish ? "published" : isSchedule ? "scheduled" : "draft";
      if (existing) {
        Object.assign(existing, {
          title,
          message,
          type,
          status: nextStatus,
          scheduledAt: isSchedule ? scheduledAt : null,
          publishedAt: isPublish ? now : null,
          expiresAt,
          linkUrl,
          linkLabel,
          updatedBy: admin.adminId,
          updatedAt: now,
        });
        bump();
        return path.endsWith(":updateNotification")
          ? { ok: true, status: nextStatus }
          : { notificationId: existing.notificationId, ...(isPublish ? { publishedAt: now } : isSchedule ? { scheduledAt } : {}) };
      }
      const notificationId = shopId("notif");
      mockNotifications.push({
        notificationId,
        title,
        message,
        type,
        status: nextStatus,
        scheduledAt: isSchedule ? scheduledAt : null,
        publishedAt: isPublish ? now : null,
        expiresAt,
        cancelledAt: null,
        linkUrl,
        linkLabel,
        relatedEventId: typeof args.relatedEventId === "string" ? args.relatedEventId : null,
        relatedFlashSaleId: null,
        createdBy: admin.adminId,
        updatedBy: admin.adminId,
        createdAt: now,
        updatedAt: now,
      });
      bump();
      return { notificationId, ...(isPublish ? { publishedAt: now } : isSchedule ? { scheduledAt } : {}) };
    }
    case "admin/notifications:cancelNotification": {
      const admin = requireAdmin(sessionToken);
      const existing = mockNotifications.find((candidate) => candidate.notificationId === args.notificationId);
      if (!existing) throw adminError("NOTIFICATION_NOT_FOUND");
      if (existing.status === "published" || existing.status === "cancelled") {
        throw adminError("NOTIFICATION_NOT_EDITABLE");
      }
      Object.assign(existing, { status: "cancelled", cancelledAt: now, updatedBy: admin.adminId, updatedAt: now });
      bump();
      return { ok: true };
    }
    case "admin/shopRedemption:purchaseShopItem": {
      const volunteer = requireShopVolunteer(sessionToken);
      const key = String(args.idempotencyKey ?? "");
      if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) return { status: "invalid_request" };
      const found = mockBadgeHolder(String(args.qrCodeToken ?? ""));
      if ("failure" in found) return { status: found.failure };
      const { participant } = found;
      const token = participant.registrationToken;
      const quantity = Number(args.quantity);
      const existing = shopRedemptions.find((row) => row.idempotencyKey === key);
      if (existing) {
        const same = existing.participantToken === token && existing.itemId === args.itemId && existing.quantity === quantity && existing.redeemedBy === volunteer.adminId;
        return same ? { status: "duplicate", receipt: receipt(existing) } : { status: "invalid_request" };
      }
      if (!participant.eligible) return { status: "participant_not_eligible" };
      const item = shopItems.get(String(args.itemId ?? ""));
      if (item?.status !== "active") return { status: "item_unavailable" };
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > SHOP_MAX_QUANTITY) return { status: "invalid_quantity", maxQuantity: SHOP_MAX_QUANTITY };
      const price = shopPrice(item, now);
      if (price.unitPointsCost !== args.expectedUnitPointsCost) {
        return { status: "price_changed", unitPointsCost: price.unitPointsCost, totalPointsCost: price.unitPointsCost * quantity };
      }
      if (item.stockQuantity < quantity) return { status: "insufficient_stock", stockQuantity: item.stockQuantity };
      const totalPointsCost = price.unitPointsCost * quantity;
      if (participant.points < totalPointsCost) return { status: "insufficient_points", points: participant.points, totalPointsCost };
      const row: ShopRedemptionRecord = {
        redemptionId: shopId("redemption"), participantToken: token, itemId: item.itemId, itemName: item.name, quantity,
        unitPointsCost: price.unitPointsCost, basePointsCost: price.basePointsCost, totalPointsSpent: totalPointsCost,
        pointsBefore: participant.points, pointsAfter: participant.points - totalPointsCost, redeemedBy: volunteer.adminId,
        redeemedAt: now, flashSaleId: price.flashSaleId, idempotencyKey: key, refund: null,
      };
      participant.points -= totalPointsCost;
      changeStock(item, -quantity, "purchase", volunteer.adminId, null, now);
      shopRedemptions.push(row);
      bump();
      if (dropNextPurchaseResponse) {
        dropNextPurchaseResponse = false;
        throw new TypeError("Failed to fetch");
      }
      return { status: "success", receipt: receipt(row) };
    }
    default:
      return NOT_SHOP;
  }
}
