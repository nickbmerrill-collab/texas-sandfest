#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { BOARD_DEMO_PREFLIGHT_CHECK_COUNT, boardDemoLoopbackUrl } from "../lib/board-demo-readiness.mjs";
import {
  BOARD_DEMO_SESSION_SCHEMA_VERSION,
  boardDemoSessionPath,
  boardDemoSessionProcessAlive,
  readBoardDemoSession
} from "../lib/board-demo-session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_TOKEN = "board-demo-local-admin-token-change-me";
const BASELINE_APPLICATIONS = { total: 5, vendors: 3, sponsors: 2 };
const timeoutMs = 30_000;
const jsonOutput = process.argv.includes("--json");

if (process.argv.includes("--help")) {
  console.log("Usage: npm run board:prove:signups -- [--json]");
  console.log("Submits one synthetic vendor and sponsor, proves both automatic local acknowledgments in Operations, then restores the baseline.");
  process.exit(0);
}

function log(value = "") {
  if (!jsonOutput) console.log(value);
}

function preflight(sessionFile) {
  const result = spawnSync(process.execPath, ["scripts/check-board-demo.mjs", "--json"], {
    cwd: ROOT,
    env: { ...process.env, SANDFEST_BOARD_SESSION_FILE: sessionFile },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000
  });
  let report;
  try {
    report = JSON.parse(result.stdout || "null");
  } catch {
    throw new Error(`Board preflight returned invalid JSON: ${result.stderr || result.stdout || "no output"}`);
  }
  if (
    result.status !== 0
    || report?.ok !== true
    || report.passed !== BOARD_DEMO_PREFLIGHT_CHECK_COUNT
    || report.total !== BOARD_DEMO_PREFLIGHT_CHECK_COUNT
  ) {
    throw new Error(`Board preflight failed ${report?.passed ?? 0}/${report?.total ?? BOARD_DEMO_PREFLIGHT_CHECK_COUNT}.`);
  }
  return report;
}

function exactBase(value, label) {
  const url = boardDemoLoopbackUrl(value, label);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be an exact loopback origin.`);
  }
  return url.origin;
}

function activeSession(session, report) {
  if (
    !session
    || session.schemaVersion !== BOARD_DEMO_SESSION_SCHEMA_VERSION
    || session.status !== "ready"
    || !boardDemoSessionProcessAlive(session)
  ) {
    throw new Error("The supervised board session is not ready.");
  }
  const apiBase = exactBase(session.endpoints?.apiBase, "Board API");
  const webBase = exactBase(session.endpoints?.webBase, "Board web");
  const emailBase = exactBase(session.endpoints?.emailBase, "Board email sandbox");
  const visitor = new URL(String(report.links?.visitor || ""));
  const operations = new URL(String(report.links?.operations || ""));
  if (
    visitor.origin !== webBase
    || visitor.pathname !== "/"
    || visitor.searchParams.get("apiBase") !== apiBase
    || visitor.searchParams.get("mode") !== "visitor"
    || operations.origin !== webBase
    || operations.pathname !== "/admin.html"
    || operations.searchParams.get("apiBase") !== apiBase
  ) {
    throw new Error("Board presentation links do not match the active supervised session.");
  }
  return { apiBase, webBase, emailBase, visitor: visitor.toString(), operations: operations.toString() };
}

async function adminPartners(apiBase) {
  const response = await fetch(`${apiBase}/api/admin/partners`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Partner workspace returned ${response.status}.`);
  return response.json();
}

async function emailSandboxHealth(emailBase) {
  const response = await fetch(`${emailBase}/health`, { signal: AbortSignal.timeout(5_000) });
  const payload = response.ok ? await response.json() : null;
  if (
    !response.ok
    || payload?.ok !== true
    || payload.service !== "sandfest-board-email-sandbox"
    || payload.mode !== "board_demo"
  ) {
    throw new Error(`Board email sandbox returned ${response.status}.`);
  }
  return payload;
}

function exactBaseline(payload) {
  const applications = payload?.summary?.applications || {};
  return applications.total === BASELINE_APPLICATIONS.total
    && applications.vendors === BASELINE_APPLICATIONS.vendors
    && applications.sponsors === BASELINE_APPLICATIONS.sponsors;
}

async function waitForReset(sessionFile, { generation, resetCount }) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const session = await readBoardDemoSession(sessionFile);
    if (
      session?.status === "ready"
      && Number(session.resetCount || 0) > resetCount
      && session.lastPreflight?.passed === BOARD_DEMO_PREFLIGHT_CHECK_COUNT
    ) {
      try {
        const apiBase = exactBase(session.endpoints?.apiBase, "Reset board API");
        const healthResponse = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(2_000) });
        const health = healthResponse.ok ? await healthResponse.json() : null;
        if (health?.boardDemoGeneration && health.boardDemoGeneration !== generation) {
          return { session, apiBase, generation: health.boardDemoGeneration };
        }
      } catch {
        // Service replacement briefly makes the loopback API unavailable.
      }
    }
    await delay(250);
  }
  throw new Error("The board supervisor did not restore the prepared baseline in time.");
}

async function resetBaseline(sessionFile, session) {
  const apiBase = exactBase(session.endpoints?.apiBase, "Board API");
  const healthResponse = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(5_000) });
  const health = healthResponse.ok ? await healthResponse.json() : null;
  if (!health?.boardDemoResetReady || !health.boardDemoGeneration) {
    throw new Error("The active board API does not expose the supervised reset capability.");
  }
  const resetCount = Number(session.resetCount || 0);
  const response = await fetch(`${apiBase}/api/admin/board-demo/reset`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(5_000)
  });
  const accepted = await response.json().catch(() => ({}));
  if (response.status !== 202 || accepted.accepted !== true || accepted.generation !== health.boardDemoGeneration) {
    throw new Error(`Board reset was not accepted safely (${response.status}).`);
  }

  const restored = await waitForReset(sessionFile, {
    generation: health.boardDemoGeneration,
    resetCount
  });
  const report = preflight(sessionFile);
  const partners = await adminPartners(restored.apiBase);
  if (!exactBaseline(partners)) {
    throw new Error(`Board reset returned ${partners?.summary?.applications?.total ?? "an unknown number of"} applications instead of the prepared five.`);
  }
  return {
    fromGeneration: health.boardDemoGeneration,
    toGeneration: restored.generation,
    applicationCount: partners.summary.applications.total,
    preflight: `${report.passed}/${report.total}`
  };
}

async function waitForVisitor(page) {
  await page.waitForFunction(() => (
    document.querySelector("#network-status")?.textContent?.trim() === "Demo"
    && document.querySelector("#sponsor-inquiry-form")?.dataset.publicIntakeState === "ready"
    && document.querySelector("#vendor-application-form")?.dataset.publicIntakeState === "ready"
  ), null, { timeout: timeoutMs });
}

async function submitPartner(page, { kind, organizationName }) {
  const isVendor = kind === "vendor";
  const formSelector = isVendor ? "#vendor-application-form" : "#sponsor-inquiry-form";
  const form = page.locator(formSelector);
  const endpoint = isVendor ? "/api/public/vendor-applications" : "/api/public/sponsor-inquiries";
  await form.locator(`[data-board-partner-preset="${kind}"]`).click();
  await page.waitForFunction(selector => {
    const target = document.querySelector(selector);
    return target?.querySelector(".partner-form-status")?.textContent?.trim() === "Synthetic details are ready. Contact consent remains unchecked."
      && Boolean(target.elements.contactEmail.value)
      && Boolean(target.elements.contactPhone.value);
  }, formSelector, { timeout: timeoutMs });
  await form.locator('[name="organizationName"]').fill(organizationName);
  const email = await form.locator('[name="contactEmail"]').inputValue();
  const phone = await form.locator('[name="contactPhone"]').inputValue();
  if (!email.endsWith("@example.com") || !/^\+1361555013[12]$/.test(phone)) {
    throw new Error(`${kind} proof did not receive reserved synthetic contact details.`);
  }
  if (await form.locator('[name="consentToContact"]').isChecked()) {
    throw new Error(`${kind} proof preset granted contact consent automatically.`);
  }
  await form.locator('[name="consentToContact"]').check();
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === endpoint
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await form.locator('button[type="submit"]').click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (
    response.status() !== 201
    || payload.application?.type !== kind
    || !payload.application?.id
    || !payload.application?.reference
    || payload.acknowledgment !== "draft_queued"
  ) {
    throw new Error(`${kind} signup returned ${response.status()} without a valid application reference.`);
  }
  await page.waitForFunction(({ expectedOrganization, expectedReference }) => {
    const result = document.querySelector("#partner-status-result");
    const status = document.querySelector("#partner-status-form .partner-form-status");
    const text = result?.textContent || "";
    return status?.dataset.state === "ok"
      && text.includes(expectedOrganization)
      && text.includes(expectedReference);
  }, {
    expectedOrganization: organizationName,
    expectedReference: payload.application.reference
  }, { timeout: timeoutMs }).catch(() => {
    throw new Error(`${kind} signup did not open its authenticated private status view.`);
  });
  return {
    kind,
    applicationId: payload.application.id,
    organizationName,
    reference: payload.application.reference
  };
}

function expectedAcknowledgmentSubject(submission) {
  const typeLabel = submission.kind === "vendor" ? "vendor" : "sponsorship";
  return `Texas SandFest ${typeLabel} application ${submission.reference}`;
}

function deliveredAcknowledgment(followup, submission) {
  return followup?.applicationId === submission.applicationId
    && followup.kind === "application_received"
    && followup.subject === expectedAcknowledgmentSubject(submission)
    && followup.status === "sent"
    && followup.deliveryStatus === "delivered"
    && followup.provider === "brevo"
    && /^board-mail-[a-f0-9]{32}$/.test(String(followup.providerMessageId || ""))
    && followup.deliveryAttempts === 1
    && followup.automationPolicy === "partner_transactional_v1"
    && Number.isFinite(Date.parse(followup.deliveredAt))
    && String(followup.body || "").includes(`#partner-status?reference=${encodeURIComponent(submission.reference)}`);
}

async function waitForAcknowledgments(apiBase, emailBase, submissions, mailboxBefore) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    const partners = await adminPartners(apiBase);
    const acknowledgments = submissions.map(submission => (
      partners.followups?.find(item => item.applicationId === submission.applicationId && item.kind === "application_received") || null
    ));
    const mailbox = await emailSandboxHealth(emailBase);
    lastState = {
      statuses: acknowledgments.map(item => ({ status: item?.status || null, deliveryStatus: item?.deliveryStatus || null })),
      acceptedMessages: mailbox.acceptedMessages,
      deliveryCallbacks: mailbox.deliveryCallbacks,
      callbackFailures: mailbox.callbackFailures
    };
    if (
      acknowledgments.every((item, index) => deliveredAcknowledgment(item, submissions[index]))
      && mailbox.acceptedMessages >= mailboxBefore.acceptedMessages + submissions.length
      && mailbox.deliveryCallbacks >= mailboxBefore.deliveryCallbacks + submissions.length
      && mailbox.callbackFailures === 0
    ) {
      return {
        acknowledgments,
        acceptedMessages: mailbox.acceptedMessages - mailboxBefore.acceptedMessages,
        deliveryCallbacks: mailbox.deliveryCallbacks - mailboxBefore.deliveryCallbacks,
        callbackFailures: mailbox.callbackFailures
      };
    }
    await delay(250);
  }
  throw new Error(`Vendor and sponsor acknowledgments did not reach authenticated local delivery in time: ${JSON.stringify(lastState)}.`);
}

async function proveOperations(page, operationsUrl, submissions, acknowledgments) {
  const url = new URL(operationsUrl);
  url.hash = "admin-partner-applications-workspace";
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForFunction(() => {
    const status = document.querySelector("#admin-api-status");
    return status?.dataset.workspaceState === "ready" && status.getAttribute("aria-busy") === "false";
  }, null, { timeout: timeoutMs });

  for (const submission of submissions) {
    const card = page.locator("#admin-partner-applications [data-partner-application]")
      .filter({ hasText: submission.organizationName });
    if (await card.count() !== 1) {
      throw new Error(`Operations did not render exactly one ${submission.kind} proof application.`);
    }
    const text = await card.innerText();
    if (!text.includes(submission.reference)) {
      throw new Error(`Operations did not render the ${submission.kind} application reference.`);
    }
  }
  for (const acknowledgment of acknowledgments) {
    const card = page.locator(`#admin-partner-followups [data-followup="${acknowledgment.id}"]`);
    await expect(card).toHaveAttribute("data-delivery-status", "delivered");
    await expect(card).toContainText(acknowledgment.subject);
    await expect(card).toContainText("transactional automation");
  }
  const applicationCount = await page.locator("#admin-partner-applications [data-partner-application]").count();
  if (applicationCount !== BASELINE_APPLICATIONS.total + submissions.length) {
    throw new Error(`Operations rendered ${applicationCount} applications after signup proof; expected ${BASELINE_APPLICATIONS.total + submissions.length}.`);
  }
  return {
    applicationCount,
    references: submissions.map(item => item.reference),
    deliveredAcknowledgments: acknowledgments.length
  };
}

const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });
const runId = randomUUID().slice(0, 8);
const result = { ok: false, runId, submissions: [], automation: null, operations: null, reset: null };
let browser = null;
let resetRequired = false;
let workflowError = null;

try {
  log("\n=== Active board signup proof ===\n");
  const report = preflight(sessionFile);
  let session = await readBoardDemoSession(sessionFile);
  let endpoints = activeSession(session, report);
  const initialPartners = await adminPartners(endpoints.apiBase);
  if (!exactBaseline(initialPartners)) {
    log("Restoring the prepared five-application baseline before rehearsal...");
    result.reset = await resetBaseline(sessionFile, session);
    session = await readBoardDemoSession(sessionFile);
    endpoints = activeSession(session, preflight(sessionFile));
  }
  const mailboxBefore = await emailSandboxHealth(endpoints.emailBase);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(endpoints.visitor, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForVisitor(page);

  resetRequired = true;
  const vendor = await submitPartner(page, {
    kind: "vendor",
    organizationName: `Board Vendor Proof ${runId}`
  });
  result.submissions.push(vendor);

  await page.locator('[data-package-id="tarpon"]').click();
  const sponsor = await submitPartner(page, {
    kind: "sponsor",
    organizationName: `Board Sponsor Proof ${runId}`
  });
  result.submissions.push(sponsor);
  const delivery = await waitForAcknowledgments(
    endpoints.apiBase,
    endpoints.emailBase,
    result.submissions,
    mailboxBefore
  );
  result.automation = {
    delivered: delivery.acknowledgments.length,
    provider: "brevo",
    sandboxAuthenticated: delivery.acknowledgments.every(item => String(item.providerMessageId).startsWith("board-mail-")),
    acceptedMessages: delivery.acceptedMessages,
    deliveryCallbacks: delivery.deliveryCallbacks,
    callbackFailures: delivery.callbackFailures
  };
  result.operations = await proveOperations(page, endpoints.operations, result.submissions, delivery.acknowledgments);
  log(`Verified ${vendor.reference} and ${sponsor.reference} through Visitor, automatic delivery, and Operations.`);
} catch (error) {
  workflowError = error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (resetRequired) {
    try {
      const session = await readBoardDemoSession(sessionFile);
      result.reset = await resetBaseline(sessionFile, session);
      log(`Restored the prepared baseline at ${result.reset.preflight} readiness.`);
    } catch (error) {
      workflowError = workflowError
        ? new Error(`${workflowError.message} Baseline restoration also failed: ${error.message}`)
        : error;
    }
  }
}

if (workflowError) {
  result.error = workflowError.message;
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else console.error(`\nBoard signup proof failed: ${workflowError.message}`);
  process.exitCode = 1;
} else {
  result.ok = true;
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("\nBoard signup proof passed.");
    console.log(`Vendor:     ${result.submissions[0].reference}`);
    console.log(`Sponsor:    ${result.submissions[1].reference}`);
    console.log(`Automation: ${result.automation.delivered} authenticated local acknowledgments`);
    console.log(`Operations: ${result.operations.applicationCount} applications observed`);
    console.log(`Reset:      ${result.reset.applicationCount} baseline applications · ${result.reset.preflight} ready`);
  }
}
