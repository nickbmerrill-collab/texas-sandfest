import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import {
  SANDFEST_STAFF_DIRECTORY_SOURCES,
  SANDFEST_TASK_TEAMS,
  normalizeStaffDirectory,
  publicStaffAssignmentDirectory,
  staffDirectoryReadiness
} from "./staff-directory.mjs";

export const STAFF_DIRECTORY_IMPORT_MAX_ROWS = 500;
export const STAFF_DIRECTORY_IMPORT_HISTORY_LIMIT = 50;

const TEAM_IDS = new Set(SANDFEST_TASK_TEAMS.map(item => item.id));
const STAFF_STATUSES = new Set(["active", "on_call", "leave", "inactive"]);
const ACTIVE_STATUSES = new Set(["active", "on_call"]);
const HEADER_ALIASES = new Map(Object.entries({
  id: ["id", "staff_id", "employee_id"],
  event_id: ["event_id", "festival_id", "event"],
  name: ["name", "full_name", "employee_name"],
  email: ["email", "work_email", "email_address"],
  status: ["status", "employment_status"],
  roles: ["roles", "role"],
  teams: ["teams", "team"],
  notification_teams: ["notification_teams", "notification_team", "routing_teams", "routing_team"]
}).flatMap(([canonical, aliases]) => aliases.map(alias => [alias, canonical])));

function clean(value, max = 2_000) {
  return String(value ?? "").trim().slice(0, max);
}

function key(value) {
  return clean(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(name => [name, canonicalValue(value[name])]));
}

function splitList(value) {
  const values = Array.isArray(value) ? value : clean(value, 4_000).split(/[|;,]/);
  return [...new Set(values.map(item => clean(item, 100)).filter(Boolean))];
}

function publicFileName(value) {
  return clean(value, 300).replace(/[\r\n]/g, "") || "staff-directory";
}

function parseCsv(contents) {
  let parsed;
  try {
    parsed = parse(String(contents ?? ""), {
      bom: true,
      info: true,
      max_record_size: 40_000,
      relax_column_count: false,
      skip_empty_lines: true,
      trim: true
    });
  } catch (error) {
    const line = Number(error?.lines || error?.line || 0);
    return { ok: false, error: `Staff CSV could not be parsed${line ? ` near line ${line}` : ""}: ${clean(error?.message || error, 500)}` };
  }
  if (parsed.length < 2) return { ok: false, error: "Staff CSV must include a header and at least one row." };
  const headers = parsed[0].record.map(value => HEADER_ALIASES.get(key(value)) || key(value));
  const duplicateHeader = headers.find((header, index) => header && headers.indexOf(header) !== index);
  if (duplicateHeader) return { ok: false, error: `Staff CSV maps more than one column to ${duplicateHeader}.` };
  for (const required of ["id", "name", "email"]) {
    if (!headers.includes(required)) return { ok: false, error: `Staff CSV needs a ${required} column.` };
  }
  const records = parsed.slice(1).filter(entry => entry.record.some(value => clean(value)));
  if (records.length > STAFF_DIRECTORY_IMPORT_MAX_ROWS) {
    return { ok: false, error: `Staff CSV has ${records.length} rows; the maximum import is ${STAFF_DIRECTORY_IMPORT_MAX_ROWS}.` };
  }
  const staff = [];
  const teamRoutes = [];
  records.forEach((entry, index) => {
    const row = Object.fromEntries(headers.map((header, column) => [header, entry.record[column] ?? ""]));
    staff.push({
      id: row.id,
      eventId: row.event_id,
      name: row.name,
      email: row.email,
      status: row.status || "active",
      roles: splitList(row.roles),
      teams: splitList(row.teams),
      _row: Number(entry.info?.lines || index + 2)
    });
    splitList(row.notification_teams).forEach(teamId => {
      teamRoutes.push({ teamId, notificationOwnerId: row.id, _row: Number(entry.info?.lines || index + 2) });
    });
  });
  if (teamRoutes.length > STAFF_DIRECTORY_IMPORT_MAX_ROWS) {
    return { ok: false, error: `Staff CSV has ${teamRoutes.length} notification routes; the maximum import is ${STAFF_DIRECTORY_IMPORT_MAX_ROWS}.` };
  }
  return { ok: true, document: { staff, teamRoutes } };
}

function parseJson(contents) {
  let document;
  try {
    document = JSON.parse(String(contents ?? ""));
  } catch (error) {
    return { ok: false, error: `Staff JSON could not be parsed: ${clean(error?.message || error, 500)}` };
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { ok: false, error: "Staff JSON must contain one directory object." };
  }
  if (!Array.isArray(document.staff)) return { ok: false, error: "Staff JSON needs a staff array." };
  if (!Array.isArray(document.teamRoutes)) return { ok: false, error: "Staff JSON needs a teamRoutes array." };
  if (document.staff.length > STAFF_DIRECTORY_IMPORT_MAX_ROWS) {
    return { ok: false, error: `Staff JSON has ${document.staff.length} rows; the maximum import is ${STAFF_DIRECTORY_IMPORT_MAX_ROWS}.` };
  }
  if (document.teamRoutes.length > STAFF_DIRECTORY_IMPORT_MAX_ROWS) {
    return { ok: false, error: `Staff JSON has ${document.teamRoutes.length} notification routes; the maximum import is ${STAFF_DIRECTORY_IMPORT_MAX_ROWS}.` };
  }
  return {
    ok: true,
    document: {
      eventId: document.eventId,
      staff: document.staff.map((item, index) => ({ ...item, _row: index + 1 })),
      teamRoutes: document.teamRoutes.map((item, index) => ({ ...item, _row: index + 1 }))
    }
  };
}

function validateDocument(input, options) {
  const errors = [];
  const staff = [];
  const teamRoutes = [];
  const seenIds = new Set();
  const seenEmails = new Set();
  const seenRoutes = new Set();
  const sourceEventId = clean(input.eventId, 160);
  if (sourceEventId && sourceEventId !== options.eventId) {
    errors.push({ scope: "directory", row: null, id: null, error: `Directory event ${sourceEventId} does not match ${options.eventId}.` });
  }
  if (!input.staff.length) errors.push({ scope: "directory", row: null, id: null, error: "The directory has no staff rows." });

  for (const item of input.staff) {
    const row = Number(item?._row || 0) || null;
    const id = clean(item?.id, 100);
    const idKey = id.toLowerCase();
    const eventId = clean(item?.eventId, 160) || sourceEventId || options.eventId;
    const name = clean(item?.name, 120);
    const email = clean(item?.email, 254).toLowerCase();
    const status = key(item?.status || "active");
    const roles = splitList(item?.roles);
    const teams = splitList(item?.teams);
    const rowErrors = [];
    if (!id || !/^[a-z0-9][a-z0-9_-]*$/i.test(id)) rowErrors.push("Staff ID must use letters, numbers, underscores, or hyphens.");
    if (id && seenIds.has(idKey)) rowErrors.push("Staff ID is duplicated in this directory.");
    if (eventId !== options.eventId) rowErrors.push(`Event ${eventId || "(blank)"} does not match ${options.eventId}.`);
    if (!name) rowErrors.push("Staff name is required.");
    if (!STAFF_STATUSES.has(status)) rowErrors.push("Status must be active, on call, leave, or inactive.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowErrors.push("Email is invalid.");
    if (ACTIVE_STATUSES.has(status) && !email) rowErrors.push("Active and on-call staff require an email address.");
    if (email && seenEmails.has(email)) rowErrors.push("Email is assigned to more than one staff row.");
    const unknownTeams = teams.filter(teamId => !TEAM_IDS.has(teamId));
    if (unknownTeams.length) rowErrors.push(`Unknown staff team: ${unknownTeams.join(", ")}.`);
    if (rowErrors.length) {
      errors.push({ scope: "staff", row, id: id || null, error: rowErrors.join(" ") });
      continue;
    }
    seenIds.add(idKey);
    if (email) seenEmails.add(email);
    staff.push({ id, eventId, name, email, status, roles, teams });
  }

  for (const item of input.teamRoutes) {
    const row = Number(item?._row || 0) || null;
    const teamId = clean(item?.teamId, 60);
    const notificationOwnerId = clean(item?.notificationOwnerId, 100);
    const rowErrors = [];
    if (!TEAM_IDS.has(teamId)) rowErrors.push(`Unknown notification team: ${teamId || "(blank)"}.`);
    if (!notificationOwnerId) rowErrors.push("Notification owner is required.");
    if (teamId && seenRoutes.has(teamId)) rowErrors.push("Each notification team must have exactly one owner.");
    const owner = staff.find(item => item.id.toLowerCase() === notificationOwnerId.toLowerCase());
    if (notificationOwnerId && !owner) rowErrors.push("Notification owner is not a valid staff row.");
    if (owner && !ACTIVE_STATUSES.has(owner.status)) rowErrors.push("Notification owner must be active or on call.");
    if (rowErrors.length) {
      errors.push({ scope: "route", row, id: teamId || null, error: rowErrors.join(" ") });
      continue;
    }
    seenRoutes.add(teamId);
    teamRoutes.push({ teamId, notificationOwnerId: owner.id });
  }

  const candidate = normalizeStaffDirectory({
    eventId: options.eventId,
    source: options.source,
    lastUpdated: options.now,
    verifiedAt: options.now,
    staff,
    teamRoutes
  }, { eventId: options.eventId });
  const readiness = staffDirectoryReadiness(candidate, {
    eventId: options.eventId,
    production: true,
    now: options.now
  });
  readiness.errors.forEach(error => {
    if (!errors.some(item => item.error === error)) errors.push({ scope: "directory", row: null, id: null, error });
  });
  return { candidate, readiness, errors };
}

export function staffDirectoryImportBundleHash(contents, options = {}) {
  return digest(JSON.stringify({
    contents: String(contents ?? "").replace(/\r\n?/g, "\n"),
    eventId: clean(options.eventId, 160),
    source: clean(options.source, 80).toLowerCase(),
    fileName: publicFileName(options.fileName)
  }));
}

export function staffDirectoryFingerprint(input = {}, options = {}) {
  const directory = normalizeStaffDirectory(input, { eventId: options.eventId });
  const imports = (Array.isArray(input?.imports) ? input.imports : []).slice(-STAFF_DIRECTORY_IMPORT_HISTORY_LIMIT);
  return digest(JSON.stringify(canonicalValue({ ...directory, imports })));
}

export function staffDirectoryImportPreviewHash(contents, options = {}) {
  return digest(JSON.stringify({
    bundleHash: staffDirectoryImportBundleHash(contents, options),
    directoryFingerprint: clean(options.directoryFingerprint, 64).toLowerCase()
  }));
}

export function parseStaffDirectoryImport(contents, options = {}) {
  const eventId = clean(options.eventId, 160);
  const source = clean(options.source, 80).toLowerCase();
  const fileName = publicFileName(options.fileName);
  const nowDate = new Date(options.now || Date.now());
  const now = Number.isFinite(nowDate.getTime()) ? nowDate.toISOString() : new Date().toISOString();
  if (!eventId) return { ok: false, error: "Current event ID is required." };
  if (!SANDFEST_STAFF_DIRECTORY_SOURCES.includes(source)) {
    return { ok: false, error: `Staff source must be one of: ${SANDFEST_STAFF_DIRECTORY_SOURCES.join(", ")}.` };
  }
  const format = fileName.toLowerCase().endsWith(".json") || String(contents ?? "").trimStart().startsWith("{") ? "json" : "csv";
  const parsed = format === "json" ? parseJson(contents) : parseCsv(contents);
  if (!parsed.ok) return parsed;
  const validated = validateDocument(parsed.document, { eventId, source, now });
  if (validated.errors.length) {
    const detail = validated.errors.slice(0, 3).map(item => item.error).join(" ");
    return {
      ok: false,
      error: `Staff directory import is not ready: ${detail}`,
      errors: validated.errors.slice(0, 100),
      readiness: validated.readiness
    };
  }
  return {
    ok: true,
    eventId,
    source,
    fileName,
    format,
    bundleHash: staffDirectoryImportBundleHash(contents, { eventId, source, fileName }),
    candidate: validated.candidate,
    readiness: validated.readiness,
    publicDirectory: publicStaffAssignmentDirectory(validated.candidate, { eventId }),
    summary: {
      totalStaff: validated.candidate.staff.length,
      activeStaff: validated.readiness.activeStaff,
      routedTeams: validated.readiness.routedTeams,
      totalTeams: validated.readiness.totalTeams
    }
  };
}

export function applyStaffDirectoryImport(currentInput, parsed, options = {}) {
  if (!parsed?.ok) return parsed || { ok: false, error: "Staff directory import could not be parsed." };
  const current = currentInput && typeof currentInput === "object" ? currentInput : {};
  const eventId = parsed.eventId;
  const currentFingerprint = staffDirectoryFingerprint(current, { eventId });
  const previewHash = digest(JSON.stringify({ bundleHash: parsed.bundleHash, directoryFingerprint: currentFingerprint }));
  const history = (Array.isArray(current.imports) ? current.imports : []).slice(-STAFF_DIRECTORY_IMPORT_HISTORY_LIMIT);
  const expectedPreviewHash = clean(options.expectedPreviewHash, 64).toLowerCase();
  const previousImport = history.find(item => item.previewHash === expectedPreviewHash && item.bundleHash === parsed.bundleHash);
  if (options.commit && previousImport) {
    return {
      ok: true,
      replay: true,
      changed: false,
      doc: current,
      previewHash: expectedPreviewHash,
      importRecord: previousImport,
      publicDirectory: publicStaffAssignmentDirectory(current, { eventId }),
      readiness: staffDirectoryReadiness(current, { eventId, production: true, now: options.now }),
      summary: previousImport.summary
    };
  }
  if (options.commit && (!expectedPreviewHash || expectedPreviewHash !== previewHash)) {
    return { ok: false, previewMismatch: true, error: "The staff file or current directory changed. Preview the replacement again before committing." };
  }
  const rolloverRequired = Boolean(current.eventId && current.eventId !== eventId);
  if (options.commit && rolloverRequired) {
    return { ok: false, rolloverRequired: true, error: `Staff data belongs to ${current.eventId}; complete the archive-first rollover before importing ${eventId}.` };
  }
  if (!options.commit) {
    return {
      ok: true,
      replay: false,
      changed: false,
      previewHash,
      commitAllowed: !rolloverRequired,
      commitBlockReason: rolloverRequired ? `Complete the archive-first rollover from ${current.eventId} to ${eventId} before committing.` : null,
      publicDirectory: parsed.publicDirectory,
      readiness: parsed.readiness,
      summary: parsed.summary
    };
  }

  const nowDate = new Date(options.now || Date.now());
  const now = Number.isFinite(nowDate.getTime()) ? nowDate.toISOString() : new Date().toISOString();
  const importRecord = {
    id: clean(options.batchId, 120) || `staff_import_${digest(`${previewHash}:${now}`).slice(0, 20)}`,
    provider: parsed.source,
    eventId,
    fileName: parsed.fileName,
    format: parsed.format,
    actorId: clean(options.actorId, 160) || null,
    importedAt: now,
    previewHash,
    bundleHash: parsed.bundleHash,
    summary: parsed.summary
  };
  const doc = {
    ...parsed.candidate,
    lastUpdated: now,
    verifiedAt: now,
    imports: [...history, importRecord].slice(-STAFF_DIRECTORY_IMPORT_HISTORY_LIMIT)
  };
  return {
    ok: true,
    replay: false,
    changed: true,
    doc,
    previewHash,
    importRecord,
    publicDirectory: publicStaffAssignmentDirectory(doc, { eventId }),
    readiness: staffDirectoryReadiness(doc, { eventId, production: true, now }),
    summary: parsed.summary
  };
}
