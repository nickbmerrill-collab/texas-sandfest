import { createHash, randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { REVENUE_CATEGORIES, REVENUE_SOURCES } from "./revenue.mjs";

export const REVENUE_IMPORT_MAX_ROWS = 1000;
export const REVENUE_IMPORT_HISTORY_LIMIT = 100;

const ENTRY_TYPES = new Set(["receipt", "refund", "void"]);
const CATEGORY_ALIASES = new Map([
  ["tickets", "ticket"],
  ["admission", "ticket"],
  ["vendor", "vendor_fee"],
  ["vendor_fees", "vendor_fee"],
  ["sponsor", "sponsorship"],
  ["sponsorships", "sponsorship"],
  ["merchandise", "merch"],
  ["cashless_top_up", "cashless_topup"],
  ["cashless_topups", "cashless_topup"]
]);
const ENTRY_TYPE_ALIASES = new Map([
  ["sale", "receipt"],
  ["payment", "receipt"],
  ["charge", "receipt"],
  ["reversal", "refund"],
  ["refunded", "refund"],
  ["voided", "void"]
]);
const HEADER_ALIASES = new Map(Object.entries({
  external_ref: ["external_ref", "transaction_id", "transaction", "payment_id", "order_id", "reference", "provider_reference", "id"],
  date: ["date", "transaction_date", "paid_at", "processed_at", "created_at"],
  source: ["source", "provider", "payment_provider"],
  event_id: ["event_id", "event", "festival_id"],
  category: ["category", "revenue_category", "income_category"],
  gross_amount: ["gross_amount", "gross", "amount", "gross_sales", "total_amount"],
  gross_cents: ["gross_cents", "amount_cents"],
  fee_amount: ["fee_amount", "fee", "fees", "processing_fee", "provider_fee"],
  fee_cents: ["fee_cents", "processing_fee_cents", "provider_fee_cents"],
  net_amount: ["net_amount", "net", "net_sales", "settlement_amount"],
  net_cents: ["net_cents", "settlement_cents"],
  quantity: ["quantity", "qty", "units", "tickets"],
  payout_id: ["payout_id", "deposit_id", "settlement_id", "batch_id"],
  payout_date: ["payout_date", "deposit_date", "settlement_date"],
  reconciled: ["reconciled", "matched", "deposited"],
  qb_class: ["qb_class", "quickbooks_class", "class"],
  qb_account: ["qb_account", "quickbooks_account", "account"],
  note: ["note", "notes", "memo", "description"],
  entry_type: ["entry_type", "transaction_type", "type", "kind"]
}).flatMap(([canonical, aliases]) => aliases.map(alias => [alias, canonical])));

function clean(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeHeader(value) {
  return clean(value, 200)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function enumValue(value) {
  return clean(value, 100).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function strictInteger(value, label, { minimum = Number.MIN_SAFE_INTEGER } = {}) {
  const candidate = clean(value, 100);
  if (!candidate) return { ok: true, value: null };
  if (!/^-?\d+$/.test(candidate)) return { ok: false, error: `${label} must be a whole number.` };
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    return { ok: false, error: `${label} is outside the supported range.` };
  }
  return { ok: true, value: parsed };
}

function strictAmountCents(value, label) {
  const original = clean(value, 100);
  if (!original) return { ok: true, value: null };
  const parenthesized = /^\(.*\)$/.test(original);
  const candidate = parenthesized ? original.slice(1, -1).trim() : original;
  const match = candidate.match(/^(-)?\$?((?:\d+)|(?:\d{1,3}(?:,\d{3})+))(?:\.(\d{1,2}))?$/);
  if (!match) return { ok: false, error: `${label} must be a dollar amount with no more than two decimal places.` };
  if (parenthesized && match[1]) return { ok: false, error: `${label} cannot use both a minus sign and parentheses.` };
  const whole = match[2].replaceAll(",", "");
  const centsText = (match[3] || "").padEnd(2, "0");
  const absolute = (BigInt(whole) * 100n) + BigInt(centsText || "0");
  const signed = parenthesized || match[1] ? -absolute : absolute;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    return { ok: false, error: `${label} is outside the supported range.` };
  }
  return { ok: true, value: Number(signed) };
}

function moneyValue(record, centsKey, amountKey, label, { required = false } = {}) {
  const centsInput = clean(record[centsKey], 100);
  const amountInput = clean(record[amountKey], 100);
  if (centsInput && amountInput) {
    return { ok: false, error: `${label} must use either ${centsKey} or ${amountKey}, not both.` };
  }
  const parsed = centsInput
    ? strictInteger(centsInput, `${label} cents`)
    : strictAmountCents(amountInput, label);
  if (!parsed.ok) return parsed;
  if (required && parsed.value == null) return { ok: false, error: `${label} is required.` };
  return parsed;
}

function booleanValue(value) {
  const candidate = clean(value, 20).toLowerCase();
  if (!candidate) return { ok: true, value: false };
  if (["1", "true", "yes", "y", "matched", "reconciled"].includes(candidate)) return { ok: true, value: true };
  if (["0", "false", "no", "n", "unmatched", "unreconciled"].includes(candidate)) return { ok: true, value: false };
  return { ok: false, error: "Reconciled must be yes/no, true/false, matched/unmatched, or 1/0." };
}

function dateValue(value, label, { required = false } = {}) {
  const candidate = clean(value, 100);
  if (!candidate) return required ? { ok: false, error: `${label} is required.` } : { ok: true, value: null };
  const dateOnly = candidate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const date = new Date(`${candidate}T00:00:00.000Z`);
    const valid = date.getUTCFullYear() === Number(dateOnly[1])
      && date.getUTCMonth() + 1 === Number(dateOnly[2])
      && date.getUTCDate() === Number(dateOnly[3]);
    return valid ? { ok: true, value: candidate } : { ok: false, error: `${label} is not a valid calendar date.` };
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(candidate)
    || !Number.isFinite(new Date(candidate).getTime())) {
    return { ok: false, error: `${label} must be YYYY-MM-DD or an ISO 8601 timestamp.` };
  }
  return { ok: true, value: new Date(candidate).toISOString() };
}

function rowError(row, externalRef, error) {
  return { row, externalRef: externalRef || null, error };
}

function duplicateKey(entry) {
  return `${enumValue(entry.source)}:${enumValue(entry.entryType || "receipt")}:${clean(entry.externalRef, 500).toLowerCase()}`;
}

export function normalizeRevenueImportDefaults(input = {}) {
  return {
    source: enumValue(input.source),
    eventId: clean(input.eventId, 160)
  };
}

export function revenueImportPreviewHash(csv, defaultsInput = {}) {
  const canonical = {
    csv: String(csv ?? "").replace(/\r\n?/g, "\n"),
    defaults: normalizeRevenueImportDefaults(defaultsInput)
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function parseRevenueCsv(csv, defaultsInput = {}) {
  const sourceText = String(csv ?? "");
  if (!sourceText.trim()) return { ok: false, error: "Choose or paste a settlement CSV file." };

  let parsed;
  try {
    parsed = parse(sourceText, {
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
  if (parsed.length < 2) return { ok: false, error: "CSV must include a header and at least one settlement row." };

  const rawHeaders = parsed[0].record.map(normalizeHeader);
  const headers = rawHeaders.map(header => HEADER_ALIASES.get(header) || header);
  const duplicateHeader = headers.find((header, index) => header && headers.indexOf(header) !== index);
  if (duplicateHeader) return { ok: false, error: `CSV maps more than one column to ${duplicateHeader}.` };
  for (const requiredHeader of ["external_ref", "date", "category"]) {
    if (!headers.includes(requiredHeader)) return { ok: false, error: `CSV needs a ${requiredHeader} column.` };
  }
  if (!headers.includes("gross_amount") && !headers.includes("gross_cents")) {
    return { ok: false, error: "CSV needs a gross_amount or gross_cents column." };
  }

  const dataRecords = parsed.slice(1).filter(entry => entry.record.some(value => clean(value)));
  if (dataRecords.length > REVENUE_IMPORT_MAX_ROWS) {
    return { ok: false, error: `CSV has ${dataRecords.length} rows; the maximum import is ${REVENUE_IMPORT_MAX_ROWS}.` };
  }
  const defaults = normalizeRevenueImportDefaults(defaultsInput);
  if (defaults.source && !REVENUE_SOURCES.includes(defaults.source)) {
    return { ok: false, error: `Source must be one of: ${REVENUE_SOURCES.join(", ")}.` };
  }
  if (!defaults.eventId) return { ok: false, error: "A current event ID is required for settlement imports." };

  const rows = [];
  const errors = [];
  for (const entry of dataRecords) {
    const rowNumber = Number(entry.info?.lines || rows.length + errors.length + 2);
    const record = Object.fromEntries(headers.map((header, index) => [header, entry.record[index] ?? ""]));
    const externalRef = clean(record.external_ref, 500);
    const source = enumValue(record.source) || defaults.source;
    const eventId = clean(record.event_id, 160) || defaults.eventId;
    const categoryInput = enumValue(record.category);
    const category = CATEGORY_ALIASES.get(categoryInput) || categoryInput;
    const entryTypeInput = enumValue(record.entry_type) || "receipt";
    const entryType = ENTRY_TYPE_ALIASES.get(entryTypeInput) || entryTypeInput;
    const gross = moneyValue(record, "gross_cents", "gross_amount", "Gross amount", { required: true });
    const fee = moneyValue(record, "fee_cents", "fee_amount", "Fee amount");
    const net = moneyValue(record, "net_cents", "net_amount", "Net amount");
    const quantity = strictInteger(record.quantity, "Quantity", { minimum: 0 });
    const date = dateValue(record.date, "Transaction date", { required: true });
    const payoutDate = dateValue(record.payout_date, "Payout date");
    const reconciled = booleanValue(record.reconciled);
    const fail = message => errors.push(rowError(rowNumber, externalRef, message));

    if (!externalRef) { fail("External reference is required."); continue; }
    if (!source || !REVENUE_SOURCES.includes(source)) { fail(`Source must be one of: ${REVENUE_SOURCES.join(", ")}.`); continue; }
    if (defaults.source && source !== defaults.source) { fail(`Row source ${source} does not match selected source ${defaults.source}.`); continue; }
    if (eventId !== defaults.eventId) { fail(`Row event ${eventId} does not match current event ${defaults.eventId}.`); continue; }
    if (!REVENUE_CATEGORIES.includes(category)) { fail(`Category must be one of: ${REVENUE_CATEGORIES.join(", ")}.`); continue; }
    if (!ENTRY_TYPES.has(entryType)) { fail("Entry type must be receipt, refund, or void."); continue; }
    for (const result of [gross, fee, net, quantity, date, payoutDate, reconciled]) {
      if (!result.ok) { fail(result.error); break; }
    }
    if ([gross, fee, net, quantity, date, payoutDate, reconciled].some(result => !result.ok)) continue;
    if (!gross.value) { fail("Gross amount cannot be zero."); continue; }

    const reversal = entryType === "refund" || entryType === "void";
    const grossCents = reversal ? -Math.abs(gross.value) : gross.value;
    if (!reversal && grossCents < 0) { fail("Receipt gross amount must be positive."); continue; }
    const feeCents = fee.value ?? 0;
    if (!reversal && feeCents < 0) { fail("Receipt fee amount cannot be negative."); continue; }
    if (!reversal && feeCents > grossCents) { fail("Receipt fee amount cannot exceed gross amount."); continue; }
    const expectedNetCents = grossCents - feeCents;
    const netCents = net.value == null ? expectedNetCents : reversal ? -Math.abs(net.value) : net.value;
    if (netCents !== expectedNetCents) {
      fail(`Net amount must equal gross minus fees (${(expectedNetCents / 100).toFixed(2)}).`);
      continue;
    }
    const signedQuantity = quantity.value == null ? null : reversal ? -Math.abs(quantity.value) : quantity.value;
    rows.push({
      rowNumber,
      entry: {
        eventId,
        date: date.value,
        source,
        category,
        grossCents,
        feeCents,
        netCents,
        quantity: signedQuantity,
        payoutId: clean(record.payout_id, 300) || null,
        payoutDate: payoutDate.value,
        reconciled: reconciled.value,
        qbClass: clean(record.qb_class, 200) || null,
        qbAccount: clean(record.qb_account, 200) || null,
        externalRef,
        note: clean(record.note, 2000),
        entryType,
        origin: "imported"
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

export function applyRevenueImport(docInput, parsedImport, options = {}) {
  if (!parsedImport?.ok || !Array.isArray(parsedImport.rows)) {
    return { ok: false, error: parsedImport?.error || "Settlement import is invalid." };
  }
  const eventId = clean(options.eventId || parsedImport.defaults?.eventId, 160);
  const source = enumValue(options.source || parsedImport.defaults?.source);
  const previewHash = clean(options.previewHash, 128);
  if (!eventId || !REVENUE_SOURCES.includes(source) || !previewHash) {
    return { ok: false, error: "Settlement import context is incomplete." };
  }

  const input = docInput && typeof docInput === "object" ? docInput : {};
  const previousEventId = clean(input.eventId, 160) || null;
  const existingEntries = (Array.isArray(input.entries) ? input.entries : []).map(entry => ({
    ...entry,
    eventId: entry?.eventId || previousEventId
  }));
  const imports = Array.isArray(input.imports) ? [...input.imports] : [];
  const previousImport = imports.find(item => item?.previewHash === previewHash && item?.eventId === eventId && item?.source === source);
  if (previousImport) {
    return {
      ok: true,
      changed: false,
      replay: true,
      doc: { ...input, entries: existingEntries, imports },
      importRecord: previousImport,
      entries: [],
      duplicates: [],
      errors: [...(parsedImport.errors || [])],
      summary: {
        rows: Number(previousImport.rows || parsedImport.totalRows || 0),
        importable: 0,
        imported: 0,
        duplicates: Number(previousImport.duplicates || 0),
        invalid: Number(previousImport.invalid || 0),
        grossCents: Number(previousImport.grossCents || 0),
        feeCents: Number(previousImport.feeCents || 0),
        netCents: Number(previousImport.netCents || 0)
      }
    };
  }

  const seen = new Map();
  for (const entry of [...existingEntries, ...(Array.isArray(options.existingEntries) ? options.existingEntries : [])]) {
    if (!entry?.externalRef) continue;
    seen.set(duplicateKey(entry), entry);
  }
  const entries = [];
  const duplicates = [];
  for (const row of parsedImport.rows) {
    const key = duplicateKey(row.entry);
    const existing = seen.get(key);
    if (existing) {
      duplicates.push({
        row: row.rowNumber,
        externalRef: row.entry.externalRef,
        existingEntryId: existing.id || existing.sourceRecordId || null,
        origin: existing.origin || "imported"
      });
      continue;
    }
    seen.set(key, row.entry);
    entries.push({
      ...row.entry,
      id: options.idFactory
        ? options.idFactory(row.entry, row.rowNumber)
        : `revenue_import_${randomUUID()}`,
      importBatchId: options.batchId || null,
      importedAt: options.now || new Date().toISOString(),
      importedBy: options.actorId || null
    });
  }

  const totals = entries.reduce((summary, entry) => ({
    grossCents: summary.grossCents + (entry.grossCents > 0 ? entry.grossCents : 0),
    feeCents: summary.feeCents + entry.feeCents,
    netCents: summary.netCents + entry.netCents
  }), { grossCents: 0, feeCents: 0, netCents: 0 });
  const summary = {
    rows: parsedImport.totalRows,
    importable: entries.length,
    imported: options.commit ? entries.length : 0,
    duplicates: duplicates.length,
    invalid: parsedImport.errors.length,
    ...totals
  };
  const now = options.now || new Date().toISOString();
  const batchId = options.batchId || `revenue_import_${randomUUID()}`;
  const importRecord = options.commit ? {
    id: batchId,
    eventId,
    source,
    fileName: clean(options.fileName, 300) || null,
    previewHash,
    importedAt: now,
    importedBy: options.actorId || null,
    rows: summary.rows,
    imported: summary.imported,
    duplicates: summary.duplicates,
    invalid: summary.invalid,
    grossCents: summary.grossCents,
    feeCents: summary.feeCents,
    netCents: summary.netCents
  } : null;
  const doc = {
    ...input,
    eventId,
    lastUpdated: options.commit ? now : input.lastUpdated ?? null,
    currency: input.currency || "usd",
    entries: options.commit ? [...existingEntries, ...entries] : existingEntries,
    imports: options.commit ? [...imports, importRecord].slice(-REVENUE_IMPORT_HISTORY_LIMIT) : imports
  };
  return {
    ok: true,
    changed: options.commit && entries.length > 0,
    replay: false,
    doc,
    importRecord,
    entries,
    duplicates,
    errors: [...parsedImport.errors],
    summary
  };
}
