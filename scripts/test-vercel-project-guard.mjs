import assert from "node:assert/strict";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyVercelRelease } from "./verify-vercel-release.mjs";

const script = fileURLToPath(new URL("./verify-vercel-project.mjs", import.meta.url));
const baseEnv = { ...process.env };

for (const key of ["VERCEL", "VERCEL_PROJECT_ID", "VERCEL_GIT_REPO_ID"]) delete baseEnv[key];

function run(extraEnv = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...baseEnv, ...extraEnv }
  });
}

const local = run();
assert.equal(local.status, 0);
assert.match(local.stdout, /skipped outside Vercel/);

const expected = run({
  VERCEL: "1",
  VERCEL_PROJECT_ID: "prj_g8hcQNlvj2G1iu07pmL2iVEh8tU8",
  VERCEL_GIT_REPO_ID: "1226718335"
});
assert.equal(expected.status, 0);
assert.match(expected.stdout, /verified the dedicated Texas SandFest project/);

const verifiedCliUpload = run({
  VERCEL: "1",
  VERCEL_PROJECT_ID: "prj_g8hcQNlvj2G1iu07pmL2iVEh8tU8",
  SANDFEST_VERCEL_CLI_REPOSITORY_ID: "1226718335"
});
assert.equal(verifiedCliUpload.status, 0);
assert.match(verifiedCliUpload.stdout, /verified the dedicated Texas SandFest project/);

const wrongProject = run({
  VERCEL: "1",
  VERCEL_PROJECT_ID: "prj_wrong_project",
  VERCEL_GIT_REPO_ID: "1226718335"
});
assert.equal(wrongProject.status, 1);
assert.match(wrongProject.stderr, /unexpected Vercel project/);

const wrongRepository = run({
  VERCEL: "1",
  VERCEL_PROJECT_ID: "prj_g8hcQNlvj2G1iu07pmL2iVEh8tU8",
  VERCEL_GIT_REPO_ID: "999999999"
});
assert.equal(wrongRepository.status, 1);
assert.match(wrongRepository.stderr, /not the Texas SandFest repository/);

const outsideRelease = await verifyVercelRelease({ env: {} });
assert.equal(outsideRelease.ok, true);
assert.equal(outsideRelease.skipped, true);

const previewRelease = await verifyVercelRelease({
  env: { VERCEL: "1", VERCEL_ENV: "preview" }
});
assert.equal(previewRelease.ok, true);
assert.equal(previewRelease.skipped, true);

const missingProductionConfig = await verifyVercelRelease({
  env: { VERCEL: "1", VERCEL_ENV: "production" }
});
assert.equal(missingProductionConfig.ok, false);
assert.match(missingProductionConfig.failures.join(" "), /VITE_SANDFEST_TURNSTILE_SITE_KEY/);
assert.match(missingProductionConfig.failures.join(" "), /SANDFEST_APPLE_APP_ID_PREFIX/);

const testKeyProduction = await verifyVercelRelease({
  env: {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VITE_SANDFEST_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    SANDFEST_APPLE_APP_ID_PREFIX: "ABCDE12345"
  }
});
assert.equal(testKeyProduction.ok, false);
assert.match(testKeyProduction.failures.join(" "), /reject Cloudflare Turnstile test site keys/);

let productionRequests = 0;
const unavailableProduction = await verifyVercelRelease({
  env: {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VITE_SANDFEST_TURNSTILE_SITE_KEY: "production_site_key_0123456789",
    SANDFEST_APPLE_APP_ID_PREFIX: "ABCDE12345"
  },
  fetchImpl: async () => {
    productionRequests += 1;
    throw new Error("production unavailable");
  }
});
assert.equal(unavailableProduction.ok, false);
assert.equal(productionRequests, 13);
assert.match(unavailableProduction.failures.join(" "), /Production API contract failed/);

const wrongBridgeMode = await verifyVercelRelease({
  env: {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VITE_SANDFEST_TURNSTILE_SITE_KEY: "production_site_key_0123456789",
    SANDFEST_APPLE_APP_ID_PREFIX: "ABCDE12345",
    SANDFEST_VERCEL_PUBLIC_BRIDGE_MODE: "unsafe"
  }
});
assert.equal(wrongBridgeMode.ok, false);
assert.match(wrongBridgeMode.failures.join(" "), /must be read_only/);

const bridgeResponses = new Map([
  ["GET /health", [200, { service: "texas-sandfest-public-review-bridge" }, {}]],
  ["GET /ready", [503, { visitorApiReady: true, staffPlatformReady: false }, {}]],
  ["GET /api/public/bootstrap", [200, { guide: { id: "texas-sandfest-2027", volunteer: {} }, guidance: [], schedule: [], zones: [], alert: {} }, { "cache-control": "public, s-maxage=120" }]],
  ["GET /api/public/sculptors", [200, { meta: { publicationStatus: "unpublished" }, sculptors: [] }, {}]],
  ["POST /api/public/concierge", [200, { answer: "Texas SandFest dates are published in the official guide.", topic: "schedule", confidence: "high", escalated: false, sources: [{ id: "guide", label: "Official guide", href: "https://www.heyelab.com/texas-sandfest" }], suggestions: [] }, {}]],
  ["GET /api/public/sponsors", [200, { publication: { available: false }, sponsorPackages: [] }, {}]],
  ["GET /api/public/vendors", [200, { publication: { available: false }, vendorOfferings: [] }, {}]],
  ["GET /api/public/island-conditions", [200, { weather: { freshness: { state: "stale" } }, ferry: { freshness: { state: "stale" } }, cameras: Array.from({ length: 8 }, (_, index) => ({ id: `camera-${index + 1}` })), summary: { liveCameras: 0 } }, {}]],
  ["OPTIONS /api/public/concierge", [204, null, { "access-control-allow-origin": "https://www.heyelab.com" }]],
  ["POST /api/public/vendor-applications", [503, { error: "unavailable" }, { "retry-after": "3600" }]]
]);
const bridgeRelease = await verifyVercelRelease({
  env: {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VITE_SANDFEST_TURNSTILE_SITE_KEY: "production_site_key_0123456789",
    SANDFEST_APPLE_APP_ID_PREFIX: "ABCDE12345",
    SANDFEST_VERCEL_PUBLIC_BRIDGE_MODE: "read_only",
    SANDFEST_LIVE_API_URL: "https://sandfest-api.heyelab.com/"
  },
  fetchImpl: async (url, init = {}) => {
    const key = `${init.method || "GET"} ${url.pathname}`;
    const [status, payload, headers] = bridgeResponses.get(key) || [404, { error: "missing" }, {}];
    return new Response(payload === null ? null : JSON.stringify(payload), {
      status,
      headers: { ...headers, ...(payload === null ? {} : { "content-type": "application/json" }) }
    });
  }
});
assert.equal(bridgeRelease.ok, true);
assert.equal(bridgeRelease.api.summary.passed, 12);

console.log("Vercel project and release guard: 12 passed, 0 failed.");
