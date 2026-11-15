/**
 * Deposit and withdraw: the only bridge between a hacker's profile balance
 * (`checkedIn.points`) and their arcade wallet (`arcadeWallets`), 1 point = 1
 * arcade point. Games never touch the profile balance.
 *
 * Each call is one Convex mutation, so the profile change, the wallet change
 * and the `arcadeTransfers` log row commit together or not at all. Two calls
 * at once (two tabs, or a transfer during a spin) run as if one after the
 * other. `transferId` is the client's idempotency key: repeating it returns
 * the stored transfer and moves nothing again.
 *
 * The player always comes from the caller's session, never from an id sent by
 * the browser. Expected refusals come back as `{ status: "error", code }`.
 */
import type { DocumentByName } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { DataModel, MutationCtx } from "../lib/dataModel";
import { assertPointBalance } from "../../shared/admin/volunteerRules";
import { computeLedgerPoints, pointBalancePatch } from "../admin/pointsLedger";
import {
  balancesAfter,
  checkDeposit,
  checkWithdraw,
  normalizePlayId,
  type TransferErrorCode,
  type TransferKind,
} from "../../shared/arcade/rules";
import { loadArcade, loadPlayer, playerProblem, type CheckedInDoc } from "./access";
import { arcadeBalance, setArcadeBalance } from "./wallet";

type TransferDoc = DocumentByName<DataModel, "arcadeTransfers">;

/** Transfers listed by `getMyTransfers` by default, and the most it returns. */
export const MY_TRANSFERS_DEFAULT = 20;
export const MY_TRANSFERS_MAX = 50;

function transferError(code: TransferErrorCode) {
  return { status: "error" as const, code };
}

export function transferView(row: TransferDoc) {
  return {
    transferId: row.transferId,
    kind: row.kind,
    amount: row.amount,
    profileBefore: row.profileBefore,
    profileAfter: row.profileAfter,
    arcadeBefore: row.arcadeBefore,
    arcadeAfter: row.arcadeAfter,
    createdAt: row.createdAt,
  };
}

async function findTransfer(ctx: MutationCtx, checkedIn: CheckedInDoc, transferId: string) {
  return ctx.db
    .query("arcadeTransfers")
    .withIndex("by_checkedIn_transferId", (q) => q.eq("checkedInId", checkedIn._id).eq("transferId", transferId))
    .first();
}

/** Profile balance; rows from before the cached field fall back to the ledger. */
async function profilePointsOf(ctx: MutationCtx, checkedIn: CheckedInDoc) {
  return assertPointBalance(checkedIn.points ?? (await computeLedgerPoints(ctx, checkedIn._id)));
}

async function transfer(ctx: MutationCtx, kind: TransferKind, rawTransferId: string, amount: number) {
  const now = Date.now();
  const player = await loadPlayer(ctx);
  const problem = playerProblem(player);
  if (problem) return transferError(problem);
  const checkedIn = player.checkedIn!;

  const transferId = normalizePlayId(rawTransferId);
  if (!transferId) return transferError("INVALID_TRANSFER_ID");
  // A retry of a transfer that already committed: show it, move nothing.
  const existing = await findTransfer(ctx, checkedIn, transferId);
  if (existing) return { status: "ok" as const, transfer: transferView(existing) };

  // Deposits need the arcade open. Withdrawals always work, so points can never
  // get stuck in the arcade after it closes.
  if (kind === "deposit") {
    const { state } = await loadArcade(ctx, now);
    if (state.status !== "on") return transferError("ARCADE_CLOSED");
  }

  const profileBefore = await profilePointsOf(ctx, checkedIn);
  const arcadeBefore = await arcadeBalance(ctx, checkedIn);
  const refused = kind === "deposit" ? checkDeposit(amount, profileBefore) : checkWithdraw(amount, arcadeBefore);
  if (refused) return transferError(refused);

  const after = balancesAfter(kind, amount, profileBefore, arcadeBefore);
  const profileAfter = assertPointBalance(after.profile);
  await ctx.db.patch(checkedIn._id, pointBalancePatch(profileBefore, profileAfter, now));
  await setArcadeBalance(ctx, checkedIn, after.arcade, now);
  const id = await ctx.db.insert("arcadeTransfers", {
    checkedInId: checkedIn._id,
    transferId,
    kind,
    amount,
    profileBefore,
    profileAfter,
    arcadeBefore,
    arcadeAfter: after.arcade,
    createdAt: now,
  });
  return { status: "ok" as const, transfer: transferView((await ctx.db.get(id))!) };
}

const transferArgs = { transferId: v.string(), amount: v.number() };

/** Moves `amount` points from the profile balance into the arcade wallet. The arcade must be open. */
export const deposit = mutation({
  args: transferArgs,
  handler: (ctx, { transferId, amount }) => transfer(ctx, "deposit", transferId, amount),
});

/** Moves `amount` arcade points back onto the profile balance. Works even when the arcade is closed. */
export const withdraw = mutation({
  args: transferArgs,
  handler: (ctx, { transferId, amount }) => transfer(ctx, "withdraw", transferId, amount),
});

/** The caller's own deposits and withdrawals, newest first. Null when signed out or not checked in. */
export const getMyTransfers = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const player = await loadPlayer(ctx);
    const checkedIn = player.checkedIn;
    if (!player.user || !checkedIn) return null;
    const take = Math.min(MY_TRANSFERS_MAX, Math.max(1, Math.floor(limit ?? MY_TRANSFERS_DEFAULT)));
    const rows = await ctx.db
      .query("arcadeTransfers")
      .withIndex("by_checkedIn_createdAt", (q) => q.eq("checkedInId", checkedIn._id))
      .order("desc")
      .take(take);
    return {
      profilePoints: checkedIn.points,
      arcadePoints: await arcadeBalance(ctx, checkedIn),
      transfers: rows.map(transferView),
    };
  },
});
