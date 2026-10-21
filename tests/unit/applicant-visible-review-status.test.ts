import { describe, expect, it } from "vitest";
import {
  applicantVisibleParticipant,
  applicantVisibleReviewStatus,
} from "../../convex/profile/openDecisionEmail";

describe("applicantVisibleReviewStatus", () => {
  it("passes through status when no email is pending", () => {
    expect(applicantVisibleReviewStatus({ status: "accepted" }, null)).toBe("accepted");
  });

  it("hides a queued acceptance while review is still in progress", () => {
    expect(
      applicantVisibleReviewStatus(
        { status: "under_review", startedAt: 1 },
        { decision: "accepted" },
      ),
    ).toBe("under_review");
  });

  it("keeps a released waitlist visible while acceptance is queued", () => {
    expect(
      applicantVisibleReviewStatus({ status: "waitlisted", completedAt: 1 }, { decision: "accepted" }),
    ).toBe("waitlisted");
  });

  it("masks a premature final status that matches the open queue row", () => {
    expect(
      applicantVisibleReviewStatus({ status: "rejected", completedAt: 1 }, { decision: "rejected" }),
    ).toBe("under_review");
  });
});

describe("applicantVisibleParticipant", () => {
  it("hides participant check-in while acceptance is still queued", () => {
    expect(applicantVisibleParticipant({ qrCodeToken: "x" }, { decision: "accepted" })).toBeNull();
  });

  it("returns participant when no acceptance email is pending", () => {
    const row = { qrCodeToken: "x" };
    expect(applicantVisibleParticipant(row, null)).toBe(row);
  });
});
