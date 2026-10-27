/**
 * Scanned QR values, shared by the scanner UI and the Convex scan functions.
 *
 * Registration QR codes hold a 64-character lowercase hex token made by
 * `createQrCodeToken`. Badge QR codes are preprinted by a vendor and opaque:
 * they are stored and compared exactly as printed, apart from whitespace a
 * scanner or paste adds around them. If the vendor's badges have a fixed
 * prefix or format, check it in `normalizeBadgeQr` without changing the value.
 */

/** Longest scanned value accepted, after trimming. */
export const MAX_SCAN_VALUE_LENGTH = 256;

/** Longest reason an admin can give for a badge change. */
export const BADGE_REASON_MAX_LENGTH = 200;

const REGISTRATION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
// eslint-disable-next-line no-control-regex -- control characters never appear in a printed QR payload
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function withinScanLimit(raw: string) {
  return raw.length <= MAX_SCAN_VALUE_LENGTH * 2;
}

/** Registration token, forgiving whitespace and capitals from manual entry. */
export function normalizeRegistrationQr(raw: string): string | null {
  if (!withinScanLimit(raw)) return null;
  const token = raw.replace(/\s+/g, "").toLowerCase();
  return REGISTRATION_TOKEN_PATTERN.test(token) ? token : null;
}

/** Badge value exactly as printed: non-empty, at most 256 characters, no control characters. */
export function normalizeBadgeQr(raw: string): string | null {
  if (!withinScanLimit(raw)) return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_SCAN_VALUE_LENGTH) return null;
  return CONTROL_CHARACTERS.test(value) ? null : value;
}

/**
 * Values to look up for one scan, most specific first: the exact badge
 * value, then the registration reading of the same input.
 */
export function scanLookupCandidates(raw: string): string[] {
  const candidates = [normalizeBadgeQr(raw), normalizeRegistrationQr(raw)];
  return [...new Set(candidates.filter((value): value is string => value !== null))];
}
