import { internalQuery } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "./dataModel";

export const MAIL_CONFIG_KEY = "current" as const;

export type MailConfigFlags = {
  confirmationEmail: boolean;
  decisionEmail: boolean;
};

export async function getMailConfigRow(ctx: QueryCtx | MutationCtx) {
  return ctx.db
    .query("mailConfig")
    .withIndex("by_key", (q) => q.eq("key", MAIL_CONFIG_KEY))
    .first();
}

export function mailConfigFlagsFromRow(
  row: { confirmationEmail: boolean; decisionEmail: boolean } | null | undefined,
): MailConfigFlags {
  return {
    confirmationEmail: row?.confirmationEmail ?? true,
    decisionEmail: row?.decisionEmail ?? true,
  };
}

export async function getMailConfigFlags(ctx: QueryCtx | MutationCtx): Promise<MailConfigFlags> {
  return mailConfigFlagsFromRow(await getMailConfigRow(ctx));
}

export async function isConfirmationEmailEnabled(ctx: QueryCtx | MutationCtx) {
  return (await getMailConfigFlags(ctx)).confirmationEmail;
}

export async function isDecisionEmailEnabled(ctx: QueryCtx | MutationCtx) {
  return (await getMailConfigFlags(ctx)).decisionEmail;
}

export async function ensureMailConfig(ctx: MutationCtx) {
  const existing = await getMailConfigRow(ctx);
  if (existing) {
    return existing;
  }

  const now = Date.now();
  const id = await ctx.db.insert("mailConfig", {
    key: MAIL_CONFIG_KEY,
    confirmationEmail: true,
    decisionEmail: true,
    updatedAt: now,
  });
  const created = await ctx.db.get(id);
  if (!created) {
    throw new Error("Mail config could not be created.");
  }
  return created;
}

/** Used by Node email actions that cannot read the database directly. */
export const readMailConfigFlags = internalQuery({
  args: {},
  handler: async (ctx) => getMailConfigFlags(ctx),
});
