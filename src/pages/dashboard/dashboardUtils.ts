export { profileInitials } from "../../lib/participantDisplay";

export function formatCardDate(timestamp: number | null) {
  if (timestamp === null) return { month: "TBA", day: "—" };
  const date = new Date(timestamp);
  return {
    month: date.toLocaleString("en-US", { month: "short", timeZone: "America/Chicago" }),
    day: date.toLocaleString("en-US", { day: "2-digit", timeZone: "America/Chicago" }),
  };
}

/** ICU may join the time and AM/PM with a narrow no-break space; keep a plain space for display and tests. */
function formatCheckInClock(date: Date, timeZone?: string) {
  return date
    .toLocaleString("en-US", { hour: "numeric", minute: "2-digit", timeZone })
    .replace(/\u202f/g, " ");
}

/** Desktop check-in line, e.g. "9:42 AM · 25/10". `timeZone` defaults to the viewer's local zone. */
export function formatCheckInShort(timestamp: number, timeZone?: string) {
  const date = new Date(timestamp);
  const day = date.toLocaleString("en-US", { day: "2-digit", timeZone });
  const month = date.toLocaleString("en-US", { month: "2-digit", timeZone });
  return `${formatCheckInClock(date, timeZone)} · ${day}/${month}`;
}

/** Mobile check-in line, e.g. "Checked in Sat, Oct 25 · 9:42 AM". `timeZone` defaults to the viewer's local zone. */
export function formatCheckInLong(timestamp: number, timeZone?: string) {
  const date = new Date(timestamp);
  const day = date.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
  return `Checked in ${day} · ${formatCheckInClock(date, timeZone)}`;
}

export function statusLabel(status: string | null) {
  switch (status) {
    case "accepted":
      return { label: "Accepted", tone: "accepted" as const };
    case "waitlisted":
      return { label: "Waitlisted", tone: "waitlisted" as const };
    case "rejected":
      return { label: "Not admitted", tone: "rejected" as const };
    case "under_review":
      return { label: "In review", tone: "pending" as const };
    case "unreviewed":
      return { label: "Submitted", tone: "pending" as const };
    default:
      return { label: "No application", tone: "neutral" as const };
  }
}

export function statusBannerCopy(reviewStatus: string | null, submitted: boolean) {
  if (reviewStatus === "accepted") {
    return "Congratulations! Your application has been accepted.";
  }
  if (reviewStatus === "waitlisted") {
    return "You are on the waitlist. We will email you if a spot opens.";
  }
  if (reviewStatus === "rejected") {
    return "Thank you for applying. We hope to see you at a future HackUTA.";
  }
  if (submitted) {
    return "Your application is on file. We will email you when decisions are released.";
  }
  return "Complete your registration application to be considered for the event.";
}
