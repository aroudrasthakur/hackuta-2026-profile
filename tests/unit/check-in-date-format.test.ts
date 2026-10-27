import { describe, expect, it } from "vitest";
import { formatCheckInLong, formatCheckInShort } from "../../src/pages/dashboard/dashboardUtils";

// Sat, Oct 25 2025 14:42 UTC.
const CHECKED_IN_AT = Date.UTC(2025, 9, 25, 14, 42);

describe("check-in date formatters", () => {
  it("formats the desktop line as time · dd/mm", () => {
    expect(formatCheckInShort(CHECKED_IN_AT, "America/Chicago")).toBe("9:42 AM · 25/10");
  });

  it("formats the mobile line with weekday, month, day and time", () => {
    expect(formatCheckInLong(CHECKED_IN_AT, "America/Chicago")).toBe("Checked in Sat, Oct 25 · 9:42 AM");
  });

  it("uses the requested zone, including date rollover", () => {
    expect(formatCheckInShort(CHECKED_IN_AT, "Asia/Tokyo")).toBe("11:42 PM · 25/10");
    expect(formatCheckInShort(Date.UTC(2025, 9, 25, 16, 5), "Asia/Tokyo")).toBe("1:05 AM · 26/10");
    expect(formatCheckInLong(Date.UTC(2025, 9, 25, 16, 5), "Asia/Tokyo")).toBe(
      "Checked in Sun, Oct 26 · 1:05 AM",
    );
  });

  it("pads single-digit days and months", () => {
    expect(formatCheckInShort(Date.UTC(2025, 2, 5, 18, 0), "UTC")).toBe("6:00 PM · 05/03");
  });

  it("uses plain spaces, never the ICU narrow no-break space", () => {
    expect(formatCheckInShort(CHECKED_IN_AT, "UTC")).not.toMatch(/\u202f/);
    expect(formatCheckInLong(CHECKED_IN_AT, "UTC")).not.toMatch(/\u202f/);
  });
});
