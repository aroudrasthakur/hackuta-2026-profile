import { type Card } from "./cards";
import { type EvaluatedHand } from "./hand";
import {
  callAmount,
  legalActions,
  minRaiseTo,
  type PokerAction,
  type TableState,
} from "./engine";

export type PublicSeat = {
  id: string;
  name: string;
  chips: number;
  folded: boolean;
  allIn: boolean;
  streetBet: number;
  isBot: boolean;
  isDealer: boolean;
  isToAct: boolean;
  hole: Card[] | null;
};

export type PublicTable = {
  id: string;
  street: TableState["street"];
  community: Card[];
  pot: number;
  currentBet: number;
  minRaise: number;
  log: string;
  handNumber: number;
  winners: Array<{ playerId: string; amount: number; hand?: EvaluatedHand }>;
  actionDeadlineAt: number | null;
  seats: PublicSeat[];
  you: {
    id: string;
    legal: PokerAction["type"][];
    callAmount: number;
    minRaiseTo: number;
    chips: number;
  } | null;
};

export function publicTable(state: TableState, viewerId: string | null): PublicTable {
  const reveal = state.street === "showdown";
  const youSeat = viewerId ? state.seats.find((seat) => seat.id === viewerId) : undefined;
  return {
    id: state.id,
    street: state.street,
    community: state.community.map((card) => ({ ...card })),
    pot: state.pot,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    log: state.log,
    handNumber: state.handNumber,
    actionDeadlineAt: state.actionDeadlineAt,
    winners: (state.winners ?? []).map((row) =>
      row.hand
        ? { playerId: row.playerId, amount: row.amount, hand: { ...row.hand, kickers: [...row.hand.kickers] } }
        : { playerId: row.playerId, amount: row.amount },
    ),
    seats: state.seats.map((seat, index) => ({
      id: seat.id,
      name: seat.name,
      chips: seat.chips,
      folded: seat.folded,
      allIn: seat.allIn,
      streetBet: seat.streetBet,
      isBot: seat.isBot,
      isDealer: index === state.dealerIndex,
      isToAct: state.toAct === index,
      hole:
        seat.hole.length > 0 && (seat.id === viewerId || (reveal && !seat.folded))
          ? seat.hole.map((card) => ({ ...card }))
          : seat.hole.length > 0
            ? null
            : [],
    })),
    you: youSeat
      ? {
          id: youSeat.id,
          legal: legalActions(state, youSeat.id),
          callAmount: callAmount(state, youSeat),
          minRaiseTo: minRaiseTo(state, youSeat),
          chips: youSeat.chips,
        }
      : null,
  };
}
