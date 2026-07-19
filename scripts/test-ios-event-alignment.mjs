import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

const canonical = JSON.parse(await read("data/processed/app-bootstrap.json"));
const iosSeed = JSON.parse(await read("ios/TexasSandFest/Resources/sandfest-seed.json"));

assert.deepEqual(
  iosSeed,
  canonical,
  "The bundled iOS seed must exactly match data/processed/app-bootstrap.json. Run npm run ios:seed."
);

assert.match(canonical.guide.startDate, /^\d{4}-\d{2}-\d{2}$/);
assert.match(canonical.guide.endDate, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(canonical.guide.timeZone, "The canonical guide must publish an event time zone.");

const timeline = await read("ios/TexasSandFest/LiveTimeline.swift");
const schedule = await read("ios/TexasSandFest/ScheduleView.swift");
const tickets = await read("ios/TexasSandFest/TicketsView.swift");
const ticketStore = await read("ios/TexasSandFest/UserTicketsStore.swift");
const models = await read("ios/TexasSandFest/Models.swift");
const dateSensitiveSource = [timeline, schedule, tickets, ticketStore, models].join("\n");

for (const retiredLiteral of [
  "texas-sandfest-2026",
  "April 17-19, 2026",
  "Apr 17-19",
  "Apr 17–19",
  "TEXAS SANDFEST 2026",
  "comps.year = 2026",
  "fest.year = 2026"
]) {
  assert.equal(
    dateSensitiveSource.includes(retiredLiteral),
    false,
    `iOS event logic still contains retired literal: ${retiredLiteral}`
  );
}

assert.match(timeline, /localDate\(guide\.startDate/);
assert.match(timeline, /localDate\(guide\.endDate/);
assert.match(schedule, /LiveTimeline\.date\(for: item, guide: dataStore\.payload\.guide\)/);

console.log(`iOS event alignment: ${canonical.guide.id} · ${canonical.guide.dateRange}`);
