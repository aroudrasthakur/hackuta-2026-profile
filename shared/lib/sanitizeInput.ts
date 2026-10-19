const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*?>/i;
const DANGEROUS_URL_PATTERN = /javascript\s*:/i;
const EVENT_HANDLER_PATTERN = /\bon[a-z]+\s*=/i;

function isDisallowedControlChar(charCode: number): boolean {
  return (
    (charCode >= 0x00 && charCode <= 0x08) ||
    charCode === 0x0b ||
    charCode === 0x0c ||
    (charCode >= 0x0e && charCode <= 0x1f) ||
    charCode === 0x7f
  );
}

function stripDisallowedControlChars(value: string): string {
  return Array.from(value)
    .filter((char) => !isDisallowedControlChar(char.charCodeAt(0)))
    .join("");
}

function collapseWhitespace(value: string): string {
  let result = "";
  let pendingSpace = false;

  for (const char of value) {
    const charCode = char.charCodeAt(0);
    if (charCode === 0x09 || charCode === 0x0a || charCode === 0x0d) {
      pendingSpace = true;
      continue;
    }

    if (pendingSpace) {
      if (result.length > 0 && !result.endsWith(" ")) {
        result += " ";
      }
      pendingSpace = false;
    }

    result += char;
  }

  return result;
}

function replaceCrlfWithSpace(value: string): string {
  return Array.from(value)
    .map((char) => {
      const charCode = char.charCodeAt(0);
      return charCode === 0x0a || charCode === 0x0d ? " " : char;
    })
    .join("");
}

export type SanitizePlainTextOptions = {
  allowNewlines?: boolean;
};

export function sanitizePlainText(
  value: string,
  options: SanitizePlainTextOptions = {},
): string {
  let result = value.normalize("NFKC");

  if (!options.allowNewlines) {
    result = collapseWhitespace(result);
  }

  result = stripDisallowedControlChars(result);
  return result.trim();
}

export function containsDangerousMarkup(value: string): boolean {
  return (
    HTML_TAG_PATTERN.test(value) ||
    DANGEROUS_URL_PATTERN.test(value) ||
    EVENT_HANDLER_PATTERN.test(value)
  );
}

export function containsCrlf(value: string): boolean {
  for (const char of value) {
    const charCode = char.charCodeAt(0);
    if (charCode === 0x0a || charCode === 0x0d) {
      return true;
    }
  }
  return false;
}

export function sanitizeEmailHeaderValue(value: string, maxLength: number): string {
  const sanitized = replaceCrlfWithSpace(sanitizePlainText(value));
  if (containsDangerousMarkup(sanitized)) {
    throw new Error("Invalid email header value.");
  }
  return sanitized.slice(0, maxLength);
}

export function assertSafePlainText(
  value: string,
  options: SanitizePlainTextOptions = {},
): string | null {
  const sanitized = sanitizePlainText(value, options);
  if (sanitized.length === 0 && value.trim().length > 0) {
    return null;
  }
  if (containsDangerousMarkup(sanitized)) {
    return null;
  }
  if (!options.allowNewlines && containsCrlf(value)) {
    return null;
  }
  return sanitized;
}
