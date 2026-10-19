import { useQuery } from "../../convex/reactBindings";
import QRCode from "react-qr-code";
import { Link } from "react-router-dom";
import { Logo } from "../../components/art/Logo";
import { SignOutButton } from "../../components/SignOutButton";
import { LANDING_URL, REGISTER_URL } from "../../constants/site";
import { getMyParticipantDashboardRef } from "../../convex/api";
import { getConvexClient } from "../../convex/client";
import { useMockAuth } from "../../hooks/useMockAuth";
import { buildHackathonTimeline } from "../../../shared/hackathon/timeline";
import { resolveHackathonTimelineSource } from "../../../shared/hackathon/schedule";
import { participantSignOutButton } from "./dashboardStyles";

const DISCORD_URL = "https://discord.gg/2bVsYS3SgS";
const CONTACT_EMAIL = "hello@hackuta.org";

function formatCardDate(timestamp: number | null) {
  if (timestamp === null) return { month: "TBA", day: "—" };
  const date = new Date(timestamp);
  return {
    month: date.toLocaleString("en-US", { month: "short", timeZone: "America/Chicago" }),
    day: date.toLocaleString("en-US", { day: "2-digit", timeZone: "America/Chicago" }),
  };
}

function statusLabel(status: string | null) {
  switch (status) {
    case "accepted":
      return { label: "Accepted", tone: "accepted" as const };
    case "waitlisted":
      return { label: "Waitlisted", tone: "waitlisted" as const };
    case "rejected":
      return { label: "Not admitted", tone: "rejected" as const };
    case "under_review":
      return { label: "In review", tone: "pending" as const };
    case "unreviewed":
      return { label: "Submitted", tone: "pending" as const };
    default:
      return { label: "No application", tone: "neutral" as const };
  }
}

export default function ParticipantDashboardPage() {
  const mockAuth = useMockAuth();
  const client = getConvexClient();
  const dashboard = useQuery(
    getMyParticipantDashboardRef,
    client && !mockAuth.enabled ? {} : "skip",
  );

  if (!mockAuth.enabled && dashboard === undefined) {
    return (
      <div className="participant-dashboard participant-dashboard--loading">
        <p role="status">Loading your participant dashboard…</p>
      </div>
    );
  }

  const mockNow = 1_700_000_000_000;
  const data = mockAuth.enabled
    ? {
        profile: { displayName: "Sam Test", email: mockAuth.verifiedEmail },
        application: { submitted: true, submittedAt: mockNow, school: "UT Arlington" },
        reviewStatus: "accepted" as const,
        participant: { qrCodeToken: "a".repeat(64), acceptedAt: mockNow },
        hackathon: {
          name: "HackUTA 2026",
          startsAt: mockNow + 86_400_000,
          endsAt: mockNow + 172_800_000,
          decisionsReleasedAt: mockNow - 86_400_000,
          registrationOpensAt: mockNow - 604_800_000,
          registrationClosesAt: mockNow - 259_200_000,
        },
      }
    : dashboard;

  if (!data) {
    return (
      <div className="participant-dashboard participant-dashboard--loading">
        <p role="status">We could not load your dashboard. Try signing in again.</p>
        <Link to="/sign-in" className="participant-dashboard__link">
          Back to sign in
        </Link>
      </div>
    );
  }

  const status = statusLabel(data.reviewStatus);
  const timeline = buildHackathonTimeline(resolveHackathonTimelineSource(data.hackathon));
  const importantDates = timeline.slice(0, 3);

  return (
    <div className="participant-dashboard">
      <aside className="participant-dashboard__sidebar" aria-label="Participant navigation">
        <a href={LANDING_URL} className="participant-dashboard__brand" aria-label="HackUTA home">
          <Logo className="h-8 w-auto" variant="light" layout="header" decorative />
        </a>
        <nav className="participant-dashboard__nav">
          <span className="participant-dashboard__nav-item participant-dashboard__nav-item--active">
            Home
          </span>
        </nav>
        <div className="participant-dashboard__account">
          <p className="participant-dashboard__account-name">{data.profile.displayName}</p>
          {data.profile.email ? (
            <p className="participant-dashboard__account-email">{data.profile.email}</p>
          ) : null}
          <SignOutButton
            className="participant-dashboard__sign-out"
            buttonClassName={participantSignOutButton}
          />
        </div>
      </aside>

      <main className="participant-dashboard__main" id="participant-content" tabIndex={-1}>
        <header className="participant-dashboard__header">
          <h1 className="participant-dashboard__title">Welcome back, {data.profile.displayName}</h1>
          <p className="participant-dashboard__subtitle">{data.hackathon.name} participant portal</p>
        </header>

        <section className="participant-dashboard__banner" aria-label="Application status">
          <span className={`participant-dashboard__badge participant-dashboard__badge--${status.tone}`}>
            {status.label}
          </span>
          <h2 className="participant-dashboard__banner-title">Application status</h2>
          <p className="participant-dashboard__banner-copy">
            {data.reviewStatus === "accepted"
              ? "You are confirmed for the event. Bring your check-in QR code below and a photo ID to registration."
              : data.reviewStatus === "waitlisted"
                ? "You are on the waitlist. We will email you if a spot opens."
                : data.reviewStatus === "rejected"
                  ? "Thank you for applying. We hope to see you at a future HackUTA."
                  : data.application?.submitted
                    ? "Your application is on file. We will email you when decisions are released."
                    : "Complete your registration application to be considered for the event."}
          </p>
          {!data.application?.submitted ? (
            <a href={REGISTER_URL} className="participant-dashboard__cta">
              Continue registration
            </a>
          ) : null}
        </section>

        {data.participant ? (
          <section className="participant-dashboard__panel" aria-label="Check-in QR code">
            <h2 className="participant-dashboard__panel-title">Your check-in QR code</h2>
            <p className="participant-dashboard__panel-copy">
              This code is unique to you and stays the same for the entire event. Show it at check-in.
            </p>
            <div className="participant-dashboard__qr-wrap">
              <QRCode
                value={data.participant.qrCodeToken}
                size={200}
                bgColor="#ffffff"
                fgColor="#1a3a52"
                aria-label="Participant check-in QR code"
              />
            </div>
          </section>
        ) : null}

        <section className="participant-dashboard__section" aria-labelledby="important-dates-heading">
          <h2 id="important-dates-heading" className="participant-dashboard__section-title">
            Important dates
          </h2>
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
          </div>
          <article className="participant-dashboard__notice">
            <h3 className="participant-dashboard__notice-title">
              {data.reviewStatus === "accepted"
                ? "You're in — see you at HackUTA"
                : "Decisions and updates by email"}
            </h3>
            <p className="participant-dashboard__notice-copy">
              {data.reviewStatus === "accepted"
                ? "Watch your inbox for logistics, schedule, and travel details as the event approaches."
                : "Organizers send decision emails to the address on your application. Check spam if you are waiting on news."}
            </p>
          </article>
        </section>

        <section className="participant-dashboard__section" aria-labelledby="links-heading">
          <h2 id="links-heading" className="participant-dashboard__section-title">
            Important links
          </h2>
          <ul className="participant-dashboard__links">
            <li>
              <a href={LANDING_URL}>Event website</a>
            </li>
            <li>
              <a href={DISCORD_URL}>Discord community</a>
            </li>
            <li>
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </li>
            <li>
              <a href={REGISTER_URL}>Registration portal</a>
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
