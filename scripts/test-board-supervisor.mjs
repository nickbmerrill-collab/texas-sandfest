#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOARD_RUNTIME_LABEL, BOARD_RUNTIME_SCHEMA_VERSION, prepareBoardRuntime } from "../lib/board-runtime.mjs";
import { BOARD_DEMO_PREFLIGHT_CHECK_COUNT } from "../lib/board-demo-readiness.mjs";
import { BOARD_DEMO_SESSION_SCHEMA_VERSION, readBoardDemoSession } from "../lib/board-demo-session.mjs";
import { DEFAULT_EVENT_ID } from "../lib/event-context.mjs";
import { emptyPartnerOperations } from "../lib/partner-ops.mjs";
import { platformDocumentFilePath } from "../lib/platform-data.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_TOKEN = "board-demo-local-admin-token-change-me";
let temporary = null;
let supervisor = null;
let staleApi = null;
let staleWorker = null;
let occupiedPortServer = null;
let output = "";
let staleApiOutput = "";
let staleWorkerOutput = "";
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
  if (result.code !== 0 || !report.ok || report.passed !== BOARD_DEMO_PREFLIGHT_CHECK_COUNT || report.total !== BOARD_DEMO_PREFLIGHT_CHECK_COUNT) {
    throw new Error(`Board preflight failed ${report.passed}/${report.total}:\n${JSON.stringify(report, null, 2)}`);
  }
  return report;
}

async function browserRehearsal(sessionFile, environment = {}) {
  const result = await run(process.execPath, ["scripts/check-board-browser.mjs", "--json"], {
    ...commandEnvironment(sessionFile),
    ...environment
  }, 90_000);
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Board browser rehearsal returned invalid JSON:\n${result.stderr}\n${result.stdout}`);
  }
  if (result.code !== 0 || !report.ok || report.passed !== 14 || report.total !== 14) {
    throw new Error(`Board browser rehearsal failed ${report.passed}/${report.total}:\n${JSON.stringify(report, null, 2)}`);
  }
  return report;
}

async function signupProofRehearsal(sessionFile) {
  const result = await run(
    process.execPath,
    ["scripts/prove-board-signups.mjs", "--json"],
    commandEnvironment(sessionFile),
    120_000
  );
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Board signup proof returned invalid JSON:\n${result.stderr}\n${result.stdout}`);
  }
  if (
    result.code !== 0
    || report.ok !== true
    || report.submissions?.length !== 2
    || report.operations?.applicationCount !== 7
    || report.reset?.applicationCount !== 5
    || report.reset?.preflight !== `${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}/${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}`
  ) {
    throw new Error(`Board signup proof failed:\n${JSON.stringify(report, null, 2)}`);
  }
  return report;
}

async function guestServicesProofRehearsal(sessionFile) {
  const result = await run(
    process.execPath,
    ["scripts/prove-board-guest-services.mjs", "--json"],
    commandEnvironment(sessionFile),
    180_000
  );
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Board Guest Services proof returned invalid JSON:\n${result.stderr}\n${result.stdout}`);
  }
  if (
    result.code !== 0
    || report.ok !== true
    || report.request?.category !== "accessibility"
    || report.request?.priority !== "high"
    || report.request?.assignedTeam !== "guest-services"
    || report.request?.replayed !== true
    || report.request?.invalidCapabilityDenied !== true
    || report.request?.privateAccessIssued !== true
    || report.triage?.status !== "in_progress"
    || report.triage?.publicUpdates !== 2
    || report.triage?.internalUpdates !== 1
    || report.resolution?.status !== "resolved"
    || report.resolution?.resolved !== true
    || report.resolution?.publicUpdates !== 3
    || report.resolution?.internalUpdates !== 2
    || report.dashboard?.total !== 4
    || report.dashboard?.active !== 2
    || report.dashboard?.resolved !== 2
    || report.audit?.records !== 2
    || report.reset?.total !== 3
    || report.reset?.active !== 2
    || report.reset?.resolved !== 1
    || report.reset?.preflight !== `${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}/${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}`
  ) {
    throw new Error(`Board Guest Services proof failed:\n${JSON.stringify(report, null, 2)}`);
  }
  return report;
}

async function vendorJourneyProofRehearsal(sessionFile) {
  const result = await run(
    process.execPath,
    ["scripts/prove-board-vendor-journey.mjs", "--json"],
    commandEnvironment(sessionFile),
    240_000
  );
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Board vendor journey proof returned invalid JSON:\n${result.stderr}\n${result.stdout}`);
  }
  if (
    result.code !== 0
    || report.ok !== true
    || report.application?.type !== "vendor"
    || report.application?.intakeMode !== "application"
    || report.application?.offeringId !== "marketplace-booth"
    || report.application?.status !== "approved"
    || report.profile?.status !== "approved"
    || report.profile?.revision !== 2
    || report.compliance?.required !== 5
    || report.compliance?.approved !== 5
    || report.compliance?.documents !== 5
    || report.compliance?.verifiedBytes < 1
    || report.compliance?.replacementDocument !== true
    || report.assignment?.status !== "confirmed"
    || report.assignment?.boothNumber !== "M-27"
    || report.assignment?.partnerConfirmed !== true
    || report.notices?.delivered !== 3
    || report.readiness?.status !== "ready"
    || report.readiness?.readyVendors !== 2
    || report.readiness?.totalVendors !== 3
    || report.audit?.records < 10
    || report.reset?.applications !== 5
    || report.reset?.vendorApplications !== 3
    || report.reset?.vendorProfiles !== 2
    || report.reset?.vendorRequirements !== 12
    || report.reset?.vendorDocuments !== 0
    || report.reset?.vendorAssignments !== 2
    || report.reset?.ready !== 1
    || report.reset?.blocked !== 1
    || report.reset?.interests !== 1
    || report.reset?.preflight !== `${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}/${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}`
  ) {
    throw new Error(`Board vendor journey proof failed:\n${JSON.stringify(report, null, 2)}`);
  }
  return report;
}

async function sponsorJourneyProofRehearsal(sessionFile) {
  const result = await run(
    process.execPath,
    ["scripts/prove-board-sponsor-journey.mjs", "--json"],
    commandEnvironment(sessionFile),
    180_000
  );
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Board sponsor journey proof returned invalid JSON:\n${result.stderr}\n${result.stdout}`);
  }
  if (
    result.code !== 0
    || report.ok !== true
    || report.invitation?.packageId !== "tarpon"
    || report.application?.type !== "sponsor"
    || report.application?.outreachConversion !== true
    || report.review?.applicationStatus !== "approved"
    || report.review?.profileStatus !== "approved"
    || report.review?.assetStatus !== "approved"
    || report.showcase?.sponsorCount !== 2
    || report.showcase?.logoBytes < 1
    || !/^[a-f0-9]{64}$/i.test(String(report.showcase?.logoChecksumSha256 || ""))
    || report.audit?.records < 4
    || report.reset?.applications !== 5
    || report.reset?.prospects !== 2
    || report.reset?.wonProspects !== 0
    || report.reset?.featuredSponsors !== 1
    || report.reset?.preflight !== `${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}/${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}`
  ) {
    throw new Error(`Board sponsor journey proof failed:\n${JSON.stringify(report, null, 2)}`);
  }
  return report;
}

async function outreachJourneyProofRehearsal(sessionFile) {
  const result = await run(
    process.execPath,
    ["scripts/prove-board-outreach-journey.mjs", "--json"],
    commandEnvironment(sessionFile),
    180_000
  );
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Board outreach journey proof returned invalid JSON:\n${result.stderr}\n${result.stdout}`);
  }
  if (
    result.code !== 0
    || report.ok !== true
    || report.discovery?.provider !== "fixture"
    || report.discovery?.source !== "board_demo_discovery"
    || report.discovery?.researchRequired !== true
    || report.qualification?.status !== "contact_ready"
    || report.qualification?.fitScore < 60
    || report.qualification?.ownerId !== "sponsor"
    || report.qualification?.nextActionScheduled !== true
    || report.invitation?.packageId !== "tarpon"
    || report.campaign?.status !== "active"
    || report.campaign?.matched !== 1
    || report.campaign?.radiusMiles !== 2
    || report.campaign?.dailySendLimit !== 1
    || report.delivery?.status !== "sent"
    || report.delivery?.deliveryStatus !== "delivered"
    || report.delivery?.provider !== "brevo"
    || report.delivery?.attempts !== 1
    || report.delivery?.sandboxAuthenticated !== true
    || report.delivery?.invitationDelivered !== true
    || report.delivery?.preferenceDelivered !== true
    || report.preference?.invalidCapabilityDenied !== true
    || report.preference?.capabilityConcealed !== true
    || report.preference?.status !== "unsubscribed"
    || report.preference?.replayed !== true
    || report.operations?.prospects !== 3
    || report.operations?.qualified !== 2
    || report.operations?.suppressed !== 1
    || report.operations?.campaigns !== 3
    || report.operations?.activeCampaigns !== 3
    || report.operations?.messagesSent !== 2
    || report.operations?.followups !== 25
    || report.audit?.records !== 7
    || report.reset?.prospects !== 2
    || report.reset?.qualified !== 2
    || report.reset?.suppressed !== 0
    || report.reset?.campaigns !== 2
    || report.reset?.activeCampaigns !== 2
    || report.reset?.messagesSent !== 1
    || report.reset?.followups !== 24
    || report.reset?.preflight !== `${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}/${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}`
  ) {
    throw new Error(`Board outreach journey proof failed:\n${JSON.stringify(report, null, 2)}`);
  }
  return report;
}

async function ticketLifecycleProofRehearsal(sessionFile) {
  const result = await run(
    process.execPath,
    ["scripts/prove-board-ticket-lifecycle.mjs", "--json"],
    commandEnvironment(sessionFile),
    180_000
  );
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Board ticket lifecycle proof returned invalid JSON:\n${result.stderr}\n${result.stdout}`);
  }
  if (
    result.code !== 0
    || report.ok !== true
    || report.purchase?.status !== "paid"
    || report.purchase?.quantity !== 2
    || report.purchase?.amountCents !== 6_000
    || report.purchase?.fulfillmentCount !== 2
    || report.refund?.status !== "refunded"
    || report.refund?.refundedAmountCents !== 6_000
    || report.refund?.fulfillmentRefunded !== 2
    || report.revenue?.ticketEntries !== 2
    || report.revenue?.refundCents !== 6_000
    || report.revenue?.ticketsSold !== 100
    || report.audit?.records !== 1
    || report.reset?.orders !== 0
    || report.reset?.paymentEvents !== 0
    || report.reset?.fulfillment !== 0
    || report.reset?.ticketEntries !== 0
    || report.reset?.preflight !== `${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}/${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}`
  ) {
    throw new Error(`Board ticket lifecycle proof failed:\n${JSON.stringify(report, null, 2)}`);
  }
  return report;
}

async function operationsProofRehearsal(sessionFile) {
  const result = await run(
    process.execPath,
    ["scripts/prove-board-operations.mjs", "--json"],
    commandEnvironment(sessionFile),
    180_000
  );
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Board Operations proof returned invalid JSON:\n${result.stderr}\n${result.stdout}`);
  }
  if (
    result.code !== 0
    || report.ok !== true
    || report.accounting?.expenseStatus !== "paid"
    || report.payment?.amountCents !== 500_000
    || report.delegation?.assigneeType !== "volunteer"
    || report.keyDate?.status !== "open"
    || report.deliveries?.delivered !== 3
    || report.exports?.files !== 5
    || report.exports?.budgetRows !== 7
    || report.exports?.expenseRows !== 8
    || report.exports?.paymentRows !== 2
    || report.exports?.receivableRows !== 4
    || report.exports?.calendarEvents !== 17
    || report.audit?.records !== 11
    || report.audit?.exports !== 5
    || report.reset?.applications !== 5
    || report.reset?.budgetLines !== 6
    || report.reset?.expenses !== 7
    || report.reset?.openTasks !== 10
    || report.reset?.milestones !== 16
    || report.reset?.preflight !== `${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}/${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}`
  ) {
    throw new Error(`Board Operations proof failed:\n${JSON.stringify(report, null, 2)}`);
  }
  return report;
}

async function delegationJourneyProofRehearsal(sessionFile) {
  const result = await run(
    process.execPath,
    ["scripts/prove-board-delegation-journey.mjs", "--json"],
    commandEnvironment(sessionFile),
    180_000
  );
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Board delegation journey proof returned invalid JSON:\n${result.stderr}\n${result.stdout}`);
  }
  if (
    result.code !== 0
    || report.ok !== true
    || report.delegation?.assigneeType !== "volunteer"
    || report.delegation?.priority !== "high"
    || report.delegation?.status !== "open"
    || report.delivery?.status !== "sent"
    || report.delivery?.deliveryStatus !== "delivered"
    || report.delivery?.provider !== "brevo"
    || report.delivery?.sandboxAuthenticated !== true
    || report.delivery?.privateAccessDelivered !== true
    || report.portal?.invalidCapabilityDenied !== true
    || report.portal?.capabilityConcealed !== true
    || report.portal?.acknowledged !== true
    || report.portal?.started !== true
    || report.portal?.blockerNoteRequired !== true
    || report.portal?.blocked !== true
    || report.portal?.completed !== true
    || report.portal?.replayed !== true
    || report.portal?.updates !== 4
    || report.operations?.total !== 12
    || report.operations?.active !== 10
    || report.operations?.completed !== 2
    || report.operations?.assignmentNotices !== 11
    || report.operations?.followups !== 25
    || report.audit?.records !== 4
    || report.reset?.total !== 11
    || report.reset?.active !== 10
    || report.reset?.completed !== 1
    || report.reset?.assignmentNotices !== 10
    || report.reset?.followups !== 24
    || report.reset?.preflight !== `${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}/${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}`
  ) {
    throw new Error(`Board delegation journey proof failed:\n${JSON.stringify(report, null, 2)}`);
  }
  return report;
}

async function incidentJourneyProofRehearsal(sessionFile) {
  const result = await run(
    process.execPath,
    ["scripts/prove-board-incident-journey.mjs", "--json"],
    commandEnvironment(sessionFile),
    180_000
  );
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Board camera incident journey proof returned invalid JSON:\n${result.stderr}\n${result.stdout}`);
  }
  if (
    result.code !== 0
    || report.ok !== true
    || report.camera?.cameraId !== "north-gate"
    || report.camera?.severity !== "critical"
    || report.camera?.replayed !== true
    || report.incident?.ownerTeam !== "traffic"
    || report.incident?.publicImpact !== true
    || report.notice?.visible !== true
    || report.notice?.privateProjection !== true
    || report.dispatch?.assigneeType !== "team"
    || report.dispatch?.assigneeName !== "Traffic and parking"
    || report.dispatch?.status !== "completed"
    || report.delivery?.status !== "sent"
    || report.delivery?.provider !== "brevo"
    || report.delivery?.sandboxAuthenticated !== true
    || report.delivery?.recipientConcealed !== true
    || report.recovery?.status !== "monitoring"
    || report.recovery?.automatic !== true
    || report.resolution?.status !== "resolved"
    || report.resolution?.publicNoticeRemoved !== true
    || report.audit?.records !== 11
    || report.audit?.private !== true
    || report.reset?.incidents !== 0
    || report.reset?.activeIncidents !== 0
    || report.reset?.dispatches !== 0
    || report.reset?.activeDispatches !== 0
    || report.reset?.publicNotices !== 0
    || report.reset?.preflight !== `${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}/${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}`
  ) {
    throw new Error(`Board camera incident journey proof failed:\n${JSON.stringify(report, null, 2)}`);
  }
  return report;
}

async function documentProofRehearsal(sessionFile) {
  const result = await run(
    process.execPath,
    ["scripts/prove-board-documents.mjs", "--json"],
    commandEnvironment(sessionFile),
    180_000
  );
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Board document-ingestion proof returned invalid JSON:\n${result.stderr}\n${result.stdout}`);
  }
  if (
    result.code !== 0
    || report.ok !== true
    || report.document?.reviewTaskStatus !== "done"
    || report.document?.extractedCharacterCount < 5_000
    || report.document?.extractedChunkCount < 1
    || report.document?.extractionJobStatus !== "done"
    || !/^[a-f0-9]{64}$/i.test(String(report.document?.checksumSha256 || ""))
    || report.audit?.records < 4
    || report.reset?.total !== 4
    || report.reset?.openTasks !== 10
    || report.reset?.jobsTotal !== 21
    || report.reset?.preflight !== `${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}/${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}`
  ) {
    throw new Error(`Board document-ingestion proof failed:\n${JSON.stringify(report, null, 2)}`);
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
  const [apiPort, emailPort, smsPort, staleApiPort] = await distinctPorts(4);
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
  staleRuntimeMarker.runtimeLabel = "Outdated presentation label";
  await writeFile(runtimeMarkerPath, `${JSON.stringify(staleRuntimeMarker, null, 2)}\n`, "utf8");
  const staleWorkerEnvironment = {
    ...process.env,
    SANDFEST_DATABASE_URL: "",
    SANDFEST_RUNTIME_ROOT: runtimeRoot,
    SANDFEST_RUNTIME_OWNER_ID: "",
    SANDFEST_EVENT_ID: DEFAULT_EVENT_ID,
    SANDFEST_WORKER_POLL_MS: "100",
    TRANSACTIONAL_EMAIL_ENABLED: "false"
  };
  staleWorker = spawn(process.execPath, ["scripts/worker.mjs"], {
    cwd: ROOT,
    env: staleWorkerEnvironment,
    stdio: ["ignore", "pipe", "pipe"]
  });
  staleWorker.stdout.on("data", chunk => { staleWorkerOutput += String(chunk); });
  staleWorker.stderr.on("data", chunk => { staleWorkerOutput += String(chunk); });
  await waitFor(async () => staleWorkerOutput.includes("[worker] started") ? true : null, 10_000, "Stale worker startup");
  staleApi = spawn(process.execPath, ["scripts/admin-api-server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(staleApiPort),
      SANDFEST_API_HOST: "127.0.0.1",
      SANDFEST_DATABASE_URL: "",
      SANDFEST_RUNTIME_ROOT: runtimeRoot,
      SANDFEST_RUNTIME_OWNER_ID: "",
      SANDFEST_EVENT_ID: DEFAULT_EVENT_ID,
      SANDFEST_ADMIN_API_TOKEN: ADMIN_TOKEN
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  staleApi.stdout.on("data", chunk => { staleApiOutput += String(chunk); });
  staleApi.stderr.on("data", chunk => { staleApiOutput += String(chunk); });
  await waitFor(async () => staleApiOutput.includes("SandFest admin API listening") ? true : null, 10_000, "Stale API startup");
  const supervisorEnvironment = {
    ...commandEnvironment(sessionFile),
    SANDFEST_BOARD_ALLOW_DIRTY_SOURCE: "true",
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
  // The CLI option must be sufficient for the supervisor's own preflight.
  delete supervisorEnvironment.SANDFEST_BOARD_SESSION_FILE;
  supervisor = startSupervisor([
    "--runtime", runtimeRoot,
    "--session-file", sessionFile,
    "--web-port", String(webPort),
    "--api-port", String(apiPort),
    "--email-port", String(emailPort),
    "--sms-port", String(smsPort)
  ], supervisorEnvironment);

  await waitFor(async () => {
    const session = await readBoardDemoSession(sessionFile);
    return session?.status === "starting" ? session : null;
  }, 10_000, "Starting board demo session");
  const eagerBrowserRehearsal = browserRehearsal(sessionFile, {
    SANDFEST_BOARD_BROWSER_SESSION_WAIT_MS: "60000"
  }).then(report => ({ report }), error => ({ error }));

  const initial = await waitFor(async () => {
    const session = await readBoardDemoSession(sessionFile);
    if (session?.status !== "ready" || session?.lastPreflight?.passed !== BOARD_DEMO_PREFLIGHT_CHECK_COUNT) return null;
    rememberServicePids(session);
    return session;
  }, 90_000, "Initial board demo readiness");
  if (!output.includes(`Board presentation stack is ready (${BOARD_DEMO_PREFLIGHT_CHECK_COUNT}/${BOARD_DEMO_PREFLIGHT_CHECK_COUNT} checks).`)) {
    throw new Error(`Supervisor startup banner does not match the current readiness report:\n${output.slice(-4_000)}`);
  }
  if (Number(new URL(initial.endpoints.webBase).port) === webPort || !occupiedPortServer.listening) {
    throw new Error("Supervisor did not preserve and move around the occupied web port.");
  }
  console.log(`  ok supervisor preserves an occupied port and starts the complete stack (PID ${initial.pid})`);
  await waitFor(async () => staleWorker.exitCode != null ? true : null, 10_000, "Stale worker ownership fence");
  if (staleWorker.exitCode !== 0 || !staleWorkerOutput.includes("no longer owns the supervised board runtime")) {
    throw new Error(`Stale worker was not fenced cleanly:\n${staleWorkerOutput.slice(-4_000)}`);
  }
  console.log("  ok supervisor ownership fence retires a stale worker sharing the runtime");
  const staleApiResponse = await fetch(`http://127.0.0.1:${staleApiPort}/health`);
  const staleApiPayload = await staleApiResponse.json();
  if (staleApiResponse.status !== 409 || !String(staleApiPayload.error || "").includes("no longer owns")) {
    throw new Error(`Stale API was not fenced cleanly: ${staleApiResponse.status} ${JSON.stringify(staleApiPayload)}`);
  }
  console.log("  ok supervisor ownership fence rejects a stale API sharing the runtime");
  if (
    initial.schemaVersion !== BOARD_DEMO_SESSION_SCHEMA_VERSION
    || !/^[a-f0-9]{40}$/i.test(String(initial.source?.commit || ""))
    || !/^[a-f0-9]{64}$/i.test(String(initial.source?.statusHash || ""))
    || initial.source?.allowDirty !== true
  ) {
    throw new Error("Supervisor did not capture a privacy-minimized source revision snapshot.");
  }
  console.log(`  ok supervisor pins source ${initial.source.branch}@${initial.source.commit.slice(0, 8)} without storing changed paths`);
  const upgradedRuntimeMarker = JSON.parse(await readFile(runtimeMarkerPath, "utf8"));
  if (
    initial.runtimeReused !== false
    || initial.runtimeRefreshed !== true
    || initial.runtimeSchemaVersion !== BOARD_RUNTIME_SCHEMA_VERSION
    || !initial.runtimeRefreshReasons?.some(reason => reason.startsWith("schema "))
    || !initial.runtimeRefreshReasons?.includes("runtime label changed")
    || !initial.runtimeRefreshReasons?.some(reason => reason.startsWith("message mode "))
    || upgradedRuntimeMarker.schemaVersion !== BOARD_RUNTIME_SCHEMA_VERSION
    || upgradedRuntimeMarker.runtimeLabel !== BOARD_RUNTIME_LABEL
    || upgradedRuntimeMarker.messageMode !== "local_automation"
    || !/^[a-f0-9-]{36}$/i.test(String(upgradedRuntimeMarker.runtimeOwnerId || ""))
    || !Number.isFinite(Date.parse(upgradedRuntimeMarker.ownershipClaimedAt))
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
  const deliveredMilestoneReminders = deliveredMessages.filter(item => item.kind === "milestone_reminder" && item.automationPolicy === "partner_transactional_v1");
  const reviewReadyOutreach = (partnerWorkspace.followups || []).filter(item => item.kind === "sponsor_outreach" && item.status === "draft_ready" && !item.automationPolicy);
  const providerChecks = (partnerWorkspace.followups || []).filter(item => item.status === "delivery_unknown" && item.deliveryOutcomeUnknown === true);
  const providerCheck = providerChecks[0];
  const blockedProviderRetryResponse = await fetch(`${initial.endpoints.apiBase}/api/admin/partners/followups/${encodeURIComponent(providerCheck?.id || "missing")}/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
  });
  const blockedProviderRetry = await blockedProviderRetryResponse.json();
  const localAutomationReady = partnerResponse.ok
    && emailSandboxResponse.ok
    && partnerWorkspace.automationMode === "transactional_auto"
    && partnerWorkspace.automation?.active === true
    && deliveredMessages.some(item => item.automationPolicy === "partner_transactional_v1")
    && deliveredMessages.some(item => item.automationPolicy === "outreach_campaign_v1")
    && deliveredMilestoneReminders.length >= 1
    && reviewReadyOutreach.length >= 1
    && providerChecks.length === 1
    && partnerWorkspace.summary?.operations?.unknownDeliveryMessages === 1
    && providerCheck?.kind === "provider_verification_demo"
    && providerCheck?.provider === "worker"
    && providerCheck?.providerMessageId == null
    && Number.isFinite(Date.parse(providerCheck?.providerSubmissionStartedAt))
    && providerCheck?.deliveryAttempts === 1
    && !("deliveryIdempotencyKey" in providerCheck)
    && !("deliveryClaimId" in providerCheck)
    && blockedProviderRetryResponse.status === 409
    && blockedProviderRetry.error?.includes("Verify the provider outcome")
    && emailSandbox.acceptedMessages >= 2
    && emailSandbox.deliveryCallbacks >= 2
    && emailSandbox.callbackFailures === 0;
  if (!localAutomationReady) throw new Error("Board startup did not produce loopback-only transactional and campaign delivery proof.");
  console.log(`  ok local automation delivers ${deliveredMessages.length} synthetic messages including ${deliveredMilestoneReminders.length} key-date reminder, preserves ${reviewReadyOutreach.length} outreach draft for staff review, and locks ${providerChecks.length} ambiguous provider outcome against retry`);

  const initialReport = await preflight(sessionFile);
  if (initialReport.links?.visitor !== initial.links?.visitor || initialReport.links?.operations !== initial.links?.operations) {
    throw new Error("Board preflight did not return the exact active Visitor and Operations links.");
  }
  console.log(`  ok board:check discovers the active session and passes ${initialReport.passed}/${initialReport.total}`);
  const eagerBrowserResult = await eagerBrowserRehearsal;
  if (eagerBrowserResult.error) throw eagerBrowserResult.error;
  const commandNavigation = eagerBrowserResult.report.observations?.operations?.commandNavigation;
  if (
    commandNavigation?.targets?.length !== 8
    || commandNavigation.keyboard?.signal !== "applications"
    || commandNavigation.keyboard?.focusedHeading !== true
    || commandNavigation.maxElapsedMs > 2_000
  ) {
    throw new Error(`Board browser rehearsal lacks complete command navigation evidence: ${JSON.stringify(commandNavigation)}`);
  }
  const visitorHint = eagerBrowserResult.report.observations?.visitor?.nextSectionHint;
  if (visitorHint?.id !== "live-beach" || visitorHint.headingVisiblePixels < 24) {
    throw new Error(`Board browser rehearsal lacks a first-viewport Live Beach cue: ${JSON.stringify(visitorHint)}`);
  }
  const responsive = eagerBrowserResult.report.observations?.responsive;
  const responsiveSnapshots = [responsive?.visitor320, responsive?.visitor1024, responsive?.operations320, responsive?.operations768];
  if (
    responsive?.visitor320?.width !== 320
    || responsive?.visitor1024?.width !== 1024
    || responsive?.operations320?.width !== 320
    || responsive?.operations768?.width !== 768
    || responsiveSnapshots.some(item => (
      !item
      || item.overflowPixels !== 0
      || item.controlTargetIssues?.length !== 0
      || item.choiceTargetIssues?.length !== 0
    ))
    || responsive?.visitor320?.nextSectionHint?.id !== "live-beach"
    || responsive?.visitor320?.nextSectionHint?.headingVisiblePixels < 24
    || responsive?.visitor1024?.nextSectionHint?.id !== "live-beach"
    || responsive?.visitor1024?.nextSectionHint?.headingVisiblePixels < 24
  ) {
    throw new Error(`Board browser rehearsal lacks complete phone/tablet evidence: ${JSON.stringify(responsive)}`);
  }
  console.log(`  ok board:rehearse waits through startup and renders the active visitor and operations session ${eagerBrowserResult.report.passed}/${eagerBrowserResult.report.total}`);
  const staleSourceSessionFile = path.join(temporary, "stale-source-session.json");
  await writeFile(staleSourceSessionFile, `${JSON.stringify({
    ...initial,
    source: { ...initial.source, commit: "0".repeat(40) }
  }, null, 2)}\n`);
  const staleSourceResult = await run(process.execPath, ["scripts/check-board-demo.mjs", "--json"], commandEnvironment(staleSourceSessionFile), 20_000);
  const staleSourceReport = JSON.parse(staleSourceResult.stdout);
  if (staleSourceResult.code === 0
    || staleSourceReport.checks?.find(item => item.id === "source_revision")?.ok !== false
    || staleSourceReport.links?.visitor !== null
    || staleSourceReport.links?.operations !== null) {
    throw new Error("Board preflight accepted a session pinned to a different source revision.");
  }
  const staleSourceBrowserResult = await run(process.execPath, ["scripts/check-board-browser.mjs", "--json"], commandEnvironment(staleSourceSessionFile), 20_000);
  const staleSourceBrowserReport = JSON.parse(staleSourceBrowserResult.stdout);
  if (staleSourceBrowserResult.code === 0 || staleSourceBrowserReport.checks?.find(item => item.id === "session")?.ok !== false) {
    throw new Error("Board browser rehearsal accepted a session pinned to a different source revision.");
  }
  console.log("  ok preflight and browser rehearsal reject source drift before presentation navigation");
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
    if (session?.status !== "ready" || session?.resetCount !== 1 || !session?.lastResetAt || session?.lastPreflight?.passed !== BOARD_DEMO_PREFLIGHT_CHECK_COUNT) return null;
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
  const resetWebResponse = await fetch(resetSession.endpoints.webBase);
  const resetWebHtml = await resetWebResponse.text();
  if (!resetWebResponse.ok || !resetWebHtml.includes(JSON.stringify(resetHealth.boardDemoGeneration))) {
    throw new Error("Board reset did not publish its fresh runtime generation to the visitor surface.");
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

  const signupProof = await signupProofRehearsal(sessionFile);
  const signupProofSession = await readBoardDemoSession(sessionFile);
  rememberServicePids(signupProofSession);
  console.log(`  ok public signup proof creates ${signupProof.submissions.length} applications, renders ${signupProof.operations.applicationCount} in Operations, and restores the ${signupProof.reset.applicationCount}-application baseline`);

  const guestServicesProof = await guestServicesProofRehearsal(sessionFile);
  const guestServicesProofSession = await readBoardDemoSession(sessionFile);
  rememberServicePids(guestServicesProofSession);
  console.log(`  ok Guest Services journey denies invalid access, publishes ${guestServicesProof.resolution.publicUpdates} visitor updates, withholds ${guestServicesProof.resolution.internalUpdates} internal notes, records ${guestServicesProof.audit.records} audits, and restores ${guestServicesProof.reset.preflight} readiness`);

  const vendorJourneyProof = await vendorJourneyProofRehearsal(sessionFile);
  const vendorJourneyProofSession = await readBoardDemoSession(sessionFile);
  rememberServicePids(vendorJourneyProofSession);
  console.log(`  ok vendor journey approves ${vendorJourneyProof.compliance.approved}/${vendorJourneyProof.compliance.required} private documents, delivers ${vendorJourneyProof.notices.delivered} notices, confirms ${vendorJourneyProof.assignment.boothNumber}, records ${vendorJourneyProof.audit.records} audits, and restores ${vendorJourneyProof.reset.preflight} readiness`);

  const sponsorJourneyProof = await sponsorJourneyProofRehearsal(sessionFile);
  const sponsorJourneyProofSession = await readBoardDemoSession(sessionFile);
  rememberServicePids(sponsorJourneyProofSession);
  console.log(`  ok sponsor journey converts a ${sponsorJourneyProof.invitation.packageId} invitation, approves branding, byte-verifies ${sponsorJourneyProof.showcase.logoBytes} public logo bytes, records ${sponsorJourneyProof.audit.records} audits, and restores ${sponsorJourneyProof.reset.preflight} readiness`);

  const outreachJourneyProof = await outreachJourneyProofRehearsal(sessionFile);
  const outreachJourneyProofSession = await readBoardDemoSession(sessionFile);
  rememberServicePids(outreachJourneyProofSession);
  console.log(`  ok outreach journey discovers and qualifies one ${outreachJourneyProof.discovery.provider} business, delivers one ${outreachJourneyProof.campaign.radiusMiles}-mile campaign, proves recipient suppression and ${outreachJourneyProof.audit.records} privacy-safe audits, and restores ${outreachJourneyProof.reset.preflight} readiness`);

  const ticketLifecycleProof = await ticketLifecycleProofRehearsal(sessionFile);
  const ticketLifecycleProofSession = await readBoardDemoSession(sessionFile);
  rememberServicePids(ticketLifecycleProofSession);
  console.log(`  ok ticket lifecycle records ${ticketLifecycleProof.purchase.quantity} admissions, refunds ${ticketLifecycleProof.refund.refundedAmountCents} cents, reverses ${ticketLifecycleProof.refund.fulfillmentRefunded} fulfillments, and restores ${ticketLifecycleProof.reset.preflight} readiness`);

  const operationsProof = await operationsProofRehearsal(sessionFile);
  const operationsProofSession = await readBoardDemoSession(sessionFile);
  rememberServicePids(operationsProofSession);
  console.log(`  ok Operations proof pays an expense, records $${(operationsProof.payment.amountCents / 100).toFixed(2)}, delivers ${operationsProof.deliveries.delivered} messages, parses ${operationsProof.exports.files} exports, verifies ${operationsProof.audit.records} reference-safe audits, and restores ${operationsProof.reset.preflight} readiness`);

  const delegationJourneyProof = await delegationJourneyProofRehearsal(sessionFile);
  const delegationJourneyProofSession = await readBoardDemoSession(sessionFile);
  rememberServicePids(delegationJourneyProofSession);
  console.log(`  ok delegation journey delivers one private ${delegationJourneyProof.delegation.assigneeType} assignment, records ${delegationJourneyProof.portal.updates} assignee updates and ${delegationJourneyProof.audit.records} privacy-safe audits, and restores ${delegationJourneyProof.reset.preflight} readiness`);

  const incidentJourneyProof = await incidentJourneyProofRehearsal(sessionFile);
  const incidentJourneyProofSession = await readBoardDemoSession(sessionFile);
  rememberServicePids(incidentJourneyProofSession);
  console.log(`  ok camera incident journey opens a retry-safe ${incidentJourneyProof.camera.severity} alert, dispatches ${incidentJourneyProof.dispatch.assigneeName}, delivers through local ${incidentJourneyProof.delivery.provider}, records ${incidentJourneyProof.audit.records} privacy-safe audits, and restores ${incidentJourneyProof.reset.preflight} readiness`);

  const documentProof = await documentProofRehearsal(sessionFile);
  const documentProofSession = await readBoardDemoSession(sessionFile);
  rememberServicePids(documentProofSession);
  console.log(`  ok document proof extracts ${documentProof.document.extractedCharacterCount} characters, completes delegated review, byte-verifies the download, records ${documentProof.audit.records} audits, and restores ${documentProof.reset.preflight} readiness`);

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
    if (session?.status !== "ready" || session?.lastPreflight?.passed !== BOARD_DEMO_PREFLIGHT_CHECK_COUNT) return null;
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
  console.log("\nBoard demo supervisor: 28/28 checks passed.\n");
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
  if (staleWorker && staleWorker.exitCode == null) {
    staleWorker.kill("SIGTERM");
    await Promise.race([
      new Promise(resolve => staleWorker.once("exit", resolve)),
      wait(2_000)
    ]);
    if (staleWorker.exitCode == null) staleWorker.kill("SIGKILL");
  }
  if (staleApi && staleApi.exitCode == null) {
    staleApi.kill("SIGTERM");
    await Promise.race([
      new Promise(resolve => staleApi.once("exit", resolve)),
      wait(2_000)
    ]);
    if (staleApi.exitCode == null) staleApi.kill("SIGKILL");
  }
  for (const pid of observedPids) {
    if (processAlive(pid)) process.kill(pid, "SIGKILL");
  }
  if (occupiedPortServer) await new Promise(resolve => occupiedPortServer.close(resolve));
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
