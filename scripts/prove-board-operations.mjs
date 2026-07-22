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
const SPONSOR_APPLICATION_ID = "demo_sapp_0001";
const SPONSOR_NAME = "Gulf Shore Credit Union";
const BASELINE = {
  applications: 5,
  budgetLines: 6,
  expenses: 7,
  payments: 1,
  amountPaidCents: 1_000_000,
  balanceCents: 1_800_000,
  openTasks: 10,
  milestones: 16,
  followups: 24
};
const timeoutMs = 25_000;
const jsonOutput = process.argv.includes("--json");

if (process.argv.includes("--help")) {
  console.log("Usage: npm run board:prove:operations -- [--json]");
  console.log("Exercises accounting, payment, delegation, key-date, and automatic delivery workflows, then restores the board baseline.");
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
  const operations = new URL(String(report.links?.operations || ""));
  if (
    operations.origin !== webBase
    || operations.pathname !== "/admin.html"
    || operations.searchParams.get("apiBase") !== apiBase
  ) {
    throw new Error("Board Operations link does not match the active supervised session.");
  }
  return { apiBase, webBase, operations: operations.toString() };
}

async function adminJson(apiBase, pathName) {
  const response = await fetch(`${apiBase}${pathName}`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`${pathName} returned ${response.status}.`);
  return response.json();
}

async function baselineSnapshot(apiBase) {
  const [partners, budget] = await Promise.all([
    adminJson(apiBase, "/api/admin/partners"),
    adminJson(apiBase, "/api/admin/budget")
  ]);
  return {
    applications: partners.summary?.applications?.total,
    budgetLines: budget.budgetLines?.length,
    expenses: budget.expenses?.length,
    payments: partners.payments?.length,
    amountPaidCents: partners.summary?.finance?.amountPaidCents,
    balanceCents: partners.summary?.finance?.balanceCents,
    openTasks: partners.summary?.operations?.openTasks,
    milestones: partners.milestones?.length,
    followups: partners.followups?.length
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
  const snapshot = await baselineSnapshot(restored.apiBase);
  if (!baselineMatches(snapshot)) {
    throw new Error(`Board reset did not restore the exact Operations baseline: ${JSON.stringify(snapshot)}.`);
  }
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

async function waitForDelivery(apiBase, predicate, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await adminJson(apiBase, "/api/admin/partners");
    const followup = payload.followups?.find(item => predicate(item));
    if (followup?.status === "sent" && followup.deliveryStatus === "delivered") return followup;
    await delay(250);
  }
  throw new Error(`${label} did not reach authenticated local delivery in time.`);
}

async function proveAccounting(page, runId) {
  const lineName = `Board proof guest services ${runId}`;
  const vendorName = `Board proof equipment ${runId}`;
  const budgetLineForm = page.locator("#admin-create-budget-line");
  await budgetLineForm.locator('[name="name"]').fill(lineName);
  await budgetLineForm.locator('[name="ownerTeam"]').selectOption("guest-services");
  await budgetLineForm.locator('[name="amount"]').fill("3000.00");
  await budgetLineForm.locator('[name="notes"]').fill("Reset-safe board Operations proof");
  const lineResponse = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/admin/budget/lines"
      && response.request().method() === "POST"
  ));
  await budgetLineForm.locator('button[type="submit"]').click();
  const lineResult = await lineResponse;
  if (lineResult.status() !== 201) throw new Error(`Budget allocation returned ${lineResult.status()}.`);
  const line = (await lineResult.json()).line;
  await expect(page.locator(`#admin-budget-lines [data-budget-line="${line.id}"]`)).toContainText(lineName);

  const expenseForm = page.locator("#admin-create-expense");
  await expenseForm.locator('[name="budgetLineId"]').selectOption(line.id);
  await expenseForm.locator('[name="vendorName"]').fill(vendorName);
  await expenseForm.locator('[name="amount"]').fill("1200.00");
  await expenseForm.locator('[name="dueDate"]').fill(localDateTimeInput(Date.now() + 14 * 86_400_000).slice(0, 10));
  await expenseForm.locator('[name="description"]').fill("Guest service equipment for the board Operations proof");
  const expenseResponse = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/admin/budget/expenses"
      && response.request().method() === "POST"
  ));
  await expenseForm.locator('button[type="submit"]').click();
  const expenseResult = await expenseResponse;
  if (expenseResult.status() !== 201) throw new Error(`Expense submission returned ${expenseResult.status()}.`);
  const expense = (await expenseResult.json()).expense;
  const expenseCard = page.locator(`#admin-expense-list [data-budget-expense="${expense.id}"]`);
  await expect(expenseCard).toHaveAttribute("data-expense-status", "submitted");

  const approvalResponse = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/budget/expenses/${expense.id}/approve`
      && response.request().method() === "POST"
  ));
  await expenseCard.locator('[data-expense-action="approve"]').click();
  if ((await approvalResponse).status() !== 200) throw new Error("Expense approval failed.");
  await expect(expenseCard).toHaveAttribute("data-expense-status", "approved");

  const privateReference = `BOARD-PROOF-ACH-${runId}`;
  await expenseCard.locator("[data-expense-payment-method]").selectOption("ach");
  await expenseCard.locator("[data-expense-payment-reference]").fill(privateReference);
  const paymentResponse = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/budget/expenses/${expense.id}/mark-paid`
      && response.request().method() === "POST"
  ));
  await expenseCard.locator('[data-expense-action="mark-paid"]').click();
  if ((await paymentResponse).status() !== 200) throw new Error("Expense payment failed.");
  await expect(expenseCard).toHaveAttribute("data-expense-status", "paid");
  await expect(expenseCard).toContainText("ACH payment recorded");
  await expect(expenseCard).not.toContainText(privateReference);
  return { budgetLineId: line.id, expenseId: expense.id, expenseStatus: "paid" };
}

async function proveSponsorPayment(page, runId) {
  const sponsorCard = page.locator("#admin-partner-applications [data-partner-application]")
    .filter({ hasText: SPONSOR_NAME });
  await expect(sponsorCard).toHaveCount(1);
  await expect(sponsorCard).toContainText("$10,000.00 / $15,000.00");
  await sponsorCard.locator('[name="paymentAmount"]').fill("5000.00");
  await sponsorCard.locator('[name="paymentReference"]').fill(`BOARD-PROOF-RECEIPT-${runId}`);
  await sponsorCard.locator('[name="paymentReceivedAt"]').fill(localDateTimeInput(Date.now()));
  const paymentResponse = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/partners/applications/${SPONSOR_APPLICATION_ID}/payments`
      && response.request().method() === "POST"
  ));
  await sponsorCard.locator("[data-record-payment]").click();
  const response = await paymentResponse;
  if (response.status() !== 201) throw new Error(`Sponsor payment returned ${response.status()}.`);
  const payment = (await response.json()).payment;
  await expect(sponsorCard).toContainText("$15,000.00 / $15,000.00");
  await expect(sponsorCard.locator('[data-partner-invoice="demo_invoice_0069"]')).toContainText("$0.00 open");
  const paymentMilestone = page.locator("#admin-partner-milestones [data-admin-milestone]")
    .filter({ hasText: SPONSOR_NAME })
    .filter({ hasText: "Payment due" });
  await expect(paymentMilestone.locator('[name="status"]')).toHaveValue("completed");
  return { paymentId: payment.id, amountCents: payment.amountCents };
}

async function proveDelegation(page, runId) {
  const taskTitle = `Board proof welcome desk ${runId}`;
  const taskForm = page.locator("#admin-create-task");
  await taskForm.locator('[name="assigneeType"]').selectOption("volunteer");
  const owner = taskForm.locator('[name="assigneeId"]');
  await expect.poll(async () => owner.locator("option").count()).toBeGreaterThan(0);
  const volunteerId = await owner.locator("option").first().getAttribute("value");
  if (!volunteerId) throw new Error("No synthetic volunteer was available for delegation.");
  await owner.selectOption(volunteerId);
  await taskForm.locator('[name="title"]').fill(taskTitle);
  await taskForm.locator('[name="priority"]').selectOption("high");
  await taskForm.locator('[name="dueAt"]').fill(localDateTimeInput(Date.now() + 7 * 86_400_000));
  await taskForm.locator('[name="description"]').fill("Welcome volunteers and route them to their assigned captain.");
  const taskResponse = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/admin/partners/tasks"
      && response.request().method() === "POST"
  ));
  await taskForm.locator('button[type="submit"]').click();
  const response = await taskResponse;
  if (response.status() !== 201) throw new Error(`Task delegation returned ${response.status()}.`);
  const task = (await response.json()).task;
  await expect(page.locator(`#admin-partner-tasks [data-task="${task.id}"]`)).toContainText(taskTitle);
  return { taskId: task.id, taskTitle, assigneeType: task.assigneeType };
}

async function proveKeyDate(page, runId) {
  const label = `Board proof creative review ${runId}`;
  const form = page.locator("#admin-create-milestone");
  await form.locator('[name="applicationId"]').selectOption(SPONSOR_APPLICATION_ID);
  await form.locator('[name="label"]').fill(label);
  await form.locator('[name="dueAt"]').fill(localDateTimeInput(Date.now() + 2 * 86_400_000));
  await form.locator('[name="assigneeTeam"]').selectOption("sponsor");
  const milestoneResponse = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/partners/applications/${SPONSOR_APPLICATION_ID}/milestones`
      && response.request().method() === "POST"
  ));
  await form.locator('button[type="submit"]').click();
  const response = await milestoneResponse;
  if (response.status() !== 201) throw new Error(`Key-date creation returned ${response.status()}.`);
  const milestone = (await response.json()).milestone;
  await expect(page.locator(`#admin-partner-milestones [data-admin-milestone="${milestone.id}"]`)).toContainText(label);
  return { milestoneId: milestone.id, label, status: milestone.status };
}

async function proveAutomaticDeliveries(page, apiBase, { payment, delegation, keyDate }) {
  const [paymentFollowup, taskFollowup, milestoneFollowup] = await Promise.all([
    waitForDelivery(apiBase, item => item.paymentId === payment.paymentId && item.kind === "payment_received", "Payment confirmation"),
    waitForDelivery(apiBase, item => item.taskId === delegation.taskId && item.kind === "task_assignment", "Task assignment"),
    waitForDelivery(apiBase, item => item.milestoneId === keyDate.milestoneId && item.kind === "milestone_reminder", "Key-date reminder")
  ]);
  const refresh = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/admin/partners"
      && response.request().method() === "GET"
  ));
  await page.locator("#admin-load-partners").click();
  await refresh;
  for (const followup of [paymentFollowup, taskFollowup, milestoneFollowup]) {
    await expect(page.locator(`#admin-partner-followups [data-followup="${followup.id}"]`))
      .toHaveAttribute("data-delivery-status", "delivered");
  }
  await expect(page.locator(`#admin-partner-followups [data-followup="${paymentFollowup.id}"]`))
    .toContainText("automatic payment confirmation");
  await expect(page.locator(`#admin-partner-followups [data-followup="${taskFollowup.id}"]`))
    .toContainText("transactional automation");
  await expect(page.locator(`#admin-partner-followups [data-followup="${milestoneFollowup.id}"]`))
    .toContainText("automatic key-date reminder");
  return {
    paymentConfirmationId: paymentFollowup.id,
    taskNoticeId: taskFollowup.id,
    keyDateReminderId: milestoneFollowup.id,
    delivered: 3
  };
}

const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });
const runId = randomUUID().slice(0, 8);
const result = {
  ok: false,
  runId,
  accounting: null,
  payment: null,
  delegation: null,
  keyDate: null,
  deliveries: null,
  reset: null
};
let browser = null;
let resetRequired = false;
let workflowError = null;

try {
  log("\n=== Active board Operations proof ===\n");
  const report = preflight(sessionFile);
  let session = await readBoardDemoSession(sessionFile);
  let endpoints = activeSession(session, report);
  const initialSnapshot = await baselineSnapshot(endpoints.apiBase);
  if (!baselineMatches(initialSnapshot)) {
    log("Restoring the prepared Operations baseline before rehearsal...");
    result.reset = await resetBaseline(sessionFile, session);
    session = await readBoardDemoSession(sessionFile);
    endpoints = activeSession(session, preflight(sessionFile));
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const operations = new URL(endpoints.operations);
  operations.hash = "admin-partners";
  await page.goto(operations.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: timeoutMs });
  await expect(page.locator("#network-status")).toHaveText("Demo");
  await expect(page.locator("#runtime-data-notice")).toContainText("No external messages, charges, or live-provider calls");

  resetRequired = true;
  result.accounting = await proveAccounting(page, runId);
  result.payment = await proveSponsorPayment(page, runId);
  result.delegation = await proveDelegation(page, runId);
  result.keyDate = await proveKeyDate(page, runId);
  result.deliveries = await proveAutomaticDeliveries(page, endpoints.apiBase, result);
  log("Verified paid expense, sponsor payment, volunteer task, key date, and three authenticated local deliveries.");
} catch (error) {
  workflowError = error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (resetRequired) {
    try {
      const session = await readBoardDemoSession(sessionFile);
      result.reset = await resetBaseline(sessionFile, session);
      log(`Restored the exact Operations baseline at ${result.reset.preflight} readiness.`);
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
  else console.error(`\nBoard Operations proof failed: ${workflowError.message}`);
  process.exitCode = 1;
} else {
  result.ok = true;
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("\nBoard Operations proof passed.");
    console.log(`Accounting:  expense ${result.accounting.expenseStatus}`);
    console.log(`Receivable:  $${(result.payment.amountCents / 100).toFixed(2)} sponsor payment recorded`);
    console.log(`Delegation:  ${result.delegation.assigneeType} task delivered`);
    console.log(`Key date:    ${result.keyDate.status} with automatic reminder delivered`);
    console.log(`Automation:  ${result.deliveries.delivered} authenticated local deliveries`);
    console.log(`Reset:       ${result.reset.applications} applications · ${result.reset.expenses} expenses · ${result.reset.preflight} ready`);
  }
}
