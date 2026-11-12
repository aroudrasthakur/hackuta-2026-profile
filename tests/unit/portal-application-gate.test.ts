import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isPortalApplicationRequiredState,
  PORTAL_APPLICATION_REQUIRED_LINK_LABEL,
  PORTAL_APPLICATION_REQUIRED_LOCATION_STATE,
  PORTAL_APPLICATION_REQUIRED_MESSAGE,
} from "../../src/constants/authMessages";

const here = dirname(fileURLToPath(import.meta.url));

describe("portal application-required copy", () => {
  it("uses the locked Hacker Portal wording", () => {
    expect(PORTAL_APPLICATION_REQUIRED_MESSAGE).toBe(
      "Access to the Hacker Portal is available after you complete and submit your HackUTA application. Please finish your application, then return here to sign in.",
    );
    expect(PORTAL_APPLICATION_REQUIRED_LINK_LABEL).toBe("Complete your application");
    expect(PORTAL_APPLICATION_REQUIRED_LOCATION_STATE).toEqual({ applicationRequired: true });
  });

  it("recognizes the sign-in location state flag", () => {
    expect(isPortalApplicationRequiredState({ applicationRequired: true })).toBe(true);
    expect(isPortalApplicationRequiredState({ from: "/dashboard" })).toBe(false);
    expect(isPortalApplicationRequiredState(null)).toBe(false);
  });
});

describe("portal sign-in path", () => {
  it("does not call ensureApplicantApplication from SignInPage", () => {
    const source = readFileSync(join(here, "../../src/pages/SignIn/SignInPage.tsx"), "utf8");
    expect(source).not.toContain("ensureApplicantApplication");
    expect(source).not.toContain("ensureApplication");
    expect(source).toContain("PORTAL_APPLICATION_REQUIRED_MESSAGE");
  });
});
