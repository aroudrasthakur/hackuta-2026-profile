import { v } from "convex/values";
import { adminError } from "../../shared/admin/errors";
import { internalMutation } from "../_generated/server";
import { computeLedgerPoints } from "./pointsLedger";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

function resolveBatchSize(batchSize: number | undefined) {
  if (batchSize === undefined) {
    return DEFAULT_BATCH_SIZE;
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw adminError("INVALID_POINTS");
  }
  return batchSize;
}

/**
 * Fills `participants.points` from the ledger where the field is missing.
 * Rows that already have a balance are left alone, so repeating a finished
 * cursor is a no-op. Run to `isDone` before a later deploy makes `points` required.
 */
export const backfillParticipantPoints = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, batchSize }) => {
    const page = await ctx.db.query("participants").paginate({
      numItems: resolveBatchSize(batchSize),
      cursor: cursor ?? null,
    });

    let patched = 0;
    for (const participant of page.page) {
      if (participant.points !== undefined) {
        continue;
      }
      const points = await computeLedgerPoints(ctx, participant._id);
      const now = Date.now();
      await ctx.db.patch(participant._id, {
        points,
        updatedAt: now,
        ...(points > 0 ? { pointsReachedAt: participant.updatedAt ?? now } : {}),
      });
      patched += 1;
    }

    return {
      patched,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
