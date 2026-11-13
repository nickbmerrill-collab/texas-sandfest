import { publicAppBootstrapSafety } from "./public-bootstrap.mjs";
import { securityHeaderFailures } from "./deployment-verifier.mjs";
import {
  READ_ONLY_ALLOWED_POSTS,
  READ_ONLY_LAUNCH_ENV,
  READ_ONLY_LAUNCH_VALUE
} from "./read-only-launch-policy.mjs";

export const READ_ONLY_BRIDGE_SERVICE = "texas-sandfest-public-review-bridge";
export const READ_ONLY_MAX_SOURCE_AGE_DAYS = 90;

// Full-mode checks that a read-only launch deliberately does NOT run. They are logged on
// every run so nobody mistakes a read-only pass for a full production release.
export const READ_ONLY_SKIPPED_CHECKS = Object.freeze([
  "VITE_SANDFEST_TURNSTILE_SITE_KEY must be a real production key (intake is disabled instead)",
  "api.production_identity: production environment, JWT auth, Postgres storage, shared rate limiter",
  "api.current_event / api.readiness: ready production event and /ready 200",
  "api.required_capabilities: Stripe ticketing and partner payments, transactional email, QuickBooks, camera ingest, staff directory, outreach discovery, SMS safety",
  "api.durable_runtime: durable storage, worker, and queue",
  "api.visitor_guidance / api.ticket_checkout / api.sponsor_tiers / api.vendor_offerings: published, checkout-ready catalogs",
  "api.partner_intake / api.partner_recovery / api.guest_services_intake: live intake services",
  "api.public_concierge: backend-served concierge (the bridge serves a governed static answerer)",
  "api.weather_current / api.ferry_current / api.camera_fleet_live: live feeds and 8/8 cameras",
  "api.admin_cors: staff admin origin (no staff site exists in this mode)"
]);

const PUBLIC_ORIGIN = "https://sandfest.heyelab.com";
const UNTRUSTED_ORIGINS = Object.freeze([
  "https://texassandfest.org.evil.example",
  "https://sandfest.heyelab.com.evil.example",
  "http://sandfest.heyelab.com",
  "https://sandfest-admin.heyelab.com"
]);

function add(checks, id, ok, detail) {
  checks.push({ id, ok: Boolean(ok), detail: String(detail).slice(0, 1000) });
}

async function call(fetchImpl, base, path, init = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(new URL(path, base), { redirect: "manual", ...init, signal: controller.signal });
    const text = response.status === 204 ? "" : await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { response, json, text, error: null };
  } catch (error) {
    return { response: null, json: null, text: "", error: error?.name === "AbortError" ? "request timed out" : String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

const status = result => (result.response ? `HTTP ${result.response.status}` : result.error || "request failed");
const header = (result, name) => String(result.response?.headers?.get?.(name) || "");

function vercelHeaderFailures(vercelConfig, connectOrigin) {
  const failures = [];
  const rule = (vercelConfig?.headers || []).find(entry => entry.source === "/(.*)");
  const value = name => String((rule?.headers || []).find(item => item.key.toLowerCase() === name.toLowerCase())?.value || "");
  if (!rule) return ["vercel.json has no catch-all header rule"];
  if (!/max-age=\d{7,}/.test(value("Strict-Transport-Security"))) failures.push("Strict-Transport-Security");
  if (value("X-Content-Type-Options").toLowerCase() !== "nosniff") failures.push("X-Content-Type-Options: nosniff");
  if (!value("Referrer-Policy")) failures.push("Referrer-Policy");
  if (!value("Permissions-Policy")) failures.push("Permissions-Policy");
  if (value("X-Frame-Options").toUpperCase() !== "DENY") failures.push("X-Frame-Options: DENY");
  const csp = value("Content-Security-Policy");
  if (!csp.includes("frame-ancestors 'none'")) failures.push("CSP frame-ancestors 'none'");
  if (!csp.includes("default-src 'self'")) failures.push("CSP default-src 'self'");
  const connect = csp.match(/connect-src ([^;]+)/)?.[1] || "";
  if (connect.includes("*") || connect.includes("http:")) failures.push("CSP connect-src is too broad");
  if (connectOrigin && !connect.split(/\s+/).includes(connectOrigin)) failures.push(`CSP connect-src lacks ${connectOrigin}`);
  return failures;
}

function sourceAgeDays(iso, now) {
  const checked = Date.parse(iso || "");
  if (!Number.isFinite(checked)) return null;
  return Math.floor((now - checked) / 86_400_000);
}

export async function verifyReadOnlyLaunch({
  apiUrl = "https://sandfest-api.heyelab.com/",
  expectedEventId = "texas-sandfest-2027",
  vercelConfig,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  timeoutMs = 12_000
} = {}) {
  const checks = [];
  let base;
  try {
    base = new URL(apiUrl);
    if (base.protocol !== "https:" || base.username || base.password) throw new Error("not a plain HTTPS URL");
  } catch (error) {
    add(checks, "bridge.url", false, `Read-only launch requires a plain HTTPS bridge URL: ${error.message}.`);
    return summarize(checks);
  }
  const get = (path, init) => call(fetchImpl, base, path, init, timeoutMs);

  const [health, ready, bootstrap, tickets, sponsors, vendors, partnerIntake, guestServices, island] = await Promise.all([
    get("/health"), get("/ready"), get("/api/public/bootstrap"), get("/api/public/tickets"),
    get("/api/public/sponsors"), get("/api/public/vendors"), get("/api/public/partner-intake"),
    get("/api/public/guest-services"), get("/api/public/island-conditions")
  ]);

  // 1. Mode and readiness the bridge claims.
  add(checks, "bridge.health_mode", health.response?.status === 200 && health.json?.status === "ok" && health.json?.service === READ_ONLY_BRIDGE_SERVICE && health.json?.mode === READ_ONLY_LAUNCH_VALUE,
    `${status(health)}; service=${health.json?.service || "missing"}; mode=${health.json?.mode || "missing"}.`);
  add(checks, "bridge.visitor_api_ready", ready.json?.visitorApiReady === true,
    `${status(ready)}; visitorApiReady=${ready.json?.visitorApiReady ?? "missing"}.`);
  add(checks, "bridge.staff_platform_honest", ready.response?.status === 503 && ready.json?.staffPlatformReady === false,
    `${status(ready)}; staffPlatformReady=${ready.json?.staffPlatformReady ?? "missing"}. The bridge must not claim a staff platform; once the full backend is live, exit read-only mode.`);

  // 2. Security headers on the bridge and on the public site (vercel.json).
  const bridgeHeaders = securityHeaderFailures(health.response?.headers);
  add(checks, "bridge.security_headers", health.response && bridgeHeaders.length === 0,
    bridgeHeaders.length ? `Missing or invalid: ${bridgeHeaders.join(", ")}.` : "Required bridge security headers are present.");
  const siteHeaders = vercelHeaderFailures(vercelConfig, base.origin);
  add(checks, "public.vercel_headers", siteHeaders.length === 0,
    siteHeaders.length ? `Missing or invalid: ${siteHeaders.join(", ")}.` : "vercel.json serves the required document security headers and a tight CSP.");

  // 3. CORS: exact grant for the public site, nothing for anyone else.
  const preflight = await get("/api/public/concierge", {
    method: "OPTIONS",
    headers: { origin: PUBLIC_ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type" }
  });
  const allowedMethods = header(preflight, "access-control-allow-methods").toUpperCase();
  add(checks, "bridge.cors_public_origin",
    preflight.response?.status === 204
      && header(preflight, "access-control-allow-origin") === PUBLIC_ORIGIN
      && /\bPOST\b/.test(allowedMethods)
      && !/\bDELETE\b|\bPUT\b|\bPATCH\b/.test(allowedMethods)
      && /origin/i.test(header(preflight, "vary")),
    `${status(preflight)}; allow-origin=${header(preflight, "access-control-allow-origin") || "missing"}; methods=${allowedMethods || "missing"}; vary=${header(preflight, "vary") || "missing"}.`);
  const getWithOrigin = await get("/api/public/bootstrap", { headers: { origin: PUBLIC_ORIGIN } });
  add(checks, "bridge.cors_public_get", getWithOrigin.response?.status === 200 && header(getWithOrigin, "access-control-allow-origin") === PUBLIC_ORIGIN,
    `${status(getWithOrigin)}; allow-origin=${header(getWithOrigin, "access-control-allow-origin") || "missing"}.`);
  const untrusted = await Promise.all(UNTRUSTED_ORIGINS.flatMap(origin => [
    get("/api/public/bootstrap", { headers: { origin } }).then(result => ({ origin, kind: "GET", result })),
    get("/api/public/concierge", { method: "OPTIONS", headers: { origin } }).then(result => ({ origin, kind: "OPTIONS", result }))
  ]));
  const leaked = untrusted.filter(item => !item.result.response || header(item.result, "access-control-allow-origin") || item.result.response.status < 400);
  add(checks, "bridge.cors_rejects_untrusted", leaked.length === 0,
    leaked.length ? `Untrusted origins were not rejected: ${leaked.map(item => `${item.kind} ${item.origin} -> ${status(item.result)} allow-origin=${header(item.result, "access-control-allow-origin") || "none"}`).join("; ")}.` : `${untrusted.length} untrusted origin probes were rejected without a CORS grant.`);

  // 4. No staff, admin, checkout, or intake surface is reachable.
  const writeProbes = [
    ["/api/public/vendor-applications", "POST", { organizationName: "Release gate probe" }],
    ["/api/public/partner-applications", "POST", { organizationName: "Release gate probe" }],
    ["/api/public/guest-services", "POST", { category: "general" }],
    ["/api/public/passport/stamp", "POST", {}],
    ["/api/stripe/create-checkout-session", "POST", { productId: "probe" }],
    ["/api/admin/app-bootstrap", "GET", null],
    ["/api/admin/operations", "GET", null]
  ];
  const bridgeConfirmed = checks.find(check => check.id === "bridge.health_mode")?.ok === true;
  if (!bridgeConfirmed) {
    // Never send synthetic writes to a target that has not proven it is the read-only bridge.
    add(checks, "bridge.no_writes_or_staff_routes", false, "Write and admin probes were not sent because the target did not identify as the read-only bridge.");
    add(checks, "bridge.writes_fail_closed", false, "Skipped: the target did not identify as the read-only bridge.");
  } else {
    const probes = await Promise.all(writeProbes.map(async ([path, method, body]) => ({
      path, method,
      result: await get(path, method === "GET" ? {} : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    })));
    const open = probes.filter(({ result }) => !result.response || result.response.status < 400 || /sessionId|checkoutUrl|clientSecret|"ok":\s*true/i.test(result.text));
    add(checks, "bridge.no_writes_or_staff_routes", open.length === 0,
      open.length ? `Reachable: ${open.map(item => `${item.method} ${item.path} -> ${status(item.result)}`).join("; ")}.` : `${probes.length} write, checkout, and admin probes were refused.`);
    const publicWrite = probes.find(item => item.path === "/api/public/vendor-applications");
    add(checks, "bridge.writes_fail_closed", publicWrite?.result.response?.status === 503 && header(publicWrite.result, "retry-after") !== "",
      `${status(publicWrite?.result || {})}; retry-after=${header(publicWrite?.result || {}, "retry-after") || "missing"}.`);
  }

  // 5. Checkout and intake stay off; catalogs are honestly unpublished.
  add(checks, "bridge.ticket_checkout_off",
    tickets.response?.status === 200 && tickets.json?.checkoutEnvironment === "unavailable" && Array.isArray(tickets.json?.products) && tickets.json.products.length === 0 && !tickets.json?.checkoutPolicy,
    `${status(tickets)}; environment=${tickets.json?.checkoutEnvironment || "missing"}; products=${tickets.json?.products?.length ?? "missing"}.`);
  add(checks, "bridge.intake_off",
    partnerIntake.json?.intakeAvailable === false && partnerIntake.json?.recoveryAvailable === false && guestServices.json?.available === false,
    `partner intake=${partnerIntake.json?.intakeAvailable ?? "missing"}; recovery=${partnerIntake.json?.recoveryAvailable ?? "missing"}; guest services=${guestServices.json?.available ?? "missing"}.`);
  add(checks, "bridge.catalogs_unpublished",
    sponsors.json?.publication?.available === false && sponsors.json?.sponsorPackages?.length === 0 && vendors.json?.publication?.available === false && vendors.json?.vendorOfferings?.length === 0,
    `sponsors available=${sponsors.json?.publication?.available ?? "missing"}; vendors available=${vendors.json?.publication?.available ?? "missing"}.`);

  // 6. Honest visitor-facing claims.
  const states = [island.json?.weather?.freshness?.state, island.json?.ferry?.freshness?.state];
  add(checks, "bridge.feeds_honest",
    island.response?.status === 200 && states.every(state => state && state !== "live") && island.json?.summary?.liveCameras === 0 && (island.json?.observations || []).length === 0 && island.json?.weather?.temperatureF === null,
    `${status(island)}; weather=${states[0] || "missing"}; ferry=${states[1] || "missing"}; liveCameras=${island.json?.summary?.liveCameras ?? "missing"}. Unavailable feeds must say so and show no stale readings.`);
  const guide = bootstrap.json?.guide;
  const safety = bootstrap.json ? publicAppBootstrapSafety(bootstrap.json) : { ready: false, errors: ["missing"] };
  add(checks, "bridge.bootstrap_safe", bootstrap.response?.status === 200 && safety.ready && guide?.id === expectedEventId,
    `${status(bootstrap)}; event=${guide?.id || "missing"}; safety=${safety.ready ? "ok" : safety.errors?.join(" ")}.`);
  const age = sourceAgeDays(guide?.sourceCheckedAt, now);
  add(checks, "bridge.event_facts_fresh", age !== null && age >= 0 && age <= READ_ONLY_MAX_SOURCE_AGE_DAYS,
    `Event facts were last checked against ${guide?.sourceUrl || "the official source"} on ${guide?.sourceCheckedAt || "an unknown date"} (${age ?? "unknown"} days ago; limit ${READ_ONLY_MAX_SOURCE_AGE_DAYS}). Re-verify dates, hours, address and contacts, then redeploy the bridge.`);

  // 7. The visitor Ask Sandy answer path is the only allowed write.
  const concierge = await get("/api/public/concierge", {
    method: "POST",
    headers: { "content-type": "application/json", origin: PUBLIC_ORIGIN },
    body: JSON.stringify({ question: "When is Texas SandFest?" })
  });
  add(checks, "bridge.concierge_read_only",
    concierge.response?.status === 200 && Boolean(concierge.json?.answer) && header(concierge, "access-control-allow-origin") === PUBLIC_ORIGIN && READ_ONLY_ALLOWED_POSTS.includes("/api/public/concierge"),
    `${status(concierge)}; topic=${concierge.json?.topic || "missing"}.`);

  return summarize(checks);
}

function summarize(checks) {
  const failed = checks.filter(check => !check.ok).length;
  return { ok: failed === 0 && checks.length > 0, summary: { passed: checks.length - failed, failed, total: checks.length }, checks };
}

export { READ_ONLY_LAUNCH_ENV };
