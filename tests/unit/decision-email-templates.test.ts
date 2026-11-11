import { describe, expect, it } from "vitest";
import { buildDecisionEmailContent } from "../../convex/admin/decisionEmailTemplates";

describe("decision email templates", () => {
  it.each(["accepted", "rejected", "waitlisted"] as const)(
    "builds %s copy with the hackathon name",
    (decision) => {
      const content = buildDecisionEmailContent({
        decision,
        applicantName: "Taylor",
        hackathonName: "HackUTA 2026",
      });
      expect(content.subject).toContain("HackUTA 2026");
      expect(content.text).toContain("Hi Taylor,");
      expect(content.text).toContain("The HackUTA 2026 Team");
      expect(content.text).toContain("Questions? Contact us at hello@hackuta.org");
    },
  );

  it("tells accepted applicants when and where to show up, and how to prepare", () => {
    const { subject, text } = buildDecisionEmailContent({
      decision: "accepted",
      applicantName: "Taylor",
      hackathonName: "HackUTA 2026",
    });
    expect(subject).toBe("You're accepted to HackUTA 2026");
    expect(text).toContain("November 14–15, 2026");
    expect(text).toContain("University of Texas at Arlington");
    expect(text).not.toContain("UTA ID for check-in");
    expect(text).not.toContain("team-formation channel on our discord");
    expect(text).toContain("https://discord.gg/2bVsYS3SgS");
    expect(text).not.toContain("offer your spot to someone on the waitlist");
    expect(text).toContain("Before you arrive, please read the guide below");
    expect(text).toContain("IMPORTANT Day-Of Information");
    expect(text).toContain("https://docs.hackuta.com/HackUTA%202026%20Hacker%20Instructions.pdf");
    expect(text).toContain("https://hacker.hackuta.com");
    expect(text).toContain("QR code to complete the check-in process");
    expect(text).toContain("primary way to communicate with you");
    expect(text).toContain("we encourage you to post in the discord");
    expect(text).toContain("We look forward to seeing what you build");
    expect(text).not.toContain("Stay tuned for next steps");
  });

  it("explains a rejection as limited space and invites a future application", () => {
    const { subject, text } = buildDecisionEmailContent({
      decision: "rejected",
      applicantName: "Taylor",
      hackathonName: "HackUTA 2026",
    });
    expect(subject).toBe("Update on your HackUTA 2026 application");
    expect(text).toContain("not able to offer you a spot");
    expect(text).toContain("limited space");
    expect(text).toContain("apply again in a future year");
  });

  it("tells waitlisted applicants they are not accepted and will be emailed if a spot opens", () => {
    const { subject, text } = buildDecisionEmailContent({
      decision: "waitlisted",
      applicantName: "Taylor",
      hackathonName: "HackUTA 2026",
    });
    expect(subject).toBe("You're on the HackUTA 2026 waitlist");
    expect(text).toContain("not an acceptance");
    expect(text).toContain("do not need to submit another application");
  });
});
