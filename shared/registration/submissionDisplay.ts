import {
  APPLICATION_QUESTIONS,
  GENDER_SELF_DESCRIBE_OPTION,
  HEAR_ABOUT_OTHER_OPTION,
  LEVEL_OF_STUDY_OTHER_OPTION,
  MAJOR_OTHER_OPTION,
  SCHOOL_OTHER_OPTION,
} from "./constants";
import { EMERGENCY_CONTACT_FIELDS } from "./emergencyContact";
import { isEmergencyContactStarted } from "./emergencyContact";
import type { ApplicantAnswerFieldKey } from "./applicantFields";

export type SubmissionRow = { label: string; value: string };
export type SubmissionSection = { title: string; rows: SubmissionRow[] };

type SubmissionSource = Partial<Record<ApplicantAnswerFieldKey | "email", unknown>>;

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    const parts = value.map((entry) => String(entry).trim()).filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

function row(label: string, value: unknown): SubmissionRow | null {
  const formatted = text(value);
  if (!formatted) return null;
  return { label, value: formatted };
}

function withOther(
  label: string,
  value: unknown,
  otherValue: unknown,
  otherToken: string,
): SubmissionRow | null {
  const primary = text(value);
  if (!primary) return null;
  if (primary === otherToken) {
    return row(label, text(otherValue) ?? otherToken);
  }
  return { label, value: primary };
}

/** Read-only sections for a submitted application (labels match the registration form). */
export function buildSubmissionSections(
  application: SubmissionSource,
  verifiedEmail: string | null,
): SubmissionSection[] {
  const sections: SubmissionSection[] = [];

  const personal: SubmissionRow[] = [];
  const emailRow = row("Verified email", verifiedEmail);
  if (emailRow) personal.push(emailRow);
  for (const entry of [
    row("First name", application.firstName),
    row("Last name", application.lastName),
    row("Phone number", application.phone),
    row("Age", application.age),
    withOther(
      "School / university",
      application.school,
      application.otherSchool,
      SCHOOL_OTHER_OPTION,
    ),
    row("Student email", application.studentEmail),
    row("Country of residence", application.countryOfResidence),
    row("State of residence", application.stateOfResidence),
    row("Are you an international student?", application.internationalStudent),
    withOther(
      "Level of study",
      application.levelOfStudy,
      application.otherLevelOfStudy,
      LEVEL_OF_STUDY_OTHER_OPTION,
    ),
    withOther("Major / field of study", application.major, application.otherMajor, MAJOR_OTHER_OPTION),
    row("Graduation year", application.graduationYear),
  ]) {
    if (entry) personal.push(entry);
  }
  if (personal.length) sections.push({ title: "Personal Information", rows: personal });

  const demographics: SubmissionRow[] = [];
  const gender = withOther(
    "Gender",
    application.gender,
    application.otherGender,
    GENDER_SELF_DESCRIBE_OPTION,
  );
  if (gender) demographics.push(gender);
  const race = row("Race / ethnicity", application.raceEthnicity);
  if (race) demographics.push(race);
  const otherRace = row("Specify race / ethnicity", application.otherRaceEthnicity);
  if (otherRace) demographics.push(otherRace);
  if (demographics.length) sections.push({ title: "Demographics", rows: demographics });

  const preferences: SubmissionRow[] = [];
  const dietary = row("Dietary restrictions", application.dietaryRestrictions);
  if (dietary) preferences.push(dietary);
  for (const entry of [
    row("Allergy details", application.allergyDetails),
    row("Other dietary restrictions", application.otherDietaryRestrictions),
    row("Food allergy waiver", application.foodAllergyWaiverAgreed),
    row("T-shirt size", application.tshirtSize),
  ]) {
    if (entry) preferences.push(entry);
  }
  if (preferences.length) sections.push({ title: "Event Preferences", rows: preferences });

  const questions: SubmissionRow[] = [];
  for (const entry of [
    row("How many hackathons have you attended", application.hackathonsAttended),
    row("Experience level", application.experienceLevel),
    row(APPLICATION_QUESTIONS.builtOrWantToBuild, application.builtOrWantToBuild),
    row(APPLICATION_QUESTIONS.shortDeadlineLearning, application.shortDeadlineLearning),
  ]) {
    if (entry) questions.push(entry);
  }
  if (questions.length) sections.push({ title: "Application Questions", rows: questions });

  const additional: SubmissionRow[] = [];
  const hearAbout = withOther(
    "How did you hear about HackUTA?",
    application.hearAbout,
    application.otherHearAbout,
    HEAR_ABOUT_OTHER_OPTION,
  );
  if (hearAbout) additional.push(hearAbout);
  for (const entry of [
    row("LinkedIn", application.linkedin),
    row("GitHub", application.github),
    row("Portfolio", application.portfolio),
    row("Devpost", application.devpost),
    row("Accessibility needs", application.accessibilityNeeds),
  ]) {
    if (entry) additional.push(entry);
  }
  if (additional.length) sections.push({ title: "Additional Information", rows: additional });

  if (
    isEmergencyContactStarted({
      emergencyContactName: String(application.emergencyContactName ?? ""),
      emergencyContactRelationship: String(application.emergencyContactRelationship ?? ""),
      emergencyContactPhone: String(application.emergencyContactPhone ?? ""),
    })
  ) {
    const emergency: SubmissionRow[] = [];
    for (const field of EMERGENCY_CONTACT_FIELDS) {
      const labels: Record<(typeof EMERGENCY_CONTACT_FIELDS)[number], string> = {
        emergencyContactName: "Emergency contact name",
        emergencyContactRelationship: "Relationship",
        emergencyContactPhone: "Emergency contact phone",
      };
      const entry = row(labels[field], application[field]);
      if (entry) emergency.push(entry);
    }
    if (emergency.length) sections.push({ title: "Emergency Contact", rows: emergency });
  }

  const agreements: SubmissionRow[] = [];
  for (const entry of [
    row("MLH Code of Conduct", application.mlhCodeOfConductAgreed),
    row("MLH data sharing", application.mlhDataSharingConsent),
    row("MLH communications", application.mlhCommunicationsConsent),
    row("Sponsor sharing consent", application.sponsorSharingConsent),
  ]) {
    if (entry) agreements.push(entry);
  }
  if (agreements.length) sections.push({ title: "Agreements", rows: agreements });

  return sections;
}
