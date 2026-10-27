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
import { buildHackathonTimeline } from "../../../shared/hackathon/timeline";
import { resolveHackathonTimelineSource } from "../../../shared/hackathon/schedule";
import { formatCardDate, statusBannerCopy, statusLabel } from "./dashboardUtils";

const HOME_TABS = [
  { to: "/dashboard", end: true, label: "Home", icon: NavHomeIcon },
  { to: "/dashboard/schedule", end: false, label: "Schedule", icon: NavScheduleIcon },
  { to: "/dashboard/scan", end: false, label: "Check-in", icon: NavScanIcon },
] as const;

export default function ParticipantHomePage() {
  const data = useOutletContext<ParticipantDashboard>();
  const status = statusLabel(data.reviewStatus);
  const timeline = buildHackathonTimeline(resolveHackathonTimelineSource(data.hackathon));
  const importantDates = timeline.slice(0, 3);
  const submitted = data.application?.submitted ?? false;

  return (
    <section className="participant-home" aria-labelledby="participant-home-title">
      <ParticipantPageHeader
        id="participant-home-title"
        title={`Welcome back, ${data.profile.displayName}`}
        description="Your HackUTA hub for check-in, schedule, and event updates."
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

        <div className="participant-schedule__panel" aria-labelledby="important-dates-heading">
          <div className="participant-schedule__day-head">
            <h2 id="important-dates-heading">Important dates</h2>
            <Link to="/dashboard/schedule" className="participant-home__head-link">
              Full schedule
            </Link>
          </div>
          <ol className="participant-schedule__timeline">
            {importantDates.map((event) => {
              const parts = formatCardDate(event.timestamp);
              return (
                <li key={event.id} className="participant-schedule__slot">
                  <time dateTime={new Date(event.timestamp).toISOString()}>{`${parts.month} ${parts.day}`}</time>
                  <span>{event.label}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="participant-schedule__panel" aria-labelledby="notifications-heading">
          <div className="participant-schedule__day-head">
            <h2 id="notifications-heading">Notifications</h2>
            <Link to="/dashboard/notifications" className="participant-home__head-link">
              See all
            </Link>
          </div>
          <ul className="participant-profile__rows">
            <li className="participant-profile-row participant-profile-row--flush">
              <div className="participant-profile-row__body">
                <p className="participant-profile-row__title">Decisions are out</p>
                <p className="participant-profile-row__meta">View your status to see your decision.</p>
              </div>
            </li>
          </ul>
        </div>

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
