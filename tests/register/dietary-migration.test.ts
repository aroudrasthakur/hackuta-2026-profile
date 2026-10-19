import { describe, expect, it } from "vitest";
import { mergeLegacyMeatPreferencesIntoDietaryRestrictions } from "../../shared/registration/dietaryMigration";

describe("mergeLegacyMeatPreferencesIntoDietaryRestrictions", () => {
  it("adds No Beef and No Pork only for legacy No answers", () => {
    expect(
      mergeLegacyMeatPreferencesIntoDietaryRestrictions(["Halal"], false, false),
    ).toEqual(["Halal", "No Beef", "No Pork"]);
  });

  it("adds each restriction independently", () => {
    expect(mergeLegacyMeatPreferencesIntoDietaryRestrictions([], false, true)).toEqual([
      "No Beef",
    ]);
    expect(mergeLegacyMeatPreferencesIntoDietaryRestrictions([], true, false)).toEqual([
      "No Pork",
    ]);
  });

  it("does not add restrictions for Yes or unanswered legacy values", () => {
    expect(mergeLegacyMeatPreferencesIntoDietaryRestrictions(["Halal"], true, true)).toEqual([
      "Halal",
    ]);
    expect(
      mergeLegacyMeatPreferencesIntoDietaryRestrictions(["Halal"], undefined, undefined),
    ).toEqual(["Halal"]);
  });

  it("avoids duplicate dietary restriction entries", () => {
    expect(
      mergeLegacyMeatPreferencesIntoDietaryRestrictions(
        ["Halal", "No Beef", "No Pork"],
        false,
        false,
      ),
    ).toEqual(["Halal", "No Beef", "No Pork"]);
  });
});
