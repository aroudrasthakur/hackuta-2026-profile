import { useState } from "react";
import { Link, NavLink, useOutletContext } from "react-router-dom";
import { ResumePreviewDialog } from "../../components/resume/ResumePreviewDialog";
import { SignOutButton } from "../../components/SignOutButton";
import type { ParticipantDashboard } from "../../convex/api";
import { useMockAuth } from "../../hooks/useMockAuth";
import { participantSignOutButton } from "./dashboardStyles";
import { ParticipantPageHeader } from "../../components/participant/ParticipantPageHeader";
import { NavScanIcon, NavSettingsIcon } from "../../components/participant/ParticipantNavIcons";
import { ParticipantAvatar } from "../../components/participant/ParticipantAvatar";

const PUSH_PREF_KEY = "hackuta-profile-push-pref";

const PROFILE_TABS = [
  { to: "/dashboard/scan", end: false, label: "Check-in", icon: NavScanIcon },
  { to: "/dashboard/profile", end: true, label: "Settings", icon: NavSettingsIcon },
] as const;

export default function ParticipantProfilePage() {
  const data = useOutletContext<ParticipantDashboard>();
  const mockAuth = useMockAuth();

  const [pushEnabled, setPushEnabled] = useState(() => {
    try {
      return localStorage.getItem(PUSH_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });

  const resume = mockAuth.enabled
    ? { status: "none" as const, url: null, filename: null }
    : data.submittedApplication?.resume ?? { status: "none" as const, url: null, filename: null };

  function togglePush() {
    const next = !pushEnabled;
    setPushEnabled(next);
    try {
      localStorage.setItem(PUSH_PREF_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  }

  return (
    <section className="participant-profile" aria-labelledby="participant-profile-title">
      <ParticipantPageHeader
        id="participant-profile-title"
        title="Profile"
        description="Your account, application, and event settings."
      />

      <div className="participant-profile__inner">
        <div className="participant-schedule__tablist participant-profile__tablist" role="tablist" aria-label="Profile sections">
          {PROFILE_TABS.map(({ to, end, label, icon: Icon }) => (
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

        <div className="participant-schedule__panel participant-profile__identity-panel">
          <ParticipantAvatar displayName={data.profile.displayName} size="profile" />
          <h2 className="participant-profile__name">{data.profile.displayName}</h2>
          {data.profile.email ? <p className="participant-profile__email">{data.profile.email}</p> : null}
        </div>

        <div className="participant-schedule__panel">
          <div className="participant-schedule__day-head">
            <h2>Application</h2>
          </div>
          <ul className="participant-profile__rows">
            <li className="participant-profile-row">
              <div className="participant-profile-row__body">
                <p className="participant-profile-row__title">Resume</p>
                <p className="participant-profile-row__meta">
                  {resume.status === "available" ? "On file · Locked" : "Not on file"}
                </p>
              </div>
              <ResumePreviewDialog resume={resume} variant="compact" />
            </li>
            {data.reviewStatus === "accepted" && data.participant?.status !== "checked_in" ? (
              <li className="participant-profile-row">
                <Link to="/dashboard/scan" className="participant-profile-row__link">
                  <div className="participant-profile-row__body">
                    <p className="participant-profile-row__title">Replay acceptance</p>
                    <p className="participant-profile-row__meta">Print your ticket again</p>
                  </div>
                  <span className="participant-profile-row__chevron" aria-hidden="true">
                    ›
                  </span>
                </Link>
              </li>
            ) : null}
          </ul>
        </div>

        <div className="participant-schedule__panel">
          <div className="participant-schedule__day-head">
            <h2>Preferences</h2>
          </div>
          <ul className="participant-profile__rows">
            <li className="participant-profile-row">
              <div className="participant-profile-row__body">
                <p className="participant-profile-row__title">Install app</p>
                <p className="participant-profile-row__meta">
                  Add HackUTA to your phone&apos;s home screen for the full experience.
                </p>
              </div>
            </li>
            <li className="participant-profile-row">
              <div className="participant-profile-row__body">
                <p className="participant-profile-row__title">Push notifications</p>
                <p className="participant-profile-row__meta">Decision &amp; event alerts</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={pushEnabled}
                className={`participant-toggle${pushEnabled ? " participant-toggle--on" : ""}`}
                onClick={togglePush}
              >
                <span className="participant-toggle__thumb" />
              </button>
            </li>
          </ul>
        </div>

        <div className="participant-schedule__panel participant-profile__account-panel">
          <ul className="participant-profile__rows">
            <li className="participant-profile-row participant-profile-row--flush">
              <SignOutButton
                className="participant-profile-row__sign-out"
                buttonClassName={participantSignOutButton}
              />
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
