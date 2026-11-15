/**
 * Olympus 21 table functions already live on peccary. The original engine is
 * not in this repo; these keep the same public/internal names so a push never
 * deletes them. `getMyTable` still reads the stored JSON state. Mutations stay
 * idempotent on `actionId` and refuse new plays until the engine is overlaid.
 */
import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import { getAuthUser } from "../lib/applications";
import type { MutationCtx, QueryCtx } from "../lib/dataModel";
import { checkedInForParticipant } from "./checkedInLookup";

const ENGINE_UNAVAILABLE = "Olympus 21 engine source is not in arcade-site yet. Existing tables were not changed.";

type Seat = { id?: string; name?: string; bot?: boolean; hand?: unknown[]; [key: string]: unknown };
type EngineState = {
  seats?: Array<Seat | null>;
  drawPile?: unknown;
  [key: string]: unknown;
};

async function myCheckedIn(ctx: QueryCtx | MutationCtx) {
  const user = await getAuthUser(ctx);
  if (!user) return { user: null, checkedIn: null };
  const participant = await ctx.db
    .query("participants")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", user._id))
    .unique();
  if (!participant) return { user, checkedIn: null };
  const checkedIn = await checkedInForParticipant(ctx, participant._id);
  return { user, checkedIn };
}

function parseState(raw: string): EngineState | null {
  try {
    const parsed = JSON.parse(raw) as EngineState;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function publicState(state: EngineState, viewerId: string | null) {
  const seats = (state.seats ?? []).map((seat) => {
    if (!seat) return null;
    const mine = viewerId !== null && seat.id === viewerId;
    if (mine) return seat;
    return { ...seat, hand: Array.isArray(seat.hand) ? seat.hand.map(() => null) : [] };
  });
  return { ...state, seats, drawPile: Array.isArray(state.drawPile) ? state.drawPile.map(() => null) : [] };
}

async function tableForPlayer(ctx: QueryCtx | MutationCtx, checkedInId: string) {
  const tables = await ctx.db.query("o21Tables").collect();
  for (const table of tables) {
    if (table.status === "closed") continue;
    const state = parseState(table.state);
    if (!state) continue;
    if ((state.seats ?? []).some((seat) => seat?.id === checkedInId)) {
      return { table, state };
    }
  }
  for (const table of tables) {
    const state = parseState(table.state);
    if (!state) continue;
    if ((state.seats ?? []).some((seat) => seat?.id === checkedInId)) {
      return { table, state };
    }
  }
  return null;
}

export const getMyTable = query({
  args: { nowBucket: v.optional(v.number()) },
  handler: async (ctx) => {
    const { user, checkedIn } = await myCheckedIn(ctx);
    if (!user || !checkedIn) return null;
    const seated = await tableForPlayer(ctx, checkedIn._id);
    if (!seated) return { table: null, you: null, serverNow: Date.now() };
    return {
      table: {
        tableId: seated.table._id,
        windowId: seated.table.windowId,
        status: seated.table.status,
        state: publicState(seated.state, checkedIn._id),
        updatedAt: seated.table.updatedAt,
      },
      you: (seated.state.seats ?? []).find((seat) => seat?.id === checkedIn._id) ?? null,
      serverNow: Date.now(),
    };
  },
});

async function refusePlay(
  ctx: MutationCtx,
  args: { actionId: string; kind: string },
) {
  const { user, checkedIn } = await myCheckedIn(ctx);
  if (!user || !checkedIn) return { status: "error" as const, code: "NOT_SIGNED_IN" as const };
  const existing = await ctx.db
    .query("o21Actions")
    .withIndex("by_actionId", (q) => q.eq("actionId", args.actionId))
    .unique();
  if (existing) return { status: "ok" as const, duplicate: true };
  return { status: "error" as const, code: "ENGINE_UNAVAILABLE" as const, message: ENGINE_UNAVAILABLE };
}

export const join = mutation({
  args: { actionId: v.string(), bots: v.optional(v.any()), name: v.optional(v.string()) },
  handler: async (ctx, { actionId }) => refusePlay(ctx, { actionId, kind: "join" }),
});

export const leave = mutation({
  args: { actionId: v.string() },
  handler: async (ctx, { actionId }) => refusePlay(ctx, { actionId, kind: "leave" }),
});

export const placeWager = mutation({
  args: { actionId: v.string(), amount: v.number() },
  handler: async (ctx, { actionId }) => refusePlay(ctx, { actionId, kind: "wager" }),
});

export const play = mutation({
  args: { actionId: v.string(), card: v.string(), color: v.optional(v.string()) },
  handler: async (ctx, { actionId }) => refusePlay(ctx, { actionId, kind: "play" }),
});

export const draw = mutation({
  args: { actionId: v.string() },
  handler: async (ctx, { actionId }) => refusePlay(ctx, { actionId, kind: "draw" }),
});

export const ready = mutation({
  args: { actionId: v.string() },
  handler: async (ctx, { actionId }) => refusePlay(ctx, { actionId, kind: "ready" }),
});

export const tick = internalMutation({
  args: { tableId: v.id("o21Tables"), at: v.optional(v.number()) },
  handler: async () => ({ ok: true as const }),
});
