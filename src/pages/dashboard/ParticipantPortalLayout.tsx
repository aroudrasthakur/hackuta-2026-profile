import { NavLink, Outlet } from "react-router-dom";
import { Logo } from "../../components/art/Logo";
import {
  NavBellIcon,
  NavHomeIcon,
  NavProfileIcon,
  NavScanIcon,
  NavScheduleIcon,
} from "../../components/participant/ParticipantNavIcons";
import { LANDING_URL } from "../../constants/site";
import { useParticipantDashboard } from "./useParticipantDashboard";

const NAV = [
  { to: "/dashboard", end: true, label: "Home", icon: NavHomeIcon },
  { to: "/dashboard/scan", end: false, label: "Scan", icon: NavScanIcon },
  { to: "/dashboard/schedule", end: false, label: "Schedule", icon: NavScheduleIcon },
  { to: "/dashboard/notifications", end: false, label: "Notifications", icon: NavBellIcon },
  { to: "/dashboard/profile", end: false, label: "Profile", icon: NavProfileIcon },
] as const;

export default function ParticipantPortalLayout() {
  const { loading, data } = useParticipantDashboard();

  if (loading) {
    return (
      <div className="participant-dashboard participant-dashboard--loading">
        <p role="status">Loading your participant dashboard…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="participant-dashboard participant-dashboard--loading">
        <p role="status">We could not load your dashboard. Try signing in again.</p>
      </div>
    );
  }

  return (
    <div className="participant-dashboard">
      <aside className="participant-dashboard__sidebar" aria-label="Participant navigation">
        <div className="participant-dashboard__sidebar-head">
          <a href={LANDING_URL} className="participant-dashboard__brand" aria-label="HackUTA home">
            <Logo className="h-7 w-auto" variant="light" layout="header" decorative />
          </a>
        </div>
        <nav className="participant-dashboard__nav">
          {NAV.map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `participant-dashboard__nav-item${isActive ? " participant-dashboard__nav-item--active" : ""}`
              }
            >
              <Icon className="participant-dashboard__nav-icon" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="participant-dashboard__account">
          <div className="participant-dashboard__account-avatar" aria-hidden="true">
            {data.profile.displayName.slice(0, 1).toUpperCase()}
          </div>
          <div className="participant-dashboard__account-text">
            <p className="participant-dashboard__account-name">Hacker</p>
            {data.profile.email ? (
              <p className="participant-dashboard__account-email">{data.profile.email}</p>
            ) : null}
          </div>
        </div>
      </aside>

      <main className="participant-dashboard__main" id="participant-content" tabIndex={-1}>
        <Outlet context={data} />
      </main>
    </div>
  );
}
