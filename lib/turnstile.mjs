import { createHash } from "node:crypto";

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function text(value, max = 4096) {
  return String(value ?? "").trim().slice(0, max);
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function boundedTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) ? Math.min(15_000, Math.max(1_000, timeout)) : 8_000;
}

export function turnstileConfig(env = process.env) {
  const production = env.SANDFEST_ENV === "production" || env.NODE_ENV === "production";
  const explicitlyEnabled = String(env.SANDFEST_TURNSTILE_ENABLED || "").toLowerCase() === "true";
  const enabled = production || explicitlyEnabled;
  const secretKey = text(env.SANDFEST_TURNSTILE_SECRET_KEY, 256);
  const configuredHostnames = text(env.SANDFEST_TURNSTILE_HOSTNAMES, 2048)
    || text(env.SANDFEST_TURNSTILE_HOSTNAME, 253)
    || hostnameFromUrl(env.SANDFEST_PUBLIC_SITE_URL);
  const expectedHostnames = [...new Set(configuredHostnames.split(",").map(value => text(value, 253).toLowerCase()).filter(Boolean))];
  const expectedHostname = expectedHostnames[0] || "";
  const configuredEndpoint = text(env.SANDFEST_TURNSTILE_SITEVERIFY_URL, 500);
  const siteverifyUrl = configuredEndpoint || TURNSTILE_SITEVERIFY_URL;
  const officialEndpoint = siteverifyUrl === TURNSTILE_SITEVERIFY_URL;
  const missing = [];

  if (enabled && secretKey.length < 20) missing.push("SANDFEST_TURNSTILE_SECRET_KEY");
  if (enabled && production && !expectedHostnames.length) missing.push("SANDFEST_TURNSTILE_HOSTNAMES(or SANDFEST_PUBLIC_SITE_URL)");
  if (enabled && production && !officialEndpoint) missing.push("SANDFEST_TURNSTILE_SITEVERIFY_URL(official endpoint required)");

  return {
    enabled,
    production,
    ready: !enabled || missing.length === 0,
    secretKey,
    expectedHostname,
    expectedHostnames,
    siteverifyUrl,
    timeoutMs: boundedTimeout(env.SANDFEST_TURNSTILE_TIMEOUT_MS),
    missing,
    reason: !enabled
      ? "Turnstile is optional outside production."
      : missing.length
        ? `Turnstile verification is not ready: ${missing.join(", ")}.`
        : "Turnstile server verification is ready."
  };
}

function verificationIdempotencyKey(token, requestKey) {
  const bytes = Buffer.from(createHash("sha256").update(`${requestKey}:${token}`).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function verifyTurnstileToken(input = {}, options = {}) {
  const config = options.config ?? turnstileConfig(options.env);
  if (!config.enabled) return { ok: true, skipped: true };
  if (!config.ready) {
    return { ok: false, unavailable: true, error: "Application verification is temporarily unavailable." };
  }

  const token = text(input.token, 2049);
  if (!token || token.length > 2048) {
    return { ok: false, error: "Complete the security check and try again.", errorCodes: ["missing-input-response"] };
  }

  const expectedAction = text(input.action, 32);
  const requestKey = text(input.idempotencyKey, 200) || "sandfest-partner-intake";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let response;
  let payload;

  try {
    response = await (options.fetchImpl ?? fetch)(config.siteverifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: config.secretKey,
        response: token,
        ...(text(input.remoteIp, 128) ? { remoteip: text(input.remoteIp, 128) } : {}),
        idempotency_key: verificationIdempotencyKey(token, requestKey)
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Siteverify returned ${response.status}.`);
    payload = await response.json();
  } catch {
    return { ok: false, unavailable: true, error: "Application verification is temporarily unavailable." };
  } finally {
    clearTimeout(timeout);
  }

  const errorCodes = Array.isArray(payload?.["error-codes"])
    ? payload["error-codes"].map(value => text(value, 80)).filter(Boolean)
    : [];
  if (payload?.success !== true) {
    return { ok: false, error: "Security verification expired or failed. Please try again.", errorCodes };
  }
  const hostname = text(payload.hostname, 253).toLowerCase();
  const expectedHostnames = Array.isArray(config.expectedHostnames) && config.expectedHostnames.length
    ? config.expectedHostnames
    : config.expectedHostname ? [config.expectedHostname] : [];
  if (expectedHostnames.length && !expectedHostnames.includes(hostname)) {
    return { ok: false, error: "Security verification could not be confirmed.", errorCodes: ["hostname-mismatch"] };
  }
  if (expectedAction && text(payload.action, 32) !== expectedAction) {
    return { ok: false, error: "Security verification could not be confirmed.", errorCodes: ["action-mismatch"] };
  }

  return {
    ok: true,
    hostname: hostname || null,
    action: text(payload.action, 32) || null,
    challengeTs: text(payload.challenge_ts, 64) || null
  };
}
