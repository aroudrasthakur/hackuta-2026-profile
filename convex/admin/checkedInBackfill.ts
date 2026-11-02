/**
 * Idempotent, batched copy of already-checked-in participants onto `checkedIn`.
 * History remapping ran before the old participantId FKs were dropped.
 */
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { adminError } from "../../shared/admin/errors";
import { checkedInForParticipant } from "./checkedInLookup";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 50;

function resolveBatchSize(batchSize: number | undefined) {
  if (batchSize === undefined) return DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw adminError("INVALID_POINTS");
  }
  return batchSize;
}

export const backfillCheckedIn = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, batchSize }) => {
    const page = await ctx.db.query("participants").paginate({
      numItems: resolveBatchSize(batchSize),
      cursor: cursor ?? null,
    });

    let created = 0;
    for (const participant of page.page) {
      if (participant.checkedInAt === undefined) continue;
      const existing = await checkedInForParticipant(ctx, participant._id);
      if (existing) continue;
      await ctx.db.insert("checkedIn", {
        participantId: participant._id,
        applicationId: participant.applicationId,
        authUserId: participant.authUserId,
        acceptedAt: participant.acceptedAt,
        acceptedBy: participant.acceptedBy,
        ...(participant.foodRestriction !== undefined ? { foodRestriction: participant.foodRestriction } : {}),
        checkedInAt: participant.checkedInAt,
        checkedInBy: participant.acceptedBy,
        qrCodeToken: participant.qrCodeToken,
        registrationQrCodeToken: participant.qrCodeToken,
        points: 0,
        createdAt: participant.createdAt,
        updatedAt: participant.updatedAt,
      });
      created += 1;
    }

    return {
      created,
      remapped: 0,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
