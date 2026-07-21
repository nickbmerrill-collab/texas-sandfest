const SCHEDULE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const TWENTY_FOUR_HOUR_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TWELVE_HOUR_RE = /^(1[0-2]|0?[1-9]):([0-5]\d)\s*(AM|PM)$/i;

export const EVENT_SCHEDULE_DAYS = Object.freeze(["Friday", "Saturday", "Sunday"]);
export const EVENT_SCHEDULE_CATEGORIES = Object.freeze([
  "Activity",
  "Competition",
  "Entertainment",
  "Family",
  "Music",
  "Program",
  "Public",
  "Visitor"
]);

const DAY_LOOKUP = new Map(EVENT_SCHEDULE_DAYS.map(day => [day.toLowerCase(), day]));
const CATEGORY_LOOKUP = new Map(EVENT_SCHEDULE_CATEGORIES.map(category => [category.toLowerCase(), category]));

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

function displayTime(value) {
  const input = text(value, 20).toUpperCase();
  if (TWENTY_FOUR_HOUR_RE.test(input)) {
    const [hourInput, minutes] = input.split(":");
    const hour = Number(hourInput);
    return `${hour % 12 || 12}:${minutes} ${hour >= 12 ? "PM" : "AM"}`;
  }
  const match = input.match(TWELVE_HOUR_RE);
  if (!match) return null;
  return `${Number(match[1])}:${match[2]} ${match[3].toUpperCase()}`;
}

function scheduleSlug(value) {
  return text(value, 180)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56) || "program";
}

function generatedScheduleId(item, index) {
  const day = text(item.day, 40).slice(0, 3).toLowerCase() || "day";
  const time = displayTime(item.time)?.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase() || String(index + 1);
  return `${day}-${time}-${scheduleSlug(item.title)}`.slice(0, 100);
}

export function normalizeEventSchedule(input = []) {
  return (Array.isArray(input) ? input : []).map((item, index) => ({
    id: text(item?.id, 100) || generatedScheduleId(item || {}, index),
    day: DAY_LOOKUP.get(text(item?.day, 40).toLowerCase()) || "",
    time: displayTime(item?.time) || "",
    title: text(item?.title, 180),
    zone: text(item?.zone, 120),
    category: CATEGORY_LOOKUP.get(text(item?.category, 40).toLowerCase()) || ""
  }));
}

export function eventScheduleEntryErrors(input = []) {
  const source = Array.isArray(input) ? input : [];
  const schedule = normalizeEventSchedule(source);
  const errors = [];
  if (!source.length) errors.push("At least one public schedule item is required.");
  if (source.length > 500) errors.push("Public schedules are limited to 500 items.");
  schedule.forEach((item, index) => {
    const label = `Schedule item ${index + 1}`;
    if (!SCHEDULE_ID_RE.test(item.id)) errors.push(`${label} requires a safe identifier.`);
    if (!item.day) errors.push(`${label} requires Friday, Saturday, or Sunday.`);
    if (!item.time) errors.push(`${label} requires a valid time.`);
    if (!item.title) errors.push(`${label} requires a title.`);
    if (!item.zone) errors.push(`${label} requires a public location.`);
    if (!item.category) errors.push(`${label} requires an approved public category.`);
  });
  const ids = schedule.map(item => item.id);
  if (new Set(ids).size !== ids.length) errors.push("Public schedule item identifiers must be unique.");
  return { schedule, errors };
}

export function normalizeEventSchedulePublication(input = {}) {
  return {
    status: ["pending", "published", "board_demo"].includes(text(input.status, 20).toLowerCase())
      ? text(input.status, 20).toLowerCase()
      : "pending",
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

export function publishEventSchedule(currentInput = {}, patch = {}, options = {}) {
  const now = validInstant(options.now ?? new Date().toISOString());
  const actorId = text(options.actorId, 160) || "unknown";
  const eventId = text(options.eventId ?? patch.eventId, 120);
  const { schedule, errors } = eventScheduleEntryErrors(patch.schedule);
  const sourceUrl = validHttpsUrl(patch.sourceUrl);
  const sourceCheckedAt = validInstant(patch.sourceCheckedAt);
  if (!/^texas-sandfest-\d{4}$/.test(eventId)) errors.push("A current Texas SandFest event id is required.");
  if (!sourceUrl) errors.push("An HTTPS official schedule source is required.");
  if (!sourceCheckedAt) errors.push("The official schedule source-check time is required.");
  if (sourceCheckedAt && now && sourceCheckedAt > now) errors.push("The official schedule source-check time cannot be in the future.");
  if (errors.length) return { ok: false, error: errors[0], errors };
  return {
    ok: true,
    schedule,
    publication: {
      ...normalizeEventSchedulePublication(currentInput.publication),
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

export function holdEventSchedule(currentInput = {}, options = {}) {
  const now = validInstant(options.now ?? new Date().toISOString());
  const actorId = text(options.actorId, 160) || "unknown";
  const reason = text(options.reason, 500);
  if (reason.length < 8) return { ok: false, error: "A schedule hold reason of at least 8 characters is required." };
  const publication = normalizeEventSchedulePublication(currentInput.publication);
  return {
    ok: true,
    schedule: [],
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

export function eventScheduleReadiness(input = {}, options = {}) {
  const publication = normalizeEventSchedulePublication(input.publication);
  const now = new Date(options.now ?? Date.now());
  const maxSourceAgeDays = Math.max(1, Number(options.maxSourceAgeDays ?? 90));
  const allowBoardDemo = options.allowBoardDemo === true;
  if (allowBoardDemo && publication.status === "board_demo") {
    const { schedule, errors } = eventScheduleEntryErrors(input.schedule);
    return {
      ready: errors.length === 0,
      schedule,
      publication,
      missing: errors.length ? ["schedule"] : [],
      sourceAgeDays: null,
      maxSourceAgeDays,
      reason: errors.length ? errors[0] : `${schedule.length} synthetic schedule items are isolated to the board demonstration.`
    };
  }
  const { schedule, errors } = eventScheduleEntryErrors(input.schedule);
  const sourceCheckedAt = publication.sourceCheckedAt ? new Date(publication.sourceCheckedAt) : null;
  const sourceAgeDays = sourceCheckedAt ? Math.floor((now.getTime() - sourceCheckedAt.getTime()) / 86_400_000) : null;
  const checks = {
    published: publication.status === "published" && Boolean(publication.publishedAt && publication.publishedBy),
    event: Boolean(publication.eventId && publication.eventId === text(input.eventId, 120)),
    source: Boolean(publication.sourceUrl && sourceCheckedAt && sourceAgeDays >= 0 && sourceAgeDays <= maxSourceAgeDays),
    schedule: errors.length === 0
  };
  const missing = Object.entries(checks).filter(([, ready]) => !ready).map(([key]) => key);
  return {
    ready: missing.length === 0,
    checks,
    missing,
    schedule,
    publication,
    sourceAgeDays,
    maxSourceAgeDays,
    reason: missing.length
      ? `The detailed ${text(input.eventId, 120) || "event"} schedule is not published: ${missing.join(", ")}.`
      : `${schedule.length} public schedule item${schedule.length === 1 ? " is" : "s are"} source-reviewed and published.`
  };
}
