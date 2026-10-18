import bootstrapInput from "../../data/processed/app-bootstrap.json" with { type: "json" };
import islandConditionsInput from "../../data/processed/island-conditions.json" with { type: "json" };
import {
  publicAppBootstrap,
  publicAppBootstrapSafety
} from "../../lib/public-bootstrap.mjs";
import {
  answerPublicConcierge,
  parsePublicConciergeQuestion,
  publicConciergeResponseSafety
} from "../../lib/public-concierge.mjs";
import { publicIslandConditions } from "../../lib/island-conditions.mjs";

const EVENT_ID = "texas-sandfest-2027";
const ALLOWED_ORIGINS = new Set([
  "https://heyelab.com",
  "https://www.heyelab.com"
]);
const PUBLIC_CACHE = "public, max-age=60, s-maxage=120, stale-while-revalidate=300";
const NO_STORE = "no-store";
const MAX_JSON_BODY_BYTES = 2_048;

const bootstrap = publicAppBootstrap(bootstrapInput);
const bootstrapSafety = publicAppBootstrapSafety(bootstrap);
if (!bootstrapSafety.ready) {
  throw new Error(`Unsafe public bootstrap: ${bootstrapSafety.errors.join(" ")}`);
}

const unpublishedSculptors = Object.freeze({
  meta: {
    eventId: EVENT_ID,
    publicationStatus: "unpublished",
    sourceUrl: "https://www.texassandfest.org/sculptors",
    publishedAt: null
  },
  legend: [],
  sculptors: [],
  entries: [],
  pois: []
});

const unpublishedSponsors = Object.freeze({
  lastUpdated: null,
  publication: {
    available: false,
    status: "pending",
    eventId: EVENT_ID,
    sourceUrl: null,
    sourceCheckedAt: null,
    message: "The current sponsorship program has not been published yet."
  },
  sponsorPackages: [],
  sponsors: []
});

const unpublishedVendors = Object.freeze({
  lastUpdated: null,
  publication: {
    available: false,
    status: "pending",
    eventId: EVENT_ID,
    sourceUrl: null,
    sourceCheckedAt: null,
    message: "The current vendor program has not been published yet."
  },
  vendorOfferings: []
});

const unavailableTickets = Object.freeze({
  lastUpdated: null,
  currency: "usd",
  checkoutEnvironment: "unavailable",
  checkoutPolicy: null,
  products: []
});

const unavailablePartnerIntake = Object.freeze({
  eventId: EVENT_ID,
  intakeAvailable: false,
  recoveryAvailable: false
});

const unavailableGuestServices = Object.freeze({
  eventId: EVENT_ID,
  available: false,
  consentVersion: "guest-services-intake-v1",
  categories: [
    { id: "lost_item", label: "Lost item" },
    { id: "accessibility", label: "Accessibility help" },
    { id: "ticketing", label: "Ticket or entry help" },
    { id: "family_reunification", label: "Separated party" },
    { id: "vendor_question", label: "Vendor or food question" },
    { id: "general", label: "General visitor help" }
  ]
});

const unavailableIslandConditions = Object.freeze(publicIslandConditions({
  schemaVersion: islandConditionsInput.schemaVersion,
  eventId: EVENT_ID,
  lastUpdated: null,
  weather: {
    status: "unavailable",
    observedAt: null,
    source: islandConditionsInput.weather?.source || "National Weather Service",
    sourceUrl: islandConditionsInput.weather?.sourceUrl || "https://www.weather.gov/crp/",
    alerts: []
  },
  ferry: {
    status: "unavailable",
    route: islandConditionsInput.ferry?.route || "Port Aransas Ferry",
    source: islandConditionsInput.ferry?.source || "TxDOT",
    sourceUrl: islandConditionsInput.ferry?.sourceUrl || "https://www.txdot.gov/discover/ferry-boat-schedules/ferry-operations.html",
    observedAt: null,
    checkedAt: null,
    directions: []
  },
  cameras: islandConditionsInput.cameras.map(camera => ({
    id: camera.id,
    name: camera.name,
    zone: camera.zone,
    kind: camera.kind,
    status: camera.sourceId || camera.sourceUrl ? "configured" : "awaiting_source",
    sourceId: camera.sourceId || null,
    sourceUrl: camera.sourceUrl || null,
    staleAfterMinutes: camera.staleAfterMinutes,
    monitoringEnabled: false,
    privacyMode: "metrics_only",
    health: null
  })),
  observations: [],
  incidents: []
}));

function securityHeaders(cacheControl) {
  return {
    "cache-control": cacheControl,
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff"
  };
}

function corsHeaders(request) {
  const origin = request.headers.get("origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
    "access-control-allow-headers": "accept, content-type, idempotency-key",
    "access-control-max-age": "86400",
    vary: "Origin"
  };
}

function json(request, body, status = 200, cacheControl = NO_STORE, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: {
      ...securityHeaders(cacheControl),
      ...corsHeaders(request),
      ...extraHeaders
    }
  });
}

function rejectsBrowserOrigin(request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && !ALLOWED_ORIGINS.has(origin));
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    return { ok: false, status: 413, error: "Request body is too large." };
  }
  if (!request.body) return { ok: false, status: 400, error: "A JSON request body is required." };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, status: 413, error: "Request body is too large." };
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, status: 400, error: "Enter a valid JSON request body." };
  }
}

function conciergeContext() {
  return {
    bootstrap,
    tickets: unavailableTickets,
    sponsors: unpublishedSponsors,
    vendors: unpublishedVendors,
    islandConditions: null
  };
}

async function handleConcierge(request) {
  const body = await readJsonBody(request);
  if (!body.ok) return json(request, { error: body.error }, body.status);
  const question = parsePublicConciergeQuestion(body.value.question);
  if (!question.ok) return json(request, { error: question.error }, 400);

  const answer = answerPublicConcierge(question.question, conciergeContext());
  const { ok, ...payload } = answer;
  const safety = publicConciergeResponseSafety(payload);
  if (!ok || !safety.ready) {
    console.error(JSON.stringify({
      event: "unsafe_concierge_response",
      errors: safety.errors
    }));
    return json(request, { error: "Ask Sandy is temporarily unavailable." }, 503);
  }
  return json(request, payload, 200);
}

function handleOptions(request) {
  if (rejectsBrowserOrigin(request)) return json(request, { error: "Origin is not allowed." }, 403);
  const origin = request.headers.get("origin");
  if (!origin) return json(request, { error: "Origin is required." }, 400);
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request),
      "cache-control": "public, max-age=86400",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff"
    }
  });
}

function unavailableWrite(request) {
  return json(request, {
    error: "This online workflow is not available yet. Use the official Texas SandFest contact information for help."
  }, 503, NO_STORE, { "retry-after": "3600" });
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (method === "OPTIONS") return handleOptions(request);
  if (rejectsBrowserOrigin(request)) return json(request, { error: "Origin is not allowed." }, 403);
  if (!["GET", "HEAD", "POST"].includes(method)) {
    return json(request, { error: "Method not allowed." }, 405, NO_STORE, { allow: "GET, HEAD, POST, OPTIONS" });
  }

  if (method === "GET" || method === "HEAD") {
    if (pathname === "/health") {
      return json(request, {
        status: "ok",
        service: "texas-sandfest-public-review-bridge",
        mode: "read_only"
      });
    }
    if (pathname === "/ready") {
      return json(request, {
        status: "not_ready",
        visitorApiReady: true,
        staffPlatformReady: false,
        reason: "The production staff data plane and identity provider are not deployed."
      }, 503);
    }
    if (pathname === "/api/public/bootstrap") return json(request, bootstrap, 200, PUBLIC_CACHE);
    if (pathname === "/api/public/sculptors") return json(request, unpublishedSculptors, 200, PUBLIC_CACHE);
    if (pathname === "/api/public/alert") return json(request, bootstrap.alert, 200, "public, max-age=15, s-maxage=15");
    if (pathname === "/api/public/tickets") return json(request, unavailableTickets, 200, PUBLIC_CACHE);
    if (pathname === "/api/public/sponsors") return json(request, unpublishedSponsors, 200, PUBLIC_CACHE);
    if (pathname === "/api/public/vendors") return json(request, unpublishedVendors, 200, PUBLIC_CACHE);
    if (pathname === "/api/public/partner-intake") return json(request, unavailablePartnerIntake, 200);
    if (pathname === "/api/public/guest-services") return json(request, unavailableGuestServices, 200);
    if (pathname === "/api/public/island-conditions") return json(request, unavailableIslandConditions, 200, "public, max-age=30, s-maxage=60, stale-while-revalidate=120");
  }

  if (method === "POST" && pathname === "/api/public/concierge") return handleConcierge(request);
  if (method === "POST" && pathname.startsWith("/api/public/")) return unavailableWrite(request);

  return json(request, { error: "Not found." }, 404);
}

export default {
  async fetch(request) {
    try {
      const response = await handleRequest(request);
      return request.method === "HEAD"
        ? new Response(null, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          })
        : response;
    } catch (error) {
      console.error(JSON.stringify({
        event: "unhandled_request_error",
        message: error instanceof Error ? error.message : "Unknown error"
      }));
      return json(request, { error: "The public SandFest service is temporarily unavailable." }, 500);
    }
  }
};
