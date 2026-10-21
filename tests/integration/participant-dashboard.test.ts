import { describe, expect, it } from "vitest";
import { getMyParticipantDashboardRef } from "../../src/convex/api";
import { createConvexTest } from "../helpers/convexTestContext";
import { seedApplicant, seedStaff } from "../helpers/reviewTestKit";

describe("participant dashboard query", () => {
  it("returns null for signed-out callers", async () => {
    const t = createConvexTest();
    const { applicationId, userId } = await seedApplicant(t, { email: "taylor@example.com", submitted: true });
    const staff = await seedStaff(t);
    await t.run(async (ctx) => {
      const review = await ctx.db
        .query("applicationReviews")
        .withIndex("by_application", (q) => q.eq("applicationId", applicationId))
        .unique();
      if (!review) throw new Error("Expected review row from seedApplicant");
      await ctx.db.patch(review._id, {
        status: "accepted",
        reviewedBy: staff.adminId,
        completedAt: Date.now(),
      });
      await ctx.db.insert("participants", {
        applicationId,
        authUserId: userId,
        acceptedAt: 1,
        acceptedBy: staff.adminId,
        qrCodeToken: "a".repeat(64),
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const anonymous = await t.query(getMyParticipantDashboardRef, {});
    expect(anonymous).toBeNull();
  });

  it("returns only the signed-in participant QR token", async () => {
    const t = createConvexTest();
    const accepted = await seedApplicant(t, {
      email: "accepted@example.com",
      submitted: true,
      fields: { firstName: "Taylor", lastName: "Student" },
    });
    const other = await seedApplicant(t, { email: "other@example.com", submitted: true });
    const staff = await seedStaff(t);

    await t.run(async (ctx) => {
      for (const { applicationId } of [accepted, other]) {
        const review = await ctx.db
          .query("applicationReviews")
          .withIndex("by_application", (q) => q.eq("applicationId", applicationId))
          .unique();
        if (!review) throw new Error("Expected review row from seedApplicant");
        await ctx.db.patch(review._id, {
          status: "accepted",
          reviewedBy: staff.adminId,
          completedAt: Date.now(),
        });
      }
      await ctx.db.insert("participants", {
        applicationId: accepted.applicationId,
        authUserId: accepted.userId,
        acceptedAt: 1,
        acceptedBy: staff.adminId,
        qrCodeToken: "b".repeat(64),
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("participants", {
        applicationId: other.applicationId,
        authUserId: other.userId,
        acceptedAt: 1,
        acceptedBy: staff.adminId,
        qrCodeToken: "c".repeat(64),
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const asAccepted = t.withIdentity({
      subject: accepted.userId,
      email: "accepted@example.com",
    });
    const dashboard = await asAccepted.query(getMyParticipantDashboardRef, {});
    expect(dashboard?.participant?.qrCodeToken).toBe("b".repeat(64));
    expect(dashboard?.profile.displayName).toBe("Taylor Student");

    const asOther = t.withIdentity({
      subject: other.userId,
      email: "other@example.com",
    });
    const otherDashboard = await asOther.query(getMyParticipantDashboardRef, {});
    expect(otherDashboard?.participant?.qrCodeToken).toBe("c".repeat(64));
    expect(otherDashboard?.participant?.qrCodeToken).not.toBe(dashboard?.participant?.qrCodeToken);
  });

  it("masks queued decisions until the decision email is released", async () => {
    const t = createConvexTest();
    const applicant = await seedApplicant(t, {
      email: "queued@example.com",
      submitted: true,
      fields: { firstName: "Quinn", lastName: "Applicant" },
    });
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
        qrCodeToken: "d".repeat(64),
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("decisionEmailQueue", {
        applicationId: applicant.applicationId,
        decision: "accepted",
        recipientEmail: "queued@example.com",
        applicantName: "Quinn Applicant",
        status: "queued",
        queuedBy: staff.adminId,
        queuedAt: 1,
        updatedAt: 1,
      });
    });

    const asApplicant = t.withIdentity({
      subject: applicant.userId,
      email: "queued@example.com",
    });
    const dashboard = await asApplicant.query(getMyParticipantDashboardRef, {});
    expect(dashboard?.reviewStatus).not.toBe("accepted");
    expect(dashboard?.reviewStatus).toBe("under_review");
    expect(dashboard?.participant).toBeNull();
  });
});
