import { publicAppBootstrapSafety } from "./public-bootstrap.mjs";
import { publicConciergeResponseSafety } from "./public-concierge.mjs";

export const PUBLIC_REVIEW_BRIDGE_URL = "https://sandfest-api.heyelab.com/";

function check(checks, id, condition, detail) {
  checks.push({ id, ok: Boolean(condition), detail });
}

async function request(baseUrl, fetchImpl, path, init = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetchImpl(new URL(path, baseUrl), {
        redirect: "error",
        ...init
      });
      const body = response.status === 204 ? "" : await response.text();
      const contentType = response.headers.get("content-type") || "";
      if (response.status === 204) return { response, payload: null };
      if (/application\/json/i.test(contentType)) {
        return { response, payload: JSON.parse(body) };
      }
      lastError = new Error(`${new URL(path, baseUrl)} returned ${response.status} ${contentType || "without a content type"}, not JSON.`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) await new Promise(resolve => setTimeout(resolve, attempt * 500));
  }
  throw lastError || new Error(`Could not verify ${new URL(path, baseUrl)}.`);
}

export async function verifyPublicReviewBridge({
  baseUrl = PUBLIC_REVIEW_BRIDGE_URL,
  expectedBaseUrl = PUBLIC_REVIEW_BRIDGE_URL,
  fetchImpl = globalThis.fetch
} = {}) {
  const target = new URL(baseUrl);
  const expectedTarget = new URL(expectedBaseUrl);
  if (target.href !== expectedTarget.href) {
    return {
      ok: false,
      summary: { passed: 0, failed: 1, total: 1 },
      checks: [{
        id: "public_bridge.origin",
        ok: false,
        detail: `Read-only release mode requires ${expectedTarget.href}; received ${target.href}.`
      }]
    };
  }

  const checks = [];
  try {
    const health = await request(target, fetchImpl, "/health");
    check(checks, "public_bridge.health", health.response.status === 200 && health.payload?.service === "texas-sandfest-public-review-bridge", `HTTP ${health.response.status}; service=${health.payload?.service || "missing"}.`);

    const readiness = await request(target, fetchImpl, "/ready");
    check(checks, "public_bridge.readiness", readiness.response.status === 503 && readiness.payload?.visitorApiReady === true && readiness.payload?.staffPlatformReady === false, `HTTP ${readiness.response.status}; visitorApiReady=${readiness.payload?.visitorApiReady}; staffPlatformReady=${readiness.payload?.staffPlatformReady}.`);

    const bootstrap = await request(target, fetchImpl, "/api/public/bootstrap");
    check(checks, "public_bridge.bootstrap", bootstrap.response.status === 200 && publicAppBootstrapSafety(bootstrap.payload).ready && bootstrap.payload?.guide?.id === "texas-sandfest-2027", `HTTP ${bootstrap.response.status}; guide=${bootstrap.payload?.guide?.id || "missing"}.`);
    check(checks, "public_bridge.bootstrap_cache", bootstrap.response.headers.get("cache-control")?.includes("s-maxage=120"), `cache-control=${bootstrap.response.headers.get("cache-control") || "missing"}.`);

    const sculptors = await request(target, fetchImpl, "/api/public/sculptors");
    check(checks, "public_bridge.sculptors", sculptors.response.status === 200 && sculptors.payload?.meta?.publicationStatus === "unpublished" && sculptors.payload?.sculptors?.length === 0, `HTTP ${sculptors.response.status}; publication=${sculptors.payload?.meta?.publicationStatus || "missing"}; count=${sculptors.payload?.sculptors?.length ?? "missing"}.`);

    const concierge = await request(target, fetchImpl, "/api/public/concierge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "When is Texas SandFest?" })
    });
    const conciergeSafety = publicConciergeResponseSafety(concierge.payload);
    check(checks, "public_bridge.concierge", concierge.response.status === 200 && concierge.payload?.topic === "schedule" && conciergeSafety.ready, `HTTP ${concierge.response.status}; topic=${concierge.payload?.topic || "missing"}; errors=${conciergeSafety.errors?.join(" ") || "none"}.`);
    check(checks, "public_bridge.concierge_guidance", !String(concierge.payload?.answer || "").includes("service-animals-only"), "Concierge must not repeat the generic-name guidance bug.");

    const sponsors = await request(target, fetchImpl, "/api/public/sponsors");
    check(checks, "public_bridge.sponsors", sponsors.response.status === 200 && sponsors.payload?.publication?.available === false && sponsors.payload?.sponsorPackages?.length === 0, `HTTP ${sponsors.response.status}; available=${sponsors.payload?.publication?.available}; count=${sponsors.payload?.sponsorPackages?.length ?? "missing"}.`);

    const vendors = await request(target, fetchImpl, "/api/public/vendors");
    check(checks, "public_bridge.vendors", vendors.response.status === 200 && vendors.payload?.publication?.available === false && vendors.payload?.vendorOfferings?.length === 0, `HTTP ${vendors.response.status}; available=${vendors.payload?.publication?.available}; count=${vendors.payload?.vendorOfferings?.length ?? "missing"}.`);

    const conditions = await request(target, fetchImpl, "/api/public/island-conditions");
    check(checks, "public_bridge.island_conditions", conditions.response.status === 200 && conditions.payload?.weather?.freshness?.state !== "live" && conditions.payload?.ferry?.freshness?.state !== "live" && conditions.payload?.cameras?.length === 8 && conditions.payload?.summary?.liveCameras === 0, `HTTP ${conditions.response.status}; weather=${conditions.payload?.weather?.freshness?.state || "missing"}; ferry=${conditions.payload?.ferry?.freshness?.state || "missing"}; cameras=${conditions.payload?.cameras?.length ?? "missing"}; live=${conditions.payload?.summary?.liveCameras ?? "missing"}.`);

    const preflight = await request(target, fetchImpl, "/api/public/concierge", {
      method: "OPTIONS",
      headers: { origin: "https://www.heyelab.com" }
    });
    check(checks, "public_bridge.cors", preflight.response.status === 204 && preflight.response.headers.get("access-control-allow-origin") === "https://www.heyelab.com", `HTTP ${preflight.response.status}; allow-origin=${preflight.response.headers.get("access-control-allow-origin") || "missing"}.`);

    const write = await request(target, fetchImpl, "/api/public/vendor-applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationName: "Synthetic live verification" })
    });
    check(checks, "public_bridge.writes_fail_closed", write.response.status === 503 && write.response.headers.get("retry-after") === "3600", `HTTP ${write.response.status}; retry-after=${write.response.headers.get("retry-after") || "missing"}.`);
  } catch (error) {
    checks.push({ id: "public_bridge.request", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  const failed = checks.filter(item => !item.ok).length;
  return {
    ok: failed === 0 && checks.length === 12,
    summary: { passed: checks.length - failed, failed, total: checks.length },
    checks
  };
}
