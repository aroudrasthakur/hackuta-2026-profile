/**
 * Convex Auth provider for the profile → arcade hand-off (see launch.ts).
 * Registered in convex/auth.ts. The arcade calls
 * `signIn("arcade-launch", { code })`; a bad, used or expired code fails the
 * sign-in. It can't create accounts: it only signs in an existing user.
 */
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { isLaunchCodeShape } from "../../shared/arcade/rules";

const consumeLaunchCodeRef = makeFunctionReference<"mutation", { code: string }, GenericId<"users"> | null>(
  "arcade/launch:consumeLaunchCode",
);

export const ArcadeLaunch = ConvexCredentials({
  id: "arcade-launch",
  authorize: async (credentials, ctx) => {
    const code = credentials.code;
    if (!isLaunchCodeShape(code)) return null;
    const userId = await ctx.runMutation(consumeLaunchCodeRef, { code });
    return userId ? { userId } : null;
  },
});
