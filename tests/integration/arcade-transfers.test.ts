import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeLedgerPoints } from "../../convex/admin/pointsLedger";
import { createConvexTest, type ConvexTestInstance } from "../helpers/convexTestContext";
import { seedStaff } from "../helpers/reviewTestKit";
import { NOW, forceRandom, openArcade, seedPlayer, updateSettingsInternal, walletOf } from "../helpers/arcadeTestKit";
import { MAX_TRANSFER, balancesAfter, checkDeposit, checkWithdraw } from "../../shared/arcade/rules";

const deposit = makeFunctionReference<"mutation">("arcade/transfers:deposit");
const withdraw = makeFunctionReference<"mutation">("arcade/transfers:withdraw");
const myTransfers = makeFunctionReference<"query">("arcade/transfers:getMyTransfers");
const listTransfers = makeFunctionReference<"query">("arcade/admin:listArcadeTransfers");
const getSession = makeFunctionReference<"query">("arcade/session:getArcadeSession");
const slotSpin = makeFunctionReference<"mutation">("admin/slotSpin:spin");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const LOSE = 0.99;
const WIN = 0.1;
const profileOf = (t: ConvexTestInstance, id: GenericId<"checkedIn">) => t.run(async (ctx) => (await ctx.db.get(id))?.points);
const ledgerOf = (t: ConvexTestInstance, id: GenericId<"checkedIn">) => t.run((ctx) => computeLedgerPoints(ctx, id));
const transferRows = (t: ConvexTestInstance) => t.run((ctx) => ctx.db.query("arcadeTransfers").collect());

describe("transfer rules (pure)", () => {
  it("accepts whole amounts within the balance and the per-transfer cap", () => {
    expect(checkDeposit(50, 200)).toBeNull();
    expect(checkDeposit(200, 200)).toBeNull();
    expect(checkDeposit(201, 200)).toBe("INSUFFICIENT_POINTS");
    expect(checkWithdraw(30, 30)).toBeNull();
    expect(checkWithdraw(31, 30)).toBe("INSUFFICIENT_ARCADE_POINTS");
    for (const bad of [0, -5, 2.5, MAX_TRANSFER + 1, Number.NaN, "10", null]) {
      expect(checkDeposit(bad, 10_000)).toBe("INVALID_AMOUNT");
      expect(checkWithdraw(bad, 10_000)).toBe("INVALID_AMOUNT");
    }
    expect(balancesAfter("deposit", 50, 200, 0)).toEqual({ profile: 150, arcade: 50 });
    expect(balancesAfter("withdraw", 20, 150, 50)).toEqual({ profile: 170, arcade: 30 });
  });
});

describe("deposit", () => {
  it("moves points from the profile into the arcade in one step and logs it", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const { player, checkedInId } = await seedPlayer(t, { points: 200 });
    const result = await player.mutation(deposit, { transferId: "dep-1", amount: 50 });
    expect(result).toMatchObject({
      status: "ok",
      transfer: { transferId: "dep-1", kind: "deposit", amount: 50, profileBefore: 200, profileAfter: 150, arcadeBefore: 0, arcadeAfter: 50, createdAt: NOW },
    });
    expect(await profileOf(t, checkedInId!)).toBe(150);
    expect(await walletOf(t, checkedInId!)).toBe(50);
    expect(await ledgerOf(t, checkedInId!)).toBe(150);
    expect(await transferRows(t)).toHaveLength(1);
    expect((await player.query(getSession, {})).player).toMatchObject({ points: 150, arcadePoints: 50 });
  });

  it("refuses bad amounts, too many points, and bad transfer ids, changing nothing", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const { player, checkedInId } = await seedPlayer(t, { points: 40 });
    for (const amount of [0, -5, 2.5, MAX_TRANSFER + 1]) {
      expect(await player.mutation(deposit, { transferId: `bad-${String(amount).replace(/\W/g, "")}`, amount })).toMatchObject({ code: "INVALID_AMOUNT" });
    }
    expect(await player.mutation(deposit, { transferId: "too-much", amount: 41 })).toMatchObject({ code: "INSUFFICIENT_POINTS" });
    for (const transferId of ["", "  ", "a b", "x".repeat(65)]) {
      expect(await player.mutation(deposit, { transferId, amount: 10 })).toMatchObject({ code: "INVALID_TRANSFER_ID" });
    }
    expect(await profileOf(t, checkedInId!)).toBe(40);
    expect(await walletOf(t, checkedInId!)).toBe(0);
    expect(await transferRows(t)).toEqual([]);
  });

  it("is refused while the arcade is closed", async () => {
    const t = createConvexTest();
    const { player, checkedInId } = await seedPlayer(t, { points: 100 });
    expect(await player.mutation(deposit, { transferId: "closed", amount: 10 })).toEqual({ status: "error", code: "ARCADE_CLOSED" });
    expect(await profileOf(t, checkedInId!)).toBe(100);
  });

  it("is refused for anyone who can't play", async () => {
    const t = createConvexTest();
    await openArcade(t);
    expect(await t.mutation(deposit, { transferId: "anon", amount: 10 })).toMatchObject({ code: "NOT_SIGNED_IN" });
    const none = await seedPlayer(t, { participant: false });
    expect(await none.player.mutation(deposit, { transferId: "x", amount: 10 })).toMatchObject({ code: "NOT_PARTICIPANT" });
    const waitlisted = await seedPlayer(t, { review: "waitlisted" });
    expect(await waitlisted.player.mutation(deposit, { transferId: "x", amount: 10 })).toMatchObject({ code: "NOT_ELIGIBLE" });
    const notCheckedIn = await seedPlayer(t, { checkedIn: false });
    expect(await notCheckedIn.player.mutation(deposit, { transferId: "x", amount: 10 })).toMatchObject({ code: "NOT_CHECKED_IN" });
    expect(await transferRows(t)).toEqual([]);
  });

  it("moves points only once for a repeated transfer id (double click, retry)", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const { player, checkedInId } = await seedPlayer(t, { points: 100 });
    const first = await player.mutation(deposit, { transferId: "same", amount: 30 });
    vi.setSystemTime(NOW + 5000);
    // Same id, different amount, even after the arcade closes: the first answer, nothing moved.
    await t.mutation(updateSettingsInternal, { mode: "off" });
    expect(await player.mutation(deposit, { transferId: "same", amount: 90 })).toEqual(first);
    expect(await profileOf(t, checkedInId!)).toBe(70);
    expect(await walletOf(t, checkedInId!)).toBe(30);
    expect(await transferRows(t)).toHaveLength(1);
  });
});

describe("withdraw", () => {
  it("puts arcade points back on the profile and logs it", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const { player, checkedInId } = await seedPlayer(t, { points: 100, arcadePoints: 60 });
    const result = await player.mutation(withdraw, { transferId: "wd-1", amount: 60 });
    expect(result).toMatchObject({
      status: "ok",
      transfer: { kind: "withdraw", amount: 60, profileBefore: 100, profileAfter: 160, arcadeBefore: 60, arcadeAfter: 0 },
    });
    expect(await profileOf(t, checkedInId!)).toBe(160);
    expect(await walletOf(t, checkedInId!)).toBe(0);
    expect(await ledgerOf(t, checkedInId!)).toBe(160);
  });

  it("works while the arcade is closed, so points never get stuck", async () => {
    const t = createConvexTest();
    const { player, checkedInId } = await seedPlayer(t, { points: 0, arcadePoints: 25 });
    expect(await player.mutation(withdraw, { transferId: "after-close", amount: 25 })).toMatchObject({ status: "ok" });
    expect(await profileOf(t, checkedInId!)).toBe(25);
  });

  it("can't take more than the arcade balance", async () => {
    const t = createConvexTest();
    const { player, checkedInId } = await seedPlayer(t, { points: 100, arcadePoints: 10 });
    expect(await player.mutation(withdraw, { transferId: "greedy", amount: 11 })).toMatchObject({ code: "INSUFFICIENT_ARCADE_POINTS" });
    expect(await player.mutation(withdraw, { transferId: "none", amount: 0 })).toMatchObject({ code: "INVALID_AMOUNT" });
    expect(await profileOf(t, checkedInId!)).toBe(100);
    expect(await walletOf(t, checkedInId!)).toBe(10);
  });
});

describe("games and the two balances", () => {
  it("spins change only the arcade wallet, and the ledger stays right through deposit, play and withdraw", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const { player, checkedInId } = await seedPlayer(t, { points: 200 });
    expect(await player.mutation(slotSpin, { spinId: "broke", wager: 10 })).toMatchObject({ code: "INSUFFICIENT_POINTS" });

    await player.mutation(deposit, { transferId: "in", amount: 50 });
    forceRandom(WIN);
    expect(await player.mutation(slotSpin, { spinId: "s1", wager: 10 })).toMatchObject({ status: "ok", newPoints: 60 });
    vi.setSystemTime(NOW + 3000);
    forceRandom(LOSE);
    expect(await player.mutation(slotSpin, { spinId: "s2", wager: 25 })).toMatchObject({ status: "ok", newPoints: 35 });
    expect(await profileOf(t, checkedInId!)).toBe(150);
    expect(await ledgerOf(t, checkedInId!)).toBe(150);

    await player.mutation(withdraw, { transferId: "out", amount: 35 });
    expect(await profileOf(t, checkedInId!)).toBe(185);
    expect(await walletOf(t, checkedInId!)).toBe(0);
    expect(await ledgerOf(t, checkedInId!)).toBe(185);
  });
});

describe("transfer logs", () => {
  it("shows hackers only their own transfers, newest first", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const a = await seedPlayer(t, { points: 100 });
    const b = await seedPlayer(t, { points: 100 });
    await a.player.mutation(deposit, { transferId: "a1", amount: 10 });
    vi.setSystemTime(NOW + 1000);
    await a.player.mutation(withdraw, { transferId: "a2", amount: 4 });
    await b.player.mutation(deposit, { transferId: "b1", amount: 70 });
    const mine = await a.player.query(myTransfers, {});
    expect(mine).toMatchObject({ profilePoints: 94, arcadePoints: 6 });
    expect(mine.transfers.map((x: { transferId: string }) => x.transferId)).toEqual(["a2", "a1"]);
    expect(await t.query(myTransfers, {})).toBeNull();
  });

  it("lets admins check every wallet and flags one that doesn't add up", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const admin = await seedStaff(t);
    const { player, checkedInId } = await seedPlayer(t, { points: 100 });
    await player.mutation(deposit, { transferId: "d", amount: 40 });
    let listing = await t.query(listTransfers, { sessionToken: admin.sessionToken });
    expect(listing.transfers).toHaveLength(1);
    expect(listing.wallets).toEqual([{ checkedInId, stored: 40, expected: 40, walletConsistent: true }]);

    // Someone writes the wallet directly, bypassing the transfer and play path.
    await t.run(async (ctx) => {
      const row = await ctx.db.query("arcadeWallets").withIndex("by_checkedIn", (q) => q.eq("checkedInId", checkedInId!)).unique();
      await ctx.db.patch(row!._id, { points: 400 });
    });
    listing = await t.query(listTransfers, { sessionToken: admin.sessionToken, checkedInId: checkedInId! });
    expect(listing.wallets[0]).toMatchObject({ stored: 400, expected: 40, walletConsistent: false });

    const volunteer = await seedStaff(t, { role: "volunteer" });
    await expect(t.query(listTransfers, { sessionToken: volunteer.sessionToken })).rejects.toThrow();
  });
});
