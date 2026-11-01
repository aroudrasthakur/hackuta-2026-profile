import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateMyAppleWalletPassRef,
  getMyParticipantDashboardRef,
} from "../../src/convex/api";
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
const WALLET_SERVICE_URL = "https://wallet.test.hackuta.local";
const WALLET_SERVICE_API_KEY = "wallet-service-api-key-32-chars-min";
const MOCK_PKPASS_BYTES = Buffer.from("PKPASS-MOCK-BYTES");

function stubWalletServiceEnv() {
  vi.stubEnv("WALLET_SERVICE_URL", WALLET_SERVICE_URL);
  vi.stubEnv("WALLET_SERVICE_API_KEY", WALLET_SERVICE_API_KEY);
}

function mockWalletServiceFetch(
  handler?: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (handler) {
      return handler(url, init);
    }
    return new Response(MOCK_PKPASS_BYTES, {
      status: 200,
      headers: { "Content-Type": "application/vnd.apple.pkpass" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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
    stubWalletServiceEnv();
    mockWalletServiceFetch();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    expect(globalThis.fetch).not.toHaveBeenCalled();
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
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns not_configured when the wallet service is not set on the server", async () => {
    vi.unstubAllEnvs();
    const t = createConvexTest();
    const { asParticipant } = await seedAcceptedParticipant(t, "nocreds@example.com", TOKEN_A);

    const result = await asParticipant.action(generateMyAppleWalletPassRef, {});
    expect(result).toEqual({
      ok: false,
      code: "not_configured",
      message: "Apple Wallet passes are not available right now. Please use the QR code above.",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns not_configured when the wallet service reports signing is unavailable", async () => {
    mockWalletServiceFetch(
      () =>
        new Response(JSON.stringify({ error: { code: "signing_unavailable" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const t = createConvexTest();
    const { asParticipant } = await seedAcceptedParticipant(t, "unavail@example.com", TOKEN_A);

    const result = await asParticipant.action(generateMyAppleWalletPassRef, {});
    expect(result).toEqual({
      ok: false,
      code: "not_configured",
      message: "Apple Wallet passes are not available right now. Please use the QR code above.",
    });
  });

  it("returns signing_failed when the wallet service rejects the request", async () => {
    mockWalletServiceFetch(
      () =>
        new Response(JSON.stringify({ error: { code: "internal_error" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const t = createConvexTest();
    const { asParticipant } = await seedAcceptedParticipant(t, "fail@example.com", TOKEN_A);

    const result = await asParticipant.action(generateMyAppleWalletPassRef, {});
    expect(result).toEqual({
      ok: false,
      code: "signing_failed",
      message:
        "We could not generate your Apple Wallet pass. Please try again or use the QR code above.",
    });
  });

  it("asks the wallet service for a .pkpass using the participant's own registration QR token", async () => {
    const fetchMock = mockWalletServiceFetch();
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
    expect(result.pkpassBase64).toBe(MOCK_PKPASS_BYTES.toString("base64"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!;
    expect(String(requestUrl)).toBe(`${WALLET_SERVICE_URL}/passes/generate`);
    expect(requestInit?.method).toBe("POST");
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${WALLET_SERVICE_API_KEY}`);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("application/vnd.apple.pkpass");

    const body = JSON.parse(String(requestInit?.body)) as {
      serialNumber: string;
      attendeeName: string;
      qrToken: string;
    };
    expect(body).toEqual({
      serialNumber: `hackuta-2026-${participantA.participantId}`,
      attendeeName: "Alice Maverick",
      qrToken: TOKEN_A,
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN_B);

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

    const fetchMock = globalThis.fetch as ReturnType<typeof mockWalletServiceFetch>;
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { qrToken: string };
    expect(body.qrToken).toBe(TOKEN_A);

    const preview = await t.mutation(resolveRegistrationForCheckInRef, {
      sessionToken,
      registrationQrCodeToken: TOKEN_A,
    });
    expect(preview).toEqual({
      status: "ok",
      participant: { name: "Dana Participant" },
    });

    const checkInResult = await t.mutation(checkInWithBadgeRef, {
      sessionToken,
      registrationQrCodeToken: TOKEN_A,
      badgeQrCodeToken: BADGE_A,
    });
    expect(checkInResult.status).toBe("success");

    const afterPass = await asParticipant.action(generateMyAppleWalletPassRef, {});
    expect(afterPass).toEqual({
      ok: false,
      code: "already_checked_in",
      message:
        "You have already checked in. Your physical HackUTA badge is now your event pass.",
    });
    expect(JSON.stringify(afterPass)).not.toContain(BADGE_A);
    expect(JSON.stringify(afterPass)).not.toContain(TOKEN_A);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const dashboard = await asParticipant.query(getMyParticipantDashboardRef, {});
    expect(dashboard?.participant?.status).toBe("checked_in");
    expect(JSON.stringify(dashboard)).not.toContain(BADGE_A);
    expect(JSON.stringify(dashboard)).not.toContain(TOKEN_A);

    const rescanWalletQr = await t.mutation(resolveRegistrationForCheckInRef, {
      sessionToken,
      registrationQrCodeToken: TOKEN_A,
    });
    expect(rescanWalletQr.status).toBe("registration_qr_used");
  });
});
