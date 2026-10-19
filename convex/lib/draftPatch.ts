import { applyAgreementTimestampUpdates } from "../../shared/registration/consentTimestamps";
import {
  mergeDraftPatchIntoApplication,
  type DraftPatchPayload,
} from "../../shared/registration/draftPatch";
import { requireAuthUser } from "./applications";
import type { ApplicationDoc, MutationCtx } from "./dataModel";
import { deleteStorageIfExists, prepareResumeDraftPatch } from "./draftResume";

export { mergeDraftPatchIntoApplication };

export async function replaceApplicationWithDraftPatch(
  ctx: MutationCtx,
  application: ApplicationDoc,
  patch: DraftPatchPayload,
  meta: {
    email: string;
    emailVerificationTime?: number;
    applicantUpdatedAt: number;
  },
) {
  const authUser = await requireAuthUser(ctx);
  const resumeCleanup = await prepareResumeDraftPatch(ctx, application, patch, authUser._id);

  const replacement = mergeDraftPatchIntoApplication(application, patch, meta);
  applyAgreementTimestampUpdates(replacement, application, patch, meta.applicantUpdatedAt);
  await ctx.db.replace(application._id, replacement);

  if (resumeCleanup.deleteStorageId) {
    await deleteStorageIfExists(ctx, resumeCleanup.deleteStorageId);
  }
}
