#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eventContextConfig } from "../lib/event-context.mjs";
import { loadDotEnv } from "../lib/load-env.mjs";
import { readPlatformDoc, updatePlatformDoc } from "../lib/platform-data.mjs";
import { resolveRuntimeRoot } from "../lib/runtime-root.mjs";
import { SANDFEST_STAFF_DIRECTORY_SOURCES } from "../lib/staff-directory.mjs";
import { applyStaffDirectoryImport, parseStaffDirectoryImport } from "../lib/staff-directory-import.mjs";

await loadDotEnv();

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolveRuntimeRoot(CODE_ROOT);
const args = process.argv.slice(2);
const inputPath = args.find(value => !value.startsWith("--"));
const sourceArg = args.find(value => value.startsWith("--source="));
const source = String(sourceArg?.slice("--source=".length) || "").trim().toLowerCase();
const commit = args.includes("--commit");
const eventId = eventContextConfig(process.env).eventId;

if (!inputPath || !source) {
  throw new Error("Usage: npm run import:staff -- path/to/staff.json --source=manual_verified [--commit]");
}
if (!SANDFEST_STAFF_DIRECTORY_SOURCES.includes(source)) {
  throw new Error(`Staff source must be one of: ${SANDFEST_STAFF_DIRECTORY_SOURCES.join(", ")}.`);
}
if (commit && process.env.SANDFEST_ENV === "production" && !process.env.SANDFEST_DATABASE_URL) {
  throw new Error("Production staff imports require SANDFEST_DATABASE_URL; file-mode production writes are refused.");
}

const contents = await readFile(inputPath, "utf8");
const now = new Date().toISOString();
const parsed = parseStaffDirectoryImport(contents, {
  eventId,
  source,
  fileName: path.basename(inputPath),
  now
});
if (!parsed.ok) throw new Error(parsed.error);
let result;
if (commit) {
  await updatePlatformDoc(ROOT, "staffDirectory", current => {
    const preview = applyStaffDirectoryImport(current, parsed, { now });
    result = applyStaffDirectoryImport(current, parsed, {
      commit: true,
      expectedPreviewHash: preview.previewHash,
      actorId: "staff-import-cli",
      now
    });
    return result.ok ? result.doc : undefined;
  }, { fallback: null });
} else {
  const existing = await readPlatformDoc(ROOT, "staffDirectory", null);
  result = applyStaffDirectoryImport(existing, parsed, { now });
}
if (!result?.ok) throw new Error(result?.error || "Staff directory could not be imported.");

console.log(JSON.stringify({
  ok: true,
  committed: commit,
  eventId,
  source,
  commitAllowed: result.commitAllowed !== false,
  commitBlockReason: result.commitBlockReason || null,
  activeStaff: result.readiness.activeStaff,
  routedTeams: result.readiness.routedTeams,
  totalTeams: result.readiness.totalTeams,
  staff: result.publicDirectory.staff,
  teams: result.publicDirectory.teams
}, null, 2));
