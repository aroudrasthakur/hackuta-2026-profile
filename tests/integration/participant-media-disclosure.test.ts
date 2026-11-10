import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptMyMediaDisclosureRef,
  generateMyAppleWalletPassRef,
  getMyParticipantDashboardRef,
} from "../../src/convex/api";
import { getRuntimeTestAppleWalletCredentials } from "../helpers/appleWalletTestCerts";
import { createConvexTest, type ConvexTestInstance } from "../helpers/convexTestContext";
import { seedApplicant, seedStaff } from "../helpers/reviewTestKit";
import { insertStaffSession } from "../helpers/staffTestFixtures";

const resolveRegistrationForCheckInRef = makeFunctionReference<
  "mutation",
  { sessionToken: string; registrationQrCodeToken: string },
  { status: string }
>("admin/badgeCheckIn:resolveRegistrationForCheckIn");

const checkInWithBadgeRef = makeFunctionReference<
  "mutation",
  { sessionToken: string; registrationQrCodeToken: string; badgeQrCodeToken: string },
  { status: string }
>("admin/badgeCheckIn:checkInWithBadge");

const TOKEN = "a1".repeat(32);
const BADGE = "HACKUTA-BADGE-0001";

async function seedAcceptedParticipant(
  t: ConvexTestInstance,
  email: string,
  options: { queuedAcceptance?: boolean } = {},
) {
  const applicant = await seedApplicant(t, { email, submitted: true });
  const staff = await seedStaff(t);
  const participantId = await t.run(async (ctx) => {
    const review = await ctx.db
      .query("applicationReviews")
      .withIndex("by_application", (q) => q.eq("applicationId", applicant.applicationId))
      .unique();
    if (!review) throw new Error("Expected review row from seedApplicant");
    await ctx.db.patch(review._id, {
      status: "accepted",
      reviewedBy: staff.adminId,
      completedAt: Date.now(),
    });
    const participantId = await ctx.db.insert("participants", {
      applicationId: applicant.applicationId,
      authUserId: applicant.userId,
      acceptedAt: 1,
      acceptedBy: staff.adminId,
      qrCodeToken: TOKEN,
      createdAt: 1,
      updatedAt: 1,
    });
    if (options.queuedAcceptance) {
      await ctx.db.insert("decisionEmailQueue", {
        applicationId: applicant.applicationId,
        decision: "accepted",
        recipientEmail: email,
        applicantName: "Taylor Student",
        status: "queued",
        queuedBy: staff.adminId,
        queuedAt: 1,
        updatedAt: 1,
      });
    }
    return participantId;
  });
  return {
    applicant,
    staff,
    participantId,
    asParticipant: t.withIdentity({ subject: applicant.userId, email }),
  };
}

describe("media disclosure gate", () => {
  it("withholds the registration QR until the participant accepts", async () => {
    const t = createConvexTest();
    const { asParticipant } = await seedAcceptedParticipant(t, "gate@example.com");

    const before = await asParticipant.query(getMyParticipantDashboardRef, {});
    expect(before?.participant).toEqual({
      status: "awaiting_media_disclosure",
      acceptedAt: 1,
    });
    expect(JSON.stringify(before)).not.toContain(TOKEN);

    const accepted = await asParticipant.mutation(acceptMyMediaDisclosureRef, {});
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error("Expected acceptance");

    const after = await asParticipant.query(getMyParticipantDashboardRef, {});
    expect(after?.participant).toEqual({
      status: "awaiting_check_in",
      acceptedAt: 1,
      qrCodeToken: TOKEN,
    });
  });

  it("keeps the first acceptedAt on a second confirm", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      const t = createConvexTest();
      const { asParticipant, participantId } = await seedAcceptedParticipant(t, "once@example.com");

      const first = await asParticipant.mutation(acceptMyMediaDisclosureRef, {});
      expect(first).toEqual({ ok: true, acceptedAt: 1_700_000_000_000 });

      vi.setSystemTime(1_700_000_000_000 + 60_000);
      const second = await asParticipant.mutation(acceptMyMediaDisclosureRef, {});
      expect(second).toEqual({ ok: true, acceptedAt: 1_700_000_000_000 });

      const stored = await t.run(async (ctx) =>
        ctx.db
          .query("participantMediaDisclosures")
          .withIndex("by_participant", (q) => q.eq("participantId", participantId))
          .unique(),
      );
      expect(stored?.acceptedAt).toBe(1_700_000_000_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects unauthenticated and unaccepted callers", async () => {
    const t = createConvexTest();
    await seedAcceptedParticipant(t, "owned@example.com");

    expect(await t.mutation(acceptMyMediaDisclosureRef, {})).toEqual({
      ok: false,
      code: "unauthenticated",
    });

    const pending = await seedApplicant(t, { email: "pending@example.com", submitted: true });
    const asPending = t.withIdentity({
      subject: pending.userId,
      email: "pending@example.com",
    });
    expect(await asPending.mutation(acceptMyMediaDisclosureRef, {})).toEqual({
      ok: false,
      code: "not_eligible",
    });

    const queued = await seedAcceptedParticipant(t, "queued@example.com", { queuedAcceptance: true });
    expect(await queued.asParticipant.mutation(acceptMyMediaDisclosureRef, {})).toEqual({
      ok: false,
      code: "not_eligible",
    });

    const rows = await t.run(async (ctx) => ctx.db.query("participantMediaDisclosures").collect());
    expect(rows).toEqual([]);
  });

  it("blocks volunteer door check-in until a disclosure row exists", async () => {
    const t = createConvexTest();
    await seedAcceptedParticipant(t, "door@example.com");
    const sessionToken = "f".repeat(64);
    const adminId = await t.run((ctx) =>
      ctx.db.insert("admins", {
        email: "door@hackuta.org",
        name: "Door Volunteer",
        role: "volunteer",
        active: true,
        canCheckIn: true,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await insertStaffSession(t, { adminId, sessionToken });

    expect(
      await t.mutation(resolveRegistrationForCheckInRef, {
        sessionToken,
        registrationQrCodeToken: TOKEN,
      }),
    ).toEqual({ status: "media_disclosure_required" });
    expect(
      await t.mutation(checkInWithBadgeRef, {
        sessionToken,
        registrationQrCodeToken: TOKEN,
        badgeQrCodeToken: BADGE,
      }),
    ).toEqual({ status: "media_disclosure_required" });
  });
});

describe("Apple Wallet media disclosure gate", () => {
  beforeEach(() => {
    const creds = getRuntimeTestAppleWalletCredentials();
    vi.stubEnv("APPLE_PASS_TYPE_IDENTIFIER", creds.passTypeIdentifier);
    vi.stubEnv("APPLE_TEAM_IDENTIFIER", creds.teamIdentifier);
    vi.stubEnv("APPLE_PASS_SIGNER_CERT_PEM", creds.signerCertPem);
    vi.stubEnv("APPLE_PASS_SIGNER_KEY_PEM", creds.signerKeyPem);
    vi.stubEnv("APPLE_WWDR_CERT_PEM", creds.wwdrCertPem);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps a missing disclosure row like not_eligible and never includes the token", async () => {
    const t = createConvexTest();
    const { asParticipant } = await seedAcceptedParticipant(t, "wallet@example.com");

    const result = await asParticipant.action(generateMyAppleWalletPassRef, {});
    expect(result).toEqual({
      ok: false,
      code: "not_eligible",
      message: "Your check-in pass is not available for Apple Wallet.",
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
