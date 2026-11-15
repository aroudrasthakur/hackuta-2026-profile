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

  mailConfig: defineTable({
    key: v.literal("current"),
    confirmationEmail: v.boolean(),
    decisionEmail: v.boolean(),
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
    /** On-site attendee row after check-in; used for self-scan. */
    checkedInId: v.optional(v.id("checkedIn")),
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
    .index("by_participant", ["participantId"])
    .index("by_checkedIn", ["checkedInId"]),

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
   * After door check-in, `checkedInAt` is set and the on-site record lives in `checkedIn`.
   */
  participants: defineTable({
    applicationId: v.id("applications"),
    authUserId: v.id("users"),
    acceptedAt: v.number(),
    acceptedBy: v.id("admins"),
    /** Registration QR. Never replaced by a badge; post-check-in scans use `checkedIn`. */
    qrCodeToken: v.string(),
    foodRestriction: v.optional(v.string()),
    checkedInAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_application", ["applicationId"])
    .index("by_auth_user", ["authUserId"])
    .index("by_qr_token", ["qrCodeToken"]),

  /**
   * One-time media-disclosure acceptance. Profile-owned. Presence of a row is
   * the only gate: door check-in rejects a registration QR until this exists.
   */
  participantMediaDisclosures: defineTable({
    participantId: v.id("participants"),
    acceptedAt: v.number(),
  }).index("by_participant", ["participantId"]),

  /**
   * On-site attendee created at door check-in. Owns badge QR, points, and
   * post-check-in scan identity. One row per checked-in participant.
   */
  checkedIn: defineTable({
    participantId: v.id("participants"),
    applicationId: v.id("applications"),
    authUserId: v.id("users"),
    acceptedAt: v.number(),
    acceptedBy: v.id("admins"),
    foodRestriction: v.optional(v.string()),
    checkedInAt: v.number(),
    checkedInBy: v.id("admins"),
    qrCodeToken: v.string(),
    registrationQrCodeToken: v.string(),
    badgeQrCodeToken: v.optional(v.string()),
    badgeAssignedAt: v.optional(v.number()),
    badgeAssignedBy: v.optional(v.id("admins")),
    points: v.number(),
    pointsReachedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_participant", ["participantId"])
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
    checkedInId: v.id("checkedIn"),
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

  /** Participant-facing activities; separate from point-award `events`. */
  schedule: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    startsAt: v.number(),
    endsAt: v.number(),
    location: v.optional(v.string()),
    category: v.string(),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_startsAt", ["startsAt"])
    .index("by_active_startsAt", ["active", "startsAt"]),

  /**
   * Authoritative meal collection history for checked-in attendees.
   * The redemption mutation must check by_checkedIn_meal and insert atomically;
   * indexes do not enforce uniqueness. Duplicate scans must preserve redeemedAt.
   */
  mealRedemptions: defineTable({
    checkedInId: v.id("checkedIn"),
    mealPeriodId: v.id("mealPeriods"),
    scannedBy: v.id("admins"),
    redeemedAt: v.number(),
    /** Legacy rows are counted once by the resumable served-count backfill. */
    countedInServedCount: v.optional(v.boolean()),
  })
    .index("by_checkedIn_meal", ["checkedInId", "mealPeriodId"])
    .index("by_meal", ["mealPeriodId", "redeemedAt"])
    .index("by_checkedIn", ["checkedInId", "redeemedAt"]),

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
    checkedInId: v.id("checkedIn"),
    eventId: v.id("events"),
    pointsAwarded: v.number(),
    awardedBy: v.id("admins"),
    awardedAt: v.number(),
  })
    .index("by_checkedIn_event", ["checkedInId", "eventId"])
    .index("by_event", ["eventId"]),

  /**
   * Volunteer scan and admin point-adjustment audit. No QR tokens, passwords,
   * session tokens, or dietary restrictions.
   */
  volunteerActionLogs: defineTable({
    actorAdminId: v.id("admins"),
    checkedInId: v.optional(v.id("checkedIn")),
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
    .index("by_checkedIn", ["checkedInId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_actor_createdAt", ["actorAdminId", "createdAt"])
    .index("by_checkedIn_createdAt", ["checkedInId", "createdAt"])
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
    targetCheckedInId: v.optional(v.id("checkedIn")),
    targetShopItemId: v.optional(v.id("shopItems")),
    targetFlashSaleId: v.optional(v.id("shopFlashSales")),
    /** Set on `o21_window_*` rows. */
    targetO21WindowId: v.optional(v.id("o21Windows")),
    /** Set on `arcade_game_updated` rows. */
    targetArcadeGameKey: v.optional(v.string()),
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
    pointsCost: v.number(),
    purchaseCooldownMinutes: v.optional(v.number()),
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
    checkedInId: v.id("checkedIn"),
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
    .index("by_checkedIn_item_redeemedAt", ["checkedInId", "itemId", "redeemedAt"])
    .index("by_checkedIn_redeemedAt", ["checkedInId", "redeemedAt"])
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
   * The arcade site switch (one row, `key: "arcade"`). Status for players comes
   * from `mode`, the times and the server clock (shared/arcade/rules.ts).
   * No row yet reads as off, launch codes on, backup sign-in off.
   */
  arcadeSettings: defineTable({
    key: v.literal("arcade"),
    mode: v.union(v.literal("off"), v.literal("scheduled"), v.literal("on")),
    opensAt: v.optional(v.number()),
    closesAt: v.optional(v.number()),
    /** Profile → arcade one-click sign-in. Off refuses every launch code. */
    launchEnabled: v.boolean(),
    /** Break-glass: the signed-out screen offers email + password sign-in. */
    backupSignIn: v.boolean(),
    updatedBy: v.optional(v.id("admins")),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /** Per-game switch. A game with no row is off. */
  arcadeGames: defineTable({
    key: v.string(),
    name: v.string(),
    enabled: v.boolean(),
    order: v.number(),
    updatedBy: v.optional(v.id("admins")),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /**
   * Each checked-in attendee's arcade balance, in points. Games bet only from
   * here; points move between the profile balance (`checkedIn.points`) and
   * this wallet only through `arcadeTransfers`. No row yet means 0.
   */
  arcadeWallets: defineTable({
    checkedInId: v.id("checkedIn"),
    points: v.number(),
    updatedAt: v.number(),
  }).index("by_checkedIn", ["checkedInId"]),

  /**
   * The deposit / withdraw log: every move between the profile balance and the
   * arcade wallet, with both balances before and after. A deposit counts as
   * −amount and a withdraw as +amount in `computeLedgerPoints`. `transferId`
   * is the client's idempotency key, unique per attendee.
   */
  arcadeTransfers: defineTable({
    checkedInId: v.id("checkedIn"),
    transferId: v.string(),
    kind: v.union(v.literal("deposit"), v.literal("withdraw")),
    amount: v.number(),
    profileBefore: v.number(),
    profileAfter: v.number(),
    arcadeBefore: v.number(),
    arcadeAfter: v.number(),
    createdAt: v.number(),
  })
    .index("by_checkedIn_createdAt", ["checkedInId", "createdAt"])
    .index("by_checkedIn_transferId", ["checkedInId", "transferId"])
    .index("by_createdAt", ["createdAt"]),

  /**
   * Every arcade game play, one row per play. The numbers are the arcade
   * wallet's (`arcadeWallets`), never the profile balance: `pointsDelta` is
   * payout − stake, `previousPoints` / `newPoints` the wallet before and after.
   * The only place games write is convex/arcade/points.ts. `playId` is the
   * client's idempotency key, unique per attendee and game.
   */
  arcadePlays: defineTable({
    checkedInId: v.id("checkedIn"),
    game: v.string(),
    playId: v.string(),
    stake: v.number(),
    payout: v.number(),
    pointsDelta: v.number(),
    previousPoints: v.number(),
    newPoints: v.number(),
    createdAt: v.number(),
  })
    .index("by_checkedIn_createdAt", ["checkedInId", "createdAt"])
    .index("by_checkedIn_game_playId", ["checkedInId", "game", "playId"])
    .index("by_checkedIn_game_createdAt", ["checkedInId", "game", "createdAt"])
    .index("by_game_createdAt", ["game", "createdAt"]),

  /**
   * One-time codes for the profile → arcade hand-off. Only the SHA-256 hash of
   * the code is stored. Single use, short expiry.
   */
  arcadeLaunchCodes: defineTable({
    codeHash: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_codeHash", ["codeHash"])
    .index("by_user_createdAt", ["userId", "createdAt"]),

  /**
   * Wheel of the Fates details for each spin: the bets, the pocket, and the
   * event-local day (for the daily loss limit). The points side of the spin is
   * its `arcadePlays` row (`playId`).
   */
  rouletteSpins: defineTable({
    checkedInId: v.id("checkedIn"),
    playId: v.id("arcadePlays"),
    spinId: v.string(),
    bets: v.array(v.object({ betId: v.string(), amount: v.number() })),
    stake: v.number(),
    returned: v.number(),
    pocket: v.number(),
    day: v.string(),
    createdAt: v.number(),
  })
    .index("by_checkedIn_createdAt", ["checkedInId", "createdAt"])
    .index("by_checkedIn_spinId", ["checkedInId", "spinId"])
    .index("by_checkedIn_day", ["checkedInId", "day"]),

  /**
   * Olympus Slots details for each spin (reels, outcome). The points side of
   * the spin is its `arcadePlays` row (`playId`).
   */
  slotSpins: defineTable({
    checkedInId: v.id("checkedIn"),
    playId: v.optional(v.id("arcadePlays")), // Optional to support existing data
    spinId: v.string(),
    wager: v.number(),
    payout: v.number(),
    outcome: v.string(),
    symbols: v.array(v.string()),
    createdAt: v.number(),
    // Legacy fields from old version - optional to support existing data
    pointsDelta: v.optional(v.number()),
    newPoints: v.optional(v.number()),
    previousPoints: v.optional(v.number()),
    windowId: v.optional(v.id("slotWindows")),
  })
    .index("by_checkedIn_createdAt", ["checkedInId", "createdAt"])
    .index("by_checkedIn_spinId", ["checkedInId", "spinId"]),

  /**
   * Olympus 21 play windows (already live on peccary). Same shape as slot
   * windows; keep every field so a push never fails schema validation.
   */
  o21Windows: defineTable({
    opensAt: v.number(),
    closesAt: v.number(),
    label: v.optional(v.string()),
    createdBy: v.optional(v.id("admins")),
    cancelledAt: v.optional(v.number()),
    cancelledBy: v.optional(v.id("admins")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_opensAt", ["opensAt"])
    .index("by_closesAt", ["closesAt"]),

  /**
   * Olympus Slots play windows. Same structure as o21Windows for consistency.
   * Already deployed on peccary — keep every field so a push never fails schema validation.
   */
  slotWindows: defineTable({
    opensAt: v.number(),
    closesAt: v.number(),
    label: v.optional(v.string()),
    createdBy: v.optional(v.id("admins")),
    cancelledAt: v.optional(v.number()),
    cancelledBy: v.optional(v.id("admins")),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_opensAt", ["opensAt"])
    .index("by_closesAt", ["closesAt"]),

  /** One Olympus 21 table. `state` is the serialized engine blob. */
  o21Tables: defineTable({
    windowId: v.id("o21Windows"),
    status: v.string(),
    seatCount: v.number(),
    state: v.string(),
    tableKey: v.string(),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_window", ["windowId"])
    .index("by_status", ["status"])
    .index("by_tableKey", ["tableKey"]),

  /** Settled Olympus 21 round for one checked-in player. */
  o21Hands: defineTable({
    checkedInId: v.id("checkedIn"),
    tableId: v.id("o21Tables"),
    windowId: v.id("o21Windows"),
    roundNo: v.number(),
    wager: v.number(),
    pointsDelta: v.number(),
    settledAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_checkedIn_createdAt", ["checkedInId", "createdAt"])
    .index("by_table", ["tableId"])
    .index("by_window", ["windowId"]),

  /** Idempotency rows for Olympus 21 client actions. */
  o21Actions: defineTable({
    actionId: v.string(),
    checkedInId: v.id("checkedIn"),
    kind: v.string(),
    createdAt: v.number(),
  }).index("by_actionId", ["actionId"]),

  /**
   * Live Olympus 21 (`convex/arcade/olympus21.ts`). Same model as poker: one
   * queue, the buy-in taken from the arcade wallet on joining, table chips
   * paid back to it on leaving. The legacy `o21Tables` / `o21Hands` /
   * `o21Actions` above are kept (never deleted) but unused.
   */
  o21Queue: defineTable({
    checkedInId: v.id("checkedIn"),
    name: v.string(),
    joinedAt: v.number(),
  })
    .index("by_checkedIn", ["checkedInId"])
    .index("by_joinedAt", ["joinedAt"]),

  /** One live table. `state` is the serialized engine (hands and piles): never returned to a browser. */
  o21LiveTables: defineTable({
    status: v.string(),
    state: v.string(),
    humans: v.number(),
    /** Pending scheduled tick, if any. */
    wakeAt: v.optional(v.number()),
    /** Since when no human has been ready to play (idle tables close). */
    idleSince: v.optional(v.number()),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_status", ["status"]),

  /** A hacker's stay at a live table, from buy-in to cash-out. */
  o21Seats: defineTable({
    tableId: v.id("o21LiveTables"),
    checkedInId: v.id("checkedIn"),
    buyIn: v.number(),
    status: v.union(v.literal("seated"), v.literal("cashed_out")),
    returned: v.optional(v.number()),
    reason: v.optional(v.string()),
    createdAt: v.number(),
    cashedOutAt: v.optional(v.number()),
  })
    .index("by_table", ["tableId"])
    .index("by_checkedIn_createdAt", ["checkedInId", "createdAt"]),

  /**
   * Arcade poker identity. The browser keeps a session token; only the SHA-256
   * hash is stored. `points` is the player's off-table stack (starts at 200).
   */
  pokerPlayers: defineTable({
    /** The signed-in hacker this player is. Unset only on legacy anonymous rows. */
    checkedInId: v.optional(v.id("checkedIn")),
    /** Legacy anonymous browser token (hash). New players are linked by `checkedInId`. */
    tokenHash: v.optional(v.string()),
    displayName: v.string(),
    /** Legacy practice chips. Linked players buy in from and cash out to the arcade wallet. */
    points: v.number(),
    lastResult: v.optional(
      v.object({
        returned: v.number(),
        reason: v.string(),
        at: v.number(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_checkedIn", ["checkedInId"]),

  /** Humans waiting for a live table. The buy-in is already taken from the arcade wallet. */
  pokerQueue: defineTable({
    playerId: v.id("pokerPlayers"),
    joinedAt: v.number(),
  })
    .index("by_player", ["playerId"])
    .index("by_joinedAt", ["joinedAt"]),

  /**
   * One live (or just-ended) Texas Hold'em table. `deck` never leaves this
   * document — public queries rebuild a stripped view per caller.
   */
  pokerTables: defineTable({
    status: v.union(v.literal("playing"), v.literal("ended")),
    street: v.union(
      v.literal("preflop"),
      v.literal("flop"),
      v.literal("turn"),
      v.literal("river"),
      v.literal("showdown"),
    ),
    community: v.array(v.object({ rank: v.string(), suit: v.string() })),
    deck: v.array(v.object({ rank: v.string(), suit: v.string() })),
    pot: v.number(),
    currentBet: v.number(),
    minRaise: v.number(),
    dealerIndex: v.number(),
    toAct: v.union(v.number(), v.null()),
    actionDeadlineAt: v.union(v.number(), v.null()),
    turnNonce: v.number(),
    handNumber: v.number(),
    log: v.string(),
    winners: v.optional(
      v.array(
        v.object({
          playerId: v.string(),
          amount: v.number(),
          hand: v.optional(
            v.object({
              category: v.string(),
              kickers: v.array(v.number()),
              label: v.string(),
            }),
          ),
        }),
      ),
    ),
    endedReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_status", ["status"]),

  /** One seat at a poker table. `hole` is secret except to that player (and at showdown). */
  pokerSeats: defineTable({
    tableId: v.id("pokerTables"),
    playerId: v.optional(v.id("pokerPlayers")),
    botKey: v.optional(v.string()),
    seatIndex: v.number(),
    name: v.string(),
    chips: v.number(),
    hole: v.array(v.object({ rank: v.string(), suit: v.string() })),
    folded: v.boolean(),
    allIn: v.boolean(),
    streetBet: v.number(),
    committed: v.number(),
    actedThisStreet: v.boolean(),
    isBot: v.boolean(),
    sittingOut: v.boolean(),
  })
    .index("by_table", ["tableId"])
    .index("by_player", ["playerId"]),

  /**
   * Comprehensive gambling transaction log for poker. Records every bet, raise, call,
   * fold, win, buy-in, and cash-out for audit and dispute resolution.
   */
  pokerTransactions: defineTable({
    playerId: v.id("pokerPlayers"),
    playerName: v.string(),
    isBot: v.boolean(),
    tableId: v.id("pokerTables"),
    handNumber: v.number(),
    
    // Transaction type and details
    eventType: v.union(
      v.literal("buy_in"),
      v.literal("bet"),
      v.literal("call"),
      v.literal("raise"),
      v.literal("fold"),
      v.literal("check"),
      v.literal("all_in"),
      v.literal("win"),
      v.literal("cash_out"),
      v.literal("timeout_forfeit"),
      v.literal("table_end")
    ),
    
    // Chip amounts
    chipsBefore: v.number(),
    chipsChange: v.number(),  // Positive for wins, negative for bets
    chipsAfter: v.number(),
    
    // Game context
    street: v.union(
      v.literal("preflop"),
      v.literal("flop"),
      v.literal("turn"),
      v.literal("river"),
      v.literal("showdown"),
      v.literal("n/a")
    ),
    potSize: v.number(),
    
    // Additional context
    reason: v.optional(v.string()),
    timestamp: v.number(),
    
    // For wins: what hand won
    winningHand: v.optional(v.object({
      category: v.string(),
      label: v.string(),
    })),
  })
    .index("by_player", ["playerId"])
    .index("by_table", ["tableId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_hand", ["tableId", "handNumber"])
    .index("by_player_timestamp", ["playerId", "timestamp"]),

  /**
   * Session summary for each poker player. Tracks aggregate stats across all hands
   * played during their session for quick analytics.
   */
  pokerSessionStats: defineTable({
    playerId: v.id("pokerPlayers"),
    playerName: v.string(),
    
    // Session timing
    sessionStart: v.number(),
    sessionEnd: v.optional(v.number()),
    lastActivity: v.number(),
    
    // Game statistics
    handsPlayed: v.number(),
    handsWon: v.number(),
    handsFolded: v.number(),
    handsAllIn: v.number(),
    
    // Financial tracking
    totalBuyIns: v.number(),
    totalCashOuts: v.number(),
    totalWagered: v.number(),   // Sum of all bets/raises/calls
    totalWon: v.number(),        // Sum of all pot winnings
    biggestPot: v.number(),
    
    // Net result
    netProfit: v.number(),       // totalCashOuts + currentTableChips - totalBuyIns
    
    // Starting/current balances
    startingPoints: v.number(),
    currentPoints: v.number(),
    
    // Tables
    tablesJoined: v.array(v.id("pokerTables")),
  })
    .index("by_player", ["playerId"])
    .index("by_session_start", ["sessionStart"])
    .index("by_last_activity", ["lastActivity"]),
});
