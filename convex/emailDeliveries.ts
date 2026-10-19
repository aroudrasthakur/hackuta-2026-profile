import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { emailDeliveryKind } from "./lib/emailDeliveries";
import { normalizeEmail } from "./lib/normalizeEmail";

const RECIPIENT_LOOKUP_LIMIT = 20;

/** Records the email service's queue ID for a sent email. Never stores the subject, body, or code. */
export const recordEmailDelivery = internalMutation({
  args: {
    serviceId: v.string(),
    kind: emailDeliveryKind,
    recipient: v.string(),
  },
  handler: async (ctx, { serviceId, kind, recipient }) => {
    await ctx.db.insert("emailDeliveries", {
      serviceId,
      kind,
      recipient: normalizeEmail(recipient) ?? recipient,
      createdAt: Date.now(),
    });
  },
});

/** Persists a tracking failure so support can look up orphaned queue IDs. */
export const recordEmailDeliveryRecordingFailure = internalMutation({
  args: {
    serviceId: v.string(),
    kind: emailDeliveryKind,
    recipient: v.string(),
    errorMessage: v.string(),
  },
  handler: async (ctx, { serviceId, kind, recipient, errorMessage }) => {
    await ctx.db.insert("emailDeliveryRecordingFailures", {
      serviceId,
      kind,
      recipient: normalizeEmail(recipient) ?? recipient,
      errorMessage: errorMessage.slice(0, 500),
      createdAt: Date.now(),
    });
  },
});

/** Support lookup: tracking failures for an address, newest first. */
export const listEmailDeliveryRecordingFailuresForRecipient = internalQuery({
  args: { recipient: v.string() },
  handler: async (ctx, { recipient }) => {
    const normalized = normalizeEmail(recipient);
    if (!normalized) return [];
    return ctx.db
      .query("emailDeliveryRecordingFailures")
      .withIndex("by_recipient", (q) => q.eq("recipient", normalized))
      .order("desc")
      .take(RECIPIENT_LOOKUP_LIMIT);
  },
});

/** Support lookup: most recent emails queued for an address, newest first. */
export const listEmailDeliveriesForRecipient = internalQuery({
  args: { recipient: v.string() },
  handler: async (ctx, { recipient }) => {
    const normalized = normalizeEmail(recipient);
    if (!normalized) return [];
    return ctx.db
      .query("emailDeliveries")
      .withIndex("by_recipient", (q) => q.eq("recipient", normalized))
      .order("desc")
      .take(RECIPIENT_LOOKUP_LIMIT);
  },
});
