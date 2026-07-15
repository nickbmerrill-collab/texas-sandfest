import { createServer } from "node:http";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../lib/load-env.mjs";
import { createStorage } from "../lib/storage.mjs";
import { authMode, authModeIsJwt, resolveSession } from "../lib/auth.mjs";
import { summarizeLedger } from "../lib/revenue.mjs";
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

await loadDotEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SANDFEST_API_PORT || 8788);
const SANDFEST_ENV = process.env.SANDFEST_ENV || "development";
const RATE_LIMIT_WINDOW_MS = Number(process.env.SANDFEST_RATE_LIMIT_WINDOW_MS || 60_000);
const ADMIN_RATE_LIMIT = Number(process.env.SANDFEST_ADMIN_RATE_LIMIT || 120);
const CHECKOUT_RATE_LIMIT = Number(process.env.SANDFEST_CHECKOUT_RATE_LIMIT || 30);
const PUBLIC_RATE_LIMIT = Number(process.env.SANDFEST_PUBLIC_RATE_LIMIT || 600);
const ADMIN_TOKEN = process.env.SANDFEST_ADMIN_API_TOKEN || "dev-admin-token-change-me";
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
const rateLimitBuckets = new Map();

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

// Phase 0 revenue ledger read. Reads the seeded JSON directly (backend-agnostic)
// until live Stripe/Eventeny/Square feeds write entries. Returns a safe empty
// ledger if the file is absent so the dashboard degrades gracefully.
const REVENUE_LEDGER_PATH = path.join(ROOT, "data", "processed", "revenue-ledger.json");
async function readRevenueLedger() {
  try {
    const ledger = JSON.parse(await readFile(REVENUE_LEDGER_PATH, "utf8"));
    return {
      lastUpdated: ledger.lastUpdated ?? null,
      currency: ledger.currency ?? "usd",
      expectedAttendance: ledger.expectedAttendance ?? null,
      ticketCapacity: ledger.ticketCapacity ?? null,
      entries: Array.isArray(ledger.entries) ? ledger.entries : []
    };
  } catch {
    return { lastUpdated: null, currency: "usd", expectedAttendance: null, ticketCapacity: null, entries: [] };
  }
}

// Phase 1 fleet ledger. Same file-backed pattern as revenue until Postgres
// storage grows a dedicated fleet table. Check-out/in mutations rewrite the
// whole document (small N for a 3-day rental pool).
const FLEET_PATH = path.join(ROOT, "data", "processed", "fleet.json");
async function readFleetLedger() {
  try {
    const ledger = JSON.parse(await readFile(FLEET_PATH, "utf8"));
    return {
      lastUpdated: ledger.lastUpdated ?? null,
      eventId: ledger.eventId ?? "texas-sandfest-2026",
      assets: Array.isArray(ledger.assets) ? ledger.assets.map(normalizeAsset) : [],
      checkouts: Array.isArray(ledger.checkouts) ? ledger.checkouts.map(normalizeCheckout) : [],
      locations: Array.isArray(ledger.locations) ? ledger.locations.map(normalizeLocation) : []
    };
  } catch {
    return {
      lastUpdated: null,
      eventId: "texas-sandfest-2026",
      assets: [],
      checkouts: [],
      locations: []
    };
  }
}

async function writeFleetLedger(ledger) {
  await mkdir(path.dirname(FLEET_PATH), { recursive: true });
  const payload = {
    _note: "Fleet/asset checkout ledger (lib/fleet.mjs). Mutated by admin check-out/in and location pings.",
    lastUpdated: new Date().toISOString(),
    eventId: ledger.eventId ?? "texas-sandfest-2026",
    assets: ledger.assets ?? [],
    checkouts: ledger.checkouts ?? [],
    locations: ledger.locations ?? []
  };
  await writeFile(FLEET_PATH, `${JSON.stringify(payload, null, 2)}\n`);
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
    )
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
  if (pathname.startsWith("/api/admin")) return { name: "admin", limit: ADMIN_RATE_LIMIT };
  if (pathname.startsWith("/api/public")) return { name: "public", limit: PUBLIC_RATE_LIMIT };
  return null;
}

function checkRateLimit(request, response, pathname, method) {
  const profile = rateLimitProfile(pathname, method);
  if (!profile) return true;
  const now = Date.now();
  const key = `${profile.name}:${requestIp(request)}`;
  const current = rateLimitBuckets.get(key);
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  const remaining = Math.max(0, profile.limit - bucket.count);
  response.setHeader("x-ratelimit-limit", String(profile.limit));
  response.setHeader("x-ratelimit-remaining", String(remaining));
  response.setHeader("x-ratelimit-reset", String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count <= profile.limit) return true;
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  sendJson(request, response, 429, {
    error: `Rate limit exceeded for ${profile.name} requests.`,
    retryAfterSeconds: retryAfter
  }, {
    "retry-after": String(retryAfter)
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
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
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

  const orderId = `order_${randomUUID()}`;
  const now = new Date().toISOString();
  const order = {
    id: orderId,
    eventId: "texas-sandfest-2026",
    status: stripeReady() ? "creating_checkout_session" : "checkout_not_configured",
    provider: "stripe",
    lineItems: validation.lines,
    customer: {
      email: body.customer?.email ?? null,
      phone: body.customer?.phone ?? null
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
  if (!checkRateLimit(request, response, pathname, method)) return;

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
      const ledger = await readFleetLedger();
      const before = ledger.assets.find(a => a.id === assetId) ?? null;
      const result = applyCheckout(ledger, {
        ...body,
        assetId,
        signatureBy: body.signatureBy ?? request.adminSession?.id ?? null,
        method: body.method || "ios_scan"
      }, {
        idFactory: () => `co_${randomUUID()}`,
        now: new Date().toISOString()
      });
      if (!result.ok) {
        sendJson(request, response, 400, { error: result.error });
        return;
      }
      const next = await writeFleetLedger({
        eventId: ledger.eventId,
        assets: result.assets,
        checkouts: result.checkouts,
        locations: ledger.locations
      });
      await writeAuditRecord(request, "fleet.checkout", {
        type: "asset",
        id: result.asset.id
      }, before, result.asset, {
        checkoutId: result.checkout.id,
        checkedOutTo: result.checkout.checkedOutTo,
        team: result.checkout.team
      });
      sendJson(request, response, 200, {
        asset: enrichAssets([result.asset], result.checkouts, ledger.locations)[0],
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
      const ledger = await readFleetLedger();
      const before = ledger.assets.find(a => a.id === (assetId || body.assetId)) ?? null;
      const result = applyCheckin(ledger, {
        ...body,
        assetId,
        signatureBy: body.signatureBy ?? request.adminSession?.id ?? null,
        method: body.method || "ios_scan"
      }, {
        now: new Date().toISOString()
      });
      if (!result.ok) {
        sendJson(request, response, 400, { error: result.error });
        return;
      }
      const next = await writeFleetLedger({
        eventId: ledger.eventId,
        assets: result.assets,
        checkouts: result.checkouts,
        locations: ledger.locations
      });
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
          ? enrichAssets([result.asset], result.checkouts, ledger.locations)[0]
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
      const ledger = await readFleetLedger();
      const assetId = String(body.assetId ?? "").trim();
      if (assetId && !ledger.assets.some(a => a.id === assetId)) {
        sendJson(request, response, 404, { error: `Asset not found: ${assetId}` });
        return;
      }
      const result = appendLocation(ledger.locations, body, {
        idFactory: () => `loc_${randomUUID()}`,
        now: new Date().toISOString()
      });
      if (!result.ok) {
        sendJson(request, response, 400, { error: result.error });
        return;
      }
      // Cap location history so the seed file stays small for a 3-day event.
      const capped = result.locations.slice(-500);
      const next = await writeFleetLedger({
        eventId: ledger.eventId,
        assets: ledger.assets,
        checkouts: ledger.checkouts,
        locations: capped
      });
      sendJson(request, response, 200, {
        location: result.location,
        lastUpdated: next.lastUpdated
      });
      return;
    }

    if (method === "PATCH" && pathname === "/api/admin/alert") {
      if (!(await requirePermission(request, response, "alert:write"))) return;
      const current = await storage.config.read("emergency-alert");
      const result = sanitizeAlertPatch(await readBody(request), current);
      if (result.error) {
        sendJson(request, response, 400, { error: result.error });
        return;
      }
      await writeConfigSnapshot(request, { type: "alert", id: current.id || "alert_none" }, current, `Before ${result.alert.active ? "alert publish" : "alert clear"}`);
      await storage.config.write("emergency-alert", result.alert);
      await writeAuditRecord(request, result.alert.active ? "alert.publish" : "alert.clear", {
        type: "alert",
        id: result.alert.id
      }, current, result.alert, {
        severity: result.alert.severity
      });
      sendJson(request, response, 200, { alert: result.alert });
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
    sendJson(request, response, 500, { error: error.message });
  }
}

const server = createServer(handleRequest);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`SandFest admin API listening on http://127.0.0.1:${PORT} (storage: ${storage.kind}, auth: ${authMode()})`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}, closing SandFest admin API.`);
  server.close(async () => {
    try {
      await storage.close();
    } finally {
      process.exit(0);
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
