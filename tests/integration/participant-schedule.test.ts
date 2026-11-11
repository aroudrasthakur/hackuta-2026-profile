import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { insertMissingScheduleEntries } from "../../convex/profile/scheduleMigration";
import { listPublicScheduleRef } from "../../src/convex/api";
import { createConvexTest } from "../helpers/convexTestContext";

const migrateLegacyWeekendScheduleRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { ok: true; inserted: number; alreadyPresent: number }
>("profile/scheduleMigration:migrateLegacyWeekendSchedule");

describe("participant schedule query", () => {
  it("returns the live schedule without authentication", async () => {
    const t = createConvexTest();
    const schedule = await t.query(listPublicScheduleRef, {});
    expect(schedule.entries).toEqual([]);
    expect(schedule.eventEndsAt).toBeGreaterThan(schedule.eventStartsAt);
  });

  it("returns only active entries in chronological order with participant UI fields", async () => {
    const t = createConvexTest();
    const entries = await t.run(async (ctx) => {
      const later = await ctx.db.insert("schedule", {
        title: "Closing ceremony",
        startsAt: 2_000,
        endsAt: 3_000,
        category: "event",
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const inactive = await ctx.db.insert("schedule", {
        title: "Hidden event",
        startsAt: 1_000,
        endsAt: 1_500,
        category: "announcement",
        active: false,
        createdAt: 1,
        updatedAt: 1,
      });
      const earlier = await ctx.db.insert("schedule", {
        title: "Opening remarks",
        description: "Welcome",
        startsAt: 1_500,
        endsAt: 1_800,
        location: "Main stage",
        category: "event",
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      return { earlier, inactive, later };
    });

    const schedule = await t.query(listPublicScheduleRef, {});

    expect(schedule?.entries.map((entry) => entry.title)).toEqual(["Opening remarks", "Closing ceremony"]);
    expect(schedule?.entries.map((entry) => entry.id)).toEqual([entries.earlier, entries.later]);
    expect(schedule?.entries[0]).toMatchObject({
      description: "Welcome",
      startsAt: 1_500,
      endsAt: 1_800,
      location: "Main stage",
      category: "event",
    });
    expect(schedule?.eventEndsAt).toBeGreaterThan(schedule?.eventStartsAt ?? 0);
    expect(JSON.stringify(schedule)).not.toContain("createdAt");
  });

  it("runs the legacy seed safely more than once", async () => {
    const t = createConvexTest();
    await expect(t.mutation(migrateLegacyWeekendScheduleRef, {})).resolves.toEqual({
      ok: true,
      inserted: 0,
      alreadyPresent: 0,
    });
    await expect(t.mutation(migrateLegacyWeekendScheduleRef, {})).resolves.toEqual({
      ok: true,
      inserted: 0,
      alreadyPresent: 0,
    });
    await expect(t.run((ctx) => ctx.db.query("schedule").collect())).resolves.toHaveLength(0);
  });

  it("inserts missing legacy entries once and skips matching rows on retry", async () => {
    const t = createConvexTest();
    const seed = [
      {
        title: "Opening remarks",
        description: "Welcome",
        startsAt: 1_000,
        endsAt: 2_000,
        location: "Main stage",
        category: "event",
        active: true,
      },
      {
        title: "Opening remarks",
        startsAt: 1_000,
        endsAt: 2_500,
        category: "event",
        active: true,
      },
    ];

    await expect(
      t.run((ctx) => insertMissingScheduleEntries(ctx, seed, 50)),
    ).resolves.toEqual({ ok: true, inserted: 2, alreadyPresent: 0 });
    await expect(
      t.run((ctx) => insertMissingScheduleEntries(ctx, seed, 90)),
    ).resolves.toEqual({ ok: true, inserted: 0, alreadyPresent: 2 });

    const rows = await t.run((ctx) => ctx.db.query("schedule").collect());
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.endsAt).sort()).toEqual([2_000, 2_500]);
  });
});
