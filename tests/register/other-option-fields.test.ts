import { describe, expect, it } from "vitest";
import {
  APPLICANT_ANSWER_FIELD_KEYS,
  CONDITIONAL_STRING_FIELDS,
} from "../../shared/registration/applicantFields";
import {
  GENDER_SELF_DESCRIBE_OPTION,
  HEAR_ABOUT_OTHER_OPTION,
  LEVEL_OF_STUDY_OTHER_OPTION,
  MAJOR_OTHER_OPTION,
  SCHOOL_OTHER_OPTION,
} from "../../shared/registration/constants";
import {
  applicationToDraftForm,
  formToDraftPatch,
} from "../../shared/registration/draftMapping";
import { INITIAL_FORM } from "../../shared/registration/types";
import {
  validateApplicationForm,
  validateRegistrationPayload,
} from "../../shared/registration/validation";
import {
  formWithAllOtherOptions,
  OTHER_OPTION_FIXTURES,
  storedApplicationWithAllOtherOptions,
} from "../fixtures/otherOptionFixtures";
import { validRegistrationForm, validRegistrationPayload } from "../fixtures/validRegistrationForm";

const OTHER_FIELD_KEYS = [
  "otherSchool",
  "otherLevelOfStudy",
  "otherMajor",
  "otherHearAbout",
  "otherGender",
] as const;

describe("other option field regression", () => {
  describe("schema field registration", () => {
    it("persists every conditional other* column on applications", () => {
      for (const key of OTHER_FIELD_KEYS) {
        expect(CONDITIONAL_STRING_FIELDS).toContain(key);
        expect(APPLICANT_ANSWER_FIELD_KEYS).toContain(key);
      }
    });

    it("initializes every other* form field as empty", () => {
      for (const key of OTHER_FIELD_KEYS) {
        expect(INITIAL_FORM[key]).toBe("");
      }
    });
  });

  describe("split storage on submit (no merge into parent fields)", () => {
    it("stores school sentinel and otherSchool separately", () => {
      const form = validRegistrationForm();
      form.school = SCHOOL_OTHER_OPTION;
      form.otherSchool = OTHER_OPTION_FIXTURES.school;

      const result = validateApplicationForm(form);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.payload.school).toBe(SCHOOL_OTHER_OPTION);
        expect(result.payload.otherSchool).toBe(OTHER_OPTION_FIXTURES.school);
        expect(result.payload.school).not.toBe(OTHER_OPTION_FIXTURES.school);
      }
    });

    it("stores level-of-study sentinel and otherLevelOfStudy separately", () => {
      const form = validRegistrationForm();
      form.levelOfStudy = LEVEL_OF_STUDY_OTHER_OPTION;
      form.otherLevelOfStudy = OTHER_OPTION_FIXTURES.levelOfStudy;

      const result = validateApplicationForm(form);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.payload.levelOfStudy).toBe(LEVEL_OF_STUDY_OTHER_OPTION);
        expect(result.payload.otherLevelOfStudy).toBe(OTHER_OPTION_FIXTURES.levelOfStudy);
      }
    });

    it("stores major sentinel and otherMajor separately", () => {
      const form = validRegistrationForm();
      form.major = MAJOR_OTHER_OPTION;
      form.otherMajor = OTHER_OPTION_FIXTURES.major;

      const result = validateApplicationForm(form);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.payload.major).toBe(MAJOR_OTHER_OPTION);
        expect(result.payload.otherMajor).toBe(OTHER_OPTION_FIXTURES.major);
      }
    });

    it("stores hear-about sentinel and otherHearAbout separately", () => {
      const form = validRegistrationForm();
      form.hearAbout = HEAR_ABOUT_OTHER_OPTION;
      form.otherHearAbout = OTHER_OPTION_FIXTURES.hearAbout;

      const result = validateApplicationForm(form);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.payload.hearAbout).toBe(HEAR_ABOUT_OTHER_OPTION);
        expect(result.payload.otherHearAbout).toBe(OTHER_OPTION_FIXTURES.hearAbout);
      }
    });

    it("stores gender sentinel and otherGender separately", () => {
      const form = validRegistrationForm();
      form.gender = GENDER_SELF_DESCRIBE_OPTION;
      form.otherGender = OTHER_OPTION_FIXTURES.gender;

      const result = validateApplicationForm(form);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.payload.gender).toBe(GENDER_SELF_DESCRIBE_OPTION);
        expect(result.payload.otherGender).toBe(OTHER_OPTION_FIXTURES.gender);
      }
    });

    it("clears other* fields in the payload when a listed option is selected", () => {
      const form = validRegistrationForm();
      form.school = SCHOOL_OTHER_OPTION;
      form.otherSchool = OTHER_OPTION_FIXTURES.school;
      form.levelOfStudy = LEVEL_OF_STUDY_OTHER_OPTION;
      form.otherLevelOfStudy = OTHER_OPTION_FIXTURES.levelOfStudy;
      form.major = MAJOR_OTHER_OPTION;
      form.otherMajor = OTHER_OPTION_FIXTURES.major;
      form.hearAbout = HEAR_ABOUT_OTHER_OPTION;
      form.otherHearAbout = OTHER_OPTION_FIXTURES.hearAbout;
      form.gender = GENDER_SELF_DESCRIBE_OPTION;
      form.otherGender = OTHER_OPTION_FIXTURES.gender;

      form.school = validRegistrationForm().school;
      form.levelOfStudy = validRegistrationForm().levelOfStudy;
      form.major = validRegistrationForm().major;
      form.hearAbout = validRegistrationForm().hearAbout;
      form.gender = validRegistrationForm().gender;

      const result = validateApplicationForm(form);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.payload.otherSchool ?? "").toBe("");
        expect(result.payload.otherLevelOfStudy ?? "").toBe("");
        expect(result.payload.otherMajor ?? "").toBe("");
        expect(result.payload.otherHearAbout ?? "").toBe("");
        expect(result.payload.otherGender ?? "").toBe("");
      }
    });
  });

  describe("payload schema rejects merged custom text in parent fields", () => {
    it("rejects a custom school name without the Other sentinel", () => {
      const result = validateRegistrationPayload({
        ...validRegistrationPayload(),
        school: "Mars Academy",
        otherSchool: "Mars Academy",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a custom level of study without the Other sentinel", () => {
      const result = validateRegistrationPayload({
        ...validRegistrationPayload(),
        levelOfStudy: OTHER_OPTION_FIXTURES.levelOfStudy,
        otherLevelOfStudy: OTHER_OPTION_FIXTURES.levelOfStudy,
      });
      expect(result.success).toBe(false);
    });

    it("rejects Other level of study without otherLevelOfStudy text", () => {
      const result = validateRegistrationPayload({
        ...validRegistrationPayload(),
        levelOfStudy: LEVEL_OF_STUDY_OTHER_OPTION,
        otherLevelOfStudy: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a custom major without the Other sentinel", () => {
      const result = validateRegistrationPayload({
        ...validRegistrationPayload(),
        major: "Biomedical engineering",
        otherMajor: "Biomedical engineering",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a custom hear-about answer without the Other sentinel", () => {
      const result = validateRegistrationPayload({
        ...validRegistrationPayload(),
        hearAbout: "Professor announcement",
        otherHearAbout: "Professor announcement",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a custom gender without the self-describe sentinel", () => {
      const result = validateRegistrationPayload({
        ...validRegistrationPayload(),
        gender: "Genderfluid",
        otherGender: "Genderfluid",
      });
      expect(result.success).toBe(false);
    });

    it("rejects self-describe gender without otherGender text", () => {
      const result = validateRegistrationPayload({
        ...validRegistrationPayload(),
        gender: GENDER_SELF_DESCRIBE_OPTION,
        otherGender: "",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("draft round-trip", () => {
    it("round-trips all Other selections through draft autosave", () => {
      const form = formWithAllOtherOptions();
      const { resume: _resume, ...expected } = form;
      void _resume;

      expect(applicationToDraftForm(formToDraftPatch(form))).toEqual(expected);
    });

    it("round-trips stored split columns from the database back into the form", () => {
      const stored = storedApplicationWithAllOtherOptions();
      const restored = applicationToDraftForm(stored);

      expect(restored.school).toBe(SCHOOL_OTHER_OPTION);
      expect(restored.otherSchool).toBe(OTHER_OPTION_FIXTURES.school);
      expect(restored.levelOfStudy).toBe(LEVEL_OF_STUDY_OTHER_OPTION);
      expect(restored.otherLevelOfStudy).toBe(OTHER_OPTION_FIXTURES.levelOfStudy);
      expect(restored.major).toBe(MAJOR_OTHER_OPTION);
      expect(restored.otherMajor).toBe(OTHER_OPTION_FIXTURES.major);
      expect(restored.hearAbout).toBe(HEAR_ABOUT_OTHER_OPTION);
      expect(restored.otherHearAbout).toBe(OTHER_OPTION_FIXTURES.hearAbout);
      expect(restored.gender).toBe(GENDER_SELF_DESCRIBE_OPTION);
      expect(restored.otherGender).toBe(OTHER_OPTION_FIXTURES.gender);
      expect(restored.mlhCodeOfConductAgreed).toBe(true);
    });
  });
});
