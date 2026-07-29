#!/usr/bin/env node

import {
  compiledAssetNames,
  deploymentVerificationConfig,
  securityHeaderFailures,
  serviceWorkerCacheVersion,
  verifyProductionApi,
  verifyLiveDeployment
} from "../lib/deployment-verifier.mjs";
import { publicGuestServicesReadiness } from "../lib/guest-services.mjs";
import { publicPartnerServerReadiness } from "../lib/public-partner-server-readiness.mjs";
import { sandfestAppleAppSiteAssociation } from "../lib/public-deep-links.mjs";

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
const publicAppleAssociation = sandfestAppleAppSiteAssociation("ABCDE12345");
const artifacts = { publicHtml, adminHtml, publicWorker, publicAppleAssociation };
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
  SANDFEST_LIVE_EXPECTED_EVENT_ID: "texas-sandfest-2027",
  SANDFEST_APPLE_APP_ID_PREFIX: "ABCDE12345"
});
const allowedCorsOrigins = new Set([
  new URL(config.publicUrl).origin,
  new URL(config.adminUrl).origin
]);

function jsonResponse(value, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...securityHeaders, ...extraHeaders }
  });
}

function textResponse(value, extraHeaders = {}) {
  return new Response(value, { status: 200, headers: { "content-type": "text/html", ...securityHeaders, ...extraHeaders } });
}

function originCorsHeaders(options = {}) {
  const origin = String(options?.headers?.origin || "");
  return allowedCorsOrigins.has(origin) ? { "access-control-allow-origin": origin } : {};
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
const publicGuidance = [{
  id: "parking",
  category: "Arrival",
  question: "Where should I park?",
  answer: "Review the current official parking and shuttle guidance before traveling.",
  keywords: ["parking"],
  sourceLabel: "Official Parking and Shuttles",
  sourceUrl: "https://www.texassandfest.org/parking-shuttles",
  sourceCheckedAt: "2026-07-17T12:40:00.000Z",
  effectiveAt: "2026-06-01T00:00:00.000Z",
  expiresAt: "2027-04-19T23:59:59.000Z"
}];
const routes = new Map([
  [config.publicUrl, () => textResponse(publicHtml)],
  [new URL("sw.js", config.publicUrl).toString(), () => textResponse(publicWorker)],
  [new URL("data/app-bootstrap.json", config.publicUrl).toString(), () => jsonResponse({ guide: { id: "texas-sandfest-2027" }, guidance: publicGuidance })],
  [new URL("assets/sandfest-media/media-manifest.json", config.publicUrl).toString(), () => jsonResponse({ assets: [] })],
  [new URL("/.well-known/apple-app-site-association", config.publicUrl).toString(), () => jsonResponse(publicAppleAssociation)],
  [config.adminUrl, () => textResponse(adminHtml)],
  [new URL("health", config.apiUrl).toString(), () => jsonResponse(healthBody)],
  [new URL("ready", config.apiUrl).toString(), () => jsonResponse(readyBody)],
  [new URL("api/public/bootstrap", config.apiUrl).toString(), options => jsonResponse({ guide: { id: "texas-sandfest-2027" }, guidance: publicGuidance }, originCorsHeaders(options))],
  [new URL("api/public/tickets", config.apiUrl).toString(), () => jsonResponse({ products: [{ availableForCheckout: true }] })],
  [new URL("api/public/sponsors", config.apiUrl).toString(), () => jsonResponse({ sponsorPackages: [{ id: "whale", name: "Whale", amount: 2500000, currency: "usd", publicLabel: "$25k+", active: true, requiresApproval: true, benefits: ["Main-stage recognition"] }] })],
  [new URL("api/public/vendors", config.apiUrl).toString(), () => jsonResponse({ vendorOfferings: [{ id: "food" }] })],
  [new URL("api/public/partner-intake", config.apiUrl).toString(), () => jsonResponse(publicPartnerServerReadiness({ eventId: "texas-sandfest-2027", intakeAvailable: true, recoveryAvailable: true }))],
  [new URL("api/public/guest-services", config.apiUrl).toString(), () => jsonResponse(publicGuestServicesReadiness({ eventId: "texas-sandfest-2027", available: true }))],
  [new URL("api/public/island-conditions", config.apiUrl).toString(), () => jsonResponse(liveConditionsBody)],
  [new URL("api/public/concierge", config.apiUrl).toString(), () => jsonResponse({
    answer: "Current ticket options are available in the Tickets section.",
    topic: "tickets",
    confidence: "high",
    escalated: false,
    sources: [{ id: "tickets", label: "Current ticket options", href: "#tickets", updatedAt: "2026-07-17T12:40:00.000Z" }],
    suggestions: ["When is SandFest?"]
  })]
]);
const fetchImpl = async (url, options = {}) => {
  const factory = routes.get(String(url));
  if (!factory) return new Response("not found", { status: 404 });
  return factory(options);
};

console.log("\n=== Deployment verifier tests ===\n");
const successful = await verifyLiveDeployment({ config, artifacts, fetchImpl });
check("complete production surface passes", successful.ok && successful.summary.failed === 0);
const apiOnly = await verifyProductionApi({ config, fetchImpl });
check("API-only release gate reuses the complete production contract", apiOnly.ok
  && apiOnly.checks.length > 10
  && apiOnly.checks.every(item => item.surface === "api"));

const unavailableReadyFetch = async (url, options = {}) => {
  if (String(url) === new URL("ready", config.apiUrl).toString()) {
    return new Response(JSON.stringify({
      ok: false,
      deployment: { production: true, ok: false, errors: 1, requiredCapabilities: config.requiredCapabilities },
      checks: { storage: "postgres", worker: true, queue: true, deployment: false }
    }), {
      status: 503,
      headers: { "content-type": "application/json", ...securityHeaders }
    });
  }
  return fetchImpl(url, options);
};
const unavailableApi = await verifyProductionApi({ config, fetchImpl: unavailableReadyFetch });
check("API-only release gate blocks a red readiness endpoint", !unavailableApi.ok
  && unavailableApi.checks.some(item => item.id === "api.readiness" && !item.ok));

const boardSiteDeferredFetch = async (url, options = {}) => {
  const target = String(url);
  if (target === new URL("ready", config.apiUrl).toString()) {
    return new Response(JSON.stringify({
      ok: false,
      deployment: {
        production: true,
        ok: false,
        errors: 4,
        requiredCapabilities: config.requiredCapabilities
      },
      checks: { storage: "postgres", worker: true, queue: true, deployment: true }
    }), {
      status: 503,
      headers: { "content-type": "application/json", ...securityHeaders }
    });
  }
  if (target === new URL("api/public/tickets", config.apiUrl).toString()) {
    return jsonResponse({ products: [{ id: "general-admission", availableForCheckout: false }] });
  }
  if (target === new URL("api/public/partner-intake", config.apiUrl).toString()) {
    return jsonResponse(publicPartnerServerReadiness({ eventId: "texas-sandfest-2027", intakeAvailable: true, recoveryAvailable: false }));
  }
  if (target === new URL("api/public/island-conditions", config.apiUrl).toString()) {
    return jsonResponse({
      weather: { status: "pending_live_provider", freshness: { state: "unavailable" } },
      ferry: { status: "unavailable", freshness: { state: "unavailable" } },
      cameras: Array.from({ length: 8 }, (_, index) => ({
        id: `camera-${index}`,
        operationalStatus: "awaiting_heartbeat",
        freshness: { state: "unavailable" },
        observation: null
      })),
      summary: { configuredCameras: 8, armedCameras: 0, liveCameras: 0, healthyPipelines: 0 }
    });
  }
  return fetchImpl(url, options);
};
const boardSiteDeployment = await verifyLiveDeployment({ config, artifacts, fetchImpl: boardSiteDeferredFetch, siteOnly: true });
check("board site deployment gate accepts explicit post-board provider deferrals", boardSiteDeployment.ok
  && boardSiteDeployment.checks.some(item => item.id === "api.site_readiness_boundary" && item.ok)
  && boardSiteDeployment.checks.some(item => item.id === "api.ticket_catalog" && item.ok)
  && boardSiteDeployment.checks.some(item => item.id === "api.partner_recovery_boundary" && item.ok)
  && boardSiteDeployment.checks.some(item => item.id === "api.live_conditions_boundary" && item.ok));
const deferredLaunchDeployment = await verifyLiveDeployment({ config, artifacts, fetchImpl: boardSiteDeferredFetch });
check("full deployment gate still rejects board-only provider deferrals", !deferredLaunchDeployment.ok
  && deferredLaunchDeployment.checks.some(item => item.id === "api.readiness" && !item.ok)
  && deferredLaunchDeployment.checks.some(item => item.id === "api.ticket_checkout" && !item.ok)
  && deferredLaunchDeployment.checks.some(item => item.id === "api.weather_current" && !item.ok)
  && deferredLaunchDeployment.checks.some(item => item.id === "api.camera_fleet_live" && !item.ok));

const unexpectedCapabilityFetch = async (url, options = {}) => {
  if (String(url) === new URL("ready", config.apiUrl).toString()) {
    return jsonResponse({
      ...readyBody,
      deployment: {
        ...readyBody.deployment,
        requiredCapabilities: [...config.requiredCapabilities, "unreviewed_future_gate"]
      }
    });
  }
  return fetchImpl(url, options);
};
const unexpectedCapability = await verifyProductionApi({ config, fetchImpl: unexpectedCapabilityFetch });
check("API release gate rejects unexpected readiness capabilities", !unexpectedCapability.ok
  && unexpectedCapability.checks.some(item => item.id === "api.required_capabilities"
    && !item.ok
    && item.detail.includes("unreviewed_future_gate")));

const unsafeSponsorFetch = async (url, options = {}) => {
  if (String(url) === new URL("api/public/sponsors", config.apiUrl).toString()) {
    return jsonResponse({ sponsorPackages: [{ id: "whale", name: "Whale", amount: 0, currency: "usd", publicLabel: "$0", active: true, requiresApproval: true, benefits: [], quickBooksItemId: "77" }] });
  }
  return fetchImpl(url, options);
};
const unsafeSponsors = await verifyLiveDeployment({ config, artifacts, fetchImpl: unsafeSponsorFetch });
check("malformed or provider-exposing sponsor tiers fail closed", !unsafeSponsors.ok
  && unsafeSponsors.checks.some(item => item.id === "api.sponsor_tiers" && !item.ok)
  && unsafeSponsors.checks.some(item => item.id === "api.sponsor_tier_privacy" && !item.ok));

const unsafePartnerIntakeFetch = async (url, options = {}) => {
  if (String(url) === new URL("api/public/partner-intake", config.apiUrl).toString()) {
    return jsonResponse({
      ...publicPartnerServerReadiness({ eventId: "texas-sandfest-2027", intakeAvailable: true, recoveryAvailable: false }),
      provider: "private-provider"
    });
  }
  return fetchImpl(url, options);
};
const unsafePartnerIntake = await verifyLiveDeployment({ config, artifacts, fetchImpl: unsafePartnerIntakeFetch });
check("unavailable or privacy-expanding partner readiness fails closed", !unsafePartnerIntake.ok
  && unsafePartnerIntake.checks.some(item => item.id === "api.partner_intake_privacy" && !item.ok)
  && unsafePartnerIntake.checks.some(item => item.id === "api.partner_recovery" && !item.ok));

const unsafeBootstrapFetch = async (url, options = {}) => {
  const target = String(url);
  const staticBootstrapUrl = new URL("data/app-bootstrap.json", config.publicUrl).toString();
  const apiBootstrapUrl = new URL("api/public/bootstrap", config.apiUrl).toString();
  if (target === staticBootstrapUrl || target === apiBootstrapUrl) {
    return jsonResponse({
      guide: { id: "texas-sandfest-2027" },
      schedule: [{ id: "briefing", title: "Volunteer captain briefing", category: "Staff" }],
      sponsors: [{ invoiceStatus: "overdue" }]
    }, originCorsHeaders(options));
  }
  return fetchImpl(url, options);
};
const unsafeBootstrap = await verifyLiveDeployment({ config, artifacts, fetchImpl: unsafeBootstrapFetch });
check("private static and API bootstrap fields fail closed", !unsafeBootstrap.ok
  && unsafeBootstrap.checks.some(item => item.id === "public.static_bootstrap_privacy" && !item.ok)
  && unsafeBootstrap.checks.some(item => item.id === "api.public_bootstrap_privacy" && !item.ok));

const reflectingCorsFetch = async (url, options = {}) => {
  if (String(url) === new URL("api/public/bootstrap", config.apiUrl).toString()) {
    return jsonResponse({ guide: { id: "texas-sandfest-2027" }, guidance: publicGuidance }, options?.headers?.origin ? { "access-control-allow-origin": options.headers.origin } : {});
  }
  return fetchImpl(url, options);
};
const unsafeCors = await verifyLiveDeployment({ config, artifacts, fetchImpl: reflectingCorsFetch });
check("API release gate rejects reflected untrusted CORS origins", !unsafeCors.ok
  && unsafeCors.checks.some(item => item.id === "api.cors_rejects_untrusted_origin" && !item.ok));

const unsafeMediaFetch = async (url, options = {}) => {
  if (String(url) === new URL("assets/sandfest-media/media-manifest.json", config.publicUrl).toString()) {
    return jsonResponse({ assets: [{ id: "hero", publicPath: "/assets/sandfest-media/hero.jpg", file: "/Users/operator/private/hero.jpg" }] });
  }
  return fetchImpl(url, options);
};
const unsafeMedia = await verifyLiveDeployment({ config, artifacts, fetchImpl: unsafeMediaFetch });
check("public media manifest filesystem paths fail closed", !unsafeMedia.ok
  && unsafeMedia.checks.some(item => item.id === "public.media_manifest_privacy" && !item.ok));

const unsafeConciergeFetch = async (url, options = {}) => {
  if (String(url) === new URL("api/public/concierge", config.apiUrl).toString()) {
    return jsonResponse({
      answer: "Internal answer",
      topic: "tickets",
      confidence: "high",
      escalated: false,
      sources: [{ id: "private", label: "Runtime", href: "#tickets", updatedAt: null }],
      suggestions: [],
      storageRoot: "/private/runtime"
    });
  }
  return fetchImpl(url, options);
};
const unsafeConcierge = await verifyLiveDeployment({ config, artifacts, fetchImpl: unsafeConciergeFetch });
check("public concierge private fields fail closed", !unsafeConcierge.ok
  && unsafeConcierge.checks.some(item => item.id === "api.public_concierge" && !item.ok));

const unsafeGuestServicesFetch = async (url, options = {}) => {
  if (String(url) === new URL("api/public/guest-services", config.apiUrl).toString()) {
    return jsonResponse({
      ...publicGuestServicesReadiness({ eventId: "texas-sandfest-2027", available: true }),
      secretReady: true,
      categories: [{ id: "lost_item", label: "Lost item", defaultTeam: "guest-services" }]
    });
  }
  return fetchImpl(url, options);
};
const unsafeGuestServices = await verifyLiveDeployment({ config, artifacts, fetchImpl: unsafeGuestServicesFetch });
check("Guest Services readiness rejects private routing and secret state", !unsafeGuestServices.ok
  && unsafeGuestServices.checks.some(item => item.id === "api.guest_services_intake" && !item.ok)
  && unsafeGuestServices.checks.some(item => item.id === "api.guest_services_privacy" && !item.ok));

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
  artifacts,
  fetchImpl: staleConditionsFetch
});
check("stale Island Conditions and placeholder cameras fail closed", !staleConditions.ok
  && staleConditions.checks.some(item => item.id === "api.weather_current" && !item.ok)
  && staleConditions.checks.some(item => item.id === "api.ferry_current" && !item.ok)
  && staleConditions.checks.some(item => item.id === "api.camera_fleet_live" && !item.ok));

const stale = await verifyLiveDeployment({
  config,
  artifacts: { ...artifacts, publicHtml: publicHtml.replaceAll("current", "next"), publicWorker: publicWorker.replace("current", "next") },
  fetchImpl
});
check("stale public artifact fails closed", !stale.ok && stale.checks.some(item => item.id === "public.artifact_freshness" && !item.ok) && stale.checks.some(item => item.id === "public.worker_freshness" && !item.ok));

const mixedPublicAssetsFetch = async (url, options = {}) => {
  if (String(url) === config.publicUrl) {
    return textResponse(publicHtml.replace("</title>", "</title><script src=\"/assets/main-old.js\"></script><link href=\"/assets/main-old.css\" rel=\"stylesheet\">"));
  }
  return fetchImpl(url, options);
};
const mixedPublicAssets = await verifyLiveDeployment({ config, artifacts, fetchImpl: mixedPublicAssetsFetch });
check("mixed public compiled assets fail closed", !mixedPublicAssets.ok
  && mixedPublicAssets.checks.some(item => item.id === "public.artifact_freshness"
    && !item.ok
    && item.detail.includes("main-old")));

const mixedAdminAssetsFetch = async (url, options = {}) => {
  if (String(url) === config.adminUrl) {
    return textResponse(adminHtml.replace("</title>", "</title><script src=\"/assets/admin-old.js\"></script><link href=\"/assets/admin-old.css\" rel=\"stylesheet\">"));
  }
  return fetchImpl(url, options);
};
const mixedAdminAssets = await verifyLiveDeployment({ config, artifacts, fetchImpl: mixedAdminAssetsFetch });
check("mixed admin compiled assets fail closed", !mixedAdminAssets.ok
  && mixedAdminAssets.checks.some(item => item.id === "admin.artifact_freshness"
    && !item.ok
    && item.detail.includes("admin-old")));

const insecure = new Headers({ "x-content-type-options": "nosniff" });
check("missing edge security headers fail closed", securityHeaderFailures(insecure, { document: true }).length === 4);

const invalid = deploymentVerificationConfig({ SANDFEST_LIVE_PUBLIC_URL: "http://public.example.test" });
check("non-HTTPS target is rejected", !invalid.ready && invalid.reason.includes("HTTPS"));
const missingAppleIdentity = deploymentVerificationConfig({ SANDFEST_LIVE_PUBLIC_URL: "https://public.example.test" });
check("missing Apple application identity is rejected", !missingAppleIdentity.ready && missingAppleIdentity.reason.includes("SANDFEST_APPLE_APP_ID_PREFIX"));
check("artifact helpers preserve exact build identity", compiledAssetNames(publicHtml).includes("main-current.js") && serviceWorkerCacheVersion(publicWorker) === "sandfest-public-current");

console.log(`\nDeployment verifier total: ${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
