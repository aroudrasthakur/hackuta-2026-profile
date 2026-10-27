import { useQuery } from "../../convex/reactBindings";
import {
  getMyPointsLeaderboardRef,
  type LeaderboardEntry,
  type PointsLeaderboard,
} from "../../convex/api";
import { getConvexClient } from "../../convex/client";
import { useMockAuth } from "../../hooks/useMockAuth";

const MOCK_ENTRIES: LeaderboardEntry[] = [
  { rank: 1, name: "Avery Chen", points: 180, isYou: false },
  { rank: 2, name: "Jordan Patel", points: 150, isYou: false },
  { rank: 3, name: "Riley Nguyen", points: 120, isYou: false },
  { rank: 4, name: "Sam Test", points: 90, isYou: true },
  { rank: 5, name: "Casey Brooks", points: 75, isYou: false },
  { rank: 6, name: "Morgan Lee", points: 60, isYou: false },
  { rank: 7, name: "Quinn Park", points: 45, isYou: false },
  { rank: 8, name: "Reese Alvarez", points: 40, isYou: false },
  { rank: 9, name: "Skyler Amin", points: 25, isYou: false },
  { rank: 10, name: "Taylor Brooks", points: 15, isYou: false },
];

const MOCK_LEADERBOARD: PointsLeaderboard = {
  entries: MOCK_ENTRIES,
  you: { rank: 4, points: 90 },
};

export function usePointsLeaderboard(): {
  loading: boolean;
  data: PointsLeaderboard | null;
} {
  const mockAuth = useMockAuth();
  const client = getConvexClient();
  const leaderboard = useQuery(
    getMyPointsLeaderboardRef,
    client && !mockAuth.enabled ? {} : "skip",
  );

  if (mockAuth.enabled) {
    return { loading: false, data: MOCK_LEADERBOARD };
  }

  if (leaderboard === undefined) {
    return { loading: true, data: null };
  }

  return { loading: false, data: leaderboard };
}
