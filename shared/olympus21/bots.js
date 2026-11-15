/**
 * Olympus 21: bot decisions. Pure functions; randomness is injected.
 */
import { COLORS, TARGET, colorOf, isNumberCard, legalCards, randomInt, valueOf } from "./rules.js";
import { MIN_WAGER, maxWagerFor } from "./wagers.js";

export const BOT_WAGER_OPTIONS = Object.freeze([10, 20, 25, 30, 50]);

/**
 * ~20% of the time the bot doesn't pick (gets the table average); otherwise one
 * of 10/20/25/30/50 that fits its range.
 * @param {() => number} rng
 * @param {{ balance: number, lossRoom: number }} p
 * @returns {number | null}
 */
export function botWager(rng, { balance, lossRoom }) {
  if (rng() < 0.2) return null;
  const max = maxWagerFor({ balance, lossRoom });
  if (max < MIN_WAGER) return null;
  const options = BOT_WAGER_OPTIONS.filter((amount) => amount <= max);
  return options[randomInt(rng, options.length)];
}

/**
 * The color the bot holds most of (ties: COLORS order); falls back to the active color.
 * @param {readonly string[]} hand @param {string | null} activeColor
 */
function favoriteColor(hand, activeColor) {
  let best = null;
  let bestCount = 0;
  for (const color of COLORS) {
    const n = hand.filter((card) => colorOf(card) === color).length;
    if (n > bestCount) {
      best = color;
      bestCount = n;
    }
  }
  return best ?? activeColor ?? COLORS[0];
}

/**
 * Wins with 21 if possible; else the highest number card that stays <= 20; else an
 * action card or Wild (adds 0); else (everything busts) the lowest number card.
 * Draws if nothing is legal.
 * @param {readonly string[]} hand @param {string | null} topCard @param {string | null} activeColor
 * @param {number} count @param {() => number} rng
 * @returns {{ kind: "play", card: string, color: string | null } | { kind: "draw" }}
 */
export function botMove(hand, topCard, activeColor, count, rng) {
  const legal = legalCards(hand, topCard, activeColor);
  if (legal.length === 0) return { kind: "draw" };
  const numbers = legal.filter(isNumberCard);
  const zeros = legal.filter((card) => !isNumberCard(card));
  let card = numbers.find((c) => count + valueOf(c) === TARGET);
  if (!card) {
    const safe = numbers.filter((c) => count + valueOf(c) < TARGET).sort((a, b) => valueOf(b) - valueOf(a));
    if (safe.length) card = safe[0];
  }
  if (!card && zeros.length) {
    const actions = zeros.filter((c) => c !== "W");
    const pool = actions.length ? actions : zeros;
    card = pool[randomInt(rng, pool.length)];
  }
  if (!card) card = numbers.slice().sort((a, b) => valueOf(a) - valueOf(b))[0];
  const rest = hand.filter((c, i) => i !== hand.indexOf(card));
  const color = card === "W" ? favoriteColor(rest, activeColor) : colorOf(card);
  return { kind: "play", card, color };
}
