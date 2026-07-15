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
    eventId: raw.eventId ?? "texas-sandfest-2026",
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
    publicLabel: raw.publicLabel == null ? null : String(raw.publicLabel).trim().slice(0, 80)
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
    eventId: raw.eventId ?? "texas-sandfest-2026",
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
    public: raw.public !== false
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

/** Parse a simple Eventeny-style booth CSV (header row). */
export function parseBoothCsv(text = "") {
  const lines = String(text).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { booths: [], vendors: [] };
  const headers = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const booths = [];
  const vendors = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row = Object.fromEntries(headers.map((h, idx) => [h, cols[idx] ?? ""]));
    const boothId = row.booth_id || row.boothid || row.booth || row.id;
    const business = row.business_name || row.business || row.vendor || row.name;
    if (!boothId && !business) continue;

    const id = boothId || `B-${i}`;
    const vendorId = row.vendor_id || row.application_id || `vend_${id}`;
    booths.push(normalizeBooth({
      id,
      label: id,
      type: (row.type || "vendor").toLowerCase(),
      zoneId: row.zone || row.zone_id || "vendor-row",
      sizeFt: row.size || row.size_ft || null,
      utilities: row.utilities ? row.utilities.split(/[|;]/).map(s => s.trim()) : [],
      status: row.booth_status || (business ? "assigned" : "open"),
      assignedApplicationId: business ? vendorId : null,
      beachMarker: row.beach_marker || row.marker || null,
      lat: row.lat || null,
      lng: row.lng || null,
      illustratedMapXY: {
        x: row.map_x || row.x || null,
        y: row.map_y || row.y || null
      },
      publicLabel: business || null
    }));

    if (business) {
      vendors.push(normalizeVendor({
        id: vendorId,
        businessName: business,
        category: row.category || "general",
        status: row.status || "approved",
        boothId: id,
        boothFeeCents: row.booth_fee_cents || row.fee || null,
        eventenyId: row.eventeny_id || null,
        description: row.description || "",
        documents: [
          { type: "certificate_of_insurance", status: row.coi_status || "approved" },
          { type: "health_permit", status: row.health_status || (row.category === "food" ? "pending" : "approved") }
        ],
        public: row.public !== "false"
      }));
    }
  }

  return { booths, vendors };
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
