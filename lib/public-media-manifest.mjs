const ROOT_KEYS = new Set(["generatedAt", "source", "count", "categories", "assets"]);
const ASSET_KEYS = new Set(["id", "category", "role", "name", "alt", "sourcePage", "publicPath", "contentType", "bytes", "transform"]);
const TRANSFORM_KEYS = new Set(["width", "height"]);

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function httpsUrl(value) {
  try {
    const parsed = new URL(text(value, 2000));
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function publicPath(value) {
  const normalized = text(value, 1000);
  return normalized.startsWith("/assets/sandfest-media/") && !normalized.includes("..") ? normalized : null;
}

function publicTransform(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const width = Number(value.width);
  const height = Number(value.height);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? { width: Math.round(width), height: Math.round(height) }
    : null;
}

export function publicMediaManifest(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const assets = (Array.isArray(source.assets) ? source.assets : [])
    .map(asset => ({
      id: text(asset?.id, 180),
      category: text(asset?.category, 80),
      role: text(asset?.role, 80),
      name: text(asset?.name, 300),
      alt: text(asset?.alt, 500),
      sourcePage: httpsUrl(asset?.sourcePage),
      publicPath: publicPath(asset?.publicPath),
      contentType: text(asset?.contentType, 100),
      bytes: Math.max(0, Math.round(Number(asset?.bytes) || 0)),
      transform: publicTransform(asset?.transform)
    }))
    .filter(asset => asset.id && asset.publicPath);
  const categories = assets.reduce((summary, asset) => {
    summary[asset.category || "uncategorized"] = (summary[asset.category || "uncategorized"] || 0) + 1;
    return summary;
  }, {});
  return {
    generatedAt: text(source.generatedAt, 64) || null,
    source: httpsUrl(source.source),
    count: assets.length,
    categories,
    assets
  };
}

function unknownKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).filter(key => !allowed.has(key));
}

export function publicMediaManifestSafety(input = {}) {
  const errors = [];
  const rootUnknown = unknownKeys(input, ROOT_KEYS);
  if (rootUnknown.length) errors.push(`Unexpected public media manifest keys: ${rootUnknown.join(", ")}.`);
  for (const [index, asset] of (Array.isArray(input.assets) ? input.assets : []).entries()) {
    const assetUnknown = unknownKeys(asset, ASSET_KEYS);
    if (assetUnknown.length) errors.push(`Unexpected public media asset keys at ${index}: ${assetUnknown.join(", ")}.`);
    const transformUnknown = unknownKeys(asset?.transform, TRANSFORM_KEYS);
    if (transformUnknown.length) errors.push(`Unexpected public media transform keys at ${index}: ${transformUnknown.join(", ")}.`);
    if (!publicPath(asset?.publicPath)) errors.push(`Public media asset ${index} has an invalid public path.`);
  }
  const serialized = JSON.stringify(input);
  if (/\/(?:Users|home|private|var)\//.test(serialized) || /[A-Za-z]:\\/.test(serialized)) {
    errors.push("Public media manifest contains an absolute filesystem path.");
  }
  return { ready: errors.length === 0, errors };
}
