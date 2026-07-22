#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
const TARGET_PROSPECT = {
  id: "demo_prospect_0102",
  organizationName: "Coastal Bend Community Bank",
  contactEmail: "avery.martinez@example.com",
  city: "Corpus Christi",
  postalCode: "78418"
};
const PACKAGE_ID = "tarpon";
const PACKAGE_NAME = "Tarpon";
const BASELINE = {
  applications: 5,
  sponsorApplications: 2,
  brandProfiles: 2,
  brandAssets: 2,
  deliverables: 12,
  openTasks: 10,
  prospects: 2,
  wonProspects: 0,
  featuredSponsors: 1
};
const LOGO_FILE = path.join(ROOT, "docs", "board-demo-assets", "gulf-shore-credit-union-logo.png");
const timeoutMs = 30_000;
const jsonOutput = process.argv.includes("--json");

if (process.argv.includes("--help")) {
  console.log("Usage: npm run board:prove:sponsor -- [--json]");
  console.log("Converts a targeted prospect, reviews sponsor branding, proves its public logo, then restores the board baseline.");
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

async function getJson(apiBase, pathname, { admin = false } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: admin ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {},
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}.`);
  return response.json();
}

async function baselineSnapshot(apiBase) {
  const [partners, outreach, showcase] = await Promise.all([
    getJson(apiBase, "/api/admin/partners", { admin: true }),
    getJson(apiBase, "/api/admin/outreach", { admin: true }),
    getJson(apiBase, "/api/public/sponsors")
  ]);
  return {
    applications: partners.summary?.applications?.total,
    sponsorApplications: partners.summary?.applications?.sponsors,
    brandProfiles: partners.brandProfiles?.length,
    brandAssets: partners.brandAssets?.length,
    deliverables: partners.deliverables?.length,
    openTasks: partners.summary?.operations?.openTasks,
    prospects: outreach.summary?.prospects,
    wonProspects: outreach.summary?.won,
    featuredSponsors: showcase.sponsors?.length
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

  const restored = await waitForReset(sessionFile, {
    generation: health.boardDemoGeneration,
    resetCount
  });
  const report = await stablePreflight(sessionFile);
  const snapshot = await baselineSnapshot(restored.apiBase);
  if (!baselineMatches(snapshot)) {
    throw new Error(`Board reset did not restore the exact sponsor baseline: ${JSON.stringify(snapshot)}.`);
  }
  return {
    fromGeneration: health.boardDemoGeneration,
    toGeneration: restored.generation,
    ...snapshot,
    preflight: `${report.passed}/${report.total}`
  };
}

async function waitForOperations(page) {
  await page.waitForFunction(() => {
    const status = document.querySelector("#admin-api-status");
    return status?.dataset.workspaceState === "ready" && status.getAttribute("aria-busy") === "false";
  }, null, { timeout: timeoutMs });
}

async function submitInvitedSponsor(page, apiBase) {
  const form = page.locator("#sponsor-inquiry-form");
  await expect(page.locator("#sponsor-invitation")).toBeVisible();
  await expect(page.locator("#sponsor-invitation-copy")).toContainText(TARGET_PROSPECT.organizationName);
  await expect(form.locator('[name="organizationName"]')).toHaveValue(TARGET_PROSPECT.organizationName);
  await expect(form.locator('[name="organizationName"]')).toHaveAttribute("readonly", "");
  await expect(form.locator('[name="contactEmail"]')).toHaveValue(TARGET_PROSPECT.contactEmail);
  await expect(form.locator('[name="contactEmail"]')).toHaveAttribute("readonly", "");
  await expect(form.locator('[name="packageId"]')).toHaveValue(PACKAGE_ID);
  await expect(form.locator('[name="packageId"]')).toBeDisabled();
  await expect(page.locator("#sponsor-package-summary")).toContainText("$5,000 sponsorship");
  await form.locator('[name="description"]').fill("A community banking partnership supporting SandFest guests, artists, and island businesses.");
  await form.locator('[name="consentToContact"]').check();

  const responsePromise = page.waitForResponse(response => (
    response.url() === `${apiBase}/api/public/sponsor-inquiries`
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await form.locator('button[type="submit"]').click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (
    response.status() !== 201
    || payload.outreachConversion !== true
    || payload.application?.type !== "sponsor"
    || !payload.application?.reference
  ) {
    throw new Error(`Invited sponsor conversion returned ${response.status()} without a linked application.`);
  }
  await expect(page.locator("#partner-status-result")).toContainText(TARGET_PROSPECT.organizationName);
  await expect(page.locator('#partner-status-form [name="reference"]')).toHaveValue(payload.application.reference);
  return payload;
}

async function submitBranding(page, apiBase, runId) {
  const tagline = `Invested in the coast · ${runId}`;
  const website = `https://example.com/coastal-bend-${runId}`;
  const profile = page.locator("#partner-brand-profile-form");
  await expect(profile).toBeVisible();
  await profile.locator('[name="tagline"]').fill(tagline);
  await profile.locator('[name="website"]').fill(website);
  await profile.locator('[name="primaryColor"]').fill("#006B73");
  await profile.locator('[data-brand-color-picker="secondaryColor"]').fill("#F2C94C");
  await expect(page.locator("#partner-brand-preview")).toHaveCSS("background-color", "rgb(0, 107, 115)");
  await expect(page.locator("#partner-brand-preview [data-brand-preview-tagline]")).toHaveText(tagline);
  const profileResponsePromise = page.waitForResponse(response => (
    response.url() === `${apiBase}/api/public/partner-brand-profile`
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await profile.locator('button[type="submit"]').click();
  const profileResponse = await profileResponsePromise;
  if (profileResponse.status() !== 200) throw new Error(`Sponsor brand profile returned ${profileResponse.status()}.`);
  await expect(profile.locator('[data-status="submitted"]')).toHaveText("submitted");

  const sourceLogo = await readFile(LOGO_FILE);
  const asset = page.locator("#partner-brand-asset-form");
  const label = `Coastal Bend board proof logo ${runId}`;
  await asset.locator('[name="kind"]').selectOption("primary_logo");
  await asset.locator('[name="label"]').fill(label);
  await asset.locator('[name="file"]').setInputFiles({
    name: `coastal-bend-${runId}.png`,
    mimeType: "image/png",
    buffer: sourceLogo
  });
  const assetResponsePromise = page.waitForResponse(response => (
    response.url() === `${apiBase}/api/public/partner-brand-assets/upload`
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await asset.locator('button[type="submit"]').click();
  const assetResponse = await assetResponsePromise;
  const payload = await assetResponse.json().catch(() => ({}));
  if (
    assetResponse.status() !== 201
    || payload.asset?.sourceType !== "upload"
    || payload.asset?.status !== "submitted"
    || !payload.asset?.id
    || "storageKey" in payload.asset
  ) {
    throw new Error(`Sponsor logo upload returned ${assetResponse.status()} without a privacy-safe submitted asset.`);
  }
  await expect(page.locator(`[data-partner-brand-asset="${payload.asset.id}"]`)).toContainText(label);
  return {
    assetId: payload.asset.id,
    label,
    tagline,
    website,
    sourceLogo,
    sourceChecksumSha256: sha256(sourceLogo)
  };
}

async function reviewSponsor(page, apiBase, application, branding) {
  const reload = Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET"),
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach" && response.request().method() === "GET")
  ]);
  await page.locator("#admin-load-partners").click();
  await reload;

  const prospectCard = () => page.locator(`[data-outreach-prospect="${TARGET_PROSPECT.id}"]`);
  await expect(prospectCard()).toContainText(`Linked to ${application.reference}`);
  await expect(prospectCard().locator("[data-sponsor-invitation-action]")).toHaveCount(0);

  const applicationCard = () => page.locator("#admin-partner-applications [data-partner-application]")
    .filter({ hasText: TARGET_PROSPECT.organizationName });
  await expect(applicationCard()).toHaveCount(1);
  await expect(applicationCard()).toContainText(PACKAGE_NAME);
  await applicationCard().locator('[name="status"]').selectOption("approved");
  const approvalResponsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/partners/applications/${application.id}`
    && response.request().method() === "PATCH"
  ), { timeout: timeoutMs });
  await applicationCard().locator("[data-save-application]").click();
  const approvalResponse = await approvalResponsePromise;
  if (approvalResponse.status() !== 200) throw new Error(`Sponsor application approval returned ${approvalResponse.status()}.`);
  await expect(applicationCard().locator('[name="status"]')).toHaveValue("approved");

  const fulfillment = () => page.locator(`#admin-sponsor-fulfillment [data-sponsor-fulfillment="${application.id}"]`);
  await expect(fulfillment()).toHaveCount(1);
  await expect(fulfillment().locator('[data-brand-profile] [data-status="submitted"]')).toHaveText("submitted");
  await expect(fulfillment().locator(`[data-admin-brand-asset="${branding.assetId}"] [data-status="submitted"]`)).toHaveText("submitted");

  const profileApprovalPromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/partners/applications/${application.id}/brand-profile/review`
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await fulfillment().locator('[data-review-brand-profile="approve"]').click();
  const profileApproval = await profileApprovalPromise;
  if (profileApproval.status() !== 200) throw new Error(`Sponsor brand profile approval returned ${profileApproval.status()}.`);
  await expect(fulfillment().locator('[data-brand-profile] [data-status="approved"]')).toHaveText("approved");

  const assetRow = () => fulfillment().locator(`[data-admin-brand-asset="${branding.assetId}"]`);
  await assetRow().locator('[name="status"]').selectOption("approved");
  const assetApprovalPromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/partners/brand-assets/${branding.assetId}`
    && response.request().method() === "PATCH"
  ), { timeout: timeoutMs });
  await assetRow().locator("[data-save-brand-asset]").click();
  const assetApproval = await assetApprovalPromise;
  if (assetApproval.status() !== 200) throw new Error(`Sponsor logo approval returned ${assetApproval.status()}.`);
  await expect(assetRow().locator('[data-status="approved"]')).toHaveText("approved");

  return { applicationStatus: "approved", profileStatus: "approved", assetStatus: "approved" };
}

async function proveShowcase(page, apiBase, visitorUrl, branding) {
  const payload = await getJson(apiBase, "/api/public/sponsors");
  const sponsor = payload.sponsors?.find(item => item.displayName === TARGET_PROSPECT.organizationName);
  const publicWebsite = new URL(branding.website).toString();
  if (
    payload.sponsors?.length !== BASELINE.featuredSponsors + 1
    || sponsor?.packageName !== PACKAGE_NAME
    || sponsor?.tagline !== branding.tagline
    || sponsor?.website !== publicWebsite
    || !sponsor?.logo?.path?.includes(branding.assetId)
    || Object.hasOwn(sponsor || {}, "applicationId")
  ) {
    throw new Error(`Approved sponsor branding did not publish through the privacy-safe showcase contract: ${JSON.stringify({
      sponsorCount: payload.sponsors?.length,
      sponsor,
      expectedWebsite: publicWebsite,
      expectedAssetId: branding.assetId
    })}.`);
  }

  const logoResponse = await fetch(`${apiBase}${sponsor.logo.path}`, { signal: AbortSignal.timeout(10_000) });
  const publicLogo = Buffer.from(await logoResponse.arrayBuffer());
  const publicChecksumSha256 = sha256(publicLogo);
  if (
    !logoResponse.ok
    || logoResponse.headers.get("content-type") !== "image/png"
    || publicLogo.length !== branding.sourceLogo.length
    || publicChecksumSha256 !== branding.sourceChecksumSha256
  ) {
    throw new Error("The approved public sponsor logo is not byte-identical to the submitted PNG.");
  }

  const visitor = new URL(visitorUrl);
  visitor.hash = "sponsors";
  await page.goto(visitor.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await expect(page.locator("#network-status")).toHaveText("Demo");
  const card = page.locator("#public-sponsor-showcase .public-sponsor-card")
    .filter({ hasText: TARGET_PROSPECT.organizationName });
  await expect(page.locator("#public-sponsor-showcase")).toHaveAttribute("data-count", "2");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(`${PACKAGE_NAME} partner`);
  await expect(card).toContainText(branding.tagline);
  await expect(card).toHaveAttribute("href", publicWebsite);
  const image = card.locator("img");
  await expect(image).toHaveAttribute("src", new RegExp(`/api/public/sponsor-showcase/assets/${branding.assetId}$`));
  await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);

  return {
    sponsorCount: payload.sponsors.length,
    displayName: sponsor.displayName,
    packageName: sponsor.packageName,
    logoBytes: publicLogo.length,
    logoChecksumSha256: publicChecksumSha256
  };
}

async function proveAudit(apiBase, applicationId, assetId) {
  const payload = await getJson(apiBase, "/api/admin/audit?limit=200", { admin: true });
  const records = (payload.audit || []).map(item => item.record).filter(record => (
    (record?.target?.type === "prospect" && record.target.id === TARGET_PROSPECT.id)
    || (record?.target?.type === "application" && record.target.id === applicationId)
    || (record?.target?.type === "brand_asset" && record.target.id === assetId)
  ));
  const actions = new Set(records.map(record => record.action));
  for (const action of [
    "outreach.sponsor_invitation.issue",
    "partner.application.update",
    "partner.brand_profile.approved",
    "partner.brand_asset.approved"
  ]) {
    if (!actions.has(action)) throw new Error(`Sponsor journey audit is missing ${action}.`);
  }
  const serialized = JSON.stringify(records);
  if (serialized.includes("#sponsor-invitation?token=") || serialized.includes("storageKey")) {
    throw new Error("Sponsor journey audit exposed an invitation capability or private storage key.");
  }
  return { records: records.length, actions: [...actions].sort() };
}

const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });
const runId = randomUUID().slice(0, 8);
const result = {
  ok: false,
  runId,
  invitation: null,
  application: null,
  branding: null,
  review: null,
  showcase: null,
  audit: null,
  reset: null
};
let browser = null;
let resetRequired = false;
let workflowError = null;

try {
  log("\n=== Active board sponsor journey proof ===\n");
  let report = await stablePreflight(sessionFile);
  let session = await readBoardDemoSession(sessionFile);
  let endpoints = activeSession(session, report);
  const initial = await baselineSnapshot(endpoints.apiBase);
  if (!baselineMatches(initial)) {
    log("Restoring the prepared sponsor and outreach baseline before rehearsal...");
    result.reset = await resetBaseline(sessionFile, session);
    session = await readBoardDemoSession(sessionFile);
    report = await stablePreflight(sessionFile);
    endpoints = activeSession(session, report);
  }

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const operationsPage = await context.newPage();
  const operationsUrl = new URL(endpoints.operations);
  operationsUrl.hash = "admin-outreach-prospects-workspace";
  await operationsPage.goto(operationsUrl.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForOperations(operationsPage);
  await expect(operationsPage.locator("#network-status")).toHaveText("Demo");
  await expect(operationsPage.locator("#runtime-data-notice")).toContainText("No external messages, charges, or live-provider calls");

  const prospectCard = operationsPage.locator(`[data-outreach-prospect="${TARGET_PROSPECT.id}"]`);
  await expect(prospectCard).toContainText(TARGET_PROSPECT.organizationName);
  await expect(prospectCard).toContainText(TARGET_PROSPECT.city);
  await expect(prospectCard).toContainText(TARGET_PROSPECT.postalCode);
  await expect(prospectCard).toContainText("Ready for an invited sponsor application");
  await prospectCard.locator('[name="sponsorPackageId"]').selectOption(PACKAGE_ID);

  resetRequired = true;
  const invitationPath = `/api/admin/outreach/prospects/${TARGET_PROSPECT.id}/sponsor-invitation`;
  const issuePromise = operationsPage.waitForResponse(response => (
    new URL(response.url()).pathname === invitationPath
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await prospectCard.locator('[data-sponsor-invitation-action="issue"]').click();
  const issueResponse = await issuePromise;
  const invitationPayload = await issueResponse.json().catch(() => ({}));
  if (
    issueResponse.status() !== 200
    || invitationPayload.invitation?.packageId !== PACKAGE_ID
    || !invitationPayload.invitation?.url?.includes("#sponsor-invitation?token=")
  ) {
    throw new Error(`Sponsor invitation returned ${issueResponse.status()} without a signed Tarpon link.`);
  }
  result.invitation = {
    prospectId: TARGET_PROSPECT.id,
    packageId: invitationPayload.invitation.packageId,
    expiresAt: invitationPayload.invitation.expiresAt
  };

  const popupPromise = operationsPage.waitForEvent("popup", { timeout: timeoutMs });
  await prospectCard.locator('[data-sponsor-invitation-action="open"]').click();
  const sponsorPage = await popupPromise;
  await sponsorPage.waitForLoadState("domcontentloaded");
  const conversion = await submitInvitedSponsor(sponsorPage, endpoints.apiBase);
  result.application = {
    id: conversion.application.id,
    reference: conversion.application.reference,
    type: conversion.application.type,
    outreachConversion: conversion.outreachConversion
  };
  const branding = await submitBranding(sponsorPage, endpoints.apiBase, runId);
  result.branding = {
    assetId: branding.assetId,
    tagline: branding.tagline,
    website: branding.website,
    sourceChecksumSha256: branding.sourceChecksumSha256
  };
  await sponsorPage.close();

  result.review = await reviewSponsor(operationsPage, endpoints.apiBase, conversion.application, branding);
  result.showcase = await proveShowcase(operationsPage, endpoints.apiBase, endpoints.visitor, branding);
  result.audit = await proveAudit(endpoints.apiBase, conversion.application.id, branding.assetId);
  log(`Verified ${conversion.application.reference} from targeted invitation through approved public branding.`);
} catch (error) {
  workflowError = error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (resetRequired) {
    try {
      const session = await readBoardDemoSession(sessionFile);
      result.reset = await resetBaseline(sessionFile, session);
      log(`Restored the exact sponsor baseline at ${result.reset.preflight} readiness.`);
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
  else console.error(`\nBoard sponsor journey proof failed: ${workflowError.message}`);
  process.exitCode = 1;
} else {
  result.ok = true;
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("\nBoard sponsor journey proof passed.");
    console.log(`Invitation:  ${TARGET_PROSPECT.organizationName} · ${PACKAGE_NAME}`);
    console.log(`Application: ${result.application.reference} · outreach converted`);
    console.log(`Branding:    profile + uploaded logo approved`);
    console.log(`Showcase:    ${result.showcase.sponsorCount} sponsors · ${result.showcase.logoBytes} verified logo bytes`);
    console.log(`Integrity:   SHA-256 ${result.showcase.logoChecksumSha256}`);
    console.log(`Audit:       ${result.audit.records} governed lifecycle records`);
    console.log(`Reset:       ${result.reset.applications} applications · ${result.reset.prospects} prospects · ${result.reset.preflight} ready`);
  }
}
