import { describe, expect, it } from "vitest";
import { APPLICANT_DRAFT_PATCH_FIELD_KEYS } from "../../convex/applicationFields";
import { APPLICANT_ANSWER_FIELD_KEYS, PLAIN_STRING_FIELDS } from "../../shared/registration/applicantFields";
import { EXPERIENCE_LEVELS } from "../../shared/registration/constants";
import {
  applicationToDraftForm,
  formToDraftPatch,
  mergeDraftPatchIntoApplication,
} from "../../shared/registration/draftMapping";
import {
  validateApplicationForm,
  validateRegistrationPayload,
} from "../../shared/registration/validation";
import { INITIAL_FORM } from "../../shared/registration/types";
import {
  validRegistrationForm,
  validRegistrationPayload,
} from "../fixtures/validRegistrationForm";

describe("experienceLevel field", () => {
  it("registers experienceLevel as a plain string select field", () => {
    expect(PLAIN_STRING_FIELDS).toContain("experienceLevel");
    expect(APPLICANT_ANSWER_FIELD_KEYS).toContain("experienceLevel");
    expect(APPLICANT_DRAFT_PATCH_FIELD_KEYS).toContain("experienceLevel");
    expect(EXPERIENCE_LEVELS).toEqual([
      "Beginner",
      "Intermediate",
      "Advanced",
      "Expert",
    ]);
  });

  it("requires one of the configured experience levels on submit", () => {
    const missing = validateApplicationForm({
      ...validRegistrationForm(),
      experienceLevel: "",
    });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.errors.experienceLevel).toBe("Please select your experience level.");
    }

    const invalid = validateApplicationForm({
      ...validRegistrationForm(),
      experienceLevel: "Novice" as never,
    });
    expect(invalid.success).toBe(false);
  });

  it.each(EXPERIENCE_LEVELS)("accepts %s as a valid experience level", (level) => {
    const result = validateApplicationForm({
      ...validRegistrationForm(),
      experienceLevel: level,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.experienceLevel).toBe(level);
    }
  });

  it("round-trips experienceLevel through draft autosave mapping", () => {
    const form = { ...validRegistrationForm(), experienceLevel: "Advanced" as const };
    const patch = formToDraftPatch(form);
    expect(patch.experienceLevel).toBe("Advanced");

    const merged = mergeDraftPatchIntoApplication(
      { authUserId: "users:1", email: "sam@test.com", status: "draft" },
      patch,
      { email: "sam@test.com", updatedAt: 1 },
    );
    const stored = merged as { experienceLevel?: string };
    const restored = applicationToDraftForm(stored);
    expect(restored.experienceLevel).toBe("Advanced");
  });

  it("clears stored experienceLevel when the draft sends an empty string", () => {
    const patch = formToDraftPatch({
      ...validRegistrationForm(),
      experienceLevel: "",
    });
    expect(patch.experienceLevel).toBe("");
  });

  it("hydrates missing legacy applications as blank", () => {
    expect(applicationToDraftForm({ firstName: "Sam" }).experienceLevel).toBe("");
  });

  it("includes experienceLevel in the valid registration payload", () => {
    const payload = validRegistrationPayload();
    expect(payload.experienceLevel).toBe("Intermediate");
    expect(validateRegistrationPayload(payload).success).toBe(true);
  });

  it("defaults new forms to an empty experience level", () => {
    expect(INITIAL_FORM.experienceLevel).toBe("");
  });
});
