import { v } from "convex/values";
import { query } from "../_generated/server";
import { getEventSchedule } from "../lib/eventConfig";
import { getAuthUser } from "../lib/applications";

const publicScheduleEntry = v.object({
  id: v.id("schedule"),
  title: v.string(),
  description: v.optional(v.string()),
  startsAt: v.number(),
  endsAt: v.number(),
  location: v.optional(v.string()),
  category: v.string(),
});

const participantSchedule = v.object({
  eventStartsAt: v.number(),
  eventEndsAt: v.number(),
  entries: v.array(publicScheduleEntry),
});

/** Returns the signed-in participant's live, active schedule. */
export const listPublicSchedule = query({
  args: {},
  returns: v.union(v.null(), participantSchedule),
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;

    const eventSchedule = await getEventSchedule(ctx);
    const entries = await ctx.db
      .query("schedule")
      .withIndex("by_active_startsAt", (q) => q.eq("active", true))
      .order("asc")
      .collect();

    return {
      eventStartsAt: eventSchedule.startsAt,
      eventEndsAt: eventSchedule.endsAt,
      entries: entries.map((entry) => ({
        id: entry._id,
        title: entry.title,
        ...(entry.description !== undefined ? { description: entry.description } : {}),
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        ...(entry.location !== undefined ? { location: entry.location } : {}),
        category: entry.category,
      })),
    };
  },
});
