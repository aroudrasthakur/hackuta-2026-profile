import type { DocumentByName } from "convex/server";
import type { GenericId } from "convex/values";
import type { DataModel, MutationCtx, QueryCtx } from "../lib/dataModel";
import { adminError } from "../../shared/admin/errors";

export type ParticipantDoc = DocumentByName<DataModel, "participants">;
export type CheckedInDoc = DocumentByName<DataModel, "checkedIn">;

export async function checkedInForParticipant(
  ctx: QueryCtx | MutationCtx,
  participantId: GenericId<"participants">,
) {
  return ctx.db
    .query("checkedIn")
    .withIndex("by_participant", (q) => q.eq("participantId", participantId))
    .unique();
}

export async function checkedInForAuthUser(
  ctx: QueryCtx | MutationCtx,
  authUserId: GenericId<"users">,
) {
  return ctx.db
    .query("checkedIn")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", authUserId))
    .unique();
}

export async function requireCheckedInForParticipant(
  ctx: QueryCtx | MutationCtx,
  participantId: GenericId<"participants">,
) {
  const row = await checkedInForParticipant(ctx, participantId);
  if (!row) {
    throw adminError("PARTICIPANT_NOT_CHECKED_IN");
  }
  return row;
}

export async function participantIdOfHolder(
  ctx: QueryCtx | MutationCtx,
  holder: {
    participantId?: GenericId<"participants">;
    checkedInId?: GenericId<"checkedIn">;
  },
) {
  if (holder.participantId) {
    return holder.participantId;
  }
  if (holder.checkedInId) {
    const row = await ctx.db.get(holder.checkedInId);
    return row?.participantId;
  }
  return undefined;
}

export function historyRefs(
  _participantId: GenericId<"participants">,
  checkedInId: GenericId<"checkedIn">,
) {
  return { checkedInId };
}

export async function latestMealRedeemedAt(
  ctx: QueryCtx | MutationCtx,
  _participantId: GenericId<"participants">,
  checkedInId?: GenericId<"checkedIn">,
) {
  if (!checkedInId) return null;
  const byCheckedIn = await ctx.db
    .query("mealRedemptions")
    .withIndex("by_checkedIn", (q) => q.eq("checkedInId", checkedInId))
    .order("desc")
    .first();
  return byCheckedIn?.redeemedAt ?? null;
}

export async function hasMealRedemption(
  ctx: QueryCtx | MutationCtx,
  participantId: GenericId<"participants">,
  checkedInId?: GenericId<"checkedIn">,
) {
  return (await latestMealRedeemedAt(ctx, participantId, checkedInId)) !== null;
}
