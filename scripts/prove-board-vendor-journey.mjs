#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
const OFFERING_ID = "marketplace-booth";
const OFFERING_NAME = "Marketplace booth";
const BOOTH_NUMBER = "M-27";
const BASELINE = {
  applications: 5,
  vendorApplications: 3,
  vendorProfiles: 2,
  vendorRequirements: 12,
  vendorDocuments: 0,
  vendorAssignments: 2,
  ready: 1,
  blocked: 1,
  interests: 1,
  openTasks: 10
};
const timeoutMs = 30_000;
const jsonOutput = process.argv.includes("--json");

if (process.argv.includes("--help")) {
  console.log("Usage: npm run board:prove:vendor -- [--json]");
  console.log("Runs a vendor from public application through private evidence, staff review, assignment confirmation, and an exact board reset.");
  process.exit(0);
}

function log(value = "") {
  if (!jsonOutput) console.log(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
  return { apiBase, emailBase, visitor: visitor.toString(), operations: operations.toString() };
}

async function getJson(apiBase, pathname, { admin = false } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: admin ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {},
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}.`);
  return response.json();
}

async function baselineSnapshot(apiBase) {
  const partners = await getJson(apiBase, "/api/admin/partners", { admin: true });
  return {
    applications: partners.summary?.applications?.total,
    vendorApplications: partners.summary?.applications?.vendors,
    vendorProfiles: partners.vendorProfiles?.length,
    vendorRequirements: partners.vendorRequirements?.length,
    vendorDocuments: partners.vendorDocuments?.length,
    vendorAssignments: partners.vendorAssignments?.length,
    ready: partners.vendorReadiness?.totals?.ready,
    blocked: partners.vendorReadiness?.totals?.blocked,
    interests: partners.vendorReadiness?.totals?.interests,
    openTasks: partners.summary?.operations?.openTasks
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
  if (!baselineMatches(snapshot)) throw new Error(`Board reset did not restore the exact vendor baseline: ${JSON.stringify(snapshot)}.`);
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
    && document.querySelector("#vendor-application-form")?.dataset.publicIntakeState === "ready"
  ), null, { timeout: timeoutMs });
}

async function waitForOperations(page) {
  await page.waitForFunction(() => {
    const status = document.querySelector("#admin-api-status");
    return status?.dataset.workspaceState === "ready" && status.getAttribute("aria-busy") === "false";
  }, null, { timeout: timeoutMs });
}

async function reloadOperations(page) {
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/admin/partners"
    && response.request().method() === "GET"
  ), { timeout: timeoutMs });
  await page.locator("#admin-load-partners").click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`Operations partner reload returned ${response.status()}.`);
  await waitForOperations(page);
}

async function reloadPartnerPortal(page) {
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/public/partner-status"
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await page.locator('#partner-status-form button[type="submit"]').click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`Private vendor portal refresh returned ${response.status()}.`);
  await expect(page.locator("#partner-status-form .partner-form-status")).toContainText("Secure status loaded");
}

async function submitVendorApplication(page, apiBase, organizationName) {
  const form = page.locator("#vendor-application-form");
  await form.locator('[data-board-partner-preset="vendor"]').click();
  await expect(form.locator(".partner-form-status")).toHaveText("Synthetic details are ready. Contact consent remains unchecked.");
  await expect(form.locator('[name="vendorOfferingId"]')).toHaveValue(OFFERING_ID);
  await expect(page.locator("#vendor-intake-heading")).toHaveText("Apply for the beach marketplace");
  await expect(page.locator("#vendor-offering-summary")).toContainText("$1,250 application fee");
  await form.locator('[name="organizationName"]').fill(organizationName);
  const contactEmail = await form.locator('[name="contactEmail"]').inputValue();
  const contactPhone = await form.locator('[name="contactPhone"]').inputValue();
  if (!contactEmail.endsWith("@example.com") || !/^\+1361555013[12]$/.test(contactPhone)) {
    throw new Error("Vendor proof did not receive reserved synthetic contact details.");
  }
  await expect(form.locator('[name="consentToContact"]')).not.toBeChecked();
  await form.locator('[name="consentToContact"]').check();

  const responsePromise = page.waitForResponse(response => (
    response.url() === `${apiBase}/api/public/vendor-applications`
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await form.locator('button[type="submit"]').click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (
    response.status() !== 201
    || payload.application?.type !== "vendor"
    || payload.application?.intakeMode !== "application"
    || !payload.application?.id
    || !payload.application?.reference
    || !payload.portalAccess?.token
  ) {
    throw new Error(`Vendor signup returned ${response.status()} without a private application portal.`);
  }
  await expect(page.locator("#partner-status-result")).toContainText(organizationName);
  await expect(page.locator("#partner-status-result")).toContainText(OFFERING_NAME);
  await expect(page.locator('#partner-status-form [name="reference"]')).toHaveValue(payload.application.reference);
  return { ...payload, contactEmail, contactPhone };
}

async function submitVendorProfile(page, apiBase, organizationName, runId, { revised = false } = {}) {
  const profile = page.locator("#partner-vendor-profile-form");
  await expect(profile).toBeVisible();
  await profile.locator('[name="legalName"]').fill(`${organizationName} LLC`);
  await profile.locator('[name="boothName"]').fill(organizationName);
  await profile.locator('[name="website"]').fill(`https://vendor-${runId}.example/`);
  await profile.locator('[name="powerNeed"]').selectOption("20a");
  await profile.locator('[name="cookingMethod"]').selectOption("none");
  await profile.locator('[name="vehicleLengthFeet"]').fill("18");
  await profile.locator('[name="emergencyContactName"]').fill("Board Vendor Contact");
  await profile.locator('[name="emergencyContactPhone"]').fill("361-555-0133");
  await profile.locator('[name="publicDescription"]').fill("Original coastal artwork and locally made gifts for SandFest guests.");
  await profile.locator('[name="accessibilityNotes"]').fill("Keep the customer-facing aisle clear and level.");
  await profile.locator('[name="operationalNotes"]').fill(revised
    ? "The enclosed trailer remains fully inside the assigned footprint."
    : "Private initial trailer placement note for the board vendor proof.");
  await profile.locator('[name="waterRequired"]').uncheck();

  const responsePromise = page.waitForResponse(response => (
    response.url() === `${apiBase}/api/public/partner-vendor-profile`
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await profile.locator('button[type="submit"]').click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (response.status() !== 200 || payload.application?.vendorOnboarding?.profile?.status !== "submitted") {
    throw new Error(`Vendor operating profile returned ${response.status()} without submitted status.`);
  }
  await expect(page.locator('#partner-vendor-profile-form [data-status="submitted"]')).toHaveText("submitted");
  return payload.application.vendorOnboarding;
}

function vendorPdf(label, runId, revision) {
  return Buffer.from(`%PDF-1.4\nTexas SandFest synthetic vendor evidence\n${label}\nRun ${runId}\nRevision ${revision}\n%%EOF\n`);
}

async function submitVendorDocument(page, apiBase, requirement, runId, revision) {
  const row = page.locator(`[data-vendor-requirement="${requirement.id}"]`);
  const buffer = vendorPdf(requirement.label, runId, revision);
  const fileName = `${String(requirement.code || requirement.id).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${revision}.pdf`;
  await row.locator('[name="file"]').setInputFiles({ name: fileName, mimeType: "application/pdf", buffer });
  const responsePromise = page.waitForResponse(response => (
    response.url() === `${apiBase}/api/public/partner-vendor-documents/upload`
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await row.locator('button[type="submit"]').click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  const updated = payload.application?.vendorOnboarding?.requirements?.find(item => item.id === requirement.id);
  if (
    response.status() !== 201
    || updated?.status !== "submitted"
    || updated.document?.sourceType !== "upload"
    || !updated.document?.id
    || "storageKey" in (updated.document || {})
    || "checksumSha256" in (updated.document || {})
  ) {
    throw new Error(`${requirement.label} upload returned ${response.status()} without a privacy-safe submitted document.`);
  }
  await expect(page.locator(`[data-vendor-requirement="${requirement.id}"]`)).toContainText(fileName);
  return {
    requirementId: requirement.id,
    code: requirement.code,
    label: requirement.label,
    documentId: updated.document.id,
    fileName,
    buffer,
    checksumSha256: sha256(buffer)
  };
}

async function verifyPrivateDocument(apiBase, access, document) {
  const response = await fetch(`${apiBase}/api/public/partner-vendor-documents/${encodeURIComponent(document.documentId)}/content`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reference: access.reference, token: access.token }),
    signal: AbortSignal.timeout(10_000)
  });
  const downloaded = Buffer.from(await response.arrayBuffer());
  if (
    !response.ok
    || response.headers.get("content-type") !== "application/pdf"
    || downloaded.length !== document.buffer.length
    || sha256(downloaded) !== document.checksumSha256
  ) {
    throw new Error(`${document.label} did not round-trip byte-for-byte through the private vendor portal: ${JSON.stringify({
      status: response.status,
      contentType: response.headers.get("content-type"),
      expectedBytes: document.buffer.length,
      downloadedBytes: downloaded.length,
      expectedChecksum: document.checksumSha256,
      downloadedChecksum: sha256(downloaded),
      responseBody: response.ok ? null : downloaded.toString("utf8").slice(0, 300)
    })}.`);
  }
  return downloaded.length;
}

async function waitForDeliveredNotice(apiBase, applicationId, kind) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    const partners = await getJson(apiBase, "/api/admin/partners", { admin: true });
    latest = (partners.followups || []).find(item => item.applicationId === applicationId && item.kind === kind) || null;
    if (latest?.status === "sent" && latest.deliveryStatus === "delivered") {
      return { id: latest.id, kind: latest.kind, status: latest.status, deliveryStatus: latest.deliveryStatus };
    }
    await delay(250);
  }
  throw new Error(`${kind} did not reach the local delivered state (last status ${latest?.status || "missing"}).`);
}

async function saveApplicationApproval(page, apiBase, applicationId, organizationName) {
  const card = () => page.locator(`#admin-partner-applications [data-partner-application="${applicationId}"]`);
  await expect(card()).toHaveCount(1);
  await expect(card()).toContainText(organizationName);
  await expect(card()).toContainText(OFFERING_NAME);
  await card().locator('[name="status"]').selectOption("approved");
  const responsePromise = page.waitForResponse(response => (
    response.url() === `${apiBase}/api/admin/partners/applications/${applicationId}`
    && response.request().method() === "PATCH"
  ), { timeout: timeoutMs });
  await card().locator("[data-save-application]").click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`Vendor application approval returned ${response.status()}.`);
  await expect(card().locator('[name="status"]')).toHaveValue("approved");
}

async function reviewVendorProfile(page, apiBase, applicationId, action, reviewNotes = "") {
  const card = () => page.locator(`#admin-vendor-readiness [data-admin-vendor="${applicationId}"]`);
  const section = () => card().locator(`[data-admin-vendor-profile="${applicationId}"]`);
  await expect(section()).toHaveCount(1);
  if (reviewNotes) await section().locator('[name="reviewNotes"]').fill(reviewNotes);
  const responsePromise = page.waitForResponse(response => (
    response.url() === `${apiBase}/api/admin/partners/applications/${applicationId}/vendor-profile/review`
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await section().locator(`[data-review-vendor-profile="${action}"]`).click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  const expectedStatus = action === "approve" ? "approved" : "changes_requested";
  if (!response.ok() || payload.profile?.status !== expectedStatus) {
    throw new Error(`Vendor profile ${action} returned ${response.status()} without ${expectedStatus} status.`);
  }
  await expect(section().locator(`[data-status="${expectedStatus}"]`)).toHaveText(expectedStatus.replace("_", " "));
  return payload;
}

async function reviewVendorRequirement(page, apiBase, applicationId, requirementId, status, reviewNotes = "") {
  const row = () => page.locator(`#admin-vendor-readiness [data-admin-vendor="${applicationId}"] [data-admin-vendor-requirement="${requirementId}"]`);
  await expect(row()).toHaveCount(1);
  await row().locator('[name="status"]').selectOption(status);
  await row().locator('[name="reviewNotes"]').fill(reviewNotes);
  const responsePromise = page.waitForResponse(response => (
    response.url() === `${apiBase}/api/admin/partners/vendor-requirements/${requirementId}`
    && response.request().method() === "PATCH"
  ), { timeout: timeoutMs });
  await row().locator("[data-save-vendor-requirement]").click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok() || payload.requirement?.status !== status) {
    throw new Error(`Vendor requirement ${status} returned ${response.status()} without the requested state.`);
  }
  await expect(row().locator(`[data-status="${status}"]`)).toHaveText(status.replace("_", " "));
  return payload;
}

async function publishAssignment(page, apiBase, applicationId) {
  const section = () => page.locator(`#admin-vendor-readiness [data-admin-vendor="${applicationId}"] [data-admin-vendor-assignment="${applicationId}"]`);
  await expect(section()).toHaveCount(1);
  await section().locator('[name="status"]').selectOption("scheduled");
  await section().locator('[name="boothNumber"]').fill(BOOTH_NUMBER);
  await section().locator('[name="zone"]').fill("Marketplace north");
  await section().locator('[name="accessGate"]').fill("North service gate");
  await section().locator('[name="loadInStart"]').fill("2027-04-15T08:30");
  await section().locator('[name="loadInEnd"]').fill("2027-04-15T09:30");
  await section().locator('[name="loadOutStart"]').fill("2027-04-19T18:00");
  await section().locator('[name="loadOutEnd"]').fill("2027-04-19T19:00");
  await section().locator('[name="parkingPasses"]').fill("1");
  await section().locator('[name="staffWristbands"]').fill("3");
  await section().locator('[name="instructions"]').fill("Check in with the marketplace captain before entering the beach corridor.");
  const responsePromise = page.waitForResponse(response => (
    response.url() === `${apiBase}/api/admin/partners/applications/${applicationId}/vendor-assignment`
    && response.request().method() === "PATCH"
  ), { timeout: timeoutMs });
  await section().locator("[data-save-vendor-assignment]").click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (
    !response.ok()
    || payload.assignment?.status !== "scheduled"
    || payload.assignment?.boothNumber !== BOOTH_NUMBER
    || payload.notificationDrafted !== true
  ) {
    throw new Error(`Vendor assignment publication returned ${response.status()} without a scheduled notice.`);
  }
  await expect(section().locator('[name="status"]')).toHaveValue("scheduled");
  return payload.assignment;
}

async function confirmAssignment(page, apiBase) {
  await reloadPartnerPortal(page);
  await expect(page.locator(`.partner-vendor-assignment[data-status="scheduled"]`)).toContainText(BOOTH_NUMBER);
  const responsePromise = page.waitForResponse(response => (
    response.url() === `${apiBase}/api/public/partner-vendor-assignment/confirm`
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await page.locator("#partner-confirm-vendor-assignment").click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (response.status() !== 200 || payload.application?.vendorOnboarding?.assignment?.status !== "confirmed") {
    throw new Error(`Vendor assignment confirmation returned ${response.status()} without confirmed status.`);
  }
  await expect(page.locator('.partner-vendor-assignment[data-status="confirmed"]')).toContainText(BOOTH_NUMBER);
  return payload.application.vendorOnboarding.assignment;
}

async function proveReadyState(page, apiBase, applicationId, requirementCount) {
  await reloadOperations(page);
  const card = page.locator(`#admin-vendor-readiness [data-admin-vendor="${applicationId}"]`);
  await expect(card).toHaveAttribute("data-status", "ready");
  await expect(card).toContainText(`${requirementCount}/${requirementCount} compliance`);
  await expect(card).toContainText("approved profile");
  await expect(card).toContainText("confirmed load-in");
  await expect(page.locator("#admin-vendor-readiness-summary")).toContainText("2/3 ready");

  const partners = await getJson(apiBase, "/api/admin/partners", { admin: true });
  const state = partners.vendorReadiness?.vendors?.find(item => item.applicationId === applicationId);
  const profile = partners.vendorProfiles?.find(item => item.applicationId === applicationId);
  const documents = (partners.vendorDocuments || []).filter(item => item.applicationId === applicationId && item.status !== "superseded");
  const notices = (partners.followups || []).filter(item => item.applicationId === applicationId && [
    "vendor_profile_changes",
    "vendor_requirement_changes",
    "vendor_assignment_ready"
  ].includes(item.kind));
  if (
    state?.status !== "ready"
    || state.profileStatus !== "approved"
    || profile?.revision !== 2
    || state.compliance?.approved !== requirementCount
    || state.assignmentStatus !== "confirmed"
    || state.boothNumber !== BOOTH_NUMBER
    || documents.length !== requirementCount
    || notices.length !== 3
    || notices.some(item => item.status !== "sent" || item.deliveryStatus !== "delivered")
  ) {
    throw new Error(`Vendor did not reach an exact ready state: ${JSON.stringify({ state, documentCount: documents.length, notices: notices.map(item => ({ kind: item.kind, status: item.status, deliveryStatus: item.deliveryStatus })) })}.`);
  }
  return {
    status: state.status,
    readyVendors: partners.vendorReadiness.totals.ready,
    totalVendors: partners.vendorReadiness.totals.vendors,
    profileStatus: state.profileStatus,
    profileRevision: profile.revision,
    requirementsApproved: state.compliance.approved,
    assignmentStatus: state.assignmentStatus,
    boothNumber: state.boothNumber,
    documentCount: documents.length,
    notices: notices.map(item => ({ kind: item.kind, status: item.status, deliveryStatus: item.deliveryStatus })).sort((a, b) => a.kind.localeCompare(b.kind)),
    assignmentId: partners.vendorAssignments?.find(item => item.applicationId === applicationId)?.id
  };
}

async function proveAudit(apiBase, application, requirements, assignmentId, forbiddenValues) {
  const payload = await getJson(apiBase, "/api/admin/audit?limit=200", { admin: true });
  const requirementIds = new Set(requirements.map(item => item.id));
  const records = (payload.audit || []).map(item => item.record).filter(record => (
    (record?.target?.type === "application" && record.target.id === application.id)
    || (record?.target?.type === "vendor_requirement" && requirementIds.has(record.target.id))
    || (record?.target?.type === "vendor_assignment" && record.target.id === assignmentId)
  ));
  const actions = new Set(records.map(record => record.action));
  for (const action of [
    "partner.application.update",
    "partner.vendor_profile.changes_requested",
    "partner.vendor_profile.approved",
    "partner.vendor_requirement.changes_requested",
    "partner.vendor_requirement.approved",
    "partner.vendor_assignment.update"
  ]) {
    if (!actions.has(action)) throw new Error(`Vendor journey audit is missing ${action}.`);
  }
  const serialized = JSON.stringify(records);
  for (const forbidden of ["storageKey", "contactEmail", "contactPhone", ...forbiddenValues]) {
    if (forbidden && serialized.includes(forbidden)) throw new Error(`Vendor journey audit exposed private value ${forbidden}.`);
  }
  return { records: records.length, actions: [...actions].sort() };
}

const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });
const runId = randomUUID().slice(0, 8);
const result = {
  ok: false,
  runId,
  application: null,
  profile: null,
  compliance: null,
  assignment: null,
  notices: null,
  readiness: null,
  audit: null,
  reset: null
};
let browser = null;
let resetRequired = false;
let workflowError = null;

try {
  log("\n=== Active board vendor journey proof ===\n");
  let report = await stablePreflight(sessionFile);
  let session = await readBoardDemoSession(sessionFile);
  let endpoints = activeSession(session, report);
  const initial = await baselineSnapshot(endpoints.apiBase);
  if (!baselineMatches(initial)) {
    log("Restoring the prepared vendor baseline before rehearsal...");
    result.reset = await resetBaseline(sessionFile, session);
    session = await readBoardDemoSession(sessionFile);
    report = await stablePreflight(sessionFile);
    endpoints = activeSession(session, report);
  }

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const vendorPage = await context.newPage();
  await vendorPage.goto(endpoints.visitor, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForVisitor(vendorPage);
  await expect(vendorPage.locator("#runtime-data-notice")).toContainText("No external messages, charges, or live-provider calls");

  const organizationName = `Board Vendor Journey ${runId}`;
  resetRequired = true;
  const intake = await submitVendorApplication(vendorPage, endpoints.apiBase, organizationName);
  result.application = {
    id: intake.application.id,
    reference: intake.application.reference,
    type: intake.application.type,
    intakeMode: intake.application.intakeMode,
    offeringId: OFFERING_ID
  };
  const portalAccess = { reference: intake.application.reference, token: intake.portalAccess.token };

  let onboarding = await submitVendorProfile(vendorPage, endpoints.apiBase, organizationName, runId);
  const requirements = onboarding.requirements || [];
  if (requirements.length !== 5 || requirements.some(item => item.status !== "missing")) {
    throw new Error(`Marketplace vendor received an unexpected compliance packet: ${JSON.stringify(requirements.map(item => ({ code: item.code, status: item.status })))}.`);
  }

  const documents = [];
  let verifiedBytes = 0;
  for (const requirement of requirements) {
    const document = await submitVendorDocument(vendorPage, endpoints.apiBase, requirement, runId, "initial");
    documents.push(document);
    verifiedBytes += await verifyPrivateDocument(endpoints.apiBase, portalAccess, document);
  }
  for (const document of documents) {
    await verifyPrivateDocument(endpoints.apiBase, portalAccess, document);
  }

  const operationsPage = await context.newPage();
  const operationsUrl = new URL(endpoints.operations);
  operationsUrl.hash = "admin-partner-applications-workspace";
  await operationsPage.goto(operationsUrl.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForOperations(operationsPage);
  await expect(operationsPage.locator("#network-status")).toHaveText("Demo");
  await expect(operationsPage.locator("#runtime-data-notice")).toContainText("No external messages, charges, or live-provider calls");
  await reloadOperations(operationsPage);
  await saveApplicationApproval(operationsPage, endpoints.apiBase, intake.application.id, organizationName);

  const profileCorrection = "Confirm the enclosed trailer remains inside the assigned footprint.";
  const profileReview = await reviewVendorProfile(operationsPage, endpoints.apiBase, intake.application.id, "request_changes", profileCorrection);
  if (profileReview.notificationDrafted !== true) throw new Error("Vendor profile correction did not create an automated notice.");
  const profileNotice = await waitForDeliveredNotice(endpoints.apiBase, intake.application.id, "vendor_profile_changes");
  await reloadPartnerPortal(vendorPage);
  await expect(vendorPage.locator("#partner-vendor-profile-form")).toContainText(profileCorrection);
  onboarding = await submitVendorProfile(vendorPage, endpoints.apiBase, organizationName, runId, { revised: true });
  await reloadOperations(operationsPage);
  await reviewVendorProfile(operationsPage, endpoints.apiBase, intake.application.id, "approve");

  const correctedRequirement = requirements[0];
  const complianceCorrection = "Add the authorized signer title to this synthetic agreement.";
  const requirementReview = await reviewVendorRequirement(
    operationsPage,
    endpoints.apiBase,
    intake.application.id,
    correctedRequirement.id,
    "changes_requested",
    complianceCorrection
  );
  if (requirementReview.notificationDrafted !== true) throw new Error("Vendor compliance correction did not create an automated notice.");
  const requirementNotice = await waitForDeliveredNotice(endpoints.apiBase, intake.application.id, "vendor_requirement_changes");
  await reloadPartnerPortal(vendorPage);
  await expect(vendorPage.locator(`[data-vendor-requirement="${correctedRequirement.id}"]`)).toContainText(complianceCorrection);
  const originalCorrectedDocumentId = documents.find(item => item.requirementId === correctedRequirement.id)?.documentId;
  const replacement = await submitVendorDocument(vendorPage, endpoints.apiBase, correctedRequirement, runId, "corrected");
  verifiedBytes += await verifyPrivateDocument(endpoints.apiBase, portalAccess, replacement);
  const correctedIndex = documents.findIndex(item => item.requirementId === correctedRequirement.id);
  documents[correctedIndex] = replacement;

  await reloadOperations(operationsPage);
  for (const requirement of requirements) {
    await reviewVendorRequirement(operationsPage, endpoints.apiBase, intake.application.id, requirement.id, "approved");
  }

  const scheduledAssignment = await publishAssignment(operationsPage, endpoints.apiBase, intake.application.id);
  const assignmentNotice = await waitForDeliveredNotice(endpoints.apiBase, intake.application.id, "vendor_assignment_ready");
  const confirmedAssignment = await confirmAssignment(vendorPage, endpoints.apiBase);
  result.assignment = {
    id: scheduledAssignment.id,
    status: confirmedAssignment.status,
    boothNumber: confirmedAssignment.boothNumber,
    partnerConfirmed: Boolean(confirmedAssignment.partnerConfirmedAt)
  };

  const ready = await proveReadyState(operationsPage, endpoints.apiBase, intake.application.id, requirements.length);
  result.profile = { status: ready.profileStatus, revision: ready.profileRevision };
  result.compliance = {
    required: requirements.length,
    approved: ready.requirementsApproved,
    documents: ready.documentCount,
    verifiedBytes,
    replacementDocument: replacement.documentId !== originalCorrectedDocumentId
  };
  result.notices = {
    delivered: ready.notices.length,
    kinds: [profileNotice.kind, requirementNotice.kind, assignmentNotice.kind].sort()
  };
  result.readiness = {
    status: ready.status,
    readyVendors: ready.readyVendors,
    totalVendors: ready.totalVendors,
    assignmentStatus: ready.assignmentStatus
  };
  result.audit = await proveAudit(
    endpoints.apiBase,
    intake.application,
    requirements,
    ready.assignmentId,
    [
      intake.contactEmail,
      intake.contactPhone,
      "361-555-0133",
      "Private initial trailer placement note",
      profileCorrection,
      complianceCorrection,
      "Check in with the marketplace captain"
    ]
  );

  const mailbox = await getJson(endpoints.emailBase, "/health");
  if (mailbox.acceptedMessages < 3 || mailbox.deliveryCallbacks < 3 || mailbox.callbackFailures !== 0) {
    throw new Error(`Local mailbox did not confirm the three vendor notices: ${JSON.stringify(mailbox)}.`);
  }
  log(`Verified ${intake.application.reference} from public application through ${BOOTH_NUMBER} ready status.`);
} catch (error) {
  workflowError = error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (resetRequired) {
    try {
      const session = await readBoardDemoSession(sessionFile);
      result.reset = await resetBaseline(sessionFile, session);
      log(`Restored the exact vendor baseline at ${result.reset.preflight} readiness.`);
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
  else console.error(`\nBoard vendor journey proof failed: ${workflowError.message}`);
  process.exitCode = 1;
} else {
  result.ok = true;
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("\nBoard vendor journey proof passed.");
    console.log(`Application: ${result.application.reference} · ${OFFERING_NAME}`);
    console.log(`Profile:     revision ${result.profile.revision} · approved`);
    console.log(`Compliance:  ${result.compliance.approved}/${result.compliance.required} approved · ${result.compliance.verifiedBytes} verified private bytes`);
    console.log(`Assignment:  ${result.assignment.boothNumber} · confirmed`);
    console.log(`Automation:  ${result.notices.delivered} local notices delivered`);
    console.log(`Audit:       ${result.audit.records} privacy-safe lifecycle records`);
    console.log(`Reset:       ${result.reset.applications} applications · ${result.reset.ready}/${result.reset.vendorApplications - result.reset.interests} vendors ready · ${result.reset.preflight}`);
  }
}
