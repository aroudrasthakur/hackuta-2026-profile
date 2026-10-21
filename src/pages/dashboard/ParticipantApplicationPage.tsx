import { Link, useOutletContext } from "react-router-dom";
import { ResumePreviewDialog } from "../../components/resume/ResumePreviewDialog";
import type { ParticipantDashboard } from "../../convex/api";
import { useMockAuth } from "../../hooks/useMockAuth";

const MOCK_SUBMISSION = {
  sections: [
    {
      title: "Personal Information",
      rows: [
        { label: "First name", value: "Sam" },
        { label: "Last name", value: "Test" },
      ],
    },
  ],
  resume: { status: "none" as const, url: null, filename: null },
};

export default function ParticipantApplicationPage() {
  const dashboard = useOutletContext<ParticipantDashboard>();
  const mockAuth = useMockAuth();

  const data = mockAuth.enabled ? MOCK_SUBMISSION : dashboard.submittedApplication;

  if (!dashboard.application?.submitted) {
    return (
      <div className="participant-application participant-application--empty">
        <p role="status">You have not submitted an application yet.</p>
        <Link to="/dashboard" className="participant-dashboard__link">
          Back to home
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="participant-application participant-application--empty">
        <p role="status">We could not load your submission. Refresh the page or try again in a moment.</p>
        <Link to="/dashboard" className="participant-dashboard__link">
          Back to home
        </Link>
      </div>
    );
  }

  const sections = data.sections ?? [];

  return (
    <section className="participant-application" aria-labelledby="participant-application-title">
      <header className="participant-application__head">
        <Link to="/dashboard" className="participant-application__back">
          ← Back
        </Link>
        <h1 id="participant-application-title" className="participant-page-title">
          Your submission
        </h1>
      </header>

      {sections.length === 0 ? (
        <p className="participant-application__empty" role="status">
          Your application was submitted, but no answers are available to display yet.
        </p>
      ) : (
        sections.map((section) => (
          <div key={section.title} className="participant-application__section">
            <h2 className="participant-application__section-title">{section.title}</h2>
            <dl className="participant-application__rows">
              {section.rows.map((row) => (
                <div key={`${section.title}-${row.label}`} className="participant-application__row">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))
      )}

      <ResumePreviewDialog resume={data.resume} variant="panel" />
    </section>
  );
}
