/**
 * Arcade wallets: each checked-in attendee's arcade balance, in points, in
 * `arcadeWallets` (no row = 0). Only the play path (points.ts) and deposits /
 * withdrawals (transfers.ts) write it, always inside their own mutation.
 */
import type { MutationCtx, QueryCtx } from "../lib/dataModel";
import type { CheckedInDoc } from "./access";

const isPoints = (value: number) => Number.isSafeInteger(value) && value >= 0;

export async function walletRow(ctx: QueryCtx | MutationCtx, checkedIn: Pick<CheckedInDoc, "_id">) {
  return ctx.db
    .query("arcadeWallets")
    .withIndex("by_checkedIn", (q) => q.eq("checkedInId", checkedIn._id))
    .unique();
}

/** Arcade points held now. A corrupt stored value throws (rolling back the mutation) instead of being trusted. */
export async function arcadeBalance(ctx: QueryCtx | MutationCtx, checkedIn: Pick<CheckedInDoc, "_id">): Promise<number> {
  const row = await walletRow(ctx, checkedIn);
  const points = row?.points ?? 0;
  if (!isPoints(points)) throw new Error("arcade: corrupt wallet balance");
  return points;
}

/** Sets the arcade balance (creating the wallet the first time). Never below 0. */
export async function setArcadeBalance(ctx: MutationCtx, checkedIn: Pick<CheckedInDoc, "_id">, points: number, now: number) {
  if (!isPoints(points)) throw new Error("arcade: invalid wallet balance");
  const row = await walletRow(ctx, checkedIn);
  if (row) await ctx.db.patch(row._id, { points, updatedAt: now });
  else await ctx.db.insert("arcadeWallets", { checkedInId: checkedIn._id, points, updatedAt: now });
}
