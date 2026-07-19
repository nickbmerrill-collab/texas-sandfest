#!/usr/bin/env node

import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOARD_DEMO_SESSION_SCHEMA_VERSION,
  assessBoardDemoSourceRevision,
  boardDemoSessionPath,
  boardDemoSessionProcessAlive,
  boardDemoSourceRevision,
  readBoardDemoSession
} from "../lib/board-demo-session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });
const jsonOutput = process.argv.includes("--json");
const configuredTimeoutMs = Number(process.env.SANDFEST_BOARD_BROWSER_CHECK_TIMEOUT_MS || 20_000);
const timeoutMs = Number.isFinite(configuredTimeoutMs) ? Math.max(5_000, configuredTimeoutMs) : 20_000;
const checks = [];
const observations = {};
let browser = null;

function record(id, label, ok, detail, action = null) {
  checks.push({ id, label, ok, detail, action: ok ? null : action });
}

async function inspect(id, label, action, callback) {
  try {
    const detail = await callback();
    record(id, label, true, detail);
  } catch (error) {
    record(id, label, false, error.message, action);
  }
}

function exactBoardLink(raw, { apiBase, webBase, kind }) {
  const url = new URL(String(raw || ""));
  const expectedWeb = new URL(webBase);
  const expectedApi = new URL(apiBase);
  if (
    [url, expectedWeb, expectedApi].some(item => item.protocol !== "http:" || item.hostname !== "127.0.0.1")
    || [url, expectedWeb, expectedApi].some(item => item.username || item.password)
  ) {
    throw new Error(`${kind} link is not exact loopback HTTP.`);
  }
  if (url.origin !== expectedWeb.origin || url.searchParams.get("apiBase") !== apiBase) {
    throw new Error(`${kind} link does not match the active board session.`);
  }
  if (kind === "Visitor" && (url.pathname !== "/" || url.searchParams.get("mode") !== "visitor")) {
    throw new Error("Visitor link does not open the visitor surface.");
  }
  if (kind === "Operations" && url.pathname !== "/admin.html") {
    throw new Error("Operations link does not open the isolated admin entry.");
  }
  if ([...url.searchParams.keys()].some(key => /token|secret|credential|auth|password/i.test(key))) {
    throw new Error(`${kind} link contains a credential-like query parameter.`);
  }
  return url.toString();
}

const session = await readBoardDemoSession(sessionFile);
let visitorUrl = null;
let operationsUrl = null;

await inspect(
  "session",
  "Active presentation session",
  "Start the board stack with npm run board:demo.",
  async () => {
    if (!session || !boardDemoSessionProcessAlive(session) || session.status !== "ready") {
      throw new Error("No ready board supervisor session is running.");
    }
    if (session.schemaVersion !== BOARD_DEMO_SESSION_SCHEMA_VERSION) {
      throw new Error(`The board session schema is ${session.schemaVersion ?? "missing"}; restart it with the current supervisor.`);
    }
    const sourceAssessment = assessBoardDemoSourceRevision(session.source, await boardDemoSourceRevision(ROOT));
    if (!sourceAssessment.ok) throw new Error(sourceAssessment.detail);
    const { webBase, apiBase } = session.endpoints || {};
    if (!webBase || !apiBase) throw new Error("The board session is missing its web or API endpoint.");
    visitorUrl = exactBoardLink(session.links?.visitor, { webBase, apiBase, kind: "Visitor" });
    operationsUrl = exactBoardLink(session.links?.operations, { webBase, apiBase, kind: "Operations" });
    if (session.lastPreflight?.passed !== 10 || session.lastPreflight?.total !== 10) {
      throw new Error("The supervisor has not recorded a complete 10-of-10 service and source preflight.");
    }
    return `Ready supervisor ${session.pid}; ${sourceAssessment.detail} Links match the 10-of-10 session.`;
  }
);

if (visitorUrl && operationsUrl) {
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
    const unexpectedWrites = [];
    await context.route("**/*", async route => {
      const request = route.request();
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        unexpectedWrites.push(`${request.method()} ${request.url()}`);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    try {
      await page.goto(visitorUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForFunction(() => document.querySelector("#network-status")?.textContent?.trim() === "Demo", null, { timeout: timeoutMs });
      await page.waitForFunction(() => document.querySelectorAll("#public-sponsor-tiers [data-package-id]").length === 11, null, { timeout: timeoutMs });
      await page.waitForFunction(() => document.querySelector("#ticketing-status-pill")?.textContent?.trim() === "Local payment sandbox", null, { timeout: timeoutMs });
      await page.waitForFunction(() => document.querySelectorAll("#island-camera-grid article").length === 8, null, { timeout: timeoutMs });
      await page.locator("#public-sponsor-showcase").scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const card = [...document.querySelectorAll("#public-sponsor-showcase .public-sponsor-card")]
          .find(item => item.textContent?.includes("Gulf Shore Credit Union"));
        const logo = card?.querySelector("img");
        return Boolean(logo?.complete && logo.naturalWidth > 0);
      }, null, { timeout: timeoutMs });
      observations.visitor = await page.evaluate(() => ({
        title: document.title,
        heading: document.querySelector("h1")?.textContent?.trim(),
        network: document.querySelector("#network-status")?.textContent?.trim(),
        sponsorTiers: document.querySelectorAll("#public-sponsor-tiers [data-package-id]").length,
        sponsorPackageIds: [...document.querySelectorAll("#public-sponsor-tiers [data-package-id]")].map(item => item.dataset.packageId),
        sponsorAmounts: Object.fromEntries([...document.querySelectorAll("#public-sponsor-tiers [data-package-id]")].map(item => [item.dataset.packageId, item.querySelector("span")?.textContent?.trim()])),
        vendorOfferings: document.querySelectorAll('#vendor-application-form [name="vendorOfferingId"] option[value]').length,
        vendorApplicationAction: document.querySelector('#vendors-map a[href="#vendor-application-form"]')?.textContent?.trim(),
        vendorSubmitEnabled: !document.querySelector('#vendor-application-form button[type="submit"]')?.disabled,
        sponsorSubmitEnabled: !document.querySelector('#sponsor-inquiry-form button[type="submit"]')?.disabled,
        checkoutProducts: document.querySelectorAll('#ticket-product-grid [data-ticket-action="increase"]').length,
        checkoutLabel: document.querySelector("#ticketing-status-pill")?.textContent?.trim(),
        checkoutButton: document.querySelector("#checkout-btn")?.textContent?.trim(),
        sponsorCards: document.querySelectorAll("#public-sponsor-showcase .public-sponsor-card").length,
        sponsorLogoLoaded: [...document.querySelectorAll("#public-sponsor-showcase img")].some(image => image.complete && image.naturalWidth > 0),
        cameras: document.querySelectorAll("#island-camera-grid article").length,
        conditionsUpdated: document.querySelector("#island-condition-updated")?.textContent?.trim(),
        overflowPixels: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
      }));
    } catch (error) {
      observations.visitorError = error.message;
    }

    await inspect("visitor_shell", "Visitor presentation shell", "Reload the visitor link and inspect its board-mode bootstrap.", async () => {
      const item = observations.visitor;
      if (!item || item.title !== "Texas SandFest | Port Aransas" || item.heading !== "Texas SandFest" || item.network !== "Demo") {
        throw new Error(observations.visitorError || "The visitor shell did not reach board-demo mode.");
      }
      return "Visitor title, festival heading, and visible Demo state rendered.";
    });
    await inspect("public_intake", "Vendor and sponsor intake", "Inspect the public catalog API and signup form controls.", async () => {
      const item = observations.visitor;
      const expectedSponsorPackages = ["flounder", "trout", "tarpon", "sailfish", "marlin", "shark", "vip-tent-sponsor", "whale", "giant-squid", "megalodon", "the-kraken"];
      if (item?.sponsorTiers !== 11 || item?.sponsorPackageIds?.join(",") !== expectedSponsorPackages.join(",") || item?.sponsorAmounts?.marlin !== "$15,000 sponsorship" || item?.sponsorAmounts?.whale !== "$50,000 sponsorship" || item?.sponsorAmounts?.["the-kraken"] !== "$250,000 sponsorship" || item?.vendorOfferings < 1 || item?.vendorApplicationAction !== "Apply as a vendor" || !item?.vendorSubmitEnabled || !item?.sponsorSubmitEnabled || item?.checkoutProducts < 4 || item?.checkoutLabel !== "Local payment sandbox" || item?.checkoutButton !== "Open demo checkout") {
        throw new Error("The public signup catalogs or submit actions are incomplete.");
      }
      return `${item.sponsorTiers} sponsor packages, ${item.vendorOfferings} category-compatible vendor offering${item.vendorOfferings === 1 ? "" : "s"}, and ${item.checkoutProducts} local-checkout ticket products are actionable.`;
    });
    await inspect("sponsor_brand", "Sponsor branding", "Inspect the approved board sponsor asset and showcase projection.", async () => {
      const item = observations.visitor;
      if (item?.sponsorCards < 1 || !item?.sponsorLogoLoaded) throw new Error("The approved sponsor showcase logo did not render.");
      return `${item.sponsorCards} approved sponsor card rendered with a loaded logo.`;
    });
    await inspect("island_conditions", "Island Conditions", "Inspect the synthetic camera playback and conditions refresh.", async () => {
      const item = observations.visitor;
      if (item?.cameras !== 8 || !item?.conditionsUpdated || item.conditionsUpdated === "Checking sources") {
        throw new Error("The eight-camera Island Conditions view did not finish rendering.");
      }
      return `All ${item.cameras} camera cards rendered with a current conditions timestamp.`;
    });

    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(operationsUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForFunction(() => document.querySelector("#admin-api-status")?.textContent?.includes("Loaded"), null, { timeout: timeoutMs });
      await page.waitForFunction(() => document.querySelectorAll("#admin-command-signals [data-command-signal]").length === 8, null, { timeout: timeoutMs });
      await page.waitForFunction(() => {
        const delivered = [...document.querySelectorAll('#admin-partner-followups [data-delivery-status="delivered"]')];
        return delivered.some(item => item.textContent?.includes("transactional automation"))
          && delivered.some(item => item.textContent?.includes("campaign-approved automation"));
      }, null, { timeout: timeoutMs });
      observations.operations = await page.evaluate(() => ({
        title: document.title,
        heading: document.querySelector("#admin-config h1")?.textContent?.trim(),
        network: document.querySelector("#network-status")?.textContent?.trim(),
        runtimeLabel: document.querySelector("#runtime-data-notice")?.textContent?.trim(),
        apiStatus: document.querySelector("#admin-api-status")?.textContent?.trim(),
        deployment: document.querySelector("#admin-deployment-summary")?.textContent?.trim(),
        commandSignals: document.querySelectorAll("#admin-command-signals [data-command-signal]").length,
        commandSignalText: Object.fromEntries([...document.querySelectorAll("#admin-command-signals [data-command-signal]")]
          .map(item => [item.dataset.commandSignal, item.textContent?.replace(/\s+/g, " ").trim()])),
        commandViewport: (() => {
          const cards = [...document.querySelectorAll("#admin-command-signals [data-command-signal]")];
          const lastCard = cards.at(-1)?.getBoundingClientRect();
          return {
            width: window.innerWidth,
            height: window.innerHeight,
            lastCardBottom: lastCard?.bottom ?? null,
            allVisible: cards.length === 8 && cards.every(card => {
              const bounds = card.getBoundingClientRect();
              return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
            })
          };
        })(),
        partnerApplications: document.querySelectorAll("#admin-partner-applications [data-partner-application]").length,
        tasks: document.querySelectorAll("#admin-partner-tasks [data-task]").length,
        taskSummary: document.querySelector("#admin-task-board-summary")?.textContent?.trim(),
        taskAssignmentTypes: [...new Set([...document.querySelectorAll('#admin-partner-tasks [data-task] [name="assigneeType"]')].map(item => item.value))],
        milestones: document.querySelectorAll("#admin-partner-milestones [data-admin-milestone]").length,
        keyDateSummary: document.querySelector("#admin-key-date-summary")?.textContent?.trim(),
        receivablesSummary: document.querySelector("#admin-receivables-summary")?.textContent?.trim(),
        openReceivables: document.querySelectorAll("#admin-receivables-accounts [data-reconciliation]").length,
        followups: document.querySelectorAll("#admin-partner-followups [data-followup]").length,
        deliveredFollowups: document.querySelectorAll('#admin-partner-followups [data-delivery-status="delivered"]').length,
        deliveredTransactionalMessages: [...document.querySelectorAll('#admin-partner-followups [data-delivery-status="delivered"]')]
          .filter(item => item.textContent?.includes("transactional automation")).length,
        deliveredCampaignMessages: [...document.querySelectorAll('#admin-partner-followups [data-delivery-status="delivered"]')]
          .filter(item => item.textContent?.includes("campaign-approved automation")).length,
        deliveredMilestoneReminders: [...document.querySelectorAll('#admin-partner-followups [data-delivery-status="delivered"]')]
          .filter(item => item.textContent?.includes("automatic key-date reminder")).length,
        reviewQueueShowsAutomaticReminder: document.querySelector("#admin-partner-followups [data-followup]:nth-child(2)")?.textContent?.includes("automatic key-date reminder") === true,
        reviewReadyOutreachMessages: [...document.querySelectorAll("#admin-partner-followups [data-followup]")]
          .filter(item => item.querySelector("[data-review-followup]") && item.textContent?.includes("outreach sequence")).length,
        reviewQueueStartsActionable: Boolean(document.querySelector('#admin-partner-followups [data-followup]:first-child [data-review-followup][data-action="approve"]')),
        documents: document.querySelectorAll("#admin-document-list [data-admin-document]").length,
        extractionReady: document.querySelectorAll('#admin-document-list .admin-document-extraction[data-state="ready"]').length,
        extractedPreviews: document.querySelectorAll("#admin-document-list .admin-document-preview").length,
        sponsorAccounts: document.querySelectorAll("#admin-sponsor-fulfillment [data-sponsor-fulfillment]").length,
        approvedBrandAssets: document.querySelectorAll('#admin-sponsor-fulfillment [data-admin-brand-asset] [data-status="approved"]').length,
        sponsorDeliverables: document.querySelectorAll("#admin-sponsor-fulfillment [data-admin-deliverable]").length,
        vendorAccounts: document.querySelectorAll("#admin-vendor-readiness [data-admin-vendor]").length,
        readyVendors: document.querySelectorAll('#admin-vendor-readiness [data-admin-vendor][data-status="ready"]').length,
        blockedVendors: document.querySelectorAll('#admin-vendor-readiness [data-admin-vendor][data-status="blocked"]').length,
        outreachProspects: document.querySelectorAll("#admin-outreach-prospects [data-outreach-prospect]").length,
        locatedProspects: [...document.querySelectorAll("#admin-outreach-prospects [data-outreach-prospect]")].filter(item => (
          item.querySelector('[name="postalCode"]')?.value
          && item.querySelector('[name="latitude"]')?.value
          && item.querySelector('[name="longitude"]')?.value
        )).length,
        invitationReadyProspects: [...document.querySelectorAll("#admin-outreach-prospects [data-outreach-prospect]")]
          .filter(item => item.querySelector('[data-sponsor-invitation-action="issue"]:not(:disabled)')).length,
        outreachCampaigns: document.querySelectorAll("#admin-outreach-campaigns [data-outreach-campaign]").length,
        reviewFirstCampaigns: [...document.querySelectorAll("#admin-outreach-campaigns [data-outreach-campaign]")]
          .filter(item => item.textContent?.includes("review every message")).length,
        geofencedCampaigns: [...document.querySelectorAll("#admin-outreach-campaigns [data-outreach-campaign]")]
          .filter(item => item.textContent?.includes("mi around")).length,
        quickBooksState: document.querySelector("#admin-quickbooks-connection")?.dataset?.state,
        partnerActivity: document.querySelectorAll("#admin-partner-activity [data-partner-activity]").length,
        partnerActivityCategories: [...new Set([...document.querySelectorAll("#admin-partner-activity [data-category]")].map(item => item.dataset.category))],
        partnerActivityText: document.querySelector("#admin-partner-activity")?.textContent?.trim(),
        resetReady: document.querySelector("#admin-reset-board-demo")?.hidden === false,
        overflowPixels: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
      }));
    } catch (error) {
      observations.operationsError = error.message;
    }

    await inspect("operations_shell", "Operations command center", "Reload the Operations link and inspect its automatic board session.", async () => {
      const item = observations.operations;
      if (
        !item
        || item.title !== "Texas SandFest Operations"
        || item.heading !== "Festival operations command center"
        || item.network !== "Demo"
        || !item.runtimeLabel?.includes("Synthetic 2027 data")
        || !item.runtimeLabel?.includes("No external messages or payments are sent")
        || item.commandSignals !== 8
        || item.commandViewport?.width !== 1280
        || item.commandViewport?.height !== 720
        || item.commandViewport?.allVisible !== true
        || !item.apiStatus?.includes("Loaded")
        || item.resetReady !== true
      ) {
        throw new Error(observations.operationsError || "The operations command center did not finish loading.");
      }
      return `${item.commandSignals} operating signals fit the 1280x720 board viewport with the presentation reset control and persistent synthetic Demo label.`;
    });
    await inspect("operations_workflows", "Operations workflow queues", "Inspect partner, task, document, and accounting board data.", async () => {
      const item = observations.operations;
      const requiredActivityCategories = ["intake", "finance", "schedule", "messaging", "work", "branding", "vendor", "outreach"];
      if (
        item?.partnerApplications < 4
        || item?.partnerActivity < 15
        || requiredActivityCategories.some(category => !item.partnerActivityCategories?.includes(category))
        || !item.partnerActivityText?.includes("Payment recorded")
        || !/partner messages? prepared/i.test(item.partnerActivityText || "")
        || /activity_|demo_[sv]app|followup_/.test(item.partnerActivityText || "")
      ) {
        throw new Error("One or more board workflow queues did not render their prepared records.");
      }
      return `${item.partnerApplications} applications and ${item.partnerActivity} grouped updates render every operating category without internal record IDs.`;
    });
    await inspect("finance_dates", "Payment and key-date tracking", "Inspect receivables, payment totals, and partner milestone controls.", async () => {
      const item = observations.operations;
      if (
        item?.milestones < 8
        || !item?.keyDateSummary?.includes("open")
        || item?.openReceivables < 1
        || !item?.receivablesSummary?.includes("outstanding")
        || !item?.commandSignalText?.receivables?.includes("received of")
        || !item?.commandSignalText?.["key-dates"]?.includes("upcoming")
        || !item?.commandSignalText?.["key-dates"]?.includes("1 due soon")
        || !item?.keyDateSummary?.includes("1 due soon")
        || item?.quickBooksState !== "deferred"
      ) {
        throw new Error("Receivables or partner key-date proof is incomplete.");
      }
      return `${item.openReceivables} tracked receivable accounts and ${item.milestones} editable key dates rendered; live QuickBooks remains explicitly deferred.`;
    });
    await inspect("messaging_delegation", "Automated messages and delegation", "Inspect local delivery proof and staff, volunteer, and team assignments.", async () => {
      const item = observations.operations;
      const requiredAssignmentTypes = ["staff", "volunteer", "team"];
      if (
        item?.followups < 4
        || item?.deliveredFollowups < 2
        || item?.deliveredTransactionalMessages < 1
        || item?.deliveredCampaignMessages < 1
        || item?.deliveredMilestoneReminders < 1
        || item?.reviewQueueShowsAutomaticReminder !== true
        || item?.reviewReadyOutreachMessages < 1
        || item?.reviewQueueStartsActionable !== true
        || item?.tasks < 9
        || !item?.taskSummary?.includes("active")
        || requiredAssignmentTypes.some(type => !item.taskAssignmentTypes?.includes(type))
        || !item?.commandSignalText?.messages?.includes("transactional auto")
        || !item?.commandSignalText?.assignments?.includes("staff / volunteer / team")
      ) {
        throw new Error("Local message automation or three-way assignment proof is incomplete.");
      }
      return `${item.deliveredFollowups} loopback messages include transactional, automatic key-date, and campaign-approved delivery proof, while ${item.reviewReadyOutreachMessages} outreach draft remains staff-controlled; ${item.tasks} tasks cover staff, volunteer, and team owners.`;
    });
    await inspect("fulfillment_outreach", "Fulfillment and geofenced outreach", "Inspect sponsor branding, vendor readiness, and targeted campaign records.", async () => {
      const item = observations.operations;
      if (
        item?.sponsorAccounts < 1
        || item?.approvedBrandAssets < 2
        || item?.sponsorDeliverables < 5
        || item?.vendorAccounts < 2
        || item?.readyVendors < 1
        || item?.blockedVendors < 1
        || item?.outreachProspects < 1
        || item?.locatedProspects < 1
        || item?.invitationReadyProspects < 1
        || item?.outreachCampaigns < 1
        || item?.reviewFirstCampaigns < 1
        || item?.geofencedCampaigns < 1
      ) {
        throw new Error("Sponsor, vendor, or geofenced outreach proof is incomplete.");
      }
      return `${item.approvedBrandAssets} approved brand assets, ${item.sponsorDeliverables} sponsor benefits, ready and blocked vendor paths, and an invitation-ready located prospect in a geofenced campaign rendered.`;
    });
    await inspect("document_ingestion", "Private document ingestion", "Inspect governed files, extraction states, and staff-only previews.", async () => {
      const item = observations.operations;
      if (item?.documents < 4 || item?.extractionReady < 1 || item?.extractedPreviews < 1) {
        throw new Error("The private document queue lacks extracted, reviewable presentation proof.");
      }
      return `${item.documents} governed documents rendered with ${item.extractionReady} completed extraction and ${item.extractedPreviews} staff-only previews.`;
    });
    await inspect("browser_health", "Browser render health", "Inspect browser errors and page-width layout on both presentation surfaces.", async () => {
      if (pageErrors.length || consoleErrors.length) {
        throw new Error(`Browser errors: ${[...pageErrors, ...consoleErrors].slice(0, 3).join(" | ")}`);
      }
      if (unexpectedWrites.length) throw new Error(`The read-only rehearsal blocked: ${unexpectedWrites.slice(0, 3).join(" | ")}`);
      if (observations.visitor?.overflowPixels || observations.operations?.overflowPixels) {
        throw new Error(`Horizontal overflow detected: visitor ${observations.visitor?.overflowPixels || 0}px; operations ${observations.operations?.overflowPixels || 0}px.`);
      }
      return "No state-changing requests, page or console errors, or horizontal overflow at the presentation desktop viewports.";
    });

    await context.close();
  } catch (error) {
    const pending = [
      ["visitor_shell", "Visitor presentation shell"],
      ["public_intake", "Vendor and sponsor intake"],
      ["sponsor_brand", "Sponsor branding"],
      ["island_conditions", "Island Conditions"],
      ["operations_shell", "Operations command center"],
      ["operations_workflows", "Operations workflow queues"],
      ["finance_dates", "Payment and key-date tracking"],
      ["messaging_delegation", "Automated messages and delegation"],
      ["fulfillment_outreach", "Fulfillment and geofenced outreach"],
      ["document_ingestion", "Private document ingestion"],
      ["browser_health", "Browser render health"]
    ];
    for (const [id, label] of pending) {
      if (!checks.some(item => item.id === id)) record(id, label, false, `Browser rehearsal could not run: ${error.message}`, "Install Chromium with npx playwright install chromium and retry.");
    }
  } finally {
    await browser?.close();
  }
} else {
  for (const [id, label] of [
    ["visitor_shell", "Visitor presentation shell"],
    ["public_intake", "Vendor and sponsor intake"],
    ["sponsor_brand", "Sponsor branding"],
    ["island_conditions", "Island Conditions"],
    ["operations_shell", "Operations command center"],
    ["operations_workflows", "Operations workflow queues"],
    ["finance_dates", "Payment and key-date tracking"],
    ["messaging_delegation", "Automated messages and delegation"],
    ["fulfillment_outreach", "Fulfillment and geofenced outreach"],
    ["document_ingestion", "Private document ingestion"],
    ["browser_health", "Browser render health"]
  ]) record(id, label, false, "The active presentation session is unavailable.", "Start the board stack with npm run board:demo.");
}

const report = {
  ok: checks.every(item => item.ok),
  checkedAt: new Date().toISOString(),
  passed: checks.filter(item => item.ok).length,
  total: checks.length,
  links: { visitor: visitorUrl, operations: operationsUrl },
  checks,
  observations
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Board browser rehearsal: ${report.passed}/${report.total} checks passed.`);
  for (const item of report.checks) {
    console.log(`${item.ok ? "[PASS]" : "[FAIL]"} ${item.label}: ${item.detail}`);
    if (!item.ok && item.action) console.log(`       ${item.action}`);
  }
  if (report.ok) {
    console.log(`Visitor:    ${visitorUrl}`);
    console.log(`Operations: ${operationsUrl}`);
  }
}

process.exitCode = report.ok ? 0 : 1;
