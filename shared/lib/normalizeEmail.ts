export function normalizeEmail(email: string | undefined | null): string | undefined {
  const normalized = email?.trim().toLowerCase();
  return normalized || undefined;
}

export function isValidEmailSyntax(email: string): boolean {
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
