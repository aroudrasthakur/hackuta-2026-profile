/**
 * Sandbox-only: creates a hacker who can play in the arcade, for testing.
 *
 * Mirrors profile/seedTestProfile (which only runs on standing-manatee): a
 * verified account with an email + password, a submitted application, an
 * accepted decision (the profile's own `applyAcceptedApplicationDecision`),
 * then a check-in row with starting profile points (logged as an admin
 * adjustment, so the points ledger matches). Internal: only the Convex CLI can
 * run it, and it refuses to run anywhere but brazen-peccary-506.
 *
 *   npx convex run arcade/devSeed:seedArcadeTesterInternal \
 *     '{"email": "arcade-tester@hackuta.dev", "password": "…", "points": 500}'
 */
import { v, type GenericId } from "convex/values";
import { Scrypt } from "lucia";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../lib/dataModel";
import { applyAcceptedApplicationDecision } from "../admin/acceptanceDecision";
import { ensureEventConfig } from "../lib/eventConfig";
import { normalizeEmail } from "../lib/normalizeEmail";
import { validatePasswordRequirements } from "../../shared/auth/password";

const SANDBOX = "brazen-peccary-506";
const SEED_ADMIN_EMAIL = "dev-seed@hackuta.internal";

const applicationFields = {
  phone: "+18175550199",
  phoneCountry: "US",
  age: 20,
  school: "The University of Texas at Arlington",
  levelOfStudy: "Undergraduate University (3+ year)",
  major: "Computer Science",
  graduationYear: 2027,
  dietaryRestrictions: ["None"],
  countryOfResidence: "United States",
  stateOfResidence: "Texas",
  internationalStudent: false,
  tshirtSize: "M",
  gender: "Prefer Not to Answer",
  raceEthnicity: ["Prefer Not to Answer"],
  experienceLevel: "Intermediate",
  hackathonsAttended: 2,
  builtOrWantToBuild: "Seeded arcade test account (sandbox only).",
  shortDeadlineLearning: "Testing the HackUTA Arcade.",
  hearAbout: "Friend",
  emergencyContactName: "Emergency Contact",
  emergencyContactRelationship: "Parent",
  emergencyContactPhone: "+18175550200",
  mlhCodeOfConductAgreed: true,
  mlhDataSharingConsent: true,
  foodAllergyWaiverAgreed: true,
} as const;

function randomToken(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function seedAdmin(ctx: MutationCtx) {
  const existing = await ctx.db
    .query("admins")
    .withIndex("by_email", (q) => q.eq("email", SEED_ADMIN_EMAIL))
    .unique();
  if (existing) return existing;
  const now = Date.now();
  const id = await ctx.db.insert("admins", { email: SEED_ADMIN_EMAIL, name: "Dev Seed Bot", role: "admin", active: true, createdAt: now, updatedAt: now });
  return (await ctx.db.get(id))!;
}

export const seedArcadeTesterInternal = internalMutation({
  args: {
    email: v.string(),
    password: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    /** Starting profile points (before any deposit). Default 500. */
    points: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(process.env.CONVEX_CLOUD_URL ?? "").includes(SANDBOX)) {
      throw new Error(`The arcade test seed only runs on ${SANDBOX}.`);
    }
    const email = normalizeEmail(args.email);
    if (!email) throw new Error("A valid email is required.");
    validatePasswordRequirements(args.password);
    const points = args.points ?? 500;
    if (!Number.isSafeInteger(points) || points < 0) throw new Error("points must be a whole number ≥ 0.");
    const firstName = args.firstName ?? "Arcade";
    const lastName = args.lastName ?? "Tester";
    const now = Date.now();
    await ensureEventConfig(ctx);

    // 1. Account (email + password, verified), or the existing one with this email.
    const user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).unique();
    // An existing account keeps its own password; only a new one gets `password`.
    const existingAccount = user !== null;
    let userId: GenericId<"users">;
    if (user) {
      userId = user._id;
    } else {
      userId = await ctx.db.insert("users", { email, name: `${firstName} ${lastName}`, emailVerificationTime: now });
      await ctx.db.insert("authAccounts", {
        userId,
        provider: "password",
        providerAccountId: email,
        secret: await new Scrypt().hash(args.password),
        emailVerified: email,
      });
    }

    // 2. Submitted application.
    let application = await ctx.db.query("applications").withIndex("by_auth_user", (q) => q.eq("authUserId", userId)).first();
    if (!application) {
      const id = await ctx.db.insert("applications", {
        authUserId: userId,
        email,
        firstName,
        lastName,
        createdAt: now,
        applicantUpdatedAt: now,
        formSubmitted: true,
        submittedAt: now,
        ...applicationFields,
      });
      application = (await ctx.db.get(id))!;
    }

    // 3. Accepted, through the profile's own decision code (creates the participant row).
    let review = await ctx.db.query("applicationReviews").withIndex("by_application", (q) => q.eq("applicationId", application!._id)).unique();
    if (!review) {
      const id = await ctx.db.insert("applicationReviews", { applicationId: application._id, status: "under_review", createdAt: now, updatedAt: now });
      review = (await ctx.db.get(id))!;
    }
    const admin = await seedAdmin(ctx);
    let participant = await ctx.db.query("participants").withIndex("by_application", (q) => q.eq("applicationId", application!._id)).unique();
    if (review.status !== "accepted" || !participant) {
      await applyAcceptedApplicationDecision(ctx, { application, review, admin });
      participant = await ctx.db.query("participants").withIndex("by_application", (q) => q.eq("applicationId", application!._id)).unique();
    }
    if (!participant) throw new Error("Participant row could not be created.");

    // 4. Checked in, with starting points (logged, so the ledger matches the balance).
    let checkedIn = await ctx.db.query("checkedIn").withIndex("by_participant", (q) => q.eq("participantId", participant!._id)).unique();
    if (!checkedIn) {
      const id = await ctx.db.insert("checkedIn", {
        participantId: participant._id,
        applicationId: application._id,
        authUserId: userId,
        acceptedAt: participant.acceptedAt,
        acceptedBy: participant.acceptedBy,
        checkedInAt: now,
        checkedInBy: admin._id,
        qrCodeToken: `HACKUTA-ARCADE-TEST-${randomToken(8)}`,
        registrationQrCodeToken: participant.qrCodeToken,
        points,
        ...(points > 0 ? { pointsReachedAt: now } : {}),
        createdAt: now,
        updatedAt: now,
      });
      if (points > 0) {
        await ctx.db.insert("volunteerActionLogs", {
          actorAdminId: admin._id,
          checkedInId: id,
          action: "admin_adjust",
          pointsDelta: points,
          previousPoints: 0,
          newPoints: points,
          reason: "Arcade test account (sandbox seed)",
          createdAt: now,
        });
      }
      checkedIn = await ctx.db.get(id);
    }
    return { email, userId, checkedInId: checkedIn!._id, profilePoints: checkedIn!.points, existingAccount };
  },
});