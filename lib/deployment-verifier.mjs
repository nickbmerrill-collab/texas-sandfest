import { sponsorPackageCatalog } from "./sponsor-packages.mjs";

const DEFAULT_PUBLIC_URL = "https://sandfest.heyelab.com/";
const DEFAULT_API_URL = "https://api.heyelab.com/sandfest/";
const DEFAULT_ADMIN_URL = "https://sandfest-admin.heyelab.com/";
const DEFAULT_EVENT_ID = "texas-sandfest-2027";
const DEFAULT_REQUIRED_CAPABILITIES = [
  "stripe_ticketing",
  "stripe_partner_payments",
  "transactional_email",
  "quickbooks_invoices",
  "camera_ingest",
  "staff_directory",
  "outreach_discovery",
  "sms_safety"
];
const CURRENT_FERRY_STATES = new Set(["live", "partial", "service_interruption", "camera_estimate"]);

function boundedText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizedBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${url.hostname || "Deployment target"} must use HTTPS.`);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function targetUrl(baseUrl, relativePath = "") {
  return new URL(String(relativePath).replace(/^\/+/, ""), baseUrl).toString();
}

function capabilityList(value) {
  const values = String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  return [...new Set(values.length ? values : DEFAULT_REQUIRED_CAPABILITIES)];
}

export function deploymentVerificationConfig(env = process.env) {
  const errors = [];
  const parse = (name, fallback) => {
    try {
      return normalizedBaseUrl(boundedText(env[name] || fallback, 2000));
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
      return fallback;
    }
  };
  const timeoutMs = Number(env.SANDFEST_DEPLOY_VERIFY_TIMEOUT_MS || 12_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    errors.push("SANDFEST_DEPLOY_VERIFY_TIMEOUT_MS must be between 1000 and 60000.");
  }
  const expectedEventId = boundedText(env.SANDFEST_LIVE_EXPECTED_EVENT_ID || DEFAULT_EVENT_ID, 120);
  if (!/^texas-sandfest-\d{4}$/.test(expectedEventId)) {
    errors.push("SANDFEST_LIVE_EXPECTED_EVENT_ID must be an annual Texas SandFest event id.");
  }
  const config = {
    publicUrl: parse("SANDFEST_LIVE_PUBLIC_URL", DEFAULT_PUBLIC_URL),
    apiUrl: parse("SANDFEST_LIVE_API_URL", DEFAULT_API_URL),
    adminUrl: parse("SANDFEST_LIVE_ADMIN_URL", DEFAULT_ADMIN_URL),
    expectedEventId,
    requiredCapabilities: capabilityList(env.SANDFEST_LIVE_REQUIRED_CAPABILITIES),
    timeoutMs: Number.isInteger(timeoutMs) ? timeoutMs : 12_000
  };
  return {
    ...config,
    ready: errors.length === 0,
    reason: errors.length ? errors.join(" ") : null
  };
}

export function compiledAssetNames(html) {
  const assets = [];
  const pattern = /(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gi;
  let match;
  while ((match = pattern.exec(String(html || "")))) {
    try {
      const pathname = new URL(match[1], "https://artifact.invalid/").pathname;
      const name = pathname.split("/").filter(Boolean).pop();
      if (name) assets.push(name);
    } catch {
      // Invalid artifact URLs are ignored and fail the non-empty/freshness checks.
    }
  }
  return [...new Set(assets)].sort();
}

export function serviceWorkerCacheVersion(source) {
  return String(source || "").match(/const CACHE_VERSION = ["']([^"']+)["'];/)?.[1] || null;
}

export function securityHeaderFailures(headers, { document = false } = {}) {
  const get = name => boundedText(headers?.get?.(name), 2000).toLowerCase();
  const failures = [];
  if (!get("strict-transport-security").includes("max-age=")) failures.push("Strict-Transport-Security");
  if (get("x-content-type-options") !== "nosniff") failures.push("X-Content-Type-Options: nosniff");
  if (!get("referrer-policy")) failures.push("Referrer-Policy");
  if (!get("permissions-policy")) failures.push("Permissions-Policy");
  if (document) {
    const csp = get("content-security-policy");
    const xFrameOptions = get("x-frame-options");
    if (!csp.includes("frame-ancestors 'none'") && xFrameOptions !== "deny") {
      failures.push("frame-ancestors 'none' or X-Frame-Options: DENY");
    }
  } else if (!get("cache-control").includes("no-store")) {
    failures.push("Cache-Control: no-store");
  }
  return failures;
}

function responseDetail(response) {
  return response ? `HTTP ${response.status} at ${response.url || "target"}` : "request failed";
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { redirect: "follow", ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readText(fetchImpl, url, options, timeoutMs) {
  try {
    const response = await fetchWithTimeout(fetchImpl, url, options, timeoutMs);
    return { response, text: await response.text(), error: null };
  } catch (error) {
    return { response: null, text: "", error: error?.name === "AbortError" ? "request timed out" : boundedText(error?.message || error) };
  }
}

async function readJson(fetchImpl, url, options, timeoutMs) {
  const result = await readText(fetchImpl, url, options, timeoutMs);
  if (result.error) return { ...result, json: null };
  try {
    return { ...result, json: JSON.parse(result.text) };
  } catch {
    return { ...result, json: null, error: "response was not valid JSON" };
  }
}

function exactAssetMatch(expectedHtml, actualHtml) {
  const expected = compiledAssetNames(expectedHtml);
  const actual = new Set(compiledAssetNames(actualHtml));
  const missing = expected.filter(asset => !actual.has(asset));
  return { ok: expected.length > 0 && missing.length === 0, expected, missing };
}

function corsOrigin(response) {
  return boundedText(response?.headers?.get?.("access-control-allow-origin"), 1000);
}

export async function verifyLiveDeployment({
  config,
  artifacts,
  fetchImpl = globalThis.fetch,
  now = new Date().toISOString()
} = {}) {
  const checks = [];
  const add = (id, surface, ok, detail) => checks.push({ id, surface, ok: Boolean(ok), detail: boundedText(detail, 1000) });
  if (!config?.ready) {
    add("configuration", "deployment", false, config?.reason || "Deployment verification is not configured.");
    return { ok: false, checkedAt: now, targets: config || {}, summary: { passed: 0, failed: 1 }, checks };
  }
  const expectedPublicHtml = String(artifacts?.publicHtml || "");
  const expectedAdminHtml = String(artifacts?.adminHtml || "");
  const expectedWorkerVersion = serviceWorkerCacheVersion(artifacts?.publicWorker);
  add("artifacts.public", "artifact", compiledAssetNames(expectedPublicHtml).length > 0 && Boolean(expectedWorkerVersion), "Public artifact has compiled assets and a versioned service worker.");
  add("artifacts.admin", "artifact", compiledAssetNames(expectedAdminHtml).length > 0, "Admin artifact has compiled assets.");

  const publicOrigin = new URL(config.publicUrl).origin;
  const adminOrigin = new URL(config.adminUrl).origin;
  const requests = await Promise.all([
    readText(fetchImpl, config.publicUrl, {}, config.timeoutMs),
    readText(fetchImpl, targetUrl(config.publicUrl, "sw.js"), {}, config.timeoutMs),
    readJson(fetchImpl, targetUrl(config.publicUrl, "data/app-bootstrap.json"), {}, config.timeoutMs),
    readText(fetchImpl, config.adminUrl, {}, config.timeoutMs),
    readJson(fetchImpl, targetUrl(config.apiUrl, "health"), {}, config.timeoutMs),
    readJson(fetchImpl, targetUrl(config.apiUrl, "ready"), {}, config.timeoutMs),
    readJson(fetchImpl, targetUrl(config.apiUrl, "api/public/bootstrap"), {}, config.timeoutMs),
    readJson(fetchImpl, targetUrl(config.apiUrl, "api/public/tickets"), {}, config.timeoutMs),
    readJson(fetchImpl, targetUrl(config.apiUrl, "api/public/sponsors"), {}, config.timeoutMs),
    readJson(fetchImpl, targetUrl(config.apiUrl, "api/public/vendors"), {}, config.timeoutMs),
    readJson(fetchImpl, targetUrl(config.apiUrl, "api/public/island-conditions"), {}, config.timeoutMs),
    readJson(fetchImpl, targetUrl(config.apiUrl, "api/public/bootstrap"), { headers: { origin: publicOrigin } }, config.timeoutMs),
    readJson(fetchImpl, targetUrl(config.apiUrl, "api/public/bootstrap"), { headers: { origin: adminOrigin } }, config.timeoutMs)
  ]);
  const [publicPage, publicWorker, publicStaticBootstrap, adminPage, health, ready, apiBootstrap, tickets, sponsors, vendors, island, publicCors, adminCors] = requests;

  add("public.reachable", "public", publicPage.response?.status === 200 && !publicPage.error, publicPage.error || responseDetail(publicPage.response));
  add("public.entry", "public", publicPage.text.includes("Texas SandFest | Port Aransas") && !publicPage.text.includes("SandFest Ops Console"), "Visitor entry is isolated from the operations console.");
  const publicAssets = exactAssetMatch(expectedPublicHtml, publicPage.text);
  add("public.artifact_freshness", "public", publicAssets.ok, publicAssets.missing.length ? `Missing current assets: ${publicAssets.missing.join(", ")}` : `${publicAssets.expected.length} current assets matched.`);
  const remoteWorkerVersion = serviceWorkerCacheVersion(publicWorker.text);
  add("public.worker_freshness", "public", publicWorker.response?.status === 200 && Boolean(expectedWorkerVersion) && remoteWorkerVersion === expectedWorkerVersion, `Expected ${expectedWorkerVersion || "missing"}; received ${remoteWorkerVersion || "missing"}.`);
  const publicHeaderFailures = securityHeaderFailures(publicPage.response?.headers, { document: true });
  add("public.security_headers", "public", publicHeaderFailures.length === 0, publicHeaderFailures.length ? `Missing or invalid: ${publicHeaderFailures.join(", ")}.` : "Required document security headers are present.");
  add("public.static_event", "public", publicStaticBootstrap.response?.status === 200 && publicStaticBootstrap.json?.guide?.id === config.expectedEventId, `Expected ${config.expectedEventId}; received ${publicStaticBootstrap.json?.guide?.id || "missing"}.`);

  add("admin.reachable", "admin", adminPage.response?.status === 200 && !adminPage.error, adminPage.error || responseDetail(adminPage.response));
  add("admin.entry", "admin", adminPage.text.includes("SandFest Ops Console") && !adminPage.text.includes("Texas SandFest | Port Aransas"), "Operations entry is isolated from the visitor app.");
  const adminAssets = exactAssetMatch(expectedAdminHtml, adminPage.text);
  add("admin.artifact_freshness", "admin", adminAssets.ok, adminAssets.missing.length ? `Missing current assets: ${adminAssets.missing.join(", ")}` : `${adminAssets.expected.length} current assets matched.`);
  const adminHeaderFailures = securityHeaderFailures(adminPage.response?.headers, { document: true });
  add("admin.security_headers", "admin", adminHeaderFailures.length === 0, adminHeaderFailures.length ? `Missing or invalid: ${adminHeaderFailures.join(", ")}.` : "Required document security headers are present.");

  const healthBody = health.json || {};
  add("api.health", "api", health.response?.status === 200 && healthBody.ok === true, health.error || responseDetail(health.response));
  add("api.production_identity", "api", healthBody.environment === "production" && healthBody.authMode === "jwt" && healthBody.storage === "postgres" && ["redis", "upstash"].includes(healthBody.rateLimitBackend) && healthBody.runtimeDataMode !== "isolated", `environment=${healthBody.environment || "missing"}, auth=${healthBody.authMode || "missing"}, storage=${healthBody.storage || "missing"}, rateLimit=${healthBody.rateLimitBackend || "missing"}.`);
  add("api.current_event", "api", healthBody.currentEventId === config.expectedEventId && healthBody.currentEventReady === true, `Expected ready ${config.expectedEventId}; received ${healthBody.currentEventId || "missing"}.`);
  const apiHeaderFailures = securityHeaderFailures(health.response?.headers);
  add("api.security_headers", "api", apiHeaderFailures.length === 0, apiHeaderFailures.length ? `Missing or invalid: ${apiHeaderFailures.join(", ")}.` : "Required API security headers are present.");

  const readyBody = ready.json || {};
  const deployment = readyBody.deployment || {};
  add("api.readiness", "api", ready.response?.status === 200 && readyBody.ok === true && deployment.production === true && deployment.ok === true && deployment.errors === 0, ready.error || `HTTP ${ready.response?.status || "missing"}; production=${deployment.production}; errors=${deployment.errors ?? "missing"}.`);
  const activeCapabilities = new Set(deployment.requiredCapabilities || []);
  const missingCapabilities = config.requiredCapabilities.filter(item => !activeCapabilities.has(item));
  add("api.required_capabilities", "api", missingCapabilities.length === 0, missingCapabilities.length ? `Missing required gates: ${missingCapabilities.join(", ")}.` : `${config.requiredCapabilities.length} production capability gates are active.`);
  add("api.durable_runtime", "api", readyBody.checks?.storage === "postgres" && readyBody.checks?.worker === true && readyBody.checks?.queue === true && readyBody.checks?.deployment === true, `storage=${readyBody.checks?.storage || "missing"}, worker=${readyBody.checks?.worker}, queue=${readyBody.checks?.queue}.`);

  add("api.public_bootstrap", "api", apiBootstrap.response?.status === 200 && apiBootstrap.json?.guide?.id === config.expectedEventId, `Expected API guide ${config.expectedEventId}; received ${apiBootstrap.json?.guide?.id || "missing"}.`);
  add("api.ticket_checkout", "api", tickets.response?.status === 200 && Array.isArray(tickets.json?.products) && tickets.json.products.some(item => item.availableForCheckout === true), `${tickets.json?.products?.length || 0} products; ${tickets.json?.products?.filter?.(item => item.availableForCheckout === true).length || 0} checkout-ready.`);
  const publicSponsorPackages = Array.isArray(sponsors.json?.sponsorPackages) ? sponsors.json.sponsorPackages : [];
  const publicSponsorCatalog = sponsorPackageCatalog({ sponsorPackages: publicSponsorPackages });
  const sponsorProviderFields = publicSponsorPackages.filter(item => Object.hasOwn(item || {}, "quickBooksItemId") || Object.hasOwn(item || {}, "stripePriceId"));
  add("api.sponsor_tiers", "api", sponsors.response?.status === 200 && publicSponsorCatalog.ready, publicSponsorCatalog.ready ? `${publicSponsorCatalog.activePackages.length} trusted sponsor packages.` : publicSponsorCatalog.errors.join(" "));
  add("api.sponsor_tier_privacy", "api", sponsorProviderFields.length === 0, sponsorProviderFields.length ? `${sponsorProviderFields.length} public sponsor packages expose provider mappings.` : "Public sponsor packages omit provider mappings.");
  add("api.vendor_offerings", "api", vendors.response?.status === 200 && Array.isArray(vendors.json?.vendorOfferings) && vendors.json.vendorOfferings.length > 0, `${vendors.json?.vendorOfferings?.length || 0} vendor offerings.`);
  const islandBody = island.json || {};
  const islandCameras = Array.isArray(islandBody.cameras) ? islandBody.cameras : [];
  const islandSummary = islandBody.summary || {};
  const islandContractReady = island.response?.status === 200
    && Boolean(islandBody.weather)
    && Boolean(islandBody.ferry)
    && islandCameras.length === 8;
  const weatherCurrent = islandBody.weather?.status === "live"
    && islandBody.weather?.freshness?.state === "live"
    && Number.isFinite(Number(islandBody.weather?.temperatureF))
    && Boolean(islandBody.weather?.observedAt);
  const ferryCurrent = CURRENT_FERRY_STATES.has(islandBody.ferry?.status)
    && islandBody.ferry?.freshness?.state === "live"
    && Boolean(islandBody.ferry?.observedAt || islandBody.ferry?.checkedAt);
  const liveCameraCount = islandCameras.filter(camera => camera?.operationalStatus === "live"
    && camera?.freshness?.state === "live"
    && Boolean(camera?.observation?.observedAt)).length;
  const cameraFleetLive = islandCameras.length === 8
    && liveCameraCount === 8
    && islandSummary.configuredCameras === 8
    && islandSummary.armedCameras === 8
    && islandSummary.liveCameras === 8
    && islandSummary.healthyPipelines === 8;
  add("api.island_conditions", "api", islandContractReady, `${islandCameras.length} camera sources with weather=${Boolean(islandBody.weather)} and ferry=${Boolean(islandBody.ferry)}.`);
  add("api.weather_current", "api", weatherCurrent, `status=${islandBody.weather?.status || "missing"}, freshness=${islandBody.weather?.freshness?.state || "missing"}.`);
  add("api.ferry_current", "api", ferryCurrent, `status=${islandBody.ferry?.status || "missing"}, freshness=${islandBody.ferry?.freshness?.state || "missing"}.`);
  add("api.camera_fleet_live", "api", cameraFleetLive, `${liveCameraCount}/8 cameras live; configured=${islandSummary.configuredCameras ?? "missing"}, armed=${islandSummary.armedCameras ?? "missing"}, healthy=${islandSummary.healthyPipelines ?? "missing"}.`);
  add("api.public_cors", "api", publicCors.response?.status === 200 && corsOrigin(publicCors.response) === publicOrigin, `Expected ${publicOrigin}; received ${corsOrigin(publicCors.response) || "missing"}.`);
  add("api.admin_cors", "api", adminCors.response?.status === 200 && corsOrigin(adminCors.response) === adminOrigin, `Expected ${adminOrigin}; received ${corsOrigin(adminCors.response) || "missing"}.`);

  const passed = checks.filter(check => check.ok).length;
  const failed = checks.length - passed;
  return {
    ok: failed === 0,
    checkedAt: now,
    targets: { publicUrl: config.publicUrl, apiUrl: config.apiUrl, adminUrl: config.adminUrl },
    summary: { passed, failed },
    checks
  };
}
