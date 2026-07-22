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
const SOURCE_LOGO = path.join(ROOT, "docs", "board-demo-assets", "gulf-shore-credit-union-logo.png");
const BASELINE = {
  applications: 5,
  sponsors: 2,
  profiles: 2,
  approvedProfiles: 1,
  assets: 2,
  approvedAssets: 2,
  deliverables: 12,
  publicSponsors: ["Gulf Shore Credit Union"]
};
const timeoutMs = 30_000;
const jsonOutput = process.argv.includes("--json");

if (process.argv.includes("--help")) {
  console.log("Usage: npm run board:prove:sponsor-branding -- [--json]");
  console.log("Submits, reviews, and publishes one synthetic sponsor brand kit, then restores the board baseline.");
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

async function responseJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${new URL(url).pathname} returned ${response.status}.`);
  return response.json();
}

async function adminPartners(apiBase) {
  return responseJson(`${apiBase}/api/admin/partners`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
  });
}

async function publicSponsors(apiBase) {
  return responseJson(`${apiBase}/api/public/sponsors`);
}

async function baselineSnapshot(apiBase) {
  const [partners, showcase] = await Promise.all([adminPartners(apiBase), publicSponsors(apiBase)]);
  return {
    applications: partners.summary?.applications?.total,
    sponsors: partners.summary?.applications?.sponsors,
    profiles: partners.fulfillment?.profiles?.total,
    approvedProfiles: partners.fulfillment?.profiles?.approved,
    assets: partners.fulfillment?.assets?.total,
    approvedAssets: partners.fulfillment?.assets?.approved,
    deliverables: partners.fulfillment?.deliverables?.total,
    publicSponsors: (showcase.sponsors || []).map(item => item.displayName).sort()
  };
}

function baselineMatches(snapshot) {
  return Object.entries(BASELINE).every(([key, value]) => (
    key === "publicSponsors"
      ? JSON.stringify(snapshot?.publicSponsors) === JSON.stringify(value)
      : snapshot?.[key] === value
  ));
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
  const response = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(5_000) });
  const health = response.ok ? await response.json() : null;
  if (!health?.boardDemoResetReady || !health.boardDemoGeneration) {
    throw new Error("The active board API does not expose the supervised reset capability.");
  }
  const resetCount = Number(session.resetCount || 0);
  const resetResponse = await fetch(`${apiBase}/api/admin/board-demo/reset`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(5_000)
  });
  const accepted = await resetResponse.json().catch(() => ({}));
  if (resetResponse.status !== 202 || accepted.accepted !== true || accepted.generation !== health.boardDemoGeneration) {
    throw new Error(`Board reset was not accepted safely (${resetResponse.status}).`);
  }

  const restored = await waitForReset(sessionFile, {
    generation: health.boardDemoGeneration,
    resetCount
  });
  const report = preflight(sessionFile);
  const snapshot = await baselineSnapshot(restored.apiBase);
  if (!baselineMatches(snapshot)) {
    throw new Error(`Board reset did not restore the exact sponsor-branding baseline: ${JSON.stringify(snapshot)}.`);
  }
  return {
    fromGeneration: health.boardDemoGeneration,
    toGeneration: restored.generation,
    ...snapshot,
    preflight: `${report.passed}/${report.total}`
  };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function waitForVisitor(page) {
  await page.waitForFunction(() => (
    document.querySelector("#network-status")?.textContent?.trim() === "Demo"
    && document.querySelector("#sponsor-inquiry-form")?.dataset.publicIntakeState === "ready"
  ), null, { timeout: timeoutMs });
}

async function submitSponsor(page, organizationName) {
  await page.locator('[data-package-id="tarpon"]').click();
  const form = page.locator("#sponsor-inquiry-form");
  await form.locator('[data-board-partner-preset="sponsor"]').click();
  await page.waitForFunction(() => {
    const target = document.querySelector("#sponsor-inquiry-form");
    return target?.querySelector(".partner-form-status")?.textContent?.trim() === "Synthetic details are ready. Contact consent remains unchecked."
      && Boolean(target.elements.contactEmail.value)
      && Boolean(target.elements.contactPhone.value);
  }, null, { timeout: timeoutMs });
  await form.locator('[name="organizationName"]').fill(organizationName);
  const email = await form.locator('[name="contactEmail"]').inputValue();
  const phone = await form.locator('[name="contactPhone"]').inputValue();
  if (!email.endsWith("@example.com") || phone !== "+13615550131") {
    throw new Error("Sponsor proof did not receive reserved synthetic contact details.");
  }
  if (await form.locator('[name="consentToContact"]').isChecked()) {
    throw new Error("Sponsor proof preset granted contact consent automatically.");
  }
  await form.locator('[name="consentToContact"]').check();
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/public/sponsor-inquiries"
      && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await form.locator('button[type="submit"]').click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => ({}));
  if (
    response.status() !== 201
    || payload.application?.type !== "sponsor"
    || !payload.application?.id
    || !payload.application?.reference
  ) {
    throw new Error(`Sponsor signup returned ${response.status()} without a valid application.`);
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
  }, { timeout: timeoutMs });
  await expect(page.locator(".partner-brand-center")).toContainText("Brand center");
  await expect(page.locator("[data-partner-deliverable]")).toHaveCount(6);
  return {
    id: payload.application.id,
    organizationName,
    reference: payload.application.reference,
    packageId: "tarpon"
  };
}

async function submitBrandKit(page, sponsor, runId) {
  const profileForm = page.locator("#partner-brand-profile-form");
  const profile = {
    displayName: sponsor.organizationName,
    website: `https://${runId}.sponsor.example`,
    tagline: "Stronger shores, brighter weekends",
    primaryColor: "#007A78",
    secondaryColor: "#F4C542"
  };
  await profileForm.locator('[name="displayName"]').fill(profile.displayName);
  await profileForm.locator('[name="website"]').fill(profile.website);
  await profileForm.locator('[name="tagline"]').fill(profile.tagline);
  await profileForm.locator('[name="primaryColor"]').fill(profile.primaryColor);
  await profileForm.locator('[name="secondaryColor"]').fill(profile.secondaryColor);
  await profileForm.locator('[name="usageNotes"]').fill("Use the full-color primary logo on light backgrounds with clear space around the mark.");
  await expect(page.locator("#partner-brand-preview [data-brand-preview-tagline]")).toHaveText(profile.tagline);
  const profileResponsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/public/partner-brand-profile"
      && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await profileForm.locator('button[type="submit"]').click();
  const profileResponse = await profileResponsePromise;
  const profilePayload = await profileResponse.json().catch(() => ({}));
  const submittedProfile = profilePayload.application?.branding?.profile;
  if (profileResponse.status() !== 200 || submittedProfile?.status !== "submitted") {
    throw new Error(`Sponsor brand profile returned ${profileResponse.status()} without submitted review work.`);
  }
  await expect(profileForm.locator('[data-status="submitted"]')).toHaveText("submitted");

  const logo = await readFile(SOURCE_LOGO);
  const fileName = `board-sponsor-brand-${runId}.png`;
  const assetForm = page.locator("#partner-brand-asset-form");
  await assetForm.locator('[name="kind"]').selectOption("primary_logo");
  await assetForm.locator('[name="label"]').fill("Primary board presentation logo");
  await assetForm.locator('[name="file"]').setInputFiles({
    name: fileName,
    mimeType: "image/png",
    buffer: logo
  });
  const assetResponsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/public/partner-brand-assets/upload"
      && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await assetForm.locator('button[type="submit"]').click();
  const assetResponse = await assetResponsePromise;
  const assetPayload = await assetResponse.json().catch(() => ({}));
  if (
    assetResponse.status() !== 201
    || assetPayload.asset?.status !== "submitted"
    || assetPayload.asset?.sourceType !== "upload"
    || !assetPayload.asset?.id
    || "storageKey" in (assetPayload.asset || {})
  ) {
    throw new Error(`Sponsor brand asset returned ${assetResponse.status()} without a privacy-safe submitted upload.`);
  }
  await expect(page.locator(`[data-partner-brand-asset="${assetPayload.asset.id}"] [data-status="submitted"]`)).toHaveText("submitted");
  return {
    profile: { ...profile, status: submittedProfile.status },
    asset: {
      id: assetPayload.asset.id,
      label: assetPayload.asset.label,
      status: assetPayload.asset.status,
      sourceType: assetPayload.asset.sourceType,
      fileName,
      sizeBytes: logo.length,
      checksumSha256: sha256(logo)
    },
    logo
  };
}

async function approveAndPublish(page, endpoints, sponsor, brandKit) {
  const operations = new URL(endpoints.operations);
  operations.hash = "admin-partners";
  await page.goto(operations.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForFunction(() => {
    const status = document.querySelector("#admin-api-status");
    return status?.dataset.workspaceState === "ready" && status.getAttribute("aria-busy") === "false";
  }, null, { timeout: timeoutMs });

  const applicationCard = () => page.locator("#admin-partner-applications [data-partner-application]")
    .filter({ hasText: sponsor.organizationName });
  await expect(applicationCard()).toHaveCount(1);
  await expect(applicationCard()).toContainText(sponsor.reference);
  const applicationResponsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/partners/applications/${sponsor.id}`
      && response.request().method() === "PATCH"
  ), { timeout: timeoutMs });
  await applicationCard().locator('[name="status"]').selectOption("approved");
  await applicationCard().locator("[data-save-application]").click();
  const applicationResponse = await applicationResponsePromise;
  if (applicationResponse.status() !== 200) {
    throw new Error(`Sponsor application approval returned ${applicationResponse.status()}.`);
  }

  const fulfillment = () => page.locator(`[data-sponsor-fulfillment="${sponsor.id}"]`);
  await expect(fulfillment()).toHaveCount(1);
  await expect(fulfillment()).toContainText("Tarpon");
  await expect(fulfillment().locator('[data-brand-profile] [data-status="submitted"]')).toHaveText("submitted");
  await expect(fulfillment().locator(`[data-admin-brand-asset="${brandKit.asset.id}"] [data-status="submitted"]`)).toHaveText("submitted");

  const profileResponsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/partners/applications/${sponsor.id}/brand-profile/review`
      && response.request().method() === "POST"
  ), { timeout: timeoutMs });
  await fulfillment().locator('[data-review-brand-profile="approve"]').click();
  const profileResponse = await profileResponsePromise;
  if (profileResponse.status() !== 200) {
    throw new Error(`Sponsor profile approval returned ${profileResponse.status()}.`);
  }
  await expect(fulfillment().locator('[data-brand-profile] [data-status="approved"]')).toHaveText("approved");

  const assetRow = () => fulfillment().locator(`[data-admin-brand-asset="${brandKit.asset.id}"]`);
  await assetRow().locator('[name="status"]').selectOption("approved");
  const assetResponsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === `/api/admin/partners/brand-assets/${brandKit.asset.id}`
      && response.request().method() === "PATCH"
  ), { timeout: timeoutMs });
  await assetRow().locator("[data-save-brand-asset]").click();
  const assetResponse = await assetResponsePromise;
  if (assetResponse.status() !== 200) {
    throw new Error(`Sponsor asset approval returned ${assetResponse.status()}.`);
  }
  await expect(assetRow().locator('[data-status="approved"]')).toHaveText("approved");

  const [partners, showcase] = await Promise.all([
    adminPartners(endpoints.apiBase),
    publicSponsors(endpoints.apiBase)
  ]);
  const application = partners.applications?.find(item => item.id === sponsor.id);
  const profile = partners.brandProfiles?.find(item => item.applicationId === sponsor.id);
  const asset = partners.brandAssets?.find(item => item.id === brandKit.asset.id);
  const publicSponsor = showcase.sponsors?.find(item => item.displayName === sponsor.organizationName);
  if (
    application?.status !== "approved"
    || profile?.status !== "approved"
    || asset?.status !== "approved"
    || publicSponsor?.packageId !== "tarpon"
    || publicSponsor?.tagline !== brandKit.profile.tagline
    || publicSponsor?.primaryColor !== brandKit.profile.primaryColor
    || publicSponsor?.secondaryColor !== brandKit.profile.secondaryColor
    || publicSponsor?.logo?.path !== `/api/public/sponsor-showcase/assets/${brandKit.asset.id}`
  ) {
    throw new Error("Approved sponsor branding did not publish through the public projection.");
  }
  if (/(applicationId|contactEmail|contactName|storageKey|checksumSha256|approvedBy|reviewNotes)/.test(JSON.stringify(publicSponsor))) {
    throw new Error("Public sponsor branding exposed private workflow data.");
  }

  const publicAssetResponse = await fetch(`${endpoints.apiBase}${publicSponsor.logo.path}`, {
    signal: AbortSignal.timeout(10_000)
  });
  const publicAsset = Buffer.from(await publicAssetResponse.arrayBuffer());
  if (
    !publicAssetResponse.ok
    || !String(publicAssetResponse.headers.get("content-type") || "").startsWith("image/png")
    || sha256(publicAsset) !== brandKit.asset.checksumSha256
  ) {
    throw new Error("Published sponsor logo did not match the approved private upload.");
  }

  const showcasePage = await page.context().newPage();
  const visitor = new URL(endpoints.visitor);
  visitor.hash = "sponsors";
  await showcasePage.goto(visitor.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const publicCard = showcasePage.locator("#public-sponsor-showcase .public-sponsor-card")
    .filter({ hasText: sponsor.organizationName });
  await expect(publicCard).toHaveCount(1);
  await expect(publicCard).toContainText("Tarpon partner");
  await expect(publicCard).toContainText(brandKit.profile.tagline);
  const logo = publicCard.locator("img");
  await expect(logo).toHaveAttribute("src", new RegExp(`/api/public/sponsor-showcase/assets/${brandKit.asset.id}$`));
  await expect.poll(() => logo.evaluate(image => image.complete && image.naturalWidth > 0), { timeout: timeoutMs }).toBe(true);
  await showcasePage.close();

  return {
    applicationStatus: application.status,
    profileStatus: profile.status,
    assetStatus: asset.status,
    packageId: publicSponsor.packageId,
    publicCard: publicSponsor.displayName,
    publicLogoPath: publicSponsor.logo.path,
    publicLogoChecksumSha256: sha256(publicAsset),
    privacySafe: true
  };
}

const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });
const runId = randomUUID().slice(0, 8);
const result = {
  ok: false,
  runId,
  sponsor: null,
  brandKit: null,
  publication: null,
  reset: null
};
let browser = null;
let resetRequired = false;
let workflowError = null;

try {
  log("\n=== Active board sponsor-branding proof ===\n");
  const report = preflight(sessionFile);
  let session = await readBoardDemoSession(sessionFile);
  let endpoints = activeSession(session, report);
  const initialSnapshot = await baselineSnapshot(endpoints.apiBase);
  if (!baselineMatches(initialSnapshot)) {
    log("Restoring the prepared sponsor-branding baseline before rehearsal...");
    result.reset = await resetBaseline(sessionFile, session);
    session = await readBoardDemoSession(sessionFile);
    endpoints = activeSession(session, preflight(sessionFile));
  }

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(endpoints.visitor, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForVisitor(page);

  resetRequired = true;
  result.sponsor = await submitSponsor(page, `Board Brand Partner ${runId}`);
  const brandKit = await submitBrandKit(page, result.sponsor, runId);
  result.brandKit = {
    profile: brandKit.profile,
    asset: brandKit.asset
  };
  result.publication = await approveAndPublish(page, endpoints, result.sponsor, brandKit);
  log("Verified sponsor intake, private brand-kit submission, Operations approval, public rendering, byte integrity, and privacy-safe projection.");
} catch (error) {
  workflowError = error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (resetRequired) {
    try {
      const session = await readBoardDemoSession(sessionFile);
      result.reset = await resetBaseline(sessionFile, session);
      log(`Restored the exact sponsor-branding baseline at ${result.reset.preflight} readiness.`);
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
  else console.error(`\nBoard sponsor-branding proof failed: ${workflowError.message}`);
  process.exitCode = 1;
} else {
  result.ok = true;
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("\nBoard sponsor-branding proof passed.");
    console.log(`Sponsor:     ${result.sponsor.reference} · ${result.sponsor.organizationName}`);
    console.log(`Brand kit:   profile ${result.publication.profileStatus} · asset ${result.publication.assetStatus}`);
    console.log(`Publication: ${result.publication.publicCard} · ${result.publication.packageId} · privacy safe`);
    console.log(`Integrity:   SHA-256 ${result.publication.publicLogoChecksumSha256}`);
    console.log(`Reset:       ${result.reset.applications} applications · ${result.reset.assets} assets · ${result.reset.preflight} ready`);
  }
}
