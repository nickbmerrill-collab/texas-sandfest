import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

async function assertNoAccessibilityViolations(page, label) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = results.violations.map(violation => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map(node => node.target.join(" "))
  }));
  expect(violations, `${label} must have no automated WCAG A/AA violations`).toEqual([]);
}

function presentationUploadCopy(buffer, comment) {
  const endOfDirectory = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOfDirectory < 0 || endOfDirectory + 22 > buffer.length) throw new Error("Presentation ZIP directory is invalid.");
  const originalLength = buffer.readUInt16LE(endOfDirectory + 20);
  if (endOfDirectory + 22 + originalLength !== buffer.length) throw new Error("Presentation ZIP comment is invalid.");
  const originalComment = buffer.subarray(endOfDirectory + 22);
  const addedComment = Buffer.from(comment, "ascii");
  const commentLength = originalComment.length + addedComment.length;
  if (commentLength > 65_535) throw new Error("Presentation ZIP comment is too long.");
  const copy = Buffer.concat([buffer.subarray(0, endOfDirectory + 22), originalComment, addedComment]);
  copy.writeUInt16LE(commentLength, endOfDirectory + 20);
  return copy;
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
    QB_ENVIRONMENT: "sandbox",
    QB_INVOICE_SYNC_ENABLED: "false",
    QB_CLIENT_ID: "board-browser-quickbooks-client",
    QB_CLIENT_SECRET: "board-browser-quickbooks-secret",
    QB_REDIRECT_URI: `${apiBase}/api/integrations/quickbooks/callback`,
    QB_TOKEN_ENCRYPTION_KEY: "board-browser-quickbooks-encryption-key-0123456789",
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
  await expect(page.locator("#experience")).toBeHidden();
  await expect(page.locator("#port-a")).toBeHidden();
  await expect(page.locator('header nav a[href="#port-a"]')).toBeHidden();
  await expect(page.locator("#media")).toContainText("Scenes from SandFest");
  await expect(page.locator(".map-media-section")).toContainText("See the beach corridor before you arrive.");
  await expect(page.locator("#media")).not.toContainText("Scraped frontend media");
  await expect(page.locator(".map-media-section")).not.toContainText("should become reviewed records");
  await expect(page.locator("#vendors-map")).not.toContainText("Seed data");
  await expect(page.locator("#booth-pin-count")).toContainText("booths");
  const vendorApplicationLink = page.locator('#vendors-map a[href="#vendor-application-form"]');
  await expect(vendorApplicationLink).toHaveText("Apply as a vendor");
  await vendorApplicationLink.click();
  await expect(page).toHaveURL(/#vendor-application-form$/);
  await expect(page.locator("#vendor-application-form")).toBeInViewport({ ratio: 0.1 });
  await expect(page.locator("#vendor-intake-label")).toHaveText("Vendor application");
  await expect(page.locator("#vendor-intake-submit")).toHaveText("Submit vendor application");
  await expect(page.locator("#vendor-intake-availability")).toContainText("Applications are open for this program");
  await expect(page.locator("#vendor-data-use-note")).toContainText("Do not submit payment card, bank, tax ID, or health information here.");
  await expect(page.locator("#sponsor-inquiry-form .partner-data-use-note")).toContainText("private partner status portal");
  const galleryImages = page.locator("#media .media-gallery img");
  await expect(galleryImages).toHaveCount(8);
  await expect.poll(() => galleryImages.evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  await expect.poll(() => galleryImages.evaluateAll(images => images.every(image => new URL(image.currentSrc).pathname.includes("/assets/sandfest-media/optimized/gallery-")))).toBe(true);
  await expect.poll(() => galleryImages.evaluateAll(images => images.every(image => image.alt && !/^DSC/i.test(image.alt)))).toBe(true);
  const sponsorPackageCards = page.locator("#public-sponsor-tiers [data-package-id]");
  await expect(sponsorPackageCards).toHaveCount(11);
  expect(await sponsorPackageCards.locator("strong").allTextContents()).toEqual([
    "Flounder",
    "Trout",
    "Tarpon",
    "Sailfish",
    "Marlin",
    "Shark",
    "VIP Tent Sponsor",
    "Whale",
    "Giant Squid",
    "Megalodon",
    "The Kraken"
  ]);
  await expect(page.locator('[data-package-id="marlin"] span')).toHaveText("$15,000 sponsorship");
  await expect(page.locator('[data-package-id="whale"] span')).toHaveText("$50,000 sponsorship");
  await expect(page.locator('[data-package-id="the-kraken"] span')).toHaveText("$250,000 sponsorship");
  await page.locator('[data-package-id="the-kraken"]').click();
  await expect(page.locator('#sponsor-inquiry-form [name="packageId"]')).toHaveValue("the-kraken");
  await expect(page.locator("#sponsor-package-summary")).toContainText("Presenting sponsor recognition");
  await expect(page.locator("#sponsor-package-summary")).toContainText("$250,000 sponsorship");
  const sponsorSubmitBox = await page.locator('#sponsor-inquiry-form button[type="submit"]').boundingBox();
  const vendorSubmitBox = await page.locator('#vendor-application-form button[type="submit"]').boundingBox();
  expect(sponsorSubmitBox?.height).toBeGreaterThanOrEqual(40);
  expect(sponsorSubmitBox?.height).toBeLessThanOrEqual(52);
  expect(vendorSubmitBox?.height).toBe(sponsorSubmitBox?.height);
  const featuredSponsor = page.locator("#public-sponsor-showcase .public-sponsor-card").filter({ hasText: "Gulf Shore Credit Union" });
  await expect(featuredSponsor).toHaveCount(1);
  await expect(featuredSponsor).toContainText("Marlin partner");
  await expect(featuredSponsor).toContainText("Rooted on the Texas coast");
  const featuredSponsorLogo = featuredSponsor.locator("img");
  await expect(featuredSponsorLogo).toHaveAttribute("src", /\/api\/public\/sponsor-showcase\/assets\/demo_brand_asset_gulf_shore_primary$/);
  await expect.poll(() => featuredSponsorLogo.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);

  const conciergeResponsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === apiBase && url.pathname === "/api/public/concierge" && response.request().method() === "POST";
  });
  await page.locator("#ask-input").fill("Where can I buy tickets?");
  await page.locator("#ask-submit").click();
  const conciergeResponse = await conciergeResponsePromise;
  expect(conciergeResponse.status()).toBe(200);
  const conciergePayload = await conciergeResponse.json();
  expect(conciergePayload.topic).toBe("tickets");
  await expect(page.locator("#chat .concierge-answer")).toHaveCount(1);
  await expect(page.locator("#chat .concierge-answer")).toContainText("Current ticket options include");
  await expect(page.locator('#chat .concierge-sources a[href="#tickets"]')).toHaveText("Current ticket options");
  await expect(page.locator("#ask-submit")).toBeEnabled();

  const vendorConciergeResponsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === apiBase && url.pathname === "/api/public/concierge" && response.request().method() === "POST";
  });
  await page.locator("#ask-input").fill("How do vendors apply?");
  await page.locator("#ask-submit").click();
  const vendorConciergeResponse = await vendorConciergeResponsePromise;
  expect(vendorConciergeResponse.status()).toBe(200);
  const vendorConciergePayload = await vendorConciergeResponse.json();
  expect(vendorConciergePayload.topic).toBe("vendor");
  expect(vendorConciergePayload.answer).toContain("vendor application");
  expect(vendorConciergePayload.answer).not.toContain("interest list");
  await expect(page.locator("#chat .concierge-answer")).toHaveCount(2);
  await expect(page.locator("#chat .concierge-answer").last()).toContainText("vendor application");
  await expect(page.locator("#ask-submit")).toBeEnabled();

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
  const freshVendorProfile = page.locator("#partner-vendor-profile-form");
  await expect(page.locator(".partner-vendor-center")).toContainText("0 / 5 requirements cleared");
  await expect(page.locator("[data-vendor-requirement]")).toHaveCount(5);
  await freshVendorProfile.locator('[name="legalName"]').fill(`${vendorName} LLC`);
  await freshVendorProfile.locator('[name="boothName"]').fill(vendorName);
  await freshVendorProfile.locator('[name="website"]').fill(`https://vendors.example.com/${runId}`);
  await freshVendorProfile.locator('[name="powerNeed"]').selectOption("20a");
  await freshVendorProfile.locator('[name="vehicleLengthFeet"]').fill("18");
  await freshVendorProfile.locator('[name="emergencyContactName"]').fill("Jordan Boardwalk");
  await freshVendorProfile.locator('[name="emergencyContactPhone"]').fill("361-555-0188");
  await freshVendorProfile.locator('[name="publicDescription"]').fill("Original coastal artwork made in Port Aransas and sold from a standard marketplace booth.");
  await freshVendorProfile.locator('[name="accessibilityNotes"]').fill("Keep the customer-facing aisle clear for mobility devices.");
  const vendorProfileResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-vendor-profile" && response.request().method() === "POST");
  await freshVendorProfile.locator('button[type="submit"]').click();
  expect((await vendorProfileResponse).status()).toBe(200);
  await expect(page.locator('#partner-vendor-profile-form [data-status="submitted"]')).toHaveText("submitted");
  await expect(page.locator("#partner-status-form .partner-form-status")).toContainText("Operating profile submitted for review.");

  for (let index = 0; index < 5; index += 1) {
    const requirementForm = page.locator("[data-submit-vendor-document]").first();
    await requirementForm.locator('[name="sourceUrl"]').fill(`https://documents.example.com/${runId}/requirement-${index + 1}.pdf`);
    const vendorDocumentResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-vendor-documents" && response.request().method() === "POST");
    await requirementForm.locator('button[type="submit"]').click();
    expect((await vendorDocumentResponse).status()).toBe(201);
    await expect(page.locator("[data-submit-vendor-document]")).toHaveCount(4 - index);
  }
  await expect(page.locator('[data-vendor-requirement] [data-status="submitted"]')).toHaveCount(5);
  await expect(page.locator("#partner-status-form .partner-form-status")).toContainText("Vendor document submitted for staff review.");

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
  const sponsorBrandProfile = page.locator("#partner-brand-profile-form");
  const sponsorBrandPreview = page.locator("#partner-brand-preview");
  await expect(sponsorBrandPreview.locator("[data-brand-preview-name]")).toHaveText(sponsorName);
  await expect(sponsorBrandPreview.locator("[data-brand-preview-tagline]")).toHaveText("Sponsor tagline");
  await sponsorBrandProfile.locator('[name="tagline"]').fill("Healthier coast, stronger community");
  await sponsorBrandProfile.locator('[name="primaryColor"]').fill("#0A6570");
  await sponsorBrandProfile.locator('[data-brand-color-picker="secondaryColor"]').fill("#F2C94C");
  await expect(sponsorBrandProfile.locator('[name="secondaryColor"]')).toHaveValue("#F2C94C");
  await expect(sponsorBrandPreview.locator("[data-brand-preview-tagline]")).toHaveText("Healthier coast, stronger community");
  await expect(sponsorBrandPreview).toHaveCSS("background-color", "rgb(10, 101, 112)");
  await expect(sponsorBrandPreview.locator('[data-brand-preview-color="secondary"]')).toHaveCSS("background-color", "rgb(242, 201, 76)");
  const sponsorBrandProfileResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-brand-profile" && response.request().method() === "POST");
  await sponsorBrandProfile.locator('button[type="submit"]').click();
  expect((await sponsorBrandProfileResponse).status()).toBe(200);
  await expect(page.locator("#partner-status-form .partner-form-status")).toContainText("Brand profile submitted for review.");
  await expect(page.locator('#partner-brand-profile-form [data-status="submitted"]')).toHaveText("submitted");
  await expect(page.locator("#partner-brand-preview")).toHaveAttribute("aria-label", new RegExp(`${sponsorName} brand preview.*#0A6570.*#F2C94C`));

  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-partners`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await expect(page).toHaveTitle("Texas SandFest Operations");
  await expect(page.locator("#network-status")).toHaveText("Demo");
  await expect(page.locator("#runtime-data-notice")).toContainText("Synthetic 2027 data");
  await expect(page.locator("#runtime-data-notice")).toContainText("No external messages or payments are sent");
  await expect(page.locator("#admin-reset-board-demo")).toBeHidden();
  await expect(page.locator("header nav")).toHaveCount(0);
  await expect(page.locator(".admin-workspace-nav")).toBeVisible();
  await expect(page.locator(".admin-api-bar")).toBeHidden();
  await expect(page.locator("#admin-config h1")).toHaveText("Festival operations command center");
  await expect(page.locator(".nav-cta")).toHaveAttribute("href", `${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
  await expect(page.locator("#admin-deployment-summary")).toContainText("development · ready");
  const commandSignals = page.locator("#admin-command-signals");
  await expect(commandSignals).toHaveAttribute("aria-busy", "false");
  await expect(commandSignals.locator("[data-command-signal]")).toHaveCount(8);
  await expect(commandSignals.locator('[data-command-signal="applications"]')).toContainText(/\d+ active/);
  await expect(commandSignals.locator('[data-command-signal="applications"]')).toContainText(/\d+ vendors/);
  await expect(commandSignals.locator('[data-command-signal="receivables"]')).toContainText("received of");
  await expect(commandSignals.locator('[data-command-signal="messages"]')).toContainText("Provider ready");
  await expect(commandSignals.locator('[data-command-signal="assignments"]')).toContainText("staff / volunteer / team");
  await expect(commandSignals.locator('[data-command-signal="key-dates"]')).toContainText("upcoming");
  await expect(commandSignals.locator('[data-command-signal="sponsors"]')).toContainText("assets approved");
  await expect(commandSignals.locator('[data-command-signal="vendors"]')).toContainText("blocked");
  await expect(commandSignals.locator('[data-command-signal="outreach"]')).toContainText("qualified");
  const partnerActivity = page.locator("#admin-partner-activity");
  const partnerActivityRows = partnerActivity.locator("[data-partner-activity]");
  expect(await partnerActivityRows.count()).toBeGreaterThanOrEqual(15);
  await expect(page.locator("#admin-partner-activity-summary")).toContainText("recorded events");
  for (const category of ["intake", "finance", "schedule", "messaging", "work", "branding", "vendor", "outreach"]) {
    await expect(partnerActivity.locator(`[data-category="${category}"]`).first()).toBeVisible();
  }
  await expect(partnerActivity).toContainText("Payment recorded");
  await expect(partnerActivity).toContainText("Invoice created");
  await expect(partnerActivity).toContainText("Partner message prepared");
  await expect(partnerActivity).toContainText(/assignment notices prepared/i);
  await expect(partnerActivity).toContainText("Brand profile approved");
  expect(await partnerActivity.textContent()).not.toMatch(/activity_|demo_[sv]app|followup_/);
  const deferredRecovery = page.locator('#admin-deployment-checks [data-board-stage="post-presentation"]');
  await expect(deferredRecovery).toHaveCount(1);
  await expect(deferredRecovery).toContainText("Post-board");
  await expect(deferredRecovery).toContainText("Backup and recovery");
  await expect(deferredRecovery).toContainText("Managed backup provisioning and provider restore drills are scheduled after the presentation.");
  await expect(deferredRecovery).toContainText("Isolated database and upload recovery verification remains in the release gate.");
  await expect(deferredRecovery).not.toContainText("configure a supported managed backup provider");
  await expect(commandSignals.locator('[data-command-signal="receivables"]')).toHaveAttribute("href", "#admin-receivables-accounts");
  await expect(commandSignals.locator('[data-command-signal="vendors"]')).toHaveAttribute("href", "#admin-vendor-readiness");
  await commandSignals.locator('[data-command-signal="vendors"]').click();
  await expect(page).toHaveURL(/#admin-vendor-readiness$/);
  await expect(page.locator("#admin-vendor-readiness")).toBeInViewport({ ratio: 0.1 });
  async function openPreparedPartnerPortal(organizationName) {
    const application = page.locator("#admin-partner-applications [data-partner-application]").filter({ hasText: organizationName });
    await expect(application).toHaveCount(1);
    const popupPromise = page.waitForEvent("popup");
    const rotationPromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === apiBase && /\/api\/admin\/partners\/applications\/[^/]+\/portal-access$/.test(url.pathname) && response.request().method() === "POST";
    });
    await application.locator("[data-open-demo-portal]").click();
    const [portal, rotation] = await Promise.all([popupPromise, rotationPromise]);
    expect(rotation.status()).toBe(200);
    await expect(portal.locator("#partner-status-result")).toContainText(organizationName);
    await expect(portal.locator("#partner-status")).toBeInViewport({ ratio: 0.1 });
    await expect.poll(() => portal.url()).not.toContain("token=");
    const sanitizedUrl = new URL(portal.url());
    expect(sanitizedUrl.hash).toBe("#partner-status");
    expect(sanitizedUrl.searchParams.get("apiBase")).toBe(apiBase);
    return portal;
  }

  const freshVendorAccount = () => page.locator(`#admin-vendor-readiness [data-admin-vendor="${vendorResult.application.id}"]`);
  await expect(freshVendorAccount()).toHaveCount(1);
  await expect(freshVendorAccount()).toHaveAttribute("data-status", "in_progress");
  await expect(freshVendorAccount()).toContainText("0/5 compliance");
  await expect(freshVendorAccount()).toContainText("submitted profile");
  const profileApprovalResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/applications/${vendorResult.application.id}/vendor-profile/review` && response.request().method() === "POST");
  await freshVendorAccount().locator('[data-review-vendor-profile="approve"]').click();
  expect((await profileApprovalResponse).status()).toBe(200);
  await expect(freshVendorAccount().locator('[data-admin-vendor-profile] [data-status="approved"]')).toHaveText("approved");

  const freshRequirementIds = await freshVendorAccount().locator("[data-admin-vendor-requirement]").evaluateAll(rows => rows.map(row => row.dataset.adminVendorRequirement));
  expect(freshRequirementIds).toHaveLength(5);
  for (const requirementId of freshRequirementIds) {
    const requirementRow = () => freshVendorAccount().locator(`[data-admin-vendor-requirement="${requirementId}"]`);
    await requirementRow().locator('[name="status"]').selectOption("approved");
    const requirementApprovalResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/vendor-requirements/${requirementId}` && response.request().method() === "PATCH");
    await requirementRow().locator("[data-save-vendor-requirement]").click();
    expect((await requirementApprovalResponse).status()).toBe(200);
    await expect(requirementRow().locator('header [data-status="approved"]')).toHaveText("approved");
  }
  await expect(freshVendorAccount()).toContainText("5/5 compliance");

  const freshVendorAssignment = () => freshVendorAccount().locator("[data-admin-vendor-assignment]");
  await freshVendorAssignment().locator('[name="status"]').selectOption("scheduled");
  await freshVendorAssignment().locator('[name="boothNumber"]').fill("A-27");
  await freshVendorAssignment().locator('[name="zone"]').fill("Artisan promenade");
  await freshVendorAssignment().locator('[name="accessGate"]').fill("South access gate");
  await freshVendorAssignment().locator('[name="loadInStart"]').fill("2027-04-16T08:00");
  await freshVendorAssignment().locator('[name="loadInEnd"]').fill("2027-04-16T09:00");
  await freshVendorAssignment().locator('[name="loadOutStart"]').fill("2027-04-18T18:00");
  await freshVendorAssignment().locator('[name="loadOutEnd"]').fill("2027-04-18T19:00");
  await freshVendorAssignment().locator('[name="parkingPasses"]').fill("1");
  await freshVendorAssignment().locator('[name="staffWristbands"]').fill("2");
  await freshVendorAssignment().locator('[name="instructions"]').fill("Stage at the south access gate 15 minutes before the assigned window.");
  const assignmentResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/applications/${vendorResult.application.id}/vendor-assignment` && response.request().method() === "PATCH");
  await freshVendorAssignment().locator("[data-save-vendor-assignment]").click();
  expect((await assignmentResponse).status()).toBe(200);
  await expect(freshVendorAccount()).toContainText("scheduled load-in");
  const vendorAssignmentMessage = page.locator("#admin-partner-followups [data-followup]").filter({ hasText: `Texas SandFest booth and load-in assignment - ${vendorResult.application.reference}` });
  await expect(vendorAssignmentMessage).toHaveCount(1);
  await expect(vendorAssignmentMessage).toContainText("draft ready");

  const freshVendorPortal = await openPreparedPartnerPortal(vendorName);
  await expect(freshVendorPortal.locator(".partner-vendor-center")).toContainText("5 / 5 requirements cleared");
  await expect(freshVendorPortal.locator(".partner-vendor-assignment")).toContainText("A-27");
  await expect(freshVendorPortal.locator(".partner-vendor-assignment")).toContainText("scheduled");
  const assignmentConfirmationResponse = freshVendorPortal.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-vendor-assignment/confirm" && response.request().method() === "POST");
  await freshVendorPortal.locator("#partner-confirm-vendor-assignment").click();
  expect((await assignmentConfirmationResponse).status()).toBe(200);
  await expect(freshVendorPortal.locator(".partner-vendor-assignment")).toContainText("confirmed");
  await freshVendorPortal.close();

  const refreshedPartners = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET");
  await page.locator("#admin-load-partners").click();
  await refreshedPartners;
  await expect(freshVendorAccount()).toHaveAttribute("data-status", "ready");
  await expect(freshVendorAccount()).toContainText("5/5 compliance");
  await expect(freshVendorAccount()).toContainText("approved profile");
  await expect(freshVendorAccount()).toContainText("confirmed load-in");
  await expect(vendorAssignmentMessage).toContainText("dismissed");

  const sponsorPortal = await openPreparedPartnerPortal("Gulf Shore Credit Union");
  await expect(sponsorPortal.locator(".partner-brand-center")).toContainText("Brand center");
  await expect(sponsorPortal.locator('#partner-brand-profile-form [name="tagline"]')).toHaveValue(/Rooted on the Texas coast/);
  await expect(sponsorPortal.locator("[data-partner-brand-asset]")).toHaveCount(2);
  await expect(sponsorPortal.locator("[data-partner-deliverable]")).toHaveCount(6);
  await sponsorPortal.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow(sponsorPortal);
  await assertNoAccessibilityViolations(sponsorPortal, "prepared sponsor portal");
  await sponsorPortal.close();

  const vendorPortal = await openPreparedPartnerPortal("Coastal Bites");
  await expect(vendorPortal.locator(".partner-vendor-center")).toContainText("7 / 7 requirements cleared");
  await expect(vendorPortal.locator(".partner-vendor-assignment")).toContainText("F-14");
  await expect(vendorPortal.locator(".partner-vendor-assignment")).toContainText("confirmed");
  await expect(vendorPortal.locator("[data-vendor-requirement]")).toHaveCount(7);
  await vendorPortal.close();
  await expect(page.locator("#admin-quickbooks-connection")).toBeVisible();
  await expect(page.locator("#admin-quickbooks-connection")).toHaveAttribute("data-state", "deferred");
  await expect(page.locator("#admin-quickbooks-status")).toContainText("deferred until post-presentation setup");
  await expect(page.locator("#admin-quickbooks-status")).toContainText("invoices, payments, aging, and reconciliation remain active");
  await expect(page.locator("#admin-connect-quickbooks")).toBeHidden();
  await expect(page.locator("#admin-refresh-quickbooks")).toBeEnabled();
  await expect(page.locator("#admin-disconnect-quickbooks")).toBeHidden();
  const launchTaskSyncResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/deployment/tasks/sync" && response.request().method() === "POST");
  await page.locator("#admin-sync-deployment-tasks").click();
  const launchTaskSyncResult = await launchTaskSyncResponse;
  expect(launchTaskSyncResult.status()).toBe(200);
  expect((await launchTaskSyncResult.json()).sync.created).toBe(1);
  const backupLaunchTask = page.locator("#admin-partner-tasks .admin-task-card").filter({ hasText: "[Launch] Backup and recovery" });
  await expect(backupLaunchTask).toHaveCount(1);
  await expect(backupLaunchTask).toContainText("Operations team");
  await expect(backupLaunchTask).toContainText("high priority");
  const launchTaskReplayResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/deployment/tasks/sync" && response.request().method() === "POST");
  await page.locator("#admin-sync-deployment-tasks").click();
  const launchTaskReplayResult = await launchTaskReplayResponse;
  expect((await launchTaskReplayResult.json()).sync.changed).toBe(false);
  await expect(backupLaunchTask).toHaveCount(1);
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
  await vendorOfferingForm.locator('[name="intakeMode"]').selectOption("application");
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
  const presentation = await readFile(path.join(ROOT, "docs", "presentations", "SandFest-Board-Platform-Briefing.pptx"));
  await documentUploadForm.locator('[name="file"]').setInputFiles({
    name: "SandFest-Board-Platform-Briefing.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: presentationUploadCopy(presentation, `browser-${runId}`)
  });
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

  const sponsorApprovalResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/applications/${sponsorResult.application.id}` && response.request().method() === "PATCH");
  await sponsorCard.locator('[name="status"]').selectOption("approved");
  await sponsorCard.locator("[data-save-application]").click();
  expect((await sponsorApprovalResponse).status()).toBe(200);
  await expect(sponsorCard.locator("[data-create-invoice]")).toBeVisible();

  const invoiceCreateResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/applications/${sponsorResult.application.id}/invoices` && response.request().method() === "POST");
  await sponsorCard.locator("[data-create-invoice]").click();
  const createdInvoiceResponse = await invoiceCreateResponse;
  expect(createdInvoiceResponse.status()).toBe(201);
  const createdInvoice = (await createdInvoiceResponse.json()).invoice;
  const sponsorInvoice = sponsorCard.locator(`[data-partner-invoice="${createdInvoice.id}"]`);
  await expect(sponsorInvoice.locator('[data-action="approve"]')).toBeVisible();

  const invoiceApprovalResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/invoices/${createdInvoice.id}/review` && response.request().method() === "POST");
  await sponsorInvoice.locator('[data-action="approve"]').click();
  expect((await invoiceApprovalResponse).status()).toBe(200);
  await expect(sponsorCard.locator(`[data-partner-invoice="${createdInvoice.id}"]`)).toContainText("approved");

  await sponsorCard.locator('[name="paymentAmount"]').fill("5000.00");
  await sponsorCard.locator('[data-record-payment]').click();
  await expect(page.locator("#admin-api-status")).toContainText("Enter a receipt or transaction reference");
  await expect(sponsorCard.locator("[data-partner-payment]")).toHaveCount(0);

  const paymentReference = `BROWSER-CHECK-${runId}`;
  await sponsorCard.locator('[name="paymentReference"]').fill(paymentReference);
  await sponsorCard.locator('[name="paymentReceivedAt"]').fill("2027-03-01T10:00");
  const paymentResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/applications/${sponsorResult.application.id}/payments` && response.request().method() === "POST");
  await sponsorCard.locator('[data-record-payment]').click();
  const recordedPaymentResponse = await paymentResponse;
  expect(recordedPaymentResponse.status()).toBe(201);
  const recordedPayment = (await recordedPaymentResponse.json()).payment;
  await expect(sponsorCard).toContainText("$5,000.00 / $5,000.00");
  await expect(sponsorCard.locator(`[data-partner-invoice="${createdInvoice.id}"]`)).toContainText("$0.00 open");
  const paymentRow = sponsorCard.locator(`[data-partner-payment="${recordedPayment.id}"]`);
  await expect(paymentRow).toContainText(paymentReference);
  const sponsorPaymentMilestone = page.locator("#admin-partner-milestones [data-admin-milestone]").filter({ hasText: sponsorName }).filter({ hasText: "Payment due" });
  await expect(sponsorPaymentMilestone.locator('[name="status"]')).toHaveValue("completed");

  await paymentRow.locator('[name="reversalAction"]').selectOption("void");
  await paymentRow.locator('[name="reversalReason"]').fill("Browser acceptance reversal");
  const paymentReversalResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/payments/${recordedPayment.id}/reverse` && response.request().method() === "POST");
  await paymentRow.locator("[data-reverse-payment]").click();
  expect((await paymentReversalResponse).status()).toBe(200);
  await expect(sponsorCard).toContainText("$0.00 / $5,000.00");
  await expect(sponsorCard.locator(`[data-partner-invoice="${createdInvoice.id}"]`)).toContainText("$5,000.00 open");
  await expect(sponsorCard.locator(`[data-partner-payment="${recordedPayment.id}"]`)).toContainText("voided");
  await expect(sponsorPaymentMilestone.locator('[name="status"]')).toHaveValue("open");

  const sponsorFulfillment = page.locator('#admin-sponsor-fulfillment [data-sponsor-fulfillment]').filter({ hasText: "Gulf Shore Credit Union" });
  await expect(sponsorFulfillment).toHaveCount(1);
  await expect(sponsorFulfillment).toContainText("Marlin");
  await expect(sponsorFulfillment).toContainText("Rooted on the Texas coast");
  await expect(sponsorFulfillment.locator("[data-admin-brand-asset]")).toHaveCount(2);
  await expect(sponsorFulfillment.locator("[data-admin-deliverable]")).toHaveCount(6);
  await expect(sponsorFulfillment).toContainText("Logo on the mid-tier of Logo Mountain");

  const staffImportCsv = `staff_id,event_id,name,work_email,status,role,team,notification_team
staff_operations,${DEFAULT_EVENT_ID},Jamie Torres,jamie.torres@staff.example,active,ops_admin,operations,operations
staff_sponsor,${DEFAULT_EVENT_ID},Morgan Ellis,morgan.ellis@staff.example,active,sponsor_admin,sponsor,sponsor
staff_finance,${DEFAULT_EVENT_ID},Riley Chen,riley.chen@staff.example,active,finance_admin,finance,finance
staff_volunteers,${DEFAULT_EVENT_ID},Casey Patel,casey.patel@staff.example,active,volunteer_captain,volunteer-captains,volunteer-captains
staff_traffic,${DEFAULT_EVENT_ID},Avery Brooks,avery.brooks@staff.example,on_call,traffic_lead,traffic,traffic
staff_guest_services,${DEFAULT_EVENT_ID},Taylor Nguyen,taylor.nguyen@staff.example,active,guest_services_lead,guest-services,guest-services
staff_production,${DEFAULT_EVENT_ID},Jordan Davis,jordan.davis@staff.example,active,production_lead,production,production`;
  const staffImportForm = page.locator("#admin-import-staff");
  await staffImportForm.locator('[name="file"]').setInputFiles({
    name: "staff-directory-browser.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(staffImportCsv, "utf8")
  });
  await staffImportForm.locator('[name="currentEventConfirmed"]').check();
  const staffPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/staff-directory/import" && response.request().method() === "POST");
  await staffImportForm.locator('button[type="submit"]').click();
  expect((await staffPreviewResponse).status()).toBe(200);
  await expect(page.locator("#admin-staff-import-result")).toContainText("7/7");
  await expect(page.locator("#admin-commit-staff-import")).toBeEnabled();
  const staffCommitResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/staff-directory/import" && response.request().method() === "POST");
  await page.locator("#admin-commit-staff-import").click();
  expect((await staffCommitResponse).status()).toBe(201);
  await expect(page.locator("#admin-api-status")).toContainText("Activated 7 staff and 7 notification routes.");
  await expect(page.locator("#admin-staff-directory-status")).toContainText("manual_verified");

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
  const createdProspectResponse = await prospectResponse;
  expect(createdProspectResponse.status()).toBe(201);
  const createdProspect = (await createdProspectResponse.json()).prospect;
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

  const prospectCard = page.locator(`[data-outreach-prospect="${createdProspect.id}"]`);
  await expect(prospectCard).toContainText("Ready for an invited sponsor application");
  await prospectCard.locator('[name="sponsorPackageId"]').selectOption(sponsorTierId);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("Clipboard denied for acceptance coverage."); } }
    });
  });
  const invitationPath = `/api/admin/outreach/prospects/${createdProspect.id}/sponsor-invitation`;
  const invitationIssueResponse = page.waitForResponse(response => new URL(response.url()).pathname === invitationPath && response.request().method() === "POST");
  await prospectCard.locator('[data-sponsor-invitation-action="issue"]').click();
  const issuedInvitationResponse = await invitationIssueResponse;
  expect(issuedInvitationResponse.status()).toBe(200);
  const issuedInvitation = (await issuedInvitationResponse.json()).invitation;
  expect(issuedInvitation.packageId).toBe(sponsorTierId);
  expect(issuedInvitation.url).toContain("#sponsor-invitation?token=");
  await expect(page.locator("#admin-api-status")).toContainText("Sponsor invitation issued. Use Open invitation or Copy link.");
  await expect(prospectCard.locator('[data-sponsor-invitation-action="open"]')).toBeVisible();

  const invitationPopup = page.waitForEvent("popup");
  await prospectCard.locator('[data-sponsor-invitation-action="open"]').click();
  const invitationPage = await invitationPopup;
  await expect(invitationPage.locator("#sponsor-invitation")).toBeVisible();
  await expect(invitationPage.locator("#sponsor-invitation-copy")).toContainText(prospectName);
  await expect(invitationPage.locator("#sponsor-invitation-copy")).toContainText(`Community Champion ${runId}`);
  await expect(invitationPage).toHaveURL(/#sponsors$/);
  const invitedSponsorForm = invitationPage.locator("#sponsor-inquiry-form");
  await expect(invitedSponsorForm.locator('[name="organizationName"]')).toHaveValue(prospectName);
  await expect(invitedSponsorForm.locator('[name="organizationName"]')).toHaveAttribute("readonly", "");
  await expect(invitedSponsorForm.locator('[name="contactEmail"]')).toHaveValue(prospectRecipient);
  await expect(invitedSponsorForm.locator('[name="contactEmail"]')).toHaveAttribute("readonly", "");
  await expect(invitedSponsorForm.locator('[name="packageId"]')).toHaveValue(sponsorTierId);
  await expect(invitedSponsorForm.locator('[name="packageId"]')).toBeDisabled();
  await expect(invitationPage.locator("#sponsor-package-summary")).toContainText("$7,500 sponsorship");
  await invitedSponsorForm.locator('[name="description"]').fill("A hospitality partnership connecting island visitors with the SandFest community.");
  await invitedSponsorForm.locator('[name="consentToContact"]').check();
  const invitedSponsorResult = await submitAndCapture(invitationPage, invitedSponsorForm, "/api/public/sponsor-inquiries");
  expect(invitedSponsorResult.outreachConversion).toBe(true);
  await expect(invitationPage.locator("#partner-status-result")).toContainText(prospectName);
  await expect(invitationPage.locator('#partner-status-form [name="reference"]')).toHaveValue(invitedSponsorResult.application.reference);
  await expect(invitationPage.locator("#partner-brand-profile-form")).toBeVisible();
  await invitationPage.close();

  const convertedReload = Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET"),
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach" && response.request().method() === "GET")
  ]);
  await page.locator("#admin-load-partners").click();
  await convertedReload;
  await expect(prospectCard).toContainText(`Linked to ${invitedSponsorResult.application.reference}`);
  await expect(prospectCard.locator("[data-sponsor-invitation-action]")).toHaveCount(0);
  const convertedApplication = page.locator("#admin-partner-applications [data-partner-application]").filter({ hasText: prospectName });
  await expect(convertedApplication).toHaveCount(1);
  await expect(convertedApplication).toContainText(`Community Champion ${runId}`);
  await expect(convertedApplication).toContainText("$0.00 / $7,500.00");
  await expect(page.locator("#admin-partner-activity")).toContainText("Sponsor target converted");

  const automationForm = page.locator("#admin-partner-automation");
  await automationForm.locator('[name="mode"]').selectOption("transactional_auto");
  page.once("dialog", dialog => dialog.accept());
  const automationResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners/automation" && response.request().method() === "PATCH");
  await automationForm.locator('button[type="submit"]').click();
  expect((await automationResponse).status()).toBe(200);
  await expect(page.locator("#admin-api-status")).toContainText("Transactional partner automation is active.");

  const sponsorRecipient = `riley.${runId}@example.com`;
  const sponsorAcknowledgmentSubject = `Texas SandFest sponsorship application ${sponsorResult.application.reference}`;
  let deliveredSponsorAcknowledgmentId = null;
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const acknowledgment = payload.followups?.find(item => item.applicationId === sponsorResult.application.id
      && item.kind === "application_received"
      && item.recipient === sponsorRecipient
      && item.subject === sponsorAcknowledgmentSubject
      && item.automationPolicy === "partner_transactional_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered");
    deliveredSponsorAcknowledgmentId = acknowledgment?.id || null;
    return Boolean(deliveredSponsorAcknowledgmentId);
  }, { timeout: 15_000 }).toBe(true);
  const reloadPartners = Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET"),
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach" && response.request().method() === "GET")
  ]);
  await page.locator("#admin-load-partners").click();
  await reloadPartners;
  const deliveredFollowup = page.locator(`#admin-partner-followups [data-followup="${deliveredSponsorAcknowledgmentId}"]`);
  await expect(deliveredFollowup).toHaveCount(1);
  await expect(deliveredFollowup).toHaveAttribute("data-delivery-status", "delivered");
  await expect(deliveredFollowup).toContainText(sponsorRecipient);
  await expect(deliveredFollowup).toContainText(sponsorAcknowledgmentSubject);
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
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#island-conditions`);
  await expect(page.locator("#refresh-island-conditions")).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#vendors-map`);
  await expect(page.locator("#vendors-map")).toBeInViewport({ ratio: 0.1 });
  await expect(page.locator("#vendors-map .booth-apply-link")).toBeVisible();
  await expect(page.locator("#vendors-map .booth-apply-link")).toBeInViewport();
  await page.locator("#vendors-map .booth-apply-link").click();
  await expect(page).toHaveURL(/#vendor-application-form$/);
  await expect(page.locator("#vendor-application-form")).toBeInViewport({ ratio: 0.1 });
  await assertNoHorizontalOverflow(page);

  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  await expect(page.locator("#vendor-application-form")).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-partners`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await expect(page.locator("#admin-command-signals [data-command-signal]")).toHaveCount(8);
  await expect(page.locator("#admin-create-task")).toBeVisible();
  await expect(page.locator("#admin-import-staff")).toBeVisible();
  await expect(page.locator("#admin-quickbooks-connection")).toBeVisible();
  await expect(page.locator("#admin-quickbooks-status")).toContainText("deferred until post-presentation setup");
  const workspaceNav = page.locator(".admin-workspace-nav");
  const workspaceLinks = workspaceNav.locator("a");
  await expect(workspaceLinks).toHaveCount(7);
  await expect(workspaceLinks).toHaveText([
    "Overview",
    "Documents",
    "Partners",
    "Accounting",
    "Staffing",
    "Island conditions",
    "Systems"
  ]);
  await expect.poll(() => workspaceNav.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  for (const link of await workspaceLinks.all()) await expect(link).toBeInViewport();
  await workspaceNav.getByRole("link", { name: "Island conditions", exact: true }).click();
  await expect(page).toHaveURL(/#admin-island-conditions$/);
  await expect.poll(() => page.evaluate(() => {
    const nav = document.querySelector(".admin-workspace-nav");
    const target = document.querySelector("#admin-island-conditions");
    return Boolean(nav && target && target.getBoundingClientRect().top >= nav.getBoundingClientRect().bottom - 1);
  })).toBe(true);
  await assertNoHorizontalOverflow(page);
});

test("WCAG A and AA checks cover public intake, partner status, concierge, and operations", async ({ page }) => {
  const runId = randomUUID().slice(0, 8);
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  await expect(page.locator("#vendor-application-form")).toBeVisible();
  await expect(page.locator("#chat")).toHaveAttribute("tabindex", "0");
  await expect(page.locator("#booth-list")).toHaveAttribute("tabindex", "0");
  await assertNoAccessibilityViolations(page, "Visitor and partner intake surface");

  const conciergeResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/concierge" && response.request().method() === "POST");
  await page.locator("#ask-input").fill("What accessibility services are available?");
  await page.locator("#ask-submit").click();
  const accessibilityResponse = await conciergeResponse;
  expect(accessibilityResponse.status()).toBe(200);
  const accessibilityPayload = await accessibilityResponse.json();
  expect(accessibilityPayload.topic).toBe("accessibility");
  expect(accessibilityPayload.confidence).toBe("high");
  expect(accessibilityPayload.escalated).toBe(false);
  expect(accessibilityPayload.answer).toContain("North Gate at marker 12.5");
  expect(accessibilityPayload.answer).toContain("ADA parking");
  expect(accessibilityPayload.answer).not.toContain(".).");
  await expect(page.locator("#chat .concierge-answer")).toHaveCount(1);
  await expect(page.locator("#chat .concierge-answer")).toContainText("North Gate at marker 12.5");
  await expect(page.locator('#chat .concierge-sources a[href="#operations"]')).toHaveText("Published accessibility locations");

  const parkingResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/concierge" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Is parking information available?" }).click();
  const parkingResponse = await parkingResponsePromise;
  expect(parkingResponse.status()).toBe(200);
  const parkingPayload = await parkingResponse.json();
  expect(parkingPayload.topic).toBe("parking");
  expect(parkingPayload.confidence).toBe("medium");
  expect(parkingPayload.escalated).toBe(true);
  expect(parkingPayload.answer).toContain("North Gate at marker 12.5");
  expect(parkingPayload.answer).toContain("South Entrance at marker Access Road 1A");
  await expect(page.locator("#chat .concierge-answer")).toHaveCount(2);
  await expect(page.locator("#chat .concierge-answer").last()).toContainText("South Entrance at marker Access Road 1A");
  await expect(page.locator('#chat .concierge-sources a[href="#operations"]').last()).toHaveText("Published parking and shuttle locations");

  const vendor = page.locator("#vendor-application-form");
  await vendor.locator('[name="organizationName"]').fill(`Accessible Boardwalk Arts ${runId}`);
  await vendor.locator('[name="contactName"]').fill("Taylor Access");
  await vendor.locator('[name="contactEmail"]').fill(`taylor.${runId}@example.com`);
  await vendor.locator('[name="category"]').selectOption("artisan");
  await vendor.locator('[name="vendorOfferingId"]').selectOption("marketplace-booth");
  await vendor.locator('[name="city"]').fill("Port Aransas");
  await vendor.locator('[name="description"]').fill("Locally made art with an accessible booth layout.");
  await vendor.locator('[name="consentToContact"]').check();
  await submitAndCapture(page, vendor, "/api/public/vendor-applications");
  await expect(page.locator("#partner-status-result")).toContainText(`Accessible Boardwalk Arts ${runId}`);
  await assertNoAccessibilityViolations(page, "Concierge response and private partner status");

  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-partners`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await expect(page.locator("#admin-partner-applications [data-partner-application]")).not.toHaveCount(0);
  const keyboardRegionIds = [
    "admin-fleet-assets",
    "admin-fleet-open",
    "admin-volunteers-zones",
    "admin-volunteers-gaps",
    "admin-sms-campaigns",
    "admin-passport-checkpoints",
    "admin-incidents",
    "admin-partner-milestones",
    "admin-receivables-accounts",
    "admin-receivables-exceptions",
    "admin-partner-applications",
    "admin-partner-followups",
    "admin-outreach-campaigns",
    "admin-outreach-prospects",
    "admin-condition-cameras"
  ];
  for (const id of keyboardRegionIds) {
    await expect(page.locator(`#${id}`)).toHaveAttribute("tabindex", "0");
    await expect(page.locator(`#${id}`)).toHaveAttribute("aria-label", /\S/);
  }
  const documentPreview = page.locator(".admin-document-preview").first();
  await expect(documentPreview).toHaveCount(1);
  await documentPreview.locator("summary").click();
  await expect(documentPreview.locator("pre")).toHaveAttribute("tabindex", "0");

  const outreachImport = page.locator("#admin-import-prospects");
  await outreachImport.locator('[name="csv"]').fill("business_name,industry,city,state,zip,email\nNeeds Review,banking,Corpus Christi,TX,invalid,review@example.com");
  const outreachPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/prospects/import" && response.request().method() === "POST");
  await outreachImport.locator('button[type="submit"]').click();
  expect((await outreachPreviewResponse).status()).toBe(200);
  await expect(page.locator("#admin-outreach-import-result ul")).toHaveAttribute("tabindex", "0");

  const discoveryPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/discovery/preview" && response.request().method() === "POST");
  await page.locator('#admin-discover-businesses button[type="submit"]').click();
  expect((await discoveryPreviewResponse).status()).toBe(200);
  await expect(page.locator(".admin-discovery-candidates")).toHaveAttribute("tabindex", "0");
  const discoveryCategoryTargets = page.locator('#admin-discover-businesses input[name="categories"]');
  for (let index = 0; index < await discoveryCategoryTargets.count(); index += 1) {
    const targetBox = await discoveryCategoryTargets.nth(index).boundingBox();
    expect(targetBox?.width).toBeGreaterThanOrEqual(24);
    expect(targetBox?.height).toBeGreaterThanOrEqual(24);
  }
  await assertNoAccessibilityViolations(page, "Operations workspace");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  await expect(page.locator("#vendor-application-form")).toBeVisible();
  await assertNoAccessibilityViolations(page, "Mobile visitor and partner intake surface");
});
