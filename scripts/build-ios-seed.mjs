import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(ROOT, "data", "processed", "app-bootstrap.json");
const targetPath = path.join(ROOT, "ios", "TexasSandFest", "Resources", "sandfest-seed.json");

const requiredKeys = [
  "guide",
  "guidance",
  "alert",
  "schedule",
  "zones",
  "ticketOptions",
  "sponsors",
  "vendors",
  "coverage",
  "financeSignals"
];

function validatePayload(payload) {
  const missing = requiredKeys.filter((key) => !(key in payload));
  if (missing.length > 0) {
    throw new Error(`App bootstrap is missing keys: ${missing.join(", ")}`);
  }

  for (const key of requiredKeys.filter((key) => !["guide", "alert"].includes(key))) {
    if (!Array.isArray(payload[key])) {
      throw new Error(`App bootstrap key "${key}" must be an array.`);
    }
  }

  if (!payload.guide?.id || !payload.guide?.name || !payload.guide?.dateRange) {
    throw new Error("App bootstrap guide must include id, name, and dateRange.");
  }

  if (!payload.alert?.id || typeof payload.alert.active !== "boolean" || !payload.alert.severity) {
    throw new Error("App bootstrap alert must include id, active, and severity.");
  }
}

const raw = await readFile(sourcePath, "utf8");
const payload = JSON.parse(raw);
validatePayload(payload);

await mkdir(path.dirname(targetPath), { recursive: true });
await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`);

console.log(`iOS seed updated: ${targetPath}`);
