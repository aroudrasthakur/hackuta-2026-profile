import { sanitizePlainText } from "../lib/sanitizeInput";

/**
 * Emergency contact is optional, but all-or-nothing: once any field has a
 * value, every field is required so organizers never hold a half-usable contact.
 */
export const EMERGENCY_CONTACT_FIELDS = [
  "emergencyContactName",
  "emergencyContactRelationship",
  "emergencyContactPhone",
] as const;

export type EmergencyContactField = (typeof EMERGENCY_CONTACT_FIELDS)[number];

export const EMERGENCY_CONTACT_REQUIRED_MESSAGES: Record<EmergencyContactField, string> = {
  emergencyContactName: "Please enter your emergency contact's name.",
  emergencyContactRelationship: "Please enter your emergency contact's relationship to you.",
  emergencyContactPhone: "Please enter your emergency contact's phone number.",
};

type EmergencyContactValues = Partial<Record<EmergencyContactField, string | undefined>>;

function hasValue(value: string | undefined) {
  return sanitizePlainText(value ?? "") !== "";
}

/** True when the applicant has typed anything (non-whitespace) into the section. */
export function isEmergencyContactStarted(values: EmergencyContactValues) {
  return EMERGENCY_CONTACT_FIELDS.some((field) => hasValue(values[field]));
}

/** Fields left blank in a partially filled emergency contact (empty when none or all are filled). */
export function missingEmergencyContactFields(
  values: EmergencyContactValues,
): EmergencyContactField[] {
  if (!isEmergencyContactStarted(values)) return [];
  return EMERGENCY_CONTACT_FIELDS.filter((field) => !hasValue(values[field]));
}
