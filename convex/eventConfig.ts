import { v } from "convex/values";
import { DEFAULT_HACKATHON_NAME } from "../shared/hackathon/eventDefaults";
import { resolveHackathonTimelineSource } from "../shared/hackathon/schedule";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./lib/dataModel";
import {
  ensureEventConfig,
  getEventConfigRow,
  getHackathonName,
} from "./lib/eventConfig";

/** Public event metadata for the registration UI (no auth required). */
export const getPublicEventConfig = query({
  args: {},
  handler: async (ctx) => {
    const row = await getEventConfigRow(ctx);
    return {
      name: row?.name ?? DEFAULT_HACKATHON_NAME,
      ...resolveHackathonTimelineSource(row),
    };
  },
});

export const getHackathonNameInternal = internalQuery({
  args: {},
  handler: async (ctx) => getHackathonName(ctx),
});

/** Update the displayed hackathon name without redeploying the client. */
export const setHackathonName = internalMutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, { name }) => {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Hackathon name is required.");
    }

    const existing = await ensureEventConfig(ctx);
    const updatedAt = Date.now();
    await ctx.db.patch(existing._id, { name: trimmed, updatedAt });
    return { ok: true as const, name: trimmed, updatedAt };
  },
});

const optionalDate = v.optional(v.union(v.number(), v.null()));

type TimelineDatePatch = Partial<Record<
  "registrationOpensAt" | "registrationClosesAt" | "decisionsReleasedAt" | "startsAt" | "endsAt",
  number | null
>>;

async function updateTimelineDates(ctx: MutationCtx, changes: TimelineDatePatch) {
  const values = Object.values(changes);
  if (values.every((value) => value === undefined)) {
    throw new Error("At least one event date is required.");
  }
  if (values.some((value) => value !== null && value !== undefined && (
    !Number.isSafeInteger(value) || value <= 0 || !Number.isFinite(new Date(value).getTime())
  ))) {
    throw new Error("Invalid event date.");
  }

  const existing = await ensureEventConfig(ctx);
  const schedule = resolveHackathonTimelineSource({ ...existing, ...changes });
  const { registrationOpensAt, registrationClosesAt, decisionsReleasedAt, startsAt, endsAt } = schedule;
  if (registrationOpensAt >= startsAt || startsAt >= endsAt ||
    (registrationClosesAt !== null &&
      (registrationClosesAt <= registrationOpensAt || registrationClosesAt > startsAt)) ||
    (decisionsReleasedAt !== null && decisionsReleasedAt !== undefined &&
      (decisionsReleasedAt < registrationOpensAt || decisionsReleasedAt > startsAt ||
        (registrationClosesAt !== null && decisionsReleasedAt < registrationClosesAt)))) {
    throw new Error("Event dates must be in chronological order.");
  }

  const updatedAt = Date.now();
  await ctx.db.patch(existing._id, { ...schedule, updatedAt });
  return { ok: true as const, ...schedule, updatedAt };
}

export const setTimelineDates = internalMutation({
  args: {
    registrationOpensAt: optionalDate,
    registrationClosesAt: optionalDate,
    decisionsReleasedAt: optionalDate,
    startsAt: optionalDate,
    endsAt: optionalDate,
  },
  handler: async (ctx, dates) => updateTimelineDates(ctx, dates),
});

export const setRegistrationClosesAt = internalMutation({
  args: { closesAt: v.union(v.number(), v.null()) },
  handler: async (ctx, { closesAt }) => {
    if (closesAt !== null && (
      !Number.isSafeInteger(closesAt) || closesAt <= 0 || !Number.isFinite(new Date(closesAt).getTime())
    )) {
      throw new Error("Invalid application closing time.");
    }
    return updateTimelineDates(ctx, { registrationClosesAt: closesAt });
  },
});
