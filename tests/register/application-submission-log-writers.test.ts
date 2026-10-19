import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TABLE = "applicationSubmissionLogs";
const CONVEX_ROOT = path.resolve(import.meta.dirname, "../../convex");

/** A write of the log table. Whitespace lets the call span more than one line. */
const WRITE = new RegExp(
  String.raw`db\s*\.\s*(?:insert|patch|replace|delete)\s*\(\s*["']${TABLE}["']`,
  "g",
);

type SourceFile = { name: string; source: string };

async function readConvexSources(): Promise<SourceFile[]> {
  const files = await listTypeScriptFiles(CONVEX_ROOT);
  return Promise.all(files.map(async (file) => ({
    name: path.relative(CONVEX_ROOT, file),
    source: await readFile(file, "utf8"),
  })));
}

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(fullPath);
    return entry.name.endsWith(".ts") ? [fullPath] : [];
  }));
  return nested.flat();
}

/** One file name per match, so two hits in one file show up twice. */
function filesMatching(sources: SourceFile[], pattern: RegExp) {
  return sources.flatMap(({ name, source }) =>
    [...source.matchAll(pattern)].map(() => name),
  );
}

/** Guards the log table so only the submit mutation can write it. */
describe("application submission log writers", () => {
  it("mentions the log table only as the schema key and one write in registrations.ts", async () => {
    const sources = await readConvexSources();

    // Schema defines the table. registrations.ts is the only other mention.
    const mentions = filesMatching(sources, new RegExp(TABLE, "g"));
    expect(mentions.sort()).toEqual(["registrations.ts", "schema.ts"]);

    // Exactly one insert, patch, replace, or delete, and it lives in registrations.ts.
    expect(filesMatching(sources, WRITE)).toEqual(["registrations.ts"]);
  });
});
