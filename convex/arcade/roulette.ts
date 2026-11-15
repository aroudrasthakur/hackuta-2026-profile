/**
 * Wheel of the Fates: the table state and spins. The server picks the pocket;
 * the browser only animates the wheel to it.
 *
 * Who may play, whether it's open, the cooldown and every change to points go
 * through the shared arcade code (access.ts, points.ts), so bets come from and
 * winnings go to the arcade wallet. This file adds the roulette rules
 * (shared/roulette/rules.ts: bet catalogue, limits, the daily loss limit by
 * the event's local day) and the spin record (`rouletteSpins`).
 *
 * Expected refusals come back as `{ status: "error", code }`.
 */
import type { DocumentByName } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { DataModel, MutationCtx, QueryCtx } from "../lib/dataModel";
import {
  ROULETTE_LIMITS,
  checkBets,
  dayKey,
  returnFor,
  spinPocket,
  type BetErrorCode,
  type RandomFn,
} from "../../shared/roulette/rules";
import type { ArcadePlayErrorCode } from "../../shared/arcade/rules";
import { gameGate, loadArcade, loadPlayer, playerProblem, type CheckedInDoc } from "./access";
import { applyPlay, beginPlay, cooldownLeft, type PlayDoc } from "./points";
import { arcadeBalance } from "./wallet";

const GAME = "wheel-of-the-fates" as const;
/** Spins listed in the table state (the history strip). */
export const ROULETTE_HISTORY = 12;
/** More raw bets than this is refused before any work (the merged limit is far lower). */
const MAX_RAW_BETS = 200;

type SpinDoc = DocumentByName<DataModel, "rouletteSpins">;
export type RouletteSpinErrorCode = ArcadePlayErrorCode | BetErrorCode;

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

function spinView(row: SpinDoc) {
  return {
    spinId: row.spinId,
    pocket: row.pocket,
    bets: row.bets,
    stake: row.stake,
    returned: row.returned,
    net: row.returned - row.stake,
    at: row.createdAt,
  };
}

/** Today's net loss on the wheel (0 when the player is up), by the event's local day. */
async function lossToday(ctx: QueryCtx | MutationCtx, checkedIn: CheckedInDoc, now: number) {
  const rows = await ctx.db
    .query("rouletteSpins")
    .withIndex("by_checkedIn_day", (q) => q.eq("checkedInId", checkedIn._id).eq("day", dayKey(now)))
    .collect();
  const net = rows.reduce((sum, row) => sum + row.returned - row.stake, 0);
  return Math.max(0, -net);
}

/**
 * The caller's table: whether the wheel is open, their arcade balance, today's
 * loss, the limits and their last spins. Null when signed out. `nowBucket`
 * only changes the cache key so clients re-run it when the schedule changes.
 */
export const getMyTable = query({
  args: { nowBucket: v.optional(v.number()) },
  handler: async (ctx) => {
    const player = await loadPlayer(ctx);
    if (!player.user) return null;
    const now = Date.now();
    const { code } = await gameGate(ctx, GAME, now);
    const { state } = await loadArcade(ctx, now);
    const checkedIn = player.checkedIn;
    const history = checkedIn
      ? await ctx.db
          .query("rouletteSpins")
          .withIndex("by_checkedIn_createdAt", (q) => q.eq("checkedInId", checkedIn._id))
          .order("desc")
          .take(ROULETTE_HISTORY)
      : [];
    return {
      status: code === null ? ("live" as const) : ("closed" as const),
      closesAt: state.closesAt,
      serverNow: now,
      problem: playerProblem(player),
      balance: checkedIn ? await arcadeBalance(ctx, checkedIn) : 0,
      lossToday: checkedIn ? await lossToday(ctx, checkedIn, now) : 0,
      limits: ROULETTE_LIMITS,
      history: history.map(spinView),
    };
  },
});

function spinError(code: RouletteSpinErrorCode, extra: { retryAfterMs?: number } = {}) {
  return { status: "error" as const, code, ...extra };
}

async function storedResult(ctx: MutationCtx, checkedIn: CheckedInDoc, play: PlayDoc) {
  const row = await ctx.db
    .query("rouletteSpins")
    .withIndex("by_checkedIn_spinId", (q) => q.eq("checkedInId", checkedIn._id).eq("spinId", play.playId))
    .first();
  if (!row) throw new Error("roulette: play without its spin row");
  return { status: "ok" as const, spin: spinView(row), balance: play.newPoints };
}

/**
 * One spin. `spinId` is the idempotency key: repeating it returns the stored
 * result without charging again (even if the wheel has closed since).
 */
export const spin = mutation({
  args: { spinId: v.string(), bets: v.array(v.object({ betId: v.string(), amount: v.number() })) },
  handler: async (ctx, { spinId, bets }) => {
    const now = Date.now();
    const begun = await beginPlay(ctx, GAME, spinId, now);
    if (begun.kind === "error") return spinError(begun.code);
    if (begun.kind === "replay") return storedResult(ctx, begun.checkedIn, begun.play);
    if (bets.length > MAX_RAW_BETS) return spinError("TOO_MANY_BETS");

    const wait = await cooldownLeft(ctx, begun.checkedIn, GAME, ROULETTE_LIMITS.cooldownMs, now);
    if (wait > 0) return spinError("COOLDOWN", { retryAfterMs: wait });

    const balance = await arcadeBalance(ctx, begun.checkedIn);
    const check = checkBets(bets, { balance, lossToday: await lossToday(ctx, begun.checkedIn, now) }, ROULETTE_LIMITS);
    if (!check.ok) return spinError(check.code);

    const pocket = spinPocket(serverRandom);
    const returned = returnFor(check.bets, pocket);
    const applied = await applyPlay(ctx, { checkedIn: begun.checkedIn, game: GAME, playId: begun.playId, stake: check.stake, payout: returned, now });
    if (!applied.ok) return spinError(applied.code);

    const rowId = await ctx.db.insert("rouletteSpins", {
      checkedInId: begun.checkedIn._id,
      playId: applied.play._id,
      spinId: begun.playId,
      bets: check.bets,
      stake: check.stake,
      returned,
      pocket,
      day: dayKey(now),
      createdAt: now,
    });
    return { status: "ok" as const, spin: spinView((await ctx.db.get(rowId))!), balance: applied.play.newPoints };
  },
});
