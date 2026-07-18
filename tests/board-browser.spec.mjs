import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareBoardRuntime } from "../lib/board-runtime.mjs";
import { DEFAULT_EVENT_ID } from "../lib/event-context.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "board-browser-admin-token-0123456789abcdef";
const PORTAL_SECRET = "board-browser-portal-secret-0123456789abcdef";
const OUTREACH_SECRET = "board-browser-outreach-secret-0123456789abcdef";
const EMAIL_API_KEY = "board-browser-email-api-key-0123456789abcdef";
const EMAIL_WEBHOOK_TOKEN = "board-browser-email-webhook-token-0123456789abcdef";
let temporaryRoot;
let apiProcess;
let webProcess;
let emailProcess;
let workerProcess;
let apiBase;
let webBase;

test.describe.configure({ mode: "serial" });

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function startNodeProcess(label, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const append = chunk => {
    output = `${output}${String(chunk)}`.slice(-20_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.output = () => output;
  child.label = label;
  return child;
}

async function waitForHttp(url, child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`${child.label} exited ${child.exitCode}:\n${child.output()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${child.label} did not become ready at ${url}:\n${child.output()}`);
}

async function waitForJson(url, predicate, child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`${child.label} exited ${child.exitCode}:\n${child.output()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      const value = response.ok ? await response.json() : null;
      if (value && predicate(value)) return value;
    } catch {
      // The service state is still converging.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${child.label} did not reach the expected state at ${url}:\n${child.output()}`);
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5_000))]);
  if (child.exitCode == null) child.kill("SIGKILL");
}

async function submitAndCapture(page, form, pathname) {
  const responsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === apiBase && url.pathname === pathname && response.request().method() === "POST";
  });
  await form.locator('button[type="submit"]').click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  return response.json();
}

async function assertNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test.beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "sandfest-board-browser-"));
  const runtimeRoot = path.join(temporaryRoot, "runtime");
  await prepareBoardRuntime({
    sourceRoot: ROOT,
    targetRoot: runtimeRoot,
    eventId: DEFAULT_EVENT_ID,
    replace: true
  });

  const [apiPort, webPort, emailPort] = await Promise.all([freePort(), freePort(), freePort()]);
  apiBase = `http://127.0.0.1:${apiPort}`;
  webBase = `http://127.0.0.1:${webPort}`;
  const emailBase = `http://127.0.0.1:${emailPort}`;
  const emailEnvironment = {
    TRANSACTIONAL_EMAIL_ENABLED: "true",
    BREVO_API_KEY: EMAIL_API_KEY,
    BREVO_SENDER_EMAIL: "sandbox@texassandfest.example",
    BREVO_SENDER_NAME: "Texas SandFest Browser Acceptance",
    BREVO_REPLY_TO_EMAIL: "reply@texassandfest.example",
    BREVO_WEBHOOK_TOKEN: EMAIL_WEBHOOK_TOKEN,
    BREVO_API_ENDPOINT: `${emailBase}/v3/smtp/email`
  };
  emailProcess = startNodeProcess("Board browser email sandbox", ["scripts/board-email-sandbox.mjs"], {
    SANDFEST_ENV: "development",
    SANDFEST_BOARD_EMAIL_SANDBOX: "true",
    SANDFEST_BOARD_EMAIL_PORT: String(emailPort),
    SANDFEST_BOARD_EMAIL_DELIVERY_DELAY_MS: "10",
    BOARD_BREVO_API_KEY: EMAIL_API_KEY,
    BREVO_WEBHOOK_TOKEN: EMAIL_WEBHOOK_TOKEN,
    SANDFEST_BOARD_EMAIL_WEBHOOK_URL: `${apiBase}/api/webhooks/brevo`
  });
  await waitForHttp(`${emailBase}/health`, emailProcess);
  apiProcess = startNodeProcess("Board browser API", ["scripts/admin-api-server.mjs"], {
    SANDFEST_RUNTIME_ROOT: runtimeRoot,
    SANDFEST_INCOMING_DOCUMENT_DIR: path.join(runtimeRoot, "private", "incoming-documents"),
    SANDFEST_DATABASE_URL: "",
    SANDFEST_ENV: "development",
    SANDFEST_EVENT_ID: DEFAULT_EVENT_ID,
    SANDFEST_API_PORT: String(apiPort),
    SANDFEST_API_PUBLIC_BASE_URL: apiBase,
    SANDFEST_PUBLIC_SITE_URL: webBase,
    SANDFEST_ADMIN_BASE_URL: webBase,
    SANDFEST_CORS_ORIGINS: `https://www.texassandfest.org,https://texassandfest.org,${webBase}`,
    SANDFEST_ADMIN_API_TOKEN: TOKEN,
    SANDFEST_ADMIN_ROLE: "super_admin",
    SANDFEST_ADMIN_ACTOR_ID: "board-browser-acceptance",
    SANDFEST_ADMIN_RATE_LIMIT: "1000",
    SANDFEST_PUBLIC_RATE_LIMIT: "2000",
    SANDFEST_PARTNER_PORTAL_SECRET: PORTAL_SECRET,
    SANDFEST_OUTREACH_PREFERENCES_SECRET: OUTREACH_SECRET,
    SANDFEST_TURNSTILE_ENABLED: "false",
    OUTREACH_DISCOVERY_ENABLED: "true",
    OUTREACH_DISCOVERY_PROVIDER: "fixture",
    ...emailEnvironment,
    SMS_ENABLED: "false",
    CAMERA_INGEST_ENABLED: "false"
  });
  await waitForHttp(`${apiBase}/health`, apiProcess);

  workerProcess = startNodeProcess("Board browser worker", ["scripts/worker.mjs"], {
    SANDFEST_RUNTIME_ROOT: runtimeRoot,
    SANDFEST_INCOMING_DOCUMENT_DIR: path.join(runtimeRoot, "private", "incoming-documents"),
    SANDFEST_DATABASE_URL: "",
    SANDFEST_ENV: "development",
    SANDFEST_EVENT_ID: DEFAULT_EVENT_ID,
    SANDFEST_PUBLIC_SITE_URL: webBase,
    SANDFEST_API_PUBLIC_BASE_URL: apiBase,
    SANDFEST_PARTNER_PORTAL_SECRET: PORTAL_SECRET,
    SANDFEST_OUTREACH_PREFERENCES_SECRET: OUTREACH_SECRET,
    SANDFEST_WORKER_POLL_MS: "100",
    ...emailEnvironment,
    SMS_ENABLED: "false"
  });
  await waitForJson(`${apiBase}/ready`, value => value.checks?.workerStatus?.healthy === true, workerProcess);

  const viteEntrypoint = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  webProcess = startNodeProcess("Board browser web", [
    viteEntrypoint,
    "--host", "127.0.0.1",
    "--port", String(webPort),
    "--strictPort"
  ], {
    SANDFEST_BOARD_DEMO_ADMIN_TOKEN: TOKEN
  });
  await waitForHttp(`${webBase}/`, webProcess);
});

test.afterAll(async () => {
  await stopChild(workerProcess);
  await stopChild(webProcess);
  await stopChild(apiProcess);
  await stopChild(emailProcess);
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test("board workflows operate through the public and staff interfaces", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const runId = randomUUID().slice(0, 8);
  const vendorName = `Browser Boardwalk Arts ${runId}`;
  const sponsorName = `Browser Coastal Health ${runId}`;
  const taskTitle = `Browser volunteer welcome desk ${runId}`;
  const milestoneLabel = `Browser sponsor artwork due ${runId}`;
  const prospectName = `Browser Port A Hospitality ${runId}`;
  const prospectIndustry = `browser hospitality ${runId}`;
  const prospectRecipient = `morgan.${runId}@example.com`;
  const campaignName = `Browser geofenced partners ${runId}`;
  const sponsorTierId = `community-champion-${runId}`;
  const vendorOfferingId = `premium-marketplace-${runId}`;
  const documentTitle = `Board extraction ${runId}`;

  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  await expect(page.locator("#network-status")).toHaveText("Demo");
  await expect(page.locator("#public-sponsor-tiers [data-package-id]")).toHaveCount(4);

  const vendor = page.locator("#vendor-application-form");
  await expect(vendor).toBeVisible();
  await vendor.locator('[name="organizationName"]').fill(vendorName);
  await vendor.locator('[name="contactName"]').fill("Casey Browser");
  await vendor.locator('[name="contactEmail"]').fill(`casey.${runId}@example.com`);
  await vendor.locator('[name="category"]').selectOption("artisan");
  await expect(vendor.locator('[name="vendorOfferingId"] option[value="marketplace-booth"]')).toHaveCount(1);
  await vendor.locator('[name="vendorOfferingId"]').selectOption("marketplace-booth");
  await vendor.locator('[name="city"]').fill("Port Aransas");
  await vendor.locator('[name="description"]').fill("Locally made beach art and one standard marketplace booth.");
  await vendor.locator('[name="consentToContact"]').check();
  const vendorResult = await submitAndCapture(page, vendor, "/api/public/vendor-applications");
  await expect(vendor.locator(".partner-form-status")).toContainText("Application received.");
  await expect(page.locator("#partner-status-result")).toContainText(vendorName);
  await expect(page.locator('#partner-status-form [name="reference"]')).toHaveValue(vendorResult.application.reference);

  await page.locator('[data-package-id="tarpon"]').click();
  const sponsor = page.locator("#sponsor-inquiry-form");
  await sponsor.locator('[name="organizationName"]').fill(sponsorName);
  await sponsor.locator('[name="contactName"]').fill("Riley Browser");
  await sponsor.locator('[name="contactEmail"]').fill(`riley.${runId}@example.com`);
  await sponsor.locator('[name="description"]').fill("Community health partner with a beach activation and digital logo placement.");
  await sponsor.locator('[name="consentToContact"]').check();
  const sponsorResult = await submitAndCapture(page, sponsor, "/api/public/sponsor-inquiries");
  await expect(sponsor.locator(".partner-form-status")).toContainText("Application received.");
  await expect(page.locator("#partner-status-result")).toContainText(sponsorName);
  await expect(page.locator('#partner-status-form [name="reference"]')).toHaveValue(sponsorResult.application.reference);

  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-partners`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await expect(page.locator("#admin-deployment-summary")).toContainText("development · ready");
  const sponsorTierForm = page.locator("#admin-create-sponsor-package");
  await sponsorTierForm.locator('[name="name"]').fill(`Community Champion ${runId}`);
  await sponsorTierForm.locator('[name="id"]').fill(sponsorTierId);
  await sponsorTierForm.locator('[name="amount"]').fill("7500.00");
  await sponsorTierForm.locator('[name="benefits"]').fill("Community stage recognition\nPublic sponsor showcase");
  const sponsorTierResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/sponsor-packages" && response.request().method() === "POST");
  await sponsorTierForm.locator('button[type="submit"]').click();
  const sponsorTierCreateResponse = await sponsorTierResponse;
  expect(sponsorTierCreateResponse.status()).toBe(201);
  expect((await sponsorTierCreateResponse.json()).sponsorPackage.publicLabel).toBe("$7,500 sponsorship");
  await expect(page.locator("#admin-api-status")).toContainText("Added Community Champion");
  await expect(page.locator(`[data-admin-sponsor="${sponsorTierId}"]`)).toContainText("$7,500.00");
  const vendorOfferingForm = page.locator("#admin-create-vendor-offering");
  await vendorOfferingForm.locator('[name="name"]').fill(`Premium marketplace ${runId}`);
  await vendorOfferingForm.locator('[name="id"]').fill(vendorOfferingId);
  await vendorOfferingForm.locator('[name="amount"]').fill("2500.00");
  await vendorOfferingForm.locator('[name="categories"][value="retail"]').check();
  await vendorOfferingForm.locator('[name="categories"][value="artisan"]').check();
  await vendorOfferingForm.locator('[name="description"]').fill("Expanded marketplace booth for larger retail and artisan activations.");
  await vendorOfferingForm.locator('[name="inclusions"]').fill("Expanded booth footprint\nPublished booth listing");
  const vendorOfferingResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/vendor-offerings" && response.request().method() === "POST");
  await vendorOfferingForm.locator('button[type="submit"]').click();
  const vendorOfferingCreateResponse = await vendorOfferingResponse;
  expect(vendorOfferingCreateResponse.status()).toBe(201);
  expect((await vendorOfferingCreateResponse.json()).vendorOffering.publicLabel).toBe("$2,500 application fee");
  await expect(page.locator("#admin-api-status")).toContainText("Added Premium marketplace");
  await expect(page.locator(`[data-admin-vendor-offering="${vendorOfferingId}"]`)).toContainText("$2,500.00");
  const documentUploadForm = page.locator("#admin-document-upload");
  await documentUploadForm.locator('[name="file"]').setInputFiles(path.join(ROOT, "docs", "presentations", "SandFest-Board-Platform-Briefing.pptx"));
  await documentUploadForm.locator('[name="title"]').fill(documentTitle);
  const documentUploadResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/documents/upload" && response.request().method() === "POST");
  await documentUploadForm.locator('button[type="submit"]').click();
  const documentUploadResult = await documentUploadResponse;
  expect(documentUploadResult.status()).toBe(201);
  await expect(page.locator("#admin-document-upload-status")).toContainText("queued for private text extraction");
  const uploadedDocumentCard = page.locator("[data-admin-document]").filter({ hasText: documentTitle });
  await expect(uploadedDocumentCard).toHaveCount(1);
  const uploadedDocumentId = await uploadedDocumentCard.getAttribute("data-admin-document");
  expect(uploadedDocumentId).toBeTruthy();
  await expect.poll(async () => page.evaluate(async ({ apiBase, token, documentId }) => {
    const response = await fetch(`${apiBase}/api/admin/documents?limit=200`, { headers: { authorization: `Bearer ${token}` } });
    const payload = await response.json();
    return payload.documents?.find(item => item.id === documentId)?.extractionStatus;
  }, { apiBase, token: TOKEN, documentId: uploadedDocumentId }), { timeout: 15_000 }).toBe("ready");
  await page.locator("#admin-load-documents").click();
  const extractedDocumentCard = page.locator(`[data-admin-document="${uploadedDocumentId}"]`);
  await expect(extractedDocumentCard).toContainText("Extraction ready");
  await expect(extractedDocumentCard).toContainText("5,507 characters");
  await extractedDocumentCard.locator(".admin-document-preview summary").click();
  await expect(extractedDocumentCard.locator(".admin-document-preview pre")).toContainText("TEXAS SANDFEST");
  const vendorCard = page.locator("#admin-partner-applications [data-partner-application]").filter({ hasText: vendorName });
  const sponsorCard = page.locator("#admin-partner-applications [data-partner-application]").filter({ hasText: sponsorName });
  await expect(vendorCard).toHaveCount(1);
  await expect(vendorCard).toContainText("$0.00 / $1,250.00");
  await expect(sponsorCard).toHaveCount(1);
  await expect(sponsorCard).toContainText("$0.00 / $5,000.00");

  const sponsorFulfillment = page.locator('#admin-sponsor-fulfillment [data-sponsor-fulfillment]').filter({ hasText: "Gulf Shore Credit Union" });
  await expect(sponsorFulfillment).toHaveCount(1);
  await expect(sponsorFulfillment).toContainText("Marlin");
  await expect(sponsorFulfillment).toContainText("Rooted on the Texas coast");
  await expect(sponsorFulfillment.locator("[data-admin-brand-asset]")).toHaveCount(1);
  await expect(sponsorFulfillment.locator("[data-admin-deliverable]")).toHaveCount(3);
  await expect(sponsorFulfillment).toContainText("Beach signage");

  const discoveryForm = page.locator("#admin-discover-businesses");
  await expect(page.locator("#admin-outreach-discovery-readiness")).toHaveText("fixture ready");
  const discoveryPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/discovery/preview" && response.request().method() === "POST");
  await discoveryForm.locator('button[type="submit"]').click();
  expect((await discoveryPreviewResponse).status()).toBe(200);
  await expect(page.locator("#admin-outreach-discovery-result")).toContainText("Seabreeze Resort");
  const discoveredBusiness = discoveryForm.locator('input[name="discoveredSourceRef"][value="fixture/business/seabreeze-resort"]');
  await expect(discoveredBusiness).toHaveCount(1);
  await discoveredBusiness.check();
  const discoveryImportResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/discovery/import" && response.request().method() === "POST");
  await page.locator("#admin-import-discovered-businesses").click();
  expect((await discoveryImportResponse).status()).toBe(201);
  await expect(page.locator("#admin-api-status")).toContainText("Imported 1 business candidate; contact research remains required.");
  await expect(page.locator("#admin-outreach-prospects")).toContainText("Seabreeze Resort");

  const taskForm = page.locator("#admin-create-task");
  await taskForm.locator('[name="assigneeType"]').selectOption("volunteer");
  const taskOwner = taskForm.locator('[name="assigneeId"]');
  await expect.poll(async () => taskOwner.locator("option").count()).toBeGreaterThan(0);
  const volunteerId = await taskOwner.locator("option").first().getAttribute("value");
  expect(volunteerId).toBeTruthy();
  await taskOwner.selectOption(volunteerId);
  await taskForm.locator('[name="title"]').fill(taskTitle);
  await taskForm.locator('[name="priority"]').selectOption("high");
  await taskForm.locator('[name="description"]').fill("Welcome arriving volunteers and route them to their assigned captain.");
  const taskResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners/tasks" && response.request().method() === "POST");
  await taskForm.locator('button[type="submit"]').click();
  expect((await taskResponse).status()).toBe(201);
  await expect(page.locator("#admin-api-status")).toContainText("Task delegated.");
  await expect(page.locator("#admin-partner-tasks")).toContainText(taskTitle);

  const milestoneForm = page.locator("#admin-create-milestone");
  await milestoneForm.locator('[name="applicationId"]').selectOption(sponsorResult.application.id);
  await milestoneForm.locator('[name="label"]').fill(milestoneLabel);
  await milestoneForm.locator('[name="dueAt"]').fill("2027-03-15T10:00");
  await milestoneForm.locator('[name="assigneeTeam"]').selectOption("sponsor");
  const milestonePath = `/api/admin/partners/applications/${sponsorResult.application.id}/milestones`;
  const milestoneResponse = page.waitForResponse(response => new URL(response.url()).pathname === milestonePath && response.request().method() === "POST");
  await milestoneForm.locator('button[type="submit"]').click();
  expect((await milestoneResponse).status()).toBe(201);
  await expect(page.locator("#admin-partner-milestones")).toContainText(milestoneLabel);

  const prospectForm = page.locator("#admin-create-prospect");
  await prospectForm.locator('[name="organizationName"]').fill(prospectName);
  await prospectForm.locator('[name="contactName"]').fill("Morgan Browser");
  await prospectForm.locator('[name="industry"]').fill(prospectIndustry);
  await prospectForm.locator('[name="city"]').fill("Port Aransas");
  await prospectForm.locator('[name="postalCode"]').fill("78373");
  await prospectForm.locator('[name="latitude"]').fill("27.8339");
  await prospectForm.locator('[name="longitude"]').fill("-97.0611");
  await prospectForm.locator('[name="contactEmail"]').fill(prospectRecipient);
  await prospectForm.locator('[name="communityFit"]').check();
  await prospectForm.locator('[name="contactBasis"]').selectOption("business_relevance");
  await prospectForm.locator('[name="status"]').selectOption("contact_ready");
  const prospectResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/prospects" && response.request().method() === "POST");
  await prospectForm.locator('button[type="submit"]').click();
  expect((await prospectResponse).status()).toBe(201);
  await expect(page.locator("#admin-api-status")).toContainText(`Scored ${prospectName} at`);
  await expect(page.locator("#admin-outreach-prospects")).toContainText(prospectName);

  const campaignForm = page.locator("#admin-create-campaign");
  await campaignForm.locator('[name="name"]').fill(campaignName);
  await campaignForm.locator('[name="objective"]').fill("Introduce a reviewed sponsor invitation to one qualified Port Aransas business.");
  await campaignForm.locator('[name="industries"]').fill(prospectIndustry);
  await campaignForm.locator('[name="cities"]').fill("Port Aransas");
  await campaignForm.locator('[name="postalCodes"]').fill("78373");
  await campaignForm.locator('[name="centerLatitude"]').fill("27.8339");
  await campaignForm.locator('[name="centerLongitude"]').fill("-97.0611");
  await campaignForm.locator('[name="radiusMiles"]').fill("5");
  await campaignForm.locator('[name="minFitScore"]').fill("0");
  await campaignForm.locator('[name="deliveryMode"]').selectOption("approved_sequence");
  await campaignForm.locator('[name="dailySendLimit"]').fill("3");
  const campaignResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/campaigns" && response.request().method() === "POST");
  await campaignForm.locator('button[type="submit"]').click();
  const createdCampaignResponse = await campaignResponse;
  expect(createdCampaignResponse.status()).toBe(201);
  const createdCampaign = (await createdCampaignResponse.json()).campaign;
  const campaignCard = page.locator(`[data-outreach-campaign="${createdCampaign.id}"]`);
  await expect(campaignCard).toContainText(campaignName);
  await expect(campaignCard).toContainText("1 matched");
  await expect(campaignCard).toContainText("campaign-approved, 3/day");
  page.once("dialog", dialog => dialog.accept());
  await campaignCard.locator('[data-campaign-action="activate"]').click();
  await expect(page.locator("#admin-api-status")).toContainText("Campaign activated with 1 due message eligible for bounded automation.");

  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/outreach`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    return payload.followups?.some(item => item.campaignId === createdCampaign.id
      && item.recipient === prospectRecipient
      && item.automationPolicy === "outreach_campaign_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered") || false;
  }, { timeout: 15_000 }).toBe(true);
  const reloadOutreach = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach" && response.request().method() === "GET");
  await page.locator("#admin-load-partners").click();
  await reloadOutreach;
  const deliveredCampaignMessage = page.locator('#admin-partner-followups [data-delivery-status="delivered"]').filter({ hasText: prospectRecipient });
  await expect(deliveredCampaignMessage).toHaveCount(1);
  await expect(deliveredCampaignMessage).toContainText("campaign-approved automation");

  const automationForm = page.locator("#admin-partner-automation");
  await automationForm.locator('[name="mode"]').selectOption("transactional_auto");
  page.once("dialog", dialog => dialog.accept());
  const automationResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners/automation" && response.request().method() === "PATCH");
  await automationForm.locator('button[type="submit"]').click();
  expect((await automationResponse).status()).toBe(200);
  await expect(page.locator("#admin-api-status")).toContainText("Transactional partner automation is active.");

  const sponsorRecipient = `riley.${runId}@example.com`;
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    return payload.followups?.some(item => item.recipient === sponsorRecipient
      && item.automationPolicy === "partner_transactional_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered") || false;
  }, { timeout: 15_000 }).toBe(true);
  const reloadPartners = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET");
  await page.locator("#admin-load-partners").click();
  await reloadPartners;
  const deliveredFollowup = page.locator('#admin-partner-followups [data-delivery-status="delivered"]')
    .filter({ hasText: sponsorRecipient })
    .filter({ hasText: `Texas SandFest sponsorship application ${sponsorResult.application.reference}` });
  await expect(deliveredFollowup).toHaveCount(1);
  await expect(deliveredFollowup).toContainText("transactional automation");

  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#island-conditions`);
  await expect(page.locator(`[data-package-id="${sponsorTierId}"]`)).toContainText("Community Champion");
  await page.locator(`[data-package-id="${sponsorTierId}"]`).click();
  await expect(page.locator('#sponsor-inquiry-form [name="packageId"]')).toHaveValue(sponsorTierId);
  const publicVendorForm = page.locator("#vendor-application-form");
  await publicVendorForm.locator('[name="category"]').selectOption("artisan");
  await expect(publicVendorForm.locator(`[name="vendorOfferingId"] option[value="${vendorOfferingId}"]`)).toContainText("Premium marketplace");
  await publicVendorForm.locator('[name="vendorOfferingId"]').selectOption(vendorOfferingId);
  await expect(publicVendorForm.locator('[name="vendorOfferingId"]')).toHaveValue(vendorOfferingId);
  await expect(page.locator("#island-camera-grid article")).toHaveCount(8);
  await expect(page.locator("#island-condition-updated")).not.toHaveText("Checking sources");
  expect(pageErrors).toEqual([]);
});

test("critical public and operations views fit a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  await expect(page.locator("#vendor-application-form")).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-partners`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await expect(page.locator("#admin-create-task")).toBeVisible();
  await assertNoHorizontalOverflow(page);
});
