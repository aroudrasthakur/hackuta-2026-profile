import { useState } from "react";
import {
  generateMyAppleWalletPassRef,
  type AppleWalletPassResponse,
} from "../../convex/api";
import { getConvexClient } from "../../convex/client";
import { useMockAuth } from "../../hooks/useMockAuth";

const APPLE_WALLET_MIME = "application/vnd.apple.pkpass";
const DEFAULT_PASS_FILENAME = "hackuta-2026-checkin.pkpass";
const GENERIC_WALLET_ERROR =
  "We could not generate your Apple Wallet pass right now. Please try again or use the QR code above.";

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /(iPhone|iPad|iPod)/i.test(navigator.userAgent);
}

function triggerPassDownload(result: Extract<AppleWalletPassResponse, { ok: true }>) {
  if (result.passUrl && isIosDevice()) {
    window.location.assign(result.passUrl);
    return;
  }

  const bytes = base64ToUint8Array(result.pkpassBase64);
  const blob = new Blob([ Uint8Array.from(bytes) ], { type: APPLE_WALLET_MIME });
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = result.filename || DEFAULT_PASS_FILENAME;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5_000);
}

function buildMockPassResponse(checkedIn: boolean): AppleWalletPassResponse {
  if (checkedIn) {
    return {
      ok: false,
      code: "already_checked_in",
      message: "You have already checked in. Your physical HackUTA badge is now your event pass.",
    };
  }
  const mockPayload = JSON.stringify({
    formatVersion: 1,
    organizationName: "HackUTA",
    description: "HackUTA 2026 Check-in Pass",
    serialNumber: "hackuta-2026-mock-participant",
  });
  return {
    ok: true,
    passUrl: null,
    pkpassBase64: btoa(mockPayload),
    filename: DEFAULT_PASS_FILENAME,
    serialNumber: "hackuta-2026-mock-participant",
  };
}

function AppleWalletGlyph() {
  return (
    <svg
      className="participant-wallet__icon"
      width="28"
      height="22"
      viewBox="0 0 28 22"
      fill="none"
      aria-hidden="true"
    >
      <rect x="0.75" y="0.75" width="26.5" height="20.5" rx="3.75" fill="#1C1C1E" stroke="#3A3A3C" strokeWidth="1.2" />
      <rect x="3" y="3" width="22" height="5" rx="1.5" fill="#305873" />
      <rect x="3" y="6.2" width="22" height="5" rx="1.5" fill="#E5A93C" />
      <rect x="3" y="9.4" width="22" height="5" rx="1.5" fill="#469B72" />
      <path
        d="M2.2 12.2H9.6C10.5 12.2 11.2 12.7 11.7 13.4C12.3 14.3 13.1 14.8 14 14.8C14.9 14.8 15.7 14.3 16.3 13.4C16.8 12.7 17.5 12.2 18.4 12.2H25.8V18.2C25.8 19.3 24.9 20.2 23.8 20.2H4.2C3.1 20.2 2.2 19.3 2.2 18.2V12.2Z"
        fill="#EDEAE2"
      />
    </svg>
  );
}

export function AddToAppleWalletButton() {
  const mockAuth = useMockAuth();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleAddToWallet() {
    if (loading) return;
    setLoading(true);
    setErrorMessage(null);

    try {
      let result: AppleWalletPassResponse;
      if (mockAuth.enabled) {
        result = buildMockPassResponse(mockAuth.participantCheckedIn);
      } else {
        const client = getConvexClient();
        if (!client) {
          setErrorMessage(GENERIC_WALLET_ERROR);
          return;
        }
        result = await client.action(generateMyAppleWalletPassRef, {});
      }

      if (!result.ok) {
        setErrorMessage(result.message || GENERIC_WALLET_ERROR);
        return;
      }

      triggerPassDownload(result);
    } catch {
      setErrorMessage(GENERIC_WALLET_ERROR);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="participant-wallet">
      <button
        type="button"
        className="participant-wallet__button"
        onClick={() => void handleAddToWallet()}
        disabled={loading}
        aria-busy={loading}
        aria-label="Add to Apple Wallet"
      >
        <AppleWalletGlyph />
        <span className="participant-wallet__copy">
          <span className="participant-wallet__kicker">
            {loading ? "Preparing pass…" : "Add to"}
          </span>
          <span className="participant-wallet__label">Apple Wallet</span>
        </span>
      </button>
      {errorMessage ? (
        <p className="participant-wallet__error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
