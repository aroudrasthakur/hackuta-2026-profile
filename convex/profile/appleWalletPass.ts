"use node";

import { createHash, createPrivateKey, sign as cryptoSign, X509Certificate } from "node:crypto";
import { deflateRawSync, deflateSync, inflateRawSync } from "node:zlib";
import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { action } from "../_generated/server";
import type {
  AppleWalletPassDataInput,
  AppleWalletPassLookupResult,
} from "./appleWalletPassData";

export const APPLE_WALLET_PASS_MIME_TYPE = "application/vnd.apple.pkpass";
export const APPLE_WALLET_PASS_FILENAME = "hackuta-2026-checkin.pkpass";
const PASS_STORAGE_TTL_MS = 60_000;

export type AppleWalletSigningCredentials = {
  passTypeIdentifier: string;
  teamIdentifier: string;
  signerCertPem: string;
  signerKeyPem: string;
  signerKeyPassphrase?: string;
  wwdrCertPem: string;
};

export type GenerateAppleWalletPassResult =
  | {
      ok: true;
      passUrl: string | null;
      pkpassBase64: string;
      filename: string;
      serialNumber: string;
    }
  | {
      ok: false;
      code:
        | "unauthenticated"
        | "not_eligible"
        | "already_checked_in"
        | "not_configured"
        | "signing_failed";
      message: string;
    };

const getMyAppleWalletPassInputRef = makeFunctionReference<
  "query",
  Record<string, never>,
  AppleWalletPassLookupResult
>("profile/appleWalletPassData:getMyAppleWalletPassInput");

const deleteAppleWalletPassFileRef = makeFunctionReference<
  "mutation",
  { storageId: GenericId<"_storage"> },
  null
>("profile/appleWalletPassData:deleteAppleWalletPassFile");

function decodePemEnvValue(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";
  const unescaped = trimmed.replace(/\\n/g, "\n").trim();
  if (unescaped.includes("-----BEGIN ")) {
    return unescaped;
  }
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8").trim();
    if (decoded.includes("-----BEGIN ")) {
      return decoded;
    }
  } catch {
    // Fall through if not valid base64.
  }
  return unescaped;
}

/** Reads Apple PassKit signing credentials from server-side environment variables. */
export function readAppleWalletCredentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AppleWalletSigningCredentials | null {
  const passTypeIdentifier = env.APPLE_PASS_TYPE_IDENTIFIER?.trim() ?? "";
  const teamIdentifier = env.APPLE_TEAM_IDENTIFIER?.trim() ?? "";
  const signerCertPem = decodePemEnvValue(env.APPLE_PASS_SIGNER_CERT_PEM);
  const signerKeyPem = decodePemEnvValue(env.APPLE_PASS_SIGNER_KEY_PEM);
  const wwdrCertPem = decodePemEnvValue(env.APPLE_WWDR_CERT_PEM);
  const signerKeyPassphrase = env.APPLE_PASS_SIGNER_KEY_PASSPHRASE?.trim() || undefined;

  if (
    !passTypeIdentifier ||
    !teamIdentifier ||
    !signerCertPem ||
    !signerKeyPem ||
    !wwdrCertPem
  ) {
    return null;
  }

  return {
    passTypeIdentifier,
    teamIdentifier,
    signerCertPem,
    signerKeyPem,
    ...(signerKeyPassphrase ? { signerKeyPassphrase } : {}),
    wwdrCertPem,
  };
}

function formatPassEventWindow(startsAt: number, endsAt: number): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Chicago",
  });
  const startLabel = formatter.format(new Date(startsAt));
  const endLabel = formatter.format(new Date(endsAt));
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
}

/** Builds the Apple Wallet `pass.json` payload for pre-check-in registration. */
export function buildAppleWalletPassJson(
  input: AppleWalletPassDataInput,
  credentials: Pick<AppleWalletSigningCredentials, "passTypeIdentifier" | "teamIdentifier">,
) {
  const relevantDate = new Date(input.startsAt).toISOString();
  const expirationDate = new Date(input.endsAt).toISOString();
  const barcodePayload = {
    format: "PKBarcodeFormatQR" as const,
    message: input.qrCodeToken,
    messageEncoding: "iso-8859-1" as const,
    altText: "Check-in QR · Valid until badge pickup",
  };

  return {
    formatVersion: 1 as const,
    passTypeIdentifier: credentials.passTypeIdentifier,
    teamIdentifier: credentials.teamIdentifier,
    serialNumber: input.serialNumber,
    organizationName: "HackUTA",
    description: `${input.hackathonName} Check-in Pass`,
    logoText: "HackUTA",
    backgroundColor: "rgb(16, 47, 70)",
    foregroundColor: "rgb(246, 237, 223)",
    labelColor: "rgb(140, 161, 170)",
    relevantDate,
    expirationDate,
    barcodes: [barcodePayload],
    barcode: barcodePayload,
    eventTicket: {
      headerFields: [
        {
          key: "pass_stage",
          label: "STAGE",
          value: "CHECK-IN",
        },
      ],
      primaryFields: [
        {
          key: "event_name",
          label: "EVENT",
          value: input.hackathonName,
        },
      ],
      secondaryFields: [
        {
          key: "participant_name",
          label: "PARTICIPANT",
          value: input.displayName,
        },
        {
          key: "pass_status",
          label: "STATUS",
          value: "Pre-Check-In Only",
        },
      ],
      auxiliaryFields: [
        {
          key: "event_dates",
          label: "DATES",
          value: formatPassEventWindow(input.startsAt, input.endsAt),
        },
        {
          key: "badge_notice",
          label: "VALIDITY",
          value: "Replaced by physical badge at check-in",
        },
      ],
      backFields: [
        {
          key: "instructions",
          label: "Check-in Instructions",
          value:
            "Present this QR code to a volunteer at the HackUTA check-in desk to pick up your physical badge. Once your badge is assigned, this registration QR code is permanently retired and your physical badge becomes your event pass for meals, points, and the shop.",
        },
        ...(input.email
          ? [
              {
                key: "participant_email",
                label: "Registered Email",
                value: input.email,
              },
            ]
          : []),
      ],
    },
  };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, Buffer.from(data)]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lengthBuf, crcInput, crcBuf]);
}

/**
 * Generates a valid RGBA PNG buffer with the HackUTA Odyssey navy background
 * and cream emblem so Apple Wallet pass validation succeeds on iOS and macOS.
 */
export function renderHackutaPassPng(width: number, height: number): Buffer {
  const rawScanlines = Buffer.alloc((width * 4 + 1) * height);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const radius = Math.min(width, height) * 0.34;
  const innerRadius = radius * 0.58;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    rawScanlines[rowOffset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.hypot(dx, dy);
      const isRing = dist <= radius && dist >= innerRadius;
      const isCrossbar =
        Math.abs(dy) <= Math.max(1.2, height * 0.06) &&
        Math.abs(dx) <= innerRadius * 0.85;

      if (isRing || isCrossbar) {
        // Cream (#f6eddf)
        rawScanlines[pixelOffset] = 246;
        rawScanlines[pixelOffset + 1] = 237;
        rawScanlines[pixelOffset + 2] = 223;
        rawScanlines[pixelOffset + 3] = 255;
      } else {
        // HackUTA Night (#102f46)
        rawScanlines[pixelOffset] = 16;
        rawScanlines[pixelOffset + 1] = 47;
        rawScanlines[pixelOffset + 2] = 70;
        rawScanlines[pixelOffset + 3] = 255;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth 8
  ihdr[9] = 6; // Color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const compressed = deflateSync(rawScanlines);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

const PASS_STATIC_IMAGES: Readonly<Record<string, Buffer>> = {
  "icon.png": renderHackutaPassPng(29, 29),
  "icon@2x.png": renderHackutaPassPng(58, 58),
  "logo.png": renderHackutaPassPng(160, 50),
  "logo@2x.png": renderHackutaPassPng(320, 100),
};

// --- ASN.1 DER helpers for CMS / PKCS#7 detached signature ---

function derLength(length: number): Buffer {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derNode(tag: number, content: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), Buffer.from(content)]);
}

function derSequence(items: Uint8Array[]): Buffer {
  return derNode(0x30, Buffer.concat(items.map((item) => Buffer.from(item))));
}

function derSet(items: Uint8Array[]): Buffer {
  return derNode(0x31, Buffer.concat(items.map((item) => Buffer.from(item))));
}

function derOctetString(bytes: Uint8Array): Buffer {
  return derNode(0x04, bytes);
}

function derNull(): Buffer {
  return Buffer.from([0x05, 0x00]);
}

function derIntegerSmall(value: number): Buffer {
  return Buffer.from([0x02, 0x01, value & 0xff]);
}

function derOid(oid: string): Buffer {
  const parts = oid.split(".").map((n) => Number.parseInt(n, 10));
  const first = parts[0]! * 40 + parts[1]!;
  const body: number[] = [first];
  for (let i = 2; i < parts.length; i += 1) {
    let value = parts[i]!;
    const sub: number[] = [value & 0x7f];
    value >>>= 7;
    while (value > 0) {
      sub.unshift((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    body.push(...sub);
  }
  return derNode(0x06, Uint8Array.from(body));
}

function derUtcTime(date: Date): Buffer {
  const yy = String(date.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return derNode(0x17, Buffer.from(`${yy}${mm}${dd}${hh}${min}${ss}Z`, "ascii"));
}

function readDerElement(buffer: Buffer, offset: number) {
  const tag = buffer[offset]!;
  const firstLen = buffer[offset + 1]!;
  let length = 0;
  let headerLength = 2;
  if ((firstLen & 0x80) === 0) {
    length = firstLen;
  } else {
    const numBytes = firstLen & 0x7f;
    headerLength = 2 + numBytes;
    for (let i = 0; i < numBytes; i += 1) {
      length = (length << 8) | buffer[offset + 2 + i]!;
    }
  }
  const totalLength = headerLength + length;
  return {
    tag,
    headerLength,
    length,
    totalLength,
    tlv: buffer.subarray(offset, offset + totalLength),
    contentOffset: offset + headerLength,
  };
}

/** Extracts the raw DER `issuer` Name TLV and `serialNumber` INTEGER TLV from an X.509 certificate. */
function extractIssuerAndSerialNumberDer(certDer: Buffer): {
  issuerTlv: Buffer;
  serialNumberTlv: Buffer;
} {
  const certSeq = readDerElement(certDer, 0);
  const tbsSeq = readDerElement(certDer, certSeq.contentOffset);
  let cursor = tbsSeq.contentOffset;
  const firstField = readDerElement(certDer, cursor);
  // Optional [0] EXPLICIT Version field in v2/v3 certificates
  if (firstField.tag === 0xa0) {
    cursor += firstField.totalLength;
  }
  const serialElement = readDerElement(certDer, cursor);
  cursor += serialElement.totalLength;
  const sigAlgElement = readDerElement(certDer, cursor);
  cursor += sigAlgElement.totalLength;
  const issuerElement = readDerElement(certDer, cursor);

  return {
    issuerTlv: Buffer.from(issuerElement.tlv),
    serialNumberTlv: Buffer.from(serialElement.tlv),
  };
}

/**
 * Creates a detached DER-encoded PKCS#7 / CMS `SignedData` signature over `manifestBytes`
 * using the Apple Pass Type ID certificate, private key, and Apple WWDR intermediate certificate.
 */
export function signManifestPkcs7Der(
  manifestBytes: Uint8Array,
  credentials: AppleWalletSigningCredentials,
  signingDate: Date = new Date(),
): Buffer {
  const signerCert = new X509Certificate(credentials.signerCertPem);
  const wwdrCert = new X509Certificate(credentials.wwdrCertPem);
  const privateKey = createPrivateKey({
    key: credentials.signerKeyPem,
    ...(credentials.signerKeyPassphrase
      ? { passphrase: credentials.signerKeyPassphrase }
      : {}),
  });

  const manifestSha256 = createHash("sha256").update(manifestBytes).digest();

  // OIDs
  const oidSignedData = derOid("1.2.840.113549.1.7.2");
  const oidData = derOid("1.2.840.113549.1.7.1");
  const oidSha256 = derOid("2.16.840.1.101.3.4.2.1");
  const oidContentType = derOid("1.2.840.113549.1.9.3");
  const oidSigningTime = derOid("1.2.840.113549.1.9.5");
  const oidMessageDigest = derOid("1.2.840.113549.1.9.4");

  const sha256AlgId = derSequence([oidSha256, derNull()]);

  const attrContentType = derSequence([oidContentType, derSet([oidData])]);
  const attrSigningTime = derSequence([
    oidSigningTime,
    derSet([derUtcTime(signingDate)]),
  ]);
  const attrMessageDigest = derSequence([
    oidMessageDigest,
    derSet([derOctetString(manifestSha256)]),
  ]);

  // DER SET OF sorting rule (X.690 §11.6): sort attributes ascending by encoded bytes.
  const sortedAttrs = [attrContentType, attrSigningTime, attrMessageDigest].sort(
    Buffer.compare,
  );
  const signedAttrsBody = Buffer.concat(sortedAttrs);

  // RFC 5652 §5.4: sign over universal SET (0x31), encode in SignerInfo as [0] IMPLICIT (0xa0).
  const signedAttrsForDigest = derNode(0x31, signedAttrsBody);
  const signedAttrsImplicit = derNode(0xa0, signedAttrsBody);

  const signatureBytes = cryptoSign("sha256", signedAttrsForDigest, privateKey);
  const signatureAlgorithmId =
    privateKey.asymmetricKeyType === "ec"
      ? derSequence([derOid("1.2.840.10045.4.3.2")]) // ecdsa-with-SHA256
      : derSequence([derOid("1.2.840.113549.1.1.1"), derNull()]); // rsaEncryption

  const { issuerTlv, serialNumberTlv } = extractIssuerAndSerialNumberDer(signerCert.raw);
  const issuerAndSerialNumber = derSequence([issuerTlv, serialNumberTlv]);

  const signerInfo = derSequence([
    derIntegerSmall(1),
    issuerAndSerialNumber,
    sha256AlgId,
    signedAttrsImplicit,
    signatureAlgorithmId,
    derOctetString(signatureBytes),
  ]);

  const certificatesImplicit = derNode(
    0xa0,
    Buffer.concat([signerCert.raw, wwdrCert.raw]),
  );

  const signedData = derSequence([
    derIntegerSmall(1),
    derSet([sha256AlgId]),
    derSequence([oidData]),
    certificatesImplicit,
    derSet([signerInfo]),
  ]);

  return derSequence([oidSignedData, derNode(0xa0, signedData)]);
}

/** Computes the Apple Wallet `manifest.json` map (SHA-1 hex per bundled filename). */
export function buildAppleWalletManifest(files: Readonly<Record<string, Uint8Array>>) {
  const manifest: Record<string, string> = {};
  for (const name of Object.keys(files).sort()) {
    manifest[name] = createHash("sha1").update(files[name]!).digest("hex");
  }
  return manifest;
}

/** Packs a flat dictionary of files into a standard ZIP archive buffer (`.pkpass`). */
export function createPkpassZipArchive(files: Readonly<Record<string, Uint8Array>>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const name of Object.keys(files).sort()) {
    const nameBytes = Buffer.from(name, "utf8");
    const uncompressed = Buffer.from(files[name]!);
    const compressed = deflateRawSync(uncompressed);
    const fileCrc = crc32(uncompressed);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0, 6); // General purpose bit flag
    localHeader.writeUInt16LE(8, 8); // Compression method: Deflate (8)
    localHeader.writeUInt16LE(0, 10); // Last mod file time
    localHeader.writeUInt16LE(0x595b, 12); // Last mod file date
    localHeader.writeUInt32LE(fileCrc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localRecord = Buffer.concat([localHeader, nameBytes, compressed]);
    localParts.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory file header signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed to extract
    centralHeader.writeUInt16LE(0, 8); // General purpose bit flag
    centralHeader.writeUInt16LE(8, 10); // Compression method: Deflate (8)
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x595b, 14);
    centralHeader.writeUInt32LE(fileCrc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(Buffer.concat([centralHeader, nameBytes]));
    offset += localRecord.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const entryCount = centralParts.length;
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entryCount, 8);
  endOfCentralDirectory.writeUInt16LE(entryCount, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

/** Extracts all entries from a `.pkpass` ZIP archive buffer (used by tests & verification). */
export function readPkpassZipArchive(zipBuffer: Uint8Array): Record<string, Buffer> {
  const buf = Buffer.from(zipBuffer);
  const files: Record<string, Buffer> = {};
  let offset = 0;

  while (offset + 4 <= buf.length) {
    const signature = buf.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      break;
    }
    const method = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString("utf8");
    const rawData = buf.subarray(dataStart, dataStart + compressedSize);
    files[name] = method === 8 ? inflateRawSync(rawData) : Buffer.from(rawData);
    offset = dataStart + compressedSize;
  }

  return files;
}

/** Builds and cryptographically signs a complete `.pkpass` archive in memory. */
export function buildSignedAppleWalletPassBuffer(
  input: AppleWalletPassDataInput,
  credentials: AppleWalletSigningCredentials,
): Buffer {
  const passJsonObj = buildAppleWalletPassJson(input, credentials);
  const passJsonBytes = Buffer.from(JSON.stringify(passJsonObj, null, 2), "utf8");

  const payloadFiles: Record<string, Buffer> = {
    ...PASS_STATIC_IMAGES,
    "pass.json": passJsonBytes,
  };

  const manifestObj = buildAppleWalletManifest(payloadFiles);
  const manifestBytes = Buffer.from(JSON.stringify(manifestObj, null, 2), "utf8");
  const signatureBytes = signManifestPkcs7Der(manifestBytes, credentials);

  return createPkpassZipArchive({
    ...payloadFiles,
    "manifest.json": manifestBytes,
    signature: signatureBytes,
  });
}

/**
 * Generates a signed Apple Wallet `.pkpass` for the authenticated, accepted,
 * pre-check-in participant. Never exposes signing keys or logs raw QR tokens.
 */
export const generateMyAppleWalletPass = action({
  args: {},
  handler: async (ctx): Promise<GenerateAppleWalletPassResult> => {
    const lookup = await ctx.runQuery(getMyAppleWalletPassInputRef, {});

    if (lookup.status === "unauthenticated") {
      return {
        ok: false,
        code: "unauthenticated",
        message: "Sign in to add your check-in pass to Apple Wallet.",
      };
    }

    if (lookup.status === "already_checked_in") {
      return {
        ok: false,
        code: "already_checked_in",
        message:
          "You have already checked in. Your physical HackUTA badge is now your event pass.",
      };
    }

    if (lookup.status !== "ok") {
      return {
        ok: false,
        code: "not_eligible",
        message: "Your check-in pass is not available for Apple Wallet.",
      };
    }

    const credentials = readAppleWalletCredentialsFromEnv();
    if (!credentials) {
      return {
        ok: false,
        code: "not_configured",
        message: "Apple Wallet passes are not available right now. Please use the QR code above.",
      };
    }

    let pkpassBuffer: Buffer;
    try {
      pkpassBuffer = buildSignedAppleWalletPassBuffer(lookup.passInput, credentials);
    } catch {
      return {
        ok: false,
        code: "signing_failed",
        message: "We could not generate your Apple Wallet pass. Please try again or use the QR code above.",
      };
    }

    let passUrl: string | null = null;
    try {
      const storageId = await ctx.storage.store(
        new Blob([Uint8Array.from(pkpassBuffer)], {
          type: APPLE_WALLET_PASS_MIME_TYPE,
        }),
      );
      passUrl = await ctx.storage.getUrl(storageId);
      await ctx.scheduler.runAfter(PASS_STORAGE_TTL_MS, deleteAppleWalletPassFileRef, {
        storageId,
      });
    } catch {
      // Storage URL is optional when base64 fallback is used.
    }

    return {
      ok: true,
      passUrl,
      pkpassBase64: pkpassBuffer.toString("base64"),
      filename: APPLE_WALLET_PASS_FILENAME,
      serialNumber: lookup.passInput.serialNumber,
    };
  },
});
