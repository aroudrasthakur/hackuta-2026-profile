import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { sendMailMessage, type SendMailInput, type SendMailResult } from "../email/emailService";

/** Service `note` values for decision mail (aligned with future register delivery kinds). */
export const decisionEmailServiceNote = {
  accepted: "application_accepted",
  rejected: "application_rejected",
  waitlisted: "application_waitlisted",
} as const;

type Decision = keyof typeof decisionEmailServiceNote;

/**
 * Queues decision email through the shared HackUTA email service client (same HTTP path as
 * register's `sendTrackedEmail`). Does not write `emailDeliveries` rows until register adds
 * matching delivery kinds.
 */
export async function sendDecisionEmailMessage(
  _ctx: Pick<GenericActionCtx<GenericDataModel>, "runMutation">,
  decision: Decision,
  input: Omit<SendMailInput, "note">,
): Promise<SendMailResult> {
  void _ctx;
  return await sendMailMessage({
    ...input,
    note: decisionEmailServiceNote[decision],
  });
}
