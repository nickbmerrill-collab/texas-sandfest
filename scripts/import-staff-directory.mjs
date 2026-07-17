#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { eventContextConfig } from "../lib/event-context.mjs";
import { loadDotEnv } from "../lib/load-env.mjs";
import { readPlatformDoc, writePlatformDoc } from "../lib/platform-data.mjs";
import { resolveRuntimeRoot } from "../lib/runtime-root.mjs";
import {
  SANDFEST_STAFF_DIRECTORY_SOURCES,
  normalizeStaffDirectory,
  publicStaffAssignmentDirectory,
  staffDirectoryReadiness
} from "../lib/staff-directory.mjs";

await loadDotEnv();

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolveRuntimeRoot(CODE_ROOT);
const args = process.argv.slice(2);
const inputPath = args.find(value => !value.startsWith("--"));
const sourceArg = args.find(value => value.startsWith("--source="));
const source = String(sourceArg?.slice("--source=".length) || "").trim().toLowerCase();
const commit = args.includes("--commit");
const eventId = eventContextConfig(process.env).eventId;

if (!inputPath || !source) {
  throw new Error("Usage: npm run import:staff -- path/to/staff.json --source=manual_verified [--commit]");
}
if (!SANDFEST_STAFF_DIRECTORY_SOURCES.includes(source)) {
  throw new Error(`Staff source must be one of: ${SANDFEST_STAFF_DIRECTORY_SOURCES.join(", ")}.`);
}
if (commit && process.env.SANDFEST_ENV === "production" && !process.env.SANDFEST_DATABASE_URL) {
  throw new Error("Production staff imports require SANDFEST_DATABASE_URL; file-mode production writes are refused.");
}

function splitList(value) {
  return [...new Set(String(value || "").split(/[|;,]/).map(item => item.trim()).filter(Boolean))];
}

function fromCsv(contents) {
  const rows = parse(contents, { bom: true, columns: true, skip_empty_lines: true, trim: true });
  return {
    eventId,
    staff: rows.map((row, index) => ({
      id: row.id || row.staff_id || row.employee_id || `staff_import_${index + 1}`,
      eventId,
      name: row.name || row.full_name || row.employee_name,
      email: row.email || row.work_email,
      status: row.status || "active",
      roles: splitList(row.roles || row.role),
      teams: splitList(row.teams || row.team)
    })),
    teamRoutes: rows.flatMap((row, index) => {
      const staffId = row.id || row.staff_id || row.employee_id || `staff_import_${index + 1}`;
      return splitList(row.notification_teams || row.notification_team)
        .map(teamId => ({ teamId, notificationOwnerId: staffId }));
    })
  };
}

const contents = await readFile(inputPath, "utf8");
const parsed = path.extname(inputPath).toLowerCase() === ".csv" ? fromCsv(contents) : JSON.parse(contents);
const duplicateTeamRoutes = (parsed.teamRoutes || []).map(item => item.teamId).filter((teamId, index, all) => teamId && all.indexOf(teamId) !== index);
if (duplicateTeamRoutes.length) {
  throw new Error(`Each team must have exactly one notification owner; duplicate routes: ${[...new Set(duplicateTeamRoutes)].join(", ")}.`);
}

const now = new Date().toISOString();
const candidate = normalizeStaffDirectory({
  ...parsed,
  source,
  lastUpdated: now,
  verifiedAt: now
}, { eventId });
const readiness = staffDirectoryReadiness(candidate, { eventId, production: true, now });
const existing = await readPlatformDoc(ROOT, "staffDirectory", null);
if (existing?.eventId && existing.eventId !== eventId) {
  throw new Error(`Staff data belongs to ${existing.eventId}; complete the archive-first rollover before importing ${eventId}.`);
}
if (!readiness.ready) throw new Error(readiness.reason);

const publicDirectory = publicStaffAssignmentDirectory(candidate, { eventId });
if (commit) await writePlatformDoc(ROOT, "staffDirectory", candidate);
console.log(JSON.stringify({
  ok: true,
  committed: commit,
  eventId,
  source,
  activeStaff: readiness.activeStaff,
  routedTeams: readiness.routedTeams,
  totalTeams: readiness.totalTeams,
  staff: publicDirectory.staff,
  teams: publicDirectory.teams
}, null, 2));
