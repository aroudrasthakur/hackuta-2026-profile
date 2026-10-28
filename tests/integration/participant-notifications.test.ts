import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listPublishedNotificationsRef } from "../../src/convex/api";
import { createConvexTest } from "../helpers/convexTestContext";
import { seedApplicant, seedStaff } from "../helpers/reviewTestKit";

const NOW = Date.UTC(2026, 10, 14, 15, 0, 0);
const MINUTE = 60_000;

const saveDraftRef = makeFunctionReference<"mutation">(
  "admin/notifications:saveNotificationDraft",
);
const publishNowRef = makeFunctionReference<"mutation">(
  "admin/notifications:publishNotificationNow",
);
const scheduleRef = makeFunctionReference<"mutation">(
  "admin/notifications:scheduleNotification",
);
const cancelRef = makeFunctionReference<"mutation">(
  "admin/notifications:cancelNotification",
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("participant notifications integration (profile)", () => {
  it("exposes only published, non-expired notifications sorted newest-first and never leaks drafts or scheduled items", async () => {
    const t = createConvexTest();
    const admin = await seedStaff(t, { role: "admin" });
    const { userId } = await seedApplicant(t, { review: { status: "accepted" } });
    const asParticipant = t.withIdentity({ subject: userId, email: "taylor@example.com" });

    // Unauthenticated returns null
    expect(await t.query(listPublishedNotificationsRef, {})).toBeNull();

    // Draft must not appear
    await t.mutation(saveDraftRef, {
      sessionToken: admin.sessionToken,
      title: "Secret Draft",
      message: "Do not show yet",
      type: "general",
    });

    // Future scheduled must not appear yet
    const { notificationId: scheduledId } = await t.mutation(scheduleRef, {
      sessionToken: admin.sessionToken,
      title: "Scheduled Workshop",
      message: "Starts at 3:20 PM",
      type: "event",
      scheduledAt: NOW + 20 * MINUTE,
      linkUrl: "/dashboard/schedule",
      linkLabel: "View Schedule",
    });

    // Cancelled scheduled notification must never appear
    const { notificationId: cancelledId } = await t.mutation(scheduleRef, {
      sessionToken: admin.sessionToken,
      title: "Cancelled Talk",
      message: "Speaker unavailable",
      type: "event",
      scheduledAt: NOW + 10 * MINUTE,
    });
    await t.mutation(cancelRef, {
      sessionToken: admin.sessionToken,
      notificationId: cancelledId,
    });

    expect(await asParticipant.query(listPublishedNotificationsRef, {})).toEqual([]);

    // Publish two notifications at different times
    await t.mutation(publishNowRef, {
      sessionToken: admin.sessionToken,
      title: "Lunch is Ready",
      message: "Main atrium check-in is open.",
      type: "general",
    });

    vi.advanceTimersByTime(5 * MINUTE);
    await t.mutation(publishNowRef, {
      sessionToken: admin.sessionToken,
      title: "Quick Raffle",
      message: "Enter at the sponsor booth in the next 5 minutes.",
      type: "flash_sale",
      expiresAt: NOW + 10 * MINUTE,
    });

    const feedAt5 = await asParticipant.query(listPublishedNotificationsRef, {});
    expect(feedAt5?.map((n) => n.title)).toEqual(["Quick Raffle", "Lunch is Ready"]);

    // Advance timers to NOW + 20 * MINUTE: Quick Raffle expires, Cancelled Talk stays hidden, Scheduled Workshop publishes
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const feedAt20 = await asParticipant.query(listPublishedNotificationsRef, {});
    expect(feedAt20).toEqual([
      {
        notificationId: String(scheduledId),
        title: "Scheduled Workshop",
        message: "Starts at 3:20 PM",
        type: "event",
        publishedAt: NOW + 20 * MINUTE,
        expiresAt: null,
        linkUrl: "/dashboard/schedule",
        linkLabel: "View Schedule",
      },
      expect.objectContaining({
        title: "Lunch is Ready",
        type: "general",
        publishedAt: NOW,
      }),
    ]);
  });
});
