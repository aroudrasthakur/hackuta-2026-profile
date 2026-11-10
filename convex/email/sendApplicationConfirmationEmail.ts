"use node";

import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { buildApplicationConfirmationEmailContent } from "./templates";
import { sendTrackedEmail } from "./emailService";

const readMailConfigFlags = makeFunctionReference<"query">("lib/mailConfig:readMailConfigFlags");

export const sendApplicationConfirmationEmail = internalAction({
  args: {
    email: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    submittedAt: v.number(),
    hackathonName: v.string(),
  },
  handler: async (ctx, { email, firstName, lastName, submittedAt, hackathonName }) => {
    const flags = await ctx.runQuery(readMailConfigFlags, {});
    if (!flags.confirmationEmail) {
      return;
    }

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
