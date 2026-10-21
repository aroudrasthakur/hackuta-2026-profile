import type { GenericId } from "convex/values";
import type { DocumentByName } from "convex/server";
import { formatApplicantFullName } from "../lib/applications";
import type { ApplicationDoc, DataModel, MutationCtx } from "../lib/dataModel";
import { adminError } from "../../shared/admin/errors";
import { applyAcceptedApplicationDecision } from "./acceptanceDecision";
import { isActiveReviewClaimHeldByOther, isFinalReviewStatus } from "./reviewClaim";
import { decisionPatch } from "./reviewState";

type ApplicationReviewDoc = DocumentByName<DataModel, "applicationReviews">;
type AdminDoc = DocumentByName<DataModel, "admins">;
export type ReviewDecision = "accepted" | "rejected" | "waitlisted";

const OPEN_QUEUE_STATUSES = new Set(["queued", "held", "sending"]);

function applicantEmail(application: ApplicationDoc) {
  const email = application.email?.trim();
  return email ? email : null;
}

function applicantName(application: ApplicationDoc, email: string) {
  return formatApplicantFullName(application) ?? email;
}

async function openQueueRows(ctx: MutationCtx, applicationId: GenericId<"applications">) {
  const rows = await ctx.db
    .query("decisionEmailQueue")
    .withIndex("by_application", (q) => q.eq("applicationId", applicationId))
    .collect();
  return rows.filter((row) => OPEN_QUEUE_STATUSES.has(row.status));
}

/**
 * Stores a decision in the email queue. Review status, audit logs, and participant
 * rows are applied later, only after the email server accepts the message.
 */
export async function enqueueApplicationDecision(
  ctx: MutationCtx,
  args: {
    application: ApplicationDoc;
    review: ApplicationReviewDoc;
    admin: AdminDoc;
    decision: ReviewDecision;
  },
) {
  const promotingWaitlist = args.review.status === "waitlisted" && args.decision === "accepted";
  if (isFinalReviewStatus(args.review.status) && !promotingWaitlist) {
    if (args.review.status === args.decision) {
      return { queued: true as const, duplicate: true as const };
    }
    throw adminError("REVIEW_FINALIZED");
  }

  const now = Date.now();
  if (isActiveReviewClaimHeldByOther(args.review, args.admin._id, now)) {
    throw adminError("REVIEW_CLAIMED");
  }

  const email = applicantEmail(args.application);
  if (!email) {
    throw adminError("DECISION_EMAIL_MISSING");
  }

  const open = await openQueueRows(ctx, args.application._id);
  if (open.some((row) => row.status === "sending")) {
    throw adminError("DECISION_EMAIL_SEND_IN_PROGRESS");
  }

  const existing = open[0];
  if (existing && existing.decision === args.decision) {
    return { queued: true as const, duplicate: true as const };
  }

  const snapshot = {
    decision: args.decision,
    recipientEmail: email,
    applicantName: applicantName(args.application, email),
    status: "queued" as const,
    queuedBy: args.admin._id,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, snapshot);
  } else {
    await ctx.db.insert("decisionEmailQueue", {
      ...snapshot,
      applicationId: args.application._id,
      queuedAt: now,
    });
  }

  return { queued: true as const, duplicate: false as const };
}

/** Applies a released decision after the email server has accepted the message. */
export async function applyReleasedApplicationDecision(
  ctx: MutationCtx,
  args: {
    application: ApplicationDoc;
    review: ApplicationReviewDoc;
    admin: AdminDoc;
    decision: ReviewDecision;
  },
) {
  if (args.decision === "accepted") {
    await applyAcceptedApplicationDecision(ctx, {
      application: args.application,
      review: args.review,
      admin: args.admin,
    });
    return;
  }

  const now = Date.now();
  await ctx.db.patch(
    args.review._id,
    decisionPatch(args.review, args.admin._id, args.decision, now),
  );
  await ctx.db.insert("applicationReviewLogs", {
    applicationId: args.application._id,
    adminId: args.admin._id,
    action: args.decision,
    createdAt: now,
  });
}
