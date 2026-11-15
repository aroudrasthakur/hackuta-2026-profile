/**
 * Olympus Slots: hacker-facing game state and spins.
 *
 * Who may play, whether it is open, and every change to points go through the
 * shared arcade code (convex/arcade/access.ts and points.ts), like every other
 * game. This file only adds the slot rules and the reels (`slotSpins`).
 *
 * Expected refusals come back as `{ status: "error", code }` instead of
 * throwing, so the game can show them in-game.
 */
import type { DocumentByName } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { DataModel, MutationCtx } from "../lib/dataModel";
import {
  SLOT_DEFAULT_WAGER,
  SLOT_SPIN_COOLDOWN_MS,
  SLOT_WAGERS,
  isAllowedWager,
  payoutFor,
  rollOutcome,
  symbolsFor,
  type RandomFn,
} from "../../shared/admin/slotRules";
import type { ArcadePlayErrorCode, ArcadeState } from "../../shared/arcade/rules";
import { gameRow, loadArcade, loadPlayer, playerProblem, type CheckedInDoc } from "../arcade/access";
import { applyPlay, beginPlay, cooldownLeft, type PlayDoc } from "../arcade/points";
import { arcadeBalance } from "../arcade/wallet";

const GAME = "olympus-slots" as const;

/** Spins listed in the game state. */
export const SLOT_RECENT_SPINS = 5;

type SpinDoc = DocumentByName<DataModel, "slotSpins">;

export type SlotSpinErrorCode = ArcadePlayErrorCode | "INVALID_WAGER";

/** Uniform [0, 1) from Web Crypto when the runtime has it, else Math.random. */
const serverRandom: RandomFn = () => {
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint32Array) => Uint32Array } }).crypto;
  if (webCrypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    webCrypto.getRandomValues(buffer);
    return buffer[0]! / 2 ** 32;
  }
  return Math.random();
};

function spinError(code: SlotSpinErrorCode, extra: { retryAfterMs?: number } = {}) {
  return { status: "error" as const, code, ...extra };
}

function spinResult(play: PlayDoc, spin: SpinDoc) {
  return {
    status: "ok" as const,
    spinId: spin.spinId,
    outcome: spin.outcome,
    symbols: spin.symbols,
    wager: play.stake,
    payout: play.payout,
    net: play.pointsDelta,
    previousPoints: play.previousPoints,
    newPoints: play.newPoints,
  };
}

async function spinFor(ctx: MutationCtx, checkedIn: CheckedInDoc, spinId: string) {
  return ctx.db
    .query("slotSpins")
    .withIndex("by_checkedIn_spinId", (q) => q.eq("checkedInId", checkedIn._id).eq("spinId", spinId))
    .first();
}

/**
 * The arcade switch and this game's switch, in the shape the game already
 * understands: live (play now), teaser (opens later), closed.
 */
function slotStatus(state: ArcadeState, enabled: boolean, now: number) {
  if (!enabled || state.status === "off") return { status: "closed" as const, window: null };
  const window =
    state.closesAt !== null ? { windowId: "arcade", opensAt: state.opensAt ?? now, closesAt: state.closesAt } : null;
  return { status: state.status === "on" ? ("live" as const) : ("teaser" as const), window };
}

/**
 * Status, the caller's balance, and their last spins. Null when signed out.
 * `nowBucket` only changes the cache key so clients re-run the query when the
 * schedule opens or closes; the server clock decides the status.
 */
export const getMyGameState = query({
  args: { nowBucket: v.optional(v.number()) },
  handler: async (ctx) => {
    const player = await loadPlayer(ctx);
    if (!player.user) return null;
    const now = Date.now();
    const { state } = await loadArcade(ctx, now);
    const game = await gameRow(ctx, GAME);
    const { status, window } = slotStatus(state, game?.enabled ?? false, now);
    const checkedIn = player.checkedIn;
    const spins = checkedIn
      ? await ctx.db
        .query("slotSpins")
        .withIndex("by_checkedIn_createdAt", (q) => q.eq("checkedInId", checkedIn._id))
        .order("desc")
        .take(SLOT_RECENT_SPINS)
      : [];
    return {
      status,
      window,
      serverNow: now,
      player: {
        participant: player.participant !== null,
        eligible: player.eligible,
        checkedIn: checkedIn !== null,
        /** The arcade wallet (games bet from it; the profile balance is untouched). */
        balance: checkedIn ? await arcadeBalance(ctx, checkedIn) : null,
        canPlay: playerProblem(player) === null,
      },
      wagers: [...SLOT_WAGERS],
      defaultWager: SLOT_DEFAULT_WAGER,
      cooldownMs: SLOT_SPIN_COOLDOWN_MS,
      recentSpins: spins.map((row) => ({
        spinId: row.spinId,
        wager: row.wager,
        payout: row.payout,
        net: row.payout - row.wager,
        outcome: row.outcome,
        symbols: row.symbols,
        createdAt: row.createdAt,
      })),
    };
  },
});

/**
 * One spin. `spinId` is the client's idempotency key: repeating it returns the
 * stored result without charging again (even if the arcade has closed since).
 */
export const spin = mutation({
  args: { spinId: v.string(), wager: v.number() },
  handler: async (ctx, { spinId, wager }) => {
    const now = Date.now();
    const begun = await beginPlay(ctx, GAME, spinId, now);
    if (begun.kind === "error") return spinError(begun.code);
    if (begun.kind === "replay") {
      const stored = await spinFor(ctx, begun.checkedIn, begun.play.playId);
      if (!stored) throw new Error("slots: play without its spin row");
      return spinResult(begun.play, stored);
    }

    if (!isAllowedWager(wager)) return spinError("INVALID_WAGER");
    const wait = await cooldownLeft(ctx, begun.checkedIn, GAME, SLOT_SPIN_COOLDOWN_MS, now);
    if (wait > 0) return spinError("COOLDOWN", { retryAfterMs: wait });

    const outcome = rollOutcome(serverRandom);
    const symbols = symbolsFor(outcome.id, serverRandom);
    const payout = payoutFor(wager, outcome);
    const applied = await applyPlay(ctx, { checkedIn: begun.checkedIn, game: GAME, playId: begun.playId, stake: wager, payout, now });
    if (!applied.ok) return spinError(applied.code);

    const spinRowId = await ctx.db.insert("slotSpins", {
      checkedInId: begun.checkedIn._id,
      playId: applied.play._id,
      spinId: begun.playId,
      wager,
      payout,
      outcome: outcome.id,
      symbols,
      createdAt: now,
    });
    return spinResult(applied.play, (await ctx.db.get(spinRowId))!);
  },
});
