/**
 * Olympus Slots play windows. Already deployed on peccary — keep these names so a
 * push never deletes them.
 */
import type { DocumentByName } from "convex/server";
import { v, type GenericId } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { DataModel, MutationCtx } from "../lib/dataModel";
import {
  assertSlotWindowTimes,
  normalizeSlotWindowLabel,
  slotWindowError,
} from "../../shared/admin/slotRules";
import { requireAdminRole, sessionTokenArgs } from "./staffAuth";

const MAX_WINDOWS = 200;

type WindowDoc = DocumentByName<DataModel, "slotWindows">;
type WindowId = GenericId<"slotWindows">;
type AdminId = GenericId<"admins">;
type WindowStatus = "scheduled" | "live" | "ended" | "cancelled";

function windowStatus(window: Pick<WindowDoc, "opensAt" | "closesAt" | "cancelledAt">, now: number): WindowStatus {
  if (window.cancelledAt !== undefined) return "cancelled";
  if (now < window.opensAt) return "scheduled";
  if (now < window.closesAt) return "live";
  return "ended";
}

async function hasOverlappingWindow(ctx: MutationCtx, opensAt: number, closesAt: number, ignoreId?: WindowId) {
  const candidates = await ctx.db
    .query("slotWindows")
    .withIndex("by_closesAt", (q) => q.gt("closesAt", opensAt))
    .take(MAX_WINDOWS);
  return candidates.some((w) => w._id !== ignoreId && w.cancelledAt === undefined && w.opensAt < closesAt);
}

type WindowInput = { opensAt: number; closesAt: number; label?: string };

async function validateWindow(ctx: MutationCtx, input: WindowInput, now: number, ignoreId?: WindowId) {
  assertSlotWindowTimes(input.opensAt, input.closesAt, now);
  const label = normalizeSlotWindowLabel(input.label);
  if (await hasOverlappingWindow(ctx, input.opensAt, input.closesAt, ignoreId)) {
    throw slotWindowError("SLOT_WINDOW_OVERLAP");
  }
  return { opensAt: input.opensAt, closesAt: input.closesAt, label };
}

async function insertWindow(ctx: MutationCtx, input: WindowInput, createdBy: AdminId | undefined) {
  const now = Date.now();
  const validated = await validateWindow(ctx, input, now);
  const windowId = await ctx.db.insert("slotWindows", {
    ...validated,
    createdBy,
    createdAt: now,
  });
  return windowId;
}

export const listSlotWindows = query({
  args: sessionTokenArgs,
  handler: async (ctx, args) => {
    await requireAdminRole(ctx, args.sessionToken);
    const now = Date.now();
    const windows = await ctx.db.query("slotWindows").order("desc").take(MAX_WINDOWS);
    return windows.map((w) => ({
      _id: w._id,
      label: w.label,
      opensAt: w.opensAt,
      closesAt: w.closesAt,
      status: windowStatus(w, now),
      createdAt: w.createdAt,
      cancelledAt: w.cancelledAt,
    }));
  },
});

export const createSlotWindow = mutation({
  args: {
    ...sessionTokenArgs,
    opensAt: v.number(),
    closesAt: v.number(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdminRole(ctx, args.sessionToken);
    return await insertWindow(ctx, args, admin._id);
  },
});

export const createSlotWindowInternal = internalMutation({
  args: {
    opensAt: v.number(),
    closesAt: v.number(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await insertWindow(ctx, args, undefined);
  },
});

export const updateSlotWindow = mutation({
  args: {
    ...sessionTokenArgs,
    windowId: v.id("slotWindows"),
    opensAt: v.number(),
    closesAt: v.number(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdminRole(ctx, args.sessionToken);
    const window = await ctx.db.get(args.windowId);
    if (!window) throw slotWindowError("SLOT_WINDOW_NOT_FOUND");
    if (window.cancelledAt !== undefined) throw slotWindowError("SLOT_WINDOW_CANCELLED");
    const now = Date.now();
    const validated = await validateWindow(ctx, args, now, args.windowId);
    await ctx.db.patch(args.windowId, validated);
  },
});

export const cancelSlotWindow = mutation({
  args: {
    ...sessionTokenArgs,
    windowId: v.id("slotWindows"),
  },
  handler: async (ctx, args) => {
    await requireAdminRole(ctx, args.sessionToken);
    const window = await ctx.db.get(args.windowId);
    if (!window) throw slotWindowError("SLOT_WINDOW_NOT_FOUND");
    if (window.cancelledAt !== undefined) return;
    await ctx.db.patch(args.windowId, { cancelledAt: Date.now() });
  },
});

export const cancelSlotWindowInternal = internalMutation({
  args: {
    windowId: v.id("slotWindows"),
  },
  handler: async (ctx, args) => {
    const window = await ctx.db.get(args.windowId);
    if (!window) throw slotWindowError("SLOT_WINDOW_NOT_FOUND");
    if (window.cancelledAt !== undefined) return;
    await ctx.db.patch(args.windowId, { cancelledAt: Date.now() });
  },
});
