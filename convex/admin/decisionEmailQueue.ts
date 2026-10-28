import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { GenericId } from "convex/values";
import { adminError } from "../../shared/admin/errors";
import { getHackathonName } from "../lib/eventConfig";
import type { MutationCtx, QueryCtx } from "../lib/dataModel";
import { applyReleasedApplicationDecision, type ReviewDecision } from "./decisionFinalize";
import { requireAdminRole, requireReviewerAccess, sessionTokenArgs } from "./staffAuth";

const openStatuses = new Set(["queued", "held", "sending"]);

/** Cap sent rows returned to the admin UI (newest first). */
const RECENTLY_SENT_QUERY_LIMIT = 20;
export const RELEASE_BATCH_LIMIT = 50;
export const SENDING_STALE_MS = 10 * 60 * 1000;

export async function openDecisionEmailForApplication(
  ctx: QueryCtx | MutationCtx,
  applicationId: GenericId<"applications">,
) {
  const rows = await ctx.db
    .query("decisionEmailQueue")
    .withIndex("by_application", (q) => q.eq("applicationId", applicationId))
    .collect();
  return rows.find((row) => openStatuses.has(row.status)) ?? null;
}

function canRelease(reviewStatus: string | null, decision: ReviewDecision) {
  if (reviewStatus === "waitlisted" && decision === "accepted") return true;
  return (
    reviewStatus !== "accepted" &&
    reviewStatus !== "rejected" &&
    reviewStatus !== "waitlisted" &&
    reviewStatus !== "withdrawn"
  );
}

function truncateError(error: unknown) {
  const message = error instanceof Error ? error.message : "The email server rejected this message.";
  return message.slice(0, 500);
}

/** Pending and recent decision emails. Reviewers and admins can read this queue. */
export const listDecisionEmailQueue = query({
  args: sessionTokenArgs,
  handler: async (ctx, { sessionToken }) => {
    await requireReviewerAccess(ctx, sessionToken);
    const rows = await ctx.db.query("decisionEmailQueue").collect();
    const counts = { queued: 0, held: 0, sending: 0, failed: 0, sent: 0 };
    for (const row of rows) {
      if (row.status in counts) counts[row.status as keyof typeof counts] += 1;
    }

    const active = rows
      .filter((row) => row.status !== "sent")
      .sort((left, right) => right.queuedAt - left.queuedAt);
    const sent = rows
      .filter((row) => row.status === "sent")
      .sort((left, right) => (right.sentAt ?? right.updatedAt) - (left.sentAt ?? left.updatedAt))
      .slice(0, RECENTLY_SENT_QUERY_LIMIT);

    const present = (row: (typeof rows)[number]) => ({
      itemId: row._id,
      applicationId: row.applicationId,
      decision: row.decision,
      recipientEmail: row.recipientEmail,
      applicantName: row.applicantName,
      status: row.status,
      queuedAt: row.queuedAt,
      sentAt: row.sentAt ?? null,
      errorMessage: row.errorMessage ?? null,
    });

    return {
      counts,
      active: active.map(present),
      sent: sent.map(present),
    };
  },
});

export const setDecisionEmailHold = mutation({
  args: {
    ...sessionTokenArgs,
    itemId: v.id("decisionEmailQueue"),
    held: v.boolean(),
  },
  handler: async (ctx, { sessionToken, itemId, held }) => {
    await requireAdminRole(ctx, sessionToken);
    const row = await ctx.db.get(itemId);
    if (!row) throw adminError("APPLICATION_NOT_FOUND");
    const next = held ? "held" : "queued";
    if (row.status !== "queued" && row.status !== "held") {
      throw adminError("DECISION_EMAIL_SEND_IN_PROGRESS");
    }
    if (row.status === next) return { status: row.status };
    await ctx.db.patch(itemId, { status: next, updatedAt: Date.now() });
    return { status: next };
  },
});

export const retryFailedDecisionEmails = mutation({
  args: sessionTokenArgs,
  handler: async (ctx, { sessionToken }) => {
    await requireAdminRole(ctx, sessionToken);
    const now = Date.now();
    const failed = await ctx.db
      .query("decisionEmailQueue")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .collect();
    const sending = await ctx.db
      .query("decisionEmailQueue")
      .withIndex("by_status", (q) => q.eq("status", "sending"))
      .collect();
    const staleSending = sending.filter((row) => now - row.updatedAt >= SENDING_STALE_MS);
    const candidates = [...failed, ...staleSending];
    let retried = 0;
    for (const row of candidates) {
      const siblingRows = await ctx.db
        .query("decisionEmailQueue")
        .withIndex("by_application", (q) => q.eq("applicationId", row.applicationId))
        .collect();
      if (siblingRows.some((s) => s._id !== row._id && (s.status === "queued" || s.status === "held"))) {
        continue;
      }
      await ctx.db.patch(row._id, {
        status: "queued",
        updatedAt: now,
        errorMessage: undefined,
      });
      retried += 1;
    }
    return { retried };
  },
});

/** Claims queued rows for one release. Called only by the release action. */
export const claimDecisionEmails = internalMutation({
  args: {
    ...sessionTokenArgs,
    itemIds: v.optional(v.array(v.id("decisionEmailQueue"))),
  },
  handler: async (ctx, { sessionToken, itemIds }) => {
    await requireAdminRole(ctx, sessionToken);
    const now = Date.now();
    const sending = await ctx.db
      .query("decisionEmailQueue")
      .withIndex("by_status", (q) => q.eq("status", "sending"))
      .collect();
    for (const row of sending) {
      if (now - row.updatedAt >= SENDING_STALE_MS) {
        await ctx.db.patch(row._id, {
          status: "failed",
          updatedAt: now,
          errorMessage: "The email release timed out before completion.",
        });
      } else {
        throw adminError("DECISION_EMAIL_SEND_IN_PROGRESS");
      }
    }

    const uniqueItemIds = itemIds ? Array.from(new Set(itemIds)) : undefined;
    const selected = uniqueItemIds
      ? await Promise.all(uniqueItemIds.map((itemId) => ctx.db.get(itemId)))
      : await ctx.db
          .query("decisionEmailQueue")
          .withIndex("by_status", (q) => q.eq("status", "queued"))
          .take(RELEASE_BATCH_LIMIT);

    if (uniqueItemIds && selected.some((row) => !row || row.status !== "queued")) {
      throw adminError("DECISION_EMAIL_QUEUE_EMPTY");
    }
    const rows = selected.filter((row): row is NonNullable<typeof row> => row !== null && row.status === "queued");
    if (rows.length === 0) throw adminError("DECISION_EMAIL_QUEUE_EMPTY");

    const hackathonName = await getHackathonName(ctx);
    const claimed = [];
    for (const row of rows) {
      const review = await ctx.db
        .query("applicationReviews")
        .withIndex("by_application", (q) => q.eq("applicationId", row.applicationId))
        .unique();
      await ctx.db.patch(row._id, { status: "sending", updatedAt: now, errorMessage: undefined });
      claimed.push({
        itemId: row._id,
        applicationId: row.applicationId,
        decision: row.decision,
        recipientEmail: row.recipientEmail,
        applicantName: row.applicantName,
        reviewStatus: review?.status ?? null,
        hackathonName,
      });
    }
    return claimed;
  },
});

/** Marks one claimed row sent (and publishes the decision) or failed. */
export const finishDecisionEmailRelease = internalMutation({
  args: {
    itemId: v.id("decisionEmailQueue"),
    outcome: v.union(v.literal("sent"), v.literal("failed")),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, { itemId, outcome, errorMessage }) => {
    const row = await ctx.db.get(itemId);
    if (!row || row.status !== "sending") return { applied: false as const };

    const now = Date.now();
    if (outcome === "failed") {
      await ctx.db.patch(itemId, {
        status: "failed",
        updatedAt: now,
        errorMessage: errorMessage ?? "The email server rejected this message.",
      });
      return { applied: false as const };
    }

    const application = await ctx.db.get(row.applicationId);
    const review = application
      ? await ctx.db
          .query("applicationReviews")
          .withIndex("by_application", (q) => q.eq("applicationId", row.applicationId))
          .unique()
      : null;
    const admin = await ctx.db.get(row.queuedBy);
    if (!application || !review || !admin || !canRelease(review.status, row.decision)) {
      await ctx.db.patch(itemId, {
        status: "failed",
        updatedAt: now,
        errorMessage: "The review state changed before this email could be released.",
      });
      return { applied: false as const };
    }

    await applyReleasedApplicationDecision(ctx, {
      application,
      review,
      admin,
      decision: row.decision,
    });
    await ctx.db.patch(itemId, {
      status: "sent",
      updatedAt: now,
      sentAt: now,
      errorMessage: undefined,
    });
    return { applied: true as const };
  },
});

export { truncateError };
