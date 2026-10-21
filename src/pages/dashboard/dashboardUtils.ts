export function formatCardDate(timestamp: number | null) {
  if (timestamp === null) return { month: "TBA", day: "—" };
  const date = new Date(timestamp);
  return {
    month: date.toLocaleString("en-US", { month: "short", timeZone: "America/Chicago" }),
    day: date.toLocaleString("en-US", { day: "2-digit", timeZone: "America/Chicago" }),
  };
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
