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
const BASELINE = {
  total: 3,
  active: 2,
  urgent: 0,
  resolved: 1,
  open: 1,
  inProgress: 1,
  waitingForGuest: 0,
  closed: 0
};
const timeoutMs = 30_000;
const jsonOutput = process.argv.includes("--json");

if (process.argv.includes("--help")) {
  console.log("Usage: npm run board:prove:guest-services -- [--json]");
  console.log("Moves one visitor request through private intake, staff triage, public updates, resolution, audit proof, and an exact board reset.");
  process.exit(0);
}

function log(value = "") {
  if (!jsonOutput) console.log(value);
}

function preflight(sessionFile) {
  const run = spawnSync(process.execPath, ["scripts/check-board-demo.mjs", "--json"], {
    cwd: ROOT,
    env: { ...process.env, SANDFEST_BOARD_SESSION_FILE: sessionFile },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000
  });
  let report;
  try {
    report = JSON.parse(run.stdout || "null");
  } catch {
    throw new Error(`Board preflight returned invalid JSON: ${run.stderr || run.stdout || "no output"}`);
  }
  if (
    run.status !== 0
    || report?.ok !== true
    || report.passed !== BOARD_DEMO_PREFLIGHT_CHECK_COUNT
    || report.total !== BOARD_DEMO_PREFLIGHT_CHECK_COUNT
  ) {
    throw new Error(`Board preflight failed ${report?.passed ?? 0}/${report?.total ?? BOARD_DEMO_PREFLIGHT_CHECK_COUNT}.`);
  }
  return report;
}

async function stablePreflight(sessionFile) {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    const session = await readBoardDemoSession(sessionFile);
    if (session?.status === "ready" && boardDemoSessionProcessAlive(session)) {
      try {
        return preflight(sessionFile);
      } catch (error) {
        lastError = error;
      }
    }
    await delay(250);
  }
  throw lastError || new Error("The supervised board session did not become ready.");
}

function exactBase(value, label) {
  const url = boardDemoLoopbackUrl(value, label);
  if (url.pathname !== "/" || url.search || url.hash) throw new Error(`${label} must be an exact loopback origin.`);
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
  return { apiBase, visitor: visitor.toString(), operations: operations.toString() };
}

async function requestJson(apiBase, pathname, { admin = false, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: {
      ...(admin ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function adminJson(apiBase, pathname) {
  const { response, payload } = await requestJson(apiBase, pathname, { admin: true });
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${payload.error || "unknown error"}.`);
  return payload;
}

function privacySafeDashboard(payload) {
  return !/(accessTokenHash|idempotencyKeyHash|idempotencyFingerprint|tsfg_)/.test(JSON.stringify(payload));
}

async function baselineSnapshot(apiBase) {
  const payload = await adminJson(apiBase, "/api/admin/guest-services");
  if (!privacySafeDashboard(payload)) throw new Error("Guest Services dashboard exposed a private capability or retry hash.");
  const statuses = payload.summary?.statuses || {};
  return {
    total: payload.summary?.total,
    active: payload.summary?.active,
    urgent: payload.summary?.urgent,
    resolved: payload.summary?.resolved,
    open: statuses.open,
    inProgress: statuses.in_progress,
    waitingForGuest: statuses.waiting_for_guest,
    closed: statuses.closed
  };
}

function baselineMatches(snapshot) {
  return Object.entries(BASELINE).every(([key, value]) => snapshot?.[key] === value);
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
        const response = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(2_000) });
        const health = response.ok ? await response.json() : null;
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
  const restored = await waitForReset(sessionFile, { generation: health.boardDemoGeneration, resetCount });
  const report = await stablePreflight(sessionFile);
  const snapshot = await baselineSnapshot(restored.apiBase);
  if (!baselineMatches(snapshot)) throw new Error(`Board reset did not restore the exact Guest Services baseline: ${JSON.stringify(snapshot)}.`);
  return {
    fromGeneration: health.boardDemoGeneration,
    toGeneration: restored.generation,
    ...snapshot,
    preflight: `${report.passed}/${report.total}`
  };
}

async function waitForVisitor(page) {
  await page.waitForFunction(() => (
    document.querySelector("#network-status")?.textContent?.trim() === "Demo"
    && document.querySelector("#guest-services")?.getAttribute("aria-busy") === "false"
    && document.querySelector("#guest-services-form")?.dataset.publicIntakeState === "ready"
  ), null, { timeout: timeoutMs });
}

async function waitForOperations(page) {
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: timeoutMs });
  await page.waitForFunction(() => document.querySelector("#admin-guest-services-kpis")?.getAttribute("aria-busy") === "false", null, { timeout: timeoutMs });
}

async function submitRequest(page, apiBase, runId) {
  const form = page.locator("#guest-services-form");
  const title = `Board accessibility pickup ${runId}`;
  const details = `A board-demo guest needs the accessible entrance and beach wheelchair pickup point for Saturday ${runId}.`;
  const contactName = "Board Guest Services Visitor";
  const contactEmail = `guest.services.${runId}@example.com`;
  const contactPhone = "+13615550197";

  await expect(form.locator('[name="category"] option[value]:not([value=""])')).toHaveCount(6);
  await expect(form.locator('[name="consentToContact"]')).not.toBeChecked();
  await expect(page.locator(".guest-services-emergency")).toContainText("call 911");
  await form.locator('[name="category"]').selectOption("accessibility");
  await form.locator('[name="festivalDay"]').selectOption("Saturday");
  await form.locator('[name="title"]').fill(title);
  await form.locator('[name="details"]').fill(details);
  await form.locator('[name="location"]').fill("North Gate accessibility pickup");
  await form.locator('[name="contactName"]').fill(contactName);
  await form.locator('[name="contactEmail"]').fill(contactEmail);
  await form.locator('[name="contactPhone"]').fill(contactPhone);
  await form.locator('[name="contactPreference"]').selectOption("email");
  await form.locator('[name="consentToContact"]').check();

  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/public/guest-services"
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await form.locator('button[type="submit"]').click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (
    response.status() !== 201
    || payload.request?.category !== "accessibility"
    || payload.request?.priority !== "high"
    || payload.request?.status !== "open"
    || payload.request?.assignedTeam !== "guest-services"
    || !/^TSF-GS-[A-F0-9]{8}$/.test(String(payload.access?.reference || ""))
    || !/^tsfg_[A-Za-z0-9_-]+$/.test(String(payload.access?.token || ""))
  ) {
    throw new Error(`Guest Services intake returned ${response.status()} without the expected private request.`);
  }
  if (/(contact|details|accessTokenHash|idempotency)/i.test(JSON.stringify(payload.request))) {
    throw new Error("Public Guest Services intake exposed private request details.");
  }
  await expect(page.locator("#guest-services-status-result")).toContainText(title);
  await expect(page.locator("#guest-services-status-result [data-status]")).toHaveText("Received");
  await expect(page.locator('#guest-services-status-form [name="reference"]')).toHaveValue(payload.access.reference);
  await expect(page.locator('#guest-services-status-form [name="token"]')).toHaveValue(payload.access.token);

  const originalRequest = response.request();
  const headers = originalRequest.headers();
  const idempotencyKey = headers["idempotency-key"];
  const originalBody = originalRequest.postDataJSON();
  if (!idempotencyKey) throw new Error("Guest Services browser intake omitted its stable retry key.");
  const replay = await requestJson(apiBase, "/api/public/guest-services", {
    method: "POST",
    body: originalBody,
    headers: { "idempotency-key": idempotencyKey }
  });
  if (
    replay.response.status !== 200
    || replay.payload.replay !== true
    || replay.payload.access?.reference !== payload.access.reference
    || replay.payload.access?.token !== payload.access.token
  ) {
    throw new Error(`Guest Services retry did not return the original private request (${replay.response.status}).`);
  }

  const denied = await requestJson(apiBase, "/api/public/guest-services/status", {
    method: "POST",
    body: { reference: payload.access.reference, token: "tsfg_wrong_board_proof" }
  });
  if (denied.response.status !== 404) throw new Error("Guest Services private status accepted an invalid capability.");

  return {
    title,
    details,
    contactName,
    contactEmail,
    contactPhone,
    access: payload.access,
    request: payload.request,
    replayed: true,
    invalidCapabilityDenied: true
  };
}

function caseLocator(page, caseId) {
  return page.locator(`#admin-guest-services-list [data-guest-services-case="${caseId}"]`);
}

async function saveCase(page, caseId, input) {
  const item = caseLocator(page, caseId);
  await item.locator('[name="status"]').selectOption(input.status);
  await item.locator('[name="priority"]').selectOption(input.priority);
  await item.locator('[name="assignedTeam"]').selectOption(input.assignedTeam);
  await item.locator('[name="publicMessage"]').fill(input.publicMessage);
  await item.locator('[name="internalNote"]').fill(input.internalNote);
  await item.locator('[name="publishUpdate"]').check();
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/guest-services/cases/${caseId}`
    && response.request().method() === "PATCH"
  ), { timeout: timeoutMs });
  await item.locator('button[type="submit"]').click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok() || payload.changed !== true || payload.case?.status !== input.status) {
    throw new Error(`Guest Services ${input.status} update returned ${response.status()}: ${payload.error || "unexpected state"}.`);
  }
  await expect(page.locator("#admin-api-status")).toContainText("Guest Services case saved");
  await expect(caseLocator(page, caseId).locator('[name="status"]')).toHaveValue(input.status);
  return payload;
}

async function refreshPrivateStatus(page, expectedStatus, publicMessage, forbiddenMessages) {
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/public/guest-services/status"
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await page.locator('#guest-services-status-form button[type="submit"]').click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok() || payload.request?.status !== expectedStatus) {
    throw new Error(`Private Guest Services status returned ${response.status()} without ${expectedStatus}.`);
  }
  await expect(page.locator("#guest-services-status-result [data-status]")).toHaveText(expectedStatus === "in_progress" ? "In progress" : "Resolved");
  await expect(page.locator("#guest-services-status-result")).toContainText(publicMessage);
  for (const forbidden of forbiddenMessages) await expect(page.locator("#guest-services-status-result")).not.toContainText(forbidden);
  return payload.request;
}

async function proveAudit(apiBase, caseId, forbiddenValues) {
  const payload = await adminJson(apiBase, "/api/admin/audit?limit=200");
  const records = (payload.audit || []).map(item => item.record).filter(record => (
    record?.target?.type === "guestServicesCase" && record.target.id === caseId
  ));
  if (records.length !== 2 || records.some(record => record.action !== "guest_services.case.update")) {
    throw new Error(`Guest Services expected two governed updates but found ${records.length}.`);
  }
  const statuses = new Set(records.map(record => record.after?.status));
  if (!statuses.has("in_progress") || !statuses.has("resolved")) {
    throw new Error("Guest Services audit does not prove triage and resolution.");
  }
  const serialized = JSON.stringify(records);
  for (const forbidden of [
    "accessTokenHash",
    "idempotencyKeyHash",
    "idempotencyFingerprint",
    "contact",
    "details",
    "updates",
    ...forbiddenValues
  ]) {
    if (forbidden && serialized.includes(forbidden)) throw new Error(`Guest Services audit exposed private value ${forbidden}.`);
  }
  return { records: records.length, actions: [...new Set(records.map(record => record.action))], statuses: [...statuses].sort() };
}

const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });
const runId = randomUUID().slice(0, 8);
const result = {
  ok: false,
  runId,
  request: null,
  triage: null,
  resolution: null,
  dashboard: null,
  audit: null,
  reset: null
};
let browser = null;
let resetRequired = false;
let workflowError = null;

try {
  log("\n=== Active board Guest Services journey proof ===\n");
  let report = await stablePreflight(sessionFile);
  let session = await readBoardDemoSession(sessionFile);
  let endpoints = activeSession(session, report);
  const initial = await baselineSnapshot(endpoints.apiBase);
  if (!baselineMatches(initial)) {
    log("Restoring the prepared three-case Guest Services baseline before rehearsal...");
    result.reset = await resetBaseline(sessionFile, session);
    session = await readBoardDemoSession(sessionFile);
    report = await stablePreflight(sessionFile);
    endpoints = activeSession(session, report);
  }

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const visitorPage = await context.newPage();
  const visitorUrl = new URL(endpoints.visitor);
  visitorUrl.hash = "guest-services";
  await visitorPage.goto(visitorUrl.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForVisitor(visitorPage);
  await expect(visitorPage.locator("#runtime-data-notice")).toContainText("No external messages, charges, or live-provider calls");

  resetRequired = true;
  const intake = await submitRequest(visitorPage, endpoints.apiBase, runId);
  result.request = {
    reference: intake.access.reference,
    category: intake.request.category,
    priority: intake.request.priority,
    assignedTeam: intake.request.assignedTeam,
    replayed: intake.replayed,
    invalidCapabilityDenied: intake.invalidCapabilityDenied,
    privateAccessIssued: Boolean(intake.access.token)
  };

  const operationsPage = await context.newPage();
  await operationsPage.setViewportSize({ width: 1280, height: 900 });
  const operationsUrl = new URL(endpoints.operations);
  operationsUrl.hash = "admin-guest-services";
  await operationsPage.goto(operationsUrl.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForOperations(operationsPage);
  await expect(operationsPage.locator("#network-status")).toHaveText("Demo");
  await operationsPage.locator("#admin-guest-services-filter").selectOption("all");
  const located = operationsPage.locator("#admin-guest-services-list [data-guest-services-case]").filter({ hasText: intake.title });
  await expect(located).toHaveCount(1);
  const caseId = await located.getAttribute("data-guest-services-case");
  if (!caseId) throw new Error("Operations did not expose the created Guest Services case identifier.");
  await expect(located).toContainText(intake.contactName);
  await expect(located).not.toContainText(intake.access.token);
  await expect(operationsPage.locator("#admin-guest-services")).not.toContainText(/accessTokenHash|idempotencyKeyHash|idempotencyFingerprint/);

  const publicTriage = `Guest Services confirmed the North Gate pickup point and reserved arrival support ${runId}.`;
  const internalTriage = `Private accessibility captain handoff ${runId}.`;
  const triaged = await saveCase(operationsPage, caseId, {
    status: "in_progress",
    priority: "high",
    assignedTeam: "guest-services",
    publicMessage: publicTriage,
    internalNote: internalTriage
  });
  result.triage = {
    status: triaged.case.status,
    priority: triaged.case.priority,
    assignedTeam: triaged.case.assignedTeam,
    publicUpdates: triaged.case.updates.filter(item => item.public).length,
    internalUpdates: triaged.case.updates.filter(item => !item.public).length
  };
  await refreshPrivateStatus(visitorPage, "in_progress", publicTriage, [internalTriage]);

  const publicResolution = `Arrival support is confirmed at North Gate. Show request ${intake.access.reference} to Guest Services ${runId}.`;
  const internalResolution = `Private staff closeout note ${runId}.`;
  const resolved = await saveCase(operationsPage, caseId, {
    status: "resolved",
    priority: "high",
    assignedTeam: "guest-services",
    publicMessage: publicResolution,
    internalNote: internalResolution
  });
  result.resolution = {
    status: resolved.case.status,
    resolved: Boolean(resolved.case.resolvedAt),
    publicUpdates: resolved.case.updates.filter(item => item.public).length,
    internalUpdates: resolved.case.updates.filter(item => !item.public).length
  };
  const privateFinal = await refreshPrivateStatus(visitorPage, "resolved", publicResolution, [internalTriage, internalResolution, intake.details, intake.contactEmail, intake.contactPhone]);
  if (/(contact|details|accessTokenHash|idempotency)/i.test(JSON.stringify(privateFinal))) {
    throw new Error("Private Guest Services status expanded beyond the approved public case projection.");
  }

  const dashboard = await adminJson(endpoints.apiBase, "/api/admin/guest-services");
  const stored = dashboard.cases?.find(item => item.id === caseId);
  if (
    !privacySafeDashboard(dashboard)
    || !stored
    || stored.status !== "resolved"
    || stored.priority !== "high"
    || stored.assignedTeam !== "guest-services"
    || stored.contact?.email !== intake.contactEmail
    || !stored.updates.some(item => item.public && item.message === publicResolution)
    || !stored.updates.some(item => !item.public && item.message === internalResolution)
    || dashboard.summary?.total !== 4
    || dashboard.summary?.active !== 2
    || dashboard.summary?.resolved !== 2
  ) {
    throw new Error(`Guest Services final dashboard state is incomplete: ${JSON.stringify({ summary: dashboard.summary, stored })}.`);
  }
  result.dashboard = {
    total: dashboard.summary.total,
    active: dashboard.summary.active,
    resolved: dashboard.summary.resolved
  };
  result.audit = await proveAudit(endpoints.apiBase, caseId, [
    intake.access.token,
    intake.contactName,
    intake.contactEmail,
    intake.contactPhone,
    intake.details,
    publicTriage,
    internalTriage,
    publicResolution,
    internalResolution
  ]);
  log(`Verified ${intake.access.reference} from public accessibility request through private resolved status.`);
} catch (error) {
  workflowError = error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (resetRequired) {
    try {
      const session = await readBoardDemoSession(sessionFile);
      result.reset = await resetBaseline(sessionFile, session);
      log(`Restored the exact Guest Services baseline at ${result.reset.preflight} readiness.`);
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
  else console.error(`\nBoard Guest Services journey proof failed: ${workflowError.message}`);
  process.exitCode = 1;
} else {
  result.ok = true;
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("\nBoard Guest Services journey proof passed.");
    console.log(`Request:     ${result.request.reference} · ${result.request.category} · retry-safe`);
    console.log(`Triage:      ${result.triage.status} · ${result.triage.priority} · ${result.triage.assignedTeam}`);
    console.log(`Resolution:  ${result.resolution.status} · ${result.resolution.publicUpdates} public / ${result.resolution.internalUpdates} internal updates`);
    console.log(`Privacy:     invalid capability denied · internal notes withheld`);
    console.log(`Audit:       ${result.audit.records} privacy-safe staff updates`);
    console.log(`Reset:       ${result.reset.total} cases · ${result.reset.active} active · ${result.reset.resolved} resolved · ${result.reset.preflight}`);
  }
}
