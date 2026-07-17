#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eventContextConfig } from "../lib/event-context.mjs";
import { loadDotEnv } from "../lib/load-env.mjs";
import { readPlatformDoc, updatePlatformDoc } from "../lib/platform-data.mjs";
import { resolveRuntimeRoot } from "../lib/runtime-root.mjs";
import {
  applyVolunteerLocalImport,
  parseVolunteerLocalBundle,
  volunteerLocalBundleHash,
  volunteerLocalImportPreviewHash,
  volunteerLocalMirrorFingerprint
} from "../lib/volunteer-import.mjs";

await loadDotEnv();

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolveRuntimeRoot(CODE_ROOT);
const args = process.argv.slice(2);
const rosterPath = args.find(arg => !arg.startsWith("--"));
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const shiftsPath = option("shifts");
const hoursPath = option("hours");
const expectedPreviewHash = option("preview-hash");
const commit = args.includes("--commit");

if (!rosterPath) {
  throw new Error("Usage: npm run import:volunteers -- roster.csv [--shifts=shifts.csv] [--hours=hours.csv] [--commit --preview-hash=<hash>]");
}

async function optionalFile(filePath) {
  return filePath ? readFile(path.resolve(filePath), "utf8") : "";
}

const bundle = {
  rosterCsv: await readFile(path.resolve(rosterPath), "utf8"),
  shiftsCsv: await optionalFile(shiftsPath),
  hoursCsv: await optionalFile(hoursPath)
};
const defaults = { eventId: eventContextConfig(process.env).eventId };
const parsed = parseVolunteerLocalBundle(bundle, defaults);
if (!parsed.ok) throw new Error(parsed.error);
const fileNames = {
  roster: path.basename(rosterPath),
  shifts: shiftsPath ? path.basename(shiftsPath) : null,
  hours: hoursPath ? path.basename(hoursPath) : null
};

if (!commit) {
  const current = await readPlatformDoc(ROOT, "volunteers", {
    eventId: defaults.eventId,
    volunteers: [],
    shifts: [],
    hourLogs: [],
    zoneLabels: {},
    imports: []
  });
  const previewHash = volunteerLocalImportPreviewHash(bundle, {
    ...defaults,
    mirrorFingerprint: volunteerLocalMirrorFingerprint(current)
  });
  const result = applyVolunteerLocalImport(current, parsed, {
    previewHash,
    batchId: `preview_${previewHash.slice(0, 12)}`,
    fileNames
  });
  if (!result.ok) throw new Error(result.error);
  console.log(JSON.stringify({
    mode: "preview",
    eventId: defaults.eventId,
    previewHash,
    summary: result.summary,
    errors: result.errors.slice(0, 100),
    next: `Re-run with --commit --preview-hash=${previewHash}`
  }, null, 2));
  process.exit(0);
}

let result;
await updatePlatformDoc(ROOT, "volunteers", current => {
  const currentDoc = current || {
    eventId: defaults.eventId,
    volunteers: [],
    shifts: [],
    hourLogs: [],
    zoneLabels: {},
    imports: []
  };
  const bundleHash = volunteerLocalBundleHash(bundle, defaults);
  const previousImport = (Array.isArray(currentDoc.imports) ? currentDoc.imports : [])
    .find(item => item.previewHash === expectedPreviewHash);
  if (previousImport && previousImport.bundleHash === bundleHash) {
    result = applyVolunteerLocalImport(currentDoc, parsed, {
      commit: true,
      previewHash: expectedPreviewHash,
      bundleHash,
      batchId: `volunteerlocal_import_${randomUUID()}`,
      actorId: process.env.USER || "cli",
      fileNames,
      now: new Date().toISOString()
    });
    return currentDoc;
  }
  const previewHash = volunteerLocalImportPreviewHash(bundle, {
    ...defaults,
    mirrorFingerprint: volunteerLocalMirrorFingerprint(currentDoc)
  });
  if (expectedPreviewHash !== previewHash) {
    result = { ok: false, error: "The CSV bundle or volunteer mirror changed. Run the preview again and pass its exact --preview-hash value." };
    return currentDoc;
  }
  result = applyVolunteerLocalImport(currentDoc, parsed, {
    commit: true,
    previewHash: expectedPreviewHash,
    bundleHash,
    batchId: `volunteerlocal_import_${randomUUID()}`,
    actorId: process.env.USER || "cli",
    fileNames,
    now: new Date().toISOString()
  });
  return result?.ok ? result.doc : currentDoc;
}, {
  fallback: {
    eventId: defaults.eventId,
    volunteers: [],
    shifts: [],
    hourLogs: [],
    zoneLabels: {},
    imports: []
  }
});
if (!result?.ok) throw new Error(result?.error || "VolunteerLocal import failed.");
console.log(JSON.stringify({
  mode: "commit",
  eventId: defaults.eventId,
  previewHash: expectedPreviewHash,
  replay: result.replay,
  batchId: result.importRecord?.id || null,
  summary: result.summary,
  errors: result.errors.slice(0, 100)
}, null, 2));
