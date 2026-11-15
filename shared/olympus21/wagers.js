/**
 * Olympus 21: wager resolution and side pots.
 *
 * Each player picks their own bet. Pots are built poker-style in layers, so a
 * player can win from each opponent at most what they bet themselves. Every
 * settlement is zero-sum.
 */

export const MIN_WAGER = 10;

/**
 * @typedef {{ seat: number, balance: number, lossRoom: number, pick: number | null }} WagerInput
 * @typedef {{ seat: number, wager: number, picked: boolean }} Wager
 * @typedef {{ amount: number, eligible: number[], level: number }} Pot
 */

/** floor(min(balance, lossRoom)), never negative. @param {{ balance: number, lossRoom: number }} p */
export function maxWagerFor(p) {
  const balance = Number.isFinite(p.balance) ? p.balance : 0;
  const lossRoom = Number.isFinite(p.lossRoom) ? p.lossRoom : 0;
  return Math.max(0, Math.floor(Math.min(balance, lossRoom)));
}

/** @param {number} value @param {number} lo @param {number} hi */
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/**
 * Players who can't afford MIN_WAGER sit out. Picks are clamped to [MIN_WAGER, max].
 * Non-pickers get floor(average of clamped picks), clamped to their own range;
 * if nobody picked, everyone plays MIN_WAGER.
 * @param {readonly WagerInput[]} players
 * @returns {{ wagers: Wager[], sittingOut: number[] }}
 */
export function resolveWagers(players) {
  const sittingOut = [];
  const able = [];
  for (const p of players) {
    const max = maxWagerFor(p);
    if (max < MIN_WAGER) sittingOut.push(p.seat);
    else able.push({ p, max });
  }
  const picks = [];
  for (const { p, max } of able) {
    if (typeof p.pick === "number" && Number.isFinite(p.pick)) picks.push(clamp(Math.floor(p.pick), MIN_WAGER, max));
  }
  const average = picks.length ? Math.floor(picks.reduce((a, b) => a + b, 0) / picks.length) : MIN_WAGER;
  const wagers = able.map(({ p, max }) => {
    const picked = typeof p.pick === "number" && Number.isFinite(p.pick);
    const wager = picked ? clamp(Math.floor(/** @type {number} */ (p.pick)), MIN_WAGER, max) : clamp(average, MIN_WAGER, max);
    return { seat: p.seat, wager, picked };
  });
  return { wagers, sittingOut };
}

/**
 * Poker-style layers: one pot per distinct wager level, funded by everyone who bet at least that much.
 * @param {readonly { seat: number, wager: number }[]} wagers
 * @returns {Pot[]}
 */
export function buildPots(wagers) {
  const live = wagers.filter((w) => w.wager > 0);
  const levels = [...new Set(live.map((w) => w.wager))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    const eligible = live.filter((w) => w.wager >= level).map((w) => w.seat).sort((a, b) => a - b);
    pots.push({ amount: (level - prev) * eligible.length, eligible, level });
    prev = level;
  }
  return pots;
}

/**
 * Split `amount` among `seats` (sorted), remainder 1 point at a time in seat order.
 * @param {Record<number, number>} payouts @param {number} amount @param {number[]} seats
 */
function split(payouts, amount, seats) {
  const sorted = seats.slice().sort((a, b) => a - b);
  const share = Math.floor(amount / sorted.length);
  let rest = amount - share * sorted.length;
  for (const seat of sorted) {
    payouts[seat] += share + (rest > 0 ? 1 : 0);
    if (rest > 0) rest -= 1;
  }
}

/**
 * Each layer is split among its eligible winners; a layer no winner is eligible
 * for is refunded to its eligible players. sum(deltas) === 0.
 * @param {readonly { seat: number, wager: number }[]} wagers
 * @param {readonly number[]} winnerSeats
 * @returns {{ payouts: Record<number, number>, deltas: Record<number, number> }}
 */
export function settlePots(wagers, winnerSeats) {
  /** @type {Record<number, number>} */
  const payouts = {};
  /** @type {Record<number, number>} */
  const deltas = {};
  for (const w of wagers) payouts[w.seat] = 0;
  const winners = new Set(winnerSeats);
  for (const pot of buildPots(wagers)) {
    const eligibleWinners = pot.eligible.filter((seat) => winners.has(seat));
    split(payouts, pot.amount, eligibleWinners.length ? eligibleWinners : pot.eligible);
  }
  for (const w of wagers) deltas[w.seat] = payouts[w.seat] - w.wager;
  return { payouts, deltas };
}
