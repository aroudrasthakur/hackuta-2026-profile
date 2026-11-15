import { makeFunctionReference } from "convex/server";

/** Live schedule from the deployment the arcade overlay is pushed to (via hackuta2026-arcade-site). */
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