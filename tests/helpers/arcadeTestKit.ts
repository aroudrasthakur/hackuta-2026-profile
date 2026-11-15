/**
 * Shared seeding for the arcade and game integration tests: a player at any
 * stage (no participant, not accepted, not checked in, checked in with
 * points), and the arcade / game switches.
 */
import { makeFunctionReference } from "convex/server";
import { vi } from "vitest";
import type { GenericId } from "convex/values";
import type { ConvexTestInstance } from "./convexTestContext";
import { seedApplicant, seedStaff } from "./reviewTestKit";

export const NOW = Date.UTC(2026, 10, 14, 19);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const updateSettingsInternal = makeFunctionReference<"mutation">("arcade/admin:updateArcadeSettingsInternal");
export const updateGameInternal = makeFunctionReference<"mutation">("arcade/admin:updateArcadeGameInternal");

let tokenCounter = 0;

export type SeedOptions = {
  /** Profile balance (`checkedIn.points`) after any seeded deposit. Default 100. */
  points?: number;
  /** Arcade wallet, seeded as one earlier deposit (log row + matching profile move). Default 0. */
  arcadePoints?: number;
  checkedIn?: boolean;
  review?: string;
  participant?: boolean;
  ledger?: boolean;
};

export async function seedPlayer(t: ConvexTestInstance, options: SeedOptions = {}) {
  const admin = await seedStaff(t);
  const applicant = await seedApplicant(t, { review: { status: options.review ?? "accepted" } });
  const player = t.withIdentity({ subject: applicant.userId });
  if (options.participant === false) return { player, admin, applicant, participantId: null, checkedInId: null };
  tokenCounter += 1;
  const registrationQr = tokenCounter.toString(16).padStart(64, "a");
  const points = options.points ?? 100;
  const arcadePoints = options.arcadePoints ?? 0;
  const ids = await t.run(async (ctx) => {
    const participantId = await ctx.db.insert("participants", {
      applicationId: applicant.applicationId,
      authUserId: applicant.userId,
      acceptedAt: 1,
      acceptedBy: admin.adminId,
      qrCodeToken: registrationQr,
      createdAt: 1,
      updatedAt: 1,
    });
    if (options.checkedIn === false) return { participantId, checkedInId: null };
    const checkedInId = await ctx.db.insert("checkedIn", {
      participantId,
      applicationId: applicant.applicationId,
      authUserId: applicant.userId,
      acceptedAt: 1,
      acceptedBy: admin.adminId,
      checkedInAt: 1,
      checkedInBy: admin.adminId,
      qrCodeToken: `HACKUTA-BADGE-${String(tokenCounter).padStart(4, "0")}`,
      registrationQrCodeToken: registrationQr,
      points,
      createdAt: 1,
      updatedAt: 1,
    });
    const earned = points + arcadePoints;
    if (options.ledger !== false && earned > 0) {
      // Make the cached balance match the ledger so parity checks are meaningful.
      await ctx.db.insert("volunteerActionLogs", {
        actorAdminId: admin.adminId,
        checkedInId,
        action: "admin_adjust",
        pointsDelta: earned,
        previousPoints: 0,
        newPoints: earned,
        reason: "seed",
        createdAt: 1,
      });
    }
    if (arcadePoints > 0) {
      // As if the hacker had deposited `arcadePoints` earlier: the wallet, the log row,
      // and the profile already reduced by it.
      await ctx.db.insert("arcadeWallets", { checkedInId, points: arcadePoints, updatedAt: 1 });
      await ctx.db.insert("arcadeTransfers", {
        checkedInId,
        transferId: `seed-${tokenCounter}`,
        kind: "deposit",
        amount: arcadePoints,
        profileBefore: earned,
        profileAfter: points,
        arcadeBefore: 0,
        arcadeAfter: arcadePoints,
        createdAt: 1,
      });
    }
    return { participantId, checkedInId };
  });
  return { player, admin, applicant, ...ids };
}

/** Arcade on (no end time) and the given games switched on. */
export async function openArcade(t: ConvexTestInstance, games: string[] = ["olympus-slots"]) {
  await t.mutation(updateSettingsInternal, { mode: "on" });
  for (const key of games) await t.mutation(updateGameInternal, { key, enabled: true });
}

/** Forces the server RNG (Web Crypto) to return `value` in [0, 1) for every Uint32 draw. */
export function forceRandom(value: number) {
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((array: ArrayBufferView) => {
    // Only the game's Uint32 draws are forced; launch-code bytes stay random.
    if (array instanceof Uint32Array) {
      array.fill(Math.floor(value * 2 ** 32));
      return array;
    }
    return real(array as Uint8Array);
  }) as typeof globalThis.crypto.getRandomValues);
}

/** The arcade wallet balance (0 when there's no wallet yet). */
export function walletOf(t: ConvexTestInstance, checkedInId: GenericId<"checkedIn">) {
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query("arcadeWallets")
      .withIndex("by_checkedIn", (q) => q.eq("checkedInId", checkedInId))
      .unique();
    return row?.points ?? 0;
  });
}
