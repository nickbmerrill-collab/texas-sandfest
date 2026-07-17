#!/usr/bin/env node

import pg from "pg";
import { loadDotEnv } from "../lib/load-env.mjs";

await loadDotEnv();

const { Client } = pg;
const recoveryUrl = String(process.env.SANDFEST_RECOVERY_DATABASE_URL || "").trim();
const sourceUrl = String(process.env.SANDFEST_DATABASE_URL || "").trim();
const requiredTables = [
  "admin_audit_events",
  "config_documents",
  "config_snapshots",
  "fulfillment_records",
  "hunt_completions",
  "orders",
  "payment_events",
  "peoples_choice_votes",
  "platform_documents",
  "platform_jobs"
];
const requiredConfigDocuments = ["admin-config", "app-bootstrap", "emergency-alert", "ticket-products"];

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
  await client.query("BEGIN READ ONLY");
  const tablesResult = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
    [requiredTables]
  );
  const presentTables = new Set(tablesResult.rows.map(row => row.table_name));
  const missingTables = requiredTables.filter(table => !presentTables.has(table));
  if (missingTables.length) throw new Error(`Recovery database is missing required tables: ${missingTables.join(", ")}`);

  const configResult = await client.query("SELECT key FROM config_documents WHERE key = ANY($1::text[])", [requiredConfigDocuments]);
  const presentConfig = new Set(configResult.rows.map(row => row.key));
  const missingConfigDocuments = requiredConfigDocuments.filter(key => !presentConfig.has(key));
  if (missingConfigDocuments.length) throw new Error(`Recovery database is missing required configuration: ${missingConfigDocuments.join(", ")}`);

  const counts = {};
  for (const table of requiredTables) {
    const result = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
    counts[table] = result.rows[0].count;
  }
  await client.query("ROLLBACK");
  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    mode: "read-only",
    requiredTables: requiredTables.length,
    requiredConfigDocuments: requiredConfigDocuments.length,
    counts
  }));
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end().catch(() => {});
}
