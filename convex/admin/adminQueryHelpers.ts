import type { GenericId } from "convex/values";
import { formatApplicantFullName } from "../lib/applications";
import type { MutationCtx, QueryCtx } from "../lib/dataModel";
import { adminError } from "../../shared/admin/errors";

export const UNNAMED_PARTICIPANT = "Participant";
const UNKNOWN_STAFF = "Unknown staff";
const UNKNOWN_EVENT = "Unknown event";

/** Per-request display-name lookups for admin list endpoints. Each id is read once. */
export function nameLookups(ctx: QueryCtx | MutationCtx) {
  const staff = new Map<string, string>();
  const events = new Map<string, string>();
  const participants = new Map<string, string>();
  return {
    async staffName(adminId: GenericId<"admins">) {
      if (!staff.has(adminId)) staff.set(adminId, (await ctx.db.get(adminId))?.name ?? UNKNOWN_STAFF);
      return staff.get(adminId)!;
    },
    async eventName(eventId: GenericId<"events">) {
      if (!events.has(eventId)) events.set(eventId, (await ctx.db.get(eventId))?.name ?? UNKNOWN_EVENT);
      return events.get(eventId)!;
    },
    async participantName(participantId: GenericId<"participants">) {
      if (!participants.has(participantId)) {
        const participant = await ctx.db.get(participantId);
        const application = participant ? await ctx.db.get(participant.applicationId) : null;
        participants.set(participantId, (application && formatApplicantFullName(application)) ?? UNNAMED_PARTICIPANT);
      }
      return participants.get(participantId)!;
    },
  };
}

/** Inclusive `createdAt` range for log queries. Missing ends are open. */
export function createdAtBounds(from?: number, to?: number) {
  const lower = from ?? 0;
  const upper = to ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
    throw adminError("INVALID_LOG_FILTER");
  }
  return { lower, upper };
}
