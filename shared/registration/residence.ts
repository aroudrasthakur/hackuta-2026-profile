import { STATES_OF_RESIDENCE } from "./constants";
import type { StateOfResidence } from "./types";

export const USA_COUNTRY = "United States of America" as const;
export const LEGACY_NON_US_STATE = "Outside the United States" as const;

export const US_STATE_OPTIONS = STATES_OF_RESIDENCE.filter(
  (state): state is Exclude<StateOfResidence, typeof LEGACY_NON_US_STATE> =>
    state !== LEGACY_NON_US_STATE,
);

export function isUsaCountry(country: string): boolean {
  return country === USA_COUNTRY;
}

export function requiresUsState(country: string): boolean {
  return isUsaCountry(country);
}

export function normalizeStateOfResidenceForForm(
  country: string,
  state: string,
): (typeof US_STATE_OPTIONS)[number] | "" {
  if (!requiresUsState(country)) return "";
  if (state === LEGACY_NON_US_STATE) return "";
  if (!(US_STATE_OPTIONS as readonly string[]).includes(state)) return "";
  return state as (typeof US_STATE_OPTIONS)[number];
}

export function stateForRegistrationPayload(
  country: string,
  state: string,
): (typeof US_STATE_OPTIONS)[number] | undefined {
  if (!requiresUsState(country)) return undefined;
  const normalized = normalizeStateOfResidenceForForm(country, state);
  return normalized === "" ? undefined : normalized;
}

export function normalizeResidenceFormFields<
  T extends { countryOfResidence: string; stateOfResidence: string },
>(form: T): T {
  return {
    ...form,
    stateOfResidence: normalizeStateOfResidenceForForm(
      form.countryOfResidence,
      form.stateOfResidence,
    ),
  };
}
