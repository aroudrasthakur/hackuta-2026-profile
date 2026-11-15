/**
 * Internal sandbox seeder already deployed on peccary. Keep the export so a
 * push never deletes it. Does not create accounts from arcade-site (the
 * original hasher is not in this overlay).
 */
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

export const seedTestPlayersInternal = internalMutation({
  args: {
    players: v.array(
      v.object({
        email: v.string(),
        name: v.string(),
        password: v.string(),
      }),
    ),
    points: v.number(),
  },
  handler: async () => ({ ok: true as const, seeded: 0, skipped: true }),
});