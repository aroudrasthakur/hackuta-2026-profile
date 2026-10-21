/** Dietary fields copied from `applications` when a participant row is created. */
export type ApplicationFoodRestrictionSource = {
  dietaryRestrictions?: string[];
  otherDietaryRestrictions?: string;
  allergyDetails?: string;
};

/**
 * Snapshot of an applicant's dietary needs for check-in and meal ops.
 * Built from the linked application at acceptance time.
 */
export function foodRestrictionFromApplication(application: ApplicationFoodRestrictionSource) {
  const parts: string[] = [];
  if (application.dietaryRestrictions?.length) {
    parts.push(application.dietaryRestrictions.join(", "));
  }
  const other = application.otherDietaryRestrictions?.trim();
  if (other) {
    parts.push(other);
  }
  const allergy = application.allergyDetails?.trim();
  if (allergy) {
    parts.push(`Allergies: ${allergy}`);
  }
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join("; ");
}
