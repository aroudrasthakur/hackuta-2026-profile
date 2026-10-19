import type { GenericId } from "convex/values";
import {
  isAllowedResumeFilename,
  MAX_RESUME_BYTES,
  RESUME_UPLOAD_EXPIRED_MESSAGE,
} from "../../shared/registration/resume";
import type { DraftPatchPayload } from "../../shared/registration/draftPatch";
import { findApplicationByResume } from "./applications";
import type { ApplicationDoc, MutationCtx } from "./dataModel";
import {
  isVerifiedUploadSessionValid,
  uploadSessionOwnedByUser,
} from "./resumeUpload";

type StorageId = GenericId<"_storage">;

const INVALID_RESUME_MESSAGE = "Please upload a valid PDF resume of 2 MB or smaller.";

/** Deletes a stored file, ignoring files that were already removed. */
export async function deleteStorageIfExists(ctx: MutationCtx, storageId: StorageId) {
  const metadata = await ctx.db.system.get("_storage", storageId);
  if (!metadata) return;
  await ctx.storage.delete(storageId);
}

export async function prepareResumeDraftPatch(
  ctx: MutationCtx,
  application: ApplicationDoc,
  patch: Pick<DraftPatchPayload, "resumeStorageId" | "resumeFilename">,
  authUserId: GenericId<"users">,
): Promise<{ deleteStorageId?: StorageId }> {
  if (!("resumeStorageId" in patch)) {
    return {};
  }

  if (patch.resumeStorageId === null) {
    return application.resumeStorageId
      ? { deleteStorageId: application.resumeStorageId }
      : {};
  }

  if (patch.resumeStorageId === undefined) {
    return {};
  }

  if (!isAllowedResumeFilename(patch.resumeFilename)) {
    throw new Error("Please select a PDF file.");
  }

  const nextStorageId = ctx.db.system.normalizeId("_storage", patch.resumeStorageId);
  if (!nextStorageId) {
    throw new Error(INVALID_RESUME_MESSAGE);
  }

  if (nextStorageId === application.resumeStorageId) {
    return {};
  }

  const metadata = await ctx.db.system.get("_storage", nextStorageId);
  if (
    !metadata ||
    metadata.contentType !== "application/pdf" ||
    metadata.size === 0 ||
    metadata.size > MAX_RESUME_BYTES
  ) {
    throw new Error(INVALID_RESUME_MESSAGE);
  }

  const attachment = await findApplicationByResume(ctx, nextStorageId);
  if (attachment) {
    throw new Error("This resume is already attached to another application.");
  }

  const session = await ctx.db
    .query("resumeUploadSessions")
    .withIndex("by_storage", (q) => q.eq("storageId", nextStorageId))
    .first();
  if (
    !uploadSessionOwnedByUser(session, authUserId) ||
    !isVerifiedUploadSessionValid(session, nextStorageId, Date.now())
  ) {
    throw new Error(RESUME_UPLOAD_EXPIRED_MESSAGE);
  }

  return application.resumeStorageId
    ? { deleteStorageId: application.resumeStorageId }
    : {};
}
