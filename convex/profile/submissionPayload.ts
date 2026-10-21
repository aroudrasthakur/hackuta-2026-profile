import type { QueryCtx } from "../_generated/server";
import type { ApplicationDoc } from "../lib/dataModel";
import { normalizeEmail } from "../lib/normalizeEmail";
import { buildSubmissionSections } from "../../shared/registration/submissionDisplay";

export type SubmittedApplicationPayload = {
  submittedAt: number | null;
  sections: Array<{ title: string; rows: Array<{ label: string; value: string }> }>;
  resume: {
    status: "none" | "available" | "missing";
    url: string | null;
    filename: string | null;
  };
};

export async function buildSubmittedApplicationPayload(
  ctx: QueryCtx,
  application: ApplicationDoc,
  verifiedEmail: string | null,
): Promise<SubmittedApplicationPayload> {
  const resumeUrl = application.resumeStorageId
    ? await ctx.storage.getUrl(application.resumeStorageId)
    : null;
  const resumeStatus: "none" | "available" | "missing" = !application.resumeStorageId
    ? "none"
    : resumeUrl
      ? "available"
      : "missing";

  const displayEmail = verifiedEmail ?? normalizeEmail(application.email) ?? null;

  return {
    submittedAt: application.submittedAt ?? null,
    sections: buildSubmissionSections(application, displayEmail),
    resume: {
      status: resumeStatus,
      url: resumeUrl,
      filename: application.resumeFilename ?? null,
    },
  };
}

export function normalizeApplicantEmail(email: string | undefined): string | null {
  return normalizeEmail(email) ?? null;
}
