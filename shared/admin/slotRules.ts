/**
 * Points minigame (Olympus Slots) — pure game rules, outcome-first, 4 reels.
 *
 * TypeScript port of the prototype's `shared/minigame/slotRules.js`; the two
 * tables must stay identical (the prototype repo has a parity test). The server
 * is the only place a real spin is rolled.
 */

export type SlotOutcomeId = "big" | "win" | "push" | "lose";
export type SlotSymbol = "hera" | "apollo" | "athena" | "poseidon" | "hermes" | "aphrodite" | "odysseus" | "zeus";
export type SlotOutcome = {
  readonly id: SlotOutcomeId;
  readonly label: string;
  readonly weight: number;
  readonly multiplier: number;
};
/** Returns a number in [0, 1), like Math.random. */
export type RandomFn = () => number;

/** Odds table. Weights are out of SLOT_WEIGHT_TOTAL; multiplier is the gross payout (wager included). */
export const SLOT_OUTCOMES: readonly SlotOutcome[] = Object.freeze([
  Object.freeze({ id: "big", label: "Big win", weight: 5, multiplier: 5 }),
  Object.freeze({ id: "win", label: "Win", weight: 20, multiplier: 2 }),
  Object.freeze({ id: "push", label: "Money back", weight: 25, multiplier: 1 }),
  Object.freeze({ id: "lose", label: "No win", weight: 50, multiplier: 0 }),
] as const);

export const SLOT_WEIGHT_TOTAL = 100;
export const SLOT_WAGERS: readonly number[] = Object.freeze([5, 10, 25, 50]);
export const SLOT_DEFAULT_WAGER = 10;
export const SLOT_SPIN_COOLDOWN_MS = 2000;
export const SLOT_REEL_COUNT = 4;
export const SLOT_SYMBOLS: readonly SlotSymbol[] = Object.freeze([
  "hera", "apollo", "athena", "poseidon", "hermes", "aphrodite", "odysseus", "zeus",
] as const);
export const SLOT_JACKPOT_SYMBOL: SlotSymbol = "zeus";

const REGULAR_SYMBOLS: readonly SlotSymbol[] = Object.freeze(
  SLOT_SYMBOLS.filter((symbol) => symbol !== SLOT_JACKPOT_SYMBOL),
);

/** Integer in [0, max). Clamps a misbehaving RNG so it never indexes past the end. */
function randomInt(random: RandomFn, max: number): number {
  const value = Math.floor(random() * max);
  if (!Number.isFinite(value) || value < 0) return 0;
  return value >= max ? max - 1 : value;
}

function shuffle<T>(items: readonly T[], random: RandomFn): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(random, i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function pickDistinct<T>(pool: readonly T[], count: number, random: RandomFn): T[] {
  return shuffle(pool, random).slice(0, count);
}

/** Rolls one outcome from the odds table. */
export function rollOutcome(random: RandomFn = Math.random): SlotOutcome {
  let r = randomInt(random, SLOT_WEIGHT_TOTAL);
  for (const outcome of SLOT_OUTCOMES) {
    if (r < outcome.weight) return outcome;
    r -= outcome.weight;
  }
  return SLOT_OUTCOMES[SLOT_OUTCOMES.length - 1]!;
}

/**
 * Display symbols for an outcome (4 reels):
 *   big  = four jackpot symbols
 *   win  = three of one regular symbol + one different symbol
 *   push = two pairs of two different regular symbols
 *   lose = no win pattern: at most one pair, jackpot symbol at most once
 */
export function symbolsFor(outcomeId: SlotOutcomeId, random: RandomFn = Math.random): SlotSymbol[] {
  switch (outcomeId) {
    case "big":
      return Array.from({ length: SLOT_REEL_COUNT }, () => SLOT_JACKPOT_SYMBOL);
    case "win": {
      const [main] = pickDistinct(REGULAR_SYMBOLS, 1, random) as [SlotSymbol];
      const others = SLOT_SYMBOLS.filter((symbol) => symbol !== main);
      const odd = others[randomInt(random, others.length)]!;
      return shuffle([main, main, main, odd], random);
    }
    case "push": {
      const [a, b] = pickDistinct(REGULAR_SYMBOLS, 2, random) as [SlotSymbol, SlotSymbol];
      return shuffle([a, a, b, b], random);
    }
    case "lose": {
      const withPair = randomInt(random, 2) === 1;
      if (withPair) {
        const [pair] = pickDistinct(REGULAR_SYMBOLS, 1, random) as [SlotSymbol];
        const rest = pickDistinct(SLOT_SYMBOLS.filter((symbol) => symbol !== pair), 2, random);
        return shuffle([pair, pair, ...rest], random);
      }
      return pickDistinct(SLOT_SYMBOLS, SLOT_REEL_COUNT, random);
    }
    default:
      throw new Error(`Unknown slot outcome: ${String(outcomeId)}`);
  }
}

/** True when `wager` is one of the presets (balance is checked separately). */
export function isAllowedWager(wager: unknown): wager is number {
  return typeof wager === "number" && Number.isInteger(wager) && SLOT_WAGERS.includes(wager);
}

/** Gross payout (wager included) for a spin. */
export function payoutFor(wager: number, outcome: SlotOutcome): number {
  return wager * outcome.multiplier;
}

// Slot window management utilities

export type SlotWindowErrorCode =
  | "SLOT_WINDOW_NOT_FOUND"
  | "SLOT_WINDOW_OVERLAP"
  | "SLOT_WINDOW_CANCELLED"
  | "SLOT_WINDOW_PAST_START"
  | "SLOT_WINDOW_INVALID_TIME"
  | "SLOT_WINDOW_NOT_EDITABLE";

export class SlotWindowError extends Error {
  constructor(public code: SlotWindowErrorCode, message?: string) {
    super(message || code);
    this.name = "SlotWindowError";
  }
}

export function slotWindowError(code: SlotWindowErrorCode, message?: string): SlotWindowError {
  return new SlotWindowError(code, message);
}

export function assertSlotWindowTimes(opensAt: number, closesAt: number, now: number): void {
  if (!Number.isInteger(opensAt) || !Number.isInteger(closesAt)) {
    throw slotWindowError("SLOT_WINDOW_INVALID_TIME", "Window times must be integers");
  }
  if (opensAt < now) {
    throw slotWindowError("SLOT_WINDOW_PAST_START", "Window cannot start in the past");
  }
  if (closesAt <= opensAt) {
    throw slotWindowError("SLOT_WINDOW_INVALID_TIME", "Window must close after it opens");
  }
  const duration = closesAt - opensAt;
  const minDuration = 60 * 1000; // 1 minute
  const maxDuration = 7 * 24 * 60 * 60 * 1000; // 7 days
  if (duration < minDuration) {
    throw slotWindowError("SLOT_WINDOW_INVALID_TIME", "Window must be at least 1 minute long");
  }
  if (duration > maxDuration) {
    throw slotWindowError("SLOT_WINDOW_INVALID_TIME", "Window cannot be longer than 7 days");
  }
}

export function normalizeSlotWindowLabel(label?: string): string {
  if (!label) return "";
  const normalized = label.trim().slice(0, 100);
  return normalized;
}
