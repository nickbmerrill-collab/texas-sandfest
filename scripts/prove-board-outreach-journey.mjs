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
const TARGET = {
  sourceRef: "fixture/business/seabreeze-resort",
  organizationName: "Seabreeze Resort",
  contactName: "Jordan Lee",
  contactEmail: "seabreeze.partnerships@example.com",
  industry: "lodging",
  city: "Port Aransas",
  state: "TX",
  postalCode: "78373"
};
const PACKAGE_ID = "tarpon";
const BASELINE = {
  prospects: 2,
  qualified: 2,
  suppressed: 0,
  campaigns: 2,
  activeCampaigns: 2,
  draftsAwaitingReview: 1,
  messagesSent: 1,
  nextActionsScheduled: 2,
  unassigned: 0,
  followups: 24,
  sponsorOutreach: 2,
  deliveredOutreach: 1,
  invitations: 0,
  discoveredProspects: 0
};
const timeoutMs = 30_000;
const jsonOutput = process.argv.includes("--json");

if (process.argv.includes("--help")) {
  console.log("Usage: npm run board:prove:outreach -- [--json]");
  console.log("Discovers, qualifies, targets, and delivers to one regional sponsor prospect, proves recipient suppression, then restores the exact board baseline.");
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

async function baselineSnapshot(apiBase) {
  const outreach = await adminJson(apiBase, "/api/admin/outreach");
  const followups = outreach.followups || [];
  return {
    prospects: outreach.summary?.prospects,
    qualified: outreach.summary?.qualified,
    suppressed: outreach.summary?.suppressed,
    campaigns: outreach.summary?.campaigns,
    activeCampaigns: outreach.summary?.activeCampaigns,
    draftsAwaitingReview: outreach.summary?.draftsAwaitingReview,
    messagesSent: outreach.summary?.messagesSent,
    nextActionsScheduled: outreach.summary?.nextActionsScheduled,
    unassigned: outreach.summary?.unassigned,
    followups: followups.length,
    sponsorOutreach: followups.filter(item => item.kind === "sponsor_outreach").length,
    deliveredOutreach: followups.filter(item => item.kind === "sponsor_outreach" && item.deliveryStatus === "delivered").length,
    invitations: outreach.prospects?.filter(item => item.sponsorInvitation).length,
    discoveredProspects: outreach.prospects?.filter(item => item.source === "board_demo_discovery").length
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
  if (!baselineMatches(snapshot)) throw new Error(`Board reset did not restore the exact outreach baseline: ${JSON.stringify(snapshot)}.`);
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
  await page.waitForFunction(() => {
    const status = document.querySelector("#admin-api-status");
    return status?.dataset.workspaceState === "ready" && status.getAttribute("aria-busy") === "false";
  }, null, { timeout: timeoutMs });
}

async function discoverProspect(page) {
  const form = page.locator("#admin-discover-businesses");
  await expect(page.locator("#admin-outreach-discovery-readiness")).toHaveText("fixture ready");
  await expect(form.locator('input[name="location"]')).toHaveValue("Port Aransas, TX 78373");
  const previewPromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/admin/outreach/discovery/preview"
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await form.locator('button[type="submit"]').click();
  const previewResponse = await previewPromise;
  const preview = await previewResponse.json().catch(() => ({}));
  const candidate = preview.candidates?.find(item => item.sourceRef === TARGET.sourceRef);
  if (
    previewResponse.status() !== 200
    || preview.discovery?.provider !== "fixture"
    || !preview.discovery?.attribution?.includes("Synthetic")
    || candidate?.organizationName !== TARGET.organizationName
    || candidate?.contactEmail !== TARGET.contactEmail
    || !preview.previewToken
  ) {
    throw new Error(`Regional discovery returned ${previewResponse.status()} without the expected synthetic business candidate.`);
  }
  await expect(page.locator("#admin-outreach-discovery-result")).toContainText(TARGET.organizationName);
  await expect(page.locator("#admin-outreach-discovery-result")).toContainText("Listed email unverified");
  const selection = form.locator(`input[name="discoveredSourceRef"][value="${TARGET.sourceRef}"]`);
  await selection.check();
  await expect(page.locator("#admin-import-discovered-businesses")).toHaveText("Import 1 selected");

  const importPromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/admin/outreach/discovery/import"
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await page.locator("#admin-import-discovered-businesses").click();
  const importResponse = await importPromise;
  const imported = await importResponse.json().catch(() => ({}));
  const prospect = imported.prospects?.[0];
  if (
    importResponse.status() !== 201
    || imported.summary?.selected !== 1
    || imported.summary?.imported !== 1
    || imported.summary?.contactResearchRequired !== 1
    || prospect?.organizationName !== TARGET.organizationName
    || prospect?.status !== "identified"
    || prospect?.contactBasis !== null
    || prospect?.source !== "board_demo_discovery"
  ) {
    throw new Error(`Discovery import returned ${importResponse.status()} without a research-gated prospect.`);
  }
  await expect(page.locator("#admin-api-status")).toContainText("contact research remains required");
  const card = page.locator(`[data-outreach-prospect="${prospect.id}"]`);
  await expect(card).toContainText(TARGET.organizationName);
  await expect(card.locator('[name="status"]')).toHaveValue("identified");
  await expect(card.locator('[data-sponsor-invitation-action="issue"]')).toBeDisabled();
  return { prospect, batchId: imported.batchId };
}

async function qualifyProspect(page, discovered) {
  const card = page.locator(`[data-outreach-prospect="${discovered.prospect.id}"]`);
  await card.locator('[name="contactName"]').fill(TARGET.contactName);
  await expect(card.locator('[name="contactEmail"]')).toHaveValue(TARGET.contactEmail);
  await card.locator('[name="ownerId"]').fill("sponsor");
  await card.locator('[name="nextAction"]').fill("Review the Tarpon partnership invitation and campaign delivery");
  await card.locator('[name="nextActionAt"]').fill(localDateTimeInput(Date.now() + 2 * 86_400_000));
  await card.locator('[name="communityFit"]').check();
  await card.locator('[name="contactBasis"]').selectOption("business_relevance");
  await card.locator('[name="status"]').selectOption("contact_ready");
  const savePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/outreach/prospects/${discovered.prospect.id}`
    && response.request().method() === "PATCH"
  ), { timeout: timeoutMs });
  await card.locator('[data-save-prospect]').click();
  const saveResponse = await savePromise;
  const saved = await saveResponse.json().catch(() => ({}));
  if (
    saveResponse.status() !== 200
    || saved.prospect?.status !== "contact_ready"
    || saved.prospect?.contactBasis !== "business_relevance"
    || saved.prospect?.ownerId !== "sponsor"
    || saved.prospect?.communityFit !== true
    || !saved.prospect?.nextActionAt
    || saved.prospect?.fitScore < 60
  ) {
    throw new Error(`Prospect qualification returned ${saveResponse.status()} without accountable outreach readiness.`);
  }
  await expect(card.locator('[data-sponsor-invitation-action="issue"]')).toBeEnabled();
  await expect(card).toContainText("Owner sponsor");
  return saved.prospect;
}

async function issueInvitation(page, prospectId) {
  const card = page.locator(`[data-outreach-prospect="${prospectId}"]`);
  await card.locator('[name="sponsorPackageId"]').selectOption(PACKAGE_ID);
  const issuePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/outreach/prospects/${prospectId}/sponsor-invitation`
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await card.locator('[data-sponsor-invitation-action="issue"]').click();
  const issueResponse = await issuePromise;
  const payload = await issueResponse.json().catch(() => ({}));
  if (
    issueResponse.status() !== 200
    || payload.invitation?.packageId !== PACKAGE_ID
    || !payload.invitation?.url?.includes("#sponsor-invitation?token=")
    || !payload.invitation?.expiresAt
  ) {
    throw new Error(`Sponsor invitation returned ${issueResponse.status()} without a signed Tarpon link.`);
  }
  await expect(card).toContainText("Tarpon");
  await expect(card.locator('[data-sponsor-invitation-action="open"]')).toBeVisible();
  return payload.invitation;
}

async function createCampaign(page, prospect, runId) {
  const name = `Seabreeze regional partner proof ${runId}`;
  const subject = `A Texas SandFest partnership for {{organization}} - ${runId}`;
  const form = page.locator("#admin-create-campaign");
  await form.locator('[name="name"]').fill(name);
  await form.locator('[name="objective"]').fill("Deliver one reviewed sponsor invitation to a qualified Port Aransas lodging business.");
  await form.locator('[name="industries"]').fill(TARGET.industry);
  await form.locator('[name="cities"]').fill(TARGET.city);
  await form.locator('[name="states"]').fill(TARGET.state);
  await form.locator('[name="postalCodes"]').fill(TARGET.postalCode);
  await form.locator('[name="centerSource"]').selectOption(`prospect:${prospect.id}`);
  await form.locator('[name="radiusMiles"]').fill("2");
  await form.locator('[name="minFitScore"]').fill("60");
  await form.locator('[name="deliveryMode"]').selectOption("approved_sequence");
  await form.locator('[name="dailySendLimit"]').fill("1");
  await form.locator('[name="subject1"]').fill(subject);
  await form.locator('[name="body1"]').fill("Hello {{contactName}},\n\nTexas SandFest would like to invite {{organization}} to review a targeted 2027 coastal partnership opportunity.");
  await expect(form.locator("#admin-campaign-center-preview")).toHaveAttribute("data-state", "ready");
  await expect(form.locator("#admin-campaign-center-preview")).toContainText(TARGET.organizationName);
  await expect(form.locator('button[type="submit"]')).toBeDisabled();

  const previewPromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/admin/outreach/campaigns/preview"
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await form.locator("#admin-preview-campaign").click();
  const previewResponse = await previewPromise;
  const previewPayload = await previewResponse.json().catch(() => ({}));
  const preview = previewPayload.preview;
  if (
    previewResponse.status() !== 200
    || preview?.matched !== 1
    || preview?.matches?.length !== 1
    || preview.matches[0].id !== prospect.id
    || Object.hasOwn(preview.matches[0], "contactEmail")
    || preview.sample?.prospect?.organizationName !== TARGET.organizationName
    || preview.dailySendLimit !== 1
  ) {
    throw new Error(`Campaign preflight returned ${previewResponse.status()} without one privacy-safe qualified business.`);
  }
  const previewPanel = form.locator("#admin-campaign-audience-preview");
  await expect(previewPanel).toHaveAttribute("data-state", "ready");
  await expect(previewPanel).toContainText("1 business qualifies");
  await expect(previewPanel).toContainText(TARGET.organizationName);
  await expect(previewPanel).not.toContainText(TARGET.contactEmail);
  await expect(form.locator('button[type="submit"]')).toBeEnabled();

  const createPromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/admin/outreach/campaigns"
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await form.locator('button[type="submit"]').click();
  const createResponse = await createPromise;
  const created = await createResponse.json().catch(() => ({}));
  const campaign = created.campaign;
  if (
    createResponse.status() !== 201
    || campaign?.status !== "draft"
    || campaign?.deliveryMode !== "approved_sequence"
    || campaign?.dailySendLimit !== 1
    || campaign?.targeting?.geofence?.radiusMiles !== 2
  ) {
    throw new Error(`Campaign creation returned ${createResponse.status()} without the approved geographic guardrails.`);
  }
  const card = page.locator(`[data-outreach-campaign="${campaign.id}"]`);
  await expect(card).toContainText(name);
  await expect(card).toContainText("1 matched");
  await expect(card).toContainText("campaign-approved, 1/day");
  const map = page.locator("#admin-outreach-targeting-map");
  await map.locator("#admin-outreach-map-campaign").selectOption(campaign.id);
  await expect(map).toHaveAttribute("data-campaign-id", campaign.id);
  await expect(map.locator(`[data-outreach-map-prospect="${prospect.id}"]`)).toHaveAttribute("data-at-center", "true");
  await expect(map.locator(`[data-outreach-map-row="${prospect.id}"]`)).toContainText("0.0 mi · inside radius");
  await expect(map.getByText("server matched").locator("..")).toContainText("1");
  return { campaign, name, subject };
}

async function activateCampaign(page, campaign) {
  const card = page.locator(`[data-outreach-campaign="${campaign.campaign.id}"]`);
  page.once("dialog", dialog => dialog.accept());
  const activatePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/outreach/campaigns/${campaign.campaign.id}/activate`
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await card.locator('[data-campaign-action="activate"]').click();
  const activateResponse = await activatePromise;
  const payload = await activateResponse.json().catch(() => ({}));
  if (
    activateResponse.status() !== 200
    || payload.campaign?.status !== "active"
    || payload.generated !== 1
  ) {
    throw new Error(`Campaign activation returned ${activateResponse.status()} without exactly one due message.`);
  }
  await expect(page.locator("#admin-api-status")).toContainText("1 due message eligible for bounded automation");
  return payload;
}

function privateLinksFromDelivery(followup, endpoints, prospectId) {
  const invitationMatch = String(followup?.body || "").match(/https?:\/\/[^\s]+#sponsor-invitation\?[^\s]+/);
  const preferenceMatch = String(followup?.body || "").match(/https?:\/\/[^\s]+#outreach-preferences\?[^\s]+/);
  if (!invitationMatch || !preferenceMatch) throw new Error("The delivered campaign message omitted its sponsor invitation or recipient preference link.");
  const invitationUrl = new URL(invitationMatch[0]);
  const preferenceUrl = new URL(preferenceMatch[0]);
  const preference = new URLSearchParams(preferenceUrl.hash.slice("#outreach-preferences?".length));
  if (
    invitationUrl.origin !== endpoints.webBase
    || preferenceUrl.origin !== endpoints.webBase
    || invitationUrl.search
    || preferenceUrl.search
    || preference.get("prospect") !== prospectId
    || !/^tsfu_[A-Za-z0-9_-]+$/.test(preference.get("token") || "")
  ) {
    throw new Error("The delivered campaign capabilities are not scoped to the active board site and prospect.");
  }
  return {
    invitationUrl,
    preferenceUrl,
    preferenceAccess: { prospectId, token: preference.get("token") }
  };
}

async function waitForDelivery(apiBase, endpoints, campaign, prospectId) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const outreach = await adminJson(apiBase, "/api/admin/outreach");
    const followup = outreach.followups?.find(item => (
      item.campaignId === campaign.campaign.id
      && item.prospectId === prospectId
      && item.kind === "sponsor_outreach"
    ));
    if (followup?.status === "sent" && followup.deliveryStatus === "delivered") {
      if (
        followup.subject !== campaign.subject.replace("{{organization}}", TARGET.organizationName)
        || followup.automationPolicy !== "outreach_campaign_v1"
        || followup.provider !== "brevo"
        || !String(followup.providerMessageId || "").startsWith("board-mail-")
        || followup.deliveryAttempts !== 1
      ) {
        throw new Error("The campaign delivery lost its bounded, authenticated, or retry-safe evidence.");
      }
      return { followup, links: privateLinksFromDelivery(followup, endpoints, prospectId), outreach };
    }
    await delay(250);
  }
  throw new Error("The targeted outreach message did not reach authenticated local delivery in time.");
}

async function refreshOperations(page) {
  const responses = Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET", { timeout: timeoutMs }),
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach" && response.request().method() === "GET", { timeout: timeoutMs })
  ]);
  await page.locator("#admin-load-partners").click();
  const loaded = await responses;
  if (loaded.some(response => !response.ok())) throw new Error("Operations refresh did not reload the partner and outreach workspaces.");
}

async function proveRecipientPreference(context, endpoints, prospectId, delivery) {
  const invalid = await requestJson(endpoints.apiBase, "/api/public/outreach-preferences", {
    method: "POST",
    body: { prospectId, token: `${delivery.links.preferenceAccess.token}x` }
  });
  if (invalid.response.status !== 404) throw new Error("Outreach preferences accepted an invalid recipient capability.");

  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 780 });
  const preferenceUrl = new URL(delivery.links.preferenceUrl);
  preferenceUrl.searchParams.set("apiBase", endpoints.apiBase);
  const statusPromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/public/outreach-preferences"
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await page.goto(preferenceUrl.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const statusResponse = await statusPromise;
  const status = await statusResponse.json().catch(() => ({}));
  if (statusResponse.status() !== 200 || status.preference?.status !== "subscribed") {
    throw new Error("The valid outreach preference link did not open the current recipient setting.");
  }
  await expect(page).toHaveURL(url => url.hash === "#outreach-preferences" && !url.href.includes("token="));
  await expect(page.locator("#outreach-preferences-copy")).toContainText(`${TARGET.organizationName} is currently eligible`);
  await expect(page.locator("#outreach-preferences-unsubscribe")).toBeVisible();

  const unsubscribePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/public/outreach-preferences/unsubscribe"
    && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await page.locator("#outreach-preferences-unsubscribe").click();
  const unsubscribeResponse = await unsubscribePromise;
  const unsubscribed = await unsubscribeResponse.json().catch(() => ({}));
  if (
    unsubscribeResponse.status() !== 200
    || unsubscribed.duplicate !== false
    || unsubscribed.preference?.status !== "unsubscribed"
  ) {
    throw new Error(`Recipient suppression returned ${unsubscribeResponse.status()} without a durable opt-out.`);
  }
  await expect(page.locator("#outreach-preferences-copy")).toContainText("will not receive further");
  await expect(page.locator("#outreach-preferences-status")).toContainText("Any unsent outreach has been canceled");
  await expect(page.locator("#outreach-preferences-unsubscribe")).toBeHidden();

  const repeat = await requestJson(endpoints.apiBase, "/api/public/outreach-preferences/unsubscribe", {
    method: "POST",
    body: delivery.links.preferenceAccess
  });
  if (repeat.response.status !== 200 || repeat.payload.duplicate !== true || repeat.payload.preference?.status !== "unsubscribed") {
    throw new Error("Recipient suppression did not treat a retry as an idempotent replay.");
  }
  await page.close();
  return {
    invalidCapabilityDenied: true,
    capabilityConcealed: true,
    status: unsubscribed.preference.status,
    replayed: repeat.payload.duplicate === true
  };
}

async function proveFinalOperations(page, apiBase, prospectId, campaign, delivery) {
  await refreshOperations(page);
  const outreach = await adminJson(apiBase, "/api/admin/outreach");
  const prospect = outreach.prospects?.find(item => item.id === prospectId);
  const storedCampaign = outreach.campaigns?.find(item => item.id === campaign.campaign.id);
  const storedDelivery = outreach.followups?.find(item => item.id === delivery.followup.id);
  if (
    prospect?.status !== "do_not_contact"
    || !prospect?.suppressedAt
    || !prospect?.suppressionReason?.includes("public outreach preferences")
    || storedCampaign?.status !== "active"
    || storedCampaign?.metrics?.matched !== 0
    || storedCampaign?.metrics?.sent !== 1
    || storedCampaign?.metrics?.funnel?.delivered !== 1
    || storedDelivery?.deliveryStatus !== "delivered"
    || outreach.summary?.prospects !== 3
    || outreach.summary?.qualified !== 2
    || outreach.summary?.suppressed !== 1
    || outreach.summary?.campaigns !== 3
    || outreach.summary?.activeCampaigns !== 3
    || outreach.summary?.messagesSent !== 2
    || outreach.followups?.length !== 25
  ) {
    throw new Error(`The delivered and suppressed outreach lifecycle is missing from Operations: ${JSON.stringify({ summary: outreach.summary, prospect, campaign: storedCampaign?.metrics, deliveryStatus: storedDelivery?.deliveryStatus, followups: outreach.followups?.length })}.`);
  }
  const prospectCard = page.locator(`[data-outreach-prospect="${prospectId}"]`);
  await expect(prospectCard).toContainText("Recipient unsubscribed through public outreach preferences");
  await expect(prospectCard.locator("[data-restore-prospect]")).toBeVisible();
  const campaignCard = page.locator(`[data-outreach-campaign="${campaign.campaign.id}"]`);
  await expect(campaignCard.locator('[data-outcome-stage="reached"] strong')).toHaveText("1");
  await expect(campaignCard.locator('[data-outcome-stage="delivered"] strong')).toHaveText("1");
  return {
    prospects: outreach.summary.prospects,
    qualified: outreach.summary.qualified,
    suppressed: outreach.summary.suppressed,
    campaigns: outreach.summary.campaigns,
    activeCampaigns: outreach.summary.activeCampaigns,
    messagesSent: outreach.summary.messagesSent,
    followups: outreach.followups.length
  };
}

async function proveAudit(apiBase, { prospectId, campaignId, batchId, forbiddenValues }) {
  const payload = await adminJson(apiBase, "/api/admin/audit?limit=200");
  const records = (payload.audit || []).map(item => item.record).filter(record => (
    (record?.action === "outreach.discovery.preview" && record.target?.type === "outreach_discovery")
    || (record?.action === "outreach.discovery.import" && record.target?.id === batchId)
    || (record?.target?.type === "prospect" && record.target.id === prospectId)
    || (record?.target?.type === "campaign" && record.target.id === campaignId)
  ));
  const actions = new Set(records.map(record => record.action));
  const expected = [
    "outreach.discovery.preview",
    "outreach.discovery.import",
    "outreach.prospect.update",
    "outreach.sponsor_invitation.issue",
    "outreach.campaign.create",
    "outreach.campaign.activate",
    "outreach.prospect.public_unsubscribe"
  ];
  for (const action of expected) {
    if (!actions.has(action)) throw new Error(`Outreach journey audit is missing ${action}.`);
  }
  const serialized = JSON.stringify(records);
  for (const forbidden of ["tsfu_", "#sponsor-invitation?token=", TARGET.contactEmail, ...forbiddenValues]) {
    if (forbidden && serialized.includes(forbidden)) throw new Error(`Outreach journey audit exposed private value ${forbidden}.`);
  }
  return { records: records.length, actions: [...actions].sort() };
}

const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });
const runId = randomUUID().slice(0, 8);
const result = {
  ok: false,
  runId,
  discovery: null,
  qualification: null,
  invitation: null,
  campaign: null,
  delivery: null,
  preference: null,
  operations: null,
  audit: null,
  reset: null
};
let browser = null;
let resetRequired = false;
let workflowError = null;

try {
  log("\n=== Active board outreach journey proof ===\n");
  let report = await stablePreflight(sessionFile);
  let session = await readBoardDemoSession(sessionFile);
  let endpoints = activeSession(session, report);
  const initial = await baselineSnapshot(endpoints.apiBase);
  if (!baselineMatches(initial)) {
    log("Restoring the prepared sponsor outreach baseline before rehearsal...");
    result.reset = await resetBaseline(sessionFile, session);
    session = await readBoardDemoSession(sessionFile);
    report = await stablePreflight(sessionFile);
    endpoints = activeSession(session, report);
  }

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const operationsUrl = new URL(endpoints.operations);
  operationsUrl.hash = "admin-outreach-prospects-workspace";
  await page.goto(operationsUrl.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForOperations(page);
  await expect(page.locator("#network-status")).toHaveText("Demo");
  await expect(page.locator("#runtime-data-notice")).toContainText("No external messages, charges, or live-provider calls");

  resetRequired = true;
  const discovered = await discoverProspect(page);
  result.discovery = {
    provider: "fixture",
    organizationName: discovered.prospect.organizationName,
    source: discovered.prospect.source,
    researchRequired: discovered.prospect.contactBasis === null,
    batchId: discovered.batchId
  };
  const qualified = await qualifyProspect(page, discovered);
  result.qualification = {
    prospectId: qualified.id,
    status: qualified.status,
    fitScore: qualified.fitScore,
    ownerId: qualified.ownerId,
    nextActionScheduled: Boolean(qualified.nextActionAt)
  };
  const invitation = await issueInvitation(page, qualified.id);
  result.invitation = { packageId: invitation.packageId, expiresAt: invitation.expiresAt };
  const campaign = await createCampaign(page, qualified, runId);
  await activateCampaign(page, campaign);
  result.campaign = {
    campaignId: campaign.campaign.id,
    status: "active",
    matched: 1,
    radiusMiles: campaign.campaign.targeting.geofence.radiusMiles,
    dailySendLimit: campaign.campaign.dailySendLimit
  };

  const delivery = await waitForDelivery(endpoints.apiBase, endpoints, campaign, qualified.id);
  const mailboxResponse = await fetch(`${endpoints.emailBase}/health`, { signal: AbortSignal.timeout(5_000) });
  const mailbox = mailboxResponse.ok ? await mailboxResponse.json() : null;
  if (!mailboxResponse.ok || mailbox?.deliveryCallbacks < 1 || mailbox?.callbackFailures !== 0) {
    throw new Error("The local mailbox did not authenticate the outreach delivery callback.");
  }
  await refreshOperations(page);
  const followupCard = page.locator(`#admin-partner-followups [data-followup="${delivery.followup.id}"]`);
  await expect(followupCard).toHaveAttribute("data-delivery-status", "delivered");
  await expect(followupCard).toContainText("campaign-approved automation");
  result.delivery = {
    status: delivery.followup.status,
    deliveryStatus: delivery.followup.deliveryStatus,
    provider: delivery.followup.provider,
    attempts: delivery.followup.deliveryAttempts,
    sandboxAuthenticated: String(delivery.followup.providerMessageId).startsWith("board-mail-"),
    invitationDelivered: true,
    preferenceDelivered: true
  };

  result.preference = await proveRecipientPreference(context, endpoints, qualified.id, delivery);
  result.operations = await proveFinalOperations(page, endpoints.apiBase, qualified.id, campaign, delivery);
  result.audit = await proveAudit(endpoints.apiBase, {
    prospectId: qualified.id,
    campaignId: campaign.campaign.id,
    batchId: discovered.batchId,
    forbiddenValues: [delivery.links.preferenceAccess.token, delivery.links.invitationUrl.toString()]
  });
  log(`Verified ${TARGET.organizationName} from regional discovery through authenticated outreach and recipient suppression.`);
} catch (error) {
  workflowError = error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (resetRequired) {
    try {
      const session = await readBoardDemoSession(sessionFile);
      result.reset = await resetBaseline(sessionFile, session);
      log(`Restored the exact outreach baseline at ${result.reset.preflight} readiness.`);
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
  else console.error(`\nBoard outreach journey proof failed: ${workflowError.message}`);
  process.exitCode = 1;
} else {
  result.ok = true;
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("\nBoard outreach journey proof passed.");
    console.log(`Discovery:     ${result.discovery.organizationName} · ${result.discovery.provider} · research gated`);
    console.log(`Qualification: ${result.qualification.status} · fit ${result.qualification.fitScore} · owner ${result.qualification.ownerId}`);
    console.log(`Campaign:      ${result.campaign.matched} business · ${result.campaign.radiusMiles} mi · ${result.campaign.dailySendLimit}/day`);
    console.log(`Delivery:      ${result.delivery.deliveryStatus} through authenticated local ${result.delivery.provider}`);
    console.log("Recipient:     invalid capability denied · link concealed · opt-out replay safe");
    console.log(`Audit:         ${result.audit.records} capability- and address-safe lifecycle records`);
    console.log(`Reset:         ${result.reset.prospects} prospects · ${result.reset.campaigns} campaigns · ${result.reset.messagesSent} sent · ${result.reset.preflight}`);
  }
}
