import type { DocumentByName } from "convex/server";
import type { GenericId } from "convex/values";
import type { DataModel, MutationCtx } from "../lib/dataModel";
import { adminError } from "../../shared/admin/errors";
import { foodRestrictionFromApplication } from "../../shared/admin/participantFoodRestriction";

type ParticipantDoc = DocumentByName<DataModel, "participants">;

export type AcceptanceParticipantArgs = {
  applicationId: GenericId<"applications">;
  authUserId: GenericId<"users">;
  acceptedBy: GenericId<"admins">;
  acceptedAt: number;
};

/** 256-bit random hex token used as the participant's QR identity. */
export function createQrCodeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function generateUniqueQrCodeToken(ctx: MutationCtx) {
  let qrCodeToken = createQrCodeToken();
  while (
    await ctx.db
      .query("participants")
      .withIndex("by_qr_token", (q) => q.eq("qrCodeToken", qrCodeToken))
      .first()
  ) {
    qrCodeToken = createQrCodeToken();
  }
  return qrCodeToken;
}

async function findParticipantForAcceptance(
  ctx: MutationCtx,
  args: Pick<AcceptanceParticipantArgs, "applicationId" | "authUserId">,
) {
  const byApplication = await ctx.db
    .query("participants")
    .withIndex("by_application", (q) => q.eq("applicationId", args.applicationId))
    .unique();
  if (byApplication) {
    return { participant: byApplication, matchedBy: "application" as const };
  }

  const byAuthUser = await ctx.db
    .query("participants")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", args.authUserId))
    .first();
  if (byAuthUser) {
    return { participant: byAuthUser, matchedBy: "auth_user" as const };
  }

  return null;
}

function assertParticipantMatchesApplication(
  participant: ParticipantDoc,
  args: Pick<AcceptanceParticipantArgs, "applicationId" | "authUserId">,
) {
  if (participant.authUserId !== args.authUserId) {
    throw new Error("Participant authUserId does not match application.");
  }
  if (participant.applicationId !== args.applicationId) {
    throw adminError("PARTICIPANT_CONFLICT");
  }
}

/**
 * Pre-write guard for acceptance. Safe to call before review/log mutations so a
 * conflicting participant row aborts the whole decision transaction.
 */
export async function assertParticipantAcceptanceAllowed(
  ctx: MutationCtx,
  args: Pick<AcceptanceParticipantArgs, "applicationId" | "authUserId">,
) {
  const existing = await findParticipantForAcceptance(ctx, args);
  if (!existing) {
    return;
  }

  assertParticipantMatchesApplication(existing.participant, args);
}

/**
 * Idempotent participant insert for an accepted application.
 * Checks both `by_application` and `by_auth_user` before inserting.
 * Re-acceptance and manual retries return the existing row without error.
 */
export async function ensureParticipantForAcceptance(
  ctx: MutationCtx,
  args: AcceptanceParticipantArgs,
) {
  const existing = await findParticipantForAcceptance(ctx, args);
  if (existing) {
    assertParticipantMatchesApplication(existing.participant, args);
    return { participantId: existing.participant._id, created: false as const };
  }

  const application = await ctx.db.get(args.applicationId);
  if (!application) {
    throw new Error("Application not found.");
  }

  const qrCodeToken = await generateUniqueQrCodeToken(ctx);
  const now = Date.now();
  const foodRestriction = foodRestrictionFromApplication(application);
  const participantId = await ctx.db.insert("participants", {
    applicationId: args.applicationId,
    authUserId: args.authUserId,
    acceptedAt: args.acceptedAt,
    acceptedBy: args.acceptedBy,
    qrCodeToken,
    ...(foodRestriction !== undefined ? { foodRestriction } : {}),
    createdAt: now,
    updatedAt: now,
  });
  return { participantId, created: true as const };
}
