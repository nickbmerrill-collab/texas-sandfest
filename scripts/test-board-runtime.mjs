#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOARD_RUNTIME_LABEL, BOARD_RUNTIME_SCHEMA_VERSION, claimBoardRuntimeOwnership, prepareBoardRuntime } from "../lib/board-runtime.mjs";
import { runBoardCameraPlaybackTick } from "../lib/board-camera-playback.mjs";
import { boardEmailSandboxConfig, startBoardEmailSandbox } from "../lib/board-email-sandbox.mjs";
import { boardSmsSandboxConfig, startBoardSmsSandbox } from "../lib/board-sms-sandbox.mjs";
import { DEFAULT_EVENT_ID } from "../lib/event-context.mjs";
import { platformDocumentFilePath } from "../lib/platform-data.mjs";
import { publicAppBootstrapSafety } from "../lib/public-bootstrap.mjs";
import { partnerContactNotice } from "../lib/partner-consent.mjs";
import { RUNTIME_OWNERSHIP_ERROR_CODE, assertRuntimeOwnership, resolveRuntimeRoot, withRuntimeOwnership } from "../lib/runtime-root.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "board-runtime-test-admin-token-change-me";
const CAMERA_SECRET = "board-runtime-camera-secret-0123456789abcdef0123456789";
const EMAIL_API_KEY = "board-runtime-email-api-key-0123456789abcdef";
const EMAIL_WEBHOOK_TOKEN = "board-runtime-email-webhook-token-0123456789abcdef";
const BOARD_TICKET_SECRET = "board-runtime-ticket-secret-0123456789abcdef";
const SMS_ACCOUNT_SID = "AC00000000000000000000000000000001";
const SMS_AUTH_TOKEN = "board-runtime-twilio-auth-token-0123456789";
const SMS_FROM_NUMBER = "+13615550100";
const SMS_RECIPIENT = "+13615550188";
let passed = 0;
let failed = 0;
let child = null;
let emailSandbox = null;
let smsSandbox = null;
let temporary = null;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok ${name}${detail ? ` - ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  not ok ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

async function digest(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
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

async function startApi(port, runtimeRoot, emailPort, smsPort) {
  const processEnv = {
    ...process.env,
    SANDFEST_RUNTIME_ROOT: runtimeRoot,
    SANDFEST_DATABASE_URL: "",
    SANDFEST_API_PORT: String(port),
    SANDFEST_ENV: "development",
    SANDFEST_EVENT_ID: DEFAULT_EVENT_ID,
    SANDFEST_ADMIN_API_TOKEN: TOKEN,
    SANDFEST_ADMIN_ROLE: "super_admin",
    SANDFEST_ADMIN_ACTOR_ID: "board-runtime-test",
    SANDFEST_ADMIN_RATE_LIMIT: "500",
    SANDFEST_BOARD_CONDITIONS_MODE: "synthetic",
    SANDFEST_PARTNER_PORTAL_SECRET: "board-runtime-partner-portal-secret-0123456789",
    SANDFEST_OUTREACH_PREFERENCES_SECRET: "board-runtime-outreach-preferences-secret-0123456789",
    OUTREACH_DISCOVERY_ENABLED: "true",
    OUTREACH_DISCOVERY_PROVIDER: "fixture",
    SANDFEST_BOARD_TICKET_SANDBOX: "true",
    SANDFEST_BOARD_TICKET_SECRET: BOARD_TICKET_SECRET,
    SANDFEST_PUBLIC_SITE_URL: "https://www.texassandfest.org",
    SANDFEST_API_PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    SANDFEST_INCOMING_DOCUMENT_DIR: path.join(runtimeRoot, "private", "incoming-documents"),
    SANDFEST_TURNSTILE_ENABLED: "false",
    CAMERA_INGEST_ENABLED: "true",
    CAMERA_INGEST_SECRET: CAMERA_SECRET,
    TRANSACTIONAL_EMAIL_ENABLED: "true",
    BREVO_API_KEY: EMAIL_API_KEY,
    BREVO_SENDER_EMAIL: "sandbox@texassandfest.example",
    BREVO_SENDER_NAME: "Texas SandFest Board Runtime Test",
    BREVO_REPLY_TO_EMAIL: "reply@texassandfest.example",
    BREVO_WEBHOOK_TOKEN: EMAIL_WEBHOOK_TOKEN,
    BREVO_API_ENDPOINT: `http://127.0.0.1:${emailPort}/v3/smtp/email`,
    QB_INVOICE_SYNC_ENABLED: "false",
    SMS_ENABLED: "true",
    TWILIO_ACCOUNT_SID: SMS_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: SMS_AUTH_TOKEN,
    TWILIO_FROM_NUMBER: SMS_FROM_NUMBER,
    TWILIO_API_BASE_URL: `http://127.0.0.1:${smsPort}`,
    TWILIO_STATUS_CALLBACK_URL: `http://127.0.0.1:${port}/api/webhooks/twilio/status`,
    TWILIO_SAFETY_INBOUND_WEBHOOK_URL: `http://127.0.0.1:${port}/api/webhooks/twilio/inbound/smsSafety`
  };
  const api = spawn(process.execPath, ["scripts/admin-api-server.mjs"], {
    cwd: ROOT,
    env: processEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Board runtime API timed out:\n${output}`)), 10_000);
    const onData = chunk => {
      output += String(chunk);
      if (output.includes("listening")) {
        clearTimeout(timeout);
        resolve();
      }
    };
    api.stdout.on("data", onData);
    api.stderr.on("data", onData);
    api.once("error", reject);
    api.once("exit", code => reject(new Error(`Board runtime API exited ${code}:\n${output}`)));
  });
  api.processEnv = processEnv;
  return api;
}

async function stopChild(processChild) {
  if (!processChild || processChild.exitCode != null) return;
  const exited = new Promise(resolve => processChild.once("exit", resolve));
  processChild.kill("SIGTERM");
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5_000))]);
  if (processChild.exitCode == null) processChild.kill("SIGKILL");
}

async function productionRejectsSyntheticConditions(runtimeRoot) {
  const probe = spawn(process.execPath, ["scripts/admin-api-server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      SANDFEST_RUNTIME_ROOT: runtimeRoot,
      SANDFEST_DATABASE_URL: "",
      SANDFEST_ENV: "production",
      SANDFEST_EVENT_ID: DEFAULT_EVENT_ID,
      SANDFEST_BOARD_CONDITIONS_MODE: "synthetic"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  probe.stdout.on("data", chunk => { output += String(chunk); });
  probe.stderr.on("data", chunk => { output += String(chunk); });
  const code = await Promise.race([
    new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.once("exit", resolve);
    }),
    new Promise(resolve => setTimeout(() => resolve(null), 5_000))
  ]);
  if (code == null) await stopChild(probe);
  return code !== 0 && output.includes("Synthetic board conditions are restricted to an isolated board demo runtime.");
}

async function runWorker(env) {
  const worker = spawn(process.execPath, ["scripts/worker.mjs"], {
    cwd: ROOT,
    env: { ...env, SANDFEST_WORKER_ONCE: "true" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  worker.stdout.on("data", chunk => { output += String(chunk); });
  worker.stderr.on("data", chunk => { output += String(chunk); });
  const code = await new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`Board runtime worker exited ${code}:\n${output}`);
  return output;
}

async function request(base, method, pathname, body, { auth = false, idempotencyKey = null } = {}) {
  const headers = {};
  if (auth) headers.authorization = `Bearer ${TOKEN}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

async function requestRaw(base, pathname, { auth = false } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    headers: auth ? { authorization: `Bearer ${TOKEN}` } : {}
  });
  return {
    status: response.status,
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "",
    disposition: response.headers.get("content-disposition") || ""
  };
}

async function waitFor(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return null;
}

try {
  console.log("\n=== Isolated 2027 board runtime ===\n");
  temporary = await mkdtemp(path.join(tmpdir(), "sandfest-board-runtime-test-"));
  const targetRoot = path.join(temporary, "runtime");
  const sourcePartnerPath = platformDocumentFilePath(ROOT, "partnerOps");
  const sourceDigestBefore = await digest(sourcePartnerPath);
  const prepared = await prepareBoardRuntime({
    sourceRoot: ROOT,
    targetRoot,
    eventId: DEFAULT_EVENT_ID,
    now: new Date().toISOString()
  });
  const resolved = resolveRuntimeRoot(ROOT, { SANDFEST_RUNTIME_ROOT: targetRoot });
  const runtimeMarker = JSON.parse(await readFile(path.join(targetRoot, "board-runtime.json"), "utf8"));
  check("runtime root resolves outside repository data", resolved === targetRoot && resolved !== ROOT);
  check("board runtime records its compatibility contract", runtimeMarker.kind === "synthetic-board-demonstration"
    && runtimeMarker.schemaVersion === BOARD_RUNTIME_SCHEMA_VERSION
    && runtimeMarker.runtimeLabel === BOARD_RUNTIME_LABEL);
  const ownershipRoot = path.join(temporary, "ownership-contract");
  const ownershipMarkerPath = path.join(ownershipRoot, "board-runtime.json");
  const firstOwnerId = "board-runtime-owner-0001";
  const secondOwnerId = "board-runtime-owner-0002";
  await mkdir(ownershipRoot, { recursive: true });
  await writeFile(ownershipMarkerPath, `${JSON.stringify({ kind: "synthetic-board-demonstration", runtimeOwnerId: firstOwnerId })}\n`, "utf8");
  let releaseOwnedOperation;
  let ownedOperationStarted;
  const ownedOperationGate = new Promise(resolve => { releaseOwnedOperation = resolve; });
  const ownedOperationReady = new Promise(resolve => { ownedOperationStarted = resolve; });
  let nestedOwnedOperationCompleted = false;
  const ownedOperation = withRuntimeOwnership(ownershipRoot, async () => {
    await withRuntimeOwnership(ownershipRoot, async () => {
      nestedOwnedOperationCompleted = true;
    }, { SANDFEST_RUNTIME_ROOT: ownershipRoot, SANDFEST_RUNTIME_OWNER_ID: firstOwnerId });
    ownedOperationStarted();
    await ownedOperationGate;
  }, { SANDFEST_RUNTIME_ROOT: ownershipRoot, SANDFEST_RUNTIME_OWNER_ID: firstOwnerId });
  await ownedOperationReady;
  let ownershipClaimCompleted = false;
  const ownershipClaim = claimBoardRuntimeOwnership(ownershipRoot, secondOwnerId).then(() => { ownershipClaimCompleted = true; });
  await new Promise(resolve => setTimeout(resolve, 50));
  check("runtime ownership claim waits for an in-flight owner", nestedOwnedOperationCompleted && ownershipClaimCompleted === false);
  releaseOwnedOperation();
  await Promise.all([ownedOperation, ownershipClaim]);
  let staleOwnerRejected = false;
  try {
    await assertRuntimeOwnership(ownershipRoot, { SANDFEST_RUNTIME_ROOT: ownershipRoot, SANDFEST_RUNTIME_OWNER_ID: firstOwnerId });
  } catch (error) {
    staleOwnerRejected = error?.code === RUNTIME_OWNERSHIP_ERROR_CODE;
  }
  const currentOwner = await assertRuntimeOwnership(ownershipRoot, { SANDFEST_RUNTIME_ROOT: ownershipRoot, SANDFEST_RUNTIME_OWNER_ID: secondOwnerId });
  check("runtime ownership rejects a stale process after handoff", staleOwnerRejected && currentOwner.required === true);
  check("board seed covers core operations", prepared.applications === 4 && prepared.invoices === 1 && prepared.payments === 1
    && prepared.budgetLines === 6 && prepared.expenses === 7 && prepared.tasks === 10 && prepared.prospects === 2 && prepared.safetySmsRecipients === 1);
  check("board seed covers field operations", prepared.cameras === 8 && prepared.volunteerShifts === 12 && prepared.documents === 4);
  check("production refuses synthetic board conditions", await productionRejectsSyntheticConditions(targetRoot));

  const port = await freePort();
  const emailPort = await freePort();
  const smsPort = await freePort();
  const base = `http://127.0.0.1:${port}`;
  child = await startApi(port, targetRoot, emailPort, smsPort);
  emailSandbox = await startBoardEmailSandbox({
    config: boardEmailSandboxConfig({
      SANDFEST_BOARD_EMAIL_SANDBOX: "true",
      SANDFEST_BOARD_EMAIL_PORT: String(emailPort),
      BOARD_BREVO_API_KEY: EMAIL_API_KEY,
      BREVO_WEBHOOK_TOKEN: EMAIL_WEBHOOK_TOKEN,
      SANDFEST_BOARD_EMAIL_WEBHOOK_URL: `${base}/api/webhooks/brevo`
    })
  });
  smsSandbox = await startBoardSmsSandbox({
    config: boardSmsSandboxConfig({
      SANDFEST_BOARD_SMS_SANDBOX: "true",
      SANDFEST_BOARD_SMS_PORT: String(smsPort),
      SANDFEST_BOARD_SMS_DELIVERY_DELAY_MS: "10",
      BOARD_TWILIO_ACCOUNT_SID: SMS_ACCOUNT_SID,
      BOARD_TWILIO_AUTH_TOKEN: SMS_AUTH_TOKEN,
      BOARD_TWILIO_FROM_NUMBER: SMS_FROM_NUMBER,
      SANDFEST_BOARD_SMS_INBOUND_WEBHOOK_URL: `${base}/api/webhooks/twilio/inbound/smsSafety`
    })
  });
  const health = await request(base, "GET", "/health");
  const deployment = await request(base, "GET", "/api/admin/deployment", undefined, { auth: true });
  check("isolated runtime is current-event ready", health.status === 200 && health.data.currentEventReady === true && health.data.currentEventId === DEFAULT_EVENT_ID);
  check("health identifies isolated runtime data", health.data.runtimeDataMode === "isolated" && health.data.cameraIngestReady === true && health.data.safetySmsReady === true && health.data.ticketCheckoutEnvironment === "board_sandbox" && health.data.partnerPaymentCheckoutEnvironment === "board_sandbox");
  check("health exposes the generated capability-link origin", health.data.publicSiteUrl === child.processEnv.SANDFEST_PUBLIC_SITE_URL);
  const bootstrap = await request(base, "GET", "/api/public/bootstrap");
  const publicPassport = await request(base, "GET", "/api/public/passport");
  const publicVoting = await request(base, "GET", "/api/public/voting");
  const publicVendorCatalog = await request(base, "GET", "/api/public/vendors");
  const publicSponsorCatalog = await request(base, "GET", "/api/public/sponsors");
  const publicTicketCatalog = await request(base, "GET", "/api/public/tickets");
  check("board runtime is visibly labeled as synthetic", bootstrap.status === 200 && bootstrap.data.runtime?.mode === "board_demo" && bootstrap.data.runtime?.label?.includes("No external messages, charges, or live-provider calls"));
  check("board deployment keeps live providers explicitly post-board", deployment.status === 200
    && deployment.data.deployment?.checks?.sms?.message.includes("Local loopback SMS sandbox")
    && deployment.data.deployment?.checks?.sms?.message.includes("Twilio activation remains post-board")
    && deployment.data.deployment?.checks?.transactionalEmail?.message.includes("Local loopback email sandbox")
    && deployment.data.deployment?.checks?.transactionalEmail?.message.includes("Brevo activation remains post-board")
    && deployment.data.deployment?.checks?.cameraIngest?.message.includes("synthetic metric playback")
    && deployment.data.deployment?.checks?.cameraIngest?.message.includes("webcam edge agents remain post-board"));
  check("board bootstrap preserves the public privacy boundary", publicAppBootstrapSafety(bootstrap.data, { allowBoardRuntime: true }).ready
    && bootstrap.data.schedule?.every(item => item.category !== "Staff")
    && bootstrap.data.zones?.every(item => !Object.hasOwn(item, "status"))
    && !/(sponsors|vendors|coverage|financeSignals|ticketOptions)/.test(JSON.stringify(bootstrap.data)));
  check("board runtime derives a complete synthetic sculpture passport", publicPassport.status === 200 && publicPassport.data.hunt?.active === true && publicPassport.data.checkpoints?.length === 6 && publicPassport.data.checkpoints?.every(item => item.entryId));
  check("board runtime publishes its synthetic ballot only in demo mode", publicVoting.status === 200 && publicVoting.data.votingOpen === true && publicVoting.data.entries?.length === 6 && publicVoting.data.leaderboard?.length === 6);
  check("board runtime publishes synthetic application offerings", publicVendorCatalog.status === 200 && publicVendorCatalog.data.vendorOfferings?.length === 3 && publicVendorCatalog.data.vendorOfferings?.every(item => item.intakeMode === "application" && item.description.includes("Synthetic board-demo")) && publicVendorCatalog.data.vendorOfferings?.some(item => item.id === "marketplace-booth" && item.amount === 125000));
  check("board runtime publishes the current sponsor program", publicSponsorCatalog.status === 200 && publicSponsorCatalog.data.sponsorPackages?.length === 11 && publicSponsorCatalog.data.sponsorPackages?.find(item => item.id === "marlin")?.amount === 1500000 && publicSponsorCatalog.data.sponsorPackages?.find(item => item.id === "whale")?.amount === 5000000 && publicSponsorCatalog.data.sponsorPackages?.find(item => item.id === "the-kraken")?.amount === 25000000);
  check("board runtime publishes provider-private policy-gated local ticket checkout", publicTicketCatalog.status === 200 && publicTicketCatalog.data.checkoutEnvironment === "board_sandbox" && publicTicketCatalog.data.checkoutPolicy?.ready === true && publicTicketCatalog.data.checkoutPolicy?.demonstration === true && publicTicketCatalog.data.checkoutPolicy?.version === "board-demo-2027-v1" && publicTicketCatalog.data.checkoutPolicy?.notices?.length === 4 && publicTicketCatalog.data.products?.filter(item => item.availableForCheckout).length === 4 && publicTicketCatalog.data.products?.find(item => item.id === "general-admission-3-day")?.unitAmount === 3000 && !JSON.stringify(publicTicketCatalog.data).includes("stripePriceId"));
  const publicBoardSponsor = publicSponsorCatalog.data.sponsors?.find(item => item.displayName === "Gulf Shore Credit Union");
  const publicBoardSponsorJson = JSON.stringify(publicBoardSponsor || {});
  const publicBoardSponsorLogo = await requestRaw(base, publicBoardSponsor?.logo?.path || "/api/public/sponsor-showcase/assets/missing");
  const sourceBoardSponsorLogo = await readFile(path.join(ROOT, "docs", "board-demo-assets", "gulf-shore-credit-union-emblem.png"));
  check("board runtime publishes only approved sponsor branding", publicSponsorCatalog.status === 200 && publicBoardSponsor?.packageName === "Marlin" && publicBoardSponsor?.tagline === "Rooted on the Texas coast" && publicBoardSponsor?.primaryColor === "#006B63" && publicBoardSponsor?.secondaryColor === "#F4B942" && publicBoardSponsor?.logo?.path === "/api/public/sponsor-showcase/assets/demo_brand_asset_gulf_shore_primary" && publicBoardSponsor?.logo?.contentType === "image/png");
  check("board sponsor logo preserves its approved private source bytes", publicBoardSponsorLogo.status === 200 && publicBoardSponsorLogo.contentType.startsWith("image/png") && publicBoardSponsorLogo.disposition.includes("inline") && publicBoardSponsorLogo.body.equals(sourceBoardSponsorLogo));
  check("public sponsor branding excludes private workflow data", !/(applicationId|contactEmail|contactName|storageKey|reviewedBy|reviewNotes|sourceUrl)/.test(publicBoardSponsorJson));

  const boardDocuments = await request(base, "GET", "/api/admin/documents", undefined, { auth: true });
  const boardLoadInDocument = boardDocuments.data.documents?.find(item => item.title === "Vendor load-in matrix");
  const boardBriefing = boardDocuments.data.documents?.find(item => item.title === "SandFest board platform briefing");
  const boardDocumentDownload = await requestRaw(base, `/api/admin/documents/${encodeURIComponent(boardLoadInDocument?.id || "missing")}/content`, { auth: true });
  const boardBriefingDownload = await requestRaw(base, `/api/admin/documents/${encodeURIComponent(boardBriefing?.id || "missing")}/content`, { auth: true });
  const sourceBoardBriefing = await readFile(path.join(ROOT, "docs", "presentations", "SandFest-Board-Platform-Briefing.pptx"));
  check("board document intake shows governed private source files", boardDocuments.status === 200 && boardDocuments.data.summary?.total === 4 && boardDocuments.data.summary?.byStatus?.approved === 1 && boardDocuments.data.summary?.byStatus?.in_review === 1 && boardLoadInDocument?.textPreview.includes("Coastal Bites") && !("storageKey" in (boardLoadInDocument || {})));
  check("board briefing survives clean preparation as extracted private content", boardDocuments.data.summary?.extractionReady === 4 && boardDocuments.data.summary?.extractionQueued === 0 && boardDocuments.data.summary?.extractionNeedsReview === 0 && boardBriefing?.extractionStatus === "ready" && boardBriefing?.extractedCharacterCount > 5_000 && boardBriefing?.extractedChunkCount > 0 && boardBriefing?.textPreview.includes("TEXAS SANDFEST") && !("storageKey" in (boardBriefing || {})) && !("extractionChunks" in (boardBriefing || {})));
  check("board document intake is routed into delegated work", boardLoadInDocument?.reviewTask?.status === "in_progress" && boardLoadInDocument?.reviewTask?.assigneeId === "operations" && boardLoadInDocument?.reviewTask?.dueAt === boardLoadInDocument?.reviewDueAt && boardDocuments.data.documents?.find(item => item.title === "Sponsor benefit approvals")?.reviewTask?.assigneeId === "finance");
  check("board document intake downloads checksum-verified bytes", boardDocumentDownload.status === 200 && boardDocumentDownload.contentType.startsWith("text/csv") && boardDocumentDownload.disposition.includes("vendor-load-in-matrix.csv") && boardDocumentDownload.body.toString("utf8").includes("South"));
  check("board briefing download preserves the governed source bytes", boardBriefingDownload.status === 200 && boardBriefingDownload.contentType.includes("presentationml.presentation") && boardBriefingDownload.disposition.includes("SandFest-Board-Platform-Briefing.pptx") && boardBriefingDownload.body.equals(sourceBoardBriefing));

  const boardConsent = await request(base, "GET", "/api/admin/consent", undefined, { auth: true });
  const boardSmsBefore = await request(base, "GET", "/api/admin/sms", undefined, { auth: true });
  check("board SMS sandbox exposes one synthetic consent without contact data", boardConsent.status === 200 && boardConsent.data.sms?.ready === true && boardConsent.data.sms?.providerMode === "sandbox" && boardSmsBefore.data.eligibleSafetyRecipients === 1 && !JSON.stringify(boardSmsBefore.data).includes(SMS_RECIPIENT));
  const boardAlert = await request(base, "PATCH", "/api/admin/alert", {
    active: true,
    severity: "warning",
    title: "South gate weather hold",
    message: "Use the north entrance while staff clear the south gate.",
    audience: ["public"],
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    sendSms: true
  }, { auth: true });
  const smsWorkerOutput = await runWorker(child.processEnv);
  let deliveredSms = null;
  let smsSandboxHealth = null;
  const smsLifecycleComplete = await waitFor(async () => {
    deliveredSms = await request(base, "GET", "/api/admin/sms", undefined, { auth: true });
    smsSandboxHealth = await fetch(`${smsSandbox.url}/health`).then(response => response.json());
    return deliveredSms.data.campaigns?.[0]?.counts?.delivered === 1
      && smsSandboxHealth.acceptedMessages === 1
      && smsSandboxHealth.deliveryCallbacks === 1
      && smsSandboxHealth.callbackFailures === 0;
  }, 15_000);
  const smsLifecycleReady = boardAlert.status === 200
    && boardAlert.data.sms?.queued === 1
    && smsWorkerOutput.includes("sms.alert.send")
    && smsLifecycleComplete === true;
  const smsLifecycleDetail = smsLifecycleReady ? "" : [
    `alert=${boardAlert.status}`,
    `queued=${boardAlert.data.sms?.queued ?? "missing"}`,
    `worker=${smsWorkerOutput.includes("sms.alert.send") ? "sent" : "missing"}`,
    `delivered=${deliveredSms?.data.campaigns?.[0]?.counts?.delivered ?? "missing"}`,
    `accepted=${smsSandboxHealth?.acceptedMessages ?? "missing"}`,
    `callbacks=${smsSandboxHealth?.deliveryCallbacks ?? "missing"}`,
    `callbackFailures=${smsSandboxHealth?.callbackFailures ?? "missing"}`,
    `lastError=${smsSandboxHealth?.lastError || "none"}`
  ].join(" ");
  check("board safety alert delivers through the signed local SMS lifecycle", smsLifecycleReady, smsLifecycleDetail);

  const unauthenticatedSmsPreference = await request(base, "POST", "/api/admin/board-demo/sms-preference", { action: "STOP" });
  const simulateSmsPreference = action => request(base, "POST", "/api/admin/board-demo/sms-preference", { action }, { auth: true });
  const stopSms = await simulateSmsPreference("STOP");
  const afterStopSms = await request(base, "GET", "/api/admin/sms", undefined, { auth: true });
  const startSms = await simulateSmsPreference("START");
  const afterStartSms = await request(base, "GET", "/api/admin/sms", undefined, { auth: true });
  const secondStopSms = await simulateSmsPreference("STOP");
  const secondStartSms = await simulateSmsPreference("START");
  const afterSecondCycleSms = await request(base, "GET", "/api/admin/sms", undefined, { auth: true });
  const smsPreferenceAudit = await request(base, "GET", "/api/admin/audit?limit=100", undefined, { auth: true });
  const preferenceHealth = await fetch(`${smsSandbox.url}/health`).then(response => response.json());
  check("board SMS preference controls require an authenticated operator", unauthenticatedSmsPreference.status === 401);
  check("board SMS STOP and START traverse repeatable signed consent callbacks", stopSms.status === 200
    && stopSms.data.boardDemoPreference?.state === "opted_out"
    && afterStopSms.data.eligibleSafetyRecipients === 0
    && afterStopSms.data.summary?.preferences?.STOP === 1
    && startSms.status === 200
    && startSms.data.boardDemoPreference?.state === "opted_in"
    && afterStartSms.data.eligibleSafetyRecipients === 1
    && afterStartSms.data.summary?.preferences?.START === 1
    && secondStopSms.status === 200
    && secondStartSms.status === 200
    && afterSecondCycleSms.data.eligibleSafetyRecipients === 1
    && afterSecondCycleSms.data.summary?.preferences?.STOP === 2
    && afterSecondCycleSms.data.summary?.preferences?.START === 2
    && afterSecondCycleSms.data.boardDemoPreference?.signedCallbacks === 4
    && preferenceHealth.preferenceCallbacks === 4
    && !JSON.stringify([stopSms.data, startSms.data, secondStopSms.data, secondStartSms.data]).includes(SMS_RECIPIENT));
  const preferenceAuditRecords = (smsPreferenceAudit.data.audit || []).filter(item => [
    "sms.preference.webhook",
    "board_demo.sms_preference.simulate"
  ].includes(item.record?.action));
  check("board SMS preference audit remains aggregate-only", preferenceAuditRecords.filter(item => item.record?.action === "sms.preference.webhook").length === 4
    && preferenceAuditRecords.filter(item => item.record?.action === "board_demo.sms_preference.simulate").length === 4
    && preferenceAuditRecords.every(item => item.record?.metadata?.action && !JSON.stringify(item).includes(SMS_RECIPIENT)));
  await request(base, "PATCH", "/api/admin/alert", {
    active: false,
    severity: "clear",
    title: "",
    message: "",
    audience: ["public"],
    expiresAt: null
  }, { auth: true });

  const seeded = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const outreach = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  const revenue = await request(base, "GET", "/api/admin/revenue", undefined, { auth: true });
  const budget = await request(base, "GET", "/api/admin/budget", undefined, { auth: true });
  const seededMarlin = seeded.data.applications?.find(item => item.organizationName === "Gulf Shore Credit Union");
  const seededSailfish = seeded.data.applications?.find(item => item.organizationName === "Port Aransas Marine Supply");
  const seededCreativeMilestone = seeded.data.milestones?.find(item => item.label === "Sponsor homepage creative approval");
  const seededCreativeReminder = seeded.data.followups?.find(item => item.milestoneId === seededCreativeMilestone?.id && item.kind === "milestone_reminder");
  check("seeded sponsor and vendor finance is visible", seeded.status === 200 && seeded.data.applications?.length === 4 && seeded.data.summary?.applications?.vendors === 2 && seeded.data.summary?.applications?.sponsors === 2 && seeded.data.applications?.some(item => item.type === "vendor" && item.offeringId === "food-beverage-booth" && item.expectedAmountCents === 175000) && seededMarlin?.packageId === "marlin" && seededMarlin?.expectedAmountCents === 1500000 && seededSailfish?.packageId === "sailfish" && seededSailfish?.expectedAmountCents === 1000000 && seeded.data.invoices?.length === 1 && seeded.data.payments?.length === 1 && seeded.data.receivables?.totals?.collectedCents === 1000000);
  check("seeded sponsor brand kit contains two approved private assets", seeded.data.brandAssets?.filter(item => item.label?.startsWith("Gulf Shore Credit Union") && item.status === "approved").length === 2);
  check("seeded sponsor creative date enters the automatic follow-up window", seededCreativeMilestone?.source === "custom" && seededCreativeMilestone?.assigneeTeam === "sponsor" && seededCreativeMilestone?.reminderLeadDays === 3 && seeded.data.summary?.operations?.dueSoonMilestones === 1 && seededCreativeReminder?.status === "draft_ready" && seededCreativeReminder?.reminderPhase === "upcoming");
  check("revenue is current-event and includes site-native finance", revenue.status === 200 && revenue.data.eventId === DEFAULT_EVENT_ID && revenue.data.sources?.imported?.entries === 3 && revenue.data.sources?.partnerOperations?.entries === 1 && revenue.data.summary?.totals?.grossCents === 1750000 && revenue.data.summary?.tickets?.sold === 100 && revenue.data.entries?.every(item => item.eventId === DEFAULT_EVENT_ID) && revenue.data.imports?.length === 3 && revenue.data.imports?.every(item => item.fileName?.endsWith("-demo.csv")));
  check("board budget is current, synthetic, and operationally reconciled", budget.status === 200 && budget.data.eventId === DEFAULT_EVENT_ID
    && budget.data.summary?.counts?.budgetLines === 6 && budget.data.summary?.counts?.expenses === 7
    && budget.data.summary?.counts?.pendingApprovals === 2 && budget.data.summary?.counts?.byStatus?.approved === 2
    && budget.data.summary?.counts?.byStatus?.paid === 2 && budget.data.summary?.counts?.byStatus?.rejected === 1
    && budget.data.summary?.totals?.budgetCents === 53_000_000 && budget.data.summary?.totals?.committedCents === 18_640_000
    && budget.data.summary?.totals?.submittedCents === 9_200_000 && budget.data.expenses?.every(item => item.eventId === DEFAULT_EVENT_ID));
  check("seeded work and outreach are visible", seeded.data.tasks?.length === 10 && seeded.data.followups?.length >= 4 && outreach.status === 200 && outreach.data.prospects?.length === 2 && outreach.data.campaigns?.length === 2);
  const seededAssignmentTypes = new Set(seeded.data.tasks?.filter(item => item.assigneeId).map(item => item.assigneeType));
  check("board work demonstrates direct staff, volunteer, and team delegation", seededAssignmentTypes.has("staff") && seededAssignmentTypes.has("volunteer") && seededAssignmentTypes.has("team") && seeded.data.tasks?.some(item => item.assigneeType === "staff" && item.assigneeId === "staff_operations" && item.assigneeName === "Jamie Torres") && seeded.data.taskBoard?.totals?.unassigned === 0);
  const readyVendor = seeded.data.vendorReadiness?.vendors?.find(item => item.organizationName === "Coastal Bites");
  const blockedVendor = seeded.data.vendorReadiness?.vendors?.find(item => item.organizationName === "Island Art Market");
  check("board vendor onboarding shows completed and intervention paths", seeded.data.vendorReadiness?.totals?.ready === 1 && seeded.data.vendorReadiness?.totals?.blocked === 1 && readyVendor?.profileStatus === "approved" && readyVendor?.compliance?.approved === readyVendor?.compliance?.required && readyVendor?.assignmentStatus === "confirmed" && readyVendor?.boothNumber === "F-14" && blockedVendor?.status === "blocked");
  check("board staff routing is current and private", seeded.data.staffDirectory?.ready === true && seeded.data.staffDirectory?.activeStaff === 7 && seeded.data.staffDirectory?.routedTeams === 7 && seeded.data.assignmentDirectory?.teams?.every(item => item.notificationReady === true) && seeded.data.assignmentDirectory?.staff?.every(item => !("email" in item)));
  const seededSponsorProspect = outreach.data.prospects?.find(item => item.organizationName === "Island Harbor Hotel");
  const seededReviewProspect = outreach.data.prospects?.find(item => item.organizationName === "Coastal Bend Community Bank");
  const seededOutreachCampaign = outreach.data.campaigns?.find(item => item.deliveryMode === "approved_sequence");
  const seededReviewCampaign = outreach.data.campaigns?.find(item => item.deliveryMode === "review_first");
  check("seeded outreach has accountable follow-up", seededSponsorProspect?.ownerId === "sponsor" && seededSponsorProspect?.nextActionAt && seededReviewProspect?.ownerId === "sponsor" && seededReviewProspect?.nextActionAt && outreach.data.summary?.nextActionsScheduled === 2 && outreach.data.summary?.unassigned === 0);
  check("seeded outreach exposes automated and review-first control", seededOutreachCampaign?.dailySendLimit === 5 && seededOutreachCampaign?.automation?.enabled === true && seededOutreachCampaign?.automation?.active === false && seededReviewCampaign?.status === "active" && seededReviewCampaign?.automation?.enabled === false && seededReviewCampaign?.automation?.blockedReason?.includes("individual review"));
  const boardSponsorInvitation = await request(base, "POST", `/api/admin/outreach/prospects/${seededSponsorProspect?.id}/sponsor-invitation`, {
    action: "issue",
    packageId: "tarpon"
  }, { auth: true });
  const boardSponsorInvitationHash = boardSponsorInvitation.data.invitation?.url ? new URL(boardSponsorInvitation.data.invitation.url).hash : "";
  const boardSponsorInvitationToken = new URLSearchParams(boardSponsorInvitationHash.slice(boardSponsorInvitationHash.indexOf("?") + 1)).get("token");
  const boardCampaignActivation = await request(base, "POST", `/api/admin/outreach/campaigns/${seededOutreachCampaign?.id}/activate`, {}, { auth: true });
  const outreachWorkerOutput = await runWorker(child.processEnv);
  const deliveredOutreach = await waitFor(async () => {
    const workspace = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
    const message = workspace.data.followups?.find(item => item.campaignId === seededOutreachCampaign?.id);
    return message?.status === "sent" && message?.deliveryStatus === "delivered" ? { workspace, message } : null;
  });
  check("board-approved outreach sequence delivers through the local sandbox", boardCampaignActivation.status === 200 && boardCampaignActivation.data.automation?.active === true && outreachWorkerOutput.includes("outreach_campaign_v1") && deliveredOutreach?.message?.automationPolicy === "outreach_campaign_v1" && deliveredOutreach?.message?.body?.includes(boardSponsorInvitation.data.invitation?.url));
  const reviewFirstDraft = deliveredOutreach?.workspace?.data.followups?.find(item => item.campaignId === seededReviewCampaign?.id);
  check("review-first outreach stays in the staff approval queue", reviewFirstDraft?.status === "draft_ready" && !reviewFirstDraft?.automationPolicy && reviewFirstDraft?.subject?.includes("Coastal Bend Community Bank"));
  const boardPublicInvitation = await request(base, "POST", "/api/public/sponsor-invitation", { token: boardSponsorInvitationToken });
  const boardInvitedSponsor = await request(base, "POST", "/api/public/sponsor-inquiries", {
    organizationName: seededSponsorProspect?.organizationName,
    contactName: seededSponsorProspect?.contactName,
    contactEmail: seededSponsorProspect?.contactEmail,
    website: seededSponsorProspect?.website,
    packageId: "tarpon",
    description: "Board-safe invited sponsor application.",
    consentToContact: true,
    sponsorInvitationToken: boardSponsorInvitationToken
  }, { idempotencyKey: "board-runtime-invited-sponsor-0001" });
  const boardInvitationRecovery = await request(base, "POST", "/api/public/sponsor-invitation", { token: boardSponsorInvitationToken });
  const boardInvitedPartners = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const boardInvitedOutreach = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  const boardConvertedProspect = boardInvitedOutreach.data.prospects?.find(item => item.id === seededSponsorProspect?.id);
  const boardConvertedApplication = boardInvitedPartners.data.applications?.find(item => item.id === boardInvitedSponsor.data.application?.id);
  check("board sponsor invitation opens a consent-preserving application", boardSponsorInvitation.status === 200 && boardPublicInvitation.data.invitation?.organizationName === seededSponsorProspect?.organizationName && boardInvitedSponsor.status === 201 && boardInvitedSponsor.data.outreachConversion === true);
  check("board invited sponsor seeds the operational lifecycle", boardConvertedProspect?.status === "won" && boardConvertedProspect?.convertedApplicationId === boardConvertedApplication?.id && boardConvertedApplication?.outreachProspectId === seededSponsorProspect?.id && boardInvitedPartners.data.brandProfiles?.some(item => item.applicationId === boardConvertedApplication?.id) && boardInvitedPartners.data.deliverables?.some(item => item.applicationId === boardConvertedApplication?.id) && boardInvitedPartners.data.milestones?.filter(item => item.applicationId === boardConvertedApplication?.id).length === 4 && boardInvitedPartners.data.milestones?.some(item => item.applicationId === boardConvertedApplication?.id && item.kind === "payment_due" && item.assigneeTeam === "finance") && boardInvitedPartners.data.tasks?.some(item => item.relatedEntityId === boardConvertedApplication?.id));
  check("board converted invitation recovers the private portal", boardInvitationRecovery.status === 200 && boardInvitationRecovery.data.converted === true && boardInvitationRecovery.data.portalAccess?.reference === boardConvertedApplication?.reference);
  const discoveryPreview = await request(base, "POST", "/api/admin/outreach/discovery/preview", {
    location: "Port Aransas, TX 78373",
    radiusMiles: 25,
    limit: 10,
    categories: ["lodging", "financial"]
  }, { auth: true });
  const discoveryCandidate = discoveryPreview.data.candidates?.[0];
  const discoveryImport = await request(base, "POST", "/api/admin/outreach/discovery/import", {
    previewToken: discoveryPreview.data.previewToken,
    selectedSourceRefs: [discoveryCandidate?.sourceRef]
  }, { auth: true });
  const discoveredOutreach = await request(base, "GET", "/api/admin/outreach", undefined, { auth: true });
  const discoveredProspect = discoveredOutreach.data.prospects?.find(item => item.id === discoveryImport.data.prospects?.[0]?.id);
  check("board business discovery is explicitly synthetic", outreach.data.discovery?.ready === true && outreach.data.discovery?.provider === "fixture" && outreach.data.discovery?.attribution?.includes("Synthetic") && discoveryPreview.data.discovery?.provider === "fixture");
  check("board business discovery stays research-first", discoveryImport.status === 201 && discoveryImport.data.summary?.imported === 1 && discoveredProspect?.status === "identified" && discoveredProspect?.contactBasis === null && discoveredProspect?.source === "board_demo_discovery");
  const [receivablesExport, tasksExport, outreachExport, calendarExport] = await Promise.all([
    requestRaw(base, "/api/admin/exports/receivables.csv", { auth: true }),
    requestRaw(base, "/api/admin/exports/tasks.csv", { auth: true }),
    requestRaw(base, "/api/admin/exports/outreach.csv", { auth: true }),
    requestRaw(base, "/api/admin/exports/milestones.ics", { auth: true })
  ]);
  check("board operations export to finance, staffing, outreach, and calendars", receivablesExport.status === 200 && receivablesExport.body.toString("utf8").includes("Gulf Shore Credit Union") && tasksExport.body.toString("utf8").includes("Task ID") && outreachExport.body.toString("utf8").includes("Contact basis") && calendarExport.contentType.startsWith("text/calendar") && calendarExport.body.toString("utf8").includes("BEGIN:VEVENT"));

  const vendor = await request(base, "POST", "/api/public/vendor-applications", {
    organizationName: "Boardwalk Arts Collective",
    contactName: "Casey Nguyen",
    contactEmail: "casey.nguyen@example.com",
    category: "artisan",
    vendorOfferingId: "marketplace-booth",
    consentToContact: true
  }, { idempotencyKey: "board-runtime-vendor-0001" });
  const sponsor = await request(base, "POST", "/api/public/sponsor-inquiries", {
    organizationName: "Coastal Community Health",
    contactName: "Riley Patel",
    contactEmail: "riley.patel@example.com",
    packageId: "tarpon",
    consentToContact: true
  }, { idempotencyKey: "board-runtime-sponsor-0001" });
  const signedUpPartners = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const signedUpVendor = signedUpPartners.data.applications?.find(item => item.id === vendor.data.application?.id);
  check("public vendor and sponsor signup work", vendor.status === 201 && sponsor.status === 201 && vendor.data.acknowledgment === "draft_queued" && sponsor.data.acknowledgment === "draft_queued" && vendor.data.application?.intakeMode === "application" && signedUpVendor?.offeringId === "marketplace-booth" && signedUpVendor?.expectedAmountCents === 125000 && signedUpVendor?.consentNoticeVersion === partnerContactNotice("vendor", "application").version && signedUpVendor?.consentCapturedAt);

  const workerOutput = await runWorker(child.processEnv);
  const afterWorker = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const activeAssignedTaskIds = new Set((afterWorker.data.tasks || [])
    .filter(item => ["open", "in_progress", "blocked"].includes(item.status) && item.assigneeType !== "unassigned" && item.assigneeId)
    .map(item => item.id));
  const newApplicationIds = new Set([vendor.data.application?.id, sponsor.data.application?.id].filter(Boolean));
  const immediateIntakeReminders = (afterWorker.data.followups || []).filter(item => item.kind === "milestone_reminder" && newApplicationIds.has(item.applicationId));
  const taskAssignmentMessages = (afterWorker.data.followups || []).filter(item => item.kind === "task_assignment" && activeAssignedTaskIds.has(item.taskId));
  check("worker prepares review-first messages", workerOutput.includes("processed 3 job(s)") && afterWorker.data.applications?.length === 7 && afterWorker.data.followups?.filter(item => item.status === "draft_ready").length >= 7);
  check("new partner acknowledgments are separated from milestone reminders", immediateIntakeReminders.length === 0);
  check("worker prepares one private notice per assigned task", taskAssignmentMessages.length === activeAssignedTaskIds.size && taskAssignmentMessages.every(item => item.status === "draft_ready" && item.recipientAvailable === true && item.recipientLabel && !("recipient" in item) && item.body?.includes("#task-status?task=") && item.body?.includes("&token=tsft_")));
  const taskPortalMessage = taskAssignmentMessages.find(item => item.taskId && item.body?.includes("#task-status?task="));
  const taskPortalUrl = taskPortalMessage?.body?.match(/https?:\/\/\S+#task-status\?\S+/)?.[0] || null;
  const taskPortalLink = taskPortalUrl ? new URL(taskPortalUrl) : null;
  const taskPortalParams = taskPortalLink ? new URLSearchParams(taskPortalLink.hash.split("?")[1] || "") : null;
  const taskPortalAccess = taskPortalParams ? { taskId: taskPortalParams.get("task"), token: taskPortalParams.get("token") } : null;
  const openedTaskPortal = taskPortalAccess ? await request(base, "POST", "/api/public/task-status", taskPortalAccess) : null;
  const acknowledgedTaskPortal = taskPortalAccess ? await request(base, "POST", "/api/public/task-status/update", { ...taskPortalAccess, action: "acknowledge", note: "Synthetic assignee confirms the board-demo handoff." }) : null;
  const taskWorkspaceAfterAcknowledgment = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const acknowledgedBoardTask = taskWorkspaceAfterAcknowledgment.data.tasks?.find(item => item.id === taskPortalAccess?.taskId);
  check("private task link closes the assignee-to-Operations loop", openedTaskPortal?.status === 200 && acknowledgedTaskPortal?.status === 200 && acknowledgedTaskPortal.data.task?.acknowledgedAt && acknowledgedBoardTask?.acknowledgedAt && acknowledgedBoardTask?.assigneeUpdates?.at(-1)?.note.includes("Synthetic assignee"));
  check("all board applications stay in 2027", afterWorker.data.applications?.every(item => item.eventId === DEFAULT_EVENT_ID));
  const automationEnabled = await request(base, "PATCH", "/api/admin/partners/automation", { mode: "transactional_auto" }, { auth: true });
  const automatedWorkerOutputs = [];
  let deliveredWorkspace = null;
  for (let attempt = 0; attempt < 3 && !deliveredWorkspace; attempt += 1) {
    automatedWorkerOutputs.push(await runWorker(child.processEnv));
    deliveredWorkspace = await waitFor(async () => {
      const workspace = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
      const applicationMessages = workspace.data.followups?.filter(item => item.kind === "application_received") || [];
      const assignmentMessages = workspace.data.followups?.filter(item => item.kind === "task_assignment" && activeAssignedTaskIds.has(item.taskId)) || [];
      const milestoneReminder = workspace.data.followups?.find(item => item.kind === "milestone_reminder" && item.milestoneId === seededCreativeMilestone?.id);
      return applicationMessages.length >= 7
        && applicationMessages.every(item => item.status === "sent" && item.deliveryStatus === "delivered")
        && assignmentMessages.length === activeAssignedTaskIds.size
        && assignmentMessages.every(item => item.status === "sent" && item.deliveryStatus === "delivered")
        && milestoneReminder?.status === "sent"
        && milestoneReminder?.deliveryStatus === "delivered"
        ? workspace
        : null;
    }, 1_500);
  }
  const automatedWorkerOutput = automatedWorkerOutputs.join("\n");
  const latestWorkspace = deliveredWorkspace || await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const emailHealth = await fetch(`${emailSandbox.url}/health`).then(response => response.json());
  const deliveredMessages = latestWorkspace?.data.followups?.filter(item => item.status === "sent") || [];
  const projectedMilestoneReminders = latestWorkspace?.data.followups?.filter(item => item.kind === "milestone_reminder") || [];
  const deliveredCreativeReminder = projectedMilestoneReminders.find(item => item.milestoneId === seededCreativeMilestone?.id);
  const automationProof = {
    enableStatus: automationEnabled.status,
    enableAutomation: automationEnabled.data.automation,
    worker: automatedWorkerOutput.trim().split("\n").slice(-12),
    deliveredStatuses: latestWorkspace?.data.followups?.map(item => ({ kind: item.kind, status: item.status, deliveryStatus: item.deliveryStatus })) || null,
    emailHealth
  };
  const localDeliveryReady = automationEnabled.status === 200 && automationEnabled.data.automation?.active === true && automatedWorkerOutput.includes("transactional automation") && deliveredMessages.length >= 6 && emailHealth.acceptedMessages >= 6 && emailHealth.deliveryCallbacks >= 6 && emailHealth.callbackFailures === 0;
  const approvedCampaignMessages = deliveredMessages.filter(item => item.campaignId);
  const transactionalMessages = deliveredMessages.filter(item => !item.campaignId);
  const automationPolicyScoped = approvedCampaignMessages.length === 1 && approvedCampaignMessages.every(item => item.automationPolicy === "outreach_campaign_v1") && transactionalMessages.every(item => item.automationPolicy === "partner_transactional_v1") && latestWorkspace?.data.email?.ready === true && latestWorkspace?.data.email?.deliveryTracking?.ready === true && latestWorkspace?.data.automation?.policy === "partner_transactional_v1";
  check("board transactional automation delivers known-partner messages locally", localDeliveryReady, localDeliveryReady ? "" : JSON.stringify(automationProof));
  const creativeReminderReady = deliveredCreativeReminder?.status === "sent"
    && deliveredCreativeReminder?.deliveryStatus === "delivered"
    && deliveredCreativeReminder?.automationPolicy === "partner_transactional_v1"
    && deliveredCreativeReminder?.subject?.includes("sponsor homepage creative approval reminder");
  check("board transactional automation delivers the due-soon key-date reminder", creativeReminderReady, creativeReminderReady ? "" : JSON.stringify({ milestoneId: seededCreativeMilestone?.id, reminders: projectedMilestoneReminders }));
  check("board automation stays scoped to approved campaigns and transactional policy", automationPolicyScoped, automationPolicyScoped ? "" : JSON.stringify(automationProof));

  const conditions = await request(base, "GET", "/api/public/island-conditions");
  check("board conditions are offline-safe and expose fresh synthetic lanes without claiming live hardware", conditions.status === 200
    && conditions.data.weather?.source === "Board weather simulation"
    && conditions.data.weather?.freshness?.state === "live"
    && conditions.data.ferry?.source === "Board ferry simulation"
    && conditions.data.ferry?.freshness?.state === "live"
    && conditions.data.cameras?.length === 8
    && conditions.data.summary?.freshObservations === 8
    && conditions.data.summary?.liveCameras === 0
    && conditions.data.summary?.armedCameras === 0);
  const playback = await runBoardCameraPlaybackTick({
    apiBase: base,
    adminToken: TOKEN,
    ingestSecret: CAMERA_SECRET,
    runId: "board-runtime-test",
    cycle: 0
  });
  const playbackPublic = await request(base, "GET", "/api/public/island-conditions");
  const playbackAdmin = await request(base, "GET", "/api/admin/island-conditions", undefined, { auth: true });
  check("board camera playback keeps all signed pipelines current", playback.ok && playback.cameras === 8 && playback.heartbeats === 8 && playbackPublic.data.summary?.armedCameras === 8 && playbackPublic.data.summary?.liveCameras === 8 && playbackPublic.data.summary?.healthyPipelines === 8 && playbackAdmin.data.cameras?.every(camera => camera.health?.agentId === "board-camera-playback"));
  check("board camera playback stays public-metrics-only", playbackAdmin.data.cameras?.every(camera => camera.observation?.rawMediaStored === false) && playbackPublic.data.cameras?.every(camera => camera.operationalStatus === "live" && !Object.hasOwn(camera, "sourceId") && !Object.hasOwn(camera, "health") && !Object.hasOwn(camera.observation || {}, "modelName") && !Object.hasOwn(camera.observation || {}, "notes") && !Object.hasOwn(camera.observation || {}, "rawMediaStored")));
  const sourceDigestAfter = await digest(sourcePartnerPath);
  check("board workflows do not mutate repository partner data", sourceDigestAfter === sourceDigestBefore);
} finally {
  await smsSandbox?.close();
  await emailSandbox?.close();
  await stopChild(child);
  if (temporary) await rm(temporary, { recursive: true, force: true });
}

console.log(`\nBoard runtime total: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
