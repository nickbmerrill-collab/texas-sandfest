// Fleet / equipment checkout — Phase 1 native build from
// docs/research/04-fleet-asset-tracking.md and the canonical shapes in
// data/schemas/platform-objects.json (asset, assetCheckout, assetLocation).
//
// Pure module (no I/O): normalize records, summarize ops KPIs, and apply
// check-out / check-in transitions. The admin API owns the seed file and
// persistence; iOS scans cart QR payloads (tsf:asset:<id>) into the same flow.

export const ASSET_TYPES = [
  "golf_cart",
  "utv",
  "generator",
  "truck",
  "equipment",
  "atv"
];

export const ASSET_STATUSES = [
  "available",
  "checked_out",
  "maintenance",
  "retired"
];

export const ASSET_CONDITIONS = ["excellent", "good", "fair", "poor", "damaged"];

export const ASSET_OWNERS = ["owned", "rental"];

export const CHECKOUT_METHODS = ["ios_scan", "kiosk", "manual"];

export const LOCATION_SOURCES = ["gps_tracker", "manual", "lorawan", "airtag"];

// QR payloads printed on carts/equipment. Accepts "tsf:asset:cart-07" or a bare id.
export function parseAssetQrPayload(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const prefixed = value.match(/^tsf:asset:([a-z0-9._-]+)$/i);
  if (prefixed) return prefixed[1];
  if (/^[a-z0-9._-]+$/i.test(value) && value.length <= 64) return value;
  return null;
}

export function assetQrPayload(assetId) {
  return `tsf:asset:${assetId}`;
}

function clampPct(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toCents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function normalizeAsset(raw = {}) {
  const type = ASSET_TYPES.includes(raw.type) ? raw.type : "equipment";
  const status = ASSET_STATUSES.includes(raw.status) ? raw.status : "available";
  const condition = ASSET_CONDITIONS.includes(raw.condition) ? raw.condition : "good";
  const owner = ASSET_OWNERS.includes(raw.owner) ? raw.owner : "owned";
  return {
    id: raw.id ?? null,
    eventId: raw.eventId ?? "texas-sandfest-2026",
    type,
    label: String(raw.label ?? raw.id ?? "Asset").trim().slice(0, 80),
    identifier: raw.identifier == null ? null : String(raw.identifier).trim().slice(0, 80),
    owner,
    rentalVendor: raw.rentalVendor == null ? null : String(raw.rentalVendor).trim().slice(0, 80),
    rentalCostCents: raw.rentalCostCents == null ? null : toCents(raw.rentalCostCents),
    quickBooksBillId: raw.quickBooksBillId ?? null,
    capacity: raw.capacity == null ? null : Number(raw.capacity) || null,
    powerType: raw.powerType == null ? null : String(raw.powerType).trim().slice(0, 40),
    gpsTrackerId: raw.gpsTrackerId ?? null,
    condition,
    status,
    homeZoneId: raw.homeZoneId ?? null
  };
}

export function normalizeCheckout(raw = {}) {
  const method = CHECKOUT_METHODS.includes(raw.method) ? raw.method : "manual";
  const startCondition = ASSET_CONDITIONS.includes(raw.startCondition) ? raw.startCondition : "good";
  const endCondition = ASSET_CONDITIONS.includes(raw.endCondition) ? raw.endCondition : null;
  return {
    id: raw.id ?? null,
    assetId: raw.assetId ?? null,
    eventId: raw.eventId ?? "texas-sandfest-2026",
    checkedOutTo: String(raw.checkedOutTo ?? "").trim().slice(0, 120),
    team: String(raw.team ?? "").trim().slice(0, 80),
    checkOutAt: raw.checkOutAt ?? null,
    checkInAt: raw.checkInAt ?? null,
    startCondition,
    endCondition,
    startChargePct: clampPct(raw.startChargePct),
    endChargePct: clampPct(raw.endChargePct),
    damageReport: raw.damageReport == null || raw.damageReport === ""
      ? null
      : String(raw.damageReport).trim().slice(0, 1000),
    signatureBy: raw.signatureBy == null ? null : String(raw.signatureBy).trim().slice(0, 80),
    method
  };
}

export function normalizeLocation(raw = {}) {
  const source = LOCATION_SOURCES.includes(raw.source) ? raw.source : "manual";
  const lat = raw.lat == null ? null : Number(raw.lat);
  const lng = raw.lng == null ? null : Number(raw.lng);
  return {
    id: raw.id ?? null,
    assetId: raw.assetId ?? null,
    at: raw.at ?? null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    beachMarker: raw.beachMarker == null ? null : String(raw.beachMarker).trim().slice(0, 40),
    source
  };
}

export function isOpenCheckout(checkout) {
  return Boolean(checkout && checkout.checkOutAt && !checkout.checkInAt);
}

// Latest open checkout per assetId (if any).
export function activeCheckoutsByAsset(checkouts = []) {
  const map = new Map();
  for (const raw of checkouts) {
    const checkout = normalizeCheckout(raw);
    if (!checkout.assetId || !isOpenCheckout(checkout)) continue;
    const existing = map.get(checkout.assetId);
    if (!existing || String(checkout.checkOutAt) > String(existing.checkOutAt)) {
      map.set(checkout.assetId, checkout);
    }
  }
  return map;
}

// Latest location ping per assetId.
export function latestLocationsByAsset(locations = []) {
  const map = new Map();
  for (const raw of locations) {
    const loc = normalizeLocation(raw);
    if (!loc.assetId) continue;
    const existing = map.get(loc.assetId);
    if (!existing || String(loc.at) > String(existing.at)) {
      map.set(loc.assetId, loc);
    }
  }
  return map;
}

export function summarizeFleet(rawAssets = [], rawCheckouts = [], rawLocations = [], opts = {}) {
  const assets = rawAssets.map(normalizeAsset);
  const checkouts = rawCheckouts.map(normalizeCheckout);
  const locations = rawLocations.map(normalizeLocation);
  const active = activeCheckoutsByAsset(checkouts);
  const latestLoc = latestLocationsByAsset(locations);

  const byStatus = {};
  const byType = {};
  for (const status of ASSET_STATUSES) byStatus[status] = 0;
  for (const type of ASSET_TYPES) byType[type] = 0;

  let rentalCostCents = 0;
  let withTracker = 0;
  let withLiveLocation = 0;
  let openWithDamage = 0;

  for (const asset of assets) {
    byStatus[asset.status] = (byStatus[asset.status] ?? 0) + 1;
    byType[asset.type] = (byType[asset.type] ?? 0) + 1;
    if (asset.rentalCostCents != null) rentalCostCents += asset.rentalCostCents;
    if (asset.gpsTrackerId) withTracker += 1;
    if (latestLoc.has(asset.id)) withLiveLocation += 1;
  }

  const openCheckouts = [...active.values()];
  for (const checkout of openCheckouts) {
    if (checkout.damageReport) openWithDamage += 1;
  }

  const closedWithDamage = checkouts.filter(
    c => c.checkInAt && c.damageReport
  ).length;

  return {
    eventId: opts.eventId || "texas-sandfest-2026",
    generatedAt: opts.generatedAt || null,
    totals: {
      assets: assets.length,
      available: byStatus.available ?? 0,
      checkedOut: byStatus.checked_out ?? openCheckouts.length,
      maintenance: byStatus.maintenance ?? 0,
      openCheckouts: openCheckouts.length,
      withTracker,
      withLiveLocation,
      rentalCostCents,
      damageReports: closedWithDamage + openWithDamage
    },
    byStatus,
    byType,
    teams: tallyTeams(openCheckouts)
  };
}

function tallyTeams(openCheckouts) {
  const teams = {};
  for (const c of openCheckouts) {
    const team = c.team || "unassigned";
    teams[team] = (teams[team] ?? 0) + 1;
  }
  return teams;
}

// Enrich assets for the dashboard: active checkout + last known location.
export function enrichAssets(rawAssets = [], rawCheckouts = [], rawLocations = []) {
  const assets = rawAssets.map(normalizeAsset);
  const active = activeCheckoutsByAsset(rawCheckouts);
  const latestLoc = latestLocationsByAsset(rawLocations);
  return assets.map(asset => ({
    ...asset,
    qrPayload: asset.id ? assetQrPayload(asset.id) : null,
    activeCheckout: active.get(asset.id) ?? null,
    lastLocation: latestLoc.get(asset.id) ?? null
  }));
}

/**
 * Apply a check-out. Returns { ok, error, asset, checkout, assets, checkouts }
 * with updated arrays (immutable-style: new arrays, mutated status on the asset copy).
 */
export function applyCheckout(state, input = {}, { idFactory, now } = {}) {
  const assets = (state.assets || []).map(normalizeAsset);
  const checkouts = (state.checkouts || []).map(normalizeCheckout);
  const assetId = String(input.assetId ?? "").trim();
  if (!assetId) return { ok: false, error: "assetId is required." };

  const index = assets.findIndex(a => a.id === assetId);
  if (index === -1) return { ok: false, error: `Asset not found: ${assetId}` };

  const asset = assets[index];
  if (asset.status === "retired") {
    return { ok: false, error: `Asset ${assetId} is retired and cannot be checked out.` };
  }
  if (asset.status === "maintenance") {
    return { ok: false, error: `Asset ${assetId} is in maintenance.` };
  }

  const active = activeCheckoutsByAsset(checkouts);
  if (active.has(assetId) || asset.status === "checked_out") {
    return { ok: false, error: `Asset ${assetId} is already checked out.` };
  }

  const checkedOutTo = String(input.checkedOutTo ?? "").trim();
  if (!checkedOutTo) return { ok: false, error: "checkedOutTo is required." };

  const timestamp = now || new Date().toISOString();
  const checkout = normalizeCheckout({
    id: input.id || (idFactory ? idFactory() : `co_${Date.now()}`),
    assetId,
    eventId: asset.eventId,
    checkedOutTo,
    team: input.team ?? "",
    checkOutAt: timestamp,
    checkInAt: null,
    startCondition: input.startCondition ?? asset.condition,
    endCondition: null,
    startChargePct: input.startChargePct ?? null,
    endChargePct: null,
    damageReport: null,
    signatureBy: input.signatureBy ?? null,
    method: input.method ?? "manual"
  });

  const nextAsset = { ...asset, status: "checked_out", condition: checkout.startCondition };
  const nextAssets = assets.slice();
  nextAssets[index] = nextAsset;
  const nextCheckouts = checkouts.concat(checkout);

  return {
    ok: true,
    asset: nextAsset,
    checkout,
    assets: nextAssets,
    checkouts: nextCheckouts
  };
}

/**
 * Apply a check-in by assetId or checkoutId.
 */
export function applyCheckin(state, input = {}, { now } = {}) {
  const assets = (state.assets || []).map(normalizeAsset);
  const checkouts = (state.checkouts || []).map(normalizeCheckout);

  let checkoutIndex = -1;
  if (input.checkoutId) {
    checkoutIndex = checkouts.findIndex(c => c.id === input.checkoutId);
  } else if (input.assetId) {
    const active = activeCheckoutsByAsset(checkouts);
    const open = active.get(String(input.assetId).trim());
    if (open) checkoutIndex = checkouts.findIndex(c => c.id === open.id);
  }

  if (checkoutIndex === -1) {
    return { ok: false, error: "No open checkout found for the given assetId/checkoutId." };
  }

  const existing = checkouts[checkoutIndex];
  if (existing.checkInAt) {
    return { ok: false, error: `Checkout ${existing.id} is already closed.` };
  }

  const timestamp = now || new Date().toISOString();
  const endCondition = ASSET_CONDITIONS.includes(input.endCondition)
    ? input.endCondition
    : existing.startCondition;

  const closed = normalizeCheckout({
    ...existing,
    checkInAt: timestamp,
    endCondition,
    endChargePct: input.endChargePct ?? null,
    damageReport: input.damageReport ?? null,
    signatureBy: input.signatureBy ?? existing.signatureBy,
    method: input.method ?? existing.method
  });

  const nextCheckouts = checkouts.slice();
  nextCheckouts[checkoutIndex] = closed;

  const assetIndex = assets.findIndex(a => a.id === existing.assetId);
  let nextAsset = null;
  const nextAssets = assets.slice();
  if (assetIndex !== -1) {
    const status = endCondition === "damaged" ? "maintenance" : "available";
    nextAsset = {
      ...assets[assetIndex],
      status,
      condition: endCondition
    };
    nextAssets[assetIndex] = nextAsset;
  }

  return {
    ok: true,
    asset: nextAsset,
    checkout: closed,
    assets: nextAssets,
    checkouts: nextCheckouts
  };
}

export function appendLocation(locations = [], input = {}, { idFactory, now } = {}) {
  const assetId = String(input.assetId ?? "").trim();
  if (!assetId) return { ok: false, error: "assetId is required." };

  const loc = normalizeLocation({
    id: input.id || (idFactory ? idFactory() : `loc_${Date.now()}`),
    assetId,
    at: input.at || now || new Date().toISOString(),
    lat: input.lat,
    lng: input.lng,
    beachMarker: input.beachMarker,
    source: input.source
  });

  if (loc.lat == null && loc.lng == null && !loc.beachMarker) {
    return { ok: false, error: "Provide lat/lng and/or beachMarker." };
  }

  return {
    ok: true,
    location: loc,
    locations: (locations || []).map(normalizeLocation).concat(loc)
  };
}
