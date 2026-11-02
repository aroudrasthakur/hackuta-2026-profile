import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import { createConvexTest } from "../helpers/convexTestContext";
import { scheduledJobs, seedApplicant, seedStaff } from "../helpers/reviewTestKit";

const createItem = makeFunctionReference<"mutation">("admin/shopAdmin:createShopItem");
const createSale = makeFunctionReference<"mutation">("admin/shopFlashSales:createFlashSale");
const updateSale = makeFunctionReference<"mutation">("admin/shopFlashSales:updateFlashSale");
const cancelSale = makeFunctionReference<"mutation">("admin/shopFlashSales:cancelFlashSale");
const purchaseItem = makeFunctionReference<"mutation">("admin/shopRedemption:purchaseShopItem");
const listShop = makeFunctionReference<"query">("admin/participantShop:listShop");
const getHistory = makeFunctionReference<"query">("admin/participantShop:getMyShopHistory");

const NOW = Date.UTC(2026, 10, 14, 15);
const MINUTE = 60_000;
const QR_TOKEN = "ab".repeat(32);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

async function seedShop() {
  const t = createConvexTest();
  const admin = await seedStaff(t);
  const volunteer = await seedStaff(t, { role: "volunteer" });
  const applicant = await seedApplicant(t, { review: { status: "accepted" } });
  const participantId = await t.run(async (ctx) => {
    await ctx.db.patch(volunteer.adminId, { canRedeemShop: true });
    return ctx.db.insert("participants", {
      applicationId: applicant.applicationId,
      authUserId: applicant.userId,
      acceptedAt: 1,
      acceptedBy: admin.adminId,
      qrCodeToken: QR_TOKEN,
      badgeQrCodeToken: QR_TOKEN,
      checkedInAt: 1,
      points: 100,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  const { itemId } = await t.mutation(createItem, {
    sessionToken: admin.sessionToken,
    name: "Sticker pack",
    description: "Five stickers",
    pointsCost: 20,
  });
  const participant = t.withIdentity({ subject: applicant.userId });
  const saleInput = {
    sessionToken: admin.sessionToken,
    title: "Lunch sale",
    message: "Discounted stickers",
    startsAt: NOW + 10 * MINUTE,
    endsAt: NOW + 20 * MINUTE,
    items: [{ itemId, salePointsCost: 10 }],
  };
  return { t, admin, volunteer, participant, participantId, itemId, saleInput };
}

describe("participant shop after notification removal", () => {
  it("creates, edits, and cancels a scheduled sale without notification fields or jobs", async () => {
    const { t, admin, participant, participantId, saleInput } = await seedShop();
    expect(schema.tables).not.toHaveProperty("participantNotifications");
    const { flashSaleId } = await t.mutation(createSale, saleInput);
    expect(await scheduledJobs(t)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(flashSaleId))).not.toHaveProperty("notificationId");

    await t.mutation(updateSale, { ...saleInput, flashSaleId, title: "Afternoon sale", startsAt: NOW + 15 * MINUTE });
    expect(await scheduledJobs(t)).toEqual([]);
    await t.mutation(cancelSale, { sessionToken: admin.sessionToken, flashSaleId });
    expect(await scheduledJobs(t)).toEqual([]);

    vi.setSystemTime(NOW + 16 * MINUTE);
    expect(await participant.query(listShop, {})).toMatchObject({
      items: [{ pointsCost: 20, onSale: false }], activeSales: [], points: 100,
    });
    const state = await t.run(async (ctx) => ({
      saleItems: await ctx.db.query("shopFlashSaleItems").collect(),
      logs: await ctx.db.query("staffConfigLogs").collect(),
      participant: await ctx.db.get(participantId),
    }));
    expect(state.saleItems).toMatchObject([{ flashSaleId, cancelled: true }]);
    expect(state.logs.map((log) => log.action)).toEqual([
      "shop_item_created", "flash_sale_created", "flash_sale_updated", "flash_sale_cancelled",
    ]);
    for (const log of state.logs) expect(log).not.toHaveProperty("targetNotificationId");
    expect(state.participant?.points).toBe(100);
  });

  it("uses the edited sale window for pricing and preserves purchases and private history", async () => {
    const { t, participant, volunteer, itemId, saleInput } = await seedShop();
    const { flashSaleId } = await t.mutation(createSale, saleInput);
    await t.mutation(updateSale, {
      ...saleInput, flashSaleId, title: "Afternoon sale", startsAt: NOW + 15 * MINUTE,
      endsAt: NOW + 25 * MINUTE, items: [{ itemId, salePointsCost: 12 }],
    });
    expect(await t.query(listShop, {})).toBeNull();
    vi.setSystemTime(NOW + 10 * MINUTE);
    expect(await participant.query(listShop, {})).toMatchObject({
      items: [{ pointsCost: 20, onSale: false }], nextPriceChangeAt: NOW + 15 * MINUTE,
    });
    vi.setSystemTime(NOW + 15 * MINUTE);
    expect(await participant.query(listShop, {})).toMatchObject({
      items: [{ pointsCost: 12, basePointsCost: 20, onSale: true }],
      activeSales: [{ flashSaleId, title: "Afternoon sale", message: "Discounted stickers" }],
      nextPriceChangeAt: NOW + 25 * MINUTE,
    });
    expect(await t.mutation(purchaseItem, {
      sessionToken: volunteer.sessionToken, qrCodeToken: QR_TOKEN, itemId, quantity: 1,
      expectedUnitPointsCost: 12, idempotencyKey: "participant-shop-purchase-0001",
    })).toMatchObject({ status: "success", receipt: { unitPointsCost: 12, flashSaleId } });

    vi.setSystemTime(NOW + 25 * MINUTE);
    expect(await participant.query(listShop, {})).toMatchObject({
      items: [{ pointsCost: 20, onSale: false }], activeSales: [], points: 88,
    });
    expect(await participant.query(getHistory, {})).toMatchObject([
      { itemName: "Sticker pack", quantity: 1, unitPointsCost: 12, totalPointsSpent: 12, onSale: true },
    ]);
    const other = await seedApplicant(t);
    expect(await t.withIdentity({ subject: other.userId }).query(getHistory, {})).toEqual([]);
    expect(await t.query(getHistory, {})).toEqual([]);
    expect(await scheduledJobs(t)).toEqual([]);
  });

  it("restores normal prices immediately when a live sale is cancelled", async () => {
    const { t, admin, participant, saleInput } = await seedShop();
    const { flashSaleId } = await t.mutation(createSale, { ...saleInput, startsAt: NOW });
    expect(await participant.query(listShop, {})).toMatchObject({ items: [{ pointsCost: 10, onSale: true }] });
    await t.mutation(cancelSale, { sessionToken: admin.sessionToken, flashSaleId });
    expect(await participant.query(listShop, {})).toMatchObject({
      items: [{ pointsCost: 20, onSale: false }], activeSales: [], points: 100,
    });
    expect(await scheduledJobs(t)).toEqual([]);
  });
});
