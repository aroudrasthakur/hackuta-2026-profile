import { RANK_VALUE } from "./cards";
import { applyAction, legalActions, minRaiseTo, type PokerAction, type TableState } from "./engine";
import { evaluateBest, HAND_CATEGORY_RANK } from "./hand";

function preflopStrength(state: TableState, playerId: string): number {
  const seat = state.seats.find((row) => row.id === playerId);
  const hole = seat?.hole ?? [];
  if (hole.length < 2) return 0.2;
  const a = RANK_VALUE[hole[0]!.rank];
  const b = RANK_VALUE[hole[1]!.rank];
  const suited = hole[0]!.suit === hole[1]!.suit;
  if (a === b) return 0.55 + Math.min(a, 14) / 50;
  if (a >= 12 && b >= 12) return suited ? 0.58 : 0.5;
  if (Math.max(a, b) >= 13) return suited ? 0.42 : 0.34;
  if (suited && Math.abs(a - b) <= 2) return 0.36;
  return 0.2;
}

export function botStrength(state: TableState, playerId: string): number {
  const seat = state.seats.find((row) => row.id === playerId);
  if (!seat || seat.hole.length < 2) return 0.2;
  if (state.community.length >= 3) {
    const hand = evaluateBest([...seat.hole, ...state.community]);
    return 0.18 + HAND_CATEGORY_RANK[hand.category] / 9;
  }
  return preflopStrength(state, playerId);
}

export function chooseBotAction(state: TableState, playerId: string, random: () => number = Math.random): PokerAction {
  const legal = legalActions(state, playerId);
  if (legal.length === 0) return { type: "check" };
  const seat = state.seats.find((row) => row.id === playerId);
  if (!seat) return { type: "fold" };
  const strength = botStrength(state, playerId);
  const toCall = Math.max(0, state.currentBet - seat.streetBet);

  if (toCall === 0 && legal.includes("check") && strength < 0.7) return { type: "check" };
  if (toCall > 0 && strength < 0.3 && legal.includes("fold")) return { type: "fold" };
  if (strength > 0.78 && legal.includes("raise")) {
    const to = Math.min(seat.chips + seat.streetBet, minRaiseTo(state, seat) + (random() > 0.6 ? POKER_RAISE_STEP : 0));
    return { type: "raise", to };
  }
  if (strength > 0.88 && legal.includes("all_in") && random() > 0.5) return { type: "all_in" };
  if (legal.includes("call")) return { type: "call" };
  if (legal.includes("check")) return { type: "check" };
  if (legal.includes("all_in") && strength > 0.6) return { type: "all_in" };
  return legal.includes("fold") ? { type: "fold" } : { type: "check" };
}

const POKER_RAISE_STEP = 10;

export function playBotTurn(state: TableState, playerId: string, random?: () => number): TableState {
  return applyAction(state, playerId, chooseBotAction(state, playerId, random));
}
