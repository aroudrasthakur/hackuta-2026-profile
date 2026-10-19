import {
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js/max";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

/** Sort ISO countries by numeric calling code; tie-break by English country name. */
export function sortCountriesByCallingCode(countries: readonly CountryCode[]): CountryCode[] {
  return [...countries].sort((a, b) => {
    const codeA = Number(getCountryCallingCode(a));
    const codeB = Number(getCountryCallingCode(b));
    if (codeA !== codeB) {
      return codeA - codeB;
    }

    const nameA = countryNames.of(a) ?? a;
    const nameB = countryNames.of(b) ?? b;
    return nameA.localeCompare(nameB);
  });
}

export const phoneCountries = sortCountriesByCallingCode(getCountries());

export function formatPhoneCountryOption(country: CountryCode) {
  return `+${getCountryCallingCode(country)} ${country}`;
}

export function countryDisplayName(country: CountryCode) {
  return countryNames.of(country) ?? country;
}
