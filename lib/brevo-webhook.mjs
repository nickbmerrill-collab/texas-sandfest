import { createHash, timingSafeEqual } from "node:crypto";
import { normalizePartnerOperations, updateOutreachProspect } from "./partner-ops.mjs";

const MAX_BATCH_SIZE = 100;
const MAX_DELIVERY_EVENTS = 100;
const MAX_RECEIPTS = 1000;
const MAX_PENDING_EVENTS = 200;
const PENDING_RETENTION_MS = 7 * 86_400_000;

const EVENT_TYPES = new Map([
  ["request", { type: "sent", status: "accepted" }],
  ["sent", { type: "sent", status: "accepted" }],
  ["delivered", { type: "delivered", status: "delivered" }],
  ["opened", { type: "opened", status: "opened" }],
  ["uniqueopened", { type: "opened", status: "opened" }],
  ["click", { type: "clicked", status: "clicked" }],
  ["clicked", { type: "clicked", status: "clicked" }],
  ["softbounce", { type: "deferred", status: "deferred" }],
  ["deferred", { type: "deferred", status: "deferred" }],
  ["hardbounce", { type: "hard_bounce", status: "bounced", suppress: true }],
  ["invalid", { type: "invalid", status: "bounced", suppress: true }],
  ["blocked", { type: "blocked", status: "blocked", suppress: true }],
  ["spam", { type: "complaint", status: "complaint", suppress: true }],
  ["complaint", { type: "complaint", status: "complaint", suppress: true }],
  ["unsubscribed", { type: "unsubscribed", status: "unsubscribed", suppress: true }],
  ["error", { type: "error", status: "failed" }]
]);

const TERMINAL_STATUSES = new Set(["bounced", "blocked", "complaint", "unsubscribed", "failed"]);
const DELIVERY_RANK = new Map([
  ["accepted", 1],
  ["deferred", 2],
  ["delivered", 3],
  ["opened", 4],
  ["clicked", 5]
]);

function clean(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value, 254).toLowerCase());
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name) || "";
  const match = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = match?.[1];
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function safeEqual(left, right) {
  const leftDigest = createHash("sha256").update(String(left)).digest();
  const rightDigest = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function publicApiBase(env, production, missing) {
  const value = clean(env.SANDFEST_API_PUBLIC_BASE_URL, 2000).replace(/\/+$/, "");
  if (!value) {
    if (production) missing.push("SANDFEST_API_PUBLIC_BASE_URL(https)");
    return null;
  }
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("unsafe URL");
    if (production && url.protocol !== "https:") throw new Error("HTTPS required");
    return url.toString().replace(/\/+$/, "");
  } catch {
    missing.push("SANDFEST_API_PUBLIC_BASE_URL(valid https URL)");
    return null;
  }
}

export function brevoWebhookConfig(env = process.env) {
  const emailEnabled = env.TRANSACTIONAL_EMAIL_ENABLED === "true";
  const production = env.SANDFEST_ENV === "production" || env.NODE_ENV === "production";
  const token = clean(env.BREVO_WEBHOOK_TOKEN, 500);
  // Keep the callback available during an outbound-email pause so delayed
  // delivery and complaint events can still close the loop safely.
  const enabled = emailEnabled || Boolean(token);
  const missing = [];
  if (enabled && token.length < 32) missing.push("BREVO_WEBHOOK_TOKEN(32+ characters)");
  const apiBase = publicApiBase(env, production && enabled, missing);
  return {
    provider: "brevo",
    enabled,
    emailEnabled,
    ready: enabled && missing.length === 0,
    reason: !enabled ? "BREVO_WEBHOOK_TOKEN not configured" : missing.length ? `Missing ${missing.join(", ")}` : null,
    token,
    url: apiBase ? `${apiBase}/api/webhooks/brevo` : null,
    maxBatchSize: MAX_BATCH_SIZE
  };
}

export function publicBrevoWebhookReadiness(config = brevoWebhookConfig()) {
  return {
    provider: config.provider,
    enabled: config.enabled,
    ready: config.ready,
    urlConfigured: Boolean(config.url),
    reason: config.reason
  };
}

export function verifyBrevoWebhookAuthorization(headers, config = brevoWebhookConfig()) {
  if (!config.ready || !config.token) return false;
  const authorization = clean(headerValue(headers, "authorization"), 1000);
  if (!authorization.startsWith("Bearer ")) return false;
  const supplied = authorization.slice(7);
  return Boolean(supplied) && safeEqual(supplied, config.token);
}

export function normalizeBrevoMessageId(value) {
  return clean(value, 500).replace(/^<|>$/g, "");
}

function eventTime(input) {
  const candidates = [input?.ts_event, input?.ts_epoch, input?.date, input?.ts];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") continue;
    const numeric = Number(candidate);
    const millis = Number.isFinite(numeric)
      ? numeric > 10_000_000_000 ? numeric : numeric * 1000
      : Date.parse(String(candidate));
    if (Number.isFinite(millis)) return new Date(millis).toISOString();
  }
  return null;
}

function normalizeEvent(input, index) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: `Brevo event ${index + 1} must be an object.` };
  }
  const rawType = clean(input.event, 40).toLowerCase().replace(/[^a-z]/g, "");
  const mapped = EVENT_TYPES.get(rawType);
  if (!mapped) return { ok: false, error: `Brevo event ${index + 1} has an unsupported event type.` };
  const email = clean(input.email, 254).toLowerCase();
  if (!validEmail(email)) return { ok: false, error: `Brevo event ${index + 1} has an invalid recipient.` };
  const occurredAt = eventTime(input);
  if (!occurredAt) return { ok: false, error: `Brevo event ${index + 1} has an invalid event time.` };
  const providerEventId = clean(input.id, 200) || null;
  const messageId = normalizeBrevoMessageId(input["message-id"] || input.messageId);
  const subject = clean(input.subject, 998);
  const idMaterial = [providerEventId || "", rawType, messageId, occurredAt, email].join("\n");
  return {
    ok: true,
    event: {
      id: `brevo_${createHash("sha256").update(idMaterial).digest("hex")}`,
      provider: "brevo",
      providerEventId,
      type: mapped.type,
      deliveryStatus: mapped.status,
      suppress: mapped.suppress === true,
      email,
      messageId: messageId || null,
      subject: subject || null,
      occurredAt
    }
  };
}

export function normalizeBrevoWebhookEvents(payload) {
  const input = Array.isArray(payload) ? payload : Array.isArray(payload?.events) ? payload.events : [payload];
  if (!input.length) return { ok: false, error: "Brevo webhook batch is empty." };
  if (input.length > MAX_BATCH_SIZE) return { ok: false, error: `Brevo webhook batch exceeds ${MAX_BATCH_SIZE} events.` };
  const events = [];
  for (let index = 0; index < input.length; index += 1) {
    const normalized = normalizeEvent(input[index], index);
    if (!normalized.ok) return normalized;
    events.push(normalized.event);
  }
  return { ok: true, events };
}

function matchingFollowup(doc, event) {
  if (event.messageId) {
    const candidates = doc.followups.filter(item =>
      item.provider === "brevo"
      && normalizeBrevoMessageId(item.providerMessageId) === event.messageId
      && clean(item.recipient, 254).toLowerCase() === event.email
    );
    return candidates.length === 1 ? candidates[0] : null;
  }
  if (!event.subject) return null;
  const candidates = doc.followups.filter(item =>
    item.status === "sent"
    && clean(item.recipient, 254).toLowerCase() === event.email
    && clean(item.subject, 998) === event.subject
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function nextDeliveryStatus(current, incoming) {
  if (TERMINAL_STATUSES.has(current)) return current;
  if (TERMINAL_STATUSES.has(incoming)) return incoming;
  return (DELIVERY_RANK.get(incoming) || 0) >= (DELIVERY_RANK.get(current) || 0) ? incoming : current;
}

function suppressionReason(status) {
  if (status === "bounced") return "Brevo reported a hard bounce or invalid recipient.";
  if (status === "blocked") return "Brevo blocked delivery to this recipient.";
  if (status === "complaint") return "Recipient reported this email as spam.";
  if (status === "unsubscribed") return "Recipient unsubscribed through the email provider.";
  return null;
}

function applyEventToFollowup(doc, followup, event, now) {
  const index = doc.followups.findIndex(item => item.id === followup.id);
  const deliveryStatus = nextDeliveryStatus(followup.deliveryStatus || "accepted", event.deliveryStatus);
  const deliveryEvent = {
    id: event.id,
    provider: event.provider,
    providerEventId: event.providerEventId,
    type: event.type,
    status: event.deliveryStatus,
    occurredAt: event.occurredAt,
    recordedAt: now
  };
  const updated = {
    ...followup,
    deliveryStatus,
    deliveryEvents: [...(Array.isArray(followup.deliveryEvents) ? followup.deliveryEvents : []), deliveryEvent].slice(-MAX_DELIVERY_EVENTS),
    deliveredAt: event.deliveryStatus === "delivered" ? followup.deliveredAt || event.occurredAt : followup.deliveredAt || null,
    openedAt: event.deliveryStatus === "opened" ? followup.openedAt || event.occurredAt : followup.openedAt || null,
    clickedAt: event.deliveryStatus === "clicked" ? followup.clickedAt || event.occurredAt : followup.clickedAt || null,
    failedAt: TERMINAL_STATUSES.has(event.deliveryStatus) ? followup.failedAt || event.occurredAt : followup.failedAt || null,
    lastError: TERMINAL_STATUSES.has(event.deliveryStatus)
      ? suppressionReason(event.deliveryStatus) || "Brevo reported a terminal delivery failure."
      : followup.lastError || null,
    updatedAt: now
  };
  const followups = doc.followups.slice();
  followups[index] = updated;
  return { ...doc, lastUpdated: now, followups };
}

export function applyBrevoDeliveryEvents(docInput, eventsInput = [], options = {}) {
  let doc = normalizePartnerOperations(docInput);
  const now = options.now ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();
  const incoming = Array.isArray(eventsInput) ? eventsInput : [];
  const receipts = Array.isArray(doc.brevoWebhookReceipts) ? doc.brevoWebhookReceipts.slice(-MAX_RECEIPTS) : [];
  const receiptById = new Map(receipts.map(item => [item.id, item]));
  const pending = (Array.isArray(doc.brevoPendingEvents) ? doc.brevoPendingEvents : [])
    .filter(item => nowMs - new Date(item.receivedAt || item.occurredAt).getTime() <= PENDING_RETENTION_MS);
  const candidateById = new Map(pending.map(item => [item.id, item]));
  const newEventIds = new Set();
  let duplicates = 0;
  for (const event of incoming) {
    if (candidateById.has(event.id) || receiptById.get(event.id)?.matchedFollowupId) {
      duplicates += 1;
      continue;
    }
    candidateById.set(event.id, { ...event, receivedAt: now });
    newEventIds.add(event.id);
  }

  const nextPending = [];
  let matched = 0;
  let unmatched = 0;
  let suppressed = 0;
  let dismissed = 0;
  for (const event of candidateById.values()) {
    const followup = matchingFollowup(doc, event);
    if (!followup) {
      nextPending.push(event);
      if (newEventIds.has(event.id)) unmatched += 1;
      receiptById.set(event.id, {
        id: event.id,
        provider: "brevo",
        type: event.type,
        status: event.deliveryStatus,
        matchedFollowupId: null,
        occurredAt: event.occurredAt,
        receivedAt: event.receivedAt || now
      });
      continue;
    }
    if ((followup.deliveryEvents || []).some(item => item.id === event.id)) {
      receiptById.set(event.id, { ...(receiptById.get(event.id) || {}), matchedFollowupId: followup.id });
      continue;
    }
    doc = applyEventToFollowup(doc, followup, event, now);
    matched += 1;
    receiptById.set(event.id, {
      id: event.id,
      provider: "brevo",
      type: event.type,
      status: event.deliveryStatus,
      matchedFollowupId: followup.id,
      occurredAt: event.occurredAt,
      receivedAt: event.receivedAt || now
    });
    const reason = event.suppress ? suppressionReason(event.deliveryStatus) : null;
    if (reason && followup.prospectId) {
      const prospect = doc.prospects.find(item => item.id === followup.prospectId);
      if (prospect && !prospect.suppressedAt && prospect.status !== "do_not_contact") {
        const activeBefore = doc.followups.filter(item => item.prospectId === prospect.id && ["pending", "draft_ready", "approved", "queued", "failed"].includes(item.status)).length;
        const result = updateOutreachProspect(doc, prospect.id, {
          status: "do_not_contact",
          suppressed: true,
          suppressionReason: reason
        }, { actorId: "brevo-webhook", now });
        if (result.ok) {
          doc = result.doc;
          suppressed += 1;
          const activeAfter = doc.followups.filter(item => item.prospectId === prospect.id && ["pending", "draft_ready", "approved", "queued", "failed"].includes(item.status)).length;
          dismissed += Math.max(0, activeBefore - activeAfter);
        }
      }
    }
  }

  doc = {
    ...doc,
    lastUpdated: matched || incoming.length ? now : doc.lastUpdated,
    brevoWebhookReceipts: [...receiptById.values()].slice(-MAX_RECEIPTS),
    brevoPendingEvents: nextPending.slice(-MAX_PENDING_EVENTS)
  };
  return {
    ok: true,
    doc,
    received: incoming.length,
    matched,
    unmatched,
    duplicates,
    suppressed,
    dismissed,
    pending: doc.brevoPendingEvents.length
  };
}
