/**
 * Olympus 21: table engine.
 *
 * One table is a mutable plain object. The engine owns every timer, driven by
 * `tick(table, now)`; it never reads the clock or Math.random itself (both are
 * injected). Commands return { ok: true } or { ok: false, code } and never throw.
 */
import {
  COLORS,
  COLOR_NAMES,
  TARGET,
  buildDeck,
  canPlay,
  colorOf,
  isCard,
  isNumberCard,
  legalCards,
  nextSeat,
  autoMove,
  scorePlay,
  seededRng,
  shuffle,
  valueOf,
} from "./rules.js";
import { MIN_WAGER, buildPots, maxWagerFor, resolveWagers, settlePots } from "./wagers.js";
import { botMove, botWager } from "./bots.js";

export const DEFAULT_TIMINGS = Object.freeze({
  seatLockMs: 15000,
  wagerMs: 60000,
  countdownMs: 5000,
  turnMs: 20000,
  resultMs: 15000, // settled: the PLAY AGAIN window (CONTRACT §7)
  botThinkMs: Object.freeze([900, 2600]),
});
export const HAND_SIZE = 5;
export const PLAY_CAP = 60;
export const DEFAULT_LOSS_CAP = 100;
export const MAX_TIMEOUTS = 3;

const MOVE_LOG = 8;
const HISTORY_LOG = 6;

/**
 * @typedef {{
 *   id: string, name: string, bot: boolean, balance: number, lostThisWindow: number,
 *   seat: number, state: "waiting" | "playing" | "bust" | "won" | "folded" | "sitting_out",
 *   pick: number | null, picked: boolean, wager: number | null, hand: string[],
 *   timeouts: number, pointsDelta: number | null, history: { roundNo: number, delta: number, reason: string }[],
 *   botAt: number | null, botDone: boolean, gone: boolean, kick: boolean,
 *   ready: boolean, inRound: boolean, readyAt: number | null,
 * }} Player
 *
 * ready: wants to be dealt into the next round (PLAY AGAIN, CONTRACT §7).
 * inRound: was dealt into the current/last wager window (their `ready` resets at settle).
 * readyAt: bots only, when they press PLAY AGAIN during the result screen.
 */

/** @param {unknown} value @param {number} fallback */
const num = (value, fallback) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/**
 * @param {{ id?: string, maxSeats?: number, timings?: Partial<typeof DEFAULT_TIMINGS>, rng?: () => number, now?: number, lossCap?: number }} [options]
 */
export function createTable({ id = "table", maxSeats = 4, timings, rng, now = 0, lossCap = DEFAULT_LOSS_CAP } = {}) {
  const table = {
    id: String(id),
    maxSeats: Math.min(4, Math.max(2, Math.floor(num(maxSeats, 4)))),
    timings: { ...DEFAULT_TIMINGS, ...(timings || {}) },
    lossCap: num(lossCap, DEFAULT_LOSS_CAP),
    status: /** @type {"waiting" | "wagering" | "countdown" | "turns" | "settled" | "closed"} */ ("waiting"),
    roundNo: 0,
    now: num(now, 0),
    deadline: /** @type {number | null} */ (null),
    /** @type {(Player | null)[]} */
    seats: [],
    drawPile: /** @type {string[]} */ ([]), // top = last element
    playPile: /** @type {string[]} */ ([]), // top = last element
    count: 0,
    activeColor: /** @type {string | null} */ (null),
    direction: /** @type {1 | -1} */ (1),
    turnSeat: /** @type {number | null} */ (null),
    plays: 0,
    /** @type {{ seat: number, wager: number, picked: boolean }[]} */
    roundWagers: [],
    /** @type {{ amount: number, eligible: number[], level: number }[]} */
    pots: [],
    /** @type {null | { reason: "21" | "last" | "cap" | "closed", winners: number[], deltas: Record<number, number> }} */
    result: null,
    moves: /** @type {any[]} */ ([]),
    seq: 0,
    createdAt: num(now, 0),
    /** Waiting after a PLAY AGAIN window ran out: start as soon as the start rule is met (no seat lock). */
    paused: false,
  };
  table.seats = Array.from({ length: table.maxSeats }, () => null);
  Object.defineProperty(table, "rng", { value: typeof rng === "function" ? rng : seededRng(1), enumerable: false, writable: true });
  Object.defineProperty(table, "listeners", { value: new Set(), enumerable: false });
  return table;
}

// ---------------------------------------------------------------------------
// helpers

/** @returns {Player[]} */
const seated = (table) => table.seats.filter(Boolean);
const findPlayer = (table, playerId) => seated(table).find((p) => p.id === playerId) || null;
const liveSeats = (table) => seated(table).filter((p) => p.state === "playing").map((p) => p.seat);
const lossRoom = (table, p) => table.lossCap - p.lostThisWindow;
const topCard = (table) => (table.playPile.length ? table.playPile[table.playPile.length - 1] : null);

function think(table, now) {
  const [lo, hi] = table.timings.botThinkMs;
  return now + lo + Math.floor(table.rng() * Math.max(0, hi - lo));
}

function log(table, player, kind, text, extra = {}) {
  table.seq += 1;
  const move = { seq: table.seq, seat: player ? player.seat : -1, name: player ? player.name : "", kind, text };
  for (const key of ["card", "count", "color"]) if (extra[key] !== undefined) move[key] = extra[key];
  table.moves.push(move);
  if (table.moves.length > MOVE_LOG * 4) table.moves.splice(0, table.moves.length - MOVE_LOG);
}

function notify(table) {
  for (const fn of table.listeners) {
    try {
      fn();
    } catch {
      /* a listener's error must not break the engine */
    }
  }
}

const ok = () => ({ ok: true });
const fail = (code) => ({ ok: false, code });

/** Draw one card, reshuffling the played pile (minus its top card) when the draw pile is empty. */
function drawCard(table) {
  if (table.drawPile.length === 0 && table.playPile.length > 1) {
    const top = table.playPile.pop();
    table.drawPile = shuffle(table.playPile, table.rng);
    table.playPile = [top];
  }
  return table.drawPile.length ? table.drawPile.pop() : null;
}

function removePlayer(table, p) {
  table.seats[p.seat] = null;
}

// ---------------------------------------------------------------------------
// phases

/** Seated players who will still be here next round (not leaving, not being unseated). */
const staying = (table) => seated(table).filter((p) => !p.gone && !p.kick);

/**
 * Start rule (CONTRACT §7): 2+ ready players, at least one of them human,
 * unless no human is seated at all (bot-only tables need just the 2).
 */
function canStart(table) {
  const players = staying(table);
  const ready = players.filter((p) => p.ready);
  if (ready.length < 2) return false;
  return !players.some((p) => !p.bot) || ready.some((p) => !p.bot);
}

/**
 * Waiting: arm the seat lock once the start rule is met (counting only ready
 * players); start at once when every seat holds a ready player, or right away
 * when the table is paused after a PLAY AGAIN window.
 */
function checkSeatLock(table, now) {
  if (table.status !== "waiting") return;
  if (seated(table).length < 2) table.paused = false;
  if (!canStart(table)) {
    table.deadline = null;
    return;
  }
  const ready = staying(table).filter((p) => p.ready).length;
  if (table.paused || ready >= table.maxSeats) startWagering(table, now);
  else if (table.deadline == null) table.deadline = now + table.timings.seatLockMs;
}

/** Settled: start early once everyone staying is ready (and the start rule holds). */
function checkEarlyStart(table, now) {
  if (table.status !== "settled") return false;
  const players = staying(table);
  if (players.length && players.every((p) => p.ready) && canStart(table)) {
    afterResult(table, now);
    return true;
  }
  return false;
}

/** Bots press PLAY AGAIN when their think timer runs out. Returns true if any did. */
function botsGetReady(table, now) {
  let changed = false;
  for (const p of seated(table)) {
    if (p.bot && !p.ready && !p.gone && p.readyAt != null && now >= p.readyAt) {
      p.ready = true;
      p.readyAt = null;
      log(table, p, "ready", `${p.name} is ready`);
      changed = true;
    }
  }
  return changed;
}

function resetRoundFields(p) {
  p.pick = null;
  p.picked = false;
  p.wager = null;
  p.hand = [];
  p.botAt = null;
  p.botDone = false;
}

function startWagering(table, now) {
  table.status = "wagering";
  table.paused = false;
  table.roundNo += 1;
  table.deadline = now + table.timings.wagerMs;
  table.result = null;
  table.pots = [];
  table.roundWagers = [];
  table.count = 0;
  table.activeColor = null;
  table.direction = 1;
  table.turnSeat = null;
  table.plays = 0;
  table.drawPile = [];
  table.playPile = [];
  for (const p of seated(table)) {
    if (p.ready) enterWagering(table, p, now);
    else sitOut(p);
  }
}

function enterWagering(table, p, now) {
  resetRoundFields(p);
  p.state = "playing";
  p.inRound = true;
  p.pointsDelta = null;
  if (p.bot) p.botAt = think(table, now);
}

/** Not ready when the wager window opened: seated, but no bet, no cards, skipped. */
function sitOut(p) {
  resetRoundFields(p);
  p.state = "sitting_out";
  p.inRound = false;
  p.pointsDelta = null;
}

function backToWaiting(table, now) {
  table.status = "waiting";
  table.deadline = null;
  table.turnSeat = null;
  for (const p of seated(table)) {
    resetRoundFields(p);
    p.state = "waiting";
    p.inRound = false;
  }
  checkSeatLock(table, now);
}

const playingCount = (table) => seated(table).filter((p) => p.state === "playing").length;

function startCountdown(table, now) {
  const players = seated(table).filter((p) => p.state === "playing");
  const { wagers, sittingOut } = resolveWagers(
    players.map((p) => ({ seat: p.seat, balance: p.balance, lossRoom: lossRoom(table, p), pick: p.picked ? p.pick : null })),
  );
  if (wagers.length < 2) {
    backToWaiting(table, now);
    return;
  }
  for (const seat of sittingOut) {
    const p = table.seats[seat];
    p.state = "sitting_out";
    p.wager = null;
  }
  for (const w of wagers) {
    const p = table.seats[w.seat];
    p.wager = w.wager;
    p.balance -= w.wager;
  }
  table.roundWagers = wagers;
  table.pots = buildPots(wagers);
  table.status = "countdown";
  table.deadline = now + table.timings.countdownMs;
}

function deal(table, now) {
  const deck = shuffle(buildDeck(), table.rng); // top = last element
  const players = seated(table).filter((p) => p.state === "playing");
  for (let i = 0; i < HAND_SIZE; i += 1) for (const p of players) p.hand.push(deck.pop());
  const skipped = [];
  let starter = null;
  while (deck.length) {
    const card = deck.pop();
    if (isNumberCard(card)) {
      starter = card;
      break;
    }
    skipped.push(card);
  }
  deck.unshift(...skipped); // non-number cards go beneath the pile
  table.drawPile = deck;
  table.playPile = starter ? [starter] : [];
  table.count = starter ? valueOf(starter) : 0;
  table.activeColor = starter ? colorOf(starter) : COLORS[0];
  table.direction = 1;
  table.plays = 0;
  table.status = "turns";
  log(table, null, "deal", `Round ${table.roundNo}: ${starter} starts the count at ${table.count}`, { card: starter, count: table.count });
  const live = liveSeats(table);
  setTurn(table, Math.min(...live), now);
}

function setTurn(table, seat, now) {
  table.turnSeat = seat;
  table.deadline = now + table.timings.turnMs;
  const p = table.seats[seat];
  if (p && p.bot) p.botAt = think(table, now);
}

/**
 * End the round and pay the pots.
 * @param {"21" | "last" | "cap" | "closed"} reason @param {number[]} winners
 */
function settle(table, reason, winners, now) {
  const { payouts, deltas } = settlePots(table.roundWagers, winners);
  for (const w of table.roundWagers) {
    const p = table.seats[w.seat];
    if (!p) continue;
    p.balance += payouts[w.seat];
    p.pointsDelta = deltas[w.seat];
    if (deltas[w.seat] < 0) p.lostThisWindow += -deltas[w.seat];
    p.history.push({ roundNo: table.roundNo, delta: deltas[w.seat], reason });
    if (p.history.length > HISTORY_LOG) p.history.splice(0, p.history.length - HISTORY_LOG);
  }
  for (const seat of winners) {
    const p = table.seats[seat];
    if (p) p.state = "won";
  }
  table.result = { reason, winners: winners.slice().sort((a, b) => a - b), deltas };
  table.turnSeat = null;
  if (reason === "closed") {
    table.status = "closed";
    table.deadline = null;
  } else {
    table.status = "settled";
    table.deadline = now + table.timings.resultMs; // the PLAY AGAIN deadline
    // Everyone dealt into this round taps PLAY AGAIN for the next one; bots do it after a short think.
    // Players who sat this round out (or joined mid-round) keep their flag.
    for (const p of seated(table)) {
      if (!p.inRound) continue;
      p.ready = false;
      p.readyAt = p.bot && !p.gone && !p.kick ? think(table, now) : null;
    }
  }
}

function afterResult(table, now) {
  for (const p of seated(table)) {
    if (p.gone) removePlayer(table, p);
    else if (p.kick) {
      log(table, p, "leave", `${p.name} was removed after ${MAX_TIMEOUTS} timeouts`);
      removePlayer(table, p);
    }
  }
  if (canStart(table)) startWagering(table, now);
  else {
    // Not enough ready players: wait (no timer) until a ready/join/leave meets the start rule.
    table.paused = true;
    backToWaiting(table, now);
  }
}

/** After a turn: end the round if needed, else hand the turn on. */
function advance(table, fromSeat, skipOne, now) {
  if (table.status !== "turns") return;
  const live = liveSeats(table);
  if (live.length <= 1) {
    settle(table, "last", live, now);
    return;
  }
  if (table.plays >= PLAY_CAP) {
    settle(table, "cap", live, now);
    return;
  }
  setTurn(table, nextSeat(live, fromSeat, table.direction, skipOne), now);
}

/** Give `n` cards to p; returns false if both piles ran dry. */
function giveCards(table, p, n) {
  for (let i = 0; i < n; i += 1) {
    const card = drawCard(table);
    if (card == null) return false;
    p.hand.push(card);
  }
  return true;
}

function applyPlay(table, p, card, color, now) {
  p.hand.splice(p.hand.indexOf(card), 1);
  table.playPile.push(card);
  table.plays += 1;
  table.activeColor = card === "W" ? color : colorOf(card);
  const before = table.count;
  const scored = scorePlay(before, card);
  if (scored.outcome === "win") {
    table.count = scored.count;
    log(table, p, "win", `${p.name} hit 21!`, { card, count: TARGET });
    settle(table, "21", [p.seat], now);
    return;
  }
  if (scored.outcome === "bust") {
    table.count = 0;
    p.state = "bust";
    log(table, p, "bust", `${p.name} busted on ${before + valueOf(card)}`, { card, count: before + valueOf(card) });
    advance(table, p.seat, false, now);
    return;
  }
  table.count = scored.count;
  log(table, p, "play", `${p.name} played ${card} → ${table.count}`, { card, count: table.count, ...(card === "W" ? { color } : {}) });
  const live = liveSeats(table);
  const rank = card === "W" ? "W" : card.slice(1);
  if (rank === "S") {
    const victim = table.seats[nextSeat(live, p.seat, table.direction)];
    log(table, victim, "skip", `Nobody! ${victim.name} is skipped`, { card });
    advance(table, p.seat, true, now);
  } else if (rank === "R") {
    if (live.length === 2) {
      const victim = table.seats[nextSeat(live, p.seat, table.direction)];
      log(table, victim, "reverse", `Charybdis! ${victim.name} is skipped`, { card });
      advance(table, p.seat, true, now);
    } else {
      table.direction = table.direction === 1 ? -1 : 1;
      log(table, p, "reverse", `Charybdis! Play reverses`, { card });
      advance(table, p.seat, false, now);
    }
  } else if (rank === "+2") {
    const victim = table.seats[nextSeat(live, p.seat, table.direction)];
    const enough = giveCards(table, victim, 2);
    log(table, victim, "plus2", `Sirens! ${victim.name} draws 2`, { card });
    if (!enough) settle(table, "cap", liveSeats(table), now);
    else advance(table, p.seat, true, now);
  } else if (rank === "W") {
    log(table, p, "wild", `Odysseus! Color is now ${COLOR_NAMES[color]}`, { card, color });
    advance(table, p.seat, false, now);
  } else {
    advance(table, p.seat, false, now);
  }
}

function applyDraw(table, p, now) {
  const card = drawCard(table);
  if (card == null) {
    settle(table, "cap", liveSeats(table), now);
    return;
  }
  p.hand.push(card);
  log(table, p, "draw", `${p.name} drew a card`);
  advance(table, p.seat, false, now);
}

function applyMove(table, p, move, now) {
  if (move.kind === "play") applyPlay(table, p, move.card, move.color, now);
  else applyDraw(table, p, now);
}

/** Take a seated player out of the current round (bet stays in the pots). */
function fold(table, p, now) {
  const wasTurn = table.status === "turns" && table.turnSeat === p.seat;
  p.state = "folded";
  p.gone = true;
  if (p.hand.length) {
    table.drawPile.unshift(...p.hand);
    p.hand = [];
  }
  log(table, p, "leave", `${p.name} left the table`);
  const live = liveSeats(table);
  if (live.length <= 1) {
    settle(table, "last", live, now);
    return;
  }
  if (wasTurn) setTurn(table, nextSeat(live, p.seat, table.direction), now);
}

// ---------------------------------------------------------------------------
// commands

/** @param {any} table @param {{ id: string, name?: string, balance?: number, bot?: boolean }} info @param {number} now */
export function join(table, info, now) {
  if (!table || !info || typeof info.id !== "string" || !info.id) return fail("BAD_REQUEST");
  now = num(now, table.now);
  table.now = now;
  if (table.status === "closed") return fail("TABLE_CLOSED");
  if (findPlayer(table, info.id)) return fail("ALREADY_SEATED");
  const seat = table.seats.findIndex((s) => s === null);
  if (seat < 0) return fail("TABLE_FULL");
  const name = typeof info.name === "string" && info.name.trim() ? info.name.trim().slice(0, 24) : `Player ${seat + 1}`;
  /** @type {Player} */
  const p = {
    id: info.id,
    name,
    bot: !!info.bot,
    balance: Math.max(0, Math.floor(num(info.balance, 0))),
    lostThisWindow: 0,
    seat,
    state: "waiting",
    pick: null,
    picked: false,
    wager: null,
    hand: [],
    timeouts: 0,
    pointsDelta: null,
    history: [],
    botAt: null,
    botDone: false,
    gone: false,
    kick: false,
    ready: true, // sitting down is the intent to play
    inRound: false,
    readyAt: null,
  };
  table.seats[seat] = p;
  log(table, p, "join", `${name} joined`);
  if (table.status === "wagering") enterWagering(table, p, now);
  else if (table.status === "settled") checkEarlyStart(table, now);
  else checkSeatLock(table, now);
  notify(table);
  return ok();
}

/** PLAY AGAIN: deal me into the next round (CONTRACT §7). Idempotent. */
export function ready(table, playerId, now) {
  if (!table) return fail("BAD_REQUEST");
  now = num(now, table.now);
  table.now = now;
  if (table.status === "closed") return fail("TABLE_CLOSED");
  const p = findPlayer(table, playerId);
  if (!p || p.gone) return fail("NOT_SEATED");
  if (p.ready) return ok();
  p.ready = true;
  p.readyAt = null;
  log(table, p, "ready", `${p.name} is ready`);
  if (table.status === "settled") checkEarlyStart(table, now);
  else if (table.status === "waiting") checkSeatLock(table, now);
  // wagering / countdown / turns: a sitting-out player is now queued for the next round.
  notify(table);
  return ok();
}

export function leave(table, playerId, now) {
  if (!table) return fail("BAD_REQUEST");
  now = num(now, table.now);
  table.now = now;
  const p = findPlayer(table, playerId);
  if (!p || p.gone) return fail("NOT_SEATED");
  const inRound = (table.status === "countdown" || table.status === "turns") && p.state === "playing";
  if (inRound) fold(table, p, now);
  else if ((table.status === "countdown" || table.status === "turns") && table.roundWagers.some((w) => w.seat === p.seat)) {
    // busted this round: their seat is kept until the result so the pots can settle
    p.gone = true;
    log(table, p, "leave", `${p.name} left the table`);
  } else if (table.status === "settled" || table.status === "closed") {
    removePlayer(table, p);
    log(table, p, "leave", `${p.name} left the table`);
    checkEarlyStart(table, now);
  } else {
    removePlayer(table, p);
    log(table, p, "leave", `${p.name} left the table`);
    if (table.status === "wagering" && playingCount(table) < 2) backToWaiting(table, now);
    else if (table.status === "waiting") checkSeatLock(table, now);
    else if (table.status === "wagering") maybeEndWagering(table, now);
  }
  notify(table);
  return ok();
}

export function placeWager(table, playerId, amount, now) {
  if (!table) return fail("BAD_REQUEST");
  now = num(now, table.now);
  table.now = now;
  const p = findPlayer(table, playerId);
  if (!p || p.gone) return fail("NOT_SEATED");
  if (table.status !== "wagering" || p.state !== "playing") return fail("WAGERS_CLOSED");
  if (typeof amount !== "number" || !Number.isFinite(amount)) return fail("BET_TOO_SMALL");
  const value = Math.floor(amount);
  if (value < MIN_WAGER) return fail("BET_TOO_SMALL");
  if (value > maxWagerFor({ balance: p.balance, lossRoom: lossRoom(table, p) })) return fail("BET_TOO_BIG");
  p.pick = value;
  p.picked = true;
  p.botDone = true;
  maybeEndWagering(table, now);
  notify(table);
  return ok();
}

/** End the wager window early once every player has picked. */
function maybeEndWagering(table, now) {
  if (table.status !== "wagering") return;
  const players = seated(table).filter((p) => p.state === "playing");
  if (players.length >= 2 && players.every((p) => p.picked)) startCountdown(table, now);
}

function turnPlayer(table, playerId) {
  if (table.status !== "turns") return null;
  const p = findPlayer(table, playerId);
  if (!p || p.seat !== table.turnSeat || p.state !== "playing") return null;
  return p;
}

export function play(table, playerId, card, color, now) {
  if (!table) return fail("BAD_REQUEST");
  now = num(now, table.now);
  table.now = now;
  const p = turnPlayer(table, playerId);
  if (!p) return fail("NOT_YOUR_TURN");
  if (typeof card !== "string" || !p.hand.includes(card)) return fail("NOT_IN_HAND");
  if (!canPlay(card, topCard(table), table.activeColor)) return fail("DOESNT_MATCH");
  if (card === "W" && !COLORS.includes(color)) return fail("PICK_A_COLOR");
  p.timeouts = 0;
  applyPlay(table, p, card, card === "W" ? color : colorOf(card), now);
  notify(table);
  return ok();
}

export function draw(table, playerId, now) {
  if (!table) return fail("BAD_REQUEST");
  now = num(now, table.now);
  table.now = now;
  const p = turnPlayer(table, playerId);
  if (!p) return fail("NOT_YOUR_TURN");
  if (legalCards(p.hand, topCard(table), table.activeColor).length) return fail("MUST_PLAY");
  p.timeouts = 0;
  applyDraw(table, p, now);
  notify(table);
  return ok();
}

/** One step of the timer machine; returns true if it changed anything. */
function step(table, now) {
  switch (table.status) {
    case "waiting":
      if (botsGetReady(table, now)) {
        checkSeatLock(table, now);
        return true;
      }
      if (table.deadline != null && now >= table.deadline) {
        table.deadline = null;
        if (canStart(table)) startWagering(table, now);
        return true;
      }
      return false;
    case "wagering": {
      for (const p of seated(table)) {
        if (p.bot && p.state === "playing" && !p.botDone && p.botAt != null && now >= p.botAt) {
          p.botDone = true;
          const pick = botWager(table.rng, { balance: p.balance, lossRoom: lossRoom(table, p) });
          if (pick != null) {
            p.pick = pick;
            p.picked = true;
          }
          maybeEndWagering(table, now);
          return true;
        }
      }
      if (now >= table.deadline) {
        startCountdown(table, now);
        return true;
      }
      return false;
    }
    case "countdown":
      if (now >= table.deadline) {
        deal(table, now);
        return true;
      }
      return false;
    case "turns": {
      const p = table.seats[table.turnSeat];
      if (!p) return false;
      if (p.bot && p.botAt != null && now >= p.botAt && now < table.deadline) {
        p.botAt = null;
        applyMove(table, p, botMove(p.hand, topCard(table), table.activeColor, table.count, table.rng), now);
        return true;
      }
      if (now >= table.deadline) {
        p.timeouts += 1;
        if (p.timeouts >= MAX_TIMEOUTS) p.kick = true;
        log(table, p, "timeout", `${p.name} ran out of time`);
        applyMove(table, p, autoMove(p.hand, topCard(table), table.activeColor), now);
        return true;
      }
      return false;
    }
    case "settled": {
      const changed = botsGetReady(table, now);
      if (checkEarlyStart(table, now)) return true;
      if (now >= table.deadline) {
        afterResult(table, now);
        return true;
      }
      return changed;
    }
    default:
      return false;
  }
}

export function tick(table, now) {
  if (!table) return false;
  now = num(now, table.now);
  table.now = now;
  let changed = false;
  for (let i = 0; i < 500 && step(table, now); i += 1) changed = true;
  if (changed) notify(table);
  return changed;
}

export function closeTable(table, now) {
  if (!table) return fail("BAD_REQUEST");
  now = num(now, table.now);
  table.now = now;
  if (table.status === "closed") return ok();
  if (table.status === "countdown" || table.status === "turns") {
    settle(table, "closed", liveSeats(table), now);
  } else {
    table.status = "closed";
    table.deadline = null;
    table.turnSeat = null;
  }
  notify(table);
  return ok();
}

// ---------------------------------------------------------------------------
// views

export function viewFor(table, playerId, now) {
  now = num(now, table.now);
  const settled = table.status === "settled" || table.status === "closed";
  const top = topCard(table);
  const me = playerId == null ? null : findPlayer(table, playerId);
  const seats = seated(table)
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) => {
      const isMe = !!me && p.id === me.id;
      return {
        seat: p.seat,
        playerId: p.id,
        name: p.name,
        bot: p.bot,
        isMe,
        wager: table.status === "wagering" ? (p.picked ? p.pick : null) : p.wager,
        picked: p.picked,
        cardCount: p.hand.length,
        state: p.state,
        pointsDelta: isMe || settled ? p.pointsDelta : null,
        timeouts: p.timeouts,
        ready: !!p.ready,
      };
    });
  let meView = null;
  if (me) {
    const myTurn = table.status === "turns" && table.turnSeat === me.seat && me.state === "playing";
    const hand = me.hand.map((card) => {
      const playable = table.status === "turns" && me.state === "playing" && canPlay(card, top, table.activeColor);
      let after = null;
      if (myTurn && playable) {
        const s = scorePlay(table.count, card);
        after = s.outcome === "continue" ? s.count : s.outcome;
      }
      return { card, playable, after };
    });
    meView = {
      playerId: me.id,
      seat: me.seat,
      balance: me.balance,
      lostThisWindow: me.lostThisWindow,
      lossCap: table.lossCap,
      maxWager: maxWagerFor({ balance: me.balance, lossRoom: lossRoom(table, me) }),
      wager: table.status === "wagering" ? (me.picked ? me.pick : null) : me.wager,
      picked: me.picked,
      ready: !!me.ready,
      myTurn,
      canDraw: myTurn && !hand.some((h) => h.playable),
      hand,
      history: me.history.slice(-HISTORY_LOG).map((h) => ({ ...h })),
    };
  }
  return {
    tableId: table.id,
    tableKey: `${table.id}:${table.createdAt}`,
    status: table.status,
    roundNo: table.roundNo,
    now,
    deadline: table.deadline,
    count: table.count,
    target: TARGET,
    topCard: top,
    activeColor: table.activeColor,
    direction: table.direction,
    drawLeft: table.drawPile.length,
    pot: table.pots.reduce((sum, pot) => sum + pot.amount, 0),
    pots: table.pots.map((pot) => ({ amount: pot.amount, eligible: pot.eligible.slice(), level: pot.level })),
    turnSeat: table.status === "turns" ? table.turnSeat : null,
    minWager: MIN_WAGER,
    maxSeats: table.maxSeats,
    seats,
    lastMoves: table.moves.slice(-MOVE_LOG).map((m) => ({ ...m })),
    result: table.result ? { reason: table.result.reason, winners: table.result.winners.slice(), deltas: { ...table.result.deltas } } : null,
    me: meView,
  };
}

export function addListener(table, fn) {
  if (!table || typeof fn !== "function") return () => {};
  table.listeners.add(fn);
  return () => table.listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// persistence (CONTRACT §9: hosts that store the table between requests)

/**
 * The earliest time `tick` could change anything: the phase deadline, a bot's
 * think timer, or a bot's PLAY AGAIN timer. Null when nothing is pending
 * (closed, or waiting with no timer).
 * @returns {number | null}
 */
export function nextWakeAt(table) {
  if (!table || table.status === "closed") return null;
  let wake = table.deadline == null ? null : table.deadline;
  const consider = (at) => {
    if (typeof at === "number" && Number.isFinite(at) && (wake == null || at < wake)) wake = at;
  };
  for (const p of seated(table)) {
    if (!p.bot) continue;
    if (table.status === "wagering" && p.state === "playing" && !p.botDone) consider(p.botAt);
    if (table.status === "turns" && p.seat === table.turnSeat && p.state === "playing") consider(p.botAt);
    if ((table.status === "settled" || table.status === "waiting") && !p.ready && !p.gone && p.readyAt != null) consider(p.readyAt);
  }
  return wake;
}

/** Plain JSON copy of the whole table (hands and piles included: keep it server-side). No functions or listeners. */
export function exportState(table) {
  return JSON.parse(JSON.stringify(table));
}

/**
 * A live table from `exportState` output (object or JSON string). `rng` is the
 * random source from now on; listeners start empty.
 * @param {any} json @param {{ rng?: () => number }} [options]
 */
export function importState(json, { rng } = {}) {
  const data = typeof json === "string" ? JSON.parse(json) : JSON.parse(JSON.stringify(json));
  const table = { ...data, timings: { ...DEFAULT_TIMINGS, ...(data.timings || {}) } };
  Object.defineProperty(table, "rng", { value: typeof rng === "function" ? rng : seededRng(1), enumerable: false, writable: true });
  Object.defineProperty(table, "listeners", { value: new Set(), enumerable: false });
  return table;
}

/** Total cards across hands and piles (always 100 during a round). For tests and debugging. */
export function cardTotal(table) {
  return table.drawPile.length + table.playPile.length + seated(table).reduce((sum, p) => sum + p.hand.length, 0);
}

export { isCard };
