import { Link } from "react-router-dom";
import { ResumePreviewDialog } from "../../components/resume/ResumePreviewDialog";
import { useQuery } from "../../convex/reactBindings";
import { getMySubmittedApplicationRef } from "../../convex/api";
import { getConvexClient } from "../../convex/client";
import { useMockAuth } from "../../hooks/useMockAuth";

export default function ParticipantApplicationPage() {
  const mockAuth = useMockAuth();
  const client = getConvexClient();
  const submission = useQuery(
    getMySubmittedApplicationRef,
    client && !mockAuth.enabled ? {} : "skip",
  );

  if (!mockAuth.enabled && submission === undefined) {
    return (
      <div className="participant-application participant-application--loading">
        <p role="status">Loading your submission…</p>
      </div>
    );
  }

  const data = mockAuth.enabled
    ? {
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
      }
    : submission;

  if (!data) {
    return (
      <div className="participant-application participant-application--loading">
        <p role="status">We could not find a submitted application.</p>
        <Link to="/dashboard" className="participant-dashboard__link">
          Back to home
        </Link>
      </div>
    );
  }

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

      {data.sections.map((section) => (
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
      ))}

      <ResumePreviewDialog resume={data.resume} variant="panel" />
    </section>
  );
}
