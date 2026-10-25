import { adminError } from "./errors";

/** Longest stored admin point-adjustment note. */
export const ADJUSTMENT_REASON_MAX_LENGTH = 200;

const STAFF_CONFIG_KEYS = [
  "changedFields",
  "canCheckIn",
  "canFoodCheckIn",
  "active",
  "pointsAwarded",
  "startsAt",
  "endsAt",
  "eventIds",
] as const;

type StaffConfigKey = (typeof STAFF_CONFIG_KEYS)[number];

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

/** Trims an admin adjustment note. Empty and over-long notes are rejected. */
export function normalizeAdjustmentReason(reason: string): string {
  if (typeof reason !== "string") {
    throw adminError("INVALID_POINTS");
  }
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > ADJUSTMENT_REASON_MAX_LENGTH) {
    throw adminError("INVALID_POINTS");
  }
  return trimmed;
}

/** Trims event fields and rejects an empty name, non-positive points, or a bad window. */
export function normalizeEventInput(input: EventScheduleInput): NormalizedEventInput {
  if (typeof input.name !== "string") {
    throw adminError("INVALID_EVENT");
  }
  const name = input.name.trim();
  if (!name) {
    throw adminError("INVALID_EVENT");
  }

  let description: string | undefined;
  if (input.description != null) {
    if (typeof input.description !== "string") {
      throw adminError("INVALID_EVENT");
    }
    const trimmed = input.description.trim();
    if (trimmed) {
      description = trimmed;
    }
  }

  if (!Number.isSafeInteger(input.pointsAwarded) || input.pointsAwarded <= 0) {
    throw adminError("INVALID_EVENT");
  }
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

/** Event points can be awarded at `startsAt` and are closed at `endsAt`. */
export function isWithinEventWindow(
  event: { startsAt: number; endsAt: number },
  now: number,
): boolean {
  return event.startsAt <= now && now < event.endsAt;
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

function readDetailValue(key: StaffConfigKey, value: unknown): unknown {
  switch (key) {
    case "changedFields":
      return readChangedFields(value);
    case "eventIds":
      return readIdList(value);
    case "canCheckIn":
    case "canFoodCheckIn":
    case "active":
      if (typeof value !== "boolean") {
        rejectDetails();
      }
      return value;
    case "pointsAwarded":
    case "startsAt":
    case "endsAt":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        rejectDetails();
      }
      return value;
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
