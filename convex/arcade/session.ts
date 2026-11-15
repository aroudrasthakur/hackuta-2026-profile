/**
 * Queries the arcade site and the profile's Arcade button subscribe to.
 *
 * Convex re-runs a query when the rows it read change (a spin, a shop
 * purchase, a volunteer award, an admin switch), so every open tab gets the
 * new balance and status by itself. Time passing is not a change: clients
 * pass `nowBucket` (any number that changes at `nextChangeAt`) to get a fresh
 * answer when a schedule opens or closes.
 */
import { v } from "convex/values";
import { query } from "../_generated/server";
import { normalizeEmail } from "../lib/normalizeEmail";
import { loadArcade, loadGames, loadPlayer, playerDisplayName, playerProblem } from "./access";
import { arcadeBalance } from "./wallet";

/**
 * Everything the arcade UI needs: the switch, the games, and the caller
 * (null when signed out). Works signed out so the closed and signed-out
 * screens know whether to offer the backup sign-in.
 */
export const getArcadeSession = query({
  args: { nowBucket: v.optional(v.number()) },
  handler: async (ctx) => {
    const now = Date.now();
    const { settings, state } = await loadArcade(ctx, now);
    const games = await loadGames(ctx);
    const player = await loadPlayer(ctx);
    return {
      serverNow: now,
      arcade: state,
      signIn: { launchEnabled: settings.launchEnabled, backupSignIn: settings.backupSignIn },
      games: games.map(({ key, name, enabled }) => ({ key, name, enabled })),
      player: player.user
        ? {
            displayName: await playerDisplayName(ctx, player),
            email: normalizeEmail(player.user.email) || null,
            /** First reason this account can't play, or null when it can (arcade and game switches aside). */
            problem: playerProblem(player),
            /** Profile balance (`checkedIn.points`). Null when not checked in. */
            points: player.checkedIn ? player.checkedIn.points : null,
            /** Arcade wallet: what the games bet from. Null when not checked in. */
            arcadePoints: player.checkedIn ? await arcadeBalance(ctx, player.checkedIn) : null,
          }
        : null,
    };
  },
});

/**
 * For profile's Arcade button: show it only to a checked-in, accepted hacker,
 * while launch codes are on and the arcade is scheduled or open. Hidden for
 * everyone else (and when signed out). If this query errors, profile hides it.
 */
export const getLauncherState = query({
  args: { nowBucket: v.optional(v.number()) },
  handler: async (ctx) => {
    const now = Date.now();
    const player = await loadPlayer(ctx);
    if (playerProblem(player)) return { visible: false as const };
    const { settings, state } = await loadArcade(ctx, now);
    if (!settings.launchEnabled || state.status === "off") return { visible: false as const };
    return { visible: true as const, status: state.status, opensAt: state.opensAt, closesAt: state.closesAt, nextChangeAt: state.nextChangeAt };
  },
});
