import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConvexTest, type ConvexTestInstance } from "../helpers/convexTestContext";
import { seedStaff } from "../helpers/reviewTestKit";
import { NOW, openArcade, seedPlayer, updateSettingsInternal, walletOf } from "../helpers/arcadeTestKit";

const getView = makeFunctionReference<"query">("arcade/poker:getMyPokerView");
const joinQueue = makeFunctionReference<"mutation">("arcade/poker:joinQueue");
const cancelQueue = makeFunctionReference<"mutation">("arcade/poker:cancelQueue");
const leaveTable = makeFunctionReference<"mutation">("arcade/poker:leaveTable");
const act = makeFunctionReference<"mutation">("arcade/poker:act");
const trySeat = makeFunctionReference<"mutation">("arcade/poker:trySeat");
const recentTransactions = makeFunctionReference<"query">("arcade/pokerAudit:getRecentTransactions");
const listTransfers = makeFunctionReference<"query">("arcade/admin:listArcadeTransfers");
const POKER = "olympus-poker";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const profileOf = (t: ConvexTestInstance, id: GenericId<"checkedIn">) => t.run(async (ctx) => (await ctx.db.get(id))?.points);

describe("event poker matchmaking", () => {
  it("starts two waiting hackers at the same table after the fill delay, buy-in from the arcade wallet", async () => {
    const t = createConvexTest();
    await openArcade(t, [POKER]);
    const a = await seedPlayer(t, { points: 50, arcadePoints: 200 });
    const b = await seedPlayer(t, { arcadePoints: 150 });
    expect(await a.player.mutation(joinQueue, {})).toEqual({ status: "ok", phase: "queued" });
    expect(await b.player.mutation(joinQueue, {})).toEqual({ status: "ok", phase: "queued" });

    const queued = await a.player.query(getView, {});
    expect(queued).toMatchObject({ phase: "queued", balance: 150 });
    expect(queued.queue).toHaveLength(2);
    expect(await walletOf(t, a.checkedInId!)).toBe(150);
    expect(await profileOf(t, a.checkedInId!)).toBe(50);

    vi.setSystemTime(NOW + 2_500);
    await t.mutation(trySeat, {});
    const va = await a.player.query(getView, {});
    const vb = await b.player.query(getView, {});
    expect(va.phase).toBe("table");
    expect(vb.phase).toBe("table");
    expect(va.table?.id).toBe(vb.table?.id);
    expect(va.table?.seats).toHaveLength(2);
    expect(va.table?.you?.id).toBe(va.youId);
    // Seated under their real name from the profile, not anything the browser sent.
    expect(va.table?.seats.find((seat: { id: string }) => seat.id === va.youId)?.name).toBe("Taylor Student");
  });

  it("does not open new tables after the arcade closes", async () => {
    const t = createConvexTest();
    await openArcade(t, [POKER]);
    const one = await seedPlayer(t, { arcadePoints: 100 });
    const two = await seedPlayer(t, { arcadePoints: 100 });
    await one.player.mutation(joinQueue, {});
    await two.player.mutation(joinQueue, {});
    await t.mutation(updateSettingsInternal, { mode: "off" });
    vi.setSystemTime(NOW + 10_000);
    await t.mutation(trySeat, {});
    expect(await one.player.query(getView, {})).toMatchObject({ phase: "queued" });
    expect(await two.player.query(getView, {})).toMatchObject({ phase: "queued" });
  });

  it("does not seat a lone player — needs at least two hackers in the queue", async () => {
    const t = createConvexTest();
    await openArcade(t, [POKER]);
    const { player } = await seedPlayer(t, { arcadePoints: 100 });
    await player.mutation(joinQueue, {});
    vi.setSystemTime(NOW + 60_000);
    await t.mutation(trySeat, {});
    expect(await player.query(getView, {})).toMatchObject({ phase: "queued" });
  });

  it("never leaks other hole cards or the deck once seated", async () => {
    const t = createConvexTest();
    await openArcade(t, [POKER]);
    const one = await seedPlayer(t, { arcadePoints: 100 });
    const two = await seedPlayer(t, { arcadePoints: 100 });
    await one.player.mutation(joinQueue, {});
    await two.player.mutation(joinQueue, {});
    vi.setSystemTime(NOW + 2_500);
    await t.mutation(trySeat, {});
    const view = await one.player.query(getView, {});
    expect(view.phase).toBe("table");
    expect(view.table?.seats.every((seat: { isBot: boolean }) => !seat.isBot)).toBe(true);
    expect(view.table?.seats.find((seat: { id: string }) => seat.id === view.youId)?.hole).toHaveLength(2);
    for (const seat of view.table?.seats ?? []) {
      if (seat.id !== view.youId) expect(seat.hole).toBeNull();
    }
    expect(JSON.stringify(view)).not.toContain('"deck"');
  });

  it("refunds the buy-in to the arcade wallet when leaving the queue", async () => {
    const t = createConvexTest();
    await openArcade(t, [POKER]);
    const { player, checkedInId } = await seedPlayer(t, { arcadePoints: 200 });
    await player.mutation(joinQueue, {});
    expect(await walletOf(t, checkedInId!)).toBe(150);
    expect(await player.mutation(cancelQueue, {})).toEqual({ status: "ok" });
    expect(await player.query(getView, {})).toMatchObject({ phase: "result", balance: 200, result: { returned: 50 } });
    expect(await walletOf(t, checkedInId!)).toBe(200);
  });

  it("gives the chips back to the arcade wallet when standing up, and the wallet check adds up", async () => {
    const t = createConvexTest();
    await openArcade(t, [POKER]);
    const admin = await seedStaff(t);
    const { player, checkedInId } = await seedPlayer(t, { arcadePoints: 300 });
    const other = await seedPlayer(t, { arcadePoints: 100 });
    await player.mutation(joinQueue, {});
    await other.player.mutation(joinQueue, {});
    vi.setSystemTime(NOW + 2_500);
    await t.mutation(trySeat, {});
    const seated = await player.query(getView, {});
    const chips = seated.table?.you?.chips as number;
    expect(await player.mutation(leaveTable, {})).toEqual({ status: "ok" });
    expect(await walletOf(t, checkedInId!)).toBe(250 + chips);
    const listing = await t.query(listTransfers, { sessionToken: admin.sessionToken, checkedInId: checkedInId! });
    expect(listing.wallets[0]).toMatchObject({ walletConsistent: true, stored: 250 + chips });
  });

  it("refuses a buy-in the arcade wallet can't cover", async () => {
    const t = createConvexTest();
    await openArcade(t, [POKER]);
    const { player, checkedInId } = await seedPlayer(t, { points: 500, arcadePoints: 30 });
    expect(await player.mutation(joinQueue, {})).toEqual({ status: "error", code: "INSUFFICIENT_POINTS" });
    expect(await walletOf(t, checkedInId!)).toBe(30);
    expect(await profileOf(t, checkedInId!)).toBe(500);
  });

  it("refuses hackers who can't play, and a closed arcade", async () => {
    const t = createConvexTest();
    expect(await t.mutation(joinQueue, {})).toMatchObject({ code: "NOT_SIGNED_IN" });
    const notCheckedIn = await seedPlayer(t, { checkedIn: false });
    expect(await notCheckedIn.player.mutation(joinQueue, {})).toMatchObject({ code: "NOT_CHECKED_IN" });
    const { player } = await seedPlayer(t, { arcadePoints: 200 });
    expect(await player.mutation(joinQueue, {})).toMatchObject({ code: "ARCADE_CLOSED" });
    await t.mutation(updateSettingsInternal, { mode: "on" });
    expect(await player.mutation(joinQueue, {})).toMatchObject({ code: "GAME_DISABLED" });
  });

  it("rejects an action off-turn", async () => {
    const t = createConvexTest();
    await openArcade(t, [POKER]);
    const one = await seedPlayer(t, { arcadePoints: 100 });
    const two = await seedPlayer(t, { arcadePoints: 100 });
    await one.player.mutation(joinQueue, {});
    await two.player.mutation(joinQueue, {});
    vi.setSystemTime(NOW + 2_500);
    await t.mutation(trySeat, {});
    const a = await one.player.query(getView, {});
    const waiter = a.table?.you?.legal?.length ? two.player : one.player;
    expect(await waiter.mutation(act, { action: { type: "fold" } })).toEqual({ status: "error", code: "NOT_YOUR_TURN" });
  });

  it("keeps the audit queries for administrators only", async () => {
    const t = createConvexTest();
    const admin = await seedStaff(t);
    const volunteer = await seedStaff(t, { role: "volunteer" });
    await expect(t.query(recentTransactions, { sessionToken: volunteer.sessionToken })).rejects.toThrow();
    await expect(t.query(recentTransactions, { sessionToken: "f".repeat(64) })).rejects.toThrow();
    expect(await t.query(recentTransactions, { sessionToken: admin.sessionToken })).toEqual([]);
  });
});
