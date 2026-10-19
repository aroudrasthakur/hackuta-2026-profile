import { describe, expect, it } from "vitest";
import {
  applyAgreementTimestampUpdates,
  computeAgreementTimestampUpdates,
  stripAgreementTimestamps,
} from "../../shared/registration/consentTimestamps";

describe("computeAgreementTimestampUpdates", () => {
  const now = 1_700_000_000_000;

  it("sets a timestamp when an agreement changes from unchecked to checked", () => {
    expect(
      computeAgreementTimestampUpdates(
        { mlhCodeOfConductAgreed: false },
        { mlhCodeOfConductAgreed: true },
        now,
      ),
    ).toEqual({ mlhCodeOfConductAgreedAt: now });
  });

  it("clears a timestamp when an agreement changes from checked to unchecked", () => {
    expect(
      computeAgreementTimestampUpdates(
        {
          mlhDataSharingConsent: true,
          mlhDataSharingConsentAt: 1_600_000_000_000,
        },
        { mlhDataSharingConsent: false },
        now,
      ),
    ).toEqual({ mlhDataSharingConsentAt: undefined });
  });

  it("preserves an existing timestamp when an agreement stays checked", () => {
    expect(
      computeAgreementTimestampUpdates(
        {
          mlhCommunicationsConsent: true,
          mlhCommunicationsConsentAt: 1_600_000_000_000,
        },
        { mlhCommunicationsConsent: true },
        now,
      ),
    ).toEqual({});
  });

  it("sets a new timestamp when an agreement is rechecked after being cleared", () => {
    expect(
      computeAgreementTimestampUpdates(
        { mlhCodeOfConductAgreed: false },
        { mlhCodeOfConductAgreed: true },
        now + 1,
      ),
    ).toEqual({ mlhCodeOfConductAgreedAt: now + 1 });
  });

  it("does not fabricate timestamps for legacy checked rows on unchanged autosave", () => {
    expect(
      computeAgreementTimestampUpdates(
        { mlhCodeOfConductAgreed: true },
        { mlhCodeOfConductAgreed: true },
        now,
      ),
    ).toEqual({});
  });

  it("ignores agreements that are absent from a partial draft patch", () => {
    expect(
      computeAgreementTimestampUpdates(
        { mlhCodeOfConductAgreed: true, mlhCodeOfConductAgreedAt: 1_600_000_000_000 },
        { firstName: "Sam" },
        now,
      ),
    ).toEqual({});
  });

  it("updates each agreement timestamp independently", () => {
    expect(
      computeAgreementTimestampUpdates(
        {
          mlhCodeOfConductAgreed: false,
          mlhDataSharingConsent: true,
          mlhDataSharingConsentAt: 1_600_000_000_000,
          mlhCommunicationsConsent: false,
        },
        {
          mlhCodeOfConductAgreed: true,
          mlhDataSharingConsent: true,
          mlhCommunicationsConsent: true,
        },
        now,
      ),
    ).toEqual({
      mlhCodeOfConductAgreedAt: now,
      mlhCommunicationsConsentAt: now,
    });
  });

  it("manages sponsor and food waiver timestamps with the same transition rules", () => {
    expect(
      computeAgreementTimestampUpdates(
        { sponsorSharingConsent: false },
        { sponsorSharingConsent: true },
        now,
      ),
    ).toEqual({ sponsorSharingConsentAt: now });

    expect(
      computeAgreementTimestampUpdates(
        {
          foodAllergyWaiverAgreed: true,
          foodAllergyWaiverAgreedAt: 1_600_000_000_000,
        },
        { foodAllergyWaiverAgreed: false },
        now,
      ),
    ).toEqual({ foodAllergyWaiverAgreedAt: undefined });
  });
});

describe("applyAgreementTimestampUpdates", () => {
  it("writes and deletes timestamp columns on the target record", () => {
    const target: Record<string, unknown> = {
      mlhCodeOfConductAgreed: true,
      mlhCodeOfConductAgreedAt: 1_600_000_000_000,
    };

    applyAgreementTimestampUpdates(
      target,
      { mlhCodeOfConductAgreed: true, mlhCodeOfConductAgreedAt: 1_600_000_000_000 },
      { mlhCodeOfConductAgreed: false },
      1_700_000_000_000,
    );

    expect(target).toEqual({ mlhCodeOfConductAgreed: true });
    expect(target).not.toHaveProperty("mlhCodeOfConductAgreedAt");
  });
});

describe("stripAgreementTimestamps", () => {
  it("removes client-supplied agreement timestamps from payloads", () => {
    expect(
      stripAgreementTimestamps({
        mlhCodeOfConductAgreed: true,
        mlhCodeOfConductAgreedAt: 123,
        mlhDataSharingConsentAt: 456,
        mlhCommunicationsConsentAt: 789,
        sponsorSharingConsentAt: 111,
        foodAllergyWaiverAgreedAt: 222,
        firstName: "Sam",
      }),
    ).toEqual({
      mlhCodeOfConductAgreed: true,
      firstName: "Sam",
    });
  });
});
