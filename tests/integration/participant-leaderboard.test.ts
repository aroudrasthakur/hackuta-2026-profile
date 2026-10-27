import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { getMyPointsLeaderboardRef } from "../../src/convex/api";
import { applyEventAward } from "../../convex/admin/pointsLedger";
import { createConvexTest } from "../helpers/convexTestContext";
import { seedApplicant, seedStaff } from "../helpers/reviewTestKit";

const setParticipantPointsRef = makeFunctionReference<
  "mutation",
  { sessionToken: string; participantId: string; points: number; reason: string },
  { ok: true; changed: boolean; previousPoints: number; newPoints: number; pointsDelta: number }
>("admin/participantsAdmin:setParticipantPoints");

let qrSerial = 0;
const nextQrToken = () => {
  qrSerial += 1;
  return `c${qrSerial.toString(16).padStart(63, "0")}`;
};

async function seedScoredParticipant(
  t: ReturnType<typeof createConvexTest>,
  options: {
    email: string;
    firstName: string;
    lastName: string;
    points: number;
    pointsReachedAt?: number;
    reviewStatus?: "accepted" | "rejected" | "waitlisted" | "under_review";
    dietary?: string;
  },
) {
  const applicant = await seedApplicant(t, {
    email: options.email,
    submitted: true,
    fields: { firstName: options.firstName, lastName: options.lastName },
  });
  const staff = await seedStaff(t, { role: "admin" });
  const participantId = await t.run(async (ctx) => {
    const review = await ctx.db
      .query("applicationReviews")
      .withIndex("by_application", (q) => q.eq("applicationId", applicant.applicationId))
      .unique();
    if (!review) throw new Error("Expected review");
    await ctx.db.patch(review._id, {
      status: options.reviewStatus ?? "accepted",
      reviewedBy: staff.adminId,
      completedAt: Date.now(),
    });
    return ctx.db.insert("participants", {
      applicationId: applicant.applicationId,
      authUserId: applicant.userId,
      acceptedAt: 1,
      acceptedBy: staff.adminId,
      qrCodeToken: nextQrToken(),
      foodRestriction: options.dietary,
      points: options.points,
      ...(options.pointsReachedAt !== undefined ? { pointsReachedAt: options.pointsReachedAt } : {}),
      createdAt: 1,
      updatedAt: options.pointsReachedAt ?? 1,
    });
  });
  return { ...applicant, participantId, adminId: staff.adminId, sessionToken: staff.sessionToken };
}

describe("points leaderboard query", () => {
  it("returns null for signed-out callers", async () => {
    const t = createConvexTest();
    await seedScoredParticipant(t, {
      email: "hidden@example.com",
      firstName: "Hidden",
      lastName: "Row",
      points: 40,
    });
    expect(await t.query(getMyPointsLeaderboardRef, {})).toBeNull();
  });

  it("ranks accepted participants by points and earlier totals, excluding zeros and ineligible rows", async () => {
    const t = createConvexTest();
    const viewer = await seedScoredParticipant(t, {
      email: "viewer@example.com",
      firstName: "Sam",
      lastName: "Test",
      points: 30,
      pointsReachedAt: 50,
    });
    await seedScoredParticipant(t, {
      email: "gold@example.com",
      firstName: "Avery",
      lastName: "Chen",
      points: 80,
      pointsReachedAt: 10,
      dietary: "vegan, peanuts",
    });
    await seedScoredParticipant(t, {
      email: "early-silver@example.com",
      firstName: "Early",
      lastName: "Silver",
      points: 50,
      pointsReachedAt: 20,
    });
    await seedScoredParticipant(t, {
      email: "late-silver@example.com",
      firstName: "Late",
      lastName: "Silver",
      points: 50,
      pointsReachedAt: 40,
    });
    await seedScoredParticipant(t, {
      email: "zero@example.com",
      firstName: "Zero",
      lastName: "Points",
      points: 0,
    });
    await seedScoredParticipant(t, {
      email: "wait@example.com",
      firstName: "Wait",
      lastName: "Listed",
      points: 90,
      pointsReachedAt: 5,
      reviewStatus: "waitlisted",
    });

    const board = await t
      .withIdentity({ subject: viewer.userId, email: "viewer@example.com" })
      .query(getMyPointsLeaderboardRef, {});

    expect(board?.entries.map((entry) => entry.name)).toEqual([
      "Avery Chen",
      "Early Silver",
      "Late Silver",
      "Sam Test",
    ]);
    expect(board?.entries.map((entry) => entry.rank)).toEqual([1, 2, 3, 4]);
    expect(board?.entries.find((entry) => entry.name === "Sam Test")?.isYou).toBe(true);
    expect(board?.you).toEqual({ rank: 4, points: 30 });
    expect(JSON.stringify(board)).not.toMatch(
      /@example\.com|pointsReachedAt|foodRestriction|qrCodeToken|vegan|peanuts|Wait Listed|Zero Points/,
    );
  });

  it("keeps the public list at 10 and still reports a rank outside it", async () => {
    const t = createConvexTest();
    const viewer = await seedScoredParticipant(t, {
      email: "eleventh@example.com",
      firstName: "Nova",
      lastName: "Eleven",
      points: 1,
      pointsReachedAt: 100,
    });
    for (let i = 0; i < 10; i += 1) {
      await seedScoredParticipant(t, {
        email: `top-${i}@example.com`,
        firstName: `Top`,
        lastName: `${i}`,
        points: 20 + i,
        pointsReachedAt: i + 1,
      });
    }

    const board = await t
      .withIdentity({ subject: viewer.userId, email: "eleventh@example.com" })
      .query(getMyPointsLeaderboardRef, {});

    expect(board?.entries).toHaveLength(10);
    expect(board?.entries.some((entry) => entry.isYou)).toBe(false);
    expect(board?.you).toEqual({ rank: 11, points: 1 });
  });

  it("shows a zero-point viewer their balance without a rank", async () => {
    const t = createConvexTest();
    const viewer = await seedScoredParticipant(t, {
      email: "zero-viewer@example.com",
      firstName: "Zero",
      lastName: "Viewer",
      points: 0,
    });
    await seedScoredParticipant(t, {
      email: "scored@example.com",
      firstName: "Has",
      lastName: "Points",
      points: 12,
      pointsReachedAt: 3,
    });

    const board = await t
      .withIdentity({ subject: viewer.userId, email: "zero-viewer@example.com" })
      .query(getMyPointsLeaderboardRef, {});

    expect(board?.entries).toEqual([
      { rank: 1, name: "Has Points", points: 12, isYou: false },
    ]);
    expect(board?.you).toEqual({ rank: null, points: 0 });
  });

  it("updates ranking metadata on a real award and leaves it alone on a duplicate scan", async () => {
    const t = createConvexTest();
    const viewer = await seedScoredParticipant(t, {
      email: "award@example.com",
      firstName: "Award",
      lastName: "Me",
      points: 0,
    });
    const setup = await t.run(async (ctx) => {
      const eventId = await ctx.db.insert("events", {
        name: "Workshop",
        pointsAwarded: 15,
        active: true,
        startsAt: 1,
        endsAt: 2,
        createdAt: 1,
        updatedAt: 1,
      });
      return { eventId };
    });

    await t.run(async (ctx) => {
      const participant = await ctx.db.get(viewer.participantId);
      const event = await ctx.db.get(setup.eventId);
      if (!participant || !event) throw new Error("missing rows");
      const first = await applyEventAward(ctx, {
        actorAdminId: viewer.adminId,
        participant,
        event,
        now: 500,
      });
      expect(first.status).toBe("success");
      const after = await ctx.db.get(viewer.participantId);
      expect(after?.points).toBe(15);
      expect(after?.pointsReachedAt).toBe(500);

      const repeat = await applyEventAward(ctx, {
        actorAdminId: viewer.adminId,
        participant: after!,
        event,
        now: 900,
      });
      expect(repeat.status).toBe("already_awarded");
      const unchanged = await ctx.db.get(viewer.participantId);
      expect(unchanged?.pointsReachedAt).toBe(500);
    });
  });

  it("does not change pointsReachedAt when an admin sets the same balance", async () => {
    const t = createConvexTest();
    const viewer = await seedScoredParticipant(t, {
      email: "adjust@example.com",
      firstName: "Adjust",
      lastName: "Me",
      points: 22,
      pointsReachedAt: 70,
    });

    const result = await t.mutation(setParticipantPointsRef, {
      sessionToken: viewer.sessionToken,
      participantId: viewer.participantId,
      points: 22,
      reason: "already correct",
    });
    expect(result).toMatchObject({ changed: false, pointsDelta: 0, newPoints: 22 });

    const after = await t.run((ctx) => ctx.db.get(viewer.participantId));
    expect(after?.pointsReachedAt).toBe(70);
  });
});
