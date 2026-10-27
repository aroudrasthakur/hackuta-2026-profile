/**
 * Authenticated live top-10 points leaderboard. Ranks on the server; the
 * payload is only rank, display name, points, and whether a row is the caller.
 */
import { v } from "convex/values";
import type { GenericId } from "convex/values";
import { query } from "../_generated/server";
import { formatApplicantFullName, getAuthUser } from "../lib/applications";
import { isParticipantEligible } from "../admin/pointsLedger";
import {
  compareRankable,
  isPositivePoints,
  LEADERBOARD_LIMIT,
  pointsReachedAtOf,
  rankOf,
  type RankableParticipant,
} from "./leaderboardRank";

const FALLBACK_NAME = "Participant";

const leaderboardEntry = v.object({
  rank: v.number(),
  name: v.string(),
  points: v.number(),
  isYou: v.boolean(),
});

type RankedRow = RankableParticipant & {
  authUserId: GenericId<"users">;
  applicationId: GenericId<"applications">;
};

export const getMyPointsLeaderboard = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      entries: v.array(leaderboardEntry),
      you: v.object({
        rank: v.union(v.number(), v.null()),
        points: v.number(),
      }),
    }),
  ),
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;

    const withPoints = await ctx.db
      .query("participants")
      .withIndex("by_points", (q) => q.gt("points", 0))
      .order("desc")
      .collect();

    const ranked: RankedRow[] = [];
    for (const participant of withPoints) {
      const points = participant.points;
      if (!isPositivePoints(points)) continue;
      if (!await isParticipantEligible(ctx, participant)) continue;
      ranked.push({
        id: participant._id,
        authUserId: participant.authUserId,
        applicationId: participant.applicationId,
        points,
        pointsReachedAt: pointsReachedAtOf(participant),
      });
    }
    ranked.sort(compareRankable);

    const top = ranked.slice(0, LEADERBOARD_LIMIT);
    const names = new Map<string, string>();
    for (const row of top) {
      const application = await ctx.db.get(row.applicationId);
      names.set(row.id, (application && formatApplicantFullName(application)) || FALLBACK_NAME);
    }

    const mine = await ctx.db
      .query("participants")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", user._id))
      .unique();
    const myPoints = mine?.points ?? 0;
    const myRank =
      mine && isPositivePoints(myPoints) && (await isParticipantEligible(ctx, mine))
        ? rankOf(ranked, mine._id)
        : null;

    return {
      entries: top.map((row, index) => ({
        rank: index + 1,
        name: names.get(row.id) ?? FALLBACK_NAME,
        points: row.points,
        isYou: row.authUserId === user._id,
      })),
      you: { rank: myRank, points: myPoints },
    };
  },
});
