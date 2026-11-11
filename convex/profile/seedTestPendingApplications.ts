import { v } from "convex/values";
import { Scrypt } from "lucia";
import { internalMutation } from "../_generated/server";
import { ensureEventConfig } from "../lib/eventConfig";
import { normalizeEmail } from "../lib/normalizeEmail";
import type { GenericId } from "convex/values";
import type { MutationCtx } from "../lib/dataModel";
import { isSharedDevSeedDeployment } from "./devSeedGuard";

const DEFAULT_SEED_PASSWORD = "HackutaTest1";

const pendingApplicantFields = {
  firstName: "Aroudra",
  lastName: "Thakur",
  phone: "+18175550199",
  phoneCountry: "US",
  age: 20,
  school: "The University of Texas at Arlington",
  levelOfStudy: "Undergraduate University (3+ year)",
  major: "Computer Science",
  graduationYear: 2027,
  dietaryRestrictions: ["Vegetarian"],
  countryOfResidence: "United States",
  stateOfResidence: "Texas",
  internationalStudent: false,
  tshirtSize: "M",
  gender: "Prefer Not to Answer",
  raceEthnicity: ["Prefer Not to Answer"],
  experienceLevel: "Intermediate",
  hackathonsAttended: 1,
  builtOrWantToBuild: "Seeded pending application for organizer review QA.",
  shortDeadlineLearning: "Convex-backed registration flow.",
  hearAbout: "Friend",
  emergencyContactName: "Emergency Contact",
  emergencyContactRelationship: "Parent",
  emergencyContactPhone: "+18175550200",
  mlhCodeOfConductAgreed: true,
  mlhDataSharingConsent: true,
  foodAllergyWaiverAgreed: true,
  github: "https://github.com/aroudrasthakur",
} as const;

const DEFAULT_PENDING_EMAILS = [
  "aroudrasthakur@gmail.com",
  "aroudra.thakur@gmail.com",
  "aroudra.thakur+seed3@gmail.com",
] as const;

function assertDevSeedAllowed() {
  if (!isSharedDevSeedDeployment(process.env.CONVEX_CLOUD_URL)) {
    throw new Error(
      "Pending application seed is only allowed on the shared dev deployment (standing-manatee-425).",
    );
  }
}

async function ensureAuthUser(
  ctx: MutationCtx,
  email: string,
  displayName: string,
  password: string,
): Promise<GenericId<"users">> {
  const existing = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .unique();
  if (existing) {
    return existing._id;
  }
  const createdAt = Date.now();
  const secret = await new Scrypt().hash(password);
  const userId = await ctx.db.insert("users", {
    email,
    name: displayName,
    emailVerificationTime: createdAt,
  });
  await ctx.db.insert("authAccounts", {
    userId,
    provider: "password",
    providerAccountId: email,
    secret,
    emailVerified: email,
  });
  return userId;
}

async function resetApplicationToPending(ctx: MutationCtx, applicationId: GenericId<"applications">) {
  const now = Date.now();
  const review = await ctx.db
    .query("applicationReviews")
    .withIndex("by_application", (q) => q.eq("applicationId", applicationId))
    .unique();
  if (review) {
    await ctx.db.patch(review._id, {
      status: "under_review",
      reviewedBy: undefined,
      startedAt: undefined,
      lastActiveAt: undefined,
      completedAt: undefined,
      updatedAt: now,
    });
  }

  const participant = await ctx.db
    .query("participants")
    .withIndex("by_application", (q) => q.eq("applicationId", applicationId))
    .unique();
  if (participant) {
    const disclosures = await ctx.db
      .query("participantMediaDisclosures")
      .withIndex("by_participant", (q) => q.eq("participantId", participant._id))
      .collect();
    for (const row of disclosures) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.delete(participant._id);
  }

  const checkedInRows = await ctx.db
    .query("checkedIn")
    .withIndex("by_application", (q) => q.eq("applicationId", applicationId))
    .collect();
  for (const row of checkedInRows) {
    await ctx.db.delete(row._id);
  }

  const queueRows = await ctx.db
    .query("decisionEmailQueue")
    .withIndex("by_application", (q) => q.eq("applicationId", applicationId))
    .collect();
  for (const row of queueRows) {
    await ctx.db.delete(row._id);
  }
}

async function seedOnePendingApplication(
  ctx: MutationCtx,
  rawEmail: string,
  password: string,
  displayName: string,
  resetExisting: boolean,
) {
  const email = normalizeEmail(rawEmail);
  if (!email) {
    throw new Error(`Invalid email: ${rawEmail}`);
  }

  const userId = await ensureAuthUser(ctx, email, displayName, password);
  const now = Date.now();

  let application = await ctx.db
    .query("applications")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", userId))
    .first();

  if (application?.formSubmitted || application?.submittedAt) {
    const review = await ctx.db
      .query("applicationReviews")
      .withIndex("by_application", (q) => q.eq("applicationId", application!._id))
      .unique();
    if (
      resetExisting &&
      review &&
      (review.status === "accepted" ||
        review.status === "rejected" ||
        review.status === "waitlisted")
    ) {
      await resetApplicationToPending(ctx, application!._id);
      return {
        email,
        skipped: false as const,
        reset: true as const,
        applicationId: application!._id,
        reviewStatus: "under_review",
      };
    }
    if (review?.status === "under_review") {
      return {
        email,
        skipped: true as const,
        reason: "Already pending review",
        applicationId: application._id,
        reviewStatus: review.status,
      };
    }
    return {
      email,
      skipped: true as const,
      reason: "Application already submitted",
      applicationId: application._id,
      reviewStatus: review?.status ?? null,
    };
  }

  if (!application) {
    const applicationId = await ctx.db.insert("applications", {
      authUserId: userId,
      email,
      createdAt: now,
      applicantUpdatedAt: now,
      formSubmitted: true,
      submittedAt: now,
      ...pendingApplicantFields,
      firstName: displayName.split(" ")[0] ?? pendingApplicantFields.firstName,
      lastName: displayName.split(" ").slice(1).join(" ") || pendingApplicantFields.lastName,
    });
    application = await ctx.db.get(applicationId);
  } else {
    await ctx.db.patch(application._id, {
      formSubmitted: true,
      submittedAt: now,
      applicantUpdatedAt: now,
      email,
      ...pendingApplicantFields,
    });
    application = await ctx.db.get(application._id);
  }

  if (!application) {
    throw new Error(`Could not create application for ${email}.`);
  }

  const existingReview = await ctx.db
    .query("applicationReviews")
    .withIndex("by_application", (q) => q.eq("applicationId", application._id))
    .unique();

  let reviewStatus = existingReview?.status ?? null;
  if (!existingReview) {
    const reviewId = await ctx.db.insert("applicationReviews", {
      applicationId: application._id,
      status: "under_review",
      createdAt: now,
      updatedAt: now,
    });
    const review = await ctx.db.get(reviewId);
    reviewStatus = review?.status ?? "under_review";
  } else if (
    existingReview.status === "accepted" ||
    existingReview.status === "rejected" ||
    existingReview.status === "waitlisted"
  ) {
    if (resetExisting) {
      await resetApplicationToPending(ctx, application._id);
      reviewStatus = "under_review";
    } else {
      return {
        email,
        skipped: true as const,
        reason: `Review already finalized as ${existingReview.status}`,
        applicationId: application._id,
        reviewStatus: existingReview.status,
      };
    }
  }

  const existingLog = await ctx.db
    .query("applicationSubmissionLogs")
    .withIndex("by_application", (q) => q.eq("applicationId", application._id))
    .first();
  if (!existingLog) {
    const { _id, _creationTime, ...fields } = application;
    void _creationTime;
    await ctx.db.insert("applicationSubmissionLogs", {
      ...fields,
      status: "submitted",
      updatedAt: application.submittedAt ?? now,
      applicationId: _id,
    });
  }

  return {
    email,
    skipped: false as const,
    password,
    applicationId: application._id,
    reviewStatus: reviewStatus ?? "under_review",
  };
}

/**
 * Dev-only: three submitted applications with no released decision (under_review).
 * Run: npx convex run profile/seedTestPendingApplications:seedTestPendingApplications --env-file .env.example
 */
export const seedTestPendingApplications = internalMutation({
  args: {
    emails: v.optional(v.array(v.string())),
    password: v.optional(v.string()),
    resetExisting: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertDevSeedAllowed();
    await ensureEventConfig(ctx);

    const password = args.password ?? DEFAULT_SEED_PASSWORD;
    const resetExisting = args.resetExisting ?? false;
    const emails = args.emails?.length
      ? args.emails
      : [...DEFAULT_PENDING_EMAILS];

    const results = [];
    for (const [index, rawEmail] of emails.entries()) {
      const displayName =
        index === 0 ? "Aroudra Thakur" : index === 1 ? "Aroudra Thakur (Alt)" : "Aroudra Thakur (Seed 3)";
      results.push(
        await seedOnePendingApplication(ctx, rawEmail, password, displayName, resetExisting),
      );
    }

    return {
      deployment: "standing-manatee-425",
      defaultPassword: DEFAULT_SEED_PASSWORD,
      results,
    };
  },
});
