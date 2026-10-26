/**
 * Administrator-only event management. Volunteers award an event's fixed
 * points through `volunteerOperations.ts`; this module only configures events.
 *
 * Every export calls `requireAdminRole` first. Changes are audited in
 * `staffConfigLogs` with `targetEventId` and before/after values. Points lock
 * once a participant has been awarded them (`eventHasAwards`). Awards are
 * possible only while `eventStatus` is `active` (switched on and inside the
 * window); the frontend derives the same status from these fields.
 */
import { paginationOptsValidator, type DocumentByName } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { DataModel, QueryCtx } from "../lib/dataModel";
import { adminError } from "../../shared/admin/errors";
import {
  assertEventPoints,
  buildStaffConfigDetails,
  normalizeEventInput,
} from "../../shared/admin/volunteerRules";
import { eventHasAwards } from "./pointsLedger";
import { requireAdminRole, sessionTokenArgs } from "./staffAuth";

type EventDoc = DocumentByName<DataModel, "events">;

const eventArgs = { ...sessionTokenArgs, eventId: v.id("events") };
const scheduleFields = {
  name: v.string(),
  description: v.optional(v.string()),
  startsAt: v.number(),
  endsAt: v.number(),
};
const changedResult = v.object({ ok: v.literal(true), changed: v.boolean() });

async function eventRow(ctx: QueryCtx, event: EventDoc) {
  return {
    eventId: event._id,
    name: event.name,
    description: event.description ?? null,
    pointsAwarded: event.pointsAwarded,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    active: event.active,
    pointsLocked: await eventHasAwards(ctx, event._id),
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

/** Every event, including inactive, upcoming, and ended ones. Newest first, paginated. */
export const listEvents = query({
  args: { ...sessionTokenArgs, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { sessionToken, paginationOpts }) => {
    await requireAdminRole(ctx, sessionToken);
    const result = await ctx.db.query("events").order("desc").paginate(paginationOpts);
    const page = [];
    for (const event of result.page) page.push(await eventRow(ctx, event));
    return { ...result, page };
  },
});

/** One event in the list shape, or null when it does not exist. */
export const getEvent = query({
  args: eventArgs,
  handler: async (ctx, { sessionToken, eventId }) => {
    await requireAdminRole(ctx, sessionToken);
    const event = await ctx.db.get(eventId);
    return event ? eventRow(ctx, event) : null;
  },
});

/** New events start switched on; awards still wait for `startsAt`. */
export const createEvent = mutation({
  args: { ...sessionTokenArgs, ...scheduleFields, pointsAwarded: v.number() },
  returns: v.object({ ok: v.literal(true), eventId: v.id("events") }),
  handler: async (ctx, { sessionToken, ...input }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const fields = normalizeEventInput(input);
    const now = Date.now();
    const eventId = await ctx.db.insert("events", {
      ...fields, active: true, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id,
      action: "event_created",
      targetEventId: eventId,
      details: buildStaffConfigDetails({
        after: { active: true, pointsAwarded: fields.pointsAwarded, startsAt: fields.startsAt, endsAt: fields.endsAt },
      }),
      createdAt: now,
    });
    return { ok: true as const, eventId };
  },
});

/**
 * Replaces name, description, and schedule. Points change only through
 * `setEventPoints`. Awards already given are never touched; a new window
 * applies to the next scan, and assignments are kept.
 */
export const updateEvent = mutation({
  args: { ...eventArgs, ...scheduleFields },
  returns: changedResult,
  handler: async (ctx, { sessionToken, eventId, ...input }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const event = await ctx.db.get(eventId);
    if (!event) throw adminError("EVENT_NOT_FOUND");
    const fields = normalizeEventInput({ ...input, pointsAwarded: event.pointsAwarded });

    const changedFields = (["name", "description", "startsAt", "endsAt"] as const)
      .filter((key) => event[key] !== fields[key]);
    if (changedFields.length === 0) return { ok: true as const, changed: false };

    const now = Date.now();
    await ctx.db.patch(eventId, {
      name: fields.name,
      description: fields.description,
      startsAt: fields.startsAt,
      endsAt: fields.endsAt,
      updatedAt: now,
    });
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id,
      action: "event_updated",
      targetEventId: eventId,
      details: buildStaffConfigDetails({
        changedFields,
        before: { startsAt: event.startsAt, endsAt: event.endsAt },
        after: { startsAt: fields.startsAt, endsAt: fields.endsAt },
      }),
      createdAt: now,
    });
    return { ok: true as const, changed: true };
  },
});

/** Rejects with `EVENT_POINTS_LOCKED` once any participant has the event's award. */
export const setEventPoints = mutation({
  args: { ...eventArgs, pointsAwarded: v.number() },
  returns: changedResult,
  handler: async (ctx, { sessionToken, eventId, pointsAwarded }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const event = await ctx.db.get(eventId);
    if (!event) throw adminError("EVENT_NOT_FOUND");
    assertEventPoints(pointsAwarded);
    if (event.pointsAwarded === pointsAwarded) return { ok: true as const, changed: false };
    if (await eventHasAwards(ctx, eventId)) throw adminError("EVENT_POINTS_LOCKED");

    const now = Date.now();
    await ctx.db.patch(eventId, { pointsAwarded, updatedAt: now });
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id,
      action: "event_updated",
      targetEventId: eventId,
      details: buildStaffConfigDetails({
        changedFields: ["pointsAwarded"],
        before: { pointsAwarded: event.pointsAwarded },
        after: { pointsAwarded },
      }),
      createdAt: now,
    });
    return { ok: true as const, changed: true };
  },
});

/** Switched-off events keep their assignments but reject scans (`event_inactive`). */
export const setEventActive = mutation({
  args: { ...eventArgs, active: v.boolean() },
  returns: changedResult,
  handler: async (ctx, { sessionToken, eventId, active }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const event = await ctx.db.get(eventId);
    if (!event) throw adminError("EVENT_NOT_FOUND");
    if (event.active === active) return { ok: true as const, changed: false };
    const now = Date.now();
    await ctx.db.patch(eventId, { active, updatedAt: now });
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id,
      action: "event_active_changed",
      targetEventId: eventId,
      details: buildStaffConfigDetails({ before: { active: event.active }, after: { active } }),
      createdAt: now,
    });
    return { ok: true as const, changed: true };
  },
});
