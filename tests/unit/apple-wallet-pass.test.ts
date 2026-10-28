import { describe, expect, it } from "vitest";
import {
  readWalletServiceConfigFromEnv,
  toWalletServicePassRequest,
} from "../../convex/profile/appleWalletPass";
import { formatAppleWalletSerialNumber } from "../../convex/profile/appleWalletPassData";

const SAMPLE_QR_TOKEN = "a1b2c3d4".repeat(8);
const VALID_API_KEY = "wallet-service-api-key-32-chars-min";

describe("Apple Wallet wallet-service client", () => {
  it("formats a stable participant serial number without exposing the QR token", () => {
    const serial = formatAppleWalletSerialNumber("participant_123");
    expect(serial).toBe("hackuta-2026-participant_123");
    expect(serial).not.toContain(SAMPLE_QR_TOKEN);
  });

  it("reads a trimmed wallet-service URL and API key from env", () => {
    expect(readWalletServiceConfigFromEnv({})).toBeNull();
    expect(
      readWalletServiceConfigFromEnv({
        WALLET_SERVICE_URL: "https://wallet.example.com",
      }),
    ).toBeNull();
    expect(
      readWalletServiceConfigFromEnv({
        WALLET_SERVICE_URL: "https://wallet.example.com",
        WALLET_SERVICE_API_KEY: "too-short",
      }),
    ).toBeNull();
    expect(
      readWalletServiceConfigFromEnv({
        WALLET_SERVICE_URL: "ftp://wallet.example.com",
        WALLET_SERVICE_API_KEY: VALID_API_KEY,
      }),
    ).toBeNull();

    expect(
      readWalletServiceConfigFromEnv({
        WALLET_SERVICE_URL: " https://wallet.example.com/ ",
        WALLET_SERVICE_API_KEY: ` ${VALID_API_KEY} `,
      }),
    ).toEqual({
      baseUrl: "https://wallet.example.com",
      apiKey: VALID_API_KEY,
    });
  });

  it("maps eligibility data to the wallet-service request body", () => {
    expect(
      toWalletServicePassRequest({
        serialNumber: "hackuta-2026-p1",
        displayName: "  Taylor Maverick  ",
        qrCodeToken: SAMPLE_QR_TOKEN,
      }),
    ).toEqual({
      serialNumber: "hackuta-2026-p1",
      attendeeName: "Taylor Maverick",
      qrToken: SAMPLE_QR_TOKEN,
    });

    const longName = "A".repeat(120);
    expect(
      toWalletServicePassRequest({
        serialNumber: "hackuta-2026-p2",
        displayName: longName,
        qrCodeToken: SAMPLE_QR_TOKEN,
      }).attendeeName,
    ).toBe("A".repeat(80));

    expect(
      toWalletServicePassRequest({
        serialNumber: "hackuta-2026-p3",
        displayName: "   ",
        qrCodeToken: SAMPLE_QR_TOKEN,
      }).attendeeName,
    ).toBe("Participant");
  });
});
