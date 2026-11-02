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

/** Official US/UK RGB badge from Apple’s Add to Apple Wallet artwork pack. */
const APPLE_WALLET_BADGE_SRC = "/images/apple/US-UK_Add_to_Apple_Wallet_RGB_101421.svg";

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
        <img
          className="participant-wallet__badge"
          src={APPLE_WALLET_BADGE_SRC}
          alt=""
          width={177}
          height={56}
        />
      </button>
      {loading ? (
        <p className="participant-wallet__status" role="status">
          Preparing pass…
        </p>
      ) : null}
      {errorMessage ? (
        <p className="participant-wallet__error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
