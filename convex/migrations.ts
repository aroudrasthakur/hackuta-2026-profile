import type { GenericMutationCtx } from "convex/server";
import { resolveAllergyDetailsFromLegacy } from "../shared/registration/allergyMigration";
import {
  splitLegacyGender,
  splitLegacyHearAbout,
  splitLegacyMajor,
  splitLegacySchool,
} from "../shared/registration/otherOptionMigration";
import { mergeLegacyMeatPreferencesIntoDietaryRestrictions } from "../shared/registration/dietaryMigration";
import { internalMutation } from "./_generated/server";

/** Wide db for one-time reads of legacy tables removed from the schema. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy migration only
type LegacyMigrationDb = GenericMutationCtx<any>["db"];

/** One-time cleanup after removing image and points from the users schema. */
export const stripLegacyUserImageAndPoints = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;

    for await (const user of ctx.db.query("users")) {
      if (!("image" in user) && !("points" in user)) {
        continue;
      }
      const { _id, _creationTime, image: _image, points: _points, ...replacement } = user as typeof user & {
        image?: string;
        points?: number;
      };
      void _creationTime;
      void _image;
      void _points;
      await ctx.db.replace(_id, replacement);
      updated += 1;
    }

    return { ok: true as const, updated };
  },
});

/** One-time copy from legacy `profiles` rows into `applications`, then delete the source rows. */
export const migrateProfilesToApplications = internalMutation({
  args: {},
  handler: async (ctx) => {
    let migrated = 0;
    let skipped = 0;
    const db = ctx.db as LegacyMigrationDb;

    for await (const profile of db.query("profiles")) {
      const existing = await ctx.db
        .query("applications")
        .withIndex("by_auth_user", (q) => q.eq("authUserId", profile.authUserId))
        .first();

      if (!existing) {
        const { _id, _creationTime, ...rest } = profile;
        void _id;
        void _creationTime;
        await ctx.db.insert("applications", rest);
        migrated += 1;
      } else {
        skipped += 1;
      }

      await db.delete(profile._id);
    }

    return { ok: true as const, migrated, skipped };
  },
});

/**
 * One-time migration: map legacy eatsBeef/eatsPork "No" answers to dietary
 * restrictions, then remove the legacy columns from stored applications.
 */
export const migrateEatsBeefAndPorkToDietaryRestrictions = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;

    for await (const application of ctx.db.query("applications")) {
      if (!("eatsBeef" in application) && !("eatsPork" in application)) {
        continue;
      }

      const legacy = application as typeof application & {
        eatsBeef?: boolean;
        eatsPork?: boolean;
      };
      const dietaryRestrictions = mergeLegacyMeatPreferencesIntoDietaryRestrictions(
        legacy.dietaryRestrictions,
        legacy.eatsBeef,
        legacy.eatsPork,
      );

      const {
        _id,
        _creationTime,
        eatsBeef: _eatsBeef,
        eatsPork: _eatsPork,
        ...replacement
      } = legacy;
      void _creationTime;
      void _eatsBeef;
      void _eatsPork;

      await ctx.db.replace(_id, {
        ...replacement,
        dietaryRestrictions:
          dietaryRestrictions.length > 0 ? dietaryRestrictions : undefined,
      });
      updated += 1;
    }

    return { ok: true as const, updated };
  },
});

/** One-time cleanup after removing internalNotes from the applications schema. */
export const stripInternalNotesFromApplications = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;

    for await (const application of ctx.db.query("applications")) {
      if (!("internalNotes" in application)) {
        continue;
      }
      const {
        _id,
        _creationTime,
        internalNotes: _internalNotes,
        ...replacement
      } = application as typeof application & {
        internalNotes?: string;
      };
      void _creationTime;
      void _internalNotes;
      await ctx.db.replace(_id, replacement);
      updated += 1;
    }

    return { ok: true as const, updated };
  },
});

/** One-time cleanup after removing eligibilityStatus from the applications schema. */
export const stripEligibilityStatusFromApplications = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;

    for await (const application of ctx.db.query("applications")) {
      if (!("eligibilityStatus" in application)) {
        continue;
      }
      const {
        _id,
        _creationTime,
        eligibilityStatus: _eligibilityStatus,
        ...replacement
      } = application as typeof application & {
        eligibilityStatus?: string;
      };
      void _creationTime;
      void _eligibilityStatus;
      await ctx.db.replace(_id, replacement);
      updated += 1;
    }

    return { ok: true as const, updated };
  },
});

/** One-time cleanup after removing confirmationStatus from the applications schema. */
export const stripConfirmationStatusFromApplications = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;

    for await (const application of ctx.db.query("applications")) {
      if (!("confirmationStatus" in application)) {
        continue;
      }
      const {
        _id,
        _creationTime,
        confirmationStatus: _confirmationStatus,
        ...replacement
      } = application as typeof application & {
        confirmationStatus?: string;
      };
      void _creationTime;
      void _confirmationStatus;
      await ctx.db.replace(_id, replacement);
      updated += 1;
    }

    return { ok: true as const, updated };
  },
});

/** One-time cleanup after removing checkedInAt and confirmedAt from the applications schema. */
export const stripLegacyApplicationCheckInAndConfirmedAt = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;

    for await (const application of ctx.db.query("applications")) {
      if (!("checkedInAt" in application) && !("confirmedAt" in application)) {
        continue;
      }
      const {
        _id,
        _creationTime,
        checkedInAt: _checkedInAt,
        confirmedAt: _confirmedAt,
        ...replacement
      } = application as typeof application & {
        checkedInAt?: number;
        confirmedAt?: number;
      };
      void _creationTime;
      void _checkedInAt;
      void _confirmedAt;
      await ctx.db.replace(_id, replacement);
      updated += 1;
    }

    return { ok: true as const, updated };
  },
});

/**
 * One-time migration: replace legacy firstHackathon yes/no answers with
 * hackathonsAttended counts, then remove the legacy column.
 */
export const migrateFirstHackathonToHackathonsAttended = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;

    for await (const application of ctx.db.query("applications")) {
      const legacy = application as typeof application & {
        firstHackathon?: boolean | null;
        hackathonsAttended?: number;
      };

      if (!("firstHackathon" in legacy) && legacy.hackathonsAttended !== undefined) {
        continue;
      }

      let hackathonsAttended = legacy.hackathonsAttended;
      if (hackathonsAttended === undefined) {
        if (legacy.firstHackathon === true) {
          hackathonsAttended = 0;
        } else if (legacy.firstHackathon === false) {
          hackathonsAttended = 1;
        }
      }

      const { _id, _creationTime, firstHackathon: _removed, ...replacement } = legacy;
      void _creationTime;
      void _removed;
      await ctx.db.replace(_id, {
        ...replacement,
        ...(hackathonsAttended !== undefined ? { hackathonsAttended } : {}),
      });
      updated += 1;
    }

    return { ok: true as const, updated };
  },
});

/**
 * One-time migration: rename legacy `otherDietary` allergy text to
 * `allergyDetails`, then remove the old column.
 */
export const migrateOtherDietaryToAllergyDetails = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;

    for await (const application of ctx.db.query("applications")) {
      const legacy = application as typeof application & {
        otherDietary?: string;
        allergyDetails?: string;
      };

      if (!("otherDietary" in legacy)) {
        continue;
      }

      const allergyDetails = resolveAllergyDetailsFromLegacy(
        legacy.allergyDetails,
        legacy.otherDietary,
      );
      const { _id, _creationTime, otherDietary: _removed, ...replacement } = legacy;
      void _creationTime;
      void _removed;

      await ctx.db.replace(_id, {
        ...replacement,
        ...(allergyDetails !== undefined ? { allergyDetails } : {}),
      });
      updated += 1;
    }

    return { ok: true as const, updated };
  },
});

/**
 * One-time migration: store custom school/major/hear-about text in separate
 * `other*` columns instead of merged parent fields, and normalize the school
 * Other sentinel from legacy `"Other:"` to `"Other (Please Specify)"`.
 */
export const migrateMergedOtherFieldsToSeparateColumns = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;

    for await (const application of ctx.db.query("applications")) {
      const legacy = application as typeof application & {
        school?: string;
        otherSchool?: string;
        major?: string;
        otherMajor?: string;
        hearAbout?: string;
        otherHearAbout?: string;
        gender?: string;
        otherGender?: string;
      };

      const schoolSplit = splitLegacySchool(legacy.school, legacy.otherSchool);
      const majorSplit = splitLegacyMajor(legacy.major, legacy.otherMajor);
      const hearAboutSplit = splitLegacyHearAbout(
        legacy.hearAbout,
        legacy.otherHearAbout,
      );
      const genderSplit = splitLegacyGender(legacy.gender, legacy.otherGender);

      const patch: Record<string, string | undefined> = {};

      if (schoolSplit.school !== (legacy.school ?? "")) {
        patch.school = schoolSplit.school || undefined;
      }
      if (schoolSplit.otherSchool !== (legacy.otherSchool ?? "")) {
        patch.otherSchool = schoolSplit.otherSchool || undefined;
      }
      if (majorSplit.major !== (legacy.major ?? "")) {
        patch.major = majorSplit.major || undefined;
      }
      if (majorSplit.otherMajor !== (legacy.otherMajor ?? "")) {
        patch.otherMajor = majorSplit.otherMajor || undefined;
      }
      if (hearAboutSplit.hearAbout !== (legacy.hearAbout ?? "")) {
        patch.hearAbout = hearAboutSplit.hearAbout || undefined;
      }
      if (hearAboutSplit.otherHearAbout !== (legacy.otherHearAbout ?? "")) {
        patch.otherHearAbout = hearAboutSplit.otherHearAbout || undefined;
      }
      if (genderSplit.gender !== (legacy.gender ?? "")) {
        patch.gender = genderSplit.gender || undefined;
      }
      if (genderSplit.otherGender !== (legacy.otherGender ?? "")) {
        patch.otherGender = genderSplit.otherGender || undefined;
      }

      if (Object.keys(patch).length === 0) {
        continue;
      }

      await ctx.db.patch(application._id, patch);
      updated += 1;
    }

    return { ok: true as const, updated };
  },
});

/**
 * One-time migration: consolidate legacy `codeOfConductAgreed` and interim
 * `MLHcodeOfConductAgreed` into `mlhCodeOfConductAgreed`.
 */
export const migrateLegacyCodeOfConductFields = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;

    for await (const application of ctx.db.query("applications")) {
      const legacy = application as typeof application & {
        codeOfConductAgreed?: boolean;
        MLHcodeOfConductAgreed?: boolean;
        mlhCodeOfConductAgreed?: boolean;
      };

      const hasLegacyColumn =
        "codeOfConductAgreed" in legacy || "MLHcodeOfConductAgreed" in legacy;
      if (!hasLegacyColumn) {
        continue;
      }

      const {
        _id,
        _creationTime,
        codeOfConductAgreed,
        MLHcodeOfConductAgreed,
        ...replacement
      } = legacy;
      void _creationTime;
      void codeOfConductAgreed;
      void MLHcodeOfConductAgreed;

      const mlhCodeOfConductAgreed =
        legacy.mlhCodeOfConductAgreed ??
        legacy.MLHcodeOfConductAgreed ??
        legacy.codeOfConductAgreed;

      await ctx.db.replace(_id, {
        ...replacement,
        ...(mlhCodeOfConductAgreed !== undefined
          ? { mlhCodeOfConductAgreed }
          : {}),
      });
      updated += 1;
    }

    return { ok: true as const, updated };
  },
});

/** @deprecated Use migrateLegacyCodeOfConductFields */
export const migrateCodeOfConductAgreedToMlhField = migrateLegacyCodeOfConductFields;

/**
 * One-time migration: rename legacy `sponsorSharingConsentSubmittedAt` and
 * `foodAllergyWaiverSubmittedAt` to `sponsorSharingConsentAt` and
 * `foodAllergyWaiverAgreedAt`.
 */
export const migrateLegacyAgreementSubmittedAtFields = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;

    for await (const application of ctx.db.query("applications")) {
      const legacy = application as typeof application & {
        sponsorSharingConsentSubmittedAt?: number;
        foodAllergyWaiverSubmittedAt?: number;
        sponsorSharingConsentAt?: number;
        foodAllergyWaiverAgreedAt?: number;
      };

      const hasLegacyColumn =
        "sponsorSharingConsentSubmittedAt" in legacy ||
        "foodAllergyWaiverSubmittedAt" in legacy;
      if (!hasLegacyColumn) {
        continue;
      }

      const {
        _id,
        _creationTime,
        sponsorSharingConsentSubmittedAt,
        foodAllergyWaiverSubmittedAt,
        ...replacement
      } = legacy;
      void _creationTime;

      const sponsorSharingConsentAt =
        legacy.sponsorSharingConsentAt ?? sponsorSharingConsentSubmittedAt;
      const foodAllergyWaiverAgreedAt =
        legacy.foodAllergyWaiverAgreedAt ?? foodAllergyWaiverSubmittedAt;

      await ctx.db.replace(_id, {
        ...replacement,
        ...(sponsorSharingConsentAt !== undefined
          ? { sponsorSharingConsentAt }
          : {}),
        ...(foodAllergyWaiverAgreedAt !== undefined
          ? { foodAllergyWaiverAgreedAt }
          : {}),
      });
      updated += 1;
    }

    return { ok: true as const, updated };
  },
});

/** One-time cleanup after removing hackathonId from the applications schema. */
export const stripLegacyApplicationHackathonIds = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;

    // Stream every application through one query. Convex allows only a single
    // `.paginate()` per function execution, so a paginate loop fails once the
    // table grows past one page.
    for await (const application of ctx.db.query("applications")) {
      if (!("hackathonId" in application)) {
        continue;
      }
      const { _id, _creationTime, hackathonId: _removed, ...replacement } = application as typeof application & {
        hackathonId?: string;
      };
      void _creationTime;
      void _removed;
      await ctx.db.replace(_id, replacement);
      updated += 1;
    }

    return { ok: true as const, updated };
  },
});
