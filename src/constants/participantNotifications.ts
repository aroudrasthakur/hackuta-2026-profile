export type ParticipantNotification = {
  id: string;
  title: string;
  body: string;
  postedAt: string;
};

/** Portal announcements — update copy here when organizers need to broadcast changes. */
export const PARTICIPANT_NOTIFICATIONS: ParticipantNotification[] = [
  {
    id: "decisions-channel",
    title: "Decisions are out",
    body: "View your application status on Home. Decision emails go to the address on your application.",
    postedAt: "2026-10-01",
  },
  {
    id: "schedule-updates",
    title: "Schedule updates",
    body: "The full event schedule will appear on the Schedule tab as sessions are finalized. Check back before kickoff.",
    postedAt: "2026-10-15",
  },
  {
    id: "check-in-qr",
    title: "Check-in QR code",
    body: "Accepted hackers can open the Scan tab for their personal QR code. Keep it private and show it only at check-in.",
    postedAt: "2026-10-20",
  },
];
