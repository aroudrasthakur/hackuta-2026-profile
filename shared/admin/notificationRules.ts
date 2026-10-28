import { adminError } from "./errors";

export const NOTIFICATION_TYPES = [
  "general",
  "event",
  "reminder",
  "flash_sale",
  "important",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_STATUSES = [
  "draft",
  "scheduled",
  "published",
  "cancelled",
] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_TITLE_MAX_LENGTH = 120;
export const NOTIFICATION_MESSAGE_MAX_LENGTH = 1_000;
export const NOTIFICATION_LINK_URL_MAX_LENGTH = 500;
export const NOTIFICATION_LINK_LABEL_MAX_LENGTH = 60;
export const NOTIFICATION_SEARCH_MAX_LENGTH = 100;

export type NotificationContentInput = {
  title: string;
  message: string;
  type: NotificationType;
  linkUrl?: string | null;
  linkLabel?: string | null;
  expiresAt?: number | null;
};

export type NormalizedNotificationContent = {
  title: string;
  message: string;
  type: NotificationType;
  linkUrl?: string;
  linkLabel?: string;
  expiresAt?: number;
};

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

export function isNotificationStatus(value: unknown): value is NotificationStatus {
  return typeof value === "string" && (NOTIFICATION_STATUSES as readonly string[]).includes(value);
}

/**
 * Accepts internal absolute paths (e.g. `/dashboard/schedule`) or `http(s)://` URLs.
 * Rejects protocol-relative (`//`), `javascript:`, `data:`, or malformed URLs.
 */
export function normalizeNotificationLinkUrl(url?: string | null): string | undefined {
  if (url == null) return undefined;
  if (typeof url !== "string") throw adminError("INVALID_NOTIFICATION");
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > NOTIFICATION_LINK_URL_MAX_LENGTH || /[\s\u0000-\u001F\u007F]/.test(trimmed)) {
    throw adminError("INVALID_NOTIFICATION");
  }
  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("//")) throw adminError("INVALID_NOTIFICATION");
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw adminError("INVALID_NOTIFICATION");
    }
    return trimmed;
  } catch {
    throw adminError("INVALID_NOTIFICATION");
  }
}

export function normalizeNotificationLinkLabel(
  label: string | null | undefined,
  hasLinkUrl: boolean,
): string | undefined {
  if (label == null) return undefined;
  if (typeof label !== "string") throw adminError("INVALID_NOTIFICATION");
  const trimmed = label.trim();
  if (!trimmed) return undefined;
  if (!hasLinkUrl || trimmed.length > NOTIFICATION_LINK_LABEL_MAX_LENGTH) {
    throw adminError("INVALID_NOTIFICATION");
  }
  return trimmed;
}

export function normalizeNotificationInput(
  input: NotificationContentInput,
): NormalizedNotificationContent {
  if (typeof input.title !== "string" || typeof input.message !== "string") {
    throw adminError("INVALID_NOTIFICATION");
  }
  const title = input.title.trim();
  const message = input.message.trim();
  if (
    !title ||
    title.length > NOTIFICATION_TITLE_MAX_LENGTH ||
    !message ||
    message.length > NOTIFICATION_MESSAGE_MAX_LENGTH ||
    !isNotificationType(input.type)
  ) {
    throw adminError("INVALID_NOTIFICATION");
  }

  const linkUrl = normalizeNotificationLinkUrl(input.linkUrl);
  const linkLabel = normalizeNotificationLinkLabel(input.linkLabel, linkUrl !== undefined);

  let expiresAt: number | undefined;
  if (input.expiresAt != null) {
    if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0) {
      throw adminError("INVALID_NOTIFICATION_SCHEDULE");
    }
    expiresAt = input.expiresAt;
  }

  return {
    title,
    message,
    type: input.type,
    ...(linkUrl !== undefined ? { linkUrl } : {}),
    ...(linkLabel !== undefined ? { linkLabel } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

export function assertNotificationSchedule(
  scheduledAt: number,
  now: number,
  expiresAt?: number,
): number {
  if (!Number.isSafeInteger(scheduledAt) || scheduledAt <= now) {
    throw adminError("INVALID_NOTIFICATION_SCHEDULE");
  }
  if (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt <= scheduledAt)) {
    throw adminError("INVALID_NOTIFICATION_SCHEDULE");
  }
  return scheduledAt;
}

export function assertNotificationExpiry(publishAt: number, expiresAt?: number): void {
  if (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt <= publishAt)) {
    throw adminError("INVALID_NOTIFICATION_SCHEDULE");
  }
}

export function normalizeNotificationSearch(search?: string): string {
  if (search === undefined) return "";
  if (typeof search !== "string") throw adminError("INVALID_NOTIFICATION_FILTER");
  const trimmed = search.trim();
  if (trimmed.length > NOTIFICATION_SEARCH_MAX_LENGTH) {
    throw adminError("INVALID_NOTIFICATION_FILTER");
  }
  return trimmed.toLowerCase();
}
