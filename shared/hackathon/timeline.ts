import type { HackathonTimelineSource } from "./schedule";

export const UNKNOWN_TIMELINE_DATE_LABEL = "To be announced";

export type TimelineEvent = {
  id: string;
  label: string;
  timestamp: number | null;
  complete: boolean;
  dateLabel?: string;
  description?: string;
};

function milestone(event: {
  id: string;
  label: string;
  timestamp: number | null;
  now: number;
  description: string;
}): TimelineEvent {
  const { timestamp, now, ...rest } = event;
  return {
    ...rest,
    timestamp,
    complete: timestamp !== null && now >= timestamp,
    ...(timestamp === null ? { dateLabel: UNKNOWN_TIMELINE_DATE_LABEL } : {}),
  };
}

export function buildHackathonTimeline(
  hackathon: HackathonTimelineSource,
  now = Date.now(),
): TimelineEvent[] {
  return [
    milestone({
      id: "applications-open",
      label: "Applications open",
      timestamp: hackathon.registrationOpensAt,
      now,
      description:
        "Submit your application any time before the deadline. Your progress is saved automatically.",
    }),
    milestone({
      id: "application-deadline",
      label: "Applications close",
      timestamp: hackathon.registrationClosesAt,
      now,
      description: "Applications are no longer accepted after this deadline.",
    }),
    milestone({
      id: "decisions-out",
      label: "Decisions go out",
      timestamp: hackathon.decisionsReleasedAt ?? null,
      now,
      description: "All applicants will receive an email with their application decision.",
    }),
    milestone({
      id: "hackathon-begins",
      label: "The hackathon begins",
      timestamp: hackathon.startsAt,
      now,
      description: "Check in using the code available on your account page.",
    }),
  ];
}
