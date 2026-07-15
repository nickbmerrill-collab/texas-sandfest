#!/usr/bin/env node
// Import VolunteerLocal-style CSV into data/processed/volunteer-mirror.json.
// Usage: node scripts/import-volunteers-csv.mjs [path/to/export.csv]
// Minimal headers: name, email, phone, roles, status, waiver_signed, sms_consent
// Optional shifts sheet not supported in v1 — keeps existing shifts if present.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeVolunteer, summarizeVolunteers } from "../lib/volunteers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "processed", "volunteer-mirror.json");
const input = process.argv[2] || path.join(ROOT, "data", "raw", "volunteers-sample.csv");

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const text = await readFile(input, "utf8");
const lines = text.trim().split(/\r?\n/).filter(Boolean);
const headers = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
const volunteers = [];
for (let i = 1; i < lines.length; i++) {
  const cols = splitCsvLine(lines[i]);
  const row = Object.fromEntries(headers.map((h, idx) => [h, cols[idx] ?? ""]));
  const name = row.name || row.full_name || row.volunteer;
  if (!name) continue;
  volunteers.push(normalizeVolunteer({
    id: row.id || row.volunteer_id || `vol_import_${i}`,
    name,
    email: row.email || null,
    phone: row.phone || row.mobile || null,
    smsConsent: /^(1|true|yes|y)$/i.test(row.sms_consent || row.sms || ""),
    roles: (row.roles || row.role || "general").split(/[|;]/).map(s => s.trim()).filter(Boolean),
    waiverSigned: /^(1|true|yes|y)$/i.test(row.waiver_signed || row.waiver || "true"),
    shirtSize: row.shirt_size || row.shirt || null,
    status: row.status || "confirmed",
    source: "import",
    createdAt: new Date().toISOString()
  }));
}

let existing = { shifts: [], hourLogs: [], zoneLabels: {} };
try {
  existing = JSON.parse(await readFile(OUT, "utf8"));
} catch { /* first import */ }

const payload = {
  _note: `Volunteer roster imported from ${path.relative(ROOT, input)}. Shifts/hours preserved if present.`,
  lastUpdated: new Date().toISOString(),
  eventId: "texas-sandfest-2026",
  source: "volunteerlocal_csv",
  zoneLabels: existing.zoneLabels || {},
  volunteers,
  shifts: existing.shifts || [],
  hourLogs: existing.hourLogs || []
};

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);
const summary = summarizeVolunteers(volunteers, payload.shifts, payload.hourLogs, {
  zoneLabels: payload.zoneLabels,
  source: payload.source
});
console.log(`Wrote ${volunteers.length} volunteers → ${path.relative(ROOT, OUT)}`);
console.log("Summary:", summary.totals);
