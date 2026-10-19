import { v, type Infer } from "convex/values";

/** Transactional email type. Stored on emailDeliveries rows and sent to the email service as `note`. */
export const emailDeliveryKind = v.union(
  v.literal("otp"),
  v.literal("password_reset"),
  v.literal("application_confirmation"),
);

export type EmailDeliveryKind = Infer<typeof emailDeliveryKind>;
