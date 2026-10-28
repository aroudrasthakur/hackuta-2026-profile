import type { GenericId } from "convex/values";
import { vi } from "vitest";
import type { ConvexTestInstance } from "./convexTestContext";
import { ADMIN_SESSION_TTL_MS } from "../../convex/admin/staffAuth";
import { insertStaffSession } from "./staffTestFixtures";

export type StaffRole = "admin" | "volunteer";
export type Decision = "accepted" | "rejected" | "waitlisted";

let staffCounter = 0;

/** Inserts one staff account with a full-length session. Skips password hashing to stay fast. */
export async function seedStaff(
  t: ConvexTestInstance,
  fields: { role?: StaffRole; active?: boolean; name?: string } = {},
) {
  staffCounter += 1;
  const n = staffCounter;
  const adminId = await t.run((ctx) =>
    ctx.db.insert("admins", {
      email: `staff-${n}@hackuta.org`,
      name: fields.name ?? `Organizer ${n}`,
      role: fields.role ?? "admin",
      active: fields.active ?? true,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  const { sessionToken } = await insertStaffSession(t, {
    adminId,
    sessionToken: n.toString(16).padStart(64, "0"),
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS,
  });
  return { adminId, sessionToken };
}

/** A full submitted application, so data-integrity checks compare real answers. */
export const sampleApplicantAnswers = {
  firstName: "Taylor",
  lastName: "Student",
  phone: "+18175550100",
  phoneCountry: "US",
  age: 20,
  school: "The University of Texas at Arlington",
  levelOfStudy: "Undergraduate University (3+ year)",
  major: "Computer Science",
  graduationYear: 2027,
  dietaryRestrictions: ["Vegetarian"],
  countryOfResidence: "United States",
  tshirtSize: "M",
  github: "https://github.com/taylor",
  builtOrWantToBuild: "A campus map app.",
  mlhCodeOfConductAgreed: true,
  mlhDataSharingConsent: true,
} as const;

/**
 * Seeds one applicant user, application, and optional review row. Each call
 * makes new rows, so tests never share applicant data.
 */
export async function seedApplicant(
  t: ConvexTestInstance,
  options: {
    email?: string;
    submitted?: boolean;
    fields?: Record<string, unknown>;
    review?: Record<string, unknown> | null;
  } = {},
) {
  const email = options.email ?? `applicant-${++staffCounter}@example.com`;
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: "Taylor Student" });
    const applicationId = await ctx.db.insert("applications", {
      authUserId: userId,
      email,
      createdAt: 1,
      ...sampleApplicantAnswers,
      ...(options.submitted === false ? {} : { formSubmitted: true, submittedAt: 2 }),
      ...options.fields,
    } as never);
    let reviewId: GenericId<"applicationReviews"> | null = null;
    if (options.review !== null) {
      reviewId = await ctx.db.insert("applicationReviews", {
        applicationId,
        status: "under_review",
        createdAt: 1,
        updatedAt: 1,
        ...options.review,
      } as never);
    }
    return { userId, applicationId, reviewId };
  });
}

export function getReview(t: ConvexTestInstance, applicationId: GenericId<"applications">) {
  return t.run((ctx) =>
    ctx.db
      .query("applicationReviews")
      .withIndex("by_application", (q) => q.eq("applicationId", applicationId))
      .unique(),
  );
}

export function getLogs(t: ConvexTestInstance, applicationId: GenericId<"applications">) {
  return t.run((ctx) =>
    ctx.db
      .query("applicationReviewLogs")
      .withIndex("by_application_createdAt", (q) => q.eq("applicationId", applicationId))
      .collect(),
  );
}

export function countRows(
  t: ConvexTestInstance,
  table: "applicationReviewLogs" | "participants" | "applicationReviews",
) {
  return t.run(async (ctx) => (await ctx.db.query(table).collect()).length);
}

export function scheduledJobs(t: ConvexTestInstance) {
  return t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
}

/** Applicant-owned rows. Review actions must never change these. */
export function snapshotApplicant(
  t: ConvexTestInstance,
  ids: { applicationId: GenericId<"applications">; userId: GenericId<"users"> },
) {
  return t.run(async (ctx) => ({
    application: await ctx.db.get(ids.applicationId),
    user: await ctx.db.get(ids.userId),
  }));
}

/** Everything a decision could write. Used to prove a rejected call wrote nothing. */
export function snapshotReviewState(t: ConvexTestInstance) {
  return t.run(async (ctx) => ({
    applications: await ctx.db.query("applications").collect(),
    reviews: await ctx.db.query("applicationReviews").collect(),
    logs: await ctx.db.query("applicationReviewLogs").collect(),
    participants: await ctx.db.query("participants").collect(),
    scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
  }));
}

export const EMAIL_SERVICE_URL = "https://email.test";

/** Fake email service. Records every request so tests can check what was sent. */
export function stubEmailService() {
  vi.stubEnv("EMAIL_SERVICE_URL", EMAIL_SERVICE_URL);
  vi.stubEnv("EMAIL_SERVICE_API_KEY", "test-api-key");
  let queued = 0;
  const fetchMock = vi.fn<typeof fetch>(() => {
    queued += 1;
    return Promise.resolve(Response.json({ id: `queued-${queued}` }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const sentEmails = () =>
    fetchMock.mock.calls.map(([url, init]) => ({
      url: url as string,
      body: JSON.parse((init?.body as string | undefined) ?? "{}") as Record<string, string>,
    }));
  return { fetchMock, sentEmails };
}
