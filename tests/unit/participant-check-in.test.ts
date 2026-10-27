import { describe, expect, it } from "vitest";
import {
  isParticipantCheckedIn,
  participantPortalView,
} from "../../convex/profile/participantCheckIn";

const row = {
  acceptedAt: 10,
  qrCodeToken: "a".repeat(64),
  badgeQrCodeToken: "b".repeat(64),
  foodRestriction: "vegan",
  points: 40,
};

describe("isParticipantCheckedIn", () => {
  it("is false until checkedInAt is set", () => {
    expect(isParticipantCheckedIn({})).toBe(false);
    expect(isParticipantCheckedIn({ checkedInAt: 0 })).toBe(true);
    expect(isParticipantCheckedIn({ checkedInAt: 1_700_000_000_000 })).toBe(true);
  });
});

describe("participantPortalView", () => {
  it("returns only the registration token before check-in", () => {
    expect(participantPortalView(row)).toEqual({
      status: "awaiting_check_in",
      acceptedAt: 10,
      qrCodeToken: "a".repeat(64),
    });
  });

  it("returns no token of any kind after check-in", () => {
    const view = participantPortalView({ ...row, checkedInAt: 20 });
    expect(view).toEqual({ status: "checked_in", acceptedAt: 10, checkedInAt: 20 });
    expect(JSON.stringify(view)).not.toMatch(/a{64}|b{64}/);
  });
});
