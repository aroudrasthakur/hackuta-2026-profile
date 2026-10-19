import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { exportPKCS8, generateKeyPair } from "jose";
import { Scrypt } from "lucia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PASSWORD_REUSE_MESSAGE } from "../../shared/auth/passwordResetMessages";
import { OTP_RESEND_COOLDOWN_SECONDS, OTP_SEND_MAX_PER_HOUR } from "../../shared/auth/otpRateLimit";
import { invalidateAllSessionsForUser } from "../../convex/lib/invalidateAuthSessions";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.ts", { eager: false });

const signIn = makeFunctionReference<"action">("auth:signIn");
const getPasswordResetSendCooldown = makeFunctionReference<"mutation">(
  "rateLimits:getPasswordResetSendCooldown",
);
const invalidateSessionsAfterPasswordReset = makeFunctionReference<"mutation">(
  "passwordReset:invalidateSessionsAfterPasswordReset",
);
const invalidateResetSession = makeFunctionReference<"mutation">(
  "passwordReset:invalidateResetSession",
);
const assertResetCodeAvailable = makeFunctionReference<"mutation">(
  "passwordReset:assertResetCodeAvailable",
);

describe("password reset backend", () => {
  it("removes every session and refresh token for the target user", async () => {
    const test = convexTest(schema, modules);

    let userId: GenericId<"users">;
    let otherUserId: GenericId<"users">;

    await test.run(async (ctx) => {
      userId = await ctx.db.insert("users", {
        email: "reset-sessions@example.com",
        emailVerificationTime: Date.now(),
      });
      otherUserId = await ctx.db.insert("users", {
        email: "other-sessions@example.com",
        emailVerificationTime: Date.now(),
      });

      const sessionId = await ctx.db.insert("authSessions", {
        userId,
        expirationTime: Date.now() + 3_600_000,
      });
      await ctx.db.insert("authRefreshTokens", {
        sessionId,
        expirationTime: Date.now() + 3_600_000,
      });
      await ctx.db.insert("authSessions", {
        userId: otherUserId,
        expirationTime: Date.now() + 3_600_000,
      });

      await invalidateAllSessionsForUser(ctx, userId);

      const sessions = await ctx.db.query("authSessions").collect();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.userId).toBe(otherUserId);
      expect(await ctx.db.query("authRefreshTokens").collect()).toHaveLength(0);
    });
  });

  it("invalidates sessions through the password reset mutation", async () => {
    const test = convexTest(schema, modules);
    const email = "reset-mutation@example.com";

    let userId: GenericId<"users">;

    await test.run(async (ctx) => {
      userId = await ctx.db.insert("users", {
        email,
        emailVerificationTime: Date.now(),
      });
      const sessionId = await ctx.db.insert("authSessions", {
        userId,
        expirationTime: Date.now() + 3_600_000,
      });
      await ctx.db.insert("authRefreshTokens", {
        sessionId,
        expirationTime: Date.now() + 3_600_000,
      });
    });

    const authed = test.withIdentity({
      subject: userId!,
      email,
      tokenIdentifier: `email|${email}`,
    });

    await authed.mutation(invalidateSessionsAfterPasswordReset, {});

    await test.run(async (ctx) => {
      expect(await ctx.db.query("authSessions").collect()).toHaveLength(0);
      expect(await ctx.db.query("authRefreshTokens").collect()).toHaveLength(0);
    });
  });

  it("removes only the failed reset session and its refresh token", async () => {
    const test = convexTest(schema, modules);
    const { userId, resetSessionId, otherSessionId, otherUserId, otherUserSessionId } =
      await test.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { email: "reset@example.com" });
        const otherUserId = await ctx.db.insert("users", { email: "other@example.com" });
        const expirationTime = Date.now() + 3_600_000;
        const resetSessionId = await ctx.db.insert("authSessions", { userId, expirationTime });
        const otherSessionId = await ctx.db.insert("authSessions", { userId, expirationTime });
        const otherUserSessionId = await ctx.db.insert("authSessions", {
          userId: otherUserId, expirationTime,
        });
        for (const sessionId of [resetSessionId, otherSessionId, otherUserSessionId]) {
          await ctx.db.insert("authRefreshTokens", { sessionId, expirationTime });
        }
        return { userId, resetSessionId, otherSessionId, otherUserId, otherUserSessionId };
      });

    await test.mutation(invalidateResetSession, { userId, sessionId: otherUserSessionId });
    await test.run(async (ctx) => {
      expect(await ctx.db.get(otherUserSessionId)).not.toBeNull();
      expect(await ctx.db.get(resetSessionId)).not.toBeNull();
    });

    await test.mutation(invalidateResetSession, { userId, sessionId: resetSessionId });
    await test.mutation(invalidateResetSession, { userId, sessionId: resetSessionId });
    await test.run(async (ctx) => {
      expect(await ctx.db.get(resetSessionId)).toBeNull();
      expect(await ctx.db.get(otherSessionId)).not.toBeNull();
      expect(await ctx.db.get(otherUserSessionId)).not.toBeNull();
      expect((await ctx.db.query("authRefreshTokens").collect()).map((token) => token.sessionId))
        .toEqual(expect.arrayContaining([otherSessionId, otherUserSessionId]));
      expect(await ctx.db.query("authRefreshTokens").collect()).toHaveLength(2);
      expect(await ctx.db.get(otherUserId)).not.toBeNull();
    });
  });
});

describe("password reset with the real auth provider", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function setupReset({ requestReset = true } = {}) {
    vi.stubEnv("SITE_URL", "http://127.0.0.1:5273");
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
    const keys = await generateKeyPair("RS256", { extractable: true });
    vi.stubEnv("JWT_PRIVATE_KEY", (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, " "));
    let deliveredCode = "";
    let signupCode = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url) !== `${process.env.EMAIL_SERVICE_URL}/send-email`) {
        throw new Error("Unexpected network request");
      }
      const { body } = JSON.parse(String(init?.body)) as { body: string };
      const nextCode = body.split("\n").find((line) => /^\d{6}$/.test(line)) ?? "";
      if (!signupCode) signupCode = nextCode;
      deliveredCode = nextCode;
      return new Response(JSON.stringify({ id: "test-email-id" }), { status: 201 });
    });

    const test = convexTest(schema, modules);
    const email = "real-reset@example.com";
    await test.action(signIn, {
      provider: "password", params: { flow: "signUp", email, password: "OldPass1" },
    });
    if (!requestReset) {
      expect(signupCode).toMatch(/^\d{6}$/);
      return { test, email, code: deliveredCode, signupCode, resetResult: undefined };
    }
    const resetResult = await test.action(signIn, {
      provider: "password", params: { flow: "reset", email: " Real-Reset@EXAMPLE.COM " },
    });
    expect(deliveredCode).toMatch(/^\d{6}$/);
    return { test, email, code: deliveredCode, signupCode, resetResult };
  }

  it("returns the same response without creating auth state or sending email for an unregistered address", async () => {
    const { test, resetResult } = await setupReset();
    const authState = () => test.run(async (ctx) => ({
      users: await ctx.db.query("users").collect(),
      accounts: await ctx.db.query("authAccounts").collect(),
      codes: await ctx.db.query("authVerificationCodes").collect(),
      sessions: await ctx.db.query("authSessions").collect(),
      refreshTokens: await ctx.db.query("authRefreshTokens").collect(),
      verifiers: await ctx.db.query("authVerifiers").collect(),
    }));
    const stateBefore = await authState();
    const emailCallsBefore = vi.mocked(globalThis.fetch).mock.calls.length;

    expect(resetResult).toEqual({ tokens: null });
    await expect(test.action(signIn, {
      provider: "password",
      params: { flow: "reset", email: " Missing-Reset@EXAMPLE.COM " },
    })).resolves.toEqual(resetResult);

    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(emailCallsBefore);
    expect(await authState()).toEqual(stateBefore);
  });

  it("applies the same cooldown and hourly cap regardless of account existence", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const { test, email, resetResult } = await setupReset();
    const missingEmail = "missing-reset@example.com";
    const request = (address: string) => test.action(signIn, {
      provider: "password", params: { flow: "reset", email: address },
    });
    const status = (address: string) => test.mutation(getPasswordResetSendCooldown, { email: address });

    await expect(request(missingEmail)).resolves.toEqual(resetResult);
    for (const address of [email, missingEmail]) {
      await expect(status(address)).resolves.toEqual({
        waitSeconds: OTP_RESEND_COOLDOWN_SECONDS, hourlyLimitReached: false,
      });
      await expect(request(address)).rejects.toThrow("Please wait before requesting another code.");
    }

    for (let i = 1; i < OTP_SEND_MAX_PER_HOUR; i += 1) {
      clock.mockReturnValue(now + i * (OTP_RESEND_COOLDOWN_SECONDS + 1) * 1000);
      await expect(request(email)).resolves.toEqual(resetResult);
      await expect(request(missingEmail)).resolves.toEqual(resetResult);
    }
    for (const address of [email, missingEmail]) {
      await expect(status(address)).resolves.toEqual({ waitSeconds: 0, hourlyLimitReached: true });
      await expect(request(address)).rejects.toThrow("Too many reset requests. Please try again later.");
    }

    clock.mockReturnValue(now + 2 * 60 * 60 * 1000);
    await expect(request(email)).resolves.toEqual(resetResult);
    await expect(request(missingEmail)).resolves.toEqual(resetResult);
  });

  it("cannot bypass the request cooldown by omitting the verification code", async () => {
    const { test, email } = await setupReset();
    const codesBefore = await test.run((ctx) => ctx.db.query("authVerificationCodes").collect());
    const emailCallsBefore = vi.mocked(globalThis.fetch).mock.calls.length;

    await expect(test.action(signIn, {
      provider: "password",
      params: { flow: "reset-verification", email, newPassword: "NewPass1" },
    })).rejects.toThrow("Invalid code");

    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(emailCallsBefore);
    expect(await test.run((ctx) => ctx.db.query("authVerificationCodes").collect())).toEqual(codesBefore);
  });

  it("changes a different password without counting a failed sign-in", async () => {
    const { test, email, code } = await setupReset();
    await test.action(signIn, {
      provider: "password",
      params: { flow: "reset-verification", email, code, newPassword: "NewPass1" },
    });
    await test.run(async (ctx) => {
      const account = await ctx.db.query("authAccounts")
        .withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", email))
        .unique();
      if (typeof account?.secret !== "string") throw new Error("Missing password hash");
      expect(await new Scrypt().verify(account.secret, "NewPass1")).toBe(true);
      expect(await new Scrypt().verify(account.secret, "OldPass1")).toBe(false);
      expect(await ctx.db.query("authRateLimits").collect()).toHaveLength(0);
    });
    await expect(test.action(signIn, {
      provider: "password", params: { flow: "signIn", email, password: "OldPass1" },
    })).rejects.toThrow("InvalidSecret");
    await expect(test.action(signIn, {
      provider: "password", params: { flow: "signIn", email, password: "NewPass1" },
    })).resolves.toMatchObject({ tokens: expect.anything() });
  });

  it("does not reveal reuse without a valid code and removes the consumed-code session", async () => {
    const { test, email, code } = await setupReset();
    const wrongCode = code === "000000" ? "999999" : "000000";
    await expect(test.action(signIn, {
      provider: "password",
      params: { flow: "reset-verification", email, code: wrongCode, newPassword: "OldPass1" },
    })).rejects.toThrow("Could not verify code");
    await expect(test.action(signIn, {
      provider: "password",
      params: { flow: "reset-verification", email, code, newPassword: "OldPass1" },
    })).rejects.toThrow(PASSWORD_REUSE_MESSAGE);
    await test.run(async (ctx) => {
      expect(await ctx.db.query("authSessions").collect()).toHaveLength(0);
      expect(await ctx.db.query("authRefreshTokens").collect()).toHaveLength(0);
      expect((await ctx.db.query("authVerificationCodes").collect())
        .some((entry) => entry.provider === "password-reset")).toBe(false);
    });
  });

  it("resets when password sign-in attempts are exhausted", async () => {
    const { test, email, code } = await setupReset();
    const accountId = await test.run(async (ctx) => {
      const account = await ctx.db.query("authAccounts")
        .withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", email))
        .unique();
      if (!account) throw new Error("Missing password account");
      await ctx.db.insert("authRateLimits", {
        identifier: account._id, attemptsLeft: 0, lastAttemptTime: Date.now(),
      });
      return account._id;
    });
    await expect(test.action(signIn, {
      provider: "password",
      params: { flow: "reset-verification", email, code, newPassword: "NewPass1" },
    })).resolves.toMatchObject({ tokens: expect.anything() });
    await test.run(async (ctx) => {
      const limit = await ctx.db.query("authRateLimits")
        .withIndex("identifier", (q) => q.eq("identifier", accountId)).unique();
      expect(limit?.attemptsLeft).toBe(0);
    });
  });

  it("accepts an unused reset code without consuming it", async () => {
    const { test, email, code } = await setupReset();
    await expect(test.mutation(assertResetCodeAvailable, { email, code })).resolves.toEqual({
      ok: true,
    });
    await test.run(async (ctx) => {
      expect(await ctx.db.query("authVerificationCodes").collect()).toHaveLength(1);
    });
    await expect(test.action(signIn, {
      provider: "password",
      params: { flow: "reset-verification", email, code, newPassword: "NewPass1" },
    })).resolves.toMatchObject({ tokens: expect.anything() });
  });

  it("rejects a consumed reset code after a successful reset", async () => {
    const { test, email, code } = await setupReset();
    await test.action(signIn, {
      provider: "password",
      params: { flow: "reset-verification", email, code, newPassword: "NewPass1" },
    });
    await expect(test.mutation(assertResetCodeAvailable, { email, code })).resolves.toEqual({
      ok: false,
    });
  });

  it("rejects a consumed reset code after password reuse", async () => {
    const { test, email, code } = await setupReset();
    await expect(test.action(signIn, {
      provider: "password",
      params: { flow: "reset-verification", email, code, newPassword: "OldPass1" },
    })).rejects.toThrow(PASSWORD_REUSE_MESSAGE);
    await expect(test.mutation(assertResetCodeAvailable, { email, code })).resolves.toEqual({
      ok: false,
    });
  });

  it("rejects a wrong code and a sign-up OTP", async () => {
    const { test, email, signupCode } = await setupReset({ requestReset: false });
    await expect(test.mutation(assertResetCodeAvailable, { email, code: signupCode }))
      .resolves.toEqual({ ok: false });
    await test.run(async (ctx) => {
      expect((await ctx.db.query("authVerificationCodes").collect()).map((entry) => entry.provider))
        .toEqual(["email-verification"]);
    });

    const { test: resetTest, email: resetEmail, code } = await setupReset();
    const wrongCode = code === "000000" ? "999999" : "000000";
    await expect(resetTest.mutation(assertResetCodeAvailable, { email: resetEmail, code: wrongCode }))
      .resolves.toEqual({ ok: false });
  });

  it("counts failed peeks against Convex Auth's email rate limit", async () => {
    const { test, email, code } = await setupReset();
    const wrongCode = code === "000000" ? "999999" : "000000";
    await expect(test.mutation(assertResetCodeAvailable, { email, code: wrongCode }))
      .resolves.toEqual({ ok: false });
    const limitsAfterMiss = await test.run(async (ctx) => ctx.db.query("authRateLimits").collect());
    expect(limitsAfterMiss).toEqual([
      expect.objectContaining({ identifier: email, attemptsLeft: 4 }),
    ]);
    await expect(test.mutation(assertResetCodeAvailable, { email, code })).resolves.toEqual({
      ok: true,
    });

    for (let i = 0; i < 4; i += 1) {
      await expect(test.mutation(assertResetCodeAvailable, { email, code: wrongCode }))
        .resolves.toEqual({ ok: false });
    }
    await expect(test.mutation(assertResetCodeAvailable, { email, code })).resolves.toEqual({
      ok: false,
    });
    await test.run(async (ctx) => {
      expect(await ctx.db.query("authVerificationCodes").collect()).toHaveLength(1);
    });
  });
});
