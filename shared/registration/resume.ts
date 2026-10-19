export const MAX_RESUME_BYTES = 2 * 1024 * 1024;
export const ALLOWED_RESUME_EXTENSIONS = [".pdf"] as const;
export const ALLOWED_RESUME_CONTENT_TYPE = "application/pdf";
export const RESUME_FILENAME_HEADER = "x-resume-filename";
export const RESUME_TEST_CONTENT_LENGTH_HEADER = "x-test-content-length";

export const RESUME_SIZE_ERROR_MESSAGE =
  "Your resume exceeds the 2 MB limit. Please upload a smaller PDF.";

export const RESUME_EMPTY_ERROR_MESSAGE =
  "Your PDF is empty. Please select another file.";

export const RESUME_UPLOAD_EXPIRED_MESSAGE =
  "Your resume upload expired. Please upload your resume again.";

export const RESUME_MISSING_MESSAGE =
  "We couldn't find your saved resume. Please upload it again.";

export const MAX_RESUME_FILENAME_LENGTH = 255;

function containsAsciiControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Resumes are stored in Convex file storage (_storage), not on the web server
 * filesystem, so uploaded bytes cannot be executed as application code.
 */
export function isAllowedResumeFilename(filename: string | null | undefined): boolean {
  if (!filename?.trim()) return false;

  const normalized = filename.trim().toLowerCase();
  if (normalized.length > MAX_RESUME_FILENAME_LENGTH) return false;
  if (
    normalized.includes("/") ||
    normalized.includes("\\") ||
    containsAsciiControlCharacters(normalized)
  ) {
    return false;
  }

  return ALLOWED_RESUME_EXTENSIONS.some(
    (extension) =>
      normalized.endsWith(extension) && normalized.length > extension.length,
  );
}

export type ParsedResumeContentLength =
  | { ok: true; length: number }
  | { ok: false; reason: "missing" | "invalid" | "empty" | "too_large" };

export function parseResumeContentLength(raw: string | null): ParsedResumeContentLength {
  if (raw === null) return { ok: false, reason: "missing" };

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return { ok: false, reason: "invalid" };

  const length = Number(trimmed);
  if (!Number.isSafeInteger(length)) return { ok: false, reason: "invalid" };
  if (length === 0) return { ok: false, reason: "empty" };
  if (length > MAX_RESUME_BYTES) return { ok: false, reason: "too_large" };

  return { ok: true, length };
}

/**
 * Lightweight client-side checks for immediate UX feedback only.
 * The upload endpoint stores bytes as-is in Convex file storage; registration
 * mutations verify storage metadata and a server-issued upload token.
 */
export function validateResume(file: Pick<File, "name" | "type" | "size">): string | undefined {
  if (!isAllowedResumeFilename(file.name) || (file.type && file.type !== ALLOWED_RESUME_CONTENT_TYPE)) {
    return "Please select a PDF file.";
  }
  if (file.size === 0) return RESUME_EMPTY_ERROR_MESSAGE;
  if (file.size > MAX_RESUME_BYTES) return RESUME_SIZE_ERROR_MESSAGE;
}

export function resumeFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}
