import { Buffer } from "node:buffer";

/** One-page PDF generated once for tests; production code never parses PDF bytes. */
const MINIMAL_PDF_BASE64 =
  "JVBERi0xLjcKJYGBgYEKCjUgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL09ialN0bQovTiA0Ci9GaXJzdCAyMAovTGVuZ3RoIDI2Mgo+PgpzdHJlYW0KeJzVUk1LxDAQvedXzNE9ZTrJJq2UwtqPiwjL4knZQ9iGpSAb6Qfov3fSrIoH8SzhkY/3JpnJmwwQCLQGBTYHDVtFUJZCPr6/epB7d/aTkPdDP8EzswgHOApZh+UyQyaqSnxraze7l3AWKQiyKP5U7MfQLyc/Qtm1XYdoEdFohkGkhueaUTCI98xRzmuG1VfwmVWIasdcl2Bsion8qt1e41ueWWuipklanaf917vxrTbdQX/lU1RCPoS+cbOHm+aWkAwWxCFKafO04e8YvZvD/y1uzX8Il18r/OFztDeaPPrYA6vL8uCnsIwntp11Vfwv3w/uLrxx1yAPkxHYgrh3mPwARTGN7wplbmRzdHJlYW0KZW5kb2JqCgo2IDAgb2JqCjw8Ci9TaXplIDcKL1Jvb3QgMiAwIFIKL0luZm8gMyAwIFIKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL1hSZWYKL0xlbmd0aCAzNAovVyBbIDEgMiAyIF0KL0luZGV4IFsgMCA3IF0KPj4Kc3RyZWFtCnicFcQxDgAgCASwHsbdB/t3CB2K7nLZstV24pF8BkOPArAKZW5kc3RyZWFtCmVuZG9iagoKc3RhcnR4cmVmCjM4MAolJUVPRg==";

export function minimalPdfBytes(): ArrayBuffer {
  return Buffer.from(MINIMAL_PDF_BASE64, "base64").buffer as ArrayBuffer;
}

/** Pad a minimal PDF with comments to an exact byte length. */
export function minimalPdfBytesAtExactly(targetLength: number): Uint8Array {
  const base = new Uint8Array(minimalPdfBytes());
  if (base.byteLength >= targetLength) {
    throw new Error(`Base PDF (${base.byteLength}b) must be smaller than ${targetLength}b`);
  }

  const eofMarker = new TextEncoder().encode("%%EOF");
  let eofIndex = -1;
  for (let index = 0; index <= base.byteLength - eofMarker.length; index += 1) {
    if (eofMarker.every((byte, offset) => base[index + offset] === byte)) {
      eofIndex = index;
    }
  }
  if (eofIndex === -1) {
    throw new Error("PDF missing %%EOF marker");
  }

  const commentPrefix = new TextEncoder().encode("\n% ");
  const commentSuffix = new TextEncoder().encode("\n");
  const insertLength = targetLength - base.byteLength;
  const padLength = insertLength - commentPrefix.byteLength - commentSuffix.byteLength;
  if (padLength < 0) {
    throw new Error("Target length is too small for PDF comment padding");
  }

  const padding = new Uint8Array(padLength);
  padding.fill("0".charCodeAt(0));

  const padded = new Uint8Array(targetLength);
  padded.set(base.subarray(0, eofIndex));
  padded.set(commentPrefix, eofIndex);
  padded.set(padding, eofIndex + commentPrefix.byteLength);
  padded.set(commentSuffix, eofIndex + commentPrefix.byteLength + padLength);
  padded.set(base.subarray(eofIndex), eofIndex + insertLength);
  return padded;
}
