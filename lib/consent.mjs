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
    return { optedIn: false, at: null, source: null };
  }
  const optedIn = Boolean(raw.optedIn ?? raw.consented ?? raw.value);
  const source = CONSENT_SOURCES.includes(raw.source) ? raw.source : (optedIn ? "manual" : null);
  return {
    optedIn,
    at: optedIn ? (raw.at || now || null) : (raw.at ?? null),
    source: optedIn ? source : (raw.source && CONSENT_SOURCES.includes(raw.source) ? raw.source : null)
  };
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
    eventId: raw.eventId ?? "texas-sandfest-2026",
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

// Build a consent record from a checkout body (unchecked = false).
export function consentFromCheckout(body = {}, { orderId, idFactory, now } = {}) {
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
    eventId: opts.eventId || "texas-sandfest-2026",
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
