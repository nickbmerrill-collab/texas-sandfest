import { createHash, timingSafeEqual } from "node:crypto";
import { DEFAULT_EVENT_ID } from "./event-context.mjs";

export const GUEST_SERVICES_CONSENT_VERSION = "guest-services-intake-v1";
export const GUEST_SERVICES_CATEGORIES = Object.freeze([
  { id: "lost_item", label: "Lost item", defaultTeam: "guest-services", defaultPriority: "normal" },
  { id: "accessibility", label: "Accessibility help", defaultTeam: "guest-services", defaultPriority: "high" },
  { id: "ticketing", label: "Ticket or entry help", defaultTeam: "ticketing", defaultPriority: "normal" },
  { id: "family_reunification", label: "Separated party", defaultTeam: "guest-services", defaultPriority: "urgent" },
  { id: "vendor_question", label: "Vendor or food question", defaultTeam: "guest-services", defaultPriority: "normal" },
  { id: "general", label: "General visitor help", defaultTeam: "guest-services", defaultPriority: "normal" }
]);

export const GUEST_SERVICES_STATUSES = Object.freeze(["open", "in_progress", "waiting_for_guest", "resolved", "closed"]);
export const GUEST_SERVICES_PRIORITIES = Object.freeze(["normal", "high", "urgent"]);
export const GUEST_SERVICES_TEAMS = Object.freeze([
  { id: "guest-services", label: "Guest services" },
  { id: "ticketing", label: "Ticketing" },
  { id: "operations", label: "Operations" },
  { id: "safety", label: "Safety" }
]);

const categoryById = new Map(GUEST_SERVICES_CATEGORIES.map(item => [item.id, item]));
const teamIds = new Set(GUEST_SERVICES_TEAMS.map(item => item.id));
const statusIds = new Set(GUEST_SERVICES_STATUSES);
const priorityIds = new Set(GUEST_SERVICES_PRIORITIES);

function text(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function multiline(value, max) {
  return String(value ?? "").trim().replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, max);
}

function email(value) {
  const normalized = text(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : "";
}

function tokenHash(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function equalHash(left, right) {
  if (!/^[a-f0-9]{64}$/.test(String(left || "")) || !/^[a-f0-9]{64}$/.test(String(right || ""))) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function publicGuestServicesReadiness({ eventId = DEFAULT_EVENT_ID, available = false } = {}) {
  return {
    eventId: text(eventId, 100) || DEFAULT_EVENT_ID,
    available: available === true,
    consentVersion: GUEST_SERVICES_CONSENT_VERSION,
    categories: GUEST_SERVICES_CATEGORIES.map(({ id, label }) => ({ id, label }))
  };
}

export function publicGuestServicesReadinessSafety(input, { eventId = DEFAULT_EVENT_ID } = {}) {
  const errors = [];
  const allowedKeys = new Set(["eventId", "available", "consentVersion", "categories"]);
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const unexpectedKeys = Object.keys(source).filter(key => !allowedKeys.has(key));
  if (unexpectedKeys.length) errors.push(`Unexpected Guest Services readiness fields: ${unexpectedKeys.join(", ")}.`);
  if (source.eventId !== eventId) errors.push(`Guest Services readiness must match ${eventId}.`);
  if (typeof source.available !== "boolean") errors.push("Guest Services availability must be explicit.");
  if (source.consentVersion !== GUEST_SERVICES_CONSENT_VERSION) errors.push("Guest Services consent version is missing or stale.");
  const categories = Array.isArray(source.categories) ? source.categories : [];
  const expected = new Map(GUEST_SERVICES_CATEGORIES.map(item => [item.id, item.label]));
  if (categories.length !== expected.size) errors.push(`Guest Services readiness must expose ${expected.size} categories.`);
  const seen = new Set();
  for (const category of categories) {
    const categoryKeys = Object.keys(category && typeof category === "object" ? category : {});
    if (categoryKeys.some(key => !["id", "label"].includes(key))) errors.push("Guest Services categories expose private routing fields.");
    if (!expected.has(category?.id) || expected.get(category.id) !== category.label || seen.has(category.id)) {
      errors.push("Guest Services categories do not match the approved public catalog.");
      continue;
    }
    seen.add(category.id);
  }
  return { ready: errors.length === 0, errors: [...new Set(errors)] };
}

function normalizeUpdate(item = {}) {
  return {
    id: text(item.id, 100),
    status: statusIds.has(item.status) ? item.status : "open",
    message: multiline(item.message, 1_000),
    public: item.public === true,
    actorId: text(item.actorId, 160) || "system",
    at: text(item.at, 40)
  };
}

function normalizeCase(item = {}, eventId = DEFAULT_EVENT_ID) {
  const category = categoryById.get(item.category) || categoryById.get("general");
  const contactEmail = email(item.contact?.email);
  return {
    id: text(item.id, 100),
    eventId: text(item.eventId, 100) || eventId,
    reference: text(item.reference, 40).toUpperCase(),
    accessTokenHash: text(item.accessTokenHash, 64).toLowerCase(),
    idempotencyKeyHash: text(item.idempotencyKeyHash, 64).toLowerCase() || null,
    idempotencyFingerprint: text(item.idempotencyFingerprint, 64).toLowerCase() || null,
    category: category.id,
    title: text(item.title, 140),
    details: multiline(item.details, 2_000),
    location: text(item.location, 160) || null,
    festivalDay: text(item.festivalDay, 20) || null,
    contact: {
      name: text(item.contact?.name, 120),
      email: contactEmail || null,
      phone: text(item.contact?.phone, 40) || null,
      preference: ["email", "phone"].includes(item.contact?.preference) ? item.contact.preference : contactEmail ? "email" : "phone"
    },
    consent: {
      accepted: item.consent?.accepted === true,
      version: text(item.consent?.version, 80) || GUEST_SERVICES_CONSENT_VERSION,
      acceptedAt: text(item.consent?.acceptedAt, 40) || null
    },
    priority: priorityIds.has(item.priority) ? item.priority : category.defaultPriority,
    status: statusIds.has(item.status) ? item.status : "open",
    assignedTeam: teamIds.has(item.assignedTeam) ? item.assignedTeam : category.defaultTeam,
    createdAt: text(item.createdAt, 40),
    updatedAt: text(item.updatedAt, 40),
    resolvedAt: text(item.resolvedAt, 40) || null,
    updates: (Array.isArray(item.updates) ? item.updates : []).map(normalizeUpdate).filter(update => update.id && update.at).slice(-100)
  };
}

export function emptyGuestServices(eventId = DEFAULT_EVENT_ID) {
  return { eventId, lastUpdated: null, cases: [] };
}

export function normalizeGuestServices(input, { eventId = DEFAULT_EVENT_ID } = {}) {
  const source = input && typeof input === "object" ? input : emptyGuestServices(eventId);
  const resolvedEventId = text(source.eventId, 100) || eventId;
  return {
    eventId: resolvedEventId,
    lastUpdated: text(source.lastUpdated, 40) || null,
    cases: (Array.isArray(source.cases) ? source.cases : [])
      .map(item => normalizeCase(item, resolvedEventId))
      .filter(item => item.id && item.reference && item.eventId === resolvedEventId)
      .slice(-10_000)
  };
}

export function guestServicesIntakeFingerprint(input = {}) {
  const canonical = JSON.stringify({
    category: text(input.category, 40),
    title: text(input.title, 140),
    details: multiline(input.details, 2_000),
    location: text(input.location, 160),
    festivalDay: text(input.festivalDay, 20),
    contactName: text(input.contactName, 120),
    contactEmail: text(input.contactEmail, 254).toLowerCase(),
    contactPhone: text(input.contactPhone, 40),
    contactPreference: text(input.contactPreference, 20),
    consentToContact: input.consentToContact === true
  });
  return tokenHash(canonical);
}

export function validateGuestServicesIntake(input = {}) {
  const category = categoryById.get(text(input.category, 40));
  if (!category) return { ok: false, error: "Choose a type of help." };
  const title = text(input.title, 140);
  const details = multiline(input.details, 2_000);
  const contactName = text(input.contactName, 120);
  const contactEmail = email(input.contactEmail);
  const contactPhone = text(input.contactPhone, 40);
  const contactPreference = ["email", "phone"].includes(input.contactPreference) ? input.contactPreference : contactEmail ? "email" : "phone";
  if (!title || title.length < 4) return { ok: false, error: "Add a short summary of the help needed." };
  if (!details || details.length < 10) return { ok: false, error: "Add a few details so Guest Services can route the request." };
  if (!contactName) return { ok: false, error: "Add a contact name." };
  if (!contactEmail && !contactPhone) return { ok: false, error: "Add an email address or mobile number." };
  if (input.contactEmail && !contactEmail) return { ok: false, error: "Enter a valid email address." };
  if (contactPreference === "email" && !contactEmail) return { ok: false, error: "Add an email address for email updates." };
  if (contactPreference === "phone" && !contactPhone) return { ok: false, error: "Add a mobile number for phone updates." };
  if (input.consentToContact !== true) return { ok: false, error: "Consent is required so Guest Services can respond." };
  return {
    ok: true,
    value: {
      category: category.id,
      title,
      details,
      location: text(input.location, 160) || null,
      festivalDay: text(input.festivalDay, 20) || null,
      contact: { name: contactName, email: contactEmail || null, phone: contactPhone || null, preference: contactPreference },
      priority: category.defaultPriority,
      assignedTeam: category.defaultTeam
    }
  };
}

export function createGuestServicesCase(docInput, input, options = {}) {
  const doc = normalizeGuestServices(docInput, { eventId: options.eventId });
  const validation = validateGuestServicesIntake(input);
  if (!validation.ok) return validation;
  const idempotencyKeyHash = text(options.idempotencyKeyHash, 64).toLowerCase() || null;
  const idempotencyFingerprint = text(options.idempotencyFingerprint, 64).toLowerCase() || guestServicesIntakeFingerprint(input);
  if (idempotencyKeyHash) {
    const replay = doc.cases.find(item => item.idempotencyKeyHash === idempotencyKeyHash);
    if (replay) {
      if (replay.idempotencyFingerprint !== idempotencyFingerprint) return { ok: false, conflict: true, error: "That request key was already used for different details." };
      return { ok: true, replay: true, case: replay, doc };
    }
  }
  const now = options.now || new Date().toISOString();
  const id = options.idFactory?.("guest_case");
  const reference = options.referenceFactory?.();
  const accessToken = options.accessTokenFactory?.({ id, reference });
  if (!id || !reference || !accessToken) return { ok: false, error: "Guest Services intake is not configured." };
  const record = normalizeCase({
    id,
    eventId: doc.eventId,
    reference,
    accessTokenHash: tokenHash(accessToken),
    idempotencyKeyHash,
    idempotencyFingerprint,
    ...validation.value,
    consent: { accepted: true, version: GUEST_SERVICES_CONSENT_VERSION, acceptedAt: now },
    status: "open",
    createdAt: now,
    updatedAt: now,
    updates: [{ id: options.idFactory("guest_update"), status: "open", message: "Guest Services received your request.", public: true, actorId: "public-intake", at: now }]
  }, doc.eventId);
  const next = { ...doc, lastUpdated: now, cases: [...doc.cases, record] };
  return { ok: true, replay: false, accessToken, case: record, doc: next };
}

export function findGuestServicesCase(docInput, reference, accessToken, options = {}) {
  const doc = normalizeGuestServices(docInput, options);
  const normalizedReference = text(reference, 40).toUpperCase();
  const candidate = doc.cases.find(item => item.reference === normalizedReference);
  const presentedHash = tokenHash(text(accessToken, 240));
  if (!candidate || !equalHash(candidate.accessTokenHash, presentedHash)) return { ok: false, error: "Guest Services request not found." };
  return { ok: true, case: candidate, doc };
}

export function publicGuestServicesCase(record) {
  const category = categoryById.get(record.category) || categoryById.get("general");
  return {
    reference: record.reference,
    category: record.category,
    categoryLabel: category.label,
    title: record.title,
    priority: record.priority,
    status: record.status,
    assignedTeam: record.assignedTeam,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    resolvedAt: record.resolvedAt,
    updates: record.updates.filter(update => update.public).map(update => ({ status: update.status, message: update.message, at: update.at }))
  };
}

export function updateGuestServicesCase(docInput, caseId, input = {}, options = {}) {
  const doc = normalizeGuestServices(docInput, { eventId: options.eventId });
  const index = doc.cases.findIndex(item => item.id === caseId);
  if (index < 0) return { ok: false, notFound: true, error: "Guest Services case not found." };
  const current = doc.cases[index];
  const status = Object.hasOwn(input, "status") ? text(input.status, 40) : current.status;
  const priority = Object.hasOwn(input, "priority") ? text(input.priority, 40) : current.priority;
  const assignedTeam = Object.hasOwn(input, "assignedTeam") ? text(input.assignedTeam, 80) : current.assignedTeam;
  if (!statusIds.has(status)) return { ok: false, error: "Choose a valid case status." };
  if (!priorityIds.has(priority)) return { ok: false, error: "Choose a valid priority." };
  if (!teamIds.has(assignedTeam)) return { ok: false, error: "Choose a valid response team." };
  const publicMessage = multiline(input.publicMessage, 1_000);
  const internalNote = multiline(input.internalNote, 1_000);
  if (input.publishUpdate === true && !publicMessage) return { ok: false, error: "Add a visitor update before publishing it." };
  const changed = status !== current.status || priority !== current.priority || assignedTeam !== current.assignedTeam || Boolean(publicMessage || internalNote);
  if (!changed) return { ok: true, changed: false, case: current, doc };
  const now = options.now || new Date().toISOString();
  const updates = current.updates.slice();
  if (publicMessage) updates.push(normalizeUpdate({ id: options.idFactory?.("guest_update"), status, message: publicMessage, public: input.publishUpdate === true, actorId: options.actorId || "staff", at: now }));
  if (internalNote) updates.push(normalizeUpdate({ id: options.idFactory?.("guest_update"), status, message: internalNote, public: false, actorId: options.actorId || "staff", at: now }));
  if (!publicMessage && !internalNote && status !== current.status) updates.push(normalizeUpdate({ id: options.idFactory?.("guest_update"), status, message: `Status changed to ${status.replaceAll("_", " ")}.`, public: false, actorId: options.actorId || "staff", at: now }));
  const record = {
    ...current,
    status,
    priority,
    assignedTeam,
    updatedAt: now,
    resolvedAt: ["resolved", "closed"].includes(status) ? current.resolvedAt || now : null,
    updates: updates.filter(update => update.id).slice(-100)
  };
  const cases = doc.cases.slice();
  cases[index] = record;
  return { ok: true, changed: true, case: record, doc: { ...doc, lastUpdated: now, cases } };
}

export function guestServicesDashboard(docInput, options = {}) {
  const doc = normalizeGuestServices(docInput, options);
  const active = doc.cases.filter(item => !["resolved", "closed"].includes(item.status));
  const counts = Object.fromEntries(GUEST_SERVICES_STATUSES.map(status => [status, doc.cases.filter(item => item.status === status).length]));
  return {
    eventId: doc.eventId,
    lastUpdated: doc.lastUpdated,
    summary: {
      total: doc.cases.length,
      active: active.length,
      urgent: active.filter(item => item.priority === "urgent").length,
      unassigned: active.filter(item => !item.assignedTeam).length,
      resolved: counts.resolved + counts.closed,
      statuses: counts
    },
    categories: GUEST_SERVICES_CATEGORIES,
    teams: GUEST_SERVICES_TEAMS,
    cases: doc.cases.slice().sort((left, right) => {
      const priority = { urgent: 0, high: 1, normal: 2 };
      const activeOrder = value => ["resolved", "closed"].includes(value) ? 1 : 0;
      return activeOrder(left.status) - activeOrder(right.status)
        || priority[left.priority] - priority[right.priority]
        || String(right.updatedAt).localeCompare(String(left.updatedAt));
    })
  };
}
