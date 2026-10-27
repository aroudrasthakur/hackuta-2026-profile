import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import type { AppleWalletSigningCredentials } from "../../convex/profile/appleWalletPass";

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
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

function derOid(oid: string): Buffer {
  const parts = oid.split(".").map((n) => Number.parseInt(n, 10));
  const body: number[] = [parts[0]! * 40 + parts[1]!];
  for (let i = 2; i < parts.length; i += 1) {
    let val = parts[i]!;
    const sub: number[] = [val & 0x7f];
    val >>>= 7;
    while (val > 0) {
      sub.unshift((val & 0x7f) | 0x80);
      val >>>= 7;
    }
    body.push(...sub);
  }
  return derNode(0x06, Uint8Array.from(body));
}

function derUtf8String(value: string): Buffer {
  return derNode(0x0c, Buffer.from(value, "utf8"));
}

function derUtcTime(value: string): Buffer {
  return derNode(0x17, Buffer.from(value, "ascii"));
}

function buildName(commonName: string): Buffer {
  return derSequence([
    derSet([derSequence([derOid("2.5.4.3"), derUtf8String(commonName)])]),
  ]);
}

function buildSelfSignedX509Pem(
  commonName: string,
  serialByte: number,
  publicKey: KeyObject,
  privateKey: KeyObject,
  signatureOid: string,
  withNullParam: boolean,
): string {
  const algId = withNullParam
    ? derSequence([derOid(signatureOid), Buffer.from([0x05, 0x00])])
    : derSequence([derOid(signatureOid)]);
  const spkiDer = publicKey.export({ type: "spki", format: "der" });
  const nameDer = buildName(commonName);

  const tbsCertificate = derSequence([
    derNode(0xa0, Buffer.from([0x02, 0x01, 0x02])), // v3
    Buffer.from([0x02, 0x01, serialByte & 0x7f]), // serialNumber
    algId,
    nameDer,
    derSequence([derUtcTime("250101000000Z"), derUtcTime("350101000000Z")]),
    nameDer,
    spkiDer,
  ]);

  const sigBytes = cryptoSign("sha256", tbsCertificate, privateKey);
  const bitString = derNode(0x03, Buffer.concat([Buffer.from([0x00]), sigBytes]));
  const certDer = derSequence([tbsCertificate, algId, bitString]);
  const b64 = certDer.toString("base64").replace(/(.{64})/g, "$1\n").trim();
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

let cachedRsaCredentials: AppleWalletSigningCredentials | null = null;

/**
 * Generates ephemeral, in-memory X.509 certificates and private keys at test runtime
 * so no PEM private key literals ever exist in the repository.
 */
export function getRuntimeTestAppleWalletCredentials(): AppleWalletSigningCredentials {
  if (cachedRsaCredentials) {
    return cachedRsaCredentials;
  }

  const signer = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const wwdr = generateKeyPairSync("rsa", { modulusLength: 2048 });

  const signerCertPem = buildSelfSignedX509Pem(
    "Pass Type ID: pass.org.hackuta.checkin",
    1,
    signer.publicKey,
    signer.privateKey,
    "1.2.840.113549.1.1.11",
    true,
  );
  const wwdrCertPem = buildSelfSignedX509Pem(
    "Apple Worldwide Developer Relations Certification Authority",
    2,
    wwdr.publicKey,
    wwdr.privateKey,
    "1.2.840.113549.1.1.11",
    true,
  );
  const signerKeyPem = signer.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();

  cachedRsaCredentials = {
    passTypeIdentifier: "pass.org.hackuta.checkin",
    teamIdentifier: "HACKUTA26T",
    signerCertPem,
    signerKeyPem,
    wwdrCertPem,
  };
  return cachedRsaCredentials;
}

export function getRuntimeEcTestAppleWalletCredentials(): AppleWalletSigningCredentials {
  const signer = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const wwdr = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

  const signerCertPem = buildSelfSignedX509Pem(
    "Pass Type ID EC: pass.org.hackuta.checkin",
    3,
    signer.publicKey,
    signer.privateKey,
    "1.2.840.10045.4.3.2",
    false,
  );
  const wwdrCertPem = buildSelfSignedX509Pem(
    "Apple WWDR EC Test",
    4,
    wwdr.publicKey,
    wwdr.privateKey,
    "1.2.840.10045.4.3.2",
    false,
  );
  const signerKeyPem = signer.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();

  return {
    passTypeIdentifier: "pass.org.hackuta.checkin",
    teamIdentifier: "HACKUTA26T",
    signerCertPem,
    signerKeyPem,
    wwdrCertPem,
  };
}
