/**
 * Volunteer shop sales. Every export needs a volunteer session with
 * `canRedeemShop === true`. See [VOLUNTEER_AUTHORIZATION.md](./VOLUNTEER_AUTHORIZATION.md).
 *
 * Catalog, customer, and preview queries are display only. `purchaseShopItem`
 * re-runs every check, works out the price itself, and needs the scanned
 * badge QR again, so a participant id alone can never be charged.
 *
 * Like the other scan mutations, purchase outcomes after the throttle row are
 * returned, not thrown, so the rate-limit rows are kept. Session and
 * capability failures throw before any write.
 */
import type { DocumentByName } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { DataModel, MutationCtx, QueryCtx } from "../lib/dataModel";
import {
  isValidIdempotencyKey,
  isValidPurchaseQuantity,
  SHOP_MAX_QUANTITY,
  stockStatus,
} from "../../shared/admin/shopRules";
import { nameLookups } from "./adminQueryHelpers";
import { computeLedgerPoints, isParticipantEligible } from "./pointsLedger";
import { participantBalance, purchaseReceipt, recordPurchase } from "./shopLedger";
import { effectivePrice, nextPriceChangeAt } from "./shopPricing";
import { requireVolunteerCapability, sessionTokenArgs } from "./staffAuth";
import { badgeHolderForScan } from "./volunteerScan";
import { isVolunteerScanThrottled, recordVolunteerScanAttempt } from "./volunteerScanRateLimit";

/** Most active items the volunteer catalog returns. */
export const MAX_CATALOG_ITEMS = 200;

type ShopItemDoc = DocumentByName<DataModel, "shopItems">;
type ParticipantDoc = DocumentByName<DataModel, "participants">;

function requireShopVolunteer(ctx: QueryCtx | MutationCtx, sessionToken: string) {
  return requireVolunteerCapability(ctx, sessionToken, "canRedeemShop");
}

/** Read-only balance for queries; mutations use `participantBalance`. */
async function displayBalance(ctx: QueryCtx, participant: ParticipantDoc) {
  return participant.points ?? await computeLedgerPoints(ctx, participant._id);
}

async function catalogItem(ctx: QueryCtx, item: ShopItemDoc, now: number) {
  const price = await effectivePrice(ctx, item, now);
  return {
    itemId: item._id,
    name: item.name,
    description: item.description,
    imageUrl: item.imageStorageId ? await ctx.storage.getUrl(item.imageStorageId) : null,
    unitPointsCost: price.unitPointsCost,
    basePointsCost: price.basePointsCost,
    flashSaleId: price.flashSaleId,
    saleEndsAt: price.saleEndsAt,
    stockQuantity: item.stockQuantity,
    stockStatus: stockStatus(item.stockQuantity, item.lowStockThreshold),
    featured: item.featured,
  };
}

/**
 * Active items with live stock and the price charged right now, featured
 * first. `nowBucket` only changes the cache key so the list re-runs as sales
 * start and end.
 */
export const listShopCatalogForVolunteer = query({
  args: { ...sessionTokenArgs, nowBucket: v.optional(v.number()) },
  handler: async (ctx, { sessionToken }) => {
    await requireShopVolunteer(ctx, sessionToken);
    const now = Date.now();
    const rows = await ctx.db.query("shopItems")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(MAX_CATALOG_ITEMS);
    const items = [];
    for (const item of rows) items.push(await catalogItem(ctx, item, now));
    items.sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name));
    return { items, maxQuantity: SHOP_MAX_QUANTITY, nextPriceChangeAt: await nextPriceChangeAt(ctx, rows.map((row) => row._id), now) };
  },
});

/** Live name and balance for the participant a volunteer just scanned. Null when not eligible. */
export const getShopCustomer = query({
  args: { ...sessionTokenArgs, participantId: v.id("participants") },
  handler: async (ctx, { sessionToken, participantId }) => {
    await requireShopVolunteer(ctx, sessionToken);
    const participant = await ctx.db.get(participantId);
    if (!participant || !await isParticipantEligible(ctx, participant)) return null;
    return {
      participantId,
      name: await nameLookups(ctx).participantName(participantId),
      points: await displayBalance(ctx, participant),
    };
  },
});

/**
 * Totals for the review screen. Display only: the purchase checks everything
 * again. Pass `unitPointsCost` back as `expectedUnitPointsCost` on purchase.
 */
export const previewShopPurchase = query({
  args: {
    ...sessionTokenArgs,
    participantId: v.id("participants"),
    itemId: v.id("shopItems"),
    quantity: v.number(),
    nowBucket: v.optional(v.number()),
  },
  handler: async (ctx, { sessionToken, participantId, itemId, quantity }) => {
    const volunteer = await requireShopVolunteer(ctx, sessionToken);
    const participant = await ctx.db.get(participantId);
    if (!participant || !await isParticipantEligible(ctx, participant)) {
      return { status: "participant_not_eligible" as const };
    }
    if (volunteer.participantId === participantId) return { status: "self_purchase_denied" as const };
    const item = await ctx.db.get(itemId);
    if (item?.status !== "active") return { status: "item_unavailable" as const };
    if (!isValidPurchaseQuantity(quantity)) return { status: "invalid_quantity" as const, maxQuantity: SHOP_MAX_QUANTITY };

    const price = await effectivePrice(ctx, item, Date.now());
    const points = await displayBalance(ctx, participant);
    const totalPointsCost = price.unitPointsCost * quantity;
    return {
      status: "ok" as const,
      unitPointsCost: price.unitPointsCost,
      basePointsCost: price.basePointsCost,
      flashSaleId: price.flashSaleId,
      saleEndsAt: price.saleEndsAt,
      quantity,
      totalPointsCost,
      stockQuantity: item.stockQuantity,
      points,
      pointsAfter: points - totalPointsCost,
      hasEnoughPoints: points >= totalPointsCost,
      hasEnoughStock: item.stockQuantity >= quantity,
    };
  },
});

/**
 * Completes a physical purchase. Statuses: `success` and `duplicate` (both
 * with a receipt), `price_changed` (with the new price; nothing written),
 * `insufficient_points`, `insufficient_stock`, `item_unavailable`,
 * `invalid_quantity`, `invalid_request` (bad or reused key),
 * `participant_not_eligible`, `self_purchase_denied`, the badge statuses
 * from `resolveQrForScan` (`qr_not_found`, `registration_qr_replaced`,
 * `badge_retired`, `participant_not_checked_in`, `badge_not_assigned`), and
 * `rate_limited`. Only an assigned badge QR identifies the buyer.
 *
 * Reusing `idempotencyKey` for the same participant, item, and quantity
 * returns the first receipt and charges nothing.
 */
export const purchaseShopItem = mutation({
  args: {
    ...sessionTokenArgs,
    qrCodeToken: v.string(),
    itemId: v.id("shopItems"),
    quantity: v.number(),
    expectedUnitPointsCost: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { sessionToken, qrCodeToken, itemId, quantity, expectedUnitPointsCost, idempotencyKey }) => {
    const volunteer = await requireShopVolunteer(ctx, sessionToken);
    const now = Date.now();
    if (await isVolunteerScanThrottled(ctx, volunteer._id, now)) return { status: "rate_limited" as const };
    await recordVolunteerScanAttempt(ctx, volunteer._id, now);

    if (!isValidIdempotencyKey(idempotencyKey)) return { status: "invalid_request" as const };
    const found = await badgeHolderForScan(ctx, volunteer._id, now, qrCodeToken);
    if ("failure" in found) return found.failure;
    const { participant } = found;

    const existing = await ctx.db.query("shopRedemptions")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .first();
    if (existing) {
      const same = existing.participantId === participant._id && existing.itemId === itemId &&
        existing.quantity === quantity && existing.redeemedBy === volunteer._id;
      return same
        ? { status: "duplicate" as const, receipt: purchaseReceipt(existing) }
        : { status: "invalid_request" as const };
    }

    if (!await isParticipantEligible(ctx, participant)) return { status: "participant_not_eligible" as const };
    if (volunteer.participantId === participant._id) return { status: "self_purchase_denied" as const };
    const item = await ctx.db.get(itemId);
    if (item?.status !== "active") return { status: "item_unavailable" as const };
    if (!isValidPurchaseQuantity(quantity)) return { status: "invalid_quantity" as const, maxQuantity: SHOP_MAX_QUANTITY };

    const price = await effectivePrice(ctx, item, now);
    if (price.unitPointsCost !== expectedUnitPointsCost) {
      return { status: "price_changed" as const, unitPointsCost: price.unitPointsCost, totalPointsCost: price.unitPointsCost * quantity };
    }
    if (item.stockQuantity < quantity) {
      return { status: "insufficient_stock" as const, stockQuantity: item.stockQuantity };
    }
    const points = await participantBalance(ctx, participant);
    const totalPointsCost = price.unitPointsCost * quantity;
    if (points < totalPointsCost) {
      return { status: "insufficient_points" as const, points, totalPointsCost };
    }

    const receipt = await recordPurchase(ctx, {
      actorAdminId: volunteer._id, participant, item, quantity, price, idempotencyKey, now,
    });
    return { status: "success" as const, receipt };
  },
});
