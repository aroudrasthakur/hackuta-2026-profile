import { useRef, useState, type KeyboardEvent } from "react";
import { WEEKEND_SCHEDULE_DAYS, WEEKEND_SCHEDULE_WHEN } from "../../../shared/hackathon/weekendSchedule";

const dayAnchors = WEEKEND_SCHEDULE_DAYS.map((day) => Date.parse(`${day.isoDate}T12:00:00`));

function nearestDayIndex(now: number) {
  return dayAnchors.reduce((nearest, anchor, index) => {
    const nearestAnchor = dayAnchors[nearest];
    return nearestAnchor === undefined ||
      Math.abs(anchor - now) < Math.abs(nearestAnchor - now)
      ? index
      : nearest;
  }, 0);
}

function formatTime(at: string) {
  const separator = at.indexOf(":");
  if (separator === -1) throw new Error(`Invalid schedule time: ${at}`);

  const hours = Number(at.slice(0, separator));
  const minutes = Number(at.slice(separator + 1));
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    throw new Error(`Invalid schedule time: ${at}`);
  }

  const period = hours < 12 ? "AM" : "PM";
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(minutes).padStart(2, "0")} ${period}`;
}

export function ParticipantSchedulePanel() {
  const [selected, setSelected] = useState(() => nearestDayIndex(Date.now()));
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = WEEKEND_SCHEDULE_DAYS.length - 1;
    const next = {
      ArrowRight: selected === last ? 0 : selected + 1,
      ArrowDown: selected === last ? 0 : selected + 1,
      ArrowLeft: selected === 0 ? last : selected - 1,
      ArrowUp: selected === 0 ? last : selected - 1,
      Home: 0,
      End: last,
    }[event.key];

    if (next === undefined) return;
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  };

  return (
    <section className="participant-schedule" aria-labelledby="participant-schedule-title">
      <div className="participant-schedule__inner">
        <header className="participant-schedule__intro">
          <h1 id="participant-schedule-title" className="participant-schedule__title">
            Schedule
          </h1>
          <p className="participant-schedule__when">{WEEKEND_SCHEDULE_WHEN}</p>
        </header>

        <div className="participant-schedule__tablist" role="tablist" aria-label="Schedule days">
          {WEEKEND_SCHEDULE_DAYS.map((day, index) => (
            <button
              key={day.isoDate}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`participant-schedule-tab-${index + 1}`}
              className="participant-schedule__tab"
              aria-selected={index === selected}
              aria-controls={`participant-schedule-panel-${index + 1}`}
              tabIndex={index === selected ? 0 : -1}
              onClick={() => setSelected(index)}
              onKeyDown={moveFocus}
            >
              <span className="participant-schedule__tab-numeral" aria-hidden="true">
                {day.numeral}
              </span>
              <span className="participant-schedule__tab-label">
                Day {day.numeral}
                <span className="participant-schedule__tab-date">{`${day.weekday}, ${day.date}`}</span>
              </span>
            </button>
          ))}
        </div>

        {WEEKEND_SCHEDULE_DAYS.map((day, index) => (
          <div
            key={day.isoDate}
            id={`participant-schedule-panel-${index + 1}`}
            className="participant-schedule__panel"
            role="tabpanel"
            aria-labelledby={`participant-schedule-tab-${index + 1}`}
            tabIndex={0}
            hidden={index !== selected}
          >
            <div className="participant-schedule__day-head">
              <h2>{day.chapter}</h2>
              <p>{`${day.weekday}, ${day.date}, 2026`}</p>
            </div>
            {day.events.length === 0 ? (
              <p className="participant-schedule__coming-soon">Schedule coming soon!</p>
            ) : (
              <ol className="participant-schedule__timeline">
                {day.events.map((item) => (
                  <li key={item.at} className="participant-schedule__slot">
                    <time dateTime={`${day.isoDate}T${item.at}`}>{formatTime(item.at)}</time>
                    <span>{item.title}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
