import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import {
  BOOTH_STATUSES,
  BOOTH_TYPES,
  DOC_STATUSES,
  VENDOR_STATUSES,
  normalizeBooth,
  normalizeVendor
} from "./booths.mjs";

export const EVENTENY_BOOTH_IMPORT_MAX_ROWS = 5_000;
export const EVENTENY_BOOTH_IMPORT_HISTORY_LIMIT = 100;

const HEADERS = aliases({
  booth_id: ["booth_id", "boothid", "booth", "space_id", "space", "id"],
  event_id: ["event_id", "festival_id", "event"],
  vendor_id: ["vendor_id", "application_id", "applicant_id", "exhibitor_id"],
  eventeny_id: ["eventeny_id", "eventeny_application_id", "external_application_id"],
  business_name: ["business_name", "business", "vendor", "organization_name", "exhibitor", "name"],
  category: ["category", "vendor_category", "application_category"],
  type: ["type", "booth_type", "space_type"],
  zone_id: ["zone_id", "zone", "section", "area"],
  size_ft: ["size_ft", "size", "booth_size", "space_size"],
  utilities: ["utilities", "utility", "services", "power_water"],
  booth_status: ["booth_status", "space_status", "assignment_status"],
  vendor_status: ["vendor_status", "application_status", "status"],
  beach_marker: ["beach_marker", "marker", "mile_marker"],
  map_x: ["map_x", "x", "illustrated_map_x"],
  map_y: ["map_y", "y", "illustrated_map_y"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lng", "lon"],
  booth_fee_cents: ["booth_fee_cents", "fee_cents"],
  booth_fee: ["booth_fee", "fee", "amount"],
  description: ["description", "public_description"],
  coi_status: ["coi_status", "insurance_status", "certificate_of_insurance_status"],
  health_status: ["health_status", "health_permit_status", "permit_status"],
  public: ["public", "publish", "public_listing", "show_on_map"],
  source_updated_at: ["source_updated_at", "updated_at", "modified_at", "last_updated"]
});

const BOOTH_STATUS_ALIASES = new Map([
  ["available", "open"], ["unassigned", "open"], ["open", "open"],
  ["assigned", "assigned"], ["reserved", "assigned"], ["occupied", "assigned"],
  ["checked_in", "checked_in"], ["checkedin", "checked_in"],
  ["closed", "closed"], ["cancelled", "cancelled"], ["canceled", "cancelled"]
]);

const VENDOR_STATUS_ALIASES = new Map([
  ...VENDOR_STATUSES.map(status => [status, status]),
  ["accepted", "approved"], ["active", "approved"], ["complete", "approved"],
  ["documents_needed", "docs_needed"], ["needs_documents", "docs_needed"],
  ["canceled", "withdrawn"], ["declined", "rejected"]
]);

const DOC_STATUS_ALIASES = new Map([
  ...DOC_STATUSES.map(status => [status, status]),
  ["complete", "approved"], ["received", "pending"], ["needs_review", "pending"],
  ["not_received", "missing"], ["none", "missing"]
]);

const TYPE_ALIASES = new Map([
  ...BOOTH_TYPES.map(type => [type, type]),
  ["exhibitor", "vendor"], ["merchant", "vendor"], ["marketplace", "vendor"],
  ["food_vendor", "food"], ["food_beverage", "food"], ["community", "nonprofit"]
]);

function clean(value, max = 2_000) {
  return String(value ?? "").trim().slice(0, max);
}

function key(value) {
  return clean(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function aliases(entries) {
  return new Map(Object.entries(entries).flatMap(([canonical, names]) => names.map(name => [name, canonical])));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(name => [name, canonical(value[name])]));
}

function stableVendorId(eventId, externalId) {
  const prefix = key(externalId).slice(0, 48) || "vendor";
  return `eventeny_vendor_${prefix}_${digest(`${eventId}:${externalId}`).slice(0, 8)}`;
}

function parseBoolean(value, label) {
  const candidate = key(value);
  if (!candidate) return { ok: true, value: false };
  if (["1", "true", "yes", "y", "public", "published", "show"].includes(candidate)) return { ok: true, value: true };
  if (["0", "false", "no", "n", "private", "hidden", "do_not_publish"].includes(candidate)) return { ok: true, value: false };
  return { ok: false, error: `${label} must be an explicit yes/no value.` };
}

function parseNumber(value, label, { minimum = null, maximum = null } = {}) {
  const candidate = clean(value, 60);
  if (!candidate) return { ok: true, value: null };
  const parsed = Number(candidate.replace(/[$,]/g, ""));
  if (!Number.isFinite(parsed) || (minimum !== null && parsed < minimum) || (maximum !== null && parsed > maximum)) {
    return { ok: false, error: `${label} is outside the supported range.` };
  }
  return { ok: true, value: parsed };
}

function parseFee(record) {
  const cents = clean(record.booth_fee_cents, 60);
  if (cents) {
    if (!/^\d+$/.test(cents) || Number(cents) > 100_000_000) return { ok: false, error: "Booth fee cents must be a non-negative whole number." };
    return { ok: true, value: Number(cents) };
  }
  const dollars = clean(record.booth_fee, 60);
  if (!dollars) return { ok: true, value: null };
  const normalized = dollars.replace(/[$,]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized) || Number(normalized) > 1_000_000) {
    return { ok: false, error: "Booth fee must be a non-negative dollar amount with no more than two decimals." };
  }
  return { ok: true, value: Math.round(Number(normalized) * 100) };
}

function parseIso(value) {
  const candidate = clean(value, 100);
  if (!candidate) return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(candidate)) {
    return { ok: false, error: "Source updated at must be an ISO 8601 timestamp with a timezone." };
  }
  const parsed = new Date(candidate);
  return Number.isFinite(parsed.getTime()) ? { ok: true, value: parsed.toISOString() } : { ok: false, error: "Source updated at is invalid." };
}

function splitList(value) {
  return [...new Set(clean(value, 4_000).split(/[|;]/).map(item => clean(item, 100)).filter(Boolean))].slice(0, 20);
}

function parseCsv(csv) {
  const source = String(csv ?? "");
  if (!source.trim()) return { ok: false, error: "Choose or paste an Eventeny booth CSV." };
  let rows;
  try {
    rows = parse(source, { bom: true, info: true, max_record_size: 40_000, relax_column_count: false, skip_empty_lines: true, trim: true });
  } catch (error) {
    const line = Number(error?.lines || error?.line || 0);
    return { ok: false, error: `Eventeny booth CSV could not be parsed${line ? ` near line ${line}` : ""}: ${clean(error?.message || error, 500)}` };
  }
  if (rows.length < 2) return { ok: false, error: "Eventeny booth CSV must include a header and at least one row." };
  const headers = rows[0].record.map(value => HEADERS.get(key(value)) || key(value));
  const duplicate = headers.find((header, index) => header && headers.indexOf(header) !== index);
  if (duplicate) return { ok: false, error: `Eventeny booth CSV maps more than one column to ${duplicate}.` };
  if (!headers.includes("booth_id")) return { ok: false, error: "Eventeny booth CSV needs a booth_id column." };
  const records = rows.slice(1).filter(entry => entry.record.some(value => clean(value)));
  if (records.length > EVENTENY_BOOTH_IMPORT_MAX_ROWS) {
    return { ok: false, error: `Eventeny booth CSV has ${records.length} rows; the maximum import is ${EVENTENY_BOOTH_IMPORT_MAX_ROWS}.` };
  }
  return {
    ok: true,
    records: records.map((entry, index) => ({
      rowNumber: Number(entry.info?.lines || index + 2),
      record: Object.fromEntries(headers.map((header, column) => [header, entry.record[column] ?? ""]))
    }))
  };
}

function rowError(row, boothId, error) {
  return { file: "booths", row, boothId: boothId || null, error };
}

export function normalizeEventenyBoothImportDefaults(input = {}) {
  return {
    eventId: clean(input.eventId, 160),
    mirrorFingerprint: clean(input.mirrorFingerprint, 64).toLowerCase()
  };
}

export function eventenyBoothMirrorFingerprint(docInput = {}) {
  const doc = docInput && typeof docInput === "object" ? docInput : {};
  return digest(JSON.stringify(canonical({
    eventId: clean(doc.eventId, 160) || null,
    lastUpdated: doc.lastUpdated || null,
    source: clean(doc.source, 80) || null,
    booths: (Array.isArray(doc.booths) ? doc.booths : []).map(normalizeBooth),
    vendors: (Array.isArray(doc.vendors) ? doc.vendors : []).map(normalizeVendor),
    imports: Array.isArray(doc.imports) ? doc.imports.slice(-EVENTENY_BOOTH_IMPORT_HISTORY_LIMIT) : []
  })));
}

export function eventenyBoothBundleHash(bundle = {}, defaultsInput = {}) {
  const defaults = normalizeEventenyBoothImportDefaults(defaultsInput);
  return digest(JSON.stringify({
    csv: String(bundle.csv ?? "").replace(/\r\n?/g, "\n"),
    eventId: defaults.eventId
  }));
}

export function eventenyBoothImportPreviewHash(bundle = {}, defaultsInput = {}) {
  const defaults = normalizeEventenyBoothImportDefaults(defaultsInput);
  return digest(JSON.stringify({
    bundleHash: eventenyBoothBundleHash(bundle, defaults),
    mirrorFingerprint: defaults.mirrorFingerprint
  }));
}

export function parseEventenyBoothCsv(csv, defaultsInput = {}) {
  const defaults = normalizeEventenyBoothImportDefaults(defaultsInput);
  if (!defaults.eventId) return { ok: false, error: "A current event ID is required for Eventeny booth imports." };
  const source = parseCsv(csv);
  if (!source.ok) return source;
  const rows = [];
  const errors = [];
  const seenBooths = new Set();
  const seenVendors = new Set();

  for (const { rowNumber, record } of source.records) {
    const boothId = clean(record.booth_id, 120);
    const eventId = clean(record.event_id, 160) || defaults.eventId;
    const businessName = clean(record.business_name, 120);
    const vendorExternalId = clean(record.vendor_id || record.eventeny_id, 200);
    const rawBoothStatus = key(record.booth_status);
    const boothStatus = BOOTH_STATUS_ALIASES.get(rawBoothStatus || (businessName ? "assigned" : "open"));
    const rawVendorStatus = key(record.vendor_status);
    const vendorStatus = businessName ? VENDOR_STATUS_ALIASES.get(rawVendorStatus || "approved") : null;
    const rawType = key(record.type);
    const type = TYPE_ALIASES.get(rawType || "vendor");
    const publicListing = parseBoolean(record.public, "Public listing");
    const fee = parseFee(record);
    const mapX = parseNumber(record.map_x, "Map X", { minimum: 0, maximum: 100 });
    const mapY = parseNumber(record.map_y, "Map Y", { minimum: 0, maximum: 100 });
    const latitude = parseNumber(record.latitude, "Latitude", { minimum: -90, maximum: 90 });
    const longitude = parseNumber(record.longitude, "Longitude", { minimum: -180, maximum: 180 });
    const sourceUpdatedAt = parseIso(record.source_updated_at);
    const category = key(record.category) || (type === "food" ? "food" : "general");
    const coiInput = key(record.coi_status);
    const healthInput = key(record.health_status);
    const coiStatus = DOC_STATUS_ALIASES.get(coiInput || "missing");
    const healthStatus = DOC_STATUS_ALIASES.get(healthInput || "missing");
    const rowErrors = [];

    if (!boothId) rowErrors.push("Booth ID is required.");
    if (eventId !== defaults.eventId) rowErrors.push(`Event ${eventId || "(blank)"} does not match ${defaults.eventId}.`);
    if (!boothStatus || !BOOTH_STATUSES.includes(boothStatus)) rowErrors.push("Booth status is not supported.");
    if (!type || !BOOTH_TYPES.includes(type)) rowErrors.push("Booth type is not supported.");
    if (businessName && !vendorExternalId) rowErrors.push("Assigned vendors need a vendor_id, application_id, or Eventeny ID.");
    if (!businessName && vendorExternalId) rowErrors.push("Vendor ID was supplied without a business name.");
    if (businessName && !["assigned", "checked_in"].includes(boothStatus)) rowErrors.push("A booth with a business must be assigned or checked in.");
    if (!businessName && ["assigned", "checked_in"].includes(boothStatus)) rowErrors.push("An assigned booth needs a business name and vendor ID.");
    if (businessName && (!vendorStatus || !VENDOR_STATUSES.includes(vendorStatus))) rowErrors.push("Vendor status is not supported.");
    if (!publicListing.ok) rowErrors.push(publicListing.error);
    if (publicListing.value && !businessName) rowErrors.push("Only an assigned business can be published on the public map.");
    if (publicListing.value && businessName && !["approved", "paid", "checked_in"].includes(vendorStatus)) rowErrors.push("Public vendors must be approved, paid, or checked in.");
    if (!fee.ok) rowErrors.push(fee.error);
    if (!mapX.ok) rowErrors.push(mapX.error);
    if (!mapY.ok) rowErrors.push(mapY.error);
    if ((mapX.value === null) !== (mapY.value === null)) rowErrors.push("Map X and Map Y must be provided together.");
    if (!latitude.ok) rowErrors.push(latitude.error);
    if (!longitude.ok) rowErrors.push(longitude.error);
    if ((latitude.value === null) !== (longitude.value === null)) rowErrors.push("Latitude and longitude must be provided together.");
    if (!sourceUpdatedAt.ok) rowErrors.push(sourceUpdatedAt.error);
    if (coiInput && !coiStatus) rowErrors.push("COI status is not supported.");
    if (healthInput && !healthStatus) rowErrors.push("Health permit status is not supported.");
    const boothKey = boothId.toLowerCase();
    const vendorKey = vendorExternalId.toLowerCase();
    if (boothId && seenBooths.has(boothKey)) rowErrors.push("Booth ID is duplicated in this export.");
    if (vendorExternalId && seenVendors.has(vendorKey)) rowErrors.push("Vendor ID is assigned more than once in this export.");

    if (rowErrors.length) {
      errors.push(rowError(rowNumber, boothId, rowErrors.join(" ")));
      continue;
    }
    seenBooths.add(boothKey);
    if (vendorExternalId) seenVendors.add(vendorKey);
    const vendorId = businessName ? stableVendorId(eventId, vendorExternalId) : null;
    const documents = businessName ? [
      { type: "certificate_of_insurance", status: coiStatus || "missing", expiresAt: null },
      ...(category === "food" || healthInput ? [{ type: "health_permit", status: healthStatus || "missing", expiresAt: null }] : [])
    ] : [];
    rows.push({
      rowNumber,
      booth: normalizeBooth({
        id: boothId,
        externalId: boothId,
        eventId,
        zoneId: key(record.zone_id).replace(/_/g, "-") || "vendor-row",
        type,
        label: boothId,
        sizeFt: clean(record.size_ft, 20) || null,
        utilities: splitList(record.utilities),
        assignedApplicationId: vendorId,
        status: boothStatus,
        beachMarker: clean(record.beach_marker, 60) || null,
        lat: latitude.value,
        lng: longitude.value,
        illustratedMapXY: mapX.value === null ? null : { x: mapX.value, y: mapY.value },
        publicLabel: businessName || null,
        source: "eventeny",
        sourceUpdatedAt: sourceUpdatedAt.value
      }),
      vendor: businessName ? normalizeVendor({
        id: vendorId,
        externalId: vendorExternalId,
        eventenyId: clean(record.eventeny_id, 200) || vendorExternalId,
        eventId,
        businessName,
        category,
        status: vendorStatus,
        boothId,
        boothFeeCents: fee.value,
        documents,
        description: clean(record.description, 400),
        public: publicListing.value,
        source: "eventeny",
        sourceUpdatedAt: sourceUpdatedAt.value
      }) : null
    });
  }
  return { ok: true, defaults, rows, errors, totalRows: source.records.length };
}

function comparable(value) {
  const copy = structuredClone(value);
  delete copy.sourceBatch;
  delete copy.sourceRow;
  delete copy.createdAt;
  return JSON.stringify(copy);
}

function bucket() {
  return { valid: 0, created: 0, updated: 0, unchanged: 0 };
}

export function applyEventenyBoothImport(docInput, parsedImport, options = {}) {
  if (!parsedImport?.ok) return { ok: false, error: parsedImport?.error || "Eventeny booth import is invalid." };
  const eventId = parsedImport.defaults.eventId;
  const base = docInput && typeof docInput === "object" ? structuredClone(docInput) : {};
  if (base.eventId && base.eventId !== eventId) {
    return { ok: false, error: `Booth data belongs to ${base.eventId}; complete rollover before importing ${eventId}.` };
  }
  const previewHash = clean(options.previewHash, 64).toLowerCase();
  const previousImport = (Array.isArray(base.imports) ? base.imports : []).find(item => item.previewHash === previewHash);
  if (options.commit && previewHash && previousImport) {
    return { ok: true, replay: true, changed: false, doc: base, summary: previousImport.summary, errors: [], importRecord: previousImport };
  }

  const now = options.now || new Date().toISOString();
  const batchId = clean(options.batchId, 200) || `eventeny_booths_${digest(`${now}:${previewHash}`).slice(0, 16)}`;
  const errors = [...parsedImport.errors];
  const summary = { booths: bucket(), vendors: bucket(), assignmentChanges: 0, invalid: 0 };
  const booths = (Array.isArray(base.booths) ? base.booths : []).map(normalizeBooth);
  const vendors = (Array.isArray(base.vendors) ? base.vendors : []).map(normalizeVendor);
  const selectedAssignments = new Map();
  const selectedVendorBooths = new Map();

  for (const row of parsedImport.rows) {
    let vendorId = null;
    if (row.vendor) {
      summary.vendors.valid += 1;
      const byExternal = vendors.findIndex(item => item.source === "eventeny" && String(item.externalId || "").toLowerCase() === row.vendor.externalId.toLowerCase());
      const byEventeny = row.vendor.eventenyId ? vendors.findIndex(item => String(item.eventenyId || "").toLowerCase() === row.vendor.eventenyId.toLowerCase()) : -1;
      if (byExternal >= 0 && byEventeny >= 0 && byExternal !== byEventeny) {
        errors.push(rowError(row.rowNumber, row.booth.id, "Vendor ID and Eventeny ID match different existing records; resolve the conflict before import."));
        summary.vendors.valid -= 1;
        continue;
      }
      const index = byExternal >= 0 ? byExternal : byEventeny;
      const incoming = normalizeVendor({ ...row.vendor, sourceBatch: batchId, sourceRow: row.rowNumber, createdAt: row.vendor.createdAt || now });
      if (index < 0) {
        vendors.push(incoming);
        vendorId = incoming.id;
        summary.vendors.created += 1;
      } else {
        const current = vendors[index];
        const merged = normalizeVendor({ ...incoming, id: current.id, createdAt: current.createdAt || incoming.createdAt });
        vendorId = current.id;
        if (comparable(current) === comparable(merged)) summary.vendors.unchanged += 1;
        else {
          vendors[index] = merged;
          summary.vendors.updated += 1;
        }
      }
      selectedVendorBooths.set(vendorId, row.booth.id);
    }

    summary.booths.valid += 1;
    const incomingBooth = normalizeBooth({
      ...row.booth,
      assignedApplicationId: vendorId,
      sourceBatch: batchId,
      sourceRow: row.rowNumber
    });
    const index = booths.findIndex(item => item.id === incomingBooth.id);
    if (index < 0) {
      booths.push(incomingBooth);
      summary.booths.created += 1;
    } else {
      const current = booths[index];
      const merged = normalizeBooth({ ...incomingBooth, id: current.id });
      if (comparable(current) === comparable(merged)) summary.booths.unchanged += 1;
      else {
        booths[index] = merged;
        summary.booths.updated += 1;
      }
    }
    selectedAssignments.set(incomingBooth.id, vendorId);
  }

  for (let index = 0; index < booths.length; index += 1) {
    const booth = booths[index];
    const targetBooth = selectedVendorBooths.get(booth.assignedApplicationId);
    if (targetBooth && targetBooth !== booth.id && !selectedAssignments.has(booth.id)) {
      booths[index] = normalizeBooth({ ...booth, assignedApplicationId: null, status: "open", publicLabel: null });
      summary.assignmentChanges += 1;
    }
  }
  for (let index = 0; index < vendors.length; index += 1) {
    const vendor = vendors[index];
    const selectedVendor = selectedVendorBooths.get(vendor.id);
    const boothAssignment = vendor.boothId ? selectedAssignments.get(vendor.boothId) : undefined;
    if (selectedVendor && vendor.boothId !== selectedVendor) {
      vendors[index] = normalizeVendor({ ...vendor, boothId: selectedVendor });
      summary.assignmentChanges += 1;
    } else if (vendor.boothId && selectedAssignments.has(vendor.boothId) && boothAssignment !== vendor.id) {
      vendors[index] = normalizeVendor({ ...vendor, boothId: null });
      summary.assignmentChanges += 1;
    }
  }

  summary.invalid = errors.length;
  const changed = [summary.booths, summary.vendors].some(item => item.created > 0 || item.updated > 0) || summary.assignmentChanges > 0;
  const importRecord = {
    id: batchId,
    provider: "eventeny",
    previewHash: previewHash || null,
    bundleHash: clean(options.bundleHash, 64).toLowerCase() || null,
    importedAt: now,
    importedBy: clean(options.actorId, 160) || null,
    fileName: clean(options.fileName, 300) || null,
    summary: structuredClone(summary)
  };
  const imports = Array.isArray(base.imports) ? base.imports.slice() : [];
  if (options.commit) imports.push(importRecord);
  const doc = {
    ...base,
    _note: "Eventeny booth and vendor mirror. Imported through preview-gated reconciliation.",
    eventId,
    source: "eventeny_csv",
    lastUpdated: options.commit ? now : base.lastUpdated || null,
    booths,
    vendors,
    imports: imports.slice(-EVENTENY_BOOTH_IMPORT_HISTORY_LIMIT)
  };
  return { ok: true, replay: false, changed, doc, summary, errors, importRecord: options.commit ? importRecord : null };
}
