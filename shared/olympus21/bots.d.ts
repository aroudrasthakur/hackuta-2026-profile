/** Types for bots.js (byte-identical copy of shared/olympus21/bots.js). */
import type { Move, RandomFn } from "./rules.js";
export declare const BOT_WAGER_OPTIONS: readonly number[];
export declare function botWager(rng: RandomFn, p: { balance: number; lossRoom: number }): number | null;
export declare function botMove(
  hand: readonly string[],
  topCard: string | null,
  activeColor: string | null,
  count: number,
  rng: RandomFn,
): Move;
