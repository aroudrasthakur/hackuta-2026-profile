import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { adminError } from "../../shared/admin/errors";

/**
 * Run for each legacy meal until isDone. The cursor and accumulator are stored
 * on the meal, so retries and concurrent invocations resume committed progress.
 * Marking each row also makes new redemptions safe during the backfill, including
 * ones inserted before the current cursor. No participant or audit data changes.
 */
export const backfillMealServedCount = internalMutation({
  args: { mealPeriodId: v.id("mealPeriods") },
  handler: async (ctx, { mealPeriodId }) => {
    const meal = await ctx.db.get(mealPeriodId);
    if (!meal) throw adminError("MEAL_NOT_FOUND");
    if (meal.servedCount !== undefined && meal.servedCountBackfillCursor === undefined) {
      return { scanned: 0, counted: 0, isDone: true };
    }
    const page = await ctx.db.query("mealRedemptions")
      .withIndex("by_meal", (q) => q.eq("mealPeriodId", mealPeriodId))
      .paginate({ numItems: 100, cursor: meal.servedCountBackfillCursor ?? null });
    let counted = 0;
    for (const row of page.page) {
      if (row.countedInServedCount) continue;
      await ctx.db.patch(row._id, { countedInServedCount: true });
      counted += 1;
    }
    await ctx.db.patch(mealPeriodId, {
      servedCount: (meal.servedCount ?? 0) + counted,
      servedCountBackfillCursor: page.isDone ? undefined : page.continueCursor,
    });
    return { scanned: page.page.length, counted, isDone: page.isDone };
  },
});
