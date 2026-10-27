import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { getMyParticipantDashboardRef } from "../../src/convex/api";
import { createConvexTest, type ConvexTestInstance } from "../helpers/convexTestContext";
import { seedApplicant, seedStaff } from "../helpers/reviewTestKit";
import { insertStaffSession } from "../helpers/staffTestFixtures";

/** The same mutation and args a volunteer's phone sends after scanning registration and badge QRs. */
const checkInWithBadgeRef = makeFunctionReference<
  "mutation",
  { sessionToken: string; registrationQrCodeToken: string; badgeQrCodeToken: string },
  { status: string; checkedInAt?: number }
>("admin/badgeCheckIn:checkInWithBadge");

async function seedAcceptedParticipant(t: ConvexTestInstance, email: string, qrCodeToken: string) {
  const applicant = await seedApplicant(t, { email, submitted: true });
  const staff = await seedStaff(t);
  await t.run(async (ctx) => {
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
    await ctx.db.insert("participants", {
      applicationId: applicant.applicationId,
      authUserId: applicant.userId,
      acceptedAt: 1,
      acceptedBy: staff.adminId,
      qrCodeToken,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  return t.withIdentity({ subject: applicant.userId, email });
}

async function seedVolunteerSession(
  t: ConvexTestInstance,
  sessionToken: string,
  canCheckIn: boolean,
) {
  const adminId = await t.run((ctx) =>
    ctx.db.insert("admins", {
      email: `volunteer-${sessionToken.slice(0, 4)}@hackuta.org`,
      name: "Door Volunteer",
      role: "volunteer",
      active: true,
      canCheckIn,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  await insertStaffSession(t, { adminId, sessionToken });
  return sessionToken;
}

const TOKEN_A = "a1".repeat(32);
const TOKEN_B = "b2".repeat(32);
const BADGE_A = "HACKUTA-BADGE-0001";

function checkIn(sessionToken: string, registrationQrCodeToken: string, badgeQrCodeToken: string) {
  return { sessionToken, registrationQrCodeToken, badgeQrCodeToken };
}

describe("participant dashboard after volunteer check-in", () => {
  it("returns the registration QR token before check-in", async () => {
    const t = createConvexTest();
    const asParticipant = await seedAcceptedParticipant(t, "before@example.com", TOKEN_A);

    const dashboard = await asParticipant.query(getMyParticipantDashboardRef, {});
    expect(dashboard?.participant).toEqual({
      status: "awaiting_check_in",
      acceptedAt: 1,
      qrCodeToken: TOKEN_A,
    });
  });

  it("omits every QR token once a volunteer scans the registration QR", async () => {
    const t = createConvexTest();
    const asParticipant = await seedAcceptedParticipant(t, "scanned@example.com", TOKEN_A);
    const sessionToken = await seedVolunteerSession(t, "f".repeat(64), true);

    const result = await t.mutation(checkInWithBadgeRef, checkIn(sessionToken, TOKEN_A, BADGE_A));
    expect(result.status).toBe("success");

    const dashboard = await asParticipant.query(getMyParticipantDashboardRef, {});
    expect(dashboard?.participant).toEqual({
      status: "checked_in",
      acceptedAt: 1,
      checkedInAt: result.checkedInAt,
    });
    expect(dashboard?.participant && "qrCodeToken" in dashboard.participant).toBe(false);
    expect(JSON.stringify(dashboard)).not.toMatch(new RegExp(`${TOKEN_A}|${BADGE_A}`));
  });

  it("stays checked in after a repeat scan", async () => {
    const t = createConvexTest();
    const asParticipant = await seedAcceptedParticipant(t, "repeat@example.com", TOKEN_A);
    const sessionToken = await seedVolunteerSession(t, "f".repeat(64), true);

    const first = await t.mutation(checkInWithBadgeRef, checkIn(sessionToken, TOKEN_A, BADGE_A));
    const repeat = await t.mutation(checkInWithBadgeRef, checkIn(sessionToken, TOKEN_A, BADGE_A));
    expect(first.status).toBe("success");
    expect(repeat.status).toBe("already_checked_in");
    expect(repeat.checkedInAt ?? first.checkedInAt).toBe(first.checkedInAt);

    const dashboard = await asParticipant.query(getMyParticipantDashboardRef, {});
    expect(dashboard?.participant?.status).toBe("checked_in");
    expect(JSON.stringify(dashboard)).not.toContain(TOKEN_A);
  });

  it("keeps the QR when a volunteer without check-in access scans", async () => {
    const t = createConvexTest();
    const asParticipant = await seedAcceptedParticipant(t, "denied@example.com", TOKEN_A);
    const sessionToken = await seedVolunteerSession(t, "e".repeat(64), false);

    const result = await t.mutation(checkInWithBadgeRef, checkIn(sessionToken, TOKEN_A, BADGE_A));
    expect(result.status).toBe("not_authorized");

    const dashboard = await asParticipant.query(getMyParticipantDashboardRef, {});
    expect(dashboard?.participant).toMatchObject({
      status: "awaiting_check_in",
      qrCodeToken: TOKEN_A,
    });
  });

  it("checking in one participant never exposes or hides another participant's QR", async () => {
    const t = createConvexTest();
    const asScanned = await seedAcceptedParticipant(t, "one@example.com", TOKEN_A);
    const asWaiting = await seedAcceptedParticipant(t, "two@example.com", TOKEN_B);
    const sessionToken = await seedVolunteerSession(t, "f".repeat(64), true);

    await t.mutation(checkInWithBadgeRef, checkIn(sessionToken, TOKEN_A, BADGE_A));

    const scanned = await asScanned.query(getMyParticipantDashboardRef, {});
    expect(scanned?.participant?.status).toBe("checked_in");
    expect(JSON.stringify(scanned)).not.toContain(TOKEN_B);

    const waiting = await asWaiting.query(getMyParticipantDashboardRef, {});
    expect(waiting?.participant).toMatchObject({
      status: "awaiting_check_in",
      qrCodeToken: TOKEN_B,
    });
    expect(JSON.stringify(waiting)).not.toContain(TOKEN_A);
  });
});
