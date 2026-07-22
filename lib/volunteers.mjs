// Volunteer mirror + coverage summarizer — Phase 1 glue from
// docs/research/01-volunteer-scheduling.md.
//
// VolunteerLocal (or Track It Forward) owns signup/scheduling/kiosk hours.
// This module normalizes the mirrored roster/shifts/hour-logs into ops KPIs:
// coverage-vs-needed by zone/role, open gaps, and total hours for impact
// reporting. Pure (no I/O) so the same summarizer feeds the admin API, web
// ops console, and iOS Command coverage tiles.

export const VOLUNTEER_STATUSES = [
  "interested",
  "confirmed",
  "checked_in",
  "no_show",
  "cancelled"
];

export const VOLUNTEER_SOURCES = [
  "self_signup",
  "volunteerlocal",
  "track_it_forward",
  "manual",
  "import"
];

export const HOUR_METHODS = ["kiosk_qr", "mobile", "captain", "import", "manual"];

const LIVE_ATTENDANCE_METHODS = new Set(["kiosk_qr", "mobile", "captain", "manual"]);
const ATTENDANCE_ELIGIBLE_STATUSES = new Set(["confirmed", "checked_in"]);

function clean(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function validInstant(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function normalizeVolunteer(raw = {}) {
  const status = VOLUNTEER_STATUSES.includes(raw.status) ? raw.status : "interested";
  const source = VOLUNTEER_SOURCES.includes(raw.source) ? raw.source : "manual";
  const roles = Array.isArray(raw.roles)
    ? raw.roles.map(r => String(r).trim()).filter(Boolean).slice(0, 12)
    : [];
  return {
    id: raw.id ?? null,
    externalId: raw.externalId == null ? null : String(raw.externalId).trim().slice(0, 200),
    eventId: raw.eventId ?? DEFAULT_EVENT_ID,
    name: String(raw.name ?? "").trim().slice(0, 120),
    email: raw.email == null ? null : String(raw.email).trim().slice(0, 160),
    phone: raw.phone == null ? null : String(raw.phone).trim().slice(0, 40),
    smsConsent: Boolean(raw.smsConsent),
    roles,
    captainId: raw.captainId ?? null,
    waiverSigned: Boolean(raw.waiverSigned),
    shirtSize: raw.shirtSize == null ? null : String(raw.shirtSize).trim().slice(0, 8),
    status,
    source,
    sourceBatch: raw.sourceBatch == null ? null : String(raw.sourceBatch).trim().slice(0, 200),
    sourceRow: raw.sourceRow != null && Number.isInteger(Number(raw.sourceRow)) ? Number(raw.sourceRow) : null,
    sourceUpdatedAt: raw.sourceUpdatedAt ?? null,
    createdAt: raw.createdAt ?? null
  };
}

export function normalizeShift(raw = {}) {
  const filled = Array.isArray(raw.filledVolunteerIds)
    ? raw.filledVolunteerIds.map(id => String(id)).filter(Boolean)
    : [];
  const needed = Math.max(0, Number(raw.needed) || 0);
  return {
    id: raw.id ?? null,
    externalId: raw.externalId == null ? null : String(raw.externalId).trim().slice(0, 200),
    eventId: raw.eventId ?? DEFAULT_EVENT_ID,
    roleId: String(raw.roleId ?? "general").trim().slice(0, 40),
    zoneId: String(raw.zoneId ?? "unassigned").trim().slice(0, 40),
    zoneLabel: raw.zoneLabel == null ? null : String(raw.zoneLabel).trim().slice(0, 80),
    day: raw.day == null ? null : String(raw.day).trim().slice(0, 40),
    startsAt: raw.startsAt ?? null,
    endsAt: raw.endsAt ?? null,
    needed,
    filledVolunteerIds: filled,
    captainId: raw.captainId ?? null,
    source: raw.source == null ? null : String(raw.source).trim().slice(0, 80),
    sourceBatch: raw.sourceBatch == null ? null : String(raw.sourceBatch).trim().slice(0, 200),
    sourceRow: raw.sourceRow != null && Number.isInteger(Number(raw.sourceRow)) ? Number(raw.sourceRow) : null
  };
}

export function normalizeHourLog(raw = {}) {
  const method = HOUR_METHODS.includes(raw.method) ? raw.method : "manual";
  let hours = raw.hours == null ? null : Number(raw.hours);
  if ((hours == null || !Number.isFinite(hours)) && raw.checkInAt && raw.checkOutAt) {
    const start = Date.parse(raw.checkInAt);
    const end = Date.parse(raw.checkOutAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      hours = Math.round(((end - start) / 3_600_000) * 100) / 100;
    }
  }
  return {
    id: raw.id ?? null,
    externalId: raw.externalId == null ? null : String(raw.externalId).trim().slice(0, 200),
    eventId: raw.eventId ?? DEFAULT_EVENT_ID,
    volunteerId: raw.volunteerId ?? null,
    shiftId: raw.shiftId ?? null,
    checkInAt: raw.checkInAt ?? null,
    checkOutAt: raw.checkOutAt ?? null,
    hours: Number.isFinite(hours) ? hours : 0,
    verifiedBy: raw.verifiedBy ?? null,
    method,
    notes: raw.notes == null ? "" : String(raw.notes).trim().slice(0, 400),
    source: raw.source == null ? null : String(raw.source).trim().slice(0, 80),
    sourceBatch: raw.sourceBatch == null ? null : String(raw.sourceBatch).trim().slice(0, 200),
    sourceRow: raw.sourceRow != null && Number.isInteger(Number(raw.sourceRow)) ? Number(raw.sourceRow) : null
  };
}

function shiftGap(shift) {
  return Math.max(0, shift.needed - shift.filledVolunteerIds.length);
}

function shiftFillPct(shift) {
  if (!shift.needed) return 100;
  return Math.round((shift.filledVolunteerIds.length / shift.needed) * 1000) / 10;
}

function coverageStatus(filled, needed) {
  if (needed <= 0) return "n/a";
  if (filled >= needed) return "full";
  if (filled >= needed * 0.75) return "thin";
  return "critical";
}

/**
 * Build zone-level coverage rows (compatible with the existing iOS
 * VolunteerCoverage tiles: id, zone, filled, needed) plus richer fields.
 */
export function coverageByZone(rawShifts = [], zoneLabels = {}) {
  const shifts = rawShifts.map(normalizeShift);
  const byZone = new Map();

  for (const shift of shifts) {
    const key = shift.zoneId;
    if (!byZone.has(key)) {
      byZone.set(key, {
        id: key,
        zoneId: key,
        zone: zoneLabels[key] || shift.zoneLabel || humanize(key),
        filled: 0,
        needed: 0,
        shifts: 0,
        openGaps: 0,
        roles: new Set()
      });
    }
    const row = byZone.get(key);
    row.filled += shift.filledVolunteerIds.length;
    row.needed += shift.needed;
    row.shifts += 1;
    row.openGaps += shiftGap(shift);
    row.roles.add(shift.roleId);
  }

  return [...byZone.values()]
    .map(row => ({
      id: row.id,
      zoneId: row.zoneId,
      zone: row.zone,
      filled: row.filled,
      needed: row.needed,
      shifts: row.shifts,
      openGaps: row.openGaps,
      roles: [...row.roles].sort(),
      fillPct: row.needed ? Math.round((row.filled / row.needed) * 1000) / 10 : 100,
      status: coverageStatus(row.filled, row.needed)
    }))
    .sort((a, b) => a.zone.localeCompare(b.zone));
}

export function coverageByRole(rawShifts = []) {
  const shifts = rawShifts.map(normalizeShift);
  const byRole = new Map();
  for (const shift of shifts) {
    const key = shift.roleId;
    if (!byRole.has(key)) {
      byRole.set(key, { roleId: key, filled: 0, needed: 0, shifts: 0, openGaps: 0 });
    }
    const row = byRole.get(key);
    row.filled += shift.filledVolunteerIds.length;
    row.needed += shift.needed;
    row.shifts += 1;
    row.openGaps += shiftGap(shift);
  }
  return [...byRole.values()]
    .map(row => ({
      ...row,
      fillPct: row.needed ? Math.round((row.filled / row.needed) * 1000) / 10 : 100,
      status: coverageStatus(row.filled, row.needed)
    }))
    .sort((a, b) => a.roleId.localeCompare(b.roleId));
}

function humanize(id) {
  return String(id || "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

export function summarizeVolunteers(
  rawVolunteers = [],
  rawShifts = [],
  rawHourLogs = [],
  opts = {}
) {
  const volunteers = rawVolunteers.map(normalizeVolunteer);
  const shifts = rawShifts.map(normalizeShift);
  const hourLogs = rawHourLogs.map(normalizeHourLog);

  const byStatus = {};
  for (const status of VOLUNTEER_STATUSES) byStatus[status] = 0;
  let waiverSigned = 0;
  let smsConsent = 0;
  for (const v of volunteers) {
    byStatus[v.status] = (byStatus[v.status] ?? 0) + 1;
    if (v.waiverSigned) waiverSigned += 1;
    if (v.smsConsent) smsConsent += 1;
  }

  let slotsNeeded = 0;
  let slotsFilled = 0;
  let openGaps = 0;
  const understaffed = [];
  for (const shift of shifts) {
    slotsNeeded += shift.needed;
    slotsFilled += shift.filledVolunteerIds.length;
    const gap = shiftGap(shift);
    openGaps += gap;
    if (gap > 0) {
      understaffed.push({
        shiftId: shift.id,
        zoneId: shift.zoneId,
        zoneLabel: shift.zoneLabel || humanize(shift.zoneId),
        roleId: shift.roleId,
        day: shift.day,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        needed: shift.needed,
        filled: shift.filledVolunteerIds.length,
        gap,
        fillPct: shiftFillPct(shift),
        status: coverageStatus(shift.filledVolunteerIds.length, shift.needed)
      });
    }
  }
  understaffed.sort((a, b) => b.gap - a.gap || String(a.startsAt).localeCompare(String(b.startsAt)));

  const totalHours = Math.round(hourLogs.reduce((sum, h) => sum + (h.hours || 0), 0) * 100) / 100;
  const openHourLogs = hourLogs.filter(h => h.checkInAt && !h.checkOutAt).length;

  const zones = coverageByZone(shifts, opts.zoneLabels || {});
  const roles = coverageByRole(shifts);

  return {
    eventId: opts.eventId || DEFAULT_EVENT_ID,
    source: opts.source || "seed",
    generatedAt: opts.generatedAt || null,
    totals: {
      volunteers: volunteers.length,
      confirmed: byStatus.confirmed ?? 0,
      checkedIn: byStatus.checked_in ?? 0,
      waiverSigned,
      smsConsent,
      shifts: shifts.length,
      slotsNeeded,
      slotsFilled,
      openGaps,
      fillPct: slotsNeeded ? Math.round((slotsFilled / slotsNeeded) * 1000) / 10 : 100,
      totalHours,
      hourLogs: hourLogs.length,
      openHourLogs
    },
    byStatus,
    zones,
    roles,
    understaffed: understaffed.slice(0, opts.understaffedLimit ?? 20)
  };
}

// Enrich shifts with gap/fill for list UIs.
export function enrichShifts(rawShifts = []) {
  return rawShifts.map(normalizeShift).map(shift => {
    const filled = shift.filledVolunteerIds.length;
    return {
      ...shift,
      filled,
      gap: shiftGap(shift),
      fillPct: shiftFillPct(shift),
      status: coverageStatus(filled, shift.needed)
    };
  });
}

export function volunteerAttendanceBoard(rawVolunteers = [], rawShifts = [], rawHourLogs = []) {
  const volunteers = rawVolunteers.map(normalizeVolunteer);
  const shifts = rawShifts.map(normalizeShift);
  const hourLogs = rawHourLogs.map(normalizeHourLog);
  const volunteerById = new Map(volunteers.map(item => [item.id, item]));
  const shiftById = new Map(shifts.map(item => [item.id, item]));
  const activeByVolunteer = new Map(
    hourLogs.filter(item => item.checkInAt && !item.checkOutAt).map(item => [item.volunteerId, item])
  );
  const latestByAssignment = new Map();
  for (const item of [...hourLogs].sort((a, b) => String(a.checkInAt || "").localeCompare(String(b.checkInAt || "")))) {
    if (item.volunteerId && item.shiftId) latestByAssignment.set(`${item.shiftId}:${item.volunteerId}`, item);
  }

  const assignments = shifts.flatMap(shift => shift.filledVolunteerIds.map(volunteerId => {
    const volunteer = volunteerById.get(volunteerId);
    if (!volunteer) return null;
    const attendance = latestByAssignment.get(`${shift.id}:${volunteerId}`) || null;
    const activeElsewhere = activeByVolunteer.get(volunteerId);
    let attendanceStatus = "scheduled";
    if (attendance?.checkInAt && !attendance.checkOutAt) attendanceStatus = "checked_in";
    else if (attendance?.checkOutAt) attendanceStatus = "checked_out";
    else if (activeElsewhere) attendanceStatus = "checked_in_elsewhere";
    else if (["no_show", "cancelled"].includes(volunteer.status)) attendanceStatus = volunteer.status;
    return {
      id: `${shift.id}:${volunteerId}`,
      shiftId: shift.id,
      volunteerId,
      volunteerName: volunteer.name,
      volunteerStatus: volunteer.status,
      roleId: shift.roleId,
      zoneId: shift.zoneId,
      zoneLabel: shift.zoneLabel || humanize(shift.zoneId),
      day: shift.day,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      captain: shift.captainId === volunteerId,
      attendanceStatus,
      attendanceId: attendance?.id || activeElsewhere?.id || null,
      checkInAt: attendance?.checkInAt || activeElsewhere?.checkInAt || null,
      checkOutAt: attendance?.checkOutAt || null,
      hours: attendance?.hours || 0,
      canCheckIn: attendanceStatus === "scheduled" && ATTENDANCE_ELIGIBLE_STATUSES.has(volunteer.status),
      canCheckOut: attendanceStatus === "checked_in"
    };
  }).filter(Boolean));

  const recent = [...hourLogs]
    .sort((a, b) => String(b.checkOutAt || b.checkInAt || "").localeCompare(String(a.checkOutAt || a.checkInAt || "")))
    .slice(0, 50)
    .map(item => ({
      ...item,
      volunteerName: volunteerById.get(item.volunteerId)?.name || "Unknown volunteer",
      zoneLabel: shiftById.get(item.shiftId)?.zoneLabel || humanize(shiftById.get(item.shiftId)?.zoneId || "unassigned"),
      roleId: shiftById.get(item.shiftId)?.roleId || "general"
    }));

  return {
    assignments,
    recent,
    summary: {
      assigned: assignments.length,
      scheduled: assignments.filter(item => item.attendanceStatus === "scheduled").length,
      checkedIn: assignments.filter(item => item.attendanceStatus === "checked_in").length,
      checkedOut: assignments.filter(item => item.attendanceStatus === "checked_out").length,
      exceptions: assignments.filter(item => ["checked_in_elsewhere", "no_show", "cancelled"].includes(item.attendanceStatus)).length
    }
  };
}

export function applyVolunteerAttendance(docInput, input = {}, options = {}) {
  const eventId = clean(options.eventId || docInput?.eventId, 120);
  const now = validInstant(options.now || new Date().toISOString());
  if (!eventId || !now) return { ok: false, error: "Current event and attendance time are required." };
  if (docInput?.eventId && docInput.eventId !== eventId) {
    return { ok: false, conflict: true, error: `Volunteer attendance belongs to ${docInput.eventId}; complete rollover before recording ${eventId}.` };
  }

  const action = clean(input.action, 40).toLowerCase();
  if (!new Set(["check_in", "check_out"]).has(action)) return { ok: false, error: "Action must be check_in or check_out." };
  const volunteers = (Array.isArray(docInput?.volunteers) ? docInput.volunteers : []).map(normalizeVolunteer);
  const shifts = (Array.isArray(docInput?.shifts) ? docInput.shifts : []).map(normalizeShift);
  const hourLogs = (Array.isArray(docInput?.hourLogs) ? docInput.hourLogs : []).map(normalizeHourLog);
  const volunteerId = clean(input.volunteerId, 160);
  const shiftId = clean(input.shiftId, 160);
  const volunteerIndex = volunteers.findIndex(item => item.id === volunteerId);
  const shift = shifts.find(item => item.id === shiftId);
  if (volunteerIndex < 0) return { ok: false, error: "Volunteer not found in the current roster." };
  if (!shift) return { ok: false, error: "Shift not found in the current schedule." };
  if (volunteers[volunteerIndex].eventId !== eventId || shift.eventId !== eventId) {
    return { ok: false, conflict: true, error: "Volunteer and shift must belong to the current event." };
  }
  if (!shift.filledVolunteerIds.includes(volunteerId)) {
    return { ok: false, conflict: true, error: `${volunteers[volunteerIndex].name} is not assigned to this shift.` };
  }

  const note = clean(input.note, 400);
  const active = hourLogs.find(item => item.volunteerId === volunteerId && item.checkInAt && !item.checkOutAt) || null;
  const assignmentHistory = hourLogs
    .filter(item => item.volunteerId === volunteerId && item.shiftId === shiftId)
    .sort((a, b) => String(b.checkInAt || "").localeCompare(String(a.checkInAt || "")));

  if (action === "check_in") {
    if (active?.shiftId === shiftId) {
      return { ok: true, replay: true, doc: docInput, attendance: active, volunteer: volunteers[volunteerIndex], shift };
    }
    if (active) return { ok: false, conflict: true, error: `${volunteers[volunteerIndex].name} is already checked into another shift.` };
    if (assignmentHistory.some(item => item.checkOutAt)) {
      return { ok: false, conflict: true, error: `${volunteers[volunteerIndex].name} already completed this shift.` };
    }
    if (!ATTENDANCE_ELIGIBLE_STATUSES.has(volunteers[volunteerIndex].status)) {
      return { ok: false, conflict: true, error: `${volunteers[volunteerIndex].name} must be confirmed before check-in.` };
    }
    const requestedMethod = clean(input.method, 40).toLowerCase();
    const method = LIVE_ATTENDANCE_METHODS.has(requestedMethod) ? requestedMethod : "captain";
    const attendance = normalizeHourLog({
      id: clean(input.id, 160) || options.idFactory?.() || `attendance_${Date.now()}`,
      eventId,
      volunteerId,
      shiftId,
      checkInAt: now,
      checkOutAt: null,
      hours: 0,
      verifiedBy: clean(options.actorId, 160) || null,
      method,
      notes: note,
      source: "sandfest_live"
    });
    const volunteer = { ...volunteers[volunteerIndex], status: "checked_in" };
    volunteers[volunteerIndex] = volunteer;
    const doc = {
      ...(docInput && typeof docInput === "object" ? structuredClone(docInput) : {}),
      eventId,
      lastUpdated: now,
      volunteers,
      shifts,
      hourLogs: [...hourLogs, attendance]
    };
    return { ok: true, replay: false, doc, attendance, volunteer, shift };
  }

  const attendanceId = clean(input.attendanceId, 160);
  if (!attendanceId) return { ok: false, error: "Attendance record is required for check-out." };
  const attendanceIndex = hourLogs.findIndex(item => item.id === attendanceId);
  if (attendanceIndex < 0) return { ok: false, conflict: true, error: "Attendance record is no longer available." };
  const current = hourLogs[attendanceIndex];
  if (current.volunteerId !== volunteerId || current.shiftId !== shiftId) {
    return { ok: false, conflict: true, error: "Attendance record does not match this volunteer and shift." };
  }
  if (current.checkOutAt) {
    return { ok: true, replay: true, doc: docInput, attendance: current, volunteer: volunteers[volunteerIndex], shift };
  }
  if (!current.checkInAt || Date.parse(now) <= Date.parse(current.checkInAt)) {
    return { ok: false, conflict: true, error: "Check-out must be after the recorded check-in." };
  }
  const attendance = normalizeHourLog({ ...current, checkOutAt: now, hours: null, notes: note || current.notes });
  hourLogs[attendanceIndex] = attendance;
  const hasOtherActive = hourLogs.some((item, index) => index !== attendanceIndex && item.volunteerId === volunteerId && item.checkInAt && !item.checkOutAt);
  const volunteer = { ...volunteers[volunteerIndex], status: hasOtherActive ? "checked_in" : "confirmed" };
  volunteers[volunteerIndex] = volunteer;
  const doc = {
    ...(docInput && typeof docInput === "object" ? structuredClone(docInput) : {}),
    eventId,
    lastUpdated: now,
    volunteers,
    shifts,
    hourLogs
  };
  return { ok: true, replay: false, doc, attendance, volunteer, shift };
}
import { DEFAULT_EVENT_ID } from "./event-context.mjs";
