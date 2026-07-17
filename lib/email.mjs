import { brevoWebhookConfig, publicBrevoWebhookReadiness } from "./brevo-webhook.mjs";

function clean(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value, 254).toLowerCase());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeWebUrl(value) {
  try {
    const url = new URL(clean(value, 2000));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

function providerEndpoint(env, production, missing) {
  const override = clean(env.BREVO_API_ENDPOINT, 2000);
  if (!override) return BREVO_ENDPOINT;
  try {
    const url = new URL(override);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("unsafe endpoint");
    if (production && url.toString() !== BREVO_ENDPOINT) {
      missing.push("BREVO_API_ENDPOINT(official production endpoint required)");
      return BREVO_ENDPOINT;
    }
    return url.toString();
  } catch {
    missing.push("BREVO_API_ENDPOINT(valid http/https URL)");
    return BREVO_ENDPOINT;
  }
}

export function emailConfigFromEnv(env = process.env) {
  const enabled = env.TRANSACTIONAL_EMAIL_ENABLED === "true";
  const production = env.SANDFEST_ENV === "production" || env.NODE_ENV === "production";
  const apiKey = clean(env.BREVO_API_KEY, 500);
  const senderEmail = clean(env.BREVO_SENDER_EMAIL, 254).toLowerCase();
  const senderName = clean(env.BREVO_SENDER_NAME, 120) || "Texas SandFest";
  const replyToEmail = clean(env.BREVO_REPLY_TO_EMAIL, 254).toLowerCase();
  const missing = [];
  if (!apiKey) missing.push("BREVO_API_KEY");
  if (!validEmail(senderEmail)) missing.push("BREVO_SENDER_EMAIL");
  if (replyToEmail && !validEmail(replyToEmail)) missing.push("BREVO_REPLY_TO_EMAIL(valid)");
  const endpoint = providerEndpoint(env, production, missing);
  return {
    provider: "brevo",
    enabled,
    ready: enabled && missing.length === 0,
    reason: !enabled ? "TRANSACTIONAL_EMAIL_ENABLED=false" : missing.length ? `Missing ${missing.join(", ")}` : null,
    apiKey,
    senderEmail,
    senderName,
    replyToEmail: replyToEmail || null,
    endpoint
  };
}

export function publicEmailReadiness(config = emailConfigFromEnv(), webhookConfig = brevoWebhookConfig()) {
  return {
    provider: config.provider,
    enabled: config.enabled,
    ready: config.ready,
    senderConfigured: validEmail(config.senderEmail),
    replyToConfigured: Boolean(config.replyToEmail),
    reason: config.reason,
    deliveryTracking: publicBrevoWebhookReadiness(webhookConfig)
  };
}

export async function sendTransactionalEmail(message, options = {}) {
  const config = options.config ?? emailConfigFromEnv();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1000, Math.min(30_000, Number(options.timeoutMs || 15_000)));
  if (!config.ready) {
    return { sent: false, skipped: true, provider: config.provider, reason: config.reason };
  }
  const toEmail = clean(message?.toEmail, 254).toLowerCase();
  const subject = clean(message?.subject, 998);
  const textContent = clean(message?.textContent, 100_000);
  const idempotencyKey = clean(message?.idempotencyKey, 100);
  if (!validEmail(toEmail)) return { sent: false, skipped: true, provider: config.provider, reason: "invalid_recipient" };
  if (!subject) return { sent: false, skipped: true, provider: config.provider, reason: "missing_subject" };
  if (!textContent) return { sent: false, skipped: true, provider: config.provider, reason: "missing_body" };
  if (idempotencyKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return { sent: false, skipped: true, provider: config.provider, reason: "invalid_idempotency_key" };
  }

  const payload = {
    sender: { email: config.senderEmail, name: config.senderName },
    to: [{ email: toEmail, ...(clean(message?.toName, 120) ? { name: clean(message.toName, 120) } : {}) }],
    subject,
    textContent,
    htmlContent: `<div style="font-family:Arial,sans-serif;line-height:1.6;white-space:pre-wrap">${escapeHtml(textContent)}</div>`,
    tags: (Array.isArray(message?.tags) ? message.tags : ["sandfest-partner"])
      .map(tag => clean(tag, 50).replace(/[^a-z0-9_-]+/gi, "-"))
      .filter(Boolean)
      .slice(0, 10)
  };
  const listUnsubscribeUrl = safeWebUrl(message?.listUnsubscribeUrl);
  if (listUnsubscribeUrl || idempotencyKey) payload.headers = {
    ...(listUnsubscribeUrl ? { "List-Unsubscribe": `<${listUnsubscribeUrl}>` } : {}),
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
  };
  if (config.replyToEmail) payload.replyTo = { email: config.replyToEmail, name: config.senderName };
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "api-key": config.apiKey },
    body: JSON.stringify(payload),
    signal: options.signal ?? AbortSignal.timeout(timeoutMs)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerCode = clean(data.code, 200);
    return {
      sent: false,
      skipped: false,
      provider: config.provider,
      status: response.status,
      providerCode: providerCode || null,
      duplicate: providerCode === "duplicate_parameter",
      error: clean(data.message || data.code || `Brevo HTTP ${response.status}`, 1000)
    };
  }
  return {
    sent: true,
    skipped: false,
    provider: config.provider,
    providerMessageId: clean(data.messageId || data.messageIds?.[0], 500) || null
  };
}
