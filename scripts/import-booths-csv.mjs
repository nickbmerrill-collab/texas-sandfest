#!/usr/bin/env node
// Import Eventeny-style booth CSV into data/processed/booth-map.json.
// Usage: node scripts/import-booths-csv.mjs [path/to/export.csv]
// CSV headers (flexible): booth_id, business_name, category, zone, size,
// utilities, booth_status, status, beach_marker, map_x, map_y, lat, lng,
// booth_fee_cents, eventeny_id, description, coi_status, health_status, public

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBoothCsv, summarizeBooths } from "../lib/booths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "processed", "booth-map.json");
const input = process.argv[2] || path.join(ROOT, "data", "raw", "eventeny-booths-sample.csv");

const text = await readFile(input, "utf8");
const { booths, vendors } = parseBoothCsv(text);
const summary = summarizeBooths(booths, vendors);

const payload = {
  _note: `Imported from ${path.relative(ROOT, input)} via scripts/import-booths-csv.mjs`,
  lastUpdated: new Date().toISOString(),
  eventId: "texas-sandfest-2026",
  source: "eventeny_csv",
  booths,
  vendors
};

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${booths.length} booths / ${vendors.length} vendors → ${path.relative(ROOT, OUT)}`);
console.log("Summary:", summary.totals);
