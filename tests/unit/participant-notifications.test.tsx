// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatNotificationTimestamp,
  isInternalNotificationLink,
  NOTIFICATION_TYPE_LABELS,
} from "../../src/constants/participantNotifications";
import type { ParticipantNotificationItem } from "../../src/convex/api";
import ParticipantNotificationsPage from "../../src/pages/dashboard/ParticipantNotificationsPage";

const mockHookState = vi.hoisted(() => ({
  loading: false,
  notifications: [] as ParticipantNotificationItem[],
}));

vi.mock("../../src/pages/dashboard/useParticipantNotifications", () => ({
  useParticipantNotifications: () => mockHookState,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mockHookState.loading = false;
  mockHookState.notifications = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderNotificationsPage() {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={["/dashboard/notifications"]}>
        <ParticipantNotificationsPage />
      </MemoryRouter>,
    ),
  );
}

describe("ParticipantNotificationsPage & helpers", () => {
  it("formats timestamps and distinguishes internal vs external links", () => {
    expect(isInternalNotificationLink("/dashboard/schedule")).toBe(true);
    expect(isInternalNotificationLink("//evil.example")).toBe(false);
    expect(isInternalNotificationLink("https://hackuta.org")).toBe(false);
    expect(NOTIFICATION_TYPE_LABELS.flash_sale).toBe("Flash sale");
    expect(formatNotificationTimestamp(Date.UTC(2026, 9, 20, 17, 0, 0))).toContain("2026");
  });

  it("renders a loading state while notifications are loading", async () => {
    mockHookState.loading = true;
    await renderNotificationsPage();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Loading notifications…",
    );
  });

  it("renders a polished empty state when no notifications are published", async () => {
    mockHookState.loading = false;
    mockHookState.notifications = [];
    await renderNotificationsPage();
    expect(container.textContent).toContain("No notifications yet");
    expect(container.textContent).toContain(
      "When organizers publish event announcements, reminders, or shop flash sales, they will appear here automatically.",
    );
  });

  it("renders published notification cards with type badges, timestamps, and internal/external links", async () => {
    mockHookState.notifications = [
      {
        notificationId: "notif-1",
        title: "Shop Flash Sale",
        message: "T-shirts are 300 points for the next hour.",
        type: "flash_sale",
        publishedAt: Date.UTC(2026, 9, 21, 18, 0, 0),
        expiresAt: null,
        linkUrl: "/dashboard",
        linkLabel: "Open Dashboard",
      },
      {
        notificationId: "notif-2",
        title: "Submission Rules",
        message: "Review Devpost submission criteria.",
        type: "important",
        publishedAt: Date.UTC(2026, 9, 20, 15, 0, 0),
        expiresAt: null,
        linkUrl: "https://hackuta.org/rules",
        linkLabel: "Read rules",
      },
    ];

    await renderNotificationsPage();

    const headings = Array.from(container.querySelectorAll("article h2")).map(
      (node) => node.textContent,
    );
    expect(headings).toEqual(["Shop Flash Sale", "Submission Rules"]);

    const badges = Array.from(
      container.querySelectorAll(".participant-notifications__badge"),
    ).map((node) => node.textContent);
    expect(badges).toEqual(["Flash sale", "Important"]);

    const internalLink = container.querySelector('a[href="/dashboard"]');
    expect(internalLink?.textContent).toBe("Open Dashboard");
    expect(internalLink?.getAttribute("target")).toBeNull();

    const externalLink = container.querySelector('a[href="https://hackuta.org/rules"]');
    expect(externalLink?.textContent).toBe("Read rules");
    expect(externalLink?.getAttribute("target")).toBe("_blank");
    expect(externalLink?.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
