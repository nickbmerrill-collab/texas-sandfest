import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareBoardRuntime } from "../lib/board-runtime.mjs";
import { DEFAULT_EVENT_ID } from "../lib/event-context.mjs";
import {
  beginIncidentDispatchProviderSubmission,
  claimIncidentDispatchDelivery,
  normalizeIslandConditions,
  queueIncidentDispatchMessage,
  recordIncidentDispatchDelivery
} from "../lib/island-conditions.mjs";
import {
  beginFollowupProviderSubmission,
  claimFollowupDelivery,
  normalizePartnerOperations,
  prepareFollowupDraft,
  queueFollowupDelivery,
  recordFollowupDelivery,
  reviewFollowup
} from "../lib/partner-ops.mjs";
import { outreachPreferenceUrlForProspect, outreachPreferencesConfig } from "../lib/outreach-preferences.mjs";
import { updatePlatformDoc } from "../lib/platform-data.mjs";
import { taskPortalConfig, taskPortalUrlForTask } from "../lib/task-portal.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "board-browser-admin-token-0123456789abcdef";
const PORTAL_SECRET = "board-browser-portal-secret-0123456789abcdef";
const OUTREACH_SECRET = "board-browser-outreach-secret-0123456789abcdef";
const EMAIL_API_KEY = "board-browser-email-api-key-0123456789abcdef";
const EMAIL_WEBHOOK_TOKEN = "board-browser-email-webhook-token-0123456789abcdef";
const BOARD_TICKET_SECRET = "board-browser-ticket-secret-0123456789abcdef";
const SMS_ACCOUNT_SID = "AC00000000000000000000000000000001";
const SMS_AUTH_TOKEN = "board-browser-twilio-auth-token-0123456789";
const SMS_FROM_NUMBER = "+13615550100";
const BOARD_BROWSER_GENERATION = "2026-07-22T12:00:00.000Z";
let temporaryRoot;
let apiProcess;
let webProcess;
let emailProcess;
let smsProcess;
let workerProcess;
let runtimeRoot;
let apiBase;
let webBase;

test.describe.configure({ mode: "serial" });

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function startNodeProcess(label, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const append = chunk => {
    output = `${output}${String(chunk)}`.slice(-20_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.output = () => output;
  child.label = label;
  return child;
}

async function waitForHttp(url, child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`${child.label} exited ${child.exitCode}:\n${child.output()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${child.label} did not become ready at ${url}:\n${child.output()}`);
}

async function waitForJson(url, predicate, child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`${child.label} exited ${child.exitCode}:\n${child.output()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      const value = response.ok ? await response.json() : null;
      if (value && predicate(value)) return value;
    } catch {
      // The service state is still converging.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${child.label} did not reach the expected state at ${url}:\n${child.output()}`);
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5_000))]);
  if (child.exitCode == null) child.kill("SIGKILL");
}

async function submitAndCapture(page, form, pathname) {
  const responsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === apiBase && url.pathname === pathname && response.request().method() === "POST";
  });
  await form.locator('button[type="submit"]').click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  return response.json();
}

async function beforeUnloadPrevented(page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

async function adminApi(pathname, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function forceUnknownIncidentDelivery(dispatchId, deliveryClaimId) {
  await updatePlatformDoc(runtimeRoot, "islandConditions", current => {
    const doc = normalizeIslandConditions(current);
    const dispatch = doc.dispatches.find(item => item.id === dispatchId);
    if (!dispatch) throw new Error("Browser test dispatch not found.");
    const recipientContext = {
      taskRecipients: [{
        id: dispatch.assigneeId,
        assigneeType: dispatch.assigneeType,
        name: dispatch.assigneeName,
        email: dispatch.notification.recipient,
        status: "active"
      }]
    };
    const queued = queueIncidentDispatchMessage(doc, dispatchId, { ...recipientContext, actorId: "board-browser-acceptance" });
    const claimed = queued.ok && claimIncidentDispatchDelivery(queued.doc, dispatchId, { ...recipientContext, deliveryClaimId });
    const begun = claimed?.ok && beginIncidentDispatchProviderSubmission(claimed.doc, dispatchId, { ...recipientContext, deliveryClaimId });
    const unknown = begun?.ok && recordIncidentDispatchDelivery(begun.doc, dispatchId, {
      sent: false,
      provider: "worker",
      error: "Browser test worker stopped after provider submission began."
    }, { deliveryClaimId, terminal: true, unknownOutcome: true });
    if (!unknown?.ok) throw new Error(unknown?.error || begun?.error || claimed?.error || queued.error);
    return unknown.doc;
  }, { fallback: normalizeIslandConditions(null) });
}

async function forceUnknownPartnerDelivery(followupId, deliveryClaimId) {
  await updatePlatformDoc(runtimeRoot, "partnerOps", current => {
    let doc = normalizePartnerOperations(current);
    let followup = doc.followups.find(item => item.id === followupId);
    if (!followup) throw new Error("Browser test partner follow-up not found.");
    if (followup.status === "pending") {
      const prepared = prepareFollowupDraft(doc, followupId);
      if (!prepared.ok) throw new Error(prepared.error);
      doc = prepared.doc;
      followup = prepared.followup;
    }
    if (followup.status === "draft_ready") {
      const approved = reviewFollowup(doc, followupId, "approve", { actorId: "board-browser-acceptance" });
      if (!approved.ok) throw new Error(approved.error);
      doc = approved.doc;
    }
    const queued = queueFollowupDelivery(doc, followupId);
    const claimed = queued.ok && claimFollowupDelivery(queued.doc, followupId, { deliveryClaimId });
    const begun = claimed?.ok && beginFollowupProviderSubmission(claimed.doc, followupId, { deliveryClaimId });
    const unknown = begun?.ok && recordFollowupDelivery(begun.doc, followupId, {
      sent: false,
      provider: "worker",
      error: "Browser test worker stopped after provider submission began."
    }, { deliveryClaimId, terminal: true, unknownOutcome: true });
    if (!unknown?.ok) throw new Error(unknown?.error || begun?.error || claimed?.error || queued.error);
    return unknown.doc;
  }, { fallback: normalizePartnerOperations(null) });
}

async function assertNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const describe = element => {
      const rect = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.classList.length ? `.${[...element.classList].slice(0, 3).join(".")}` : ""}`,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        display: styles.display,
        gridTemplateColumns: styles.gridTemplateColumns,
        minWidth: styles.minWidth,
        text: String(element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)
      };
    };
    const elements = [document.body, ...document.querySelectorAll("body *")];
    const offenders = elements.map(describe).filter(item => item.right > clientWidth + 1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 8);
    const internalOverflow = elements.map(describe)
      .filter(item => item.clientWidth > 0 && item.scrollWidth > item.clientWidth + 1)
      .sort((a, b) => (b.scrollWidth - b.clientWidth) - (a.scrollWidth - a.clientWidth))
      .slice(0, 12);
    return {
      clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders,
      internalOverflow
    };
  });
  expect(dimensions.scrollWidth, JSON.stringify(dimensions, null, 2)).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function scrollWindowTo(page, { top, left = 0 }) {
  await page.evaluate(({ top, left }) => {
    const previous = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(left, top);
    document.documentElement.style.scrollBehavior = previous;
  }, { top, left });
}

async function assertChoiceTargets(page, label) {
  const issues = await page.locator('input[type="checkbox"], input[type="radio"]').evaluateAll(inputs => inputs.filter(input => {
    const bounds = input.getBoundingClientRect();
    const styles = getComputedStyle(input);
    return bounds.width > 0 && bounds.height > 0 && styles.display !== "none" && styles.visibility !== "hidden";
  }).map(input => {
    const enclosingLabel = input.closest("label");
    const externalLabel = !enclosingLabel && input.id
      ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
      : null;
    const target = enclosingLabel || externalLabel || input;
    const bounds = target.getBoundingClientRect();
    return {
      label: input.getAttribute("aria-label") || target.textContent?.trim() || input.name || input.id || input.type,
      width: Math.round(bounds.width * 10) / 10,
      height: Math.round(bounds.height * 10) / 10
    };
  }).filter(target => target.width < 24 || target.height < 24));
  expect(issues, `${label} choice controls must expose a 24px pointer target`).toEqual([]);
}

async function expectAdminWorkspaceReady(page) {
  const status = page.locator('#admin-api-status[data-workspace-state="ready"]');
  await expect(status).toHaveAttribute("aria-busy", "false", { timeout: 25_000 });
}

async function assertNoAccessibilityViolations(page, label) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = results.violations.map(violation => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map(node => node.target.join(" "))
  }));
  expect(violations, `${label} must have no automated WCAG A/AA violations`).toEqual([]);
}

async function assertAnchorClearsWorkspaceNav(page, selector, minimumGap = 0) {
  await expect.poll(() => page.evaluate(({ selector, minimumGap }) => {
    const nav = document.querySelector(".admin-workspace-nav");
    const target = document.querySelector(selector);
    return Boolean(nav && target && target.getBoundingClientRect().top >= nav.getBoundingClientRect().bottom + minimumGap);
  }, { selector, minimumGap })).toBe(true);
}

async function assertTargetClearsTopbar(page, selector, minimumGap = 0, maximumGap = 48) {
  const targetHasSafeGap = () => page.evaluate(({ selector, minimumGap, maximumGap }) => {
    const topbar = document.querySelector(".topbar");
    const target = document.querySelector(selector);
    if (!topbar || !target) return false;
    const notice = document.querySelector("#runtime-data-notice");
    const obstructionBottom = Math.max(
      topbar.getBoundingClientRect().bottom,
      notice && getComputedStyle(notice).position === "sticky" ? notice.getBoundingClientRect().bottom : 0
    );
    const gap = target.getBoundingClientRect().top - obstructionBottom;
    return gap >= minimumGap && gap <= maximumGap;
  }, { selector, minimumGap, maximumGap });
  await expect.poll(targetHasSafeGap).toBe(true);
  await page.waitForTimeout(1_750);
  expect(await targetHasSafeGap()).toBe(true);
}

function presentationUploadCopy(buffer, comment) {
  const endOfDirectory = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOfDirectory < 0 || endOfDirectory + 22 > buffer.length) throw new Error("Presentation ZIP directory is invalid.");
  const originalLength = buffer.readUInt16LE(endOfDirectory + 20);
  if (endOfDirectory + 22 + originalLength !== buffer.length) throw new Error("Presentation ZIP comment is invalid.");
  const originalComment = buffer.subarray(endOfDirectory + 22);
  const addedComment = Buffer.from(comment, "ascii");
  const commentLength = originalComment.length + addedComment.length;
  if (commentLength > 65_535) throw new Error("Presentation ZIP comment is too long.");
  const copy = Buffer.concat([buffer.subarray(0, endOfDirectory + 22), originalComment, addedComment]);
  copy.writeUInt16LE(commentLength, endOfDirectory + 20);
  return copy;
}

test.beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "sandfest-board-browser-"));
  runtimeRoot = path.join(temporaryRoot, "runtime");
  await prepareBoardRuntime({
    sourceRoot: ROOT,
    targetRoot: runtimeRoot,
    eventId: DEFAULT_EVENT_ID,
    replace: true
  });

  const [apiPort, webPort, emailPort, smsPort] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
  apiBase = `http://127.0.0.1:${apiPort}`;
  webBase = `http://127.0.0.1:${webPort}`;
  const emailBase = `http://127.0.0.1:${emailPort}`;
  const smsBase = `http://127.0.0.1:${smsPort}`;
  const emailEnvironment = {
    TRANSACTIONAL_EMAIL_ENABLED: "true",
    BREVO_API_KEY: EMAIL_API_KEY,
    BREVO_SENDER_EMAIL: "sandbox@texassandfest.example",
    BREVO_SENDER_NAME: "Texas SandFest Browser Acceptance",
    BREVO_REPLY_TO_EMAIL: "reply@texassandfest.example",
    BREVO_WEBHOOK_TOKEN: EMAIL_WEBHOOK_TOKEN,
    BREVO_API_ENDPOINT: `${emailBase}/v3/smtp/email`
  };
  emailProcess = startNodeProcess("Board browser email sandbox", ["scripts/board-email-sandbox.mjs"], {
    SANDFEST_ENV: "development",
    SANDFEST_BOARD_EMAIL_SANDBOX: "true",
    SANDFEST_BOARD_EMAIL_PORT: String(emailPort),
    SANDFEST_BOARD_EMAIL_DELIVERY_DELAY_MS: "10",
    BOARD_BREVO_API_KEY: EMAIL_API_KEY,
    BREVO_WEBHOOK_TOKEN: EMAIL_WEBHOOK_TOKEN,
    SANDFEST_BOARD_EMAIL_WEBHOOK_URL: `${apiBase}/api/webhooks/brevo`
  });
  await waitForHttp(`${emailBase}/health`, emailProcess);
  const smsEnvironment = {
    SMS_ENABLED: "true",
    TWILIO_ACCOUNT_SID: SMS_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: SMS_AUTH_TOKEN,
    TWILIO_FROM_NUMBER: SMS_FROM_NUMBER,
    TWILIO_API_BASE_URL: smsBase,
    TWILIO_STATUS_CALLBACK_URL: `${apiBase}/api/webhooks/twilio/status`,
    TWILIO_SAFETY_INBOUND_WEBHOOK_URL: `${apiBase}/api/webhooks/twilio/inbound/smsSafety`
  };
  smsProcess = startNodeProcess("Board browser SMS sandbox", ["scripts/board-sms-sandbox.mjs"], {
    SANDFEST_ENV: "development",
    SANDFEST_BOARD_SMS_SANDBOX: "true",
    SANDFEST_BOARD_SMS_PORT: String(smsPort),
    SANDFEST_BOARD_SMS_DELIVERY_DELAY_MS: "10",
    BOARD_TWILIO_ACCOUNT_SID: SMS_ACCOUNT_SID,
    BOARD_TWILIO_AUTH_TOKEN: SMS_AUTH_TOKEN,
    BOARD_TWILIO_FROM_NUMBER: SMS_FROM_NUMBER,
    SANDFEST_BOARD_SMS_INBOUND_WEBHOOK_URL: `${apiBase}/api/webhooks/twilio/inbound/smsSafety`
  });
  await waitForHttp(`${smsBase}/health`, smsProcess);
  apiProcess = startNodeProcess("Board browser API", ["scripts/admin-api-server.mjs"], {
    SANDFEST_RUNTIME_ROOT: runtimeRoot,
    SANDFEST_INCOMING_DOCUMENT_DIR: path.join(runtimeRoot, "private", "incoming-documents"),
    SANDFEST_DATABASE_URL: "",
    SANDFEST_ENV: "development",
    SANDFEST_EVENT_ID: DEFAULT_EVENT_ID,
    SANDFEST_API_PORT: String(apiPort),
    SANDFEST_API_PUBLIC_BASE_URL: apiBase,
    SANDFEST_PUBLIC_SITE_URL: webBase,
    SANDFEST_ADMIN_BASE_URL: webBase,
    SANDFEST_CORS_ORIGINS: `https://www.texassandfest.org,https://texassandfest.org,${webBase}`,
    SANDFEST_ADMIN_API_TOKEN: TOKEN,
    SANDFEST_ADMIN_ROLE: "super_admin",
    SANDFEST_ADMIN_ACTOR_ID: "board-browser-acceptance",
    SANDFEST_ADMIN_RATE_LIMIT: "1000",
    SANDFEST_PUBLIC_RATE_LIMIT: "2000",
    SANDFEST_PARTNER_PORTAL_SECRET: PORTAL_SECRET,
    SANDFEST_OUTREACH_PREFERENCES_SECRET: OUTREACH_SECRET,
    SANDFEST_TURNSTILE_ENABLED: "false",
    OUTREACH_DISCOVERY_ENABLED: "true",
    OUTREACH_DISCOVERY_PROVIDER: "fixture",
    SANDFEST_BOARD_TICKET_SANDBOX: "true",
    SANDFEST_BOARD_TICKET_SECRET: BOARD_TICKET_SECRET,
    QB_ENVIRONMENT: "sandbox",
    QB_INVOICE_SYNC_ENABLED: "false",
    QB_CLIENT_ID: "board-browser-quickbooks-client",
    QB_CLIENT_SECRET: "board-browser-quickbooks-secret",
    QB_REDIRECT_URI: `${apiBase}/api/integrations/quickbooks/callback`,
    QB_TOKEN_ENCRYPTION_KEY: "board-browser-quickbooks-encryption-key-0123456789",
    ...emailEnvironment,
    ...smsEnvironment,
    CAMERA_INGEST_ENABLED: "false"
  });
  await waitForHttp(`${apiBase}/health`, apiProcess);

  workerProcess = startNodeProcess("Board browser worker", ["scripts/worker.mjs"], {
    SANDFEST_RUNTIME_ROOT: runtimeRoot,
    SANDFEST_INCOMING_DOCUMENT_DIR: path.join(runtimeRoot, "private", "incoming-documents"),
    SANDFEST_DATABASE_URL: "",
    SANDFEST_ENV: "development",
    SANDFEST_EVENT_ID: DEFAULT_EVENT_ID,
    SANDFEST_PUBLIC_SITE_URL: webBase,
    SANDFEST_API_PUBLIC_BASE_URL: apiBase,
    SANDFEST_PARTNER_PORTAL_SECRET: PORTAL_SECRET,
    SANDFEST_OUTREACH_PREFERENCES_SECRET: OUTREACH_SECRET,
    SANDFEST_WORKER_POLL_MS: "100",
    ...emailEnvironment,
    ...smsEnvironment
  });
  await waitForJson(`${apiBase}/ready`, value => value.checks?.workerStatus?.healthy === true, workerProcess);

  const viteEntrypoint = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  webProcess = startNodeProcess("Board browser web", [
    viteEntrypoint,
    "--host", "127.0.0.1",
    "--port", String(webPort),
    "--strictPort"
  ], {
    SANDFEST_BOARD_DEMO_ADMIN_TOKEN: TOKEN,
    SANDFEST_BOARD_DEMO_GENERATION: BOARD_BROWSER_GENERATION
  });
  await waitForHttp(`${webBase}/`, webProcess);
});

test.afterAll(async () => {
  await stopChild(workerProcess);
  await stopChild(webProcess);
  await stopChild(apiProcess);
  await stopChild(smsProcess);
  await stopChild(emailProcess);
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test("a fresh board runtime generation clears stale browser demo state", async ({ page }) => {
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  await page.evaluate(() => {
    sessionStorage.setItem("sandfest_board_demo_session_generation_v1", "2026-07-22T11:00:00.000Z");
    sessionStorage.setItem("sandfest_partner_portal_v1", JSON.stringify({ reference: "TSF-S-STALE", token: "tsfp_stale" }));
    sessionStorage.setItem("sandfest_task_portal_v1", JSON.stringify({ taskId: "task_stale", token: "tsft_stale" }));
    sessionStorage.setItem("sandfest_guest_services_v1", JSON.stringify({ reference: "TSF-GS-STALE", token: "tsfg_stale" }));
    localStorage.setItem("sandfest_board_demo_local_generation_v1", "2026-07-22T11:00:00.000Z");
    localStorage.setItem("sandfest_passport_v1", JSON.stringify(["sculpture_stale"]));
    localStorage.setItem("sandfest_passport_attendee_v1", "web_stale");
    localStorage.setItem("sandfest_vote_entry_v1", "sculpture_stale");
  });

  await page.reload();
  await expect(page.locator("#partner-status-form")).toBeVisible();
  await expect(page.locator('#partner-status-form [name="reference"]')).toHaveValue("");
  await expect(page.locator("#partner-status-form .partner-form-status")).toBeEmpty();
  await expect(page.locator("#partner-status-result")).toContainText("Your SandFest partnership, in one place");
  const browserState = await page.evaluate(generation => ({
    sessionGeneration: sessionStorage.getItem("sandfest_board_demo_session_generation_v1"),
    localGeneration: localStorage.getItem("sandfest_board_demo_local_generation_v1"),
    partnerAccess: sessionStorage.getItem("sandfest_partner_portal_v1"),
    taskAccess: sessionStorage.getItem("sandfest_task_portal_v1"),
    guestAccess: sessionStorage.getItem("sandfest_guest_services_v1"),
    passport: localStorage.getItem("sandfest_passport_v1"),
    attendee: localStorage.getItem("sandfest_passport_attendee_v1"),
    vote: localStorage.getItem("sandfest_vote_entry_v1"),
    expectedGeneration: generation
  }), BOARD_BROWSER_GENERATION);
  expect({ ...browserState, attendee: null }).toEqual({
    sessionGeneration: BOARD_BROWSER_GENERATION,
    localGeneration: BOARD_BROWSER_GENERATION,
    partnerAccess: null,
    taskAccess: null,
    guestAccess: null,
    passport: null,
    attendee: null,
    vote: null,
    expectedGeneration: BOARD_BROWSER_GENERATION
  });
  expect(browserState.attendee).toMatch(/^web_/);
  expect(browserState.attendee).not.toBe("web_stale");
});

test("board workflows operate through the public and staff interfaces", async ({ page }) => {
  test.skip(
    process.env.SANDFEST_WEBKIT_COMPAT_ONLY === "true",
    "The full state-mutating workflow runs in Chromium CI and local WebKit; Linux WebKit runs the focused compatibility workflows."
  );
  test.setTimeout(420_000);
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const runId = randomUUID().slice(0, 8);
  const vendorName = "Port A Coastal Makers";
  const sponsorName = "Coastal Community Bank";
  const taskTitle = `Browser volunteer welcome desk ${runId}`;
  const milestoneLabel = `Browser sponsor artwork due ${runId}`;
  const milestoneDueInput = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16);
  const prospectName = `Browser Port A Hospitality ${runId}`;
  const prospectIndustry = `browser hospitality ${runId}`;
  const prospectRecipient = `morgan.${runId}@example.com`;
  const campaignName = `Browser geofenced partners ${runId}`;
  const sponsorTierId = `community-champion-${runId}`;
  const vendorOfferingId = `premium-marketplace-${runId}`;
  const documentTitle = `Board extraction ${runId}`;
  const settlementReference = `browser_square_merch_${runId}`;
  const settlementFileName = `square-browser-${runId}.csv`;
  const budgetLineName = `Browser hospitality ${runId}`;
  const budgetVendorName = `Browser Guest Services ${runId}`;
  const settlementCsv = `transaction_id,date,category,gross_amount,fee_amount,net_amount,quantity,payout_id,payout_date,reconciled,entry_type
${settlementReference},2027-03-02,merch,325.00,9.75,315.25,5,square_payout_${runId},2027-03-03,yes,receipt`;

  await page.setViewportSize({ width: 1441, height: 1000 });
  const partnerReadinessResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-intake"
    && response.request().method() === "GET");
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  const partnerReadinessResponse = await partnerReadinessResponsePromise;
  expect(partnerReadinessResponse.status()).toBe(200);
  expect(await partnerReadinessResponse.json()).toEqual({
    eventId: DEFAULT_EVENT_ID,
    intakeAvailable: true,
    recoveryAvailable: true
  });
  await expect(page.locator("#network-status")).toHaveText("Demo");
  await expect(page.locator("#mobile-nav-toggle")).toBeHidden();
  await expect(page.locator("#public-navigation")).toBeVisible();
  await expect(page.locator('header nav a[href="#volunteer"]')).toBeVisible();
  await expect(page.locator("#volunteer")).toHaveAttribute("data-registration-status", "upcoming");
  await expect(page.locator("#volunteer-information-link")).toHaveAttribute("href", "https://www.texassandfest.org/volunteer");
  await expect(page.locator("#volunteer-registration-link")).toBeHidden();
  await page.locator('[data-prompt="How do I volunteer?"]').click();
  await expect(page.locator("#chat .concierge-answer").last()).toContainText("has not opened");
  await expect(page.locator("#chat .concierge-answer").last().locator('a[href="https://www.texassandfest.org/volunteer"]')).toHaveCount(1);
  await expect(page.locator("#experience")).toBeHidden();
  await expect(page.locator("#port-a")).toBeHidden();
  await expect(page.locator('header nav a[href="#port-a"]')).toBeHidden();
  const operationsSurface = page.locator("[data-operations-surface]");
  await expect(operationsSurface).toHaveAttribute("href", `${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await expect(operationsSurface).not.toHaveAttribute("target", /.+/);
  await expect(page.locator('[data-site-mode="public"]')).toHaveAttribute("aria-current", "page");
  const operationsHandoff = page.locator("[data-operations-handoff]");
  await expect(operationsHandoff).toHaveAttribute("href", `${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await expect(operationsHandoff).toHaveAttribute("target", "_blank");
  const operationsPagePromise = page.context().waitForEvent("page");
  await operationsHandoff.click();
  const operationsPage = await operationsPagePromise;
  const operationsPageErrors = [];
  operationsPage.on("pageerror", error => operationsPageErrors.push(error.message));
  await operationsPage.waitForLoadState("domcontentloaded");
  await expect(operationsPage).toHaveURL(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await expect(operationsPage.locator("#network-status")).toHaveText("Demo");
  await expect(operationsPage.locator("#admin-api-status")).toContainText("Loaded");
  await expect(operationsPage.locator("#admin-command-signals")).toHaveAttribute("aria-busy", "false");
  await expect(operationsPage.locator("#admin-command-signals [data-command-signal]")).toHaveCount(8);
  await expect(operationsPage.locator('#admin-event-guide-form [name="volunteerRegistrationStatus"]')).toHaveValue("upcoming");
  await expect(operationsPage.locator('#admin-event-guide-form [name="volunteerInformationUrl"]')).toHaveValue("https://www.texassandfest.org/volunteer");
  await expect(operationsPage.locator('#admin-event-guide-form [name="volunteerRegistrationUrl"]')).toHaveValue("");
  await expect(operationsPage.locator('#admin-sponsor-catalog-publication [data-catalog-publication-state]')).toHaveText("Board demo catalog");
  await expect(operationsPage.locator('#admin-vendor-catalog-publication [data-catalog-publication-state]')).toHaveText("Board demo catalog");
  const flounderSponsorCard = operationsPage.locator('[data-admin-sponsor="flounder"]');
  await expect(flounderSponsorCard).toBeVisible();
  const sponsorSaveResponse = operationsPage.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/sponsor-packages/flounder" && response.request().method() === "PATCH");
  await flounderSponsorCard.locator('[data-save-sponsor="flounder"]').click();
  expect((await sponsorSaveResponse).status()).toBe(200);
  await expect(operationsPage.locator("#admin-api-status")).toContainText("Saved sponsor config for Flounder");
  expect(operationsPageErrors).toEqual([]);
  await operationsPage.close();
  await expect(page.locator("#media")).toContainText("Scenes from SandFest");
  await expect(page.locator(".map-media-section")).toContainText("See the beach corridor before you arrive.");
  await expect(page.locator("#media")).not.toContainText("Scraped frontend media");
  await expect(page.locator(".map-media-section")).not.toContainText("should become reviewed records");
  await expect(page.locator("#vendors-map")).not.toContainText("Seed data");
  await expect(page.locator("#booth-pin-count")).toContainText("booths");
  const vendorApplicationLink = page.locator('#vendors-map a[href="#vendor-application-form"]');
  await expect(vendorApplicationLink).toHaveText("Apply as a vendor");
  await vendorApplicationLink.click();
  await expect(page).toHaveURL(/#vendor-application-form$/);
  await expect(page.locator("#vendor-application-form")).toBeInViewport({ ratio: 0.1 });
  await expect(page.locator("#vendor-intake-label")).toHaveText("Vendor application");
  await expect(page.locator("#vendor-intake-submit")).toHaveText("Submit vendor application");
  await expect(page.locator("#vendor-intake-availability")).toContainText("Applications open");
  await expect(page.locator("#vendor-data-use-note")).toContainText("Do not submit payment card, bank, tax ID, or health information here.");
  await expect(page.locator("#sponsor-inquiry-form .partner-data-use-note")).toContainText("private partner status portal");
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor&vendorOffering=marketplace-booth&vendorCategory=artisan#vendor-application-form`);
  const openingHandoffForm = page.locator("#vendor-application-form");
  await expect(openingHandoffForm).toBeInViewport({ ratio: 0.1 });
  await expect(openingHandoffForm.locator('[name="category"]')).toHaveValue("artisan");
  await expect(openingHandoffForm.locator('[name="vendorOfferingId"]')).toHaveValue("marketplace-booth");
  await expect(openingHandoffForm.locator('[name="organizationName"]')).toHaveValue("");
  await expect(openingHandoffForm.locator('[name="contactName"]')).toHaveValue("");
  await expect(openingHandoffForm.locator('[name="contactEmail"]')).toHaveValue("");
  await expect(openingHandoffForm.locator('[name="consentToContact"]')).not.toBeChecked();
  const galleryImages = page.locator("#media .media-gallery img");
  await expect(galleryImages).toHaveCount(8);
  for (let index = 0; index < await galleryImages.count(); index += 1) {
    await galleryImages.nth(index).scrollIntoViewIfNeeded();
  }
  await expect.poll(() => galleryImages.evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  await expect.poll(() => galleryImages.evaluateAll(images => images.every(image => new URL(image.currentSrc).pathname.includes("/assets/sandfest-media/optimized/gallery-")))).toBe(true);
  await expect.poll(() => galleryImages.evaluateAll(images => images.every(image => image.alt && !/^DSC/i.test(image.alt)))).toBe(true);
  const sponsorPackageCards = page.locator("#public-sponsor-tiers [data-package-id]");
  await expect(sponsorPackageCards).toHaveCount(11);
  expect(await sponsorPackageCards.locator("strong").allTextContents()).toEqual([
    "Flounder",
    "Trout",
    "Tarpon",
    "Sailfish",
    "Marlin",
    "Shark",
    "VIP Tent Sponsor",
    "Whale",
    "Giant Squid",
    "Megalodon",
    "The Kraken"
  ]);
  await expect(page.locator('[data-package-id="marlin"] span')).toHaveText("$15,000 sponsorship");
  await expect(page.locator('[data-package-id="whale"] span')).toHaveText("$50,000 sponsorship");
  await expect(page.locator('[data-package-id="the-kraken"] span')).toHaveText("$250,000 sponsorship");
  await expect(page.locator('[data-package-id="flounder"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-package-id="flounder"] [data-package-action]')).toHaveText("Selected");
  await expect(page.locator('[data-package-id="the-kraken"] [data-package-action]')).toHaveText("Choose tier");
  await page.locator('[data-package-id="the-kraken"]').click();
  await expect(page).toHaveURL(/#sponsor-inquiry-form$/);
  await expect(page.locator('#sponsor-inquiry-form [name="packageId"]')).toHaveValue("the-kraken");
  await expect(page.locator('#sponsor-inquiry-form [name="packageId"]')).toBeFocused();
  await assertTargetClearsTopbar(page, "#sponsor-inquiry-form", 12);
  await expect(page.locator('#sponsor-inquiry-form [name="packageId"]')).toHaveAttribute("aria-describedby", "sponsor-package-summary");
  await expect(page.locator('[data-package-id="flounder"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-package-id="flounder"] [data-package-action]')).toHaveText("Choose tier");
  await expect(page.locator('[data-package-id="the-kraken"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-package-id="the-kraken"] [data-package-action]')).toHaveText("Selected");
  await expect(page.locator("#sponsor-package-summary")).toContainText("Presenting sponsor recognition");
  await expect(page.locator("#sponsor-package-summary")).toContainText("$250,000 sponsorship");
  const sponsorSubmitBox = await page.locator('#sponsor-inquiry-form button[type="submit"]').boundingBox();
  const vendorSubmitBox = await page.locator('#vendor-application-form button[type="submit"]').boundingBox();
  expect(sponsorSubmitBox?.height).toBeGreaterThanOrEqual(40);
  expect(sponsorSubmitBox?.height).toBeLessThanOrEqual(52);
  expect(vendorSubmitBox?.height).toBe(sponsorSubmitBox?.height);
  const featuredSponsor = page.locator("#public-sponsor-showcase .public-sponsor-card").filter({ hasText: "Gulf Shore Credit Union" });
  const featuredSponsorStage = page.locator("#public-sponsor-featured");
  await expect(featuredSponsorStage).toBeVisible();
  await expect(featuredSponsorStage.locator("h3")).toHaveText("Backing the beach");
  await expect(page.locator("#public-sponsor-showcase")).toHaveAttribute("data-count", "1");
  expect(await featuredSponsorStage.evaluate((stage, packages) => Boolean(stage.compareDocumentPosition(packages) & Node.DOCUMENT_POSITION_FOLLOWING), await page.locator("#public-sponsor-tiers").elementHandle())).toBe(true);
  await expect(featuredSponsor).toHaveCount(1);
  await expect(featuredSponsor).toContainText("Marlin partner");
  await expect(featuredSponsor).toContainText("Rooted on the Texas coast");
  await expect(featuredSponsor).not.toContainText("Visit partner");
  await expect(featuredSponsor).not.toHaveAttribute("href", /.+/);
  const featuredSponsorLogo = featuredSponsor.locator("img");
  await expect(featuredSponsorLogo).toHaveAttribute("src", /\/api\/public\/sponsor-showcase\/assets\/demo_brand_asset_gulf_shore_primary$/);
  await expect.poll(() => featuredSponsorLogo.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);

  const conciergeResponsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === apiBase && url.pathname === "/api/public/concierge" && response.request().method() === "POST";
  });
  await page.locator("#ask-input").fill("Where can I buy tickets?");
  await page.locator("#ask-submit").click();
  const conciergeResponse = await conciergeResponsePromise;
  expect(conciergeResponse.status()).toBe(200);
  const conciergePayload = await conciergeResponse.json();
  expect(conciergePayload.topic).toBe("tickets");
  await expect(page.locator("#chat .concierge-answer")).toHaveCount(1);
  await expect(page.locator("#chat .concierge-answer")).toContainText("Current ticket options include");
  await expect(page.locator('#chat .concierge-sources a[href="#tickets"]')).toHaveText("Current ticket options");
  await expect(page.locator("#ask-submit")).toBeEnabled();

  await expect(page.locator("#ticketing-status-pill")).toHaveText("Local payment sandbox");
  await expect(page.locator("#ticketing-copy")).toContainText("No external charge is sent");
  const ticketPolicy = page.locator("#ticket-policy-fieldset");
  await expect(ticketPolicy).toBeVisible();
  await expect(ticketPolicy.locator("#ticket-policy-summary")).toHaveText("Review demonstration policies");
  await ticketPolicy.locator("#ticket-policy-summary").click();
  await expect(ticketPolicy.locator("[data-ticket-policy-notice]")).toHaveCount(4);
  await expect(ticketPolicy).toContainText("Demonstration refund policy");
  await expect(ticketPolicy.locator("#ticket-policy-label")).toContainText("demonstration ticket terms");
  const sponsorTicketRequest = page.locator('[data-ticket-request="sponsor-package-request"]');
  await expect(sponsorTicketRequest).toHaveText("Request review");
  await sponsorTicketRequest.click();
  await expect(page).toHaveURL(/#sponsor-inquiry-form$/);
  await expect(page.locator("#checkout-status")).toContainText("partnership form below");
  await expect(page.locator('#sponsor-inquiry-form [name="organizationName"]')).toBeFocused();
  await assertTargetClearsTopbar(page, "#sponsor-inquiry-form", 12);
  const demoGaCard = page.locator(".ticket-card").filter({ has: page.locator('[data-ticket-id="general-admission-3-day"]') });
  await expect(demoGaCard).toContainText("$30.00 demo");
  await expect(demoGaCard).toContainText("Demo checkout");
  await demoGaCard.locator('[data-ticket-action="increase"]').click();
  await demoGaCard.locator('[data-ticket-action="increase"]').click();
  await expect(page.locator("#ticket-subtotal")).toHaveText("$60.00");
  await expect(page.locator("#checkout-btn")).toBeDisabled();
  await ticketPolicy.locator("#ticket-policy-acceptance").check();
  await expect(page.locator("#checkout-btn")).toBeEnabled();
  const ticketBuyerEmail = `tickets.${runId}@example.com`;
  await page.locator("#checkout-email").fill(ticketBuyerEmail);
  const ticketCheckoutResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/stripe/create-checkout-session" && response.request().method() === "POST");
  await page.locator("#checkout-btn").click();
  const ticketCheckoutResult = await ticketCheckoutResponse;
  expect(ticketCheckoutResult.status()).toBe(200);
  expect(ticketCheckoutResult.request().postDataJSON().policyAcceptance).toMatchObject({
    accepted: true,
    version: "board-demo-2027-v1"
  });
  const ticketCheckout = await ticketCheckoutResult.json();
  expect(ticketCheckout.demoCheckout).toMatchObject({
    mode: "board_sandbox",
    amountCents: 6000,
    currency: "usd",
    completeEndpoint: "/api/public/board-ticket-checkout/complete"
  });
  expect(ticketCheckout.demoCheckout.lineItems).toHaveLength(1);
  expect(ticketCheckout.demoCheckout.lineItems[0]).toMatchObject({ productId: "general-admission-3-day", quantity: 2, unitAmount: 3000 });
  const demoTicketOrderId = ticketCheckout.orderId;
  await expect(page.locator("#ticket-demo-checkout")).toBeVisible();
  await expect(page.locator("#ticket-demo-amount")).toHaveText("$60.00 demo");
  await expect(page.locator("#ticket-demo-status")).toContainText("local board runtime");
  const ticketPaymentResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/board-ticket-checkout/complete" && response.request().method() === "POST");
  await page.locator("#ticket-demo-pay").click();
  const ticketPaymentResult = await ticketPaymentResponse;
  expect(ticketPaymentResult.status()).toBe(200);
  const ticketPayment = await ticketPaymentResult.json();
  expect(ticketPayment.order.status).toBe("paid");
  expect(ticketPayment.receipt).toMatchObject({
    orderId: demoTicketOrderId,
    amountCents: 6000,
    currency: "usd",
    fulfillmentCount: 2,
    environment: "board_sandbox"
  });
  await expect(page.locator("#ticket-demo-status")).toContainText("Demo payment complete");
  await expect(page.locator("#checkout-status")).toContainText("No external charge was sent");
  await expect(page.locator("#ticket-demo-pay")).toBeHidden();
  await expect(page.locator("#ticket-subtotal")).toHaveText("$0.00");
  await expect(ticketPolicy.locator("#ticket-policy-acceptance")).not.toBeChecked();

  const vendorConciergeResponsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === apiBase && url.pathname === "/api/public/concierge" && response.request().method() === "POST";
  });
  await page.locator("#ask-input").fill("How do vendors apply?");
  await page.locator("#ask-submit").click();
  const vendorConciergeResponse = await vendorConciergeResponsePromise;
  expect(vendorConciergeResponse.status()).toBe(200);
  const vendorConciergePayload = await vendorConciergeResponse.json();
  expect(vendorConciergePayload.topic).toBe("vendor");
  expect(vendorConciergePayload.answer).toContain("vendor application");
  expect(vendorConciergePayload.answer).not.toContain("interest list");
  await expect(page.locator("#chat .concierge-answer")).toHaveCount(2);
  await expect(page.locator("#chat .concierge-answer").last()).toContainText("vendor application");
  await expect(page.locator("#ask-submit")).toBeEnabled();

  const vendor = page.locator("#vendor-application-form");
  await expect(vendor).toBeVisible();
  const vendorPreset = vendor.locator('[data-board-partner-preset="vendor"]');
  await expect(vendorPreset).toHaveText("Use demo vendor");
  await vendorPreset.click();
  await expect(vendor.locator('[name="organizationName"]')).toHaveValue("Port A Coastal Makers");
  await expect(vendor.locator('[name="contactEmail"]')).toHaveValue(/^casey\.vendor\.[a-z0-9-]+@example\.com$/);
  await expect(vendor.locator('[name="contactPhone"]')).toHaveValue("+13615550132");
  await expect(vendor.locator('[name="category"]')).toHaveValue("artisan");
  await expect(vendor.locator('[name="vendorOfferingId"]')).toHaveValue("marketplace-booth");
  await expect(vendor.locator('[name="consentToContact"]')).not.toBeChecked();
  await expect(vendor.locator(".partner-form-status")).toHaveText("Synthetic details are ready. Contact consent remains unchecked.");
  await vendor.locator('[name="consentToContact"]').check();
  const vendorResult = await submitAndCapture(page, vendor, "/api/public/vendor-applications");
  await expect(vendor.locator(".partner-form-status")).toContainText("Application received.");
  await expect(page).toHaveURL(/#partner-status$/);
  await expect(page.locator("#partner-status-result")).toContainText(vendorName);
  await expect(page.locator("#partner-status-result")).toBeFocused();
  await assertTargetClearsTopbar(page, "#partner-status", 12);
  await expect(page.locator('#partner-status-form [name="reference"]')).toHaveValue(vendorResult.application.reference);
  await page.reload();
  await expect(page).toHaveURL(/#partner-status$/);
  await expect(page.locator("#partner-status-result")).toContainText(vendorName);
  await expect(page.locator("#partner-status-result")).toBeFocused();
  await assertTargetClearsTopbar(page, "#partner-status", 12);
  await expect(page.locator('#partner-status-form [name="reference"]')).toHaveValue(vendorResult.application.reference);
  const contactPreferenceForm = page.locator("#partner-contact-preference-form");
  await expect(contactPreferenceForm).toContainText("Application emails enabled");
  await expect(contactPreferenceForm.locator('[name="consentToContact"]')).toBeChecked();
  await contactPreferenceForm.locator('[name="consentToContact"]').uncheck();
  const pausedContactResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-contact-preferences" && response.request().method() === "POST");
  await contactPreferenceForm.locator('button[type="submit"]').click();
  expect((await pausedContactResponse).status()).toBe(200);
  await expect(contactPreferenceForm).toContainText("Application emails paused");
  await expect(contactPreferenceForm.locator('[name="consentToContact"]')).not.toBeChecked();
  await contactPreferenceForm.locator('[name="consentToContact"]').check();
  const resumedContactResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-contact-preferences" && response.request().method() === "POST");
  await contactPreferenceForm.locator('button[type="submit"]').click();
  expect((await resumedContactResponse).status()).toBe(200);
  await expect(contactPreferenceForm).toContainText("Application emails enabled");
  await expect(contactPreferenceForm.locator('[name="consentToContact"]')).toBeChecked();
  const freshVendorProfile = page.locator("#partner-vendor-profile-form");
  await expect(page.locator(".partner-vendor-center")).toContainText("0 / 5 requirements cleared");
  await expect(page.locator("[data-vendor-requirement]")).toHaveCount(5);
  await freshVendorProfile.locator('[name="legalName"]').fill(`${vendorName} LLC`);
  await freshVendorProfile.locator('[name="boothName"]').fill(vendorName);
  await freshVendorProfile.locator('[name="website"]').fill(`https://vendors.example.com/${runId}`);
  await freshVendorProfile.locator('[name="powerNeed"]').selectOption("20a");
  await freshVendorProfile.locator('[name="vehicleLengthFeet"]').fill("18");
  await freshVendorProfile.locator('[name="emergencyContactName"]').fill("Jordan Boardwalk");
  await freshVendorProfile.locator('[name="emergencyContactPhone"]').fill("361-555-0188");
  await freshVendorProfile.locator('[name="publicDescription"]').fill("Original coastal artwork made in Port Aransas and sold from a standard marketplace booth.");
  await freshVendorProfile.locator('[name="accessibilityNotes"]').fill("Keep the customer-facing aisle clear for mobility devices.");
  const vendorProfileResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-vendor-profile" && response.request().method() === "POST");
  await freshVendorProfile.locator('button[type="submit"]').click();
  expect((await vendorProfileResponse).status()).toBe(200);
  await expect(page.locator('#partner-vendor-profile-form [data-status="submitted"]')).toHaveText("submitted");
  await expect(page.locator("#partner-status-form .partner-form-status")).toContainText("Operating profile submitted for review.");

  for (let index = 0; index < 5; index += 1) {
    const requirementForm = page.locator("[data-submit-vendor-document]").first();
    await requirementForm.locator('[name="sourceUrl"]').fill(`https://documents.example.com/${runId}/requirement-${index + 1}.pdf`);
    const vendorDocumentResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-vendor-documents" && response.request().method() === "POST");
    await requirementForm.locator('button[type="submit"]').click();
    expect((await vendorDocumentResponse).status()).toBe(201);
    await expect(page.locator("[data-submit-vendor-document]")).toHaveCount(4 - index);
  }
  await expect(page.locator('[data-vendor-requirement] [data-status="submitted"]')).toHaveCount(5);
  await expect(page.locator("#partner-status-form .partner-form-status")).toContainText("Vendor document submitted for staff review.");

  await page.locator('[data-package-id="tarpon"]').click();
  const sponsor = page.locator("#sponsor-inquiry-form");
  const sponsorPreset = sponsor.locator('[data-board-partner-preset="sponsor"]');
  await expect(sponsorPreset).toHaveText("Use demo sponsor");
  await sponsorPreset.click();
  await expect(sponsor.locator('[name="organizationName"]')).toHaveValue("Coastal Community Bank");
  await expect(sponsor.locator('[name="contactEmail"]')).toHaveValue(/^morgan\.sponsor\.[a-z0-9-]+@example\.com$/);
  await expect(sponsor.locator('[name="contactPhone"]')).toHaveValue("+13615550131");
  await expect(sponsor.locator('[name="packageId"]')).toHaveValue("tarpon");
  await expect(sponsor.locator('[name="consentToContact"]')).not.toBeChecked();
  await expect(sponsor.locator(".partner-form-status")).toHaveText("Synthetic details are ready. Contact consent remains unchecked.");
  const sponsorRecipient = await sponsor.locator('[name="contactEmail"]').inputValue();
  await sponsor.locator('[name="consentToContact"]').check();
  const sponsorResult = await submitAndCapture(page, sponsor, "/api/public/sponsor-inquiries");
  await expect(sponsor.locator(".partner-form-status")).toContainText("Application received.");
  await expect(page.locator("#partner-status-result")).toContainText(sponsorName);
  await expect(page.locator('#partner-status-form [name="reference"]')).toHaveValue(sponsorResult.application.reference);
  const sponsorBrandProfile = page.locator("#partner-brand-profile-form");
  const sponsorBrandPreview = page.locator("#partner-brand-preview");
  await expect(sponsorBrandPreview.locator("[data-brand-preview-name]")).toHaveText(sponsorName);
  await expect(sponsorBrandPreview.locator("[data-brand-preview-tagline]")).toHaveText("Sponsor tagline");
  await sponsorBrandProfile.locator('[name="tagline"]').fill("Healthier coast, stronger community");
  await sponsorBrandProfile.locator('[name="primaryColor"]').fill("#0A6570");
  await sponsorBrandProfile.locator('[data-brand-color-picker="secondaryColor"]').fill("#F2C94C");
  await expect(sponsorBrandProfile.locator('[name="secondaryColor"]')).toHaveValue("#F2C94C");
  await expect(sponsorBrandPreview.locator("[data-brand-preview-tagline]")).toHaveText("Healthier coast, stronger community");
  await expect(sponsorBrandPreview).toHaveCSS("background-color", "rgb(10, 101, 112)");
  await expect(sponsorBrandPreview.locator('[data-brand-preview-color="secondary"]')).toHaveCSS("background-color", "rgb(242, 201, 76)");
  const sponsorBrandValidity = await sponsorBrandProfile.evaluate(form => ({
    valid: form.checkValidity(),
    invalidFields: [...form.elements]
      .filter(field => field.willValidate && !field.checkValidity())
      .map(field => ({ name: field.name || field.type, message: field.validationMessage }))
  }));
  expect(sponsorBrandValidity, JSON.stringify(sponsorBrandValidity)).toEqual({ valid: true, invalidFields: [] });
  const sponsorBrandProfileResponse = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/public/partner-brand-profile"
    && response.request().method() === "POST"
  ), { timeout: 15_000 });
  await sponsorBrandProfile.locator('button[type="submit"]').click();
  expect((await sponsorBrandProfileResponse).status()).toBe(200);
  await expect(page.locator("#partner-status-form .partner-form-status")).toContainText("Brand profile submitted for review.");
  await expect(page.locator('#partner-brand-profile-form [data-status="submitted"]')).toHaveText("submitted");
  await expect(page.locator("#partner-brand-preview")).toHaveAttribute("aria-label", new RegExp(`${sponsorName} brand preview.*#0A6570.*#F2C94C`));
  const sponsorBrandAsset = page.locator("#partner-brand-asset-form");
  await sponsorBrandAsset.locator('[name="kind"]').selectOption("primary_logo");
  await sponsorBrandAsset.locator('[name="label"]').fill("Primary community health logo");
  await sponsorBrandAsset.locator('[name="file"]').setInputFiles({
    name: `browser-coastal-health-${runId}.png`,
    mimeType: "image/png",
    buffer: await readFile(path.join(ROOT, "docs", "board-demo-assets", "gulf-shore-credit-union-logo.png"))
  });
  const sponsorBrandAssetResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-brand-assets/upload" && response.request().method() === "POST");
  await sponsorBrandAsset.locator('button[type="submit"]').click();
  const uploadedSponsorBrandAssetResponse = await sponsorBrandAssetResponse;
  expect(uploadedSponsorBrandAssetResponse.status()).toBe(201);
  const uploadedSponsorBrandAsset = (await uploadedSponsorBrandAssetResponse.json()).asset;
  expect(uploadedSponsorBrandAsset.sourceType).toBe("upload");
  expect(uploadedSponsorBrandAsset).not.toHaveProperty("storageKey");
  await expect(page.locator("#partner-status-form .partner-form-status")).toContainText("Brand asset submitted for review.");
  await expect(page.locator(`[data-partner-brand-asset="${uploadedSponsorBrandAsset.id}"]`)).toContainText("Primary community health logo");
  await expect(page.locator(`[data-partner-brand-asset="${uploadedSponsorBrandAsset.id}"] [data-status="submitted"]`)).toHaveText("submitted");

  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-partners`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await assertAnchorClearsWorkspaceNav(page, "#admin-partners", 4);
  await expect(page).toHaveTitle("Texas SandFest Operations");
  await expect(page.locator("#network-status")).toHaveText("Demo");
  await expect(page.locator("#runtime-data-notice")).toContainText("Synthetic 2027 data");
  await expect(page.locator("#runtime-data-notice")).toContainText("No external messages, charges, or live-provider calls");
  await expect(page.locator("#admin-reset-board-demo")).toBeHidden();
  await expect(page.locator("header nav")).toHaveCount(0);
  await expect(page.locator(".admin-workspace-nav")).toBeVisible();
  await expect(page.locator(".admin-api-bar")).toBeHidden();
  await expect(page.locator("#admin-config h1")).toHaveText("Festival operations command center");
  await expect(page.locator(".nav-cta")).toHaveAttribute("href", `${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
  await expect(page.locator("#admin-deployment-summary")).toContainText("board demo · ready · live providers post-board");
  await expect(page.locator("#admin-ticket-policy-state")).toHaveText("Approved");
  await expect(page.locator('#admin-ticket-policy-form [name="version"]')).toHaveValue("board-demo-2027-v1");
  await expect(page.locator("#admin-ticket-policy-readiness")).toContainText("approved for checkout");
  await expect(page.locator("#admin-ticket-policy-notices textarea")).toHaveCount(4);
  const scheduleRows = page.locator("#admin-event-schedule-rows .admin-event-schedule-row");
  await expect(page.locator("#admin-event-schedule-readiness")).toContainText("3 synthetic schedule items are isolated to the board demonstration.");
  await expect(scheduleRows).toHaveCount(3);
  await expect(scheduleRows.first().locator('[name="title"]')).toHaveValue("Beach gates open");
  await page.locator("#admin-add-event-schedule-item").click();
  await expect(scheduleRows).toHaveCount(4);
  const draftScheduleRow = scheduleRows.last();
  await expect(draftScheduleRow.locator('[name="day"]')).toHaveValue("Friday");
  await expect(draftScheduleRow.locator('[name="category"]')).toHaveValue("Program");
  await draftScheduleRow.locator('[name="title"]').fill("Browser schedule draft");
  await draftScheduleRow.locator("[data-remove-event-schedule-item]").click();
  await expect(scheduleRows).toHaveCount(3);
  const activationBoundary = page.locator("#admin-board-stage-summary");
  await expect(activationBoundary.locator('[data-board-stage="presentation-ready"]')).toContainText("Real workflows with synthetic providers");
  await expect(activationBoundary.locator('[data-board-stage="post-presentation"]')).toContainText("Stripe, QuickBooks, Brevo, Twilio, NWS, TxDOT, eight webcam edge agents, OIDC, Turnstile, DNS, and managed recovery");
  await expect(page.locator("#admin-load-partners")).toHaveText("Refresh partner workspace");
  await expect(page.locator("#admin-load-conditions")).toHaveText("Refresh island operations");
  await expect(page.locator("#admin-island-conditions > strong").first()).toHaveText("Source health");
  await expect(page.locator("#admin-condition-feeds")).toContainText("Simulated · Current");
  await expect(page.locator("#admin-condition-feeds")).not.toContainText("Live · Live");
  const operationsWorkspaceLayout = await page.locator(".admin-conditions-columns").evaluate(container => {
    const outreach = container.querySelector("#admin-outreach-prospects-workspace")?.getBoundingClientRect();
    const conditions = container.querySelector("#admin-island-conditions")?.getBoundingClientRect();
    const bounds = container.getBoundingClientRect();
    return {
      bounds: { left: bounds.left, right: bounds.right },
      outreach: outreach ? { bottom: outreach.bottom } : null,
      conditions: conditions ? { left: conditions.left, right: conditions.right, top: conditions.top } : null
    };
  });
  expect(operationsWorkspaceLayout.outreach).not.toBeNull();
  expect(operationsWorkspaceLayout.conditions).not.toBeNull();
  expect(Math.abs(operationsWorkspaceLayout.conditions.left - operationsWorkspaceLayout.bounds.left)).toBeLessThan(1);
  expect(Math.abs(operationsWorkspaceLayout.conditions.right - operationsWorkspaceLayout.bounds.right)).toBeLessThan(1);
  expect(operationsWorkspaceLayout.conditions.top).toBeGreaterThanOrEqual(operationsWorkspaceLayout.outreach.bottom + 13);
  const smsPreference = page.locator("#admin-board-sms-preference");
  const smsPreferenceStatus = page.locator("#admin-board-sms-preference-status");
  const smsSafetyKpi = page.locator("#admin-consent-kpis article").filter({ hasText: "SMS safety" });
  const stopSmsPreference = smsPreference.locator('[data-board-sms-preference="STOP"]');
  const startSmsPreference = smsPreference.locator('[data-board-sms-preference="START"]');
  await expect(smsPreference).toBeVisible();
  await expect(smsPreferenceStatus).toHaveText("Opted in · 0 signed sandbox callbacks");
  await expect(smsSafetyKpi.locator("strong")).toHaveText("1");
  await expect(stopSmsPreference).toBeEnabled();
  await expect(startSmsPreference).toBeDisabled();
  await expect(smsPreference).not.toContainText("+13615550188");
  const stopPreferenceResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/board-demo/sms-preference" && response.request().method() === "POST");
  await stopSmsPreference.click();
  expect((await stopPreferenceResponse).status()).toBe(200);
  await expect(smsPreferenceStatus).toHaveText("Opted out · 1 signed sandbox callback");
  await expect(smsSafetyKpi.locator("strong")).toHaveText("0");
  await expect(stopSmsPreference).toBeDisabled();
  await expect(startSmsPreference).toBeEnabled();
  const startPreferenceResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/board-demo/sms-preference" && response.request().method() === "POST");
  await startSmsPreference.click();
  expect((await startPreferenceResponse).status()).toBe(200);
  await expect(smsPreferenceStatus).toHaveText("Opted in · 2 signed sandbox callbacks");
  await expect(smsSafetyKpi.locator("strong")).toHaveText("1");
  await expect(stopSmsPreference).toBeEnabled();
  await expect(startSmsPreference).toBeDisabled();
  const partnerKpis = page.locator("#admin-partner-kpis");
  await expect(partnerKpis.locator("article").filter({ hasText: "Received" })).toContainText("1 active payment");
  await expect(partnerKpis.locator("article").filter({ hasText: "Received" })).toContainText("0 accounts paid in full");
  await expect(partnerKpis.locator("article").filter({ hasText: "QuickBooks" })).toContainText("Post-board");
  await expect(partnerKpis.locator("article").filter({ hasText: "Online invoices" })).toContainText("Local sandbox");
  await expect(partnerKpis.locator("article").filter({ hasText: "Online invoices" })).toContainText("Stripe post-board");
  const messagingKpi = partnerKpis.locator("article").filter({ hasText: "Messaging" });
  await expect(messagingKpi).toContainText("Review first");
  await expect(messagingKpi).toContainText(/\d+ drafts? awaiting staff review/);
  const impactReport = page.locator("#admin-impact-report");
  await expect(impactReport.locator("#admin-impact-highlights > article")).toHaveCount(6);
  await expect(impactReport.locator("#admin-impact-sections > article")).toHaveCount(8);
  await expect(impactReport).toContainText("Revenue and stewardship");
  await expect(impactReport).toContainText("Volunteer impact");
  await expect(impactReport).toContainText("Sponsor benefits complete");
  await expect(impactReport).toContainText("People's Choice votes");
  await expect(impactReport).not.toContainText("@");
  await expect(page.locator('#admin-export-type option[value="impact.csv"]')).toHaveCount(1);
  const [impactDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#admin-download-impact").click()
  ]);
  expect(impactDownload.suggestedFilename()).toBe(`${DEFAULT_EVENT_ID}-board-impact.csv`);
  const attendanceList = page.locator("#admin-volunteer-attendance");
  await expect(attendanceList.locator("[data-volunteer-assignment]")).toHaveCount(38);
  const activeAttendance = attendanceList.locator('[data-attendance-status="checked_in"]').first();
  const activeAttendanceId = await activeAttendance.getAttribute("data-volunteer-assignment");
  await expect(activeAttendance.getByRole("button", { name: "Check out" })).toBeEnabled();
  const volunteerCheckOutResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/volunteers/attendance" && response.request().method() === "POST");
  await activeAttendance.getByRole("button", { name: "Check out" }).click();
  expect((await volunteerCheckOutResponse).status()).toBe(200);
  await expect(attendanceList.locator(`[data-volunteer-assignment="${activeAttendanceId}"]`)).toHaveAttribute("data-attendance-status", "checked_out");
  const scheduledAttendance = attendanceList.locator('[data-attendance-status="scheduled"]').first();
  const scheduledAttendanceId = await scheduledAttendance.getAttribute("data-volunteer-assignment");
  await expect(scheduledAttendance.getByRole("button", { name: "Check in" })).toBeEnabled();
  const volunteerCheckInResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/volunteers/attendance" && response.request().method() === "POST");
  await scheduledAttendance.getByRole("button", { name: "Check in" }).click();
  expect((await volunteerCheckInResponse).status()).toBe(200);
  await expect(attendanceList.locator(`[data-volunteer-assignment="${scheduledAttendanceId}"]`)).toHaveAttribute("data-attendance-status", "checked_in");
  await expect(page.locator("#admin-volunteers-kpis").getByText("1 in", { exact: false })).toBeVisible();
  const budgetKpis = page.locator("#admin-budget-kpis");
  await expect(budgetKpis.locator("article").filter({ hasText: "Annual budget" })).toContainText("$530,000.00");
  await expect(budgetKpis.locator("article").filter({ hasText: "Committed" })).toContainText("$186,400.00");
  await expect(budgetKpis.locator("article").filter({ hasText: "Awaiting approval" })).toContainText("$92,000.00");
  await expect(page.locator("#admin-budget-lines [data-budget-line]")).toHaveCount(6);
  await expect(page.locator("#admin-expense-list [data-budget-expense]")).toHaveCount(7);
  await expect(page.locator('#admin-expense-list [data-expense-status="submitted"]')).toHaveCount(2);
  await expect(page.locator('#admin-expense-list [data-expense-status="approved"]')).toHaveCount(2);
  await expect(page.locator('#admin-expense-list [data-expense-status="paid"]')).toHaveCount(2);
  await expect(page.locator('#admin-expense-list [data-expense-status="rejected"]')).toHaveCount(1);
  const accountingExports = page.locator('#admin-export-type option[value="budget.csv"], #admin-export-type option[value="expenses.csv"]');
  await expect(accountingExports).toHaveCount(2);
  await page.locator("#admin-export-type").selectOption("budget.csv");
  const [budgetDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#admin-download-export").click()
  ]);
  expect(budgetDownload.suggestedFilename()).toBe(`${DEFAULT_EVENT_ID}-budget-allocations.csv`);
  await page.locator("#admin-export-type").selectOption("expenses.csv");
  const [expenseDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#admin-download-export").click()
  ]);
  expect(expenseDownload.suggestedFilename()).toBe(`${DEFAULT_EVENT_ID}-expense-register.csv`);
  await expect(page.locator("#admin-budget")).not.toContainText(/RAMP-DEMO|budget_line_|expense_/);

  const budgetLineForm = page.locator("#admin-create-budget-line");
  await budgetLineForm.locator('[name="name"]').fill(budgetLineName);
  await budgetLineForm.locator('[name="ownerTeam"]').selectOption("guest-services");
  await budgetLineForm.locator('[name="amount"]').fill("2500.00");
  await budgetLineForm.locator('[name="notes"]').fill("Browser acceptance allocation");
  const budgetLineResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/budget/lines" && response.request().method() === "POST");
  await budgetLineForm.locator('button[type="submit"]').click();
  const budgetLineResult = await budgetLineResponse;
  expect(budgetLineResult.status()).toBe(201);
  const createdBudgetLine = (await budgetLineResult.json()).line;
  const budgetLineCard = () => page.locator(`#admin-budget-lines [data-budget-line="${createdBudgetLine.id}"]`);
  await expect(budgetLineCard()).toContainText(budgetLineName);
  await budgetLineCard().locator('[name="amount"]').fill("3000.00");
  await budgetLineCard().locator('[name="changeNote"]').fill("Board browser acceptance approved this allocation change.");
  const budgetLineUpdateResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/budget/lines/${createdBudgetLine.id}` && response.request().method() === "PATCH");
  await budgetLineCard().locator('button[type="submit"]').click();
  expect((await budgetLineUpdateResponse).status()).toBe(200);
  await expect(budgetLineCard()).toContainText("$3,000.00");

  const expenseForm = page.locator("#admin-create-expense");
  await expenseForm.locator('[name="budgetLineId"]').selectOption(createdBudgetLine.id);
  await expenseForm.locator('[name="vendorName"]').fill(budgetVendorName);
  await expenseForm.locator('[name="amount"]').fill("1200.00");
  await expenseForm.locator('[name="dueDate"]').fill("2027-03-20");
  await expenseForm.locator('[name="description"]').fill("Browser acceptance guest service equipment");
  const expenseResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/budget/expenses" && response.request().method() === "POST");
  await expenseForm.locator('button[type="submit"]').click();
  const expenseResult = await expenseResponse;
  expect(expenseResult.status()).toBe(201);
  const createdExpense = (await expenseResult.json()).expense;
  const expenseCard = () => page.locator(`#admin-expense-list [data-budget-expense="${createdExpense.id}"]`);
  await expect(expenseCard()).toHaveAttribute("data-expense-status", "submitted");
  const expenseApprovalResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/budget/expenses/${createdExpense.id}/approve` && response.request().method() === "POST");
  await expenseCard().locator('[data-expense-action="approve"]').click();
  expect((await expenseApprovalResponse).status()).toBe(200);
  await expect(expenseCard()).toHaveAttribute("data-expense-status", "approved");
  await expenseCard().locator('[data-expense-payment-method]').selectOption("ach");
  await expenseCard().locator('[data-expense-payment-reference]').fill(`BROWSER-PRIVATE-${runId}`);
  const expensePaymentResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/budget/expenses/${createdExpense.id}/mark-paid` && response.request().method() === "POST");
  await expenseCard().locator('[data-expense-action="mark-paid"]').click();
  expect((await expensePaymentResponse).status()).toBe(200);
  await expect(expenseCard()).toHaveAttribute("data-expense-status", "paid");
  await expect(expenseCard()).toContainText("ACH payment recorded");
  await expect(expenseCard()).not.toContainText(`BROWSER-PRIVATE-${runId}`);
  const commandSignals = page.locator("#admin-command-signals");
  await expect(commandSignals).toHaveAttribute("aria-busy", "false");
  await expect(commandSignals.locator("[data-command-signal]")).toHaveCount(8);
  await expect(commandSignals.locator('[data-command-signal="applications"]')).toContainText(/\d+ active/);
  await expect(commandSignals.locator('[data-command-signal="applications"]')).toContainText(/\d+ vendors/);
  await expect(commandSignals.locator('[data-command-signal="receivables"]')).toContainText("received of");
  await expect(commandSignals.locator('[data-command-signal="messages"]')).toContainText("Provider ready");
  await expect(commandSignals.locator('[data-command-signal="messages"]')).toContainText("staff review required");
  await expect(commandSignals.locator('[data-command-signal="assignments"]')).toContainText("staff / volunteer / team");
  await expect(commandSignals.locator('[data-command-signal="key-dates"]')).toContainText("upcoming");
  await expect(commandSignals.locator('[data-command-signal="key-dates"]')).toContainText(/[1-9]\d* due soon/);
  await expect(commandSignals.locator('[data-command-signal="sponsors"]')).toContainText("assets approved");
  await expect(commandSignals.locator('[data-command-signal="vendors"]')).toContainText("blocked");
  await expect(commandSignals.locator('[data-command-signal="outreach"]')).toContainText("qualified");
  const partnerActivity = page.locator("#admin-partner-activity");
  const partnerActivityRows = partnerActivity.locator("[data-partner-activity]");
  expect(await partnerActivityRows.count()).toBeGreaterThanOrEqual(15);
  await expect(page.locator("#admin-partner-activity-summary")).toContainText("recorded events");
  for (const category of ["intake", "finance", "schedule", "messaging", "work", "branding", "vendor", "outreach"]) {
    await expect(partnerActivity.locator(`[data-category="${category}"]`).first()).toBeVisible();
  }
  await expect(partnerActivity).toContainText("Payment recorded");
  await expect(partnerActivity).toContainText("Invoice created");
  await expect(partnerActivity).toContainText(/assignment notices prepared/i);
  await expect(partnerActivity).toContainText("Brand profile approved");
  expect(await partnerActivity.textContent()).not.toMatch(/activity_|demo_[sv]app|followup_/);
  const partnerMessages = page.locator("#admin-partner-followups");
  await expect(partnerMessages).toContainText(`Texas SandFest vendor application ${vendorResult.application.reference}`);
  await expect(partnerMessages).toContainText(`Texas SandFest sponsorship application ${sponsorResult.application.reference}`);
  await expect(partnerMessages).not.toContainText(`review application reminder - ${vendorResult.application.reference}`);
  await expect(partnerMessages).not.toContainText(`qualify opportunity reminder - ${sponsorResult.application.reference}`);
  const deferredRecovery = page.locator('#admin-deployment-checks [data-board-stage="post-presentation"]');
  await expect(deferredRecovery).toHaveCount(1);
  await expect(deferredRecovery).toContainText("Post-board");
  await expect(deferredRecovery).toContainText("Backup and recovery");
  await expect(deferredRecovery).toContainText("Managed backup provisioning and provider restore drills are scheduled after the presentation.");
  await expect(deferredRecovery).toContainText("Isolated database and upload recovery verification remains in the release gate.");
  await expect(deferredRecovery).not.toContainText("configure a supported managed backup provider");
  const transactionRegions = page.locator("#admin-system-monitor .admin-record-list");
  await expect(transactionRegions).toHaveCount(5);
  expect(await transactionRegions.evaluateAll(regions => regions.every(region => region.getAttribute("role") === "region" && region.tabIndex === 0))).toBe(true);
  const automationRegion = page.locator("#admin-job-list");
  await expect(automationRegion).toHaveAttribute("role", "region");
  await expect(automationRegion).toHaveAttribute("tabindex", "0");
  const automationRows = automationRegion.locator("[data-automation-row]");
  const automationRowCount = await automationRows.count();
  const representedAutomationJobs = await automationRows.evaluateAll(rows => rows.reduce((total, row) => total + Number(row.dataset.jobCount || 1), 0));
  const completedGroupCount = await automationRegion.locator('[data-job-group="completed"]').count();
  expect(automationRowCount).toBeGreaterThan(0);
  expect(representedAutomationJobs).toBeGreaterThan(automationRowCount);
  expect(completedGroupCount).toBeGreaterThan(0);
  await expect(automationRegion.locator('[data-job-status="done"]')).toHaveCount(automationRowCount);
  await expect(automationRegion).toContainText("completed runs");
  await expect(automationRegion).toContainText("Open Message drafts");
  await expect(automationRegion).toContainText(/Partner message (preparation|delivery)/);
  await expect(automationRegion).not.toContainText(/job_|followup_|@/);
  await expect(page.locator("#admin-job-summary")).toContainText(`${representedAutomationJobs} complete`);
  await expect(page.locator("#admin-job-summary")).toContainText("0 need review");
  const initialTransactionRefresh = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/audit" && response.request().method() === "GET");
  await page.locator("#admin-load-orders").click();
  expect((await initialTransactionRefresh).status()).toBe(200);
  const systemMonitor = page.locator("#admin-system-monitor");
  expect(await page.locator("#admin-audit-list [data-audit-action]").count()).toBeGreaterThan(0);
  await expect(page.locator("#admin-audit-list")).not.toContainText("EmailDeliveryWebhook");
  await expect(systemMonitor.locator(".admin-record-card code")).toHaveCount(0);
  await expect(systemMonitor).not.toContainText(/data\/processed|db:\/\/|admin-audit\//);
  const auditRegionMetrics = await page.locator("#admin-audit-list").evaluate(region => ({
    clientHeight: region.clientHeight,
    scrollHeight: region.scrollHeight
  }));
  expect(auditRegionMetrics.clientHeight).toBeLessThanOrEqual(560);
  const paidTicketOrderCard = () => page.locator(`#admin-order-list [data-ticket-order="${demoTicketOrderId}"]`);
  await expect(paidTicketOrderCard()).toHaveCount(1);
  await expect(paidTicketOrderCard()).toContainText("paid");
  await expect(paidTicketOrderCard()).toContainText("$60.00");
  await expect(paidTicketOrderCard()).toContainText(ticketBuyerEmail);
  await expect(paidTicketOrderCard()).toContainText("local sandbox");
  await expect(paidTicketOrderCard()).toContainText("Policy board-demo-2027-v1 accepted");
  await expect(paidTicketOrderCard().locator("[data-refund-board-ticket]")).toHaveText("Refund demo order");
  const paidTicketFulfillment = page.locator("#admin-fulfillment-list [data-fulfillment-id]").filter({ hasText: demoTicketOrderId });
  await expect(paidTicketFulfillment).toHaveCount(2);
  expect(await paidTicketFulfillment.locator("select").evaluateAll(selects => selects.map(select => select.value))).toEqual(["queued", "queued"]);
  const paidTicketEvent = page.locator("#admin-payment-event-list .admin-record-card").filter({ hasText: "checkout.session.completed" });
  await expect(paidTicketEvent).toHaveCount(1);
  await expect(paidTicketEvent).toContainText("isolated_board_payment_sandbox");
  const paidTicketRevenueResponse = await fetch(`${apiBase}/api/admin/revenue`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(paidTicketRevenueResponse.status).toBe(200);
  const paidTicketRevenue = await paidTicketRevenueResponse.json();
  const paidTicketRevenueEntries = paidTicketRevenue.entries?.filter(item => item.sourceRecordId === demoTicketOrderId) || [];
  expect(paidTicketRevenueEntries).toHaveLength(1);
  expect(paidTicketRevenueEntries[0]).toMatchObject({
    category: "ticket",
    source: "manual",
    grossCents: 6000,
    netCents: 6000,
    quantity: 2,
    origin: "board_ticket_sandbox",
    entryType: "receipt"
  });
  expect(paidTicketRevenue.summary.tickets.sold).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#admin-revenue-updated")).toContainText("ticket ledger");
  page.once("dialog", dialog => dialog.accept());
  const ticketRefundResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/board-demo/ticket-orders/${demoTicketOrderId}/refund` && response.request().method() === "POST");
  await paidTicketOrderCard().locator("[data-refund-board-ticket]").click();
  const ticketRefundResult = await ticketRefundResponse;
  expect(ticketRefundResult.status()).toBe(200);
  expect((await ticketRefundResult.json()).order.status).toBe("refunded");
  await expect(paidTicketOrderCard()).toContainText("refunded");
  await expect(paidTicketOrderCard().locator("[data-refund-board-ticket]")).toHaveCount(0);
  const refundedTicketFulfillment = page.locator("#admin-fulfillment-list [data-fulfillment-id]").filter({ hasText: demoTicketOrderId });
  await expect(refundedTicketFulfillment).toHaveCount(2);
  expect(await refundedTicketFulfillment.locator("select").evaluateAll(selects => selects.map(select => select.value))).toEqual(["refunded", "refunded"]);
  const refundTicketEvent = page.locator("#admin-payment-event-list .admin-record-card").filter({ hasText: "charge.refunded" });
  await expect(refundTicketEvent).toHaveCount(1);
  await expect(refundTicketEvent).toContainText("isolated_board_payment_sandbox");
  const refundedTicketRevenueResponse = await fetch(`${apiBase}/api/admin/revenue`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(refundedTicketRevenueResponse.status).toBe(200);
  const refundedTicketRevenue = await refundedTicketRevenueResponse.json();
  const refundedTicketRevenueEntries = refundedTicketRevenue.entries?.filter(item => item.sourceRecordId === demoTicketOrderId) || [];
  expect(refundedTicketRevenueEntries).toHaveLength(2);
  expect(refundedTicketRevenueEntries.find(item => item.entryType === "refund")).toMatchObject({ grossCents: -6000, netCents: -6000, quantity: -2 });
  expect(refundedTicketRevenue.summary.tickets.sold).toBe(paidTicketRevenue.summary.tickets.sold - 2);
  expect(refundedTicketRevenue.summary.totals.refundCents).toBe(paidTicketRevenue.summary.totals.refundCents + 6000);
  await expect(commandSignals.locator('[data-command-signal="receivables"]')).toHaveAttribute("href", "#admin-receivables-workspace");
  await expect(commandSignals.locator('[data-command-signal="vendors"]')).toHaveAttribute("href", "#admin-vendor-readiness-workspace");
  await commandSignals.locator('[data-command-signal="vendors"]').click();
  await expect(page).toHaveURL(/#admin-vendor-readiness-workspace$/);
  await expect(page.locator("#admin-vendor-readiness-workspace")).toBeInViewport({ ratio: 0.1 });
  async function openPreparedPartnerPortal(organizationName) {
    const application = page.locator("#admin-partner-applications [data-partner-application]").filter({ hasText: organizationName });
    await expect(application).toHaveCount(1);
    const popupPromise = page.waitForEvent("popup");
    const rotationPromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === apiBase && /\/api\/admin\/partners\/applications\/[^/]+\/portal-access$/.test(url.pathname) && response.request().method() === "POST";
    });
    await application.locator("[data-open-demo-portal]").click();
    const [portal, rotation] = await Promise.all([popupPromise, rotationPromise]);
    expect(rotation.status()).toBe(200);
    await expect(portal.locator("#partner-status-result")).toContainText(organizationName);
    await expect(portal.locator("#partner-status")).toBeInViewport({ ratio: 0.1 });
    await expect.poll(() => portal.url()).not.toContain("token=");
    const sanitizedUrl = new URL(portal.url());
    expect(sanitizedUrl.hash).toBe("#partner-status");
    expect(sanitizedUrl.searchParams.get("apiBase")).toBe(apiBase);
    return portal;
  }

  const freshVendorAccount = () => page.locator(`#admin-vendor-readiness [data-admin-vendor="${vendorResult.application.id}"]`);
  await expect(freshVendorAccount()).toHaveCount(1);
  await expect(freshVendorAccount()).toHaveAttribute("data-status", "in_progress");
  await expect(freshVendorAccount()).toContainText("0/5 compliance");
  await expect(freshVendorAccount()).toContainText("submitted profile");
  const profileApprovalResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/applications/${vendorResult.application.id}/vendor-profile/review` && response.request().method() === "POST");
  await freshVendorAccount().locator('[data-review-vendor-profile="approve"]').click();
  expect((await profileApprovalResponse).status()).toBe(200);
  await expect(freshVendorAccount().locator('[data-admin-vendor-profile] [data-status="approved"]')).toHaveText("approved");

  const freshRequirementIds = await freshVendorAccount().locator("[data-admin-vendor-requirement]").evaluateAll(rows => rows.map(row => row.dataset.adminVendorRequirement));
  expect(freshRequirementIds).toHaveLength(5);
  for (const requirementId of freshRequirementIds) {
    const requirementRow = () => freshVendorAccount().locator(`[data-admin-vendor-requirement="${requirementId}"]`);
    await requirementRow().locator('[name="status"]').selectOption("approved");
    const requirementApprovalResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/vendor-requirements/${requirementId}` && response.request().method() === "PATCH");
    await requirementRow().locator("[data-save-vendor-requirement]").click();
    expect((await requirementApprovalResponse).status()).toBe(200);
    await expect(requirementRow().locator('header [data-status="approved"]')).toHaveText("approved");
  }
  await expect(freshVendorAccount()).toContainText("5/5 compliance");

  const freshVendorAssignment = () => freshVendorAccount().locator("[data-admin-vendor-assignment]");
  await freshVendorAssignment().locator('[name="status"]').selectOption("scheduled");
  await freshVendorAssignment().locator('[name="boothNumber"]').fill("A-27");
  await freshVendorAssignment().locator('[name="zone"]').fill("Artisan promenade");
  await freshVendorAssignment().locator('[name="accessGate"]').fill("South access gate");
  await freshVendorAssignment().locator('[name="loadInStart"]').fill("2027-04-16T08:00");
  await freshVendorAssignment().locator('[name="loadInEnd"]').fill("2027-04-16T09:00");
  await freshVendorAssignment().locator('[name="loadOutStart"]').fill("2027-04-18T18:00");
  await freshVendorAssignment().locator('[name="loadOutEnd"]').fill("2027-04-18T19:00");
  await freshVendorAssignment().locator('[name="parkingPasses"]').fill("1");
  await freshVendorAssignment().locator('[name="staffWristbands"]').fill("2");
  await freshVendorAssignment().locator('[name="instructions"]').fill("Stage at the south access gate 15 minutes before the assigned window.");
  const assignmentResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/applications/${vendorResult.application.id}/vendor-assignment` && response.request().method() === "PATCH");
  await freshVendorAssignment().locator("[data-save-vendor-assignment]").click();
  expect((await assignmentResponse).status()).toBe(200);
  await expect(freshVendorAccount()).toContainText("scheduled load-in");
  const vendorAssignmentMessage = page.locator("#admin-partner-followups [data-followup]").filter({ hasText: `Texas SandFest booth and load-in assignment - ${vendorResult.application.reference}` });
  await expect(vendorAssignmentMessage).toHaveCount(1);
  await expect(vendorAssignmentMessage).toContainText("draft ready");

  const freshVendorPortal = await openPreparedPartnerPortal(vendorName);
  await expect(freshVendorPortal.locator(".partner-vendor-center")).toContainText("5 / 5 requirements cleared");
  await expect(freshVendorPortal.locator(".partner-vendor-assignment")).toContainText("A-27");
  await expect(freshVendorPortal.locator(".partner-vendor-assignment")).toContainText("scheduled");
  const assignmentConfirmationResponse = freshVendorPortal.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-vendor-assignment/confirm" && response.request().method() === "POST");
  await freshVendorPortal.locator("#partner-confirm-vendor-assignment").click();
  expect((await assignmentConfirmationResponse).status()).toBe(200);
  await expect(freshVendorPortal.locator(".partner-vendor-assignment")).toContainText("confirmed");
  await freshVendorPortal.close();

  const refreshedPartners = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET");
  await page.locator("#admin-load-partners").click();
  await refreshedPartners;
  await expect(freshVendorAccount()).toHaveAttribute("data-status", "ready");
  await expect(freshVendorAccount()).toContainText("5/5 compliance");
  await expect(freshVendorAccount()).toContainText("approved profile");
  await expect(freshVendorAccount()).toContainText("confirmed load-in");
  await expect(vendorAssignmentMessage).toContainText("dismissed");

  const sponsorPortal = await openPreparedPartnerPortal("Gulf Shore Credit Union");
  await expect(sponsorPortal.locator(".partner-brand-center")).toContainText("Brand center");
  await expect(sponsorPortal.locator('#partner-brand-profile-form [name="tagline"]')).toHaveValue(/Rooted on the Texas coast/);
  await expect(sponsorPortal.locator("[data-partner-brand-asset]")).toHaveCount(2);
  await expect(sponsorPortal.locator("[data-partner-deliverable]")).toHaveCount(6);
  await sponsorPortal.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow(sponsorPortal);
  await assertNoAccessibilityViolations(sponsorPortal, "prepared sponsor portal");
  await sponsorPortal.close();

  const vendorPortal = await openPreparedPartnerPortal("Coastal Bites");
  await expect(vendorPortal.locator(".partner-vendor-center")).toContainText("7 / 7 requirements cleared");
  await expect(vendorPortal.locator(".partner-vendor-assignment")).toContainText("F-14");
  await expect(vendorPortal.locator(".partner-vendor-assignment")).toContainText("confirmed");
  await expect(vendorPortal.locator("[data-vendor-requirement]")).toHaveCount(7);
  await vendorPortal.close();
  await expect(page.locator("#admin-quickbooks-connection")).toBeVisible();
  await expect(page.locator("#admin-quickbooks-connection")).toHaveAttribute("data-state", "deferred");
  await expect(page.locator("#admin-quickbooks-status")).toContainText("deferred until post-presentation setup");
  await expect(page.locator("#admin-quickbooks-status")).toContainText("invoices, payments, aging, and reconciliation remain active");
  await expect(page.locator("#admin-connect-quickbooks")).toBeHidden();
  await expect(page.locator("#admin-refresh-quickbooks")).toBeEnabled();
  await expect(page.locator("#admin-disconnect-quickbooks")).toBeHidden();
  const revenueBeforeResponse = await fetch(`${apiBase}/api/admin/revenue`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(revenueBeforeResponse.status).toBe(200);
  const revenueBefore = await revenueBeforeResponse.json();
  const settlementForm = page.locator("#admin-import-revenue");
  await settlementForm.locator('[name="source"]').selectOption("square");
  await settlementForm.locator('[name="file"]').setInputFiles({
    name: settlementFileName,
    mimeType: "text/csv",
    buffer: Buffer.from(settlementCsv, "utf8")
  });
  await expect(settlementForm.locator('[name="csv"]')).toHaveValue(settlementCsv);
  const settlementPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/revenue/import" && response.request().method() === "POST");
  await settlementForm.locator('button[type="submit"]').click();
  const settlementPreviewResult = await settlementPreviewResponse;
  expect(settlementPreviewResult.status()).toBe(200);
  const settlementPreview = await settlementPreviewResult.json();
  expect(settlementPreview.summary?.rows).toBe(1);
  expect(settlementPreview.summary?.importable).toBe(1);
  expect(settlementPreview.summary?.invalid).toBe(0);
  expect(settlementPreview.summary?.grossCents).toBe(32500);
  expect(settlementPreview.summary?.feeCents).toBe(975);
  expect(settlementPreview.summary?.netCents).toBe(31525);
  await expect(page.locator("#admin-revenue-import-result")).toContainText("1 importable");
  await expect(page.locator("#admin-revenue-import-result")).toContainText("$325.00 gross");
  await expect(page.locator("#admin-commit-revenue-import")).toBeEnabled();

  const settlementCommitResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/revenue/import" && response.request().method() === "POST");
  await page.locator("#admin-commit-revenue-import").click();
  const settlementCommitResult = await settlementCommitResponse;
  expect(settlementCommitResult.status()).toBe(201);
  const settlementCommit = await settlementCommitResult.json();
  expect(settlementCommit.summary?.imported).toBe(1);
  expect(settlementCommit.replay).toBe(false);
  await expect(page.locator("#admin-api-status")).toContainText("Imported 1 settlement row; 0 duplicates skipped.");
  const settlementHistory = page.locator("#admin-revenue-import-history article").filter({ hasText: settlementFileName });
  await expect(settlementHistory).toHaveCount(1);
  await expect(settlementHistory).toContainText("square");
  await expect(settlementHistory).toContainText("1 imported");
  await expect(page.locator("#admin-revenue-sources")).toContainText("square");

  const revenueAfterResponse = await fetch(`${apiBase}/api/admin/revenue`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(revenueAfterResponse.status).toBe(200);
  const revenueAfter = await revenueAfterResponse.json();
  const importedSettlement = revenueAfter.entries?.find(item => item.externalRef === settlementReference);
  expect(importedSettlement).toMatchObject({
    source: "square",
    category: "merch",
    grossCents: 32500,
    feeCents: 975,
    netCents: 31525,
    reconciled: true
  });
  expect(revenueAfter.summary.totals.grossCents).toBe(revenueBefore.summary.totals.grossCents + 32500);
  expect(revenueAfter.summary.totals.feeCents).toBe(revenueBefore.summary.totals.feeCents + 975);
  expect(revenueAfter.summary.totals.netCents).toBe(revenueBefore.summary.totals.netCents + 31525);
  expect(revenueAfter.imports?.filter(item => item.fileName === settlementFileName)).toHaveLength(1);

  await settlementForm.locator('[name="source"]').selectOption("square");
  await settlementForm.locator('[name="file"]').setInputFiles({
    name: settlementFileName,
    mimeType: "text/csv",
    buffer: Buffer.from(settlementCsv, "utf8")
  });
  await expect(settlementForm.locator('[name="csv"]')).toHaveValue(settlementCsv);
  const settlementReplayPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/revenue/import" && response.request().method() === "POST");
  await settlementForm.locator('button[type="submit"]').click();
  const settlementReplayPreviewResult = await settlementReplayPreviewResponse;
  expect(settlementReplayPreviewResult.status()).toBe(200);
  const settlementReplayPreview = await settlementReplayPreviewResult.json();
  expect(settlementReplayPreview.replay).toBe(true);
  expect(settlementReplayPreview.summary?.importable).toBe(0);
  expect(settlementReplayPreview.summary?.duplicates).toBe(0);
  await expect(page.locator("#admin-revenue-import-result")).toContainText("0 importable");
  await expect(page.locator("#admin-revenue-import-result")).toContainText("This exact settlement was already imported. No ledger entries were added.");
  await expect(page.locator("#admin-commit-revenue-import")).toBeDisabled();
  const launchTaskSyncResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/deployment/tasks/sync" && response.request().method() === "POST");
  await page.locator("#admin-sync-deployment-tasks").click();
  const launchTaskSyncResult = await launchTaskSyncResponse;
  expect(launchTaskSyncResult.status()).toBe(200);
  expect((await launchTaskSyncResult.json()).sync.created).toBe(1);
  const backupLaunchTask = page.locator("#admin-partner-tasks .admin-task-card").filter({ hasText: "[Launch] Backup and recovery" });
  await expect(backupLaunchTask).toHaveCount(1);
  await expect(backupLaunchTask).toContainText("Operations team");
  await expect(backupLaunchTask).toContainText("high priority");
  const launchTaskReplayResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/deployment/tasks/sync" && response.request().method() === "POST");
  await page.locator("#admin-sync-deployment-tasks").click();
  const launchTaskReplayResult = await launchTaskReplayResponse;
  expect((await launchTaskReplayResult.json()).sync.changed).toBe(false);
  await expect(backupLaunchTask).toHaveCount(1);
  const sponsorTierForm = page.locator("#admin-create-sponsor-package");
  await sponsorTierForm.locator('[name="name"]').fill(`Community Champion ${runId}`);
  await sponsorTierForm.locator('[name="id"]').fill(sponsorTierId);
  await sponsorTierForm.locator('[name="amount"]').fill("7500.00");
  await sponsorTierForm.locator('[name="benefits"]').fill("Community stage recognition\nPublic sponsor showcase");
  const sponsorTierResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/sponsor-packages" && response.request().method() === "POST");
  await sponsorTierForm.locator('button[type="submit"]').click();
  const sponsorTierCreateResponse = await sponsorTierResponse;
  expect(sponsorTierCreateResponse.status()).toBe(201);
  expect((await sponsorTierCreateResponse.json()).sponsorPackage.publicLabel).toBe("$7,500 sponsorship");
  await expect(page.locator("#admin-api-status")).toContainText("Saved");
  await expect(page.locator(`[data-admin-sponsor="${sponsorTierId}"]`)).toContainText("$7,500.00");
  const vendorOfferingForm = page.locator("#admin-create-vendor-offering");
  await vendorOfferingForm.locator('[name="name"]').fill(`Premium marketplace ${runId}`);
  await vendorOfferingForm.locator('[name="id"]').fill(vendorOfferingId);
  await vendorOfferingForm.locator('[name="amount"]').fill("2500.00");
  await vendorOfferingForm.locator('[name="intakeMode"]').selectOption("application");
  await vendorOfferingForm.locator('[name="categories"][value="retail"]').check();
  await vendorOfferingForm.locator('[name="categories"][value="artisan"]').check();
  await vendorOfferingForm.locator('[name="description"]').fill("Expanded marketplace booth for larger retail and artisan activations.");
  await vendorOfferingForm.locator('[name="inclusions"]').fill("Expanded booth footprint\nPublished booth listing");
  const vendorOfferingResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/vendor-offerings" && response.request().method() === "POST");
  await vendorOfferingForm.locator('button[type="submit"]').click();
  const vendorOfferingCreateResponse = await vendorOfferingResponse;
  expect(vendorOfferingCreateResponse.status()).toBe(201);
  expect((await vendorOfferingCreateResponse.json()).vendorOffering.publicLabel).toBe("$2,500 application fee");
  await expect(page.locator("#admin-api-status")).toContainText("Saved");
  await expect(page.locator(`[data-admin-vendor-offering="${vendorOfferingId}"]`)).toContainText("$2,500.00");
  const documentUploadForm = page.locator("#admin-document-upload");
  const presentation = await readFile(path.join(ROOT, "docs", "presentations", "SandFest-Board-Platform-Briefing.pptx"));
  await documentUploadForm.locator('[name="file"]').setInputFiles({
    name: "SandFest-Board-Platform-Briefing.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: presentationUploadCopy(presentation, `browser-${runId}`)
  });
  await documentUploadForm.locator('[name="title"]').fill(documentTitle);
  const documentUploadResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/documents/upload" && response.request().method() === "POST");
  await documentUploadForm.locator('button[type="submit"]').click();
  const documentUploadResult = await documentUploadResponse;
  expect(documentUploadResult.status()).toBe(201);
  await expect(page.locator("#admin-document-upload-status")).toContainText("queued for private text extraction");
  const uploadedDocumentCard = page.locator("[data-admin-document]").filter({ hasText: documentTitle });
  await expect(uploadedDocumentCard).toHaveCount(1);
  const uploadedDocumentId = await uploadedDocumentCard.getAttribute("data-admin-document");
  expect(uploadedDocumentId).toBeTruthy();
  await expect.poll(async () => page.evaluate(async ({ apiBase, token, documentId }) => {
    const response = await fetch(`${apiBase}/api/admin/documents?limit=200`, { headers: { authorization: `Bearer ${token}` } });
    const payload = await response.json();
    return payload.documents?.find(item => item.id === documentId)?.extractionStatus;
  }, { apiBase, token: TOKEN, documentId: uploadedDocumentId }), { timeout: 15_000 }).toBe("ready");
  await page.locator("#admin-load-documents").click();
  const extractedDocumentCard = page.locator(`[data-admin-document="${uploadedDocumentId}"]`);
  await expect(extractedDocumentCard).toContainText("Extraction ready");
  await expect(extractedDocumentCard).toContainText("5,507 characters");
  await extractedDocumentCard.locator(".admin-document-preview summary").click();
  await expect(extractedDocumentCard.locator(".admin-document-preview pre")).toContainText("TEXAS SANDFEST");
  const vendorCard = page.locator("#admin-partner-applications [data-partner-application]").filter({ hasText: vendorName });
  const sponsorCard = page.locator("#admin-partner-applications [data-partner-application]").filter({ hasText: sponsorName });
  await expect(vendorCard).toHaveCount(1);
  await expect(vendorCard).toContainText("$0.00 / $1,250.00");
  await expect(sponsorCard).toHaveCount(1);
  await expect(sponsorCard).toContainText("$0.00 / $5,000.00");

  const sponsorApprovalResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/applications/${sponsorResult.application.id}` && response.request().method() === "PATCH");
  await sponsorCard.locator('[name="status"]').selectOption("approved");
  await sponsorCard.locator("[data-save-application]").click();
  const sponsorApprovalResult = await sponsorApprovalResponse;
  expect(sponsorApprovalResult.status()).toBe(200);
  const sponsorApprovalPayload = await sponsorApprovalResult.json();
  expect(sponsorApprovalPayload.decisionNotice).toMatchObject({
    kind: "application_approved",
    status: "draft_ready",
    requiresManualReview: false
  });
  await expect(page.locator("#admin-api-status")).toContainText("approval message is ready");
  await expect(partnerMessages.locator("[data-followup]").filter({ hasText: `Texas SandFest sponsorship application approved - ${sponsorResult.application.reference}` })).toContainText("Review the current status and respond here");
  await expect(sponsorCard.locator("[data-create-invoice]")).toBeVisible();

  const invoiceCreateResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/applications/${sponsorResult.application.id}/invoices` && response.request().method() === "POST");
  await sponsorCard.locator("[data-create-invoice]").click();
  const createdInvoiceResponse = await invoiceCreateResponse;
  expect(createdInvoiceResponse.status()).toBe(201);
  const createdInvoice = (await createdInvoiceResponse.json()).invoice;
  const sponsorInvoice = sponsorCard.locator(`[data-partner-invoice="${createdInvoice.id}"]`);
  await expect(sponsorInvoice.locator('[data-action="approve"]')).toBeVisible();

  const invoiceApprovalResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/invoices/${createdInvoice.id}/review` && response.request().method() === "POST");
  await sponsorInvoice.locator('[data-action="approve"]').click();
  expect((await invoiceApprovalResponse).status()).toBe(200);
  await expect(sponsorCard.locator(`[data-partner-invoice="${createdInvoice.id}"]`)).toContainText("approved");

  await sponsorCard.locator('[name="paymentAmount"]').fill("5000.00");
  await sponsorCard.locator('[data-record-payment]').click();
  await expect(page.locator("#admin-api-status")).toContainText("Enter a receipt or transaction reference");
  await expect(sponsorCard.locator("[data-partner-payment]")).toHaveCount(0);

  const paymentReference = `BROWSER-CHECK-${runId}`;
  await sponsorCard.locator('[name="paymentReference"]').fill(paymentReference);
  await sponsorCard.locator('[name="paymentReceivedAt"]').fill("2027-03-01T10:00");
  const paymentResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/applications/${sponsorResult.application.id}/payments` && response.request().method() === "POST");
  await sponsorCard.locator('[data-record-payment]').click();
  const recordedPaymentResponse = await paymentResponse;
  expect(recordedPaymentResponse.status()).toBe(201);
  const recordedPayment = (await recordedPaymentResponse.json()).payment;
  await expect(sponsorCard).toContainText("$5,000.00 / $5,000.00");
  await expect(sponsorCard.locator(`[data-partner-invoice="${createdInvoice.id}"]`)).toContainText("$0.00 open");
  const paymentRow = sponsorCard.locator(`[data-partner-payment="${recordedPayment.id}"]`);
  await expect(paymentRow).toContainText(paymentReference);
  const sponsorPaymentMilestone = page.locator("#admin-partner-milestones [data-admin-milestone]").filter({ hasText: sponsorName }).filter({ hasText: "Payment due" });
  await expect(sponsorPaymentMilestone.locator('[name="status"]')).toHaveValue("completed");

  await paymentRow.locator('[name="reversalAction"]').selectOption("void");
  await paymentRow.locator('[name="reversalReason"]').fill("Browser acceptance reversal");
  const paymentReversalResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/payments/${recordedPayment.id}/reverse` && response.request().method() === "POST");
  await paymentRow.locator("[data-reverse-payment]").click();
  expect((await paymentReversalResponse).status()).toBe(200);
  await expect(sponsorCard).toContainText("$0.00 / $5,000.00");
  await expect(sponsorCard.locator(`[data-partner-invoice="${createdInvoice.id}"]`)).toContainText("$5,000.00 open");
  await expect(sponsorCard.locator(`[data-partner-payment="${recordedPayment.id}"]`)).toContainText("voided");
  await expect(sponsorPaymentMilestone.locator('[name="status"]')).toHaveValue("open");

  const freshSponsorFulfillment = () => page.locator(`#admin-sponsor-fulfillment [data-sponsor-fulfillment="${sponsorResult.application.id}"]`);
  await expect(freshSponsorFulfillment()).toHaveCount(1);
  await expect(freshSponsorFulfillment()).toContainText("Tarpon");
  await expect(freshSponsorFulfillment()).toContainText("0/6 complete");
  await expect(freshSponsorFulfillment().locator('[data-brand-profile] [data-status="submitted"]')).toHaveText("submitted");
  await expect(freshSponsorFulfillment().locator(`[data-admin-brand-asset="${uploadedSponsorBrandAsset.id}"] [data-status="submitted"]`)).toHaveText("submitted");

  const freshSponsorProfileApproval = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/applications/${sponsorResult.application.id}/brand-profile/review` && response.request().method() === "POST");
  await freshSponsorFulfillment().locator('[data-review-brand-profile="approve"]').click();
  expect((await freshSponsorProfileApproval).status()).toBe(200);
  await expect(freshSponsorFulfillment().locator('[data-brand-profile] [data-status="approved"]')).toHaveText("approved");

  const freshSponsorAssetRow = () => freshSponsorFulfillment().locator(`[data-admin-brand-asset="${uploadedSponsorBrandAsset.id}"]`);
  await freshSponsorAssetRow().locator('[name="status"]').selectOption("approved");
  const freshSponsorAssetApproval = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/brand-assets/${uploadedSponsorBrandAsset.id}` && response.request().method() === "PATCH");
  await freshSponsorAssetRow().locator("[data-save-brand-asset]").click();
  expect((await freshSponsorAssetApproval).status()).toBe(200);
  await expect(freshSponsorAssetRow().locator('[data-status="approved"]')).toHaveText("approved");

  const freshSponsorDeliverableId = await freshSponsorFulfillment().locator("[data-admin-deliverable]").first().getAttribute("data-admin-deliverable");
  expect(freshSponsorDeliverableId).toBeTruthy();
  const freshSponsorDeliverable = () => freshSponsorFulfillment().locator(`[data-admin-deliverable="${freshSponsorDeliverableId}"]`);
  await freshSponsorDeliverable().locator('[name="status"]').selectOption("published");
  await freshSponsorDeliverable().locator('[name="ownerId"]').fill("staff_sponsor");
  await freshSponsorDeliverable().locator('[name="dueAt"]').fill("2027-03-20T17:00");
  await freshSponsorDeliverable().locator('[name="proofUrl"]').fill(`https://www.texassandfest.org/sponsors/${runId}`);
  await freshSponsorDeliverable().locator('[name="proofNotes"]').fill("Benefit placement is published and ready for sponsor review.");
  const freshSponsorDeliverablePublication = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/deliverables/${freshSponsorDeliverableId}` && response.request().method() === "PATCH");
  await freshSponsorDeliverable().locator("[data-save-deliverable]").click();
  expect((await freshSponsorDeliverablePublication).status()).toBe(200);
  await expect(freshSponsorDeliverable().locator('[data-status="pending"]')).toHaveText("pending");

  const freshSponsorPortal = await openPreparedPartnerPortal(sponsorName);
  await expect(freshSponsorPortal.locator(".partner-brand-center")).toContainText("Brand center");
  await expect(freshSponsorPortal.locator("[data-partner-brand-asset]")).toHaveCount(1);
  await expect(freshSponsorPortal.locator("[data-partner-deliverable]")).toHaveCount(6);
  await expect(freshSponsorPortal.locator("[data-partner-pay-invoice]")).toHaveText("Pay in local sandbox");
  const partnerCheckoutResponse = freshSponsorPortal.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-payment-checkout" && response.request().method() === "POST");
  await freshSponsorPortal.locator("[data-partner-pay-invoice]").click();
  const partnerCheckoutResult = await partnerCheckoutResponse;
  expect(partnerCheckoutResult.status()).toBe(201);
  const partnerCheckout = (await partnerCheckoutResult.json()).demoCheckout;
  expect(partnerCheckout).toMatchObject({
    mode: "board_sandbox",
    amountCents: 500000,
    currency: "usd",
    completeEndpoint: "/api/public/board-partner-checkout/complete"
  });
  expect(partnerCheckout.token).toEqual(expect.any(String));
  const tamperedPartnerPayment = await fetch(`${apiBase}${partnerCheckout.completeEndpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: `${partnerCheckout.token}x` })
  });
  expect(tamperedPartnerPayment.status).toBe(400);
  const partnerPaymentSandbox = freshSponsorPortal.locator("[data-partner-payment-sandbox]");
  await expect(partnerPaymentSandbox).toContainText("$5,000.00 demo");
  await expect(partnerPaymentSandbox).toContainText("No external charge is sent");
  await expect(partnerPaymentSandbox).not.toContainText("Stripe");
  await freshSponsorPortal.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow(freshSponsorPortal);
  await assertNoAccessibilityViolations(freshSponsorPortal, "local partner payment sandbox");
  const partnerPaymentResponse = freshSponsorPortal.waitForResponse(response => new URL(response.url()).pathname === partnerCheckout.completeEndpoint && response.request().method() === "POST");
  await partnerPaymentSandbox.locator("[data-complete-partner-demo-payment]").click();
  const partnerPaymentResult = await partnerPaymentResponse;
  expect(partnerPaymentResult.status()).toBe(200);
  const partnerPayment = await partnerPaymentResult.json();
  expect(partnerPayment.duplicate).toBe(false);
  expect(partnerPayment.receipt).toMatchObject({
    invoiceId: createdInvoice.id,
    amountCents: 500000,
    currency: "usd",
    environment: "board_sandbox"
  });
  expect(partnerPayment.receipt.paymentId).toEqual(expect.any(String));
  await expect(freshSponsorPortal.locator(".partner-status-kpis")).toContainText("$0.00");
  await expect(freshSponsorPortal.locator(".partner-status-kpis")).toContainText("paid");
  await expect(freshSponsorPortal.locator("[data-partner-pay-invoice]")).toHaveCount(0);
  const partnerPaymentReplay = await fetch(`${apiBase}${partnerCheckout.completeEndpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: partnerCheckout.token })
  });
  expect(partnerPaymentReplay.status).toBe(200);
  const partnerPaymentReplayResult = await partnerPaymentReplay.json();
  expect(partnerPaymentReplayResult.duplicate).toBe(true);
  expect(partnerPaymentReplayResult.receipt.paymentId).toBe(partnerPayment.receipt.paymentId);
  const freshSponsorPortalDeliverable = freshSponsorPortal.locator(`[data-partner-deliverable="${freshSponsorDeliverableId}"]`);
  await expect(freshSponsorPortalDeliverable).toContainText("Delivery proof · version 1");
  await expect(freshSponsorPortalDeliverable.locator('.partner-deliverable-review[data-status="pending"]')).toContainText("Partner review: pending");
  const freshSponsorSignoff = freshSponsorPortal.waitForResponse(response => new URL(response.url()).pathname === `/api/public/partner-deliverables/${freshSponsorDeliverableId}/review` && response.request().method() === "POST");
  await freshSponsorPortalDeliverable.locator('[data-deliverable-review="approve"]').click();
  expect((await freshSponsorSignoff).status()).toBe(200);
  await expect(freshSponsorPortal.locator(`[data-partner-deliverable="${freshSponsorDeliverableId}"] .partner-deliverable-review[data-status="approved"]`)).toContainText("Partner review: approved");
  await freshSponsorPortal.close();

  const refreshedSponsorPartners = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET");
  await page.locator("#admin-load-partners").click();
  await refreshedSponsorPartners;
  await expect(sponsorCard).toContainText("$5,000.00 / $5,000.00");
  await expect(sponsorCard.locator(`[data-partner-invoice="${createdInvoice.id}"]`)).toContainText("$0.00 open");
  const boardPartnerPayment = sponsorCard.locator(`[data-partner-payment="${partnerPayment.receipt.paymentId}"]`);
  await expect(boardPartnerPayment).toContainText("card");
  await expect(boardPartnerPayment).toContainText("board:pi_board_");
  await expect(sponsorPaymentMilestone.locator('[name="status"]')).toHaveValue("completed");
  await freshSponsorDeliverable().locator('[name="status"]').selectOption("complete");
  const freshSponsorDeliverableCompletion = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/deliverables/${freshSponsorDeliverableId}` && response.request().method() === "PATCH");
  await freshSponsorDeliverable().locator("[data-save-deliverable]").click();
  expect((await freshSponsorDeliverableCompletion).status()).toBe(200);
  await expect(freshSponsorFulfillment()).toContainText("1/6 complete");
  await expect(freshSponsorDeliverable().locator('[data-status="approved"]')).toHaveText("approved");

  const sponsorShowcasePage = await page.context().newPage();
  sponsorShowcasePage.on("pageerror", error => pageErrors.push(`Sponsor showcase: ${error.message}`));
  await sponsorShowcasePage.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  const freshSponsorShowcase = sponsorShowcasePage.locator("#public-sponsor-showcase .public-sponsor-card").filter({ hasText: sponsorName });
  await expect(freshSponsorShowcase).toHaveCount(1);
  await expect(freshSponsorShowcase).toContainText("Tarpon partner");
  await expect(freshSponsorShowcase).toContainText("Healthier coast, stronger community");
  await expect(freshSponsorShowcase.locator("img")).toHaveAttribute("src", new RegExp(`/api/public/sponsor-showcase/assets/${uploadedSponsorBrandAsset.id}$`));
  await expect.poll(() => freshSponsorShowcase.locator("img").evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await sponsorShowcasePage.close();

  const sponsorFulfillment = page.locator('#admin-sponsor-fulfillment [data-sponsor-fulfillment]').filter({ hasText: "Gulf Shore Credit Union" });
  await expect(sponsorFulfillment).toHaveCount(1);
  await expect(sponsorFulfillment).toContainText("Marlin");
  await expect(sponsorFulfillment).toContainText("Rooted on the Texas coast");
  await expect(sponsorFulfillment.locator("[data-admin-brand-asset]")).toHaveCount(2);
  await expect(sponsorFulfillment.locator("[data-admin-deliverable]")).toHaveCount(6);
  await expect(sponsorFulfillment).toContainText("Logo on the mid-tier of Logo Mountain");

  const staffImportCsv = `staff_id,event_id,name,work_email,status,role,team,notification_team
staff_operations,${DEFAULT_EVENT_ID},Jamie Torres,jamie.torres@staff.example,active,ops_admin,operations,operations
staff_sponsor,${DEFAULT_EVENT_ID},Morgan Ellis,morgan.ellis@staff.example,active,sponsor_admin,sponsor,sponsor
staff_finance,${DEFAULT_EVENT_ID},Riley Chen,riley.chen@staff.example,active,finance_admin,finance,finance
staff_volunteers,${DEFAULT_EVENT_ID},Casey Patel,casey.patel@staff.example,active,volunteer_captain,volunteer-captains,volunteer-captains
staff_traffic,${DEFAULT_EVENT_ID},Avery Brooks,avery.brooks@staff.example,on_call,traffic_lead,traffic,traffic
staff_guest_services,${DEFAULT_EVENT_ID},Taylor Nguyen,taylor.nguyen@staff.example,active,guest_services_lead,guest-services,guest-services
staff_production,${DEFAULT_EVENT_ID},Jordan Davis,jordan.davis@staff.example,active,production_lead,production,production`;
  const staffImportForm = page.locator("#admin-import-staff");
  await staffImportForm.locator('[name="file"]').setInputFiles({
    name: "staff-directory-browser.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(staffImportCsv, "utf8")
  });
  await staffImportForm.locator('[name="currentEventConfirmed"]').check();
  const staffPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/staff-directory/import" && response.request().method() === "POST");
  await staffImportForm.locator('button[type="submit"]').click();
  expect((await staffPreviewResponse).status()).toBe(200);
  await expect(page.locator("#admin-staff-import-result")).toContainText("7/7");
  await expect(page.locator("#admin-commit-staff-import")).toBeEnabled();
  const staffCommitResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/staff-directory/import" && response.request().method() === "POST");
  await page.locator("#admin-commit-staff-import").click();
  expect((await staffCommitResponse).status()).toBe(201);
  await expect(page.locator("#admin-api-status")).toContainText("Activated 7 staff and 7 notification routes.");
  await expect(page.locator("#admin-staff-directory-status")).toContainText("manual_verified");

  const discoveryForm = page.locator("#admin-discover-businesses");
  await expect(page.locator("#admin-outreach-discovery-readiness")).toHaveText("fixture ready");
  const discoveryPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/discovery/preview" && response.request().method() === "POST");
  await discoveryForm.locator('button[type="submit"]').click();
  expect((await discoveryPreviewResponse).status()).toBe(200);
  await expect(page.locator("#admin-outreach-discovery-result")).toContainText("Seabreeze Resort");
  const discoveredBusiness = discoveryForm.locator('input[name="discoveredSourceRef"][value="fixture/business/seabreeze-resort"]');
  await expect(discoveredBusiness).toHaveCount(1);
  await discoveredBusiness.check();
  const discoveryImportResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/discovery/import" && response.request().method() === "POST");
  await page.locator("#admin-import-discovered-businesses").click();
  expect((await discoveryImportResponse).status()).toBe(201);
  await expect(page.locator("#admin-api-status")).toContainText("Imported 1 business candidate; contact research remains required.");
  await expect(page.locator("#admin-outreach-prospects")).toContainText("Seabreeze Resort");

  const taskForm = page.locator("#admin-create-task");
  await taskForm.locator('[name="assigneeType"]').selectOption("volunteer");
  const taskOwner = taskForm.locator('[name="assigneeId"]');
  await expect.poll(async () => taskOwner.locator("option").count()).toBeGreaterThan(0);
  const volunteerId = await taskOwner.locator("option").first().getAttribute("value");
  expect(volunteerId).toBeTruthy();
  await taskOwner.selectOption(volunteerId);
  await taskForm.locator('[name="title"]').fill(taskTitle);
  await taskForm.locator('[name="priority"]').selectOption("high");
  await taskForm.locator('[name="dueAt"]').fill("2027-04-09T10:00");
  await taskForm.locator('[name="description"]').fill("Welcome arriving volunteers and route them to their assigned captain.");
  const taskResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners/tasks" && response.request().method() === "POST");
  await taskForm.locator('button[type="submit"]').click();
  const createdTaskResponse = await taskResponse;
  expect(createdTaskResponse.status()).toBe(201);
  const createdVolunteerTask = (await createdTaskResponse.json()).task;
  expect(createdVolunteerTask.assigneeType).toBe("volunteer");
  expect(createdVolunteerTask.assigneeId).toBe(volunteerId);
  expect(createdVolunteerTask.dueAt).toBeTruthy();
  await expect(page.locator("#admin-api-status")).toContainText("Task delegated.");
  await expect(page.locator("#admin-partner-tasks")).toContainText(taskTitle);

  const milestoneForm = page.locator("#admin-create-milestone");
  await milestoneForm.locator('[name="applicationId"]').selectOption(sponsorResult.application.id);
  await milestoneForm.locator('[name="label"]').fill(milestoneLabel);
  await milestoneForm.locator('[name="dueAt"]').fill(milestoneDueInput);
  await milestoneForm.locator('[name="assigneeTeam"]').selectOption("sponsor");
  const milestonePath = `/api/admin/partners/applications/${sponsorResult.application.id}/milestones`;
  const milestoneResponse = page.waitForResponse(response => new URL(response.url()).pathname === milestonePath && response.request().method() === "POST");
  await milestoneForm.locator('button[type="submit"]').click();
  const createdMilestoneResponse = await milestoneResponse;
  expect(createdMilestoneResponse.status()).toBe(201);
  const createdSponsorMilestone = (await createdMilestoneResponse.json()).milestone;
  expect(createdSponsorMilestone.applicationId).toBe(sponsorResult.application.id);
  expect(createdSponsorMilestone.status).toBe("open");
  expect(createdSponsorMilestone.reminderLeadDays).toBe(3);
  await expect(page.locator("#admin-partner-milestones")).toContainText(milestoneLabel);

  const prospectForm = page.locator("#admin-create-prospect");
  await prospectForm.locator('[name="organizationName"]').fill(prospectName);
  await prospectForm.locator('[name="contactName"]').fill("Morgan Browser");
  await prospectForm.locator('[name="industry"]').fill(prospectIndustry);
  await prospectForm.locator('[name="city"]').fill("Port Aransas");
  await prospectForm.locator('[name="postalCode"]').fill("78373");
  await prospectForm.locator('[name="latitude"]').fill("27.8339");
  await prospectForm.locator('[name="longitude"]').fill("-97.0611");
  await prospectForm.locator('[name="contactEmail"]').fill(prospectRecipient);
  await prospectForm.locator('[name="communityFit"]').check();
  await prospectForm.locator('[name="contactBasis"]').selectOption("business_relevance");
  await prospectForm.locator('[name="status"]').selectOption("contact_ready");
  const prospectResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/prospects" && response.request().method() === "POST");
  await prospectForm.locator('button[type="submit"]').click();
  const createdProspectResponse = await prospectResponse;
  expect(createdProspectResponse.status()).toBe(201);
  const createdProspect = (await createdProspectResponse.json()).prospect;
  await expect(page.locator("#admin-api-status")).toContainText(`Scored ${prospectName} at`);
  await expect(page.locator("#admin-outreach-prospects")).toContainText(prospectName);

  const campaignForm = page.locator("#admin-create-campaign");
  await campaignForm.locator('[name="name"]').fill(campaignName);
  await campaignForm.locator('[name="objective"]').fill("Introduce a reviewed sponsor invitation to one qualified Port Aransas business.");
  await campaignForm.locator('[name="industries"]').fill(prospectIndustry);
  await campaignForm.locator('[name="cities"]').fill("Port Aransas");
  await campaignForm.locator('[name="postalCodes"]').fill("78373");
  const centerSource = campaignForm.locator('[name="centerSource"]');
  const centerLatitude = campaignForm.locator('[name="centerLatitude"]');
  const centerLongitude = campaignForm.locator('[name="centerLongitude"]');
  const centerPreview = campaignForm.locator("#admin-campaign-center-preview");
  await expect(centerSource.locator("option").filter({ hasText: prospectName })).toHaveCount(1);
  await centerSource.selectOption("sandfest");
  await expect(centerLatitude).toHaveValue("27.8339");
  await expect(centerLongitude).toHaveValue("-97.0611");
  await centerLatitude.fill("27.834");
  await expect(centerSource).toHaveValue("custom");
  await centerSource.selectOption(`prospect:${createdProspect.id}`);
  await expect(centerLatitude).toHaveValue("27.8339");
  await expect(centerLongitude).toHaveValue("-97.0611");
  await campaignForm.locator('[name="radiusMiles"]').fill("5");
  await expect(centerPreview).toHaveAttribute("data-state", "ready");
  await expect(centerPreview).toContainText(prospectName);
  await expect(centerPreview).toContainText("inside a 5-mile radius");
  await expect(centerPreview).toContainText("Server qualification applies every other campaign filter");
  await campaignForm.locator('[name="minFitScore"]').fill("0");
  await campaignForm.locator('[name="deliveryMode"]').selectOption("approved_sequence");
  await campaignForm.locator('[name="dailySendLimit"]').fill("3");
  const audiencePreview = campaignForm.locator("#admin-campaign-audience-preview");
  const previewButton = campaignForm.locator("#admin-preview-campaign");
  const createCampaignButton = campaignForm.locator('button[type="submit"]');
  await expect(createCampaignButton).toBeDisabled();
  const campaignPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/campaigns/preview" && response.request().method() === "POST");
  await previewButton.click();
  const previewResult = await campaignPreviewResponse;
  expect(previewResult.status()).toBe(200);
  expect((await previewResult.json()).preview.matches[0]).not.toHaveProperty("contactEmail");
  await expect(audiencePreview).toHaveAttribute("data-state", "ready");
  await expect(audiencePreview).toContainText("1 business qualifies");
  await expect(audiencePreview).toContainText(prospectName);
  await expect(audiencePreview).toContainText(`A Texas SandFest partnership for ${prospectName}`);
  await expect(audiencePreview).not.toContainText(prospectRecipient);
  await expect(createCampaignButton).toBeEnabled();
  await campaignForm.locator('[name="dailySendLimit"]').fill("4");
  await expect(audiencePreview).toHaveAttribute("data-state", "stale");
  await expect(createCampaignButton).toBeDisabled();
  await campaignForm.locator('[name="dailySendLimit"]').fill("3");
  const refreshedCampaignPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/campaigns/preview" && response.request().method() === "POST");
  await previewButton.click();
  expect((await refreshedCampaignPreviewResponse).status()).toBe(200);
  await expect(createCampaignButton).toBeEnabled();
  const campaignResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/campaigns" && response.request().method() === "POST");
  await createCampaignButton.click();
  const createdCampaignResponse = await campaignResponse;
  expect(createdCampaignResponse.status()).toBe(201);
  const createdCampaign = (await createdCampaignResponse.json()).campaign;
  await expect(centerSource).toHaveValue(`prospect:${createdProspect.id}`);
  await expect(centerLatitude).toHaveValue("27.8339");
  await expect(centerLongitude).toHaveValue("-97.0611");
  const campaignCard = page.locator(`[data-outreach-campaign="${createdCampaign.id}"]`);
  await expect(campaignCard).toContainText(campaignName);
  await expect(campaignCard).toContainText("1 matched");
  await expect(campaignCard).toContainText("campaign-approved, 3/day");
  const campaignOutcomeFunnel = campaignCard.locator(`[data-campaign-outcomes="${createdCampaign.id}"]`);
  await expect(campaignOutcomeFunnel).toBeVisible();
  await expect(campaignOutcomeFunnel.locator('[data-outcome-stage="reached"] strong')).toHaveText("0");
  await expect(campaignOutcomeFunnel.locator('[data-outcome-stage="applications"] strong')).toHaveText("0");
  const outreachMap = page.locator("#admin-outreach-targeting-map");
  const outreachMapCampaign = outreachMap.locator("#admin-outreach-map-campaign");
  await outreachMapCampaign.selectOption(createdCampaign.id);
  await expect(outreachMap).toHaveAttribute("data-campaign-id", createdCampaign.id);
  await expect(outreachMapCampaign).toHaveValue(createdCampaign.id);
  const centeredProspect = outreachMap.locator(`[data-outreach-map-prospect="${createdProspect.id}"]`);
  await expect(centeredProspect).toHaveAttribute("data-inside", "true");
  await expect(centeredProspect).toHaveAttribute("data-at-center", "true");
  await expect(outreachMap.locator(`[data-outreach-map-row="${createdProspect.id}"]`)).toContainText("0.0 mi · inside radius");
  await expect(outreachMap.getByText("server matched").locator("..")).toContainText("1");
  await expect(outreachMap.getByRole("img")).toHaveAttribute("aria-label", /1 prospect matches all server campaign filters/);
  const centerDot = await outreachMap.locator(".admin-outreach-map-center i").boundingBox();
  const prospectRing = await centeredProspect.locator("i").boundingBox();
  const centerLabel = await outreachMap.locator(".admin-outreach-map-center b").boundingBox();
  const prospectLabel = await centeredProspect.locator("b").boundingBox();
  expect(centerDot).not.toBeNull();
  expect(prospectRing).not.toBeNull();
  expect(centerLabel).not.toBeNull();
  expect(prospectLabel).not.toBeNull();
  expect(prospectRing.width).toBeGreaterThan(centerDot.width);
  expect(Math.abs((prospectRing.x + prospectRing.width / 2) - (centerDot.x + centerDot.width / 2))).toBeLessThan(1);
  expect(Math.abs((prospectRing.y + prospectRing.height / 2) - (centerDot.y + centerDot.height / 2))).toBeLessThan(1);
  expect(prospectLabel.y).toBeGreaterThanOrEqual(centerLabel.y + centerLabel.height + 4);
  const alternateCampaignId = await outreachMapCampaign.locator("option").evaluateAll((options, currentId) => options.find(option => option.value !== currentId)?.value || "", createdCampaign.id);
  expect(alternateCampaignId).not.toBe("");
  await outreachMapCampaign.selectOption(alternateCampaignId);
  await expect(outreachMap).toHaveAttribute("data-campaign-id", alternateCampaignId);
  await outreachMap.locator("#admin-outreach-map-campaign").selectOption(createdCampaign.id);
  await expect(outreachMap).toHaveAttribute("data-campaign-id", createdCampaign.id);
  page.once("dialog", dialog => dialog.accept());
  await campaignCard.locator('[data-campaign-action="activate"]').click();
  await expect(page.locator("#admin-api-status")).toContainText("Campaign activated with 1 due message eligible for bounded automation.");

  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/outreach`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    return payload.followups?.some(item => item.campaignId === createdCampaign.id
      && item.recipient === prospectRecipient
      && item.automationPolicy === "outreach_campaign_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered") || false;
  }, { timeout: 15_000 }).toBe(true);
  const reloadOutreach = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach" && response.request().method() === "GET");
  await page.locator("#admin-load-partners").click();
  await reloadOutreach;
  const deliveredCampaignMessage = page.locator('#admin-partner-followups [data-delivery-status="delivered"]').filter({ hasText: prospectRecipient });
  await expect(deliveredCampaignMessage).toHaveCount(1);
  await expect(deliveredCampaignMessage).toContainText("campaign-approved automation");
  await expect(campaignOutcomeFunnel.locator('[data-outcome-stage="reached"] strong')).toHaveText("1");
  await expect(campaignOutcomeFunnel.locator('[data-outcome-stage="delivered"] strong')).toHaveText("1");
  await expect(campaignOutcomeFunnel.locator('[data-outcome-stage="opened"] strong')).toHaveText("0");
  await expect(campaignOutcomeFunnel.locator('[data-outcome-stage="clicked"] strong')).toHaveText("0");

  const prospectCard = page.locator(`[data-outreach-prospect="${createdProspect.id}"]`);
  await expect(prospectCard).toContainText("Ready for an invited sponsor application");
  await prospectCard.locator('[name="sponsorPackageId"]').selectOption(sponsorTierId);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("Clipboard denied for acceptance coverage."); } }
    });
  });
  const invitationPath = `/api/admin/outreach/prospects/${createdProspect.id}/sponsor-invitation`;
  const invitationIssueResponse = page.waitForResponse(response => new URL(response.url()).pathname === invitationPath && response.request().method() === "POST");
  await prospectCard.locator('[data-sponsor-invitation-action="issue"]').click();
  const issuedInvitationResponse = await invitationIssueResponse;
  expect(issuedInvitationResponse.status()).toBe(200);
  const issuedInvitation = (await issuedInvitationResponse.json()).invitation;
  expect(issuedInvitation.packageId).toBe(sponsorTierId);
  expect(issuedInvitation.url).toContain("#sponsor-invitation?token=");
  await expect(page.locator("#admin-api-status")).toContainText("Sponsor invitation issued. Use Open invitation or Copy link.");
  await expect(prospectCard.locator('[data-sponsor-invitation-action="open"]')).toBeVisible();

  const invitationPopup = page.waitForEvent("popup");
  await prospectCard.locator('[data-sponsor-invitation-action="open"]').click();
  const invitationPage = await invitationPopup;
  await expect(invitationPage.locator("#sponsor-invitation")).toBeVisible();
  await expect(invitationPage.locator("#sponsor-invitation-copy")).toContainText(prospectName);
  await expect(invitationPage.locator("#sponsor-invitation-copy")).toContainText(`Community Champion ${runId}`);
  await expect(invitationPage).toHaveURL(/#sponsors$/);
  const invitedSponsorForm = invitationPage.locator("#sponsor-inquiry-form");
  await expect(invitedSponsorForm.locator('[name="organizationName"]')).toHaveValue(prospectName);
  await expect(invitedSponsorForm.locator('[name="organizationName"]')).toHaveAttribute("readonly", "");
  await expect(invitedSponsorForm.locator('[name="contactEmail"]')).toHaveValue(prospectRecipient);
  await expect(invitedSponsorForm.locator('[name="contactEmail"]')).toHaveAttribute("readonly", "");
  await expect(invitedSponsorForm.locator('[name="packageId"]')).toHaveValue(sponsorTierId);
  await expect(invitedSponsorForm.locator('[name="packageId"]')).toBeDisabled();
  await expect(invitationPage.locator("#sponsor-package-summary")).toContainText("$7,500 sponsorship");
  await invitedSponsorForm.locator('[name="description"]').fill("A hospitality partnership connecting island visitors with the SandFest community.");
  await invitedSponsorForm.locator('[name="consentToContact"]').check();
  const invitedSponsorResult = await submitAndCapture(invitationPage, invitedSponsorForm, "/api/public/sponsor-inquiries");
  expect(invitedSponsorResult.outreachConversion).toBe(true);
  await expect(invitationPage.locator("#partner-status-result")).toContainText(prospectName);
  await expect(invitationPage.locator('#partner-status-form [name="reference"]')).toHaveValue(invitedSponsorResult.application.reference);
  await expect(invitationPage.locator("#partner-brand-profile-form")).toBeVisible();
  await invitationPage.close();

  const convertedReload = Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET"),
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach" && response.request().method() === "GET")
  ]);
  await page.locator("#admin-load-partners").click();
  await convertedReload;
  await expect(prospectCard).toContainText(`Linked to ${invitedSponsorResult.application.reference}`);
  await expect(prospectCard.locator("[data-sponsor-invitation-action]")).toHaveCount(0);
  const convertedApplication = page.locator("#admin-partner-applications [data-partner-application]").filter({ hasText: prospectName });
  await expect(convertedApplication).toHaveCount(1);
  await expect(convertedApplication).toContainText(`Community Champion ${runId}`);
  await expect(convertedApplication).toContainText("$0.00 / $7,500.00");
  await expect(campaignOutcomeFunnel.locator('[data-outcome-stage="applications"] strong')).toHaveText("1");
  await expect(page.locator("#admin-partner-activity")).toContainText("Sponsor target converted");

  const automationForm = page.locator("#admin-partner-automation");
  await automationForm.locator('[name="mode"]').selectOption("transactional_auto");
  page.once("dialog", dialog => dialog.accept());
  const automationResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners/automation" && response.request().method() === "PATCH");
  await automationForm.locator('button[type="submit"]').click();
  expect((await automationResponse).status()).toBe(200);
  await expect(page.locator("#admin-api-status")).toContainText("Transactional partner automation is active.");
  await expect(messagingKpi).toContainText("Automatic");
  await expect(commandSignals.locator('[data-command-signal="messages"]')).toContainText("automatic follow-up");

  const sponsorAcknowledgmentSubject = `Texas SandFest sponsorship application ${sponsorResult.application.reference}`;
  let deliveredPaymentConfirmationId = null;
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const confirmation = payload.followups?.find(item => item.applicationId === sponsorResult.application.id
      && item.paymentId === partnerPayment.receipt.paymentId
      && item.kind === "payment_received"
      && item.automationPolicy === "partner_transactional_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered"
      && item.body?.includes("$5,000.00")
      && item.body?.includes("private partner portal")
      && item.body?.includes("paid in full")
      && !item.body?.includes("board:pi_board_")
      && !item.body?.includes("Postgres durability verification"));
    deliveredPaymentConfirmationId = confirmation?.id || null;
    return Boolean(deliveredPaymentConfirmationId);
  }, { timeout: 15_000 }).toBe(true);
  let deliveredSponsorAcknowledgmentId = null;
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const acknowledgment = payload.followups?.find(item => item.applicationId === sponsorResult.application.id
      && item.kind === "application_received"
      && item.recipient === sponsorRecipient
      && item.subject === sponsorAcknowledgmentSubject
      && item.automationPolicy === "partner_transactional_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered");
    deliveredSponsorAcknowledgmentId = acknowledgment?.id || null;
    return Boolean(deliveredSponsorAcknowledgmentId);
  }, { timeout: 15_000 }).toBe(true);
  let deliveredTaskAssignmentId = null;
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const assignment = payload.followups?.find(item => item.taskId === createdVolunteerTask.id
      && item.kind === "task_assignment"
      && item.subject === `Texas SandFest task assigned - ${taskTitle}`
      && item.automationPolicy === "partner_transactional_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered");
    deliveredTaskAssignmentId = assignment?.id || null;
    return Boolean(deliveredTaskAssignmentId);
  }, { timeout: 15_000 }).toBe(true);
  let deliveredMilestoneReminderId = null;
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const reminder = payload.followups?.find(item => item.milestoneId === createdSponsorMilestone.id
      && item.kind === "milestone_reminder"
      && item.reminderPhase === "upcoming"
      && item.subject === `Texas SandFest ${milestoneLabel.toLowerCase()} reminder - ${sponsorResult.application.reference}`
      && item.automationPolicy === "partner_transactional_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered");
    deliveredMilestoneReminderId = reminder?.id || null;
    return Boolean(deliveredMilestoneReminderId);
  }, { timeout: 15_000 }).toBe(true);
  let deliveredSponsorProofReviewId = null;
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const proofReview = payload.followups?.find(item => item.kind === "sponsor_deliverable_review"
      && item.automationPolicy === "partner_transactional_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered"
      && item.body?.includes("private sponsor portal")
      && !item.body?.includes("gulf-shore-credit-union"));
    deliveredSponsorProofReviewId = proofReview?.id || null;
    return Boolean(deliveredSponsorProofReviewId);
  }, { timeout: 15_000 }).toBe(true);
  let deliveredVendorOpeningId = null;
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const opening = payload.followups?.find(item => item.kind === "vendor_applications_open"
      && item.automationPolicy === "partner_transactional_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered"
      && item.body?.includes("has not been converted into an application")
      && item.body?.includes("vendorOffering=marketplace-booth")
      && item.body?.includes("vendorCategory=service")
      && !item.body?.includes("cameron.brooks@example.com"));
    deliveredVendorOpeningId = opening?.id || null;
    return Boolean(deliveredVendorOpeningId);
  }, { timeout: 15_000 }).toBe(true);
  const reloadPartners = Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET"),
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach" && response.request().method() === "GET")
  ]);
  await page.locator("#admin-load-partners").click();
  await reloadPartners;
  const deliveredPaymentConfirmation = page.locator(`#admin-partner-followups [data-followup="${deliveredPaymentConfirmationId}"]`);
  await expect(deliveredPaymentConfirmation).toHaveCount(1);
  await expect(deliveredPaymentConfirmation).toHaveAttribute("data-delivery-status", "delivered");
  await expect(deliveredPaymentConfirmation).toContainText("automatic payment confirmation");
  await expect(deliveredPaymentConfirmation).toContainText("$5,000.00");
  await expect(deliveredPaymentConfirmation).toContainText("paid in full");
  await expect(deliveredPaymentConfirmation).not.toContainText("board:pi_board_");
  const deliveredFollowup = page.locator(`#admin-partner-followups [data-followup="${deliveredSponsorAcknowledgmentId}"]`);
  await expect(deliveredFollowup).toHaveCount(1);
  await expect(deliveredFollowup).toHaveAttribute("data-delivery-status", "delivered");
  await expect(deliveredFollowup).toContainText(sponsorRecipient);
  await expect(deliveredFollowup).toContainText(sponsorAcknowledgmentSubject);
  await expect(deliveredFollowup).toContainText("transactional automation");

  const deliveredTaskAssignment = page.locator(`#admin-partner-followups [data-followup="${deliveredTaskAssignmentId}"]`);
  await expect(deliveredTaskAssignment).toHaveCount(1);
  await expect(deliveredTaskAssignment).toHaveAttribute("data-delivery-status", "delivered");
  await expect(deliveredTaskAssignment).toContainText(`Texas SandFest task assigned - ${taskTitle}`);
  await expect(deliveredTaskAssignment).toContainText("transactional automation");
  const deliveredMilestoneReminder = page.locator(`#admin-partner-followups [data-followup="${deliveredMilestoneReminderId}"]`);
  await expect(deliveredMilestoneReminder).toHaveCount(1);
  await expect(deliveredMilestoneReminder).toHaveAttribute("data-delivery-status", "delivered");
  await expect(deliveredMilestoneReminder).toContainText(`Texas SandFest ${milestoneLabel.toLowerCase()} reminder`);
  await expect(deliveredMilestoneReminder).toContainText("automatic key-date reminder");
  const deliveredSponsorProofReview = page.locator(`#admin-partner-followups [data-followup="${deliveredSponsorProofReviewId}"]`);
  await expect(deliveredSponsorProofReview).toHaveCount(1);
  await expect(deliveredSponsorProofReview).toHaveAttribute("data-delivery-status", "delivered");
  await expect(deliveredSponsorProofReview).toContainText("Texas SandFest sponsor proof ready");
  await expect(deliveredSponsorProofReview).toContainText("automatic sponsor proof review");
  const deliveredVendorOpening = page.locator(`#admin-partner-followups [data-followup="${deliveredVendorOpeningId}"]`);
  await expect(deliveredVendorOpening).toHaveCount(1);
  await expect(deliveredVendorOpening).toHaveAttribute("data-delivery-status", "delivered");
  await expect(deliveredVendorOpening).toContainText("Texas SandFest vendor applications are open");
  await expect(deliveredVendorOpening).toContainText("has not been converted into an application");
  await expect(deliveredVendorOpening).toContainText("transactional automation");
  const freshSponsorMilestone = page.locator(`#admin-partner-milestones [data-admin-milestone="${createdSponsorMilestone.id}"]`);
  await expect(freshSponsorMilestone).toContainText(milestoneLabel);
  await expect(freshSponsorMilestone).toContainText("latest reminder upcoming (sent)");
  await freshSponsorMilestone.locator('[name="status"]').selectOption("completed");
  const completedMilestoneResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/milestones/${createdSponsorMilestone.id}` && response.request().method() === "PATCH");
  await freshSponsorMilestone.locator('[data-save-milestone]').click();
  const completedMilestoneResult = await completedMilestoneResponse;
  expect(completedMilestoneResult.status()).toBe(200);
  const completedMilestone = (await completedMilestoneResult.json()).milestone;
  expect(completedMilestone.status).toBe("completed");
  expect(completedMilestone.completedAt).toBeTruthy();
  await expect(page.locator("#admin-api-status")).toContainText("Key date saved.");
  await expect(freshSponsorMilestone.locator('[name="status"]')).toHaveValue("completed");
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const milestone = payload.milestones?.find(item => item.id === createdSponsorMilestone.id);
    const reminders = payload.followups?.filter(item => item.milestoneId === createdSponsorMilestone.id && item.kind === "milestone_reminder") || [];
    const activeReminders = reminders.filter(item => !["dismissed", "sent"].includes(item.status));
    return milestone?.status === "completed"
      && Boolean(milestone.completedAt)
      && reminders.length === 1
      && reminders[0].deliveryStatus === "delivered"
      && activeReminders.length === 0;
  }, { timeout: 15_000 }).toBe(true);
  const freshVolunteerTask = page.locator(`#admin-partner-tasks [data-task="${createdVolunteerTask.id}"]`);
  await expect(freshVolunteerTask).toContainText(taskTitle);
  await expect(freshVolunteerTask).toContainText("Assignment notices · 1 issued · latest delivered");
  await expect(freshVolunteerTask).toContainText("Awaiting assignee acknowledgement");
  const resendTaskNoticeResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/tasks/${createdVolunteerTask.id}/assignment-notice` && response.request().method() === "POST");
  await freshVolunteerTask.locator('[data-resend-task]').click();
  const resendTaskNoticeResult = await resendTaskNoticeResponse;
  expect(resendTaskNoticeResult.status()).toBe(202);
  const resentTaskNotice = await resendTaskNoticeResult.json();
  expect(resentTaskNotice.task.assignmentNoticeVersion).toBe(1);
  expect(resentTaskNotice.notice.sourceVersion).toBe("assignment:1:notice:1");
  expect(JSON.stringify(resentTaskNotice)).not.toContain("tsft_");
  await expect(page.locator("#admin-api-status")).toContainText("Assignment notice queued.");
  let resentTaskDeliveryProof = null;
  const resentTaskDeliveryDeadline = Date.now() + 15_000;
  while (Date.now() < resentTaskDeliveryDeadline) {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const notices = payload.followups?.filter(item => item.taskId === createdVolunteerTask.id && item.kind === "task_assignment") || [];
    const latest = notices.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    resentTaskDeliveryProof = {
      notices: notices.map(item => ({
        id: item.id,
        sourceVersion: item.sourceVersion,
        status: item.status,
        deliveryStatus: item.deliveryStatus,
        providerMessageId: item.providerMessageId,
        lastError: item.lastError
      })),
      automation: payload.automation
    };
    if (notices.length === 2 && latest?.sourceVersion === "assignment:1:notice:1" && latest?.deliveryStatus === "delivered") break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  expect(
    resentTaskDeliveryProof?.notices?.length === 2
      && resentTaskDeliveryProof.notices[0]?.sourceVersion === "assignment:1:notice:1"
      && resentTaskDeliveryProof.notices[0]?.deliveryStatus === "delivered",
    JSON.stringify({ ...resentTaskDeliveryProof, worker: workerProcess.output().slice(-5_000) }, null, 2)
  ).toBe(true);
  const resentTaskReload = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET");
  await page.locator("#admin-load-partners").click();
  await resentTaskReload;
  await expect(freshVolunteerTask).toContainText("Assignment notices · 2 issued · latest delivered");
  await expect(freshVolunteerTask.locator('[data-resend-task]')).toBeEnabled();
  await expect(freshVolunteerTask.locator('[data-resend-task]')).toHaveText("Resend notice");

  const taskPortalConfigForBrowser = taskPortalConfig({
    SANDFEST_ENV: "development",
    SANDFEST_TASK_PORTAL_SECRET: PORTAL_SECRET,
    SANDFEST_PUBLIC_SITE_URL: webBase
  });
  const taskPortalUrl = taskPortalUrlForTask(createdVolunteerTask, { config: taskPortalConfigForBrowser });
  expect(taskPortalUrl).toContain("#task-status?task=");
  const taskPortalBrowserUrl = new URL(taskPortalUrl);
  taskPortalBrowserUrl.searchParams.set("apiBase", apiBase);
  const taskPage = await page.context().newPage();
  await taskPage.setViewportSize({ width: 360, height: 780 });
  await taskPage.goto(taskPortalBrowserUrl.toString());
  await expect(taskPage).toHaveURL(/#task-status$/);
  await expect(taskPage.locator("#task-status-result")).toContainText(taskTitle);
  await expect(taskPage.locator("#task-status-result")).toBeFocused();
  await expect(taskPage.locator('[data-task-action="acknowledge"]')).toBeVisible();
  await assertNoHorizontalOverflow(taskPage);

  const acknowledgedTaskResponse = taskPage.waitForResponse(response => new URL(response.url()).pathname === "/api/public/task-status/update" && response.request().method() === "POST");
  await taskPage.locator('[data-task-action="acknowledge"]').click();
  expect((await acknowledgedTaskResponse).status()).toBe(200);
  await expect(taskPage.locator("#task-status-result")).toContainText("Acknowledged");

  const startedTaskResponse = taskPage.waitForResponse(response => new URL(response.url()).pathname === "/api/public/task-status/update" && response.request().method() === "POST");
  await taskPage.locator('[data-task-action="start"]').click();
  const startedTaskResult = await startedTaskResponse;
  expect(startedTaskResult.status()).toBe(200);
  const startedTask = (await startedTaskResult.json()).task;
  expect(startedTask.status).toBe("in_progress");
  expect(startedTask.startedAt).toBeTruthy();
  await expect(taskPage.locator("#task-status-result")).toHaveAttribute("data-state", "in_progress");
  await taskPage.locator('#task-status-update [name="note"]').fill("Need two more welcome packets at the north gate.");
  const blockedTaskResponse = taskPage.waitForResponse(response => new URL(response.url()).pathname === "/api/public/task-status/update" && response.request().method() === "POST");
  await taskPage.locator('[data-task-action="block"]').click();
  expect((await blockedTaskResponse).status()).toBe(200);
  await expect(taskPage.locator("#task-status-result")).toContainText("Need two more welcome packets at the north gate.");

  const assigneeReload = Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET"),
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach" && response.request().method() === "GET")
  ]);
  await page.locator("#admin-load-partners").click();
  await assigneeReload;
  await expect(freshVolunteerTask).toContainText("Acknowledged");
  await expect(freshVolunteerTask).toContainText("Latest assignee note");
  await expect(freshVolunteerTask).toContainText("Need two more welcome packets at the north gate.");

  await taskPage.locator('#task-status-update [name="note"]').fill("Welcome packets delivered and captain briefed.");
  const completedTaskResponse = taskPage.waitForResponse(response => new URL(response.url()).pathname === "/api/public/task-status/update" && response.request().method() === "POST");
  await taskPage.locator('[data-task-action="complete"]').click();
  const completedTaskResult = await completedTaskResponse;
  expect(completedTaskResult.status()).toBe(200);
  const completedTask = (await completedTaskResult.json()).task;
  expect(completedTask.status).toBe("done");
  expect(completedTask.startedAt).toBe(startedTask.startedAt);
  expect(completedTask.completedAt).toBeTruthy();
  await expect(taskPage.locator("#task-status-result")).toHaveAttribute("data-state", "done");
  await expect(taskPage.locator("#task-status-update")).toBeHidden();
  await assertNoHorizontalOverflow(taskPage);
  await taskPage.close();

  const completedTaskReload = Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET"),
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach" && response.request().method() === "GET")
  ]);
  await page.locator("#admin-load-partners").click();
  await completedTaskReload;
  await page.locator("#admin-task-status-filter").selectOption("done");
  await expect(freshVolunteerTask).toContainText(taskTitle);
  await expect(freshVolunteerTask.locator('[name="status"]')).toHaveValue("done");
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const task = payload.tasks?.find(item => item.id === createdVolunteerTask.id);
    const assignments = payload.followups?.filter(item => item.taskId === createdVolunteerTask.id && item.kind === "task_assignment") || [];
    const activeOverdue = payload.followups?.filter(item => item.taskId === createdVolunteerTask.id
      && item.kind === "task_overdue"
      && !["dismissed", "sent"].includes(item.status)) || [];
    return task?.status === "done"
      && Boolean(task.startedAt)
      && Boolean(task.completedAt)
      && assignments.length === 2
      && assignments.every(item => item.deliveryStatus === "delivered")
      && activeOverdue.length === 0;
  }, { timeout: 15_000 }).toBe(true);

  const transactionRefresh = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/audit" && response.request().method() === "GET");
  await page.locator("#admin-load-orders").click();
  expect((await transactionRefresh).status()).toBe(200);
  const populatedAuditRegionMetrics = await page.locator("#admin-audit-list").evaluate(region => ({
    clientHeight: region.clientHeight,
    scrollHeight: region.scrollHeight
  }));
  expect(populatedAuditRegionMetrics.scrollHeight).toBeGreaterThan(populatedAuditRegionMetrics.clientHeight);
  expect(await page.locator("#admin-audit-list [data-audit-action]").count()).toBeGreaterThan(0);
  expect(await page.locator("#admin-job-list [data-automation-row]").count()).toBeGreaterThan(0);
  await expect(page.locator("#admin-job-list")).not.toContainText(/job_|followup_|@/);
  await expect(page.locator("#admin-system-monitor .admin-record-card code")).toHaveCount(0);
  await expect(page.locator("#admin-system-monitor")).not.toContainText(/data\/processed|db:\/\/|admin-audit\//);

  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#island-conditions`);
  await expect(page.locator(`[data-package-id="${sponsorTierId}"]`)).toContainText("Community Champion");
  await page.locator(`[data-package-id="${sponsorTierId}"]`).click();
  await expect(page.locator('#sponsor-inquiry-form [name="packageId"]')).toHaveValue(sponsorTierId);
  const publicVendorForm = page.locator("#vendor-application-form");
  await publicVendorForm.locator('[name="category"]').selectOption("artisan");
  await expect(publicVendorForm.locator(`[name="vendorOfferingId"] option[value="${vendorOfferingId}"]`)).toContainText("Premium marketplace");
  await publicVendorForm.locator('[name="vendorOfferingId"]').selectOption(vendorOfferingId);
  await expect(publicVendorForm.locator('[name="vendorOfferingId"]')).toHaveValue(vendorOfferingId);
  await expect(page.locator("#island-camera-grid article")).toHaveCount(8);
  await expect(page.locator("#island-condition-updated")).not.toHaveText("Checking sources");
  await expect(page.locator("#island-condition-updated")).toContainText("Board simulation");
  await expect(page.locator("#island-condition-kpis article").filter({ hasText: "Island load" })).toContainText(/\d+ simulated feeds across \d+ armed sources/);
  await expect(page.locator("#island-condition-kpis article").filter({ hasText: "Ferry wait" })).toContainText("simulated");
  await expect(page.locator("#island-camera-grid")).not.toContainText("operationally live");
  expect(pageErrors).toEqual([]);
});

test("volunteer handoff exposes only a server-published open registration provider", async ({ page }) => {
  const registrationUrl = "https://texassandfest.volunteerlocal.com/volunteer/?id=2027-browser-test";
  await page.route(`${apiBase}/api/public/bootstrap`, async route => {
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({
      response,
      json: {
        ...payload,
        guide: {
          ...payload.guide,
          volunteer: {
            ...payload.guide.volunteer,
            registrationStatus: "open",
            registrationUrl,
            note: "Current volunteer roles and shifts are open."
          }
        }
      }
    });
  });

  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#volunteer`);
  await expect(page.locator("#volunteer")).toHaveAttribute("data-registration-status", "open");
  await expect(page.locator("#volunteer-registration-link")).toBeVisible();
  await expect(page.locator("#volunteer-registration-link")).toHaveAttribute("href", registrationUrl);
  await expect(page.locator("#volunteer-information-link")).toHaveClass(/secondary/);
  await expect(page.locator("#volunteer-program-status")).toHaveText("Current volunteer roles and shifts are open.");
  await expect(page.locator("#volunteer")).not.toContainText("2026");
});

test("Guest Services moves a visitor request through staff response and private status", async ({ page }) => {
  test.setTimeout(60_000);
  const runId = randomUUID().slice(0, 8);
  const title = `Lost board presentation tote ${runId}`;
  const publicUpdate = `Guest Services located the tote and moved it to North Gate ${runId}.`;
  const internalNote = `Verified the claim tag before release ${runId}.`;

  await page.setViewportSize({ width: 390, height: 844 });
  const readinessResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/guest-services"
    && response.request().method() === "GET");
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#guest-services`);
  const readinessResponse = await readinessResponsePromise;
  const readiness = await readinessResponse.json();
  expect(readinessResponse.status()).toBe(200);
  expect(readiness).toMatchObject({ eventId: DEFAULT_EVENT_ID, available: true, consentVersion: "guest-services-intake-v1" });
  expect(readiness.categories).toHaveLength(6);
  expect(JSON.stringify(readiness)).not.toMatch(/defaultTeam|defaultPriority|secret/i);
  await expect(page.locator("#guest-services")).toHaveAttribute("aria-busy", "false");
  const form = page.locator("#guest-services-form");
  await expect(form.locator('[name="category"] option[value]:not([value=""])')).toHaveCount(6);
  await form.locator('[name="category"]').selectOption("lost_item");
  await form.locator('[name="festivalDay"]').selectOption({ label: "Saturday" });
  await form.locator('[name="title"]').fill(title);
  await form.locator('[name="details"]').fill("A blue canvas tote was left beside the family activity seating area.");
  await form.locator('[name="location"]').fill("Family Sand Lab");
  await form.locator('[name="contactName"]').fill("Board Browser Guest");
  await form.locator('[name="contactEmail"]').fill(`guest.${runId}@example.com`);
  await form.locator('[name="contactPhone"]').fill("+13615550199");
  await form.locator('[name="consentToContact"]').check();
  const createResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/guest-services"
    && response.request().method() === "POST");
  await form.locator('button[type="submit"]').click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json();
  expect(created.request).toMatchObject({ title, category: "lost_item", status: "open", assignedTeam: "guest-services" });
  expect(created.access.reference).toMatch(/^TSF-GS-[A-F0-9]{8}$/);
  expect(created.access.token).toMatch(/^tsfg_[A-Za-z0-9_-]+$/);
  expect(JSON.stringify(created.request)).not.toMatch(/accessTokenHash|idempotencyKeyHash|contactEmail|contactPhone/);
  await expect(page.locator("#guest-services-status-result")).toContainText(title);
  await expect(page.locator("#guest-services-status-result [data-status]")).toHaveText("Received");
  await expect(page.locator('#guest-services-status-form [name="reference"]')).toHaveValue(created.access.reference);
  await expect(page.locator('#guest-services-status-form [name="token"]')).toHaveValue(created.access.token);
  await assertChoiceTargets(page, "Guest Services visitor intake");
  await assertNoHorizontalOverflow(page);

  const admin = await page.context().newPage();
  try {
    await admin.setViewportSize({ width: 1280, height: 720 });
    await admin.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
    await expect(admin.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
    await admin.locator("#admin-guest-services-filter").selectOption("all");
    const adminCase = admin.locator("#admin-guest-services-list [data-guest-services-case]").filter({ hasText: title });
    await expect(adminCase).toHaveCount(1);
    await expect(adminCase).toContainText("Board Browser Guest");
    await expect(adminCase).not.toContainText(created.access.token);
    await adminCase.locator('[name="status"]').selectOption("in_progress");
    await adminCase.locator('[name="priority"]').selectOption("high");
    await adminCase.locator('[name="assignedTeam"]').selectOption("guest-services");
    await adminCase.locator('[name="publicMessage"]').fill(publicUpdate);
    await adminCase.locator('[name="internalNote"]').fill(internalNote);
    await adminCase.locator('[name="publishUpdate"]').check();
    const caseId = await adminCase.getAttribute("data-guest-services-case");
    const updateResponsePromise = admin.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/guest-services/cases/${caseId}`
      && response.request().method() === "PATCH");
    await adminCase.locator('button[type="submit"]').click();
    expect((await updateResponsePromise).status()).toBe(200);
    await expect(admin.locator("#admin-api-status")).toContainText("Guest Services case saved");
    await expect(adminCase).toContainText(publicUpdate);
    await expect(admin.locator("#admin-guest-services")).not.toContainText(created.access.token);
    await expect(admin.locator("#admin-guest-services")).not.toContainText(/accessTokenHash|idempotencyKeyHash/);
    await assertNoHorizontalOverflow(admin);

    const adminPayload = await adminApi("/api/admin/guest-services");
    expect(adminPayload.status).toBe(200);
    const storedCase = adminPayload.data.cases.find(item => item.reference === created.access.reference);
    expect(storedCase).toMatchObject({ title, status: "in_progress", priority: "high", assignedTeam: "guest-services" });
    expect(JSON.stringify(storedCase)).not.toMatch(/accessTokenHash|idempotencyKeyHash|tsfg_/);
  } finally {
    await admin.close();
  }

  const statusResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/guest-services/status"
    && response.request().method() === "POST");
  await page.locator('#guest-services-status-form button[type="submit"]').click();
  expect((await statusResponsePromise).status()).toBe(200);
  await expect(page.locator("#guest-services-status-result [data-status]")).toHaveText("In progress");
  await expect(page.locator("#guest-services-status-result")).toContainText(publicUpdate);
  await expect(page.locator("#guest-services-status-result")).not.toContainText(internalNote);
  await assertNoHorizontalOverflow(page);
});

test("Guest Services intake fails closed when server readiness is unavailable", async ({ page }) => {
  let unavailable = true;
  let readinessAttempts = 0;
  await page.route("**/api/public/guest-services", async route => {
    if (route.request().method() !== "GET") return route.continue();
    readinessAttempts += 1;
    if (!unavailable) return route.continue();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "temporarily unavailable" })
    });
  });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#guest-services`);
  const section = page.locator("#guest-services");
  await expect(section).toHaveAttribute("aria-busy", "false");
  const form = page.locator("#guest-services-form");
  await expect(form).toHaveAttribute("data-public-intake-state", "unavailable");
  await expect(form.locator('[name="category"]')).toBeDisabled();
  await expect(form.locator('button[type="submit"]')).toBeDisabled();
  await expect(form.locator('button[type="submit"]')).toHaveText("Guest Services unavailable");
  await expect(form.locator(".partner-form-status")).toContainText("Call Guest Services for help");
  await expect(page.locator('#guest-services-status-form button[type="submit"]')).toBeEnabled();

  unavailable = false;
  await expect(form).toHaveAttribute("data-public-intake-state", "ready", { timeout: 15_000 });
  await expect(form.locator('[name="category"]')).toBeEnabled();
  await expect(form.locator('button[type="submit"]')).toHaveText("Send request");
  expect(readinessAttempts).toBeGreaterThanOrEqual(2);
  await assertNoHorizontalOverflow(page);
});

test("partner intake and private-access recovery fail closed when server readiness is unavailable", async ({ page }) => {
  let unavailable = true;
  const attempts = new Map();
  for (const endpoint of ["partner-intake", "sponsors", "vendors"]) await page.route(`**/api/public/${endpoint}`, async route => {
    if (route.request().method() === "GET") {
      attempts.set(endpoint, (attempts.get(endpoint) || 0) + 1);
      if (!unavailable) return route.continue();
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporarily unavailable" }) });
      return;
    }
    await route.continue();
  });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);

  const sponsorForm = page.locator("#sponsor-inquiry-form");
  const vendorForm = page.locator("#vendor-application-form");
  const recoveryForm = page.locator("#partner-portal-recovery-form");
  await expect(sponsorForm).toHaveAttribute("data-public-intake-state", "unavailable");
  await expect(vendorForm).toHaveAttribute("data-public-intake-state", "unavailable");
  await expect(recoveryForm).toHaveAttribute("data-public-intake-state", "unavailable");
  await expect(recoveryForm).toHaveAttribute("aria-busy", "false");
  await expect(sponsorForm.locator('button[type="submit"]')).toBeDisabled();
  await expect(vendorForm.locator('button[type="submit"]')).toBeDisabled();
  await expect(recoveryForm.locator('button[type="submit"]')).toBeDisabled();
  await expect(sponsorForm.locator("[data-sponsor-program-unavailable]")).toContainText("We could not confirm the current sponsorship program");
  await expect(page.locator("#vendor-intake-availability")).toContainText("We could not confirm the current vendor program");
  await expect(sponsorForm.locator('a[href="mailto:sponsors@texassandfest.org"]')).toHaveText("email the sponsorship team");
  await expect(sponsorForm.locator('a[href="mailto:sponsors@texassandfest.org"]')).toBeVisible();
  await expect(vendorForm.locator('a[href="mailto:vendors@texassandfest.org"]')).toHaveText("email the vendor team");
  await expect(vendorForm.locator('a[href="mailto:vendors@texassandfest.org"]')).toBeVisible();
  await expect(recoveryForm.locator("[data-partner-recovery-availability]")).toContainText("Private-access email is temporarily unavailable");
  await expect(page.locator('#partner-status-form button[type="submit"]')).toBeEnabled();

  unavailable = false;
  await expect(sponsorForm).toHaveAttribute("data-public-intake-state", "ready", { timeout: 15_000 });
  await expect(vendorForm).toHaveAttribute("data-public-intake-state", "ready", { timeout: 15_000 });
  await expect(recoveryForm).toHaveAttribute("data-public-intake-state", "ready");
  await expect(sponsorForm.locator('a[href="mailto:sponsors@texassandfest.org"]')).toHaveCount(0);
  await expect(vendorForm.locator('a[href="mailto:vendors@texassandfest.org"]')).toHaveCount(0);
  for (const endpoint of ["partner-intake", "sponsors", "vendors"]) expect(attempts.get(endpoint)).toBeGreaterThanOrEqual(2);
  await assertNoHorizontalOverflow(page);
});

test("public intake warns only while visitor entries are unsaved", async ({ page }) => {
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  const sponsorForm = page.locator("#sponsor-inquiry-form");
  const vendorForm = page.locator("#vendor-application-form");
  await expect(sponsorForm).toHaveAttribute("data-public-intake-state", "ready");
  await expect(vendorForm).toHaveAttribute("data-public-intake-state", "ready");
  expect(await beforeUnloadPrevented(page)).toBe(false);

  await sponsorForm.locator('[name="organizationName"]').fill("Unsaved sponsor draft");
  expect(await beforeUnloadPrevented(page)).toBe(true);
  await vendorForm.locator('[name="organizationName"]').fill("Unsaved vendor draft");
  expect(await beforeUnloadPrevented(page)).toBe(true);
  await sponsorForm.evaluate(form => form.reset());
  expect(await beforeUnloadPrevented(page)).toBe(true);
  await vendorForm.evaluate(form => form.reset());
  expect(await beforeUnloadPrevented(page)).toBe(false);

  const guestServicesForm = page.locator("#guest-services-form");
  await expect(guestServicesForm).toHaveAttribute("data-public-intake-state", "ready");
  await guestServicesForm.locator('[name="title"]').fill("Unsaved Guest Services request");
  expect(await beforeUnloadPrevented(page)).toBe(true);
  await guestServicesForm.evaluate(form => form.reset());
  expect(await beforeUnloadPrevented(page)).toBe(false);
});

test("public signups recover accepted responses lost by the browser without duplicate records", async ({ page }) => {
  test.setTimeout(90_000);
  const runId = randomUUID().slice(0, 8);
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  await expect(page.locator("#sponsor-inquiry-form")).toHaveAttribute("data-public-intake-state", "ready");

  const submitAfterAcceptedResponseLoss = async ({ formSelector, preset, endpoint, organizationName }) => {
    const form = page.locator(formSelector);
    await form
      .locator(`[data-board-partner-preset="${preset}"]`)
      .evaluate((button) => button.click());
    await expect(form.locator(".partner-form-status")).toContainText("Synthetic details are ready");
    await form.locator('[name="organizationName"]').fill(organizationName);
    await form.locator('[name="consentToContact"]').check();
    await expect(form.locator('[name="consentToContact"]')).toBeChecked();
    expect(await form.evaluate(node => node.checkValidity())).toBe(true);
    let attempts = 0;
    let acceptedStatus = 0;
    let replayStatus = 0;
    let replayData = null;
    await page.route(`**${endpoint}`, async route => {
      attempts++;
      if (attempts === 1) {
        const accepted = await route.fetch();
        acceptedStatus = accepted.status();
        await route.abort("failed");
        return;
      }
      const replay = await route.fetch();
      replayStatus = replay.status();
      replayData = await replay.json();
      await route.fulfill({ response: replay });
    });

    await form.evaluate(node => node.requestSubmit());
    await expect(form.locator(".partner-form-status")).toContainText("retry protection remains active");
    await expect(form.locator('[name="organizationName"]')).toHaveValue(organizationName);
    expect(await form.evaluate(node => node.dataset.idempotencyKey?.length > 15)).toBe(true);
    expect(acceptedStatus).toBe(201);

    await form.evaluate(node => node.requestSubmit());
    await expect(form.locator(".partner-form-status")).toContainText("already received");
    expect(replayStatus).toBe(200);
    expect(replayData.duplicate).toBe(true);
    expect(replayData.application.organizationName).toBe(organizationName);
    expect(attempts).toBe(2);
    await page.unroute(`**${endpoint}`);
  };

  const vendorName = `Ambiguous Vendor ${runId}`;
  await submitAfterAcceptedResponseLoss({
    formSelector: "#vendor-application-form",
    preset: "vendor",
    endpoint: "/api/public/vendor-applications",
    organizationName: vendorName
  });
  const sponsorName = `Ambiguous Sponsor ${runId}`;
  await submitAfterAcceptedResponseLoss({
    formSelector: "#sponsor-inquiry-form",
    preset: "sponsor",
    endpoint: "/api/public/sponsor-inquiries",
    organizationName: sponsorName
  });

  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#guest-services`);
  const guestForm = page.locator("#guest-services-form");
  await expect(guestForm).toHaveAttribute("data-public-intake-state", "ready");
  const guestTitle = `Ambiguous Guest Services ${runId}`;
  await guestForm.locator('[name="category"]').selectOption({ index: 1 });
  await guestForm.locator('[name="festivalDay"]').selectOption("Saturday");
  await guestForm.locator('[name="title"]').fill(guestTitle);
  await guestForm.locator('[name="details"]').fill("Verify one accepted request safely returns after its first response is lost.");
  await guestForm.locator('[name="location"]').fill("North Gate");
  await guestForm.locator('[name="contactName"]').fill("Ambiguous Browser Guest");
  await guestForm.locator('[name="contactEmail"]').fill(`ambiguous.guest.${runId}@example.com`);
  await guestForm.locator('[name="contactPreference"]').selectOption("email");
  await guestForm.locator('[name="consentToContact"]').check();
  await expect(guestForm.locator('[name="consentToContact"]')).toBeChecked();
  expect(await guestForm.evaluate(node => node.checkValidity())).toBe(true);
  let guestAttempts = 0;
  let guestAcceptedStatus = 0;
  let guestReplayStatus = 0;
  let guestReplayData = null;
  await page.route("**/api/public/guest-services", async route => {
    guestAttempts++;
    if (guestAttempts === 1) {
      const accepted = await route.fetch();
      guestAcceptedStatus = accepted.status();
      await route.abort("failed");
      return;
    }
    const replay = await route.fetch();
    guestReplayStatus = replay.status();
    guestReplayData = await replay.json();
    await route.fulfill({ response: replay });
  });
  await guestForm.evaluate(node => node.requestSubmit());
  await expect(guestForm.locator(".partner-form-status")).toContainText("retry protection remains active");
  await expect(guestForm.locator('[name="title"]')).toHaveValue(guestTitle);
  expect(await guestForm.evaluate(node => node.dataset.idempotencyKey?.length > 15)).toBe(true);
  expect(guestAcceptedStatus).toBe(201);
  await guestForm.evaluate(node => node.requestSubmit());
  await expect(guestForm.locator(".partner-form-status")).toContainText("was received");
  expect(guestReplayStatus).toBe(200);
  expect(guestReplayData.replay).toBe(true);
  expect(guestAttempts).toBe(2);
  await page.unroute("**/api/public/guest-services");

  const workspace = await adminApi("/api/admin/partners");
  expect(workspace.status).toBe(200);
  expect(workspace.data.applications.filter(item => item.organizationName === vendorName)).toHaveLength(1);
  expect(workspace.data.applications.filter(item => item.organizationName === sponsorName)).toHaveLength(1);
  const guestWorkspace = await adminApi("/api/admin/guest-services");
  expect(guestWorkspace.status).toBe(200);
  expect(guestWorkspace.data.cases.filter(item => item.title === guestTitle)).toHaveLength(1);
});

test("Guest Services clears a definitive conflict key while preserving corrected entries", async ({ page }) => {
  const runId = randomUUID().slice(0, 8);
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#guest-services`);
  const form = page.locator("#guest-services-form");
  await expect(form).toHaveAttribute("data-public-intake-state", "ready");
  await form.locator('[name="category"]').selectOption({ index: 1 });
  await form.locator('[name="title"]').fill(`Corrected Guest Services ${runId}`);
  await form.locator('[name="details"]').fill("Keep these corrected request details available after a conflict.");
  await form.locator('[name="contactName"]').fill("Corrected Browser Guest");
  await form.locator('[name="contactEmail"]').fill(`corrected.guest.${runId}@example.com`);
  await form.locator('[name="contactPreference"]').selectOption("email");
  await form.locator('[name="consentToContact"]').check();
  await expect(form.locator('[name="consentToContact"]')).toBeChecked();
  expect(await form.evaluate(node => node.checkValidity())).toBe(true);
  const keys = [];
  let attempts = 0;
  let acceptedStatus = 0;
  await page.route("**/api/public/guest-services", async route => {
    attempts++;
    keys.push(route.request().headers()["idempotency-key"]);
    if (attempts === 1) {
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "That request key was already used for different details." }) });
      return;
    }
    const accepted = await route.fetch();
    acceptedStatus = accepted.status();
    await route.fulfill({ response: accepted });
  });
  await form.evaluate(node => node.requestSubmit());
  await expect(form.locator(".partner-form-status")).toContainText("details changed after an earlier attempt");
  await expect(form.locator('[name="details"]')).toHaveValue("Keep these corrected request details available after a conflict.");
  expect(await form.evaluate(node => node.dataset.idempotencyKey || null)).toBeNull();
  await form.evaluate(node => node.requestSubmit());
  await expect(form.locator(".partner-form-status")).toContainText("was received");
  expect(acceptedStatus).toBe(201);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBeTruthy();
  expect(keys[1]).not.toBe(keys[0]);
  expect(attempts).toBe(2);
  await page.unroute("**/api/public/guest-services");
});

test("ticket checkout and payment recover accepted responses lost by the browser", async ({ page }) => {
  test.setTimeout(90_000);
  const runId = randomUUID().slice(0, 8);
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#tickets`);
  const ticketCard = page.locator(".ticket-card").filter({ has: page.locator('[data-ticket-id="general-admission-3-day"]') });
  await ticketCard.locator('[data-ticket-action="increase"]').click();
  await page.locator("#ticket-policy-acceptance").check();
  await page.locator("#checkout-email").fill(`ambiguous.ticket.${runId}@example.com`);
  await expect(page.locator("#checkout-btn")).toBeEnabled();

  const checkoutKeys = [];
  let checkoutAttempts = 0;
  let acceptedCheckout = null;
  let replayedCheckout = null;
  await page.route("**/api/stripe/create-checkout-session", async route => {
    if (route.request().method() !== "POST") return route.continue();
    checkoutAttempts++;
    checkoutKeys.push(route.request().headers()["idempotency-key"]);
    const providerResponse = await route.fetch();
    const data = await providerResponse.json();
    if (checkoutAttempts === 1) {
      acceptedCheckout = data;
      await route.abort("failed");
      return;
    }
    replayedCheckout = data;
    await route.fulfill({ response: providerResponse });
  });

  await page.locator("#checkout-btn").evaluate(button => button.click());
  await expect(page.locator("#checkout-status")).toContainText("resume the same checkout without creating a second order");
  await expect(page.locator("#ticket-subtotal")).toHaveText("$30.00");
  await expect(page.locator("#checkout-email")).toHaveValue(`ambiguous.ticket.${runId}@example.com`);
  await expect(page.locator("#checkout-btn")).toBeEnabled();
  await page.locator("#checkout-btn").evaluate(button => button.click());
  await expect(page.locator("#ticket-demo-checkout")).toBeVisible();
  expect(checkoutAttempts).toBe(2);
  expect(checkoutKeys[0]).toBeTruthy();
  expect(checkoutKeys[1]).toBe(checkoutKeys[0]);
  expect(acceptedCheckout.duplicate).toBe(false);
  expect(replayedCheckout.duplicate).toBe(true);
  expect(replayedCheckout.orderId).toBe(acceptedCheckout.orderId);
  expect(replayedCheckout.demoCheckout.token).toBe(acceptedCheckout.demoCheckout.token);
  await page.unroute("**/api/stripe/create-checkout-session");

  let paymentAttempts = 0;
  let acceptedPayment = null;
  let replayedPayment = null;
  await page.route("**/api/public/board-ticket-checkout/complete", async route => {
    if (route.request().method() !== "POST") return route.continue();
    paymentAttempts++;
    const providerResponse = await route.fetch();
    const data = await providerResponse.json();
    if (paymentAttempts === 1) {
      acceptedPayment = data;
      await route.abort("failed");
      return;
    }
    replayedPayment = data;
    await route.fulfill({ response: providerResponse });
  });

  await page.locator("#ticket-demo-pay").evaluate(button => button.click());
  await expect(page.locator("#ticket-demo-status")).toContainText("the same order will be reused");
  await expect(page.locator("#ticket-demo-pay")).toBeEnabled();
  await page.locator("#ticket-demo-pay").evaluate(button => button.click());
  await expect(page.locator("#ticket-demo-status")).toContainText("Demo payment complete");
  expect(paymentAttempts).toBe(2);
  expect(acceptedPayment.duplicate).toBe(false);
  expect(replayedPayment.duplicate).toBe(true);
  expect(replayedPayment.receipt.orderId).toBe(acceptedPayment.receipt.orderId);
  expect(replayedPayment.receipt.fulfillmentCount).toBe(1);
  await page.unroute("**/api/public/board-ticket-checkout/complete");

  const orders = await adminApi("/api/admin/orders?limit=200");
  expect(orders.status).toBe(200);
  const matchingOrders = orders.data.pendingOrders.filter(item => item.record?.id === acceptedCheckout.orderId);
  expect(matchingOrders).toHaveLength(1);
  expect(matchingOrders[0].record.status).toBe("paid");
  const events = await adminApi("/api/admin/payment-events?limit=200");
  expect(events.status).toBe(200);
  expect(events.data.paymentEvents.filter(item => item.record?.ticketReconciliation?.orderId === acceptedCheckout.orderId)).toHaveLength(1);
  const fulfillment = await adminApi("/api/admin/fulfillment?limit=200");
  expect(fulfillment.status).toBe(200);
  expect(fulfillment.data.fulfillment.filter(item => item.record?.orderId === acceptedCheckout.orderId)).toHaveLength(1);
});

test("task updates recover accepted responses lost by the browser without duplicate history", async ({ page }) => {
  const runId = randomUUID().slice(0, 8);
  const partners = await adminApi("/api/admin/partners");
  expect(partners.status).toBe(200);
  const volunteer = partners.data.assignmentDirectory.volunteers.find(item => item.emailAvailable);
  const blockerNote = `Need two additional radios for recovery proof ${runId}.`;
  const created = await adminApi("/api/admin/partners/tasks", {
    method: "POST",
    headers: { "idempotency-key": `browser-task-create-${runId}` },
    body: {
      assigneeType: "volunteer",
      assigneeId: volunteer.id,
      title: `Replay-safe task update ${runId}`,
      description: "Confirm an accepted blocker reaches Operations exactly once.",
      priority: "high",
      dueAt: "2027-04-10T15:00:00.000Z"
    }
  });
  expect(created.status).toBe(201);

  const taskUrl = new URL(taskPortalUrlForTask(created.data.task, {
    config: taskPortalConfig({
      SANDFEST_ENV: "development",
      SANDFEST_TASK_PORTAL_SECRET: PORTAL_SECRET,
      SANDFEST_PUBLIC_SITE_URL: webBase
    })
  }));
  taskUrl.searchParams.set("apiBase", apiBase);
  await page.goto(taskUrl.toString());
  await expect(page).toHaveURL(/#task-status$/);
  await expect(page.locator("#task-status-result")).toContainText(created.data.task.title);

  const retryKeys = [];
  const responses = [];
  let attempts = 0;
  await page.route("**/api/public/task-status/update", async route => {
    if (route.request().method() !== "POST") return route.continue();
    attempts++;
    retryKeys.push(route.request().headers()["idempotency-key"]);
    const providerResponse = await route.fetch();
    responses.push(await providerResponse.json());
    if (attempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response: providerResponse });
  });

  await page.locator('#task-status-update [name="note"]').fill(blockerNote);
  await page.locator('[data-task-action="block"]').click();
  await expect(page.locator(".task-status-message")).toContainText("Operations will record it only once");
  await expect(page.locator('[data-task-action="block"]')).toBeEnabled();
  await page.locator('[data-task-action="block"]').click();
  await expect(page.locator(".task-status-message")).toContainText("Operations already has this update");
  await expect(page.locator("#task-status-result")).toContainText(blockerNote);

  expect(attempts).toBe(2);
  expect(retryKeys[0]).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/);
  expect(retryKeys[1]).toBe(retryKeys[0]);
  expect(responses[0].replay).toBe(false);
  expect(responses[1].replay).toBe(true);
  expect(JSON.stringify(responses)).not.toContain(retryKeys[0]);
  expect(JSON.stringify(responses)).not.toMatch(/requestId|requestFingerprint/);
  await page.unroute("**/api/public/task-status/update");

  const updatedPartners = await adminApi("/api/admin/partners");
  const updatedTask = updatedPartners.data.tasks.find(item => item.id === created.data.task.id);
  expect(updatedTask.status).toBe("blocked");
  expect(updatedTask.assigneeUpdates.filter(item => item.note === blockerNote)).toHaveLength(1);
  expect(updatedPartners.data.activity.filter(item => item.entityType === "task"
    && item.entityId === created.data.task.id
    && item.type === "task.assignee_updated")).toHaveLength(1);
  expect(JSON.stringify(updatedTask)).not.toContain(retryKeys[0]);
  expect(JSON.stringify(updatedTask)).not.toMatch(/requestId|requestFingerprint/);

  const audit = await adminApi("/api/admin/audit?limit=200");
  expect(audit.status).toBe(200);
  expect(audit.data.audit.filter(item => item.record?.target?.id === created.data.task.id
    && item.record?.action === "task.assignee.block")).toHaveLength(1);
});

test("finance creation recovers accepted responses without duplicate records or audits", async ({ page }) => {
  const runId = randomUUID().slice(0, 8);
  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-budget`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  const lineForm = page.locator("#admin-create-budget-line");
  await expect(lineForm).toBeVisible();

  const lineKeys = [];
  const lineResponses = [];
  let lineAttempts = 0;
  await page.route("**/api/admin/budget/lines", async route => {
    if (route.request().method() !== "POST") return route.continue();
    lineAttempts++;
    lineKeys.push(route.request().headers()["idempotency-key"]);
    const providerResponse = await route.fetch();
    lineResponses.push(await providerResponse.json());
    if (lineAttempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response: providerResponse });
  });

  await lineForm.locator('[name="name"]').fill(`Recovery finance ${runId}`);
  await lineForm.locator('[name="ownerTeam"]').selectOption("finance");
  await lineForm.locator('[name="amount"]').fill("4200.00");
  await lineForm.locator('[name="notes"]').fill("Accepted-response recovery allocation");
  await lineForm.evaluate(form => form.requestSubmit());
  await expect(lineForm.locator("[data-finance-create-status]")).toContainText("Finance will record it only once");
  await lineForm.evaluate(form => form.requestSubmit());
  await expect(lineForm.locator("[data-finance-create-status]")).toContainText("Added Recovery finance");
  expect(lineKeys[0]).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/);
  expect(lineKeys[1]).toBe(lineKeys[0]);
  expect(lineResponses[0].replay).toBe(false);
  expect(lineResponses[1].replay).toBe(true);
  expect(lineResponses[1].line.id).toBe(lineResponses[0].line.id);
  await page.unroute("**/api/admin/budget/lines");

  const createdLine = lineResponses[0].line;
  const expenseForm = page.locator("#admin-create-expense");
  await expenseForm.locator('[name="budgetLineId"]').selectOption(createdLine.id);
  const expenseKeys = [];
  const expenseResponses = [];
  let expenseAttempts = 0;
  await page.route("**/api/admin/budget/expenses", async route => {
    if (route.request().method() !== "POST") return route.continue();
    expenseAttempts++;
    expenseKeys.push(route.request().headers()["idempotency-key"]);
    const providerResponse = await route.fetch();
    expenseResponses.push(await providerResponse.json());
    if (expenseAttempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response: providerResponse });
  });

  await expenseForm.locator('[name="vendorName"]').fill(`Recovery Vendor ${runId}`);
  await expenseForm.locator('[name="amount"]').fill("875.00");
  await expenseForm.locator('[name="dueDate"]').fill("2027-03-25");
  await expenseForm.locator('[name="description"]').fill("Replay-safe finance equipment request");
  await expenseForm.evaluate(form => form.requestSubmit());
  await expect(expenseForm.locator("[data-finance-create-status]")).toContainText("Finance will record it only once");
  await expenseForm.evaluate(form => form.requestSubmit());
  await expect(expenseForm.locator("[data-finance-create-status]")).toContainText("Submitted $875.00");
  expect(expenseKeys[0]).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/);
  expect(expenseKeys[1]).toBe(expenseKeys[0]);
  expect(expenseResponses[0].replay).toBe(false);
  expect(expenseResponses[1].replay).toBe(true);
  expect(expenseResponses[1].expense.id).toBe(expenseResponses[0].expense.id);
  await page.unroute("**/api/admin/budget/expenses");

  const budget = await adminApi("/api/admin/budget");
  expect(budget.data.budgetLines.filter(item => item.id === createdLine.id)).toHaveLength(1);
  expect(budget.data.expenses.filter(item => item.id === expenseResponses[0].expense.id)).toHaveLength(1);
  const audit = await adminApi("/api/admin/audit?limit=200");
  expect(audit.data.audit.filter(item => item.record?.action === "budget.line.create"
    && item.record?.target?.id === createdLine.id)).toHaveLength(1);
  expect(audit.data.audit.filter(item => item.record?.action === "budget.expense.submit"
    && item.record?.target?.id === expenseResponses[0].expense.id)).toHaveLength(1);
  expect(JSON.stringify({ lineResponses, expenseResponses })).not.toContain(lineKeys[0]);
  expect(JSON.stringify({ lineResponses, expenseResponses })).not.toContain(expenseKeys[0]);
});

test("catalog creation recovers accepted responses without duplicate tiers, offerings, snapshots, or audits", async ({ page }) => {
  const runId = randomUUID().slice(0, 8);
  const sponsorTierId = `recovery-sponsor-${runId}`;
  const sponsorTierName = `Recovery Sponsor ${runId}`;
  const vendorOfferingId = `recovery-vendor-${runId}`;
  const vendorOfferingName = `Recovery Marketplace ${runId}`;

  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-config`);
  const sponsorForm = page.locator("#admin-create-sponsor-package");
  await expect(sponsorForm).toBeVisible({ timeout: 25_000 });

  const sponsorKeys = [];
  const sponsorResponses = [];
  let sponsorAttempts = 0;
  await page.route("**/api/admin/sponsor-packages", async route => {
    if (route.request().method() !== "POST") return route.continue();
    sponsorAttempts++;
    sponsorKeys.push(route.request().headers()["idempotency-key"]);
    const serverResponse = await route.fetch();
    sponsorResponses.push(await serverResponse.json());
    if (sponsorAttempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response: serverResponse });
  });

  await sponsorForm.locator('[name="name"]').fill(sponsorTierName);
  await sponsorForm.locator('[name="id"]').fill(sponsorTierId);
  await sponsorForm.locator('[name="amount"]').fill("6500.00");
  await sponsorForm.locator('[name="benefits"]').fill("Board recognition\nPublic sponsor showcase");
  await sponsorForm.evaluate(form => form.requestSubmit());
  await expect(sponsorForm.locator(".partner-form-status")).toContainText("Retry safely; saved once");
  await sponsorForm.evaluate(form => form.requestSubmit());
  await expect(sponsorForm.locator(".partner-form-status")).toContainText("Saved");
  expect(sponsorKeys[0]).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/);
  expect(sponsorKeys[1]).toBe(sponsorKeys[0]);
  expect(sponsorResponses[0].replay).toBe(false);
  expect(sponsorResponses[1].replay).toBe(true);
  expect(sponsorResponses[1].sponsorPackage.id).toBe(sponsorResponses[0].sponsorPackage.id);
  await page.unroute("**/api/admin/sponsor-packages");

  const vendorForm = page.locator("#admin-create-vendor-offering");
  const vendorKeys = [];
  const vendorResponses = [];
  let vendorAttempts = 0;
  await page.route("**/api/admin/vendor-offerings", async route => {
    if (route.request().method() !== "POST") return route.continue();
    vendorAttempts++;
    vendorKeys.push(route.request().headers()["idempotency-key"]);
    const serverResponse = await route.fetch();
    vendorResponses.push(await serverResponse.json());
    if (vendorAttempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response: serverResponse });
  });

  await vendorForm.locator('[name="name"]').fill(vendorOfferingName);
  await vendorForm.locator('[name="id"]').fill(vendorOfferingId);
  await vendorForm.locator('[name="amount"]').fill("1800.00");
  await vendorForm.locator('[name="intakeMode"]').selectOption("application");
  await vendorForm.locator('[name="categories"][value="retail"]').check();
  await vendorForm.locator('[name="categories"][value="artisan"]').check();
  await vendorForm.locator('[name="description"]').fill("Replay-safe marketplace offering for board presentation readiness.");
  await vendorForm.locator('[name="inclusions"]').fill("Expanded booth footprint\nPublic vendor listing");
  await vendorForm.evaluate(form => form.requestSubmit());
  await expect(vendorForm.locator(".partner-form-status")).toContainText("Retry safely; saved once");
  await vendorForm.evaluate(form => form.requestSubmit());
  await expect(vendorForm.locator(".partner-form-status")).toContainText("Saved");
  expect(vendorKeys[0]).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/);
  expect(vendorKeys[1]).toBe(vendorKeys[0]);
  expect(vendorResponses[0].replay).toBe(false);
  expect(vendorResponses[1].replay).toBe(true);
  expect(vendorResponses[1].vendorOffering.id).toBe(vendorResponses[0].vendorOffering.id);
  await page.unroute("**/api/admin/vendor-offerings");

  const config = await adminApi("/api/admin/config");
  expect(config.data.config.sponsorPackages.filter(item => item.id === sponsorTierId)).toHaveLength(1);
  expect(config.data.config.vendorOfferings.filter(item => item.id === vendorOfferingId)).toHaveLength(1);
  const audit = await adminApi("/api/admin/audit?limit=500");
  expect(audit.data.audit.filter(item => item.record?.action === "sponsor-package.create"
    && item.record?.target?.id === sponsorTierId)).toHaveLength(1);
  expect(audit.data.audit.filter(item => item.record?.action === "vendor-offering.create"
    && item.record?.target?.id === vendorOfferingId)).toHaveLength(1);
  const snapshots = await adminApi("/api/admin/snapshots?limit=500");
  expect(snapshots.data.snapshots.filter(item => item.record?.reason === `Before sponsor package creation: ${sponsorTierId}`)).toHaveLength(1);
  expect(snapshots.data.snapshots.filter(item => item.record?.reason === `Before vendor offering creation: ${vendorOfferingId}`)).toHaveLength(1);
  expect(JSON.stringify({ sponsorResponses, vendorResponses, config, audit, snapshots })).not.toContain(sponsorKeys[0]);
  expect(JSON.stringify({ sponsorResponses, vendorResponses, config, audit, snapshots })).not.toContain(vendorKeys[0]);
});

test("task and key-date creation recover accepted responses without duplicate work or audits", async ({ page }) => {
  const runId = randomUUID().slice(0, 8);
  const initialPartners = await adminApi("/api/admin/partners");
  expect(initialPartners.status).toBe(200);
  const application = initialPartners.data.applications.find(item => item.type === "sponsor")
    || initialPartners.data.applications[0];
  expect(application?.id).toBeTruthy();

  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-partner-milestones-workspace`);
  const taskForm = page.locator("#admin-create-task");
  await expect(taskForm).toBeVisible({ timeout: 25_000 });
  await taskForm.locator('[name="assigneeType"]').selectOption("team");
  await expect(taskForm.locator('[name="assigneeId"] option[value="operations"]')).toHaveCount(1);
  await taskForm.locator('[name="assigneeId"]').selectOption("operations");

  const taskKeys = [];
  const taskResponses = [];
  let taskAttempts = 0;
  await page.route("**/api/admin/partners/tasks", async route => {
    if (route.request().method() !== "POST") return route.continue();
    taskAttempts++;
    taskKeys.push(route.request().headers()["idempotency-key"]);
    const serverResponse = await route.fetch();
    taskResponses.push(await serverResponse.json());
    if (taskAttempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response: serverResponse });
  });

  await taskForm.locator('[name="title"]').fill(`Recovery delegation ${runId}`);
  await taskForm.locator('[name="priority"]').selectOption("high");
  await taskForm.locator('[name="dueAt"]').fill("2027-04-10T10:30");
  await taskForm.locator('[name="description"]').fill("Accepted-response recovery for an Operations delegation.");
  await taskForm.evaluate(form => form.requestSubmit());
  await expect(taskForm.locator(".partner-form-status")).toContainText("Operations will delegate it only once");
  await taskForm.evaluate(form => form.requestSubmit());
  await expect(taskForm.locator(".partner-form-status")).toContainText("Task delegated");
  expect(taskKeys[0]).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/);
  expect(taskKeys[1]).toBe(taskKeys[0]);
  expect(taskResponses[0].replay).toBe(false);
  expect(taskResponses[1].replay).toBe(true);
  expect(taskResponses[1].task.id).toBe(taskResponses[0].task.id);
  await page.unroute("**/api/admin/partners/tasks");

  const milestoneForm = page.locator("#admin-create-milestone");
  await milestoneForm.locator('[name="applicationId"]').selectOption(application.id);
  const milestoneKeys = [];
  const milestoneResponses = [];
  let milestoneAttempts = 0;
  await page.route(/\/api\/admin\/partners\/applications\/[^/]+\/milestones$/, async route => {
    if (route.request().method() !== "POST") return route.continue();
    milestoneAttempts++;
    milestoneKeys.push(route.request().headers()["idempotency-key"]);
    const serverResponse = await route.fetch();
    milestoneResponses.push(await serverResponse.json());
    if (milestoneAttempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response: serverResponse });
  });

  await milestoneForm.locator('[name="label"]').fill(`Recovery key date ${runId}`);
  await milestoneForm.locator('[name="dueAt"]').fill("2027-03-24T15:00");
  await milestoneForm.locator('[name="assigneeTeam"]').selectOption("sponsor");
  await milestoneForm.locator('[name="reminderLeadDays"]').fill("5");
  await milestoneForm.evaluate(form => form.requestSubmit());
  await expect(milestoneForm.locator(".partner-form-status")).toContainText("Operations will record it only once");
  await milestoneForm.evaluate(form => form.requestSubmit());
  await expect(milestoneForm.locator(".partner-form-status")).toContainText("Partner key date added");
  expect(milestoneKeys[0]).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/);
  expect(milestoneKeys[1]).toBe(milestoneKeys[0]);
  expect(milestoneResponses[0].replay).toBe(false);
  expect(milestoneResponses[1].replay).toBe(true);
  expect(milestoneResponses[1].milestone.id).toBe(milestoneResponses[0].milestone.id);

  const partners = await adminApi("/api/admin/partners");
  expect(partners.data.tasks.filter(item => item.id === taskResponses[0].task.id)).toHaveLength(1);
  expect(partners.data.milestones.filter(item => item.id === milestoneResponses[0].milestone.id)).toHaveLength(1);
  expect(partners.data.activity.filter(item => item.type === "task.created"
    && item.entityId === taskResponses[0].task.id)).toHaveLength(1);
  expect(partners.data.activity.filter(item => item.type === "milestone.created"
    && item.entityId === milestoneResponses[0].milestone.id)).toHaveLength(1);
  const audit = await adminApi("/api/admin/audit?limit=200");
  expect(audit.data.audit.filter(item => item.record?.action === "partner.task.create"
    && item.record?.target?.id === taskResponses[0].task.id)).toHaveLength(1);
  expect(audit.data.audit.filter(item => item.record?.action === "partner.milestone.create"
    && item.record?.target?.id === milestoneResponses[0].milestone.id)).toHaveLength(1);
  expect(JSON.stringify({ taskResponses, milestoneResponses, partners, audit })).not.toContain(taskKeys[0]);
  expect(JSON.stringify({ taskResponses, milestoneResponses, partners, audit })).not.toContain(milestoneKeys[0]);
});

test("custom sponsor deliverable creation recovers an accepted response without duplicate fulfillment or audit", async ({ page }) => {
  const runId = randomUUID().slice(0, 8);
  const label = `Recovery sponsor display ${runId}`;
  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-sponsor-fulfillment-workspace`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  const form = page.locator("#admin-sponsor-fulfillment [data-create-deliverable]").first();
  await expect(form).toBeVisible();
  const applicationId = await form.getAttribute("data-create-deliverable");
  const endpoint = `/api/admin/partners/applications/${applicationId}/deliverables`;
  const keys = [];
  const responses = [];
  let attempts = 0;
  await page.route(`**${endpoint}`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    attempts++;
    keys.push(route.request().headers()["idempotency-key"]);
    const serverResponse = await route.fetch();
    responses.push(await serverResponse.json());
    if (attempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response: serverResponse });
  });

  await form.locator('[name="label"]').fill(label);
  await form.locator('[name="ownerId"]').fill("staff_sponsor");
  await form.locator('[name="dueAt"]').fill("2027-03-26T15:00");
  await form.locator('[name="description"]').fill("Track one custom board sponsor display through fulfillment.");
  await form.evaluate(node => node.requestSubmit());
  await expect(page.locator("#admin-api-status")).toContainText("Retry safely; saved once");
  await expect(form.locator('[name="label"]')).toHaveValue(label);
  expect(await form.evaluate(node => node.dataset.idempotencyKey?.length > 15)).toBe(true);

  await form.evaluate(node => node.requestSubmit());
  await expect(page.locator("#admin-api-status")).toContainText("Sponsor deliverable saved");
  expect(keys[0]).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/);
  expect(keys[1]).toBe(keys[0]);
  expect(responses[0].replay).toBe(false);
  expect(responses[1].replay).toBe(true);
  expect(responses[1].deliverable.id).toBe(responses[0].deliverable.id);
  expect(attempts).toBe(2);
  await page.unroute(`**${endpoint}`);

  const partners = await adminApi("/api/admin/partners");
  expect(partners.data.deliverables.filter(item => item.id === responses[0].deliverable.id)).toHaveLength(1);
  expect(partners.data.deliverables.filter(item => item.label === label)).toHaveLength(1);
  expect(partners.data.activity.filter(item => item.type === "deliverable.created"
    && item.entityId === responses[0].deliverable.id)).toHaveLength(1);
  const audit = await adminApi("/api/admin/audit?limit=200");
  expect(audit.data.audit.filter(item => item.record?.action === "partner.deliverable.create"
    && item.record?.target?.id === responses[0].deliverable.id)).toHaveLength(1);
  expect(JSON.stringify({ responses, partners, audit })).not.toContain(keys[0]);
});

test("outreach creation recovers accepted responses without duplicate targets, campaigns, or audits", async ({ page }) => {
  const runId = randomUUID().slice(0, 8);
  const prospectName = `Recovery outreach target ${runId}`;
  const industry = `recovery-industry-${runId}`;
  const campaignName = `Recovery outreach campaign ${runId}`;

  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-outreach-workspace`);
  const prospectForm = page.locator("#admin-create-prospect");
  await expect(prospectForm).toBeVisible({ timeout: 25_000 });

  const prospectKeys = [];
  const prospectResponses = [];
  let prospectAttempts = 0;
  await page.route("**/api/admin/outreach/prospects", async route => {
    if (route.request().method() !== "POST") return route.continue();
    prospectAttempts++;
    prospectKeys.push(route.request().headers()["idempotency-key"]);
    const serverResponse = await route.fetch();
    prospectResponses.push(await serverResponse.json());
    if (prospectAttempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response: serverResponse });
  });

  await prospectForm.locator('[name="organizationName"]').fill(prospectName);
  await prospectForm.locator('[name="contactName"]').fill("Recovery Outreach");
  await prospectForm.locator('[name="industry"]').fill(industry);
  await prospectForm.locator('[name="city"]').fill("Port Aransas");
  await prospectForm.locator('[name="postalCode"]').fill("78373");
  await prospectForm.locator('[name="latitude"]').fill("27.8339");
  await prospectForm.locator('[name="longitude"]').fill("-97.0611");
  await prospectForm.locator('[name="contactEmail"]').fill(`recovery-outreach-${runId}@example.com`);
  await prospectForm.locator('[name="communityFit"]').check();
  await prospectForm.locator('[name="contactBasis"]').selectOption("business_relevance");
  await prospectForm.locator('[name="status"]').selectOption("contact_ready");
  await prospectForm.evaluate(form => form.requestSubmit());
  await expect(prospectForm.locator(".partner-form-status")).toContainText("Retry safely; saved once");
  await prospectForm.evaluate(form => form.requestSubmit());
  await expect(prospectForm.locator(".partner-form-status")).toContainText(`Scored ${prospectName}`);
  expect(prospectKeys[0]).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/);
  expect(prospectKeys[1]).toBe(prospectKeys[0]);
  expect(prospectResponses[0].replay).toBe(false);
  expect(prospectResponses[1].replay).toBe(true);
  expect(prospectResponses[1].prospect.id).toBe(prospectResponses[0].prospect.id);
  await page.unroute("**/api/admin/outreach/prospects");

  const campaignForm = page.locator("#admin-create-campaign");
  await campaignForm.locator('[name="name"]').fill(campaignName);
  await campaignForm.locator('[name="industries"]').fill(industry);
  await campaignForm.locator('[name="cities"]').fill("Port Aransas");
  await campaignForm.locator('[name="minFitScore"]').fill("0");
  const previewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/campaigns/preview"
    && response.request().method() === "POST");
  await campaignForm.locator("#admin-preview-campaign").click();
  expect((await previewResponse).status()).toBe(200);
  await expect(campaignForm.locator('button[type="submit"]')).toBeEnabled();

  const campaignKeys = [];
  const campaignResponses = [];
  let campaignAttempts = 0;
  await page.route("**/api/admin/outreach/campaigns", async route => {
    if (route.request().method() !== "POST") return route.continue();
    campaignAttempts++;
    campaignKeys.push(route.request().headers()["idempotency-key"]);
    const serverResponse = await route.fetch();
    campaignResponses.push(await serverResponse.json());
    if (campaignAttempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response: serverResponse });
  });

  await campaignForm.evaluate(form => form.requestSubmit());
  await expect(campaignForm.locator(".partner-form-status")).toContainText("Retry safely; saved once");
  await campaignForm.evaluate(form => form.requestSubmit());
  await expect(campaignForm.locator(".partner-form-status")).toContainText(`${campaignName} saved`);
  expect(campaignKeys[0]).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/);
  expect(campaignKeys[1]).toBe(campaignKeys[0]);
  expect(campaignResponses[0].replay).toBe(false);
  expect(campaignResponses[1].replay).toBe(true);
  expect(campaignResponses[1].campaign.id).toBe(campaignResponses[0].campaign.id);

  const outreach = await adminApi("/api/admin/outreach");
  expect(outreach.data.prospects.filter(item => item.id === prospectResponses[0].prospect.id)).toHaveLength(1);
  expect(outreach.data.campaigns.filter(item => item.id === campaignResponses[0].campaign.id)).toHaveLength(1);
  const partners = await adminApi("/api/admin/partners");
  expect(partners.data.activity.filter(item => item.type === "outreach.prospect.created"
    && item.entityId === prospectResponses[0].prospect.id)).toHaveLength(1);
  expect(partners.data.activity.filter(item => item.type === "outreach.campaign.created"
    && item.entityId === campaignResponses[0].campaign.id)).toHaveLength(1);
  const audit = await adminApi("/api/admin/audit?limit=200");
  expect(audit.data.audit.filter(item => item.record?.action === "outreach.prospect.create"
    && item.record?.target?.id === prospectResponses[0].prospect.id)).toHaveLength(1);
  expect(audit.data.audit.filter(item => item.record?.action === "outreach.campaign.create"
    && item.record?.target?.id === campaignResponses[0].campaign.id)).toHaveLength(1);
  expect(JSON.stringify({ prospectResponses, campaignResponses, outreach, partners, audit })).not.toContain(prospectKeys[0]);
  expect(JSON.stringify({ prospectResponses, campaignResponses, outreach, partners, audit })).not.toContain(campaignKeys[0]);
});

test("private capability links recover from transient API failures without reloads", async ({ browser }) => {
  test.setTimeout(90_000);
  const runId = randomUUID().slice(0, 8);
  const partners = await adminApi("/api/admin/partners");
  expect(partners.status).toBe(200);
  const application = partners.data.applications.find(item => item.type === "sponsor") || partners.data.applications[0];
  const portalAccess = await adminApi(`/api/admin/partners/applications/${application.id}/portal-access`, { method: "POST", body: {} });
  expect(portalAccess.status).toBe(200);

  const volunteer = partners.data.assignmentDirectory.volunteers.find(item => item.emailAvailable);
  const taskTitle = `Transient recovery assignment ${runId}`;
  const taskResult = await adminApi("/api/admin/partners/tasks", {
    method: "POST",
    headers: { "idempotency-key": `browser-private-task-create-${runId}` },
    body: {
      assigneeType: "volunteer",
      assigneeId: volunteer.id,
      title: taskTitle,
      description: "Confirm the private task link recovers without replaying a task update.",
      priority: "medium",
      dueAt: "2027-04-10T15:00:00.000Z"
    }
  });
  expect(taskResult.status).toBe(201);
  const taskPortalConfigForBrowser = taskPortalConfig({
    SANDFEST_ENV: "development",
    SANDFEST_TASK_PORTAL_SECRET: PORTAL_SECRET,
    SANDFEST_PUBLIC_SITE_URL: webBase
  });
  const taskUrl = taskPortalUrlForTask(taskResult.data.task, { config: taskPortalConfigForBrowser });

  const prospectName = `Recovery Coast Sponsor ${runId}`;
  const prospectResult = await adminApi("/api/admin/outreach/prospects", {
    method: "POST",
    headers: { "idempotency-key": `browser-private-prospect-create-${runId}` },
    body: {
      organizationName: prospectName,
      contactName: "Recovery Browser",
      contactEmail: `recovery.${runId}@example.com`,
      industry: "hospitality",
      city: "Port Aransas",
      postalCode: "78373",
      latitude: 27.8339,
      longitude: -97.0611,
      communityFit: true,
      contactBasis: "business_relevance",
      status: "contact_ready"
    }
  });
  expect(prospectResult.status).toBe(201);
  const prospect = prospectResult.data.prospect;
  const preferenceUrl = outreachPreferenceUrlForProspect(prospect, {
    config: outreachPreferencesConfig({
      SANDFEST_ENV: "development",
      SANDFEST_OUTREACH_PREFERENCES_SECRET: OUTREACH_SECRET,
      SANDFEST_PUBLIC_SITE_URL: webBase
    })
  });
  const sponsorCatalog = await fetch(`${apiBase}/api/public/sponsors`).then(response => response.json());
  const invitationResult = await adminApi(`/api/admin/outreach/prospects/${prospect.id}/sponsor-invitation`, {
    method: "POST",
    body: { action: "issue", packageId: sponsorCatalog.sponsorPackages[0].id }
  });
  expect(invitationResult.status).toBe(200);

  const guestTitle = `Transient Guest Services request ${runId}`;
  const guestReadiness = await fetch(`${apiBase}/api/public/guest-services`).then(response => response.json());
  const guestResponse = await fetch(`${apiBase}/api/public/guest-services`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `browser-recovery-${runId}` },
    body: JSON.stringify({
      category: guestReadiness.categories[0].id,
      festivalDay: "Saturday",
      title: guestTitle,
      details: "Verify that a private Guest Services lookup recovers after one temporary API failure.",
      location: "North Gate",
      contactName: "Recovery Browser Guest",
      contactEmail: `guest.recovery.${runId}@example.com`,
      contactPreference: "email",
      consentToContact: true
    })
  });
  expect(guestResponse.status).toBe(201);
  const guest = await guestResponse.json();

  const addApiBase = value => {
    const url = new URL(value);
    url.searchParams.set("apiBase", apiBase);
    return url.toString();
  };
  const context = await browser.newContext();
  const openWithFirstFailure = async ({ url, endpoint, failureSelector, failureText, retrySelector, success }) => {
    const page = await context.newPage();
    let attempts = 0;
    await page.route(`**${endpoint}`, async route => {
      attempts++;
      if (attempts === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporarily unavailable" }) });
        return;
      }
      await route.continue();
    });
    await page.goto(addApiBase(url));
    await expect(page.locator(failureSelector)).toContainText(failureText);
    if (retrySelector) {
      const retryButton = page.locator(retrySelector);
      await expect(retryButton).toBeVisible();
      await expect(retryButton).toBeEnabled();
      await expect(retryButton).toHaveText("Retry now");
      expect((await retryButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await retryButton.click();
    }
    await success(page);
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => performance.getEntriesByType("navigation")[0]?.type)).toBe("navigate");
    await page.close();
  };

  await openWithFirstFailure({
    url: portalAccess.data.portalAccess.url,
    endpoint: "/api/public/partner-status",
    failureSelector: "#partner-status-form .partner-form-status",
    failureText: "retry automatically",
    success: page => expect(page.locator("#partner-status-result")).toContainText(application.organizationName, { timeout: 15_000 })
  });
  await openWithFirstFailure({
    url: taskUrl,
    endpoint: "/api/public/task-status",
    failureSelector: "#task-status-result",
    failureText: "temporarily unavailable",
    retrySelector: "[data-task-status-retry]",
    success: page => expect(page.locator("#task-status-result")).toContainText(taskTitle, { timeout: 15_000 })
  });
  await openWithFirstFailure({
    url: preferenceUrl,
    endpoint: "/api/public/outreach-preferences",
    failureSelector: "#outreach-preferences-status",
    failureText: "temporarily unavailable",
    retrySelector: "#outreach-preferences-unsubscribe",
    success: page => expect(page.locator("#outreach-preferences-copy")).toContainText(prospectName, { timeout: 15_000 })
  });
  await openWithFirstFailure({
    url: invitationResult.data.invitation.url,
    endpoint: "/api/public/sponsor-invitation",
    failureSelector: "#sponsor-invitation-copy",
    failureText: "temporarily unavailable",
    retrySelector: "[data-sponsor-retry]",
    success: page => expect(page.locator('#sponsor-inquiry-form [name="organizationName"]')).toHaveValue(prospectName, { timeout: 15_000 })
  });

  const rejectedInvitationUrl = new URL(invitationResult.data.invitation.url);
  const rejectedInvitationParams = new URLSearchParams(rejectedInvitationUrl.hash.split("?")[1]);
  rejectedInvitationParams.set("token", `${rejectedInvitationParams.get("token")}x`);
  rejectedInvitationUrl.hash = `sponsor-invitation?${rejectedInvitationParams}`;
  const rejectedInvitationPage = await context.newPage();
  let rejectedInvitationAttempts = 0;
  await rejectedInvitationPage.route("**/api/public/sponsor-invitation", async route => {
    rejectedInvitationAttempts++;
    await route.continue();
  });
  await rejectedInvitationPage.goto(addApiBase(rejectedInvitationUrl));
  await expect(rejectedInvitationPage.locator("#sponsor-invitation")).toHaveAttribute("data-state", "error");
  await expect(rejectedInvitationPage).toHaveURL(/#sponsors$/);
  await rejectedInvitationPage.waitForTimeout(2_500);
  expect(rejectedInvitationAttempts).toBe(1);
  await rejectedInvitationPage.close();

  const guestPage = await context.newPage();
  let guestAttempts = 0;
  await guestPage.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#guest-services`);
  await expect(guestPage.locator("#guest-services-form")).toHaveAttribute("data-public-intake-state", "ready");
  await guestPage.route("**/api/public/guest-services/status", async route => {
    guestAttempts++;
    if (guestAttempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporarily unavailable" }) });
      return;
    }
    await route.continue();
  });
  const guestStatusForm = guestPage.locator("#guest-services-status-form");
  await guestStatusForm.locator('[name="reference"]').fill(guest.access.reference);
  await guestStatusForm.locator('[name="token"]').fill(guest.access.token);
  await guestStatusForm.locator('button[type="submit"]').click();
  await expect(guestStatusForm.locator(".partner-form-status")).toContainText("temporarily unavailable");
  await expect(guestPage.locator("#guest-services-status-result")).toContainText(guestTitle, { timeout: 15_000 });
  expect(guestAttempts).toBeGreaterThanOrEqual(2);
  expect(await guestPage.evaluate(() => performance.getEntriesByType("navigation")[0]?.type)).toBe("navigate");
  await guestPage.close();
  await context.close();
});

test("incident delivery verification safely resolves ambiguous provider outcomes", async ({ page }) => {
  test.setTimeout(60_000);
  const runId = randomUUID().slice(0, 8);
  const title = `Provider verification drill ${runId}`;
  const incidentResult = await adminApi("/api/admin/island-conditions/incidents", {
    method: "POST",
    headers: { "idempotency-key": `browser-provider-incident-${runId}` },
    body: {
      title,
      summary: "Verify ambiguous provider outcomes without duplicate operational email.",
      severity: "high",
      ownerTeam: "operations"
    }
  });
  expect(incidentResult.status).toBe(201);
  const incidentId = incidentResult.data.incident.id;
  const dispatchPath = `/api/admin/island-conditions/incidents/${incidentId}/dispatches`;
  const deliveredResult = await adminApi(dispatchPath, {
    method: "POST",
    body: {
      assigneeType: "team",
      assigneeId: "operations",
      channel: "email",
      title: `Board provider-delivered check ${runId}`,
      instructions: "Verify the provider result before any retry."
    }
  });
  const notDeliveredResult = await adminApi(dispatchPath, {
    method: "POST",
    body: {
      assigneeType: "team",
      assigneeId: "guest-services",
      channel: "email",
      title: `Board provider-not-delivered check ${runId}`,
      instructions: "Confirm no provider acceptance before retrying."
    }
  });
  expect(deliveredResult.status).toBe(201);
  expect(notDeliveredResult.status).toBe(201);
  const deliveredDispatchId = deliveredResult.data.dispatch.id;
  const notDeliveredDispatchId = notDeliveredResult.data.dispatch.id;
  for (const dispatchId of [deliveredDispatchId, notDeliveredDispatchId]) {
    const approval = await adminApi(`${dispatchPath}/${dispatchId}/review`, {
      method: "POST",
      body: { action: "approve" }
    });
    expect(approval.status).toBe(200);
  }
  await forceUnknownIncidentDelivery(deliveredDispatchId, `browser-delivered-${runId}`);
  await forceUnknownIncidentDelivery(notDeliveredDispatchId, `browser-not-delivered-${runId}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-island-conditions`);
  await expect(page.locator("#network-status")).toHaveText("Demo");
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  const incidentCard = page.locator(".admin-incident-card").filter({ hasText: title });
  await expect(incidentCard).toBeVisible();

  let deliveredRow = incidentCard.locator(`[data-dispatch-control="${deliveredDispatchId}"]`);
  let deliveredForm = deliveredRow.locator("[data-reconcile-dispatch]");
  await expect(deliveredForm).toContainText("Provider verification required");
  expect((await deliveredForm.locator('[name="providerMessageId"]').boundingBox())?.height).toBeGreaterThanOrEqual(40);
  await expect(deliveredRow.getByRole("button", { name: "Queue email" })).toHaveCount(0);
  await expect(deliveredRow.getByRole("button", { name: "Dismiss draft" })).toHaveCount(0);
  await deliveredForm.locator('[name="resolutionNote"]').fill("Brevo delivery log checked by the operations lead.");
  await deliveredForm.getByRole("button", { name: "Record delivered" }).click();
  await expect(page.locator("#admin-api-status")).toContainText(/provider message ID/i);

  await deliveredForm.locator('[name="providerMessageId"]').fill(`brevo-board-${runId}`);
  const deliveredResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === `${dispatchPath}/${deliveredDispatchId}/delivery-reconciliation`
      && response.request().method() === "POST";
  });
  await deliveredForm.getByRole("button", { name: "Record delivered" }).click();
  expect((await deliveredResponse).status()).toBe(200);
  await expect(page.locator("#admin-api-status")).toContainText("Provider delivery recorded");
  deliveredRow = incidentCard.locator(`[data-dispatch-control="${deliveredDispatchId}"]`);
  await expect(deliveredRow.locator('[data-dispatch-message] [data-status="sent"]')).toBeVisible();
  await expect(deliveredRow.locator('[data-resolution="confirmed_sent"]')).toContainText("Provider delivery confirmed");
  await expect(deliveredRow.locator("[data-reconcile-dispatch]")).toHaveCount(0);

  let notDeliveredRow = incidentCard.locator(`[data-dispatch-control="${notDeliveredDispatchId}"]`);
  const notDeliveredForm = notDeliveredRow.locator("[data-reconcile-dispatch]");
  await notDeliveredForm.locator('[name="resolutionNote"]').fill("Brevo confirms no message was accepted for delivery.");
  const notDeliveredResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === `${dispatchPath}/${notDeliveredDispatchId}/delivery-reconciliation`
      && response.request().method() === "POST";
  });
  await notDeliveredForm.getByRole("button", { name: "Confirm not delivered" }).click();
  expect((await notDeliveredResponse).status()).toBe(200);
  await expect(page.locator("#admin-api-status")).toContainText("ready for staff follow-up");
  notDeliveredRow = incidentCard.locator(`[data-dispatch-control="${notDeliveredDispatchId}"]`);
  await expect(notDeliveredRow.locator('[data-dispatch-message] [data-status="failed"]')).toBeVisible();
  await expect(notDeliveredRow.locator('[data-resolution="confirmed_not_sent"]')).toContainText("Provider confirmed no delivery");
  await expect(notDeliveredRow.getByRole("button", { name: "Queue email" })).toBeVisible();
  await expect(notDeliveredRow.locator("[data-reconcile-dispatch]")).toHaveCount(0);

  const undersizedControls = await incidentCard.locator('button, input:not([type="checkbox"]):not([type="radio"]), select, textarea').evaluateAll(controls => controls.flatMap(control => {
    const bounds = control.getBoundingClientRect();
    const styles = getComputedStyle(control);
    if (
      bounds.width <= 0
      || bounds.height <= 0
      || styles.display === "none"
      || styles.visibility === "hidden"
      || (bounds.width >= 24 && bounds.height >= 24)
    ) return [];
    return [{
      name: control.getAttribute("name") || control.textContent?.trim() || control.id,
      width: Math.round(bounds.width * 10) / 10,
      height: Math.round(bounds.height * 10) / 10
    }];
  }));
  expect(undersizedControls).toEqual([]);
  await assertChoiceTargets(page, "Incident provider verification");
  await assertNoHorizontalOverflow(page);
  await assertNoAccessibilityViolations(page, "Incident provider verification");
});

test("partner delivery verification prevents duplicate automated messages", async ({ page }) => {
  test.setTimeout(60_000);
  const runId = randomUUID().slice(0, 8);
  const applicationId = `browser_partner_reconciliation_${runId}`;
  const deliveredFollowupId = `browser_partner_delivered_${runId}`;
  const notDeliveredFollowupId = `browser_partner_not_delivered_${runId}`;
  const recipient = `provider-check-${runId}@example.com`;
  const now = new Date().toISOString();
  await updatePlatformDoc(runtimeRoot, "partnerOps", current => {
    const doc = normalizePartnerOperations(current);
    const application = {
      id: applicationId,
      eventId: DEFAULT_EVENT_ID,
      reference: `TSF-BROWSER-${runId.toUpperCase()}`,
      type: "vendor",
      intakeMode: "application",
      status: "submitted",
      organizationName: `Provider Check Vendor ${runId}`,
      contactName: "Board Provider Check",
      contactEmail: recipient,
      consentToContact: true,
      consentPreferenceVersion: 1,
      consentCapturedAt: now,
      createdAt: now,
      updatedAt: now
    };
    const followup = (id, subject) => ({
      id,
      applicationId,
      kind: "application_received",
      channel: "email",
      recipient,
      status: "approved",
      subject,
      body: "Provider verification is required before this message can be retried.",
      approvedBy: "board-browser-acceptance",
      approvedAt: now,
      createdAt: now,
      updatedAt: now
    });
    return {
      ...doc,
      lastUpdated: now,
      applications: [...doc.applications, application],
      followups: [
        ...doc.followups,
        followup(deliveredFollowupId, `Partner provider-delivered check ${runId}`),
        followup(notDeliveredFollowupId, `Partner provider-not-delivered check ${runId}`)
      ]
    };
  }, { fallback: normalizePartnerOperations(null) });
  await forceUnknownPartnerDelivery(deliveredFollowupId, `browser-partner-delivered-${runId}`);
  await forceUnknownPartnerDelivery(notDeliveredFollowupId, `browser-partner-not-delivered-${runId}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-partners`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await expect(page.locator('[data-command-signal="messages"]')).toContainText("2 provider checks");

  let deliveredRow = page.locator(`[data-followup="${deliveredFollowupId}"]`);
  let deliveredForm = deliveredRow.locator("[data-reconcile-followup]");
  await expect(deliveredForm).toContainText("Provider verification required");
  await expect(deliveredRow.getByRole("button", { name: "Retry send" })).toHaveCount(0);
  await expect(deliveredRow.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
  await deliveredForm.locator('[name="resolutionNote"]').fill("Brevo delivery log checked by the partner operations lead.");
  await deliveredForm.getByRole("button", { name: "Record delivered" }).click();
  await expect(page.locator("#admin-api-status")).toContainText(/provider message ID/i);
  deliveredForm = deliveredRow.locator("[data-reconcile-followup]");
  await deliveredForm.locator('[name="providerMessageId"]').fill(`brevo-partner-board-${runId}`);
  await deliveredForm.locator('[name="resolutionNote"]').fill("Brevo delivery log checked by the partner operations lead.");
  const deliveredResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === `/api/admin/partners/followups/${deliveredFollowupId}/delivery-reconciliation`
      && response.request().method() === "POST";
  });
  await deliveredForm.getByRole("button", { name: "Record delivered" }).click();
  expect((await deliveredResponse).status()).toBe(200);
  await expect(page.locator("#admin-api-status")).toContainText("Provider delivery recorded");
  deliveredRow = page.locator(`[data-followup="${deliveredFollowupId}"]`);
  await expect(deliveredRow.locator('[data-resolution="confirmed_sent"]')).toContainText("Provider delivery confirmed");
  await expect(deliveredRow.locator("[data-reconcile-followup]")).toHaveCount(0);

  let notDeliveredRow = page.locator(`[data-followup="${notDeliveredFollowupId}"]`);
  const notDeliveredForm = notDeliveredRow.locator("[data-reconcile-followup]");
  await notDeliveredForm.locator('[name="resolutionNote"]').fill("Brevo confirms no message was accepted for delivery.");
  const notDeliveredResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === `/api/admin/partners/followups/${notDeliveredFollowupId}/delivery-reconciliation`
      && response.request().method() === "POST";
  });
  await notDeliveredForm.getByRole("button", { name: "Confirm not delivered" }).click();
  expect((await notDeliveredResponse).status()).toBe(200);
  await expect(page.locator("#admin-api-status")).toContainText("available for staff follow-up");
  notDeliveredRow = page.locator(`[data-followup="${notDeliveredFollowupId}"]`);
  await expect(notDeliveredRow.locator('[data-resolution="confirmed_not_sent"]')).toContainText("Provider confirmed no delivery");
  await expect(notDeliveredRow.getByRole("button", { name: "Retry send" })).toBeVisible();
  await expect(notDeliveredRow.locator("[data-reconcile-followup]")).toHaveCount(0);

  const providerRows = page.locator(`[data-followup="${deliveredFollowupId}"], [data-followup="${notDeliveredFollowupId}"]`);
  const undersizedControls = await providerRows.locator('button, input:not([type="checkbox"]):not([type="radio"]), select, textarea').evaluateAll(controls => controls.filter(control => {
    const bounds = control.getBoundingClientRect();
    const styles = getComputedStyle(control);
    return bounds.width > 0
      && bounds.height > 0
      && styles.display !== "none"
      && styles.visibility !== "hidden"
      && (bounds.width < 24 || bounds.height < 24);
  }).map(control => control.getAttribute("name") || control.textContent?.trim() || control.id));
  expect(undersizedControls).toEqual([]);
  await assertChoiceTargets(page, "Partner provider verification");
  await assertNoHorizontalOverflow(page);
  await assertNoAccessibilityViolations(page, "Partner provider verification");
});

test("incident creation recovers an accepted response without duplicate command records or audits", async ({ page }) => {
  const runId = randomUUID().slice(0, 8);
  const title = `Recovery island incident ${runId}`;
  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#operations`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  const form = page.locator("#admin-create-incident");
  await expect(form).toBeVisible();
  const keys = [];
  const responses = [];
  let attempts = 0;
  await page.route("**/api/admin/island-conditions/incidents", async route => {
    if (route.request().method() !== "POST") return route.continue();
    attempts++;
    keys.push(route.request().headers()["idempotency-key"]);
    const serverResponse = await route.fetch();
    responses.push(await serverResponse.json());
    if (attempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response: serverResponse });
  });

  await form.locator('[name="title"]').fill(title);
  await form.locator('[name="severity"]').selectOption("high");
  await form.locator('[name="ownerTeam"]').selectOption("traffic");
  await form.locator('[name="ownerName"]').fill("Traffic command");
  await form.locator('[name="summary"]').fill("Keep one command record when the accepted response is lost.");
  await form.locator('[name="publicImpact"]').check();
  await form.evaluate(node => node.requestSubmit());
  await expect(page.locator("#admin-api-status")).toContainText("Retry safely; saved once");
  await expect(form.locator('[name="title"]')).toHaveValue(title);
  expect(await form.evaluate(node => node.dataset.idempotencyKey?.length > 15)).toBe(true);

  await form.evaluate(node => node.requestSubmit());
  await expect(page.locator("#admin-api-status")).toContainText("Incident opened");
  expect(keys[0]).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/);
  expect(keys[1]).toBe(keys[0]);
  expect(responses[0].replay).toBe(false);
  expect(responses[1].replay).toBe(true);
  expect(responses[1].incident.id).toBe(responses[0].incident.id);
  expect(responses[1].incident.publicImpact).toBe(true);
  expect(attempts).toBe(2);
  await page.unroute("**/api/admin/island-conditions/incidents");

  const conditions = await adminApi("/api/admin/island-conditions");
  const audit = await adminApi("/api/admin/audit?limit=200");
  expect(conditions.data.incidents.filter(item => item.id === responses[0].incident.id)).toHaveLength(1);
  expect(conditions.data.incidents.filter(item => item.title === title)).toHaveLength(1);
  expect(audit.data.audit.filter(item => item.record?.action === "conditions.incident.create"
    && item.record?.target?.id === responses[0].incident.id)).toHaveLength(1);
  expect(JSON.stringify({ responses, conditions, audit })).not.toContain(keys[0]);
});

test("operations command summary fits and navigates across board viewports", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  const commandSignals = page.locator("#admin-command-signals [data-command-signal]");
  await expect(commandSignals).toHaveCount(8);
  await expect(commandSignals.last()).toBeInViewport({ ratio: 1 });
  const commandBounds = await commandSignals.evaluateAll(cards => cards.map(card => {
    const bounds = card.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom };
  }));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(commandBounds.every(bounds => bounds.top >= 0 && bounds.bottom <= 720)).toBe(true);

  for (const { width, columns } of [
    { width: 1138, columns: 3 },
    { width: 921, columns: 3 },
    { width: 920, columns: 1 }
  ]) {
    await page.setViewportSize({ width, height: 800 });
    await assertNoHorizontalOverflow(page);
    await expect.poll(() => page.locator("#admin-documents").evaluate(panel => {
      const panelBounds = panel.getBoundingClientRect();
      return [...panel.children].every(child => {
        const childBounds = child.getBoundingClientRect();
        return childBounds.left >= panelBounds.left - 1 && childBounds.right <= panelBounds.right + 1;
      });
    })).toBe(true);
    expect(await page.locator("#admin-document-upload").evaluate(form => (
      getComputedStyle(form).gridTemplateColumns.split(" ").length
    ))).toBe(columns);
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  const commandTargets = {
    applications: { id: "admin-partner-applications-workspace", heading: "Applications and accounting" },
    receivables: { id: "admin-receivables-workspace", heading: "Open accounts" },
    messages: { id: "admin-partner-followups-workspace", heading: "Message drafts" },
    assignments: { id: "admin-partner-tasks-workspace", heading: "Staff and volunteer work board" },
    "key-dates": { id: "admin-partner-milestones-workspace", heading: "Partner key dates and reminder cadence" },
    sponsors: { id: "admin-sponsor-fulfillment-workspace", heading: "Sponsor brand and benefit fulfillment" },
    vendors: { id: "admin-vendor-readiness-workspace", heading: "Vendor compliance and load-in readiness" },
    outreach: { id: "admin-outreach-prospects-workspace", heading: "Outreach pipeline" }
  };
  for (const [signal, { id: targetId, heading }] of Object.entries(commandTargets)) {
    await page.locator(`[data-command-signal="${signal}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
    await expect.poll(() => page.evaluate(({ id, heading }) => {
      const target = document.getElementById(id);
      const workspaceNav = document.querySelector(".admin-workspace-nav");
      const bounds = target?.getBoundingClientRect();
      return Boolean(bounds
        && bounds.top >= (workspaceNav?.getBoundingClientRect().bottom || 0)
        && bounds.top < window.innerHeight
        && target.contains(document.activeElement)
        && document.activeElement?.textContent?.trim() === heading);
    }, { id: targetId, heading }), { timeout: 2_000 }).toBe(true);
  }
  await page.locator('[data-command-signal="applications"]').focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => {
    const target = document.querySelector("#admin-partner-applications-workspace");
    const active = document.activeElement;
    return Boolean(target?.contains(active)
      && active?.textContent?.trim() === "Applications and accounting"
      && getComputedStyle(active).outlineStyle !== "none");
  }), { timeout: 2_000 }).toBe(true);
  const firstFollowup = page.locator("#admin-partner-followups [data-followup]").first();
  await expect(firstFollowup.locator('[data-review-followup][data-action="approve"]')).toBeVisible();
  const editedFollowupId = await firstFollowup.getAttribute("data-followup");
  await firstFollowup.locator("summary").click();
  const draftSubject = firstFollowup.locator('.admin-followup-editor input[aria-label="Message subject"]');
  const draftBody = firstFollowup.locator('.admin-followup-editor textarea[aria-label="Message body"]');
  const editedSubject = `${await draftSubject.inputValue()} | Browser reviewed`;
  await draftSubject.fill(editedSubject);
  await draftBody.fill(`${await draftBody.inputValue()}\n\nReviewed in Operations before approval.`);
  const editResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/followups/${editedFollowupId}/draft` && response.request().method() === "PATCH");
  await firstFollowup.locator("[data-save-draft]").click();
  const editResponse = await editResponsePromise;
  expect(editResponse.status()).toBe(200);
  await expect(page.locator(`#admin-partner-followups [data-followup="${editedFollowupId}"] header strong`)).toHaveText(editedSubject);
  await expect(page.locator(`#admin-partner-followups [data-followup="${editedFollowupId}"] [data-review-followup][data-action="approve"]`)).toBeVisible();
  const reviewReadyOutreach = page.locator("#admin-partner-followups [data-followup]")
    .filter({ hasText: "outreach sequence" })
    .filter({ has: page.locator('[data-review-followup][data-action="approve"]') });
  await expect(reviewReadyOutreach).toHaveCount(1);
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 768, height: 844 });
  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  const readinessFilterButtons = page.locator(".admin-readiness-filter button");
  await expect(readinessFilterButtons).toHaveCount(2);
  for (const button of await readinessFilterButtons.all()) {
    await expect.poll(() => button.evaluate(element => (
      element.scrollWidth <= element.clientWidth + 1
      && element.scrollHeight <= element.clientHeight + 1
    ))).toBe(true);
  }
  await expect.poll(() => page.locator(".admin-workspace-nav").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await expect(page.locator("#admin-command-signals [data-command-signal]")).toHaveCount(8);
  for (const [signal, { id: targetId, heading }] of Object.entries(commandTargets)) {
    await page.locator(`[data-command-signal="${signal}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
    await expect.poll(() => page.evaluate(({ id, heading }) => {
      const target = document.getElementById(id);
      const workspaceNav = document.querySelector(".admin-workspace-nav");
      const bounds = target?.getBoundingClientRect();
      return Boolean(bounds
        && bounds.top >= (workspaceNav?.getBoundingClientRect().bottom || 0)
        && bounds.top < window.innerHeight
        && target.contains(document.activeElement)
        && document.activeElement?.textContent?.trim() === heading);
    }, { id: targetId, heading }), { timeout: 2_000 }).toBe(true);
  }
  await assertNoHorizontalOverflow(page);
});

test("prepared partner portals land on authenticated status at mobile width", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
  const admin = await context.newPage();
  try {
    await admin.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
    await expect(admin.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });

    for (const organizationName of ["Gulf Shore Credit Union", "Coastal Bites"]) {
      const application = admin.locator("#admin-partner-applications [data-partner-application]").filter({ hasText: organizationName });
      await expect(application).toHaveCount(1);
      const popupPromise = admin.waitForEvent("popup");
      await application.locator("[data-open-demo-portal]").click();
      const portal = await popupPromise;
      await expect(portal.locator("#partner-status-result")).toContainText(organizationName);
      await expect(portal.locator("#partner-status-result")).toBeFocused();
      await assertTargetClearsTopbar(portal, "#partner-status-result", 12);
      await expect(portal.locator(".partner-status-heading h3")).toBeInViewport();
      expect(await portal.locator(".partner-status-next").evaluate(nextStep => {
        const [label, title, target] = nextStep.children;
        const labelBounds = label.getBoundingClientRect();
        const titleBounds = title.getBoundingClientRect();
        const targetBounds = target.getBoundingClientRect();
        return labelBounds.bottom <= titleBounds.top && titleBounds.bottom <= targetBounds.top;
      })).toBe(true);
      await assertChoiceTargets(portal, `${organizationName} partner portal`);
      await assertNoHorizontalOverflow(portal);
      await portal.close();
    }
  } finally {
    await context.close();
  }
});

test("visitor hero and navigation stay ordered across intermediate widths", async ({ page }) => {
  for (const width of [768, 1024, 1160]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
    await expect(page.locator(".hero h1")).toHaveText("Texas SandFest");
    await expect(page.locator(".hero-actions")).toBeInViewport({ ratio: 1 });
    await assertChoiceTargets(page, `Visitor ${width}px`);
    await expect(page.locator("#public-navigation")).toBeHidden();
    await expect(page.locator("#mobile-nav-toggle")).toBeVisible();
    const layout = await page.locator(".hero").evaluate(hero => {
      const rect = selector => hero.querySelector(selector).getBoundingClientRect();
      const values = [".hero-content", ".motion-console", ".event-card"].map(rect);
      return {
        hero: hero.getBoundingClientRect().toJSON(),
        content: values[0].toJSON(),
        motion: values[1].toJSON(),
        event: values[2].toJSON()
      };
    });
    expect(layout.content.top).toBeGreaterThanOrEqual(layout.hero.top);
    expect(layout.content.bottom).toBeLessThan(layout.motion.top);
    expect(layout.content.bottom).toBeLessThan(layout.event.top);
    expect(layout.motion.right).toBeLessThan(layout.event.left);
    expect(layout.motion.bottom).toBeLessThanOrEqual(layout.hero.bottom);
    expect(layout.event.bottom).toBeLessThanOrEqual(layout.hero.bottom);
    await assertNoHorizontalOverflow(page);
    if (width === 1024) {
      await page.locator("#mobile-nav-toggle").click();
      await expect(page.locator("#public-navigation")).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await page.keyboard.press("Escape");
      await expect(page.locator("#public-navigation")).toBeHidden();
    }
  }

  await page.setViewportSize({ width: 1440, height: 720 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
  await expect(page.locator("#public-navigation")).toBeHidden();
  await expect(page.locator("#mobile-nav-toggle")).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1441, height: 720 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
  await expect(page.locator("#public-navigation")).toBeVisible();
  await expect(page.locator("#mobile-nav-toggle")).toBeHidden();
  expect(await page.locator("#public-navigation").evaluate(navigation => [...navigation.querySelectorAll('a[data-audience="ops"]')]
    .filter(link => link.getClientRects().length > 0)
    .map(link => ({ label: link.textContent.trim(), href: link.getAttribute("href") })))).toEqual([]);
  await assertNoHorizontalOverflow(page);
});

test("visitor view switch opens the dedicated operations portal", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
  const operationsSurface = page.locator("[data-operations-surface]");
  await expect(operationsSurface).toBeVisible();
  await expect(operationsSurface).toHaveAttribute("href", `${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await operationsSurface.click();
  await expect(page).toHaveURL(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await expect(page).toHaveTitle("Texas SandFest Operations");
  await expect(page.locator("#admin-config h1")).toHaveText("Festival operations command center");
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await expect(page.locator("header nav")).toHaveCount(0);
  await expect(page.locator(".admin-workspace-nav")).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("Operations automatically reconnects after a transient API interruption", async ({ page }) => {
  let sessionAttempts = 0;
  await page.route(`${apiBase}/api/admin/session`, async route => {
    sessionAttempts += 1;
    if (sessionAttempts === 1) await route.abort("connectionrefused");
    else await route.continue();
  });

  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-partners`);
  const status = page.locator("#admin-api-status");
  await expect(status).toHaveAttribute("data-workspace-state", "failed", { timeout: 10_000 });
  await expect(status).toContainText("Retrying automatically.");
  await expect(status).toHaveAttribute("role", "alert");
  await expect(status).toHaveAttribute("aria-busy", "false");

  await expectAdminWorkspaceReady(page);
  await expect(status).toContainText("Loaded");
  expect(sessionAttempts).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#admin-partner-kpis article").first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("canonical iOS links retain safe visitor web fallbacks", async ({ page }) => {
  let conciergeRequests = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/public/concierge") conciergeRequests += 1;
  });

  const ticketsUrl = new URL("/tickets", webBase);
  ticketsUrl.searchParams.set("apiBase", apiBase);
  await page.goto(ticketsUrl.toString());
  await expect(page).toHaveURL(/\/tickets\?[^#]+#tickets$/);
  await expect(page.locator("#tickets")).toBeInViewport({ ratio: 0.1 });

  const sandyUrl = new URL("/sandy", webBase);
  sandyUrl.searchParams.set("apiBase", apiBase);
  sandyUrl.searchParams.set("question", "Where is ADA parking?");
  await page.goto(sandyUrl.toString());
  await expect(page).toHaveURL(/\/sandy\?[^#]+#concierge$/);
  await expect(page.locator("#ask-input")).toHaveValue("Where is ADA parking?");
  await expect(page.locator("#chat .concierge-answer")).toHaveCount(0);
  expect(conciergeRequests).toBe(0);

  const sculptorsUrl = new URL("/sculptors", webBase);
  sculptorsUrl.searchParams.set("apiBase", apiBase);
  await page.goto(sculptorsUrl.toString());
  await expect(page).toHaveURL(/\/sculptors\?[^#]+#sculptors-showcase$/);
  await expect(page.locator("#sculptors-showcase")).toBeInViewport({ ratio: 0.1 });

  const scheduleUrl = new URL("/schedule/fri-gates", webBase);
  scheduleUrl.searchParams.set("apiBase", apiBase);
  await page.goto(scheduleUrl.toString());
  await expect(page).toHaveURL(/\/schedule\/fri-gates\?[^#]+#schedule-fri-gates$/);
  const scheduleItem = page.locator("#schedule-fri-gates");
  await expect(scheduleItem).toBeInViewport({ ratio: 0.5 });
  await expect(scheduleItem).toHaveCSS("border-left-color", "rgb(180, 67, 53)");
  await assertNoHorizontalOverflow(page);
});

test("approved sponsor branding stays readable with a pale brand palette", async ({ page }) => {
  const response = await fetch(`${apiBase}/api/public/sponsors`);
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.sponsors?.length).toBeGreaterThan(0);
  const sponsor = {
    ...payload.sponsors[0],
    displayName: "Pale Coast Sponsor",
    website: "https://sponsor.example/",
    primaryColor: "#FFFFFF",
    secondaryColor: "#FFFDEB",
    logo: null
  };
  const secondSponsor = {
    ...sponsor,
    id: `${sponsor.id}-community-bank`,
    displayName: "Coastal Community Bank",
    tagline: "Healthier coast, stronger community"
  };
  await page.route(`${apiBase}/api/public/sponsors`, route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ...payload, sponsors: [sponsor, secondSponsor] })
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  const featured = page.locator("#public-sponsor-featured");
  await expect(featured).toBeVisible();
  await expect(featured.locator("h3")).toHaveText("Backing the beach");
  await expect(featured).toBeInViewport({ ratio: 0.5 });
  const showcase = page.locator("#public-sponsor-showcase");
  await expect(showcase).toHaveAttribute("data-count", "2");
  await expect(showcase.locator(".public-sponsor-card")).toHaveCount(2);
  expect(await showcase.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
  expect(await featured.evaluate((stage, packages) => Boolean(stage.compareDocumentPosition(packages) & Node.DOCUMENT_POSITION_FOLLOWING), await page.locator("#public-sponsor-tiers").elementHandle())).toBe(true);
  const card = page.locator("#public-sponsor-showcase .public-sponsor-card").filter({ hasText: sponsor.displayName });
  await expect(card).toHaveCount(1);
  await expect(card).toBeInViewport({ ratio: 0.5 });
  await expect(card).toContainText("Visit partner");
  const colors = await card.evaluate(element => {
    const channels = value => String(value).match(/\d+(?:\.\d+)?/g).slice(0, 3).map(channel => Number(channel) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    const luminance = value => {
      const [red, green, blue] = channels(value);
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const contrast = (foreground, background) => {
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    };
    const tier = element.querySelector(".public-sponsor-copy small");
    const mark = element.querySelector(".public-sponsor-mark > span");
    const cardStyles = getComputedStyle(element);
    const tierStyles = getComputedStyle(tier);
    const markStyles = getComputedStyle(mark);
    const markBackground = getComputedStyle(mark.parentElement).backgroundColor;
    return {
      primary: cardStyles.getPropertyValue("--sponsor-primary").trim(),
      secondary: cardStyles.getPropertyValue("--sponsor-secondary").trim(),
      tierContrast: contrast(tierStyles.color, cardStyles.backgroundColor),
      markContrast: contrast(markStyles.color, markBackground)
    };
  });
  expect(colors.primary).toBe("#FFFFFF");
  expect(colors.secondary).toBe("#FFFDEB");
  expect(colors.tierContrast).toBeGreaterThanOrEqual(4.5);
  expect(colors.markContrast).toBeGreaterThanOrEqual(4.5);
  await card.focus();
  await expect(card).toBeFocused();
  await expect(card).toHaveCSS("outline-style", "solid");
  await assertNoHorizontalOverflow(page);
});

test("partner invoice checkout refuses lookalike Stripe destinations", async ({ page }) => {
  const attemptedExternalRequests = [];
  page.on("request", request => {
    if (request.url().includes("checkout.stripe.com.evil.example")) attemptedExternalRequests.push(request.url());
  });
  await page.route("**/api/public/partner-status", async route => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": webBase, "cache-control": "no-store" },
      contentType: "application/json",
      body: JSON.stringify({
        application: {
          reference: "TSF-S-SECURE-PAYMENT",
          type: "sponsor",
          intakeMode: "application",
          status: "invoiced",
          organizationName: "Secure Payment Sponsor",
          submittedAt: "2026-07-20T12:00:00.000Z",
          updatedAt: "2026-07-20T12:00:00.000Z",
          nextStep: null,
          contactPreference: { allowed: true, version: 1, updatedAt: "2026-07-20T12:00:00.000Z" },
          finance: {
            currency: "usd",
            expectedAmountCents: 500000,
            paidAmountCents: 0,
            balanceCents: 500000,
            paymentStatus: "unpaid",
            onlinePayment: { enabled: true, ready: true, provider: "stripe" },
            invoice: { id: "invoice_secure_payment", status: "approved", amountCents: 500000, balanceCents: 500000, dueAt: "2027-03-01T12:00:00.000Z" },
            checkout: { status: "open", checkoutUrl: "https://checkout.stripe.com.evil.example/c/pay/cs_stored_lookalike", expiresAt: "2027-03-01T12:30:00.000Z" }
          },
          milestones: [],
          branding: null,
          vendorOnboarding: null
        }
      })
    });
  });
  await page.route("**/api/public/partner-payment-checkout", async route => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 201,
      headers: { "access-control-allow-origin": webBase, "cache-control": "no-store" },
      contentType: "application/json",
      body: JSON.stringify({
        checkout: {
          id: "checkout_lookalike",
          status: "open",
          checkoutUrl: "https://checkout.stripe.com.evil.example/c/pay/cs_response_lookalike",
          expiresAt: "2027-03-01T12:30:00.000Z"
        }
      })
    });
  });

  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#partner-status?reference=TSF-S-SECURE-PAYMENT&token=tsfp_browser_origin_test`);
  await expect(page.locator("#partner-status-form .partner-form-status")).toContainText("Secure status loaded");
  await expect(page.locator('a[href*="checkout.stripe.com.evil.example"]')).toHaveCount(0);
  const payButton = page.locator('[data-partner-pay-invoice="invoice_secure_payment"]');
  await expect(payButton).toHaveText("Pay securely");
  await payButton.click();
  await expect(page.locator(".partner-payment-status")).toHaveText("Stripe returned an invalid payment address.");
  await expect(payButton).toBeEnabled();
  expect(page.url()).toContain(webBase);
  expect(attemptedExternalRequests).toEqual([]);
});

test("partner invoice checkout explains replay-safe ambiguous payment outcomes", async ({ page }) => {
  const invoiceId = "invoice_ambiguous_payment";
  const checkoutToken = "board_partner_checkout_ambiguous_browser_token";
  const application = {
    reference: "TSF-S-AMBIGUOUS-PAYMENT",
    type: "sponsor",
    intakeMode: "application",
    status: "invoiced",
    organizationName: "Ambiguous Payment Sponsor",
    submittedAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z",
    nextStep: null,
    contactPreference: { allowed: true, version: 1, updatedAt: "2026-07-20T12:00:00.000Z" },
    finance: {
      currency: "usd",
      expectedAmountCents: 500000,
      paidAmountCents: 0,
      balanceCents: 500000,
      paymentStatus: "unpaid",
      onlinePayment: { enabled: true, ready: true, provider: "board_sandbox" },
      invoice: { id: invoiceId, status: "approved", amountCents: 500000, balanceCents: 500000, dueAt: "2027-03-01T12:00:00.000Z" },
      checkout: null
    },
    milestones: [],
    branding: null,
    vendorOnboarding: null
  };
  await page.route("**/api/public/partner-status", async route => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": webBase, "cache-control": "no-store" },
      contentType: "application/json",
      body: JSON.stringify({ application })
    });
  });

  let checkoutAttempts = 0;
  await page.route("**/api/public/partner-payment-checkout", async route => {
    if (route.request().method() !== "POST") return route.continue();
    checkoutAttempts++;
    if (checkoutAttempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": webBase, "cache-control": "no-store" },
      contentType: "application/json",
      body: JSON.stringify({
        duplicate: true,
        demoCheckout: {
          mode: "board_sandbox",
          checkoutId: "partner_checkout_ambiguous",
          invoiceId,
          amountCents: 500000,
          currency: "usd",
          completeEndpoint: "/api/public/board-partner-checkout/complete",
          token: checkoutToken
        }
      })
    });
  });

  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#partner-status?reference=${application.reference}&token=tsfp_ambiguous_payment_browser`);
  await expect(page.locator("#partner-status-form .partner-form-status")).toContainText("Secure status loaded");
  const payInvoice = page.locator(`[data-partner-pay-invoice="${invoiceId}"]`);
  await payInvoice.evaluate(button => button.click());
  await expect(page.locator(".partner-payment-status")).toContainText("The invoice is unchanged. Try again to resume the same checkout.");
  await expect(payInvoice).toBeEnabled();
  await payInvoice.evaluate(button => button.click());
  const sandbox = page.locator("[data-partner-payment-sandbox]");
  await expect(sandbox).toBeVisible();
  expect(checkoutAttempts).toBe(2);

  let completionAttempts = 0;
  await page.route("**/api/public/board-partner-checkout/complete", async route => {
    if (route.request().method() !== "POST") return route.continue();
    completionAttempts++;
    expect(route.request().postDataJSON().token).toBe(checkoutToken);
    if (completionAttempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": webBase, "cache-control": "no-store" },
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        duplicate: true,
        application: {
          ...application,
          status: "paid",
          finance: {
            ...application.finance,
            paidAmountCents: 500000,
            balanceCents: 0,
            paymentStatus: "paid",
            invoice: { ...application.finance.invoice, status: "paid", balanceCents: 0 }
          }
        },
        receipt: {
          invoiceId,
          paymentId: "payment_ambiguous_once",
          amountCents: 500000,
          currency: "usd",
          paidAt: "2027-03-01T12:05:00.000Z",
          environment: "board_sandbox"
        }
      })
    });
  });

  const completePayment = sandbox.locator("[data-complete-partner-demo-payment]");
  await completePayment.evaluate(button => button.click());
  await expect(sandbox.locator(".partner-payment-status")).toContainText("the same invoice payment will be reused");
  await expect(completePayment).toBeEnabled();
  await completePayment.evaluate(button => button.click());
  await expect(page.locator(".partner-status-invoice > .partner-payment-status")).toContainText("$5,000.00 demonstration payment recorded");
  await expect(page.locator("[data-partner-pay-invoice]")).toHaveCount(0);
  expect(completionAttempts).toBe(2);
});

test("critical public and operations views fit a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
  const askInputBox = await page.locator("#ask-input").boundingBox();
  const askSubmitBox = await page.locator("#ask-submit").boundingBox();
  expect(askInputBox?.height).toBeGreaterThanOrEqual(44);
  expect(askSubmitBox?.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(Number(askInputBox?.width) - Number(askSubmitBox?.width))).toBeLessThanOrEqual(1);
  const partnerSelects = page.locator("#sponsor-inquiry-form select, #vendor-application-form select");
  await expect(partnerSelects).toHaveCount(3);
  for (let index = 0; index < await partnerSelects.count(); index += 1) {
    const bounds = await partnerSelects.nth(index).boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(42);
  }
  const runtimeNotice = page.locator("#runtime-data-notice");
  await expect(runtimeNotice).toContainText("Board demonstration · Synthetic 2027 data");
  await expect(runtimeNotice).toContainText("No external messages, charges, or live-provider calls");
  await expect(runtimeNotice).toHaveAccessibleName("Board demonstration. Synthetic 2027 data. No external messages, charges, or live-provider calls");
  await scrollWindowTo(page, { top: 400 });
  await expect.poll(() => page.evaluate(() => {
    const topbar = document.querySelector(".topbar")?.getBoundingClientRect();
    const notice = document.querySelector("#runtime-data-notice")?.getBoundingClientRect();
    return Boolean(topbar && notice && Math.abs(notice.top - topbar.bottom) <= 1 && notice.bottom <= window.innerHeight);
  })).toBe(true);
  const mobileNavigationToggle = page.locator("#mobile-nav-toggle");
  const mobileNavigation = page.locator("#public-navigation");
  await expect(mobileNavigationToggle).toBeVisible();
  await expect(mobileNavigationToggle).toHaveAttribute("aria-expanded", "false");
  await expect(mobileNavigation).toBeHidden();
  await mobileNavigationToggle.click();
  await expect(mobileNavigationToggle).toHaveAttribute("aria-expanded", "true");
  await expect(mobileNavigation).toBeVisible();
  expect(await mobileNavigation.evaluate(navigation => [...navigation.querySelectorAll('a[data-audience="ops"]')]
    .filter(link => link.getClientRects().length > 0)
    .map(link => ({ label: link.textContent.trim(), href: link.getAttribute("href") })))).toEqual([]);
  for (const name of ["Tickets", "Vendors", "Island", "Sponsors", "Status"]) {
    await expect(mobileNavigation.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await assertNoAccessibilityViolations(page, "Open mobile visitor navigation");
  await mobileNavigation.getByRole("link", { name: "Sponsors", exact: true }).click();
  await expect(page).toHaveURL(/#sponsors$/);
  await expect(page.locator("#sponsors .partner-heading")).toBeInViewport({ ratio: 0.5 });
  await expect(mobileNavigation).toBeHidden();
  await expect(mobileNavigationToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#sponsors")).toBeFocused();

  await mobileNavigationToggle.click();
  await page.keyboard.press("Escape");
  await expect(mobileNavigation).toBeHidden();
  await expect(mobileNavigationToggle).toHaveAttribute("aria-expanded", "false");
  await expect(mobileNavigationToggle).toBeFocused();

  await mobileNavigationToggle.click();
  await mobileNavigation.getByRole("link", { name: "Island", exact: true }).click();
  await expect(page).toHaveURL(/#island-conditions$/);
  await expect(page.locator("#refresh-island-conditions")).toBeVisible();
  await expect(mobileNavigation).toBeHidden();
  await assertNoHorizontalOverflow(page);

  const mobileMapTargets = page.locator(".lb-pin, .booth-pin, .corridor-pin");
  await expect(page.locator(".lb-pin")).toHaveCount(16);
  await expect(page.locator(".booth-pin")).toHaveCount(7);
  await expect(page.locator(".corridor-pin")).toHaveCount(9);
  for (let index = 0; index < await mobileMapTargets.count(); index += 1) {
    const targetBox = await mobileMapTargets.nth(index).boundingBox();
    expect(targetBox?.width).toBeGreaterThanOrEqual(24);
    expect(targetBox?.height).toBeGreaterThanOrEqual(24);
  }
  expect(await page.locator("#lb-canvas").evaluate(canvas => {
    const canvasBox = canvas.getBoundingClientRect();
    return [...canvas.querySelectorAll(".lb-pin")].filter(pin => {
      const pinBox = pin.getBoundingClientRect();
      return pinBox.left < canvasBox.left - 1
        || pinBox.right > canvasBox.right + 1
        || pinBox.top < canvasBox.top - 1
        || pinBox.bottom > canvasBox.bottom + 1;
    }).map(pin => pin.getAttribute("data-pin-id"));
  })).toEqual([]);
  for (const pinId of ["1", "16"]) {
    const edgePin = page.locator(`.lb-pin[data-pin-id="${pinId}"]`);
    if (pinId === "1") {
      await edgePin.dispatchEvent("click");
    } else {
      await edgePin.evaluate(pin => pin.focus({ preventScroll: true }));
      await page.keyboard.press("Enter");
    }
    await expect(edgePin).toHaveClass(/is-flashing/);
    const popover = page.locator("#lb-pop");
    await expect(popover).toBeVisible();
    expect(await popover.evaluate(element => {
      const canvasBox = document.querySelector("#lb-canvas").getBoundingClientRect();
      const popoverBox = element.getBoundingClientRect();
      return popoverBox.left >= canvasBox.left - 1
        && popoverBox.right <= canvasBox.right + 1
        && popoverBox.top >= canvasBox.top - 1
        && popoverBox.bottom <= canvasBox.bottom + 1;
    })).toBe(true);
  }
  await assertChoiceTargets(page, "Mobile visitor signup");
  expect(await page.locator(".corridor-map").evaluate(map => {
    const targets = [...map.querySelectorAll(".corridor-pin-amenity .corridor-pin-label, .corridor-axis")].map(node => ({
      label: node.textContent?.trim() || "axis",
      rect: node.getBoundingClientRect()
    }));
    const overlaps = [];
    for (let left = 0; left < targets.length; left += 1) {
      for (let right = left + 1; right < targets.length; right += 1) {
        const a = targets[left].rect;
        const b = targets[right].rect;
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          overlaps.push(`${targets[left].label}:${targets[right].label}`);
        }
      }
    }
    return overlaps;
  })).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#vendors-map`);
  await expect(page.locator("#vendors-map")).toBeInViewport({ ratio: 0.1 });
  await expect(page.locator("#vendors-map .booth-apply-link")).toBeVisible();
  await expect(page.locator("#vendors-map .booth-apply-link")).toBeInViewport();
  await page.locator("#vendors-map .booth-apply-link").click();
  await expect(page).toHaveURL(/#vendor-application-form$/);
  await expect(page.locator("#vendor-application-form")).toBeInViewport({ ratio: 0.1 });
  await assertNoHorizontalOverflow(page);

  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#vendor-application-form")).toBeVisible();
  await expect(runtimeNotice).toBeInViewport();
  await expect.poll(() => page.evaluate(() => {
    const notice = document.querySelector("#runtime-data-notice")?.getBoundingClientRect();
    const heading = document.querySelector("#sponsors .partner-heading")?.getBoundingClientRect();
    return Boolean(notice && heading && heading.top >= notice.bottom + 12 && heading.top <= notice.bottom + 32);
  })).toBe(true);
  await page.locator('[data-package-id="tarpon"]').click();
  await expect(page).toHaveURL(/#sponsor-inquiry-form$/);
  await expect(page.locator('#sponsor-inquiry-form [name="packageId"]')).toBeFocused();
  await assertTargetClearsTopbar(page, "#sponsor-inquiry-form", 12);
  await expect(page.locator("#sponsor-inquiry-form")).toBeInViewport({ ratio: 0.1 });
  await expect(page.locator('[data-package-id="tarpon"] [data-package-action]')).toHaveText("Selected");
  await assertNoHorizontalOverflow(page);

  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#tickets`);
  await page.locator('[data-ticket-request="sponsor-package-request"]').click();
  await expect(page).toHaveURL(/#sponsor-inquiry-form$/);
  await expect(page.locator('#sponsor-inquiry-form [name="organizationName"]')).toBeFocused();
  await assertTargetClearsTopbar(page, "#sponsor-inquiry-form", 12);
  await expect(page.locator("#sponsor-inquiry-form")).toBeInViewport({ ratio: 0.1 });
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-partners`);
  await expectAdminWorkspaceReady(page);
  await expect(runtimeNotice).toBeInViewport();
  await expect.poll(() => page.evaluate(() => {
    const notice = document.querySelector("#runtime-data-notice")?.getBoundingClientRect();
    const navigation = document.querySelector(".admin-workspace-nav")?.getBoundingClientRect();
    return Boolean(notice && navigation && navigation.top >= notice.bottom);
  })).toBe(true);
  await expect(page.locator("#admin-command-signals [data-command-signal]")).toHaveCount(8);
  await expect(page.locator("#admin-create-task")).toBeVisible();
  await expect(page.locator("#admin-import-staff")).toBeVisible();
  await expect(page.locator("#admin-quickbooks-connection")).toBeVisible();
  await expect(page.locator("#admin-quickbooks-status")).toContainText("deferred until post-presentation setup");
  await expect(page.locator("#admin-outreach-targeting-map")).toBeVisible();
  await expect(page.locator("#admin-outreach-targeting-map .admin-outreach-map-summary")).toBeVisible();
  await expect(page.locator('#admin-create-campaign [name="centerSource"]')).toBeVisible();
  await expect(page.locator("#admin-campaign-center-preview")).toBeVisible();
  await expect(page.locator("#admin-preview-campaign")).toBeVisible();
  await expect(page.locator("#admin-campaign-audience-preview")).toBeVisible();
  const mobileCampaignOutcomes = page.locator("#admin-outreach-campaigns [data-campaign-outcomes]").first();
  await expect(mobileCampaignOutcomes).toBeVisible();
  await expect(mobileCampaignOutcomes.getByText("Reached", { exact: true })).toBeVisible();
  await expect.poll(() => mobileCampaignOutcomes.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const workspaceNav = page.locator(".admin-workspace-nav");
  const workspaceLinks = workspaceNav.locator("a");
  await expect(workspaceLinks).toHaveCount(9);
  await expect(workspaceLinks).toHaveText([
    "Overview",
    "Impact",
    "Guest services",
    "Documents",
    "Partners",
    "Accounting",
    "Staffing",
    "Island conditions",
    "Systems"
  ]);
  await expect.poll(() => workspaceNav.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  for (const link of await workspaceLinks.all()) {
    await expect(link).toBeInViewport();
    await expect.poll(() => link.evaluate(element => (
      element.scrollWidth <= element.clientWidth + 1
      && element.scrollHeight <= element.clientHeight + 1
    ))).toBe(true);
  }
  expect(await page.locator("button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, a[href], [role=button]").evaluateAll(controls => controls.flatMap(control => {
    const bounds = control.getBoundingClientRect();
    const styles = getComputedStyle(control);
    if (
      bounds.width <= 0
      || bounds.height <= 0
      || styles.display === "none"
      || styles.visibility === "hidden"
      || (bounds.width >= 24 && bounds.height >= 24)
    ) return [];
    return [{
      name: control.getAttribute("aria-label") || control.textContent?.trim() || control.getAttribute("name") || control.id,
      width: Math.round(bounds.width * 10) / 10,
      height: Math.round(bounds.height * 10) / 10
    }];
  }))).toEqual([]);
  await assertChoiceTargets(page, "Mobile Operations");
  const accountingLink = workspaceNav.getByRole("link", { name: "Accounting", exact: true });
  await expect(accountingLink).toHaveAttribute("href", "#admin-budget");
  await accountingLink.click();
  await expect(page).toHaveURL(/#admin-budget$/);
  await assertAnchorClearsWorkspaceNav(page, "#admin-budget", -1);
  await workspaceNav.getByRole("link", { name: "Island conditions", exact: true }).click();
  await expect(page).toHaveURL(/#admin-island-conditions$/);
  await assertAnchorClearsWorkspaceNav(page, "#admin-island-conditions", -1);
  await assertNoHorizontalOverflow(page);
});

test("mobile vendor signup anchors remain aligned while public data renders", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
  await expect(page.locator("#network-status")).toHaveText("Demo");
  const vendorLink = page.locator("#vendor-intake-cta");
  await vendorLink.scrollIntoViewIfNeeded();
  await vendorLink.click();
  await expect(page).toHaveURL(/#vendor-application-form$/);
  await expect.poll(async () => {
    const form = await page.locator("#vendor-application-form").boundingBox();
    const topbar = await page.locator(".topbar").boundingBox();
    return Boolean(form && topbar && form.y >= topbar.y + topbar.height && form.y < 220);
  }, { timeout: 2_000 }).toBe(true);
  await expect(page.locator("#vendor-application-form")).toBeInViewport({ ratio: 0.2 });
});

test("governed visitor guidance is searchable, source-cited, and staff publishable", async ({ page }) => {
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#plan-your-visit`);
  const guidance = page.locator("#plan-your-visit");
  await expect(guidance).toHaveAttribute("aria-busy", "false");
  await expect(guidance.locator(".visitor-guidance-answer")).toHaveCount(6);
  await expect(guidance.locator("[data-visitor-guidance-count]")).toHaveText("6 answers");
  await guidance.locator("[data-visitor-guidance-search]").fill("pet");
  await expect(guidance.locator(".visitor-guidance-answer:visible")).toHaveCount(1);
  await guidance.locator(".visitor-guidance-answer:visible summary").click();
  await expect(guidance.locator(".visitor-guidance-answer:visible")).toContainText("service-animals-only");
  await expect(guidance.locator('.visitor-guidance-answer:visible a[href="https://www.texassandfest.org/petpolicy"]')).toHaveText("Official Pet Policy");
  await guidance.locator("[data-visitor-guidance-search]").fill("");
  await guidance.locator("[data-visitor-guidance-category]").selectOption("Accessibility");
  await expect(guidance.locator(".visitor-guidance-answer:visible")).toHaveCount(1);
  await expect(guidance.locator(".visitor-guidance-answer:visible")).toContainText("beach wheelchairs");

  const petResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/concierge" && response.request().method() === "POST");
  await page.locator("#ask-input").fill("Can I bring my pet?");
  await page.locator("#ask-submit").click();
  const petResponse = await petResponsePromise;
  expect(petResponse.status()).toBe(200);
  const petPayload = await petResponse.json();
  expect(petPayload.answer).toContain("service-animals-only");
  expect(petPayload.sources.some(item => item.href === "https://www.texassandfest.org/petpolicy")).toBe(true);

  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-config`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  const adminGuidance = page.locator("#admin-visitor-guidance-form");
  await expect(adminGuidance.locator(".admin-visitor-guidance-row")).toHaveCount(6);
  await expect(page.locator("#admin-visitor-guidance-readiness")).toContainText("source-reviewed visitor answers");
  const firstAnswer = adminGuidance.locator('.admin-visitor-guidance-row textarea[name="answer"]').first();
  const revisedAnswer = `${await firstAnswer.inputValue()} Board browser publication verified.`;
  await firstAnswer.fill(revisedAnswer);
  const publishButton = page.locator("#admin-publish-visitor-guidance");
  await expect(publishButton).toBeEnabled();
  const [publishResponse] = await Promise.all([
    page.waitForResponse(
      response => new URL(response.url()).pathname === "/api/admin/visitor-guidance/publish" && response.request().method() === "POST",
      { timeout: 25_000 }
    ),
    publishButton.click()
  ]);
  expect(publishResponse.status()).toBe(200);
  await expect(page.locator("#admin-api-status")).toContainText("Published 6 current visitor answers");

  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#plan-your-visit`);
  await expect(page.locator("#plan-your-visit")).toHaveAttribute("aria-busy", "false");
  await page.locator('[data-visitor-guidance-search]').fill("Board browser publication verified");
  await expect(page.locator(".visitor-guidance-answer:visible")).toHaveCount(1);
  await page.locator(".visitor-guidance-answer:visible summary").click();
  await expect(page.locator(".visitor-guidance-answer:visible")).toContainText("Board browser publication verified");
  await assertNoHorizontalOverflow(page);
});

test("WCAG A and AA checks cover public intake, partner status, concierge, and operations", async ({ page }) => {
  const runId = randomUUID().slice(0, 8);
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  await expect(page.locator("#vendor-application-form")).toBeVisible();
  await expect(page.locator("#chat")).toHaveAttribute("tabindex", "0");
  await expect(page.locator("#booth-list")).toHaveAttribute("tabindex", "0");
  await assertNoAccessibilityViolations(page, "Visitor and partner intake surface");

  const conciergeResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/concierge" && response.request().method() === "POST");
  await page.locator("#ask-input").fill("What accessibility services are available?");
  await page.locator("#ask-submit").click();
  const accessibilityResponse = await conciergeResponse;
  expect(accessibilityResponse.status()).toBe(200);
  const accessibilityPayload = await accessibilityResponse.json();
  expect(accessibilityPayload.topic).toBe("accessibility");
  expect(accessibilityPayload.confidence).toBe("high");
  expect(accessibilityPayload.escalated).toBe(false);
  expect(accessibilityPayload.answer).toContain("beach wheelchairs");
  await expect(page.locator("#chat .concierge-answer")).toHaveCount(1);
  await expect(page.locator("#chat .concierge-answer")).toContainText("beach wheelchairs");
  await expect(page.locator('#chat .concierge-sources a[href="https://www.texassandfest.org/accessibility"]')).toHaveText("Official Accessibility Guide");

  const parkingResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/concierge" && response.request().method() === "POST");
  await page.locator('[data-prompt="Is parking information available?"]').click();
  const parkingResponse = await parkingResponsePromise;
  expect(parkingResponse.status()).toBe(200);
  const parkingPayload = await parkingResponse.json();
  expect(parkingPayload.topic).toBe("parking");
  expect(parkingPayload.confidence).toBe("high");
  expect(parkingPayload.escalated).toBe(false);
  expect(parkingPayload.answer).toContain("beach parking permit");
  await expect(page.locator("#chat .concierge-answer")).toHaveCount(2);
  await expect(page.locator("#chat .concierge-answer").last()).toContainText("beach parking permit");
  await expect(page.locator('#chat .concierge-sources a[href="https://www.texassandfest.org/parking-shuttles"]').last()).toHaveText("Official Parking and Shuttles");

  const vendor = page.locator("#vendor-application-form");
  await vendor.locator('[name="organizationName"]').fill(`Accessible Boardwalk Arts ${runId}`);
  await vendor.locator('[name="contactName"]').fill("Taylor Access");
  await vendor.locator('[name="contactEmail"]').fill(`taylor.${runId}@example.com`);
  await vendor.locator('[name="category"]').selectOption("artisan");
  await vendor.locator('[name="vendorOfferingId"]').selectOption("marketplace-booth");
  await vendor.locator('[name="city"]').fill("Port Aransas");
  await vendor.locator('[name="description"]').fill("Locally made art with an accessible booth layout.");
  await vendor.locator('[name="consentToContact"]').check();
  await submitAndCapture(page, vendor, "/api/public/vendor-applications");
  await expect(page.locator("#partner-status-result")).toContainText(`Accessible Boardwalk Arts ${runId}`);
  await assertNoAccessibilityViolations(page, "Concierge response and private partner status");

  const taskWorkspaceResponse = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const taskWorkspace = await taskWorkspaceResponse.json();
  const accessibleTask = taskWorkspace.tasks?.find(item => ["open", "in_progress", "blocked"].includes(item.status) && item.assigneeId);
  expect(accessibleTask).toBeTruthy();
  const accessibleTaskUrl = new URL(taskPortalUrlForTask(accessibleTask, {
    config: taskPortalConfig({
      SANDFEST_ENV: "development",
      SANDFEST_TASK_PORTAL_SECRET: PORTAL_SECRET,
      SANDFEST_PUBLIC_SITE_URL: webBase
    })
  }));
  accessibleTaskUrl.searchParams.set("apiBase", apiBase);
  await page.goto(accessibleTaskUrl.toString());
  await expect(page).toHaveURL(/#task-status$/);
  await expect(page.locator("#task-status-result")).toContainText(accessibleTask.title);
  const taskActionButtons = page.locator("#task-status-update [data-task-action]:visible");
  expect(await taskActionButtons.count()).toBeGreaterThan(0);
  for (let index = 0; index < await taskActionButtons.count(); index += 1) {
    const bounds = await taskActionButtons.nth(index).boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  await assertNoAccessibilityViolations(page, "Private task assignment status");

  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-partners`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await expect(page.locator("#admin-partner-applications [data-partner-application]")).not.toHaveCount(0);
  const keyboardRegionIds = [
    "admin-fleet-assets",
    "admin-fleet-open",
    "admin-volunteers-zones",
    "admin-volunteers-gaps",
    "admin-sms-campaigns",
    "admin-passport-checkpoints",
    "admin-incidents",
    "admin-partner-milestones",
    "admin-receivables-accounts",
    "admin-receivables-exceptions",
    "admin-partner-applications",
    "admin-partner-followups",
    "admin-outreach-campaigns",
    "admin-outreach-prospects",
    "admin-condition-cameras"
  ];
  for (const id of keyboardRegionIds) {
    await expect(page.locator(`#${id}`)).toHaveAttribute("tabindex", "0");
    await expect(page.locator(`#${id}`)).toHaveAttribute("aria-label", /\S/);
  }
  const documentPreview = page.locator(".admin-document-preview").first();
  await expect(documentPreview).toHaveCount(1);
  await documentPreview.locator("summary").click();
  await expect(documentPreview.locator("pre")).toHaveAttribute("tabindex", "0");

  const outreachImport = page.locator("#admin-import-prospects");
  await outreachImport.locator('[name="csv"]').fill("business_name,industry,city,state,zip,email\nNeeds Review,banking,Corpus Christi,TX,invalid,review@example.com");
  const outreachPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/prospects/import" && response.request().method() === "POST");
  await outreachImport.locator('button[type="submit"]').click();
  expect((await outreachPreviewResponse).status()).toBe(200);
  await expect(page.locator("#admin-outreach-import-result ul")).toHaveAttribute("tabindex", "0");

  const discoveryPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/discovery/preview" && response.request().method() === "POST");
  await page.locator('#admin-discover-businesses button[type="submit"]').click();
  expect((await discoveryPreviewResponse).status()).toBe(200);
  await expect(page.locator(".admin-discovery-candidates")).toHaveAttribute("tabindex", "0");
  const discoveryCategoryTargets = page.locator('#admin-discover-businesses input[name="categories"]');
  for (let index = 0; index < await discoveryCategoryTargets.count(); index += 1) {
    const targetBox = await discoveryCategoryTargets.nth(index).boundingBox();
    expect(targetBox?.width).toBeGreaterThanOrEqual(24);
    expect(targetBox?.height).toBeGreaterThanOrEqual(24);
  }
  const discoveryCandidateTargets = page.locator('#admin-discover-businesses input[name="discoveredSourceRef"]');
  expect(await discoveryCandidateTargets.count()).toBeGreaterThan(0);
  for (let index = 0; index < await discoveryCandidateTargets.count(); index += 1) {
    const targetBox = await discoveryCandidateTargets.nth(index).boundingBox();
    expect(targetBox?.width).toBeGreaterThanOrEqual(28);
    expect(targetBox?.height).toBeGreaterThanOrEqual(28);
  }
  await expect(page.locator("#admin-campaign-center-preview")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#admin-campaign-audience-preview")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#admin-preview-campaign")).toHaveAccessibleName("Preview audience");
  await scrollWindowTo(page, { top: 0 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await assertNoAccessibilityViolations(page, "Operations workspace");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  await expect(page.locator("#vendor-application-form")).toBeVisible();
  await assertNoAccessibilityViolations(page, "Mobile visitor and partner intake surface");
});

test("partner portal recovery is private, delivered, and mobile-safe", async ({ page }) => {
  const runId = randomUUID().slice(0, 8);
  const organizationName = `Recovery Boardwalk Studio ${runId}`;
  const contactEmail = `recovery.${runId}@example.com`;
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);

  const vendor = page.locator("#vendor-application-form");
  await vendor.locator('[name="organizationName"]').fill(organizationName);
  await vendor.locator('[name="contactName"]').fill("Morgan Recovery");
  await vendor.locator('[name="contactEmail"]').fill(contactEmail);
  await vendor.locator('[name="category"]').selectOption("artisan");
  await vendor.locator('[name="vendorOfferingId"]').selectOption("marketplace-booth");
  await vendor.locator('[name="description"]').fill("Coastal art and a standard marketplace booth.");
  await vendor.locator('[name="consentToContact"]').check();
  const intake = await submitAndCapture(page, vendor, "/api/public/vendor-applications");

  await expect(page.locator('#partner-status-form [name="reference"]')).toHaveValue(intake.application.reference);
  await expect(page.locator("#partner-status-form .partner-form-status")).toContainText("Secure status loaded");
  await page.waitForTimeout(1_750);

  const recovery = page.locator("#partner-portal-recovery-form");
  const recoverySubmit = recovery.locator('button[type="submit"]');
  await expect(recoverySubmit).toBeEnabled();
  await recovery.locator('[name="reference"]').fill(intake.application.reference);
  await recovery.locator('[name="contactEmail"]').fill(contactEmail);
  await recoverySubmit.evaluate(button => button.scrollIntoView({ behavior: "instant", block: "center" }));
  await expect(recoverySubmit).toBeInViewport({ ratio: 1 });
  const matchedResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-portal-recovery" && response.request().method() === "POST");
  await recoverySubmit.click();
  const matchedResponse = await matchedResponsePromise;
  const matchedPayload = await matchedResponse.json();
  expect(matchedResponse.status()).toBe(202);
  expect(matchedResponse.headers()["cache-control"]).toBe("no-store");
  await expect(recovery.locator(".partner-form-status")).toHaveText(matchedPayload.message);
  expect(JSON.stringify(matchedPayload)).not.toContain(intake.application.reference);
  expect(JSON.stringify(matchedPayload)).not.toContain(contactEmail);
  expect(matchedPayload).not.toHaveProperty("matched");

  await recovery.locator('[name="contactEmail"]').fill(`unknown.${runId}@example.com`);
  const missedResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-portal-recovery" && response.request().method() === "POST");
  await recoverySubmit.click();
  const missedResponse = await missedResponsePromise;
  const missedPayload = await missedResponse.json();
  expect(missedResponse.status()).toBe(202);
  expect(missedPayload).toEqual(matchedPayload);

  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const messages = payload.followups?.filter(item => item.applicationId === intake.application.id && item.kind === "portal_access_recovery") || [];
    return messages.length === 1 && messages[0].status === "sent" && messages[0].deliveryStatus === "delivered";
  }, { timeout: 15_000 }).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(recovery).toBeVisible();
  await recovery.scrollIntoViewIfNeeded();
  await expect(recovery.locator('button[type="submit"]')).toBeInViewport();
  await assertNoHorizontalOverflow(page);
  await assertNoAccessibilityViolations(page, "Partner portal recovery");
});

test("staff publishes and holds one roster revision across visitor engagement", async ({ page }) => {
  test.skip(
    process.env.SANDFEST_WEBKIT_COMPAT_ONLY === "true",
    "The full roster mutation runs in Chromium CI and the local full WebKit rehearsal."
  );
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-sculptors`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await expect(page.locator("#admin-sculptor-roster-status")).toContainText("synthetic sculptors");

  const csv = [
    "event_id,sculptor_id,sculptor_name,division,hometown,returning,bio,instagram,entry_id,entry_title,statement,status,beach_marker,map_x,map_y",
    `${DEFAULT_EVENT_ID},board-river,Board River,master_solo,Port Aransas TX,yes,Reviewed browser artist,,board-tide,Board Tide,A reviewed Gulf sculpture,complete,13,0.42,0.44`,
    `${DEFAULT_EVENT_ID},board-kade,Board Kade,master_duo,Corpus Christi TX,no,Reviewed browser artist,,board-coral,Board Coral,A reviewed coral sculpture,sculpting,13.5,0.56,0.39`
  ].join("\n");
  const importForm = page.locator("#admin-import-sculptors");
  await importForm.locator('[name="rosterFile"]').setInputFiles({
    name: "reviewed-board-roster.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv)
  });
  await importForm.locator('[name="sourceUrl"]').fill("https://www.texassandfest.org/sculptors");
  const now = new Date();
  const localSourceCheckedAt = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await importForm.locator('[name="sourceCheckedAt"]').fill(localSourceCheckedAt);
  await importForm.locator('[name="currentEventConfirmed"]').check();
  const previewResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/sculptors/import" && response.request().method() === "POST");
  await importForm.locator('button[type="submit"]').click();
  const previewResponse = await previewResponsePromise;
  expect(previewResponse.status()).toBe(200);
  await expect(page.locator("#admin-sculptor-import-result")).toContainText("2 valid");
  await expect(page.locator("#admin-commit-sculptor-import")).toBeEnabled();

  const publishResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/sculptors/import" && response.request().method() === "POST");
  await page.locator("#admin-commit-sculptor-import").click();
  const publishResponse = await publishResponsePromise;
  expect(publishResponse.status()).toBe(200);
  await expect(page.locator("#admin-sculptor-roster-status")).toContainText("2 sculptors are source-reviewed and published");

  const engagementForm = page.locator("#admin-sculptor-engagement");
  await engagementForm.locator('[name="passportActive"]').check();
  await engagementForm.locator('[name="votingOpen"]').check();
  const engagementResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/sculptors/engagement" && response.request().method() === "PATCH");
  await engagementForm.locator('button[type="submit"]').click();
  expect((await engagementResponsePromise).status()).toBe(200);
  await expect(page.locator("#admin-sculptor-roster-kpis")).toContainText("Active");
  await expect(page.locator("#admin-sculptor-roster-kpis")).toContainText("Open");

  const visitor = await page.context().newPage();
  const visitorErrors = [];
  visitor.on("pageerror", error => visitorErrors.push(error.message));
  await visitor.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor&contentMode=api#sculptors-showcase`);
  await expect(visitor.locator("#sculptor-roster .sculptor-card")).toHaveCount(2);
  await expect(visitor.locator("#corridor-map .corridor-pin[data-sculptor]")).toHaveCount(2);
  await expect(visitor.locator("#passport-stamps .passport-stamp")).toHaveCount(2);
  await expect(visitor.locator("#voting-ballot .voting-card")).toHaveCount(2);
  await expect(visitor.locator(".sculptors-section .sculptor-count")).toHaveText("2 sculptors");
  await assertNoHorizontalOverflow(visitor);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#admin-sculptors").scrollIntoViewIfNeeded();
  await assertNoHorizontalOverflow(page);
  const holdForm = page.locator("#admin-hold-sculptors");
  await holdForm.locator('[name="reason"]').fill("Official marker assignments changed after review.");
  const holdResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/sculptors/hold" && response.request().method() === "POST");
  await holdForm.locator('button[type="submit"]').click();
  expect((await holdResponsePromise).status()).toBe(200);
  await expect(page.locator("#admin-sculptor-roster-status")).toContainText("not published");

  await visitor.reload();
  await expect(visitor.locator(".sculptor-publication-pending")).toBeVisible();
  await expect(visitor.locator("#sculptor-roster")).toBeHidden();
  await expect(visitor.locator("#passport-panel")).toBeHidden();
  await expect(visitor.locator("#voting-panel")).toBeHidden();
  const [publicRoster, publicPassport, publicVoting] = await Promise.all([
    fetch(`${apiBase}/api/public/sculptors`).then(response => response.json()),
    fetch(`${apiBase}/api/public/passport`).then(response => response.json()),
    fetch(`${apiBase}/api/public/voting`).then(response => response.json())
  ]);
  expect(publicRoster.sculptors).toHaveLength(0);
  expect(publicPassport.hunt.active).toBe(false);
  expect(publicPassport.checkpoints).toHaveLength(0);
  expect(publicVoting.votingOpen).toBe(false);
  expect(publicVoting.entries).toHaveLength(0);
  expect(pageErrors).toEqual([]);
  expect(visitorErrors).toEqual([]);
  await visitor.close();
});
