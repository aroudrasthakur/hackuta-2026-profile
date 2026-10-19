import { DIETARY_OPTIONS } from "./constants";

export const NO_BEEF_DIETARY_OPTION = "No Beef" as const satisfies (typeof DIETARY_OPTIONS)[number];
export const NO_PORK_DIETARY_OPTION = "No Pork" as const satisfies (typeof DIETARY_OPTIONS)[number];

/** Map legacy eatsBeef/eatsPork "No" answers into dietary restriction checkboxes. */
export function mergeLegacyMeatPreferencesIntoDietaryRestrictions(
  dietaryRestrictions: readonly string[] | undefined,
  eatsBeef: boolean | undefined,
  eatsPork: boolean | undefined,
): string[] {
  const restrictions = [...(dietaryRestrictions ?? [])];
  if (eatsBeef === false && !restrictions.includes(NO_BEEF_DIETARY_OPTION)) {
    restrictions.push(NO_BEEF_DIETARY_OPTION);
  }
  if (eatsPork === false && !restrictions.includes(NO_PORK_DIETARY_OPTION)) {
    restrictions.push(NO_PORK_DIETARY_OPTION);
  }
  return restrictions;
}
