import QRCode from "react-qr-code";
import { Link, useOutletContext } from "react-router-dom";
import type { ParticipantDashboard } from "../../convex/api";
import { formatCheckInLong } from "./dashboardUtils";

function BadgeIcon() {
  return (
    <svg className="participant-checkin__reminder-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 3h6v4H9z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="5" y="7" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12.5" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.5 18c.8-1.3 2-2 3.5-2s2.7.7 3.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Checked-in state: animated confirmation card on every viewport; no QR or token. */
function CheckedInConfirmation({ checkedInAt }: { checkedInAt: number }) {
  return (
    <div className="participant-checkin">
      <section className="participant-checkin__card" role="status" aria-labelledby="participant-checkin-card-title">
        <div className="participant-checkin__badge" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path
              className="participant-checkin__tick"
              pathLength={1}
              d="M5 12.5 10 17.5 19 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span className="participant-dashboard__badge participant-dashboard__badge--accepted participant-checkin__rise">
          Checked in
        </span>
        <h1 id="participant-checkin-card-title" className="participant-checkin__title participant-checkin__rise">
          You&apos;re Checked In!
        </h1>
        <p className="participant-checkin__copy participant-checkin__rise">
          Your physical HackUTA badge is now your event pass. Use the QR code on your badge for meals, event
          points, and shop redemptions.
        </p>
        <p className="participant-checkin__time participant-checkin__rise">{formatCheckInLong(checkedInAt)}</p>
        <div className="participant-checkin__reminder participant-checkin__rise">
          <BadgeIcon />
          <p>
            <strong>Keep your badge with you.</strong> Lost it? Visit the check-in desk for a replacement. Your
            points, meals, and purchases carry over.
          </p>
        </div>
      </section>
    </div>
  );
}

export default function ParticipantScanPage() {
  const data = useOutletContext<ParticipantDashboard>();
  const participant = data.participant;

  if (participant?.status === "checked_in") {
    return (
      <section className="participant-scan participant-scan--fullpage" aria-label="Check-in">
        <CheckedInConfirmation checkedInAt={participant.checkedInAt} />
      </section>
    );
  }

  return (
    <section className="participant-scan participant-scan--fullpage" aria-labelledby="participant-scan-title">
      {participant ? (
        <>
          <span className="participant-dashboard__badge participant-dashboard__badge--pending">Not checked in yet</span>
          <h1 id="participant-scan-title" className="participant-page-title participant-scan__title">
            Check-in QR
          </h1>
          <p className="participant-page-lead participant-scan__lead">
            Show this code to a volunteer at the HackUTA check-in desk to pick up your badge.
          </p>
          <div className="participant-scan__frame">
            <QRCode
              value={participant.qrCodeToken}
              size={300}
              bgColor="#ffffff"
              fgColor="#1a3a52"
              aria-label="Participant check-in QR code"
            />
          </div>
          <p className="participant-scan__hint">
            This code is only for your first check-in. After that, your physical badge is your event pass. Keep it
            private.
          </p>
          {data.profile.email ? <p className="participant-scan__email">{data.profile.email}</p> : null}
        </>
      ) : (
        <>
          <h1 id="participant-scan-title" className="participant-page-title">
            Check-in QR
          </h1>
          <div className="participant-scan__empty">
            <p role="status">
              {data.reviewStatus === "accepted"
                ? "Your check-in code will appear here once your acceptance email has been released."
                : "Your QR code unlocks after you are accepted for the event."}
            </p>
            <Link to="/dashboard" className="participant-dashboard__link">
              Back to home
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
