/**
 * Arcade-wide rules shared by the site and the backend: the game list, the
 * site switch (off / scheduled / on) and how it reads at a given time, play IDs
 * and launch codes. Pure functions only; the server clock is passed in.
 */

export const ARCADE_GAMES = [
  { key: "olympus-slots", name: "Reels of Tartarus", order: 1 },
  { key: "wheel-of-the-fates", name: "Wheel of Doom", order: 2 },
  { key: "olympus-poker", name: "Hades' Hold'em", order: 3 },
  { key: "pvp-blackjack", name: "Olympus 21", order: 4 },
] as const;

export type ArcadeGameKey = (typeof ARCADE_GAMES)[number]["key"];

export function isArcadeGameKey(key: unknown): key is ArcadeGameKey {
  return typeof key === "string" && ARCADE_GAMES.some((game) => game.key === key);
}

/** What an admin stored. */
export type ArcadeMode = "off" | "scheduled" | "on";
export const ARCADE_MODES: readonly ArcadeMode[] = ["off", "scheduled", "on"];

export type ArcadeSettingsInput = {
  mode: ArcadeMode;
  /** Required for "scheduled". */
  opensAt?: number | null;
  /** Required for "scheduled"; optional end time for "on". */
  closesAt?: number | null;
};

/** What players see right now. */
export type ArcadeStatus = "off" | "scheduled" | "on";

export type ArcadeState = {
  status: ArcadeStatus;
  opensAt: number | null;
  closesAt: number | null;
  /** Next time the status changes by itself (clients re-query then), or null. */
  nextChangeAt: number | null;
};

/** Longest a schedule may run (a hackathon weekend). */
export const ARCADE_MAX_SCHEDULE_MS = 72 * 60 * 60 * 1000;

/**
 * Reads the stored switch at `now`. A schedule that has ended reads as "off",
 * and so does "on" past its end time, so nobody has to remember to switch off.
 */
export function arcadeStateAt(settings: ArcadeSettingsInput, now: number): ArcadeState {
  const opensAt = settings.opensAt ?? null;
  const closesAt = settings.closesAt ?? null;
  if (settings.mode === "on") {
    if (closesAt !== null && now >= closesAt) return { status: "off", opensAt: null, closesAt, nextChangeAt: null };
    return { status: "on", opensAt: null, closesAt, nextChangeAt: closesAt };
  }
  if (settings.mode === "scheduled" && opensAt !== null && closesAt !== null) {
    if (now < opensAt) return { status: "scheduled", opensAt, closesAt, nextChangeAt: opensAt };
    if (now < closesAt) return { status: "on", opensAt, closesAt, nextChangeAt: closesAt };
    return { status: "off", opensAt, closesAt, nextChangeAt: null };
  }
  return { status: "off", opensAt: null, closesAt: null, nextChangeAt: null };
}

export type ArcadeSettingsErrorCode =
  | "ARCADE_INVALID_MODE"
  | "ARCADE_INVALID_TIMES"
  | "ARCADE_SCHEDULE_TOO_LONG"
  | "ARCADE_UNKNOWN_GAME";

export const ARCADE_SETTINGS_ERROR_MESSAGES: Readonly<Record<ArcadeSettingsErrorCode, string>> = {
  ARCADE_INVALID_MODE: "The arcade switch must be off, scheduled or on.",
  ARCADE_INVALID_TIMES: "The arcade must close after it opens, and close in the future.",
  ARCADE_SCHEDULE_TOO_LONG: "An arcade schedule can be at most 72 hours long.",
  ARCADE_UNKNOWN_GAME: "That game doesn't exist.",
};

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/**
 * Checks an admin's switch change. Returns the normalized settings, or an
 * error code. Times only matter for "scheduled" (both) and "on" (optional end).
 */
export function checkArcadeSettings(
  input: ArcadeSettingsInput,
  now: number,
): { ok: true; value: { mode: ArcadeMode; opensAt?: number; closesAt?: number } } | { ok: false; code: ArcadeSettingsErrorCode } {
  if (!ARCADE_MODES.includes(input.mode)) return { ok: false, code: "ARCADE_INVALID_MODE" };
  const opensAt = input.opensAt ?? undefined;
  const closesAt = input.closesAt ?? undefined;
  if (input.mode === "off") return { ok: true, value: { mode: "off" } };
  if (input.mode === "on") {
    if (closesAt === undefined) return { ok: true, value: { mode: "on" } };
    if (!isTime(closesAt) || closesAt <= now) return { ok: false, code: "ARCADE_INVALID_TIMES" };
    if (closesAt - now > ARCADE_MAX_SCHEDULE_MS) return { ok: false, code: "ARCADE_SCHEDULE_TOO_LONG" };
    return { ok: true, value: { mode: "on", closesAt } };
  }
  if (!isTime(opensAt) || !isTime(closesAt) || closesAt <= opensAt || closesAt <= now) {
    return { ok: false, code: "ARCADE_INVALID_TIMES" };
  }
  if (closesAt - opensAt > ARCADE_MAX_SCHEDULE_MS) return { ok: false, code: "ARCADE_SCHEDULE_TOO_LONG" };
  return { ok: true, value: { mode: "scheduled", opensAt, closesAt } };
}

// ---- plays ----

/** Client idempotency keys (one per spin / hand). */
export const PLAY_ID_MAX_LENGTH = 64;
const PLAY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Trimmed play ID, or null when it is empty, too long or has odd characters. */
export function normalizePlayId(playId: unknown): string | null {
  if (typeof playId !== "string") return null;
  const key = playId.trim();
  if (!key || key.length > PLAY_ID_MAX_LENGTH || !PLAY_ID_PATTERN.test(key)) return null;
  return key;
}

/**
 * Why a player can't play right now. Games return these as values
 * (`{ status: "error", code }`) so they can show them in-game.
 */
export type ArcadePlayErrorCode =
  | "NOT_SIGNED_IN"
  | "NOT_PARTICIPANT"
  | "NOT_ELIGIBLE"
  | "NOT_CHECKED_IN"
  | "ARCADE_CLOSED"
  | "GAME_DISABLED"
  | "INVALID_PLAY_ID"
  | "INVALID_STAKE"
  | "INSUFFICIENT_POINTS"
  | "COOLDOWN";

// ---- launch codes (profile → arcade one-click sign-in) ----

export const LAUNCH_CODE_BYTES = 32;
export const LAUNCH_CODE_TTL_MS = 60_000;
/** Codes one account may create per window (stops a script from flooding the table). */
export const LAUNCH_CODE_RATE_LIMIT = { max: 5, windowMs: 60_000 } as const;
/** 32 bytes in base64url, no padding. */
export const LAUNCH_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isLaunchCodeShape(code: unknown): code is string {
  return typeof code === "string" && LAUNCH_CODE_PATTERN.test(code);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---- arcade wallet: deposit and withdraw (1 profile point = 1 arcade point) ----

/** Most points one deposit or withdrawal may move (a fat-finger guard). */
export const MAX_TRANSFER = 500;

export type TransferKind = "deposit" | "withdraw";

export type TransferErrorCode =
  | "NOT_SIGNED_IN"
  | "NOT_PARTICIPANT"
  | "NOT_ELIGIBLE"
  | "NOT_CHECKED_IN"
  | "ARCADE_CLOSED"
  | "INVALID_TRANSFER_ID"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_POINTS"
  | "INSUFFICIENT_ARCADE_POINTS";

const isWholeAmount = (amount: unknown): amount is number =>
  typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 1 && amount <= MAX_TRANSFER;

/** Moving `amount` profile points into the arcade: a whole number from 1 to MAX_TRANSFER, within the profile balance. */
export function checkDeposit(amount: unknown, profilePoints: number): TransferErrorCode | null {
  if (!isWholeAmount(amount)) return "INVALID_AMOUNT";
  if (amount > profilePoints) return "INSUFFICIENT_POINTS";
  return null;
}

/** Moving `amount` arcade points back to the profile: a whole number from 1 to MAX_TRANSFER, within the arcade balance. */
export function checkWithdraw(amount: unknown, arcadePoints: number): TransferErrorCode | null {
  if (!isWholeAmount(amount)) return "INVALID_AMOUNT";
  if (amount > arcadePoints) return "INSUFFICIENT_ARCADE_POINTS";
  return null;
}

/** The balances after a transfer (the confirmation modal shows these before the hacker confirms). */
export function balancesAfter(kind: TransferKind, amount: number, profilePoints: number, arcadePoints: number) {
  return kind === "deposit"
    ? { profile: profilePoints - amount, arcade: arcadePoints + amount }
    : { profile: profilePoints + amount, arcade: arcadePoints - amount };
}
