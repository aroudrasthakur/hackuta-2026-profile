import type { GenericId } from "convex/values";
import type { AuthCtx } from "./auth";
import type { ResumeUploadSessionDoc } from "./dataModel";

export const RESUME_UPLOAD_EXPIRY_MS = 30 * 60 * 1000;

type UploadSession = ResumeUploadSessionDoc;

export function uploadSessionOwnedByUser(
  session: UploadSession | null,
  authUserId: GenericId<"users">,
): session is UploadSession {
  return !!session && session.authUserId === authUserId;
}

export function isVerifiedUploadSessionValid(
  session: UploadSession | null,
  storageId: GenericId<"_storage">,
  now: number,
): session is UploadSession & { storageId: GenericId<"_storage">; verifiedAt: number } {
  return !!(
    session &&
    !session.consumedAt &&
    session.storageId === storageId &&
    session.verifiedAt &&
    session.createdAt >= now - RESUME_UPLOAD_EXPIRY_MS
  );
}

export async function findUploadSessionByToken(
  ctx: AuthCtx,
  uploadToken: string,
): Promise<ResumeUploadSessionDoc | null> {
  return ctx.db
    .query("resumeUploadSessions")
    .withIndex("by_token", (q) => q.eq("token", uploadToken))
    .first();
}
