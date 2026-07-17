import twilio from "twilio";
import { normalizePhone } from "./consent.mjs";

const OFFICIAL_TWILIO_ORIGIN = "https://api.twilio.com";

function validUrl(value, { httpsOnly = false } = {}) {
  try {
    const parsed = new URL(value);
    return (!httpsOnly || parsed.protocol === "https:") && ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function providerMode(apiBaseUrl, production) {
  if (apiBaseUrl === OFFICIAL_TWILIO_ORIGIN) return "twilio";
  try {
    const hostname = new URL(apiBaseUrl).hostname;
    if (!production && ["127.0.0.1", "localhost", "::1"].includes(hostname)) return "sandbox";
  } catch {
    // URL validity is reported by the readiness contract below.
  }
  return "custom";
}

export function smsConfigFromEnv(env = process.env) {
  const enabled = env.SMS_ENABLED === "true";
  const production = env.NODE_ENV === "production" || env.SANDFEST_ENV === "production";
  const accountSid = String(env.TWILIO_ACCOUNT_SID || "");
  const authToken = String(env.TWILIO_AUTH_TOKEN || "");
  const fromNumber = normalizePhone(env.TWILIO_FROM_NUMBER) || "";
  const messagingServiceSid = String(env.TWILIO_MESSAGING_SERVICE_SID || "");
  const apiBaseUrl = String(env.TWILIO_API_BASE_URL || OFFICIAL_TWILIO_ORIGIN).replace(/\/+$/, "");
  const statusCallbackUrl = String(env.TWILIO_STATUS_CALLBACK_URL || "");
  const safetyInboundWebhookUrl = String(env.TWILIO_SAFETY_INBOUND_WEBHOOK_URL || "");
  const marketingInboundWebhookUrl = String(env.TWILIO_MARKETING_INBOUND_WEBHOOK_URL || "");
  const hasAuth = Boolean(accountSid && authToken);
  const hasSender = Boolean(messagingServiceSid || fromNumber);
  const callbacksValid = validUrl(statusCallbackUrl, { httpsOnly: production })
    && validUrl(safetyInboundWebhookUrl, { httpsOnly: production });
  const apiOriginValid = validUrl(apiBaseUrl, { httpsOnly: production })
    && (!production || apiBaseUrl === OFFICIAL_TWILIO_ORIGIN);
  const ready = enabled && hasAuth && hasSender && callbacksValid && apiOriginValid;
  const reason = !enabled
    ? "SMS_ENABLED is not true."
    : !hasAuth
      ? "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required."
      : !hasSender
        ? "Set TWILIO_MESSAGING_SERVICE_SID or a valid TWILIO_FROM_NUMBER."
        : !callbacksValid
          ? `TWILIO_STATUS_CALLBACK_URL and TWILIO_SAFETY_INBOUND_WEBHOOK_URL must be valid${production ? " HTTPS" : ""} URLs.`
          : !apiOriginValid
            ? production
              ? "Production SMS must use https://api.twilio.com."
              : "TWILIO_API_BASE_URL must be an HTTP or HTTPS URL."
            : "ready";
  const config = {
    enabled,
    production,
    accountSid,
    authTokenConfigured: Boolean(authToken),
    fromNumber: fromNumber || null,
    messagingServiceSid: messagingServiceSid || null,
    apiBaseUrl,
    providerMode: providerMode(apiBaseUrl, production),
    statusCallbackUrl: statusCallbackUrl || null,
    safetyInboundWebhookUrl: safetyInboundWebhookUrl || null,
    marketingInboundWebhookUrl: marketingInboundWebhookUrl || null,
    ready,
    reason
  };
  Object.defineProperty(config, "authToken", { value: authToken, enumerable: false });
  return config;
}

export function publicSmsReadiness(config = smsConfigFromEnv()) {
  return {
    enabled: config.enabled,
    ready: config.ready,
    reason: config.reason,
    authConfigured: Boolean(config.authTokenConfigured),
    senderConfigured: Boolean(config.messagingServiceSid || config.fromNumber),
    statusCallbackConfigured: Boolean(config.statusCallbackUrl),
    safetyInboundConfigured: Boolean(config.safetyInboundWebhookUrl),
    marketingInboundConfigured: Boolean(config.marketingInboundWebhookUrl),
    providerMode: config.providerMode
  };
}

export function smsStatusCallbackUrl(config, { campaignId, messageId } = {}) {
  if (!config?.statusCallbackUrl) return null;
  const url = new URL(config.statusCallbackUrl);
  if (campaignId) url.searchParams.set("campaign", String(campaignId));
  if (messageId) url.searchParams.set("message", String(messageId));
  return url.toString();
}

export function twilioValidationUrl(configuredUrl, requestUrl) {
  const configured = new URL(configuredUrl);
  const request = new URL(requestUrl, configured);
  configured.search = request.search;
  return configured.toString();
}

export function parseTwilioForm(rawBody) {
  return Object.fromEntries(new URLSearchParams(String(rawBody || "")));
}

export function verifyTwilioFormRequest({ signature, url, params }, opts = {}) {
  const config = opts.config || smsConfigFromEnv(opts.env || process.env);
  if (!config.authToken || !signature || !url) return false;
  try {
    return twilio.validateRequest(config.authToken, String(signature), String(url), params || {});
  } catch {
    return false;
  }
}

export async function sendSms(to, body, opts = {}) {
  const config = opts.config || smsConfigFromEnv(opts.env || process.env);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const text = String(body ?? "").trim().slice(0, 1600);
  const destination = normalizePhone(to);

  if (!destination) return { ok: false, status: "failed", error: "Missing or invalid destination phone number." };
  if (!text) return { ok: false, status: "failed", error: "SMS body is empty." };
  if (!config.ready) return { ok: false, skipped: true, status: "suppressed", error: config.reason };

  const params = new URLSearchParams();
  params.set("To", destination);
  params.set("Body", text);
  if (config.messagingServiceSid) params.set("MessagingServiceSid", config.messagingServiceSid);
  else params.set("From", config.fromNumber);
  if (opts.statusCallbackUrl || config.statusCallbackUrl) {
    params.set("StatusCallback", opts.statusCallbackUrl || config.statusCallbackUrl);
  }

  const url = `${config.apiBaseUrl}/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: params,
      signal: opts.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: "failed",
        error: data.message || data.error_message || `Twilio HTTP ${response.status}`,
        twilioCode: data.code ?? null,
        httpStatus: response.status
      };
    }
    return { ok: true, status: data.status || "queued", sid: data.sid || null, httpStatus: response.status };
  } catch (error) {
    return {
      ok: false,
      status: "delivery_unknown",
      unknownOutcome: true,
      error: error?.message || "Twilio request outcome is unknown."
    };
  }
}
