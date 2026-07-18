#!/usr/bin/env node

import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  boardDemoSessionPath,
  boardDemoSessionProcessAlive,
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
    const { webBase, apiBase } = session.endpoints || {};
    if (!webBase || !apiBase) throw new Error("The board session is missing its web or API endpoint.");
    visitorUrl = exactBoardLink(session.links?.visitor, { webBase, apiBase, kind: "Visitor" });
    operationsUrl = exactBoardLink(session.links?.operations, { webBase, apiBase, kind: "Operations" });
    if (session.lastPreflight?.passed !== 9 || session.lastPreflight?.total !== 9) {
      throw new Error("The supervisor has not recorded a complete 9-of-9 service preflight.");
    }
    return `Ready supervisor ${session.pid}; links match the 9-of-9 session.`;
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
      if (item?.sponsorTiers !== 11 || item?.sponsorPackageIds?.join(",") !== expectedSponsorPackages.join(",") || item?.sponsorAmounts?.marlin !== "$15,000 sponsorship" || item?.sponsorAmounts?.whale !== "$50,000 sponsorship" || item?.sponsorAmounts?.["the-kraken"] !== "$250,000 sponsorship" || item?.vendorOfferings < 1 || item?.vendorApplicationAction !== "Apply as a vendor" || !item?.vendorSubmitEnabled || !item?.sponsorSubmitEnabled) {
        throw new Error("The public signup catalogs or submit actions are incomplete.");
      }
      return `${item.sponsorTiers} current sponsor packages and ${item.vendorOfferings} category-compatible vendor offering${item.vendorOfferings === 1 ? "" : "s"} are actionable from public partner intake.`;
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
      await page.goto(operationsUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForFunction(() => document.querySelector("#admin-api-status")?.textContent?.includes("Loaded"), null, { timeout: timeoutMs });
      await page.waitForFunction(() => document.querySelectorAll("#admin-command-signals [data-command-signal]").length === 8, null, { timeout: timeoutMs });
      observations.operations = await page.evaluate(() => ({
        title: document.title,
        heading: document.querySelector("#admin-config h1")?.textContent?.trim(),
        network: document.querySelector("#network-status")?.textContent?.trim(),
        runtimeLabel: document.querySelector("#runtime-data-notice")?.textContent?.trim(),
        apiStatus: document.querySelector("#admin-api-status")?.textContent?.trim(),
        deployment: document.querySelector("#admin-deployment-summary")?.textContent?.trim(),
        commandSignals: document.querySelectorAll("#admin-command-signals [data-command-signal]").length,
        partnerApplications: document.querySelectorAll("#admin-partner-applications [data-partner-application]").length,
        tasks: document.querySelectorAll("#admin-partner-tasks [data-task]").length,
        taskSummary: document.querySelector("#admin-task-board-summary")?.textContent?.trim(),
        documents: document.querySelectorAll("#admin-document-list [data-admin-document]").length,
        quickBooksState: document.querySelector("#admin-quickbooks-connection")?.dataset?.state,
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
        || !item.apiStatus?.includes("Loaded")
        || item.resetReady !== true
      ) {
        throw new Error(observations.operationsError || "The operations command center did not finish loading.");
      }
      return `${item.commandSignals} operating signals and the presentation reset control rendered with a persistent synthetic Demo label.`;
    });
    await inspect("operations_workflows", "Operations workflow queues", "Inspect partner, task, document, and accounting board data.", async () => {
      const item = observations.operations;
      if (item?.partnerApplications < 4 || item?.tasks < 9 || !item?.taskSummary?.includes("active") || item?.documents < 4 || item?.quickBooksState !== "deferred") {
        throw new Error("One or more board workflow queues did not render their prepared records.");
      }
      return `${item.partnerApplications} applications, ${item.tasks} active task cards, and ${item.documents} documents rendered; live accounting remains deferred.`;
    });
    await inspect("browser_health", "Browser render health", "Inspect browser errors and page-width layout on both presentation surfaces.", async () => {
      if (pageErrors.length || consoleErrors.length) {
        throw new Error(`Browser errors: ${[...pageErrors, ...consoleErrors].slice(0, 3).join(" | ")}`);
      }
      if (unexpectedWrites.length) throw new Error(`The read-only rehearsal blocked: ${unexpectedWrites.slice(0, 3).join(" | ")}`);
      if (observations.visitor?.overflowPixels || observations.operations?.overflowPixels) {
        throw new Error(`Horizontal overflow detected: visitor ${observations.visitor?.overflowPixels || 0}px; operations ${observations.operations?.overflowPixels || 0}px.`);
      }
      return "No state-changing requests, page or console errors, or horizontal overflow at 1440px.";
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
