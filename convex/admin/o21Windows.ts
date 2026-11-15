/**
 * Olympus 21 play windows. Already deployed on peccary — keep these names so a
 * push never deletes them. Same rules as slot windows.
 */
import type { DocumentByName } from "convex/server";
import { v, type GenericId } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { DataModel, MutationCtx, QueryCtx } from "../lib/dataModel";
import {
  assertSlotWindowTimes,
  normalizeSlotWindowLabel,
  slotWindowError,
} from "../../shared/admin/slotRules";
import { requireAdminRole, sessionTokenArgs } from "./staffAuth";

const MAX_WINDOWS = 200;

type WindowDoc = DocumentByName<DataModel, "o21Windows">;
type WindowId = GenericId<"o21Windows">;
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
    .query("o21Windows")
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
  const valid = await validateWindow(ctx, input, now);
  const windowId = await ctx.db.insert("o21Windows", {
    opensAt: valid.opensAt,
    closesAt: valid.closesAt,
    ...(valid.label ? { label: valid.label } : {}),
    ...(createdBy ? { createdBy } : {}),
    createdAt: now,
    updatedAt: now,
  });
  return { windowId, now };
}

async function cancelWindow(ctx: MutationCtx, windowId: WindowId, cancelledBy: AdminId | undefined) {
  const window = await ctx.db.get(windowId);
  if (!window) throw slotWindowError("SLOT_WINDOW_NOT_FOUND");
  const now = Date.now();
  const status = windowStatus(window, now);
  if (status === "cancelled" || status === "ended") throw slotWindowError("SLOT_WINDOW_NOT_EDITABLE");
  await ctx.db.patch(windowId, {
    cancelledAt: now,
    ...(cancelledBy ? { cancelledBy } : {}),
    updatedAt: now,
  });
  return now;
}

function logWindow(
  ctx: MutationCtx,
  actorAdminId: AdminId,
  action: "o21_window_created" | "o21_window_updated" | "o21_window_cancelled",
  windowId: WindowId,
  now: number,
) {
  return ctx.db.insert("staffConfigLogs", {
    actorAdminId,
    action,
    targetO21WindowId: windowId,
    createdAt: now,
  });
}

function toListRow(window: WindowDoc, now: number) {
  return {
    windowId: window._id,
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    label: window.label ?? null,
    status: windowStatus(window, now),
    cancelledAt: window.cancelledAt ?? null,
    createdAt: window.createdAt,
  };
}

async function listRows(ctx: QueryCtx | MutationCtx) {
  const now = Date.now();
  const rows = await ctx.db.query("o21Windows").withIndex("by_opensAt").order("desc").take(MAX_WINDOWS);
  return rows.map((row) => toListRow(row, now));
}

const windowFieldArgs = {
  opensAt: v.number(),
  closesAt: v.number(),
  label: v.optional(v.string()),
};

export const createO21Window = mutation({
  args: { ...sessionTokenArgs, ...windowFieldArgs },
  handler: async (ctx, { sessionToken, ...input }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const { windowId, now } = await insertWindow(ctx, input, actor._id);
    await logWindow(ctx, actor._id, "o21_window_created", windowId, now);
    return { windowId };
  },
});

export const updateO21Window = mutation({
  args: { ...sessionTokenArgs, windowId: v.id("o21Windows"), ...windowFieldArgs },
  handler: async (ctx, { sessionToken, windowId, ...input }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const window = await ctx.db.get(windowId);
    if (!window) throw slotWindowError("SLOT_WINDOW_NOT_FOUND");
    const now = Date.now();
    const status = windowStatus(window, now);
    if (status === "cancelled" || status === "ended") throw slotWindowError("SLOT_WINDOW_NOT_EDITABLE");
    if (status === "live" && input.opensAt !== window.opensAt) throw slotWindowError("SLOT_WINDOW_NOT_EDITABLE");
    const valid = await validateWindow(ctx, input, now, windowId);
    await ctx.db.patch(windowId, {
      opensAt: valid.opensAt,
      closesAt: valid.closesAt,
      label: valid.label,
      updatedAt: now,
    });
    await logWindow(ctx, actor._id, "o21_window_updated", windowId, now);
    return { ok: true as const };
  },
});

export const cancelO21Window = mutation({
  args: { ...sessionTokenArgs, windowId: v.id("o21Windows") },
  handler: async (ctx, { sessionToken, windowId }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const now = await cancelWindow(ctx, windowId, actor._id);
    await logWindow(ctx, actor._id, "o21_window_cancelled", windowId, now);
    return { ok: true as const };
  },
});

export const listO21Windows = query({
  args: { ...sessionTokenArgs },
  handler: async (ctx, { sessionToken }) => {
    await requireAdminRole(ctx, sessionToken);
    return listRows(ctx);
  },
});

export const createO21WindowInternal = internalMutation({
  args: windowFieldArgs,
  handler: async (ctx, input) => {
    const { windowId } = await insertWindow(ctx, input, undefined);
    return { windowId };
  },
});

export const cancelO21WindowInternal = internalMutation({
  args: { windowId: v.id("o21Windows") },
  handler: async (ctx, { windowId }) => {
    await cancelWindow(ctx, windowId, undefined);
    return { ok: true as const };
  },
});

export const listO21WindowsInternal = internalQuery({
  args: {},
  handler: async (ctx) => listRows(ctx),
});
