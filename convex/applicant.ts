/**
 * Applicant bootstrap and routing state.
 *
 * Owns application row creation after sign-in and lightweight routing queries used
 * by route guards. Draft fields and dashboard payloads live in applications.ts.
 */
import { mutation, query } from "./_generated/server";
import {
  applicationFormWasSubmitted,
  ensureDraftApplication,
  getApplicationByUser,
  getApplicationStatus,
  getAuthUser,
} from "./lib/applications";
import { normalizeEmail } from "./lib/normalizeEmail";

export const ensureApplicantApplication = mutation({
  args: {},
  handler: async (ctx) => {
    const application = await ensureDraftApplication(ctx);
    return { applicationId: application._id, status: await getApplicationStatus(ctx, application) };
  },
});

export const getApplicantRoutingState = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await getAuthUser(ctx);
    if (!authUser) {
      return {
        authenticated: false as const,
        verifiedEmail: null,
        hasSubmittedRegistration: false,
      };
    }

    const application = await getApplicationByUser(ctx, authUser._id);
    const hasSubmittedRegistration =
      application !== null && applicationFormWasSubmitted(application);

    return {
      authenticated: true as const,
      verifiedEmail: normalizeEmail(authUser.email),
      hasSubmittedRegistration,
    };
  },
});
