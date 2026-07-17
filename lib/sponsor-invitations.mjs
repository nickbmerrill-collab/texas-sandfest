import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SPONSOR_INVITATION_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SPONSOR_INVITATION_MAX_TTL_MS = 45 * 24 * 60 * 60 * 1000;

const DEV_SECRET = "sandfest-local-sponsor-invitation-secret-change-me";
const ACTIVE_PROSPECT_STATUSES = new Set(["qualified", "contact_ready", "contacted", "engaged"]);
const SIGNATURE_DOMAIN = "sandfest:sponsor-invitation:v1:";

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function safeBaseUrl(value, production) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    if (production && url.protocol !== "https:") return "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function emailHash(value) {
  return createHash("sha256").update(clean(value, 254).toLowerCase()).digest("base64url");
}

export function sponsorInvitationConfig(env = process.env) {
  const production = env.SANDFEST_ENV === "production";
  const configuredSecret = clean(
    env.SANDFEST_SPONSOR_INVITATION_SECRET || env.SANDFEST_PARTNER_PORTAL_SECRET,
    500
  );
  const secret = configuredSecret || (production ? "" : DEV_SECRET);
  const publicBaseUrl = safeBaseUrl(
    env.SANDFEST_PUBLIC_SITE_URL || (production ? "" : "http://127.0.0.1:5173"),
    production
  );
  const missing = [];
  if (secret.length < 32) missing.push("SANDFEST_SPONSOR_INVITATION_SECRET(32+ chars)");
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

function signatureFor(encoded, secret) {
  return createHmac("sha256", secret).update(`${SIGNATURE_DOMAIN}${encoded}`).digest("base64url");
}

export function issueSponsorInvitationToken(prospect, options = {}) {
  const config = options.config ?? sponsorInvitationConfig(options.env);
  const invitation = prospect?.sponsorInvitation;
  if (!config.ready || !prospect?.id || !prospect?.contactEmail || !invitation?.packageId || !invitation?.expiresAt) return null;
  const payload = {
    version: 1,
    prospectId: clean(prospect.id, 120),
    packageId: clean(invitation.packageId, 100),
    invitationVersion: Number(invitation.version || 1),
    issuedAt: clean(invitation.issuedAt, 80),
    expiresAt: clean(invitation.expiresAt, 80),
    emailHash: emailHash(prospect.contactEmail)
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `tsfi1.${encoded}.${signatureFor(encoded, config.secret)}`;
}

export function verifySponsorInvitationToken(docInput, token, options = {}) {
  const config = options.config ?? sponsorInvitationConfig(options.env);
  const candidate = clean(token, 5000);
  const parts = candidate.split(".");
  if (!config.ready || parts.length !== 3 || parts[0] !== "tsfi1") return { ok: false, error: "Sponsor invitation is invalid." };
  const expected = Buffer.from(signatureFor(parts[1], config.secret));
  const supplied = Buffer.from(parts[2]);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return { ok: false, error: "Sponsor invitation is invalid." };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "Sponsor invitation is invalid." };
  }
  const prospect = (Array.isArray(docInput?.prospects) ? docInput.prospects : []).find(item => item.id === clean(payload?.prospectId, 120));
  const invitation = prospect?.sponsorInvitation;
  const expiresAt = new Date(payload?.expiresAt).getTime();
  const now = options.now ?? Date.now();
  if (!prospect || payload?.version !== 1 || !invitation) return { ok: false, error: "Sponsor invitation is invalid or has been revoked." };
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return { ok: false, expired: true, error: "Sponsor invitation expired. Ask the SandFest team for a new link." };
  if (
    payload.packageId !== invitation.packageId ||
    Number(payload.invitationVersion) !== Number(invitation.version) ||
    payload.expiresAt !== invitation.expiresAt ||
    payload.emailHash !== emailHash(prospect.contactEmail)
  ) return { ok: false, error: "Sponsor invitation is invalid or has been replaced." };
  if (prospect.convertedApplicationId) return { ok: true, converted: true, prospect, invitation, payload };
  if (prospect.suppressedAt || !ACTIVE_PROSPECT_STATUSES.has(prospect.status)) {
    return { ok: false, error: "Sponsor invitation is no longer active." };
  }
  return { ok: true, prospect, invitation, payload };
}

export function sponsorInvitationPath(token) {
  return token ? `/#sponsor-invitation?token=${encodeURIComponent(token)}` : null;
}

export function sponsorInvitationUrlForProspect(prospect, options = {}) {
  const config = options.config ?? sponsorInvitationConfig(options.env);
  const token = issueSponsorInvitationToken(prospect, { config });
  const invitePath = sponsorInvitationPath(token);
  return config.ready && invitePath ? new URL(invitePath, `${config.publicBaseUrl}/`).toString() : null;
}

export function publicSponsorInvitation(prospect, sponsorPackage) {
  return {
    organizationName: clean(prospect?.organizationName, 160),
    contactName: clean(prospect?.contactName, 120),
    contactEmail: clean(prospect?.contactEmail, 254),
    website: clean(prospect?.website, 500),
    packageId: clean(sponsorPackage?.id, 100),
    packageName: clean(sponsorPackage?.name, 120),
    packageLabel: clean(sponsorPackage?.publicLabel, 120),
    expiresAt: prospect?.sponsorInvitation?.expiresAt ?? null
  };
}

export function publicSponsorInvitationReadiness(config = sponsorInvitationConfig()) {
  return { ready: config.ready, production: config.production, reason: config.reason };
}
