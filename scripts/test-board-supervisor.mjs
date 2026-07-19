#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOARD_RUNTIME_SCHEMA_VERSION, prepareBoardRuntime } from "../lib/board-runtime.mjs";
import { readBoardDemoSession } from "../lib/board-demo-session.mjs";
import { DEFAULT_EVENT_ID } from "../lib/event-context.mjs";
import { emptyPartnerOperations } from "../lib/partner-ops.mjs";
import { platformDocumentFilePath } from "../lib/platform-data.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_TOKEN = "board-demo-local-admin-token-change-me";
let temporary = null;
let supervisor = null;
let occupiedPortServer = null;
let output = "";
const observedPids = new Set();

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function occupyPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function distinctPorts(count) {
  const ports = new Set();
  while (ports.size < count) ports.add(await freePort());
  return [...ports];
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    if (supervisor?.exitCode != null) {
      throw new Error(`${label} failed because the supervisor exited ${supervisor.exitCode}:\n${output.slice(-12_000)}`);
    }
    await wait(100);
  }
  throw new Error(`${label} timed out:\n${output.slice(-12_000)}`);
}

function processAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) < 1) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function commandEnvironment(sessionFile) {
  const env = { ...process.env, SANDFEST_BOARD_SESSION_FILE: sessionFile };
  for (const key of [
    "SANDFEST_BOARD_WEB_URL",
    "SANDFEST_BOARD_PUBLIC_SITE_URL",
    "SANDFEST_BOARD_API_BASE",
    "SANDFEST_BOARD_EMAIL_BASE",
    "SANDFEST_BOARD_SMS_BASE"
  ]) delete env[key];
  return env;
}

async function run(command, args, env = process.env, timeoutMs = 30_000) {
  const child = spawn(command, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${args[0] || command} timed out.`));
    }, timeoutMs);
    child.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", code => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

async function preflight(sessionFile) {
  const result = await run(process.execPath, ["scripts/check-board-demo.mjs", "--json"], commandEnvironment(sessionFile), 20_000);
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Board preflight returned invalid JSON:\n${result.stderr}\n${result.stdout}`);
  }
  if (result.code !== 0 || !report.ok || report.passed !== 9 || report.total !== 9) {
    throw new Error(`Board preflight failed ${report.passed}/${report.total}:\n${JSON.stringify(report, null, 2)}`);
  }
  return report;
}

async function browserRehearsal(sessionFile) {
  const result = await run(process.execPath, ["scripts/check-board-browser.mjs", "--json"], commandEnvironment(sessionFile), 60_000);
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Board browser rehearsal returned invalid JSON:\n${result.stderr}\n${result.stdout}`);
  }
  if (result.code !== 0 || !report.ok || report.passed !== 12 || report.total !== 12) {
    throw new Error(`Board browser rehearsal failed ${report.passed}/${report.total}:\n${JSON.stringify(report, null, 2)}`);
  }
  return report;
}

function rememberServicePids(session) {
  for (const service of Object.values(session?.services || {})) {
    if (Number.isInteger(Number(service.pid)) && Number(service.pid) > 0) observedPids.add(Number(service.pid));
  }
}

function startSupervisor(args, env) {
  const child = spawn(process.execPath, ["scripts/board-demo.mjs", ...args], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { output += String(chunk); });
  return child;
}

try {
  console.log("\n=== Board demo supervisor ===\n");
  temporary = await mkdtemp(path.join(tmpdir(), "sandfest-board-supervisor-test-"));
  const runtimeRoot = path.join(temporary, "runtime");
  const sessionFile = path.join(temporary, "session.json");
  occupiedPortServer = await occupyPort();
  const webPort = occupiedPortServer.address().port;
  const [apiPort, emailPort, smsPort] = await distinctPorts(3);
  await prepareBoardRuntime({
    sourceRoot: ROOT,
    targetRoot: runtimeRoot,
    eventId: DEFAULT_EVENT_ID,
    replace: true,
    messageMode: "review_first"
  });
  const runtimeMarkerPath = path.join(runtimeRoot, "board-runtime.json");
  const staleRuntimeMarker = JSON.parse(await readFile(runtimeMarkerPath, "utf8"));
  staleRuntimeMarker.schemaVersion = 0;
  await writeFile(runtimeMarkerPath, `${JSON.stringify(staleRuntimeMarker, null, 2)}\n`, "utf8");
  const supervisorEnvironment = {
    ...commandEnvironment(sessionFile),
    STRIPE_TICKETING_ENABLED: "true",
    STRIPE_PARTNER_PAYMENTS_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_live_inherited-test-only",
    STRIPE_WEBHOOK_SECRET: "whsec_inherited-test-only",
    QB_INVOICE_SYNC_ENABLED: "true",
    QB_CLIENT_ID: "inherited-test-client",
    QB_CLIENT_SECRET: "inherited-test-secret",
    QB_REALM_ID: "inherited-test-realm",
    QB_REFRESH_TOKEN: "inherited-test-refresh"
  };
  supervisor = startSupervisor([
    "--runtime", runtimeRoot,
    "--session-file", sessionFile,
    "--web-port", String(webPort),
    "--api-port", String(apiPort),
    "--email-port", String(emailPort),
    "--sms-port", String(smsPort)
  ], supervisorEnvironment);

  const initial = await waitFor(async () => {
    const session = await readBoardDemoSession(sessionFile);
    if (session?.status !== "ready" || session?.lastPreflight?.passed !== 9) return null;
    rememberServicePids(session);
    return session;
  }, 90_000, "Initial board demo readiness");
  if (Number(new URL(initial.endpoints.webBase).port) === webPort || !occupiedPortServer.listening) {
    throw new Error("Supervisor did not preserve and move around the occupied web port.");
  }
  console.log(`  ok supervisor preserves an occupied port and starts the complete stack (PID ${initial.pid})`);
  const upgradedRuntimeMarker = JSON.parse(await readFile(runtimeMarkerPath, "utf8"));
  if (
    initial.runtimeReused !== false
    || initial.runtimeRefreshed !== true
    || initial.runtimeSchemaVersion !== BOARD_RUNTIME_SCHEMA_VERSION
    || !initial.runtimeRefreshReasons?.some(reason => reason.startsWith("schema "))
    || !initial.runtimeRefreshReasons?.some(reason => reason.startsWith("message mode "))
    || upgradedRuntimeMarker.schemaVersion !== BOARD_RUNTIME_SCHEMA_VERSION
    || upgradedRuntimeMarker.messageMode !== "local_automation"
  ) {
    throw new Error("Supervisor did not automatically upgrade the recognized stale board runtime.");
  }
  console.log(`  ok supervisor upgrades a recognized stale runtime to schema ${BOARD_RUNTIME_SCHEMA_VERSION} before startup`);
  const conditionsResponse = await fetch(`${initial.endpoints.apiBase}/api/public/island-conditions`);
  const conditions = await conditionsResponse.json();
  if (!conditionsResponse.ok || conditions.weather?.source !== "Board weather simulation" || conditions.ferry?.source !== "Board ferry simulation") {
    throw new Error("Supervisor did not start with visibly synthetic, offline-safe conditions.");
  }
  console.log("  ok supervisor starts with visibly synthetic weather and ferry data without an external feed");

  const serializedSession = JSON.stringify(initial);
  const forbiddenSessionValues = [
    "board-demo-local-admin-token",
    "board-demo-local-camera-secret",
    "board-demo-local-brevo-api-key",
    "board-demo-local-twilio-auth-token",
    "AC00000000000000000000000000000001"
  ];
  if (forbiddenSessionValues.some(value => serializedSession.includes(value))) {
    throw new Error("Board session state contains a synthetic service credential.");
  }
  const healthResponse = await fetch(`${initial.endpoints.apiBase}/health`);
  const health = await healthResponse.json();
  if (!healthResponse.ok || health.stripeReady !== false || health.stripePartnerPaymentsReady !== false || health.quickBooksInvoiceSyncReady !== false) {
    throw new Error("Board API inherited a real payment or accounting provider configuration.");
  }
  console.log("  ok session state is credential-free and inherited payment providers stay disabled");

  const partnerResponse = await fetch(`${initial.endpoints.apiBase}/api/admin/partners`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
  });
  const partnerWorkspace = await partnerResponse.json();
  const emailSandboxResponse = await fetch(`${initial.endpoints.emailBase}/health`);
  const emailSandbox = await emailSandboxResponse.json();
  const deliveredMessages = (partnerWorkspace.followups || []).filter(item => item.status === "sent" && item.deliveryStatus === "delivered");
  const reviewReadyOutreach = (partnerWorkspace.followups || []).filter(item => item.kind === "sponsor_outreach" && item.status === "draft_ready" && !item.automationPolicy);
  const localAutomationReady = partnerResponse.ok
    && emailSandboxResponse.ok
    && partnerWorkspace.automationMode === "transactional_auto"
    && partnerWorkspace.automation?.active === true
    && deliveredMessages.some(item => item.automationPolicy === "partner_transactional_v1")
    && deliveredMessages.some(item => item.automationPolicy === "outreach_campaign_v1")
    && reviewReadyOutreach.length >= 1
    && emailSandbox.acceptedMessages >= 2
    && emailSandbox.deliveryCallbacks >= 2
    && emailSandbox.callbackFailures === 0;
  if (!localAutomationReady) throw new Error("Board startup did not produce loopback-only transactional and campaign delivery proof.");
  console.log(`  ok local automation delivers ${deliveredMessages.length} synthetic messages and preserves ${reviewReadyOutreach.length} outreach draft for staff review`);

  const initialReport = await preflight(sessionFile);
  console.log(`  ok board:check discovers the active session and passes ${initialReport.passed}/${initialReport.total}`);
  const browserReport = await browserRehearsal(sessionFile);
  console.log(`  ok board:rehearse renders the active visitor and operations session ${browserReport.passed}/${browserReport.total}`);
  const unsafeSessionFile = path.join(temporary, "unsafe-session.json");
  const unsafeApiBase = "https://example.com";
  await writeFile(unsafeSessionFile, `${JSON.stringify({
    ...initial,
    endpoints: { ...initial.endpoints, apiBase: unsafeApiBase },
    links: {
      visitor: `${initial.endpoints.webBase}/?apiBase=${encodeURIComponent(unsafeApiBase)}&mode=visitor`,
      operations: `${initial.endpoints.webBase}/admin.html?apiBase=${encodeURIComponent(unsafeApiBase)}`
    }
  }, null, 2)}\n`);
  const unsafeBrowserResult = await run(process.execPath, ["scripts/check-board-browser.mjs", "--json"], commandEnvironment(unsafeSessionFile), 20_000);
  const unsafeBrowserReport = JSON.parse(unsafeBrowserResult.stdout);
  if (unsafeBrowserResult.code === 0 || unsafeBrowserReport.checks?.find(item => item.id === "session")?.ok !== false) {
    throw new Error("Board browser rehearsal accepted a remote API endpoint.");
  }
  console.log("  ok board:rehearse rejects a tampered remote API endpoint before navigation");

  const unauthorizedReset = await fetch(`${initial.endpoints.apiBase}/api/admin/board-demo/reset`, { method: "POST" });
  if (unauthorizedReset.status !== 401) {
    throw new Error(`Board reset accepted an unauthenticated request with status ${unauthorizedReset.status}.`);
  }
  console.log("  ok presentation reset requires the board administrator session");

  const resetProbe = path.join(runtimeRoot, "reset-probe.txt");
  await writeFile(resetProbe, "must be removed by presentation reset\n", "utf8");
  const preResetPids = Object.fromEntries(Object.entries(initial.services).map(([name, service]) => [name, Number(service.pid)]));
  await writeFile(
    platformDocumentFilePath(runtimeRoot, "partnerOps"),
    `${JSON.stringify(emptyPartnerOperations(DEFAULT_EVENT_ID), null, 2)}\n`,
    "utf8"
  );
  process.kill(preResetPids.api, "SIGKILL");
  await waitFor(async () => {
    const session = await readBoardDemoSession(sessionFile);
    const apiPid = Number(session?.services?.api?.pid);
    if (session?.status !== "recovering" || apiPid < 1 || apiPid === preResetPids.api || !processAlive(apiPid)) return null;
    try {
      const response = await fetch(`${session.endpoints.apiBase}/health`);
      if (!response.ok) return null;
    } catch {
      return null;
    }
    rememberServicePids(session);
    return session;
  }, 30_000, "Degraded board recovery");
  const resetResponse = await fetch(`${initial.endpoints.apiBase}/api/admin/board-demo/reset`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
  });
  const resetPayload = await resetResponse.json();
  if (resetResponse.status !== 202 || resetPayload.accepted !== true || resetPayload.generation !== health.boardDemoGeneration) {
    throw new Error(`Board reset request was not accepted safely: ${resetResponse.status} ${JSON.stringify(resetPayload)}`);
  }
  const resetSession = await waitFor(async () => {
    const session = await readBoardDemoSession(sessionFile);
    if (session?.status !== "ready" || session?.resetCount !== 1 || !session?.lastResetAt || session?.lastPreflight?.passed !== 9) return null;
    const servicesReplaced = Object.entries(session.services || {}).every(([name, service]) => {
      const pid = Number(service.pid);
      return pid > 0 && pid !== preResetPids[name] && processAlive(pid);
    });
    if (!servicesReplaced) return null;
    rememberServicePids(session);
    return session;
  }, 90_000, "Board presentation reset");
  const resetHealthResponse = await fetch(`${resetSession.endpoints.apiBase}/health`);
  const resetHealth = await resetHealthResponse.json();
  if (!resetHealthResponse.ok || !resetHealth.boardDemoResetReady || resetHealth.boardDemoGeneration === health.boardDemoGeneration) {
    throw new Error("Board reset did not publish a fresh reset-ready runtime generation.");
  }
  try {
    await access(resetProbe);
    throw new Error("Board reset retained a runtime file outside the prepared baseline.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const resetReport = await preflight(sessionFile);
  if (!output.includes("Reset requested during api readiness check; replacing it.")) {
    throw new Error(`Board reset did not preempt the active API readiness check:\n${output.slice(-12_000)}`);
  }
  console.log(`  ok presentation reset replaces every service, restores the baseline, and returns to ${resetReport.passed}/${resetReport.total}`);

  const originalApiPid = Number(resetSession.services.api.pid);
  process.kill(originalApiPid, "SIGKILL");
  const recovered = await waitFor(async () => {
    const session = await readBoardDemoSession(sessionFile);
    const apiPid = Number(session?.services?.api?.pid);
    if (session?.status !== "ready" || apiPid === originalApiPid || !processAlive(apiPid) || session?.services?.api?.restartCount < 1) return null;
    rememberServicePids(session);
    return session;
  }, 60_000, "API crash recovery");
  console.log(`  ok supervisor replaces a failed API process (${originalApiPid} -> ${recovered.services.api.pid})`);

  const recoveredReport = await preflight(sessionFile);
  console.log(`  ok recovered stack returns to ${recoveredReport.passed}/${recoveredReport.total} readiness`);

  const stopped = await run(process.execPath, ["scripts/stop-board-demo.mjs", "--session-file", sessionFile], process.env, 25_000);
  if (stopped.code !== 0) throw new Error(`Board stop command failed:\n${stopped.stderr}\n${stopped.stdout}`);
  await waitFor(async () => supervisor.exitCode != null, 10_000, "Supervisor exit");
  if (supervisor.exitCode !== 0) throw new Error(`Supervisor exited ${supervisor.exitCode}:\n${output.slice(-12_000)}`);
  const finalSession = await readBoardDemoSession(sessionFile);
  if (finalSession?.status !== "stopped") throw new Error(`Final session status is ${finalSession?.status || "missing"}.`);
  const lingeringAfterFirstStop = [...observedPids].filter(processAlive);
  if (lingeringAfterFirstStop.length) throw new Error(`Board child processes remained alive after shutdown: ${lingeringAfterFirstStop.join(", ")}`);
  console.log(`  ok stop command shuts down the supervisor and all ${observedPids.size} observed child processes`);

  const restartPorts = {
    web: Number(new URL(finalSession.endpoints.webBase).port),
    api: Number(new URL(finalSession.endpoints.apiBase).port),
    email: Number(new URL(finalSession.endpoints.emailBase).port),
    sms: Number(new URL(finalSession.endpoints.smsBase).port)
  };
  output = "";
  supervisor = startSupervisor([
    "--runtime", runtimeRoot,
    "--session-file", sessionFile,
    "--web-port", String(restartPorts.web),
    "--api-port", String(restartPorts.api),
    "--email-port", String(restartPorts.email),
    "--sms-port", String(restartPorts.sms),
    "--strict-ports"
  ], supervisorEnvironment);
  const restarted = await waitFor(async () => {
    const session = await readBoardDemoSession(sessionFile);
    if (session?.status !== "ready" || session?.lastPreflight?.passed !== 9) return null;
    rememberServicePids(session);
    return session;
  }, 90_000, "Board supervisor restart");
  if (restarted.runtimeReused !== true || restarted.runtimeRefreshed !== false) {
    throw new Error("Normal supervisor restart unexpectedly replaced the compatible board runtime.");
  }
  const restartedEmailResponse = await fetch(`${restarted.endpoints.emailBase}/health`);
  const restartedEmail = await restartedEmailResponse.json();
  if (!restartedEmailResponse.ok || restartedEmail.acceptedMessages !== 0 || restartedEmail.deliveryCallbacks !== 0) {
    throw new Error("Fresh loopback mailbox did not begin with empty in-memory counters after restart.");
  }
  const restartedReport = await preflight(sessionFile);
  console.log(`  ok normal restart reuses durable delivery proof and returns to ${restartedReport.passed}/${restartedReport.total} readiness`);

  const restartedStop = await run(process.execPath, ["scripts/stop-board-demo.mjs", "--session-file", sessionFile], process.env, 25_000);
  if (restartedStop.code !== 0) throw new Error(`Restarted board stop command failed:\n${restartedStop.stderr}\n${restartedStop.stdout}`);
  await waitFor(async () => supervisor.exitCode != null, 10_000, "Restarted supervisor exit");
  if (supervisor.exitCode !== 0) throw new Error(`Restarted supervisor exited ${supervisor.exitCode}:\n${output.slice(-12_000)}`);
  const restartedFinalSession = await readBoardDemoSession(sessionFile);
  if (restartedFinalSession?.status !== "stopped") throw new Error(`Restarted session status is ${restartedFinalSession?.status || "missing"}.`);
  const lingering = [...observedPids].filter(processAlive);
  if (lingering.length) throw new Error(`Board child processes remained alive after shutdown: ${lingering.join(", ")}`);
  console.log(`  ok second stop shuts down every process observed across both supervisor lifecycles`);
  console.log("\nBoard demo supervisor: 15/15 checks passed.\n");
} catch (error) {
  console.error(`\nBoard demo supervisor test failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (supervisor && supervisor.exitCode == null) {
    supervisor.kill("SIGTERM");
    await Promise.race([
      new Promise(resolve => supervisor.once("exit", resolve)),
      wait(5_000)
    ]);
    if (supervisor.exitCode == null) supervisor.kill("SIGKILL");
  }
  for (const pid of observedPids) {
    if (processAlive(pid)) process.kill(pid, "SIGKILL");
  }
  if (occupiedPortServer) await new Promise(resolve => occupiedPortServer.close(resolve));
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
