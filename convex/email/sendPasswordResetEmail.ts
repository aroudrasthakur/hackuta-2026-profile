"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { buildPasswordResetEmailContent } from "./templates";
import { sendTrackedEmail } from "./emailService";

export const sendPasswordResetEmail = internalAction({
  args: {
    email: v.string(),
    code: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { email, code, expiresAt: _expiresAt }) => {
    void _expiresAt;
    const content = buildPasswordResetEmailContent(code);
    await sendTrackedEmail(ctx, "password_reset", {
      to: email,
      subject: content.subject,
      text: content.text,
    });
  },
});
