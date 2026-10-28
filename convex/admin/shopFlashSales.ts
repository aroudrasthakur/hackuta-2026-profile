/**
 * Administrator-only flash sales. Every export calls `requireAdminRole` first.
 *
 * A sale is scheduled, live, or ended by its window; only cancellation is
 * stored. Prices are worked out in `shopPricing.ts`, so normal prices return
 * on their own when a sale ends. Each sale owns one `flash_sale` row in
 * `participantNotifications` that publishes at its start time and expires at
 * its end; cancelling withdraws it.
 */
import type { DocumentByName } from "convex/server";
import { v, type GenericId } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { DataModel, MutationCtx, QueryCtx } from "../lib/dataModel";
import { adminError } from "../../shared/admin/errors";
import { normalizeFlashSaleInput } from "../../shared/admin/shopRules";
import { buildStaffConfigDetails } from "../../shared/admin/volunteerRules";
import { cancelFlashSaleNotification, upsertFlashSaleNotification } from "./notifications";
import { hasOverlappingSale } from "./shopPricing";
import { requireAdminRole, sessionTokenArgs } from "./staffAuth";

/** Most sales one listing returns. */
export const MAX_FLASH_SALES = 200;

type SaleDoc = DocumentByName<DataModel, "shopFlashSales">;
type SaleId = GenericId<"shopFlashSales">;
type AdminId = GenericId<"admins">;
export type FlashSaleStatus = "scheduled" | "live" | "ended" | "cancelled";

const saleFieldArgs = {
  title: v.string(),
  message: v.string(),
  startsAt: v.number(),
  endsAt: v.number(),
  items: v.array(v.object({ itemId: v.id("shopItems"), salePointsCost: v.number() })),
};

type SaleInput = {
  title: string;
  message: string;
  startsAt: number;
  endsAt: number;
  items: Array<{ itemId: GenericId<"shopItems">; salePointsCost: number }>;
};

export function flashSaleStatus(sale: Pick<SaleDoc, "startsAt" | "endsAt" | "cancelledAt">, now: number): FlashSaleStatus {
  if (sale.cancelledAt !== undefined) return "cancelled";
  if (now < sale.startsAt) return "scheduled";
  if (now < sale.endsAt) return "live";
  return "ended";
}

/**
 * Validates text, window, and items. Each item must exist, not be archived,
 * and get a sale price below its base price; no item may already be in
 * another uncancelled sale that overlaps the window.
 */
async function validateSale(ctx: MutationCtx, args: SaleInput, now: number, ignoreSaleId?: SaleId) {
  const input = normalizeFlashSaleInput(args);
  if (input.endsAt <= now) throw adminError("INVALID_FLASH_SALE");
  for (const entry of input.items) {
    const item = await ctx.db.get(entry.itemId);
    if (!item) throw adminError("SHOP_ITEM_NOT_FOUND");
    if (item.status === "archived" || entry.salePointsCost >= item.pointsCost) {
      throw adminError("INVALID_FLASH_SALE");
    }
    if (await hasOverlappingSale(ctx, { itemId: entry.itemId, startsAt: input.startsAt, endsAt: input.endsAt, ignoreSaleId })) {
      throw adminError("FLASH_SALE_OVERLAP");
    }
  }
  return input;
}

async function insertSaleItems(ctx: MutationCtx, flashSaleId: SaleId, input: SaleInput) {
  for (const entry of input.items) {
    await ctx.db.insert("shopFlashSaleItems", {
      flashSaleId,
      itemId: entry.itemId,
      salePointsCost: entry.salePointsCost,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      cancelled: false,
    });
  }
}

async function saleItemRows(ctx: QueryCtx | MutationCtx, flashSaleId: SaleId) {
  return ctx.db.query("shopFlashSaleItems").withIndex("by_sale", (q) => q.eq("flashSaleId", flashSaleId)).collect();
}

function logSale(ctx: MutationCtx, actorAdminId: AdminId, action: "flash_sale_created" | "flash_sale_updated" | "flash_sale_cancelled", flashSaleId: SaleId, now: number, changedFields?: string[]) {
  return ctx.db.insert("staffConfigLogs", {
    actorAdminId, action, targetFlashSaleId: flashSaleId,
    ...(changedFields ? { details: buildStaffConfigDetails({ changedFields }) } : {}),
    createdAt: now,
  });
}

/** Creates a sale and its participant notification. A sale may start now or later, and must end in the future. */
export const createFlashSale = mutation({
  args: { ...sessionTokenArgs, ...saleFieldArgs },
  handler: async (ctx, { sessionToken, ...args }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const now = Date.now();
    const input = await validateSale(ctx, args, now);
    const flashSaleId = await ctx.db.insert("shopFlashSales", {
      title: input.title,
      message: input.message,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdBy: actor._id,
      createdAt: now,
      updatedAt: now,
    });
    await insertSaleItems(ctx, flashSaleId, input);
    const notificationId = await upsertFlashSaleNotification(ctx, {
      actorAdminId: actor._id,
      flashSaleId,
      title: input.title,
      message: input.message,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      now,
    });
    await ctx.db.patch(flashSaleId, { notificationId });
    await logSale(ctx, actor._id, "flash_sale_created", flashSaleId, now);
    return { flashSaleId };
  },
});

/** Replaces a scheduled sale's fields and items. Live, ended, and cancelled sales cannot change. */
export const updateFlashSale = mutation({
  args: { ...sessionTokenArgs, flashSaleId: v.id("shopFlashSales"), ...saleFieldArgs },
  handler: async (ctx, { sessionToken, flashSaleId, ...args }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const sale = await ctx.db.get(flashSaleId);
    if (!sale) throw adminError("FLASH_SALE_NOT_FOUND");
    const now = Date.now();
    if (flashSaleStatus(sale, now) !== "scheduled") throw adminError("FLASH_SALE_NOT_EDITABLE");
    const input = await validateSale(ctx, args, now, flashSaleId);

    for (const row of await saleItemRows(ctx, flashSaleId)) await ctx.db.delete(row._id);
    await insertSaleItems(ctx, flashSaleId, input);
    const notificationId = await upsertFlashSaleNotification(ctx, {
      actorAdminId: actor._id,
      flashSaleId,
      existingNotificationId: sale.notificationId,
      title: input.title,
      message: input.message,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      now,
    });
    await ctx.db.patch(flashSaleId, {
      title: input.title,
      message: input.message,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      notificationId,
      updatedAt: now,
    });
    await logSale(ctx, actor._id, "flash_sale_updated", flashSaleId, now, ["title", "message", "startsAt", "endsAt", "items"]);
    return { ok: true as const };
  },
});

/** Cancels a scheduled or live sale. Prices return to normal at once and its notification is withdrawn. */
export const cancelFlashSale = mutation({
  args: { ...sessionTokenArgs, flashSaleId: v.id("shopFlashSales") },
  handler: async (ctx, { sessionToken, flashSaleId }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const sale = await ctx.db.get(flashSaleId);
    if (!sale) throw adminError("FLASH_SALE_NOT_FOUND");
    const now = Date.now();
    const status = flashSaleStatus(sale, now);
    if (status === "ended" || status === "cancelled") throw adminError("FLASH_SALE_NOT_EDITABLE");

    await ctx.db.patch(flashSaleId, { cancelledAt: now, cancelledBy: actor._id, updatedAt: now });
    for (const row of await saleItemRows(ctx, flashSaleId)) await ctx.db.patch(row._id, { cancelled: true });
    await cancelFlashSaleNotification(ctx, {
      actorAdminId: actor._id,
      flashSaleId,
      existingNotificationId: sale.notificationId,
      now,
    });
    await logSale(ctx, actor._id, "flash_sale_cancelled", flashSaleId, now);
    return { ok: true as const };
  },
});

/** Every sale, latest start first, with its status and items. `nowBucket` only changes the cache key. */
export const listFlashSales = query({
  args: { ...sessionTokenArgs, nowBucket: v.optional(v.number()) },
  handler: async (ctx, { sessionToken }) => {
    await requireAdminRole(ctx, sessionToken);
    const now = Date.now();
    const sales = await ctx.db.query("shopFlashSales").withIndex("by_startsAt").order("desc").take(MAX_FLASH_SALES);
    const result = [];
    for (const sale of sales) {
      const items = [];
      for (const row of await saleItemRows(ctx, sale._id)) {
        const item = await ctx.db.get(row.itemId);
        items.push({
          itemId: row.itemId,
          name: item?.name ?? "Unknown item",
          pointsCost: item?.pointsCost ?? null,
          salePointsCost: row.salePointsCost,
        });
      }
      result.push({
        flashSaleId: sale._id,
        title: sale.title,
        message: sale.message,
        startsAt: sale.startsAt,
        endsAt: sale.endsAt,
        status: flashSaleStatus(sale, now),
        cancelledAt: sale.cancelledAt ?? null,
        items,
        createdAt: sale.createdAt,
      });
    }
    return result;
  },
});
