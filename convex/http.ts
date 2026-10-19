import { httpRouter, makeFunctionReference } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import {
  ALLOWED_RESUME_CONTENT_TYPE,
  isAllowedResumeFilename,
  MAX_RESUME_BYTES,
  parseResumeContentLength,
  RESUME_FILENAME_HEADER,
  RESUME_EMPTY_ERROR_MESSAGE,
  RESUME_SIZE_ERROR_MESSAGE,
  RESUME_TEST_CONTENT_LENGTH_HEADER,
} from "../shared/registration/resume";
import { requireAuthUserId } from "./lib/auth";
import { getResumeUploadAllowedOrigins, isOriginAllowed } from "./resumeUploadSecurity";
import { RESUME_UPLOAD_AUTH_REQUIRED_MESSAGE } from "../shared/registration/submitErrors";

const http = httpRouter();
auth.addHttpRoutes(http);

const assertUploadRateLimitRef = makeFunctionReference<"mutation">(
  "resumeUploads:assertUploadRateLimit",
);
const createVerifiedUploadSessionRef = makeFunctionReference<"mutation">(
  "resumeUploads:createVerifiedUploadSession",
);
const CONVEX_TEST_ORIGIN = "https://hackuta.test";

function requestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    return origin;
  }
  const isTestMode =
    process.env.CONVEX_TEST_MODE === "true" || process.env.VITEST === "true";
  if (isTestMode) {
    return request.headers.get("x-test-origin");
  }
  return null;
}

function allowedOrigin(request: Request): string | undefined {
  const origin = requestOrigin(request);
  const allowed = getResumeUploadAllowedOrigins();
  if (allowed.length > 0) {
    return isOriginAllowed(origin, allowed) ? origin : undefined;
  }
  return origin === CONVEX_TEST_ORIGIN ? origin : undefined;
}

function response(request: Request, body: unknown, status: number, origin?: string) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

async function requestRateKey(address: string | null) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(address ?? "unknown-client"),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createCapabilityToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function clientAddress(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
) {
  try {
    const { ip } = await ctx.meta.getRequestMetadata();
    if (ip) return ip;
  } catch {
    // Older local test backends do not expose request metadata.
  }
  return null;
}

async function readBodyWithLimit(request: Request, maxBytes: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) {
    throw new Error("Missing request body.");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(RESUME_SIZE_ERROR_MESSAGE);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const uploadResume = httpAction(async (ctx, request) => {
  const origin = allowedOrigin(request);
  if (!origin) {
    return response(request, { error: "Origin is not allowed." }, 403);
  }

  let authUserId;
  try {
    authUserId = await requireAuthUserId(ctx);
  } catch {
    return response(
      request,
      { error: RESUME_UPLOAD_AUTH_REQUIRED_MESSAGE },
      401,
      origin,
    );
  }

  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
    ALLOWED_RESUME_CONTENT_TYPE
  ) {
    return response(request, { error: "Please upload a PDF." }, 415, origin);
  }

  const isTestRequest =
    (process.env.CONVEX_TEST_MODE === "true" || process.env.VITEST === "true") &&
    request.headers.get("x-test-origin") === CONVEX_TEST_ORIGIN;
  let contentLength = parseResumeContentLength(request.headers.get("content-length"));
  if (
    !contentLength.ok &&
    contentLength.reason === "missing" &&
    isTestRequest
  ) {
    contentLength = parseResumeContentLength(
      request.headers.get(RESUME_TEST_CONTENT_LENGTH_HEADER),
    );
  }
  if (!contentLength.ok) {
    if (contentLength.reason === "missing") {
      return response(
        request,
        { error: "Content-Length header is required." },
        411,
        origin,
      );
    }
    if (contentLength.reason === "too_large") {
      return response(request, { error: RESUME_SIZE_ERROR_MESSAGE }, 413, origin);
    }
    if (contentLength.reason === "empty") {
      return response(request, { error: RESUME_EMPTY_ERROR_MESSAGE }, 413, origin);
    }
    return response(request, { error: "Invalid upload request." }, 400, origin);
  }

  const resumeFilename = request.headers.get(RESUME_FILENAME_HEADER);
  if (!isAllowedResumeFilename(resumeFilename)) {
    return response(request, { error: "Please upload a PDF file." }, 415, origin);
  }

  try {
    await ctx.runMutation(assertUploadRateLimitRef, {
      requestKey: await requestRateKey(await clientAddress(ctx)),
      authUserId,
    });
  } catch {
    return response(request, { error: "Too many uploads. Please try again later." }, 429, origin);
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithLimit(request, MAX_RESUME_BYTES);
  } catch (error) {
    const message = error instanceof Error ? error.message : RESUME_SIZE_ERROR_MESSAGE;
    return response(request, { error: message }, 413, origin);
  }

  if (bytes.length !== contentLength.length || bytes.length > MAX_RESUME_BYTES) {
    return response(request, { error: RESUME_SIZE_ERROR_MESSAGE }, 413, origin);
  }

  let storageId;
  try {
    storageId = await ctx.storage.store(
      new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }),
    );
    const uploadToken = createCapabilityToken();
    await ctx.runMutation(createVerifiedUploadSessionRef, {
      uploadToken,
      storageId,
      authUserId,
    });
    return response(request, { storageId, uploadToken }, 201, origin);
  } catch {
    if (storageId) await ctx.storage.delete(storageId);
    return response(request, { error: "The resume could not be stored." }, 500, origin);
  }
});

http.route({ path: "/resume-upload", method: "POST", handler: uploadResume });
http.route({
  path: "/resume-upload",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    const origin = allowedOrigin(request);
    if (!origin) return response(request, { error: "Origin is not allowed." }, 403);
    const result = response(request, null, 204, origin);
    result.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    result.headers.set(
      "Access-Control-Allow-Headers",
      `Content-Type, Authorization, ${RESUME_FILENAME_HEADER}`,
    );
    result.headers.set("Access-Control-Max-Age", "600");
    return result;
  }),
});

export default http;
