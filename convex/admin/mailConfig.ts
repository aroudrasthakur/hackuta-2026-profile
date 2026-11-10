import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { ensureMailConfig, getMailConfigFlags } from "../lib/mailConfig";
import { requireAdminRole, sessionTokenArgs } from "./staffAuth";

/** Current outbound confirmation and decision email flags. */
export const getMailConfig = query({
  args: sessionTokenArgs,
  handler: async (ctx, { sessionToken }) => {
    await requireAdminRole(ctx, sessionToken);
    return getMailConfigFlags(ctx);
  },
});

/** Turns confirmation and/or decision email sending on or off. */
export const setMailConfig = mutation({
  args: {
    ...sessionTokenArgs,
    confirmationEmail: v.optional(v.boolean()),
    decisionEmail: v.optional(v.boolean()),
  },
  handler: async (ctx, { sessionToken, confirmationEmail, decisionEmail }) => {
    await requireAdminRole(ctx, sessionToken);
    const row = await ensureMailConfig(ctx);
    const next = {
      confirmationEmail: confirmationEmail ?? row.confirmationEmail,
      decisionEmail: decisionEmail ?? row.decisionEmail,
    };
    await ctx.db.patch(row._id, { ...next, updatedAt: Date.now() });
    return next;
  },
});
