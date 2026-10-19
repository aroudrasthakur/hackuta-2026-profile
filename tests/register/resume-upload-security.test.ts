import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getResumeUploadAllowedOrigins,
  isOriginAllowed,
} from "../../convex/resumeUploadSecurity";

describe("resumeUploadSecurity", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows local registration dev origins only when explicitly enabled", () => {
    vi.stubEnv("REGISTRATION_ALLOW_LOCAL_DEV_ORIGINS", "true");
    vi.stubEnv("REGISTRATION_ALLOWED_ORIGINS", "");
    vi.stubEnv("SITE_URL", "");
    const allowed = getResumeUploadAllowedOrigins();
    expect(allowed).toEqual([
      "http://127.0.0.1:5273",
      "http://localhost:5273",
    ]);
    expect(isOriginAllowed("http://localhost:5273", allowed)).toBe(true);
    expect(isOriginAllowed("https://hackuta.org", allowed)).toBe(false);
    expect(isOriginAllowed(null, allowed)).toBe(false);
  });

  it("excludes local dev origins from production configuration", () => {
    vi.stubEnv("REGISTRATION_ALLOW_LOCAL_DEV_ORIGINS", "");
    vi.stubEnv("REGISTRATION_ALLOWED_ORIGINS", "https://register.hackuta.com");
    vi.stubEnv("SITE_URL", "https://register.hackuta.com");
    const allowed = getResumeUploadAllowedOrigins();
    expect(allowed).toEqual(["https://register.hackuta.com"]);
    expect(isOriginAllowed("http://localhost:5273", allowed)).toBe(false);
    expect(isOriginAllowed("https://register.hackuta.com", allowed)).toBe(true);
  });

  it("ignores localhost entries on production even when misconfigured", () => {
    vi.stubEnv("REGISTRATION_ALLOW_LOCAL_DEV_ORIGINS", "");
    vi.stubEnv(
      "REGISTRATION_ALLOWED_ORIGINS",
      "https://register.hackuta.com,http://localhost:5273",
    );
    vi.stubEnv("SITE_URL", "http://127.0.0.1:5273");
    const allowed = getResumeUploadAllowedOrigins();
    expect(allowed).toEqual(["https://register.hackuta.com"]);
    expect(isOriginAllowed("http://localhost:5273", allowed)).toBe(false);
  });

  it("includes local dev origin variants from SITE_URL when local dev is enabled", () => {
    vi.stubEnv("REGISTRATION_ALLOW_LOCAL_DEV_ORIGINS", "true");
    vi.stubEnv("REGISTRATION_ALLOWED_ORIGINS", "");
    vi.stubEnv("SITE_URL", "http://127.0.0.1:5273");
    const allowed = getResumeUploadAllowedOrigins();
    expect(allowed).toEqual([
      "http://127.0.0.1:5273",
      "http://localhost:5273",
    ]);
    expect(isOriginAllowed("http://localhost:5273", allowed)).toBe(true);
  });

  it("accepts configured production origins alongside local dev when enabled", () => {
    vi.stubEnv("REGISTRATION_ALLOW_LOCAL_DEV_ORIGINS", "true");
    vi.stubEnv("REGISTRATION_ALLOWED_ORIGINS", "https://hackuta.org, https://www.hackuta.org");
    vi.stubEnv("SITE_URL", "");
    const allowed = getResumeUploadAllowedOrigins();
    expect(allowed).toEqual([
      "http://127.0.0.1:5273",
      "http://localhost:5273",
      "https://hackuta.org",
      "https://www.hackuta.org",
    ]);
    expect(isOriginAllowed("https://hackuta.org", allowed)).toBe(true);
    expect(isOriginAllowed("https://evil.example", allowed)).toBe(false);
  });

  it.each(["1", "YES", " True "])("treats %j as enabling local dev origins", (flag) => {
    vi.stubEnv("REGISTRATION_ALLOW_LOCAL_DEV_ORIGINS", flag);
    vi.stubEnv("REGISTRATION_ALLOWED_ORIGINS", "");
    vi.stubEnv("SITE_URL", "");
    expect(getResumeUploadAllowedOrigins()).toContain("http://localhost:5273");
  });

  it("fails closed when nothing is configured", () => {
    vi.stubEnv("REGISTRATION_ALLOW_LOCAL_DEV_ORIGINS", "no");
    delete process.env.REGISTRATION_ALLOWED_ORIGINS;
    vi.stubEnv("SITE_URL", "");
    const allowed = getResumeUploadAllowedOrigins();
    expect(allowed).toEqual([]);
    expect(isOriginAllowed("https://hackuta.test", allowed)).toBe(false);
  });

  it("keeps non-URL allow-list entries verbatim instead of treating them as local", () => {
    vi.stubEnv("REGISTRATION_ALLOW_LOCAL_DEV_ORIGINS", "");
    vi.stubEnv("REGISTRATION_ALLOWED_ORIGINS", "not a url");
    vi.stubEnv("SITE_URL", "");
    expect(getResumeUploadAllowedOrigins()).toEqual(["not a url"]);
  });

  it("ignores an unparseable SITE_URL", () => {
    vi.stubEnv("REGISTRATION_ALLOW_LOCAL_DEV_ORIGINS", "");
    vi.stubEnv("REGISTRATION_ALLOWED_ORIGINS", "");
    vi.stubEnv("SITE_URL", "::::");
    expect(getResumeUploadAllowedOrigins()).toEqual([]);
  });

  it("derives default ports for local SITE_URL values without an explicit port", () => {
    vi.stubEnv("REGISTRATION_ALLOW_LOCAL_DEV_ORIGINS", "true");
    vi.stubEnv("REGISTRATION_ALLOWED_ORIGINS", "");
    vi.stubEnv("SITE_URL", "http://localhost");
    expect(getResumeUploadAllowedOrigins()).toEqual(
      expect.arrayContaining(["http://localhost", "http://localhost:80", "http://127.0.0.1:80"]),
    );

    vi.stubEnv("SITE_URL", "https://127.0.0.1");
    expect(getResumeUploadAllowedOrigins()).toEqual(
      expect.arrayContaining(["https://127.0.0.1", "https://localhost:443"]),
    );
  });
});
