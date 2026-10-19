import {
  GENDER_SELF_DESCRIBE_OPTION,
  GENDERS,
  HEAR_ABOUT_OPTIONS,
  HEAR_ABOUT_OTHER_OPTION,
  MAJOR_OTHER_OPTION,
  MAJORS,
  SCHOOL_OTHER_OPTION,
} from "./constants";
import { MLH_SCHOOLS_SET } from "./mlhSchools";

export const LEGACY_SCHOOL_OTHER_OPTION = "Other:" as const;

const MAJORS_SET = new Set<string>(MAJORS);
const HEAR_ABOUT_OPTIONS_SET = new Set<string>(HEAR_ABOUT_OPTIONS);
const GENDERS_SET = new Set<string>(GENDERS);

export function normalizeLegacySchoolSentinel(school?: string | null): string {
  const trimmed = school?.trim() ?? "";
  if (trimmed === LEGACY_SCHOOL_OTHER_OPTION) {
    return SCHOOL_OTHER_OPTION;
  }
  return trimmed;
}

export function splitLegacySchool(
  school?: string | null,
  otherSchool?: string | null,
): { school: string; otherSchool: string } {
  const normalizedSchool = normalizeLegacySchoolSentinel(school);
  const storedOther = otherSchool?.trim() ?? "";

  if (normalizedSchool === SCHOOL_OTHER_OPTION) {
    return { school: SCHOOL_OTHER_OPTION, otherSchool: storedOther };
  }

  if (normalizedSchool && !MLH_SCHOOLS_SET.has(normalizedSchool)) {
    return {
      school: SCHOOL_OTHER_OPTION,
      otherSchool: storedOther || normalizedSchool,
    };
  }

  return { school: normalizedSchool, otherSchool: storedOther };
}

export function splitLegacyMajor(
  major?: string | null,
  otherMajor?: string | null,
): { major: string; otherMajor: string } {
  const normalizedMajor = major?.trim() ?? "";
  const storedOther = otherMajor?.trim() ?? "";

  if (normalizedMajor === MAJOR_OTHER_OPTION) {
    return { major: MAJOR_OTHER_OPTION, otherMajor: storedOther };
  }

  if (normalizedMajor && !MAJORS_SET.has(normalizedMajor)) {
    return {
      major: MAJOR_OTHER_OPTION,
      otherMajor: storedOther || normalizedMajor,
    };
  }

  return { major: normalizedMajor, otherMajor: storedOther };
}

export function splitLegacyHearAbout(
  hearAbout?: string | null,
  otherHearAbout?: string | null,
): { hearAbout: string; otherHearAbout: string } {
  const normalizedHearAbout = hearAbout?.trim() ?? "";
  const storedOther = otherHearAbout?.trim() ?? "";

  if (normalizedHearAbout === HEAR_ABOUT_OTHER_OPTION) {
    return { hearAbout: HEAR_ABOUT_OTHER_OPTION, otherHearAbout: storedOther };
  }

  if (normalizedHearAbout && !HEAR_ABOUT_OPTIONS_SET.has(normalizedHearAbout)) {
    return {
      hearAbout: HEAR_ABOUT_OTHER_OPTION,
      otherHearAbout: storedOther || normalizedHearAbout,
    };
  }

  return { hearAbout: normalizedHearAbout, otherHearAbout: storedOther };
}

export function splitLegacyGender(
  gender?: string | null,
  otherGender?: string | null,
): { gender: string; otherGender: string } {
  const normalizedGender = gender?.trim() ?? "";
  const storedOther = otherGender?.trim() ?? "";

  if (normalizedGender === GENDER_SELF_DESCRIBE_OPTION) {
    return { gender: GENDER_SELF_DESCRIBE_OPTION, otherGender: storedOther };
  }

  if (normalizedGender && !GENDERS_SET.has(normalizedGender)) {
    return {
      gender: GENDER_SELF_DESCRIBE_OPTION,
      otherGender: storedOther || normalizedGender,
    };
  }

  return { gender: normalizedGender, otherGender: storedOther };
}
