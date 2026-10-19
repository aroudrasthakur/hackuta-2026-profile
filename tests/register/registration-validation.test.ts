import { describe, expect, it, vi } from "vitest";
import {
  AGE_TOO_HIGH_MESSAGE,
  GENDER_SELF_DESCRIBE_OPTION,
  HEAR_ABOUT_OTHER_OPTION,
  MAJOR_OTHER_OPTION,
  SCHOOL_OTHER_OPTION,
} from "../../shared/registration/constants";
import { registrationPayloadSchema } from "../../shared/registration/schema";
import { INITIAL_FORM } from "../../shared/registration/types";
import {
  focusFirstInvalidField,
  toggleValue,
  validateApplicationForm,
  validateRegistrationPayload,
} from "../../shared/registration/validation";
import { validRegistrationForm } from "../fixtures/validRegistrationForm";

function validPayloadFromForm() {
  const result = validateApplicationForm(validRegistrationForm());
  if (!result.success) {
    throw new Error("Test setup failed: valid form did not validate");
  }

  return result.payload;
}

describe("validateApplicationForm", () => {
  it.each([
    ["phone", "phoneCountry"],
    ["emergencyContactPhone", "emergencyContactPhoneCountry"],
  ] as const)("accepts local %s regardless of the selected country", (field, countryField) => {
    const result = validateApplicationForm({
      ...validRegistrationForm(),
      [field]: "2025550123",
      [countryField]: "CA",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload[field]).toBe("2025550123");
      expect(result.payload[countryField]).toBe("CA");
    }
  });

  it("checks both countries on server submissions and accepts older payloads without them", () => {
    const payload = validPayloadFromForm();
    expect(validateRegistrationPayload({ ...payload, phoneCountry: "CA" }).success).toBe(true);
    expect(validateRegistrationPayload({ ...payload, emergencyContactPhoneCountry: "US" }).success).toBe(true);
    expect(validateRegistrationPayload({ ...payload, phoneCountry: "XX" }).success).toBe(false);
    expect(validateRegistrationPayload(payload).success).toBe(true);
  });

  it("rejects fewer than 10 digits in both phone fields", () => {
    for (const field of ["phone", "emergencyContactPhone"] as const) {
      const result = validateApplicationForm({
        ...validRegistrationForm(),
        [field]: "+1 555 123",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[field]).toBe("Enter a valid phone number.");
      }
    }
  });

  it("normalizes both international phone numbers in the submission payload", () => {
    const result = validateApplicationForm({
      ...validRegistrationForm(),
      phone: "+1 (202) 555-0123",
      emergencyContactPhone: "+44 20 7946 0958",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.phone).toBe("+12025550123");
      expect(result.payload.emergencyContactPhone).toBe("+442079460958");
    }
  });

  it("formats 10-digit US numbers before submission in both phone fields", () => {
    const result = validateApplicationForm({
      ...validRegistrationForm(),
      phone: "5551234567",
      emergencyContactPhone: "202-555-0123",
      emergencyContactPhoneCountry: "US",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.phone).toBe("(555)-123-4567");
      expect(result.payload.emergencyContactPhone).toBe("(202)-555-0123");
    }
  });

  it("rejects international numbers with fewer than 10 digits", () => {
    const result = validateApplicationForm({
      ...validRegistrationForm(),
      phone: "+354 555 123",
    });

    expect(result.success).toBe(false);
  });

  it.each([
    new File(["text"], "resume.txt", { type: "text/plain" }),
    new File([], "resume.pdf", { type: "application/pdf" }),
    new File(["x".repeat(2 * 1024 * 1024 + 1)], "resume.pdf", { type: "application/pdf" }),
  ])("blocks submission of invalid resume files", (resume) => {
    const result = validateApplicationForm({ ...validRegistrationForm(), resume });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.resume).toBeTruthy();
  });

  it("rejects an empty form with field errors", () => {
    const result = validateApplicationForm(INITIAL_FORM);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.firstName).toBe("First name is required.");
      expect(result.errors.mlhCodeOfConductAgreed).toBeTruthy();
    }
  });

  it("accepts a valid form and trims whitespace", () => {
    const form = validRegistrationForm();
    form.firstName = "  Sam  ";
    form.lastName = "  Test  ";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.firstName).toBe("Sam");
      expect(result.payload.lastName).toBe("Test");
    }
  });

  it("requires the food allergy waiver but allows sponsor sharing to remain unchecked", () => {
    const form = validRegistrationForm();
    form.foodAllergyWaiverAgreed = false;
    form.sponsorSharingConsent = false;

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.foodAllergyWaiverAgreed).toContain("food allergy");
    }

    form.foodAllergyWaiverAgreed = true;
    expect(validateApplicationForm(form).success).toBe(true);
  });

  it("rejects invalid age values", () => {
    const form = validRegistrationForm();
    form.age = "-500";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
  });

  it.each([120, 121])("rejects age at or above 120 (%i)", (age) => {
    const form = validRegistrationForm();
    form.age = String(age);

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.age).toBe(AGE_TOO_HIGH_MESSAGE);
    }
  });

  it("accepts age 119", () => {
    const form = validRegistrationForm();
    form.age = "119";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) expect(result.payload.age).toBe(119);
  });

  it("rejects invalid graduation years", () => {
    const form = validRegistrationForm();
    form.graduationYear = "9000";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
  });

  it("requires hackathons attended as a whole number within range", () => {
    const missing = validateApplicationForm({
      ...validRegistrationForm(),
      hackathonsAttended: "",
    });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.errors.hackathonsAttended).toBe("Hackathons attended is required.");
    }

    const tooHigh = validateApplicationForm({
      ...validRegistrationForm(),
      hackathonsAttended: "101",
    });
    expect(tooHigh.success).toBe(false);
    if (!tooHigh.success) {
      expect(tooHigh.errors.hackathonsAttended).toContain("100");
    }

    const valid = validateApplicationForm({
      ...validRegistrationForm(),
      hackathonsAttended: "0",
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.payload.hackathonsAttended).toBe(0);
    }
  });

  it("requires country of residence with a friendly message", () => {
    const form = validRegistrationForm();
    form.countryOfResidence = "";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.countryOfResidence).toBe(
        "Please select your country of residence.",
      );
    }
  });

  it("requires a US state even when other answers are still incomplete", () => {
    const result = validateApplicationForm({
      ...INITIAL_FORM,
      countryOfResidence: "United States of America",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.stateOfResidence).toBe(
        "Please select your state or territory of residence.",
      );
    }
  });

  it("requires a US state or territory only when the country is the United States", () => {
    const form = validRegistrationForm();
    form.stateOfResidence = "";
    const missing = validateApplicationForm(form);
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.errors.stateOfResidence).toBe(
        "Please select your state or territory of residence.",
      );
    }

    form.stateOfResidence = "Not a state" as typeof form.stateOfResidence;
    expect(validateApplicationForm(form).success).toBe(false);

    form.countryOfResidence = "Canada";
    form.stateOfResidence = "";
    const outside = validateApplicationForm(form);
    expect(outside.success).toBe(true);
    if (outside.success) {
      expect(outside.payload.stateOfResidence).toBeUndefined();
    }

    form.stateOfResidence = "Outside the United States";
    const legacyOutside = validateApplicationForm(form);
    expect(legacyOutside.success).toBe(true);
    if (legacyOutside.success) {
      expect(legacyOutside.payload.stateOfResidence).toBeUndefined();
    }
  });

  it("requires an international student answer without requiring dietary restrictions", () => {
    const form = validRegistrationForm();
    form.internationalStudent = null;
    const unanswered = validateApplicationForm(form);
    expect(unanswered.success).toBe(false);
    if (!unanswered.success) {
      expect(unanswered.errors.internationalStudent).toBe(
        "Please let us know if you are an international student.",
      );
    }

    for (const answer of [true, false]) {
      form.internationalStudent = answer;
      const result = validateApplicationForm(form);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.payload.internationalStudent).toBe(answer);
        expect(result.payload.dietaryRestrictions).toEqual([]);
      }
    }
  });

  it.each([
    [["No Beef"] as const],
    [["No Pork"] as const],
    [["No Beef", "No Pork"] as const],
    [["Halal", "No Beef"] as const],
    [["Halal", "No Pork", "No Beef"] as const],
  ])("accepts independent dietary restriction selections %j", (dietaryRestrictions) => {
    const form = validRegistrationForm();
    form.dietaryRestrictions = [...dietaryRestrictions];

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.dietaryRestrictions).toEqual(dietaryRestrictions);
    }
  });

  it("rejects schools that are not on the MLH list", () => {
    const form = validRegistrationForm();
    form.school = "UT Arlington" as typeof form.school;

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.school).toContain("school");
    }
  });

  it("accepts a custom school when Other is selected", () => {
    const form = validRegistrationForm();
    form.school = SCHOOL_OTHER_OPTION;
    form.otherSchool = "My Local Community College";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.school).toBe(SCHOOL_OTHER_OPTION);
      expect(result.payload.otherSchool).toBe("My Local Community College");
    }
  });

  it("requires a school name when Other is selected", () => {
    const form = validRegistrationForm();
    form.school = SCHOOL_OTHER_OPTION;
    form.otherSchool = "";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.otherSchool).toBe(
        "Please enter your school or university name.",
      );
    }
  });

  it("accepts a custom hear-about response when Other is selected", () => {
    const form = validRegistrationForm();
    form.hearAbout = HEAR_ABOUT_OTHER_OPTION;
    form.otherHearAbout = "Professor announcement";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.hearAbout).toBe(HEAR_ABOUT_OTHER_OPTION);
      expect(result.payload.otherHearAbout).toBe("Professor announcement");
    }
  });

  it("requires a hear-about response when Other is selected", () => {
    const form = validRegistrationForm();
    form.hearAbout = HEAR_ABOUT_OTHER_OPTION;
    form.otherHearAbout = "";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.otherHearAbout).toBe(
        "Please tell us how you heard about HackUTA.",
      );
    }
  });

  it("accepts a custom level of study when Other is selected", () => {
    const form = validRegistrationForm();
    form.levelOfStudy = "Other";
    form.otherLevelOfStudy = "Gap year program";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.levelOfStudy).toBe("Other");
      expect(result.payload.otherLevelOfStudy).toBe("Gap year program");
    }
  });

  it("requires a level of study description when Other is selected", () => {
    const form = validRegistrationForm();
    form.levelOfStudy = "Other";
    form.otherLevelOfStudy = "";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.otherLevelOfStudy).toBe(
        "Please describe your level of study.",
      );
    }
  });

  it("accepts a custom major when Other is selected", () => {
    const form = validRegistrationForm();
    form.major = MAJOR_OTHER_OPTION;
    form.otherMajor = "Biomedical engineering";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.major).toBe(MAJOR_OTHER_OPTION);
      expect(result.payload.otherMajor).toBe("Biomedical engineering");
    }
  });

  it("requires a major description when Other is selected", () => {
    const form = validRegistrationForm();
    form.major = MAJOR_OTHER_OPTION;
    form.otherMajor = "";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.otherMajor).toBe(
        "Please describe your major or field of study.",
      );
    }
  });

  it("accepts a self-described gender when Prefer to self-describe is selected", () => {
    const form = validRegistrationForm();
    form.gender = GENDER_SELF_DESCRIBE_OPTION;
    form.otherGender = "Genderfluid";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.gender).toBe(GENDER_SELF_DESCRIBE_OPTION);
      expect(result.payload.otherGender).toBe("Genderfluid");
    }
  });

  it("requires a gender description when Prefer to self-describe is selected", () => {
    const form = validRegistrationForm();
    form.gender = GENDER_SELF_DESCRIBE_OPTION;
    form.otherGender = "";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.otherGender).toBe("Please describe your gender.");
    }
  });

  it("requires a race/ethnicity selection", () => {
    const form = validRegistrationForm();
    form.raceEthnicity = [];

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.raceEthnicity).toBe(
        "Please select your race or ethnicity.",
      );
    }
  });

  it("requires a race/ethnicity description even when other answers are still incomplete", () => {
    const result = validateApplicationForm({
      ...INITIAL_FORM,
      raceEthnicity: ["Other (Please Specify)"],
      otherRaceEthnicity: "   ",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.otherRaceEthnicity).toBe(
        "Please specify your race or ethnicity.",
      );
      expect(result.errors.firstName).toBe("First name is required.");
    }
  });

  it("accepts a custom race/ethnicity when Other (Please Specify) is selected", () => {
    const form = validRegistrationForm();
    form.raceEthnicity = ["Other (Please Specify)"];
    form.otherRaceEthnicity = "Multiracial";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.otherRaceEthnicity).toBe("Multiracial");
    }
  });

  it("requires a race/ethnicity description when Other (Please Specify) is selected", () => {
    const form = validRegistrationForm();
    form.raceEthnicity = ["Other (Please Specify)"];
    form.otherRaceEthnicity = "";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.otherRaceEthnicity).toBe(
        "Please specify your race or ethnicity.",
      );
    }
  });

  it("requires an allergy description even when other answers are still incomplete", () => {
    const result = validateApplicationForm({
      ...INITIAL_FORM,
      dietaryRestrictions: ["Allergies"],
      allergyDetails: "   ",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.allergyDetails).toBe("Please describe your food allergies.");
      expect(result.errors.firstName).toBe("First name is required.");
    }
  });

  it("requires a description when dietary Allergies is selected", () => {
    const form = validRegistrationForm();
    form.dietaryRestrictions = ["Allergies"];
    form.allergyDetails = "";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.allergyDetails).toBe("Please describe your food allergies.");
    }
  });

  it("allows blank other dietary restrictions without blocking submission", () => {
    const form = validRegistrationForm();
    form.otherDietaryRestrictions = "";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.otherDietaryRestrictions).toBeUndefined();
    }
  });

  it("trims and stores other dietary restrictions", () => {
    const form = validRegistrationForm();
    form.otherDietaryRestrictions = "  No shellfish  ";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.otherDietaryRestrictions).toBe("No shellfish");
    }
  });

  it("rejects other dietary restrictions that exceed the length limit", () => {
    const form = validRegistrationForm();
    form.otherDietaryRestrictions = "a".repeat(501);

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.otherDietaryRestrictions).toBe(
        "Other dietary restrictions are too long.",
      );
    }
  });

  it("allows blank student email without blocking submission", () => {
    const form = validRegistrationForm();
    form.studentEmail = "";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.studentEmail).toBeUndefined();
    }
  });

  it.each([
    "student@mail.utexas.edu",
    "sam@my-university.org",
    "  Student@School.Academy  ",
  ])("accepts valid student email addresses (%s)", (studentEmail) => {
    const form = validRegistrationForm();
    form.studentEmail = studentEmail;

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.studentEmail).toBe(studentEmail.trim().toLowerCase());
    }
  });

  it("rejects malformed student email addresses", () => {
    const form = validRegistrationForm();
    form.studentEmail = "not-an-email";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.studentEmail).toBe("Enter a valid student email address.");
    }
  });

  it("keeps allergy follow-up required even when other dietary restrictions are provided", () => {
    const form = validRegistrationForm();
    form.dietaryRestrictions = ["Allergies"];
    form.otherDietaryRestrictions = "Low sodium";
    form.allergyDetails = "";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.allergyDetails).toBe("Please describe your food allergies.");
    }
  });

  it("rejects invalid optional URLs", () => {
    const form = validRegistrationForm();
    form.github = "http://???";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.github).toBeTruthy();
    }
  });

  it.each([
    [
      "linkedin",
      "not-a-url",
      "Enter a valid LinkedIn link on linkedin.com, such as linkedin.com/in/yourname.",
    ],
    [
      "github",
      "not-a-url",
      "Enter a valid GitHub link on github.com, such as github.com/yourname.",
    ],
    ["portfolio", "ftp://example.com", "Enter a valid website link, such as yoursite.com."],
    [
      "devpost",
      "http://???",
      "Enter a valid Devpost link on devpost.com, such as devpost.com.",
    ],
  ] as const)("rejects invalid optional %s URLs", (field, value, message) => {
    const form = validRegistrationForm();
    form[field] = value;

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[field]).toBe(message);
    }
  });

  it.each([
    ["linkedin", "https://linkedin.com/in/sam", "https://linkedin.com/in/sam"],
    ["portfolio", "https://example.com/sam", "https://example.com/sam"],
    ["devpost", "https://devpost.com/hackuta-project", "https://devpost.com/hackuta-project"],
  ] as const)("accepts a valid optional %s URL", (field, value, expected) => {
    const form = validRegistrationForm();
    form[field] = value;

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload[field]).toBe(expected);
    }
  });

  it.each([
    ["linkedin", "www.linkedin.com/in/sam", "https://www.linkedin.com/in/sam"],
    ["github", "www.github.com/sam", "https://www.github.com/sam"],
    [
      "devpost",
      "www.devpost.com/hackuta-project",
      "https://www.devpost.com/hackuta-project",
    ],
  ] as const)("accepts official %s subdomains", (field, value, expected) => {
    const form = validRegistrationForm();
    form[field] = value;

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload[field]).toBe(expected);
    }
  });

  it.each([
    ["linkedin", "https://example.com/profile"],
    ["github", "https://example.com/user"],
    ["devpost", "https://example.com/project"],
  ] as const)("rejects non-%s domains in platform URL fields", (field, value) => {
    const form = validRegistrationForm();
    form[field] = value;

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[field]).toMatch(/^This must be a /);
    }
  });

  it.each([
    ["linkedin", "https://github.com@evil.com/in/sam"],
    ["github", "https://linkedin.com@evil.com/user"],
    ["devpost", "https://devpost.com@evil.com/project"],
  ] as const)("rejects userinfo phishing in optional %s URLs", (field, value) => {
    const form = validRegistrationForm();
    form[field] = value;

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[field]).toBeTruthy();
    }
  });

  it.each([
    ["linkedin", "linkedin.com/in/sam", "https://linkedin.com/in/sam"],
    ["github", "github.com/sam", "https://github.com/sam"],
    ["devpost", "devpost.com/hackuta-project", "https://devpost.com/hackuta-project"],
  ] as const)("normalizes optional %s URLs without a scheme", (field, value, expected) => {
    const form = validRegistrationForm();
    form[field] = value;

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload[field]).toBe(expected);
    }
  });

  it("omits empty optional profile URLs from the payload", () => {
    const form = validRegistrationForm();
    form.linkedin = "";
    form.github = "";
    form.portfolio = "";
    form.devpost = "";

    const result = validateApplicationForm(form);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.linkedin).toBeUndefined();
      expect(result.payload.github).toBeUndefined();
      expect(result.payload.portfolio).toBeUndefined();
      expect(result.payload.devpost).toBeUndefined();
    }
  });
});

describe("validateRegistrationPayload", () => {
  it.each(["internationalStudent"] as const)("rejects non-boolean %s values without coercion", (field) => {
    for (const value of [null, "true", "false", "Yes", "No", 0, 1]) {
      expect(validateRegistrationPayload({ ...validPayloadFromForm(), [field]: value }).success).toBe(false);
    }
  });

  it.each(["District of Columbia", "American Samoa", "Guam", "Northern Mariana Islands", "Puerto Rico", "U.S. Virgin Islands"])("accepts residence in %s", (stateOfResidence) => {
    const result = validateRegistrationPayload({ ...validPayloadFromForm(), stateOfResidence });
    expect(result.success).toBe(true);
    if (result.success) expect(result.payload.stateOfResidence).toBe(stateOfResidence);
  });

  it("accepts a valid payload", () => {
    const payload = validPayloadFromForm();
    const parsed = registrationPayloadSchema.safeParse(payload);

    expect(parsed.success).toBe(true);
    expect(validateRegistrationPayload(payload).success).toBe(true);
  });

  it("rejects submissions missing the new required answers", () => {
    const payload = validPayloadFromForm();
    const withoutState = { ...payload };
    delete (withoutState as Record<string, unknown>).stateOfResidence;
    expect(validateRegistrationPayload(withoutState).success).toBe(false);

    const withoutInternational = { ...payload };
    delete (withoutInternational as Record<string, unknown>).internationalStudent;
    expect(validateRegistrationPayload(withoutInternational).success).toBe(false);
  });

  it("accepts non-US submissions without a state of residence", () => {
    const payload = {
      ...validPayloadFromForm(),
      countryOfResidence: "Canada",
      stateOfResidence: undefined,
    };

    const result = validateRegistrationPayload(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.stateOfResidence).toBeUndefined();
    }
  });

  it("rejects invalid enum values", () => {
    const result = validateRegistrationPayload({
      ...validPayloadFromForm(),
      gender: "asdf",
    });

    expect(result.success).toBe(false);
  });

  it("rejects unexpected fields", () => {
    const result = validateRegistrationPayload({
      ...validPayloadFromForm(),
      injectedField: "nope",
    });

    expect(result.success).toBe(false);
  });

  it("rejects legacy beef and pork payload fields", () => {
    expect(
      validateRegistrationPayload({ ...validPayloadFromForm(), eatsBeef: false }).success,
    ).toBe(false);
    expect(
      validateRegistrationPayload({ ...validPayloadFromForm(), eatsPork: false }).success,
    ).toBe(false);
  });

  it("rejects bypass attempts with invalid age", () => {
    const result = validateRegistrationPayload({
      ...validPayloadFromForm(),
      age: -500,
    });

    expect(result.success).toBe(false);
  });

  it("rejects missing consent fields", () => {
    const result = validateRegistrationPayload({
      ...validPayloadFromForm(),
      mlhCodeOfConductAgreed: false,
    });

    expect(result.success).toBe(false);
  });

  it("requires mlhCodeOfConductAgreed with a specific error message", () => {
    const form = validRegistrationForm();
    form.mlhCodeOfConductAgreed = false;

    const result = validateApplicationForm(form);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.mlhCodeOfConductAgreed).toBe(
        "You must agree to the MLH Code of Conduct to continue.",
      );
    }
  });

  it("accepts optional profile URLs including devpost", () => {
    const result = validateRegistrationPayload({
      ...validPayloadFromForm(),
      linkedin: "https://linkedin.com/in/sam",
      github: "https://github.com/sam",
      portfolio: "https://example.com/sam",
      devpost: "https://devpost.com/hackuta-project",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.devpost).toBe(
        "https://devpost.com/hackuta-project",
      );
    }
  });
});

describe("isValidHttpUrl", () => {
  it("accepts http and https URLs", async () => {
    const { isValidHttpUrl } = await import("../../shared/registration/schema");
    expect(isValidHttpUrl("https://github.com/user")).toBe(true);
    expect(isValidHttpUrl("http://example.com")).toBe(true);
  });

  it("rejects invalid and non-http URLs", async () => {
    const { isValidHttpUrl } = await import("../../shared/registration/schema");
    expect(isValidHttpUrl("not-a-url")).toBe(false);
    expect(isValidHttpUrl("ftp://example.com")).toBe(false);
    expect(isValidHttpUrl("https://localhost")).toBe(true);
  });
});

describe("normalizeHttpUrl", () => {
  it("prepends https:// when the scheme is omitted", async () => {
    const { normalizeHttpUrl } = await import("../../shared/registration/schema");
    expect(normalizeHttpUrl("github.com/user")).toBe("https://github.com/user");
    expect(normalizeHttpUrl("linkedin.com/in/sam")).toBe("https://linkedin.com/in/sam");
  });

  it("preserves an existing http or https scheme", async () => {
    const { normalizeHttpUrl } = await import("../../shared/registration/schema");
    expect(normalizeHttpUrl("https://github.com/user")).toBe("https://github.com/user");
    expect(normalizeHttpUrl("http://example.com")).toBe("http://example.com");
  });

  it("returns null for invalid values", async () => {
    const { normalizeHttpUrl } = await import("../../shared/registration/schema");
    expect(normalizeHttpUrl("")).toBeNull();
    expect(normalizeHttpUrl("not-a-url")).toBeNull();
    expect(normalizeHttpUrl("ftp://example.com")).toBeNull();
    expect(normalizeHttpUrl("http://???")).toBeNull();
    expect(normalizeHttpUrl("https://github.com@evil.com/user")).toBeNull();
  });

  it("enforces platform base domains when provided", async () => {
    const { GITHUB_BASE_DOMAIN, normalizeHttpUrl } = await import(
      "../../shared/registration/schema"
    );
    expect(
      normalizeHttpUrl("github.com/user", { allowedBaseDomains: [GITHUB_BASE_DOMAIN] }),
    ).toBe("https://github.com/user");
    expect(
      normalizeHttpUrl("https://example.com/user", {
        allowedBaseDomains: [GITHUB_BASE_DOMAIN],
      }),
    ).toBeNull();
  });
});

describe("isValidPhone", () => {
  it("accepts local and international numbers with 10 to 15 digits", async () => {
    const { sanitizePhoneDigits, isValidPhone } = await import("../../shared/registration/schema");
    expect(sanitizePhoneDigits("123456789012345678")).toBe("123456789012345");
    expect(sanitizePhoneDigits("(202) 555-0123")).toBe("2025550123");
    expect(sanitizePhoneDigits("+44 20 7946 0958")).toBe("442079460958");
    expect(sanitizePhoneDigits("")).toBe("");
    expect(isValidPhone("5551234567")).toBe(true);
    expect(isValidPhone("202-555-0123")).toBe(true);
    expect(isValidPhone("+1 202-555-0123")).toBe(true);
    expect(isValidPhone("123456789012345")).toBe(true);
  });

  it("rejects too-short numbers", async () => {
    const { isValidPhone } = await import("../../shared/registration/schema");
    expect(isValidPhone("123")).toBe(false);
  });

  it("enforces digit count after stripping formatting", async () => {
    const { isValidPhone } = await import("../../shared/registration/schema");
    expect(isValidPhone("+354 555 123")).toBe(false);
    expect(isValidPhone("+1 202-555-01")).toBe(false);
    expect(isValidPhone("+1 (234) 567-8901-234")).toBe(true);
    expect(isValidPhone("1234567890123456")).toBe(false);
  });

});

describe("validateApplicationForm resume and error reporting", () => {
  it("accepts a valid PDF resume alongside a valid form", () => {
    const resume = new File(["%PDF-1.7"], "resume.pdf", { type: "application/pdf" });
    expect(validateApplicationForm({ ...validRegistrationForm(), resume }).success).toBe(true);
  });

  it("reports the resume error together with schema errors", () => {
    const resume = new File(["x"], "resume.exe", { type: "application/octet-stream" });
    const result = validateApplicationForm({ ...validRegistrationForm(), firstName: "", resume });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.resume).toBe("Please select a PDF file.");
      expect(result.errors.firstName).toBeTruthy();
    }
  });

  it("keeps only the first message per field", () => {
    const result = validateApplicationForm({ ...validRegistrationForm(), firstName: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.firstName).toBe("First name is required.");
  });

  it("fails on client-only conditional errors even when the payload parses", () => {
    const result = validateApplicationForm({
      ...validRegistrationForm(),
      school: "Definitely Not A Real School" as never,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.school).toBe("Please select a school from the list.");
  });
});

describe("validateRegistrationPayload", () => {
  it("returns only a failure flag so server callers never echo field details", () => {
    expect(validateRegistrationPayload({ firstName: "x" })).toEqual({ success: false });
    expect(validateRegistrationPayload(null)).toEqual({ success: false });
  });
});

describe("focusFirstInvalidField focus targets", () => {
  it("uses the mapped focus id for composite fields and tolerates missing elements", () => {
    expect(() => focusFirstInvalidField({ mlhCodeOfConductAgreed: "Required" })).not.toThrow();
  });
});

describe("toggleValue", () => {
  it("adds a value when it is not present", () => {
    expect(toggleValue(["A"], "B")).toEqual(["A", "B"]);
  });

  it("removes a value when it is already present", () => {
    expect(toggleValue(["A", "B"], "A")).toEqual(["B"]);
  });
});

describe("focusFirstInvalidField", () => {
  it("focuses the first invalid field in field order", () => {
    const element = document.createElement("input");
    element.id = "firstName";
    document.body.appendChild(element);
    const focusSpy = vi.spyOn(element, "focus");
    const scrollSpy = vi.spyOn(element, "scrollIntoView");

    focusFirstInvalidField({ lastName: "Required", firstName: "Required" });

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("no-ops when there are no errors", () => {
    expect(() => focusFirstInvalidField({})).not.toThrow();
  });
});
