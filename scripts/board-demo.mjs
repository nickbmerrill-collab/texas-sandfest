#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOARD_RUNTIME_LABEL, BOARD_RUNTIME_SCHEMA_VERSION, claimBoardRuntimeOwnership, prepareBoardRuntime } from "../lib/board-runtime.mjs";
import {
  BOARD_DEMO_SESSION_SCHEMA_VERSION,
  boardDemoSessionPath,
  boardDemoSessionProcessAlive,
  boardDemoSourceRevision,
  readBoardDemoSession,
  writeBoardDemoSession
} from "../lib/board-demo-session.mjs";
import { eventContextConfig } from "../lib/event-context.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_TOKEN = "board-demo-local-admin-token-change-me";
const CAMERA_SECRET = "board-demo-local-camera-secret-change-me";
const BREVO_API_KEY = "board-demo-local-brevo-api-key-change-me";
const BREVO_WEBHOOK_TOKEN = "board-demo-local-brevo-webhook-token-change-me";
const BOARD_TICKET_SECRET = "board-demo-local-ticket-secret-change-me-0123456789";
const PARTNER_PORTAL_SECRET = "board-demo-partner-portal-secret-change-me";
const TWILIO_ACCOUNT_SID = "AC00000000000000000000000000000001";
const TWILIO_AUTH_TOKEN = "board-demo-local-twilio-auth-token-change-me";
const TWILIO_FROM_NUMBER = "+13615550100";
const DEFAULT_PORTS = { web: 5175, api: 8806, email: 8807, sms: 8808 };
const SERVICE_ORDER = ["email", "sms", "api", "web", "worker", "cameras"];
const PRESENTATION_MESSAGE_MODE = "local_automation";
const RESTART_LIMIT = 3;
const RESTART_WINDOW_MS = 60_000;
const RESTART_DELAYS_MS = [500, 1_000, 2_000];

function parseArguments(args) {
  const options = {
    reset: false,
    strictPorts: false,
    runtimeRoot: path.join(ROOT, ".sandfest-runtime", "board-2027"),
    sessionFile: null,
    ports: { ...DEFAULT_PORTS }
  };
  const values = new Map([
    ["--runtime", value => { options.runtimeRoot = path.resolve(ROOT, value); }],
    ["--session-file", value => { options.sessionFile = path.resolve(ROOT, value); }],
    ["--web-port", value => { options.ports.web = portValue(value, "--web-port"); }],
    ["--api-port", value => { options.ports.api = portValue(value, "--api-port"); }],
    ["--email-port", value => { options.ports.email = portValue(value, "--email-port"); }],
    ["--sms-port", value => { options.ports.sms = portValue(value, "--sms-port"); }]
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--reset") {
      options.reset = true;
      continue;
    }
    if (argument === "--strict-ports") {
      options.strictPorts = true;
      continue;
    }
    const [flag, inlineValue] = argument.split("=", 2);
    const apply = values.get(flag);
    if (!apply) throw new Error(`Unknown board demo option: ${argument}`);
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    apply(value);
  }
  return options;
}

function portValue(value, flag) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(`${flag} must be an integer from 1024 through 65535.`);
  }
  return port;
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function portAvailable(port) {
  return new Promise(resolve => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function selectPorts(preferred, strict) {
  const selected = {};
  const reserved = new Set();
  for (const name of ["web", "api", "email", "sms"]) {
    let candidate = preferred[name];
    while (reserved.has(candidate) || !(await portAvailable(candidate))) {
      if (strict) throw new Error(`Board demo ${name} port ${preferred[name]} is already in use.`);
      candidate += 1;
      if (candidate > 65_535) throw new Error(`No loopback port is available for the board demo ${name} service.`);
    }
    selected[name] = candidate;
    reserved.add(candidate);
  }
  return selected;
}

async function runtimeMarker(runtimeRoot) {
  try {
    return JSON.parse(await readFile(path.join(runtimeRoot, "board-runtime.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Board runtime marker is invalid: ${error.message}`);
  }
}

async function prepareRuntime(runtimeRoot, options, runtimeOwnerId) {
  const { reset } = options;
  const marker = await runtimeMarker(runtimeRoot);
  const eventId = eventContextConfig(process.env).eventId;
  if (marker?.kind === "synthetic-board-demonstration") {
    await claimBoardRuntimeOwnership(runtimeRoot, runtimeOwnerId);
  }
  if (!reset && marker?.kind === "synthetic-board-demonstration") {
    const refreshReasons = [];
    if (marker.schemaVersion !== BOARD_RUNTIME_SCHEMA_VERSION) {
      refreshReasons.push(`schema ${marker.schemaVersion ?? "unversioned"} -> ${BOARD_RUNTIME_SCHEMA_VERSION}`);
    }
    if (marker.runtimeLabel !== BOARD_RUNTIME_LABEL) {
      refreshReasons.push("runtime label changed");
    }
    if (marker.eventId !== eventId) refreshReasons.push(`event ${marker.eventId || "missing"} -> ${eventId}`);
    if (marker.messageMode !== PRESENTATION_MESSAGE_MODE) {
      refreshReasons.push(`message mode ${marker.messageMode || "missing"} -> ${PRESENTATION_MESSAGE_MODE}`);
    }
    if (!refreshReasons.length) {
      return { reused: true, targetRoot: runtimeRoot, eventId };
    }

    console.log(`[board-demo] Refreshing the recognized synthetic runtime (${refreshReasons.join("; ")}).`);
    const refreshed = await prepareBoardRuntime({
      sourceRoot: ROOT,
      targetRoot: runtimeRoot,
      eventId,
      replace: true,
      messageMode: PRESENTATION_MESSAGE_MODE,
      publicSiteUrl: options.publicSiteUrl,
      partnerPortalSecret: options.partnerPortalSecret,
      runtimeOwnerId
    });
    return { ...refreshed, refreshed: true, refreshReasons };
  }
  if (!reset && marker) {
    throw new Error(`The runtime at ${runtimeRoot} is not the current synthetic board runtime. Re-run with --reset.`);
  }
  if (!reset) {
    try {
      await access(runtimeRoot);
      throw new Error(`The runtime path ${runtimeRoot} exists without a board marker. Re-run with --reset after inspecting it.`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return prepareBoardRuntime({
    sourceRoot: ROOT,
    targetRoot: runtimeRoot,
    eventId,
    replace: reset,
    messageMode: PRESENTATION_MESSAGE_MODE,
    publicSiteUrl: options.publicSiteUrl,
    partnerPortalSecret: options.partnerPortalSecret,
    runtimeOwnerId
  });
}

function processEnvironment(runtimeRoot, endpoints, runtimeOwnerId) {
  const shared = {
    ...process.env,
    SANDFEST_DATABASE_URL: "",
    SANDFEST_RUNTIME_ROOT: runtimeRoot,
    SANDFEST_RUNTIME_OWNER_ID: runtimeOwnerId,
    SANDFEST_INCOMING_DOCUMENT_DIR: path.join(runtimeRoot, "private", "incoming-documents"),
    SANDFEST_ENV: "development",
    SANDFEST_EVENT_ID: eventContextConfig(process.env).eventId,
    SANDFEST_PUBLIC_SITE_URL: endpoints.webBase,
    SANDFEST_API_PUBLIC_BASE_URL: endpoints.apiBase,
    SANDFEST_ADMIN_API_TOKEN: ADMIN_TOKEN,
    SANDFEST_ADMIN_ROLE: "super_admin",
    SANDFEST_ADMIN_ACTOR_ID: "board-demo",
    SANDFEST_ADMIN_RATE_LIMIT: "500",
    SANDFEST_TURNSTILE_ENABLED: "false",
    SANDFEST_BOARD_CONDITIONS_MODE: process.env.SANDFEST_BOARD_FEED_FIXTURE_BASE_URL ? "official" : "synthetic",
    SANDFEST_PARTNER_PORTAL_SECRET: PARTNER_PORTAL_SECRET,
    SANDFEST_OUTREACH_PREFERENCES_SECRET: "board-demo-outreach-preferences-secret-change-me",
    SANDFEST_SPONSOR_INVITATION_SECRET: "board-demo-sponsor-invitation-secret-change-me",
    OUTREACH_DISCOVERY_ENABLED: "true",
    OUTREACH_DISCOVERY_PROVIDER: "fixture",
    STRIPE_TICKETING_ENABLED: "false",
    SANDFEST_BOARD_TICKET_SANDBOX: "true",
    SANDFEST_BOARD_TICKET_SECRET: BOARD_TICKET_SECRET,
    STRIPE_PARTNER_PAYMENTS_ENABLED: "false",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    QB_INVOICE_SYNC_ENABLED: "false",
    QB_CLIENT_ID: "",
    QB_CLIENT_SECRET: "",
    QB_REALM_ID: "",
    QB_REFRESH_TOKEN: "",
    CAMERA_INGEST_ENABLED: "true",
    CAMERA_INGEST_SECRET: CAMERA_SECRET,
    CAMERA_INGEST_RATE_LIMIT: "1200",
    TRANSACTIONAL_EMAIL_ENABLED: "true",
    BREVO_API_KEY,
    BREVO_SENDER_EMAIL: "sandbox@texassandfest.example",
    BREVO_SENDER_NAME: "Texas SandFest Board Demo",
    BREVO_REPLY_TO_EMAIL: "reply@texassandfest.example",
    BREVO_WEBHOOK_TOKEN,
    BREVO_API_ENDPOINT: `${endpoints.emailBase}/v3/smtp/email`,
    SMS_ENABLED: "true",
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_FROM_NUMBER,
    TWILIO_API_BASE_URL: endpoints.smsBase,
    TWILIO_STATUS_CALLBACK_URL: `${endpoints.apiBase}/api/webhooks/twilio/status`,
    TWILIO_SAFETY_INBOUND_WEBHOOK_URL: `${endpoints.apiBase}/api/webhooks/twilio/inbound/smsSafety`
  };
  return {
    email: {
      ...shared,
      SANDFEST_BOARD_EMAIL_SANDBOX: "true",
      SANDFEST_BOARD_EMAIL_PORT: String(new URL(endpoints.emailBase).port),
      BOARD_BREVO_API_KEY: BREVO_API_KEY,
      SANDFEST_BOARD_EMAIL_WEBHOOK_URL: `${endpoints.apiBase}/api/webhooks/brevo`
    },
    sms: {
      ...shared,
      SANDFEST_BOARD_SMS_SANDBOX: "true",
      SANDFEST_BOARD_SMS_PORT: String(new URL(endpoints.smsBase).port),
      BOARD_TWILIO_ACCOUNT_SID: TWILIO_ACCOUNT_SID,
      BOARD_TWILIO_AUTH_TOKEN: TWILIO_AUTH_TOKEN,
      BOARD_TWILIO_FROM_NUMBER: TWILIO_FROM_NUMBER,
      SANDFEST_BOARD_SMS_INBOUND_WEBHOOK_URL: `${endpoints.apiBase}/api/webhooks/twilio/inbound/smsSafety`
    },
    api: {
      ...shared,
      SANDFEST_API_PORT: String(new URL(endpoints.apiBase).port),
      SANDFEST_BOARD_RESET_SUPERVISOR_PID: String(process.pid)
    },
    web: {
      ...shared,
      SANDFEST_BOARD_DEMO_ADMIN_TOKEN: ADMIN_TOKEN
    },
    worker: {
      ...shared,
      SANDFEST_WORKER_POLL_MS: "1000"
    },
    cameras: {
      ...shared,
      SANDFEST_API_BASE: endpoints.apiBase,
      SANDFEST_BOARD_CAMERA_RETRY_BASE_MS: "250",
      SANDFEST_BOARD_CAMERA_RETRY_MAX_MS: "2000"
    }
  };
}

function serviceDefinitions(environments, ports) {
  return {
    email: { args: ["scripts/board-email-sandbox.mjs"], env: environments.email },
    sms: { args: ["scripts/board-sms-sandbox.mjs"], env: environments.sms },
    api: { args: ["scripts/admin-api-server.mjs"], env: environments.api },
    web: { args: ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(ports.web), "--strictPort"], env: environments.web },
    worker: { args: ["scripts/worker.mjs"], env: environments.worker },
    cameras: { args: ["scripts/board-camera-playback.mjs"], env: environments.cameras }
  };
}

function pipeLines(stream, name) {
  let buffered = "";
  stream?.setEncoding("utf8");
  stream?.on("data", chunk => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || "";
    for (const line of lines) {
      if (line) console.log(`[${name}] ${line}`);
    }
  });
  stream?.on("end", () => {
    if (buffered) console.log(`[${name}] ${buffered}`);
  });
}

async function runPreflight(env) {
  const child = spawn(process.execPath, ["scripts/check-board-demo.mjs", "--json"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  try {
    return { code, report: JSON.parse(stdout), stderr };
  } catch {
    return { code, report: null, stderr: `${stderr}\n${stdout}`.trim() };
  }
}

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(`[board-demo] ${error.message}`);
  process.exit(1);
}

const sessionFile = options.sessionFile || boardDemoSessionPath(process.env, { root: ROOT });
const previousSession = await readBoardDemoSession(sessionFile);
if (previousSession && boardDemoSessionProcessAlive(previousSession)) {
  console.error(`[board-demo] A board demo supervisor is already active (PID ${previousSession.pid}).`);
  console.error(`[board-demo] Visitor: ${previousSession.links?.visitor || previousSession.endpoints?.webBase}`);
  process.exit(1);
}
const allowDirtySource = String(process.env.SANDFEST_BOARD_ALLOW_DIRTY_SOURCE || "").trim().toLowerCase() === "true";
const requireMainSource = String(process.env.SANDFEST_BOARD_REQUIRE_MAIN || "").trim().toLowerCase() === "true";
const sourceRevision = await boardDemoSourceRevision(ROOT);
if (sourceRevision.dirty && !allowDirtySource) {
  console.error(`[board-demo] Refusing a dirty worktree with ${sourceRevision.changeCount} changed path(s). Commit or stash the presentation source first.`);
  process.exit(1);
}
if (requireMainSource && (sourceRevision.branch !== "main" || !sourceRevision.matchesOriginMain)) {
  console.error(`[board-demo] Presentation source must be clean main at local origin/main; found ${sourceRevision.branch}@${sourceRevision.commit.slice(0, 8)}.`);
  process.exit(1);
}

const ports = await selectPorts(options.ports, options.strictPorts);
const endpoints = Object.fromEntries(Object.entries(ports).map(([name, port]) => [
  `${name}Base`,
  `http://127.0.0.1:${port}`
]));
const visitor = `${endpoints.webBase}/?apiBase=${encodeURIComponent(endpoints.apiBase)}&mode=visitor`;
const operations = `${endpoints.webBase}/admin.html?apiBase=${encodeURIComponent(endpoints.apiBase)}`;
const runtimeOwnerId = randomUUID();
const runtime = await prepareRuntime(options.runtimeRoot, {
  ...options,
  publicSiteUrl: endpoints.webBase,
  partnerPortalSecret: PARTNER_PORTAL_SECRET
}, runtimeOwnerId);
const environments = processEnvironment(options.runtimeRoot, endpoints, runtimeOwnerId);
const definitions = serviceDefinitions(environments, ports);
const preflightEnv = {
  ...process.env,
  SANDFEST_BOARD_SESSION_FILE: sessionFile,
  SANDFEST_BOARD_PUBLIC_SITE_URL: endpoints.webBase,
  SANDFEST_BOARD_API_BASE: endpoints.apiBase,
  SANDFEST_BOARD_EMAIL_BASE: endpoints.emailBase,
  SANDFEST_BOARD_SMS_BASE: endpoints.smsBase,
  SANDFEST_BOARD_ADMIN_TOKEN: ADMIN_TOKEN,
  SANDFEST_BOARD_CHECK_TIMEOUT_MS: "5000"
};

const startedAt = new Date().toISOString();
const state = {
  schemaVersion: BOARD_DEMO_SESSION_SCHEMA_VERSION,
  mode: "board_demo_supervisor",
  status: "starting",
  pid: process.pid,
  startedAt,
  updatedAt: startedAt,
  runtimeRoot: options.runtimeRoot,
  runtimeReused: runtime.reused === true,
  runtimeRefreshed: runtime.refreshed === true,
  runtimeRefreshReasons: runtime.refreshReasons || [],
  runtimeSchemaVersion: BOARD_RUNTIME_SCHEMA_VERSION,
  source: {
    ...sourceRevision,
    allowDirty: allowDirtySource,
    requireMain: requireMainSource,
    capturedAt: startedAt
  },
  endpoints,
  links: { visitor, operations },
  services: Object.fromEntries(SERVICE_ORDER.map(name => [name, {
    pid: null,
    status: "pending",
    restartCount: 0,
    startedAt: null,
    lastExitAt: null,
    lastExitCode: null
  }]))
};
let stateWrites = Promise.resolve();
function persistState() {
  state.updatedAt = new Date().toISOString();
  const snapshot = structuredClone(state);
  stateWrites = stateWrites.then(() => writeBoardDemoSession(sessionFile, snapshot));
  return stateWrites;
}

const children = new Map();
const restartHistory = new Map();
let stopping = false;
let resetting = false;
let finalExitCode = 0;
let verificationPromise = null;
let activeVerification = null;
let finishLifetime;
const lifetime = new Promise(resolve => { finishLifetime = resolve; });

async function stopChild(name) {
  const child = children.get(name);
  if (!child || child.exitCode != null || child.signalCode) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode == null && !child.signalCode) child.kill("SIGKILL");
}

async function shutdown(status = "stopped", exitCode = 0, reason = null) {
  if (stopping) return;
  stopping = true;
  finalExitCode = exitCode;
  state.status = status === "error" ? "error" : "stopping";
  if (reason) state.error = reason;
  await persistState();
  for (const name of [...SERVICE_ORDER].reverse()) await stopChild(name);
  for (const service of Object.values(state.services)) {
    if (service.status !== "failed") service.status = "stopped";
  }
  if (status !== "error") state.status = "stopped";
  state.stoppedAt = new Date().toISOString();
  await persistState();
  finishLifetime();
}

async function fatal(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[board-demo] ${message}`);
  await shutdown("error", 1, message);
}

async function verifyReady(label, timeoutMs = 60_000) {
  if (verificationPromise || stopping) return verificationPromise;
  const verification = { label, cancelled: false };
  activeVerification = verification;
  verificationPromise = (async () => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (!stopping && !verification.cancelled && Date.now() < deadline) {
      last = await runPreflight(preflightEnv);
      if (verification.cancelled) return false;
      if (last.code === 0 && last.report?.ok) {
        state.status = "ready";
        state.lastReadyAt = new Date().toISOString();
        state.lastPreflight = { passed: last.report.passed, total: last.report.total, checkedAt: last.report.checkedAt };
        delete state.error;
        await persistState();
        if (label === "startup") {
          console.log("\n[board-demo] Board presentation stack is ready (10/10 checks).\n");
          console.log(`[board-demo] Source:     ${sourceRevision.branch}@${sourceRevision.commit.slice(0, 8)}${sourceRevision.matchesOriginMain ? " (origin/main)" : ""}`);
          console.log(`[board-demo] Visitor:    ${visitor}`);
          console.log(`[board-demo] Operations: ${operations}`);
          console.log(`[board-demo] Session:    ${sessionFile}`);
          console.log("[board-demo] Keep this process running; use npm run board:stop from another terminal.\n");
        } else {
          console.log(`[board-demo] ${label} recovery complete; board preflight is ${last.report.passed}/${last.report.total}.`);
        }
        return true;
      }
      await delay(500);
    }
    if (verification.cancelled) return false;
    if (!stopping) {
      const failed = last?.report?.checks?.filter(item => !item.ok).map(item => item.label).join(", ");
      throw new Error(`Board demo ${label} preflight timed out${failed ? `; failing checks: ${failed}` : last?.stderr ? `: ${last.stderr}` : "."}`);
    }
  })();
  try {
    return await verificationPromise;
  } finally {
    if (activeVerification === verification) activeVerification = null;
    verificationPromise = null;
  }
}

async function restartService(name) {
  const now = Date.now();
  const history = (restartHistory.get(name) || []).filter(timestamp => now - timestamp < RESTART_WINDOW_MS);
  if (history.length >= RESTART_LIMIT) {
    throw new Error(`${name} exceeded ${RESTART_LIMIT} restarts in ${RESTART_WINDOW_MS / 1000} seconds.`);
  }
  history.push(now);
  restartHistory.set(name, history);
  state.services[name].restartCount += 1;
  const delayMs = RESTART_DELAYS_MS[Math.min(history.length - 1, RESTART_DELAYS_MS.length - 1)];
  console.warn(`[board-demo] ${name} stopped unexpectedly; restarting in ${delayMs}ms.`);
  await delay(delayMs);
  if (stopping || resetting) return;
  startService(name);
  await verifyReady(`${name}`, 45_000);
}

function handleServiceExit(name, child, code, signal) {
  if (children.get(name) !== child) return;
  children.delete(name);
  const service = state.services[name];
  service.pid = null;
  service.lastExitAt = new Date().toISOString();
  service.lastExitCode = Number.isInteger(code) ? code : null;
  service.lastExitSignal = signal || null;
  if (stopping || resetting) {
    service.status = "stopped";
    void persistState();
    return;
  }
  service.status = "restarting";
  state.status = "recovering";
  void persistState();
  void restartService(name).catch(fatal);
}

function startService(name) {
  const definition = definitions[name];
  const service = state.services[name];
  service.status = "starting";
  service.startedAt = new Date().toISOString();
  const child = spawn(process.execPath, definition.args, {
    cwd: ROOT,
    env: definition.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.set(name, child);
  service.pid = child.pid;
  service.status = "running";
  pipeLines(child.stdout, name);
  pipeLines(child.stderr, name);
  child.once("error", error => {
    console.error(`[board-demo] ${name} process error: ${error.message}`);
  });
  child.once("exit", (code, signal) => handleServiceExit(name, child, code, signal));
  void persistState();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

async function resetBoardRuntime() {
  if (stopping || resetting) return;
  resetting = true;
  state.status = "resetting";
  state.resetStartedAt = new Date().toISOString();
  delete state.error;
  await persistState();
  try {
    if (verificationPromise) {
      console.log(`[board-demo] Reset requested during ${activeVerification?.label || "an active"} readiness check; replacing it.`);
      if (activeVerification) activeVerification.cancelled = true;
      await verificationPromise;
    }
    for (const name of [...SERVICE_ORDER].reverse()) await stopChild(name);
    await stateWrites;
    const refreshedRuntime = await prepareRuntime(options.runtimeRoot, { reset: true }, runtimeOwnerId);
    state.runtimeReused = false;
    state.runtimeRefreshed = false;
    state.runtimeRefreshReasons = [];
    state.runtimeSchemaVersion = BOARD_RUNTIME_SCHEMA_VERSION;
    state.runtimeGeneratedAt = refreshedRuntime.generatedAt;
    restartHistory.clear();
    for (const name of SERVICE_ORDER) {
      state.services[name] = {
        pid: null,
        status: "pending",
        restartCount: 0,
        startedAt: null,
        lastExitAt: null,
        lastExitCode: null
      };
    }
    for (const name of SERVICE_ORDER) startService(name);
    await verifyReady("reset", 60_000);
    state.resetCount = Number(state.resetCount || 0) + 1;
    state.lastResetAt = new Date().toISOString();
    delete state.resetStartedAt;
    await persistState();
    console.log(`[board-demo] Presentation state restored from the synthetic baseline (${state.resetCount} reset${state.resetCount === 1 ? "" : "s"}).`);
  } finally {
    resetting = false;
  }
}

process.on("SIGUSR2", () => {
  void resetBoardRuntime().catch(fatal);
});

try {
  await persistState();
  for (const name of SERVICE_ORDER) startService(name);
  await verifyReady("startup");
} catch (error) {
  await fatal(error);
}

await lifetime;
await stateWrites;
process.exitCode = finalExitCode;
