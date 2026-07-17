// Unified revenue ledger — the Phase 0 "one dashboard that reconciles
// everything to QuickBooks" build from docs/research/05-rfid-cashless-ticketing.md
// and docs/ultimate-festival-platform.md.
//
// Every money movement across Stripe, Eventeny, Square, and manual entries is
// normalized into one `revenue_event` shape so revenue can be reported by
// category and source, fees separated out, and each payout reconciled to a bank
// deposit. This module is pure (no I/O) so it is trivially testable and the same
// summarizer serves the admin API, the ops console, and finance exports.

export const REVENUE_SOURCES = ["stripe", "eventeny", "square", "manual"];
export const REVENUE_CATEGORIES = [
  "ticket",
  "vendor_fee",
  "sponsorship",
  "merch",
  "raffle",
  "cashless_topup"
];

const PARTNER_REVENUE_STATUSES = new Set([
  "succeeded",
  "partially_refunded",
  "refunded",
  "voided"
]);

function toCents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

// Normalize a raw entry into the canonical shape. netCents is derived from
// gross - fee when not explicitly supplied, so an import that only knows gross
// and fee still reconciles.
export function normalizeEntry(raw = {}) {
  const grossCents = toCents(raw.grossCents);
  const feeCents = toCents(raw.feeCents);
  const netCents = raw.netCents == null ? grossCents - feeCents : toCents(raw.netCents);
  return {
    id: raw.id ?? null,
    eventId: raw.eventId ?? null,
    date: raw.date ?? null,
    source: REVENUE_SOURCES.includes(raw.source) ? raw.source : "manual",
    category: REVENUE_CATEGORIES.includes(raw.category) ? raw.category : "merch",
    grossCents,
    feeCents,
    netCents,
    quantity: raw.quantity == null ? null : toCents(raw.quantity),
    payoutId: raw.payoutId ?? null,
    payoutDate: raw.payoutDate ?? null,
    reconciled: Boolean(raw.reconciled),
    qbClass: raw.qbClass ?? null,
    qbAccount: raw.qbAccount ?? null,
    externalRef: raw.externalRef ?? null,
    note: raw.note ?? "",
    entryType: raw.entryType ?? "receipt",
    origin: raw.origin ?? "imported"
  };
}

function emptyBucket() {
  return { grossCents: 0, refundCents: 0, feeCents: 0, netCents: 0, count: 0, quantity: 0 };
}

function addToBucket(bucket, entry) {
  if (entry.grossCents >= 0) bucket.grossCents += entry.grossCents;
  else bucket.refundCents += Math.abs(entry.grossCents);
  bucket.feeCents += entry.feeCents;
  bucket.netCents += entry.netCents;
  bucket.count += 1;
  if (entry.quantity != null) bucket.quantity += entry.quantity;
}

function text(value) {
  return String(value ?? "").trim();
}

function partnerRevenueCategory(application) {
  return application?.type === "vendor" ? "vendor_fee" : "sponsorship";
}

function partnerRevenueSource(payment) {
  return payment?.method === "stripe" || payment?.paymentIntentId ? "stripe" : "manual";
}

function partnerRevenueAccount(application) {
  return application?.type === "vendor" ? "Vendor Booth Revenue" : "Sponsorship Revenue";
}

function partnerRevenueClass(application) {
  return application?.type === "vendor" ? "Vendor Fees" : "Sponsorship";
}

function partnerPaymentReference(payment) {
  return text(payment.paymentIntentId || payment.externalRef || payment.providerEventId || payment.id);
}

function partnerPaymentNote(application, payment) {
  const organization = text(application?.organizationName) || "Partner";
  const detail = application?.type === "vendor"
    ? text(application.category) || "vendor payment"
    : text(application.packageName) || "sponsorship payment";
  return `${organization} - ${detail}${payment.invoiceId ? ` (${payment.invoiceId})` : ""}`;
}

export function partnerRevenueEntries(doc = {}, { eventId = null } = {}) {
  const applications = new Map((Array.isArray(doc.applications) ? doc.applications : [])
    .filter(application => !eventId || application.eventId === eventId)
    .map(application => [application.id, application]));
  const entries = [];

  for (const payment of Array.isArray(doc.payments) ? doc.payments : []) {
    if (!PARTNER_REVENUE_STATUSES.has(payment.status)) continue;
    const application = applications.get(payment.applicationId);
    if (!application) continue;
    const amountCents = Math.max(0, toCents(payment.amountCents));
    if (!amountCents) continue;
    const source = partnerRevenueSource(payment);
    const externalRef = partnerPaymentReference(payment);
    const feeCents = Math.max(0, toCents(payment.providerFeeCents));
    const base = {
      id: `partner-payment:${payment.id}`,
      eventId: application.eventId ?? eventId,
      date: payment.receivedAt || payment.createdAt || null,
      source,
      category: partnerRevenueCategory(application),
      grossCents: amountCents,
      feeCents,
      netCents: amountCents - feeCents,
      quantity: 1,
      payoutId: payment.payoutId ?? null,
      payoutDate: payment.payoutDate ?? null,
      reconciled: ["matched", "refunded", "voided"].includes(payment.reconciliationStatus),
      qbClass: partnerRevenueClass(application),
      qbAccount: partnerRevenueAccount(application),
      externalRef,
      note: partnerPaymentNote(application, payment),
      entryType: "receipt",
      origin: "partner_operations",
      sourceRecordId: payment.id,
      paymentStatus: payment.status
    };
    entries.push(base);

    const reversalAmount = payment.status === "voided"
      ? amountCents
      : Math.min(amountCents, Math.max(0, toCents(payment.refundedAmountCents)));
    if (!reversalAmount) continue;
    entries.push({
      ...base,
      id: `partner-payment-reversal:${payment.id}`,
      date: payment.reversedAt || payment.updatedAt || base.date,
      grossCents: -reversalAmount,
      feeCents: 0,
      netCents: -reversalAmount,
      quantity: null,
      payoutId: null,
      payoutDate: null,
      reconciled: false,
      externalRef: `${externalRef}:reversal`,
      note: `${payment.status === "voided" ? "Void" : "Refund"}: ${text(payment.reversalReason) || base.note}`,
      entryType: payment.status === "voided" ? "void" : "refund"
    });
  }
  return entries;
}

function entryEventId(entry, ledgerEventId) {
  return text(entry?.eventId || ledgerEventId) || null;
}

function revenueEntryKey(entry) {
  const externalRef = text(entry.externalRef).toLowerCase();
  if (externalRef) return `ref:${entry.source}:${text(entry.entryType || "receipt")}:${externalRef}`;
  return `id:${text(entry.id)}`;
}

export function buildRevenueLedgerView(ledger = {}, partnerOperations = {}, { eventId = null } = {}) {
  const ledgerEventId = text(ledger.eventId) || null;
  const rawImported = Array.isArray(ledger.entries) ? ledger.entries : [];
  const imported = [];
  let excludedImportedEntries = 0;
  let unscopedImportedEntries = 0;
  for (const entry of rawImported) {
    const scopedEventId = entryEventId(entry, ledgerEventId);
    if (!scopedEventId) {
      unscopedImportedEntries += 1;
      continue;
    }
    if (eventId && scopedEventId !== eventId) {
      excludedImportedEntries += 1;
      continue;
    }
    imported.push({ ...entry, eventId: scopedEventId, origin: entry.origin || "imported" });
  }

  const partner = partnerRevenueEntries(partnerOperations, { eventId });
  const entries = [];
  const seen = new Set();
  let duplicateEntries = 0;
  for (const entry of [...imported, ...partner]) {
    const key = revenueEntryKey(entry);
    if (seen.has(key)) {
      duplicateEntries += 1;
      continue;
    }
    seen.add(key);
    entries.push(entry);
  }

  const timestamps = [ledger.lastUpdated, partnerOperations.lastUpdated]
    .filter(value => value && Number.isFinite(new Date(value).getTime()))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return {
    eventId,
    lastUpdated: timestamps[0] ?? null,
    currency: ledger.currency ?? "usd",
    expectedAttendance: ledger.expectedAttendance ?? null,
    ticketCapacity: ledger.ticketCapacity ?? null,
    entries,
    sources: {
      imported: {
        status: imported.length ? "included" : excludedImportedEntries || unscopedImportedEntries ? "excluded" : "empty",
        eventId: ledgerEventId,
        entries: imported.length,
        excludedEntries: excludedImportedEntries,
        unscopedEntries: unscopedImportedEntries,
        lastUpdated: ledger.lastUpdated ?? null
      },
      partnerOperations: {
        status: "live",
        eventId: partnerOperations.eventId ?? eventId,
        entries: partner.length,
        lastUpdated: partnerOperations.lastUpdated ?? null
      },
      duplicateEntries
    }
  };
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10; // one decimal place
}

// Summarize a ledger into dashboard KPIs. `opts.expectedAttendance` enables the
// spend-per-attendee tile; `opts.ticketCapacity` enables tickets-sold-vs-capacity.
export function summarizeLedger(rawEntries = [], opts = {}) {
  const entries = rawEntries.map(normalizeEntry);
  const totals = emptyBucket();
  const byCategory = {};
  const bySource = {};

  for (const entry of entries) {
    addToBucket(totals, entry);
    (byCategory[entry.category] ??= emptyBucket());
    addToBucket(byCategory[entry.category], entry);
    (bySource[entry.source] ??= emptyBucket());
    addToBucket(bySource[entry.source], entry);
  }

  const reconciledNetCents = entries
    .filter(e => e.reconciled)
    .reduce((sum, e) => sum + e.netCents, 0);
  const reconciledCount = entries.filter(e => e.reconciled).length;

  const ticketsSold = (byCategory.ticket?.quantity) || 0;

  return {
    currency: opts.currency || "usd",
    generatedAt: opts.generatedAt || null,
    totals: {
      grossCents: totals.grossCents,
      refundCents: totals.refundCents,
      feeCents: totals.feeCents,
      netCents: totals.netCents,
      count: totals.count,
      effectiveFeeRatePct: pct(totals.feeCents, totals.grossCents)
    },
    byCategory,
    bySource,
    reconciliation: {
      reconciledNetCents,
      unreconciledNetCents: totals.netCents - reconciledNetCents,
      reconciledCount,
      unreconciledCount: entries.length - reconciledCount,
      pctReconciled: pct(reconciledCount, entries.length)
    },
    tickets: {
      sold: ticketsSold,
      capacity: opts.ticketCapacity ?? null,
      pctSold: opts.ticketCapacity ? pct(ticketsSold, opts.ticketCapacity) : null
    },
    spendPerAttendeeCents: opts.expectedAttendance
      ? Math.round(totals.netCents / opts.expectedAttendance)
      : null
  };
}

export function formatUsd(cents) {
  return (Number(cents || 0) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD"
  });
}
