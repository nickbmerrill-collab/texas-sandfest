import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imagesPath = path.join(ROOT, "data", "processed", "images.json");
const outputRoot = path.join(ROOT, "public", "assets", "sandfest-media");
const processedManifestPath = path.join(ROOT, "data", "processed", "media-assets.json");
const publicManifestPath = path.join(outputRoot, "media-manifest.json");

const images = JSON.parse(await readFile(imagesPath, "utf8"));
const uniqueMedia = uniqueBy(images.map(normalizeImage).filter(Boolean), (image) => image.mediaId);
const downloaded = [];
const failures = [];

await mkdir(outputRoot, { recursive: true });

for (const image of uniqueMedia) {
  try {
    const response = await fetchWithFallback(image);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      throw new Error(`Unexpected content type: ${contentType || "unknown"}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const ext = extensionFor(contentType, image.mediaId);
    const category = classify(image);
    const fileName = `${image.slug}.${ext}`;
    const relativeFile = path.join(category, fileName);
    const absoluteFile = path.join(outputRoot, relativeFile);

    await mkdir(path.dirname(absoluteFile), { recursive: true });
    await writeFile(absoluteFile, bytes);

    downloaded.push({
      id: image.mediaId.replace(/[^\w-]+/g, "-"),
      category,
      role: roleFor(image, category),
      name: image.name,
      alt: image.alt,
      sourcePage: image.source,
      originalUrl: image.originalUrl,
      transformedUrl: image.src,
      publicPath: `/assets/sandfest-media/${relativeFile.replaceAll(path.sep, "/")}`,
      file: absoluteFile,
      contentType,
      bytes: bytes.length,
      transform: image.transform
    });
    console.log(`downloaded ${category}/${fileName}`);
  } catch (error) {
    failures.push({
      src: image.src,
      sourcePage: image.source,
      error: error.message
    });
    console.warn(`failed ${image.src}: ${error.message}`);
  }
}

const manifest = {
  generatedAt: new Date().toISOString(),
  source: "https://www.texassandfest.org/",
  count: downloaded.length,
  failedCount: failures.length,
  categories: downloaded.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {}),
  assets: downloaded,
  failures
};

await writeFile(processedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(publicManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`\nMedia manifest written: ${processedManifestPath}`);
console.log(`Frontend media manifest written: ${publicManifestPath}`);
console.log(`Downloaded ${downloaded.length} assets, ${failures.length} failures.`);

function normalizeImage(image) {
  const mediaMatch = image.src.match(/https:\/\/static\.wixstatic\.com\/media\/([^/?#]+)/);
  if (!mediaMatch) return null;

  const mediaId = decodeURIComponent(mediaMatch[1]);
  const name = decodeURIComponent(image.src.split("/").pop() || mediaId).replace(/\?.*$/, "");
  const dimensions = image.src.match(/\/w_(\d+),h_(\d+)/);
  return {
    ...image,
    mediaId,
    name,
    originalUrl: `https://static.wixstatic.com/media/${encodeURI(mediaId)}`,
    transform: dimensions ? { width: Number(dimensions[1]), height: Number(dimensions[2]) } : null,
    slug: slugify(`${mediaId}-${name}`)
  };
}

async function fetchWithFallback(image) {
  const original = await fetchImage(image.originalUrl);
  if (original.ok && (original.headers.get("content-type") || "").startsWith("image/")) {
    return original;
  }
  return fetchImage(image.src);
}

function fetchImage(url) {
  return fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 Texas SandFest frontend asset crawler",
      "accept": "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
    }
  });
}

function extensionFor(contentType, mediaId) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("avif")) return "avif";
  const ext = mediaId.split(".").pop()?.toLowerCase();
  return ext && ext.length <= 5 ? ext : "img";
}

function classify(image) {
  const haystack = `${image.name} ${image.alt} ${image.source}`.toLowerCase();
  if (/txsf|official logo|sandfest logo/.test(haystack)) return "logos";
  if (/instagram|facebook|social|11062b_9b5a3b3607694630a7253c5fc4ff6476|e316f544f9094143b9eac01f1f19e697/.test(haystack)) return "social";
  if (/map|street_map|parking/.test(haystack)) return "maps";
  if (/sponsor|sponsorship|logo|heb|tjh|lottery|condo|vacation|builders|helpers|lowes|courtyard|grosse|sandpiper|brons|performance|gignac|hayden|stewart|zapp|bernie|upstream|beachgate|cityofporta|fineline|seagull|silver sands|apg|truck/.test(haystack)) {
    return "sponsor-logos";
  }
  if (/\.(png)$/i.test(image.mediaId) && image.transform && image.transform.width <= 700 && image.transform.height <= 500) {
    return "sponsor-logos";
  }
  if (/dsc|dji|fist|sand|beach|sculpt|jpg|jpeg|photo|mv2\.jpg|mv2\.jpeg/.test(haystack)) return "photos";
  return "misc";
}

function roleFor(image, category) {
  const haystack = `${image.name} ${image.alt}`.toLowerCase();
  if (category === "logos" && /txsf|official/.test(haystack)) return "official_brand";
  if (category === "photos" && /53497f8c|hero|dsc08700/.test(haystack)) return "hero";
  if (category === "sponsor-logos") return "sponsor";
  if (category === "social") return "social_icon";
  return "content";
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/%20/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}
