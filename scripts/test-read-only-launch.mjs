// Read-only public launch mode: policy, release gate (pass + fail-closed), and build contract.
// The full-mode gate is covered, unchanged, by scripts/test-vercel-project-guard.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import worker from "../cloudflare/public-api/index.js";
import {
  READ_ONLY_LAUNCH_ENV,
  readOnlyLaunchBlockReason,
  readOnlyLaunchSetting
} from "../lib/read-only-launch-policy.mjs";
import {
  READ_ONLY_SKIPPED_CHECKS,
  verifyReadOnlyLaunch
} from "../lib/read-only-launch-verifier.mjs";
import { publicPartnerIntakeReadiness } from "../lib/public-partner-intake.mjs";
import { validateReadOnlyLaunchBuildEnvironment } from "../vite.config.js";
import { verifyVercelRelease } from "./verify-vercel-release.mjs";

const root = path.resolve(import.meta.dirname, "..");
const vercelConfig = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
const DAY = 86_400_000;
const bootstrapData = JSON.parse(await readFile(path.join(root, "data/processed/app-bootstrap.json"), "utf8"));
const CHECKED_AT = Date.parse(bootstrapData.guide.sourceCheckedAt);
const NOW = CHECKED_AT + 14 * DAY; // inside the 90-day source freshness window, whatever the data refresh date
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };
const throws = (fn, pattern, message) => { assert.throws(fn, pattern, message); checks += 1; };

// ---- Policy ---------------------------------------------------------------------------------
ok(READ_ONLY_LAUNCH_ENV === "SANDFEST_VERCEL_PUBLIC_BRIDGE_MODE", "env var name is stable");
ok(!readOnlyLaunchSetting({}).enabled && !readOnlyLaunchSetting({}).error, "mode is off by default");
ok(!readOnlyLaunchSetting({ [READ_ONLY_LAUNCH_ENV]: "" }).enabled, "empty value is off");
ok(readOnlyLaunchSetting({ [READ_ONLY_LAUNCH_ENV]: "read_only" }).enabled, "read_only enables the mode");
ok(readOnlyLaunchSetting({ [READ_ONLY_LAUNCH_ENV]: " READ_ONLY " }).enabled, "value is trimmed and case-insensitive");
for (const bad of ["true", "1", "readonly", "full", "write"]) {
  const setting = readOnlyLaunchSetting({ [READ_ONLY_LAUNCH_ENV]: bad });
  ok(!setting.enabled && /must be unset or "read_only"/.test(setting.error), `unknown mode "${bad}" fails closed`);
}
const api = "https://sandfest-api.heyelab.com";
const on = { enabled: true };
ok(readOnlyLaunchBlockReason(`${api}/api/stripe/create-checkout-session`, { method: "POST" }, { enabled: false }) === null, "guard is inert when the mode is off");
ok(readOnlyLaunchBlockReason(`${api}/api/public/bootstrap`, {}, on) === null, "GET of public data is allowed");
ok(readOnlyLaunchBlockReason(`${api}/api/public/tickets`, { method: "HEAD" }, on) === null, "HEAD is allowed");
ok(readOnlyLaunchBlockReason(`${api}/api/public/concierge`, { method: "POST" }, on) === null, "Ask Sandy POST is allowed");
ok(readOnlyLaunchBlockReason(`${api}/api/public/concierge/`, { method: "post" }, on) === null, "Ask Sandy POST tolerates case and trailing slash");
for (const [target, method] of [
  ["/api/stripe/create-checkout-session", "POST"], ["/api/public/vendor-applications", "POST"], ["/api/public/partner-applications", "POST"],
  ["/api/public/guest-services", "POST"], ["/api/public/passport/stamp", "POST"], ["/api/public/voting", "POST"],
  ["/api/public/partner-brand-assets/upload", "POST"], ["/api/public/concierge", "PUT"], ["/api/public/concierge", "DELETE"],
  ["/api/admin/app-bootstrap", "GET"], ["/api/admin/operations", "POST"], ["/api/stripe/webhook", "GET"], ["/api/quickbooks/sync", "POST"],
  ["/api/sms/send", "POST"], ["/api/board/state", "GET"], ["/api/staff/directory", "GET"]
]) {
  ok(readOnlyLaunchBlockReason(`${api}${target}`, { method }, on), `${method} ${target} is refused`);
}
ok(readOnlyLaunchBlockReason(`${api}/api/public/../admin/app-bootstrap`, {}, on), "dot-segment traversal into admin is refused");
ok(typeof readOnlyLaunchBlockReason("not a url at all \u0000", {}, on) !== "undefined", "garbage input does not throw");
ok(readOnlyLaunchBlockReason(new Request(`${api}/api/public/vendor-applications`, { method: "POST", body: "{}" }), {}, on), "Request objects are inspected");
{
  const closed = publicPartnerIntakeReadiness({ production: true, turnstileSiteKey: "production_site_key_0123456789", readOnlyLaunch: true });
  ok(!closed.ready && /not open yet/.test(closed.message), "read-only launch disables partner intake even with a Turnstile key");
  ok(publicPartnerIntakeReadiness({ production: true, turnstileSiteKey: "production_site_key_0123456789" }).ready, "full mode intake readiness is unchanged");
  ok(publicPartnerIntakeReadiness({ production: true }).message === "Protected partner requests are unavailable in this preview.", "preview message is unchanged");
}

// ---- Build contract -------------------------------------------------------------------------
ok(validateReadOnlyLaunchBuildEnvironment({}, "public") === false, "build flag is off by default");
ok(validateReadOnlyLaunchBuildEnvironment({ [READ_ONLY_LAUNCH_ENV]: "read_only" }, "public") === true, "build flag turns on");
throws(() => validateReadOnlyLaunchBuildEnvironment({ [READ_ONLY_LAUNCH_ENV]: "read_only" }, "admin"), /only applies to the isolated public build/);
throws(() => validateReadOnlyLaunchBuildEnvironment({ [READ_ONLY_LAUNCH_ENV]: "read_only" }, "all"), /only applies to the isolated public build/);
throws(() => validateReadOnlyLaunchBuildEnvironment({ [READ_ONLY_LAUNCH_ENV]: "maybe" }, "public"), /must be unset or "read_only"/);
throws(() => validateReadOnlyLaunchBuildEnvironment({ [READ_ONLY_LAUNCH_ENV]: "read_only", VITE_SANDFEST_OPS_DEMO: "true" }, "public"), /OPS_DEMO/);
throws(() => validateReadOnlyLaunchBuildEnvironment({ [READ_ONLY_LAUNCH_ENV]: "read_only", VITE_SANDFEST_API_BASE_URL: "https://other.example" }, "public"), /public API base/);
ok(validateReadOnlyLaunchBuildEnvironment({ [READ_ONLY_LAUNCH_ENV]: "read_only", VITE_SANDFEST_API_BASE_URL: "https://sandfest-api.heyelab.com/" }, "public") === true, "the bridge API base is accepted");

// ---- Release gate: a bridge served by the in-repo Worker -------------------------------------
function bridgeFetch(mutate = () => undefined) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const request = new Request(url, { method: init.method, headers: init.headers, body: init.body });
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    const response = await worker.fetch(request);
    const text = response.status === 204 ? "" : await response.text();
    const headers = new Headers(response.headers);
    let body = text;
    let status = response.status;
    const patched = await mutate({ request, pathname: new URL(request.url).pathname, status, headers, body });
    if (patched) { status = patched.status ?? status; body = patched.body ?? body; }
    return new Response(status === 204 ? null : body, { status, headers });
  };
  return { fetchImpl, requests };
}
const gate = async (mutate, options = {}) => verifyReadOnlyLaunch({ vercelConfig, now: NOW, fetchImpl: bridgeFetch(mutate).fetchImpl, ...options });
const failed = result => result.checks.filter(check => !check.ok).map(check => check.id);
const jsonBody = (pathname, wanted, change) => ({ pathname: actual, body }) => (actual === wanted ? { body: JSON.stringify(change(JSON.parse(body))) } : undefined);

const pass = await gate();
assert.deepEqual(failed(pass), [], JSON.stringify(pass.checks.filter(check => !check.ok)));
ok(pass.ok && pass.summary.failed === 0 && pass.summary.total >= 17, "the in-repo bridge passes every read-only check");

// wrong mode / readiness
for (const [label, mutate, expected] of [
  ["mode=full", ({ pathname }) => pathname === "/health" ? { body: JSON.stringify({ status: "ok", service: "texas-sandfest-public-review-bridge", mode: "full" }) } : undefined, "bridge.health_mode"],
  ["missing mode", ({ pathname }) => pathname === "/health" ? { body: JSON.stringify({ status: "ok", service: "texas-sandfest-public-review-bridge" }) } : undefined, "bridge.health_mode"],
  ["wrong service", ({ pathname }) => pathname === "/health" ? { body: JSON.stringify({ status: "ok", service: "texas-sandfest-api", mode: "read_only" }) } : undefined, "bridge.health_mode"],
  ["health 500", ({ pathname }) => pathname === "/health" ? { status: 500 } : undefined, "bridge.health_mode"],
  ["visitorApiReady=false", ({ pathname }) => pathname === "/ready" ? { body: JSON.stringify({ status: "not_ready", visitorApiReady: false, staffPlatformReady: false }) } : undefined, "bridge.visitor_api_ready"],
  ["staff platform claimed", ({ pathname }) => pathname === "/ready" ? { status: 200, body: JSON.stringify({ status: "ready", visitorApiReady: true, staffPlatformReady: true }) } : undefined, "bridge.staff_platform_honest"]
]) {
  const result = await gate(mutate);
  ok(!result.ok && failed(result).includes(expected), `${label} fails closed on ${expected}`);
}
{
  const { fetchImpl, requests } = bridgeFetch(({ pathname }) => pathname === "/health" ? { body: JSON.stringify({ status: "ok", service: "x", mode: "full" }) } : undefined);
  const result = await verifyReadOnlyLaunch({ vercelConfig, now: NOW, fetchImpl });
  ok(!result.ok && !requests.some(entry => entry.startsWith("POST /api/public/vendor") || entry.includes("/api/stripe") || entry.includes("/api/admin")), "no synthetic writes are sent to a target that is not the read-only bridge");
}

// CORS
for (const [label, mutate] of [
  ["no CORS grant for sandfest.heyelab.com", ({ request, headers }) => { if (request.headers.get("origin") === "https://sandfest.heyelab.com") headers.delete("access-control-allow-origin"); }],
  ["wildcard CORS", ({ headers }) => { headers.set("access-control-allow-origin", "*"); }],
  ["wrong-origin CORS", ({ request, headers }) => { if (request.headers.get("origin") === "https://sandfest.heyelab.com") headers.set("access-control-allow-origin", "https://www.heyelab.com"); }],
  ["reflected CORS (any origin allowed)", ({ request, headers, status }) => { const origin = request.headers.get("origin"); if (origin) { headers.set("access-control-allow-origin", origin); return { status: status === 403 ? 200 : status }; } }],
  ["unsafe methods granted", ({ request, headers }) => { if (request.method === "OPTIONS") headers.set("access-control-allow-methods", "GET, POST, PUT, DELETE"); }],
  ["missing Vary: Origin", ({ request, headers }) => { if (request.method === "OPTIONS") headers.delete("vary"); }]
]) {
  const result = await gate(mutate);
  ok(!result.ok && failed(result).some(id => id.startsWith("bridge.cors")), `${label} fails closed`);
}

// security headers
for (const header of ["strict-transport-security", "permissions-policy", "x-content-type-options", "referrer-policy"]) {
  const result = await gate(({ pathname, headers }) => { if (pathname === "/health") headers.delete(header); });
  ok(!result.ok && failed(result).includes("bridge.security_headers"), `missing bridge ${header} fails closed`);
}
{
  const withoutHsts = structuredClone(vercelConfig);
  const catchAll = config => config.headers.find(entry => entry.source === "/(.*)");
  catchAll(withoutHsts).headers = catchAll(withoutHsts).headers.filter(item => item.key !== "Strict-Transport-Security");
  ok(failed(await gate(undefined, { vercelConfig: withoutHsts })).includes("public.vercel_headers"), "missing site HSTS fails closed");
  const wideCsp = structuredClone(vercelConfig);
  const csp = catchAll(wideCsp).headers.find(item => item.key === "Content-Security-Policy");
  csp.value = csp.value.replace("connect-src 'self'", "connect-src * 'self'");
  ok(failed(await gate(undefined, { vercelConfig: wideCsp })).includes("public.vercel_headers"), "a wildcard connect-src fails closed");
  const noFrame = structuredClone(vercelConfig);
  catchAll(noFrame).headers = catchAll(noFrame).headers.filter(item => item.key !== "X-Frame-Options");
  ok(failed(await gate(undefined, { vercelConfig: noFrame })).includes("public.vercel_headers"), "missing frame protection fails closed");
  ok(failed(await gate(undefined, { vercelConfig: {} })).includes("public.vercel_headers"), "an empty vercel.json fails closed");
}

// checkout, intake, staff routes, honesty
for (const [label, mutate, expected] of [
  ["ticket checkout enabled", jsonBody("/api/public/tickets", "/api/public/tickets", body => ({ ...body, checkoutEnvironment: "live", products: [{ id: "gate" }] })), "bridge.ticket_checkout_off"],
  ["partner intake enabled", jsonBody("", "/api/public/partner-intake", body => ({ ...body, intakeAvailable: true })), "bridge.intake_off"],
  ["guest services enabled", jsonBody("", "/api/public/guest-services", body => ({ ...body, available: true })), "bridge.intake_off"],
  ["sponsor packages published", jsonBody("", "/api/public/sponsors", body => ({ ...body, publication: { available: true }, sponsorPackages: [{ id: "x" }] })), "bridge.catalogs_unpublished"],
  ["weather claims live data", jsonBody("", "/api/public/island-conditions", body => ({ ...body, weather: { ...body.weather, freshness: { state: "live" } } })), "bridge.feeds_honest"],
  ["stale reading shown", jsonBody("", "/api/public/island-conditions", body => ({ ...body, weather: { ...body.weather, temperatureF: 71 } })), "bridge.feeds_honest"],
  ["cameras claim live", jsonBody("", "/api/public/island-conditions", body => ({ ...body, summary: { ...body.summary, liveCameras: 2 } })), "bridge.feeds_honest"],
  ["unsafe bootstrap", jsonBody("", "/api/public/bootstrap", body => ({ ...body, invoiceStatus: "paid" })), "bridge.bootstrap_safe"],
  ["wrong event", jsonBody("", "/api/public/bootstrap", body => ({ ...body, guide: { ...body.guide, id: "texas-sandfest-2026" } })), "bridge.bootstrap_safe"],
  ["admin route reachable", ({ pathname }) => pathname === "/api/admin/app-bootstrap" ? { status: 200, body: JSON.stringify({ ok: true }) } : undefined, "bridge.no_writes_or_staff_routes"],
  ["checkout route reachable", ({ pathname }) => pathname === "/api/stripe/create-checkout-session" ? { status: 200, body: JSON.stringify({ sessionId: "cs_test" }) } : undefined, "bridge.no_writes_or_staff_routes"],
  ["public write accepted", ({ pathname, request }) => pathname === "/api/public/vendor-applications" && request.method === "POST" ? { status: 202, body: JSON.stringify({ ok: true }) } : undefined, "bridge.no_writes_or_staff_routes"],
  ["public write without Retry-After", ({ pathname, request, headers }) => { if (pathname === "/api/public/vendor-applications" && request.method === "POST") headers.delete("retry-after"); }, "bridge.writes_fail_closed"]
]) {
  const result = await gate(mutate);
  ok(!result.ok && failed(result).includes(expected), `${label} fails closed on ${expected}`);
}
{
  const stale = await verifyReadOnlyLaunch({ vercelConfig, now: CHECKED_AT + 91 * DAY, fetchImpl: bridgeFetch().fetchImpl });
  ok(!stale.ok && failed(stale).join() === "bridge.event_facts_fresh", "event facts older than 90 days fail closed (and only that check fails)");
  const future = await verifyReadOnlyLaunch({ vercelConfig, now: CHECKED_AT - 5 * DAY, fetchImpl: bridgeFetch().fetchImpl });
  ok(failed(future).includes("bridge.event_facts_fresh"), "a source check dated in the future fails closed");
}
ok(!(await verifyReadOnlyLaunch({ apiUrl: "http://sandfest-api.heyelab.com/", vercelConfig, fetchImpl: bridgeFetch().fetchImpl })).ok, "a non-HTTPS bridge URL fails closed");
ok(!(await verifyReadOnlyLaunch({ vercelConfig, now: NOW, fetchImpl: async () => { throw new Error("network down"); } })).ok, "an unreachable bridge fails closed");

// ---- verifyVercelRelease wiring ---------------------------------------------------------------
const productionEnv = { VERCEL: "1", VERCEL_ENV: "production", [READ_ONLY_LAUNCH_ENV]: "read_only" };
const freshClockFetch = bridgeFetch().fetchImpl;
const realNow = Date.now;
Date.now = () => NOW;
try {
  const release = await verifyVercelRelease({ env: productionEnv, fetchImpl: freshClockFetch, vercelConfig });
  ok(release.ok && release.mode === "read_only" && release.skippedChecks === READ_ONLY_SKIPPED_CHECKS && release.skippedChecks.length >= 8, "read-only release passes and lists the skipped full-mode checks (no Turnstile key required)");
} finally {
  Date.now = realNow;
}
Date.now = () => CHECKED_AT + 91 * DAY;
let releaseStale;
try {
  releaseStale = await verifyVercelRelease({ env: productionEnv, fetchImpl: bridgeFetch().fetchImpl, vercelConfig });
} finally {
  Date.now = realNow;
}
ok(!releaseStale.ok && releaseStale.mode === "read_only" && /Read-only launch contract failed/.test(releaseStale.failures[0]), "read-only release fails closed when a check fails");
const badMode = await verifyVercelRelease({ env: { ...productionEnv, [READ_ONLY_LAUNCH_ENV]: "yes" }, fetchImpl: async () => { throw new Error("must not fetch"); } });
ok(!badMode.ok && /must be unset or "read_only"/.test(badMode.failures[0]), "an unrecognised mode value fails closed without calling the network");
const preview = await verifyVercelRelease({ env: { VERCEL: "1", VERCEL_ENV: "preview", [READ_ONLY_LAUNCH_ENV]: "read_only" } });
ok(preview.ok && preview.skipped, "previews are still skipped");
let fullRequests = 0;
const fullStillStrict = await verifyVercelRelease({
  env: { VERCEL: "1", VERCEL_ENV: "production", VITE_SANDFEST_TURNSTILE_SITE_KEY: "production_site_key_0123456789", SANDFEST_APPLE_APP_ID_PREFIX: "ABCDE12345" },
  fetchImpl: async () => { fullRequests += 1; throw new Error("down"); }
});
ok(!fullStillStrict.ok && !fullStillStrict.mode && fullRequests === 13, "without the variable the full production gate is unchanged and still strict");
const fullNoKey = await verifyVercelRelease({ env: { VERCEL: "1", VERCEL_ENV: "production" } });
ok(!fullNoKey.ok && /TURNSTILE/.test(fullNoKey.failures.join(" ")), "full mode still requires the Turnstile key");

console.log(`Read-only launch mode: ${checks} checks passed.`);
