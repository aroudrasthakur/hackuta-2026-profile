/**
 * Olympus 21 on the live server, with the same matchmaking as Olympus Poker.
 *
 * - One event-wide queue (`o21Queue`). `joinQueue` takes the buy-in from the
 *   arcade wallet (`applyPlay`). `trySeat` seats a full group at once, or 2–3
 *   humans after a short wait. Humans only: no bots (like poker).
 * - The buy-in becomes table chips; every wager comes out of the chips. Chips
 *   go back to the wallet (`creditWallet`) when the hacker leaves, is unseated
 *   for timing out, or the table closes. Every move is an `arcadePlays` row,
 *   so the admin wallet check adds up.
 * - The engine (`shared/olympus21/engine.js`) runs inside these mutations and
 *   its state (every hand, both piles) stays in `o21LiveTables.state`. No query
 *   returns it: `getMyTable` sends only `viewFor(table, me)`.
 * - The scheduled `tick` drives the timers, closes a table when the arcade or
 *   the game is switched off, and pays everyone out.
 *
 * The player always comes from the Convex Auth session (access.ts). The
 * decisions (seating, chips, closing) are pure, in `shared/olympus21/live.ts`.
 * Mutations answer `{ ok: true }` or `{ ok: false, code }` (the site's adapter).
 */
import { v } from "convex/values";
import type { GenericId as Id } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../lib/dataModel";
import { draw, importState, leave as engineLeave, placeWager, play, ready, viewFor, type CommandResult, type Table } from "../../shared/olympus21/engine.js";
import {
  O21_BUY_IN,
  O21_QUEUE_FILL_MS,
  chooseSeating,
  openLiveTable,
  runLive,
  saveLive,
  seatedPlayer,
  type CashOut,
  type CashOutReason,
} from "../../shared/olympus21/live";
import { gameGate, gameRow, loadArcade, loadPlayer, playerDisplayName, playerProblem, type CheckedInDoc } from "./access";
import { applyPlay, creditWallet } from "./points";
import { arcadeBalance } from "./wallet";

const GAME = "pvp-blackjack" as const;
const NAME_MAX = 24;
/** A recorded pending tick this far in the past is treated as lost and rescheduled. */
const STALE_WAKE_MS = 5_000;
const ACTION_ID = v.optional(v.string());

type Result = { ok: true; serverNow: number } | { ok: false; code: string; serverNow: number };
const ok = (now: number): Result => ({ ok: true, serverNow: now });
const fail = (code: string, now: number): Result => ({ ok: false, code, serverNow: now });

const REASON_TEXT: Record<CashOutReason, string> = {
  left: "You left the table.",
  timeout: "You ran out of time three times and were stood up.",
  closed: "The table closed.",
};

/** Uniform [0, 1) from Web Crypto when the runtime has it, else Math.random. */
function serverRandom(): number {
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint32Array) => Uint32Array } }).crypto;
  if (webCrypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    webCrypto.getRandomValues(buffer);
    return buffer[0]! / 2 ** 32;
  }
  return Math.random();
}

// ---------------------------------------------------------------------------
// rows

async function myQueueRow(ctx: QueryCtx | MutationCtx, checkedInId: Id<"checkedIn">) {
  return ctx.db
    .query("o21Queue")
    .withIndex("by_checkedIn", (q) => q.eq("checkedInId", checkedInId))
    .unique();
}

/** The hacker's latest seat row (seated or cashed out), or null. */
async function myLatestSeat(ctx: QueryCtx | MutationCtx, checkedInId: Id<"checkedIn">) {
  return ctx.db
    .query("o21Seats")
    .withIndex("by_checkedIn_createdAt", (q) => q.eq("checkedInId", checkedInId))
    .order("desc")
    .first();
}

async function isOpen(ctx: QueryCtx | MutationCtx, now: number) {
  return (await gameGate(ctx, GAME, now)).code === null;
}

/** Credits each cash-out to its seat row and the wallet, once (`o21-cashout-<seat>` is unique). */
async function payOut(ctx: MutationCtx, tableId: Id<"o21LiveTables">, cashOuts: CashOut[], now: number) {
  if (!cashOuts.length) return;
  const seats = await ctx.db
    .query("o21Seats")
    .withIndex("by_table", (q) => q.eq("tableId", tableId))
    .collect();
  for (const cash of cashOuts) {
    const seat = seats.find((row) => row.checkedInId === cash.playerId && row.status === "seated");
    if (!seat) continue;
    await creditWallet(ctx, { checkedIn: { _id: seat.checkedInId }, game: GAME, playId: `o21-cashout-${seat._id}`, amount: cash.chips, now });
    await ctx.db.patch(seat._id, { status: "cashed_out", returned: cash.chips, reason: REASON_TEXT[cash.reason], cashedOutAt: now });
  }
}

/**
 * Loads a table, runs `command` through `runLive` (timers, closing, idle,
 * cash-outs), saves, pays out and schedules the next tick.
 */
async function runOnTable<R extends CommandResult | null>(
  ctx: MutationCtx,
  tableId: Id<"o21LiveTables">,
  now: number,
  command?: (table: Table) => R,
  options: { pendingCleared?: boolean } = {},
) {
  const doc = await ctx.db.get(tableId);
  if (!doc || doc.status === "closed") return { result: undefined as R | undefined, closed: true };
  const out = runLive(doc.state, { now, rng: serverRandom, open: await isOpen(ctx, now), idleSince: doc.idleSince ?? null, command });
  await payOut(ctx, tableId, out.cashOuts, now);

  // Schedule the next tick unless one is already pending at or before it.
  const pending = options.pendingCleared ? undefined : doc.wakeAt;
  let wakeAt = pending;
  if (out.wakeAt === null) wakeAt = undefined;
  else if (pending === undefined || pending > out.wakeAt || pending < now - STALE_WAKE_MS) {
    await ctx.scheduler.runAt(out.wakeAt, internal.arcade.olympus21.tick, { tableId, at: out.wakeAt });
    wakeAt = out.wakeAt;
  }

  if (out.changed || wakeAt !== doc.wakeAt || (out.idleSince ?? undefined) !== doc.idleSince) {
    await ctx.db.patch(tableId, {
      ...(out.changed ? { state: saveLive(out.table), status: out.table.status, humans: out.table.seats.filter((p) => p && !p.bot).length, version: doc.version + 1 } : {}),
      wakeAt,
      idleSince: out.idleSince ?? undefined,
      updatedAt: now,
    });
  }
  return { result: out.result, closed: out.closed };
}

// ---------------------------------------------------------------------------
// who's asking

type Me = { checkedIn: CheckedInDoc; name: string };

/** The signed-in, accepted, checked-in hacker, or the reason they can't play. */
async function me(ctx: MutationCtx): Promise<Me | { code: string }> {
  const player = await loadPlayer(ctx);
  const problem = playerProblem(player);
  if (problem) return { code: problem };
  const name = (await playerDisplayName(ctx, player)).split(" ")[0]!.slice(0, NAME_MAX) || "Hacker";
  return { checkedIn: player.checkedIn!, name };
}

/** Runs a player's engine command on their current table. */
async function onMyTable(ctx: MutationCtx, command: (table: Table, playerId: string, now: number) => CommandResult): Promise<Result> {
  const now = Date.now();
  const mine = await me(ctx);
  if ("code" in mine) return fail(mine.code, now);
  const seat = await myLatestSeat(ctx, mine.checkedIn._id);
  if (!seat || seat.status !== "seated") return fail("NOT_SEATED", now);
  const gate = await gameGate(ctx, GAME, now);
  const out = await runOnTable(ctx, seat.tableId, now, (table) => command(table, mine.checkedIn._id, now));
  if (gate.code) return fail(gate.code, now);
  if (out.result === undefined) return fail("TABLE_CLOSED", now);
  return out.result.ok ? ok(now) : fail(out.result.code, now);
}

// ---------------------------------------------------------------------------
// queue

/** Buy in and wait for a table. Already queued or seated: fine, nothing changes. */
export const joinQueue = mutation({
  args: { actionId: ACTION_ID },
  handler: async (ctx): Promise<Result> => {
    const now = Date.now();
    const mine = await me(ctx);
    if ("code" in mine) return fail(mine.code, now);
    const seat = await myLatestSeat(ctx, mine.checkedIn._id);
    if (seat?.status === "seated") return ok(now);
    if (await myQueueRow(ctx, mine.checkedIn._id)) return ok(now);
    const { code } = await gameGate(ctx, GAME, now);
    if (code) return fail(code, now);
    if ((await arcadeBalance(ctx, mine.checkedIn)) < O21_BUY_IN) return fail("INSUFFICIENT_POINTS", now);
    const queueId = await ctx.db.insert("o21Queue", { checkedInId: mine.checkedIn._id, name: mine.name, joinedAt: now });
    const paid = await applyPlay(ctx, { checkedIn: mine.checkedIn, game: GAME, playId: `o21-buyin-${queueId}`, stake: O21_BUY_IN, payout: 0, now });
    // Checked just above, so a refusal here means a race: undo everything.
    if (!paid.ok) throw new Error(`olympus21: buy-in refused (${paid.code})`);
    await ctx.scheduler.runAfter(0, internal.arcade.olympus21.trySeat, {});
    await ctx.scheduler.runAfter(O21_QUEUE_FILL_MS, internal.arcade.olympus21.trySeat, {});
    return ok(now);
  },
});

async function refundQueued(ctx: MutationCtx, row: { _id: Id<"o21Queue">; checkedInId: Id<"checkedIn"> }, now: number) {
  await ctx.db.delete(row._id);
  await creditWallet(ctx, { checkedIn: { _id: row.checkedInId }, game: GAME, playId: `o21-refund-${row._id}`, amount: O21_BUY_IN, now });
}

/** Leave the queue; the buy-in goes back to the wallet. */
export const cancelQueue = mutation({
  args: { actionId: ACTION_ID },
  handler: async (ctx): Promise<Result> => {
    const now = Date.now();
    const player = await loadPlayer(ctx);
    if (!player.checkedIn) return fail(playerProblem(player) ?? "NOT_CHECKED_IN", now);
    const row = await myQueueRow(ctx, player.checkedIn._id);
    if (row) await refundQueued(ctx, row, now);
    return ok(now);
  },
});

/** Seats the queue by poker's rule. Scheduled after every join (now, and at the fill time). */
export const trySeat = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const queue = await ctx.db.query("o21Queue").withIndex("by_joinedAt").take(64);
    if (!queue.length) return;
    // Switched off while people waited: give everyone their buy-in back.
    if (!(await isOpen(ctx, now))) {
      for (const row of queue) await refundQueued(ctx, row, now);
      return;
    }
    const seated = chooseSeating(queue, now);
    if (!seated) return;
    for (const row of seated) await ctx.db.delete(row._id);
    const tableId = await ctx.db.insert("o21LiveTables", { status: "waiting", state: "{}", humans: seated.length, version: 0, createdAt: now, updatedAt: now });
    const table = openLiveTable({
      id: tableId,
      humans: seated.map((row) => ({ id: row.checkedInId, name: row.name })),
      now,
      rng: serverRandom,
    });
    for (const row of seated) {
      await ctx.db.insert("o21Seats", { tableId, checkedInId: row.checkedInId, buyIn: O21_BUY_IN, status: "seated", createdAt: now });
    }
    await ctx.db.patch(tableId, { state: saveLive(table), status: table.status });
    await runOnTable(ctx, tableId, now);
  },
});

// ---------------------------------------------------------------------------
// at the table

/** Stand up (or leave the queue). Works even when the arcade is closed. Mid-round the bet stays in the pots. */
export const leave = mutation({
  args: { actionId: ACTION_ID },
  handler: async (ctx): Promise<Result> => {
    const now = Date.now();
    const player = await loadPlayer(ctx);
    if (!player.checkedIn) return fail(playerProblem(player) ?? "NOT_CHECKED_IN", now);
    const checkedInId = player.checkedIn._id;
    const queued = await myQueueRow(ctx, checkedInId);
    if (queued) {
      await refundQueued(ctx, queued, now);
      return ok(now);
    }
    const seat = await myLatestSeat(ctx, checkedInId);
    if (!seat || seat.status !== "seated") return ok(now);
    // Chips come back in the same run when the engine lets the player go (at
    // once between rounds, at the result mid-round); runLive pays everyone
    // still seated when the table closes.
    await runOnTable(ctx, seat.tableId, now, (table) => engineLeave(table, checkedInId, now));
    return ok(now);
  },
});

export const placeWagerMove = mutation({
  args: { actionId: ACTION_ID, amount: v.number() },
  handler: async (ctx, { amount }): Promise<Result> => onMyTable(ctx, (table, id, now) => placeWager(table, id, amount, now)),
});

export const playCard = mutation({
  args: { actionId: ACTION_ID, card: v.string(), color: v.optional(v.string()) },
  handler: async (ctx, { card, color }): Promise<Result> => onMyTable(ctx, (table, id, now) => play(table, id, card, color, now)),
});

export const drawCard = mutation({
  args: { actionId: ACTION_ID },
  handler: async (ctx): Promise<Result> => onMyTable(ctx, (table, id, now) => draw(table, id, now)),
});

/** PLAY AGAIN: deal me into the next round. */
export const playAgain = mutation({
  args: { actionId: ACTION_ID },
  handler: async (ctx): Promise<Result> => onMyTable(ctx, (table, id, now) => ready(table, id, now)),
});

/** Scheduled: timers, bots, closing and idle tables. A tick with nothing due only fixes the pending-tick record. */
export const tick = internalMutation({
  args: { tableId: v.id("o21LiveTables"), at: v.optional(v.number()) },
  handler: async (ctx, { tableId, at }) => {
    const doc = await ctx.db.get(tableId);
    if (!doc || doc.status === "closed") return null;
    const now = Date.now();
    const pendingCleared = doc.wakeAt !== undefined && (doc.wakeAt === at || doc.wakeAt <= now);
    await runOnTable(ctx, tableId, now, undefined, { pendingCleared });
    return null;
  },
});

// ---------------------------------------------------------------------------
// query

/**
 * Everything one hacker's screen needs: whether tables are open, their wallet,
 * their place in the queue, their table view (never other hands or the piles),
 * and how their last table ended. `nowBucket` only changes the cache key so
 * clients re-run it as time passes; the server clock decides.
 */
export const getMyTable = query({
  args: { nowBucket: v.optional(v.number()) },
  handler: async (ctx) => {
    const now = Date.now();
    const { state } = await loadArcade(ctx, now);
    const game = await gameRow(ctx, GAME);
    const status =
      state.status === "on" ? (game?.enabled ? "live" : "closed") : state.status === "scheduled" ? "teaser" : "no_window";
    const window = state.opensAt !== null && state.closesAt !== null ? { opensAt: state.opensAt, closesAt: state.closesAt } : null;

    const player = await loadPlayer(ctx);
    const checkedIn = player.checkedIn;
    const base = {
      status,
      window,
      buyIn: O21_BUY_IN,
      player: {
        signedIn: player.user !== null,
        eligible: player.participant !== null && player.eligible,
        checkedIn: checkedIn !== null,
        name: player.user ? (await playerDisplayName(ctx, player)).split(" ")[0]! : null,
        balance: checkedIn ? await arcadeBalance(ctx, checkedIn) : 0,
      },
      queue: null as { queuedAt: number; waiting: number } | null,
      leaving: false,
      view: null as ReturnType<typeof viewFor> | null,
      result: null as { returned: number; reason: string } | null,
      serverNow: now,
    };
    if (!checkedIn) return base;

    const queued = await myQueueRow(ctx, checkedIn._id);
    if (queued) {
      const waiting = (await ctx.db.query("o21Queue").withIndex("by_joinedAt").take(64)).length;
      return { ...base, queue: { queuedAt: queued.joinedAt, waiting } };
    }
    const seat = await myLatestSeat(ctx, checkedIn._id);
    if (!seat) return base;
    if (seat.status === "cashed_out") {
      return { ...base, result: { returned: seat.returned ?? 0, reason: seat.reason ?? "" } };
    }
    const table = await ctx.db.get(seat.tableId);
    if (!table || table.status === "closed") return base;
    const engine = importState(table.state);
    const p = seatedPlayer(engine, checkedIn._id);
    if (!p) return base;
    // Left mid-round: the seat is kept until the round settles, then the chips come back.
    if (p.gone) return { ...base, leaving: true };
    return { ...base, view: viewFor(engine, checkedIn._id, now) };
  },
});
