/** Maximum public leaderboard size. Ranking above this is returned only on `you`. */
export const LEADERBOARD_LIMIT = 10;

export type RankableParticipant = {
  id: string;
  points: number;
  /** Backend-only: when this exact total was reached. Never sent to clients. */
  pointsReachedAt: number;
};

/**
 * Highest points first; equal points prefer whoever reached that total earlier;
 * remaining ties use the stable document id.
 */
export function compareRankable(a: RankableParticipant, b: RankableParticipant) {
  if (b.points !== a.points) return b.points - a.points;
  if (a.pointsReachedAt !== b.pointsReachedAt) return a.pointsReachedAt - b.pointsReachedAt;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** 1-based rank, or null when the id is missing from the ranked (positive-points) set. */
export function rankOf(ranked: RankableParticipant[], id: string) {
  const index = ranked.findIndex((row) => row.id === id);
  return index === -1 ? null : index + 1;
}

export function isPositivePoints(points: number | undefined): points is number {
  return points !== undefined && Number.isSafeInteger(points) && points > 0;
}

/** Prefer the dedicated timestamp; fall back so legacy rows still rank stably. */
export function pointsReachedAtOf(participant: {
  pointsReachedAt?: number;
  updatedAt: number;
  acceptedAt: number;
}) {
  return participant.pointsReachedAt ?? participant.updatedAt ?? participant.acceptedAt;
}
