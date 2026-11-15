/**
 * One-click hand-off from the profile portal to the arcade.
 *
 * Convex Auth sessions belong to one website, so the profile session does not
 * carry over. Profile calls `createLaunchCode` (signed in there) and opens
 * `<arcade>/launch#code=<code>`. The arcade calls
 * `signIn("arcade-launch", { code })`; the provider (launchProvider.ts) calls
 * `consumeLaunchCode`, and Convex Auth gives the arcade its own session for the
 * same user.
 *
 * Only the SHA-256 hash of a code is stored. A code works once, for 60 s.
 */
import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import { sha256Hex } from "../lib/sha256Hex";
import {
  LAUNCH_CODE_BYTES,
  LAUNCH_CODE_RATE_LIMIT,
  LAUNCH_CODE_TTL_MS,
  bytesToBase64Url,
  isLaunchCodeShape,
} from "../../shared/arcade/rules";
import { loadArcade, loadPlayer, playerProblem } from "./access";

/** Old codes of one account removed each time it makes a new one. */
const CLEANUP_BATCH = 20;

export type LaunchCodeErrorCode =
  | "NOT_SIGNED_IN"
  | "NOT_PARTICIPANT"
  | "NOT_ELIGIBLE"
  | "NOT_CHECKED_IN"
  | "LAUNCH_DISABLED"
  | "ARCADE_CLOSED"
  | "RATE_LIMITED";

/**
 * Called by profile when the hacker clicks Arcade. Only for a checked-in,
 * accepted hacker, while launch codes are on and the arcade is scheduled or
 * open (the lobby shows the countdown when scheduled).
 */
export const createLaunchCode = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const player = await loadPlayer(ctx);
    const problem = playerProblem(player);
    if (problem) return { status: "error" as const, code: problem as LaunchCodeErrorCode };
    const { settings, state } = await loadArcade(ctx, now);
    if (!settings.launchEnabled) return { status: "error" as const, code: "LAUNCH_DISABLED" as const };
    if (state.status === "off") return { status: "error" as const, code: "ARCADE_CLOSED" as const };

    const userId = player.user!._id;
    const recent = await ctx.db
      .query("arcadeLaunchCodes")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId).gt("createdAt", now - LAUNCH_CODE_RATE_LIMIT.windowMs))
      .take(LAUNCH_CODE_RATE_LIMIT.max);
    if (recent.length >= LAUNCH_CODE_RATE_LIMIT.max) {
      const retryAfterMs = Math.max(0, recent[0]!.createdAt + LAUNCH_CODE_RATE_LIMIT.windowMs - now);
      return { status: "error" as const, code: "RATE_LIMITED" as const, retryAfterMs };
    }

    // Expired or used codes of this account are no use to anyone; drop a batch.
    const old = await ctx.db
      .query("arcadeLaunchCodes")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId).lt("createdAt", now - LAUNCH_CODE_TTL_MS))
      .take(CLEANUP_BATCH);
    for (const row of old) await ctx.db.delete(row._id);

    const code = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(LAUNCH_CODE_BYTES)));
    const expiresAt = now + LAUNCH_CODE_TTL_MS;
    await ctx.db.insert("arcadeLaunchCodes", { codeHash: await sha256Hex(code), userId, expiresAt, createdAt: now });
    return { status: "ok" as const, code, expiresAt };
  },
});

/**
 * Used only by the `arcade-launch` provider. Returns the user id for a valid,
 * unused, unexpired code and marks it used in the same transaction, so two
 * tabs racing with one code can't both sign in. Null for anything else.
 */
export const consumeLaunchCode = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    if (!isLaunchCodeShape(code)) return null;
    const now = Date.now();
    const { settings } = await loadArcade(ctx, now);
    if (!settings.launchEnabled) return null;
    const codeHash = await sha256Hex(code);
    const row = await ctx.db
      .query("arcadeLaunchCodes")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", codeHash))
      .first();
    if (!row || row.usedAt !== undefined || now >= row.expiresAt) return null;
    await ctx.db.patch(row._id, { usedAt: now });
    // The account may have been removed in the 60 s since the code was made.
    const user = await ctx.db.get(row.userId);
    return user ? user._id : null;
  },
});
