import { makeFunctionReference } from "convex/server";
import type { RegistrationPayload } from "../../../shared/registration/types";
import {
  RESUME_FILENAME_HEADER,
  validateResume,
} from "../../../shared/registration/resume";
import {
  mapConvexErrorToUserMessage,
  mapResumeUploadHttpError,
  RESUME_UPLOAD_AUTH_REQUIRED_MESSAGE,
  RESUME_UPLOAD_ERROR_MESSAGE,
  SUBMIT_ERROR_MESSAGE,
} from "../../../shared/registration/submitErrors";
import { getConvexClient, normalizeConvexUrl } from "../../convex/client";
import { isMockApiEnabled } from "../../constants/mockAuth";

const USE_MOCK_API = isMockApiEnabled();

function getConvexSiteUrl() {
  const derivedSiteUrl = normalizeConvexUrl(import.meta.env.VITE_CONVEX_URL)
    ?.replace(".convex.cloud", ".convex.site");
  if (USE_MOCK_API) {
    return derivedSiteUrl;
  }
  return normalizeConvexUrl(import.meta.env.VITE_CONVEX_SITE_URL) || derivedSiteUrl;
}

const submitRegistrationRef = makeFunctionReference<"mutation">(
  "registrations:submitRegistration",
);
const discardUploadSessionRef = makeFunctionReference<"mutation">("resumeUploads:discardUploadSession");

export type ResumeUploadSession = {
  storageId: string;
  uploadToken: string;
};

async function callConvexMutation<T>(
  mutation: typeof submitRegistrationRef | typeof discardUploadSessionRef,
  args: Record<string, unknown>,
): Promise<T> {
  if (USE_MOCK_API) {
    return { ok: true } as T;
  }

  const client = getConvexClient();
  if (!client) {
    throw new Error(SUBMIT_ERROR_MESSAGE);
  }

  try {
    return await client.mutation(mutation, args) as T;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error("Convex mutation failed:", error);
    }
    const mapped = mapConvexErrorToUserMessage(error);
    throw new Error(mapped, { cause: error });
  }
}

export async function uploadResume(
  file: File,
  authToken: string | null | undefined,
): Promise<ResumeUploadSession> {
  const error = validateResume(file);
  if (error) throw new Error(error);

  if (USE_MOCK_API) {
    return { storageId: "mock-resume-id", uploadToken: "mock-upload-token" };
  }

  if (!authToken) {
    throw new Error(RESUME_UPLOAD_AUTH_REQUIRED_MESSAGE);
  }

  const convexSiteUrl = getConvexSiteUrl();
  if (!convexSiteUrl) throw new Error(RESUME_UPLOAD_ERROR_MESSAGE);

  let response: Response;
  try {
    response = await fetch(`${convexSiteUrl}/resume-upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/pdf",
        [RESUME_FILENAME_HEADER]: file.name,
      },
      body: file,
    });
  } catch {
    throw new Error(
      "We couldn't upload your resume. Check your connection and try again.",
    );
  }

  const data = await response.json().catch(() => ({}));
  if (
    !response.ok ||
    typeof data.storageId !== "string" ||
    !data.storageId ||
    typeof data.uploadToken !== "string" ||
    !data.uploadToken
  ) {
    throw new Error(mapResumeUploadHttpError(response.status, data));
  }

  return { storageId: data.storageId, uploadToken: data.uploadToken };
}

export async function discardResumeUpload(uploadToken: string) {
  if (USE_MOCK_API) {
    return;
  }

  const client = getConvexClient();
  if (!client) return;
  await client.mutation(discardUploadSessionRef, { uploadToken }).catch(() => undefined);
}

export async function submitRegistration(
  payload: RegistrationPayload,
  resumeSession: ResumeUploadSession | null = null,
) {
  return callConvexMutation<{ ok: true }>(submitRegistrationRef, {
    data: resumeSession ? { ...payload, resumeStorageId: resumeSession.storageId } : payload,
    ...(resumeSession ? { resumeUploadToken: resumeSession.uploadToken } : {}),
  });
}
