/** Local Vite dev server origins — allowed only when REGISTRATION_ALLOW_LOCAL_DEV_ORIGINS is set. */
export const LOCAL_RESUME_UPLOAD_DEV_ORIGINS = [
  "http://127.0.0.1:5273",
  "http://localhost:5273",
] as const;

function isLocalDevOriginsEnabled(): boolean {
  const value = process.env.REGISTRATION_ALLOW_LOCAL_DEV_ORIGINS?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function isLocalResumeUploadDevOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function addOriginIfAllowed(origins: Set<string>, origin: string) {
  if (isLocalResumeUploadDevOrigin(origin) && !isLocalDevOriginsEnabled()) {
    return;
  }
  origins.add(origin);
}

function localDevOriginVariants(siteUrl: string): string[] {
  try {
    const url = new URL(siteUrl);
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      return [url.origin];
    }

    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    const withPort = (host: string) => `${url.protocol}//${host}${port ? `:${port}` : ""}`;

    return Array.from(
      new Set([url.origin, withPort("localhost"), withPort("127.0.0.1")]),
    );
  } catch {
    return [];
  }
}

export function getResumeUploadAllowedOrigins(): string[] {
  const origins = new Set<string>();

  if (isLocalDevOriginsEnabled()) {
    for (const origin of LOCAL_RESUME_UPLOAD_DEV_ORIGINS) {
      origins.add(origin);
    }
  }

  for (const origin of (process.env.REGISTRATION_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    addOriginIfAllowed(origins, origin);
  }

  const siteUrl = process.env.SITE_URL?.trim();
  if (siteUrl) {
    for (const origin of localDevOriginVariants(siteUrl)) {
      addOriginIfAllowed(origins, origin);
    }
  }

  return Array.from(origins);
}

export function isOriginAllowed(origin: string | null, allowed: string[]): origin is string {
  if (allowed.length === 0 || !origin) return false;
  return allowed.includes(origin);
}
