# Register schema lock artifacts (`scripts/register-schema-lock/`)

Frozen snapshots used by [verify-register-schema-lock.mjs](../verify-register-schema-lock.mjs). **Do not edit by hand** — run `npm run register-schema-lock:refresh`.

## Overview

| File | Summary |
| --- | --- |
| [manifest.json](manifest.json) | SHA-256 per register-owned code file (67 `.ts`/`.csv` paths; excludes `README.md`) plus `registerSchemaLockedHash` |
| [schema.reference.ts](schema.reference.ts) | Copy of hackuta-2026-register/convex/schema.ts for register-table comparison |

## manifest.json fields

| Field | Purpose |
| --- | --- |
| `source` | Upstream repo name (`hackuta-2026-register`) |
| `editableTables` | Admin-owned schema tables — excluded from schema lock comparison |
| `registerSchemaLockedHash` | Normalized hash of register-owned tables in admin convex/schema.ts |
| `files` | Path → SHA-256 map for immutable files |

## Refresh workflow

```bash
# Requires ../hackuta-2026-register as sibling
npm run register-schema-lock:refresh
npm run verify:register-schema-lock
git add scripts/register-schema-lock/ convex/ shared/
```

Refresh copies drifted files from register into admin and regenerates hashes.

## Related

| Location | Role |
| --- | --- |
| [convex/REGISTER_SCHEMA.md](../../convex/REGISTER_SCHEMA.md) | Human-readable file-by-file lock list |
| [scripts/README.md](../README.md) | All scripts |

Parent index: [README.md](../../README.md).
