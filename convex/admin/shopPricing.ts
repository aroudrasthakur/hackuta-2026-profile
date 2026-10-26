/**
 * Server-side shop pricing. **Internal helpers only** (not Convex entry points).
 *
 * The effective price is always worked out here, never taken from a client.
 * A sale price applies while `startsAt <= now < endsAt` and the sale is not
 * cancelled. Overlapping sales for one item are rejected on write, so at most
 * one sale row matches.
 */
import type { DocumentByName } from "convex/server";
import type { GenericId } from "convex/values";
import type { DataModel, MutationCtx, QueryCtx } from "../lib/dataModel";

type ShopItemDoc = DocumentByName<DataModel, "shopItems">;
type ItemId = GenericId<"shopItems">;

export type EffectivePrice = {
  unitPointsCost: number;
  basePointsCost: number;
  flashSaleId: GenericId<"shopFlashSales"> | null;
  saleEndsAt: number | null;
};

/** Sale rows for an item that started at or before `now`, newest first. */
function startedSaleRows(ctx: QueryCtx | MutationCtx, itemId: ItemId, now: number) {
  return ctx.db
    .query("shopFlashSaleItems")
    .withIndex("by_item_startsAt", (q) => q.eq("itemId", itemId).lte("startsAt", now))
    .order("desc");
}

/** Current unit price for `item`. A sale never raises the price above the base cost. */
export async function effectivePrice(
  ctx: QueryCtx | MutationCtx,
  item: ShopItemDoc,
  now: number,
): Promise<EffectivePrice> {
  for await (const row of startedSaleRows(ctx, item._id, now)) {
    if (row.cancelled || row.endsAt <= now) continue;
    return {
      unitPointsCost: Math.min(row.salePointsCost, item.pointsCost),
      basePointsCost: item.pointsCost,
      flashSaleId: row.flashSaleId,
      saleEndsAt: row.endsAt,
    };
  }
  return { unitPointsCost: item.pointsCost, basePointsCost: item.pointsCost, flashSaleId: null, saleEndsAt: null };
}

/**
 * Next time after `now` that any of these items changes price (a sale starts
 * or ends), or null. Clients use it to re-query at that moment.
 */
export async function nextPriceChangeAt(
  ctx: QueryCtx | MutationCtx,
  itemIds: ItemId[],
  now: number,
) {
  let next: number | null = null;
  for (const itemId of itemIds) {
    const upcoming = ctx.db
      .query("shopFlashSaleItems")
      .withIndex("by_item_startsAt", (q) => q.eq("itemId", itemId).gt("startsAt", now))
      .order("asc");
    for await (const row of upcoming) {
      if (row.cancelled) continue;
      next = Math.min(next ?? row.startsAt, row.startsAt);
      break;
    }
    for await (const row of startedSaleRows(ctx, itemId, now)) {
      if (row.cancelled || row.endsAt <= now) continue;
      next = Math.min(next ?? row.endsAt, row.endsAt);
      break;
    }
  }
  return next;
}

/**
 * True when another, uncancelled sale for `itemId` overlaps `[startsAt, endsAt)`.
 * `ignoreSaleId` skips the sale being edited.
 */
export async function hasOverlappingSale(
  ctx: MutationCtx,
  args: {
    itemId: ItemId;
    startsAt: number;
    endsAt: number;
    ignoreSaleId?: GenericId<"shopFlashSales"> | undefined;
  },
) {
  const rows = ctx.db
    .query("shopFlashSaleItems")
    .withIndex("by_item_startsAt", (q) => q.eq("itemId", args.itemId).lt("startsAt", args.endsAt));
  for await (const row of rows) {
    if (row.cancelled || row.flashSaleId === args.ignoreSaleId) continue;
    if (row.endsAt > args.startsAt) return true;
  }
  return false;
}
