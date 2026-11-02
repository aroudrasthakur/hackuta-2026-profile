import { describe, expect, it } from "vitest";
import { formatCheckInPassEventWindow } from "../../src/lib/qrImageDownload";

describe("check-in pass image details", () => {
  it("formats the same event window as the Apple Wallet pass", () => {
    expect(
      formatCheckInPassEventWindow(
        Date.parse("2026-11-14T09:00:00-06:00"),
        Date.parse("2026-11-15T18:00:00-06:00"),
      ),
    ).toBe("Nov 14–15, 2026");
    expect(
      formatCheckInPassEventWindow(
        Date.parse("2026-11-14T09:00:00-06:00"),
        Date.parse("2026-11-14T18:00:00-06:00"),
      ),
    ).toBe("Nov 14, 2026");
  });
});
