function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildPasswordResetEmailContent(code: string) {
  const text = [
    "Your HackUTA password reset code",
    "",
    code,
    "",
    "This code expires in 10 minutes.",
    "Do not share this code with anyone.",
    "If you did not request a password reset, you can safely ignore this email.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="font-family: sans-serif; color: #1a3a52;">
  <p>Your HackUTA password reset code is:</p>
  <p style="font-size: 28px; font-weight: bold; letter-spacing: 0.2em;">${escapeHtml(code)}</p>
  <p>This code expires in <strong>10 minutes</strong>.</p>
  <p>Do not share this code with anyone.</p>
  <p>If you did not request a password reset, you can safely ignore this email.</p>
</body>
</html>`;

  return {
    subject: "Your HackUTA password reset code",
    text,
    html,
  };
}

export function buildOtpEmailContent(code: string) {
  const text = [
    "Your HackUTA verification code",
    "",
    code,
    "",
    "This code expires in 10 minutes.",
    "Do not share this code with anyone.",
    "If you did not request this email, you can safely ignore it.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="font-family: sans-serif; color: #1a3a52;">
  <p>Your HackUTA verification code is:</p>
  <p style="font-size: 28px; font-weight: bold; letter-spacing: 0.2em;">${escapeHtml(code)}</p>
  <p>This code expires in <strong>10 minutes</strong>.</p>
  <p>Do not share this code with anyone.</p>
  <p>If you did not request this email, you can safely ignore it.</p>
</body>
</html>`;

  return {
    subject: "Your HackUTA verification code",
    text,
    html,
  };
}

const HACKUTA_WEBSITE_URL = "https://hackuta.com";

function formatApplicationSubmittedAt(submittedAt: number) {
  return new Date(submittedAt).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Chicago",
  });
}

export function buildApplicationConfirmationEmailContent(payload: {
  applicantName: string;
  submittedAt: number;
  hackathonName: string;
}) {
  const greetingName = payload.applicantName.trim() || "there";
  const hackathonName = payload.hackathonName.trim() || "HackUTA";
  const submitted = formatApplicationSubmittedAt(payload.submittedAt);
  const websiteUrl = HACKUTA_WEBSITE_URL;

  const textLines = [
    `Hi ${greetingName},`,
    "",
    `Your ${hackathonName} application has officially begun its journey! We're excited that you've taken the first step toward joining us for an unforgettable weekend of building, learning, and creating together.`,
    "",
    `Application submitted: ${submitted}`,
    "",
    "Our team will carefully review your application, and we'll email you as decisions are released. In the meantime, you can visit our website at:",
    websiteUrl,
    "",
    `Thank you for wanting to be part of ${hackathonName}. We hope to welcome you aboard soon!`,
    "",
    "With excitement,",
    "The HackUTA Team",
    "",
    "If you did not submit this application, please contact hello@hackuta.org.",
  ];

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="font-family: sans-serif; color: #1a3a52; line-height: 1.5;">
  <p>Hi ${escapeHtml(greetingName)},</p>
  <p>Your <strong>${escapeHtml(hackathonName)}</strong> application has officially begun its journey! We're excited that you've taken the first step toward joining us for an unforgettable weekend of building, learning, and creating together.</p>
  <p><strong>Application submitted:</strong> ${escapeHtml(submitted)}</p>
  <p>Our team will carefully review your application, and we'll email you as decisions are released. In the meantime, you can visit our website at: <a href="${escapeHtml(websiteUrl)}">${escapeHtml(websiteUrl)}</a>.</p>
  <p>Thank you for wanting to be part of ${escapeHtml(hackathonName)}. We hope to welcome you aboard soon!</p>
  <p>With excitement,<br />The HackUTA Team</p>
  <p>If you did not submit this application, please contact <a href="mailto:hello@hackuta.org">hello@hackuta.org</a>.</p>
</body>
</html>`;

  return {
    subject: `${hackathonName} application received`,
    text: textLines.join("\n"),
    html,
  };
}

export { escapeHtml };
