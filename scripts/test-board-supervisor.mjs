#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBoardDemoSession } from "../lib/board-demo-session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let temporary = null;
let supervisor = null;
let occupiedPortServer = null;
let feedFixtureServer = null;
let output = "";
let ferryFixtureRequests = 0;
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

function startFeedFixture() {
  const ferry = {
    roadwayDmses: {
      SH361AransasPass: [
        {
          icd_Id: "CRP-SH361 at New Port Golf",
          name: "SH361 at New Port Golf",
          hasMessages: true,
          statusDescription: "Device Online",
          messagePages: [{ pageNo: 0, lines: ["FERRY WAIT TO", "ARANSAS PASS", "15 MINUTES"] }]
        },
        {
          icd_Id: "CRP-SH361 at Dale Miller Brdg",
          name: "SH361 at Dale Miller Bridge",
          hasMessages: true,
          statusDescription: "Device Online",
          messagePages: [{ pageNo: 0, lines: ["FERRY WAIT TO", "PORT ARANSAS", "20 MINUTES"] }]
        }
      ]
    }
  };
  const server = createHttpServer((request, response) => {
    if (request.url === "/txdot/ferry") {
      ferryFixtureRequests += 1;
      if (ferryFixtureRequests === 1) {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "transient_fixture_failure" }));
        return;
      }
    }
    const now = Date.now();
    const payload = request.url === "/nws/forecast"
      ? { properties: { periods: [{
        temperature: 84,
        windSpeed: "9 mph",
        windDirection: "SE",
        shortForecast: "Board supervisor fixture",
        probabilityOfPrecipitation: { value: 10 },
        startTime: new Date(now - 60_000).toISOString(),
        endTime: new Date(now + 60 * 60_000).toISOString()
      }] } }
      : request.url === "/nws/alerts"
        ? { features: [] }
        : request.url === "/txdot/ferry"
          ? ferry
          : null;
    response.writeHead(payload ? 200 : 404, { "content-type": "application/json" });
    response.end(JSON.stringify(payload || { error: "not_found" }));
  });
  return new Promise((resolve, reject) => {
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

function rememberServicePids(session) {
  for (const service of Object.values(session?.services || {})) {
    if (Number.isInteger(Number(service.pid)) && Number(service.pid) > 0) observedPids.add(Number(service.pid));
  }
}

try {
  console.log("\n=== Board demo supervisor ===\n");
  temporary = await mkdtemp(path.join(tmpdir(), "sandfest-board-supervisor-test-"));
  const runtimeRoot = path.join(temporary, "runtime");
  const sessionFile = path.join(temporary, "session.json");
  occupiedPortServer = await occupyPort();
  feedFixtureServer = await startFeedFixture();
  const webPort = occupiedPortServer.address().port;
  const [apiPort, emailPort, smsPort] = await distinctPorts(3);
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
    QB_REFRESH_TOKEN: "inherited-test-refresh",
    SANDFEST_BOARD_FEED_FIXTURE_BASE_URL: `http://127.0.0.1:${feedFixtureServer.address().port}`
  };
  supervisor = spawn(process.execPath, [
    "scripts/board-demo.mjs",
    "--reset",
    "--runtime", runtimeRoot,
    "--session-file", sessionFile,
    "--web-port", String(webPort),
    "--api-port", String(apiPort),
    "--email-port", String(emailPort),
    "--sms-port", String(smsPort)
  ], {
    cwd: ROOT,
    env: supervisorEnvironment,
    stdio: ["ignore", "pipe", "pipe"]
  });
  supervisor.stdout.on("data", chunk => { output += String(chunk); });
  supervisor.stderr.on("data", chunk => { output += String(chunk); });

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
  if (ferryFixtureRequests < 2) throw new Error("Supervisor did not retry the transient TxDOT feed failure.");
  console.log(`  ok supervisor retries a transient TxDOT failure before reporting readiness (${ferryFixtureRequests} attempts)`);

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

  const initialReport = await preflight(sessionFile);
  console.log(`  ok board:check discovers the active session and passes ${initialReport.passed}/${initialReport.total}`);

  const originalApiPid = Number(initial.services.api.pid);
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
  const lingering = [...observedPids].filter(processAlive);
  if (lingering.length) throw new Error(`Board child processes remained alive after shutdown: ${lingering.join(", ")}`);
  console.log(`  ok stop command shuts down the supervisor and all ${observedPids.size} observed child processes`);
  console.log("\nBoard demo supervisor: 6/6 checks passed.\n");
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
  if (feedFixtureServer) await new Promise(resolve => feedFixtureServer.close(resolve));
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
