import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { ResumePreviewDialog } from "../../components/resume/ResumePreviewDialog";
import { SignOutButton } from "../../components/SignOutButton";
import type { ParticipantDashboard } from "../../convex/api";
import { useMockAuth } from "../../hooks/useMockAuth";
import { participantSignOutButton } from "./dashboardStyles";

const PUSH_PREF_KEY = "hackuta-profile-push-pref";

export default function ParticipantProfilePage() {
  const data = useOutletContext<ParticipantDashboard>();
  const mockAuth = useMockAuth();

  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    try {
      setPushEnabled(localStorage.getItem(PUSH_PREF_KEY) === "1");
    } catch {
      setPushEnabled(false);
    }
  }, []);

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
      <header className="participant-profile__hero">
        <div className="participant-profile__avatar" aria-hidden="true">
          {data.profile.displayName.slice(0, 1).toUpperCase()}
        </div>
        <div className="participant-profile__identity">
          <h1 id="participant-profile-title" className="participant-profile__name">
            {data.profile.displayName}
          </h1>
          {data.profile.email ? <p className="participant-profile__email">{data.profile.email}</p> : null}
          <button type="button" className="participant-profile__edit-photo" disabled>
            Edit photo
          </button>
        </div>
        <nav className="participant-profile__shortcuts" aria-label="Quick links">
          <Link to="/dashboard/scan">Scan</Link>
          <span aria-hidden="true">Group</span>
          <Link to="/dashboard/profile" aria-current="page">Settings</Link>
        </nav>
      </header>

      <div className="participant-profile__group">
        <h2 className="participant-profile__group-title">Application</h2>
        <ul className="participant-profile__list">
          <li className="participant-profile-row">
            <div className="participant-profile-row__body">
              <p className="participant-profile-row__title">Resume</p>
              <p className="participant-profile-row__meta">
                {resume.status === "available" ? "On file · Locked" : "Not on file"}
              </p>
            </div>
            <ResumePreviewDialog resume={resume} variant="compact" />
          </li>
          {data.reviewStatus === "accepted" ? (
            <li className="participant-profile-row">
              <Link to="/dashboard/scan" className="participant-profile-row__link">
                <div className="participant-profile-row__body">
                  <p className="participant-profile-row__title">Replay acceptance</p>
                  <p className="participant-profile-row__meta">Print your ticket again</p>
                </div>
                <span className="participant-profile-row__chevron" aria-hidden="true">›</span>
              </Link>
            </li>
          ) : null}
        </ul>
      </div>

      <div className="participant-profile__group">
        <h2 className="participant-profile__group-title">Preferences</h2>
        <ul className="participant-profile__list">
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

      <div className="participant-profile__group">
        <ul className="participant-profile__list">
          <li className="participant-profile-row">
            <SignOutButton
              className="participant-profile-row__sign-out"
              buttonClassName={participantSignOutButton}
            />
          </li>
        </ul>
      </div>
    </section>
  );
}
