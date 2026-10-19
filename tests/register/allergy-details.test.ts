import { describe, expect, it } from "vitest";
import { APPLICANT_DRAFT_PATCH_FIELD_KEYS } from "../../convex/applicationFields";
import { resolveAllergyDetailsFromLegacy } from "../../shared/registration/allergyMigration";
import {
  APPLICANT_ANSWER_FIELD_KEYS,
  TRIMMED_STRING_FIELDS,
} from "../../shared/registration/applicantFields";
import { FIELD_LIMITS } from "../../shared/registration/constants";
import {
  applicationToDraftForm,
  formToDraftPatch,
  mergeDraftPatchIntoApplication,
} from "../../shared/registration/draftMapping";
import { validateApplicationForm } from "../../shared/registration/validation";
import { INITIAL_FORM } from "../../shared/registration/types";
import { validRegistrationForm } from "../fixtures/validRegistrationForm";

describe("resolveAllergyDetailsFromLegacy", () => {
  it("prefers non-empty allergyDetails over legacy otherDietary", () => {
    expect(resolveAllergyDetailsFromLegacy("Peanuts", "Shellfish")).toBe("Peanuts");
  });

  it("falls back to legacy otherDietary when allergyDetails is blank", () => {
    expect(resolveAllergyDetailsFromLegacy("", "Shellfish")).toBe("Shellfish");
    expect(resolveAllergyDetailsFromLegacy(undefined, "Shellfish")).toBe("Shellfish");
  });

  it("returns undefined when both values are blank", () => {
    expect(resolveAllergyDetailsFromLegacy("", "")).toBeUndefined();
    expect(resolveAllergyDetailsFromLegacy(undefined, undefined)).toBeUndefined();
  });
});

describe("allergyDetails field", () => {
  it("registers allergyDetails as a trimmed string draft field", () => {
    expect(TRIMMED_STRING_FIELDS).toContain("allergyDetails");
    expect(APPLICANT_ANSWER_FIELD_KEYS).toContain("allergyDetails");
    expect(APPLICANT_DRAFT_PATCH_FIELD_KEYS).toContain("allergyDetails");
    expect(FIELD_LIMITS.allergyDetails).toBe(500);
  });

  it("requires allergy details when Allergies is selected", () => {
    const form = validRegistrationForm();
    form.dietaryRestrictions = ["Allergies"];
    form.allergyDetails = "";

    const result = validateApplicationForm(form);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.allergyDetails).toBe(
        "Please describe your food allergies.",
      );
    }
  });

  it("allows blank allergy details when Allergies is not selected", () => {
    const form = validRegistrationForm();
    form.dietaryRestrictions = ["Vegan"];
    form.allergyDetails = "";

    const result = validateApplicationForm(form);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.allergyDetails).toBeUndefined();
    }
  });

  it("round-trips allergyDetails through draft autosave mapping", () => {
    const form = validRegistrationForm();
    form.dietaryRestrictions = ["Allergies"];
    form.allergyDetails = "No peanuts";
    const patch = formToDraftPatch(form);
    expect(patch.allergyDetails).toBe("No peanuts");

    const merged = mergeDraftPatchIntoApplication(
      { authUserId: "user1" } as Record<string, unknown>,
      patch,
      { email: "sam@example.com", updatedAt: 1 },
    );
    const restored = applicationToDraftForm(merged as { allergyDetails?: string });
    expect(restored.allergyDetails).toBe("No peanuts");
  });

  it("clears stored allergyDetails when the draft sends an empty string", () => {
    const patch = formToDraftPatch({ ...INITIAL_FORM, allergyDetails: "" });
    expect(patch.allergyDetails).toBe("");

    const merged = mergeDraftPatchIntoApplication(
      { authUserId: "user1", allergyDetails: "No dairy" } as Record<string, unknown>,
      patch,
      { email: "sam@example.com", updatedAt: 1 },
    );
    expect(merged.allergyDetails).toBeUndefined();
  });
});
