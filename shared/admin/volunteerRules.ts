import { adminError } from "./errors.ts";

/** Longest stored admin point-adjustment note. */
export const ADJUSTMENT_REASON_MAX_LENGTH = 200;
export const EVENT_NAME_MAX_LENGTH = 120;
export const EVENT_DESCRIPTION_MAX_LENGTH = 2_000;
export const EVENT_POINTS_MAX = 100_000;

const STAFF_CONFIG_KEYS = [
  "changedFields",
  "eventIds",
  "addedEventIds",
  "removedEventIds",
  "before",
  "after",
] as const;

type StaffConfigKey = (typeof STAFF_CONFIG_KEYS)[number];

/** Keys allowed inside a `before` / `after` snapshot, with their value type. */
const SNAPSHOT_KEYS: Record<string, "boolean" | "integer"> = {
  canCheckIn: "boolean",
  canFoodCheckIn: "boolean",
  active: "boolean",
  pointsAwarded: "integer",
  startsAt: "integer",
  endsAt: "integer",
};

export type EventStatus = "inactive" | "upcoming" | "active" | "ended";

/**
 * UI schedule label only. Not an authorization helper — do not use this to
 * allow or deny awards.
 *
 * `"active"` here means "switched on and currently inside `startsAt`/`endsAt`".
 * Award, preview, ledger, and staff-guard code check `event.active` only.
 * `startsAt` / `endsAt` are reference metadata and do not gate scanning.
 */
export function eventStatus(event: { active: boolean; startsAt: number; endsAt: number }, now: number): EventStatus {
  if (!event.active) return "inactive";
  if (now < event.startsAt) return "upcoming";
  return now < event.endsAt ? "active" : "ended";
}

const CHANGED_FIELD_NAMES = new Set([
  "name",
  "description",
  "pointsAwarded",
  "startsAt",
  "endsAt",
  "active",
  "canCheckIn",
  "canFoodCheckIn",
  "eventIds",
  "role",
  "participantId",
]);

/** Convex ids are short and alphanumeric. Longer strings would fit a QR token. */
const DETAIL_ID_PATTERN = /^[A-Za-z0-9]+$/;
const DETAIL_ID_MAX_LENGTH = 40;
const DETAIL_LIST_MAX_LENGTH = 50;

const DETAILS_NOT_ALLOWED = "Staff config details are not allowed.";

export type EventScheduleInput = {
  name: string;
  description?: string | null;
  pointsAwarded: number;
  startsAt: number;
  endsAt: number;
};

export type NormalizedEventInput = {
  name: string;
  description?: string;
  pointsAwarded: number;
  startsAt: number;
  endsAt: number;
};

function rejectDetails(): never {
  throw new Error(DETAILS_NOT_ALLOWED);
}

/** Cached balance: whole number, zero or greater, inside the safe integer range. */
export function assertPointBalance(points: number): number {
  if (!Number.isSafeInteger(points) || points < 0) {
    throw adminError("INVALID_POINTS");
  }
  return points;
}

/** Signed admin adjustment. Zero is not a change. */
export function assertAdjustmentDelta(delta: number): number {
  if (!Number.isSafeInteger(delta) || delta === 0) {
    throw adminError("INVALID_POINTS");
  }
  return delta;
}

/** Trims an admin adjustment note. Empty, over-long, or non-string notes are `INVALID_ADJUSTMENT_REASON`. */
export function normalizeAdjustmentReason(reason: string): string {
  if (typeof reason !== "string") {
    throw adminError("INVALID_ADJUSTMENT_REASON");
  }
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > ADJUSTMENT_REASON_MAX_LENGTH) {
    throw adminError("INVALID_ADJUSTMENT_REASON");
  }
  return trimmed;
}

/** Rejects anything but a whole number from 1 to `EVENT_POINTS_MAX`. */
export function assertEventPoints(points: number): number {
  if (!Number.isSafeInteger(points) || points <= 0 || points > EVENT_POINTS_MAX) {
    throw adminError("INVALID_EVENT");
  }
  return points;
}

/**
 * Trims event fields and rejects an empty or over-long name, an over-long
 * description, out-of-range points, or a bad window.
 */
export function normalizeEventInput(input: EventScheduleInput): NormalizedEventInput {
  if (typeof input.name !== "string") {
    throw adminError("INVALID_EVENT");
  }
  const name = input.name.trim();
  if (!name || name.length > EVENT_NAME_MAX_LENGTH) {
    throw adminError("INVALID_EVENT");
  }

  let description: string | undefined;
  if (input.description != null) {
    if (typeof input.description !== "string") {
      throw adminError("INVALID_EVENT");
    }
    const trimmed = input.description.trim();
    if (trimmed.length > EVENT_DESCRIPTION_MAX_LENGTH) {
      throw adminError("INVALID_EVENT");
    }
    if (trimmed) {
      description = trimmed;
    }
  }

  assertEventPoints(input.pointsAwarded);
  if (
    !Number.isSafeInteger(input.startsAt) ||
    !Number.isSafeInteger(input.endsAt) ||
    input.startsAt >= input.endsAt
  ) {
    throw adminError("INVALID_EVENT");
  }

  return {
    name,
    pointsAwarded: input.pointsAwarded,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    ...(description !== undefined ? { description } : {}),
  };
}
function readIdList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > DETAIL_LIST_MAX_LENGTH) {
    rejectDetails();
  }
  return value.map((item) => {
    if (typeof item !== "string" || !DETAIL_ID_PATTERN.test(item) || item.length > DETAIL_ID_MAX_LENGTH) {
      rejectDetails();
    }
    return item;
  });
}

function readChangedFields(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > DETAIL_LIST_MAX_LENGTH) {
    rejectDetails();
  }
  return value.map((item) => {
    if (typeof item !== "string" || !CHANGED_FIELD_NAMES.has(item)) {
      rejectDetails();
    }
    return item;
  });
}

function readSnapshot(value: unknown): Record<string, boolean | number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    rejectDetails();
  }
  const input = value as Record<string, unknown>;
  const snapshot: Record<string, boolean | number> = {};
  for (const key of Object.keys(input)) {
    const item = input[key];
    const kind = Object.prototype.hasOwnProperty.call(SNAPSHOT_KEYS, key) ? SNAPSHOT_KEYS[key] : undefined;
    if (kind === "boolean" ? typeof item !== "boolean" : kind !== "integer" || !Number.isSafeInteger(item)) {
      rejectDetails();
    }
    snapshot[key] = item as boolean | number;
  }
  return snapshot;
}

function readDetailValue(key: StaffConfigKey, value: unknown): unknown {
  switch (key) {
    case "changedFields":
      return readChangedFields(value);
    case "eventIds":
    case "addedEventIds":
    case "removedEventIds":
      return readIdList(value);
    case "before":
    case "after":
      return readSnapshot(value);
  }
}

/**
 * JSON for `staffConfigLogs.details`. Only allowlisted keys and non-text values
 * are accepted, so a log cannot store a QR token, password, or dietary note.
 */
export function buildStaffConfigDetails(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  for (const key of keys) {
    if (!STAFF_CONFIG_KEYS.includes(key as StaffConfigKey)) {
      throw new Error(DETAILS_NOT_ALLOWED);
    }
  }

  const details: Record<string, unknown> = {};
  for (const key of STAFF_CONFIG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key) || input[key] === undefined) {
      continue;
    }
    details[key] = readDetailValue(key, input[key]);
  }
  return JSON.stringify(details);
}
