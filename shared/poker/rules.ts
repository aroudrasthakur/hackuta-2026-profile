/** House rules for Olympus Poker. Shared by the table host and the UI. */

export const POKER_BUY_IN = 50;
/** Off-table stack a new arcade poker player starts with. */
export const POKER_STARTING_POINTS = 200;
export const POKER_SMALL_BLIND = 5;
export const POKER_BIG_BLIND = 10;
export const POKER_MIN_PLAYERS = 2;
export const POKER_MAX_PLAYERS = 4;
export const POKER_TARGET_PLAYERS = 4;

/** Start a table as soon as this many humans are waiting. */
export const POKER_INSTANT_SEATS = 4;
/** If at least two humans are waiting, seat them after this delay. */
export const POKER_QUEUE_FILL_MS = 2_500;
/** @deprecated Bots removed — only humans seat at tables. Kept so old deploys don't break imports. */
export const POKER_BOT_FILL_MS = 6_000;

/** Seconds a human has to act. Missing it stands them up and cashes out the stack. */
export const POKER_ACTION_TIMEOUT_MS = 15_000;
export const POKER_BOT_THINK_MIN_MS = 700;
export const POKER_BOT_THINK_MAX_MS = 1_500;
export const POKER_SHOWDOWN_PAUSE_MS = 3_200;
export const POKER_STREET_PAUSE_MS = 700;

export const POKER_BOT_NAMES = ["Shade of Athena", "Shade of Ares", "Shade of Hera", "Shade of Hermes"] as const;
