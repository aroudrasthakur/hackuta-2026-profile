/**
 * Who may play, and whether the arcade and a game are open. Every game
 * mutation calls `requireGameOpen` first; queries use `loadPlayer` and
 * `loadArcade` to show the same answer the mutation would give.
 *
 * The player always comes from the caller's Convex Auth session. No function
 * takes a participant or user id from the browser.
 */
import type { DocumentByName } from "convex/server";
import { getAuthUser } from "../lib/applications";
import { normalizeEmail } from "../lib/normalizeEmail";
import type { DataModel, MutationCtx, QueryCtx } from "../lib/dataModel";
import { checkedInForParticipant } from "../admin/checkedInLookup";
import { isParticipantEligible } from "../admin/pointsLedger";
import {
  ARCADE_GAMES,
  arcadeStateAt,
  type ArcadeGameKey,
  type ArcadePlayErrorCode,
  type ArcadeState,
} from "../../shared/arcade/rules";

type Ctx = QueryCtx | MutationCtx;
export type SettingsDoc = DocumentByName<DataModel, "arcadeSettings">;
export type GameDoc = DocumentByName<DataModel, "arcadeGames">;
export type CheckedInDoc = DocumentByName<DataModel, "checkedIn">;
export type ParticipantDoc = DocumentByName<DataModel, "participants">;
export type UserDoc = DocumentByName<DataModel, "users">;

/** Settings as read by everyone; a missing row is the safe default (off). */
export type ArcadeSettings = {
  mode: SettingsDoc["mode"];
  opensAt: number | null;
  closesAt: number | null;
  launchEnabled: boolean;
  backupSignIn: boolean;
  updatedAt: number | null;
};

export const DEFAULT_SETTINGS: ArcadeSettings = {
  mode: "off",
  opensAt: null,
  closesAt: null,
  launchEnabled: true,
  backupSignIn: false,
  updatedAt: null,
};

export async function settingsRow(ctx: Ctx) {
  return ctx.db
    .query("arcadeSettings")
    .withIndex("by_key", (q) => q.eq("key", "arcade"))
    .unique();
}

export async function loadSettings(ctx: Ctx): Promise<ArcadeSettings> {
  const row = await settingsRow(ctx);
  if (!row) return DEFAULT_SETTINGS;
  return {
    mode: row.mode,
    opensAt: row.opensAt ?? null,
    closesAt: row.closesAt ?? null,
    launchEnabled: row.launchEnabled,
    backupSignIn: row.backupSignIn,
    updatedAt: row.updatedAt,
  };
}

/** The site switch read at `now` (server clock). */
export async function loadArcade(ctx: Ctx, now: number): Promise<{ settings: ArcadeSettings; state: ArcadeState }> {
  const settings = await loadSettings(ctx);
  return { settings, state: arcadeStateAt(settings, now) };
}

export async function gameRow(ctx: Ctx, key: string) {
  return ctx.db
    .query("arcadeGames")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

/** Every known game with its switch, in lobby order. Games with no row are off. */
export async function loadGames(ctx: Ctx) {
  const rows = await ctx.db.query("arcadeGames").take(ARCADE_GAMES.length * 2);
  return ARCADE_GAMES.map((game) => {
    const row = rows.find((r) => r.key === game.key);
    return {
      key: game.key as ArcadeGameKey,
      name: row?.name ?? game.name,
      enabled: row?.enabled ?? false,
      order: row?.order ?? game.order,
    };
  }).sort((a, b) => a.order - b.order);
}

export type Player = {
  user: UserDoc | null;
  participant: ParticipantDoc | null;
  /** Review still "accepted" (a revoked acceptance stops play even after check-in). */
  eligible: boolean;
  checkedIn: CheckedInDoc | null;
};

/** The caller's account, participant, eligibility and check-in row. */
export async function loadPlayer(ctx: Ctx): Promise<Player> {
  const user = await getAuthUser(ctx);
  if (!user) return { user: null, participant: null, eligible: false, checkedIn: null };
  const participant = await ctx.db
    .query("participants")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", user._id))
    .unique();
  if (!participant) return { user, participant: null, eligible: false, checkedIn: null };
  const eligible = await isParticipantEligible(ctx, participant);
  const checkedIn = await checkedInForParticipant(ctx, participant._id);
  // A check-in row that belongs to another account would mean corrupt data; never play on it.
  const own = checkedIn && checkedIn.authUserId === user._id ? checkedIn : null;
  return { user, participant, eligible, checkedIn: own };
}

/** First reason this player can't play (identity only), or null. */
export type PlayerProblem = Extract<ArcadePlayErrorCode, "NOT_SIGNED_IN" | "NOT_PARTICIPANT" | "NOT_ELIGIBLE" | "NOT_CHECKED_IN">;

export function playerProblem(player: Player): PlayerProblem | null {
  if (!player.user) return "NOT_SIGNED_IN";
  if (!player.participant) return "NOT_PARTICIPANT";
  if (!player.eligible) return "NOT_ELIGIBLE";
  if (!player.checkedIn) return "NOT_CHECKED_IN";
  return null;
}

/** Arcade open by the server clock and this game switched on; else why not. */
export async function gameGate(ctx: Ctx, gameKey: ArcadeGameKey, now: number): Promise<{ code: ArcadePlayErrorCode | null; state: ArcadeState }> {
  const { state } = await loadArcade(ctx, now);
  if (state.status !== "on") return { code: "ARCADE_CLOSED", state };
  const game = await gameRow(ctx, gameKey);
  if (!game?.enabled) return { code: "GAME_DISABLED", state };
  return { code: null, state };
}

export type OpenGame = { ok: true; checkedIn: CheckedInDoc; player: Player; state: ArcadeState };
export type ClosedGame = { ok: false; code: ArcadePlayErrorCode };

/**
 * The check every game mutation runs, inside its own transaction: a
 * signed-in, accepted, checked-in hacker; the arcade open by the server clock;
 * and this game switched on. Because it runs in the mutation, an admin
 * switching off rejects every play that commits after the switch.
 * (Games with idempotent plays use `beginPlay` in points.ts, which wraps this.)
 */
export async function requireGameOpen(ctx: MutationCtx, gameKey: ArcadeGameKey, now: number): Promise<OpenGame | ClosedGame> {
  const player = await loadPlayer(ctx);
  const problem = playerProblem(player);
  if (problem) return { ok: false, code: problem };
  const { code, state } = await gameGate(ctx, gameKey, now);
  if (code) return { ok: false, code };
  return { ok: true, checkedIn: player.checkedIn!, player, state };
}

/** The hacker's name as the profile shows it: application name, else account name, else email. */
export async function playerDisplayName(ctx: Ctx, player: Player): Promise<string> {
  const application = player.participant ? await ctx.db.get(player.participant.applicationId) : null;
  const name = [application?.firstName?.trim(), application?.lastName?.trim()].filter(Boolean).join(" ");
  return name || player.user?.name?.trim() || normalizeEmail(player.user?.email) || "Hacker";
}
