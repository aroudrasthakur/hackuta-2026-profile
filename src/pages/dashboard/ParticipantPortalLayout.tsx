import { NavLink, Outlet } from "react-router-dom";
import {
  NavBellIcon,
  NavHomeIcon,
  NavProfileIcon,
  NavScanIcon,
  NavScheduleIcon,
} from "../../components/participant/ParticipantNavIcons";
import { useParticipantDashboard } from "./useParticipantDashboard";
import { ParticipantAvatar } from "../../components/participant/ParticipantAvatar";
import { ParticipantBrand } from "../../components/participant/ParticipantBrand";

/** `shortLabel` replaces `label` below the mobile breakpoint (CSS swaps the two spans). */
const NAV: { to: string; end: boolean; label: string; shortLabel?: string; icon: typeof NavHomeIcon }[] = [
  { to: "/dashboard", end: true, label: "Home", icon: NavHomeIcon },
  { to: "/dashboard/scan", end: false, label: "Check-in", icon: NavScanIcon },
  { to: "/dashboard/schedule", end: false, label: "Schedule", icon: NavScheduleIcon },
  { to: "/dashboard/notifications", end: false, label: "Notifications", shortLabel: "Alerts", icon: NavBellIcon },
  { to: "/dashboard/profile", end: false, label: "Profile", icon: NavProfileIcon },
];

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
          <ParticipantBrand />
        </div>
        <nav className="participant-dashboard__nav">
          {NAV.map(({ to, end, label, shortLabel, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `participant-dashboard__nav-item${isActive ? " participant-dashboard__nav-item--active" : ""}`
              }
            >
              <Icon className="participant-dashboard__nav-icon" />
              {shortLabel ? (
                <>
                  <span className="participant-dashboard__nav-label--full">{label}</span>
                  <span className="participant-dashboard__nav-label--short">{shortLabel}</span>
                </>
              ) : (
                <span>{label}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="participant-dashboard__account">
          <ParticipantAvatar displayName={data.profile.displayName} size="sidebar" />
          <div className="participant-dashboard__account-text">
            <p className="participant-dashboard__account-name">{data.profile.displayName}</p>
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
