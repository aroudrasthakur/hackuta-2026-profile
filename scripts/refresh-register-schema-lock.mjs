import { createHash } from "node:crypto";
import {
  copyFileSync,
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
const registerRoot = join(root, "..", "hackuta-2026-register");
const lockDir = join(root, "scripts", "register-schema-lock");

const LOCKED_CONVEX_IGNORE = new Set(["schema.ts"]);
const LOCKED_CONVEX_DIR_IGNORE = new Set(["admin", "_generated"]);
const EDITABLE_TABLES = [
  "applicationReviews",
  "admins",
  "applicationReviewLogs",
  "participants",
  "adminAuthAccounts",
  "adminSessions",
];

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function readText(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function skipBalanced(source, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === openChar) {
      depth += 1;
    } else if (source[i] === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  throw new Error(`Unbalanced ${openChar}${closeChar} in schema`);
}

function stripTableDefinition(source, tableName) {
  const marker = `${tableName}:`;
  const start = source.indexOf(marker);
  if (start === -1) {
    return source;
  }
  const defineIndex = source.indexOf("defineTable(", start);
  if (defineIndex === -1) {
    return source;
  }
  let pos = defineIndex + "defineTable(".length;
  if (source[pos] === "{") {
    pos = skipBalanced(source, pos, "{", "}");
  } else {
    pos = skipBalanced(source, pos, "(", ")");
  }
  if (source[pos] === ")") {
    pos += 1;
  }
  while (/^\s*\.index\s*\(/.test(source.slice(pos))) {
    const open = source.indexOf("(", pos);
    pos = skipBalanced(source, open, "(", ")");
  }
  while (source[pos] === "," || /\s/.test(source[pos])) {
    pos += 1;
  }
  return source.slice(0, start) + source.slice(pos);
}

function stripTablesForHash(source, tableNames) {
  const token = "defineSchema({";
  const start = source.indexOf(token);
  if (start === -1) {
    return source;
  }
  const openBrace = start + "defineSchema(".length;
  const end = skipBalanced(source, openBrace, "{", "}");
  let body = source.slice(start, end + 1);
  for (const tableName of tableNames) {
    body = stripTableDefinition(body, tableName);
  }
  return body;
}

function normalizeSchemaForHash(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function walkFiles(dir, filter) {
  const results = [];
  if (!existsSync(dir)) {
    return results;
  }
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      results.push(...walkFiles(absolute, filter));
    } else if (filter(absolute)) {
      results.push(absolute);
    }
  }
  return results;
}

function collectLockedFiles(sourceRoot) {
  const files = {};

  const convexFiles = walkFiles(join(sourceRoot, "convex"), (file) => {
    if (!file.endsWith(".ts")) {
      return false;
    }
    if (file.endsWith("README.md")) {
      return false;
    }
    const rel = relative(join(sourceRoot, "convex"), file).replace(/\\/g, "/");
    const top = rel.split("/")[0];
    if (LOCKED_CONVEX_IGNORE.has(rel) || LOCKED_CONVEX_DIR_IGNORE.has(top)) {
      return false;
    }
    return true;
  });

  for (const absolute of convexFiles) {
    const rel = relative(sourceRoot, absolute).replace(/\\/g, "/");
    files[rel] = sha256(readText(absolute));
  }

  const sharedFiles = walkFiles(
    join(sourceRoot, "shared"),
    (file) =>
      (file.endsWith(".ts") || file.endsWith(".csv")) && !file.endsWith("README.md"),
  );
  for (const absolute of sharedFiles) {
    const rel = relative(sourceRoot, absolute).replace(/\\/g, "/");
    files[rel] = sha256(readText(absolute));
  }

  return files;
}

function main() {
  if (!existsSync(registerRoot)) {
    console.error("Register repo not found at:", registerRoot);
    console.error("Expected sibling: ../hackuta-2026-register");
    process.exit(1);
  }

  mkdirSync(lockDir, { recursive: true });

  const registerSchema = join(registerRoot, "convex", "schema.ts");
  const referenceSchema = join(lockDir, "schema.reference.ts");
  const referenceHeader = `/**
 * Frozen copy of hackuta-2026-register/convex/schema.ts.
 * DO NOT EDIT — run npm run register-schema-lock:refresh to update from register.
 */
`;
  copyFileSync(registerSchema, join(lockDir, "schema.reference.raw.ts"));
  const schemaBody = readText(registerSchema);
  writeFileSync(referenceSchema, referenceHeader + schemaBody.replace(/^\/[\s\S]*?\*\/\n/, ""));

  const adminFiles = collectLockedFiles(root);
  const registerFiles = collectLockedFiles(registerRoot);
  const manifestFiles = {};

  for (const [rel, registerHash] of Object.entries(registerFiles)) {
    manifestFiles[rel] = registerHash;
    if (adminFiles[rel] && adminFiles[rel] !== registerHash) {
      console.warn(`Warning: admin ${rel} differs from register — copying register version into admin`);
      const src = join(registerRoot, rel);
      const dest = join(root, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    } else if (!adminFiles[rel]) {
      const src = join(registerRoot, rel);
      const dest = join(root, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
      console.log("Copied missing file:", rel);
    }
  }

  const adminSchema = readText(join(root, "convex", "schema.ts"));
  const registerSchemaLockedHash = sha256(
    normalizeSchemaForHash(
      stripTablesForHash(adminSchema, EDITABLE_TABLES),
    ),
  );

  const manifest = {
    source: "hackuta-2026-register",
    referenceSchema: "scripts/register-schema-lock/schema.reference.ts",
    registerSchemaPath: "convex/schema.ts",
    editableTables: EDITABLE_TABLES,
    registerSchemaLockedHash,
    files: manifestFiles,
  };

  writeFileSync(join(lockDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    unlinkSync(join(lockDir, "schema.reference.raw.ts"));
  } catch {
    // ignore
  }

  console.log(`Refreshed lock manifest (${Object.keys(manifestFiles).length} files).`);
}

main();
