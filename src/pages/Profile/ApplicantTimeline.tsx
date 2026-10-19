import type { TimelineEvent } from "../../../shared/hackathon/timeline";
import { formatCentralRegistrationTime } from "../../../shared/hackathon/schedule";
import {
  profileTimelineDate,
  profileTimelineDescription,
  profileTimelineLabel,
  profileTimelineNextUp,
} from "./profileStyles";
import { formatTimelineDate } from "./timelineDate";

function eventDateLabel(event: TimelineEvent) {
  if (event.dateLabel) return event.dateLabel;
  if (event.timestamp) {
    return event.id === "applications-open" || event.id === "application-deadline"
      ? formatCentralRegistrationTime(event.timestamp)
      : formatTimelineDate(event.timestamp);
  }
  return "To be announced";
}

export function ApplicantTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return null;

  const nextUpId = events.find((event) => !event.complete)?.id;

  return (
    <section aria-label="Application timeline">
      <h3 className="sr-only">Timeline</h3>
      <ol className="divide-y divide-(--sand)">
        {events.map((event) => {
          const isNextUp = event.id === nextUpId;

          return (
            <li
              key={event.id}
              data-complete={event.complete ? "true" : "false"}
              className={`grid gap-1 py-4 first:pt-0 last:pb-0 sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:gap-6 ${
                event.complete ? "opacity-70" : ""
              }`}
            >
              <p className={profileTimelineDate}>{eventDateLabel(event)}</p>
              <div>
                {isNextUp ? (
                  <p className={profileTimelineNextUp}>Next up</p>
                ) : null}
                <p className={profileTimelineLabel}>{event.label}</p>
                {event.description ? (
                  <p className={profileTimelineDescription}>{event.description}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
