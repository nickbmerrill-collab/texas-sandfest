export const DEFAULT_EVENT_ID = "texas-sandfest-2027";

const EVENT_ID_RE = /^texas-sandfest-(\d{4})$/;

export function parseEventId(value) {
  const input = String(value ?? "").trim().toLowerCase();
  const match = input.match(EVENT_ID_RE);
  if (!match) return null;
  return { id: input, year: Number(match[1]) };
}

export function eventContextConfig(env = {}) {
  const configured = String(env.SANDFEST_EVENT_ID ?? "").trim();
  if (!configured) {
    const parsed = parseEventId(DEFAULT_EVENT_ID);
    return { eventId: parsed.id, year: parsed.year, explicit: false, valid: true };
  }
  const parsed = parseEventId(configured);
  if (!parsed) {
    const fallback = parseEventId(DEFAULT_EVENT_ID);
    return {
      eventId: fallback.id,
      year: fallback.year,
      explicit: true,
      valid: false,
      reason: "SANDFEST_EVENT_ID must use the form texas-sandfest-YYYY."
    };
  }
  return { eventId: parsed.id, year: parsed.year, explicit: true, valid: true };
}

export function eventContextReadiness({ config, guide = {}, operationalDocs = [] } = {}) {
  const resolved = config ?? eventContextConfig();
  const guideId = parseEventId(guide.id)?.id ?? null;
  const guideYear = /^\d{4}-\d{2}-\d{2}$/.test(String(guide.startDate || ""))
    ? Number(String(guide.startDate).slice(0, 4))
    : null;
  const mismatchedDocs = operationalDocs
    .filter(item => item?.eventId !== resolved.eventId)
    .map(item => ({ key: item.key, eventId: item?.eventId ?? null }));
  const checks = {
    configured: resolved.valid,
    guideId: guideId === resolved.eventId,
    guideYear: guideYear === resolved.year,
    operationalDocs: mismatchedDocs.length === 0
  };
  const missing = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  const ready = missing.length === 0;
  return {
    ready,
    eventId: resolved.eventId,
    year: resolved.year,
    explicit: resolved.explicit,
    checks,
    missing,
    guideId,
    guideYear,
    mismatchedDocs,
    reason: ready
      ? `Current-event context is aligned to ${resolved.eventId}.`
      : [
          resolved.valid ? null : resolved.reason,
          guideId !== resolved.eventId ? `Published guide id is ${guideId || "missing"}; expected ${resolved.eventId}.` : null,
          guideYear !== resolved.year ? `Published guide year is ${guideYear || "missing"}; expected ${resolved.year}.` : null,
          mismatchedDocs.length ? `Operational documents are missing or assigned to another event: ${mismatchedDocs.map(item => `${item.key}=${item.eventId || "missing"}`).join(", ")}.` : null
        ].filter(Boolean).join(" ")
  };
}
