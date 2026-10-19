"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { buildApplicationConfirmationEmailContent } from "./templates";
import { sendTrackedEmail } from "./emailService";

export const sendApplicationConfirmationEmail = internalAction({
  args: {
    email: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    submittedAt: v.number(),
    hackathonName: v.string(),
  },
  handler: async (ctx, { email, firstName, lastName, submittedAt, hackathonName }) => {
    const content = buildApplicationConfirmationEmailContent({
      applicantName: `${firstName} ${lastName}`.trim(),
      submittedAt,
      hackathonName,
    });

    await sendTrackedEmail(ctx, "application_confirmation", {
      to: email,
      subject: content.subject,
      text: content.text,
    });
  },
});
