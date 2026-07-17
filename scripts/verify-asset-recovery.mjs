#!/usr/bin/env node

import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {
  isPlatformAssetRecoveryStorageKey,
  platformAssetRecoveryReferences,
  verifyPartnerAssetRecovery
} from "../lib/asset-recovery.mjs";
import { loadDotEnv } from "../lib/load-env.mjs";

await loadDotEnv();

const { Client } = pg;
const recoveryUrl = String(process.env.SANDFEST_RECOVERY_DATABASE_URL || "").trim();
const sourceUrl = String(process.env.SANDFEST_DATABASE_URL || "").trim();
const configuredRecoveryDirectory = String(process.env.SANDFEST_RECOVERY_ASSET_DIR || "").trim();
const configuredSourceDirectory = String(process.env.SANDFEST_PARTNER_ASSET_DIR || "").trim();
const minimumFiles = Number(process.env.SANDFEST_RECOVERY_ASSET_MIN_FILES || 1);

function databaseIdentity(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.username}@${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return value;
  }
}

function sslConfig() {
  const mode = String(process.env.SANDFEST_RECOVERY_DATABASE_SSL || process.env.SANDFEST_DATABASE_SSL || "").toLowerCase();
  if (mode === "false" || mode === "disable") return false;
  if (mode === "no-verify") return { rejectUnauthorized: false };
  return recoveryUrl.includes("sslmode=disable") ? false : undefined;
}

function isWithin(root, candidate) {
  return candidate.startsWith(`${root}${path.sep}`);
}

if (!recoveryUrl) throw new Error("SANDFEST_RECOVERY_DATABASE_URL is required.");
if (!configuredRecoveryDirectory) throw new Error("SANDFEST_RECOVERY_ASSET_DIR is required.");
if (!Number.isSafeInteger(minimumFiles) || minimumFiles < 1) {
  throw new Error("SANDFEST_RECOVERY_ASSET_MIN_FILES must be a positive integer.");
}
if (sourceUrl && databaseIdentity(sourceUrl) === databaseIdentity(recoveryUrl)) {
  throw new Error("Asset recovery verification refuses to run against SANDFEST_DATABASE_URL. Use an isolated restored database.");
}

const recoveryDirectory = path.resolve(configuredRecoveryDirectory);
const sourceDirectory = configuredSourceDirectory ? path.resolve(configuredSourceDirectory) : null;
if (sourceDirectory && sourceDirectory === recoveryDirectory) {
  throw new Error("Asset recovery verification refuses the active SANDFEST_PARTNER_ASSET_DIR. Use an isolated restored asset directory.");
}

const recoveryRoot = await realpath(recoveryDirectory).catch(error => {
  if (error?.code === "ENOENT") throw new Error("SANDFEST_RECOVERY_ASSET_DIR does not exist.");
  throw error;
});
const rootInfo = await stat(recoveryRoot);
if (!rootInfo.isDirectory()) throw new Error("SANDFEST_RECOVERY_ASSET_DIR must be a directory.");
if (sourceDirectory) {
  const sourceRoot = await realpath(sourceDirectory).catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (sourceRoot && sourceRoot === recoveryRoot) {
    throw new Error("Asset recovery verification refuses the active SANDFEST_PARTNER_ASSET_DIR. Use an isolated restored asset directory.");
  }
}

async function readRestoredAsset(storageKey) {
  if (!isPlatformAssetRecoveryStorageKey(storageKey)) return { ok: false, reason: "unreadable" };
  const requestedPath = path.resolve(recoveryRoot, storageKey);
  if (!isWithin(recoveryRoot, requestedPath)) return { ok: false, reason: "unreadable" };
  let fileInfo;
  try {
    fileInfo = await lstat(requestedPath);
  } catch (error) {
    return { ok: false, reason: error?.code === "ENOENT" ? "missing" : "unreadable" };
  }
  if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) return { ok: false, reason: "unreadable" };
  const resolvedPath = await realpath(requestedPath).catch(() => null);
  if (!resolvedPath || !isWithin(recoveryRoot, resolvedPath)) return { ok: false, reason: "unreadable" };
  try {
    return { ok: true, buffer: await readFile(resolvedPath) };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

const client = new Client({ connectionString: recoveryUrl, ssl: sslConfig() });
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const result = await client.query("SELECT key, data FROM platform_documents WHERE key = ANY($1::text[])", [["partner-operations", "incoming-documents"]]);
  const documents = new Map(result.rows.map(row => [row.key, row.data]));
  if (!documents.has("partner-operations")) throw new Error("Recovery database is missing the partner-operations platform document.");
  if (!documents.has("incoming-documents")) throw new Error("Recovery database is missing the incoming-documents platform document.");

  const extraction = platformAssetRecoveryReferences(documents.get("partner-operations"), documents.get("incoming-documents"));
  const verification = await verifyPartnerAssetRecovery(extraction, readRestoredAsset, { minimumFiles });
  await client.query("ROLLBACK");
  if (!verification.ok) {
    const sample = verification.issues.slice(0, 5).map(issue => `${issue.type}:${issue.storageKey || issue.collection || "assets"}`).join(", ");
    throw new Error(
      `Asset recovery verification failed: ${verification.counts.verified}/${verification.counts.referenced} files verified; ` +
      `${verification.counts.missing} missing, ${verification.counts.mismatched} mismatched, ` +
      `${verification.counts.unreadable} unreadable, ${verification.counts.invalid} invalid metadata.${sample ? ` Issues: ${sample}` : ""}`
    );
  }

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    mode: "read-only",
    database: "restored",
    assetDirectory: "restored",
    assets: {
      referenced: verification.counts.referenced,
      verified: verification.counts.verified,
      uploadRecords: verification.counts.uploadRecords,
      brandAssets: verification.counts.brandAssets,
      vendorDocuments: verification.counts.vendorDocuments,
      incomingDocuments: verification.counts.incomingDocuments,
      externalReferences: verification.counts.externalReferences,
      bytes: verification.counts.bytes,
      minimumFiles: verification.minimumFiles,
      manifestSha256: verification.manifestSha256
    }
  }));
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end().catch(() => {});
}
