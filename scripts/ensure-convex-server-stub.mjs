import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = join(root, "convex", "_generated");
const serverTarget = join(targetDir, "server.ts");
const apiTarget = join(targetDir, "api.ts");
const serverSource = join(root, "scripts", "convex-server-stub.ts");
const apiSource = join(root, "scripts", "convex-api-stub.ts");

mkdirSync(targetDir, { recursive: true });
const serverStub = readFileSync(serverSource, "utf8").replace(
  '"../convex/lib/dataModel.js"',
  '"../lib/dataModel.js"',
);
writeFileSync(serverTarget, serverStub);
writeFileSync(apiTarget, readFileSync(apiSource, "utf8"));
