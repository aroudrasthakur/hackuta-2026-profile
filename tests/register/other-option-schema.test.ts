import { describe, expect, it } from "vitest";
import { applicationRecord, APPLICANT_DRAFT_PATCH_FIELD_KEYS } from "../../convex/applicationFields";
import {
  APPLICANT_ANSWER_FIELD_KEYS,
  CONDITIONAL_STRING_FIELDS,
} from "../../shared/registration/applicantFields";
import {
  FIELD_LIMITS,
  GENDER_SELF_DESCRIBE_OPTION,
  HEAR_ABOUT_OTHER_OPTION,
  LEVEL_OF_STUDY_OTHER_OPTION,
  MAJOR_OTHER_OPTION,
  SCHOOL_OTHER_OPTION,
} from "../../shared/registration/constants";
import {
  applicationToDraftForm,
  formToDraftPatch,
  mergeDraftPatchIntoApplication,
} from "../../shared/registration/draftMapping";
import { registrationPayloadSchema } from "../../shared/registration/schema";
import { validateApplicationForm } from "../../shared/registration/validation";
import { OTHER_OPTION_FIXTURES } from "../fixtures/otherOptionFixtures";
import { validRegistrationForm, validRegistrationPayload } from "../fixtures/validRegistrationForm";

const OTHER_FIELDS = [
  {
    parent: "school",
    other: "otherSchool",
    sentinel: SCHOOL_OTHER_OPTION,
    text: OTHER_OPTION_FIXTURES.school,
  },
  {
    parent: "levelOfStudy",
    other: "otherLevelOfStudy",
    sentinel: LEVEL_OF_STUDY_OTHER_OPTION,
    text: OTHER_OPTION_FIXTURES.levelOfStudy,
  },
  {
    parent: "major",
    other: "otherMajor",
    sentinel: MAJOR_OTHER_OPTION,
    text: OTHER_OPTION_FIXTURES.major,
  },
  {
    parent: "gender",
    other: "otherGender",
    sentinel: GENDER_SELF_DESCRIBE_OPTION,
    text: OTHER_OPTION_FIXTURES.gender,
  },
  {
    parent: "hearAbout",
    other: "otherHearAbout",
    sentinel: HEAR_ABOUT_OTHER_OPTION,
    text: OTHER_OPTION_FIXTURES.hearAbout,
  },
] as const;

describe("other option schema registration", () => {
  it.each(OTHER_FIELDS.map(({ other }) => [other]))(
    "registers %s across shared and Convex applicant field lists",
    (otherField) => {
      expect(CONDITIONAL_STRING_FIELDS).toContain(otherField);
      expect(APPLICANT_ANSWER_FIELD_KEYS).toContain(otherField);
      expect(APPLICANT_DRAFT_PATCH_FIELD_KEYS).toContain(otherField);
      expect(applicationRecord).toHaveProperty(otherField);
      expect(FIELD_LIMITS[otherField as keyof typeof FIELD_LIMITS]).toBe(200);
    },
  );

  it("accepts split other option values in registrationPayloadSchema", () => {
    const form = validRegistrationForm();
    form.school = SCHOOL_OTHER_OPTION;
    form.otherSchool = "Mars Academy";
    form.levelOfStudy = LEVEL_OF_STUDY_OTHER_OPTION;
    form.otherLevelOfStudy = OTHER_OPTION_FIXTURES.levelOfStudy;
    form.major = MAJOR_OTHER_OPTION;
    form.otherMajor = "Space Law";
    form.gender = GENDER_SELF_DESCRIBE_OPTION;
    form.otherGender = "Genderfluid";
    form.hearAbout = HEAR_ABOUT_OTHER_OPTION;
    form.otherHearAbout = "Professor announcement";

    const validated = validateApplicationForm(form);
    expect(validated.success).toBe(true);
    if (!validated.success) return;

    const parsed = registrationPayloadSchema.safeParse(validated.payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.school).toBe(SCHOOL_OTHER_OPTION);
    expect(parsed.data.otherSchool).toBe("Mars Academy");
    expect(parsed.data.levelOfStudy).toBe(LEVEL_OF_STUDY_OTHER_OPTION);
    expect(parsed.data.otherLevelOfStudy).toBe(OTHER_OPTION_FIXTURES.levelOfStudy);
    expect(parsed.data.major).toBe(MAJOR_OTHER_OPTION);
    expect(parsed.data.otherMajor).toBe("Space Law");
    expect(parsed.data.gender).toBe(GENDER_SELF_DESCRIBE_OPTION);
    expect(parsed.data.otherGender).toBe("Genderfluid");
    expect(parsed.data.hearAbout).toBe(HEAR_ABOUT_OTHER_OPTION);
    expect(parsed.data.otherHearAbout).toBe("Professor announcement");
  });

  it("rejects registration payloads that merge custom text into parent fields", () => {
    for (const { parent, other, text } of OTHER_FIELDS) {
      const payload = {
        ...validRegistrationPayload(),
        [parent]: text,
        [other]: text,
      };
      expect(registrationPayloadSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("round-trips split other fields through draft patch merge", () => {
    const form = validRegistrationForm();
    form.school = SCHOOL_OTHER_OPTION;
    form.otherSchool = "Mars Academy";
    form.levelOfStudy = LEVEL_OF_STUDY_OTHER_OPTION;
    form.otherLevelOfStudy = OTHER_OPTION_FIXTURES.levelOfStudy;
    form.major = MAJOR_OTHER_OPTION;
    form.otherMajor = "Space Law";
    form.gender = GENDER_SELF_DESCRIBE_OPTION;
    form.otherGender = "Genderfluid";
    form.hearAbout = HEAR_ABOUT_OTHER_OPTION;
    form.otherHearAbout = "Professor announcement";

    const patch = formToDraftPatch(form);
    expect(patch.otherSchool).toBe("Mars Academy");
    expect(patch.otherLevelOfStudy).toBe(OTHER_OPTION_FIXTURES.levelOfStudy);
    expect(patch.otherMajor).toBe("Space Law");
    expect(patch.otherGender).toBe("Genderfluid");
    expect(patch.otherHearAbout).toBe("Professor announcement");

    const merged = mergeDraftPatchIntoApplication(
      { authUserId: "user1" } as Record<string, unknown>,
      patch,
      { email: "sam@example.com", updatedAt: 1 },
    );
    const restored = applicationToDraftForm(merged as Record<string, unknown>);

    expect(restored.school).toBe(SCHOOL_OTHER_OPTION);
    expect(restored.otherSchool).toBe("Mars Academy");
    expect(restored.levelOfStudy).toBe(LEVEL_OF_STUDY_OTHER_OPTION);
    expect(restored.otherLevelOfStudy).toBe(OTHER_OPTION_FIXTURES.levelOfStudy);
    expect(restored.major).toBe(MAJOR_OTHER_OPTION);
    expect(restored.otherMajor).toBe("Space Law");
    expect(restored.gender).toBe(GENDER_SELF_DESCRIBE_OPTION);
    expect(restored.otherGender).toBe("Genderfluid");
    expect(restored.hearAbout).toBe(HEAR_ABOUT_OTHER_OPTION);
    expect(restored.otherHearAbout).toBe(OTHER_OPTION_FIXTURES.hearAbout);
  });

  it("accepts other option fields alongside mlhCodeOfConductAgreed in registrationPayloadSchema", () => {
    const form = validRegistrationForm();
    form.school = SCHOOL_OTHER_OPTION;
    form.otherSchool = OTHER_OPTION_FIXTURES.school;
    form.mlhCodeOfConductAgreed = true;

    const validated = validateApplicationForm(form);
    expect(validated.success).toBe(true);
    if (!validated.success) return;

    const parsed = registrationPayloadSchema.safeParse(validated.payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.otherSchool).toBe(OTHER_OPTION_FIXTURES.school);
    expect(parsed.data.mlhCodeOfConductAgreed).toBe(true);
  });
});
