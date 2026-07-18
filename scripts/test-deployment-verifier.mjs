#!/usr/bin/env node

import {
  compiledAssetNames,
  deploymentVerificationConfig,
  securityHeaderFailures,
  serviceWorkerCacheVersion,
  verifyLiveDeployment
} from "../lib/deployment-verifier.mjs";

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    passed += 1;
    console.log(`  ok ${label}`);
  } else {
    failed += 1;
    console.error(`  not ok ${label}`);
  }
}

const publicHtml = '<title>Texas SandFest | Port Aransas</title><script src="/assets/main-current.js"></script><link href="/assets/main-current.css" rel="stylesheet">';
const adminHtml = '<title>SandFest Ops Console</title><script src="/assets/admin-current.js"></script><link href="/assets/admin-current.css" rel="stylesheet">';
const publicWorker = 'const CACHE_VERSION = "sandfest-public-current";';
const securityHeaders = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "cache-control": "no-store"
};
const config = deploymentVerificationConfig({
  SANDFEST_LIVE_PUBLIC_URL: "https://public.example.test/festival",
  SANDFEST_LIVE_API_URL: "https://api.example.test/sandfest",
  SANDFEST_LIVE_ADMIN_URL: "https://admin.example.test",
  SANDFEST_LIVE_EXPECTED_EVENT_ID: "texas-sandfest-2027"
});

function jsonResponse(value, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...securityHeaders, ...extraHeaders }
  });
}

function textResponse(value, extraHeaders = {}) {
  return new Response(value, { status: 200, headers: { "content-type": "text/html", ...securityHeaders, ...extraHeaders } });
}

const readyBody = {
  ok: true,
  checks: { storage: "postgres", worker: true, queue: true, deployment: true },
  deployment: {
    production: true,
    ok: true,
    errors: 0,
    requiredCapabilities: config.requiredCapabilities
  }
};
const healthBody = {
  ok: true,
  environment: "production",
  authMode: "jwt",
  storage: "postgres",
  rateLimitBackend: "redis",
  runtimeDataMode: "repository",
  currentEventId: "texas-sandfest-2027",
  currentEventReady: true
};
const liveConditionsBody = {
  weather: {
    status: "live",
    observedAt: "2026-07-17T12:40:00.000Z",
    temperatureF: 83,
    freshness: { state: "live", ageMinutes: 3 }
  },
  ferry: {
    status: "live",
    observedAt: "2026-07-17T12:40:00.000Z",
    checkedAt: "2026-07-17T12:40:00.000Z",
    freshness: { state: "live", ageMinutes: 3 }
  },
  cameras: Array.from({ length: 8 }, (_, index) => ({
    id: `camera-${index}`,
    operationalStatus: "live",
    freshness: { state: "live", ageMinutes: 1 },
    observation: { observedAt: "2026-07-17T12:42:00.000Z" }
  })),
  summary: {
    configuredCameras: 8,
    armedCameras: 8,
    liveCameras: 8,
    healthyPipelines: 8
  }
};
const routes = new Map([
  [config.publicUrl, () => textResponse(publicHtml)],
  [new URL("sw.js", config.publicUrl).toString(), () => textResponse(publicWorker)],
  [new URL("data/app-bootstrap.json", config.publicUrl).toString(), () => jsonResponse({ guide: { id: "texas-sandfest-2027" } })],
  [new URL("assets/sandfest-media/media-manifest.json", config.publicUrl).toString(), () => jsonResponse({ assets: [] })],
  [config.adminUrl, () => textResponse(adminHtml)],
  [new URL("health", config.apiUrl).toString(), () => jsonResponse(healthBody)],
  [new URL("ready", config.apiUrl).toString(), () => jsonResponse(readyBody)],
  [new URL("api/public/bootstrap", config.apiUrl).toString(), options => jsonResponse({ guide: { id: "texas-sandfest-2027" } }, options?.headers?.origin ? { "access-control-allow-origin": options.headers.origin } : {})],
  [new URL("api/public/tickets", config.apiUrl).toString(), () => jsonResponse({ products: [{ availableForCheckout: true }] })],
  [new URL("api/public/sponsors", config.apiUrl).toString(), () => jsonResponse({ sponsorPackages: [{ id: "whale", name: "Whale", amount: 2500000, currency: "usd", publicLabel: "$25k+", active: true, requiresApproval: true, benefits: ["Main-stage recognition"] }] })],
  [new URL("api/public/vendors", config.apiUrl).toString(), () => jsonResponse({ vendorOfferings: [{ id: "food" }] })],
  [new URL("api/public/island-conditions", config.apiUrl).toString(), () => jsonResponse(liveConditionsBody)]
]);
const fetchImpl = async (url, options = {}) => {
  const factory = routes.get(String(url));
  if (!factory) return new Response("not found", { status: 404 });
  return factory(options);
};

console.log("\n=== Deployment verifier tests ===\n");
const successful = await verifyLiveDeployment({ config, artifacts: { publicHtml, adminHtml, publicWorker }, fetchImpl });
check("complete production surface passes", successful.ok && successful.summary.failed === 0);

const unsafeSponsorFetch = async (url, options = {}) => {
  if (String(url) === new URL("api/public/sponsors", config.apiUrl).toString()) {
    return jsonResponse({ sponsorPackages: [{ id: "whale", name: "Whale", amount: 0, currency: "usd", publicLabel: "$0", active: true, requiresApproval: true, benefits: [], quickBooksItemId: "77" }] });
  }
  return fetchImpl(url, options);
};
const unsafeSponsors = await verifyLiveDeployment({ config, artifacts: { publicHtml, adminHtml, publicWorker }, fetchImpl: unsafeSponsorFetch });
check("malformed or provider-exposing sponsor tiers fail closed", !unsafeSponsors.ok
  && unsafeSponsors.checks.some(item => item.id === "api.sponsor_tiers" && !item.ok)
  && unsafeSponsors.checks.some(item => item.id === "api.sponsor_tier_privacy" && !item.ok));

const unsafeBootstrapFetch = async (url, options = {}) => {
  const target = String(url);
  const staticBootstrapUrl = new URL("data/app-bootstrap.json", config.publicUrl).toString();
  const apiBootstrapUrl = new URL("api/public/bootstrap", config.apiUrl).toString();
  if (target === staticBootstrapUrl || target === apiBootstrapUrl) {
    return jsonResponse({
      guide: { id: "texas-sandfest-2027" },
      schedule: [{ id: "briefing", title: "Volunteer captain briefing", category: "Staff" }],
      sponsors: [{ invoiceStatus: "overdue" }]
    }, options?.headers?.origin ? { "access-control-allow-origin": options.headers.origin } : {});
  }
  return fetchImpl(url, options);
};
const unsafeBootstrap = await verifyLiveDeployment({ config, artifacts: { publicHtml, adminHtml, publicWorker }, fetchImpl: unsafeBootstrapFetch });
check("private static and API bootstrap fields fail closed", !unsafeBootstrap.ok
  && unsafeBootstrap.checks.some(item => item.id === "public.static_bootstrap_privacy" && !item.ok)
  && unsafeBootstrap.checks.some(item => item.id === "api.public_bootstrap_privacy" && !item.ok));

const unsafeMediaFetch = async (url, options = {}) => {
  if (String(url) === new URL("assets/sandfest-media/media-manifest.json", config.publicUrl).toString()) {
    return jsonResponse({ assets: [{ id: "hero", publicPath: "/assets/sandfest-media/hero.jpg", file: "/Users/operator/private/hero.jpg" }] });
  }
  return fetchImpl(url, options);
};
const unsafeMedia = await verifyLiveDeployment({ config, artifacts: { publicHtml, adminHtml, publicWorker }, fetchImpl: unsafeMediaFetch });
check("public media manifest filesystem paths fail closed", !unsafeMedia.ok
  && unsafeMedia.checks.some(item => item.id === "public.media_manifest_privacy" && !item.ok));

const staleConditionsFetch = async (url, options = {}) => {
  if (String(url) === new URL("api/public/island-conditions", config.apiUrl).toString()) {
    return jsonResponse({
      weather: { status: "stale", freshness: { state: "stale" } },
      ferry: { status: "unavailable", freshness: { state: "stale" } },
      cameras: Array.from({ length: 8 }, (_, index) => ({
        id: `camera-${index}`,
        operationalStatus: "awaiting_heartbeat",
        freshness: { state: "unavailable" },
        observation: null
      })),
      summary: { configuredCameras: 8, armedCameras: 8, liveCameras: 0, healthyPipelines: 0 }
    });
  }
  return fetchImpl(url, options);
};
const staleConditions = await verifyLiveDeployment({
  config,
  artifacts: { publicHtml, adminHtml, publicWorker },
  fetchImpl: staleConditionsFetch
});
check("stale Island Conditions and placeholder cameras fail closed", !staleConditions.ok
  && staleConditions.checks.some(item => item.id === "api.weather_current" && !item.ok)
  && staleConditions.checks.some(item => item.id === "api.ferry_current" && !item.ok)
  && staleConditions.checks.some(item => item.id === "api.camera_fleet_live" && !item.ok));

const stale = await verifyLiveDeployment({
  config,
  artifacts: { publicHtml: publicHtml.replaceAll("current", "next"), adminHtml, publicWorker: publicWorker.replace("current", "next") },
  fetchImpl
});
check("stale public artifact fails closed", !stale.ok && stale.checks.some(item => item.id === "public.artifact_freshness" && !item.ok) && stale.checks.some(item => item.id === "public.worker_freshness" && !item.ok));

const insecure = new Headers({ "x-content-type-options": "nosniff" });
check("missing edge security headers fail closed", securityHeaderFailures(insecure, { document: true }).length === 4);

const invalid = deploymentVerificationConfig({ SANDFEST_LIVE_PUBLIC_URL: "http://public.example.test" });
check("non-HTTPS target is rejected", !invalid.ready && invalid.reason.includes("HTTPS"));
check("artifact helpers preserve exact build identity", compiledAssetNames(publicHtml).includes("main-current.js") && serviceWorkerCacheVersion(publicWorker) === "sandfest-public-current");

console.log(`\nDeployment verifier total: ${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
