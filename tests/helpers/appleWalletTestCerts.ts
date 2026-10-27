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

function derUtcTime(value: string): Buffer {
  return derNode(0x17, Buffer.from(value, "ascii"));
}

function buildName(attrs: Array<{ oid: string; value: string; printable?: boolean }>): Buffer {
  return derSequence(
    attrs.map((attr) =>
      derSet([
        derSequence([
          derOid(attr.oid),
          derNode(attr.printable ? 0x13 : 0x0c, Buffer.from(attr.value, "utf8")),
        ]),
      ]),
    ),
  );
}

function buildX509CertificatePem(options: {
  subjectAttrs: Array<{ oid: string; value: string; printable?: boolean }>;
  issuerAttrs: Array<{ oid: string; value: string; printable?: boolean }>;
  serialByte: number;
  subjectPublicKey: KeyObject;
  issuerPrivateKey: KeyObject;
  signatureOid: string;
  withNullParam: boolean;
  isCa?: boolean;
  passTypeId?: string;
}): string {
  const algId = options.withNullParam
    ? derSequence([derOid(options.signatureOid), Buffer.from([0x05, 0x00])])
    : derSequence([derOid(options.signatureOid)]);
  const spkiDer = options.subjectPublicKey.export({ type: "spki", format: "der" });
  const issuerDer = buildName(options.issuerAttrs);
  const subjectDer = buildName(options.subjectAttrs);

  const extensions: Buffer[] = [];
  if (options.isCa) {
    // basicConstraints: critical, CA:TRUE
    extensions.push(
      derSequence([
        derOid("2.5.29.19"),
        Buffer.from([0x01, 0x01, 0xff]),
        derNode(0x04, derSequence([Buffer.from([0x01, 0x01, 0xff])])),
      ]),
    );
  }
  if (options.passTypeId) {
    // Apple PassKit Pass Type ID marker extension (1.2.840.113635.100.6.1.16)
    extensions.push(
      derSequence([
        derOid("1.2.840.113635.100.6.1.16"),
        derNode(0x04, Buffer.from([0x05, 0x00])),
      ]),
    );
  }

  const tbsItems: Uint8Array[] = [
    derNode(0xa0, Buffer.from([0x02, 0x01, 0x02])), // v3
    Buffer.from([0x02, 0x01, options.serialByte & 0x7f]), // serialNumber
    algId,
    issuerDer,
    derSequence([derUtcTime("250101000000Z"), derUtcTime("350101000000Z")]),
    subjectDer,
    spkiDer,
  ];
  if (extensions.length > 0) {
    tbsItems.push(derNode(0xa3, derSequence(extensions)));
  }

  const tbsCertificate = derSequence(tbsItems);
  const sigBytes = cryptoSign("sha256", tbsCertificate, options.issuerPrivateKey);
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

  const wwdrAttrs = [
    {
      oid: "2.5.4.3",
      value: "Apple Worldwide Developer Relations Certification Authority",
    },
    { oid: "2.5.4.11", value: "G4" },
    { oid: "2.5.4.10", value: "Apple Inc." },
    { oid: "2.5.4.6", value: "US", printable: true },
  ];
  const signerAttrs = [
    { oid: "0.9.2342.19200300.100.1.1", value: "pass.org.hackuta.checkin" },
    { oid: "2.5.4.3", value: "Pass Type ID: pass.org.hackuta.checkin" },
    { oid: "2.5.4.11", value: "HACKUTA26T" },
    { oid: "2.5.4.10", value: "HackUTA" },
    { oid: "2.5.4.6", value: "US", printable: true },
  ];

  const wwdrCertPem = buildX509CertificatePem({
    subjectAttrs: wwdrAttrs,
    issuerAttrs: wwdrAttrs,
    serialByte: 2,
    subjectPublicKey: wwdr.publicKey,
    issuerPrivateKey: wwdr.privateKey,
    signatureOid: "1.2.840.113549.1.1.11",
    withNullParam: true,
    isCa: true,
  });
  const signerCertPem = buildX509CertificatePem({
    subjectAttrs: signerAttrs,
    issuerAttrs: wwdrAttrs,
    serialByte: 1,
    subjectPublicKey: signer.publicKey,
    issuerPrivateKey: wwdr.privateKey,
    signatureOid: "1.2.840.113549.1.1.11",
    withNullParam: true,
    passTypeId: "pass.org.hackuta.checkin",
  });
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

  const wwdrAttrs = [{ oid: "2.5.4.3", value: "Apple WWDR EC Test" }];
  const signerAttrs = [
    { oid: "0.9.2342.19200300.100.1.1", value: "pass.org.hackuta.checkin" },
    { oid: "2.5.4.3", value: "Pass Type ID EC: pass.org.hackuta.checkin" },
    { oid: "2.5.4.11", value: "HACKUTA26T" },
  ];

  const wwdrCertPem = buildX509CertificatePem({
    subjectAttrs: wwdrAttrs,
    issuerAttrs: wwdrAttrs,
    serialByte: 4,
    subjectPublicKey: wwdr.publicKey,
    issuerPrivateKey: wwdr.privateKey,
    signatureOid: "1.2.840.10045.4.3.2",
    withNullParam: false,
    isCa: true,
  });
  const signerCertPem = buildX509CertificatePem({
    subjectAttrs: signerAttrs,
    issuerAttrs: wwdrAttrs,
    serialByte: 3,
    subjectPublicKey: signer.publicKey,
    issuerPrivateKey: wwdr.privateKey,
    signatureOid: "1.2.840.10045.4.3.2",
    withNullParam: false,
    passTypeId: "pass.org.hackuta.checkin",
  });
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
