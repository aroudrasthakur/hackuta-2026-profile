import { describe, expect, it } from "vitest";
import {
  GENDER_SELF_DESCRIBE_OPTION,
  HEAR_ABOUT_OTHER_OPTION,
  MAJOR_OTHER_OPTION,
  SCHOOL_OTHER_OPTION,
} from "../../shared/registration/constants";
import {
  LEGACY_SCHOOL_OTHER_OPTION,
  normalizeLegacySchoolSentinel,
  splitLegacyGender,
  splitLegacyHearAbout,
  splitLegacyMajor,
  splitLegacySchool,
} from "../../shared/registration/otherOptionMigration";

describe("otherOptionMigration", () => {
  it("normalizes the legacy school Other sentinel", () => {
    expect(normalizeLegacySchoolSentinel(LEGACY_SCHOOL_OTHER_OPTION)).toBe(
      SCHOOL_OTHER_OPTION,
    );
    expect(normalizeLegacySchoolSentinel("The University of Texas at Arlington")).toBe(
      "The University of Texas at Arlington",
    );
  });

  it("splits merged custom school text into Other + otherSchool", () => {
    expect(splitLegacySchool("Mars Academy")).toEqual({
      school: SCHOOL_OTHER_OPTION,
      otherSchool: "Mars Academy",
    });
  });

  it("preserves an explicit otherSchool when the school sentinel is already stored", () => {
    expect(
      splitLegacySchool(SCHOOL_OTHER_OPTION, "Mars Academy"),
    ).toEqual({
      school: SCHOOL_OTHER_OPTION,
      otherSchool: "Mars Academy",
    });
  });

  it("splits merged custom major text into Other + otherMajor", () => {
    expect(splitLegacyMajor("Biomedical engineering")).toEqual({
      major: MAJOR_OTHER_OPTION,
      otherMajor: "Biomedical engineering",
    });
  });

  it("splits merged custom hear-about text into Other + otherHearAbout", () => {
    expect(splitLegacyHearAbout("Professor announcement")).toEqual({
      hearAbout: HEAR_ABOUT_OTHER_OPTION,
      otherHearAbout: "Professor announcement",
    });
  });

  it("splits merged custom gender text into self-describe + otherGender", () => {
    expect(splitLegacyGender("Genderfluid")).toEqual({
      gender: GENDER_SELF_DESCRIBE_OPTION,
      otherGender: "Genderfluid",
    });
  });

  it("preserves listed parent values without creating other* text", () => {
    expect(splitLegacySchool("The University of Texas at Arlington")).toEqual({
      school: "The University of Texas at Arlington",
      otherSchool: "",
    });
    expect(splitLegacyMajor("Computer science, computer engineering, or software engineering")).toEqual({
      major: "Computer science, computer engineering, or software engineering",
      otherMajor: "",
    });
    expect(splitLegacyHearAbout("Discord")).toEqual({
      hearAbout: "Discord",
      otherHearAbout: "",
    });
    expect(splitLegacyGender("Man")).toEqual({
      gender: "Man",
      otherGender: "",
    });
  });

  it("preserves explicit otherGender when the self-describe sentinel is already stored", () => {
    expect(
      splitLegacyGender(GENDER_SELF_DESCRIBE_OPTION, "Genderfluid"),
    ).toEqual({
      gender: GENDER_SELF_DESCRIBE_OPTION,
      otherGender: "Genderfluid",
    });
  });
});
