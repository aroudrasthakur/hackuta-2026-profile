import { Component, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ParticipantPageHeader } from "./ParticipantPageHeader";
import {
  formatScheduleDate,
  formatScheduleTime,
  groupScheduleEntriesByDay,
  scheduleDayNumeral,
  scheduleDateKey,
} from "./scheduleUtils";
import { useParticipantSchedule } from "../../pages/dashboard/useParticipantSchedule";

function nearestDayIndex(days: Array<{ date: string }>) {
  const today = scheduleDateKey(Date.now());
  const todayAtNoon = Date.parse(`${today}T12:00:00Z`);
  return days.reduce((nearest, day, index) => {
    const nearestDay = days[nearest];
    if (!nearestDay) return index;
    const dayDistance = Math.abs(Date.parse(`${day.date}T12:00:00Z`) - todayAtNoon);
    const nearestDistance = Math.abs(Date.parse(`${nearestDay.date}T12:00:00Z`) - todayAtNoon);
    return dayDistance < nearestDistance ? index : nearest;
  }, 0);
}

function ScheduleContent() {
  const { loading, error, data } = useParticipantSchedule();
  const days = groupScheduleEntriesByDay(
    data?.entries ?? [],
    data?.eventStartsAt,
    data?.eventEndsAt,
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(
    0,
    days.findIndex((day) => day.date === selectedDate),
  );
  const activeIndex = days.some((day) => day.date === selectedDate)
    ? selectedIndex
    : days.length > 0
      ? nearestDayIndex(days)
      : -1;

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (days.length === 0) return;
    const next = {
      ArrowRight: activeIndex === days.length - 1 ? 0 : activeIndex + 1,
      ArrowDown: activeIndex === days.length - 1 ? 0 : activeIndex + 1,
      ArrowLeft: activeIndex === 0 ? days.length - 1 : activeIndex - 1,
      ArrowUp: activeIndex === 0 ? days.length - 1 : activeIndex - 1,
      Home: 0,
      End: days.length - 1,
    }[event.key];

    if (next === undefined) return;
    event.preventDefault();
    const day = days[next];
    if (!day) return;
    setSelectedDate(day.date);
    tabs.current[next]?.focus();
  };

  return (
    <section className="participant-schedule" aria-labelledby="participant-schedule-title">
      <div className="participant-schedule__inner">
        <ParticipantPageHeader
          id="participant-schedule-title"
          title="Schedule"
          description="HackUTA 2026 · UT Arlington · Times shown in Central Time"
        />

        {loading ? (
          <p className="participant-schedule__coming-soon" role="status">
            Loading schedule…
          </p>
        ) : error ? (
          <p className="participant-schedule__coming-soon" role="alert">
            We could not load the schedule. Try reloading the page.
          </p>
        ) : days.length === 0 ? (
          <p className="participant-schedule__coming-soon" role="status">
            Schedule coming soon!
          </p>
        ) : (
          <>
            <div className="participant-schedule__tablist" role="tablist" aria-label="Schedule days">
              {days.map((day, index) => (
                <button
                  key={day.date}
                  ref={(node) => {
                    tabs.current[index] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`participant-schedule-tab-${index + 1}`}
                  className="participant-schedule__tab"
                  aria-selected={index === activeIndex}
                  aria-controls={`participant-schedule-panel-${index + 1}`}
                  tabIndex={index === activeIndex ? 0 : -1}
                  onClick={() => setSelectedDate(day.date)}
                  onKeyDown={moveFocus}
                >
                  <span className="participant-schedule__tab-numeral" aria-hidden="true">
                    {scheduleDayNumeral(index + 1)}
                  </span>
                  <span className="participant-schedule__tab-label">
                    Day {scheduleDayNumeral(index + 1)}
                    <span className="participant-schedule__tab-date">{formatScheduleDate(day.date)}</span>
                  </span>
                </button>
              ))}
            </div>

            {days.map((day, index) => (
              <div
                key={day.date}
                id={`participant-schedule-panel-${index + 1}`}
                className="participant-schedule__panel"
                role="tabpanel"
                aria-labelledby={`participant-schedule-tab-${index + 1}`}
                tabIndex={0}
                hidden={index !== activeIndex}
              >
                <div className="participant-schedule__day-head">
                  <h2>Day {scheduleDayNumeral(index + 1)}</h2>
                  <p>{formatScheduleDate(day.date, true)}</p>
                </div>
                <ol className="participant-schedule__timeline">
                  {day.entries.length === 0 ? (
                    <li className="participant-schedule__coming-soon" role="status">
                      Schedule coming soon!
                    </li>
                  ) : (
                    day.entries.map((entry) => (
                      <li key={`${day.date}-${entry.id}`} className="participant-schedule__slot">
                        <time dateTime={new Date(entry.startsAt).toISOString()}>
                          {formatScheduleTime(entry.startsAt)} – {formatScheduleTime(entry.endsAt)}
                        </time>
                        <div className="participant-schedule__slot-details">
                          <div className="participant-schedule__slot-heading">
                            <h3>{entry.title}</h3>
                            <span className="participant-schedule__category">{entry.category}</span>
                          </div>
                          {entry.location ? (
                            <p className="participant-schedule__location">{entry.location}</p>
                          ) : null}
                          {entry.description ? <p>{entry.description}</p> : null}
                        </div>
                      </li>
                    ))
                  )}
                </ol>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

type ScheduleErrorBoundaryState = { hasError: boolean };

class ScheduleErrorBoundary extends Component<
  { children: ReactNode },
  ScheduleErrorBoundaryState
> {
  state: ScheduleErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ScheduleErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("Participant schedule query failed.", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="participant-schedule" aria-labelledby="participant-schedule-title">
          <div className="participant-schedule__inner">
            <ParticipantPageHeader
              id="participant-schedule-title"
              title="Schedule"
              description="HackUTA 2026 · UT Arlington · Times shown in Central Time"
            />
            <p className="participant-schedule__coming-soon" role="alert">
              We could not load the schedule. Try reloading the page.
            </p>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}

export function ParticipantSchedulePanel() {
  return (
    <ScheduleErrorBoundary>
      <ScheduleContent />
    </ScheduleErrorBoundary>
  );
}
