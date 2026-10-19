/**
 * Frozen copy of hackuta-2026-register/convex/schema.ts.
 * DO NOT EDIT — run npm run register-schema-lock:refresh to update from register.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import {
  applicationRecord,
  applicationReviewStatus,
  applicationSubmissionLogRecord,
} from "./applicationFields";
import { emailDeliveryKind } from "./lib/emailDeliveries";

export default defineSchema({
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

  applicationReviews: defineTable({
    applicationId: v.id("applications"),
    status: applicationReviewStatus,
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.id("users")),
    legacyReviewedBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_application", ["applicationId"])
    .index("by_reviewer", ["reviewedBy"])
    .index("by_status", ["status"]),

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
});
