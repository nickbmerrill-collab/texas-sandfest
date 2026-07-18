import { createHash, timingSafeEqual } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

function safeEqual(left, right) {
  const leftDigest = createHash("sha256").update(String(left || "")).digest();
  const rightDigest = createHash("sha256").update(String(right || "")).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

export function documentExtractionSourceConfig(env = process.env) {
  const production = env.SANDFEST_ENV === "production";
  const secret = String(env.SANDFEST_DOCUMENT_EXTRACTION_SECRET || "").trim();
  const sourceUrl = String(env.SANDFEST_DOCUMENT_EXTRACTION_SOURCE_URL || "").trim().replace(/\/+$/, "");
  let sourceUrlValid = false;
  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      sourceUrlValid = parsed.protocol === "https:" || (!production && parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname));
    } catch {
      sourceUrlValid = false;
    }
  }
  return {
    production,
    secret,
    secretReady: secret.length >= 32,
    sourceUrl,
    sourceUrlValid,
    remoteReady: secret.length >= 32 && sourceUrlValid,
    timeoutMs: boundedInteger(env.SANDFEST_DOCUMENT_EXTRACTION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 120_000),
    maxBytes: boundedInteger(env.SANDFEST_INCOMING_DOCUMENT_MAX_BYTES, DEFAULT_MAX_BYTES, 1_024, 25 * 1024 * 1024)
  };
}

export function verifyDocumentExtractionSourceAuthorization(headers, options = {}) {
  const config = options.config || documentExtractionSourceConfig(options.env);
  const authorization = String(headers?.authorization || headers?.Authorization || "");
  if (!config.secretReady || !authorization.startsWith("Bearer ")) return false;
  return safeEqual(authorization.slice(7), config.secret);
}

export async function fetchDocumentExtractionSource(record, options = {}) {
  const config = options.config || documentExtractionSourceConfig(options.env);
  if (!config.remoteReady) return { ok: false, unavailable: true, error: "Remote document extraction source is not configured." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const url = new URL(`${config.sourceUrl}/api/internal/documents/${encodeURIComponent(record?.id || "")}/extraction-source`);
  url.searchParams.set("eventId", String(record?.eventId || ""));
  url.searchParams.set("checksum", String(record?.checksumSha256 || ""));
  url.searchParams.set("version", String(record?.extractionVersion || ""));
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${config.secret}`, accept: "application/octet-stream" },
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { ok: false, status: response.status, error: body.error || `Document extraction source returned ${response.status}.` };
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > config.maxBytes) return { ok: false, error: "Document extraction source exceeds the configured size limit." };
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > config.maxBytes) return { ok: false, error: "Document extraction source exceeds the configured size limit." };
    return { ok: true, buffer, source: "authenticated_api" };
  } catch (error) {
    return {
      ok: false,
      timedOut: error?.name === "AbortError",
      error: error?.name === "AbortError" ? "Document extraction source request timed out." : "Document extraction source request failed."
    };
  } finally {
    clearTimeout(timer);
  }
}
