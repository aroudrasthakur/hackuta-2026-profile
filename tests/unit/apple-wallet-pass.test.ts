import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAppleWalletManifest,
  buildAppleWalletPassJson,
  buildSignedAppleWalletPassBuffer,
  readAppleWalletCredentialsFromEnv,
  readPkpassZipArchive,
  renderHackutaPassPng,
  signManifestPkcs7Der,
} from "../../convex/profile/appleWalletPass";
import { formatAppleWalletSerialNumber } from "../../convex/profile/appleWalletPassData";
import {
  getRuntimeEcTestAppleWalletCredentials,
  getRuntimeTestAppleWalletCredentials,
} from "../helpers/appleWalletTestCerts";

const SAMPLE_QR_TOKEN = "a1b2c3d4".repeat(8);

describe("Apple Wallet pass builder and PKCS#7 signer", () => {
  it("formats a stable participant serial number without exposing the QR token", () => {
    const serial = formatAppleWalletSerialNumber("participant_123");
    expect(serial).toBe("hackuta-2026-participant_123");
    expect(serial).not.toContain(SAMPLE_QR_TOKEN);
  });

  it("reads credentials from plain, escaped-newline, and base64-encoded PEM env vars", () => {
    const creds = getRuntimeTestAppleWalletCredentials();

    expect(readAppleWalletCredentialsFromEnv({})).toBeNull();

    const fromEscaped = readAppleWalletCredentialsFromEnv({
      APPLE_PASS_TYPE_IDENTIFIER: " pass.org.hackuta.checkin ",
      APPLE_TEAM_IDENTIFIER: " HACKUTA26T ",
      APPLE_PASS_SIGNER_CERT_PEM: creds.signerCertPem.replace(/\n/g, "\\n"),
      APPLE_PASS_SIGNER_KEY_PEM: Buffer.from(creds.signerKeyPem, "utf8").toString("base64"),
      APPLE_PASS_SIGNER_KEY_PASSPHRASE: " secret-pass ",
      APPLE_WWDR_CERT_PEM: creds.wwdrCertPem,
    });

    expect(fromEscaped).toEqual({
      passTypeIdentifier: "pass.org.hackuta.checkin",
      teamIdentifier: "HACKUTA26T",
      signerCertPem: creds.signerCertPem.trim(),
      signerKeyPem: creds.signerKeyPem.trim(),
      signerKeyPassphrase: "secret-pass",
      wwdrCertPem: creds.wwdrCertPem.trim(),
    });
  });

  it("builds pass.json with PassKit required fields and the existing registration QR token", () => {
    const passJson = buildAppleWalletPassJson(
      {
        serialNumber: "hackuta-2026-p1",
        displayName: "Taylor Maverick",
        email: "taylor@mavs.uta.edu",
        qrCodeToken: SAMPLE_QR_TOKEN,
        hackathonName: "HackUTA 2026",
        startsAt: Date.parse("2026-11-14T09:00:00-06:00"),
        endsAt: Date.parse("2026-11-15T18:00:00-06:00"),
      },
      {
        passTypeIdentifier: "pass.org.hackuta.checkin",
        teamIdentifier: "HACKUTA26T",
      },
    );

    expect(passJson.formatVersion).toBe(1);
    expect(passJson.passTypeIdentifier).toBe("pass.org.hackuta.checkin");
    expect(passJson.teamIdentifier).toBe("HACKUTA26T");
    expect(passJson.serialNumber).toBe("hackuta-2026-p1");
    expect(passJson.organizationName).toBe("HackUTA");
    expect(passJson.sharingProhibited).toBe(true);
    expect(passJson.groupingIdentifier).toBe("hackuta-2026-checkin");
    expect(passJson.semantics.eventName).toBe("HackUTA 2026");
    expect(passJson.locations).toHaveLength(1);
    expect(passJson.barcodes).toEqual([
      {
        format: "PKBarcodeFormatQR",
        message: SAMPLE_QR_TOKEN,
        messageEncoding: "iso-8859-1",
        altText: "Check-in QR · Valid until badge pickup",
      },
    ]);
    expect(passJson.barcode.message).toBe(SAMPLE_QR_TOKEN);
    expect(passJson.eventTicket.primaryFields[0]?.value).toBe("HackUTA 2026");
    expect(passJson.eventTicket.secondaryFields[0]?.value).toBe("Taylor Maverick");

    const sameDayPass = buildAppleWalletPassJson(
      {
        serialNumber: "hackuta-2026-p2",
        displayName: "Jordan",
        email: null,
        qrCodeToken: SAMPLE_QR_TOKEN,
        hackathonName: "HackUTA 2026",
        startsAt: Date.parse("2026-11-14T09:00:00-06:00"),
        endsAt: Date.parse("2026-11-14T18:00:00-06:00"),
      },
      {
        passTypeIdentifier: "pass.org.hackuta.checkin",
        teamIdentifier: "HACKUTA26T",
      },
    );
    expect(sameDayPass.eventTicket.auxiliaryFields[0]?.value).toBe("Nov 14, 2026");
    expect(sameDayPass.eventTicket.backFields).toHaveLength(1);
  });

  it("renders valid PNG buffers for PassKit icon and logo assets", () => {
    const png = renderHackutaPassPng(29, 29);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(29);
    expect(png.readUInt32BE(20)).toBe(29);
  });

  it("packages a valid .pkpass ZIP whose SHA-1 manifest and PKCS#7 DER signature verify with OpenSSL", () => {
    const creds = getRuntimeTestAppleWalletCredentials();
    const pkpass = buildSignedAppleWalletPassBuffer(
      {
        serialNumber: "hackuta-2026-p1",
        displayName: "Taylor Maverick",
        email: "taylor@mavs.uta.edu",
        qrCodeToken: SAMPLE_QR_TOKEN,
        hackathonName: "HackUTA 2026",
        startsAt: Date.parse("2026-11-14T09:00:00-06:00"),
        endsAt: Date.parse("2026-11-15T18:00:00-06:00"),
      },
      creds,
    );

    const entries = readPkpassZipArchive(pkpass);
    expect(Object.keys(entries).sort()).toEqual([
      "icon.png",
      "icon@2x.png",
      "icon@3x.png",
      "logo.png",
      "logo@2x.png",
      "logo@3x.png",
      "manifest.json",
      "pass.json",
      "signature",
    ]);

    const manifest = JSON.parse(entries["manifest.json"]!.toString("utf8")) as Record<
      string,
      string
    >;
    for (const [name, expectedSha1] of Object.entries(manifest)) {
      const actualSha1 = createHash("sha1").update(entries[name]!).digest("hex");
      expect(actualSha1).toBe(expectedSha1);
    }

    const parsedPass = JSON.parse(entries["pass.json"]!.toString("utf8")) as {
      barcodes: Array<{ message: string }>;
    };
    expect(parsedPass.barcodes[0]?.message).toBe(SAMPLE_QR_TOKEN);

    // Verify the detached DER CMS / PKCS#7 signature with OpenSSL
    const tempDir = mkdtempSync(join(tmpdir(), "hackuta-pkpass-test-"));
    try {
      const manifestPath = join(tempDir, "manifest.json");
      const signaturePath = join(tempDir, "signature");
      const caPath = join(tempDir, "ca.pem");
      writeFileSync(manifestPath, entries["manifest.json"]!);
      writeFileSync(signaturePath, entries["signature"]!);
      writeFileSync(caPath, creds.wwdrCertPem);

      const output = execFileSync(
        "openssl",
        [
          "cms",
          "-verify",
          "-binary",
          "-inform",
          "DER",
          "-in",
          signaturePath,
          "-content",
          manifestPath,
          "-CAfile",
          caPath,
          "-purpose",
          "any",
          "-out",
          "/dev/null",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(output).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("supports ECDSA keys when signing PKCS#7 manifests", () => {
    const ecCreds = getRuntimeEcTestAppleWalletCredentials();
    const manifestObj = buildAppleWalletManifest({
      "pass.json": Buffer.from('{"formatVersion":1}', "utf8"),
    });
    const manifestBytes = Buffer.from(JSON.stringify(manifestObj), "utf8");
    const sigDer = signManifestPkcs7Der(manifestBytes, ecCreds);
    expect(sigDer[0]).toBe(0x30);
    expect(sigDer.length).toBeGreaterThan(200);
  });
});
