/** Types for engine.js (byte-identical copy of shared/olympus21/engine.js). See shared/olympus21/CONTRACT.md. */
import type { RandomFn } from "./rules.js";
import type { Pot, Wager } from "./wagers.js";

export type Timings = {
  seatLockMs: number;
  wagerMs: number;
  countdownMs: number;
  turnMs: number;
  resultMs: number;
  botThinkMs: readonly number[];
};
export type TableStatus = "waiting" | "wagering" | "countdown" | "turns" | "settled" | "closed";
export type PlayerState = "waiting" | "playing" | "bust" | "won" | "folded" | "sitting_out";
export type ResultReason = "21" | "last" | "cap" | "closed";

export type Player = {
  id: string;
  name: string;
  bot: boolean;
  balance: number;
  lostThisWindow: number;
  seat: number;
  state: PlayerState;
  pick: number | null;
  picked: boolean;
  wager: number | null;
  hand: string[];
  timeouts: number;
  pointsDelta: number | null;
  history: { roundNo: number; delta: number; reason: string }[];
  botAt: number | null;
  botDone: boolean;
  gone: boolean;
  kick: boolean;
  ready: boolean;
  inRound: boolean;
  readyAt: number | null;
};

export type MoveLog = {
  seq: number;
  seat: number;
  name: string;
  kind: string;
  card?: string;
  count?: number;
  color?: string;
  text: string;
};

export type RoundResult = { reason: ResultReason; winners: number[]; deltas: Record<number, number> };

export type Table = {
  id: string;
  maxSeats: number;
  timings: Timings;
  lossCap: number;
  status: TableStatus;
  roundNo: number;
  now: number;
  deadline: number | null;
  seats: (Player | null)[];
  drawPile: string[];
  playPile: string[];
  count: number;
  activeColor: string | null;
  direction: 1 | -1;
  turnSeat: number | null;
  plays: number;
  roundWagers: Wager[];
  pots: Pot[];
  result: RoundResult | null;
  moves: MoveLog[];
  seq: number;
  createdAt: number;
  paused: boolean;
  rng: RandomFn;
};

export type SeatView = {
  seat: number;
  playerId: string;
  name: string;
  bot: boolean;
  isMe: boolean;
  wager: number | null;
  picked: boolean;
  cardCount: number;
  state: PlayerState;
  pointsDelta: number | null;
  timeouts: number;
  ready: boolean;
};

export type MeView = {
  playerId: string;
  seat: number;
  balance: number;
  lostThisWindow: number;
  lossCap: number;
  maxWager: number;
  wager: number | null;
  picked: boolean;
  ready: boolean;
  myTurn: boolean;
  canDraw: boolean;
  hand: { card: string; playable: boolean; after: number | "win" | "bust" | null }[];
  history: { roundNo: number; delta: number; reason: string }[];
};

export type TableView = {
  tableId: string;
  tableKey: string;
  status: TableStatus;
  roundNo: number;
  now: number;
  deadline: number | null;
  count: number;
  target: 21;
  topCard: string | null;
  activeColor: string | null;
  direction: 1 | -1;
  drawLeft: number;
  pot: number;
  pots: Pot[];
  turnSeat: number | null;
  minWager: number;
  maxSeats: number;
  seats: SeatView[];
  lastMoves: MoveLog[];
  result: RoundResult | null;
  me: MeView | null;
};

export type CommandResult = { ok: true; code?: undefined } | { ok: false; code: string };

export declare const DEFAULT_TIMINGS: Readonly<Timings>;
export declare const HAND_SIZE: 5;
export declare const PLAY_CAP: 60;
export declare const DEFAULT_LOSS_CAP: 100;
export declare const MAX_TIMEOUTS: 3;

export declare function createTable(options?: {
  id?: string;
  maxSeats?: number;
  timings?: Partial<Timings>;
  rng?: RandomFn;
  now?: number;
  lossCap?: number;
}): Table;
export declare function join(table: Table, info: { id: string; name?: string; balance?: number; bot?: boolean }, now: number): CommandResult;
export declare function ready(table: Table, playerId: string, now: number): CommandResult;
export declare function leave(table: Table, playerId: string, now: number): CommandResult;
export declare function placeWager(table: Table, playerId: string, amount: number, now: number): CommandResult;
export declare function play(table: Table, playerId: string, card: string, color: string | null | undefined, now: number): CommandResult;
export declare function draw(table: Table, playerId: string, now: number): CommandResult;
export declare function tick(table: Table, now: number): boolean;
export declare function closeTable(table: Table, now: number): CommandResult;
export declare function viewFor(table: Table, playerId: string | null, now?: number): TableView;
export declare function addListener(table: Table, fn: () => void): () => void;
export declare function cardTotal(table: Table): number;
export declare function isCard(card: unknown): boolean;
export declare function nextWakeAt(table: Table): number | null;
export declare function exportState(table: Table): Record<string, unknown>;
export declare function importState(json: string | Record<string, unknown>, options?: { rng?: RandomFn }): Table;
