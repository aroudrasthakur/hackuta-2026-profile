import { describe, expect, it } from "vitest";
import { getMyParticipantDashboardRef, getMySubmittedApplicationRef } from "../../src/convex/api";
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
    expect(dashboard?.participant).toEqual({
      status: "awaiting_check_in",
      acceptedAt: 1,
      qrCodeToken: "b".repeat(64),
    });
    expect(dashboard?.profile.displayName).toBe("Taylor Student");
    expect(dashboard?.submittedApplication?.sections.length).toBeGreaterThan(0);
    expect(dashboard?.submittedApplication?.sections[0]?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "First name", value: "Taylor" }),
        expect.objectContaining({ label: "Last name", value: "Student" }),
      ]),
    );

    const asOther = t.withIdentity({
      subject: other.userId,
      email: "other@example.com",
    });
    const otherDashboard = await asOther.query(getMyParticipantDashboardRef, {});
    expect(otherDashboard?.participant).toMatchObject({ qrCodeToken: "c".repeat(64) });
    expect(JSON.stringify(otherDashboard)).not.toContain("b".repeat(64));
  });

  it("returns submitted application sections from the dedicated submission query", async () => {
    const t = createConvexTest();
    const applicant = await seedApplicant(t, {
      email: "submission-query@example.com",
      submitted: true,
      fields: { firstName: "Sub", lastName: "Query" },
    });
    const asUser = t.withIdentity({
      subject: applicant.userId,
      email: "submission-query@example.com",
    });

    const payload = await asUser.query(getMySubmittedApplicationRef, {});
    expect(payload?.sections[0]?.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "First name", value: "Sub" })]),
    );
  });

  it("prefers the newest submitted application when multiple rows share an email", async () => {
    const t = createConvexTest();
    const email = "duplicate-email@example.com";

    const { currentUserId } = await t.run(async (ctx) => {
      const legacyUserId = await ctx.db.insert("users", { email, name: "Legacy" });
      await ctx.db.insert("applications", {
        authUserId: legacyUserId,
        email,
        firstName: "Older",
        lastName: "Draft",
        createdAt: 1,
        applicantUpdatedAt: 1,
        formSubmitted: true,
        submittedAt: 2,
      });
      await ctx.db.insert("applications", {
        authUserId: legacyUserId,
        email,
        firstName: "Older",
        lastName: "Submitted",
        createdAt: 1,
        applicantUpdatedAt: 5,
        formSubmitted: true,
        submittedAt: 6,
      });
      const currentUserId = await ctx.db.insert("users", { email, name: "Current" });
      return { currentUserId };
    });

    const asCurrentUser = t.withIdentity({ subject: currentUserId, email });
    const dashboard = await asCurrentUser.query(getMyParticipantDashboardRef, {});

    expect(dashboard?.submittedApplication?.sections[0]?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Last name", value: "Submitted" }),
      ]),
    );
  });

  it("resolves submitted applications by verified email when auth user id differs", async () => {
    const t = createConvexTest();
    const email = "linked@example.com";

    const { applicationId, legacyUserId } = await t.run(async (ctx) => {
      const legacyUserId = await ctx.db.insert("users", { email, name: "Legacy User" });
      const applicationId = await ctx.db.insert("applications", {
        authUserId: legacyUserId,
        email,
        firstName: "Jordan",
        lastName: "Applicant",
        createdAt: 1,
        formSubmitted: true,
        submittedAt: 2,
      });
      return { applicationId, legacyUserId };
    });

    const { currentUserId } = await t.run(async (ctx) => {
      const currentUserId = await ctx.db.insert("users", { email, name: "Current Session" });
      return { currentUserId };
    });

    expect(currentUserId).not.toBe(legacyUserId);

    const asCurrentUser = t.withIdentity({ subject: currentUserId, email });
    const dashboard = await asCurrentUser.query(getMyParticipantDashboardRef, {});

    expect(dashboard?.application?.submitted).toBe(true);
    expect(dashboard?.submittedApplication?.sections[0]?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "First name", value: "Jordan" }),
      ]),
    );

    const unrelated = await t.run(async (ctx) => {
      const otherUserId = await ctx.db.insert("users", { email: "other@example.com" });
      return otherUserId;
    });
    const asOther = t.withIdentity({ subject: unrelated, email: "other@example.com" });
    const otherDashboard = await asOther.query(getMyParticipantDashboardRef, {});
    expect(otherDashboard?.submittedApplication).toBeNull();
    void applicationId;
  });

  it("loads submission via participants.applicationId when auth user lookup misses", async () => {
    const t = createConvexTest();
    const email = "participant-link@example.com";

    const { applicationId, sessionUserId } = await t.run(async (ctx) => {
      const legacyUserId = await ctx.db.insert("users", { email, name: "Legacy Auth" });
      const applicationId = await ctx.db.insert("applications", {
        authUserId: legacyUserId,
        email,
        firstName: "Pat",
        lastName: "Linked",
        createdAt: 1,
        formSubmitted: true,
        submittedAt: 2,
      });
      const sessionUserId = await ctx.db.insert("users", { email, name: "Session User" });
      const staff = await ctx.db.insert("admins", {
        email: "staff@example.com",
        name: "Staff",
        role: "admin",
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("participants", {
        applicationId,
        authUserId: sessionUserId,
        acceptedAt: 1,
        acceptedBy: staff,
        qrCodeToken: "e".repeat(64),
        createdAt: 1,
        updatedAt: 1,
      });
      return { applicationId, sessionUserId };
    });

    const asSessionUser = t.withIdentity({ subject: sessionUserId, email });
    const dashboard = await asSessionUser.query(getMyParticipantDashboardRef, {});

    expect(dashboard?.application?.submitted).toBe(true);
    expect(dashboard?.submittedApplication?.sections[0]?.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "First name", value: "Pat" })]),
    );
    void applicationId;
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
