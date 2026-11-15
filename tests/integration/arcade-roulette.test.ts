import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConvexTest, type ConvexTestInstance } from "../helpers/convexTestContext";
import { HOUR, NOW, forceRandom, openArcade, seedPlayer, updateGameInternal, updateSettingsInternal, walletOf } from "../helpers/arcadeTestKit";

const getTable = makeFunctionReference<"query">("arcade/roulette:getMyTable");
const spin = makeFunctionReference<"mutation">("arcade/roulette:spin");
const WHEEL = "wheel-of-the-fates";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Lands the ball in `pocket` (spinPocket = floor(random × 37)). */
const land = (pocket: number) => forceRandom((pocket + 0.5) / 37);
const profileOf = (t: ConvexTestInstance, id: GenericId<"checkedIn">) => t.run(async (ctx) => (await ctx.db.get(id))?.points);
const bet = (betId: string, amount: number) => ({ betId, amount });

describe("table state", () => {
  it("is null signed out, and closed until the arcade and the wheel are both on", async () => {
    const t = createConvexTest();
    expect(await t.query(getTable, {})).toBeNull();
    const { player } = await seedPlayer(t, { arcadePoints: 100 });
    expect(await player.query(getTable, {})).toMatchObject({ status: "closed", balance: 100, lossToday: 0, history: [] });
    expect(await player.mutation(spin, { spinId: "s", bets: [bet("fire", 10)] })).toMatchObject({ code: "ARCADE_CLOSED" });
    await t.mutation(updateSettingsInternal, { mode: "on" });
    expect(await player.mutation(spin, { spinId: "s", bets: [bet("fire", 10)] })).toMatchObject({ code: "GAME_DISABLED" });
    await t.mutation(updateGameInternal, { key: WHEEL, enabled: true });
    expect(await player.query(getTable, {})).toMatchObject({ status: "live", limits: { chips: [5, 10, 25], dailyLossLimit: 300 } });
  });
});

describe("spins", () => {
  it("pays a straight-up win into the arcade wallet only", async () => {
    const t = createConvexTest();
    await openArcade(t, [WHEEL]);
    const { player, checkedInId } = await seedPlayer(t, { points: 100, arcadePoints: 100 });
    land(17);
    const result = await player.mutation(spin, { spinId: "w1", bets: [bet("straight:17", 10)] });
    expect(result).toMatchObject({ status: "ok", balance: 450, spin: { pocket: 17, stake: 10, returned: 360, net: 350 } });
    expect(await walletOf(t, checkedInId!)).toBe(450);
    expect(await profileOf(t, checkedInId!)).toBe(100);
    const table = await player.query(getTable, {});
    expect(table.history.map((s: { spinId: string }) => s.spinId)).toEqual(["w1"]);
  });

  it("takes the stake on a loss and counts it toward today's loss", async () => {
    const t = createConvexTest();
    await openArcade(t, [WHEEL]);
    const { player, checkedInId } = await seedPlayer(t, { arcadePoints: 100 });
    land(0); // Olympus: every outside bet loses
    expect(await player.mutation(spin, { spinId: "l1", bets: [bet("fire", 25), bet("odd", 20)] })).toMatchObject({ balance: 55, spin: { net: -45 } });
    expect(await walletOf(t, checkedInId!)).toBe(55);
    expect(await player.query(getTable, {})).toMatchObject({ lossToday: 45 });
  });

  it("refuses bad bets with the shared rules, changing nothing", async () => {
    const t = createConvexTest();
    await openArcade(t, [WHEEL]);
    const { player, checkedInId } = await seedPlayer(t, { arcadePoints: 20 });
    const cases: Array<[Array<{ betId: string; amount: number }>, string]> = [
      [[], "EMPTY"],
      [[bet("split:3-30", 5)], "UNKNOWN_BET"],
      [[bet("fire", 7)], "BAD_AMOUNT"],
      [[bet("straight:5", 15)], "STRAIGHT_LIMIT"],
      [[bet("fire", 25), bet("night", 30)], "STAKE_LIMIT"],
      [[bet("fire", 25)], "INSUFFICIENT_POINTS"],
    ];
    for (const [bets, code] of cases) {
      expect(await player.mutation(spin, { spinId: `bad-${code}`, bets })).toMatchObject({ status: "error", code });
    }
    expect(await walletOf(t, checkedInId!)).toBe(20);
    expect(await t.run((ctx) => ctx.db.query("rouletteSpins").collect())).toEqual([]);
  });

  it("enforces the 3 second cooldown", async () => {
    const t = createConvexTest();
    await openArcade(t, [WHEEL]);
    const { player } = await seedPlayer(t, { arcadePoints: 100 });
    land(0);
    await player.mutation(spin, { spinId: "a", bets: [bet("fire", 5)] });
    vi.setSystemTime(NOW + 1000);
    expect(await player.mutation(spin, { spinId: "b", bets: [bet("fire", 5)] })).toEqual({ status: "error", code: "COOLDOWN", retryAfterMs: 2000 });
    vi.setSystemTime(NOW + 3000);
    expect(await player.mutation(spin, { spinId: "b", bets: [bet("fire", 5)] })).toMatchObject({ status: "ok" });
  });

  it("returns the stored result for a repeated spin id, even after the wheel closes", async () => {
    const t = createConvexTest();
    await openArcade(t, [WHEEL]);
    const { player, checkedInId } = await seedPlayer(t, { arcadePoints: 100 });
    land(0);
    const first = await player.mutation(spin, { spinId: "same", bets: [bet("fire", 10)] });
    land(17);
    vi.setSystemTime(NOW + 10_000);
    await t.mutation(updateSettingsInternal, { mode: "off" });
    expect(await player.mutation(spin, { spinId: "same", bets: [bet("straight:17", 10)] })).toEqual(first);
    expect(await walletOf(t, checkedInId!)).toBe(90);
  });

  it("stops at the 300-point daily loss limit and resets at the event's midnight", async () => {
    const t = createConvexTest();
    await openArcade(t, [WHEEL]);
    const { player } = await seedPlayer(t, { arcadePoints: 500 });
    land(0);
    // NOW is 1 PM in Arlington; six 50-point losses, 3 s apart.
    for (let i = 0; i < 6; i += 1) {
      vi.setSystemTime(NOW + i * 3000);
      expect(await player.mutation(spin, { spinId: `loss-${i}`, bets: [bet("fire", 25), bet("odd", 25)] })).toMatchObject({ status: "ok" });
    }
    vi.setSystemTime(NOW + 6 * 3000);
    expect(await player.mutation(spin, { spinId: "over", bets: [bet("fire", 5)] })).toMatchObject({ code: "DAILY_LOSS_LIMIT" });
    expect(await player.query(getTable, {})).toMatchObject({ lossToday: 300, balance: 200 });
    // Past local midnight (12 hours later) the limit starts over.
    vi.setSystemTime(NOW + 12 * HOUR);
    expect(await player.query(getTable, { nowBucket: 1 })).toMatchObject({ lossToday: 0 });
    expect(await player.mutation(spin, { spinId: "tomorrow", bets: [bet("fire", 5)] })).toMatchObject({ status: "ok" });
  });

  it("refuses players who can't play", async () => {
    const t = createConvexTest();
    await openArcade(t, [WHEEL]);
    expect(await t.mutation(spin, { spinId: "x", bets: [bet("fire", 5)] })).toMatchObject({ code: "NOT_SIGNED_IN" });
    const notCheckedIn = await seedPlayer(t, { checkedIn: false });
    expect(await notCheckedIn.player.mutation(spin, { spinId: "x", bets: [bet("fire", 5)] })).toMatchObject({ code: "NOT_CHECKED_IN" });
    expect(await notCheckedIn.player.query(getTable, {})).toMatchObject({ problem: "NOT_CHECKED_IN", balance: 0 });
  });
});
