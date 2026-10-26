# Meal backend and served-count release

This checkout contains the admin meal APIs and schema synchronized using
`npm run admin-schema-lock:refresh`. The register lock scripts also recognize
`mealPeriods` and `mealRedemptions` as admin-owned tables. Register-owned source
files are unchanged.

Before deploying, run both schema-lock checks, backend TypeScript checks, and
the unit suite from this profile checkout. Deploy Convex only from profile.
The schema fields for cached counts and progress are optional so existing meals
and redemption history remain valid during the upgrade.

For every meal that predates cached served counts, call the internal mutation
`admin/mealCountsBackfill:backfillMealServedCount` in the deployment being upgraded
with `{ "mealPeriodId": "<existing meal id>" }`. Repeat for that meal until the
result has `isDone: true`. Each call reads at most 100 redemption rows. Progress
is stored on the meal; retries and concurrent serving are safe. Repeat this for
all preexisting meals before completing the release.

New meals start with a complete count of zero. New collections increment the
count in their redemption transaction. Admins see “Updating count…” for legacy
meals until backfill completes; their collection history remains accessible.

These changes have been prepared locally. No Convex deployment or live-data
backfill was performed as part of preparing this checkout.
