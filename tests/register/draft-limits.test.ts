import { describe, expect, it } from "vitest";
import {
  DIETARY_OPTIONS,
  FIELD_LIMITS,
  MAX_GRADUATION_YEAR,
  MIN_GRADUATION_YEAR,
  RACE_ETHNICITY_OPTIONS,
} from "../../shared/registration/constants";
import {
  DRAFT_ARRAY_INVALID_VALUE_MESSAGE,
  DRAFT_FIELD_TOO_LONG_MESSAGE,
  DRAFT_NUMBER_OUT_OF_RANGE_MESSAGE,
  validateDraftPatchLimits,
} from "../../shared/registration/draftLimits";

describe("validateDraftPatchLimits", () => {
  it("rejects oversized essay fields", () => {
    expect(() =>
      validateDraftPatchLimits({
        builtOrWantToBuild: "x".repeat(FIELD_LIMITS.builtOrWantToBuild + 1),
      }),
    ).toThrow(DRAFT_FIELD_TOO_LONG_MESSAGE);
  });

  it("rejects multi-select arrays with invalid repeated entries", () => {
    expect(() =>
      validateDraftPatchLimits({
        raceEthnicity: Array.from({ length: 10_000 }, () => "Definitely not a valid option"),
      }),
    ).toThrow(DRAFT_ARRAY_INVALID_VALUE_MESSAGE);
  });

  it("rejects multi-select arrays with too many unique allowed values", () => {
    expect(() =>
      validateDraftPatchLimits({
        raceEthnicity: [...RACE_ETHNICITY_OPTIONS, RACE_ETHNICITY_OPTIONS[0]!],
      }),
    ).not.toThrow();
    expect(() =>
      validateDraftPatchLimits({
        dietaryRestrictions: [...DIETARY_OPTIONS, "Extra invalid"],
      }),
    ).toThrow(DRAFT_ARRAY_INVALID_VALUE_MESSAGE);
  });

  it("rejects out-of-range numeric draft fields", () => {
    expect(() => validateDraftPatchLimits({ age: 12 })).toThrow(DRAFT_NUMBER_OUT_OF_RANGE_MESSAGE);
    expect(() => validateDraftPatchLimits({ hackathonsAttended: 999 })).toThrow(
      DRAFT_NUMBER_OUT_OF_RANGE_MESSAGE,
    );
    expect(() => validateDraftPatchLimits({ graduationYear: MIN_GRADUATION_YEAR - 1 })).toThrow(
      DRAFT_NUMBER_OUT_OF_RANGE_MESSAGE,
    );
    expect(() => validateDraftPatchLimits({ graduationYear: MAX_GRADUATION_YEAR + 1 })).toThrow(
      DRAFT_NUMBER_OUT_OF_RANGE_MESSAGE,
    );
  });

  it("rejects NaN numeric draft fields", () => {
    expect(() => validateDraftPatchLimits({ age: Number.NaN })).toThrow(
      DRAFT_NUMBER_OUT_OF_RANGE_MESSAGE,
    );
  });

  it("accepts values within limits", () => {
    expect(
      validateDraftPatchLimits({
        firstName: "Ada",
        raceEthnicity: ["White"],
      }),
    ).toEqual({
      firstName: "Ada",
      raceEthnicity: ["White"],
    });
  });

  it("deduplicates allowed multi-select values before storage", () => {
    expect(
      validateDraftPatchLimits({
        raceEthnicity: ["White", "White"],
        dietaryRestrictions: ["Vegan", "Vegan", "Halal"],
      }),
    ).toEqual({
      raceEthnicity: ["White"],
      dietaryRestrictions: ["Vegan", "Halal"],
    });
  });

  it("rejects invalid multi-select values", () => {
    expect(() =>
      validateDraftPatchLimits({
        raceEthnicity: ["Definitely not a valid option"],
      }),
    ).toThrow(DRAFT_ARRAY_INVALID_VALUE_MESSAGE);

    expect(() =>
      validateDraftPatchLimits({
        dietaryRestrictions: ["Not a diet"],
      }),
    ).toThrow(DRAFT_ARRAY_INVALID_VALUE_MESSAGE);
  });

  it("rejects non-string multi-select entries", () => {
    expect(() =>
      validateDraftPatchLimits({
        raceEthnicity: [123],
      }),
    ).toThrow(DRAFT_ARRAY_INVALID_VALUE_MESSAGE);
  });
});
