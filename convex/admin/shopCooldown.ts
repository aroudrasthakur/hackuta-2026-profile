import type { DocumentByName } from "convex/server";
import type { GenericId } from "convex/values";
import type { DataModel, MutationCtx, QueryCtx } from "../lib/dataModel";

/** The indexed read and purchase insert share Convex's serializable transaction. */
export async function activePurchaseCooldown(
  ctx: QueryCtx | MutationCtx,
  checkedInId: GenericId<"checkedIn"> | undefined,
  item: DocumentByName<DataModel, "shopItems">,
  now: number,
) {
  if (item.purchaseCooldownMinutes === undefined || !checkedInId) return null;
  const duration = item.purchaseCooldownMinutes * 60_000;
  const latest = await ctx.db.query("shopRedemptions")
    .withIndex("by_checkedIn_item_redeemedAt", (q) => q
      .eq("checkedInId", checkedInId).eq("itemId", item._id)
      .gt("redeemedAt", now - duration))
    .filter((q) => q.eq(q.field("refund"), undefined))
    .order("desc")
    .first();
  if (!latest) return null;
  const availableAt = latest.redeemedAt + duration;
  return {
    status: "purchase_cooldown_active" as const,
    itemName: item.name,
    availableAt,
    remainingMs: availableAt - now,
  };
}
