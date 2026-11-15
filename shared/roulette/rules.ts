/**
 * Wheel of the Fates (roulette): pure game rules, one copy for the site and the
 * server. The server is the only place a real spin is decided; the site uses
 * these rules to check bets before sending them and to explain limits.
 *
 * Single-zero wheel, pockets 0–36. Every bet returns 36/37 of its stake on
 * average (2.7% house edge), which tests/unit/roulette.test.ts checks for
 * every bet in the catalogue.
 *
 * Bets are referred to by fixed IDs from BET_CATALOGUE ("straight:17",
 * "split:17-20", "fire"…). The server accepts only those IDs, so a made-up bet
 * (a "split" of 3 and 30) can't exist.
 */

export type RandomFn = () => number;
export type PocketColor = "olympus" | "fire" | "night";
export type BetKind = "straight" | "split" | "street" | "corner" | "dozen" | "column" | "even";

export type BetDef = {
  readonly id: string;
  readonly kind: BetKind;
  /** Pockets this bet wins on, ascending. */
  readonly numbers: readonly number[];
  /** Winnings per point staked ("35" means 35:1; the stake comes back too). */
  readonly odds: number;
  /** Short name for screens and screen readers. */
  readonly label: string;
};

export type PlacedBet = { betId: string; amount: number };

export type RouletteLimits = {
  readonly chips: readonly number[];
  /** Total of all bets on one spin. */
  readonly maxStakePerSpin: number;
  /** Largest straight-up bet on a single number. */
  readonly maxStraightStake: number;
  /** Most any single pocket may return for the whole set of bets (stakes included). */
  readonly maxPayoutPerSpin: number;
  readonly maxBetsPerSpin: number;
  readonly cooldownMs: number;
  /** A spin is refused when today's net loss plus its stake could pass this. 0 turns it off. */
  readonly dailyLossLimit: number;
};

/** "Standard" preset from docs/ROULETTE_IDEAS.md. Admins can change these later. */
export const ROULETTE_LIMITS: RouletteLimits = Object.freeze({
  chips: Object.freeze([5, 10, 25]),
  maxStakePerSpin: 50,
  maxStraightStake: 10,
  maxPayoutPerSpin: 500,
  maxBetsPerSpin: 20,
  cooldownMs: 3000,
  dailyLossLimit: 300,
});

export const POCKET_COUNT = 37;

/** Pocket order around a single-zero wheel, clockwise from the zero. */
export const WHEEL_ORDER: readonly number[] = Object.freeze([
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7,
  28, 12, 35, 3, 26,
]);

/** The red numbers of a standard wheel; here they are the Fire pockets. */
export const FIRE_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export function pocketColor(pocket: number): PocketColor {
  if (pocket === 0) return "olympus";
  return FIRE_NUMBERS.has(pocket) ? "fire" : "night";
}

export const COLOR_NAMES: Readonly<Record<PocketColor, string>> = Object.freeze({
  olympus: "Olympus",
  fire: "Fire",
  night: "Night",
});

const range = (from: number, to: number, step = 1) => {
  const out: number[] = [];
  for (let n = from; n <= to; n += step) out.push(n);
  return out;
};

/** Payout odds for a bet covering `count` pockets: 36/count − 1 (35, 17, 11, 8, 2, 1). */
export function oddsFor(count: number): number {
  return 36 / count - 1;
}

function buildCatalogue(): ReadonlyMap<string, BetDef> {
  const defs: BetDef[] = [];
  const add = (id: string, kind: BetKind, numbers: number[], label: string) =>
    defs.push(Object.freeze({ id, kind, numbers: Object.freeze([...numbers].sort((a, b) => a - b)), odds: oddsFor(numbers.length), label }));

  for (let n = 0; n <= 36; n++) add(`straight:${n}`, "straight", [n], `${n === 0 ? "0 Olympus" : n}`);

  // Splits: side by side in a row of the table (n, n+3), one above the other (n, n+1),
  // and the zero with each of 1, 2 and 3.
  for (let n = 1; n <= 33; n++) add(`split:${n}-${n + 3}`, "split", [n, n + 3], `Split ${n} and ${n + 3}`);
  for (let n = 1; n <= 35; n++) if (n % 3 !== 0) add(`split:${n}-${n + 1}`, "split", [n, n + 1], `Split ${n} and ${n + 1}`);
  for (const n of [1, 2, 3]) add(`split:0-${n}`, "split", [0, n], `Split 0 and ${n}`);

  for (let n = 1; n <= 34; n += 3) add(`street:${n}`, "street", [n, n + 1, n + 2], `Street ${n} to ${n + 2}`);
  for (let n = 1; n <= 32; n++) {
    if (n % 3 !== 0) add(`corner:${n}`, "corner", [n, n + 1, n + 3, n + 4], `Corner ${n}, ${n + 1}, ${n + 3}, ${n + 4}`);
  }

  add("dozen:1", "dozen", range(1, 12), "1st dozen, 1 to 12");
  add("dozen:2", "dozen", range(13, 24), "2nd dozen, 13 to 24");
  add("dozen:3", "dozen", range(25, 36), "3rd dozen, 25 to 36");
  add("column:1", "column", range(1, 34, 3), "Column 1");
  add("column:2", "column", range(2, 35, 3), "Column 2");
  add("column:3", "column", range(3, 36, 3), "Column 3");

  const numbers = range(1, 36);
  add("low", "even", range(1, 18), "Low, 1 to 18");
  add("high", "even", range(19, 36), "High, 19 to 36");
  add("odd", "even", numbers.filter((n) => n % 2 === 1), "Odd");
  add("even", "even", numbers.filter((n) => n % 2 === 0), "Even");
  add("fire", "even", numbers.filter((n) => FIRE_NUMBERS.has(n)), "Fire");
  add("night", "even", numbers.filter((n) => !FIRE_NUMBERS.has(n)), "Night");

  return new Map(defs.map((def) => [def.id, def]));
}

export const BET_CATALOGUE: ReadonlyMap<string, BetDef> = buildCatalogue();

/** Merge repeated bet IDs and drop empty ones, keeping first-seen order. */
export function mergeBets(bets: readonly PlacedBet[]): PlacedBet[] {
  const totals = new Map<string, number>();
  for (const bet of bets) totals.set(bet.betId, (totals.get(bet.betId) ?? 0) + bet.amount);
  return [...totals].filter(([, amount]) => amount !== 0).map(([betId, amount]) => ({ betId, amount }));
}

export function totalStake(bets: readonly PlacedBet[]): number {
  return bets.reduce((sum, bet) => sum + bet.amount, 0);
}

/** What the bets return if the ball lands on `pocket`: each winning stake plus its winnings. */
export function returnFor(bets: readonly PlacedBet[], pocket: number): number {
  let total = 0;
  for (const bet of bets) {
    const def = BET_CATALOGUE.get(bet.betId);
    if (def && def.numbers.includes(pocket)) total += bet.amount * (def.odds + 1);
  }
  return total;
}

/** The most any single pocket would return for these bets. */
export function bestReturn(bets: readonly PlacedBet[]): number {
  let best = 0;
  for (let pocket = 0; pocket < POCKET_COUNT; pocket++) best = Math.max(best, returnFor(bets, pocket));
  return best;
}

export function winningBetIds(bets: readonly PlacedBet[], pocket: number): string[] {
  return bets.filter((bet) => BET_CATALOGUE.get(bet.betId)?.numbers.includes(pocket)).map((bet) => bet.betId);
}

export type BetErrorCode =
  | "EMPTY"
  | "TOO_MANY_BETS"
  | "UNKNOWN_BET"
  | "BAD_AMOUNT"
  | "STRAIGHT_LIMIT"
  | "STAKE_LIMIT"
  | "PAYOUT_LIMIT"
  | "INSUFFICIENT_POINTS"
  | "DAILY_LOSS_LIMIT";

export type BetCheck =
  | { ok: true; bets: PlacedBet[]; stake: number; bestReturn: number }
  | { ok: false; code: BetErrorCode };

/**
 * Check a set of bets against the rules and the player's state. The server
 * runs this on every spin; the site runs it on every chip placed.
 * `lossToday` is today's net loss (0 when the player is up).
 */
export function checkBets(
  input: readonly PlacedBet[],
  player: { balance: number; lossToday: number },
  limits: RouletteLimits = ROULETTE_LIMITS,
): BetCheck {
  const minChip = Math.min(...limits.chips);
  for (const bet of input) {
    if (!BET_CATALOGUE.has(bet.betId)) return { ok: false, code: "UNKNOWN_BET" };
    if (!Number.isSafeInteger(bet.amount) || bet.amount <= 0 || bet.amount % minChip !== 0) return { ok: false, code: "BAD_AMOUNT" };
  }
  const bets = mergeBets(input);
  if (bets.length === 0) return { ok: false, code: "EMPTY" };
  if (bets.length > limits.maxBetsPerSpin) return { ok: false, code: "TOO_MANY_BETS" };

  for (const bet of bets) {
    if (BET_CATALOGUE.get(bet.betId)!.kind === "straight" && bet.amount > limits.maxStraightStake) {
      return { ok: false, code: "STRAIGHT_LIMIT" };
    }
  }
  const stake = totalStake(bets);
  if (stake > limits.maxStakePerSpin) return { ok: false, code: "STAKE_LIMIT" };
  const best = bestReturn(bets);
  if (best > limits.maxPayoutPerSpin) return { ok: false, code: "PAYOUT_LIMIT" };
  if (stake > player.balance) return { ok: false, code: "INSUFFICIENT_POINTS" };
  if (limits.dailyLossLimit > 0 && Math.max(0, player.lossToday) + stake > limits.dailyLossLimit) {
    return { ok: false, code: "DAILY_LOSS_LIMIT" };
  }
  return { ok: true, bets, stake, bestReturn: best };
}

/** Pick the pocket. Server-side only for real spins. */
export function spinPocket(random: RandomFn): number {
  const value = random();
  const pocket = Math.floor((Number.isFinite(value) ? value : 0) * POCKET_COUNT);
  return Math.min(POCKET_COUNT - 1, Math.max(0, pocket));
}

/** HackUTA is in Arlington, Texas; the daily loss limit resets at local midnight there. */
export const EVENT_TIME_ZONE = "America/Chicago";

/** The event-local calendar day ("2026-11-14") a time falls on, for the daily loss limit. */
export function dayKey(at: number): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: EVENT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    // Runtimes without time-zone data: fall back to a fixed UTC−6 offset.
    return new Date(at - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}
