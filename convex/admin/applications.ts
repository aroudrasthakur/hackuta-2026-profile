import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { SCHOOL_OTHER_OPTION } from "../../shared/registration/constants";
import {
  applicationFormWasSubmitted,
  formatApplicantFullName,
  getApplicationByUser,
  getApplicationReview,
} from "../lib/applications";
import type { ApplicationDoc } from "../lib/dataModel";
import { ACTIVE_REVIEW_STALE_MS, isFinalReviewStatus, isReviewStale, reviewClaimExpiresAt } from "./reviewClaim";
import { openDecisionEmailForApplication } from "./decisionEmailQueue";
import { requireAdminRole, requireReviewerAccess, sessionTokenArgs } from "./staffAuth";
import { adminError } from "../../shared/admin/errors";

function formatApplicantSchool(application: Pick<ApplicationDoc, "school" | "otherSchool">) {
  const school = application.school?.trim();
  const otherSchool = application.otherSchool?.trim();
  if (school === SCHOOL_OTHER_OPTION) {
    return otherSchool || school || "Not provided";
  }
  return school || otherSchool || "Not provided";
}

/** Read-only queue of submitted applications with current review state (no audit logs). */
export const listSubmittedApplications = query({
  args: sessionTokenArgs,
  handler: async (ctx, { sessionToken }) => {
    await requireReviewerAccess(ctx, sessionToken);

    const reviews = await ctx.db.query("applicationReviews").collect();
    const reviewByApplicationId = new Map(reviews.map((review) => [review.applicationId, review]));

    const reviewerIds = new Set(
      reviews.flatMap((review) => (review.reviewedBy ? [review.reviewedBy] : [])),
    );
    const reviewerNameById = new Map<string, string>();
    for (const adminId of reviewerIds) {
      const admin = await ctx.db.get(adminId);
      if (admin) reviewerNameById.set(adminId, admin.name);
    }

    const applications = await ctx.db.query("applications").collect();
    const items = applications
      .filter(applicationFormWasSubmitted)
      .map((application) => {
        const review = reviewByApplicationId.get(application._id);
        const reviewedBy = review?.reviewedBy;
        return {
          applicationId: application._id,
          email: application.email ?? "",
          applicantName:
            formatApplicantFullName(application) ?? application.email ?? "Unknown applicant",
          school: formatApplicantSchool(application),
          submittedAt: application.submittedAt ?? null,
          reviewStatus: review?.status ?? null,
          ...(review?.status === "under_review" && reviewedBy ? {
            reviewClaim: { reviewedBy, expiresAt: reviewClaimExpiresAt(review) },
          } : {}),
          currentReviewerName: reviewedBy
            ? (reviewerNameById.get(reviewedBy) ?? "Unknown organizer")
            : null,
        };
      });

    items.sort((left, right) => (right.submittedAt ?? 0) - (left.submittedAt ?? 0));
    return items;
  },
});

/** Loads a submitted application without changing applicant or review state. */
export const getApplication = query({
  args: {
    ...sessionTokenArgs,
    applicationId: v.string(),
  },
  handler: async (ctx, { sessionToken, applicationId }) => {
    await requireReviewerAccess(ctx, sessionToken);
    const id = ctx.db.normalizeId("applications", applicationId);
    if (!id) return null;
    const application = await ctx.db.get(id);
    if (!application || !applicationFormWasSubmitted(application)) return null;

    const review = await getApplicationReview(ctx, id);
    const pending = await openDecisionEmailForApplication(ctx, id);
    const currentReviewer = review?.reviewedBy ? await ctx.db.get(review.reviewedBy) : null;
    const now = Date.now();
    const resumeUrl = application.resumeStorageId
      ? await ctx.storage.getUrl(application.resumeStorageId)
      : null;
    const resumeStatus: "none" | "available" | "missing" = !application.resumeStorageId
      ? "none"
      : resumeUrl ? "available" : "missing";

    return {
      application,
      reviewStatus: review?.status ?? null,
      pendingDecision: pending
        ? { decision: pending.decision, status: pending.status, queuedAt: pending.queuedAt }
        : null,
      reviewActivity: review
        ? {
            reviewedBy: review.reviewedBy ?? null,
            currentReviewerName: currentReviewer?.name ?? null,
            startedAt: review.startedAt ?? null,
            lastActiveAt: review.lastActiveAt ?? null,
            isFinal: isFinalReviewStatus(review.status),
            isStale: isReviewStale(review, now),
            ...(review.status === "under_review" && review.reviewedBy ? { expiresAt: reviewClaimExpiresAt(review) } : {}),
            activeReviewStaleMs: ACTIVE_REVIEW_STALE_MS,
          }
        : {
            reviewedBy: null,
            currentReviewerName: null,
            startedAt: null,
            lastActiveAt: null,
            isFinal: false,
            isStale: false,
            activeReviewStaleMs: ACTIVE_REVIEW_STALE_MS,
          },
      resume: {
        status: resumeStatus,
        url: resumeUrl,
        filename: application.resumeFilename ?? null,
      },
    };
  },
});

/** Helper mutation to create sample submitted applications for testing the review dashboard. Restricted to admins. */
export const createSampleApplication = mutation({
  args: {
    ...sessionTokenArgs,
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    school: v.string(),
    status: v.optional(
      v.union(
        v.literal("unreviewed"),
        v.literal("under_review"),
        v.literal("accepted"),
        v.literal("waitlisted"),
        v.literal("rejected"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdminRole(ctx, args.sessionToken);

    const now = Date.now();
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();

    const authUserId =
      user?._id ??
      (await ctx.db.insert("users", {
        name: `${args.firstName} ${args.lastName}`,
        email: args.email,
        emailVerificationTime: now,
      }));

    const existingApplication = await getApplicationByUser(ctx, authUserId);
    if (existingApplication && applicationFormWasSubmitted(existingApplication)) {
      throw adminError("APPLICANT_ALREADY_SUBMITTED");
    }

    const applicationId = await ctx.db.insert("applications", {
      authUserId,
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
      school: args.school,
      createdAt: now,
      applicantUpdatedAt: now,
      formSubmitted: true,
      submittedAt: now,
    });

    if (args.status && args.status !== "unreviewed") {
      await ctx.db.insert("applicationReviews", {
        applicationId,
        status: args.status,
        reviewedBy: admin._id,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { applicationId, ok: true };
  },
});
