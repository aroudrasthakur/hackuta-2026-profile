/**
 * Administrator-only participant notifications management: drafts, immediate
 * publishing, scheduled delivery via Convex scheduled functions, cancellation,
 * and legacy flash-sale announcement migration. Every public export calls
 * `requireAdminRole` first.
 */
import { makeFunctionReference, paginationOptsValidator, type DocumentByName } from "convex/server";
import { v, type GenericId } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { DataModel, MutationCtx, QueryCtx } from "../lib/dataModel";
import { adminError } from "../../shared/admin/errors";
import {
  assertNotificationExpiry,
  assertNotificationSchedule,
  normalizeNotificationInput,
  normalizeNotificationSearch,
  type NotificationType,
} from "../../shared/admin/notificationRules";
import { buildStaffConfigDetails } from "../../shared/admin/volunteerRules";
import { nameLookups } from "./adminQueryHelpers";
import { participantNotificationStatus, participantNotificationType } from "./fields";
import { requireAdminRole, sessionTokenArgs } from "./staffAuth";

type NotificationDoc = DocumentByName<DataModel, "participantNotifications">;
type NotificationId = GenericId<"participantNotifications">;
type AdminId = GenericId<"admins">;
type ScheduledJobId = GenericId<"_scheduled_functions">;

export const publishScheduledNotificationRef = makeFunctionReference<
  "mutation",
  { notificationId: NotificationId; scheduleVersion: number },
  { published: boolean }
>("admin/notifications:publishScheduledNotification");

const notificationFieldArgs = {
  title: v.string(),
  message: v.string(),
  type: participantNotificationType,
  linkUrl: v.optional(v.union(v.string(), v.null())),
  linkLabel: v.optional(v.union(v.string(), v.null())),
  expiresAt: v.optional(v.union(v.number(), v.null())),
  relatedEventId: v.optional(v.union(v.id("events"), v.null())),
};

type NotificationMutationInput = {
  title: string;
  message: string;
  type: NotificationType;
  linkUrl?: string | null;
  linkLabel?: string | null;
  expiresAt?: number | null;
  relatedEventId?: GenericId<"events"> | null;
};

export async function cancelPendingNotificationJob(
  ctx: MutationCtx,
  jobId?: ScheduledJobId,
) {
  if (!jobId) return;
  const job = await ctx.db.system.get(jobId);
  if (job?.state.kind === "pending") {
    await ctx.scheduler.cancel(jobId);
  }
}

async function assertRelatedEvent(
  ctx: MutationCtx,
  relatedEventId?: GenericId<"events"> | null,
): Promise<GenericId<"events"> | undefined> {
  if (!relatedEventId) return undefined;
  const event = await ctx.db.get(relatedEventId);
  if (!event) throw adminError("EVENT_NOT_FOUND");
  return relatedEventId;
}

async function requireEditableNotification(
  ctx: MutationCtx,
  notificationId: NotificationId,
): Promise<NotificationDoc> {
  const existing = await ctx.db.get(notificationId);
  if (!existing) throw adminError("NOTIFICATION_NOT_FOUND");
  if (existing.status === "published" || existing.status === "cancelled") {
    throw adminError("NOTIFICATION_NOT_EDITABLE");
  }
  return existing;
}

function logNotificationConfig(
  ctx: MutationCtx,
  actorAdminId: AdminId,
  action:
    | "notification_created"
    | "notification_updated"
    | "notification_published"
    | "notification_scheduled"
    | "notification_cancelled",
  targetNotificationId: NotificationId,
  now: number,
  changedFields?: string[],
) {
  return ctx.db.insert("staffConfigLogs", {
    actorAdminId,
    action,
    targetNotificationId,
    ...(changedFields ? { details: buildStaffConfigDetails({ changedFields }) } : {}),
    createdAt: now,
  });
}

async function formatNotificationAdminRow(
  ctx: QueryCtx | MutationCtx,
  row: NotificationDoc,
  names: ReturnType<typeof nameLookups>,
  saleTitles: Map<string, string>,
  now: number,
) {
  let relatedFlashSale: { flashSaleId: GenericId<"shopFlashSales">; title: string } | null = null;
  if (row.relatedFlashSaleId) {
    if (!saleTitles.has(row.relatedFlashSaleId)) {
      const sale = await ctx.db.get(row.relatedFlashSaleId);
      saleTitles.set(row.relatedFlashSaleId, sale?.title ?? "Flash sale");
    }
    relatedFlashSale = {
      flashSaleId: row.relatedFlashSaleId,
      title: saleTitles.get(row.relatedFlashSaleId)!,
    };
  }

  const relatedEvent = row.relatedEventId
    ? {
        eventId: row.relatedEventId,
        name: await names.eventName(row.relatedEventId),
      }
    : null;

  return {
    notificationId: row._id,
    title: row.title,
    message: row.message,
    type: row.type,
    status: row.status,
    scheduledAt: row.scheduledAt ?? null,
    publishedAt: row.publishedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    cancelledAt: row.cancelledAt ?? null,
    expired: row.status === "published" && row.expiresAt !== undefined && row.expiresAt <= now,
    linkUrl: row.linkUrl ?? null,
    linkLabel: row.linkLabel ?? null,
    relatedEvent,
    relatedFlashSale,
    createdBy: { adminId: row.createdBy, name: await names.staffName(row.createdBy) },
    updatedBy: row.updatedBy
      ? { adminId: row.updatedBy, name: await names.staffName(row.updatedBy) }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Creates or updates a flash sale's linked `participantNotifications` row,
 * scheduling automatic publication when `startsAt > now` or publishing
 * immediately when the sale starts now.
 */
export async function upsertFlashSaleNotification(
  ctx: MutationCtx,
  params: {
    actorAdminId: AdminId;
    flashSaleId: GenericId<"shopFlashSales">;
    existingNotificationId?: NotificationId | undefined;
    legacyAnnouncementId?: GenericId<"participantAnnouncements"> | undefined;
    title: string;
    message: string;
    startsAt: number;
    endsAt: number;
    now: number;
  },
): Promise<NotificationId> {
  const message = params.message.trim() || "Limited-time shop discount is live.";
  const existing =
    (params.existingNotificationId ? await ctx.db.get(params.existingNotificationId) : null) ??
    (await ctx.db
      .query("participantNotifications")
      .withIndex("by_flash_sale", (q) => q.eq("relatedFlashSaleId", params.flashSaleId))
      .first());

  const isImmediate = params.startsAt <= params.now;
  const nextVersion = (existing?.scheduleVersion ?? 0) + 1;

  if (existing) {
    await cancelPendingNotificationJob(ctx, existing.scheduledJobId);
    const scheduledJobId = isImmediate
      ? undefined
      : await ctx.scheduler.runAt(params.startsAt, publishScheduledNotificationRef, {
          notificationId: existing._id,
          scheduleVersion: nextVersion,
        });
    await ctx.db.patch(existing._id, {
      title: params.title,
      message,
      type: "flash_sale",
      status: isImmediate ? "published" : "scheduled",
      scheduledAt: isImmediate ? undefined : params.startsAt,
      publishedAt: isImmediate ? params.now : undefined,
      expiresAt: params.endsAt,
      cancelledAt: undefined,
      cancelledBy: undefined,
      scheduleVersion: nextVersion,
      scheduledJobId,
      linkUrl: existing.linkUrl ?? "/dashboard",
      linkLabel: existing.linkLabel ?? "Open dashboard",
      relatedFlashSaleId: params.flashSaleId,
      ...(params.legacyAnnouncementId ? { legacyAnnouncementId: params.legacyAnnouncementId } : {}),
      updatedBy: params.actorAdminId,
      updatedAt: params.now,
    });
    return existing._id;
  }

  const notificationId = await ctx.db.insert("participantNotifications", {
    title: params.title,
    message,
    type: "flash_sale",
    status: isImmediate ? "published" : "scheduled",
    ...(isImmediate ? { publishedAt: params.now } : { scheduledAt: params.startsAt }),
    expiresAt: params.endsAt,
    scheduleVersion: 1,
    linkUrl: "/dashboard",
    linkLabel: "Open dashboard",
    relatedFlashSaleId: params.flashSaleId,
    ...(params.legacyAnnouncementId ? { legacyAnnouncementId: params.legacyAnnouncementId } : {}),
    createdBy: params.actorAdminId,
    updatedBy: params.actorAdminId,
    createdAt: params.now,
    updatedAt: params.now,
  });

  if (!isImmediate) {
    const scheduledJobId = await ctx.scheduler.runAt(params.startsAt, publishScheduledNotificationRef, {
      notificationId,
      scheduleVersion: 1,
    });
    await ctx.db.patch(notificationId, { scheduledJobId });
  }

  return notificationId;
}

/** Cancels a flash sale's linked notification and any pending scheduled publication job. */
export async function cancelFlashSaleNotification(
  ctx: MutationCtx,
  params: {
    actorAdminId: AdminId;
    flashSaleId: GenericId<"shopFlashSales">;
    existingNotificationId?: NotificationId | undefined;
    now: number;
  },
) {
  const existing =
    (params.existingNotificationId ? await ctx.db.get(params.existingNotificationId) : null) ??
    (await ctx.db
      .query("participantNotifications")
      .withIndex("by_flash_sale", (q) => q.eq("relatedFlashSaleId", params.flashSaleId))
      .first());
  if (!existing) return;

  await cancelPendingNotificationJob(ctx, existing.scheduledJobId);
  await ctx.db.patch(existing._id, {
    status: "cancelled",
    cancelledAt: params.now,
    cancelledBy: params.actorAdminId,
    scheduledJobId: undefined,
    scheduleVersion: (existing.scheduleVersion ?? 0) + 1,
    updatedBy: params.actorAdminId,
    updatedAt: params.now,
  });
}

async function applyDraftFields(
  ctx: MutationCtx,
  actorAdminId: AdminId,
  notificationId: NotificationId | undefined,
  args: NotificationMutationInput,
  now: number,
) {
  const input = normalizeNotificationInput(args);
  const relatedEventId = await assertRelatedEvent(ctx, args.relatedEventId);

  if (notificationId) {
    const existing = await requireEditableNotification(ctx, notificationId);
    await cancelPendingNotificationJob(ctx, existing.scheduledJobId);
    const scheduleVersion = (existing.scheduleVersion ?? 0) + 1;
    await ctx.db.patch(notificationId, {
      title: input.title,
      message: input.message,
      type: input.type,
      status: "draft",
      scheduledAt: undefined,
      publishedAt: undefined,
      expiresAt: input.expiresAt,
      scheduledJobId: undefined,
      scheduleVersion,
      linkUrl: input.linkUrl,
      linkLabel: input.linkLabel,
      relatedEventId,
      updatedBy: actorAdminId,
      updatedAt: now,
    });
    await logNotificationConfig(ctx, actorAdminId, "notification_updated", notificationId, now, [
      "title",
      "message",
      "type",
      "status",
    ]);
    return { notificationId };
  }

  const createdId = await ctx.db.insert("participantNotifications", {
    title: input.title,
    message: input.message,
    type: input.type,
    status: "draft",
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    scheduleVersion: 1,
    ...(input.linkUrl !== undefined ? { linkUrl: input.linkUrl } : {}),
    ...(input.linkLabel !== undefined ? { linkLabel: input.linkLabel } : {}),
    ...(relatedEventId !== undefined ? { relatedEventId } : {}),
    createdBy: actorAdminId,
    updatedBy: actorAdminId,
    createdAt: now,
    updatedAt: now,
  });
  await logNotificationConfig(ctx, actorAdminId, "notification_created", createdId, now);
  return { notificationId: createdId };
}

/** Creates a new draft notification or updates an unpublished notification as a draft. */
export const saveNotificationDraft = mutation({
  args: {
    ...sessionTokenArgs,
    notificationId: v.optional(v.id("participantNotifications")),
    ...notificationFieldArgs,
  },
  handler: async (ctx, { sessionToken, notificationId, ...args }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    return applyDraftFields(ctx, actor._id, notificationId, args, Date.now());
  },
});

/** Publishes a new notification or an existing draft/scheduled notification immediately. */
export const publishNotificationNow = mutation({
  args: {
    ...sessionTokenArgs,
    notificationId: v.optional(v.id("participantNotifications")),
    ...notificationFieldArgs,
  },
  handler: async (ctx, { sessionToken, notificationId, ...args }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const now = Date.now();
    const input = normalizeNotificationInput(args);
    assertNotificationExpiry(now, input.expiresAt);
    const relatedEventId = await assertRelatedEvent(ctx, args.relatedEventId);

    if (notificationId) {
      const existing = await requireEditableNotification(ctx, notificationId);
      await cancelPendingNotificationJob(ctx, existing.scheduledJobId);
      const scheduleVersion = (existing.scheduleVersion ?? 0) + 1;
      await ctx.db.patch(notificationId, {
        title: input.title,
        message: input.message,
        type: input.type,
        status: "published",
        scheduledAt: undefined,
        publishedAt: now,
        expiresAt: input.expiresAt,
        scheduledJobId: undefined,
        scheduleVersion,
        linkUrl: input.linkUrl,
        linkLabel: input.linkLabel,
        relatedEventId,
        updatedBy: actor._id,
        updatedAt: now,
      });
      await logNotificationConfig(ctx, actor._id, "notification_published", notificationId, now);
      return { notificationId, publishedAt: now };
    }

    const createdId = await ctx.db.insert("participantNotifications", {
      title: input.title,
      message: input.message,
      type: input.type,
      status: "published",
      publishedAt: now,
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      scheduleVersion: 1,
      ...(input.linkUrl !== undefined ? { linkUrl: input.linkUrl } : {}),
      ...(input.linkLabel !== undefined ? { linkLabel: input.linkLabel } : {}),
      ...(relatedEventId !== undefined ? { relatedEventId } : {}),
      createdBy: actor._id,
      updatedBy: actor._id,
      createdAt: now,
      updatedAt: now,
    });
    await logNotificationConfig(ctx, actor._id, "notification_published", createdId, now);
    return { notificationId: createdId, publishedAt: now };
  },
});

/** Schedules a new notification or updates/reschedules an unpublished notification for future delivery. */
export const scheduleNotification = mutation({
  args: {
    ...sessionTokenArgs,
    notificationId: v.optional(v.id("participantNotifications")),
    scheduledAt: v.number(),
    ...notificationFieldArgs,
  },
  handler: async (ctx, { sessionToken, notificationId, scheduledAt, ...args }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const now = Date.now();
    const input = normalizeNotificationInput(args);
    assertNotificationSchedule(scheduledAt, now, input.expiresAt);
    const relatedEventId = await assertRelatedEvent(ctx, args.relatedEventId);

    if (notificationId) {
      const existing = await requireEditableNotification(ctx, notificationId);
      await cancelPendingNotificationJob(ctx, existing.scheduledJobId);
      const scheduleVersion = (existing.scheduleVersion ?? 0) + 1;
      const scheduledJobId = await ctx.scheduler.runAt(
        scheduledAt,
        publishScheduledNotificationRef,
        { notificationId, scheduleVersion },
      );
      await ctx.db.patch(notificationId, {
        title: input.title,
        message: input.message,
        type: input.type,
        status: "scheduled",
        scheduledAt,
        publishedAt: undefined,
        expiresAt: input.expiresAt,
        scheduledJobId,
        scheduleVersion,
        linkUrl: input.linkUrl,
        linkLabel: input.linkLabel,
        relatedEventId,
        updatedBy: actor._id,
        updatedAt: now,
      });
      await logNotificationConfig(ctx, actor._id, "notification_scheduled", notificationId, now, [
        "title",
        "message",
        "type",
        "scheduledAt",
      ]);
      return { notificationId, scheduledAt };
    }

    const scheduleVersion = 1;
    const createdId = await ctx.db.insert("participantNotifications", {
      title: input.title,
      message: input.message,
      type: input.type,
      status: "scheduled",
      scheduledAt,
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      scheduleVersion,
      ...(input.linkUrl !== undefined ? { linkUrl: input.linkUrl } : {}),
      ...(input.linkLabel !== undefined ? { linkLabel: input.linkLabel } : {}),
      ...(relatedEventId !== undefined ? { relatedEventId } : {}),
      createdBy: actor._id,
      updatedBy: actor._id,
      createdAt: now,
      updatedAt: now,
    });
    const scheduledJobId = await ctx.scheduler.runAt(
      scheduledAt,
      publishScheduledNotificationRef,
      { notificationId: createdId, scheduleVersion },
    );
    await ctx.db.patch(createdId, { scheduledJobId });
    await logNotificationConfig(ctx, actor._id, "notification_scheduled", createdId, now);
    return { notificationId: createdId, scheduledAt };
  },
});

/**
 * Updates an unpublished notification (draft or scheduled), keeping its current
 * status unless `scheduledAt` is supplied for a scheduled notification.
 */
export const updateNotification = mutation({
  args: {
    ...sessionTokenArgs,
    notificationId: v.id("participantNotifications"),
    scheduledAt: v.optional(v.union(v.number(), v.null())),
    ...notificationFieldArgs,
  },
  handler: async (ctx, { sessionToken, notificationId, scheduledAt, ...args }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const existing = await requireEditableNotification(ctx, notificationId);
    const now = Date.now();
    const input = normalizeNotificationInput(args);
    const relatedEventId = await assertRelatedEvent(ctx, args.relatedEventId);

    if (existing.status === "scheduled" || scheduledAt != null) {
      const targetScheduledAt = scheduledAt ?? existing.scheduledAt;
      if (targetScheduledAt === undefined) throw adminError("INVALID_NOTIFICATION_SCHEDULE");
      assertNotificationSchedule(targetScheduledAt, now, input.expiresAt);
      await cancelPendingNotificationJob(ctx, existing.scheduledJobId);
      const scheduleVersion = (existing.scheduleVersion ?? 0) + 1;
      const scheduledJobId = await ctx.scheduler.runAt(
        targetScheduledAt,
        publishScheduledNotificationRef,
        { notificationId, scheduleVersion },
      );
      await ctx.db.patch(notificationId, {
        title: input.title,
        message: input.message,
        type: input.type,
        status: "scheduled",
        scheduledAt: targetScheduledAt,
        expiresAt: input.expiresAt,
        scheduledJobId,
        scheduleVersion,
        linkUrl: input.linkUrl,
        linkLabel: input.linkLabel,
        relatedEventId,
        updatedBy: actor._id,
        updatedAt: now,
      });
      await logNotificationConfig(ctx, actor._id, "notification_updated", notificationId, now, [
        "title",
        "message",
        "type",
        "scheduledAt",
      ]);
      return { ok: true as const, status: "scheduled" as const };
    }

    await applyDraftFields(ctx, actor._id, notificationId, args, now);
    return { ok: true as const, status: "draft" as const };
  },
});

/** Cancels a draft or scheduled notification and prevents any pending scheduled job from publishing. */
export const cancelNotification = mutation({
  args: {
    ...sessionTokenArgs,
    notificationId: v.id("participantNotifications"),
  },
  handler: async (ctx, { sessionToken, notificationId }) => {
    const actor = await requireAdminRole(ctx, sessionToken);
    const existing = await requireEditableNotification(ctx, notificationId);
    const now = Date.now();

    await cancelPendingNotificationJob(ctx, existing.scheduledJobId);
    await ctx.db.patch(notificationId, {
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: actor._id,
      scheduledJobId: undefined,
      scheduleVersion: (existing.scheduleVersion ?? 0) + 1,
      updatedBy: actor._id,
      updatedAt: now,
    });
    await logNotificationConfig(ctx, actor._id, "notification_cancelled", notificationId, now);
    return { ok: true as const };
  },
});

/**
 * Scheduled job callback invoked at `scheduledAt`. Verifies the notification is
 * still in `"scheduled"` status and that `scheduleVersion` matches the latest
 * version so rescheduling, editing, or cancellation prevents stale publication.
 */
export const publishScheduledNotification = internalMutation({
  args: {
    notificationId: v.id("participantNotifications"),
    scheduleVersion: v.number(),
  },
  handler: async (ctx, { notificationId, scheduleVersion }) => {
    const row = await ctx.db.get(notificationId);
    if (!row || row.status !== "scheduled" || (row.scheduleVersion ?? 0) !== scheduleVersion) {
      return { published: false };
    }
    const now = Date.now();
    await ctx.db.patch(notificationId, {
      status: "published",
      publishedAt: now,
      scheduledJobId: undefined,
      updatedAt: now,
    });
    await logNotificationConfig(
      ctx,
      row.updatedBy ?? row.createdBy,
      "notification_published",
      notificationId,
      now,
    );
    return { published: true };
  },
});

/**
 * One-time / idempotent migration from legacy `participantAnnouncements` rows
 * into `participantNotifications`. Preserves existing flash-sale links and
 * schedules future announcements.
 */
export const migrateAnnouncementsToNotifications = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let migrated = 0;
    let skipped = 0;

    for await (const legacy of ctx.db.query("participantAnnouncements")) {
      const byLegacy = await ctx.db
        .query("participantNotifications")
        .withIndex("by_legacy_announcement", (q) => q.eq("legacyAnnouncementId", legacy._id))
        .first();
      const bySale = legacy.flashSaleId
        ? await ctx.db
            .query("participantNotifications")
            .withIndex("by_flash_sale", (q) => q.eq("relatedFlashSaleId", legacy.flashSaleId))
            .first()
        : null;

      if (byLegacy || bySale) {
        skipped += 1;
        continue;
      }

      const isCancelled = legacy.withdrawnAt !== undefined;
      const isScheduled = !isCancelled && legacy.publishedAt > now;
      const status = isCancelled ? "cancelled" : isScheduled ? "scheduled" : "published";

      const notificationId = await ctx.db.insert("participantNotifications", {
        title: legacy.title,
        message: legacy.body.trim() || "Limited-time shop discount is live.",
        type: legacy.kind === "flash_sale" ? "flash_sale" : "general",
        status,
        ...(isScheduled ? { scheduledAt: legacy.publishedAt } : {}),
        ...(!isCancelled && !isScheduled ? { publishedAt: legacy.publishedAt } : {}),
        ...(legacy.expiresAt !== undefined ? { expiresAt: legacy.expiresAt } : {}),
        ...(legacy.withdrawnAt !== undefined
          ? { cancelledAt: legacy.withdrawnAt, cancelledBy: legacy.createdBy }
          : {}),
        scheduleVersion: 1,
        ...(legacy.kind === "flash_sale"
          ? { linkUrl: "/dashboard", linkLabel: "Open dashboard" }
          : {}),
        ...(legacy.flashSaleId ? { relatedFlashSaleId: legacy.flashSaleId } : {}),
        legacyAnnouncementId: legacy._id,
        createdBy: legacy.createdBy,
        updatedBy: legacy.createdBy,
        createdAt: legacy.createdAt,
        updatedAt: legacy.withdrawnAt ?? legacy.createdAt,
      });

      if (isScheduled) {
        const scheduledJobId = await ctx.scheduler.runAt(
          legacy.publishedAt,
          publishScheduledNotificationRef,
          { notificationId, scheduleVersion: 1 },
        );
        await ctx.db.patch(notificationId, { scheduledJobId });
      }

      if (legacy.flashSaleId) {
        const sale = await ctx.db.get(legacy.flashSaleId);
        if (sale && !sale.notificationId) {
          await ctx.db.patch(legacy.flashSaleId, { notificationId });
        }
      }

      migrated += 1;
    }

    return { ok: true as const, migrated, skipped };
  },
});

/**
 * Paginated admin notification list, newest update first. Supports filtering by
 * status and type, and case-insensitive search across title and message.
 */
export const listNotificationsAdmin = query({
  args: {
    ...sessionTokenArgs,
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    type: v.optional(participantNotificationType),
    status: v.optional(participantNotificationStatus),
    nowBucket: v.optional(v.number()),
  },
  handler: async (ctx, { sessionToken, paginationOpts, search, type, status }) => {
    await requireAdminRole(ctx, sessionToken);
    const term = normalizeNotificationSearch(search);
    const now = Date.now();
    const table = ctx.db.query("participantNotifications");
    const indexed = status
      ? table.withIndex("by_status_updatedAt", (q) => q.eq("status", status))
      : type
        ? table.withIndex("by_type_updatedAt", (q) => q.eq("type", type))
        : table.withIndex("by_updatedAt");
    const result = await indexed.order("desc").paginate(paginationOpts);

    const names = nameLookups(ctx);
    const saleTitles = new Map<string, string>();
    const page = [];
    for (const row of result.page) {
      if (type && row.type !== type) continue;
      if (status && row.status !== status) continue;
      if (
        term &&
        !row.title.toLowerCase().includes(term) &&
        !row.message.toLowerCase().includes(term)
      ) {
        continue;
      }
      page.push(await formatNotificationAdminRow(ctx, row, names, saleTitles, now));
    }
    return { ...result, page };
  },
});

/** Single notification details for the admin detail/edit view. */
export const getNotificationAdmin = query({
  args: {
    ...sessionTokenArgs,
    notificationId: v.id("participantNotifications"),
  },
  handler: async (ctx, { sessionToken, notificationId }) => {
    await requireAdminRole(ctx, sessionToken);
    const row = await ctx.db.get(notificationId);
    if (!row) return null;
    const names = nameLookups(ctx);
    const saleTitles = new Map<string, string>();
    return formatNotificationAdminRow(ctx, row, names, saleTitles, Date.now());
  },
});
