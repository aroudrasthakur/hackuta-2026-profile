# Production: strip legacy `participants` fields (option B)

Use this when prod `participants` rows still have `points` (and related on-site fields) but you want to deploy the slim `participants` + `checkedIn` schema. **Does not create `checkedIn` rows.**

Convex deploy validates existing documents **before** the push succeeds, so you need **two deploys** and **one manual migration run** between them.

---

## Prerequisites

- Production **deploy key** with `deployment:deploy` ([Convex deploy keys](https://docs.convex.dev/cli/deploy-key-types))
- `hackuta-2026-profile` on `main` with `migrations:stripLegacyParticipantFields` merged
- Register lock refreshed after `convex/migrations.ts` changed in register:
  - Commit migration in **hackuta-2026-register**
  - In profile: `npm run register-schema-lock:refresh` and commit manifest + copied files

---

## Phase 1 — Deploy migration + schema that still accepts legacy rows

Prod data today includes optional fields such as `points`. Your **first** deploy must not remove those fields from the `participants` validator yet.

1. In `hackuta-2026-profile/convex/schema.ts`, inside `participants: defineTable({ ... })`, **temporarily** add (and restore any prod-only indexes if your dashboard schema had them):

```ts
    // TEMPORARY — remove after stripLegacyParticipantFields on prod (phase 2 deploy)
    points: v.optional(v.number()),
    pointsReachedAt: v.optional(v.number()),
    badgeQrCodeToken: v.optional(v.string()),
    badgeAssignedAt: v.optional(v.number()),
    badgeAssignedBy: v.optional(v.id("admins")),
    foodCheckedInAt: v.optional(v.number()),
    registrationQrCodeToken: v.optional(v.string()),
```

Optional indexes (only if prod still has them and deploy complains):  
`.index("by_badge_qr_token", ["badgeQrCodeToken"])`,  
`.index("by_registration_qr_token", ["registrationQrCodeToken"])`,  
`.index("by_points", ["points"])`.

2. From **hackuta-2026-profile**:

```powershell
cd "c:\Users\aroud\OneDrive\Documents\GitHub\Website\hackuta-2026-profile"
npm run verify:register-schema-lock
npm run verify:admin-schema-lock
$env:CONVEX_DEPLOYMENT = $null
$env:CONVEX_DEPLOY_KEY = "<production deploy key>"
npm run convex:deploy
Remove-Item Env:CONVEX_DEPLOY_KEY -ErrorAction SilentlyContinue
```

Deploy should succeed because documents still match the validator.

---

## Phase 2 — Run migration (you run this; do not skip verification)

```powershell
cd "c:\Users\aroud\OneDrive\Documents\GitHub\Website\hackuta-2026-profile"
$env:CONVEX_DEPLOYMENT = $null
$env:CONVEX_DEPLOY_KEY = "<production deploy key>"
npx convex run migrations:stripLegacyParticipantFields
Remove-Item Env:CONVEX_DEPLOY_KEY -ErrorAction SilentlyContinue
```

Expected: `{ ok: true, updated: <n>, skipped: <m> }` with `updated` = rows that had legacy fields.

**Verify in Dashboard → Data → `participants`:** open a few rows — **no `points`** (or other legacy keys).

Optional dry check (read-only):

```powershell
npx convex run --inline-query "const rows = await ctx.db.query('participants').take(20); return rows.map((r) => ({ id: r._id, keys: Object.keys(r).filter((k) => !k.startsWith('_')) }));"
```

(With the same `CONVEX_DEPLOY_KEY` set.)

---

## Phase 3 — Deploy final schema (slim `participants`)

1. Revert the **temporary** fields (and extra indexes) from `convex/schema.ts` so `participants` matches current `main` (no `points`, no badge fields on participant).
2. Deploy again:

```powershell
$env:CONVEX_DEPLOYMENT = $null
$env:CONVEX_DEPLOY_KEY = "<production deploy key>"
npm run convex:deploy
Remove-Item Env:CONVEX_DEPLOY_KEY -ErrorAction SilentlyContinue
```

If deploy still fails, fix the **next** table called out in the error (e.g. `mealRedemptions`, `participantNotifications`) — this runbook only covers `participants`.

---

## Helper script

`scripts/prod-strip-legacy-participants.ps1` — runs **phase 2 only** after you paste the deploy key (does not deploy).

---

## Rollback

`stripLegacyParticipantFields` only removes fields; it does not restore `points` values. Keep a Convex **backup/export** before phase 2 if you need audit history.
