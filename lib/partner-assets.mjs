import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const TYPES = {
  "image/png": { extension: ".png", matches: buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  "image/jpeg": { extension: ".jpg", matches: buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  "image/webp": { extension: ".webp", matches: buffer => buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP" },
  "application/pdf": { extension: ".pdf", matches: buffer => buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-" }
};

function safePart(value, fallback) {
  const clean = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  return clean || fallback;
}

function safeFileName(value) {
  const clean = path.basename(String(value ?? "asset")).replace(/[\r\n"\\/]+/g, "-").trim().slice(0, 180);
  return clean || "asset";
}

export function partnerAssetStorageConfig(root, env = process.env) {
  const production = env.SANDFEST_ENV === "production";
  const configuredDirectory = String(env.SANDFEST_PARTNER_ASSET_DIR || "").trim();
  const directory = path.resolve(configuredDirectory || path.join(root, "data", "processed", "partner-assets"));
  const requestedMax = Number(env.SANDFEST_PARTNER_ASSET_MAX_BYTES || DEFAULT_MAX_BYTES);
  const maxBytes = Number.isFinite(requestedMax) && requestedMax >= 1024 ? Math.min(requestedMax, 25 * 1024 * 1024) : DEFAULT_MAX_BYTES;
  return {
    ready: !production || Boolean(configuredDirectory),
    production,
    directory,
    maxBytes,
    allowedTypes: Object.keys(TYPES),
    reason: production && !configuredDirectory ? "SANDFEST_PARTNER_ASSET_DIR must point to persistent private storage in production." : null
  };
}

export function validatePartnerAssetUpload(input, options = {}) {
  const buffer = Buffer.isBuffer(input?.buffer) ? input.buffer : Buffer.from(input?.buffer || []);
  const contentType = String(input?.contentType || "").split(";")[0].trim().toLowerCase();
  const rule = TYPES[contentType];
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES);
  if (!buffer.length) return { ok: false, error: "Choose a non-empty brand asset file." };
  if (buffer.length > maxBytes) return { ok: false, error: `Brand asset exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.` };
  if (!rule) return { ok: false, error: "Brand assets must be PNG, JPEG, WebP, or PDF files." };
  if (!rule.matches(buffer)) return { ok: false, error: "The uploaded file contents do not match its declared file type." };
  return {
    ok: true,
    buffer,
    contentType,
    extension: rule.extension,
    fileName: safeFileName(input.fileName),
    sizeBytes: buffer.length,
    checksumSha256: createHash("sha256").update(buffer).digest("hex")
  };
}

export async function savePartnerAssetUpload(root, input, options = {}) {
  const config = options.config ?? partnerAssetStorageConfig(root, options.env);
  if (!config.ready) return { ok: false, error: config.reason };
  const validated = validatePartnerAssetUpload(input, { maxBytes: config.maxBytes });
  if (!validated.ok) return validated;
  const applicationPart = safePart(input.applicationId, "application");
  const assetPart = safePart(input.assetId, "asset");
  const storageKey = `${applicationPart}/${assetPart}${validated.extension}`;
  const filePath = path.resolve(config.directory, storageKey);
  if (!filePath.startsWith(`${config.directory}${path.sep}`)) return { ok: false, error: "Invalid asset storage path." };
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, validated.buffer, { flag: "wx", mode: 0o600 });
  return {
    ok: true,
    storageKey,
    fileName: validated.fileName,
    contentType: validated.contentType,
    sizeBytes: validated.sizeBytes,
    checksumSha256: validated.checksumSha256
  };
}

export async function readPartnerAssetUpload(root, storageKey, options = {}) {
  const config = options.config ?? partnerAssetStorageConfig(root, options.env);
  if (!config.ready) return { ok: false, error: config.reason };
  const key = String(storageKey || "");
  if (!/^[a-z0-9_-]+\/[a-z0-9_-]+\.(png|jpg|webp|pdf)$/.test(key)) return { ok: false, error: "Invalid brand asset storage key." };
  const filePath = path.resolve(config.directory, key);
  if (!filePath.startsWith(`${config.directory}${path.sep}`)) return { ok: false, error: "Invalid brand asset storage path." };
  try {
    return { ok: true, buffer: await readFile(filePath) };
  } catch (error) {
    return { ok: false, error: error?.code === "ENOENT" ? "Brand asset file not found." : "Brand asset file could not be read." };
  }
}

export async function deletePartnerAssetUpload(root, storageKey, options = {}) {
  const config = options.config ?? partnerAssetStorageConfig(root, options.env);
  const key = String(storageKey || "");
  if (!/^[a-z0-9_-]+\/[a-z0-9_-]+\.(png|jpg|webp|pdf)$/.test(key)) return false;
  const filePath = path.resolve(config.directory, key);
  if (!filePath.startsWith(`${config.directory}${path.sep}`)) return false;
  await rm(filePath, { force: true });
  return true;
}

export function partnerAssetDownloadName(asset) {
  return safeFileName(asset?.fileName || `${asset?.kind || "brand-asset"}${TYPES[asset?.contentType]?.extension || ""}`);
}
