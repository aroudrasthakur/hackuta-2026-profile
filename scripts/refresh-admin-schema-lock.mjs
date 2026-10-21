import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const adminRoot = join(root, "..", "hackuta-2026-admin");
const lockDir = join(root, "scripts", "admin-schema-lock");
const profileAdminDir = join(root, "convex", "admin");
const sourceAdminDir = join(adminRoot, "convex", "admin");
const profileSharedAdminDir = join(root, "shared", "admin");
const sourceSharedAdminDir = join(adminRoot, "shared", "admin");

/** Profile portal helpers that do not exist in the admin repo. */
const PROFILE_ONLY_SHARED_ADMIN = new Set([
  "weekendSchedule.ts",
  "submissionDisplay.ts",
]);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function readText(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function walkTs(dir, base, files = []) {
  if (!existsSync(dir)) {
    return files;
  }
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walkTs(path, base, files);
      continue;
    }
    if (path.endsWith(".ts")) {
      files.push(relative(base, path).replace(/\\/g, "/"));
    }
  }
  return files;
}

function syncFile(sourcePath, destPath) {
  const next = readText(sourcePath);
  const body = next.endsWith("\n") ? next : `${next}\n`;
  if (existsSync(destPath) && readText(destPath) === body) {
    return;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, body);
  console.log("Copied", relative(root, destPath).replace(/\\/g, "/"));
}

function syncTsTree(sourceDir, destDir, { keepRelative = new Set() } = {}) {
  const sourceFiles = walkTs(sourceDir, sourceDir);
  const sourceSet = new Set(sourceFiles);
  for (const rel of walkTs(destDir, destDir)) {
    if (sourceSet.has(rel) || keepRelative.has(rel)) {
      continue;
    }
    unlinkSync(join(destDir, rel));
    console.log("Removed profile-only", relative(root, join(destDir, rel)).replace(/\\/g, "/"));
  }
  for (const rel of sourceFiles) {
    syncFile(join(sourceDir, rel), join(destDir, rel));
  }
}

if (!existsSync(adminRoot)) {
  console.error("Admin repo not found at:", adminRoot);
  console.error("Expected sibling: ../hackuta-2026-admin");
  process.exit(1);
}

syncTsTree(sourceAdminDir, profileAdminDir);
syncFile(join(adminRoot, "convex", "schema.ts"), join(root, "convex", "schema.ts"));
syncTsTree(sourceSharedAdminDir, profileSharedAdminDir, {
  keepRelative: PROFILE_ONLY_SHARED_ADMIN,
});

const files = walkTs(profileAdminDir, profileAdminDir).sort();
const manifest = {};
for (const rel of files) {
  manifest[`convex/admin/${rel}`] = sha256(readText(join(profileAdminDir, rel)));
}

mkdirSync(lockDir, { recursive: true });
writeFileSync(join(lockDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${files.length} admin lock entries from the profile copies.`);
