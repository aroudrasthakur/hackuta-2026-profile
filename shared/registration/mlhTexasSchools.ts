import { MLH_SCHOOLS } from "./mlhSchools";

const TEXAS_SCHOOL_PRIORITY = ["The University of Texas at Arlington"];

function isTexasSchool(name: string) {
  return /\btexas\b/i.test(name);
}

/** Texas schools surfaced first in the school picker before the user searches. */
export const MLH_TEXAS_SCHOOLS = [
  ...TEXAS_SCHOOL_PRIORITY.filter((name) => MLH_SCHOOLS.includes(name as (typeof MLH_SCHOOLS)[number])),
  ...MLH_SCHOOLS.filter(
    (name) => isTexasSchool(name) && !TEXAS_SCHOOL_PRIORITY.includes(name),
  ),
] as readonly string[];
