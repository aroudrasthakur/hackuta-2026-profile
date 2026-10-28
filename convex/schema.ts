import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import {
  applicationRecord,
  applicationReviewStatus,
  applicationSubmissionLogRecord,
} from "./applicationFields";
import {
  applicationReviewLogAction,
  participantNotificationStatus,
  participantNotificationType,
  staffRole,
  shopItemStatus,
  staffConfigLogAction,
  volunteerActionLogAction,
} from "./admin/fields";
import { emailDeliveryKind } from "./lib/emailDeliveries";

/**
 * Deployment schema for standing-manatee-425 / production.
 *
 * Register-owned tables must match hackuta-2026-register/convex/schema.ts
 * (see convex/REGISTER_SCHEMA.md). Admin-owned tables are listed in REGISTER_SCHEMA.md.
 */
export default defineSchema({
  // --- REGISTER-LOCKED (do not edit) ---
  ...authTables,

  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
  }).index("email", ["email"]),

  eventConfig: defineTable({
    key: v.literal("current"),
    name: v.string(),
    registrationOpensAt: v.optional(v.union(v.number(), v.null())),
    registrationClosesAt: v.optional(v.union(v.number(), v.null())),
    decisionsReleasedAt: v.optional(v.union(v.number(), v.null())),
    startsAt: v.optional(v.union(v.number(), v.null())),
    endsAt: v.optional(v.union(v.number(), v.null())),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  applications: defineTable(applicationRecord)
    .index("by_auth_user", ["authUserId"])
    .index("by_email", ["email"])
    .index("by_resume", ["resumeStorageId"]),

  // --- ADMIN-OWNED (editable) ---
  /**
   * Current or final review state — one row per application.
   * Historical reviewer activity lives in `applicationReviewLogs`.
   */
  applicationReviews: defineTable({
    applicationId: v.id("applications"),
    /** Current reviewer; always the session admin, never client-supplied. */
    reviewedBy: v.optional(v.id("admins")),
    status: applicationReviewStatus,
    /** First `started_review` (or decision, if review was never started explicitly). */
    startedAt: v.optional(v.number()),
    /** Latest active review event: `started_review`, `review_ended`, or a decision. */
    lastActiveAt: v.optional(v.number()),
    /** When the current final decision was made. */
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_application", ["applicationId"])
    .index("by_reviewer", ["reviewedBy"])
    .index("by_status", ["status"]),

  // --- REGISTER-LOCKED (do not edit) ---
  applicationSubmissionLogs: defineTable({
    ...applicationSubmissionLogRecord,
    applicationId: v.id("applications"),
  }).index("by_application", ["applicationId"]),

  rateLimits: defineTable({
    bucket: v.string(),
    key: v.string(),
    createdAt: v.number(),
  }).index("by_bucket_createdAt", ["bucket", "createdAt"]),

  resumeUploadSessions: defineTable({
    token: v.string(),
    authUserId: v.id("users"),
    createdAt: v.number(),
    storageId: v.optional(v.id("_storage")),
    verifiedAt: v.optional(v.number()),
    consumedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_storage", ["storageId"])
    .index("by_auth_user", ["authUserId"])
    .index("by_createdAt", ["createdAt"]),

  emailDeliveries: defineTable({
    serviceId: v.string(),
    kind: emailDeliveryKind,
    recipient: v.string(),
    createdAt: v.number(),
  }).index("by_recipient", ["recipient"]),

  /** Queued emails whose emailDeliveries row could not be written (support lookup). */
  emailDeliveryRecordingFailures: defineTable({
    serviceId: v.string(),
    kind: emailDeliveryKind,
    recipient: v.string(),
    errorMessage: v.string(),
    createdAt: v.number(),
  })
    .index("by_serviceId", ["serviceId"])
    .index("by_recipient", ["recipient"]),

  // --- ADMIN-OWNED (editable): staff, audit log, accepted roster ---
  admins: defineTable({
    email: v.string(),
    name: v.string(),
    role: staffRole,
    active: v.boolean(),
    /** When a participant is promoted to volunteer staff. */
    participantId: v.optional(v.id("participants")),
    /** Missing means denied; volunteers need explicit `true` to scan check-in. */
    canCheckIn: v.optional(v.boolean()),
    /** Missing means denied; volunteers need explicit `true` to scan food. */
    canFoodCheckIn: v.optional(v.boolean()),
    /** Missing means denied; volunteers need explicit `true` to sell shop items. */
    canRedeemShop: v.optional(v.boolean()),
    /** Missing means denied; explicit `true` awards every current and future event. */
    canScanAllEvents: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_role", ["role"])
    .index("by_participant", ["participantId"]),

  applicationReviewLogs: defineTable({
    applicationId: v.id("applications"),
    adminId: v.id("admins"),
    action: applicationReviewLogAction,
    createdAt: v.number(),
  })
    .index("by_application", ["applicationId"])
    .index("by_admin", ["adminId"])
    .index("by_application_createdAt", ["applicationId", "createdAt"]),

  /**
   * Accepted applicants — one row per accepted application, created only after acceptance.
   * Profile data stays on `applications`; this row reuses the applicant's existing `users` account.
   * `foodRestriction` is copied from the linked application at acceptance (dietary + allergy fields).
   */
  participants: defineTable({
    applicationId: v.id("applications"),
    authUserId: v.id("users"),
    acceptedAt: v.number(),
    acceptedBy: v.id("admins"),
    /**
     * The one active scan identity, looked up through `by_qr_token`. Holds the
     * registration token until check-in assigns a badge, then the badge value.
     */
    qrCodeToken: v.string(),
    /** Registration token kept for history after a badge replaces it. Never scannable. */
    registrationQrCodeToken: v.optional(v.string()),
    /** Preprinted badge value; equals `qrCodeToken` while assigned. */
    badgeQrCodeToken: v.optional(v.string()),
    badgeAssignedAt: v.optional(v.number()),
    badgeAssignedBy: v.optional(v.id("admins")),
    foodRestriction: v.optional(v.string()),
    checkedInAt: v.optional(v.number()),
    /** Legacy single-use food timestamp; preserved when meal redemptions replace food check-in. */
    foodCheckedInAt: v.optional(v.number()),
    /** Cached balance; optional until backfill, then required in a later deploy. */
    points: v.optional(v.number()),
    /**
     * When the current `points` total was reached. Ranking metadata only; never
     * returned on participant APIs. Unset while the balance is 0.
     */
    pointsReachedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_application", ["applicationId"])
    .index("by_auth_user", ["authUserId"])
    .index("by_qr_token", ["qrCodeToken"])
    .index("by_registration_qr_token", ["registrationQrCodeToken"])
    .index("by_badge_qr_token", ["badgeQrCodeToken"])
    .index("by_points", ["points"]),

  /**
   * Badges an admin took out of service. Only a SHA-256 hash is stored, so a
   * lost or damaged badge can never be scanned or assigned again.
   */
  retiredBadgeTokens: defineTable({
    tokenHash: v.string(),
    participantId: v.id("participants"),
    retiredBy: v.id("admins"),
    retiredAt: v.number(),
  }).index("by_token_hash", ["tokenHash"]),

  /**
   * Configurable serving windows, stored as Unix timestamps in milliseconds.
   * Mutations must validate startsAt < endsAt and prevent overlapping active windows.
   * Meals with redemption history must be deactivated rather than deleted.
   */
  mealPeriods: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    startsAt: v.number(),
    endsAt: v.number(),
    active: v.boolean(),
    createdBy: v.id("admins"),
    /** Cached count, maintained atomically with redemptions; absent on legacy meals. */
    servedCount: v.optional(v.number()),
    /** Present until the bounded legacy-redemption backfill finishes. */
    servedCountBackfillCursor: v.optional(v.union(v.string(), v.null())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active_startsAt", ["active", "startsAt"])
    .index("by_startsAt", ["startsAt"]),

  /**
   * Authoritative meal collection history, independent of legacy foodCheckedInAt.
   * The redemption mutation must check by_participant_meal and insert atomically;
   * indexes do not enforce uniqueness. Duplicate scans must preserve redeemedAt.
   */
  mealRedemptions: defineTable({
    participantId: v.id("participants"),
    mealPeriodId: v.id("mealPeriods"),
    scannedBy: v.id("admins"),
    redeemedAt: v.number(),
    /** Legacy rows are counted once by the resumable served-count backfill. */
    countedInServedCount: v.optional(v.boolean()),
  })
    .index("by_participant_meal", ["participantId", "mealPeriodId"])
    .index("by_meal", ["mealPeriodId", "redeemedAt"])
    .index("by_participant", ["participantId", "redeemedAt"]),

  /** Point-bearing hackathon activities volunteers may award (fixed points per event). */
  events: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    pointsAwarded: v.number(),
    startsAt: v.number(),
    endsAt: v.number(),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_active", ["active"]),

  /** Which events a volunteer may award points for (one row per volunteer+event). */
  volunteerEventAccess: defineTable({
    volunteerAdminId: v.id("admins"),
    eventId: v.id("events"),
    grantedBy: v.id("admins"),
    createdAt: v.number(),
  })
    .index("by_volunteer", ["volunteerAdminId"])
    .index("by_volunteer_event", ["volunteerAdminId", "eventId"]),

  /** Authoritative record that a participant received an event's points (not the action log). */
  participantEventAwards: defineTable({
    participantId: v.id("participants"),
    eventId: v.id("events"),
    pointsAwarded: v.number(),
    awardedBy: v.id("admins"),
    awardedAt: v.number(),
  })
    .index("by_participant_event", ["participantId", "eventId"])
    .index("by_event", ["eventId"]),

  /**
   * Volunteer scan and admin point-adjustment audit. No QR tokens, passwords,
   * session tokens, or dietary restrictions.
   */
  volunteerActionLogs: defineTable({
    actorAdminId: v.id("admins"),
    participantId: v.id("participants"),
    action: volunteerActionLogAction,
    eventId: v.optional(v.id("events")),
    mealPeriodId: v.optional(v.id("mealPeriods")),
    pointsDelta: v.optional(v.number()),
    previousPoints: v.optional(v.number()),
    newPoints: v.optional(v.number()),
    reason: v.optional(v.string()),
    /** Set on `shop_purchase` and `shop_refund` rows. */
    shopRedemptionId: v.optional(v.id("shopRedemptions")),
    createdAt: v.number(),
  })
    .index("by_actor", ["actorAdminId"])
    .index("by_participant", ["participantId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_actor_createdAt", ["actorAdminId", "createdAt"])
    .index("by_participant_createdAt", ["participantId", "createdAt"])
    .index("by_event_createdAt", ["eventId", "createdAt"])
    .index("by_action_createdAt", ["action", "createdAt"]),

  /** Admin-only audit for volunteer, event, meal, and access configuration changes. */
  staffConfigLogs: defineTable({
    actorAdminId: v.id("admins"),
    action: staffConfigLogAction,
    targetAdminId: v.optional(v.id("admins")),
    targetEventId: v.optional(v.id("events")),
    targetMealPeriodId: v.optional(v.id("mealPeriods")),
    targetParticipantId: v.optional(v.id("participants")),
    targetShopItemId: v.optional(v.id("shopItems")),
    targetFlashSaleId: v.optional(v.id("shopFlashSales")),
    targetNotificationId: v.optional(v.id("participantNotifications")),
    details: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_actor", ["actorAdminId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_target_admin_createdAt", ["targetAdminId", "createdAt"]),

  /** Organizer credentials — separate from applicant Convex Auth. Provisioned internally. */
  adminAuthAccounts: defineTable({
    adminId: v.id("admins"),
    passwordHash: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_admin", ["adminId"]),

  /** Organizer sessions — stores hashed tokens only. */
  adminSessions: defineTable({
    adminId: v.id("admins"),
    sessionTokenHash: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_token_hash", ["sessionTokenHash"])
    .index("by_admin", ["adminId"]),

  /**
   * Decision emails waiting for an admin to release them.
   * Review status and participant rows stay unchanged until the email server accepts the message.
   */
  decisionEmailQueue: defineTable({
    applicationId: v.id("applications"),
    decision: v.union(v.literal("accepted"), v.literal("rejected"), v.literal("waitlisted")),
    recipientEmail: v.string(),
    applicantName: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("held"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    queuedBy: v.id("admins"),
    queuedAt: v.number(),
    updatedAt: v.number(),
    errorMessage: v.optional(v.string()),
    sentAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_application", ["applicationId"]),

  /**
   * Event shop catalog. Items are archived, never deleted, so purchase history
   * always resolves. Inventory is not tracked.
   */
  shopItems: defineTable({
    name: v.string(),
    description: v.string(),
    imageStorageId: v.optional(v.id("_storage")),
    pointsCost: v.number(),
    status: shopItemStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"]),

  /**
   * One completed volunteer sale. Prices and the item name are copied at sale
   * time, so later price changes never alter history. `idempotencyKey` is
   * unique by lookup inside the purchase transaction.
   */
  shopRedemptions: defineTable({
    participantId: v.id("participants"),
    itemId: v.id("shopItems"),
    itemName: v.string(),
    quantity: v.number(),
    unitPointsCost: v.number(),
    basePointsCost: v.number(),
    totalPointsSpent: v.number(),
    redeemedBy: v.id("admins"),
    redeemedAt: v.number(),
    pointsBefore: v.number(),
    pointsAfter: v.number(),
    flashSaleId: v.optional(v.id("shopFlashSales")),
    idempotencyKey: v.string(),
    refund: v.optional(v.object({
      refundedBy: v.id("admins"),
      refundedAt: v.number(),
      reason: v.string(),
      restocked: v.optional(v.boolean()),
      pointsRestored: v.number(),
    })),
  })
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_participant_redeemedAt", ["participantId", "redeemedAt"])
    .index("by_item_redeemedAt", ["itemId", "redeemedAt"])
    .index("by_volunteer_redeemedAt", ["redeemedBy", "redeemedAt"])
    .index("by_redeemedAt", ["redeemedAt"]),

  /**
   * Timed promotion. Scheduled, live, and ended are derived from the window,
   * so normal prices return on their own when a sale ends.
   */
  shopFlashSales: defineTable({
    title: v.string(),
    message: v.string(),
    startsAt: v.number(),
    endsAt: v.number(),
    createdBy: v.id("admins"),
    cancelledBy: v.optional(v.id("admins")),
    cancelledAt: v.optional(v.number()),
    notificationId: v.optional(v.id("participantNotifications")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_startsAt", ["startsAt"]),

  /** Sale price for one item. Window and cancel state are copied from the sale for pricing lookups. */
  shopFlashSaleItems: defineTable({
    flashSaleId: v.id("shopFlashSales"),
    itemId: v.id("shopItems"),
    salePointsCost: v.number(),
    startsAt: v.number(),
    endsAt: v.number(),
    cancelled: v.boolean(),
  })
    .index("by_item_startsAt", ["itemId", "startsAt"])
    .index("by_sale", ["flashSaleId"]),

  /**
   * Participant portal notifications with drafts, scheduling, and published
   * history. Flash sales own one `flash_sale` row each via `relatedFlashSaleId`;
   * cancelled rows stay for audit.
   */
  participantNotifications: defineTable({
    title: v.string(),
    message: v.string(),
    type: participantNotificationType,
    status: participantNotificationStatus,
    scheduledAt: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    cancelledBy: v.optional(v.id("admins")),
    scheduleVersion: v.optional(v.number()),
    scheduledJobId: v.optional(v.id("_scheduled_functions")),
    linkUrl: v.optional(v.string()),
    linkLabel: v.optional(v.string()),
    relatedEventId: v.optional(v.id("events")),
    relatedFlashSaleId: v.optional(v.id("shopFlashSales")),
    createdBy: v.id("admins"),
    updatedBy: v.optional(v.id("admins")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_updatedAt", ["status", "updatedAt"])
    .index("by_status_scheduledAt", ["status", "scheduledAt"])
    .index("by_status_publishedAt", ["status", "publishedAt"])
    .index("by_type_updatedAt", ["type", "updatedAt"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_flash_sale", ["relatedFlashSaleId"]),
});
