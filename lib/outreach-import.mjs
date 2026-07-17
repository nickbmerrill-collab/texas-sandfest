import { parse } from "csv-parse/sync";
import { createOutreachProspect, normalizePartnerOperations } from "./partner-ops.mjs";

export const OUTREACH_IMPORT_MAX_ROWS = 500;

const HEADER_ALIASES = new Map(Object.entries({
  organization_name: ["organization_name", "organization", "business_name", "business", "company_name", "company", "name"],
  website: ["website", "url", "business_url", "company_url"],
  industry: ["industry", "business_type", "category", "vertical"],
  city: ["city", "locality"],
  state: ["state", "region", "province"],
  postal_code: ["postal_code", "postcode", "zip_code", "zipcode", "zip"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lng", "lon", "long"],
  contact_name: ["contact_name", "decision_maker", "contact", "owner_name"],
  contact_email: ["contact_email", "business_email", "email", "email_address"],
  community_fit: ["community_fit", "local_fit", "community_partner"],
  contact_basis: ["contact_basis", "consent_basis", "outreach_basis"],
  status: ["status", "prospect_status", "readiness"],
  tags: ["tags", "labels"],
  owner_id: ["owner_id", "owner", "assigned_to", "assignee"],
  next_action: ["next_action", "follow_up", "followup", "notes"],
  next_action_at: ["next_action_at", "follow_up_at", "followup_at", "follow_up_date", "followup_date", "due_at"]
}).flatMap(([canonical, aliases]) => aliases.map(alias => [alias, canonical])));

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function clean(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function booleanValue(value, fallback = false) {
  const candidate = clean(value, 20).toLowerCase();
  if (!candidate) return { ok: true, value: fallback === true };
  if (["1", "true", "yes", "y"].includes(candidate)) return { ok: true, value: true };
  if (["0", "false", "no", "n"].includes(candidate)) return { ok: true, value: false };
  return { ok: false, error: "Community fit must be yes/no, true/false, or 1/0." };
}

export function normalizeOutreachImportDefaults(input = {}) {
  return {
    state: clean(input.state, 40).toUpperCase(),
    contactBasis: clean(input.contactBasis, 80).toLowerCase(),
    status: clean(input.status, 40).toLowerCase() || "identified",
    communityFit: input.communityFit === true
  };
}

export function parseOutreachProspectCsv(csv, defaultsInput = {}) {
  const source = String(csv ?? "");
  if (!source.trim()) return { ok: false, error: "Choose or paste a CSV file." };

  let parsed;
  try {
    parsed = parse(source, {
      bom: true,
      info: true,
      max_record_size: 20_000,
      relax_column_count: false,
      skip_empty_lines: true,
      trim: true
    });
  } catch (error) {
    const line = Number(error?.lines || error?.line || 0);
    return { ok: false, error: `CSV could not be parsed${line ? ` near line ${line}` : ""}: ${clean(error?.message || error, 500)}` };
  }
  if (parsed.length < 2) return { ok: false, error: "CSV must include a header and at least one business row." };

  const rawHeaders = parsed[0].record.map(normalizeHeader);
  const headers = rawHeaders.map(header => HEADER_ALIASES.get(header) || header);
  const duplicateHeader = headers.find((header, index) => header && headers.indexOf(header) !== index);
  if (duplicateHeader) return { ok: false, error: `CSV maps more than one column to ${duplicateHeader}.` };
  if (!headers.includes("organization_name")) {
    return { ok: false, error: "CSV needs an organization_name, business_name, company, or name column." };
  }

  const dataRecords = parsed.slice(1).filter(entry => entry.record.some(value => clean(value)));
  if (dataRecords.length > OUTREACH_IMPORT_MAX_ROWS) {
    return { ok: false, error: `CSV has ${dataRecords.length} rows; the maximum import is ${OUTREACH_IMPORT_MAX_ROWS}.` };
  }
  const defaults = normalizeOutreachImportDefaults(defaultsInput);
  const rows = [];
  const errors = [];

  for (const entry of dataRecords) {
    const rowNumber = Number(entry.info?.lines || rows.length + errors.length + 2);
    const record = Object.fromEntries(headers.map((header, index) => [header, entry.record[index] ?? ""]));
    const communityFit = booleanValue(record.community_fit, defaults.communityFit);
    if (!communityFit.ok) {
      errors.push({ row: rowNumber, organizationName: clean(record.organization_name, 160), error: communityFit.error });
      continue;
    }
    rows.push({
      rowNumber,
      input: {
        organizationName: clean(record.organization_name, 160),
        website: clean(record.website, 500),
        industry: clean(record.industry, 100),
        city: clean(record.city, 100),
        state: clean(record.state, 40) || defaults.state,
        postalCode: clean(record.postal_code, 20),
        latitude: clean(record.latitude, 40) || null,
        longitude: clean(record.longitude, 40) || null,
        contactName: clean(record.contact_name, 120),
        contactEmail: clean(record.contact_email, 254),
        communityFit: communityFit.value,
        contactBasis: clean(record.contact_basis, 80).toLowerCase() || defaults.contactBasis,
        status: clean(record.status, 40).toLowerCase() || defaults.status,
        tags: clean(record.tags, 1000).split(/[|;]/).map(item => item.trim()).filter(Boolean),
        ownerId: clean(record.owner_id, 100),
        nextAction: clean(record.next_action, 300),
        nextActionAt: clean(record.next_action_at, 100) || null,
        source: "csv_import",
        sourceRow: rowNumber
      }
    });
  }

  return {
    ok: true,
    headers: headers.filter(Boolean),
    totalRows: dataRecords.length,
    rows,
    errors,
    defaults
  };
}

export function applyOutreachProspectImport(docInput, parsedImport, options = {}) {
  if (!parsedImport?.ok || !Array.isArray(parsedImport.rows)) {
    return { ok: false, error: parsedImport?.error || "Prospect import is invalid." };
  }
  let doc = normalizePartnerOperations(docInput);
  const created = [];
  const duplicates = [];
  const errors = [...(parsedImport.errors || [])];

  for (const row of parsedImport.rows) {
    const result = createOutreachProspect(doc, {
      ...row.input,
      sourceBatch: options.sourceBatch || null
    }, options);
    if (result.ok) {
      doc = result.doc;
      created.push(result.prospect);
    } else if (result.duplicate) {
      duplicates.push({
        row: row.rowNumber,
        organizationName: row.input.organizationName,
        existingProspectId: result.existingProspect?.id || null
      });
    } else {
      errors.push({ row: row.rowNumber, organizationName: row.input.organizationName, error: result.error || "Prospect is invalid." });
    }
  }

  return {
    ok: true,
    changed: created.length > 0,
    doc,
    created,
    duplicates,
    errors,
    summary: {
      rows: parsedImport.totalRows,
      valid: created.length,
      duplicates: duplicates.length,
      invalid: errors.length,
      contactReady: created.filter(item => item.contactEmail && item.contactBasis && ["qualified", "contact_ready", "contacted", "engaged"].includes(item.status)).length
    }
  };
}
