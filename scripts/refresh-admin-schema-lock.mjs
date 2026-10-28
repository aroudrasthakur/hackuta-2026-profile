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

function walkFiles(dir, base, extensions, files = []) {
  if (!existsSync(dir)) {
    return files;
  }
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walkFiles(path, base, extensions, files);
      continue;
    }
    if (extensions.some((ext) => path.endsWith(ext))) {
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

function syncTree(sourceDir, destDir, { keepRelative = new Set(), extensions = [".ts"] } = {}) {
  const sourceFiles = walkFiles(sourceDir, sourceDir, extensions);
  const sourceSet = new Set(sourceFiles);
  for (const rel of walkFiles(destDir, destDir, extensions)) {
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

syncTree(sourceAdminDir, profileAdminDir, { extensions: [".ts", ".md"] });
syncFile(join(adminRoot, "convex", "schema.ts"), join(root, "convex", "schema.ts"));
syncTree(sourceSharedAdminDir, profileSharedAdminDir, {
  keepRelative: PROFILE_ONLY_SHARED_ADMIN,
});

const files = walkFiles(profileAdminDir, profileAdminDir, [".ts", ".md"]).sort();
const manifest = {};
for (const rel of files) {
  manifest[`convex/admin/${rel}`] = sha256(readText(join(profileAdminDir, rel)));
}

mkdirSync(lockDir, { recursive: true });
writeFileSync(join(lockDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${files.length} admin lock entries from the profile copies.`);
