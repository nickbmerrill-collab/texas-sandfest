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
import { taskPortalConfig, taskPortalUrlForTask } from "../lib/task-portal.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "board-browser-admin-token-0123456789abcdef";
const PORTAL_SECRET = "board-browser-portal-secret-0123456789abcdef";
const OUTREACH_SECRET = "board-browser-outreach-secret-0123456789abcdef";
const EMAIL_API_KEY = "board-browser-email-api-key-0123456789abcdef";
const EMAIL_WEBHOOK_TOKEN = "board-browser-email-webhook-token-0123456789abcdef";
const BOARD_TICKET_SECRET = "board-browser-ticket-secret-0123456789abcdef";
const SMS_ACCOUNT_SID = "AC00000000000000000000000000000001";
const SMS_AUTH_TOKEN = "board-browser-twilio-auth-token-0123456789";
const SMS_FROM_NUMBER = "+13615550100";
let temporaryRoot;
let apiProcess;
let webProcess;
let emailProcess;
let smsProcess;
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
  const dimensions = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll("body *")].map(element => {
      const rect = element.getBoundingClientRect();
      return {
        element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.classList.length ? `.${[...element.classList].slice(0, 3).join(".")}` : ""}`,
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        text: String(element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)
      };
    }).filter(item => item.right > clientWidth + 1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 8);
    return { clientWidth, scrollWidth: document.documentElement.scrollWidth, offenders };
  });
  expect(dimensions.scrollWidth, JSON.stringify(dimensions.offenders, null, 2)).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function assertChoiceTargets(page, label) {
  const issues = await page.locator('input[type="checkbox"], input[type="radio"]').evaluateAll(inputs => inputs.filter(input => {
    const bounds = input.getBoundingClientRect();
    const styles = getComputedStyle(input);
    return bounds.width > 0 && bounds.height > 0 && styles.display !== "none" && styles.visibility !== "hidden";
  }).map(input => {
    const enclosingLabel = input.closest("label");
    const externalLabel = !enclosingLabel && input.id
      ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
      : null;
    const target = enclosingLabel || externalLabel || input;
    const bounds = target.getBoundingClientRect();
    return {
      label: input.getAttribute("aria-label") || target.textContent?.trim() || input.name || input.id || input.type,
      width: Math.round(bounds.width * 10) / 10,
      height: Math.round(bounds.height * 10) / 10
    };
  }).filter(target => target.width < 24 || target.height < 24));
  expect(issues, `${label} choice controls must expose a 24px pointer target`).toEqual([]);
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

async function assertAnchorClearsWorkspaceNav(page, selector, minimumGap = 0) {
  await expect.poll(() => page.evaluate(({ selector, minimumGap }) => {
    const nav = document.querySelector(".admin-workspace-nav");
    const target = document.querySelector(selector);
    return Boolean(nav && target && target.getBoundingClientRect().top >= nav.getBoundingClientRect().bottom + minimumGap);
  }, { selector, minimumGap })).toBe(true);
}

async function assertTargetClearsTopbar(page, selector, minimumGap = 0, maximumGap = 48) {
  const targetHasSafeGap = () => page.evaluate(({ selector, minimumGap, maximumGap }) => {
    const topbar = document.querySelector(".topbar");
    const target = document.querySelector(selector);
    if (!topbar || !target) return false;
    const notice = document.querySelector("#runtime-data-notice");
    const obstructionBottom = Math.max(
      topbar.getBoundingClientRect().bottom,
      notice && getComputedStyle(notice).position === "sticky" ? notice.getBoundingClientRect().bottom : 0
    );
    const gap = target.getBoundingClientRect().top - obstructionBottom;
    return gap >= minimumGap && gap <= maximumGap;
  }, { selector, minimumGap, maximumGap });
  await expect.poll(targetHasSafeGap).toBe(true);
  await page.waitForTimeout(1_750);
  expect(await targetHasSafeGap()).toBe(true);
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

  const [apiPort, webPort, emailPort, smsPort] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
  apiBase = `http://127.0.0.1:${apiPort}`;
  webBase = `http://127.0.0.1:${webPort}`;
  const emailBase = `http://127.0.0.1:${emailPort}`;
  const smsBase = `http://127.0.0.1:${smsPort}`;
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
  const smsEnvironment = {
    SMS_ENABLED: "true",
    TWILIO_ACCOUNT_SID: SMS_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: SMS_AUTH_TOKEN,
    TWILIO_FROM_NUMBER: SMS_FROM_NUMBER,
    TWILIO_API_BASE_URL: smsBase,
    TWILIO_STATUS_CALLBACK_URL: `${apiBase}/api/webhooks/twilio/status`,
    TWILIO_SAFETY_INBOUND_WEBHOOK_URL: `${apiBase}/api/webhooks/twilio/inbound/smsSafety`
  };
  smsProcess = startNodeProcess("Board browser SMS sandbox", ["scripts/board-sms-sandbox.mjs"], {
    SANDFEST_ENV: "development",
    SANDFEST_BOARD_SMS_SANDBOX: "true",
    SANDFEST_BOARD_SMS_PORT: String(smsPort),
    SANDFEST_BOARD_SMS_DELIVERY_DELAY_MS: "10",
    BOARD_TWILIO_ACCOUNT_SID: SMS_ACCOUNT_SID,
    BOARD_TWILIO_AUTH_TOKEN: SMS_AUTH_TOKEN,
    BOARD_TWILIO_FROM_NUMBER: SMS_FROM_NUMBER,
    SANDFEST_BOARD_SMS_INBOUND_WEBHOOK_URL: `${apiBase}/api/webhooks/twilio/inbound/smsSafety`
  });
  await waitForHttp(`${smsBase}/health`, smsProcess);
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
    SANDFEST_BOARD_TICKET_SANDBOX: "true",
    SANDFEST_BOARD_TICKET_SECRET: BOARD_TICKET_SECRET,
    QB_ENVIRONMENT: "sandbox",
    QB_INVOICE_SYNC_ENABLED: "false",
    QB_CLIENT_ID: "board-browser-quickbooks-client",
    QB_CLIENT_SECRET: "board-browser-quickbooks-secret",
    QB_REDIRECT_URI: `${apiBase}/api/integrations/quickbooks/callback`,
    QB_TOKEN_ENCRYPTION_KEY: "board-browser-quickbooks-encryption-key-0123456789",
    ...emailEnvironment,
    ...smsEnvironment,
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
    ...smsEnvironment
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
  await stopChild(smsProcess);
  await stopChild(emailProcess);
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test("board workflows operate through the public and staff interfaces", async ({ page }) => {
  test.setTimeout(150_000);
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const runId = randomUUID().slice(0, 8);
  const vendorName = "Port A Coastal Makers";
  const sponsorName = "Coastal Community Bank";
  const taskTitle = `Browser volunteer welcome desk ${runId}`;
  const milestoneLabel = `Browser sponsor artwork due ${runId}`;
  const milestoneDueInput = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16);
  const prospectName = `Browser Port A Hospitality ${runId}`;
  const prospectIndustry = `browser hospitality ${runId}`;
  const prospectRecipient = `morgan.${runId}@example.com`;
  const campaignName = `Browser geofenced partners ${runId}`;
  const sponsorTierId = `community-champion-${runId}`;
  const vendorOfferingId = `premium-marketplace-${runId}`;
  const documentTitle = `Board extraction ${runId}`;
  const settlementReference = `browser_square_merch_${runId}`;
  const settlementFileName = `square-browser-${runId}.csv`;
  const budgetLineName = `Browser hospitality ${runId}`;
  const budgetVendorName = `Browser Guest Services ${runId}`;
  const settlementCsv = `transaction_id,date,category,gross_amount,fee_amount,net_amount,quantity,payout_id,payout_date,reconciled,entry_type
${settlementReference},2027-03-02,merch,325.00,9.75,315.25,5,square_payout_${runId},2027-03-03,yes,receipt`;

  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  await expect(page.locator("#network-status")).toHaveText("Demo");
  await expect(page.locator("#mobile-nav-toggle")).toBeHidden();
  await expect(page.locator("#public-navigation")).toBeVisible();
  await expect(page.locator("#experience")).toBeHidden();
  await expect(page.locator("#port-a")).toBeHidden();
  await expect(page.locator('header nav a[href="#port-a"]')).toBeHidden();
  const operationsSurface = page.locator("[data-operations-surface]");
  await expect(operationsSurface).toHaveAttribute("href", `${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await expect(operationsSurface).not.toHaveAttribute("target", /.+/);
  await expect(page.locator('[data-site-mode="public"]')).toHaveAttribute("aria-current", "page");
  const operationsHandoff = page.locator("[data-operations-handoff]");
  await expect(operationsHandoff).toHaveAttribute("href", `${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await expect(operationsHandoff).toHaveAttribute("target", "_blank");
  const operationsPagePromise = page.context().waitForEvent("page");
  await operationsHandoff.click();
  const operationsPage = await operationsPagePromise;
  await operationsPage.waitForLoadState("domcontentloaded");
  await expect(operationsPage).toHaveURL(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await expect(operationsPage.locator("#network-status")).toHaveText("Demo");
  await expect(operationsPage.locator("#admin-api-status")).toContainText("Loaded");
  await expect(operationsPage.locator("#admin-command-signals")).toHaveAttribute("aria-busy", "false");
  await expect(operationsPage.locator("#admin-command-signals [data-command-signal]")).toHaveCount(8);
  await operationsPage.close();
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
  await expect(page.locator("#vendor-intake-availability")).toContainText("Applications open");
  await expect(page.locator("#vendor-data-use-note")).toContainText("Do not submit payment card, bank, tax ID, or health information here.");
  await expect(page.locator("#sponsor-inquiry-form .partner-data-use-note")).toContainText("private partner status portal");
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor&vendorOffering=marketplace-booth&vendorCategory=artisan#vendor-application-form`);
  const openingHandoffForm = page.locator("#vendor-application-form");
  await expect(openingHandoffForm).toBeInViewport({ ratio: 0.1 });
  await expect(openingHandoffForm.locator('[name="category"]')).toHaveValue("artisan");
  await expect(openingHandoffForm.locator('[name="vendorOfferingId"]')).toHaveValue("marketplace-booth");
  await expect(openingHandoffForm.locator('[name="organizationName"]')).toHaveValue("");
  await expect(openingHandoffForm.locator('[name="contactName"]')).toHaveValue("");
  await expect(openingHandoffForm.locator('[name="contactEmail"]')).toHaveValue("");
  await expect(openingHandoffForm.locator('[name="consentToContact"]')).not.toBeChecked();
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
  await expect(page.locator('[data-package-id="flounder"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-package-id="flounder"] [data-package-action]')).toHaveText("Selected");
  await expect(page.locator('[data-package-id="the-kraken"] [data-package-action]')).toHaveText("Choose tier");
  await page.locator('[data-package-id="the-kraken"]').click();
  await expect(page).toHaveURL(/#sponsor-inquiry-form$/);
  await expect(page.locator('#sponsor-inquiry-form [name="packageId"]')).toHaveValue("the-kraken");
  await expect(page.locator('#sponsor-inquiry-form [name="packageId"]')).toBeFocused();
  await assertTargetClearsTopbar(page, "#sponsor-inquiry-form", 12);
  await expect(page.locator('#sponsor-inquiry-form [name="packageId"]')).toHaveAttribute("aria-describedby", "sponsor-package-summary");
  await expect(page.locator('[data-package-id="flounder"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-package-id="flounder"] [data-package-action]')).toHaveText("Choose tier");
  await expect(page.locator('[data-package-id="the-kraken"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-package-id="the-kraken"] [data-package-action]')).toHaveText("Selected");
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

  await expect(page.locator("#ticketing-status-pill")).toHaveText("Local payment sandbox");
  await expect(page.locator("#ticketing-copy")).toContainText("No external charge is sent");
  const ticketPolicy = page.locator("#ticket-policy-fieldset");
  await expect(ticketPolicy).toBeVisible();
  await expect(ticketPolicy.locator("#ticket-policy-summary")).toHaveText("Review demonstration policies");
  await ticketPolicy.locator("#ticket-policy-summary").click();
  await expect(ticketPolicy.locator("[data-ticket-policy-notice]")).toHaveCount(4);
  await expect(ticketPolicy).toContainText("Demonstration refund policy");
  await expect(ticketPolicy.locator("#ticket-policy-label")).toContainText("demonstration ticket terms");
  const sponsorTicketRequest = page.locator('[data-ticket-request="sponsor-package-request"]');
  await expect(sponsorTicketRequest).toHaveText("Request review");
  await sponsorTicketRequest.click();
  await expect(page).toHaveURL(/#sponsor-inquiry-form$/);
  await expect(page.locator("#checkout-status")).toContainText("partnership form below");
  await expect(page.locator('#sponsor-inquiry-form [name="organizationName"]')).toBeFocused();
  await assertTargetClearsTopbar(page, "#sponsor-inquiry-form", 12);
  const demoGaCard = page.locator(".ticket-card").filter({ has: page.locator('[data-ticket-id="general-admission-3-day"]') });
  await expect(demoGaCard).toContainText("$30.00 demo");
  await expect(demoGaCard).toContainText("Demo checkout");
  await demoGaCard.locator('[data-ticket-action="increase"]').click();
  await demoGaCard.locator('[data-ticket-action="increase"]').click();
  await expect(page.locator("#ticket-subtotal")).toHaveText("$60.00");
  await expect(page.locator("#checkout-btn")).toBeDisabled();
  await ticketPolicy.locator("#ticket-policy-acceptance").check();
  await expect(page.locator("#checkout-btn")).toBeEnabled();
  const ticketBuyerEmail = `tickets.${runId}@example.com`;
  await page.locator("#checkout-email").fill(ticketBuyerEmail);
  const ticketCheckoutResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/stripe/create-checkout-session" && response.request().method() === "POST");
  await page.locator("#checkout-btn").click();
  const ticketCheckoutResult = await ticketCheckoutResponse;
  expect(ticketCheckoutResult.status()).toBe(200);
  expect(ticketCheckoutResult.request().postDataJSON().policyAcceptance).toMatchObject({
    accepted: true,
    version: "board-demo-2027-v1"
  });
  const ticketCheckout = await ticketCheckoutResult.json();
  expect(ticketCheckout.demoCheckout).toMatchObject({
    mode: "board_sandbox",
    amountCents: 6000,
    currency: "usd",
    completeEndpoint: "/api/public/board-ticket-checkout/complete"
  });
  expect(ticketCheckout.demoCheckout.lineItems).toHaveLength(1);
  expect(ticketCheckout.demoCheckout.lineItems[0]).toMatchObject({ productId: "general-admission-3-day", quantity: 2, unitAmount: 3000 });
  const demoTicketOrderId = ticketCheckout.orderId;
  await expect(page.locator("#ticket-demo-checkout")).toBeVisible();
  await expect(page.locator("#ticket-demo-amount")).toHaveText("$60.00 demo");
  await expect(page.locator("#ticket-demo-status")).toContainText("local board runtime");
  const ticketPaymentResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/board-ticket-checkout/complete" && response.request().method() === "POST");
  await page.locator("#ticket-demo-pay").click();
  const ticketPaymentResult = await ticketPaymentResponse;
  expect(ticketPaymentResult.status()).toBe(200);
  const ticketPayment = await ticketPaymentResult.json();
  expect(ticketPayment.order.status).toBe("paid");
  expect(ticketPayment.receipt).toMatchObject({
    orderId: demoTicketOrderId,
    amountCents: 6000,
    currency: "usd",
    fulfillmentCount: 2,
    environment: "board_sandbox"
  });
  await expect(page.locator("#ticket-demo-status")).toContainText("Demo payment complete");
  await expect(page.locator("#checkout-status")).toContainText("No external charge was sent");
  await expect(page.locator("#ticket-demo-pay")).toBeHidden();
  await expect(page.locator("#ticket-subtotal")).toHaveText("$0.00");
  await expect(ticketPolicy.locator("#ticket-policy-acceptance")).not.toBeChecked();

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
  const vendorPreset = vendor.locator('[data-board-partner-preset="vendor"]');
  await expect(vendorPreset).toHaveText("Use demo vendor");
  await vendorPreset.click();
  await expect(vendor.locator('[name="organizationName"]')).toHaveValue("Port A Coastal Makers");
  await expect(vendor.locator('[name="contactEmail"]')).toHaveValue(/^casey\.vendor\.[a-z0-9-]+@example\.com$/);
  await expect(vendor.locator('[name="contactPhone"]')).toHaveValue("+13615550132");
  await expect(vendor.locator('[name="category"]')).toHaveValue("artisan");
  await expect(vendor.locator('[name="vendorOfferingId"]')).toHaveValue("marketplace-booth");
  await expect(vendor.locator('[name="consentToContact"]')).not.toBeChecked();
  await expect(vendor.locator(".partner-form-status")).toHaveText("Synthetic details are ready. Contact consent remains unchecked.");
  await vendor.locator('[name="consentToContact"]').check();
  const vendorResult = await submitAndCapture(page, vendor, "/api/public/vendor-applications");
  await expect(vendor.locator(".partner-form-status")).toContainText("Application received.");
  await expect(page).toHaveURL(/#partner-status$/);
  await expect(page.locator("#partner-status-result")).toContainText(vendorName);
  await expect(page.locator("#partner-status-result")).toBeFocused();
  await assertTargetClearsTopbar(page, "#partner-status", 12);
  await expect(page.locator('#partner-status-form [name="reference"]')).toHaveValue(vendorResult.application.reference);
  await page.reload();
  await expect(page).toHaveURL(/#partner-status$/);
  await expect(page.locator("#partner-status-result")).toContainText(vendorName);
  await expect(page.locator("#partner-status-result")).toBeFocused();
  await assertTargetClearsTopbar(page, "#partner-status", 12);
  await expect(page.locator('#partner-status-form [name="reference"]')).toHaveValue(vendorResult.application.reference);
  const contactPreferenceForm = page.locator("#partner-contact-preference-form");
  await expect(contactPreferenceForm).toContainText("Application emails enabled");
  await expect(contactPreferenceForm.locator('[name="consentToContact"]')).toBeChecked();
  await contactPreferenceForm.locator('[name="consentToContact"]').uncheck();
  const pausedContactResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-contact-preferences" && response.request().method() === "POST");
  await contactPreferenceForm.locator('button[type="submit"]').click();
  expect((await pausedContactResponse).status()).toBe(200);
  await expect(contactPreferenceForm).toContainText("Application emails paused");
  await expect(contactPreferenceForm.locator('[name="consentToContact"]')).not.toBeChecked();
  await contactPreferenceForm.locator('[name="consentToContact"]').check();
  const resumedContactResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-contact-preferences" && response.request().method() === "POST");
  await contactPreferenceForm.locator('button[type="submit"]').click();
  expect((await resumedContactResponse).status()).toBe(200);
  await expect(contactPreferenceForm).toContainText("Application emails enabled");
  await expect(contactPreferenceForm.locator('[name="consentToContact"]')).toBeChecked();
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
  const sponsorPreset = sponsor.locator('[data-board-partner-preset="sponsor"]');
  await expect(sponsorPreset).toHaveText("Use demo sponsor");
  await sponsorPreset.click();
  await expect(sponsor.locator('[name="organizationName"]')).toHaveValue("Coastal Community Bank");
  await expect(sponsor.locator('[name="contactEmail"]')).toHaveValue(/^morgan\.sponsor\.[a-z0-9-]+@example\.com$/);
  await expect(sponsor.locator('[name="contactPhone"]')).toHaveValue("+13615550131");
  await expect(sponsor.locator('[name="packageId"]')).toHaveValue("tarpon");
  await expect(sponsor.locator('[name="consentToContact"]')).not.toBeChecked();
  await expect(sponsor.locator(".partner-form-status")).toHaveText("Synthetic details are ready. Contact consent remains unchecked.");
  const sponsorRecipient = await sponsor.locator('[name="contactEmail"]').inputValue();
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
  const sponsorBrandAsset = page.locator("#partner-brand-asset-form");
  await sponsorBrandAsset.locator('[name="kind"]').selectOption("primary_logo");
  await sponsorBrandAsset.locator('[name="label"]').fill("Primary community health logo");
  await sponsorBrandAsset.locator('[name="file"]').setInputFiles({
    name: `browser-coastal-health-${runId}.png`,
    mimeType: "image/png",
    buffer: await readFile(path.join(ROOT, "docs", "board-demo-assets", "gulf-shore-credit-union-logo.png"))
  });
  const sponsorBrandAssetResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-brand-assets/upload" && response.request().method() === "POST");
  await sponsorBrandAsset.locator('button[type="submit"]').click();
  const uploadedSponsorBrandAssetResponse = await sponsorBrandAssetResponse;
  expect(uploadedSponsorBrandAssetResponse.status()).toBe(201);
  const uploadedSponsorBrandAsset = (await uploadedSponsorBrandAssetResponse.json()).asset;
  expect(uploadedSponsorBrandAsset.sourceType).toBe("upload");
  expect(uploadedSponsorBrandAsset).not.toHaveProperty("storageKey");
  await expect(page.locator("#partner-status-form .partner-form-status")).toContainText("Brand asset submitted for review.");
  await expect(page.locator(`[data-partner-brand-asset="${uploadedSponsorBrandAsset.id}"]`)).toContainText("Primary community health logo");
  await expect(page.locator(`[data-partner-brand-asset="${uploadedSponsorBrandAsset.id}"] [data-status="submitted"]`)).toHaveText("submitted");

  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-partners`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await assertAnchorClearsWorkspaceNav(page, "#admin-partners", 4);
  await expect(page).toHaveTitle("Texas SandFest Operations");
  await expect(page.locator("#network-status")).toHaveText("Demo");
  await expect(page.locator("#runtime-data-notice")).toContainText("Synthetic 2027 data");
  await expect(page.locator("#runtime-data-notice")).toContainText("No external messages, charges, or live-provider calls");
  await expect(page.locator("#admin-reset-board-demo")).toBeHidden();
  await expect(page.locator("header nav")).toHaveCount(0);
  await expect(page.locator(".admin-workspace-nav")).toBeVisible();
  await expect(page.locator(".admin-api-bar")).toBeHidden();
  await expect(page.locator("#admin-config h1")).toHaveText("Festival operations command center");
  await expect(page.locator(".nav-cta")).toHaveAttribute("href", `${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
  await expect(page.locator("#admin-deployment-summary")).toContainText("board demo · ready · live providers post-board");
  await expect(page.locator("#admin-ticket-policy-state")).toHaveText("Approved");
  await expect(page.locator('#admin-ticket-policy-form [name="version"]')).toHaveValue("board-demo-2027-v1");
  await expect(page.locator("#admin-ticket-policy-readiness")).toContainText("approved for checkout");
  await expect(page.locator("#admin-ticket-policy-notices textarea")).toHaveCount(4);
  const activationBoundary = page.locator("#admin-board-stage-summary");
  await expect(activationBoundary.locator('[data-board-stage="presentation-ready"]')).toContainText("Real workflows with synthetic providers");
  await expect(activationBoundary.locator('[data-board-stage="post-presentation"]')).toContainText("Stripe, QuickBooks, Brevo, Twilio, NWS, TxDOT, eight webcam edge agents, OIDC, Turnstile, DNS, and managed recovery");
  await expect(page.locator("#admin-load-partners")).toHaveText("Refresh partner workspace");
  await expect(page.locator("#admin-load-conditions")).toHaveText("Refresh island operations");
  await expect(page.locator("#admin-island-conditions > strong").first()).toHaveText("Source health");
  await expect(page.locator("#admin-condition-feeds")).toContainText("Simulated · Current");
  await expect(page.locator("#admin-condition-feeds")).not.toContainText("Live · Live");
  const operationsWorkspaceLayout = await page.locator(".admin-conditions-columns").evaluate(container => {
    const outreach = container.querySelector("#admin-outreach-prospects-workspace")?.getBoundingClientRect();
    const conditions = container.querySelector("#admin-island-conditions")?.getBoundingClientRect();
    const bounds = container.getBoundingClientRect();
    return {
      bounds: { left: bounds.left, right: bounds.right },
      outreach: outreach ? { bottom: outreach.bottom } : null,
      conditions: conditions ? { left: conditions.left, right: conditions.right, top: conditions.top } : null
    };
  });
  expect(operationsWorkspaceLayout.outreach).not.toBeNull();
  expect(operationsWorkspaceLayout.conditions).not.toBeNull();
  expect(Math.abs(operationsWorkspaceLayout.conditions.left - operationsWorkspaceLayout.bounds.left)).toBeLessThan(1);
  expect(Math.abs(operationsWorkspaceLayout.conditions.right - operationsWorkspaceLayout.bounds.right)).toBeLessThan(1);
  expect(operationsWorkspaceLayout.conditions.top).toBeGreaterThanOrEqual(operationsWorkspaceLayout.outreach.bottom + 13);
  const smsPreference = page.locator("#admin-board-sms-preference");
  const smsPreferenceStatus = page.locator("#admin-board-sms-preference-status");
  const smsSafetyKpi = page.locator("#admin-consent-kpis article").filter({ hasText: "SMS safety" });
  const stopSmsPreference = smsPreference.locator('[data-board-sms-preference="STOP"]');
  const startSmsPreference = smsPreference.locator('[data-board-sms-preference="START"]');
  await expect(smsPreference).toBeVisible();
  await expect(smsPreferenceStatus).toHaveText("Opted in · 0 signed sandbox callbacks");
  await expect(smsSafetyKpi.locator("strong")).toHaveText("1");
  await expect(stopSmsPreference).toBeEnabled();
  await expect(startSmsPreference).toBeDisabled();
  await expect(smsPreference).not.toContainText("+13615550188");
  const stopPreferenceResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/board-demo/sms-preference" && response.request().method() === "POST");
  await stopSmsPreference.click();
  expect((await stopPreferenceResponse).status()).toBe(200);
  await expect(smsPreferenceStatus).toHaveText("Opted out · 1 signed sandbox callback");
  await expect(smsSafetyKpi.locator("strong")).toHaveText("0");
  await expect(stopSmsPreference).toBeDisabled();
  await expect(startSmsPreference).toBeEnabled();
  const startPreferenceResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/board-demo/sms-preference" && response.request().method() === "POST");
  await startSmsPreference.click();
  expect((await startPreferenceResponse).status()).toBe(200);
  await expect(smsPreferenceStatus).toHaveText("Opted in · 2 signed sandbox callbacks");
  await expect(smsSafetyKpi.locator("strong")).toHaveText("1");
  await expect(stopSmsPreference).toBeEnabled();
  await expect(startSmsPreference).toBeDisabled();
  const partnerKpis = page.locator("#admin-partner-kpis");
  await expect(partnerKpis.locator("article").filter({ hasText: "Received" })).toContainText("1 active payment");
  await expect(partnerKpis.locator("article").filter({ hasText: "Received" })).toContainText("0 accounts paid in full");
  await expect(partnerKpis.locator("article").filter({ hasText: "QuickBooks" })).toContainText("Post-board");
  await expect(partnerKpis.locator("article").filter({ hasText: "Online invoices" })).toContainText("Local sandbox");
  await expect(partnerKpis.locator("article").filter({ hasText: "Online invoices" })).toContainText("Stripe post-board");
  const messagingKpi = partnerKpis.locator("article").filter({ hasText: "Messaging" });
  await expect(messagingKpi).toContainText("Review first");
  await expect(messagingKpi).toContainText(/\d+ drafts? awaiting staff review/);
  const budgetKpis = page.locator("#admin-budget-kpis");
  await expect(budgetKpis.locator("article").filter({ hasText: "Annual budget" })).toContainText("$530,000.00");
  await expect(budgetKpis.locator("article").filter({ hasText: "Committed" })).toContainText("$186,400.00");
  await expect(budgetKpis.locator("article").filter({ hasText: "Awaiting approval" })).toContainText("$92,000.00");
  await expect(page.locator("#admin-budget-lines [data-budget-line]")).toHaveCount(6);
  await expect(page.locator("#admin-expense-list [data-budget-expense]")).toHaveCount(7);
  await expect(page.locator('#admin-expense-list [data-expense-status="submitted"]')).toHaveCount(2);
  await expect(page.locator('#admin-expense-list [data-expense-status="approved"]')).toHaveCount(2);
  await expect(page.locator('#admin-expense-list [data-expense-status="paid"]')).toHaveCount(2);
  await expect(page.locator('#admin-expense-list [data-expense-status="rejected"]')).toHaveCount(1);
  const accountingExports = page.locator('#admin-export-type option[value="budget.csv"], #admin-export-type option[value="expenses.csv"]');
  await expect(accountingExports).toHaveCount(2);
  await page.locator("#admin-export-type").selectOption("budget.csv");
  const [budgetDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#admin-download-export").click()
  ]);
  expect(budgetDownload.suggestedFilename()).toBe(`${DEFAULT_EVENT_ID}-budget-allocations.csv`);
  await page.locator("#admin-export-type").selectOption("expenses.csv");
  const [expenseDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#admin-download-export").click()
  ]);
  expect(expenseDownload.suggestedFilename()).toBe(`${DEFAULT_EVENT_ID}-expense-register.csv`);
  await expect(page.locator("#admin-budget")).not.toContainText(/RAMP-DEMO|budget_line_|expense_/);

  const budgetLineForm = page.locator("#admin-create-budget-line");
  await budgetLineForm.locator('[name="name"]').fill(budgetLineName);
  await budgetLineForm.locator('[name="ownerTeam"]').selectOption("guest-services");
  await budgetLineForm.locator('[name="amount"]').fill("2500.00");
  await budgetLineForm.locator('[name="notes"]').fill("Browser acceptance allocation");
  const budgetLineResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/budget/lines" && response.request().method() === "POST");
  await budgetLineForm.locator('button[type="submit"]').click();
  const budgetLineResult = await budgetLineResponse;
  expect(budgetLineResult.status()).toBe(201);
  const createdBudgetLine = (await budgetLineResult.json()).line;
  const budgetLineCard = () => page.locator(`#admin-budget-lines [data-budget-line="${createdBudgetLine.id}"]`);
  await expect(budgetLineCard()).toContainText(budgetLineName);
  await budgetLineCard().locator('[name="amount"]').fill("3000.00");
  await budgetLineCard().locator('[name="changeNote"]').fill("Board browser acceptance approved this allocation change.");
  const budgetLineUpdateResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/budget/lines/${createdBudgetLine.id}` && response.request().method() === "PATCH");
  await budgetLineCard().locator('button[type="submit"]').click();
  expect((await budgetLineUpdateResponse).status()).toBe(200);
  await expect(budgetLineCard()).toContainText("$3,000.00");

  const expenseForm = page.locator("#admin-create-expense");
  await expenseForm.locator('[name="budgetLineId"]').selectOption(createdBudgetLine.id);
  await expenseForm.locator('[name="vendorName"]').fill(budgetVendorName);
  await expenseForm.locator('[name="amount"]').fill("1200.00");
  await expenseForm.locator('[name="dueDate"]').fill("2027-03-20");
  await expenseForm.locator('[name="description"]').fill("Browser acceptance guest service equipment");
  const expenseResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/budget/expenses" && response.request().method() === "POST");
  await expenseForm.locator('button[type="submit"]').click();
  const expenseResult = await expenseResponse;
  expect(expenseResult.status()).toBe(201);
  const createdExpense = (await expenseResult.json()).expense;
  const expenseCard = () => page.locator(`#admin-expense-list [data-budget-expense="${createdExpense.id}"]`);
  await expect(expenseCard()).toHaveAttribute("data-expense-status", "submitted");
  const expenseApprovalResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/budget/expenses/${createdExpense.id}/approve` && response.request().method() === "POST");
  await expenseCard().locator('[data-expense-action="approve"]').click();
  expect((await expenseApprovalResponse).status()).toBe(200);
  await expect(expenseCard()).toHaveAttribute("data-expense-status", "approved");
  await expenseCard().locator('[data-expense-payment-method]').selectOption("ach");
  await expenseCard().locator('[data-expense-payment-reference]').fill(`BROWSER-PRIVATE-${runId}`);
  const expensePaymentResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/budget/expenses/${createdExpense.id}/mark-paid` && response.request().method() === "POST");
  await expenseCard().locator('[data-expense-action="mark-paid"]').click();
  expect((await expensePaymentResponse).status()).toBe(200);
  await expect(expenseCard()).toHaveAttribute("data-expense-status", "paid");
  await expect(expenseCard()).toContainText("ACH payment recorded");
  await expect(expenseCard()).not.toContainText(`BROWSER-PRIVATE-${runId}`);
  const commandSignals = page.locator("#admin-command-signals");
  await expect(commandSignals).toHaveAttribute("aria-busy", "false");
  await expect(commandSignals.locator("[data-command-signal]")).toHaveCount(8);
  await expect(commandSignals.locator('[data-command-signal="applications"]')).toContainText(/\d+ active/);
  await expect(commandSignals.locator('[data-command-signal="applications"]')).toContainText(/\d+ vendors/);
  await expect(commandSignals.locator('[data-command-signal="receivables"]')).toContainText("received of");
  await expect(commandSignals.locator('[data-command-signal="messages"]')).toContainText("Provider ready");
  await expect(commandSignals.locator('[data-command-signal="messages"]')).toContainText("staff review required");
  await expect(commandSignals.locator('[data-command-signal="assignments"]')).toContainText("staff / volunteer / team");
  await expect(commandSignals.locator('[data-command-signal="key-dates"]')).toContainText("upcoming");
  await expect(commandSignals.locator('[data-command-signal="key-dates"]')).toContainText(/[1-9]\d* due soon/);
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
  await expect(partnerActivity).toContainText(/assignment notices prepared/i);
  await expect(partnerActivity).toContainText("Brand profile approved");
  expect(await partnerActivity.textContent()).not.toMatch(/activity_|demo_[sv]app|followup_/);
  const partnerMessages = page.locator("#admin-partner-followups");
  await expect(partnerMessages).toContainText(`Texas SandFest vendor application ${vendorResult.application.reference}`);
  await expect(partnerMessages).toContainText(`Texas SandFest sponsorship application ${sponsorResult.application.reference}`);
  await expect(partnerMessages).not.toContainText(`review application reminder - ${vendorResult.application.reference}`);
  await expect(partnerMessages).not.toContainText(`qualify opportunity reminder - ${sponsorResult.application.reference}`);
  const deferredRecovery = page.locator('#admin-deployment-checks [data-board-stage="post-presentation"]');
  await expect(deferredRecovery).toHaveCount(1);
  await expect(deferredRecovery).toContainText("Post-board");
  await expect(deferredRecovery).toContainText("Backup and recovery");
  await expect(deferredRecovery).toContainText("Managed backup provisioning and provider restore drills are scheduled after the presentation.");
  await expect(deferredRecovery).toContainText("Isolated database and upload recovery verification remains in the release gate.");
  await expect(deferredRecovery).not.toContainText("configure a supported managed backup provider");
  const transactionRegions = page.locator("#admin-system-monitor .admin-record-list");
  await expect(transactionRegions).toHaveCount(5);
  expect(await transactionRegions.evaluateAll(regions => regions.every(region => region.getAttribute("role") === "region" && region.tabIndex === 0))).toBe(true);
  const automationRegion = page.locator("#admin-job-list");
  await expect(automationRegion).toHaveAttribute("role", "region");
  await expect(automationRegion).toHaveAttribute("tabindex", "0");
  const automationRows = automationRegion.locator("[data-automation-row]");
  const automationRowCount = await automationRows.count();
  const representedAutomationJobs = await automationRows.evaluateAll(rows => rows.reduce((total, row) => total + Number(row.dataset.jobCount || 1), 0));
  const completedGroupCount = await automationRegion.locator('[data-job-group="completed"]').count();
  expect(automationRowCount).toBeGreaterThan(0);
  expect(representedAutomationJobs).toBeGreaterThan(automationRowCount);
  expect(completedGroupCount).toBeGreaterThan(0);
  await expect(automationRegion.locator('[data-job-status="done"]')).toHaveCount(automationRowCount);
  await expect(automationRegion).toContainText("completed runs");
  await expect(automationRegion).toContainText("Open Message drafts");
  await expect(automationRegion).toContainText(/Partner message (preparation|delivery)/);
  await expect(automationRegion).not.toContainText(/job_|followup_|@/);
  await expect(page.locator("#admin-job-summary")).toContainText(`${representedAutomationJobs} complete`);
  await expect(page.locator("#admin-job-summary")).toContainText("0 need review");
  const initialTransactionRefresh = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/audit" && response.request().method() === "GET");
  await page.locator("#admin-load-orders").click();
  expect((await initialTransactionRefresh).status()).toBe(200);
  const systemMonitor = page.locator("#admin-system-monitor");
  expect(await page.locator("#admin-audit-list [data-audit-action]").count()).toBeGreaterThan(0);
  await expect(page.locator("#admin-audit-list")).not.toContainText("EmailDeliveryWebhook");
  await expect(systemMonitor.locator(".admin-record-card code")).toHaveCount(0);
  await expect(systemMonitor).not.toContainText(/data\/processed|db:\/\/|admin-audit\//);
  const auditRegionMetrics = await page.locator("#admin-audit-list").evaluate(region => ({
    clientHeight: region.clientHeight,
    scrollHeight: region.scrollHeight
  }));
  expect(auditRegionMetrics.clientHeight).toBeLessThanOrEqual(560);
  const paidTicketOrderCard = () => page.locator(`#admin-order-list [data-ticket-order="${demoTicketOrderId}"]`);
  await expect(paidTicketOrderCard()).toHaveCount(1);
  await expect(paidTicketOrderCard()).toContainText("paid");
  await expect(paidTicketOrderCard()).toContainText("$60.00");
  await expect(paidTicketOrderCard()).toContainText(ticketBuyerEmail);
  await expect(paidTicketOrderCard()).toContainText("local sandbox");
  await expect(paidTicketOrderCard()).toContainText("Policy board-demo-2027-v1 accepted");
  await expect(paidTicketOrderCard().locator("[data-refund-board-ticket]")).toHaveText("Refund demo order");
  const paidTicketFulfillment = page.locator("#admin-fulfillment-list [data-fulfillment-id]").filter({ hasText: demoTicketOrderId });
  await expect(paidTicketFulfillment).toHaveCount(2);
  expect(await paidTicketFulfillment.locator("select").evaluateAll(selects => selects.map(select => select.value))).toEqual(["queued", "queued"]);
  const paidTicketEvent = page.locator("#admin-payment-event-list .admin-record-card").filter({ hasText: "checkout.session.completed" });
  await expect(paidTicketEvent).toHaveCount(1);
  await expect(paidTicketEvent).toContainText("isolated_board_payment_sandbox");
  const paidTicketRevenueResponse = await fetch(`${apiBase}/api/admin/revenue`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(paidTicketRevenueResponse.status).toBe(200);
  const paidTicketRevenue = await paidTicketRevenueResponse.json();
  const paidTicketRevenueEntries = paidTicketRevenue.entries?.filter(item => item.sourceRecordId === demoTicketOrderId) || [];
  expect(paidTicketRevenueEntries).toHaveLength(1);
  expect(paidTicketRevenueEntries[0]).toMatchObject({
    category: "ticket",
    source: "manual",
    grossCents: 6000,
    netCents: 6000,
    quantity: 2,
    origin: "board_ticket_sandbox",
    entryType: "receipt"
  });
  expect(paidTicketRevenue.summary.tickets.sold).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#admin-revenue-updated")).toContainText("ticket ledger");
  page.once("dialog", dialog => dialog.accept());
  const ticketRefundResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/board-demo/ticket-orders/${demoTicketOrderId}/refund` && response.request().method() === "POST");
  await paidTicketOrderCard().locator("[data-refund-board-ticket]").click();
  const ticketRefundResult = await ticketRefundResponse;
  expect(ticketRefundResult.status()).toBe(200);
  expect((await ticketRefundResult.json()).order.status).toBe("refunded");
  await expect(paidTicketOrderCard()).toContainText("refunded");
  await expect(paidTicketOrderCard().locator("[data-refund-board-ticket]")).toHaveCount(0);
  const refundedTicketFulfillment = page.locator("#admin-fulfillment-list [data-fulfillment-id]").filter({ hasText: demoTicketOrderId });
  await expect(refundedTicketFulfillment).toHaveCount(2);
  expect(await refundedTicketFulfillment.locator("select").evaluateAll(selects => selects.map(select => select.value))).toEqual(["refunded", "refunded"]);
  const refundTicketEvent = page.locator("#admin-payment-event-list .admin-record-card").filter({ hasText: "charge.refunded" });
  await expect(refundTicketEvent).toHaveCount(1);
  await expect(refundTicketEvent).toContainText("isolated_board_payment_sandbox");
  const refundedTicketRevenueResponse = await fetch(`${apiBase}/api/admin/revenue`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(refundedTicketRevenueResponse.status).toBe(200);
  const refundedTicketRevenue = await refundedTicketRevenueResponse.json();
  const refundedTicketRevenueEntries = refundedTicketRevenue.entries?.filter(item => item.sourceRecordId === demoTicketOrderId) || [];
  expect(refundedTicketRevenueEntries).toHaveLength(2);
  expect(refundedTicketRevenueEntries.find(item => item.entryType === "refund")).toMatchObject({ grossCents: -6000, netCents: -6000, quantity: -2 });
  expect(refundedTicketRevenue.summary.tickets.sold).toBe(paidTicketRevenue.summary.tickets.sold - 2);
  expect(refundedTicketRevenue.summary.totals.refundCents).toBe(paidTicketRevenue.summary.totals.refundCents + 6000);
  await expect(commandSignals.locator('[data-command-signal="receivables"]')).toHaveAttribute("href", "#admin-receivables-workspace");
  await expect(commandSignals.locator('[data-command-signal="vendors"]')).toHaveAttribute("href", "#admin-vendor-readiness-workspace");
  await commandSignals.locator('[data-command-signal="vendors"]').click();
  await expect(page).toHaveURL(/#admin-vendor-readiness-workspace$/);
  await expect(page.locator("#admin-vendor-readiness-workspace")).toBeInViewport({ ratio: 0.1 });
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
  const revenueBeforeResponse = await fetch(`${apiBase}/api/admin/revenue`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(revenueBeforeResponse.status).toBe(200);
  const revenueBefore = await revenueBeforeResponse.json();
  const settlementForm = page.locator("#admin-import-revenue");
  await settlementForm.locator('[name="source"]').selectOption("square");
  await settlementForm.locator('[name="file"]').setInputFiles({
    name: settlementFileName,
    mimeType: "text/csv",
    buffer: Buffer.from(settlementCsv, "utf8")
  });
  await expect(settlementForm.locator('[name="csv"]')).toHaveValue(settlementCsv);
  const settlementPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/revenue/import" && response.request().method() === "POST");
  await settlementForm.locator('button[type="submit"]').click();
  const settlementPreviewResult = await settlementPreviewResponse;
  expect(settlementPreviewResult.status()).toBe(200);
  const settlementPreview = await settlementPreviewResult.json();
  expect(settlementPreview.summary?.rows).toBe(1);
  expect(settlementPreview.summary?.importable).toBe(1);
  expect(settlementPreview.summary?.invalid).toBe(0);
  expect(settlementPreview.summary?.grossCents).toBe(32500);
  expect(settlementPreview.summary?.feeCents).toBe(975);
  expect(settlementPreview.summary?.netCents).toBe(31525);
  await expect(page.locator("#admin-revenue-import-result")).toContainText("1 importable");
  await expect(page.locator("#admin-revenue-import-result")).toContainText("$325.00 gross");
  await expect(page.locator("#admin-commit-revenue-import")).toBeEnabled();

  const settlementCommitResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/revenue/import" && response.request().method() === "POST");
  await page.locator("#admin-commit-revenue-import").click();
  const settlementCommitResult = await settlementCommitResponse;
  expect(settlementCommitResult.status()).toBe(201);
  const settlementCommit = await settlementCommitResult.json();
  expect(settlementCommit.summary?.imported).toBe(1);
  expect(settlementCommit.replay).toBe(false);
  await expect(page.locator("#admin-api-status")).toContainText("Imported 1 settlement row; 0 duplicates skipped.");
  const settlementHistory = page.locator("#admin-revenue-import-history article").filter({ hasText: settlementFileName });
  await expect(settlementHistory).toHaveCount(1);
  await expect(settlementHistory).toContainText("square");
  await expect(settlementHistory).toContainText("1 imported");
  await expect(page.locator("#admin-revenue-sources")).toContainText("square");

  const revenueAfterResponse = await fetch(`${apiBase}/api/admin/revenue`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(revenueAfterResponse.status).toBe(200);
  const revenueAfter = await revenueAfterResponse.json();
  const importedSettlement = revenueAfter.entries?.find(item => item.externalRef === settlementReference);
  expect(importedSettlement).toMatchObject({
    source: "square",
    category: "merch",
    grossCents: 32500,
    feeCents: 975,
    netCents: 31525,
    reconciled: true
  });
  expect(revenueAfter.summary.totals.grossCents).toBe(revenueBefore.summary.totals.grossCents + 32500);
  expect(revenueAfter.summary.totals.feeCents).toBe(revenueBefore.summary.totals.feeCents + 975);
  expect(revenueAfter.summary.totals.netCents).toBe(revenueBefore.summary.totals.netCents + 31525);
  expect(revenueAfter.imports?.filter(item => item.fileName === settlementFileName)).toHaveLength(1);

  await settlementForm.locator('[name="source"]').selectOption("square");
  await settlementForm.locator('[name="file"]').setInputFiles({
    name: settlementFileName,
    mimeType: "text/csv",
    buffer: Buffer.from(settlementCsv, "utf8")
  });
  await expect(settlementForm.locator('[name="csv"]')).toHaveValue(settlementCsv);
  const settlementReplayPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/revenue/import" && response.request().method() === "POST");
  await settlementForm.locator('button[type="submit"]').click();
  const settlementReplayPreviewResult = await settlementReplayPreviewResponse;
  expect(settlementReplayPreviewResult.status()).toBe(200);
  const settlementReplayPreview = await settlementReplayPreviewResult.json();
  expect(settlementReplayPreview.replay).toBe(true);
  expect(settlementReplayPreview.summary?.importable).toBe(0);
  expect(settlementReplayPreview.summary?.duplicates).toBe(0);
  await expect(page.locator("#admin-revenue-import-result")).toContainText("0 importable");
  await expect(page.locator("#admin-revenue-import-result")).toContainText("This exact settlement was already imported. No ledger entries were added.");
  await expect(page.locator("#admin-commit-revenue-import")).toBeDisabled();
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
  const sponsorApprovalResult = await sponsorApprovalResponse;
  expect(sponsorApprovalResult.status()).toBe(200);
  const sponsorApprovalPayload = await sponsorApprovalResult.json();
  expect(sponsorApprovalPayload.decisionNotice).toMatchObject({
    kind: "application_approved",
    status: "draft_ready",
    requiresManualReview: false
  });
  await expect(page.locator("#admin-api-status")).toContainText("approval message is ready");
  await expect(partnerMessages.locator("[data-followup]").filter({ hasText: `Texas SandFest sponsorship application approved - ${sponsorResult.application.reference}` })).toContainText("Review the current status and respond here");
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

  const freshSponsorFulfillment = () => page.locator(`#admin-sponsor-fulfillment [data-sponsor-fulfillment="${sponsorResult.application.id}"]`);
  await expect(freshSponsorFulfillment()).toHaveCount(1);
  await expect(freshSponsorFulfillment()).toContainText("Tarpon");
  await expect(freshSponsorFulfillment()).toContainText("0/6 complete");
  await expect(freshSponsorFulfillment().locator('[data-brand-profile] [data-status="submitted"]')).toHaveText("submitted");
  await expect(freshSponsorFulfillment().locator(`[data-admin-brand-asset="${uploadedSponsorBrandAsset.id}"] [data-status="submitted"]`)).toHaveText("submitted");

  const freshSponsorProfileApproval = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/applications/${sponsorResult.application.id}/brand-profile/review` && response.request().method() === "POST");
  await freshSponsorFulfillment().locator('[data-review-brand-profile="approve"]').click();
  expect((await freshSponsorProfileApproval).status()).toBe(200);
  await expect(freshSponsorFulfillment().locator('[data-brand-profile] [data-status="approved"]')).toHaveText("approved");

  const freshSponsorAssetRow = () => freshSponsorFulfillment().locator(`[data-admin-brand-asset="${uploadedSponsorBrandAsset.id}"]`);
  await freshSponsorAssetRow().locator('[name="status"]').selectOption("approved");
  const freshSponsorAssetApproval = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/brand-assets/${uploadedSponsorBrandAsset.id}` && response.request().method() === "PATCH");
  await freshSponsorAssetRow().locator("[data-save-brand-asset]").click();
  expect((await freshSponsorAssetApproval).status()).toBe(200);
  await expect(freshSponsorAssetRow().locator('[data-status="approved"]')).toHaveText("approved");

  const freshSponsorDeliverableId = await freshSponsorFulfillment().locator("[data-admin-deliverable]").first().getAttribute("data-admin-deliverable");
  expect(freshSponsorDeliverableId).toBeTruthy();
  const freshSponsorDeliverable = () => freshSponsorFulfillment().locator(`[data-admin-deliverable="${freshSponsorDeliverableId}"]`);
  await freshSponsorDeliverable().locator('[name="status"]').selectOption("published");
  await freshSponsorDeliverable().locator('[name="ownerId"]').fill("staff_sponsor");
  await freshSponsorDeliverable().locator('[name="dueAt"]').fill("2027-03-20T17:00");
  await freshSponsorDeliverable().locator('[name="proofUrl"]').fill(`https://www.texassandfest.org/sponsors/${runId}`);
  await freshSponsorDeliverable().locator('[name="proofNotes"]').fill("Benefit placement is published and ready for sponsor review.");
  const freshSponsorDeliverablePublication = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/deliverables/${freshSponsorDeliverableId}` && response.request().method() === "PATCH");
  await freshSponsorDeliverable().locator("[data-save-deliverable]").click();
  expect((await freshSponsorDeliverablePublication).status()).toBe(200);
  await expect(freshSponsorDeliverable().locator('[data-status="pending"]')).toHaveText("pending");

  const freshSponsorPortal = await openPreparedPartnerPortal(sponsorName);
  await expect(freshSponsorPortal.locator(".partner-brand-center")).toContainText("Brand center");
  await expect(freshSponsorPortal.locator("[data-partner-brand-asset]")).toHaveCount(1);
  await expect(freshSponsorPortal.locator("[data-partner-deliverable]")).toHaveCount(6);
  await expect(freshSponsorPortal.locator("[data-partner-pay-invoice]")).toHaveText("Pay in local sandbox");
  const partnerCheckoutResponse = freshSponsorPortal.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-payment-checkout" && response.request().method() === "POST");
  await freshSponsorPortal.locator("[data-partner-pay-invoice]").click();
  const partnerCheckoutResult = await partnerCheckoutResponse;
  expect(partnerCheckoutResult.status()).toBe(201);
  const partnerCheckout = (await partnerCheckoutResult.json()).demoCheckout;
  expect(partnerCheckout).toMatchObject({
    mode: "board_sandbox",
    amountCents: 500000,
    currency: "usd",
    completeEndpoint: "/api/public/board-partner-checkout/complete"
  });
  expect(partnerCheckout.token).toEqual(expect.any(String));
  const tamperedPartnerPayment = await fetch(`${apiBase}${partnerCheckout.completeEndpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: `${partnerCheckout.token}x` })
  });
  expect(tamperedPartnerPayment.status).toBe(400);
  const partnerPaymentSandbox = freshSponsorPortal.locator("[data-partner-payment-sandbox]");
  await expect(partnerPaymentSandbox).toContainText("$5,000.00 demo");
  await expect(partnerPaymentSandbox).toContainText("No external charge is sent");
  await expect(partnerPaymentSandbox).not.toContainText("Stripe");
  await freshSponsorPortal.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow(freshSponsorPortal);
  await assertNoAccessibilityViolations(freshSponsorPortal, "local partner payment sandbox");
  const partnerPaymentResponse = freshSponsorPortal.waitForResponse(response => new URL(response.url()).pathname === partnerCheckout.completeEndpoint && response.request().method() === "POST");
  await partnerPaymentSandbox.locator("[data-complete-partner-demo-payment]").click();
  const partnerPaymentResult = await partnerPaymentResponse;
  expect(partnerPaymentResult.status()).toBe(200);
  const partnerPayment = await partnerPaymentResult.json();
  expect(partnerPayment.duplicate).toBe(false);
  expect(partnerPayment.receipt).toMatchObject({
    invoiceId: createdInvoice.id,
    amountCents: 500000,
    currency: "usd",
    environment: "board_sandbox"
  });
  expect(partnerPayment.receipt.paymentId).toEqual(expect.any(String));
  await expect(freshSponsorPortal.locator(".partner-status-kpis")).toContainText("$0.00");
  await expect(freshSponsorPortal.locator(".partner-status-kpis")).toContainText("paid");
  await expect(freshSponsorPortal.locator("[data-partner-pay-invoice]")).toHaveCount(0);
  const partnerPaymentReplay = await fetch(`${apiBase}${partnerCheckout.completeEndpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: partnerCheckout.token })
  });
  expect(partnerPaymentReplay.status).toBe(200);
  const partnerPaymentReplayResult = await partnerPaymentReplay.json();
  expect(partnerPaymentReplayResult.duplicate).toBe(true);
  expect(partnerPaymentReplayResult.receipt.paymentId).toBe(partnerPayment.receipt.paymentId);
  const freshSponsorPortalDeliverable = freshSponsorPortal.locator(`[data-partner-deliverable="${freshSponsorDeliverableId}"]`);
  await expect(freshSponsorPortalDeliverable).toContainText("Delivery proof · version 1");
  await expect(freshSponsorPortalDeliverable.locator('.partner-deliverable-review[data-status="pending"]')).toContainText("Partner review: pending");
  const freshSponsorSignoff = freshSponsorPortal.waitForResponse(response => new URL(response.url()).pathname === `/api/public/partner-deliverables/${freshSponsorDeliverableId}/review` && response.request().method() === "POST");
  await freshSponsorPortalDeliverable.locator('[data-deliverable-review="approve"]').click();
  expect((await freshSponsorSignoff).status()).toBe(200);
  await expect(freshSponsorPortal.locator(`[data-partner-deliverable="${freshSponsorDeliverableId}"] .partner-deliverable-review[data-status="approved"]`)).toContainText("Partner review: approved");
  await freshSponsorPortal.close();

  const refreshedSponsorPartners = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET");
  await page.locator("#admin-load-partners").click();
  await refreshedSponsorPartners;
  await expect(sponsorCard).toContainText("$5,000.00 / $5,000.00");
  await expect(sponsorCard.locator(`[data-partner-invoice="${createdInvoice.id}"]`)).toContainText("$0.00 open");
  const boardPartnerPayment = sponsorCard.locator(`[data-partner-payment="${partnerPayment.receipt.paymentId}"]`);
  await expect(boardPartnerPayment).toContainText("card");
  await expect(boardPartnerPayment).toContainText("board:pi_board_");
  await expect(sponsorPaymentMilestone.locator('[name="status"]')).toHaveValue("completed");
  await freshSponsorDeliverable().locator('[name="status"]').selectOption("complete");
  const freshSponsorDeliverableCompletion = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/deliverables/${freshSponsorDeliverableId}` && response.request().method() === "PATCH");
  await freshSponsorDeliverable().locator("[data-save-deliverable]").click();
  expect((await freshSponsorDeliverableCompletion).status()).toBe(200);
  await expect(freshSponsorFulfillment()).toContainText("1/6 complete");
  await expect(freshSponsorDeliverable().locator('[data-status="approved"]')).toHaveText("approved");

  const sponsorShowcasePage = await page.context().newPage();
  sponsorShowcasePage.on("pageerror", error => pageErrors.push(`Sponsor showcase: ${error.message}`));
  await sponsorShowcasePage.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  const freshSponsorShowcase = sponsorShowcasePage.locator("#public-sponsor-showcase .public-sponsor-card").filter({ hasText: sponsorName });
  await expect(freshSponsorShowcase).toHaveCount(1);
  await expect(freshSponsorShowcase).toContainText("Tarpon partner");
  await expect(freshSponsorShowcase).toContainText("Healthier coast, stronger community");
  await expect(freshSponsorShowcase.locator("img")).toHaveAttribute("src", new RegExp(`/api/public/sponsor-showcase/assets/${uploadedSponsorBrandAsset.id}$`));
  await expect.poll(() => freshSponsorShowcase.locator("img").evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await sponsorShowcasePage.close();

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
  await taskForm.locator('[name="dueAt"]').fill("2027-04-09T10:00");
  await taskForm.locator('[name="description"]').fill("Welcome arriving volunteers and route them to their assigned captain.");
  const taskResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners/tasks" && response.request().method() === "POST");
  await taskForm.locator('button[type="submit"]').click();
  const createdTaskResponse = await taskResponse;
  expect(createdTaskResponse.status()).toBe(201);
  const createdVolunteerTask = (await createdTaskResponse.json()).task;
  expect(createdVolunteerTask.assigneeType).toBe("volunteer");
  expect(createdVolunteerTask.assigneeId).toBe(volunteerId);
  expect(createdVolunteerTask.dueAt).toBeTruthy();
  await expect(page.locator("#admin-api-status")).toContainText("Task delegated.");
  await expect(page.locator("#admin-partner-tasks")).toContainText(taskTitle);

  const milestoneForm = page.locator("#admin-create-milestone");
  await milestoneForm.locator('[name="applicationId"]').selectOption(sponsorResult.application.id);
  await milestoneForm.locator('[name="label"]').fill(milestoneLabel);
  await milestoneForm.locator('[name="dueAt"]').fill(milestoneDueInput);
  await milestoneForm.locator('[name="assigneeTeam"]').selectOption("sponsor");
  const milestonePath = `/api/admin/partners/applications/${sponsorResult.application.id}/milestones`;
  const milestoneResponse = page.waitForResponse(response => new URL(response.url()).pathname === milestonePath && response.request().method() === "POST");
  await milestoneForm.locator('button[type="submit"]').click();
  const createdMilestoneResponse = await milestoneResponse;
  expect(createdMilestoneResponse.status()).toBe(201);
  const createdSponsorMilestone = (await createdMilestoneResponse.json()).milestone;
  expect(createdSponsorMilestone.applicationId).toBe(sponsorResult.application.id);
  expect(createdSponsorMilestone.status).toBe("open");
  expect(createdSponsorMilestone.reminderLeadDays).toBe(3);
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
  const centerSource = campaignForm.locator('[name="centerSource"]');
  const centerLatitude = campaignForm.locator('[name="centerLatitude"]');
  const centerLongitude = campaignForm.locator('[name="centerLongitude"]');
  const centerPreview = campaignForm.locator("#admin-campaign-center-preview");
  await expect(centerSource.locator("option").filter({ hasText: prospectName })).toHaveCount(1);
  await centerSource.selectOption("sandfest");
  await expect(centerLatitude).toHaveValue("27.8339");
  await expect(centerLongitude).toHaveValue("-97.0611");
  await centerLatitude.fill("27.834");
  await expect(centerSource).toHaveValue("custom");
  await centerSource.selectOption(`prospect:${createdProspect.id}`);
  await expect(centerLatitude).toHaveValue("27.8339");
  await expect(centerLongitude).toHaveValue("-97.0611");
  await campaignForm.locator('[name="radiusMiles"]').fill("5");
  await expect(centerPreview).toHaveAttribute("data-state", "ready");
  await expect(centerPreview).toContainText(prospectName);
  await expect(centerPreview).toContainText("inside a 5-mile radius");
  await expect(centerPreview).toContainText("Server qualification applies every other campaign filter");
  await campaignForm.locator('[name="minFitScore"]').fill("0");
  await campaignForm.locator('[name="deliveryMode"]').selectOption("approved_sequence");
  await campaignForm.locator('[name="dailySendLimit"]').fill("3");
  const audiencePreview = campaignForm.locator("#admin-campaign-audience-preview");
  const previewButton = campaignForm.locator("#admin-preview-campaign");
  const createCampaignButton = campaignForm.locator('button[type="submit"]');
  await expect(createCampaignButton).toBeDisabled();
  const campaignPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/campaigns/preview" && response.request().method() === "POST");
  await previewButton.click();
  const previewResult = await campaignPreviewResponse;
  expect(previewResult.status()).toBe(200);
  expect((await previewResult.json()).preview.matches[0]).not.toHaveProperty("contactEmail");
  await expect(audiencePreview).toHaveAttribute("data-state", "ready");
  await expect(audiencePreview).toContainText("1 business qualifies");
  await expect(audiencePreview).toContainText(prospectName);
  await expect(audiencePreview).toContainText(`A Texas SandFest partnership for ${prospectName}`);
  await expect(audiencePreview).not.toContainText(prospectRecipient);
  await expect(createCampaignButton).toBeEnabled();
  await campaignForm.locator('[name="dailySendLimit"]').fill("4");
  await expect(audiencePreview).toHaveAttribute("data-state", "stale");
  await expect(createCampaignButton).toBeDisabled();
  await campaignForm.locator('[name="dailySendLimit"]').fill("3");
  const refreshedCampaignPreviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/campaigns/preview" && response.request().method() === "POST");
  await previewButton.click();
  expect((await refreshedCampaignPreviewResponse).status()).toBe(200);
  await expect(createCampaignButton).toBeEnabled();
  const campaignResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach/campaigns" && response.request().method() === "POST");
  await createCampaignButton.click();
  const createdCampaignResponse = await campaignResponse;
  expect(createdCampaignResponse.status()).toBe(201);
  const createdCampaign = (await createdCampaignResponse.json()).campaign;
  await expect(centerSource).toHaveValue(`prospect:${createdProspect.id}`);
  await expect(centerLatitude).toHaveValue("27.8339");
  await expect(centerLongitude).toHaveValue("-97.0611");
  const campaignCard = page.locator(`[data-outreach-campaign="${createdCampaign.id}"]`);
  await expect(campaignCard).toContainText(campaignName);
  await expect(campaignCard).toContainText("1 matched");
  await expect(campaignCard).toContainText("campaign-approved, 3/day");
  const campaignOutcomeFunnel = campaignCard.locator(`[data-campaign-outcomes="${createdCampaign.id}"]`);
  await expect(campaignOutcomeFunnel).toBeVisible();
  await expect(campaignOutcomeFunnel.locator('[data-outcome-stage="reached"] strong')).toHaveText("0");
  await expect(campaignOutcomeFunnel.locator('[data-outcome-stage="applications"] strong')).toHaveText("0");
  const outreachMap = page.locator("#admin-outreach-targeting-map");
  const outreachMapCampaign = outreachMap.locator("#admin-outreach-map-campaign");
  await outreachMapCampaign.selectOption(createdCampaign.id);
  await expect(outreachMap).toHaveAttribute("data-campaign-id", createdCampaign.id);
  await expect(outreachMapCampaign).toHaveValue(createdCampaign.id);
  const centeredProspect = outreachMap.locator(`[data-outreach-map-prospect="${createdProspect.id}"]`);
  await expect(centeredProspect).toHaveAttribute("data-inside", "true");
  await expect(centeredProspect).toHaveAttribute("data-at-center", "true");
  await expect(outreachMap.locator(`[data-outreach-map-row="${createdProspect.id}"]`)).toContainText("0.0 mi · inside radius");
  await expect(outreachMap.getByText("server matched").locator("..")).toContainText("1");
  await expect(outreachMap.getByRole("img")).toHaveAttribute("aria-label", /1 prospect matches all server campaign filters/);
  const centerDot = await outreachMap.locator(".admin-outreach-map-center i").boundingBox();
  const prospectRing = await centeredProspect.locator("i").boundingBox();
  const centerLabel = await outreachMap.locator(".admin-outreach-map-center b").boundingBox();
  const prospectLabel = await centeredProspect.locator("b").boundingBox();
  expect(centerDot).not.toBeNull();
  expect(prospectRing).not.toBeNull();
  expect(centerLabel).not.toBeNull();
  expect(prospectLabel).not.toBeNull();
  expect(prospectRing.width).toBeGreaterThan(centerDot.width);
  expect(Math.abs((prospectRing.x + prospectRing.width / 2) - (centerDot.x + centerDot.width / 2))).toBeLessThan(1);
  expect(Math.abs((prospectRing.y + prospectRing.height / 2) - (centerDot.y + centerDot.height / 2))).toBeLessThan(1);
  expect(prospectLabel.y).toBeGreaterThanOrEqual(centerLabel.y + centerLabel.height + 4);
  const alternateCampaignId = await outreachMapCampaign.locator("option").evaluateAll((options, currentId) => options.find(option => option.value !== currentId)?.value || "", createdCampaign.id);
  expect(alternateCampaignId).not.toBe("");
  await outreachMapCampaign.selectOption(alternateCampaignId);
  await expect(outreachMap).toHaveAttribute("data-campaign-id", alternateCampaignId);
  await outreachMap.locator("#admin-outreach-map-campaign").selectOption(createdCampaign.id);
  await expect(outreachMap).toHaveAttribute("data-campaign-id", createdCampaign.id);
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
  await expect(campaignOutcomeFunnel.locator('[data-outcome-stage="reached"] strong')).toHaveText("1");
  await expect(campaignOutcomeFunnel.locator('[data-outcome-stage="delivered"] strong')).toHaveText("1");
  await expect(campaignOutcomeFunnel.locator('[data-outcome-stage="opened"] strong')).toHaveText("0");
  await expect(campaignOutcomeFunnel.locator('[data-outcome-stage="clicked"] strong')).toHaveText("0");

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
  await expect(campaignOutcomeFunnel.locator('[data-outcome-stage="applications"] strong')).toHaveText("1");
  await expect(page.locator("#admin-partner-activity")).toContainText("Sponsor target converted");

  const automationForm = page.locator("#admin-partner-automation");
  await automationForm.locator('[name="mode"]').selectOption("transactional_auto");
  page.once("dialog", dialog => dialog.accept());
  const automationResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners/automation" && response.request().method() === "PATCH");
  await automationForm.locator('button[type="submit"]').click();
  expect((await automationResponse).status()).toBe(200);
  await expect(page.locator("#admin-api-status")).toContainText("Transactional partner automation is active.");
  await expect(messagingKpi).toContainText("Automatic");
  await expect(commandSignals.locator('[data-command-signal="messages"]')).toContainText("automatic follow-up");

  const sponsorAcknowledgmentSubject = `Texas SandFest sponsorship application ${sponsorResult.application.reference}`;
  let deliveredPaymentConfirmationId = null;
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const confirmation = payload.followups?.find(item => item.applicationId === sponsorResult.application.id
      && item.paymentId === partnerPayment.receipt.paymentId
      && item.kind === "payment_received"
      && item.automationPolicy === "partner_transactional_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered"
      && item.body?.includes("$5,000.00")
      && item.body?.includes("private partner portal")
      && item.body?.includes("paid in full")
      && !item.body?.includes("board:pi_board_")
      && !item.body?.includes("Postgres durability verification"));
    deliveredPaymentConfirmationId = confirmation?.id || null;
    return Boolean(deliveredPaymentConfirmationId);
  }, { timeout: 15_000 }).toBe(true);
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
  let deliveredTaskAssignmentId = null;
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const assignment = payload.followups?.find(item => item.taskId === createdVolunteerTask.id
      && item.kind === "task_assignment"
      && item.subject === `Texas SandFest task assigned - ${taskTitle}`
      && item.automationPolicy === "partner_transactional_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered");
    deliveredTaskAssignmentId = assignment?.id || null;
    return Boolean(deliveredTaskAssignmentId);
  }, { timeout: 15_000 }).toBe(true);
  let deliveredMilestoneReminderId = null;
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const reminder = payload.followups?.find(item => item.milestoneId === createdSponsorMilestone.id
      && item.kind === "milestone_reminder"
      && item.reminderPhase === "upcoming"
      && item.subject === `Texas SandFest ${milestoneLabel.toLowerCase()} reminder - ${sponsorResult.application.reference}`
      && item.automationPolicy === "partner_transactional_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered");
    deliveredMilestoneReminderId = reminder?.id || null;
    return Boolean(deliveredMilestoneReminderId);
  }, { timeout: 15_000 }).toBe(true);
  let deliveredSponsorProofReviewId = null;
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const proofReview = payload.followups?.find(item => item.kind === "sponsor_deliverable_review"
      && item.automationPolicy === "partner_transactional_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered"
      && item.body?.includes("private sponsor portal")
      && !item.body?.includes("gulf-shore-credit-union"));
    deliveredSponsorProofReviewId = proofReview?.id || null;
    return Boolean(deliveredSponsorProofReviewId);
  }, { timeout: 15_000 }).toBe(true);
  let deliveredVendorOpeningId = null;
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const opening = payload.followups?.find(item => item.kind === "vendor_applications_open"
      && item.automationPolicy === "partner_transactional_v1"
      && item.status === "sent"
      && item.deliveryStatus === "delivered"
      && item.body?.includes("has not been converted into an application")
      && item.body?.includes("vendorOffering=marketplace-booth")
      && item.body?.includes("vendorCategory=service")
      && !item.body?.includes("cameron.brooks@example.com"));
    deliveredVendorOpeningId = opening?.id || null;
    return Boolean(deliveredVendorOpeningId);
  }, { timeout: 15_000 }).toBe(true);
  const reloadPartners = Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET"),
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach" && response.request().method() === "GET")
  ]);
  await page.locator("#admin-load-partners").click();
  await reloadPartners;
  const deliveredPaymentConfirmation = page.locator(`#admin-partner-followups [data-followup="${deliveredPaymentConfirmationId}"]`);
  await expect(deliveredPaymentConfirmation).toHaveCount(1);
  await expect(deliveredPaymentConfirmation).toHaveAttribute("data-delivery-status", "delivered");
  await expect(deliveredPaymentConfirmation).toContainText("automatic payment confirmation");
  await expect(deliveredPaymentConfirmation).toContainText("$5,000.00");
  await expect(deliveredPaymentConfirmation).toContainText("paid in full");
  await expect(deliveredPaymentConfirmation).not.toContainText("board:pi_board_");
  const deliveredFollowup = page.locator(`#admin-partner-followups [data-followup="${deliveredSponsorAcknowledgmentId}"]`);
  await expect(deliveredFollowup).toHaveCount(1);
  await expect(deliveredFollowup).toHaveAttribute("data-delivery-status", "delivered");
  await expect(deliveredFollowup).toContainText(sponsorRecipient);
  await expect(deliveredFollowup).toContainText(sponsorAcknowledgmentSubject);
  await expect(deliveredFollowup).toContainText("transactional automation");

  const deliveredTaskAssignment = page.locator(`#admin-partner-followups [data-followup="${deliveredTaskAssignmentId}"]`);
  await expect(deliveredTaskAssignment).toHaveCount(1);
  await expect(deliveredTaskAssignment).toHaveAttribute("data-delivery-status", "delivered");
  await expect(deliveredTaskAssignment).toContainText(`Texas SandFest task assigned - ${taskTitle}`);
  await expect(deliveredTaskAssignment).toContainText("transactional automation");
  const deliveredMilestoneReminder = page.locator(`#admin-partner-followups [data-followup="${deliveredMilestoneReminderId}"]`);
  await expect(deliveredMilestoneReminder).toHaveCount(1);
  await expect(deliveredMilestoneReminder).toHaveAttribute("data-delivery-status", "delivered");
  await expect(deliveredMilestoneReminder).toContainText(`Texas SandFest ${milestoneLabel.toLowerCase()} reminder`);
  await expect(deliveredMilestoneReminder).toContainText("automatic key-date reminder");
  const deliveredSponsorProofReview = page.locator(`#admin-partner-followups [data-followup="${deliveredSponsorProofReviewId}"]`);
  await expect(deliveredSponsorProofReview).toHaveCount(1);
  await expect(deliveredSponsorProofReview).toHaveAttribute("data-delivery-status", "delivered");
  await expect(deliveredSponsorProofReview).toContainText("Texas SandFest sponsor proof ready");
  await expect(deliveredSponsorProofReview).toContainText("automatic sponsor proof review");
  const deliveredVendorOpening = page.locator(`#admin-partner-followups [data-followup="${deliveredVendorOpeningId}"]`);
  await expect(deliveredVendorOpening).toHaveCount(1);
  await expect(deliveredVendorOpening).toHaveAttribute("data-delivery-status", "delivered");
  await expect(deliveredVendorOpening).toContainText("Texas SandFest vendor applications are open");
  await expect(deliveredVendorOpening).toContainText("has not been converted into an application");
  await expect(deliveredVendorOpening).toContainText("transactional automation");
  const freshSponsorMilestone = page.locator(`#admin-partner-milestones [data-admin-milestone="${createdSponsorMilestone.id}"]`);
  await expect(freshSponsorMilestone).toContainText(milestoneLabel);
  await expect(freshSponsorMilestone).toContainText("latest reminder upcoming (sent)");
  await freshSponsorMilestone.locator('[name="status"]').selectOption("completed");
  const completedMilestoneResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/milestones/${createdSponsorMilestone.id}` && response.request().method() === "PATCH");
  await freshSponsorMilestone.locator('[data-save-milestone]').click();
  const completedMilestoneResult = await completedMilestoneResponse;
  expect(completedMilestoneResult.status()).toBe(200);
  const completedMilestone = (await completedMilestoneResult.json()).milestone;
  expect(completedMilestone.status).toBe("completed");
  expect(completedMilestone.completedAt).toBeTruthy();
  await expect(page.locator("#admin-api-status")).toContainText("Key date saved.");
  await expect(freshSponsorMilestone.locator('[name="status"]')).toHaveValue("completed");
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const milestone = payload.milestones?.find(item => item.id === createdSponsorMilestone.id);
    const reminders = payload.followups?.filter(item => item.milestoneId === createdSponsorMilestone.id && item.kind === "milestone_reminder") || [];
    const activeReminders = reminders.filter(item => !["dismissed", "sent"].includes(item.status));
    return milestone?.status === "completed"
      && Boolean(milestone.completedAt)
      && reminders.length === 1
      && reminders[0].deliveryStatus === "delivered"
      && activeReminders.length === 0;
  }, { timeout: 15_000 }).toBe(true);
  const freshVolunteerTask = page.locator(`#admin-partner-tasks [data-task="${createdVolunteerTask.id}"]`);
  await expect(freshVolunteerTask).toContainText(taskTitle);
  await expect(freshVolunteerTask).toContainText("Assignment notices · 1 issued · latest delivered");
  await expect(freshVolunteerTask).toContainText("Awaiting assignee acknowledgement");
  const resendTaskNoticeResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/tasks/${createdVolunteerTask.id}/assignment-notice` && response.request().method() === "POST");
  await freshVolunteerTask.locator('[data-resend-task]').click();
  const resendTaskNoticeResult = await resendTaskNoticeResponse;
  expect(resendTaskNoticeResult.status()).toBe(202);
  const resentTaskNotice = await resendTaskNoticeResult.json();
  expect(resentTaskNotice.task.assignmentNoticeVersion).toBe(1);
  expect(resentTaskNotice.notice.sourceVersion).toBe("assignment:1:notice:1");
  expect(JSON.stringify(resentTaskNotice)).not.toContain("tsft_");
  await expect(page.locator("#admin-api-status")).toContainText("Assignment notice queued.");
  let resentTaskDeliveryProof = null;
  const resentTaskDeliveryDeadline = Date.now() + 15_000;
  while (Date.now() < resentTaskDeliveryDeadline) {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const notices = payload.followups?.filter(item => item.taskId === createdVolunteerTask.id && item.kind === "task_assignment") || [];
    const latest = notices.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    resentTaskDeliveryProof = {
      notices: notices.map(item => ({
        id: item.id,
        sourceVersion: item.sourceVersion,
        status: item.status,
        deliveryStatus: item.deliveryStatus,
        providerMessageId: item.providerMessageId,
        lastError: item.lastError
      })),
      automation: payload.automation
    };
    if (notices.length === 2 && latest?.sourceVersion === "assignment:1:notice:1" && latest?.deliveryStatus === "delivered") break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  expect(
    resentTaskDeliveryProof?.notices?.length === 2
      && resentTaskDeliveryProof.notices[0]?.sourceVersion === "assignment:1:notice:1"
      && resentTaskDeliveryProof.notices[0]?.deliveryStatus === "delivered",
    JSON.stringify({ ...resentTaskDeliveryProof, worker: workerProcess.output().slice(-5_000) }, null, 2)
  ).toBe(true);
  const resentTaskReload = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET");
  await page.locator("#admin-load-partners").click();
  await resentTaskReload;
  await expect(freshVolunteerTask).toContainText("Assignment notices · 2 issued · latest delivered");
  await expect(freshVolunteerTask.locator('[data-resend-task]')).toBeEnabled();
  await expect(freshVolunteerTask.locator('[data-resend-task]')).toHaveText("Resend notice");

  const taskPortalConfigForBrowser = taskPortalConfig({
    SANDFEST_ENV: "development",
    SANDFEST_TASK_PORTAL_SECRET: PORTAL_SECRET,
    SANDFEST_PUBLIC_SITE_URL: webBase
  });
  const taskPortalUrl = taskPortalUrlForTask(createdVolunteerTask, { config: taskPortalConfigForBrowser });
  expect(taskPortalUrl).toContain("#task-status?task=");
  const taskPortalBrowserUrl = new URL(taskPortalUrl);
  taskPortalBrowserUrl.searchParams.set("apiBase", apiBase);
  const taskPage = await page.context().newPage();
  await taskPage.setViewportSize({ width: 360, height: 780 });
  await taskPage.goto(taskPortalBrowserUrl.toString());
  await expect(taskPage).toHaveURL(/#task-status$/);
  await expect(taskPage.locator("#task-status-result")).toContainText(taskTitle);
  await expect(taskPage.locator("#task-status-result")).toBeFocused();
  await expect(taskPage.locator('[data-task-action="acknowledge"]')).toBeVisible();
  await assertNoHorizontalOverflow(taskPage);

  const acknowledgedTaskResponse = taskPage.waitForResponse(response => new URL(response.url()).pathname === "/api/public/task-status/update" && response.request().method() === "POST");
  await taskPage.locator('[data-task-action="acknowledge"]').click();
  expect((await acknowledgedTaskResponse).status()).toBe(200);
  await expect(taskPage.locator("#task-status-result")).toContainText("Acknowledged");

  const startedTaskResponse = taskPage.waitForResponse(response => new URL(response.url()).pathname === "/api/public/task-status/update" && response.request().method() === "POST");
  await taskPage.locator('[data-task-action="start"]').click();
  const startedTaskResult = await startedTaskResponse;
  expect(startedTaskResult.status()).toBe(200);
  const startedTask = (await startedTaskResult.json()).task;
  expect(startedTask.status).toBe("in_progress");
  expect(startedTask.startedAt).toBeTruthy();
  await expect(taskPage.locator("#task-status-result")).toHaveAttribute("data-state", "in_progress");
  await taskPage.locator('#task-status-update [name="note"]').fill("Need two more welcome packets at the north gate.");
  const blockedTaskResponse = taskPage.waitForResponse(response => new URL(response.url()).pathname === "/api/public/task-status/update" && response.request().method() === "POST");
  await taskPage.locator('[data-task-action="block"]').click();
  expect((await blockedTaskResponse).status()).toBe(200);
  await expect(taskPage.locator("#task-status-result")).toContainText("Need two more welcome packets at the north gate.");

  const assigneeReload = Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET"),
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach" && response.request().method() === "GET")
  ]);
  await page.locator("#admin-load-partners").click();
  await assigneeReload;
  await expect(freshVolunteerTask).toContainText("Acknowledged");
  await expect(freshVolunteerTask).toContainText("Latest assignee note");
  await expect(freshVolunteerTask).toContainText("Need two more welcome packets at the north gate.");

  await taskPage.locator('#task-status-update [name="note"]').fill("Welcome packets delivered and captain briefed.");
  const completedTaskResponse = taskPage.waitForResponse(response => new URL(response.url()).pathname === "/api/public/task-status/update" && response.request().method() === "POST");
  await taskPage.locator('[data-task-action="complete"]').click();
  const completedTaskResult = await completedTaskResponse;
  expect(completedTaskResult.status()).toBe(200);
  const completedTask = (await completedTaskResult.json()).task;
  expect(completedTask.status).toBe("done");
  expect(completedTask.startedAt).toBe(startedTask.startedAt);
  expect(completedTask.completedAt).toBeTruthy();
  await expect(taskPage.locator("#task-status-result")).toHaveAttribute("data-state", "done");
  await expect(taskPage.locator("#task-status-update")).toBeHidden();
  await assertNoHorizontalOverflow(taskPage);
  await taskPage.close();

  const completedTaskReload = Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/partners" && response.request().method() === "GET"),
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/outreach" && response.request().method() === "GET")
  ]);
  await page.locator("#admin-load-partners").click();
  await completedTaskReload;
  await page.locator("#admin-task-status-filter").selectOption("done");
  await expect(freshVolunteerTask).toContainText(taskTitle);
  await expect(freshVolunteerTask.locator('[name="status"]')).toHaveValue("done");
  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const task = payload.tasks?.find(item => item.id === createdVolunteerTask.id);
    const assignments = payload.followups?.filter(item => item.taskId === createdVolunteerTask.id && item.kind === "task_assignment") || [];
    const activeOverdue = payload.followups?.filter(item => item.taskId === createdVolunteerTask.id
      && item.kind === "task_overdue"
      && !["dismissed", "sent"].includes(item.status)) || [];
    return task?.status === "done"
      && Boolean(task.startedAt)
      && Boolean(task.completedAt)
      && assignments.length === 2
      && assignments.every(item => item.deliveryStatus === "delivered")
      && activeOverdue.length === 0;
  }, { timeout: 15_000 }).toBe(true);

  const transactionRefresh = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/audit" && response.request().method() === "GET");
  await page.locator("#admin-load-orders").click();
  expect((await transactionRefresh).status()).toBe(200);
  const populatedAuditRegionMetrics = await page.locator("#admin-audit-list").evaluate(region => ({
    clientHeight: region.clientHeight,
    scrollHeight: region.scrollHeight
  }));
  expect(populatedAuditRegionMetrics.scrollHeight).toBeGreaterThan(populatedAuditRegionMetrics.clientHeight);
  expect(await page.locator("#admin-audit-list [data-audit-action]").count()).toBeGreaterThan(0);
  expect(await page.locator("#admin-job-list [data-automation-row]").count()).toBeGreaterThan(0);
  await expect(page.locator("#admin-job-list")).not.toContainText(/job_|followup_|@/);
  await expect(page.locator("#admin-system-monitor .admin-record-card code")).toHaveCount(0);
  await expect(page.locator("#admin-system-monitor")).not.toContainText(/data\/processed|db:\/\/|admin-audit\//);

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
  await expect(page.locator("#island-condition-updated")).toContainText("Board simulation");
  await expect(page.locator("#island-condition-kpis article").filter({ hasText: "Island load" })).toContainText(/\d+ simulated feeds across \d+ armed sources/);
  await expect(page.locator("#island-condition-kpis article").filter({ hasText: "Ferry wait" })).toContainText("simulated");
  await expect(page.locator("#island-camera-grid")).not.toContainText("operationally live");
  expect(pageErrors).toEqual([]);
});

test("operations command summary fits and navigates across board viewports", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  const commandSignals = page.locator("#admin-command-signals [data-command-signal]");
  await expect(commandSignals).toHaveCount(8);
  await expect(commandSignals.last()).toBeInViewport({ ratio: 1 });
  const commandBounds = await commandSignals.evaluateAll(cards => cards.map(card => {
    const bounds = card.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom };
  }));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(commandBounds.every(bounds => bounds.top >= 0 && bounds.bottom <= 720)).toBe(true);
  const commandTargets = {
    applications: { id: "admin-partner-applications-workspace", heading: "Applications and accounting" },
    receivables: { id: "admin-receivables-workspace", heading: "Open accounts" },
    messages: { id: "admin-partner-followups-workspace", heading: "Message drafts" },
    assignments: { id: "admin-partner-tasks-workspace", heading: "Staff and volunteer work board" },
    "key-dates": { id: "admin-partner-milestones-workspace", heading: "Partner key dates and reminder cadence" },
    sponsors: { id: "admin-sponsor-fulfillment-workspace", heading: "Sponsor brand and benefit fulfillment" },
    vendors: { id: "admin-vendor-readiness-workspace", heading: "Vendor compliance and load-in readiness" },
    outreach: { id: "admin-outreach-prospects-workspace", heading: "Outreach pipeline" }
  };
  for (const [signal, { id: targetId, heading }] of Object.entries(commandTargets)) {
    await page.locator(`[data-command-signal="${signal}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
    await expect.poll(() => page.evaluate(({ id, heading }) => {
      const target = document.getElementById(id);
      const workspaceNav = document.querySelector(".admin-workspace-nav");
      const bounds = target?.getBoundingClientRect();
      return Boolean(bounds
        && bounds.top >= (workspaceNav?.getBoundingClientRect().bottom || 0)
        && bounds.top < window.innerHeight
        && target.contains(document.activeElement)
        && document.activeElement?.textContent?.trim() === heading);
    }, { id: targetId, heading }), { timeout: 500 }).toBe(true);
  }
  await page.locator('[data-command-signal="applications"]').focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => {
    const target = document.querySelector("#admin-partner-applications-workspace");
    const active = document.activeElement;
    return Boolean(target?.contains(active)
      && active?.textContent?.trim() === "Applications and accounting"
      && getComputedStyle(active).outlineStyle !== "none");
  }), { timeout: 500 }).toBe(true);
  const firstFollowup = page.locator("#admin-partner-followups [data-followup]").first();
  await expect(firstFollowup.locator('[data-review-followup][data-action="approve"]')).toBeVisible();
  const editedFollowupId = await firstFollowup.getAttribute("data-followup");
  await firstFollowup.locator("summary").click();
  const draftSubject = firstFollowup.locator('.admin-followup-editor input[aria-label="Message subject"]');
  const draftBody = firstFollowup.locator('.admin-followup-editor textarea[aria-label="Message body"]');
  const editedSubject = `${await draftSubject.inputValue()} | Browser reviewed`;
  await draftSubject.fill(editedSubject);
  await draftBody.fill(`${await draftBody.inputValue()}\n\nReviewed in Operations before approval.`);
  const editResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/partners/followups/${editedFollowupId}/draft` && response.request().method() === "PATCH");
  await firstFollowup.locator("[data-save-draft]").click();
  const editResponse = await editResponsePromise;
  expect(editResponse.status()).toBe(200);
  await expect(page.locator(`#admin-partner-followups [data-followup="${editedFollowupId}"] header strong`)).toHaveText(editedSubject);
  await expect(page.locator(`#admin-partner-followups [data-followup="${editedFollowupId}"] [data-review-followup][data-action="approve"]`)).toBeVisible();
  const reviewReadyOutreach = page.locator("#admin-partner-followups [data-followup]")
    .filter({ hasText: "outreach sequence" })
    .filter({ has: page.locator('[data-review-followup][data-action="approve"]') });
  await expect(reviewReadyOutreach).toHaveCount(1);
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 768, height: 844 });
  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  const readinessFilterButtons = page.locator(".admin-readiness-filter button");
  await expect(readinessFilterButtons).toHaveCount(2);
  for (const button of await readinessFilterButtons.all()) {
    await expect.poll(() => button.evaluate(element => (
      element.scrollWidth <= element.clientWidth + 1
      && element.scrollHeight <= element.clientHeight + 1
    ))).toBe(true);
  }
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await expect(page.locator("#admin-command-signals [data-command-signal]")).toHaveCount(8);
  for (const [signal, { id: targetId, heading }] of Object.entries(commandTargets)) {
    await page.locator(`[data-command-signal="${signal}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#${targetId}$`));
    await expect.poll(() => page.evaluate(({ id, heading }) => {
      const target = document.getElementById(id);
      const workspaceNav = document.querySelector(".admin-workspace-nav");
      const bounds = target?.getBoundingClientRect();
      return Boolean(bounds
        && bounds.top >= (workspaceNav?.getBoundingClientRect().bottom || 0)
        && bounds.top < window.innerHeight
        && target.contains(document.activeElement)
        && document.activeElement?.textContent?.trim() === heading);
    }, { id: targetId, heading }), { timeout: 500 }).toBe(true);
  }
  await assertNoHorizontalOverflow(page);
});

test("prepared partner portals land on authenticated status at mobile width", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
  const admin = await context.newPage();
  try {
    await admin.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
    await expect(admin.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });

    for (const organizationName of ["Gulf Shore Credit Union", "Coastal Bites"]) {
      const application = admin.locator("#admin-partner-applications [data-partner-application]").filter({ hasText: organizationName });
      await expect(application).toHaveCount(1);
      const popupPromise = admin.waitForEvent("popup");
      await application.locator("[data-open-demo-portal]").click();
      const portal = await popupPromise;
      await expect(portal.locator("#partner-status-result")).toContainText(organizationName);
      await expect(portal.locator("#partner-status-result")).toBeFocused();
      await assertTargetClearsTopbar(portal, "#partner-status-result", 12);
      await expect(portal.locator(".partner-status-heading h3")).toBeInViewport();
      expect(await portal.locator(".partner-status-next").evaluate(nextStep => {
        const [label, title, target] = nextStep.children;
        const labelBounds = label.getBoundingClientRect();
        const titleBounds = title.getBoundingClientRect();
        const targetBounds = target.getBoundingClientRect();
        return labelBounds.bottom <= titleBounds.top && titleBounds.bottom <= targetBounds.top;
      })).toBe(true);
      await assertChoiceTargets(portal, `${organizationName} partner portal`);
      await assertNoHorizontalOverflow(portal);
      await portal.close();
    }
  } finally {
    await context.close();
  }
});

test("visitor hero and navigation stay ordered across intermediate widths", async ({ page }) => {
  for (const width of [768, 1024, 1160]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
    await expect(page.locator(".hero h1")).toHaveText("Texas SandFest");
    await expect(page.locator(".hero-actions")).toBeInViewport({ ratio: 1 });
    await expect(page.locator("#public-navigation")).toBeHidden();
    await expect(page.locator("#mobile-nav-toggle")).toBeVisible();
    const layout = await page.locator(".hero").evaluate(hero => {
      const rect = selector => hero.querySelector(selector).getBoundingClientRect();
      const values = [".hero-content", ".motion-console", ".event-card"].map(rect);
      return {
        hero: hero.getBoundingClientRect().toJSON(),
        content: values[0].toJSON(),
        motion: values[1].toJSON(),
        event: values[2].toJSON()
      };
    });
    expect(layout.content.top).toBeGreaterThanOrEqual(layout.hero.top);
    expect(layout.content.bottom).toBeLessThan(layout.motion.top);
    expect(layout.content.bottom).toBeLessThan(layout.event.top);
    expect(layout.motion.right).toBeLessThan(layout.event.left);
    expect(layout.motion.bottom).toBeLessThanOrEqual(layout.hero.bottom);
    expect(layout.event.bottom).toBeLessThanOrEqual(layout.hero.bottom);
    await assertNoHorizontalOverflow(page);
    if (width === 1024) {
      await page.locator("#mobile-nav-toggle").click();
      await expect(page.locator("#public-navigation")).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await page.keyboard.press("Escape");
      await expect(page.locator("#public-navigation")).toBeHidden();
    }
  }

  await page.setViewportSize({ width: 1240, height: 720 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
  await expect(page.locator("#public-navigation")).toBeHidden();
  await expect(page.locator("#mobile-nav-toggle")).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1241, height: 720 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
  await expect(page.locator("#public-navigation")).toBeVisible();
  await expect(page.locator("#mobile-nav-toggle")).toBeHidden();
  expect(await page.locator("#public-navigation").evaluate(navigation => [...navigation.querySelectorAll('a[data-audience="ops"]')]
    .filter(link => link.getClientRects().length > 0)
    .map(link => ({ label: link.textContent.trim(), href: link.getAttribute("href") })))).toEqual([]);
  await assertNoHorizontalOverflow(page);
});

test("visitor view switch opens the dedicated operations portal", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
  const operationsSurface = page.locator("[data-operations-surface]");
  await expect(operationsSurface).toBeVisible();
  await expect(operationsSurface).toHaveAttribute("href", `${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await operationsSurface.click();
  await expect(page).toHaveURL(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}`);
  await expect(page).toHaveTitle("Texas SandFest Operations");
  await expect(page.locator("#admin-config h1")).toHaveText("Festival operations command center");
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await expect(page.locator("header nav")).toHaveCount(0);
  await expect(page.locator(".admin-workspace-nav")).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("canonical iOS links retain safe visitor web fallbacks", async ({ page }) => {
  let conciergeRequests = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/public/concierge") conciergeRequests += 1;
  });

  const ticketsUrl = new URL("/tickets", webBase);
  ticketsUrl.searchParams.set("apiBase", apiBase);
  await page.goto(ticketsUrl.toString());
  await expect(page).toHaveURL(/\/tickets\?[^#]+#tickets$/);
  await expect(page.locator("#tickets")).toBeInViewport({ ratio: 0.1 });

  const sandyUrl = new URL("/sandy", webBase);
  sandyUrl.searchParams.set("apiBase", apiBase);
  sandyUrl.searchParams.set("question", "Where is ADA parking?");
  await page.goto(sandyUrl.toString());
  await expect(page).toHaveURL(/\/sandy\?[^#]+#concierge$/);
  await expect(page.locator("#ask-input")).toHaveValue("Where is ADA parking?");
  await expect(page.locator("#chat .concierge-answer")).toHaveCount(0);
  expect(conciergeRequests).toBe(0);

  const sculptorsUrl = new URL("/sculptors", webBase);
  sculptorsUrl.searchParams.set("apiBase", apiBase);
  await page.goto(sculptorsUrl.toString());
  await expect(page).toHaveURL(/\/sculptors\?[^#]+#sculptors-showcase$/);
  await expect(page.locator("#sculptors-showcase")).toBeInViewport({ ratio: 0.1 });

  const scheduleUrl = new URL("/schedule/fri-gates", webBase);
  scheduleUrl.searchParams.set("apiBase", apiBase);
  await page.goto(scheduleUrl.toString());
  await expect(page).toHaveURL(/\/schedule\/fri-gates\?[^#]+#schedule-fri-gates$/);
  const scheduleItem = page.locator("#schedule-fri-gates");
  await expect(scheduleItem).toBeInViewport({ ratio: 0.5 });
  await expect(scheduleItem).toHaveCSS("border-left-color", "rgb(180, 67, 53)");
  await assertNoHorizontalOverflow(page);
});

test("approved sponsor branding stays readable with a pale brand palette", async ({ page }) => {
  const response = await fetch(`${apiBase}/api/public/sponsors`);
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.sponsors?.length).toBeGreaterThan(0);
  const sponsor = {
    ...payload.sponsors[0],
    displayName: "Pale Coast Sponsor",
    website: "https://sponsor.example/",
    primaryColor: "#FFFFFF",
    secondaryColor: "#FFFDEB",
    logo: null
  };
  await page.route(`${apiBase}/api/public/sponsors`, route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ...payload, sponsors: [sponsor] })
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  const card = page.locator("#public-sponsor-showcase .public-sponsor-card").filter({ hasText: sponsor.displayName });
  await expect(card).toHaveCount(1);
  const colors = await card.evaluate(element => {
    const channels = value => String(value).match(/\d+(?:\.\d+)?/g).slice(0, 3).map(channel => Number(channel) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    const luminance = value => {
      const [red, green, blue] = channels(value);
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const contrast = (foreground, background) => {
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    };
    const tier = element.querySelector(".public-sponsor-copy small");
    const mark = element.querySelector(".public-sponsor-mark > span");
    const cardStyles = getComputedStyle(element);
    const tierStyles = getComputedStyle(tier);
    const markStyles = getComputedStyle(mark);
    const markBackground = getComputedStyle(mark.parentElement).backgroundColor;
    return {
      primary: cardStyles.getPropertyValue("--sponsor-primary").trim(),
      secondary: cardStyles.getPropertyValue("--sponsor-secondary").trim(),
      tierContrast: contrast(tierStyles.color, cardStyles.backgroundColor),
      markContrast: contrast(markStyles.color, markBackground)
    };
  });
  expect(colors.primary).toBe("#FFFFFF");
  expect(colors.secondary).toBe("#FFFDEB");
  expect(colors.tierContrast).toBeGreaterThanOrEqual(4.5);
  expect(colors.markContrast).toBeGreaterThanOrEqual(4.5);
  await card.focus();
  await expect(card).toBeFocused();
  await expect(card).toHaveCSS("outline-style", "solid");
  await assertNoHorizontalOverflow(page);
});

test("critical public and operations views fit a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
  const askInputBox = await page.locator("#ask-input").boundingBox();
  const askSubmitBox = await page.locator("#ask-submit").boundingBox();
  expect(askInputBox?.height).toBeGreaterThanOrEqual(44);
  expect(askSubmitBox?.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(Number(askInputBox?.width) - Number(askSubmitBox?.width))).toBeLessThanOrEqual(1);
  const runtimeNotice = page.locator("#runtime-data-notice");
  await expect(runtimeNotice).toContainText("Board demonstration · Synthetic 2027 data");
  await expect(runtimeNotice).toContainText("No external messages, charges, or live-provider calls");
  await expect(runtimeNotice).toHaveAccessibleName("Board demonstration. Synthetic 2027 data. No external messages, charges, or live-provider calls");
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => {
    const topbar = document.querySelector(".topbar")?.getBoundingClientRect();
    const notice = document.querySelector("#runtime-data-notice")?.getBoundingClientRect();
    return Boolean(topbar && notice && Math.abs(notice.top - topbar.bottom) <= 1 && notice.bottom <= window.innerHeight);
  })).toBe(true);
  const mobileNavigationToggle = page.locator("#mobile-nav-toggle");
  const mobileNavigation = page.locator("#public-navigation");
  await expect(mobileNavigationToggle).toBeVisible();
  await expect(mobileNavigationToggle).toHaveAttribute("aria-expanded", "false");
  await expect(mobileNavigation).toBeHidden();
  await mobileNavigationToggle.click();
  await expect(mobileNavigationToggle).toHaveAttribute("aria-expanded", "true");
  await expect(mobileNavigation).toBeVisible();
  expect(await mobileNavigation.evaluate(navigation => [...navigation.querySelectorAll('a[data-audience="ops"]')]
    .filter(link => link.getClientRects().length > 0)
    .map(link => ({ label: link.textContent.trim(), href: link.getAttribute("href") })))).toEqual([]);
  for (const name of ["Tickets", "Vendors", "Island", "Sponsors", "Status"]) {
    await expect(mobileNavigation.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await assertNoAccessibilityViolations(page, "Open mobile visitor navigation");
  await mobileNavigation.getByRole("link", { name: "Sponsors", exact: true }).click();
  await expect(page).toHaveURL(/#sponsors$/);
  await expect(page.locator("#sponsors .partner-heading")).toBeInViewport({ ratio: 0.5 });
  await expect(mobileNavigation).toBeHidden();
  await expect(mobileNavigationToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#sponsors")).toBeFocused();

  await mobileNavigationToggle.click();
  await page.keyboard.press("Escape");
  await expect(mobileNavigation).toBeHidden();
  await expect(mobileNavigationToggle).toHaveAttribute("aria-expanded", "false");
  await expect(mobileNavigationToggle).toBeFocused();

  await mobileNavigationToggle.click();
  await mobileNavigation.getByRole("link", { name: "Island", exact: true }).click();
  await expect(page).toHaveURL(/#island-conditions$/);
  await expect(page.locator("#refresh-island-conditions")).toBeVisible();
  await expect(mobileNavigation).toBeHidden();
  await assertNoHorizontalOverflow(page);

  const mobileMapTargets = page.locator(".lb-pin, .booth-pin, .corridor-pin");
  await expect(page.locator(".lb-pin")).toHaveCount(16);
  await expect(page.locator(".booth-pin")).toHaveCount(7);
  await expect(page.locator(".corridor-pin")).toHaveCount(9);
  for (let index = 0; index < await mobileMapTargets.count(); index += 1) {
    const targetBox = await mobileMapTargets.nth(index).boundingBox();
    expect(targetBox?.width).toBeGreaterThanOrEqual(24);
    expect(targetBox?.height).toBeGreaterThanOrEqual(24);
  }
  expect(await page.locator("#lb-canvas").evaluate(canvas => {
    const canvasBox = canvas.getBoundingClientRect();
    return [...canvas.querySelectorAll(".lb-pin")].filter(pin => {
      const pinBox = pin.getBoundingClientRect();
      return pinBox.left < canvasBox.left - 1
        || pinBox.right > canvasBox.right + 1
        || pinBox.top < canvasBox.top - 1
        || pinBox.bottom > canvasBox.bottom + 1;
    }).map(pin => pin.getAttribute("data-pin-id"));
  })).toEqual([]);
  for (const pinId of ["1", "16"]) {
    const edgePin = page.locator(`.lb-pin[data-pin-id="${pinId}"]`);
    await edgePin.click();
    await expect(edgePin).toHaveClass(/is-flashing/);
    const popover = page.locator("#lb-pop");
    await expect(popover).toBeVisible();
    expect(await popover.evaluate(element => {
      const canvasBox = document.querySelector("#lb-canvas").getBoundingClientRect();
      const popoverBox = element.getBoundingClientRect();
      return popoverBox.left >= canvasBox.left - 1
        && popoverBox.right <= canvasBox.right + 1
        && popoverBox.top >= canvasBox.top - 1
        && popoverBox.bottom <= canvasBox.bottom + 1;
    })).toBe(true);
  }
  await assertChoiceTargets(page, "Mobile visitor signup");
  expect(await page.locator(".corridor-map").evaluate(map => {
    const targets = [...map.querySelectorAll(".corridor-pin-amenity .corridor-pin-label, .corridor-axis")].map(node => ({
      label: node.textContent?.trim() || "axis",
      rect: node.getBoundingClientRect()
    }));
    const overlaps = [];
    for (let left = 0; left < targets.length; left += 1) {
      for (let right = left + 1; right < targets.length; right += 1) {
        const a = targets[left].rect;
        const b = targets[right].rect;
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          overlaps.push(`${targets[left].label}:${targets[right].label}`);
        }
      }
    }
    return overlaps;
  })).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#vendors-map`);
  await expect(page.locator("#vendors-map")).toBeInViewport({ ratio: 0.1 });
  await expect(page.locator("#vendors-map .booth-apply-link")).toBeVisible();
  await expect(page.locator("#vendors-map .booth-apply-link")).toBeInViewport();
  await page.locator("#vendors-map .booth-apply-link").click();
  await expect(page).toHaveURL(/#vendor-application-form$/);
  await expect(page.locator("#vendor-application-form")).toBeInViewport({ ratio: 0.1 });
  await assertNoHorizontalOverflow(page);

  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#vendor-application-form")).toBeVisible();
  await expect(runtimeNotice).toBeInViewport();
  await expect.poll(() => page.evaluate(() => {
    const notice = document.querySelector("#runtime-data-notice")?.getBoundingClientRect();
    const heading = document.querySelector("#sponsors .partner-heading")?.getBoundingClientRect();
    return Boolean(notice && heading && heading.top >= notice.bottom + 12 && heading.top <= notice.bottom + 32);
  })).toBe(true);
  await page.locator('[data-package-id="tarpon"]').click();
  await expect(page).toHaveURL(/#sponsor-inquiry-form$/);
  await expect(page.locator('#sponsor-inquiry-form [name="packageId"]')).toBeFocused();
  await assertTargetClearsTopbar(page, "#sponsor-inquiry-form", 12);
  await expect(page.locator("#sponsor-inquiry-form")).toBeInViewport({ ratio: 0.1 });
  await expect(page.locator('[data-package-id="tarpon"] [data-package-action]')).toHaveText("Selected");
  await assertNoHorizontalOverflow(page);

  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#tickets`);
  await page.locator('[data-ticket-request="sponsor-package-request"]').click();
  await expect(page).toHaveURL(/#sponsor-inquiry-form$/);
  await expect(page.locator('#sponsor-inquiry-form [name="organizationName"]')).toBeFocused();
  await assertTargetClearsTopbar(page, "#sponsor-inquiry-form", 12);
  await expect(page.locator("#sponsor-inquiry-form")).toBeInViewport({ ratio: 0.1 });
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`${webBase}/admin.html?apiBase=${encodeURIComponent(apiBase)}#admin-partners`);
  await expect(page.locator("#admin-api-status")).toContainText("Loaded", { timeout: 25_000 });
  await expect(runtimeNotice).toBeInViewport();
  await expect.poll(() => page.evaluate(() => {
    const notice = document.querySelector("#runtime-data-notice")?.getBoundingClientRect();
    const navigation = document.querySelector(".admin-workspace-nav")?.getBoundingClientRect();
    return Boolean(notice && navigation && navigation.top >= notice.bottom);
  })).toBe(true);
  await expect(page.locator("#admin-command-signals [data-command-signal]")).toHaveCount(8);
  await expect(page.locator("#admin-create-task")).toBeVisible();
  await expect(page.locator("#admin-import-staff")).toBeVisible();
  await expect(page.locator("#admin-quickbooks-connection")).toBeVisible();
  await expect(page.locator("#admin-quickbooks-status")).toContainText("deferred until post-presentation setup");
  await expect(page.locator("#admin-outreach-targeting-map")).toBeVisible();
  await expect(page.locator("#admin-outreach-targeting-map .admin-outreach-map-summary")).toBeVisible();
  await expect(page.locator('#admin-create-campaign [name="centerSource"]')).toBeVisible();
  await expect(page.locator("#admin-campaign-center-preview")).toBeVisible();
  await expect(page.locator("#admin-preview-campaign")).toBeVisible();
  await expect(page.locator("#admin-campaign-audience-preview")).toBeVisible();
  const mobileCampaignOutcomes = page.locator("#admin-outreach-campaigns [data-campaign-outcomes]").first();
  await expect(mobileCampaignOutcomes).toBeVisible();
  await expect(mobileCampaignOutcomes.getByText("Reached", { exact: true })).toBeVisible();
  await expect.poll(() => mobileCampaignOutcomes.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
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
  for (const link of await workspaceLinks.all()) {
    await expect(link).toBeInViewport();
    await expect.poll(() => link.evaluate(element => (
      element.scrollWidth <= element.clientWidth + 1
      && element.scrollHeight <= element.clientHeight + 1
    ))).toBe(true);
  }
  expect(await page.locator("button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, a[href], [role=button]").evaluateAll(controls => controls.filter(control => {
    const bounds = control.getBoundingClientRect();
    const styles = getComputedStyle(control);
    return bounds.width > 0
      && bounds.height > 0
      && styles.display !== "none"
      && styles.visibility !== "hidden"
      && (bounds.width < 24 || bounds.height < 24);
  }).map(control => control.getAttribute("aria-label") || control.textContent?.trim() || control.getAttribute("name") || control.id))).toEqual([]);
  await assertChoiceTargets(page, "Mobile Operations");
  const accountingLink = workspaceNav.getByRole("link", { name: "Accounting", exact: true });
  await expect(accountingLink).toHaveAttribute("href", "#admin-budget");
  await accountingLink.click();
  await expect(page).toHaveURL(/#admin-budget$/);
  await assertAnchorClearsWorkspaceNav(page, "#admin-budget", -1);
  await workspaceNav.getByRole("link", { name: "Island conditions", exact: true }).click();
  await expect(page).toHaveURL(/#admin-island-conditions$/);
  await assertAnchorClearsWorkspaceNav(page, "#admin-island-conditions", -1);
  await assertNoHorizontalOverflow(page);
});

test("mobile vendor signup anchors remain aligned while public data renders", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor`);
  await expect(page.locator("#network-status")).toHaveText("Demo");
  const vendorLink = page.locator("#vendor-intake-cta");
  await vendorLink.scrollIntoViewIfNeeded();
  await vendorLink.click();
  await expect(page).toHaveURL(/#vendor-application-form$/);
  await expect.poll(async () => {
    const form = await page.locator("#vendor-application-form").boundingBox();
    const topbar = await page.locator(".topbar").boundingBox();
    return Boolean(form && topbar && form.y >= topbar.y + topbar.height && form.y < 220);
  }, { timeout: 2_000 }).toBe(true);
  await expect(page.locator("#vendor-application-form")).toBeInViewport({ ratio: 0.2 });
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

  const taskWorkspaceResponse = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const taskWorkspace = await taskWorkspaceResponse.json();
  const accessibleTask = taskWorkspace.tasks?.find(item => ["open", "in_progress", "blocked"].includes(item.status) && item.assigneeId);
  expect(accessibleTask).toBeTruthy();
  const accessibleTaskUrl = new URL(taskPortalUrlForTask(accessibleTask, {
    config: taskPortalConfig({
      SANDFEST_ENV: "development",
      SANDFEST_TASK_PORTAL_SECRET: PORTAL_SECRET,
      SANDFEST_PUBLIC_SITE_URL: webBase
    })
  }));
  accessibleTaskUrl.searchParams.set("apiBase", apiBase);
  await page.goto(accessibleTaskUrl.toString());
  await expect(page).toHaveURL(/#task-status$/);
  await expect(page.locator("#task-status-result")).toContainText(accessibleTask.title);
  const taskActionButtons = page.locator("#task-status-update [data-task-action]:visible");
  expect(await taskActionButtons.count()).toBeGreaterThan(0);
  for (let index = 0; index < await taskActionButtons.count(); index += 1) {
    const bounds = await taskActionButtons.nth(index).boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  await assertNoAccessibilityViolations(page, "Private task assignment status");

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
  const discoveryCandidateTargets = page.locator('#admin-discover-businesses input[name="discoveredSourceRef"]');
  expect(await discoveryCandidateTargets.count()).toBeGreaterThan(0);
  for (let index = 0; index < await discoveryCandidateTargets.count(); index += 1) {
    const targetBox = await discoveryCandidateTargets.nth(index).boundingBox();
    expect(targetBox?.width).toBeGreaterThanOrEqual(28);
    expect(targetBox?.height).toBeGreaterThanOrEqual(28);
  }
  await expect(page.locator("#admin-campaign-center-preview")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#admin-campaign-audience-preview")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#admin-preview-campaign")).toHaveAccessibleName("Preview audience");
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await assertNoAccessibilityViolations(page, "Operations workspace");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);
  await expect(page.locator("#vendor-application-form")).toBeVisible();
  await assertNoAccessibilityViolations(page, "Mobile visitor and partner intake surface");
});

test("partner portal recovery is private, delivered, and mobile-safe", async ({ page }) => {
  const runId = randomUUID().slice(0, 8);
  const organizationName = `Recovery Boardwalk Studio ${runId}`;
  const contactEmail = `recovery.${runId}@example.com`;
  await page.goto(`${webBase}/?apiBase=${encodeURIComponent(apiBase)}&mode=visitor#sponsors`);

  const vendor = page.locator("#vendor-application-form");
  await vendor.locator('[name="organizationName"]').fill(organizationName);
  await vendor.locator('[name="contactName"]').fill("Morgan Recovery");
  await vendor.locator('[name="contactEmail"]').fill(contactEmail);
  await vendor.locator('[name="category"]').selectOption("artisan");
  await vendor.locator('[name="vendorOfferingId"]').selectOption("marketplace-booth");
  await vendor.locator('[name="description"]').fill("Coastal art and a standard marketplace booth.");
  await vendor.locator('[name="consentToContact"]').check();
  const intake = await submitAndCapture(page, vendor, "/api/public/vendor-applications");

  const recovery = page.locator("#partner-portal-recovery-form");
  await recovery.locator('[name="reference"]').fill(intake.application.reference);
  await recovery.locator('[name="contactEmail"]').fill(contactEmail);
  const matchedResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-portal-recovery" && response.request().method() === "POST");
  await recovery.locator('button[type="submit"]').click();
  const matchedResponse = await matchedResponsePromise;
  const matchedPayload = await matchedResponse.json();
  expect(matchedResponse.status()).toBe(202);
  expect(matchedResponse.headers()["cache-control"]).toBe("no-store");
  await expect(recovery.locator(".partner-form-status")).toHaveText(matchedPayload.message);
  expect(JSON.stringify(matchedPayload)).not.toContain(intake.application.reference);
  expect(JSON.stringify(matchedPayload)).not.toContain(contactEmail);
  expect(matchedPayload).not.toHaveProperty("matched");

  await recovery.locator('[name="contactEmail"]').fill(`unknown.${runId}@example.com`);
  const missedResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/public/partner-portal-recovery" && response.request().method() === "POST");
  await recovery.locator('button[type="submit"]').click();
  const missedResponse = await missedResponsePromise;
  const missedPayload = await missedResponse.json();
  expect(missedResponse.status()).toBe(202);
  expect(missedPayload).toEqual(matchedPayload);

  await expect.poll(async () => {
    const response = await fetch(`${apiBase}/api/admin/partners`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const payload = await response.json();
    const messages = payload.followups?.filter(item => item.applicationId === intake.application.id && item.kind === "portal_access_recovery") || [];
    return messages.length === 1 && messages[0].status === "sent" && messages[0].deliveryStatus === "delivered";
  }, { timeout: 15_000 }).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(recovery).toBeVisible();
  await recovery.scrollIntoViewIfNeeded();
  await expect(recovery.locator('button[type="submit"]')).toBeInViewport();
  await assertNoHorizontalOverflow(page);
  await assertNoAccessibilityViolations(page, "Partner portal recovery");
});
