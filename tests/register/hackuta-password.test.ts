import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD_REUSE_MESSAGE } from "../../shared/auth/passwordResetMessages";

// ConvexCredentials only wraps the config for the auth runtime; unwrap it so the
// authorize state machine can be exercised directly.
vi.mock("@convex-dev/auth/providers/ConvexCredentials", () => ({
  ConvexCredentials: (config: unknown) => config,
}));

vi.mock("@convex-dev/auth/server", () => ({
  createAccount: vi.fn(),
  invalidateSessions: vi.fn(),
  modifyAccountCredentials: vi.fn(),
  retrieveAccount: vi.fn(),
  signInViaProvider: vi.fn(),
}));

import {
  createAccount,
  invalidateSessions,
  modifyAccountCredentials,
  retrieveAccount,
  signInViaProvider,
} from "@convex-dev/auth/server";

type Params = Record<string, unknown>;
type HackutaPasswordConfig = Record<string, unknown>;

// Loaded through a runtime path so the web tsconfig (exactOptionalPropertyTypes) does not
// type-check this Convex source; it is compiled under convex/tsconfig.json instead.
const hackutaPasswordModule = "../../convex/lib/hackutaPassword";
const { HackutaPassword } = (await import(/* @vite-ignore */ hackutaPasswordModule)) as {
  HackutaPassword: (config?: HackutaPasswordConfig) => unknown;
};

type AuthorizeResult = { userId: string; sessionId?: string } | null;
type TestProvider = {
  id: string;
  authorize: (params: Params, ctx: unknown) => Promise<AuthorizeResult>;
  crypto: {
    hashSecret: (password: string) => Promise<string>;
    verifySecret: (password: string, hash: string) => Promise<boolean>;
  };
  extraProviders: unknown[];
};

const ctx = { marker: "ctx", runMutation: vi.fn() };
const verify = { id: "email-verification" };
const reset = { id: "password-reset" };

function provider(config: HackutaPasswordConfig = {}) {
  return HackutaPassword(config) as unknown as TestProvider;
}

const account = (overrides: Record<string, unknown> = {}) => ({
  account: { _id: "account1", userId: "user1", emailVerified: "yes", ...overrides },
  user: { _id: "user1" },
});

beforeEach(() => {
  vi.mocked(createAccount).mockReset();
  vi.mocked(invalidateSessions).mockReset();
  vi.mocked(modifyAccountCredentials).mockReset();
  vi.mocked(retrieveAccount).mockReset();
  vi.mocked(signInViaProvider).mockReset();
  ctx.runMutation.mockReset();
});

describe("HackutaPassword provider configuration", () => {
  it("registers the verify and reset providers and allows config overrides", () => {
    const p = provider({ id: "custom", verify: verify as never, reset: reset as never });
    expect(p.extraProviders).toEqual([reset, verify]);
    expect(p.id).toBe("custom");
  });

  it("hashes and verifies secrets with scrypt", async () => {
    const { crypto } = provider();
    const hash = await crypto.hashSecret("Hackuta1");
    expect(hash).not.toContain("Hackuta1");
    await expect(crypto.verifySecret("Hackuta1", hash)).resolves.toBe(true);
    await expect(crypto.verifySecret("Wrong123", hash)).resolves.toBe(false);
  });
});

describe("HackutaPassword password requirements", () => {
  it("applies the default 8 character minimum when no validator is configured", async () => {
    const p = provider();
    await expect(
      p.authorize({ flow: "signUp", email: "a@b.co", password: "short" }, ctx),
    ).rejects.toThrow("Invalid password");
    await expect(
      p.authorize({ flow: "signUp", email: "a@b.co", password: "" }, ctx),
    ).rejects.toThrow("Invalid password");
    expect(createAccount).not.toHaveBeenCalled();
  });

  it("validates the new password (not the old one) during reset verification", async () => {
    const validatePasswordRequirements = vi.fn();
    const p = provider({ validatePasswordRequirements, reset: reset as never });
    const currentHash = await p.crypto.hashSecret("OldPass1");
    vi.mocked(retrieveAccount).mockResolvedValue(account({ secret: currentHash }) as never);
    vi.mocked(signInViaProvider).mockResolvedValue({ userId: "user1", sessionId: "s1" } as never);

    await p.authorize(
      { flow: "reset-verification", email: "a@b.co", code: "123456", newPassword: "NewPass1" },
      ctx,
    );
    expect(validatePasswordRequirements).toHaveBeenCalledWith("NewPass1");
  });

  it("does not validate passwords for sign-in", async () => {
    const validatePasswordRequirements = vi.fn();
    vi.mocked(retrieveAccount).mockResolvedValue(account() as never);
    await provider({ validatePasswordRequirements }).authorize(
      { flow: "signIn", email: "a@b.co", password: "anything" },
      ctx,
    );
    expect(validatePasswordRequirements).not.toHaveBeenCalled();
  });
});

describe("HackutaPassword signUp", () => {
  it("creates an account using the configured profile and returns the user", async () => {
    vi.mocked(createAccount).mockResolvedValue(account() as never);
    const p = provider({ profile: () => ({ email: "norm@b.co" }) });

    await expect(
      p.authorize({ flow: "signUp", email: "Norm@B.co", password: "Hackuta1" }, ctx),
    ).resolves.toEqual({ userId: "user1" });
    expect(createAccount).toHaveBeenCalledWith(ctx, {
      provider: "password",
      account: { id: "norm@b.co", secret: "Hackuta1" },
      profile: { email: "norm@b.co" },
      shouldLinkViaEmail: false,
      shouldLinkViaPhone: false,
    });
  });

  it("starts email verification for unverified new accounts", async () => {
    vi.mocked(createAccount).mockResolvedValue(account({ emailVerified: undefined }) as never);
    vi.mocked(signInViaProvider).mockResolvedValue({ userId: "user1", sessionId: "s1" } as never);
    const params = { flow: "signUp", email: "a@b.co", password: "Hackuta1" };

    await provider({ verify: verify as never }).authorize(params, ctx);
    expect(signInViaProvider).toHaveBeenCalledWith(ctx, verify, { accountId: "account1", params });
    expect(vi.mocked(createAccount).mock.calls[0]?.[1].shouldLinkViaEmail).toBe(true);
  });

  it("skips verification when the account is already verified", async () => {
    vi.mocked(createAccount).mockResolvedValue(account() as never);
    await expect(
      provider({ verify: verify as never }).authorize(
        { flow: "signUp", email: "a@b.co", password: "Hackuta1" },
        ctx,
      ),
    ).resolves.toEqual({ userId: "user1" });
    expect(signInViaProvider).not.toHaveBeenCalled();
  });

  it("rejects a missing password when a custom validator allows it", async () => {
    await expect(
      provider({ validatePasswordRequirements: () => {} }).authorize(
        { flow: "signUp", email: "a@b.co" },
        ctx,
      ),
    ).rejects.toThrow("Missing `password` param for `signUp` flow");
  });
});

describe("HackutaPassword signIn", () => {
  it("returns the user for valid credentials", async () => {
    vi.mocked(retrieveAccount).mockResolvedValue(account() as never);
    await expect(
      provider().authorize({ flow: "signIn", email: "a@b.co", password: "Hackuta1" }, ctx),
    ).resolves.toEqual({ userId: "user1" });
    expect(retrieveAccount).toHaveBeenCalledWith(ctx, {
      provider: "password",
      account: { id: "a@b.co", secret: "Hackuta1" },
    });
  });

  it("rejects unknown accounts or wrong passwords with a generic error", async () => {
    vi.mocked(retrieveAccount).mockResolvedValue(null as never);
    await expect(
      provider().authorize({ flow: "signIn", email: "a@b.co", password: "Wrong123" }, ctx),
    ).rejects.toThrow("Invalid credentials");
  });

  it("requires a password", async () => {
    await expect(provider().authorize({ flow: "signIn", email: "a@b.co" }, ctx)).rejects.toThrow(
      "Missing `password` param for `signIn` flow",
    );
  });

  it("sends unverified users back through email verification", async () => {
    vi.mocked(retrieveAccount).mockResolvedValue(account({ emailVerified: undefined }) as never);
    vi.mocked(signInViaProvider).mockResolvedValue(null as never);
    await expect(
      provider({ verify: verify as never }).authorize(
        { flow: "signIn", email: "a@b.co", password: "Hackuta1" },
        ctx,
      ),
    ).resolves.toBeNull();
    expect(signInViaProvider).toHaveBeenCalledWith(ctx, verify, expect.objectContaining({ accountId: "account1" }));
  });
});

describe("HackutaPassword reset", () => {
  it("sends a reset code for an existing account", async () => {
    vi.mocked(retrieveAccount).mockResolvedValue(account() as never);
    vi.mocked(signInViaProvider).mockResolvedValue(null as never);
    const params = { flow: "reset", email: "a@b.co" };

    await expect(provider({ reset: reset as never }).authorize(params, ctx)).resolves.toBeNull();
    expect(getFunctionName(ctx.runMutation.mock.calls[0]?.[0])).toBe("rateLimits:consumePasswordResetRequest");
    expect(ctx.runMutation.mock.calls[0]?.[1]).toEqual({ email: "a@b.co" });
    expect(ctx.runMutation.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(retrieveAccount).mock.invocationCallOrder[0]!,
    );
    expect(signInViaProvider).toHaveBeenCalledWith(ctx, reset, { accountId: "account1", params });
  });

  it("returns the same result without creating reset state for a missing account", async () => {
    vi.mocked(retrieveAccount).mockRejectedValue(new Error("InvalidAccountId"));

    await expect(
      provider({ reset: reset as never }).authorize({ flow: "reset", email: "a@b.co" }, ctx),
    ).resolves.toBeNull();
    expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), { email: "a@b.co" });
    expect(signInViaProvider).not.toHaveBeenCalled();
  });

  it("does not hide unexpected lookup failures", async () => {
    const error = new Error("Database unavailable");
    vi.mocked(retrieveAccount).mockRejectedValue(error);

    await expect(
      provider({ reset: reset as never }).authorize({ flow: "reset", email: "a@b.co" }, ctx),
    ).rejects.toBe(error);
    expect(signInViaProvider).not.toHaveBeenCalled();
  });

  it("enforces request limits before looking up an account or creating a code", async () => {
    const error = new ConvexError("Please wait before requesting another code.");
    ctx.runMutation.mockRejectedValue(error);

    await expect(
      provider({ reset: reset as never }).authorize({ flow: "reset", email: "a@b.co" }, ctx),
    ).rejects.toBe(error);
    expect(retrieveAccount).not.toHaveBeenCalled();
    expect(signInViaProvider).not.toHaveBeenCalled();
  });

  it("uses the normalized profile email for limits, lookup, and delivery", async () => {
    vi.mocked(retrieveAccount).mockResolvedValue(account() as never);
    const params = { flow: "reset", email: " A@B.CO " };

    await provider({ reset: reset as never, profile: () => ({ email: "a@b.co" }) })
      .authorize(params, ctx);

    expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), { email: "a@b.co" });
    expect(retrieveAccount).toHaveBeenCalledWith(ctx, {
      provider: "password", account: { id: "a@b.co" },
    });
    expect(signInViaProvider).toHaveBeenCalledWith(ctx, reset, {
      accountId: "account1", params: { flow: "reset", email: "a@b.co" },
    });
  });

  it.each(["reset", "reset-verification"])("fails closed when reset is disabled (%s)", async (flow) => {
    await expect(
      provider().authorize({ flow, email: "a@b.co", newPassword: "NewPass12" }, ctx),
    ).rejects.toThrow("Password reset is not enabled for password");
  });
});

describe("HackutaPassword reset-verification", () => {
  const params = { flow: "reset-verification", email: "a@b.co", code: "123456", newPassword: "NewPass1" };
  const currentHash = () => provider().crypto.hashSecret("OldPass1");

  it.each([undefined, null, "", "12345", "abcdef", 123456])(
    "rejects missing or malformed code %j without requesting another email",
    async (code) => {
      await expect(provider({ reset: reset as never }).authorize({ ...params, code }, ctx))
        .rejects.toThrow("Invalid code");
      expect(retrieveAccount).not.toHaveBeenCalled();
      expect(signInViaProvider).not.toHaveBeenCalled();
    },
  );

  it("updates credentials and revokes every other session on success", async () => {
    vi.mocked(retrieveAccount).mockResolvedValue(
      account({ secret: await currentHash() }) as never, // reuse check: new password does not match
    );
    vi.mocked(signInViaProvider).mockResolvedValue({ userId: "user1", sessionId: "s1" } as never);

    await expect(provider({ reset: reset as never }).authorize(params, ctx)).resolves.toEqual({
      userId: "user1",
      sessionId: "s1",
    });
    expect(retrieveAccount).toHaveBeenCalledTimes(1);
    expect(retrieveAccount).toHaveBeenCalledWith(ctx, {
      provider: "password",
      account: { id: "a@b.co" },
    });
    expect(modifyAccountCredentials).toHaveBeenCalledWith(ctx, {
      provider: "password",
      account: { id: "a@b.co", secret: "NewPass1" },
    });
    expect(invalidateSessions).toHaveBeenCalledWith(ctx, { userId: "user1", except: ["s1"] });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("refuses a reused password only after validating the reset code", async () => {
    vi.mocked(retrieveAccount).mockResolvedValue(
      account({ secret: await provider().crypto.hashSecret("NewPass1") }) as never,
    );
    vi.mocked(signInViaProvider).mockResolvedValue({ userId: "user1", sessionId: "s1" } as never);

    await expect(provider({ reset: reset as never }).authorize(params, ctx)).rejects.toThrow(
      new ConvexError(PASSWORD_REUSE_MESSAGE),
    );
    expect(signInViaProvider).toHaveBeenCalledWith(ctx, reset, { params });
    expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
      userId: "user1", sessionId: "s1",
    });
    expect(modifyAccountCredentials).not.toHaveBeenCalled();
    expect(invalidateSessions).not.toHaveBeenCalled();
  });

  it("does not reveal password reuse when the code is invalid or expired", async () => {
    vi.mocked(retrieveAccount).mockResolvedValue(
      account({ secret: await provider().crypto.hashSecret("NewPass1") }) as never,
    );
    vi.mocked(signInViaProvider).mockResolvedValue(null as never);

    await expect(provider({ reset: reset as never }).authorize(params, ctx)).rejects.toThrow("Invalid code");
    expect(modifyAccountCredentials).not.toHaveBeenCalled();
    expect(invalidateSessions).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("rejects a code belonging to a different user and removes its new session", async () => {
    vi.mocked(retrieveAccount).mockResolvedValue(account({ secret: await currentHash() }) as never);
    vi.mocked(signInViaProvider).mockResolvedValue({ userId: "attacker", sessionId: "s2" } as never);

    await expect(provider({ reset: reset as never }).authorize(params, ctx)).rejects.toThrow("Invalid code");
    expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
      userId: "attacker", sessionId: "s2",
    });
    expect(modifyAccountCredentials).not.toHaveBeenCalled();
  });

  it("does not use the password login path even if sign-ins have been rate-limited", async () => {
    vi.mocked(retrieveAccount).mockImplementation(async (_ctx, args) => {
      if (args.account.secret !== undefined) throw new Error("TooManyFailedAttempts");
      return account({ secret: await currentHash() }) as never;
    });
    vi.mocked(signInViaProvider).mockResolvedValue({ userId: "user1", sessionId: "s1" } as never);

    await expect(provider({ reset: reset as never }).authorize(params, ctx)).resolves.toMatchObject({
      userId: "user1", sessionId: "s1",
    });
    expect(modifyAccountCredentials).toHaveBeenCalledOnce();
  });

  it("removes the newly created session when credential modification fails", async () => {
    vi.mocked(retrieveAccount).mockResolvedValue(account({ secret: await currentHash() }) as never);
    vi.mocked(signInViaProvider).mockResolvedValue({ userId: "user1", sessionId: "s1" } as never);
    vi.mocked(modifyAccountCredentials).mockRejectedValue(new Error("Update failed"));

    await expect(provider({ reset: reset as never }).authorize(params, ctx)).rejects.toThrow("Update failed");
    expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
      userId: "user1", sessionId: "s1",
    });
  });

  it("fails closed and removes the new session if the stored hash is missing", async () => {
    vi.mocked(retrieveAccount).mockResolvedValue(account() as never);
    vi.mocked(signInViaProvider).mockResolvedValue({ userId: "user1", sessionId: "s1" } as never);

    await expect(provider({ reset: reset as never }).authorize(params, ctx)).rejects.toThrow();
    expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
      userId: "user1", sessionId: "s1",
    });
    expect(modifyAccountCredentials).not.toHaveBeenCalled();
  });

  it("requires newPassword", async () => {
    await expect(
      provider({ reset: reset as never, validatePasswordRequirements: () => {} }).authorize(
        { flow: "reset-verification", email: "a@b.co" },
        ctx,
      ),
    ).rejects.toThrow("Missing `newPassword` param");
  });
});

describe("HackutaPassword email-verification and unknown flows", () => {
  it("completes email verification through the verify provider", async () => {
    vi.mocked(retrieveAccount).mockResolvedValue(account() as never);
    vi.mocked(signInViaProvider).mockResolvedValue({ userId: "user1", sessionId: "s1" } as never);
    const params = { flow: "email-verification", email: "a@b.co", code: "123456" };

    await expect(provider({ verify: verify as never }).authorize(params, ctx)).resolves.toEqual({
      userId: "user1",
      sessionId: "s1",
    });
    expect(signInViaProvider).toHaveBeenCalledWith(ctx, verify, { accountId: "account1", params });
  });

  it("fails closed when verification is disabled", async () => {
    await expect(
      provider().authorize({ flow: "email-verification", email: "a@b.co" }, ctx),
    ).rejects.toThrow("Email verification is not enabled for password");
  });

  it.each([undefined, "delete-account"])("rejects unknown flow %j", async (flow) => {
    await expect(provider().authorize({ flow, email: "a@b.co" }, ctx)).rejects.toThrow(
      "Missing `flow` param",
    );
  });
});
