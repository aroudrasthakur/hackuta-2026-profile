import { paginationOptsValidator } from "convex/server";
import { v, type GenericId } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../lib/dataModel";
import { adminError } from "../../shared/admin/errors";
import { validateMeal } from "../../shared/admin/mealRules";
import { createdAtBounds, nameLookups } from "./adminQueryHelpers";
import { requireAdminRole, sessionTokenArgs } from "./staffAuth";

const mealArgs = {
  name: v.string(), description: v.optional(v.string()),
  startsAt: v.number(), endsAt: v.number(), active: v.boolean(),
};
const mealIdArgs = { ...sessionTokenArgs, mealPeriodId: v.id("mealPeriods") };

async function requireMeal(ctx: QueryCtx | MutationCtx, mealPeriodId: GenericId<"mealPeriods">) {
  const meal = await ctx.db.get(mealPeriodId);
  if (!meal) throw adminError("MEAL_NOT_FOUND");
  return meal;
}

/** The indexed read and subsequent write share a transaction, including concurrent edits. */
async function checkOverlap(
  ctx: MutationCtx,
  meal: { active: boolean; startsAt: number; endsAt: number },
  exceptId?: GenericId<"mealPeriods">,
) {
  if (!meal.active) return;
  const overlap = await ctx.db.query("mealPeriods")
    .withIndex("by_active_startsAt", (q) => q.eq("active", true).lt("startsAt", meal.endsAt))
    .filter((q) => q.and(q.gt(q.field("endsAt"), meal.startsAt), q.neq(q.field("_id"), exceptId ?? null)))
    .first();
  if (overlap) throw adminError("MEAL_OVERLAP");
}

/** Reactive source for schedules and served counts. Status is derived from time in the UI. */
export const listMealPeriods = query({
  args: sessionTokenArgs,
  handler: async (ctx, { sessionToken }) => {
    await requireAdminRole(ctx, sessionToken);
    const meals = await ctx.db.query("mealPeriods").withIndex("by_startsAt").collect();
    return meals.map((meal) => ({
      ...meal,
      // A partial backfill must never appear as an authoritative count.
      served: meal.servedCount === undefined || meal.servedCountBackfillCursor !== undefined
        ? null : meal.servedCount,
    }));
  },
});

export const createMealPeriod = mutation({
  args: { ...sessionTokenArgs, ...mealArgs },
  handler: async (ctx, { sessionToken, active, ...input }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const fields = { ...validateMeal(input), active };
    await checkOverlap(ctx, fields);
    const now = Date.now();
    const { description, ...required } = fields;
    const mealPeriodId = await ctx.db.insert("mealPeriods", {
      ...required, ...(description ? { description } : {}), createdBy: actor._id, servedCount: 0, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id, action: "meal_created", targetMealPeriodId: mealPeriodId,
      details: JSON.stringify({ after: fields }), createdAt: now,
    });
    return { mealPeriodId };
  },
});

export const updateMealPeriod = mutation({
  args: { ...mealIdArgs, ...mealArgs },
  handler: async (ctx, { sessionToken, mealPeriodId, active, ...input }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const previous = await requireMeal(ctx, mealPeriodId);
    const fields = { ...validateMeal(input), active };
    await checkOverlap(ctx, fields, mealPeriodId);
    const now = Date.now();
    await ctx.db.patch(mealPeriodId, { ...fields, updatedAt: now });
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id, action: "meal_updated", targetMealPeriodId: mealPeriodId,
      details: JSON.stringify({ before: {
        name: previous.name, description: previous.description, startsAt: previous.startsAt,
        endsAt: previous.endsAt, active: previous.active,
      }, after: fields }), createdAt: now,
    });
    return { ok: true };
  },
});

export const setMealPeriodActive = mutation({
  args: { ...mealIdArgs, active: v.boolean() },
  handler: async (ctx, { sessionToken, mealPeriodId, active }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const meal = await requireMeal(ctx, mealPeriodId);
    if (meal.active === active) return { ok: true };
    await checkOverlap(ctx, { ...meal, active }, mealPeriodId);
    const now = Date.now();
    await ctx.db.patch(mealPeriodId, { active, updatedAt: now });
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id, action: "meal_active_changed", targetMealPeriodId: mealPeriodId,
      details: JSON.stringify({ name: meal.name, before: { active: meal.active }, after: { active } }), createdAt: now,
    });
    return { ok: true };
  },
});

export const removeMealPeriod = mutation({
  args: mealIdArgs,
  handler: async (ctx, { sessionToken, mealPeriodId }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const meal = await requireMeal(ctx, mealPeriodId);
    const redemption = await ctx.db.query("mealRedemptions")
      .withIndex("by_meal", (q) => q.eq("mealPeriodId", mealPeriodId)).first();
    if (redemption) throw adminError("MEAL_HAS_REDEMPTIONS");
    const now = Date.now();
    await ctx.db.delete(mealPeriodId);
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id, action: "meal_removed", targetMealPeriodId: mealPeriodId,
      details: JSON.stringify({ name: meal.name, startsAt: meal.startsAt, endsAt: meal.endsAt }), createdAt: now,
    });
    return { ok: true };
  },
});

/** Names and collection times only; no QR tokens, dietary information, or applicant answers. */
export const listMealRedemptions = query({
  args: {
    ...mealIdArgs, paginationOpts: paginationOptsValidator,
    from: v.optional(v.number()), to: v.optional(v.number()),
  },
  handler: async (ctx, { sessionToken, mealPeriodId, paginationOpts, from, to }) => {
    await requireAdminRole(ctx, sessionToken);
    await requireMeal(ctx, mealPeriodId);
    const { lower, upper } = createdAtBounds(from, to);
    const result = await ctx.db.query("mealRedemptions")
      .withIndex("by_meal", (q) => q.eq("mealPeriodId", mealPeriodId).gte("redeemedAt", lower).lte("redeemedAt", upper))
      .order("desc").paginate(paginationOpts);
    const names = nameLookups(ctx);
    const page = await Promise.all(result.page.map(async (row) => ({
      redemptionId: row._id,
      participantName: await names.participantName(row.participantId),
      scannedByName: await names.staffName(row.scannedBy),
      redeemedAt: row.redeemedAt,
    })));
    return { ...result, page };
  },
});
