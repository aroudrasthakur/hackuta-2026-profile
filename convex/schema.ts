import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import {
  applicationRecord,
  applicationReviewStatus,
  applicationSubmissionLogRecord,
} from "./applicationFields";
import { applicationReviewLogAction } from "./admin/fields";
import { emailDeliveryKind } from "./lib/emailDeliveries";

/**
 * Deployment schema for standing-manatee-425 / production.
 *
 * Register-owned tables must match hackuta-2026-register/convex/schema.ts
 * (see convex/REGISTER_SCHEMA.md). Only applicationReviews, admins,
 * applicationReviewLogs, participants, adminAuthAccounts, adminSessions, and
 * decisionEmailQueue may be edited in this file.
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
    role: v.union(v.literal("reviewer"), v.literal("admin")),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_role", ["role"]),

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
    qrCodeToken: v.string(),
    foodRestriction: v.optional(v.string()),
    checkedInAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_application", ["applicationId"])
    .index("by_auth_user", ["authUserId"])
    .index("by_qr_token", ["qrCodeToken"]),

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
});
