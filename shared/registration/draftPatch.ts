/** @deprecated Import from `./draftMapping` or `./applicantFields` directly. */
export {
  APPLICANT_ANSWER_FIELD_KEYS,
  DRAFT_PATCH_FIELD_KEYS,
  type ApplicantAnswerFieldKey,
  type DraftPatchFieldKey,
  type DraftPatchPayload,
  isClearedDraftValue,
} from "./applicantFields";

export {
  applicationToDraftForm,
  formToDraftPatch,
  mergeDraftPatchIntoApplication,
  type StoredApplicantApplication,
} from "./draftMapping";
