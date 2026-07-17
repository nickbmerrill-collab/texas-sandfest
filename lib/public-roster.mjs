import { DEFAULT_EVENT_ID } from "./event-context.mjs";

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function validIso(value) {
  const input = text(value, 64);
  if (!input) return false;
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === input;
}

function validHttps(value) {
  try {
    const url = new URL(text(value, 1000));
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function idsFor(records, label, issues) {
  const ids = new Set();
  for (const record of records) {
    const id = text(record?.id, 120);
    if (!id) {
      issues.push(`${label} record is missing an id.`);
    } else if (ids.has(id)) {
      issues.push(`${label} id ${id} is duplicated.`);
    } else {
      ids.add(id);
    }
  }
  return ids;
}

export function publicSculptorRosterPublication(input, {
  eventId = DEFAULT_EVENT_ID,
  allowSample = false
} = {}) {
  const data = input && typeof input === "object" ? input : {};
  const meta = data.meta && typeof data.meta === "object" ? data.meta : {};
  const status = text(meta.publicationStatus, 40).toLowerCase();
  const source = text(meta.source, 120).toLowerCase();
  const rosterEventId = text(meta.eventId, 120);
  const sculptors = Array.isArray(data.sculptors) ? data.sculptors : [];
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const pois = Array.isArray(data.pois) ? data.pois : [];

  if (status === "sample") {
    const demoReady = allowSample
      && rosterEventId === eventId
      && source === "fictional_board_demo"
      && sculptors.length > 0
      && entries.length > 0;
    return {
      visible: demoReady,
      mode: demoReady ? "demo" : "unpublished",
      issues: demoReady ? [] : ["Sample sculptor data is restricted to the local board demonstration."],
      counts: { sculptors: sculptors.length, entries: entries.length, pois: pois.length }
    };
  }

  if (status !== "published") {
    return {
      visible: false,
      mode: "unpublished",
      issues: ["The current sculptor roster is not published."],
      counts: { sculptors: sculptors.length, entries: entries.length, pois: pois.length }
    };
  }

  const issues = [];
  if (rosterEventId !== eventId) issues.push(`Roster event ${rosterEventId || "missing"} does not match ${eventId}.`);
  if (!source || /(?:awaiting|demo|fictional|placeholder|sample)/i.test(source)) issues.push("Published roster source is not authoritative.");
  if (!validHttps(meta.sourceUrl)) issues.push("Published roster sourceUrl must be HTTPS.");
  if (!validIso(meta.sourceCheckedAt)) issues.push("Published roster sourceCheckedAt must be an ISO timestamp.");
  if (!validIso(meta.reviewedAt)) issues.push("Published roster reviewedAt must be an ISO timestamp.");
  if (!validIso(meta.publishedAt)) issues.push("Published roster publishedAt must be an ISO timestamp.");
  if (!text(meta.reviewedBy, 160)) issues.push("Published roster reviewedBy is required.");
  if (!sculptors.length) issues.push("Published roster must contain at least one sculptor.");
  if (!entries.length) issues.push("Published roster must contain at least one entry.");

  const sculptorIds = idsFor(sculptors, "Sculptor", issues);
  const entryIds = idsFor(entries, "Entry", issues);
  idsFor(pois, "POI", issues);

  for (const sculptor of sculptors) {
    if (!text(sculptor?.name, 160)) issues.push(`Sculptor ${text(sculptor?.id, 120) || "record"} is missing a name.`);
    const entryId = text(sculptor?.entryId, 120);
    if (entryId && !entryIds.has(entryId)) issues.push(`Sculptor ${text(sculptor?.id, 120) || "record"} references missing entry ${entryId}.`);
  }
  for (const entry of entries) {
    const sculptorId = text(entry?.sculptorId, 120);
    if (!sculptorIds.has(sculptorId)) issues.push(`Entry ${text(entry?.id, 120) || "record"} references missing sculptor ${sculptorId || "id"}.`);
  }
  for (const poi of pois) {
    const entryId = text(poi?.entryId, 120);
    if (entryId && !entryIds.has(entryId)) issues.push(`POI ${text(poi?.id, 120) || "record"} references missing entry ${entryId}.`);
  }

  return {
    visible: issues.length === 0,
    mode: issues.length === 0 ? "published" : "unpublished",
    issues,
    counts: { sculptors: sculptors.length, entries: entries.length, pois: pois.length }
  };
}
