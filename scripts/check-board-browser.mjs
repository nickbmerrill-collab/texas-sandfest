#!/usr/bin/env node

import { chromium, firefox, webkit } from "@playwright/test";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
const configuredSessionWaitMs = Number(process.env.SANDFEST_BOARD_BROWSER_SESSION_WAIT_MS || 30_000);
const sessionWaitMs = Number.isFinite(configuredSessionWaitMs)
  ? Math.max(0, Math.min(120_000, configuredSessionWaitMs))
  : 30_000;
const browserEngine = String(process.env.SANDFEST_BOARD_BROWSER || "chromium").trim().toLowerCase();
const browserType = { chromium, firefox, webkit }[browserEngine];
const browserLabel = { chromium: "Chromium", firefox: "Firefox", webkit: "WebKit" }[browserEngine] || browserEngine;
const checks = [];
const observations = {};
let browser = null;

const COMMAND_NAVIGATION_TARGETS = [
  { signal: "applications", targetId: "admin-partner-applications-workspace", heading: "Applications and accounting" },
  { signal: "receivables", targetId: "admin-receivables-workspace", heading: "Open accounts" },
  { signal: "messages", targetId: "admin-partner-followups-workspace", heading: "Message drafts" },
  { signal: "assignments", targetId: "admin-partner-tasks-workspace", heading: "Staff and volunteer work board" },
  { signal: "key-dates", targetId: "admin-partner-milestones-workspace", heading: "Partner key dates and reminder cadence" },
  { signal: "sponsors", targetId: "admin-sponsor-fulfillment-workspace", heading: "Sponsor brand and benefit fulfillment" },
  { signal: "vendors", targetId: "admin-vendor-readiness-workspace", heading: "Vendor compliance and load-in readiness" },
  { signal: "outreach", targetId: "admin-outreach-prospects-workspace", heading: "Outreach pipeline" }
];

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

async function waitForCommandTarget(page, target, options = {}) {
  const handle = await page.waitForFunction(({ targetId, heading, requireOutline }) => {
    const workspace = document.getElementById(targetId);
    const workspaceNav = document.querySelector(".admin-workspace-nav");
    const active = document.activeElement;
    const bounds = workspace?.getBoundingClientRect();
    const navBottom = workspaceNav?.getBoundingClientRect().bottom || 0;
    const focusedHeading = active?.textContent?.trim() === heading;
    const outlined = !requireOutline || (active && getComputedStyle(active).outlineStyle !== "none");
    if (
      window.location.hash !== `#${targetId}`
      || !bounds
      || bounds.top < navBottom
      || bounds.top >= window.innerHeight
      || !workspace.contains(active)
      || !focusedHeading
      || !outlined
    ) return false;
    return {
      hash: window.location.hash,
      targetTop: Math.round(bounds.top),
      navigationBottom: Math.round(navBottom),
      focusedHeading
    };
  }, { ...target, requireOutline: options.requireOutline === true }, { timeout: Math.min(timeoutMs, 2_000) });
  return handle.jsonValue();
}

async function verifyCommandNavigation(page) {
  const targets = [];
  for (const target of COMMAND_NAVIGATION_TARGETS) {
    const link = page.locator(`[data-command-signal="${target.signal}"]`);
    const expectedHash = `#${target.targetId}`;
    const href = await link.getAttribute("href");
    if (href !== expectedHash) throw new Error(`${target.signal} points to ${href || "no destination"}, expected ${expectedHash}.`);
    const startedAt = Date.now();
    await link.click({ timeout: timeoutMs });
    const state = await waitForCommandTarget(page, target);
    targets.push({ ...target, ...state, elapsedMs: Date.now() - startedAt });
  }

  const keyboardTarget = COMMAND_NAVIGATION_TARGETS[0];
  const keyboardLink = page.locator(`[data-command-signal="${keyboardTarget.signal}"]`);
  await keyboardLink.focus();
  const startedAt = Date.now();
  await page.keyboard.press("Enter");
  const keyboard = await waitForCommandTarget(page, keyboardTarget, { requireOutline: true });
  return {
    targets,
    keyboard: { ...keyboardTarget, ...keyboard, elapsedMs: Date.now() - startedAt },
    maxElapsedMs: Math.max(...targets.map(item => item.elapsedMs), Date.now() - startedAt)
  };
}

async function responsiveLayoutObservation(page, { surface, url, width, height }) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForFunction(() => document.querySelector("#network-status")?.textContent?.trim() === "Demo", null, { timeout: timeoutMs });
  if (surface === "visitor") {
    await page.waitForFunction(() => document.querySelectorAll("#public-sponsor-tiers [data-package-id]").length === 11, null, { timeout: timeoutMs });
  } else {
    await page.waitForFunction(() => document.querySelector("#admin-api-status")?.textContent?.includes("Loaded"), null, { timeout: timeoutMs });
    await page.waitForFunction(() => document.querySelectorAll(".admin-workspace-nav a").length === 7, null, { timeout: timeoutMs });
  }

  return page.evaluate(({ surface, width, height }) => {
    const visible = element => {
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return bounds.width > 0
        && bounds.height > 0
        && styles.display !== "none"
        && styles.visibility !== "hidden";
    };
    const label = element => element.getAttribute("aria-label")
      || element.textContent?.replace(/\s+/g, " ").trim().slice(0, 80)
      || element.getAttribute("name")
      || element.id
      || element.tagName.toLowerCase();
    const dimensions = element => {
      const bounds = element.getBoundingClientRect();
      return {
        label: label(element),
        width: Math.round(bounds.width * 10) / 10,
        height: Math.round(bounds.height * 10) / 10
      };
    };
    const clipped = element => element.scrollWidth > element.clientWidth + 1
      || element.scrollHeight > element.clientHeight + 1;
    const controls = [...document.querySelectorAll('button, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea, a[href], [role="button"]')]
      .filter(visible);
    const controlTargetIssues = controls.map(dimensions)
      .filter(item => item.width < 24 || item.height < 24);
    const choiceTargetIssues = [...document.querySelectorAll('input[type="checkbox"], input[type="radio"]')]
      .filter(visible)
      .map(input => input.closest("label") || (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null) || input)
      .map(dimensions)
      .filter(item => item.width < 24 || item.height < 24);
    const workspaceNav = document.querySelector(".admin-workspace-nav");
    const workspaceLinks = [...document.querySelectorAll(".admin-workspace-nav a")].filter(visible);
    const readinessFilters = [...document.querySelectorAll(".admin-readiness-filter button")].filter(visible);
    const sourceLinks = [...document.querySelectorAll(".admin-prospect-source a")].filter(visible);
    const hero = document.querySelector(".hero");
    const nextSection = hero?.nextElementSibling;
    const nextHeadingBounds = nextSection?.querySelector(".lb-header")?.getBoundingClientRect();
    const nextHeadingTop = nextHeadingBounds ? nextHeadingBounds.top + window.scrollY : null;
    return {
      surface,
      width,
      height,
      overflowPixels: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      controlCount: controls.length,
      controlTargetIssues,
      choiceTargetIssues,
      workspaceNavigation: {
        labels: workspaceLinks.map(item => item.textContent?.trim()),
        overflowPixels: workspaceNav ? Math.max(0, workspaceNav.scrollWidth - workspaceNav.clientWidth) : null,
        clippedLabels: workspaceLinks.filter(clipped).map(label)
      },
      readinessFilters: {
        count: readinessFilters.length,
        clippedLabels: readinessFilters.filter(clipped).map(label)
      },
      sourceLinks: {
        count: sourceLinks.length,
        targetIssues: sourceLinks.map(dimensions).filter(item => item.width < 24 || item.height < 24)
      },
      nextSectionHint: {
        id: nextSection?.id || null,
        headingVisiblePixels: nextHeadingBounds && nextHeadingTop != null
          ? Math.max(0, Math.min(window.innerHeight, nextHeadingTop + nextHeadingBounds.height) - Math.max(0, nextHeadingTop))
          : 0
      }
    };
  }, { surface, width, height });
}

async function presentationSession() {
  let value = await readBoardDemoSession(sessionFile);
  const transitionalStates = new Set(["starting", "recovering", "resetting"]);
  if (
    !value
    || !boardDemoSessionProcessAlive(value)
    || value.status === "ready"
    || !transitionalStates.has(value.status)
    || sessionWaitMs === 0
  ) return value;

  const deadline = Date.now() + sessionWaitMs;
  while (Date.now() < deadline) {
    await delay(Math.min(250, Math.max(1, deadline - Date.now())));
    value = await readBoardDemoSession(sessionFile);
    if (
      !value
      || !boardDemoSessionProcessAlive(value)
      || value.status === "ready"
      || !transitionalStates.has(value.status)
    ) return value;
  }
  return value;
}

const session = await presentationSession();
let visitorUrl = null;
let operationsUrl = null;

await inspect(
  "session",
  "Active presentation session",
  "Start the board stack, or wait for npm run board:demo to report ready, then retry.",
  async () => {
    if (!session || !boardDemoSessionProcessAlive(session)) {
      throw new Error("No ready board supervisor session is running.");
    }
    if (session.status !== "ready") {
      throw new Error(`Board supervisor ${session.pid} remained ${session.status || "unavailable"} after ${Math.round(sessionWaitMs / 1000)} seconds.`);
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
    if (!browserType) throw new Error(`Unsupported browser engine: ${browserEngine || "empty"}.`);
    browser = await browserType.launch({ headless: true });
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
    const httpErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", response => {
      if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
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
        operationsHandoff: document.querySelector("[data-operations-handoff]")?.href,
        operationsHandoffTarget: document.querySelector("[data-operations-handoff]")?.target,
        operationsSurface: document.querySelector("[data-operations-surface]")?.href,
        operationsSurfaceTarget: document.querySelector("[data-operations-surface]")?.target,
        operationsSurfaceTag: document.querySelector("[data-operations-surface]")?.tagName,
        visibleOperationsNavigation: [...document.querySelectorAll('#public-navigation a[data-audience="ops"]')]
          .filter(item => item.getClientRects().length > 0)
          .map(item => ({ label: item.textContent?.trim(), href: item.getAttribute("href") })),
        sponsorTiers: document.querySelectorAll("#public-sponsor-tiers [data-package-id]").length,
        sponsorPackageIds: [...document.querySelectorAll("#public-sponsor-tiers [data-package-id]")].map(item => item.dataset.packageId),
        sponsorAmounts: Object.fromEntries([...document.querySelectorAll("#public-sponsor-tiers [data-package-id]")].map(item => [item.dataset.packageId, item.querySelector("span")?.textContent?.trim()])),
        vendorOfferings: document.querySelectorAll('#vendor-application-form [name="vendorOfferingId"] option[value]').length,
        vendorApplicationAction: document.querySelector('#vendors-map a[href="#vendor-application-form"]')?.textContent?.trim(),
        sponsorPresetVisible: document.querySelector('[data-board-partner-preset="sponsor"]')?.getClientRects().length > 0,
        vendorPresetVisible: document.querySelector('[data-board-partner-preset="vendor"]')?.getClientRects().length > 0,
        sponsorConsentChecked: document.querySelector('#sponsor-inquiry-form [name="consentToContact"]')?.checked === true,
        vendorConsentChecked: document.querySelector('#vendor-application-form [name="consentToContact"]')?.checked === true,
        vendorSubmitEnabled: !document.querySelector('#vendor-application-form button[type="submit"]')?.disabled,
        sponsorSubmitEnabled: !document.querySelector('#sponsor-inquiry-form button[type="submit"]')?.disabled,
        checkoutProducts: document.querySelectorAll('#ticket-product-grid [data-ticket-action="increase"]').length,
        checkoutLabel: document.querySelector("#ticketing-status-pill")?.textContent?.trim(),
        checkoutButton: document.querySelector("#checkout-btn")?.textContent?.trim(),
        checkoutPolicyVisible: document.querySelector("#ticket-policy-fieldset")?.hidden === false,
        checkoutPolicySummary: document.querySelector("#ticket-policy-summary")?.textContent?.trim(),
        checkoutPolicyNotices: document.querySelectorAll("#ticket-policy-notices [data-ticket-policy-notice]").length,
        checkoutPolicyAccepted: document.querySelector("#ticket-policy-acceptance")?.checked === true,
        sponsorCards: document.querySelectorAll("#public-sponsor-showcase .public-sponsor-card").length,
        sponsorLogoLoaded: [...document.querySelectorAll("#public-sponsor-showcase img")].some(image => image.complete && image.naturalWidth > 0),
        sponsorFeatureVisible: document.querySelector("#public-sponsor-featured")?.getClientRects().length > 0,
        sponsorFeatureHeading: document.querySelector("#public-sponsor-featured h3")?.textContent?.trim(),
        sponsorFeatureCount: document.querySelector("#public-sponsor-showcase")?.dataset.count,
        sponsorFeatureBeforePackages: (() => {
          const featured = document.querySelector("#public-sponsor-featured");
          const packages = document.querySelector("#public-sponsor-tiers");
          return Boolean(featured && packages && (featured.compareDocumentPosition(packages) & Node.DOCUMENT_POSITION_FOLLOWING));
        })(),
        cameras: document.querySelectorAll("#island-camera-grid article").length,
        conditionsUpdated: document.querySelector("#island-condition-updated")?.textContent?.trim(),
        conditionLoad: [...document.querySelectorAll("#island-condition-kpis article")]
          .find(item => item.textContent?.includes("Island load"))?.textContent?.replace(/\s+/g, " ").trim(),
        playbackCameras: [...document.querySelectorAll("#island-camera-grid article small")]
          .filter(item => item.textContent?.includes("playback")).length,
        conditionGridText: document.querySelector("#island-camera-grid")?.textContent?.replace(/\s+/g, " ").trim(),
        nextSectionHint: (() => {
          const hero = document.querySelector(".hero");
          const nextSection = hero?.nextElementSibling;
          const nextHeading = nextSection?.querySelector(".lb-header");
          const headingBounds = nextHeading?.getBoundingClientRect();
          const headingTop = headingBounds ? headingBounds.top + window.scrollY : null;
          return {
            id: nextSection?.id || null,
            headingVisiblePixels: headingBounds && headingTop != null
              ? Math.max(0, Math.min(window.innerHeight, headingTop + headingBounds.height) - Math.max(0, headingTop))
              : 0
          };
        })(),
        overflowPixels: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
      }));
    } catch (error) {
      observations.visitorError = error.message;
    }

    await inspect("visitor_shell", "Visitor presentation shell", "Reload the visitor link and inspect its board-mode bootstrap.", async () => {
      const item = observations.visitor;
      if (item?.visibleOperationsNavigation?.length) {
        const leakedLinks = item.visibleOperationsNavigation.map(link => `${link.label || "unnamed"} (${link.href || "no target"})`).join(", ");
        throw new Error(`Visitor navigation exposes Operations link${item.visibleOperationsNavigation.length === 1 ? "" : "s"}: ${leakedLinks}.`);
      }
      if (
        !item
        || item.title !== "Texas SandFest | Port Aransas"
        || item.heading !== "Texas SandFest"
        || item.network !== "Demo"
        || item.operationsHandoff !== operationsUrl
        || item.operationsHandoffTarget !== "_blank"
        || item.operationsSurface !== operationsUrl
        || item.operationsSurfaceTarget !== ""
        || item.operationsSurfaceTag !== "A"
        || item.nextSectionHint?.id !== "live-beach"
        || item.nextSectionHint?.headingVisiblePixels < 24
      ) {
        throw new Error(observations.visitorError || "The visitor shell did not reach board-demo mode.");
      }
      return `Visitor title, festival heading, visible Demo state, ${Math.round(item.nextSectionHint.headingVisiblePixels)}px Live Beach cue, same-tab Operations switch, new-tab operator handoff, and an operations-free visitor navigation rendered.`;
    });
    await inspect("public_intake", "Vendor and sponsor intake", "Inspect the public catalog API and signup form controls.", async () => {
      const item = observations.visitor;
      const expectedSponsorPackages = ["flounder", "trout", "tarpon", "sailfish", "marlin", "shark", "vip-tent-sponsor", "whale", "giant-squid", "megalodon", "the-kraken"];
      if (item?.sponsorTiers !== 11 || item?.sponsorPackageIds?.join(",") !== expectedSponsorPackages.join(",") || item?.sponsorAmounts?.marlin !== "$15,000 sponsorship" || item?.sponsorAmounts?.whale !== "$50,000 sponsorship" || item?.sponsorAmounts?.["the-kraken"] !== "$250,000 sponsorship" || item?.vendorOfferings < 1 || item?.vendorApplicationAction !== "Apply as a vendor" || !item?.sponsorPresetVisible || !item?.vendorPresetVisible || item?.sponsorConsentChecked || item?.vendorConsentChecked || !item?.vendorSubmitEnabled || !item?.sponsorSubmitEnabled || item?.checkoutProducts < 4 || item?.checkoutLabel !== "Local payment sandbox" || item?.checkoutButton !== "Open demo checkout" || !item?.checkoutPolicyVisible || item?.checkoutPolicySummary !== "Review demonstration policies" || item?.checkoutPolicyNotices !== 4 || item?.checkoutPolicyAccepted) {
        throw new Error("The public signup catalogs or submit actions are incomplete.");
      }
      return `${item.sponsorTiers} sponsor packages, ${item.vendorOfferings} category-compatible vendor offering${item.vendorOfferings === 1 ? "" : "s"}, consent-safe board presets, and ${item.checkoutProducts} policy-gated local-checkout ticket products are actionable.`;
    });
    await inspect("sponsor_brand", "Sponsor branding", "Inspect the approved board sponsor asset and showcase projection.", async () => {
      const item = observations.visitor;
      if (item?.sponsorCards < 1 || !item?.sponsorLogoLoaded || !item?.sponsorFeatureVisible || item?.sponsorFeatureHeading !== "Backing the beach" || item?.sponsorFeatureCount !== String(item.sponsorCards) || !item?.sponsorFeatureBeforePackages) {
        throw new Error("The approved sponsor showcase did not render prominently ahead of the package catalog.");
      }
      return `${item.sponsorCards} approved sponsor card rendered with a loaded logo in the featured-partner band ahead of the package catalog.`;
    });
    await inspect("island_conditions", "Island Conditions", "Inspect the synthetic camera playback and conditions refresh.", async () => {
      const item = observations.visitor;
      if (
        item?.cameras !== 8
        || !item?.conditionsUpdated?.includes("Board simulation")
        || !item?.conditionLoad?.includes("8 simulated feeds across 8 armed sources")
        || item?.playbackCameras !== 8
        || item?.conditionGridText?.includes("operationally live")
      ) {
        throw new Error("The eight-camera Island Conditions view did not render clearly labeled synthetic playback.");
      }
      return `All ${item.cameras} camera cards rendered as current synthetic playback without live-provider claims.`;
    });

    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(operationsUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForFunction(() => document.querySelector("#admin-api-status")?.textContent?.includes("Loaded"), null, { timeout: timeoutMs });
      await page.waitForFunction(() => document.querySelectorAll("#admin-command-signals [data-command-signal]").length === 8, null, { timeout: timeoutMs });
      await page.waitForFunction(() => document.querySelectorAll("#admin-budget-lines [data-budget-line]").length === 6
        && document.querySelectorAll("#admin-expense-list [data-budget-expense]").length === 7, null, { timeout: timeoutMs });
      await page.waitForFunction(() => {
        const delivered = [...document.querySelectorAll('#admin-partner-followups [data-delivery-status="delivered"]')];
        return delivered.some(item => item.textContent?.includes("transactional automation"))
          && delivered.some(item => item.textContent?.includes("automatic payment confirmation"))
          && delivered.some(item => item.textContent?.includes("campaign-approved automation"));
      }, null, { timeout: timeoutMs });
      await page.waitForFunction(() => document.querySelectorAll("#admin-audit-list [data-audit-action]").length > 0, null, { timeout: timeoutMs });
      observations.operations = await page.evaluate(() => ({
        title: document.title,
        heading: document.querySelector("#admin-config h1")?.textContent?.trim(),
        network: document.querySelector("#network-status")?.textContent?.trim(),
        runtimeLabel: document.querySelector("#runtime-data-notice")?.textContent?.trim(),
        apiStatus: document.querySelector("#admin-api-status")?.textContent?.trim(),
        deployment: document.querySelector("#admin-deployment-summary")?.textContent?.trim(),
        ticketPolicyState: document.querySelector("#admin-ticket-policy-state")?.textContent?.trim(),
        ticketPolicyVersion: document.querySelector('#admin-ticket-policy-form [name="version"]')?.value,
        ticketPolicyNotices: document.querySelectorAll("#admin-ticket-policy-notices textarea").length,
        activationBoundary: document.querySelector("#admin-board-stage-summary")?.textContent?.replace(/\s+/g, " ").trim(),
        activationStages: document.querySelectorAll("#admin-board-stage-summary [data-board-stage]").length,
        commandSignals: document.querySelectorAll("#admin-command-signals [data-command-signal]").length,
        commandSignalText: Object.fromEntries([...document.querySelectorAll("#admin-command-signals [data-command-signal]")]
          .map(item => [item.dataset.commandSignal, item.textContent?.replace(/\s+/g, " ").trim()])),
        partnerKpis: Object.fromEntries([...document.querySelectorAll("#admin-partner-kpis article")]
          .map(item => [item.querySelector("span")?.textContent?.trim(), item.textContent?.replace(/\s+/g, " ").trim()])),
        partnerRefreshLabel: document.querySelector("#admin-load-partners")?.textContent?.trim(),
        conditionsRefreshLabel: document.querySelector("#admin-load-conditions")?.textContent?.trim(),
        conditionSourceHeading: document.querySelector("#admin-island-conditions > strong")?.textContent?.trim(),
        conditionFeedText: document.querySelector("#admin-condition-feeds")?.textContent?.replace(/\s+/g, " ").trim(),
        operationsWorkspaceLayout: (() => {
          const container = document.querySelector(".admin-conditions-columns")?.getBoundingClientRect();
          const outreach = document.querySelector("#admin-outreach-prospects-workspace")?.getBoundingClientRect();
          const conditions = document.querySelector("#admin-island-conditions")?.getBoundingClientRect();
          if (!container || !outreach || !conditions) return null;
          return {
            fullWidth: Math.abs(conditions.left - container.left) < 1 && Math.abs(conditions.right - container.right) < 1,
            stacked: conditions.top >= outreach.bottom + 13
          };
        })(),
        playbackSources: document.querySelectorAll('#admin-condition-cameras [data-source-mode="playback"]').length,
        playbackSourceLabels: [...document.querySelectorAll('#admin-condition-cameras [data-source-mode="playback"] header b')]
          .filter(item => item.textContent?.trim() === "Playback").length,
        playbackSourceText: document.querySelector('#admin-condition-cameras [data-source-mode="playback"] p')?.textContent?.replace(/\s+/g, " ").trim(),
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
        deliveredPaymentConfirmations: [...document.querySelectorAll('#admin-partner-followups [data-delivery-status="delivered"]')]
          .filter(item => item.textContent?.includes("automatic payment confirmation")).length,
        deliveredApplicationDecisions: [...document.querySelectorAll('#admin-partner-followups [data-delivery-status="delivered"]')]
          .filter(item => item.textContent?.includes("application approved")
            && item.textContent?.includes("transactional automation")).length,
        deliveredSponsorProofReviews: [...document.querySelectorAll('#admin-partner-followups [data-delivery-status="delivered"]')]
          .filter(item => item.textContent?.includes("automatic sponsor proof review")).length,
        deliveredVendorOpenings: [...document.querySelectorAll('#admin-partner-followups [data-delivery-status="delivered"]')]
          .filter(item => item.textContent?.includes("vendor applications are open")
            && item.textContent?.includes("has not been converted into an application")).length,
        smsPreferenceVisible: document.querySelector("#admin-board-sms-preference")?.hidden === false,
        smsPreferenceState: document.querySelector("#admin-board-sms-preference")?.dataset?.state,
        smsPreferenceText: document.querySelector("#admin-board-sms-preference")?.textContent?.replace(/\s+/g, " ").trim(),
        smsStopEnabled: document.querySelector('[data-board-sms-preference="STOP"]')?.disabled === false,
        smsStartEnabled: document.querySelector('[data-board-sms-preference="START"]')?.disabled === false,
        reviewQueueShowsAutomaticReminder: [...document.querySelectorAll("#admin-partner-followups [data-followup]")]
          .some(item => item.textContent?.includes("automatic key-date reminder")),
        reviewReadyOutreachMessages: [...document.querySelectorAll("#admin-partner-followups [data-followup]")]
          .filter(item => item.querySelector("[data-review-followup]") && item.textContent?.includes("outreach sequence")).length,
        providerVerificationForms: document.querySelectorAll("#admin-partner-followups [data-reconcile-followup]").length,
        providerVerificationProofFields: document.querySelectorAll('#admin-partner-followups [data-reconcile-followup] [name="providerMessageId"], #admin-partner-followups [data-reconcile-followup] [name="resolutionNote"]').length,
        providerVerificationActions: document.querySelectorAll('#admin-partner-followups [data-reconcile-followup] button[type="submit"]').length,
        providerVerificationLockedRows: [...document.querySelectorAll("#admin-partner-followups [data-followup]")]
          .filter(item => item.querySelector("[data-reconcile-followup]") && !item.querySelector("[data-send-followup], [data-review-followup]")).length,
        reviewQueueStartsWithProviderCheck: Boolean(document.querySelector("#admin-partner-followups [data-followup]:first-child [data-reconcile-followup]")),
        editableMessageDrafts: document.querySelectorAll('#admin-partner-followups [data-followup] .admin-followup-editor [data-save-draft]').length,
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
        campaignOutcomeFunnels: document.querySelectorAll("#admin-outreach-campaigns [data-campaign-outcomes]").length,
        campaignReachedBusinesses: [...document.querySelectorAll('#admin-outreach-campaigns [data-outcome-stage="reached"] strong')]
          .reduce((total, item) => total + Number(item.textContent || 0), 0),
        campaignDeliveredBusinesses: [...document.querySelectorAll('#admin-outreach-campaigns [data-outcome-stage="delivered"] strong')]
          .reduce((total, item) => total + Number(item.textContent || 0), 0),
        reviewFirstCampaigns: [...document.querySelectorAll("#admin-outreach-campaigns [data-outreach-campaign]")]
          .filter(item => item.textContent?.includes("review every message")).length,
        geofencedCampaigns: [...document.querySelectorAll("#admin-outreach-campaigns [data-outreach-campaign]")]
          .filter(item => item.textContent?.includes("mi around")).length,
        campaignPreflightReady: Boolean(document.querySelector("#admin-preview-campaign:not(:disabled)")
          && document.querySelector('#admin-campaign-audience-preview[aria-live="polite"]')
          && document.querySelector('#admin-create-campaign button[type="submit"]:disabled')),
        quickBooksState: document.querySelector("#admin-quickbooks-connection")?.dataset?.state,
        budgetKpis: Object.fromEntries([...document.querySelectorAll("#admin-budget-kpis article")]
          .map(item => [item.querySelector("span")?.textContent?.trim(), item.textContent?.replace(/\s+/g, " ").trim()])),
        budgetLines: document.querySelectorAll("#admin-budget-lines [data-budget-line]").length,
        budgetAllocationEdits: document.querySelectorAll("#admin-budget-lines [data-budget-line-update]").length,
        budgetExports: document.querySelectorAll('#admin-export-type option[value="budget.csv"], #admin-export-type option[value="expenses.csv"]').length,
        budgetExportText: [...document.querySelectorAll('#admin-export-type option[value="budget.csv"], #admin-export-type option[value="expenses.csv"]')].map(option => option.textContent?.trim()).join(" "),
        budgetExpenses: document.querySelectorAll("#admin-expense-list [data-budget-expense]").length,
        submittedExpenses: document.querySelectorAll('#admin-expense-list [data-expense-status="submitted"]').length,
        approvedExpenses: document.querySelectorAll('#admin-expense-list [data-expense-status="approved"]').length,
        paidExpenses: document.querySelectorAll('#admin-expense-list [data-expense-status="paid"]').length,
        rejectedExpenses: document.querySelectorAll('#admin-expense-list [data-expense-status="rejected"]').length,
        expenseActionControls: document.querySelectorAll("#admin-expense-list [data-expense-action]").length,
        budgetText: document.querySelector("#admin-budget")?.textContent?.replace(/\s+/g, " ").trim(),
        partnerActivity: document.querySelectorAll("#admin-partner-activity [data-partner-activity]").length,
        partnerActivityCategories: [...new Set([...document.querySelectorAll("#admin-partner-activity [data-category]")].map(item => item.dataset.category))],
        partnerActivityText: document.querySelector("#admin-partner-activity")?.textContent?.trim(),
        auditEntries: document.querySelectorAll("#admin-audit-list [data-audit-action]").length,
        automationRows: document.querySelectorAll("#admin-job-list [data-automation-row]").length,
        automationJobs: [...document.querySelectorAll("#admin-job-list [data-automation-row]")].reduce((total, row) => total + Number(row.dataset.jobCount || 1), 0),
        completedAutomationJobs: [...document.querySelectorAll('#admin-job-list [data-job-status="done"]')].reduce((total, row) => total + Number(row.dataset.jobCount || 1), 0),
        completedAutomationGroups: document.querySelectorAll('#admin-job-list [data-job-group="completed"]').length,
        automationSummary: document.querySelector("#admin-job-summary")?.textContent?.trim(),
        automationText: document.querySelector("#admin-job-list")?.textContent?.trim(),
        transactionRecordPathBlocks: document.querySelectorAll("#admin-system-monitor .admin-record-card code").length,
        transactionMonitorLeaksStoragePath: /data\/processed|db:\/\/|admin-audit\//.test(document.querySelector("#admin-system-monitor")?.textContent || ""),
        resetReady: document.querySelector("#admin-reset-board-demo")?.hidden === false,
        overflowPixels: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
      }));
      observations.operations.commandNavigation = await verifyCommandNavigation(page);
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
        || !item.runtimeLabel?.includes("No external messages, charges, or live-provider calls")
        || !item.deployment?.includes("board demo · ready · live providers post-board")
        || item.ticketPolicyState !== "Approved"
        || item.ticketPolicyVersion !== "board-demo-2027-v1"
        || item.ticketPolicyNotices !== 4
        || item.activationStages !== 2
        || !item.activationBoundary?.includes("Real workflows with synthetic providers")
        || !item.activationBoundary?.includes("Stripe, QuickBooks, Brevo, Twilio, NWS, TxDOT, eight webcam edge agents, OIDC, Turnstile, DNS, and managed recovery")
        || item.commandSignals !== 8
        || item.commandViewport?.width !== 1280
        || item.commandViewport?.height !== 720
        || item.commandViewport?.allVisible !== true
        || item.commandNavigation?.targets?.length !== COMMAND_NAVIGATION_TARGETS.length
        || item.commandNavigation?.keyboard?.targetId !== COMMAND_NAVIGATION_TARGETS[0].targetId
        || item.commandNavigation?.keyboard?.focusedHeading !== true
        || item.commandNavigation?.maxElapsedMs > 2_000
        || !item.apiStatus?.includes("Loaded")
        || item.partnerRefreshLabel !== "Refresh partner workspace"
        || item.conditionsRefreshLabel !== "Refresh island operations"
        || item.conditionSourceHeading !== "Source health"
        || !item.conditionFeedText?.includes("Simulated · Current")
        || item.conditionFeedText?.includes("Live · Live")
        || item.operationsWorkspaceLayout?.fullWidth !== true
        || item.operationsWorkspaceLayout?.stacked !== true
        || item.playbackSources !== 8
        || item.playbackSourceLabels !== 8
        || !item.playbackSourceText?.includes("metric simulated · heartbeat current")
        || item.resetReady !== true
      ) {
        throw new Error(observations.operationsError || "The operations command center did not finish loading.");
      }
      return `${item.commandSignals} operating signals fit the 1280x720 board viewport and open their focused workspaces in at most ${item.commandNavigation.maxElapsedMs} ms; outreach and Island conditions occupy distinct full-width rows, with keyboard activation, the presentation reset control, and persistent synthetic Demo label.`;
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
        || item?.auditEntries < 1
        || item?.automationJobs < 1
        || item?.completedAutomationJobs !== item?.automationJobs
        || item?.automationRows >= item?.automationJobs
        || item?.completedAutomationGroups < 1
        || !item?.automationSummary?.includes(`${item.automationJobs} complete`)
        || !item?.automationSummary?.includes("0 need review")
        || !item?.automationText?.includes("Partner message delivery")
        || !item?.automationText?.includes("completed runs")
        || !item?.automationText?.includes("Open Message drafts")
        || /job_|followup_|@/.test(item?.automationText || "")
        || item?.transactionRecordPathBlocks !== 0
        || item?.transactionMonitorLeaksStoragePath !== false
      ) {
        throw new Error("One or more board workflow queues did not render their prepared records.");
      }
      return `${item.partnerApplications} applications and ${item.partnerActivity} grouped updates render every operating category without internal record IDs; Systems groups ${item.automationJobs} completed automation records into ${item.completedAutomationGroups} workflow digest${item.completedAutomationGroups === 1 ? "" : "s"} beside ${item.auditEntries} readable audit entries, without private payloads or storage paths.`;
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
        || !item?.partnerKpis?.Received?.includes("1 active payment")
        || !item?.partnerKpis?.Received?.includes("0 accounts paid in full")
        || !item?.partnerKpis?.QuickBooks?.includes("Post-board")
        || !item?.partnerKpis?.["Online invoices"]?.includes("Local sandbox")
        || !item?.partnerKpis?.["Online invoices"]?.includes("Private portal payments active")
        || !item?.partnerKpis?.Messaging?.includes("Provider check")
        || !item?.partnerKpis?.Messaging?.includes("provider verification required before retry")
        || item?.budgetLines !== 6
        || item?.budgetAllocationEdits !== 6
        || item?.budgetExports !== 2
        || !item?.budgetExportText?.includes("Budget")
        || !item?.budgetExportText?.includes("Expenses")
        || item?.budgetExpenses !== 7
        || item?.submittedExpenses !== 2
        || item?.approvedExpenses !== 2
        || item?.paidExpenses !== 2
        || item?.rejectedExpenses !== 1
        || item?.expenseActionControls < 6
        || !item?.budgetKpis?.["Annual budget"]?.includes("$530,000.00")
        || !item?.budgetKpis?.Committed?.includes("$186,400.00")
        || !item?.budgetKpis?.["Awaiting approval"]?.includes("$92,000.00")
        || !item?.budgetText?.includes("QuickBooks synchronization remains separate")
        || /RAMP-DEMO|budget_line_|expense_/.test(item?.budgetText || "")
        || item?.quickBooksState !== "deferred"
      ) {
        throw new Error("Budget control, receivables, or partner key-date proof is incomplete.");
      }
      return `${item.budgetLines} editable allocations and ${item.budgetExpenses} expenses across submitted, approved, paid, and rejected states render with audited accounting downloads; ${item.openReceivables} receivable accounts and ${item.milestones} editable key dates are tracked; live QuickBooks remains explicitly deferred.`;
    });
    await inspect("messaging_delegation", "Automated messages and delegation", "Inspect local delivery proof and staff, volunteer, and team assignments.", async () => {
      const item = observations.operations;
      const requiredAssignmentTypes = ["staff", "volunteer", "team"];
      if (
        item?.followups < 4
        || item?.deliveredFollowups < 2
        || !item?.commandSignalText?.messages?.includes("1 provider check")
        || !item?.commandSignalText?.messages?.includes("need verification")
        || item?.deliveredTransactionalMessages < 1
        || item?.deliveredCampaignMessages < 1
        || item?.deliveredMilestoneReminders < 1
        || item?.deliveredPaymentConfirmations < 1
        || item?.deliveredApplicationDecisions < 1
        || item?.deliveredSponsorProofReviews < 1
        || item?.deliveredVendorOpenings < 1
        || item?.smsPreferenceVisible !== true
        || !["opted_in", "opted_out"].includes(item?.smsPreferenceState)
        || !item?.smsPreferenceText?.includes("signed sandbox callback")
        || /\+1\d{10}/.test(item?.smsPreferenceText || "")
        || (item?.smsPreferenceState === "opted_in" && (!item?.smsStopEnabled || item?.smsStartEnabled))
        || (item?.smsPreferenceState === "opted_out" && (item?.smsStopEnabled || !item?.smsStartEnabled))
        || item?.reviewQueueShowsAutomaticReminder !== true
        || item?.reviewReadyOutreachMessages < 1
        || item?.providerVerificationForms !== 1
        || item?.providerVerificationProofFields !== 2
        || item?.providerVerificationActions !== 2
        || item?.providerVerificationLockedRows !== 1
        || item?.reviewQueueStartsWithProviderCheck !== true
        || item?.editableMessageDrafts < 1
        || item?.tasks < 9
        || !item?.taskSummary?.includes("active")
        || requiredAssignmentTypes.some(type => !item.taskAssignmentTypes?.includes(type))
        || !item?.commandSignalText?.assignments?.includes("staff / volunteer / team")
      ) {
        throw new Error("Local message automation, SMS preference, or three-way assignment proof is incomplete.");
      }
      return `${item.deliveredFollowups} loopback messages include application decisions, vendor opening, payment confirmation, sponsor proof review, automatic key-date, transactional, and campaign-approved delivery proof; 1 provider outcome is locked for staff verification before retry; the signed SMS preference control is ${item.smsPreferenceState.replace("_", " ")}; ${item.editableMessageDrafts} drafts can be revised before approval and ${item.reviewReadyOutreachMessages} outreach draft remains staff-controlled; ${item.tasks} tasks cover staff, volunteer, and team owners.`;
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
        || item?.campaignOutcomeFunnels < item?.outreachCampaigns
        || item?.campaignReachedBusinesses < 1
        || item?.campaignDeliveredBusinesses < 1
        || item?.reviewFirstCampaigns < 1
        || item?.geofencedCampaigns < 1
        || !item?.campaignPreflightReady
      ) {
        throw new Error("Sponsor, vendor, or geofenced outreach proof is incomplete.");
      }
      return `${item.approvedBrandAssets} approved brand assets, ${item.sponsorDeliverables} sponsor benefits, ready and blocked vendor paths, an invitation-ready located prospect, server-qualified campaign preflight, and ${item.campaignDeliveredBusinesses} delivered campaign business${item.campaignDeliveredBusinesses === 1 ? "" : "es"} rendered.`;
    });
    await inspect("document_ingestion", "Private document ingestion", "Inspect governed files, extraction states, and staff-only previews.", async () => {
      const item = observations.operations;
      if (item?.documents < 4 || item?.extractionReady < 1 || item?.extractedPreviews < 1) {
        throw new Error("The private document queue lacks extracted, reviewable presentation proof.");
      }
      return `${item.documents} governed documents rendered with ${item.extractionReady} completed extraction and ${item.extractedPreviews} staff-only previews.`;
    });
    try {
      const responsivePage = await context.newPage();
      responsivePage.on("pageerror", error => pageErrors.push(error.message));
      responsivePage.on("console", message => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      responsivePage.on("response", response => {
        if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
      });
      try {
        observations.responsive = {
          visitor320: await responsiveLayoutObservation(responsivePage, {
            surface: "visitor",
            url: visitorUrl,
            width: 320,
            height: 740
          }),
          visitor1024: await responsiveLayoutObservation(responsivePage, {
            surface: "visitor",
            url: visitorUrl,
            width: 1024,
            height: 768
          }),
          operations320: await responsiveLayoutObservation(responsivePage, {
            surface: "operations",
            url: operationsUrl,
            width: 320,
            height: 740
          }),
          operations768: await responsiveLayoutObservation(responsivePage, {
            surface: "operations",
            url: operationsUrl,
            width: 768,
            height: 844
          })
        };
      } finally {
        await responsivePage.close();
      }
    } catch (error) {
      observations.responsiveError = error.message;
    }

    await inspect("responsive_layout", "Phone and tablet presentation layout", "Inspect the active Visitor and Operations links at 320px and 768px.", async () => {
      const snapshots = observations.responsive;
      if (!snapshots) throw new Error(observations.responsiveError || "Responsive presentation checks did not run.");
      const expectedWorkspaceLabels = ["Overview", "Documents", "Partners", "Accounting", "Staffing", "Island conditions", "Systems"];
      const required = [snapshots.visitor320, snapshots.visitor1024, snapshots.operations320, snapshots.operations768];
      const issue = required.find(item => (
        !item
        || item.controlCount < 1
        || item.overflowPixels > 0
        || item.controlTargetIssues.length > 0
        || item.choiceTargetIssues.length > 0
        || item.sourceLinks.targetIssues.length > 0
      ));
      if (issue) throw new Error(`Responsive target or overflow failure: ${JSON.stringify(issue)}`);
      if (
        snapshots.visitor320.nextSectionHint.id !== "live-beach"
        || snapshots.visitor320.nextSectionHint.headingVisiblePixels < 24
        || snapshots.visitor1024.nextSectionHint.id !== "live-beach"
        || snapshots.visitor1024.nextSectionHint.headingVisiblePixels < 24
      ) throw new Error(`A Visitor hero hides the Live Beach cue: ${JSON.stringify({ mobile: snapshots.visitor320.nextSectionHint, tablet: snapshots.visitor1024.nextSectionHint })}`);
      for (const item of [snapshots.operations320, snapshots.operations768]) {
        if (
          item.workspaceNavigation.labels.join("|") !== expectedWorkspaceLabels.join("|")
          || item.workspaceNavigation.overflowPixels > 1
          || item.workspaceNavigation.clippedLabels.length > 0
          || item.readinessFilters.count !== 2
          || item.readinessFilters.clippedLabels.length > 0
        ) throw new Error(`Operations navigation or readiness labels are clipped: ${JSON.stringify(item)}`);
      }
      return `The active Visitor fits at 320x740 and 1024x768 with ${Math.round(snapshots.visitor320.nextSectionHint.headingVisiblePixels)}px and ${Math.round(snapshots.visitor1024.nextSectionHint.headingVisiblePixels)}px Live Beach cues, and Operations fits at 320x740 and 768x844 with ${required.reduce((total, item) => total + item.controlCount, 0)} visible controls at least 24px, unclipped workspace/readiness labels, and no horizontal overflow.`;
    });

    await inspect("browser_health", "Browser render health", "Inspect browser errors and page-width layout on both presentation surfaces.", async () => {
      if (pageErrors.length || consoleErrors.length || httpErrors.length) {
        throw new Error(`Browser errors: ${[...httpErrors, ...pageErrors, ...consoleErrors].slice(0, 3).join(" | ")}`);
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
      ["responsive_layout", "Phone and tablet presentation layout"],
      ["browser_health", "Browser render health"]
    ];
    for (const [id, label] of pending) {
      if (!checks.some(item => item.id === id)) record(id, label, false, `Browser rehearsal could not run: ${error.message}`, `Install ${browserLabel} with npx playwright install ${browserEngine} and retry.`);
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
    ["responsive_layout", "Phone and tablet presentation layout"],
    ["browser_health", "Browser render health"]
  ]) record(id, label, false, "The active presentation session is unavailable.", "Start the board stack with npm run board:demo.");
}

const report = {
  ok: checks.every(item => item.ok),
  checkedAt: new Date().toISOString(),
  browserEngine,
  passed: checks.filter(item => item.ok).length,
  total: checks.length,
  links: { visitor: visitorUrl, operations: operationsUrl },
  checks,
  observations
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Board ${browserLabel} browser rehearsal: ${report.passed}/${report.total} checks passed.`);
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
