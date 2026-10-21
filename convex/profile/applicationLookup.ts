import { applicationFormWasSubmitted, getApplicationByUser } from "../lib/applications";
import type { AuthCtx } from "../lib/auth";
import { normalizeEmail } from "../lib/normalizeEmail";
import type { ApplicationDoc, AuthUserDoc } from "../lib/dataModel";

function applicationRecency(application: ApplicationDoc) {
  return application.applicantUpdatedAt ?? application.submittedAt ?? application.createdAt;
}

function pickPreferredApplication(candidates: ApplicationDoc[]): ApplicationDoc | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;

  const submitted = candidates.filter((application) => applicationFormWasSubmitted(application));
  const pool = submitted.length > 0 ? submitted : candidates;
  return pool.reduce((best, current) =>
    applicationRecency(current) > applicationRecency(best) ? current : best,
  );
}

/** Participant-portal lookup: auth user, email fallback, then participants.applicationId. */
export async function resolveApplicationForAuthUser(
  ctx: AuthCtx,
  user: Pick<AuthUserDoc, "_id" | "email">,
): Promise<ApplicationDoc | null> {
  const byAuthUser = await getApplicationByUser(ctx, user._id);
  if (byAuthUser) return byAuthUser;

  const verifiedEmail = normalizeEmail(user.email);
  if (verifiedEmail) {
    const byEmail = await ctx.db
      .query("applications")
      .withIndex("by_email", (q) => q.eq("email", verifiedEmail))
      .collect();

    const owned = byEmail.filter((application) => {
      if (application.authUserId === user._id) return true;
      return normalizeEmail(application.email) === verifiedEmail;
    });

    const fromEmail = pickPreferredApplication(owned);
    if (fromEmail) return fromEmail;
  }

  const participant = await ctx.db
    .query("participants")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", user._id))
    .first();
  if (participant) {
    const linked = await ctx.db.get(participant.applicationId);
    if (linked) return linked;
  }

  return null;
}
