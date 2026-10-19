import type { DocumentByName } from "convex/server";
import type { ApplicationDoc, DataModel, MutationCtx } from "../lib/dataModel";
import { adminError } from "../../shared/admin/errors";
import {
  assertParticipantAcceptanceAllowed,
  ensureParticipantForAcceptance,
} from "./participantCreation";
import { decisionPatch } from "./reviewState";

type ApplicationReviewDoc = DocumentByName<DataModel, "applicationReviews">;
type AdminDoc = DocumentByName<DataModel, "admins">;

/**
 * Single transaction for acceptance: review update, audit log, and participant row.
 * Stable under re-acceptance, UI retries, and manual re-runs.
 */
export async function applyAcceptedApplicationDecision(
  ctx: MutationCtx,
  args: {
    application: ApplicationDoc;
    review: ApplicationReviewDoc;
    admin: AdminDoc;
  },
) {
  const applicantUser = await ctx.db.get(args.application.authUserId);
  if (!applicantUser) {
    throw adminError("APPLICANT_ACCOUNT_MISSING");
  }

  await assertParticipantAcceptanceAllowed(ctx, {
    applicationId: args.application._id,
    authUserId: args.application.authUserId,
  });

  const now = Date.now();
  await ctx.db.patch(
    args.review._id,
    decisionPatch(args.review, args.admin._id, "accepted", now),
  );

  const logId = await ctx.db.insert("applicationReviewLogs", {
    applicationId: args.application._id,
    adminId: args.admin._id,
    action: "accepted",
    createdAt: now,
  });

  const { participantId, created } = await ensureParticipantForAcceptance(ctx, {
    applicationId: args.application._id,
    authUserId: args.application.authUserId,
    acceptedBy: args.admin._id,
    acceptedAt: now,
  });

  return { logId, participantId, participantCreated: created };
}
