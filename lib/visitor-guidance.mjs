const GUIDANCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export const VISITOR_GUIDANCE_CATEGORIES = Object.freeze([
  "Accessibility",
  "Arrival",
  "At the festival",
  "Family and safety",
  "Policies",
  "Tickets"
]);

export const VISITOR_GUIDANCE_RISK_LEVELS = Object.freeze(["low", "medium", "high"]);

const CATEGORY_LOOKUP = new Map(VISITOR_GUIDANCE_CATEGORIES.map(value => [value.toLowerCase(), value]));
const RISK_LEVELS = new Set(VISITOR_GUIDANCE_RISK_LEVELS);

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function validInstant(value) {
  const input = text(value, 64);
  if (!input) return null;
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function validHttpsUrl(value) {
  const input = text(value, 500);
  try {
    const parsed = new URL(input);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function validEmail(value) {
  const input = text(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input) ? input : null;
}

function normalizedKeywords(value) {
  return [...new Set((Array.isArray(value) ? value : String(value ?? "").split(","))
    .map(item => text(item, 80).toLowerCase())
    .filter(Boolean))].slice(0, 16);
}

export function normalizeVisitorGuidance(input = []) {
  return (Array.isArray(input) ? input : []).map(item => ({
    id: text(item?.id, 100),
    category: CATEGORY_LOOKUP.get(text(item?.category, 40).toLowerCase()) || "",
    question: text(item?.question, 180),
    answer: text(item?.answer, 1200),
    keywords: normalizedKeywords(item?.keywords),
    sourceLabel: text(item?.sourceLabel, 120),
    sourceUrl: validHttpsUrl(item?.sourceUrl),
    sourceCheckedAt: validInstant(item?.sourceCheckedAt),
    effectiveAt: validInstant(item?.effectiveAt),
    expiresAt: validInstant(item?.expiresAt),
    audience: text(item?.audience, 20).toLowerCase(),
    riskLevel: text(item?.riskLevel, 20).toLowerCase(),
    ownerTeam: text(item?.ownerTeam, 80).toLowerCase(),
    escalationContact: validEmail(item?.escalationContact),
    status: text(item?.status, 20).toLowerCase() === "active" ? "active" : "draft"
  }));
}

export function visitorGuidanceEntryErrors(input = [], options = {}) {
  const source = Array.isArray(input) ? input : [];
  const guidance = normalizeVisitorGuidance(source);
  const now = new Date(options.now ?? Date.now());
  const errors = [];
  if (!source.length) errors.push("At least one visitor guidance answer is required.");
  if (source.length > 100) errors.push("Visitor guidance is limited to 100 answers.");
  guidance.forEach((item, index) => {
    const label = `Guidance answer ${index + 1}`;
    if (!GUIDANCE_ID_RE.test(item.id)) errors.push(`${label} requires a safe identifier.`);
    if (!item.category) errors.push(`${label} requires an approved category.`);
    if (item.question.length < 8) errors.push(`${label} requires a visitor question.`);
    if (item.answer.length < 20) errors.push(`${label} requires a complete public answer.`);
    if (!item.keywords.length) errors.push(`${label} requires at least one matching keyword.`);
    if (!item.sourceLabel) errors.push(`${label} requires a public source label.`);
    if (!item.sourceUrl) errors.push(`${label} requires an HTTPS official source.`);
    if (!item.sourceCheckedAt) errors.push(`${label} requires a source-review time.`);
    if (item.sourceCheckedAt && item.sourceCheckedAt > now.toISOString()) errors.push(`${label} source-review time cannot be in the future.`);
    if (!item.effectiveAt || !item.expiresAt) errors.push(`${label} requires effective and expiration times.`);
    if (item.effectiveAt && item.expiresAt && item.expiresAt <= item.effectiveAt) errors.push(`${label} expiration must follow its effective time.`);
    if (item.audience !== "public") errors.push(`${label} must have a public audience.`);
    if (!RISK_LEVELS.has(item.riskLevel)) errors.push(`${label} requires an approved risk level.`);
    if (!item.ownerTeam) errors.push(`${label} requires an owner team.`);
    if (!item.escalationContact) errors.push(`${label} requires a valid escalation email.`);
  });
  const ids = guidance.map(item => item.id);
  if (new Set(ids).size !== ids.length) errors.push("Visitor guidance identifiers must be unique.");
  return { guidance, errors };
}

export function normalizeVisitorGuidancePublication(input = {}) {
  const status = text(input.status, 20).toLowerCase();
  return {
    status: ["pending", "published", "board_demo"].includes(status) ? status : "pending",
    eventId: text(input.eventId, 120) || null,
    sourceUrl: validHttpsUrl(input.sourceUrl),
    sourceCheckedAt: validInstant(input.sourceCheckedAt),
    publishedAt: validInstant(input.publishedAt),
    publishedBy: text(input.publishedBy, 160) || null,
    heldAt: validInstant(input.heldAt),
    heldBy: text(input.heldBy, 160) || null,
    holdReason: text(input.holdReason, 500) || null,
    lastUpdated: validInstant(input.lastUpdated)
  };
}

function currentActiveGuidance(guidance, now) {
  const timestamp = now.getTime();
  return guidance.filter(item => item.status === "active"
    && new Date(item.effectiveAt).getTime() <= timestamp
    && new Date(item.expiresAt).getTime() >= timestamp);
}

export function visitorGuidanceReadiness(input = {}, options = {}) {
  const publication = normalizeVisitorGuidancePublication(input.publication);
  const now = new Date(options.now ?? Date.now());
  const maxSourceAgeDays = Math.max(1, Number(options.maxSourceAgeDays ?? 90));
  const allowBoardDemo = options.allowBoardDemo === true;
  const { guidance, errors } = visitorGuidanceEntryErrors(input.guidance, { now });
  const current = errors.length ? [] : currentActiveGuidance(guidance, now);
  const sourceCheckedAt = publication.sourceCheckedAt ? new Date(publication.sourceCheckedAt) : null;
  const sourceAgeDays = sourceCheckedAt ? Math.floor((now.getTime() - sourceCheckedAt.getTime()) / 86_400_000) : null;
  const boardDemo = allowBoardDemo && publication.status === "board_demo";
  const checks = {
    published: boardDemo || (publication.status === "published" && Boolean(publication.publishedAt && publication.publishedBy)),
    event: publication.eventId === text(input.eventId, 120),
    source: boardDemo || Boolean(publication.sourceUrl && sourceCheckedAt && sourceAgeDays >= 0 && sourceAgeDays <= maxSourceAgeDays),
    guidance: errors.length === 0 && current.length > 0
  };
  const missing = Object.entries(checks).filter(([, ready]) => !ready).map(([key]) => key);
  return {
    ready: missing.length === 0,
    checks,
    missing,
    guidance,
    current,
    publication,
    sourceAgeDays,
    maxSourceAgeDays,
    reason: missing.length
      ? `Visitor guidance is not published: ${missing.join(", ")}.${errors[0] ? ` ${errors[0]}` : ""}`
      : `${current.length} source-reviewed visitor answer${current.length === 1 ? " is" : "s are"} current and published.`
  };
}

export function publishVisitorGuidance(currentInput = {}, patch = {}, options = {}) {
  const now = validInstant(options.now ?? new Date().toISOString());
  const eventId = text(options.eventId ?? patch.eventId, 120);
  const actorId = text(options.actorId, 160) || "unknown";
  const { guidance, errors } = visitorGuidanceEntryErrors(patch.guidance, { now });
  const sourceUrl = validHttpsUrl(patch.sourceUrl);
  const sourceCheckedAt = validInstant(patch.sourceCheckedAt);
  if (!/^texas-sandfest-\d{4}$/.test(eventId)) errors.push("A current Texas SandFest event id is required.");
  if (!sourceUrl) errors.push("An HTTPS official visitor-guidance source is required.");
  if (!sourceCheckedAt) errors.push("The visitor-guidance source-check time is required.");
  if (sourceCheckedAt && now && sourceCheckedAt > now) errors.push("The visitor-guidance source-check time cannot be in the future.");
  if (errors.length) return { ok: false, error: errors[0], errors };
  return {
    ok: true,
    guidance,
    publication: {
      ...normalizeVisitorGuidancePublication(currentInput.publication),
      status: "published",
      eventId,
      sourceUrl,
      sourceCheckedAt,
      publishedAt: now,
      publishedBy: actorId,
      heldAt: null,
      heldBy: null,
      holdReason: null,
      lastUpdated: now
    }
  };
}

export function holdVisitorGuidance(currentInput = {}, options = {}) {
  const now = validInstant(options.now ?? new Date().toISOString());
  const actorId = text(options.actorId, 160) || "unknown";
  const reason = text(options.reason, 500);
  if (reason.length < 8) return { ok: false, error: "A guidance hold reason of at least 8 characters is required." };
  const publication = normalizeVisitorGuidancePublication(currentInput.publication);
  return {
    ok: true,
    guidance: normalizeVisitorGuidance(currentInput.guidance),
    publication: {
      ...publication,
      status: "pending",
      eventId: text(options.eventId ?? publication.eventId, 120) || null,
      publishedAt: null,
      publishedBy: null,
      heldAt: now,
      heldBy: actorId,
      holdReason: reason,
      lastUpdated: now
    }
  };
}

export function publicVisitorGuidance(input = [], options = {}) {
  const now = new Date(options.now ?? Date.now());
  return currentActiveGuidance(normalizeVisitorGuidance(input), now).map(item => ({
    id: item.id,
    category: item.category,
    question: item.question,
    answer: item.answer,
    keywords: item.keywords,
    sourceLabel: item.sourceLabel,
    sourceUrl: item.sourceUrl,
    sourceCheckedAt: item.sourceCheckedAt,
    effectiveAt: item.effectiveAt,
    expiresAt: item.expiresAt
  }));
}

export const visitorGuidancePolicy = Object.freeze({
  categories: VISITOR_GUIDANCE_CATEGORIES,
  riskLevels: VISITOR_GUIDANCE_RISK_LEVELS,
  maxAnswers: 100
});
