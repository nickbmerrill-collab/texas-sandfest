#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import twilio from "twilio";
import { emptyBudgetControl } from "../lib/budget-control.mjs";
import { REQUIRED_TICKET_POLICY_NOTICES } from "../lib/ticket-policy-schema.mjs";
import { BOARD_DEMO_VENDOR_OFFERINGS } from "../lib/vendor-offerings.mjs";
import { issueTaskPortalToken, taskPortalConfig } from "../lib/task-portal.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_URL = process.env.SANDFEST_POSTGRES_TEST_ADMIN_URL || "postgresql:///postgres?sslmode=disable";
const EVENT_ID = "texas-sandfest-2027";
const TOKEN = "postgres-test-admin-token-change-me";
const BREVO_WEBHOOK_TOKEN = "postgres-test-brevo-webhook-token-0123456789";
const CAMERA_SECRET = "postgres-test-camera-secret-0123456789abcdef0123456789abcdef";
const CAMERA_KEY_ID = "ferry-loading-v1";
const CAMERA_KEYS = JSON.stringify({
  [CAMERA_KEY_ID]: { cameraId: "ferry-loading", secret: CAMERA_SECRET },
  "north-gate-v1": { cameraId: "north-gate", secret: "postgres-north-camera-secret-0123456789abcdef0123456789" }
});
const { Client } = pg;

let passed = 0;
let failed = 0;
let apiChild = null;
let databaseName = null;
let databaseUrl = null;
let partnerAssetDir = null;
let incomingDocumentDir = null;
let recoveryAssetDir = null;
let stripeMock = null;
let emailMock = null;
let twilioMock = null;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok ${name}${detail ? ` - ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  not ok ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function clientFor(connectionString) {
  return new Client({
    connectionString,
    ssl: connectionString.includes("sslmode=disable") ? false : undefined
  });
}

function followupProviderTag(followupId) {
  return `followup-${String(followupId || "")}`.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 50);
}

function databaseUrlFor(adminUrl, name) {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

function assertSafeAdminUrl(adminUrl) {
  const parsed = new URL(adminUrl);
  const localHosts = new Set(["", "localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(parsed.hostname) && process.env.SANDFEST_POSTGRES_TEST_ALLOW_REMOTE !== "true") {
    throw new Error("Postgres tests only create databases on localhost unless SANDFEST_POSTGRES_TEST_ALLOW_REMOTE=true.");
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function runChild(args, env, label) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`${label} exited ${code}:\n${output}`);
  return output;
}

async function startApi(port, env) {
  const child = spawn(process.execPath, ["scripts/admin-api-server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, ...env, SANDFEST_API_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  let settled = false;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!settled) reject(new Error(`Postgres API start timed out:\n${output}`));
    }, 12_000);
    const onData = chunk => {
      output += chunk;
      if (!settled && output.includes("listening")) {
        settled = true;
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", reject);
    child.once("exit", code => {
      if (!settled) reject(new Error(`Postgres API exited ${code}:\n${output}`));
    });
  });
  child.testOutput = () => output;
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise(resolve => setTimeout(resolve, 5_000))
  ]);
  if (child.exitCode == null) child.kill("SIGKILL");
}

async function startStripeMock() {
  let sessionNumber = 0;
  const requests = [];
  const server = createHttpServer((request, response) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      requests.push({ method: request.method, url: request.url, headers: request.headers, body });
      sessionNumber += 1;
      const id = `cs_partner_postgres_${String(sessionNumber).padStart(3, "0")}`;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id,
        object: "checkout.session",
        url: `https://checkout.stripe.com/c/pay/${id}`,
        expires_at: Number(body.get("expires_at"))
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

async function startEmailMock() {
  const deliveries = [];
  const server = createHttpServer((request, response) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const messageId = `brevo_postgres_${String(deliveries.length + 1).padStart(3, "0")}`;
      deliveries.push({ method: request.method, url: request.url, headers: request.headers, body, messageId });
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ messageId }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    endpoint: `http://127.0.0.1:${port}/v3/smtp/email`,
    deliveries,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

async function startTwilioMock() {
  const deliveries = [];
  const server = createHttpServer((request, response) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const sid = `SM_postgres_${String(deliveries.length + 1).padStart(3, "0")}`;
      deliveries.push({ method: request.method, url: request.url, headers: request.headers, body, sid });
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ sid, status: "queued" }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    deliveries,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

async function request(base, method, pathname, body, { auth = false, rawBody = null, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (auth) requestHeaders.authorization = `Bearer ${TOKEN}`;
  let payload;
  if (rawBody !== null) {
    payload = rawBody;
    requestHeaders["content-type"] = "application/json";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    requestHeaders["content-type"] = "application/json";
  }
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: requestHeaders,
    body: payload
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function requestDownload(base, pathname) {
  const response = await fetch(`${base}${pathname}`, {
    headers: { authorization: `Bearer ${TOKEN}` }
  });
  return {
    status: response.status,
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "",
    disposition: response.headers.get("content-disposition") || ""
  };
}

async function requestUpload(base, pathname, body, headers = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers,
    body
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function requestTwilioForm(base, pathname, publicUrl, params, signature = null) {
  const body = new URLSearchParams(params).toString();
  const form = Object.fromEntries(new URLSearchParams(body));
  const response = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature || twilio.getExpectedTwilioSignature("postgres-twilio-auth-secret", publicUrl, form)
    },
    body
  });
  return { status: response.status, body: await response.text() };
}

async function cleanupDatabase() {
  if (!databaseName) return;
  const admin = clientFor(ADMIN_URL);
  await admin.connect();
  try {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName]
    );
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await admin.end();
  }
}

async function main() {
  assertSafeAdminUrl(ADMIN_URL);
  databaseName = `sandfest_pgtest_${process.pid}_${randomBytes(4).toString("hex")}`;
  databaseUrl = databaseUrlFor(ADMIN_URL, databaseName);
  partnerAssetDir = await mkdtemp(path.join(tmpdir(), "sandfest-postgres-brand-assets-"));
  incomingDocumentDir = path.join(partnerAssetDir, "incoming-documents");
  stripeMock = await startStripeMock();
  emailMock = await startEmailMock();
  twilioMock = await startTwilioMock();

  const admin = clientFor(ADMIN_URL);
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await admin.end();

  const commonEnv = {
    SANDFEST_DATABASE_URL: databaseUrl,
    SANDFEST_DATABASE_SSL: "false",
    SANDFEST_ADMIN_API_TOKEN: TOKEN,
    SANDFEST_ADMIN_ROLE: "super_admin",
    SANDFEST_ADMIN_ACTOR_ID: "postgres-test-admin",
    SANDFEST_ADMIN_RATE_LIMIT: "1000",
    SANDFEST_PUBLIC_WRITE_RATE_LIMIT: "500",
    SANDFEST_PARTNER_STATUS_RATE_LIMIT: "200",
    SANDFEST_ENV: "development",
    SANDFEST_EVENT_ID: "texas-sandfest-2027",
    SANDFEST_PARTNER_PORTAL_SECRET: "postgres-test-partner-portal-secret-0123456789",
    SANDFEST_OUTREACH_PREFERENCES_SECRET: "postgres-test-outreach-preferences-secret-0123456789",
    OUTREACH_DISCOVERY_ENABLED: "true",
    OUTREACH_DISCOVERY_PROVIDER: "fixture",
    SANDFEST_PUBLIC_SITE_URL: "https://www.texassandfest.org",
    SANDFEST_PARTNER_ASSET_DIR: partnerAssetDir,
    SANDFEST_INCOMING_DOCUMENT_DIR: incomingDocumentDir,
    CAMERA_INGEST_ENABLED: "true",
    CAMERA_INGEST_KEYS: CAMERA_KEYS,
    CAMERA_INGEST_SECRET: "",
    STRIPE_TICKETING_ENABLED: "true",
    STRIPE_PARTNER_PAYMENTS_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_postgres_partner",
    STRIPE_WEBHOOK_SECRET: "whsec_postgres_partner",
    STRIPE_PARTNER_SUCCESS_URL: "https://www.texassandfest.org/#partner-payment-success?session_id={CHECKOUT_SESSION_ID}",
    STRIPE_PARTNER_CANCEL_URL: "https://www.texassandfest.org/#partner-status",
    STRIPE_SUCCESS_URL: "https://www.texassandfest.org/tickets/success?session_id={CHECKOUT_SESSION_ID}",
    STRIPE_CANCEL_URL: "https://www.texassandfest.org/#tickets",
    STRIPE_API_BASE_URL: stripeMock.baseUrl,
    TRANSACTIONAL_EMAIL_ENABLED: "true",
    BREVO_API_KEY: "postgres-brevo-api-key",
    BREVO_SENDER_EMAIL: "partners@texassandfest.org",
    BREVO_SENDER_NAME: "Texas SandFest",
    BREVO_REPLY_TO_EMAIL: "info@texassandfest.org",
    BREVO_API_ENDPOINT: emailMock.endpoint,
    BREVO_WEBHOOK_TOKEN,
    QB_INVOICE_SYNC_ENABLED: "false",
    SMS_ENABLED: "true",
    TWILIO_ACCOUNT_SID: "AC_postgres_test",
    TWILIO_AUTH_TOKEN: "postgres-twilio-auth-secret",
    TWILIO_FROM_NUMBER: "+15125550000",
    TWILIO_API_BASE_URL: twilioMock.baseUrl
  };

  console.log("\n=== Postgres schema and transaction safety ===\n");
  const schemaProbe = `
    import { ensureSchema, closePool } from "./lib/db/pool.mjs";
    await Promise.all(Array.from({ length: 8 }, () => ensureSchema()));
    await closePool();
  `;
  const schemaRuns = await Promise.all(Array.from({ length: 4 }, (_, index) =>
    runChild(["--input-type=module", "--eval", schemaProbe], commonEnv, `schema process ${index + 1}`)
  ));
  check("concurrent schema boot", schemaRuns.length === 4, "4 processes x 8 callers");

  process.env.SANDFEST_DATABASE_URL = databaseUrl;
  process.env.SANDFEST_DATABASE_SSL = "false";
  const {
    appendPassportCompletion,
    listPassportCompletions,
    listVotes,
    readPlatformDoc,
    updatePlatformDoc,
    upsertVote,
    writePlatformDoc
  } = await import("../lib/platform-data.mjs");
  const { closePool, getPool } = await import("../lib/db/pool.mjs");
  const { emptyPartnerOperations } = await import("../lib/partner-ops.mjs");
  const { claimNextJobs, completeJob, enqueueJob, getQueueHealth, listJobs, markTerminalJobHandled } = await import("../lib/job-queue.mjs");
  const { signCameraPayload } = await import("../lib/camera-ingest.mjs");
  const {
    beginQuickBooksAuthorization,
    completeQuickBooksAuthorization,
    loadQuickBooksRuntimeCredentials,
    persistQuickBooksTokenRotation,
    readQuickBooksCredentialStatus
  } = await import("../lib/quickbooks/credentials.mjs");

  const pool = await getPool();
  const postgresAdminConfig = JSON.parse(await readFile(path.join(ROOT, "data", "config", "admin-config.json"), "utf8"));
  postgresAdminConfig.vendorOfferings = structuredClone(BOARD_DEMO_VENDOR_OFFERINGS);
  await pool.query(
    `INSERT INTO config_documents (key, data, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    ["admin-config", JSON.stringify(postgresAdminConfig)]
  );
  const quickBooksEnv = {
    ...commonEnv,
    QB_ENVIRONMENT: "sandbox",
    QB_INVOICE_SYNC_ENABLED: "true",
    QB_CLIENT_ID: "postgres-quickbooks-client",
    QB_CLIENT_SECRET: "postgres-quickbooks-secret",
    QB_REDIRECT_URI: "http://127.0.0.1:8787/api/integrations/quickbooks/callback",
    QB_TOKEN_ENCRYPTION_KEY: "postgres-quickbooks-encryption-key-0123456789",
    QB_TOKEN_URL: "http://127.0.0.1:9999/oauth/tokens"
  };
  await pool.query("DELETE FROM platform_documents WHERE key = $1", ["quickbooks-credentials"]);
  const quickBooksStartedAt = Date.now();
  const quickBooksAuthorization = await beginQuickBooksAuthorization(ROOT, { actorId: "postgres-finance-admin", now: quickBooksStartedAt }, quickBooksEnv);
  const quickBooksState = new URL(quickBooksAuthorization.authorizationUrl).searchParams.get("state");
  await completeQuickBooksAuthorization(ROOT, {
    state: quickBooksState,
    code: "postgres-private-code",
    realmId: "postgres-private-realm",
    now: quickBooksStartedAt + 1_000,
    fetchImpl: async () => new Response(JSON.stringify({
      access_token: "postgres-private-access-token",
      refresh_token: "postgres-private-refresh-token",
      x_refresh_token_expires_in: 8_726_400
    }), { status: 200, headers: { "content-type": "application/json" } })
  }, quickBooksEnv);
  const quickBooksRow = await pool.query("SELECT data::text AS source FROM platform_documents WHERE key = $1", ["quickbooks-credentials"]);
  const quickBooksStatus = await readQuickBooksCredentialStatus(ROOT, quickBooksEnv);
  check("QuickBooks OAuth credential is encrypted in Postgres", quickBooksStatus.connected && quickBooksStatus.canSyncPartnerInvoices && quickBooksStatus.credentialStorage === "postgres" && quickBooksRow.rows.length === 1 && quickBooksRow.rows[0].source.includes("aes-256-gcm") && !quickBooksRow.rows[0].source.includes("postgres-private-refresh-token") && !quickBooksRow.rows[0].source.includes(quickBooksState));
  const quickBooksRuntime = await loadQuickBooksRuntimeCredentials(ROOT, quickBooksEnv);
  const quickBooksRotation = await persistQuickBooksTokenRotation(ROOT, quickBooksRuntime, {
    refresh_token: "postgres-private-rotated-token",
    x_refresh_token_expires_in: 8_726_400
  }, { now: quickBooksStartedAt + 2_000 }, quickBooksEnv);
  const quickBooksRotatedRow = await pool.query("SELECT data::text AS source FROM platform_documents WHERE key = $1", ["quickbooks-credentials"]);
  const quickBooksRotatedRuntime = await loadQuickBooksRuntimeCredentials(ROOT, quickBooksEnv);
  check("QuickBooks token rotation is durable and plaintext-free in Postgres", quickBooksRotation.changed && quickBooksRotatedRuntime.tokenVersion === quickBooksRuntime.tokenVersion + 1 && quickBooksRotatedRuntime.env.QB_REFRESH_TOKEN === "postgres-private-rotated-token" && !quickBooksRotatedRow.rows[0].source.includes("postgres-private-rotated-token"));
  await pool.query("DELETE FROM hunt_completions");
  await pool.query("DELETE FROM peoples_choice_votes");
  const oldHuntCompletions = await appendPassportCompletion(ROOT, {
    id: "hc-postgres-2026",
    huntId: "sculpture-passport-2026",
    checkpointId: "checkpoint-2026",
    attendeeRef: "attendee-2026",
    pointsAwarded: 1,
    at: "2026-04-18T12:00:00.000Z"
  });
  const currentHuntCompletions = await appendPassportCompletion(ROOT, {
    id: "hc-postgres-2027",
    huntId: "sculpture-passport-2027",
    checkpointId: "checkpoint-2027",
    attendeeRef: "attendee-2027",
    pointsAwarded: 1,
    at: "2027-04-18T12:00:00.000Z"
  });
  const oldVotes = await upsertVote(ROOT, {
    id: "vote-postgres-2026",
    eventId: "texas-sandfest-2026",
    entryId: "entry-2026",
    attendeeRef: "voter-2026",
    at: "2026-04-18T12:00:00.000Z"
  });
  const currentVotes = await upsertVote(ROOT, {
    id: "vote-postgres-2027",
    eventId: "texas-sandfest-2027",
    entryId: "entry-2027",
    attendeeRef: "voter-2027",
    at: "2027-04-18T12:00:00.000Z"
  });
  const scopedHuntCompletions = await listPassportCompletions(ROOT, { huntId: "sculpture-passport-2027" });
  const scopedVotes = await listVotes(ROOT, { eventId: "texas-sandfest-2027" });
  check(
    "passport rows are scoped to one annual hunt",
    oldHuntCompletions.length === 1 && currentHuntCompletions.length === 1 && scopedHuntCompletions[0]?.id === "hc-postgres-2027"
  );
  check(
    "voting rows are scoped to one annual event",
    oldVotes.length === 1 && currentVotes.length === 1 && scopedVotes[0]?.id === "vote-postgres-2027"
  );
  await pool.query("DELETE FROM hunt_completions");
  await pool.query("DELETE FROM peoples_choice_votes");
  await pool.query("DELETE FROM platform_documents WHERE key = $1", ["partner-operations"]);
  const firstWrite = updatePlatformDoc(ROOT, "partnerOps", async current => {
    await new Promise(resolve => setTimeout(resolve, 80));
    return { ...current, coldStartProbe: Number(current?.coldStartProbe || 0) + 1 };
  }, { fallback: { coldStartProbe: 0 } });
  await new Promise(resolve => setTimeout(resolve, 20));
  const coldRead = readPlatformDoc(ROOT, "partnerOps", {});
  await Promise.all([firstWrite, coldRead]);
  const coldStartDoc = await readPlatformDoc(ROOT, "partnerOps", {});
  check("cold read preserves first write", coldStartDoc.coldStartProbe === 1, `expected 1, got ${coldStartDoc.coldStartProbe}`);

  await pool.query("DELETE FROM platform_documents WHERE key = $1", ["partner-operations"]);
  await Promise.all(Array.from({ length: 24 }, (_, index) =>
    updatePlatformDoc(ROOT, "partnerOps", async current => {
      await new Promise(resolve => setTimeout(resolve, (index % 5) * 3));
      return { ...current, concurrencyProbe: Number(current?.concurrencyProbe || 0) + 1 };
    }, { fallback: { concurrencyProbe: 0 } })
  ));
  const concurrentDoc = await readPlatformDoc(ROOT, "partnerOps", {});
  check("first-write document lock", concurrentDoc.concurrencyProbe === 24, `expected 24, got ${concurrentDoc.concurrencyProbe}`);
  await writePlatformDoc(ROOT, "partnerOps", emptyPartnerOperations());
  const staffVerifiedAt = new Date().toISOString();
  await writePlatformDoc(ROOT, "staffDirectory", {
    schemaVersion: 1,
    eventId: EVENT_ID,
    source: "manual_verified",
    lastUpdated: staffVerifiedAt,
    verifiedAt: staffVerifiedAt,
    staff: [{
      id: "staff_command",
      eventId: EVENT_ID,
      name: "Postgres Incident Commander",
      email: "postgres-traffic@example.com",
      status: "active",
      roles: ["incident_command"],
      teams: ["operations", "sponsor", "finance", "volunteer-captains", "traffic", "guest-services", "production"]
    }],
    teamRoutes: ["operations", "sponsor", "finance", "volunteer-captains", "traffic", "guest-services", "production"]
      .map(teamId => ({ teamId, notificationOwnerId: "staff_command" }))
  });
  await writePlatformDoc(ROOT, "consent", { eventId: EVENT_ID, lastUpdated: null, records: [] });
  await writePlatformDoc(ROOT, "booths", { eventId: EVENT_ID, lastUpdated: null, source: "empty", booths: [], vendors: [], imports: [] });
  await writePlatformDoc(ROOT, "budgetControl", emptyBudgetControl(EVENT_ID));
  const { emptyIncomingDocumentIntake } = await import("../lib/incoming-documents.mjs");
  await writePlatformDoc(ROOT, "incomingDocuments", emptyIncomingDocumentIntake(EVENT_ID));
  const { emptySmsOperations } = await import("../lib/sms-operations.mjs");
  await writePlatformDoc(ROOT, "smsOperations", emptySmsOperations(EVENT_ID));
  await writePlatformDoc(ROOT, "passportHunt", {
    lastUpdated: new Date().toISOString(),
    hunt: {
      id: "sculpture-passport-2027",
      eventId: EVENT_ID,
      name: "Postgres engagement test",
      type: "passport",
      startsAt: "2027-04-16T09:00:00-05:00",
      endsAt: "2027-04-18T19:30:00-05:00",
      active: true
    },
    checkpoints: [{
      id: "cp_ent_dune_dragon",
      huntId: "sculpture-passport-2027",
      label: "Reviewed test sculpture",
      kind: "sculpture",
      linkedRecord: { type: "sculptureEntry", id: "ent_dune_dragon" },
      code: "TSF-PG-0001",
      points: 10,
      order: 1,
      beachMarker: "12.5",
      entryId: "ent_dune_dragon"
    }]
  });
  await writePlatformDoc(ROOT, "voting", {
    lastUpdated: new Date().toISOString(),
    eventId: EVENT_ID,
    publicationStatus: "published",
    source: "reviewed_current_roster",
    votingOpen: true,
    title: "People's Choice test ballot",
    description: "Reviewed Postgres workflow fixture.",
    entries: [
      { id: "ent_lace_tide", title: "Reviewed entry one", sculptorName: "Reviewed artist one", division: "semi_pro", beachMarker: "14.5", eligible: true },
      { id: "ent_tidal_guardian", title: "Reviewed entry two", sculptorName: "Reviewed artist two", division: "master_solo", beachMarker: "13", eligible: true }
    ],
    votes: []
  });
  await closePool();

  console.log("\n=== Postgres API workflows ===\n");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  commonEnv.TWILIO_STATUS_CALLBACK_URL = `${base}/api/webhooks/twilio/status`;
  commonEnv.TWILIO_SAFETY_INBOUND_WEBHOOK_URL = `${base}/api/webhooks/twilio/inbound/smsSafety`;
  commonEnv.TWILIO_MARKETING_INBOUND_WEBHOOK_URL = `${base}/api/webhooks/twilio/inbound/smsMarketing`;
  apiChild = await startApi(port, commonEnv);

  const health = await request(base, "GET", "/health");
  check("API health uses Postgres", health.status === 200 && health.data.storage === "postgres", `status ${health.status}`);
  const ready = await request(base, "GET", "/ready");
  check("API ready uses Postgres", ready.status === 200 && ready.data.checks?.storage === "postgres", `status ${ready.status}`);
  const unauthenticated = await request(base, "GET", "/api/admin/partners");
  check("admin auth enforced", unauthenticated.status === 401, `status ${unauthenticated.status}`);

  const postgresGuideCheckedAt = new Date(Date.now() - 1_000).toISOString();
  const postgresGuidePublish = await request(base, "POST", "/api/admin/event-guide/publish", {
    publish: true,
    guide: {
      startDate: "2027-04-16",
      endDate: "2027-04-18",
      dailyOpen: "09:00",
      dailyClose: "19:30",
      location: "On the beach, Port Aransas, TX 78373",
      mission: "The largest beach sand sculpture competition in the USA, supporting local nonprofits and scholarships.",
      phone: "361-267-2474",
      email: "info@texassandfest.org",
      address: "200 S. Alister Street, Suite E, Port Aransas, TX 78373",
      sourceUrl: "https://www.texassandfest.org/knowbeforeyougo",
      sourceCheckedAt: postgresGuideCheckedAt
    }
  }, { auth: true });
  const postgresPublicGuide = await request(base, "GET", "/api/public/bootstrap");
  check("event guide publish persists in Postgres", postgresGuidePublish.status === 200 && postgresGuidePublish.data.readiness?.ready === true && postgresPublicGuide.data.guide?.sourceCheckedAt === postgresGuideCheckedAt && !("publishedBy" in postgresPublicGuide.data.guide));

  const postgresDocumentBytes = Buffer.from("Postgres board packet\nPrivate source record\n", "utf8");
  const postgresDocumentHeaders = {
    authorization: `Bearer ${TOKEN}`,
    "content-type": "text/plain",
    "x-file-name": "postgres-board-packet.txt",
    "x-document-domain": "docs",
    "x-document-title": "Postgres board packet",
    "x-owner-team": "operations",
    "x-document-review-due-at": "2027-01-20T18:00:00.000Z"
  };
  const [postgresDocumentUploadA, postgresDocumentUploadB] = await Promise.all([
    requestUpload(base, "/api/admin/documents/upload", postgresDocumentBytes, postgresDocumentHeaders),
    requestUpload(base, "/api/admin/documents/upload", postgresDocumentBytes, postgresDocumentHeaders)
  ]);
  const postgresDocuments = await request(base, "GET", "/api/admin/documents", undefined, { auth: true });
  const postgresDocument = postgresDocuments.data.documents?.[0];
  const postgresDocumentReview = await request(base, "PATCH", `/api/admin/documents/${encodeURIComponent(postgresDocument?.id || "missing")}`, {
    status: "in_review",
    ownerTeam: "operations",
    notes: "Validated through the Postgres metadata plane."
  }, { auth: true });
  const postgresDocumentWorkspace = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const postgresDocumentTasks = postgresDocumentWorkspace.data.tasks?.filter(item => item.relatedEntityType === "incoming_document" && item.relatedEntityId === postgresDocument?.id) || [];
  const postgresDocumentDownload = await requestDownload(base, `/api/admin/documents/${encodeURIComponent(postgresDocument?.id || "missing")}/content`);
  const postgresBoardBriefingBytes = await readFile(path.join(ROOT, "docs", "presentations", "SandFest-Board-Platform-Briefing.pptx"));
  const postgresBoardBriefingUpload = await requestUpload(base, "/api/admin/documents/upload", postgresBoardBriefingBytes, {
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "x-file-name": "SandFest-Board-Platform-Briefing.pptx",
    "x-document-domain": "docs",
    "x-document-title": "SandFest board platform briefing",
    "x-owner-team": "operations",
    "x-document-review-due-at": "2027-01-22T18:00:00.000Z"
  });
  check("concurrent document uploads converge in Postgres", [postgresDocumentUploadA, postgresDocumentUploadB].filter(item => item.status === 201).length === 1 && [postgresDocumentUploadA, postgresDocumentUploadB].filter(item => item.status === 200 && item.data.duplicate === true).length === 1 && postgresDocuments.data.summary?.total === 1);
  check("Postgres document metadata excludes private storage paths", postgresDocuments.status === 200 && postgresDocument?.textPreview.includes("Postgres board packet") && !("storageKey" in (postgresDocument || {})) && postgresDocument?.checksumSha256?.length === 64);
  check("Postgres document review creates one durable task", postgresDocumentTasks.length === 1 && postgresDocumentTasks[0]?.status === "in_progress" && postgresDocumentTasks[0]?.assigneeId === "operations" && postgresDocumentReview.data.document?.reviewTask?.id === postgresDocumentTasks[0]?.id);
  check("Postgres document review and controlled download", postgresDocumentReview.status === 200 && postgresDocumentReview.data.document?.status === "in_review" && postgresDocumentReview.data.document?.reviewedBy === "postgres-test-admin" && postgresDocumentDownload.status === 200 && postgresDocumentDownload.body.equals(postgresDocumentBytes) && postgresDocumentDownload.disposition.includes("postgres-board-packet.txt"));
  check("Postgres binary document queues private extraction", postgresBoardBriefingUpload.status === 201 && postgresBoardBriefingUpload.data.document?.extractionStatus === "queued" && postgresBoardBriefingUpload.data.extractionJob?.status === "queued" && !JSON.stringify(postgresBoardBriefingUpload.data.document).includes("extractionChunks"));
  await updatePlatformDoc(ROOT, "partnerOps", current => ({
    ...current,
    tasks: current.tasks.filter(task => task.relatedEntityType !== "incoming_document" || task.relatedEntityId !== postgresDocument.id)
  }), { fallback: emptyPartnerOperations(EVENT_ID) });

  const postgresSponsorCatalog = await request(base, "GET", "/api/public/sponsors");
  const postgresSponsorCreateBody = {
    id: "postgres-community-champion",
    name: "Postgres Community Champion",
    amount: 750000,
    benefits: ["Community stage recognition"],
    stripePriceId: "price_postgres_community_champion",
    quickBooksItemId: "postgres-community-champion-item"
  };
  const postgresSponsorCreates = await Promise.all([
    request(base, "POST", "/api/admin/sponsor-packages", postgresSponsorCreateBody, { auth: true }),
    request(base, "POST", "/api/admin/sponsor-packages", postgresSponsorCreateBody, { auth: true })
  ]);
  const postgresInvalidSponsorPatch = await request(base, "PATCH", "/api/admin/sponsor-packages/tarpon", {
    benefits: []
  }, { auth: true });
  const postgresSponsorPackagePatch = await request(base, "PATCH", "/api/admin/sponsor-packages/tarpon", {
    quickBooksItemId: "postgres-sponsor-tarpon-item",
    stripePriceId: "price_postgres_sponsor_tarpon"
  }, { auth: true });
  const postgresPublicSponsorCatalog = await request(base, "GET", "/api/public/sponsors");
  const postgresPublicTarpon = postgresPublicSponsorCatalog.data.sponsorPackages?.find(item => item.id === "tarpon");
  const postgresPublicCommunityChampion = postgresPublicSponsorCatalog.data.sponsorPackages?.find(item => item.id === "postgres-community-champion");
  check("sponsor package catalog reads from Postgres", postgresSponsorCatalog.status === 200 && postgresSponsorCatalog.data.sponsorPackages?.find(item => item.id === "tarpon")?.amount === 500000);
  check("concurrent sponsor package creation is atomic in Postgres", postgresSponsorCreates.map(item => item.status).sort((a, b) => a - b).join(",") === "201,409" && postgresPublicCommunityChampion?.amount === 750000);
  check("sponsor package config validates and keeps accounting private", postgresInvalidSponsorPatch.status === 400 && postgresSponsorPackagePatch.status === 200 && postgresSponsorPackagePatch.data.sponsorPackage?.quickBooksItemId === "postgres-sponsor-tarpon-item" && postgresPublicTarpon?.amount === 500000 && !Object.hasOwn(postgresPublicTarpon || {}, "quickBooksItemId") && !Object.hasOwn(postgresPublicTarpon || {}, "stripePriceId") && !Object.hasOwn(postgresPublicCommunityChampion || {}, "quickBooksItemId") && !Object.hasOwn(postgresPublicCommunityChampion || {}, "stripePriceId"));

  const postgresVendorCatalog = await request(base, "GET", "/api/public/vendors");
  const postgresVendorOfferingCreateBody = {
    id: "postgres-premium-marketplace",
    name: "Postgres premium marketplace",
    amount: 250000,
    categories: ["retail", "artisan"],
    description: "Expanded marketplace booth for larger retail and artisan activations.",
    inclusions: ["Expanded booth footprint", "Published booth listing"],
    stripePriceId: "price_postgres_premium_marketplace",
    quickBooksItemId: "postgres-premium-marketplace-item"
  };
  const postgresVendorOfferingCreates = await Promise.all([
    request(base, "POST", "/api/admin/vendor-offerings", postgresVendorOfferingCreateBody, { auth: true }),
    request(base, "POST", "/api/admin/vendor-offerings", postgresVendorOfferingCreateBody, { auth: true })
  ]);
  const postgresVendorOfferingPatch = await request(base, "PATCH", "/api/admin/vendor-offerings/marketplace-booth", {
    quickBooksItemId: "postgres-vendor-marketplace-item"
  }, { auth: true });
  const postgresPublicVendorCatalog = await request(base, "GET", "/api/public/vendors");
  const postgresPublicPremiumMarketplace = postgresPublicVendorCatalog.data.vendorOfferings?.find(item => item.id === "postgres-premium-marketplace");
  check("vendor offering catalog reads from Postgres", postgresVendorCatalog.status === 200 && postgresVendorCatalog.data.vendorOfferings?.find(item => item.id === "marketplace-booth")?.amount === 125000);
  check("concurrent vendor offering creation is atomic in Postgres", postgresVendorOfferingCreates.map(item => item.status).sort((a, b) => a - b).join(",") === "201,409" && postgresPublicPremiumMarketplace?.amount === 250000);
  check("vendor offering config persists without exposing accounting IDs", postgresVendorOfferingPatch.status === 200 && postgresVendorOfferingPatch.data.vendorOffering?.quickBooksItemId === "postgres-vendor-marketplace-item" && !Object.hasOwn(postgresPublicVendorCatalog.data.vendorOfferings?.find(item => item.id === "marketplace-booth") || {}, "quickBooksItemId") && !Object.hasOwn(postgresPublicPremiumMarketplace || {}, "quickBooksItemId") && !Object.hasOwn(postgresPublicPremiumMarketplace || {}, "stripePriceId"));

  const postgresStaffContents = JSON.stringify({
    eventId: EVENT_ID,
    staff: [{
      id: "staff_command",
      eventId: EVENT_ID,
      name: "Postgres Incident Commander",
      email: "postgres-traffic@example.com",
      status: "active",
      roles: ["incident_command"],
      teams: ["operations", "sponsor", "finance", "volunteer-captains", "traffic", "guest-services", "production"]
    }],
    teamRoutes: ["operations", "sponsor", "finance", "volunteer-captains", "traffic", "guest-services", "production"]
      .map(teamId => ({ teamId, notificationOwnerId: "staff_command" }))
  });
  const postgresStaffPayload = {
    contents: postgresStaffContents,
    fileName: "staff-directory-postgres.json",
    source: "hr_import",
    currentEventConfirmed: true
  };
  const postgresStaffPreview = await request(base, "POST", "/api/admin/staff-directory/import", { ...postgresStaffPayload, mode: "preview" }, { auth: true });
  const [postgresStaffCommitA, postgresStaffCommitB] = await Promise.all([
    request(base, "POST", "/api/admin/staff-directory/import", { ...postgresStaffPayload, mode: "commit", previewHash: postgresStaffPreview.data.previewHash }, { auth: true }),
    request(base, "POST", "/api/admin/staff-directory/import", { ...postgresStaffPayload, mode: "commit", previewHash: postgresStaffPreview.data.previewHash }, { auth: true })
  ]);
  const postgresStaffDoc = await readPlatformDoc(ROOT, "staffDirectory", null);
  const postgresStaffWorkspace = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const postgresStaleStaffCommit = await request(base, "POST", "/api/admin/staff-directory/import", {
    ...postgresStaffPayload,
    contents: `${postgresStaffContents}\n`,
    mode: "commit",
    previewHash: postgresStaffPreview.data.previewHash
  }, { auth: true });
  check("staff directory preview stays private on Postgres", postgresStaffPreview.status === 200 && postgresStaffPreview.data.commitAllowed === true && postgresStaffPreview.data.summary?.activeStaff === 1 && postgresStaffPreview.data.summary?.routedTeams === 7 && !JSON.stringify(postgresStaffPreview.data).includes("postgres-traffic@example.com"));
  check("concurrent staff directory commits converge once", [postgresStaffCommitA, postgresStaffCommitB].filter(item => item.status === 201).length === 1 && [postgresStaffCommitA, postgresStaffCommitB].filter(item => item.status === 200 && item.data.replay === true).length === 1 && postgresStaffDoc?.imports?.length === 1 && postgresStaffDoc?.source === "hr_import");
  check("staff directory import activates governed routing without exposing contacts", postgresStaffWorkspace.data.staffDirectory?.ready === true && postgresStaffWorkspace.data.assignmentDirectory?.teams?.every(item => item.notificationReady === true) && postgresStaffWorkspace.data.assignmentDirectory?.staff?.every(item => !("email" in item)) && postgresStaleStaffCommit.status === 409);

  const postgresBoothCsv = `booth_id,event_id,vendor_id,eventeny_id,business_name,category,type,zone,booth_status,vendor_status,public,coi_status,map_x,map_y,fee
PG-B-01,${EVENT_ID},PG-EV-V-01,PG-EV-V-01,Postgres Booth Vendor,retail,vendor,postgres-row,assigned,approved,,,18,28,1250.00`;
  const postgresBoothPayload = { csv: postgresBoothCsv, fileName: "eventeny-booths-postgres.csv", currentEventConfirmed: true };
  const postgresBoothPreview = await request(base, "POST", "/api/admin/booths/import", { ...postgresBoothPayload, mode: "preview" }, { auth: true });
  const [postgresBoothCommitA, postgresBoothCommitB] = await Promise.all([
    request(base, "POST", "/api/admin/booths/import", { ...postgresBoothPayload, mode: "commit", previewHash: postgresBoothPreview.data.previewHash }, { auth: true }),
    request(base, "POST", "/api/admin/booths/import", { ...postgresBoothPayload, mode: "commit", previewHash: postgresBoothPreview.data.previewHash }, { auth: true })
  ]);
  const postgresBoothMap = await request(base, "GET", "/api/admin/booths", undefined, { auth: true });
  const postgresImportedBooth = postgresBoothMap.data.booths?.find(item => item.id === "PG-B-01");
  check("booth import preview is non-mutating on Postgres", postgresBoothPreview.status === 200 && postgresBoothPreview.data.summary?.booths?.created === 1 && /^[a-f0-9]{64}$/.test(postgresBoothPreview.data.previewHash || ""));
  check("concurrent booth commits converge in one Postgres transaction", [postgresBoothCommitA, postgresBoothCommitB].filter(item => item.status === 201).length === 1 && [postgresBoothCommitA, postgresBoothCommitB].filter(item => item.status === 200 && item.data.replay === true).length === 1 && postgresBoothMap.data.imports?.length === 1 && postgresBoothMap.data.booths?.filter(item => item.id === "PG-B-01").length === 1);
  check("Postgres booth import fails private and incomplete", postgresImportedBooth?.vendor?.public === false && postgresImportedBooth?.docsReady === false && postgresBoothMap.data.summary?.totals?.publicPins === 0);

  const postgresVendorBodies = Array.from({ length: 12 }, (_, index) => ({
      organizationName: `Postgres Vendor ${index + 1}`,
      contactName: `Vendor Contact ${index + 1}`,
      contactEmail: `vendor${index + 1}@postgres-test.example`,
      category: "artisan",
      vendorOfferingId: "marketplace-booth",
      consentToContact: true
  }));
  const postgresVendorKeys = postgresVendorBodies.map((_, index) => `postgres-vendor-intake-${String(index + 1).padStart(4, "0")}`);
  const vendorRequests = postgresVendorBodies.map((body, index) => request(
    base,
    "POST",
    "/api/public/vendor-applications",
    body,
    { headers: { "idempotency-key": postgresVendorKeys[index] } }
  ));
  const concurrentVendorReplay = request(base, "POST", "/api/public/vendor-applications", postgresVendorBodies[0], {
    headers: { "idempotency-key": postgresVendorKeys[0] }
  });
  const sponsorRequest = request(base, "POST", "/api/public/sponsor-inquiries", {
    organizationName: "Postgres Coastal Resort",
    contactName: "Sponsor Contact",
    contactEmail: "sponsor@postgres-test.example",
    packageId: "tarpon",
    consentToContact: true
  }, { headers: { "idempotency-key": "postgres-sponsor-intake-0001" } });
  const intakes = await Promise.all([...vendorRequests, concurrentVendorReplay, sponsorRequest]);
  const intakeStatuses = intakes.map((item, index) => `${index + 1}:${item.status}:${item.data.duplicate === true ? "replay" : item.data.error || "created"}`);
  check("concurrent partner intake", intakes.filter(item => item.status === 201).length === 13 && intakes.filter(item => item.status === 200 && item.data.duplicate).length === 1, `${intakes.filter(item => item.status === 201).length} created, ${intakes.filter(item => item.data.duplicate).length} replayed; ${intakeStatuses.join(", ")}`);
  const sponsorIntake = intakes.at(-1);
  const sponsorStatus = await request(base, "POST", "/api/public/partner-status", {
    reference: sponsorIntake.data.application?.reference,
    token: sponsorIntake.data.portalAccess?.token
  });
  check("partner portal reads Postgres", sponsorStatus.status === 200 && sponsorStatus.data.application?.finance?.expectedAmountCents > 0, `status ${sponsorStatus.status}`);
  check("partner portal minimizes private data", !("contactEmail" in (sponsorStatus.data.application || {})) && !("portalAccessId" in (sponsorStatus.data.application || {})));

  const partners = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  check("partner writes are lossless", partners.data.applications?.length === 13, `${partners.data.applications?.length ?? 0}/13 persisted`);
  check("intake jobs queued durably", intakes.filter(item => !item.data.duplicate).every(item => item.data.acknowledgment === "draft_queued") && intakes.find(item => item.data.duplicate)?.data.acknowledgment === "already_received");
  const sponsorApplication = partners.data.applications?.find(item => item.id === sponsorIntake.data.application?.id);
  const rotatedPortal = await request(base, "POST", `/api/admin/partners/applications/${sponsorApplication.id}/portal-access`, {}, { auth: true });
  const stalePortal = await request(base, "POST", "/api/public/partner-status", {
    reference: sponsorIntake.data.application?.reference,
    token: sponsorIntake.data.portalAccess?.token
  });
  const currentPortal = await request(base, "POST", "/api/public/partner-status", {
    reference: sponsorIntake.data.application?.reference,
    token: rotatedPortal.data.portalAccess?.token
  });
  check("partner portal rotation persists", rotatedPortal.status === 200 && stalePortal.status === 404 && currentPortal.status === 200);
  const recoveryInput = {
    reference: sponsorIntake.data.application?.reference,
    contactEmail: "sponsor@postgres-test.example"
  };
  const matchedPortalRecovery = await request(base, "POST", "/api/public/partner-portal-recovery", recoveryInput, {
    headers: { "idempotency-key": "postgres-portal-recovery-match-0001" }
  });
  const duplicatePortalRecovery = await request(base, "POST", "/api/public/partner-portal-recovery", recoveryInput, {
    headers: { "idempotency-key": "postgres-portal-recovery-replay-0001" }
  });
  const missedPortalRecovery = await request(base, "POST", "/api/public/partner-portal-recovery", {
    ...recoveryInput,
    contactEmail: "unknown@postgres-test.example"
  }, { headers: { "idempotency-key": "postgres-portal-recovery-miss-0001" } });
  const recoveryWorkspace = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const recoveryFollowups = recoveryWorkspace.data.followups?.filter(item => item.applicationId === sponsorApplication.id && item.kind === "portal_access_recovery") || [];
  check("partner portal recovery response prevents enumeration", matchedPortalRecovery.status === 202 && duplicatePortalRecovery.status === 202 && missedPortalRecovery.status === 202 && JSON.stringify(matchedPortalRecovery.data) === JSON.stringify(missedPortalRecovery.data) && !JSON.stringify(matchedPortalRecovery.data).includes(sponsorIntake.data.application?.reference) && !JSON.stringify(matchedPortalRecovery.data).includes("sponsor@"));
  check("partner portal recovery queues one durable cooldown-bound message", recoveryFollowups.length === 1 && recoveryFollowups[0]?.status === "queued");

  const vendorIntake = intakes[0];
  const postgresVendorReplays = intakes.filter(item => item.data.application?.id === vendorIntake.data.application?.id);
  check("concurrent intake replay returns one portal", postgresVendorReplays.length === 2 && new Set(postgresVendorReplays.map(item => item.data.portalAccess?.token)).size === 1);
  const vendorApplication = partners.data.applications?.find(item => item.id === vendorIntake.data.application?.id);
  check("concurrent vendor intake uses configured pricing", vendorApplication?.offeringId === "marketplace-booth" && vendorApplication?.expectedAmountCents === 125000);
  const approvedPostgresVendor = await request(base, "PATCH", `/api/admin/partners/applications/${vendorApplication.id}`, { status: "approved" }, { auth: true });
  const postgresVendorInvoice = await request(base, "POST", `/api/admin/partners/applications/${vendorApplication.id}/invoices`, {}, { auth: true });
  check("vendor invoice inherits offering fee and accounting item", approvedPostgresVendor.status === 200 && postgresVendorInvoice.status === 201 && postgresVendorInvoice.data.invoice?.amountCents === 125000 && postgresVendorInvoice.data.invoice?.quickBooksItemId === "postgres-vendor-marketplace-item");
  const postgresVendorAccess = { reference: vendorIntake.data.application?.reference, token: vendorIntake.data.portalAccess?.token };
  const postgresVendorProfile = await request(base, "POST", "/api/public/partner-vendor-profile", {
    ...postgresVendorAccess,
    profile: {
      legalName: "Postgres Vendor 1 LLC",
      boothName: "Postgres Vendor 1",
      website: "https://postgres-vendor.example/",
      publicDescription: "Handmade coastal artwork and gifts.",
      emergencyContactName: "Vendor Contact 1",
      emergencyContactPhone: "361-555-0140",
      powerNeed: "15a",
      waterRequired: false,
      cookingMethod: "none",
      vehicleLengthFeet: 16
    }
  });
  const postgresVendorAgreement = postgresVendorProfile.data.application?.vendorOnboarding?.requirements?.find(item => item.code === "vendor_agreement");
  const postgresVendorDocument = await request(base, "POST", "/api/public/partner-vendor-documents", {
    ...postgresVendorAccess,
    requirementId: postgresVendorAgreement?.id,
    document: { label: "Signed vendor agreement", sourceUrl: "https://files.postgres-vendor.example/agreement.pdf" }
  });
  const postgresVendorPdf = Buffer.from("%PDF-1.4\nPostgres recovery vendor agreement\n%%EOF\n");
  const postgresVendorDocumentUpload = await requestUpload(base, "/api/public/partner-vendor-documents/upload", postgresVendorPdf, {
    "content-type": "application/pdf",
    "x-partner-reference": postgresVendorAccess.reference,
    "x-partner-token": postgresVendorAccess.token,
    "x-requirement-id": postgresVendorAgreement?.id,
    "x-file-name": "postgres-vendor-agreement.pdf",
    "x-document-label": "Signed vendor agreement upload"
  });
  check("vendor onboarding persists", postgresVendorProfile.status === 200 && postgresVendorDocument.status === 201 && postgresVendorDocumentUpload.status === 201 && postgresVendorDocumentUpload.data.application?.vendorOnboarding?.requirements?.find(item => item.id === postgresVendorAgreement?.id)?.status === "submitted");
  const postgresVendorProfileApproval = await request(base, "POST", `/api/admin/partners/applications/${vendorApplication.id}/vendor-profile/review`, { action: "approve" }, { auth: true });
  const postgresVendorRequirementApproval = await request(base, "PATCH", `/api/admin/partners/vendor-requirements/${postgresVendorAgreement?.id}`, { status: "approved" }, { auth: true });
  const postgresVendorAssignment = await request(base, "PATCH", `/api/admin/partners/applications/${vendorApplication.id}/vendor-assignment`, {
    status: "scheduled",
    boothNumber: "P-01",
    zone: "Postgres artisan row",
    accessGate: "South service gate",
    loadInStart: "2026-08-14T12:00:00.000Z",
    loadInEnd: "2026-08-14T13:00:00.000Z",
    parkingPasses: 1,
    staffWristbands: 2,
    instructions: "Check in before beach access."
  }, { auth: true });
  const postgresVendorConfirmation = await request(base, "POST", "/api/public/partner-vendor-assignment/confirm", postgresVendorAccess);
  const postgresVendorWorkspace = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  check("vendor review and assignment persist", postgresVendorProfileApproval.status === 200 && postgresVendorRequirementApproval.status === 200 && postgresVendorAssignment.status === 200 && postgresVendorConfirmation.data.application?.vendorOnboarding?.assignment?.status === "confirmed" && postgresVendorWorkspace.data.vendorReadiness?.vendors?.some(item => item.applicationId === vendorApplication.id && item.compliance.approved === 1));
  const postgresAssignmentNotice = postgresVendorWorkspace.data.followups?.find(item => item.applicationId === vendorApplication.id && item.kind === "vendor_assignment_ready");
  check("vendor workflow notification persists safely", postgresVendorAssignment.data.notificationDrafted === true && postgresAssignmentNotice?.status === "dismissed" && !postgresAssignmentNotice?.sentAt && postgresAssignmentNotice?.body.includes("South service gate"));

  const currentSponsorAccess = {
    reference: sponsorIntake.data.application?.reference,
    token: rotatedPortal.data.portalAccess?.token
  };
  const approvedPostgresSponsor = await request(base, "PATCH", `/api/admin/partners/applications/${sponsorApplication.id}`, { status: "approved" }, { auth: true });
  const sponsorBrandProfile = await request(base, "POST", "/api/public/partner-brand-profile", {
    ...currentSponsorAccess,
    profile: {
      displayName: "Postgres Coastal Resort",
      website: "https://postgres-resort.example/",
      tagline: "Stay on the coast",
      primaryColor: "#005B63",
      secondaryColor: "#F7B733",
      usageNotes: "Use full-color artwork on light backgrounds."
    }
  });
  const sponsorBrandAsset = await request(base, "POST", "/api/public/partner-brand-assets", {
    ...currentSponsorAccess,
    asset: {
      kind: "primary_logo",
      label: "Primary resort logo",
      sourceUrl: "https://assets.postgres-resort.example/logo.svg"
    }
  });
  const postgresSponsorPng = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("postgres-recovery-sponsor-logo")]);
  const sponsorBrandAssetUpload = await requestUpload(base, "/api/public/partner-brand-assets/upload", postgresSponsorPng, {
    "content-type": "image/png",
    "x-partner-reference": currentSponsorAccess.reference,
    "x-partner-token": currentSponsorAccess.token,
    "x-file-name": "postgres-sponsor-logo.png",
    "x-asset-kind": "primary_logo",
    "x-asset-label": "Primary sponsor logo upload"
  });
  check("sponsor branding persists", approvedPostgresSponsor.status === 200 && sponsorBrandProfile.status === 200 && sponsorBrandAsset.status === 201 && sponsorBrandAsset.data.asset?.status === "submitted" && sponsorBrandAssetUpload.status === 201 && sponsorBrandAssetUpload.data.asset?.sourceType === "upload");
  const brandingWorkspace = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const persistedProfile = brandingWorkspace.data.brandProfiles?.find(item => item.applicationId === sponsorApplication.id);
  const persistedAsset = brandingWorkspace.data.brandAssets?.find(item => item.applicationId === sponsorApplication.id);
  const persistedDeliverable = brandingWorkspace.data.deliverables?.find(item => item.applicationId === sponsorApplication.id);
  const profileApproval = await request(base, "POST", `/api/admin/partners/applications/${sponsorApplication.id}/brand-profile/review`, { action: "approve" }, { auth: true });
  const assetApproval = await request(base, "PATCH", `/api/admin/partners/brand-assets/${persistedAsset?.id}`, { status: "approved" }, { auth: true });
  const publishedBenefit = await request(base, "PATCH", `/api/admin/partners/deliverables/${persistedDeliverable?.id}`, {
    status: "published",
    dueAt: "2026-08-01T17:00:00.000Z",
    proofUrl: "https://www.texassandfest.org/sponsors/postgres-coastal-resort",
    proofNotes: "Sponsor listing published."
  }, { auth: true });
  const benefitSignoff = await request(base, "POST", `/api/public/partner-deliverables/${persistedDeliverable?.id}/review`, {
    ...currentSponsorAccess,
    action: "approve"
  });
  check("sponsor brand review persists", persistedProfile?.status === "submitted" && profileApproval.status === 200 && assetApproval.status === 200 && publishedBenefit.data.deliverable?.partnerReviewStatus === "pending" && benefitSignoff.data.application?.branding?.deliverables?.some(item => item.id === persistedDeliverable?.id && item.partnerReviewStatus === "approved"));
  const postgresPublicSponsors = await request(base, "GET", "/api/public/sponsors");
  const postgresPublicSponsor = postgresPublicSponsors.data.sponsors?.find(item => item.displayName === "Postgres Coastal Resort");
  check("approved sponsor publication reads Postgres safely", postgresPublicSponsor?.tagline === "Stay on the coast" && postgresPublicSponsor.logo === null && !Object.hasOwn(postgresPublicSponsor, "applicationId") && !Object.hasOwn(postgresPublicSponsor, "contactEmail"));
  const fulfillmentWorkspace = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  check("sponsor fulfillment summary persists", fulfillmentWorkspace.data.fulfillment?.profiles?.approved === 1 && fulfillmentWorkspace.data.fulfillment?.assets?.approved === 1 && fulfillmentWorkspace.data.deliverables?.filter(item => item.applicationId === sponsorApplication.id).length === 6);

  const defaultSponsorMilestone = fulfillmentWorkspace.data.milestones?.find(item => item.applicationId === sponsorApplication.id);
  const reminderDueAt = new Date(Date.now() + 86_400_000).toISOString();
  const postgresMilestoneReschedule = await request(base, "PATCH", `/api/admin/partners/milestones/${defaultSponsorMilestone?.id}`, {
    dueAt: reminderDueAt,
    assigneeTeam: "finance",
    reminderLeadDays: 3,
    notes: "Verify the sponsor finance handoff."
  }, { auth: true });
  const postgresCustomMilestone = await request(base, "POST", `/api/admin/partners/applications/${sponsorApplication.id}/milestones`, {
    label: "Postgres hospitality roster",
    dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    assigneeTeam: "guest-services",
    reminderLeadDays: 5
  }, { auth: true });
  const postgresCustomReschedule = await request(base, "PATCH", `/api/admin/partners/milestones/${postgresCustomMilestone.data.milestone?.id}`, {
    dueAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    reminderLeadDays: 4
  }, { auth: true });
  const postgresCustomCompletion = await request(base, "PATCH", `/api/admin/partners/milestones/${postgresCustomMilestone.data.milestone?.id}`, { status: "completed" }, { auth: true });
  const postgresMilestoneWorkspace = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const persistedCustomMilestone = postgresMilestoneWorkspace.data.milestones?.find(item => item.id === postgresCustomMilestone.data.milestone?.id);
  check("milestone lifecycle persists", postgresMilestoneReschedule.status === 200 && postgresMilestoneReschedule.data.milestone?.scheduleVersion === 2 && postgresCustomMilestone.status === 201 && postgresCustomReschedule.data.milestone?.scheduleVersion === 2 && postgresCustomCompletion.data.milestone?.completedBy === "postgres-test-admin" && persistedCustomMilestone?.status === "completed" && !("ok" in (persistedCustomMilestone || {})));
  check("milestone summary persists", postgresMilestoneWorkspace.data.milestoneSummary?.totals?.completed === 1 && postgresMilestoneWorkspace.data.milestoneSummary?.totals?.open === 40);

  const approvedForBilling = await request(base, "PATCH", `/api/admin/partners/applications/${sponsorApplication.id}`, { status: "approved" }, { auth: true });
  const postgresInvoice = await request(base, "POST", `/api/admin/partners/applications/${sponsorApplication.id}/invoices`, { dueAt: "2026-08-15T17:00:00.000Z" }, { auth: true });
  const postgresInvoicedWorkspace = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const postgresPaymentMilestone = postgresInvoicedWorkspace.data.milestones?.find(item => item.applicationId === sponsorApplication.id && item.kind === "payment_due");
  const postgresPayment = await request(base, "POST", `/api/admin/partners/applications/${sponsorApplication.id}/payments`, {
    amountCents: 125000,
    method: "ach",
    externalRef: "PG-ACH-100",
    receivedAt: "2026-07-16T15:00:00.000Z"
  }, { auth: true });
  const postgresDuplicate = await request(base, "POST", `/api/admin/partners/applications/${sponsorApplication.id}/payments`, {
    amountCents: 125000,
    method: "ach",
    externalRef: "pg-ach-100"
  }, { auth: true });
  const postgresConflict = await request(base, "POST", `/api/admin/partners/applications/${sponsorApplication.id}/payments`, {
    amountCents: 120000,
    method: "ach",
    externalRef: "PG-ACH-100"
  }, { auth: true });
  const persistedReceivables = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const persistedInvoiceBalance = persistedReceivables.data.invoices?.find(item => item.id === postgresInvoice.data.invoice?.id);
  check("Postgres payment allocation persists", approvedForBilling.status === 200 && postgresInvoice.status === 201 && postgresInvoice.data.invoice?.quickBooksItemId === "postgres-sponsor-tarpon-item" && postgresPayment.status === 201 && persistedInvoiceBalance?.balanceCents === persistedInvoiceBalance?.amountCents - 125000);
  check("Postgres invoice payment key date persists", postgresPaymentMilestone?.dueAt === postgresInvoice.data.invoice?.dueAt && postgresPaymentMilestone?.assigneeTeam === "finance");
  check("Postgres payment idempotency persists", postgresDuplicate.status === 200 && postgresDuplicate.data.duplicate === true && postgresConflict.status === 409 && persistedReceivables.data.payments?.filter(item => item.applicationId === sponsorApplication.id).length === 1);
  check("Postgres receivables summary persists", persistedReceivables.data.receivables?.accounts?.some(item => item.applicationId === sponsorApplication.id && item.paidAmountCents === 125000 && item.reconciliationStatus === "matched"));
  const postgresRevenueBeforeReversal = await request(base, "GET", "/api/admin/revenue", undefined, { auth: true });
  check("Postgres revenue projects current-event partner receipt", postgresRevenueBeforeReversal.status === 200 && postgresRevenueBeforeReversal.data.eventId === EVENT_ID && postgresRevenueBeforeReversal.data.sources?.partnerOperations?.entries === 1 && postgresRevenueBeforeReversal.data.summary?.totals?.grossCents === 125000 && postgresRevenueBeforeReversal.data.summary?.totals?.refundCents === 0);
  const [postgresReceivablesExport, postgresCalendarExport] = await Promise.all([
    requestDownload(base, "/api/admin/exports/receivables.csv"),
    requestDownload(base, "/api/admin/exports/milestones.ics")
  ]);
  check("Postgres operations exports use durable records", postgresReceivablesExport.status === 200 && postgresReceivablesExport.body.toString("utf8").includes("Postgres Coastal Resort") && postgresCalendarExport.contentType.startsWith("text/calendar") && postgresCalendarExport.body.toString("utf8").includes("Postgres Coastal Resort"));
  const postgresReversal = await request(base, "POST", `/api/admin/partners/payments/${postgresPayment.data.payment?.id}/reverse`, { action: "refund", reason: "Postgres durability verification" }, { auth: true });
  const reversedReceivables = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const postgresRevenueAfterReversal = await request(base, "GET", "/api/admin/revenue", undefined, { auth: true });
  const reversedInvoiceBalance = reversedReceivables.data.invoices?.find(item => item.id === postgresInvoice.data.invoice?.id);
  check("Postgres payment reversal persists", postgresReversal.status === 200 && postgresReversal.data.payment?.status === "refunded" && reversedInvoiceBalance?.balanceCents === reversedInvoiceBalance?.amountCents && reversedReceivables.data.receivables?.accounts?.find(item => item.applicationId === sponsorApplication.id)?.paidAmountCents === 0);
  check("Postgres revenue projects reversal without losing gross history", postgresRevenueAfterReversal.data.sources?.partnerOperations?.entries === 2 && postgresRevenueAfterReversal.data.summary?.totals?.grossCents === 125000 && postgresRevenueAfterReversal.data.summary?.totals?.refundCents === 125000 && postgresRevenueAfterReversal.data.summary?.totals?.netCents === 0);

  const postgresSettlementCsv = `transaction_id,date,category,gross_amount,fee_amount,net_amount,payout_id,payout_date,reconciled
postgres_eventeny_settlement_1,2026-07-16,vendor_fee,250.00,7.50,242.50,eventeny_payout_postgres_1,2026-07-17,yes`;
  const postgresRevenueImportPreview = await request(base, "POST", "/api/admin/revenue/import", {
    mode: "preview",
    source: "eventeny",
    fileName: "eventeny-postgres.csv",
    csv: postgresSettlementCsv
  }, { auth: true });
  const postgresRevenueAfterPreview = await request(base, "GET", "/api/admin/revenue", undefined, { auth: true });
  const postgresRevenueImportCommit = await request(base, "POST", "/api/admin/revenue/import", {
    mode: "commit",
    source: "eventeny",
    fileName: "eventeny-postgres.csv",
    csv: postgresSettlementCsv,
    previewHash: postgresRevenueImportPreview.data.previewHash
  }, { auth: true });
  const postgresRevenueImportReplay = await request(base, "POST", "/api/admin/revenue/import", {
    mode: "commit",
    source: "eventeny",
    fileName: "eventeny-postgres.csv",
    csv: postgresSettlementCsv,
    previewHash: postgresRevenueImportPreview.data.previewHash
  }, { auth: true });
  const postgresRevenueAfterImport = await request(base, "GET", "/api/admin/revenue", undefined, { auth: true });
  const postgresImportedRevenueEntry = postgresRevenueAfterImport.data.entries?.find(item => item.externalRef === "postgres_eventeny_settlement_1");
  check("Postgres revenue preview persists nothing", postgresRevenueImportPreview.status === 200 && postgresRevenueImportPreview.data.summary?.importable === 1 && !postgresRevenueAfterPreview.data.entries?.some(item => item.externalRef === "postgres_eventeny_settlement_1") && postgresRevenueAfterPreview.data.imports?.length === 0);
  check("Postgres revenue import persists atomically", postgresRevenueImportCommit.status === 201 && postgresRevenueImportCommit.data.summary?.imported === 1 && postgresImportedRevenueEntry?.importBatchId === postgresRevenueImportCommit.data.batchId && postgresRevenueAfterImport.data.imports?.[0]?.fileName === "eventeny-postgres.csv");
  check("Postgres revenue import replay is idempotent", postgresRevenueImportReplay.status === 200 && postgresRevenueImportReplay.data.replay === true && postgresRevenueAfterImport.data.entries?.filter(item => item.externalRef === "postgres_eventeny_settlement_1").length === 1 && postgresRevenueAfterImport.data.imports?.length === 1);
  check("Postgres revenue dashboard merges import and partner ledger", postgresRevenueAfterImport.data.sources?.imported?.entries === 1 && postgresRevenueAfterImport.data.sources?.partnerOperations?.entries === 2 && postgresRevenueAfterImport.data.summary?.totals?.grossCents === 150000 && postgresRevenueAfterImport.data.summary?.totals?.refundCents === 125000 && postgresRevenueAfterImport.data.summary?.totals?.netCents === 24250);

  const concurrentBudgetLineBody = {
    name: "Postgres beach operations",
    ownerTeam: "operations",
    budgetCents: 50_000,
    notes: "Postgres durability verification"
  };
  const concurrentBudgetLineResponses = await Promise.all([
    request(base, "POST", "/api/admin/budget/lines", concurrentBudgetLineBody, { auth: true }),
    request(base, "POST", "/api/admin/budget/lines", concurrentBudgetLineBody, { auth: true })
  ]);
  const postgresBudgetLine = concurrentBudgetLineResponses.find(item => item.status === 201);
  check("Postgres budget allocation serializes concurrent duplicate writes", concurrentBudgetLineResponses.filter(item => item.status === 201).length === 1
    && concurrentBudgetLineResponses.filter(item => item.status === 409).length === 1 && postgresBudgetLine?.data.line?.eventId === EVENT_ID);
  const postgresExpenseRequest = await request(base, "POST", "/api/admin/budget/expenses", {
    budgetLineId: postgresBudgetLine?.data.line?.id,
    vendorName: "Postgres Private Staging Vendor",
    description: "Postgres beach staging reservation",
    amountCents: 30_000,
    dueDate: "2027-02-15"
  }, { auth: true });
  const postgresExpenseApproval = await request(base, "POST", `/api/admin/budget/expenses/${postgresExpenseRequest.data.expense?.id}/approve`, {}, { auth: true });
  const postgresExpensePayment = await request(base, "POST", `/api/admin/budget/expenses/${postgresExpenseRequest.data.expense?.id}/mark-paid`, {
    paymentMethod: "ach",
    paymentReference: "PRIVATE-PG-ACH-1001"
  }, { auth: true });
  const postgresOverBudgetRequest = await request(base, "POST", "/api/admin/budget/expenses", {
    budgetLineId: postgresBudgetLine?.data.line?.id,
    vendorName: "Postgres Private Safety Vendor",
    description: "Postgres additional safety structures",
    amountCents: 25_000,
    dueDate: "2027-03-01"
  }, { auth: true });
  const postgresOverBudgetBlocked = await request(base, "POST", `/api/admin/budget/expenses/${postgresOverBudgetRequest.data.expense?.id}/approve`, {}, { auth: true });
  const postgresOverBudgetApproved = await request(base, "POST", `/api/admin/budget/expenses/${postgresOverBudgetRequest.data.expense?.id}/approve`, {
    allowOverBudget: true,
    note: "Executive exception approved for required safety capacity."
  }, { auth: true });
  const postgresBudget = await request(base, "GET", "/api/admin/budget", undefined, { auth: true });
  check("Postgres expense approval and payment evidence persists", postgresExpenseRequest.status === 201 && postgresExpenseApproval.status === 200
    && postgresExpensePayment.status === 200 && postgresBudget.data.expenses?.find(item => item.id === postgresExpenseRequest.data.expense?.id)?.status === "paid");
  check("Postgres over-budget approval fails closed and persists an explicit override", postgresOverBudgetBlocked.status === 409 && postgresOverBudgetApproved.status === 200
    && postgresBudget.data.summary?.totals?.budgetCents === 50_000 && postgresBudget.data.summary?.totals?.committedCents === 55_000
    && postgresBudget.data.summary?.counts?.overBudgetLines === 1 && postgresBudget.data.expenses?.length === 2);
  const approvedPostgresInvoice = await request(base, "POST", `/api/admin/partners/invoices/${postgresInvoice.data.invoice?.id}/review`, { action: "approve" }, { auth: true });
  const postgresPartnerAccess = { reference: sponsorIntake.data.application?.reference, token: rotatedPortal.data.portalAccess?.token };
  const postgresCheckout = await request(base, "POST", "/api/public/partner-payment-checkout", {
    ...postgresPartnerAccess,
    invoiceId: postgresInvoice.data.invoice?.id
  });
  check("Postgres partner checkout persists", approvedPostgresInvoice.status === 200 && postgresCheckout.status === 201 && postgresCheckout.data.checkout?.status === "open");
  const postgresPaidEvent = {
    id: "evt_partner_postgres_paid_001",
    type: "checkout.session.completed",
    data: { object: {
      id: "cs_partner_postgres_001",
      payment_intent: "pi_partner_postgres_001",
      amount_total: reversedInvoiceBalance?.amountCents,
      currency: "usd",
      payment_status: "paid",
      metadata: {
        sandfest_flow: "partner_invoice",
        partner_checkout_id: postgresCheckout.data.checkout?.id,
        partner_application_id: sponsorApplication.id,
        partner_invoice_id: postgresInvoice.data.invoice?.id
      }
    } }
  };
  const postgresPaidRaw = JSON.stringify(postgresPaidEvent);
  const postgresPaidTimestamp = String(Math.floor(Date.now() / 1000));
  const postgresPaidSignature = createHmac("sha256", "whsec_postgres_partner").update(`${postgresPaidTimestamp}.${postgresPaidRaw}`).digest("hex");
  const postgresPaidWebhook = await request(base, "POST", "/api/stripe/webhook", undefined, {
    rawBody: postgresPaidRaw,
    headers: { "stripe-signature": `t=${postgresPaidTimestamp},v1=${postgresPaidSignature}` }
  });
  const postgresPaidWebhookReplay = await request(base, "POST", "/api/stripe/webhook", undefined, {
    rawBody: postgresPaidRaw,
    headers: { "stripe-signature": `t=${postgresPaidTimestamp},v1=${postgresPaidSignature}` }
  });
  const postgresPaidWorkspace = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const postgresStripePayment = postgresPaidWorkspace.data.payments?.find(item => item.paymentIntentId === "pi_partner_postgres_001");
  const postgresPaidInvoice = postgresPaidWorkspace.data.invoices?.find(item => item.id === postgresInvoice.data.invoice?.id);
  const postgresCompletedCheckout = postgresPaidWorkspace.data.paymentCheckouts?.find(item => item.id === postgresCheckout.data.checkout?.id);
  const postgresPaidMilestone = postgresPaidWorkspace.data.milestones?.find(item => item.id === postgresPaymentMilestone?.id);
  check("Postgres Stripe webhook reconciliation persists", postgresPaidWebhook.status === 200 && postgresPaidWebhook.data.record?.partnerReconciliation?.status === "reconciled" && postgresStripePayment?.status === "succeeded" && postgresPaidInvoice?.balanceCents === 0 && postgresCompletedCheckout?.status === "completed" && postgresPaidMilestone?.status === "completed" && postgresPaidMilestone?.completedBy === "automation:payment_reconciliation");
  check("Postgres Stripe webhook replay is idempotent", postgresPaidWebhookReplay.data.duplicate === true && postgresPaidWorkspace.data.payments?.filter(item => item.paymentIntentId === "pi_partner_postgres_001").length === 1);

  const postgresTicketConfig = await request(base, "PATCH", "/api/admin/tickets/general-admission-3-day", {
    unitAmount: 4500,
    priceLabel: "$45.00",
    stripePriceId: "price_postgres_ga_2027",
    active: true,
    requiresReview: false
  }, { auth: true });
  const postgresTicketPolicy = await request(base, "PATCH", "/api/admin/ticket-policy", {
    action: "approve",
    version: "postgres-ticket-2027-v1",
    acknowledgment: "I agree to the approved Texas SandFest ticket policies listed above.",
    notices: REQUIRED_TICKET_POLICY_NOTICES.map(item => ({
      id: item.id,
      summary: `${item.label} reviewed for the 2027 Postgres checkout acceptance test.`
    }))
  }, { auth: true });
  const postgresTicketCatalog = await request(base, "GET", "/api/public/tickets");
  const publicPostgresTicket = postgresTicketCatalog.data.products?.find(item => item.id === "general-admission-3-day");
  const publicPostgresTicketPolicy = postgresTicketCatalog.data.checkoutPolicy;
  const postgresTicketPayload = {
    items: [{ productId: "general-admission-3-day", quantity: 2 }],
    customer: { email: "postgres-ticket-buyer@example.com", phone: "361-555-0188" },
    consent: { emailMarketing: false, smsMarketing: false, smsSafety: true },
    policyAcceptance: {
      accepted: true,
      version: publicPostgresTicketPolicy.version,
      digest: publicPostgresTicketPolicy.digest
    }
  };
  const postgresTicketRequestsBefore = stripeMock.requests.length;
  const postgresTicketCheckout = await request(base, "POST", "/api/stripe/create-checkout-session", postgresTicketPayload, {
    headers: { "idempotency-key": "postgres-ticket-checkout-0001" }
  });
  const postgresTicketReplay = await request(base, "POST", "/api/stripe/create-checkout-session", postgresTicketPayload, {
    headers: { "idempotency-key": "postgres-ticket-checkout-0001" }
  });
  const postgresTicketProviderRequests = stripeMock.requests.slice(postgresTicketRequestsBefore);
  const postgresTicketProviderRequest = postgresTicketProviderRequests[0];
  check("Postgres public ticket catalog is checkout-ready and provider-private", postgresTicketConfig.status === 200 && postgresTicketPolicy.status === 200 && publicPostgresTicketPolicy?.ready === true && publicPostgresTicketPolicy?.version === "postgres-ticket-2027-v1" && publicPostgresTicketPolicy?.notices?.length === 4 && publicPostgresTicket?.availableForCheckout === true && !JSON.stringify(postgresTicketCatalog.data).includes("stripePriceId"));
  check("Postgres ticket checkout stores one trusted provider request", postgresTicketCheckout.status === 200 && postgresTicketProviderRequests.length === 1 && postgresTicketProviderRequest?.body.get("line_items[0][price]") === "price_postgres_ga_2027" && postgresTicketProviderRequest?.body.get("line_items[0][quantity]") === "2" && postgresTicketProviderRequest?.body.get("metadata[ticket_policy_version]") === "postgres-ticket-2027-v1" && postgresTicketProviderRequest?.body.get("metadata[ticket_policy_digest]") === publicPostgresTicketPolicy.digest);
  check("Postgres ticket checkout retry returns the original session", postgresTicketReplay.status === 200 && postgresTicketReplay.data.duplicate === true && postgresTicketReplay.data.checkoutSessionId === postgresTicketCheckout.data.checkoutSessionId);

  const postgresTicketPaidEvent = {
    id: "evt_ticket_postgres_paid_001",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: {
      id: postgresTicketCheckout.data.checkoutSessionId,
      client_reference_id: postgresTicketCheckout.data.orderId,
      metadata: { order_id: postgresTicketCheckout.data.orderId, event_id: EVENT_ID },
      payment_intent: "pi_ticket_postgres_paid_001",
      amount_total: 9000,
      currency: "usd",
      payment_status: "paid",
      customer_details: { email: "postgres-ticket-buyer@example.com", name: "Postgres Ticket Buyer" }
    } }
  };
  const postgresTicketPaidRaw = JSON.stringify(postgresTicketPaidEvent);
  const postgresTicketPaidTimestamp = String(Math.floor(Date.now() / 1000));
  const postgresTicketPaidSignature = createHmac("sha256", "whsec_postgres_partner").update(`${postgresTicketPaidTimestamp}.${postgresTicketPaidRaw}`).digest("hex");
  const postgresTicketPaidWebhook = await request(base, "POST", "/api/stripe/webhook", undefined, {
    rawBody: postgresTicketPaidRaw,
    headers: { "stripe-signature": `t=${postgresTicketPaidTimestamp},v1=${postgresTicketPaidSignature}` }
  });
  const postgresTicketPaidReplay = await request(base, "POST", "/api/stripe/webhook", undefined, {
    rawBody: postgresTicketPaidRaw,
    headers: { "stripe-signature": `t=${postgresTicketPaidTimestamp},v1=${postgresTicketPaidSignature}` }
  });
  const postgresTicketOrdersAfterPayment = await request(base, "GET", "/api/admin/orders?limit=20", undefined, { auth: true });
  const postgresTicketEventsAfterPayment = await request(base, "GET", "/api/admin/payment-events?limit=20", undefined, { auth: true });
  const postgresTicketFulfillmentAfterPayment = await request(base, "GET", "/api/admin/fulfillment?limit=20", undefined, { auth: true });
  const paidPostgresTicketOrder = postgresTicketOrdersAfterPayment.data.pendingOrders?.find(item => item.record?.id === postgresTicketCheckout.data.orderId)?.record;
  const paidPostgresTicketEvent = postgresTicketEventsAfterPayment.data.paymentEvents?.find(item => item.record?.id === postgresTicketPaidEvent.id)?.record;
  const paidPostgresTicketFulfillment = postgresTicketFulfillmentAfterPayment.data.fulfillment?.filter(item => item.record?.orderId === postgresTicketCheckout.data.orderId) || [];
  check("Postgres signed ticket payment persists trusted fulfillment", postgresTicketPaidWebhook.status === 200 && postgresTicketPaidWebhook.data.record?.ticketReconciliation?.status === "fulfilled" && paidPostgresTicketOrder?.status === "paid" && paidPostgresTicketOrder?.paymentIntentId === "pi_ticket_postgres_paid_001" && paidPostgresTicketOrder?.policyAcceptance?.version === "postgres-ticket-2027-v1" && paidPostgresTicketOrder?.policyAcceptance?.digest === publicPostgresTicketPolicy.digest && paidPostgresTicketFulfillment.length === 2);
  check("Postgres ticket event replay is idempotent and privacy-minimized", postgresTicketPaidReplay.data.duplicate === true && paidPostgresTicketFulfillment.length === 2 && !Object.hasOwn(paidPostgresTicketEvent || {}, "raw") && !JSON.stringify(paidPostgresTicketEvent || {}).includes("postgres-ticket-buyer@example.com"));

  const postgresTicketPartialRefundEvent = {
    id: "evt_ticket_postgres_partial_refund_001",
    type: "charge.refunded",
    livemode: false,
    data: { object: {
      id: "ch_ticket_postgres_partial_refund_001",
      payment_intent: "pi_ticket_postgres_paid_001",
      amount: 9000,
      amount_refunded: 3000,
      currency: "usd"
    } }
  };
  const postgresTicketPartialRefundRaw = JSON.stringify(postgresTicketPartialRefundEvent);
  const postgresTicketPartialRefundTimestamp = String(Math.floor(Date.now() / 1000));
  const postgresTicketPartialRefundSignature = createHmac("sha256", "whsec_postgres_partner").update(`${postgresTicketPartialRefundTimestamp}.${postgresTicketPartialRefundRaw}`).digest("hex");
  const postgresTicketPartialRefundWebhook = await request(base, "POST", "/api/stripe/webhook", undefined, {
    rawBody: postgresTicketPartialRefundRaw,
    headers: { "stripe-signature": `t=${postgresTicketPartialRefundTimestamp},v1=${postgresTicketPartialRefundSignature}` }
  });
  const postgresTicketOrdersAfterPartialRefund = await request(base, "GET", "/api/admin/orders?limit=20", undefined, { auth: true });
  const postgresTicketFulfillmentAfterPartialRefund = await request(base, "GET", "/api/admin/fulfillment?limit=20", undefined, { auth: true });
  const partialPostgresTicketOrder = postgresTicketOrdersAfterPartialRefund.data.pendingOrders?.find(item => item.record?.id === postgresTicketCheckout.data.orderId)?.record;
  const partialPostgresTicketFulfillment = postgresTicketFulfillmentAfterPartialRefund.data.fulfillment?.filter(item => item.record?.orderId === postgresTicketCheckout.data.orderId) || [];
  check("Postgres partial ticket refund enters allocation review", postgresTicketPartialRefundWebhook.status === 200 && postgresTicketPartialRefundWebhook.data.record?.ticketReconciliation?.status === "partially_refunded" && partialPostgresTicketOrder?.status === "partially_refunded" && partialPostgresTicketOrder?.refundedAmountCents === 3000 && partialPostgresTicketFulfillment.length === 2 && partialPostgresTicketFulfillment.every(item => item.record?.status === "needs_review"));

  const postgresTicketRefundEvent = {
    id: "evt_ticket_postgres_refund_001",
    type: "charge.refunded",
    livemode: false,
    data: { object: {
      id: "ch_ticket_postgres_refund_001",
      payment_intent: "pi_ticket_postgres_paid_001",
      amount: 9000,
      amount_refunded: 9000,
      currency: "usd"
    } }
  };
  const postgresTicketRefundRaw = JSON.stringify(postgresTicketRefundEvent);
  const postgresTicketRefundTimestamp = String(Math.floor(Date.now() / 1000));
  const postgresTicketRefundSignature = createHmac("sha256", "whsec_postgres_partner").update(`${postgresTicketRefundTimestamp}.${postgresTicketRefundRaw}`).digest("hex");
  const postgresTicketRefundWebhook = await request(base, "POST", "/api/stripe/webhook", undefined, {
    rawBody: postgresTicketRefundRaw,
    headers: { "stripe-signature": `t=${postgresTicketRefundTimestamp},v1=${postgresTicketRefundSignature}` }
  });
  const postgresTicketOrdersAfterRefund = await request(base, "GET", "/api/admin/orders?limit=20", undefined, { auth: true });
  const postgresTicketFulfillmentAfterRefund = await request(base, "GET", "/api/admin/fulfillment?limit=20", undefined, { auth: true });
  const refundedPostgresTicketOrder = postgresTicketOrdersAfterRefund.data.pendingOrders?.find(item => item.record?.id === postgresTicketCheckout.data.orderId)?.record;
  const refundedPostgresTicketFulfillment = postgresTicketFulfillmentAfterRefund.data.fulfillment?.filter(item => item.record?.orderId === postgresTicketCheckout.data.orderId) || [];
  check("Postgres signed ticket refund closes order and fulfillment", postgresTicketRefundWebhook.status === 200 && postgresTicketRefundWebhook.data.record?.ticketReconciliation?.status === "refunded" && refundedPostgresTicketOrder?.status === "refunded" && refundedPostgresTicketOrder?.refundedAmountCents === 9000 && refundedPostgresTicketFulfillment.length === 2 && refundedPostgresTicketFulfillment.every(item => item.record?.status === "refunded"));

  const delegatedTask = await request(base, "POST", "/api/admin/partners/tasks", {
    title: "Postgres volunteer briefing",
    description: "Verify assignment and lifecycle durability.",
    assigneeType: "volunteer",
    assigneeId: "vol_001",
    priority: "high",
    dueAt: "2026-07-17T13:00:00.000Z"
  }, { auth: true });
  check("volunteer task assignment persisted", delegatedTask.status === 201 && delegatedTask.data.task?.assigneeName === "Alex Rivera", `status ${delegatedTask.status}`);
  const blockedTask = await request(base, "PATCH", `/api/admin/partners/tasks/${delegatedTask.data.task?.id}`, {
    status: "blocked",
    assigneeType: "team",
    assigneeId: "operations",
    priority: "urgent"
  }, { auth: true });
  const notifiedVolunteerTask = await request(base, "POST", "/api/admin/partners/tasks", {
    title: "Postgres volunteer gate check",
    description: "Confirm the north gate opening checklist with operations.",
    assigneeType: "volunteer",
    assigneeId: "vol_001",
    priority: "high",
    dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString()
  }, { auth: true });
  const notifiedStaffTask = await request(base, "POST", "/api/admin/partners/tasks", {
    title: "Postgres command briefing",
    description: "Confirm the incident command handoff.",
    assigneeType: "staff",
    assigneeId: "staff_command",
    priority: "high",
    dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString()
  }, { auth: true });
  const postgresTaskPortalConfig = taskPortalConfig(commonEnv);
  const postgresTaskPortalToken = issueTaskPortalToken(notifiedVolunteerTask.data.task, { config: postgresTaskPortalConfig });
  const openedPostgresTaskPortal = await request(base, "POST", "/api/public/task-status", {
    taskId: notifiedVolunteerTask.data.task?.id,
    token: postgresTaskPortalToken
  });
  const acknowledgedPostgresTask = await request(base, "POST", "/api/public/task-status/update", {
    taskId: notifiedVolunteerTask.data.task?.id,
    token: postgresTaskPortalToken,
    action: "acknowledge",
    note: "Postgres volunteer confirms the north gate checklist."
  });
  const taskWorkspace = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const persistedAcknowledgedTask = taskWorkspace.data.tasks?.find(item => item.id === notifiedVolunteerTask.data.task?.id);
  check("task lifecycle and workload persisted", blockedTask.status === 200 && notifiedVolunteerTask.status === 201 && notifiedStaffTask.status === 201 && notifiedStaffTask.data.task?.assigneeName === "Postgres Incident Commander" && taskWorkspace.data.taskBoard?.totals?.blocked === 1 && taskWorkspace.data.taskBoard?.workload?.some(item => item.assigneeId === "operations") && taskWorkspace.data.taskBoard?.workload?.some(item => item.assigneeId === "vol_001") && taskWorkspace.data.taskBoard?.workload?.some(item => item.assigneeId === "staff_command"));
  check("task assignee capability update persists in Postgres", openedPostgresTaskPortal.status === 200 && acknowledgedPostgresTask.status === 200 && acknowledgedPostgresTask.data.task?.acknowledgedAt && persistedAcknowledgedTask?.acknowledgedAt && persistedAcknowledgedTask?.assigneeUpdates?.at(-1)?.note.includes("Postgres volunteer"));
  check("assignment directory minimizes private contacts", taskWorkspace.data.staffDirectory?.ready === true && taskWorkspace.data.assignmentDirectory?.staff?.some(item => item.id === "staff_command" && item.emailAvailable === true && !("email" in item)) && taskWorkspace.data.assignmentDirectory?.volunteers?.some(item => item.id === "vol_001" && !("email" in item) && !("phone" in item)));

  const prospect = await request(base, "POST", "/api/admin/outreach/prospects", {
    organizationName: "Postgres Island Hotel",
    contactName: "Morgan Taylor",
    contactEmail: "partners@postgres-hotel.example",
    industry: "hospitality",
    city: "Port Aransas",
    state: "TX",
    postalCode: "78373",
    latitude: 27.8339,
    longitude: -97.0611,
    contactBasis: "business_relevance",
    status: "contact_ready",
    ownerId: "sponsor_lead",
    nextAction: "Prepare a reviewed sponsor invitation",
    nextActionAt: "2027-01-15T15:00:00.000Z"
  }, { auth: true });
  const scheduledPostgresOutreach = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  check("outreach prospect persisted", prospect.status === 201 && prospect.data.prospect?.fitScore >= 60, `status ${prospect.status}`);
  check("outreach ownership and schedule persisted", prospect.data.prospect?.ownerId === "sponsor_lead" && prospect.data.prospect?.nextActionAt === "2027-01-15T15:00:00.000Z" && scheduledPostgresOutreach.data.summary?.nextActionsScheduled === 1 && scheduledPostgresOutreach.data.summary?.unassigned === 0);

  const invitedPostgresProspect = await request(base, "POST", "/api/admin/outreach/prospects", {
    organizationName: "Postgres Community Credit Union",
    contactName: "Jordan Postgres",
    contactEmail: "jordan@postgres-credit-union.example",
    website: "https://postgres-credit-union.example",
    industry: "banking",
    city: "Corpus Christi",
    state: "TX",
    postalCode: "78401",
    contactBasis: "business_relevance",
    status: "contact_ready"
  }, { auth: true });
  const invitedPostgresProspectId = invitedPostgresProspect.data.prospect?.id;
  const postgresInvitation = await request(base, "POST", `/api/admin/outreach/prospects/${invitedPostgresProspectId}/sponsor-invitation`, { action: "issue", packageId: "tarpon" }, { auth: true });
  const copiedPostgresInvitation = await request(base, "POST", `/api/admin/outreach/prospects/${invitedPostgresProspectId}/sponsor-invitation`, { action: "copy" }, { auth: true });
  const postgresInvitationHash = postgresInvitation.data.invitation?.url ? new URL(postgresInvitation.data.invitation.url).hash : "";
  const postgresInvitationToken = new URLSearchParams(postgresInvitationHash.slice(postgresInvitationHash.indexOf("?") + 1)).get("token");
  const publicPostgresInvitation = await request(base, "POST", "/api/public/sponsor-invitation", { token: postgresInvitationToken });
  check("Postgres sponsor invitation persists", invitedPostgresProspect.status === 201 && postgresInvitation.status === 200 && copiedPostgresInvitation.data.invitation?.url === postgresInvitation.data.invitation?.url && publicPostgresInvitation.data.invitation?.organizationName === "Postgres Community Credit Union");
  const invitedPostgresApplicationBody = {
    organizationName: "Postgres Community Credit Union",
    contactName: "Jordan Postgres",
    contactEmail: "jordan@postgres-credit-union.example",
    website: "https://postgres-credit-union.example",
    packageId: "tarpon",
    description: "Support visitor access and community programming.",
    consentToContact: true,
    sponsorInvitationToken: postgresInvitationToken
  };
  const rejectedPostgresInvitation = await request(base, "POST", "/api/public/sponsor-inquiries", { ...invitedPostgresApplicationBody, organizationName: "Wrong Organization" }, { headers: { "idempotency-key": "postgres-invited-sponsor-rejected-0001" } });
  const invitationStateAfterRejection = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  const prospectAfterRejectedInvitation = invitationStateAfterRejection.data.prospects?.find(item => item.id === invitedPostgresProspectId);
  check("Postgres sponsor invitation rejects mismatched identity atomically", rejectedPostgresInvitation.status === 400 && prospectAfterRejectedInvitation?.status === "contact_ready" && !prospectAfterRejectedInvitation?.convertedApplicationId);
  const concurrentPostgresInvitationIntakes = await Promise.all([
    request(base, "POST", "/api/public/sponsor-inquiries", invitedPostgresApplicationBody, { headers: { "idempotency-key": "postgres-invited-sponsor-0001" } }),
    request(base, "POST", "/api/public/sponsor-inquiries", invitedPostgresApplicationBody, { headers: { "idempotency-key": "postgres-invited-sponsor-0001" } })
  ]);
  const convertedPostgresPartners = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const convertedPostgresOutreach = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  const convertedPostgresProspect = convertedPostgresOutreach.data.prospects?.find(item => item.id === invitedPostgresProspectId);
  const convertedPostgresApplications = convertedPostgresPartners.data.applications?.filter(item => item.outreachProspectId === invitedPostgresProspectId) || [];
  const convertedPostgresApplication = convertedPostgresApplications[0];
  const recoveredPostgresPortal = await request(base, "POST", "/api/public/sponsor-invitation", { token: postgresInvitationToken });
  const openedRecoveredPostgresPortal = await request(base, "POST", "/api/public/partner-status", {
    reference: recoveredPostgresPortal.data.portalAccess?.reference,
    token: recoveredPostgresPortal.data.portalAccess?.token
  });
  check("Postgres sponsor invitation conversion is concurrent replay safe", concurrentPostgresInvitationIntakes.filter(item => item.status === 201).length === 1 && concurrentPostgresInvitationIntakes.filter(item => item.status === 200 && item.data.duplicate).length === 1 && convertedPostgresApplications.length === 1 && convertedPostgresProspect?.status === "won" && convertedPostgresProspect?.convertedApplicationId === convertedPostgresApplication?.id);
  check("Postgres sponsor invitation conversion seeds durable operations", convertedPostgresApplication?.source === "outreach_invitation" && convertedPostgresPartners.data.brandProfiles?.some(item => item.applicationId === convertedPostgresApplication?.id) && convertedPostgresPartners.data.deliverables?.some(item => item.applicationId === convertedPostgresApplication?.id) && convertedPostgresPartners.data.milestones?.filter(item => item.applicationId === convertedPostgresApplication?.id).length === 4 && convertedPostgresPartners.data.milestones?.some(item => item.applicationId === convertedPostgresApplication?.id && item.kind === "payment_due" && item.assigneeTeam === "finance") && convertedPostgresPartners.data.tasks?.some(item => item.relatedEntityId === convertedPostgresApplication?.id));
  check("Postgres converted invitation recovers private portal", recoveredPostgresPortal.status === 200 && recoveredPostgresPortal.data.converted === true && openedRecoveredPostgresPortal.status === 200 && openedRecoveredPostgresPortal.data.application?.reference === convertedPostgresApplication?.reference);

  const postgresImportCsv = `business_name,industry,city,state,zip,email,community_fit,owner_id,next_action,next_action_at
Postgres Imported Bank,banking,Corpus Christi,TX,78401,partners@postgres-bank.example,yes,finance,Review local banking partnership,2027-01-20T15:00:00Z
Postgres Invalid ZIP,banking,Corpus Christi,TX,bad,invalid@postgres-bank.example,no,finance,Fix location,2027-01-21T15:00:00Z`;
  const postgresImportDefaults = { state: "TX", contactBasis: "business_relevance", status: "contact_ready", communityFit: false };
  const postgresImportPreview = await request(base, "POST", "/api/admin/outreach/prospects/import", {
    mode: "preview",
    csv: postgresImportCsv,
    defaults: postgresImportDefaults
  }, { auth: true });
  const postgresImportStale = await request(base, "POST", "/api/admin/outreach/prospects/import", {
    mode: "commit",
    csv: `${postgresImportCsv}\n`,
    defaults: postgresImportDefaults,
    previewHash: postgresImportPreview.data.previewHash
  }, { auth: true });
  const postgresPreviewOutreach = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  const postgresImportCommit = await request(base, "POST", "/api/admin/outreach/prospects/import", {
    mode: "commit",
    csv: postgresImportCsv,
    defaults: postgresImportDefaults,
    previewHash: postgresImportPreview.data.previewHash
  }, { auth: true });
  const postgresImportedOutreach = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  const postgresImportedProspect = postgresImportedOutreach.data.prospects?.find(item => item.organizationName === "Postgres Imported Bank");
  check("outreach CSV preview persists nothing", postgresImportPreview.status === 200 && postgresImportPreview.data.summary?.valid === 1 && postgresPreviewOutreach.data.prospects?.length === 2 && !postgresPreviewOutreach.data.prospects?.some(item => item.organizationName === "Postgres Imported Bank"));
  check("outreach CSV preview hash enforced", postgresImportStale.status === 409);
  check("outreach CSV import persisted", postgresImportCommit.status === 201 && postgresImportCommit.data.summary?.valid === 1 && postgresImportedProspect?.sourceBatch === postgresImportCommit.data.batchId && postgresImportedProspect?.ownerId === "finance" && postgresImportedProspect?.nextActionAt === "2027-01-20T15:00:00.000Z");

  const postgresDiscoveryPreview = await request(base, "POST", "/api/admin/outreach/discovery/preview", {
    location: "Port Aransas, TX 78373",
    radiusMiles: 25,
    limit: 10,
    categories: ["lodging", "financial"]
  }, { auth: true });
  const postgresDiscoveryCandidate = postgresDiscoveryPreview.data.candidates?.[0];
  const postgresDiscoveryBeforeImport = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  const postgresDiscoveryImport = await request(base, "POST", "/api/admin/outreach/discovery/import", {
    previewToken: postgresDiscoveryPreview.data.previewToken,
    selectedSourceRefs: [postgresDiscoveryCandidate?.sourceRef]
  }, { auth: true });
  const postgresDiscoveryReplay = await request(base, "POST", "/api/admin/outreach/discovery/import", {
    previewToken: postgresDiscoveryPreview.data.previewToken,
    selectedSourceRefs: [postgresDiscoveryCandidate?.sourceRef]
  }, { auth: true });
  const postgresDiscoveryAfterImport = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  const postgresDiscoveredProspect = postgresDiscoveryAfterImport.data.prospects?.find(item => item.id === postgresDiscoveryImport.data.prospects?.[0]?.id);
  check("outreach discovery preview persists nothing", postgresDiscoveryPreview.status === 200 && postgresDiscoveryPreview.data.discovery?.provider === "fixture" && !postgresDiscoveryBeforeImport.data.prospects?.some(item => item.sourceRef === postgresDiscoveryCandidate?.sourceRef));
  check("outreach discovery import persists provenance", postgresDiscoveryImport.status === 201 && postgresDiscoveredProspect?.sourceRef === postgresDiscoveryCandidate?.sourceRef && postgresDiscoveredProspect?.sourceUrl && postgresDiscoveredProspect?.status === "identified" && postgresDiscoveredProspect?.contactBasis === null);
  check("outreach discovery replay is idempotent", postgresDiscoveryReplay.status === 200 && postgresDiscoveryReplay.data.summary?.imported === 0 && postgresDiscoveryReplay.data.summary?.duplicates === 1);
  const postgresDiscoveryResearch = await request(base, "PATCH", `/api/admin/outreach/prospects/${postgresDiscoveredProspect?.id}`, {
    website: "https://postgres-discovery.example.com",
    contactName: "Postgres Discovery Contact",
    contactEmail: "contact@postgres-discovery.example.com",
    contactBasis: "business_relevance",
    status: "contact_ready",
    ownerId: "sponsor_research",
    nextAction: "Verify the decision maker",
    nextActionAt: "2027-01-25T15:00:00.000Z"
  }, { auth: true });
  const postgresDiscoveryResearched = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  check("outreach discovery contact research persists", postgresDiscoveryResearch.status === 200 && postgresDiscoveryResearched.data.prospects?.some(item => item.id === postgresDiscoveredProspect?.id && item.contactName === "Postgres Discovery Contact" && item.website === "https://postgres-discovery.example.com" && item.ownerId === "sponsor_research" && item.nextActionAt === "2027-01-25T15:00:00.000Z"));

  const postgresCampaignPayload = {
    name: "Postgres Coastal Hospitality",
    objective: "Verify production data plane",
    targeting: {
      industries: ["hospitality"],
      cities: ["Port Aransas"],
      states: ["TX"],
      postalCodes: ["78373"],
      geofence: { latitude: 27.8339, longitude: -97.0611, radiusMiles: 25 },
      minFitScore: 60
    },
    sequence: [{
      delayDays: 0,
      subjectTemplate: "A SandFest partnership for {{organization}}",
      bodyTemplate: "Hello {{contactName}}, may we share the Texas SandFest sponsor program with {{organization}}?"
    }]
  };
  const unauthenticatedPostgresCampaignPreview = await request(base, "POST", "/api/admin/outreach/campaigns/preview", postgresCampaignPayload);
  const postgresCampaignPreview = await request(base, "POST", "/api/admin/outreach/campaigns/preview", postgresCampaignPayload, { auth: true });
  const postgresAfterCampaignPreview = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  check("Postgres campaign preflight is private and mutation-free", unauthenticatedPostgresCampaignPreview.status === 401 && postgresCampaignPreview.status === 200 && postgresCampaignPreview.data.preview?.matched === 1 && postgresCampaignPreview.data.preview?.matches?.[0]?.organizationName === "Postgres Island Hotel" && !("contactEmail" in postgresCampaignPreview.data.preview.matches[0]) && postgresCampaignPreview.data.preview.sample?.sequence?.[0]?.subject === "A SandFest partnership for Postgres Island Hotel" && postgresAfterCampaignPreview.data.campaigns?.length === postgresDiscoveryResearched.data.campaigns?.length);
  const campaign = await request(base, "POST", "/api/admin/outreach/campaigns", postgresCampaignPayload, { auth: true });
  check("outreach campaign persisted", campaign.status === 201 && campaign.data.campaign?.id, `status ${campaign.status}`);
  const campaignId = campaign.data.campaign?.id;
  const activation = await request(base, "POST", `/api/admin/outreach/campaigns/${campaignId}/activate`, {}, { auth: true });
  check("campaign activation atomically seeds and audits the opening message", activation.status === 200 && activation.data.campaign?.status === "active" && activation.data.generated === 1, `status ${activation.status} generated ${activation.data.generated ?? "missing"}`);
  const generated = await request(base, "POST", `/api/admin/outreach/campaigns/${campaignId}/generate`, {}, { auth: true });
  const repeated = await request(base, "POST", `/api/admin/outreach/campaigns/${campaignId}/generate`, {}, { auth: true });
  check("campaign draft generated once", generated.data.generated === 0 && repeated.data.generated === 0, `${generated.data.generated}/${repeated.data.generated}`);
  const outreach = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  const outreachDrafts = outreach.data.followups?.filter(item => item.campaignId === campaignId) || [];
  const persistedGeoCampaign = outreach.data.campaigns?.find(item => item.id === campaignId);
  check("personalized geofenced draft persisted", outreachDrafts.length === 1 && outreachDrafts[0].subject.includes("Postgres Island Hotel") && persistedGeoCampaign?.metrics?.matched === 1 && persistedGeoCampaign?.targeting?.geofence?.radiusMiles === 25);
  const movedOutreachProspect = await request(base, "PATCH", `/api/admin/outreach/prospects/${prospect.data.prospect?.id}`, {
    city: "Austin",
    postalCode: "78701",
    latitude: 30.2672,
    longitude: -97.7431
  }, { auth: true });
  const movedOutreach = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  const movedCampaign = movedOutreach.data.campaigns?.find(item => item.id === campaignId);
  const dismissedGeoDraft = movedOutreach.data.followups?.find(item => item.id === outreachDrafts[0]?.id);
  check("Postgres geofence change dismisses draft", movedOutreachProspect.status === 200 && movedOutreachProspect.data.prospect?.postalCode === "78701" && movedCampaign?.metrics?.matched === 0 && dismissedGeoDraft?.status === "dismissed");
  const postgresPreferenceUrl = outreachDrafts[0]?.body?.match(/https:\/\/\S+#outreach-preferences\?\S+/)?.[0];
  const postgresPreferenceHash = postgresPreferenceUrl ? new URL(postgresPreferenceUrl).hash : "";
  const postgresPreferenceParams = new URLSearchParams(postgresPreferenceHash.slice(postgresPreferenceHash.indexOf("?") + 1));
  const postgresPreferenceAccess = { prospectId: postgresPreferenceParams.get("prospect"), token: postgresPreferenceParams.get("token") };
  const postgresPreferenceStatus = await request(base, "POST", "/api/public/outreach-preferences", postgresPreferenceAccess);
  const postgresPreferenceUnsubscribe = await request(base, "POST", "/api/public/outreach-preferences/unsubscribe", postgresPreferenceAccess);
  const postgresPreferenceRepeat = await request(base, "POST", "/api/public/outreach-preferences/unsubscribe", postgresPreferenceAccess);
  const postgresSuppressedOutreach = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  const postgresSuppressedProspect = postgresSuppressedOutreach.data.prospects?.find(item => item.id === prospect.data.prospect?.id);
  check("Postgres public outreach preference persists", postgresPreferenceStatus.status === 200 && postgresPreferenceStatus.data.preference?.status === "subscribed" && postgresPreferenceUnsubscribe.data.preference?.status === "unsubscribed" && postgresPreferenceRepeat.data.duplicate === true && postgresSuppressedProspect?.status === "do_not_contact");

  const stampBody = { attendeeRef: "postgres_test_attendee", payload: "tsf:cp:cp_ent_dune_dragon", method: "qr_scan" };
  const firstStamp = await request(base, "POST", "/api/public/passport/stamp", stampBody);
  const repeatedStamp = await request(base, "POST", "/api/public/passport/stamp", stampBody);
  check("passport completion idempotent", firstStamp.status === 201 && repeatedStamp.status === 200 && repeatedStamp.data.alreadyStamped === true);

  const firstVote = await request(base, "POST", "/api/public/voting", {
    attendeeRef: "postgres_test_voter",
    entryId: "ent_lace_tide",
    channel: "web"
  });
  const changedVote = await request(base, "POST", "/api/public/voting", {
    attendeeRef: "postgres_test_voter",
    entryId: "ent_tidal_guardian",
    channel: "web"
  });
  const myVote = await request(base, "GET", "/api/public/voting/me?attendeeRef=postgres_test_voter");
  check("People's Choice vote upsert", firstVote.status === 201 && changedVote.status === 201 && myVote.data.vote?.entryId === "ent_tidal_guardian");

  const observedAt = new Date().toISOString();
  const armedCamera = await request(base, "PATCH", "/api/admin/island-conditions/cameras/ferry-loading", {
    sourceId: "txdot-ferry-loading",
    status: "configured",
    staleAfterMinutes: 10,
    monitoringEnabled: true
  }, { auth: true });
  const heartbeatBody = JSON.stringify({
    heartbeatId: "pg-camera-heartbeat-0001",
    sourceId: "txdot-ferry-loading",
    observedAt,
    status: "healthy",
    agentId: "postgres-camera-agent",
    framesPerSecond: 10.5,
    inferenceLatencyMs: 61,
    droppedFramePct: 0.4,
    agentVersion: "pg-test-1"
  });
  const heartbeatTimestamp = String(Math.floor(Date.now() / 1000));
  const heartbeatSignature = signCameraPayload(heartbeatBody, heartbeatTimestamp, CAMERA_SECRET, { keyId: CAMERA_KEY_ID });
  const heartbeatHeaders = {
    "x-sandfest-timestamp": heartbeatTimestamp,
    "x-sandfest-camera-key-id": CAMERA_KEY_ID,
    "x-sandfest-signature": `sha256=${heartbeatSignature}`
  };
  const firstHeartbeat = await request(base, "POST", "/api/ingest/cameras/ferry-loading/heartbeat", undefined, { rawBody: heartbeatBody, headers: heartbeatHeaders });
  const repeatedHeartbeat = await request(base, "POST", "/api/ingest/cameras/ferry-loading/heartbeat", undefined, { rawBody: heartbeatBody, headers: heartbeatHeaders });
  const cameraBody = JSON.stringify({
    eventId: "pg-camera-event-0001",
    sourceId: "txdot-ferry-loading",
    observedAt,
    vehicleCount: 34,
    queueLength: 18,
    estimatedWaitMinutes: 22,
    confidence: 0.91
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signCameraPayload(cameraBody, timestamp, CAMERA_SECRET, { keyId: CAMERA_KEY_ID });
  const cameraHeaders = {
    "x-sandfest-timestamp": timestamp,
    "x-sandfest-camera-key-id": CAMERA_KEY_ID,
    "x-sandfest-signature": `sha256=${signature}`
  };
  const firstCamera = await request(base, "POST", "/api/ingest/cameras/ferry-loading/observations", undefined, { rawBody: cameraBody, headers: cameraHeaders });
  const repeatedCamera = await request(base, "POST", "/api/ingest/cameras/ferry-loading/observations", undefined, { rawBody: cameraBody, headers: cameraHeaders });
  const crossCamera = await request(base, "POST", "/api/ingest/cameras/north-gate/observations", undefined, { rawBody: cameraBody, headers: cameraHeaders });
  check("camera monitoring activation persisted", armedCamera.status === 200 && armedCamera.data.camera?.monitoringEnabled === true);
  check("signed camera heartbeat idempotent", firstHeartbeat.status === 201 && repeatedHeartbeat.status === 200 && repeatedHeartbeat.data.duplicate === true);
  check("signed camera metric idempotent", firstCamera.status === 201 && firstCamera.data.incidentAction === "opened" && repeatedCamera.status === 200 && repeatedCamera.data.duplicate === true);
  check("Postgres camera credential cannot cross routes", crossCamera.status === 401 && crossCamera.data.error === "Camera ingest authentication failed.");
  const publicConditions = await request(base, "GET", "/api/public/island-conditions");
  const adminConditions = await request(base, "GET", "/api/admin/island-conditions", undefined, { auth: true });
  const publicCamera = publicConditions.data.cameras?.find(item => item.id === "ferry-loading");
  const adminCamera = adminConditions.data.cameras?.find(item => item.id === "ferry-loading");
  const cameraIncident = adminConditions.data.incidents?.find(item => item.sourceType === "camera_condition" && item.sourceId === "ferry-loading");
  check("camera health persists in Postgres", adminCamera?.health?.agentId === "postgres-camera-agent" && adminCamera?.operationalStatus === "live");
  check("camera payload is metrics-only", publicCamera?.observation?.vehicleCount === 34 && publicCamera?.operationalStatus === "live" && !("modelName" in (publicCamera?.observation || {})) && !("health" in (publicCamera || {})));
  check("camera incident persists in Postgres", cameraIncident?.status === "open" && cameraIncident?.severity === "critical" && adminConditions.data.incidentSummary?.active === 1);
  const assignedCameraIncident = await request(base, "PATCH", `/api/admin/island-conditions/incidents/${cameraIncident?.id}`, {
    status: "responding",
    ownerTeam: "traffic",
    ownerName: "Postgres traffic desk",
    publicImpact: true,
    note: "Traffic team dispatched."
  }, { auth: true });
  const persistedIncidentState = await request(base, "GET", "/api/admin/island-conditions", undefined, { auth: true });
  const persistedCameraIncident = persistedIncidentState.data.incidents?.find(item => item.id === cameraIncident?.id);
  const publicIncidentState = await request(base, "GET", "/api/public/island-conditions");
  const persistedNotice = publicIncidentState.data.notices?.find(item => item.id === cameraIncident?.id);
  check("camera incident lifecycle persists", assignedCameraIncident.status === 200 && persistedCameraIncident?.status === "responding" && persistedCameraIncident?.ownerName === "Postgres traffic desk");
  check("public incident notice remains private", persistedNotice?.severity === "critical" && !("ownerName" in (persistedNotice || {})) && !("timeline" in (persistedNotice || {})));
  const dispatchPath = `/api/admin/island-conditions/incidents/${cameraIncident?.id}/dispatches`;
  const dispatchInput = {
    assigneeType: "team",
    assigneeId: "traffic",
    channel: "email",
    title: "Open secondary ferry lane",
    instructions: "Confirm lane readiness and report to incident command."
  };
  const createdDispatch = await request(base, "POST", dispatchPath, dispatchInput, { auth: true });
  const repeatedDispatch = await request(base, "POST", dispatchPath, dispatchInput, { auth: true });
  const dispatchId = createdDispatch.data.dispatch?.id;
  const updatedDispatch = await request(base, "PATCH", `${dispatchPath}/${dispatchId}`, {
    status: "on_scene",
    subject: "SandFest ferry lane response",
    body: "Open the secondary ferry lane and report status to incident command."
  }, { auth: true });
  const approvedDispatch = await request(base, "POST", `${dispatchPath}/${dispatchId}/review`, { action: "approve" }, { auth: true });
  const queuedDispatchSend = await request(base, "POST", `${dispatchPath}/${dispatchId}/send`, {}, { auth: true });
  const persistedDispatchState = await request(base, "GET", "/api/admin/island-conditions", undefined, { auth: true });
  const persistedDispatch = persistedDispatchState.data.dispatches?.find(item => item.id === dispatchId);
  check("incident dispatch persists and deduplicates", createdDispatch.status === 201 && repeatedDispatch.status === 200 && repeatedDispatch.data.duplicate === true && persistedDispatchState.data.dispatches?.filter(item => item.id === dispatchId).length === 1);
  check("incident dispatch review persists", updatedDispatch.status === 200 && approvedDispatch.data.dispatch?.notification?.status === "approved" && persistedDispatch?.status === "on_scene" && persistedDispatch?.notification?.recipientAvailable === true && !("recipient" in (persistedDispatch?.notification || {})));
  check("incident dispatch delivery queues with provider ready", queuedDispatchSend.status === 202 && queuedDispatchSend.data.job?.status === "queued" && queuedDispatchSend.data.email?.ready === true);

  console.log("\n=== Postgres worker and audit durability ===\n");
  await runChild(["scripts/worker.mjs"], {
    ...commonEnv,
    SANDFEST_WORKER_ONCE: "true",
    SANDFEST_WORKER_BATCH: "50"
  }, "Postgres worker");
  const jobs = await listJobs(ROOT, { limit: 100 });
  check("worker completed intake, extraction, recovery, and dispatch jobs", jobs.length === 17 && jobs.every(job => job.status === "done"), `${jobs.filter(job => job.status === "done").length}/${jobs.length} done`);
  const workerStatus = await readPlatformDoc(ROOT, "workerStatus", null);
  check("worker heartbeat persisted", workerStatus?.state === "stopped" && workerStatus?.lastBatchSize === 17);
  const postgresDocumentsAfterWorker = await request(base, "GET", "/api/admin/documents", undefined, { auth: true });
  const extractedPostgresBoardBriefing = postgresDocumentsAfterWorker.data.documents?.find(item => item.id === postgresBoardBriefingUpload.data.document?.id);
  check("Postgres worker persists extracted board briefing", extractedPostgresBoardBriefing?.extractionStatus === "ready" && extractedPostgresBoardBriefing?.textPreview?.includes("TEXAS SANDFEST") && extractedPostgresBoardBriefing?.extractedCharacterCount > 5_000 && extractedPostgresBoardBriefing?.extractedChunkCount > 0 && !JSON.stringify(extractedPostgresBoardBriefing).includes("extractionChunks"));
  const partnerDocAfterWorker = await readPlatformDoc(ROOT, "partnerOps", null);
  const repairedPostgresDocumentTasks = partnerDocAfterWorker?.tasks?.filter(task => task.relatedEntityType === "incoming_document" && task.relatedEntityId === postgresDocument.id) || [];
  check("worker repairs missing document review routing", workerStatus?.lastReconciledDocumentReviewTasks === 1 && repairedPostgresDocumentTasks.length === 1 && repairedPostgresDocumentTasks[0]?.status === "in_progress" && repairedPostgresDocumentTasks[0]?.assigneeId === "operations");
  const sponsorAcknowledgment = partnerDocAfterWorker?.followups?.find(item => item.applicationId === sponsorApplication.id && item.kind === "application_received");
  const deliveredPortalRecovery = partnerDocAfterWorker?.followups?.find(item => item.applicationId === sponsorApplication.id && item.kind === "portal_access_recovery");
  const portalRecoveryDelivery = emailMock.deliveries.find(item => item.body.subject === "Your Texas SandFest partner portal link");
  check("worker delivers the current recovered portal capability", deliveredPortalRecovery?.status === "sent" && portalRecoveryDelivery?.body.to?.[0]?.email === "sponsor@postgres-test.example" && portalRecoveryDelivery?.body.textContent?.includes(rotatedPortal.data.portalAccess?.url));
  check("worker acknowledgment includes secure portal link", sponsorAcknowledgment?.status === "draft_ready" && sponsorAcknowledgment.body.includes("#partner-status?reference="));
  const sponsorMilestoneReminder = partnerDocAfterWorker?.followups?.find(item => item.milestoneId === defaultSponsorMilestone?.id && item.kind === "milestone_reminder");
  check("worker persists versioned milestone reminder", sponsorMilestoneReminder?.sourceVersion === "schedule:2:phase:upcoming" && sponsorMilestoneReminder?.status === "draft_ready");
  const volunteerTaskNotice = partnerDocAfterWorker?.followups?.find(item => item.taskId === notifiedVolunteerTask.data.task?.id && item.kind === "task_assignment");
  const taskWorkspaceAfterWorker = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const privateVolunteerTaskNotice = taskWorkspaceAfterWorker.data.followups?.find(item => item.id === volunteerTaskNotice?.id);
  check("worker persists privacy-safe task assignment notice", volunteerTaskNotice?.status === "draft_ready" && volunteerTaskNotice?.recipient === "alex@example.com" && volunteerTaskNotice?.body.includes("#task-status?task=") && volunteerTaskNotice?.body.includes("&token=tsft_") && privateVolunteerTaskNotice?.recipientAvailable === true && privateVolunteerTaskNotice?.recipientLabel === "Alex Rivera" && !("recipient" in (privateVolunteerTaskNotice || {})));
  const deliveredDispatchState = await request(base, "GET", "/api/admin/island-conditions", undefined, { auth: true });
  const deliveredDispatch = deliveredDispatchState.data.dispatches?.find(item => item.id === dispatchId);
  const dispatchDelivery = emailMock.deliveries.find(item => item.body.to?.[0]?.email === "postgres-traffic@example.com");
  check("worker delivers incident dispatch through provider", deliveredDispatch?.notification?.status === "sent" && deliveredDispatch.notification.providerMessageId === dispatchDelivery?.messageId && dispatchDelivery?.headers["api-key"] === "postgres-brevo-api-key");

  const smsBefore = await request(base, "GET", "/api/admin/sms", undefined, { auth: true });
  const postgresAlert = {
    active: true,
    severity: "warning",
    title: "Postgres safety hold",
    message: "Please follow the marked shelter route.",
    audience: ["public"],
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString()
  };
  const alertWithoutSms = await request(base, "PATCH", "/api/admin/alert", postgresAlert, { auth: true });
  const alertWithSms = await request(base, "PATCH", "/api/admin/alert", { ...postgresAlert, sendSms: true }, { auth: true });
  const smsPool = await getPool();
  const smsJobRows = await smsPool.query("SELECT payload FROM platform_jobs WHERE type = 'sms.alert.send' ORDER BY created_at");
  const smsJobJson = JSON.stringify(smsJobRows.rows);
  check("Postgres alert SMS remains explicit and consent-referenced", alertWithoutSms.data.sms == null && alertWithSms.data.sms?.queued === smsBefore.data.eligibleSafetyRecipients && smsJobRows.rowCount === smsBefore.data.eligibleSafetyRecipients);
  check("Postgres SMS jobs persist no phone number", !smsJobJson.includes("+13615550188") && !smsJobJson.includes("361-555-0188") && !smsJobJson.includes("recipientPhones"));

  await runChild(["scripts/worker.mjs"], {
    ...commonEnv,
    SANDFEST_WORKER_ONCE: "true",
    SANDFEST_WORKER_BATCH: "50"
  }, "Postgres SMS worker");
  const providerSms = twilioMock.deliveries[0];
  const statusCallback = new URL(providerSms.body.get("StatusCallback"));
  const signedDelivery = await requestTwilioForm(base, `${statusCallback.pathname}${statusCallback.search}`, statusCallback.toString(), {
    MessageSid: providerSms.sid,
    MessageStatus: "delivered"
  });
  const smsAfterDelivery = await request(base, "GET", "/api/admin/sms", undefined, { auth: true });
  const privateSmsDoc = await readPlatformDoc(ROOT, "smsOperations", null);
  check("Postgres SMS worker submits each currently eligible recipient", twilioMock.deliveries.length === smsBefore.data.eligibleSafetyRecipients && twilioMock.deliveries.every(item => item.body.get("StatusCallback")?.includes("message=")));
  check("Postgres signed SMS delivery persists aggregate evidence", signedDelivery.status === 200 && smsAfterDelivery.data.summary?.messages?.delivered === 1 && !JSON.stringify(smsAfterDelivery.data).includes(providerSms.sid));
  check("Postgres SMS delivery document remains private", !JSON.stringify(privateSmsDoc).includes("+13615550188") && !JSON.stringify(privateSmsDoc).includes("Please follow the marked shelter route."));

  const safetyInboundUrl = `${base}/api/webhooks/twilio/inbound/smsSafety`;
  const stoppedSafetySms = await requestTwilioForm(base, "/api/webhooks/twilio/inbound/smsSafety", safetyInboundUrl, {
    From: "+13615550188",
    To: "+15125550000",
    MessageSid: "SM_postgres_stop_001",
    Body: "STOP",
    OptOutType: "STOP"
  });
  const smsAfterStop = await request(base, "GET", "/api/admin/sms", undefined, { auth: true });
  check("Postgres signed STOP persists safety consent", stoppedSafetySms.status === 200 && smsAfterStop.data.eligibleSafetyRecipients === smsBefore.data.eligibleSafetyRecipients - 1 && smsAfterStop.data.summary?.preferences?.STOP === 1);

  const approvedAcknowledgment = await request(base, "POST", `/api/admin/partners/followups/${sponsorAcknowledgment.id}/review`, { action: "approve" }, { auth: true });
  const queuedAcknowledgment = await request(base, "POST", `/api/admin/partners/followups/${sponsorAcknowledgment.id}/send`, {}, { auth: true });
  await runChild(["scripts/worker.mjs"], {
    ...commonEnv,
    SANDFEST_WORKER_ONCE: "true",
    SANDFEST_WORKER_BATCH: "50"
  }, "Postgres email delivery worker");
  const partnerDocAfterDelivery = await readPlatformDoc(ROOT, "partnerOps", null);
  const deliveredAcknowledgment = partnerDocAfterDelivery?.followups?.find(item => item.id === sponsorAcknowledgment.id);
  const acknowledgmentDelivery = emailMock.deliveries.find(item => item.body.to?.[0]?.email === "sponsor@postgres-test.example" && item.body.subject === deliveredAcknowledgment?.subject);
  check("approved acknowledgment queues for delivery", approvedAcknowledgment.data.followup?.status === "approved" && queuedAcknowledgment.status === 202);
  check("worker persists applicant email delivery proof", deliveredAcknowledgment?.status === "sent" && deliveredAcknowledgment.providerMessageId === acknowledgmentDelivery?.messageId && acknowledgmentDelivery?.body.textContent?.includes("#partner-status?reference=") && acknowledgmentDelivery?.body.replyTo?.email === "info@texassandfest.org");

  const brevoDeliveryEvent = {
    event: "delivered",
    email: "sponsor@postgres-test.example",
    id: 88001,
    date: new Date().toISOString(),
    "message-id": `<${acknowledgmentDelivery?.messageId}>`,
    subject: deliveredAcknowledgment?.subject
  };
  const unauthenticatedBrevoEvent = await request(base, "POST", "/api/webhooks/brevo", brevoDeliveryEvent);
  const persistedBrevoEvent = await request(base, "POST", "/api/webhooks/brevo", brevoDeliveryEvent, {
    headers: { authorization: `Bearer ${BREVO_WEBHOOK_TOKEN}` }
  });
  const replayedBrevoEvent = await request(base, "POST", "/api/webhooks/brevo", brevoDeliveryEvent, {
    headers: { authorization: `Bearer ${BREVO_WEBHOOK_TOKEN}` }
  });
  const trackedPartnerWorkspace = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const trackedAcknowledgment = trackedPartnerWorkspace.data.followups?.find(item => item.id === sponsorAcknowledgment.id);
  check("Brevo webhook uses separate integration authentication", unauthenticatedBrevoEvent.status === 401 && persistedBrevoEvent.status === 200);
  check("Brevo delivery state persists idempotently in Postgres", persistedBrevoEvent.data.matched === 1 && replayedBrevoEvent.data.duplicates === 1 && trackedAcknowledgment?.deliveryStatus === "delivered" && trackedAcknowledgment?.deliveryEvents?.length === 1);

  const automationProspect = await request(base, "POST", "/api/admin/outreach/prospects", {
    organizationName: "Postgres Automation Hotel",
    contactName: "Jordan Lee",
    contactEmail: "outreach-review@postgres-auto.example",
    industry: "hospitality",
    city: "Port Aransas",
    state: "TX",
    postalCode: "78373",
    latitude: 27.8339,
    longitude: -97.0611,
    contactBasis: "business_relevance",
    status: "contact_ready"
  }, { auth: true });
  const automationOutreachGeneration = await request(base, "POST", `/api/admin/outreach/campaigns/${campaignId}/generate`, {}, { auth: true });
  const manualOutreachWorkspace = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  const manualOutreachDraft = manualOutreachWorkspace.data.followups?.find(item => item.prospectId === automationProspect.data.prospect?.id && item.campaignId === campaignId && item.kind === "sponsor_outreach");
  const manualOutreachApproval = await request(base, "POST", `/api/admin/partners/followups/${manualOutreachDraft?.id}/review`, { action: "approve" }, { auth: true });
  const manualOutreachQueue = await request(base, "POST", `/api/admin/partners/followups/${manualOutreachDraft?.id}/send`, {}, { auth: true });
  const pausedManualOutreach = await request(base, "POST", `/api/admin/outreach/campaigns/${campaignId}/pause`, {}, { auth: true });
  const approvedSequenceCampaign = await request(base, "POST", "/api/admin/outreach/campaigns", {
    name: "Postgres approved sponsor sequence",
    objective: "Prove bounded campaign-approved delivery",
    deliveryMode: "approved_sequence",
    dailySendLimit: 1,
    targeting: {
      industries: ["hospitality"],
      cities: ["Port Aransas"],
      states: ["TX"],
      postalCodes: ["78373"],
      minFitScore: 60
    },
    sequence: [{
      delayDays: 0,
      subjectTemplate: "Approved SandFest outreach for {{organization}}",
      bodyTemplate: "Hello {{contactName}}, may we share the approved Texas SandFest sponsor program?"
    }]
  }, { auth: true });
  const approvedSequenceCampaignId = approvedSequenceCampaign.data.campaign?.id;
  const approvedSequenceActivation = await request(base, "POST", `/api/admin/outreach/campaigns/${approvedSequenceCampaignId}/activate`, {}, { auth: true });
  const automationMode = await request(base, "PATCH", "/api/admin/partners/automation", { mode: "transactional_auto" }, { auth: true });
  const automaticIntake = await request(base, "POST", "/api/public/sponsor-inquiries", {
    organizationName: "Postgres Automatic Sponsor",
    contactName: "Casey Morgan",
    contactEmail: "automatic-sponsor@postgres-auto.example",
    contactPhone: "361-555-0199",
    packageId: "tarpon",
    consentToContact: true
  }, { headers: { "idempotency-key": "postgres-automatic-sponsor-intake-0001" } });
  check(
    "transactional automation enables only with provider ready",
    automationProspect.status === 201 && automationOutreachGeneration.data.generated === 1 && manualOutreachApproval.status === 200 && manualOutreachQueue.status === 202 && pausedManualOutreach.status === 200 && approvedSequenceCampaign.status === 201 && approvedSequenceActivation.status === 200 && approvedSequenceActivation.data.automation?.active === true && automationMode.status === 200 && automationMode.data.automation?.active === true && automaticIntake.status === 201,
    `prospect=${automationProspect.status} generated=${automationOutreachGeneration.data.generated ?? "missing"} manual=${manualOutreachApproval.status}:${manualOutreachQueue.status}:${pausedManualOutreach.status} campaign=${approvedSequenceCampaign.status}:${approvedSequenceActivation.status} mode=${automationMode.status}:${automationMode.data.error || automationMode.data.automation?.mode || "missing"} intake=${automaticIntake.status}`
  );
  await runChild(["scripts/worker.mjs"], {
    ...commonEnv,
    SANDFEST_WORKER_ONCE: "true",
    SANDFEST_WORKER_BATCH: "50"
  }, "Postgres automation draft worker");
  await runChild(["scripts/worker.mjs"], {
    ...commonEnv,
    SANDFEST_WORKER_ONCE: "true",
    SANDFEST_WORKER_BATCH: "50"
  }, "Postgres automation delivery worker");
  await runChild(["scripts/worker.mjs"], {
    ...commonEnv,
    SANDFEST_WORKER_ONCE: "true",
    SANDFEST_WORKER_BATCH: "50"
  }, "Postgres automation replay worker");
  const automatedPartnerDoc = await readPlatformDoc(ROOT, "partnerOps", null);
  const automatedOutreachWorkspace = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  const automatedCampaignMetrics = automatedOutreachWorkspace.data.campaigns?.find(item => item.id === approvedSequenceCampaignId)?.metrics;
  const automatedAcknowledgment = automatedPartnerDoc?.followups?.find(item => item.applicationId === automaticIntake.data.application?.id && item.kind === "application_received");
  const reviewGatedOutreach = automatedPartnerDoc?.followups?.find(item => item.prospectId === automationProspect.data.prospect?.id && item.campaignId === campaignId && item.kind === "sponsor_outreach");
  const automatedOutreach = automatedPartnerDoc?.followups?.find(item => item.prospectId === automationProspect.data.prospect?.id && item.campaignId === approvedSequenceCampaignId && item.kind === "sponsor_outreach");
  const automatedTaskNotice = automatedPartnerDoc?.followups?.find(item => item.id === volunteerTaskNotice?.id);
  const taskNoticeDeliveries = emailMock.deliveries.filter(item => item.body.tags?.includes(followupProviderTag(automatedTaskNotice?.id)));
  const automaticDeliveries = emailMock.deliveries.filter(item => item.body.tags?.includes(followupProviderTag(automatedAcknowledgment?.id)));
  const automatedOutreachDeliveries = emailMock.deliveries.filter(item => item.body.tags?.includes(followupProviderTag(automatedOutreach?.id)));
  const automaticallySentFollowups = automatedPartnerDoc?.followups?.filter(item => item.status === "sent" && item.automationPolicy === "partner_transactional_v1") || [];
  const automationPool = await getPool();
  const automationJobRows = await automationPool.query("SELECT id, status FROM platform_jobs WHERE id = $1", [automatedAcknowledgment?.automationJobId]);
  const manualOutreachJobRows = await automationPool.query("SELECT id, status, attempts FROM platform_jobs WHERE id = $1", [manualOutreachQueue.data.job?.id]);
  check(
    "worker auto-delivers known-partner transaction once",
    automatedAcknowledgment?.status === "sent" && automatedAcknowledgment?.approvedBy === "automation:partner_transactional_v1" && automatedAcknowledgment?.automationPolicy === "partner_transactional_v1" && automaticDeliveries.length === 1 && automationJobRows.rowCount === 1 && automationJobRows.rows[0]?.status === "done",
    `followup=${automatedAcknowledgment?.status || "missing"} approved=${automatedAcknowledgment?.approvedBy || "missing"} policy=${automatedAcknowledgment?.automationPolicy || "missing"} job=${automatedAcknowledgment?.automationJobId || "missing"}:${automationJobRows.rows[0]?.status || "missing"} deliveries=${automaticDeliveries.length} error=${automatedAcknowledgment?.lastError || "none"}`
  );
  check("worker keeps default sponsor outreach review gated", reviewGatedOutreach?.status === "draft_ready" && !reviewGatedOutreach?.approvedAt && !emailMock.deliveries.some(item => item.body.tags?.includes(followupProviderTag(reviewGatedOutreach?.id))));
  check("worker cancels a withdrawn manual send without retry", manualOutreachJobRows.rowCount === 1 && manualOutreachJobRows.rows[0]?.status === "done" && Number(manualOutreachJobRows.rows[0]?.attempts) === 1 && !emailMock.deliveries.some(item => item.body.tags?.includes(followupProviderTag(manualOutreachDraft?.id))));
  check("worker delivers one campaign-approved sponsor message", automatedOutreach?.status === "sent" && automatedOutreach?.approvedBy === "automation:outreach_campaign_v1" && automatedOutreach?.automationPolicy === "outreach_campaign_v1" && automatedOutreachDeliveries.length === 1 && automatedOutreachDeliveries[0]?.body.to?.[0]?.email === "outreach-review@postgres-auto.example");
  check("Postgres campaign funnel counts unique reached businesses without inventing provider outcomes", automatedCampaignMetrics?.funnel?.enrolled === 1 && automatedCampaignMetrics?.funnel?.reached === 1 && automatedCampaignMetrics?.funnel?.delivered === 0 && automatedCampaignMetrics?.funnel?.applications === 0 && !JSON.stringify(automatedCampaignMetrics).includes("outreach-review@postgres-auto.example"));
  check("worker auto-delivers volunteer task assignment once", automatedTaskNotice?.status === "sent" && automatedTaskNotice?.deliveryStatus === "accepted" && automatedTaskNotice?.approvedBy === "automation:partner_transactional_v1" && taskNoticeDeliveries.length === 1 && taskNoticeDeliveries[0]?.body.to?.[0]?.email === "alex@example.com");
  check("every automated follow-up has one provider call", automaticallySentFollowups.length > 0 && automaticallySentFollowups.every(followup => emailMock.deliveries.filter(item => item.body.tags?.includes(followupProviderTag(followup.id))).length === 1));
  check("transactional automation records activity proof", automatedPartnerDoc?.activity?.some(item => item.type === "automation.mode_changed" && item.actorId === "postgres-test-admin") && automatedPartnerDoc?.activity?.some(item => item.type === "followup.auto_approved" && item.entityId === automatedAcknowledgment?.id));
  const capacityRaceFollowupId = "followup_postgres_capacity_race";
  const capacityRaceApprovedAt = new Date().toISOString();
  await updatePlatformDoc(ROOT, "partnerOps", current => {
    const campaign = current.campaigns.find(item => item.id === approvedSequenceCampaignId);
    const source = current.followups.find(item => item.id === automatedOutreach?.id);
    return {
      ...current,
      lastUpdated: capacityRaceApprovedAt,
      followups: [...current.followups, {
        ...source,
        id: capacityRaceFollowupId,
        status: "approved",
        approvedBy: "automation:outreach_campaign_v1",
        approvedAt: capacityRaceApprovedAt,
        automationPolicy: "outreach_campaign_v1",
        automationDecision: "campaign_approved",
        automationApprovedAt: capacityRaceApprovedAt,
        automationCampaignApprovedAt: campaign?.approvedAt,
        automationJobId: null,
        automationQueuedAt: null,
        queuedAt: null,
        deliveryClaimId: null,
        deliveryClaimedAt: null,
        providerSubmissionStartedAt: null,
        deliveryIdempotencyKey: null,
        sentAt: null,
        provider: null,
        providerMessageId: null,
        deliveryStatus: null,
        deliveryAttempts: 0,
        deliveryEvents: [],
        lastAttemptAt: null,
        lastError: null,
        createdAt: capacityRaceApprovedAt,
        updatedAt: capacityRaceApprovedAt
      }]
    };
  }, { fallback: emptyPartnerOperations() });
  const capacityRaceJob = await enqueueJob(ROOT, {
    type: "partner.followup.send",
    payload: {
      followupId: capacityRaceFollowupId,
      automated: true,
      automationPolicy: "outreach_campaign_v1"
    },
    maxAttempts: 5,
    idempotencyKey: `outreach_campaign_v1:${capacityRaceFollowupId}:${capacityRaceApprovedAt}`
  });
  await runChild(["scripts/worker.mjs"], {
    ...commonEnv,
    SANDFEST_WORKER_ONCE: "true",
    SANDFEST_WORKER_BATCH: "50"
  }, "Postgres campaign capacity race worker");
  const capacityRaceDoc = await readPlatformDoc(ROOT, "partnerOps", null);
  const releasedCapacityRace = capacityRaceDoc?.followups?.find(item => item.id === capacityRaceFollowupId);
  const capacityRaceJobState = (await listJobs(ROOT, { limit: 1000 })).find(item => item.id === capacityRaceJob.id);
  check("campaign capacity race releases approval without provider delivery", releasedCapacityRace?.status === "draft_ready" && releasedCapacityRace?.approvedBy === null && releasedCapacityRace?.automationPolicy === null && releasedCapacityRace?.automationDecision === "daily_capacity_released" && capacityRaceJobState?.status === "done" && Number(capacityRaceJobState?.attempts) === 1 && !emailMock.deliveries.some(item => item.body.tags?.includes(followupProviderTag(capacityRaceFollowupId))));
  const reviewFirstMode = await request(base, "PATCH", "/api/admin/partners/automation", { mode: "review_first" }, { auth: true });
  check("transactional automation can be returned to review-first", reviewFirstMode.status === 200 && reviewFirstMode.data.automation?.mode === "review_first" && reviewFirstMode.data.automation?.active === false);

  const closedCameraIncident = await request(base, "PATCH", `/api/admin/island-conditions/incidents/${cameraIncident?.id}`, {
    status: "resolved",
    resolution: "Secondary ferry lane is open and traffic is moving."
  }, { auth: true });
  const closedDispatchState = await request(base, "GET", "/api/admin/island-conditions", undefined, { auth: true });
  const canceledDispatch = closedDispatchState.data.dispatches?.find(item => item.id === dispatchId);
  const publicAfterDispatch = await request(base, "GET", "/api/public/island-conditions");
  check("incident close preserves sent proof", closedCameraIncident.status === 200 && canceledDispatch?.status === "canceled" && canceledDispatch?.notification?.status === "sent");
  check("public conditions exclude dispatch records", !("dispatches" in publicAfterDispatch.data));

  const idempotentQueueInput = {
    type: "partner.followup.send",
    payload: { followupId: "postgres-idempotent-followup" },
    idempotencyKey: "partner_transactional_v1:postgres-idempotent-followup:2026-07-16T12:00:00.000Z"
  };
  const [idempotentQueueA, idempotentQueueB] = await Promise.all([
    enqueueJob(ROOT, idempotentQueueInput),
    enqueueJob(ROOT, idempotentQueueInput)
  ]);
  const idempotentQueuePool = await getPool();
  const idempotentQueueRows = await idempotentQueuePool.query("SELECT id FROM platform_jobs WHERE id = $1", [idempotentQueueA.id]);
  const idempotentQueueClaim = await claimNextJobs(ROOT, { types: ["partner.followup.send"], workerId: "postgres-idempotency-worker" });
  await completeJob(ROOT, idempotentQueueClaim.find(item => item.id === idempotentQueueA.id));
  const idempotentQueueReplay = await enqueueJob(ROOT, idempotentQueueInput);
  check("Postgres idempotent enqueue converges", idempotentQueueA.id === idempotentQueueB.id && idempotentQueueRows.rowCount === 1 && idempotentQueueReplay.status === "done");

  const leaseMs = 10_000;
  const leasedJob = await enqueueJob(ROOT, { type: "queue.lease.probe", maxAttempts: 3 });
  const firstClaimAt = Date.now() + 100;
  const firstLease = await claimNextJobs(ROOT, { types: ["queue.lease.probe"], workerId: "postgres-worker-a", leaseMs, now: firstClaimAt });
  const duplicateLease = await claimNextJobs(ROOT, { types: ["queue.lease.probe"], workerId: "postgres-worker-b", leaseMs, now: firstClaimAt + leaseMs - 1 });
  const recoveredLease = await claimNextJobs(ROOT, { types: ["queue.lease.probe"], workerId: "postgres-worker-b", leaseMs, now: firstClaimAt + leaseMs + 1 });
  const staleCompletion = await completeJob(ROOT, firstLease[0], { now: firstClaimAt + leaseMs + 2 });
  const currentCompletion = await completeJob(ROOT, recoveredLease[0], { now: firstClaimAt + leaseMs + 3 });
  const publicLeasedJob = (await listJobs(ROOT, { limit: 100 })).find(item => item.id === leasedJob.id);
  check("Postgres lease blocks concurrent worker", firstLease.length === 1 && duplicateLease.length === 0 && firstLease[0].lockedBy === "postgres-worker-a");
  check("Postgres expired lease is reclaimed", recoveredLease.length === 1 && recoveredLease[0].attempts === 2 && recoveredLease[0].leaseToken !== firstLease[0].leaseToken);
  check("Postgres stale completion is fenced", staleCompletion.ok === false && staleCompletion.reason === "claim_lost" && currentCompletion.ok === true);
  check("Postgres job listing hides lease capability", publicLeasedJob?.status === "done" && !("leaseToken" in publicLeasedJob));

  const terminalJob = await enqueueJob(ROOT, { type: "queue.terminal.probe", maxAttempts: 1 });
  const terminalClaimAt = Date.now() + 100;
  const terminalLease = await claimNextJobs(ROOT, { types: ["queue.terminal.probe"], workerId: "postgres-worker-a", leaseMs, now: terminalClaimAt });
  const terminalRetry = await claimNextJobs(ROOT, { types: ["queue.terminal.probe"], workerId: "postgres-worker-b", leaseMs, now: terminalClaimAt + leaseMs + 1 });
  const queueHealth = await getQueueHealth(ROOT, { now: terminalClaimAt + leaseMs + 1, leaseMs });
  check("Postgres final expired attempt is terminal", terminalLease[0]?.id === terminalJob.id && terminalRetry.length === 0 && queueHealth.failed === 1 && queueHealth.unhandledFailed === 1 && queueHealth.staleRunning === 0 && !queueHealth.operational && queueHealth.needsAttention);
  const terminalHandled = await markTerminalJobHandled(ROOT, terminalJob.id, { now: terminalClaimAt + leaseMs + 2 });
  const handledQueueHealth = await getQueueHealth(ROOT, { now: terminalClaimAt + leaseMs + 2, leaseMs });
  check("Postgres handled failure clears queue incident", terminalHandled.ok
    && terminalHandled.job?.failureHandledAt === terminalHandled.handledAt
    && !("leaseToken" in terminalHandled.job)
    && handledQueueHealth.failed === 1
    && handledQueueHealth.unhandledFailed === 0
    && handledQueueHealth.operational
    && !handledQueueHealth.needsAttention);

  const terminalAcknowledgment = partnerDocAfterDelivery?.followups?.find(item => item.kind === "application_received" && item.id !== sponsorAcknowledgment.id);
  await updatePlatformDoc(ROOT, "partnerOps", current => ({
    ...current,
    followups: current.followups.map(item => item.id === terminalAcknowledgment.id
      ? { ...item, status: "queued", queuedAt: new Date().toISOString(), lastError: null }
      : item)
  }), { fallback: emptyPartnerOperations() });
  const expiredDeliveryJob = await enqueueJob(ROOT, {
    type: "partner.followup.send",
    payload: { followupId: terminalAcknowledgment.id },
    maxAttempts: 1
  });
  const expiredDeliveryClaim = await claimNextJobs(ROOT, {
    types: ["partner.followup.send"],
    workerId: "postgres-crashed-worker",
    leaseMs,
    now: Date.now() + 100
  });
  const leasePool = await getPool();
  await leasePool.query(
    "UPDATE platform_jobs SET locked_at = now() - interval '30 seconds', updated_at = now() - interval '30 seconds' WHERE id = $1",
    [expiredDeliveryJob.id]
  );
  await runChild(["scripts/worker.mjs"], {
    ...commonEnv,
    SANDFEST_WORKER_ONCE: "true",
    SANDFEST_WORKER_BATCH: "50",
    SANDFEST_JOB_LEASE_MS: String(leaseMs)
  }, "Postgres terminal recovery worker");
  const reconciledPartnerDoc = await readPlatformDoc(ROOT, "partnerOps", null);
  const reconciledFollowup = reconciledPartnerDoc?.followups?.find(item => item.id === terminalAcknowledgment.id);
  const reconciledDeliveryJob = (await listJobs(ROOT, { limit: 100 })).find(item => item.id === expiredDeliveryJob.id);
  check("expired terminal delivery reconciles owning workflow", expiredDeliveryClaim[0]?.id === expiredDeliveryJob.id && reconciledFollowup?.status === "failed" && reconciledFollowup?.lastError?.includes("lease expired") && reconciledDeliveryJob?.status === "failed" && Boolean(reconciledDeliveryJob?.failureHandledAt));
  const postgresEventenyImportEmail = "eventeny-postgres-vendor@example.com";
  const postgresEventenyPartnerCsv = `application_id,type,business_name,contact_name,contact_email,category,offering_id,status,reported_amount,event_id
PG-EVENTENY-V-1,vendor,Postgres Eventeny Vendor,Postgres Import Contact,${postgresEventenyImportEmail},retail,marketplace-booth,Approved,100.00,${EVENT_ID}`;
  const postgresEventenyImportPayload = {
    csv: postgresEventenyPartnerCsv,
    fileName: "eventeny-partners-postgres.csv",
    defaultType: "",
    transactionalContactConfirmed: true
  };
  const postgresPartnersBeforeImport = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const postgresEventenyPreview = await request(base, "POST", "/api/admin/partners/import", { ...postgresEventenyImportPayload, mode: "preview" }, { auth: true });
  const postgresPartnersAfterPreview = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const postgresEventenyCommit = await request(base, "POST", "/api/admin/partners/import", {
    ...postgresEventenyImportPayload,
    mode: "commit",
    previewHash: postgresEventenyPreview.data.previewHash
  }, { auth: true });
  const postgresEventenyReplay = await request(base, "POST", "/api/admin/partners/import", {
    ...postgresEventenyImportPayload,
    mode: "commit",
    previewHash: postgresEventenyPreview.data.previewHash
  }, { auth: true });
  const postgresPartnersAfterEventenyImport = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const postgresImportedEventenyApplication = postgresPartnersAfterEventenyImport.data.applications?.find(item => item.sourceRef === "eventeny/application/PG-EVENTENY-V-1");
  check("Postgres Eventeny preview persists nothing", postgresEventenyPreview.status === 200 && postgresEventenyPreview.data.summary?.importable === 1 && postgresPartnersAfterPreview.data.applications?.length === postgresPartnersBeforeImport.data.applications?.length);
  check("Postgres Eventeny import persists atomically", postgresEventenyCommit.status === 201 && postgresEventenyCommit.data.summary?.imported === 1 && postgresImportedEventenyApplication?.sourceBatch === postgresEventenyCommit.data.batchId && postgresImportedEventenyApplication?.sourceStatus === "Approved" && postgresImportedEventenyApplication?.status === "submitted" && postgresPartnersAfterEventenyImport.data.tasks?.some(item => item.relatedEntityId === postgresImportedEventenyApplication?.id) && postgresPartnersAfterEventenyImport.data.milestones?.filter(item => item.applicationId === postgresImportedEventenyApplication?.id).length === 3 && postgresPartnersAfterEventenyImport.data.vendorProfiles?.some(item => item.applicationId === postgresImportedEventenyApplication?.id) && postgresPartnersAfterEventenyImport.data.vendorRequirements?.some(item => item.applicationId === postgresImportedEventenyApplication?.id) && postgresPartnersAfterEventenyImport.data.vendorAssignments?.some(item => item.applicationId === postgresImportedEventenyApplication?.id));
  check("Postgres Eventeny replay remains single-record", postgresEventenyReplay.status === 200 && postgresEventenyReplay.data.summary?.duplicates === 1 && postgresPartnersAfterEventenyImport.data.applications?.filter(item => item.sourceRef === "eventeny/application/PG-EVENTENY-V-1").length === 1);
  check("Postgres Eventeny import skips provider duplicate acknowledgment", !postgresPartnersAfterEventenyImport.data.followups?.some(item => item.applicationId === postgresImportedEventenyApplication?.id && item.kind === "application_received"));
  const verificationPool = await getPool();
  const counts = await verificationPool.query(`
    SELECT
      (SELECT count(*)::int FROM hunt_completions) AS completions,
      (SELECT count(*)::int FROM peoples_choice_votes) AS votes,
      (SELECT count(*)::int FROM admin_audit_events) AS audits,
      (SELECT count(*)::int FROM platform_documents) AS documents
  `);
  const totals = counts.rows[0];
  const persistedAudits = await verificationPool.query("SELECT data FROM admin_audit_events ORDER BY created_at DESC");
  const serializedAudits = JSON.stringify(persistedAudits.rows);
  const serializedBrevoAudits = JSON.stringify(persistedAudits.rows.filter(row => row.data?.action === "email.delivery.webhook"));
  const serializedSponsorInvitationAudits = JSON.stringify(persistedAudits.rows.filter(row => row.data?.action?.startsWith("outreach.sponsor_invitation.")));
  const serializedEventenyPartnerImportAudits = JSON.stringify(persistedAudits.rows.filter(row => row.data?.action === "partner.application.import"));
  const serializedStaffImportAudits = JSON.stringify(persistedAudits.rows.filter(row => row.data?.action === "staff_directory.import.commit"));
  const serializedBudgetAudits = JSON.stringify(persistedAudits.rows.filter(row => row.data?.action?.startsWith("budget.")));
  check("append tables persisted", totals.completions === 1 && totals.votes === 1, `${totals.completions} completion, ${totals.votes} vote`);
  check("admin audits persisted", totals.audits >= 4, `${totals.audits} audit events`);
  check("event guide audit persists", serializedAudits.includes("content.event-guide.publish"));
  check("partner automation audit persists", serializedAudits.includes("partner.automation.update"));
  check("revenue import audit persists", serializedAudits.includes("revenue.import.commit") && serializedAudits.includes("eventeny-postgres.csv"));
  check("budget audit persists without private vendor or payment references", serializedBudgetAudits.includes("budget.line.create")
    && serializedBudgetAudits.includes("budget.expense.submit") && serializedBudgetAudits.includes("budget.expense.approve")
    && serializedBudgetAudits.includes("budget.expense.mark_paid") && !serializedBudgetAudits.includes("Postgres Private")
    && !serializedBudgetAudits.includes("PRIVATE-PG-ACH-1001"));
  check("Postgres Eventeny import audit is aggregate-only", serializedEventenyPartnerImportAudits.includes("eventeny-partners-postgres.csv") && !serializedEventenyPartnerImportAudits.includes(postgresEventenyImportEmail) && !serializedEventenyPartnerImportAudits.includes("Postgres Import Contact"));
  check("Postgres staff import audit is aggregate-only", serializedStaffImportAudits.includes("staff-directory-postgres.json") && serializedStaffImportAudits.includes("hr_import") && !serializedStaffImportAudits.includes("postgres-traffic@example.com") && !serializedStaffImportAudits.includes("Postgres Incident Commander"));
  check("Postgres audits exclude bearer credential fragments", !serializedAudits.includes("tokenHint") && !serializedAudits.includes(TOKEN));
  check("Postgres Brevo audits retain counts only", serializedBrevoAudits.includes("email.delivery.webhook") && !serializedBrevoAudits.includes("sponsor@postgres-test.example") && !serializedBrevoAudits.includes(BREVO_WEBHOOK_TOKEN));
  check("Postgres sponsor invitation audits are aggregate-only", serializedSponsorInvitationAudits.includes("outreach.sponsor_invitation.issue") && serializedSponsorInvitationAudits.includes("outreach.sponsor_invitation.copy") && !serializedSponsorInvitationAudits.includes("tsfi1.") && !serializedSponsorInvitationAudits.includes("jordan@postgres-credit-union.example"));
  check("platform documents persisted", totals.documents >= 5, `${totals.documents} documents`);
  const recoveryOutput = await runChild(["scripts/verify-recovery.mjs"], {
    ...commonEnv,
    SANDFEST_DATABASE_URL: "",
    SANDFEST_RECOVERY_DATABASE_URL: databaseUrl,
    SANDFEST_RECOVERY_DATABASE_SSL: "false"
  }, "Postgres recovery verification");
  const recoveryEvidence = JSON.parse(recoveryOutput.trim().split("\n").at(-1));
  check("isolated recovery verification is read-only and complete", recoveryEvidence.ok && recoveryEvidence.mode === "read-only" && recoveryEvidence.requiredTables === 10 && recoveryEvidence.requiredConfigDocuments === 4 && recoveryEvidence.counts.platform_documents >= 5);
  let activeSourceRejected = false;
  try {
    await runChild(["scripts/verify-recovery.mjs"], {
      ...commonEnv,
      SANDFEST_RECOVERY_DATABASE_URL: databaseUrl,
      SANDFEST_RECOVERY_DATABASE_SSL: "false"
    }, "Postgres active-source recovery rejection");
  } catch (error) {
    activeSourceRejected = error.message.includes("refuses to run against SANDFEST_DATABASE_URL");
  }
  check("recovery verifier refuses the active source database", activeSourceRejected);
  recoveryAssetDir = await mkdtemp(path.join(tmpdir(), "sandfest-postgres-recovery-assets-"));
  await cp(partnerAssetDir, recoveryAssetDir, { recursive: true, force: true });
  const recoveryPartnerDoc = await readPlatformDoc(ROOT, "partnerOps", null);
  const recoveryIncomingDoc = await readPlatformDoc(ROOT, "incomingDocuments", null);
  const recoveryUploads = [...(recoveryPartnerDoc?.brandAssets || []), ...(recoveryPartnerDoc?.vendorDocuments || [])].filter(item => item.sourceType === "upload");
  check("Postgres recovery fixture includes sponsor and vendor uploads", recoveryUploads.some(item => item.storageKey?.endsWith(".png")) && recoveryUploads.some(item => item.storageKey?.endsWith(".pdf")));
  const recoveryIncomingDocuments = recoveryIncomingDoc?.documents || [];
  check("Postgres recovery fixture includes private intake documents", recoveryIncomingDocuments.length === 2 && recoveryIncomingDocuments.every(item => item.checksumSha256?.length === 64));
  const assetRecoveryOutput = await runChild(["scripts/verify-asset-recovery.mjs"], {
    ...commonEnv,
    SANDFEST_DATABASE_URL: "",
    SANDFEST_RECOVERY_DATABASE_URL: databaseUrl,
    SANDFEST_RECOVERY_DATABASE_SSL: "false",
    SANDFEST_PARTNER_ASSET_DIR: partnerAssetDir,
    SANDFEST_RECOVERY_ASSET_DIR: recoveryAssetDir,
    SANDFEST_RECOVERY_ASSET_MIN_FILES: "2"
  }, "Postgres asset recovery verification");
  const assetRecoveryEvidence = JSON.parse(assetRecoveryOutput.trim().split("\n").at(-1));
  check("isolated asset recovery verification proves every restored upload", assetRecoveryEvidence.ok && assetRecoveryEvidence.mode === "read-only" && assetRecoveryEvidence.database === "restored" && assetRecoveryEvidence.assetDirectory === "restored" && assetRecoveryEvidence.assets?.verified === recoveryUploads.length + recoveryIncomingDocuments.length && assetRecoveryEvidence.assets?.brandAssets >= 1 && assetRecoveryEvidence.assets?.vendorDocuments >= 1 && assetRecoveryEvidence.assets?.incomingDocuments === recoveryIncomingDocuments.length && assetRecoveryEvidence.assets?.incomingDocumentMetadataPresent === true && /^[a-f0-9]{64}$/.test(assetRecoveryEvidence.assets?.manifestSha256 || ""));
  await verificationPool.query("DELETE FROM platform_documents WHERE key = $1", ["incoming-documents"]);
  const legacyAssetRecoveryOutput = await runChild(["scripts/verify-asset-recovery.mjs"], {
    ...commonEnv,
    SANDFEST_DATABASE_URL: "",
    SANDFEST_RECOVERY_DATABASE_URL: databaseUrl,
    SANDFEST_RECOVERY_DATABASE_SSL: "false",
    SANDFEST_PARTNER_ASSET_DIR: partnerAssetDir,
    SANDFEST_RECOVERY_ASSET_DIR: recoveryAssetDir,
    SANDFEST_RECOVERY_ASSET_MIN_FILES: "2"
  }, "Pre-document asset recovery verification");
  const legacyAssetRecoveryEvidence = JSON.parse(legacyAssetRecoveryOutput.trim().split("\n").at(-1));
  check("asset recovery remains compatible with pre-document backups", legacyAssetRecoveryEvidence.ok && legacyAssetRecoveryEvidence.assets?.verified === recoveryUploads.length && legacyAssetRecoveryEvidence.assets?.incomingDocuments === 0 && legacyAssetRecoveryEvidence.assets?.incomingDocumentMetadataPresent === false);
  await writeFile(path.join(recoveryAssetDir, recoveryUploads[0].storageKey), Buffer.alloc(recoveryUploads[0].sizeBytes, 1));
  let corruptedAssetRejected = false;
  try {
    await runChild(["scripts/verify-asset-recovery.mjs"], {
      ...commonEnv,
      SANDFEST_DATABASE_URL: "",
      SANDFEST_RECOVERY_DATABASE_URL: databaseUrl,
      SANDFEST_RECOVERY_DATABASE_SSL: "false",
      SANDFEST_PARTNER_ASSET_DIR: partnerAssetDir,
      SANDFEST_RECOVERY_ASSET_DIR: recoveryAssetDir,
      SANDFEST_RECOVERY_ASSET_MIN_FILES: "2"
    }, "Postgres corrupt asset recovery rejection");
  } catch (error) {
    corruptedAssetRejected = error.message.includes("mismatched") && error.message.includes(recoveryUploads[0].storageKey);
  }
  check("asset recovery verifier rejects checksum corruption", corruptedAssetRejected);
  let activeAssetDirectoryRejected = false;
  try {
    await runChild(["scripts/verify-asset-recovery.mjs"], {
      ...commonEnv,
      SANDFEST_DATABASE_URL: "",
      SANDFEST_RECOVERY_DATABASE_URL: databaseUrl,
      SANDFEST_RECOVERY_DATABASE_SSL: "false",
      SANDFEST_PARTNER_ASSET_DIR: partnerAssetDir,
      SANDFEST_RECOVERY_ASSET_DIR: partnerAssetDir
    }, "Postgres active asset directory recovery rejection");
  } catch (error) {
    activeAssetDirectoryRejected = error.message.includes("refuses the active SANDFEST_PARTNER_ASSET_DIR");
  }
  check("asset recovery verifier refuses the active asset directory", activeAssetDirectoryRejected);
  let activeAssetDatabaseRejected = false;
  try {
    await runChild(["scripts/verify-asset-recovery.mjs"], {
      ...commonEnv,
      SANDFEST_RECOVERY_DATABASE_URL: databaseUrl,
      SANDFEST_RECOVERY_DATABASE_SSL: "false",
      SANDFEST_PARTNER_ASSET_DIR: partnerAssetDir,
      SANDFEST_RECOVERY_ASSET_DIR: recoveryAssetDir
    }, "Postgres active database asset recovery rejection");
  } catch (error) {
    activeAssetDatabaseRejected = error.message.includes("refuses to run against SANDFEST_DATABASE_URL");
  }
  check("asset recovery verifier refuses the active source database", activeAssetDatabaseRejected);
  await closePool();

  console.log(`\nPostgres total: ${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.error(`\nPostgres suite failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
} finally {
  await stopChild(apiChild).catch(() => {});
  try {
    const { closePool } = await import("../lib/db/pool.mjs");
    await closePool();
  } catch {
    // The pool may never have been initialized.
  }
  await cleanupDatabase().catch(error => {
    console.error(`Postgres cleanup failed: ${error.message}`);
    process.exitCode = 1;
  });
  if (partnerAssetDir) await rm(partnerAssetDir, { recursive: true, force: true }).catch(() => {});
  if (recoveryAssetDir) await rm(recoveryAssetDir, { recursive: true, force: true }).catch(() => {});
  await stripeMock?.close().catch(() => {});
  await emailMock?.close().catch(() => {});
  await twilioMock?.close().catch(() => {});
}
