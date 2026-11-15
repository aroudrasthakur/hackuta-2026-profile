/**
 * Olympus 21 on the live server: the pure part. The Convex module
 * (`backend/overlay/convex/arcade/olympus21.ts`) only loads and saves; every
 * decision about seating, chips and closing tables is made here, so it can be
 * tested without a deployment.
 *
 * Same shape as Olympus Poker (`convex/arcade/poker.ts`):
 * - one event-wide queue; joining it takes the buy-in from the arcade wallet;
 * - humans only (no bots, like poker since `a4378b3`): a full group sits at
 *   once, 2–3 after a short wait; a lone player waits for company;
 * - the buy-in becomes table chips; every wager comes out of the chips;
 * - chips go back to the wallet when the player leaves, is unseated for
 *   timing out, or the table closes.
 */
import {
  closeTable,
  createTable,
  exportState,
  importState,
  join,
  nextWakeAt,
  tick,
  type CommandResult,
  type Player,
  type Table,
} from "./engine.js";

/** Same as poker's buy-in. */
export const O21_BUY_IN = 50;
export const O21_MAX_SEATS = 4;
export const O21_MIN_PLAYERS = 2;
/** This many waiting humans sit down at once. */
export const O21_INSTANT_SEATS = 4;
/** 2–3 waiting humans sit down together after the oldest has waited this long. */
export const O21_QUEUE_FILL_MS = 2_500;
/** Open tables are checked at least this often (closing switches, idle tables). */
export const O21_HEARTBEAT_MS = 60_000;
/** A table where no human is ready to play for this long closes and pays out. */
export const O21_IDLE_CLOSE_MS = 120_000;
/** Chips are the only cap at a live table (the buy-in is the most you can lose). */
export const O21_LOSS_CAP = Number.MAX_SAFE_INTEGER;

export type QueueEntry = { joinedAt: number };

/**
 * Who sits down now, from the queue oldest first (poker's rule), or null to
 * keep waiting.
 */
export function chooseSeating<T extends QueueEntry>(queue: readonly T[], now: number): T[] | null {
  if (queue.length < O21_MIN_PLAYERS) return null;
  const take = [...queue].sort((a, b) => a.joinedAt - b.joinedAt).slice(0, O21_MAX_SEATS);
  const waited = now - take[0]!.joinedAt;
  if (take.length >= O21_INSTANT_SEATS) return take;
  if (waited >= O21_QUEUE_FILL_MS) return take;
  return null;
}

/** A new table with these humans, each with the buy-in as chips. */
export function openLiveTable(options: {
  id: string;
  humans: ReadonlyArray<{ id: string; name: string }>;
  now: number;
  rng: () => number;
}): Table {
  const { id, humans, now, rng } = options;
  const table = createTable({ id, maxSeats: O21_MAX_SEATS, rng, now, lossCap: O21_LOSS_CAP });
  for (const human of humans) join(table, { id: human.id, name: human.name, balance: O21_BUY_IN }, now);
  tick(table, now);
  return table;
}

export type CashOutReason = "left" | "timeout" | "closed";
export type CashOut = { playerId: string; chips: number; reason: CashOutReason };

export type LiveRun<R> = {
  table: Table;
  /** What `command` returned (undefined when there was none). */
  result: R | undefined;
  /** Humans who left the table during this run, with the chips they take home. */
  cashOuts: CashOut[];
  /** The table is (now) closed: nothing more will happen at it. */
  closed: boolean;
  /** Anything to save (state, cash-outs). */
  changed: boolean;
  /** Next time the table needs a tick, or null when closed. */
  wakeAt: number | null;
  /** Since when no human has been ready to play (for the idle close), or null. */
  idleSince: number | null;
};

/**
 * Wraps `table.seats` so every player the engine takes off the table is
 * recorded with their chips at that moment. The engine can settle a round
 * and unseat players in one tick, so a before/after snapshot would miss the
 * last round's payout.
 */
function trackRemovals(table: Table, removed: Player[]) {
  const seats = table.seats;
  table.seats = new Proxy(seats, {
    set(target, key, value) {
      const current = (target as unknown as Record<PropertyKey, unknown>)[key];
      if (value === null && current && typeof current === "object") removed.push({ ...(current as Player) });
      (target as unknown as Record<PropertyKey, unknown>)[key] = value;
      return true;
    },
  });
}

/** Read through a function so TypeScript doesn't narrow it: engine calls change the status. */
const isClosed = (table: Table) => table.status === "closed";
const humans = (table: Table) => table.seats.filter((p): p is Player => p !== null && !p.bot);
/** Humans who will still be here next round. */
const stayingHumans = (table: Table) => humans(table).filter((p) => !p.gone && !p.kick);

/**
 * One load-run-save cycle on a stored table:
 *   1. catch up on timers (or close the table when the game is no longer open);
 *   2. run `command` (a player's move), if any;
 *   3. catch up again, close a table no human is staying at, with too few
 *      players for a round, or idle for too long, and list everyone who left
 *      with their chips.
 */
export function runLive<R extends CommandResult | null>(
  state: string,
  options: {
    now: number;
    rng: () => number;
    /** The arcade is open and the game switched on. */
    open: boolean;
    idleSince?: number | null;
    command?: (table: Table) => R;
  },
): LiveRun<R> {
  const { now, rng, open, command } = options;
  const table = importState(state, { rng });
  const removed: Player[] = [];
  trackRemovals(table, removed);
  const wasClosed = isClosed(table);
  let changed = false;

  if (!open) {
    if (!isClosed(table)) {
      closeTable(table, now);
      changed = true;
    }
  } else if (tick(table, now)) {
    changed = true;
  }

  let result: R | undefined;
  if (command && !isClosed(table)) {
    result = command(table);
    if (result && result.ok) changed = true;
    if (!isClosed(table) && tick(table, now)) changed = true;
  }

  // Idle: nobody human is ready to play (they walked away after a round).
  let idleSince = options.idleSince ?? null;
  const someoneReady = stayingHumans(table).some((p) => p.ready || p.inRound);
  if (!isClosed(table)) {
    if (someoneReady) idleSince = null;
    else idleSince ??= now;
  }
  const idleTooLong = idleSince !== null && now - idleSince >= O21_IDLE_CLOSE_MS;
  // Like poker: no human left, or too few players for a round ("the table broke").
  const stayingPlayers = table.seats.filter((p) => p !== null && !p.gone && !p.kick).length;
  const broke = stayingHumans(table).length === 0 || stayingPlayers < O21_MIN_PLAYERS;
  if (!isClosed(table) && (broke || idleTooLong)) {
    closeTable(table, now);
    changed = true;
  }

  const cashOuts: CashOut[] = removed
    .filter((p) => !p.bot)
    .map((p) => ({ playerId: p.id, chips: Math.max(0, Math.floor(p.balance)), reason: p.kick ? "timeout" : "left" }));
  if (isClosed(table)) {
    // Everyone still seated takes their chips home (a closed round has already paid its pots).
    for (const p of humans(table)) {
      cashOuts.push({ playerId: p.id, chips: Math.max(0, Math.floor(p.balance)), reason: p.gone ? "left" : p.kick ? "timeout" : "closed" });
    }
    for (let i = 0; i < table.seats.length; i += 1) {
      if (table.seats[i] && !table.seats[i]!.bot) table.seats[i] = null;
    }
    if (!wasClosed) changed = true;
  }
  if (cashOuts.length) changed = true;

  const closed = isClosed(table);
  let wakeAt: number | null = null;
  if (!closed) {
    const next = nextWakeAt(table);
    wakeAt = Math.min(next ?? Number.POSITIVE_INFINITY, now + O21_HEARTBEAT_MS);
    if (idleSince !== null) wakeAt = Math.min(wakeAt, idleSince + O21_IDLE_CLOSE_MS);
    wakeAt = Math.max(wakeAt, now);
  }
  return { table, result, cashOuts, closed, changed, wakeAt, idleSince: closed ? null : idleSince };
}

/** The table as stored (hands and piles included: never send it to a browser). */
export function saveLive(table: Table): string {
  return JSON.stringify(exportState(table));
}

/** The engine player for this id, if they're still at the table and not leaving. */
export function seatedPlayer(table: Table, playerId: string): Player | null {
  const p = table.seats.find((seat): seat is Player => seat !== null && seat.id === playerId);
  return p ?? null;
}
