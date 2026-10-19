import { minimalPdfBytes } from "../fixtures/minimalPdf";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import { lookupOtpSendStatus } from "../../convex/lib/otpSendStatus";
import { RESUME_UPLOAD_BUCKET } from "../../convex/lib/rateLimitBuckets";
import {
  GENDER_SELF_DESCRIBE_OPTION,
  HEAR_ABOUT_OTHER_OPTION,
  MAJOR_OTHER_OPTION,
  SCHOOL_OTHER_OPTION,
} from "../../shared/registration/constants";
import { formToDraftPatch } from "../../shared/registration/draftMapping";
import { LEGACY_SCHOOL_OTHER_OPTION } from "../../shared/registration/otherOptionMigration";
import { RESUME_FILENAME_HEADER, RESUME_TEST_CONTENT_LENGTH_HEADER } from "../../shared/registration/resume";
import { INITIAL_FORM } from "../../shared/registration/types";
import { validRegistrationPayload } from "../fixtures/validRegistrationForm";

const modules = import.meta.glob("../../convex/**/*.ts", { eager: false });

// Loaded through runtime paths so the web tsconfig does not type-check these Convex sources
// (they depend on the full auth schema types and are compiled under convex/tsconfig.json).
const applicationsModule = "../../convex/lib/applications";
const resumeUploadModule = "../../convex/lib/resumeUpload";
const { formatApplicantFullName } = (await import(/* @vite-ignore */ applicationsModule)) as {
  formatApplicantFullName: (fields: { firstName?: string | null; lastName?: string | null }) => string | null;
};
const { RESUME_UPLOAD_EXPIRY_MS } = (await import(/* @vite-ignore */ resumeUploadModule)) as {
  RESUME_UPLOAD_EXPIRY_MS: number;
};
const createTest = () => convexTest(schema, modules);
type TestInstance = ReturnType<typeof createTest>;

const ref = {
  ensureApplicantApplication: makeFunctionReference<"mutation">("applicant:ensureApplicantApplication"),
  routingState: makeFunctionReference<"query">("applicant:getApplicantRoutingState"),
  getDraft: makeFunctionReference<"query">("applications:getMyApplicationDraft"),
  saveDraft: makeFunctionReference<"mutation">("applications:saveApplicationDraft"),
  dashboard: makeFunctionReference<"query">("applications:getMyApplicantDashboard"),
  submitRegistration: makeFunctionReference<"mutation">(
    "registrations:submitRegistration",
  ),
  discardUpload: makeFunctionReference<"mutation">("resumeUploads:discardUploadSession"),
  createUploadSession: makeFunctionReference<"mutation">("resumeUploads:createVerifiedUploadSession"),
  cleanupUploads: makeFunctionReference<"mutation">("resumeUploads:cleanupExpiredUploadSessions"),
  resetAllData: makeFunctionReference<"mutation">("maintenance:resetAllData"),
  migrateFirstHackathon: makeFunctionReference<"mutation">(
    "migrations:migrateFirstHackathonToHackathonsAttended",
  ),
  migrateOtherDietary: makeFunctionReference<"mutation">(
    "migrations:migrateOtherDietaryToAllergyDetails",
  ),
  stripHackathonIds: makeFunctionReference<"mutation">("migrations:stripLegacyApplicationHackathonIds"),
  stripCheckInAndConfirmedAt: makeFunctionReference<"mutation">(
    "migrations:stripLegacyApplicationCheckInAndConfirmedAt",
  ),
  stripInternalNotes: makeFunctionReference<"mutation">(
    "migrations:stripInternalNotesFromApplications",
  ),
  stripEligibilityStatus: makeFunctionReference<"mutation">(
    "migrations:stripEligibilityStatusFromApplications",
  ),
  stripConfirmationStatus: makeFunctionReference<"mutation">(
    "migrations:stripConfirmationStatusFromApplications",
  ),
  migrateMergedOtherFields: makeFunctionReference<"mutation">(
    "migrations:migrateMergedOtherFieldsToSeparateColumns",
  ),
  migrateLegacyCodeOfConductFields: makeFunctionReference<"mutation">(
    "migrations:migrateLegacyCodeOfConductFields",
  ),
  migrateLegacyAgreementSubmittedAtFields: makeFunctionReference<"mutation">(
    "migrations:migrateLegacyAgreementSubmittedAtFields",
  ),
  publicEventConfig: makeFunctionReference<"query">("eventConfig:getPublicEventConfig"),
  hackathonNameInternal: makeFunctionReference<"query">("eventConfig:getHackathonNameInternal"),
  setHackathonName: makeFunctionReference<"mutation">("eventConfig:setHackathonName"),
  setRegistrationClosesAt: makeFunctionReference<"mutation">("eventConfig:setRegistrationClosesAt"),
};

const TEST_ORIGIN = "https://hackuta.test";

async function seedUser(
  t: Pick<TestInstance, "run">,
  fields: { email?: string; name?: string; emailVerificationTime?: number } = {
    email: "applicant@example.com",
    emailVerificationTime: 1,
  },
) {
  return t.run((ctx) => ctx.db.insert("users", fields));
}

function asUser(t: TestInstance, userId: GenericId<"users">, email?: string) {
  return t.withIdentity({ subject: userId, tokenIdentifier: `user|${userId}`, ...(email ? { email } : {}) });
}

async function storePdf(t: Pick<TestInstance, "run">) {
  const bytes = new Uint8Array(minimalPdfBytes());
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes as BlobPart], { type: "application/pdf" })));
  await t.run((ctx) =>
    (ctx.db.patch as unknown as (id: string, value: { contentType: string }) => Promise<void>)(storageId, {
      contentType: "application/pdf",
    }),
  );
  return { storageId, bytes };
}

async function insertApplication(
  t: Pick<TestInstance, "run">,
  authUserId: GenericId<"users">,
  fields: Record<string, unknown> = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("applications", {
      authUserId,
      email: "applicant@example.com",
      createdAt: 1,
      applicantUpdatedAt: 1,
      ...fields,
    } as never),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("authorization boundaries", () => {
  it("returns no draft and unauthenticated routing for anonymous callers", async () => {
    const t = createTest();
    await expect(t.query(ref.getDraft, {})).resolves.toBeNull();
    await expect(t.query(ref.routingState, {})).resolves.toMatchObject({ authenticated: false });
  });

  it("rejects anonymous dashboard, draft save, and profile bootstrap", async () => {
    const t = createTest();
    await expect(t.query(ref.dashboard, {})).rejects.toThrow("Authentication required.");
    await expect(t.mutation(ref.saveDraft, { patch: formToDraftPatch(INITIAL_FORM) })).rejects.toThrow(
      "Authentication required.",
    );
    await expect(t.mutation(ref.ensureApplicantApplication, {})).rejects.toThrow("Authentication required.");
  });

  it("preserves authentication errors for draft writes after applications close", async () => {
    const t = createTest();
    await t.mutation(ref.setRegistrationClosesAt, { closesAt: Date.now() - 1 });
    await expect(t.mutation(ref.saveDraft, { patch: formToDraftPatch(INITIAL_FORM) }))
      .rejects.toThrow("Authentication required.");
  });

  it("treats an identity for a deleted user with no email as signed out", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    await t.run((ctx) => ctx.db.delete(userId));
    await expect(asUser(t, userId).query(ref.routingState, {})).resolves.toMatchObject({
      authenticated: false,
    });
  });

  it("falls back to the identity email when the subject does not resolve to a user", async () => {
    const t = createTest();
    const userId = await seedUser(t, { email: "fallback@example.com", emailVerificationTime: 1 });
    const identity = t.withIdentity({ tokenIdentifier: "email|fallback", email: " Fallback@Example.com " });
    await expect(identity.query(ref.routingState, {})).resolves.toMatchObject({
      authenticated: true,
      verifiedEmail: "fallback@example.com",
    });
    expect(userId).toBeTruthy();
  });

  it("requires an email on the auth user before creating a profile", async () => {
    const t = createTest();
    const userId = await seedUser(t, { emailVerificationTime: 1 });
    await expect(asUser(t, userId).mutation(ref.ensureApplicantApplication, {})).rejects.toThrow(
      "A verified email is required.",
    );
  });

  it("rejects submission for a verified user whose account has no email", async () => {
    const t = createTest();
    const userId = await seedUser(t, { emailVerificationTime: 1 });
    await expect(
      asUser(t, userId).mutation(ref.submitRegistration, { data: validRegistrationPayload() }),
    ).rejects.toThrow("Authentication required.");
  });

  it("never lets one applicant discard another applicant's upload", async () => {
    const t = createTest();
    const owner = await seedUser(t, { email: "owner@example.com", emailVerificationTime: 1 });
    const other = await seedUser(t, { email: "other@example.com", emailVerificationTime: 1 });
    const { storageId } = await storePdf(t);
    await t.run((ctx) =>
      ctx.db.insert("resumeUploadSessions", {
        token: "owner-token",
        authUserId: owner,
        storageId,
        createdAt: Date.now(),
        verifiedAt: Date.now(),
      }),
    );

    await expect(asUser(t, other).mutation(ref.discardUpload, { uploadToken: "owner-token" })).resolves.toEqual({
      ok: true,
    });
    expect(await t.run((ctx) => ctx.db.query("resumeUploadSessions").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.system.get("_storage", storageId))).not.toBeNull();
  });

  it("keeps an attached resume when its upload session is discarded", async () => {
    const t = createTest();
    const owner = await seedUser(t);
    const { storageId } = await storePdf(t);
    await insertApplication(t, owner, { resumeStorageId: storageId });
    await t.run((ctx) =>
      ctx.db.insert("resumeUploadSessions", {
        token: "attached-token",
        authUserId: owner,
        storageId,
        createdAt: Date.now(),
      }),
    );

    await asUser(t, owner).mutation(ref.discardUpload, { uploadToken: "attached-token" });
    expect(await t.run((ctx) => ctx.db.query("resumeUploadSessions").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.system.get("_storage", storageId))).not.toBeNull();
  });

  it("treats unknown discard tokens as a no-op", async () => {
    const t = createTest();
    const owner = await seedUser(t);
    await expect(asUser(t, owner).mutation(ref.discardUpload, { uploadToken: "missing" })).resolves.toEqual({
      ok: true,
    });
  });
});

describe("profile lifecycle", () => {
  it("backfills email verification onto an existing draft profile", async () => {
    const t = createTest();
    const userId = await seedUser(t, { email: "late@example.com" });
    const client = asUser(t, userId);
    await client.mutation(ref.ensureApplicantApplication, {});
    expect((await t.run((ctx) => ctx.db.query("applications").first()))?.emailVerificationTime).toBeUndefined();

    await t.run((ctx) => ctx.db.patch(userId, { emailVerificationTime: 1234 }));
    const again = await client.mutation(ref.ensureApplicantApplication, {});
    expect(again).toMatchObject({ status: "draft" });
    const applications = await t.run((ctx) => ctx.db.query("applications").collect());
    expect(applications).toHaveLength(1);
    expect(applications[0]?.emailVerificationTime).toBe(1234);
  });

  it("does not rewrite the profile when verification is unchanged", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    const client = asUser(t, userId);
    await client.mutation(ref.ensureApplicantApplication, {});
    const before = await t.run((ctx) => ctx.db.query("applications").first());
    await client.mutation(ref.ensureApplicantApplication, {});
    const after = await t.run((ctx) => ctx.db.query("applications").first());
    expect(after?.applicantUpdatedAt).toBe(before?.applicantUpdatedAt);
  });

  it("keeps applicant draft metadata without legacy review fields", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    const applicationId = await insertApplication(t, userId);
    const client = asUser(t, userId);
    await client.mutation(ref.saveDraft, { patch: formToDraftPatch(INITIAL_FORM) });
    const application = await t.run((ctx) => ctx.db.get(applicationId));
    for (const key of ["status", "updatedAt", "reviewedAt", "reviewedBy"]) {
      expect(application).not.toHaveProperty(key);
    }
    expect(application?.applicantUpdatedAt).toEqual(expect.any(Number));
    await expect(client.query(ref.getDraft, {})).resolves.toMatchObject({ status: "draft" });
    await expect(client.query(ref.dashboard, {})).resolves.toMatchObject({
      registration: { status: "draft", updatedAt: application?.applicantUpdatedAt },
    });
  });

  it("syncs, updates, and clears the auth display name from draft names", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    const client = asUser(t, userId);

    await client.mutation(ref.saveDraft, {
      patch: formToDraftPatch({ ...INITIAL_FORM, firstName: "Sam", lastName: "Test" }),
    });
    expect((await t.run((ctx) => ctx.db.get(userId)))?.name).toBe("Sam Test");

    await client.mutation(ref.saveDraft, {
      patch: formToDraftPatch({ ...INITIAL_FORM, firstName: "Sam", lastName: "" }),
    });
    expect((await t.run((ctx) => ctx.db.get(userId)))?.name).toBe("Sam");

    await client.mutation(ref.saveDraft, { patch: formToDraftPatch(INITIAL_FORM) });
    const cleared = await t.run((ctx) => ctx.db.get(userId));
    expect(cleared).not.toHaveProperty("name");
    expect(cleared?.email).toBe("applicant@example.com");

    await client.mutation(ref.saveDraft, { patch: formToDraftPatch(INITIAL_FORM) });
    expect(await t.run((ctx) => ctx.db.get(userId))).not.toHaveProperty("name");
  });

  it("blocks draft edits after the application is submitted", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    await insertApplication(t, userId, { formSubmitted: true, submittedAt: 5 });
    await expect(
      asUser(t, userId).mutation(ref.saveDraft, { patch: formToDraftPatch(INITIAL_FORM) }),
    ).rejects.toThrow("Your application has already been submitted.");
  });

  it("reports submitted routing state from either submission marker", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    await insertApplication(t, userId, { submittedAt: 5 });
    await expect(asUser(t, userId).query(ref.routingState, {})).resolves.toMatchObject({
      hasSubmittedRegistration: true,
    });
  });

  it("keeps submitted rows readable even when no review row exists", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    await insertApplication(t, userId, { submittedAt: 5 });
    const client = asUser(t, userId);
    await expect(client.query(ref.getDraft, {})).resolves.toMatchObject({
      status: "submitted", draft: null,
    });
    await expect(client.query(ref.dashboard, {})).resolves.toMatchObject({
      registration: { status: "submitted", updatedAt: 1 },
    });
    await expect(client.mutation(ref.saveDraft, {
      patch: formToDraftPatch(INITIAL_FORM),
    })).rejects.toThrow("already been submitted");
    expect(await t.run((ctx) => ctx.db.query("applicationReviews").collect())).toEqual([]);
  });

  it("reports a draft profile as not yet submitted", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    await insertApplication(t, userId);
    await expect(asUser(t, userId).query(ref.routingState, {})).resolves.toMatchObject({
      hasSubmittedRegistration: false,
    });
  });

  it("derives the dashboard display name from profile, account, then identity", async () => {
    const t = createTest();
    const userId = await seedUser(t, { email: "name@example.com", name: "Account Name", emailVerificationTime: 1 });

    const noProfile = (await asUser(t, userId).query(ref.dashboard, {})) as {
      profile: { displayName: string | null };
      registration: unknown;
    };
    expect(noProfile.profile.displayName).toBe("Account Name");
    expect(noProfile.registration).toBeNull();

    await insertApplication(t, userId, { firstName: "Profile", lastName: "Name" });
    const withProfile = (await asUser(t, userId).query(ref.dashboard, {})) as {
      profile: { displayName: string | null };
    };
    expect(withProfile.profile.displayName).toBe("Profile Name");

    const identityOnly = (await t
      .withIdentity({ tokenIdentifier: "x", name: "Identity Name", email: "nobody@example.com" })
      .query(ref.dashboard, {})) as { profile: { displayName: string | null; verifiedEmail: string | null } };
    expect(identityOnly.profile).toEqual({ displayName: "Identity Name", verifiedEmail: "nobody@example.com" });

    const anonymousish = (await t.withIdentity({ tokenIdentifier: "y" }).query(ref.dashboard, {})) as {
      profile: { displayName: string | null; verifiedEmail: string | null };
    };
    expect(anonymousish.profile).toEqual({ displayName: null, verifiedEmail: null });
  });

  it.each([
    [{ firstName: " Sam ", lastName: " Test " }, "Sam Test"],
    [{ firstName: "Sam", lastName: "  " }, "Sam"],
    [{ firstName: null, lastName: "Test" }, "Test"],
    [{}, null],
  ])("formats full name %j", (fields, expected) => {
    expect(formatApplicantFullName(fields)).toBe(expected);
  });
});

describe("registration resume replacement", () => {
  it("replaces a previously attached resume and deletes the old file", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    const oldResume = await storePdf(t);
    const newResume = await storePdf(t);
    await insertApplication(t, userId, { resumeStorageId: oldResume.storageId });
    await t.run((ctx) =>
      ctx.db.insert("resumeUploadSessions", {
        token: "new-token",
        authUserId: userId,
        storageId: newResume.storageId,
        createdAt: Date.now(),
        verifiedAt: Date.now(),
      }),
    );

    await expect(
      asUser(t, userId).mutation(ref.submitRegistration, {
        data: { ...validRegistrationPayload(), resumeStorageId: newResume.storageId },
        resumeUploadToken: "new-token",
      }),
    ).resolves.toMatchObject({ ok: true, isNew: false });

    expect(await t.run((ctx) => ctx.db.system.get("_storage", oldResume.storageId))).toBeNull();
    expect((await t.run((ctx) => ctx.db.query("applications").first()))?.resumeStorageId).toBe(newResume.storageId);
    await t.finishInProgressScheduledFunctions();
  });

  it("rejects a malformed storage id as an invalid resume", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    await expect(
      asUser(t, userId).mutation(ref.submitRegistration, {
        data: { ...validRegistrationPayload(), resumeStorageId: "not-a-storage-id" },
        resumeUploadToken: "anything",
      }),
    ).rejects.toThrow("Please upload a valid PDF resume of 2 MB or smaller.");
  });
});

describe("resume upload sessions", () => {
  it("refuses duplicate tokens, missing files, and empty files", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    const { storageId } = await storePdf(t);
    const empty = await t.run((ctx) => ctx.storage.store(new Blob([])));

    await t.mutation(ref.createUploadSession, { uploadToken: "tok", storageId, authUserId: userId });
    await expect(
      t.mutation(ref.createUploadSession, { uploadToken: "tok", storageId, authUserId: userId }),
    ).rejects.toThrow("Invalid resume upload.");
    await expect(
      t.mutation(ref.createUploadSession, { uploadToken: "empty", storageId: empty, authUserId: userId }),
    ).rejects.toThrow("Invalid resume upload.");

    await t.run((ctx) => ctx.storage.delete(storageId));
    await expect(
      t.mutation(ref.createUploadSession, { uploadToken: "gone", storageId, authUserId: userId }),
    ).rejects.toThrow("Invalid resume upload.");
  });

  it("reschedules cleanup when a full page of expired records is found", async () => {
    const t = createTest();
    const old = Date.now() - RESUME_UPLOAD_EXPIRY_MS - 60_000;
    await t.run(async (ctx) => {
      for (let i = 0; i < 101; i += 1) {
        await ctx.db.insert("rateLimits", { bucket: RESUME_UPLOAD_BUCKET, key: `k${i}`, createdAt: old });
      }
    });

    vi.useFakeTimers();
    try {
      await t.mutation(ref.cleanupUploads, {});
      expect(await t.run((ctx) => ctx.db.query("rateLimits").collect())).toHaveLength(1);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
    expect(await t.run((ctx) => ctx.db.query("rateLimits").collect())).toHaveLength(0);
  });
});

describe("resume upload HTTP failure handling", () => {
  async function uploadAs(t: TestInstance, userId: GenericId<"users">, headers: Record<string, string>, body: BodyInit) {
    return asUser(t, userId).fetch("/resume-upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        Origin: TEST_ORIGIN,
        "X-Test-Origin": TEST_ORIGIN,
        [RESUME_FILENAME_HEADER]: "resume.pdf",
        ...headers,
      },
      body,
    });
  }

  it("rejects non-numeric Content-Length values with 400", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    const result = await uploadAs(t, userId, { [RESUME_TEST_CONTENT_LENGTH_HEADER]: "abc" }, "%PDF-");
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "Invalid upload request." });
  });

  it("deletes the stored file and returns 500 when the upload session cannot be created", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    const bytes = new Uint8Array(minimalPdfBytes());

    const collidingToken = "00".repeat(32);
    await t.run((ctx) =>
      ctx.db.insert("resumeUploadSessions", { token: collidingToken, authUserId: userId, createdAt: Date.now() }),
    );
    const realGetRandomValues = crypto.getRandomValues.bind(crypto);
    vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array && array.length === 32) {
        array.fill(0);
        return array;
      }
      return realGetRandomValues(array as never) as T;
    });

    const result = await uploadAs(t, userId, { [RESUME_TEST_CONTENT_LENGTH_HEADER]: String(bytes.byteLength) }, bytes);
    expect(result.status).toBe(500);
    expect(await result.json()).toEqual({ error: "The resume could not be stored." });
    expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toEqual([]);
  });

  it("only trusts the test origin when no allow-list is configured", async () => {
    vi.stubEnv("REGISTRATION_ALLOWED_ORIGINS", "");
    vi.stubEnv("SITE_URL", "");
    const t = createTest();
    const allowed = await t.fetch("/resume-upload", {
      method: "OPTIONS",
      headers: { "X-Test-Origin": TEST_ORIGIN },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(TEST_ORIGIN);

    const denied = await t.fetch("/resume-upload", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("event config", () => {
  it("serves the default name internally and rejects blank renames", async () => {
    const t = createTest();
    await expect(t.query(ref.hackathonNameInternal, {})).resolves.toBe("HackUTA 2026");
    await expect(t.mutation(ref.setHackathonName, { name: "   " })).rejects.toThrow(
      "Hackathon name is required.",
    );
    await expect(t.mutation(ref.setHackathonName, { name: "  HackUTA 8  " })).resolves.toMatchObject({
      ok: true,
      name: "HackUTA 8",
    });
    await expect(t.query(ref.hackathonNameInternal, {})).resolves.toBe("HackUTA 8");
    await expect(t.query(ref.publicEventConfig, {})).resolves.toMatchObject({
      name: "HackUTA 8", registrationClosesAt: null,
    });
  });
});

describe("maintenance and migrations", () => {
  it("wipes every application and auth table plus stored files, across multiple pages", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    const applicationId = await insertApplication(t, userId);
    await storePdf(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("applicationReviews", {
        applicationId, status: "under_review", createdAt: 1, updatedAt: 1,
      });
      for (let i = 0; i < 205; i += 1) {
        await ctx.db.insert("rateLimits", { bucket: "b", key: `k${i}`, createdAt: i });
      }
      const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: 1 });
      await ctx.db.insert("authRefreshTokens", { sessionId, expirationTime: 1 });
      await ctx.db.insert("resumeUploadSessions", { token: "t", authUserId: userId, createdAt: 1 });
    });
    await t.run(async (ctx) => {
      for (let i = 0; i < 100; i += 1) {
        await ctx.storage.store(new Blob([`file-${i}`]));
      }
    });

    await expect(t.mutation(ref.resetAllData, {})).resolves.toEqual({ ok: true });

    await t.run(async (ctx) => {
      for (const table of [
        "applications",
        "applicationReviews",
        "rateLimits",
        "users",
        "authSessions",
        "authRefreshTokens",
        "resumeUploadSessions",
      ] as const) {
        expect(await ctx.db.query(table).collect()).toHaveLength(0);
      }
      expect(await ctx.db.system.query("_storage").collect()).toHaveLength(0);
    });
  }, 30_000);

  it("strips eligibilityStatus from applications", async () => {
    const looseSchema = Object.assign(Object.create(Object.getPrototypeOf(schema)), schema, {
      schemaValidation: false,
    }) as typeof schema;
    const t = convexTest(looseSchema, modules);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "legacy-eligibility@example.com",
        status: "submitted",
        createdAt: 1,
        updatedAt: 1,
        eligibilityStatus: "eligible",
      } as never);
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "clean@example.com",
        createdAt: 2,
        applicantUpdatedAt: 2,
        formSubmitted: true,
        submittedAt: 2,
      });
    });

    await expect(t.mutation(ref.stripEligibilityStatus, {})).resolves.toEqual({
      ok: true,
      updated: 1,
    });

    const applications = await t.run((ctx) => ctx.db.query("applications").collect());
    expect(applications.some((application) => "eligibilityStatus" in application)).toBe(false);
    expect(applications.find((application) => application.email === "clean@example.com")?.formSubmitted).toBe(true);

    await expect(t.mutation(ref.stripEligibilityStatus, {})).resolves.toEqual({
      ok: true,
      updated: 0,
    });
  }, 30_000);

  it("strips confirmationStatus from applications", async () => {
    const looseSchema = Object.assign(Object.create(Object.getPrototypeOf(schema)), schema, {
      schemaValidation: false,
    }) as typeof schema;
    const t = convexTest(looseSchema, modules);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "legacy-confirmation@example.com",
        status: "submitted",
        createdAt: 1,
        updatedAt: 1,
        confirmationStatus: "unconfirmed",
      } as never);
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "clean@example.com",
        createdAt: 2,
        applicantUpdatedAt: 2,
        formSubmitted: true,
        submittedAt: 2,
      });
    });

    await expect(t.mutation(ref.stripConfirmationStatus, {})).resolves.toEqual({
      ok: true,
      updated: 1,
    });

    const applications = await t.run((ctx) => ctx.db.query("applications").collect());
    expect(applications.some((application) => "confirmationStatus" in application)).toBe(false);
    expect(applications.find((application) => application.email === "clean@example.com")?.formSubmitted).toBe(true);

    await expect(t.mutation(ref.stripConfirmationStatus, {})).resolves.toEqual({
      ok: true,
      updated: 0,
    });
  }, 30_000);

  it("strips internalNotes from applications", async () => {
    const looseSchema = Object.assign(Object.create(Object.getPrototypeOf(schema)), schema, {
      schemaValidation: false,
    }) as typeof schema;
    const t = convexTest(looseSchema, modules);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "notes@example.com",
        status: "accepted",
        createdAt: 1,
        updatedAt: 1,
        internalNotes: "Needs follow-up",
      } as never);
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "clean@example.com",
        createdAt: 2,
        applicantUpdatedAt: 2,
        formSubmitted: true,
        submittedAt: 2,
      });
    });

    await expect(t.mutation(ref.stripInternalNotes, {})).resolves.toEqual({
      ok: true,
      updated: 1,
    });

    const applications = await t.run((ctx) => ctx.db.query("applications").collect());
    expect(applications.some((application) => "internalNotes" in application)).toBe(false);
    expect(applications.find((application) => application.email === "clean@example.com")?.formSubmitted).toBe(true);

    await expect(t.mutation(ref.stripInternalNotes, {})).resolves.toEqual({
      ok: true,
      updated: 0,
    });
  }, 30_000);

  it("strips legacy checkedInAt and confirmedAt fields from applications", async () => {
    const looseSchema = Object.assign(Object.create(Object.getPrototypeOf(schema)), schema, {
      schemaValidation: false,
    }) as typeof schema;
    const t = convexTest(looseSchema, modules);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "legacy-checkin@example.com",
        status: "accepted",
        createdAt: 1,
        updatedAt: 1,
        checkedInAt: 2,
        confirmedAt: 3,
      } as never);
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "clean@example.com",
        createdAt: 4,
        applicantUpdatedAt: 4,
        formSubmitted: true,
        submittedAt: 4,
      });
    });

    await expect(t.mutation(ref.stripCheckInAndConfirmedAt, {})).resolves.toEqual({
      ok: true,
      updated: 1,
    });

    const applications = await t.run((ctx) => ctx.db.query("applications").collect());
    expect(applications.some((application) => "checkedInAt" in application)).toBe(false);
    expect(applications.some((application) => "confirmedAt" in application)).toBe(false);
    expect(applications.find((application) => application.email === "clean@example.com")?.formSubmitted).toBe(true);

    await expect(t.mutation(ref.stripCheckInAndConfirmedAt, {})).resolves.toEqual({
      ok: true,
      updated: 0,
    });
  }, 30_000);

  it("migrates legacy firstHackathon answers to hackathonsAttended and removes the legacy field", async () => {
    const looseSchema = Object.assign(Object.create(Object.getPrototypeOf(schema)), schema, {
      schemaValidation: false,
    }) as typeof schema;
    const t = convexTest(looseSchema, modules);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "first-timer@example.com",
        status: "submitted",
        createdAt: 1,
        updatedAt: 1,
        firstHackathon: true,
      } as never);
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "returning@example.com",
        status: "submitted",
        createdAt: 2,
        updatedAt: 2,
        firstHackathon: false,
      } as never);
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "already-migrated@example.com",
        createdAt: 3,
        applicantUpdatedAt: 3,
        hackathonsAttended: 5,
      });
    });

    await expect(t.mutation(ref.migrateFirstHackathon, {})).resolves.toEqual({
      ok: true,
      updated: 2,
    });

    const applications = await t.run((ctx) => ctx.db.query("applications").collect());
    expect(applications.some((application) => "firstHackathon" in application)).toBe(false);
    expect(
      applications.find((application) => application.email === "first-timer@example.com")
        ?.hackathonsAttended,
    ).toBe(0);
    expect(
      applications.find((application) => application.email === "returning@example.com")
        ?.hackathonsAttended,
    ).toBe(1);
    expect(
      applications.find((application) => application.email === "already-migrated@example.com")
        ?.hackathonsAttended,
    ).toBe(5);

    await expect(t.mutation(ref.migrateFirstHackathon, {})).resolves.toEqual({
      ok: true,
      updated: 0,
    });
  }, 30_000);

  it("migrates legacy otherDietary to allergyDetails and preserves allergyDetails as the winner", async () => {
    const looseSchema = Object.assign(Object.create(Object.getPrototypeOf(schema)), schema, {
      schemaValidation: false,
    }) as typeof schema;
    const t = convexTest(looseSchema, modules);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "legacy-only@example.com",
        status: "draft",
        createdAt: 1,
        updatedAt: 1,
        otherDietary: "Shellfish",
      } as never);
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "both-columns@example.com",
        status: "draft",
        createdAt: 2,
        updatedAt: 2,
        allergyDetails: "Peanuts",
        otherDietary: "Shellfish",
      } as never);
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "already-migrated@example.com",
        createdAt: 3,
        applicantUpdatedAt: 3,
        allergyDetails: "Tree nuts",
      });
    });

    await expect(t.mutation(ref.migrateOtherDietary, {})).resolves.toEqual({
      ok: true,
      updated: 2,
    });

    const applications = await t.run((ctx) => ctx.db.query("applications").collect());
    expect(applications.some((application) => "otherDietary" in application)).toBe(false);
    expect(
      applications.find((application) => application.email === "legacy-only@example.com")
        ?.allergyDetails,
    ).toBe("Shellfish");
    expect(
      applications.find((application) => application.email === "both-columns@example.com")
        ?.allergyDetails,
    ).toBe("Peanuts");
    expect(
      applications.find((application) => application.email === "already-migrated@example.com")
        ?.allergyDetails,
    ).toBe("Tree nuts");

    await expect(t.mutation(ref.migrateOtherDietary, {})).resolves.toEqual({
      ok: true,
      updated: 0,
    });
  }, 30_000);

  it("strips legacy hackathonId fields across applications and leaves others untouched", async () => {
    const looseSchema = Object.assign(Object.create(Object.getPrototypeOf(schema)), schema, {
      schemaValidation: false,
    }) as typeof schema;
    const t = convexTest(looseSchema, modules);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 105; i += 1) {
        await ctx.db.insert("applications", {
          authUserId: userId,
          email: `p${i}@example.com`,
          status: "draft",
          createdAt: i,
          updatedAt: i,
          ...(i % 50 === 0 ? { hackathonId: "hackuta-2025" } : {}),
        } as never);
      }
    });

    await expect(t.mutation(ref.stripHackathonIds, {})).resolves.toEqual({ ok: true, updated: 3 });
    const applications = await t.run((ctx) => ctx.db.query("applications").collect());
    expect(applications).toHaveLength(105);
    expect(applications.some((application) => "hackathonId" in application)).toBe(false);
    expect(applications.find((application) => application.email === "p50@example.com")?.createdAt).toBe(50);

    await expect(t.mutation(ref.stripHackathonIds, {})).resolves.toEqual({ ok: true, updated: 0 });
  }, 30_000);

  it("migrates merged Other/self-describe answers into separate other* columns", async () => {
    const t = createTest();
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "merged-other@example.com",
        createdAt: 1,
        applicantUpdatedAt: 1,
        formSubmitted: true,
        submittedAt: 1,
        school: "Mars Academy",
        major: "Biomedical engineering",
        hearAbout: "Professor announcement",
        gender: "Genderfluid",
      });
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "legacy-sentinel@example.com",
        createdAt: 2,
        applicantUpdatedAt: 2,
        school: LEGACY_SCHOOL_OTHER_OPTION,
        otherSchool: "Homeschool Co-op",
      });
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "already-split@example.com",
        createdAt: 3,
        applicantUpdatedAt: 3,
        school: SCHOOL_OTHER_OPTION,
        otherSchool: "Mars Academy",
        major: MAJOR_OTHER_OPTION,
        otherMajor: "Biomedical engineering",
        hearAbout: HEAR_ABOUT_OTHER_OPTION,
        otherHearAbout: "Professor announcement",
        gender: GENDER_SELF_DESCRIBE_OPTION,
        otherGender: "Genderfluid",
      });
    });

    await expect(t.mutation(ref.migrateMergedOtherFields, {})).resolves.toEqual({
      ok: true,
      updated: 2,
    });

    const applications = await t.run((ctx) => ctx.db.query("applications").collect());
    const merged = applications.find((application) => application.email === "merged-other@example.com");
    expect(merged?.school).toBe(SCHOOL_OTHER_OPTION);
    expect(merged?.otherSchool).toBe("Mars Academy");
    expect(merged?.major).toBe(MAJOR_OTHER_OPTION);
    expect(merged?.otherMajor).toBe("Biomedical engineering");
    expect(merged?.hearAbout).toBe(HEAR_ABOUT_OTHER_OPTION);
    expect(merged?.otherHearAbout).toBe("Professor announcement");
    expect(merged?.gender).toBe(GENDER_SELF_DESCRIBE_OPTION);
    expect(merged?.otherGender).toBe("Genderfluid");

    const legacySentinel = applications.find(
      (application) => application.email === "legacy-sentinel@example.com",
    );
    expect(legacySentinel?.school).toBe(SCHOOL_OTHER_OPTION);
    expect(legacySentinel?.otherSchool).toBe("Homeschool Co-op");

    await expect(t.mutation(ref.migrateMergedOtherFields, {})).resolves.toEqual({
      ok: true,
      updated: 0,
    });
  }, 30_000);

  it("renames legacy agreement SubmittedAt columns to the At convention", async () => {
    const looseSchema = Object.assign(Object.create(Object.getPrototypeOf(schema)), schema, {
      schemaValidation: false,
    }) as typeof schema;
    const t = convexTest(looseSchema, modules);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "legacy-sponsor@example.com",
        status: "submitted",
        createdAt: 1,
        updatedAt: 1,
        sponsorSharingConsentSubmittedAt: 100,
      } as never);
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "legacy-waiver@example.com",
        status: "submitted",
        createdAt: 2,
        updatedAt: 2,
        foodAllergyWaiverSubmittedAt: 200,
      } as never);
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "already-migrated@example.com",
        createdAt: 3,
        applicantUpdatedAt: 3,
        sponsorSharingConsentAt: 300,
        foodAllergyWaiverAgreedAt: 400,
      });
    });

    await expect(t.mutation(ref.migrateLegacyAgreementSubmittedAtFields, {})).resolves.toEqual({
      ok: true,
      updated: 2,
    });

    const applications = await t.run((ctx) => ctx.db.query("applications").collect());
    expect(applications.some((application) => "sponsorSharingConsentSubmittedAt" in application)).toBe(
      false,
    );
    expect(applications.some((application) => "foodAllergyWaiverSubmittedAt" in application)).toBe(
      false,
    );
    expect(
      applications.find((application) => application.email === "legacy-sponsor@example.com")
        ?.sponsorSharingConsentAt,
    ).toBe(100);
    expect(
      applications.find((application) => application.email === "legacy-waiver@example.com")
        ?.foodAllergyWaiverAgreedAt,
    ).toBe(200);
    expect(
      applications.find((application) => application.email === "already-migrated@example.com")
        ?.sponsorSharingConsentAt,
    ).toBe(300);
    expect(
      applications.find((application) => application.email === "already-migrated@example.com")
        ?.foodAllergyWaiverAgreedAt,
    ).toBe(400);

    await expect(t.mutation(ref.migrateLegacyAgreementSubmittedAtFields, {})).resolves.toEqual({
      ok: true,
      updated: 0,
    });
  }, 30_000);

  it("consolidates legacy code-of-conduct columns into mlhCodeOfConductAgreed", async () => {
    const looseSchema = Object.assign(Object.create(Object.getPrototypeOf(schema)), schema, {
      schemaValidation: false,
    }) as typeof schema;
    const t = convexTest(looseSchema, modules);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "legacy-code@example.com",
        status: "submitted",
        createdAt: 1,
        updatedAt: 1,
        codeOfConductAgreed: true,
      } as never);
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "interim-code@example.com",
        status: "submitted",
        createdAt: 2,
        updatedAt: 2,
        MLHcodeOfConductAgreed: false,
      } as never);
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "prefers-canonical@example.com",
        status: "submitted",
        createdAt: 3,
        updatedAt: 3,
        mlhCodeOfConductAgreed: true,
        codeOfConductAgreed: false,
        MLHcodeOfConductAgreed: false,
      } as never);
      await ctx.db.insert("applications", {
        authUserId: userId,
        email: "already-migrated@example.com",
        createdAt: 4,
        applicantUpdatedAt: 4,
        mlhCodeOfConductAgreed: true,
      });
    });

    await expect(t.mutation(ref.migrateLegacyCodeOfConductFields, {})).resolves.toEqual({
      ok: true,
      updated: 3,
    });

    const applications = await t.run((ctx) => ctx.db.query("applications").collect());
    expect(applications.some((application) => "codeOfConductAgreed" in application)).toBe(false);
    expect(applications.some((application) => "MLHcodeOfConductAgreed" in application)).toBe(false);
    expect(
      applications.find((application) => application.email === "legacy-code@example.com")
        ?.mlhCodeOfConductAgreed,
    ).toBe(true);
    expect(
      applications.find((application) => application.email === "interim-code@example.com")
        ?.mlhCodeOfConductAgreed,
    ).toBe(false);
    expect(
      applications.find((application) => application.email === "prefers-canonical@example.com")
        ?.mlhCodeOfConductAgreed,
    ).toBe(true);
    expect(
      applications.find((application) => application.email === "already-migrated@example.com")
        ?.mlhCodeOfConductAgreed,
    ).toBe(true);

    await expect(t.mutation(ref.migrateLegacyCodeOfConductFields, {})).resolves.toEqual({
      ok: true,
      updated: 0,
    });
  }, 30_000);
});

describe("lookupOtpSendStatus", () => {
  it("short-circuits blank emails without touching the database", async () => {
    const db = { query: vi.fn() };
    await expect(lookupOtpSendStatus({ db } as never, "  ")).resolves.toEqual({
      waitSeconds: 0,
      hourlyLimitReached: false,
    });
    expect(db.query).not.toHaveBeenCalled();
  });
});
