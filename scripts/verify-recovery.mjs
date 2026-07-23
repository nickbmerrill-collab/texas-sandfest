#!/usr/bin/env node

import pg from "pg";
import { DEFAULT_EVENT_ID } from "../lib/event-context.mjs";
import { loadDotEnv } from "../lib/load-env.mjs";
import {
  RECOVERY_REQUIRED_CONFIG_DOCUMENT_KEYS,
  RECOVERY_REQUIRED_PLATFORM_DOCUMENTS,
  RECOVERY_REQUIRED_TABLE_COLUMNS,
  evaluateRecoveryDataContract,
  evaluateRecoverySchemaContract
} from "../lib/recovery-contract.mjs";

await loadDotEnv();

const { Client } = pg;
const recoveryUrl = String(process.env.SANDFEST_RECOVERY_DATABASE_URL || "").trim();
const sourceUrl = String(process.env.SANDFEST_DATABASE_URL || "").trim();
const expectedEventId = String(
  process.env.SANDFEST_RECOVERY_EVENT_ID
  || process.env.SANDFEST_EVENT_ID
  || DEFAULT_EVENT_ID
).trim();
const requiredTables = Object.keys(RECOVERY_REQUIRED_TABLE_COLUMNS);
const requiredPlatformDocuments = RECOVERY_REQUIRED_PLATFORM_DOCUMENTS.map(item => item.storageKey);

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

if (!recoveryUrl) throw new Error("SANDFEST_RECOVERY_DATABASE_URL is required.");
if (sourceUrl && databaseIdentity(sourceUrl) === databaseIdentity(recoveryUrl)) {
  throw new Error("Recovery verification refuses to run against SANDFEST_DATABASE_URL. Use an isolated restored database.");
}

const client = new Client({ connectionString: recoveryUrl, ssl: sslConfig() });
try {
  await client.connect();
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const columnsResult = await client.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position`,
    [requiredTables]
  );
  const tableColumns = new Map();
  for (const row of columnsResult.rows) {
    const columns = tableColumns.get(row.table_name) || new Set();
    columns.add(row.column_name);
    tableColumns.set(row.table_name, columns);
  }
  const schemaContract = evaluateRecoverySchemaContract(tableColumns);
  if (!schemaContract.ok) {
    throw new Error(`Recovery verification failed: ${schemaContract.errors.join(" ")}`);
  }
  const configResult = await client.query(
    `SELECT key, data, updated_at::text AS "updatedAt"
       FROM config_documents
      WHERE key = ANY($1::text[])
      ORDER BY key`,
    [RECOVERY_REQUIRED_CONFIG_DOCUMENT_KEYS]
  );
  const platformResult = await client.query(
    `SELECT key, data, updated_at::text AS "updatedAt"
       FROM platform_documents
      WHERE key = ANY($1::text[])
      ORDER BY key`,
    [requiredPlatformDocuments]
  );

  const counts = {};
  for (const table of requiredTables) {
    const result = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
    counts[table] = result.rows[0].count;
  }
  const contract = evaluateRecoveryDataContract({
    tableColumns,
    configDocuments: configResult.rows,
    platformDocuments: platformResult.rows,
    expectedEventId,
    counts
  });
  if (!contract.ok) {
    throw new Error(`Recovery verification failed: ${contract.errors.join(" ")}`);
  }
  await client.query("ROLLBACK");
  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    mode: "read-only",
    isolation: "repeatable-read",
    contractVersion: contract.contractVersion,
    eventId: contract.eventId,
    requiredTables: contract.requiredTables,
    requiredColumns: contract.requiredColumns,
    requiredConfigDocuments: contract.requiredConfigDocuments,
    requiredOperationalDocuments: contract.requiredOperationalDocuments,
    databaseManifestSha256: contract.databaseManifestSha256,
    checks: contract.checks,
    counts
  }));
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end().catch(() => {});
}
