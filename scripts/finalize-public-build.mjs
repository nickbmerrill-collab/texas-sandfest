import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sandfestAppleAppSiteAssociation } from "../lib/public-deep-links.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.resolve(root, process.env.SANDFEST_BUILD_OUT_DIR || "dist-public");
const assetsDir = path.join(outDir, "assets");
const entryPath = path.join(outDir, "index.html");
const workerPath = path.join(outDir, "sw.js");
const mediaManifestPath = path.join(outDir, "assets", "sandfest-media", "media-derivatives.json");
const buildAssetPattern = /\.(?:css|js|woff2?)$/i;
const originalMediaDirectories = ["logos", "maps", "photos", "social", "sponsor-logos"];

const [entryHtml, workerTemplate, assetEntries, mediaManifestText] = await Promise.all([
  readFile(entryPath, "utf8"),
  readFile(workerPath, "utf8"),
  readdir(assetsDir, { withFileTypes: true }),
  readFile(mediaManifestPath, "utf8")
]);
const mediaManifest = JSON.parse(mediaManifestText);

const buildAssets = assetEntries
  .filter(entry => entry.isFile() && buildAssetPattern.test(entry.name))
  .map(entry => `assets/${entry.name}`)
  .sort();
const mediaAssets = [...new Set(
  (mediaManifest.derivatives ?? []).flatMap(derivative =>
    (derivative.sources ?? []).map(source => String(source.publicPath || "").replace(/^\/+/, ""))
  )
)].filter(Boolean).sort();

if (!buildAssets.some(file => file.endsWith(".js")) || !buildAssets.some(file => file.endsWith(".css"))) {
  throw new Error("Public build finalization requires generated JavaScript and CSS assets.");
}
if (!mediaAssets.length || !mediaAssets.every(file => file.startsWith("assets/sandfest-media/optimized/") && file.endsWith(".webp"))) {
  throw new Error("Public build finalization requires the optimized media manifest.");
}
if (!workerTemplate.includes("__BUILD_ID__") || !workerTemplate.includes("/* __BUILD_ASSETS__ */ []") || !workerTemplate.includes("/* __MEDIA_ASSETS__ */ []")) {
  throw new Error("Public service worker is missing its build finalization placeholders.");
}

const buildId = createHash("sha256")
  .update(entryHtml)
  .update("\n")
  .update(JSON.stringify(buildAssets))
  .update("\n")
  .update(JSON.stringify(mediaAssets))
  .digest("hex")
  .slice(0, 12);
const assetManifest = JSON.stringify(buildAssets, null, 2);
const mediaAssetManifest = JSON.stringify(mediaAssets, null, 2);
const worker = workerTemplate
  .replace("__BUILD_ID__", buildId)
  .replace("/* __BUILD_ASSETS__ */ []", assetManifest)
  .replace("/* __MEDIA_ASSETS__ */ []", mediaAssetManifest);
const appleApplicationIdentifierPrefix = String(process.env.SANDFEST_APPLE_APP_ID_PREFIX || "").trim();

await writeFile(workerPath, worker);
await writeFile(path.join(outDir, "404.html"), entryHtml);
if (appleApplicationIdentifierPrefix) {
  const associationDirectory = path.join(outDir, ".well-known");
  await mkdir(associationDirectory, { recursive: true });
  await writeFile(
    path.join(associationDirectory, "apple-app-site-association"),
    `${JSON.stringify(sandfestAppleAppSiteAssociation(appleApplicationIdentifierPrefix), null, 2)}\n`
  );
}
await Promise.all(originalMediaDirectories.map(directory =>
  rm(path.join(outDir, "assets", "sandfest-media", directory), { recursive: true, force: true })
));
console.log(`Finalized public offline shell ${buildId} with ${buildAssets.length} compiled assets, ${mediaAssets.length} optimized media files, and ${appleApplicationIdentifierPrefix ? "a production AASA contract" : "no unsigned AASA artifact"}.`);
