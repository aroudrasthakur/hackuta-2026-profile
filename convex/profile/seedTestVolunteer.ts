import { v } from "convex/values";
import type { GenericId } from "convex/values";
import { internalMutation } from "../_generated/server";
import { insertVolunteer } from "../admin/volunteerProvisioning";
import { setStaffPassword } from "../admin/staffCredentials";
import { ensureEventConfig } from "../lib/eventConfig";
import { normalizeEmail } from "../lib/normalizeEmail";
import type { MutationCtx } from "../lib/dataModel";
import { isSharedDevSeedDeployment } from "./devSeedGuard";

const DEFAULT_TEST_EMAIL = "testing-volunteer@hackuta.dev";
const DEFAULT_TEST_PASSWORD = "HackutaVolunteerTest1";
const DEFAULT_TEST_NAME = "Testing Volunteer";

const SAMPLE_EVENTS = [
  { name: "Intro to Hardware", pointsAwarded: 25 },
  { name: "Career Panel", pointsAwarded: 10 },
] as const;

function assertDevSeedAllowed() {
  if (!isSharedDevSeedDeployment(process.env.CONVEX_CLOUD_URL)) {
    throw new Error(
      "Test volunteer seed is only allowed on the shared dev deployment (standing-manatee-425).",
    );
  }
}

async function ensureSeedAdmin(ctx: MutationCtx) {
  const existing = await ctx.db
    .query("admins")
    .withIndex("by_email", (q) => q.eq("email", "dev-seed@hackuta.internal"))
    .unique();
  if (existing) {
    return existing;
  }
  const now = Date.now();
  const adminId = await ctx.db.insert("admins", {
    email: "dev-seed@hackuta.internal",
    name: "Dev Seed Bot",
    role: "admin",
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  const admin = await ctx.db.get(adminId);
  if (!admin) {
    throw new Error("Could not create seed admin.");
  }
  return admin;
}

async function ensureSampleEvents(ctx: MutationCtx) {
  const active = await ctx.db
    .query("events")
    .withIndex("by_active", (q) => q.eq("active", true))
    .take(2);
  if (active.length >= 2) {
    return active.slice(0, 2).map((event) => event._id);
  }

  const now = Date.now();
  const ids: GenericId<"events">[] = active.map((event) => event._id);
  for (const sample of SAMPLE_EVENTS.slice(ids.length)) {
    ids.push(await ctx.db.insert("events", {
      name: sample.name,
      pointsAwarded: sample.pointsAwarded,
      startsAt: now - 60 * 60 * 1000,
      endsAt: now + 7 * 24 * 60 * 60 * 1000,
      active: true,
      createdAt: now,
      updatedAt: now,
    }));
  }
  return ids;
}

async function replaceVolunteerEventAccess(
  ctx: MutationCtx,
  actorAdminId: GenericId<"admins">,
  volunteerAdminId: GenericId<"admins">,
  eventIds: GenericId<"events">[],
) {
  const current = await ctx.db
    .query("volunteerEventAccess")
    .withIndex("by_volunteer", (q) => q.eq("volunteerAdminId", volunteerAdminId))
    .collect();
  const desired = new Set(eventIds);
  for (const row of current) {
    if (!desired.has(row.eventId)) {
      await ctx.db.delete(row._id);
    }
  }
  const now = Date.now();
  for (const eventId of desired) {
    const existing = current.find((row) => row.eventId === eventId);
    if (!existing) {
      await ctx.db.insert("volunteerEventAccess", {
        volunteerAdminId,
        eventId,
        grantedBy: actorAdminId,
        createdAt: now,
      });
    }
  }
}

/**
 * Dev-only: active volunteer with check-in, food, and two event assignments for scanner QA.
 * Run: npx convex run profile/seedTestVolunteer:seedTestVolunteer --env-file .env.local
 */
export const seedTestVolunteer = internalMutation({
  args: {
    email: v.optional(v.string()),
    password: v.optional(v.string()),
    name: v.optional(v.string()),
    resetPassword: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertDevSeedAllowed();

    const email = normalizeEmail(args.email ?? DEFAULT_TEST_EMAIL);
    const password = args.password ?? DEFAULT_TEST_PASSWORD;
    const name = args.name ?? DEFAULT_TEST_NAME;
    if (!email) {
      throw new Error("A valid email is required.");
    }

    await ensureEventConfig(ctx);
    const actor = await ensureSeedAdmin(ctx);

    let volunteer = await ctx.db
      .query("admins")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    let passwordNote = password;
    if (volunteer) {
      if (volunteer.role !== "volunteer") {
        throw new Error("That email is already used by a non-volunteer staff account.");
      }
      const now = Date.now();
      await ctx.db.patch(volunteer._id, {
        name,
        active: true,
        canCheckIn: true,
        canFoodCheckIn: true,
        updatedAt: now,
      });
      if (args.resetPassword) {
        await setStaffPassword(ctx, volunteer._id, password);
      } else {
        passwordNote = "(unchanged — account already existed; pass resetPassword: true to set a new password)";
      }
      volunteer = await ctx.db.get(volunteer._id);
    } else {
      const created = await insertVolunteer(ctx, actor._id, {
        email,
        name,
        password,
        canCheckIn: true,
        canFoodCheckIn: true,
      });
      volunteer = await ctx.db.get(created.adminId);
    }

    if (!volunteer) {
      throw new Error("Volunteer row could not be created.");
    }

    const eventIds = await ensureSampleEvents(ctx);
    await replaceVolunteerEventAccess(ctx, actor._id, volunteer._id, eventIds);
    const events = [];
    for (const eventId of eventIds) {
      const event = await ctx.db.get(eventId);
      if (event) {
        events.push({ eventId, name: event.name, pointsAwarded: event.pointsAwarded });
      }
    }

    return {
      email,
      password: passwordNote,
      name,
      adminId: volunteer._id,
      canCheckIn: true,
      canFoodCheckIn: true,
      events,
      adminSignInUrl: "http://127.0.0.1:5373/admin/login",
      volunteerDashboardUrl: "http://127.0.0.1:5373/admin/scan",
    };
  },
});
