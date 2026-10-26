import { v } from "convex/values";

/** Non-decision review activity recorded by `logApplicationReviewAction`. */
export const applicationReviewLogActivityAction = v.union(
  v.literal("viewed"),
  v.literal("started_review"),
  v.literal("review_ended"),
);

/** Decision events recorded by `setApplicationDecision`. */
export const applicationReviewLogDecisionAction = v.union(
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("waitlisted"),
);

/** Full append-only action union stored on `applicationReviewLogs.action`. */
export const applicationReviewLogAction = v.union(
  v.literal("viewed"),
  v.literal("started_review"),
  v.literal("review_ended"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("waitlisted"),
);

/** Organizer staff role stored on `admins.role`. */
export const staffRole = v.union(
  v.literal("reviewer"),
  v.literal("admin"),
  v.literal("volunteer"),
);

/** Volunteer and admin participant scan audit actions on `volunteerActionLogs.action`. */
export const volunteerActionLogAction = v.union(
  v.literal("check_in"),
  v.literal("food_check_in"),
  v.literal("point_scan"),
  v.literal("admin_adjust"),
  v.literal("shop_purchase"),
  v.literal("shop_refund"),
);

/** Admin-only staff and event configuration audit on `staffConfigLogs.action`. */
export const staffConfigLogAction = v.union(
  v.literal("volunteer_created"),
  v.literal("volunteer_promoted"),
  v.literal("volunteer_restored"),
  v.literal("volunteer_revoked"),
  v.literal("volunteer_password_reset"),
  v.literal("volunteer_capabilities_updated"),
  v.literal("event_created"),
  v.literal("event_updated"),
  v.literal("event_active_changed"),
  v.literal("volunteer_event_access_updated"),
  v.literal("shop_item_created"),
  v.literal("shop_item_updated"),
  v.literal("flash_sale_created"),
  v.literal("flash_sale_updated"),
  v.literal("flash_sale_cancelled"),
);

/** Lifecycle on `shopItems.status`. Archived items stay for purchase history. */
export const shopItemStatus = v.union(
  v.literal("active"),
  v.literal("inactive"),
  v.literal("archived"),
);

/** Why `shopItems.stockQuantity` changed, on `shopInventoryAdjustments.kind`. */
export const shopInventoryAdjustmentKind = v.union(
  v.literal("initial"),
  v.literal("manual"),
  v.literal("restock"),
  v.literal("purchase"),
  v.literal("refund_restock"),
);
