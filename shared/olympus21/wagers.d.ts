/** Types for wagers.js (byte-identical copy of shared/olympus21/wagers.js). */
export type WagerInput = { seat: number; balance: number; lossRoom: number; pick: number | null };
export type Wager = { seat: number; wager: number; picked: boolean };
export type Pot = { amount: number; eligible: number[]; level: number };
export declare const MIN_WAGER: 10;
export declare function maxWagerFor(p: { balance: number; lossRoom: number }): number;
export declare function resolveWagers(players: readonly WagerInput[]): { wagers: Wager[]; sittingOut: number[] };
export declare function buildPots(wagers: readonly { seat: number; wager: number }[]): Pot[];
export declare function settlePots(
  wagers: readonly { seat: number; wager: number }[],
  winnerSeats: readonly number[],
): { payouts: Record<number, number>; deltas: Record<number, number> };
