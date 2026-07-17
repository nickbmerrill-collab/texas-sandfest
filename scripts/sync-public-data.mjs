import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicTicketCatalog } from "../lib/ticket-catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicData = path.join(ROOT, "public", "data");

await mkdir(publicData, { recursive: true });

const files = [
  ["data/processed/crawl-summary.json", "crawl-summary.json"],
  ["data/processed/media-assets.json", "media-assets.json"],
  ["data/processed/app-bootstrap.json", "app-bootstrap.json"],
  ["data/processed/incoming-inventory.json", "incoming-inventory.json"],
  ["public/data/sculptors.json", "sculptors.json"]
];

for (const [source, destination] of files) {
  await copyFile(path.join(ROOT, source), path.join(publicData, destination));
}

const ticketCatalog = JSON.parse(await readFile(path.join(ROOT, "data", "processed", "ticket-products.json"), "utf8"));
await writeFile(
  path.join(publicData, "ticket-products.json"),
  `${JSON.stringify(publicTicketCatalog(ticketCatalog), null, 2)}\n`
);

console.log(`Public data synced: ${publicData}`);
