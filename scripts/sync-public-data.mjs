import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicAppBootstrap } from "../lib/public-bootstrap.mjs";
import { publicMediaManifest } from "../lib/public-media-manifest.mjs";
import { publicTicketCatalog } from "../lib/ticket-catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicData = path.join(ROOT, "public", "data");
const publicMedia = path.join(ROOT, "public", "assets", "sandfest-media");

await Promise.all([mkdir(publicData, { recursive: true }), mkdir(publicMedia, { recursive: true })]);

await Promise.all(["crawl-summary.json", "incoming-inventory.json", "media-assets.json"].map(file =>
  rm(path.join(publicData, file), { force: true })
));

const appBootstrap = JSON.parse(await readFile(path.join(ROOT, "data", "processed", "app-bootstrap.json"), "utf8"));
await writeFile(
  path.join(publicData, "app-bootstrap.json"),
  `${JSON.stringify(publicAppBootstrap(appBootstrap), null, 2)}\n`
);

const mediaManifest = JSON.parse(await readFile(path.join(ROOT, "data", "processed", "media-assets.json"), "utf8"));
await writeFile(
  path.join(publicMedia, "media-manifest.json"),
  `${JSON.stringify(publicMediaManifest(mediaManifest), null, 2)}\n`
);

const ticketCatalog = JSON.parse(await readFile(path.join(ROOT, "data", "processed", "ticket-products.json"), "utf8"));
await writeFile(
  path.join(publicData, "ticket-products.json"),
  `${JSON.stringify(publicTicketCatalog(ticketCatalog), null, 2)}\n`
);

console.log(`Public data synced: ${publicData}`);
