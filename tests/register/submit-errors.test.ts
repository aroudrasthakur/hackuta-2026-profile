import { describe, expect, it } from "vitest";
import {
  APPLICATION_CLOSED_MESSAGE,
  APPLICATION_NOT_OPEN_MESSAGE,
  isResumeFieldMessage,
  mapConvexErrorToUserMessage,
  mapResumeUploadHttpError,
  mapUploadError,
  SUBMIT_ERROR_MESSAGE,
} from "../../shared/registration/submitErrors";
import {
  RESUME_EMPTY_ERROR_MESSAGE,
  RESUME_SIZE_ERROR_MESSAGE,
} from "../../shared/registration/resume";
import {
  RESUME_UPLOAD_AUTH_REQUIRED_MESSAGE,
  RESUME_UPLOAD_ERROR_MESSAGE,
  SIGN_IN_REQUIRED_MESSAGE,
} from "../../shared/registration/submitErrors";

describe("submit error mapping", () => {
  it("passes through known server messages in production mode", () => {
    expect(
      mapConvexErrorToUserMessage(new Error("You have already submitted an application.")),
    ).toBe("You have already submitted an application.");
  });

  it("shows an actionable message when a submission crosses the deadline", () => {
    expect(mapConvexErrorToUserMessage(new Error("[CONVEX M(registrations:submitRegistration)] Applications are closed.")))
      .toBe(APPLICATION_CLOSED_MESSAGE);
  });

  it("shows an opening-window message when drafts or submissions start too early", () => {
    expect(mapConvexErrorToUserMessage(new Error("[CONVEX M(applications:saveApplicationDraft)] Applications are not open yet.")))
      .toBe(APPLICATION_NOT_OPEN_MESSAGE);
  });

  it("maps unknown server failures to a friendly default", () => {
    expect(mapConvexErrorToUserMessage(new Error("Invalid registration data."))).toBe(
      SUBMIT_ERROR_MESSAGE,
    );
  });

  it("treats resume validation messages as field errors", () => {
    expect(mapConvexErrorToUserMessage(new Error("Please select a PDF file."))).toBe(
      "Please select a PDF file.",
    );
    expect(isResumeFieldMessage("Please select a PDF file.")).toBe(true);
  });

  it("maps resume upload HTTP statuses to applicant-friendly copy", () => {
    expect(mapResumeUploadHttpError(429, { error: "Too many uploads. Please try again later." }))
      .toBe("Too many uploads. Please try again later.");
    expect(mapResumeUploadHttpError(429, {})).toBe("Too many uploads. Please try again later.");
    expect(mapResumeUploadHttpError(401, {})).toBe(RESUME_UPLOAD_AUTH_REQUIRED_MESSAGE);
    expect(mapResumeUploadHttpError(413, {})).toBe(RESUME_SIZE_ERROR_MESSAGE);
    expect(mapResumeUploadHttpError(415, {})).toBe("Please select a PDF file.");
    expect(mapResumeUploadHttpError(403, {})).toBe(
      "Resume upload is unavailable. Please try again later or contact us.",
    );
    expect(mapResumeUploadHttpError(500, {})).toBe(
      "We couldn't upload your resume. Please try again.",
    );
  });

  it("translates technical upload server messages into applicant-friendly copy", () => {
    expect(mapResumeUploadHttpError(403, { error: "Origin is not allowed." })).toBe(
      "Resume upload is unavailable. Please try again later or contact us.",
    );
    expect(mapResumeUploadHttpError(411, { error: "Content-Length header is required." })).toBe(
      "We couldn't upload your resume. Please try again.",
    );
    expect(mapUploadError(new Error("Unexpected server failure"))).toBe(
      "We couldn't upload your resume. Please try again.",
    );
  });

  it("does not map empty uploads to the size-limit message", () => {
    expect(mapResumeUploadHttpError(413, { error: RESUME_EMPTY_ERROR_MESSAGE })).toBe(
      RESUME_EMPTY_ERROR_MESSAGE,
    );
    expect(mapResumeUploadHttpError(413, { error: RESUME_EMPTY_ERROR_MESSAGE })).not.toBe(
      RESUME_SIZE_ERROR_MESSAGE,
    );
    expect(mapResumeUploadHttpError(413, { error: "The PDF is empty." })).toBe(
      RESUME_EMPTY_ERROR_MESSAGE,
    );
    expect(mapUploadError(new Error("The PDF is empty."))).toBe(RESUME_EMPTY_ERROR_MESSAGE);
  });

  it.each([
    "The PDF is too large.",
    "The PDF must be between 1 byte and 2 MB.",
    "The PDF must be between 1 byte and 5 MB.",
    "Please upload a valid PDF resume of 5 MB or smaller.",
  ])("normalizes legacy oversized upload messages: %s", (legacyMessage) => {
    expect(mapUploadError(new Error(legacyMessage))).toBe(RESUME_SIZE_ERROR_MESSAGE);
    expect(mapResumeUploadHttpError(413, { error: legacyMessage })).toBe(
      RESUME_SIZE_ERROR_MESSAGE,
    );
    expect(mapConvexErrorToUserMessage(new Error(legacyMessage))).toBe(
      RESUME_SIZE_ERROR_MESSAGE,
    );
  });

  it("keeps invalid MIME or upload-session errors separate from size errors", () => {
    const validationMessage = "Please upload a valid PDF resume of 2 MB or smaller.";

    expect(mapConvexErrorToUserMessage(new Error(validationMessage))).toBe(
      validationMessage,
    );
    expect(mapConvexErrorToUserMessage(new Error(validationMessage))).not.toBe(
      RESUME_SIZE_ERROR_MESSAGE,
    );
  });

  it.each([
    ["Authentication required", SIGN_IN_REQUIRED_MESSAGE],
    ["[CONVEX M(registrations:submit)] Authentication required.", SIGN_IN_REQUIRED_MESSAGE],
    ["Please verify your email first", "Please verify your email before submitting your application."],
    ["A verified email is required", "Please verify your email before submitting your application."],
    ["User already submitted", "You have already submitted an application."],
    ["Storage id already attached elsewhere", "This resume is already attached to another application."],
    ["Uploaded resume is too large for storage", RESUME_SIZE_ERROR_MESSAGE],
    [
      "Too many resume upload attempts. Please wait a few minutes and try again.",
      "Too many resume upload attempts. Please wait a few minutes and try again.",
    ],
    [SIGN_IN_REQUIRED_MESSAGE, SIGN_IN_REQUIRED_MESSAGE],
  ])("maps submission failure %j to safe copy", (message, expected) => {
    expect(mapConvexErrorToUserMessage(new Error(message))).toBe(expected);
  });

  it("recognises legacy 5 MB wording only when it refers to a PDF or resume", () => {
    expect(mapUploadError(new Error("Resume must be under 5 MB"))).toBe(RESUME_SIZE_ERROR_MESSAGE);
    expect(mapUploadError(new Error("Video must be under 5 MB"))).toBe(RESUME_UPLOAD_ERROR_MESSAGE);
  });

  it("maps upload aliases and non-Error values", () => {
    expect(mapUploadError(new Error("The resume could not be stored."))).toBe(
      RESUME_UPLOAD_ERROR_MESSAGE,
    );
    expect(mapUploadError(new Error("Please upload a PDF."))).toBe("Please select a PDF file.");
    expect(mapUploadError("network down")).toBe(RESUME_UPLOAD_ERROR_MESSAGE);
    expect(mapUploadError(new Error(""))).toBe(RESUME_UPLOAD_ERROR_MESSAGE);
  });

  it.each([
    [400, "We couldn't upload your resume. Please try again."],
    [411, "We couldn't upload your resume. Please try again."],
  ])("maps HTTP %i with no usable body", (status, expected) => {
    expect(mapResumeUploadHttpError(status, null)).toBe(expected);
    expect(mapResumeUploadHttpError(status, "text body")).toBe(expected);
    expect(mapResumeUploadHttpError(status, { error: 42 })).toBe(expected);
    expect(mapResumeUploadHttpError(status, { message: "nope" })).toBe(expected);
  });

  it("falls back to the status mapping when the server error is unrecognised", () => {
    expect(mapResumeUploadHttpError(415, { error: "Some internal stack trace" })).toBe(
      "Please select a PDF file.",
    );
  });

  it("classifies resume field messages", () => {
    expect(isResumeFieldMessage(RESUME_SIZE_ERROR_MESSAGE)).toBe(true);
    expect(isResumeFieldMessage("You have already submitted an application.")).toBe(false);
  });

  it("ignores malformed error bodies", () => {
    expect(mapResumeUploadHttpError(429, { error: "  " })).toBe(
      "Too many uploads. Please try again later.",
    );
    expect(mapConvexErrorToUserMessage("not an error")).toBe(SUBMIT_ERROR_MESSAGE);
  });
});
