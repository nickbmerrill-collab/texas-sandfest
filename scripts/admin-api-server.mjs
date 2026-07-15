import { createServer } from "node:http";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../lib/load-env.mjs";
import { createStorage } from "../lib/storage.mjs";
import { authMode, authModeIsJwt, resolveSession } from "../lib/auth.mjs";
import { summarizeLedger } from "../lib/revenue.mjs";
import {
  appendPassportCompletion,
  listPassportCompletions,
  readPlatformDoc,
  readVotingBallot,
  updatePlatformDoc,
  upsertVote,
  writePlatformDoc
} from "../lib/platform-data.mjs";
import { createRateLimiter } from "../lib/rate-limit.mjs";
import { enqueueJob } from "../lib/job-queue.mjs";
import {
  applyCheckin,
  applyCheckout,
  appendLocation,
  enrichAssets,
  normalizeAsset,
  normalizeCheckout,
  normalizeLocation,
  parseAssetQrPayload,
  summarizeFleet
} from "../lib/fleet.mjs";
import {
  enrichShifts,
  normalizeHourLog,
  normalizeShift,
  normalizeVolunteer,
  summarizeVolunteers
} from "../lib/volunteers.mjs";
import {
  consentFromCheckout,
  normalizeConsent,
  recipientsForChannel,
  summarizeConsent,
  validateCheckoutConsent
} from "../lib/consent.mjs";
import { sendAlertSms, smsConfigFromEnv } from "../lib/sms.mjs";
import {
  applyStamp,
  normalizeCheckpoint,
  normalizeCompletion,
  normalizeHunt,
  progressForAttendee,
  publicCheckpoint,
  summarizePassport
} from "../lib/passport.mjs";
import {
  applyVote,
  normalizeBallotEntry,
  normalizeVote,
  summarizeVoting,
  tallyVotes,
  voteForAttendee
} from "../lib/voting.mjs";
import {
  enrichBooths,
  normalizeBooth,
  normalizeVendor,
  publicBoothPins,
  summarizeBooths
} from "../lib/booths.mjs";

await loadDotEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SANDFEST_API_PORT || 8788);
const SANDFEST_ENV = process.env.SANDFEST_ENV || "development";
const RATE_LIMIT_WINDOW_MS = Number(process.env.SANDFEST_RATE_LIMIT_WINDOW_MS || 60_000);
const ADMIN_RATE_LIMIT = Number(process.env.SANDFEST_ADMIN_RATE_LIMIT || 120);
const CHECKOUT_RATE_LIMIT = Number(process.env.SANDFEST_CHECKOUT_RATE_LIMIT || 30);
const PUBLIC_RATE_LIMIT = Number(process.env.SANDFEST_PUBLIC_RATE_LIMIT || 1200);
// Tighter bucket for unauthenticated public writes (stamps/votes) at festival scale.
const PUBLIC_WRITE_RATE_LIMIT = Number(process.env.SANDFEST_PUBLIC_WRITE_RATE_LIMIT || 60);
const MAX_BODY_BYTES = Number(process.env.SANDFEST_MAX_BODY_BYTES || 262_144); // 256 KiB
const ADMIN_TOKEN = process.env.SANDFEST_ADMIN_API_TOKEN || "dev-admin-token-change-me";
const rateLimiter = await createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS });
if (rateLimiter.kind === "memory") {
  setInterval(() => rateLimiter.prune?.(), RATE_LIMIT_WINDOW_MS).unref?.();
}
const REQUIRE_TICKET_VOTE = process.env.SANDFEST_REQUIRE_TICKET_VOTE === "true";
const ASYNC_SMS = process.env.SANDFEST_ASYNC_SMS !== "false";
const ADMIN_ACTOR_ID = process.env.SANDFEST_ADMIN_ACTOR_ID || "local-admin";
const ADMIN_ROLE = process.env.SANDFEST_ADMIN_ROLE || "super_admin";
const CONFIG_PATH_OVERRIDE = process.env.SANDFEST_ADMIN_CONFIG_PATH
  ? path.resolve(process.env.SANDFEST_ADMIN_CONFIG_PATH)
  : null;
const ALERT_PATH_OVERRIDE = process.env.SANDFEST_ALERT_CONFIG_PATH
  ? path.resolve(process.env.SANDFEST_ALERT_CONFIG_PATH)
  : null;
const storage = await createStorage({
  root: ROOT,
  configPaths: {
    ...(CONFIG_PATH_OVERRIDE ? { "admin-config": CONFIG_PATH_OVERRIDE } : {}),
    ...(ALERT_PATH_OVERRIDE ? { "emergency-alert": ALERT_PATH_OVERRIDE } : {})
  }
});
const STRIPE_ENABLED = process.env.STRIPE_TICKETING_ENABLED === "true";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const STRIPE_SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || "http://127.0.0.1:4173/tickets/success?session_id={CHECKOUT_SESSION_ID}";
const STRIPE_CANCEL_URL = process.env.STRIPE_CANCEL_URL || "http://127.0.0.1:4173/#tickets";
const ALLOWED_ORIGINS = (process.env.SANDFEST_CORS_ORIGINS || [
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173",
  "https://www.texassandfest.org",
  "https://texassandfest.org"
].join(",")).split(",").map(origin => origin.trim()).filter(Boolean);

const patchableTicketFields = new Set([
  "name",
  "priceLabel",
  "unitAmount",
  "stripePriceId",
  "requiresReview",
  "description",
  "quantity",
  "checkoutMode",
  "fulfillment",
  "terms",
  "active"
]);

const patchableSponsorFields = new Set([
  "name",
  "amount",
  "publicLabel",
  "active",
  "requiresApproval",
  "stripePriceId",
  "quickBooksItemId",
  "benefits"
]);

const fulfillmentStatuses = new Set([
  "queued",
  "needs_review",
  "ready",
  "issued",
  "checked_in",
  "refunded",
  "voided"
]);

const alertSeverities = new Set([
  "info",
  "watch",
  "warning",
  "critical",
  "clear"
]);

const rolePermissions = {
  super_admin: ["*"],
  ops_admin: [
    "admin:read",
    "alert:read",
    "alert:write",
    "orders:read",
    "payments:read",
    "revenue:read",
    "fleet:read",
    "fleet:write",
    "volunteers:read",
    "consent:read",
    "passport:read",
    "voting:read",
    "booths:read",
    "fulfillment:read",
    "fulfillment:update",
    "audit:read",
    "snapshot:read"
  ],
  ticketing_admin: [
    "admin:read",
    "alert:read",
    "ticket:write",
    "orders:read",
    "payments:read",
    "revenue:read",
    "consent:read",
    "fulfillment:read",
    "audit:read",
    "snapshot:read"
  ],
  sponsor_admin: [
    "admin:read",
    "alert:read",
    "sponsor:write",
    "orders:read",
    "fulfillment:read",
    "audit:read",
    "snapshot:read"
  ],
  finance_admin: [
    "admin:read",
    "alert:read",
    "orders:read",
    "payments:read",
    "revenue:read",
    "fleet:read",
    "volunteers:read",
    "consent:read",
    "passport:read",
    "voting:read",
    "booths:read",
    "fulfillment:read",
    "audit:read",
    "snapshot:read"
  ],
  viewer: [
    "admin:read",
    "alert:read",
    "orders:read",
    "payments:read",
    "revenue:read",
    "fleet:read",
    "volunteers:read",
    "consent:read",
    "passport:read",
    "voting:read",
    "booths:read",
    "fulfillment:read",
    "audit:read",
    "snapshot:read"
  ]
};

function checkStatus(ok, message, severity = "error") {
  return {
    ok,
    severity: ok ? "ok" : severity,
    message
  };
}

// Enterprise platform docs: atomic file store or Postgres (lib/platform-data.mjs).
async function readRevenueLedger() {
  const ledger = await readPlatformDoc(ROOT, "revenue", null);
  if (!ledger) {
    return { lastUpdated: null, currency: "usd", expectedAttendance: null, ticketCapacity: null, entries: [] };
  }
  return {
    lastUpdated: ledger.lastUpdated ?? null,
    currency: ledger.currency ?? "usd",
    expectedAttendance: ledger.expectedAttendance ?? null,
    ticketCapacity: ledger.ticketCapacity ?? null,
    entries: Array.isArray(ledger.entries) ? ledger.entries : []
  };
}

function emptyFleetDoc() {
  return {
    lastUpdated: null,
    eventId: "texas-sandfest-2026",
    assets: [],
    checkouts: [],
    locations: []
  };
}

function normalizeFleetDoc(ledger) {
  if (!ledger || typeof ledger !== "object") return emptyFleetDoc();
  return {
    lastUpdated: ledger.lastUpdated ?? null,
    eventId: ledger.eventId ?? "texas-sandfest-2026",
    assets: Array.isArray(ledger.assets) ? ledger.assets.map(normalizeAsset) : [],
    checkouts: Array.isArray(ledger.checkouts) ? ledger.checkouts.map(normalizeCheckout) : [],
    locations: Array.isArray(ledger.locations) ? ledger.locations.map(normalizeLocation) : []
  };
}

async function readFleetLedger() {
  return normalizeFleetDoc(await readPlatformDoc(ROOT, "fleet", null));
}

async function writeFleetLedger(ledger) {
  const payload = {
    _note: "Fleet/asset checkout ledger (lib/fleet.mjs). Atomic/Postgres via platform-data.",
    lastUpdated: new Date().toISOString(),
    eventId: ledger.eventId ?? "texas-sandfest-2026",
    assets: ledger.assets ?? [],
    checkouts: ledger.checkouts ?? [],
    locations: ledger.locations ?? []
  };
  // Mutex / row-lock path so concurrent checkouts cannot clobber each other.
  await updatePlatformDoc(ROOT, "fleet", () => payload, { fallback: payload });
  return payload;
}

function fleetDashboardPayload(ledger) {
  const summary = summarizeFleet(ledger.assets, ledger.checkouts, ledger.locations, {
    eventId: ledger.eventId,
    generatedAt: ledger.lastUpdated
  });
  const assets = enrichAssets(ledger.assets, ledger.checkouts, ledger.locations);
  const openCheckouts = assets
    .filter(a => a.activeCheckout)
    .map(a => a.activeCheckout);
  return {
    lastUpdated: ledger.lastUpdated,
    eventId: ledger.eventId,
    summary,
    assets,
    openCheckouts,
    checkouts: ledger.checkouts,
    locations: ledger.locations.slice(-50)
  };
}

async function readVolunteerMirror() {
  const mirror = await readPlatformDoc(ROOT, "volunteers", null);
  if (!mirror) {
    return {
      lastUpdated: null,
      eventId: "texas-sandfest-2026",
      source: "empty",
      zoneLabels: {},
      volunteers: [],
      shifts: [],
      hourLogs: []
    };
  }
  return {
    lastUpdated: mirror.lastUpdated ?? null,
    eventId: mirror.eventId ?? "texas-sandfest-2026",
    source: mirror.source ?? "seed",
    zoneLabels: mirror.zoneLabels ?? {},
    volunteers: Array.isArray(mirror.volunteers) ? mirror.volunteers.map(normalizeVolunteer) : [],
    shifts: Array.isArray(mirror.shifts) ? mirror.shifts.map(normalizeShift) : [],
    hourLogs: Array.isArray(mirror.hourLogs) ? mirror.hourLogs.map(normalizeHourLog) : []
  };
}

function volunteerDashboardPayload(mirror) {
  const summary = summarizeVolunteers(mirror.volunteers, mirror.shifts, mirror.hourLogs, {
    eventId: mirror.eventId,
    source: mirror.source,
    generatedAt: mirror.lastUpdated,
    zoneLabels: mirror.zoneLabels
  });
  return {
    lastUpdated: mirror.lastUpdated,
    eventId: mirror.eventId,
    source: mirror.source,
    summary,
    // Flat coverage rows for iOS VolunteerCoverage tiles (id/zone/filled/needed).
    coverage: summary.zones.map(z => ({
      id: z.id,
      zone: z.zone,
      filled: z.filled,
      needed: z.needed,
      fillPct: z.fillPct,
      status: z.status,
      openGaps: z.openGaps
    })),
    shifts: enrichShifts(mirror.shifts),
    volunteers: mirror.volunteers,
    hourLogs: mirror.hourLogs
  };
}

async function readConsentLedger() {
  const ledger = await readPlatformDoc(ROOT, "consent", null);
  if (!ledger) return { lastUpdated: null, eventId: "texas-sandfest-2026", records: [] };
  return {
    lastUpdated: ledger.lastUpdated ?? null,
    eventId: ledger.eventId ?? "texas-sandfest-2026",
    records: Array.isArray(ledger.records) ? ledger.records.map(r => normalizeConsent(r)) : []
  };
}

async function appendConsentRecord(record) {
  const next = await updatePlatformDoc(
    ROOT,
    "consent",
    doc => {
      const ledger = doc && typeof doc === "object"
        ? { eventId: doc.eventId ?? "texas-sandfest-2026", records: Array.isArray(doc.records) ? doc.records.slice() : [] }
        : { eventId: "texas-sandfest-2026", records: [] };
      const idx = ledger.records.findIndex(r =>
        (record.email && r.email === record.email) ||
        (record.phone && r.phone === record.phone && record.phone)
      );
      if (idx === -1) {
        ledger.records.push(record);
      } else {
        const prev = ledger.records[idx];
        ledger.records[idx] = normalizeConsent({
          ...prev,
          ...record,
          id: prev.id,
          email: record.email || prev.email,
          phone: record.phone || prev.phone,
          emailMarketing: record.emailMarketing?.optedIn ? record.emailMarketing : prev.emailMarketing,
          smsMarketing: record.smsMarketing?.optedIn ? record.smsMarketing : prev.smsMarketing,
          smsSafety: record.smsSafety?.optedIn ? record.smsSafety : prev.smsSafety,
          createdAt: prev.createdAt,
          updatedAt: record.updatedAt
        });
      }
      return {
        _note: "Consent ledger (lib/consent.mjs). Atomic/Postgres via platform-data.",
        lastUpdated: new Date().toISOString(),
        eventId: ledger.eventId,
        records: ledger.records
      };
    },
    { fallback: { eventId: "texas-sandfest-2026", records: [] } }
  );
  return record;
}

async function readPassportHunt() {
  const doc = await readPlatformDoc(ROOT, "passportHunt", null);
  if (!doc) {
    return {
      lastUpdated: null,
      hunt: normalizeHunt({ active: false }),
      checkpoints: []
    };
  }
  return {
    lastUpdated: doc.lastUpdated ?? null,
    hunt: normalizeHunt(doc.hunt || {}),
    checkpoints: Array.isArray(doc.checkpoints) ? doc.checkpoints.map(normalizeCheckpoint) : []
  };
}

async function readPassportCompletions() {
  const completions = await listPassportCompletions(ROOT);
  return {
    lastUpdated: null,
    completions: completions.map(normalizeCompletion)
  };
}

async function writePassportCompletions(completions) {
  // Prefer append path for new stamps; bulk write used only for legacy full replace.
  await writePlatformDoc(ROOT, "passportCompletions", {
    _note: "Sculpture Passport completions. Prefer hunt_completions table when Postgres is on.",
    lastUpdated: new Date().toISOString(),
    completions: completions ?? []
  });
  return { lastUpdated: new Date().toISOString(), completions };
}

async function readPeoplesChoice() {
  const doc = await readVotingBallot(ROOT);
  return {
    lastUpdated: doc.lastUpdated ?? null,
    eventId: doc.eventId ?? "texas-sandfest-2026",
    votingOpen: doc.votingOpen !== false,
    title: doc.title ?? "People's Choice",
    description: doc.description ?? "",
    entries: Array.isArray(doc.entries) ? doc.entries.map(normalizeBallotEntry) : [],
    votes: Array.isArray(doc.votes) ? doc.votes.map(normalizeVote) : []
  };
}

async function writePeoplesChoice(doc) {
  const payload = {
    _note: "People's Choice ballot + votes (lib/voting.mjs).",
    lastUpdated: new Date().toISOString(),
    eventId: doc.eventId ?? "texas-sandfest-2026",
    votingOpen: doc.votingOpen !== false,
    title: doc.title ?? "People's Choice",
    description: doc.description ?? "",
    entries: doc.entries ?? [],
    votes: doc.votes ?? []
  };
  await writePlatformDoc(ROOT, "voting", payload);
  return payload;
}

async function readBoothMap() {
  const doc = await readPlatformDoc(ROOT, "booths", null);
  if (!doc) {
    return {
      lastUpdated: null,
      eventId: "texas-sandfest-2026",
      source: "empty",
      booths: [],
      vendors: []
    };
  }
  return {
    lastUpdated: doc.lastUpdated ?? null,
    eventId: doc.eventId ?? "texas-sandfest-2026",
    source: doc.source ?? "seed",
    booths: Array.isArray(doc.booths) ? doc.booths.map(normalizeBooth) : [],
    vendors: Array.isArray(doc.vendors) ? doc.vendors.map(normalizeVendor) : []
  };
}

function deploymentProfile() {
  const production = SANDFEST_ENV === "production";
  const adminBase = process.env.SANDFEST_ADMIN_BASE_URL || "";
  const publicApiBase = process.env.SANDFEST_API_PUBLIC_BASE_URL || "";
  const corsOrigins = new Set(ALLOWED_ORIGINS);
  const mode = authMode();
  const jwt = authModeIsJwt();
  const jwksUrl = process.env.SANDFEST_AUTH_JWKS_URL || "";
  const issuer = process.env.SANDFEST_AUTH_ISSUER || "";
  const checks = {
    environment: checkStatus(["development", "staging", "production"].includes(SANDFEST_ENV), `SANDFEST_ENV=${SANDFEST_ENV}`),
    authMode: checkStatus(
      !production || jwt,
      production ? "Production requires SANDFEST_AUTH_MODE=jwt with a JWKS URL." : `Auth mode: ${mode}.`,
      production ? "error" : "warning"
    ),
    authJwks: checkStatus(
      !jwt || jwksUrl.startsWith("https://"),
      jwt ? "JWT mode requires SANDFEST_AUTH_JWKS_URL to be an HTTPS URL." : "JWKS URL not required in bearer-token mode.",
      "error"
    ),
    authIssuer: checkStatus(
      !jwt || Boolean(issuer),
      jwt ? "JWT mode requires SANDFEST_AUTH_ISSUER for issuer pinning." : "Issuer pinning not required in bearer-token mode.",
      jwt ? "error" : "warning"
    ),
    adminToken: checkStatus(
      jwt || (ADMIN_TOKEN.length >= 32 && ADMIN_TOKEN !== "dev-admin-token-change-me" && !ADMIN_TOKEN.includes("replace-with")),
      jwt ? "Bearer token unused in JWT mode." : production ? "SANDFEST_ADMIN_API_TOKEN must be a long production secret." : "Using a local/dev admin token.",
      production && !jwt ? "error" : "warning"
    ),
    adminRole: checkStatus(jwt || Boolean(rolePermissions[ADMIN_ROLE]), jwt ? "Role resolved from JWT claim." : `SANDFEST_ADMIN_ROLE=${ADMIN_ROLE}`),
    adminActor: checkStatus(
      jwt || ADMIN_ACTOR_ID !== "local-admin" || !production,
      jwt ? "Actor resolved from JWT claim." : production ? "SANDFEST_ADMIN_ACTOR_ID must identify the deployed actor/provider." : `SANDFEST_ADMIN_ACTOR_ID=${ADMIN_ACTOR_ID}`,
      production && !jwt ? "error" : "warning"
    ),
    cors: checkStatus(
      corsOrigins.has("https://www.texassandfest.org") && corsOrigins.has("https://texassandfest.org") && (!adminBase || corsOrigins.has(adminBase)),
      "CORS includes Texas SandFest origins and admin base URL."
    ),
    publicApiBase: checkStatus(
      !production || publicApiBase.startsWith("https://"),
      production ? "SANDFEST_API_PUBLIC_BASE_URL must be HTTPS." : "Public API base can be local in development.",
      production ? "error" : "warning"
    ),
    adminBase: checkStatus(
      !production || adminBase.startsWith("https://"),
      production ? "SANDFEST_ADMIN_BASE_URL must be HTTPS." : "Admin base can be local in development.",
      production ? "error" : "warning"
    ),
    stripeSecret: checkStatus(
      !STRIPE_ENABLED || STRIPE_SECRET_KEY.startsWith("sk_"),
      "Stripe ticketing enabled requires STRIPE_SECRET_KEY.",
      "error"
    ),
    stripeWebhook: checkStatus(
      !STRIPE_ENABLED || STRIPE_WEBHOOK_SECRET.startsWith("whsec_"),
      "Stripe ticketing enabled requires STRIPE_WEBHOOK_SECRET.",
      "error"
    ),
    stripeUrls: checkStatus(
      !STRIPE_ENABLED || (STRIPE_SUCCESS_URL.startsWith("https://") && STRIPE_CANCEL_URL.startsWith("https://")),
      production ? "Stripe success/cancel URLs must be HTTPS." : "Stripe success/cancel URLs may be local until sandbox is enabled.",
      production || STRIPE_ENABLED ? "error" : "warning"
    ),
    rateLimits: checkStatus(
      ADMIN_RATE_LIMIT > 0 && CHECKOUT_RATE_LIMIT > 0 && PUBLIC_RATE_LIMIT > 0,
      `Rate limits admin=${ADMIN_RATE_LIMIT}/min checkout=${CHECKOUT_RATE_LIMIT}/min public=${PUBLIC_RATE_LIMIT}/min.`
    ),
    sms: (() => {
      const sms = smsConfigFromEnv(process.env);
      return checkStatus(
        !sms.enabled || sms.ready,
        sms.enabled
          ? (sms.ready ? "Twilio SMS ready (SMS_ENABLED=true)." : sms.reason)
          : "SMS scaffold idle (SMS_ENABLED=false). Consent capture still works.",
        sms.enabled && !sms.ready ? "error" : "warning"
      );
    })()
  };
  const values = Object.values(checks);
  const errors = values.filter(check => !check.ok && check.severity === "error");
  const warnings = values.filter(check => !check.ok && check.severity === "warning");
  return {
    environment: SANDFEST_ENV,
    production,
    ok: errors.length === 0,
    errors: errors.length,
    warnings: warnings.length,
    checks
  };
}

function clampLimit(value, fallback = 50) {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : fallback;
}

function allowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return "*";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] || "*";
}

function sendJson(request, response, status, payload, headers = {}) {
  const requestId = request.requestId || `req_${randomUUID()}`;
  const responsePayload = status >= 400 && !Object.hasOwn(payload, "requestId")
    ? { ...payload, requestId }
    : payload;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": allowedOrigin(request),
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "x-request-id": requestId,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "vary": "origin",
    "cache-control": "no-store",
    ...headers
  });
  response.end(request.method === "HEAD" ? undefined : JSON.stringify(responsePayload, null, 2));
}

function publicCacheHeaders(seconds = 60) {
  return {
    "cache-control": `public, max-age=${seconds}, s-maxage=${seconds}, stale-while-revalidate=300`
  };
}

function requestIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return request.socket.remoteAddress ?? "unknown";
}

function rateLimitProfile(pathname, method) {
  if (method === "OPTIONS") return null;
  if (pathname === "/api/stripe/create-checkout-session") return { name: "checkout", limit: CHECKOUT_RATE_LIMIT };
  // Unauthenticated write paths get a stricter bucket (festival abuse protection).
  if (
    method === "POST" &&
    (pathname === "/api/public/passport/stamp" || pathname === "/api/public/voting")
  ) {
    return { name: "public-write", limit: PUBLIC_WRITE_RATE_LIMIT };
  }
  if (pathname.startsWith("/api/admin")) return { name: "admin", limit: ADMIN_RATE_LIMIT };
  if (pathname.startsWith("/api/public")) return { name: "public", limit: PUBLIC_RATE_LIMIT };
  return null;
}

async function checkRateLimit(request, response, pathname, method) {
  const profile = rateLimitProfile(pathname, method);
  if (!profile) return true;
  const key = `${profile.name}:${requestIp(request)}`;
  const result = await rateLimiter.check(key, profile.limit);
  response.setHeader("x-ratelimit-limit", String(profile.limit));
  response.setHeader("x-ratelimit-remaining", String(result.remaining));
  response.setHeader("x-ratelimit-reset", String(Math.ceil(result.resetAt / 1000)));
  response.setHeader("x-ratelimit-backend", rateLimiter.kind || "memory");
  if (result.allowed) return true;
  sendJson(request, response, 429, {
    error: `Rate limit exceeded for ${profile.name} requests.`,
    retryAfterSeconds: result.retryAfterSeconds
  }, {
    "retry-after": String(result.retryAfterSeconds)
  });
  return false;
}

async function adminSession(request) {
  if (request.adminSession) return request.adminSession;
  const session = await resolveSession(request, { rolePermissions });
  if (session) request.adminSession = session;
  return session;
}

function hasPermission(session, permission) {
  return Boolean(session?.permissions?.includes("*") || session?.permissions?.includes(permission));
}

async function requirePermission(request, response, permission) {
  const session = await adminSession(request);
  if (!session) {
    sendJson(request, response, 401, { error: "Unauthorized admin API request." });
    return null;
  }
  if (!hasPermission(session, permission)) {
    sendJson(request, response, 403, {
      error: `Admin role ${session.role} is missing permission: ${permission}`,
      requiredPermission: permission,
      session
    });
    return null;
  }
  request.adminSession = session;
  return session;
}

async function requireAdmin(request, response) {
  return requirePermission(request, response, "admin:read");
}

async function readBody(request) {
  const body = await readRawBody(request);
  if (!body.trim()) return {};
  return JSON.parse(body);
}

async function readRawBody(request) {
  const declared = Number(request.headers["content-length"] || 0);
  if (declared > MAX_BODY_BYTES) {
    const err = new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes.`);
    err.statusCode = 413;
    throw err;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buf = Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes.`);
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function filterPatch(input, allowedFields) {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => allowedFields.has(key))
  );
}

function updateById(items, id, patch) {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return null;
  items[index] = { ...items[index], ...patch };
  return items[index];
}

function alertIsActive(alert) {
  if (!alert?.active) return false;
  if (!alert.expiresAt) return true;
  const expiresAt = Date.parse(alert.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function publicAlertPayload(alert) {
  const active = alertIsActive(alert);
  return {
    id: alert.id,
    active,
    severity: active ? alert.severity : "clear",
    title: active ? alert.title : "",
    message: active ? alert.message : "",
    audience: alert.audience ?? ["public"],
    updatedAt: alert.updatedAt,
    expiresAt: alert.expiresAt ?? null
  };
}

function sanitizeAlertPatch(input, current) {
  const next = { ...current };
  if (Object.hasOwn(input, "active")) next.active = Boolean(input.active);
  if (Object.hasOwn(input, "severity")) {
    if (!alertSeverities.has(input.severity)) {
      return { error: `Invalid alert severity: ${input.severity}` };
    }
    next.severity = input.severity;
  }
  if (Object.hasOwn(input, "title")) next.title = String(input.title ?? "").trim().slice(0, 120);
  if (Object.hasOwn(input, "message")) next.message = String(input.message ?? "").trim().slice(0, 600);
  if (Object.hasOwn(input, "audience")) {
    next.audience = Array.isArray(input.audience)
      ? input.audience.map(item => String(item).trim()).filter(Boolean).slice(0, 8)
      : ["public"];
  }
  if (Object.hasOwn(input, "expiresAt")) {
    if (input.expiresAt === null || input.expiresAt === "") {
      next.expiresAt = null;
    } else {
      const expiresAt = Date.parse(input.expiresAt);
      if (!Number.isFinite(expiresAt)) return { error: "Alert expiresAt must be an ISO date or null." };
      next.expiresAt = new Date(expiresAt).toISOString();
    }
  }
  if (next.active && (!next.title || !next.message)) {
    return { error: "Active alerts require a title and message." };
  }
  if (next.severity === "clear") next.active = false;
  next.id = next.active ? `alert_${randomUUID()}` : current.id || "alert_none";
  next.updatedAt = new Date().toISOString();
  next.source = "admin";
  return { alert: next };
}

function adminActor(request) {
  const session = request.adminSession;
  return {
    id: session?.id ?? "unknown",
    role: session?.role ?? "unknown",
    permissions: session?.permissions ?? [],
    type: session?.auth ?? "bearer-token",
    issuer: session?.issuer ?? null,
    tokenId: session?.tokenId ?? null,
    tokenHint: `${(request.headers.authorization || "").slice(0, 18)}...`,
    ip: request.socket.remoteAddress ?? null,
    userAgent: request.headers["user-agent"] ?? null
  };
}

async function writeAuditRecord(request, action, target, before, after, metadata = {}) {
  const id = `audit_${randomUUID()}`;
  const record = {
    id,
    eventId: "texas-sandfest-2026",
    action,
    target,
    actor: adminActor(request),
    requestId: request.requestId ?? null,
    before,
    after,
    metadata,
    createdAt: new Date().toISOString()
  };
  await storage.audit.write(record);
  return record;
}

async function writeConfigSnapshot(request, target, data, reason) {
  const id = `snap_${randomUUID()}`;
  const record = {
    id,
    eventId: "texas-sandfest-2026",
    target,
    reason,
    actor: adminActor(request),
    requestId: request.requestId ?? null,
    data,
    createdAt: new Date().toISOString()
  };
  await storage.snapshots.write(record);
  return record;
}

function snapshotTargetKey(target) {
  switch (target?.type) {
  case "alert":
    return "emergency-alert";
  case "ticketCatalog":
    return "ticket-products";
  case "adminConfig":
    return "admin-config";
  default:
    return null;
  }
}

function validateCheckoutItems(products, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { error: "Cart must include at least one line item." };
  }

  const lines = [];
  for (const item of items) {
    const product = products.find(entry => entry.id === item.productId);
    const quantity = Number(item.quantity);
    if (!product) return { error: `Unknown ticket product: ${item.productId}` };
    if (!Number.isInteger(quantity) || quantity < 1) return { error: `Invalid quantity for ${product.name}.` };
    if (product.active === false) return { error: `${product.name} is not currently active.` };
    if (quantity < (product.quantity?.min ?? 1)) return { error: `${product.name} is below the minimum quantity.` };
    if (quantity > (product.quantity?.max ?? 12)) return { error: `${product.name} exceeds the maximum quantity.` };
    if (product.requiresReview) return { error: `${product.name} requires admin review before checkout.` };
    if (!product.stripePriceId || product.stripePriceId.startsWith("price_replace")) {
      return { error: `${product.name} needs a real Stripe Price ID before checkout.` };
    }
    lines.push({
      productId: product.id,
      name: product.name,
      quantity,
      stripePriceId: product.stripePriceId,
      unitAmount: product.unitAmount,
      fulfillment: product.fulfillment
    });
  }

  return { lines };
}

function stripeReady() {
  return STRIPE_ENABLED && STRIPE_SECRET_KEY.startsWith("sk_");
}

async function createStripeCheckoutSession(lines, orderId) {
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", STRIPE_SUCCESS_URL);
  body.set("cancel_url", STRIPE_CANCEL_URL);
  body.set("client_reference_id", orderId);
  body.set("metadata[event_id]", "texas-sandfest-2026");
  body.set("metadata[order_id]", orderId);
  body.set("metadata[sandfest_line_items]", JSON.stringify(lines.map(line => ({
    productId: line.productId,
    name: line.name,
    quantity: line.quantity,
    fulfillment: line.fulfillment
  }))).slice(0, 490));
  lines.forEach((line, index) => {
    body.set(`line_items[${index}][price]`, line.stripePriceId);
    body.set(`line_items[${index}][quantity]`, String(line.quantity));
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Stripe Checkout Session creation failed.");
  }
  return data;
}

async function handleCreateCheckoutSession(request, response) {
  const body = await readBody(request);
  const tickets = await storage.config.read("ticket-products");
  const validation = validateCheckoutItems(tickets.products, body.items);
  if (validation.error) {
    sendJson(request, response, 400, { error: validation.error });
    return;
  }

  // Consent is optional, but if any box is checked we require contact fields.
  const consentCheck = validateCheckoutConsent(body);
  if (consentCheck.error) {
    sendJson(request, response, 400, { error: consentCheck.error });
    return;
  }

  const orderId = `order_${randomUUID()}`;
  const now = new Date().toISOString();
  const consentRecord = consentFromCheckout(body, {
    orderId,
    idFactory: () => `consent_${randomUUID()}`,
    now
  });
  // Only persist a consent row when the buyer left any contact + opt-in signal
  // (or contact alone for fulfillment). Always attach the shape to the order.
  const hasContact = Boolean(consentRecord.email || consentRecord.phone);
  const hasOptIn = consentRecord.emailMarketing.optedIn
    || consentRecord.smsMarketing.optedIn
    || consentRecord.smsSafety.optedIn;
  if (hasContact && hasOptIn) {
    await appendConsentRecord(consentRecord);
  }

  const order = {
    id: orderId,
    eventId: "texas-sandfest-2026",
    status: stripeReady() ? "creating_checkout_session" : "checkout_not_configured",
    provider: "stripe",
    lineItems: validation.lines,
    customer: {
      email: consentRecord.email ?? body.customer?.email ?? null,
      phone: consentRecord.phone ?? body.customer?.phone ?? null
    },
    consent: {
      emailMarketing: consentRecord.emailMarketing.optedIn,
      smsMarketing: consentRecord.smsMarketing.optedIn,
      smsSafety: consentRecord.smsSafety.optedIn,
      consentId: hasContact && hasOptIn ? consentRecord.id : null
    },
    totals: {
      knownAmount: validation.lines.reduce((sum, line) => sum + (line.unitAmount ?? 0) * line.quantity, 0),
      currency: tickets.currency ?? "usd"
    },
    createdAt: now,
    updatedAt: now
  };

  if (!stripeReady()) {
    await storage.orders.write(order, { prefix: "not-configured" });
    sendJson(request, response, 202, {
      ok: false,
      code: "stripe_not_configured",
      message: "Stripe checkout is validated but not enabled. Add sandbox keys, real Stripe Price IDs, and STRIPE_TICKETING_ENABLED=true.",
      order
    });
    return;
  }

  try {
    const session = await createStripeCheckoutSession(validation.lines, orderId);
    order.status = "checkout_session_created";
    order.stripeCheckoutSessionId = session.id;
    order.checkoutUrl = session.url;
    order.updatedAt = new Date().toISOString();
    await storage.orders.write(order, { prefix: "checkout" });
    sendJson(request, response, 200, {
      ok: true,
      orderId,
      checkoutSessionId: session.id,
      checkoutUrl: session.url
    });
  } catch (error) {
    order.status = "checkout_session_failed";
    order.error = error.message;
    order.updatedAt = new Date().toISOString();
    await storage.orders.write(order, { prefix: "failed" });
    sendJson(request, response, 502, { error: error.message, orderId });
  }
}

async function createFulfillmentRecords(eventRecord) {
  if (!isFulfillmentEvent(eventRecord.type)) {
    return [];
  }
  const object = eventRecord.raw?.data?.object ?? {};
  const orderId = object.client_reference_id || object.metadata?.order_id || eventRecord.checkoutSessionId || eventRecord.id;
  let lineItems = [{
    productId: "unknown",
    name: "Stripe checkout line items pending expansion",
    quantity: 1,
    fulfillment: "manual_review"
  }];
  if (object.metadata?.sandfest_line_items) {
    try {
      const parsed = JSON.parse(object.metadata.sandfest_line_items);
      if (Array.isArray(parsed) && parsed.length > 0) lineItems = parsed;
    } catch {
      lineItems = [{
        productId: "unknown",
        name: "Stripe line items metadata could not be parsed",
        quantity: 1,
        fulfillment: "manual_review"
      }];
    }
  }

  const records = [];
  for (const line of lineItems) {
    const quantity = Math.max(1, Number(line.quantity) || 1);
    for (let index = 1; index <= quantity; index += 1) {
      const id = `ful_${randomUUID()}`;
      const record = {
        id,
        orderId,
        eventId: "texas-sandfest-2026",
        checkoutSessionId: eventRecord.checkoutSessionId,
        paymentIntentId: eventRecord.paymentIntentId,
        productId: line.productId,
        name: line.name,
        fulfillmentType: line.fulfillment || "manual_review",
        status: line.fulfillment === "sponsor_crm" || line.fulfillment === "raffle_ticket_registry" ? "needs_review" : "queued",
        holder: {
          email: object.customer_details?.email ?? object.customer_email ?? null,
          name: object.customer_details?.name ?? null
        },
        sourceEventId: eventRecord.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        notes: []
      };
      await storage.fulfillment.write(record);
      records.push(record);
    }
  }
  return records;
}

function isFulfillmentEvent(type) {
  return ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(type);
}

function verifyStripeSignature(rawBody, signatureHeader) {
  if (!STRIPE_WEBHOOK_SECRET) return { verified: false, reason: "webhook_secret_not_configured" };
  if (!signatureHeader) return { verified: false, reason: "missing_signature" };
  const parts = Object.fromEntries(signatureHeader.split(",").map(part => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  if (!parts.t || !parts.v1) return { verified: false, reason: "malformed_signature" };
  const signedPayload = `${parts.t}.${rawBody}`;
  const expected = createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(signedPayload).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(parts.v1);
  const verified = expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  return { verified, reason: verified ? "ok" : "signature_mismatch" };
}

async function handleStripeWebhook(request, response) {
  const rawBody = await readRawBody(request);
  const signature = request.headers["stripe-signature"];
  const verification = verifyStripeSignature(rawBody, signature);
  if (STRIPE_WEBHOOK_SECRET && !verification.verified) {
    sendJson(request, response, 400, { error: `Invalid Stripe webhook signature: ${verification.reason}` });
    return;
  }

  const event = JSON.parse(rawBody || "{}");
  const eventId = event.id ?? `evt_local_${randomUUID()}`;
  const existingEvent = await storage.paymentEvents.findById(eventId);
  if (existingEvent) {
    sendJson(request, response, 200, {
      received: true,
      duplicate: true,
      record: existingEvent.record
    });
    return;
  }

  const record = {
    id: eventId,
    provider: "stripe",
    type: event.type ?? "unknown",
    verified: verification.verified,
    verificationReason: verification.reason,
    receivedAt: new Date().toISOString(),
    objectId: event.data?.object?.id ?? null,
    checkoutSessionId: event.type?.startsWith("checkout.session") ? event.data?.object?.id ?? null : null,
    paymentIntentId: event.data?.object?.payment_intent ?? event.data?.object?.id ?? null,
    fulfillmentStatus: ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)
      ? "queued"
      : "not_required",
    raw: event
  };

  let fulfillmentRecords = [];
  if (isFulfillmentEvent(record.type)) {
    const existingFulfillment = await storage.fulfillment.findByCheckoutSession(record.checkoutSessionId);
    if (existingFulfillment.length > 0) {
      record.fulfillmentStatus = "already_queued";
      record.fulfillmentRecordIds = existingFulfillment.map(item => item.record.id).filter(Boolean);
    } else {
      fulfillmentRecords = await createFulfillmentRecords(record);
      record.fulfillmentRecordIds = fulfillmentRecords.map(item => item.id);
    }
  } else {
    record.fulfillmentRecordIds = [];
  }

  await storage.paymentEvents.write(record);
  sendJson(request, response, 200, { received: true, duplicate: false, record });
}

async function handleFulfillmentPatch(request, response, fulfillmentId) {
  if (!(await requirePermission(request, response, "fulfillment:update"))) return;
  const body = await readBody(request);
  const status = body.status;
  if (!fulfillmentStatuses.has(status)) {
    sendJson(request, response, 400, { error: `Invalid fulfillment status: ${status}` });
    return;
  }
  const found = await storage.fulfillment.findById(fulfillmentId);
  if (!found) {
    sendJson(request, response, 404, { error: `Fulfillment record not found: ${fulfillmentId}` });
    return;
  }
  const record = {
    ...found.record,
    status,
    updatedAt: new Date().toISOString(),
    notes: [
      ...(found.record.notes ?? []),
      ...(body.note ? [{ at: new Date().toISOString(), text: body.note }] : [])
    ]
  };
  await storage.fulfillment.update(record);
  await writeAuditRecord(request, "fulfillment.status.update", {
    type: "fulfillment",
    id: fulfillmentId
  }, {
    status: found.record.status,
    notes: found.record.notes ?? []
  }, {
    status: record.status,
    notes: record.notes
  }, {
    storagePath: found.path
  });
  sendJson(request, response, 200, { fulfillment: record });
}

async function handleAdminTicketPatch(request, response, productId) {
  if (!(await requirePermission(request, response, "ticket:write"))) return;
  const patch = filterPatch(await readBody(request), patchableTicketFields);
  const tickets = await storage.config.read("ticket-products");
  const before = tickets.products.find(item => item.id === productId);
  const product = updateById(tickets.products, productId, patch);
  if (!product) {
    sendJson(request, response, 404, { error: `Ticket product not found: ${productId}` });
    return;
  }
  tickets.lastUpdated = new Date().toISOString();
  await writeConfigSnapshot(request, { type: "ticketCatalog", id: "ticket-products" }, {
    ...tickets,
    products: tickets.products.map(item => item.id === productId ? before : item)
  }, `Before ticket update: ${productId}`);
  await storage.config.write("ticket-products", tickets);
  await writeAuditRecord(request, "ticket.update", {
    type: "ticket",
    id: productId
  }, before, product, {
    changedFields: Object.keys(patch)
  });
  sendJson(request, response, 200, { product, lastUpdated: tickets.lastUpdated });
}

async function handleAdminSponsorPatch(request, response, sponsorId) {
  if (!(await requirePermission(request, response, "sponsor:write"))) return;
  const patch = filterPatch(await readBody(request), patchableSponsorFields);
  const config = await storage.config.read("admin-config");
  const before = config.sponsorPackages.find(item => item.id === sponsorId);
  const sponsorPackage = updateById(config.sponsorPackages, sponsorId, patch);
  if (!sponsorPackage) {
    sendJson(request, response, 404, { error: `Sponsor package not found: ${sponsorId}` });
    return;
  }
  config.lastUpdated = new Date().toISOString();
  await writeConfigSnapshot(request, { type: "adminConfig", id: "admin-config" }, {
    ...config,
    sponsorPackages: config.sponsorPackages.map(item => item.id === sponsorId ? before : item)
  }, `Before sponsor package update: ${sponsorId}`);
  await storage.config.write("admin-config", config);
  await writeAuditRecord(request, "sponsor-package.update", {
    type: "sponsorPackage",
    id: sponsorId
  }, before, sponsorPackage, {
    changedFields: Object.keys(patch)
  });
  sendJson(request, response, 200, { sponsorPackage, lastUpdated: config.lastUpdated });
}

async function handleRequest(request, response) {
  request.requestId = request.headers["x-request-id"] || `req_${randomUUID()}`;
  if (request.method === "OPTIONS") {
    sendJson(request, response, 204, {});
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method === "HEAD" ? "GET" : request.method;
  if (!(await checkRateLimit(request, response, pathname, method))) return;

  try {
    if (method === "GET" && pathname === "/health") {
      const deployment = deploymentProfile();
      sendJson(request, response, 200, {
        ok: true,
        service: "sandfest-admin-api",
        owner: "heyelab",
        environment: deployment.environment,
        deploymentReady: deployment.ok,
        deploymentWarnings: deployment.warnings,
        deploymentErrors: deployment.errors,
        adminRole: authModeIsJwt() ? "jwt-claims" : ADMIN_ROLE,
        authMode: authMode(),
        stripeReady: stripeReady(),
        storage: storage.kind === "postgres" ? "postgres" : "local-file-prototype",
        uptimeSeconds: Math.round(process.uptime()),
        time: new Date().toISOString()
      });
      return;
    }

    if (method === "GET" && pathname === "/ready") {
      const checks = {
        appBootstrap: true,
        tickets: true,
        adminConfig: true,
        alertConfig: true,
        auditWritable: true,
        snapshotsWritable: true,
        ordersWritable: true,
        storage: storage.kind
      };
      try {
        await Promise.all([
          storage.config.read("app-bootstrap"),
          storage.config.read("ticket-products"),
          storage.config.read("admin-config"),
          storage.config.read("emergency-alert"),
          storage.audit.list(1),
          storage.snapshots.list(1),
          storage.orders.list(1)
        ]);
      } catch (error) {
        checks.error = error.message;
      }
      const deployment = deploymentProfile();
      checks.deployment = deployment.ok;
      const ok = !checks.error && deployment.ok;
      sendJson(request, response, ok ? 200 : 503, {
        ok,
        service: "sandfest-admin-api",
        checks,
        deployment,
        time: new Date().toISOString()
      });
      return;
    }

    if (method === "GET" && pathname === "/api/public/bootstrap") {
      sendJson(request, response, 200, await storage.config.read("app-bootstrap"), publicCacheHeaders(120));
      return;
    }

    if (method === "GET" && pathname === "/api/public/tickets") {
      sendJson(request, response, 200, await storage.config.read("ticket-products"), publicCacheHeaders(60));
      return;
    }

    if (method === "GET" && pathname === "/api/public/sponsors") {
      const config = await storage.config.read("admin-config");
      sendJson(request, response, 200, {
        lastUpdated: config.lastUpdated,
        sponsorPackages: config.sponsorPackages.filter(item => item.active)
      }, publicCacheHeaders(120));
      return;
    }

    if (method === "GET" && pathname === "/api/public/alert") {
      sendJson(request, response, 200, publicAlertPayload(await storage.config.read("emergency-alert")), publicCacheHeaders(15));
      return;
    }

    // Sculpture Passport — public hunt definition + stamp + progress.
    if (method === "GET" && pathname === "/api/public/passport") {
      const huntDoc = await readPassportHunt();
      sendJson(request, response, 200, {
        lastUpdated: huntDoc.lastUpdated,
        hunt: huntDoc.hunt,
        checkpoints: huntDoc.checkpoints.map(publicCheckpoint)
      }, publicCacheHeaders(60));
      return;
    }

    if (method === "GET" && pathname === "/api/public/passport/progress") {
      const attendeeRef = String(url.searchParams.get("attendeeRef") || "").trim();
      if (!attendeeRef || attendeeRef.length < 4) {
        sendJson(request, response, 400, { error: "Query attendeeRef is required (min 4 chars)." });
        return;
      }
      const huntDoc = await readPassportHunt();
      const completionDoc = await readPassportCompletions();
      sendJson(request, response, 200, {
        progress: progressForAttendee(
          huntDoc.checkpoints,
          completionDoc.completions,
          attendeeRef,
          huntDoc.hunt.id
        )
      }, {
        "cache-control": "no-store"
      });
      return;
    }

    if (method === "POST" && pathname === "/api/public/passport/stamp") {
      const body = await readBody(request);
      const huntDoc = await readPassportHunt();
      const completionDoc = await readPassportCompletions();
      const result = applyStamp({
        hunt: huntDoc.hunt,
        checkpoints: huntDoc.checkpoints,
        completions: completionDoc.completions
      }, body, {
        idFactory: () => `hc_${randomUUID()}`,
        now: new Date().toISOString()
      });
      if (!result.ok) {
        sendJson(request, response, 400, { error: result.error });
        return;
      }
      if (!result.alreadyStamped) {
        // Append-only path: unique constraint safe under concurrency (Postgres).
        await appendPassportCompletion(ROOT, result.completion);
      }
      const completions = await listPassportCompletions(ROOT);
      const progress = progressForAttendee(
        huntDoc.checkpoints,
        completions,
        result.completion.attendeeRef,
        huntDoc.hunt.id
      );
      sendJson(request, response, result.alreadyStamped ? 200 : 201, {
        ok: true,
        alreadyStamped: result.alreadyStamped,
        completion: result.completion,
        checkpoint: result.checkpoint,
        progress
      });
      return;
    }

    // People's Choice voting
    if (method === "GET" && pathname === "/api/public/voting") {
      const doc = await readPeoplesChoice();
      const tally = tallyVotes(doc.entries, doc.votes);
      sendJson(request, response, 200, {
        lastUpdated: doc.lastUpdated,
        eventId: doc.eventId,
        votingOpen: doc.votingOpen,
        title: doc.title,
        description: doc.description,
        entries: doc.entries,
        leaderboard: tally.leaderboard,
        totals: { totalVotes: tally.totalVotes, uniqueVoters: tally.uniqueVoters }
      }, publicCacheHeaders(30));
      return;
    }

    if (method === "GET" && pathname === "/api/public/voting/me") {
      const attendeeRef = String(url.searchParams.get("attendeeRef") || "").trim();
      if (!attendeeRef || attendeeRef.length < 4) {
        sendJson(request, response, 400, { error: "Query attendeeRef is required." });
        return;
      }
      const doc = await readPeoplesChoice();
      sendJson(request, response, 200, {
        vote: voteForAttendee(doc.votes, attendeeRef),
        votingOpen: doc.votingOpen
      }, { "cache-control": "no-store" });
      return;
    }

    if (method === "POST" && pathname === "/api/public/voting") {
      const body = await readBody(request);
      const doc = await readPeoplesChoice();
      const result = applyVote({
        eventId: doc.eventId,
        votingOpen: doc.votingOpen,
        entries: doc.entries,
        votes: doc.votes
      }, body, {
        idFactory: () => `vote_${randomUUID()}`,
        now: new Date().toISOString(),
        requireTicket: REQUIRE_TICKET_VOTE || Boolean(body.requireTicket)
      });
      if (!result.ok) {
        sendJson(request, response, 400, { error: result.error });
        return;
      }
      let votes = result.votes;
      if (result.changed) {
        votes = await upsertVote(ROOT, result.vote, {
          eventId: doc.eventId,
          votingOpen: doc.votingOpen,
          title: doc.title,
          description: doc.description,
          entries: doc.entries
        });
      }
      const tally = tallyVotes(doc.entries, votes);
      sendJson(request, response, result.changed ? 201 : 200, {
        ok: true,
        changed: result.changed,
        vote: result.vote,
        leaderboard: tally.leaderboard,
        totals: { totalVotes: tally.totalVotes, uniqueVoters: tally.uniqueVoters }
      });
      return;
    }

    // Public booth / vendor map (Eventeny CSV mirror)
    if (method === "GET" && pathname === "/api/public/booths") {
      const map = await readBoothMap();
      sendJson(request, response, 200, {
        lastUpdated: map.lastUpdated,
        eventId: map.eventId,
        source: map.source,
        pins: publicBoothPins(map.booths, map.vendors),
        summary: summarizeBooths(map.booths, map.vendors)
      }, publicCacheHeaders(60));
      return;
    }

    if (method === "POST" && pathname === "/api/stripe/create-checkout-session") {
      await handleCreateCheckoutSession(request, response);
      return;
    }

    if (method === "POST" && pathname === "/api/stripe/webhook") {
      await handleStripeWebhook(request, response);
      return;
    }

    if (method === "GET" && pathname === "/api/admin/config") {
      if (!(await requireAdmin(request, response))) return;
      const [config, tickets] = await Promise.all([
        storage.config.read("admin-config"),
        storage.config.read("ticket-products")
      ]);
      sendJson(request, response, 200, { config, tickets });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/session") {
      const session = await requireAdmin(request, response);
      if (!session) return;
      sendJson(request, response, 200, { session });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/deployment") {
      const session = await requireAdmin(request, response);
      if (!session) return;
      sendJson(request, response, 200, { deployment: deploymentProfile() });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/alert") {
      if (!(await requirePermission(request, response, "alert:read"))) return;
      sendJson(request, response, 200, { alert: await storage.config.read("emergency-alert") });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/revenue") {
      if (!(await requirePermission(request, response, "revenue:read"))) return;
      const ledger = await readRevenueLedger();
      const summary = summarizeLedger(ledger.entries, {
        currency: ledger.currency,
        expectedAttendance: ledger.expectedAttendance,
        ticketCapacity: ledger.ticketCapacity,
        generatedAt: ledger.lastUpdated
      });
      sendJson(request, response, 200, {
        lastUpdated: ledger.lastUpdated,
        summary,
        entries: ledger.entries
      });
      return;
    }

    // Fleet / equipment checkout (Phase 1). See docs/research/04-fleet-asset-tracking.md.
    if (method === "GET" && pathname === "/api/admin/fleet") {
      if (!(await requirePermission(request, response, "fleet:read"))) return;
      const ledger = await readFleetLedger();
      sendJson(request, response, 200, fleetDashboardPayload(ledger));
      return;
    }

    const fleetAssetMatch = pathname.match(/^\/api\/admin\/fleet\/assets\/([^/]+)$/);
    if (method === "GET" && fleetAssetMatch) {
      if (!(await requirePermission(request, response, "fleet:read"))) return;
      const assetId = decodeURIComponent(fleetAssetMatch[1]);
      const ledger = await readFleetLedger();
      const assets = enrichAssets(ledger.assets, ledger.checkouts, ledger.locations);
      const asset = assets.find(a => a.id === assetId);
      if (!asset) {
        sendJson(request, response, 404, { error: `Asset not found: ${assetId}` });
        return;
      }
      const history = ledger.checkouts
        .filter(c => c.assetId === assetId)
        .sort((a, b) => String(b.checkOutAt).localeCompare(String(a.checkOutAt)));
      const locations = ledger.locations
        .filter(l => l.assetId === assetId)
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, 20);
      sendJson(request, response, 200, { asset, history, locations });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/fleet/resolve-qr") {
      if (!(await requirePermission(request, response, "fleet:read"))) return;
      const body = await readBody(request);
      const assetId = parseAssetQrPayload(body.payload ?? body.qr ?? body.code);
      if (!assetId) {
        sendJson(request, response, 400, { error: "Unrecognized asset QR payload. Expected tsf:asset:<id>." });
        return;
      }
      const ledger = await readFleetLedger();
      const assets = enrichAssets(ledger.assets, ledger.checkouts, ledger.locations);
      const asset = assets.find(a => a.id === assetId);
      if (!asset) {
        sendJson(request, response, 404, { error: `Asset not found for QR: ${assetId}`, assetId });
        return;
      }
      sendJson(request, response, 200, { assetId, asset });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/fleet/checkout") {
      if (!(await requirePermission(request, response, "fleet:write"))) return;
      const body = await readBody(request);
      const assetId = body.assetId || parseAssetQrPayload(body.payload ?? body.qr);
      let before = null;
      let result = null;
      const next = await updatePlatformDoc(ROOT, "fleet", current => {
        const ledger = normalizeFleetDoc(current);
        before = ledger.assets.find(a => a.id === assetId) ?? null;
        result = applyCheckout(ledger, {
          ...body,
          assetId,
          signatureBy: body.signatureBy ?? request.adminSession?.id ?? null,
          method: body.method || "ios_scan"
        }, {
          idFactory: () => `co_${randomUUID()}`,
          now: new Date().toISOString()
        });
        if (!result.ok) return ledger;
        return {
          _note: "Fleet/asset checkout ledger (lib/fleet.mjs).",
          lastUpdated: new Date().toISOString(),
          eventId: ledger.eventId,
          assets: result.assets,
          checkouts: result.checkouts,
          locations: ledger.locations
        };
      }, { fallback: emptyFleetDoc() });
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Checkout failed." });
        return;
      }
      await writeAuditRecord(request, "fleet.checkout", {
        type: "asset",
        id: result.asset.id
      }, before, result.asset, {
        checkoutId: result.checkout.id,
        checkedOutTo: result.checkout.checkedOutTo,
        team: result.checkout.team
      });
      sendJson(request, response, 200, {
        asset: enrichAssets([result.asset], result.checkouts, next.locations)[0],
        checkout: result.checkout,
        summary: summarizeFleet(next.assets, next.checkouts, next.locations, {
          eventId: next.eventId,
          generatedAt: next.lastUpdated
        })
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/fleet/checkin") {
      if (!(await requirePermission(request, response, "fleet:write"))) return;
      const body = await readBody(request);
      const assetId = body.assetId || parseAssetQrPayload(body.payload ?? body.qr);
      let before = null;
      let result = null;
      const next = await updatePlatformDoc(ROOT, "fleet", current => {
        const ledger = normalizeFleetDoc(current);
        before = ledger.assets.find(a => a.id === (assetId || body.assetId)) ?? null;
        result = applyCheckin(ledger, {
          ...body,
          assetId,
          signatureBy: body.signatureBy ?? request.adminSession?.id ?? null,
          method: body.method || "ios_scan"
        }, {
          now: new Date().toISOString()
        });
        if (!result.ok) return ledger;
        return {
          _note: "Fleet/asset checkout ledger (lib/fleet.mjs).",
          lastUpdated: new Date().toISOString(),
          eventId: ledger.eventId,
          assets: result.assets,
          checkouts: result.checkouts,
          locations: ledger.locations
        };
      }, { fallback: emptyFleetDoc() });
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Check-in failed." });
        return;
      }
      await writeAuditRecord(request, "fleet.checkin", {
        type: "asset",
        id: result.checkout.assetId
      }, before, result.asset, {
        checkoutId: result.checkout.id,
        endCondition: result.checkout.endCondition,
        damageReport: result.checkout.damageReport
      });
      sendJson(request, response, 200, {
        asset: result.asset
          ? enrichAssets([result.asset], result.checkouts, next.locations)[0]
          : null,
        checkout: result.checkout,
        summary: summarizeFleet(next.assets, next.checkouts, next.locations, {
          eventId: next.eventId,
          generatedAt: next.lastUpdated
        })
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/fleet/locations") {
      if (!(await requirePermission(request, response, "fleet:write"))) return;
      const body = await readBody(request);
      let result = null;
      let notFound = false;
      const next = await updatePlatformDoc(ROOT, "fleet", current => {
        const ledger = normalizeFleetDoc(current);
        const assetId = String(body.assetId ?? "").trim();
        if (assetId && !ledger.assets.some(a => a.id === assetId)) {
          notFound = true;
          return ledger;
        }
        result = appendLocation(ledger.locations, body, {
          idFactory: () => `loc_${randomUUID()}`,
          now: new Date().toISOString()
        });
        if (!result.ok) return ledger;
        return {
          _note: "Fleet/asset checkout ledger (lib/fleet.mjs).",
          lastUpdated: new Date().toISOString(),
          eventId: ledger.eventId,
          assets: ledger.assets,
          checkouts: ledger.checkouts,
          locations: result.locations.slice(-500)
        };
      }, { fallback: emptyFleetDoc() });
      if (notFound) {
        sendJson(request, response, 404, { error: `Asset not found: ${String(body.assetId ?? "").trim()}` });
        return;
      }
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Location update failed." });
        return;
      }
      sendJson(request, response, 200, {
        location: result.location,
        lastUpdated: next.lastUpdated
      });
      return;
    }

    // Volunteer mirror / coverage (Phase 1). Buy VolunteerLocal; mirror into ops.
    if (method === "GET" && pathname === "/api/admin/volunteers") {
      if (!(await requirePermission(request, response, "volunteers:read"))) return;
      const mirror = await readVolunteerMirror();
      sendJson(request, response, 200, volunteerDashboardPayload(mirror));
      return;
    }

    if (method === "GET" && pathname === "/api/admin/volunteers/coverage") {
      if (!(await requirePermission(request, response, "volunteers:read"))) return;
      const mirror = await readVolunteerMirror();
      const payload = volunteerDashboardPayload(mirror);
      sendJson(request, response, 200, {
        lastUpdated: payload.lastUpdated,
        source: payload.source,
        summary: payload.summary,
        coverage: payload.coverage,
        understaffed: payload.summary.understaffed
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/consent") {
      if (!(await requirePermission(request, response, "consent:read"))) return;
      const ledger = await readConsentLedger();
      const summary = summarizeConsent(ledger.records, {
        eventId: ledger.eventId,
        generatedAt: ledger.lastUpdated
      });
      const sms = smsConfigFromEnv(process.env);
      sendJson(request, response, 200, {
        lastUpdated: ledger.lastUpdated,
        summary,
        sms: {
          enabled: sms.enabled,
          ready: sms.ready,
          reason: sms.reason
        },
        // Do not dump full PII lists to every admin UI load — counts + sample size only.
        recordCount: ledger.records.length,
        safetyRecipientCount: recipientsForChannel(ledger.records, "smsSafety").length,
        marketingEmailCount: recipientsForChannel(ledger.records, "emailMarketing").length,
        marketingSmsCount: recipientsForChannel(ledger.records, "smsMarketing").length
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/passport") {
      if (!(await requirePermission(request, response, "passport:read"))) return;
      const huntDoc = await readPassportHunt();
      const completionDoc = await readPassportCompletions();
      const summary = summarizePassport(huntDoc.checkpoints, completionDoc.completions, huntDoc.hunt, {
        generatedAt: completionDoc.lastUpdated || huntDoc.lastUpdated
      });
      sendJson(request, response, 200, {
        lastUpdated: completionDoc.lastUpdated || huntDoc.lastUpdated,
        hunt: huntDoc.hunt,
        summary,
        checkpoints: huntDoc.checkpoints.map(publicCheckpoint)
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/voting") {
      if (!(await requirePermission(request, response, "voting:read"))) return;
      const doc = await readPeoplesChoice();
      sendJson(request, response, 200, {
        lastUpdated: doc.lastUpdated,
        summary: summarizeVoting(doc.entries, doc.votes, {
          eventId: doc.eventId,
          votingOpen: doc.votingOpen,
          generatedAt: doc.lastUpdated
        }),
        votingOpen: doc.votingOpen,
        title: doc.title
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/booths") {
      if (!(await requirePermission(request, response, "booths:read"))) return;
      const map = await readBoothMap();
      sendJson(request, response, 200, {
        lastUpdated: map.lastUpdated,
        source: map.source,
        summary: summarizeBooths(map.booths, map.vendors),
        booths: enrichBooths(map.booths, map.vendors)
      });
      return;
    }

    if (method === "PATCH" && pathname === "/api/admin/alert") {
      if (!(await requirePermission(request, response, "alert:write"))) return;
      const body = await readBody(request);
      const current = await storage.config.read("emergency-alert");
      const result = sanitizeAlertPatch(body, current);
      if (result.error) {
        sendJson(request, response, 400, { error: result.error });
        return;
      }
      await writeConfigSnapshot(request, { type: "alert", id: current.id || "alert_none" }, current, `Before ${result.alert.active ? "alert publish" : "alert clear"}`);
      await storage.config.write("emergency-alert", result.alert);

      // Optional SMS fan-out for active public alerts.
      // Default enterprise path: enqueue job (worker sends) so publish stays fast.
      let smsResult = null;
      const wantSms = result.alert.active && body.sendSms !== false
        && (Array.isArray(result.alert.audience) ? result.alert.audience.includes("public") : true);
      if (wantSms) {
        const ledger = await readConsentLedger();
        const recipients = recipientsForChannel(ledger.records, "smsSafety");
        const limit = Number(body.smsLimit) || 500;
        if (ASYNC_SMS && body.asyncSms !== false) {
          const job = await enqueueJob(ROOT, {
            type: "sms.alert_fanout",
            payload: {
              alert: result.alert,
              recipientPhones: recipients.map(r => r.phone).filter(Boolean).slice(0, limit),
              limit
            }
          });
          smsResult = {
            queued: true,
            jobId: job.id,
            attempted: recipients.length,
            sent: 0,
            failed: 0,
            skipped: 0,
            reason: "queued_for_worker"
          };
        } else {
          smsResult = await sendAlertSms(result.alert, recipients, { limit });
        }
      }

      await writeAuditRecord(request, result.alert.active ? "alert.publish" : "alert.clear", {
        type: "alert",
        id: result.alert.id
      }, current, result.alert, {
        severity: result.alert.severity,
        sms: smsResult
          ? {
              queued: Boolean(smsResult.queued),
              jobId: smsResult.jobId ?? null,
              attempted: smsResult.attempted,
              sent: smsResult.sent,
              failed: smsResult.failed,
              skipped: smsResult.skipped,
              reason: smsResult.reason
            }
          : null
      });
      sendJson(request, response, 200, { alert: result.alert, sms: smsResult });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/jobs") {
      if (!(await requirePermission(request, response, "admin:read"))) return;
      const { listJobs } = await import("../lib/job-queue.mjs");
      sendJson(request, response, 200, {
        jobs: await listJobs(ROOT, { limit: clampLimit(url.searchParams.get("limit"), 50) })
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/audit") {
      if (!(await requirePermission(request, response, "audit:read"))) return;
      sendJson(request, response, 200, {
        audit: await storage.audit.list(clampLimit(url.searchParams.get("limit")))
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/snapshots") {
      if (!(await requirePermission(request, response, "snapshot:read"))) return;
      sendJson(request, response, 200, {
        snapshots: await storage.snapshots.list(clampLimit(url.searchParams.get("limit")))
      });
      return;
    }

    const snapshotRestoreMatch = pathname.match(/^\/api\/admin\/snapshots\/([^/]+)\/restore$/);
    if (method === "POST" && snapshotRestoreMatch) {
      if (!(await requirePermission(request, response, "config:rollback"))) return;
      const snapshotRef = decodeURIComponent(snapshotRestoreMatch[1]);
      if (snapshotRef.includes("/") || snapshotRef.includes("..")) {
        sendJson(request, response, 400, { error: "Invalid snapshot reference." });
        return;
      }
      const snapshotEnvelope = await storage.snapshots.findByRef(snapshotRef);
      if (!snapshotEnvelope) {
        sendJson(request, response, 404, { error: `Snapshot not found: ${snapshotRef}` });
        return;
      }
      const snapshot = snapshotEnvelope.record;
      const targetKey = snapshotTargetKey(snapshot.target);
      if (!targetKey) {
        sendJson(request, response, 400, { error: `Snapshot target cannot be restored: ${snapshot.target?.type}` });
        return;
      }
      const before = await storage.config.read(targetKey);
      await writeConfigSnapshot(request, snapshot.target, before, `Before restoring snapshot ${snapshot.id}`);
      await storage.config.write(targetKey, snapshot.data);
      await writeAuditRecord(request, "config.rollback", snapshot.target, before, snapshot.data, {
        snapshotId: snapshot.id,
        snapshotRef
      });
      sendJson(request, response, 200, { restored: true, snapshotId: snapshot.id, target: snapshot.target });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/orders") {
      if (!(await requirePermission(request, response, "orders:read"))) return;
      sendJson(request, response, 200, {
        pendingOrders: await storage.orders.list(clampLimit(url.searchParams.get("limit")))
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/payment-events") {
      if (!(await requirePermission(request, response, "payments:read"))) return;
      sendJson(request, response, 200, {
        paymentEvents: await storage.paymentEvents.list(clampLimit(url.searchParams.get("limit")))
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/fulfillment") {
      if (!(await requirePermission(request, response, "fulfillment:read"))) return;
      sendJson(request, response, 200, {
        fulfillment: await storage.fulfillment.list(clampLimit(url.searchParams.get("limit")))
      });
      return;
    }

    const fulfillmentMatch = pathname.match(/^\/api\/admin\/fulfillment\/([^/]+)$/);
    if (method === "PATCH" && fulfillmentMatch) {
      await handleFulfillmentPatch(request, response, decodeURIComponent(fulfillmentMatch[1]));
      return;
    }

    const ticketMatch = pathname.match(/^\/api\/admin\/tickets\/([^/]+)$/);
    if (method === "PATCH" && ticketMatch) {
      await handleAdminTicketPatch(request, response, decodeURIComponent(ticketMatch[1]));
      return;
    }

    const sponsorMatch = pathname.match(/^\/api\/admin\/sponsor-packages\/([^/]+)$/);
    if (method === "PATCH" && sponsorMatch) {
      await handleAdminSponsorPatch(request, response, decodeURIComponent(sponsorMatch[1]));
      return;
    }

    sendJson(request, response, 404, { error: "Route not found." });
  } catch (error) {
    const status = error.statusCode === 413 ? 413 : 500;
    sendJson(request, response, status, { error: error.message });
  }
}

const server = createServer(handleRequest);
// Festival-scale keep-alive / backlog (tune via env on large hosts).
server.keepAliveTimeout = Number(process.env.SANDFEST_KEEPALIVE_MS || 65_000);
server.headersTimeout = Number(process.env.SANDFEST_HEADERS_TIMEOUT_MS || 70_000);
server.maxHeadersCount = 100;

const listenHost = process.env.SANDFEST_API_HOST || "127.0.0.1";
server.listen(PORT, listenHost, () => {
  const dataMode = process.env.SANDFEST_DATABASE_URL ? "postgres+platform" : "file-atomic";
  console.log(`SandFest admin API listening on http://${listenHost}:${PORT} (storage: ${storage.kind}, data: ${dataMode}, auth: ${authMode()})`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}, closing SandFest admin API.`);
  server.close(async () => {
    try {
      await rateLimiter.close?.();
      await storage.close();
    } finally {
      process.exit(0);
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
