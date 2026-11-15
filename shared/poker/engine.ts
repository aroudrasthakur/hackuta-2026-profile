import { makeDeck, shuffle, type Card, type RandomFn } from "./cards";
import { compareHands, evaluateBest, type EvaluatedHand } from "./hand";
import { POKER_BIG_BLIND, POKER_SMALL_BLIND } from "./rules";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export type PokerAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "raise"; to: number }
  | { type: "all_in" };

export type Seat = {
  id: string;
  name: string;
  chips: number;
  hole: Card[];
  folded: boolean;
  allIn: boolean;
  /** Chips committed on the current street. */
  streetBet: number;
  /** Chips committed this hand (all streets). */
  committed: number;
  actedThisStreet: boolean;
  isBot: boolean;
};

export type PotShare = {
  playerId: string;
  amount: number;
  hand?: EvaluatedHand;
};

export type TableState = {
  id: string;
  seats: Seat[];
  dealerIndex: number;
  street: Street;
  deck: Card[];
  community: Card[];
  pot: number;
  currentBet: number;
  minRaise: number;
  toAct: number | null;
  /** Epoch ms when the current human must act or be stood up. Null on bot turns / showdown. */
  actionDeadlineAt: number | null;
  winners: PotShare[] | null;
  handNumber: number;
  log: string;
};

export type LegalAction = PokerAction["type"] | "raise";

const STREETS: Street[] = ["preflop", "flop", "turn", "river", "showdown"];

function nextIndex(seats: Seat[], from: number, pred: (seat: Seat, index: number) => boolean): number | null {
  const n = seats.length;
  for (let step = 1; step <= n; step += 1) {
    const index = (from + step) % n;
    if (pred(seats[index]!, index)) return index;
  }
  return null;
}

function cloneCard(card: Card): Card {
  return { rank: card.rank, suit: card.suit };
}

function draw(state: TableState, n: number): Card[] {
  const cards = state.deck.splice(0, n);
  if (cards.length < n) throw new Error("deck exhausted");
  return cards;
}

function take(seat: Seat, amount: number): number {
  const paid = Math.min(amount, seat.chips);
  seat.chips -= paid;
  seat.streetBet += paid;
  seat.committed += paid;
  if (seat.chips === 0) seat.allIn = true;
  return paid;
}

function eligibleToAct(seat: Seat): boolean {
  return !seat.folded && !seat.allIn && seat.chips > 0;
}

function bettingClosed(state: TableState): boolean {
  const active = state.seats.filter(eligibleToAct);
  if (active.length === 0) return true;
  const needAct = active.filter((seat) => !seat.actedThisStreet || seat.streetBet < state.currentBet);
  return needAct.length === 0;
}

function onlyOneContested(state: TableState): Seat | null {
  const open = state.seats.filter((seat) => !seat.folded);
  return open.length === 1 ? open[0]! : null;
}

function firstToActPostflop(state: TableState): number | null {
  return nextIndex(state.seats, state.dealerIndex, (seat) => eligibleToAct(seat));
}

function firstToActPreflop(state: TableState): number | null {
  const n = state.seats.filter((seat) => seat.chips > 0 || seat.committed > 0).length;
  if (n === 2) return state.dealerIndex;
  const bb = (state.dealerIndex + 2) % state.seats.length;
  return nextIndex(state.seats, bb, (seat) => eligibleToAct(seat));
}

function advanceToAct(state: TableState): void {
  if (state.toAct === null) return;
  const next = nextIndex(state.seats, state.toAct, (seat) => eligibleToAct(seat) && (!seat.actedThisStreet || seat.streetBet < state.currentBet));
  state.toAct = next;
}

function awardUncontested(state: TableState, winner: Seat): void {
  winner.chips += state.pot;
  state.winners = [{ playerId: winner.id, amount: state.pot }];
  state.log = `${winner.name} takes ${state.pot} uncontested.`;
  state.pot = 0;
  state.street = "showdown";
  state.toAct = null;
}

function sidePots(seats: Seat[]): Array<{ amount: number; eligible: Seat[] }> {
  const levels = [...new Set(seats.map((seat) => seat.committed).filter((n) => n > 0))].sort((a, b) => a - b);
  const pots: Array<{ amount: number; eligible: Seat[] }> = [];
  let prev = 0;
  for (const level of levels) {
    const layer = level - prev;
    const inLayer = seats.filter((seat) => seat.committed >= level);
    const amount = layer * inLayer.length;
    const eligible = inLayer.filter((seat) => !seat.folded);
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  return pots;
}

function showdown(state: TableState): void {
  state.street = "showdown";
  state.toAct = null;
  const involved = state.seats.filter((seat) => !seat.folded && seat.committed > 0);
  const winners: PotShare[] = [];
  let leftover = 0;

  for (const pot of sidePots(state.seats)) {
    leftover += pot.amount;
    if (pot.eligible.length === 0) continue;
    const scored = pot.eligible.map((seat) => ({
      seat,
      hand: evaluateBest([...seat.hole, ...state.community]),
    }));
    scored.sort((a, b) => compareHands(b.hand, a.hand));
    const best = scored[0]!.hand;
    const tied = scored.filter((row) => compareHands(row.hand, best) === 0);
    const share = Math.floor(pot.amount / tied.length);
    const remainder = pot.amount - share * tied.length;
    tied.forEach((row, index) => {
      const amount = share + (index === 0 ? remainder : 0);
      row.seat.chips += amount;
      leftover -= amount;
      winners.push({ playerId: row.seat.id, amount, hand: row.hand });
    });
  }

  if (leftover > 0 && involved[0]) {
    involved[0].chips += leftover;
    winners.push({ playerId: involved[0].id, amount: leftover });
    leftover = 0;
  }

  state.pot = 0;
  state.winners = winners;
  if (winners.length === 1) {
    const seat = state.seats.find((row) => row.id === winners[0]!.playerId)!;
    const hand = winners[0]!.hand;
    state.log = `${seat.name} wins ${winners[0]!.amount} with ${hand?.label ?? "the pot"}.`;
  } else {
    state.log = "Pot split at showdown.";
  }
}

function dealCommunity(state: TableState, count: number): void {
  draw(state, 1);
  state.community.push(...draw(state, count));
}

function openStreet(state: TableState, street: Street): void {
  state.street = street;
  state.currentBet = 0;
  state.minRaise = POKER_BIG_BLIND;
  for (const seat of state.seats) {
    seat.streetBet = 0;
    seat.actedThisStreet = false;
  }
  if (street === "flop") dealCommunity(state, 3);
  if (street === "turn" || street === "river") dealCommunity(state, 1);
  if (street === "showdown") {
    showdown(state);
    return;
  }
  const stillBetting = state.seats.filter(eligibleToAct).length;
  if (stillBetting < 2) {
    runOut(state);
    return;
  }
  state.toAct = firstToActPostflop(state);
  const label = street === "flop" ? "Flop hits the felt." : street === "turn" ? "Turn card." : "River card.";
  state.log = label;
}

function runOut(state: TableState): void {
  while (state.community.length < 5) {
    const need = state.community.length === 0 ? 3 : 1;
    dealCommunity(state, need);
  }
  showdown(state);
}

function nextStreet(state: TableState): void {
  const index = STREETS.indexOf(state.street);
  const next = STREETS[index + 1];
  if (!next || next === "showdown") {
    if (state.community.length < 5) runOut(state);
    else showdown(state);
    return;
  }
  openStreet(state, next);
}

export function legalActions(state: TableState, playerId: string): PokerAction["type"][] {
  if (state.street === "showdown" || state.toAct === null) return [];
  const seat = state.seats[state.toAct];
  if (!seat || seat.id !== playerId) return [];
  const actions: PokerAction["type"][] = ["fold"];
  const toCall = state.currentBet - seat.streetBet;
  if (toCall <= 0) actions.push("check");
  else if (seat.chips > 0) actions.push("call");
  const minTo = state.currentBet + state.minRaise;
  if (seat.chips > toCall && seat.chips + seat.streetBet > state.currentBet) {
    if (seat.chips + seat.streetBet >= minTo || seat.chips > toCall) actions.push("raise");
  }
  if (seat.chips > 0) actions.push("all_in");
  return actions;
}

export function callAmount(state: TableState, seat: Seat): number {
  return Math.min(seat.chips, Math.max(0, state.currentBet - seat.streetBet));
}

export function minRaiseTo(state: TableState, seat: Seat): number {
  return Math.min(seat.chips + seat.streetBet, state.currentBet + state.minRaise);
}

export function startHand(seats: Seat[], dealerIndex: number, tableId: string, handNumber: number, random: RandomFn = Math.random): TableState {
  const active = seats.filter((seat) => seat.chips > 0);
  if (active.length < 2) throw new Error("need two players with chips");

  for (const seat of seats) {
    seat.hole = [];
    seat.folded = seat.chips === 0;
    seat.allIn = false;
    seat.streetBet = 0;
    seat.committed = 0;
    seat.actedThisStreet = false;
  }

  const withChips = seats.map((seat, index) => ({ seat, index })).filter((row) => row.seat.chips > 0);
  const dealerInActive = withChips.findIndex((row) => row.index === dealerIndex);
  const dealerPos = dealerInActive >= 0 ? dealerInActive : 0;
  const sbRow = withChips.length === 2 ? withChips[dealerPos]! : withChips[(dealerPos + 1) % withChips.length]!;
  const bbRow = withChips.length === 2 ? withChips[(dealerPos + 1) % withChips.length]! : withChips[(dealerPos + 2) % withChips.length]!;

  const state: TableState = {
    id: tableId,
    seats,
    dealerIndex,
    street: "preflop",
    deck: shuffle(makeDeck(), random),
    community: [],
    pot: 0,
    currentBet: POKER_BIG_BLIND,
    minRaise: POKER_BIG_BLIND,
    toAct: null,
    actionDeadlineAt: null,
    winners: null,
    handNumber,
    log: "The Fates shuffle the deck.",
  };

  state.pot += take(sbRow.seat, POKER_SMALL_BLIND);
  state.pot += take(bbRow.seat, POKER_BIG_BLIND);
  bbRow.seat.actedThisStreet = false;
  sbRow.seat.actedThisStreet = false;

  for (const row of withChips) {
    row.seat.hole = draw(state, 2);
  }

  state.toAct = firstToActPreflop(state);
  state.log = `${sbRow.seat.name} posts ${POKER_SMALL_BLIND}, ${bbRow.seat.name} posts ${POKER_BIG_BLIND}.`;
  return state;
}

export function applyAction(state: TableState, playerId: string, action: PokerAction): TableState {
  if (state.street === "showdown" || state.toAct === null) return state;
  const seat = state.seats[state.toAct];
  if (!seat || seat.id !== playerId) return state;

  const toCall = Math.max(0, state.currentBet - seat.streetBet);

  if (action.type === "fold") {
    seat.folded = true;
    seat.actedThisStreet = true;
    state.log = `${seat.name} folds.`;
  } else if (action.type === "check") {
    if (toCall > 0) return state;
    seat.actedThisStreet = true;
    state.log = `${seat.name} checks.`;
  } else if (action.type === "call") {
    const paid = take(seat, toCall);
    state.pot += paid;
    seat.actedThisStreet = true;
    state.log = seat.allIn ? `${seat.name} calls all-in.` : `${seat.name} calls ${paid}.`;
  } else if (action.type === "raise") {
    const target = action.to;
    if (target <= state.currentBet) return state;
    const need = target - seat.streetBet;
    if (need <= 0 || need > seat.chips) return state;
    const raiseBy = target - state.currentBet;
    if (raiseBy < state.minRaise && target < seat.chips + seat.streetBet) return state;
    const paid = take(seat, need);
    state.pot += paid;
    const newBet = seat.streetBet;
    if (newBet > state.currentBet) {
      state.minRaise = Math.max(state.minRaise, newBet - state.currentBet);
      state.currentBet = newBet;
      for (const other of state.seats) {
        if (other.id !== seat.id && eligibleToAct(other)) other.actedThisStreet = false;
      }
    }
    seat.actedThisStreet = true;
    state.log = seat.allIn ? `${seat.name} shoves ${newBet}.` : `${seat.name} raises to ${newBet}.`;
  } else if (action.type === "all_in") {
    const paid = take(seat, seat.chips);
    state.pot += paid;
    if (seat.streetBet > state.currentBet) {
      state.minRaise = Math.max(state.minRaise, seat.streetBet - state.currentBet);
      state.currentBet = seat.streetBet;
      for (const other of state.seats) {
        if (other.id !== seat.id && eligibleToAct(other)) other.actedThisStreet = false;
      }
    }
    seat.actedThisStreet = true;
    state.log = `${seat.name} is all-in.`;
  }

  const lone = onlyOneContested(state);
  if (lone) {
    awardUncontested(state, lone);
    return state;
  }

  if (bettingClosed(state)) {
    nextStreet(state);
    return state;
  }

  advanceToAct(state);
  return state;
}

export function rotateDealer(seats: Seat[], dealerIndex: number): number {
  const next = nextIndex(seats, dealerIndex, (seat) => seat.chips > 0);
  return next ?? dealerIndex;
}

export function cloneTable(state: TableState): TableState {
  return {
    ...state,
    deck: state.deck.map(cloneCard),
    community: state.community.map(cloneCard),
    winners: state.winners
      ? state.winners.map((row) =>
          row.hand
            ? { ...row, hand: { ...row.hand, kickers: [...row.hand.kickers] } }
            : { playerId: row.playerId, amount: row.amount },
        )
      : null,
    seats: state.seats.map((seat) => ({
      ...seat,
      hole: seat.hole.map(cloneCard),
    })),
  };
}

