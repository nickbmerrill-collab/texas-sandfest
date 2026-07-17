#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyEventenyBoothImport,
  eventenyBoothBundleHash,
  eventenyBoothImportPreviewHash,
  eventenyBoothMirrorFingerprint,
  parseEventenyBoothCsv
} from "../lib/booth-import.mjs";
import { eventContextConfig } from "../lib/event-context.mjs";
import { loadDotEnv } from "../lib/load-env.mjs";
import { readPlatformDoc, updatePlatformDoc } from "../lib/platform-data.mjs";
import { resolveRuntimeRoot } from "../lib/runtime-root.mjs";

await loadDotEnv();

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolveRuntimeRoot(CODE_ROOT);
const args = process.argv.slice(2);
const inputPath = args.find(arg => !arg.startsWith("--"));
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const expectedPreviewHash = option("preview-hash");
const commit = args.includes("--commit");
const currentEventConfirmed = args.includes("--current-event-confirmed");

if (!inputPath) {
  throw new Error("Usage: npm run import:booths -- booths.csv [--commit --preview-hash=<hash> --current-event-confirmed]");
}
if (commit && !currentEventConfirmed) {
  throw new Error("Commit requires --current-event-confirmed after verifying the export belongs to the current SandFest event.");
}
if (commit && !expectedPreviewHash) {
  throw new Error("Commit requires the exact --preview-hash printed by a preview of the unchanged file.");
}

const bundle = { csv: await readFile(path.resolve(inputPath), "utf8") };
const defaults = { eventId: eventContextConfig(process.env).eventId };
const parsed = parseEventenyBoothCsv(bundle.csv, defaults);
if (!parsed.ok) throw new Error(parsed.error);
const fileName = path.basename(inputPath);
const fallback = { eventId: defaults.eventId, source: "empty", lastUpdated: null, booths: [], vendors: [], imports: [] };

if (!commit) {
  const current = await readPlatformDoc(ROOT, "booths", fallback);
  const previewHash = eventenyBoothImportPreviewHash(bundle, {
    ...defaults,
    mirrorFingerprint: eventenyBoothMirrorFingerprint(current)
  });
  const result = applyEventenyBoothImport(current, parsed, {
    previewHash,
    batchId: `preview_${previewHash.slice(0, 12)}`,
    fileName
  });
  if (!result.ok) throw new Error(result.error);
  console.log(JSON.stringify({
    mode: "preview",
    eventId: defaults.eventId,
    previewHash,
    summary: result.summary,
    errors: result.errors.slice(0, 100),
    next: `Re-run with --commit --preview-hash=${previewHash} --current-event-confirmed`
  }, null, 2));
  process.exit(0);
}

let result;
await updatePlatformDoc(ROOT, "booths", current => {
  const currentDoc = current || fallback;
  const bundleHash = eventenyBoothBundleHash(bundle, defaults);
  const previousImport = (Array.isArray(currentDoc.imports) ? currentDoc.imports : [])
    .find(item => item.previewHash === expectedPreviewHash);
  if (previousImport && previousImport.bundleHash === bundleHash) {
    result = applyEventenyBoothImport(currentDoc, parsed, {
      commit: true,
      previewHash: expectedPreviewHash,
      bundleHash,
      batchId: `eventeny_booths_${randomUUID()}`,
      actorId: process.env.USER || "cli",
      fileName,
      now: new Date().toISOString()
    });
    return currentDoc;
  }
  const previewHash = eventenyBoothImportPreviewHash(bundle, {
    ...defaults,
    mirrorFingerprint: eventenyBoothMirrorFingerprint(currentDoc)
  });
  if (expectedPreviewHash !== previewHash) {
    result = { ok: false, error: "The CSV or booth mirror changed. Run preview again and pass its exact --preview-hash value." };
    return currentDoc;
  }
  result = applyEventenyBoothImport(currentDoc, parsed, {
    commit: true,
    previewHash: expectedPreviewHash,
    bundleHash,
    batchId: `eventeny_booths_${randomUUID()}`,
    actorId: process.env.USER || "cli",
    fileName,
    now: new Date().toISOString()
  });
  return result?.ok ? result.doc : currentDoc;
}, { fallback });

if (!result?.ok) throw new Error(result?.error || "Eventeny booth import failed.");
console.log(JSON.stringify({
  mode: "commit",
  eventId: defaults.eventId,
  previewHash: expectedPreviewHash,
  replay: result.replay,
  batchId: result.importRecord?.id || null,
  summary: result.summary,
  errors: result.errors.slice(0, 100)
}, null, 2));
