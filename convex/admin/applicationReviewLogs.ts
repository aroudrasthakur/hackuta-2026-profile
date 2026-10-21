import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "../_generated/server";
import { adminError } from "../../shared/admin/errors";
import { applicationFormWasSubmitted } from "../lib/applications";
import { enqueueApplicationDecision } from "./decisionFinalize";
import { requireAdminRole, requireReviewerAccess, sessionTokenArgs } from "./staffAuth";
import {
  applicationReviewLogActivityAction,
  applicationReviewLogDecisionAction,
} from "./fields";
import { startReviewClaim } from "./reviewClaim";

/**
 * Appends a non-decision event; decisions are recorded with their state update below.
 * `viewed` is log-only. `started_review` claims the review with conflict + stale rules;
 * `review_ended` counts as activity only for the admin currently reviewing.
 */
export const logApplicationReviewAction = mutation({
  args: {
    ...sessionTokenArgs,
    applicationId: v.id("applications"),
    action: applicationReviewLogActivityAction,
  },
  returns: v.union(v.id("applicationReviewLogs"), v.null()),
  handler: async (ctx, { sessionToken, applicationId, action }) => {
    const admin = await requireReviewerAccess(ctx, sessionToken);
    const application = await ctx.db.get(applicationId);
    if (
      !application ||
      ((action === "viewed" || action === "started_review") &&
        !applicationFormWasSubmitted(application))
    ) {
      throw adminError("APPLICATION_NOT_FOUND");
    }

    const now = Date.now();
    if (action === "started_review") {
      const claim = await startReviewClaim(ctx, { applicationId, admin, now });
      if (claim.outcome === "refreshed") {
        return null;
      }
      return await ctx.db.insert("applicationReviewLogs", {
        applicationId,
        adminId: admin._id,
        action,
        createdAt: now,
      });
    }

    if (action !== "viewed") {
      const review = await ctx.db
        .query("applicationReviews")
        .withIndex("by_application", (q) => q.eq("applicationId", applicationId))
        .unique();
      if (!review) throw new Error("Application review not found");

      if (review.reviewedBy === admin._id) {
        await ctx.db.patch(review._id, { lastActiveAt: now, updatedAt: now });
      }
    }

    return await ctx.db.insert("applicationReviewLogs", {
      applicationId,
      adminId: admin._id,
      action,
      createdAt: now,
    });
  },
});

/** Records a decision in the email queue. Review status changes only when an admin releases the email. */
export const setApplicationDecision = mutation({
  args: {
    ...sessionTokenArgs,
    applicationId: v.id("applications"),
    decision: applicationReviewLogDecisionAction,
  },
  returns: v.object({
    queued: v.literal(true),
    duplicate: v.boolean(),
  }),
  handler: async (ctx, { sessionToken, applicationId, decision }) => {
    const admin = await requireReviewerAccess(ctx, sessionToken);
    const application = await ctx.db.get(applicationId);
    if (!application) throw adminError("APPLICATION_NOT_FOUND");
    if (!applicationFormWasSubmitted(application)) throw adminError("APPLICATION_NOT_SUBMITTED");

    const review = await ctx.db
      .query("applicationReviews")
      .withIndex("by_application", (q) => q.eq("applicationId", applicationId))
      .unique();
    if (!review) throw new Error("Application review not found");

    return await enqueueApplicationDecision(ctx, {
      application,
      review,
      admin,
      decision,
    });
  },
});

/** Returns one page of history, newest first; full history is restricted to `admin` role. */
export const listApplicationReviewLogs = query({
  args: {
    ...sessionTokenArgs,
    applicationId: v.id("applications"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { sessionToken, applicationId, paginationOpts }) => {
    await requireAdminRole(ctx, sessionToken);
    if (!(await ctx.db.get(applicationId))) throw adminError("APPLICATION_NOT_FOUND");

    const result = await ctx.db
      .query("applicationReviewLogs")
      .withIndex("by_application_createdAt", (q) => q.eq("applicationId", applicationId))
      .order("desc")
      .paginate(paginationOpts);

    const actorNames = new Map<string, string>();
    for (const adminId of new Set(result.page.map((log) => log.adminId))) {
      actorNames.set(adminId, (await ctx.db.get(adminId))?.name ?? "Unknown organizer");
    }

    return {
      ...result,
      page: result.page.map((log) => ({
        _id: log._id,
        action: log.action,
        createdAt: log.createdAt,
        actorName: actorNames.get(log.adminId) ?? "Unknown organizer",
      })),
    };
  },
});
