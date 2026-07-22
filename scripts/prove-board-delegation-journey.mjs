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
const VOLUNTEER_ID = "vol_001";
const BASELINE = {
  total: 11,
  active: 10,
  open: 9,
  inProgress: 1,
  blocked: 0,
  completed: 1,
  cancelled: 0,
  followups: 24,
  assignmentNotices: 10
};
const timeoutMs = 30_000;
const jsonOutput = process.argv.includes("--json");

if (process.argv.includes("--help")) {
  console.log("Usage: npm run board:prove:delegation -- [--json]");
  console.log("Moves one volunteer assignment from Operations through authenticated local delivery and the private assignee portal, then restores the exact board baseline.");
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

async function requestJson(apiBase, pathname, { admin = false, method = "GET", body } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: {
      ...(admin ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" })
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

function assignmentDirectoryIsPrivate(partners) {
  const volunteers = partners.assignmentDirectory?.volunteers || [];
  const staff = partners.assignmentDirectory?.staff || [];
  return volunteers.some(item => item.id === VOLUNTEER_ID && item.emailAvailable === true)
    && [...volunteers, ...staff].every(item => !("email" in item));
}

async function baselineSnapshot(apiBase) {
  const partners = await adminJson(apiBase, "/api/admin/partners");
  if (!assignmentDirectoryIsPrivate(partners)) throw new Error("The assignment directory exposed an address or lost the prepared volunteer recipient.");
  const totals = partners.taskBoard?.totals || {};
  return {
    total: totals.total,
    active: totals.active,
    open: totals.open,
    inProgress: totals.inProgress,
    blocked: totals.blocked,
    completed: totals.completed,
    cancelled: totals.cancelled,
    followups: partners.followups?.length,
    assignmentNotices: partners.followups?.filter(item => item.kind === "task_assignment").length
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
  if (!baselineMatches(snapshot)) throw new Error(`Board reset did not restore the exact delegation baseline: ${JSON.stringify(snapshot)}.`);
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

async function waitForOperations(page) {
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: timeoutMs });
}

async function createDelegatedTask(page, runId) {
  const title = `Board volunteer gate handoff ${runId}`;
  const description = `Prepare the North Gate welcome desk and confirm the volunteer captain handoff ${runId}.`;
  const form = page.locator("#admin-create-task");
  await form.locator('[name="assigneeType"]').selectOption("volunteer");
  const assignee = form.locator('[name="assigneeId"]');
  const volunteerOption = assignee.locator(`option[value="${VOLUNTEER_ID}"]`);
  await expect(volunteerOption).toHaveCount(1);
  await expect(volunteerOption).toContainText("notifications ready");
  await assignee.selectOption(VOLUNTEER_ID);
  await form.locator('[name="title"]').fill(title);
  await form.locator('[name="priority"]').selectOption("high");
  await form.locator('[name="dueAt"]').fill(localDateTimeInput(Date.now() + 7 * 86_400_000));
  await form.locator('[name="description"]').fill(description);
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/admin/partners/tasks"
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await form.locator('button[type="submit"]').click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  const task = payload.task;
  if (
    response.status() !== 201
    || task?.status !== "open"
    || task?.priority !== "high"
    || task?.assigneeType !== "volunteer"
    || task?.assigneeId !== VOLUNTEER_ID
    || !task?.assigneeName
    || Number(task?.assignmentVersion) !== 1
  ) {
    throw new Error(`Task delegation returned ${response.status()} without the governed volunteer assignment.`);
  }
  if (/tsft_|@/.test(JSON.stringify(task))) throw new Error("Task creation exposed an assignment capability or recipient address.");
  const card = page.locator(`#admin-partner-tasks [data-task="${task.id}"]`);
  await expect(card).toContainText(title);
  await expect(card).toContainText(task.assigneeName);
  await expect(card).toContainText("Awaiting assignee acknowledgement");
  return { task, title, description, assigneeName: task.assigneeName };
}

function taskPortalAccessFromMessage(followup, endpoints, taskId) {
  const match = String(followup?.body || "").match(/https?:\/\/[^\s]+#task-status\?[^\s]+/);
  if (!match) throw new Error("The delivered assignment message did not contain a private task URL.");
  const url = new URL(match[0]);
  const params = new URLSearchParams(url.hash.slice("#task-status?".length));
  const token = params.get("token") || "";
  if (
    url.origin !== endpoints.webBase
    || url.pathname !== "/"
    || url.search
    || params.get("task") !== taskId
    || !/^tsft_[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new Error("The delivered assignment URL is not scoped to the active task and board site.");
  }
  return { url, token };
}

async function waitForAssignmentDelivery(apiBase, endpoints, delegated) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const partners = await adminJson(apiBase, "/api/admin/partners");
    const followup = partners.followups?.find(item => item.taskId === delegated.task.id && item.kind === "task_assignment");
    if (followup?.status === "sent" && followup.deliveryStatus === "delivered") {
      if (
        followup.subject !== `Texas SandFest task assigned - ${delegated.title}`
        || followup.sourceVersion !== "assignment:1"
        || followup.automationPolicy !== "partner_transactional_v1"
        || followup.provider !== "brevo"
        || !String(followup.providerMessageId || "").startsWith("board-mail-")
        || followup.recipientAvailable !== true
        || followup.recipientLabel !== delegated.assigneeName
        || "recipient" in followup
      ) {
        throw new Error("The assignment delivery lost its authenticated, private, or versioned evidence.");
      }
      return { followup, access: taskPortalAccessFromMessage(followup, endpoints, delegated.task.id) };
    }
    await delay(250);
  }
  throw new Error("The volunteer assignment did not reach authenticated local delivery in time.");
}

async function refreshOperations(page) {
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/admin/partners"
    && response.request().method() === "GET"
  ), { timeout: timeoutMs });
  await page.locator("#admin-load-partners").click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`Operations refresh returned ${response.status()}.`);
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    document.body.scrollWidth - document.body.clientWidth
  ));
  if (overflow > 1) throw new Error(`The private task portal overflows its mobile viewport by ${overflow}px.`);
}

async function clickTaskAction(page, action) {
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/public/task-status/update"
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await page.locator(`[data-task-action="${action}"]`).click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`Task assignee ${action} returned ${response.status()}: ${payload.error || "unknown error"}.`);
  return payload;
}

function publicTaskProjectionIsPrivate(payload, access, delegated) {
  const serialized = JSON.stringify(payload);
  return !serialized.includes(access.token)
    && !serialized.includes("assigneeId")
    && !serialized.includes("assignmentVersion")
    && !serialized.includes("recipient")
    && !serialized.includes("@")
    && !serialized.includes(delegated.task.idempotencyKey || "idempotencyKey");
}

async function exerciseAssigneePortal(context, endpoints, operationsPage, delegated, delivery, runId) {
  const denied = await requestJson(endpoints.apiBase, "/api/public/task-status", {
    method: "POST",
    body: { taskId: delegated.task.id, token: "tsft_wrong_board_proof" }
  });
  if (denied.response.status !== 404) throw new Error("The private task portal accepted an invalid assignment capability.");

  const taskPage = await context.newPage();
  await taskPage.setViewportSize({ width: 360, height: 780 });
  const taskUrl = new URL(delivery.access.url);
  taskUrl.searchParams.set("apiBase", endpoints.apiBase);
  const statusResponsePromise = taskPage.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/public/task-status"
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await taskPage.goto(taskUrl.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const statusResponse = await statusResponsePromise;
  const initial = await statusResponse.json().catch(() => ({}));
  if (!statusResponse.ok() || initial.task?.status !== "open" || !publicTaskProjectionIsPrivate(initial, delivery.access, delegated)) {
    throw new Error("The private task portal did not return the approved assignment-safe projection.");
  }
  await expect(taskPage).toHaveURL(url => url.hash === "#task-status" && !url.href.includes("token="));
  await expect(taskPage.locator("#task-status-result")).toContainText(delegated.title);
  await expect(taskPage.locator("#task-status-result")).toContainText(delegated.assigneeName);
  await expect(taskPage.locator("#task-status-result")).toBeFocused();
  await expect(taskPage.locator('[data-task-action="acknowledge"]')).toBeVisible();
  await assertNoHorizontalOverflow(taskPage);

  const acknowledged = await clickTaskAction(taskPage, "acknowledge");
  if (!acknowledged.task?.acknowledgedAt || acknowledged.task?.status !== "open") {
    throw new Error("The volunteer acknowledgement did not reach Operations.");
  }
  await expect(taskPage.locator("#task-status-result")).toContainText("Acknowledged");

  const started = await clickTaskAction(taskPage, "start");
  if (started.task?.status !== "in_progress" || !started.task?.startedAt) {
    throw new Error("The volunteer start action did not move the task into progress.");
  }
  await expect(taskPage.locator("#task-status-result")).toHaveAttribute("data-state", "in_progress");

  await taskPage.locator('[data-task-action="block"]').click();
  await expect(taskPage.locator(".task-status-message")).toContainText("Describe the blocker");
  await expect(taskPage.locator('#task-status-update [name="note"]')).toBeFocused();
  const blockerNote = `North Gate needs two additional welcome packets ${runId}.`;
  await taskPage.locator('#task-status-update [name="note"]').fill(blockerNote);
  const blocked = await clickTaskAction(taskPage, "block");
  if (blocked.task?.status !== "blocked" || blocked.task?.updates?.at(-1)?.note !== blockerNote) {
    throw new Error("The volunteer blocker did not reach the private task history.");
  }
  await expect(taskPage.locator("#task-status-result")).toContainText(blockerNote);

  await refreshOperations(operationsPage);
  await operationsPage.locator("#admin-task-status-filter").selectOption("blocked");
  const taskCard = operationsPage.locator(`#admin-partner-tasks [data-task="${delegated.task.id}"]`);
  await expect(taskCard).toContainText(delegated.title);
  await expect(taskCard.locator('[name="status"]')).toHaveValue("blocked");
  await expect(taskCard).toContainText("Acknowledged");
  await expect(taskCard).toContainText("Latest assignee note");
  await expect(taskCard).toContainText(blockerNote);

  const completionNote = `Welcome packets delivered and volunteer captain briefed ${runId}.`;
  await taskPage.locator('#task-status-update [name="note"]').fill(completionNote);
  const completed = await clickTaskAction(taskPage, "complete");
  if (
    completed.task?.status !== "done"
    || !completed.task?.completedAt
    || completed.task?.allowedActions?.length !== 0
    || completed.task?.updates?.length !== 4
  ) {
    throw new Error("The volunteer completion did not close the assignment cleanly.");
  }
  await expect(taskPage.locator("#task-status-result")).toHaveAttribute("data-state", "done");
  await expect(taskPage.locator("#task-status-result")).toContainText(completionNote);
  await expect(taskPage.locator("#task-status-update")).toBeHidden();
  await assertNoHorizontalOverflow(taskPage);

  const replay = await requestJson(endpoints.apiBase, "/api/public/task-status/update", {
    method: "POST",
    body: {
      taskId: delegated.task.id,
      token: delivery.access.token,
      action: "complete",
      note: completionNote
    }
  });
  if (replay.response.status !== 200 || replay.payload.replay !== true || replay.payload.task?.status !== "done") {
    throw new Error("The completed assignment did not treat a retry as an idempotent replay.");
  }
  if (!publicTaskProjectionIsPrivate(replay.payload, delivery.access, delegated)) {
    throw new Error("The completed task replay expanded beyond the assignment-safe projection.");
  }

  await refreshOperations(operationsPage);
  await operationsPage.locator("#admin-task-status-filter").selectOption("done");
  await expect(taskCard).toContainText(delegated.title);
  await expect(taskCard.locator('[name="status"]')).toHaveValue("done");
  await expect(taskCard).toContainText(completionNote);
  await expect(taskCard).toContainText("Assignment notices · 1 issued · latest delivered");
  await taskPage.close();

  return {
    invalidCapabilityDenied: true,
    capabilityConcealed: true,
    acknowledged: Boolean(acknowledged.task.acknowledgedAt),
    started: started.task.status === "in_progress",
    blockerNoteRequired: true,
    blocked: blocked.task.status === "blocked",
    completed: completed.task.status === "done",
    replayed: replay.payload.replay === true,
    updates: completed.task.updates.length,
    blockerNote,
    completionNote
  };
}

async function proveFinalOperations(apiBase, delegated) {
  const partners = await adminJson(apiBase, "/api/admin/partners");
  const stored = partners.tasks?.find(item => item.id === delegated.task.id);
  const notices = partners.followups?.filter(item => item.taskId === delegated.task.id && item.kind === "task_assignment") || [];
  const totals = partners.taskBoard?.totals || {};
  if (
    !assignmentDirectoryIsPrivate(partners)
    || !stored
    || stored.status !== "done"
    || stored.assigneeType !== "volunteer"
    || stored.assigneeId !== VOLUNTEER_ID
    || !stored.acknowledgedAt
    || !stored.startedAt
    || !stored.completedAt
    || stored.assigneeUpdates?.length !== 4
    || notices.length !== 1
    || notices[0].deliveryStatus !== "delivered"
    || totals.total !== 12
    || totals.active !== 10
    || totals.open !== 9
    || totals.inProgress !== 1
    || totals.blocked !== 0
    || totals.completed !== 2
    || partners.followups?.length !== 25
  ) {
    throw new Error(`The completed delegation is missing from Operations: ${JSON.stringify({ totals, stored, notices: notices.length, followups: partners.followups?.length })}.`);
  }
  return {
    total: totals.total,
    active: totals.active,
    completed: totals.completed,
    assignmentNotices: partners.followups.filter(item => item.kind === "task_assignment").length,
    followups: partners.followups.length
  };
}

async function proveAudit(apiBase, taskId, forbiddenValues) {
  const payload = await adminJson(apiBase, "/api/admin/audit?limit=200");
  const records = (payload.audit || []).map(item => item.record).filter(record => (
    record?.target?.type === "task"
    && record.target.id === taskId
    && String(record.action || "").startsWith("task.assignee.")
  ));
  const actions = records.map(record => record.action).sort();
  const expected = [
    "task.assignee.acknowledge",
    "task.assignee.block",
    "task.assignee.complete",
    "task.assignee.start"
  ];
  if (records.length !== expected.length || JSON.stringify(actions) !== JSON.stringify(expected)) {
    throw new Error(`Task delegation expected four assignee audits but found ${JSON.stringify(actions)}.`);
  }
  if (!records.every(record => record.actor?.type === "capability-link" && record.actor?.permissions?.includes("task:self:update"))) {
    throw new Error("Task assignee audits lost their capability-link attribution.");
  }
  const serialized = JSON.stringify(records);
  for (const forbidden of ["tsft_", "recipient", "email", "assigneeUpdates", ...forbiddenValues]) {
    if (forbidden && serialized.includes(forbidden)) throw new Error(`Task delegation audit exposed private value ${forbidden}.`);
  }
  return { records: records.length, actions };
}

const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });
const runId = randomUUID().slice(0, 8);
const result = {
  ok: false,
  runId,
  delegation: null,
  delivery: null,
  portal: null,
  operations: null,
  audit: null,
  reset: null
};
let browser = null;
let resetRequired = false;
let workflowError = null;

try {
  log("\n=== Active board delegation journey proof ===\n");
  let report = await stablePreflight(sessionFile);
  let session = await readBoardDemoSession(sessionFile);
  let endpoints = activeSession(session, report);
  const initial = await baselineSnapshot(endpoints.apiBase);
  if (!baselineMatches(initial)) {
    log("Restoring the prepared task-delegation baseline before rehearsal...");
    result.reset = await resetBaseline(sessionFile, session);
    session = await readBoardDemoSession(sessionFile);
    report = await stablePreflight(sessionFile);
    endpoints = activeSession(session, report);
  }

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const operationsPage = await context.newPage();
  const operationsUrl = new URL(endpoints.operations);
  operationsUrl.hash = "admin-partners";
  await operationsPage.goto(operationsUrl.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForOperations(operationsPage);
  await expect(operationsPage.locator("#network-status")).toHaveText("Demo");
  await expect(operationsPage.locator("#runtime-data-notice")).toContainText("No external messages, charges, or live-provider calls");
  await operationsPage.locator("#admin-task-status-filter").selectOption("all");

  resetRequired = true;
  const delegated = await createDelegatedTask(operationsPage, runId);
  result.delegation = {
    taskId: delegated.task.id,
    assigneeType: delegated.task.assigneeType,
    assigneeName: delegated.assigneeName,
    priority: delegated.task.priority,
    status: delegated.task.status
  };

  const delivery = await waitForAssignmentDelivery(endpoints.apiBase, endpoints, delegated);
  await refreshOperations(operationsPage);
  const taskCard = operationsPage.locator(`#admin-partner-tasks [data-task="${delegated.task.id}"]`);
  await expect(taskCard).toContainText("Assignment notices · 1 issued · latest delivered");
  const followupCard = operationsPage.locator(`#admin-partner-followups [data-followup="${delivery.followup.id}"]`);
  await expect(followupCard).toHaveAttribute("data-delivery-status", "delivered");
  await expect(followupCard).toContainText(`Texas SandFest task assigned - ${delegated.title}`);
  result.delivery = {
    status: delivery.followup.status,
    deliveryStatus: delivery.followup.deliveryStatus,
    provider: delivery.followup.provider,
    sandboxAuthenticated: String(delivery.followup.providerMessageId).startsWith("board-mail-"),
    privateAccessDelivered: Boolean(delivery.access.token)
  };

  const portal = await exerciseAssigneePortal(context, endpoints, operationsPage, delegated, delivery, runId);
  result.portal = {
    invalidCapabilityDenied: portal.invalidCapabilityDenied,
    capabilityConcealed: portal.capabilityConcealed,
    acknowledged: portal.acknowledged,
    started: portal.started,
    blockerNoteRequired: portal.blockerNoteRequired,
    blocked: portal.blocked,
    completed: portal.completed,
    replayed: portal.replayed,
    updates: portal.updates
  };
  result.operations = await proveFinalOperations(endpoints.apiBase, delegated);
  result.audit = await proveAudit(endpoints.apiBase, delegated.task.id, [
    delivery.access.token,
    portal.blockerNote,
    portal.completionNote
  ]);
  log(`Verified ${delegated.task.id} from Operations assignment through volunteer completion.`);
} catch (error) {
  workflowError = error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (resetRequired) {
    try {
      const session = await readBoardDemoSession(sessionFile);
      result.reset = await resetBaseline(sessionFile, session);
      log(`Restored the exact delegation baseline at ${result.reset.preflight} readiness.`);
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
  else console.error(`\nBoard delegation journey proof failed: ${workflowError.message}`);
  process.exitCode = 1;
} else {
  result.ok = true;
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("\nBoard delegation journey proof passed.");
    console.log(`Assignment:  ${result.delegation.assigneeType} · ${result.delegation.priority} priority`);
    console.log(`Delivery:    ${result.delivery.deliveryStatus} through authenticated local ${result.delivery.provider}`);
    console.log(`Assignee:    acknowledged · started · blocked · completed · ${result.portal.updates} updates`);
    console.log("Privacy:     invalid capability denied · link concealed · blocker note required");
    console.log(`Audit:       ${result.audit.records} note- and capability-safe assignee updates`);
    console.log(`Reset:       ${result.reset.total} tasks · ${result.reset.active} active · ${result.reset.completed} complete · ${result.reset.preflight}`);
  }
}
