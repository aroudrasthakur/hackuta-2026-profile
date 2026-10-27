import QRCode from "react-qr-code";
import { Link, useOutletContext } from "react-router-dom";
import type { ParticipantDashboard } from "../../convex/api";

export default function ParticipantScanPage() {
  const data = useOutletContext<ParticipantDashboard>();

  return (
    <section className="participant-scan participant-scan--fullpage" aria-labelledby="participant-scan-title">
      <h1 id="participant-scan-title" className="participant-page-title">QR Code</h1>
      <p className="participant-page-lead">Show this at check-in, meals, and events.</p>

      {data.participant && data.participant.qrCodeToken === null ? (
        <div className="participant-scan__empty">
          <p role="status">
            You're checked in. Use the QR code on your HackUTA badge for meals, events, and the shop. This
            registration code no longer works.
          </p>
          <Link to="/dashboard" className="participant-dashboard__link">
            Back to home
          </Link>
        </div>
      ) : data.participant?.qrCodeToken ? (
        <>
          <div className="participant-scan__frame">
            <QRCode
              value={data.participant.qrCodeToken}
              size={360}
              bgColor="#ffffff"
              fgColor="#1a3a52"
              aria-label="Participant check-in QR code"
            />
          </div>
          <p className="participant-scan__hint">Keep this code private. Show it only to HackUTA staff.</p>
          {data.profile.email ? (
            <p className="participant-scan__email">{data.profile.email}</p>
          ) : null}
        </>
      ) : (
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
      )}
    </section>
  );
}
