import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../convex/schema";

const EMAIL_SERVICE_ENV_KEYS = ["EMAIL_SERVICE_URL", "EMAIL_SERVICE_API_KEY"] as const;
const SERVICE_URL = "https://emailservice.example.test";

const modules = import.meta.glob("../../convex/**/*.ts", { eager: false });

const sendOtpEmail = makeFunctionReference<"action">("email/sendOtpEmail:sendOtpEmail");
const sendPasswordResetEmail = makeFunctionReference<"action">(
  "email/sendPasswordResetEmail:sendPasswordResetEmail",
);
const sendApplicationConfirmationEmail = makeFunctionReference<"action">(
  "email/sendApplicationConfirmationEmail:sendApplicationConfirmationEmail",
);
const checkEmailStatus = makeFunctionReference<"action">("email/checkEmailStatus:checkEmailStatus");
const listEmailDeliveriesForRecipient = makeFunctionReference<"query">(
  "emailDeliveries:listEmailDeliveriesForRecipient",
);

const createTest = () => convexTest(schema, modules);
type TestInstance = ReturnType<typeof createTest>;

const expiresAt = () => Date.now() + 10 * 60 * 1000;
const listDeliveries = (t: TestInstance) =>
  t.run((ctx) => ctx.db.query("emailDeliveries").collect());

describe("email actions without configuration", () => {
  beforeEach(() => {
    for (const key of EMAIL_SERVICE_ENV_KEYS) {
      vi.stubEnv(key, "");
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires email service configuration for OTP email delivery", async () => {
    const test = createTest();
    await expect(
      test.action(sendOtpEmail, {
        email: "test@example.com",
        code: "123456",
        expiresAt: expiresAt(),
      }),
    ).rejects.toThrow("Email is not configured.");
  });

  it("requires email service configuration for password reset email delivery", async () => {
    const test = createTest();
    await expect(
      test.action(sendPasswordResetEmail, {
        email: "reset@example.com",
        code: "654321",
        expiresAt: expiresAt(),
      }),
    ).rejects.toThrow("Email is not configured.");
  });
});

describe("tracked email actions", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const sentBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call]![1].body);

  beforeEach(() => {
    vi.stubEnv("EMAIL_SERVICE_URL", SERVICE_URL);
    vi.stubEnv("EMAIL_SERVICE_API_KEY", "test-api-key");
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "queued-123" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the verification code as plain text and records only tracking data", async () => {
    const t = createTest();
    await t.action(sendOtpEmail, {
      email: "Applicant@Example.com",
      code: "123456",
      expiresAt: expiresAt(),
    });

    expect(fetchMock.mock.calls[0]![0]).toBe(`${SERVICE_URL}/send-email`);
    expect(sentBody()).toMatchObject({
      email: "Applicant@Example.com",
      subject: "Your HackUTA verification code",
      note: "otp",
    });
    expect(sentBody().body).toContain("123456");
    expect(sentBody().body).not.toContain("<");

    const rows = await listDeliveries(t);
    expect(rows).toEqual([
      expect.objectContaining({
        serviceId: "queued-123",
        kind: "otp",
        recipient: "applicant@example.com",
        createdAt: expect.any(Number),
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain("123456");
  });

  it("tags password reset emails with their own kind", async () => {
    const t = createTest();
    await t.action(sendPasswordResetEmail, {
      email: "reset@example.com",
      code: "654321",
      expiresAt: expiresAt(),
    });

    expect(sentBody()).toMatchObject({
      subject: "Your HackUTA password reset code",
      note: "password_reset",
    });
    expect(await listDeliveries(t)).toEqual([
      expect.objectContaining({ kind: "password_reset", recipient: "reset@example.com" }),
    ]);
  });

  it("sends and records application confirmations", async () => {
    const t = createTest();
    await t.action(sendApplicationConfirmationEmail, {
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      submittedAt: Date.parse("2026-09-21T22:06:00.000Z"),
      hackathonName: "HackUTA 2026",
    });

    expect(sentBody()).toMatchObject({
      subject: "HackUTA 2026 application received",
      note: "application_confirmation",
    });
    expect(sentBody().body).toContain("Hi Ada Lovelace,");
    expect(await listDeliveries(t)).toEqual([
      expect.objectContaining({ kind: "application_confirmation", recipient: "ada@example.com" }),
    ]);
  });

  it("records nothing when the service rejects the email", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );
    const t = createTest();

    await expect(
      t.action(sendOtpEmail, {
        email: "applicant@example.com",
        code: "123456",
        expiresAt: expiresAt(),
      }),
    ).rejects.toThrow("Email service rejected the API key.");
    expect(await listDeliveries(t)).toEqual([]);
  });

  it("looks up an address's deliveries newest first, case-insensitively", async () => {
    const t = createTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("emailDeliveries", {
        serviceId: "older",
        kind: "otp",
        recipient: "applicant@example.com",
        createdAt: 1,
      });
      await ctx.db.insert("emailDeliveries", {
        serviceId: "someone-else",
        kind: "otp",
        recipient: "other@example.com",
        createdAt: 2,
      });
      await ctx.db.insert("emailDeliveries", {
        serviceId: "newer",
        kind: "application_confirmation",
        recipient: "applicant@example.com",
        createdAt: 3,
      });
    });

    const rows = await t.query(listEmailDeliveriesForRecipient, {
      recipient: "  Applicant@Example.COM ",
    });
    expect(rows.map((row: { serviceId: string }) => row.serviceId)).toEqual(["newer", "older"]);
    expect(await t.query(listEmailDeliveriesForRecipient, { recipient: "   " })).toEqual([]);
  });

  it("checks a tracked email's status with the service", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "queued-123", status: "success" }), { status: 200 }),
    );
    const t = createTest();

    await expect(t.action(checkEmailStatus, { serviceId: "queued-123" })).resolves.toEqual({
      id: "queued-123",
      status: "success",
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${SERVICE_URL}/email-status?id=queued-123`);
  });
});
