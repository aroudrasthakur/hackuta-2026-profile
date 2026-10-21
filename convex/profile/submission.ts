import { query } from "../_generated/server";
import { applicationFormWasSubmitted, getAuthUser } from "../lib/applications";
import { resolveApplicationForAuthUser } from "./applicationLookup";
import { buildSubmittedApplicationPayload, normalizeApplicantEmail } from "./submissionPayload";

/** Applicant's own submitted application (read-only). */
export const getMySubmittedApplication = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;

    const application = await resolveApplicationForAuthUser(ctx, user);
    if (!application || !applicationFormWasSubmitted(application)) {
      return null;
    }

    return buildSubmittedApplicationPayload(
      ctx,
      application,
      normalizeApplicantEmail(user.email),
    );
  },
});
