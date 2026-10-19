import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/** Locked register snapshots that omit a final newline in the upstream repo. */
const WHITESPACE_EXCEPTIONS = new Set(["convex/auth.config.ts"]);

const extensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".css",
  ".html",
]);

const files = execSync("git ls-files", { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((file) => {
    const dot = file.lastIndexOf(".");
    if (dot === -1) {
      return false;
    }
    return extensions.has(file.slice(dot));
  });

const missing = [];

for (const file of files) {
  if (!existsSync(file) || WHITESPACE_EXCEPTIONS.has(file)) {
    continue;
  }
  const content = readFileSync(file);
  if (content.length === 0) {
    continue;
  }
  if (content[content.length - 1] !== 0x0a) {
    missing.push(file);
  }
}

if (missing.length > 0) {
  console.error("Missing trailing newline at EOF:");
  for (const file of missing) {
    console.error(`  ${file}`);
  }
  process.exit(1);
}

console.log(`Whitespace OK (${files.length} files checked).`);
