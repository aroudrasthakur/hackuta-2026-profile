import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import {
  ensureMailConfig,
  getMailConfigFlags,
  isConfirmationEmailEnabled,
  isDecisionEmailEnabled,
  mailConfigFlagsFromRow,
} from "../../convex/lib/mailConfig";
import { validRegistrationPayload } from "../fixtures/validRegistrationForm";

const modules = import.meta.glob("../../convex/**/*.ts", { eager: false });
const createTest = () => convexTest(schema, modules);
const readMailConfigFlags = makeFunctionReference<"query">("lib/mailConfig:readMailConfigFlags");
const submitRegistration = makeFunctionReference<"mutation">("registrations:submitRegistration");

async function insertMailConfig(
  t: ReturnType<typeof createTest>,
  flags: { confirmationEmail: boolean; decisionEmail: boolean },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("mailConfig", {
      key: "current",
      ...flags,
      updatedAt: Date.now(),
    });
  });
}

async function submitAsApplicant(t = createTest(), drain = true) {
  const email = "applicant@example.com";
  const userId = await t.run(async (ctx) => {
    return ctx.db.insert("users", {
      email,
      emailVerificationTime: Date.now(),
    });
  });
  await t.withIdentity({
    email,
    subject: userId,
    tokenIdentifier: `email|${email}`,
  }).mutation(submitRegistration, {
    data: validRegistrationPayload(),
  });
  if (drain) {
    vi.useFakeTimers();
    try {
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
  }
  return t;
}

describe("mailConfigFlagsFromRow", () => {
  it("defaults both flags to true when the row is missing", () => {
    expect(mailConfigFlagsFromRow(null)).toEqual({ confirmationEmail: true, decisionEmail: true });
    expect(mailConfigFlagsFromRow(undefined)).toEqual({ confirmationEmail: true, decisionEmail: true });
  });

  it("preserves stored true and false values", () => {
    expect(mailConfigFlagsFromRow({ confirmationEmail: true, decisionEmail: true })).toEqual({
      confirmationEmail: true,
      decisionEmail: true,
    });
    expect(mailConfigFlagsFromRow({ confirmationEmail: false, decisionEmail: false })).toEqual({
      confirmationEmail: false,
      decisionEmail: false,
    });
    expect(mailConfigFlagsFromRow({ confirmationEmail: false, decisionEmail: true })).toEqual({
      confirmationEmail: false,
      decisionEmail: true,
    });
    expect(mailConfigFlagsFromRow({ confirmationEmail: true, decisionEmail: false })).toEqual({
      confirmationEmail: true,
      decisionEmail: false,
    });
  });
});

describe("mailConfig helpers", () => {
  it("treats an empty table as enabled for both flags", async () => {
    const t = createTest();
    expect(await t.run((ctx) => getMailConfigFlags(ctx))).toEqual({
      confirmationEmail: true,
      decisionEmail: true,
    });
    expect(await t.run((ctx) => isConfirmationEmailEnabled(ctx))).toBe(true);
    expect(await t.run((ctx) => isDecisionEmailEnabled(ctx))).toBe(true);
    expect(await t.query(readMailConfigFlags, {})).toEqual({
      confirmationEmail: true,
      decisionEmail: true,
    });
  });

  it("reads stored flags through helpers and the internal query", async () => {
    const t = createTest();
    await insertMailConfig(t, { confirmationEmail: false, decisionEmail: false });
    expect(await t.run((ctx) => getMailConfigFlags(ctx))).toEqual({
      confirmationEmail: false,
      decisionEmail: false,
    });
    expect(await t.run((ctx) => isConfirmationEmailEnabled(ctx))).toBe(false);
    expect(await t.run((ctx) => isDecisionEmailEnabled(ctx))).toBe(false);
    expect(await t.query(readMailConfigFlags, {})).toEqual({
      confirmationEmail: false,
      decisionEmail: false,
    });
  });

  it("creates a singleton enabled row and leaves an existing row alone", async () => {
    const t = createTest();
    const created = await t.run((ctx) => ensureMailConfig(ctx));
    expect(created).toMatchObject({
      key: "current",
      confirmationEmail: true,
      decisionEmail: true,
    });
    expect(await t.run((ctx) => ctx.db.query("mailConfig").collect())).toHaveLength(1);

    await t.run(async (ctx) => {
      await ctx.db.patch(created._id, { confirmationEmail: false, decisionEmail: false });
    });
    const existing = await t.run((ctx) => ensureMailConfig(ctx));
    expect(existing._id).toBe(created._id);
    expect(existing).toMatchObject({ confirmationEmail: false, decisionEmail: false });
    expect(await t.run((ctx) => ctx.db.query("mailConfig").collect())).toHaveLength(1);
  });
});

describe("mailConfig confirmation flag", () => {
  it("still sends confirmation mail when the table is empty", async () => {
    const t = await submitAsApplicant();
    expect(await t.run((ctx) => ctx.db.query("emailDeliveries").collect())).toEqual([
      expect.objectContaining({ kind: "application_confirmation" }),
    ]);
  });

  it("still sends confirmation mail when confirmationEmail is true on the row", async () => {
    const t = createTest();
    await insertMailConfig(t, { confirmationEmail: true, decisionEmail: false });
    await submitAsApplicant(t);
    expect(await t.run((ctx) => ctx.db.query("emailDeliveries").collect())).toEqual([
      expect.objectContaining({ kind: "application_confirmation" }),
    ]);
  });

  it("submits without sending confirmation mail when confirmationEmail is false", async () => {
    const t = createTest();
    await insertMailConfig(t, { confirmationEmail: false, decisionEmail: true });
    await submitAsApplicant(t);

    expect(await t.run((ctx) => ctx.db.query("applications").first())).toMatchObject({
      formSubmitted: true,
    });
    expect(await t.run((ctx) => ctx.db.query("applicationReviews").first())).toMatchObject({
      status: "under_review",
    });
    expect(await t.run((ctx) => ctx.db.query("applicationSubmissionLogs").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("emailDeliveries").collect())).toEqual([]);
  });

  it("does not send an already-scheduled confirmation after confirmationEmail is turned off", async () => {
    const t = await submitAsApplicant(createTest(), false);
    await insertMailConfig(t, { confirmationEmail: false, decisionEmail: true });
    vi.useFakeTimers();
    try {
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
    expect(await t.run((ctx) => ctx.db.query("applications").first())).toMatchObject({
      formSubmitted: true,
    });
    expect(await t.run((ctx) => ctx.db.query("emailDeliveries").collect())).toEqual([]);
  });
});
