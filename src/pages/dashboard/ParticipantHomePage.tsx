import { Link, NavLink, useOutletContext } from "react-router-dom";
import { ParticipantPageHeader } from "../../components/participant/ParticipantPageHeader";
import {
  NavHomeIcon,
  NavScanIcon,
  NavScheduleIcon,
} from "../../components/participant/ParticipantNavIcons";
import type { ParticipantDashboard } from "../../convex/api";
import { ImportantLinksGrid } from "../../components/participant/ImportantLinksGrid";
import { REGISTER_URL } from "../../constants/site";
import { statusBannerCopy, statusLabel } from "./dashboardUtils";
import { usePointsLeaderboard } from "./usePointsLeaderboard";

const HOME_TABS = [
  { to: "/dashboard", end: true, label: "Home", icon: NavHomeIcon },
  { to: "/dashboard/schedule", end: false, label: "Schedule", icon: NavScheduleIcon },
  { to: "/dashboard/scan", end: false, label: "Check-in", icon: NavScanIcon },
] as const;

export default function ParticipantHomePage() {
  const data = useOutletContext<ParticipantDashboard>();
  const { loading: pointsLoading, data: pointsData } = usePointsLeaderboard();
  const status = statusLabel(data.reviewStatus);
  const submitted = data.application?.submitted ?? false;
  const dietaryRows = data.submittedApplication?.sections
    .flatMap((section) => section.rows)
    .filter((row) => ["Dietary restrictions", "Allergy details", "Other dietary restrictions"].includes(row.label));
  const dietaryRestrictions = dietaryRows
    ?.filter((row) => row.label !== "Allergy details")
    .map((row) => row.value)
    .join(", ");
  const allergyDetails = dietaryRows?.find((row) => row.label === "Allergy details")?.value;

  return (
    <section className="participant-home" aria-labelledby="participant-home-title">
      <ParticipantPageHeader
        id="participant-home-title"
        title={`Welcome back, ${data.profile.displayName}`}
        description="Your HackUTA hub for check-in, schedule, and important links."
        actions={
          <Link
            to="/dashboard/leaderboard"
            className="participant-home__points"
            aria-label={
              pointsLoading
                ? "Loading your points balance"
                : pointsData
                  ? `Your points balance: ${pointsData.you.points} Points`
                  : "Your points balance is unavailable"
            }
          >
            {pointsLoading
              ? "Loading points…"
              : pointsData
                ? `${pointsData.you.points.toLocaleString("en-US")} Points`
                : "Points unavailable"}
          </Link>
        }
      />

      <div className="participant-portal__inner">
        <div
          className="participant-schedule__tablist participant-home__tablist"
          role="tablist"
          aria-label="Dashboard shortcuts"
        >
          {HOME_TABS.map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              role="tab"
              className={({ isActive }) =>
                `participant-schedule__tab participant-profile__tab${isActive ? " participant-profile__tab--active" : ""}`
              }
            >
              <span className="participant-schedule__tab-numeral participant-profile__tab-icon-wrap" aria-hidden="true">
                <Icon className="participant-profile__tab-icon" />
              </span>
              <span className="participant-schedule__tab-label">{label}</span>
            </NavLink>
          ))}
        </div>

        <div className="participant-schedule__panel">
          <div className="participant-schedule__day-head">
            <h2>Application status</h2>
            <span className={`participant-dashboard__badge participant-dashboard__badge--${status.tone}`}>
              {status.label}
            </span>
          </div>
          <p className="participant-home__lead">{statusBannerCopy(data.reviewStatus, submitted)}</p>
          <ul className="participant-profile__rows">
            {submitted ? (
              <li className="participant-profile-row">
                <Link to="/dashboard/application" className="participant-profile-row__link">
                  <div className="participant-profile-row__body">
                    <p className="participant-profile-row__title">View submission</p>
                    <p className="participant-profile-row__meta">Review your application answers</p>
                  </div>
                  <span className="participant-profile-row__chevron" aria-hidden="true">
                    ›
                  </span>
                </Link>
              </li>
            ) : (
              <li className="participant-profile-row participant-profile-row--flush">
                <a href={REGISTER_URL} className="participant-home__cta">
                  Continue registration
                </a>
              </li>
            )}
          </ul>
        </div>

        {data.reviewStatus === "accepted" && !data.participant ? (
          <div className="participant-schedule__panel" aria-label="RSVP">
            <div className="participant-schedule__day-head">
              <h2>Claim your spot</h2>
            </div>
            <p className="participant-home__lead">Confirm you&apos;re coming so we can save you a seat.</p>
            <button type="button" className="participant-home__cta participant-home__cta--block" disabled>
              RSVP to claim your spot
            </button>
          </div>
        ) : null}

        <section className="participant-schedule__panel" aria-labelledby="dietary-restrictions-heading">
          <div className="participant-schedule__day-head">
            <h2 id="dietary-restrictions-heading">Dietary Restrictions</h2>
          </div>
          {data.submittedApplication === undefined ? (
            <p className="participant-home__dietary-empty">Dietary information is unavailable.</p>
          ) : dietaryRows?.length ? (
            <dl className="participant-home__dietary-list">
              <div className="participant-home__dietary-row">
                <dt>Dietary restrictions</dt>
                <dd>{dietaryRestrictions || "None specified"}</dd>
              </div>
              <div className="participant-home__dietary-row">
                <dt>Allergy details</dt>
                <dd>{allergyDetails || "None specified"}</dd>
              </div>
            </dl>
          ) : (
            <p className="participant-home__dietary-empty">None specified</p>
          )}
        </section>

        <div className="participant-schedule__panel participant-home__links-panel" aria-labelledby="links-heading">
          <div className="participant-schedule__day-head">
            <h2 id="links-heading">Important links</h2>
          </div>
          <ImportantLinksGrid variant="portal" />
        </div>
      </div>
    </section>
  );
}
