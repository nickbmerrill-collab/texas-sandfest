import { createHmac, timingSafeEqual } from "node:crypto";

const DEV_SECRET = "sandfest-local-outreach-preferences-secret";

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function safeBaseUrl(value, production) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (production && url.protocol !== "https:") return "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function outreachPreferencesConfig(env = process.env) {
  const production = env.SANDFEST_ENV === "production";
  const configuredSecret = clean(
    env.SANDFEST_OUTREACH_PREFERENCES_SECRET || env.SANDFEST_PARTNER_PORTAL_SECRET,
    500
  );
  const secret = configuredSecret || (production ? "" : DEV_SECRET);
  const publicBaseUrl = safeBaseUrl(
    env.SANDFEST_PUBLIC_SITE_URL || (production ? "" : "http://127.0.0.1:5173"),
    production
  );
  const missing = [];
  if (secret.length < 32) missing.push("SANDFEST_OUTREACH_PREFERENCES_SECRET(32+ chars)");
  if (!publicBaseUrl) missing.push(production ? "SANDFEST_PUBLIC_SITE_URL(HTTPS)" : "SANDFEST_PUBLIC_SITE_URL");
  return {
    ready: missing.length === 0,
    production,
    secret,
    publicBaseUrl,
    missing,
    reason: missing.length ? `Missing ${missing.join(", ")}` : null
  };
}

function tokenMessage(prospect) {
  return [
    "texas-sandfest-outreach-preferences-v1",
    clean(prospect?.id, 120),
    clean(prospect?.contactEmail, 254).toLowerCase(),
    clean(prospect?.createdAt, 80)
  ].join(":");
}

export function issueOutreachPreferenceToken(prospect, options = {}) {
  const config = options.config ?? outreachPreferencesConfig(options.env);
  if (!config.ready || !prospect?.id || !prospect?.contactEmail || !prospect?.createdAt) return null;
  const signature = createHmac("sha256", config.secret).update(tokenMessage(prospect)).digest("base64url");
  return `tsfu_${signature}`;
}

export function verifyOutreachPreferenceToken(prospect, token, options = {}) {
  const expected = issueOutreachPreferenceToken(prospect, options);
  const received = clean(token, 200);
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function outreachPreferencePath(prospect, token) {
  if (!prospect?.id || !token) return null;
  return `/#outreach-preferences?prospect=${encodeURIComponent(prospect.id)}&token=${encodeURIComponent(token)}`;
}

export function outreachPreferenceUrl(prospect, token, options = {}) {
  const config = options.config ?? outreachPreferencesConfig(options.env);
  const preferencePath = outreachPreferencePath(prospect, token);
  if (!config.ready || !preferencePath) return null;
  return new URL(preferencePath, `${config.publicBaseUrl}/`).toString();
}

export function outreachPreferenceUrlForProspect(prospect, options = {}) {
  const config = options.config ?? outreachPreferencesConfig(options.env);
  const token = issueOutreachPreferenceToken(prospect, { config });
  return token ? outreachPreferenceUrl(prospect, token, { config }) : null;
}

export function findOutreachPreferenceProspect(docInput, prospectId, token, options = {}) {
  const prospects = Array.isArray(docInput?.prospects) ? docInput.prospects : [];
  const prospect = prospects.find(item => item.id === clean(prospectId, 120));
  if (!prospect || !verifyOutreachPreferenceToken(prospect, token, options)) {
    return { ok: false, error: "Outreach preference link is invalid." };
  }
  return { ok: true, prospect };
}

export function publicOutreachPreference(prospect) {
  return {
    organizationName: clean(prospect?.organizationName, 160),
    status: prospect?.suppressedAt || prospect?.status === "do_not_contact" ? "unsubscribed" : "subscribed",
    updatedAt: prospect?.updatedAt ?? prospect?.createdAt ?? null
  };
}

export function publicOutreachPreferencesReadiness(config = outreachPreferencesConfig()) {
  return {
    ready: config.ready,
    production: config.production,
    reason: config.reason
  };
}

export function appendOutreachPreferenceFooter(body, preferenceUrl) {
  const message = clean(body, 100_000);
  const url = clean(preferenceUrl, 2000);
  if (!url || message.includes(url)) return message;
  return `${message}\n\nManage sponsor outreach preferences: ${url}`;
}
