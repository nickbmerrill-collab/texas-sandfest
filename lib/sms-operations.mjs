import { createHash } from "node:crypto";
import { DEFAULT_EVENT_ID } from "./event-context.mjs";

const PROVIDER_STATUSES = new Set([
  "accepted", "scheduled", "queued", "sending", "sent", "delivered", "undelivered", "failed", "canceled", "read"
]);
const TERMINAL_STATUSES = new Set(["delivered", "undelivered", "failed", "canceled", "read", "delivery_unknown", "suppressed"]);
const STATUS_RANK = {
  pending: 0,
  queued: 1,
  sending: 2,
  accepted: 3,
  scheduled: 3,
  sent: 4,
  delivered: 5,
  read: 6,
  undelivered: 6,
  failed: 6,
  canceled: 6,
  delivery_unknown: 6,
  suppressed: 6
};

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function nowIso(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeMessage(raw = {}) {
  return {
    id: String(raw.id || ""),
    campaignId: String(raw.campaignId || ""),
    consentRecordId: String(raw.consentRecordId || ""),
    recipientHash: String(raw.recipientHash || ""),
    status: String(raw.status || "queued"),
    jobId: raw.jobId ? String(raw.jobId) : null,
    providerMessageSid: raw.providerMessageSid ? String(raw.providerMessageSid) : null,
    providerStatus: raw.providerStatus ? String(raw.providerStatus) : null,
    errorCode: raw.errorCode == null ? null : String(raw.errorCode).slice(0, 40),
    error: raw.error ? String(raw.error).slice(0, 500) : null,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
    submittedAt: raw.submittedAt || null,
    deliveredAt: raw.deliveredAt || null,
    terminalAt: raw.terminalAt || null
  };
}

function campaignCounts(messages) {
  const counts = {
    total: messages.length,
    queued: 0,
    sending: 0,
    accepted: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    suppressed: 0,
    unknown: 0
  };
  for (const message of messages) {
    if (message.status === "queued") counts.queued += 1;
    else if (message.status === "sending") counts.sending += 1;
    else if (["accepted", "scheduled"].includes(message.status)) counts.accepted += 1;
    else if (message.status === "sent") counts.sent += 1;
    else if (["delivered", "read"].includes(message.status)) counts.delivered += 1;
    else if (["failed", "undelivered", "canceled"].includes(message.status)) counts.failed += 1;
    else if (message.status === "suppressed") counts.suppressed += 1;
    else if (message.status === "delivery_unknown") counts.unknown += 1;
  }
  return counts;
}

function campaignState(counts) {
  if (counts.total === 0) return "empty";
  if (counts.delivered === counts.total) return "delivered";
  if (counts.failed + counts.suppressed + counts.unknown === counts.total) return "failed";
  if (counts.queued + counts.sending === counts.total) return "queued";
  if (counts.delivered + counts.failed + counts.suppressed + counts.unknown === counts.total) return "complete_with_exceptions";
  return "in_progress";
}

function refreshCampaigns(doc, now, campaignIds = null) {
  const selected = campaignIds ? new Set(campaignIds) : null;
  doc.campaigns = doc.campaigns.map(campaign => {
    if (selected && !selected.has(campaign.id)) return campaign;
    const messages = doc.messages.filter(message => message.campaignId === campaign.id);
    const counts = campaignCounts(messages);
    return { ...campaign, status: campaignState(counts), counts, updatedAt: now };
  });
  return doc;
}

export function emptySmsOperations(eventId = DEFAULT_EVENT_ID) {
  return {
    eventId,
    lastUpdated: null,
    campaigns: [],
    messages: [],
    preferenceEvents: []
  };
}

export function normalizeSmsOperations(raw, { eventId = DEFAULT_EVENT_ID } = {}) {
  const doc = raw && typeof raw === "object" ? raw : {};
  return {
    eventId: doc.eventId || eventId,
    lastUpdated: doc.lastUpdated || null,
    campaigns: (Array.isArray(doc.campaigns) ? doc.campaigns : []).map(campaign => ({
      id: String(campaign.id || ""),
      alertId: String(campaign.alertId || ""),
      alertVersion: String(campaign.alertVersion || ""),
      title: String(campaign.title || "").slice(0, 120),
      severity: String(campaign.severity || "info").slice(0, 20),
      status: String(campaign.status || "queued"),
      recipientCount: Number(campaign.recipientCount || 0),
      counts: campaign.counts || null,
      createdAt: campaign.createdAt || null,
      updatedAt: campaign.updatedAt || null
    })).filter(campaign => campaign.id),
    messages: (Array.isArray(doc.messages) ? doc.messages : []).map(normalizeMessage).filter(message => message.id),
    preferenceEvents: (Array.isArray(doc.preferenceEvents) ? doc.preferenceEvents : []).map(event => ({
      id: String(event.id || ""),
      providerMessageSid: event.providerMessageSid ? String(event.providerMessageSid) : null,
      channel: String(event.channel || ""),
      action: String(event.action || ""),
      recipientHash: String(event.recipientHash || ""),
      at: event.at || null
    })).filter(event => event.id).slice(-5000)
  };
}

export function createSmsAlertCampaign(raw, { alert, recipients = [], limit = 500 } = {}, opts = {}) {
  const now = nowIso(opts.now);
  const doc = normalizeSmsOperations(raw, { eventId: opts.eventId });
  if (opts.eventId && doc.eventId !== opts.eventId) {
    return {
      ok: false,
      eventContextMismatch: true,
      error: `SMS operations are assigned to ${doc.eventId}; expected ${opts.eventId}.`,
      doc,
      campaign: null,
      messages: []
    };
  }
  const boundedRecipients = recipients
    .filter(recipient => recipient?.id && recipient?.phone)
    .slice(0, Math.max(0, Math.min(5000, Number(limit) || 500)));
  const alertVersion = String(alert?.updatedAt || alert?.publishedAt || now);
  const campaignId = `sms_campaign_${digest(`${doc.eventId}\0${alert?.id || "alert"}\0${alertVersion}`).slice(0, 32)}`;
  const existing = doc.campaigns.find(campaign => campaign.id === campaignId);
  if (existing) {
    return {
      ok: true,
      duplicate: true,
      doc,
      campaign: existing,
      messages: doc.messages.filter(message => message.campaignId === campaignId)
    };
  }
  const messages = boundedRecipients.map(recipient => ({
    id: `sms_message_${digest(`${campaignId}\0${recipient.id}`).slice(0, 32)}`,
    campaignId,
    consentRecordId: String(recipient.id),
    recipientHash: digest(`${doc.eventId}\0${recipient.phone}`),
    status: "queued",
    jobId: null,
    providerMessageSid: null,
    providerStatus: null,
    errorCode: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    deliveredAt: null,
    terminalAt: null
  }));
  const counts = campaignCounts(messages);
  const campaign = {
    id: campaignId,
    alertId: String(alert?.id || ""),
    alertVersion,
    title: String(alert?.title || "SandFest alert").slice(0, 120),
    severity: String(alert?.severity || "info").slice(0, 20),
    status: campaignState(counts),
    recipientCount: messages.length,
    counts,
    createdAt: now,
    updatedAt: now
  };
  doc.campaigns.push(campaign);
  doc.messages.push(...messages);
  doc.lastUpdated = now;
  return { ok: true, duplicate: false, doc, campaign, messages };
}

export function attachSmsJob(raw, messageId, jobId, opts = {}) {
  const result = attachSmsJobs(raw, [{ messageId, jobId }], opts);
  return { ...result, message: result.messages?.[0] || null };
}

export function attachSmsJobs(raw, assignments = [], opts = {}) {
  const now = nowIso(opts.now);
  const doc = normalizeSmsOperations(raw, { eventId: opts.eventId });
  const jobByMessage = new Map(assignments.map(item => [String(item.messageId || ""), String(item.jobId || "") || null]));
  const missing = [...jobByMessage.keys()].filter(messageId => !doc.messages.some(message => message.id === messageId));
  if (missing.length) return { ok: false, error: `SMS message record not found: ${missing[0]}`, doc };
  const campaignIds = new Set();
  doc.messages = doc.messages.map(message => {
    if (!jobByMessage.has(message.id)) return message;
    campaignIds.add(message.campaignId);
    return { ...message, jobId: jobByMessage.get(message.id), updatedAt: now };
  });
  doc.lastUpdated = now;
  refreshCampaigns(doc, now, campaignIds);
  return {
    ok: true,
    doc,
    messages: doc.messages.filter(message => jobByMessage.has(message.id))
  };
}

export function beginSmsSubmission(raw, messageId, opts = {}) {
  const now = nowIso(opts.now);
  const doc = normalizeSmsOperations(raw, { eventId: opts.eventId });
  const index = doc.messages.findIndex(message => message.id === messageId);
  if (index === -1) return { ok: false, error: "SMS message record not found.", doc };
  const current = doc.messages[index];
  if (current.providerMessageSid || ["accepted", "sent", "delivered", "read"].includes(current.status)) {
    return { ok: true, duplicate: true, doc, message: current };
  }
  if (current.status === "sending") {
    return { ok: false, deliveryUnknown: true, error: "SMS submission was already in progress; manual provider reconciliation is required.", doc, message: current };
  }
  if (TERMINAL_STATUSES.has(current.status)) {
    return { ok: false, terminal: true, error: `SMS message is ${current.status}.`, doc, message: current };
  }
  doc.messages[index] = { ...current, status: "sending", error: null, errorCode: null, updatedAt: now };
  doc.lastUpdated = now;
  refreshCampaigns(doc, now, [doc.messages[index].campaignId]);
  return { ok: true, duplicate: false, doc, message: doc.messages[index] };
}

export function recordSmsSubmission(raw, messageId, result = {}, opts = {}) {
  const now = nowIso(opts.now);
  const doc = normalizeSmsOperations(raw, { eventId: opts.eventId });
  const index = doc.messages.findIndex(message => message.id === messageId);
  if (index === -1) return { ok: false, error: "SMS message record not found.", doc };
  const current = doc.messages[index];
  const status = result.ok
    ? (PROVIDER_STATUSES.has(result.status) ? result.status : "accepted")
    : result.unknownOutcome ? "delivery_unknown" : result.skipped ? "suppressed" : "failed";
  doc.messages[index] = {
    ...current,
    status,
    providerStatus: result.status || null,
    providerMessageSid: result.sid || current.providerMessageSid || null,
    errorCode: result.twilioCode == null ? null : String(result.twilioCode),
    error: result.error ? String(result.error).slice(0, 500) : null,
    submittedAt: result.ok ? now : current.submittedAt,
    terminalAt: TERMINAL_STATUSES.has(status) ? now : null,
    updatedAt: now
  };
  doc.lastUpdated = now;
  refreshCampaigns(doc, now, [doc.messages[index].campaignId]);
  return { ok: true, doc, message: doc.messages[index] };
}

export function recordSmsStatusCallback(raw, input = {}, opts = {}) {
  const now = nowIso(opts.now);
  const doc = normalizeSmsOperations(raw, { eventId: opts.eventId });
  const providerStatus = String(input.status || "").toLowerCase();
  if (!PROVIDER_STATUSES.has(providerStatus)) return { ok: false, error: "Unsupported Twilio message status.", doc };
  const index = input.messageId
    ? doc.messages.findIndex(message => message.id === input.messageId)
    : doc.messages.findIndex(message => input.providerMessageSid && message.providerMessageSid === input.providerMessageSid);
  if (index === -1) return { ok: false, unmatched: true, error: "Twilio status callback did not match an SMS message.", doc };
  const current = doc.messages[index];
  if (current.providerMessageSid && input.providerMessageSid && current.providerMessageSid !== input.providerMessageSid) {
    return { ok: false, error: "Twilio MessageSid did not match the stored SMS message.", doc };
  }
  const currentRank = STATUS_RANK[current.status] ?? 0;
  const nextRank = STATUS_RANK[providerStatus] ?? 0;
  const duplicate = current.providerStatus === providerStatus && current.providerMessageSid === input.providerMessageSid;
  if (!duplicate && nextRank >= currentRank) {
    doc.messages[index] = {
      ...current,
      status: providerStatus,
      providerStatus,
      providerMessageSid: input.providerMessageSid || current.providerMessageSid,
      errorCode: input.errorCode == null || input.errorCode === "" ? null : String(input.errorCode).slice(0, 40),
      error: input.error ? String(input.error).slice(0, 500) : null,
      deliveredAt: ["delivered", "read"].includes(providerStatus) ? now : current.deliveredAt,
      terminalAt: TERMINAL_STATUSES.has(providerStatus) ? now : current.terminalAt,
      updatedAt: now
    };
    doc.lastUpdated = now;
    refreshCampaigns(doc, now, [doc.messages[index].campaignId]);
  }
  return { ok: true, duplicate, ignoredRegression: !duplicate && nextRank < currentRank, doc, message: doc.messages[index] };
}

export function recordSmsPreferenceEvent(raw, input = {}, opts = {}) {
  const now = nowIso(opts.now);
  const doc = normalizeSmsOperations(raw, { eventId: opts.eventId });
  const providerMessageSid = String(input.providerMessageSid || "");
  const eventId = providerMessageSid
    ? `sms_preference_${digest(`${input.channel}\0${providerMessageSid}`).slice(0, 32)}`
    : `sms_preference_${digest(`${input.channel}\0${input.recipientHash}\0${input.action}\0${now}`).slice(0, 32)}`;
  const existing = doc.preferenceEvents.find(event => event.id === eventId);
  if (existing) return { ok: true, duplicate: true, doc, event: existing };
  const event = {
    id: eventId,
    providerMessageSid: providerMessageSid || null,
    channel: String(input.channel || ""),
    action: String(input.action || ""),
    recipientHash: String(input.recipientHash || ""),
    at: now
  };
  doc.preferenceEvents = [...doc.preferenceEvents, event].slice(-5000);
  doc.lastUpdated = now;
  return { ok: true, duplicate: false, doc, event };
}

export function suppressSmsCampaignsForAlert(raw, alertId, opts = {}) {
  const now = nowIso(opts.now);
  const doc = normalizeSmsOperations(raw, { eventId: opts.eventId });
  const campaignIds = new Set(doc.campaigns
    .filter(campaign => campaign.alertId === String(alertId || ""))
    .map(campaign => campaign.id));
  let suppressed = 0;
  doc.messages = doc.messages.map(message => {
    if (!campaignIds.has(message.campaignId) || message.status !== "queued") return message;
    suppressed += 1;
    return {
      ...message,
      status: "suppressed",
      error: "Alert was cleared before SMS submission.",
      terminalAt: now,
      updatedAt: now
    };
  });
  if (suppressed > 0) {
    doc.lastUpdated = now;
    refreshCampaigns(doc, now, campaignIds);
  }
  return { ok: true, suppressed, doc };
}

export function smsOperationsAdminPayload(raw, options = {}) {
  const doc = normalizeSmsOperations(raw, options);
  const messagesByCampaign = new Map(doc.campaigns.map(campaign => [
    campaign.id,
    doc.messages.filter(message => message.campaignId === campaign.id)
  ]));
  const campaigns = doc.campaigns.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).map(campaign => {
    const counts = campaignCounts(messagesByCampaign.get(campaign.id) || []);
    return {
      id: campaign.id,
      alertId: campaign.alertId,
      title: campaign.title,
      severity: campaign.severity,
      status: campaignState(counts),
      counts,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt
    };
  });
  const totals = campaignCounts(doc.messages);
  const preferenceTotals = { STOP: 0, START: 0, HELP: 0 };
  for (const event of doc.preferenceEvents) {
    if (Object.hasOwn(preferenceTotals, event.action)) preferenceTotals[event.action] += 1;
  }
  return {
    eventId: doc.eventId,
    lastUpdated: doc.lastUpdated,
    summary: { campaigns: campaigns.length, messages: totals, preferences: preferenceTotals },
    campaigns: campaigns.slice(0, 50)
  };
}

export function smsRecipientHash(eventId, phone) {
  return digest(`${eventId || DEFAULT_EVENT_ID}\0${phone || ""}`);
}
