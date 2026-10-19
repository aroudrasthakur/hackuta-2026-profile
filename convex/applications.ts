/**
 * Applicant drafts and dashboard data.
 *
 * Owns draft load/save and the profile page payload. Application bootstrap and
 * routing state live in applicant.ts.
 */
import { mutation, query } from "./_generated/server";
import { resolveHackathonTimelineSource } from "../shared/hackathon/schedule";
import { DEFAULT_HACKATHON_NAME } from "../shared/hackathon/eventDefaults";
import { assertRegistrationOpen, getEventConfigRow } from "./lib/eventConfig";
import { buildHackathonTimeline } from "../shared/hackathon/timeline";
import { applicationDraftPatch } from "./applicationFields";
import { requireAuthIdentity } from "./lib/auth";
import {
  ensureDraftApplication,
  formatApplicantFullName,
  getAuthUser,
  getApplicationByUser,
  getApplicationStatus,
  applicationFormWasSubmitted,
  projectApplicantAnswers,
  syncAuthUserNameFromApplication,
} from "./lib/applications";
import { replaceApplicationWithDraftPatch } from "./lib/draftPatch";
import { normalizeEmail } from "./lib/normalizeEmail";
import {
  isClearedDraftValue,
  type DraftPatchPayload,
} from "../shared/registration/draftPatch";
import { validateDraftPatchLimits } from "../shared/registration/draftLimits";
import { stripAgreementTimestamps } from "../shared/registration/consentTimestamps";
import {
  applicationToDraftForm,
  savedResumeFromStoredApplication,
} from "../shared/registration/draftMapping";
export const getMyApplicationDraft = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const application = await getApplicationByUser(ctx, authUser._id);
    if (!application) return null;
    const status = await getApplicationStatus(ctx, application);
    if (status !== "draft") {
      return { status, draft: null };
    }

    const storedResume = savedResumeFromStoredApplication(application);
    const resumeFileExists =
      storedResume !== null &&
      application.resumeStorageId !== undefined &&
      (await ctx.db.system.get("_storage", application.resumeStorageId)) !== null;

    return {
      status,
      draft: applicationToDraftForm(application),
      savedResume: resumeFileExists ? storedResume : null,
      resumeMissing: storedResume !== null && !resumeFileExists,
      updatedAt: application.applicantUpdatedAt ?? application.createdAt,
    };
  },
});

export const saveApplicationDraft = mutation({
  args: {
    patch: applicationDraftPatch,
  },
  handler: async (ctx, { patch }) => {
    const application = await ensureDraftApplication(ctx);
    await assertRegistrationOpen(ctx);
    if (applicationFormWasSubmitted(application) ||
      (await getApplicationStatus(ctx, application)) !== "draft") {
      throw new Error("Your application has already been submitted.");
    }

    const normalizedPatch = stripAgreementTimestamps(patch);
    const draftPatch = validateDraftPatchLimits(
      normalizedPatch as Record<string, unknown>,
    ) as DraftPatchPayload;

    const authUser = await getAuthUser(ctx);
    const email = normalizeEmail(authUser?.email) ?? application.email;
    const updatedAt = Date.now();

    await replaceApplicationWithDraftPatch(
      ctx,
      application,
      draftPatch,
      {
        email,
        emailVerificationTime:
          authUser?.emailVerificationTime ?? application.emailVerificationTime,
        applicantUpdatedAt: updatedAt,
      },
    );

    if (authUser) {
      await syncAuthUserNameFromApplication(ctx, authUser._id, {
        firstName: isClearedDraftValue(draftPatch.firstName)
          ? null
          : draftPatch.firstName,
        lastName: isClearedDraftValue(draftPatch.lastName)
          ? null
          : draftPatch.lastName,
      });
    }

    return { ok: true as const, updatedAt };
  },
});

export const getMyApplicantDashboard = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuthIdentity(ctx);

    const authUser = await getAuthUser(ctx);
    const application = authUser ? await getApplicationByUser(ctx, authUser._id) : null;
    const status = application ? await getApplicationStatus(ctx, application) : null;

    const resumeStatus: "none" | "attached" = application?.resumeStorageId ? "attached" : "none";
    const applicantAnswers = application ? projectApplicantAnswers(application) : null;
    const eventConfig = await getEventConfigRow(ctx);
    const timelineSource = resolveHackathonTimelineSource(eventConfig);
    const timeline = buildHackathonTimeline(timelineSource);
    const hackathonName = eventConfig?.name ?? DEFAULT_HACKATHON_NAME;

    const displayName =
      (application ? formatApplicantFullName(application) : null) ??
      authUser?.name ??
      identity.name ??
      null;

    return {
      profile: {
        displayName,
        verifiedEmail: normalizeEmail(authUser?.email ?? identity.email) ?? null,
      },
      registration: application
        ? {
            id: application._id,
            status,
            submittedAt: application.submittedAt ?? null,
            updatedAt: application.applicantUpdatedAt ?? application.createdAt,
            answers: applicantAnswers,
            resumeStatus,
          }
        : null,
      timeline,
      hackathon: {
        name: hackathonName,
        startsAt: timelineSource.startsAt,
        endsAt: timelineSource.endsAt,
        registrationOpensAt: timelineSource.registrationOpensAt,
        registrationClosesAt: timelineSource.registrationClosesAt,
        decisionsReleasedAt: timelineSource.decisionsReleasedAt ?? null,
      },
    };
  },
});
