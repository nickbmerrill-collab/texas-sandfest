import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicData = path.join(ROOT, "public", "data");

await mkdir(publicData, { recursive: true });

const files = [
  ["data/processed/crawl-summary.json", "crawl-summary.json"],
  ["data/processed/media-assets.json", "media-assets.json"],
  ["data/processed/app-bootstrap.json", "app-bootstrap.json"],
  ["data/processed/incoming-inventory.json", "incoming-inventory.json"],
  ["data/processed/ticket-products.json", "ticket-products.json"]
];

for (const [source, destination] of files) {
  await copyFile(path.join(ROOT, source), path.join(publicData, destination));
}

console.log(`Public data synced: ${publicData}`);
