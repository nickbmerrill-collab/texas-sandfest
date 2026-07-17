#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareBoardRuntime } from "../lib/board-runtime.mjs";
import { runBoardCameraPlaybackTick } from "../lib/board-camera-playback.mjs";
import { boardEmailSandboxConfig, startBoardEmailSandbox } from "../lib/board-email-sandbox.mjs";
import { boardSmsSandboxConfig, startBoardSmsSandbox } from "../lib/board-sms-sandbox.mjs";
import { DEFAULT_EVENT_ID } from "../lib/event-context.mjs";
import { platformDocumentFilePath } from "../lib/platform-data.mjs";
import { resolveRuntimeRoot } from "../lib/runtime-root.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "board-runtime-test-admin-token-change-me";
const CAMERA_SECRET = "board-runtime-camera-secret-0123456789abcdef0123456789";
const EMAIL_API_KEY = "board-runtime-email-api-key-0123456789abcdef";
const EMAIL_WEBHOOK_TOKEN = "board-runtime-email-webhook-token-0123456789abcdef";
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
    SANDFEST_PARTNER_PORTAL_SECRET: "board-runtime-partner-portal-secret-0123456789",
    SANDFEST_OUTREACH_PREFERENCES_SECRET: "board-runtime-outreach-preferences-secret-0123456789",
    OUTREACH_DISCOVERY_ENABLED: "true",
    OUTREACH_DISCOVERY_PROVIDER: "fixture",
    SANDFEST_PUBLIC_SITE_URL: "https://www.texassandfest.org",
    SANDFEST_API_PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
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
  check("runtime root resolves outside repository data", resolved === targetRoot && resolved !== ROOT);
  check("board seed covers core operations", prepared.applications === 2 && prepared.invoices === 1 && prepared.payments === 1 && prepared.tasks === 3 && prepared.prospects === 1 && prepared.safetySmsRecipients === 1);
  check("board seed covers field operations", prepared.cameras === 8 && prepared.volunteerShifts === 12);

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
  check("isolated runtime is current-event ready", health.status === 200 && health.data.currentEventReady === true && health.data.currentEventId === DEFAULT_EVENT_ID);
  check("health identifies isolated runtime data", health.data.runtimeDataMode === "isolated" && health.data.cameraIngestReady === true && health.data.safetySmsReady === true);
  const bootstrap = await request(base, "GET", "/api/public/bootstrap");
  const publicVendorCatalog = await request(base, "GET", "/api/public/vendors");
  const publicSponsorCatalog = await request(base, "GET", "/api/public/sponsors");
  check("board runtime is visibly labeled as synthetic", bootstrap.status === 200 && bootstrap.data.runtime?.mode === "board_demo" && bootstrap.data.runtime?.label?.includes("No external messages or payments are sent"));
  check("board runtime publishes vendor offerings", publicVendorCatalog.status === 200 && publicVendorCatalog.data.vendorOfferings?.length === 3 && publicVendorCatalog.data.vendorOfferings?.some(item => item.id === "marketplace-booth" && item.amount === 125000));
  const publicBoardSponsor = publicSponsorCatalog.data.sponsors?.find(item => item.displayName === "Gulf Shore Credit Union");
  const publicBoardSponsorJson = JSON.stringify(publicBoardSponsor || {});
  check("board runtime publishes only approved sponsor branding", publicSponsorCatalog.status === 200 && publicBoardSponsor?.packageName === "Marlin" && publicBoardSponsor?.tagline === "Rooted on the Texas coast" && publicBoardSponsor?.primaryColor === "#006B63" && publicBoardSponsor?.secondaryColor === "#F4B942" && publicBoardSponsor?.logo === null);
  check("public sponsor branding excludes private workflow data", !/(applicationId|contactEmail|contactName|storageKey|reviewedBy|reviewNotes|sourceUrl)/.test(publicBoardSponsorJson));

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
  const deliveredSms = await waitFor(async () => {
    const sms = await request(base, "GET", "/api/admin/sms", undefined, { auth: true });
    return sms.data.campaigns?.[0]?.counts?.delivered === 1 ? sms : null;
  });
  const smsSandboxHealth = await fetch(`${smsSandbox.url}/health`).then(response => response.json());
  check("board safety alert delivers through the signed local SMS lifecycle", boardAlert.status === 200 && boardAlert.data.sms?.queued === 1 && smsWorkerOutput.includes("sms.alert.send") && deliveredSms?.data.campaigns?.[0]?.counts?.delivered === 1 && smsSandboxHealth.acceptedMessages === 1 && smsSandboxHealth.deliveryCallbacks === 1 && smsSandboxHealth.callbackFailures === 0);

  const smsBasicAuth = Buffer.from(`${SMS_ACCOUNT_SID}:${SMS_AUTH_TOKEN}`).toString("base64");
  const simulateSmsPreference = body => fetch(`${smsSandbox.url}/simulate/inbound`, {
    method: "POST",
    headers: {
      authorization: `Basic ${smsBasicAuth}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ From: SMS_RECIPIENT, Body: body })
  });
  const stopSms = await simulateSmsPreference("STOP");
  const afterStopSms = await request(base, "GET", "/api/admin/sms", undefined, { auth: true });
  const startSms = await simulateSmsPreference("START");
  const afterStartSms = await request(base, "GET", "/api/admin/sms", undefined, { auth: true });
  const preferenceHealth = await fetch(`${smsSandbox.url}/health`).then(response => response.json());
  check("board SMS STOP and START traverse signed consent callbacks", stopSms.status === 201 && afterStopSms.data.eligibleSafetyRecipients === 0 && afterStopSms.data.summary?.preferences?.STOP === 1 && startSms.status === 201 && afterStartSms.data.eligibleSafetyRecipients === 1 && afterStartSms.data.summary?.preferences?.START === 1 && preferenceHealth.preferenceCallbacks === 2);
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
  check("seeded sponsor and vendor finance is visible", seeded.status === 200 && seeded.data.applications?.length === 2 && seeded.data.applications?.some(item => item.type === "vendor" && item.offeringId === "food-beverage-booth" && item.expectedAmountCents === 175000) && seeded.data.invoices?.length === 1 && seeded.data.payments?.length === 1 && seeded.data.receivables?.totals?.collectedCents === 1000000);
  check("revenue is current-event and includes site-native finance", revenue.status === 200 && revenue.data.eventId === DEFAULT_EVENT_ID && revenue.data.sources?.imported?.entries === 3 && revenue.data.sources?.partnerOperations?.entries === 1 && revenue.data.summary?.totals?.grossCents === 1750000 && revenue.data.summary?.tickets?.sold === 100 && revenue.data.entries?.every(item => item.eventId === DEFAULT_EVENT_ID) && revenue.data.imports?.length === 3 && revenue.data.imports?.every(item => item.fileName?.endsWith("-demo.csv")));
  check("seeded work and outreach are visible", seeded.data.tasks?.length === 3 && seeded.data.followups?.length >= 2 && outreach.status === 200 && outreach.data.prospects?.length === 1 && outreach.data.campaigns?.length === 1);
  check("board staff routing is current and private", seeded.data.staffDirectory?.ready === true && seeded.data.staffDirectory?.activeStaff === 7 && seeded.data.staffDirectory?.routedTeams === 7 && seeded.data.assignmentDirectory?.teams?.every(item => item.notificationReady === true) && seeded.data.assignmentDirectory?.staff?.every(item => !("email" in item)));
  const seededSponsorProspect = outreach.data.prospects?.[0];
  check("seeded outreach has accountable follow-up", seededSponsorProspect?.ownerId === "sponsor" && seededSponsorProspect?.nextActionAt && outreach.data.summary?.nextActionsScheduled === 1 && outreach.data.summary?.unassigned === 0);
  const boardSponsorInvitation = await request(base, "POST", `/api/admin/outreach/prospects/${seededSponsorProspect?.id}/sponsor-invitation`, {
    action: "issue",
    packageId: "tarpon"
  }, { auth: true });
  const boardSponsorInvitationHash = boardSponsorInvitation.data.invitation?.url ? new URL(boardSponsorInvitation.data.invitation.url).hash : "";
  const boardSponsorInvitationToken = new URLSearchParams(boardSponsorInvitationHash.slice(boardSponsorInvitationHash.indexOf("?") + 1)).get("token");
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
  check("public vendor and sponsor signup work", vendor.status === 201 && sponsor.status === 201 && vendor.data.acknowledgment === "draft_queued" && sponsor.data.acknowledgment === "draft_queued" && signedUpVendor?.offeringId === "marketplace-booth" && signedUpVendor?.expectedAmountCents === 125000);

  const workerOutput = await runWorker(child.processEnv);
  const afterWorker = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const activeAssignedTaskIds = new Set((afterWorker.data.tasks || [])
    .filter(item => ["open", "in_progress", "blocked"].includes(item.status) && item.assigneeType !== "unassigned" && item.assigneeId)
    .map(item => item.id));
  const taskAssignmentMessages = (afterWorker.data.followups || []).filter(item => item.kind === "task_assignment" && activeAssignedTaskIds.has(item.taskId));
  check("worker prepares review-first messages", workerOutput.includes("processed 3 job(s)") && afterWorker.data.applications?.length === 5 && afterWorker.data.followups?.filter(item => item.status === "draft_ready").length >= 5);
  check("worker prepares one private notice per assigned task", taskAssignmentMessages.length === activeAssignedTaskIds.size && taskAssignmentMessages.every(item => item.status === "draft_ready" && item.recipientAvailable === true && item.recipientLabel && !("recipient" in item)));
  check("all board applications stay in 2027", afterWorker.data.applications?.every(item => item.eventId === DEFAULT_EVENT_ID));
  const automationEnabled = await request(base, "PATCH", "/api/admin/partners/automation", { mode: "transactional_auto" }, { auth: true });
  const automatedWorkerOutput = await runWorker(child.processEnv);
  const deliveredWorkspace = await waitFor(async () => {
    const workspace = await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
    const applicationMessages = workspace.data.followups?.filter(item => item.kind === "application_received") || [];
    const assignmentMessages = workspace.data.followups?.filter(item => item.kind === "task_assignment" && activeAssignedTaskIds.has(item.taskId)) || [];
    return applicationMessages.length >= 5
      && applicationMessages.every(item => item.status === "sent" && item.deliveryStatus === "delivered")
      && assignmentMessages.length === activeAssignedTaskIds.size
      && assignmentMessages.every(item => item.status === "sent" && item.deliveryStatus === "delivered")
      ? workspace
      : null;
  });
  const latestWorkspace = deliveredWorkspace || await request(base, "GET", "/api/admin/partners", undefined, { auth: true });
  const emailHealth = await fetch(`${emailSandbox.url}/health`).then(response => response.json());
  const deliveredMessages = latestWorkspace?.data.followups?.filter(item => item.status === "sent") || [];
  const automationProof = {
    enableStatus: automationEnabled.status,
    enableAutomation: automationEnabled.data.automation,
    worker: automatedWorkerOutput.trim().split("\n").slice(-12),
    deliveredStatuses: latestWorkspace?.data.followups?.map(item => ({ kind: item.kind, status: item.status, deliveryStatus: item.deliveryStatus })) || null,
    emailHealth
  };
  const localDeliveryReady = automationEnabled.status === 200 && automationEnabled.data.automation?.active === true && automatedWorkerOutput.includes("transactional automation") && deliveredMessages.length >= 5 && emailHealth.acceptedMessages >= 5 && emailHealth.deliveryCallbacks >= 5 && emailHealth.callbackFailures === 0;
  const reviewPolicyPreserved = deliveredMessages.every(item => !item.campaignId) && latestWorkspace?.data.email?.ready === true && latestWorkspace?.data.email?.deliveryTracking?.ready === true && latestWorkspace?.data.automation?.policy === "partner_transactional_v1";
  check("board transactional automation delivers known-partner messages locally", localDeliveryReady, localDeliveryReady ? "" : JSON.stringify(automationProof));
  check("board email sandbox preserves outreach review policy", reviewPolicyPreserved, reviewPolicyPreserved ? "" : JSON.stringify(automationProof));

  const conditions = await request(base, "GET", "/api/public/island-conditions");
  check("board conditions expose fresh synthetic lanes without claiming live hardware", conditions.status === 200 && conditions.data.cameras?.length === 8 && conditions.data.summary?.freshObservations === 8 && conditions.data.summary?.liveCameras === 0 && conditions.data.summary?.armedCameras === 0);
  const playback = await runBoardCameraPlaybackTick({
    apiBase: base,
    adminToken: TOKEN,
    ingestSecret: CAMERA_SECRET,
    runId: "board-runtime-test",
    cycle: 0
  });
  const playbackPublic = await request(base, "GET", "/api/public/island-conditions");
  const playbackAdmin = await request(base, "GET", "/api/admin/island-conditions", undefined, { auth: true });
  check("board camera playback drives all signed pipelines live", playback.ok && playback.cameras === 8 && playback.heartbeats === 8 && playbackPublic.data.summary?.armedCameras === 8 && playbackPublic.data.summary?.liveCameras === 8 && playbackPublic.data.summary?.healthyPipelines === 8 && playbackAdmin.data.cameras?.every(camera => camera.health?.agentId === "board-camera-playback"));
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
