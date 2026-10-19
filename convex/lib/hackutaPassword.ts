/**
 * Password provider based on @convex-dev/auth Password with a reuse check on reset.
 */
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import type { PasswordConfig } from "@convex-dev/auth/providers/Password";
import {
  createAccount,
  invalidateSessions,
  modifyAccountCredentials,
  retrieveAccount,
  signInViaProvider,
} from "@convex-dev/auth/server";
import { makeFunctionReference, type GenericDataModel } from "convex/server";
import { Scrypt } from "lucia";
import { assertPasswordNotReused } from "./assertPasswordNotReused";

const invalidateResetSessionRef = makeFunctionReference<"mutation">(
  "passwordReset:invalidateResetSession",
);
const consumePasswordResetRequestRef = makeFunctionReference<"mutation">(
  "rateLimits:consumePasswordResetRequest",
);

function validateDefaultPasswordRequirements(password: string) {
  if (!password || password.length < 8) {
    throw new Error("Invalid password");
  }
}

function defaultProfile(params: Record<string, unknown>) {
  return {
    email: params.email as string,
  };
}

export function HackutaPassword<DataModel extends GenericDataModel>(
  config: PasswordConfig<DataModel> = {},
) {
  const provider = config.id ?? "password";
  return ConvexCredentials<DataModel>({
    id: "password",
    authorize: async (params, ctx) => {
      const flow = params.flow as string;
      const passwordToValidate =
        flow === "signUp"
          ? (params.password as string)
          : flow === "reset-verification"
            ? (params.newPassword as string)
            : null;
      if (passwordToValidate !== null) {
        if (config.validatePasswordRequirements !== undefined) {
          config.validatePasswordRequirements(passwordToValidate);
        } else {
          validateDefaultPasswordRequirements(passwordToValidate);
        }
      }
      const profile = config.profile?.(params, ctx) ?? defaultProfile(params);
      const { email } = profile;
      const secret = params.password as string;

      if (flow === "signUp") {
        if (secret === undefined) {
          throw new Error("Missing `password` param for `signUp` flow");
        }
        const created = await createAccount(ctx, {
          provider,
          account: { id: email, secret },
          profile: profile as never,
          shouldLinkViaEmail: config.verify !== undefined,
          shouldLinkViaPhone: false,
        });
        const { account, user } = created;
        if (config.verify && !account.emailVerified) {
          return await signInViaProvider(ctx, config.verify, {
            accountId: account._id,
            params,
          });
        }
        return { userId: user._id };
      }

      if (flow === "signIn") {
        if (secret === undefined) {
          throw new Error("Missing `password` param for `signIn` flow");
        }
        const retrieved = await retrieveAccount(ctx, {
          provider,
          account: { id: email, secret },
        });
        if (retrieved === null) {
          throw new Error("Invalid credentials");
        }
        const { account, user } = retrieved;
        if (config.verify && !account.emailVerified) {
          return await signInViaProvider(ctx, config.verify, {
            accountId: account._id,
            params,
          });
        }
        return { userId: user._id };
      }

      if (flow === "reset") {
        if (!config.reset) {
          throw new Error(`Password reset is not enabled for ${provider}`);
        }
        // Apply the same limits before lookup so cooldowns cannot reveal accounts.
        await ctx.runMutation(consumePasswordResetRequestRef, { email });
        const retrieved = await retrieveAccount(ctx, {
          provider,
          account: { id: email },
        }).catch((error: unknown) => {
          // Convex Auth throws for a missing account; only this expected case
          // gets the same null result as a successful reset-code request.
          if (error instanceof Error && error.message === "InvalidAccountId") {
            return null;
          }
          throw error;
        });
        if (retrieved === null) {
          return null;
        }
        return await signInViaProvider(ctx, config.reset, {
          accountId: retrieved.account._id,
          params: { ...params, email },
        });
      }

      if (flow === "reset-verification") {
        if (!config.reset) {
          throw new Error(`Password reset is not enabled for ${provider}`);
        }
        if (params.newPassword === undefined) {
          throw new Error("Missing `newPassword` param for `reset-verification` flow");
        }
        // Without a code, the email provider would start another send. All sends
        // must go through the rate-limited reset request branch above.
        if (typeof params.code !== "string" || !/^\d{6}$/.test(params.code)) {
          throw new Error("Invalid code");
        }

        const newPassword = params.newPassword as string;
        const { account: resetAccount } = await retrieveAccount(ctx, {
          provider,
          account: { id: email },
        });
        const result = await signInViaProvider(ctx, config.reset, { params });
        if (result === null) {
          throw new Error("Invalid code");
        }
        const { userId, sessionId } = result;
        try {
          if (resetAccount.userId !== userId) {
            throw new Error("Invalid code");
          }
          await assertPasswordNotReused(
            typeof resetAccount.secret === "string" ? resetAccount.secret : undefined,
            newPassword,
          );
          await modifyAccountCredentials(ctx, {
            provider,
            account: { id: email, secret: newPassword },
          });
          await invalidateSessions(ctx, { userId, except: [sessionId] });
          return { userId, sessionId };
        } catch (error) {
          await ctx.runMutation(invalidateResetSessionRef, { userId, sessionId });
          throw error;
        }
      }

      if (flow === "email-verification") {
        if (!config.verify) {
          throw new Error(`Email verification is not enabled for ${provider}`);
        }
        const { account } = await retrieveAccount(ctx, {
          provider,
          account: { id: email },
        });
        return await signInViaProvider(ctx, config.verify, {
          accountId: account._id,
          params,
        });
      }

      throw new Error(
        'Missing `flow` param, it must be one of "signUp", "signIn", "reset", "reset-verification" or "email-verification"!',
      );
    },
    crypto: {
      async hashSecret(password: string) {
        return await new Scrypt().hash(password);
      },
      async verifySecret(password: string, hash: string) {
        return await new Scrypt().verify(hash, password);
      },
    },
    extraProviders: [config.reset, config.verify],
    ...config,
  });
}
