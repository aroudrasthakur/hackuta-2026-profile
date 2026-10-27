import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPkpassZipArchive } from "../../convex/profile/appleWalletPass";
import {
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
  { status: string; participant?: { name: string } }
>("admin/badgeCheckIn:resolveRegistrationForCheckIn");

const checkInWithBadgeRef = makeFunctionReference<
  "mutation",
  { sessionToken: string; registrationQrCodeToken: string; badgeQrCodeToken: string },
  { status: string; checkedInAt?: number }
>("admin/badgeCheckIn:checkInWithBadge");

const TOKEN_A = "a1".repeat(32);
const TOKEN_B = "b2".repeat(32);
const BADGE_A = "HACKUTA-BADGE-0001";

function stubAppleWalletEnv() {
  const creds = getRuntimeTestAppleWalletCredentials();
  vi.stubEnv("APPLE_PASS_TYPE_IDENTIFIER", creds.passTypeIdentifier);
  vi.stubEnv("APPLE_TEAM_IDENTIFIER", creds.teamIdentifier);
  vi.stubEnv("APPLE_PASS_SIGNER_CERT_PEM", creds.signerCertPem);
  vi.stubEnv("APPLE_PASS_SIGNER_KEY_PEM", creds.signerKeyPem);
  vi.stubEnv("APPLE_WWDR_CERT_PEM", creds.wwdrCertPem);
}

async function seedAcceptedParticipant(
  t: ConvexTestInstance,
  email: string,
  qrCodeToken: string,
  fields: { firstName?: string; lastName?: string } = { firstName: "Sam", lastName: "Hacker" },
) {
  const applicant = await seedApplicant(t, { email, submitted: true, fields });
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
    return ctx.db.insert("participants", {
      applicationId: applicant.applicationId,
      authUserId: applicant.userId,
      acceptedAt: 1,
      acceptedBy: staff.adminId,
      qrCodeToken,
      createdAt: 1,
      updatedAt: 1,
    });
  });

  return {
    applicant,
    staff,
    participantId,
    asParticipant: t.withIdentity({ subject: applicant.userId, email }),
  };
}

async function seedVolunteerSession(t: ConvexTestInstance, sessionToken: string) {
  const adminId = await t.run((ctx) =>
    ctx.db.insert("admins", {
      email: `volunteer-${sessionToken.slice(0, 4)}@hackuta.org`,
      name: "Door Volunteer",
      role: "volunteer",
      active: true,
      canCheckIn: true,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  await insertStaffSession(t, { adminId, sessionToken });
  return sessionToken;
}

describe("Apple Wallet pass generation and check-in integration", () => {
  beforeEach(() => {
    stubAppleWalletEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects signed-out callers", async () => {
    const t = createConvexTest();
    await seedAcceptedParticipant(t, "anon@example.com", TOKEN_A);

    const result = await t.action(generateMyAppleWalletPassRef, {});
    expect(result).toEqual({
      ok: false,
      code: "unauthenticated",
      message: "Sign in to add your check-in pass to Apple Wallet.",
    });
  });

  it("rejects applicants who are not accepted or whose acceptance email is still queued", async () => {
    const t = createConvexTest();
    const unaccepted = await seedApplicant(t, { email: "pending@example.com", submitted: true });
    const asPending = t.withIdentity({
      subject: unaccepted.userId,
      email: "pending@example.com",
    });

    const pendingResult = await asPending.action(generateMyAppleWalletPassRef, {});
    expect(pendingResult).toEqual({
      ok: false,
      code: "not_eligible",
      message: "Your check-in pass is not available for Apple Wallet.",
    });

    const queued = await seedAcceptedParticipant(t, "queued@example.com", TOKEN_A);
    await t.run(async (ctx) => {
      await ctx.db.insert("decisionEmailQueue", {
        applicationId: queued.applicant.applicationId,
        decision: "accepted",
        recipientEmail: "queued@example.com",
        applicantName: "Sam Hacker",
        status: "queued",
        queuedBy: queued.staff.adminId,
        queuedAt: 1,
        updatedAt: 1,
      });
    });

    const queuedResult = await queued.asParticipant.action(generateMyAppleWalletPassRef, {});
    expect(queuedResult).toEqual({
      ok: false,
      code: "not_eligible",
      message: "Your check-in pass is not available for Apple Wallet.",
    });
  });

  it("returns not_configured when Apple Wallet credentials are missing on the server", async () => {
    vi.unstubAllEnvs();
    const t = createConvexTest();
    const { asParticipant } = await seedAcceptedParticipant(t, "nocreds@example.com", TOKEN_A);

    const result = await asParticipant.action(generateMyAppleWalletPassRef, {});
    expect(result).toEqual({
      ok: false,
      code: "not_configured",
      message: "Apple Wallet passes are not available right now. Please use the QR code above.",
    });
  });

  it("generates a signed .pkpass for an accepted pre-check-in participant with their own QR token", async () => {
    const t = createConvexTest();
    const participantA = await seedAcceptedParticipant(t, "alice@example.com", TOKEN_A, {
      firstName: "Alice",
      lastName: "Maverick",
    });
    await seedAcceptedParticipant(t, "bob@example.com", TOKEN_B, {
      firstName: "Bob",
      lastName: "Other",
    });

    const result = await participantA.asParticipant.action(generateMyAppleWalletPassRef, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected pass generation to succeed");

    expect(result.filename).toBe("hackuta-2026-checkin.pkpass");
    expect(result.serialNumber).toBe(`hackuta-2026-${participantA.participantId}`);
    expect(result.passUrl).toBeTruthy();

    const entries = readPkpassZipArchive(Buffer.from(result.pkpassBase64, "base64"));
    const passJsonText = entries["pass.json"]!.toString("utf8");
    const passJson = JSON.parse(passJsonText) as {
      serialNumber: string;
      barcodes: Array<{ format: string; message: string }>;
      eventTicket: { secondaryFields: Array<{ key: string; value: string }> };
    };

    expect(passJson.serialNumber).toBe(`hackuta-2026-${participantA.participantId}`);
    expect(passJson.barcodes[0]).toMatchObject({
      format: "PKBarcodeFormatQR",
      message: TOKEN_A,
    });
    expect(passJson.eventTicket.secondaryFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "participant_name", value: "Alice Maverick" }),
      ]),
    );
    expect(passJsonText).not.toContain(TOKEN_B);

    // Verify scheduled cleanup removes temporary storage file
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(65_000);
      await t.finishInProgressScheduledFunctions();
    } finally {
      vi.useRealTimers();
    }
  });

  it("identifies the participant during initial check-in, then blocks new passes and invalidates the saved Wallet QR after badge assignment", async () => {
    const t = createConvexTest();
    const { asParticipant } = await seedAcceptedParticipant(t, "checkin@example.com", TOKEN_A, {
      firstName: "Dana",
      lastName: "Participant",
    });
    const sessionToken = await seedVolunteerSession(t, "f".repeat(64));

    const beforePass = await asParticipant.action(generateMyAppleWalletPassRef, {});
    expect(beforePass.ok).toBe(true);
    if (!beforePass.ok) throw new Error("Expected pre-check-in pass");

    const entries = readPkpassZipArchive(Buffer.from(beforePass.pkpassBase64, "base64"));
    const walletQrToken = (
      JSON.parse(entries["pass.json"]!.toString("utf8")) as {
        barcodes: Array<{ message: string }>;
      }
    ).barcodes[0]!.message;
    expect(walletQrToken).toBe(TOKEN_A);

    // Step 1: Volunteer scans the Apple Wallet QR code at check-in desk
    const preview = await t.mutation(resolveRegistrationForCheckInRef, {
      sessionToken,
      registrationQrCodeToken: walletQrToken,
    });
    expect(preview).toEqual({
      status: "ok",
      participant: { name: "Dana Participant" },
    });

    // Step 2: Volunteer assigns physical badge BADGE_A
    const checkInResult = await t.mutation(checkInWithBadgeRef, {
      sessionToken,
      registrationQrCodeToken: walletQrToken,
      badgeQrCodeToken: BADGE_A,
    });
    expect(checkInResult.status).toBe("success");

    // Step 3: New Apple Wallet pass generation is blocked and never exposes BADGE_A
    const afterPass = await asParticipant.action(generateMyAppleWalletPassRef, {});
    expect(afterPass).toEqual({
      ok: false,
      code: "already_checked_in",
      message:
        "You have already checked in. Your physical HackUTA badge is now your event pass.",
    });
    expect(JSON.stringify(afterPass)).not.toContain(BADGE_A);
    expect(JSON.stringify(afterPass)).not.toContain(TOKEN_A);

    // Step 4: Dashboard hides the registration QR and badge QR
    const dashboard = await asParticipant.query(getMyParticipantDashboardRef, {});
    expect(dashboard?.participant?.status).toBe("checked_in");
    expect(JSON.stringify(dashboard)).not.toContain(BADGE_A);
    expect(JSON.stringify(dashboard)).not.toContain(TOKEN_A);

    // Step 5: Previously saved Apple Wallet QR is rejected if scanned again
    const rescanWalletQr = await t.mutation(resolveRegistrationForCheckInRef, {
      sessionToken,
      registrationQrCodeToken: walletQrToken,
    });
    expect(rescanWalletQr.status).toBe("registration_qr_used");
  });
});
