import {
  GENDER_SELF_DESCRIBE_OPTION,
  HEAR_ABOUT_OTHER_OPTION,
  LEVEL_OF_STUDY_OTHER_OPTION,
  MAJOR_OTHER_OPTION,
  SCHOOL_OTHER_OPTION,
} from "./constants";
import {
  APPLICANT_ANSWER_FIELD_KEYS,
  CONDITIONAL_STRING_FIELDS,
  isClearedDraftValue,
  NULLABLE_BOOLEAN_FIELDS,
  OPTIONAL_INT_FIELDS,
  PLAIN_STRING_FIELDS,
  REQUIRED_BOOLEAN_FIELDS,
  STRING_ARRAY_FIELDS,
  TRIMMED_STRING_FIELDS,
  type ApplicantAnswerFieldKey,
  type DraftPatchPayload,
} from "./applicantFields";
import { normalizeEmail } from "../lib/normalizeEmail";
import { normalizeResidenceFormFields, requiresUsState } from "./residence";
import type { SavedResumeDraft } from "./applicantFields";
import type { ApplicationFormData } from "./types";

export function savedResumeFromStoredApplication(
  application: StoredApplicantApplication,
): SavedResumeDraft | null {
  const storageId = application.resumeStorageId;
  if (typeof storageId !== "string" || storageId === "") return null;
  const filename =
    typeof application.resumeFilename === "string" && application.resumeFilename.trim()
      ? application.resumeFilename
      : "Resume.pdf";
  return { storageId, filename };
}

function parseOptionalInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Application columns needed to hydrate the registration form (excludes resume blob). */
export type StoredApplicantApplication = Partial<
  Record<
    ApplicantAnswerFieldKey,
    string | number | boolean | string[] | null | undefined
  >
> & {
  resumeStorageId?: string | null;
  resumeFilename?: string | null;
};

/**
 * Full form snapshot for draft autosave.
 * Empty strings, null, and [] mean "clear this field" on the server.
 */
export function formToDraftPatch(
  form: ApplicationFormData,
  savedResume: SavedResumeDraft | null | undefined = undefined,
): DraftPatchPayload {
  const patch = {} as DraftPatchPayload;

  for (const key of TRIMMED_STRING_FIELDS) {
    patch[key] =
      key === "studentEmail"
        ? normalizeEmail(form[key]) ?? ""
        : form[key].trim();
  }

  for (const key of PLAIN_STRING_FIELDS) {
    if (key === "stateOfResidence") {
      patch.stateOfResidence = requiresUsState(form.countryOfResidence)
        ? form.stateOfResidence
        : "";
      continue;
    }
    patch[key] = form[key];
  }

  patch.otherSchool =
    form.school === SCHOOL_OTHER_OPTION ? form.otherSchool.trim() : "";
  patch.otherLevelOfStudy =
    form.levelOfStudy === LEVEL_OF_STUDY_OTHER_OPTION
      ? form.otherLevelOfStudy.trim()
      : "";
  patch.otherMajor =
    form.major === MAJOR_OTHER_OPTION ? form.otherMajor.trim() : "";
  patch.otherHearAbout =
    form.hearAbout === HEAR_ABOUT_OTHER_OPTION ? form.otherHearAbout.trim() : "";
  patch.otherGender =
    form.gender === GENDER_SELF_DESCRIBE_OPTION ? form.otherGender.trim() : "";

  for (const key of OPTIONAL_INT_FIELDS) {
    patch[key] = parseOptionalInt(form[key]);
  }

  for (const key of STRING_ARRAY_FIELDS) {
    patch[key] = [...form[key]];
  }

  for (const key of NULLABLE_BOOLEAN_FIELDS) {
    patch[key] = form[key];
  }

  for (const key of REQUIRED_BOOLEAN_FIELDS) {
    patch[key] = form[key];
  }

  if (savedResume !== undefined) {
    if (savedResume) {
      patch.resumeStorageId = savedResume.storageId;
      patch.resumeFilename = savedResume.filename;
    } else {
      patch.resumeStorageId = null;
      patch.resumeFilename = "";
    }
  }

  return patch;
}

/** Map stored application columns back into form state (resume stays null). */
export function applicationToDraftForm(
  application: StoredApplicantApplication,
): Omit<ApplicationFormData, "resume"> {
  const values: Record<string, unknown> = {};

  for (const key of TRIMMED_STRING_FIELDS) {
    const value = (application[key] as string | undefined) ?? "";
    values[key] = value;
  }

  for (const key of PLAIN_STRING_FIELDS) {
    values[key] = (application[key] as string | undefined) ?? "";
  }

  for (const key of CONDITIONAL_STRING_FIELDS) {
    values[key] = (application[key] as string | undefined) ?? "";
  }

  for (const key of OPTIONAL_INT_FIELDS) {
    const stored = application[key];
    values[key] = stored !== undefined && stored !== null ? String(stored) : "";
  }

  for (const key of STRING_ARRAY_FIELDS) {
    values[key] = [...((application[key] as string[] | undefined) ?? [])];
  }

  for (const key of NULLABLE_BOOLEAN_FIELDS) {
    values[key] = (application[key] as boolean | null | undefined) ?? null;
  }

  for (const key of REQUIRED_BOOLEAN_FIELDS) {
    values[key] = (application[key] as boolean | undefined) ?? false;
  }

  return normalizeResidenceFormFields(
    values as Omit<ApplicationFormData, "resume">,
  );
}

/** Apply a full draft snapshot, removing cleared fields from the stored application. */
export function mergeDraftPatchIntoApplication<T extends Record<string, unknown>>(
  application: T,
  patch: DraftPatchPayload,
  meta: {
    email: string;
    emailVerificationTime?: number;
    applicantUpdatedAt?: number;
    updatedAt?: number;
  },
): Omit<T, "_id" | "_creationTime"> {
  const next: Record<string, unknown> = { ...application, ...meta };

  for (const key of APPLICANT_ANSWER_FIELD_KEYS) {
    const value = patch[key];
    if (isClearedDraftValue(value)) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }

  if ("resumeStorageId" in patch) {
    if (patch.resumeStorageId === null) {
      delete next.resumeStorageId;
      delete next.resumeFilename;
    } else if (patch.resumeStorageId !== undefined) {
      next.resumeStorageId = patch.resumeStorageId;
      const filename = patch.resumeFilename?.trim();
      if (filename) {
        next.resumeFilename = filename;
      } else {
        delete next.resumeFilename;
      }
    }
  }

  delete next._id;
  delete next._creationTime;

  return next as Omit<T, "_id" | "_creationTime">;
}
