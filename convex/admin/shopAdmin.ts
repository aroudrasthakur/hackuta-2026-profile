/**
 * Administrator-only shop management: items, images, purchase history,
 * refunds, and which volunteers may sell. Every export calls
 * `requireAdminRole` first. Flash sales live in `shopFlashSales.ts`.
 *
 * Items are archived, never deleted.
 */
import { paginationOptsValidator, type DocumentByName } from "convex/server";
import { v, type GenericId } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { DataModel, MutationCtx, QueryCtx } from "../lib/dataModel";
import { adminError } from "../../shared/admin/errors";
import {
  normalizeShopItemInput,
  normalizeShopReason,
  SHOP_IMAGE_MAX_BYTES,
  SHOP_IMAGE_TYPES,
} from "../../shared/admin/shopRules";
import { buildStaffConfigDetails } from "../../shared/admin/volunteerRules";
import { nameLookups } from "./adminQueryHelpers";
import { shopItemStatus } from "./fields";
import { recordRefund } from "./shopLedger";
import { effectivePrice, nextPriceChangeAt } from "./shopPricing";
import { requireAdminRole, sessionTokenArgs, volunteerCapabilities } from "./staffAuth";

/** Most items one admin listing returns. The event shop is small. */
export const MAX_SHOP_ITEMS = 200;
export const MAX_SHOP_SEARCH_LENGTH = 100;

type ShopItemDoc = DocumentByName<DataModel, "shopItems">;
type StorageId = GenericId<"_storage">;

const itemFieldArgs = {
  name: v.string(),
  description: v.string(),
  pointsCost: v.number(),
  imageStorageId: v.optional(v.union(v.id("_storage"), v.null())),
};

function normalizeSearch(search: string | undefined) {
  const trimmed = search?.trim().toLowerCase() ?? "";
  if (trimmed.length > MAX_SHOP_SEARCH_LENGTH) throw adminError("INVALID_PARTICIPANT_FILTER");
  return trimmed;
}

/** Rejects uploads that are missing, not an allowed image type, or over 2 MB. */
async function assertShopImage(ctx: MutationCtx, storageId: StorageId) {
  const file = await ctx.db.system.get(storageId);
  const type = file?.contentType ?? "";
  if (!file || !(SHOP_IMAGE_TYPES as readonly string[]).includes(type) || file.size > SHOP_IMAGE_MAX_BYTES) {
    throw adminError("INVALID_SHOP_IMAGE");
  }
}

async function requireItem(ctx: MutationCtx, itemId: GenericId<"shopItems">) {
  const item = await ctx.db.get(itemId);
  if (!item) throw adminError("SHOP_ITEM_NOT_FOUND");
  return item;
}

/** Admin listing row. Omits image URLs; stored images are kept for other surfaces. */
export async function shopItemAdminView(ctx: QueryCtx | MutationCtx, item: ShopItemDoc, now: number) {
  const price = await effectivePrice(ctx, item, now);
  return {
    itemId: item._id,
    name: item.name,
    description: item.description,
    pointsCost: item.pointsCost,
    effectivePointsCost: price.unitPointsCost,
    flashSaleId: price.flashSaleId,
    saleEndsAt: price.saleEndsAt,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/** Upload URL for an item image. The image is checked when the item is saved. */
export const generateShopImageUploadUrl = mutation({
  args: sessionTokenArgs,
  handler: async (ctx, { sessionToken }) => {
    await requireAdminRole(ctx, sessionToken);
    return ctx.storage.generateUploadUrl();
  },
});

/** New item. Items start active unless `active` is false. */
export const createShopItem = mutation({
  args: {
    ...sessionTokenArgs,
    ...itemFieldArgs,
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { sessionToken, active, imageStorageId, ...fields }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const input = normalizeShopItemInput(fields);
    if (imageStorageId) await assertShopImage(ctx, imageStorageId);
    const now = Date.now();

    const itemId = await ctx.db.insert("shopItems", {
      name: input.name,
      description: input.description,
      pointsCost: input.pointsCost,
      status: active === false ? "inactive" : "active",
      ...(imageStorageId ? { imageStorageId } : {}),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id, action: "shop_item_created", targetShopItemId: itemId, createdAt: now,
    });
    return { itemId };
  },
});

/**
 * Edits item details and price. `imageStorageId: null` removes the image;
 * a replaced image is deleted. Past redemptions keep their own prices.
 */
export const updateShopItem = mutation({
  args: { ...sessionTokenArgs, itemId: v.id("shopItems"), ...itemFieldArgs },
  handler: async (ctx, { sessionToken, itemId, imageStorageId, ...fields }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const item = await requireItem(ctx, itemId);
    const input = normalizeShopItemInput(fields);
    if (imageStorageId) await assertShopImage(ctx, imageStorageId);

    const next = {
      name: input.name,
      description: input.description,
      pointsCost: input.pointsCost,
      imageStorageId: imageStorageId === undefined ? item.imageStorageId : imageStorageId ?? undefined,
    };
    const changedFields = (Object.keys(next) as Array<keyof typeof next>)
      .filter((key) => next[key] !== item[key]);
    if (changedFields.length === 0) return { ok: true as const, changed: false };

    const now = Date.now();
    await ctx.db.patch(itemId, { ...next, updatedAt: now });
    if (item.imageStorageId && item.imageStorageId !== next.imageStorageId) {
      await ctx.storage.delete(item.imageStorageId);
    }
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id, action: "shop_item_updated", targetShopItemId: itemId,
      details: buildStaffConfigDetails({ changedFields }), createdAt: now,
    });
    return { ok: true as const, changed: true };
  },
});

/** Activates, deactivates, or archives an item. Only active items can be sold. */
export const setShopItemStatus = mutation({
  args: { ...sessionTokenArgs, itemId: v.id("shopItems"), status: shopItemStatus },
  handler: async (ctx, { sessionToken, itemId, status }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const item = await requireItem(ctx, itemId);
    if (item.status === status) return { ok: true as const, changed: false };
    const now = Date.now();
    await ctx.db.patch(itemId, { status, updatedAt: now });
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id, action: "shop_item_updated", targetShopItemId: itemId,
      details: buildStaffConfigDetails({ changedFields: ["status"] }), createdAt: now,
    });
    return { ok: true as const, changed: true };
  },
});

/**
 * Every item for the management table, newest first, with live price.
 * `nowBucket` only changes the cache key so clients can re-run the
 * query as sales start and end; the server clock decides prices.
 */
export const listShopItemsAdmin = query({
  args: {
    ...sessionTokenArgs,
    status: v.optional(shopItemStatus),
    search: v.optional(v.string()),
    nowBucket: v.optional(v.number()),
  },
  handler: async (ctx, { sessionToken, status, search }) => {
    await requireAdminRole(ctx, sessionToken);
    const term = normalizeSearch(search);
    const now = Date.now();
    const rows = status
      ? await ctx.db.query("shopItems").withIndex("by_status", (q) => q.eq("status", status)).order("desc").take(MAX_SHOP_ITEMS)
      : await ctx.db.query("shopItems").order("desc").take(MAX_SHOP_ITEMS);
    const items = [];
    for (const item of rows) {
      if (term && !item.name.toLowerCase().includes(term)) continue;
      items.push(await shopItemAdminView(ctx, item, now));
    }
    return { items, nextPriceChangeAt: await nextPriceChangeAt(ctx, rows.map((row) => row._id), now) };
  },
});

/**
 * Purchase history, newest first. Filter by item, participant, or volunteer
 * through an index; `search` matches participant, item, or volunteer names
 * within each page, so a page can be shorter than requested while `isDone`
 * is false.
 */
export const listShopRedemptions = query({
  args: {
    ...sessionTokenArgs,
    paginationOpts: paginationOptsValidator,
    itemId: v.optional(v.id("shopItems")),
    participantId: v.optional(v.id("participants")),
    volunteerAdminId: v.optional(v.id("admins")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { sessionToken, paginationOpts, itemId, participantId, volunteerAdminId, search }) => {
    await requireAdminRole(ctx, sessionToken);
    const term = normalizeSearch(search);
    const table = ctx.db.query("shopRedemptions");
    const indexed = participantId
      ? table.withIndex("by_participant_redeemedAt", (q) => q.eq("participantId", participantId))
      : itemId
        ? table.withIndex("by_item_redeemedAt", (q) => q.eq("itemId", itemId))
        : volunteerAdminId
          ? table.withIndex("by_volunteer_redeemedAt", (q) => q.eq("redeemedBy", volunteerAdminId))
          : table.withIndex("by_redeemedAt");
    const result = await indexed.order("desc").paginate(paginationOpts);

    const names = nameLookups(ctx);
    const saleTitles = new Map<string, string>();
    const page = [];
    for (const row of result.page) {
      if (itemId && row.itemId !== itemId) continue;
      if (volunteerAdminId && row.redeemedBy !== volunteerAdminId) continue;
      const participantName = await names.participantName(row.participantId);
      const volunteerName = await names.staffName(row.redeemedBy);
      if (term && ![participantName, row.itemName, volunteerName].some((name) => name.toLowerCase().includes(term))) {
        continue;
      }
      let flashSale = null;
      if (row.flashSaleId) {
        if (!saleTitles.has(row.flashSaleId)) {
          saleTitles.set(row.flashSaleId, (await ctx.db.get(row.flashSaleId))?.title ?? "Flash sale");
        }
        flashSale = { flashSaleId: row.flashSaleId, title: saleTitles.get(row.flashSaleId)! };
      }
      page.push({
        redemptionId: row._id,
        participant: { participantId: row.participantId, name: participantName },
        item: { itemId: row.itemId, name: row.itemName },
        quantity: row.quantity,
        unitPointsCost: row.unitPointsCost,
        basePointsCost: row.basePointsCost,
        totalPointsSpent: row.totalPointsSpent,
        pointsBefore: row.pointsBefore,
        pointsAfter: row.pointsAfter,
        volunteer: { adminId: row.redeemedBy, name: volunteerName },
        redeemedAt: row.redeemedAt,
        flashSale,
        refund: row.refund
          ? {
            refundedAt: row.refund.refundedAt,
            reason: row.refund.reason,
            pointsRestored: row.refund.pointsRestored,
            refundedBy: { adminId: row.refund.refundedBy, name: await names.staffName(row.refund.refundedBy) },
          }
          : null,
      });
    }
    return { ...result, page };
  },
});

/** Refunds one purchase with a required reason. Points come back in full. */
export const refundShopRedemption = mutation({
  args: { ...sessionTokenArgs, redemptionId: v.id("shopRedemptions"), reason: v.string() },
  handler: async (ctx, { sessionToken, redemptionId, reason }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const redemption = await ctx.db.get(redemptionId);
    if (!redemption) throw adminError("REDEMPTION_NOT_FOUND");
    const result = await recordRefund(ctx, {
      actorAdminId: actor._id, redemption, reason: normalizeShopReason(reason), now: Date.now(),
    });
    return { ok: true as const, ...result };
  },
});

/** Active volunteers and their shop access, for the Shop volunteers panel. */
export const listShopVolunteers = query({
  args: sessionTokenArgs,
  handler: async (ctx, { sessionToken }) => {
    await requireAdminRole(ctx, sessionToken);
    const volunteers = await ctx.db.query("admins").withIndex("by_role", (q) => q.eq("role", "volunteer")).collect();
    return volunteers
      .filter((volunteer) => volunteer.active)
      .map((volunteer) => ({
        adminId: volunteer._id,
        name: volunteer.name,
        email: volunteer.email,
        canRedeemShop: volunteerCapabilities(volunteer).canRedeemShop,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Grants or removes `canRedeemShop`. Guards re-read it on every request. */
export const setVolunteerShopAccess = mutation({
  args: { ...sessionTokenArgs, volunteerAdminId: v.id("admins"), canRedeemShop: v.boolean() },
  handler: async (ctx, { sessionToken, volunteerAdminId, canRedeemShop }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const volunteer = await ctx.db.get(volunteerAdminId);
    if (!volunteer || volunteer.role !== "volunteer") throw adminError("VOLUNTEER_NOT_FOUND");
    const before = { canRedeemShop: volunteerCapabilities(volunteer).canRedeemShop };
    if (before.canRedeemShop === canRedeemShop) return { ok: true as const, changed: false };
    const now = Date.now();
    await ctx.db.patch(volunteerAdminId, { canRedeemShop, updatedAt: now });
    await ctx.db.insert("staffConfigLogs", {
      actorAdminId: actor._id, action: "volunteer_capabilities_updated", targetAdminId: volunteerAdminId,
      details: buildStaffConfigDetails({ changedFields: ["canRedeemShop"], before, after: { canRedeemShop } }),
      createdAt: now,
    });
    return { ok: true as const, changed: true };
  },
});
