type DecisionKind = "accepted" | "rejected" | "waitlisted";

const EVENT_WHEN = "November 14–15, 2026";
const EVENT_WHERE = "the University of Texas at Arlington in Arlington, Texas";
const WEBSITE_URL = "https://hackuta.com";
const DISCORD_URL = "https://discord.gg/2bVsYS3SgS";
const CONTACT_EMAIL = "hello@hackuta.org";

function paragraphs(...blocks: string[]) {
  return blocks.filter(Boolean).join("\n\n");
}

function decisionBody(decision: DecisionKind, hackathonName: string) {
  if (decision === "accepted") {
    return paragraphs(
      `Congratulations. Your application to ${hackathonName} has been accepted, and we would like you to join us.`,
      `${hackathonName} is a free, in-person, 24-hour hackathon on ${EVENT_WHEN} at ${EVENT_WHERE}. Meals, snacks, workspace, and swag are provided. Please bring a laptop, charger, and a government-issued photo ID or student ID for check-in. All project work must be done during the event.`,
      "We will email logistics, the schedule, and travel notes as the weekend gets closer. Until then, you can find event information and team formation here:",
      WEBSITE_URL,
      DISCORD_URL,
      `If your plans change and you can no longer attend, reply to this email or write to ${CONTACT_EMAIL} so we can offer your spot to someone on the waitlist.`,
      "We look forward to building with you.",
    );
  }

  if (decision === "rejected") {
    return paragraphs(
      `Thank you for applying to ${hackathonName}. We read every application, and this year we received more strong applications than we can host.`,
      "After review, we are not able to offer you a spot. That decision is about limited space, not a judgment of your ability or your ideas. We hope you keep building, and you are welcome to apply again in a future year.",
      `If you have a question about this decision, you can reach the organizing team at ${CONTACT_EMAIL}.`,
      "Thank you again for the time you put into your application.",
    );
  }

  return paragraphs(
    `Thank you for applying to ${hackathonName}. We have reviewed your application, and you are on the waitlist.`,
    `A waitlist place is not an acceptance. We are holding a limited number of spots for ${EVENT_WHEN} at ${EVENT_WHERE}. If a confirmed attendee releases a spot, we will email this address with an acceptance. You do not need to submit another application or take any action right now.`,
    "Please watch this inbox, including spam and promotions, until the event. We will not contact you again unless a spot opens or we need something from you.",
    `Questions can go to ${CONTACT_EMAIL}. You can also follow updates at ${WEBSITE_URL} and on Discord: ${DISCORD_URL}.`,
    "Thank you for your patience.",
  );
}

const subjects: Record<DecisionKind, (hackathonName: string) => string> = {
  accepted: (hackathonName) => `You're accepted to ${hackathonName}`,
  rejected: (hackathonName) => `Update on your ${hackathonName} application`,
  waitlisted: (hackathonName) => `You're on the ${hackathonName} waitlist`,
};

export function buildDecisionEmailContent(args: {
  decision: DecisionKind;
  applicantName: string;
  hackathonName: string;
}) {
  const hackathonName = args.hackathonName.trim() || "HackUTA";
  const applicantName = args.applicantName.trim();
  const greeting = applicantName ? `Hi ${applicantName},` : "Hi,";
  const text = [
    greeting,
    "",
    decisionBody(args.decision, hackathonName),
    "",
    `The ${hackathonName} Team`,
    CONTACT_EMAIL,
  ].join("\n");

  return {
    subject: subjects[args.decision](hackathonName),
    text,
  };
}
