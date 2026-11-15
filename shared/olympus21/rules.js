/**
 * Olympus 21: pure card rules.
 *
 * Plain ESM with no imports, so it runs in the browser (SPA, mock adapter) and in
 * Node (sandbox server, tests). Randomness is always injected as `rng()` in [0, 1).
 *
 * Card codes: color letter + rank. Colors R (Ares), B (Poseidon), G (Athena),
 * Y (Zeus). Ranks 1-9, S (Skip, "Nobody"), R (Reverse, "Charybdis"), +2 (Sirens).
 * Wild is W (Odysseus).
 */

/**
 * @typedef {() => number} RandomFn  Returns a number in [0, 1), like Math.random.
 * @typedef {{ kind: "play", card: string, color: string | null } | { kind: "draw" }} Move
 */

export const COLORS = Object.freeze(["R", "B", "G", "Y"]);
export const TARGET = 21;
export const NUMBER_RANKS = Object.freeze(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
export const ACTION_RANKS = Object.freeze(["S", "R", "+2"]);
export const COLOR_NAMES = Object.freeze({ R: "red", B: "blue", G: "green", Y: "yellow" });

/**
 * Deterministic PRNG (mulberry32). Use for tests, simulations and the mock adapter.
 * @param {number} seed
 * @returns {RandomFn}
 */
export function seededRng(seed) {
  let a = (Number(seed) || 0) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Integer in [0, max), safe against rng() returning 1 or garbage.
 * @param {RandomFn} rng
 * @param {number} max
 */
export function randomInt(rng, max) {
  const value = Math.floor(rng() * max);
  if (!Number.isFinite(value) || value < 0) return 0;
  return value >= max ? max - 1 : value;
}

/** 100 cards: per color 1-9 x2, S x2, R x2, +2 x2; plus W x4. @returns {string[]} */
export function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    for (const rank of [...NUMBER_RANKS, ...ACTION_RANKS]) {
      deck.push(color + rank, color + rank);
    }
  }
  deck.push("W", "W", "W", "W");
  return deck;
}

/**
 * Fisher-Yates shuffle; returns a new array.
 * @template T
 * @param {readonly T[]} cards
 * @param {RandomFn} rng
 * @returns {T[]}
 */
export function shuffle(cards, rng) {
  const result = cards.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, i + 1);
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

/** @param {string} card @returns {string | null} */
export const colorOf = (card) => (card === "W" ? null : card[0]);
/** @param {string} card @returns {string} */
export const rankOf = (card) => (card === "W" ? "W" : card.slice(1));

/** True for a valid card code. @param {unknown} card */
export function isCard(card) {
  if (card === "W") return true;
  if (typeof card !== "string" || card.length < 2) return false;
  return COLORS.includes(card[0]) && (NUMBER_RANKS.includes(card.slice(1)) || ACTION_RANKS.includes(card.slice(1)));
}

/** True for a number card (1-9). @param {string} card */
export function isNumberCard(card) {
  return card !== "W" && NUMBER_RANKS.includes(rankOf(card));
}

/** Number cards add their value; S, R, +2, W add 0. @param {string} card */
export function valueOf(card) {
  return isNumberCard(card) ? Number(rankOf(card)) : 0;
}

/**
 * W always; otherwise the same color as the active color or the same rank as the top card.
 * @param {string} card @param {string | null} topCard @param {string | null} activeColor
 */
export function canPlay(card, topCard, activeColor) {
  if (!isCard(card)) return false;
  if (card === "W") return true;
  if (topCard == null && activeColor == null) return true;
  if (activeColor != null && colorOf(card) === activeColor) return true;
  return topCard != null && topCard !== "W" && rankOf(card) === rankOf(topCard);
}

/** @param {readonly string[]} hand @param {string | null} topCard @param {string | null} activeColor */
export function legalCards(hand, topCard, activeColor) {
  return hand.filter((card) => canPlay(card, topCard, activeColor));
}

/**
 * Add a card to the count. Landing on 21 wins; going over busts and resets the count to 0.
 * @param {number} count @param {string} card
 * @returns {{ count: number, outcome: "win" | "bust" | "continue" }}
 */
export function scorePlay(count, card) {
  const next = count + valueOf(card);
  if (next === TARGET) return { count: next, outcome: "win" };
  if (next > TARGET) return { count: 0, outcome: "bust" };
  return { count: next, outcome: "continue" };
}

/**
 * Next live seat in `direction` from `from`. `from` may be missing from liveSeats
 * (busted or left): the search starts from the gap it left. Returns null if nobody is live.
 * @param {readonly number[]} liveSeats @param {number} from @param {1 | -1} direction @param {boolean} [skipOne]
 * @returns {number}
 */
export function nextSeat(liveSeats, from, direction, skipOne = false) {
  const seats = [...new Set(liveSeats)].sort((a, b) => a - b);
  if (seats.length === 0) return /** @type {any} */ (null);
  const step = (start) => {
    if (direction === -1) {
      for (let i = seats.length - 1; i >= 0; i -= 1) if (seats[i] < start) return seats[i];
      return seats[seats.length - 1];
    }
    for (const seat of seats) if (seat > start) return seat;
    return seats[0];
  };
  const first = step(from);
  return skipOne ? step(first) : first;
}

/**
 * Timeout move: the lowest-value legal card (number cards before Wilds on ties,
 * hand order otherwise). A Wild keeps the active color. Draw if nothing is legal.
 * @param {readonly string[]} hand @param {string | null} topCard @param {string | null} activeColor
 * @returns {Move}
 */
export function autoMove(hand, topCard, activeColor) {
  const legal = legalCards(hand, topCard, activeColor);
  if (legal.length === 0) return { kind: "draw" };
  let best = legal[0];
  for (const card of legal) {
    const v = valueOf(card);
    const bv = valueOf(best);
    if (v < bv || (v === bv && best === "W" && card !== "W")) best = card;
  }
  const color = best === "W" ? activeColor ?? COLORS[0] : colorOf(best);
  return { kind: "play", card: best, color };
}
