import { Link, useOutletContext } from "react-router-dom";
import type { ParticipantDashboard } from "../../convex/api";
import { ImportantLinksGrid } from "../../components/participant/ImportantLinksGrid";
import { REGISTER_URL } from "../../constants/site";
import { buildHackathonTimeline } from "../../../shared/hackathon/timeline";
import { resolveHackathonTimelineSource } from "../../../shared/hackathon/schedule";
import { formatCardDate, statusBannerCopy, statusLabel } from "./dashboardUtils";

export default function ParticipantHomePage() {
  const data = useOutletContext<ParticipantDashboard>();
  const status = statusLabel(data.reviewStatus);
  const timeline = buildHackathonTimeline(resolveHackathonTimelineSource(data.hackathon));
  const importantDates = timeline.slice(0, 3);
  const submitted = data.application?.submitted ?? false;

  const bannerInner = (
    <>
      <span className={`participant-dashboard__badge participant-dashboard__badge--${status.tone}`}>
        {status.label}
      </span>
      <h2 className="participant-dashboard__banner-title">Application status</h2>
      <p className="participant-dashboard__banner-copy">
        {statusBannerCopy(data.reviewStatus, submitted)}
      </p>
      {submitted ? (
        <span className="participant-dashboard__banner-link">View submission</span>
      ) : null}
    </>
  );

  return (
    <>
      <header className="participant-dashboard__header">
        <h1 className="participant-dashboard__title">Welcome back, {data.profile.displayName}</h1>
      </header>

      {submitted ? (
        <Link to="/dashboard/application" className="participant-dashboard__banner participant-dashboard__banner--link">
          {bannerInner}
          <span className="participant-dashboard__banner-chevron" aria-hidden="true">›</span>
        </Link>
      ) : (
        <section className="participant-dashboard__banner" aria-label="Application status">
          {bannerInner}
          <a href={REGISTER_URL} className="participant-dashboard__cta">
            Continue registration
          </a>
        </section>
      )}

      {data.reviewStatus === "accepted" && !data.participant ? (
        <section className="participant-dashboard__panel participant-dashboard__panel--cta" aria-label="RSVP">
          <h2 className="participant-dashboard__panel-title">Claim your spot</h2>
          <p className="participant-dashboard__panel-copy">
            Confirm you&apos;re coming so we can save you a seat.
          </p>
          <button type="button" className="participant-dashboard__cta participant-dashboard__cta--block" disabled>
            RSVP to claim your spot
          </button>
        </section>
      ) : null}

      <section className="participant-dashboard__section" aria-labelledby="important-dates-heading">
        <div className="participant-dashboard__section-head">
          <h2 id="important-dates-heading" className="participant-dashboard__section-title">
            Important dates
          </h2>
          <Link to="/dashboard/schedule" className="participant-dashboard__section-link">
            Schedule
          </Link>
        </div>
        <ul className="participant-dashboard__date-grid">
          {importantDates.map((event) => {
            const parts = formatCardDate(event.timestamp);
            return (
              <li key={event.id} className="participant-dashboard__date-card">
                <p className="participant-dashboard__date-month">{parts.month}</p>
                <p className="participant-dashboard__date-day">{parts.day}</p>
                <p className="participant-dashboard__date-label">{event.label}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="participant-dashboard__section" aria-labelledby="notifications-heading">
        <div className="participant-dashboard__section-head">
          <h2 id="notifications-heading" className="participant-dashboard__section-title">
            Notifications
          </h2>
          <Link to="/dashboard/notifications" className="participant-dashboard__section-link">
            See all
          </Link>
        </div>
        <article className="participant-dashboard__notice">
          <h3 className="participant-dashboard__notice-title">Decisions are out</h3>
          <p className="participant-dashboard__notice-copy">
            View your status to see your decision.
          </p>
        </article>
      </section>

      <section className="participant-dashboard__section participant-dashboard__section--links" aria-labelledby="links-heading">
        <h2 id="links-heading" className="participant-dashboard__section-title">
          Important links
        </h2>
        <ImportantLinksGrid />
      </section>
    </>
  );
}
