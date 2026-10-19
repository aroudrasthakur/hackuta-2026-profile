import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { PASSWORD_REQUIREMENTS_MESSAGE } from "../../shared/auth/password";

type EmailProvider = {
  id: string;
  maxAge: number;
  generateVerificationToken: () => Promise<string>;
  sendVerificationRequest: (
    params: { identifier: string; token: string; expires: Date },
    ctx: { runMutation: ReturnType<typeof vi.fn>; runAction: ReturnType<typeof vi.fn> },
  ) => Promise<void>;
};

type PasswordProvider = {
  profile: (params: Record<string, unknown>) => { email: string };
  validatePasswordRequirements: (password: string) => void;
  verify: EmailProvider;
  reset: EmailProvider;
};

const captured = vi.hoisted(() => ({ config: undefined as unknown }));

// Capture the provider wiring instead of booting the real auth runtime.
vi.mock("@convex-dev/auth/server", () => ({
  convexAuth: (config: unknown) => {
    captured.config = config;
    return { auth: {}, signIn: {}, signOut: {}, store: {}, isAuthenticated: {} };
  },
}));
vi.mock("@convex-dev/auth/providers/Email", () => ({ Email: (config: unknown) => config }));
vi.mock("../../convex/lib/hackutaPassword", () => ({
  HackutaPassword: (config: unknown) => config,
}));

// Loaded through a runtime path so the web tsconfig does not type-check Convex sources,
// which are compiled under convex/tsconfig.json.
const convexAuthModule = "../../convex/auth";
await import(/* @vite-ignore */ convexAuthModule);

const config = captured.config as {
  providers: PasswordProvider[];
  signIn: { maxFailedAttempsPerHour: number };
};
const password = config.providers[0]!;

function fakeActionCtx() {
  const calls: string[] = [];
  return {
    calls,
    runMutation: vi.fn(async (ref: unknown) => {
      calls.push(getFunctionName(ref as never));
    }),
    runAction: vi.fn(async (ref: unknown) => {
      calls.push(getFunctionName(ref as never));
    }),
  };
}

describe("convex auth configuration", () => {
  it("throttles failed sign-in attempts", () => {
    expect(config.signIn.maxFailedAttempsPerHour).toBe(5);
  });

  it("normalises emails in the password profile", () => {
    expect(password.profile({ email: "  Applicant@Example.COM " })).toEqual({
      email: "applicant@example.com",
    });
  });

  it.each([undefined, "", "   ", "not-an-email", "a@b"])(
    "rejects invalid email %j with a user-facing ConvexError",
    (email) => {
      expect(() => password.profile({ email })).toThrow(ConvexError);
      expect(() => password.profile({ email })).toThrow("Enter a valid email address.");
    },
  );

  it("enforces the shared password strength rules", () => {
    expect(() => password.validatePasswordRequirements("weakpass")).toThrow(
      PASSWORD_REQUIREMENTS_MESSAGE,
    );
    expect(() => password.validatePasswordRequirements("Hackuta1")).not.toThrow();
  });

  it("uses 10 minute OTP lifetimes for verification and reset codes", () => {
    expect(password.verify.id).toBe("email-verification");
    expect(password.reset.id).toBe("password-reset");
    expect(password.verify.maxAge).toBe(600);
    expect(password.reset.maxAge).toBe(600);
  });

  it.each(["verify", "reset"] as const)("generates zero-padded six digit %s codes", async (key) => {
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array)[0] = 1_000_042;
      return array;
    });
    await expect(password[key].generateVerificationToken()).resolves.toBe("000042");
    spy.mockRestore();

    for (let i = 0; i < 20; i += 1) {
      expect(await password[key].generateVerificationToken()).toMatch(/^\d{6}$/);
    }
  });
});

describe("OTP email delivery", () => {
  const expires = new Date(1_700_000_000_000);

  it("checks the rate limit, sends the code, then records the send", async () => {
    const ctx = fakeActionCtx();
    await password.verify.sendVerificationRequest(
      { identifier: "a@b.co", token: "123456", expires },
      ctx,
    );
    expect(ctx.calls).toEqual([
      "rateLimits:assertOtpSendAllowed",
      "email/sendOtpEmail:sendOtpEmail",
      "rateLimits:recordOtpSend",
    ]);
    expect(ctx.runAction.mock.calls[0]?.[1]).toEqual({
      email: "a@b.co",
      code: "123456",
      expiresAt: expires.getTime(),
    });
  });

  it("does not send or record when the rate limit rejects", async () => {
    const ctx = fakeActionCtx();
    ctx.runMutation.mockRejectedValueOnce(new Error("Too many verification requests."));
    await expect(
      password.verify.sendVerificationRequest({ identifier: "a@b.co", token: "1", expires }, ctx),
    ).rejects.toThrow("Too many verification requests.");
    expect(ctx.runAction).not.toHaveBeenCalled();
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
  });

  it("does not record a send when email delivery fails", async () => {
    const ctx = fakeActionCtx();
    ctx.runAction.mockRejectedValueOnce(new Error("Email service down"));
    await expect(
      password.verify.sendVerificationRequest({ identifier: "a@b.co", token: "1", expires }, ctx),
    ).rejects.toThrow("Email service down");
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
  });

  it("delivers reset codes without consuming a second request allowance", async () => {
    const ctx = fakeActionCtx();
    await password.reset.sendVerificationRequest(
      { identifier: "a@b.co", token: "654321", expires },
      ctx,
    );
    expect(ctx.calls).toEqual([
      "email/sendPasswordResetEmail:sendPasswordResetEmail",
    ]);
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
});
