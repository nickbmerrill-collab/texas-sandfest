const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function validDate(value) {
  const input = text(value, 10);
  if (!DATE_RE.test(input)) return null;
  const parsed = new Date(`${input}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === input ? input : null;
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

function formatDateRange(startDate, endDate) {
  if (!startDate || !endDate) return "Dates to be announced";
  const start = new Date(`${startDate}T12:00:00.000Z`);
  const end = new Date(`${endDate}T12:00:00.000Z`);
  const startMonth = start.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const endMonth = end.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  if (startYear === endYear && startMonth === endMonth) return `${startMonth} ${startDay}-${endDay}, ${startYear}`;
  if (startYear === endYear) return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${startYear}`;
  return `${startMonth} ${startDay}, ${startYear} - ${endMonth} ${endDay}, ${endYear}`;
}

function formatTime(value) {
  if (!TIME_RE.test(value || "")) return null;
  const [hours, minutes] = value.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export function normalizeEventGuide(input = {}) {
  const startDate = validDate(input.startDate);
  const endDate = validDate(input.endDate);
  const dailyOpen = TIME_RE.test(text(input.dailyOpen, 5)) ? text(input.dailyOpen, 5) : null;
  const dailyClose = TIME_RE.test(text(input.dailyClose, 5)) ? text(input.dailyClose, 5) : null;
  const year = startDate ? Number(startDate.slice(0, 4)) : null;
  return {
    id: text(input.id, 120) || (year ? `texas-sandfest-${year}` : "texas-sandfest"),
    name: text(input.name, 120) || "Texas SandFest",
    startDate,
    endDate,
    dateRange: formatDateRange(startDate, endDate),
    dailyOpen,
    dailyClose,
    hours: dailyOpen && dailyClose ? `${formatTime(dailyOpen)} - ${formatTime(dailyClose)} daily` : "Hours to be announced",
    timeZone: text(input.timeZone, 80) || "America/Chicago",
    location: text(input.location, 240),
    mission: text(input.mission, 600),
    phone: text(input.phone, 40),
    email: validEmail(input.email),
    address: text(input.address, 300),
    sourceUrl: validHttpsUrl(input.sourceUrl),
    sourceCheckedAt: validInstant(input.sourceCheckedAt),
    status: text(input.status, 20).toLowerCase() || "published",
    publishedAt: validInstant(input.publishedAt),
    publishedBy: text(input.publishedBy, 160) || null,
    lastUpdated: validInstant(input.lastUpdated)
  };
}

export function publishEventGuide(currentInput, patch = {}, options = {}) {
  const now = validInstant(options.now ?? new Date().toISOString());
  const actorId = text(options.actorId, 160) || "unknown";
  const current = normalizeEventGuide(currentInput);
  const candidate = normalizeEventGuide({ ...current, ...patch, status: "published", publishedAt: now, publishedBy: actorId, lastUpdated: now });
  const errors = [];
  if (!candidate.name) errors.push("Event name is required.");
  if (!candidate.startDate || !candidate.endDate) errors.push("Valid start and end dates are required.");
  if (candidate.startDate && candidate.endDate && candidate.endDate < candidate.startDate) errors.push("Event end date cannot precede the start date.");
  const eventIdYear = Number(candidate.id.match(/^texas-sandfest-(\d{4})$/)?.[1]);
  const startYear = candidate.startDate ? Number(candidate.startDate.slice(0, 4)) : null;
  if (!eventIdYear || (startYear && eventIdYear !== startYear)) errors.push("Event id and start-date year must match.");
  if (!candidate.dailyOpen || !candidate.dailyClose) errors.push("Daily opening and closing times are required.");
  if (candidate.dailyOpen && candidate.dailyClose && candidate.dailyClose <= candidate.dailyOpen) errors.push("Daily closing time must be after opening time.");
  if (!candidate.location) errors.push("Event location is required.");
  if (!candidate.mission) errors.push("Public event description is required.");
  if (!candidate.email) errors.push("A valid public contact email is required.");
  if (!candidate.sourceUrl) errors.push("An HTTPS official source URL is required.");
  if (!candidate.sourceCheckedAt) errors.push("The official source check time is required.");
  if (candidate.sourceCheckedAt && now && candidate.sourceCheckedAt > now) errors.push("The official source check time cannot be in the future.");
  return errors.length ? { ok: false, error: errors[0], errors } : { ok: true, guide: candidate };
}

export function publicEventGuide(input = {}) {
  const guide = normalizeEventGuide(input);
  return {
    id: guide.id,
    name: guide.name,
    startDate: guide.startDate,
    endDate: guide.endDate,
    dateRange: guide.dateRange,
    dailyOpen: guide.dailyOpen,
    dailyClose: guide.dailyClose,
    hours: guide.hours,
    timeZone: guide.timeZone,
    location: guide.location,
    mission: guide.mission,
    phone: guide.phone,
    email: guide.email,
    address: guide.address,
    sourceUrl: guide.sourceUrl,
    sourceCheckedAt: guide.sourceCheckedAt,
    lastUpdated: guide.lastUpdated
  };
}

export function eventGuideReadiness(input = {}, options = {}) {
  const guide = normalizeEventGuide(input);
  const now = new Date(options.now ?? Date.now());
  const maxSourceAgeDays = Math.max(1, Number(options.maxSourceAgeDays ?? 90));
  const sourceCheckedAt = guide.sourceCheckedAt ? new Date(guide.sourceCheckedAt) : null;
  const endAt = guide.endDate ? new Date(`${guide.endDate}T23:59:59.999Z`) : null;
  const sourceAgeDays = sourceCheckedAt ? Math.floor((now.getTime() - sourceCheckedAt.getTime()) / 86_400_000) : null;
  const checks = {
    published: guide.status === "published" && Boolean(guide.publishedAt),
    dates: Boolean(guide.startDate && guide.endDate && guide.endDate >= guide.startDate),
    upcoming: Boolean(endAt && endAt.getTime() >= now.getTime()),
    hours: Boolean(guide.dailyOpen && guide.dailyClose && guide.dailyClose > guide.dailyOpen),
    contact: Boolean(guide.email && guide.location),
    source: Boolean(guide.sourceUrl && sourceCheckedAt && sourceAgeDays >= 0 && sourceAgeDays <= maxSourceAgeDays)
  };
  const missing = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  return {
    ready: missing.length === 0,
    checks,
    missing,
    sourceAgeDays,
    maxSourceAgeDays,
    guide: publicEventGuide(guide),
    reason: missing.length
      ? `Published event guide is not launch-ready: ${missing.join(", ")}.`
      : `Published event guide is current for ${guide.dateRange}; official source checked ${sourceAgeDays} day${sourceAgeDays === 1 ? "" : "s"} ago.`
  };
}
