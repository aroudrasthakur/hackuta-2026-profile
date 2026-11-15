import { RANK_VALUE, type Card } from "./cards";

export type HandCategory =
  | "high_card"
  | "pair"
  | "two_pair"
  | "three_of_a_kind"
  | "straight"
  | "flush"
  | "full_house"
  | "four_of_a_kind"
  | "straight_flush"
  | "royal_flush";

export const HAND_CATEGORY_RANK: Record<HandCategory, number> = {
  high_card: 0,
  pair: 1,
  two_pair: 2,
  three_of_a_kind: 3,
  straight: 4,
  flush: 5,
  full_house: 6,
  four_of_a_kind: 7,
  straight_flush: 8,
  royal_flush: 9,
};

export type EvaluatedHand = {
  category: HandCategory;
  /** Highest first. Used to break ties inside a category. */
  kickers: number[];
  label: string;
};

const CATEGORY_LABEL: Record<HandCategory, string> = {
  high_card: "High card",
  pair: "Pair",
  two_pair: "Two pair",
  three_of_a_kind: "Three of a kind",
  straight: "Straight",
  flush: "Flush",
  full_house: "Full house",
  four_of_a_kind: "Four of a kind",
  straight_flush: "Straight flush",
  royal_flush: "Royal flush",
};

function combinations<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const n = items.length;
  const choose = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i <= n - (k - acc.length); i += 1) {
      acc.push(items[i]!);
      choose(i + 1, acc);
      acc.pop();
    }
  };
  choose(0, []);
  return out;
}

function rankCounts(values: number[]): Array<[number, number]> {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
}

function straightHigh(values: number[]): number {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length !== 5) return 0;
  const wheel = unique[0] === 2 && unique[1] === 3 && unique[2] === 4 && unique[3] === 5 && unique.includes(14);
  if (wheel) return 5;
  if (unique[4]! - unique[0]! === 4) return unique[4]!;
  return 0;
}

export function evaluateFive(cards: readonly Card[]): EvaluatedHand {
  if (cards.length !== 5) throw new Error("evaluateFive needs 5 cards");
  const values = cards.map((card) => RANK_VALUE[card.rank]).sort((a, b) => b - a);
  const flush = cards.every((card) => card.suit === cards[0]!.suit);
  const straight = straightHigh(values);
  const counts = rankCounts(values);
  const quad = counts.find(([, n]) => n === 4);
  const trips = counts.find(([, n]) => n === 3);
  const pairs = counts.filter(([, n]) => n === 2);

  let category: HandCategory;
  let kickers: number[];

  if (flush && straight) {
    category = straight === 14 ? "royal_flush" : "straight_flush";
    kickers = [straight];
  } else if (quad) {
    category = "four_of_a_kind";
    kickers = [quad[0], ...values.filter((value) => value !== quad[0])];
  } else if (trips && pairs[0]) {
    category = "full_house";
    kickers = [trips[0], pairs[0][0]];
  } else if (flush) {
    category = "flush";
    kickers = values;
  } else if (straight) {
    category = "straight";
    kickers = [straight];
  } else if (trips) {
    category = "three_of_a_kind";
    kickers = [trips[0], ...values.filter((value) => value !== trips[0])];
  } else if (pairs.length >= 2) {
    category = "two_pair";
    const high = Math.max(pairs[0]![0], pairs[1]![0]);
    const low = Math.min(pairs[0]![0], pairs[1]![0]);
    kickers = [high, low, ...values.filter((value) => value !== high && value !== low)];
  } else if (pairs[0]) {
    category = "pair";
    kickers = [pairs[0][0], ...values.filter((value) => value !== pairs[0]![0])];
  } else {
    category = "high_card";
    kickers = values;
  }

  return { category, kickers, label: CATEGORY_LABEL[category] };
}

export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  const cat = HAND_CATEGORY_RANK[a.category] - HAND_CATEGORY_RANK[b.category];
  if (cat !== 0) return cat;
  const n = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < n; i += 1) {
    const diff = (a.kickers[i] ?? 0) - (b.kickers[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Best 5-card poker hand from 5–7 cards (Texas Hold'em). */
export function evaluateBest(cards: readonly Card[]): EvaluatedHand {
  if (cards.length < 5) throw new Error("evaluateBest needs at least 5 cards");
  if (cards.length === 5) return evaluateFive(cards);
  let best: EvaluatedHand | null = null;
  for (const five of combinations(cards, 5)) {
    const next = evaluateFive(five);
    if (!best || compareHands(next, best) > 0) best = next;
  }
  return best!;
}
