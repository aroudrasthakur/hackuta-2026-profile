import { ADMIN_ERROR_MESSAGES, adminError } from "../errors.ts";
import { assertEventPoints, normalizeEventInput, type EventScheduleInput } from "../volunteerRules.ts";
import { sampleResumeUrl } from "./resumeFixture.ts";
import {
  E2E_ADMIN,
  E2E_APPLICATION_IDS,
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
};

type ParticipantRecord = {
  participantId: string;
  applicationId: string;
  name: string;
  email: string;
  points: number;
  checkedInAt: number | null;
  foodCheckedInAt: number | null;
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
  name: string;
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
  action: "check_in" | "food_check_in" | "point_scan" | "admin_adjust";
  participantName: string;
  eventId?: string;
  pointsDelta?: number;
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
const events = new Map<string, EventRecord>();
const eventAssignments = new Map<string, string[]>();
const volunteerActionLogs: VolunteerActionLogRecord[] = [];
const staffConfigLogs: StaffConfigLogRecord[] = [];
let nextEventId = 1;

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
  });

  const now = Date.now();
  for (const event of Object.values(E2E_EVENTS)) {
    events.set(event.eventId, {
      ...event, active: true, startsAt: now - 60_000, endsAt: now + 3_600_000, createdAt: now - 86_400_000, updatedAt: now - 86_400_000,
    });
  }
  eventAssignments.set("e2e-admin-lead", Object.values(E2E_EVENTS).map(({ eventId }) => eventId));
  volunteerActionLogs.push(
    { logId: "e2e-action-seed-1", actorAdminId: "e2e-admin-lead", action: "check_in", participantName: "Morgan Present", createdAt: now - 600_000 },
    {
      logId: "e2e-action-seed-2", actorAdminId: "e2e-admin-lead", action: "point_scan", participantName: "Morgan Present",
      eventId: E2E_EVENTS.panel.eventId, pointsDelta: E2E_EVENTS.panel.pointsAwarded, createdAt: now - 500_000,
    },
  );
  participantsByToken.set(E2E_QR_TOKENS.ready, {
    name: "Riley Ready",
    eligible: true,
    foodRestriction: "Vegetarian; Allergies: peanuts",
    awardedEventIds: new Set(),
  });
  participantsByToken.set(E2E_QR_TOKENS.checkedIn, {
    name: "Morgan Present",
    eligible: true,
    checkedInAt: now - 600_000,
    foodCheckedInAt: now - 300_000,
    awardedEventIds: new Set([E2E_EVENTS.panel.eventId]),
  });
  participantsByToken.set(E2E_QR_TOKENS.ineligible, {
    name: "Pat Pending",
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
    checkedInAt: null,
    foodCheckedInAt: null,
    awards: [],
  });

  bump();
}

resetStore();

export function resetE2eMockStore() {
  resetStore();
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
  if (staff.role !== "volunteer") throw adminError("VOLUNTEER_ONLY");
  return staff;
}

function assignedEvents(adminId: string) {
  return (eventAssignments.get(adminId) ?? [])
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

/** Same capability, assignment, token, and eligibility order as the Convex scan functions. */
function scanTarget(staff: StaffRecord, args: Record<string, unknown>, purpose: string) {
  if (purpose === "check_in" && staff.canCheckIn !== true) return { failure: "not_authorized" as const };
  if (purpose === "food_check_in" && staff.canFoodCheckIn !== true) return { failure: "not_authorized" as const };
  let event: EventRecord | undefined;
  if (purpose === "point_scan") {
    const eventId = String(args.eventId ?? "");
    event = (eventAssignments.get(staff.adminId) ?? []).includes(eventId) ? events.get(eventId) : undefined;
    if (!event) return { failure: "event_denied" as const };
    if (!event.active) return { failure: "event_inactive" as const };
  }
  const participant = participantsByToken.get(String(args.qrCodeToken ?? ""));
  if (!participant) return { failure: "qr_not_found" as const };
  if (!participant.eligible) return { failure: "participant_not_eligible" as const };
  return { participant, event };
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

  switch (path) {
    case "admin/volunteerScan:listMyScanOptions": {
      const admin = adminFromSessionToken(sessionToken);
      if (!admin) throw adminError("NOT_AUTHENTICATED");
      if (admin.role !== "volunteer") throw adminError("VOLUNTEER_ONLY");
      return {
        canCheckIn: admin.canCheckIn === true,
        canFoodCheckIn: admin.canFoodCheckIn === true,
        events: assignedEvents(admin.adminId).map(({ eventId, name, pointsAwarded, startsAt, endsAt }) => ({ eventId, name, pointsAwarded, startsAt, endsAt })),
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
          reason: null,
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
    default:
      throw new Error(`Unhandled E2E mock query: ${path}`);
  }
}

export async function e2eMockRunMutation(path: string, args: Record<string, unknown>) {
  const sessionToken = String(args.sessionToken ?? "");
  const now = Date.now();

  switch (path) {
    case "admin/volunteerScan:resolveQrForScan": {
      const staff = requireVolunteer(sessionToken);
      const purpose = String(args.purpose ?? "");
      const target = scanTarget(staff, args, purpose);
      if ("failure" in target) {
        return { status: target.failure === "event_denied" || target.failure === "event_inactive" ? "not_authorized" : target.failure };
      }
      const { participant, event } = target;
      if (event) {
        return {
          status: "ok",
          purpose: "point_scan",
          participant: { name: participant.name },
          event: { eventId: event.eventId, name: event.name, pointsAwarded: event.pointsAwarded },
          alreadyAwarded: participant.awardedEventIds.has(event.eventId),
        };
      }
      if (purpose === "check_in") {
        return {
          status: "ok",
          purpose,
          participant: { name: participant.name, checkedIn: participant.checkedInAt !== undefined, checkedInAt: participant.checkedInAt ?? null },
        };
      }
      return {
        status: "ok",
        purpose: "food_check_in",
        participant: {
          name: participant.name,
          foodCheckedIn: participant.foodCheckedInAt !== undefined,
          foodCheckedInAt: participant.foodCheckedInAt ?? null,
          dietaryInfo: participant.foodRestriction ?? null,
        },
      };
    }
    case "admin/volunteerOperations:checkInParticipant": {
      const staff = requireVolunteer(sessionToken);
      const target = scanTarget(staff, args, "check_in");
      if ("failure" in target) return { status: target.failure };
      if (target.participant.checkedInAt !== undefined) return { status: "already_checked_in", checkedInAt: target.participant.checkedInAt };
      target.participant.checkedInAt = now;
      logVolunteerAction({ actorAdminId: staff.adminId, action: "check_in", participantName: target.participant.name });
      bump();
      return { status: "success", checkedInAt: now };
    }
    case "admin/volunteerOperations:foodCheckInParticipant": {
      const staff = requireVolunteer(sessionToken);
      const target = scanTarget(staff, args, "food_check_in");
      if ("failure" in target) return { status: target.failure };
      if (target.participant.foodCheckedInAt !== undefined) {
        return { status: "already_food_checked_in", foodCheckedInAt: target.participant.foodCheckedInAt };
      }
      target.participant.foodCheckedInAt = now;
      logVolunteerAction({ actorAdminId: staff.adminId, action: "food_check_in", participantName: target.participant.name });
      bump();
      return { status: "success", foodCheckedInAt: now };
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
      const before = { canCheckIn: volunteer.canCheckIn === true, canFoodCheckIn: volunteer.canFoodCheckIn === true };
      const after = { canCheckIn: args.canCheckIn === true, canFoodCheckIn: args.canFoodCheckIn === true };
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
    default:
      throw new Error(`Unhandled E2E mock mutation: ${path}`);
  }
}
