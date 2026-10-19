import type { GenericId } from "convex/values";
import { ensureEventConfig } from "./eventConfig";
import { normalizeEmail } from "./normalizeEmail";
import { getAuthUser, requireAuthUser, type AuthCtx } from "./auth";
import type { ApplicationDoc, MutationCtx } from "./dataModel";

export { getAuthUser, requireAuthUser };

export async function getApplicationByUser(
  ctx: AuthCtx,
  authUserId: GenericId<"users">,
): Promise<ApplicationDoc | null> {
  return ctx.db
    .query("applications")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", authUserId))
    .first();
}

export async function getApplicationReview(ctx: AuthCtx, applicationId: ApplicationDoc["_id"]) {
  return ctx.db
    .query("applicationReviews")
    .withIndex("by_application", (q) => q.eq("applicationId", applicationId))
    .unique();
}

export async function getApplicationStatus(ctx: AuthCtx, application: ApplicationDoc) {
  const review = await getApplicationReview(ctx, application._id);
  if (review) return review.status === "under_review" ? "submitted" : review.status;
  return applicationFormWasSubmitted(application) ? "submitted" : "draft";
}

/** Whether the applicant completed a successful registration form submit. */
export function applicationFormWasSubmitted(
  application: Pick<ApplicationDoc, "formSubmitted" | "submittedAt">,
) {
  return application.formSubmitted === true || application.submittedAt != null;
}

export async function ensureDraftApplication(ctx: MutationCtx) {
  await ensureEventConfig(ctx);
  const authUser = await requireAuthUser(ctx);
  const email = normalizeEmail(authUser.email);
  if (!email) {
    throw new Error("A verified email is required.");
  }

  const existing = await getApplicationByUser(ctx, authUser._id);
  if (existing) {
    const emailVerificationTime =
      authUser.emailVerificationTime ?? existing.emailVerificationTime;
    if (emailVerificationTime !== existing.emailVerificationTime) {
      const updatedAt = Date.now();
      await ctx.db.patch(existing._id, {
        emailVerificationTime,
        email,
        applicantUpdatedAt: updatedAt,
      });
    }
    return existing;
  }

  const now = Date.now();
  const applicationId = await ctx.db.insert("applications", {
    authUserId: authUser._id,
    email,
    ...(authUser.emailVerificationTime !== undefined
      ? { emailVerificationTime: authUser.emailVerificationTime }
      : {}),
    createdAt: now,
    applicantUpdatedAt: now,
  });
  const application = await ctx.db.get(applicationId);
  if (!application) {
    throw new Error("Application could not be created.");
  }
  return application as ApplicationDoc;
}

export async function findApplicationByResume(
  ctx: AuthCtx,
  storageId: GenericId<"_storage">,
): Promise<ApplicationDoc | null> {
  return ctx.db
    .query("applications")
    .withIndex("by_resume", (q) => q.eq("resumeStorageId", storageId))
    .first();
}

export function formatApplicantFullName(fields: {
  firstName?: string | null;
  lastName?: string | null;
}) {
  const first = fields.firstName?.trim();
  const last = fields.lastName?.trim();
  if (first && last) return `${first} ${last}`;
  return first || last || null;
}

/** Keep auth `users.name` in sync with the application form display name. */
export async function syncAuthUserNameFromApplication(
  ctx: MutationCtx,
  authUserId: GenericId<"users">,
  fields: { firstName?: string | null; lastName?: string | null },
) {
  const name = formatApplicantFullName(fields);
  const user = await ctx.db.get(authUserId);
  if (!user) return;

  if (!name) {
    if (user.name !== undefined) {
      const { _id, _creationTime, name: removedName, ...replacement } = user;
      void _id;
      void _creationTime;
      void removedName;
      await ctx.db.replace(authUserId, replacement);
    }
    return;
  }

  if (user.name !== name) {
    await ctx.db.patch(authUserId, { name });
  }
}

export function projectApplicantAnswers(application: ApplicationDoc) {
  return {
    firstName: application.firstName,
    lastName: application.lastName,
    phone: application.phone,
    phoneCountry: application.phoneCountry,
    age: application.age,
    school: application.school,
    otherSchool: application.otherSchool,
    studentEmail: application.studentEmail,
    countryOfResidence: application.countryOfResidence,
    stateOfResidence: application.stateOfResidence,
    levelOfStudy: application.levelOfStudy,
    otherLevelOfStudy: application.otherLevelOfStudy,
    major: application.major,
    otherMajor: application.otherMajor,
    graduationYear: application.graduationYear,
    gender: application.gender,
    otherGender: application.otherGender,
    raceEthnicity: application.raceEthnicity,
    otherRaceEthnicity: application.otherRaceEthnicity,
    dietaryRestrictions: application.dietaryRestrictions,
    allergyDetails: application.allergyDetails,
    otherDietaryRestrictions: application.otherDietaryRestrictions,
    tshirtSize: application.tshirtSize,
    experienceLevel: application.experienceLevel,
    hackathonsAttended: application.hackathonsAttended,
    hearAbout: application.hearAbout,
    otherHearAbout: application.otherHearAbout,
    linkedin: application.linkedin,
    github: application.github,
    portfolio: application.portfolio,
    devpost: application.devpost,
    accessibilityNeeds: application.accessibilityNeeds,
    builtOrWantToBuild: application.builtOrWantToBuild,
    shortDeadlineLearning: application.shortDeadlineLearning,
    emergencyContactName: application.emergencyContactName,
    emergencyContactRelationship: application.emergencyContactRelationship,
    emergencyContactPhone: application.emergencyContactPhone,
    emergencyContactPhoneCountry: application.emergencyContactPhoneCountry,
    mlhCodeOfConductAgreed: application.mlhCodeOfConductAgreed === true,
    mlhCodeOfConductAgreedAt: application.mlhCodeOfConductAgreedAt,
    mlhDataSharingConsent: application.mlhDataSharingConsent === true,
    mlhDataSharingConsentAt: application.mlhDataSharingConsentAt,
    mlhCommunicationsConsent: application.mlhCommunicationsConsent,
    mlhCommunicationsConsentAt: application.mlhCommunicationsConsentAt,
    sponsorSharingConsent: application.sponsorSharingConsent === true,
    foodAllergyWaiverAgreed: application.foodAllergyWaiverAgreed === true,
    sponsorSharingConsentAt: application.sponsorSharingConsentAt,
    foodAllergyWaiverAgreedAt: application.foodAllergyWaiverAgreedAt,
  };
}
