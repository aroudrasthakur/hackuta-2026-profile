import type {
  ParticipantNotificationItem,
  ParticipantNotificationType,
} from "../convex/api";

export type ParticipantNotification = ParticipantNotificationItem;

export const NOTIFICATION_TYPE_LABELS: Record<ParticipantNotificationType, string> = {
  general: "General",
  event: "Event",
  reminder: "Reminder",
  flash_sale: "Flash sale",
  important: "Important",
};

const notificationDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatNotificationTimestamp(publishedAt: number): string {
  return notificationDateTimeFormatter.format(new Date(publishedAt));
}

export function isInternalNotificationLink(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

/** Default portal notifications used when mock API mode is active in E2E tests. */
export const PARTICIPANT_NOTIFICATIONS: ParticipantNotificationItem[] = [
  {
    notificationId: "check-in-qr",
    title: "Check-in QR code",
    message:
      "Accepted hackers can open the Check-in tab for their personal QR code. It is only for your first check-in at the desk. After that, the QR code on your physical badge is your pass for meals, event points, and the shop.",
    type: "important",
    publishedAt: Date.UTC(2026, 9, 20, 17, 0, 0),
    expiresAt: null,
    linkUrl: "/dashboard/scan",
    linkLabel: "Open Check-in",
  },
  {
    notificationId: "schedule-updates",
    title: "Schedule updates",
    message:
      "The full event schedule is available on the Schedule tab as sessions are finalized. Check back before kickoff.",
    type: "event",
    publishedAt: Date.UTC(2026, 9, 15, 17, 0, 0),
    expiresAt: null,
    linkUrl: "/dashboard/schedule",
    linkLabel: "View Schedule",
  },
  {
    notificationId: "decisions-channel",
    title: "Decisions are out",
    message:
      "View your application status on Home. Decision emails go to the address on your application.",
    type: "general",
    publishedAt: Date.UTC(2026, 9, 1, 17, 0, 0),
    expiresAt: null,
    linkUrl: "/dashboard",
    linkLabel: "Go to Home",
  },
];
