# Build and ops scripts (`scripts/`)

Node scripts invoked from npm lifecycle hooks, local setup, or CI. Not imported by the app at runtime.

## Overview

| Script | When to run | Summary |
| --- | --- | --- |
| [ensure-convex-server-stub.mjs](ensure-convex-server-stub.mjs) | pretypecheck, prebuild | Writes the typed local stub to convex/_generated/server.ts |
| [convex-server-stub.ts](convex-server-stub.ts) | (via ensure script) | Convex server builders typed against the local schema for offline typechecks |
| [check-whitespace.mjs](check-whitespace.mjs) | npm run check:whitespace, CI | Fails if tracked text files lack a final newline |
| [verify-register-schema-lock.mjs](verify-register-schema-lock.mjs) | npm run verify:register-schema-lock, preconvex:push-dev, preconvex:deploy, CI | Hash-checks register-frozen files and schema body |
| [verify-admin-schema-lock.mjs](verify-admin-schema-lock.mjs) | npm run verify:admin-schema-lock, preconvex:push-dev, preconvex:deploy, CI | Hash-checks convex/admin against the admin lock manifest |
| [refresh-admin-schema-lock.mjs](refresh-admin-schema-lock.mjs) | npm run admin-schema-lock:refresh | Copies admin convex/admin, schema.ts, and shared/admin into this repo, then rewrites the manifest |
| [refresh-register-schema-lock.mjs](refresh-register-schema-lock.mjs) | npm run register-schema-lock:refresh | Re-copies lock manifest from sibling register repo. Do not run while register production is frozen unless that repo shipped a backend change |
| [register-schema-lock/](register-schema-lock/README.md) | (frozen artifacts) | manifest.json + schema.reference.ts (code files only) |

## Convex codegen workflow

| Step | Command |
| --- | --- |
| Live codegen (push + bindings) | npm run convex:dev or npm run convex:codegen |
| Offline typecheck / build | pretypecheck/prebuild runs ensure-convex-server-stub.mjs |
| Push to shared dev | npm run convex:push-dev (register + admin locks first) |
| Deploy production | npm run convex:deploy (same locks first) |

Generated API types land in convex/_generated/ (gitignored). See [convex/README.md](../convex/README.md).

## Register schema lock

| Step | Command |
| --- | --- |
| Verify frozen files | npm run verify:register-schema-lock |
| Refresh from register | npm run register-schema-lock:refresh — only after register ships a backend change |
| Refresh admin copies | npm run admin-schema-lock:refresh |

See [convex/REGISTER_SCHEMA.md](../convex/REGISTER_SCHEMA.md) and [register-schema-lock/README.md](register-schema-lock/README.md).

## Related

| Location | Role |
| --- | --- |
| [package.json](../package.json) | npm script entry points |
| [README.md](../README.md) | Local setup and Convex deploy checklist |

Parent index: [README.md](../README.md).
