import { describe, expect, it } from "vitest";
import {
  APPLICANT_ANSWER_FIELD_KEYS,
  OPTIONAL_INT_FIELDS,
} from "../../shared/registration/applicantFields";
import { MAX_HACKATHONS_ATTENDED, MIN_HACKATHONS_ATTENDED } from "../../shared/registration/constants";
import {
  applicationToDraftForm,
  formToDraftPatch,
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

describe("hackathonsAttended field", () => {
  it("registers hackathonsAttended as an optional int and removes firstHackathon", () => {
    expect(OPTIONAL_INT_FIELDS).toContain("hackathonsAttended");
    expect(APPLICANT_ANSWER_FIELD_KEYS).toContain("hackathonsAttended");
    expect(APPLICANT_ANSWER_FIELD_KEYS).not.toContain("firstHackathon");
  });

  it("requires a whole number within the configured range", () => {
    const missing = validateApplicationForm({
      ...validRegistrationForm(),
      hackathonsAttended: "",
    });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.errors.hackathonsAttended).toBe("Hackathons attended is required.");
    }

    for (const value of ["-1", "1.5", "abc"]) {
      const result = validateApplicationForm({
        ...validRegistrationForm(),
        hackathonsAttended: value,
      });
      expect(result.success).toBe(false);
    }

    const atMax = validateApplicationForm({
      ...validRegistrationForm(),
      hackathonsAttended: String(MAX_HACKATHONS_ATTENDED),
    });
    expect(atMax.success).toBe(true);
    if (atMax.success) {
      expect(atMax.payload.hackathonsAttended).toBe(MAX_HACKATHONS_ATTENDED);
    }

    const overMax = validateApplicationForm({
      ...validRegistrationForm(),
      hackathonsAttended: String(MAX_HACKATHONS_ATTENDED + 1),
    });
    expect(overMax.success).toBe(false);
    if (!overMax.success) {
      expect(overMax.errors.hackathonsAttended).toContain(String(MAX_HACKATHONS_ATTENDED));
    }
  });

  it("accepts zero as a valid answer for first-time applicants", () => {
    const result = validateApplicationForm({
      ...validRegistrationForm(),
      hackathonsAttended: String(MIN_HACKATHONS_ATTENDED),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.hackathonsAttended).toBe(0);
    }
  });

  it("round-trips hackathonsAttended through draft autosave mapping", () => {
    const form = { ...validRegistrationForm(), hackathonsAttended: "4" };
    const patch = formToDraftPatch(form);
    expect(patch.hackathonsAttended).toBe(4);

    const restored = applicationToDraftForm({
      hackathonsAttended: patch.hackathonsAttended,
    });
    expect(restored.hackathonsAttended).toBe("4");
  });

  it("clears stored hackathonsAttended when the draft sends an empty string", () => {
    const patch = formToDraftPatch({
      ...validRegistrationForm(),
      hackathonsAttended: "",
    });
    expect(patch.hackathonsAttended).toBeNull();
  });

  it("hydrates missing legacy applications as blank", () => {
    expect(applicationToDraftForm({ firstName: "Sam" }).hackathonsAttended).toBe("");
  });

  it("includes hackathonsAttended in the valid registration payload", () => {
    const payload = validRegistrationPayload();
    expect(payload.hackathonsAttended).toBe(1);
    expect(validateRegistrationPayload(payload).success).toBe(true);
  });

  it("defaults new forms to an empty hackathonsAttended answer", () => {
    expect(INITIAL_FORM.hackathonsAttended).toBe("");
  });
});
