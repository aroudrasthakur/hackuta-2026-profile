import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lockDir = join(root, "scripts", "register-schema-lock");
const manifestPath = join(lockDir, "manifest.json");
const schemaReferencePath = join(lockDir, "schema.reference.ts");
const adminSchemaPath = join(root, "convex", "schema.ts");

const ADMIN_EDITABLE_TABLES = [
  "applicationReviews",
  "admins",
  "applicationReviewLogs",
  "participants",
  "adminAuthAccounts",
  "adminSessions",
];
const REFERENCE_EDITABLE_TABLES = ["applicationReviews"];

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

function stripTableDefinitions(source, tableNames) {
  let result = source;
  for (const tableName of tableNames) {
    result = stripTableDefinition(result, tableName);
  }
  return result;
}

function normalizeSchemaBody(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSchemaBodyFixed(source) {
  const token = "defineSchema({";
  const start = source.indexOf(token);
  if (start === -1) {
    throw new Error("Could not find defineSchema({ in schema file");
  }
  const openBrace = start + "defineSchema(".length;
  const end = skipBalanced(source, openBrace, "{", "}");
  return source.slice(start, end + 1);
}

const ADMIN_SHARED_PREFIX = "shared/admin/";
const CONVEX_EXEMPT = new Set(["convex/schema.ts"]);
const CONVEX_EXEMPT_DIRS = new Set(["admin", "profile", "_generated"]);

function verifyLockedFiles(manifest) {
  const errors = [];
  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    const absolutePath = join(root, relativePath);
    if (!existsSync(absolutePath)) {
      errors.push(`Missing locked file: ${relativePath}`);
      continue;
    }
    const actualHash = sha256(readText(absolutePath));
    if (actualHash !== expectedHash) {
      errors.push(`Locked file changed: ${relativePath}`);
    }
  }
  return errors;
}

function verifyNoUnexpectedSharedFiles(manifest) {
  const errors = [];
  const locked = new Set(Object.keys(manifest.files));
  const sharedRoot = join(root, "shared");
  if (!existsSync(sharedRoot)) {
    return errors;
  }

  const stack = [sharedRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir)) {
      const absolute = join(dir, entry);
      const rel = relative(root, absolute).replace(/\\/g, "/");
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|csv|md|json)$/.test(entry)) {
        continue;
      }
      if (entry === "README.md" || rel.endsWith("/README.md")) {
        continue;
      }
      if (rel.startsWith(ADMIN_SHARED_PREFIX)) {
        continue;
      }
      if (!locked.has(rel)) {
        errors.push(
          `Untracked shared file not in lock manifest: ${rel} — add via register + refresh, or move to shared/admin/`,
        );
      }
    }
  }
  return errors;
}

function verifyNoUnexpectedConvexFiles(manifest) {
  const errors = [];
  const locked = new Set(Object.keys(manifest.files));
  const convexRoot = join(root, "convex");
  if (!existsSync(convexRoot)) {
    return errors;
  }

  const stack = [convexRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir)) {
      const absolute = join(dir, entry);
      const rel = relative(root, absolute).replace(/\\/g, "/");
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        const top = relative(convexRoot, absolute).split(/[/\\]/)[0];
        if (CONVEX_EXEMPT_DIRS.has(top)) {
          continue;
        }
        stack.push(absolute);
        continue;
      }
      if (!entry.endsWith(".ts")) {
        continue;
      }
      if (CONVEX_EXEMPT.has(rel) || entry === "README.md" || rel.endsWith("/README.md")) {
        continue;
      }
      if (rel === "convex/REGISTER_SCHEMA.md") {
        continue;
      }
      if (!locked.has(rel)) {
        errors.push(
          `Untracked convex file not in lock manifest: ${rel} — add via register + refresh, or place under convex/admin/`,
        );
      }
    }
  }
  return errors;
}

function verifyRegisterSchemaPortion(manifest) {
  const reference = readText(schemaReferencePath);
  const admin = readText(adminSchemaPath);

  const referenceBody = stripTableDefinitions(
    extractSchemaBodyFixed(reference),
    REFERENCE_EDITABLE_TABLES,
  );
  const adminBody = stripTableDefinitions(
    extractSchemaBodyFixed(admin),
    ADMIN_EDITABLE_TABLES,
  );

  const referenceNorm = normalizeSchemaBody(referenceBody);
  const adminNorm = normalizeSchemaBody(adminBody);

  if (manifest.registerSchemaLockedHash) {
    if (sha256(adminNorm) !== manifest.registerSchemaLockedHash) {
      return [
        "convex/schema.ts register-owned tables do not match the frozen reference",
        "Only admin-owned schema tables may differ — see convex/REGISTER_SCHEMA.md",
      ];
    }
    return [];
  }

  if (referenceNorm !== adminNorm) {
    return [
      "convex/schema.ts register-owned tables do not match scripts/register-schema-lock/schema.reference.ts",
      "Only admin-owned schema tables may differ — see convex/REGISTER_SCHEMA.md",
    ];
  }
  return [];
}

function main() {
  if (!existsSync(manifestPath)) {
    console.error("Missing manifest:", manifestPath);
    console.error("Run: npm run register-schema-lock:refresh");
    process.exit(1);
  }

  const manifest = JSON.parse(readText(manifestPath));
  const errors = [
    ...verifyLockedFiles(manifest),
    ...verifyNoUnexpectedSharedFiles(manifest),
    ...verifyNoUnexpectedConvexFiles(manifest),
    ...verifyRegisterSchemaPortion(manifest),
  ];

  if (errors.length > 0) {
    console.error("Register schema lock verification failed:\n");
    for (const error of errors) {
      console.error(`  • ${error}`);
    }
    console.error("\nSee convex/REGISTER_SCHEMA.md");
    process.exit(1);
  }

  const fileCount = Object.keys(manifest.files).length;
  console.log(
    `Register schema lock OK (${fileCount} locked files, register schema portion matches reference).`,
  );
}

main();
