/** A standard 52-card French deck. No jokers. */

export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export type Card = { rank: Rank; suit: Suit };

export const RANK_VALUE: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export const SUIT_GLYPH: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

export const RED_SUITS: ReadonlySet<Suit> = new Set(["hearts", "diamonds"]);

export function cardId(card: Card): string {
  const rank = card.rank === "10" ? "T" : card.rank;
  return `${rank}${card.suit[0]!.toUpperCase()}`;
}

export function cardLabel(card: Card): string {
  return `${card.rank}${SUIT_GLYPH[card.suit]}`;
}

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  return deck;
}

export type RandomFn = () => number;

/** Fisher–Yates. Does not mutate the input. */
export function shuffle(deck: readonly Card[], random: RandomFn = Math.random): Card[] {
  const next = deck.map((card) => ({ ...card }));
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = next[i]!;
    next[i] = next[j]!;
    next[j] = a;
  }
  return next;
}

export function parseCard(id: string): Card | null {
  const match = /^(10|[2-9TJQKA])([SHDC])$/i.exec(id.trim());
  if (!match) return null;
  const rawRank = match[1]!.toUpperCase();
  const rank = (rawRank === "T" ? "10" : rawRank) as Rank;
  const suitMap: Record<string, Suit> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
  const suit = suitMap[match[2]!.toUpperCase()];
  if (!suit || !(rank in RANK_VALUE)) return null;
  return { rank, suit };
}
