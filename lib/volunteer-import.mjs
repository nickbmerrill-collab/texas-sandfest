import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { normalizeHourLog, normalizeShift, normalizeVolunteer } from "./volunteers.mjs";

export const VOLUNTEERLOCAL_IMPORT_MAX_ROWS = 5_000;
export const VOLUNTEERLOCAL_IMPORT_HISTORY_LIMIT = 100;

const STATUS_ALIASES = new Map([
  ["active", "confirmed"],
  ["approved", "confirmed"],
  ["registered", "confirmed"],
  ["confirmed", "confirmed"],
  ["checked_in", "checked_in"],
  ["checkedin", "checked_in"],
  ["present", "checked_in"],
  ["no_show", "no_show"],
  ["noshow", "no_show"],
  ["cancelled", "cancelled"],
  ["canceled", "cancelled"],
  ["withdrawn", "cancelled"],
  ["inactive", "cancelled"],
  ["interested", "interested"],
  ["pending", "interested"],
  ["waitlist", "interested"]
]);

const ROSTER_HEADERS = headerAliases({
  external_id: ["external_id", "volunteer_id", "volunteerlocal_id", "user_id", "participant_id", "id"],
  event_id: ["event_id", "festival_id", "event"],
  name: ["name", "full_name", "volunteer", "volunteer_name", "participant_name"],
  email: ["email", "email_address", "primary_email"],
  phone: ["phone", "mobile", "phone_number", "mobile_phone"],
  roles: ["roles", "role", "jobs", "job", "assignments"],
  status: ["status", "volunteer_status", "registration_status"],
  waiver_signed: ["waiver_signed", "waiver", "waiver_complete", "release_signed"],
  sms_consent: ["sms_consent", "sms", "text_consent", "mobile_opt_in"],
  shirt_size: ["shirt_size", "shirt", "t_shirt_size", "tshirt_size"],
  source_updated_at: ["source_updated_at", "updated_at", "modified_at", "last_updated"]
});

const SHIFT_HEADERS = headerAliases({
  external_id: ["external_id", "shift_id", "volunteerlocal_shift_id", "assignment_id", "id"],
  event_id: ["event_id", "festival_id", "event"],
  role_id: ["role_id", "role", "job_id", "job", "position"],
  zone_id: ["zone_id", "zone", "location_id", "location", "area"],
  zone_label: ["zone_label", "location_name", "area_name"],
  day: ["day", "shift_day", "date_label"],
  starts_at: ["starts_at", "start_at", "start_time", "shift_start"],
  ends_at: ["ends_at", "end_at", "end_time", "shift_end"],
  needed: ["needed", "volunteers_needed", "capacity", "slots"],
  captain_external_id: ["captain_external_id", "captain_id", "lead_volunteer_id"],
  volunteer_external_ids: ["volunteer_external_ids", "volunteer_ids", "assigned_volunteer_ids", "participant_ids"],
  volunteer_emails: ["volunteer_emails", "assigned_emails", "participant_emails"],
  volunteer_external_id: ["volunteer_external_id", "volunteer_id", "participant_id"],
  volunteer_email: ["volunteer_email", "participant_email", "email"]
});

const HOURS_HEADERS = headerAliases({
  external_id: ["external_id", "hour_log_id", "time_entry_id", "attendance_id", "id"],
  event_id: ["event_id", "festival_id", "event"],
  volunteer_external_id: ["volunteer_external_id", "volunteer_id", "participant_id", "user_id"],
  volunteer_email: ["volunteer_email", "participant_email", "email"],
  shift_external_id: ["shift_external_id", "shift_id", "assignment_id"],
  check_in_at: ["check_in_at", "checked_in_at", "check_in", "start_time"],
  check_out_at: ["check_out_at", "checked_out_at", "check_out", "end_time"],
  hours: ["hours", "total_hours", "duration_hours"],
  notes: ["notes", "note", "comments"]
});

function clean(value, max = 2_000) {
  return String(value ?? "").trim().slice(0, max);
}

function key(value) {
  return clean(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function headerAliases(entries) {
  return new Map(Object.entries(entries).flatMap(([canonical, aliases]) => aliases.map(alias => [alias, canonical])));
}

function stableId(kind, externalId) {
  const normalized = key(externalId).slice(0, 48) || kind;
  return `volunteerlocal_${kind}_${normalized}_${digest(externalId).slice(0, 8)}`;
}

function parseBoolean(value, label) {
  const candidate = key(value);
  if (!candidate) return { ok: true, value: false };
  if (["1", "true", "yes", "y", "signed", "complete", "completed", "opted_in"].includes(candidate)) return { ok: true, value: true };
  if (["0", "false", "no", "n", "unsigned", "incomplete", "not_signed", "opted_out"].includes(candidate)) return { ok: true, value: false };
  return { ok: false, error: `${label} must be an explicit yes/no value.` };
}

function parseIso(value, label, { required = false } = {}) {
  const candidate = clean(value, 100);
  if (!candidate) return required ? { ok: false, error: `${label} is required.` } : { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(candidate)) {
    return { ok: false, error: `${label} must be an ISO 8601 timestamp with a timezone.` };
  }
  const parsed = new Date(candidate);
  return Number.isFinite(parsed.getTime())
    ? { ok: true, value: parsed.toISOString() }
    : { ok: false, error: `${label} is not a valid timestamp.` };
}

function parseWholeNumber(value, label, { required = false, maximum = 100_000 } = {}) {
  const candidate = clean(value, 50);
  if (!candidate) return required ? { ok: false, error: `${label} is required.` } : { ok: true, value: null };
  if (!/^\d+$/.test(candidate)) return { ok: false, error: `${label} must be a non-negative whole number.` };
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed <= maximum
    ? { ok: true, value: parsed }
    : { ok: false, error: `${label} is outside the supported range.` };
}

function parseHours(value, hasTimes) {
  const candidate = clean(value, 50);
  if (!candidate) return hasTimes ? { ok: true, value: null } : { ok: false, error: "Hours or both check-in and check-out timestamps are required." };
  if (!/^\d+(?:\.\d{1,2})?$/.test(candidate)) return { ok: false, error: "Hours must be a non-negative number with no more than two decimals." };
  const parsed = Number(candidate);
  return Number.isFinite(parsed) && parsed <= 24
    ? { ok: true, value: parsed }
    : { ok: false, error: "Hours must be between 0 and 24." };
}

function splitList(value) {
  return [...new Set(clean(value, 4_000).split(/[|;,]/).map(item => clean(item, 254)).filter(Boolean))];
}

function parseCsv(csv, { label, aliases, requiredHeaders }) {
  const source = String(csv ?? "");
  if (!source.trim()) return { ok: false, error: `Choose or paste a ${label} CSV.` };
  let parsed;
  try {
    parsed = parse(source, {
      bom: true,
      info: true,
      max_record_size: 40_000,
      relax_column_count: false,
      skip_empty_lines: true,
      trim: true
    });
  } catch (error) {
    const line = Number(error?.lines || error?.line || 0);
    return { ok: false, error: `${label} CSV could not be parsed${line ? ` near line ${line}` : ""}: ${clean(error?.message || error, 500)}` };
  }
  if (parsed.length < 2) return { ok: false, error: `${label} CSV must include a header and at least one row.` };
  const headers = parsed[0].record.map(value => aliases.get(key(value)) || key(value));
  const duplicateHeader = headers.find((header, index) => header && headers.indexOf(header) !== index);
  if (duplicateHeader) return { ok: false, error: `${label} CSV maps more than one column to ${duplicateHeader}.` };
  for (const required of requiredHeaders) {
    if (!headers.includes(required)) return { ok: false, error: `${label} CSV needs a ${required} column.` };
  }
  const records = parsed.slice(1).filter(entry => entry.record.some(value => clean(value)));
  if (records.length > VOLUNTEERLOCAL_IMPORT_MAX_ROWS) {
    return { ok: false, error: `${label} CSV has ${records.length} rows; the maximum import is ${VOLUNTEERLOCAL_IMPORT_MAX_ROWS}.` };
  }
  return {
    ok: true,
    records: records.map((entry, index) => ({
      rowNumber: Number(entry.info?.lines || index + 2),
      record: Object.fromEntries(headers.map((header, column) => [header, entry.record[column] ?? ""]))
    }))
  };
}

function rowError(file, row, externalId, error) {
  return { file, row, externalId: externalId || null, error };
}

export function normalizeVolunteerLocalImportDefaults(input = {}) {
  return {
    eventId: clean(input.eventId, 160),
    mirrorFingerprint: clean(input.mirrorFingerprint, 64).toLowerCase()
  };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(name => [name, canonicalValue(value[name])]));
}

export function volunteerLocalMirrorFingerprint(docInput = {}) {
  const doc = docInput && typeof docInput === "object" ? docInput : {};
  const semantic = {
    eventId: clean(doc.eventId, 160) || null,
    lastUpdated: doc.lastUpdated || null,
    source: clean(doc.source, 80) || null,
    zoneLabels: doc.zoneLabels && typeof doc.zoneLabels === "object" ? doc.zoneLabels : {},
    volunteers: (Array.isArray(doc.volunteers) ? doc.volunteers : []).map(normalizeVolunteer),
    shifts: (Array.isArray(doc.shifts) ? doc.shifts : []).map(normalizeShift),
    hourLogs: (Array.isArray(doc.hourLogs) ? doc.hourLogs : []).map(normalizeHourLog),
    imports: Array.isArray(doc.imports) ? doc.imports.slice(-VOLUNTEERLOCAL_IMPORT_HISTORY_LIMIT) : []
  };
  return digest(JSON.stringify(canonicalValue(semantic)));
}

export function volunteerLocalBundleHash(bundle = {}, defaultsInput = {}) {
  const defaults = normalizeVolunteerLocalImportDefaults(defaultsInput);
  const canonical = {
    rosterCsv: String(bundle.rosterCsv ?? "").replace(/\r\n?/g, "\n"),
    shiftsCsv: String(bundle.shiftsCsv ?? "").replace(/\r\n?/g, "\n"),
    hoursCsv: String(bundle.hoursCsv ?? "").replace(/\r\n?/g, "\n"),
    eventId: defaults.eventId
  };
  return digest(JSON.stringify(canonical));
}

export function volunteerLocalImportPreviewHash(bundle = {}, defaultsInput = {}) {
  const defaults = normalizeVolunteerLocalImportDefaults(defaultsInput);
  return digest(JSON.stringify({
    bundleHash: volunteerLocalBundleHash(bundle, defaults),
    mirrorFingerprint: defaults.mirrorFingerprint
  }));
}

function parseRoster(csv, defaults) {
  const source = parseCsv(csv, { label: "VolunteerLocal roster", aliases: ROSTER_HEADERS, requiredHeaders: ["external_id", "name"] });
  if (!source.ok) return source;
  const rows = [];
  const errors = [];
  const seenIds = new Set();
  const seenEmails = new Set();
  for (const { rowNumber, record } of source.records) {
    const externalId = clean(record.external_id, 200);
    const eventId = clean(record.event_id, 160) || defaults.eventId;
    const name = clean(record.name, 120);
    const email = clean(record.email, 254).toLowerCase();
    const statusInput = key(record.status) || "confirmed";
    const status = STATUS_ALIASES.get(statusInput);
    const waiver = parseBoolean(record.waiver_signed, "Waiver signed");
    const sms = parseBoolean(record.sms_consent, "SMS consent");
    const sourceUpdatedAt = parseIso(record.source_updated_at, "Source updated at");
    const rowErrors = [];
    if (!externalId) rowErrors.push("External volunteer ID is required.");
    if (!name) rowErrors.push("Volunteer name is required.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowErrors.push("Email is invalid.");
    if (!status) rowErrors.push("Status must be active, confirmed, checked in, no show, cancelled, interested, pending, or waitlist.");
    if (eventId !== defaults.eventId) rowErrors.push(`Event ${eventId || "(blank)"} does not match ${defaults.eventId}.`);
    if (!waiver.ok) rowErrors.push(waiver.error);
    if (!sms.ok) rowErrors.push(sms.error);
    if (!sourceUpdatedAt.ok) rowErrors.push(sourceUpdatedAt.error);
    const idKey = externalId.toLowerCase();
    if (externalId && seenIds.has(idKey)) rowErrors.push("External volunteer ID is duplicated in this roster.");
    if (email && seenEmails.has(email)) rowErrors.push("Email is duplicated in this roster.");
    if (rowErrors.length) {
      errors.push(rowError("roster", rowNumber, externalId, rowErrors.join(" ")));
      continue;
    }
    seenIds.add(idKey);
    if (email) seenEmails.add(email);
    rows.push({
      rowNumber,
      volunteer: normalizeVolunteer({
        id: stableId("volunteer", externalId),
        externalId,
        eventId,
        name,
        email: email || null,
        phone: clean(record.phone, 40) || null,
        smsConsent: sms.value,
        roles: splitList(record.roles).map(key).filter(Boolean).slice(0, 12).length
          ? splitList(record.roles).map(key).filter(Boolean).slice(0, 12)
          : ["general"],
        waiverSigned: waiver.value,
        shirtSize: clean(record.shirt_size, 8) || null,
        status,
        source: "volunteerlocal",
        sourceUpdatedAt: sourceUpdatedAt.value,
        createdAt: sourceUpdatedAt.value || null
      })
    });
  }
  return { ok: true, rows, errors, totalRows: source.records.length };
}

function parseShifts(csv, defaults) {
  if (!String(csv ?? "").trim()) return { ok: true, rows: [], errors: [], totalRows: 0 };
  const source = parseCsv(csv, { label: "VolunteerLocal shifts", aliases: SHIFT_HEADERS, requiredHeaders: ["external_id", "role_id", "zone_id", "starts_at", "ends_at", "needed"] });
  if (!source.ok) return source;
  const grouped = new Map();
  const errors = [];
  for (const { rowNumber, record } of source.records) {
    const externalId = clean(record.external_id, 200);
    const eventId = clean(record.event_id, 160) || defaults.eventId;
    const startsAt = parseIso(record.starts_at, "Shift start", { required: true });
    const endsAt = parseIso(record.ends_at, "Shift end", { required: true });
    const needed = parseWholeNumber(record.needed, "Volunteers needed", { required: true, maximum: 10_000 });
    const roleId = key(record.role_id);
    const zoneId = key(record.zone_id);
    const rowErrors = [];
    if (!externalId) rowErrors.push("External shift ID is required.");
    if (!roleId) rowErrors.push("Role is required.");
    if (!zoneId) rowErrors.push("Zone is required.");
    if (eventId !== defaults.eventId) rowErrors.push(`Event ${eventId || "(blank)"} does not match ${defaults.eventId}.`);
    if (!startsAt.ok) rowErrors.push(startsAt.error);
    if (!endsAt.ok) rowErrors.push(endsAt.error);
    if (!needed.ok) rowErrors.push(needed.error);
    if (startsAt.value && endsAt.value && new Date(endsAt.value) <= new Date(startsAt.value)) rowErrors.push("Shift end must be after shift start.");
    if (rowErrors.length) {
      errors.push(rowError("shifts", rowNumber, externalId, rowErrors.join(" ")));
      continue;
    }
    const metadata = {
      externalId,
      eventId,
      roleId,
      zoneId,
      zoneLabel: clean(record.zone_label, 80) || null,
      day: clean(record.day, 40) || null,
      startsAt: startsAt.value,
      endsAt: endsAt.value,
      needed: needed.value,
      captainExternalId: clean(record.captain_external_id, 200) || null
    };
    const volunteerExternalIds = splitList(record.volunteer_external_ids);
    if (clean(record.volunteer_external_id, 200)) volunteerExternalIds.push(clean(record.volunteer_external_id, 200));
    const volunteerEmails = splitList(record.volunteer_emails).map(value => value.toLowerCase());
    if (clean(record.volunteer_email, 254)) volunteerEmails.push(clean(record.volunteer_email, 254).toLowerCase());
    const groupKey = externalId.toLowerCase();
    const existing = grouped.get(groupKey);
    if (existing && JSON.stringify(existing.metadata) !== JSON.stringify(metadata)) {
      errors.push(rowError("shifts", rowNumber, externalId, "Repeated shift rows must use identical role, zone, schedule, capacity, and captain data."));
      continue;
    }
    const group = existing || { rowNumber, metadata, volunteerExternalIds: new Set(), volunteerEmails: new Set() };
    volunteerExternalIds.forEach(value => group.volunteerExternalIds.add(value));
    volunteerEmails.forEach(value => group.volunteerEmails.add(value));
    grouped.set(groupKey, group);
  }
  return {
    ok: true,
    totalRows: source.records.length,
    errors,
    rows: [...grouped.values()].map(group => ({
      rowNumber: group.rowNumber,
      metadata: group.metadata,
      volunteerExternalIds: [...group.volunteerExternalIds],
      volunteerEmails: [...group.volunteerEmails]
    }))
  };
}

function parseHourLogs(csv, defaults) {
  if (!String(csv ?? "").trim()) return { ok: true, rows: [], errors: [], totalRows: 0 };
  const source = parseCsv(csv, { label: "VolunteerLocal hours", aliases: HOURS_HEADERS, requiredHeaders: ["external_id"] });
  if (!source.ok) return source;
  const rows = [];
  const errors = [];
  const seen = new Set();
  for (const { rowNumber, record } of source.records) {
    const externalId = clean(record.external_id, 200);
    const eventId = clean(record.event_id, 160) || defaults.eventId;
    const volunteerExternalId = clean(record.volunteer_external_id, 200);
    const volunteerEmail = clean(record.volunteer_email, 254).toLowerCase();
    const checkInAt = parseIso(record.check_in_at, "Check-in time");
    const checkOutAt = parseIso(record.check_out_at, "Check-out time");
    const hours = parseHours(record.hours, Boolean(checkInAt.value && checkOutAt.value));
    const rowErrors = [];
    if (!externalId) rowErrors.push("External hour-log ID is required.");
    if (!volunteerExternalId && !volunteerEmail) rowErrors.push("Volunteer external ID or email is required.");
    if (volunteerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(volunteerEmail)) rowErrors.push("Volunteer email is invalid.");
    if (eventId !== defaults.eventId) rowErrors.push(`Event ${eventId || "(blank)"} does not match ${defaults.eventId}.`);
    if (!checkInAt.ok) rowErrors.push(checkInAt.error);
    if (!checkOutAt.ok) rowErrors.push(checkOutAt.error);
    if (!hours.ok) rowErrors.push(hours.error);
    if (checkInAt.value && checkOutAt.value && new Date(checkOutAt.value) <= new Date(checkInAt.value)) rowErrors.push("Check-out must be after check-in.");
    const idKey = externalId.toLowerCase();
    if (externalId && seen.has(idKey)) rowErrors.push("External hour-log ID is duplicated in this file.");
    if (rowErrors.length) {
      errors.push(rowError("hours", rowNumber, externalId, rowErrors.join(" ")));
      continue;
    }
    seen.add(idKey);
    rows.push({
      rowNumber,
      input: {
        externalId,
        eventId,
        volunteerExternalId,
        volunteerEmail,
        shiftExternalId: clean(record.shift_external_id, 200) || null,
        checkInAt: checkInAt.value,
        checkOutAt: checkOutAt.value,
        hours: hours.value,
        notes: clean(record.notes, 400)
      }
    });
  }
  return { ok: true, rows, errors, totalRows: source.records.length };
}

export function parseVolunteerLocalBundle(bundle = {}, defaultsInput = {}) {
  const defaults = normalizeVolunteerLocalImportDefaults(defaultsInput);
  if (!defaults.eventId) return { ok: false, error: "A current event ID is required for VolunteerLocal imports." };
  const roster = parseRoster(bundle.rosterCsv, defaults);
  if (!roster.ok) return roster;
  const shifts = parseShifts(bundle.shiftsCsv, defaults);
  if (!shifts.ok) return shifts;
  const hours = parseHourLogs(bundle.hoursCsv, defaults);
  if (!hours.ok) return hours;
  return {
    ok: true,
    defaults,
    roster,
    shifts,
    hours,
    errors: [...roster.errors, ...shifts.errors, ...hours.errors],
    totalRows: roster.totalRows + shifts.totalRows + hours.totalRows
  };
}

function comparable(value) {
  const copy = structuredClone(value);
  delete copy.createdAt;
  delete copy.sourceBatch;
  delete copy.sourceRow;
  return JSON.stringify(copy);
}

function summaryBucket() {
  return { valid: 0, created: 0, updated: 0, unchanged: 0 };
}

export function applyVolunteerLocalImport(docInput, parsedImport, options = {}) {
  if (!parsedImport?.ok) return { ok: false, error: parsedImport?.error || "VolunteerLocal import is invalid." };
  const eventId = parsedImport.defaults.eventId;
  const base = docInput && typeof docInput === "object" ? structuredClone(docInput) : {};
  if (base.eventId && base.eventId !== eventId) {
    return { ok: false, error: `Volunteer data belongs to ${base.eventId}; complete rollover before importing ${eventId}.` };
  }
  const previewHash = clean(options.previewHash, 64).toLowerCase();
  const previousImport = (Array.isArray(base.imports) ? base.imports : []).find(item => item.previewHash === previewHash);
  if (options.commit && previewHash && previousImport) {
    return { ok: true, replay: true, changed: false, doc: base, summary: previousImport.summary, errors: [], importRecord: previousImport };
  }

  const now = options.now || new Date().toISOString();
  const batchId = clean(options.batchId, 200) || `volunteerlocal_${digest(`${now}:${previewHash}`).slice(0, 16)}`;
  const errors = [...parsedImport.errors];
  const summary = { volunteers: summaryBucket(), shifts: summaryBucket(), hourLogs: summaryBucket(), invalid: 0 };
  const volunteers = (Array.isArray(base.volunteers) ? base.volunteers : []).map(normalizeVolunteer);
  const shifts = (Array.isArray(base.shifts) ? base.shifts : []).map(normalizeShift);
  const hourLogs = (Array.isArray(base.hourLogs) ? base.hourLogs : []).map(normalizeHourLog);
  const locallyCheckedInVolunteerIds = new Set(
    hourLogs
      .filter(item => item.source === "sandfest_live" && item.checkInAt && !item.checkOutAt)
      .map(item => item.volunteerId)
  );

  for (const row of parsedImport.roster.rows) {
    summary.volunteers.valid += 1;
    const incoming = { ...row.volunteer, sourceBatch: batchId, sourceRow: row.rowNumber, createdAt: row.volunteer.createdAt || now };
    const byExternal = volunteers.findIndex(item => item.source === "volunteerlocal" && String(item.externalId || "").toLowerCase() === incoming.externalId.toLowerCase());
    const byEmail = incoming.email ? volunteers.findIndex(item => String(item.email || "").toLowerCase() === incoming.email) : -1;
    if (byExternal >= 0 && byEmail >= 0 && byExternal !== byEmail) {
      errors.push(rowError("roster", row.rowNumber, incoming.externalId, "External ID and email match different existing volunteers; resolve the roster conflict before import."));
      summary.volunteers.valid -= 1;
      continue;
    }
    const index = byExternal >= 0 ? byExternal : byEmail;
    if (index < 0) {
      volunteers.push(incoming);
      summary.volunteers.created += 1;
      continue;
    }
    const current = volunteers[index];
    const merged = normalizeVolunteer({
      ...incoming,
      id: current.id,
      captainId: current.captainId,
      createdAt: current.createdAt || incoming.createdAt,
      status: locallyCheckedInVolunteerIds.has(current.id) ? "checked_in" : incoming.status
    });
    if (comparable(current) === comparable(merged)) summary.volunteers.unchanged += 1;
    else {
      volunteers[index] = merged;
      summary.volunteers.updated += 1;
    }
  }

  const volunteerByExternal = new Map(volunteers.filter(item => item.source === "volunteerlocal" && item.externalId).map(item => [String(item.externalId).toLowerCase(), item]));
  const volunteerByEmail = new Map(volunteers.filter(item => item.email).map(item => [String(item.email).toLowerCase(), item]));
  const shiftByExternal = new Map(shifts.filter(item => item.source === "volunteerlocal" && item.externalId).map((item, index) => [String(item.externalId).toLowerCase(), index]));

  for (const row of parsedImport.shifts.rows) {
    const assigned = new Set();
    const unresolved = [];
    for (const externalId of row.volunteerExternalIds) {
      const volunteer = volunteerByExternal.get(externalId.toLowerCase());
      if (volunteer) assigned.add(volunteer.id);
      else unresolved.push(`volunteer ID ${externalId}`);
    }
    for (const email of row.volunteerEmails) {
      const volunteer = volunteerByEmail.get(email.toLowerCase());
      if (volunteer) assigned.add(volunteer.id);
      else unresolved.push(`volunteer email ${email}`);
    }
    const captain = row.metadata.captainExternalId
      ? volunteerByExternal.get(row.metadata.captainExternalId.toLowerCase())
      : null;
    if (row.metadata.captainExternalId && !captain) unresolved.push(`captain ID ${row.metadata.captainExternalId}`);
    if (unresolved.length) {
      errors.push(rowError("shifts", row.rowNumber, row.metadata.externalId, `Unresolved ${unresolved.join(", ")}.`));
      continue;
    }
    summary.shifts.valid += 1;
    const incoming = normalizeShift({
      id: stableId("shift", row.metadata.externalId),
      ...row.metadata,
      captainId: captain?.id || null,
      filledVolunteerIds: [...assigned],
      source: "volunteerlocal",
      sourceBatch: batchId,
      sourceRow: row.rowNumber
    });
    const index = shiftByExternal.get(row.metadata.externalId.toLowerCase()) ?? -1;
    if (index < 0) {
      shifts.push(incoming);
      shiftByExternal.set(row.metadata.externalId.toLowerCase(), shifts.length - 1);
      summary.shifts.created += 1;
    } else if (comparable(shifts[index]) === comparable(incoming)) summary.shifts.unchanged += 1;
    else {
      incoming.id = shifts[index].id;
      shifts[index] = incoming;
      summary.shifts.updated += 1;
    }
  }

  const currentShiftByExternal = new Map(shifts.filter(item => item.source === "volunteerlocal" && item.externalId).map(item => [String(item.externalId).toLowerCase(), item]));
  const hourByExternal = new Map(hourLogs.filter(item => item.source === "volunteerlocal" && item.externalId).map((item, index) => [String(item.externalId).toLowerCase(), index]));
  for (const row of parsedImport.hours.rows) {
    const volunteerFromId = row.input.volunteerExternalId ? volunteerByExternal.get(row.input.volunteerExternalId.toLowerCase()) : null;
    const volunteerFromEmail = row.input.volunteerEmail ? volunteerByEmail.get(row.input.volunteerEmail.toLowerCase()) : null;
    if (volunteerFromId && volunteerFromEmail && volunteerFromId.id !== volunteerFromEmail.id) {
      errors.push(rowError("hours", row.rowNumber, row.input.externalId, "Volunteer ID and email resolve to different roster records."));
      continue;
    }
    const volunteer = volunteerFromId || volunteerFromEmail;
    if (!volunteer) {
      errors.push(rowError("hours", row.rowNumber, row.input.externalId, "The referenced volunteer is not in the current mirror."));
      continue;
    }
    const shift = row.input.shiftExternalId ? currentShiftByExternal.get(row.input.shiftExternalId.toLowerCase()) : null;
    if (row.input.shiftExternalId && !shift) {
      errors.push(rowError("hours", row.rowNumber, row.input.externalId, "The referenced shift is not in the current mirror."));
      continue;
    }
    summary.hourLogs.valid += 1;
    const incoming = normalizeHourLog({
      id: stableId("hours", row.input.externalId),
      externalId: row.input.externalId,
      eventId,
      volunteerId: volunteer.id,
      shiftId: shift?.id || null,
      checkInAt: row.input.checkInAt,
      checkOutAt: row.input.checkOutAt,
      hours: row.input.hours,
      method: "import",
      notes: row.input.notes,
      source: "volunteerlocal",
      sourceBatch: batchId,
      sourceRow: row.rowNumber
    });
    const index = hourByExternal.get(row.input.externalId.toLowerCase()) ?? -1;
    if (index < 0) {
      hourLogs.push(incoming);
      hourByExternal.set(row.input.externalId.toLowerCase(), hourLogs.length - 1);
      summary.hourLogs.created += 1;
    } else if (comparable(hourLogs[index]) === comparable(incoming)) summary.hourLogs.unchanged += 1;
    else {
      incoming.id = hourLogs[index].id;
      hourLogs[index] = incoming;
      summary.hourLogs.updated += 1;
    }
  }

  summary.invalid = errors.length;
  const changed = [summary.volunteers, summary.shifts, summary.hourLogs].some(bucket => bucket.created > 0 || bucket.updated > 0);
  const importRecord = {
    id: batchId,
    provider: "volunteerlocal",
    previewHash: previewHash || null,
    bundleHash: clean(options.bundleHash, 64).toLowerCase() || null,
    importedAt: now,
    importedBy: clean(options.actorId, 160) || null,
    files: {
      roster: clean(options.fileNames?.roster, 300) || null,
      shifts: clean(options.fileNames?.shifts, 300) || null,
      hours: clean(options.fileNames?.hours, 300) || null
    },
    summary: structuredClone(summary)
  };
  const imports = Array.isArray(base.imports) ? base.imports.slice() : [];
  if (options.commit) imports.push(importRecord);
  const doc = {
    ...base,
    _note: "VolunteerLocal roster, shift, and hours mirror. Imported through preview-gated reconciliation.",
    eventId,
    source: "volunteerlocal",
    lastUpdated: options.commit ? now : base.lastUpdated || null,
    zoneLabels: base.zoneLabels || {},
    volunteers,
    shifts,
    hourLogs,
    imports: imports.slice(-VOLUNTEERLOCAL_IMPORT_HISTORY_LIMIT)
  };
  return { ok: true, replay: false, changed, doc, summary, errors, importRecord: options.commit ? importRecord : null };
}
