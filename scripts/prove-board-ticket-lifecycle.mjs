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
const PRODUCT_ID = "general-admission-3-day";
const PRODUCT_NAME = "General Admission 3-Day Wristband";
const QUANTITY = 2;
const UNIT_AMOUNT_CENTS = 3_000;
const BASELINE = {
  orders: 0,
  paymentEvents: 0,
  fulfillment: 0,
  ticketEntries: 0,
  revenueEntries: 4,
  grossCents: 1_750_000,
  refundCents: 0,
  netCents: 1_722_575,
  ticketsSold: 100
};
const timeoutMs = 30_000;
const jsonOutput = process.argv.includes("--json");

if (process.argv.includes("--help")) {
  console.log("Usage: npm run board:prove:tickets -- [--json]");
  console.log("Completes and refunds a local ticket order, verifies Operations accounting, then restores the board baseline.");
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

async function getJson(apiBase, pathname) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}.`);
  return response.json();
}

async function lifecycleSnapshot(apiBase) {
  const [orders, paymentEvents, fulfillment, revenue] = await Promise.all([
    getJson(apiBase, "/api/admin/orders?limit=100"),
    getJson(apiBase, "/api/admin/payment-events?limit=100"),
    getJson(apiBase, "/api/admin/fulfillment?limit=100"),
    getJson(apiBase, "/api/admin/revenue")
  ]);
  const orderRecords = (orders.pendingOrders || []).map(item => item.record);
  const eventRecords = (paymentEvents.paymentEvents || []).map(item => item.record);
  const fulfillmentRecords = (fulfillment.fulfillment || []).map(item => item.record);
  return {
    orders: orderRecords.length,
    paymentEvents: eventRecords.length,
    fulfillment: fulfillmentRecords.length,
    ticketEntries: revenue.sources?.ticketOrders?.entries,
    revenueEntries: revenue.entries?.length,
    grossCents: revenue.summary?.totals?.grossCents,
    refundCents: revenue.summary?.totals?.refundCents,
    netCents: revenue.summary?.totals?.netCents,
    ticketsSold: revenue.summary?.tickets?.sold,
    orderRecords,
    eventRecords,
    fulfillmentRecords
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
  const snapshot = await lifecycleSnapshot(restored.apiBase);
  if (!baselineMatches(snapshot)) {
    throw new Error(`Board reset did not restore the exact ticket baseline: ${JSON.stringify(snapshot)}.`);
  }
  return {
    fromGeneration: health.boardDemoGeneration,
    toGeneration: restored.generation,
    orders: snapshot.orders,
    paymentEvents: snapshot.paymentEvents,
    fulfillment: snapshot.fulfillment,
    ticketEntries: snapshot.ticketEntries,
    revenueEntries: snapshot.revenueEntries,
    grossCents: snapshot.grossCents,
    refundCents: snapshot.refundCents,
    netCents: snapshot.netCents,
    ticketsSold: snapshot.ticketsSold,
    preflight: `${report.passed}/${report.total}`
  };
}

async function waitForOperations(page) {
  await page.waitForFunction(() => {
    const status = document.querySelector("#admin-api-status");
    return status?.dataset.workspaceState === "ready" && status.getAttribute("aria-busy") === "false";
  }, null, { timeout: timeoutMs });
}

async function purchaseTickets(page, visitorUrl, buyerEmail) {
  const visitor = new URL(visitorUrl);
  visitor.hash = "tickets";
  await page.goto(visitor.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await expect(page.locator("#network-status")).toHaveText("Demo");
  await expect(page.locator("#ticketing-status-pill")).toHaveText("Local payment sandbox");
  await expect(page.locator("#ticket-policy-fieldset")).toBeVisible();
  await expect(page.locator("#ticket-policy-notices [data-ticket-policy-notice]")).toHaveCount(4);

  const add = page.locator(`[data-ticket-action="increase"][data-ticket-id="${PRODUCT_ID}"]`);
  await expect(add).toBeVisible();
  await add.click();
  await add.click();
  await expect(page.locator(`[data-ticket-qty="${PRODUCT_ID}"]`)).toHaveText(String(QUANTITY));
  await expect(page.locator("#ticket-subtotal")).toHaveText("$60.00");
  await page.locator("#checkout-email").fill(buyerEmail);
  await expect(page.locator("#consent-email-marketing")).not.toBeChecked();
  await expect(page.locator("#consent-sms-marketing")).not.toBeChecked();
  await expect(page.locator("#consent-sms-safety")).not.toBeChecked();
  await expect(page.locator("#checkout-btn")).toBeDisabled();
  await page.locator("#ticket-policy-acceptance").check();
  await expect(page.locator("#checkout-btn")).toBeEnabled();

  const checkoutResponsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/stripe/create-checkout-session"
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await page.locator("#checkout-btn").click();
  const checkoutResponse = await checkoutResponsePromise;
  const checkoutPayload = await checkoutResponse.json().catch(() => ({}));
  if (
    checkoutResponse.status() !== 200
    || checkoutPayload.duplicate !== false
    || checkoutPayload.demoCheckout?.mode !== "board_sandbox"
    || checkoutPayload.demoCheckout?.amountCents !== QUANTITY * UNIT_AMOUNT_CENTS
    || checkoutPayload.demoCheckout?.lineItems?.[0]?.productId !== PRODUCT_ID
    || "checkoutUrl" in checkoutPayload
  ) {
    throw new Error(`Local ticket checkout returned ${checkoutResponse.status()} without the expected provider-safe sandbox order.`);
  }
  await expect(page.locator("#ticket-demo-checkout")).toBeVisible();
  await expect(page.locator("#ticket-demo-amount")).toHaveText("$60.00 demo");
  await expect(page.locator("#ticket-demo-status")).toContainText("local board runtime");

  const completionPromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/public/board-ticket-checkout/complete"
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await page.locator("#ticket-demo-pay").click();
  const completionResponse = await completionPromise;
  const completion = await completionResponse.json().catch(() => ({}));
  if (
    completionResponse.status() !== 200
    || completion.order?.status !== "paid"
    || completion.receipt?.environment !== "board_sandbox"
    || completion.receipt?.amountCents !== QUANTITY * UNIT_AMOUNT_CENTS
    || completion.receipt?.fulfillmentCount !== QUANTITY
  ) {
    throw new Error(`Local ticket payment returned ${completionResponse.status()} without a paid and fulfilled receipt.`);
  }
  await expect(page.locator("#ticket-demo-status")).toContainText("Demo payment complete");
  await expect(page.locator("#checkout-status")).toContainText("No external charge was sent");
  await expect(page.locator("#ticket-cart-lines")).toContainText("No tickets selected yet");
  return {
    orderId: completion.receipt.orderId,
    status: completion.order.status,
    productId: PRODUCT_ID,
    quantity: QUANTITY,
    amountCents: completion.receipt.amountCents,
    fulfillmentCount: completion.receipt.fulfillmentCount,
    policyVersion: completion.order.policyAcceptance?.version
  };
}

function revenueKpi(page, label) {
  return page.locator("#admin-revenue-kpis article").filter({ has: page.locator("span", { hasText: label }) });
}

async function loadOperationsEvidence(page) {
  const systems = Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/orders"),
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/payment-events"),
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/fulfillment")
  ]);
  await page.locator("#admin-load-orders").click();
  await systems;
  const revenue = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/revenue");
  await page.locator("#admin-load-revenue").click();
  await revenue;
}

async function provePaidOperations(page, apiBase, operationsUrl, purchase, buyerEmail) {
  const operations = new URL(operationsUrl);
  operations.hash = "admin-system-monitor";
  await page.goto(operations.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForOperations(page);
  await expect(page.locator("#network-status")).toHaveText("Demo");
  await expect(page.locator("#runtime-data-notice")).toContainText("No external messages, charges, or live-provider calls");
  await loadOperationsEvidence(page);

  const orderCard = page.locator(`[data-ticket-order="${purchase.orderId}"]`);
  await expect(orderCard).toHaveCount(1);
  await expect(orderCard).toContainText("paid");
  await expect(orderCard).toContainText(`${QUANTITY} x ${PRODUCT_NAME}`);
  await expect(orderCard).toContainText("$60.00");
  await expect(orderCard).toContainText(buyerEmail);
  await expect(orderCard.locator("[data-refund-board-ticket]")).toHaveCount(1);
  await expect(page.locator("#admin-payment-event-list")).toContainText("checkout.session.completed");
  await expect(page.locator("#admin-fulfillment-list [data-fulfillment-id]").filter({ hasText: PRODUCT_NAME })).toHaveCount(QUANTITY);
  await expect(page.locator("#admin-revenue-updated")).toContainText("1 ticket ledger");
  await expect(revenueKpi(page, "Gross")).toContainText("$17,560.00");
  await expect(revenueKpi(page, "Refunds / voids")).toContainText("$0.00");
  await expect(revenueKpi(page, "Net")).toContainText("$17,285.75");
  await expect(revenueKpi(page, "Tickets sold")).toContainText("102");

  const snapshot = await lifecycleSnapshot(apiBase);
  const order = snapshot.orderRecords.find(item => item.id === purchase.orderId);
  const ticketEvents = snapshot.eventRecords.filter(item => item.ticketReconciliation?.orderId === purchase.orderId);
  const ticketFulfillment = snapshot.fulfillmentRecords.filter(item => item.orderId === purchase.orderId);
  if (
    snapshot.orders !== 1
    || snapshot.paymentEvents !== 1
    || snapshot.fulfillment !== QUANTITY
    || snapshot.ticketEntries !== 1
    || snapshot.revenueEntries !== BASELINE.revenueEntries + 1
    || snapshot.grossCents !== BASELINE.grossCents + purchase.amountCents
    || snapshot.refundCents !== 0
    || snapshot.netCents !== BASELINE.netCents + purchase.amountCents
    || snapshot.ticketsSold !== BASELINE.ticketsSold + QUANTITY
    || order?.status !== "paid"
    || order?.consent?.consentId !== null
    || ticketEvents.length !== 1
    || ticketFulfillment.length !== QUANTITY
    || ticketFulfillment.some(item => item.status !== "queued")
  ) {
    throw new Error(`Paid ticket order did not reconcile through Operations: ${JSON.stringify(snapshot)}.`);
  }
  return { orderCard, order, ticketEvents, ticketFulfillment };
}

async function refundTickets(page, apiBase, purchase) {
  const refundPath = `/api/admin/board-demo/ticket-orders/${purchase.orderId}/refund`;
  const [refundResponse] = await Promise.all([
    page.waitForResponse(response => (
      new URL(response.url()).pathname === refundPath
      && response.request().method() === "POST"
    ), { timeout: timeoutMs }),
    page.waitForEvent("dialog", { timeout: timeoutMs }).then(dialog => dialog.accept()),
    page.locator(`[data-ticket-order="${purchase.orderId}"] [data-refund-board-ticket]`).click()
  ]);
  const refundPayload = await refundResponse.json().catch(() => ({}));
  if (refundResponse.status() !== 200 || refundPayload.order?.status !== "refunded") {
    throw new Error(`Local ticket refund returned ${refundResponse.status()} without a refunded order.`);
  }

  const orderCard = page.locator(`[data-ticket-order="${purchase.orderId}"]`);
  await expect(orderCard).toContainText("refunded");
  await expect(orderCard.locator("[data-refund-board-ticket]")).toHaveCount(0);
  await expect(page.locator("#admin-fulfillment-list [data-fulfillment-id]").filter({ hasText: PRODUCT_NAME }).filter({ hasText: "refunded" })).toHaveCount(QUANTITY);
  await expect(page.locator("#admin-payment-event-list")).toContainText("charge.refunded");
  await expect(page.locator("#admin-audit-list [data-audit-action=" + JSON.stringify("ticket.refund.board_sandbox") + "]")).toHaveCount(1);
  await expect(page.locator("#admin-revenue-updated")).toContainText("2 ticket ledger");
  await expect(revenueKpi(page, "Gross")).toContainText("$17,560.00");
  await expect(revenueKpi(page, "Refunds / voids")).toContainText("$60.00");
  await expect(revenueKpi(page, "Net")).toContainText("$17,225.75");
  await expect(revenueKpi(page, "Tickets sold")).toContainText("100");

  const snapshot = await lifecycleSnapshot(apiBase);
  const order = snapshot.orderRecords.find(item => item.id === purchase.orderId);
  const ticketEvents = snapshot.eventRecords.filter(item => item.ticketReconciliation?.orderId === purchase.orderId);
  const ticketFulfillment = snapshot.fulfillmentRecords.filter(item => item.orderId === purchase.orderId);
  if (
    snapshot.orders !== 1
    || snapshot.paymentEvents !== 2
    || snapshot.fulfillment !== QUANTITY
    || snapshot.ticketEntries !== 2
    || snapshot.revenueEntries !== BASELINE.revenueEntries + 2
    || snapshot.grossCents !== BASELINE.grossCents + purchase.amountCents
    || snapshot.refundCents !== purchase.amountCents
    || snapshot.netCents !== BASELINE.netCents
    || snapshot.ticketsSold !== BASELINE.ticketsSold
    || order?.status !== "refunded"
    || order?.refundedAmountCents !== purchase.amountCents
    || ticketEvents.length !== 2
    || ticketFulfillment.length !== QUANTITY
    || ticketFulfillment.some(item => item.status !== "refunded")
  ) {
    throw new Error(`Refunded ticket order did not reverse through Operations: ${JSON.stringify(snapshot)}.`);
  }
  return {
    status: order.status,
    refundedAmountCents: order.refundedAmountCents,
    paymentEvents: ticketEvents.length,
    fulfillmentRefunded: ticketFulfillment.length
  };
}

async function proveAudit(apiBase, orderId, buyerEmail) {
  const payload = await getJson(apiBase, "/api/admin/audit?limit=200");
  const records = (payload.audit || []).map(item => item.record).filter(record => (
    record?.action === "ticket.refund.board_sandbox"
    && record?.target?.type === "ticketOrder"
    && record.target.id === orderId
  ));
  const serialized = JSON.stringify(records);
  const forbidden = [
    buyerEmail,
    "customer",
    "consentId",
    "idempotencyKeyHash",
    "idempotencyFingerprint",
    "stripeCheckoutSessionId",
    "paymentIntentId",
    "fulfillmentRecordIds",
    "providerEventId"
  ];
  if (
    records.length !== 1
    || records[0].before?.status !== "paid"
    || records[0].after?.status !== "refunded"
    || records[0].before?.consent?.contactStored !== true
    || records[0].after?.refundedAmountCents !== QUANTITY * UNIT_AMOUNT_CENTS
    || records[0].metadata?.providerEventPresent !== true
    || !forbidden.every(value => !serialized.includes(value))
  ) {
    throw new Error("Ticket refund audit did not preserve lifecycle evidence without private checkout metadata.");
  }
  return { records: records.length, action: records[0].action, privacyFieldsRejected: forbidden.length };
}

const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });
const runId = randomUUID().slice(0, 8);
const buyerEmail = `ticket-buyer-${runId}@example.com`;
const result = {
  ok: false,
  runId,
  purchase: null,
  refund: null,
  revenue: null,
  audit: null,
  reset: null
};
let browser = null;
let resetRequired = false;
let workflowError = null;

try {
  log("\n=== Active board ticket lifecycle proof ===\n");
  let report = await stablePreflight(sessionFile);
  let session = await readBoardDemoSession(sessionFile);
  let endpoints = activeSession(session, report);
  const initial = await lifecycleSnapshot(endpoints.apiBase);
  if (!baselineMatches(initial)) {
    log("Restoring the prepared ticket baseline before rehearsal...");
    result.reset = await resetBaseline(sessionFile, session);
    session = await readBoardDemoSession(sessionFile);
    report = await stablePreflight(sessionFile);
    endpoints = activeSession(session, report);
  }

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const visitorPage = await context.newPage();
  resetRequired = true;
  result.purchase = await purchaseTickets(visitorPage, endpoints.visitor, buyerEmail);
  await visitorPage.close();

  const operationsPage = await context.newPage();
  await provePaidOperations(operationsPage, endpoints.apiBase, endpoints.operations, result.purchase, buyerEmail);
  result.refund = await refundTickets(operationsPage, endpoints.apiBase, result.purchase);
  const refunded = await lifecycleSnapshot(endpoints.apiBase);
  result.revenue = {
    ticketEntries: refunded.ticketEntries,
    revenueEntries: refunded.revenueEntries,
    grossCents: refunded.grossCents,
    refundCents: refunded.refundCents,
    netCents: refunded.netCents,
    ticketsSold: refunded.ticketsSold
  };
  result.audit = await proveAudit(endpoints.apiBase, result.purchase.orderId, buyerEmail);
  log(`Verified ${result.purchase.orderId} from policy acceptance through payment, fulfillment, refund, and revenue reversal.`);
} catch (error) {
  workflowError = error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (resetRequired) {
    try {
      const session = await readBoardDemoSession(sessionFile);
      result.reset = await resetBaseline(sessionFile, session);
      log(`Restored the exact ticket baseline at ${result.reset.preflight} readiness.`);
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
  else console.error(`\nBoard ticket lifecycle proof failed: ${workflowError.message}`);
  process.exitCode = 1;
} else {
  result.ok = true;
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("\nBoard ticket lifecycle proof passed.");
    console.log(`Purchase:    ${result.purchase.quantity} x ${PRODUCT_NAME} | $${(result.purchase.amountCents / 100).toFixed(2)} paid`);
    console.log(`Fulfillment: ${result.purchase.fulfillmentCount} wristbands queued, then ${result.refund.fulfillmentRefunded} refunded`);
    console.log(`Revenue:     ${result.revenue.ticketEntries} ticket entries | $${(result.revenue.refundCents / 100).toFixed(2)} reversed`);
    console.log(`Audit:       ${result.audit.records} privacy-safe refund record`);
    console.log(`Reset:       ${result.reset.orders} orders | ${result.reset.fulfillment} fulfillments | ${result.reset.preflight} ready`);
  }
}
