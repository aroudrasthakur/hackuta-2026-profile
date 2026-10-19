/**
 * Single source of truth for applicant answer field names and storage/draft kinds.
 * Convex validators, draft autosave, and form defaults derive from these lists.
 */

/** Trimmed on draft save; stored as optional string on applications. */
export const TRIMMED_STRING_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "studentEmail",
  "otherRaceEthnicity",
  "allergyDetails",
  "otherDietaryRestrictions",
  "linkedin",
  "github",
  "portfolio",
  "devpost",
  "accessibilityNeeds",
  "builtOrWantToBuild",
  "shortDeadlineLearning",
  "emergencyContactName",
  "emergencyContactRelationship",
  "emergencyContactPhone",
] as const;

/** Stored as-is from selects/text; cleared with "" on draft save. */
export const PLAIN_STRING_FIELDS = [
  "phoneCountry",
  "emergencyContactPhoneCountry",
  "school",
  "countryOfResidence",
  "stateOfResidence",
  "levelOfStudy",
  "major",
  "gender",
  "tshirtSize",
  "experienceLevel",
  "hearAbout",
] as const;

/** Cleared when parent select is not "Other"; trimmed when active. */
export const CONDITIONAL_STRING_FIELDS = [
  "otherSchool",
  "otherLevelOfStudy",
  "otherMajor",
  "otherHearAbout",
  "otherGender",
] as const;

export const OPTIONAL_INT_FIELDS = ["age", "graduationYear", "hackathonsAttended"] as const;

export const STRING_ARRAY_FIELDS = ["raceEthnicity", "dietaryRestrictions"] as const;

export const NULLABLE_BOOLEAN_FIELDS = ["internationalStudent"] as const;

export const REQUIRED_BOOLEAN_FIELDS = [
  "mlhCodeOfConductAgreed",
  "mlhDataSharingConsent",
  "mlhCommunicationsConsent",
  "sponsorSharingConsent",
  "foodAllergyWaiverAgreed",
] as const;

/** Applicant answer columns on `applications` and autosave draft patch keys. */
export const APPLICANT_ANSWER_FIELD_KEYS = [
  ...TRIMMED_STRING_FIELDS,
  ...PLAIN_STRING_FIELDS,
  ...CONDITIONAL_STRING_FIELDS,
  ...OPTIONAL_INT_FIELDS,
  ...STRING_ARRAY_FIELDS,
  ...NULLABLE_BOOLEAN_FIELDS,
  ...REQUIRED_BOOLEAN_FIELDS,
] as const;

/** @deprecated Use APPLICANT_ANSWER_FIELD_KEYS */
export const DRAFT_PATCH_FIELD_KEYS = APPLICANT_ANSWER_FIELD_KEYS;

export type ApplicantAnswerFieldKey = (typeof APPLICANT_ANSWER_FIELD_KEYS)[number];
export type DraftPatchFieldKey = ApplicantAnswerFieldKey;

type TrimmedStringField = (typeof TRIMMED_STRING_FIELDS)[number];
type PlainStringField = (typeof PLAIN_STRING_FIELDS)[number];
type ConditionalStringField = (typeof CONDITIONAL_STRING_FIELDS)[number];
type OptionalIntField = (typeof OPTIONAL_INT_FIELDS)[number];
type StringArrayField = (typeof STRING_ARRAY_FIELDS)[number];
type NullableBooleanField = (typeof NULLABLE_BOOLEAN_FIELDS)[number];
type RequiredBooleanField = (typeof REQUIRED_BOOLEAN_FIELDS)[number];

export type SavedResumeDraft = {
  storageId: string;
  filename: string;
};

export type DraftPatchPayload = Record<TrimmedStringField, string> &
  Record<PlainStringField, string> &
  Record<ConditionalStringField, string> &
  Record<OptionalIntField, number | null> &
  Record<StringArrayField, string[]> &
  Record<NullableBooleanField, boolean | null> &
  Record<RequiredBooleanField, boolean> & {
    /** Null clears a previously saved draft resume. */
    resumeStorageId?: string | null;
    /** Empty string clears stored resume display metadata. */
    resumeFilename?: string;
  };

/** Empty applicant form values (excludes UI-only `resume`). */
export function createEmptyApplicantFormValues(): Record<ApplicantAnswerFieldKey, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of TRIMMED_STRING_FIELDS) values[key] = "";
  for (const key of PLAIN_STRING_FIELDS) values[key] = "";
  for (const key of CONDITIONAL_STRING_FIELDS) values[key] = "";
  for (const key of OPTIONAL_INT_FIELDS) values[key] = "";
  for (const key of STRING_ARRAY_FIELDS) values[key] = [];
  for (const key of NULLABLE_BOOLEAN_FIELDS) values[key] = null;
  for (const key of REQUIRED_BOOLEAN_FIELDS) values[key] = false;
  return values;
}

export function isClearedDraftValue(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "string" && value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}
