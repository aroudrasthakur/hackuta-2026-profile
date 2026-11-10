import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../../security/csp";
import { permissionsPolicy, referrerPolicy } from "../../security/headers";
import vercelConfig from "../../vercel.json" with { type: "json" };

function deployedHeader(key: string) {
  return vercelConfig.headers
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === key)?.value;
}

describe("contentSecurityPolicy", () => {
  it("allows Convex endpoints required by the participant portal", () => {
    expect(contentSecurityPolicy).toContain("https://*.convex.cloud");
    expect(contentSecurityPolicy).toContain("https://*.convex.site");
    expect(contentSecurityPolicy).toContain("require-trusted-types-for 'script'");
  });
});

describe("response security headers", () => {
  it("keeps vercel.json aligned with the shared header definitions", () => {
    expect(deployedHeader("Content-Security-Policy")).toBe(contentSecurityPolicy);
    expect(deployedHeader("Permissions-Policy")).toBe(permissionsPolicy);
    expect(deployedHeader("Referrer-Policy")).toBe(referrerPolicy);
  });
});
