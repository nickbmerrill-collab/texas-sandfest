import { DEFAULT_EVENT_ID } from "./event-context.mjs";

// Consent capture — Phase 0 glue from docs/research/08-marketing-communications.md.
//
// Ticket purchase ≠ marketing consent. Capture three independent flags at
// checkout (and later from VolunteerLocal / Eventeny imports):
//   - emailMarketing  → Brevo list sync
//   - smsMarketing    → promo SMS (A2P marketing campaign)
//   - smsSafety       → public event/safety alerts (A2P emergency campaign)
// A marketing STOP must never suppress safety SMS; keep channels separate.
//
// Pure module: normalize records, summarize opt-in counts, filter recipients.

export const CONSENT_CHANNELS = ["emailMarketing", "smsMarketing", "smsSafety"];
export const CONSENT_SOURCES = [
  "checkout",
  "import",
  "volunteerlocal",
  "eventeny",
  "keyword",
  "manual",
  "web_form"
];

function normalizeChannel(raw, now) {
  if (raw == null || typeof raw !== "object") {
    return { optedIn: false, at: null, source: null, optedOutAt: null, optedOutSource: null };
  }
  const optedIn = Boolean(raw.optedIn ?? raw.consented ?? raw.value);
  const source = CONSENT_SOURCES.includes(raw.source) ? raw.source : (optedIn ? "manual" : null);
  const optedOutAt = !optedIn && raw.optedOutAt ? String(raw.optedOutAt) : null;
  const optedOutSource = optedOutAt
    ? (CONSENT_SOURCES.includes(raw.optedOutSource) ? raw.optedOutSource : "manual")
    : null;
  return {
    optedIn,
    at: optedIn ? (raw.at || now || null) : (raw.at ?? null),
    source: optedIn ? source : (raw.source && CONSENT_SOURCES.includes(raw.source) ? raw.source : null),
    optedOutAt,
    optedOutSource
  };
}

function channelEvidenceAt(channel) {
  const candidates = [channel?.at, channel?.optedOutAt]
    .map(value => Date.parse(value || ""))
    .filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : null;
}

function mergeChannel(previous, incoming) {
  const before = normalizeChannel(previous);
  const next = normalizeChannel(incoming);
  const beforeAt = channelEvidenceAt(before);
  const nextAt = channelEvidenceAt(next);
  if (nextAt == null) return before;
  if (beforeAt != null && nextAt < beforeAt) return before;
  return next;
}

function cleanEmail(value) {
  if (value == null || value === "") return null;
  const email = String(value).trim().toLowerCase().slice(0, 160);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

// Accepts E.164-ish or US 10-digit; returns E.164 or null.
export function normalizePhone(value) {
  if (value == null || value === "") return null;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (String(value).trim().startsWith("+") && digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

export function normalizeConsent(raw = {}, opts = {}) {
  const now = opts.now || null;
  const email = cleanEmail(raw.email);
  const phone = normalizePhone(raw.phone);
  return {
    id: raw.id ?? null,
    eventId: raw.eventId ?? DEFAULT_EVENT_ID,
    email,
    phone,
    emailMarketing: normalizeChannel(raw.emailMarketing ?? raw.emailConsent, now),
    smsMarketing: normalizeChannel(raw.smsMarketing ?? raw.smsPromo, now),
    smsSafety: normalizeChannel(raw.smsSafety ?? raw.smsConsent, now),
    orderId: raw.orderId ?? null,
    customerId: raw.customerId ?? null,
    source: CONSENT_SOURCES.includes(raw.source) ? raw.source : "checkout",
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now
  };
}

export function mergeConsentRecords(previousInput, incomingInput) {
  const previous = normalizeConsent(previousInput || {});
  const incoming = normalizeConsent(incomingInput || {});
  return normalizeConsent({
    ...previous,
    ...incoming,
    id: previous.id || incoming.id,
    eventId: previous.eventId || incoming.eventId,
    email: incoming.email || previous.email,
    phone: incoming.phone || previous.phone,
    emailMarketing: mergeChannel(previous.emailMarketing, incoming.emailMarketing),
    smsMarketing: mergeChannel(previous.smsMarketing, incoming.smsMarketing),
    smsSafety: mergeChannel(previous.smsSafety, incoming.smsSafety),
    createdAt: previous.createdAt || incoming.createdAt,
    updatedAt: incoming.updatedAt || previous.updatedAt
  });
}

const SMS_STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const SMS_START_KEYWORDS = new Set(["START", "UNSTOP", "YES"]);
const SMS_HELP_KEYWORDS = new Set(["HELP", "INFO"]);

export function smsPreferenceAction(optOutType, body) {
  const providerType = String(optOutType || "").trim().toUpperCase();
  if (["STOP", "START", "HELP"].includes(providerType)) return providerType;
  const keyword = String(body || "").trim().toUpperCase();
  if (SMS_STOP_KEYWORDS.has(keyword)) return "STOP";
  if (SMS_START_KEYWORDS.has(keyword)) return "START";
  if (SMS_HELP_KEYWORDS.has(keyword)) return "HELP";
  return null;
}

export function applySmsConsentKeyword(rawLedger, input = {}, opts = {}) {
  const channel = input.channel;
  if (!["smsMarketing", "smsSafety"].includes(channel)) {
    return { ok: false, error: "SMS consent channel must be smsMarketing or smsSafety." };
  }
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "SMS preference webhook did not include a valid sender phone." };
  const action = smsPreferenceAction(input.optOutType, input.body);
  if (!action) return { ok: true, ignored: true, action: null, changed: 0, doc: rawLedger };

  const now = opts.now || new Date().toISOString();
  const ledger = rawLedger && typeof rawLedger === "object" ? rawLedger : {};
  const records = (Array.isArray(ledger.records) ? ledger.records : []).map(record => normalizeConsent(record));
  let matches = records.map((record, index) => record.phone === phone ? index : -1).filter(index => index >= 0);
  let created = false;
  if (matches.length === 0 && action !== "HELP") {
    records.push(normalizeConsent({
      id: opts.idFactory ? opts.idFactory("consent") : `consent_keyword_${Date.now()}`,
      eventId: ledger.eventId || input.eventId || DEFAULT_EVENT_ID,
      phone,
      source: "keyword",
      createdAt: now,
      updatedAt: now
    }, { now }));
    matches = [records.length - 1];
    created = true;
  }

  if (action !== "HELP") {
    for (const index of matches) {
      const record = records[index];
      const current = record[channel];
      records[index] = normalizeConsent({
        ...record,
        [channel]: action === "START"
          ? { optedIn: true, at: now, source: "keyword", optedOutAt: null, optedOutSource: null }
          : { optedIn: false, at: current?.at || null, source: current?.source || null, optedOutAt: now, optedOutSource: "keyword" },
        updatedAt: now
      });
    }
  }

  return {
    ok: true,
    action,
    channel,
    changed: action === "HELP" ? 0 : matches.length,
    created,
    phone,
    doc: {
      ...ledger,
      eventId: ledger.eventId || input.eventId || DEFAULT_EVENT_ID,
      lastUpdated: action === "HELP" ? ledger.lastUpdated || null : now,
      records
    }
  };
}

// Build a consent record from a checkout body (unchecked = false).
export function consentFromCheckout(body = {}, { orderId, eventId = DEFAULT_EVENT_ID, idFactory, now } = {}) {
  const timestamp = now || new Date().toISOString();
  const email = cleanEmail(body.email ?? body.customer?.email);
  const phone = normalizePhone(body.phone ?? body.customer?.phone);
  const source = "checkout";

  // Unchecked boxes must never default to true.
  const emailMarketing = Boolean(body.consent?.emailMarketing ?? body.emailMarketing);
  const smsMarketing = Boolean(body.consent?.smsMarketing ?? body.smsMarketing);
  const smsSafety = Boolean(body.consent?.smsSafety ?? body.smsSafety ?? body.smsConsent);

  return normalizeConsent({
    id: idFactory ? idFactory() : `consent_${Date.now()}`,
    eventId,
    email,
    phone,
    emailMarketing: { optedIn: emailMarketing, at: emailMarketing ? timestamp : null, source },
    smsMarketing: { optedIn: smsMarketing, at: smsMarketing ? timestamp : null, source },
    smsSafety: { optedIn: smsSafety, at: smsSafety ? timestamp : null, source },
    orderId: orderId ?? null,
    source,
    createdAt: timestamp,
    updatedAt: timestamp
  }, { now: timestamp });
}

export function summarizeConsent(rawRecords = [], opts = {}) {
  const records = rawRecords.map(r => normalizeConsent(r));
  const withEmail = records.filter(r => r.email).length;
  const withPhone = records.filter(r => r.phone).length;
  const emailMarketing = records.filter(r => r.emailMarketing.optedIn && r.email).length;
  const smsMarketing = records.filter(r => r.smsMarketing.optedIn && r.phone).length;
  const smsSafety = records.filter(r => r.smsSafety.optedIn && r.phone).length;

  return {
    eventId: opts.eventId || DEFAULT_EVENT_ID,
    generatedAt: opts.generatedAt || null,
    totals: {
      records: records.length,
      withEmail,
      withPhone,
      emailMarketing,
      smsMarketing,
      smsSafety
    }
  };
}

export function recipientsForChannel(rawRecords = [], channel) {
  if (!CONSENT_CHANNELS.includes(channel)) return [];
  const records = rawRecords.map(r => normalizeConsent(r));
  if (channel === "emailMarketing") {
    return records
      .filter(r => r.emailMarketing.optedIn && r.email)
      .map(r => ({ id: r.id, email: r.email, phone: r.phone }));
  }
  return records
    .filter(r => r[channel].optedIn && r.phone)
    .map(r => ({ id: r.id, email: r.email, phone: r.phone }));
}

// Whether a checkout payload is "valid enough" to store consent.
// Email is required if any marketing email opt-in; phone if any SMS opt-in.
export function validateCheckoutConsent(body = {}) {
  const emailMarketing = Boolean(body.consent?.emailMarketing ?? body.emailMarketing);
  const smsMarketing = Boolean(body.consent?.smsMarketing ?? body.smsMarketing);
  const smsSafety = Boolean(body.consent?.smsSafety ?? body.smsSafety ?? body.smsConsent);
  const email = cleanEmail(body.email ?? body.customer?.email);
  const phone = normalizePhone(body.phone ?? body.customer?.phone);

  if (emailMarketing && !email) {
    return { error: "Email is required when opting into festival email updates." };
  }
  if ((smsMarketing || smsSafety) && !phone) {
    return { error: "A valid mobile number is required when opting into SMS." };
  }
  return { ok: true, email, phone, emailMarketing, smsMarketing, smsSafety };
}
