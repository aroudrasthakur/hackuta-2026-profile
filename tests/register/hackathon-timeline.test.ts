import { describe, expect, it } from "vitest";
import {
  formatCentralRegistrationTime,
  HACKATHON_SCHEDULE,
  resolveHackathonTimelineSource,
} from "../../shared/hackathon/schedule";
import { buildHackathonTimeline } from "../../shared/hackathon/timeline";

describe("buildHackathonTimeline", () => {
  const baseHackathon = HACKATHON_SCHEDULE;

  it("returns the hackathon milestones in order", () => {
    const timeline = buildHackathonTimeline(baseHackathon);

    expect(timeline.map((event) => event.label)).toEqual([
      "Applications open",
      "Applications close",
      "Decisions go out",
      "The hackathon begins",
    ]);
  });

  it("marks milestones complete once their date has passed", () => {
    const timeline = buildHackathonTimeline(
      baseHackathon,
      Date.parse("2026-11-08T12:00:00-06:00"),
    );

    expect(timeline.find((event) => event.id === "applications-open")?.complete).toBe(true);
    expect(timeline.find((event) => event.id === "application-deadline")).toMatchObject({
      complete: false,
      dateLabel: "To be announced",
      timestamp: null,
    });
    expect(timeline.find((event) => event.id === "decisions-out")).toMatchObject({
      complete: false,
      dateLabel: "To be announced",
      timestamp: null,
    });
  });

  it("uses a confirmed decision date when organizers publish one", () => {
    const decisionsReleasedAt = Date.parse("2026-11-10T09:00:00-06:00");
    const timeline = buildHackathonTimeline({
      ...baseHackathon,
      decisionsReleasedAt,
    });

    expect(timeline.find((event) => event.id === "decisions-out")).toMatchObject({
      timestamp: decisionsReleasedAt,
      complete: false,
    });
    expect(timeline.find((event) => event.id === "decisions-out")?.dateLabel).toBeUndefined();
  });

  it("preserves a configured close time and formats it in Central time", () => {
    const closesAt = Date.parse("2026-12-15T18:00:00Z");
    const source = resolveHackathonTimelineSource({
      ...HACKATHON_SCHEDULE,
      registrationClosesAt: closesAt,
    });
    expect(source.registrationClosesAt).toBe(closesAt);
    expect(buildHackathonTimeline(source, closesAt)[1]).toMatchObject({
      timestamp: closesAt,
      complete: true,
    });
    expect(formatCentralRegistrationTime(closesAt)).toContain("12:00 PM CST");
    expect(formatCentralRegistrationTime(Date.parse("2026-09-15T18:00:00Z"))).toContain("1:00 PM CDT");
  });

  it("resolves opening and event dates from configured overrides", () => {
    const opensAt = HACKATHON_SCHEDULE.registrationOpensAt + 60_000;
    const startsAt = HACKATHON_SCHEDULE.startsAt + 60_000;
    const endsAt = HACKATHON_SCHEDULE.endsAt + 60_000;
    const source = resolveHackathonTimelineSource({
      ...HACKATHON_SCHEDULE,
      registrationOpensAt: opensAt,
      startsAt,
      endsAt,
    });
    expect(source).toMatchObject({ registrationOpensAt: opensAt, startsAt, endsAt });
    expect(buildHackathonTimeline(source)[0]).toMatchObject({ timestamp: opensAt });
    expect(buildHackathonTimeline(source)[3]).toMatchObject({ timestamp: startsAt });
  });

  it("uses the canonical schedule constants", () => {
    expect(HACKATHON_SCHEDULE.registrationOpensAt).toBe(
      Date.parse("2026-09-25T00:00:00-05:00"),
    );
    expect(HACKATHON_SCHEDULE.registrationClosesAt).toBeNull();
    expect(HACKATHON_SCHEDULE.startsAt).toBe(Date.parse("2026-11-14T09:00:00-06:00"));
  });
});
