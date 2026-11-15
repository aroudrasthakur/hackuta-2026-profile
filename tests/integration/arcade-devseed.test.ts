import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeLedgerPoints } from "../../convex/admin/pointsLedger";
import { createConvexTest } from "../helpers/convexTestContext";
import { NOW, openArcade } from "../helpers/arcadeTestKit";

const seed = makeFunctionReference<"mutation">("arcade/devSeed:seedArcadeTesterInternal");
const getSession = makeFunctionReference<"query">("arcade/session:getArcadeSession");
const deposit = makeFunctionReference<"mutation">("arcade/transfers:deposit");
const ARGS = { email: "Arcade-Tester@hackuta.dev", password: "ArcadeTest2026", points: 500 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("arcade test-account seed", () => {
  it("refuses to run anywhere but the sandbox", async () => {
    const t = createConvexTest();
    vi.stubEnv("CONVEX_CLOUD_URL", "https://standing-manatee-425.convex.cloud");
    await expect(t.mutation(seed, ARGS)).rejects.toThrow(/only runs on brazen-peccary-506/);
    vi.stubEnv("CONVEX_CLOUD_URL", "");
    await expect(t.mutation(seed, ARGS)).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
  });

  it("creates an accepted, checked-in hacker who can deposit, once", async () => {
    const t = createConvexTest();
    vi.stubEnv("CONVEX_CLOUD_URL", "https://brazen-peccary-506.convex.cloud");
    await openArcade(t, ["wheel-of-the-fates"]);
    const first = await t.mutation(seed, ARGS);
    expect(first).toMatchObject({ email: "arcade-tester@hackuta.dev", profilePoints: 500, existingAccount: false });
    const again = await t.mutation(seed, ARGS);
    expect(again).toMatchObject({ checkedInId: first.checkedInId, existingAccount: true });
    expect(await t.run((ctx) => ctx.db.query("checkedIn").collect())).toHaveLength(1);
    expect(await t.run((ctx) => computeLedgerPoints(ctx, first.checkedInId))).toBe(500);

    const hacker = t.withIdentity({ subject: first.userId });
    expect((await hacker.query(getSession, {})).player).toMatchObject({ displayName: "Arcade Tester", problem: null, points: 500, arcadePoints: 0 });
    expect(await hacker.mutation(deposit, { transferId: "first", amount: 100 })).toMatchObject({ status: "ok", transfer: { profileAfter: 400, arcadeAfter: 100 } });
  });

  it("rejects a weak password", async () => {
    const t = createConvexTest();
    vi.stubEnv("CONVEX_CLOUD_URL", "https://brazen-peccary-506.convex.cloud");
    await expect(t.mutation(seed, { ...ARGS, password: "short" })).rejects.toThrow();
  });
});
