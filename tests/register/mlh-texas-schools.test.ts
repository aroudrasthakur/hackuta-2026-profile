import { describe, expect, it } from "vitest";
import { MLH_TEXAS_SCHOOLS } from "../../shared/registration/mlhTexasSchools";

describe("MLH_TEXAS_SCHOOLS", () => {
  it("lists Texas schools with UTA first for the default picker view", () => {
    expect(MLH_TEXAS_SCHOOLS[0]).toBe("The University of Texas at Arlington");
    expect(MLH_TEXAS_SCHOOLS.length).toBeGreaterThan(0);
    expect(MLH_TEXAS_SCHOOLS.every((school) => /\btexas\b/i.test(school))).toBe(true);
  });
});
