// Public booth / vendor map — Phase 1 native build from
// docs/research/02-sponsor-vendor-mapping.md.
//
// Eventeny owns vendor apps; we mirror booth assignments (CSV today, API later)
// into a public map feed. Pure module: normalize booths + vendors, filter public
// pins, summarize ops readiness (COI, power, assignment).

export const BOOTH_TYPES = ["vendor", "sponsor", "food", "nonprofit", "ops", "activity"];
export const BOOTH_STATUSES = ["open", "assigned", "checked_in", "closed", "cancelled"];
export const VENDOR_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "docs_needed",
  "paid",
  "checked_in",
  "rejected",
  "withdrawn"
];
export const DOC_STATUSES = ["missing", "pending", "approved", "expired", "rejected"];
const PUBLIC_VENDOR_STATUSES = new Set(["approved", "paid", "checked_in"]);

export function normalizeBooth(raw = {}) {
  const type = BOOTH_TYPES.includes(raw.type) ? raw.type : "vendor";
  const status = BOOTH_STATUSES.includes(raw.status) ? raw.status : "open";
  const utilities = Array.isArray(raw.utilities)
    ? raw.utilities.map(u => String(u).trim()).filter(Boolean)
    : [];
  const x = raw.illustratedMapXY?.x ?? raw.mapX;
  const y = raw.illustratedMapXY?.y ?? raw.mapY;
  return {
    id: raw.id ?? null,
    externalId: raw.externalId ?? null,
    eventId: raw.eventId ?? DEFAULT_EVENT_ID,
    zoneId: raw.zoneId ?? "vendor-row",
    type,
    label: String(raw.label ?? raw.id ?? "Booth").trim().slice(0, 40),
    sizeFt: raw.sizeFt == null ? null : String(raw.sizeFt).trim().slice(0, 20),
    utilities,
    assignedApplicationId: raw.assignedApplicationId ?? null,
    mapMarkerId: raw.mapMarkerId ?? null,
    status,
    beachMarker: raw.beachMarker == null ? null : String(raw.beachMarker),
    lat: raw.lat == null ? null : Number(raw.lat),
    lng: raw.lng == null ? null : Number(raw.lng),
    illustratedMapXY:
      Number.isFinite(Number(x)) && Number.isFinite(Number(y))
        ? { x: Number(x), y: Number(y) }
        : null,
    publicLabel: raw.publicLabel == null ? null : String(raw.publicLabel).trim().slice(0, 80),
    source: raw.source == null ? null : String(raw.source).trim().slice(0, 80),
    sourceBatch: raw.sourceBatch == null ? null : String(raw.sourceBatch).trim().slice(0, 200),
    sourceRow: raw.sourceRow == null || !Number.isFinite(Number(raw.sourceRow)) ? null : Math.max(1, Math.round(Number(raw.sourceRow))),
    sourceUpdatedAt: raw.sourceUpdatedAt ?? null
  };
}

export function normalizeVendor(raw = {}) {
  const status = VENDOR_STATUSES.includes(raw.status) ? raw.status : "submitted";
  const documents = Array.isArray(raw.documents)
    ? raw.documents.map(d => ({
        type: String(d.type || "document"),
        status: DOC_STATUSES.includes(d.status) ? d.status : "missing",
        expiresAt: d.expiresAt ?? null
      }))
    : [];
  return {
    id: raw.id ?? null,
    externalId: raw.externalId ?? null,
    eventId: raw.eventId ?? DEFAULT_EVENT_ID,
    businessName: String(raw.businessName ?? "").trim().slice(0, 120),
    category: String(raw.category ?? "general").trim().slice(0, 40),
    status,
    boothId: raw.boothId ?? null,
    boothFeeCents: raw.boothFeeCents == null && raw.boothFee == null
      ? null
      : Math.round(Number(raw.boothFeeCents ?? raw.boothFee) || 0),
    eventenyId: raw.eventenyId ?? null,
    documents,
    description: raw.description == null ? "" : String(raw.description).trim().slice(0, 400),
    public: raw.public !== false,
    source: raw.source == null ? null : String(raw.source).trim().slice(0, 80),
    sourceBatch: raw.sourceBatch == null ? null : String(raw.sourceBatch).trim().slice(0, 200),
    sourceRow: raw.sourceRow == null || !Number.isFinite(Number(raw.sourceRow)) ? null : Math.max(1, Math.round(Number(raw.sourceRow))),
    sourceUpdatedAt: raw.sourceUpdatedAt ?? null,
    createdAt: raw.createdAt ?? null
  };
}

export function enrichBooths(booths = [], vendors = []) {
  const vendorById = new Map(vendors.map(normalizeVendor).map(v => [v.id, v]));
  const vendorByBooth = new Map(
    vendors.map(normalizeVendor).filter(v => v.boothId).map(v => [v.boothId, v])
  );

  return booths.map(normalizeBooth).map(booth => {
    const vendor =
      (booth.assignedApplicationId && vendorById.get(booth.assignedApplicationId)) ||
      vendorByBooth.get(booth.id) ||
      null;
    return {
      ...booth,
      vendor: vendor
        ? {
            id: vendor.id,
            businessName: vendor.businessName,
            category: vendor.category,
            status: vendor.status,
            description: vendor.description,
            public: vendor.public
          }
        : null,
      displayName: booth.publicLabel || vendor?.businessName || booth.label,
      docsReady: vendor ? vendor.documents.every(d => d.status === "approved") : null
    };
  });
}

/** Public map pins — only assigned booths with public vendors (or empty open booths if showOpen). */
export function publicBoothPins(booths = [], vendors = [], opts = {}) {
  const enriched = enrichBooths(booths, vendors);
  return enriched
    .filter(b => {
      if (b.status === "cancelled" || b.status === "closed") return false;
      if (b.vendor && b.vendor.public === false) return false;
      if (b.vendor && !PUBLIC_VENDOR_STATUSES.has(b.vendor.status)) return false;
      if (!b.vendor && !opts.showOpen) return false;
      return Boolean(b.illustratedMapXY || (b.lat != null && b.lng != null) || b.beachMarker);
    })
    .map(b => ({
      id: b.id,
      label: b.displayName,
      type: b.type,
      category: b.vendor?.category || b.type,
      zoneId: b.zoneId,
      beachMarker: b.beachMarker,
      status: b.status,
      illustratedMapXY: b.illustratedMapXY,
      lat: b.lat,
      lng: b.lng,
      description: b.vendor?.description || "",
      utilities: b.utilities
    }));
}

export function summarizeBooths(booths = [], vendors = []) {
  const b = booths.map(normalizeBooth);
  const v = vendors.map(normalizeVendor);
  const assigned = b.filter(x => x.status === "assigned" || x.status === "checked_in").length;
  const open = b.filter(x => x.status === "open").length;
  const docsNeeded = v.filter(x =>
    x.documents.some(d => d.status === "missing" || d.status === "pending" || d.status === "expired")
  ).length;
  const byCategory = {};
  for (const vendor of v) {
    byCategory[vendor.category] = (byCategory[vendor.category] || 0) + 1;
  }
  const byZone = {};
  for (const booth of b) {
    byZone[booth.zoneId] = (byZone[booth.zoneId] || 0) + 1;
  }
  return {
    totals: {
      booths: b.length,
      assigned,
      open,
      vendors: v.length,
      docsNeeded,
      publicPins: publicBoothPins(b, v).length
    },
    byCategory,
    byZone
  };
}

import { DEFAULT_EVENT_ID } from "./event-context.mjs";
