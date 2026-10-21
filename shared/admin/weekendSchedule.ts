/** Event weekend schedule (mirrors landing page Schedule component data). */
export type WeekendScheduleEvent = {
  at: string;
  title: string;
};

export type WeekendScheduleDay = {
  numeral: string;
  chapter: string;
  weekday: string;
  date: string;
  isoDate: string;
  events: WeekendScheduleEvent[];
};

export const WEEKEND_SCHEDULE_DAYS: WeekendScheduleDay[] = [
  {
    numeral: "I",
    chapter: "Day One",
    weekday: "Saturday",
    date: "November 14",
    isoDate: "2026-11-14",
    events: [],
  },
  {
    numeral: "II",
    chapter: "Day Two",
    weekday: "Sunday",
    date: "November 15",
    isoDate: "2026-11-15",
    events: [],
  },
];

export const WEEKEND_SCHEDULE_WHEN = "November 14–15, 2026 · UT Arlington";
