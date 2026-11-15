import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeLedgerPoints } from "../../convex/admin/pointsLedger";
import { createConvexTest, type ConvexTestInstance } from "../helpers/convexTestContext";
import {
  MINUTE,
  NOW,
  forceRandom,
  openArcade,
  seedPlayer,
  walletOf,
  updateGameInternal,
  updateSettingsInternal,
} from "../helpers/arcadeTestKit";

const getState = makeFunctionReference<"query">("admin/slotSpin:getMyGameState");
const spin = makeFunctionReference<"mutation">("admin/slotSpin:spin");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// rollOutcome: floor(x*100) <5 big, <25 win, <50 push, else lose.
const BIG = 0;
const WIN = 0.1;
const PUSH = 0.3;
const LOSE = 0.99;

/** Games bet from the arcade wallet. */
const balanceOf = walletOf;
const profileOf = (t: ConvexTestInstance, id: GenericId<"checkedIn">) => t.run(async (ctx) => (await ctx.db.get(id))?.points);
const ledgerOf = (t: ConvexTestInstance, id: GenericId<"checkedIn">) => t.run((ctx) => computeLedgerPoints(ctx, id));
const spinRows = (t: ConvexTestInstance) => t.run((ctx) => ctx.db.query("slotSpins").collect());
const playRows = (t: ConvexTestInstance) => t.run((ctx) => ctx.db.query("arcadePlays").collect());

describe("minigame access", () => {
  it("returns null state and NOT_SIGNED_IN when signed out", async () => {
    const t = createConvexTest();
    await openArcade(t);
    expect(await t.query(getState, {})).toBeNull();
    expect(await t.mutation(spin, { spinId: "a", wager: 10 })).toEqual({ status: "error", code: "NOT_SIGNED_IN" });
  });

  it("refuses applicants who are not participants, not accepted, or not checked in", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const none = await seedPlayer(t, { participant: false });
    expect(await none.player.mutation(spin, { spinId: "a", wager: 10 })).toMatchObject({ code: "NOT_PARTICIPANT" });
    expect(await none.player.query(getState, {})).toMatchObject({
      status: "live", player: { participant: false, eligible: false, checkedIn: false, balance: null },
    });

    const waitlisted = await seedPlayer(t, { review: "waitlisted" });
    expect(await waitlisted.player.mutation(spin, { spinId: "a", wager: 10 })).toMatchObject({ code: "NOT_ELIGIBLE" });

    const notCheckedIn = await seedPlayer(t, { checkedIn: false });
    expect(await notCheckedIn.player.mutation(spin, { spinId: "a", wager: 10 })).toMatchObject({ code: "NOT_CHECKED_IN" });
    expect(await notCheckedIn.player.query(getState, {})).toMatchObject({
      player: { participant: true, eligible: true, checkedIn: false, balance: null },
    });
    expect(await spinRows(t)).toEqual([]);
  });
});

describe("arcade and game switches", () => {
  it("follows the arcade schedule with the server clock", async () => {
    const t = createConvexTest();
    const { player } = await seedPlayer(t, { arcadePoints: 100 });
    await t.mutation(updateGameInternal, { key: "olympus-slots", enabled: true });
    expect(await player.query(getState, {})).toMatchObject({ status: "closed", window: null, serverNow: NOW });

    await t.mutation(updateSettingsInternal, { mode: "scheduled", opensAt: NOW + 30 * MINUTE, closesAt: NOW + 90 * MINUTE });
    expect(await player.query(getState, {})).toMatchObject({
      status: "teaser", window: { windowId: "arcade", opensAt: NOW + 30 * MINUTE, closesAt: NOW + 90 * MINUTE },
    });
    expect(await player.mutation(spin, { spinId: "early", wager: 10 })).toMatchObject({ code: "ARCADE_CLOSED" });

    vi.setSystemTime(NOW + 30 * MINUTE);
    expect(await player.query(getState, { nowBucket: 1 })).toMatchObject({ status: "live" });
    expect(await player.mutation(spin, { spinId: "on-time", wager: 10 })).toMatchObject({ status: "ok" });

    vi.setSystemTime(NOW + 90 * MINUTE);
    expect(await player.query(getState, { nowBucket: 2 })).toMatchObject({ status: "closed", window: null });
    expect(await player.mutation(spin, { spinId: "late", wager: 10 })).toMatchObject({ code: "ARCADE_CLOSED" });
    vi.setSystemTime(NOW + 89 * MINUTE);
    const inFlight = await player.mutation(spin, { spinId: "inflight", wager: 10 });
    expect(inFlight).toMatchObject({ status: "ok" });
    vi.setSystemTime(NOW + 90 * MINUTE);
    expect(await player.mutation(spin, { spinId: "inflight", wager: 10 })).toEqual(inFlight);
    expect(await player.mutation(spin, { spinId: "brand-new", wager: 10 })).toMatchObject({ code: "ARCADE_CLOSED" });
  });

  it("refuses spins while the game is switched off, even with the arcade on", async () => {
    const t = createConvexTest();
    const { player } = await seedPlayer(t, { arcadePoints: 100 });
    await t.mutation(updateSettingsInternal, { mode: "on" });
    expect(await player.query(getState, {})).toMatchObject({ status: "closed" });
    expect(await player.mutation(spin, { spinId: "x", wager: 10 })).toMatchObject({ code: "GAME_DISABLED" });
    await t.mutation(updateGameInternal, { key: "olympus-slots", enabled: true });
    expect(await player.query(getState, {})).toMatchObject({ status: "live", window: null });
    expect(await player.mutation(spin, { spinId: "x", wager: 10 })).toMatchObject({ status: "ok" });
  });

  it("stops spins the moment an admin switches the arcade off", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const { player, checkedInId } = await seedPlayer(t, { arcadePoints: 100 });
    forceRandom(LOSE);
    await player.mutation(spin, { spinId: "before", wager: 10 });
    await t.mutation(updateSettingsInternal, { mode: "off" });
    vi.setSystemTime(NOW + 5000);
    expect(await player.mutation(spin, { spinId: "after", wager: 10 })).toMatchObject({ code: "ARCADE_CLOSED" });
    expect(await balanceOf(t, checkedInId!)).toBe(90);
  });
});

describe("spins", () => {
  it("validates the wager, the balance, and the spin id", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const { player } = await seedPlayer(t, { arcadePoints: 5 });
    expect(await player.mutation(spin, { spinId: "a", wager: 15 })).toMatchObject({ code: "INVALID_WAGER" });
    expect(await player.mutation(spin, { spinId: "a", wager: 10.5 })).toMatchObject({ code: "INVALID_WAGER" });
    expect(await player.mutation(spin, { spinId: "a", wager: 10 })).toMatchObject({ code: "INSUFFICIENT_POINTS" });
    expect(await player.mutation(spin, { spinId: "  ", wager: 10 })).toMatchObject({ code: "INVALID_PLAY_ID" });
    expect(await player.mutation(spin, { spinId: "x".repeat(65), wager: 10 })).toMatchObject({ code: "INVALID_PLAY_ID" });
    expect(await player.mutation(spin, { spinId: "a b", wager: 10 })).toMatchObject({ code: "INVALID_PLAY_ID" });
    expect(await spinRows(t)).toEqual([]);
    expect(await playRows(t)).toEqual([]);
  });

  it("pays a win into the real balance and keeps the ledger in step", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const { player, checkedInId } = await seedPlayer(t, { arcadePoints: 100 });
    forceRandom(WIN);
    const result = await player.mutation(spin, { spinId: "spin-win", wager: 10 });
    expect(result).toMatchObject({
      status: "ok", spinId: "spin-win", outcome: "win", wager: 10, payout: 20, net: 10, previousPoints: 100, newPoints: 110,
    });
    const symbols = (result as { symbols: string[] }).symbols;
    expect(symbols).toHaveLength(4);
    expect(Math.max(...symbols.map((s) => symbols.filter((x) => x === s).length))).toBe(3);
    expect(await balanceOf(t, checkedInId!)).toBe(110);
    expect(await profileOf(t, checkedInId!)).toBe(100);
    expect(await ledgerOf(t, checkedInId!)).toBe(100);
    expect(await spinRows(t)).toMatchObject([{ checkedInId, spinId: "spin-win", wager: 10, payout: 20, outcome: "win", createdAt: NOW }]);
    expect(await playRows(t)).toMatchObject([
      { checkedInId, game: "olympus-slots", playId: "spin-win", stake: 10, payout: 20, pointsDelta: 10, previousPoints: 100, newPoints: 110, createdAt: NOW },
    ]);
    // The profile balance (and its pointsReachedAt) is never touched by a spin.
    expect(await t.run(async (ctx) => (await ctx.db.get(checkedInId!))?.pointsReachedAt)).toBeFalsy();
  });

  it("takes the wager on a loss, refunds on a push, and pays 5× on Zeus", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const { player, checkedInId } = await seedPlayer(t, { arcadePoints: 100 });

    forceRandom(LOSE);
    expect(await player.mutation(spin, { spinId: "l", wager: 25 })).toMatchObject({ outcome: "lose", payout: 0, net: -25, newPoints: 75 });
    vi.setSystemTime(NOW + 3000);
    forceRandom(PUSH);
    expect(await player.mutation(spin, { spinId: "p", wager: 25 })).toMatchObject({ outcome: "push", payout: 25, net: 0, newPoints: 75 });
    vi.setSystemTime(NOW + 6000);
    forceRandom(BIG);
    expect(await player.mutation(spin, { spinId: "b", wager: 50 })).toMatchObject({
      outcome: "big", symbols: ["zeus", "zeus", "zeus", "zeus"], payout: 250, net: 200, newPoints: 275,
    });
    expect(await balanceOf(t, checkedInId!)).toBe(275);
    expect(await profileOf(t, checkedInId!)).toBe(100);
    expect(await ledgerOf(t, checkedInId!)).toBe(100);

    const state = await player.query(getState, {});
    expect(state).toMatchObject({ player: { balance: 275 }, wagers: [5, 10, 25, 50], defaultWager: 10, cooldownMs: 2000 });
    expect((state as { recentSpins: Array<{ spinId: string; outcome: string }> }).recentSpins.map((s) => [s.spinId, s.outcome]))
      .toEqual([["b", "big"], ["p", "push"], ["l", "lose"]]);
  });

  it("can bet down to exactly zero", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const { player, checkedInId } = await seedPlayer(t, { arcadePoints: 10 });
    forceRandom(LOSE);
    expect(await player.mutation(spin, { spinId: "all-in", wager: 10 })).toMatchObject({ newPoints: 0 });
    expect(await balanceOf(t, checkedInId!)).toBe(0);
    expect(await t.run((ctx) => ctx.db.get(checkedInId!))).not.toHaveProperty("pointsReachedAt");
  });

  it("returns the stored result for a repeated spin id without charging again", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const { player, checkedInId } = await seedPlayer(t, { arcadePoints: 100 });
    forceRandom(LOSE);
    const first = await player.mutation(spin, { spinId: "same", wager: 10 });
    forceRandom(BIG);
    vi.setSystemTime(NOW + 10_000);
    expect(await player.mutation(spin, { spinId: "same", wager: 50 })).toEqual(first);
    // Still returned after the arcade closes: it was charged, so it must be shown.
    await t.mutation(updateSettingsInternal, { mode: "off" });
    expect(await player.mutation(spin, { spinId: "same", wager: 10 })).toEqual(first);
    expect(await spinRows(t)).toHaveLength(1);
    expect(await playRows(t)).toHaveLength(1);
    expect(await balanceOf(t, checkedInId!)).toBe(90);
  });

  it("enforces the 2 second cooldown between spins", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const { player } = await seedPlayer(t, { arcadePoints: 100 });
    forceRandom(LOSE);
    await player.mutation(spin, { spinId: "one", wager: 10 });
    vi.setSystemTime(NOW + 500);
    expect(await player.mutation(spin, { spinId: "two", wager: 10 })).toEqual({ status: "error", code: "COOLDOWN", retryAfterMs: 1500 });
    vi.setSystemTime(NOW + 2000);
    expect(await player.mutation(spin, { spinId: "two", wager: 10 })).toMatchObject({ status: "ok", newPoints: 80 });
  });

  it("keeps players' spins and balances separate", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const a = await seedPlayer(t, { arcadePoints: 100 });
    const b = await seedPlayer(t, { arcadePoints: 50 });
    forceRandom(WIN);
    await a.player.mutation(spin, { spinId: "shared-id", wager: 10 });
    await b.player.mutation(spin, { spinId: "shared-id", wager: 10 });
    expect(await balanceOf(t, a.checkedInId!)).toBe(110);
    expect(await balanceOf(t, b.checkedInId!)).toBe(60);
    expect((await b.player.query(getState, {}) as { recentSpins: unknown[] }).recentSpins).toHaveLength(1);
  });
});
