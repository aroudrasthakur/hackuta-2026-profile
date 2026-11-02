import { internalMutation } from "../_generated/server";

type ScheduleSeedEntry = {
  title: string;
  description?: string;
  startsAt: number;
  endsAt: number;
  location?: string;
  category: string;
  active: boolean;
};

// The previous participant schedule contained date tabs only; its activity lists were empty.
const INITIAL_SCHEDULE_ENTRIES: ScheduleSeedEntry[] = [];

/** Idempotently seeds legacy participant schedule activities when available. */
export const migrateLegacyWeekendSchedule = internalMutation({
  args: {},
  handler: async (ctx) => {
    let inserted = 0;
    let alreadyPresent = 0;
    const now = Date.now();

    for (const entry of INITIAL_SCHEDULE_ENTRIES) {
      const entriesAtStartTime = await ctx.db
        .query("schedule")
        .withIndex("by_startsAt", (q) => q.eq("startsAt", entry.startsAt))
        .collect();
      const exists = entriesAtStartTime.some((existing) =>
        existing.title === entry.title &&
        existing.endsAt === entry.endsAt &&
        existing.category === entry.category,
      );

      if (exists) {
        alreadyPresent += 1;
        continue;
      }

      await ctx.db.insert("schedule", {
        ...entry,
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }

    return { ok: true as const, inserted, alreadyPresent };
  },
});
