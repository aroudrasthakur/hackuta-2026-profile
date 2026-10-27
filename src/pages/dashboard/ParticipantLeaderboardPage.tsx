import type { CSSProperties } from "react";
import { ParticipantPageHeader } from "../../components/participant/ParticipantPageHeader";
import type { LeaderboardEntry, PointsLeaderboard } from "../../convex/api";
import { profileInitials } from "../../lib/participantDisplay";
import { usePointsLeaderboard } from "./usePointsLeaderboard";

type Place = 1 | 2 | 3;

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

function roman(rank: number) {
  return ROMAN[rank] ?? String(rank);
}

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

function YouTag() {
  return <span className="participant-leaderboard__you-tag">You</span>;
}

function YourRankCard({ you, entries }: { you: PointsLeaderboard["you"]; entries: LeaderboardEntry[] }) {
  const rank = you.rank;
  const ranked = rank !== null;
  const ahead = ranked ? entries.find((entry) => entry.rank === rank - 1) : undefined;
  const gap = ahead ? ahead.points - you.points : 0;

  return (
    <aside className="participant-leaderboard__you" aria-labelledby="participant-leaderboard-you-title">
      <span className="participant-leaderboard__numeral participant-leaderboard__numeral--lg" aria-hidden="true">
        {ranked ? roman(rank) : "—"}
      </span>
      <div className="participant-leaderboard__you-text">
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
        {ahead && gap > 0 ? (
          <p className="participant-leaderboard__you-hint">
            {formatPoints(gap)} pts to reach {ordinal(ahead.rank)}
          </p>
        ) : null}
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

function PodiumSpot({ entry, place }: { entry: LeaderboardEntry; place: Place }) {
  return (
    <li
      className={`participant-leaderboard__spot participant-leaderboard__spot--${place}${entry.isYou ? " participant-leaderboard__spot--you" : ""}`}
      aria-current={entry.isYou ? "true" : undefined}
    >
      <div className="participant-leaderboard__honoree">
        <span className="participant-leaderboard__initials" aria-hidden="true">
          {profileInitials(entry.name)}
        </span>
        <p className="participant-leaderboard__podium-name">
          {entry.name}
          {entry.isYou ? <YouTag /> : null}
        </p>
        <p className="participant-leaderboard__podium-points">{formatPoints(entry.points)} pts</p>
      </div>
      <div className="participant-leaderboard__plinth">
        <span className="participant-leaderboard__numeral" aria-hidden="true">
          {roman(place)}
        </span>
        <span className="participant-leaderboard__plinth-label">{ordinal(entry.rank)}</span>
      </div>
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
      {second ? <PodiumSpot entry={second} place={2} /> : null}
      <PodiumSpot entry={first} place={1} />
      {third ? <PodiumSpot entry={third} place={3} /> : null}
    </ol>
  );
}

function RankList({ entries }: { entries: LeaderboardEntry[] }) {
  const rest = entries.filter((entry) => entry.rank >= 4);
  const firstRest = rest[0];
  const lastRest = rest[rest.length - 1];
  const leaderPoints = entries[0]?.points ?? 0;
  if (!firstRest || !lastRest) return null;

  return (
    <div className="participant-leaderboard__panel">
      <div className="participant-leaderboard__panel-head">
        <h2>The contenders</h2>
        <p>
          Ranks {roman(firstRest.rank)}–{roman(lastRest.rank)}
        </p>
      </div>
      <ol className="participant-leaderboard__list" start={firstRest.rank} aria-label="Ranks 4 through 10">
        {rest.map((entry) => (
          <li
            key={entry.rank}
            className={`participant-leaderboard__row${entry.isYou ? " participant-leaderboard__row--you" : ""}`}
            aria-current={entry.isYou ? "true" : undefined}
            style={{ "--share": leaderPoints > 0 ? entry.points / leaderPoints : 0 } as CSSProperties}
          >
            <span className="participant-leaderboard__numeral participant-leaderboard__row-rank">
              {entry.rank}
            </span>
            <span className="participant-leaderboard__row-main">
              <span className="participant-leaderboard__row-name">
                {entry.name}
                {entry.isYou ? <YouTag /> : null}
              </span>
              <span className="participant-leaderboard__row-bar" aria-hidden="true" />
            </span>
            <span className="participant-leaderboard__row-points">{formatPoints(entry.points)} pts</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="participant-leaderboard__skeleton" aria-hidden="true">
      <div className="participant-leaderboard__you participant-leaderboard__pulse" />
      <div className="participant-leaderboard__panel participant-leaderboard__pulse" />
    </div>
  );
}

export default function ParticipantLeaderboardPage() {
  const { loading, data } = usePointsLeaderboard();

  return (
    <section className="participant-leaderboard" aria-labelledby="participant-leaderboard-title">
      <ParticipantPageHeader
        id="participant-leaderboard-title"
        title="Leaderboard"
        description="Top 10 participants by points. Rankings update live as events and adjustments come in."
      />

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
          <YourRankCard you={data.you} entries={data.entries} />
          {data.entries.length === 0 ? (
            <p role="status" className="participant-leaderboard__empty">
              No one has earned points yet. Check back after the first event awards.
            </p>
          ) : (
            <>
              <div className="participant-leaderboard__panel participant-leaderboard__arena">
                <img
                  className="participant-leaderboard__temple"
                  src="/images/landing/temple-clear.webp"
                  alt=""
                  aria-hidden="true"
                  decoding="async"
                />
                <Podium entries={data.entries} />
              </div>
              <RankList entries={data.entries} />
            </>
          )}
        </>
      )}
    </section>
  );
}
