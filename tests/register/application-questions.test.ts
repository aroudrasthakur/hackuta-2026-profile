import { describe, expect, it } from "vitest";
import { APPLICANT_ANSWER_FIELD_KEYS } from "../../shared/registration/applicantFields";
import {
  APPLICATION_QUESTIONS,
  FIELD_LIMITS,
} from "../../shared/registration/constants";
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

describe("application question fields", () => {
  it("uses the exact required question wording in constants", () => {
    expect(APPLICATION_QUESTIONS.builtOrWantToBuild).toBe(
      "Tell us about something you have built or something you want to build",
    );
    expect(APPLICATION_QUESTIONS.shortDeadlineLearning).toBe(
      "Describe a time you had to learn a tool or skill on a short deadline",
    );
  });

  it("registers both application questions for draft autosave", () => {
    expect(APPLICANT_ANSWER_FIELD_KEYS).toContain("builtOrWantToBuild");
    expect(APPLICANT_ANSWER_FIELD_KEYS).toContain("shortDeadlineLearning");
    expect(APPLICANT_ANSWER_FIELD_KEYS).not.toContain("firstHackathon");
  });

  it("requires both mandatory multiline answers on submit", () => {
    const empty = validateApplicationForm(validRegistrationForm());
    expect(empty.success).toBe(true);

    const missingBuilt = validateApplicationForm({
      ...validRegistrationForm(),
      builtOrWantToBuild: "",
    });
    expect(missingBuilt.success).toBe(false);
    if (!missingBuilt.success) {
      expect(missingBuilt.errors.builtOrWantToBuild).toBe(
        `${APPLICATION_QUESTIONS.builtOrWantToBuild}.`,
      );
    }

    const missingLearning = validateApplicationForm({
      ...validRegistrationForm(),
      shortDeadlineLearning: "",
    });
    expect(missingLearning.success).toBe(false);
    if (!missingLearning.success) {
      expect(missingLearning.errors.shortDeadlineLearning).toBe(
        `${APPLICATION_QUESTIONS.shortDeadlineLearning}.`,
      );
    }
  });

  it.each([
    ["builtOrWantToBuild", FIELD_LIMITS.builtOrWantToBuild] as const,
    ["shortDeadlineLearning", FIELD_LIMITS.shortDeadlineLearning] as const,
  ])("rejects %s responses longer than the configured character limit", (field, limit) => {
    const tooLong = "x".repeat(limit + 1);
    const result = validateApplicationForm({
      ...validRegistrationForm(),
      [field]: tooLong,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[field]).toContain("2,000");
    }
  });

  it("accepts multiline text and trims surrounding whitespace on submit", () => {
    const multiline = "Line one\nLine two\n\nLine four";
    const result = validateApplicationForm({
      ...validRegistrationForm(),
      builtOrWantToBuild: `  ${multiline}  `,
      shortDeadlineLearning: "Learned Docker\nwhile shipping a class project.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.builtOrWantToBuild).toBe(multiline);
      expect(result.payload.shortDeadlineLearning).toBe(
        "Learned Docker\nwhile shipping a class project.",
      );
    }
  });

  it("round-trips answers through draft autosave mapping", () => {
    const form = validRegistrationForm();
    form.builtOrWantToBuild = "Built a robot arm\nfor a design class.";
    form.shortDeadlineLearning = "Learned Figma\nin 48 hours.";

    const patch = formToDraftPatch(form);
    expect(patch.builtOrWantToBuild).toBe(form.builtOrWantToBuild);
    expect(patch.shortDeadlineLearning).toBe(form.shortDeadlineLearning);

    const merged = mergeDraftPatchIntoApplication(
      { authUserId: "users:1", email: "sam@test.com", status: "draft" },
      patch,
      { email: "sam@test.com", updatedAt: 1 },
    );
    const stored = merged as {
      builtOrWantToBuild?: string;
      shortDeadlineLearning?: string;
    };
    const restored = applicationToDraftForm(stored);

    expect(restored.builtOrWantToBuild).toBe(form.builtOrWantToBuild);
    expect(restored.shortDeadlineLearning).toBe(form.shortDeadlineLearning);
  });

  it("hydrates missing legacy draft fields as empty strings", () => {
    const restored = applicationToDraftForm({
      firstName: "Sam",
      lastName: "Test",
    });

    expect(restored.builtOrWantToBuild).toBe("");
    expect(restored.shortDeadlineLearning).toBe("");
  });

  it("validates stored payloads through the shared server schema", () => {
    const payload = validateApplicationForm(validRegistrationForm());
    if (!payload.success) {
      throw new Error("Expected valid fixture");
    }

    const serverResult = validateRegistrationPayload(payload.payload);
    expect(serverResult.success).toBe(true);
  });

  it("defaults new forms to empty application question answers", () => {
    expect(INITIAL_FORM.builtOrWantToBuild).toBe("");
    expect(INITIAL_FORM.shortDeadlineLearning).toBe("");
  });

  it("trims application question answers in draft patches", () => {
    const patch = formToDraftPatch({
      ...INITIAL_FORM,
      builtOrWantToBuild: "  Built a weather app  ",
      shortDeadlineLearning: "  Learned SQL overnight  ",
    });

    expect(patch.builtOrWantToBuild).toBe("Built a weather app");
    expect(patch.shortDeadlineLearning).toBe("Learned SQL overnight");
  });

  it("includes application question answers in the valid registration payload", () => {
    const payload = validRegistrationPayload();
    expect(payload.builtOrWantToBuild).toContain("campus events app");
    expect(payload.shortDeadlineLearning).toContain("GitHub Actions");
  });
});
