import { z } from "zod";
import { getCountries, type CountryCode } from "libphonenumber-js/max";
import { containsDangerousMarkup, sanitizePlainText } from "../lib/sanitizeInput";
import { COUNTRIES_OF_RESIDENCE } from "./countries";
import {
  AGE_TOO_HIGH_MESSAGE,
  APPLICATION_QUESTIONS,
  DIETARY_OPTIONS,
  EXPERIENCE_LEVELS,
  FIELD_LIMITS,
  GENDERS,
  GENDER_SELF_DESCRIBE_OPTION,
  HEAR_ABOUT_OPTIONS,
  HEAR_ABOUT_OTHER_OPTION,
  LEVEL_OF_STUDY_OTHER_OPTION,
  LEVELS_OF_STUDY,
  MAJOR_OTHER_OPTION,
  MAJORS,
  MAX_AGE,
  MAX_GRADUATION_YEAR,
  MAX_HACKATHONS_ATTENDED,
  MIN_AGE,
  MIN_GRADUATION_YEAR,
  MIN_HACKATHONS_ATTENDED,
  RACE_ETHNICITY_OPTIONS,
  SCHOOL_OTHER_OPTION,
  TSHIRT_SIZES,
} from "./constants";
import { isValidEmailSyntax, normalizeEmail } from "../lib/normalizeEmail";
import {
  EMERGENCY_CONTACT_REQUIRED_MESSAGES,
  missingEmergencyContactFields,
} from "./emergencyContact";
import { MLH_SCHOOLS_SET } from "./mlhSchools";
import { isUsaCountry, US_STATE_OPTIONS } from "./residence";

export const MAX_PHONE_DIGITS = 15;

export function sanitizePhoneDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, MAX_PHONE_DIGITS);
}

export function isValidPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= MAX_PHONE_DIGITS;
}

export function formatUsPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function normalizePhone(value: string, country?: CountryCode) {
  const digits = value.replace(/\D/g, "");
  if (!value.trim().startsWith("+") && digits.length === 10 && (!country || country === "US")) {
    return formatUsPhone(value);
  }
  return value.trim().startsWith("+") ? `+${digits}` : value.trim();
}

const HTTP_URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export const LINKEDIN_BASE_DOMAIN = "linkedin.com";
export const GITHUB_BASE_DOMAIN = "github.com";
export const DEVPOST_BASE_DOMAIN = "devpost.com";

export function hostnameMatchesBaseDomain(hostname: string, baseDomain: string) {
  const host = hostname.toLowerCase();
  const base = baseDomain.toLowerCase();
  return host === base || host.endsWith(`.${base}`);
}

export function isValidHttpUrl(
  value: string,
  options?: { allowedBaseDomains?: readonly string[] },
) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    if (!url.hostname) {
      return false;
    }
    if (url.username || url.password) {
      return false;
    }
    if (url.hostname !== "localhost" && !url.hostname.includes(".")) {
      return false;
    }
    if (options?.allowedBaseDomains?.length) {
      return options.allowedBaseDomains.some((domain) =>
        hostnameMatchesBaseDomain(url.hostname, domain),
      );
    }
    return true;
  } catch {
    return false;
  }
}

/** Prepends https:// when missing and returns a normalized URL, or null if invalid. */
export function normalizeHttpUrl(
  value: string,
  options?: { allowedBaseDomains?: readonly string[] },
): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = HTTP_URL_SCHEME_PATTERN.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  return isValidHttpUrl(candidate, options) ? candidate : null;
}

function safePlainText(options: {
  max: number;
  min?: number;
  message?: string;
  tooLongMessage?: string;
  allowNewlines?: boolean;
}) {
  const {
    max,
    min = 1,
    message = "Invalid input.",
    tooLongMessage = `Must be at most ${max.toLocaleString()} characters.`,
    allowNewlines = false,
  } = options;
  return z
    .string()
    .transform((value) => sanitizePlainText(value, { allowNewlines }))
    .pipe(
      z
        .string()
        .min(min, message)
        .max(max, tooLongMessage)
        .refine(
          (value) => !containsDangerousMarkup(value),
          "Please remove HTML or script content.",
        ),
    );
}

function safeOptionalPlainText(options: {
  max: number;
  allowNewlines?: boolean;
  tooLongMessage?: string;
}) {
  const {
    max,
    allowNewlines = false,
    tooLongMessage = "Text is too long.",
  } = options;
  return z
    .string()
    .transform((value) => sanitizePlainText(value, { allowNewlines }))
    .pipe(
      z
        .string()
        .max(max, tooLongMessage)
        .refine(
          (value) => value === "" || !containsDangerousMarkup(value),
          "Please remove HTML or script content.",
        ),
    )
    .optional()
    .transform((value) => value || undefined);
}

function optionalEmail(message = "Enter a valid student email address.") {
  return z
    .string()
    .transform((value) => sanitizePlainText(value).trim())
    .pipe(
      z
        .string()
        .max(FIELD_LIMITS.email, "Student email is too long.")
        .refine(
          (value) => value === "" || !containsDangerousMarkup(value),
          "Please remove HTML or script content.",
        ),
    )
    .optional()
    .transform((value) => normalizeEmail(value))
    .refine(
      (value) => value === undefined || isValidEmailSyntax(value),
      message,
    );
}

function optionalHttpUrl(
  label: string,
  example: string,
  allowedBaseDomain?: string,
) {
  const invalidMessage = allowedBaseDomain
    ? `Enter a valid ${label} link on ${allowedBaseDomain}, such as ${example}.`
    : `Enter a valid ${label} link, such as ${example}.`;
  const wrongDomainMessage = allowedBaseDomain
    ? `This must be a ${label} link on ${allowedBaseDomain}, such as ${example}.`
    : invalidMessage;

  return z
    .string()
    .trim()
    .max(FIELD_LIMITS.url, `${label} is too long.`)
    .optional()
    .transform((value, ctx) => {
      if (!value) {
        return undefined;
      }

      const normalized = normalizeHttpUrl(value);
      if (!normalized) {
        ctx.addIssue({ code: "custom", message: invalidMessage });
        return z.NEVER;
      }

      if (
        allowedBaseDomain &&
        !hostnameMatchesBaseDomain(new URL(normalized).hostname, allowedBaseDomain)
      ) {
        ctx.addIssue({ code: "custom", message: wrongDomainMessage });
        return z.NEVER;
      }

      return normalized;
    });
}

const COUNTRIES_SET = new Set<string>(COUNTRIES_OF_RESIDENCE);
const MAJORS_SET = new Set<string>(MAJORS);
const HEAR_ABOUT_OPTIONS_SET = new Set<string>(HEAR_ABOUT_OPTIONS);

const levelOfStudySchema = z.enum(LEVELS_OF_STUDY, {
  message: "Please select a level of study.",
});
const genderSchema = z.enum(GENDERS, { message: "Please select a gender." });
const raceEthnicitySchema = z.enum(RACE_ETHNICITY_OPTIONS);
const dietaryOptionSchema = z.enum(DIETARY_OPTIONS);
const tshirtSizeSchema = z.enum(TSHIRT_SIZES, {
  message: "Please select a t-shirt size.",
});
const experienceLevelSchema = z.enum(EXPERIENCE_LEVELS, {
  message: "Please select your experience level.",
});
const requiredInteger = (label: string, min: number, max: number) =>
  z
    .number({ message: `${label} is required.` })
    .refine((value) => !Number.isNaN(value), `${label} is required.`)
    .pipe(
      z
        .number()
        .int(`${label} must be a whole number.`)
        .min(min, `${label} must be between ${min} and ${max}.`)
        .max(max, `${label} must be between ${min} and ${max}.`),
    );

const ageSchema = z
  .number({ message: "Age is required." })
  .refine((value) => !Number.isNaN(value), "Age is required.")
  .pipe(
    z
      .number()
      .int("Age must be a whole number.")
      .min(MIN_AGE, `Age must be between ${MIN_AGE} and ${MAX_AGE}.`)
      .refine((value) => value < MAX_AGE + 1, AGE_TOO_HIGH_MESSAGE),
  );

const usStateSchema = z.enum(US_STATE_OPTIONS);

export const registrationPayloadSchema = z
  .object({
    firstName: safePlainText({
      max: FIELD_LIMITS.name,
      message: "First name is required.",
    }),
    lastName: safePlainText({
      max: FIELD_LIMITS.name,
      message: "Last name is required.",
    }),
    phone: safePlainText({
      max: FIELD_LIMITS.phone,
      message: "Phone number is required.",
    })
      .refine(isValidPhone, "Enter a valid phone number."),
    phoneCountry: z.enum(getCountries()).optional(),
    age: ageSchema,
    school: safePlainText({
      max: FIELD_LIMITS.school,
      message: "Please select a school or university.",
    }).refine(
      (value) => MLH_SCHOOLS_SET.has(value) || value === SCHOOL_OTHER_OPTION,
      "Please select a school from the list.",
    ),
    otherSchool: safeOptionalPlainText({
      max: FIELD_LIMITS.otherSchool,
      tooLongMessage: "School name is too long.",
    }),
    studentEmail: optionalEmail(),
    countryOfResidence: safePlainText({
      max: 100,
      message: "Please select your country of residence.",
    }).refine((value) => COUNTRIES_SET.has(value), "Please select a country from the list."),
    stateOfResidence: usStateSchema.optional(),
    internationalStudent: z.boolean({
      message: "Please let us know if you are an international student.",
    }),
    levelOfStudy: levelOfStudySchema,
    otherLevelOfStudy: safeOptionalPlainText({
      max: FIELD_LIMITS.otherLevelOfStudy,
      tooLongMessage: "Level of study description is too long.",
    }),
    major: safePlainText({
      max: FIELD_LIMITS.major,
      message: "Please select a major or field of study.",
    }).refine((value) => MAJORS_SET.has(value), "Please select a major from the list."),
    otherMajor: safeOptionalPlainText({
      max: FIELD_LIMITS.otherMajor,
      tooLongMessage: "Major description is too long.",
    }),
    graduationYear: requiredInteger(
      "Graduation year",
      MIN_GRADUATION_YEAR,
      MAX_GRADUATION_YEAR,
    ),
    gender: genderSchema,
    otherGender: safeOptionalPlainText({
      max: FIELD_LIMITS.otherGender,
      tooLongMessage: "Gender description is too long.",
    }),
    raceEthnicity: z
      .array(raceEthnicitySchema)
      .min(1, "Please select your race or ethnicity.")
      .max(RACE_ETHNICITY_OPTIONS.length)
      .transform((values) => [...new Set(values)]),
    otherRaceEthnicity: safeOptionalPlainText({
      max: FIELD_LIMITS.otherRaceEthnicity,
      tooLongMessage: "Race / ethnicity details are too long.",
    }),
    dietaryRestrictions: z
      .array(dietaryOptionSchema)
      .max(DIETARY_OPTIONS.length)
      .transform((values) => [...new Set(values)])
      .default([]),
    allergyDetails: safeOptionalPlainText({
      max: FIELD_LIMITS.allergyDetails,
      tooLongMessage: "Allergy details are too long.",
    }),
    otherDietaryRestrictions: safeOptionalPlainText({
      max: FIELD_LIMITS.otherDietaryRestrictions,
      tooLongMessage: "Other dietary restrictions are too long.",
    }),
    tshirtSize: tshirtSizeSchema,
    experienceLevel: experienceLevelSchema,
    hackathonsAttended: requiredInteger(
      "Hackathons attended",
      MIN_HACKATHONS_ATTENDED,
      MAX_HACKATHONS_ATTENDED,
    ),
    hearAbout: safePlainText({
      max: FIELD_LIMITS.hearAbout,
      message: "Please select how you heard about HackUTA.",
    }).refine(
      (value) => HEAR_ABOUT_OPTIONS_SET.has(value),
      "Please select how you heard about HackUTA.",
    ),
    otherHearAbout: safeOptionalPlainText({
      max: FIELD_LIMITS.otherHearAbout,
      tooLongMessage: "Response is too long.",
    }),
    resumeStorageId: z.string().min(1).max(128).optional(),
    linkedin: optionalHttpUrl(
      "LinkedIn",
      "linkedin.com/in/yourname",
      LINKEDIN_BASE_DOMAIN,
    ),
    github: optionalHttpUrl("GitHub", "github.com/yourname", GITHUB_BASE_DOMAIN),
    portfolio: optionalHttpUrl("website", "yoursite.com"),
    devpost: optionalHttpUrl(
      "Devpost",
      "devpost.com",
      DEVPOST_BASE_DOMAIN,
    ),
    accessibilityNeeds: safeOptionalPlainText({
      max: FIELD_LIMITS.accessibilityNeeds,
      allowNewlines: true,
      tooLongMessage: "Accessibility details are too long.",
    }),
    builtOrWantToBuild: safePlainText({
      max: FIELD_LIMITS.builtOrWantToBuild,
      allowNewlines: true,
      message: `${APPLICATION_QUESTIONS.builtOrWantToBuild}.`,
      tooLongMessage: `Response is too long (maximum ${FIELD_LIMITS.builtOrWantToBuild.toLocaleString()} characters).`,
    }),
    shortDeadlineLearning: safePlainText({
      max: FIELD_LIMITS.shortDeadlineLearning,
      allowNewlines: true,
      message: `${APPLICATION_QUESTIONS.shortDeadlineLearning}.`,
      tooLongMessage: `Response is too long (maximum ${FIELD_LIMITS.shortDeadlineLearning.toLocaleString()} characters).`,
    }),
    emergencyContactName: safeOptionalPlainText({
      max: FIELD_LIMITS.name,
      tooLongMessage: "Emergency contact name is too long.",
    }),
    emergencyContactRelationship: safeOptionalPlainText({
      max: FIELD_LIMITS.emergencyContactRelationship,
      tooLongMessage: "Emergency contact relationship is too long.",
    }),
    emergencyContactPhone: safeOptionalPlainText({
      max: FIELD_LIMITS.phone,
      tooLongMessage: "Emergency contact phone is too long.",
    }).refine(
      (value) => value === undefined || isValidPhone(value),
      "Enter a valid phone number.",
    ),
    emergencyContactPhoneCountry: z.enum(getCountries()).optional(),
    mlhCodeOfConductAgreed: z.literal(true, {
      message: "You must agree to the MLH Code of Conduct to continue.",
    }),
    mlhDataSharingConsent: z.literal(true, {
      message: "You must authorize sharing your info with MLH to register.",
    }),
    mlhCommunicationsConsent: z.boolean(),
    sponsorSharingConsent: z.boolean(),
    foodAllergyWaiverAgreed: z.literal(true, {
      message: "You must acknowledge the food allergy liability waiver to continue.",
    }),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (isUsaCountry(data.countryOfResidence) && !data.stateOfResidence) {
      ctx.addIssue({
        code: "custom",
        path: ["stateOfResidence"],
        message: "Please select your state or territory of residence.",
      });
    }

    if (data.dietaryRestrictions.includes("Allergies") && !data.allergyDetails) {
      ctx.addIssue({
        code: "custom",
        path: ["allergyDetails"],
        message: "Please describe your food allergies.",
      });
    }
    for (const field of missingEmergencyContactFields(data)) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: EMERGENCY_CONTACT_REQUIRED_MESSAGES[field],
      });
    }
    if (data.raceEthnicity.includes("Other (Please Specify)") && !data.otherRaceEthnicity) {
      ctx.addIssue({
        code: "custom",
        path: ["otherRaceEthnicity"],
        message: "Please specify your race or ethnicity.",
      });
    }

    if (data.school === SCHOOL_OTHER_OPTION && !data.otherSchool?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["otherSchool"],
        message: "Please enter your school or university name.",
      });
    }

    if (data.major === MAJOR_OTHER_OPTION && !data.otherMajor?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["otherMajor"],
        message: "Please describe your major or field of study.",
      });
    }

    if (
      data.levelOfStudy === LEVEL_OF_STUDY_OTHER_OPTION &&
      !data.otherLevelOfStudy?.trim()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["otherLevelOfStudy"],
        message: "Please describe your level of study.",
      });
    }

    if (data.hearAbout === HEAR_ABOUT_OTHER_OPTION && !data.otherHearAbout?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["otherHearAbout"],
        message: "Please tell us how you heard about HackUTA.",
      });
    }

    if (data.gender === GENDER_SELF_DESCRIBE_OPTION && !data.otherGender?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["otherGender"],
        message: "Please describe your gender.",
      });
    }
  })
  .transform((data) => ({
    ...data,
    phone: normalizePhone(data.phone, data.phoneCountry),
    emergencyContactPhone:
      data.emergencyContactPhone === undefined
        ? undefined
        : normalizePhone(data.emergencyContactPhone, data.emergencyContactPhoneCountry),
    // No emergency contact means no phone, so a lone calling-code selection is dropped too.
    ...(data.emergencyContactPhone === undefined
      ? { emergencyContactPhoneCountry: undefined }
      : {}),
    stateOfResidence: isUsaCountry(data.countryOfResidence)
      ? data.stateOfResidence
      : undefined,
  }));
