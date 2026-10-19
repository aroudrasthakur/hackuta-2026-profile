import { describe, expect, it } from "vitest";
import {
  DIETARY_OPTIONS,
  GENDERS,
  HEAR_ABOUT_OPTIONS,
  LEVELS_OF_STUDY,
  MAX_AGE,
  MAX_GRADUATION_YEAR,
  MIN_AGE,
  MIN_GRADUATION_YEAR,
  RACE_ETHNICITY_OPTIONS,
  TSHIRT_SIZES,
} from "../../shared/registration/constants";
import { MAX_RESUME_BYTES } from "../../shared/registration/resume";

describe("registration constants", () => {
  describe("graduation year constraints", () => {
    it("has reasonable min graduation year", () => {
      expect(MIN_GRADUATION_YEAR).toBeGreaterThanOrEqual(2024);
      expect(MIN_GRADUATION_YEAR).toBeLessThanOrEqual(2030);
    });

    it("has reasonable max graduation year", () => {
      expect(MAX_GRADUATION_YEAR).toBeGreaterThan(MIN_GRADUATION_YEAR);
      expect(MAX_GRADUATION_YEAR).toBeLessThanOrEqual(2040);
    });

    it("has valid range", () => {
      const range = MAX_GRADUATION_YEAR - MIN_GRADUATION_YEAR;
      expect(range).toBeGreaterThan(0);
      expect(range).toBeLessThanOrEqual(20);
    });
  });

  describe("age constraints", () => {
    it("has reasonable min age", () => {
      expect(MIN_AGE).toBeGreaterThanOrEqual(13);
      expect(MIN_AGE).toBeLessThanOrEqual(18);
    });

    it("has reasonable max age", () => {
      expect(MAX_AGE).toBeGreaterThan(MIN_AGE);
      expect(MAX_AGE).toBeLessThanOrEqual(150);
    });
  });

  describe("resume constraints", () => {
    it("has reasonable max file size", () => {
      expect(MAX_RESUME_BYTES).toBeGreaterThan(0);
      expect(MAX_RESUME_BYTES).toBeLessThanOrEqual(10 * 1024 * 1024);
    });

    it("is 2MB", () => {
      const expected = 2 * 1024 * 1024;
      expect(typeof MAX_RESUME_BYTES).toBe("number");
      expect(MAX_RESUME_BYTES).toBe(expected);
    });
  });

  describe("option arrays", () => {
    it("has gender options", () => {
      expect(Array.isArray(GENDERS)).toBe(true);
      expect(GENDERS.length).toBeGreaterThan(0);
      expect(GENDERS.includes("Man") || GENDERS.includes("Woman")).toBe(true);
    });

    it("has level of study options", () => {
      expect(Array.isArray(LEVELS_OF_STUDY)).toBe(true);
      expect(LEVELS_OF_STUDY.length).toBeGreaterThan(0);
    });

    it("has t-shirt size options", () => {
      expect(Array.isArray(TSHIRT_SIZES)).toBe(true);
      expect(TSHIRT_SIZES).toEqual(["S", "M", "L", "XL", "2XL", "3XL"]);
    });

    it("has dietary restriction options", () => {
      expect(Array.isArray(DIETARY_OPTIONS)).toBe(true);
      expect(DIETARY_OPTIONS.length).toBeGreaterThan(0);
      expect(DIETARY_OPTIONS).toContain("No Beef");
      expect(DIETARY_OPTIONS).toContain("No Pork");
    });

    it("does not register legacy beef or pork answer fields", async () => {
      const { APPLICANT_ANSWER_FIELD_KEYS } = await import(
        "../../shared/registration/applicantFields"
      );
      expect(APPLICANT_ANSWER_FIELD_KEYS).not.toContain("eatsBeef");
      expect(APPLICANT_ANSWER_FIELD_KEYS).not.toContain("eatsPork");
    });

    it("registers every application form field except resume for draft autosave", async () => {
      const { APPLICANT_ANSWER_FIELD_KEYS } = await import(
        "../../shared/registration/applicantFields"
      );
      const { INITIAL_FORM } = await import("../../shared/registration/types");
      const persisted = new Set<string>(APPLICANT_ANSWER_FIELD_KEYS);
      const formKeys = Object.keys(INITIAL_FORM).filter((key) => key !== "resume");

      expect(formKeys).toHaveLength(persisted.size);
      for (const key of formKeys) {
        expect(persisted.has(key)).toBe(true);
      }
    });

    it("has race/ethnicity options", () => {
      expect(Array.isArray(RACE_ETHNICITY_OPTIONS)).toBe(true);
      expect(RACE_ETHNICITY_OPTIONS.length).toBeGreaterThan(0);
    });

    it("has hear about options", () => {
      expect(Array.isArray(HEAR_ABOUT_OPTIONS)).toBe(true);
      expect(HEAR_ABOUT_OPTIONS.length).toBeGreaterThan(0);
    });
  });

  describe("option uniqueness", () => {
    it("has unique gender options", () => {
      const unique = new Set(GENDERS);
      expect(unique.size).toBe(GENDERS.length);
    });

    it("has unique t-shirt size options", () => {
      const unique = new Set(TSHIRT_SIZES);
      expect(unique.size).toBe(TSHIRT_SIZES.length);
    });
  });
});
