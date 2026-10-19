import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { OdysseyButton } from "../../components/OdysseyButton";
import { PageShell } from "../../components/PageShell";
import { SignOutButton } from "../../components/SignOutButton";
import { StormPageFrame } from "../../components/StormPageFrame";
import { useHackathonName, useRegistrationWindow } from "../../hooks/useHackathonName";
import { useMockAuth } from "../../hooks/useMockAuth";
import { getMyApplicantDashboardRef } from "../../convex/api";
import { getConvexClient } from "../../convex/client";
import { resolveHackathonTimelineSource } from "../../../shared/hackathon/schedule";
import {
  APPLICATION_CLOSED_MESSAGE,
  APPLICATION_NOT_OPEN_MESSAGE,
} from "../../../shared/registration/submitErrors";
import { buildHackathonTimeline } from "../../../shared/hackathon/timeline";
import { getApplicantStatusLabel } from "./applicantStatus";
import { ApplicantTimeline } from "./ApplicantTimeline";
import { ProfileAsset } from "./ProfileAsset";
import { ProfileField } from "./ProfileField";
import {
  profileFieldStack,
  profileMetaText,
  profileCompactButton,
  profileOverviewGrid,
  profileOverviewPanel,
  profileOverviewTimelinePanel,
  profilePageBody,
  profilePageSubtitle,
  profilePageSubtitleSubmitted,
  profilePageTitle,
  profilePageTitleSubmitted,
  profileSignOutButton,
  profileSignOutWrap,
} from "./profileStyles";

function ProfilePageShell({
  subtitle,
  children,
}: {
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <StormPageFrame>
      <ProfileAsset />
      <PageShell
        title="Your Journey"
        subtitle={subtitle}
        frameless
        wide
        compact
      >
        {children}
      </PageShell>
    </StormPageFrame>
  );
}

function applicantName(
  displayName: string | null | undefined,
  answers: { firstName?: string | null; lastName?: string | null } | null,
) {
  if (displayName?.trim()) return displayName.trim();
  const first = answers?.firstName?.trim();
  const last = answers?.lastName?.trim();
  if (first && last) return `${first} ${last}`;
  return first || last || "—";
}

function yearOfStudy(
  answers: {
    graduationYear?: number | string | null;
    levelOfStudy?: string | null;
    otherLevelOfStudy?: string | null;
  } | null,
) {
  if (answers?.graduationYear) return String(answers.graduationYear);
  if (answers?.levelOfStudy?.trim()) {
    if (
      answers.levelOfStudy.trim() === "Other" &&
      answers.otherLevelOfStudy?.trim()
    ) {
      return answers.otherLevelOfStudy.trim();
    }
    return answers.levelOfStudy.trim();
  }
  return "—";
}

export default function ProfilePage() {
  const mockAuth = useMockAuth();
  const hackathonName = useHackathonName();
  const client = getConvexClient();
  const pageSubtitle = `${hackathonName}`;
  const dashboard = useQuery(
    getMyApplicantDashboardRef,
    client && !mockAuth.enabled ? {} : "skip",
  );
  const schedule = resolveHackathonTimelineSource(mockAuth.enabled ? null : dashboard?.hackathon);
  const phase = useRegistrationWindow(schedule.registrationOpensAt, schedule.registrationClosesAt);

  if (!mockAuth.enabled && dashboard === undefined) {
    return (
      <ProfilePageShell subtitle={pageSubtitle}>
        <p className="text-sm text-(--ocean)" role="status" aria-live="polite">
          Loading your application…
        </p>
      </ProfilePageShell>
    );
  }

  const mockTimestamp = 1_700_000_000_000;
  const profile = mockAuth.enabled
    ? {
        profile: {
          displayName: "Sam Test",
          verifiedEmail: mockAuth.verifiedEmail,
        },
        registration: mockAuth.hasSubmittedRegistration
          ? {
              status: "submitted",
              submittedAt: mockTimestamp,
              updatedAt: mockTimestamp,
              resumeStatus: "none" as const,
              answers: {
                firstName: "Sam",
                lastName: "Test",
                school: "The University of Texas at Arlington",
                countryOfResidence: "United States of America",
                stateOfResidence: "Texas",
                levelOfStudy: "Undergraduate University (3+ year)",
                graduationYear: 2026,
              },
            }
          : null,
        hackathon: null,
      }
    : dashboard;

  if (!profile) {
    return (
      <ProfilePageShell subtitle={pageSubtitle}>
        <p className="text-sm text-red-600" role="alert">
          We couldn&apos;t load your application. Please try again.
        </p>
      </ProfilePageShell>
    );
  }

  const registration = profile.registration;
  const answers = registration?.answers ?? null;
  const timeline = buildHackathonTimeline(schedule);
  const submitted = Boolean(
    registration?.submittedAt && registration.status !== "draft",
  );
  const statusLabel = getApplicantStatusLabel(registration);
  const name = applicantName(profile.profile.displayName, answers);
  const school = answers?.school?.trim() || "—";
  const studyYear = yearOfStudy(answers);

  return (
    <ProfilePageShell subtitle={pageSubtitle}>
      <div className={profilePageBody}>
        <header>
          <h2
            className={submitted ? profilePageTitleSubmitted : profilePageTitle}
          >
            {submitted ? "Your application is in" : "Your application"}
          </h2>
          <p
            className={
              submitted ? profilePageSubtitleSubmitted : profilePageSubtitle
            }
          >
            {submitted
              ? "Nothing left to do. We'll email you when decisions go out."
              : phase === "closed"
                ? APPLICATION_CLOSED_MESSAGE
                : phase === "upcoming"
                  ? APPLICATION_NOT_OPEN_MESSAGE
                  : "Start or finish your application before the deadline. Your progress is saved automatically."}
          </p>
        </header>

        <div className={profileOverviewGrid}>
          <aside className={profileOverviewPanel}>
            <dl className={profileFieldStack}>
              <ProfileField label="Name" value={name} emphasized={submitted} />
              <ProfileField
                label="School"
                value={school}
                emphasized={submitted}
              />
              <ProfileField
                label="Year of study"
                value={studyYear}
                emphasized={submitted}
              />
              {statusLabel ? (
                <ProfileField
                  label="Status"
                  value={statusLabel}
                  emphasized={submitted}
                />
              ) : null}
            </dl>

            {!submitted && phase === "open" ? (
              <div className="flex justify-start">
                <OdysseyButton
                  href="/register"
                  className={profileCompactButton}
                >
                  {registration ? "Continue application" : "Start application"}
                </OdysseyButton>
              </div>
            ) : null}
          </aside>

          <div className={profileOverviewTimelinePanel}>
            <ApplicantTimeline events={timeline} />
            {!registration ? (
              <p className={profileMetaText}>
                You haven&apos;t started an application yet.
              </p>
            ) : null}
          </div>
        </div>

        <SignOutButton
          className={profileSignOutWrap}
          buttonClassName={profileSignOutButton}
        />
      </div>
    </ProfilePageShell>
  );
}
