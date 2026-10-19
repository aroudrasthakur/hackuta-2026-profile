import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const adminRoot = join(root, "..", "hackuta-2026-admin");
const lockDir = join(root, "scripts", "admin-schema-lock");
const profileAdminDir = join(root, "convex", "admin");
const sourceAdminDir = join(adminRoot, "convex", "admin");

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function readText(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function walk(dir, base, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, base, files);
      continue;
    }
    if (path.endsWith(".ts")) {
      files.push(relative(base, path).replace(/\\/g, "/"));
    }
  }
  return files;
}

const files = walk(profileAdminDir, profileAdminDir).sort();
const manifest = {};
for (const rel of files) {
  const sourcePath = join(sourceAdminDir, rel);
  manifest[`convex/admin/${rel}`] = sha256(readText(sourcePath));
}

mkdirSync(lockDir, { recursive: true });
writeFileSync(join(lockDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${files.length} admin lock entries.`);
