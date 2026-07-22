import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { DEFAULT_EVENT_ID } from "./event-context.mjs";
import { publicSculptorRosterPublication } from "./public-roster.mjs";

export const SCULPTOR_ROSTER_MAX_ROWS = 500;
export const SCULPTOR_DIVISIONS = Object.freeze([
  "master_solo",
  "master_duo",
  "semi_pro",
  "amateur",
  "non_competing_master"
]);

const ENTRY_STATUSES = new Set(["planning", "sculpting", "complete", "judged"]);
const SAFE_ID = /^[a-z][a-z0-9_]{2,119}$/;
const DIVISION_ALIASES = new Map([
  ["master_solo", "master_solo"],
  ["master", "master_solo"],
  ["solo_master", "master_solo"],
  ["master_duo", "master_duo"],
  ["duo_master", "master_duo"],
  ["semi_pro", "semi_pro"],
  ["semipro", "semi_pro"],
  ["semi_professional", "semi_pro"],
  ["amateur", "amateur"],
  ["non_competing_master", "non_competing_master"],
  ["noncompetitive_master", "non_competing_master"],
  ["non_competitive_master", "non_competing_master"]
]);
const LEGEND = Object.freeze([
  { colorKey: "master_solo", label: "Master Solo", colorHex: "#006d77" },
  { colorKey: "master_duo", label: "Master Duo", colorHex: "#e85d4a" },
  { colorKey: "semi_pro", label: "Semi-Pro", colorHex: "#f7b733" },
  { colorKey: "amateur", label: "Amateur", colorHex: "#7a5195" },
  { colorKey: "non_competing_master", label: "Non-Competing Master", colorHex: "#2f6b4f" }
]);
const HEADERS = aliases({
  event_id: ["event_id", "festival_id", "event"],
  sculptor_id: ["sculptor_id", "artist_id", "competitor_id"],
  sculptor_name: ["sculptor_name", "artist_name", "competitor_name", "name"],
  division: ["division", "competition_division", "category"],
  hometown: ["hometown", "home_town", "location"],
  returning: ["returning", "returning_artist", "returning_sculptor"],
  bio: ["bio", "biography", "artist_bio"],
  instagram: ["instagram", "instagram_handle", "social"],
  entry_id: ["entry_id", "sculpture_id", "artwork_id"],
  entry_title: ["entry_title", "sculpture_title", "artwork_title", "title"],
  statement: ["statement", "entry_statement", "description"],
  status: ["status", "entry_status", "sculpture_status"],
  beach_marker: ["beach_marker", "marker", "mile_marker"],
  map_x: ["map_x", "x", "illustrated_map_x"],
  map_y: ["map_y", "y", "illustrated_map_y"]
});

function text(value, max = 2_000) {
  return String(value ?? "").trim().slice(0, max);
}

function key(value) {
  return text(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function aliases(entries) {
  return new Map(Object.entries(entries).flatMap(([canonical, names]) => names.map(name => [name, canonical])));
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(name => [name, canonical(value[name])]));
}

function validInstant(value) {
  const input = text(value, 80);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(input)) return null;
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function validHttpsUrl(value) {
  try {
    const parsed = new URL(text(value, 1_000));
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function parseBoolean(value) {
  const input = key(value);
  if (!input) return { ok: true, value: false };
  if (["1", "true", "yes", "y", "returning"].includes(input)) return { ok: true, value: true };
  if (["0", "false", "no", "n", "new", "debut"].includes(input)) return { ok: true, value: false };
  return { ok: false, error: "Returning must be an explicit yes/no value." };
}

function parseCoordinate(value, axis) {
  const input = text(value, 60);
  if (!input) return { ok: false, error: `Map ${axis.toUpperCase()} is required.` };
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return { ok: false, error: `Map ${axis.toUpperCase()} must be between 0 and 1.` };
  }
  return { ok: true, value: parsed };
}

function stableId(prefix, supplied, fallback) {
  const candidate = key(supplied || fallback);
  return candidate.startsWith(`${prefix}_`) ? candidate : `${prefix}_${candidate}`;
}

function parseCsv(csv) {
  const source = String(csv ?? "");
  if (!source.trim()) return { ok: false, error: "Choose a sculptor roster CSV." };
  let rows;
  try {
    rows = parse(source, {
      bom: true,
      info: true,
      max_record_size: 40_000,
      relax_column_count: false,
      skip_empty_lines: true,
      trim: true
    });
  } catch (error) {
    const line = Number(error?.lines || error?.line || 0);
    return { ok: false, error: `Sculptor roster CSV could not be parsed${line ? ` near line ${line}` : ""}: ${text(error?.message || error, 500)}` };
  }
  if (rows.length < 2) return { ok: false, error: "Sculptor roster CSV must include a header and at least one row." };
  const headers = rows[0].record.map(value => HEADERS.get(key(value)) || key(value));
  const duplicate = headers.find((header, index) => header && headers.indexOf(header) !== index);
  if (duplicate) return { ok: false, error: `Sculptor roster CSV maps more than one column to ${duplicate}.` };
  const required = ["sculptor_name", "division", "entry_title", "beach_marker", "map_x", "map_y"];
  const missing = required.filter(header => !headers.includes(header));
  if (missing.length) return { ok: false, error: `Sculptor roster CSV is missing required columns: ${missing.join(", ")}.` };
  const records = rows.slice(1).filter(entry => entry.record.some(value => text(value)));
  if (records.length > SCULPTOR_ROSTER_MAX_ROWS) {
    return { ok: false, error: `Sculptor roster CSV has ${records.length} rows; the maximum is ${SCULPTOR_ROSTER_MAX_ROWS}.` };
  }
  return {
    ok: true,
    records: records.map((entry, index) => ({
      rowNumber: Number(entry.info?.lines || index + 2),
      record: Object.fromEntries(headers.map((header, column) => [header, entry.record[column] ?? ""]))
    }))
  };
}

function rowIssue(row, sculptorName, error) {
  return { row, sculptorName: sculptorName || null, error };
}

export function emptySculptorRoster(eventId = DEFAULT_EVENT_ID) {
  return {
    _note: "Governed sculptor roster. Public surfaces remain empty until a reviewed current-event roster is published.",
    meta: {
      eventId,
      event: `Texas SandFest ${String(eventId).slice(-4)}`,
      venue: "Port Aransas Beach, TX",
      schemaVersion: "1.1",
      publicationStatus: "unpublished",
      source: "awaiting_official_roster",
      sourceUrl: "https://www.texassandfest.org/sculptors",
      sourceCheckedAt: null,
      reviewedAt: null,
      reviewedBy: null,
      publishedAt: null,
      heldAt: null,
      heldBy: null,
      holdReason: null
    },
    engagement: { passportActive: false, votingOpen: false },
    legend: [],
    markerIndex: {},
    sculptors: [],
    entries: [],
    pois: [],
    imports: [],
    lastUpdated: null
  };
}

export function sculptorRosterFingerprint(input = {}) {
  const roster = input && typeof input === "object" ? input : {};
  return digest(JSON.stringify(canonical({
    meta: roster.meta ?? {},
    engagement: roster.engagement ?? {},
    sculptors: roster.sculptors ?? [],
    entries: roster.entries ?? [],
    pois: roster.pois ?? [],
    imports: roster.imports ?? [],
    lastUpdated: roster.lastUpdated ?? null
  })));
}

export function sculptorRosterPreviewHash(input = {}, options = {}) {
  return digest(JSON.stringify(canonical({
    csv: String(input.csv ?? "").replace(/\r\n?/g, "\n"),
    sourceUrl: validHttpsUrl(input.sourceUrl),
    sourceCheckedAt: validInstant(input.sourceCheckedAt),
    eventId: text(options.eventId ?? DEFAULT_EVENT_ID, 120),
    currentFingerprint: text(options.currentFingerprint, 64).toLowerCase()
  })));
}

export function parseSculptorRosterCsv(csv, options = {}) {
  const eventId = text(options.eventId ?? DEFAULT_EVENT_ID, 120);
  const source = parseCsv(csv);
  if (!source.ok) return source;
  const sculptors = [];
  const entries = [];
  const pois = [];
  const errors = [];
  const sculptorIds = new Set();
  const entryIds = new Set();
  const poiIds = new Set();

  for (const { rowNumber, record } of source.records) {
    const sculptorName = text(record.sculptor_name, 160);
    const entryTitle = text(record.entry_title, 160);
    const rowEventId = text(record.event_id, 120) || eventId;
    const sculptorId = stableId("scl", record.sculptor_id, sculptorName);
    const entryId = stableId("ent", record.entry_id, entryTitle);
    const poiId = `poi_${entryId.replace(/^ent_/, "")}`;
    const division = DIVISION_ALIASES.get(key(record.division));
    const returning = parseBoolean(record.returning);
    const mapX = parseCoordinate(record.map_x, "x");
    const mapY = parseCoordinate(record.map_y, "y");
    const statusInput = key(record.status) || "planning";
    const beachMarker = text(record.beach_marker, 40);
    const rowErrors = [];
    if (rowEventId !== eventId) rowErrors.push(`Event ${rowEventId || "(blank)"} does not match ${eventId}.`);
    if (!sculptorName) rowErrors.push("Sculptor name is required.");
    if (!SAFE_ID.test(sculptorId)) rowErrors.push("Sculptor ID must use lowercase letters, numbers, and underscores.");
    if (sculptorIds.has(sculptorId)) rowErrors.push("Sculptor ID is duplicated; publish one entry per roster row.");
    if (!division || !SCULPTOR_DIVISIONS.includes(division)) rowErrors.push("Division is not supported.");
    if (!returning.ok) rowErrors.push(returning.error);
    if (!entryTitle) rowErrors.push("Entry title is required.");
    if (!SAFE_ID.test(entryId)) rowErrors.push("Entry ID must use lowercase letters, numbers, and underscores.");
    if (entryIds.has(entryId)) rowErrors.push("Entry ID is duplicated.");
    if (poiIds.has(poiId)) rowErrors.push("Generated map marker ID is duplicated.");
    if (!ENTRY_STATUSES.has(statusInput)) rowErrors.push("Entry status must be planning, sculpting, complete, or judged.");
    if (!beachMarker) rowErrors.push("Beach marker is required.");
    if (!mapX.ok) rowErrors.push(mapX.error);
    if (!mapY.ok) rowErrors.push(mapY.error);
    if (rowErrors.length) {
      errors.push(rowIssue(rowNumber, sculptorName, rowErrors.join(" ")));
      continue;
    }
    sculptorIds.add(sculptorId);
    entryIds.add(entryId);
    poiIds.add(poiId);
    sculptors.push({
      id: sculptorId,
      name: sculptorName,
      division,
      hometown: text(record.hometown, 160),
      returning: returning.value,
      bio: text(record.bio, 1_000),
      socials: text(record.instagram, 200) ? { instagram: text(record.instagram, 200) } : {},
      entryId
    });
    entries.push({
      id: entryId,
      title: entryTitle,
      sculptorId,
      division,
      status: statusInput,
      beachMarker,
      poiId,
      statement: text(record.statement, 1_000)
    });
    pois.push({
      id: poiId,
      type: "sculpture",
      entryId,
      beachMarker,
      colorKey: division,
      illustratedMapXY: { x: mapX.value, y: mapY.value }
    });
  }

  return {
    ok: true,
    eventId,
    totalRows: source.records.length,
    validRows: sculptors.length,
    errors,
    roster: {
      legend: LEGEND.filter(item => sculptors.some(sculptor => sculptor.division === item.colorKey)).map(item => ({ ...item })),
      markerIndex: {},
      sculptors,
      entries,
      pois
    }
  };
}

export function publishSculptorRoster(currentInput = {}, parsed, input = {}, options = {}) {
  if (!parsed?.ok) return { ok: false, error: parsed?.error || "Sculptor roster CSV is invalid." };
  if (parsed.errors?.length) return { ok: false, error: parsed.errors[0].error, errors: parsed.errors };
  if (!parsed.validRows) return { ok: false, error: "At least one valid sculptor roster row is required." };
  const now = validInstant(options.now ?? new Date().toISOString());
  const eventId = text(options.eventId ?? parsed.eventId ?? DEFAULT_EVENT_ID, 120);
  const actorId = text(options.actorId, 160);
  const sourceUrl = validHttpsUrl(input.sourceUrl);
  const sourceCheckedAt = validInstant(input.sourceCheckedAt);
  const expectedPreviewHash = text(input.previewHash, 64).toLowerCase();
  const currentFingerprint = sculptorRosterFingerprint(currentInput);
  const previewHash = sculptorRosterPreviewHash(input, { eventId, currentFingerprint });
  const errors = [];
  if (parsed.eventId !== eventId) errors.push(`Roster event ${parsed.eventId || "missing"} does not match ${eventId}.`);
  if (!actorId) errors.push("Authenticated reviewer identity is required.");
  if (!sourceUrl) errors.push("An HTTPS official roster source is required.");
  if (!sourceCheckedAt) errors.push("Official roster source-check time is required.");
  if (sourceCheckedAt && now && sourceCheckedAt > now) errors.push("Official roster source-check time cannot be in the future.");
  if (!expectedPreviewHash || expectedPreviewHash !== previewHash) errors.push("Roster preview is stale or does not match this publication request. Preview the file again.");
  if (errors.length) return { ok: false, error: errors[0], errors, previewMismatch: errors.at(-1)?.startsWith("Roster preview") === true };
  const current = currentInput && typeof currentInput === "object" ? currentInput : emptySculptorRoster(eventId);
  const importRecord = {
    id: `roster_${previewHash.slice(0, 16)}`,
    previewHash,
    fileName: text(input.fileName, 300) || null,
    importedAt: now,
    importedBy: actorId,
    sourceUrl,
    sourceCheckedAt,
    rows: parsed.validRows
  };
  const imports = Array.isArray(current.imports) ? current.imports.slice() : [];
  imports.push(importRecord);
  return {
    ok: true,
    previewHash,
    importRecord,
    roster: {
      _note: "Governed sculptor roster. Passport checkpoints and ballot entries derive from this published revision.",
      meta: {
        eventId,
        event: `Texas SandFest ${String(eventId).slice(-4)}`,
        venue: "Port Aransas Beach, TX",
        schemaVersion: "1.1",
        publicationStatus: "published",
        source: "official_roster_csv",
        sourceUrl,
        sourceCheckedAt,
        reviewedAt: now,
        reviewedBy: actorId,
        publishedAt: now,
        heldAt: null,
        heldBy: null,
        holdReason: null
      },
      engagement: {
        passportActive: current.engagement?.passportActive === true,
        votingOpen: current.engagement?.votingOpen === true
      },
      ...parsed.roster,
      imports: imports.slice(-100),
      lastUpdated: now
    }
  };
}

export function holdSculptorRoster(currentInput = {}, options = {}) {
  const current = currentInput && typeof currentInput === "object" ? structuredClone(currentInput) : emptySculptorRoster(options.eventId);
  const now = validInstant(options.now ?? new Date().toISOString());
  const actorId = text(options.actorId, 160);
  const reason = text(options.reason, 500);
  if (!actorId) return { ok: false, error: "Authenticated reviewer identity is required." };
  if (reason.length < 8) return { ok: false, error: "A roster hold reason of at least 8 characters is required." };
  current.meta = {
    ...(current.meta || {}),
    eventId: text(options.eventId ?? current.meta?.eventId ?? DEFAULT_EVENT_ID, 120),
    publicationStatus: "unpublished",
    publishedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    heldAt: now,
    heldBy: actorId,
    holdReason: reason
  };
  current.engagement = { passportActive: false, votingOpen: false };
  current.lastUpdated = now;
  return { ok: true, roster: current };
}

export function updateSculptorRosterEngagement(currentInput = {}, input = {}, options = {}) {
  const current = currentInput && typeof currentInput === "object" ? structuredClone(currentInput) : emptySculptorRoster(options.eventId);
  const publication = publicSculptorRosterPublication(current, { eventId: options.eventId ?? DEFAULT_EVENT_ID });
  if (!publication.visible) return { ok: false, error: "Publish a valid current-event roster before changing engagement controls." };
  if (typeof input.passportActive !== "boolean" || typeof input.votingOpen !== "boolean") {
    return { ok: false, error: "passportActive and votingOpen must both be explicit booleans." };
  }
  const now = validInstant(options.now ?? new Date().toISOString());
  current.engagement = { passportActive: input.passportActive, votingOpen: input.votingOpen };
  current.lastUpdated = now;
  return { ok: true, roster: current };
}

export function sculptorRosterReadiness(input = {}, options = {}) {
  const eventId = text(options.eventId ?? DEFAULT_EVENT_ID, 120);
  const publication = publicSculptorRosterPublication(input, { eventId, allowSample: options.allowSample === true });
  const sourceCheckedAt = validInstant(input?.meta?.sourceCheckedAt);
  const now = new Date(options.now ?? Date.now());
  const maxSourceAgeDays = Math.max(1, Number(options.maxSourceAgeDays ?? 180));
  const sourceAgeDays = sourceCheckedAt
    ? Math.floor((now.getTime() - new Date(sourceCheckedAt).getTime()) / 86_400_000)
    : null;
  const currentSource = sourceAgeDays !== null && sourceAgeDays >= 0 && sourceAgeDays <= maxSourceAgeDays;
  const ready = publication.visible && (publication.mode === "demo" || currentSource);
  return {
    ready,
    publication,
    sourceAgeDays,
    maxSourceAgeDays,
    engagement: {
      passportActive: ready && input?.engagement?.passportActive === true,
      votingOpen: ready && input?.engagement?.votingOpen === true
    },
    reason: ready
      ? publication.mode === "demo"
        ? `${publication.counts.sculptors} synthetic sculptor${publication.counts.sculptors === 1 ? " is" : "s are"} isolated to the board demonstration.`
        : `${publication.counts.sculptors} sculptor${publication.counts.sculptors === 1 ? " is" : "s are"} source-reviewed and published.`
      : !publication.visible
        ? publication.issues[0]
        : `The official roster source review is older than ${maxSourceAgeDays} days.`
  };
}

export function publicSculptorRoster(input = {}, options = {}) {
  const eventId = text(options.eventId ?? DEFAULT_EVENT_ID, 120);
  const readiness = sculptorRosterReadiness(input, options);
  if (!readiness.ready) return emptySculptorRoster(eventId);
  return {
    meta: {
      eventId,
      event: text(input.meta?.event, 160),
      venue: text(input.meta?.venue, 160),
      schemaVersion: text(input.meta?.schemaVersion, 20) || "1.1",
      publicationStatus: input.meta?.publicationStatus,
      source: input.meta?.source,
      sourceUrl: input.meta?.sourceUrl,
      sourceCheckedAt: input.meta?.sourceCheckedAt,
      reviewedAt: input.meta?.reviewedAt,
      reviewedBy: "Texas SandFest content team",
      publishedAt: input.meta?.publishedAt
    },
    legend: Array.isArray(input.legend) ? structuredClone(input.legend) : [],
    markerIndex: input.markerIndex && typeof input.markerIndex === "object" ? structuredClone(input.markerIndex) : {},
    sculptors: Array.isArray(input.sculptors) ? structuredClone(input.sculptors) : [],
    entries: Array.isArray(input.entries) ? structuredClone(input.entries) : [],
    pois: Array.isArray(input.pois) ? structuredClone(input.pois) : []
  };
}
