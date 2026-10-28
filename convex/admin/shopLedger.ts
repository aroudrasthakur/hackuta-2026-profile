/**
 * Shop points writes — **internal helpers only** (not Convex entry points).
 *
 * These functions trust their caller for authorization, like `pointsLedger.ts`.
 * Public mutations must call `requireAdminRole` or
 * `requireVolunteerCapability(..., "canRedeemShop")` first.
 *
 * Every points change patches `participants.points` and inserts a
 * `volunteerActionLogs` row. All writes run in the caller's transaction, so a
 * purchase or refund lands whole or not at all. Concurrent purchases conflict
 * on the participant row, and Convex retries the loser, which then sees the
 * new balance.
 */
import type { DocumentByName } from "convex/server";
import type { GenericId } from "convex/values";
import type { DataModel, MutationCtx } from "../lib/dataModel";
import { adminError } from "../../shared/admin/errors";
import { assertPointBalance } from "../../shared/admin/volunteerRules";
import { computeLedgerPoints, pointBalancePatch } from "./pointsLedger";
import type { EffectivePrice } from "./shopPricing";

type AdminId = GenericId<"admins">;
type ShopItemDoc = DocumentByName<DataModel, "shopItems">;
type ParticipantDoc = DocumentByName<DataModel, "participants">;
type RedemptionDoc = DocumentByName<DataModel, "shopRedemptions">;

/** Cached balance, falling back to the ledger before backfill (never to zero). */
export async function participantBalance(ctx: MutationCtx, participant: ParticipantDoc) {
  return assertPointBalance(participant.points ?? await computeLedgerPoints(ctx, participant._id));
}

/** Receipt shape returned to the volunteer for new and repeated purchases. */
export function purchaseReceipt(redemption: RedemptionDoc) {
  return {
    redemptionId: redemption._id,
    itemId: redemption.itemId,
    itemName: redemption.itemName,
    quantity: redemption.quantity,
    unitPointsCost: redemption.unitPointsCost,
    basePointsCost: redemption.basePointsCost,
    totalPointsSpent: redemption.totalPointsSpent,
    pointsBefore: redemption.pointsBefore,
    pointsAfter: redemption.pointsAfter,
    flashSaleId: redemption.flashSaleId ?? null,
    redeemedAt: redemption.redeemedAt,
  };
}

/**
 * Writes a checked purchase: points, redemption, and ledger row. The caller
 * has already confirmed the balance; the balance helper still refuses to go
 * negative.
 */
export async function recordPurchase(
  ctx: MutationCtx,
  args: {
    actorAdminId: AdminId;
    participant: ParticipantDoc;
    item: ShopItemDoc;
    quantity: number;
    price: EffectivePrice;
    idempotencyKey: string;
    now: number;
  },
) {
  const totalPointsSpent = args.price.unitPointsCost * args.quantity;
  const pointsBefore = await participantBalance(ctx, args.participant);
  const pointsAfter = assertPointBalance(pointsBefore - totalPointsSpent);

  const redemptionId = await ctx.db.insert("shopRedemptions", {
    participantId: args.participant._id,
    itemId: args.item._id,
    itemName: args.item.name,
    quantity: args.quantity,
    unitPointsCost: args.price.unitPointsCost,
    basePointsCost: args.price.basePointsCost,
    totalPointsSpent,
    redeemedBy: args.actorAdminId,
    redeemedAt: args.now,
    pointsBefore,
    pointsAfter,
    ...(args.price.flashSaleId ? { flashSaleId: args.price.flashSaleId } : {}),
    idempotencyKey: args.idempotencyKey,
  });
  await ctx.db.patch(args.participant._id, pointBalancePatch(pointsBefore, pointsAfter, args.now));
  await ctx.db.insert("volunteerActionLogs", {
    actorAdminId: args.actorAdminId,
    participantId: args.participant._id,
    action: "shop_purchase",
    pointsDelta: -totalPointsSpent,
    previousPoints: pointsBefore,
    newPoints: pointsAfter,
    shopRedemptionId: redemptionId,
    createdAt: args.now,
  });
  const redemption = await ctx.db.get(redemptionId);
  return purchaseReceipt(redemption!);
}

/**
 * Refunds a purchase once: restores exactly `totalPointsSpent` and marks the
 * redemption. Throws `REDEMPTION_ALREADY_REFUNDED` on a second refund.
 */
export async function recordRefund(
  ctx: MutationCtx,
  args: {
    actorAdminId: AdminId;
    redemption: RedemptionDoc;
    reason: string;
    now: number;
  },
) {
  const { redemption } = args;
  if (redemption.refund) {
    throw adminError("REDEMPTION_ALREADY_REFUNDED");
  }
  const participant = await ctx.db.get(redemption.participantId);
  if (!participant) {
    throw adminError("PARTICIPANT_NOT_FOUND");
  }
  const previousPoints = await participantBalance(ctx, participant);
  const newPoints = assertPointBalance(previousPoints + redemption.totalPointsSpent);

  await ctx.db.patch(participant._id, pointBalancePatch(previousPoints, newPoints, args.now));
  await ctx.db.insert("volunteerActionLogs", {
    actorAdminId: args.actorAdminId,
    participantId: participant._id,
    action: "shop_refund",
    pointsDelta: redemption.totalPointsSpent,
    previousPoints,
    newPoints,
    reason: args.reason,
    shopRedemptionId: redemption._id,
    createdAt: args.now,
  });
  await ctx.db.patch(redemption._id, {
    refund: {
      refundedBy: args.actorAdminId,
      refundedAt: args.now,
      reason: args.reason,
      pointsRestored: redemption.totalPointsSpent,
    },
  });
  return { previousPoints, newPoints, pointsRestored: redemption.totalPointsSpent };
}
