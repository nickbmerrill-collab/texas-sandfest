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
    note: raw.note ?? ""
  };
}

function emptyBucket() {
  return { grossCents: 0, feeCents: 0, netCents: 0, count: 0, quantity: 0 };
}

function addToBucket(bucket, entry) {
  bucket.grossCents += entry.grossCents;
  bucket.feeCents += entry.feeCents;
  bucket.netCents += entry.netCents;
  bucket.count += 1;
  if (entry.quantity != null) bucket.quantity += entry.quantity;
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
