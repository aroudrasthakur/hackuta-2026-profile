import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeLedgerPoints } from "../../convex/admin/pointsLedger";
import { sha256Hex } from "../../convex/lib/sha256Hex";
import { applyPlay, beginPlay, cooldownLeft } from "../../convex/arcade/points";
import { createConvexTest, type ConvexTestInstance } from "../helpers/convexTestContext";
import { seedStaff } from "../helpers/reviewTestKit";
import { HOUR, MINUTE, NOW, forceRandom, openArcade, seedPlayer, updateGameInternal, updateSettingsInternal, walletOf } from "../helpers/arcadeTestKit";
import { LAUNCH_CODE_TTL_MS, arcadeStateAt, checkArcadeSettings, normalizePlayId } from "../../shared/arcade/rules";

const getSession = makeFunctionReference<"query">("arcade/session:getArcadeSession");
const getLauncher = makeFunctionReference<"query">("arcade/session:getLauncherState");
const getAdmin = makeFunctionReference<"query">("arcade/admin:getArcadeAdmin");
const updateSettings = makeFunctionReference<"mutation">("arcade/admin:updateArcadeSettings");
const updateGame = makeFunctionReference<"mutation">("arcade/admin:updateArcadeGame");
const createLaunchCode = makeFunctionReference<"mutation">("arcade/launch:createLaunchCode");
const consumeLaunchCode = makeFunctionReference<"mutation">("arcade/launch:consumeLaunchCode");
const slotSpin = makeFunctionReference<"mutation">("admin/slotSpin:spin");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const LOSE = 0.99;
const balanceOf = (t: ConvexTestInstance, id: GenericId<"checkedIn">) => t.run(async (ctx) => (await ctx.db.get(id))?.points);
const ledgerOf = (t: ConvexTestInstance, id: GenericId<"checkedIn">) => t.run((ctx) => computeLedgerPoints(ctx, id));

describe("arcade switch rules (pure)", () => {
  it("reads off, scheduled and on with the clock, and closes by itself", () => {
    expect(arcadeStateAt({ mode: "off" }, NOW)).toEqual({ status: "off", opensAt: null, closesAt: null, nextChangeAt: null });
    expect(arcadeStateAt({ mode: "on" }, NOW)).toMatchObject({ status: "on", nextChangeAt: null });
    expect(arcadeStateAt({ mode: "on", closesAt: NOW + HOUR }, NOW)).toMatchObject({ status: "on", nextChangeAt: NOW + HOUR });
    expect(arcadeStateAt({ mode: "on", closesAt: NOW }, NOW)).toMatchObject({ status: "off" });
    const schedule = { mode: "scheduled" as const, opensAt: NOW + HOUR, closesAt: NOW + 2 * HOUR };
    expect(arcadeStateAt(schedule, NOW)).toMatchObject({ status: "scheduled", nextChangeAt: NOW + HOUR });
    expect(arcadeStateAt(schedule, NOW + HOUR)).toMatchObject({ status: "on", nextChangeAt: NOW + 2 * HOUR });
    expect(arcadeStateAt(schedule, NOW + 2 * HOUR)).toMatchObject({ status: "off", nextChangeAt: null });
    // A schedule missing a time is treated as off, never as open.
    expect(arcadeStateAt({ mode: "scheduled", opensAt: NOW - HOUR }, NOW)).toMatchObject({ status: "off" });
  });

  it("validates admin input", () => {
    expect(checkArcadeSettings({ mode: "off", opensAt: 5 }, NOW)).toEqual({ ok: true, value: { mode: "off" } });
    expect(checkArcadeSettings({ mode: "on", closesAt: NOW - 1 }, NOW)).toMatchObject({ ok: false, code: "ARCADE_INVALID_TIMES" });
    expect(checkArcadeSettings({ mode: "scheduled", opensAt: NOW }, NOW)).toMatchObject({ ok: false, code: "ARCADE_INVALID_TIMES" });
    expect(checkArcadeSettings({ mode: "scheduled", opensAt: NOW + HOUR, closesAt: NOW + HOUR }, NOW)).toMatchObject({ ok: false });
    expect(checkArcadeSettings({ mode: "scheduled", opensAt: NOW + 0.5, closesAt: NOW + HOUR }, NOW)).toMatchObject({ ok: false });
    expect(checkArcadeSettings({ mode: "scheduled", opensAt: NOW, closesAt: NOW + 73 * HOUR }, NOW)).toMatchObject({ code: "ARCADE_SCHEDULE_TOO_LONG" });
    expect(checkArcadeSettings({ mode: "bogus" as "on" }, NOW)).toMatchObject({ code: "ARCADE_INVALID_MODE" });
  });

  it("accepts only tidy play ids", () => {
    expect(normalizePlayId("  3f2a-b_9 ")).toBe("3f2a-b_9");
    expect(normalizePlayId(crypto.randomUUID())).not.toBeNull();
    for (const bad of ["", "   ", "a b", "x".repeat(65), "<script>", 42, null]) expect(normalizePlayId(bad)).toBeNull();
  });
});

describe("getArcadeSession", () => {
  it("works signed out, with safe defaults before an admin sets anything", async () => {
    const t = createConvexTest();
    const session = await t.query(getSession, {});
    expect(session).toMatchObject({
      serverNow: NOW,
      arcade: { status: "off" },
      signIn: { launchEnabled: true, backupSignIn: false },
      player: null,
    });
    expect(session.games.map((g: { key: string; enabled: boolean }) => [g.key, g.enabled])).toEqual([
      ["olympus-slots", false],
      ["wheel-of-the-fates", false],
      ["olympus-poker", false],
      ["pvp-blackjack", false],
    ]);
  });

  it("shows the caller's own name, email and points, and why they can't play", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const ready = await seedPlayer(t, { points: 140 });
    expect((await ready.player.query(getSession, {})).player).toMatchObject({ displayName: "Taylor Student", points: 140, problem: null });

    const none = await seedPlayer(t, { participant: false });
    expect((await none.player.query(getSession, {})).player).toMatchObject({ points: null, problem: "NOT_PARTICIPANT" });
    const waitlisted = await seedPlayer(t, { review: "waitlisted" });
    expect((await waitlisted.player.query(getSession, {})).player).toMatchObject({ problem: "NOT_ELIGIBLE" });
    const notCheckedIn = await seedPlayer(t, { checkedIn: false });
    expect((await notCheckedIn.player.query(getSession, {})).player).toMatchObject({ points: null, problem: "NOT_CHECKED_IN" });
  });

  it("returns the arcade balance a game just wrote, and the untouched profile balance", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const { player, checkedInId } = await seedPlayer(t, { points: 100, arcadePoints: 100 });
    forceRandom(LOSE);
    await player.mutation(slotSpin, { spinId: "s1", wager: 25 });
    expect((await player.query(getSession, {})).player).toMatchObject({ points: 100, arcadePoints: 75 });
    // A change made outside the arcade (a volunteer, the shop) shows up too.
    await t.run((ctx) => ctx.db.patch(checkedInId!, { points: 175 }));
    expect((await player.query(getSession, {})).player.points).toBe(175);
  });

  it("stops play when an acceptance is revoked after check-in", async () => {
    const t = createConvexTest();
    await openArcade(t);
    const { player, applicant } = await seedPlayer(t, { points: 100 });
    await t.run(async (ctx) => {
      const review = await ctx.db.query("applicationReviews").withIndex("by_application", (q) => q.eq("applicationId", applicant.applicationId)).unique();
      await ctx.db.patch(review!._id, { status: "rejected" });
    });
    expect((await player.query(getSession, {})).player).toMatchObject({ problem: "NOT_ELIGIBLE" });
    expect(await player.mutation(slotSpin, { spinId: "s1", wager: 10 })).toMatchObject({ code: "NOT_ELIGIBLE" });
  });
});

describe("admin switches", () => {
  it("are for administrators only", async () => {
    const t = createConvexTest();
    const volunteer = await seedStaff(t, { role: "volunteer" });
    await expect(t.query(getAdmin, { sessionToken: volunteer.sessionToken })).rejects.toThrow();
    await expect(t.mutation(updateSettings, { sessionToken: volunteer.sessionToken, mode: "on" })).rejects.toThrow();
    await expect(t.mutation(updateGame, { sessionToken: "f".repeat(64), key: "olympus-slots", enabled: true })).rejects.toThrow();
    expect((await t.query(getSession, {})).arcade.status).toBe("off");
  });

  it("change the arcade, keep unspecified switches, and write the audit log", async () => {
    const t = createConvexTest();
    const admin = await seedStaff(t);
    await t.mutation(updateSettings, { sessionToken: admin.sessionToken, mode: "on", backupSignIn: true });
    await t.mutation(updateSettings, { sessionToken: admin.sessionToken, mode: "scheduled", opensAt: NOW + HOUR, closesAt: NOW + 3 * HOUR });
    await t.mutation(updateGame, { sessionToken: admin.sessionToken, key: "wheel-of-the-fates", enabled: true });
    const state = await t.query(getAdmin, { sessionToken: admin.sessionToken });
    expect(state.settings).toMatchObject({ mode: "scheduled", opensAt: NOW + HOUR, closesAt: NOW + 3 * HOUR, launchEnabled: true, backupSignIn: true });
    expect(state.state).toMatchObject({ status: "scheduled" });
    expect(state.games.find((g: { key: string }) => g.key === "wheel-of-the-fates")).toMatchObject({ enabled: true, name: "Wheel of Doom" });

    // Switching back to "on" drops the old schedule times.
    await t.mutation(updateSettings, { sessionToken: admin.sessionToken, mode: "on" });
    expect((await t.query(getAdmin, { sessionToken: admin.sessionToken })).settings).toMatchObject({ mode: "on", opensAt: null, closesAt: null });

    const logs = await t.run((ctx) => ctx.db.query("staffConfigLogs").collect());
    expect(logs.map((l) => [l.action, l.actorAdminId, l.targetArcadeGameKey])).toEqual([
      ["arcade_settings_updated", admin.adminId, undefined],
      ["arcade_settings_updated", admin.adminId, undefined],
      ["arcade_game_updated", admin.adminId, "wheel-of-the-fates"],
      ["arcade_settings_updated", admin.adminId, undefined],
    ]);
    expect(await t.run((ctx) => ctx.db.query("arcadeSettings").collect())).toHaveLength(1);
  });

  it("reject bad input without changing anything", async () => {
    const t = createConvexTest();
    const admin = await seedStaff(t);
    const token = admin.sessionToken;
    await expect(t.mutation(updateSettings, { sessionToken: token, mode: "scheduled", opensAt: NOW + HOUR })).rejects.toThrow(/close after it opens/);
    await expect(t.mutation(updateSettings, { sessionToken: token, mode: "on", closesAt: NOW - MINUTE })).rejects.toThrow();
    await expect(t.mutation(updateGame, { sessionToken: token, key: "poker", enabled: true })).rejects.toThrow(/doesn't exist/);
    expect(await t.run((ctx) => ctx.db.query("arcadeSettings").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("arcadeGames").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("staffConfigLogs").collect())).toEqual([]);
  });
});

describe("shared points (applyPlay)", () => {
  it("never lets a stake take the balance below zero, and refuses bad stakes", async () => {
    const t = createConvexTest();
    await openArcade(t, ["wheel-of-the-fates"]);
    const { player, checkedInId } = await seedPlayer(t, { arcadePoints: 30 });
    const results = await t.run(async (ctx) => {
      const checkedIn = (await ctx.db.get(checkedInId!))!;
      const base = { checkedIn, game: "wheel-of-the-fates" as const, now: NOW };
      return [
        await applyPlay(ctx, { ...base, playId: "a", stake: 31, payout: 0 }),
        await applyPlay(ctx, { ...base, playId: "b", stake: 0, payout: 0 }),
        await applyPlay(ctx, { ...base, playId: "c", stake: -5, payout: 0 }),
        await applyPlay(ctx, { ...base, playId: "d", stake: 2.5, payout: 0 }),
      ];
    });
    expect(results.map((r) => (r.ok ? "ok" : r.code))).toEqual(["INSUFFICIENT_POINTS", "INVALID_STAKE", "INVALID_STAKE", "INVALID_STAKE"]);
    expect(await walletOf(t, checkedInId!)).toBe(30);
    expect(player).toBeTruthy();
  });

  it("keeps one arcade balance across games, with cooldowns per game, and never touches the profile", async () => {
    const t = createConvexTest();
    await openArcade(t, ["olympus-slots", "wheel-of-the-fates"]);
    const { player, checkedInId } = await seedPlayer(t, { points: 100, arcadePoints: 100 });
    forceRandom(LOSE);
    expect(await player.mutation(slotSpin, { spinId: "slot-1", wager: 10 })).toMatchObject({ newPoints: 90 });

    // A roulette play right after: the slots cooldown doesn't block another game.
    const roulette = await t.run(async (ctx) => {
      const checkedIn = (await ctx.db.get(checkedInId!))!;
      const wait = await cooldownLeft(ctx, checkedIn, "wheel-of-the-fates", 3000, NOW);
      const applied = await applyPlay(ctx, { checkedIn, game: "wheel-of-the-fates", playId: "wheel-1", stake: 20, payout: 60, now: NOW });
      const slotWait = await cooldownLeft(ctx, checkedIn, "olympus-slots", 2000, NOW + 500);
      return { wait, applied, slotWait };
    });
    expect(roulette.wait).toBe(0);
    expect(roulette.applied).toMatchObject({ ok: true, play: { previousPoints: 90, newPoints: 130, pointsDelta: 40 } });
    expect(roulette.slotWait).toBe(1500);
    expect(await walletOf(t, checkedInId!)).toBe(130);
    expect(await balanceOf(t, checkedInId!)).toBe(100);
    expect(await ledgerOf(t, checkedInId!)).toBe(100);
    expect((await player.query(getSession, {})).player).toMatchObject({ points: 100, arcadePoints: 130 });
  });

  it("treats the same play id in two games as two plays, and in one game as a replay", async () => {
    const t = createConvexTest();
    await openArcade(t, ["olympus-slots", "wheel-of-the-fates"]);
    const { player, checkedInId } = await seedPlayer(t, { arcadePoints: 100 });
    forceRandom(LOSE);
    await player.mutation(slotSpin, { spinId: "same", wager: 10 });
    const kinds = await player.run(async (ctx) => [
      (await beginPlay(ctx, "olympus-slots", "same", NOW)).kind,
      (await beginPlay(ctx, "wheel-of-the-fates", "same", NOW)).kind,
    ]);
    expect(kinds).toEqual(["replay", "new"]);
    expect(await walletOf(t, checkedInId!)).toBe(90);
  });
});

describe("launch codes", () => {
  async function launchReady(t: ConvexTestInstance) {
    await openArcade(t);
    return seedPlayer(t, { points: 100 });
  }

  it("signs in the code's owner once, stores only a hash, and expires", async () => {
    const t = createConvexTest();
    const { player, applicant } = await launchReady(t);
    const made = await player.mutation(createLaunchCode, {});
    expect(made).toMatchObject({ status: "ok", expiresAt: NOW + LAUNCH_CODE_TTL_MS });
    const code = (made as { code: string }).code;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await t.run((ctx) => ctx.db.query("arcadeLaunchCodes").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.codeHash).toBe(await sha256Hex(code));
    expect(JSON.stringify(rows)).not.toContain(code);

    expect(await t.mutation(consumeLaunchCode, { code })).toBe(applicant.userId);
    expect(await t.mutation(consumeLaunchCode, { code })).toBeNull();

    const late = (await player.mutation(createLaunchCode, {})) as { code: string };
    vi.setSystemTime(NOW + LAUNCH_CODE_TTL_MS);
    expect(await t.mutation(consumeLaunchCode, { code: late.code })).toBeNull();
  });

  it("rejects unknown and malformed codes", async () => {
    const t = createConvexTest();
    await launchReady(t);
    for (const code of ["", "short", "x".repeat(43), `${"A".repeat(42)}=`, "A".repeat(44)]) {
      expect(await t.mutation(consumeLaunchCode, { code })).toBeNull();
    }
  });

  it("is refused for players who can't play, and when the arcade or launch codes are off", async () => {
    const t = createConvexTest();
    expect(await t.mutation(createLaunchCode, {})).toMatchObject({ code: "NOT_SIGNED_IN" });
    const notCheckedIn = await seedPlayer(t, { checkedIn: false });
    expect(await notCheckedIn.player.mutation(createLaunchCode, {})).toMatchObject({ code: "NOT_CHECKED_IN" });

    const { player } = await seedPlayer(t);
    expect(await player.mutation(createLaunchCode, {})).toMatchObject({ code: "ARCADE_CLOSED" });
    // Scheduled is fine: the lobby shows the countdown.
    await t.mutation(updateSettingsInternal, { mode: "scheduled", opensAt: NOW + HOUR, closesAt: NOW + 2 * HOUR });
    const made = (await player.mutation(createLaunchCode, {})) as { status: string; code: string };
    expect(made.status).toBe("ok");

    // Switching launch codes off refuses new codes and codes already handed out.
    await t.mutation(updateSettingsInternal, { mode: "scheduled", opensAt: NOW + HOUR, closesAt: NOW + 2 * HOUR, launchEnabled: false });
    expect(await player.mutation(createLaunchCode, {})).toMatchObject({ code: "LAUNCH_DISABLED" });
    expect(await t.mutation(consumeLaunchCode, { code: made.code })).toBeNull();
    expect(await player.query(getLauncher, {})).toEqual({ visible: false });
  });

  it("is rate limited per account and cleans up old codes", async () => {
    const t = createConvexTest();
    const { player } = await launchReady(t);
    for (let i = 0; i < 5; i += 1) {
      vi.setSystemTime(NOW + i * 1000);
      expect(await player.mutation(createLaunchCode, {})).toMatchObject({ status: "ok" });
    }
    expect(await player.mutation(createLaunchCode, {})).toEqual({ status: "error", code: "RATE_LIMITED", retryAfterMs: 56_000 });
    vi.setSystemTime(NOW + 2 * MINUTE);
    expect(await player.mutation(createLaunchCode, {})).toMatchObject({ status: "ok" });
    expect(await t.run((ctx) => ctx.db.query("arcadeLaunchCodes").collect())).toHaveLength(1);
  });

  it("can't be used to sign in as someone else's account", async () => {
    const t = createConvexTest();
    const a = await launchReady(t);
    const b = await seedPlayer(t);
    const made = (await a.player.mutation(createLaunchCode, {})) as { code: string };
    // Whoever presents the code gets the account that made it, never their own.
    expect(await b.player.mutation(consumeLaunchCode, { code: made.code })).toBe(a.applicant.userId);
  });
});

describe("profile's Arcade button", () => {
  it("shows only for a checked-in hacker while the arcade is scheduled or on", async () => {
    const t = createConvexTest();
    const { player } = await seedPlayer(t);
    const stranger = await seedPlayer(t, { checkedIn: false });
    expect(await t.query(getLauncher, {})).toEqual({ visible: false });
    expect(await player.query(getLauncher, {})).toEqual({ visible: false });
    await t.mutation(updateSettingsInternal, { mode: "on", closesAt: NOW + HOUR });
    expect(await player.query(getLauncher, {})).toMatchObject({ visible: true, status: "on", closesAt: NOW + HOUR });
    expect(await stranger.player.query(getLauncher, {})).toEqual({ visible: false });
    vi.setSystemTime(NOW + HOUR);
    expect(await player.query(getLauncher, { nowBucket: 1 })).toEqual({ visible: false });
  });
});

describe("the game list", () => {
  it("ignores unknown games and keeps lobby order", async () => {
    const t = createConvexTest();
    await t.mutation(updateGameInternal, { key: "pvp-blackjack", enabled: true });
    await expect(t.mutation(updateGameInternal, { key: "../olympus-slots", enabled: true })).rejects.toThrow();
    const games = (await t.query(getSession, {})).games;
    expect(games.map((g: { key: string }) => g.key)).toEqual(["olympus-slots", "wheel-of-the-fates", "olympus-poker", "pvp-blackjack"]);
    expect(games[3]).toMatchObject({ key: "pvp-blackjack", enabled: true });
  });
});
