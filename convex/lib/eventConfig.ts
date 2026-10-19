import { DEFAULT_HACKATHON_NAME } from "../../shared/hackathon/eventDefaults";
import {
  getRegistrationPhase,
  HACKATHON_SCHEDULE,
  resolveHackathonTimelineSource,
} from "../../shared/hackathon/schedule";
import { APPLICATION_CLOSED_MESSAGE, APPLICATION_NOT_OPEN_MESSAGE } from "../../shared/registration/submitErrors";
import type { EventConfigDoc, MutationCtx, QueryCtx } from "./dataModel";

export const EVENT_CONFIG_KEY = "current" as const;

export async function getEventConfigRow(ctx: QueryCtx) {
  return ctx.db
    .query("eventConfig")
    .withIndex("by_key", (q) => q.eq("key", EVENT_CONFIG_KEY))
    .first();
}

export async function ensureEventConfig(ctx: MutationCtx): Promise<EventConfigDoc> {
  const existing = await getEventConfigRow(ctx);
  if (existing) {
    return existing;
  }

  const now = Date.now();
  const id = await ctx.db.insert("eventConfig", {
    key: EVENT_CONFIG_KEY,
    name: DEFAULT_HACKATHON_NAME,
    ...HACKATHON_SCHEDULE,
    decisionsReleasedAt: null,
    updatedAt: now,
  });
  const created = await ctx.db.get(id);
  if (!created) {
    throw new Error("Event config could not be created.");
  }
  return created;
}

export async function getHackathonName(ctx: QueryCtx | MutationCtx) {
  const row = await getEventConfigRow(ctx);
  return row?.name ?? DEFAULT_HACKATHON_NAME;
}

export async function getEventSchedule(ctx: QueryCtx | MutationCtx) {
  return resolveHackathonTimelineSource(await getEventConfigRow(ctx));
}

export async function assertRegistrationOpen(ctx: QueryCtx | MutationCtx) {
  const phase = getRegistrationPhase(await getEventSchedule(ctx));
  if (phase === "upcoming") throw new Error(APPLICATION_NOT_OPEN_MESSAGE);
  if (phase === "closed") throw new Error(APPLICATION_CLOSED_MESSAGE);
}
