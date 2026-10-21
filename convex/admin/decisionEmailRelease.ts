"use node";

import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { sessionTokenArgs } from "./staffAuth";
import { truncateError } from "./decisionEmailQueue";

const claimDecisionEmailsRef = makeFunctionReference<
  "mutation",
  {
    sessionToken: string;
    itemIds?: Array<import("convex/values").GenericId<"decisionEmailQueue">>;
  },
  Array<{
    itemId: import("convex/values").GenericId<"decisionEmailQueue">;
    applicationId: import("convex/values").GenericId<"applications">;
    decision: "accepted" | "rejected" | "waitlisted";
    recipientEmail: string;
    applicantName: string;
    reviewStatus: string | null;
    hackathonName: string;
  }>
>("admin/decisionEmailQueue:claimDecisionEmails");

const finishDecisionEmailReleaseRef = makeFunctionReference<
  "mutation",
  {
    itemId: import("convex/values").GenericId<"decisionEmailQueue">;
    outcome: "sent" | "failed";
    errorMessage?: string;
  },
  { applied: boolean }
>("admin/decisionEmailQueue:finishDecisionEmailRelease");

const sendDecisionEmailRef = makeFunctionReference<
  "action",
  {
    decision: "accepted" | "rejected" | "waitlisted";
    email: string;
    applicantName: string;
    hackathonName: string;
  }
>("admin/sendDecisionEmails:sendDecisionEmail");

function blockedBeforeSend(reviewStatus: string | null, decision: "accepted" | "rejected" | "waitlisted") {
  if (reviewStatus === "waitlisted" && decision === "accepted") return false;
  return (
    reviewStatus === "accepted" ||
    reviewStatus === "rejected" ||
    reviewStatus === "waitlisted" ||
    reviewStatus === "withdrawn"
  );
}

/** Hands queued decision emails to the email server, then publishes each successful handoff. */
export const releaseDecisionEmails = action({
  args: {
    ...sessionTokenArgs,
    itemIds: v.optional(v.array(v.id("decisionEmailQueue"))),
  },
  handler: async (ctx, { sessionToken, itemIds }) => {
    const claimed = await ctx.runMutation(claimDecisionEmailsRef, {
      sessionToken,
      ...(itemIds ? { itemIds } : {}),
    });

    let sent = 0;
    let failed = 0;
    for (const item of claimed) {
      if (blockedBeforeSend(item.reviewStatus, item.decision)) {
        await ctx.runMutation(finishDecisionEmailReleaseRef, {
          itemId: item.itemId,
          outcome: "failed",
          errorMessage: "The review state changed before this email could be released.",
        });
        failed += 1;
        continue;
      }

      try {
        await ctx.runAction(sendDecisionEmailRef, {
          decision: item.decision,
          email: item.recipientEmail,
          applicantName: item.applicantName,
          hackathonName: item.hackathonName,
        });
        try {
          await ctx.runMutation(finishDecisionEmailReleaseRef, {
            itemId: item.itemId,
            outcome: "sent",
          });
          sent += 1;
        } catch (error) {
          await ctx.runMutation(finishDecisionEmailReleaseRef, {
            itemId: item.itemId,
            outcome: "failed",
            errorMessage: truncateError(error),
          });
          failed += 1;
        }
      } catch (error) {
        await ctx.runMutation(finishDecisionEmailReleaseRef, {
          itemId: item.itemId,
          outcome: "failed",
          errorMessage: truncateError(error),
        });
        failed += 1;
      }
    }

    return { sent, failed, total: claimed.length };
  },
});
