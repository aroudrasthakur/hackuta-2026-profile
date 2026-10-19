import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import {
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_SEND_MAX_PER_HOUR,
} from "../../shared/auth/otpRateLimit";
import { normalizeEmail } from "./normalizeEmail";
import { OTP_SEND_BUCKET } from "./rateLimitBuckets";

/** Wide ctx type — full schema auth tables break GenericDataModel in CI/deploy tsc. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional wide db for cross-handler use
type OtpSendLookupDb = GenericQueryCtx<any>["db"] | GenericMutationCtx<any>["db"];
type OtpSendLookupCtx = { db: OtpSendLookupDb };

export const OTP_RESEND_COOLDOWN_MS = OTP_RESEND_COOLDOWN_SECONDS * 1000;
export const OTP_SEND_WINDOW_MS = 60 * 60 * 1000;

export type OtpSendStatus = {
  waitSeconds: number;
  hourlyLimitReached: boolean;
};

export async function lookupOtpSendStatus(
  ctx: OtpSendLookupCtx,
  email: string,
  now = Date.now(),
  bucket: string = OTP_SEND_BUCKET,
): Promise<OtpSendStatus> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { waitSeconds: 0, hourlyLimitReached: false };
  }

  const windowStart = now - OTP_SEND_WINDOW_MS;
  const recent = await ctx.db
    .query("rateLimits")
    .withIndex("by_bucket_createdAt", (q) => q.eq("bucket", bucket))
    .filter((q) =>
      q.and(
        q.eq(q.field("key"), normalized),
        q.gte(q.field("createdAt"), windowStart),
      ),
    )
    .collect();

  if (recent.length >= OTP_SEND_MAX_PER_HOUR) {
    return { waitSeconds: 0, hourlyLimitReached: true };
  }

  const lastSent = recent.reduce((latest, entry) => Math.max(latest, entry.createdAt), 0);
  if (lastSent > 0) {
    const remainingMs = OTP_RESEND_COOLDOWN_MS - (now - lastSent);
    if (remainingMs > 0) {
      return {
        waitSeconds: Math.ceil(remainingMs / 1000),
        hourlyLimitReached: false,
      };
    }
  }

  return { waitSeconds: 0, hourlyLimitReached: false };
}
