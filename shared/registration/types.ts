import type { z } from "zod";
import type { CountryCode } from "libphonenumber-js/min";
import type { CountryOfResidence } from "./countries";
import type {
  DIETARY_OPTIONS,
  EXPERIENCE_LEVELS,
  GENDERS,
  HEAR_ABOUT_OPTIONS,
  LEVELS_OF_STUDY,
  MAJORS,
  RACE_ETHNICITY_OPTIONS,
  SCHOOL_OTHER_OPTION,
  STATES_OF_RESIDENCE,
  TSHIRT_SIZES,
} from "./constants";
import type { MlhSchool } from "./mlhSchools";
import { createEmptyApplicantFormValues } from "./applicantFields";
import { registrationPayloadSchema } from "./schema";

export type LevelOfStudy = (typeof LEVELS_OF_STUDY)[number];
export type Gender = (typeof GENDERS)[number];
export type RaceEthnicity = (typeof RACE_ETHNICITY_OPTIONS)[number];
export type DietaryOption = (typeof DIETARY_OPTIONS)[number];
export type Major = (typeof MAJORS)[number];
export type TshirtSize = (typeof TSHIRT_SIZES)[number];
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
export type HearAboutOption = (typeof HEAR_ABOUT_OPTIONS)[number];
export type StateOfResidence = (typeof STATES_OF_RESIDENCE)[number];

/** UI form state — union refinements for selects; `resume` is client-only. */
export type ApplicationFormData = {
  firstName: string;
  lastName: string;
  phone: string;
  phoneCountry: CountryCode | "";
  age: string;
  school: MlhSchool | typeof SCHOOL_OTHER_OPTION | "";
  otherSchool: string;
  studentEmail: string;
  countryOfResidence: CountryOfResidence | "";
  stateOfResidence: StateOfResidence | "";
  levelOfStudy: LevelOfStudy | "";
  otherLevelOfStudy: string;
  major: Major | "";
  otherMajor: string;
  graduationYear: string;
  gender: Gender | "";
  otherGender: string;
  raceEthnicity: RaceEthnicity[];
  otherRaceEthnicity: string;
  dietaryRestrictions: DietaryOption[];
  allergyDetails: string;
  otherDietaryRestrictions: string;
  tshirtSize: TshirtSize | "";
  experienceLevel: ExperienceLevel | "";
  hackathonsAttended: string;
  internationalStudent: boolean | null;
  hearAbout: HearAboutOption | "";
  otherHearAbout: string;
  resume: File | null;
  linkedin: string;
  devpost: string;
  github: string;
  portfolio: string;
  accessibilityNeeds: string;
  builtOrWantToBuild: string;
  shortDeadlineLearning: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
  emergencyContactPhoneCountry: CountryCode | "";
  mlhCodeOfConductAgreed: boolean;
  mlhDataSharingConsent: boolean;
  mlhCommunicationsConsent: boolean;
  sponsorSharingConsent: boolean;
  foodAllergyWaiverAgreed: boolean;
};

export type RegistrationPayload = z.infer<typeof registrationPayloadSchema>;

export type FieldName = keyof ApplicationFormData;

export const FIELD_ORDER: FieldName[] = [
  "firstName",
  "lastName",
  "phone",
  "age",
  "school",
  "otherSchool",
  "studentEmail",
  "countryOfResidence",
  "stateOfResidence",
  "internationalStudent",
  "levelOfStudy",
  "otherLevelOfStudy",
  "major",
  "otherMajor",
  "graduationYear",
  "gender",
  "otherGender",
  "raceEthnicity",
  "otherRaceEthnicity",
  "allergyDetails",
  "otherDietaryRestrictions",
  "dietaryRestrictions",
  "tshirtSize",
  "hackathonsAttended",
  "experienceLevel",
  "builtOrWantToBuild",
  "shortDeadlineLearning",
  "hearAbout",
  "otherHearAbout",
  "resume",
  "linkedin",
  "github",
  "portfolio",
  "devpost",
  "emergencyContactName",
  "emergencyContactRelationship",
  "emergencyContactPhone",
  "mlhCodeOfConductAgreed",
  "mlhDataSharingConsent",
  "foodAllergyWaiverAgreed",
];

export const INITIAL_FORM: ApplicationFormData = {
  ...(createEmptyApplicantFormValues() as Omit<ApplicationFormData, "resume">),
  resume: null,
};

/** Maps validation keys to DOM ids used for focus management. */
export const FIELD_FOCUS_IDS: Partial<Record<FieldName, string>> = {
  studentEmail: "studentEmail",
  internationalStudent: "internationalStudent-yes",
  raceEthnicity: "race-asian-indian",
  hackathonsAttended: "hackathonsAttended",
  allergyDetails: "allergyDetails",
  resume: "resume-upload",
  mlhCodeOfConductAgreed: "mlhCodeOfConductAgreed",
  mlhDataSharingConsent: "mlhDataSharingConsent",
  foodAllergyWaiverAgreed: "foodAllergyWaiverAgreed",
};
