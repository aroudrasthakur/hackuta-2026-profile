import { describe, expect, it } from "vitest";
import { pointBalancePatch } from "../../convex/admin/pointsLedger";
import {
  compareRankable,
  isPositivePoints,
  LEADERBOARD_LIMIT,
  pointsReachedAtOf,
  rankOf,
  type RankableParticipant,
} from "../../convex/profile/leaderboardRank";

function row(id: string, points: number, pointsReachedAt: number): RankableParticipant {
  return { id, points, pointsReachedAt };
}

describe("leaderboard ranking", () => {
  it("caps the public board at 10", () => {
    expect(LEADERBOARD_LIMIT).toBe(10);
  });

  it("orders higher points first", () => {
    const ranked = [row("a", 10, 1), row("b", 40, 9), row("c", 25, 2)].sort(compareRankable);
    expect(ranked.map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks point ties by who reached the total earlier", () => {
    const ranked = [row("late", 50, 200), row("early", 50, 100)].sort(compareRankable);
    expect(ranked.map((item) => item.id)).toEqual(["early", "late"]);
  });

  it("uses a stable id when points and timestamps match", () => {
    const ranked = [row("m", 12, 5), row("k", 12, 5)].sort(compareRankable);
    expect(ranked.map((item) => item.id)).toEqual(["k", "m"]);
  });

  it("returns a 1-based rank or null", () => {
    const ranked = [row("a", 3, 1), row("b", 2, 1)];
    expect(rankOf(ranked, "b")).toBe(2);
    expect(rankOf(ranked, "missing")).toBeNull();
  });

  it("excludes zero and missing points from ranking", () => {
    expect(isPositivePoints(0)).toBe(false);
    expect(isPositivePoints(undefined)).toBe(false);
    expect(isPositivePoints(15)).toBe(true);
  });

  it("falls back to updatedAt when pointsReachedAt is missing", () => {
    expect(pointsReachedAtOf({ updatedAt: 9, acceptedAt: 1 })).toBe(9);
    expect(pointsReachedAtOf({ pointsReachedAt: 4, updatedAt: 9, acceptedAt: 1 })).toBe(4);
  });
});

describe("pointBalancePatch", () => {
  it("records when a new positive total is reached", () => {
    expect(pointBalancePatch(0, 25, 1000)).toEqual({
      points: 25,
      updatedAt: 1000,
      pointsReachedAt: 1000,
    });
  });

  it("leaves ranking metadata alone when the total does not change", () => {
    expect(pointBalancePatch(40, 40, 1000)).toEqual({ points: 40, updatedAt: 1000 });
  });

  it("clears the ranking timestamp when the balance returns to zero", () => {
    expect(pointBalancePatch(10, 0, 1000)).toEqual({
      points: 0,
      updatedAt: 1000,
      pointsReachedAt: undefined,
    });
  });
});
