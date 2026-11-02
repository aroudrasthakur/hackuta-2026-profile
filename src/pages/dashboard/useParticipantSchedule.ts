import { useQuery } from "../../convex/reactBindings";
import { listPublicScheduleRef, type ParticipantSchedule } from "../../convex/api";
import { getConvexClient } from "../../convex/client";
import { useMockAuth } from "../../hooks/useMockAuth";
import { HACKATHON_SCHEDULE } from "../../../shared/hackathon/schedule";

export function useParticipantSchedule(): {
  loading: boolean;
  error: boolean;
  data: ParticipantSchedule | null;
} {
  const mockAuth = useMockAuth();
  const client = getConvexClient();
  const schedule = useQuery(
    listPublicScheduleRef,
    client && !mockAuth.enabled ? {} : "skip",
  );

  if (mockAuth.enabled) {
    return {
      loading: false,
      error: false,
      data: {
        eventStartsAt: HACKATHON_SCHEDULE.startsAt,
        eventEndsAt: HACKATHON_SCHEDULE.endsAt,
        entries: [],
      },
    };
  }

  if (!client) {
    return { loading: false, error: true, data: null };
  }

  if (schedule === undefined) {
    return { loading: true, error: false, data: null };
  }

  return { loading: false, error: false, data: schedule };
}
