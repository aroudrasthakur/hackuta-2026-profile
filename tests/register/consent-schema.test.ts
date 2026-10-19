import { describe, expect, it } from "vitest";
import { applicationRecord, APPLICANT_DRAFT_PATCH_FIELD_KEYS } from "../../convex/applicationFields";
import {
  APPLICANT_ANSWER_FIELD_KEYS,
  REQUIRED_BOOLEAN_FIELDS,
} from "../../shared/registration/applicantFields";
import {
  applicationToDraftForm,
  formToDraftPatch,
  mergeDraftPatchIntoApplication,
} from "../../shared/registration/draftMapping";
import { registrationPayloadSchema } from "../../shared/registration/schema";
import { validateApplicationForm } from "../../shared/registration/validation";
import { validRegistrationForm, validRegistrationPayload } from "../fixtures/validRegistrationForm";

const MLH_CODE_OF_CONDUCT_FIELD = "mlhCodeOfConductAgreed" as const;

describe("mlh code of conduct schema registration", () => {
  it("registers mlhCodeOfConductAgreed across shared and Convex applicant field lists", () => {
    expect(REQUIRED_BOOLEAN_FIELDS).toContain(MLH_CODE_OF_CONDUCT_FIELD);
    expect(APPLICANT_ANSWER_FIELD_KEYS).toContain(MLH_CODE_OF_CONDUCT_FIELD);
    expect(APPLICANT_DRAFT_PATCH_FIELD_KEYS).toContain(MLH_CODE_OF_CONDUCT_FIELD);
    expect(applicationRecord).toHaveProperty(MLH_CODE_OF_CONDUCT_FIELD);

    const parsed = registrationPayloadSchema.safeParse(validRegistrationPayload());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toHaveProperty(MLH_CODE_OF_CONDUCT_FIELD, true);
    }
  });

  it("requires mlhCodeOfConductAgreed in registrationPayloadSchema", () => {
    const payload = {
      ...validRegistrationPayload(),
      mlhCodeOfConductAgreed: false as const,
    };

    expect(registrationPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it("registers agreement timestamp columns on applications but not draft patches", () => {
    for (const at of [
      "mlhCodeOfConductAgreedAt",
      "mlhDataSharingConsentAt",
      "mlhCommunicationsConsentAt",
      "sponsorSharingConsentAt",
      "foodAllergyWaiverAgreedAt",
    ] as const) {
      expect(applicationRecord).toHaveProperty(at);
      expect(APPLICANT_DRAFT_PATCH_FIELD_KEYS).not.toContain(at);
    }
  });

  it("rejects client-supplied agreement timestamps in strict registration payloads", () => {
    expect(
      registrationPayloadSchema.safeParse({
        ...validRegistrationPayload(),
        mlhCodeOfConductAgreedAt: Date.now(),
      }).success,
    ).toBe(false);
    expect(
      registrationPayloadSchema.safeParse({
        ...validRegistrationPayload(),
        sponsorSharingConsentAt: Date.now(),
      }).success,
    ).toBe(false);
    expect(
      registrationPayloadSchema.safeParse({
        ...validRegistrationPayload(),
        foodAllergyWaiverAgreedAt: Date.now(),
      }).success,
    ).toBe(false);
  });

  it("rejects legacy agreement SubmittedAt timestamps in strict registration payloads", () => {
    expect(
      registrationPayloadSchema.safeParse({
        ...validRegistrationPayload(),
        sponsorSharingConsentSubmittedAt: Date.now(),
      }).success,
    ).toBe(false);
    expect(
      registrationPayloadSchema.safeParse({
        ...validRegistrationPayload(),
        foodAllergyWaiverSubmittedAt: Date.now(),
      }).success,
    ).toBe(false);
  });

  it("rejects legacy codeOfConductAgreed in strict registration payloads", () => {
    const payload = {
      ...validRegistrationPayload(),
      codeOfConductAgreed: true,
    };

    expect(registrationPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it("round-trips mlhCodeOfConductAgreed through draft patch merge", () => {
    const form = validRegistrationForm();
    form.mlhCodeOfConductAgreed = true;

    const validated = validateApplicationForm(form);
    expect(validated.success).toBe(true);
    if (!validated.success) return;

    expect(validated.payload.mlhCodeOfConductAgreed).toBe(true);

    const patch = formToDraftPatch(form);
    expect(patch.mlhCodeOfConductAgreed).toBe(true);

    const merged = mergeDraftPatchIntoApplication(
      { authUserId: "user1" } as Record<string, unknown>,
      patch,
      { email: "sam@example.com", updatedAt: 1 },
    );
    const restored = applicationToDraftForm(merged as Record<string, unknown>);

    expect(restored.mlhCodeOfConductAgreed).toBe(true);
  });

  it("rejects interim MLHcodeOfConductAgreed in strict registration payloads", () => {
    const payload = {
      ...validRegistrationPayload(),
      MLHcodeOfConductAgreed: true,
    };

    expect(registrationPayloadSchema.safeParse(payload).success).toBe(false);
  });
});
