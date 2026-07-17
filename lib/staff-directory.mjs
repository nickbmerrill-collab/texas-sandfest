import { DEFAULT_EVENT_ID } from "./event-context.mjs";

export const SANDFEST_TASK_TEAMS = Object.freeze([
  { id: "operations", name: "Operations team" },
  { id: "sponsor", name: "Sponsor team" },
  { id: "finance", name: "Finance team" },
  { id: "volunteer-captains", name: "Volunteer captains" },
  { id: "traffic", name: "Traffic and parking" },
  { id: "guest-services", name: "Guest services" },
  { id: "production", name: "Production team" }
]);

const TEAM_IDS = new Set(SANDFEST_TASK_TEAMS.map(item => item.id));
const ACTIVE_STATUSES = new Set(["active", "on_call"]);
const STAFF_STATUSES = new Set([...ACTIVE_STATUSES, "leave", "inactive"]);
export const SANDFEST_STAFF_DIRECTORY_SOURCES = Object.freeze(["connecteam", "manual_verified", "oidc", "hr_import"]);

const LIVE_SOURCES = new Set(SANDFEST_STAFF_DIRECTORY_SOURCES);

function text(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function email(value) {
  const normalized = text(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : "";
}

function instant(value) {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function values(input, max = 20) {
  return [...new Set((Array.isArray(input) ? input : []).map(item => text(item, 100)).filter(Boolean))].slice(0, max);
}

function staffId(value) {
  const id = text(value, 100);
  return /^[a-z0-9][a-z0-9_-]*$/i.test(id) ? id : "";
}

export function normalizeStaffDirectory(input, options = {}) {
  const source = input && typeof input === "object" ? input : {};
  const seen = new Set();
  const staff = (Array.isArray(source.staff) ? source.staff : []).map(item => {
    const id = staffId(item?.id);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    return {
      id,
      eventId: text(item.eventId, 40) || text(source.eventId, 40) || options.eventId || DEFAULT_EVENT_ID,
      name: text(item.name, 120) || id,
      email: email(item.email),
      status: STAFF_STATUSES.has(item.status) ? item.status : "inactive",
      roles: values(item.roles),
      teams: values(item.teams).filter(teamId => TEAM_IDS.has(teamId)),
      source: text(item.source, 60) || text(source.source, 60) || "unknown"
    };
  }).filter(Boolean);
  const teamRoutes = (Array.isArray(source.teamRoutes) ? source.teamRoutes : []).map(route => {
    const teamId = text(route?.teamId, 60);
    const notificationOwnerId = staffId(route?.notificationOwnerId);
    return TEAM_IDS.has(teamId) && notificationOwnerId ? { teamId, notificationOwnerId } : null;
  }).filter(Boolean).filter((route, index, list) => list.findIndex(item => item.teamId === route.teamId) === index);
  return {
    schemaVersion: 1,
    eventId: text(source.eventId, 40) || options.eventId || DEFAULT_EVENT_ID,
    source: text(source.source, 60) || "unknown",
    lastUpdated: instant(source.lastUpdated),
    verifiedAt: instant(source.verifiedAt),
    staff,
    teamRoutes
  };
}

export function staffTaskRecipients(input, options = {}) {
  const directory = normalizeStaffDirectory(input, options);
  const active = directory.staff.filter(item => ACTIVE_STATUSES.has(item.status) && item.email);
  const recipients = active.map(item => ({
    id: item.id,
    assigneeType: "staff",
    name: item.name,
    email: item.email,
    status: item.status
  }));
  for (const team of SANDFEST_TASK_TEAMS) {
    const route = directory.teamRoutes.find(item => item.teamId === team.id);
    const owner = active.find(item => item.id === route?.notificationOwnerId);
    if (!owner) continue;
    recipients.push({
      id: team.id,
      assigneeType: "team",
      name: owner.name,
      email: owner.email,
      status: owner.status
    });
  }
  return recipients;
}

export function publicStaffAssignmentDirectory(input, options = {}) {
  const directory = normalizeStaffDirectory(input, options);
  const recipients = staffTaskRecipients(directory, options);
  return {
    source: directory.source,
    lastUpdated: directory.lastUpdated,
    staff: directory.staff.filter(item => ACTIVE_STATUSES.has(item.status)).map(item => ({
      id: item.id,
      name: item.name,
      status: item.status,
      roles: item.roles,
      teams: item.teams,
      emailAvailable: Boolean(item.email)
    })),
    teams: SANDFEST_TASK_TEAMS.map(team => {
      const recipient = recipients.find(item => item.assigneeType === "team" && item.id === team.id);
      return { ...team, notificationReady: Boolean(recipient) };
    })
  };
}

export function staffDirectoryReadiness(input, options = {}) {
  const directory = normalizeStaffDirectory(input, options);
  const recipients = staffTaskRecipients(directory, options);
  const activeStaff = directory.staff.filter(item => ACTIVE_STATUSES.has(item.status));
  const missingEmail = activeStaff.filter(item => !item.email).map(item => item.id);
  const eventMismatchStaff = directory.staff.filter(item => item.eventId !== directory.eventId).map(item => item.id);
  const missingTeamRoutes = SANDFEST_TASK_TEAMS
    .filter(team => !recipients.some(item => item.assigneeType === "team" && item.id === team.id))
    .map(item => item.id);
  const expectedEventId = options.eventId || DEFAULT_EVENT_ID;
  const verifiedMs = new Date(directory.verifiedAt || 0).getTime();
  const maxAgeDays = Math.max(1, Number(options.maxAgeDays || 90));
  const nowMs = new Date(options.now || Date.now()).getTime();
  const stale = !Number.isFinite(verifiedMs) || !Number.isFinite(nowMs) || nowMs - verifiedMs > maxAgeDays * 86_400_000;
  const errors = [];
  if (directory.eventId !== expectedEventId) errors.push(`directory event ${directory.eventId || "missing"} does not match ${expectedEventId}`);
  if (!activeStaff.length) errors.push("no active staff members");
  if (missingEmail.length) errors.push(`active staff missing email: ${missingEmail.join(", ")}`);
  if (eventMismatchStaff.length) errors.push(`staff assigned to another event: ${eventMismatchStaff.join(", ")}`);
  if (missingTeamRoutes.length) errors.push(`teams missing notification owners: ${missingTeamRoutes.join(", ")}`);
  if (options.production && !LIVE_SOURCES.has(directory.source)) errors.push(`directory source ${directory.source || "missing"} is not production verified`);
  if (options.production && stale) errors.push(`directory verification is older than ${maxAgeDays} days`);
  return {
    ready: errors.length === 0,
    eventId: directory.eventId,
    source: directory.source,
    lastUpdated: directory.lastUpdated,
    verifiedAt: directory.verifiedAt,
    activeStaff: activeStaff.length,
    routedTeams: SANDFEST_TASK_TEAMS.length - missingTeamRoutes.length,
    totalTeams: SANDFEST_TASK_TEAMS.length,
    missingEmail,
    eventMismatchStaff,
    missingTeamRoutes,
    errors,
    reason: errors.length ? `Staff directory is not ready: ${errors.join("; ")}.` : null
  };
}
