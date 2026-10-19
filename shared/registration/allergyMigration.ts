/**
 * Resolve stored allergy text when legacy `otherDietary` rows may still exist.
 * Non-empty `allergyDetails` always wins over legacy `otherDietary`.
 */
export function resolveAllergyDetailsFromLegacy(
  allergyDetails?: string | null,
  otherDietary?: string | null,
): string | undefined {
  const stored = allergyDetails?.trim();
  if (stored) return stored;

  const legacy = otherDietary?.trim();
  if (legacy) return legacy;

  return undefined;
}
