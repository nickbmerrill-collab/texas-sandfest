import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { createPartnerApplication, normalizePartnerOperations } from "./partner-ops.mjs";
import { sponsorPackageCatalog } from "./sponsor-packages.mjs";
import { resolveVendorOffering, vendorOfferingCatalog } from "./vendor-offerings.mjs";

export const EVENTENY_PARTNER_IMPORT_MAX_ROWS = 500;

const TYPE_ALIASES = new Map([
  ["vendor", "vendor"],
  ["exhibitor", "vendor"],
  ["merchant", "vendor"],
  ["sponsor", "sponsor"],
  ["sponsorship", "sponsor"]
]);

const HEADER_ALIASES = new Map(Object.entries({
  external_id: ["external_id", "application_id", "submission_id", "eventeny_id", "reference", "id"],
  type: ["type", "application_type", "applicant_type", "partner_type"],
  organization_name: ["organization_name", "organization", "business_name", "company_name", "vendor_name", "sponsor_name", "name"],
  contact_name: ["contact_name", "primary_contact", "applicant_name", "representative"],
  contact_email: ["contact_email", "email", "email_address"],
  contact_phone: ["contact_phone", "phone", "phone_number", "mobile"],
  website: ["website", "url", "business_url", "company_url"],
  city: ["city", "locality"],
  state: ["state", "region", "province"],
  postal_code: ["postal_code", "zip", "zip_code", "zipcode", "postcode"],
  category: ["category", "vendor_category", "business_type"],
  package_id: ["package_id", "sponsor_package_id", "tier_id"],
  package_name: ["package_name", "sponsor_package", "sponsorship_tier", "tier_name", "tier"],
  offering_id: ["offering_id", "vendor_offering_id", "fee_id"],
  offering_name: ["offering_name", "vendor_offering", "fee_name"],
  source_status: ["source_status", "application_status", "status"],
  event_id: ["event_id", "festival_id", "event"],
  reported_amount: ["reported_amount", "amount", "application_amount", "total"],
  reported_cents: ["reported_cents", "amount_cents"],
  description: ["description", "notes", "application_notes"],
  tags: ["tags", "labels"]
}).flatMap(([canonical, aliases]) => aliases.map(alias => [alias, canonical])));

function clean(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizedKey(value) {
  return clean(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function strictCents(value, label, { alreadyCents = false } = {}) {
  const original = clean(value, 100);
  if (!original) return { ok: true, value: 0 };
  if (alreadyCents) {
    if (!/^\d+$/.test(original)) return { ok: false, error: `${label} must be a non-negative whole number.` };
    const parsed = Number(original);
    return Number.isSafeInteger(parsed) ? { ok: true, value: parsed } : { ok: false, error: `${label} is outside the supported range.` };
  }
  const match = original.match(/^\$?((?:\d+)|(?:\d{1,3}(?:,\d{3})+))(?:\.(\d{1,2}))?$/);
  if (!match) return { ok: false, error: `${label} must be a non-negative dollar amount with no more than two decimals.` };
  const dollars = Number(match[1].replaceAll(",", ""));
  const cents = Number((match[2] || "").padEnd(2, "0"));
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) ? { ok: true, value: total } : { ok: false, error: `${label} is outside the supported range.` };
}

export function normalizeEventenyPartnerImportDefaults(input = {}) {
  const defaultType = TYPE_ALIASES.get(normalizedKey(input.defaultType)) || "";
  return {
    eventId: clean(input.eventId, 160),
    defaultType,
    transactionalContactConfirmed: input.transactionalContactConfirmed === true,
    catalogFingerprint: clean(input.catalogFingerprint, 64).toLowerCase()
  };
}

export function eventenyPartnerImportPreviewHash(csv, defaultsInput = {}) {
  return digest(JSON.stringify({ csv: String(csv ?? ""), defaults: normalizeEventenyPartnerImportDefaults(defaultsInput) }));
}

export function parseEventenyPartnerCsv(csv, defaultsInput = {}) {
  const source = String(csv ?? "");
  if (!source.trim()) return { ok: false, error: "Choose or paste an Eventeny application CSV." };
  const defaults = normalizeEventenyPartnerImportDefaults(defaultsInput);
  if (!defaults.eventId) return { ok: false, error: "The current event context is required." };
  if (!defaults.transactionalContactConfirmed) {
    return { ok: false, error: "Confirm that these Eventeny applicants may receive transactional organizer messages before previewing." };
  }

  let parsed;
  try {
    parsed = parse(source, {
      bom: true,
      info: true,
      max_record_size: 30_000,
      relax_column_count: false,
      skip_empty_lines: true,
      trim: true
    });
  } catch (error) {
    const line = Number(error?.lines || error?.line || 0);
    return { ok: false, error: `CSV could not be parsed${line ? ` near line ${line}` : ""}: ${clean(error?.message || error, 500)}` };
  }
  if (parsed.length < 2) return { ok: false, error: "CSV must include a header and at least one application row." };

  const headers = parsed[0].record.map(value => HEADER_ALIASES.get(normalizedKey(value)) || normalizedKey(value));
  const duplicateHeader = headers.find((header, index) => header && headers.indexOf(header) !== index);
  if (duplicateHeader) return { ok: false, error: `CSV maps more than one column to ${duplicateHeader}.` };
  for (const required of ["external_id", "organization_name", "contact_name", "contact_email"]) {
    if (!headers.includes(required)) return { ok: false, error: `CSV needs a ${required} column.` };
  }
  if (!defaults.defaultType && !headers.includes("type")) {
    return { ok: false, error: "CSV needs an application type column, or choose a default type." };
  }

  const records = parsed.slice(1).filter(entry => entry.record.some(value => clean(value)));
  if (records.length > EVENTENY_PARTNER_IMPORT_MAX_ROWS) {
    return { ok: false, error: `CSV has ${records.length} rows; the maximum import is ${EVENTENY_PARTNER_IMPORT_MAX_ROWS}.` };
  }

  const rows = [];
  const errors = [];
  for (const entry of records) {
    const rowNumber = Number(entry.info?.lines || rows.length + errors.length + 2);
    const record = Object.fromEntries(headers.map((header, index) => [header, entry.record[index] ?? ""]));
    const externalId = clean(record.external_id, 200);
    const organizationName = clean(record.organization_name, 160);
    const contactName = clean(record.contact_name, 120);
    const contactEmail = clean(record.contact_email, 254).toLowerCase();
    const sourceType = normalizedKey(record.type);
    const type = sourceType ? TYPE_ALIASES.get(sourceType) : defaults.defaultType;
    const eventId = clean(record.event_id, 160) || defaults.eventId;
    const rowErrors = [];
    if (!externalId) rowErrors.push("External application ID is required.");
    if (!type) rowErrors.push("Application type must be vendor or sponsor.");
    if (!organizationName) rowErrors.push("Organization name is required.");
    if (!contactName) rowErrors.push("Contact name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) rowErrors.push("A valid contact email is required.");
    if (eventId !== defaults.eventId) rowErrors.push(`Event ${eventId || "(blank)"} does not match the current event ${defaults.eventId}.`);
    const amount = record.reported_cents
      ? strictCents(record.reported_cents, "Reported cents", { alreadyCents: true })
      : strictCents(record.reported_amount, "Reported amount");
    if (!amount.ok) rowErrors.push(amount.error);
    if (rowErrors.length) {
      errors.push({ row: rowNumber, externalId, organizationName, error: rowErrors.join(" ") });
      continue;
    }

    const normalized = {
      externalId,
      eventId,
      type,
      organizationName,
      contactName,
      contactEmail,
      contactPhone: clean(record.contact_phone, 40),
      website: clean(record.website, 500),
      city: clean(record.city, 100),
      state: clean(record.state, 40),
      postalCode: clean(record.postal_code, 20),
      category: normalizedKey(record.category),
      packageId: normalizedKey(record.package_id),
      packageName: clean(record.package_name, 120),
      offeringId: normalizedKey(record.offering_id),
      offeringName: clean(record.offering_name, 120),
      sourceStatus: clean(record.source_status, 100),
      sourceReportedAmountCents: amount.value,
      description: clean(record.description, 2000),
      tags: clean(record.tags, 1000).split(/[|;]/).map(item => clean(item, 160)).filter(Boolean)
    };
    rows.push({
      rowNumber,
      input: normalized,
      idempotencyKeyHash: digest(`eventeny:${eventId}:${type}:${externalId.toLowerCase()}`),
      idempotencyFingerprint: digest(JSON.stringify(normalized))
    });
  }

  return { ok: true, headers: headers.filter(Boolean), totalRows: records.length, rows, errors, defaults };
}

function catalogName(value) {
  return normalizedKey(value);
}

export function eventenyPartnerCatalogFingerprint(config = {}) {
  const sponsors = sponsorPackageCatalog(config).activePackages
    .map(item => ({ id: catalogName(item.id), name: catalogName(item.name), amount: Number(item.amount || 0), benefits: item.benefits || [] }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const vendors = vendorOfferingCatalog(config).activeOfferings
    .map(item => ({ id: catalogName(item.id), name: catalogName(item.name), amount: Number(item.amount || 0), categories: item.categories || [] }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return digest(JSON.stringify({ sponsors, vendors }));
}

export function resolveEventenyPartnerSelection(config, input) {
  if (input.type === "sponsor") {
    const packageId = catalogName(input.packageId);
    const packageName = catalogName(input.packageName);
    const sponsorPackage = sponsorPackageCatalog(config).activePackages.find(item => (
      (packageId && catalogName(item.id) === packageId) || (packageName && catalogName(item.name) === packageName)
    ));
    if (!sponsorPackage) return { ok: false, error: "Sponsor row must match an active package by package_id or package_name." };
    return {
      ok: true,
      expectedAmountCents: Number(sponsorPackage.amount || 0),
      input: { packageId: sponsorPackage.id, packageName: sponsorPackage.name, packageBenefits: sponsorPackage.benefits || [] }
    };
  }

  const catalog = vendorOfferingCatalog(config);
  const offeringId = catalogName(input.offeringId);
  const offeringName = catalogName(input.offeringName);
  const candidate = catalog.activeOfferings.find(item => (
    (offeringId && catalogName(item.id) === offeringId) || (offeringName && catalogName(item.name) === offeringName)
  ));
  if (!candidate) return { ok: false, error: "Vendor row must match an active offering by offering_id or offering_name." };
  const resolved = resolveVendorOffering(config, candidate.id, input.category);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    expectedAmountCents: Number(resolved.offering.amount || 0),
    input: { offeringId: resolved.offering.id, offeringName: resolved.offering.name }
  };
}

export function applyEventenyPartnerImport(docInput, parsedImport, options = {}) {
  if (!parsedImport?.ok || !Array.isArray(parsedImport.rows)) {
    return { ok: false, error: parsedImport?.error || "Eventeny partner import is invalid." };
  }
  let doc = normalizePartnerOperations(docInput);
  const created = [];
  const duplicates = [];
  const conflicts = [];
  const errors = [...(parsedImport.errors || [])];
  const now = options.now || new Date().toISOString();

  for (const row of parsedImport.rows) {
    const selection = resolveEventenyPartnerSelection(options.config || {}, row.input);
    if (!selection.ok) {
      errors.push({ row: row.rowNumber, externalId: row.input.externalId, organizationName: row.input.organizationName, error: selection.error });
      continue;
    }
    const result = createPartnerApplication(doc, {
      ...row.input,
      ...selection.input,
      expectedAmountCents: selection.expectedAmountCents,
      requestedAmountCents: 0,
      source: "eventeny_csv",
      sourceBatch: options.sourceBatch || null,
      sourceRef: `eventeny/application/${row.input.externalId}`,
      sourceRow: row.rowNumber,
      consentToContact: true,
      contactPermissionBasis: "eventeny_application",
      contactPermissionConfirmedAt: now,
      contactPermissionConfirmedBy: options.actorId || null
    }, {
      actorId: options.actorId,
      createAcknowledgment: false,
      eventId: parsedImport.defaults.eventId,
      idFactory: options.idFactory,
      idempotencyKeyHash: row.idempotencyKeyHash,
      idempotencyFingerprint: row.idempotencyFingerprint,
      now
    });
    if (result.ok && !result.duplicate) {
      doc = result.doc;
      created.push(result.application);
    } else if (result.duplicate) {
      duplicates.push({ row: row.rowNumber, externalId: row.input.externalId, organizationName: row.input.organizationName, existingApplicationId: result.application?.id || null });
    } else if (result.conflict) {
      conflicts.push({ row: row.rowNumber, externalId: row.input.externalId, organizationName: row.input.organizationName, error: "This Eventeny application changed since its first import and needs manual review." });
    } else {
      errors.push({ row: row.rowNumber, externalId: row.input.externalId, organizationName: row.input.organizationName, error: result.error || "Application is invalid." });
    }
  }

  const summary = {
    rows: parsedImport.totalRows,
    importable: created.length,
    imported: options.commit ? created.length : 0,
    duplicates: duplicates.length,
    conflicts: conflicts.length,
    invalid: errors.length
  };
  return { ok: true, changed: created.length > 0, doc, created, duplicates, conflicts, errors, summary };
}
