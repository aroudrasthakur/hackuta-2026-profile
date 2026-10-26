/**
 * Participant shop and announcements for the profile portal. Written in
 * hackuta-2026-admin and synced to hackuta-2026-profile with the rest of the
 * backend.
 *
 * Read only: participants cannot buy here; volunteers sell at the shop table.
 * Every query needs a signed-in applicant account and never returns other
 * participants' data, volunteer identities, or QR tokens. `nowBucket` only
 * changes the cache key so clients re-run the query as sales start and end;
 * the server clock decides prices.
 */
import { v, type GenericId } from "convex/values";
import { query } from "../_generated/server";
import { getAuthUser } from "../lib/applications";
import type { QueryCtx } from "../lib/dataModel";
import { stockStatus } from "../../shared/admin/shopRules";
import { flashSaleStatus } from "./shopFlashSales";
import { effectivePrice, nextPriceChangeAt } from "./shopPricing";

/** Most items, purchases, or announcements one call returns. */
export const MAX_PROFILE_SHOP_ROWS = 100;

async function myParticipant(ctx: QueryCtx) {
  const user = await getAuthUser(ctx);
  if (!user) return { user: null, participant: null };
  const participant = await ctx.db
    .query("participants")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", user._id))
    .unique();
  return { user, participant };
}

/** Active items, live sales, and the caller's balance (null when not a participant). Null when signed out. */
export const listShop = query({
  args: { nowBucket: v.optional(v.number()) },
  handler: async (ctx) => {
    const { user, participant } = await myParticipant(ctx);
    if (!user) return null;
    const now = Date.now();
    const rows = await ctx.db.query("shopItems")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(MAX_PROFILE_SHOP_ROWS);

    const items = [];
    const liveSaleIds = new Set<GenericId<"shopFlashSales">>();
    for (const item of rows) {
      const price = await effectivePrice(ctx, item, now);
      if (price.flashSaleId) liveSaleIds.add(price.flashSaleId);
      items.push({
        itemId: item._id,
        name: item.name,
        description: item.description,
        imageUrl: item.imageStorageId ? await ctx.storage.getUrl(item.imageStorageId) : null,
        pointsCost: price.unitPointsCost,
        basePointsCost: price.basePointsCost,
        onSale: price.flashSaleId !== null,
        saleEndsAt: price.saleEndsAt,
        stockQuantity: item.stockQuantity,
        stockStatus: stockStatus(item.stockQuantity, item.lowStockThreshold),
        featured: item.featured,
      });
    }
    items.sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name));

    const activeSales = [];
    for (const saleId of liveSaleIds) {
      const sale = await ctx.db.get(saleId);
      if (sale && flashSaleStatus(sale, now) === "live") {
        activeSales.push({ flashSaleId: sale._id, title: sale.title, message: sale.message, endsAt: sale.endsAt });
      }
    }
    activeSales.sort((a, b) => a.endsAt - b.endsAt);

    return {
      items,
      activeSales,
      points: participant ? participant.points ?? 0 : null,
      nextPriceChangeAt: await nextPriceChangeAt(ctx, rows.map((row) => row._id), now),
    };
  },
});

/** The caller's own purchases, newest first. No volunteer names. Empty when not a participant. */
export const getMyShopHistory = query({
  args: {},
  handler: async (ctx) => {
    const { participant } = await myParticipant(ctx);
    if (!participant) return [];
    const rows = await ctx.db.query("shopRedemptions")
      .withIndex("by_participant_redeemedAt", (q) => q.eq("participantId", participant._id))
      .order("desc")
      .take(MAX_PROFILE_SHOP_ROWS);
    return rows.map((row) => ({
      redemptionId: row._id,
      itemName: row.itemName,
      quantity: row.quantity,
      unitPointsCost: row.unitPointsCost,
      totalPointsSpent: row.totalPointsSpent,
      onSale: row.flashSaleId !== undefined,
      redeemedAt: row.redeemedAt,
      refunded: row.refund !== undefined,
    }));
  },
});

/** Published, not withdrawn announcements, newest first. Null when signed out. */
export const listMyAnnouncements = query({
  args: { nowBucket: v.optional(v.number()) },
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;
    const now = Date.now();
    const rows = await ctx.db.query("participantAnnouncements")
      .withIndex("by_publishedAt", (q) => q.lte("publishedAt", now))
      .order("desc")
      .take(MAX_PROFILE_SHOP_ROWS);
    return rows
      .filter((row) => row.withdrawnAt === undefined)
      .map((row) => ({
        announcementId: row._id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        publishedAt: row.publishedAt,
        expiresAt: row.expiresAt ?? null,
        active: row.expiresAt === undefined || row.expiresAt > now,
      }));
  },
});
