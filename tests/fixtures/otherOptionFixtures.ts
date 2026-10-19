import {
  GENDER_SELF_DESCRIBE_OPTION,
  HEAR_ABOUT_OTHER_OPTION,
  LEVEL_OF_STUDY_OTHER_OPTION,
  MAJOR_OTHER_OPTION,
  SCHOOL_OTHER_OPTION,
} from "../../shared/registration/constants";
import type { ApplicationFormData } from "../../shared/registration/types";
import { validRegistrationForm } from "./validRegistrationForm";

/** Custom free-text values used across other-option regression tests. */
export const OTHER_OPTION_FIXTURES = {
  school: "Mars Academy",
  levelOfStudy: "Gap year program",
  major: "Space Law",
  gender: "Genderfluid",
  /** Not a listed hear-about option — avoids ambiguity with "A friend". */
  hearAbout: "Professor announcement",
  raceEthnicity: "Multiracial",
} as const;

/** Form with every Other / self-describe sentinel selected and follow-up text filled. */
export function formWithAllOtherOptions(): ApplicationFormData {
  return {
    ...validRegistrationForm(),
    school: SCHOOL_OTHER_OPTION,
    otherSchool: OTHER_OPTION_FIXTURES.school,
    levelOfStudy: LEVEL_OF_STUDY_OTHER_OPTION,
    otherLevelOfStudy: OTHER_OPTION_FIXTURES.levelOfStudy,
    major: MAJOR_OTHER_OPTION,
    otherMajor: OTHER_OPTION_FIXTURES.major,
    gender: GENDER_SELF_DESCRIBE_OPTION,
    otherGender: OTHER_OPTION_FIXTURES.gender,
    hearAbout: HEAR_ABOUT_OTHER_OPTION,
    otherHearAbout: OTHER_OPTION_FIXTURES.hearAbout,
    raceEthnicity: ["Other (Please Specify)"],
    otherRaceEthnicity: OTHER_OPTION_FIXTURES.raceEthnicity,
  };
}

/** Stored application columns for split other-option round-trip tests. */
export function storedApplicationWithAllOtherOptions() {
  return {
    school: SCHOOL_OTHER_OPTION,
    otherSchool: OTHER_OPTION_FIXTURES.school,
    levelOfStudy: LEVEL_OF_STUDY_OTHER_OPTION,
    otherLevelOfStudy: OTHER_OPTION_FIXTURES.levelOfStudy,
    major: MAJOR_OTHER_OPTION,
    otherMajor: OTHER_OPTION_FIXTURES.major,
    gender: GENDER_SELF_DESCRIBE_OPTION,
    otherGender: OTHER_OPTION_FIXTURES.gender,
    hearAbout: HEAR_ABOUT_OTHER_OPTION,
    otherHearAbout: OTHER_OPTION_FIXTURES.hearAbout,
    raceEthnicity: ["Other (Please Specify)"],
    otherRaceEthnicity: OTHER_OPTION_FIXTURES.raceEthnicity,
    mlhCodeOfConductAgreed: true,
  };
}
