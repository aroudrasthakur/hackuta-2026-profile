import type { ZodError } from "zod";
import {
  GENDER_SELF_DESCRIBE_OPTION,
  HEAR_ABOUT_OTHER_OPTION,
  LEVEL_OF_STUDY_OTHER_OPTION,
  MAJOR_OTHER_OPTION,
  SCHOOL_OTHER_OPTION,
} from "./constants";
import {
  EMERGENCY_CONTACT_REQUIRED_MESSAGES,
  missingEmergencyContactFields,
} from "./emergencyContact";
import { MLH_SCHOOLS_SET } from "./mlhSchools";
import { requiresUsState, stateForRegistrationPayload } from "./residence";
import { registrationPayloadSchema } from "./schema";
import { validateResume } from "./resume";
import type {
  ApplicationFormData,
  FieldName,
  RegistrationPayload,
} from "./types";
import { FIELD_FOCUS_IDS, FIELD_ORDER } from "./types";

export type FieldErrors = Partial<Record<FieldName, string>>;

function zodErrorToFieldErrors(error: ZodError): FieldErrors {
  const errors: FieldErrors = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || errors[field as FieldName]) continue;
    errors[field as FieldName] = issue.message;
  }

  return errors;
}

function buildRegistrationCandidate(form: ApplicationFormData) {
  return {
    firstName: form.firstName,
    lastName: form.lastName,
    phone: form.phone,
    phoneCountry: form.phoneCountry || undefined,
    age: form.age.trim() === "" ? Number.NaN : Number(form.age.trim()),
    school: form.school,
    otherSchool:
      form.school === SCHOOL_OTHER_OPTION ? form.otherSchool.trim() : "",
    studentEmail: form.studentEmail,
    countryOfResidence: form.countryOfResidence,
    stateOfResidence: stateForRegistrationPayload(
      form.countryOfResidence,
      form.stateOfResidence,
    ),
    internationalStudent: form.internationalStudent ?? undefined,
    levelOfStudy: form.levelOfStudy || undefined,
    otherLevelOfStudy:
      form.levelOfStudy === LEVEL_OF_STUDY_OTHER_OPTION
        ? form.otherLevelOfStudy.trim()
        : "",
    major: form.major,
    otherMajor:
      form.major === MAJOR_OTHER_OPTION ? form.otherMajor.trim() : "",
    graduationYear:
      form.graduationYear.trim() === ""
        ? Number.NaN
        : Number(form.graduationYear.trim()),
    gender: form.gender || undefined,
    otherGender:
      form.gender === GENDER_SELF_DESCRIBE_OPTION ? form.otherGender.trim() : "",
    raceEthnicity: form.raceEthnicity,
    otherRaceEthnicity: form.otherRaceEthnicity,
    dietaryRestrictions: form.dietaryRestrictions,
    allergyDetails: form.allergyDetails,
    otherDietaryRestrictions: form.otherDietaryRestrictions,
    tshirtSize: form.tshirtSize || undefined,
    experienceLevel: form.experienceLevel || undefined,
    hackathonsAttended:
      form.hackathonsAttended.trim() === ""
        ? Number.NaN
        : Number(form.hackathonsAttended.trim()),
    hearAbout: form.hearAbout,
    otherHearAbout:
      form.hearAbout === HEAR_ABOUT_OTHER_OPTION ? form.otherHearAbout.trim() : "",
    linkedin: form.linkedin,
    github: form.github,
    portfolio: form.portfolio,
    devpost: form.devpost,
    accessibilityNeeds: form.accessibilityNeeds,
    builtOrWantToBuild: form.builtOrWantToBuild,
    shortDeadlineLearning: form.shortDeadlineLearning,
    emergencyContactName: form.emergencyContactName,
    emergencyContactRelationship: form.emergencyContactRelationship,
    emergencyContactPhone: form.emergencyContactPhone,
    emergencyContactPhoneCountry: form.emergencyContactPhoneCountry || undefined,
    mlhCodeOfConductAgreed: form.mlhCodeOfConductAgreed ? true : undefined,
    mlhDataSharingConsent: form.mlhDataSharingConsent ? true : undefined,
    mlhCommunicationsConsent: form.mlhCommunicationsConsent,
    sponsorSharingConsent: form.sponsorSharingConsent,
    foodAllergyWaiverAgreed: form.foodAllergyWaiverAgreed ? true : undefined,
  };
}

function collectClientFieldErrors(form: ApplicationFormData): FieldErrors {
  const errors: FieldErrors = {};

  if (requiresUsState(form.countryOfResidence) && !form.stateOfResidence) {
    errors.stateOfResidence = "Please select your state or territory of residence.";
  }

  if (form.major === MAJOR_OTHER_OPTION && !form.otherMajor.trim()) {
    errors.otherMajor = "Please describe your major or field of study.";
  }

  if (
    form.levelOfStudy === LEVEL_OF_STUDY_OTHER_OPTION &&
    !form.otherLevelOfStudy.trim()
  ) {
    errors.otherLevelOfStudy = "Please describe your level of study.";
  }

  if (
    form.school &&
    form.school !== SCHOOL_OTHER_OPTION &&
    !MLH_SCHOOLS_SET.has(form.school)
  ) {
    errors.school = "Please select a school from the list.";
  }

  if (form.school === SCHOOL_OTHER_OPTION && !form.otherSchool.trim()) {
    errors.otherSchool = "Please enter your school or university name.";
  }

  if (form.hearAbout === HEAR_ABOUT_OTHER_OPTION && !form.otherHearAbout.trim()) {
    errors.otherHearAbout = "Please tell us how you heard about HackUTA.";
  }

  if (form.gender === GENDER_SELF_DESCRIBE_OPTION && !form.otherGender.trim()) {
    errors.otherGender = "Please describe your gender.";
  }

  if (
    form.raceEthnicity.includes("Other (Please Specify)") &&
    !form.otherRaceEthnicity.trim()
  ) {
    errors.otherRaceEthnicity = "Please specify your race or ethnicity.";
  }

  // Mirrors the schema's superRefine, which Zod skips while other fields are invalid.
  if (
    form.dietaryRestrictions.includes("Allergies") &&
    !form.allergyDetails.trim()
  ) {
    errors.allergyDetails = "Please describe your food allergies.";
  }

  for (const field of missingEmergencyContactFields(form)) {
    errors[field] = EMERGENCY_CONTACT_REQUIRED_MESSAGES[field];
  }

  return errors;
}

export function validateApplicationForm(form: ApplicationFormData):
  | { success: true; payload: RegistrationPayload }
  | { success: false; errors: FieldErrors } {
  const clientErrors = collectClientFieldErrors(form);
  const result = registrationPayloadSchema.safeParse(buildRegistrationCandidate(form));
  const errors = result.success ? {} : zodErrorToFieldErrors(result.error);
  Object.assign(errors, clientErrors);

  const resumeError = form.resume ? validateResume(form.resume) : undefined;
  if (resumeError) errors.resume = resumeError;

  if (!result.success || resumeError || Object.keys(clientErrors).length > 0) {
    return { success: false, errors };
  }

  return { success: true, payload: result.data };
}

export function validateRegistrationPayload(data: unknown):
  | { success: true; payload: RegistrationPayload }
  | { success: false } {
  const result = registrationPayloadSchema.safeParse(data);

  if (!result.success) {
    return { success: false };
  }

  return { success: true, payload: result.data };
}

export function focusFirstInvalidField(errors: FieldErrors) {
  const firstInvalidField = FIELD_ORDER.find((field) => errors[field]);
  if (!firstInvalidField) return;

  const elementId = FIELD_FOCUS_IDS[firstInvalidField] ?? firstInvalidField;
  const element = document.getElementById(elementId);

  element?.scrollIntoView({ behavior: "smooth", block: "center" });

  if (element instanceof HTMLElement) {
    element.focus({ preventScroll: true });
  }
}

export function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}
