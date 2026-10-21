import { query } from "../_generated/server";
import { applicationFormWasSubmitted, getAuthUser } from "../lib/applications";
import { normalizeEmail } from "../lib/normalizeEmail";
import { buildSubmissionSections } from "../../shared/registration/submissionDisplay";

/** Applicant's own submitted application (read-only). */
export const getMySubmittedApplication = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;

    const application = await ctx.db
      .query("applications")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", user._id))
      .unique();

    if (!application || !applicationFormWasSubmitted(application)) {
      return null;
    }

    const resumeUrl = application.resumeStorageId
      ? await ctx.storage.getUrl(application.resumeStorageId)
      : null;
    const resumeStatus: "none" | "available" | "missing" = !application.resumeStorageId
      ? "none"
      : resumeUrl
        ? "available"
        : "missing";

    return {
      submittedAt: application.submittedAt ?? null,
      sections: buildSubmissionSections(application, normalizeEmail(user.email) ?? null),
      resume: {
        status: resumeStatus,
        url: resumeUrl,
        filename: application.resumeFilename ?? null,
      },
    };
  },
});
