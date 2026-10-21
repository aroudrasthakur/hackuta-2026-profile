function extensionFromBasename(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const withoutQuery = trimmed.split(/[?#]/)[0]?.trim() ?? "";
  const dot = withoutQuery.lastIndexOf(".");
  if (dot === -1 || dot === withoutQuery.length - 1) return null;
  return withoutQuery.slice(dot + 1).toLowerCase();
}

function basenameFromUrl(url: string): string | null {
  try {
    const segment = new URL(url).pathname.split("/").pop();
    if (!segment) return null;
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function isUnsupportedNonPdfResume(filename?: string | null, url?: string | null): boolean {
  const ext =
    extensionFromBasename(filename ?? "") ?? extensionFromBasename(basenameFromUrl(url ?? "") ?? "");
  if (ext === null) return false;
  return ext !== "pdf";
}
