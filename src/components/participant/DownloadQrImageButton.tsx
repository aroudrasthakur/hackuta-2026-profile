import { useState, type RefObject } from "react";
import {
  CHECK_IN_QR_IMAGE_FILENAME,
  svgElementToPngBlob,
  triggerBlobDownload,
  type CheckInPassImageDetails,
} from "../../lib/qrImageDownload";

const GENERIC_QR_IMAGE_ERROR =
  "We could not save your QR image right now. Please screenshot the code above.";

function DownloadIcon() {
  return (
    <svg className="participant-qr-download__icon" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5v11.5m0 0 4.25-4.25M12 15 7.75 10.75"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5 19.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function DownloadQrImageButton({
  sourceRef,
  details,
}: {
  sourceRef: RefObject<HTMLElement | null>;
  details: CheckInPassImageDetails;
}) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleDownload() {
    if (loading) return;
    setLoading(true);
    setErrorMessage(null);

    try {
      await Promise.resolve();
      const svg = sourceRef.current?.querySelector("svg");
      if (!(svg instanceof SVGSVGElement)) {
        setErrorMessage(GENERIC_QR_IMAGE_ERROR);
        return;
      }
      const blob = await svgElementToPngBlob(svg, details);
      triggerBlobDownload(blob, CHECK_IN_QR_IMAGE_FILENAME);
    } catch {
      setErrorMessage(GENERIC_QR_IMAGE_ERROR);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="participant-qr-download">
      <button
        type="button"
        className="participant-qr-download__button"
        onClick={() => void handleDownload()}
        disabled={loading}
        aria-busy={loading}
        aria-label="Download QR image"
      >
        <DownloadIcon />
        <span className="participant-qr-download__copy">
          <span className="participant-qr-download__kicker">Download</span>
          <span className="participant-qr-download__label">QR image</span>
        </span>
      </button>
      {loading ? (
        <p className="participant-qr-download__status" role="status">
          Preparing image…
        </p>
      ) : null}
      {errorMessage ? (
        <p className="participant-qr-download__error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
