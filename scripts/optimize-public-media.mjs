import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const publicDir = path.join(root, "public");
const mediaDir = path.join(publicDir, "assets", "sandfest-media");
const outputDir = path.join(mediaDir, "optimized");
const manifestPath = path.join(mediaDir, "media-manifest.json");
const outputManifestPath = path.join(mediaDir, "media-derivatives.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
const photos = assets.filter(asset => asset.category === "photos" && asset.role !== "hero");

const selections = [
  { asset: assets.find(asset => asset.role === "hero"), kind: "hero", widths: [800, 1440, 2400], quality: 78, fallbackWidth: 1440 },
  { asset: assets.find(asset => asset.role === "official_brand"), kind: "brand", widths: [120, 240], height: 120, quality: 84 },
  ...photos.slice(0, 8).map(asset => ({ asset, kind: "gallery", widths: [360, 720], quality: 76 })),
  ...photos.slice(8, 14).map(asset => ({ asset, kind: "field", widths: [360, 720], quality: 76 })),
  ...assets.filter(asset => asset.category === "maps").slice(0, 4)
    .map(asset => ({ asset, kind: "map", widths: [360, 720], quality: 78 })),
  ...assets.filter(asset => asset.category === "sponsor-logos").slice(0, 18)
    .map(asset => ({ asset, kind: "sponsor", widths: [180, 360], height: 180, quality: 84 }))
].filter(selection => selection.asset?.publicPath);

function sourceFile(publicPath) {
  return path.join(publicDir, String(publicPath).replace(/^\/+/, ""));
}

function publicPathFor(file) {
  return `/${path.relative(publicDir, file).split(path.sep).join("/")}`;
}

function stableId(publicPath) {
  return createHash("sha256").update(publicPath).digest("hex").slice(0, 12);
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const derivatives = [];
for (const selection of selections) {
  const sourcePath = selection.asset.publicPath;
  const id = stableId(sourcePath);
  const sources = [];

  for (const requestedWidth of selection.widths) {
    const outputName = selection.kind === "hero"
      ? `hero-${requestedWidth}.webp`
      : `${selection.kind}-${id}-${requestedWidth}.webp`;
    const outputFile = path.join(outputDir, outputName);
    const resize = selection.height
      ? { width: requestedWidth, height: selection.height, fit: "inside", withoutEnlargement: true }
      : { width: requestedWidth, withoutEnlargement: true };
    const result = await sharp(sourceFile(sourcePath))
      .rotate()
      .resize(resize)
      .webp({ quality: selection.quality, alphaQuality: 90, effort: 5 })
      .toFile(outputFile);
    sources.push({
      publicPath: publicPathFor(outputFile),
      width: result.width,
      height: result.height,
      bytes: result.size
    });
  }

  const uniqueSources = [...new Map(sources.map(source => [source.width, source])).values()]
    .sort((left, right) => left.width - right.width);
  const retainedPaths = new Set(uniqueSources.map(source => source.publicPath));
  await Promise.all(sources
    .filter(source => !retainedPaths.has(source.publicPath))
    .map(source => rm(sourceFile(source.publicPath), { force: true })));
  const fallback = uniqueSources.find(source => source.width === selection.fallbackWidth)
    ?? uniqueSources.at(-1);
  derivatives.push({
    sourcePath,
    kind: selection.kind,
    defaultPath: fallback.publicPath,
    width: fallback.width,
    height: fallback.height,
    sources: uniqueSources
  });
}

await writeFile(outputManifestPath, `${JSON.stringify({ version: 1, derivatives }, null, 2)}\n`);

const sourceBytes = selections.reduce((sum, selection) => sum + Number(selection.asset.bytes || 0), 0);
const optimizedBytes = derivatives.reduce(
  (sum, derivative) => sum + derivative.sources.reduce((sourceSum, source) => sourceSum + source.bytes, 0),
  0
);
console.log(`Generated ${derivatives.length} optimized media records (${(sourceBytes / 1024 / 1024).toFixed(1)} MB source -> ${(optimizedBytes / 1024 / 1024).toFixed(1)} MB derivatives).`);
