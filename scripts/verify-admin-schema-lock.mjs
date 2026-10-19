import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "scripts", "admin-schema-lock", "manifest.json");

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function readText(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

if (!existsSync(manifestPath)) {
  console.error("Missing admin schema lock manifest. Run npm run admin-schema-lock:refresh");
  process.exit(1);
}

const manifest = JSON.parse(readText(manifestPath));
const failures = [];

for (const [relPath, expectedHash] of Object.entries(manifest)) {
  const path = join(root, relPath);
  if (!existsSync(path)) {
    failures.push(`${relPath}: missing file`);
    continue;
  }
  const actual = sha256(readText(path));
  if (actual !== expectedHash) {
    failures.push(`${relPath}: hash mismatch`);
  }
}

if (failures.length > 0) {
  console.error("Admin schema lock verification failed:\n" + failures.map((line) => `- ${line}`).join("\n"));
  process.exit(1);
}

console.log(`Admin schema lock OK (${Object.keys(manifest).length} files).`);
