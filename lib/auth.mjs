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

function getMode() {
  const explicit = process.env.SANDFEST_AUTH_MODE;
  if (explicit) return explicit;
  return process.env.SANDFEST_AUTH_JWKS_URL ? "jwt" : "bearer-token";
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
  const jwks = await getJwks();
  const issuer = process.env.SANDFEST_AUTH_ISSUER;
  const audience = process.env.SANDFEST_AUTH_AUDIENCE;
  const verifyOptions = {};
  if (issuer) verifyOptions.issuer = issuer;
  if (audience) verifyOptions.audience = audience;
  const { payload } = await jwtVerify(token, jwks, verifyOptions);
  return payload;
}

export function authMode() {
  return getMode();
}

export function authModeIsJwt() {
  return getMode() === "jwt";
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
    const actorId = typeof actor === "string" && actor ? actor : "jwt-unknown";
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
