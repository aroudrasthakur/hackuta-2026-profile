"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { getEmailStatus } from "./emailService";

/** Operator tool: ask the email service whether a tracked email was sent. */
export const checkEmailStatus = internalAction({
  args: { serviceId: v.string() },
  handler: async (_ctx, { serviceId }) => getEmailStatus(serviceId),
});
