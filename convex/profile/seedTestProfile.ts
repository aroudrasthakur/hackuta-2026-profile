import { v } from "convex/values";
import { Scrypt } from "lucia";
import { internalMutation } from "../_generated/server";
import { applyAcceptedApplicationDecision } from "../admin/acceptanceDecision";
import { ensureEventConfig } from "../lib/eventConfig";
import { normalizeEmail } from "../lib/normalizeEmail";
import type { GenericId } from "convex/values";
import type { MutationCtx } from "../lib/dataModel";
import { isSharedDevSeedDeployment } from "./devSeedGuard";

const DEFAULT_TEST_EMAIL = "profile-portal-test@hackuta.dev";
const DEFAULT_TEST_PASSWORD = "HackutaTest1";
const DEFAULT_TEST_NAME = "Profile Test";

const submittedApplicationFields = {
  firstName: "Profile",
  lastName: "Test",
  phone: "+18175550199",
  phoneCountry: "US",
  age: 20,
  school: "The University of Texas at Arlington",
  levelOfStudy: "Undergraduate University (3+ year)",
  major: "Computer Science",
  graduationYear: 2027,
  dietaryRestrictions: ["Vegetarian", "Halal"],
  otherDietaryRestrictions: "No shellfish",
  countryOfResidence: "United States",
  stateOfResidence: "Texas",
  internationalStudent: false,
  tshirtSize: "M",
  gender: "Prefer Not to Answer",
  raceEthnicity: ["Prefer Not to Answer"],
  experienceLevel: "Intermediate",
  hackathonsAttended: 2,
  builtOrWantToBuild: "Seeded test application for the participant portal.",
  shortDeadlineLearning: "Learned Convex Auth flows for local QA.",
  hearAbout: "Friend",
  emergencyContactName: "Emergency Contact",
  emergencyContactRelationship: "Parent",
  emergencyContactPhone: "+18175550200",
  mlhCodeOfConductAgreed: true,
  mlhDataSharingConsent: true,
  foodAllergyWaiverAgreed: true,
  github: "https://github.com/hackuta",
} as const;

function assertDevSeedAllowed() {
  if (!isSharedDevSeedDeployment(process.env.CONVEX_CLOUD_URL)) {
    throw new Error(
      "Test profile seed is only allowed on the shared dev deployment (standing-manatee-425).",
    );
  }
}

async function ensureSeedAdmin(ctx: MutationCtx) {
  const existing = await ctx.db
    .query("admins")
    .withIndex("by_email", (q) => q.eq("email", "dev-seed@hackuta.internal"))
    .unique();
  if (existing) {
    return existing;
  }
  const now = Date.now();
  const adminId = await ctx.db.insert("admins", {
    email: "dev-seed@hackuta.internal",
    name: "Dev Seed Bot",
    role: "admin",
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  const admin = await ctx.db.get(adminId);
  if (!admin) {
    throw new Error("Could not create seed admin.");
  }
  return admin;
}

async function findAuthUserByEmail(ctx: MutationCtx, email: string) {
  return ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .unique();
}

/**
 * Dev-only: verified auth user, submitted application, accepted review, and participant row.
 * Run: npx convex run profile/seedTestProfile:seedTestAcceptedParticipant --env-file .env.local
 */
export const seedTestAcceptedParticipant = internalMutation({
  args: {
    email: v.optional(v.string()),
    password: v.optional(v.string()),
    displayName: v.optional(v.string()),
    replaceExisting: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertDevSeedAllowed();

    const email = normalizeEmail(args.email ?? DEFAULT_TEST_EMAIL);
    const password = args.password ?? DEFAULT_TEST_PASSWORD;
    const displayName = args.displayName ?? DEFAULT_TEST_NAME;
    if (!email) {
      throw new Error("A valid email is required.");
    }

    await ensureEventConfig(ctx);

    let userId: GenericId<"users">;
    const existingUser = await findAuthUserByEmail(ctx, email);
    if (existingUser) {
      if (!args.replaceExisting) {
        userId = existingUser._id;
      } else {
        throw new Error(
          "replaceExisting is not implemented; use a fresh email or delete the user in the dashboard first.",
        );
      }
    } else {
      const createdAt = Date.now();
      const secret = await new Scrypt().hash(password);
      userId = await ctx.db.insert("users", {
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
    }

    const now = Date.now();
    let application = await ctx.db
      .query("applications")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", userId))
      .first();

    if (!application) {
      const applicationId = await ctx.db.insert("applications", {
        authUserId: userId,
        email,
        createdAt: now,
        applicantUpdatedAt: now,
        formSubmitted: true,
        submittedAt: now,
        ...submittedApplicationFields,
      });
      application = await ctx.db.get(applicationId);
    } else if (!application.formSubmitted && !application.submittedAt) {
      await ctx.db.patch(application._id, {
        formSubmitted: true,
        submittedAt: now,
        applicantUpdatedAt: now,
        ...submittedApplicationFields,
      });
      application = await ctx.db.get(application._id);
    }

    if (!application) {
      throw new Error("Application row could not be created.");
    }

    let review = await ctx.db
      .query("applicationReviews")
      .withIndex("by_application", (q) => q.eq("applicationId", application._id))
      .unique();

    if (!review) {
      const reviewId = await ctx.db.insert("applicationReviews", {
        applicationId: application._id,
        status: "under_review",
        createdAt: now,
        updatedAt: now,
      });
      review = await ctx.db.get(reviewId);
    }

    if (!review) {
      throw new Error("Review row could not be created.");
    }

    const admin = await ensureSeedAdmin(ctx);

    let participant = await ctx.db
      .query("participants")
      .withIndex("by_application", (q) => q.eq("applicationId", application._id))
      .unique();

    if (review.status !== "accepted" || !participant) {
      await applyAcceptedApplicationDecision(ctx, {
        application,
        review,
        admin,
      });
      participant = await ctx.db
        .query("participants")
        .withIndex("by_application", (q) => q.eq("applicationId", application._id))
        .unique();
    }

    return {
      email,
      password: existingUser ? "(unchanged — account already existed)" : password,
      displayName,
      userId,
      applicationId: application._id,
      participantId: participant?._id ?? null,
      qrCodeToken: participant?.qrCodeToken ?? null,
      foodRestriction: participant?.foodRestriction ?? null,
      signInUrl: "http://127.0.0.1:5473/sign-in",
      profileDashboardUrl: "http://127.0.0.1:5473/dashboard",
    };
  },
});
