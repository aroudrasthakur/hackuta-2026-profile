import type { ScheduleEntry } from "../../convex/api";

const HACKATHON_TIME_ZONE = "America/Chicago";
const CHECK_IN_TITLE = /^check[-\s]?in$/i;
const QUIET_TIME_TITLE = /^quiet\s+time$/i;
const MILESTONE_TITLE = /hacking\s+starts|hacking\s+ends|devpost\s+deadline/i;

export type ScheduleDay = {
  date: string;
  entries: ScheduleEntry[];
};

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function scheduleDayNumeral(dayNumber: number) {
  return ROMAN_NUMERALS[dayNumber - 1] ?? String(dayNumber);
}

export function scheduleDateKey(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: HACKATHON_TIME_ZONE,
  }).formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Could not format schedule date.");
  return `${year}-${month}-${day}`;
}

function nextDate(date: string) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function groupScheduleEntriesByDay(
  entries: ScheduleEntry[],
  eventStartsAt?: number,
  eventEndsAt?: number,
): ScheduleDay[] {
  const groups = new Map<string, ScheduleEntry[]>();

  if (
    eventStartsAt !== undefined &&
    eventEndsAt !== undefined &&
    eventEndsAt > eventStartsAt
  ) {
    const firstDate = scheduleDateKey(eventStartsAt);
    const lastDate = scheduleDateKey(eventEndsAt - 1);
    let date = firstDate;
    while (date <= lastDate) {
      groups.set(date, []);
      date = nextDate(date);
    }
  }

  for (const entry of entries) {
    const firstDate = scheduleDateKey(entry.startsAt);
    const lastDate = scheduleDateKey(Math.max(entry.startsAt, entry.endsAt - 1));
    let date = firstDate;
    while (date <= lastDate) {
      const group = groups.get(date) ?? [];
      group.push(entry);
      groups.set(date, group);
      date = nextDate(date);
    }
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dayEntries]) => ({
      date,
      entries: dayEntries.sort((left, right) => left.startsAt - right.startsAt),
    }));
}

export function formatScheduleDate(date: string, includeYear = false) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {}),
    timeZone: HACKATHON_TIME_ZONE,
  }).format(new Date(`${date}T12:00:00Z`));
}

export function formatScheduleTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: HACKATHON_TIME_ZONE,
  }).format(new Date(timestamp));
}

export function resolveScheduleDisplayCategory(
  entry: Pick<ScheduleEntry, "title" | "category">,
): string {
  const title = entry.title.trim();
  if (CHECK_IN_TITLE.test(title)) return "check_in";
  if (QUIET_TIME_TITLE.test(title)) return "check_in";
  if (MILESTONE_TITLE.test(title)) return "milestone";
  const normalized = entry.category
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (normalized === "quiet_time") return "check_in";
  return normalized || "event";
}

export function scheduleSlotCategoryClass(
  entry: Pick<ScheduleEntry, "title" | "category">,
  slotBlock = "participant-schedule__slot",
) {
  const slug = resolveScheduleDisplayCategory(entry).replace(/_/g, "-");
  return `${slotBlock}--cat-${slug}`;
}

