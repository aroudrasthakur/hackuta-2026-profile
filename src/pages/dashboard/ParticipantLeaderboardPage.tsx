import { OliveBranch } from "../../components/art/OliveBranch";
import { ParticipantPageHeader } from "../../components/participant/ParticipantPageHeader";
import type { LeaderboardEntry, PointsLeaderboard } from "../../convex/api";
import { usePointsLeaderboard } from "./usePointsLeaderboard";

function formatPoints(points: number) {
  return points.toLocaleString("en-US");
}

function ordinal(rank: number) {
  const remainder = rank % 100;
  if (remainder >= 11 && remainder <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

function Medal({ place }: { place: 1 | 2 | 3 }) {
  return (
    <svg className="participant-leaderboard__medal" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="currentColor" opacity="0.18" />
      <circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <text x="16" y="20.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">
        {place}
      </text>
    </svg>
  );
}

function YourRankCard({ you }: { you: PointsLeaderboard["you"] }) {
  const rank = you.rank;
  const ranked = rank !== null;
  return (
    <aside className="participant-leaderboard__you" aria-labelledby="participant-leaderboard-you-title">
      <div>
        <h2 id="participant-leaderboard-you-title" className="participant-leaderboard__you-label">
          Your ranking
        </h2>
        <p className="participant-leaderboard__you-copy">
          {ranked
            ? `You are in ${ordinal(rank)} place.`
            : you.points > 0
              ? "You are not on the accepted points leaderboard yet."
              : "Earn points at events to appear on the board."}
        </p>
      </div>
      <dl className="participant-leaderboard__you-stats">
        <div>
          <dt>Rank</dt>
          <dd>{ranked ? rank : "—"}</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{formatPoints(you.points)}</dd>
        </div>
      </dl>
    </aside>
  );
}

function PodiumCard({ entry, place }: { entry: LeaderboardEntry; place: 1 | 2 | 3 }) {
  const tone = place === 1 ? "gold" : place === 2 ? "silver" : "bronze";
  return (
    <li
      className={`participant-leaderboard__podium-card participant-leaderboard__podium-card--${tone}${entry.isYou ? " participant-leaderboard__podium-card--you" : ""}`}
      aria-current={entry.isYou ? "true" : undefined}
    >
      <Medal place={place} />
      <p className="participant-leaderboard__podium-rank">{ordinal(entry.rank)}</p>
      <p className="participant-leaderboard__podium-name">{entry.name}</p>
      <p className="participant-leaderboard__podium-points">{formatPoints(entry.points)} pts</p>
    </li>
  );
}

function Podium({ entries }: { entries: LeaderboardEntry[] }) {
  const first = entries.find((entry) => entry.rank === 1);
  const second = entries.find((entry) => entry.rank === 2);
  const third = entries.find((entry) => entry.rank === 3);
  if (!first) return null;

  return (
    <ol className="participant-leaderboard__podium" aria-label="Top three">
      {second ? <PodiumCard entry={second} place={2} /> : null}
      <PodiumCard entry={first} place={1} />
      {third ? <PodiumCard entry={third} place={3} /> : null}
    </ol>
  );
}

function RankList({ entries }: { entries: LeaderboardEntry[] }) {
  const rest = entries.filter((entry) => entry.rank >= 4);
  const firstRest = rest[0];
  if (!firstRest) return null;

  return (
    <ol className="participant-leaderboard__list" start={firstRest.rank} aria-label="Ranks 4 through 10">
      {rest.map((entry) => (
        <li
          key={entry.rank}
          className={`participant-leaderboard__row${entry.isYou ? " participant-leaderboard__row--you" : ""}`}
          aria-current={entry.isYou ? "true" : undefined}
        >
          <span className="participant-leaderboard__row-rank">{entry.rank}</span>
          <span className="participant-leaderboard__row-name">{entry.name}</span>
          <span className="participant-leaderboard__row-points">{formatPoints(entry.points)} pts</span>
        </li>
      ))}
    </ol>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="participant-leaderboard__skeleton" aria-hidden="true">
      <div className="participant-leaderboard__you participant-leaderboard__pulse" />
      <div className="participant-leaderboard__podium">
        <div className="participant-leaderboard__podium-card participant-leaderboard__pulse" />
        <div className="participant-leaderboard__podium-card participant-leaderboard__podium-card--gold participant-leaderboard__pulse" />
        <div className="participant-leaderboard__podium-card participant-leaderboard__pulse" />
      </div>
      <div className="participant-leaderboard__list">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="participant-leaderboard__row participant-leaderboard__pulse" />
        ))}
      </div>
    </div>
  );
}

function LeaderboardAtmosphere() {
  return (
    <div className="participant-leaderboard__atmosphere" aria-hidden="true">
      <div className="participant-leaderboard__sky" />
      <img
        className="participant-leaderboard__scene participant-leaderboard__scene--pillar participant-leaderboard__scene--left"
        src="/images/landing/pillars-clear.webp"
        alt=""
        width={320}
        height={480}
        decoding="async"
      />
      <img
        className="participant-leaderboard__scene participant-leaderboard__scene--pillar participant-leaderboard__scene--right"
        src="/images/landing/pillars-clear.webp"
        alt=""
        width={320}
        height={480}
        decoding="async"
      />
      <img
        className="participant-leaderboard__scene participant-leaderboard__scene--temple"
        src="/images/landing/temple-clear.webp"
        alt=""
        width={640}
        height={360}
        decoding="async"
      />
      <img
        className="participant-leaderboard__scene participant-leaderboard__scene--ground"
        src="/images/landing/ground-clear.webp"
        alt=""
        width={800}
        height={200}
        decoding="async"
      />
      <OliveBranch className="participant-leaderboard__laurel participant-leaderboard__laurel--left" />
      <OliveBranch className="participant-leaderboard__laurel participant-leaderboard__laurel--right" />
    </div>
  );
}

export default function ParticipantLeaderboardPage() {
  const { loading, data } = usePointsLeaderboard();

  return (
    <section className="participant-leaderboard participant-leaderboard--immersive" aria-labelledby="participant-leaderboard-title">
      <ParticipantPageHeader
        id="participant-leaderboard-title"
        title="Leaderboard"
        description="Top 10 participants by points. Rankings update live as events and adjustments come in."
      />

      <div className="participant-leaderboard__stage">
        <LeaderboardAtmosphere />
        <div className="participant-leaderboard__body">
          {loading ? (
            <>
              <p className="sr-only" role="status">
                Loading leaderboard…
              </p>
              <LeaderboardSkeleton />
            </>
          ) : data === null ? (
            <p role="alert" className="participant-leaderboard__empty">
              We could not load the leaderboard. Try signing in again.
            </p>
          ) : (
            <>
              <YourRankCard you={data.you} />
              {data.entries.length === 0 ? (
                <p role="status" className="participant-leaderboard__empty">
                  No one has earned points yet. Check back after the first event awards.
                </p>
              ) : (
                <>
                  <Podium entries={data.entries} />
                  <RankList entries={data.entries} />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
