import { useEffect, useState } from "react";
import {
  listPublishedNotificationsRef,
  type ParticipantNotificationItem,
} from "../../convex/api";
import { getConvexClient } from "../../convex/client";
import { useQuery } from "../../convex/reactBindings";
import { PARTICIPANT_NOTIFICATIONS } from "../../constants/participantNotifications";
import { useMockAuth } from "../../hooks/useMockAuth";

declare global {
  interface Window {
    __hackutaMockNotifications?: {
      setNotifications: (items: ParticipantNotificationItem[]) => void;
    };
  }
}

const REFRESH_INTERVAL_MS = 60_000;

export function useParticipantNotifications(): {
  loading: boolean;
  notifications: ParticipantNotificationItem[];
} {
  const mockAuth = useMockAuth();
  const client = getConvexClient();
  const [nowBucket, setNowBucket] = useState(() => Math.floor(Date.now() / REFRESH_INTERVAL_MS));
  const [mockItems, setMockItems] = useState<ParticipantNotificationItem[]>(
    () => PARTICIPANT_NOTIFICATIONS,
  );

  useEffect(() => {
    if (!mockAuth.enabled) return;
    window.__hackutaMockNotifications = {
      setNotifications: (items) => {
        const sorted = [...items].sort((a, b) => b.publishedAt - a.publishedAt);
        setMockItems(sorted);
      },
    };
    return () => {
      delete window.__hackutaMockNotifications;
    };
  }, [mockAuth.enabled]);

  useEffect(() => {
    if (mockAuth.enabled) return;
    const interval = window.setInterval(() => {
      setNowBucket(Math.floor(Date.now() / REFRESH_INTERVAL_MS));
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [mockAuth.enabled]);

  const queried = useQuery(
    listPublishedNotificationsRef,
    client && !mockAuth.enabled ? { nowBucket } : "skip",
  );

  useEffect(() => {
    if (mockAuth.enabled || !queried) return;
    const now = Date.now();
    let earliestExpiry: number | null = null;
    for (const item of queried) {
      if (item.expiresAt !== null && item.expiresAt > now) {
        earliestExpiry =
          earliestExpiry === null ? item.expiresAt : Math.min(earliestExpiry, item.expiresAt);
      }
    }
    if (earliestExpiry === null) return;
    const delay = Math.max(250, earliestExpiry - now + 50);
    const timeout = window.setTimeout(() => {
      setNowBucket((prev) => prev + 1);
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [mockAuth.enabled, queried]);

  if (mockAuth.enabled) {
    return { loading: false, notifications: mockItems };
  }

  if (queried === undefined) {
    return { loading: true, notifications: [] };
  }

  return {
    loading: false,
    notifications: queried ?? [],
  };
}
