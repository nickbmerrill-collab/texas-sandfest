import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createOutreachProspect, normalizePartnerOperations, outreachDistanceMiles } from "./partner-ops.mjs";

export const OUTREACH_DISCOVERY_CATEGORIES = [
  { id: "lodging", label: "Lodging" },
  { id: "food_beverage", label: "Food and beverage" },
  { id: "financial", label: "Banks and financial" },
  { id: "healthcare", label: "Healthcare" },
  { id: "retail", label: "Retail" },
  { id: "professional_services", label: "Professional services" },
  { id: "automotive", label: "Automotive" },
  { id: "arts_entertainment", label: "Arts and entertainment" }
];

export const OUTREACH_DISCOVERY_MAX_RESULTS = 50;
export const OUTREACH_DISCOVERY_MAX_RADIUS_MILES = 50;
export const OUTREACH_DISCOVERY_PREVIEW_TTL_MS = 15 * 60 * 1000;
export const OUTREACH_DISCOVERY_MAX_OVERPASS_ENDPOINTS = 3;

const CATEGORY_IDS = new Set(OUTREACH_DISCOVERY_CATEGORIES.map(item => item.id));
const OSM_ATTRIBUTION = "Business candidates from OpenStreetMap contributors, ODbL.";
const OSM_ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright";
const NOMINATIM_POLICY_URL = "https://operations.osmfoundation.org/policies/nominatim/";
const OVERPASS_QUERY_LINES = {
  lodging: [
    'nwr["tourism"~"^(hotel|guest_house|motel|resort|hostel)$"]["name"]'
  ],
  food_beverage: [
    'nwr["amenity"~"^(restaurant|cafe|bar|fast_food|ice_cream|biergarten)$"]["name"]'
  ],
  financial: [
    'nwr["amenity"~"^(bank|credit_union|bureau_de_change)$"]["name"]'
  ],
  healthcare: [
    'nwr["amenity"~"^(clinic|doctors|dentist|hospital|pharmacy|veterinary)$"]["name"]'
  ],
  retail: [
    'nwr["shop"]["name"]'
  ],
  professional_services: [
    'nwr["office"]["name"]'
  ],
  automotive: [
    'nwr["shop"~"^(car|car_repair|car_parts|tyres|motorcycle|boat)$"]["name"]',
    'nwr["amenity"~"^(car_rental|boat_rental|fuel)$"]["name"]'
  ],
  arts_entertainment: [
    'nwr["amenity"~"^(arts_centre|cinema|theatre|events_venue)$"]["name"]',
    'nwr["tourism"~"^(attraction|gallery|museum|theme_park)$"]["name"]'
  ]
};
const FIXTURE_CENTER = { latitude: 27.8339, longitude: -97.0611, city: "Port Aransas", state: "TX", postalCode: "78373" };
const FIXTURE_CANDIDATES = [
  {
    sourceRef: "fixture/business/seabreeze-resort",
    organizationName: "Seabreeze Resort",
    website: "https://seabreeze-resort.example.com",
    contactEmail: "seabreeze.partnerships@example.com",
    industry: "lodging",
    city: "Port Aransas",
    state: "TX",
    postalCode: "78373",
    latitude: 27.8258,
    longitude: -97.0681
  },
  {
    sourceRef: "fixture/business/island-harbor-bank",
    organizationName: "Island Harbor Bank",
    website: "https://island-harbor-bank.example.com",
    contactEmail: "islandharbor.community@example.com",
    industry: "financial",
    city: "Port Aransas",
    state: "TX",
    postalCode: "78373",
    latitude: 27.8391,
    longitude: -97.0642
  },
  {
    sourceRef: "fixture/business/gulf-coast-coffee",
    organizationName: "Gulf Coast Coffee Roasters",
    website: "https://gulf-coast-coffee.example.com",
    contactEmail: "",
    industry: "food_beverage",
    city: "Corpus Christi",
    state: "TX",
    postalCode: "78418",
    latitude: 27.6924,
    longitude: -97.2878
  },
  {
    sourceRef: "fixture/business/coastal-build-supply",
    organizationName: "Coastal Build Supply",
    website: "https://coastal-build-supply.example.com",
    contactEmail: "coastalbuild.community@example.com",
    industry: "retail",
    city: "Aransas Pass",
    state: "TX",
    postalCode: "78336",
    latitude: 27.9095,
    longitude: -97.1498
  }
];

const geocodeCache = new Map();
let lastNominatimRequestAt = 0;

function text(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function numberValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isOperatorContact(value) {
  const candidate = text(value, 300);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) || isHttpsUrl(candidate);
}

function cleanWebsite(value) {
  const candidate = text(value, 500);
  if (!candidate) return "";
  const normalized = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    const url = new URL(normalized);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

function cleanEmail(value) {
  const candidate = text(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : "";
}

function unique(values) {
  return [...new Set(values)];
}

function endpointList(value) {
  return unique(String(value ?? "")
    .split(/[\s,]+/)
    .map(item => text(item, 500))
    .filter(Boolean))
    .slice(0, OUTREACH_DISCOVERY_MAX_OVERPASS_ENDPOINTS);
}

function endpointHost(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "invalid-endpoint";
  }
}

function compactCandidate(candidate = {}) {
  return {
    sourceRef: text(candidate.sourceRef, 160),
    sourceUrl: text(candidate.sourceUrl, 500),
    sourceLicense: text(candidate.sourceLicense, 160),
    sourceFetchedAt: text(candidate.sourceFetchedAt, 100),
    organizationName: text(candidate.organizationName, 160),
    website: cleanWebsite(candidate.website),
    contactEmail: cleanEmail(candidate.contactEmail),
    industry: text(candidate.industry, 100),
    city: text(candidate.city, 100),
    state: text(candidate.state, 40).toUpperCase(),
    postalCode: text(candidate.postalCode, 20),
    latitude: numberValue(candidate.latitude),
    longitude: numberValue(candidate.longitude),
    distanceMiles: candidate.distanceMiles == null ? null : Math.round(Number(candidate.distanceMiles) * 10) / 10,
    nextAction: text(candidate.nextAction, 300) || (candidate.contactEmail ? "Verify business contact and document contact basis" : "Research business email and decision maker")
  };
}

function inferCategory(tags = {}) {
  const amenity = text(tags.amenity, 100).toLowerCase();
  const tourism = text(tags.tourism, 100).toLowerCase();
  const shop = text(tags.shop, 100).toLowerCase();
  const office = text(tags.office, 100).toLowerCase();
  if (["hotel", "guest_house", "motel", "resort", "hostel"].includes(tourism)) return "lodging";
  if (["restaurant", "cafe", "bar", "fast_food", "ice_cream", "biergarten"].includes(amenity)) return "food_beverage";
  if (["bank", "credit_union", "bureau_de_change"].includes(amenity)) return "financial";
  if (["clinic", "doctors", "dentist", "hospital", "pharmacy", "veterinary"].includes(amenity)) return "healthcare";
  if (["car", "car_repair", "car_parts", "tyres", "motorcycle", "boat"].includes(shop) || ["car_rental", "boat_rental", "fuel"].includes(amenity)) return "automotive";
  if (["arts_centre", "cinema", "theatre", "events_venue"].includes(amenity) || ["attraction", "gallery", "museum", "theme_park"].includes(tourism)) return "arts_entertainment";
  if (office) return "professional_services";
  if (shop) return "retail";
  return "professional_services";
}

function providerReason(config) {
  if (!config.enabled) return "Business discovery is disabled.";
  if (!new Set(["fixture", "openstreetmap"]).has(config.provider)) return "Choose fixture or openstreetmap as the discovery provider.";
  if (config.provider === "fixture" && config.production) return "The synthetic discovery provider is not allowed in production.";
  if (config.secret.length < 32) return "OUTREACH_DISCOVERY_SECRET or SANDFEST_PARTNER_PORTAL_SECRET must be at least 32 characters.";
  if (config.provider === "openstreetmap") {
    if (!isHttpsUrl(config.nominatimEndpoint) || !config.overpassEndpoints.length || config.overpassEndpoints.some(endpoint => !isHttpsUrl(endpoint))) {
      return "OpenStreetMap discovery endpoints must use HTTPS.";
    }
    if (!config.userAgent || !isOperatorContact(config.contact)) return "OpenStreetMap discovery requires an identifying User-Agent and operator email or HTTPS contact URL.";
  }
  return null;
}

export function outreachDiscoveryConfig(env = process.env, { production = String(env.SANDFEST_ENV || "").toLowerCase() === "production" } = {}) {
  const enabled = String(env.OUTREACH_DISCOVERY_ENABLED || "").toLowerCase() === "true";
  const provider = text(env.OUTREACH_DISCOVERY_PROVIDER, 40).toLowerCase() || "off";
  const secret = text(env.OUTREACH_DISCOVERY_SECRET || env.SANDFEST_PARTNER_PORTAL_SECRET || (!production ? "sandfest-development-outreach-discovery-secret-change-me" : ""), 500);
  const configuredOverpassEndpoints = endpointList(env.OUTREACH_DISCOVERY_OVERPASS_URLS || env.OUTREACH_DISCOVERY_OVERPASS_URL || "https://overpass-api.de/api/interpreter");
  const config = {
    enabled,
    provider,
    production,
    secret,
    userAgent: text(env.OUTREACH_DISCOVERY_USER_AGENT, 300),
    contact: text(env.OUTREACH_DISCOVERY_CONTACT, 300),
    nominatimEndpoint: text(env.OUTREACH_DISCOVERY_NOMINATIM_URL, 500) || "https://nominatim.openstreetmap.org/search",
    overpassEndpoint: configuredOverpassEndpoints[0] || "",
    overpassEndpoints: configuredOverpassEndpoints,
    requestTimeoutMs: Math.min(30_000, Math.max(2_000, Number(env.OUTREACH_DISCOVERY_TIMEOUT_MS || 10_000)))
  };
  const reason = providerReason(config);
  return { ...config, ready: !reason, reason };
}

export function publicOutreachDiscoveryReadiness(config) {
  return {
    enabled: config.enabled,
    ready: config.ready,
    provider: config.provider,
    reason: config.reason,
    maxResults: OUTREACH_DISCOVERY_MAX_RESULTS,
    maxRadiusMiles: OUTREACH_DISCOVERY_MAX_RADIUS_MILES,
    categories: OUTREACH_DISCOVERY_CATEGORIES,
    attribution: config.provider === "openstreetmap" ? OSM_ATTRIBUTION : "Synthetic board-demonstration businesses.",
    attributionUrl: config.provider === "openstreetmap" ? OSM_ATTRIBUTION_URL : null,
    usagePolicyUrl: config.provider === "openstreetmap" ? NOMINATIM_POLICY_URL : null
  };
}

export function normalizeOutreachDiscoveryQuery(input = {}) {
  const location = text(input.location, 160);
  const latitude = numberValue(input.latitude);
  const longitude = numberValue(input.longitude);
  if ((latitude === null) !== (longitude === null)) return { ok: false, error: "Latitude and longitude must be provided together." };
  if (latitude !== null && (latitude < -90 || latitude > 90)) return { ok: false, error: "Latitude must be between -90 and 90." };
  if (longitude !== null && (longitude < -180 || longitude > 180)) return { ok: false, error: "Longitude must be between -180 and 180." };
  if (latitude === null && location.length < 3) return { ok: false, error: "Enter a location or a latitude/longitude pair." };
  const radiusMiles = numberValue(input.radiusMiles);
  if (radiusMiles === null || radiusMiles < 0.5 || radiusMiles > OUTREACH_DISCOVERY_MAX_RADIUS_MILES) {
    return { ok: false, error: `Radius must be between 0.5 and ${OUTREACH_DISCOVERY_MAX_RADIUS_MILES} miles.` };
  }
  const requestedCategories = unique((Array.isArray(input.categories) ? input.categories : [])
    .map(value => text(value, 100).toLowerCase())
    .filter(Boolean));
  const unknownCategory = requestedCategories.find(value => !CATEGORY_IDS.has(value));
  if (unknownCategory) return { ok: false, error: "Choose only supported business categories." };
  const categories = requestedCategories.filter(value => CATEGORY_IDS.has(value));
  if (!categories.length) return { ok: false, error: "Choose at least one business category." };
  const limit = Math.round(numberValue(input.limit) ?? 20);
  if (limit < 1 || limit > OUTREACH_DISCOVERY_MAX_RESULTS) {
    return { ok: false, error: `Result limit must be between 1 and ${OUTREACH_DISCOVERY_MAX_RESULTS}.` };
  }
  return {
    ok: true,
    query: {
      location,
      latitude,
      longitude,
      radiusMiles: Math.round(radiusMiles * 10) / 10,
      categories,
      limit
    }
  };
}

export function buildOverpassQuery(query) {
  const radiusMeters = Math.round(query.radiusMiles * 1609.344);
  const around = `(around:${radiusMeters},${Number(query.latitude).toFixed(6)},${Number(query.longitude).toFixed(6)});`;
  const lines = query.categories.flatMap(category => OVERPASS_QUERY_LINES[category] || []).map(line => `  ${line}${around}`);
  return `[out:json][timeout:20];\n(\n${lines.join("\n")}\n);\nout tags center ${query.limit};`;
}

export function normalizeOverpassCandidates(payload = {}, query, { now = new Date().toISOString() } = {}) {
  const candidates = [];
  const seen = new Set();
  for (const element of Array.isArray(payload.elements) ? payload.elements : []) {
    const tags = element?.tags && typeof element.tags === "object" ? element.tags : {};
    const sourceType = text(element?.type, 20).toLowerCase();
    const sourceId = text(element?.id, 40);
    if (!["node", "way", "relation"].includes(sourceType) || !/^\d+$/.test(sourceId)) continue;
    const sourceRef = `${sourceType}/${sourceId}`;
    const organizationName = text(tags.name || tags.brand || tags.operator, 160);
    const latitude = numberValue(element?.lat ?? element?.center?.lat);
    const longitude = numberValue(element?.lon ?? element?.center?.lon);
    if (!organizationName || !sourceRef || latitude === null || longitude === null || seen.has(sourceRef)) continue;
    const industry = inferCategory(tags);
    if (!query.categories.includes(industry)) continue;
    const distanceMiles = outreachDistanceMiles(query.latitude, query.longitude, latitude, longitude);
    if (distanceMiles == null || distanceMiles > query.radiusMiles + 0.2) continue;
    seen.add(sourceRef);
    candidates.push(compactCandidate({
      sourceRef,
      sourceUrl: `https://www.openstreetmap.org/${sourceRef}`,
      sourceLicense: "OpenStreetMap contributors, ODbL",
      sourceFetchedAt: now,
      organizationName,
      website: tags["contact:website"] || tags.website || tags.url,
      contactEmail: tags["contact:email"] || tags.email,
      industry,
      city: tags["addr:city"] || query.city || "",
      state: tags["addr:state"] || query.state || "",
      postalCode: tags["addr:postcode"] || query.postalCode || "",
      latitude,
      longitude,
      distanceMiles
    }));
  }
  return candidates
    .sort((a, b) => (a.distanceMiles ?? Number.POSITIVE_INFINITY) - (b.distanceMiles ?? Number.POSITIVE_INFINITY) || a.organizationName.localeCompare(b.organizationName))
    .slice(0, query.limit);
}

async function fetchJson(url, options, { fetchImpl, timeoutMs, maxBytes = 2_000_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`Discovery provider returned HTTP ${response.status}.`);
      error.status = response.status;
      error.retryable = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
      throw error;
    }
    const declaredBytes = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) throw new Error("Discovery provider response exceeded the safety limit.");
    const chunks = [];
    let totalBytes = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Business discovery provider returned no response body.");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        controller.abort();
        throw new Error("Discovery provider response exceeded the safety limit.");
      }
      chunks.push(Buffer.from(value));
    }
    const body = Buffer.concat(chunks, totalBytes);
    return JSON.parse(body.toString("utf8"));
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Business discovery provider timed out.");
      timeoutError.retryable = true;
      throw timeoutError;
    }
    if (error instanceof SyntaxError) {
      const syntaxError = new Error("Business discovery provider returned invalid JSON.");
      syntaxError.retryable = true;
      throw syntaxError;
    }
    if (error?.retryable === undefined && error instanceof TypeError) error.retryable = true;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOverpass(query, config, fetchImpl) {
  const overpassQuery = buildOverpassQuery(query);
  const failures = [];
  for (const endpoint of config.overpassEndpoints) {
    try {
      const payload = await fetchJson(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": `${config.userAgent} (${config.contact})`,
          "x-sandfest-operator-contact": config.contact
        },
        body: new URLSearchParams({ data: overpassQuery }).toString()
      }, { fetchImpl, timeoutMs: config.requestTimeoutMs });
      return {
        payload,
        endpointHost: endpointHost(endpoint),
        attemptCount: failures.length + 1,
        failedEndpointHosts: failures.map(item => item.endpointHost)
      };
    } catch (error) {
      failures.push({
        endpointHost: endpointHost(endpoint),
        message: text(error?.message || "Provider request failed.", 160)
      });
      if (!error?.retryable) throw error;
    }
  }
  const detail = failures.map(item => `${item.endpointHost}: ${item.message}`).join("; ");
  const error = new Error(`All configured Overpass endpoints failed. ${detail}`.slice(0, 600));
  error.retryable = true;
  error.failures = failures;
  throw error;
}

async function geocodeLocation(query, config, fetchImpl) {
  if (query.latitude !== null) return query;
  const cacheKey = query.location.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...query, ...cached.value };
  const waitMs = Math.max(0, 1_000 - (Date.now() - lastNominatimRequestAt));
  if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
  lastNominatimRequestAt = Date.now();
  const url = new URL(config.nominatimEndpoint);
  url.searchParams.set("q", query.location);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("addressdetails", "1");
  if (config.contact.includes("@")) url.searchParams.set("email", config.contact);
  const payload = await fetchJson(url, {
    headers: {
      accept: "application/json",
      "user-agent": `${config.userAgent} (${config.contact})`,
      "x-sandfest-operator-contact": config.contact
    }
  }, { fetchImpl, timeoutMs: config.requestTimeoutMs, maxBytes: 250_000 });
  const match = Array.isArray(payload) ? payload[0] : null;
  const latitude = numberValue(match?.lat);
  const longitude = numberValue(match?.lon);
  if (latitude === null || longitude === null) throw new Error("Location could not be resolved. Enter coordinates or use a more specific U.S. location.");
  const address = match.address || {};
  const value = {
    latitude,
    longitude,
    resolvedLocation: text(match.display_name, 300),
    city: text(address.city || address.town || address.village || address.municipality, 100),
    state: text(address.state, 40),
    postalCode: text(address.postcode, 20)
  };
  geocodeCache.set(cacheKey, { value, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  return { ...query, ...value };
}

function fixtureDiscovery(query, now) {
  const center = query.latitude === null ? FIXTURE_CENTER : { latitude: query.latitude, longitude: query.longitude };
  const resolved = { ...query, ...center, resolvedLocation: query.latitude === null ? "Synthetic Port Aransas fixture" : "Selected coordinates" };
  const candidates = FIXTURE_CANDIDATES
    .filter(candidate => query.categories.includes(candidate.industry))
    .map(candidate => compactCandidate({
      ...candidate,
      sourceUrl: "https://example.com/synthetic-board-business",
      sourceLicense: "Synthetic board demonstration",
      sourceFetchedAt: now,
      distanceMiles: outreachDistanceMiles(resolved.latitude, resolved.longitude, candidate.latitude, candidate.longitude)
    }))
    .filter(candidate => candidate.distanceMiles <= query.radiusMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, query.limit);
  return { query: resolved, candidates };
}

export async function discoverOutreachBusinesses(input, { config, fetchImpl = globalThis.fetch, now = new Date().toISOString() } = {}) {
  if (!config?.ready) return { ok: false, error: config?.reason || "Business discovery is unavailable." };
  const normalized = normalizeOutreachDiscoveryQuery(input);
  if (!normalized.ok) return normalized;
  if (config.provider === "fixture") return { ok: true, ...fixtureDiscovery(normalized.query, now) };
  const query = await geocodeLocation(normalized.query, config, fetchImpl);
  const overpass = await fetchOverpass(query, config, fetchImpl);
  return {
    ok: true,
    query,
    candidates: normalizeOverpassCandidates(overpass.payload, query, { now }),
    provider: {
      endpointHost: overpass.endpointHost,
      attemptCount: overpass.attemptCount,
      failedEndpointHosts: overpass.failedEndpointHosts
    }
  };
}

function signatureFor(encoded, secret) {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

export function issueOutreachDiscoveryPreview(discovery, { config, now = Date.now(), ttlMs = OUTREACH_DISCOVERY_PREVIEW_TTL_MS } = {}) {
  if (!config?.ready || !discovery?.ok) return { ok: false, error: discovery?.error || config?.reason || "Discovery preview is unavailable." };
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttlMs).toISOString();
  const payload = {
    version: 1,
    provider: config.provider,
    issuedAt,
    expiresAt,
    query: discovery.query,
    candidates: discovery.candidates.map(compactCandidate)
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    ok: true,
    previewToken: `od1.${encoded}.${signatureFor(encoded, config.secret)}`,
    expiresAt,
    payload
  };
}

export function verifyOutreachDiscoveryPreview(token, { config, now = Date.now() } = {}) {
  const candidate = text(token, 250_000);
  const parts = candidate.split(".");
  if (!config?.ready || parts.length !== 3 || parts[0] !== "od1") return { ok: false, error: "Discovery preview is invalid. Run the search again." };
  const expected = Buffer.from(signatureFor(parts[1], config.secret));
  const supplied = Buffer.from(parts[2]);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return { ok: false, error: "Discovery preview is invalid. Run the search again." };
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (payload.version !== 1 || payload.provider !== config.provider || !Array.isArray(payload.candidates)) throw new Error("invalid payload");
    if (!Number.isFinite(new Date(payload.expiresAt).getTime()) || new Date(payload.expiresAt).getTime() <= now) {
      return { ok: false, expired: true, error: "Discovery preview expired. Run the search again." };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, error: "Discovery preview is invalid. Run the search again." };
  }
}

export function applyOutreachDiscoveryImport(docInput, previewPayload, selectedSourceRefs, options = {}) {
  if (!previewPayload || !Array.isArray(previewPayload.candidates)) return { ok: false, error: "Discovery preview is invalid." };
  const selected = unique((Array.isArray(selectedSourceRefs) ? selectedSourceRefs : []).map(value => text(value, 160)).filter(Boolean));
  if (!selected.length) return { ok: false, error: "Select at least one business to import." };
  if (selected.length > OUTREACH_DISCOVERY_MAX_RESULTS) return { ok: false, error: "Too many businesses were selected." };
  const candidates = new Map(previewPayload.candidates.map(candidate => [candidate.sourceRef, compactCandidate(candidate)]));
  if (selected.some(sourceRef => !candidates.has(sourceRef))) return { ok: false, error: "A selected business is not part of this discovery preview." };
  let doc = normalizePartnerOperations(docInput);
  const created = [];
  const duplicates = [];
  const errors = [];
  const batchId = options.batchId || `outreach_discovery_${randomUUID()}`;
  for (const sourceRef of selected) {
    const candidate = candidates.get(sourceRef);
    const result = createOutreachProspect(doc, {
      organizationName: candidate.organizationName,
      website: candidate.website,
      industry: candidate.industry,
      city: candidate.city,
      state: candidate.state,
      postalCode: candidate.postalCode,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      contactEmail: candidate.contactEmail,
      status: "identified",
      contactBasis: null,
      communityFit: false,
      nextAction: candidate.nextAction,
      tags: ["business_discovery", candidate.industry],
      source: previewPayload.provider === "fixture" ? "board_demo_discovery" : "openstreetmap",
      sourceBatch: batchId,
      sourceRef: candidate.sourceRef,
      sourceUrl: candidate.sourceUrl,
      sourceLicense: candidate.sourceLicense,
      sourceFetchedAt: candidate.sourceFetchedAt
    }, options);
    if (result.ok) {
      doc = result.doc;
      created.push(result.prospect);
    } else if (result.duplicate) {
      duplicates.push({ sourceRef, organizationName: candidate.organizationName, existingProspectId: result.existingProspect?.id || null });
    } else {
      errors.push({ sourceRef, organizationName: candidate.organizationName, error: result.error || "Business could not be imported." });
    }
  }
  return {
    ok: true,
    changed: created.length > 0,
    doc,
    batchId,
    created,
    duplicates,
    errors,
    summary: {
      selected: selected.length,
      imported: created.length,
      duplicates: duplicates.length,
      invalid: errors.length,
      contactResearchRequired: created.filter(item => !item.contactEmail || !item.contactBasis).length
    }
  };
}
