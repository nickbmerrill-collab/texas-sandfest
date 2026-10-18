import assert from "node:assert/strict";
import worker from "../cloudflare/public-api/index.js";
import { publicAppBootstrapSafety } from "../lib/public-bootstrap.mjs";
import { publicConciergeResponseSafety } from "../lib/public-concierge.mjs";
import { publicPartnerServerReadinessSafety } from "../lib/public-partner-server-readiness.mjs";

const base = "https://sandfest-api.heyelab.com";

async function request(path, init = {}) {
  const response = await worker.fetch(new Request(new URL(path, base), init));
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload };
}

let checks = 0;
function check(message, condition) {
  assert.ok(condition, message);
  checks += 1;
}

const health = await request("/health");
check("health identifies the read-only review bridge", health.response.status === 200 && health.payload.mode === "read_only");

const readiness = await request("/ready");
check("readiness stays red until the staff platform exists", readiness.response.status === 503 && readiness.payload.visitorApiReady === true && readiness.payload.staffPlatformReady === false);

const publicBootstrap = await request("/api/public/bootstrap");
const bootstrapSafety = publicAppBootstrapSafety(publicBootstrap.payload);
check("public bootstrap is safe", publicBootstrap.response.status === 200 && bootstrapSafety.ready);
check("public bootstrap matches the submitted app event", publicBootstrap.payload.guide?.id === "texas-sandfest-2027");
check("public bootstrap never enables board runtime", publicBootstrap.payload.runtime === undefined);
check("public bootstrap does not expose private partner or finance data", !JSON.stringify(publicBootstrap.payload).match(/invoiceStatus|quickBooks|stripePriceId|board_demo/i));

const publicBootstrapHead = await worker.fetch(new Request(`${base}/api/public/bootstrap`, { method: "HEAD" }));
check("HEAD preserves bootstrap status and cache headers without a body", publicBootstrapHead.status === 200 && publicBootstrapHead.headers.get("cache-control")?.includes("s-maxage=120") && (await publicBootstrapHead.text()) === "");

const sculptors = await request("/api/public/sculptors");
check("unpublished sculptors fail closed", sculptors.response.status === 200 && sculptors.payload.meta?.publicationStatus === "unpublished" && sculptors.payload.sculptors.length === 0);

const concierge = await request("/api/public/concierge", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "When is Texas SandFest?" })
});
const conciergeSafety = publicConciergeResponseSafety(concierge.payload);
check("Ask Sandy returns a governed answer", concierge.response.status === 200 && conciergeSafety.ready && concierge.payload.topic === "schedule");
check("Ask Sandy cites a public source", concierge.payload.sources.some(source => /^https:\/\//.test(source.href)));

const unpublishedSponsor = await request("/api/public/concierge", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "What sponsor packages are open?" })
});
check("Ask Sandy does not publish pending sponsor prices", unpublishedSponsor.response.status === 200 && unpublishedSponsor.payload.escalated === true && /not currently published/i.test(unpublishedSponsor.payload.answer));

const invalidQuestion = await request("/api/public/concierge", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "x" })
});
check("invalid concierge questions fail closed", invalidQuestion.response.status === 400);

const oversizedQuestion = await request("/api/public/concierge", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "x".repeat(3_000) })
});
check("oversized bodies are rejected", oversizedQuestion.response.status === 413);

const partnerReadiness = await request("/api/public/partner-intake");
const partnerSafety = publicPartnerServerReadinessSafety(partnerReadiness.payload, { eventId: "texas-sandfest-2027" });
check("partner intake publishes a valid unavailable state", partnerReadiness.response.status === 200 && partnerSafety.ready && partnerReadiness.payload.intakeAvailable === false);

const sponsorCatalog = await request("/api/public/sponsors");
const vendorCatalog = await request("/api/public/vendors");
check("pending sponsors remain unpublished", sponsorCatalog.payload.publication?.available === false && sponsorCatalog.payload.sponsorPackages.length === 0);
check("pending vendors remain unpublished", vendorCatalog.payload.publication?.available === false && vendorCatalog.payload.vendorOfferings.length === 0);

const islandConditions = await request("/api/public/island-conditions");
check("island conditions render an honest standby state", islandConditions.response.status === 200
  && islandConditions.payload.weather?.freshness?.state !== "live"
  && islandConditions.payload.ferry?.freshness?.state !== "live"
  && islandConditions.payload.cameras?.length === 8
  && islandConditions.payload.summary?.liveCameras === 0);

const writeAttempt = await request("/api/public/vendor-applications", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ organizationName: "Synthetic Browser Test" })
});
check("stateful public writes are unavailable", writeAttempt.response.status === 503 && writeAttempt.response.headers.get("retry-after") === "3600");

const adminAttempt = await request("/api/admin/app-bootstrap");
check("admin routes do not exist on the public bridge", adminAttempt.response.status === 404);

const allowedPreflight = await request("/api/public/concierge", {
  method: "OPTIONS",
  headers: { origin: "https://www.heyelab.com" }
});
check("the production site receives a scoped CORS preflight", allowedPreflight.response.status === 204 && allowedPreflight.response.headers.get("access-control-allow-origin") === "https://www.heyelab.com");

const rejectedOrigin = await request("/api/public/concierge", {
  method: "POST",
  headers: { origin: "https://example.com", "content-type": "application/json" },
  body: JSON.stringify({ question: "When is SandFest?" })
});
check("unapproved browser origins are rejected", rejectedOrigin.response.status === 403 && !rejectedOrigin.response.headers.has("access-control-allow-origin"));

const missing = await request("/does-not-exist");
check("unknown paths return JSON 404", missing.response.status === 404 && missing.payload.error === "Not found.");

console.log(`Cloudflare public API bridge: ${checks}/${checks} checks passed.`);
