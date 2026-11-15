import { makeFunctionReference } from "convex/server";

/** Live schedule from this repo's `convex/arcade` backend. */
export type ArcadeLauncherState =
  | { visible: false }
  | {
      visible: true;
      status: "off" | "scheduled" | "on";
      opensAt: number | null;
      closesAt: number | null;
      nextChangeAt: number | null;
    };

export const getArcadeLauncherStateRef = makeFunctionReference<
  "query",
  { nowBucket?: number },
  ArcadeLauncherState
>("arcade/session:getLauncherState");

export type LaunchCodeResponse =
  | { status: "ok"; code: string; expiresAt: number }
  | { status: "error"; code: string; retryAfterMs?: number };

/** Called before redirecting to gamble.hackuta.com/launch#code=… */
export const createLaunchCodeRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  LaunchCodeResponse
>("arcade/launch:createLaunchCode");
