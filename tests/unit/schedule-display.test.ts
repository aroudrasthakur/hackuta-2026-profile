import { describe, expect, it } from "vitest";
import {
  formatScheduleDate,
  formatScheduleTime,
  groupScheduleEntriesByDay,
  scheduleDayNumeral,
  scheduleDateKey,
} from "../../src/components/participant/scheduleUtils";
import type { ScheduleEntry } from "../../src/convex/api";

const overnightActivity: ScheduleEntry = {
  id: "overnight",
  title: "Overnight activity",
  startsAt: Date.parse("2026-11-14T23:30:00-06:00"),
  endsAt: Date.parse("2026-11-15T01:00:00-06:00"),
  category: "event",
};

describe("participant schedule display", () => {
  it("numbers the first event day as I and the second as II", () => {
    expect(scheduleDayNumeral(1)).toBe("I");
    expect(scheduleDayNumeral(2)).toBe("II");
    expect(scheduleDayNumeral(3)).toBe("III");
  });

  it("groups spanning activities under every event-local calendar day", () => {
    const days = groupScheduleEntriesByDay([overnightActivity]);
    expect(days.map((day) => day.date)).toEqual(["2026-11-14", "2026-11-15"]);
    expect(days.map((day) => day.entries.map((entry) => entry.id))).toEqual([
      ["overnight"],
      ["overnight"],
    ]);
  });

  it("keeps configured event days visible when no activities are published", () => {
    const days = groupScheduleEntriesByDay(
      [],
      Date.parse("2026-11-14T09:00:00-06:00"),
      Date.parse("2026-11-15T18:00:00-06:00"),
    );
    expect(days.map((day) => day.date)).toEqual(["2026-11-14", "2026-11-15"]);
    expect(days.every((day) => day.entries.length === 0)).toBe(true);
  });

  it("uses the event timezone for dates and times", () => {
    const timestamp = Date.parse("2026-11-15T05:30:00Z");
    expect(scheduleDateKey(timestamp)).toBe("2026-11-14");
    expect(formatScheduleDate("2026-11-14")).toBe("Saturday, November 14");
    expect(formatScheduleTime(timestamp)).toBe("11:30 PM");
  });

  it("does not add the following date when an activity ends at midnight", () => {
    const endsAtMidnight: ScheduleEntry = {
      ...overnightActivity,
      endsAt: Date.parse("2026-11-15T00:00:00-06:00"),
    };
    expect(groupScheduleEntriesByDay([endsAtMidnight]).map((day) => day.date)).toEqual([
      "2026-11-14",
    ]);
  });
});
