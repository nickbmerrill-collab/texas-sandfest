// Admin auth resolver.
//
// Two modes:
// - 'bearer-token' (default, dev): the existing static SANDFEST_ADMIN_API_TOKEN
//   compared with timing-safe equality, with role/actor pulled from env. Keeps
//   the local dev workflow unchanged.
// - 'jwt': verify an OIDC-style JWT against a remote JWKS. Works with Auth0,
//   Clerk, Cognito, Okta, Heyelab's own provider — anything that exposes a
//   JWKS URL. Role and actor come from configurable claims.
//
// Production deployments should run in 'jwt' mode. The deploymentProfile()
// check in admin-api-server.mjs flags bearer-token in production as an error.

import { timingSafeEqual } from "node:crypto";

const VALID_ROLES = new Set([
  "super_admin",
  "ops_admin",
  "ticketing_admin",
  "sponsor_admin",
  "finance_admin",
  "viewer"
]);

// Highest-privilege match wins when an IdP returns an array of roles.
const ROLE_PRIORITY = [
  "super_admin",
  "ops_admin",
  "ticketing_admin",
  "sponsor_admin",
  "finance_admin",
  "viewer"
];

const ASYMMETRIC_JWT_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA"
];

function getMode(env = process.env) {
  const explicit = env.SANDFEST_AUTH_MODE;
  if (explicit) return explicit;
  return env.SANDFEST_AUTH_JWKS_URL ? "jwt" : "bearer-token";
}

function bearerToken(request) {
  const header = request.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7).trim();
}

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function pickClaim(payload, path) {
  if (!path) return undefined;
  const segments = path.split(".");
  let value = payload;
  for (const segment of segments) {
    if (value == null) return undefined;
    value = value[segment];
  }
  return value;
}

function resolveRoleFromClaim(claim) {
  if (!claim) return null;
  if (typeof claim === "string") {
    return VALID_ROLES.has(claim) ? claim : null;
  }
  if (Array.isArray(claim)) {
    for (const candidate of ROLE_PRIORITY) {
      if (claim.includes(candidate)) return candidate;
    }
  }
  return null;
}

let jwksLoader = null;
let jwtVerify = null;

async function loadJose() {
  if (jwksLoader && jwtVerify) return;
  let jose;
  try {
    jose = await import("jose");
  } catch (error) {
    throw new Error(`SANDFEST_AUTH_MODE=jwt requires the 'jose' package. Run \`npm install jose\`. (${error.message})`);
  }
  jwksLoader = jose.createRemoteJWKSet;
  jwtVerify = jose.jwtVerify;
}

let cachedJwks = null;
let cachedJwksUrl = null;

async function getJwks() {
  const url = process.env.SANDFEST_AUTH_JWKS_URL;
  if (!url) {
    throw new Error("SANDFEST_AUTH_JWKS_URL is not set; cannot verify JWT.");
  }
  await loadJose();
  if (!cachedJwks || cachedJwksUrl !== url) {
    cachedJwks = jwksLoader(new URL(url));
    cachedJwksUrl = url;
  }
  return cachedJwks;
}

async function verifyJwt(token) {
  const config = authConfiguration();
  const { issuer, audience } = config;
  if (!issuer) throw new Error("SANDFEST_AUTH_ISSUER is required in JWT mode.");
  if (!audience) throw new Error("SANDFEST_AUTH_AUDIENCE is required in JWT mode.");
  if (config.production && !config.checks.jwks) throw new Error("Production JWT mode requires a HTTPS JWKS URL.");
  if (config.production && !config.checks.issuer) throw new Error("Production JWT mode requires a HTTPS issuer.");
  const jwks = await getJwks();
  const verifyOptions = {
    issuer,
    audience,
    algorithms: ASYMMETRIC_JWT_ALGORITHMS
  };
  const { payload } = await jwtVerify(token, jwks, verifyOptions);
  return payload;
}

export function authMode() {
  return getMode();
}

export function authModeIsJwt() {
  return getMode() === "jwt";
}

export function authConfiguration(env = process.env) {
  const mode = getMode(env);
  const jwt = mode === "jwt";
  const production = env.SANDFEST_ENV === "production";
  const jwksUrl = String(env.SANDFEST_AUTH_JWKS_URL || "").trim();
  const issuer = String(env.SANDFEST_AUTH_ISSUER || "").trim();
  const audience = String(env.SANDFEST_AUTH_AUDIENCE || "").trim();
  const checks = {
    jwks: !jwt || (Boolean(jwksUrl) && (!production || jwksUrl.startsWith("https://"))),
    issuer: !jwt || (Boolean(issuer) && (!production || issuer.startsWith("https://"))),
    audience: !jwt || Boolean(audience)
  };
  return {
    mode,
    jwt,
    production,
    jwksUrl,
    issuer,
    audience,
    checks,
    ready: Object.values(checks).every(Boolean)
  };
}

export async function resolveSession(request, { rolePermissions }) {
  const mode = getMode();

  if (mode === "bearer-token") {
    const expected = process.env.SANDFEST_ADMIN_API_TOKEN || "dev-admin-token-change-me";
    const presented = bearerToken(request);
    if (!presented) return null;
    if (!timingSafeStringEqual(presented, expected)) return null;
    const configuredRole = process.env.SANDFEST_ADMIN_ROLE || "super_admin";
    const role = rolePermissions[configuredRole] ? configuredRole : "viewer";
    return {
      id: process.env.SANDFEST_ADMIN_ACTOR_ID || "local-admin",
      role,
      permissions: rolePermissions[role],
      auth: "local-bearer-token"
    };
  }

  if (mode === "jwt") {
    const token = bearerToken(request);
    if (!token) return null;
    let payload;
    try {
      payload = await verifyJwt(token);
    } catch {
      return null;
    }
    const roleClaimPath = process.env.SANDFEST_AUTH_ROLE_CLAIM || "sandfest_role";
    const actorClaimPath = process.env.SANDFEST_AUTH_ACTOR_CLAIM || "sub";
    const actor = pickClaim(payload, actorClaimPath);
    const actorId = typeof actor === "string" ? actor.trim() : "";
    if (!actorId || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp <= payload.iat) {
      return null;
    }
    let role = resolveRoleFromClaim(pickClaim(payload, roleClaimPath));
    if (!role) {
      // Fallback: env-driven user→role map. Useful when the IdP has not
      // been configured to emit a sandfest_role claim yet (e.g. Clerk
      // dashboard customization not wired). Format:
      // SANDFEST_AUTH_USER_ROLES=user_abc:super_admin,user_xyz:ops_admin
      const map = process.env.SANDFEST_AUTH_USER_ROLES || "";
      for (const entry of map.split(",")) {
        const [userId, candidate] = entry.split(":").map(s => s?.trim());
        if (userId && userId === actorId && candidate && VALID_ROLES.has(candidate)) {
          role = candidate;
          break;
        }
      }
    }
    if (!role) return null;
    return {
      id: actorId,
      role,
      permissions: rolePermissions[role],
      auth: "jwt",
      issuer: payload.iss ?? null,
      audience: payload.aud ?? null,
      tokenId: payload.jti ?? null,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null
    };
  }

  return null;
}
