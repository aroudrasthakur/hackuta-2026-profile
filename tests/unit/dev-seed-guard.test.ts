import { describe, expect, it } from "vitest";
import { isSharedDevSeedDeployment } from "../../convex/profile/devSeedGuard";

describe("isSharedDevSeedDeployment", () => {
  it("allows only the shared dev deployment slug", () => {
    expect(isSharedDevSeedDeployment("https://standing-manatee-425.convex.cloud")).toBe(true);
  });

  it("rejects production, local, and empty Cloud URLs", () => {
    expect(isSharedDevSeedDeployment("https://prod-deployment.convex.cloud")).toBe(false);
    expect(isSharedDevSeedDeployment("http://127.0.0.1:3210")).toBe(false);
    expect(isSharedDevSeedDeployment("http://localhost:3210")).toBe(false);
    expect(isSharedDevSeedDeployment("")).toBe(false);
    expect(isSharedDevSeedDeployment(undefined)).toBe(false);
  });
});
