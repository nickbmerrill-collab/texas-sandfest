#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { boardCameraSourceId } from "../lib/board-camera-playback.mjs";
import { BOARD_DEMO_PREFLIGHT_CHECK_COUNT, boardDemoLoopbackUrl } from "../lib/board-demo-readiness.mjs";
import {
  BOARD_DEMO_SESSION_SCHEMA_VERSION,
  boardDemoSessionPath,
  boardDemoSessionProcessAlive,
  readBoardDemoSession
} from "../lib/board-demo-session.mjs";
import { signCameraPayload } from "../lib/camera-ingest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_TOKEN = "board-demo-local-admin-token-change-me";
const CAMERA_SECRET = "board-demo-local-camera-secret-change-me";
const CAMERA_ID = "north-gate";
const TEAM_ID = "traffic";
const TEAM_NAME = "Traffic and parking";
const BASELINE = {
  incidents: 0,
  activeIncidents: 0,
  dispatches: 0,
  activeDispatches: 0,
  publicNotices: 0,
  configuredCameras: 8,
  armedCameras: 8,
  alertActive: false
};
const timeoutMs = 30_000;
const jsonOutput = process.argv.includes("--json");

if (process.argv.includes("--help")) {
  console.log("Usage: npm run board:prove:incident -- [--json]");
  console.log("Exercises a signed synthetic camera alert, public notice, traffic dispatch, local delivery, recovery, and resolution before restoring the exact board baseline.");
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
  return { apiBase, webBase, visitor: visitor.toString(), operations: operations.toString() };
}

async function requestJson(apiBase, pathname, { admin = false, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: {
      ...(admin ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
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

function assignmentDirectoryIsPrivate(payload) {
  const teams = payload.assignmentDirectory?.teams || [];
  const people = [
    ...(payload.assignmentDirectory?.staff || []),
    ...(payload.assignmentDirectory?.volunteers || [])
  ];
  return teams.some(team => team.id === TEAM_ID && team.name === TEAM_NAME && team.notificationReady === true)
    && people.every(person => !("email" in person));
}

async function baselineSnapshot(apiBase) {
  const [conditions, publicConditions, alert] = await Promise.all([
    adminJson(apiBase, "/api/admin/island-conditions"),
    requestJson(apiBase, "/api/public/island-conditions").then(({ response, payload }) => {
      if (!response.ok) throw new Error(`Public Island Conditions returned ${response.status}.`);
      return payload;
    }),
    adminJson(apiBase, "/api/admin/alert")
  ]);
  if (!assignmentDirectoryIsPrivate(conditions)) {
    throw new Error("The incident assignment directory exposed an address or lost the prepared Traffic route.");
  }
  return {
    incidents: conditions.incidentSummary?.total,
    activeIncidents: conditions.incidentSummary?.active,
    dispatches: conditions.dispatchSummary?.total,
    activeDispatches: conditions.dispatchSummary?.active,
    publicNotices: publicConditions.notices?.length,
    configuredCameras: conditions.summary?.configuredCameras,
    armedCameras: conditions.summary?.armedCameras,
    alertActive: alert.alert?.active === true
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
  if (!baselineMatches(snapshot)) throw new Error(`Board reset did not restore the exact incident baseline: ${JSON.stringify(snapshot)}.`);
  return {
    fromGeneration: health.boardDemoGeneration,
    toGeneration: restored.generation,
    ...snapshot,
    preflight: `${report.passed}/${report.total}`
  };
}

function localDateTimeInput(value) {
  const date = new Date(value);
  const pad = number => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function postSignedObservation(apiBase, payload) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signCameraPayload(body, timestamp, CAMERA_SECRET);
  return requestJson(apiBase, `/api/ingest/cameras/${CAMERA_ID}/observations`, {
    method: "POST",
    body,
    headers: {
      "x-sandfest-timestamp": timestamp,
      "x-sandfest-signature": `sha256=${signature}`
    }
  });
}

async function refreshConditions(page) {
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/admin/island-conditions"
    && response.request().method() === "GET"
  ), { timeout: timeoutMs });
  await page.locator("#admin-load-conditions").click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`Operations Island Conditions refresh returned ${response.status()}.`);
}

function incidentCard(page, incidentId) {
  return page.locator("#admin-incidents .admin-incident-card").filter({
    has: page.locator(`[data-save-incident="${incidentId}"]`)
  });
}

function dispatchRow(page, dispatchId) {
  return page.locator(`[data-dispatch-control="${dispatchId}"]`);
}

function responseIsPrivate(value) {
  const serialized = JSON.stringify(value);
  return !serialized.includes("@")
    && !serialized.includes('"recipient":')
    && !serialized.includes("deliveryIdempotencyKey")
    && !serialized.includes("deliveryClaimId");
}

async function updateIncidentFromOperations(page, incident, runId) {
  const card = incidentCard(page, incident.id);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(incident.title);
  await expect(card).toContainText("Public notice review");
  const controls = card.locator(`[data-incident-control="${incident.id}"]`);
  await controls.locator('[name="status"]').selectOption("responding");
  await controls.locator('[name="ownerTeam"]').selectOption(TEAM_ID);
  await controls.locator('[name="ownerName"]').fill("Board traffic desk");
  await controls.locator('[name="publicImpact"]').check();
  await controls.locator('[name="note"]').fill(`Secondary arrival lane opened ${runId}.`);
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/island-conditions/incidents/${incident.id}`
    && response.request().method() === "PATCH"
  ), { timeout: timeoutMs });
  await controls.locator(`[data-save-incident="${incident.id}"]`).click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (
    !response.ok()
    || payload.incident?.status !== "responding"
    || payload.incident?.ownerTeam !== TEAM_ID
    || payload.incident?.ownerName !== "Board traffic desk"
    || payload.incident?.publicImpact !== true
  ) {
    throw new Error(`Operations did not approve and assign the camera incident correctly: ${JSON.stringify({
      status: response.status(),
      error: payload.error || null,
      incident: payload.incident || null
    })}.`);
  }
  await expect(incidentCard(page, incident.id)).toContainText("Public notice approved");
  return payload.incident;
}

async function provePublicNotice(context, endpoints, incident) {
  const { response, payload } = await requestJson(endpoints.apiBase, "/api/public/island-conditions");
  const notice = payload.notices?.find(item => item.id === incident.id);
  if (!response.ok || !notice || JSON.stringify(Object.keys(notice).sort()) !== JSON.stringify(["id", "severity", "summary", "title", "updatedAt"])) {
    throw new Error("The approved incident did not produce the privacy-safe public notice projection.");
  }
  const visitorPage = await context.newPage();
  const visitorUrl = new URL(endpoints.visitor);
  visitorUrl.hash = "island-conditions";
  await visitorPage.goto(visitorUrl.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const refreshPromise = visitorPage.waitForResponse(item => (
    new URL(item.url()).pathname === "/api/public/island-conditions"
    && item.request().method() === "GET"
  ), { timeout: timeoutMs });
  await visitorPage.locator("#refresh-island-conditions").click();
  await refreshPromise;
  const notices = visitorPage.locator("#island-condition-notices");
  const noticeCard = notices.locator(`[data-public-incident="${incident.id}"]`);
  await expect(notices).toBeVisible();
  await expect(noticeCard).toContainText(incident.title);
  await expect(noticeCard).toContainText(incident.summary);
  await expect(noticeCard.locator("time")).toHaveAttribute("datetime", notice.updatedAt);
  await expect(noticeCard.locator("time")).toContainText("Updated");
  await expect(noticeCard).not.toContainText("Board traffic desk");
  return { notice, visitorPage };
}

async function createDispatchFromOperations(page, incident, runId) {
  const card = incidentCard(page, incident.id);
  const form = card.locator(`[data-create-dispatch="${incident.id}"]`);
  await form.locator('[name="assigneeType"]').selectOption("team");
  const trafficOption = form.locator(`[name="assigneeId"] option[value="${TEAM_ID}"]`);
  await expect(trafficOption).toHaveCount(1);
  await expect(trafficOption).toContainText("email routed");
  await form.locator('[name="assigneeId"]').selectOption(TEAM_ID);
  await form.locator('[name="channel"]').selectOption("email");
  const title = `Open North Gate relief lane ${runId}`;
  const instructions = `Acknowledge with command, open the relief lane, and report when the queue is stable ${runId}.`;
  await form.locator('[name="title"]').fill(title);
  await form.locator('[name="instructions"]').fill(instructions);
  await form.locator('[name="dueAt"]').fill(localDateTimeInput(Date.now() + 30 * 60_000));
  const pathname = `/api/admin/island-conditions/incidents/${incident.id}/dispatches`;
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === pathname
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await form.locator('button[type="submit"]').click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  const dispatch = payload.dispatch;
  if (
    response.status() !== 201
    || dispatch?.assigneeType !== "team"
    || dispatch?.assigneeId !== TEAM_ID
    || dispatch?.assigneeName !== TEAM_NAME
    || dispatch?.status !== "assigned"
    || dispatch?.notification?.status !== "draft_ready"
    || dispatch?.notification?.recipientAvailable !== true
    || !responseIsPrivate(payload)
  ) {
    throw new Error("The Traffic dispatch lost its governed assignment, message draft, or private projection.");
  }
  await expect(dispatchRow(page, dispatch.id)).toContainText(title);
  return { dispatch, title, instructions };
}

async function approveAndSendDispatch(page, apiBase, incidentId, created) {
  let row = dispatchRow(page, created.dispatch.id);
  await expect(row.locator('[name="subject"]')).toHaveValue(/\[SandFest critical\]/);
  await expect(row.locator('[name="body"]')).toHaveValue(new RegExp(created.title));
  const reviewPath = `/api/admin/island-conditions/incidents/${incidentId}/dispatches/${created.dispatch.id}/review`;
  const approvalPromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === reviewPath
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await row.locator('[data-review-dispatch="approve"]').click();
  const approval = await approvalPromise;
  const approved = await approval.json().catch(() => ({}));
  if (!approval.ok() || approved.dispatch?.notification?.status !== "approved" || !responseIsPrivate(approved)) {
    throw new Error("The dispatch message did not pass review with a private response.");
  }

  row = dispatchRow(page, created.dispatch.id);
  const sendPath = `/api/admin/island-conditions/incidents/${incidentId}/dispatches/${created.dispatch.id}/send`;
  const queuePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === sendPath
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await row.locator("[data-send-dispatch]").click();
  const queuedResponse = await queuePromise;
  const queued = await queuedResponse.json().catch(() => ({}));
  if (queuedResponse.status() !== 202 || queued.dispatch?.notification?.status !== "queued" || !queued.job?.id || !responseIsPrivate(queued)) {
    throw new Error("The reviewed dispatch did not enter the durable private delivery queue.");
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const conditions = await adminJson(apiBase, "/api/admin/island-conditions");
    const dispatch = conditions.dispatches?.find(item => item.id === created.dispatch.id);
    if (dispatch?.notification?.status === "sent") {
      if (
        dispatch.notification.provider !== "brevo"
        || !String(dispatch.notification.providerMessageId || "").startsWith("board-mail-")
        || dispatch.notification.recipientAvailable !== true
        || !responseIsPrivate(dispatch)
      ) {
        throw new Error("The incident email lost authenticated sandbox or privacy evidence.");
      }
      await refreshConditions(page);
      await expect(dispatchRow(page, dispatch.id)).toContainText("via brevo");
      return dispatch;
    }
    await delay(250);
  }
  throw new Error("The incident dispatch did not reach authenticated local delivery in time.");
}

async function updateDispatchStatus(page, incidentId, dispatchId, status, note) {
  const row = dispatchRow(page, dispatchId);
  await row.locator('[name="dispatchStatus"]').selectOption(status);
  await row.locator('[name="dispatchNote"]').fill(note);
  const pathname = `/api/admin/island-conditions/incidents/${incidentId}/dispatches/${dispatchId}`;
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === pathname
    && response.request().method() === "PATCH"
  ), { timeout: timeoutMs });
  await row.locator(`[data-save-dispatch="${dispatchId}"]`).click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok() || payload.dispatch?.status !== status || !responseIsPrivate(payload)) {
    throw new Error(`The dispatch did not move to ${status} with a private response.`);
  }
  await expect(dispatchRow(page, dispatchId).locator('[name="dispatchStatus"]')).toHaveValue(status);
  return payload.dispatch;
}

async function recoverCameraIncident(apiBase, incidentId, runId) {
  const recoveryMetrics = [
    { peopleCount: 40, occupancyPct: 15, queueLength: 2, estimatedWaitMinutes: 2 },
    { peopleCount: 35, occupancyPct: 14, queueLength: 1, estimatedWaitMinutes: 2 },
    { peopleCount: 32, occupancyPct: 12, queueLength: 1, estimatedWaitMinutes: 1 }
  ];
  let monitoringAction = false;
  for (let index = 0; index < 9 && !monitoringAction; index += 1) {
    const metrics = recoveryMetrics[index % recoveryMetrics.length];
    const result = await postSignedObservation(apiBase, {
      eventId: `board-incident-recovery-${runId}-${index}`,
      sourceId: boardCameraSourceId(CAMERA_ID),
      observedAt: new Date(Date.now() + index).toISOString(),
      confidence: 0.98,
      notes: "Synthetic board incident recovery; no camera media was read or stored.",
      ...metrics
    });
    if (result.response.status !== 201) throw new Error(`Camera recovery signal ${index + 1} returned ${result.response.status}.`);
    monitoringAction = result.payload.incidentAction === "monitoring" || result.payload.incident?.status === "monitoring";
  }
  const conditions = await adminJson(apiBase, "/api/admin/island-conditions");
  const incident = conditions.incidents?.find(item => item.id === incidentId);
  if (!monitoringAction || incident?.status !== "monitoring") {
    throw new Error("Three privacy-minimized recovery signals did not move the camera incident to monitoring.");
  }
  return incident;
}

async function resolveIncidentFromOperations(page, visitorPage, incidentId, title, runId) {
  await refreshConditions(page);
  const card = incidentCard(page, incidentId);
  await expect(card.locator('[name="status"]')).toHaveValue("monitoring");
  const resolution = `North Gate relief lane restored normal queue and wait conditions ${runId}.`;
  await card.locator('[name="status"]').selectOption("resolved");
  await card.locator('[name="note"]').fill(resolution);
  const pathname = `/api/admin/island-conditions/incidents/${incidentId}`;
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === pathname
    && response.request().method() === "PATCH"
  ), { timeout: timeoutMs });
  await card.locator(`[data-save-incident="${incidentId}"]`).click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok() || payload.incident?.status !== "resolved" || payload.incident?.resolution !== resolution) {
    throw new Error("Operations did not resolve the recovered incident with closeout evidence.");
  }
  const refreshPromise = visitorPage.waitForResponse(item => (
    new URL(item.url()).pathname === "/api/public/island-conditions"
    && item.request().method() === "GET"
  ), { timeout: timeoutMs });
  await visitorPage.locator("#refresh-island-conditions").click();
  await refreshPromise;
  await expect(visitorPage.locator("#island-condition-notices")).toBeHidden();
  await expect(visitorPage.locator("#island-condition-notices")).not.toContainText(title);
  return { incident: payload.incident, resolution };
}

function hasForbiddenAuditKey(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasForbiddenAuditKey);
  return Object.entries(value).some(([key, item]) => (
    ["recipient", "deliveryIdempotencyKey", "deliveryClaimId"].includes(key)
    || hasForbiddenAuditKey(item)
  ));
}

async function proveAudit(apiBase, incidentId, dispatchId) {
  const payload = await adminJson(apiBase, "/api/admin/audit?limit=200");
  const records = (payload.audit || []).map(item => item.record).filter(record => (
    (record?.target?.type === "conditions_incident" && record.target.id === incidentId)
    || (record?.target?.type === "incident_dispatch" && record.target.id === dispatchId)
  ));
  const incidentActions = records.filter(record => record.target.type === "conditions_incident").map(record => record.action).sort();
  const dispatchActions = records.filter(record => record.target.type === "incident_dispatch").map(record => record.action).sort();
  const expectedIncident = [
    "conditions.incident.monitoring",
    "conditions.incident.opened",
    "conditions.incident.update",
    "conditions.incident.update"
  ];
  const expectedDispatch = [
    "conditions.dispatch.create",
    "conditions.dispatch.message.approve",
    "conditions.dispatch.message.queue",
    "conditions.dispatch.update",
    "conditions.dispatch.update",
    "conditions.dispatch.update",
    "conditions.dispatch.update"
  ];
  if (JSON.stringify(incidentActions) !== JSON.stringify(expectedIncident) || JSON.stringify(dispatchActions) !== JSON.stringify(expectedDispatch)) {
    throw new Error(`Incident journey audit actions were incomplete: ${JSON.stringify({ incidentActions, dispatchActions })}.`);
  }
  const serialized = JSON.stringify(records);
  if (
    hasForbiddenAuditKey(records)
    || serialized.includes("@")
    || serialized.includes(CAMERA_SECRET)
    || serialized.includes('"signature"')
  ) {
    throw new Error("Incident journey audit exposed a routed contact or delivery/ingest ownership value.");
  }
  return { records: records.length, incidentActions, dispatchActions, private: true };
}

const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });
const runId = randomUUID().slice(0, 8);
const result = {
  ok: false,
  runId,
  camera: null,
  incident: null,
  notice: null,
  dispatch: null,
  delivery: null,
  recovery: null,
  resolution: null,
  audit: null,
  reset: null
};
let browser = null;
let resetRequired = false;
let workflowError = null;

try {
  log("\n=== Active board camera incident journey proof ===\n");
  let report = await stablePreflight(sessionFile);
  let session = await readBoardDemoSession(sessionFile);
  let endpoints = activeSession(session, report);
  const initial = await baselineSnapshot(endpoints.apiBase);
  if (!baselineMatches(initial)) {
    log("Restoring the prepared incident-command baseline before rehearsal...");
    result.reset = await resetBaseline(sessionFile, session);
    session = await readBoardDemoSession(sessionFile);
    report = await stablePreflight(sessionFile);
    endpoints = activeSession(session, report);
  }

  resetRequired = true;
  const criticalPayload = {
    eventId: `board-incident-critical-${runId}`,
    sourceId: boardCameraSourceId(CAMERA_ID),
    observedAt: new Date().toISOString(),
    peopleCount: 410,
    occupancyPct: 91,
    queueLength: 23,
    estimatedWaitMinutes: 35,
    confidence: 0.99,
    notes: "Synthetic board incident threshold; no camera media was read or stored."
  };
  const critical = await postSignedObservation(endpoints.apiBase, criticalPayload);
  const replay = await postSignedObservation(endpoints.apiBase, criticalPayload);
  if (
    critical.response.status !== 201
    || critical.payload.incidentAction !== "opened"
    || critical.payload.incident?.status !== "open"
    || critical.payload.incident?.severity !== "critical"
    || replay.response.status !== 200
    || replay.payload.duplicate !== true
  ) {
    throw new Error("The signed critical camera metric did not open exactly one idempotent incident.");
  }
  const incidentId = critical.payload.incident.id;
  const openedConditions = await adminJson(endpoints.apiBase, "/api/admin/island-conditions");
  const openedIncident = openedConditions.incidents?.find(item => item.id === incidentId);
  if (!openedIncident || openedConditions.incidents.filter(item => item.sourceType === "camera_condition" && item.sourceId === CAMERA_ID).length !== 1) {
    throw new Error("Incident Command did not retain exactly one North Gate camera incident.");
  }
  result.camera = { cameraId: CAMERA_ID, incidentAction: critical.payload.incidentAction, severity: openedIncident.severity, replayed: true, rawMediaStored: false };

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const operationsPage = await context.newPage();
  const operationsUrl = new URL(endpoints.operations);
  operationsUrl.hash = "admin-incident-command";
  await operationsPage.goto(operationsUrl.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await operationsPage.waitForFunction(() => {
    const status = document.querySelector("#admin-api-status");
    return status?.dataset.workspaceState === "ready" && status.getAttribute("aria-busy") === "false";
  }, null, { timeout: timeoutMs });
  await expect(operationsPage.locator("#network-status")).toHaveText("Demo");
  await expect(operationsPage.locator("#runtime-data-notice")).toContainText("No external messages, charges, or live-provider calls");
  await refreshConditions(operationsPage);

  const respondingIncident = await updateIncidentFromOperations(operationsPage, openedIncident, runId);
  result.incident = { id: incidentId, status: respondingIncident.status, severity: respondingIncident.severity, ownerTeam: respondingIncident.ownerTeam, publicImpact: respondingIncident.publicImpact };
  const publicProof = await provePublicNotice(context, endpoints, respondingIncident);
  result.notice = { visible: true, severity: publicProof.notice.severity, privateProjection: true };

  const created = await createDispatchFromOperations(operationsPage, respondingIncident, runId);
  result.dispatch = { id: created.dispatch.id, assigneeType: created.dispatch.assigneeType, assigneeName: created.dispatch.assigneeName, status: created.dispatch.status, messageReview: created.dispatch.notification.status };
  const sent = await approveAndSendDispatch(operationsPage, endpoints.apiBase, incidentId, created);
  result.delivery = {
    status: sent.notification.status,
    provider: sent.notification.provider,
    sandboxAuthenticated: String(sent.notification.providerMessageId).startsWith("board-mail-"),
    recipientConcealed: !("recipient" in sent.notification)
  };

  await updateDispatchStatus(operationsPage, incidentId, created.dispatch.id, "acknowledged", `Traffic desk acknowledged ${runId}.`);
  await updateDispatchStatus(operationsPage, incidentId, created.dispatch.id, "en_route", `Relief team is moving to North Gate ${runId}.`);
  await updateDispatchStatus(operationsPage, incidentId, created.dispatch.id, "on_scene", `Relief team is on scene ${runId}.`);
  const completedDispatch = await updateDispatchStatus(operationsPage, incidentId, created.dispatch.id, "completed", `Relief lane is open and command has the final count ${runId}.`);
  result.dispatch.status = completedDispatch.status;

  const monitoredIncident = await recoverCameraIncident(endpoints.apiBase, incidentId, runId);
  result.recovery = { status: monitoredIncident.status, latestLevel: monitoredIncident.latestLevel, automatic: true };
  const resolved = await resolveIncidentFromOperations(operationsPage, publicProof.visitorPage, incidentId, respondingIncident.title, runId);
  result.resolution = { status: resolved.incident.status, publicNoticeRemoved: true, dispatchStatus: completedDispatch.status };

  const finalConditions = await adminJson(endpoints.apiBase, "/api/admin/island-conditions");
  const finalDispatch = finalConditions.dispatches?.find(item => item.id === created.dispatch.id);
  if (
    finalConditions.incidentSummary?.total !== 1
    || finalConditions.incidentSummary?.active !== 0
    || finalConditions.incidentSummary?.publicNotices !== 0
    || finalConditions.dispatchSummary?.total !== 1
    || finalConditions.dispatchSummary?.completed !== 1
    || finalConditions.dispatchSummary?.sentMessages !== 1
    || finalDispatch?.status !== "completed"
    || finalDispatch?.notification?.status !== "sent"
  ) {
    throw new Error("The resolved incident did not retain complete dispatch and delivery evidence in Operations.");
  }
  result.audit = await proveAudit(endpoints.apiBase, incidentId, created.dispatch.id);
  log(`Verified ${incidentId} from signed camera threshold through public closeout.`);
} catch (error) {
  workflowError = error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (resetRequired) {
    try {
      const session = await readBoardDemoSession(sessionFile);
      result.reset = await resetBaseline(sessionFile, session);
      log(`Restored the exact incident baseline at ${result.reset.preflight} readiness.`);
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
  else console.error(`\nBoard camera incident journey proof failed: ${workflowError.message}`);
  process.exitCode = 1;
} else {
  result.ok = true;
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("\nBoard camera incident journey proof passed.");
    console.log(`Camera:      ${result.camera.cameraId} · ${result.camera.severity} · retry-safe`);
    console.log(`Public:      approved notice visible, privacy-safe, and removed at ${result.resolution.status}`);
    console.log(`Dispatch:    ${result.dispatch.assigneeName} · ${result.dispatch.status}`);
    console.log(`Delivery:    ${result.delivery.status} through authenticated local ${result.delivery.provider}`);
    console.log(`Recovery:    automatic ${result.recovery.status} · manual resolution recorded`);
    console.log(`Audit:       ${result.audit.records} contact- and ownership-safe records`);
    console.log(`Reset:       ${result.reset.incidents} incidents · ${result.reset.dispatches} dispatches · ${result.reset.publicNotices} notices · ${result.reset.preflight}`);
  }
}
